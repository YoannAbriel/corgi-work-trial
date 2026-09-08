import postgres from "postgres";

// Proves, against a real database and through the production functions, the four properties slice
// B9 rests on:
//
//   1. a broker's monthly statement TIES TO THE LEDGER to the cent: its net due is the movement of
//      that broker's commission payable account for the month, recomputed independently;
//   2. RE-RUNNING A CLOSED MONTH WITH ITS OWN KNOWLEDGE CUTOFF reproduces the same content hash,
//      forever, and the re-run is stored as a new revision rather than replacing anything;
//   3. A CORRECTION RECORDED AFTER THE CUTOFF is invisible to a run with that cutoff, and produces
//      a new revision, dated, showing the corrected figure and naming the revision it supersedes;
//   4. a VOIDED operation nets to zero: the collection and the commission are listed with their
//      reversals, and the month's net due goes back to what it was before the policy existed.
//
// The recited example (DECISIONS.md) is the arithmetic throughout: $1,200 annual premium written
// and paid on 2028-03-01, California premium tax 2820 cents, $25 fee, 15% commission, cancelled
// effective 2028-06-09 with the refund completing the same day. March earns 18000, June claws back
// 13068, the broker keeps 4932.
//
// WHERE IT RUNS: the disposable database corgi_test only, with the RESTRICTED runtime role for
// every production call, so this also proves a statement can be produced with the privileges the
// deployed application actually has (SELECT and INSERT, no UPDATE, no DELETE). It commits rows, so
// it refuses to run anywhere else: financial rows can never be deleted (AF-03) and the trial
// ledger must stay clean.
//
// One outbound call reaches the real Stripe sandbox: voiding a binding asks Stripe whether the
// payment intent exists (lib/policy/void-fabricated-binding.ts) and refuses to void anything
// backed by real money. The fabricated reference of this check does not exist there, so the answer
// is "no such payment_intent" and nothing is created, charged or changed at Stripe.
//
// Run with: npm run check:statements

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
// The application modules connect to DATABASE_URL_APP; point them at the disposable database.
process.env.DATABASE_URL_APP = runtimeUrl;

// The recited example, in cents.
const PREMIUM_CENTS = 120000;
const TAX_CENTS = 2820; // California, 235 bps, rounded down
const FEE_CENTS = 2500;
const TOTAL_CHARGE_CENTS = PREMIUM_CENTS + TAX_CENTS + FEE_CENTS; // 125320
const COMMISSION_CENTS = 18000; // 15% of the premium, tax and fee excluded
const REFUND_CENTS = 89172; // 87124 unearned premium + 2048 tax
const CLAWBACK_CENTS = 13068; // 15% of the 87124 refunded, rounded down

