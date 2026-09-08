import { test } from "node:test";
import assert from "node:assert/strict";
import { claimPaymentRefusal, type ClaimPaymentLimitsInput } from "./limits";

// A claim on a policy with a $100,000 per-occurrence limit and a $200,000 aggregate limit,
// holding a $5,000 reserve and nothing paid or pending yet.
const CLAIM: ClaimPaymentLimitsInput = {
  amountCents: 120000,
  reserveCents: 500000,
  claimPendingCents: 0,
  claimPaidCents: 0,
  perOccurrenceLimitCents: 10000000,
  policyCommittedCents: 0,
  aggregateLimitCents: 20000000,
};

test("a payment inside the reserve and both limits is allowed", () => {
  assert.equal(claimPaymentRefusal(CLAIM), null);
});

test("a payment for exactly the reserve is allowed: the ceiling is inclusive", () => {
  assert.equal(claimPaymentRefusal({ ...CLAIM, amountCents: 500000 }), null);
});

test("a payment of one cent more than the reserve is refused, and says to raise it first", () => {
  const refusal = claimPaymentRefusal({ ...CLAIM, amountCents: 500001 });
  assert.match(String(refusal), /more than the 500000 cents left in the reserve/);
  assert.match(String(refusal), /raise the reserve first/);
});

test("a payment already asked for takes its share of the reserve, so the next one is refused", () => {
  // $5,000 of reserve, $4,000 already requested and not sent: only $1,000 is left.
  const refusal = claimPaymentRefusal({ ...CLAIM, amountCents: 200000, claimPendingCents: 400000 });
  assert.match(String(refusal), /more than the 100000 cents left in the reserve/);
});

test("the per-occurrence limit stops a payment even when the reserve would allow it", () => {
  const refusal = claimPaymentRefusal({
    ...CLAIM,
    amountCents: 500000,
    reserveCents: 500000,
    claimPaidCents: 9600000, // $96,000 already paid on this claim
    perOccurrenceLimitCents: 10000000, // $100,000
  });
  assert.match(String(refusal), /past the per-occurrence limit of 10000000 cents/);
});

test("a payment for exactly what is left of the per-occurrence limit is allowed", () => {
  assert.equal(
    claimPaymentRefusal({
      ...CLAIM,
      amountCents: 400000,
      reserveCents: 500000,
      claimPaidCents: 9600000,
      perOccurrenceLimitCents: 10000000,
      policyCommittedCents: 9600000,
    }),
    null,
  );
});

test("the aggregate limit stops a payment that every other ceiling would allow", () => {
  const refusal = claimPaymentRefusal({
    ...CLAIM,
    amountCents: 500000,
    reserveCents: 500000,
    claimPaidCents: 0,
    perOccurrenceLimitCents: 10000000,
    // $19,800,000 already paid across the other claims of this policy, aggregate $20,000,000.
    policyCommittedCents: 19800000,
    aggregateLimitCents: 20000000,
  });
  assert.match(String(refusal), /past the aggregate limit of 20000000 cents across all its claims/);
});

test("the reserve is checked before the limits, so the message names the thing to fix first", () => {
  const refusal = claimPaymentRefusal({
    ...CLAIM,
    amountCents: 30000000, // past everything
    reserveCents: 500000,
  });
  assert.match(String(refusal), /left in the reserve/);
});

test("an amount that is not a positive whole number of cents is refused", () => {
  assert.match(String(claimPaymentRefusal({ ...CLAIM, amountCents: 0 })), /positive amount/);
  assert.match(String(claimPaymentRefusal({ ...CLAIM, amountCents: -100 })), /positive amount/);
  assert.match(String(claimPaymentRefusal({ ...CLAIM, amountCents: 12.5 })), /positive amount/);
});
