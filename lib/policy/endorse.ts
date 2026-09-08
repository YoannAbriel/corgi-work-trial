import type postgres from "postgres";
import { sql } from "@/db/client";
import { createApprovalRequest } from "@/lib/approvals/approvals";
import { refundNeedsApproval } from "@/lib/approvals/threshold";
import { endorsementRefundRequestedEntry } from "@/lib/ledger/endorsement-entries";
import { postJournalEntry } from "@/lib/ledger/post";
import { centsFromDatabase, formatCentsAsUsd } from "@/lib/money/cents";
import { isCalendarDate } from "@/lib/money/dates";
import {
  computeEndorsement,
  endorsementFormulaLines,
  endorsementQuoteHash,
  EndorsementNotComputable,
  type EndorsementFigures,
  type FormulaLine,
} from "@/lib/money/endorsement";
import { refundIdempotencyKey } from "@/lib/money/idempotency";
import { stateTaxCents } from "@/lib/money/premium";
import {
  allocateRefundNewestCollectionFirst,
  RefundCannotBeAllocated,
  type RefundSlice,
} from "@/lib/money/refund-allocation";
import { issueRefundsAtStripe, policyRefundTotals, refundIntent } from "@/lib/payments/refunds";
import { assertStripeSandbox, stripe } from "@/lib/stripe";
import Stripe from "stripe";
import { collectionsStillRefundable, countRefundOperations } from "./cancel";
import { foldPolicyEvents, refreshPolicyCurrent, type PolicyFold } from "./current";
import {
  endorsementRequestPayload,
  endorsementRequestsOfPolicy,
  endorsementRequestStanding,
  readEndorsementRequest,
  type EndorsementRequest,
  type EndorsementRequestStanding,
} from "./endorsement-requests";
import { policyWasVoided } from "./status";
import { policyTermsToPayload, type PolicyTerms } from "./terms";

// Endorsing a policy mid-term: a new annual premium and new limits from an effective date.
//
// What the user does: the owning broker (or staff operations) types the new annual premium, the
// new limits and the effective date, sees the exact money it moves with the formula behind each
// figure, and confirms. What happens then, in order:
//
//   1. ONE database transaction takes a lock on the policy, recomputes the quote, refuses it if
//      it no longer matches the hash on the form, and writes the 'endorsement_requested' event.
//   2. A premium INCREASE stops there: the delta is collected through a hosted Stripe Checkout
//      Session (lib/payments/endorsement-collection.ts), after the customer's approval when the
//      amount is above $500, and the change is applied ('endorsed') only when Stripe confirms
//      the money (decided by Yoann, DECISIONS.md).
//   3. A premium DECREASE, or a change that moves no money, is applied in the same transaction:
//      the 'endorsed' event, the refund operation(s) in status 'requested' with their allocation
//      rows and refund entries. Only after the commit is the Stripe Refunds API called, with a
//      derived idempotency key (the outbox rule, ARCHITECTURE.md section 4).
//
// The money itself is not computed here: lib/money/endorsement.ts is the one pure function the
// preview, the approval screen, the execution and the explanation all read.

// Refusals a person can act on: wrong actor, wrong date, unbound policy, stale quote. They
// become a message on the page, never a 500.
export class EndorsementRefused extends Error {}

export type EndorsementActor = {
  userId: string;
  role: "broker" | "customer" | "staff_ops" | "staff_approver";
  brokerId: string | null; // set when the role is 'broker'
  customerId: string | null; // set when the role is 'customer'
};

export type EndorsementInputFromForm = {
  policyId: string;
  effectiveAt: string; // "YYYY-MM-DD": the day the change takes effect
  newAnnualPremiumCents: number;
  newPerOccurrenceLimitCents: number;
  newAggregateLimitCents: number;
  reason: string | null; // free text from the broker, optional
  actor: EndorsementActor;
};

// What the preview screen shows and what the execution writes: the same object, from the same
// pure function, so the confirmation cannot promise a figure the ledger will not book.
export type EndorsementPlan = {
  policyId: string;
  policyNumber: string;
  brokerId: string;
  customerId: string;
  terms: PolicyTerms; // the terms in force before the endorsement
  figures: EndorsementFigures;
  lines: FormulaLine[];
  newPerOccurrenceLimitCents: number;
  newAggregateLimitCents: number;
  newLimitLabel: string;
  description: string;
  reason: string | null;
  // True when the reduction gives back more than $1,000, which needs a distinct human approver
  // before anything leaves (lib/approvals/threshold.ts). The preview says so before confirming.
  refundNeedsApproval: boolean;
};

