import type Stripe from "stripe";
import { sql } from "@/db/client";
import {
  recordCheckoutSessionCompleted,
  recordFailedPayment,
  recordSuccessfulPayment,
} from "@/lib/payments/collection";
import {
  findRefundOperationId,
  recordAcceptedRefund,
  recordCompletedRefund,
  recordFailedRefund,
} from "@/lib/payments/refunds";
import { stripe, stripeWebhookSigningSecret } from "@/lib/stripe";

// POST /api/webhooks/stripe
//
// 1. Verify the signature on the raw body. Anything unsigned is rejected before touching the database.
// 2. Refuse live-mode events (AF-04): this trial only ever processes test-mode money.
// 3. Store the event once, immutably (unique on provider + event id). A second delivery of the
//    same event finds the row already there and continues to step 4 instead of being lost.
// 4. Take a processing lease: only one delivery at a time can move the event from pending or
//    failed to processing. Concurrent duplicates get no lease and are answered 200.
// 5. Process: post the money for the event types we handle, record the others as ignored with
//    the reason, so nothing is silently dropped.
// 6. Answer 200 when done or ignored, 500 when processing failed so Stripe retries later.

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "missing stripe-signature header" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, stripeWebhookSigningSecret());
  } catch {
    return Response.json({ error: "invalid signature" }, { status: 400 });
  }

  if (event.livemode) {
    // A live event means a live endpoint is pointed at us. It is never processed.
    return Response.json({ error: "live-mode events are refused in this trial" }, { status: 400 });
  }

  const webhookEventId = await storeEventOnce(event, rawBody);
  const lease = await takeProcessingLease(webhookEventId);
  if (!lease) {
    // Already done, already ignored, or another delivery is processing it right now.
    return Response.json({ received: true, duplicate: true });
  }

  try {
    const outcome = await processStripeEvent(event);
    await sql`
      update webhook_processing
         set status = ${outcome.status}, last_error = ${outcome.reason ?? null}, updated_at = now()
       where webhook_event_id = ${webhookEventId}
    `;
    return Response.json({ received: true, status: outcome.status });
  } catch (error) {
    const sanitizedError = error instanceof Error ? error.message.slice(0, 500) : "unknown error";
    await sql`
      update webhook_processing
         set status = 'failed', last_error = ${sanitizedError}, updated_at = now()
       where webhook_event_id = ${webhookEventId}
    `;
    return Response.json({ received: false, status: "failed" }, { status: 500 });
  }
}

// Inserts the immutable event and its pending processing row. If the event already exists,
// returns the existing row id (the unique constraint is the deduplication).
// The payload stored is the body whose signature was verified, so what we keep is exactly what
// Stripe sent. It goes through transaction.json(): passing a JSON string instead would store a
// jsonb string rather than a jsonb object, and payload -> 'data' would then find nothing.
async function storeEventOnce(event: Stripe.Event, rawBody: string): Promise<string> {
  const [existing] = await sql<{ id: string }[]>`
    select id from webhook_events where provider = 'stripe' and provider_event_id = ${event.id}
  `;
  if (existing) {
    return existing.id;
  }
  return sql.begin(async (transaction) => {
    const [inserted] = await transaction<{ id: string }[]>`
      insert into webhook_events (provider, provider_event_id, event_type, livemode, payload, signature_verified)
      values ('stripe', ${event.id}, ${event.type}, ${event.livemode},
              ${transaction.json(JSON.parse(rawBody))}, true)
      on conflict (provider, provider_event_id) do nothing
      returning id
    `;
    if (inserted) {
      await transaction`insert into webhook_processing (webhook_event_id, status) values (${inserted.id}, 'pending')`;
      return inserted.id;
    }
    // Lost a race with a concurrent delivery that inserted first: reuse its row.
    const [winner] = await transaction<{ id: string }[]>`
      select id from webhook_events where provider = 'stripe' and provider_event_id = ${event.id}
    `;
    return winner.id;
  });
}

// One UPDATE that only succeeds for pending or failed rows: this is the lease.
// A row stuck in 'processing' for more than five minutes (the function died mid-way) can be
// leased again, so no event stays stuck forever; a healthy processing run takes seconds.
const LEASE_EXPIRY = "5 minutes";

async function takeProcessingLease(webhookEventId: string): Promise<boolean> {
  const leased = await sql`
    update webhook_processing
       set status = 'processing', attempts = attempts + 1, updated_at = now()
     where webhook_event_id = ${webhookEventId}
       and (status in ('pending', 'failed')
            or (status = 'processing' and updated_at < now() - ${LEASE_EXPIRY}::interval))
    returning webhook_event_id
  `;
  return leased.length === 1;
}

type ProcessingOutcome = { status: "done" | "ignored"; reason?: string };

// The event types this application handles; every other type is stored and ignored with its
// reason, so nothing is silently dropped and the failed-events view can show what arrived.
async function processStripeEvent(event: Stripe.Event): Promise<ProcessingOutcome> {
  switch (event.type) {
    case "payment_intent.succeeded":
      return handlePaymentSucceeded(event.data.object);
    case "payment_intent.payment_failed":
      return handlePaymentFailed(event.data.object);
    case "checkout.session.completed":
      return handleCheckoutSessionCompleted(event.data.object);
    // Three events describe the life of one refund, and any of them can be the first to carry
    // the status that matters, so they all go through the same handler.
    case "refund.created":
    case "refund.updated":
    case "refund.failed":
      return handleRefundEvent(event.data.object);
    case "charge.refunded":
      return handleChargeRefunded(event.data.object);
    default:
      return { status: "ignored", reason: `no handler for ${event.type}` };
  }
}

