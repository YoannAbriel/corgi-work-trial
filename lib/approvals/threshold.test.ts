import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claimPayoutNeedsApproval,
  customerApprovalNeeded,
  endorsementNeedsCustomerApproval,
  MONEY_OUT_APPROVAL_THRESHOLD_CENTS,
  moneyOutNeedsApproval,
  refundNeedsApproval,
} from "./threshold";

test("the threshold is $1,000, in whole cents", () => {
  assert.equal(MONEY_OUT_APPROVAL_THRESHOLD_CENTS, 100000);
});

test("exactly $1,000 does not need an approver: the rule is ABOVE the threshold", () => {
  assert.equal(moneyOutNeedsApproval(100000), false);
});

test("one cent more does", () => {
  assert.equal(moneyOutNeedsApproval(100001), true);
});

test("small amounts go out without a second person", () => {
  assert.equal(moneyOutNeedsApproval(1), false);
  assert.equal(moneyOutNeedsApproval(99999), false);
});

test("the live refund of slice B5 would have needed one", () => {
  // $3,241.56, the refund created on CGP-01062 before this gate existed (finding B5-MC).
  assert.equal(moneyOutNeedsApproval(324156), true);
});

test("an amount that is not a positive whole number of cents is a programming error, not a decision", () => {
  assert.throws(() => moneyOutNeedsApproval(0), /positive whole number of cents/);
  assert.throws(() => moneyOutNeedsApproval(-100000), /positive whole number of cents/);
  assert.throws(() => moneyOutNeedsApproval(100000.5), /positive whole number of cents/);
});

// The per-claim rule (F-B7-02): the threshold cannot be skipped by splitting a payout.
test("a claim payout needs approval when the claim's total money out would cross the threshold", () => {
  // First $600 on a fresh claim: below the line, no approver.
  assert.equal(claimPayoutNeedsApproval({ amountCents: 60000, claimPaidCents: 0, claimPendingCents: 0 }), false);
  // Second $600 after the first was sent: the claim reaches $1,200, an approver is needed.
  assert.equal(claimPayoutNeedsApproval({ amountCents: 60000, claimPaidCents: 60000, claimPendingCents: 0 }), true);
  // A request still waiting counts as money out too.
  assert.equal(claimPayoutNeedsApproval({ amountCents: 60000, claimPaidCents: 0, claimPendingCents: 60000 }), true);
  // Exactly $1,000 in total goes without an approver; one cent more does not.
  assert.equal(claimPayoutNeedsApproval({ amountCents: 40000, claimPaidCents: 60000, claimPendingCents: 0 }), false);
  assert.equal(claimPayoutNeedsApproval({ amountCents: 40001, claimPaidCents: 60000, claimPendingCents: 0 }), true);
  // A single payment above the threshold always needs one, whatever the claim's history.
  assert.equal(claimPayoutNeedsApproval({ amountCents: 100001, claimPaidCents: 0, claimPendingCents: 0 }), true);
  assert.throws(() => claimPayoutNeedsApproval({ amountCents: 100, claimPaidCents: -1, claimPendingCents: 0 }), /whole number/);
});

test("a refund above $1,000 on its own needs an approver, whatever the policy did before", () => {
  assert.equal(refundNeedsApproval({ amountCents: 100001, policyRefundedCents: 0, policyPendingRefundCents: 0 }), true);
  assert.equal(refundNeedsApproval({ amountCents: 100000, policyRefundedCents: 0, policyPendingRefundCents: 0 }), false);
});

test("repeated reductions cannot slip a policy past $1,000 one refund at a time (F-B4-04)", () => {
  // Three reductions of $600 on one policy. The first two are under the threshold on their own
  // and together; the third takes the policy past $1,800 and has to be approved.
  assert.equal(refundNeedsApproval({ amountCents: 60000, policyRefundedCents: 0, policyPendingRefundCents: 0 }), false);
  assert.equal(refundNeedsApproval({ amountCents: 60000, policyRefundedCents: 60000, policyPendingRefundCents: 0 }), true);
  // The same is true when the earlier refund has not been sent yet: money on its way counts.
  assert.equal(refundNeedsApproval({ amountCents: 60000, policyRefundedCents: 0, policyPendingRefundCents: 60000 }), true);
});

