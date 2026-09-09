import postgres from "postgres";

// Proves, against a real database, the properties a backdated correction depends on:
//
//   1. NOTHING IS CHANGED. Every row that existed before the correction is byte for byte the same
//      afterwards, and the row counts only grow (AF-03);
//   2. the reversal entries mirror the originals, line for line, on the SAME effective date, and
//      they are recorded now, which is the effective-time versus recorded-time distinction;
//   3. the re-book carries the corrected delta, on the corrected date, and the fold returns the
//      corrected written premium segment;
//   4. the policy as it stood between the two dates changes because of the correction, which is
//      the live-fire question "show me the policy as it stood on that day";
//   5. the difference goes both ways: collected through a hosted Stripe page when the corrected
//      date charges more days, refunded through the Stripe Refunds API when it charges fewer,
//      with the commission earned or clawed back on the premium that moved;
//   6. correcting a correction is allowed; correcting the same endorsement twice is not, in the
//      code AND at the database (reverses_entry_id is unique);
//   7. a correction is refused on a cancelled policy, on a voided policy, on an endorsement whose
//      delta was refunded, outside the term, before the issuance, by anyone who is not staff
//      operations, and while an earlier difference is unsettled;
//   8. a cancellation recorded after a correction gives back the CORRECTED premium segment;
//   9. the whole ledger still balances.
//
// It runs the production functions with the restricted runtime role and calls NO provider: every
// payment is simulated by calling the webhook-side functions directly with the payloads Stripe
// would send, on fabricated payment intents. That is allowed here and only here, because it
// commits rows and therefore refuses to run anywhere but the disposable database corgi_test.
// Run with: npm run check:correction-replay

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
// (2820 cents), $25 fee, 15% commission, 365-day term, raised to $1,800.
//
//   day 100, 2028-06-09, 265 days remain   premium 43561, tax 1023, total 44584, commission 6534
//   day 130, 2028-07-09, 235 days remain   premium 38630, tax  907, total 39537, commission 5794
//   the difference                         premium  4931, tax  116, total  5047, commission  739
const ANNUAL_PREMIUM_CENTS = 120000;
const TAX_CENTS = 2820;
const FEE_CENTS = 2500;
const TERM_START = "2028-03-01";
const TERM_END = "2029-03-01";
const DAY_100 = "2028-06-09";
const DAY_130 = "2028-07-09";
const RAISED_ANNUAL_PREMIUM_CENTS = 180000;
const PER_OCCURRENCE = 100000000;
const AGGREGATE = 200000000;
const RAISED_PER_OCCURRENCE = 200000000;
const RAISED_AGGREGATE = 400000000;

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
  const { recordCancellation } = await import("@/lib/policy/cancel");
  const { cancellationBreakdown } = await import("@/lib/money/premium");
  const { recordCompletedRefund } = await import("@/lib/payments/refunds");
  const { planEndorsement, recordEndorsementRequest } = await import("@/lib/policy/endorse");
  const { createEndorsementCheckoutOperation, recordSuccessfulEndorsementPayment } = await import(
    "@/lib/payments/endorsement-collection"
  );
  const { readEndorsementRequest } = await import("@/lib/policy/endorsement-requests");
  const {
    planEndorsementDateCorrection,
    recordEndorsementDateCorrection,
    premiumReceivableBalance,
    CorrectionRefused,
  } = await import("@/lib/policy/correct-endorsement-date");
  const { recordSuccessfulCorrectionPayment, recordExpiredCorrectionCheckout } = await import(
    "@/lib/payments/correction-collection"
  );
  const { foldPolicyEvents } = await import("@/lib/policy/current");
  const { policyAsItStoodOn, correctionsOfPolicy, policyTimeline } = await import("@/lib/policy/correction-read");
  const { reverseJournalEntry } = await import("@/lib/ledger/reverse");

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
      if (error instanceof CorrectionRefused) {
        return error.message;
      }
      throw error;
    }
  };

  // Builds a paid policy whose endorsement to $1,800 is in force on `effectiveAt`, with its delta
  // collected by a fabricated payment. This is the state the panel hands us: an endorsement that
  // is already in the books, with the wrong date on it.
  async function endorsedPolicy(effectiveAt: string) {
    const fixture = await createPaidPolicy(recordSuccessfulPayment);
    const broker: Actor = { userId: fixture.brokerUserId, role: "broker", brokerId: fixture.brokerId, customerId: null };
    const raise = {
      policyId: fixture.policyId,
      effectiveAt,
      newAnnualPremiumCents: RAISED_ANNUAL_PREMIUM_CENTS,
      newPerOccurrenceLimitCents: RAISED_PER_OCCURRENCE,
      newAggregateLimitCents: RAISED_AGGREGATE,
      reason: "limit raised at the insured's request",
      actor: broker,
    };
    const quote = await planEndorsement(raise, runtime);
    const requested = await recordEndorsementRequest({ ...raise, expectedQuoteHash: quote.figures.quoteHash }, runtime);
    const request = (await readEndorsementRequest(runtime, fixture.policyId, requested.requestEventId))!;
    const attempt = await createEndorsementCheckoutOperation({ quote: request, userId: fixture.brokerUserId, attempt: 1 }, runtime);
    const paid = await recordSuccessfulEndorsementPayment(
      {
        operationId: attempt.operationId,
        paymentIntentId: `pi_correction_check_${attempt.operationId.slice(0, 8)}`,
        amountReceivedCents: quote.figures.deltaTotalCents,
        paidOn: effectiveAt,
      },
      runtime,
    );
    if (paid.kind !== "posted") {
      throw new Error(`the fixture endorsement could not be applied: ${JSON.stringify(paid)}`);
    }
    const [endorsed] = await owner<{ id: string }[]>`
      select id from policy_events where policy_id = ${fixture.policyId} and event_type = 'endorsed'
    `;
    return { ...fixture, endorsedEventId: endorsed.id, deltaOperationId: attempt.operationId, quote };
  }

  // ---------------------------------------------------------------------------
  // 1. Entered at day 130, corrected to day 100: the customer owes the difference
  // ---------------------------------------------------------------------------

  const late = await endorsedPolicy(DAY_130);
  const operator = { userId: late.staffUserId, role: "staff_ops" as const };
  const correctionRequest = {
    policyId: late.policyId,
    correctedEventId: late.endorsedEventId,
    correctedEffectiveAt: DAY_100,
    reason: "the broker's instruction said June 9; it was keyed as July 9",
    actor: operator,
  };

  report(
    "the endorsement was booked on the wrong date for 39537 cents",
    late.quote.figures.deltaPremiumCents === 38630 && late.quote.figures.deltaTaxCents === 907 && late.quote.figures.deltaTotalCents === 39537,
    `premium ${late.quote.figures.deltaPremiumCents}, tax ${late.quote.figures.deltaTaxCents}, total ${late.quote.figures.deltaTotalCents}`,
  );

  const beforeCorrection = await snapshotPolicyRows(late.policyId);
  const preview = await planEndorsementDateCorrection(correctionRequest, runtime);
  report(
    "the preview prices the corrected date: 43561 + 1023, a difference of 5047 to collect",
    preview.money.after.deltaPremiumCents === 43561 &&
      preview.money.after.deltaTaxCents === 1023 &&
      preview.money.differenceTotalCents === 5047 &&
      preview.money.differenceCommissionCents === 739 &&
      preview.money.settlement === "collect",
    `after ${preview.money.after.deltaTotalCents}, difference ${preview.money.differenceTotalCents}, commission ${preview.money.differenceCommissionCents}, ${preview.money.settlement}`,
  );
  report(
    "the preview names the two entries it will reverse and writes nothing",
    preview.entriesToReverse.map((entry) => entry.entryType).join(",") === "endorsement_premium_written,endorsement_tax_billed" &&
      sameRows(beforeCorrection, await snapshotPolicyRows(late.policyId)) === null,
    preview.entriesToReverse.map((entry) => `${entry.entryType} ${entry.amountCents}`).join(", "),
  );

  const asOfBefore = await policyAsItStoodOn(late.policyId, "2028-06-20", runtime);
  report(
    "before the correction, the policy on 2028-06-20 still reads $1,200 with the original limits",
    "snapshot" in asOfBefore && asOfBefore.snapshot.annualPremiumCents === ANNUAL_PREMIUM_CENTS && asOfBefore.snapshot.coverageLines[0].limitCents === PER_OCCURRENCE,
    "snapshot" in asOfBefore ? `annual ${asOfBefore.snapshot.annualPremiumCents}, limit ${asOfBefore.snapshot.coverageLines[0].limitCents}` : asOfBefore.error,
  );

  const corrected = await recordEndorsementDateCorrection(correctionRequest, runtime);
  const afterCorrection = await snapshotPolicyRows(late.policyId);

  const changed = sameRows(beforeCorrection, afterCorrection);
  report("not one row that existed before the correction changed, byte for byte", changed === null, changed ?? `${beforeCorrection.size} rows compared`);
  report(
    "the correction only added rows",
    afterCorrection.size > beforeCorrection.size,
    `${beforeCorrection.size} rows before, ${afterCorrection.size} after`,
  );

  const reversals = await entriesOfSource(late.policyId, "correction", corrected.reversalEventId);
  report(
    "two reversal entries exist, mirroring the originals on the SAME effective date",
    reversals.length === 2 &&
      reversals.every((entry) => entry.effective_at === DAY_130) &&
      reversals.every((entry) => entry.reverses_entry_id !== null),
    reversals.map((entry) => `${entry.entry_type} effective ${entry.effective_at}`).join(", "),
  );
  const mirrored = await linesMirrorTheOriginal(reversals.map((entry) => entry.id));
  report("every reversal line is the mirror image of the line it reverses", mirrored.every((row) => row.mirrored), JSON.stringify(mirrored));
  report(
    "the reversals were RECORDED after the originals, and effective before them: two clocks, not one",
    reversals.every((entry) => entry.recorded_at > preview.entriesToReverse[0].recordedAt) && reversals.every((entry) => entry.effective_at === DAY_130),
    `originals recorded ${preview.entriesToReverse[0].recordedAt.toISOString()}, reversals ${reversals[0].recorded_at.toISOString()}`,
  );

  const rebookEntries = await entriesOfSource(late.policyId, "correction", corrected.rebookEventId);
  report(
    "the re-book posts the corrected premium and tax on the corrected date",
    rebookEntries.length === 2 &&
      rebookEntries.every((entry) => entry.effective_at === DAY_100) &&
      (await amountOnEntry(rebookEntries[0].id, "unearned_premium", "credit")) === 43561 &&
      (await amountOnEntry(rebookEntries[1].id, "premium_tax_payable", "credit")) === 1023,
    rebookEntries.map((entry) => `${entry.entry_type} effective ${entry.effective_at}`).join(", "),
  );
  report(
    "no cash entry was reversed and no cash entry was posted: Stripe still holds the money",
    (await netBalance(late.policyId, "cash_stripe")) === 125320 + 39537,
    `cash_stripe net ${await netBalance(late.policyId, "cash_stripe")} (issuance 125320 + delta 39537)`,
  );

  const fold = await foldPolicyEvents(runtime, late.policyId);
  report(
    "the fold applies the re-book like an endorsement: the corrected segment, at the corrected date",
    fold.writtenPremiumSegments.length === 2 &&
      fold.writtenPremiumSegments[1].writtenPremiumCents === 43561 &&
      fold.writtenPremiumSegments[1].startsOn === DAY_100 &&
      fold.latestEndorsementEffectiveAt === DAY_100,
    fold.writtenPremiumSegments.map((segment) => `${segment.writtenPremiumCents} from ${segment.startsOn}`).join(", "),
  );
  report(
    "the wrong endorsement is superseded, the policy stays bound, and the terms are the endorsed ones",
    !fold.eventTypes.includes("endorsed") &&
      fold.eventTypes.includes("correction_rebook") &&
      fold.terms.annualPremiumCents === RAISED_ANNUAL_PREMIUM_CENTS &&
      (await policyCurrent(late.policyId)).status === "bound",
    `${fold.eventTypes.join(",")}; status ${(await policyCurrent(late.policyId)).status}`,
  );

  const asOfBetween = await policyAsItStoodOn(late.policyId, "2028-06-20", runtime);
  const asOfBeforeBoth = await policyAsItStoodOn(late.policyId, "2028-06-08", runtime);
  report(
    "AFTER the correction, the policy on 2028-06-20 reads $1,800 with the raised limits",
    "snapshot" in asOfBetween && asOfBetween.snapshot.annualPremiumCents === RAISED_ANNUAL_PREMIUM_CENTS && asOfBetween.snapshot.coverageLines[0].limitCents === RAISED_PER_OCCURRENCE,
    "snapshot" in asOfBetween ? `annual ${asOfBetween.snapshot.annualPremiumCents}, limit ${asOfBetween.snapshot.coverageLines[0].limitCents}` : asOfBetween.error,
  );
  report(
    "and the day before the corrected date it still reads $1,200: the correction moved the date, not the whole history",
    "snapshot" in asOfBeforeBoth && asOfBeforeBoth.snapshot.annualPremiumCents === ANNUAL_PREMIUM_CENTS,
    "snapshot" in asOfBeforeBoth ? `annual ${asOfBeforeBoth.snapshot.annualPremiumCents}` : asOfBeforeBoth.error,
  );

  report(
    "the customer owes 5047: premium billed and not collected, visible as an open receivable",
    (await premiumReceivableBalance(runtime, late.policyId)) === 5047,
    `premium_receivable ${await premiumReceivableBalance(runtime, late.policyId)}`,
  );
  report(
    "one collection operation was opened for the difference, keyed on the re-book, nothing sent to Stripe",
    corrected.collectionOperationId !== null &&
      (await operationAmount(corrected.collectionOperationId!)) === 5047 &&
      (await operationIdempotencyKey(corrected.collectionOperationId!)) === `correction-checkout:${corrected.rebookEventId}` &&
      (await countOperationEvents(corrected.collectionOperationId!, "provider_accepted")) === 0,
    `${corrected.collectionOperationId}, ${await operationIdempotencyKey(corrected.collectionOperationId!)}`,
  );

  // The hosted page expires: no money moved, the receivable is untouched, the next attempt is new.
  const expiry = await recordExpiredCorrectionCheckout(
    { operationId: corrected.collectionOperationId!, sessionId: "cs_correction_expired" },
    runtime,
  );
  report(
    "an expired page posts nothing and leaves the difference owed",
    expiry.kind === "posted" && (await premiumReceivableBalance(runtime, late.policyId)) === 5047,
    `${expiry.kind}, receivable ${await premiumReceivableBalance(runtime, late.policyId)}`,
  );

  const differencePayment = {
    operationId: corrected.collectionOperationId!,
    paymentIntentId: `pi_correction_difference_${corrected.collectionOperationId!.slice(0, 8)}`,
    amountReceivedCents: 5047,
    paidOn: "2028-09-15",
  };
  const wrongAmount = await recordSuccessfulCorrectionPayment({ ...differencePayment, amountReceivedCents: 999 }, runtime);
  report("a difference payment for another amount is refused, not journaled", wrongAmount.kind === "refused", wrongAmount.kind === "refused" ? wrongAmount.reason : wrongAmount.kind);

  const issuancePathOnDifference = await recordSuccessfulPayment(differencePayment, runtime);
  report(
    "the issuance path refuses a correction operation instead of posting issuance entries under it",
    issuancePathOnDifference.kind === "refused" && /correction/.test(issuancePathOnDifference.reason),
    issuancePathOnDifference.kind === "refused" ? issuancePathOnDifference.reason : issuancePathOnDifference.kind,
  );

  const paidOnce = await recordSuccessfulCorrectionPayment(differencePayment, runtime);
  const paidTwice = await recordSuccessfulCorrectionPayment(differencePayment, runtime);
  report("the difference paid, and the same payment delivered twice posts once", paidOnce.kind === "posted" && paidTwice.kind === "already_posted", `${paidOnce.kind}, then ${paidTwice.kind}`);
  report(
    "the receivable is back to zero and the broker earned commission on the extra premium only",
    (await premiumReceivableBalance(runtime, late.policyId)) === 0 &&
      (await netBalance(late.policyId, "commission_payable")) === -(18000 + 5794 + 739),
    `receivable ${await premiumReceivableBalance(runtime, late.policyId)}, commission_payable net ${await netBalance(late.policyId, "commission_payable")}`,
  );
  report(
    "unearned premium holds the issuance premium plus the CORRECTED delta, not the one that was booked",
    (await netBalance(late.policyId, "unearned_premium")) === -(ANNUAL_PREMIUM_CENTS + 43561),
    `unearned_premium net ${await netBalance(late.policyId, "unearned_premium")}`,
  );
  report(
    "the state premium tax held is the issuance tax plus the CORRECTED tax",
    (await netBalance(late.policyId, "premium_tax_payable")) === -(TAX_CENTS + 1023),
    `premium_tax_payable net ${await netBalance(late.policyId, "premium_tax_payable")}`,
  );

  // ---------------------------------------------------------------------------
  // 2. The screens read it back from the events, and both clocks are visible
  // ---------------------------------------------------------------------------

  const explained = await correctionsOfPolicy(late.policyId, runtime);
  report(
    "the explanation reads the figures back from the events: 38630 as booked, 43561 corrected, 5047 owed",
    explained.length === 1 &&
      explained[0].money.before.deltaPremiumCents === 38630 &&
      explained[0].money.after.deltaPremiumCents === 43561 &&
      explained[0].money.differenceTotalCents === 5047 &&
      explained[0].entries.length === 4,
    `${explained.length} correction(s), ${explained[0]?.entries.length ?? 0} entries listed`,
  );
  const timeline = await policyTimeline(late.policyId, runtime);
  const supersededRow = timeline.find((row) => row.eventType === "endorsed");
  report(
    "the timeline strikes the superseded endorsement through and names what replaced it",
    supersededRow?.supersededByEventType === "correction_reversal" && supersededRow.effectiveAt === DAY_130,
    `${supersededRow?.eventType} effective ${supersededRow?.effectiveAt} superseded by ${supersededRow?.supersededByEventType}`,
  );
  const rebookRow = timeline.find((row) => row.eventType === "correction_rebook");
  report(
    "the timeline shows the correction effective in the past and recorded today",
    rebookRow !== undefined && rebookRow.effectiveAt === DAY_100 && rebookRow.recordedAt.getUTCFullYear() < 2028,
    `effective ${rebookRow?.effectiveAt}, recorded ${rebookRow?.recordedAt.toISOString()}`,
  );

  // ---------------------------------------------------------------------------
  // 3. Correcting a correction, and refusing to correct the same thing twice
  // ---------------------------------------------------------------------------

  const twice = await refusal(() => recordEndorsementDateCorrection(correctionRequest, runtime));
  report("the same endorsement cannot be corrected a second time", /most recent endorsement in force/.test(twice), twice);

  const databaseRefusal = await messageOfDatabaseError(late.policyId, corrected.reversalEventId, preview.entriesToReverse[0].entryId, reverseJournalEntry);
  report(
    "and the database refuses it too: an entry can be reversed at most once (unique reverses_entry_id)",
    /journal_entries_reverses_entry_id_key/.test(databaseRefusal),
    databaseRefusal.slice(0, 120),
  );

  // The re-book itself can be corrected: a correction of a correction, which supersedes it.
  // 2028-06-24 leaves 250 days: floor(60000 x 250 / 365) = 41095, tax floor(41095 x 235/10000) = 965.
  const secondCorrection = await recordEndorsementDateCorrection(
    {
      policyId: late.policyId,
      correctedEventId: corrected.rebookEventId,
      correctedEffectiveAt: "2028-06-24",
      reason: "the instruction actually said June 24; corrected a second time",
      actor: operator,
    },
    runtime,
  );
  const secondFold = await foldPolicyEvents(runtime, late.policyId);
  report(
    "a correction of a correction supersedes the re-book and leaves one segment, at the newest date",
    secondFold.writtenPremiumSegments.length === 2 &&
      secondFold.writtenPremiumSegments[1].writtenPremiumCents === 41095 &&
      secondFold.writtenPremiumSegments[1].startsOn === "2028-06-24",
    secondFold.writtenPremiumSegments.map((segment) => `${segment.writtenPremiumCents} from ${segment.startsOn}`).join(", "),
  );
  report(
    "it gives back the difference: 44584 collected, 42060 owed, 2524 to refund with a 369 clawback",
    secondCorrection.plan.money.settlement === "refund" &&
      secondCorrection.plan.money.differenceTotalCents === -2524 &&
      secondCorrection.plan.money.differenceCommissionCents === -369 &&
      secondCorrection.refundOperationIds.length === 1,
    `${secondCorrection.plan.money.differenceTotalCents}, commission ${secondCorrection.plan.money.differenceCommissionCents}, ${secondCorrection.refundOperationIds.length} refund(s)`,
  );
  const secondRefundId = secondCorrection.refundOperationIds[0];
  report(
    "the refund takes the money out of premium receivable, not out of unearned premium",
    (await premiumReceivableBalance(runtime, late.policyId)) === 0 &&
      (await netBalance(late.policyId, "refund_payable")) === -2524 &&
      (await netBalance(late.policyId, "unearned_premium")) === -(ANNUAL_PREMIUM_CENTS + 41095),
    `receivable 0, refund_payable ${await netBalance(late.policyId, "refund_payable")}, unearned ${await netBalance(late.policyId, "unearned_premium")}`,
  );
  report(
    "the allocation gives back the newest collection first: the difference already collected",
    (await allocationOf(secondRefundId)) === `2466/58/369/${differencePayment.paymentIntentId}`,
    await allocationOf(secondRefundId),
  );
  const whileInFlight = await refusal(() =>
    recordEndorsementDateCorrection(
      {
        policyId: late.policyId,
        correctedEventId: secondCorrection.rebookEventId,
        correctedEffectiveAt: DAY_100,
        reason: "a third correction while the refund of the second is still in flight",
        actor: operator,
      },
      runtime,
    ),
  );
  report("a third correction is refused while that refund is in flight", /has not completed yet/.test(whileInFlight), whileInFlight);

  const completed = await recordCompletedRefund(
    { operationId: secondRefundId, refundId: `re_correction_${secondRefundId.slice(0, 8)}`, amountCents: 2524, refundedOn: "2028-09-16" },
    runtime,
  );
  report(
    "when the refund completes, refund_payable clears and the commission is clawed back",
    completed.kind === "posted" &&
      (await netBalance(late.policyId, "refund_payable")) === 0 &&
      (await netBalance(late.policyId, "commission_payable")) === -(18000 + 5794 + 739 - 369),
    `${completed.kind}, refund_payable ${await netBalance(late.policyId, "refund_payable")}, commission ${await netBalance(late.policyId, "commission_payable")}`,
  );

  // ---------------------------------------------------------------------------
  // 4. The other direction from the start: booked at day 100, corrected to day 130
  // ---------------------------------------------------------------------------

  const early = await endorsedPolicy(DAY_100);
  const earlyOperator = { userId: early.staffUserId, role: "staff_ops" as const };
  const givenBack = await recordEndorsementDateCorrection(
    {
      policyId: early.policyId,
      correctedEventId: early.endorsedEventId,
      correctedEffectiveAt: DAY_130,
      reason: "the cover actually started on July 9, not June 9",
      actor: earlyOperator,
    },
    runtime,
  );
  report(
    "corrected the other way: 44584 collected, 39537 owed, 5047 given back with a 739 clawback",
    givenBack.plan.money.settlement === "refund" &&
      givenBack.plan.money.differenceTotalCents === -5047 &&
      givenBack.plan.money.differenceCommissionCents === -739 &&
      givenBack.refundOperationIds.length === 1 &&
      givenBack.refundOperationIdsAwaitingApproval.length === 0,
    `${givenBack.plan.money.differenceTotalCents}, ${givenBack.refundOperationIds.length} refund(s), ${givenBack.approvalRequestIds.length} approval request(s)`,
  );
  report(
    "the ledger says the customer is owed 5047 and the receivable is flat",
    (await netBalance(early.policyId, "refund_payable")) === -5047 && (await premiumReceivableBalance(runtime, early.policyId)) === 0,
    `refund_payable ${await netBalance(early.policyId, "refund_payable")}, receivable ${await premiumReceivableBalance(runtime, early.policyId)}`,
  );
  const earlyAsOf = await policyAsItStoodOn(early.policyId, "2028-06-20", runtime);
  report(
    "and the policy on 2028-06-20 now reads $1,200 again: the endorsement no longer started that day",
    "snapshot" in earlyAsOf && earlyAsOf.snapshot.annualPremiumCents === ANNUAL_PREMIUM_CENTS,
    "snapshot" in earlyAsOf ? `annual ${earlyAsOf.snapshot.annualPremiumCents}` : earlyAsOf.error,
  );

  // ---------------------------------------------------------------------------
  // 4b. The two thresholds are cumulative over the POLICY (review finding F-B8-02)
  // ---------------------------------------------------------------------------
  //
  // Neither question is about this correction alone. A difference of $191.80 given back is well
  // under the $1,000 that needs a second person, and it still has to be queued when the policy has
  // already sent $900.68 back: otherwise three corrections in a row move $1,800 with nobody
  // approving anything. The same trick works on the customer's side, so both are proved here.

  // The money-out side: a reduction that refunds 90068 and is still on its way, then a raise, then
  // a correction that gives back 19180. 19180 alone would go straight to Stripe; 90068 + 19180 is
  // above $1,000, so it waits for an approver instead.
  const cumulative = await createPaidPolicy(recordSuccessfulPayment);
  const cumulativeBroker: Actor = { userId: cumulative.brokerUserId, role: "broker", brokerId: cumulative.brokerId, customerId: null };
  const reduction = {
    policyId: cumulative.policyId,
    effectiveAt: TERM_START,
    newAnnualPremiumCents: 32000,
    newPerOccurrenceLimitCents: PER_OCCURRENCE,
    newAggregateLimitCents: AGGREGATE,
    reason: "cover reduced from the start of the term",
    actor: cumulativeBroker,
  };
  const reductionPlan = await planEndorsement(reduction, runtime);
  const reductionResult = await recordEndorsementRequest(
    { ...reduction, expectedQuoteHash: reductionPlan.figures.quoteHash },
    runtime,
  );
  report(
    "a first reduction gives back 90068, under the $1,000 line, so nobody has to approve it",
    reductionPlan.figures.deltaTotalCents === -90068 &&
      reductionPlan.refundNeedsApproval === false &&
      reductionResult.refundOperationIdsAwaitingApproval.length === 0,
    `${-reductionPlan.figures.deltaTotalCents} back, needs approval ${reductionPlan.refundNeedsApproval}`,
  );

  const raiseAfterReduction = {
    ...reduction,
    effectiveAt: DAY_100,
    newAnnualPremiumCents: 92000,
    reason: "cover raised again",
  };
  const raisePlan = await planEndorsement(raiseAfterReduction, runtime);
  const raiseRequested = await recordEndorsementRequest(
    { ...raiseAfterReduction, expectedQuoteHash: raisePlan.figures.quoteHash },
    runtime,
  );
  const raiseQuote = (await readEndorsementRequest(runtime, cumulative.policyId, raiseRequested.requestEventId))!;
  const raiseAttempt = await createEndorsementCheckoutOperation(
    { quote: raiseQuote, userId: cumulative.brokerUserId, attempt: 1 },
    runtime,
  );
  await recordSuccessfulEndorsementPayment(
    {
      operationId: raiseAttempt.operationId,
      paymentIntentId: `pi_cumulative_${raiseAttempt.operationId.slice(0, 8)}`,
      amountReceivedCents: raisePlan.figures.deltaTotalCents,
      paidOn: DAY_100,
    },
    runtime,
  );
  // This policy has TWO applied endorsements, the reduction and the raise; the latest one is the
  // only one that can be corrected.
  const [raisedEvent] = await owner<{ id: string }[]>`
    select id from policy_events
     where policy_id = ${cumulative.policyId} and event_type = 'endorsed'
     order by sequence_number desc limit 1
  `;

  const cumulativeOperator = { userId: cumulative.staffUserId, role: "staff_ops" as const };
  const queuedPlan = await planEndorsementDateCorrection(
    {
      policyId: cumulative.policyId,
      correctedEventId: raisedEvent.id,
      correctedEffectiveAt: "2028-10-01",
      reason: "the raise started on October 1, not June 9",
      actor: cumulativeOperator,
    },
    runtime,
  );
  report(
    "the correction gives back 19180, which alone is far under the $1,000 line",
    queuedPlan.money.differenceTotalCents === -19180 && -queuedPlan.money.differenceTotalCents < 100000,
    `${-queuedPlan.money.differenceTotalCents} back`,
  );
  report(
    "and it STILL NEEDS AN APPROVER, because the policy already has 90068 on its way back",
    queuedPlan.money.refundNeedsApproval === true &&
      queuedPlan.money.totals.policyPendingRefundCents === 90068 &&
      queuedPlan.money.totals.policyRefundedCents === 0,
    `pending ${queuedPlan.money.totals.policyPendingRefundCents}, already refunded ${queuedPlan.money.totals.policyRefundedCents}`,
  );
  report(
    "the screen sentence names the total behind the verdict, never just the verdict",
    /takes what this policy has given back past \$1,000\.00/.test(queuedPlan.approvalSentences.refund ?? "") &&
      /\$900\.68 still on its way/.test(queuedPlan.approvalSentences.refund ?? ""),
    queuedPlan.approvalSentences.refund ?? "no sentence",
  );

  const queuedCorrection = await recordEndorsementDateCorrection(
    {
      policyId: cumulative.policyId,
      correctedEventId: raisedEvent.id,
      correctedEffectiveAt: "2028-10-01",
      reason: "the raise started on October 1, not June 9",
      actor: cumulativeOperator,
    },
    runtime,
  );
  report(
    "so it is QUEUED with an approval request and nothing is sent to Stripe",
    queuedCorrection.refundOperationIdsAwaitingApproval.length === 1 &&
      queuedCorrection.approvalRequestIds.length === 1 &&
      (await countOperationEvents(queuedCorrection.refundOperationIds[0], "provider_accepted")) === 0,
    `${queuedCorrection.approvalRequestIds.length} approval request(s), ${await countOperationEvents(queuedCorrection.refundOperationIds[0], "provider_accepted")} sent`,
  );
  report(
    "the verdict and the totals behind it are written on the correction event, not recomputed later",
    (await correctionsOfPolicy(cumulative.policyId, runtime))[0]?.money.refundNeedsApproval === true &&
      (await correctionsOfPolicy(cumulative.policyId, runtime))[0]?.money.totals.policyPendingRefundCents === 90068,
    `read back: needs approval ${(await correctionsOfPolicy(cumulative.policyId, runtime))[0]?.money.refundNeedsApproval}`,
  );

  // The customer's side: a raise of 48762 that the customer has not answered, then a correction
  // that collects 5047. Each is under $500; together they are above it, so the customer decides.
  const waiting = await endorsedPolicy(DAY_130);
  const waitingBroker: Actor = { userId: waiting.brokerUserId, role: "broker", brokerId: waiting.brokerId, customerId: null };
  const secondRaise = {
    policyId: waiting.policyId,
    effectiveAt: DAY_130,
    newAnnualPremiumCents: 254000,
    newPerOccurrenceLimitCents: RAISED_PER_OCCURRENCE,
    newAggregateLimitCents: RAISED_AGGREGATE,
    reason: "a second raise, still waiting for the customer",
    actor: waitingBroker,
  };
  const secondRaisePlan = await planEndorsement(secondRaise, runtime);
  await recordEndorsementRequest({ ...secondRaise, expectedQuoteHash: secondRaisePlan.figures.quoteHash }, runtime);
  const askedPlan = await planEndorsementDateCorrection(
    {
      policyId: waiting.policyId,
      correctedEventId: waiting.endorsedEventId,
      correctedEffectiveAt: DAY_100,
      reason: "the first endorsement started on June 9",
      actor: { userId: waiting.staffUserId, role: "staff_ops" },
    },
    runtime,
  );
  report(
    "a difference of 5047 to collect is far under $500 on its own",
    askedPlan.money.differenceTotalCents === 5047 && askedPlan.money.differenceTotalCents < 50000,
    `${askedPlan.money.differenceTotalCents} to collect`,
  );
  report(
    "and it STILL NEEDS THE CUSTOMER, because 48762 of quotes are already waiting for them",
    askedPlan.money.customerApprovalRequired === true &&
      askedPlan.money.totals.customerUnapprovedRequestedCents === 48762 &&
      /still waiting for this customer/.test(askedPlan.approvalSentences.customer ?? ""),
    `waiting ${askedPlan.money.totals.customerUnapprovedRequestedCents}: ${askedPlan.approvalSentences.customer ?? "no sentence"}`,
  );

  // ---------------------------------------------------------------------------
  // 5. Refusals
  // ---------------------------------------------------------------------------

  const stillEarly = await endorsedPolicy(DAY_100);
  const base = {
    policyId: stillEarly.policyId,
    correctedEventId: stillEarly.endorsedEventId,
    correctedEffectiveAt: DAY_130,
    reason: "a reason long enough to be recorded",
    actor: { userId: stillEarly.staffUserId, role: "staff_ops" as const },
  };
  const asBroker = await refusal(() =>
    planEndorsementDateCorrection(
      { ...base, actor: { userId: stillEarly.brokerUserId, role: "broker" } },
      runtime,
    ),
  );
  report("a broker cannot correct a date: it is an operations job", /only staff operations/.test(asBroker), asBroker);
  const noReason = await refusal(() => planEndorsementDateCorrection({ ...base, reason: "typo" }, runtime));
  report("a correction without a written reason is refused", /written reason/.test(noReason), noReason);
  const beforeTerm = await refusal(() => planEndorsementDateCorrection({ ...base, correctedEffectiveAt: "2028-02-28" }, runtime));
  report("a date before the policy starts is refused: that would be correcting the issuance", /before the policy starts/.test(beforeTerm), beforeTerm);
  const afterTerm = await refusal(() => planEndorsementDateCorrection({ ...base, correctedEffectiveAt: "2029-03-02" }, runtime));
  report("a date after the term ends is refused", /ends on 2029-03-01/.test(afterTerm), afterTerm);
  const notADate = await refusal(() => planEndorsementDateCorrection({ ...base, correctedEffectiveAt: "2028-02-30" }, runtime));
  report("a date that does not exist is refused", /not a calendar date/.test(notADate), notADate);
  const sameDate = await refusal(() => planEndorsementDateCorrection({ ...base, correctedEffectiveAt: DAY_100 }, runtime));
  report("correcting to the date it already carries is refused", /nothing to correct/.test(sameDate), sameDate);

  const cancelled = await endorsedPolicy(DAY_100);
  await recordCancellation(
    { policyId: cancelled.policyId, effectiveAt: "2028-09-01", calculationMethod: "pro_rata", actor: { userId: cancelled.brokerUserId, role: "broker", brokerId: cancelled.brokerId } },
    runtime,
  );
  const onCancelled = await refusal(() =>
    planEndorsementDateCorrection(
      {
        policyId: cancelled.policyId,
        correctedEventId: cancelled.endorsedEventId,
        correctedEffectiveAt: DAY_130,
        reason: "trying to correct a cancelled policy",
        actor: { userId: cancelled.staffUserId, role: "staff_ops" },
      },
      runtime,
    ),
  );
  report("a cancelled policy cannot have its endorsement corrected", /cancelled/.test(onCancelled), onCancelled);

  // The three claims review finding F-B8-06 found proven by code reading alone. Each one builds
  // the state on this disposable database and reads the sentence the production function gives.

  // A VOIDED POLICY. The void itself (lib/policy/void-fabricated-binding.ts) asks Stripe whether
  // the payment intent exists before it writes anything, and this check calls no provider, so the
  // voided state is written here as the void writes it: a 'correction_reversal' event superseding
  // the issuance, appended, nothing updated or deleted. The fold then drops the 'issued' event,
  // which is exactly what policyWasVoided reads. What is proved here is the refusal.
  const voided = await endorsedPolicy(DAY_100);
  const [issuedEvent] = await owner<{ id: string }[]>`
    select id from policy_events where policy_id = ${voided.policyId} and event_type = 'issued'
  `;
  await owner`
    insert into policy_events (policy_id, event_type, effective_at, payload, supersedes_event_id, created_by)
    values (${voided.policyId}, 'correction_reversal', ${TERM_START},
            ${owner.json({ reason: "the binding rested on a payment that was never made (check fixture)" })},
            ${issuedEvent.id}, ${voided.staffUserId})
  `;
  const onVoided = await refusal(() =>
    planEndorsementDateCorrection(
      {
        policyId: voided.policyId,
        correctedEventId: voided.endorsedEventId,
        correctedEffectiveAt: DAY_130,
        reason: "trying to correct an endorsement of a voided policy",
        actor: { userId: voided.staffUserId, role: "staff_ops" },
      },
      runtime,
    ),
  );
  report(
    "a voided policy cannot have its endorsement corrected: there is no policy under it any more",
    /voided by a correction/.test(onVoided),
    onVoided,
  );

  // AN ENDORSEMENT THAT REFUNDED PREMIUM (the disclosed limitation of the slice). A reduction is
  // applied immediately and opens a refund, so the policy carries an applied endorsement whose
  // delta went the other way. Correcting its date is refused by name rather than half computed.
  const reduced = await createPaidPolicy(recordSuccessfulPayment);
  const reducingBroker: Actor = { userId: reduced.brokerUserId, role: "broker", brokerId: reduced.brokerId, customerId: null };
  const reducingEndorsement = {
    policyId: reduced.policyId,
    effectiveAt: DAY_100,
    newAnnualPremiumCents: 90000,
    newPerOccurrenceLimitCents: PER_OCCURRENCE,
    newAggregateLimitCents: AGGREGATE,
    reason: "cover reduced, the delta is given back",
    actor: reducingBroker,
  };
  const reducingPlan = await planEndorsement(reducingEndorsement, runtime);
  const reducingResult = await recordEndorsementRequest(
    { ...reducingEndorsement, expectedQuoteHash: reducingPlan.figures.quoteHash },
    runtime,
  );
  const reducingEventId = reducingResult.endorsedEventId;
  if (!reducingEventId) {
    throw new Error("the fixture reduction was not applied immediately, so there is no endorsement to try to correct");
  }
  const onRefundedEndorsement = await refusal(() =>
    planEndorsementDateCorrection(
      {
        policyId: reduced.policyId,
        correctedEventId: reducingEventId,
        correctedEffectiveAt: DAY_130,
        reason: "trying to correct an endorsement whose delta was refunded",
        actor: { userId: reduced.staffUserId, role: "staff_ops" },
      },
      runtime,
    ),
  );
  report(
    "an endorsement whose delta was REFUNDED is refused by name, not half corrected",
    reducingPlan.figures.direction === "refund" && /only corrects an endorsement whose delta was collected/.test(onRefundedEndorsement),
    `direction ${reducingPlan.figures.direction}: ${onRefundedEndorsement}`,
  );

  // ---------------------------------------------------------------------------
  // 5b. A cancellation after a correction gives back the CORRECTED figure
  // ---------------------------------------------------------------------------
  //
  // Decision 18's claim, and the one F-B8-06 rated as mattering most: after a correction the
  // refund is computed from the corrected written premium segments, not from the ones that were
  // booked. `late` is the policy corrected twice (41095 of premium from 2028-06-24, replacing the
  // 38630 booked on 2028-07-09) whose refund has completed, so nothing is outstanding on it.
  // Nothing else reads it after this point.
  //
  // The cancellation date is deliberately 2028-07-01, between the corrected date and the date
  // that was booked: the corrected segment has been earning for a week, and the segment nobody
  // corrected would not have started at all. The two refunds are then far apart, so the assertion
  // below cannot pass on a rounding coincidence.
  const CANCELLED_ON = "2028-07-01";
  const cancelledAfterCorrection = await recordCancellation(
    {
      policyId: late.policyId,
      effectiveAt: CANCELLED_ON,
      calculationMethod: "pro_rata",
      actor: { userId: late.brokerUserId, role: "broker", brokerId: late.brokerId },
    },
    runtime,
  );
  // The same computation, fed the segment the policy WOULD have had if nobody had corrected it:
  // the delta as it was first booked, on the date it was first booked. If the cancellation read
  // the corrected history, the two refunds differ.
  const ifNobodyHadCorrected = cancellationBreakdown({
    writtenPremiumSegments: [
      cancelledAfterCorrection.plan.writtenPremiumSegments[0],
      { writtenPremiumCents: 38630, startsOn: DAY_130, endsOn: TERM_END },
    ],
    taxChargedCents: cancelledAfterCorrection.plan.taxChargedCents,
    taxRateBps: cancelledAfterCorrection.plan.terms.taxRateBps,
    commissionRateBps: cancelledAfterCorrection.plan.commissionRateBps,
    cancellationEffectiveAt: CANCELLED_ON,
  });
  const correctedSegment = cancelledAfterCorrection.plan.writtenPremiumSegments[1];
  report(
    "a cancellation after a correction gives back the CORRECTED segment: 41095 from 2028-06-24, not the 38630 booked on 2028-07-09",
    correctedSegment.writtenPremiumCents === 41095 &&
      correctedSegment.startsOn === "2028-06-24" &&
      cancelledAfterCorrection.plan.breakdown.totalRefundCents !== ifNobodyHadCorrected.totalRefundCents &&
      (await policyCurrent(late.policyId)).status === "cancelled",
    `segments ${cancelledAfterCorrection.plan.writtenPremiumSegments.map((segment) => `${segment.writtenPremiumCents} from ${segment.startsOn}`).join(", ")}; ` +
      `refund ${cancelledAfterCorrection.plan.breakdown.totalRefundCents}, and ${ifNobodyHadCorrected.totalRefundCents} if nobody had corrected it`,
  );

  // ---------------------------------------------------------------------------
  // 6. The whole ledger still balances
  // ---------------------------------------------------------------------------

  const [totals] = await owner<{ debit: string; credit: string }[]>`
    select coalesce(sum(debit_cents), 0)::text as debit, coalesce(sum(credit_cents), 0)::text as credit from journal_lines
  `;
  report("every journal line in the database balances, debits against credits", totals.debit === totals.credit, `debits ${totals.debit} = credits ${totals.credit}`);

  const [unbalanced] = await owner<{ count: string }[]>`
    select count(*)::text as count from (
      select entry_id from journal_lines group by entry_id having sum(debit_cents) <> sum(credit_cents)
    ) broken
  `;
  report("and every single entry balances on its own", unbalanced.count === "0", `${unbalanced.count} unbalanced entries`);

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
// settling window does not apply), a customer, four users, a policy, its quote and a money
// operation awaiting the provider.
async function createPolicyAwaitingPayment(): Promise<Fixture> {
  const totalCents = ANNUAL_PREMIUM_CENTS + TAX_CENTS + FEE_CENTS;
  return owner.begin(async (transaction) => {
    const [broker] = await transaction<{ id: string }[]>`insert into brokers (name, commission_rate_bps) values ('Correction check broker', 1500) returning id`;
    await transaction`insert into broker_kyb_events (broker_id, provider, status) values (${broker.id}, 'seed', 'approved')`;
    const [customer] = await transaction<{ id: string }[]>`
      insert into customers (name, email) values ('Correction check customer', 'correction-check-' || gen_random_uuid()::text || '@example.invalid') returning id
    `;
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    const [brokerUser] = await transaction<{ id: string }[]>`
      insert into users (email, display_name, role, broker_id) values (${`correction-broker-${suffix}@example.invalid`}, 'Correction check broker user', 'broker', ${broker.id}) returning id
    `;
    const [customerUser] = await transaction<{ id: string }[]>`
      insert into users (email, display_name, role, customer_id) values (${`correction-customer-${suffix}@example.invalid`}, 'Correction check customer user', 'customer', ${customer.id}) returning id
    `;
    const [staffUser] = await transaction<{ id: string }[]>`
      insert into users (email, display_name, role) values (${`correction-ops-${suffix}@example.invalid`}, 'Correction check operator', 'staff_ops') returning id
    `;
    const [approverUser] = await transaction<{ id: string }[]>`
      insert into users (email, display_name, role) values (${`correction-approver-${suffix}@example.invalid`}, 'Correction check approver', 'staff_approver') returning id
    `;
    const [policy] = await transaction<{ id: string }[]>`insert into policies (broker_id, customer_id, state_code) values (${broker.id}, ${customer.id}, 'CA') returning id`;
    await transaction`
      insert into policy_events (policy_id, event_type, effective_at, payload)
      values (${policy.id}, 'quoted', ${TERM_START}, ${transaction.json({
        state_code: "CA", term_start: TERM_START, term_end: TERM_END, annual_premium_cents: ANNUAL_PREMIUM_CENTS, tax_rate_bps: 235,
        tax_cents: TAX_CENTS, fee_cents: FEE_CENTS, total_charge_cents: totalCents, per_occurrence_limit_cents: PER_OCCURRENCE, aggregate_limit_cents: AGGREGATE,
      })})
    `;
    const [operation] = await transaction<{ id: string }[]>`
      insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key)
      values ('stripe_checkout', 'stripe', ${totalCents}, ${policy.id}, 'policy-checkout:' || ${policy.id}) returning id
    `;
    await transaction`insert into money_operation_events (operation_id, status) values (${operation.id}, 'requested')`;
    return {
      policyId: policy.id, brokerId: broker.id, customerId: customer.id, brokerUserId: brokerUser.id, customerUserId: customerUser.id,
      staffUserId: staffUser.id, approverUserId: approverUser.id, operationId: operation.id,
      paymentIntentId: `pi_correction_check_${operation.id.slice(0, 8)}`,
    };
  });
}

