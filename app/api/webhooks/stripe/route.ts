import type Stripe from "stripe";
import { sql } from "@/db/client";
import { stripe, stripeWebhookSigningSecret } from "@/lib/stripe";

// POST /api/webhooks/stripe
//
// 1. Verify the signature on the raw body. Anything unsigned is rejected before touching the database.
// 2. Refuse live-mode events (AF-04): this trial only ever processes test-mode money.
// 3. Store the event once, immutably (unique on provider + event id). A second delivery of the
//    same event finds the row already there and continues to step 4 instead of being lost.
// 4. Take a processing lease: only one delivery at a time can move the event from pending or
//    failed to processing. Concurrent duplicates get no lease and are answered 200.
// 5. Process. Until slice B2 adds business handlers, every event type is recorded as ignored,
//    with the reason, so nothing is silently dropped.
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

  const webhookEventId = await storeEventOnce(event);
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
async function storeEventOnce(event: Stripe.Event): Promise<string> {
  const [existing] = await sql<{ id: string }[]>`
    select id from webhook_events where provider = 'stripe' and provider_event_id = ${event.id}
  `;
  if (existing) {
    return existing.id;
  }
  return sql.begin(async (transaction) => {
    const [inserted] = await transaction<{ id: string }[]>`
      insert into webhook_events (provider, provider_event_id, event_type, livemode, payload, signature_verified)
      values ('stripe', ${event.id}, ${event.type}, ${event.livemode}, ${JSON.stringify(event)}::jsonb, true)
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

// Business handlers arrive with slice B2 (payments) and B3 (KYB). Until then every event is
// kept and marked ignored with the reason, which the failed-events view will show.
async function processStripeEvent(event: Stripe.Event): Promise<ProcessingOutcome> {
  return { status: "ignored", reason: `no handler yet for ${event.type}` };
}
