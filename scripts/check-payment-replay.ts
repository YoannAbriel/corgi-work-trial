import postgres from "postgres";

// Proves, against a real database, the property the whole payment flow depends on:
//
//   delivering the same successful payment twice posts the money ONCE.
//
// It runs the production function (lib/payments/collection.ts) twice on the same money
// operation and then counts what is in the journal. The second call must come back as
// "already_posted", because the journal's unique index refuses the second set of entries.
//
// It commits rows, so it refuses to run anywhere but the disposable database corgi_test:
// financial rows can never be deleted (AF-03), and the trial ledger must stay clean.
// Run with: npm run check:payment-replay

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on the environment
}

// Two connections, as in production: the owner creates the fixtures (a broker cannot be
// inserted by the application), and the runtime role runs the payment code, so the check also
// proves that posting works with the restricted privileges the deployed app actually has.
const ownerUrl = process.env.DATABASE_URL_TEST;
const runtimeUrl = process.env.DATABASE_URL_TEST_APP;
if (!ownerUrl || !runtimeUrl) {
  console.error("DATABASE_URL_TEST and DATABASE_URL_TEST_APP must be set: this check only runs on the disposable database");
  process.exit(1);
}

// The recited example (DECISIONS.md): $1,200 premium, California 2.35% = 2820, $25 fee.
const ANNUAL_PREMIUM_CENTS = 120000;
const TAX_CENTS = 2820;
const FEE_CENTS = 2500;
const TOTAL_CHARGE_CENTS = 125320;
const COMMISSION_CENTS = 18000; // 15% of the collected premium
const TERM_START = "2028-03-01";

