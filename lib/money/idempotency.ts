// Idempotency keys for outbound provider calls.
//
// The key is derived from the business intent, never generated randomly, so that a retry after
// a timeout, a double-clicked button or a restarted process sends the SAME key. Stripe then
// returns the object it created the first time instead of charging the customer twice
// (https://docs.stripe.com/api/idempotent_requests). The same string is stored on the
// money_operations row under a unique constraint, so our own database refuses a second intent
// for the same policy even if Stripe's key retention window has expired.

// THE RULE FOR BOTH KEYS BELOW: one money operation, one key, forever. Retrying an operation
// reuses its key, which is what makes a retry safe. A new operation always gets a new key,
// which is what makes a second attempt possible after the first one died for good. A key is
// therefore derived from the intent AND from the attempt number, never reused across
// operations and never generated at random.

// One Checkout Session per attempt to pay a policy. Clicking Pay again while the hosted page is
// still alive reuses attempt 1 and its session; Stripe returns the session it already created
// instead of opening a second one.
//
// A later attempt exists for one reason: the previous session can no longer be paid. A Checkout
// Session expires (Stripe sends checkout.session.expired), or the creation call failed and no
// session was ever opened. Reusing the key then would make Stripe hand back the dead session
// forever, so the new attempt is a new operation with its own key. The attempt number is the
// count of operations already made for this policy, so it is derived, not random.
export function checkoutIdempotencyKey(policyId: string, attempt = 1): string {
  if (!policyId) {
    throw new Error("policyId is required to derive a checkout idempotency key");
  }
  assertAttempt(attempt);
  const key = `policy-checkout:${policyId}`;
  return attempt === 1 ? key : `${key}:${attempt}`;
}

// One Checkout Session per attempt to collect an endorsement's delta (slice B4). Keyed on the
// 'endorsement_requested' policy event, not on the policy: a policy can be endorsed several
// times and each quote is its own intent. Same attempt rule as the policy checkout above: a
// dead hosted page (expired, or never opened) gives the next attempt a new operation and key.
export function endorsementCheckoutIdempotencyKey(requestEventId: string, attempt = 1): string {
  if (!requestEventId) {
    throw new Error("requestEventId is required to derive an endorsement checkout idempotency key");
  }
  assertAttempt(attempt);
  const key = `endorsement-checkout:${requestEventId}`;
  return attempt === 1 ? key : `${key}:${attempt}`;
}

function assertAttempt(attempt: number): void {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`an attempt must be a whole number starting at 1, got ${attempt}`);
  }
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
  assertAttempt(attempt);
  const key = `policy-refund:${policyId}:${paymentIntentId}`;
  return attempt === 1 ? key : `${key}:${attempt}`;
}