type Queryable = postgres.Sql | postgres.TransactionSql;

// ---------------------------------------------------------------------------
// Preview: read everything, compute everything, write nothing
// ---------------------------------------------------------------------------

export async function planEndorsement(input: EndorsementInputFromForm, database: Queryable = sql): Promise<EndorsementPlan> {
  const policy = await loadPolicy(database, input.policyId);
  if (!policy) {
    throw new EndorsementRefused("this policy does not exist");
  }

  // Who may endorse: the broker who owns the policy, or staff operations. Checked on the server
  // for the preview and again for the execution, so calling the API directly changes nothing.
  const isOwningBroker = input.actor.role === "broker" && input.actor.brokerId === policy.brokerId;
  const isStaffOperations = input.actor.role === "staff_ops";
  if (!isOwningBroker && !isStaffOperations) {
    throw new EndorsementRefused("only the broker who owns this policy, or staff operations, can endorse it");
  }

  const fold = await foldPolicyEvents(database, input.policyId);
  assertPolicyCanBeEndorsed(fold);

  if (!isCalendarDate(input.effectiveAt)) {
    throw new EndorsementRefused(`"${input.effectiveAt}" is not a calendar date`);
  }
  // A backdated endorsement is ordinary (the money follows the date, never the day it was
  // typed), but not before an endorsement already in force: the annual premium it changes is
  // the one of the latest segment, so an earlier date would need the previous endorsement to
  // be corrected first (reversal and re-book, slice B8).
  if (fold.latestEndorsementEffectiveAt && input.effectiveAt < fold.latestEndorsementEffectiveAt) {
    throw new EndorsementRefused(
      `an endorsement cannot take effect before the previous one (${fold.latestEndorsementEffectiveAt}); correct that one first`,
    );
  }
  assertPositiveCents("new per-occurrence limit", input.newPerOccurrenceLimitCents);
  assertPositiveCents("new aggregate limit", input.newAggregateLimitCents);
  assertPositiveCents("new annual premium", input.newAnnualPremiumCents);

  const nothingChanges =
    input.newAnnualPremiumCents === fold.terms.annualPremiumCents &&
    input.newPerOccurrenceLimitCents === fold.terms.perOccurrenceLimitCents &&
    input.newAggregateLimitCents === fold.terms.aggregateLimitCents;
  if (nothingChanges) {
    throw new EndorsementRefused("nothing changes: the premium and the limits are the ones already in force");
  }

  let figures: EndorsementFigures;
  try {
    figures = computeEndorsement({
      policyId: policy.policyId,
      policyVersion: fold.appliedEventCount,
      termStart: fold.terms.termStart,
      termEnd: fold.terms.termEnd,
      effectiveAt: input.effectiveAt,
      oldAnnualPremiumCents: fold.terms.annualPremiumCents,
      newAnnualPremiumCents: input.newAnnualPremiumCents,
      // The rate in force on the policy: an endorsement is priced at the policy's own rate.
      taxRateBps: fold.terms.taxRateBps,
      taxChargedSoFarCents: await premiumTaxStillHeldForPolicy(database, policy.policyId),
      commissionRateBps: policy.commissionRateBps,
      // The customer-approval threshold counts what this policy has already asked this customer
      // for and not had answered (review finding F-B4-09).
      otherUnapprovedRequestedCents: await additionalPremiumAwaitingTheCustomer(database, policy.policyId),
    });
  } catch (error) {
    if (error instanceof EndorsementNotComputable) {
      throw new EndorsementRefused(error.message);
    }
    throw error;
  }

  const refundsSoFar = await policyRefundTotals(database, policy.policyId);

  return {
    policyId: policy.policyId,
    policyNumber: policy.policyNumber,
    brokerId: policy.brokerId,
    customerId: policy.customerId,
    terms: fold.terms,
    figures,
    lines: endorsementFormulaLines(figures),
    newPerOccurrenceLimitCents: input.newPerOccurrenceLimitCents,
    newAggregateLimitCents: input.newAggregateLimitCents,
    newLimitLabel: limitLabel(input.newPerOccurrenceLimitCents, input.newAggregateLimitCents),
    description: describeChange(fold.terms, input),
    reason: input.reason && input.reason.trim().length > 0 ? input.reason.trim().slice(0, 200) : null,
    // Only a reduction sends money out, so only a reduction can cross the money-out threshold,
    // and the threshold is read against everything this policy has given back (F-B4-04): three
    // reductions of $600 are $1,800 out of the door and cannot each escape the approver.
    refundNeedsApproval:
      figures.direction === "refund" &&
      refundNeedsApproval({
        amountCents: -figures.deltaTotalCents,
        policyRefundedCents: refundsSoFar.refundedCents,
        policyPendingRefundCents: refundsSoFar.pendingCents,
      }),
  };
}

