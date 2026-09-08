import { test } from "node:test";
import assert from "node:assert/strict";
import { checkoutIdempotencyKey, refundIdempotencyKey } from "./idempotency";

const POLICY = "22222222-2222-4222-8222-222222222222";
const PAYMENT_INTENT = "pi_3UDM4KK6R3v50tIy0F5xaBbu";

test("the same policy draft always produces the same key, so a retry cannot charge twice", () => {
  assert.equal(checkoutIdempotencyKey(POLICY), checkoutIdempotencyKey(POLICY));
  assert.equal(checkoutIdempotencyKey(POLICY), `policy-checkout:${POLICY}`);
});

test("two policies never share a key", () => {
  assert.notEqual(checkoutIdempotencyKey(POLICY), checkoutIdempotencyKey("44444444-4444-4444-8444-444444444444"));
});

test("the key stays inside Stripe's 255-character limit", () => {
  assert.ok(checkoutIdempotencyKey(POLICY).length <= 255);
});

test("a missing policy id is refused rather than producing a shared key", () => {
  assert.throws(() => checkoutIdempotencyKey(""), /policyId is required/);
});

test("a refund key is the policy and the payment it gives back", () => {
  assert.equal(refundIdempotencyKey(POLICY, PAYMENT_INTENT), `policy-refund:${POLICY}:${PAYMENT_INTENT}`);
  // Retrying the same cancellation reuses it: Stripe returns the refund already created.
  assert.equal(refundIdempotencyKey(POLICY, PAYMENT_INTENT), refundIdempotencyKey(POLICY, PAYMENT_INTENT, 1));
  // Two payments of the same policy are two refunds, so two keys.
  assert.notEqual(refundIdempotencyKey(POLICY, PAYMENT_INTENT), refundIdempotencyKey(POLICY, "pi_endorsement"));
  assert.ok(refundIdempotencyKey(POLICY, PAYMENT_INTENT).length <= 255);
});

test("re-issuing a failed refund is a new intent, so a new key", () => {
  assert.equal(
    refundIdempotencyKey(POLICY, PAYMENT_INTENT, 2),
    `policy-refund:${POLICY}:${PAYMENT_INTENT}:attempt-2`,
  );
  assert.notEqual(refundIdempotencyKey(POLICY, PAYMENT_INTENT, 2), refundIdempotencyKey(POLICY, PAYMENT_INTENT));
  assert.throws(() => refundIdempotencyKey(POLICY, PAYMENT_INTENT, 0), /whole number starting at 1/);
  assert.throws(() => refundIdempotencyKey(POLICY, ""), /required/);
});
