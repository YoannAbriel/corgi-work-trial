import { test } from "node:test";
import assert from "node:assert/strict";
import { correctEndorsementDateMoney, correctionApprovalSentences, correctionFormulaLines } from "./correction";
import { computeEndorsement, EndorsementNotComputable, type EndorsementFigures } from "./endorsement";

// The recited example (DECISIONS.md): $1,200 annual premium written 2028-03-01, California
// 2.35%, $25 fee, 15% commission, 365-day term, raised to $1,800.
//
//   day 100, 2028-06-09, 265 days remain   premium 43561, tax 1023, total 44584, commission 6534
//   day 130, 2028-07-09, 235 days remain   premium 38630, tax  907, total 39537, commission 5794
//
// The difference between the two is 4931 of premium, 116 of tax, 5047 in total, and 739 of
// commission on that premium.

const POLICY_ID = "11111111-1111-4111-8111-111111111111";

function endorsementOn(effectiveAt: string): EndorsementFigures {
  return computeEndorsement({
    policyId: POLICY_ID,
    policyVersion: 2,
    termStart: "2028-03-01",
    termEnd: "2029-03-01",
    effectiveAt,
    oldAnnualPremiumCents: 120000,
    newAnnualPremiumCents: 180000,
    taxRateBps: 235,
    taxChargedSoFarCents: 2820,
    commissionRateBps: 1500,
  });
}

const bookedOnDay130 = endorsementOn("2028-07-09");
const bookedOnDay100 = endorsementOn("2028-06-09");

// The totals the two thresholds are read against. A policy that has refunded nothing and has
// nothing waiting for its customer: the ordinary case, where a correction is judged on its own
// amount. The cumulative cases have their own tests at the bottom.
const NOTHING_ELSE_ON_THE_POLICY = {
  policyRefundedCents: 0,
  policyPendingRefundCents: 0,
  customerUnapprovedRequestedCents: 0,
};

test("the two dates of the recited example price what DECISIONS.md says they price", () => {
  assert.equal(bookedOnDay100.deltaPremiumCents, 43561);
  assert.equal(bookedOnDay100.deltaTaxCents, 1023);
  assert.equal(bookedOnDay100.deltaTotalCents, 44584);
  assert.equal(bookedOnDay100.daysRemaining, 265);
  assert.equal(bookedOnDay130.deltaPremiumCents, 38630);
  assert.equal(bookedOnDay130.deltaTaxCents, 907);
  assert.equal(bookedOnDay130.deltaTotalCents, 39537);
  assert.equal(bookedOnDay130.daysRemaining, 235);
});

test("entered at day 130 and corrected to day 100: the customer owes 5047 more", () => {
  const correction = correctEndorsementDateMoney(bookedOnDay130, "2028-06-09", NOTHING_ELSE_ON_THE_POLICY);

  assert.equal(correction.wrongEffectiveAt, "2028-07-09");
  assert.equal(correction.correctedEffectiveAt, "2028-06-09");
  assert.equal(correction.after.deltaPremiumCents, 43561);
  assert.equal(correction.after.deltaTaxCents, 1023);
  assert.equal(correction.differencePremiumCents, 4931);
  assert.equal(correction.differenceTaxCents, 116);
  assert.equal(correction.differenceTotalCents, 5047);
  assert.equal(correction.settlement, "collect");
  // floor(4931 x 1500 / 10000) = 739.65 -> 739: the insurer absorbs the fraction, as everywhere.
  assert.equal(correction.differenceCommissionCents, 739);
  // 5047 cents is $50.47, well under the $500 the customer has to approve.
  assert.equal(correction.customerApprovalRequired, false);
  assert.equal(correction.refundNeedsApproval, false);
});

test("entered at day 100 and corrected to day 130: the customer is owed 5047 back", () => {
  const correction = correctEndorsementDateMoney(bookedOnDay100, "2028-07-09", NOTHING_ELSE_ON_THE_POLICY);

  assert.equal(correction.differencePremiumCents, -4931);
  assert.equal(correction.differenceTaxCents, -116);
  assert.equal(correction.differenceTotalCents, -5047);
  assert.equal(correction.settlement, "refund");
  // The clawback is the mirror image, rounded down on the absolute amount for the same reason.
  assert.equal(correction.differenceCommissionCents, -739);
  // $50.47 out is far under the $1,000 that needs a distinct human approver.
  assert.equal(correction.refundNeedsApproval, false);
});

