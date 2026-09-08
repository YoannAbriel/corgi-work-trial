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
  const paymentIntent = {
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
    data: { object: paymentIntent },
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
