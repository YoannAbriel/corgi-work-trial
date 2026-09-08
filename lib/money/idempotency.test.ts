import { test } from "node:test";
import assert from "node:assert/strict";
import { checkoutIdempotencyKey } from "./idempotency";

const POLICY = "22222222-2222-4222-8222-222222222222";

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