// The money event: this is the one that posts journal entries and binds the policy.
async function handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent): Promise<ProcessingOutcome> {
  const operationId = readOperationId(paymentIntent.metadata);
  if (!operationId) {
    return { status: "ignored", reason: "payment_intent carries no usable metadata.operation_id" };
  }
  const outcome = await recordSuccessfulPayment({
    operationId,
    paymentIntentId: paymentIntent.id,
    amountReceivedCents: paymentIntent.amount_received,
    paidOn: utcCalendarDate(paymentIntent.created),
  });
  if (outcome.kind === "refused") {
    return { status: "ignored", reason: outcome.reason };
  }
  return {
    status: "done",
    reason: outcome.kind === "already_posted" ? "already posted by an earlier delivery of this payment" : undefined,
  };
}

// A declined card. No money moved, so nothing is journaled and the policy stays unbound.
async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent): Promise<ProcessingOutcome> {
  const operationId = readOperationId(paymentIntent.metadata);
  if (!operationId) {
    return { status: "ignored", reason: "payment_intent carries no usable metadata.operation_id" };
  }
  const outcome = await recordFailedPayment({
    operationId,
    paymentIntentId: paymentIntent.id,
    reason: paymentIntent.last_payment_error?.message ?? "Stripe reported payment_intent.payment_failed",
  });
  return outcome.kind === "refused" ? { status: "ignored", reason: outcome.reason } : { status: "done" };
}

// The hosted page was completed. Recorded as a step of the operation, never as money:
// checkout.session.completed and payment_intent.succeeded describe the same collection, and
// posting on both would double the cash and the commission.
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<ProcessingOutcome> {
  const operationId = readOperationId(session.metadata) ?? readOperationId({ operation_id: session.client_reference_id });
  if (!operationId) {
    return { status: "ignored", reason: "checkout session carries no usable operation id" };
  }
  const outcome = await recordCheckoutSessionCompleted({
    operationId,
    sessionId: session.id,
    paymentStatus: session.payment_status ?? null,
  });
  return outcome.kind === "refused" ? { status: "ignored", reason: outcome.reason } : { status: "done" };
}

// The life of a refund, whichever event carries it.
//
// Stripe documents three refund events (docs.stripe.com/refunds, "Refund events", read
// 2026-09-08): refund.created when the refund is created, refund.updated when it changes, and
// refund.failed when the bank sends the money back. It recommends listening to refund.created
// at a minimum, and a card refund created through the API is normally already `succeeded` in
// its very first event. So the decision here is taken on the refund's STATUS, not on the name
// of the event: whichever event first says `succeeded` posts the money, and the journal's
// unique key on (money operation, entry type) makes every later event a no-op.
async function handleRefundEvent(refund: Stripe.Refund): Promise<ProcessingOutcome> {
  const found = await findRefundOperationId(refund);
  if (found.operationId === null) {
    return { status: "ignored", reason: found.reason };
  }
  const operationId = found.operationId;

  // Store the refund id on the operation as soon as we see it, whatever the status: if our own
  // API answer was lost, this webhook is how the operation learns which Stripe refund it is.
  await recordAcceptedRefund({ operationId, refund });

  switch (refund.status) {
    case "succeeded": {
      const outcome = await recordCompletedRefund({
        operationId,
        refundId: refund.id,
        amountCents: refund.amount,
        refundedOn: utcCalendarDate(refund.created),
      });
      if (outcome.kind === "refused") {
        return { status: "ignored", reason: outcome.reason };
      }
      return {
        status: "done",
        reason: outcome.kind === "already_posted" ? "already posted by an earlier delivery of this refund" : undefined,
      };
    }
    case "failed":
    case "canceled": {
      // NO journal entry: the customer is still owed the money, so refund_payable stays open
      // and the policy page asks staff to re-issue (design re-review finding R-01).
      const outcome = await recordFailedRefund({
        operationId,
        refundId: refund.id,
        reason: refund.failure_reason ?? `Stripe reported the refund as ${refund.status}`,
      });
      return outcome.kind === "refused"
        ? { status: "ignored", reason: outcome.reason }
        : { status: "done", reason: `refund ${refund.status}: nothing posted, the refund is still owed` };
    }
    default:
      // pending, requires_action, or a status we do not know: recorded, not journaled.
      return { status: "done", reason: `refund status ${refund.status ?? "unknown"}: recorded, no money posted yet` };
  }
}

// charge.refunded says a charge now carries a refund. It moves no money that the refund events
// have not already described (Stripe's own documentation points to refund.created for the
// refund itself), so it posts nothing and is kept as a confirmation in the inbox.
async function handleChargeRefunded(charge: Stripe.Charge): Promise<ProcessingOutcome> {
  const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntentId) {
    return { status: "ignored", reason: "charge.refunded carries no payment intent" };
  }
  const [known] = await sql<{ refund_operation_id: string }[]>`
    select refund_operation_id from refund_allocations where payment_intent_id = ${paymentIntentId} limit 1
  `;
  if (!known) {
    return { status: "ignored", reason: `no refund of ours on payment ${paymentIntentId}` };
  }
  return {
    status: "done",
    reason: `confirmation only: the money is posted from the refund events, not from charge.refunded`,
  };
}

// Provider payloads are untrusted input. An operation id we did not write cannot be a uuid we
// generated, and passing anything else to Postgres would raise instead of being ignored.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readOperationId(metadata: Stripe.Metadata | Record<string, string | null> | null): string | null {
  const candidate = metadata?.operation_id;
  return typeof candidate === "string" && UUID.test(candidate) ? candidate : null;
}

// Stripe timestamps are seconds since 1970 in UTC; the ledger dates money on the UTC day it
// moved, which is what a US insurer's books and Stripe's own reports agree on.
function utcCalendarDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}
