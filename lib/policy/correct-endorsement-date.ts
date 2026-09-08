import type postgres from "postgres";
import { sql } from "@/db/client";
import { createApprovalRequest } from "@/lib/approvals/approvals";
import { correctionRebookEntries, correctionRefundRequestedEntry } from "@/lib/ledger/correction-entries";
import { postJournalEntry } from "@/lib/ledger/post";
import { reverseJournalEntry } from "@/lib/ledger/reverse";
import { centsFromDatabase } from "@/lib/money/cents";
import { correctEndorsementDateMoney, correctionFormulaLines, type EndorsementDateCorrection } from "@/lib/money/correction";
import { isCalendarDate } from "@/lib/money/dates";
import {
  endorsementFormulaLines,
  EndorsementNotComputable,
  type EndorsementFigures,
  type FormulaLine,
} from "@/lib/money/endorsement";
import { correctionCheckoutIdempotencyKey, refundIdempotencyKey } from "@/lib/money/idempotency";
import { allocateRefundNewestCollectionFirst, RefundCannotBeAllocated, type RefundSlice } from "@/lib/money/refund-allocation";
import { issueRefundsAtStripe, refundIntent } from "@/lib/payments/refunds";
import { collectionsStillRefundable, countRefundOperations } from "./cancel";
import { foldPolicyEvents, refreshPolicyCurrent } from "./current";
import { expireOpenEndorsementCheckouts } from "./endorse";
import { endorsementRequestPayload, figuresFromPayload } from "./endorsement-requests";
import { policyWasVoided } from "./status";
import { policyTermsFromPayload } from "./terms";

// Correcting the effective date of an endorsement that is already in force.
//
// The panel's live-fire test: an endorsement was entered with the wrong effective date, and they
// watch it being put right. Nothing may be updated and nothing may be deleted (AF-03), so the
// correction is the shape the brief describes, and it all happens in ONE transaction:
//
//   1. a 'correction_reversal' policy event, effective on the WRONG date, carrying the reason,
//      both dates and the operator, and superseding the endorsement event that was wrong. The
//      fold (lib/policy/current.ts) stops applying a superseded event, so the wrong date leaves
//      the picture while its row stays in the table for ever;
//   2. reversal journal entries for the two entries that said what the customer was BILLED
//      (endorsement_premium_written and endorsement_tax_billed), through lib/ledger/reverse.ts:
//      the mirror lines, the SAME effective date as the originals, and recorded_at set by the
//      database clock now;
//   3. a 'correction_rebook' policy event, effective on the RIGHT date, carrying the endorsement
//      re-priced at that date, and fresh premium and tax entries on that date. The fold applies
//      a re-book exactly like an endorsement, so the policy is endorsed again, correctly;
//   4. the difference between what was collected and what is now owed, settled through the
//      machinery slice B4 already has: a Stripe refund when the customer paid too much, a new
//      hosted Checkout when they paid too little.
//
// THE CASH IS NOT TOUCHED BY THE CORRECTION. Stripe really does hold the money the customer paid,
// so endorsement_premium_collected stays exactly as it is; reversing it would make our books say
// that money left Stripe and would break the reconciliation against Stripe's own records. What
// the correction changes is what the customer was billed, and the difference between billed and
// collected lands in premium_receivable, which is the account for exactly that. The full
// reasoning is on top of lib/ledger/correction-entries.ts.
//
// EFFECTIVE TIME AND RECORDED TIME. Every event and every entry written here carries an
// effective_at in the past (the day the cover really changed) and a recorded_at of now (the
// moment we learned we were wrong). Nothing overwrites recorded_at: the database sets it. That
// is what lets a closed month reproduce what was known then, and a fresh run show the correction.

export class CorrectionRefused extends Error {}

export type CorrectionActor = {
  userId: string;
  role: "broker" | "customer" | "staff_ops" | "staff_approver";
};

export type CorrectEndorsementDateInput = {
  policyId: string;
  // The event carrying the wrong date: an 'endorsed' event, or the 'correction_rebook' of an
  // earlier correction (correcting a correction is allowed and supersedes the re-book).
  correctedEventId: string;
  correctedEffectiveAt: string; // "YYYY-MM-DD": the date the endorsement should have carried
  reason: string; // written on the correction event and on every entry it posts
  actor: CorrectionActor;
};

