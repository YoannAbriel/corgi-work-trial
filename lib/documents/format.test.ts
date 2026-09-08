import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBasisPoints, formatCalendarDate, formatCents, formatUtcTimestamp } from "./format";

test("cents are printed as dollars, from the digits and never by dividing", () => {
  assert.equal(formatCents(125320), "$1,253.20"); // the recited example's total charge
  assert.equal(formatCents(0), "$0.00");
  assert.equal(formatCents(-43562), "-$435.62"); // a credit back to the customer
  assert.equal(formatCents(5), "$0.05");
  assert.equal(formatCents(99), "$0.99");
  assert.equal(formatCents(100), "$1.00");
  assert.equal(formatCents(-1), "-$0.01");
  assert.equal(formatCents(100000000), "$1,000,000.00"); // a coverage limit
  assert.equal(formatCents(123456789012), "$1,234,567,890.12");
});

test("a fractional amount is a bug, not something to round here", () => {
  assert.throws(() => formatCents(1253.5), /integer number of cents/);
});

test("a tax rate in basis points is printed as a percentage", () => {
  assert.equal(formatBasisPoints(235), "2.35%"); // California, decided 2026-09-08
  assert.equal(formatBasisPoints(300), "3.00%");
  assert.equal(formatBasisPoints(5), "0.05%");
  assert.equal(formatBasisPoints(10000), "100.00%");
  assert.throws(() => formatBasisPoints(-1), /non-negative whole number/);
});

test("a calendar date is written out so it cannot be read the other way round", () => {
  assert.equal(formatCalendarDate("2028-03-01"), "March 1, 2028");
  assert.equal(formatCalendarDate("2029-03-01"), "March 1, 2029");
  assert.equal(formatCalendarDate("2028-12-31"), "December 31, 2028");
  assert.throws(() => formatCalendarDate("2028-3-1"), /not a calendar date/);
  assert.throws(() => formatCalendarDate("2028-13-01"), /not a real month/);
});

test("a timestamp is printed with its timezone, and must be UTC", () => {
  assert.equal(formatUtcTimestamp("2026-09-08T12:34:56.789Z"), "2026-09-08 12:34:56 UTC");
  assert.equal(formatUtcTimestamp("2026-09-08T12:34:56Z"), "2026-09-08 12:34:56 UTC");
  assert.throws(() => formatUtcTimestamp("2026-09-08T12:34:56+02:00"), /ending in Z/);
});
