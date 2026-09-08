import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cancellationBreakdown,
  commissionCents,
  earnedPremiumAcrossSegments,
  earnedPremiumCents,
  earnedPremiumOfSegment,
  endorsementDeltaCents,
  refundedTaxCents,
  refundedTaxCentsCappedAtCharged,
  stateTaxCents,
  unearnedPremiumCents,
} from "./premium";

// The shared worked example: $1,200 written premium, cancelled on day 100.
const WRITTEN = 120000;
const COMMISSION_RATE_BPS = 1500; // 15%, the seeded broker's rate

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
  // 366-day term, 3% tax charged on the whole premium (3600), cancelled on day 100.
  assert.deepEqual(
    cancellationBreakdown({
      writtenPremiumSegments: [{ writtenPremiumCents: WRITTEN, startsOn: "2028-01-01", endsOn: "2029-01-01" }],
      taxChargedCents: 3600,
      taxRateBps: 300,
      commissionRateBps: COMMISSION_RATE_BPS,
      cancellationEffectiveAt: "2028-04-10",
    }),
    {
      termDays: 366,
      earnedDays: 100,
      writtenPremiumCents: WRITTEN,
      earnedPremiumCents: 32786,
      unearnedPremiumCents: 87214,
      refundedTaxCents: 2617,
      taxRefundWasCappedAtCharged: false,
      refundedFeeCents: 0,
      totalRefundCents: 89831, // $898.31
      commissionClawbackCents: 13082, // 87214 x 15% = 13082.1, rounded down
    },
  );
});

test("the refunded tax is capped at the tax actually charged (review finding F-B1-07)", () => {
  // Written 100001 cents at 3%: the customer paid floor(100001 x 3%) = 3000, but a cancellation
  // on the very first day would give back ceil(100001 x 3%) = 3001 without the cap, leaving
  // premium_tax_payable one cent negative for this policy.
  assert.equal(stateTaxCents(100001, 300), 3000);
  assert.equal(refundedTaxCents(100001, 300), 3001);
  assert.equal(refundedTaxCentsCappedAtCharged(100001, 300, 3000), 3000);
  // California's 2.35% has the same edge: charged 2350, uncapped refund 2351.
  assert.equal(stateTaxCents(100001, 235), 2350);
  assert.equal(refundedTaxCents(100001, 235), 2351);
  assert.equal(refundedTaxCentsCappedAtCharged(100001, 235, 2350), 2350);

  // The whole breakdown of that early cancellation: nothing earned, everything back, tax capped.
  const cancelledOnTheFirstDay = cancellationBreakdown({
    writtenPremiumSegments: [{ writtenPremiumCents: 100001, startsOn: "2028-03-01", endsOn: "2029-03-01" }],
    taxChargedCents: 3000,
    taxRateBps: 300,
    commissionRateBps: COMMISSION_RATE_BPS,
    cancellationEffectiveAt: "2028-03-01",
  });
  assert.deepEqual(cancelledOnTheFirstDay, {
    termDays: 365,
    earnedDays: 0,
    writtenPremiumCents: 100001,
    earnedPremiumCents: 0,
    unearnedPremiumCents: 100001,
    refundedTaxCents: 3000, // capped: 3001 would exceed what was collected
    taxRefundWasCappedAtCharged: true,
    refundedFeeCents: 0,
    totalRefundCents: 103001,
    commissionClawbackCents: 15000, // 100001 x 15% = 15000.15, rounded down
  });
});

test("a cancellation on the last day of the term refunds nothing", () => {
  const atTermEnd = cancellationBreakdown({
    writtenPremiumSegments: [{ writtenPremiumCents: WRITTEN, startsOn: "2028-03-01", endsOn: "2029-03-01" }],
    taxChargedCents: 2820,
    taxRateBps: 235,
    commissionRateBps: COMMISSION_RATE_BPS,
    cancellationEffectiveAt: "2029-03-01",
  });
  assert.equal(atTermEnd.earnedPremiumCents, WRITTEN);
  assert.equal(atTermEnd.unearnedPremiumCents, 0);
  assert.equal(atTermEnd.totalRefundCents, 0);
  assert.equal(atTermEnd.commissionClawbackCents, 0);
});