test("a cancellation counts the endorsement refunds the policy already made", () => {
  // $913.58 given back by an endorsement, then a cancellation refunding $200: alone neither
  // crosses $1,000, together they do.
  assert.equal(refundNeedsApproval({ amountCents: 20000, policyRefundedCents: 91358, policyPendingRefundCents: 0 }), true);
  assert.equal(refundNeedsApproval({ amountCents: 8000, policyRefundedCents: 91358, policyPendingRefundCents: 0 }), false);
});

test("a failed refund counts for nothing: the money came back to us", () => {
  // The caller excludes failed refunds from both totals, so the same call reads as the first one.
  assert.equal(refundNeedsApproval({ amountCents: 60000, policyRefundedCents: 0, policyPendingRefundCents: 0 }), false);
});

test("an amount that is not whole cents is a programming error on the refund rule too", () => {
  assert.throws(() => refundNeedsApproval({ amountCents: 0, policyRefundedCents: 0, policyPendingRefundCents: 0 }), /positive whole number of cents/);
  assert.throws(() => refundNeedsApproval({ amountCents: 100, policyRefundedCents: -1, policyPendingRefundCents: 0 }), /zero or more/);
});

const CUSTOMER_THRESHOLD = 50000; // $500, the value lib/money/endorsement.ts passes in

test("a correction difference keeps its own base: the difference plus what is still waiting (F-B8-02)", () => {
  // A difference of $400 needs no approval; the same difference while $400 is still unanswered
  // on the policy does, because together they collect $800 from the customer.
  assert.equal(customerApprovalNeeded({ amountCents: 40000, unapprovedRequestedCents: 0, thresholdCents: CUSTOMER_THRESHOLD }), false);
  assert.equal(customerApprovalNeeded({ amountCents: 40000, unapprovedRequestedCents: 40000, thresholdCents: CUSTOMER_THRESHOLD }), true);
  // Exactly $500 is still not above $500.
  assert.equal(customerApprovalNeeded({ amountCents: 50000, unapprovedRequestedCents: 0, thresholdCents: CUSTOMER_THRESHOLD }), false);
  assert.equal(customerApprovalNeeded({ amountCents: 50001, unapprovedRequestedCents: 0, thresholdCents: CUSTOMER_THRESHOLD }), true);
});

// The endorsement rule, decision 24: per policy, cumulative over the term, premium before tax.
function endorsementApproval(additionalPremiumSoFarCents: number, additionalPremiumCents: number): boolean {
  return endorsementNeedsCustomerApproval({ additionalPremiumSoFarCents, additionalPremiumCents, thresholdCents: CUSTOMER_THRESHOLD });
}

test("Yoann's three-step example: $300, then $300, then $50 of additional premium", () => {
  assert.equal(endorsementApproval(0, 30000), false); // running total $300.00, no approval
  assert.equal(endorsementApproval(30000, 30000), true); // running total $600.00, the customer approves
  assert.equal(endorsementApproval(60000, 5000), true); // running total $650.00, the customer approves
});

test("exactly $500.00 of additional premium is not above $500.00, one cent more is", () => {
  assert.equal(endorsementApproval(0, 50000), false);
  assert.equal(endorsementApproval(20000, 30000), false); // the running total is what is compared
  assert.equal(endorsementApproval(0, 50001), true);
  assert.equal(endorsementApproval(20000, 30001), true);
});

test("an endorsement that lowers the premium never needs the customer's approval (rule 8)", () => {
  assert.equal(endorsementApproval(60000, -43562), false);
  assert.equal(endorsementApproval(0, 0), false); // a change that moves no money asks for nothing
});

test("figures that are not whole cents are a programming error on the endorsement rule too", () => {
  assert.throws(() => endorsementApproval(-1, 30000), /zero or more/);
  assert.throws(() => endorsementApproval(0, 30000.5), /whole number of cents/);
  assert.throws(
    () => endorsementNeedsCustomerApproval({ additionalPremiumSoFarCents: 0, additionalPremiumCents: 100, thresholdCents: 0 }),
    /positive whole number of cents/,
  );
});
