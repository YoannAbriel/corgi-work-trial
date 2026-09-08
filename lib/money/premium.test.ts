import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commissionCents,
  earnedPremiumCents,
  endorsementDeltaCents,
  proRataCancellationRefund,
  refundedTaxCents,
  stateTaxCents,
  unearnedPremiumCents,
} from "./premium";

// The shared worked example: $1,200 written premium, cancelled on day 100.
const WRITTEN = 120000;

test("earned and unearned premium on a 366-day term, day 100 (January 1 policy)", () => {
  // 2028-01-01 to 2029-01-01 contains February 29, 2028: 366 days. Day 100 is 2028-04-10.
  // 120000 x 100 / 366 = 32786.885... earned, rounded down; the customer keeps the fraction.
  assert.equal(earnedPremiumCents(WRITTEN, "2028-01-01", "2029-01-01", "2028-04-10"), 32786);
  assert.equal(unearnedPremiumCents(WRITTEN, "2028-01-01", "2029-01-01", "2028-04-10"), 87214);
});

test("earned and unearned premium on a 365-day term, day 100 (March 1 start)", () => {
  // 2028-03-01 to 2029-03-01 has 365 days. Day 100 is 2028-06-09.
  // 120000 x 100 / 365 = 32876.71... -> 32876 earned, 87124 unearned.
  assert.equal(earnedPremiumCents(WRITTEN, "2028-03-01", "2029-03-01", "2028-06-09"), 32876);
  assert.equal(unearnedPremiumCents(WRITTEN, "2028-03-01", "2029-03-01", "2028-06-09"), 87124);
});

test("nothing is earned before the term and everything after it", () => {
  assert.equal(earnedPremiumCents(WRITTEN, "2028-01-01", "2029-01-01", "2027-12-31"), 0);
  assert.equal(earnedPremiumCents(WRITTEN, "2028-01-01", "2029-01-01", "2028-01-01"), 0);
  assert.equal(earnedPremiumCents(WRITTEN, "2028-01-01", "2029-01-01", "2029-01-01"), WRITTEN);
  assert.equal(earnedPremiumCents(WRITTEN, "2028-01-01", "2029-01-01", "2030-06-01"), WRITTEN);
});

test("earned plus unearned always equals written, on every day of the term", () => {
  for (let day = 0; day <= 366; day += 1) {
    const asOf = new Date(Date.UTC(2028, 0, 1 + day)).toISOString().slice(0, 10);
    const earned = earnedPremiumCents(WRITTEN, "2028-01-01", "2029-01-01", asOf);
    const unearned = unearnedPremiumCents(WRITTEN, "2028-01-01", "2029-01-01", asOf);
    assert.equal(earned + unearned, WRITTEN, `day ${day}`);
  }
});

test("endorsement delta is priced over the remaining days from the effective date", () => {
  // Annual premium raised from $1,200 to $1,800 on day 100 of the 366-day term: 266 days remain.
  // 60000 x 266 / 366 = 43606.55... -> 43606 charged (customer pays, rounded down).
  assert.equal(endorsementDeltaCents(120000, 180000, "2028-01-01", "2029-01-01", "2028-04-10"), 43606);
  // Backdating the same change by 30 days changes the maths, not just a label: 296 days remain.
  // 60000 x 296 / 366 = 48524.59... -> 48524.
  assert.equal(endorsementDeltaCents(120000, 180000, "2028-01-01", "2029-01-01", "2028-03-11"), 48524);
  // Lowering the premium credits the customer, rounded up: 43607 back.
  assert.equal(endorsementDeltaCents(180000, 120000, "2028-01-01", "2029-01-01", "2028-04-10"), -43607);
  // An endorsement effective on the last day of the term changes nothing.
  assert.equal(endorsementDeltaCents(120000, 180000, "2028-01-01", "2029-01-01", "2029-01-01"), 0);
});

test("state tax is rounded down when charged and rounded up when refunded", () => {
  assert.equal(stateTaxCents(120000, 300), 3600); // 3% of $1,200
  assert.equal(stateTaxCents(87214, 300), 2616); // 2616.42 charged would be 2616
  assert.equal(refundedTaxCents(87214, 300), 2617); // but refunded it is 2617
});

test("commission on collected premium is rounded down", () => {
  assert.equal(commissionCents(120000, 1500), 18000); // 15% of $1,200
  assert.equal(commissionCents(87214, 1500), 13082); // 13082.1 -> 13082
});

test("pro-rata cancellation refund: unearned premium, its tax, never the fee", () => {
  const refund = proRataCancellationRefund(WRITTEN, 300, "2028-01-01", "2029-01-01", "2028-04-10");
  assert.deepEqual(refund, {
    unearnedPremiumCents: 87214,
    refundedTaxCents: 2617,
    refundedFeeCents: 0,
    totalRefundCents: 89831, // $898.31
  });
});

test("inputs must be non-negative integer cents", () => {
  assert.throws(() => earnedPremiumCents(1200.5, "2028-01-01", "2029-01-01", "2028-04-10"), /integer number of cents/);
  assert.throws(() => stateTaxCents(-1, 300), /integer number of cents/);
});

test("the recited example: March 1, 2028 policy, 365 days, cancelled on day 100 (June 9)", () => {
  // Decided by Yoann on 2026-09-08 (DECISIONS.md): this is the example told at the debrief.
  // Written $1,200, 3% tax, cancelled on day 100 of 365. Earned 32876, unearned 87124,
  // tax refunded ceil(87124 x 3%) = 2614, fee never refunded: total $897.38.
  assert.deepEqual(proRataCancellationRefund(WRITTEN, 300, "2028-03-01", "2029-03-01", "2028-06-09"), {
    unearnedPremiumCents: 87124,
    refundedTaxCents: 2614,
    refundedFeeCents: 0,
    totalRefundCents: 89738,
  });
  // Endorsement +$600 annual on day 100: 265 days remain, 60000 x 265 / 365 = 43561.64 -> 43561.
  assert.equal(endorsementDeltaCents(120000, 180000, "2028-03-01", "2029-03-01", "2028-06-09"), 43561);
  // The same change backdated 30 days (295 days remain): 48493.15 -> 48493.
  assert.equal(endorsementDeltaCents(120000, 180000, "2028-03-01", "2029-03-01", "2028-05-10"), 48493);
  // Lowering by $600 on day 100 credits the customer 43562 (rounded up).
  assert.equal(endorsementDeltaCents(180000, 120000, "2028-03-01", "2029-03-01", "2028-06-09"), -43562);
  // Commission on the $1,200 collected: 18000. On the refunded 87124, the base is 13068.6, rounded down to 13068 (decided).
  assert.equal(commissionCents(120000, 1500), 18000);
});

test("California premium tax at 2.35% on the recited example", () => {
  // Decided by Yoann on 2026-09-08: California, 235 basis points (Cal. Const. art. XIII s. 28(d)).
  assert.equal(stateTaxCents(120000, 235), 2820); // $28.20 charged with the $1,200 premium
  assert.equal(refundedTaxCents(87124, 235), 2048); // 2047.41 -> 2048 refunded on cancellation
  assert.deepEqual(proRataCancellationRefund(WRITTEN, 235, "2028-03-01", "2029-03-01", "2028-06-09"), {
    unearnedPremiumCents: 87124,
    refundedTaxCents: 2048,
    refundedFeeCents: 0,
    totalRefundCents: 89172, // $891.72
  });
});
