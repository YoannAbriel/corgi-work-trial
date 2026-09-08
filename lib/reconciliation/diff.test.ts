import { test } from "node:test";
import assert from "node:assert/strict";
import { countByClassification, diffProviderAgainstLedger, type LedgerRecord, type ProviderRecord } from "./diff";

// The recited example: charge 125320 cents on operation OP_PAID, PaymentIntent pi_paid.
const NOW = new Date("2026-09-08T12:00:00Z");
const AN_HOUR_AGO = "2026-09-08T11:00:00Z";
const TWO_DAYS_AGO = "2026-09-06T12:00:00Z";
const FOUR_DAYS_AGO = "2026-09-04T12:00:00Z";
const STALE_AFTER_HOURS = 24;
const RAIL_STALE_AFTER_HOURS = 72;

function payment(overrides: Partial<ProviderRecord> = {}): ProviderRecord {
  return {
    providerRef: "pi_paid",
    direction: "in",
    status: "succeeded",
    statusWord: "succeeded",
    amountCents: 125320,
    createdAt: AN_HOUR_AGO,
    operationId: "OP_PAID",
    policyId: "POLICY_1",
    feeCents: 3934,
    label: "payment",
    ...overrides,
  };
}

function refund(overrides: Partial<ProviderRecord> = {}): ProviderRecord {
  return {
    providerRef: "re_refund",
    direction: "out",
    status: "succeeded",
    statusWord: "succeeded",
    amountCents: 89172,
    createdAt: AN_HOUR_AGO,
    operationId: "OP_REFUND",
    policyId: "POLICY_1",
    feeCents: null,
    label: "refund",
    ...overrides,
  };
}

// One transfer on the simulated claim payout rail. It carries no operation id: the only link to
// our books is the transfer reference the money operation recorded when the rail accepted it.
function railPayout(overrides: Partial<ProviderRecord> = {}): ProviderRecord {
  return {
    providerRef: "sim_tr_1",
    direction: "out",
    status: "succeeded",
    statusWord: "settled",
    amountCents: 120000,
    createdAt: TWO_DAYS_AGO,
    operationId: null,
    policyId: null,
    feeCents: null,
    label: "claim payout",
    ...overrides,
  };
}

function collectedInLedger(overrides: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    operationId: "OP_PAID",
    direction: "in",
    policyId: "POLICY_1",
    providerRef: "pi_paid",
    expectedCents: 125320,
    cashCents: 125320,
    openClearingCents: 0,
    reversed: false,
    state: "succeeded",
    requestedAt: AN_HOUR_AGO,
    label: "checkout",
    ...overrides,
  };
}

function refundInLedger(overrides: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    operationId: "OP_REFUND",
    direction: "out",
    policyId: "POLICY_1",
    providerRef: "re_refund",
    expectedCents: 89172,
    cashCents: -89172,
    openClearingCents: 0,
    reversed: false,
    state: "completed",
    requestedAt: AN_HOUR_AGO,
    label: "refund",
    ...overrides,
  };
}

function railPayoutInLedger(overrides: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    operationId: "OP_PAYOUT",
    direction: "out",
    policyId: "POLICY_1",
    providerRef: "sim_tr_1",
    expectedCents: 120000,
    cashCents: -120000,
    openClearingCents: 0,
    reversed: false,
    state: "succeeded",
    requestedAt: TWO_DAYS_AGO,
    label: "claim payout",
    ...overrides,
  };
}

function diff(provider: ProviderRecord[], ledger: LedgerRecord[], staleAfterHours = STALE_AFTER_HOURS) {
  return diffProviderAgainstLedger({ provider, ledger, now: NOW, staleAfterHours });
}

test("a payment Stripe and the ledger agree on is matched, with the fee noted as information", () => {
  const [item] = diff([payment()], [collectedInLedger()]);
  assert.equal(item.classification, "matched");
  assert.equal(item.providerAmountCents, 125320);
  assert.equal(item.ledgerAmountCents, 125320);
  assert.equal(item.differenceCents, 0);
  assert.match(item.note, /fee of 3934 cents/);
  assert.match(item.note, /not journaled/);
});