// One journal entry the correction is going to reverse, as the preview shows it.
export type EntryToReverse = {
  entryId: string;
  entryType: string;
  effectiveAt: string;
  recordedAt: Date;
  amountCents: number;
};

// What the preview screen shows and what the execution writes: the same object, from the same
// pure function (lib/money/correction.ts), so the confirmation cannot promise a figure the
// ledger will not book.
export type CorrectionPlan = {
  policyId: string;
  policyNumber: string;
  brokerId: string;
  customerId: string;
  correctedEventId: string;
  correctedEventType: string;
  // The endorsement request the wrong event came from, and the Stripe payment that collected it.
  requestEventId: string | null;
  collectionOperationId: string | null;
  money: EndorsementDateCorrection;
  lines: FormulaLine[]; // the difference, line by line
  correctedEndorsementLines: FormulaLine[]; // the endorsement as it should have read
  entriesToReverse: EntryToReverse[];
  description: string;
  newLimitLabel: string;
  newPerOccurrenceLimitCents: number;
  newAggregateLimitCents: number;
  // The policy terms the endorsement put in force, in the shape a policy event stores them. The
  // correction changes the date, never the cover, so the re-book carries them unchanged.
  termsPayload: Record<string, string | number>;
  reason: string;
  // How many events the fold applied when the preview was computed. The confirmation carries it
  // back and is refused if the policy moved in between.
  policyVersion: number;
};

type Queryable = postgres.Sql | postgres.TransactionSql;

// The only two entry types a correction reverses: what the customer was billed. Everything else
// the endorsement posted (the cash, the commission) stays untouched.
const BILLED_ENTRY_TYPES = ["endorsement_premium_written", "endorsement_tax_billed"];

// ---------------------------------------------------------------------------
// Preview: read everything, compute everything, write nothing
// ---------------------------------------------------------------------------

