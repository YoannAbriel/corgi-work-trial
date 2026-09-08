import postgres from "postgres";

// Proves, on a real database, that the tables added by migrations 0002, 0004, 0005, 0006, 0008
// and 0011 are append-only, exactly the way scripts/check-ledger-guards.ts does it for the ledger
// core.
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
  // Added by migration 0008 (slice B7): claims, the money-out approval queue, and what the
  // simulated payout rail believes.
  "claims",
  "claim_events",
  "claimant_bank_accounts",
  "approval_requests",
  "approval_decisions",
  "simulator_provider_records",
  // Added by migration 0011 (slice B10): what each reconciliation run compared and what it found.
  // Protected for the same reason as webhook_events: they record what we knew about a provider at
  // a moment in time, and rewriting them would let a break disappear without anyone fixing it.
  "reconciliation_runs",
  "reconciliation_items",
  // Added by migration 0009 (slice B4): which Stripe payment collects which endorsement's delta.
  "endorsement_collections",
  // Added by migration 0012 (slice B9): the broker monthly statements. Protected because they are
  // what we told a broker they were owed: a correction after a closed month is a new revision,
  // never an edit of the revision that was published.
  "statement_runs",
  "statement_lines",
  // Added by migration 0018 (slice B11): the MCP API keys, their revocations and the log of every
  // call. Not money rows, protected all the same: they record who was allowed to ask what, and
  // what an agent actually asked. An UPDATE would let somebody re-point a key at another user, or
  // make a call disappear, after the fact.
  "mcp_api_keys",
  "mcp_key_revocations",
  "mcp_calls",
  // Added by migration 0014 (slice B8): which Stripe payment settles the difference a backdated
  // correction created.
  "correction_collections",
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
// a DELETE has something real to try to change. `journal_entries` is not in the list above (the
// ledger core has its own check, scripts/check-ledger-guards.ts) but a statement line has to name
// a real journal entry, so the fixture carries one.
type Fixture = { [table in ProtectedTable]: string } & { journal_entries: string };

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
  // Slice B7. Two demo users are needed because maker-checker is about two different people:
  // the one who asks and the one who decides.
  const [maker] = await tx<{ id: string }[]>`
    insert into users (email, display_name, role)
    values ('guard-maker-' || gen_random_uuid()::text || '@example.invalid', 'guard check maker', 'staff_ops')
    returning id
  `;
  const [checker] = await tx<{ id: string }[]>`
    insert into users (email, display_name, role)
    values ('guard-checker-' || gen_random_uuid()::text || '@example.invalid', 'guard check checker', 'staff_approver')
    returning id
  `;
  const [claim] = await tx<{ id: string }[]>`
    insert into claims (policy_id, occurred_at, reported_at, description, claimant_name)
    values (${policy.id}, '2028-05-01', '2028-05-02', 'guard check loss', 'guard check claimant')
    returning id
  `;
  const [claimPayout] = await tx<{ id: string }[]>`
    insert into money_operations (kind, provider, amount_cents, policy_id, claim_id, idempotency_key)
    values ('claim_payout', 'simulator', 120000, ${policy.id}, ${claim.id},
            'guard-check-payout:' || gen_random_uuid()::text)
    returning id
  `;
  const [claimEvent] = await tx<{ id: string }[]>`
    insert into claim_events (claim_id, event_type, amount_cents) values (${claim.id}, 'reserve_set', 500000)
    returning id
  `;
  const [bankAccount] = await tx<{ id: string }[]>`
    insert into claimant_bank_accounts (
      claim_id, account_holder_name, routing_number_last4, account_number_last4,
      account_token, verification_status, provider
    ) values (
      ${claim.id}, 'guard check claimant', '0000', '6789',
      'sim_ba_' || md5(gen_random_uuid()::text), 'verified', 'simulator'
    )
    returning id
  `;
  const [approvalRequest] = await tx<{ id: string }[]>`
    insert into approval_requests (kind, subject_kind, subject_id, amount_cents, intent_hash, destination, requested_by)
    values ('claim_payment', 'claim', ${claim.id}, 120000, repeat('a', 64), 'guard check destination', ${maker.id})
    returning id
  `;
  const [approvalDecision] = await tx<{ id: string }[]>`
    insert into approval_decisions (request_id, decided_by, decision)
    values (${approvalRequest.id}, ${checker.id}, 'approved')
    returning id
  `;
  const [providerRecord] = await tx<{ id: string }[]>`
    insert into simulator_provider_records (transfer_ref, amount_cents, destination_token, status, settlement_date)
    values ('sim_tr_' || md5(gen_random_uuid()::text), 120000, 'sim_ba_guard_check', 'sent', '2028-05-10')
    returning id
  `;
  void claimPayout;

  // Slice B10: one reconciliation run and one item of it. The amounts are the planted
  // provider-only break of scripts/check-reconciliation.ts, so the fixture reads like the real
  // thing.
  const [reconciliationRun] = await tx<{ id: string }[]>`
    insert into reconciliation_runs (
      source, window_from, window_to, started_at, status,
      provider_only_count, provider_record_count, ledger_record_count
    ) values (
      'stripe', '2026-09-01T00:00:00Z', '2026-09-08T00:00:00Z', now(), 'complete', 1, 1, 0
    )
    returning id
  `;
  const [reconciliationItem] = await tx<{ id: string }[]>`
    insert into reconciliation_items (
      run_id, classification, break_key, provider_ref, ledger_ref,
      provider_amount_cents, ledger_amount_cents, difference_cents, first_seen_at, note
    ) values (
      ${reconciliationRun.id}, 'provider_only', 'stripe|provider_only|pi_guard_check', 'pi_guard_check', null,
      4242, null, 4242, now(), 'guard check item, always rolled back'
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
  // Slice B9: one journal entry (the commission the statement is about), one statement run and
  // one of its lines. The entry is balanced because the deferred trigger of migration 0001 checks
  // it at commit, and because a fixture that could not exist would prove nothing.
  const [journalEntry] = await tx<{ id: string }[]>`
    insert into journal_entries
      (entry_type, effective_at, policy_id, broker_id, source_kind, source_id, description)
    values ('commission_earned', '2028-03-01', ${policy.id}, ${broker.id}, 'money_operation', ${operation.id},
            'guard check broker commission')
    returning id
  `;
  await tx`
    insert into journal_lines (entry_id, account_id, debit_cents, credit_cents) values
      (${journalEntry.id}, 'commission_expense', 18000, 0),
      (${journalEntry.id}, 'commission_payable', 0, 18000)
  `;
  const [statementRun] = await tx<{ id: string }[]>`
    insert into statement_runs (
      broker_id, statement_month, revision, knowledge_cutoff, content_hash,
      premium_collected_cents, commission_earned_cents, clawback_cents, adjustment_cents, net_due_cents
    ) values (
      ${broker.id}, '2028-03-01', 1, '2028-04-01T00:00:00Z', repeat('a', 64),
      125320, 18000, 0, 0, 18000
    )
    returning id
  `;
  const [statementLine] = await tx<{ id: string }[]>`
    insert into statement_lines (
      run_id, line_order, kind, policy_id, policy_number, journal_entry_id, effective_at,
      entry_recorded_at, amount_cents, description
    ) values (
      ${statementRun.id}, 0, 'commission_earned', ${policy.id}, 'CGP-00000', ${journalEntry.id}, '2028-03-01',
      '2028-03-01T10:00:00Z', 18000, 'guard check statement line'
    )
    returning id
  `;

  // Slice B11: one MCP API key, its revocation and one call made with it. The hash is a
  // plausible sha256 and not a real one: no key exists whose sha256 this is, and the fixture is
  // rolled back anyway.
  const [apiKey] = await tx<{ id: string }[]>`
    insert into mcp_api_keys (user_id, label, key_prefix, key_hash, principal_kind, created_by)
    values (${maker.id}, 'guard check key', 'cmk_' || substr(md5(gen_random_uuid()::text), 1, 8),
            encode(sha256(gen_random_uuid()::text::bytea), 'hex'), 'agent', ${maker.id})
    returning id
  `;
  const [keyRevocation] = await tx<{ id: string }[]>`
    insert into mcp_key_revocations (api_key_id, revoked_by, reason)
    values (${apiKey.id}, ${maker.id}, 'guard check revocation')
    returning id
  `;
  const [mcpCall] = await tx<{ id: string }[]>`
    insert into mcp_calls (api_key_id, method, tool, arguments_hash, outcome, detail, duration_ms)
    values (${apiKey.id}, 'tools/call', 'get_policy_as_of', repeat('b', 64), 'ok', null, 12)
    returning id
  `;

  // A correction of that endorsement's effective date, and the payment that settles the
  // difference it created (migration 0014). 5047 = 4931 of premium + 116 of tax, the recited
  // example: entered as 2028-07-09, corrected to 2028-06-09.
  const [rebookEvent] = await tx<{ id: string }[]>`
    insert into policy_events (policy_id, event_type, effective_at, payload)
    values (${policy.id}, 'correction_rebook', '2028-06-09',
            ${tx.json({ rebooked_event_type: "endorsed", corrects_event_id: requestEvent.id, delta_premium_cents: 43561 })})
    returning id
  `;
  const [differenceOperation] = await tx<{ id: string }[]>`
    insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key)
    values ('stripe_checkout', 'stripe', 5047, ${policy.id}, 'guard-check-correction:' || gen_random_uuid()::text)
    returning id
  `;
  const [correctionCollection] = await tx<{ id: string }[]>`
    insert into correction_collections (
      collection_operation_id, policy_id, correction_rebook_event_id, amount_cents, premium_cents, tax_cents
    ) values (
      ${differenceOperation.id}, ${policy.id}, ${rebookEvent.id}, 5047, 4931, 116
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
    claims: claim.id,
    claim_events: claimEvent.id,
    claimant_bank_accounts: bankAccount.id,
    approval_requests: approvalRequest.id,
    approval_decisions: approvalDecision.id,
    simulator_provider_records: providerRecord.id,
    reconciliation_runs: reconciliationRun.id,
    reconciliation_items: reconciliationItem.id,
    endorsement_collections: endorsementCollection.id,
    statement_runs: statementRun.id,
    statement_lines: statementLine.id,
    mcp_api_keys: apiKey.id,
    mcp_key_revocations: keyRevocation.id,
    mcp_calls: mcpCall.id,
    journal_entries: journalEntry.id,
    correction_collections: correctionCollection.id,
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

  // 7. Migration 0008: maker-checker is a DATABASE rule, not only application code.
  //    Every case below is attempted with the OWNER connection and raw SQL, which is the most
  //    privileged path there is: none of the application checks are in the way, and the
  //    decision is still refused.
  await runMakerCheckerChecks(owner);

  // 8. Migration 0008: a claim event has to say a coherent thing about money.
  await runClaimEventShapeChecks(owner);

  // 9. Migration 0011: a reconciliation run has to say a coherent thing about what it found.
  await runReconciliationShapeChecks(owner);

  // 10. Migration 0009: a delta collection whose premium and tax do not add up is refused, and
  //     one endorsement request can be applied ('endorsed') at most once, whatever the number
  //     of payment deliveries that try.
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
  // 9. Migration 0012: a broker statement has to say a coherent thing about a month.
  await runStatementShapeChecks(owner);

  await owner.end();
  await runtime.end();
  process.exit(failures === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Maker-checker, proved against the database itself (slice B7, migration 0008)
// ---------------------------------------------------------------------------

// Everything here runs as the OWNER, with plain SQL, in transactions that are rolled back. That
// is deliberate: the application refuses these things too, but a rule that only lives in the
// application can be walked around by a script, a console or a route written next month. What
// this section proves is that the DATABASE refuses them.
async function runMakerCheckerChecks(owner: postgres.Sql): Promise<void> {
  // A request asked for by one user, ready to be decided by whoever the case needs.
  async function requestAskedBy(tx: postgres.TransactionSql, requesterRole: string): Promise<{ requestId: string; requesterId: string }> {
    const fixture = await insertFixtureRows(tx);
    const [requester] = await tx<{ id: string }[]>`
      insert into users (email, display_name, role)
      values ('mc-requester-' || gen_random_uuid()::text || '@example.invalid', 'maker', ${requesterRole})
      returning id
    `;
    const [request] = await tx<{ id: string }[]>`
      insert into approval_requests (kind, subject_kind, subject_id, amount_cents, intent_hash, destination, requested_by)
      values ('claim_payment', 'claim', ${fixture.claims}, 324156, repeat('b', 64), 'a destination', ${requester.id})
      returning id
    `;
    return { requestId: request.id, requesterId: requester.id };
  }

  // 1. The initiator cannot approve their own money-out, even when they are a staff_approver.
  const selfApproval = await expectError(owner, async (tx) => {
    const { requestId, requesterId } = await requestAskedBy(tx, "staff_approver");
    await tx`
      insert into approval_decisions (request_id, decided_by, decision)
      values (${requestId}, ${requesterId}, 'approved')
    `;
  });
  report(
    "the person who asked cannot approve their own money-out",
    !!selfApproval && /cannot approve it/i.test(selfApproval),
    selfApproval ?? "no error raised",
  );

  // 2. Only a staff_approver may decide. Every other role in the system is refused, and that is
  //    the same branch that will refuse the 'agent' principals of the MCP surface in slice B11.
  for (const role of ["staff_ops", "broker", "customer"]) {
    const wrongRole = await expectError(owner, async (tx) => {
      const { requestId } = await requestAskedBy(tx, "staff_ops");
      const [decider] = await tx<{ id: string }[]>`
        insert into users (email, display_name, role)
        values ('mc-decider-' || gen_random_uuid()::text || '@example.invalid', 'not an approver', ${role})
        returning id
      `;
      await tx`
        insert into approval_decisions (request_id, decided_by, decision)
        values (${requestId}, ${decider.id}, 'approved')
      `;
    });
    report(
      `a user with the role ${role} cannot approve a money-out`,
      !!wrongRole && /only a staff_approver/i.test(wrongRole),
      wrongRole ?? "no error raised",
    );
  }

  // 3. An agent principal CAN exist since migration 0018 (slice B11) added 'agent' to the
  //    users.role CHECK, and the trigger checked above is what keeps refusing it as a decider,
  //    because it demands exactly 'staff_approver'. Until 0018 this check asserted the opposite
  //    (that the role could not be created at all), which was true of the schema at the time; the
  //    refusal it really cares about is the one below and in section 11.
  const agentPrincipalExists = await expectError(owner, async (tx) => {
    await tx`
      insert into users (email, display_name, role)
      values ('mc-agent-' || gen_random_uuid()::text || '@example.invalid', 'an MCP api key', 'agent')
    `;
  });
  report(
    "an 'agent' principal can be created, and section 11 proves the approver trigger refuses it",
    agentPrincipalExists === null,
    agentPrincipalExists ?? "created, as migration 0018 intends",
  );

  // 4. A decision by a user who does not exist at all.
  const unknownDecider = await expectError(owner, async (tx) => {
    const { requestId } = await requestAskedBy(tx, "staff_ops");
    await tx`
      insert into approval_decisions (request_id, decided_by, decision)
      values (${requestId}, gen_random_uuid(), 'approved')
    `;
  });
  // The trigger runs before the foreign key is checked, so the refusal comes with a readable
  // sentence rather than a constraint name. Either would be a refusal; this is the better one.
  report(
    "a decision by a user that does not exist is refused",
    !!unknownDecider && /(does not exist|violates foreign key constraint)/i.test(unknownDecider),
    unknownDecider ?? "no error raised",
  );

  // 5. One decision per request, forever: a rejected request is not re-decided, and two
  //    approvers racing cannot both write an answer.
  const secondDecision = await expectError(owner, async (tx) => {
    const { requestId } = await requestAskedBy(tx, "staff_ops");
    for (const decision of ["approved", "rejected"]) {
      const [approver] = await tx<{ id: string }[]>`
        insert into users (email, display_name, role)
        values ('mc-approver-' || gen_random_uuid()::text || '@example.invalid', 'approver', 'staff_approver')
        returning id
      `;
      await tx`
        insert into approval_decisions (request_id, decided_by, decision)
        values (${requestId}, ${approver.id}, ${decision})
      `;
    }
  });
  report(
    "a request can be decided only once",
    !!secondDecision && /approval_decisions_request_id_key/i.test(secondDecision),
    secondDecision ?? "no error raised",
  );

  // 6. A distinct staff_approver CAN decide: the guard refuses the wrong people, not everybody.
  let approvedByADifferentApprover = false;
  await expectError(owner, async (tx) => {
    const { requestId } = await requestAskedBy(tx, "staff_ops");
    const [approver] = await tx<{ id: string }[]>`
      insert into users (email, display_name, role)
      values ('mc-ok-' || gen_random_uuid()::text || '@example.invalid', 'a real approver', 'staff_approver')
      returning id
    `;
    await tx`
      insert into approval_decisions (request_id, decided_by, decision, reason)
      values (${requestId}, ${approver.id}, 'approved', 'checked against the file')
    `;
    approvedByADifferentApprover = true;
  });
  report(
    "a different staff_approver can approve it",
    approvedByADifferentApprover,
    approvedByADifferentApprover ? "the decision was accepted" : "the decision was refused",
  );

  // 7. One approval can fund at most one money operation: the "at most one financial effect"
  //    guarantee for concurrent executions, as a unique index.
  const twoOperationsOneApproval = await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    for (const attempt of [1, 2]) {
      await tx`
        insert into money_operations (kind, provider, amount_cents, policy_id, claim_id, idempotency_key, approval_request_id)
        values ('claim_payout', 'simulator', 120000, ${fixture.policies}, ${fixture.claims},
                'guard-check-approval:' || ${attempt} || ':' || gen_random_uuid()::text, ${fixture.approval_requests})
      `;
    }
  });
  report(
    "one approval can fund at most one money operation",
    !!twoOperationsOneApproval && /money_operations_one_per_approval_request/i.test(twoOperationsOneApproval),
    twoOperationsOneApproval ?? "no error raised",
  );

  // 8. One payment moves through each rail stage at most once.
  const twoSends = await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    const [payout] = await tx<{ id: string }[]>`
      insert into money_operations (kind, provider, amount_cents, policy_id, claim_id, idempotency_key)
      values ('claim_payout', 'simulator', 120000, ${fixture.policies}, ${fixture.claims},
              'guard-check-stage:' || gen_random_uuid()::text)
      returning id
    `;
    for (const attempt of [1, 2]) {
      void attempt;
      await tx`
        insert into claim_events (claim_id, event_type, amount_cents, money_operation_id)
        values (${fixture.claims}, 'payment_sent', 120000, ${payout.id})
      `;
    }
  });
  report(
    "a claim payment cannot be sent twice",
    !!twoSends && /claim_events_one_stage_per_payment/i.test(twoSends),
    twoSends ?? "no error raised",
  );

  // 9. The simulated bank cannot settle the same transfer twice either.
  const twoSettlements = await expectError(owner, async (tx) => {
    const transferRef = `sim_tr_guard_${Math.trunc(Number(process.pid))}`;
    for (const attempt of [1, 2]) {
      void attempt;
      await tx`
        insert into simulator_provider_records (transfer_ref, amount_cents, destination_token, status, settlement_date)
        values (${transferRef}, 120000, 'sim_ba_guard', 'settled', '2028-05-10')
      `;
    }
  });
  report(
    "the simulated rail cannot settle one transfer twice",
    !!twoSettlements && /simulator_provider_records_transfer_ref_status_key/i.test(twoSettlements),
    twoSettlements ?? "no error raised",
  );
}

