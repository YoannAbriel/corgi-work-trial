// LOCAL DEVELOPMENT TOOL. It is NOT a provider integration and it is never used as evidence
// that Stripe sent anything: it builds a Stripe-shaped event, signs it with the LOCAL webhook
// secret, and posts it to a LOCAL server, so that the webhook handler can be exercised without
// a browser paying on the hosted Checkout page. Real evidence comes from Stripe's own
// deliveries to the deployed URL, in the Stripe dashboard's webhook log.
//
// It refuses to post anywhere but localhost.
//
// Usage:
//   npx tsx scripts/post-local-webhook.ts --operation=<uuid> --amount=<cents> \
//        [--type=payment_intent.succeeded] [--url=http://localhost:3000/api/webhooks/stripe] [--times=2]
//
//   A refund event needs the refund and the payment it belongs to:
//   npx tsx scripts/post-local-webhook.ts --type=refund.updated --operation=<uuid> --amount=<cents> \
//        --refund-id=re_local_1 --payment-intent=pi_local_1 [--status=succeeded|failed]

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on the environment
}

function argument(name: string, fallback?: string): string {
  const found = process.argv.find((value) => value.startsWith(`--${name}=`));
  const value = found ? found.slice(name.length + 3) : fallback;
  if (value === undefined) {
    console.error(`--${name}= is required`);
    process.exit(1);
  }
  return value;
}

async function main() {
  // Imported after the environment file is read: the module checks the key prefix on load.
  const { stripe } = await import("@/lib/stripe");

  const operationId = argument("operation");
  const amountCents = Number(argument("amount"));
  const eventType = argument("type", "payment_intent.succeeded");
  const url = argument("url", "http://localhost:3000/api/webhooks/stripe");
  const times = Number(argument("times", "2"));

  const target = new URL(url);
  if (target.hostname !== "localhost" && target.hostname !== "127.0.0.1") {
    console.error(`refusing to post a locally signed event to ${target.hostname}: this tool is for localhost only`);
    process.exit(1);
  }

  const signingSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signingSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set");
    process.exit(1);
  }

  const createdUnixSeconds = Math.floor(Date.now() / 1000);
  // Which object the event carries. A refund event carries a Refund, a payment event carries a
  // PaymentIntent; the handler branches on the object, so the tool has to build the right one.
  const isRefundEvent = eventType.startsWith("refund.");
  const isCheckoutSessionEvent = eventType.startsWith("checkout.session.");
  const refundStatus = argument("status", eventType === "refund.failed" ? "failed" : "succeeded");
  const eventObject = isCheckoutSessionEvent
    ? {
        id: argument("session-id", `cs_local_${operationId.slice(0, 8)}`),
        object: "checkout.session",
        amount_total: amountCents,
        currency: "usd",
        created: createdUnixSeconds,
        livemode: false,
        status: eventType === "checkout.session.expired" ? "expired" : "complete",
        payment_status: eventType === "checkout.session.expired" ? "unpaid" : "paid",
        client_reference_id: operationId,
        metadata: { operation_id: operationId },
      }
    : isRefundEvent
    ? {
        id: argument("refund-id", `re_local_${operationId.slice(0, 8)}`),
        object: "refund",
        amount: amountCents,
        currency: "usd",
        created: createdUnixSeconds,
        livemode: false,
        status: refundStatus,
        failure_reason: refundStatus === "failed" ? "expired_or_canceled_card" : null,
        payment_intent: argument("payment-intent", `pi_local_${operationId.slice(0, 8)}`),
        metadata: { operation_id: operationId },
      }
    : {
        id: `pi_local_${operationId.slice(0, 8)}`,
        object: "payment_intent",
        amount: amountCents,
        amount_received: eventType === "payment_intent.succeeded" ? amountCents : 0,
        currency: "usd",
        created: createdUnixSeconds,
        livemode: false,
        status: eventType === "payment_intent.succeeded" ? "succeeded" : "requires_payment_method",
        last_payment_error: eventType === "payment_intent.succeeded" ? null : { message: "Your card was declined." },
        metadata: { operation_id: operationId },
      };
  // --tag changes only the event id, so the same payment can be delivered as a SECOND,
  // different Stripe event. That is the case the journal's unique index has to refuse: two
  // events, one collection, one posting.
  const tag = argument("tag", "1");
  const event = {
    id: `evt_local_${operationId.slice(0, 8)}_${eventType.replace(/\./g, "_")}_${tag}`,
    object: "event",
    api_version: "2025-01-01",
    created: createdUnixSeconds,
    livemode: false,
    type: eventType,
    data: { object: eventObject },
  };

  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: signingSecret });

  for (let attempt = 1; attempt <= times; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      body: payload,
    });
    console.log(`delivery ${attempt}: HTTP ${response.status} ${await response.text()}`);
  }
}

main().catch((error) => {
  console.error("failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