// Only a bound policy that is still in force can be endorsed.
function assertPolicyCanBeEndorsed(fold: PolicyFold): void {
  if (policyWasVoided(fold.eventTypes)) {
    throw new EndorsementRefused("this policy was voided by a correction and cannot be endorsed");
  }
  if (!fold.eventTypes.includes("issued")) {
    throw new EndorsementRefused("this policy is not bound yet: bind it first, then endorse it");
  }
  if (fold.eventTypes.includes("cancelled")) {
    throw new EndorsementRefused("this policy is cancelled and cannot be endorsed");
  }
}

// ---------------------------------------------------------------------------
// Execution: one transaction, then the provider (for a refund)
// ---------------------------------------------------------------------------

export type EndorsementRequestResult = {
  plan: EndorsementPlan;
  requestEventId: string;
  // True when the change was applied in the same transaction (a refund or no money). A charge
  // is applied later, when Stripe confirms the delta was paid.
  appliedImmediately: boolean;
  endorsedEventId: string | null;
  refundOperationIds: string[];
  // The refunds that are NOT going anywhere until a second human approves them, and the requests
  // waiting for that person. Both empty at or below $1,000 (lib/approvals/threshold.ts).
  refundOperationIdsAwaitingApproval: string[];
  approvalRequestIds: string[];
};

// The whole request: recompute under a lock, write, then ask Stripe for a refund if one is owed.
// `expectedQuoteHash` is the hidden field carried by the confirmation form.
export async function requestEndorsement(
  input: EndorsementInputFromForm & { expectedQuoteHash: string },
  database: postgres.Sql = sql,
): Promise<EndorsementRequestResult> {
  const written = await recordEndorsementRequest(input, database);

  // Maker-checker on money out (slice B7), exactly as on a cancellation refund. The endorsement
  // itself is recorded either way: the cover really has been reduced, the premium really has
  // stopped earning on that part, and the customer really is owed the money. What waits is the
  // money leaving. A refund above $1,000 stays in status 'requested' with its approval request
  // beside it, and only the staff "send this refund to Stripe" action moves it once a second
  // person has approved (app/api/policies/[policyId]/refunds/[operationId]/send).
  const sendNow = written.refundOperationIds.filter(
    (operationId) => !written.refundOperationIdsAwaitingApproval.includes(operationId),
  );
  if (sendNow.length > 0) {
    // Outbox: the intent is committed, so the provider call can be retried or resumed with the
    // same key. A provider failure is recorded on the operation and does not undo the endorsement.
    await issueRefundsAtStripe(sendNow, database);
  }
  return written;
}

