import { test } from "node:test";
import assert from "node:assert/strict";
import { claimMoneyPosition, reserveAdjustmentDeltaCents, type ClaimMoneyEvent } from "./money-position";

// The same example as lib/ledger/claim-entries.test.ts, read from the events instead of from
// the journal: reserve $5,000, reduced to $4,000, payment $1,200 sent, settled, returned.
function event(eventType: ClaimMoneyEvent["eventType"], amountCents: number | null): ClaimMoneyEvent {
  return { eventType, amountCents };
}

test("a claim with no event has cost nothing and has no reserve yet", () => {
  const position = claimMoneyPosition([]);
  assert.deepEqual(position, {
    reserveCents: 0,
    paidCents: 0,
    settledCents: 0,
    incurredCents: 0,
    isClosed: false,
    hasReserve: false,
  });
});

test("setting a reserve makes it the whole incurred amount", () => {
  const position = claimMoneyPosition([event("reserve_set", 500000)]);
  assert.equal(position.reserveCents, 500000);
  assert.equal(position.paidCents, 0);
  assert.equal(position.incurredCents, 500000);
  assert.equal(position.hasReserve, true);
});

test("an adjustment carries the NEW outstanding reserve, not the change", () => {
  const position = claimMoneyPosition([event("reserve_set", 500000), event("reserve_adjusted", 400000)]);
  assert.equal(position.reserveCents, 400000);
  assert.equal(position.incurredCents, 400000);
});

test("asking to pay moves nothing: it only holds its place against the limits", () => {
  const position = claimMoneyPosition([event("reserve_set", 500000), event("payment_requested", 120000)]);
  assert.equal(position.reserveCents, 500000);
  assert.equal(position.paidCents, 0);
  assert.equal(position.incurredCents, 500000);
});

test("a payment leaves the reserve and becomes paid, and incurred does not move", () => {
  const position = claimMoneyPosition([
    event("reserve_set", 500000),
    event("reserve_adjusted", 400000),
    event("payment_requested", 120000),
    event("payment_sent", 120000),
  ]);
  assert.equal(position.reserveCents, 280000);
  assert.equal(position.paidCents, 120000);
  assert.equal(position.settledCents, 0);
  // Paying out of a reserve is not a new loss: the same $4,000 is now $1,200 paid plus $2,800
  // still expected.
  assert.equal(position.incurredCents, 400000);
});

test("settling confirms the money has left without changing what the claim has cost", () => {
  const position = claimMoneyPosition([
    event("reserve_set", 400000),
    event("payment_sent", 120000),
    event("payment_settled", 120000),
  ]);
  assert.equal(position.paidCents, 120000);
  assert.equal(position.settledCents, 120000);
  assert.equal(position.incurredCents, 400000);
});

test("a return puts the claim back exactly where it was before the payment", () => {
  const before = claimMoneyPosition([event("reserve_set", 400000)]);
  const after = claimMoneyPosition([
    event("reserve_set", 400000),
    event("payment_sent", 120000),
    event("payment_settled", 120000),
    event("payment_returned", 120000),
  ]);
  assert.equal(after.reserveCents, before.reserveCents);
  assert.equal(after.paidCents, 0);
  assert.equal(after.settledCents, 0);
  assert.equal(after.incurredCents, before.incurredCents);
});

test("incurred is always paid plus reserve, at every step of the example", () => {
  const timeline: ClaimMoneyEvent[] = [
    event("reserve_set", 500000),
    event("reserve_adjusted", 400000),
    event("payment_requested", 120000),
    event("payment_sent", 120000),
    event("payment_settled", 120000),
    event("payment_returned", 120000),
  ];
  for (let upTo = 0; upTo <= timeline.length; upTo += 1) {
    const position = claimMoneyPosition(timeline.slice(0, upTo));
    assert.equal(
      position.incurredCents,
      position.paidCents + position.reserveCents,
      `incurred is not paid + reserve after ${upTo} event(s)`,
    );
  }
});

test("a reserve taken down to zero leaves a claim that has cost only what it paid", () => {
  const position = claimMoneyPosition([
    event("reserve_set", 500000),
    event("payment_sent", 120000),
    event("payment_settled", 120000),
    event("reserve_adjusted", 0),
  ]);
  assert.equal(position.reserveCents, 0);
  assert.equal(position.paidCents, 120000);
  assert.equal(position.incurredCents, 120000);
});

test("closing is recorded and changes no amount", () => {
  const position = claimMoneyPosition([
    event("reserve_set", 120000),
    event("payment_sent", 120000),
    event("payment_settled", 120000),
    event("reserve_adjusted", 0),
    event("closed", null),
  ]);
  assert.equal(position.isClosed, true);
  assert.equal(position.incurredCents, 120000);
});

test("a fold that would make the reserve negative stops instead of showing nonsense", () => {
  assert.throws(
    () => claimMoneyPosition([event("reserve_set", 100000), event("payment_sent", 120000)]),
    /negative reserve/,
  );
});

test("an amount missing from a money event stops the fold", () => {
  assert.throws(() => claimMoneyPosition([event("reserve_set", null)]), /whole number of cents/);
});

test("the delta a reserve change books is the difference between the two levels", () => {
  assert.equal(reserveAdjustmentDeltaCents(0, 500000), 500000);
  assert.equal(reserveAdjustmentDeltaCents(500000, 400000), -100000);
  assert.equal(reserveAdjustmentDeltaCents(400000, 400000), 0);
  assert.throws(() => reserveAdjustmentDeltaCents(0, -1), /non-negative/);
});