export async function planEndorsementDateCorrection(
  input: CorrectEndorsementDateInput,
  database: Queryable = sql,
): Promise<CorrectionPlan> {
  // Correcting the record is an operations job, never the broker's or the customer's: it changes
  // history, so it belongs to the people who answer for the books.
  if (input.actor.role !== "staff_ops") {
    throw new CorrectionRefused("only staff operations can correct the effective date of an endorsement");
  }
  if (input.reason.trim().length < 10) {
    throw new CorrectionRefused("a correction needs a written reason of at least ten characters: it is what the ledger will show");
  }
  if (!isCalendarDate(input.correctedEffectiveAt)) {
    throw new CorrectionRefused(`"${input.correctedEffectiveAt}" is not a calendar date`);
  }

  const policy = await loadPolicy(database, input.policyId);
  if (!policy) {
    throw new CorrectionRefused("this policy does not exist");
  }

  const fold = await foldPolicyEvents(database, input.policyId);
  if (policyWasVoided(fold.eventTypes)) {
    throw new CorrectionRefused("this policy was voided by a correction: there is no endorsement on it to correct");
  }
  if (!fold.eventTypes.includes("issued")) {
    throw new CorrectionRefused("this policy is not bound: there is no endorsement on it to correct");
  }
  if (fold.eventTypes.includes("cancelled")) {
    throw new CorrectionRefused(
      "this policy is cancelled: correcting an endorsement would change the premium the cancellation already gave back",
    );
  }

  const wrongEvent = await loadCorrectableEvent(database, input.policyId, input.correctedEventId);
  const latest = await latestAppliedEndorsementEventId(database, input.policyId);
  if (latest !== wrongEvent.eventId) {
    throw new CorrectionRefused(
      "only the most recent endorsement in force can be corrected; the ones after it were priced against this one, so correct them first",
    );
  }
  if (input.correctedEffectiveAt === wrongEvent.effectiveAt) {
    throw new CorrectionRefused(`this endorsement already takes effect on ${wrongEvent.effectiveAt}: nothing to correct`);
  }

  // A difference from an earlier correction that nobody has settled yet would be mixed up with
  // this one, and the two together could give back more than the customer ever paid. The whole
  // statement of "nothing is outstanding" is the policy's premium_receivable balance: every
  // healthy flow (issuance, endorsement, an earlier correction once settled) nets it to zero.
  const outstandingCents = await premiumReceivableBalance(database, input.policyId);
  if (outstandingCents !== 0) {
    throw new CorrectionRefused(
      `this policy has ${outstandingCents} cents of premium billed and not settled (an earlier correction, most likely): settle it before correcting again`,
    );
  }
  // The other half of the same rule. A difference GIVEN BACK leaves premium_receivable at zero
  // as soon as it is opened (the liability moves to refund_payable), so the balance above cannot
  // see it: a second correction while that refund is in flight could charge the customer money
  // we are simultaneously sending back.
  if (await hasCorrectionRefundInFlight(database, input.policyId)) {
    throw new CorrectionRefused(
      "a refund from an earlier correction on this policy has not completed yet: wait for it, or re-issue it if it failed, before correcting again",
    );
  }

  let money: EndorsementDateCorrection;
  try {
    money = correctEndorsementDateMoney(wrongEvent.figures, input.correctedEffectiveAt);
  } catch (error) {
    if (error instanceof EndorsementNotComputable) {
      // The date is outside the term: before the policy started (which would mean correcting the
      // issuance, not the endorsement) or after it ended.
      throw new CorrectionRefused(error.message);
    }
    throw error;
  }
  if (money.before.direction !== "charge") {
    throw new CorrectionRefused(
      "this build only corrects an endorsement whose delta was collected; an endorsement that refunded premium has to be corrected by hand for now",
    );
  }

  const entriesToReverse = await entriesToReverseFor(database, wrongEvent);
  if (!entriesToReverse.some((entry) => entry.entryType === "endorsement_premium_written")) {
    throw new CorrectionRefused(
      "this endorsement has no written premium entry to reverse: its delta was never posted, so there is nothing to correct here",
    );
  }
  const alreadyReversed = await anyEntryAlreadyReversed(
    database,
    entriesToReverse.map((entry) => entry.entryId),
  );
  if (alreadyReversed) {
    throw new CorrectionRefused("this endorsement has already been corrected: its entries carry reversals");
  }

  return {
    policyId: policy.policyId,
    policyNumber: policy.policyNumber,
    brokerId: policy.brokerId,
    customerId: policy.customerId,
    correctedEventId: wrongEvent.eventId,
    correctedEventType: wrongEvent.eventType,
    requestEventId: wrongEvent.requestEventId,
    collectionOperationId: wrongEvent.collectionOperationId,
    money,
    lines: correctionFormulaLines(money),
    correctedEndorsementLines: endorsementFormulaLines(money.after),
    entriesToReverse,
    description: wrongEvent.description,
    newLimitLabel: wrongEvent.newLimitLabel,
    newPerOccurrenceLimitCents: wrongEvent.newPerOccurrenceLimitCents,
    newAggregateLimitCents: wrongEvent.newAggregateLimitCents,
    termsPayload: wrongEvent.termsPayload,
    reason: input.reason.trim().slice(0, 300),
    policyVersion: fold.appliedEventCount,
  };
}

// ---------------------------------------------------------------------------
// Execution: one transaction, then the provider (for a refund)
// ---------------------------------------------------------------------------

export type CorrectionResult = {
  plan: CorrectionPlan;
  reversalEventId: string;
  rebookEventId: string;
  reversalEntryIds: string[];
  // The difference to collect, when the corrected date charges more days.
  collectionOperationId: string | null;
  // The difference to give back, when it charges fewer days. One operation per Stripe payment.
  refundOperationIds: string[];
  refundOperationIdsAwaitingApproval: string[];
  approvalRequestIds: string[];
};

// The whole correction: write it, then ask Stripe for the refund it may owe.
export async function correctEndorsementDate(
  input: CorrectEndorsementDateInput & { expectedPolicyVersion?: number },
  database: postgres.Sql = sql,
): Promise<CorrectionResult> {
  const written = await recordEndorsementDateCorrection(input, database);

  // Maker-checker on money out (slice B7), exactly as on a cancellation refund. The correction
  // itself is recorded either way: the cover really did start on the corrected date and the
  // customer really is owed the difference. What waits is the money leaving.
  const sendNow = written.refundOperationIds.filter(
    (operationId) => !written.refundOperationIdsAwaitingApproval.includes(operationId),
  );
  if (sendNow.length > 0) {
    // Outbox: the intent is committed, so the provider call can be retried or resumed with the
    // same key. A provider failure is recorded on the operation and does not undo the correction.
    await issueRefundsAtStripe(sendNow, database);
  }
  return written;
}

