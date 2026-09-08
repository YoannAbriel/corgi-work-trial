import type postgres from "postgres";
import { sql } from "@/db/client";
import { premiumEarnedToDateEntry, refundRequestedEntry } from "@/lib/ledger/cancellation-entries";
import { postJournalEntry } from "@/lib/ledger/post";
import { centsFromDatabase } from "@/lib/money/cents";
import { isCalendarDate } from "@/lib/money/dates";
import { refundIdempotencyKey } from "@/lib/money/idempotency";
import { cancellationBreakdown, type CancellationBreakdown } from "@/lib/money/premium";
import {
  allocateRefundNewestCollectionFirst,
  RefundCannotBeAllocated,
  type CollectionToRefund,
  type RefundSlice,
} from "@/lib/money/refund-allocation";
import { issueRefundsAtStripe } from "@/lib/payments/refunds";
import { foldPolicyEvents, refreshPolicyCurrent } from "./current";
import type { PolicyTerms } from "./terms";

// Cancelling a policy mid-term.
//
// What the user does: the owning broker (or staff operations) picks an effective date, sees the
// exact breakdown of what will be given back, and confirms. What happens then, in order:
//
//   1. ONE database transaction writes the cancellation event, the two journal entries and the
//      refund operation(s) in status 'requested'. Nothing has been asked of Stripe yet.
//   2. Only after that transaction is committed does the Stripe Refunds API get called, with an
//      idempotency key derived from the policy and the payment being given back
//      (lib/payments/refunds.ts). This is the outbox rule of ARCHITECTURE.md section 4: if the
//      process dies at any point, the intent is on disk and can be resumed with the same key,
//      and no money can be sent that the ledger does not already know about.
//   3. The refund is only COMPLETED in the ledger when Stripe's webhook says so.
//
// The money rules themselves are not here: they are pure functions in lib/money/premium.ts and
// lib/money/refund-allocation.ts, called by the preview and by the execution alike.

// Refusals a person can act on: wrong actor, wrong date, already cancelled, changed policy.
// They become a message on the page, never a 500.
export class CancellationRefused extends Error {}

export type CancellationActor = {
  userId: string;
  role: "broker" | "customer" | "staff_ops" | "staff_approver";
  brokerId: string | null; // set when the role is 'broker'
};

export type CancellationRequest = {
  policyId: string;
  effectiveAt: string; // "YYYY-MM-DD": the day coverage stops
  calculationMethod: string; // 'pro_rata' is the only method this build computes
  actor: CancellationActor;
};

// What the preview screen shows and what the execution posts: the same object, from the same
// pure functions, so the confirmation cannot promise a figure the ledger will not book.
export type CancellationPlan = {
  policyId: string;
  policyNumber: string;
  brokerId: string;
  terms: PolicyTerms;
  commissionRateBps: number;
  effectiveAt: string;
  calculationMethod: "pro_rata";
  breakdown: CancellationBreakdown;
  // Premium that still has to be recognised as earned. It is the earned premium of the
  // breakdown minus whatever earlier entries already moved into earned_premium.
  premiumToRecogniseAsEarnedCents: number;
  slices: RefundSlice[]; // one Stripe refund per slice; empty when nothing is owed back
  policyVersion: string; // see policyVersion() below
};

// Everything a claim could ever have to say about a cancellation, in one named place.
//
// Claims do not exist yet: they arrive in slice B7. The rule is written here now so that the
// answer at the live-fire debrief is a rule that was decided in advance, not an improvisation:
//
//   AN OPEN CLAIM DOES NOT BLOCK A CANCELLATION, AND IT DOES NOT CHANGE THE REFUND.
//
// The refund gives back unearned premium only: premium paid for cover that will not be
// provided after the cancellation date. A claim is a loss that happened while the policy WAS
// in force, so it stays payable, its reserve stays open, and neither is touched by the
// cancellation. The commission clawback follows the refunded premium alone, for the same
// reason. What B7 adds here is the narrow case where the business does want to stop the
// operator: for instance a claim whose paid amount already exceeds what would be left of the
// premium, which is a decision for a human rather than a refund to send automatically.
export function assertCancellationAllowed(policy: { policyId: string; policyNumber: string }): void {
  // Deliberately empty in v0: nothing about a claim blocks a cancellation today, and pretending
  // otherwise would be inventing a rule. Slice B7 fills this in with the claim reads it needs.
  void policy;
}

