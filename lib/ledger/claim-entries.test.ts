import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claimPaymentReturnedEntries,
  claimPaymentSentEntry,
  claimPaymentSettledEntry,
  claimReserveAdjustedEntry,
  claimReserveSetEntry,
  type ClaimEntryContext,
} from "./claim-entries";
import { entryTotals } from "./policy-entries";
import type { JournalEntryDraft } from "./post";

// The worked example of ARCHITECTURE.md section 2, followed step by step:
// reserve $5,000, reduced to $4,000, payment $1,200 sent, settled, then returned by the bank.
const RESERVE_CENTS = 500000;
const REDUCED_RESERVE_CENTS = 400000;
const PAYMENT_CENTS = 120000;

const CONTEXT: ClaimEntryContext = {
  claimEventId: "66666666-6666-4666-8666-666666666666",
  claimId: "77777777-7777-4777-8777-777777777777",
  claimNumber: "CLM-00001",
  policyId: "22222222-2222-4222-8222-222222222222",
  brokerId: "33333333-3333-4333-8333-333333333333",
  effectiveAt: "2026-09-08",
  createdBy: "88888888-8888-4888-8888-888888888888",
};

function amountOn(entry: JournalEntryDraft, accountId: string): { debitCents: number; creditCents: number } {
  const line = entry.lines.find((candidate) => candidate.accountId === accountId);
  assert.ok(line, `no ${accountId} line on ${entry.header.entryType}`);
  return { debitCents: line.debitCents ?? 0, creditCents: line.creditCents ?? 0 };
}

test("setting a $5,000 reserve recognises the expense and sets the money aside", () => {
  const entry = claimReserveSetEntry(CONTEXT, RESERVE_CENTS);
  assert.equal(entry.header.entryType, "claim_reserve_set");
  assert.equal(amountOn(entry, "incurred_loss_expense").debitCents, RESERVE_CENTS);
  assert.equal(amountOn(entry, "claim_reserve").creditCents, RESERVE_CENTS);
});

test("lowering the reserve to $4,000 books the $1,000 difference the other way round", () => {
  const entry = claimReserveAdjustedEntry(CONTEXT, REDUCED_RESERVE_CENTS - RESERVE_CENTS);
  assert.equal(entry.header.entryType, "claim_reserve_adjusted");
  assert.equal(amountOn(entry, "claim_reserve").debitCents, 100000);
  assert.equal(amountOn(entry, "incurred_loss_expense").creditCents, 100000);
});

test("raising the reserve books more expense, not less", () => {
  const entry = claimReserveAdjustedEntry(CONTEXT, 75000);
  assert.equal(amountOn(entry, "incurred_loss_expense").debitCents, 75000);
  assert.equal(amountOn(entry, "claim_reserve").creditCents, 75000);
});

test("an adjustment of zero is refused: the caller records the event and posts no entry", () => {
  assert.throws(() => claimReserveAdjustedEntry(CONTEXT, 0), /non-zero/);
});

test("sending a $1,200 payment takes it out of the reserve and owes it on the rail", () => {
  const entry = claimPaymentSentEntry(CONTEXT, PAYMENT_CENTS);
  assert.equal(entry.header.entryType, "claim_payment_sent");
  assert.equal(amountOn(entry, "claim_reserve").debitCents, PAYMENT_CENTS);
  assert.equal(amountOn(entry, "claims_payable").creditCents, PAYMENT_CENTS);
});

test("settling it turns what we owed into cash gone from the claims rail", () => {
  const entry = claimPaymentSettledEntry(CONTEXT, PAYMENT_CENTS);
  assert.equal(amountOn(entry, "claims_payable").debitCents, PAYMENT_CENTS);
  assert.equal(amountOn(entry, "cash_claims_rail").creditCents, PAYMENT_CENTS);
});

test("a return brings the cash back and restores the reserve, in two named entries", () => {
  const [returned, restored] = claimPaymentReturnedEntries(CONTEXT, PAYMENT_CENTS);

  assert.equal(returned.header.entryType, "claim_payment_returned");
  assert.equal(amountOn(returned, "cash_claims_rail").debitCents, PAYMENT_CENTS);
  assert.equal(amountOn(returned, "claims_payable").creditCents, PAYMENT_CENTS);

  assert.equal(restored.header.entryType, "claim_reserve_restored");
  assert.equal(amountOn(restored, "claims_payable").debitCents, PAYMENT_CENTS);
  assert.equal(amountOn(restored, "claim_reserve").creditCents, PAYMENT_CENTS);
});

test("the whole example nets to the claim being back where it started, reserve included", () => {
  // Net movement per account across set, adjust, send, settle, return.
  const entries = [
    claimReserveSetEntry(CONTEXT, RESERVE_CENTS),
    claimReserveAdjustedEntry(CONTEXT, REDUCED_RESERVE_CENTS - RESERVE_CENTS),
    claimPaymentSentEntry(CONTEXT, PAYMENT_CENTS),
    claimPaymentSettledEntry(CONTEXT, PAYMENT_CENTS),
    ...claimPaymentReturnedEntries(CONTEXT, PAYMENT_CENTS),
  ];

  const net = new Map<string, number>();
  for (const entry of entries) {
    for (const line of entry.lines) {
      const movement = (line.debitCents ?? 0) - (line.creditCents ?? 0);
      net.set(line.accountId, (net.get(line.accountId) ?? 0) + movement);
    }
  }

  // The expense is the $4,000 the adjuster expects the claim to cost, unchanged by a payment
  // that went out and came back.
  assert.equal(net.get("incurred_loss_expense"), REDUCED_RESERVE_CENTS);
  // The reserve is a credit balance of the same $4,000: the payment left it and came back.
  assert.equal(net.get("claim_reserve"), -REDUCED_RESERVE_CENTS);
  // Nothing is owed on the rail and no cash is out any more.
  assert.equal(net.get("claims_payable"), 0);
  assert.equal(net.get("cash_claims_rail"), 0);
});

test("every claim entry balances and is filed under the claim event that caused it", () => {
  const entries = [
    claimReserveSetEntry(CONTEXT, RESERVE_CENTS),
    claimReserveAdjustedEntry(CONTEXT, -100000),
    claimPaymentSentEntry(CONTEXT, PAYMENT_CENTS),
    claimPaymentSettledEntry(CONTEXT, PAYMENT_CENTS),
    ...claimPaymentReturnedEntries(CONTEXT, PAYMENT_CENTS),
  ];
  for (const entry of entries) {
    const totals = entryTotals(entry);
    assert.equal(totals.debitCents, totals.creditCents, `${entry.header.entryType} does not balance`);
    assert.equal(entry.header.sourceKind, "claim_event");
    assert.equal(entry.header.sourceId, CONTEXT.claimEventId);
    assert.equal(entry.header.claimId, CONTEXT.claimId);
  }
});

test("a payment of zero or a negative reserve is refused before it can reach the database", () => {
  assert.throws(() => claimReserveSetEntry(CONTEXT, 0), /positive whole number of cents/);
  assert.throws(() => claimPaymentSentEntry(CONTEXT, -1), /positive whole number of cents/);
  assert.throws(() => claimPaymentSettledEntry(CONTEXT, 12.5), /positive whole number of cents/);
});