async function createPaidPolicy(
  recordSuccessfulPayment: typeof import("@/lib/payments/collection").recordSuccessfulPayment,
): Promise<Fixture> {
  const fixture = await createPolicyAwaitingPayment();
  const collected = await recordSuccessfulPayment(
    {
      operationId: fixture.operationId,
      paymentIntentId: fixture.paymentIntentId,
      amountReceivedCents: ANNUAL_PREMIUM_CENTS + TAX_CENTS + FEE_CENTS,
      paidOn: TERM_START,
    },
    runtime,
  );
  if (collected.kind !== "posted") {
    throw new Error(`the fixture policy could not be paid: ${JSON.stringify(collected)}`);
  }
  return fixture;
}

// Every row of this policy, as JSON text keyed by table and id. Comparing two of these is the
// literal test of AF-03: an existing row that differs, or has gone, is a mutation.
async function snapshotPolicyRows(policyId: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  const add = (table: string, rows: { id: string; row: string }[]) => {
    for (const row of rows) {
      snapshot.set(`${table}:${row.id}`, row.row);
    }
  };
  add("policy_events", await owner<{ id: string; row: string }[]>`
    select id::text, to_jsonb(policy_events)::text as row from policy_events where policy_id = ${policyId}
  `);
  add("journal_entries", await owner<{ id: string; row: string }[]>`
    select id::text, to_jsonb(journal_entries)::text as row from journal_entries where policy_id = ${policyId}
  `);
  add("journal_lines", await owner<{ id: string; row: string }[]>`
    select line.id::text, to_jsonb(line)::text as row
      from journal_lines line join journal_entries entry on entry.id = line.entry_id
     where entry.policy_id = ${policyId}
  `);
  add("money_operations", await owner<{ id: string; row: string }[]>`
    select id::text, to_jsonb(money_operations)::text as row from money_operations where policy_id = ${policyId}
  `);
  add("money_operation_events", await owner<{ id: string; row: string }[]>`
    select event.id::text, to_jsonb(event)::text as row
      from money_operation_events event join money_operations operation on operation.id = event.operation_id
     where operation.policy_id = ${policyId}
  `);
  add("endorsement_collections", await owner<{ id: string; row: string }[]>`
    select id::text, to_jsonb(endorsement_collections)::text as row from endorsement_collections where policy_id = ${policyId}
  `);
  add("refund_allocations", await owner<{ id: string; row: string }[]>`
    select id::text, to_jsonb(refund_allocations)::text as row from refund_allocations where policy_id = ${policyId}
  `);
  return snapshot;
}