// A short string identifying "the policy as it stood when the preview was computed": how many
// events it had, and which one was last. If an endorsement or a correction lands between the
// preview and the confirmation, the string changes and the confirmation is refused, so nobody
// can confirm amounts that were computed against an older version of the policy.
async function policyVersion(database: Queryable, policyId: string): Promise<string> {
  const [row] = await database<{ event_count: string; last_event_id: string | null }[]>`
    select count(*)::text as event_count,
           (select id::text from policy_events where policy_id = ${policyId}
             order by sequence_number desc limit 1) as last_event_id
      from policy_events where policy_id = ${policyId}
  `;
  return `${row.event_count}:${row.last_event_id ?? "none"}`;
}

type Queryable = postgres.Sql | postgres.TransactionSql;

// ---------------------------------------------------------------------------
// Preview: read everything, compute everything, write nothing
// ---------------------------------------------------------------------------

export async function planCancellation(
  request: CancellationRequest,
  database: Queryable = sql,
): Promise<CancellationPlan> {
  const policy = await loadPolicy(database, request.policyId);
  if (!policy) {
    throw new CancellationRefused("this policy does not exist");
  }

  // Who may cancel: the broker who owns the policy, or staff operations. Checked on the server
  // for the preview and again for the execution, so calling the API directly changes nothing.
  const isOwningBroker = request.actor.role === "broker" && request.actor.brokerId === policy.brokerId;
  const isStaffOperations = request.actor.role === "staff_ops";
  if (!isOwningBroker && !isStaffOperations) {
    throw new CancellationRefused("only the broker who owns this policy, or staff operations, can cancel it");
  }

  // Short-rate cancellation is representable but not computed: the calculation method is stored
  // on the event and the short_rate_penalty_income account exists, so a later version can add
  // the penalty without moving any of this. Anything other than pro-rata is refused loudly
  // rather than silently treated as pro-rata.
  if (request.calculationMethod !== "pro_rata") {
    throw new CancellationRefused(
      `this build only computes pro-rata cancellations; "${request.calculationMethod}" is stored as a method but not calculated`,
    );
  }

  const { eventTypes, terms } = await foldPolicyEvents(database, request.policyId);
  if (!eventTypes.includes("issued")) {
    throw new CancellationRefused("this policy is not bound yet: there is no premium to give back");
  }
  if (eventTypes.includes("cancelled")) {
    throw new CancellationRefused("this policy is already cancelled");
  }
  assertCancellationAllowed({ policyId: policy.policyId, policyNumber: policy.policyNumber });

  // The effective date must be a day the policy actually covers.
  if (!isCalendarDate(request.effectiveAt)) {
    throw new CancellationRefused(`"${request.effectiveAt}" is not a calendar date`);
  }
  //
  // A date in the PAST is allowed on purpose: an insurer routinely learns days or weeks later
  // that cover stopped, and the money must then be computed from the day cover really stopped,
  // never from the day the form was filled in.
  // A date in the FUTURE is allowed too, and is not an edge case: "cancel at the end of the
  // month" is ordinary notice-period practice, and a policy bound before its term starts could
  // not be cancelled at all otherwise.
  if (request.effectiveAt < terms.termStart) {
    throw new CancellationRefused(
      `a cancellation cannot take effect before the policy starts (${terms.termStart}); the whole premium would have to be given back through a correction instead`,
    );
  }
  if (request.effectiveAt > terms.termEnd) {
    throw new CancellationRefused(`the policy ends on ${terms.termEnd}, so it cannot be cancelled after that date`);
  }

  const breakdown = cancellationBreakdown({
    writtenPremiumCents: terms.annualPremiumCents,
    taxChargedCents: terms.taxCents,
    taxRateBps: terms.taxRateBps,
    commissionRateBps: policy.commissionRateBps,
    termStart: terms.termStart,
    termEnd: terms.termEnd,
    cancellationEffectiveAt: request.effectiveAt,
  });

  // Premium already recognised as earned in the journal by an earlier entry. Today only a
  // cancellation posts one, so this is always zero; the monthly close of slice B9 will post
  // them too, and then this subtraction is what stops the same premium being earned twice.
  const alreadyEarnedCents = await premiumAlreadyRecognisedAsEarned(database, request.policyId);
  const premiumToRecogniseAsEarnedCents = breakdown.earnedPremiumCents - alreadyEarnedCents;
  if (premiumToRecogniseAsEarnedCents < 0) {
    throw new CancellationRefused(
      `the ledger already recognised ${alreadyEarnedCents} cents of earned premium, more than the ${breakdown.earnedPremiumCents} cents earned at ${request.effectiveAt}; backdating this far needs a correction (reversal and re-book), not a cancellation`,
    );
  }

  const collections = await collectionsStillRefundable(database, request.policyId);
  let slices: RefundSlice[];
  try {
    slices = allocateRefundNewestCollectionFirst({
      refundedPremiumCents: breakdown.unearnedPremiumCents,
      refundedTaxCents: breakdown.refundedTaxCents,
      commissionClawbackCents: breakdown.commissionClawbackCents,
      collections,
    });
  } catch (error) {
    if (error instanceof RefundCannotBeAllocated) {
      throw new CancellationRefused(error.message);
    }
    throw error;
  }

  return {
    policyId: policy.policyId,
    policyNumber: policy.policyNumber,
    brokerId: policy.brokerId,
    terms,
    commissionRateBps: policy.commissionRateBps,
    effectiveAt: request.effectiveAt,
    calculationMethod: "pro_rata",
    breakdown,
    premiumToRecogniseAsEarnedCents,
    slices,
    policyVersion: await policyVersion(database, request.policyId),
  };
}