test("a payment the ledger holds and Stripe does not list is local_only", () => {
  const [item] = diff([], [collectedInLedger()]);
  assert.equal(item.classification, "local_only");
  assert.equal(item.ledgerRef, "OP_PAID");
  assert.equal(item.providerAmountCents, null);
  assert.equal(item.differenceCents, -125320);
});

test("a succeeded payment with no operation id at all is provider_only with its amount (the planted case)", () => {
  const [item] = diff([payment({ providerRef: "pi_planted", operationId: null, amountCents: 4242, feeCents: null })], []);
  assert.equal(item.classification, "provider_only");
  assert.equal(item.providerRef, "pi_planted");
  assert.equal(item.providerAmountCents, 4242);
  assert.equal(item.ledgerAmountCents, null);
  assert.equal(item.differenceCents, 4242);
  assert.match(item.note, /no operation id/);
});

test("a succeeded payment naming an operation the ledger never saw is provider_only", () => {
  const [item] = diff([payment({ operationId: "OP_UNKNOWN", providerRef: "pi_unknown" })], []);
  assert.equal(item.classification, "provider_only");
  assert.match(item.note, /OP_UNKNOWN/);
});

test("same operation, different amounts: amount_mismatch with a signed difference (provider minus ledger)", () => {
  const [item] = diff([payment({ amountCents: 125000 })], [collectedInLedger()]);
  assert.equal(item.classification, "amount_mismatch");
  // Stripe holds 320 cents less than the ledger says.
  assert.equal(item.differenceCents, -320);
});

