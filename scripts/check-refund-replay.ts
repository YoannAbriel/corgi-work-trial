import postgres from "postgres";

// Proves, against a real database, the properties a cancellation refund depends on:
//
//   1. cancelling posts the earning entry and the refund request, once, for the right amounts;
//   2. delivering the SAME completed refund twice pays the customer once and claws the
//      commission back once;
//   3. a FAILED refund posts no journal entry at all and leaves the money still owed;
//   4. re-issuing a failed refund creates a new operation with a new idempotency key and,
//      again, posts no journal entry: the liability was opened once and is cleared once;
//   5. the whole ledger still balances, debits against credits, at the end.
//
// It runs the production functions (lib/policy/cancel.ts, lib/payments/refunds.ts) with the
// restricted runtime role, so it also proves that posting works with the privileges the
// deployed application actually has. It never calls Stripe: the webhook-side functions are
// called directly with the payloads Stripe would send.
//
// It commits rows, so it refuses to run anywhere but the disposable database corgi_test:
// financial rows can never be deleted (AF-03), and the trial ledger must stay clean.
// Run with: npm run check:refund-replay

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on the environment
}

const ownerUrl = process.env.DATABASE_URL_TEST;
const runtimeUrl = process.env.DATABASE_URL_TEST_APP;
if (!ownerUrl || !runtimeUrl) {
  console.error("DATABASE_URL_TEST and DATABASE_URL_TEST_APP must be set: this check only runs on the disposable database");
  process.exit(1);
}

// The recited example (DECISIONS.md): $1,200 premium written 2028-03-01, California 2.35%
// (2820 cents), $25 fee, 15% commission, cancelled on 2028-06-09, day 100 of a 365-day term.
const ANNUAL_PREMIUM_CENTS = 120000;
const TAX_CENTS = 2820;
const FEE_CENTS = 2500;
const TOTAL_CHARGE_CENTS = 125320;
const TERM_START = "2028-03-01";
const TERM_END = "2029-03-01";
const CANCELLED_ON = "2028-06-09";
const EARNED_PREMIUM_CENTS = 32876; // floor(120000 x 100 / 365)
const UNEARNED_PREMIUM_CENTS = 87124;
const REFUNDED_TAX_CENTS = 2048; // ceil(87124 x 235 / 10000), below the 2820 charged
const TOTAL_REFUND_CENTS = 89172;
const COMMISSION_CLAWBACK_CENTS = 13068; // floor(87124 x 1500 / 10000)
const REFUNDED_ON = "2028-06-10"; // Stripe sent the money the day after the cancellation

// A staff operations user. created_by is a plain text column with no foreign key, so the check
// does not need a users row; production always passes the id of the signed-in person.
const STAFF_USER_ID = "00000000-0000-4000-8000-0000000000ff";