// Everything that touches our own database, without any provider call. Exported on its own so
// that scripts/check-endorsement-replay.ts can exercise the real posting code against the
// disposable test database.
export async function recordEndorsementRequest(
  input: EndorsementInputFromForm & { expectedQuoteHash: string },
  database: postgres.Sql = sql,
): Promise<EndorsementRequestResult> {
  // A previous request may have left a hosted payment page open at Stripe. It is closed before
  // this request supersedes it, so that the customer cannot pay a quote that no longer exists
  // (the lesson of review finding F-B2-13). Refusing here is the safe direction: if Stripe
  // cannot be reached, no new quote is written either.
  await expireOpenEndorsementCheckouts(input.policyId, database);

  return database.begin(async (transaction) => {
    // One endorsement at a time per policy: two requests computed against the same version
    // would both pass the hash check without this lock. Released when the transaction ends.
    await transaction`select pg_advisory_xact_lock(hashtext(${input.policyId}))`;

    // Everything is recomputed here, at execution time: the preview is a screen, not an input.
    const plan = await planEndorsement(input, transaction);
    if (plan.figures.quoteHash !== input.expectedQuoteHash) {
      throw new EndorsementRefused(
        "this quote is out of date: the policy changed since the preview was computed; open the endorsement again to see the current figures",
      );
    }

    const [requestEvent] = await transaction<{ id: string }[]>`
      insert into policy_events (policy_id, event_type, effective_at, payload, created_by)
      values (${plan.policyId}, 'endorsement_requested', ${plan.figures.effectiveAt},
              ${transaction.json(
                endorsementRequestPayload({
                  figures: plan.figures,
                  newPerOccurrenceLimitCents: plan.newPerOccurrenceLimitCents,
                  newAggregateLimitCents: plan.newAggregateLimitCents,
                  newLimitLabel: plan.newLimitLabel,
                  description: plan.description,
                  reason: plan.reason,
                }),
              )},
              ${input.actor.userId})
      returning id
    `;

    if (plan.figures.direction === "charge") {
      // The change waits for the money (and for the customer above $500). The cache is refreshed
      // so the policy version seen by the pages moves with the request.
      await refreshPolicyCurrent(transaction, plan.policyId);
      return {
        plan,
        requestEventId: requestEvent.id,
        appliedImmediately: false,
        endorsedEventId: null,
        refundOperationIds: [],
        refundOperationIdsAwaitingApproval: [],
        approvalRequestIds: [],
      };
    }

    const request = await readEndorsementRequest(transaction, plan.policyId, requestEvent.id);
    if (!request) {
      throw new Error("the endorsement request that was just written cannot be read back");
    }
    const endorsedEventId = await applyEndorsement(transaction, {
      request,
      termsBefore: plan.terms,
      appliedBy: input.actor.userId,
      collectionOperationId: null,
    });

    const refunds =
      plan.figures.direction === "refund"
        ? await openRefundsForReduction(transaction, plan, request, endorsedEventId, input.actor.userId)
        : { refundOperationIds: [], refundOperationIdsAwaitingApproval: [], approvalRequestIds: [] };

    await refreshPolicyCurrent(transaction, plan.policyId);
    return {
      plan,
      requestEventId: requestEvent.id,
      appliedImmediately: true,
      endorsedEventId,
      ...refunds,
    };
  });
}

// The 'endorsed' event: the new terms in force from the effective date, plus every figure of the
// request, so the page can explain the amounts later from this row alone. Shared by the
// immediate path (refund, no money) and by the collection path (lib/payments/endorsement-
// collection.ts, when Stripe confirms the delta was paid). The unique index on
// (payload ->> 'request_event_id') where event_type = 'endorsed' makes a second application of
// the same request fail inside its transaction.
export async function applyEndorsement(
  transaction: postgres.TransactionSql,
  input: {
    request: EndorsementRequest;
    termsBefore: PolicyTerms;
    appliedBy: string | null; // the user for an immediate application, null for a Stripe event
    collectionOperationId: string | null; // the money operation that collected a positive delta
  },
): Promise<string> {
  const figures = input.request.figures;
  const newTerms: PolicyTerms = {
    ...input.termsBefore,
    annualPremiumCents: figures.newAnnualPremiumCents,
    // The tax and the total shown as "the annual terms in force": the tax on the whole new
    // annual premium at the policy's rate. What was actually charged lives in the journal.
    taxCents: stateTaxCents(figures.newAnnualPremiumCents, input.termsBefore.taxRateBps),
    totalChargeCents: 0, // filled just below, once the tax is known
    perOccurrenceLimitCents: input.request.newPerOccurrenceLimitCents,
    aggregateLimitCents: input.request.newAggregateLimitCents,
  };
  newTerms.totalChargeCents = newTerms.annualPremiumCents + newTerms.taxCents + newTerms.feeCents;

  const [endorsed] = await transaction<{ id: string }[]>`
    insert into policy_events (policy_id, event_type, effective_at, payload, created_by)
    values (${input.request.policyId}, 'endorsed', ${figures.effectiveAt},
            ${transaction.json({
              ...endorsementRequestPayload({
                figures,
                newPerOccurrenceLimitCents: input.request.newPerOccurrenceLimitCents,
                newAggregateLimitCents: input.request.newAggregateLimitCents,
                newLimitLabel: input.request.newLimitLabel,
                description: input.request.description,
                reason: input.request.reason,
              }),
              // The terms: this is what makes the fold replace the annual premium and the limits.
              ...policyTermsToPayload(newTerms),
              request_event_id: input.request.eventId,
              collection_operation_id: input.collectionOperationId,
            })},
            ${input.appliedBy})
    returning id
  `;
  return endorsed.id;
}

