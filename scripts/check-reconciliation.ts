import { readFileSync } from "node:fs";
import postgres from "postgres";

// Proves, against a real database and through the production functions, the properties slice B10
// rests on:
//
//   1. every classification the brief names is produced by a real run and stored: matched,
//      local-only, provider-only, amount mismatch and stale;
//   2. a break keeps its identity across runs, so its AGE is counted from the first run that saw
//      it and not from the latest one;
//   3. a break that is fixed stops being reported and appears as resolved, without any row ever
//      being updated or deleted;
//   4. a PLANTED PAYOUT MISMATCH is found: a transfer that exists at the claim payout rail and
//      nowhere in the ledger, and a transfer the rail settled while the ledger did not;
//   5. a PLANTED PROVIDER-ONLY PAYMENT is found at the real Stripe sandbox: a PaymentIntent this
//      script creates with a test payment method and no metadata at all;
//   6. a failed fetch is NEVER reported as a clean reconciliation: it stores a failed run with
//      its reason and no items, and it does not clear the breaks the last complete run found.
//
// WHERE EACH THING RUNS
//
//   * the ledger, the rail and the reconciliation runs: the disposable database corgi_test, with
//     the RESTRICTED runtime role, so this also proves the job works with the privileges the
//     deployed application actually has. It commits rows, so it refuses to run anywhere else:
//     financial rows can never be deleted (AF-03) and the trial ledger must stay clean.
//   * Stripe: two different things, never mixed up. Part 1 uses the SANITIZED CAPTURED LISTING
//     under lib/reconciliation/fixtures (real objects, no network) with its ids and amounts
//     rewritten to the operations this script creates, because corgi_test does not contain the
//     demo policy the captured ids belong to. Part 5 uses the REAL test-mode API.
//
// Run with: npm run check:reconciliation

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

// P1 pays 355684 cents: premium 345075, California tax at 235 bps (8109) and the $25 fee.
const P1_PREMIUM_CENTS = 345075;
const P1_TAX_CENTS = 8109;
// P2 and P3 are the recited example: $1,200 premium, $28.20 tax, $25 fee, $1,253.20 charged.
const RECITED_PREMIUM_CENTS = 120000;
const RECITED_TAX_CENTS = 2820;
const FEE_CENTS = 2500;
const TERM_START = "2028-03-01";
const TERM_END = "2029-03-01";
const CANCELLED_ON = "2028-06-09"; // day 100 of the term, the recited cancellation
const PER_OCCURRENCE_LIMIT_CENTS = 1000000;
const AGGREGATE_LIMIT_CENTS = 1500000;

// What Stripe lists for P2: 320 cents less than the ledger booked. The difference is signed and
// reads "the provider holds 320 cents less than the books say".
const AMOUNT_MISMATCH_SHORTFALL_CENTS = 320;
// The planted payment: no operation id at all, so nothing in the ledger can claim it.
const PLANTED_PAYMENT_CENTS = 4242;

// Claim payments, all three below the $1,000 approval threshold so this check stays about
// reconciliation and not about maker-checker (scripts/check-claims-and-approvals.ts owns that).
const CLAIM_RESERVE_CENTS = 200000;
const SETTLED_PAYMENT_CENTS = 42000;
const UNSETTLED_IN_LEDGER_PAYMENT_CENTS = 31000;
const STILL_IN_FLIGHT_PAYMENT_CENTS = 27000;
const PLANTED_RAIL_TRANSFER_CENTS = 90000;

const CLAIMANT_NAME = "Bay Area Fabrication LLC";
const REACHABLE_ROUTING_NUMBER = "110000000";

const HOUR_IN_MS = 3600 * 1000;

