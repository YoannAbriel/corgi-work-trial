import { test } from "node:test";
import assert from "node:assert/strict";
import { breakKey, describeAge, hoursBetween } from "./breaks";

test("a break key is the source, the classification and the provider reference", () => {
  assert.equal(breakKey("stripe", "provider_only", "pi_planted", null), "stripe|provider_only|pi_planted");
});

test("a ledger-only break is keyed on its operation id when the provider has no reference", () => {
  assert.equal(breakKey("stripe", "local_only", null, "OP_1"), "stripe|local_only|op:OP_1");
});

test("the provider reference wins over the ledger reference, so both sides of a pair share one key", () => {
  assert.equal(breakKey("stripe", "amount_mismatch", "pi_1", "OP_1"), "stripe|amount_mismatch|pi_1");
});

test("a break with no reference at all cannot be identified", () => {
  assert.throws(() => breakKey("stripe", "stale", null, null), /needs a provider reference or a ledger reference/);
});

test("the same break reported by two runs has the same key, a different classification a different one", () => {
  const first = breakKey("stripe", "provider_only", "pi_1", null);
  const second = breakKey("stripe", "provider_only", "pi_1", "OP_1");
  assert.equal(first, second);
  assert.notEqual(first, breakKey("stripe", "amount_mismatch", "pi_1", null));
  assert.notEqual(first, breakKey("claims_rail", "provider_only", "pi_1", null));
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
