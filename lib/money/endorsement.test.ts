import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeEndorsement,
  CUSTOMER_APPROVAL_THRESHOLD_CENTS,
  endorsementFormulaLines,
  endorsementQuoteHash,
  EndorsementNotComputable,
  type EndorsementInput,
} from "./endorsement";

// The recited example (DECISIONS.md, decided by Yoann): $1,200 written 2028-03-01, 365-day
// term, California 2.35% (2820 cents charged at issuance), 15% commission.
const RECITED: EndorsementInput = {
  policyId: "22222222-2222-4222-8222-222222222222",
  policyVersion: 2, // quoted + issued
  termStart: "2028-03-01",
  termEnd: "2029-03-01",
  effectiveAt: "2028-06-09", // day 100, 265 days remain
  oldAnnualPremiumCents: 120000,
  newAnnualPremiumCents: 180000,
  taxRateBps: 235,
  taxChargedSoFarCents: 2820,
  commissionRateBps: 1500,
};

test("the recited example: raising to $1,800 on day 100 charges 43561 cents of premium", () => {
  const figures = computeEndorsement(RECITED);
  assert.equal(figures.termDays, 365);
  assert.equal(figures.daysRemaining, 265);
  assert.equal(figures.annualDifferenceCents, 60000);
  assert.equal(figures.deltaPremiumCents, 43561); // floor(60000 x 265 / 365) = 43561.64
  assert.equal(figures.deltaTaxCents, 1023); // floor(43561 x 235 / 10000) = 1023.68
  assert.equal(figures.deltaFeeCents, 0);
  assert.equal(figures.deltaTotalCents, 44584);
  assert.equal(figures.commissionDeltaCents, 6534); // floor(43561 x 1500 / 10000) = 6534.15
  assert.equal(figures.direction, "charge");
  assert.equal(figures.customerApprovalRequired, false); // 44584 is below the $500 threshold
});

test("the same endorsement backdated 30 days charges 48493 cents: the money follows the date", () => {
  const figures = computeEndorsement({ ...RECITED, effectiveAt: "2028-05-10" });
  assert.equal(figures.daysRemaining, 295);
  assert.equal(figures.deltaPremiumCents, 48493); // floor(60000 x 295 / 365) = 48493.15
  assert.equal(figures.deltaTaxCents, 1139); // floor(48493 x 235 / 10000) = 1139.58
  assert.equal(figures.deltaTotalCents, 49632);
});

test("the recited example: lowering to $600 on day 100 refunds 43562 cents (rounded up)", () => {
  const figures = computeEndorsement({ ...RECITED, newAnnualPremiumCents: 60000 });
  assert.equal(figures.annualDifferenceCents, -60000);
  assert.equal(figures.deltaPremiumCents, -43562); // ceil(60000 x 265 / 365) = 43561.64 -> 43562
  assert.equal(figures.deltaTaxCents, -1024); // ceil(43562 x 235 / 10000) = 1023.71 -> 1024, below 2820
  assert.equal(figures.taxRefundWasCappedAtCharged, false);
  assert.equal(figures.deltaTotalCents, -44586);
  assert.equal(figures.commissionDeltaCents, -6534); // floor(43562 x 1500 / 10000) = 6534.3
  assert.equal(figures.direction, "refund");
  assert.equal(figures.customerApprovalRequired, false); // a refund never needs approval
});

test("the refunded tax is capped at the tax charged so far on the policy", () => {
  // Only 1000 cents of tax were ever charged (say most of it was already refunded): the
  // ceiling of 1024 would give back 24 cents the state never received from this policy.
  const figures = computeEndorsement({ ...RECITED, newAnnualPremiumCents: 60000, taxChargedSoFarCents: 1000 });
  assert.equal(figures.deltaTaxCents, -1000);
  assert.equal(figures.taxRefundWasCappedAtCharged, true);
  assert.equal(figures.deltaTotalCents, -44562);
});