test("inputs must be non-negative integer cents", () => {
  assert.throws(() => earnedPremiumCents(1200.5, "2028-01-01", "2029-01-01", "2028-04-10"), /integer number of cents/);
  assert.throws(() => stateTaxCents(-1, 300), /integer number of cents/);
});

test("the recited example: March 1, 2028 policy, 365 days, cancelled on day 100 (June 9)", () => {
  // Decided by Yoann on 2026-09-08 (DECISIONS.md): this is the example told at the debrief.
  // Written $1,200, 3% tax, cancelled on day 100 of 365. Earned 32876, unearned 87124,
  // tax refunded ceil(87124 x 3%) = 2614, fee never refunded: total $897.38.
  const atThreePercent = cancellationBreakdown({
    writtenPremiumSegments: [{ writtenPremiumCents: WRITTEN, startsOn: "2028-03-01", endsOn: "2029-03-01" }],
    taxChargedCents: 3600,
    taxRateBps: 300,
    commissionRateBps: COMMISSION_RATE_BPS,
    cancellationEffectiveAt: "2028-06-09",
  });
  assert.equal(atThreePercent.earnedPremiumCents, 32876);
  assert.equal(atThreePercent.unearnedPremiumCents, 87124);
  assert.equal(atThreePercent.refundedTaxCents, 2614);
  assert.equal(atThreePercent.refundedFeeCents, 0);
  assert.equal(atThreePercent.totalRefundCents, 89738);
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

  // The full figures recited at the debrief, in one object: this is the cancellation of the
  // $1,200 California policy written on 2028-03-01 and cancelled on 2028-06-09 (day 100).
  assert.deepEqual(
    cancellationBreakdown({
      writtenPremiumSegments: [{ writtenPremiumCents: WRITTEN, startsOn: "2028-03-01", endsOn: "2029-03-01" }],
      taxChargedCents: 2820,
      taxRateBps: 235,
      commissionRateBps: COMMISSION_RATE_BPS,
      cancellationEffectiveAt: "2028-06-09",
    }),
    {
      termDays: 365,
      earnedDays: 100,
      writtenPremiumCents: WRITTEN,
      earnedPremiumCents: 32876,
      unearnedPremiumCents: 87124,
      refundedTaxCents: 2048,
      taxRefundWasCappedAtCharged: false,
      refundedFeeCents: 0,
      totalRefundCents: 89172, // $891.72
      commissionClawbackCents: 13068, // 87124 x 15% = 13068.6, rounded down (DECISIONS.md)
    },
  );
});

test("an endorsed policy earns per segment: the issuance premium and each delta from its own date", () => {
  // The recited policy raised to $1,800 effective 2028-06-09 (day 100 of 365). The endorsement
  // charged 43561 cents of prorated premium, which earns over the 265 days that remain.
  const issuance = { writtenPremiumCents: 120000, startsOn: "2028-03-01", endsOn: "2029-03-01" };
  const raise = { writtenPremiumCents: 43561, startsOn: "2028-06-09", endsOn: "2029-03-01" };

  // On the day of the endorsement the new segment has earned nothing yet.
  assert.equal(earnedPremiumOfSegment(raise, "2028-06-09"), 0);
  assert.equal(earnedPremiumAcrossSegments([issuance, raise], "2028-06-09"), 32876);

  // Day 190 (2028-09-07): 90 of the endorsement's 265 days have run.
  assert.equal(earnedPremiumOfSegment(issuance, "2028-09-07"), 62465); // 62465.75 -> 62465
  assert.equal(earnedPremiumOfSegment(raise, "2028-09-07"), 14794); // 14794.30 -> 14794
  assert.equal(earnedPremiumAcrossSegments([issuance, raise], "2028-09-07"), 77259);

  // At the end of the term every segment is fully earned and nothing is owed back.
  assert.equal(earnedPremiumAcrossSegments([issuance, raise], "2029-03-01"), 163561);
});

