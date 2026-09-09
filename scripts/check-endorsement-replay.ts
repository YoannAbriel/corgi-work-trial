import postgres from "postgres";

// Proves, against a real database, the properties an endorsement depends on:
//
//   1. the preview and the execution give the recited figures (+$600 on day 100: 43561 premium,
//      1023 tax, 44584 collected, 6534 commission; -$600: 43562 + 1024 refunded, 6534 clawed back);
//   2. a stale quote hash is refused: after a second request, the first can neither be
//      approved nor paid;
//   3. the customer's approval is required above $500, only the policy's customer can give it,
//      and the delta cannot be collected without it;
//   3b. that $500 is read against the POLICY and cumulatively over the term, on the premium
//      before tax (decision 24): +$300 needs nothing, the next +$300 and the next +$50 both need
//      the customer, the payment gate refuses the second before the approval, and a reduction
//      never counts;
//   4. the same delta payment delivered twice posts the four entries ONCE and applies the
//      endorsement ONCE; the issuance path refuses a delta operation; a wrong amount is refused;
//      a delta paid while the endorsement cannot be applied is parked in the suspense account
//      (rule 14) and applied from there later, never booked twice;
//   5. an expired hosted page starts a new attempt under a new key;
//   6. a premium reduction is applied at once with its refund operation; the completed refund
//      delivered twice posts once; a failed refund posts nothing; a refund above $1,000 waits in
//      the maker-checker queue, the initiator cannot approve it and a distinct approver can; the
//      threshold is read against the POLICY, so repeated reductions cannot slip under it;
//   6b. a delta paid after the policy is cancelled is PARKED in the suspense account, never
//      recorded as arrived with nothing journaled, and delivering it twice parks it once;
//   7. a cancelled, voided or unbound policy cannot be endorsed; the effective date must be in
//      the term and not before the previous endorsement; an endorsed policy IS cancellable, and
//      its refund is the sum of the written segments, each earning from its own date;
//   8. the whole ledger still balances.
//
// It runs the production functions with the restricted runtime role. It calls Stripe for real
// twice (two test-mode Checkout Sessions, no money moves) and once to check a payment intent
// does not exist (the void guard); every payment confirmation is simulated by calling the
// webhook-side functions directly with the payloads Stripe would send.
//
// It commits rows, so it refuses to run anywhere but the disposable database corgi_test:
// financial rows can never be deleted (AF-03), and the trial ledger must stay clean.
// Run with: npm run check:endorsement-replay

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
// (2820 cents), $25 fee, 15% commission.
const ANNUAL_PREMIUM_CENTS = 120000;
const TAX_CENTS = 2820;
const FEE_CENTS = 2500;
const TOTAL_CHARGE_CENTS = 125320;
const TERM_START = "2028-03-01";
const TERM_END = "2029-03-01";
const DAY_100 = "2028-06-09";
const PER_OCCURRENCE = 100000000;
const AGGREGATE = 200000000;

