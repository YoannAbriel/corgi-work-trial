import Stripe from "stripe";

// One Stripe client for the whole application, test mode only (AF-04).
// The key prefix is checked here so a live key can never be used by mistake, on any path:
// routes, jobs, seed and MCP all import this module.
const secretKey = process.env.STRIPE_SECRET_KEY;
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

if (!secretKey && !isBuildPhase) {
  throw new Error("STRIPE_SECRET_KEY must be set");
}
if (secretKey && !secretKey.startsWith("sk_test_")) {
  throw new Error("STRIPE_SECRET_KEY must be a test-mode key (sk_test_...); live keys are forbidden in this trial");
}

export const stripe = new Stripe(secretKey ?? "sk_test_build_phase_placeholder");

// AF-04, outbound side. The key prefix above is our own reading of the key; this is Stripe's
// own statement about the mode it answers in. It runs once per process, before the first
// request that could move money, and it fails closed: if the call itself fails, the money
// operation is not sent and the failure is recorded.
let sandboxCheck: Promise<void> | null = null;

export async function assertStripeSandbox(): Promise<void> {
  if (!sandboxCheck) {
    sandboxCheck = stripe.balance.retrieve().then((balance) => {
      if (balance.livemode) {
        throw new Error("Stripe answered in live mode: this trial only sends test-mode requests");
      }
    });
  }
  try {
    await sandboxCheck;
  } catch (error) {
    // Do not keep a failed check cached: a network error must not disable the guard for the
    // life of the process, and a live-mode answer will simply fail again on the next attempt.
    sandboxCheck = null;
    throw error;
  }
}

// Signing secrets of the webhook endpoints for the current environment. The account endpoint
// (STRIPE_WEBHOOK_SECRET: payments, refunds; locally the `stripe listen` secret) is required.
// The Connect endpoint (STRIPE_CONNECT_WEBHOOK_SECRET: account.updated of connected accounts)
// is optional locally and required in production for broker KYB events.
export function stripeWebhookSigningSecrets(): string[] {
  const accountSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!accountSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET must be set");
  }
  const connectSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  return connectSecret ? [accountSecret, connectSecret] : [accountSecret];
}
