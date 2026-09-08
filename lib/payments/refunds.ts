import type Stripe from "stripe";
import type postgres from "postgres";
import { sql } from "@/db/client";
import { ApprovalRefused, assertIntentIsApproved, createApprovalRequest } from "@/lib/approvals/approvals";
import { stripePaymentDestination, type MoneyOutIntent } from "@/lib/approvals/intent";
import { moneyOutNeedsApproval } from "@/lib/approvals/threshold";
import { refundCompletedEntries } from "@/lib/ledger/cancellation-entries";
import { isUniqueViolation, postJournalEntry } from "@/lib/ledger/post";
import { centsFromDatabase } from "@/lib/money/cents";
import { refundIdempotencyKey } from "@/lib/money/idempotency";
import { refundStateFromEvents, type RefundState } from "./refund-state";
import { assertStripeSandbox, stripe } from "@/lib/stripe";

// Everything Stripe-facing about a refund: asking for it, recovering from a lost answer,
// re-issuing a failed one, and turning the webhooks back into ledger entries.
//
// The database part of a cancellation is in lib/policy/cancel.ts and has already committed by
// the time anything here runs. That order is the whole safety argument: an operation row and a
// refund_requested entry exist BEFORE Stripe is asked for money, so a crash can never leave a
// refund at Stripe that our books do not know about.
//
// Each function below takes the database handle as a parameter whose default is the application
// pool. Production always uses the default; scripts/check-refund-replay.ts passes the disposable
// test database so the replay checks run this exact code, with real commits.

export type RefundOutcome =
  | { kind: "posted" } // journal entries written now
  | { kind: "already_posted" } // an earlier delivery of the same fact did the work
  | { kind: "recorded" } // lifecycle event appended, no money posted
  | { kind: "refused"; reason: string }; // we do not know how to book this; visible, never silent

// ---------------------------------------------------------------------------
// Asking Stripe for the money (the second half of the outbox)
// ---------------------------------------------------------------------------

export type RefundIssueOutcome = {
  operationId: string;
  // provider_accepted   Stripe has the refund;
  // failed              our call to Stripe failed, appended to the operation's history;
  // refused             the maker-checker gate said no: nothing was sent, nothing appended;
  // queued_for_approval a new attempt above the threshold was raised and waits for an approver.
  status: "provider_accepted" | "failed" | "refused" | "queued_for_approval";
  refundId: string | null;
  detail: string;
};

// Sends the refunds of one cancellation. Never throws on a provider error: a refusal by Stripe
// is a fact about the operation, so it is appended to its history and stays visible on the
// policy page, with refund_payable still open because the customer is still owed the money.
export async function issueRefundsAtStripe(
  refundOperationIds: string[],
  database: postgres.Sql = sql,
): Promise<RefundIssueOutcome[]> {
  const outcomes: RefundIssueOutcome[] = [];
  for (const operationId of refundOperationIds) {
    outcomes.push(await issueOneRefundAtStripe(operationId, database));
  }
  return outcomes;
}

