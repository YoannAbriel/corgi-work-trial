import postgres from "postgres";

// Proves, against a real database and through the production functions, the properties slice B7
// rests on:
//
//   1. a reserve set, adjusted, drawn down by a payment, settled and returned posts exactly the
//      entries of ARCHITECTURE.md section 2, and incurred = paid + reserve holds after each one,
//      in the fold AND in the journal;
//   2. a payment past the reserve, past the per-occurrence limit or past the aggregate limit is
//      refused, inside the transaction that holds the claim lock;
//   3. two payment requests made at the same moment produce at most one payment;
//   4. maker-checker: the requester cannot approve, a non-approver cannot approve, a rejected
//      request releases the payment, and an approval given for one destination account does not
//      authorise paying a different one;
//   5. an approved payment executes once, even when two executions race;
//   6. a cancellation refund above $1,000 stays in 'requested' until a second person approves it,
//      and cannot be sent twice afterwards.
//
// It runs the production functions with the RESTRICTED runtime role, so it also proves that all
// of this works with the privileges the deployed application actually has.
//
// It commits rows, so it refuses to run anywhere but the disposable database corgi_test:
// financial rows can never be deleted (AF-03) and the trial ledger must stay clean.
// Run with: npm run check:claims-and-approvals

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

// The worked example of ARCHITECTURE.md section 2.
const RESERVE_CENTS = 500000; // $5,000
const REDUCED_RESERVE_CENTS = 400000; // $4,000
const PAYMENT_CENTS = 120000; // $1,200, above the $1,000 approval threshold

// The policy the claims are opened on. Limits chosen so that the per-occurrence and aggregate
// ceilings can both be reached without absurd amounts.
const ANNUAL_PREMIUM_CENTS = 120000;
const TAX_CENTS = 2820;
const FEE_CENTS = 2500;
const TOTAL_CHARGE_CENTS = 125320;
const TERM_START = "2028-03-01";
const TERM_END = "2029-03-01";
const PER_OCCURRENCE_LIMIT_CENTS = 1000000; // $10,000
const AGGREGATE_LIMIT_CENTS = 1500000; // $15,000

const REACHABLE_ROUTING_NUMBER = "110000000";
const CLAIMANT_NAME = "Bay Area Fabrication LLC";