// ---------------------------------------------------------------------------
// Claim events have to say a coherent thing about money (migration 0008)
// ---------------------------------------------------------------------------

async function runClaimEventShapeChecks(owner: postgres.Sql): Promise<void> {
  const closedWithAmount = await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    await tx`
      insert into claim_events (claim_id, event_type, amount_cents) values (${fixture.claims}, 'closed', 1)
    `;
  });
  report(
    "a 'closed' claim event cannot carry an amount",
    !!closedWithAmount && /claim_events_check/i.test(closedWithAmount),
    closedWithAmount ?? "no error raised",
  );

  const paymentWithoutOperation = await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    await tx`
      insert into claim_events (claim_id, event_type, amount_cents) values (${fixture.claims}, 'payment_sent', 120000)
    `;
  });
  report(
    "a payment event must name the money operation it is about",
    !!paymentWithoutOperation && /claim_events_check/i.test(paymentWithoutOperation),
    paymentWithoutOperation ?? "no error raised",
  );

  const reserveWithOperation = await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    await tx`
      insert into claim_events (claim_id, event_type, amount_cents, money_operation_id)
      values (${fixture.claims}, 'reserve_set', 500000, ${fixture.money_operations})
    `;
  });
  report(
    "a reserve event cannot name a money operation",
    !!reserveWithOperation && /claim_events_check/i.test(reserveWithOperation),
    reserveWithOperation ?? "no error raised",
  );

  const reportedBeforeItHappened = await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    await tx`
      insert into claims (policy_id, occurred_at, reported_at, description, claimant_name)
      values (${fixture.policies}, '2028-05-10', '2028-05-01', 'reported early', 'guard check claimant')
    `;
  });
  report(
    "a loss cannot be reported before it happened",
    !!reportedBeforeItHappened && /claims_check/i.test(reportedBeforeItHappened),
    reportedBeforeItHappened ?? "no error raised",
  );

  const badIntentHash = await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    const [requester] = await tx<{ id: string }[]>`
      insert into users (email, display_name, role)
      values ('hash-' || gen_random_uuid()::text || '@example.invalid', 'maker', 'staff_ops')
      returning id
    `;
    await tx`
      insert into approval_requests (kind, subject_kind, subject_id, amount_cents, intent_hash, destination, requested_by)
      values ('claim_payment', 'claim', ${fixture.claims}, 120000, 'not-a-sha256', 'somewhere', ${requester.id})
    `;
  });
  report(
    "an approval request must carry a real sha256 of its intent",
    !!badIntentHash && /approval_requests_intent_hash_check/i.test(badIntentHash),
    badIntentHash ?? "no error raised",
  );
}