test("customer approval is required above $500 of premium plus tax, not at $500", () => {
  // +$1,200 annual on day 100: floor(120000 x 265 / 365) = 87123, tax floor(87123 x 2.35%) = 2047.
  const large = computeEndorsement({ ...RECITED, newAnnualPremiumCents: 240000 });
  assert.equal(large.deltaPremiumCents, 87123);
  assert.equal(large.deltaTaxCents, 2047);
  assert.equal(large.deltaTotalCents, 89170);
  assert.equal(large.customerApprovalRequired, true);

  // Exactly at the threshold: a $500.00 total does not need approval; one cent more does.
  assert.equal(CUSTOMER_APPROVAL_THRESHOLD_CENTS, 50000);
  const atThreshold = computeEndorsement({
    ...RECITED,
    termStart: "2028-03-01",
    termEnd: "2029-03-01",
    effectiveAt: "2028-03-01", // the whole term remains: delta = annual difference
    taxRateBps: 0,
    newAnnualPremiumCents: 120000 + 50000,
  });
  assert.equal(atThreshold.deltaTotalCents, 50000);
  assert.equal(atThreshold.customerApprovalRequired, false);
  const oneCentAbove = computeEndorsement({ ...atThreshold, newAnnualPremiumCents: 120000 + 50001, effectiveAt: "2028-03-01", taxRateBps: 0 });
  assert.equal(oneCentAbove.deltaTotalCents, 50001);
  assert.equal(oneCentAbove.customerApprovalRequired, true);
});

test("day boundaries: the first day prices the whole difference, the last day prices nothing", () => {
  const firstDay = computeEndorsement({ ...RECITED, effectiveAt: "2028-03-01" });
  assert.equal(firstDay.daysRemaining, 365);
  assert.equal(firstDay.deltaPremiumCents, 60000);

  const lastDay = computeEndorsement({ ...RECITED, effectiveAt: "2029-03-01" });
  assert.equal(lastDay.daysRemaining, 0);
  assert.equal(lastDay.deltaPremiumCents, 0);
  assert.equal(lastDay.deltaTaxCents, 0);
  assert.equal(lastDay.direction, "none");
  assert.equal(lastDay.customerApprovalRequired, false);

  const dayBefore = computeEndorsement({ ...RECITED, effectiveAt: "2029-02-28" });
  assert.equal(dayBefore.daysRemaining, 1);
  assert.equal(dayBefore.deltaPremiumCents, 164); // floor(60000 x 1 / 365) = 164.38
});

test("outside the term the endorsement is refused, not priced at zero", () => {
  assert.throws(
    () => computeEndorsement({ ...RECITED, effectiveAt: "2028-02-29" }),
    (error: unknown) => error instanceof EndorsementNotComputable && /before the policy starts/.test(error.message),
  );
  assert.throws(
    () => computeEndorsement({ ...RECITED, effectiveAt: "2029-03-02" }),
    (error: unknown) => error instanceof EndorsementNotComputable && /ends on 2029-03-01/.test(error.message),
  );
  assert.throws(() => computeEndorsement({ ...RECITED, effectiveAt: "2028-06-31" }), /not a real calendar date/);
});

test("a leap-year term counts 366 days (January 1, 2028 policy)", () => {
  const leap = computeEndorsement({
    ...RECITED,
    termStart: "2028-01-01",
    termEnd: "2029-01-01",
    effectiveAt: "2028-04-10", // day 100, 266 remain
  });
  assert.equal(leap.termDays, 366);
  assert.equal(leap.daysRemaining, 266);
  assert.equal(leap.deltaPremiumCents, 43606); // floor(60000 x 266 / 366) = 43606.55
  // Lowering by the same amount on the same day refunds one cent more: ceil(43606.55) = 43607.
  const leapRefund = computeEndorsement({
    ...RECITED,
    termStart: "2028-01-01",
    termEnd: "2029-01-01",
    effectiveAt: "2028-04-10",
    newAnnualPremiumCents: 60000,
  });
  assert.equal(leapRefund.deltaPremiumCents, -43607);
});

test("the same premium moves nothing: a limit-only endorsement has no money", () => {
  const figures = computeEndorsement({ ...RECITED, newAnnualPremiumCents: 120000 });
  assert.equal(figures.direction, "none");
  assert.equal(figures.deltaTotalCents, 0);
  assert.equal(figures.commissionDeltaCents, 0);
});