// The first row that changed or disappeared, or null when every earlier row survived untouched.
function sameRows(before: Map<string, string>, after: Map<string, string>): string | null {
  for (const [key, row] of before) {
    const now = after.get(key);
    if (now === undefined) {
      return `${key} no longer exists`;
    }
    if (now !== row) {
      return `${key} changed`;
    }
  }
  return null;
}

async function entriesOfSource(policyId: string, sourceKind: string, sourceId: string) {
  return owner<{ id: string; entry_type: string; effective_at: string; recorded_at: Date; reverses_entry_id: string | null }[]>`
    select id, entry_type, to_char(effective_at, 'YYYY-MM-DD') as effective_at, recorded_at, reverses_entry_id
      from journal_entries
     where policy_id = ${policyId} and source_kind = ${sourceKind} and source_id = ${sourceId}
     order by entry_type
  `;
}

// For each reversal entry: does every line mirror the line it reverses (debit for credit, same
// account, same amount) and does it carry the same effective date?
async function linesMirrorTheOriginal(reversalEntryIds: string[]): Promise<{ entryId: string; mirrored: boolean }[]> {
  const answers: { entryId: string; mirrored: boolean }[] = [];
  for (const entryId of reversalEntryIds) {
    const [row] = await owner<{ mirrored: boolean }[]>`
      select bool_and(reversal.debit_cents = original.credit_cents and reversal.credit_cents = original.debit_cents) as mirrored
        from journal_entries head
        join journal_lines reversal on reversal.entry_id = head.id
        join journal_lines original on original.entry_id = head.reverses_entry_id and original.account_id = reversal.account_id
       where head.id = ${entryId}
    `;
    answers.push({ entryId: entryId.slice(0, 8), mirrored: row?.mirrored === true });
  }
  return answers;
}