// ---------------------------------------------------------------------------
// A reconciliation run cannot lie about what it found (migration 0011)
// ---------------------------------------------------------------------------

// The rule the brief states outright: an incomplete or failed fetch must never be reported as a
// clean reconciliation. The application enforces it (lib/reconciliation/run.ts stores no items on
// a failed run); these checks prove the DATABASE enforces it too, so no future code path, script
// or console session can write a failed run that also claims to have compared something.
async function runReconciliationShapeChecks(owner: postgres.Sql): Promise<void> {
  const failedRunWithCounts = await expectError(owner, async (tx) => {
    await tx`
      insert into reconciliation_runs (source, window_from, window_to, started_at, status, fetch_error, matched_count)
      values ('stripe', '2026-09-01T00:00:00Z', '2026-09-08T00:00:00Z', now(), 'failed', 'Stripe timed out', 3)
    `;
  });
  report(
    "a failed reconciliation run cannot carry counts: it compared nothing",
    !!failedRunWithCounts && /reconciliation_runs_check/i.test(failedRunWithCounts),
    failedRunWithCounts ?? "no error raised",
  );

  const failedRunWithoutReason = await expectError(owner, async (tx) => {
    await tx`
      insert into reconciliation_runs (source, window_from, window_to, started_at, status)
      values ('stripe', '2026-09-01T00:00:00Z', '2026-09-08T00:00:00Z', now(), 'failed')
    `;
  });
  report(
    "a failed reconciliation run must say why it failed",
    !!failedRunWithoutReason && /reconciliation_runs_check/i.test(failedRunWithoutReason),
    failedRunWithoutReason ?? "no error raised",
  );

  const completeRunWithAnError = await expectError(owner, async (tx) => {
    await tx`
      insert into reconciliation_runs (source, window_from, window_to, started_at, status, fetch_error)
      values ('stripe', '2026-09-01T00:00:00Z', '2026-09-08T00:00:00Z', now(), 'complete', 'Stripe timed out')
    `;
  });
  report(
    "a complete reconciliation run cannot carry a fetch error",
    !!completeRunWithAnError && /reconciliation_runs_check/i.test(completeRunWithAnError),
    completeRunWithAnError ?? "no error raised",
  );

  const emptyWindow = await expectError(owner, async (tx) => {
    await tx`
      insert into reconciliation_runs (source, window_from, window_to, started_at, status)
      values ('stripe', '2026-09-08T00:00:00Z', '2026-09-01T00:00:00Z', now(), 'complete')
    `;
  });
  report(
    "a reconciliation run cannot cover an empty window",
    !!emptyWindow && /reconciliation_runs_check/i.test(emptyWindow),
    emptyWindow ?? "no error raised",
  );

  const unknownSource = await expectError(owner, async (tx) => {
    await tx`
      insert into reconciliation_runs (source, window_from, window_to, started_at, status)
      values ('some_other_bank', '2026-09-01T00:00:00Z', '2026-09-08T00:00:00Z', now(), 'complete')
    `;
  });
  report(
    "a reconciliation run names one of the two known sources",
    !!unknownSource && /reconciliation_runs_source_check/i.test(unknownSource),
    unknownSource ?? "no error raised",
  );

  // The finishing time of a run and the recording time of its items come from the database clock,
  // so the age of a break cannot be backdated by whoever writes the run.
  let storedTimes: { finished_at: Date; recorded_at: Date } | null = null;
  await expectError(owner, async (tx) => {
    const [run] = await tx<{ id: string; finished_at: Date }[]>`
      insert into reconciliation_runs (source, window_from, window_to, started_at, status, finished_at)
      values ('stripe', '2026-09-01T00:00:00Z', '2026-09-08T00:00:00Z', now(), 'complete', '2000-01-01T00:00:00Z')
      returning id, finished_at
    `;
    const [item] = await tx<{ recorded_at: Date }[]>`
      insert into reconciliation_items (run_id, classification, break_key, first_seen_at, note, recorded_at, provider_ref)
      values (${run.id}, 'provider_only', 'stripe|provider_only|pi_clock', now(), 'guard check', '2000-01-01T00:00:00Z', 'pi_clock')
      returning recorded_at
    `;
    storedTimes = { finished_at: run.finished_at, recorded_at: item.recorded_at };
  });
  const reconciliationClock = storedTimes as { finished_at: Date; recorded_at: Date } | null;
  report(
    "a reconciliation run and its items are timed by the database, not by the client",
    reconciliationClock !== null &&
      reconciliationClock.finished_at.getTime() > Date.parse("2020-01-01T00:00:00Z") &&
      reconciliationClock.recorded_at.getTime() > Date.parse("2020-01-01T00:00:00Z"),
    reconciliationClock ? `stored ${reconciliationClock.finished_at.toISOString()} instead of 2000-01-01` : "no row read",
  );
}