async function issueOneRefundAtStripe(operationId: string, database: postgres.Sql): Promise<RefundIssueOutcome> {
  const operation = await loadRefundOperation(database, operationId);
  if (!operation) {
    return { operationId, status: "failed", refundId: null, detail: `no stripe_refund money operation ${operationId}` };
  }
  if (operation.refundId) {
    // Already accepted by Stripe (a second click, or a page reloaded): nothing more to send.
    return {
      operationId,
      status: "provider_accepted",
      refundId: operation.refundId,
      detail: "this refund was already created at Stripe",
    };
  }

  // EVERY road to Stripe passes the maker-checker gate HERE, whoever called (review finding
  // F-B7-01: the re-issue path used to reach Stripe without it). A refusal is not a provider
  // failure, so nothing is appended to the operation: the answer just says why.
  try {
    await assertRefundMaySend(database, operation);
  } catch (error) {
    if (error instanceof RefundSendRefused || error instanceof ApprovalRefused) {
      return { operationId, status: "refused", refundId: null, detail: error.message };
    }
    throw error;
  }

  try {
    // AF-04: Stripe's own statement that it is answering in test mode, before any money moves.
    await assertStripeSandbox();

    // Recovery first, always. See recoverPendingRefund below for why.
    const alreadyThere = await recoverPendingRefund(operation);
    const refund =
      alreadyThere ??
      (await stripe.refunds.create(
        {
          payment_intent: operation.paymentIntentId,
          amount: operation.amountCents,
          metadata: { operation_id: operation.operationId, policy_id: operation.policyId },
        },
        { idempotencyKey: operation.idempotencyKey },
      ));

    await recordAcceptedRefund({ operationId: operation.operationId, refund }, database);
    return {
      operationId,
      status: "provider_accepted",
      refundId: refund.id,
      detail: alreadyThere ? "recovered a refund Stripe had already created for this operation" : `refund ${refund.id} created`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "unknown provider error";
    await database`
      insert into money_operation_events (operation_id, status, payload)
      values (${operationId}, 'failed', ${database.json({ stage: "create_refund", message })})
    `;
    return { operationId, status: "failed", refundId: null, detail: message };
  }
}

// The crash case: the process died between `refunds.create` and storing Stripe's answer.
//
// The refund may well exist at Stripe, and we would have no record of it. Before creating
// anything we therefore ask Stripe what refunds already exist on this PaymentIntent and look
// for the one carrying our operation id in its metadata. Only if none is found do we call
// create, and even then with the stable idempotency key, so two attempts that race each other
// still produce a single refund.
//
// It runs on every attempt, including the first: one extra read is a small price for never
// having to decide, from inside the process, whether "this is the first attempt".
export async function recoverPendingRefund(operation: RefundOperation): Promise<Stripe.Refund | null> {
  const existing = await stripe.refunds.list({ payment_intent: operation.paymentIntentId, limit: 100 });
  const ours = existing.data.find((refund) => refund.metadata?.operation_id === operation.operationId);
  return ours ?? null;
}

// ---------------------------------------------------------------------------
// Sending a refund that is waiting: after an approval, or after a crash
// ---------------------------------------------------------------------------

// The intent an approver approves for a cancellation refund, and the one this module rebuilds
// from the operation before calling Stripe. Every part of it is immutable (the operation's
// amount, the allocation's PaymentIntent), so a mismatch means the approval names a different
// refund, not that this one changed under it.
export function refundIntent(policyId: string, amountCents: number, paymentIntentId: string): MoneyOutIntent {
  return {
    kind: "refund",
    subjectKind: "policy",
    subjectId: policyId,
    amountCents,
    destination: stripePaymentDestination(paymentIntentId),
  };
}

export class RefundSendRefused extends Error {}

// Whether this refund is allowed to leave for Stripe right now. Exported on its own so the
// screens can say why a button is not there, and so the check script can prove the refusal
// without calling Stripe.
//
// Two gates, and the second one is what makes maker-checker impossible to skip:
//   - an operation that carries an approval request needs an approved decision whose intent
//     still matches this refund;
//   - an operation ABOVE the threshold that carries no request at all is refused outright, so
//     that any code path which forgets the queue fails closed instead of paying.
export async function assertRefundMaySend(
  database: postgres.Sql,
  operation: RefundOperation,
): Promise<void> {
  if (operation.refundId) {
    throw new RefundSendRefused("this refund has already been created at Stripe");
  }
  if (operation.state === "completed") {
    throw new RefundSendRefused("this refund has already been paid to the customer");
  }
  if (operation.approvalRequestId) {
    await assertIntentIsApproved(
      database,
      operation.approvalRequestId,
      refundIntent(operation.policyId, operation.amountCents, operation.paymentIntentId),
    );
    return;
  }
  if (moneyOutNeedsApproval(operation.amountCents)) {
    throw new RefundSendRefused(
      "this refund is above the approval threshold but carries no approval request; it cannot be sent",
    );
  }
}

// The staff action behind one button, used for two situations that need exactly the same thing:
//
//   "send this approved refund"  the cancellation queued it because it is above $1,000, an
//                                approver has said yes, and the money can go;
//   "send it to Stripe again"    the cancellation committed and the process died before
//                                refunds.create was reached, so the operation is stuck in
//                                'requested' with no refund id (review finding F-B5-03).
//
// Both call issueRefundsAtStripe, which lists the PaymentIntent's refunds first and reuses the
// operation's own idempotency key, so a refund Stripe already created is adopted rather than
// created a second time.
export async function sendRequestedRefund(
  input: { policyId: string; operationId: string; actorUserId: string },
  database: postgres.Sql = sql,
): Promise<RefundIssueOutcome> {
  const operation = await loadRefundOperation(database, input.operationId);
  // The operation id comes from a URL, so it is checked against the policy in that same URL.
  if (!operation || operation.policyId !== input.policyId) {
    throw new RefundSendRefused("this refund operation does not belong to this policy");
  }
  if (operation.state === "failed") {
    throw new RefundSendRefused(
      "this refund failed; use the re-issue action, which decides whether the same attempt can be retried or a new one is needed",
    );
  }
  await assertRefundMaySend(database, operation);
  const [outcome] = await issueRefundsAtStripe([input.operationId], database);
  return outcome;
}

// Staff action after a FAILED refund: the bank sent the money back, the customer is still owed
// it, and refund_payable is still open. A new attempt is a NEW intent, so it gets a new money
// operation with a new idempotency key (reusing the old key would make Stripe hand back the
// failed refund forever).
//
// It posts NO journal entry: the liability was opened once by the original refund_requested
// entry and must be cleared exactly once, by whichever attempt finally completes.
export class RefundReissueRefused extends Error {}

// WHICH RECOVERY A FAILURE DESERVES (review finding F-B5-02). The two failures look the same on
// the operation and must not be recovered the same way:
//
//   our call to Stripe failed (stage 'create_refund')
//       We do not know whether Stripe created the refund: a timeout after acceptance looks
//       exactly like a refusal. Opening a NEW operation would give it a NEW idempotency key, and
//       the recovery listing only matches its own operation id, so Stripe could end up creating
//       a SECOND refund and the customer would be paid twice. The only safe move is to retry the
//       SAME operation with the SAME key, after listing the PaymentIntent's refunds and adopting
//       one that already carries this operation id.
//
//   Stripe said the refund failed (stage 'refund_lifecycle')
//       The money came back, that refund is dead and its key can never produce a live refund
//       again, so a new operation with a new key is the only way forward. Even then, Stripe is
//       asked what it actually holds for the previous operation before anything new is opened.
//
//   the approver said no (stage 'approval', review finding F-B7-01)
//       Nothing was ever sent. A rejection is not a Stripe failure and must not be laundered
//       into one: the new attempt is raised WITH a new approval request (the amount is above
//       the threshold, that is why it was queued) and goes back to the queue, never to Stripe.
//
// Whatever the stage, a re-issued operation above the threshold carries its own approval
// request, and issueRefundsAtStripe refuses anything above the threshold without one.
export async function reissueRefund(
  input: { policyId: string; failedOperationId: string; actorUserId: string },
  database: postgres.Sql = sql,
): Promise<{ operationId: string; outcome: RefundIssueOutcome }> {
  const failed = await loadRefundOperation(database, input.failedOperationId);
  if (!failed || failed.policyId !== input.policyId) {
    throw new RefundReissueRefused("this refund operation does not belong to this policy");
  }

  if (failed.lastFailureStage === "create_refund") {
    // The same operation, the same key. issueRefundsAtStripe checks the sandbox itself and
    // lists the PaymentIntent's refunds before creating anything, so a refund Stripe already
    // made for this operation is adopted rather than made a second time.
    const [outcome] = await issueRefundsAtStripe([input.failedOperationId], database);
    return { operationId: input.failedOperationId, outcome };
  }

  if (failed.lastFailureStage === "refund_lifecycle") {
    await assertPreviousRefundIsReallyDead(failed);
  }
  const operationId = await createReissuedRefundOperation(input, database);
  const reissued = await loadRefundOperation(database, operationId);
  if (reissued?.approvalRequestId) {
    return {
      operationId,
      outcome: {
        operationId,
        status: "queued_for_approval",
        refundId: null,
        detail: "above the approval threshold: a new approval request was raised; a distinct approver decides before anything is sent",
      },
    };
  }
  const [outcome] = await issueRefundsAtStripe([operationId], database);
  return { operationId, outcome };
}

// Asks Stripe, not our database, what became of the previous attempt. Our records can be behind
// (a webhook not yet delivered, a status that changed a second ago), and opening a second refund
// while the first one is alive would pay the customer twice.
async function assertPreviousRefundIsReallyDead(failed: RefundOperation): Promise<void> {
  await assertStripeSandbox();
  const atStripe = await stripe.refunds.list({ payment_intent: failed.paymentIntentId, limit: 100 });
  const previous = atStripe.data.filter((refund) => refund.metadata?.operation_id === failed.operationId);
  const stillAlive = previous.filter((refund) => refund.status !== "failed" && refund.status !== "canceled");
  if (stillAlive.length > 0) {
    throw new RefundReissueRefused(
      `Stripe still holds refund ${stillAlive[0].id} for this attempt with status "${stillAlive[0].status}", ` +
        "so a second refund would pay the customer twice; wait for that one to fail or complete",
    );
  }
}

// The database half of a re-issue, on its own so that scripts/check-refund-replay.ts can prove
// the important property (a re-issue creates a new operation and posts NO journal entry)
// without calling Stripe.
export async function createReissuedRefundOperation(
  input: { policyId: string; failedOperationId: string; actorUserId: string },
  database: postgres.Sql = sql,
): Promise<string> {
  const failed = await loadRefundOperation(database, input.failedOperationId);
  // The operation id comes from a URL, so it is checked against the policy in that same URL
  // rather than trusted: no refund of another policy can be re-issued from this page.
  if (!failed || failed.policyId !== input.policyId) {
    throw new RefundReissueRefused("this refund operation does not belong to this policy");
  }
  if (failed.state !== "failed") {
    throw new RefundReissueRefused(
      `only a failed refund can be re-issued; this one is "${failed.state}". Sending another refund for the same liability would pay the customer twice`,
    );
  }
  // Defence in depth for review finding F-B5-02: a failure of OUR call to Stripe leaves the
  // outcome unknown, so it is recovered by retrying the same operation under the same key
  // (reissueRefund above), never by opening a new one. Refused here as well as there, because
  // this function is exported and called directly by the check script.
  if (failed.lastFailureStage === "create_refund") {
    throw new RefundReissueRefused(
      "this attempt failed while we were calling Stripe, so Stripe may have created the refund anyway; " +
        "it has to be retried under the same idempotency key, not re-issued as a new refund",
    );
  }

  let newOperationId = "";
  await database.begin(async (transaction) => {
    // Maker-checker for the new attempt, written before the operation it gates, exactly as the
    // cancellation does (lib/policy/cancel.ts). The previous approval, if any, was for the
    // previous operation; money that goes out again is approved again.
    const approvalRequestId = moneyOutNeedsApproval(failed.amountCents)
      ? await createApprovalRequest(transaction, {
          intent: refundIntent(failed.policyId, failed.amountCents, failed.paymentIntentId),
          destinationDescription: `Stripe payment ${failed.paymentIntentId} (card refund to the customer), re-issued`,
          requestedByUserId: input.actorUserId,
          payload: {
            policy_number: failed.policyNumber,
            replaces_operation_id: input.failedOperationId,
            previous_failure_stage: failed.lastFailureStage,
            refunded_premium_cents: failed.refundedPremiumCents,
            refunded_tax_cents: failed.refundedTaxCents,
          },
        })
      : null;

    const attempt = await countRefundOperations(transaction, failed.policyId, failed.paymentIntentId);
    const [operation] = await transaction<{ id: string }[]>`
      insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key, approval_request_id, created_by)
      values ('stripe_refund', 'stripe', ${failed.amountCents}, ${failed.policyId},
              ${refundIdempotencyKey(failed.policyId, failed.paymentIntentId, attempt + 1)}, ${approvalRequestId},
              ${input.actorUserId})
      returning id
    `;
    await transaction`
      insert into money_operation_events (operation_id, status, payload)
      values (${operation.id}, 'requested',
              ${transaction.json({ note: "re-issued after a failed refund", replaces_operation_id: input.failedOperationId })})
    `;
    // The same split as the failed attempt: the customer is owed the same money, made of the
    // same premium and tax, and the same commission has to come back from the broker.
    await transaction`
      insert into refund_allocations (
        refund_operation_id, policy_id, policy_event_id, collection_operation_id, payment_intent_id,
        amount_cents, refunded_premium_cents, refunded_tax_cents, commission_clawback_cents
      ) values (
        ${operation.id}, ${failed.policyId}, ${failed.policyEventId}, ${failed.collectionOperationId},
        ${failed.paymentIntentId}, ${failed.amountCents}, ${failed.refundedPremiumCents},
        ${failed.refundedTaxCents}, ${failed.commissionClawbackCents}
      )
    `;
    newOperationId = operation.id;
  });

  return newOperationId;
}

// ---------------------------------------------------------------------------
// What the webhooks do
// ---------------------------------------------------------------------------

// Stripe accepted the refund. No money has moved yet, so nothing is journaled: the refund id is
// recorded on the operation, which is how a later event, or the reconciliation job, finds it.
export async function recordAcceptedRefund(
  input: { operationId: string; refund: Stripe.Refund },
  database: postgres.Sql = sql,
): Promise<RefundOutcome> {
  const alreadyRecorded = await database<{ id: string }[]>`
    select id from money_operation_events
     where operation_id = ${input.operationId}
       and status = 'provider_accepted'
       and provider_ref = ${input.refund.id}
     limit 1
  `;
  if (alreadyRecorded.length > 0) {
    return { kind: "already_posted" };
  }
  await database`
    insert into money_operation_events (operation_id, status, provider_ref, payload)
    values (${input.operationId}, 'provider_accepted', ${input.refund.id},
            ${database.json({ refund_status: input.refund.status, amount_cents: input.refund.amount })})
  `;
  return { kind: "recorded" };
}

// The money left Stripe. This is the only place that posts a completed refund, and it does it
// in one transaction with the 'succeeded' lifecycle event: either the ledger shows the refund
// paid and the commission clawed back, or nothing happened at all.
export async function recordCompletedRefund(
  input: { operationId: string; refundId: string; amountCents: number; refundedOn: string },
  database: postgres.Sql = sql,
): Promise<RefundOutcome> {
  const operation = await loadRefundOperation(database, input.operationId);
  if (!operation) {
    return { kind: "refused", reason: `no stripe_refund money operation ${input.operationId}` };
  }
  // The provider's amount must be the amount we asked for. Anything else is not a money event
  // we know how to book, so it stops here and stays visible for a human.
  if (operation.amountCents !== input.amountCents) {
    return {
      kind: "refused",
      reason: `amount mismatch: Stripe refunded ${input.amountCents} cents, the operation asked for ${operation.amountCents}`,
    };
  }

  try {
    await database.begin(async (transaction) => {
      // The clawback was decided and stored when the cancellation was recorded, so the amount
      // posted here is the amount the broker was shown, not a fresh calculation against a rate
      // that may have changed in the meantime.
      const entries = refundCompletedEntries({
        refundOperationId: operation.operationId,
        policyId: operation.policyId,
        policyNumber: operation.policyNumber,
        brokerId: operation.brokerId,
        refundedOn: input.refundedOn,
        totalRefundCents: operation.amountCents,
        commissionClawbackCents: operation.commissionClawbackCents,
      });
      for (const entry of entries) {
        await postJournalEntry(transaction, entry.header, entry.lines);
      }
      await transaction`
        insert into money_operation_events (operation_id, status, provider_ref, payload)
        values (${operation.operationId}, 'succeeded', ${input.refundId},
                ${transaction.json({ amount_cents: input.amountCents, refunded_on: input.refundedOn })})
      `;
    });
    return { kind: "posted" };
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Same refund operation, second delivery: the entries are already in the journal.
      return { kind: "already_posted" };
    }
    throw error;
  }
}

