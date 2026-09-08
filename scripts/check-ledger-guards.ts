import postgres from "postgres";

// Proves the database guards of migration 0001 on a real database, as two roles:
//   as the owner    : UPDATE and DELETE on money tables are refused by the trigger,
//                     an unbalanced entry cannot be committed (nothing partial is left behind),
//                     an entry with no lines cannot be committed,
//                     recorded_at cannot be set by the client.
//   as app_runtime  : UPDATE and DELETE are refused by missing privileges, before any trigger.
// Every check inserts inside a transaction that is rolled back, so the trial ledger is left
// exactly as it was. Run with: npm run check:ledger-guards   (reads .env.local)
// Output: one PASS or FAIL line per check, exit code 1 if any check fails.

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // rely on the environment
  }
}

const ownerUrl = process.env.DATABASE_URL;
const runtimeUrl = process.env.DATABASE_URL_APP;
if (!ownerUrl || !runtimeUrl) {
  console.error("DATABASE_URL and DATABASE_URL_APP must be set");
  process.exit(1);
}

let failures = 0;
function report(name: string, passed: boolean, detail: string) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}  (${detail})`);
  if (!passed) failures += 1;
}

// Runs `action` inside a transaction that is always rolled back, and returns the error message
// raised (or null when nothing was raised).
async function expectError(sql: postgres.Sql, action: (tx: postgres.TransactionSql) => Promise<void>): Promise<string | null> {
  try {
    await sql.begin(async (tx) => {
      await action(tx);
      throw new RollbackSentinel();
    });
    return null;
  } catch (error) {
    if (error instanceof RollbackSentinel) return null;
    return error instanceof Error ? error.message : String(error);
  }
}
class RollbackSentinel extends Error {}

async function insertBalancedEntry(tx: postgres.TransactionSql): Promise<string> {
  const [entry] = await tx<{ id: string }[]>`
    insert into journal_entries (entry_type, effective_at, source_kind, source_id, description)
    values ('guard_check', '2028-01-01', 'guard_check', gen_random_uuid()::text, 'guard check, always rolled back')
    returning id
  `;
  await tx`insert into journal_lines (entry_id, account_id, debit_cents) values (${entry.id}, 'cash_stripe', 100)`;
  await tx`insert into journal_lines (entry_id, account_id, credit_cents) values (${entry.id}, 'earned_premium', 100)`;
  return entry.id;
}

async function main() {
  const owner = postgres(ownerUrl!, { max: 1, prepare: false });
  const runtime = postgres(runtimeUrl!, { max: 1, prepare: false });

  // 1. Owner: UPDATE on a balanced entry is refused by the trigger.
  let message = await expectError(owner, async (tx) => {
    const id = await insertBalancedEntry(tx);
    await tx`update journal_entries set description = 'edited' where id = ${id}`;
  });
  report("owner cannot UPDATE journal_entries", !!message && message.includes("append-only"), message ?? "no error raised");

  // 2. Owner: DELETE on a line is refused by the trigger.
  message = await expectError(owner, async (tx) => {
    const id = await insertBalancedEntry(tx);
    await tx`delete from journal_lines where entry_id = ${id}`;
  });
  report("owner cannot DELETE journal_lines", !!message && message.includes("append-only"), message ?? "no error raised");

  // 3. Owner: an unbalanced entry cannot be committed (CRG-08-04).
  message = await expectError(owner, async (tx) => {
    const [entry] = await tx<{ id: string }[]>`
      insert into journal_entries (entry_type, effective_at, source_kind, source_id, description)
      values ('guard_check', '2028-01-01', 'guard_check', gen_random_uuid()::text, 'unbalanced')
      returning id
    `;
    await tx`insert into journal_lines (entry_id, account_id, debit_cents) values (${entry.id}, 'cash_stripe', 100)`;
    await tx`insert into journal_lines (entry_id, account_id, credit_cents) values (${entry.id}, 'earned_premium', 99)`;
    await tx`set constraints all immediate`; // forces the deferred check now, inside the rolled-back transaction
  });
  report("unbalanced entry is refused", !!message && message.includes("does not balance"), message ?? "no error raised");

  // 4. Owner: an entry with no lines cannot be committed.
  message = await expectError(owner, async (tx) => {
    await tx`
      insert into journal_entries (entry_type, effective_at, source_kind, source_id, description)
      values ('guard_check', '2028-01-01', 'guard_check', gen_random_uuid()::text, 'no lines')
    `;
    await tx`set constraints all immediate`;
  });
  report("entry without lines is refused", !!message && message.includes("has no lines"), message ?? "no error raised");

  // 5. Owner: recorded_at is set by the server even when the client sends a value.
  // Inside a transaction (rolled back at the end): insert a header with a year-2000 recorded_at,
  // give it balanced lines, then read back what the database actually stored.
  let storedRecordedAt: Date | null = null;
  await expectError(owner, async (tx) => {
    const [entry] = await tx<{ id: string }[]>`
      insert into journal_entries (entry_type, effective_at, recorded_at, source_kind, source_id, description)
      values ('guard_check', '2028-01-01', '2000-01-01T00:00:00Z', 'guard_check', gen_random_uuid()::text, 'clock check')
      returning id
    `;
    await tx`insert into journal_lines (entry_id, account_id, debit_cents) values (${entry.id}, 'cash_stripe', 100)`;
    await tx`insert into journal_lines (entry_id, account_id, credit_cents) values (${entry.id}, 'earned_premium', 100)`;
    const [row] = await tx<{ recorded_at: Date }[]>`select recorded_at from journal_entries where id = ${entry.id}`;
    storedRecordedAt = row.recorded_at;
  });
  const serverClockWon = storedRecordedAt !== null && (storedRecordedAt as Date).getTime() > Date.parse("2020-01-01T00:00:00Z");
  report("recorded_at ignores the client value", serverClockWon, storedRecordedAt ? `stored ${(storedRecordedAt as Date).toISOString()} instead of 2000-01-01` : "no row read");

  // 6. Runtime role: UPDATE refused by privileges (before any trigger runs).
  message = await expectError(runtime, async (tx) => {
    await tx`update journal_entries set description = 'edited' where false`;
  });
  report("app_runtime lacks UPDATE on journal_entries", !!message && /permission denied/i.test(message), message ?? "no error raised");

  message = await expectError(runtime, async (tx) => {
    await tx`delete from webhook_events where false`;
  });
  report("app_runtime lacks DELETE on webhook_events", !!message && /permission denied/i.test(message), message ?? "no error raised");

  message = await expectError(runtime, async (tx) => {
    await tx`truncate journal_lines`;
  });
  report("app_runtime lacks TRUNCATE on journal_lines", !!message && /permission denied/i.test(message), message ?? "no error raised");

  // 7. Runtime role: INSERT of a balanced entry works (the role can do its job).
  message = await expectError(runtime, async (tx) => {
    await insertBalancedEntry(tx);
  });
  report("app_runtime can INSERT a balanced entry", message === null, message ?? "inserted then rolled back");

  // 8. Global assertion (CRG-08-01): across all committed entries, debits equal credits.
  const [totals] = await owner<{ debits: string; credits: string }[]>`
    select coalesce(sum(debit_cents), 0)::text as debits, coalesce(sum(credit_cents), 0)::text as credits from journal_lines
  `;
  report("committed journal balances globally", totals.debits === totals.credits, `debits ${totals.debits} = credits ${totals.credits}`);

  await owner.end();
  await runtime.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("check failed to run:", error instanceof Error ? error.message : error);
  process.exit(1);
});
