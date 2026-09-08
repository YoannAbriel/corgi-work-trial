import { test } from "node:test";
import assert from "node:assert/strict";
import { computePolicyCharge, FLAT_POLICY_FEE_CENTS } from "./charge";

// The recited example, decided by Yoann on 2026-09-08: $1,200 annual premium in California.
test("the recited charge: $1,200 premium, California 2.35%, $25 fee", () => {
  const charge = computePolicyCharge(120000, 235);
  // 120000 x 235 / 10000 = 2820 exactly.
  assert.equal(charge.taxCents, 2820);
  assert.equal(charge.feeCents, 2500);
  assert.equal(charge.totalChargeCents, 125320);
  // The three parts always add up to what the customer is charged.
  assert.equal(charge.annualPremiumCents + charge.taxCents + charge.feeCents, charge.totalChargeCents);
});

test("the illustrative 3% example of ARCHITECTURE.md section 3 still computes as written", () => {
  const charge = computePolicyCharge(120000, 300);
  assert.equal(charge.taxCents, 3600);
  assert.equal(charge.totalChargeCents, 126100);
});

test("the tax is rounded down, so the insurer eats the fraction of a cent", () => {
  // 100050 x 235 / 10000 = 2351.175 -> 2351 cents charged, not 2352.
  const charge = computePolicyCharge(100050, 235);
  assert.equal(charge.taxCents, 2351);
  assert.equal(charge.totalChargeCents, 100050 + 2351 + FLAT_POLICY_FEE_CENTS);
});

test("a premium that is not a positive whole number of cents is refused", () => {
  assert.throws(() => computePolicyCharge(0, 235), /positive integer/);
  assert.throws(() => computePolicyCharge(-1, 235), /positive integer/);
  assert.throws(() => computePolicyCharge(1200.5, 235), /positive integer/);
});