test("the correction re-prices with ONE input changed: everything else comes from the event", () => {
  const correction = correctEndorsementDateMoney(bookedOnDay130, "2028-06-09", NOTHING_ELSE_ON_THE_POLICY);
  assert.equal(correction.after.oldAnnualPremiumCents, bookedOnDay130.oldAnnualPremiumCents);
  assert.equal(correction.after.newAnnualPremiumCents, bookedOnDay130.newAnnualPremiumCents);
  assert.equal(correction.after.taxRateBps, bookedOnDay130.taxRateBps);
  assert.equal(correction.after.commissionRateBps, bookedOnDay130.commissionRateBps);
  assert.equal(correction.after.termStart, bookedOnDay130.termStart);
  assert.equal(correction.after.termEnd, bookedOnDay130.termEnd);
  // Only the date, and everything the date decides, is different.
  assert.notEqual(correction.after.effectiveAt, bookedOnDay130.effectiveAt);
  assert.notEqual(correction.after.quoteHash, bookedOnDay130.quoteHash);
});

test("a difference above $500 needs the customer's approval, one above $1,000 out needs an approver", () => {
  // Booked on the last day it could be, corrected right back to the start of the term: the
  // difference is nearly the whole annual increase, which is well above both thresholds.
  const bookedLate = endorsementOn("2029-02-01");
  const collectALot = correctEndorsementDateMoney(bookedLate, "2028-03-01", NOTHING_ELSE_ON_THE_POLICY);
  assert.equal(collectALot.settlement, "collect");
  assert.ok(collectALot.differenceTotalCents > 50000, `difference ${collectALot.differenceTotalCents}`);
  assert.equal(collectALot.customerApprovalRequired, true);

  // A $600 rise over a whole year is only $614 of prorated premium, under the $1,000 money-out
  // line whichever way it is corrected, so the refund case uses a bigger rise: $1,200 to $6,200,
  // booked on the first day of the term and corrected to a month before it ends.
  const bigRise = computeEndorsement({
    policyId: POLICY_ID,
    policyVersion: 2,
    termStart: "2028-03-01",
    termEnd: "2029-03-01",
    effectiveAt: "2028-03-01",
    oldAnnualPremiumCents: 120000,
    newAnnualPremiumCents: 620000,
    taxRateBps: 235,
    taxChargedSoFarCents: 2820,
    commissionRateBps: 1500,
  });
  const refundALot = correctEndorsementDateMoney(bigRise, "2029-02-01", NOTHING_ELSE_ON_THE_POLICY);
  assert.equal(refundALot.settlement, "refund");
  assert.ok(-refundALot.differenceTotalCents > 100000, `difference ${refundALot.differenceTotalCents}`);
  assert.equal(refundALot.refundNeedsApproval, true);
});

test("correcting to the same day the endorsement already covers moves no money", () => {
  // The date is different, the remaining days are the same only when the date is the same, so
  // this is the degenerate case: correcting to its own date. lib/policy refuses it earlier; the
  // pure function still answers, and it answers "nothing moves".
  const correction = correctEndorsementDateMoney(bookedOnDay100, "2028-06-09", NOTHING_ELSE_ON_THE_POLICY);
  assert.equal(correction.differenceTotalCents, 0);
  assert.equal(correction.settlement, "none");
  assert.equal(correction.differenceCommissionCents, 0);
});

test("a date outside the term is refused, not priced", () => {
  assert.throws(() => correctEndorsementDateMoney(bookedOnDay130, "2028-02-29", NOTHING_ELSE_ON_THE_POLICY), EndorsementNotComputable);
  assert.throws(() => correctEndorsementDateMoney(bookedOnDay130, "2029-03-02", NOTHING_ELSE_ON_THE_POLICY), EndorsementNotComputable);
});

test("the printed lines say what was booked, what it should be, and what moves", () => {
  const correction = correctEndorsementDateMoney(bookedOnDay130, "2028-06-09", NOTHING_ELSE_ON_THE_POLICY);
  const lines = correctionFormulaLines(correction);
  assert.deepEqual(
    lines.map((line) => line.key),
    ["premium_as_booked", "premium_corrected", "premium_difference", "tax_difference", "difference_total", "difference_commission"],
  );
  assert.equal(lines[0].cents, 38630);
  assert.equal(lines[0].formula, "floor(60000 x 235 / 365)");
  assert.equal(lines[1].cents, 43561);
  assert.equal(lines[1].formula, "floor(60000 x 265 / 365)");
  assert.equal(lines[2].cents, 4931);
  assert.equal(lines[4].cents, 5047);
  assert.equal(lines[5].cents, 739);
  // The premium difference plus the tax difference is exactly what Stripe is asked for.
  assert.equal(lines[2].cents + lines[3].cents, lines[4].cents);
});