test("a premium reduction is a negative segment, and it is rounded down like every other one", () => {
  // Lowering $1,800 to $600 on day 100 gave back 43562 cents of premium priced over 265 days.
  const reduction = { writtenPremiumCents: -43562, startsOn: "2028-06-09", endsOn: "2029-03-01" };
  // Exact at day 190: -43562 x 90 / 265 = -14794.64. Rounded DOWN is -14795, not -14794:
  // less earned means more unearned, which is the customer's favour, as everywhere else.
  assert.equal(earnedPremiumOfSegment(reduction, "2028-09-07"), -14795);
  assert.equal(earnedPremiumOfSegment(reduction, "2028-06-09"), 0);
  assert.equal(earnedPremiumOfSegment(reduction, "2029-03-01"), -43562);
});

test("cancelling an endorsed policy: the second worked example, day 190 of the raised policy", () => {
  // $1,200 written 2028-03-01, raised to $1,800 effective 2028-06-09 (43561 charged, 1023 of tax
  // on top of the 2820 charged at issuance), cancelled on 2028-09-07.
  const breakdown = cancellationBreakdown({
    writtenPremiumSegments: [
      { writtenPremiumCents: 120000, startsOn: "2028-03-01", endsOn: "2029-03-01" },
      { writtenPremiumCents: 43561, startsOn: "2028-06-09", endsOn: "2029-03-01" },
    ],
    taxChargedCents: 2820 + 1023,
    taxRateBps: 235,
    commissionRateBps: COMMISSION_RATE_BPS,
    cancellationEffectiveAt: "2028-09-07",
  });
  assert.equal(breakdown.writtenPremiumCents, 163561); // NOT the 180000 annual premium in force
  assert.equal(breakdown.earnedPremiumCents, 77259);
  assert.equal(breakdown.unearnedPremiumCents, 86302);
  assert.equal(breakdown.refundedTaxCents, 2029); // ceil(86302 x 2.35%) = 2028.10 -> 2029
  assert.equal(breakdown.taxRefundWasCappedAtCharged, false);
  assert.equal(breakdown.totalRefundCents, 88331);
  assert.equal(breakdown.commissionClawbackCents, 12945); // 12945.3 rounded down
  // Pricing the whole thing on the $1,800 annual premium over the 175 remaining days gives
  // 86301.37: one cent less than the segments, because each segment rounds the customer's way.
});

test("cancelling a reduced policy gives back what is left of the reduced cover", () => {
  // $1,200 lowered to $600 on day 100 (43562 refunded), then cancelled on day 190.
  const breakdown = cancellationBreakdown({
    writtenPremiumSegments: [
      { writtenPremiumCents: 120000, startsOn: "2028-03-01", endsOn: "2029-03-01" },
      { writtenPremiumCents: -43562, startsOn: "2028-06-09", endsOn: "2029-03-01" },
    ],
    // The tax charged at issuance minus the 1024 cents already given back with the reduction.
    taxChargedCents: 2820 - 1024,
    taxRateBps: 235,
    commissionRateBps: COMMISSION_RATE_BPS,
    cancellationEffectiveAt: "2028-09-07",
  });
  assert.equal(breakdown.writtenPremiumCents, 76438);
  assert.equal(breakdown.earnedPremiumCents, 62465 - 14795);
  assert.equal(breakdown.unearnedPremiumCents, 28768);
  // Pricing the $600 cover over the 175 remaining days gives 28767.12: the segments give back
  // one cent more, which is the rounding rule of this build.
  assert.equal(breakdown.refundedTaxCents, 677); // ceil(28768 x 2.35%) = 676.05 -> 677
  assert.equal(breakdown.totalRefundCents, 29445);
});