// Everything that touches our own database, in one transaction and without any provider call.
// Exported on its own so scripts/check-correction-replay.ts exercises the real posting code
// against the disposable test database.
export async function recordEndorsementDateCorrection(
  input: CorrectEndorsementDateInput & { expectedPolicyVersion?: number },
  database: postgres.Sql = sql,
): Promise<CorrectionResult> {
  // A live endorsement quote may still have an open hosted page at Stripe. The correction is
  // about to move the policy, which makes that quote stale, so the page is closed first: nobody
  // should be able to pay a quote priced against a history that has changed underneath it.
  // (The same reasoning, and the same function, as a second endorsement request in B4.)
  await expireOpenEndorsementCheckouts(input.policyId, database);

  return database.begin(async (transaction) => {
    // One correction at a time per policy: two operators pressing Confirm together would both
    // pass the checks without this lock. Released when the transaction ends.
    await transaction`select pg_advisory_xact_lock(hashtext(${input.policyId}))`;

    // Everything is recomputed here, at execution time: the preview is a screen, not an input.
    const plan = await planEndorsementDateCorrection(input, transaction);
    if (input.expectedPolicyVersion !== undefined && input.expectedPolicyVersion !== plan.policyVersion) {
      throw new CorrectionRefused(
        "this policy changed since the preview was computed, so the amounts on screen are out of date; open the correction again",
      );
    }

    // 1. The correction event, dated on the WRONG date, superseding the event that was wrong.
    //    It is what makes the fold stop applying the wrong endorsement, and it carries the
    //    reason, both dates and the operator, which is what an auditor reads first.
    const [reversalEvent] = await transaction<{ id: string }[]>`
      insert into policy_events (policy_id, event_type, effective_at, payload, supersedes_event_id, created_by)
      values (${plan.policyId}, 'correction_reversal', ${plan.money.wrongEffectiveAt},
              ${transaction.json({
                reason: plan.reason,
                wrong_effective_at: plan.money.wrongEffectiveAt,
                corrected_effective_at: plan.money.correctedEffectiveAt,
                corrected_event_id: plan.correctedEventId,
                corrected_event_type: plan.correctedEventType,
                request_event_id: plan.requestEventId,
                operator_user_id: input.actor.userId,
                // The ids of the ORIGINAL entries being reversed. They stay in the journal; the
                // reversal entries beside them carry reverses_entry_id pointing back here.
                reversed_entry_ids: plan.entriesToReverse.map((entry) => entry.entryId),
              })},
              ${plan.correctedEventId}, ${input.actor.userId})
      returning id
    `;

    // 2. The reversal entries: mirrored lines, same effective date as the originals, recorded
    //    now. reverses_entry_id is UNIQUE, so a second correction of the same endorsement is
    //    refused by the database and not only by the check above.
    const reversalEntryIds: string[] = [];
    for (const entry of plan.entriesToReverse) {
      reversalEntryIds.push(
        await reverseJournalEntry(transaction, {
          originalEntryId: entry.entryId,
          correctionEventId: reversalEvent.id,
          createdBy: input.actor.userId,
          description: `Policy ${plan.policyNumber}: ${plan.reason} (effective date ${plan.money.wrongEffectiveAt} corrected to ${plan.money.correctedEffectiveAt})`,
        }),
      );
    }

    // 3. The re-book, dated on the RIGHT date. Its payload is the endorsement's own payload with
    //    the figures re-priced at the corrected date, so every reader that already understands an
    //    'endorsed' event understands this one: the fold, the schedule and the PDFs.
    const [rebookEvent] = await transaction<{ id: string }[]>`
      insert into policy_events (policy_id, event_type, effective_at, payload, created_by)
      values (${plan.policyId}, 'correction_rebook', ${plan.money.correctedEffectiveAt},
              ${transaction.json(rebookPayload(plan, reversalEvent.id, input.actor.userId))},
              ${input.actor.userId})
      returning id
    `;

    // 4. The re-booked premium and tax, on the corrected date.
    for (const entry of correctionRebookEntries({
      rebookEventId: rebookEvent.id,
      policyId: plan.policyId,
      policyNumber: plan.policyNumber,
      brokerId: plan.brokerId,
      correctedEffectiveAt: plan.money.correctedEffectiveAt,
      deltaPremiumCents: plan.money.after.deltaPremiumCents,
      deltaTaxCents: plan.money.after.deltaTaxCents,
      createdBy: input.actor.userId,
    })) {
      await postJournalEntry(transaction, entry.header, entry.lines);
    }

    // 5. The difference. premium_receivable now holds it: positive means the customer owes it,
    //    negative means we are holding money that is not premium.
    const settlement = await settleTheDifference(transaction, plan, rebookEvent.id, input.actor.userId);

    await refreshPolicyCurrent(transaction, plan.policyId);

    return {
      plan,
      reversalEventId: reversalEvent.id,
      rebookEventId: rebookEvent.id,
      reversalEntryIds,
      ...settlement,
    };
  });
}

