// Idempotency keys for outbound provider calls.
//
// The key is derived from the business intent, never generated randomly, so that a retry after
// a timeout, a double-clicked button or a restarted process sends the SAME key. Stripe then
// returns the object it created the first time instead of charging the customer twice
// (https://docs.stripe.com/api/idempotent_requests). The same string is stored on the
// money_operations row under a unique constraint, so our own database refuses a second intent
// for the same policy even if Stripe's key retention window has expired.

// One Checkout Session per policy draft. Paying the same draft again reuses this key and the
// existing operation; a deliberate second payment would be a different intent, and would need
// its own key derived from that intent.
export function checkoutIdempotencyKey(policyId: string): string {
  if (!policyId) {
    throw new Error("policyId is required to derive a checkout idempotency key");
  }
  return `policy-checkout:${policyId}`;
}

// One Stripe refund per policy and per PaymentIntent given back. A cancellation retried after a
// timeout reuses this key, so Stripe returns the refund it already created instead of sending
// the money twice.
//
// `attempt` is the exception, and it is deliberate: when a refund FAILS at the customer's bank
// the money never left, the liability stays open, and staff re-issue a new refund. That is a
// new intent, so it needs a new key; reusing the first one would make Stripe hand back the
// failed refund forever. The attempt number comes from how many refund operations already
// exist for this policy and PaymentIntent, so it is still derived, never random.
export function refundIdempotencyKey(policyId: string, paymentIntentId: string, attempt = 1): string {
  if (!policyId || !paymentIntentId) {
    throw new Error("policyId and paymentIntentId are required to derive a refund idempotency key");
  }
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`refund attempt must be a whole number starting at 1, got ${attempt}`);
  }
  const key = `policy-refund:${policyId}:${paymentIntentId}`;
  return attempt === 1 ? key : `${key}:attempt-${attempt}`;
}
