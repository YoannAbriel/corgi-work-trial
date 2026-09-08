import postgres from "postgres";

// Proves the guards that need COMMITTED rows, so it only ever runs against the disposable
// database corgi_test (DATABASE_URL_TEST / DATABASE_URL_TEST_APP), never the trial ledger.
//   1. an entry committed by app_runtime cannot receive more lines in a later transaction
//      (F-B1-01: entries are sealed at commit; the only correction is a reversal entry);
//   2. the owner cannot TRUNCATE a protected table (F-B1-03);
//   3. a live-mode webhook event cannot be stored, whatever the code does (AF-04 in the database).
// Run with: npm run check:ledger-seal   (after `DATABASE_URL=$DATABASE_URL_TEST npm run migrate`)

if (!process.env.DATABASE_URL_TEST) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // rely on the environment
  }
}

const ownerUrl = process.env.DATABASE_URL_TEST;
const runtimeUrl = process.env.DATABASE_URL_TEST_APP;
if (!ownerUrl || !runtimeUrl) {
  console.error("DATABASE_URL_TEST and DATABASE_URL_TEST_APP must be set (they must point at the corgi_test database)");
  process.exit(1);
}
for (const url of [ownerUrl, runtimeUrl]) {
  if (new URL(url).pathname !== "/corgi_test") {
    console.error("refusing to run: the test URLs must point at the database named corgi_test");
    process.exit(1);
  }
}

let failures = 0;
function report(name: string, passed: boolean, detail: string) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}  (${detail})`);
  if (!passed) failures += 1;
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const owner = postgres(ownerUrl!, { max: 1, prepare: false });
  const runtime = postgres(runtimeUrl!, { max: 1, prepare: false });

  // 1. Commit a balanced entry as app_runtime, then try to append lines in a new transaction.
  const entryId = await runtime.begin(async (tx) => {
    const [entry] = await tx<{ id: string }[]>`
      insert into journal_entries (entry_type, effective_at, source_kind, source_id, description)
      values ('seal_check', '2028-03-01', 'seal_check', gen_random_uuid()::text, 'committed on purpose in corgi_test')
      returning id
    `;
    await tx`insert into journal_lines (entry_id, account_id, debit_cents) values (${entry.id}, 'cash_stripe', 500)`;
    await tx`insert into journal_lines (entry_id, account_id, credit_cents) values (${entry.id}, 'earned_premium', 500)`;
    return entry.id;
  });
  let sealMessage = "no error raised";
  try {
    await runtime.begin(async (tx) => {
      await tx`insert into journal_lines (entry_id, account_id, debit_cents) values (${entryId}, 'cash_stripe', 100)`;
      await tx`insert into journal_lines (entry_id, account_id, credit_cents) values (${entryId}, 'earned_premium', 100)`;
    });
  } catch (error) {
    sealMessage = messageOf(error);
  }
  const [{ count }] = await owner<{ count: string }[]>`select count(*)::text as count from journal_lines where entry_id = ${entryId}`;
  report("committed entry refuses new lines in a later transaction", sealMessage.includes("is sealed") && count === "2", `${sealMessage.slice(0, 90)}; lines still ${count}`);

  // 2. The owner cannot TRUNCATE a protected table.
  let truncateMessage = "no error raised";
  try {
    await owner.begin(async (tx) => {
      await tx`truncate journal_lines`;
    });
  } catch (error) {
    truncateMessage = messageOf(error);
  }
  report("owner cannot TRUNCATE journal_lines", truncateMessage.includes("TRUNCATE on journal_lines is not allowed"), truncateMessage.slice(0, 90));

  // 3. A live-mode webhook event cannot be stored.
  let livemodeMessage = "no error raised";
  try {
    await owner.begin(async (tx) => {
      await tx`
        insert into webhook_events (provider, provider_event_id, event_type, livemode, payload, signature_verified)
        values ('stripe', 'evt_seal_check_live', 'payment_intent.succeeded', true, '{}'::jsonb, true)
      `;
    });
  } catch (error) {
    livemodeMessage = messageOf(error);
  }
  report("live-mode webhook event is refused by the database", /webhook_events_are_test_mode_only/.test(livemodeMessage), livemodeMessage.slice(0, 90));

  // 4. Same transaction still works: header plus lines together (the normal posting path).
  let normalMessage: string | null = null;
  try {
    await runtime.begin(async (tx) => {
      const [entry] = await tx<{ id: string }[]>`
        insert into journal_entries (entry_type, effective_at, source_kind, source_id, description)
        values ('seal_check', '2028-03-01', 'seal_check', gen_random_uuid()::text, 'normal posting path')
        returning id
      `;
      await tx`insert into journal_lines (entry_id, account_id, debit_cents) values (${entry.id}, 'cash_stripe', 700)`;
      await tx`insert into journal_lines (entry_id, account_id, credit_cents) values (${entry.id}, 'earned_premium', 700)`;
    });
  } catch (error) {
    normalMessage = messageOf(error);
  }
  report("header and lines in one transaction still post", normalMessage === null, normalMessage ?? "committed");

  await owner.end();
  await runtime.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("check failed to run:", messageOf(error));
  process.exit(1);
});