// The payload of the re-book: the endorsement, re-priced, plus the provenance of the correction.
// The keys are exactly the ones an 'endorsed' event carries (lib/policy/endorsement-requests.ts
// and lib/policy/terms.ts) so that lib/policy/current.ts, the endorsement schedule and
// lib/documents/from-database.ts read it without a special case, plus `rebooked_event_type`,
// which is how the document fold knows which kind of event this re-book replays.
function rebookPayload(
  plan: CorrectionPlan,
  reversalEventId: string,
  operatorUserId: string,
): Record<string, string | number | boolean | null> {
  return {
    ...endorsementRequestPayload({
      figures: plan.money.after,
      newPerOccurrenceLimitCents: plan.newPerOccurrenceLimitCents,
      newAggregateLimitCents: plan.newAggregateLimitCents,
      newLimitLabel: plan.newLimitLabel,
      description: plan.description,
      reason: plan.reason,
    }),
    ...plan.termsPayload,
    rebooked_event_type: "endorsed",
    corrects_event_id: plan.correctedEventId,
    correction_reversal_event_id: reversalEventId,
    request_event_id: plan.requestEventId,
    collection_operation_id: plan.collectionOperationId,
    wrong_effective_at: plan.money.wrongEffectiveAt,
    corrected_effective_at: plan.money.correctedEffectiveAt,
    correction_reason: plan.reason,
    operator_user_id: operatorUserId,
    difference_premium_cents: plan.money.differencePremiumCents,
    difference_tax_cents: plan.money.differenceTaxCents,
    difference_total_cents: plan.money.differenceTotalCents,
    difference_commission_cents: plan.money.differenceCommissionCents,
    settlement: plan.money.settlement,
  };
}

type SettlementResult = {
  collectionOperationId: string | null;
  refundOperationIds: string[];
  refundOperationIdsAwaitingApproval: string[];
  approvalRequestIds: string[];
};

async function settleTheDifference(
  transaction: postgres.TransactionSql,
  plan: CorrectionPlan,
  rebookEventId: string,
  actorUserId: string,
): Promise<SettlementResult> {
  const empty: SettlementResult = {
    collectionOperationId: null,
    refundOperationIds: [],
    refundOperationIdsAwaitingApproval: [],
    approvalRequestIds: [],
  };
  if (plan.money.settlement === "none") {
    return empty;
  }
  if (plan.money.settlement === "collect") {
    return { ...empty, collectionOperationId: await openCollectionForDifference(transaction, plan, rebookEventId, actorUserId) };
  }
  return { ...empty, ...(await openRefundsForDifference(transaction, plan, rebookEventId, actorUserId)) };
}

// The customer owes the difference: an ordinary hosted Checkout, opened later by the broker from
// the policy page (lib/payments/correction-collection.ts). The intent is committed here, before
// anything is asked of Stripe, and NO journal entry is posted: the re-book already debited
// premium_receivable with the money that is owed.
async function openCollectionForDifference(
  transaction: postgres.TransactionSql,
  plan: CorrectionPlan,
  rebookEventId: string,
  actorUserId: string,
): Promise<string> {
  const amountCents = plan.money.differenceTotalCents;
  const [operation] = await transaction<{ id: string }[]>`
    insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key, created_by)
    values ('stripe_checkout', 'stripe', ${amountCents}, ${plan.policyId},
            ${correctionCheckoutIdempotencyKey(rebookEventId)}, ${actorUserId})
    returning id
  `;
  await transaction`
    insert into money_operation_events (operation_id, status, payload)
    values (${operation.id}, 'requested',
            ${transaction.json({
              note: plan.money.customerApprovalRequired
                ? "correction difference: the customer has to approve it before the hosted page is opened"
                : "correction difference: the hosted Stripe page has not been created yet",
            })})
  `;
  await transaction`
    insert into correction_collections (collection_operation_id, policy_id, correction_rebook_event_id, amount_cents, premium_cents, tax_cents)
    values (${operation.id}, ${plan.policyId}, ${rebookEventId}, ${amountCents},
            ${plan.money.differencePremiumCents}, ${plan.money.differenceTaxCents})
  `;
  return operation.id;
}

