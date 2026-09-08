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