// ---------------------------------------------------------------------------
// Execution: one transaction, then the provider
// ---------------------------------------------------------------------------

export type CancellationResult = {
  plan: CancellationPlan;
  cancellationEventId: string;
  refundOperationIds: string[];
};

// The whole cancellation: recompute, write, then ask Stripe for the money.
// `expectedPolicyVersion` is the hidden field carried by the confirmation form.
export async function cancelPolicy(
  request: CancellationRequest & { expectedPolicyVersion: string },
): Promise<CancellationResult> {
  const written = await recordCancellation(request);
  // Outbox: the intent is committed, so the provider call can be retried or resumed with the
  // same key. A provider failure is recorded on the operation and does not undo the cancellation.
  await issueRefundsAtStripe(written.refundOperationIds);
  return written;
}

// Everything that touches our own database, in one transaction and without any provider call.
// Exported on its own so that scripts/check-refund-replay.ts can exercise the real posting code
// against the disposable test database.
export async function recordCancellation(
  request: CancellationRequest & { expectedPolicyVersion?: string },
  database: postgres.Sql = sql,
): Promise<CancellationResult> {
  // Everything is recomputed here, at execution time: the preview is a screen, not an input.
  const plan = await planCancellation(request, database);
  if (request.expectedPolicyVersion !== undefined && request.expectedPolicyVersion !== plan.policyVersion) {
    throw new CancellationRefused(
      "this policy changed since the preview was computed, so the amounts on screen are out of date; open the cancellation again to see the new figures",
    );
  }

  const refundOperationIds: string[] = [];
  let cancellationEventId = "";

  await database.begin(async (transaction) => {
    // 1. The cancellation itself: an immutable policy event carrying its date, its method and
    //    every figure that was computed, so the page can explain the amounts later without
    //    recomputing them from a rate table that may have moved on.
    const [cancellationEvent] = await transaction<{ id: string }[]>`
      insert into policy_events (policy_id, event_type, effective_at, payload, created_by)
      values (${plan.policyId}, 'cancelled', ${plan.effectiveAt},
              ${transaction.json(cancellationPayload(plan))}, ${request.actor.userId})
      returning id
    `;
    cancellationEventId = cancellationEvent.id;

    // 2. The premium the customer really used stops being a liability and becomes income.
    //    Skipped when the cancellation takes effect on the first day of the term: nothing was
    //    earned, and an entry with no amount would be an entry with no meaning.
    if (plan.premiumToRecogniseAsEarnedCents > 0) {
      const earned = premiumEarnedToDateEntry({
        cancellationEventId: cancellationEvent.id,
        policyId: plan.policyId,
        policyNumber: plan.policyNumber,
        brokerId: plan.brokerId,
        effectiveAt: plan.effectiveAt,
        earnedPremiumCents: plan.premiumToRecogniseAsEarnedCents,
        createdBy: request.actor.userId,
      });
      await postJournalEntry(transaction, earned.header, earned.lines);
    }

    // 3. One money operation, one refund_allocations row and one refund_requested entry per
    //    Stripe payment being given back. The operation is 'requested': we owe the money and we
    //    have not asked Stripe for it yet.
    for (const slice of plan.slices) {
      const attempt = (await countRefundOperations(transaction, plan.policyId, slice.paymentIntentId)) + 1;
      const [operation] = await transaction<{ id: string }[]>`
        insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key, created_by)
        values ('stripe_refund', 'stripe', ${slice.amountCents}, ${plan.policyId},
                ${refundIdempotencyKey(plan.policyId, slice.paymentIntentId, attempt)}, ${request.actor.userId})
        returning id
      `;
      await transaction`
        insert into money_operation_events (operation_id, status, payload)
        values (${operation.id}, 'requested',
                ${transaction.json({ note: "cancellation recorded; the Stripe refund has not been created yet" })})
      `;
      await transaction`
        insert into refund_allocations (
          refund_operation_id, policy_id, policy_event_id, collection_operation_id, payment_intent_id,
          amount_cents, refunded_premium_cents, refunded_tax_cents, commission_clawback_cents
        ) values (
          ${operation.id}, ${plan.policyId}, ${cancellationEvent.id}, ${slice.collectionOperationId},
          ${slice.paymentIntentId}, ${slice.amountCents}, ${slice.refundedPremiumCents},
          ${slice.refundedTaxCents}, ${slice.commissionClawbackCents}
        )
      `;

      const requested = refundRequestedEntry({
        refundOperationId: operation.id,
        policyId: plan.policyId,
        policyNumber: plan.policyNumber,
        brokerId: plan.brokerId,
        effectiveAt: plan.effectiveAt,
        refundedPremiumCents: slice.refundedPremiumCents,
        refundedTaxCents: slice.refundedTaxCents,
        createdBy: request.actor.userId,
      });
      await postJournalEntry(transaction, requested.header, requested.lines);
      refundOperationIds.push(operation.id);
    }

    await refreshPolicyCurrent(transaction, plan.policyId);
  });

  return { plan, cancellationEventId, refundOperationIds };
}

