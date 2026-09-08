import { test } from "node:test";
import assert from "node:assert/strict";
import { claimCoverageRefusal, coveredPeriod } from "./coverage";

// The recited policy (DECISIONS.md): term 2028-03-01 to 2029-03-01, cancelled on day 100,
// which is 2028-06-09.
const TERM_START = "2028-03-01";
const TERM_END = "2029-03-01";
const CANCELLED_ON = "2028-06-09";

test("a policy that is still running covers its whole term", () => {
  const period = coveredPeriod({ termStart: TERM_START, termEnd: TERM_END, cancelledEffectiveAt: null });
  assert.deepEqual(period, { from: TERM_START, to: TERM_END, endedEarly: false });
});

test("a cancelled policy covers up to the day it was cancelled, and no further", () => {
  const period = coveredPeriod({ termStart: TERM_START, termEnd: TERM_END, cancelledEffectiveAt: CANCELLED_ON });
  assert.deepEqual(period, { from: TERM_START, to: CANCELLED_ON, endedEarly: true });
});

test("a cancellation dated at the term end changes nothing about the covered period", () => {
  const period = coveredPeriod({ termStart: TERM_START, termEnd: TERM_END, cancelledEffectiveAt: TERM_END });
  assert.deepEqual(period, { from: TERM_START, to: TERM_END, endedEarly: false });
});

const RUNNING = coveredPeriod({ termStart: TERM_START, termEnd: TERM_END, cancelledEffectiveAt: null });
const CANCELLED = coveredPeriod({ termStart: TERM_START, termEnd: TERM_END, cancelledEffectiveAt: CANCELLED_ON });

test("a loss inside the term can be claimed", () => {
  assert.equal(claimCoverageRefusal({ occurredAt: "2028-05-01", reportedAt: "2028-05-03", period: RUNNING }), null);
});

test("both ends of the covered period are included", () => {
  assert.equal(claimCoverageRefusal({ occurredAt: TERM_START, reportedAt: TERM_START, period: RUNNING }), null);
  assert.equal(claimCoverageRefusal({ occurredAt: TERM_END, reportedAt: TERM_END, period: RUNNING }), null);
});

test("a loss before the policy started is refused", () => {
  const refusal = claimCoverageRefusal({ occurredAt: "2028-02-29", reportedAt: "2028-03-02", period: RUNNING });
  assert.match(String(refusal), /before the policy started on 2028-03-01/);
});

test("a loss after the term is refused", () => {
  const refusal = claimCoverageRefusal({ occurredAt: "2029-03-02", reportedAt: "2029-03-02", period: RUNNING });
  assert.match(String(refusal), /after the policy ended on 2029-03-01/);
});

test("a loss that happened WHILE a since-cancelled policy was in force can still be claimed", () => {
  // This is the live-fire rule: cancelling does not erase the losses that happened before it.
  assert.equal(claimCoverageRefusal({ occurredAt: "2028-05-01", reportedAt: "2028-09-01", period: CANCELLED }), null);
  assert.equal(claimCoverageRefusal({ occurredAt: CANCELLED_ON, reportedAt: "2028-09-01", period: CANCELLED }), null);
});

test("a loss after the cancellation date is refused, and the message says so", () => {
  const refusal = claimCoverageRefusal({ occurredAt: "2028-06-10", reportedAt: "2028-06-11", period: CANCELLED });
  assert.match(String(refusal), /after the policy was cancelled on 2028-06-09/);
});

test("a loss cannot be reported before it happened", () => {
  const refusal = claimCoverageRefusal({ occurredAt: "2028-05-10", reportedAt: "2028-05-09", period: RUNNING });
  assert.match(String(refusal), /cannot be reported before the day it happened/);
});

test("a date that does not exist is refused as a date, not as a coverage question", () => {
  assert.match(
    String(claimCoverageRefusal({ occurredAt: "2028-02-30", reportedAt: "2028-03-01", period: RUNNING })),
    /not a calendar date/,
  );
  assert.match(
    String(claimCoverageRefusal({ occurredAt: "2028-05-01", reportedAt: "tomorrow", period: RUNNING })),
    /not a calendar date/,
  );
});