let failures = 0;
function report(name: string, passed: boolean, detail: string) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}  (${detail})`);
  if (!passed) failures += 1;
}

const owner = postgres(ownerUrl, { max: 2, prepare: false });
const runtime = postgres(runtimeUrl, { max: 4, prepare: false });

async function main() {
  // Imported here rather than at the top of the file: these modules open the application
  // connection pool and read the Stripe key as soon as they are loaded, which needs .env.local
  // read first.
  const { recordSuccessfulPayment } = await import("@/lib/payments/collection");
  const { recordCancellation } = await import("@/lib/policy/cancel");
  const { openClaim, setClaimReserve, todayUtc, SCHEDULED_JOB } = await import("@/lib/claims/claims");
  const { addClaimantBankAccount, requestClaimPayment, sendClaimPayment, settleClaimPayment } = await import(
    "@/lib/claims/payments"
  );
  const { runReconciliation } = await import("@/lib/reconciliation/run");
  const { stripeSource } = await import("@/lib/reconciliation/stripe-source");
  const { claimsRailSourceOn } = await import("@/lib/reconciliation/claims-rail-source");
  const { stripeRecordsFromListing } = await import("@/lib/reconciliation/stripe-records");
  const { ledgerCashMovements } = await import("@/lib/reconciliation/ledger-side");
  const { openBreaks, recentRuns, resolvedBreaks } = await import("@/lib/reconciliation/read");
  const { assertStripeSandbox, stripe } = await import("@/lib/stripe");
  type StripeWindowListing = import("@/lib/reconciliation/stripe-records").StripeWindowListing;
  type ReconciliationSource = import("@/lib/reconciliation/source").ReconciliationSource;
  type ReconciliationWindow = import("@/lib/reconciliation/window").ReconciliationWindow;

  const [{ current_database: databaseName }] = await owner<{ current_database: string }[]>`
    select current_database()
  `;
  if (databaseName !== "corgi_test") {
    console.error(`refusing to run: connected to "${databaseName}", expected the disposable database "corgi_test"`);
    process.exit(1);
  }

  // Everything this check compares was recorded after this instant. corgi_test is shared with the
  // other slices' checks, so the window starts here rather than "the last seven days": the run
  // then sees this check's own operations and not whatever another check committed an hour ago.
  const checkStartedAt = new Date();
  const window: ReconciliationWindow = { from: checkStartedAt, to: new Date(Date.now() + 60 * 60 * 1000) };
  const now = new Date();

  // ---------------------------------------------------------------------------
  // 0. The ledger this check compares against
  // ---------------------------------------------------------------------------

  const people = await createPeople();
  const maker = { userId: people.makerId, role: "staff_ops" as const };

  const p1 = await createPaidPolicy(recordSuccessfulPayment, people.brokerId, P1_PREMIUM_CENTS, P1_TAX_CENTS);
  const p2 = await createPaidPolicy(recordSuccessfulPayment, people.brokerId, RECITED_PREMIUM_CENTS, RECITED_TAX_CENTS);
  const p3 = await createPaidPolicy(recordSuccessfulPayment, people.brokerId, RECITED_PREMIUM_CENTS, RECITED_TAX_CENTS);
  report(
    "three paid policies were seeded, with their cash on the ledger",
    p1.totalChargeCents === 355684 && p2.totalChargeCents === 125320,
    `${p1.totalChargeCents}, ${p2.totalChargeCents}, ${p3.totalChargeCents} cents`,
  );

  // A cancellation, so there is a refund the ledger owes and Stripe has not paid yet. It posts
  // refund_requested (refund_payable credited) and creates the refund operation; it does not call
  // Stripe, which is exactly the situation a reconciliation has to reason about.
  const cancellation = await recordCancellation(
    {
      policyId: p1.policyId,
      effectiveAt: CANCELLED_ON,
      calculationMethod: "pro_rata",
      actor: { userId: maker.userId, role: "staff_ops", brokerId: null },
    },
    runtime,
  );
  const refundOperationId = cancellation.refundOperationIds[0] ?? cancellation.refundOperationIdsAwaitingApproval[0];
  const refundCents = cancellation.plan.breakdown.totalRefundCents;
  report(
    "a cancellation left a refund the ledger owes and Stripe has not paid",
    Boolean(refundOperationId) && refundCents > 0,
    `operation ${refundOperationId}, ${refundCents} cents owed`,
  );

  // The ledger side, read on its own before any comparison: this is the query every run depends
  // on, so a mistake in it should be visible here rather than as a strange classification later.
  const ledgerNow = await ledgerCashMovements(
    { cashAccount: "cash_stripe", operationProvider: "stripe", window },
    runtime,
  );
  const ledgerByOperation = new Map(ledgerNow.map((record) => [record.operationId, record]));
  report(
    "the ledger side reads the collected cash of each checkout",
    ledgerByOperation.get(p1.operationId)?.cashCents === p1.totalChargeCents &&
      ledgerByOperation.get(p2.operationId)?.cashCents === p2.totalChargeCents,
    `${ledgerByOperation.get(p1.operationId)?.cashCents} and ${ledgerByOperation.get(p2.operationId)?.cashCents} cents`,
  );
  report(
    "the ledger side shows a requested refund as no cash moved and an open clearing balance",
    ledgerByOperation.get(refundOperationId)?.cashCents === 0 &&
      ledgerByOperation.get(refundOperationId)?.openClearingCents === -refundCents,
    `cash ${ledgerByOperation.get(refundOperationId)?.cashCents}, clearing ${ledgerByOperation.get(refundOperationId)?.openClearingCents}`,
  );

  // ---------------------------------------------------------------------------
  // 1. Stripe, against the captured sandbox listing
  // ---------------------------------------------------------------------------

  // The captured listing is real: it was pulled from the Stripe test-mode sandbox and sanitized
  // to the fields the mapping reads. What is rewritten below is only WHICH operation each object
  // names and for how much, because this check runs on a disposable database that does not hold
  // the demo policy the captured objects belong to. The mapping itself is unit-tested on the
  // untouched fixture (lib/reconciliation/stripe-records.test.ts).
  const captured = JSON.parse(
    readFileSync(new URL("../lib/reconciliation/fixtures/stripe-window-listing.json", import.meta.url), "utf8"),
  ) as StripeWindowListing;
  const capturedPaymentIntent = captured.paymentIntents[0];
  const createdSeconds = Math.floor(now.getTime() / 1000);

  const fixtureListing: StripeWindowListing = {
    paymentIntents: [
      // 1. agrees with the ledger to the cent
      { ...capturedPaymentIntent, id: "pi_check_matched", created: createdSeconds, amount_received: p1.totalChargeCents, metadata: { operation_id: p1.operationId, policy_id: p1.policyId } },
      // 2. Stripe holds less than the books say
      { ...capturedPaymentIntent, id: "pi_check_short", created: createdSeconds, latest_charge: null, amount_received: p2.totalChargeCents - AMOUNT_MISMATCH_SHORTFALL_CENTS, metadata: { operation_id: p2.operationId, policy_id: p2.policyId } },
      // 3. money at Stripe that names nothing at all: the planted provider-only break
      { ...capturedPaymentIntent, id: "pi_check_planted", created: createdSeconds, latest_charge: null, amount_received: PLANTED_PAYMENT_CENTS, metadata: {} },
      // (p3 is deliberately absent from this listing: it is the local-only break)
    ],
    refunds: [],
    balanceTransactions: captured.balanceTransactions,
  };

  const fixtureStripeSource = (listing: StripeWindowListing): ReconciliationSource => ({
    ...stripeSource,
    fetch: async () => {
      const mapped = stripeRecordsFromListing(listing);
      // The note goes on the stored run, so nobody reading the run history later can mistake a
      // fixture comparison for a live one.
      return { records: mapped.records, note: `FIXTURE (captured sandbox listing, no network call). ${mapped.note}` };
    },
  });

  const firstRun = await runReconciliation(
    { source: fixtureStripeSource(fixtureListing), window, runByUserId: maker.userId, now },
    runtime,
  );
  const firstItems = await itemsOfRun(firstRun.runId);
  report(
    "a payment Stripe and the ledger agree on is matched",
    firstItems.get("pi_check_matched")?.classification === "matched",
    describeItem(firstItems.get("pi_check_matched")),
  );
  report(
    "a payment Stripe lists 320 cents short is an amount mismatch, with the signed difference",
    firstItems.get("pi_check_short")?.classification === "amount_mismatch" &&
      Number(firstItems.get("pi_check_short")?.difference_cents) === -AMOUNT_MISMATCH_SHORTFALL_CENTS,
    describeItem(firstItems.get("pi_check_short")),
  );
  report(
    "a payment carrying no operation id at all is provider only, with its amount",
    firstItems.get("pi_check_planted")?.classification === "provider_only" &&
      Number(firstItems.get("pi_check_planted")?.provider_amount_cents) === PLANTED_PAYMENT_CENTS,
    describeItem(firstItems.get("pi_check_planted")),
  );
  // Keyed on the PaymentIntent the ledger itself recorded for p3, because a local-only break
  // still knows the provider reference: it is the provider's RECORD that is missing, not its id.
  report(
    "cash the ledger booked and Stripe does not list is local only",
    firstItems.get(p3.paymentIntentId)?.classification === "local_only" &&
      Number(firstItems.get(p3.paymentIntentId)?.ledger_amount_cents) === p3.totalChargeCents,
    describeItem(firstItems.get(p3.paymentIntentId)),
  );
  report(
    "a refund requested a moment ago is not stale yet: it is under the threshold",
    firstItems.get(`op:${refundOperationId}`)?.classification === "matched",
    describeItem(firstItems.get(`op:${refundOperationId}`)),
  );
  report(
    "the run stored its counts and how much it compared on both sides",
    firstRun.status === "complete" && firstRun.providerRecordCount === 3 && firstRun.ledgerRecordCount >= 4,
    `${firstRun.providerRecordCount} provider records, ${firstRun.ledgerRecordCount} ledger records, counts ${JSON.stringify(firstRun.counts)}`,
  );

  // ---------------------------------------------------------------------------
  // 2. The same breaks, run again: the age is counted from the first run
  // ---------------------------------------------------------------------------

  const journalEntriesBeforeTheRerun = await journalEntryCount();
  const secondRun = await runReconciliation(
    { source: fixtureStripeSource(fixtureListing), window, runByUserId: null, now },
    runtime,
  );
  const journalEntriesAfterTheRerun = await journalEntryCount();
  const secondItems = await itemsOfRun(secondRun.runId);
  report(
    "running the same window again produces the same breaks, and does not move their first-seen instant",
    secondItems.get("pi_check_planted")?.break_key === firstItems.get("pi_check_planted")?.break_key &&
      secondItems.get("pi_check_planted")?.first_seen_at.getTime() ===
        firstItems.get("pi_check_planted")?.first_seen_at.getTime(),
    `${secondItems.get("pi_check_planted")?.break_key} first seen ${secondItems.get("pi_check_planted")?.first_seen_at.toISOString()}`,
  );
  report(
    "a run posts no money and no journal entry: reconciliation only appends to its own two tables",
    journalEntriesAfterTheRerun === journalEntriesBeforeTheRerun,
    `${journalEntriesBeforeTheRerun} journal entries before the run, ${journalEntriesAfterTheRerun} after`,
  );

  // ---------------------------------------------------------------------------
  // 3. Stale: the same refund, read a day and a half later
  // ---------------------------------------------------------------------------

  const laterThanTheStripeThreshold = new Date(now.getTime() + 36 * HOUR_IN_MS);
  const staleRun = await runReconciliation(
    { source: fixtureStripeSource(fixtureListing), window, runByUserId: maker.userId, now: laterThanTheStripeThreshold },
    runtime,
  );
  const staleItems = await itemsOfRun(staleRun.runId);
  report(
    "a refund the ledger owes and Stripe never confirmed becomes stale past the threshold",
    staleItems.get(`op:${refundOperationId}`)?.classification === "stale",
    describeItem(staleItems.get(`op:${refundOperationId}`)),
  );
  report(
    "every classification the brief names has now been produced by a real run",
    ["matched", "local_only", "provider_only", "amount_mismatch", "stale"].every((classification) =>
      [...firstItems.values(), ...staleItems.values()].some((item) => item.classification === classification),
    ),
    [...new Set([...firstItems.values(), ...staleItems.values()].map((item) => item.classification))].sort().join(", "),
  );

  // ---------------------------------------------------------------------------
  // 4. The claim payout rail, and the planted payout mismatch
  // ---------------------------------------------------------------------------

  const claim = await openClaim(
    {
      policyId: p2.policyId,
      occurredAt: "2028-05-01",
      reportedAt: "2028-05-02",
      openedOn: "2028-05-02", // the claim is opened on the day the loss is reported
      description: "water damage in the workshop",
      claimantName: CLAIMANT_NAME,
      actor: maker,
    },
    runtime,
  );
  await setClaimReserve({ claimId: claim.claimId, newReserveCents: CLAIM_RESERVE_CENTS, note: "first estimate", actor: maker }, runtime);
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

  // Asks for a claim payment and sends it on the LOCAL SIMULATOR rail, returning both references:
  // ours (the money operation) and the rail's (the transfer). They are the two ends of the only
  // link between the two worlds.
  async function payOnTheRail(amountCents: number): Promise<{ operationId: string; transferRef: string }> {
    const requested = await requestClaimPayment({ claimId: claim.claimId, amountCents, actor: maker }, runtime);
    const sent = await sendClaimPayment({ operationId: requested.operationId, actor: maker }, runtime);
    return { operationId: requested.operationId, transferRef: sent.transferRef };
  }

  // R1: sent and settled through the production functions. Both sides agree.
  const settledPayment = await payOnTheRail(SETTLED_PAYMENT_CENTS);
  await settleClaimPayment({ operationId: settledPayment.operationId, settledOn: todayUtc(), settledBy: SCHEDULED_JOB }, runtime);

  // R2: THE PLANTED PAYOUT MISMATCH. A transfer that exists at the rail and nowhere else. It is
  // written straight into the rail's own table, as the owner, because that table is the
  // PROVIDER's side: no money operation, no claim event and no journal entry is created, which is
  // exactly the situation a reconciliation exists to find.
  const plantedTransferRef = `sim_tr_planted_${Math.trunc(now.getTime())}`;
  await plantRailTransfer(plantedTransferRef, PLANTED_RAIL_TRANSFER_CENTS, ["sent", "settled"]);

  // R3: sent through the production functions, then settled at the rail only. This is the rail's
  // version of a missing webhook: the bank moved the money and our books never heard about it.
  const unsettledPayment = await payOnTheRail(UNSETTLED_IN_LEDGER_PAYMENT_CENTS);
  await plantRailTransfer(unsettledPayment.transferRef, UNSETTLED_IN_LEDGER_PAYMENT_CENTS, ["settled"]);

  // R4: sent and still in flight at the rail. Young now, stale in four days.
  const inFlightPayment = await payOnTheRail(STILL_IN_FLIGHT_PAYMENT_CENTS);

  const railRun = await runReconciliation(
    { source: claimsRailSourceOn(runtime), window, runByUserId: maker.userId, now },
    runtime,
  );
  const railItems = await itemsOfRun(railRun.runId);
  report(
    "a claim payout the rail settled and the ledger booked is matched",
    railItems.get(settledPayment.transferRef)?.classification === "matched",
    describeItem(railItems.get(settledPayment.transferRef)),
  );
  report(
    "THE PLANTED PAYOUT MISMATCH IS FOUND: a transfer the rail holds and the ledger knows nothing about",
    railItems.get(plantedTransferRef)?.classification === "provider_only" &&
      Number(railItems.get(plantedTransferRef)?.provider_amount_cents) === -PLANTED_RAIL_TRANSFER_CENTS,
    describeItem(railItems.get(plantedTransferRef)),
  );
  report(
    "a payout the rail settled and the ledger did not book is provider only",
    railItems.get(unsettledPayment.transferRef)?.classification === "provider_only",
    describeItem(railItems.get(unsettledPayment.transferRef)),
  );
  report(
    "a payout sent two days ago and not settled yet is matched in flight, not a break",
    railItems.get(inFlightPayment.transferRef)?.classification === "matched",
    describeItem(railItems.get(inFlightPayment.transferRef)),
  );

  const laterThanTheRailThreshold = new Date(now.getTime() + 96 * HOUR_IN_MS);
  const railStaleRun = await runReconciliation(
    { source: claimsRailSourceOn(runtime), window, runByUserId: null, now: laterThanTheRailThreshold },
    runtime,
  );
  const railStaleItems = await itemsOfRun(railStaleRun.runId);
  report(
    "a payout still in flight four days later is stale",
    railStaleItems.get(inFlightPayment.transferRef)?.classification === "stale",
    describeItem(railStaleItems.get(inFlightPayment.transferRef)),
  );
  const staleBreakKey = railStaleItems.get(inFlightPayment.transferRef)?.break_key ?? "";
  const openBeforeTheFix = await openBreaks(runtime);
  report(
    "the stale payout is on the open breaks screen, with the instant it was first seen",
    openBeforeTheFix.some((row) => row.breakKey === staleBreakKey),
    `${openBeforeTheFix.filter((row) => row.source === "claims_rail").length} open rail breaks`,
  );

  // ---------------------------------------------------------------------------
  // 5. A break that is fixed stops being reported, and shows as resolved
  // ---------------------------------------------------------------------------

  // The fix is the real thing, not an edit: the settlement job books the settlement, exactly as
  // it would in production. Nothing about the earlier break is deleted or updated.
  await settleClaimPayment({ operationId: inFlightPayment.operationId, settledOn: todayUtc(), settledBy: SCHEDULED_JOB }, runtime);
  const afterTheFixRun = await runReconciliation(
    { source: claimsRailSourceOn(runtime), window, runByUserId: maker.userId, now: laterThanTheRailThreshold },
    runtime,
  );
  const afterTheFixItems = await itemsOfRun(afterTheFixRun.runId);
  report(
    "once the settlement is booked, the same payout is matched",
    afterTheFixItems.get(inFlightPayment.transferRef)?.classification === "matched",
    describeItem(afterTheFixItems.get(inFlightPayment.transferRef)),
  );
  const openAfterTheFix = await openBreaks(runtime);
  const resolvedAfterTheFix = await resolvedBreaks(runtime, 50);
  report(
    "the fixed break has left the open list and appears as resolved, with nothing deleted",
    !openAfterTheFix.some((row) => row.breakKey === staleBreakKey) &&
      resolvedAfterTheFix.some((row) => row.breakKey === staleBreakKey) &&
      (await itemCountForBreakKey(staleBreakKey)) > 0,
    `${await itemCountForBreakKey(staleBreakKey)} items still on file for ${staleBreakKey}`,
  );
  report(
    "the planted payout mismatch is still open: nothing has fixed it",
    openAfterTheFix.some((row) => row.providerRef === plantedTransferRef && row.classification === "provider_only"),
    `${openAfterTheFix.length} open breaks in total`,
  );

  // ---------------------------------------------------------------------------
  // 6. The real Stripe sandbox: a planted payment with no metadata
  // ---------------------------------------------------------------------------

  // AF-04: a test-mode key, a Stripe published test payment method, no real money and no real
  // person. The PaymentIntent carries NO metadata on purpose, so nothing in any ledger can claim
  // it, and it is described so a human reading the Stripe dashboard knows what it is.
  await assertStripeSandbox();
  const plantedIntent = await stripe.paymentIntents.create({
    amount: PLANTED_PAYMENT_CENTS,
    currency: "usd",
    payment_method: "pm_card_visa",
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    description: "corgi_probe: reconciliation check, a payment with no operation id (slice B10)",
  });
  const sandboxWindow: ReconciliationWindow = {
    from: new Date((plantedIntent.created - 30) * 1000),
    to: new Date(Date.now() + 60 * 1000),
  };
  const sandboxRun = await runReconciliation(
    { source: stripeSource, window: sandboxWindow, runByUserId: maker.userId, now: new Date() },
    runtime,
  );
  const sandboxItems = await itemsOfRun(sandboxRun.runId);
  report(
    "THE PLANTED SANDBOX PAYMENT IS FOUND: a real PaymentIntent with no operation id is provider only",
    sandboxRun.status === "complete" &&
      sandboxItems.get(plantedIntent.id)?.classification === "provider_only" &&
      Number(sandboxItems.get(plantedIntent.id)?.provider_amount_cents) === PLANTED_PAYMENT_CENTS,
    `${plantedIntent.id} (${plantedIntent.status}): ${describeItem(sandboxItems.get(plantedIntent.id))}`,
  );

  // ---------------------------------------------------------------------------
  // 7. A failed fetch is never a clean reconciliation
  // ---------------------------------------------------------------------------

  const openBeforeTheFailure = await openBreaks(runtime);
  const brokenProvider: ReconciliationSource = {
    ...stripeSource,
    fetch: async () => {
      throw new Error("simulated provider outage: the Stripe listing could not be completed");
    },
  };
  const failedRun = await runReconciliation(
    { source: brokenProvider, window, runByUserId: maker.userId, now },
    runtime,
  );
  report(
    "a provider that cannot be listed stores a FAILED run carrying the reason",
    failedRun.status === "failed" && (failedRun.fetchError ?? "").includes("simulated provider outage"),
    `${failedRun.status}: ${failedRun.fetchError}`,
  );
  report(
    "a failed run stores no items at all, so it can never be read as zero breaks",
    (await itemsOfRun(failedRun.runId)).size === 0 &&
      Object.values(failedRun.counts).every((count) => count === 0) &&
      failedRun.providerRecordCount === 0,
    `${(await itemsOfRun(failedRun.runId)).size} items, counts ${JSON.stringify(failedRun.counts)}`,
  );
  const openAfterTheFailure = await openBreaks(runtime);
  report(
    "a failed run does not clear the breaks the last complete run found",
    openAfterTheFailure.length === openBeforeTheFailure.length && openAfterTheFailure.length > 0,
    `${openBeforeTheFailure.length} open breaks before, ${openAfterTheFailure.length} after`,
  );
  const runsAfterTheFailure = await recentRuns(runtime, 3);
  report(
    "the screen reads the failure as a failure, not as a result",
    runsAfterTheFailure[0].status === "failed" && runsAfterTheFailure[0].fetchError !== null,
    `${runsAfterTheFailure[0].source} ${runsAfterTheFailure[0].status}: ${runsAfterTheFailure[0].fetchError}`,
  );

  // The other half of the same rule: the provider answered, our own ledger read did not.
  const brokenLedgerRead: ReconciliationSource = {
    ...stripeSource,
    fetch: async () => ({ records: [], note: "the provider answered normally" }),
    readLedger: async () => {
      throw new Error("simulated database error while reading the ledger side");
    },
  };
  const failedLedgerRun = await runReconciliation(
    { source: brokenLedgerRead, window, runByUserId: maker.userId, now },
    runtime,
  );
  report(
    "a run whose LEDGER read fails is failed too, not an empty clean run",
    failedLedgerRun.status === "failed" && (failedLedgerRun.fetchError ?? "").includes("simulated database error"),
    `${failedLedgerRun.status}: ${failedLedgerRun.fetchError}`,
  );

  console.log(
    `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}. Planted and left open on purpose: rail transfer ${plantedTransferRef} and Stripe PaymentIntent ${plantedIntent.id}.`,
  );
  await owner.end();
  await runtime.end();
  process.exit(failures === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Reading what a run stored
// ---------------------------------------------------------------------------

type StoredItem = {
  classification: string;
  break_key: string;
  provider_ref: string | null;
  ledger_ref: string | null;
  provider_amount_cents: string | null;
  ledger_amount_cents: string | null;
  difference_cents: string | null;
  first_seen_at: Date;
  note: string;
};

// The items of one run, keyed the way a reader would look one up: by the provider reference when
// there is one, and by "op:<operation id>" when the break exists only in the ledger.
async function itemsOfRun(runId: string): Promise<Map<string, StoredItem>> {
  const rows = await owner<StoredItem[]>`
    select classification, break_key, provider_ref, ledger_ref, provider_amount_cents::text,
           ledger_amount_cents::text, difference_cents::text, first_seen_at, note
      from reconciliation_items where run_id = ${runId}
  `;
  return new Map(rows.map((row) => [row.provider_ref ?? `op:${row.ledger_ref}`, row]));
}

function describeItem(item: StoredItem | undefined): string {
  if (!item) {
    return "no item was stored for this reference";
  }
  return `${item.classification}: provider ${item.provider_amount_cents ?? "none"}, ledger ${item.ledger_amount_cents ?? "none"}, difference ${item.difference_cents ?? "none"} | ${item.note}`;
}

async function itemCountForBreakKey(breakKey: string): Promise<number> {
  const [row] = await owner<{ count: string }[]>`
    select count(*)::text as count from reconciliation_items where break_key = ${breakKey}
  `;
  return Number(row.count);
}

async function journalEntryCount(): Promise<number> {
  const [row] = await owner<{ count: string }[]>`select count(*)::text as count from journal_entries`;
  return Number(row.count);
}

// ---------------------------------------------------------------------------
// The fixture world
// ---------------------------------------------------------------------------

// A row straight into the rail's own table, as the owner. This is the PROVIDER's side: nothing
// here touches a money operation, a claim event or a journal entry, which is what makes the
// resulting difference a real one for the job to find.
async function plantRailTransfer(transferRef: string, amountCents: number, statuses: ("sent" | "settled" | "returned")[]) {
  for (const status of statuses) {
    await owner`
      insert into simulator_provider_records (transfer_ref, amount_cents, destination_token, status, settlement_date, payload)
      values (${transferRef}, ${amountCents}, 'sim_ba_planted_by_the_reconciliation_check', ${status}, current_date,
              ${owner.json({ note: "LOCAL SIMULATOR: planted by scripts/check-reconciliation.ts on the provider side only" })})
    `;
  }
}

async function createPeople(): Promise<{ brokerId: string; makerId: string }> {
  return owner.begin(async (transaction) => {
    const [broker] = await transaction<{ id: string }[]>`
      insert into brokers (name, commission_rate_bps) values ('Reconciliation check broker', 1500) returning id
    `;
    // Eligibility is checked again at binding time, so the fixture broker needs a status on file.
    // Provider 'seed' on purpose: the two-minute settling window applies to Stripe Connect
    // statuses only, so a row written a moment ago is usable straight away.
    await transaction`
      insert into broker_kyb_events (broker_id, provider, status) values (${broker.id}, 'seed', 'approved')
    `;
    const [maker] = await transaction<{ id: string }[]>`
      insert into users (email, display_name, role)
      values (${`reconciliation-check-${crypto.randomUUID()}@example.invalid`}, 'Reconciliation check operator', 'staff_ops')
      returning id
    `;
    return { brokerId: broker.id, makerId: maker.id };
  });
}

// A bound, paid policy, built exactly as slice B2 builds one.
async function createPaidPolicy(
  recordSuccessfulPayment: typeof import("@/lib/payments/collection").recordSuccessfulPayment,
  brokerId: string,
  annualPremiumCents: number,
  taxCents: number,
): Promise<{ policyId: string; operationId: string; totalChargeCents: number; paymentIntentId: string }> {
  const totalChargeCents = annualPremiumCents + taxCents + FEE_CENTS;
  const { policyId, operationId } = await owner.begin(async (transaction) => {
    const [customer] = await transaction<{ id: string }[]>`
      insert into customers (name, email)
      values (${CLAIMANT_NAME}, ${`reconciliation-check-${crypto.randomUUID()}@example.invalid`})
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
        annual_premium_cents: annualPremiumCents,
        tax_rate_bps: 235,
        tax_cents: taxCents,
        fee_cents: FEE_CENTS,
        total_charge_cents: totalChargeCents,
        per_occurrence_limit_cents: PER_OCCURRENCE_LIMIT_CENTS,
        aggregate_limit_cents: AGGREGATE_LIMIT_CENTS,
      })})
    `;
    const [operation] = await transaction<{ id: string }[]>`
      insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key)
      values ('stripe_checkout', 'stripe', ${totalChargeCents}, ${policy.id}, ${`policy-checkout:${policy.id}`})
      returning id
    `;
    await transaction`
      insert into money_operation_events (operation_id, status) values (${operation.id}, 'requested')
    `;
    return { policyId: policy.id, operationId: operation.id };
  });

  const paymentIntentId = `pi_reconciliation_check_${operationId.slice(0, 8)}`;
  const collected = await recordSuccessfulPayment(
    { operationId, paymentIntentId, amountReceivedCents: totalChargeCents, paidOn: TERM_START },
    runtime,
  );
  if (collected.kind !== "posted") {
    throw new Error(`the fixture policy could not be paid: ${JSON.stringify(collected)}`);
  }
  return { policyId, operationId, totalChargeCents, paymentIntentId };
}

main().catch(async (error) => {
  console.error("check failed to run:", error instanceof Error ? error.message : error);
  await owner.end();
  await runtime.end();
  process.exit(1);
});