async function amountOnEntry(entryId: string, accountId: string, side: "debit" | "credit"): Promise<number> {
  const [row] = await owner<{ amount: string | null }[]>`
    select sum(${side === "debit" ? owner`debit_cents` : owner`credit_cents`})::text as amount
      from journal_lines where entry_id = ${entryId} and account_id = ${accountId}
  `;
  return row.amount === null ? -1 : Number(row.amount);
}

async function netBalance(policyId: string, accountId: string): Promise<number> {
  const [row] = await owner<{ amount: string }[]>`
    select coalesce(sum(line.debit_cents) - sum(line.credit_cents), 0)::text as amount
      from journal_lines line join journal_entries entry on entry.id = line.entry_id
     where entry.policy_id = ${policyId} and line.account_id = ${accountId}
  `;
  return Number(row.amount);
}

async function policyCurrent(policyId: string): Promise<{ status: string; annual: number }> {
  const [row] = await owner<{ status: string; annual_premium_cents: string }[]>`
    select status, annual_premium_cents from policy_current where policy_id = ${policyId}
  `;
  return { status: row?.status ?? "no cache row", annual: Number(row?.annual_premium_cents ?? -1) };
}

async function operationAmount(operationId: string): Promise<number> {
  const [row] = await owner<{ amount_cents: string }[]>`select amount_cents from money_operations where id = ${operationId}`;
  return Number(row?.amount_cents ?? -1);
}

