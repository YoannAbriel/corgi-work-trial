import postgres from "postgres";

// Proves, on a real database, that the tables added by migrations 0002 and 0004 are
// append-only, exactly the way scripts/check-ledger-guards.ts does it for the ledger core.
//
//   as the owner   : UPDATE, DELETE and TRUNCATE are refused by triggers, even for the role
//                    that owns the schema, and recorded_at cannot be chosen by the client;
//   as app_runtime : UPDATE, DELETE and TRUNCATE are refused by missing privileges, before
//                    any trigger runs.
//
// Every check runs inside a transaction that is rolled back, so the database is left exactly
// as it was. Run with: npm run check:money-guards   (reads .env.local)
// Output: one PASS or FAIL line per check, exit code 1 if any check fails.

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on the environment
}

const useTestDatabase = process.argv.includes("--database=test");
const ownerUrl = useTestDatabase ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL;
const runtimeUrl = useTestDatabase ? process.env.DATABASE_URL_TEST_APP : process.env.DATABASE_URL_APP;
if (!ownerUrl || !runtimeUrl) {
  console.error("the owner and runtime connection strings must both be set");
  process.exit(1);
}

const PROTECTED_TABLES = [
  "brokers",
  "policies",
  "policy_events",
  "money_operations",
  "money_operation_events",
  "state_tax_rates",
  "broker_kyb_events",
] as const;

type ProtectedTable = (typeof PROTECTED_TABLES)[number];