// The figures kept on the cancellation event, in the same snake_case as the SQL columns.
//
// Deliberately no field called `annual_premium_cents`: that name is how lib/policy/current.ts
// recognises an event that REPLACES the policy terms, and a cancellation does not change the
// terms, it ends them.
function cancellationPayload(plan: CancellationPlan): Record<string, string | number | boolean> {
  return {
    calculation_method: plan.calculationMethod,
    term_start: plan.terms.termStart,
    term_end: plan.terms.termEnd,
    term_days: plan.breakdown.termDays,
    earned_days: plan.breakdown.earnedDays,
    written_premium_cents: plan.terms.annualPremiumCents,
    tax_charged_cents: plan.terms.taxCents,
    tax_rate_bps: plan.terms.taxRateBps,
    commission_rate_bps: plan.commissionRateBps,
    earned_premium_cents: plan.breakdown.earnedPremiumCents,
    unearned_premium_cents: plan.breakdown.unearnedPremiumCents,
    refunded_tax_cents: plan.breakdown.refundedTaxCents,
    tax_refund_was_capped_at_charged: plan.breakdown.taxRefundWasCappedAtCharged,
    refunded_fee_cents: plan.breakdown.refundedFeeCents,
    total_refund_cents: plan.breakdown.totalRefundCents,
    commission_clawback_cents: plan.breakdown.commissionClawbackCents,
  };
}