// The refund failed at the customer's bank, or was cancelled before it settled.
//
// NO JOURNAL ENTRY IS POSTED, on purpose (design re-review finding R-01): the customer is still
// owed the money and the policy is still cancelled, so refund_payable must stay open. Reversing
// refund_requested would put the premium back into unearned_premium on a policy that no longer
// covers anything and would make the books say nobody is owed anything. The failure is recorded
// on the operation, the policy page shows "requested, not completed" with the reason, and staff
// re-issue a new refund operation (reissueRefund above).
export async function recordFailedRefund(
  input: { operationId: string; refundId: string; reason: string },
  database: postgres.Sql = sql,
): Promise<RefundOutcome> {
  const operation = await loadRefundOperation(database, input.operationId);
  if (!operation) {
    return { kind: "refused", reason: `no stripe_refund money operation ${input.operationId}` };
  }
  const alreadyFailed = await database<{ id: string }[]>`
    select id from money_operation_events
     where operation_id = ${input.operationId} and status = 'failed' and provider_ref = ${input.refundId}
     limit 1
  `;
  if (alreadyFailed.length > 0) {
    return { kind: "already_posted" };
  }

  // A failure reported AFTER a completion is a different situation, and the ledger cannot fix
  // it on its own: we booked the cash as gone, and a late failure means it came back. Stripe
  // documents that path for payment methods where the refund needs bank details from the
  // customer (docs.stripe.com/refunds, "Refunds requiring action", read 2026-09-08): such a
  // refund can leave `succeeded` for `requires_action` and end `failed`. This build collects
  // by card only, where that transition does not happen, so nothing is reversed automatically:
  // the fact is recorded, flagged for a human, and a reversal stays an operator decision.
  const failedAfterCompletion = operation.state === "completed";
  await database`
    insert into money_operation_events (operation_id, status, provider_ref, payload)
    values (${input.operationId}, 'failed', ${input.refundId},
            ${database.json({
              stage: "refund_lifecycle",
              reason: input.reason.slice(0, 500),
              needs_human: failedAfterCompletion,
              note: failedAfterCompletion
                ? "this refund had already been reported as completed and posted to the ledger; a reversal is an operator decision, nothing was posted here"
                : undefined,
            })})
  `;
  return { kind: "recorded" };
}

