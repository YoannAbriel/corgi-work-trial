import { test } from "node:test";
import assert from "node:assert/strict";
import { breakKey, describeAge, hoursBetween } from "./breaks";

test("a record the ledger has never heard of is keyed on the provider reference", () => {
  assert.equal(breakKey("stripe", "pi_planted", null), "stripe|pi_planted");
});

test("anything the ledger knows is keyed on our operation id, which never changes", () => {
  assert.equal(breakKey("stripe", null, "OP_1"), "stripe|op:OP_1");
  assert.equal(breakKey("stripe", "pi_1", "OP_1"), "stripe|op:OP_1");
});

test("a record with no reference at all cannot be identified", () => {
  assert.throws(() => breakKey("stripe", null, null), /needs a provider reference or a ledger reference/);
});

test("the same money keeps one key when a provider reference appears, and one key per source", () => {
  // The whole point of finding F-B10-02: a refund the ledger owes and Stripe does not list yet is
  // the SAME break as the one Stripe lists tomorrow. It must not get a fresh age and leave its
  // former self on the resolved list.
  const beforeStripeListsIt = breakKey("stripe", null, "OP_REFUND");
  const afterStripeListsIt = breakKey("stripe", "re_1", "OP_REFUND");
  assert.equal(beforeStripeListsIt, afterStripeListsIt);
  assert.notEqual(beforeStripeListsIt, breakKey("claims_rail", null, "OP_REFUND"));
});

test("age reads in minutes under an hour, hours under two days, days after that", () => {
  const now = new Date("2026-09-08T12:00:00Z");
  assert.equal(describeAge(new Date("2026-09-08T11:59:30Z"), now), "0 minutes");
  assert.equal(describeAge(new Date("2026-09-08T11:59:00Z"), now), "1 minute");
  assert.equal(describeAge(new Date("2026-09-08T11:15:00Z"), now), "45 minutes");
  assert.equal(describeAge(new Date("2026-09-08T11:00:00Z"), now), "1 hour");
  assert.equal(describeAge(new Date("2026-09-07T09:30:00Z"), now), "26 hours");
  assert.equal(describeAge(new Date("2026-09-06T12:00:00Z"), now), "2 days");
  assert.equal(describeAge(new Date("2026-08-01T12:00:00Z"), now), "38 days");
});

test("a first-seen instant in the future reads as zero, never negative", () => {
  assert.equal(describeAge(new Date("2026-09-09T12:00:00Z"), new Date("2026-09-08T12:00:00Z")), "0 minutes");
});

test("whole hours between two instants, rounded down", () => {
  assert.equal(hoursBetween(new Date("2026-09-08T10:00:00Z"), new Date("2026-09-08T12:59:00Z")), 2);
  assert.equal(hoursBetween(new Date("2026-09-06T12:00:00Z"), new Date("2026-09-08T12:00:00Z")), 48);
});

test("an instant in the future has waited zero hours, never a negative number", () => {
  // The provider's clock and the clock a run is given are not the same clock; a record stamped a
  // second from now must not read as "minus one hour" and become stale by accident.
  assert.equal(hoursBetween(new Date("2026-09-08T13:00:00Z"), new Date("2026-09-08T12:00:00Z")), 0);
});