// We hold money that is no longer premium: it goes back through the same Stripe refund path as a
// cancellation, newest collection first, one operation per PaymentIntent, with maker-checker
// above $1,000 and the commission clawed back when the money actually leaves.
async function openRefundsForDifference(
  transaction: postgres.TransactionSql,
  plan: CorrectionPlan,
  rebookEventId: string,
  actorUserId: string,
): Promise<Omit<SettlementResult, "collectionOperationId">> {
  const owedBackCents = -plan.money.differenceTotalCents;
  let slices: RefundSlice[];
  try {
    slices = allocateRefundNewestCollectionFirst({
      refundedPremiumCents: -plan.money.differencePremiumCents,
      refundedTaxCents: -plan.money.differenceTaxCents,
      commissionClawbackCents: -plan.money.differenceCommissionCents,
      collections: await collectionsStillRefundable(transaction, plan.policyId),
    });
  } catch (error) {
    if (error instanceof RefundCannotBeAllocated) {
      throw new CorrectionRefused(error.message);
    }
    throw error;
  }

  const refundOperationIds: string[] = [];
  const refundOperationIdsAwaitingApproval: string[] = [];
  const approvalRequestIds: string[] = [];
  for (const slice of slices) {
    // Maker-checker, written in THIS transaction and before the operation it gates, so there is
    // no instant in which a refund exists that nobody has to approve. The threshold is read
    // against the WHOLE difference, not against each Stripe payment it is split over.
    const approvalRequestId = plan.money.refundNeedsApproval
      ? await createApprovalRequest(transaction, {
          intent: refundIntent(plan.policyId, slice.amountCents, slice.paymentIntentId),
          destinationDescription: `Stripe payment ${slice.paymentIntentId} (card refund to the customer)`,
          requestedByUserId: actorUserId,
          payload: {
            policy_number: plan.policyNumber,
            reason: `correction: the endorsement effective date was moved from ${plan.money.wrongEffectiveAt} to ${plan.money.correctedEffectiveAt}`,
            refunded_premium_cents: slice.refundedPremiumCents,
            refunded_tax_cents: slice.refundedTaxCents,
            total_refund_cents: owedBackCents,
          },
        })
      : null;

    const attempt = (await countRefundOperations(transaction, plan.policyId, slice.paymentIntentId)) + 1;
    const [operation] = await transaction<{ id: string }[]>`
      insert into money_operations
        (kind, provider, amount_cents, policy_id, idempotency_key, approval_request_id, created_by)
      values ('stripe_refund', 'stripe', ${slice.amountCents}, ${plan.policyId},
              ${refundIdempotencyKey(plan.policyId, slice.paymentIntentId, attempt)},
              ${approvalRequestId}, ${actorUserId})
      returning id
    `;
    if (approvalRequestId) {
      approvalRequestIds.push(approvalRequestId);
      refundOperationIdsAwaitingApproval.push(operation.id);
    }
    await transaction`
      insert into money_operation_events (operation_id, status, payload)
      values (${operation.id}, 'requested',
              ${transaction.json({
                note: approvalRequestId
                  ? "correction recorded; this refund waits for a second person to approve it before Stripe is called"
                  : "correction recorded; the Stripe refund has not been created yet",
              })})
    `;
    await transaction`
      insert into refund_allocations (
        refund_operation_id, policy_id, policy_event_id, collection_operation_id, payment_intent_id,
        amount_cents, refunded_premium_cents, refunded_tax_cents, commission_clawback_cents
      ) values (
        ${operation.id}, ${plan.policyId}, ${rebookEventId}, ${slice.collectionOperationId},
        ${slice.paymentIntentId}, ${slice.amountCents}, ${slice.refundedPremiumCents},
        ${slice.refundedTaxCents}, ${slice.commissionClawbackCents}
      )
    `;
    const requested = correctionRefundRequestedEntry({
      refundOperationId: operation.id,
      policyId: plan.policyId,
      policyNumber: plan.policyNumber,
      brokerId: plan.brokerId,
      correctedEffectiveAt: plan.money.correctedEffectiveAt,
      amountCents: slice.amountCents,
      createdBy: actorUserId,
    });
    await postJournalEntry(transaction, requested.header, requested.lines);
    refundOperationIds.push(operation.id);
  }
  return { refundOperationIds, refundOperationIdsAwaitingApproval, approvalRequestIds };
}

