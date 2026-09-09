import { test } from "node:test";
import assert from "node:assert/strict";
import { policyAsOfStepsFrom, type TimelineRowForSteps } from "./as-of-steps";

// A policy issued 2026-09-08, endorsed 2026-10-08, with one endorsement that a correction put
// right (the wrong row is superseded, the re-book carries the corrected date).
const ROWS: TimelineRowForSteps[] = [
  { eventType: "quoted", effectiveAt: "2026-09-08", supersededByEventId: null },
  { eventType: "issued", effectiveAt: "2026-09-08", supersededByEventId: null },
  { eventType: "endorsed", effectiveAt: "2026-10-08", supersededByEventId: null },
  { eventType: "endorsed", effectiveAt: "2026-12-09", supersededByEventId: "correction-1" },
  { eventType: "correction_reversal", effectiveAt: "2026-12-09", supersededByEventId: null },
  { eventType: "correction_rebook", effectiveAt: "2026-11-09", supersededByEventId: null },
];

test("the steps are the term start, every event still in force, and today", () => {
  const steps = policyAsOfStepsFrom(ROWS, "2026-09-08", "2026-12-20");
  assert.deepEqual(steps, [
    { date: "2026-09-08", label: "term start" },
    { date: "2026-10-08", label: "endorsement" },
    { date: "2026-11-09", label: "corrected endorsement" },
    { date: "2026-12-20", label: "today" },
  ]);
  // The superseded endorsement's date and the reversal's wrong date are not steps.
  assert.equal(steps.some((step) => step.date === "2026-12-09"), false);
});

// Review finding F-B12-04, same class as F-B8-07: a date control must not offer a value its own
// constraint rejects. The date field in the same panel carries min={termStart}.
test("today is not a step on a policy whose term has not begun", () => {
  const steps = policyAsOfStepsFrom(ROWS, "2026-09-17", "2026-09-09");
  assert.equal(steps.some((step) => step.label.includes("today")), false);
  assert.equal(steps[0].date, "2026-09-17");
  assert.equal(steps.every((step) => step.date >= "2026-09-17"), true);
});

test("today on the term start itself is one step wearing both words", () => {
  const steps = policyAsOfStepsFrom(ROWS, "2026-09-08", "2026-09-08");
  assert.equal(steps[0].date, "2026-09-08");
  assert.equal(steps[0].label, "term start, today");
  assert.equal(steps.filter((step) => step.date === "2026-09-08").length, 1);
});

test("a cancellation is a step, and the steps come out in date order", () => {
  const steps = policyAsOfStepsFrom(
    [...ROWS, { eventType: "cancelled", effectiveAt: "2026-11-01", supersededByEventId: null }],
    "2026-09-08",
    "2026-12-20",
  );
  assert.deepEqual(
    steps.map((step) => step.date),
    ["2026-09-08", "2026-10-08", "2026-11-01", "2026-11-09", "2026-12-20"],
  );
  assert.equal(steps[2].label, "cancellation");
});