let failures = 0;
function report(name: string, passed: boolean, detail: string) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}  (${detail})`);
  if (!passed) failures += 1;
}

const owner = postgres(ownerUrl, { max: 2, prepare: false });
const runtime = postgres(runtimeUrl, { max: 2, prepare: false });

async function main() {
  // Imported here rather than at the top of the file: these modules open the application
  // connection pool and read the Stripe key as soon as they are loaded, which needs
  // .env.local read first.
  const { recordSuccessfulPayment } = await import("@/lib/payments/collection");
  const { recordCancellation } = await import("@/lib/policy/cancel");
  const { createReissuedRefundOperation, recordCompletedRefund, recordFailedRefund } = await import(
    "@/lib/payments/refunds"
  );

  const [{ current_database: databaseName }] = await owner<{ current_database: string }[]>`
    select current_database()
  `;
  if (databaseName !== "corgi_test") {
    console.error(`refusing to run: connected to "${databaseName}", expected the disposable database "corgi_test"`);
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // 1. A paid policy, built with the slice B2 functions, then cancelled
  // ---------------------------------------------------------------------------

  const paid = await createPaidPolicy(recordSuccessfulPayment);
  const cancellation = await recordCancellation(
    {
      policyId: paid.policyId,
      effectiveAt: CANCELLED_ON,
      calculationMethod: "pro_rata",
      actor: { userId: STAFF_USER_ID, role: "staff_ops", brokerId: null },
    },
    runtime,
  );

  report(
    "cancelling produces exactly one Stripe refund for this policy",
    cancellation.refundOperationIds.length === 1,
    `${cancellation.refundOperationIds.length} refund operation(s)`,
  );
  const refundOperationId = cancellation.refundOperationIds[0];

  report(
    "the breakdown is the recited one",
    cancellation.plan.breakdown.earnedPremiumCents === EARNED_PREMIUM_CENTS &&
      cancellation.plan.breakdown.unearnedPremiumCents === UNEARNED_PREMIUM_CENTS &&
      cancellation.plan.breakdown.refundedTaxCents === REFUNDED_TAX_CENTS &&
      cancellation.plan.breakdown.refundedFeeCents === 0 &&
      cancellation.plan.breakdown.totalRefundCents === TOTAL_REFUND_CENTS &&
      cancellation.plan.breakdown.commissionClawbackCents === COMMISSION_CLAWBACK_CENTS,
    `earned ${cancellation.plan.breakdown.earnedPremiumCents}, unearned ${cancellation.plan.breakdown.unearnedPremiumCents}, tax ${cancellation.plan.breakdown.refundedTaxCents}, refund ${cancellation.plan.breakdown.totalRefundCents}, clawback ${cancellation.plan.breakdown.commissionClawbackCents}`,
  );

  const afterCancellation = await entryTypesOfPolicy(paid.policyId);
  report(
    "the cancellation posts the earning entry and the refund request, and nothing else",
    afterCancellation.get("premium_earned_to_date") === 1 && afterCancellation.get("refund_requested") === 1,
    describe(afterCancellation),
  );
  report(
    "the earned premium is recognised for the days actually covered",
    (await accountBalance(paid.policyId, "earned_premium", "credit")) === EARNED_PREMIUM_CENTS,
    `${await accountBalance(paid.policyId, "earned_premium", "credit")} cents`,
  );
  report(
    "the whole written premium has left the unearned liability",
    (await accountBalance(paid.policyId, "unearned_premium", "debit")) === ANNUAL_PREMIUM_CENTS,
    `${await accountBalance(paid.policyId, "unearned_premium", "debit")} cents debited against ${ANNUAL_PREMIUM_CENTS} credited at issuance`,
  );
  report(
    "the tax on the refunded premium is taken back out of the tax payable",
    (await accountBalance(paid.policyId, "premium_tax_payable", "debit")) === REFUNDED_TAX_CENTS,
    `${await accountBalance(paid.policyId, "premium_tax_payable", "debit")} cents`,
  );
  report(
    "the customer is owed the refund, and it is not paid yet",
    (await netBalance(paid.policyId, "refund_payable")) === -TOTAL_REFUND_CENTS,
    `refund_payable net ${await netBalance(paid.policyId, "refund_payable")} cents (credit balance)`,
  );
  report(
    "the policy shows as cancelled",
    (await policyStatus(paid.policyId)) === "cancelled",
    `status: ${await policyStatus(paid.policyId)}`,
  );
  report(
    "the refund operation waits for Stripe, with the derived idempotency key",
    (await operationIdempotencyKey(refundOperationId)) === `policy-refund:${paid.policyId}:${paid.paymentIntentId}`,
    await operationIdempotencyKey(refundOperationId),
  );

  // A second cancellation of the same policy is refused: the money would be given back twice.
  let secondCancellationMessage = "no error raised";
  try {
    await recordCancellation(
      {
        policyId: paid.policyId,
        effectiveAt: CANCELLED_ON,
        calculationMethod: "pro_rata",
        actor: { userId: STAFF_USER_ID, role: "staff_ops", brokerId: null },
      },
      runtime,
    );
  } catch (error) {
    secondCancellationMessage = error instanceof Error ? error.message : String(error);
  }
  report(
    "the same policy cannot be cancelled twice",
    /already cancelled/i.test(secondCancellationMessage),
    secondCancellationMessage,
  );

  // ---------------------------------------------------------------------------
  // 2. The completed refund, delivered twice
  // ---------------------------------------------------------------------------

  const completedRefund = {
    operationId: refundOperationId,
    refundId: `re_replay_check_${refundOperationId.slice(0, 8)}`,
    amountCents: TOTAL_REFUND_CENTS,
    refundedOn: REFUNDED_ON,
  };

  const first = await recordCompletedRefund(completedRefund, runtime);
  report("the first refund.updated posts the completion", first.kind === "posted", `outcome: ${first.kind}`);

  const second = await recordCompletedRefund(completedRefund, runtime);
  report(
    "a second delivery of the same refund is recognised as already posted",
    second.kind === "already_posted",
    `outcome: ${second.kind}`,
  );

  const afterCompletion = await entryTypesOfPolicy(paid.policyId);
  report(
    "the completion and the clawback are posted exactly once each",
    afterCompletion.get("refund_completed") === 1 && afterCompletion.get("commission_clawback") === 1,
    describe(afterCompletion),
  );
  report(
    "the customer is owed nothing any more: refund_payable is back to zero",
    (await netBalance(paid.policyId, "refund_payable")) === 0,
    `refund_payable net ${await netBalance(paid.policyId, "refund_payable")} cents`,
  );
  report(
    "the cash that left Stripe is exactly the refund",
    (await accountBalance(paid.policyId, "cash_stripe", "credit")) === TOTAL_REFUND_CENTS,
    `${await accountBalance(paid.policyId, "cash_stripe", "credit")} cents credited`,
  );
  report(
    "the broker keeps commission on the earned premium only",
    (await netBalance(paid.policyId, "commission_payable")) === -(18000 - COMMISSION_CLAWBACK_CENTS),
    `commission_payable net ${await netBalance(paid.policyId, "commission_payable")} cents after a ${COMMISSION_CLAWBACK_CENTS} clawback on 18000 earned`,
  );
  report(
    "one success event was appended to the operation, not two",
    (await countOperationEvents(refundOperationId, "succeeded")) === 1,
    `${await countOperationEvents(refundOperationId, "succeeded")} succeeded event(s)`,
  );

  // A refund for another amount than the one we asked for is refused, never journaled.
  const wrongAmount = await recordCompletedRefund({ ...completedRefund, amountCents: 999 }, runtime);
  report(
    "a refund for another amount is refused, not journaled",
    wrongAmount.kind === "refused",
    wrongAmount.kind === "refused" ? wrongAmount.reason : wrongAmount.kind,
  );

  // ---------------------------------------------------------------------------
  // 3. A refund that FAILS posts nothing, on a second policy
  // ---------------------------------------------------------------------------

  const failing = await createPaidPolicy(recordSuccessfulPayment);
  const failingCancellation = await recordCancellation(
    {
      policyId: failing.policyId,
      effectiveAt: CANCELLED_ON,
      calculationMethod: "pro_rata",
      actor: { userId: STAFF_USER_ID, role: "staff_ops", brokerId: null },
    },
    runtime,
  );
  const failingOperationId = failingCancellation.refundOperationIds[0];
  const entriesBeforeFailure = await entryTypesOfPolicy(failing.policyId);

  const failed = await recordFailedRefund(
    {
      operationId: failingOperationId,
      refundId: `re_failed_${failingOperationId.slice(0, 8)}`,
      reason: "expired_or_canceled_card",
    },
    runtime,
  );
  report("refund.failed is recorded on the operation", failed.kind === "recorded", `outcome: ${failed.kind}`);

  const entriesAfterFailure = await entryTypesOfPolicy(failing.policyId);
  report(
    "a failed refund posts NO journal entry",
    describe(entriesBeforeFailure) === describe(entriesAfterFailure),
    `before: ${describe(entriesBeforeFailure)} | after: ${describe(entriesAfterFailure)}`,
  );
  report(
    "the customer is still owed the money: refund_payable stays open",
    (await netBalance(failing.policyId, "refund_payable")) === -TOTAL_REFUND_CENTS,
    `refund_payable net ${await netBalance(failing.policyId, "refund_payable")} cents`,
  );

  // ---------------------------------------------------------------------------
  // 4. Re-issuing the failed refund: new operation, new key, still no entry
  // ---------------------------------------------------------------------------

  const reissuedOperationId = await createReissuedRefundOperation(
    { policyId: failing.policyId, failedOperationId: failingOperationId, actorUserId: STAFF_USER_ID },
    runtime,
  );
  report(
    "re-issuing creates a new operation with a new idempotency key",
    reissuedOperationId !== failingOperationId &&
      (await operationIdempotencyKey(reissuedOperationId)) ===
        `policy-refund:${failing.policyId}:${failing.paymentIntentId}:2`,
    await operationIdempotencyKey(reissuedOperationId),
  );
  report(
    "re-issuing posts NO journal entry: the liability was opened once",
    describe(await entryTypesOfPolicy(failing.policyId)) === describe(entriesAfterFailure),
    describe(await entryTypesOfPolicy(failing.policyId)),
  );
  report(
    "the re-issued refund gives back the same premium, tax and clawback",
    (await allocationOf(reissuedOperationId)) === `${UNEARNED_PREMIUM_CENTS}/${REFUNDED_TAX_CENTS}/${COMMISSION_CLAWBACK_CENTS}`,
    await allocationOf(reissuedOperationId),
  );

  // The re-issued refund completes: the liability is cleared exactly once, by this attempt.
  const reissuedCompletion = await recordCompletedRefund(
    {
      operationId: reissuedOperationId,
      refundId: `re_reissued_${reissuedOperationId.slice(0, 8)}`,
      amountCents: TOTAL_REFUND_CENTS,
      refundedOn: REFUNDED_ON,
    },
    runtime,
  );
  report(
    "the re-issued refund completes and clears the liability",
    reissuedCompletion.kind === "posted" && (await netBalance(failing.policyId, "refund_payable")) === 0,
    `outcome ${reissuedCompletion.kind}, refund_payable net ${await netBalance(failing.policyId, "refund_payable")} cents`,
  );
  const failingEntries = await entryTypesOfPolicy(failing.policyId);
  report(
    "the customer was paid once, whatever the number of attempts",
    failingEntries.get("refund_completed") === 1 && failingEntries.get("commission_clawback") === 1,
    describe(failingEntries),
  );

  // ---------------------------------------------------------------------------
  // 5. The whole ledger still balances
  // ---------------------------------------------------------------------------

  const [totals] = await owner<{ debit: string; credit: string }[]>`
    select coalesce(sum(debit_cents), 0)::text as debit, coalesce(sum(credit_cents), 0)::text as credit
      from journal_lines
  `;
  report(
    "every journal line in the database balances, debits against credits",
    totals.debit === totals.credit,
    `debits ${totals.debit} = credits ${totals.credit}`,
  );

  await owner.end();
  await runtime.end();
  process.exit(failures === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Fixtures and reads
// ---------------------------------------------------------------------------

// A bound, paid policy, built exactly as slice B2 builds one: the rows the application writes
// before a payment, then the real collection function on a successful payment.
async function createPaidPolicy(
  recordSuccessfulPayment: typeof import("@/lib/payments/collection").recordSuccessfulPayment,
): Promise<{ policyId: string; collectionOperationId: string; paymentIntentId: string }> {
  const { policyId, operationId } = await owner.begin(async (transaction) => {
    const [broker] = await transaction<{ id: string }[]>`
      insert into brokers (name, commission_rate_bps) values ('Refund check broker', 1500) returning id
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
      values ('Refund check customer', 'refund-check-' || gen_random_uuid()::text || '@example.invalid')
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
        term_end: TERM_END,
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

  const paymentIntentId = `pi_refund_check_${operationId.slice(0, 8)}`;
  const collected = await recordSuccessfulPayment(
    { operationId, paymentIntentId, amountReceivedCents: TOTAL_CHARGE_CENTS, paidOn: TERM_START },
    runtime,
  );
  if (collected.kind !== "posted") {
    throw new Error(`the fixture policy could not be paid: ${JSON.stringify(collected)}`);
  }
  return { policyId, collectionOperationId: operationId, paymentIntentId };
}