let failures = 0;
function report(name: string, passed: boolean, detail: string) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}  (${detail})`);
  if (!passed) failures += 1;
}

const owner = postgres(ownerUrl, { max: 2, prepare: false });
const runtime = postgres(runtimeUrl, { max: 2, prepare: false });

type Actor = { userId: string; role: "broker" | "customer" | "staff_ops" | "staff_approver"; brokerId: string | null; customerId: string | null };

async function main() {
  // Imported here rather than at the top of the file: these modules open the application
  // connection pool and read the Stripe key as soon as they are loaded.
  const { recordSuccessfulPayment } = await import("@/lib/payments/collection");
  const { recordCancellation, CancellationRefused } = await import("@/lib/policy/cancel");
  const { recordCompletedRefund, recordFailedRefund } = await import("@/lib/payments/refunds");
  const { planEndorsement, recordEndorsementRequest, approveEndorsement, EndorsementRefused } = await import("@/lib/policy/endorse");
  const {
    startEndorsementCheckout,
    createEndorsementCheckoutOperation,
    recordSuccessfulEndorsementPayment,
    recordExpiredEndorsementCheckout,
    retryEndorsementApplication,
    EndorsementCheckoutRefused,
  } = await import("@/lib/payments/endorsement-collection");
  const { readEndorsementRequest, endorsementRequestStanding } = await import("@/lib/policy/endorsement-requests");
  const { decideApprovalRequest } = await import("@/lib/approvals/approvals");
  const { assertRefundMaySend, loadRefundOperation } = await import("@/lib/payments/refunds");
  const { voidFabricatedBinding } = await import("@/lib/policy/void-fabricated-binding");

  const [{ current_database: databaseName }] = await owner<{ current_database: string }[]>`select current_database()`;
  if (databaseName !== "corgi_test") {
    console.error(`refusing to run: connected to "${databaseName}", expected the disposable database "corgi_test"`);
    process.exit(1);
  }

  const refusal = async (action: () => Promise<unknown>): Promise<string> => {
    try {
      await action();
      return "no refusal";
    } catch (error) {
      if (error instanceof EndorsementRefused || error instanceof EndorsementCheckoutRefused || error instanceof CancellationRefused) {
        return error.message;
      }
      throw error;
    }
  };

  // The message of any refusal, whatever class raised it. Used for the maker-checker refusals,
  // which come from lib/approvals and lib/payments/refunds rather than from this slice.
  const messageOf = async (action: () => Promise<unknown>): Promise<string> => {
    try {
      await action();
      return "no refusal";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };

  // ---------------------------------------------------------------------------
  // 1. The recited increase: preview, request, one real hosted page, expiry, second attempt
  // ---------------------------------------------------------------------------

  const paid = await createPaidPolicy(recordSuccessfulPayment);
  const broker: Actor = { userId: paid.brokerUserId, role: "broker", brokerId: paid.brokerId, customerId: null };
  const customer: Actor = { userId: paid.customerUserId, role: "customer", brokerId: null, customerId: paid.customerId };
  const raise = {
    policyId: paid.policyId,
    effectiveAt: DAY_100,
    newAnnualPremiumCents: 180000,
    newPerOccurrenceLimitCents: 200000000,
    newAggregateLimitCents: 400000000,
    reason: "limit raised at the insured's request",
    actor: broker,
  };

  const preview = await planEndorsement(raise, runtime);
  report(
    "the preview gives the recited figures for +$600 on day 100",
    preview.figures.deltaPremiumCents === 43561 &&
      preview.figures.deltaTaxCents === 1023 &&
      preview.figures.deltaTotalCents === 44584 &&
      preview.figures.commissionDeltaCents === 6534 &&
      preview.figures.daysRemaining === 265 &&
      !preview.figures.customerApprovalRequired,
    `premium ${preview.figures.deltaPremiumCents}, tax ${preview.figures.deltaTaxCents}, total ${preview.figures.deltaTotalCents}, commission ${preview.figures.commissionDeltaCents}, approval ${preview.figures.customerApprovalRequired}`,
  );
  report(
    "the preview writes nothing",
    (await eventTypesOfPolicy(paid.policyId)).join(",") === "quoted,issued",
    (await eventTypesOfPolicy(paid.policyId)).join(","),
  );
  const backdated = await planEndorsement({ ...raise, effectiveAt: "2028-05-10" }, runtime);
  report("the same change backdated 30 days charges 48493", backdated.figures.deltaPremiumCents === 48493, `${backdated.figures.deltaPremiumCents} cents over ${backdated.figures.daysRemaining} days`);

  const staleHash = await refusal(() => recordEndorsementRequest({ ...raise, expectedQuoteHash: "0".repeat(64) }, runtime));
  report("a request with a hash that is not the current quote is refused", /out of date/.test(staleHash), staleHash);

  const requested = await recordEndorsementRequest({ ...raise, expectedQuoteHash: preview.figures.quoteHash }, runtime);
  report(
    "the increase is requested and not applied yet",
    !requested.appliedImmediately && (await eventTypesOfPolicy(paid.policyId)).join(",") === "quoted,issued,endorsement_requested",
    (await eventTypesOfPolicy(paid.policyId)).join(","),
  );
  report(
    "the policy terms are unchanged until the money arrives",
    (await policyCurrent(paid.policyId)).annual === ANNUAL_PREMIUM_CENTS,
    `annual premium in the cache: ${(await policyCurrent(paid.policyId)).annual}`,
  );

  const noApprovalNeeded = await refusal(() =>
    approveEndorsement({ policyId: paid.policyId, requestEventId: requested.requestEventId, quoteHash: preview.figures.quoteHash, actor: customer }, runtime),
  );
  report("below $500 no customer approval is asked for, and one is refused", /needs no customer approval/.test(noApprovalNeeded), noApprovalNeeded);

  // One real test-mode Checkout Session, then a second click reuses it.
  const firstUrl = await startEndorsementCheckout(
    { policyId: paid.policyId, requestEventId: requested.requestEventId, quoteHash: preview.figures.quoteHash, brokerId: paid.brokerId, userId: paid.brokerUserId },
    runtime,
  );
  const sameUrl = await startEndorsementCheckout(
    { policyId: paid.policyId, requestEventId: requested.requestEventId, quoteHash: preview.figures.quoteHash, brokerId: paid.brokerId, userId: paid.brokerUserId },
    runtime,
  );
  report("a real hosted page is opened for the delta, and a second click reuses it", firstUrl.startsWith("https://checkout.stripe.com/") && firstUrl === sameUrl, `${firstUrl.slice(0, 40)}...`);
  const attempts1 = await deltaAttempts(requested.requestEventId);
  report(
    "one delta operation exists, keyed on the request event, for 44584 cents",
    attempts1.length === 1 && attempts1[0].idempotency_key === `endorsement-checkout:${requested.requestEventId}` && attempts1[0].amount_cents === "44584",
    attempts1.map((attempt) => `${attempt.idempotency_key} ${attempt.amount_cents}`).join(", "),
  );

  const expiry = await recordExpiredEndorsementCheckout({ operationId: attempts1[0].id, sessionId: attempts1[0].session_id ?? "cs_unknown" }, runtime);
  report("checkout.session.expired is recorded on the delta operation, no entry posted", expiry.kind === "posted" && (await countEntriesOfPolicy(paid.policyId)) === 4, `outcome ${expiry.kind}, ${await countEntriesOfPolicy(paid.policyId)} entries (the 4 issuance ones)`);

  const newUrl = await startEndorsementCheckout(
    { policyId: paid.policyId, requestEventId: requested.requestEventId, quoteHash: preview.figures.quoteHash, brokerId: paid.brokerId, userId: paid.brokerUserId },
    runtime,
  );
  const attempts2 = await deltaAttempts(requested.requestEventId);
  report(
    "after the expiry, a new Pay click opens a SECOND session under its own key",
    newUrl !== firstUrl && attempts2.length === 2 && attempts2[1].idempotency_key === `endorsement-checkout:${requested.requestEventId}:2`,
    attempts2.map((attempt) => attempt.idempotency_key).join(", "),
  );

  // ---------------------------------------------------------------------------
  // 2. The delta paid, delivered twice
  // ---------------------------------------------------------------------------

  const deltaOperationId = attempts2[1].id;
  const deltaPayment = { operationId: deltaOperationId, paymentIntentId: `pi_endorsement_check_${deltaOperationId.slice(0, 8)}`, amountReceivedCents: 44584, paidOn: "2028-06-10" };

  const wrongAmount = await recordSuccessfulEndorsementPayment({ ...deltaPayment, amountReceivedCents: 999 }, runtime);
  report("a delta payment for another amount is refused, not journaled", wrongAmount.kind === "refused", wrongAmount.kind === "refused" ? wrongAmount.reason : wrongAmount.kind);

  const issuancePathOnDelta = await recordSuccessfulPayment(deltaPayment, runtime);
  report(
    "the issuance path refuses a delta operation instead of posting issuance entries under it",
    issuancePathOnDelta.kind === "refused" && /endorsement/.test(issuancePathOnDelta.reason),
    issuancePathOnDelta.kind === "refused" ? issuancePathOnDelta.reason : issuancePathOnDelta.kind,
  );

  const first = await recordSuccessfulEndorsementPayment(deltaPayment, runtime);
  const second = await recordSuccessfulEndorsementPayment(deltaPayment, runtime);
  report("the first delivery applies the endorsement, the second is already posted", first.kind === "posted" && second.kind === "already_posted", `${first.kind}, then ${second.kind}`);

  const deltaEntries = await entriesOfOperation(deltaOperationId);
  report(
    "exactly four endorsement entries exist, one of each type",
    deltaEntries.size === 4 && [...deltaEntries.values()].every((count) => count === 1) && deltaEntries.has("endorsement_premium_written") && deltaEntries.has("endorsement_tax_billed") && deltaEntries.has("endorsement_premium_collected") && deltaEntries.has("endorsement_commission_earned"),
    describe(deltaEntries),
  );
  report("cash at Stripe is debited once with the delta", (await amountOnOperation(deltaOperationId, "cash_stripe", "debit")) === 44584, `${await amountOnOperation(deltaOperationId, "cash_stripe", "debit")} cents`);
  report("unearned premium grows by the prorated delta, not by the annual difference", (await amountOnOperation(deltaOperationId, "unearned_premium", "credit")) === 43561, `${await amountOnOperation(deltaOperationId, "unearned_premium", "credit")} cents`);
  report("the tax on the delta is separated", (await amountOnOperation(deltaOperationId, "premium_tax_payable", "credit")) === 1023, `${await amountOnOperation(deltaOperationId, "premium_tax_payable", "credit")} cents`);
  report("no fee is charged again", (await amountOnOperation(deltaOperationId, "fee_income", "credit")) === -1, "no fee_income line");
  report("the broker earns 15% of the collected delta", (await amountOnOperation(deltaOperationId, "commission_payable", "credit")) === 6534, `${await amountOnOperation(deltaOperationId, "commission_payable", "credit")} cents`);
  report(
    "the endorsement is in force exactly once and the terms moved to $1,800 with the new limits",
    (await eventTypesOfPolicy(paid.policyId)).filter((type) => type === "endorsed").length === 1 &&
      (await policyCurrent(paid.policyId)).annual === 180000 &&
      (await policyCurrent(paid.policyId)).perOccurrence === 200000000 &&
      (await policyCurrent(paid.policyId)).status === "bound",
    `annual ${(await policyCurrent(paid.policyId)).annual}, per-occurrence ${(await policyCurrent(paid.policyId)).perOccurrence}, status ${(await policyCurrent(paid.policyId)).status}`,
  );
  report("one success event was appended to the delta operation, not two", (await countOperationEvents(deltaOperationId, "succeeded")) === 1, `${await countOperationEvents(deltaOperationId, "succeeded")} succeeded event(s)`);

  const beforePrevious = await refusal(() => planEndorsement({ ...raise, effectiveAt: "2028-05-01", newAnnualPremiumCents: 200000 }, runtime));
  report("an endorsement cannot be backdated before the one in force", /before the previous one/.test(beforePrevious), beforePrevious);
  // Cancelling an ENDORSED policy: the refund is the sum of the segments, each earning from its
  // own date, never the annual premium in force priced over the whole term.
  //   issuance    floor(120000 x 184 / 365) = 60493 earned of 120000
  //   endorsement floor(43561 x 84 / 265)   = 13808 earned of 43561
  //   written 163561, earned 74301, unearned 89260; tax back ceil(89260 x 2.35%) = 2098
  const cancelEndorsed = await recordCancellation(
    { policyId: paid.policyId, effectiveAt: "2028-09-01", calculationMethod: "pro_rata", actor: { userId: paid.brokerUserId, role: "broker", brokerId: paid.brokerId } },
    runtime,
  );
  const endorsedBreakdown = cancelEndorsed.plan.breakdown;
  report(
    "an endorsed policy is cancelled on its segments: 163561 written, 74301 earned, 89260 given back",
    endorsedBreakdown.writtenPremiumCents === 163561 && endorsedBreakdown.earnedPremiumCents === 74301 && endorsedBreakdown.unearnedPremiumCents === 89260,
    `written ${endorsedBreakdown.writtenPremiumCents}, earned ${endorsedBreakdown.earnedPremiumCents}, unearned ${endorsedBreakdown.unearnedPremiumCents}`,
  );
  report(
    "the tax cap is the tax the ledger still holds (2820 at issuance + 1023 on the delta), not the tax on the annual premium in force",
    cancelEndorsed.plan.taxChargedCents === 3843 && endorsedBreakdown.refundedTaxCents === 2098 && endorsedBreakdown.totalRefundCents === 91358,
    `held ${cancelEndorsed.plan.taxChargedCents}, tax back ${endorsedBreakdown.refundedTaxCents}, refund ${endorsedBreakdown.totalRefundCents}`,
  );
  report(
    "the refund is split over the two payments that funded the policy, newest first",
    cancelEndorsed.plan.slices.length === 2 && cancelEndorsed.plan.slices.reduce((total, slice) => total + slice.amountCents, 0) === 91358,
    cancelEndorsed.plan.slices.map((slice) => `${slice.paymentIntentId} ${slice.amountCents}`).join(", "),
  );
  report(
    "the commission clawback follows the refunded premium alone",
    endorsedBreakdown.commissionClawbackCents === 13389 && cancelEndorsed.plan.slices.reduce((total, slice) => total + slice.commissionClawbackCents, 0) === 13389,
    `${endorsedBreakdown.commissionClawbackCents} cents`,
  );

  // ---------------------------------------------------------------------------
  // 3. Above $500: customer approval, wrong users, stale hash after a second request
  // ---------------------------------------------------------------------------

  const big = await createPaidPolicy(recordSuccessfulPayment);
  const bigBroker: Actor = { userId: big.brokerUserId, role: "broker", brokerId: big.brokerId, customerId: null };
  const bigCustomer: Actor = { userId: big.customerUserId, role: "customer", brokerId: null, customerId: big.customerId };
  const bigRaise = { policyId: big.policyId, effectiveAt: DAY_100, newAnnualPremiumCents: 240000, newPerOccurrenceLimitCents: PER_OCCURRENCE, newAggregateLimitCents: AGGREGATE, reason: null, actor: bigBroker };
  const bigPlan = await planEndorsement(bigRaise, runtime);
  report("+$1,200 on day 100 is 87123 + 2047 = 89170, above the $500 threshold", bigPlan.figures.deltaTotalCents === 89170 && bigPlan.figures.customerApprovalRequired, `${bigPlan.figures.deltaPremiumCents} + ${bigPlan.figures.deltaTaxCents}, approval ${bigPlan.figures.customerApprovalRequired}`);
  const bigRequested = await recordEndorsementRequest({ ...bigRaise, expectedQuoteHash: bigPlan.figures.quoteHash }, runtime);
  const bigCheckoutArgs = { policyId: big.policyId, requestEventId: bigRequested.requestEventId, quoteHash: bigPlan.figures.quoteHash, brokerId: big.brokerId, userId: big.brokerUserId };

  const unapprovedCheckout = await refusal(() => startEndorsementCheckout(bigCheckoutArgs, runtime));
  report("the delta cannot be collected before the customer approves", /customer has to approve/.test(unapprovedCheckout), unapprovedCheckout);
  report("no operation was created by the refused checkout", (await deltaAttempts(bigRequested.requestEventId)).length === 0, `${(await deltaAttempts(bigRequested.requestEventId)).length} attempt(s)`);

  const brokerApproves = await refusal(() => approveEndorsement({ policyId: big.policyId, requestEventId: bigRequested.requestEventId, quoteHash: bigPlan.figures.quoteHash, actor: bigBroker }, runtime));
  report("the broker cannot approve in the customer's place", /only the customer/.test(brokerApproves), brokerApproves);
  const otherCustomerApproves = await refusal(() => approveEndorsement({ policyId: big.policyId, requestEventId: bigRequested.requestEventId, quoteHash: bigPlan.figures.quoteHash, actor: customer }, runtime));
  report("another policy's customer cannot approve", /only the customer/.test(otherCustomerApproves), otherCustomerApproves);
  const wrongHashApproval = await refusal(() => approveEndorsement({ policyId: big.policyId, requestEventId: bigRequested.requestEventId, quoteHash: preview.figures.quoteHash, actor: bigCustomer }, runtime));
  report("an approval carrying another quote's hash is refused", /out of date/.test(wrongHashApproval), wrongHashApproval);

  const approved = await approveEndorsement({ policyId: big.policyId, requestEventId: bigRequested.requestEventId, quoteHash: bigPlan.figures.quoteHash, actor: bigCustomer }, runtime);
  const approvedAgain = await approveEndorsement({ policyId: big.policyId, requestEventId: bigRequested.requestEventId, quoteHash: bigPlan.figures.quoteHash, actor: bigCustomer }, runtime);
  report("the policy's customer approves once; a second click changes nothing", !approved.alreadyApproved && approvedAgain.alreadyApproved && approvedAgain.approvedEventId === approved.approvedEventId, `${approved.approvedEventId}`);
  const bigStanding = await endorsementRequestStanding(runtime, (await readEndorsementRequest(runtime, big.policyId, bigRequested.requestEventId))!);
  report("the request now stands as approved", bigStanding.state === "approved", bigStanding.state);

  // A second request supersedes the first: its hash is stale for approval and for payment.
  const secondPlan = await planEndorsement({ ...bigRaise, newAnnualPremiumCents: 300000 }, runtime);
  report("the second quote has a different hash (the version moved)", secondPlan.figures.quoteHash !== bigPlan.figures.quoteHash && secondPlan.figures.policyVersion === bigPlan.figures.policyVersion + 2, `version ${bigPlan.figures.policyVersion} -> ${secondPlan.figures.policyVersion}`);
  await recordEndorsementRequest({ ...bigRaise, newAnnualPremiumCents: 300000, expectedQuoteHash: secondPlan.figures.quoteHash }, runtime);
  const staleCheckout = await refusal(() => startEndorsementCheckout(bigCheckoutArgs, runtime));
  report("after a second request, paying the first quote is refused as superseded", /superseded/.test(staleCheckout), staleCheckout);
  const staleApproval = await refusal(() => approveEndorsement({ policyId: big.policyId, requestEventId: bigRequested.requestEventId, quoteHash: bigPlan.figures.quoteHash, actor: bigCustomer }, runtime));
  report("and approving it again is refused too", /superseded/.test(staleApproval), staleApproval);
  const staleDelivery = await (async () => {
    // A delta operation built for the superseded quote, then paid: the money is recorded and
    // the endorsement is NOT applied.
    const staleQuote = (await readEndorsementRequest(runtime, big.policyId, bigRequested.requestEventId))!;
    const { operationId } = await createEndorsementCheckoutOperation({ quote: staleQuote, userId: big.brokerUserId, attempt: 1 }, runtime);
    return recordSuccessfulEndorsementPayment({ operationId, paymentIntentId: `pi_stale_${operationId.slice(0, 8)}`, amountReceivedCents: 89170, paidOn: DAY_100 }, runtime);
  })();
  report("a payment arriving for a superseded quote is recorded, not applied, and nothing is journaled", staleDelivery.kind === "application_refused" && (await eventTypesOfPolicy(big.policyId)).filter((type) => type === "endorsed").length === 0, staleDelivery.kind === "application_refused" ? staleDelivery.reason : staleDelivery.kind);

  // ---------------------------------------------------------------------------
  // 3b. The $500 customer threshold is cumulative per policy (decision 24, F-INT-12)
  // ---------------------------------------------------------------------------
  //
  // Yoann's example, on ONE policy, with every endorsement effective on the first day of the term
  // so the prorated premium is the annual difference itself: +$300.00, +$300.00, +$50.00 of
  // premium. The running total is the premium BEFORE tax: $300.00, then $600.00, then $650.00.
  // The preview, the recorded request and the payment gate all read that one total.

  const cumulative = await createPaidPolicy(recordSuccessfulPayment);
  const cumulativeBroker: Actor = { userId: cumulative.brokerUserId, role: "broker", brokerId: cumulative.brokerId, customerId: null };
  const cumulativeCustomer: Actor = { userId: cumulative.customerUserId, role: "customer", brokerId: null, customerId: cumulative.customerId };
  const raiseTo = (newAnnualPremiumCents: number) => ({
    policyId: cumulative.policyId,
    effectiveAt: TERM_START,
    newAnnualPremiumCents,
    newPerOccurrenceLimitCents: PER_OCCURRENCE,
    newAggregateLimitCents: AGGREGATE,
    reason: "cumulative customer threshold check",
    actor: cumulativeBroker,
  });
  const liveQuote = async (requestEventId: string) => {
    const quote = await readEndorsementRequest(runtime, cumulative.policyId, requestEventId);
    if (!quote) {
      throw new Error(`the endorsement request ${requestEventId} cannot be read back`);
    }
    return quote;
  };
  // Paying a delta without opening a real hosted page: the operation and the webhook-side
  // function are exactly the ones Stripe's callback uses.
  const payDelta = async (requestEventId: string, amountCents: number) => {
    const quote = await liveQuote(requestEventId);
    const { operationId } = await createEndorsementCheckoutOperation({ quote, userId: cumulative.brokerUserId, attempt: 1 }, runtime);
    return recordSuccessfulEndorsementPayment(
      { operationId, paymentIntentId: `pi_cumulative_${operationId.slice(0, 8)}`, amountReceivedCents: amountCents, paidOn: TERM_START },
      runtime,
    );
  };

  const step1 = await planEndorsement(raiseTo(150000), runtime);
  report(
    "endorsement 1 adds $300.00 of premium: running total $300.00, no customer approval",
    step1.figures.deltaPremiumCents === 30000 && step1.additionalPremiumOfTheTermCents === 30000 && !step1.figures.customerApprovalRequired,
    `premium ${step1.figures.deltaPremiumCents}, running total ${step1.additionalPremiumOfTheTermCents}, approval ${step1.figures.customerApprovalRequired}`,
  );
  const requested1 = await recordEndorsementRequest({ ...raiseTo(150000), expectedQuoteHash: step1.figures.quoteHash }, runtime);
  const paidStep1 = await payDelta(requested1.requestEventId, step1.figures.deltaTotalCents);
  report(
    "its delta is collected with no approval and the endorsement is in force",
    paidStep1.kind === "posted" && (await policyCurrent(cumulative.policyId)).annual === 150000,
    `${paidStep1.kind}, annual now ${(await policyCurrent(cumulative.policyId)).annual}`,
  );

  const step2 = await planEndorsement(raiseTo(180000), runtime);
  report(
    "endorsement 2 adds $300.00 more: running total $600.00, above $500.00, the customer approves",
    step2.figures.deltaPremiumCents === 30000 && step2.additionalPremiumOfTheTermCents === 60000 && step2.figures.customerApprovalRequired,
    `premium ${step2.figures.deltaPremiumCents}, running total ${step2.additionalPremiumOfTheTermCents}, approval ${step2.figures.customerApprovalRequired}`,
  );
  const requested2 = await recordEndorsementRequest({ ...raiseTo(180000), expectedQuoteHash: step2.figures.quoteHash }, runtime);
  const standing2 = await endorsementRequestStanding(runtime, await liveQuote(requested2.requestEventId));
  report(
    "the recorded request reads the same base as the preview: it stands as awaiting the customer",
    standing2.state === "awaiting_approval" && standing2.approvalRequired,
    `${standing2.state}, approval required ${standing2.approvalRequired}`,
  );
  const gateBeforeApproval = await refusal(() =>
    startEndorsementCheckout(
      { policyId: cumulative.policyId, requestEventId: requested2.requestEventId, quoteHash: step2.figures.quoteHash, brokerId: cumulative.brokerId, userId: cumulative.brokerUserId },
      runtime,
    ),
  );
  report("the payment gate refuses to collect endorsement 2 before the customer approves", /customer has to approve/.test(gateBeforeApproval), gateBeforeApproval);
  report(
    "nothing was created by the refused checkout",
    (await deltaAttempts(requested2.requestEventId)).length === 0,
    `${(await deltaAttempts(requested2.requestEventId)).length} attempt(s)`,
  );
  await approveEndorsement({ policyId: cumulative.policyId, requestEventId: requested2.requestEventId, quoteHash: step2.figures.quoteHash, actor: cumulativeCustomer }, runtime);
  const paidStep2 = await payDelta(requested2.requestEventId, step2.figures.deltaTotalCents);
  report(
    "once approved, the same delta is collected and applied",
    paidStep2.kind === "posted" && (await policyCurrent(cumulative.policyId)).annual === 180000,
    `${paidStep2.kind}, annual now ${(await policyCurrent(cumulative.policyId)).annual}`,
  );

  const step3 = await planEndorsement(raiseTo(185000), runtime);
  report(
    "endorsement 3 adds only $50.00, but the running total is $650.00, so the customer approves again",
    step3.figures.deltaPremiumCents === 5000 && step3.additionalPremiumOfTheTermCents === 65000 && step3.figures.customerApprovalRequired,
    `premium ${step3.figures.deltaPremiumCents}, running total ${step3.additionalPremiumOfTheTermCents}, approval ${step3.figures.customerApprovalRequired}`,
  );
  const requested3 = await recordEndorsementRequest({ ...raiseTo(185000), expectedQuoteHash: step3.figures.quoteHash }, runtime);
  const standing3 = await endorsementRequestStanding(runtime, await liveQuote(requested3.requestEventId));
  report("endorsement 3 waits for the customer too, on the same total", standing3.state === "awaiting_approval", standing3.state);
  // An open request counts in the total as well as an applied one: the reduction below is priced
  // while endorsement 3 is still waiting, and the total stays $650.00.
  const cumulativeReduction = await planEndorsement(raiseTo(100000), runtime);
  report(
    "a reduction never counts and never needs approval, whatever the policy has added",
    cumulativeReduction.figures.deltaPremiumCents < 0 && !cumulativeReduction.figures.customerApprovalRequired && cumulativeReduction.additionalPremiumOfTheTermCents === 65000,
    `premium ${cumulativeReduction.figures.deltaPremiumCents}, running total ${cumulativeReduction.additionalPremiumOfTheTermCents}, approval ${cumulativeReduction.figures.customerApprovalRequired}`,
  );

  // ---------------------------------------------------------------------------
  // 4. Broker no longer eligible when the delta arrives: recorded, then applied by staff
  // ---------------------------------------------------------------------------

  const held = await createPaidPolicy(recordSuccessfulPayment);
  const heldBroker: Actor = { userId: held.brokerUserId, role: "broker", brokerId: held.brokerId, customerId: null };
  const heldPlan = await planEndorsement({ ...raise, policyId: held.policyId, actor: heldBroker }, runtime);
  const heldRequested = await recordEndorsementRequest({ ...raise, policyId: held.policyId, actor: heldBroker, expectedQuoteHash: heldPlan.figures.quoteHash }, runtime);
  const heldQuote = (await readEndorsementRequest(runtime, held.policyId, heldRequested.requestEventId))!;
  const heldAttempt = await createEndorsementCheckoutOperation({ quote: heldQuote, userId: held.brokerUserId, attempt: 1 }, runtime);
  await owner`insert into broker_kyb_events (broker_id, provider, status) values (${held.brokerId}, 'seed', 'pending')`;
  const heldPayment = { operationId: heldAttempt.operationId, paymentIntentId: `pi_held_${heldAttempt.operationId.slice(0, 8)}`, amountReceivedCents: 44584, paidOn: DAY_100 };
  const heldOutcome = await recordSuccessfulEndorsementPayment(heldPayment, runtime);
  report("a delta paid while the broker is not eligible is recorded and NOT applied", heldOutcome.kind === "application_refused" && (await entriesOfOperation(heldAttempt.operationId)).get("unapplied_cash_received") === 1, heldOutcome.kind === "application_refused" ? heldOutcome.reason : heldOutcome.kind);
  // Rule 14 (DECISIONS.md 12:54Z): the cash exists, so the ledger records it at once against a
  // liability to the customer. Ledger cash equals Stripe cash even though nothing is endorsed.
  report("the delta cash is parked in the suspense account, not left out of the ledger", (await amountOnOperation(heldAttempt.operationId, "cash_stripe", "debit")) === 44584 && (await amountOnOperation(heldAttempt.operationId, "unapplied_customer_cash", "credit")) === 44584, `cash_stripe ${await amountOnOperation(heldAttempt.operationId, "cash_stripe", "debit")}, unapplied_customer_cash ${await amountOnOperation(heldAttempt.operationId, "unapplied_customer_cash", "credit")}`);
  const heldTwice = await recordSuccessfulEndorsementPayment(heldPayment, runtime);
  report("the same parked payment delivered twice parks once", heldTwice.kind === "application_refused" && (await entriesOfOperation(heldAttempt.operationId)).get("unapplied_cash_received") === 1 && (await countOperationEvents(heldAttempt.operationId, "succeeded")) === 1, describe(await entriesOfOperation(heldAttempt.operationId)));
  const staffTooEarly = await retryEndorsementApplication({ policyId: held.policyId, requestEventId: heldRequested.requestEventId, actorUserId: held.staffUserId }, runtime);
  report("staff cannot apply it while the broker is still not eligible", staffTooEarly.kind === "application_refused", staffTooEarly.kind);
  await owner`insert into broker_kyb_events (broker_id, provider, status) values (${held.brokerId}, 'seed', 'approved')`;
  const staffApplies = await retryEndorsementApplication({ policyId: held.policyId, requestEventId: heldRequested.requestEventId, actorUserId: held.staffUserId }, runtime);
  const staffAgain = await retryEndorsementApplication({ policyId: held.policyId, requestEventId: heldRequested.requestEventId, actorUserId: held.staffUserId }, runtime);
  report("staff apply it once the broker is eligible; a second run posts nothing more", staffApplies.kind === "posted" && staffAgain.kind === "already_posted" && (await entriesOfOperation(heldAttempt.operationId)).size === 5 && (await countOperationEvents(heldAttempt.operationId, "succeeded")) === 1, `${staffApplies.kind}, then ${staffAgain.kind}; ${describe(await entriesOfOperation(heldAttempt.operationId))}`);
  // Applying the parked cash debits the suspense account instead of cash_stripe: the money is
  // applied, not booked twice, and the suspense balance for this policy returns to zero.
  report("applying the parked delta clears the suspense account and books the cash once", (await netBalance(held.policyId, "unapplied_customer_cash")) === 0 && (await amountOnOperation(heldAttempt.operationId, "cash_stripe", "debit")) === 44584 && (await amountOnOperation(heldAttempt.operationId, "unapplied_customer_cash", "debit")) === 44584, `unapplied_customer_cash net ${await netBalance(held.policyId, "unapplied_customer_cash")}, cash_stripe debited ${await amountOnOperation(heldAttempt.operationId, "cash_stripe", "debit")} once`);

  // ---------------------------------------------------------------------------
  // 5. The recited reduction: applied at once, refunded through Stripe, delivered twice
  // ---------------------------------------------------------------------------

  const lowered = await createPaidPolicy(recordSuccessfulPayment);
  const lowerBroker: Actor = { userId: lowered.brokerUserId, role: "broker", brokerId: lowered.brokerId, customerId: null };
  const lower = { policyId: lowered.policyId, effectiveAt: DAY_100, newAnnualPremiumCents: 60000, newPerOccurrenceLimitCents: PER_OCCURRENCE, newAggregateLimitCents: AGGREGATE, reason: null, actor: lowerBroker };
  const lowerPlan = await planEndorsement(lower, runtime);
  report("the preview of -$600 on day 100 refunds 43562 + 1024 with a 6534 clawback", lowerPlan.figures.deltaPremiumCents === -43562 && lowerPlan.figures.deltaTaxCents === -1024 && lowerPlan.figures.deltaTotalCents === -44586 && lowerPlan.figures.commissionDeltaCents === -6534, `${lowerPlan.figures.deltaPremiumCents}, ${lowerPlan.figures.deltaTaxCents}, ${lowerPlan.figures.commissionDeltaCents}`);
  const loweredResult = await recordEndorsementRequest({ ...lower, expectedQuoteHash: lowerPlan.figures.quoteHash }, runtime);
  report("the reduction is applied in the same transaction, with one refund operation, not held", loweredResult.appliedImmediately && loweredResult.refundOperationIds.length === 1 && loweredResult.refundOperationIdsAwaitingApproval.length === 0 && (await policyCurrent(lowered.policyId)).annual === 60000, `applied ${loweredResult.appliedImmediately}, ${loweredResult.refundOperationIds.length} refund(s), annual now ${(await policyCurrent(lowered.policyId)).annual}`);
  const refundOperationId = loweredResult.refundOperationIds[0];
  report("the refund allocation carries premium 43562, tax 1024, clawback 6534 on the issuance payment", (await allocationOf(refundOperationId)) === `43562/1024/6534/${lowered.paymentIntentId}`, await allocationOf(refundOperationId));
  report("the refund operation waits for Stripe under the derived key", (await operationIdempotencyKey(refundOperationId)) === `policy-refund:${lowered.policyId}:${lowered.paymentIntentId}`, await operationIdempotencyKey(refundOperationId));
  report("the customer is owed the refund and it is not paid yet", (await netBalance(lowered.policyId, "refund_payable")) === -44586 && (await entryTypesOfPolicy(lowered.policyId)).get("endorsement_refund_requested") === 1, `refund_payable net ${await netBalance(lowered.policyId, "refund_payable")}`);

  const completed = { operationId: refundOperationId, refundId: `re_endorsement_${refundOperationId.slice(0, 8)}`, amountCents: 44586, refundedOn: "2028-06-10" };
  const firstRefund = await recordCompletedRefund(completed, runtime);
  const secondRefund = await recordCompletedRefund(completed, runtime);
  report("the completed refund delivered twice posts once", firstRefund.kind === "posted" && secondRefund.kind === "already_posted", `${firstRefund.kind}, then ${secondRefund.kind}`);
  const loweredEntries = await entryTypesOfPolicy(lowered.policyId);
  report("refund_completed and commission_clawback exist once each; refund_payable is back to zero", loweredEntries.get("refund_completed") === 1 && loweredEntries.get("commission_clawback") === 1 && (await netBalance(lowered.policyId, "refund_payable")) === 0, describe(loweredEntries));
  report("the broker keeps 18000 - 6534 of commission", (await netBalance(lowered.policyId, "commission_payable")) === -(18000 - 6534), `commission_payable net ${await netBalance(lowered.policyId, "commission_payable")}`);
  report("cash at Stripe went down by the refund", (await accountBalance(lowered.policyId, "cash_stripe", "credit")) === 44586, `${await accountBalance(lowered.policyId, "cash_stripe", "credit")} cents credited`);

  // A failed refund on another reduction posts nothing.
  const failing = await createPaidPolicy(recordSuccessfulPayment);
  const failingPlan = await planEndorsement({ ...lower, policyId: failing.policyId, actor: { userId: failing.brokerUserId, role: "broker", brokerId: failing.brokerId, customerId: null } }, runtime);
  const failingResult = await recordEndorsementRequest({ ...lower, policyId: failing.policyId, actor: { userId: failing.brokerUserId, role: "broker", brokerId: failing.brokerId, customerId: null }, expectedQuoteHash: failingPlan.figures.quoteHash }, runtime);
  const entriesBeforeFailure = describe(await entryTypesOfPolicy(failing.policyId));
  await recordFailedRefund({ operationId: failingResult.refundOperationIds[0], refundId: "re_failed_endorsement", reason: "expired_or_canceled_card" }, runtime);
  report("a failed endorsement refund posts NO journal entry and the customer is still owed", describe(await entryTypesOfPolicy(failing.policyId)) === entriesBeforeFailure && (await netBalance(failing.policyId, "refund_payable")) === -44586, `refund_payable net ${await netBalance(failing.policyId, "refund_payable")}`);

  // A reduction above $1,000 goes through the same maker-checker queue as a cancellation refund
  // (slice B7): the endorsement is applied and the customer is owed the money, but nothing is
  // asked of Stripe until a SECOND person approves it.
  const large = await createPaidPolicy(recordSuccessfulPayment, 1200000);
  const largeActor: Actor = { userId: large.brokerUserId, role: "broker", brokerId: large.brokerId, customerId: null };
  const largePlan = await planEndorsement({ ...lower, policyId: large.policyId, newAnnualPremiumCents: 600000, actor: largeActor }, runtime);
  report("the preview says the reduction of over $1,000 needs an approver", largePlan.refundNeedsApproval && largePlan.figures.deltaTotalCents < -100000, `${-largePlan.figures.deltaTotalCents} cents, needs approval ${largePlan.refundNeedsApproval}`);
  const largeResult = await recordEndorsementRequest({ ...lower, policyId: large.policyId, newAnnualPremiumCents: 600000, actor: largeActor, expectedQuoteHash: largePlan.figures.quoteHash }, runtime);
  const largeRefundId = largeResult.refundOperationIds[0];
  report("the refund waits for a distinct human approver: one request written, nothing sent to Stripe", largeResult.refundOperationIdsAwaitingApproval.length === 1 && largeResult.approvalRequestIds.length === 1 && (await countOperationEvents(largeRefundId, "provider_accepted")) === 0, `${largeResult.approvalRequestIds.length} approval request(s), ${await countOperationEvents(largeRefundId, "provider_accepted")} provider_accepted event(s)`);
  report("the endorsement is applied all the same: the cover is reduced and the customer is owed the money", (await policyCurrent(large.policyId)).annual === 600000 && (await netBalance(large.policyId, "refund_payable")) < 0, `annual now ${(await policyCurrent(large.policyId)).annual}, refund_payable net ${await netBalance(large.policyId, "refund_payable")}`);

  const largeOperation = await loadRefundOperation(runtime, largeRefundId);
  const beforeApproval = await messageOf(() => assertRefundMaySend(runtime, largeOperation!));
  report("the refund cannot be sent before somebody approves it", /waiting for a second person/.test(beforeApproval), beforeApproval);
  const selfApproval = await messageOf(() =>
    decideApprovalRequest({ requestId: largeResult.approvalRequestIds[0], decidedByUserId: large.brokerUserId, decidedByRole: "staff_approver", decision: "approved", reason: null }, runtime),
  );
  report("the person who asked for it cannot approve it, even claiming the approver role", /cannot approve it/.test(selfApproval), selfApproval);
  const wrongRole = await messageOf(() =>
    decideApprovalRequest({ requestId: largeResult.approvalRequestIds[0], decidedByUserId: large.staffUserId, decidedByRole: "staff_ops", decision: "approved", reason: null }, runtime),
  );
  report("an operator who is not a staff approver cannot approve it", /only a staff approver/.test(wrongRole), wrongRole);
  await decideApprovalRequest({ requestId: largeResult.approvalRequestIds[0], decidedByUserId: large.approverUserId, decidedByRole: "staff_approver", decision: "approved", reason: "checked against the endorsement" }, runtime);
  const approvedOperation = await loadRefundOperation(runtime, largeRefundId);
  const afterApproval = await messageOf(() => assertRefundMaySend(runtime, approvedOperation!));
  report("once a distinct staff approver has approved it, the refund may be sent", afterApproval === "no refusal", afterApproval);

  // ---------------------------------------------------------------------------
  // 5b. The threshold is per POLICY, not per refund (review finding F-B4-04)
  // ---------------------------------------------------------------------------

  // Two reductions of $800 on one policy, each giving back 59448 cents. Neither is above $1,000
  // on its own; together they send $1,188.96 back, so the second one has to wait for an approver.
  const twice = await createPaidPolicy(recordSuccessfulPayment, 240000);
  const twiceActor: Actor = { userId: twice.brokerUserId, role: "broker", brokerId: twice.brokerId, customerId: null };
  const firstCut = { policyId: twice.policyId, effectiveAt: DAY_100, newAnnualPremiumCents: 160000, newPerOccurrenceLimitCents: PER_OCCURRENCE, newAggregateLimitCents: AGGREGATE, reason: null, actor: twiceActor };
  const firstCutPlan = await planEndorsement(firstCut, runtime);
  report("the first reduction of $800 is under $1,000 and needs no approver", !firstCutPlan.refundNeedsApproval && -firstCutPlan.figures.deltaTotalCents === 59448, `${-firstCutPlan.figures.deltaTotalCents} cents, needs approval ${firstCutPlan.refundNeedsApproval}`);
  const firstCutResult = await recordEndorsementRequest({ ...firstCut, expectedQuoteHash: firstCutPlan.figures.quoteHash }, runtime);
  report("it is written with no approval request, as before", firstCutResult.approvalRequestIds.length === 0 && firstCutResult.refundOperationIds.length === 1, `${firstCutResult.approvalRequestIds.length} approval request(s)`);

  const secondCut = { ...firstCut, newAnnualPremiumCents: 80000 };
  const secondCutPlan = await planEndorsement(secondCut, runtime);
  report("the second reduction takes the policy past $1,000, so the preview asks for an approver", secondCutPlan.refundNeedsApproval && -secondCutPlan.figures.deltaTotalCents < 100000, `${-secondCutPlan.figures.deltaTotalCents} cents alone, needs approval ${secondCutPlan.refundNeedsApproval}`);
  const secondCutResult = await recordEndorsementRequest({ ...secondCut, expectedQuoteHash: secondCutPlan.figures.quoteHash }, runtime);
  report("and it really is queued: one approval request, nothing sent to Stripe", secondCutResult.approvalRequestIds.length === 1 && secondCutResult.refundOperationIdsAwaitingApproval.length === 1 && (await countOperationEvents(secondCutResult.refundOperationIds[0], "provider_accepted")) === 0, `${secondCutResult.approvalRequestIds.length} approval request(s), ${await countOperationEvents(secondCutResult.refundOperationIds[0], "provider_accepted")} provider_accepted`);
  const secondCutOperation = await loadRefundOperation(runtime, secondCutResult.refundOperationIds[0]);
  const secondCutRefusal = await messageOf(() => assertRefundMaySend(runtime, secondCutOperation!));
  report("the send gate refuses it until somebody approves", /waiting for a second person/.test(secondCutRefusal), secondCutRefusal);

  // The same rule at SEND time on a refund written before the policy crossed the threshold: the
  // first cut carries no approval request, and it may no longer leave on its own.
  const firstCutOperation = await loadRefundOperation(runtime, firstCutResult.refundOperationIds[0]);
  const firstCutRefusal = await messageOf(() => assertRefundMaySend(runtime, firstCutOperation!));
  report("a refund written under the threshold cannot be sent once the policy is over it", /above the approval threshold/.test(firstCutRefusal), firstCutRefusal);

  // A cancellation counts the endorsement refunds the policy already made. One reduction of $800
  // (59448 back), then a cancellation on 2028-11-01 giving back 53841: neither is above $1,000
  // on its own, and together they are 113289.
  const afterCut = await createPaidPolicy(recordSuccessfulPayment, 240000);
  const afterCutActor: Actor = { userId: afterCut.brokerUserId, role: "broker", brokerId: afterCut.brokerId, customerId: null };
  const cutFirst = { policyId: afterCut.policyId, effectiveAt: DAY_100, newAnnualPremiumCents: 160000, newPerOccurrenceLimitCents: PER_OCCURRENCE, newAggregateLimitCents: AGGREGATE, reason: null, actor: afterCutActor };
  const cutFirstPlan = await planEndorsement(cutFirst, runtime);
  await recordEndorsementRequest({ ...cutFirst, expectedQuoteHash: cutFirstPlan.figures.quoteHash }, runtime);
  const cancelAfterCut = await recordCancellation({ policyId: afterCut.policyId, effectiveAt: "2028-11-01", calculationMethod: "pro_rata", actor: { userId: afterCut.brokerUserId, role: "broker", brokerId: afterCut.brokerId } }, runtime);
  report("a cancellation after an endorsement refund counts that refund and waits for an approver", cancelAfterCut.plan.refundNeedsApproval && cancelAfterCut.approvalRequestIds.length > 0 && cancelAfterCut.plan.breakdown.totalRefundCents < 100000, `cancellation refund ${cancelAfterCut.plan.breakdown.totalRefundCents} cents alone, ${cancelAfterCut.approvalRequestIds.length} approval request(s)`);

  // ---------------------------------------------------------------------------
  // 5c. A delta that arrives after the policy is cancelled (review finding F-B4-05)
  // ---------------------------------------------------------------------------

  // The cancellation expires the policy's open hosted pages, so this is a race of seconds: the
  // customer paid just before that call. The money is real, so it is parked like any other delta
  // that cannot be applied, never recorded as arrived with nothing in the ledger.
  const raced = await createPaidPolicy(recordSuccessfulPayment);
  const racedActor: Actor = { userId: raced.brokerUserId, role: "broker", brokerId: raced.brokerId, customerId: null };
  const racedPlan = await planEndorsement({ ...raise, policyId: raced.policyId, actor: racedActor }, runtime);
  const racedRequest = await recordEndorsementRequest({ ...raise, policyId: raced.policyId, actor: racedActor, expectedQuoteHash: racedPlan.figures.quoteHash }, runtime);
  const racedQuote = (await readEndorsementRequest(runtime, raced.policyId, racedRequest.requestEventId))!;
  const racedAttempt = await createEndorsementCheckoutOperation({ quote: racedQuote, userId: raced.brokerUserId, attempt: 1 }, runtime);
  await recordCancellation({ policyId: raced.policyId, effectiveAt: "2028-08-01", calculationMethod: "pro_rata", actor: { userId: raced.brokerUserId, role: "broker", brokerId: raced.brokerId } }, runtime);
  const racedPayment = { operationId: racedAttempt.operationId, paymentIntentId: `pi_raced_${racedAttempt.operationId.slice(0, 8)}`, amountReceivedCents: 44584, paidOn: "2028-08-01" };
  const racedOutcome = await recordSuccessfulEndorsementPayment(racedPayment, runtime);
  report("a delta paid after the policy is cancelled is parked, not left out of the ledger", racedOutcome.kind === "application_refused" && (await entriesOfOperation(racedAttempt.operationId)).get("unapplied_cash_received") === 1, racedOutcome.kind === "application_refused" ? racedOutcome.reason : racedOutcome.kind);
  report("the parked cash is at Stripe and owed to the customer, and no endorsement was applied", (await amountOnOperation(racedAttempt.operationId, "cash_stripe", "debit")) === 44584 && (await amountOnOperation(racedAttempt.operationId, "unapplied_customer_cash", "credit")) === 44584 && !(await eventTypesOfPolicy(raced.policyId)).includes("endorsed"), `cash_stripe ${await amountOnOperation(racedAttempt.operationId, "cash_stripe", "debit")}, events ${(await eventTypesOfPolicy(raced.policyId)).join(",")}`);
  const racedTwice = await recordSuccessfulEndorsementPayment(racedPayment, runtime);
  report("delivering that payment twice parks it once", racedTwice.kind === "application_refused" && (await entriesOfOperation(racedAttempt.operationId)).get("unapplied_cash_received") === 1 && (await countOperationEvents(racedAttempt.operationId, "succeeded")) === 1, describe(await entriesOfOperation(racedAttempt.operationId)));
  // Staff cannot apply it either. The cancellation was recorded after the request, so the quote
  // is superseded and the standing says so first; the cancelled-policy check behind it refuses
  // the same thing. Either sentence is the right answer, and the money stays parked.
  const racedRetry = await retryEndorsementApplication({ policyId: raced.policyId, requestEventId: racedRequest.requestEventId, actorUserId: raced.staffUserId }, runtime);
  report("staff cannot apply it either, and the cash stays parked", racedRetry.kind === "refused" && /superseded|cancelled/.test(racedRetry.reason) && (await entriesOfOperation(racedAttempt.operationId)).size === 1, racedRetry.kind === "refused" ? racedRetry.reason : racedRetry.kind);

  // ---------------------------------------------------------------------------
  // 6. Refusals: cancelled, voided, unbound, outside the term, no change
  // ---------------------------------------------------------------------------

  const cancelled = await createPaidPolicy(recordSuccessfulPayment);
  await recordCancellation({ policyId: cancelled.policyId, effectiveAt: DAY_100, calculationMethod: "pro_rata", actor: { userId: cancelled.brokerUserId, role: "broker", brokerId: cancelled.brokerId } }, runtime);
  const onCancelled = await refusal(() => planEndorsement({ ...raise, policyId: cancelled.policyId, actor: { userId: cancelled.brokerUserId, role: "broker", brokerId: cancelled.brokerId, customerId: null } }, runtime));
  report("a cancelled policy cannot be endorsed", /cancelled/.test(onCancelled), onCancelled);

  const voided = await createPaidPolicy(recordSuccessfulPayment);
  await voidFabricatedBinding({ policyId: voided.policyId, reason: "endorsement check: this payment intent never existed at Stripe", actorUserId: voided.staffUserId }, runtime);
  const onVoided = await refusal(() => planEndorsement({ ...raise, policyId: voided.policyId, actor: { userId: voided.brokerUserId, role: "broker", brokerId: voided.brokerId, customerId: null } }, runtime));
  report("a voided policy cannot be endorsed", /voided/.test(onVoided), onVoided);

  const draft = await createPolicyAwaitingPayment();
  const onDraft = await refusal(() => planEndorsement({ ...raise, policyId: draft.policyId, actor: { userId: draft.brokerUserId, role: "broker", brokerId: draft.brokerId, customerId: null } }, runtime));
  report("an unbound policy cannot be endorsed", /not bound/.test(onDraft), onDraft);

  const beforeTerm = await refusal(() => planEndorsement({ ...raise, policyId: big.policyId, effectiveAt: "2028-02-29", actor: bigBroker }, runtime));
  const afterTerm = await refusal(() => planEndorsement({ ...raise, policyId: big.policyId, effectiveAt: "2029-03-02", actor: bigBroker }, runtime));
  const notADate = await refusal(() => planEndorsement({ ...raise, policyId: big.policyId, effectiveAt: "2028-02-30", actor: bigBroker }, runtime));
  report("the effective date must be inside the term", /before the policy starts/.test(beforeTerm) && /ends on 2029-03-01/.test(afterTerm) && /not a calendar date/.test(notADate), `${beforeTerm} | ${afterTerm} | ${notADate}`);
  const noChange = await refusal(() => planEndorsement({ ...raise, policyId: big.policyId, newAnnualPremiumCents: ANNUAL_PREMIUM_CENTS, newPerOccurrenceLimitCents: PER_OCCURRENCE, newAggregateLimitCents: AGGREGATE, actor: bigBroker }, runtime));
  report("an endorsement that changes nothing is refused", /nothing changes/.test(noChange), noChange);
  const wrongActor = await refusal(() => planEndorsement({ ...raise, policyId: big.policyId, actor: bigCustomer }, runtime));
  report("a customer cannot request an endorsement", /only the broker/.test(wrongActor), wrongActor);

  // ---------------------------------------------------------------------------
  // 7. The whole ledger still balances
  // ---------------------------------------------------------------------------

  const [totals] = await owner<{ debit: string; credit: string }[]>`
    select coalesce(sum(debit_cents), 0)::text as debit, coalesce(sum(credit_cents), 0)::text as credit from journal_lines
  `;
  report("every journal line in the database balances, debits against credits", totals.debit === totals.credit, `debits ${totals.debit} = credits ${totals.credit}`);

  await owner.end();
  await runtime.end();
  process.exit(failures === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Fixtures and reads
// ---------------------------------------------------------------------------

type Fixture = {
  policyId: string;
  brokerId: string;
  customerId: string;
  brokerUserId: string;
  customerUserId: string;
  staffUserId: string;
  approverUserId: string;
  operationId: string;
  paymentIntentId: string;
};

// The rows the application writes before a payment: a broker (approved, provider 'seed' so the
// settling window does not apply), a customer, three users, a policy, its quote and a money
// operation awaiting the provider.
async function createPolicyAwaitingPayment(annualPremiumCents = ANNUAL_PREMIUM_CENTS): Promise<Fixture> {
  const taxCents = annualPremiumCents === ANNUAL_PREMIUM_CENTS ? TAX_CENTS : Math.floor((annualPremiumCents * 235) / 10000);
  const totalCents = annualPremiumCents + taxCents + FEE_CENTS;
  return owner.begin(async (transaction) => {
    const [broker] = await transaction<{ id: string }[]>`insert into brokers (name, commission_rate_bps) values ('Endorsement check broker', 1500) returning id`;
    await transaction`insert into broker_kyb_events (broker_id, provider, status) values (${broker.id}, 'seed', 'approved')`;
    const [customer] = await transaction<{ id: string }[]>`
      insert into customers (name, email) values ('Endorsement check customer', 'endorsement-check-' || gen_random_uuid()::text || '@example.invalid') returning id
    `;
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    const [brokerUser] = await transaction<{ id: string }[]>`
      insert into users (email, display_name, role, broker_id) values (${`endorsement-broker-${suffix}@example.invalid`}, 'Endorsement check broker user', 'broker', ${broker.id}) returning id
    `;
    const [customerUser] = await transaction<{ id: string }[]>`
      insert into users (email, display_name, role, customer_id) values (${`endorsement-customer-${suffix}@example.invalid`}, 'Endorsement check customer user', 'customer', ${customer.id}) returning id
    `;
    const [staffUser] = await transaction<{ id: string }[]>`
      insert into users (email, display_name, role) values (${`endorsement-ops-${suffix}@example.invalid`}, 'Endorsement check operator', 'staff_ops') returning id
    `;
    // The second human of maker-checker: needed as soon as a reduction gives back over $1,000.
    const [approverUser] = await transaction<{ id: string }[]>`
      insert into users (email, display_name, role) values (${`endorsement-approver-${suffix}@example.invalid`}, 'Endorsement check approver', 'staff_approver') returning id
    `;
    const [policy] = await transaction<{ id: string }[]>`insert into policies (broker_id, customer_id, state_code) values (${broker.id}, ${customer.id}, 'CA') returning id`;
    await transaction`
      insert into policy_events (policy_id, event_type, effective_at, payload)
      values (${policy.id}, 'quoted', ${TERM_START}, ${transaction.json({
        state_code: "CA", term_start: TERM_START, term_end: TERM_END, annual_premium_cents: annualPremiumCents, tax_rate_bps: 235,
        tax_cents: taxCents, fee_cents: FEE_CENTS, total_charge_cents: totalCents, per_occurrence_limit_cents: PER_OCCURRENCE, aggregate_limit_cents: AGGREGATE,
      })})
    `;
    const [operation] = await transaction<{ id: string }[]>`
      insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key)
      values ('stripe_checkout', 'stripe', ${totalCents}, ${policy.id}, 'policy-checkout:' || ${policy.id}) returning id
    `;
    await transaction`insert into money_operation_events (operation_id, status) values (${operation.id}, 'requested')`;
    return {
      policyId: policy.id, brokerId: broker.id, customerId: customer.id, brokerUserId: brokerUser.id, customerUserId: customerUser.id, staffUserId: staffUser.id,
      approverUserId: approverUser.id, operationId: operation.id, paymentIntentId: `pi_endorsement_check_${operation.id.slice(0, 8)}`,
    };
  });
}

async function createPaidPolicy(
  recordSuccessfulPayment: typeof import("@/lib/payments/collection").recordSuccessfulPayment,
  annualPremiumCents = ANNUAL_PREMIUM_CENTS,
): Promise<Fixture> {
  const fixture = await createPolicyAwaitingPayment(annualPremiumCents);
  const [operation] = await owner<{ amount_cents: string }[]>`select amount_cents from money_operations where id = ${fixture.operationId}`;
  const collected = await recordSuccessfulPayment(
    { operationId: fixture.operationId, paymentIntentId: fixture.paymentIntentId, amountReceivedCents: Number(operation.amount_cents), paidOn: TERM_START },
    runtime,
  );
  if (collected.kind !== "posted") {
    throw new Error(`the fixture policy could not be paid: ${JSON.stringify(collected)}`);
  }
  return fixture;
}

async function eventTypesOfPolicy(policyId: string): Promise<string[]> {
  const rows = await owner<{ event_type: string }[]>`select event_type from policy_events where policy_id = ${policyId} order by sequence_number`;
  return rows.map((row) => row.event_type);
}

async function policyCurrent(policyId: string): Promise<{ status: string; annual: number; perOccurrence: number }> {
  const [row] = await owner<{ status: string; annual_premium_cents: string; per_occurrence_limit_cents: string }[]>`
    select status, annual_premium_cents, per_occurrence_limit_cents from policy_current where policy_id = ${policyId}
  `;
  return { status: row?.status ?? "no cache row", annual: Number(row?.annual_premium_cents ?? -1), perOccurrence: Number(row?.per_occurrence_limit_cents ?? -1) };
}

async function deltaAttempts(requestEventId: string): Promise<{ id: string; idempotency_key: string; amount_cents: string; session_id: string | null }[]> {
  return owner<{ id: string; idempotency_key: string; amount_cents: string; session_id: string | null }[]>`
    select operation.id, operation.idempotency_key, operation.amount_cents,
           (select event.provider_ref from money_operation_events event where event.operation_id = operation.id and event.status = 'provider_accepted' order by event.sequence_number limit 1) as session_id
      from endorsement_collections link
      join money_operations operation on operation.id = link.collection_operation_id
     where link.request_event_id = ${requestEventId}
     order by operation.created_at
  `;
}

async function entriesOfOperation(operationId: string): Promise<Map<string, number>> {
  const rows = await owner<{ entry_type: string; count: string }[]>`
    select entry_type, count(*)::text as count from journal_entries where source_kind = 'money_operation' and source_id = ${operationId} group by entry_type order by entry_type
  `;
  return new Map(rows.map((row) => [row.entry_type, Number(row.count)]));
}

async function entryTypesOfPolicy(policyId: string): Promise<Map<string, number>> {
  const rows = await owner<{ entry_type: string; count: string }[]>`
    select entry_type, count(*)::text as count from journal_entries where policy_id = ${policyId} group by entry_type order by entry_type
  `;
  return new Map(rows.map((row) => [row.entry_type, Number(row.count)]));
}

function describe(entryTypes: Map<string, number>): string {
  return [...entryTypes.entries()].map(([type, count]) => `${type} x${count}`).join(", ") || "no entry";
}

async function countEntriesOfPolicy(policyId: string): Promise<number> {
  const [row] = await owner<{ count: string }[]>`select count(*)::text as count from journal_entries where policy_id = ${policyId}`;
  return Number(row.count);
}

// Total on one side of one account under one operation; -1 when no line exists.
async function amountOnOperation(operationId: string, accountId: string, side: "debit" | "credit"): Promise<number> {
  const [row] = await owner<{ amount: string | null }[]>`
    select sum(${side === "debit" ? owner`line.debit_cents` : owner`line.credit_cents`})::text as amount
      from journal_lines line join journal_entries entry on entry.id = line.entry_id
     where entry.source_kind = 'money_operation' and entry.source_id = ${operationId} and line.account_id = ${accountId}
  `;
  return row.amount === null ? -1 : Number(row.amount);
}

async function accountBalance(policyId: string, accountId: string, side: "debit" | "credit"): Promise<number> {
  const [row] = await owner<{ amount: string }[]>`
    select coalesce(sum(${side === "debit" ? owner`line.debit_cents` : owner`line.credit_cents`}), 0)::text as amount
      from journal_lines line join journal_entries entry on entry.id = line.entry_id
     where entry.policy_id = ${policyId} and line.account_id = ${accountId}
  `;
  return Number(row.amount);
}

async function netBalance(policyId: string, accountId: string): Promise<number> {
  const [row] = await owner<{ amount: string }[]>`
    select coalesce(sum(line.debit_cents) - sum(line.credit_cents), 0)::text as amount
      from journal_lines line join journal_entries entry on entry.id = line.entry_id
     where entry.policy_id = ${policyId} and line.account_id = ${accountId}
  `;
  return Number(row.amount);
}

async function countOperationEvents(operationId: string, status: string): Promise<number> {
  const [row] = await owner<{ count: string }[]>`select count(*)::text as count from money_operation_events where operation_id = ${operationId} and status = ${status}`;
  return Number(row.count);
}

async function operationIdempotencyKey(operationId: string): Promise<string> {
  const [row] = await owner<{ idempotency_key: string }[]>`select idempotency_key from money_operations where id = ${operationId}`;
  return row?.idempotency_key ?? "no operation";
}

async function allocationOf(operationId: string): Promise<string> {
  const [row] = await owner<{ refunded_premium_cents: string; refunded_tax_cents: string; commission_clawback_cents: string; payment_intent_id: string }[]>`
    select refunded_premium_cents, refunded_tax_cents, commission_clawback_cents, payment_intent_id from refund_allocations where refund_operation_id = ${operationId}
  `;
  return row ? `${row.refunded_premium_cents}/${row.refunded_tax_cents}/${row.commission_clawback_cents}/${row.payment_intent_id}` : "no allocation";
}

main().catch(async (error) => {
  console.error("check failed to run:", error instanceof Error ? (error.stack ?? error.message) : error);
  // Postgres names the waiting processes and the query on a lock failure: keep that visible.
  const details = error as { detail?: string; query?: string; hint?: string };
  if (details.detail || details.query) {
    console.error(details.detail ?? "", (details.query ?? "").slice(0, 300));
  }
  await owner.end();
  await runtime.end();
  process.exit(1);
});
