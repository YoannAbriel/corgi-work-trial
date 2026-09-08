import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, daysBetween, termDays, termEnd } from "./dates";

test("a term ends on the same calendar date next year", () => {
  assert.equal(termEnd("2028-03-01"), "2029-03-01");
  assert.equal(termEnd("2028-01-01"), "2029-01-01");
  assert.equal(termEnd("2027-06-15"), "2028-06-15");
});

test("a term starting on February 29 ends on February 28", () => {
  assert.equal(termEnd("2028-02-29"), "2029-02-28");
});

test("term days are counted for real: 365 or 366", () => {
  // February 29, 2028 falls before March 1, 2028: this term has 365 days.
  assert.equal(termDays("2028-03-01"), 365);
  // This term contains February 29, 2028.
  assert.equal(termDays("2028-01-01"), 366);
  assert.equal(termDays("2027-06-15"), 366);
  assert.equal(termDays("2028-02-29"), 365);
  // A non-leap year.
  assert.equal(termDays("2029-03-01"), 365);
});

test("daysBetween and addDays are exact whole days", () => {
  assert.equal(daysBetween("2028-01-01", "2028-04-10"), 100);
  assert.equal(addDays("2028-01-01", 100), "2028-04-10");
  assert.equal(daysBetween("2028-03-01", "2028-06-09"), 100);
  assert.equal(daysBetween("2028-04-10", "2028-01-01"), -100);
});

test("invalid dates are rejected instead of rolling over", () => {
  assert.throws(() => termEnd("2028-02-30"), /not a real calendar date/);
  assert.throws(() => termEnd("2028-3-1"), /not a calendar date/);
  assert.throws(() => termDays("2028-01-01", "2028-01-01"), /must end after it starts/);
});