// entry type -> how many entries of that type this policy has.
async function entryTypesOfPolicy(policyId: string): Promise<Map<string, number>> {
  const rows = await owner<{ entry_type: string; count: string }[]>`
    select entry_type, count(*)::text as count
      from journal_entries where policy_id = ${policyId}
     group by entry_type order by entry_type
  `;
  return new Map(rows.map((row) => [row.entry_type, Number(row.count)]));
}

function describe(entryTypes: Map<string, number>): string {
  return [...entryTypes.entries()].map(([type, count]) => `${type} x${count}`).join(", ") || "no entry";
}

// Total debited or credited on one account for one policy.
async function accountBalance(policyId: string, accountId: string, side: "debit" | "credit"): Promise<number> {
  const [row] = await owner<{ amount: string }[]>`
    select coalesce(sum(${side === "debit" ? owner`line.debit_cents` : owner`line.credit_cents`}), 0)::text as amount
      from journal_lines line
      join journal_entries entry on entry.id = line.entry_id
     where entry.policy_id = ${policyId} and line.account_id = ${accountId}
  `;
  return Number(row.amount);
}

// Debits minus credits: negative on a credit-side account means we owe that much.
async function netBalance(policyId: string, accountId: string): Promise<number> {
  const [row] = await owner<{ amount: string }[]>`
    select coalesce(sum(line.debit_cents) - sum(line.credit_cents), 0)::text as amount
      from journal_lines line
      join journal_entries entry on entry.id = line.entry_id
     where entry.policy_id = ${policyId} and line.account_id = ${accountId}
  `;
  return Number(row.amount);
}