// ---------------------------------------------------------------------------
// The reads the plan is built from
// ---------------------------------------------------------------------------

type PolicyForCorrection = {
  policyId: string;
  policyNumber: string;
  brokerId: string;
  customerId: string;
};

async function loadPolicy(database: Queryable, policyId: string): Promise<PolicyForCorrection | null> {
  const [row] = await database<{ id: string; policy_number: string; broker_id: string; customer_id: string }[]>`
    select id, policy_number, broker_id, customer_id from policies where id = ${policyId}
  `;
  return row
    ? { policyId: row.id, policyNumber: row.policy_number, brokerId: row.broker_id, customerId: row.customer_id }
    : null;
}

type CorrectableEvent = {
  eventId: string;
  eventType: string;
  effectiveAt: string;
  figures: EndorsementFigures;
  requestEventId: string | null;
  collectionOperationId: string | null;
  description: string;
  newLimitLabel: string;
  newPerOccurrenceLimitCents: number;
  newAggregateLimitCents: number;
  termsPayload: Record<string, string | number>;
};

// The endorsement being corrected: an 'endorsed' event, or the 'correction_rebook' of an earlier
// correction. Both carry the same payload keys, which is why one reader serves both.
async function loadCorrectableEvent(database: Queryable, policyId: string, eventId: string): Promise<CorrectableEvent> {
  const [row] = await database<
    { id: string; event_type: string; effective_at: string; payload: Record<string, unknown> }[]
  >`
    select id, event_type, to_char(effective_at, 'YYYY-MM-DD') as effective_at, payload
      from policy_events
     where id = ${eventId} and policy_id = ${policyId}
       and (event_type = 'endorsed'
            or (event_type = 'correction_rebook' and payload ->> 'rebooked_event_type' = 'endorsed'))
  `;
  if (!row) {
    throw new CorrectionRefused("this policy has no endorsement in force with that id");
  }
  return {
    eventId: row.id,
    eventType: row.event_type,
    effectiveAt: row.effective_at,
    figures: figuresFromPayload(policyId, row.payload),
    requestEventId: typeof row.payload.request_event_id === "string" ? row.payload.request_event_id : null,
    collectionOperationId:
      typeof row.payload.collection_operation_id === "string" ? row.payload.collection_operation_id : null,
    description: String(row.payload.description ?? "endorsement"),
    newLimitLabel: String(row.payload.new_limit_label ?? ""),
    newPerOccurrenceLimitCents: Number(row.payload.new_per_occurrence_limit_cents ?? 0),
    newAggregateLimitCents: Number(row.payload.new_aggregate_limit_cents ?? 0),
    // The terms the endorsement put in force. The correction changes the DATE, never the cover,
    // so the re-book carries them unchanged; reading them back also proves they are well formed.
    termsPayload: policyTermsAsPayload(row.payload),
  };
}

// The policy terms of an endorsement event, read strictly and written back in the same shape.
function policyTermsAsPayload(payload: Record<string, unknown>): Record<string, string | number> {
  const terms = policyTermsFromPayload(payload);
  return {
    state_code: terms.stateCode,
    term_start: terms.termStart,
    term_end: terms.termEnd,
    annual_premium_cents: terms.annualPremiumCents,
    tax_rate_bps: terms.taxRateBps,
    tax_cents: terms.taxCents,
    fee_cents: terms.feeCents,
    total_charge_cents: terms.totalChargeCents,
    per_occurrence_limit_cents: terms.perOccurrenceLimitCents,
    aggregate_limit_cents: terms.aggregateLimitCents,
  };
}