const COMMISSION_RATE_BPS = 1500;
const TERM_START = "2028-03-01";
const TERM_END = "2029-03-01";
const CANCELLED_ON = "2028-06-09"; // day 100 of the term
const STATEMENT_MONTH_OF_ISSUANCE = "2028-03";
const STATEMENT_MONTH_OF_CANCELLATION = "2028-06";
const PER_OCCURRENCE_LIMIT_CENTS = 1000000;
const AGGREGATE_LIMIT_CENTS = 1500000;

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
  const { recordCompletedRefund } = await import("@/lib/payments/refunds");
  const { voidFabricatedBinding } = await import("@/lib/policy/void-fabricated-binding");
  const { runStatement, StatementRunRefused } = await import("@/lib/statements/run");
  const { commissionPayableMovementCents } = await import("@/lib/statements/journal");
  const { changesAgainstPrevious, listStatementRuns, statementRun } = await import("@/lib/statements/read");
  const { renderStatementPdf } = await import("@/lib/statements/pdf");

  const [{ current_database: databaseName }] = await owner<{ current_database: string }[]>`
    select current_database()
  `;
  if (databaseName !== "corgi_test") {
    console.error(`refusing to run: connected to "${databaseName}", expected the disposable database "corgi_test"`);
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // 0. Three brokers, three paid policies, all in March 2028
  // ---------------------------------------------------------------------------
  //
  // Three brokers on purpose, each with exactly one policy, so every figure below is the recited
  // example and not a sum of several:
  //   broker A  the statement under test: collected in March, cancelled in June;
  //   broker B  another broker's money, which must never appear on A's statement;
  //   broker C  a binding that turns out to rest on a payment that never happened.

  const staffUserId = await createStaffUser();
  const brokerA = await createBroker("Statement check broker A");
  const brokerB = await createBroker("Statement check broker B");
  const brokerC = await createBroker("Statement check broker C");

  const policyA = await createPaidPolicy(recordSuccessfulPayment, brokerA);
  const policyB = await createPaidPolicy(recordSuccessfulPayment, brokerB);
  const policyC = await createPaidPolicy(recordSuccessfulPayment, brokerC);
  report(
    "three paid policies were seeded through the real posting code, one per broker",
    policyA.totalChargeCents === TOTAL_CHARGE_CENTS && policyB.policyId !== policyA.policyId,
    `${policyA.policyNumber}, ${policyB.policyNumber}, ${policyC.policyNumber} at ${TOTAL_CHARGE_CENTS} cents each`,
  );

  // ---------------------------------------------------------------------------
  // 1. The March statement of the recited example
  // ---------------------------------------------------------------------------

  const marchRevisionOne = await runStatement(
    { brokerId: brokerA, statementMonth: STATEMENT_MONTH_OF_ISSUANCE, actorUserId: staffUserId },
    runtime,
  );
  report(
    "the March statement is the recited example: 125320 collected, 18000 earned, nothing clawed back",
    marchRevisionOne.revision === 1 &&
      marchRevisionOne.totals.premiumCollectedCents === TOTAL_CHARGE_CENTS &&
      marchRevisionOne.totals.commissionEarnedCents === COMMISSION_CENTS &&
      marchRevisionOne.totals.clawbackCents === 0 &&
      marchRevisionOne.totals.netDueCents === COMMISSION_CENTS,
    `revision ${marchRevisionOne.revision}, collected ${marchRevisionOne.totals.premiumCollectedCents}, earned ${marchRevisionOne.totals.commissionEarnedCents}, net due ${marchRevisionOne.totals.netDueCents}`,
  );

  const marchOne = await statementRun(runtime, marchRevisionOne.runId);
  report(
    "it lists exactly the two journal entries a collection produces for a broker",
    marchOne?.lines.length === 2 &&
      marchOne.lines[0].kind === "premium_collected" &&
      marchOne.lines[0].amountCents === TOTAL_CHARGE_CENTS &&
      marchOne.lines[1].kind === "commission_earned" &&
      marchOne.lines[1].amountCents === COMMISSION_CENTS,
    (marchOne?.lines ?? []).map((line) => `${line.kind} ${line.amountCents}`).join(", "),
  );
  report(
    "every line names the journal entry it came from, and that entry really exists",
    await everyLineNamesARealJournalEntry(marchRevisionOne.runId),
    `${marchOne?.lines.length ?? 0} lines checked against journal_entries`,
  );
  report(
    "another broker's money is not on this broker's statement",
    (marchOne?.lines ?? []).every((line) => line.policyNumber !== policyB.policyNumber),
    `policy ${policyB.policyNumber} (broker B, same month, same amounts) is absent`,
  );

  // THE TIE. The second opinion: the ledger's own movement of this broker's commission payable for
  // the month, read by a different query, with the run's own cutoff.
  const marchLedgerMovement = await commissionPayableMovementCents(
    {
      brokerId: brokerA,
      statementMonth: STATEMENT_MONTH_OF_ISSUANCE,
      knowledgeCutoff: marchRevisionOne.knowledgeCutoff,
    },
    runtime,
  );
  report(
    "THE STATEMENT TIES TO THE LEDGER: net due is the movement of commission_payable, to the cent",
    marchLedgerMovement === marchRevisionOne.totals.netDueCents,
    `statement ${marchRevisionOne.totals.netDueCents}, journal ${marchLedgerMovement}`,
  );

  // ---------------------------------------------------------------------------
  // 2. Re-running the closed month with its own cutoff
  // ---------------------------------------------------------------------------

  const marchRevisionTwo = await runStatement(
    {
      brokerId: brokerA,
      statementMonth: STATEMENT_MONTH_OF_ISSUANCE,
      knowledgeCutoff: marchRevisionOne.knowledgeCutoff,
      actorUserId: staffUserId,
    },
    runtime,
  );
  report(
    "RE-RUNNING THE CLOSED MONTH WITH ITS OWN CUTOFF PRODUCES THE SAME CONTENT HASH",
    marchRevisionTwo.contentHash === marchRevisionOne.contentHash,
    `${marchRevisionOne.contentHash.slice(0, 16)} twice`,
  );
  report(
    "the re-run is stored as revision 2 and names revision 1 as the run it supersedes",
    marchRevisionTwo.revision === 2 && marchRevisionTwo.supersedesRunId === marchRevisionOne.runId,
    `revision ${marchRevisionTwo.revision} supersedes ${marchRevisionTwo.supersedesRunId}`,
  );
  report(
    "the re-run is flagged as identical to the revision it supersedes",
    marchRevisionTwo.identicalToPrevious,
    `identical_to_previous = ${marchRevisionTwo.identicalToPrevious}`,
  );
  const marchOneAgain = await statementRun(runtime, marchRevisionOne.runId);
  report(
    "nothing was rewritten: revision 1 is still readable with its own figures and its own hash",
    marchOneAgain?.run.contentHash === marchRevisionOne.contentHash &&
      marchOneAgain?.run.netDueCents === COMMISSION_CENTS &&
      marchOneAgain?.run.identicalToPrevious === false,
    `revision 1 still says net due ${marchOneAgain?.run.netDueCents}`,
  );

  // ---------------------------------------------------------------------------
  // 3. June: a month that is closed before the money it will hold exists
  // ---------------------------------------------------------------------------

  const juneRevisionOne = await runStatement(
    { brokerId: brokerA, statementMonth: STATEMENT_MONTH_OF_CANCELLATION, actorUserId: staffUserId },
    runtime,
  );
  report(
    "before the cancellation, the June statement is empty, and an empty statement is a real one",
    juneRevisionOne.lineCount === 0 && juneRevisionOne.totals.netDueCents === 0,
    `${juneRevisionOne.lineCount} lines, net due ${juneRevisionOne.totals.netDueCents}`,
  );

  // The cancellation, then the refund completing at Stripe. Both go through the production
  // functions, so the clawback lands in the journal exactly as it does in production, dated the
  // day the cash moved (2028-06-09), which is what puts it in the June statement.
  const cancellation = await recordCancellation(
    {
      policyId: policyA.policyId,
      effectiveAt: CANCELLED_ON,
      calculationMethod: "pro_rata",
      actor: { userId: staffUserId, role: "staff_ops", brokerId: null },
    },
    runtime,
  );
  const refundOperationId = cancellation.refundOperationIds[0];
  const completed = await recordCompletedRefund(
    {
      operationId: refundOperationId,
      refundId: `re_statements_check_${refundOperationId.slice(0, 8)}`,
      amountCents: REFUND_CENTS,
      refundedOn: CANCELLED_ON,
    },
    runtime,
  );
  report(
    "the cancellation and its completed refund posted the recited clawback in the journal",
    completed.kind === "posted" &&
      cancellation.plan.breakdown.totalRefundCents === REFUND_CENTS &&
      cancellation.plan.breakdown.commissionClawbackCents === CLAWBACK_CENTS,
    `refund ${cancellation.plan.breakdown.totalRefundCents}, clawback ${cancellation.plan.breakdown.commissionClawbackCents}`,
  );

  // THE CLOSED-MONTH QUESTION. Everything above was recorded AFTER the cutoff of revision 1, so a
  // run with that cutoff must still produce revision 1's document.
  const juneRevisionTwo = await runStatement(
    {
      brokerId: brokerA,
      statementMonth: STATEMENT_MONTH_OF_CANCELLATION,
      knowledgeCutoff: juneRevisionOne.knowledgeCutoff,
      actorUserId: staffUserId,
    },
    runtime,
  );
  report(
    "A CORRECTION RECORDED AFTER THE CUTOFF IS INVISIBLE TO A RUN WITH THAT CUTOFF: same hash",
    juneRevisionTwo.contentHash === juneRevisionOne.contentHash && juneRevisionTwo.lineCount === 0,
    `revision ${juneRevisionTwo.revision}, ${juneRevisionTwo.lineCount} lines, hash ${juneRevisionTwo.contentHash.slice(0, 16)}`,
  );

  // And a fresh run, which knows everything, is the corrected revision.
  const juneRevisionThree = await runStatement(
    { brokerId: brokerA, statementMonth: STATEMENT_MONTH_OF_CANCELLATION, actorUserId: staffUserId },
    runtime,
  );
  report(
    "A FRESH RUN IS A NEW REVISION SHOWING THE CORRECTED FIGURE: the clawback of 13068",
    juneRevisionThree.revision === 3 &&
      juneRevisionThree.totals.clawbackCents === CLAWBACK_CENTS &&
      juneRevisionThree.totals.netDueCents === -CLAWBACK_CENTS &&
      juneRevisionThree.contentHash !== juneRevisionTwo.contentHash,
    `revision ${juneRevisionThree.revision}, clawback ${juneRevisionThree.totals.clawbackCents}, net due ${juneRevisionThree.totals.netDueCents}`,
  );
  report(
    "it names the revision it supersedes and is not flagged identical to it",
    juneRevisionThree.supersedesRunId === juneRevisionTwo.runId && !juneRevisionThree.identicalToPrevious,
    `supersedes ${juneRevisionThree.supersedesRunId}, identical = ${juneRevisionThree.identicalToPrevious}`,
  );

  const juneThree = await statementRun(runtime, juneRevisionThree.runId);
  report(
    "the corrected revision lists the refund the customer received and the clawback it caused",
    (juneThree?.lines ?? []).some((line) => line.kind === "refund" && line.amountCents === -REFUND_CENTS) &&
      (juneThree?.lines ?? []).some((line) => line.kind === "clawback" && line.amountCents === -CLAWBACK_CENTS),
    (juneThree?.lines ?? []).map((line) => `${line.kind} ${line.amountCents}`).join(", "),
  );

  const juneChanges = await changesAgainstPrevious(runtime, juneRevisionThree.runId);
  report(
    "the revision says WHAT CHANGED against the previous one, by journal entry id",
    juneChanges !== null &&
      juneChanges.appeared.length === 2 &&
      juneChanges.disappeared.length === 0 &&
      juneChanges.appeared.every((change) => change.entryRecordedAt > juneRevisionTwo.knowledgeCutoff),
    `${juneChanges?.appeared.length ?? 0} entries appeared, ${juneChanges?.disappeared.length ?? 0} disappeared, all recorded after the previous cutoff`,
  );

  const juneLedgerMovement = await commissionPayableMovementCents(
    {
      brokerId: brokerA,
      statementMonth: STATEMENT_MONTH_OF_CANCELLATION,
      knowledgeCutoff: juneRevisionThree.knowledgeCutoff,
    },
    runtime,
  );
  report(
    "the corrected June statement ties to the ledger to the cent",
    juneLedgerMovement === juneRevisionThree.totals.netDueCents,
    `statement ${juneRevisionThree.totals.netDueCents}, journal ${juneLedgerMovement}`,
  );
  report(
    "over the two months the broker keeps the commission on the premium the customer really used",
    marchRevisionOne.totals.netDueCents + juneRevisionThree.totals.netDueCents === COMMISSION_CENTS - CLAWBACK_CENTS,
    `${marchRevisionOne.totals.netDueCents} + ${juneRevisionThree.totals.netDueCents} = ${COMMISSION_CENTS - CLAWBACK_CENTS} cents`,
  );

  // ---------------------------------------------------------------------------
  // 4. A voided binding nets to zero
  // ---------------------------------------------------------------------------

  const voidedMarchRevisionOne = await runStatement(
    { brokerId: brokerC, statementMonth: STATEMENT_MONTH_OF_ISSUANCE, actorUserId: staffUserId },
    runtime,
  );
  report(
    "before the correction, broker C's March statement shows the commission on that binding",
    voidedMarchRevisionOne.totals.netDueCents === COMMISSION_CENTS,
    `net due ${voidedMarchRevisionOne.totals.netDueCents}`,
  );

  // The real correction: reversal entries at the original effective date plus a dated policy
  // event, exactly as the operations action does (AF-03: nothing is deleted or updated).
  const voided = await voidFabricatedBinding(
    {
      policyId: policyC.policyId,
      reason: "statement check: this binding rests on a payment reference Stripe does not know",
      actorUserId: staffUserId,
    },
    runtime,
  );
  report(
    "the void posted reversal entries and changed no existing row",
    voided.reversedEntryIds.length === 4,
    `${voided.reversedEntryIds.length} reversal entries under correction event ${voided.correctionEventId.slice(0, 8)}`,
  );

  const voidedMarchWithOldCutoff = await runStatement(
    {
      brokerId: brokerC,
      statementMonth: STATEMENT_MONTH_OF_ISSUANCE,
      knowledgeCutoff: voidedMarchRevisionOne.knowledgeCutoff,
      actorUserId: staffUserId,
    },
    runtime,
  );
  report(
    "a run with the cutoff of the published revision still reproduces it, correction or not",
    voidedMarchWithOldCutoff.contentHash === voidedMarchRevisionOne.contentHash,
    `revision ${voidedMarchWithOldCutoff.revision}, same hash ${voidedMarchRevisionOne.contentHash.slice(0, 16)}`,
  );

  const voidedMarchFresh = await runStatement(
    { brokerId: brokerC, statementMonth: STATEMENT_MONTH_OF_ISSUANCE, actorUserId: staffUserId },
    runtime,
  );
  const voidedFreshLines = (await statementRun(runtime, voidedMarchFresh.runId))?.lines ?? [];
  const netOfThatPolicy = voidedFreshLines
    .filter((line) => line.policyNumber === policyC.policyNumber)
    .reduce((total, line) => total + line.amountCents, 0);
  report(
    "A VOIDED OPERATION NETS TO ZERO: the collection, the commission and their reversals cancel out",
    netOfThatPolicy === 0 &&
      voidedMarchFresh.totals.netDueCents === 0 &&
      voidedMarchFresh.totals.premiumCollectedCents === 0 &&
      voidedFreshLines.length === 4,
    `${voidedFreshLines.length} lines adding up to ${netOfThatPolicy}, net due ${voidedMarchFresh.totals.netDueCents}`,
  );
  const voidedLedgerMovement = await commissionPayableMovementCents(
    { brokerId: brokerC, statementMonth: STATEMENT_MONTH_OF_ISSUANCE, knowledgeCutoff: voidedMarchFresh.knowledgeCutoff },
    runtime,
  );
  report(
    "the corrected statement of the voided binding ties to the ledger too",
    voidedLedgerMovement === voidedMarchFresh.totals.netDueCents,
    `statement ${voidedMarchFresh.totals.netDueCents}, journal ${voidedLedgerMovement}`,
  );

  // ---------------------------------------------------------------------------
  // 5. What a run cannot do
  // ---------------------------------------------------------------------------

  const futureCutoff = new Date(Date.now() + 60 * 60 * 1000);
  let refusedTheFutureCutoff = "no error raised";
  try {
    await runStatement(
      { brokerId: brokerA, statementMonth: STATEMENT_MONTH_OF_ISSUANCE, knowledgeCutoff: futureCutoff, actorUserId: staffUserId },
      runtime,
    );
  } catch (error) {
    refusedTheFutureCutoff = error instanceof StatementRunRefused ? error.message : `wrong error: ${String(error)}`;
  }
  report(
    "a knowledge cutoff in the future is refused: a run may only read what the ledger already knows",
    refusedTheFutureCutoff.includes("cannot be in the future"),
    refusedTheFutureCutoff,
  );

  const updateAttempt = await expectRefusal(runtime, async (transaction) => {
    await transaction`update statement_runs set net_due_cents = 0 where id = ${marchRevisionOne.runId}`;
  });
  report(
    "the runtime role cannot rewrite a published statement",
    /permission denied/i.test(updateAttempt),
    updateAttempt,
  );
  const deleteAttempt = await expectRefusal(runtime, async (transaction) => {
    await transaction`delete from statement_lines where run_id = ${marchRevisionOne.runId}`;
  });
  report(
    "the runtime role cannot delete the lines of a published statement",
    /permission denied/i.test(deleteAttempt),
    deleteAttempt,
  );

  // ---------------------------------------------------------------------------
  // 6. The document
  // ---------------------------------------------------------------------------

  const pdf = await renderStatementPdf(marchOne!);
  report(
    "the statement renders as a real PDF file",
    pdf.subarray(0, 5).toString("ascii") === "%PDF-" && pdf.length > 1000,
    `${pdf.length} bytes starting with ${pdf.subarray(0, 5).toString("ascii")}`,
  );

  const runsOfBrokerA = await listStatementRuns(runtime, { brokerId: brokerA, limit: 50 });
  const runsOfEveryBroker = await listStatementRuns(runtime, { limit: 200 });
  report(
    "a broker's own list holds only that broker's statements, and the staff list holds more",
    runsOfBrokerA.every((run) => run.brokerId === brokerA) &&
      runsOfBrokerA.length === 5 &&
      runsOfEveryBroker.length > runsOfBrokerA.length,
    `${runsOfBrokerA.length} runs for broker A, ${runsOfEveryBroker.length} in the staff list`,
  );

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}.`);
  await owner.end();
  await runtime.end();
  process.exit(failures === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// The fixture world
// ---------------------------------------------------------------------------

// A broker at the demo commission rate, with the KYB status binding needs. Provider 'seed' on
// purpose: the two-minute settling window applies to Stripe Connect statuses only, so a row
// written a moment ago is usable straight away.
async function createBroker(name: string): Promise<string> {
  return owner.begin(async (transaction) => {
    const [broker] = await transaction<{ id: string }[]>`
      insert into brokers (name, commission_rate_bps) values (${name}, ${COMMISSION_RATE_BPS}) returning id
    `;
    await transaction`
      insert into broker_kyb_events (broker_id, provider, status) values (${broker.id}, 'seed', 'approved')
    `;
    return broker.id;
  });
}

async function createStaffUser(): Promise<string> {
  const [user] = await owner<{ id: string }[]>`
    insert into users (email, display_name, role)
    values (${`statement-check-${crypto.randomUUID()}@example.invalid`}, 'Statement check operator', 'staff_ops')
    returning id
  `;
  return user.id;
}

type PaidPolicy = { policyId: string; policyNumber: string; operationId: string; totalChargeCents: number };

// A bound, paid policy, built exactly as slice B2 builds one: the draft and its money operation as
// the owner, then the real collection code under the restricted runtime role.
async function createPaidPolicy(
  recordSuccessfulPayment: typeof import("@/lib/payments/collection").recordSuccessfulPayment,
  brokerId: string,
): Promise<PaidPolicy> {
  const { policyId, policyNumber, operationId } = await owner.begin(async (transaction) => {
    const [customer] = await transaction<{ id: string }[]>`
      insert into customers (name, email)
      values ('Bay Area Fabrication LLC', ${`statement-check-${crypto.randomUUID()}@example.invalid`})
      returning id
    `;
    const [policy] = await transaction<{ id: string; policy_number: string }[]>`
      insert into policies (broker_id, customer_id, state_code) values (${brokerId}, ${customer.id}, 'CA')
      returning id, policy_number
    `;
    await transaction`
      insert into policy_events (policy_id, event_type, effective_at, payload)
      values (${policy.id}, 'quoted', ${TERM_START}, ${transaction.json({
        state_code: "CA",
        term_start: TERM_START,
        term_end: TERM_END,
        annual_premium_cents: PREMIUM_CENTS,
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
      values ('stripe_checkout', 'stripe', ${TOTAL_CHARGE_CENTS}, ${policy.id}, ${`policy-checkout:${policy.id}`})
      returning id
    `;
    await transaction`
      insert into money_operation_events (operation_id, status) values (${operation.id}, 'requested')
    `;
    return { policyId: policy.id, policyNumber: policy.policy_number, operationId: operation.id };
  });

  const collected = await recordSuccessfulPayment(
    {
      operationId,
      // A reference Stripe does not know: this is a disposable database and no money exists.
      paymentIntentId: `pi_statements_check_${operationId.slice(0, 8)}`,
      amountReceivedCents: TOTAL_CHARGE_CENTS,
      paidOn: TERM_START,
    },
    runtime,
  );
  if (collected.kind !== "posted") {
    throw new Error(`the fixture policy could not be paid: ${JSON.stringify(collected)}`);
  }
  return { policyId, policyNumber, operationId, totalChargeCents: TOTAL_CHARGE_CENTS };
}

// Every line of a run points at a journal entry that exists, has the same effective date and the
// same recording time. This is what "traceable to the ledger" means row by row.
//
// The recording time is compared to the MILLISECOND: Postgres keeps microseconds and a JavaScript
// Date keeps milliseconds, so a line carries the entry's instant truncated to the millisecond
// (lib/statements/journal.ts). It is deterministic, which is all the content hash needs.
async function everyLineNamesARealJournalEntry(runId: string): Promise<boolean> {
  const [row] = await owner<{ mismatches: string }[]>`
    select count(*)::text as mismatches
      from statement_lines line
      left join journal_entries entry on entry.id = line.journal_entry_id
     where line.run_id = ${runId}
       and (entry.id is null
            or entry.effective_at <> line.effective_at
            or date_trunc('milliseconds', entry.recorded_at) <> line.entry_recorded_at)
  `;
  return row.mismatches === "0";
}

// Runs a statement inside a transaction that is always rolled back, and returns the error message
// the database raised.
class RollbackSentinel extends Error {}

async function expectRefusal(
  database: postgres.Sql,
  action: (transaction: postgres.TransactionSql) => Promise<void>,
): Promise<string> {
  try {
    await database.begin(async (transaction) => {
      await action(transaction);
      throw new RollbackSentinel();
    });
    return "no error raised";
  } catch (error) {
    if (error instanceof RollbackSentinel) return "no error raised";
    return error instanceof Error ? error.message : String(error);
  }
}

main().catch(async (error) => {
  console.error("check failed to run:", error instanceof Error ? error.message : error);
  await owner.end();
  await runtime.end();
  process.exit(1);
});