let failures = 0;
function report(name: string, passed: boolean, detail: string) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}  (${detail})`);
  if (!passed) failures += 1;
}

const owner = postgres(ownerUrl, { max: 2, prepare: false });
// Four connections: the concurrency checks need two transactions in flight at once.
const runtime = postgres(runtimeUrl, { max: 4, prepare: false });

async function main() {
  // Imported here rather than at the top of the file: these modules open the application
  // connection pool and read the Stripe key as soon as they are loaded, which needs
  // .env.local read first.
  const { recordSuccessfulPayment } = await import("@/lib/payments/collection");
  const { openClaim, setClaimReserve, closeClaim, todayUtc, ClaimRefused } = await import("@/lib/claims/claims");
  const {
    addClaimantBankAccount,
    assertPaymentBelongsToClaim,
    requestClaimPayment,
    sendClaimPayment,
    settleClaimPayment,
    returnClaimPayment,
  } = await import("@/lib/claims/payments");
  const { decideApprovalRequest, approvalRequest, assertIntentIsApproved, ApprovalRefused } = await import(
    "@/lib/approvals/approvals"
  );
  const { claimPaymentIntent } = await import("@/lib/claims/payments");
  const { recordCancellation } = await import("@/lib/policy/cancel");
  const { assertRefundMaySend, createReissuedRefundOperation, issueRefundsAtStripe, loadRefundOperation, RefundSendRefused } = await import(
    "@/lib/payments/refunds"
  );
  const { stuckOperations, recoverStuckOperation, STUCK_AFTER_MINUTES } = await import("@/lib/payments/recover");

  const [{ current_database: databaseName }] = await owner<{ current_database: string }[]>`
    select current_database()
  `;
  if (databaseName !== "corgi_test") {
    console.error(`refusing to run: connected to "${databaseName}", expected the disposable database "corgi_test"`);
    process.exit(1);
  }

  const people = await createPeople();
  const maker = { userId: people.makerId, role: "staff_ops" as const };
  const otherMaker = { userId: people.otherMakerId, role: "staff_ops" as const };
  const checker = { userId: people.checkerId, role: "staff_approver" as const };

  // ---------------------------------------------------------------------------
  // 1. The worked example, step by step, in the fold and in the journal
  // ---------------------------------------------------------------------------

  const policy = await createPaidPolicy(recordSuccessfulPayment, people.brokerId);
  const claim = await openClaim(
    {
      policyId: policy.policyId,
      occurredAt: "2028-05-01",
      reportedAt: "2028-05-02",
      openedOn: "2028-05-02", // the claim is opened on the day the loss is reported
      description: "water damage in the workshop",
      claimantName: CLAIMANT_NAME,
      actor: maker,
    },
    runtime,
  );
  report("a claim can be opened on a bound policy", claim.claimNumber.startsWith("CLM-"), claim.claimNumber);

  await setClaimReserve({ claimId: claim.claimId, newReserveCents: RESERVE_CENTS, note: "first estimate", actor: maker }, runtime);
  await expectIdentity("after the reserve is set", claim.claimId, { reserve: RESERVE_CENTS, paid: 0, settled: 0 });
  report(
    "setting the reserve posts one entry: expense against the reserve",
    (await entryTypes(claim.claimId)).get("claim_reserve_set") === 1,
    describe(await entryTypes(claim.claimId)),
  );

  const adjustment = await setClaimReserve(
    { claimId: claim.claimId, newReserveCents: REDUCED_RESERVE_CENTS, note: "engineer's estimate", actor: maker },
    runtime,
  );
  report("adjusting the reserve books the difference, not the new level", adjustment.deltaCents === -100000, `${adjustment.deltaCents} cents`);
  await expectIdentity("after the reserve is lowered to $4,000", claim.claimId, {
    reserve: REDUCED_RESERVE_CENTS,
    paid: 0,
    settled: 0,
  });

  // The bank account the money would go to.
  const verified = await addClaimantBankAccount(
    {
      claimId: claim.claimId,
      accountHolderName: CLAIMANT_NAME,
      routingNumber: REACHABLE_ROUTING_NUMBER,
      accountNumber: "000123456789",
      actor: maker,
    },
    runtime,
  );
  report("the claimant's bank account is verified by the simulator", verified.status === "verified", verified.reason);
  report(
    "no bank account number is stored, only the last four digits and a token",
    verified.accountToken.startsWith("sim_ba_") && !verified.accountToken.includes("123456789"),
    `${verified.routingNumberLast4} / ${verified.accountNumberLast4} / ${verified.accountToken}`,
  );

  // A payment to an account held by somebody else is refused before it is ever requested.
  const wrongHolder = await addClaimantBankAccount(
    {
      claimId: claim.claimId,
      accountHolderName: "Someone Else Holdings",
      routingNumber: REACHABLE_ROUTING_NUMBER,
      accountNumber: "000999999999",
      actor: maker,
    },
    runtime,
  );
  report("an account held by somebody else fails the ownership check", wrongHolder.status === "failed", wrongHolder.reason);
  const refusedOnUnverified = await refusal(() =>
    requestClaimPayment({ claimId: claim.claimId, amountCents: PAYMENT_CENTS, actor: maker }, runtime),
  );
  report(
    "a payment cannot be requested while the latest account is not verified",
    /not verified|"failed"/.test(refusedOnUnverified),
    refusedOnUnverified,
  );

  // Put the verified account back: the latest row wins, and re-recording the same account gives
  // the same token, so an approval bound to it stays valid.
  const verifiedAgain = await addClaimantBankAccount(
    {
      claimId: claim.claimId,
      accountHolderName: CLAIMANT_NAME,
      routingNumber: REACHABLE_ROUTING_NUMBER,
      accountNumber: "000123456789",
      actor: maker,
    },
    runtime,
  );
  report(
    "re-recording the same account gives the same destination token",
    verifiedAgain.accountToken === verified.accountToken,
    verifiedAgain.accountToken,
  );

  // ---------------------------------------------------------------------------
  // 2. The three ceilings
  // ---------------------------------------------------------------------------

  const pastTheReserve = await refusal(() =>
    requestClaimPayment({ claimId: claim.claimId, amountCents: REDUCED_RESERVE_CENTS + 1, actor: maker }, runtime),
  );
  report(
    "a payment larger than the reserve is refused, and says to raise the reserve first",
    /left in the reserve/.test(pastTheReserve) && /raise the reserve first/.test(pastTheReserve),
    pastTheReserve,
  );

  // The reserve is checked before the limits, so it has to be raised above the per-occurrence
  // limit before that limit is the thing that refuses.
  await setClaimReserve(
    { claimId: claim.claimId, newReserveCents: PER_OCCURRENCE_LIMIT_CENTS + 100000, note: "raised to reach the limit", actor: maker },
    runtime,
  );
  const pastPerOccurrence = await refusal(() =>
    requestClaimPayment({ claimId: claim.claimId, amountCents: PER_OCCURRENCE_LIMIT_CENTS + 1, actor: maker }, runtime),
  );
  report(
    "a payment past the per-occurrence limit is refused",
    /past the per-occurrence limit/.test(pastPerOccurrence),
    pastPerOccurrence,
  );

  // The aggregate limit is about the WHOLE policy, so it takes a second claim to reach it:
  // $8,000 waiting on one claim plus $8,000 asked on this one is $16,000, past the $15,000
  // aggregate, while each one on its own is inside the $10,000 per-occurrence limit.
  const secondClaim = await openClaim(
    {
      policyId: policy.policyId,
      occurredAt: "2028-05-03",
      reportedAt: "2028-05-04",
      openedOn: "2028-05-04", // the claim is opened on the day the loss is reported
      description: "a second loss on the same policy",
      claimantName: CLAIMANT_NAME,
      actor: maker,
    },
    runtime,
  );
  await setClaimReserve({ claimId: secondClaim.claimId, newReserveCents: 800000, note: "second loss", actor: maker }, runtime);
  await addClaimantBankAccount(
    {
      claimId: secondClaim.claimId,
      accountHolderName: CLAIMANT_NAME,
      routingNumber: REACHABLE_ROUTING_NUMBER,
      accountNumber: "000123456789",
      actor: maker,
    },
    runtime,
  );
  const onTheSecondClaim = await requestClaimPayment(
    { claimId: secondClaim.claimId, amountCents: 800000, actor: maker },
    runtime,
  );
  const pastAggregate = await refusal(() =>
    requestClaimPayment({ claimId: claim.claimId, amountCents: 800000, actor: maker }, runtime),
  );
  report(
    "a payment inside the per-occurrence limit but past the aggregate limit is refused",
    /past the aggregate limit/.test(pastAggregate),
    pastAggregate,
  );

  // Reject that second payment so the policy is back to a clean state for the rest of the run,
  // and so the aggregate it was holding is released.
  await decideApprovalRequest(
    {
      requestId: onTheSecondClaim.approvalRequestId as string,
      decidedByUserId: checker.userId,
      decidedByRole: "staff_approver",
      decision: "rejected",
      reason: "asked only to reach the aggregate limit in this check",
    },
    runtime,
  );
  await setClaimReserve({ claimId: secondClaim.claimId, newReserveCents: 0, note: "no further liability", actor: maker }, runtime);

  // Back to the worked example's reserve.
  await setClaimReserve({ claimId: claim.claimId, newReserveCents: REDUCED_RESERVE_CENTS, note: "back to the estimate", actor: maker }, runtime);
  await expectIdentity("after the reserve is put back to $4,000", claim.claimId, {
    reserve: REDUCED_RESERVE_CENTS,
    paid: 0,
    settled: 0,
  });

  // ---------------------------------------------------------------------------
  // 3. Two requests at the same moment
  // ---------------------------------------------------------------------------

  // The reserve is $4,000 and each request asks for $2,500: one of them has to lose.
  const concurrentAmountCents = 250000;
  const bothRequests = await Promise.allSettled([
    requestClaimPayment({ claimId: claim.claimId, amountCents: concurrentAmountCents, actor: maker }, runtime),
    requestClaimPayment({ claimId: claim.claimId, amountCents: concurrentAmountCents, actor: otherMaker }, runtime),
  ]);
  const accepted = bothRequests.filter((outcome) => outcome.status === "fulfilled");
  const rejected = bothRequests.filter((outcome) => outcome.status === "rejected");
  report(
    "two payment requests made at the same moment produce at most one payment",
    accepted.length === 1 && rejected.length === 1,
    `${accepted.length} accepted, ${rejected.length} refused: ${
      rejected[0]?.status === "rejected" ? String((rejected[0] as PromiseRejectedResult).reason?.message).slice(0, 90) : ""
    }`,
  );
  const survivingRequest = accepted[0] as PromiseFulfilledResult<{ operationId: string; approvalRequestId: string | null }>;

  // That request is above $1,000, so it is waiting for an approver and has moved nothing.
  report(
    "a payment above the threshold is queued for approval instead of being sent",
    survivingRequest.value.approvalRequestId !== null,
    `approval request ${survivingRequest.value.approvalRequestId}`,
  );
  await expectIdentity("while the payment is only requested", claim.claimId, {
    reserve: REDUCED_RESERVE_CENTS,
    paid: 0,
    settled: 0,
  });

  // ---------------------------------------------------------------------------
  // 4. Maker-checker
  // ---------------------------------------------------------------------------

  const queuedRequestId = survivingRequest.value.approvalRequestId as string;
  const queuedOperationId = survivingRequest.value.operationId;
  const whoAsked = (await approvalRequest(runtime, queuedRequestId))?.requestedByUserId;

  const beforeApproval = await refusal(() => sendClaimPayment({ operationId: queuedOperationId, actor: maker }, runtime));
  report(
    "an unapproved payment cannot be sent, however it is called",
    /waiting for a second person/.test(beforeApproval),
    beforeApproval,
  );

  const selfApproval = await refusal(() =>
    decideApprovalRequest(
      { requestId: queuedRequestId, decidedByUserId: whoAsked as string, decidedByRole: "staff_approver", decision: "approved", reason: null },
      runtime,
    ),
  );
  report("the person who asked cannot approve it", /cannot approve it/.test(selfApproval), selfApproval);

  const byAnOperator = await refusal(() =>
    decideApprovalRequest(
      { requestId: queuedRequestId, decidedByUserId: people.otherMakerId, decidedByRole: "staff_ops", decision: "approved", reason: null },
      runtime,
    ),
  );
  report("somebody who is not a staff approver cannot approve it", /only a staff approver/.test(byAnOperator), byAnOperator);

  // The same refusal straight at the database, with no application check in the way: a
  // staff_ops user claiming, through a forged session or a future code path, to be an approver.
  const atTheDatabase = await refusal(() =>
    decideApprovalRequest(
      { requestId: queuedRequestId, decidedByUserId: people.otherMakerId, decidedByRole: "staff_approver", decision: "approved", reason: null },
      runtime,
    ),
  );
  report(
    "the database refuses it too, even when the application is told the role is staff_approver",
    /only a staff_approver may decide/.test(atTheDatabase),
    atTheDatabase,
  );

  await decideApprovalRequest(
    { requestId: queuedRequestId, decidedByUserId: checker.userId, decidedByRole: "staff_approver", decision: "approved", reason: "checked" },
    runtime,
  );
  report(
    "a distinct staff approver can approve it",
    (await approvalRequest(runtime, queuedRequestId))?.decision === "approved",
    "approved",
  );

  // A CHANGED INTENT. The approval was given for the account ending 6789; recording another
  // account makes the destination different, and the approval no longer covers the payment.
  const differentAccount = await addClaimantBankAccount(
    {
      claimId: claim.claimId,
      accountHolderName: CLAIMANT_NAME,
      routingNumber: REACHABLE_ROUTING_NUMBER,
      accountNumber: "000555554444",
      actor: maker,
    },
    runtime,
  );
  report("the second account is verified too, so only the destination differs", differentAccount.status === "verified", differentAccount.accountToken);
  const changedIntent = await refusal(() => sendClaimPayment({ operationId: queuedOperationId, actor: maker }, runtime));
  report(
    "an approval does not authorise paying a DIFFERENT account: the changed intent is refused",
    /no longer what was approved/.test(changedIntent),
    changedIntent,
  );
  const changedIntentAtTheGuard = await refusal(() =>
    assertIntentIsApproved(runtime, queuedRequestId, claimPaymentIntent(claim.claimId, concurrentAmountCents, differentAccount.accountToken)),
  );
  report(
    "the same refusal comes from the guard itself, given the new destination",
    /no longer what was approved/.test(changedIntentAtTheGuard),
    changedIntentAtTheGuard,
  );

  // Put the approved account back and the approval matches again.
  await addClaimantBankAccount(
    {
      claimId: claim.claimId,
      accountHolderName: CLAIMANT_NAME,
      routingNumber: REACHABLE_ROUTING_NUMBER,
      accountNumber: "000123456789",
      actor: maker,
    },
    runtime,
  );

  // ---------------------------------------------------------------------------
  // 5. Executing the approved payment, twice, at the same moment
  // ---------------------------------------------------------------------------

  const bothSends = await Promise.allSettled([
    sendClaimPayment({ operationId: queuedOperationId, actor: maker }, runtime),
    sendClaimPayment({ operationId: queuedOperationId, actor: otherMaker }, runtime),
  ]);
  const sendOutcomes = bothSends.map((outcome) =>
    outcome.status === "fulfilled" ? outcome.value.outcome : `refused: ${String(outcome.reason?.message).slice(0, 60)}`,
  );
  report(
    "two executions of the same approved payment produce ONE payment",
    (await claimEventCount(claim.claimId, "payment_sent")) === 1 &&
      (await entryTypes(claim.claimId)).get("claim_payment_sent") === 1 &&
      (await providerRecordCount(queuedOperationId, "sent")) === 1,
    `outcomes ${sendOutcomes.join(" and ")}; one claim event, one journal entry, one transfer at the rail`,
  );
  await expectIdentity("after the payment is sent", claim.claimId, {
    reserve: REDUCED_RESERVE_CENTS - concurrentAmountCents,
    paid: concurrentAmountCents,
    settled: 0,
  });

  // ---------------------------------------------------------------------------
  // 6. Settling and returning on the simulated rail
  // ---------------------------------------------------------------------------

  const settlement = await settleClaimPayment(
    { operationId: queuedOperationId, settledOn: "2028-05-12", settledBy: maker },
    runtime,
  );
  report("the rail settles the payment", settlement.outcome === "settled", settlement.outcome);
  const settledAgain = await settleClaimPayment(
    { operationId: queuedOperationId, settledOn: "2028-05-12", settledBy: maker },
    runtime,
  );
  report("running the settlement again does nothing", settledAgain.outcome === "already_settled", settledAgain.outcome);
  await expectIdentity("after the rail settles it", claim.claimId, {
    reserve: REDUCED_RESERVE_CENTS - concurrentAmountCents,
    paid: concurrentAmountCents,
    settled: concurrentAmountCents,
  });

  const returned = await returnClaimPayment(
    { operationId: queuedOperationId, returnedOn: "2028-05-20", returnReason: "account_closed", actor: maker },
    runtime,
  );
  report("the bank returns the payment", returned.outcome === "returned", returned.outcome);
  await expectIdentity("after the bank returns it: the claim is exactly where it was", claim.claimId, {
    reserve: REDUCED_RESERVE_CENTS,
    paid: 0,
    settled: 0,
  });
  const finalTypes = await entryTypes(claim.claimId);
  report(
    "the return posts both entries: the cash comes back and the reserve is restored",
    finalTypes.get("claim_payment_returned") === 1 && finalTypes.get("claim_reserve_restored") === 1,
    describe(finalTypes),
  );

  // ---------------------------------------------------------------------------
  // 7. A rejected approval releases the payment instead of holding the reserve
  // ---------------------------------------------------------------------------

  const rejectedRequest = await requestClaimPayment(
    { claimId: claim.claimId, amountCents: PAYMENT_CENTS, actor: maker },
    runtime,
  );
  await decideApprovalRequest(
    {
      requestId: rejectedRequest.approvalRequestId as string,
      decidedByUserId: checker.userId,
      decidedByRole: "staff_approver",
      decision: "rejected",
      reason: "the estimate is not supported by the file",
    },
    runtime,
  );
  const afterRejection = await refusal(() => sendClaimPayment({ operationId: rejectedRequest.operationId, actor: maker }, runtime));
  report(
    "a rejected payment cannot be sent",
    /refused or rejected|was rejected/.test(afterRejection),
    afterRejection,
  );
  report(
    "a rejected payment stops holding its place against the reserve",
    (await pendingCents(claim.claimId)) === 0,
    `${await pendingCents(claim.claimId)} cents pending`,
  );
  await expectIdentity("after the rejection: nothing moved", claim.claimId, {
    reserve: REDUCED_RESERVE_CENTS,
    paid: 0,
    settled: 0,
  });

  // ---------------------------------------------------------------------------
  // 8. Closing, and a claim on a cancelled policy
  // ---------------------------------------------------------------------------

  const closeWithReserve = await refusal(() => closeClaim({ claimId: claim.claimId, note: null, actor: maker }, runtime));
  report(
    "a claim still holding a reserve cannot be closed silently",
    /adjust the reserve to zero first/.test(closeWithReserve),
    closeWithReserve,
  );
  await setClaimReserve({ claimId: claim.claimId, newReserveCents: 0, note: "no further liability", actor: maker }, runtime);
  await closeClaim({ claimId: claim.claimId, note: "closed with no payment", actor: maker }, runtime);
  await expectIdentity("after the claim is closed", claim.claimId, { reserve: 0, paid: 0, settled: 0 });
  const afterClosing = await refusal(() =>
    setClaimReserve({ claimId: claim.claimId, newReserveCents: 1000, note: null, actor: maker }, runtime),
  );
  report("a closed claim's reserve can no longer be moved", /closed/.test(afterClosing), afterClosing);

  // ---------------------------------------------------------------------------
  // 9. The cancellation refund above the threshold waits for an approver
  // ---------------------------------------------------------------------------

  const cancelledPolicy = await createPaidPolicy(recordSuccessfulPayment, people.brokerId);
  // Cancelled on day 1, so almost the whole premium comes back: well above $1,000.
  const cancellation = await recordCancellation(
    {
      policyId: cancelledPolicy.policyId,
      effectiveAt: "2028-03-02",
      calculationMethod: "pro_rata",
      actor: { userId: maker.userId, role: "staff_ops", brokerId: null },
    },
    runtime,
  );
  report(
    "a refund above $1,000 is queued for approval by the cancellation itself",
    cancellation.refundOperationIdsAwaitingApproval.length === 1 && cancellation.approvalRequestIds.length === 1,
    `${cancellation.plan.breakdown.totalRefundCents} cents, ${cancellation.approvalRequestIds.length} approval request(s)`,
  );
  const refundOperationId = cancellation.refundOperationIds[0];
  report(
    "the cancellation is recorded anyway: the policy is cancelled and the customer is owed the money",
    (await policyStatus(cancelledPolicy.policyId)) === "cancelled" &&
      (await netBalance(cancelledPolicy.policyId, "refund_payable")) === -cancellation.plan.breakdown.totalRefundCents,
    `status cancelled, refund_payable net ${await netBalance(cancelledPolicy.policyId, "refund_payable")} cents`,
  );
  report(
    "nothing was sent to Stripe: the operation is still only 'requested'",
    (await operationStatuses(refundOperationId)).join(",") === "requested",
    (await operationStatuses(refundOperationId)).join(","),
  );

  const refundBeforeApproval = await refusal(async () => {
    const operation = await loadRefundOperation(runtime, refundOperationId);
    await assertRefundMaySend(runtime, operation!);
  });
  report(
    "the refund cannot be sent before it is approved",
    /waiting for a second person/.test(refundBeforeApproval),
    refundBeforeApproval,
  );

  await decideApprovalRequest(
    {
      requestId: cancellation.approvalRequestIds[0],
      decidedByUserId: checker.userId,
      decidedByRole: "staff_approver",
      decision: "approved",
      reason: "cancellation checked",
    },
    runtime,
  );
  const afterRefundApproval = await refusal(async () => {
    const operation = await loadRefundOperation(runtime, refundOperationId);
    await assertRefundMaySend(runtime, operation!);
  });
  report(
    "once approved, the refund is allowed to go to Stripe",
    afterRefundApproval === "no error raised",
    afterRefundApproval,
  );

  // The second execution: as soon as Stripe has accepted the refund, the operation carries its
  // id and the guard refuses to send it again. That, plus the shared idempotency key, is why a
  // concurrent execution cannot pay the customer twice.
  await runtime`
    insert into money_operation_events (operation_id, status, provider_ref, payload)
    values (${refundOperationId}, 'provider_accepted', 're_check_claims_and_approvals',
            ${runtime.json({ note: "stands in for Stripe accepting the refund" })})
  `;
  const secondSend = await refusal(async () => {
    const operation = await loadRefundOperation(runtime, refundOperationId);
    await assertRefundMaySend(runtime, operation!);
  });
  report(
    "a second execution of the same approved refund is refused",
    /already been created at Stripe/.test(secondSend),
    secondSend,
  );

  // ---------------------------------------------------------------------------
  // 10. A claim on a policy that has been cancelled
  // ---------------------------------------------------------------------------

  const lossWhileCovered = await openClaim(
    {
      policyId: cancelledPolicy.policyId,
      occurredAt: "2028-03-01",
      reportedAt: "2028-06-01",
      openedOn: "2028-06-01", // the claim is opened on the day the loss is reported
      description: "loss on the first day, reported after the cancellation",
      claimantName: CLAIMANT_NAME,
      actor: maker,
    },
    runtime,
  );
  report(
    "a loss that happened while a since-cancelled policy was in force can still be claimed",
    lossWhileCovered.claimNumber.startsWith("CLM-"),
    lossWhileCovered.claimNumber,
  );
  const lossAfterCancellation = await refusal(() =>
    openClaim(
      {
        policyId: cancelledPolicy.policyId,
        occurredAt: "2028-04-01",
        reportedAt: "2028-06-01",
        openedOn: "2028-06-01", // the claim is opened on the day the loss is reported
        description: "loss after cover stopped",
        claimantName: CLAIMANT_NAME,
        actor: maker,
      },
      runtime,
    ),
  );
  report(
    "a loss after the cancellation date is refused",
    /after the policy was cancelled on 2028-03-02/.test(lossAfterCancellation),
    lossAfterCancellation,
  );

  const brokerTryingToOpen = await refusal(() =>
    openClaim(
      {
        policyId: cancelledPolicy.policyId,
        occurredAt: "2028-03-01",
        reportedAt: "2028-06-01",
        openedOn: "2028-06-01", // the claim is opened on the day the loss is reported
        description: "opened by the wrong role",
        claimantName: CLAIMANT_NAME,
        actor: { userId: people.brokerUserId, role: "broker" },
      },
      runtime,
    ),
  );
  report(
    "a broker cannot open a claim or touch claim money",
    /only staff operations/.test(brokerTryingToOpen),
    brokerTryingToOpen,
  );

  // ---------------------------------------------------------------------------
  // 11. Recovering a refund that was never sent (review findings F-B5-02 and F-B5-03)
  // ---------------------------------------------------------------------------

  // A cancellation late in the term gives back very little, so this refund is BELOW the
  // threshold: nobody has to approve it, and it is the plain "stuck in requested" case.
  const smallRefundPolicy = await createPaidPolicy(recordSuccessfulPayment, people.brokerId);
  const smallCancellation = await recordCancellation(
    {
      policyId: smallRefundPolicy.policyId,
      effectiveAt: "2029-02-28",
      calculationMethod: "pro_rata",
      actor: { userId: maker.userId, role: "staff_ops", brokerId: null },
    },
    runtime,
  );
  const smallRefundOperationId = smallCancellation.refundOperationIds[0];
  report(
    "a refund below $1,000 needs no approver and is ready to send",
    smallCancellation.refundOperationIdsAwaitingApproval.length === 0 &&
      (await refusal(async () =>
        assertRefundMaySend(runtime, (await loadRefundOperation(runtime, smallRefundOperationId))!),
      )) === "no error raised",
    `${smallCancellation.plan.breakdown.totalRefundCents} cents, no approval request`,
  );

  // F-B5-03: the recovery job is the thing that finishes an operation whose only lifecycle event
  // is 'requested'. Two properties are checked here, and the second one is the one that matters:
  //   - the query runs against the real schema (nothing else in the suite exercises it);
  //   - an operation created seconds ago is NOT picked up, because a request may still be in
  //     flight. Only operations older than five minutes are treated as stuck.
  const stuck = await stuckOperations(runtime);
  report(
    "the recovery job leaves alone a refund that was created a moment ago",
    !stuck.some((operation) => operation.operationId === smallRefundOperationId),
    `${stuck.length} operation(s) older than ${STUCK_AFTER_MINUTES} minutes are waiting; this one is seconds old and is correctly not among them`,
  );

  // F-B5-02: OUR call to Stripe failed, so Stripe may or may not have created the refund. The
  // only safe recovery is to retry the SAME operation under the SAME key; opening a new one
  // could create a second refund and pay the customer twice.
  await runtime`
    insert into money_operation_events (operation_id, status, payload)
    values (${smallRefundOperationId}, 'failed',
            ${runtime.json({ stage: "create_refund", message: "timed out while calling Stripe" })})
  `;
  const createStageOperation = await loadRefundOperation(runtime, smallRefundOperationId);
  report(
    "a failure while calling Stripe is recognised as a create-stage failure",
    createStageOperation?.lastFailureStage === "create_refund",
    String(createStageOperation?.lastFailureStage),
  );
  const reissueAfterCreateFailure = await refusal(() =>
    createReissuedRefundOperation(
      { policyId: smallRefundPolicy.policyId, failedOperationId: smallRefundOperationId, actorUserId: maker.userId },
      runtime,
    ),
  );
  report(
    "a create-stage failure cannot be re-issued as a NEW refund: it has to be retried under the same key",
    /same idempotency key, not re-issued/.test(reissueAfterCreateFailure),
    reissueAfterCreateFailure,
  );

  // A failure reported by STRIPE about the refund itself is the other case: that refund is dead,
  // its key can never produce a live refund again, and a new operation is the only way forward.
  await runtime`
    insert into money_operation_events (operation_id, status, provider_ref, payload)
    values (${smallRefundOperationId}, 'failed', 're_check_dead_refund',
            ${runtime.json({ stage: "refund_lifecycle", reason: "expired_or_canceled_card" })})
  `;
  const reissuedOperationId = await createReissuedRefundOperation(
    { policyId: smallRefundPolicy.policyId, failedOperationId: smallRefundOperationId, actorUserId: maker.userId },
    runtime,
  );
  report(
    "a failure reported by Stripe about the refund itself CAN be re-issued, under a new key",
    reissuedOperationId !== smallRefundOperationId,
    (await loadRefundOperation(runtime, reissuedOperationId))?.idempotencyKey ?? "no operation",
  );
  report(
    "re-issuing still posts no journal entry: the liability was opened once",
    (await entryTypesOfPolicy(smallRefundPolicy.policyId)).get("refund_requested") === 1,
    describe(await entryTypesOfPolicy(smallRefundPolicy.policyId)),
  );

  // ---------------------------------------------------------------------------
  // 11b. The threshold is per claim, not per payment (review finding F-B7-02, Yoann's decision)
  // ---------------------------------------------------------------------------

  const splitPolicy = await createPaidPolicy(recordSuccessfulPayment, people.brokerId);
  const splitClaim = await openClaim(
    {
      policyId: splitPolicy.policyId,
      occurredAt: "2028-05-03",
      reportedAt: "2028-05-04",
      openedOn: "2028-05-04", // the claim is opened on the day the loss is reported
      description: "roof leak, paid in instalments",
      claimantName: CLAIMANT_NAME,
      actor: maker,
    },
    runtime,
  );
  await setClaimReserve({ claimId: splitClaim.claimId, newReserveCents: REDUCED_RESERVE_CENTS, note: "estimate", actor: maker }, runtime);
  await addClaimantBankAccount(
    {
      claimId: splitClaim.claimId,
      accountHolderName: CLAIMANT_NAME,
      routingNumber: REACHABLE_ROUTING_NUMBER,
      accountNumber: "000123456789",
      actor: maker,
    },
    runtime,
  );
  const firstSixHundred = await requestClaimPayment({ claimId: splitClaim.claimId, amountCents: 60000, actor: maker }, runtime);
  report(
    "a first $600 on a claim goes without an approver",
    firstSixHundred.approvalRequestId === null,
    `approval request: ${firstSixHundred.approvalRequestId}`,
  );
  const secondSixHundred = await requestClaimPayment({ claimId: splitClaim.claimId, amountCents: 60000, actor: maker }, runtime);
  report(
    "a second $600 on the same claim needs an approver: the claim would reach $1,200",
    secondSixHundred.approvalRequestId !== null,
    `approval request: ${secondSixHundred.approvalRequestId}`,
  );
  const afterSplitAttempt = await refusal(() => sendClaimPayment({ operationId: secondSixHundred.operationId, actor: maker }, runtime));
  report(
    "the second $600 cannot be sent before a distinct approver decides",
    /approv/i.test(afterSplitAttempt),
    afterSplitAttempt,
  );
  // Review finding F-B7-13: the same refusal blocks a payment that WAS below the ceiling when it
  // was asked for, as soon as a second request lands on the claim. Failing closed is right; the
  // operator has to be able to read why, and what releases it.
  const firstSixHundredBlocked = await refusal(() => sendClaimPayment({ operationId: firstSixHundred.operationId, actor: maker }, runtime));
  report(
    "AND THE FIRST $600, BELOW THE CEILING WHEN IT WAS ASKED FOR, IS BLOCKED TOO, with the arithmetic and the way out in the sentence",
    /\$1,000\.00 approval ceiling/.test(firstSixHundredBlocked) &&
      /\$600\.00 waiting/.test(firstSixHundredBlocked) &&
      /rejected and this payment becomes sendable again/.test(firstSixHundredBlocked),
    firstSixHundredBlocked,
  );

  // ---------------------------------------------------------------------------
  // 11c. Every road to Stripe passes the maker-checker gate (review finding F-B7-01)
  // ---------------------------------------------------------------------------

  // An above-threshold refund operation that carries NO approval request, the shape the old
  // re-issue path used to create after a rejection. Fabricated on the disposable database from
  // the queued cancellation refund's own allocation, so the amounts are real.
  const queuedRefund = await loadRefundOperation(runtime, refundOperationId);
  if (!queuedRefund) {
    throw new Error("the queued cancellation refund could not be read back");
  }
  const [ungated] = await runtime<{ id: string }[]>`
    insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key, created_by)
    values ('stripe_refund', 'stripe', ${queuedRefund.amountCents}, ${queuedRefund.policyId},
            ${`policy-refund:${queuedRefund.policyId}:${queuedRefund.paymentIntentId}:check-f-b7-01`}, ${maker.userId})
    returning id
  `;
  await runtime`
    insert into money_operation_events (operation_id, status, payload)
    values (${ungated.id}, 'requested', ${runtime.json({ note: "check fixture: above the threshold, no approval request" })})
  `;
  await runtime`
    insert into refund_allocations (
      refund_operation_id, policy_id, policy_event_id, collection_operation_id, payment_intent_id,
      amount_cents, refunded_premium_cents, refunded_tax_cents, commission_clawback_cents
    ) values (
      ${ungated.id}, ${queuedRefund.policyId}, ${queuedRefund.policyEventId}, ${queuedRefund.collectionOperationId},
      ${queuedRefund.paymentIntentId}, ${queuedRefund.amountCents}, ${queuedRefund.refundedPremiumCents},
      ${queuedRefund.refundedTaxCents}, ${queuedRefund.commissionClawbackCents}
    )
  `;
  const eventsBeforeGate = await countOperationEvents(ungated.id);
  const [gateAnswer] = await issueRefundsAtStripe([ungated.id], runtime);
  report(
    "issueRefundsAtStripe itself refuses an above-threshold refund that carries no approval request",
    gateAnswer.status === "refused" && /no approval request/.test(gateAnswer.detail),
    `${gateAnswer.status}: ${gateAnswer.detail}`,
  );
  report(
    "that refusal is not a provider failure: nothing was appended to the operation",
    (await countOperationEvents(ungated.id)) === eventsBeforeGate,
    `${await countOperationEvents(ungated.id)} event(s), was ${eventsBeforeGate}`,
  );

  // The approver says no. A re-issue must go back to the queue, never to Stripe.
  await runtime`
    insert into money_operation_events (operation_id, status, payload)
    values (${ungated.id}, 'failed', ${runtime.json({ stage: "approval", reason: "rejected by the approver" })})
  `;
  const rejectedShape = await loadRefundOperation(runtime, ungated.id);
  report(
    "a rejection is recognised as an approval-stage failure, not as a Stripe failure",
    rejectedShape?.lastFailureStage === "approval",
    String(rejectedShape?.lastFailureStage),
  );
  const reissuedAfterRejection = await createReissuedRefundOperation(
    { policyId: queuedRefund.policyId, failedOperationId: ungated.id, actorUserId: maker.userId },
    runtime,
  );
  const reissuedShape = await loadRefundOperation(runtime, reissuedAfterRejection);
  report(
    "re-issuing an above-threshold refund raises a NEW approval request on the new operation",
    reissuedShape?.approvalRequestId !== null && reissuedShape?.approvalRequestId !== undefined,
    `approval request: ${reissuedShape?.approvalRequestId}`,
  );
  const [reissueGateAnswer] = await issueRefundsAtStripe([reissuedAfterRejection], runtime);
  report(
    "and the new attempt cannot reach Stripe until that request is approved",
    reissueGateAnswer.status === "refused",
    `${reissueGateAnswer.status}: ${reissueGateAnswer.detail}`,
  );

  // ---------------------------------------------------------------------------
  // 11d. The LOW findings of the B7 review, closed one by one
  // ---------------------------------------------------------------------------

  // F-B7-08: the payment in the URL must belong to the claim in the URL.
  const wrongPair = await refusal(() =>
    assertPaymentBelongsToClaim(claim.claimId, firstSixHundred.operationId, runtime),
  );
  report(
    "a payment of another claim cannot be driven from this claim's URL",
    /belongs to another claim/.test(wrongPair),
    wrongPair,
  );
  const rightPair = await refusal(() =>
    assertPaymentBelongsToClaim(splitClaim.claimId, firstSixHundred.operationId, runtime),
  );
  report("the claim that owns the payment passes the same check", rightPair === "no error raised", rightPair);

  // F-B7-10: settling now checks its own actor instead of trusting the route that called it.
  const approverSettling = await refusal(() =>
    settleClaimPayment({ operationId: queuedOperationId, settledOn: "2028-05-12", settledBy: checker }, runtime),
  );
  report(
    "the approver cannot settle a payment: settleClaimPayment checks the actor itself",
    /only staff operations/.test(approverSettling),
    approverSettling,
  );

  // F-B7-06: a loss that has not happened yet cannot be claimed. Every policy in this check
  // covers 2028, so opening a claim with the REAL day of the run is exactly the case the review
  // found: a loss inside the cover, and still in the future.
  const futureLoss = await refusal(() =>
    openClaim(
      {
        policyId: policy.policyId,
        occurredAt: "2028-05-01",
        reportedAt: "2028-05-02",
        openedOn: todayUtc(),
        description: "a loss that has not happened yet",
        claimantName: CLAIMANT_NAME,
        actor: maker,
      },
      runtime,
    ),
  );
  report(
    "a claim for a loss dated in the future is refused, whatever the policy covers",
    /has not happened yet/.test(futureLoss),
    futureLoss,
  );

  // F-B7-05: claim payouts are inside the recovery job now. Two cases, on two claims: a payment
  // below the threshold that never reached the rail, and one still waiting for its approver.
  // The below-threshold one needs a claim of its own, because the split claim above is already
  // over $1,000 and the cumulative rule (F-B7-02) rightly refuses its payments as well.
  const recoveryPolicy = await createPaidPolicy(recordSuccessfulPayment, people.brokerId);
  const recoveryClaim = await openClaim(
    {
      policyId: recoveryPolicy.policyId,
      occurredAt: "2028-05-05",
      reportedAt: "2028-05-06",
      openedOn: "2028-05-06", // the claim is opened on the day the loss is reported
      description: "a payment that never reached the rail",
      claimantName: CLAIMANT_NAME,
      actor: maker,
    },
    runtime,
  );
  await setClaimReserve(
    { claimId: recoveryClaim.claimId, newReserveCents: 100000, note: "estimate", actor: maker },
    runtime,
  );
  await addClaimantBankAccount(
    {
      claimId: recoveryClaim.claimId,
      accountHolderName: CLAIMANT_NAME,
      routingNumber: REACHABLE_ROUTING_NUMBER,
      accountNumber: "000123456789",
      actor: maker,
    },
    runtime,
  );
  // Requested and not sent, which is exactly what a crash between the two transactions leaves.
  const neverSent = await requestClaimPayment(
    { claimId: recoveryClaim.claimId, amountCents: 60000, actor: maker },
    runtime,
  );

  // Age 0 minutes here, because a money operation's created_at is set by the database clock and
  // cannot be backdated (migration 0002), so a fixture can never be five minutes old.
  const stuckNow = await stuckOperations(runtime, 0);
  const stuckFirstPayment = stuckNow.find((operation) => operation.operationId === neverSent.operationId);
  const stuckSecondPayment = stuckNow.find((operation) => operation.operationId === secondSixHundred.operationId);
  report(
    "the recovery job's query returns claim payouts, not only the Stripe operations",
    stuckFirstPayment?.kind === "claim_payout" && stuckSecondPayment?.kind === "claim_payout",
    `${stuckNow.filter((operation) => operation.kind === "claim_payout").length} claim payout(s) among ` +
      `${stuckNow.length} operation(s) whose only lifecycle event is 'requested'`,
  );
  const leftForTheApprover = await recoverStuckOperation(runtime, stuckSecondPayment!);
  report(
    "a stuck claim payment still waiting for its approver is left alone, with the reason",
    leftForTheApprover.kind === "left_alone" && /waiting for a second person/.test(leftForTheApprover.reason),
    leftForTheApprover.kind === "left_alone" ? leftForTheApprover.reason : leftForTheApprover.detail,
  );
  const resent = await recoverStuckOperation(runtime, stuckFirstPayment!);
  report(
    "a stuck claim payment below the threshold is sent by the job, through the screen's own function",
    resent.kind === "recovered" && (await claimEventCount(recoveryClaim.claimId, "payment_sent")) === 1,
    resent.kind === "recovered" ? resent.detail : resent.reason,
  );
  report(
    "running the recovery again does not pay it twice",
    (await recoverStuckOperation(runtime, stuckFirstPayment!)).kind === "recovered" &&
      (await claimEventCount(recoveryClaim.claimId, "payment_sent")) === 1,
    `${await claimEventCount(recoveryClaim.claimId, "payment_sent")} payment(s) sent on this claim`,
  );

  // ---------------------------------------------------------------------------
  // 12. The whole ledger still balances
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

  void ClaimRefused;
  void ApprovalRefused;
  void RefundSendRefused;

  await owner.end();
  await runtime.end();
  process.exit(failures === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// The identity this whole slice rests on, checked in two independent ways
// ---------------------------------------------------------------------------

// Checks the folded position against the expected numbers AND against the journal: the balance
// of incurred_loss_expense must equal paid + the balance of claim_reserve, always.
async function expectIdentity(
  moment: string,
  claimId: string,
  expected: { reserve: number; paid: number; settled: number },
): Promise<void> {
  const { claimMoneyPosition } = await import("@/lib/claims/money-position");
  const { claimMoneyEvents } = await import("@/lib/claims/claims");
  const position = claimMoneyPosition(await claimMoneyEvents(runtime, claimId));

  const incurredInTheJournal = await claimAccountBalance(claimId, "incurred_loss_expense");
  const reserveInTheJournal = -(await claimAccountBalance(claimId, "claim_reserve"));

  report(
    `incurred = paid + reserve ${moment}`,
    position.reserveCents === expected.reserve &&
      position.paidCents === expected.paid &&
      position.settledCents === expected.settled &&
      position.incurredCents === position.paidCents + position.reserveCents &&
      position.incurredCents === incurredInTheJournal &&
      position.reserveCents === reserveInTheJournal,
    `paid ${position.paidCents} + reserve ${position.reserveCents} = incurred ${position.incurredCents}; ` +
      `journal: incurred_loss_expense ${incurredInTheJournal}, claim_reserve ${reserveInTheJournal}, settled ${position.settledCents}`,
  );
}

// ---------------------------------------------------------------------------
// Fixtures and reads
// ---------------------------------------------------------------------------

// The people maker-checker needs: one who asks, one who cannot approve because they also ask,
// one who can, and a broker who may do none of it.
async function createPeople(): Promise<{
  brokerId: string;
  brokerUserId: string;
  makerId: string;
  otherMakerId: string;
  checkerId: string;
}> {
  return owner.begin(async (transaction) => {
    const [broker] = await transaction<{ id: string }[]>`
      insert into brokers (name, commission_rate_bps) values ('Claims check broker', 1500) returning id
    `;
    // Eligibility is checked again at binding time (lib/payments/collection.ts, slice B3), so
    // the fixture broker needs a status on file. Provider 'seed' on purpose: the two-minute
    // settling window applies to Stripe Connect statuses only, so a row written a moment ago is
    // usable straight away.
    await transaction`
      insert into broker_kyb_events (broker_id, provider, status) values (${broker.id}, 'seed', 'approved')
    `;
    const unique = () => `claims-check-${crypto.randomUUID()}@example.invalid`;
    const [brokerUser] = await transaction<{ id: string }[]>`
      insert into users (email, display_name, role, broker_id)
      values (${unique()}, 'Claims check broker user', 'broker', ${broker.id}) returning id
    `;
    const [maker] = await transaction<{ id: string }[]>`
      insert into users (email, display_name, role) values (${unique()}, 'Claims check operator', 'staff_ops') returning id
    `;
    const [otherMaker] = await transaction<{ id: string }[]>`
      insert into users (email, display_name, role) values (${unique()}, 'Claims check second operator', 'staff_ops') returning id
    `;
    const [checker] = await transaction<{ id: string }[]>`
      insert into users (email, display_name, role) values (${unique()}, 'Claims check approver', 'staff_approver') returning id
    `;
    return {
      brokerId: broker.id,
      brokerUserId: brokerUser.id,
      makerId: maker.id,
      otherMakerId: otherMaker.id,
      checkerId: checker.id,
    };
  });
}

// A bound, paid policy, built exactly as slice B2 builds one.
async function createPaidPolicy(
  recordSuccessfulPayment: typeof import("@/lib/payments/collection").recordSuccessfulPayment,
  brokerId: string,
): Promise<{ policyId: string; paymentIntentId: string }> {
  const { policyId, operationId } = await owner.begin(async (transaction) => {
    const [customer] = await transaction<{ id: string }[]>`
      insert into customers (name, email)
      values (${CLAIMANT_NAME}, 'claims-check-' || gen_random_uuid()::text || '@example.invalid')
      returning id
    `;
    const [policy] = await transaction<{ id: string }[]>`
      insert into policies (broker_id, customer_id, state_code) values (${brokerId}, ${customer.id}, 'CA') returning id
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
        per_occurrence_limit_cents: PER_OCCURRENCE_LIMIT_CENTS,
        aggregate_limit_cents: AGGREGATE_LIMIT_CENTS,
      })})
    `;
    const [operation] = await transaction<{ id: string }[]>`
      insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key)
      values ('stripe_checkout', 'stripe', ${TOTAL_CHARGE_CENTS}, ${policy.id}, 'policy-checkout:' || ${policy.id})
      returning id
    `;
    await transaction`
      insert into money_operation_events (operation_id, status) values (${operation.id}, 'requested')
    `;
    return { policyId: policy.id, operationId: operation.id };
  });

  const paymentIntentId = `pi_claims_check_${operationId.slice(0, 8)}`;
  const collected = await recordSuccessfulPayment(
    { operationId, paymentIntentId, amountReceivedCents: TOTAL_CHARGE_CENTS, paidOn: TERM_START },
    runtime,
  );
  if (collected.kind !== "posted") {
    throw new Error(`the fixture policy could not be paid: ${JSON.stringify(collected)}`);
  }
  return { policyId, paymentIntentId };
}

// Runs an action expected to be refused and returns the message, so a check can match on it.
async function refusal(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
    return "no error raised";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function entryTypes(claimId: string): Promise<Map<string, number>> {
  const rows = await owner<{ entry_type: string; count: string }[]>`
    select entry_type, count(*)::text as count from journal_entries where claim_id = ${claimId}
     group by entry_type order by entry_type
  `;
  return new Map(rows.map((row) => [row.entry_type, Number(row.count)]));
}

async function entryTypesOfPolicy(policyId: string): Promise<Map<string, number>> {
  const rows = await owner<{ entry_type: string; count: string }[]>`
    select entry_type, count(*)::text as count from journal_entries where policy_id = ${policyId}
     group by entry_type order by entry_type
  `;
  return new Map(rows.map((row) => [row.entry_type, Number(row.count)]));
}

function describe(entryTypesByName: Map<string, number>): string {
  return [...entryTypesByName.entries()].map(([type, count]) => `${type} x${count}`).join(", ") || "no entry";
}

// Debits minus credits on one account, for one claim.
async function claimAccountBalance(claimId: string, accountId: string): Promise<number> {
  const [row] = await owner<{ amount: string }[]>`
    select coalesce(sum(line.debit_cents) - sum(line.credit_cents), 0)::text as amount
      from journal_lines line
      join journal_entries entry on entry.id = line.entry_id
     where entry.claim_id = ${claimId} and line.account_id = ${accountId}
  `;
  return Number(row.amount);
}

async function netBalance(policyId: string, accountId: string): Promise<number> {
  const [row] = await owner<{ amount: string }[]>`
    select coalesce(sum(line.debit_cents) - sum(line.credit_cents), 0)::text as amount
      from journal_lines line
      join journal_entries entry on entry.id = line.entry_id
     where entry.policy_id = ${policyId} and line.account_id = ${accountId}
  `;
  return Number(row.amount);
}

async function claimEventCount(claimId: string, eventType: string): Promise<number> {
  const [row] = await owner<{ count: string }[]>`
    select count(*)::text as count from claim_events where claim_id = ${claimId} and event_type = ${eventType}
  `;
  return Number(row.count);
}

async function providerRecordCount(operationId: string, status: string): Promise<number> {
  const [row] = await owner<{ count: string }[]>`
    select count(*)::text as count
      from simulator_provider_records record
     where record.status = ${status}
       and record.transfer_ref in (
             select provider_ref from money_operation_events
              where operation_id = ${operationId} and provider_ref is not null
           )
  `;
  return Number(row.count);
}

async function pendingCents(claimId: string): Promise<number> {
  const [row] = await owner<{ pending: string }[]>`
    select coalesce(sum(operation.amount_cents), 0)::text as pending
      from money_operations operation
     where operation.claim_id = ${claimId}
       and operation.kind = 'claim_payout'
       and not exists (select 1 from claim_events event
                        where event.money_operation_id = operation.id and event.event_type = 'payment_sent')
       and not exists (select 1 from money_operation_events lifecycle
                        where lifecycle.operation_id = operation.id and lifecycle.status = 'failed')
  `;
  return Number(row.pending);
}

async function policyStatus(policyId: string): Promise<string> {
  const [row] = await owner<{ status: string }[]>`select status from policy_current where policy_id = ${policyId}`;
  return row?.status ?? "no cache row";
}

async function operationStatuses(operationId: string): Promise<string[]> {
  const rows = await owner<{ status: string }[]>`
    select status from money_operation_events where operation_id = ${operationId} order by sequence_number
  `;
  return rows.map((row) => row.status);
}

async function countOperationEvents(operationId: string): Promise<number> {
  const [row] = await owner<{ count: string }[]>`
    select count(*)::text as count from money_operation_events where operation_id = ${operationId}
  `;
  return Number(row.count);
}

main().catch(async (error) => {
  console.error("check failed to run:", error instanceof Error ? error.message : error);
  await owner.end();
  await runtime.end();
  process.exit(1);
});
