import { test } from "node:test";
import assert from "node:assert/strict";
import { MONEY_OUT_APPROVAL_THRESHOLD_CENTS, moneyOutNeedsApproval } from "./threshold";

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
