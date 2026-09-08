import { test } from "node:test";
import assert from "node:assert/strict";
import {
  premiumEarnedToDateEntry,
  refundCompletedEntries,
  refundRequestedEntry,
} from "./cancellation-entries";
import { entryTotals } from "./policy-entries";
import type { JournalEntryDraft } from "./post";

// The recited example (DECISIONS.md): $1,200 written on 2028-03-01, California tax 2820 cents,
// 15% commission, cancelled effective 2028-06-09 (day 100 of 365).
//   earned 32876, unearned 87124, tax back 2048, refund 89172, clawback 13068.
const CANCELLATION_EVENT_ID = "44444444-4444-4444-8444-444444444444";
const REFUND_OPERATION_ID = "55555555-5555-4555-8555-555555555555";
const POLICY = {
  policyId: "22222222-2222-4222-8222-222222222222",
  policyNumber: "CGP-01001",
  brokerId: "33333333-3333-4333-8333-333333333333",
};

function amountOn(entry: JournalEntryDraft, accountId: string): { debitCents: number; creditCents: number } {
  const line = entry.lines.find((candidate) => candidate.accountId === accountId);
  assert.ok(line, `no ${accountId} line on ${entry.header.entryType}`);
  return { debitCents: line.debitCents ?? 0, creditCents: line.creditCents ?? 0 };
}

const earnedToDate = premiumEarnedToDateEntry({
  cancellationEventId: CANCELLATION_EVENT_ID,
  ...POLICY,
  effectiveAt: "2028-06-09",
  earnedPremiumCents: 32876,
  createdBy: "user-1",
});

const requested = refundRequestedEntry({
  refundOperationId: REFUND_OPERATION_ID,
  ...POLICY,
  effectiveAt: "2028-06-09",
  refundedPremiumCents: 87124,
  refundedTaxCents: 2048,
  createdBy: "user-1",
});

const completed = refundCompletedEntries({
  refundOperationId: REFUND_OPERATION_ID,
  ...POLICY,
  refundedOn: "2028-06-09",
  totalRefundCents: 89172,
  commissionClawbackCents: 13068,
});

test("every cancellation entry balances: debits equal credits", () => {
  for (const entry of [earnedToDate, requested, ...completed]) {
    const totals = entryTotals(entry);
    assert.equal(totals.debitCents, totals.creditCents, `${entry.header.entryType} does not balance`);
  }
});

test("the earning entry moves exactly the earned premium out of the unearned liability", () => {
  assert.equal(earnedToDate.header.entryType, "premium_earned_to_date");
  assert.equal(amountOn(earnedToDate, "unearned_premium").debitCents, 32876);
  assert.equal(amountOn(earnedToDate, "earned_premium").creditCents, 32876);
  // Filed under the cancellation policy event: no money moves, so no money operation exists.
  assert.equal(earnedToDate.header.sourceKind, "policy_event");
  assert.equal(earnedToDate.header.sourceId, CANCELLATION_EVENT_ID);
});

test("the refund entry takes back the unearned premium and its tax, never the fee", () => {
  assert.equal(amountOn(requested, "unearned_premium").debitCents, 87124);
  assert.equal(amountOn(requested, "premium_tax_payable").debitCents, 2048);
  assert.equal(amountOn(requested, "refund_payable").creditCents, 89172);
  // The fee is fully earned at issuance: no line ever touches fee_income on a cancellation.
  assert.equal(
    requested.lines.find((line) => line.accountId === "fee_income"),
    undefined,
  );
  assert.equal(requested.header.sourceKind, "money_operation");
  assert.equal(requested.header.sourceId, REFUND_OPERATION_ID);
});

test("earning plus refund empty the whole written premium out of the unearned liability", () => {
  const takenOutOfUnearned =
    amountOn(earnedToDate, "unearned_premium").debitCents + amountOn(requested, "unearned_premium").debitCents;
  assert.equal(takenOutOfUnearned, 120000);
});

test("completion pays the customer and claws the commission back", () => {
  assert.deepEqual(
    completed.map((entry) => entry.header.entryType),
    ["refund_completed", "commission_clawback"],
  );
  assert.equal(amountOn(completed[0], "refund_payable").debitCents, 89172);
  assert.equal(amountOn(completed[0], "cash_stripe").creditCents, 89172);
  assert.equal(amountOn(completed[1], "commission_payable").debitCents, 13068);
  assert.equal(amountOn(completed[1], "commission_expense").creditCents, 13068);
});

test("the liability opened at cancellation is exactly the amount cleared at completion", () => {
  assert.equal(amountOn(requested, "refund_payable").creditCents, amountOn(completed[0], "refund_payable").debitCents);
});

test("cash is dated the day the money moved, the refund liability the cancellation date", () => {
  const laterPayout = refundCompletedEntries({
    refundOperationId: REFUND_OPERATION_ID,
    ...POLICY,
    refundedOn: "2028-06-11", // Stripe sent it two days after the cancellation took effect
    totalRefundCents: 89172,
    commissionClawbackCents: 13068,
  });
  assert.equal(requested.header.effectiveAt, "2028-06-09");
  assert.equal(laterPayout[0].header.effectiveAt, "2028-06-11");
  assert.equal(laterPayout[1].header.effectiveAt, "2028-06-11");
});

test("all three refund entries share one key: the refund operation", () => {
  const keys = [requested, ...completed].map(
    (entry) => `${entry.header.sourceKind}:${entry.header.sourceId}:${entry.header.entryType}`,
  );
  assert.equal(new Set(keys).size, keys.length, "two entries share the same unique key");
  // A replayed webhook therefore hits the unique index instead of posting the money twice.
  assert.deepEqual(
    [...new Set([requested, ...completed].map((entry) => entry.header.sourceId))],
    [REFUND_OPERATION_ID],
  );
});

test("a zero clawback produces no entry rather than an empty one", () => {
  const withoutCommission = refundCompletedEntries({
    refundOperationId: REFUND_OPERATION_ID,
    ...POLICY,
    refundedOn: "2028-06-09",
    totalRefundCents: 89172,
    commissionClawbackCents: 0,
  });
  assert.deepEqual(
    withoutCommission.map((entry) => entry.header.entryType),
    ["refund_completed"],
  );
});

test("an empty earning or an empty refund is refused rather than posted", () => {
  assert.throws(
    () =>
      premiumEarnedToDateEntry({
        cancellationEventId: CANCELLATION_EVENT_ID,
        ...POLICY,
        effectiveAt: "2028-03-01",
        earnedPremiumCents: 0,
        createdBy: null,
      }),
    /positive amount/,
  );
  assert.throws(
    () =>
      refundRequestedEntry({
        refundOperationId: REFUND_OPERATION_ID,
        ...POLICY,
        effectiveAt: "2029-03-01",
        refundedPremiumCents: 0,
        refundedTaxCents: 0,
        createdBy: null,
      }),
    /positive refund/,
  );
});