async function operationIdempotencyKey(operationId: string): Promise<string> {
  const [row] = await owner<{ idempotency_key: string }[]>`select idempotency_key from money_operations where id = ${operationId}`;
  return row?.idempotency_key ?? "no operation";
}

async function countOperationEvents(operationId: string, status: string): Promise<number> {
  const [row] = await owner<{ count: string }[]>`select count(*)::text as count from money_operation_events where operation_id = ${operationId} and status = ${status}`;
  return Number(row.count);
}

async function allocationOf(operationId: string): Promise<string> {
  const [row] = await owner<{ refunded_premium_cents: string; refunded_tax_cents: string; commission_clawback_cents: string; payment_intent_id: string }[]>`
    select refunded_premium_cents, refunded_tax_cents, commission_clawback_cents, payment_intent_id from refund_allocations where refund_operation_id = ${operationId}
  `;
  return row ? `${row.refunded_premium_cents}/${row.refunded_tax_cents}/${row.commission_clawback_cents}/${row.payment_intent_id}` : "no allocation";
}

// Reversing an entry that already carries a reversal, straight through lib/ledger/reverse.ts, to
// show that the database refuses it whatever the calling code believes. The transaction rolls
// back, so nothing is written by this probe.
async function messageOfDatabaseError(
  policyId: string,
  correctionEventId: string,
  alreadyReversedEntryId: string,
  reverseJournalEntry: typeof import("@/lib/ledger/reverse").reverseJournalEntry,
): Promise<string> {
  try {
    await runtime.begin(async (transaction) => {
      await reverseJournalEntry(transaction, {
        originalEntryId: alreadyReversedEntryId,
        correctionEventId,
        createdBy: null,
        description: `probe on policy ${policyId}: this entry is already reversed`,
      });
    });
    return "no refusal";
  } catch (error) {
    const named = error as { constraint_name?: string; message?: string };
    return `${named.constraint_name ?? ""} ${named.message ?? String(error)}`;
  }
}

main().catch(async (error) => {
  console.error("check failed to run:", error instanceof Error ? (error.stack ?? error.message) : error);
  const details = error as { detail?: string; query?: string; hint?: string };
  if (details.detail || details.query) {
    console.error(details.detail ?? "", (details.query ?? "").slice(0, 300));
  }
  await owner.end();
  await runtime.end();
  process.exit(1);
});
