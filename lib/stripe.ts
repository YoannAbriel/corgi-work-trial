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

// Signing secret of the webhook endpoint for the current environment
// (production: the endpoint registered on the deployed URL; local: the `stripe listen` secret).
export function stripeWebhookSigningSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET must be set");
  }
  return secret;
}