// ---------------------------------------------------------------------------
// A broker statement cannot lie about a month (migration 0012)
// ---------------------------------------------------------------------------

// The statement rules the application enforces (lib/statements/run.ts) written as database facts,
// so no future script, console session or route can publish a statement that says something the
// ledger does not: a whole month, a revision that names what it replaces, and a net due that is
// exactly what was earned less what was clawed back.
async function runStatementShapeChecks(owner: postgres.Sql): Promise<void> {
  // A run for "the middle of March" is not a monthly statement.
  const middleOfTheMonth = await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    await tx`
      insert into statement_runs (
        broker_id, statement_month, revision, knowledge_cutoff, content_hash,
        premium_collected_cents, commission_earned_cents, clawback_cents, adjustment_cents, net_due_cents
      ) values (
        ${fixture.brokers}, '2028-03-15', 1, now(), repeat('b', 64), 0, 0, 0, 0, 0
      )
    `;
  });
  report(
    "a statement covers a whole month, named by its first day",
    !!middleOfTheMonth && /statement_runs_statement_month_check/i.test(middleOfTheMonth),
    middleOfTheMonth ?? "no error raised",
  );

  // The arithmetic of the statement: net due IS earned less clawed back, plus any adjustment.
  const netDueThatDoesNotAddUp = await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    await tx`
      insert into statement_runs (
        broker_id, statement_month, revision, knowledge_cutoff, content_hash,
        premium_collected_cents, commission_earned_cents, clawback_cents, adjustment_cents, net_due_cents
      ) values (
        ${fixture.brokers}, '2028-04-01', 1, now(), repeat('c', 64), 125320, 18000, 13068, 0, 18000
      )
    `;
  });
  report(
    "a statement whose net due is not what was earned less what was clawed back is refused",
    !!netDueThatDoesNotAddUp && /statement_runs_check/i.test(netDueThatDoesNotAddUp),
    netDueThatDoesNotAddUp ?? "no error raised",
  );

  // Revision 1 replaces nothing, and every later revision replaces exactly one earlier run.
  const revisionTwoReplacingNothing = await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    await tx`
      insert into statement_runs (
        broker_id, statement_month, revision, knowledge_cutoff, supersedes_run_id, content_hash,
        premium_collected_cents, commission_earned_cents, clawback_cents, adjustment_cents, net_due_cents
      ) values (
        ${fixture.brokers}, '2028-05-01', 2, now(), null, repeat('d', 64), 0, 0, 0, 0, 0
      )
    `;
  });
  report(
    "a second revision must name the revision it supersedes",
    !!revisionTwoReplacingNothing && /statement_runs_check/i.test(revisionTwoReplacingNothing),
    revisionTwoReplacingNothing ?? "no error raised",
  );

  const revisionOneReplacingSomething = await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    await tx`
      insert into statement_runs (
        broker_id, statement_month, revision, knowledge_cutoff, supersedes_run_id, content_hash,
        premium_collected_cents, commission_earned_cents, clawback_cents, adjustment_cents, net_due_cents
      ) values (
        ${fixture.brokers}, '2028-05-01', 1, now(), ${fixture.statement_runs}, repeat('e', 64), 0, 0, 0, 0, 0
      )
    `;
  });
  report(
    "the first revision of a month supersedes nothing",
    !!revisionOneReplacingSomething && /statement_runs_check/i.test(revisionOneReplacingSomething),
    revisionOneReplacingSomething ?? "no error raised",
  );

  // Two runs cannot both be revision N of the same month: this is what stops two people closing
  // the same month at the same instant and both believing they published it.
  const twoRunsSameRevision = await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    await tx`
      insert into statement_runs (
        broker_id, statement_month, revision, knowledge_cutoff, content_hash,
        premium_collected_cents, commission_earned_cents, clawback_cents, adjustment_cents, net_due_cents
      ) values (
        ${fixture.brokers}, '2028-03-01', 1, now(), repeat('f', 64), 0, 0, 0, 0, 0
      )
    `;
  });
  report(
    "a broker and a month have one revision 1, forever",
    !!twoRunsSameRevision && /statement_runs_broker_id_statement_month_revision_key/i.test(twoRunsSameRevision),
    twoRunsSameRevision ?? "no error raised",
  );

  const contentHashThatIsNotOne = await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    await tx`
      insert into statement_runs (
        broker_id, statement_month, revision, knowledge_cutoff, content_hash,
        premium_collected_cents, commission_earned_cents, clawback_cents, adjustment_cents, net_due_cents
      ) values (
        ${fixture.brokers}, '2028-06-01', 1, now(), 'not-a-sha256', 0, 0, 0, 0, 0
      )
    `;
  });
  report(
    "a statement run must carry a real sha256 of its lines",
    !!contentHashThatIsNotOne && /statement_runs_content_hash_check/i.test(contentHashThatIsNotOne),
    contentHashThatIsNotOne ?? "no error raised",
  );

  // The moment a statement was produced comes from the database, so a run cannot be backdated to
  // look like it was published before a correction it does not contain.
  let storedTimes: { created_at: Date; recorded_at: Date } | null = null;
  await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    const [run] = await tx<{ id: string; created_at: Date }[]>`
      insert into statement_runs (
        broker_id, statement_month, revision, knowledge_cutoff, content_hash,
        premium_collected_cents, commission_earned_cents, clawback_cents, adjustment_cents, net_due_cents,
        created_at
      ) values (
        ${fixture.brokers}, '2028-07-01', 1, now(), repeat('1', 64), 0, 0, 0, 0, 0, '2000-01-01T00:00:00Z'
      )
      returning id, created_at
    `;
    const [line] = await tx<{ recorded_at: Date }[]>`
      insert into statement_lines (
        run_id, line_order, kind, journal_entry_id, effective_at, entry_recorded_at, amount_cents,
        description, recorded_at
      ) values (
        ${run.id}, 0, 'adjustment', ${fixture.journal_entries}, '2028-07-01', now(), 1, 'clock check',
        '2000-01-01T00:00:00Z'
      )
      returning recorded_at
    `;
    storedTimes = { created_at: run.created_at, recorded_at: line.recorded_at };
  });
  const statementClock = storedTimes as { created_at: Date; recorded_at: Date } | null;
  report(
    "a statement run and its lines are timed by the database, not by the client",
    statementClock !== null &&
      statementClock.created_at.getTime() > Date.parse("2020-01-01T00:00:00Z") &&
      statementClock.recorded_at.getTime() > Date.parse("2020-01-01T00:00:00Z"),
    statementClock ? `stored ${statementClock.created_at.toISOString()} instead of 2000-01-01` : "no row read",
  );

  // 11. Migration 0018 (slice B11): what the MCP surface may and may not be given.

  // An agent principal must never hold the visibility of the one role that can approve money out.
  // The endpoint exposes no approve tool at all; this is the door closed from the other side.
  const agentKeyForAnApprover = await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    const [approver] = await tx<{ id: string }[]>`
      select decided_by as id from approval_decisions where id = ${fixture.approval_decisions}
    `;
    await tx`
      insert into mcp_api_keys (user_id, label, key_prefix, key_hash, principal_kind)
      values (${approver.id}, 'guard check agent key for an approver', 'cmk_00000000', repeat('c', 64), 'agent')
    `;
  });
  report(
    "an AGENT MCP key cannot be created for a staff_approver",
    !!agentKeyForAnApprover && /agent principal cannot hold a staff_approver key/.test(agentKeyForAnApprover),
    agentKeyForAnApprover ?? "no error raised",
  );

  // The same key for the same person, held by a person rather than by an agent, is fine: the rule
  // is about who holds it, not about who it belongs to.
  const humanKeyForAnApprover = await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    const [approver] = await tx<{ id: string }[]>`
      select decided_by as id from approval_decisions where id = ${fixture.approval_decisions}
    `;
    await tx`
      insert into mcp_api_keys (user_id, label, key_prefix, key_hash, principal_kind)
      values (${approver.id}, 'guard check human key for an approver', 'cmk_00000001', repeat('d', 64), 'human')
    `;
  });
  report(
    "a HUMAN MCP key for a staff_approver is allowed: the rule is about who holds the key",
    humanKeyForAnApprover === null,
    humanKeyForAnApprover ?? "accepted, as it should be",
  );

  // A key is revoked once. A second revocation would make "when was it revoked" ambiguous, and
  // no row here can be updated to settle it.
  const revokedTwice = await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    await tx`
      insert into mcp_key_revocations (api_key_id, reason) values (${fixture.mcp_api_keys}, 'a second revocation')
    `;
  });
  report(
    "an MCP key can be revoked only once",
    !!revokedTwice && /mcp_key_revocations_api_key_id_key/.test(revokedTwice),
    revokedTwice ?? "no error raised",
  );

  // The role 'agent' exists, and the maker-checker trigger of 0008 refuses it, which is the
  // promise that migration wrote down before slice B11 existed.
  const agentRoleDecides = await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    const [agent] = await tx<{ id: string }[]>`
      insert into users (email, display_name, role)
      values ('guard-agent-' || gen_random_uuid()::text || '@example.invalid', 'guard check agent', 'agent')
      returning id
    `;
    const [request] = await tx<{ id: string }[]>`
      select id from approval_requests where id = ${fixture.approval_requests}
    `;
    await tx`
      insert into approval_decisions (request_id, decided_by, decision)
      values (${request.id}, ${agent.id}, 'approved')
    `;
  });
  report(
    "a user with the role 'agent' exists and CANNOT decide a money-out",
    !!agentRoleDecides && /maker-checker: only a staff_approver/.test(agentRoleDecides),
    agentRoleDecides ?? "no error raised",
  );

  // When a call was made comes from the database: a call log a caller could backdate would be
  // worth nothing during an incident.
  let mcpClock: Date | null = null;
  await expectError(owner, async (tx) => {
    const fixture = await insertFixtureRows(tx);
    const [call] = await tx<{ called_at: Date }[]>`
      insert into mcp_calls (api_key_id, method, outcome, duration_ms, called_at)
      values (${fixture.mcp_api_keys}, 'tools/list', 'ok', 3, '2000-01-01T00:00:00Z')
      returning called_at
    `;
    mcpClock = call.called_at;
  });
  const mcpCallTime = mcpClock as Date | null;
  report(
    "an MCP call is timed by the database, not by the caller",
    mcpCallTime !== null && mcpCallTime.getTime() > Date.parse("2020-01-01T00:00:00Z"),
    mcpCallTime ? `stored ${mcpCallTime.toISOString()} instead of 2000-01-01` : "no row read",
  );
}

main().catch((error) => {
  console.error("check failed to run:", error instanceof Error ? error.message : error);
  process.exit(1);
});
