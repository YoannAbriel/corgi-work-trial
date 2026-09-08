import type postgres from "postgres";
import Stripe from "stripe";
import { sql } from "@/db/client";
import { reverseJournalEntry } from "@/lib/ledger/reverse";
import { CHECKOUT_EXPIRED_REASON } from "@/lib/payments/collection";
import { assertStripeSandbox, stripe } from "@/lib/stripe";
import { foldPolicyEvents, refreshPolicyCurrent } from "./current";

// Voiding a binding that rests on a payment Stripe never made.
//
// Why this exists: during development a policy was bound by a locally signed webhook whose
// payment intent id does not exist at Stripe (review finding F-B2-01). The ledger then claims
// cash that was never collected. Nothing can be deleted, so the correction is the one the
// brief describes: reversal entries linked to the originals, plus a dated policy event that
// says why, and the fold stops applying the superseded issuance.
//
// Safety rule, checked at Stripe before anything is written: the payment intent recorded on
// the operation must NOT exist there. A binding backed by a real payment is never voided by
// this path; it is cancelled with a real refund (lib/policy/cancel.ts).
//
// Second rule (review finding F-B2-13): the hosted Checkout Session of that operation may still
// be open at Stripe. If someone paid it later, real money would arrive for an operation whose
// entries are already reversed and nothing could be journaled. So the void expires that session
// at Stripe first, and records the attempt as dead (reason "expired") so that the next Pay
// click opens a new operation with a new idempotency key instead of handing back a dead page.

export class VoidRefused extends Error {}

export type VoidFabricatedBindingRequest = {
  policyId: string;
  reason: string; // written on every reversal entry and on the correction event
  actorUserId: string; // the human who ordered the correction (created_by)
};

export type VoidFabricatedBindingResult = {
  correctionEventId: string;
  reversedEntryIds: string[];
  operationId: string;
  fabricatedPaymentIntentId: string;
};

export async function voidFabricatedBinding(
  request: VoidFabricatedBindingRequest,
  database: postgres.Sql = sql,
): Promise<VoidFabricatedBindingResult> {
  if (request.reason.trim().length < 10) {
    throw new VoidRefused("a correction needs a written reason");
  }

  const { eventTypes } = await foldPolicyEvents(database, request.policyId);
  if (!eventTypes.includes("issued")) {
    throw new VoidRefused("this policy is not bound, there is no issuance to void");
  }
  if (eventTypes.includes("cancelled")) {
    throw new VoidRefused("this policy is cancelled; its money was handled by the cancellation");
  }

  const [issued] = await database<{ id: string; effective_at: Date }[]>`
    select id, effective_at from policy_events
     where policy_id = ${request.policyId} and event_type = 'issued'
  `;
  const [operation] = await database<{ id: string; provider_ref: string | null }[]>`
    select operation.id, event.provider_ref
      from money_operations operation
      join money_operation_events event on event.operation_id = operation.id and event.status = 'succeeded'
     where operation.policy_id = ${request.policyId} and operation.kind = 'stripe_checkout'
     order by event.sequence_number desc
     limit 1
  `;
  if (!operation || !operation.provider_ref) {
    throw new VoidRefused("no succeeded checkout operation with a payment intent reference was found");
  }

  // The guard: ask Stripe. A payment intent that exists means real money; refuse.
  await assertStripeSandbox();
  const existsAtStripe = await paymentIntentExists(operation.provider_ref);
  if (existsAtStripe) {
    throw new VoidRefused(
      `payment intent ${operation.provider_ref} exists at Stripe: this binding is backed by a real payment and must be cancelled with a refund, not voided`,
    );
  }

  const entries = await database<{ id: string }[]>`
    select id from journal_entries
     where source_kind = 'money_operation' and source_id = ${operation.id}
     order by recorded_at, id
  `;
  if (entries.length === 0) {
    throw new VoidRefused("no journal entries are keyed on that operation");
  }

  // Close the hosted page before writing anything: a session that is still open could be paid.
  const [accepted] = await database<{ provider_ref: string | null }[]>`
    select provider_ref from money_operation_events
     where operation_id = ${operation.id} and status = 'provider_accepted' and provider_ref like 'cs_%'
     order by sequence_number limit 1
  `;
  const sessionId = accepted?.provider_ref ?? null;
  if (sessionId) {
    await expireCheckoutSessionIfOpen(sessionId);
  }

  return database.begin(async (transaction) => {
    const effectiveAt = issued.effective_at.toISOString().slice(0, 10);
    const [correction] = await transaction<{ id: string }[]>`
      insert into policy_events (policy_id, event_type, effective_at, payload, supersedes_event_id, created_by)
      values (${request.policyId}, 'correction_reversal', ${effectiveAt},
              ${transaction.json({
                reason: request.reason,
                operation_id: operation.id,
                fabricated_payment_intent_id: operation.provider_ref,
                reversed_entry_ids: entries.map((entry) => entry.id),
              })},
              ${issued.id}, ${request.actorUserId})
      returning id
    `;

    const reversedEntryIds: string[] = [];
    for (const entry of entries) {
      reversedEntryIds.push(
        await reverseJournalEntry(transaction, {
          originalEntryId: entry.id,
          correctionEventId: correction.id,
          createdBy: request.actorUserId,
          description: request.reason,
        }),
      );
    }

    // The operation's story continues: its "success" is now known to be false, and its hosted
    // page is dead. The reason is the one lib/payments/checkout.ts reads as "cannot be paid
    // again", so the next Pay click starts a new operation with a new key.
    await transaction`
      insert into money_operation_events (operation_id, status, provider_ref, payload)
      values (${operation.id}, 'failed', ${operation.provider_ref},
              ${transaction.json({
                stage: "correction",
                reason: CHECKOUT_EXPIRED_REASON,
                correction_reason: request.reason,
                correction_event_id: correction.id,
                checkout_session_id: sessionId,
              })})
    `;

    await refreshPolicyCurrent(transaction, request.policyId);

    return {
      correctionEventId: correction.id,
      reversedEntryIds,
      operationId: operation.id,
      fabricatedPaymentIntentId: operation.provider_ref!,
    };
  });
}

// Expires the hosted page at Stripe so nobody can pay a voided operation. A session that Stripe
// does not know (fabricated in a test database) or that is already expired is fine; a session
// that is complete means money moved, and the void must stop.
async function expireCheckoutSessionIfOpen(sessionId: string): Promise<void> {
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (error) {
    if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "resource_missing") {
      return; // nothing to expire
    }
    throw error;
  }
  if (session.status === "complete") {
    throw new VoidRefused(`checkout session ${sessionId} is complete at Stripe: money moved, this binding cannot be voided`);
  }
  if (session.status === "open") {
    await stripe.checkout.sessions.expire(sessionId);
  }
}

// True when Stripe knows this payment intent. A "resource_missing" answer means it does not.
async function paymentIntentExists(paymentIntentId: string): Promise<boolean> {
  try {
    await stripe.paymentIntents.retrieve(paymentIntentId);
    return true;
  } catch (error) {
    if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "resource_missing") {
      return false;
    }
    throw error; // network or auth problems must not be mistaken for "does not exist"
  }
}