// ---------------------------------------------------------------------------
// The reads the plan is built from
// ---------------------------------------------------------------------------

type PolicyForCancellation = {
  policyId: string;
  policyNumber: string;
  brokerId: string;
  commissionRateBps: number;
};

async function loadPolicy(database: Queryable, policyId: string): Promise<PolicyForCancellation | null> {
  const [row] = await database<
    { id: string; policy_number: string; broker_id: string; commission_rate_bps: number }[]
  >`
    select policy.id, policy.policy_number, broker.id as broker_id, broker.commission_rate_bps
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
    commissionRateBps: row.commission_rate_bps,
  };
}

// Premium already moved into earned_premium by an earlier entry on this policy.
async function premiumAlreadyRecognisedAsEarned(database: Queryable, policyId: string): Promise<number> {
  const [row] = await database<{ earned_cents: string }[]>`
    select coalesce(sum(line.credit_cents) - sum(line.debit_cents), 0)::text as earned_cents
      from journal_lines line
      join journal_entries entry on entry.id = line.entry_id
     where entry.policy_id = ${policyId}
       and line.account_id = 'earned_premium'
  `;
  return centsFromDatabase(row.earned_cents, "earned_premium balance");
}

// The payments that can still give money back: every collected Stripe payment of this policy,
// minus what has already been refunded on it.
async function collectionsStillRefundable(database: Queryable, policyId: string): Promise<CollectionToRefund[]> {
  const collections = await database<
    { operation_id: string; payment_intent_id: string; amount_cents: string; collected_on: string }[]
  >`
    select operation.id           as operation_id,
           collected.provider_ref as payment_intent_id,
           operation.amount_cents,
           coalesce(collected.payload ->> 'paid_on',
                    to_char(collected.recorded_at at time zone 'utc', 'YYYY-MM-DD')) as collected_on
      from money_operations operation
      join lateral (
             select provider_ref, payload, recorded_at
               from money_operation_events
              where operation_id = operation.id and status = 'succeeded'
              order by sequence_number
              limit 1
           ) collected on true
     where operation.policy_id = ${policyId}
       and operation.kind = 'stripe_checkout'
       and collected.provider_ref is not null
  `;

  // Amounts already committed to a refund on each payment. A refund that FAILED at the bank is
  // excluded: the money came back to us, so that payment can be refunded again by a new
  // operation. A refund that succeeded, or that is still in flight, is counted.
  const alreadyRefunded = await database<{ payment_intent_id: string; refunded_cents: string }[]>`
    select allocation.payment_intent_id,
           coalesce(sum(allocation.amount_cents), 0)::text as refunded_cents
      from refund_allocations allocation
     where allocation.policy_id = ${policyId}
       and not (
             exists (select 1 from money_operation_events event
                      where event.operation_id = allocation.refund_operation_id and event.status = 'failed')
         and not exists (select 1 from money_operation_events event
                          where event.operation_id = allocation.refund_operation_id and event.status = 'succeeded')
       )
     group by allocation.payment_intent_id
  `;
  const refundedByPaymentIntent = new Map(
    alreadyRefunded.map((row) => [row.payment_intent_id, centsFromDatabase(row.refunded_cents, "refunded_cents")]),
  );

  return collections.map((row) => ({
    operationId: row.operation_id,
    paymentIntentId: row.payment_intent_id,
    refundableCents:
      centsFromDatabase(row.amount_cents, "amount_cents") - (refundedByPaymentIntent.get(row.payment_intent_id) ?? 0),
    collectedOn: row.collected_on,
  }));
}

// How many refund operations already exist for this policy and this payment, so the next one
// gets its own idempotency key (see lib/money/idempotency.ts).
async function countRefundOperations(
  database: Queryable,
  policyId: string,
  paymentIntentId: string,
): Promise<number> {
  const [row] = await database<{ count: string }[]>`
    select count(*)::text as count
      from refund_allocations
     where policy_id = ${policyId} and payment_intent_id = ${paymentIntentId}
  `;
  return Number(row.count);
}