// A premium reduction is refunded at once, like a partial cancellation (decided by Yoann,
// DECISIONS.md 09:57Z): one Stripe refund per payment given back, newest collection first, each
// with its allocation row and its refund entry, all in the caller's transaction.
type OpenedRefunds = {
  refundOperationIds: string[];
  refundOperationIdsAwaitingApproval: string[];
  approvalRequestIds: string[];
};

async function openRefundsForReduction(
  transaction: postgres.TransactionSql,
  plan: EndorsementPlan,
  request: EndorsementRequest,
  endorsedEventId: string,
  actorUserId: string,
): Promise<OpenedRefunds> {
  const figures = request.figures;
  let slices: RefundSlice[];
  try {
    slices = allocateRefundNewestCollectionFirst({
      refundedPremiumCents: -figures.deltaPremiumCents,
      refundedTaxCents: -figures.deltaTaxCents,
      commissionClawbackCents: -figures.commissionDeltaCents,
      collections: await collectionsStillRefundable(transaction, plan.policyId),
    });
  } catch (error) {
    if (error instanceof RefundCannotBeAllocated) {
      throw new EndorsementRefused(error.message);
    }
    throw error;
  }

  const refundOperationIds: string[] = [];
  const refundOperationIdsAwaitingApproval: string[] = [];
  const approvalRequestIds: string[] = [];
  for (const slice of slices) {
    // Maker-checker, written in THIS transaction and before the operation it gates, so there is
    // no instant in which a refund exists that nobody has to approve. The request carries the
    // sha256 of what is approved (policy, amount, Stripe payment); lib/payments/refunds.ts
    // rebuilds that hash from the operation and refuses to send when it differs.
    //
    // The threshold is read against the WHOLE refund owed to the customer, not against each
    // Stripe payment it is split over, so splitting cannot slip a reduction under $1,000.
    const approvalRequestId = plan.refundNeedsApproval
      ? await createApprovalRequest(transaction, {
          intent: refundIntent(plan.policyId, slice.amountCents, slice.paymentIntentId),
          destinationDescription: `Stripe payment ${slice.paymentIntentId} (card refund to the customer)`,
          requestedByUserId: actorUserId,
          payload: {
            policy_number: plan.policyNumber,
            reason: "endorsement: the annual premium was reduced mid-term",
            endorsement_effective_at: figures.effectiveAt,
            refunded_premium_cents: slice.refundedPremiumCents,
            refunded_tax_cents: slice.refundedTaxCents,
            total_refund_cents: -figures.deltaTotalCents,
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
                  ? "endorsement recorded; this refund waits for a second person to approve it before Stripe is called"
                  : "endorsement recorded; the Stripe refund has not been created yet",
              })})
    `;
    await transaction`
      insert into refund_allocations (
        refund_operation_id, policy_id, policy_event_id, collection_operation_id, payment_intent_id,
        amount_cents, refunded_premium_cents, refunded_tax_cents, commission_clawback_cents
      ) values (
        ${operation.id}, ${plan.policyId}, ${endorsedEventId}, ${slice.collectionOperationId},
        ${slice.paymentIntentId}, ${slice.amountCents}, ${slice.refundedPremiumCents},
        ${slice.refundedTaxCents}, ${slice.commissionClawbackCents}
      )
    `;
    const requested = endorsementRefundRequestedEntry({
      refundOperationId: operation.id,
      policyId: plan.policyId,
      policyNumber: plan.policyNumber,
      brokerId: plan.brokerId,
      effectiveAt: figures.effectiveAt,
      refundedPremiumCents: slice.refundedPremiumCents,
      refundedTaxCents: slice.refundedTaxCents,
      createdBy: actorUserId,
    });
    await postJournalEntry(transaction, requested.header, requested.lines);
    refundOperationIds.push(operation.id);
  }
  return { refundOperationIds, refundOperationIdsAwaitingApproval, approvalRequestIds };
}

// ---------------------------------------------------------------------------
// Closing a superseded quote's hosted payment page
// ---------------------------------------------------------------------------

// A request that is about to be superseded may have an open Checkout Session at Stripe (valid
// 24 hours). If the customer paid it afterwards, real money would arrive for a quote that no
// longer exists. So the open pages of the live request are expired at Stripe before a new
// request is written; a page Stripe does not know (a fixture on the disposable database) or
// already closed is fine. A session that is complete means money moved: the new request is
// refused, and the payment applies the old quote when its webhook arrives.
export async function expireOpenEndorsementCheckouts(policyId: string, database: Queryable): Promise<void> {
  const openSessions = await database<{ session_id: string }[]>`
    select accepted.provider_ref as session_id
      from endorsement_collections link
      join money_operation_events accepted on accepted.operation_id = link.collection_operation_id
     where link.policy_id = ${policyId}
       and accepted.status = 'provider_accepted'
       and accepted.provider_ref like 'cs_%'
       and not exists (select 1 from money_operation_events later
                        where later.operation_id = link.collection_operation_id
                          and later.status in ('succeeded', 'failed'))
  `;
  if (openSessions.length === 0) {
    return;
  }
  await assertStripeSandbox();
  for (const { session_id: sessionId } of openSessions) {
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch (error) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "resource_missing") {
        continue; // nothing to expire
      }
      throw error;
    }
    if (session.status === "complete") {
      throw new EndorsementRefused(
        `the previous quote's payment page ${sessionId} was already paid; wait for that payment to be applied before requesting another change`,
      );
    }
    if (session.status === "open") {
      await stripe.checkout.sessions.expire(sessionId);
    }
  }
}

