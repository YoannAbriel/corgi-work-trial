import postgres from "postgres";

// Proves, on a real database, that the tables added by migrations 0002, 0004, 0005 and 0006
// are append-only, exactly the way scripts/check-ledger-guards.ts does it for the ledger core.
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
  // Added by migration 0005 (slice B5): what each Stripe refund gives back and why.
  "refund_allocations",
  // Added by migration 0006 (slice B3): what a broker declared for business verification,
  // and the Stripe Connected Account Agreement acceptance sent with it.
  "broker_kyb_submissions",
  // Added by migration 0009 (slice B4): which Stripe payment collects which endorsement's delta.
  "endorsement_collections",
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
  // The verification the broker submitted. Only the last four digits of the EIN are ever
  // stored; the number itself goes to Stripe and comes back to nobody.
  const [kybSubmission] = await tx<{ id: string }[]>`
    insert into broker_kyb_submissions (
      broker_id, provider, provider_idempotency_key, legal_name, ein_last4,
      address_line1, address_city, address_state, address_postal_code,
      business_url, contact_email, terms_accepted_at, terms_accepted_ip, submitted_by
    ) values (
      ${broker.id}, 'stripe_connect', 'guard-check-kyb:' || gen_random_uuid()::text,
      'Guard Check Brokerage LLC', '0000', 'address_full_match', 'San Francisco', 'CA', '94105',
      'https://example.invalid/guard-check', 'guard-check@example.invalid',
      '2026-09-08T12:00:00Z', '203.0.113.10', null
    )
    returning id
  `;
  // A refund of that collection, with the allocation row that says what it gives back
  // (migration 0005). 89172 = 87124 of premium + 2048 of tax, the recited example.
  const [refundOperation] = await tx<{ id: string }[]>`
    insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key)
    values ('stripe_refund', 'stripe', 89172, ${policy.id}, 'guard-check-refund:' || gen_random_uuid()::text)
    returning id
  `;
  const [allocation] = await tx<{ id: string }[]>`
    insert into refund_allocations (
      refund_operation_id, policy_id, policy_event_id, collection_operation_id, payment_intent_id,
      amount_cents, refunded_premium_cents, refunded_tax_cents, commission_clawback_cents
    ) values (
      ${refundOperation.id}, ${policy.id}, ${policyEvent.id}, ${operation.id}, 'pi_guard_check',
      89172, 87124, 2048, 13068
    )
    returning id
  `;
  // An endorsement request and the payment that collects its delta (migration 0009).
  // 44584 = 43561 of premium + 1023 of tax, the recited example (+$600 on day 100).
  const [requestEvent] = await tx<{ id: string }[]>`
    insert into policy_events (policy_id, event_type, effective_at, payload)
    values (${policy.id}, 'endorsement_requested', '2028-06-09', '{"delta_premium_cents": 43561}'::jsonb)
    returning id
  `;
  const [deltaOperation] = await tx<{ id: string }[]>`
    insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key)
    values ('stripe_checkout', 'stripe', 44584, ${policy.id}, 'guard-check-endorsement:' || gen_random_uuid()::text)
    returning id
  `;
  const [endorsementCollection] = await tx<{ id: string }[]>`
    insert into endorsement_collections (
      collection_operation_id, policy_id, request_event_id, quote_hash, amount_cents, delta_premium_cents, delta_tax_cents
    ) values (
      ${deltaOperation.id}, ${policy.id}, ${requestEvent.id}, 'guard-check-hash', 44584, 43561, 1023
    )
    returning id
  `;
  return {
    brokers: broker.id,
    policies: policy.id,
    policy_events: policyEvent.id,
    money_operations: operation.id,
    money_operation_events: operationEvent.id,
    state_tax_rates: taxRate.id,
    broker_kyb_events: kybEvent.id,
    refund_allocations: allocation.id,
    broker_kyb_submissions: kybSubmission.id,
    endorsement_collections: endorsementCollection.id,
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
  let storedTimes: { policy_event: Date; operation: Date; refund_allocation: Date; kyb_submission: Date } | null = null;
  await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    const [policyEvent] = await tx<{ recorded_at: Date }[]>`
      insert into policy_events (policy_id, event_type, effective_at, recorded_at, payload)
      values (${fixture.policies}, 'endorsed', '2028-03-01', '2000-01-01T00:00:00Z', '{"annual_premium_cents": 1}'::jsonb)
      returning recorded_at
    `;
    const [operation] = await tx<{ id: string; created_at: Date }[]>`
      insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key, created_at)
      values ('stripe_refund', 'stripe', 1, ${fixture.policies}, 'guard-check-clock:' || gen_random_uuid()::text,
              '2000-01-01T00:00:00Z')
      returning id, created_at
    `;
    const [allocation] = await tx<{ recorded_at: Date }[]>`
      insert into refund_allocations (
        refund_operation_id, policy_id, policy_event_id, collection_operation_id, payment_intent_id,
        amount_cents, refunded_premium_cents, refunded_tax_cents, commission_clawback_cents, recorded_at
      ) values (
        ${operation.id}, ${fixture.policies}, ${fixture.policy_events}, ${fixture.money_operations},
        'pi_guard_check_clock', 1, 1, 0, 0, '2000-01-01T00:00:00Z'
      )
      returning recorded_at
    `;
    const [kybSubmission] = await tx<{ recorded_at: Date }[]>`
      insert into broker_kyb_submissions (
        broker_id, provider, provider_idempotency_key, legal_name, ein_last4,
        address_line1, address_city, address_state, address_postal_code,
        business_url, contact_email, terms_accepted_at, terms_accepted_ip, recorded_at
      ) values (
        ${fixture.brokers}, 'stripe_connect', 'guard-check-clock:' || gen_random_uuid()::text,
        'Guard Check Brokerage LLC', '0000', 'address_full_match', 'San Francisco', 'CA', '94105',
        'https://example.invalid/guard-check', 'guard-check@example.invalid',
        '2026-09-08T12:00:00Z', '203.0.113.10', '2000-01-01T00:00:00Z'
      )
      returning recorded_at
    `;
    storedTimes = {
      policy_event: policyEvent.recorded_at,
      operation: operation.created_at,
      refund_allocation: allocation.recorded_at,
      kyb_submission: kybSubmission.recorded_at,
    };
  });
  const clockCheck = storedTimes as
    | { policy_event: Date; operation: Date; refund_allocation: Date; kyb_submission: Date }
    | null;
  const serverClockWon =
    clockCheck !== null &&
    clockCheck.policy_event.getTime() > Date.parse("2020-01-01T00:00:00Z") &&
    clockCheck.operation.getTime() > Date.parse("2020-01-01T00:00:00Z") &&
    clockCheck.refund_allocation.getTime() > Date.parse("2020-01-01T00:00:00Z") &&
    clockCheck.kyb_submission.getTime() > Date.parse("2020-01-01T00:00:00Z");
  report(
    "recorded_at and created_at ignore the client value",
    serverClockWon,
    clockCheck ? `stored ${clockCheck.policy_event.toISOString()} instead of 2000-01-01` : "no row read",
  );

  // 5. Migration 0005: the database refuses a refund whose parts do not add up to the amount
  //    Stripe is asked for, and refuses a second cancellation of the same policy.
  const brokenSplit = await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    const [refundOperation] = await tx<{ id: string }[]>`
      insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key)
      values ('stripe_refund', 'stripe', 100, ${fixture.policies}, 'guard-check-split:' || gen_random_uuid()::text)
      returning id
    `;
    await tx`
      insert into refund_allocations (
        refund_operation_id, policy_id, policy_event_id, collection_operation_id, payment_intent_id,
        amount_cents, refunded_premium_cents, refunded_tax_cents, commission_clawback_cents
      ) values (
        ${refundOperation.id}, ${fixture.policies}, ${fixture.policy_events}, ${fixture.money_operations},
        'pi_guard_check_split', 100, 90, 5, 0
      )
    `;
  });
  report(
    "a refund whose premium and tax do not add up to its amount is refused",
    !!brokenSplit && /refund_allocations_check/i.test(brokenSplit),
    brokenSplit ?? "no error raised",
  );

  const secondCancellation = await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    for (const attempt of [1, 2]) {
      await tx`
        insert into policy_events (policy_id, event_type, effective_at, payload)
        values (${fixture.policies}, 'cancelled', '2028-06-09',
                ${tx.json({ attempt, calculation_method: "pro_rata" })})
      `;
    }
  });
  // 6. Migration 0006: a broker cannot submit the same verification twice. The key is derived
  //    from the broker and the attempt number, so a double-clicked form computes it twice and
  //    the second insert is refused instead of creating a second Stripe account.
  const secondSubmissionUnderTheSameKey = await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    for (const attempt of [1, 2]) {
      await tx`
        insert into broker_kyb_submissions (
          broker_id, provider, provider_idempotency_key, legal_name, ein_last4,
          address_line1, address_city, address_state, address_postal_code,
          business_url, contact_email, terms_accepted_at, terms_accepted_ip
        ) values (
          ${fixture.brokers}, 'stripe_connect', 'guard-check-double-submit:' || ${fixture.brokers},
          'Guard Check Brokerage LLC', ${String(attempt).padStart(4, "0")}, 'address_full_match',
          'San Francisco', 'CA', '94105', 'https://example.invalid/guard-check',
          'guard-check@example.invalid', '2026-09-08T12:00:00Z', '203.0.113.10'
        )
      `;
    }
  });
  report(
    "a second submission under the same idempotency key is refused",
    !!secondSubmissionUnderTheSameKey &&
      /broker_kyb_submissions_provider_idempotency_key_key/i.test(secondSubmissionUnderTheSameKey),
    secondSubmissionUnderTheSameKey ?? "no error raised",
  );

  report(
    "a policy cannot be cancelled twice",
    !!secondCancellation && /policy_events_one_cancellation_per_policy/i.test(secondCancellation),
    secondCancellation ?? "no error raised",
  );

  // 7. Migration 0009: a delta collection whose premium and tax do not add up is refused, and
  //    one endorsement request can be applied ('endorsed') at most once, whatever the number of
  //    payment deliveries that try.
  const brokenDeltaSplit = await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    const [requestEvent] = await tx<{ id: string }[]>`
      insert into policy_events (policy_id, event_type, effective_at, payload)
      values (${fixture.policies}, 'endorsement_requested', '2028-06-09', '{}'::jsonb)
      returning id
    `;
    const [deltaOperation] = await tx<{ id: string }[]>`
      insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key)
      values ('stripe_checkout', 'stripe', 100, ${fixture.policies}, 'guard-check-delta-split:' || gen_random_uuid()::text)
      returning id
    `;
    await tx`
      insert into endorsement_collections (
        collection_operation_id, policy_id, request_event_id, quote_hash, amount_cents, delta_premium_cents, delta_tax_cents
      ) values (${deltaOperation.id}, ${fixture.policies}, ${requestEvent.id}, 'guard-check-hash', 100, 90, 5)
    `;
  });
  report(
    "a delta collection whose premium and tax do not add up to its amount is refused",
    !!brokenDeltaSplit && /endorsement_collections_check/i.test(brokenDeltaSplit),
    brokenDeltaSplit ?? "no error raised",
  );

  const secondApplication = await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    const [requestEvent] = await tx<{ id: string }[]>`
      insert into policy_events (policy_id, event_type, effective_at, payload)
      values (${fixture.policies}, 'endorsement_requested', '2028-06-09', '{}'::jsonb)
      returning id
    `;
    for (const attempt of [1, 2]) {
      await tx`
        insert into policy_events (policy_id, event_type, effective_at, payload)
        values (${fixture.policies}, 'endorsed', '2028-06-09',
                ${tx.json({ attempt, request_event_id: requestEvent.id, annual_premium_cents: 180000 })})
      `;
    }
  });
  report(
    "an endorsement request cannot be applied twice",
    !!secondApplication && /policy_events_one_endorsement_per_request/i.test(secondApplication),
    secondApplication ?? "no error raised",
  );

  await owner.end();
  await runtime.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("check failed to run:", error instanceof Error ? error.message : error);
  process.exit(1);
});