test("the difference is always what the ledger will hold: after minus before, both ways round", () => {
  for (const wrongDate of ["2028-03-15", "2028-06-09", "2028-07-09", "2028-11-01"]) {
    for (const rightDate of ["2028-03-15", "2028-06-09", "2028-07-09", "2028-11-01"]) {
      const correction = correctEndorsementDateMoney(endorsementOn(wrongDate), rightDate, NOTHING_ELSE_ON_THE_POLICY);
      assert.equal(
        correction.differenceTotalCents,
        correction.after.deltaTotalCents - correction.before.deltaTotalCents,
        `${wrongDate} to ${rightDate}`,
      );
      assert.equal(
        correction.differencePremiumCents + correction.differenceTaxCents,
        correction.differenceTotalCents,
        `${wrongDate} to ${rightDate}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// The two thresholds are read against the POLICY, not against this correction
// ---------------------------------------------------------------------------

test("a difference under $500 on its own needs the customer when something else is already waiting", () => {
  // 5047 cents is $50.47, nowhere near the line on its own. With $480 already quoted to this
  // customer and unanswered, the two together are above $500 and the customer decides once.
  const alone = correctEndorsementDateMoney(bookedOnDay130, "2028-06-09", NOTHING_ELSE_ON_THE_POLICY);
  assert.equal(alone.customerApprovalRequired, false);

  const withOthersWaiting = correctEndorsementDateMoney(bookedOnDay130, "2028-06-09", {
    ...NOTHING_ELSE_ON_THE_POLICY,
    customerUnapprovedRequestedCents: 48000,
  });
  assert.equal(withOthersWaiting.customerApprovalRequired, true);
  assert.equal(withOthersWaiting.totals.customerUnapprovedRequestedCents, 48000);
});

test("a difference given back under $1,000 needs an approver when the policy has already refunded enough", () => {
  const alone = correctEndorsementDateMoney(bookedOnDay100, "2028-07-09", NOTHING_ELSE_ON_THE_POLICY);
  assert.equal(alone.refundNeedsApproval, false);

  // $960 already given back on this policy: this $50.47 takes it past $1,000.
  const afterNineHundred = correctEndorsementDateMoney(bookedOnDay100, "2028-07-09", {
    ...NOTHING_ELSE_ON_THE_POLICY,
    policyRefundedCents: 96000,
  });
  assert.equal(afterNineHundred.refundNeedsApproval, true);

  // The same is true of money that has not left yet: a refund waiting for an approver still
  // counts, or two reductions asked for in the same minute would both look affordable.
  const withOneOnItsWay = correctEndorsementDateMoney(bookedOnDay100, "2028-07-09", {
    ...NOTHING_ELSE_ON_THE_POLICY,
    policyPendingRefundCents: 99000,
  });
  assert.equal(withOneOnItsWay.refundNeedsApproval, true);
});

test("the sentence a screen prints always names the total the verdict was read against", () => {
  const queued = correctEndorsementDateMoney(bookedOnDay100, "2028-07-09", {
    ...NOTHING_ELSE_ON_THE_POLICY,
    policyRefundedCents: 96000,
  });
  const queuedSentences = correctionApprovalSentences(queued);
  assert.equal(queuedSentences.customer, null);
  assert.match(queuedSentences.refund ?? "", /\$50\.47/);
  assert.match(queuedSentences.refund ?? "", /\$1,000\.00/);
  assert.match(queuedSentences.refund ?? "", /\$960\.00 already refunded/);
  assert.match(queuedSentences.refund ?? "", /a second person, never you, has to approve it/);

  const goesStraightOut = correctionApprovalSentences(
    correctEndorsementDateMoney(bookedOnDay100, "2028-07-09", NOTHING_ELSE_ON_THE_POLICY),
  );
  assert.match(goesStraightOut.refund ?? "", /at or below \$1,000\.00 counting the \$0\.00/);
  assert.match(goesStraightOut.refund ?? "", /no second approver is needed/);

  const asked = correctionApprovalSentences(
    correctEndorsementDateMoney(bookedOnDay130, "2028-06-09", {
      ...NOTHING_ELSE_ON_THE_POLICY,
      customerUnapprovedRequestedCents: 48000,
    }),
  );
  assert.equal(asked.refund, null);
  assert.match(asked.customer ?? "", /\$50\.47 to collect, counting the \$480\.00 still waiting/);
  assert.match(asked.customer ?? "", /above \$500\.00, so the customer has to approve it/);

  const notAsked = correctionApprovalSentences(
    correctEndorsementDateMoney(bookedOnDay130, "2028-06-09", NOTHING_ELSE_ON_THE_POLICY),
  );
  assert.match(notAsked.customer ?? "", /at or below \$500\.00, so no customer approval is needed/);
});

test("a correction that moves no money states no verdict at all", () => {
  const nothingMoves = correctEndorsementDateMoney(bookedOnDay100, "2028-06-09", NOTHING_ELSE_ON_THE_POLICY);
  assert.equal(nothingMoves.settlement, "none");
  assert.deepEqual(correctionApprovalSentences(nothingMoves), { customer: null, refund: null });
});