// ---------------------------------------------------------------------------
// Customer approval
// ---------------------------------------------------------------------------

export type ApprovalInput = {
  policyId: string;
  requestEventId: string;
  quoteHash: string; // the hidden field of the approval form
  actor: EndorsementActor;
};

export type ApprovalResult = { approvedEventId: string; alreadyApproved: boolean };

// The customer accepts the quote. Bound to the hash: if the request was superseded (a second
// request moved the policy version) the hash no longer matches and the approval is refused.
export async function approveEndorsement(input: ApprovalInput, database: postgres.Sql = sql): Promise<ApprovalResult> {
  const policy = await loadPolicy(database, input.policyId);
  if (!policy) {
    throw new EndorsementRefused("this policy does not exist");
  }
  // The customer of the policy, and nobody else: not the broker, not staff, not an agent. The
  // customer id comes from the session, never from the form.
  if (input.actor.role !== "customer" || input.actor.customerId !== policy.customerId) {
    throw new EndorsementRefused("only the customer of this policy can approve an endorsement");
  }

  const { request, standing } = await requireLiveRequest(database, input.policyId, input.requestEventId, input.quoteHash);
  // Read from the standing, which recomputes it from the events, never from the request's own
  // payload flag (review finding F-B4-08).
  if (!standing.approvalRequired) {
    throw new EndorsementRefused("this endorsement is at or below the $500 threshold and needs no customer approval");
  }
  if (standing.approvedEventId) {
    return { approvedEventId: standing.approvedEventId, alreadyApproved: true };
  }

  const [approval] = await database<{ id: string }[]>`
    insert into policy_events (policy_id, event_type, effective_at, payload, created_by)
    values (${input.policyId}, 'endorsement_approved', ${request.figures.effectiveAt},
            ${database.json({
              request_event_id: request.eventId,
              quote_hash: request.figures.quoteHash,
              delta_total_cents: request.figures.deltaTotalCents,
              approved_by: input.actor.userId,
            })},
            ${input.actor.userId})
    returning id
  `;
  return { approvedEventId: approval.id, alreadyApproved: false };
}

// The request an approval or a payment refers to, if it is still the live quote. Refused with a
// plain message when it was applied, superseded, or when the hash on the form is not the hash
// on the request (a stale page, or a forged field).
export async function requireLiveRequest(
  database: Queryable,
  policyId: string,
  requestEventId: string,
  quoteHash: string,
): Promise<{ request: EndorsementRequest; standing: EndorsementRequestStanding }> {
  const request = await readEndorsementRequest(database, policyId, requestEventId);
  if (!request) {
    throw new EndorsementRefused("this endorsement request does not exist on this policy");
  }
  // Integrity of the stored figures: the hash is recomputed from the six facts it covers.
  const recomputed = endorsementQuoteHash({
    policyId: request.policyId,
    policyVersion: request.figures.policyVersion,
    effectiveAt: request.figures.effectiveAt,
    newAnnualPremiumCents: request.figures.newAnnualPremiumCents,
    deltaPremiumCents: request.figures.deltaPremiumCents,
    deltaTaxCents: request.figures.deltaTaxCents,
  });
  if (recomputed !== request.figures.quoteHash || quoteHash !== request.figures.quoteHash) {
    throw new EndorsementRefused(
      "this quote is out of date: the figures on your screen are not the ones on file; open the endorsement again",
    );
  }
  const standing = await endorsementRequestStanding(database, request);
  if (standing.state === "applied") {
    throw new EndorsementRefused("this endorsement is already in force");
  }
  if (standing.state === "superseded") {
    throw new EndorsementRefused(
      `this quote was superseded by a later ${standing.supersededByEventType ?? "event"} on the policy; open the endorsement again to see the current figures`,
    );
  }
  return { request, standing };
}