// ---------------------------------------------------------------------------
// Finding the operation a Stripe refund belongs to
// ---------------------------------------------------------------------------

// Three ways, tried in order, because a webhook payload is untrusted input and metadata can be
// missing (a refund created from the Stripe dashboard by a human, for instance):
//   1. the operation id we put in the refund's metadata when we created it;
//   2. the refund id, which we stored on the operation as soon as Stripe accepted it;
//   3. the PaymentIntent, matched against the refund allocations of that payment.
// If the third way is ambiguous (two refunds in flight on the same payment) nothing is guessed:
// the event is stored and marked ignored with the reason, and a human looks at it.
export async function findRefundOperationId(
  refund: { id: string; payment_intent?: string | Stripe.PaymentIntent | null; metadata?: Stripe.Metadata | null },
  database: postgres.Sql = sql,
): Promise<{ operationId: string } | { operationId: null; reason: string }> {
  const fromMetadata = readUuid(refund.metadata?.operation_id);
  if (fromMetadata) {
    const [known] = await database<{ id: string }[]>`
      select id from money_operations where id = ${fromMetadata} and kind = 'stripe_refund'
    `;
    if (known) {
      return { operationId: known.id };
    }
    return { operationId: null, reason: `refund metadata names operation ${fromMetadata}, which is not a refund of ours` };
  }

  const [byRefundId] = await database<{ operation_id: string }[]>`
    select operation_id from money_operation_events
     where provider_ref = ${refund.id}
     order by sequence_number
     limit 1
  `;
  if (byRefundId) {
    return { operationId: byRefundId.operation_id };
  }

  const paymentIntentId = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id;
  if (!paymentIntentId) {
    return { operationId: null, reason: `refund ${refund.id} carries neither our operation id nor a payment intent` };
  }
  // Refunds of ours on that payment that have not completed yet: exactly one is unambiguous.
  const openOnThatPayment = await database<{ refund_operation_id: string }[]>`
    select allocation.refund_operation_id
      from refund_allocations allocation
     where allocation.payment_intent_id = ${paymentIntentId}
       and not exists (select 1 from money_operation_events event
                        where event.operation_id = allocation.refund_operation_id and event.status = 'succeeded')
  `;
  if (openOnThatPayment.length === 1) {
    return { operationId: openOnThatPayment[0].refund_operation_id };
  }
  return {
    operationId: null,
    reason:
      openOnThatPayment.length === 0
        ? `no refund of ours is waiting on payment ${paymentIntentId} (it may have been refunded from the Stripe dashboard)`
        : `${openOnThatPayment.length} refunds of ours are in flight on payment ${paymentIntentId}: which one this is cannot be decided safely`,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readUuid(candidate: unknown): string | null {
  return typeof candidate === "string" && UUID.test(candidate) ? candidate : null;
}

// ---------------------------------------------------------------------------
// Reading a refund operation and where it stands
// ---------------------------------------------------------------------------

export type RefundOperation = {
  operationId: string;
  policyId: string;
  policyNumber: string;
  brokerId: string;
  policyEventId: string;
  collectionOperationId: string;
  paymentIntentId: string;
  idempotencyKey: string;
  amountCents: number;
  refundedPremiumCents: number;
  refundedTaxCents: number;
  commissionClawbackCents: number;
  state: RefundState;
  refundId: string | null; // the Stripe refund id, once it exists
  // Set when the cancellation queued this refund for maker-checker (above $1,000). Null below
  // the threshold, and null on every operation created before slice B7.
  approvalRequestId: string | null;
  // Where the last failure came from, which decides how a re-issue is allowed to recover:
  //   'create_refund'     OUR call to Stripe failed; the refund may or may not exist there;
  //   'refund_lifecycle'  STRIPE said the refund itself failed or was cancelled;
  //   'approval'          the APPROVER said no; nothing was ever sent (F-B7-01).
  lastFailureStage: "create_refund" | "refund_lifecycle" | "approval" | null;
};

// The refund state rule moved to lib/payments/refund-state.ts, a file with no imports, so that
// the reconciliation job can read it without loading this module's database pool and Stripe
// client. Re-exported here because every existing caller imports it from this file.
export { refundStateFromEvents, type RefundState } from "./refund-state";

// Exported so the send action and the recovery job can read an operation without duplicating
// the join between the operation, its allocation, its policy and its lifecycle.
export async function loadRefundOperation(
  database: postgres.Sql,
  operationId: string,
): Promise<RefundOperation | null> {
  const [row] = await database<
    {
      id: string;
      amount_cents: string;
      idempotency_key: string;
      policy_id: string;
      policy_number: string;
      broker_id: string;
      policy_event_id: string;
      collection_operation_id: string;
      payment_intent_id: string;
      refunded_premium_cents: string;
      refunded_tax_cents: string;
      commission_clawback_cents: string;
      approval_request_id: string | null;
    }[]
  >`
    select operation.id,
           operation.amount_cents,
           operation.idempotency_key,
           operation.approval_request_id,
           policy.id            as policy_id,
           policy.policy_number as policy_number,
           broker.id            as broker_id,
           allocation.policy_event_id,
           allocation.collection_operation_id,
           allocation.payment_intent_id,
           allocation.refunded_premium_cents,
           allocation.refunded_tax_cents,
           allocation.commission_clawback_cents
      from money_operations operation
      join refund_allocations allocation on allocation.refund_operation_id = operation.id
      join policies policy on policy.id = operation.policy_id
      join brokers broker  on broker.id = policy.broker_id
     where operation.id = ${operationId}
       and operation.kind = 'stripe_refund'
  `;
  if (!row) {
    return null;
  }

  const events = await database<{ status: string; provider_ref: string | null; payload: { stage?: string } }[]>`
    select status, provider_ref, payload from money_operation_events
     where operation_id = ${operationId}
     order by sequence_number
  `;
  // On a refund operation, provider_ref only ever holds the Stripe refund id: the PaymentIntent
  // being given back lives in refund_allocations, not in the lifecycle events.
  const refundId = events.find((event) => event.provider_ref !== null)?.provider_ref ?? null;
  const lastFailure = [...events].reverse().find((event) => event.status === "failed");
  const lastFailureStage =
    lastFailure?.payload?.stage === "create_refund"
      ? ("create_refund" as const)
      : lastFailure?.payload?.stage === "approval"
        ? ("approval" as const)
        : lastFailure
          ? ("refund_lifecycle" as const)
          : null;

  return {
    operationId: row.id,
    policyId: row.policy_id,
    policyNumber: row.policy_number,
    brokerId: row.broker_id,
    policyEventId: row.policy_event_id,
    collectionOperationId: row.collection_operation_id,
    paymentIntentId: row.payment_intent_id,
    idempotencyKey: row.idempotency_key,
    amountCents: centsFromDatabase(row.amount_cents, "amount_cents"),
    refundedPremiumCents: centsFromDatabase(row.refunded_premium_cents, "refunded_premium_cents"),
    refundedTaxCents: centsFromDatabase(row.refunded_tax_cents, "refunded_tax_cents"),
    commissionClawbackCents: centsFromDatabase(row.commission_clawback_cents, "commission_clawback_cents"),
    state: refundStateFromEvents(events.map((event) => event.status)),
    refundId,
    approvalRequestId: row.approval_request_id,
    lastFailureStage,
  };
}

async function countRefundOperations(
  database: postgres.TransactionSql,
  policyId: string,
  paymentIntentId: string,
): Promise<number> {
  const [row] = await database<{ count: string }[]>`
    select count(*)::text as count from refund_allocations
     where policy_id = ${policyId} and payment_intent_id = ${paymentIntentId}
  `;
  return Number(row.count);
}