test("the quote hash changes with every one of its six inputs and with nothing else", () => {
  const base = computeEndorsement(RECITED).quoteHash;
  assert.equal(computeEndorsement(RECITED).quoteHash, base); // deterministic
  assert.equal(base.length, 64);
  // A second endorsement request moves the policy version, so an old quote is stale.
  assert.notEqual(computeEndorsement({ ...RECITED, policyVersion: 3 }).quoteHash, base);
  assert.notEqual(computeEndorsement({ ...RECITED, effectiveAt: "2028-06-10" }).quoteHash, base);
  assert.notEqual(computeEndorsement({ ...RECITED, newAnnualPremiumCents: 180001 }).quoteHash, base);
  assert.notEqual(computeEndorsement({ ...RECITED, policyId: "33333333-3333-4333-8333-333333333333" }).quoteHash, base);
  // The rate and the commission are not in the hash, but they change the delta tax, which is.
  assert.notEqual(computeEndorsement({ ...RECITED, taxRateBps: 300 }).quoteHash, base);
  assert.equal(computeEndorsement({ ...RECITED, commissionRateBps: 1000 }).quoteHash, base);
  // The hash function itself, with the recited figures.
  assert.equal(
    endorsementQuoteHash({
      policyId: RECITED.policyId,
      policyVersion: 2,
      effectiveAt: "2028-06-09",
      newAnnualPremiumCents: 180000,
      deltaPremiumCents: 43561,
      deltaTaxCents: 1023,
    }),
    base,
  );
});

test("the formula lines say exactly how each cent was computed", () => {
  const charge = endorsementFormulaLines(computeEndorsement(RECITED));
  assert.deepEqual(
    charge.map((line) => [line.key, line.formula, line.cents]),
    [
      ["annual_difference", "180000 - 120000", 60000],
      ["delta_premium", "floor(60000 x 265 / 365)", 43561],
      ["delta_tax", "floor(43561 x 235 / 10000)", 1023],
      ["delta_fee", "0", 0],
      ["delta_total", "43561 + 1023", 44584],
      ["commission", "floor(43561 x 1500 / 10000)", 6534],
    ],
  );

  const refund = endorsementFormulaLines(computeEndorsement({ ...RECITED, newAnnualPremiumCents: 60000 }));
  assert.deepEqual(
    refund.map((line) => [line.key, line.formula, line.cents]),
    [
      ["annual_difference", "60000 - 120000", -60000],
      ["delta_premium", "-ceil(60000 x 265 / 365)", -43562],
      ["delta_tax", "-ceil(43562 x 235 / 10000)", -1024],
      ["delta_fee", "0", 0],
      ["delta_total", "-43562 + -1024", -44586],
      ["commission", "-floor(43562 x 1500 / 10000)", -6534],
    ],
  );

  // The lines add up: the total line is the sum of the premium, tax and fee lines.
  for (const lines of [charge, refund]) {
    const byKey = new Map(lines.map((line) => [line.key, line.cents]));
    assert.equal(byKey.get("delta_total"), byKey.get("delta_premium")! + byKey.get("delta_tax")! + byKey.get("delta_fee")!);
  }
});

test("inputs must be non-negative integer cents", () => {
  assert.throws(() => computeEndorsement({ ...RECITED, newAnnualPremiumCents: 1800.5 }), /integer number of cents/);
  assert.throws(() => computeEndorsement({ ...RECITED, taxChargedSoFarCents: -1 }), /integer number of cents/);
});

test("the customer-approval threshold counts the requests already waiting for this customer (F-B4-09)", () => {
  // Two raises of $400 in a row on the recited policy. Priced on day 100, +$400 of annual
  // premium collects 29041 + 682 = 29723, which is under $500 on its own.
  const first = computeEndorsement({ ...RECITED, newAnnualPremiumCents: 160000 });
  assert.equal(first.deltaTotalCents, 29723);
  assert.equal(first.customerApprovalRequired, false);

  // The same quote computed while the first one is still unanswered: together they collect
  // 59446, so this one has to be approved.
  const second = computeEndorsement({
    ...RECITED,
    newAnnualPremiumCents: 160000,
    otherUnapprovedRequestedCents: first.deltaTotalCents,
  });
  assert.equal(second.deltaTotalCents, 29723);
  assert.equal(second.customerApprovalRequired, true);
});

test("a reduction never needs the customer's approval, whatever is waiting", () => {
  const reduction = computeEndorsement({ ...RECITED, newAnnualPremiumCents: 60000, otherUnapprovedRequestedCents: 90000 });
  assert.ok(reduction.deltaTotalCents < 0);
  assert.equal(reduction.customerApprovalRequired, false);
});