let failures = 0;
function report(name: string, passed: boolean, detail: string) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}  (${detail})`);
  if (!passed) failures += 1;
}

const owner = postgres(ownerUrl, { max: 2, prepare: false });
const runtime = postgres(runtimeUrl, { max: 2, prepare: false });

async function main() {
  // Imported here rather than at the top of the file: lib/payments/collection.ts opens the
  // application connection pool as soon as it is loaded, which needs .env.local read first.
  const { recordSuccessfulPayment } = await import("@/lib/payments/collection");

  const [{ current_database: databaseName }] = await owner<{ current_database: string }[]>`
    select current_database()
  `;
  if (databaseName !== "corgi_test") {
    console.error(`refusing to run: connected to "${databaseName}", expected the disposable database "corgi_test"`);
    process.exit(1);
  }

  // A fresh policy, quoted and awaiting payment, exactly as the application would leave it.
  const { policyId, operationId } = await createPolicyAwaitingPayment();

  const payment = {
    operationId,
    paymentIntentId: `pi_replay_check_${operationId.slice(0, 8)}`,
    amountReceivedCents: TOTAL_CHARGE_CENTS,
    paidOn: TERM_START,
  };

  const first = await recordSuccessfulPayment(payment, runtime);
  report("the first delivery posts the money", first.kind === "posted", `outcome: ${first.kind}`);

  const second = await recordSuccessfulPayment(payment, runtime);
  report(
    "the second delivery of the same payment is recognised as already posted",
    second.kind === "already_posted",
    `outcome: ${second.kind}`,
  );

  // What is actually in the journal after two deliveries.
  const entries = await owner<{ entry_type: string; count: string }[]>`
    select entry_type, count(*)::text as count
      from journal_entries
     where source_kind = 'money_operation' and source_id = ${operationId}
     group by entry_type
     order by entry_type
  `;
  const byType = new Map(entries.map((row) => [row.entry_type, Number(row.count)]));
  report(
    "exactly four entries exist, one of each type",
    entries.length === 4 && entries.every((row) => row.count === "1"),
    entries.map((row) => `${row.entry_type} x${row.count}`).join(", ") || "no entry",
  );
  report(
    "the entry types are the four issuance and collection entries",
    ["premium_written", "tax_and_fee_billed", "premium_collected", "commission_earned"].every((type) =>
      byType.has(type),
    ),
    [...byType.keys()].join(", "),
  );

  // The amounts, account by account, must be the recited ones.
  const balances = await owner<{ account_id: string; debit: string; credit: string }[]>`
    select line.account_id,
           coalesce(sum(line.debit_cents), 0)::text  as debit,
           coalesce(sum(line.credit_cents), 0)::text as credit
      from journal_lines line
      join journal_entries entry on entry.id = line.entry_id
     where entry.source_kind = 'money_operation' and entry.source_id = ${operationId}
     group by line.account_id
     order by line.account_id
  `;
  const amountOn = (accountId: string, side: "debit" | "credit") =>
    Number(balances.find((row) => row.account_id === accountId)?.[side] ?? "-1");

  report("cash at Stripe is debited once with the whole charge", amountOn("cash_stripe", "debit") === TOTAL_CHARGE_CENTS, `${amountOn("cash_stripe", "debit")} cents`);
  report("unearned premium is credited with the written premium", amountOn("unearned_premium", "credit") === ANNUAL_PREMIUM_CENTS, `${amountOn("unearned_premium", "credit")} cents`);
  report("the state premium tax is separated from the premium", amountOn("premium_tax_payable", "credit") === TAX_CENTS, `${amountOn("premium_tax_payable", "credit")} cents`);
  report("the policy fee is income at issuance", amountOn("fee_income", "credit") === FEE_CENTS, `${amountOn("fee_income", "credit")} cents`);
  report("the broker commission is 15% of the collected premium", amountOn("commission_payable", "credit") === COMMISSION_CENTS, `${amountOn("commission_payable", "credit")} cents`);
  report(
    "the receivable opened by the billing entries is fully cleared",
    amountOn("premium_receivable", "debit") === TOTAL_CHARGE_CENTS && amountOn("premium_receivable", "credit") === TOTAL_CHARGE_CENTS,
    `debit ${amountOn("premium_receivable", "debit")} = credit ${amountOn("premium_receivable", "credit")}`,
  );

  const [totals] = await owner<{ debit: string; credit: string }[]>`
    select coalesce(sum(line.debit_cents), 0)::text as debit, coalesce(sum(line.credit_cents), 0)::text as credit
      from journal_lines line
      join journal_entries entry on entry.id = line.entry_id
     where entry.source_kind = 'money_operation' and entry.source_id = ${operationId}
  `;
  report("the four entries balance", totals.debit === totals.credit, `debits ${totals.debit} = credits ${totals.credit}`);

  // The policy is bound exactly once, whatever the number of deliveries.
  const issuances = await owner<{ count: string }[]>`
    select count(*)::text as count from policy_events where policy_id = ${policyId} and event_type = 'issued'
  `;
  report("the policy was issued exactly once", issuances[0].count === "1", `${issuances[0].count} issuance event(s)`);

  const [current] = await owner<{ status: string }[]>`
    select status from policy_current where policy_id = ${policyId}
  `;
  report("the policy shows as bound", current.status === "bound", `status: ${current.status}`);

  const successes = await owner<{ count: string }[]>`
    select count(*)::text as count from money_operation_events where operation_id = ${operationId} and status = 'succeeded'
  `;
  report("one success event was appended, not two", successes[0].count === "1", `${successes[0].count} succeeded event(s)`);

  // F-B2-19: and that is now a fact of the database, not a race the application usually wins.
  // Two deliveries in flight at the same moment cannot see each other's uncommitted row, so the
  // partial unique index of migration 0013 is what refuses the second one. Written straight to
  // the table with the runtime role, which is what a losing concurrent delivery would attempt.
  const secondSuccess = await runtime`
    insert into money_operation_events (operation_id, status, provider_ref, payload)
    values (${operationId}, 'succeeded', ${payment.paymentIntentId}, '{}'::jsonb)
  `
    .then(() => "the insert went through")
    .catch((error: { code?: string; constraint_name?: string }) => `${error.code} ${error.constraint_name ?? ""}`.trim());
  report(
    "the database itself refuses a second success row for the same operation",
    secondSuccess.startsWith("23505"),
    secondSuccess,
  );

  // A payment whose amount is not the amount we asked for is refused instead of posted.
  const wrongAmount = await recordSuccessfulPayment({ ...payment, amountReceivedCents: 999 }, runtime);
  report(
    "a payment for another amount is refused, not journaled",
    wrongAmount.kind === "refused",
    wrongAmount.kind === "refused" ? wrongAmount.reason : wrongAmount.kind,
  );

  await checkExpiredSessionStartsANewAttempt();
  await checkAPaymentOnAVoidedPolicyIsRefused();

  await owner.end();
  await runtime.end();
  process.exit(failures === 0 ? 0 : 1);
}

// An expired hosted page cannot be paid, so the next click on Pay must open a NEW session under
// a NEW idempotency key. Reusing the key would make Stripe hand the dead session back and the
// broker would be stuck on a page nobody can pay (review finding F-B2-03).
//
// This is the one check that calls Stripe for real: it creates two test-mode Checkout Sessions.
// No money moves, and the sandbox guard runs before each call.
async function checkExpiredSessionStartsANewAttempt(): Promise<void> {
  const { startCheckout } = await import("@/lib/payments/checkout");
  const { recordExpiredCheckoutSession } = await import("@/lib/payments/collection");

  const draft = await createPolicyReadyToPay();
  const firstUrl = await startCheckout(
    { policyId: draft.policyId, brokerId: draft.brokerId, userId: draft.userId },
    runtime,
  );
  const sameUrl = await startCheckout(
    { policyId: draft.policyId, brokerId: draft.brokerId, userId: draft.userId },
    runtime,
  );
  report("clicking Pay twice reuses the same hosted page", firstUrl === sameUrl, `one session: ${firstUrl === sameUrl}`);

  const attemptsBeforeExpiry = await checkoutAttempts(draft.policyId);
  report(
    "one payment attempt exists so far, under the first key",
    attemptsBeforeExpiry.length === 1 && attemptsBeforeExpiry[0].idempotency_key === `policy-checkout:${draft.policyId}`,
    attemptsBeforeExpiry.map((attempt) => attempt.idempotency_key).join(", "),
  );

  const expiry = await recordExpiredCheckoutSession(
    { operationId: attemptsBeforeExpiry[0].id, sessionId: attemptsBeforeExpiry[0].session_id ?? "cs_unknown" },
    runtime,
  );
  report("checkout.session.expired is recorded on the operation", expiry.kind === "posted", `outcome: ${expiry.kind}`);
  report(
    "an expired session posts no journal entry: no money moved",
    (await countEntriesOfPolicy(draft.policyId)) === 0,
    `${await countEntriesOfPolicy(draft.policyId)} journal entries`,
  );

  const newUrl = await startCheckout(
    { policyId: draft.policyId, brokerId: draft.brokerId, userId: draft.userId },
    runtime,
  );
  const attemptsAfterExpiry = await checkoutAttempts(draft.policyId);
  report(
    "after the expiry, a new Pay click opens a SECOND session",
    newUrl !== firstUrl && attemptsAfterExpiry.length === 2,
    `${attemptsAfterExpiry.length} attempt(s), new hosted page: ${newUrl !== firstUrl}`,
  );
  report(
    "the second attempt has its own idempotency key",
    attemptsAfterExpiry[1].idempotency_key === `policy-checkout:${draft.policyId}:2` &&
      attemptsAfterExpiry[0].idempotency_key !== attemptsAfterExpiry[1].idempotency_key,
    attemptsAfterExpiry.map((attempt) => attempt.idempotency_key).join(", "),
  );
  report(
    "the two attempts are two different Stripe sessions",
    !!attemptsAfterExpiry[0].session_id &&
      !!attemptsAfterExpiry[1].session_id &&
      attemptsAfterExpiry[0].session_id !== attemptsAfterExpiry[1].session_id,
    `${attemptsAfterExpiry[0].session_id} then ${attemptsAfterExpiry[1].session_id}`,
  );
}

// After a void, the money that arrives must never be swallowed (review finding F-B2-13).
//
// A void reverses the four entries and supersedes the issuance, but it deletes nothing: the
// original entries and the superseded 'issued' row are still in the database. Two payments can
// still arrive afterwards, and before this check both of them ended as "already posted", which
// told Stripe to stop retrying while the ledger held nothing:
//
//   1. the SAME operation delivered again. Its entries exist, so the journal's unique key
//      refuses the insert, even though the ledger no longer holds that money.
//   2. a payment on a SECOND attempt. Its entries are new and insert fine, and then the
//      one-issuance index refuses the issuance because the superseded row is still there, so
//      the whole transaction rolls back and nothing of that payment is journaled.
//
// Both must now be refused, with the correction named, so the delivery lands in the inbox as
// ignored and visible. And a voided policy must not be able to open a hosted page at all.
async function checkAPaymentOnAVoidedPolicyIsRefused(): Promise<void> {
  const { recordSuccessfulPayment } = await import("@/lib/payments/collection");
  const { voidFabricatedBinding } = await import("@/lib/policy/void-fabricated-binding");
  const { startCheckout, CheckoutRefused } = await import("@/lib/payments/checkout");

  const { policyId, operationId } = await createPolicyAwaitingPayment();
  const payment = {
    operationId,
    paymentIntentId: `pi_void_check_${operationId.slice(0, 8)}`,
    amountReceivedCents: TOTAL_CHARGE_CENTS,
    paidOn: TERM_START,
  };
  const posted = await recordSuccessfulPayment(payment, runtime);
  report("the policy to be voided is paid and bound first", posted.kind === "posted", `outcome: ${posted.kind}`);

  // The same void the operations team runs, with the same guard: Stripe is asked whether the
  // payment intent exists, and this one never did.
  const actorUserId = await createOperationsUser();
  const voided = await voidFabricatedBinding(
    { policyId, reason: "replay check: this payment intent never existed at Stripe", actorUserId },
    runtime,
  );
  report(
    "the void reverses every entry of the operation",
    voided.reversedEntryIds.length === 4,
    `${voided.reversedEntryIds.length} reversal entries, correction event ${voided.correctionEventId}`,
  );
  const statusAfterVoid = await policyStatus(policyId);
  report(
    "the voided policy shows as voided, not as payment_failed",
    statusAfterVoid === "voided",
    `status: ${statusAfterVoid}`,
  );

  // 1. The same delivery again.
  const redelivered = await recordSuccessfulPayment(payment, runtime);
  report(
    "a payment redelivered on a voided operation is refused, not accepted as already posted",
    redelivered.kind === "refused" && redelivered.reason.includes(voided.correctionEventId),
    redelivered.kind === "refused" ? redelivered.reason : `outcome: ${redelivered.kind}`,
  );

  // 2. A payment on a second attempt, created exactly as lib/payments/checkout.ts creates one.
  const secondAttemptId = await createSecondCheckoutAttempt(policyId);
  const secondPayment = {
    operationId: secondAttemptId,
    paymentIntentId: `pi_void_check_attempt2_${secondAttemptId.slice(0, 8)}`,
    amountReceivedCents: TOTAL_CHARGE_CENTS,
    paidOn: TERM_START,
  };
  const onSecondAttempt = await recordSuccessfulPayment(secondPayment, runtime);
  report(
    "a payment on a second attempt after a void is refused, not accepted as already posted",
    onSecondAttempt.kind === "refused" && onSecondAttempt.reason.includes(voided.correctionEventId),
    onSecondAttempt.kind === "refused" ? onSecondAttempt.reason : `outcome: ${onSecondAttempt.kind}`,
  );
  const entriesUnderAttemptTwo = await countEntriesOfOperation(secondAttemptId);
  report(
    "nothing of that second payment was journaled",
    entriesUnderAttemptTwo === 0,
    `${entriesUnderAttemptTwo} entries under attempt 2`,
  );

  // 3. And the hosted page cannot be opened again in the first place.
  const [broker] = await owner<{ broker_id: string }[]>`select broker_id from policies where id = ${policyId}`;
  let checkoutRefusal = "no refusal";
  try {
    await startCheckout({ policyId, brokerId: broker.broker_id, userId: actorUserId }, runtime);
  } catch (error) {
    checkoutRefusal = error instanceof CheckoutRefused ? error.message : `unexpected error: ${String(error)}`;
  }
  report("a voided policy cannot start a new payment", checkoutRefusal.includes("voided by a correction"), checkoutRefusal);
}

// The second money operation a broker would get by clicking Pay again: same policy, new id,
// new derived idempotency key (lib/money/idempotency.ts).
async function createSecondCheckoutAttempt(policyId: string): Promise<string> {
  return owner.begin(async (transaction) => {
    const [operation] = await transaction<{ id: string }[]>`
      insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key)
      values ('stripe_checkout', 'stripe', ${TOTAL_CHARGE_CENTS}, ${policyId},
              'policy-checkout:' || ${policyId} || ':2')
      returning id
    `;
    await transaction`
      insert into money_operation_events (operation_id, status) values (${operation.id}, 'requested')
    `;
    return operation.id;
  });
}

// A real staff operations user, because a correction records who ordered it.
async function createOperationsUser(): Promise<string> {
  const [user] = await owner<{ id: string }[]>`
    insert into users (email, display_name, role)
    values ('void-check-' || gen_random_uuid()::text || '@example.invalid', 'Void check operator', 'staff_ops')
    returning id
  `;
  return user.id;
}

async function policyStatus(policyId: string): Promise<string> {
  const [row] = await owner<{ status: string }[]>`select status from policy_current where policy_id = ${policyId}`;
  return row ? row.status : "no cache row";
}

async function countEntriesOfOperation(operationId: string): Promise<number> {
  const [row] = await owner<{ count: string }[]>`
    select count(*)::text as count from journal_entries
     where source_kind = 'money_operation' and source_id = ${operationId}
  `;
  return Number(row.count);
}

// A quoted policy whose broker is approved, ready for a first click on Pay.
async function createPolicyReadyToPay(): Promise<{ policyId: string; brokerId: string; userId: string }> {
  return owner.begin(async (transaction) => {
    const [broker] = await transaction<{ id: string }[]>`
      insert into brokers (name, commission_rate_bps) values ('Expiry check broker', 1500) returning id
    `;
    await transaction`
      insert into broker_kyb_events (broker_id, provider, status)
      values (${broker.id}, 'seed', 'approved')
    `;
    const [customer] = await transaction<{ id: string }[]>`
      insert into customers (name, email)
      values ('Expiry check customer', 'expiry-check-' || gen_random_uuid()::text || '@example.invalid')
      returning id
    `;
    const [policy] = await transaction<{ id: string }[]>`
      insert into policies (broker_id, customer_id, state_code) values (${broker.id}, ${customer.id}, 'CA') returning id
    `;
    await transaction`
      insert into policy_events (policy_id, event_type, effective_at, payload)
      values (${policy.id}, 'quoted', ${TERM_START}, ${transaction.json({
        state_code: "CA",
        term_start: TERM_START,
        term_end: "2029-03-01",
        annual_premium_cents: ANNUAL_PREMIUM_CENTS,
        tax_rate_bps: 235,
        tax_cents: TAX_CENTS,
        fee_cents: FEE_CENTS,
        total_charge_cents: TOTAL_CHARGE_CENTS,
        per_occurrence_limit_cents: 100000000,
        aggregate_limit_cents: 200000000,
      })})
    `;
    // created_by is a plain text column with no foreign key: a synthetic id is enough here.
    return { policyId: policy.id, brokerId: broker.id, userId: "00000000-0000-4000-8000-0000000000fe" };
  });
}

// The payment attempts of a policy, oldest first, with the Stripe session each one opened.
async function checkoutAttempts(
  policyId: string,
): Promise<{ id: string; idempotency_key: string; session_id: string | null }[]> {
  return owner<{ id: string; idempotency_key: string; session_id: string | null }[]>`
    select operation.id,
           operation.idempotency_key,
           (select event.provider_ref from money_operation_events event
             where event.operation_id = operation.id and event.status = 'provider_accepted'
             order by event.sequence_number limit 1) as session_id
      from money_operations operation
     where operation.policy_id = ${policyId} and operation.kind = 'stripe_checkout'
     order by operation.created_at
  `;
}

async function countEntriesOfPolicy(policyId: string): Promise<number> {
  const [row] = await owner<{ count: string }[]>`
    select count(*)::text as count from journal_entries where policy_id = ${policyId}
  `;
  return Number(row.count);
}

// Builds the same rows the application writes before a payment: a broker, a customer, a
// policy, its immutable quote, and a money operation awaiting the provider's answer.
async function createPolicyAwaitingPayment(): Promise<{ policyId: string; operationId: string }> {
  return owner.begin(async (transaction) => {
    const [broker] = await transaction<{ id: string }[]>`
      insert into brokers (name, commission_rate_bps) values ('Replay check broker', 1500) returning id
    `;
    // Eligibility is checked again at binding time (lib/payments/collection.ts, slice B3), so
    // the fixture broker needs a status on file. Provider 'seed' on purpose: the two-minute
    // settling window applies to Stripe Connect statuses only, so a row written a moment ago
    // is usable straight away.
    await transaction`
      insert into broker_kyb_events (broker_id, provider, status)
      values (${broker.id}, 'seed', 'approved')
    `;
    const [customer] = await transaction<{ id: string }[]>`
      insert into customers (name, email)
      values ('Replay check customer', 'replay-check-' || gen_random_uuid()::text || '@example.invalid')
      returning id
    `;
    const [policy] = await transaction<{ id: string }[]>`
      insert into policies (broker_id, customer_id, state_code) values (${broker.id}, ${customer.id}, 'CA') returning id
    `;
    await transaction`
      insert into policy_events (policy_id, event_type, effective_at, payload)
      values (${policy.id}, 'quoted', ${TERM_START}, ${transaction.json({
        state_code: "CA",
        term_start: TERM_START,
        term_end: "2029-03-01",
        annual_premium_cents: ANNUAL_PREMIUM_CENTS,
        tax_rate_bps: 235,
        tax_cents: TAX_CENTS,
        fee_cents: FEE_CENTS,
        total_charge_cents: TOTAL_CHARGE_CENTS,
        per_occurrence_limit_cents: 100000000,
        aggregate_limit_cents: 200000000,
      })})
    `;
    const [operation] = await transaction<{ id: string }[]>`
      insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key)
      values ('stripe_checkout', 'stripe', ${TOTAL_CHARGE_CENTS}, ${policy.id},
              'policy-checkout:' || ${policy.id})
      returning id
    `;
    await transaction`
      insert into money_operation_events (operation_id, status) values (${operation.id}, 'requested')
    `;
    return { policyId: policy.id, operationId: operation.id };
  });
}

main().catch(async (error) => {
  console.error("check failed to run:", error instanceof Error ? error.message : error);
  await owner.end();
  await runtime.end();
  process.exit(1);
});