let failures = 0;
function report(name: string, passed: boolean, detail: string) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}  (${detail})`);
  if (!passed) failures += 1;
}

class RollbackSentinel extends Error {}

// Runs `action` inside a transaction that is always rolled back, and returns the error message
// raised (or null when nothing was raised).
async function expectError(
  sql: postgres.Sql,
  action: (tx: postgres.TransactionSql) => Promise<void>,
): Promise<string | null> {
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

// One row in each protected table, wired together by their foreign keys, so that an UPDATE or
// a DELETE has something real to try to change.
type Fixture = { [table in ProtectedTable]: string };

async function insertFixtureRows(tx: postgres.TransactionSql): Promise<Fixture> {
  const [broker] = await tx<{ id: string }[]>`
    insert into brokers (name, commission_rate_bps) values ('guard check broker', 1500) returning id
  `;
  const [customer] = await tx<{ id: string }[]>`
    insert into customers (name, email) values ('guard check customer', 'guard-check@example.invalid') returning id
  `;
  const [policy] = await tx<{ id: string }[]>`
    insert into policies (broker_id, customer_id, state_code) values (${broker.id}, ${customer.id}, 'CA') returning id
  `;
  const [policyEvent] = await tx<{ id: string }[]>`
    insert into policy_events (policy_id, event_type, effective_at, payload)
    values (${policy.id}, 'quoted', '2028-03-01', '{"annual_premium_cents": 120000}'::jsonb)
    returning id
  `;
  const [operation] = await tx<{ id: string }[]>`
    insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key)
    values ('stripe_checkout', 'stripe', 125320, ${policy.id}, 'guard-check:' || gen_random_uuid()::text)
    returning id
  `;
  const [operationEvent] = await tx<{ id: string }[]>`
    insert into money_operation_events (operation_id, status) values (${operation.id}, 'requested') returning id
  `;
  const [taxRate] = await tx<{ id: string }[]>`
    insert into state_tax_rates (state_code, rate_bps, effective_from, source_url, source_checked_on, note)
    values ('ZZ', 235, '1986-01-01', 'https://example.invalid/guard-check', '2026-09-08', 'guard check row, always rolled back')
    returning id
  `;
  const [kybEvent] = await tx<{ id: string }[]>`
    insert into broker_kyb_events (broker_id, provider, status) values (${broker.id}, 'seed', 'approved') returning id
  `;
  return {
    brokers: broker.id,
    policies: policy.id,
    policy_events: policyEvent.id,
    money_operations: operation.id,
    money_operation_events: operationEvent.id,
    state_tax_rates: taxRate.id,
    broker_kyb_events: kybEvent.id,
  };
}

async function main() {
  const owner = postgres(ownerUrl!, { max: 1, prepare: false });
  const runtime = postgres(runtimeUrl!, { max: 1, prepare: false });

  // 1. Owner: UPDATE and DELETE are refused by the trigger on every protected table.
  for (const table of PROTECTED_TABLES) {
    const updateError = await expectError(owner, async (tx) => {
      const fixture = await insertFixtureRows(tx);
      await tx`update ${tx(table)} set id = gen_random_uuid() where id = ${fixture[table]}`;
    });
    report(`owner cannot UPDATE ${table}`, !!updateError && updateError.includes("append-only"), updateError ?? "no error raised");

    const deleteError = await expectError(owner, async (tx) => {
      const fixture = await insertFixtureRows(tx);
      await tx`delete from ${tx(table)} where id = ${fixture[table]}`;
    });
    report(`owner cannot DELETE ${table}`, !!deleteError && deleteError.includes("append-only"), deleteError ?? "no error raised");
  }

  // 2. Owner: TRUNCATE is refused too, so no one can empty a table without touching a row.
  for (const table of PROTECTED_TABLES) {
    const truncateError = await expectError(owner, async (tx) => {
      await tx`truncate ${tx(table)} cascade`;
    });
    report(
      `owner cannot TRUNCATE ${table}`,
      !!truncateError && truncateError.includes("append-only"),
      truncateError ?? "no error raised",
    );
  }

  // 3. Runtime role: the privileges are simply not there. `where false` matches no row, so
  //    this proves the refusal comes from the grant and not from a trigger.
  for (const table of PROTECTED_TABLES) {
    const updateError = await expectError(runtime, async (tx) => {
      await tx`update ${tx(table)} set id = id where false`;
    });
    report(
      `app_runtime lacks UPDATE on ${table}`,
      !!updateError && /permission denied/i.test(updateError),
      updateError ?? "no error raised",
    );

    const deleteError = await expectError(runtime, async (tx) => {
      await tx`delete from ${tx(table)} where false`;
    });
    report(
      `app_runtime lacks DELETE on ${table}`,
      !!deleteError && /permission denied/i.test(deleteError),
      deleteError ?? "no error raised",
    );

    const truncateError = await expectError(runtime, async (tx) => {
      await tx`truncate ${tx(table)} cascade`;
    });
    report(
      `app_runtime lacks TRUNCATE on ${table}`,
      !!truncateError && /permission denied/i.test(truncateError),
      truncateError ?? "no error raised",
    );
  }

  // 4. recorded_at and created_at come from the database clock, not from the client.
  let storedTimes: { policy_event: Date; operation: Date } | null = null;
  await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    const [policyEvent] = await tx<{ recorded_at: Date }[]>`
      insert into policy_events (policy_id, event_type, effective_at, recorded_at, payload)
      values (${fixture.policies}, 'endorsed', '2028-03-01', '2000-01-01T00:00:00Z', '{"annual_premium_cents": 1}'::jsonb)
      returning recorded_at
    `;
    const [operation] = await tx<{ created_at: Date }[]>`
      insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key, created_at)
      values ('stripe_checkout', 'stripe', 1, ${fixture.policies}, 'guard-check-clock:' || gen_random_uuid()::text,
              '2000-01-01T00:00:00Z')
      returning created_at
    `;
    storedTimes = { policy_event: policyEvent.recorded_at, operation: operation.created_at };
  });
  const clockCheck = storedTimes as { policy_event: Date; operation: Date } | null;
  const serverClockWon =
    clockCheck !== null &&
    clockCheck.policy_event.getTime() > Date.parse("2020-01-01T00:00:00Z") &&
    clockCheck.operation.getTime() > Date.parse("2020-01-01T00:00:00Z");
  report(
    "recorded_at and created_at ignore the client value",
    serverClockWon,
    clockCheck ? `stored ${clockCheck.policy_event.toISOString()} instead of 2000-01-01` : "no row read",
  );

  await owner.end();
  await runtime.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("check failed to run:", error instanceof Error ? error.message : error);
  process.exit(1);
});