// ---------------------------------------------------------------------------
// The reads the plan is built from
// ---------------------------------------------------------------------------

type PolicyForEndorsement = {
  policyId: string;
  policyNumber: string;
  brokerId: string;
  customerId: string;
  commissionRateBps: number;
};

async function loadPolicy(database: Queryable, policyId: string): Promise<PolicyForEndorsement | null> {
  const [row] = await database<
    { id: string; policy_number: string; broker_id: string; customer_id: string; commission_rate_bps: number }[]
  >`
    select policy.id, policy.policy_number, policy.broker_id, policy.customer_id, broker.commission_rate_bps
      from policies policy
      join brokers broker on broker.id = policy.broker_id
     where policy.id = ${policyId}
  `;
  if (!row) {
    return null;
  }
  return {
    policyId: row.id,
    policyNumber: row.policy_number,
    brokerId: row.broker_id,
    customerId: row.customer_id,
    commissionRateBps: row.commission_rate_bps,
  };
}

// Additional premium this policy has asked the customer for and not had answered: the requests
// that are still waiting for a yes, none of them applied. A request the customer already
// approved is money they said yes to and does not make the next one need a second yes.
async function additionalPremiumAwaitingTheCustomer(database: Queryable, policyId: string): Promise<number> {
  let total = 0;
  for (const request of await endorsementRequestsOfPolicy(database, policyId)) {
    if (request.figures.deltaTotalCents <= 0) {
      continue; // a reduction gives money back, and the customer is never asked about it
    }
    const standing = await endorsementRequestStanding(database, request);
    if (standing.state === "awaiting_approval") {
      total += request.figures.deltaTotalCents;
    }
  }
  return total;
}

// Premium tax charged on this policy and not given back yet: the credit balance of
// premium_tax_payable over this policy's entries. A refund of tax can never exceed it.
async function premiumTaxStillHeldForPolicy(database: Queryable, policyId: string): Promise<number> {
  const [row] = await database<{ held_cents: string }[]>`
    select coalesce(sum(line.credit_cents) - sum(line.debit_cents), 0)::text as held_cents
      from journal_lines line
      join journal_entries entry on entry.id = line.entry_id
     where entry.policy_id = ${policyId}
       and line.account_id = 'premium_tax_payable'
  `;
  return Math.max(0, centsFromDatabase(row.held_cents, "premium_tax_payable balance"));
}

function assertPositiveCents(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new EndorsementRefused(`the ${name} must be a positive whole number of cents`);
  }
}

export function limitLabel(perOccurrenceLimitCents: number, aggregateLimitCents: number): string {
  return `${formatCentsAsUsd(perOccurrenceLimitCents)} per occurrence / ${formatCentsAsUsd(aggregateLimitCents)} aggregate`;
}

// One sentence for the endorsement schedule, built from what actually changed.
function describeChange(before: PolicyTerms, after: EndorsementInputFromForm): string {
  const parts: string[] = [];
  if (after.newAnnualPremiumCents !== before.annualPremiumCents) {
    parts.push(`Annual premium ${formatCentsAsUsd(before.annualPremiumCents)} to ${formatCentsAsUsd(after.newAnnualPremiumCents)}`);
  }
  if (after.newPerOccurrenceLimitCents !== before.perOccurrenceLimitCents) {
    parts.push(
      `per-occurrence limit ${formatCentsAsUsd(before.perOccurrenceLimitCents)} to ${formatCentsAsUsd(after.newPerOccurrenceLimitCents)}`,
    );
  }
  if (after.newAggregateLimitCents !== before.aggregateLimitCents) {
    parts.push(`aggregate limit ${formatCentsAsUsd(before.aggregateLimitCents)} to ${formatCentsAsUsd(after.newAggregateLimitCents)}`);
  }
  return parts.join("; ");
}