// The latest endorsement the fold still applies: an 'endorsed' event, or the re-book that
// replaced one, that no correction has superseded.
async function latestAppliedEndorsementEventId(database: Queryable, policyId: string): Promise<string | null> {
  const [row] = await database<{ id: string }[]>`
    select event.id
      from policy_events event
     where event.policy_id = ${policyId}
       and (event.event_type = 'endorsed'
            or (event.event_type = 'correction_rebook' and event.payload ->> 'rebooked_event_type' = 'endorsed'))
       and not exists (select 1 from policy_events correction where correction.supersedes_event_id = event.id)
     order by event.sequence_number desc
     limit 1
  `;
  return row ? row.id : null;
}

// The two entries that say what the customer was billed for this endorsement. They are filed
// under the Stripe payment that collected the delta ('endorsed') or under the previous correction
// ('correction_rebook'), which is why the source depends on the event type.
async function entriesToReverseFor(database: Queryable, event: CorrectableEvent): Promise<EntryToReverse[]> {
  const sourceKind = event.eventType === "correction_rebook" ? "correction" : "money_operation";
  const sourceId = event.eventType === "correction_rebook" ? event.eventId : event.collectionOperationId;
  if (!sourceId) {
    throw new CorrectionRefused(
      "this endorsement records no Stripe payment, so the entries it posted cannot be found; it cannot be corrected here",
    );
  }
  const rows = await database<
    { id: string; entry_type: string; effective_at: string; recorded_at: Date; amount_cents: string }[]
  >`
    select entry.id,
           entry.entry_type,
           to_char(entry.effective_at, 'YYYY-MM-DD') as effective_at,
           entry.recorded_at,
           coalesce(sum(line.debit_cents), 0)::text as amount_cents
      from journal_entries entry
      join journal_lines line on line.entry_id = entry.id
     where entry.source_kind = ${sourceKind}
       and entry.source_id = ${sourceId}
       and entry.entry_type in ${database(BILLED_ENTRY_TYPES)}
     group by entry.id, entry.entry_type, entry.effective_at, entry.recorded_at
     order by entry.entry_type
  `;
  return rows.map((row) => ({
    entryId: row.id,
    entryType: row.entry_type,
    effectiveAt: row.effective_at,
    recordedAt: row.recorded_at,
    amountCents: centsFromDatabase(row.amount_cents, "amount_cents"),
  }));
}

// reverses_entry_id is unique, so the database would refuse a second reversal anyway. Asking
// first turns that into a sentence an operator can read instead of a constraint violation.
async function anyEntryAlreadyReversed(database: Queryable, entryIds: string[]): Promise<boolean> {
  if (entryIds.length === 0) {
    return false;
  }
  const [row] = await database<{ count: string }[]>`
    select count(*)::text as count from journal_entries where reverses_entry_id in ${database(entryIds)}
  `;
  return Number(row.count) > 0;
}

// True while a refund opened by an earlier correction has not been reported as completed by
// Stripe. The refund entry names the money operation it belongs to, so the question is asked of
// the ledger and the operation together rather than of a status field.
async function hasCorrectionRefundInFlight(database: Queryable, policyId: string): Promise<boolean> {
  const [row] = await database<{ count: string }[]>`
    select count(*)::text as count
      from journal_entries entry
      join money_operations operation on operation.id::text = entry.source_id and operation.kind = 'stripe_refund'
     where entry.policy_id = ${policyId}
       and entry.entry_type = 'correction_refund_requested'
       and not exists (select 1 from money_operation_events event
                        where event.operation_id = operation.id and event.status = 'succeeded')
  `;
  return Number(row.count) > 0;
}

// Premium billed to this policy and not yet collected, from the ledger. Zero on a healthy policy:
// the issuance and every endorsement net it to zero when their payment lands. A correction moves
// it by the difference it creates, and the settlement brings it back to zero.
export async function premiumReceivableBalance(database: Queryable, policyId: string): Promise<number> {
  const [row] = await database<{ balance_cents: string }[]>`
    select coalesce(sum(line.debit_cents) - sum(line.credit_cents), 0)::text as balance_cents
      from journal_lines line
      join journal_entries entry on entry.id = line.entry_id
     where entry.policy_id = ${policyId}
       and line.account_id = 'premium_receivable'
  `;
  return centsFromDatabase(row.balance_cents, "premium_receivable balance");
}