test("a refund requested more than 24 hours ago and never confirmed at Stripe is stale, with what is still owed", () => {
  const [item] = diff(
    [],
    [refundInLedger({ cashCents: 0, openClearingCents: -89172, state: "requested", requestedAt: TWO_DAYS_AGO, providerRef: null })],
  );
  assert.equal(item.classification, "stale");
  assert.match(item.note, /48 hours ago/);
  assert.match(item.note, /89172 cents still open on the ledger's clearing account/);
});

test("a refund requested an hour ago and not yet confirmed is matched at zero, not stale", () => {
  const [item] = diff([], [refundInLedger({ cashCents: 0, openClearingCents: -89172, state: "requested", providerRef: null })]);
  assert.equal(item.classification, "matched");
  assert.equal(item.ledgerAmountCents, 0);
  assert.match(item.note, /not confirmed yet/);
});

test("a refund still pending at Stripe after the threshold is stale; a young one is matched in flight", () => {
  const [old] = diff(
    [refund({ status: "pending", statusWord: "pending", createdAt: TWO_DAYS_AGO })],
    [refundInLedger({ cashCents: 0, openClearingCents: -89172, state: "accepted" })],
  );
  assert.equal(old.classification, "stale");
  const [young] = diff(
    [refund({ status: "pending", statusWord: "pending" })],
    [refundInLedger({ cashCents: 0, openClearingCents: -89172, state: "accepted" })],
  );
  assert.equal(young.classification, "matched");
  assert.match(young.note, /in flight/);
});

test("a completed refund on both sides is matched with negative amounts", () => {
  const [item] = diff([refund()], [refundInLedger()]);
  assert.equal(item.classification, "matched");
  assert.equal(item.providerAmountCents, -89172);
  assert.equal(item.ledgerAmountCents, -89172);
  assert.equal(item.differenceCents, 0);
});

test("a refund that left Stripe while the ledger still shows the liability open is provider_only", () => {
  const [item] = diff([refund()], [refundInLedger({ cashCents: 0, openClearingCents: -89172, state: "accepted" })]);
  assert.equal(item.classification, "provider_only");
  assert.equal(item.differenceCents, -89172);
  assert.match(item.note, /missing webhook/);
  assert.match(item.note, /89172 cents still open/);
});

test("a refund that failed at Stripe posts nothing: matched at zero, the liability stays open", () => {
  const [item] = diff(
    [refund({ status: "failed", statusWord: "failed" })],
    [refundInLedger({ cashCents: 0, openClearingCents: -89172, state: "failed" })],
  );
  assert.equal(item.classification, "matched");
  assert.match(item.note, /still owed/);
});

test("a failed refund the ledger booked as completed is an amount_mismatch", () => {
  const [item] = diff([refund({ status: "failed", statusWord: "failed" })], [refundInLedger()]);
  assert.equal(item.classification, "amount_mismatch");
});

test("a parked payment (unapplied_cash_received) is matched cash: the account moved, whatever the policy status", () => {
  const [item] = diff([payment()], [collectedInLedger({ state: "paid_not_bound" })]);
  assert.equal(item.classification, "matched");
});

test("a reversed (voided) operation is matched at zero when Stripe shows nothing for it", () => {
  const [item] = diff([], [collectedInLedger({ cashCents: 0, reversed: true, state: "voided", providerRef: "pi_local_fake" })]);
  assert.equal(item.classification, "matched");
  assert.equal(item.ledgerAmountCents, 0);
  assert.match(item.note, /reversed by a correction/);
});

test("a reversed operation for which Stripe shows a succeeded payment is provider_only", () => {
  const [item] = diff([payment()], [collectedInLedger({ cashCents: 0, reversed: true, state: "voided" })]);
  assert.equal(item.classification, "provider_only");
  assert.equal(item.differenceCents, 125320);
  assert.match(item.note, /reversed by a correction/);
});

test("a payment whose metadata was lost is still paired through the PaymentIntent id the ledger recorded", () => {
  const [item] = diff([payment({ operationId: null })], [collectedInLedger()]);
  assert.equal(item.classification, "matched");
  assert.equal(item.ledgerRef, "OP_PAID");
});

test("a failed refund the ledger never heard of moved no money: matched, not a break", () => {
  const [item] = diff([refund({ status: "failed", statusWord: "canceled", operationId: null, providerRef: "re_dashboard" })], []);
  assert.equal(item.classification, "matched");
  assert.match(item.note, /canceled/);
});

test("a checkout that was never paid moves no cash on either side and is matched at zero", () => {
  const [item] = diff([], [collectedInLedger({ cashCents: 0, state: "provider_accepted", providerRef: null })]);
  assert.equal(item.classification, "matched");
  assert.match(item.note, /moved no cash on either side/);
});

test("every record produces exactly one item and the counts add up", () => {
  const items = diff(
    [payment(), refund(), payment({ providerRef: "pi_planted", operationId: null, amountCents: 4242 })],
    [collectedInLedger(), refundInLedger(), collectedInLedger({ operationId: "OP_LOCAL", providerRef: "pi_local" })],
  );
  assert.equal(items.length, 4);
  const counts = countByClassification(items);
  assert.deepEqual(counts, { matched: 2, local_only: 1, provider_only: 1, amount_mismatch: 0, stale: 0 });
});

test("two provider records naming the same operation: the second one is provider_only, never double-matched", () => {
  const items = diff([payment(), payment({ providerRef: "pi_second" })], [collectedInLedger()]);
  assert.deepEqual(
    items.map((item) => item.classification),
    ["matched", "provider_only"],
  );
});

// ---------------------------------------------------------------------------
// The claim payout rail (LOCAL SIMULATOR). Same five rules, a second source.
// ---------------------------------------------------------------------------

test("a settled rail payout the ledger booked is matched, paired through the transfer reference alone", () => {
  const [item] = diff([railPayout()], [railPayoutInLedger()], RAIL_STALE_AFTER_HOURS);
  assert.equal(item.classification, "matched");
  assert.equal(item.ledgerRef, "OP_PAYOUT");
  assert.equal(item.differenceCents, 0);
});

test("a rail payout the simulator settled and the ledger did not book is provider_only (the planted payout mismatch)", () => {
  const [item] = diff(
    [railPayout()],
    [railPayoutInLedger({ cashCents: 0, openClearingCents: -120000, state: "provider_accepted" })],
    RAIL_STALE_AFTER_HOURS,
  );
  assert.equal(item.classification, "provider_only");
  assert.equal(item.providerAmountCents, -120000);
  assert.equal(item.differenceCents, -120000);
  assert.match(item.note, /unrun settlement job/);
});

test("a rail payout the simulator holds and the ledger knows nothing about is provider_only", () => {
  const [item] = diff([railPayout({ providerRef: "sim_tr_planted" })], [], RAIL_STALE_AFTER_HOURS);
  assert.equal(item.classification, "provider_only");
  assert.equal(item.providerRef, "sim_tr_planted");
  assert.match(item.note, /no operation id at all/);
});

test("a rail payout sent more than three days ago and neither settled nor returned is stale", () => {
  const [item] = diff(
    [railPayout({ status: "pending", statusWord: "sent", createdAt: FOUR_DAYS_AGO })],
    [railPayoutInLedger({ cashCents: 0, openClearingCents: -120000, state: "provider_accepted", requestedAt: FOUR_DAYS_AGO })],
    RAIL_STALE_AFTER_HOURS,
  );
  assert.equal(item.classification, "stale");
  assert.match(item.note, /still sent at the provider 96 hours/);
});

test("a rail payout sent two days ago is matched in flight, under the three-day threshold", () => {
  const [item] = diff(
    [railPayout({ status: "pending", statusWord: "sent" })],
    [railPayoutInLedger({ cashCents: 0, openClearingCents: -120000, state: "provider_accepted" })],
    RAIL_STALE_AFTER_HOURS,
  );
  assert.equal(item.classification, "matched");
  assert.match(item.note, /in flight at the provider for 48 hours \(sent\)/);
});

test("a returned rail payout nets to zero on both sides and is matched, with the bank's own word", () => {
  const [item] = diff(
    [railPayout({ status: "failed", statusWord: "returned" })],
    [railPayoutInLedger({ cashCents: 0, openClearingCents: 0, state: "returned" })],
    RAIL_STALE_AFTER_HOURS,
  );
  assert.equal(item.classification, "matched");
  assert.match(item.note, /returned at the provider, no cash stayed out/);
});

test("a returned payout the ledger never learned about is not stale: nothing more is expected on it", () => {
  const [item] = diff([], [railPayoutInLedger({ cashCents: 0, state: "returned", requestedAt: FOUR_DAYS_AGO })], RAIL_STALE_AFTER_HOURS);
  assert.equal(item.classification, "matched");
  assert.match(item.note, /moved no cash on either side/);
});

// ---------------------------------------------------------------------------
// The date of the compared record (review finding F-B10-01)
// ---------------------------------------------------------------------------

test("a paired item is dated by the provider, which is the authority on when its money moved", () => {
  const [item] = diff([payment({ createdAt: TWO_DAYS_AGO })], [collectedInLedger()]);
  assert.equal(item.recordAt, TWO_DAYS_AGO);
});

test("a provider-only item is dated by the provider record", () => {
  const [item] = diff([payment({ providerRef: "pi_planted", operationId: null, createdAt: FOUR_DAYS_AGO })], []);
  assert.equal(item.recordAt, FOUR_DAYS_AGO);
});

test("a ledger-only item is dated by the money operation, the only record there is", () => {
  const [item] = diff([], [collectedInLedger({ requestedAt: FOUR_DAYS_AGO })]);
  assert.equal(item.classification, "local_only");
  assert.equal(item.recordAt, FOUR_DAYS_AGO);
});

test("every item carries a record date, whatever its classification", () => {
  const items = diff(
    [payment(), refund(), payment({ providerRef: "pi_planted", operationId: null })],
    [collectedInLedger(), refundInLedger(), collectedInLedger({ operationId: "OP_LOCAL", providerRef: "pi_local" })],
  );
  assert.ok(items.every((item) => typeof item.recordAt === "string" && !Number.isNaN(Date.parse(item.recordAt))));
});