async function policyStatus(policyId: string): Promise<string> {
  const [row] = await owner<{ status: string }[]>`select status from policy_current where policy_id = ${policyId}`;
  return row?.status ?? "no cache row";
}

async function operationIdempotencyKey(operationId: string): Promise<string> {
  const [row] = await owner<{ idempotency_key: string }[]>`
    select idempotency_key from money_operations where id = ${operationId}
  `;
  return row?.idempotency_key ?? "no operation";
}

async function countOperationEvents(operationId: string, status: string): Promise<number> {
  const [row] = await owner<{ count: string }[]>`
    select count(*)::text as count from money_operation_events
     where operation_id = ${operationId} and status = ${status}
  `;
  return Number(row.count);
}

async function allocationOf(operationId: string): Promise<string> {
  const [row] = await owner<
    { refunded_premium_cents: string; refunded_tax_cents: string; commission_clawback_cents: string }[]
  >`
    select refunded_premium_cents, refunded_tax_cents, commission_clawback_cents
      from refund_allocations where refund_operation_id = ${operationId}
  `;
  return row
    ? `${row.refunded_premium_cents}/${row.refunded_tax_cents}/${row.commission_clawback_cents}`
    : "no allocation";
}

main().catch(async (error) => {
  console.error("check failed to run:", error instanceof Error ? error.message : error);
  await owner.end();
  await runtime.end();
  process.exit(1);
});
