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

// The day the claim is opened, in each scenario. It is an argument rather than the clock, so the
// recited policy's year can be tested without waiting for it (review finding F-B7-06).
const WHILE_RUNNING = "2028-09-15"; // inside the term
const AFTER_THE_TERM = "2029-06-01"; // after the term ended

test("a loss inside the term can be claimed", () => {
  assert.equal(
    claimCoverageRefusal({ occurredAt: "2028-05-01", reportedAt: "2028-05-03", today: WHILE_RUNNING, period: RUNNING }),
    null,
  );
});

test("both ends of the covered period are included", () => {
  assert.equal(
    claimCoverageRefusal({ occurredAt: TERM_START, reportedAt: TERM_START, today: WHILE_RUNNING, period: RUNNING }),
    null,
  );
  assert.equal(
    claimCoverageRefusal({ occurredAt: TERM_END, reportedAt: TERM_END, today: AFTER_THE_TERM, period: RUNNING }),
    null,
  );
});

test("a loss before the policy started is refused", () => {
  const refusal = claimCoverageRefusal({
    occurredAt: "2028-02-29",
    reportedAt: "2028-03-02",
    today: WHILE_RUNNING,
    period: RUNNING,
  });
  assert.match(String(refusal), /before the policy started on 2028-03-01/);
});

test("a loss after the term is refused", () => {
  const refusal = claimCoverageRefusal({
    occurredAt: "2029-03-02",
    reportedAt: "2029-03-02",
    today: AFTER_THE_TERM,
    period: RUNNING,
  });
  assert.match(String(refusal), /after the policy ended on 2029-03-01/);
});

test("a loss that has not happened yet is refused, whatever the policy covers", () => {
  // The case the reviewer had to create to open a claim at all: every trial policy starts cover
  // in the future, so nothing stopped a claim for a loss dated next month.
  const refusal = claimCoverageRefusal({
    occurredAt: "2028-10-01",
    reportedAt: "2028-10-01",
    today: WHILE_RUNNING,
    period: RUNNING,
  });
  assert.match(String(refusal), /has not happened yet: today is 2028-09-15/);
});

test("a loss dated today is not in the future", () => {
  assert.equal(
    claimCoverageRefusal({ occurredAt: WHILE_RUNNING, reportedAt: WHILE_RUNNING, today: WHILE_RUNNING, period: RUNNING }),
    null,
  );
});

test("a loss that happened WHILE a since-cancelled policy was in force can still be claimed", () => {
  // This is the live-fire rule: cancelling does not erase the losses that happened before it.
  assert.equal(
    claimCoverageRefusal({
      occurredAt: "2028-05-01",
      reportedAt: "2028-09-01",
      today: WHILE_RUNNING,
      period: CANCELLED,
    }),
    null,
  );
  assert.equal(
    claimCoverageRefusal({
      occurredAt: CANCELLED_ON,
      reportedAt: "2028-09-01",
      today: WHILE_RUNNING,
      period: CANCELLED,
    }),
    null,
  );
});

test("a loss after the cancellation date is refused, and the message says so", () => {
  const refusal = claimCoverageRefusal({
    occurredAt: "2028-06-10",
    reportedAt: "2028-06-11",
    today: WHILE_RUNNING,
    period: CANCELLED,
  });
  assert.match(String(refusal), /after the policy was cancelled on 2028-06-09/);
});

test("a loss cannot be reported before it happened", () => {
  const refusal = claimCoverageRefusal({
    occurredAt: "2028-05-10",
    reportedAt: "2028-05-09",
    today: WHILE_RUNNING,
    period: RUNNING,
  });
  assert.match(String(refusal), /cannot be reported before the day it happened/);
});

test("a date that does not exist is refused as a date, not as a coverage question", () => {
  assert.match(
    String(
      claimCoverageRefusal({
        occurredAt: "2028-02-30",
        reportedAt: "2028-03-01",
        today: WHILE_RUNNING,
        period: RUNNING,
      }),
    ),
    /not a calendar date/,
  );
  assert.match(
    String(
      claimCoverageRefusal({ occurredAt: "2028-05-01", reportedAt: "tomorrow", today: WHILE_RUNNING, period: RUNNING }),
    ),
    /not a calendar date/,
  );
});
