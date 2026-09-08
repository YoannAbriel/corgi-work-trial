import { test } from "node:test";
import assert from "node:assert/strict";
import { MONEY_OUT_APPROVAL_THRESHOLD_CENTS, claimPayoutNeedsApproval, moneyOutNeedsApproval } from "./threshold";

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
