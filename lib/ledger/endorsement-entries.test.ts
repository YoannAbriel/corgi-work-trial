import { test } from "node:test";
import assert from "node:assert/strict";
import { endorsementCollectionEntries, endorsementRefundRequestedEntry } from "./endorsement-entries";
import { entryTotals } from "./policy-entries";
import type { JournalEntryDraft } from "./post";

// The recited example (DECISIONS.md): $1,200 raised to $1,800 on 2028-06-09 (day 100 of 365):
// delta 43561, tax 1023, collected 44584, commission 6534. Lowered to $600 instead: refund
// 43562 + 1024 = 44586, clawback 6534.
const POLICY = {
  policyId: "22222222-2222-4222-8222-222222222222",
  policyNumber: "CGP-01001",
  brokerId: "33333333-3333-4333-8333-333333333333",
};

const collected = endorsementCollectionEntries({
  operationId: "66666666-6666-4666-8666-666666666666",
  ...POLICY,
  effectiveAt: "2028-06-09",
  paymentDate: "2028-06-10",
  deltaPremiumCents: 43561,
  deltaTaxCents: 1023,
  commissionCents: 6534,
});

function amountOn(entry: JournalEntryDraft, accountId: string): { debitCents: number; creditCents: number } {
  const line = entry.lines.find((candidate) => candidate.accountId === accountId);
  assert.ok(line, `no ${accountId} line on ${entry.header.entryType}`);
  return { debitCents: line.debitCents ?? 0, creditCents: line.creditCents ?? 0 };
}

function entryOfType(entries: JournalEntryDraft[], entryType: string): JournalEntryDraft {
  const entry = entries.find((candidate) => candidate.header.entryType === entryType);
  assert.ok(entry, `no ${entryType} entry`);
  return entry;
}

test("collecting a positive delta posts four entries that name the endorsement, and no fee", () => {
  assert.deepEqual(
    collected.map((entry) => entry.header.entryType),
    [
      "endorsement_premium_written",
      "endorsement_tax_billed",
      "endorsement_premium_collected",
      "endorsement_commission_earned",
    ],
  );
  for (const entry of collected) {
    const totals = entryTotals(entry);
    assert.equal(totals.debitCents, totals.creditCents, `${entry.header.entryType} does not balance`);
    assert.equal(entry.header.sourceKind, "money_operation");
    assert.equal(entry.header.sourceId, "66666666-6666-4666-8666-666666666666");
    assert.ok(!entry.lines.some((line) => line.accountId === "fee_income"), "no fee on an endorsement");
  }
});

test("the amounts are the recited ones", () => {
  const written = entryOfType(collected, "endorsement_premium_written");
  assert.equal(amountOn(written, "premium_receivable").debitCents, 43561);
  assert.equal(amountOn(written, "unearned_premium").creditCents, 43561);
  assert.equal(written.header.effectiveAt, "2028-06-09"); // written on the endorsement date

  const tax = entryOfType(collected, "endorsement_tax_billed");
  assert.equal(amountOn(tax, "premium_tax_payable").creditCents, 1023);

  const cash = entryOfType(collected, "endorsement_premium_collected");
  assert.equal(amountOn(cash, "cash_stripe").debitCents, 44584);
  assert.equal(amountOn(cash, "premium_receivable").creditCents, 44584);
  assert.equal(cash.header.effectiveAt, "2028-06-10"); // cash on the day it moved

  const commission = entryOfType(collected, "endorsement_commission_earned");
  assert.equal(amountOn(commission, "commission_payable").creditCents, 6534);
  assert.equal(commission.header.effectiveAt, "2028-06-10");
});

test("the receivable opened by the endorsement is cleared by the collection", () => {
  let receivable = 0;
  for (const entry of collected) {
    for (const line of entry.lines) {
      if (line.accountId === "premium_receivable") receivable += (line.debitCents ?? 0) - (line.creditCents ?? 0);
    }
  }
  assert.equal(receivable, 0);
});

test("a zero tax or a zero commission leaves that entry out instead of posting an empty one", () => {
  const withoutTaxOrCommission = endorsementCollectionEntries({
    operationId: "66666666-6666-4666-8666-666666666666",
    ...POLICY,
    effectiveAt: "2028-06-09",
    paymentDate: "2028-06-09",
    deltaPremiumCents: 100,
    deltaTaxCents: 0,
    commissionCents: 0,
  });
  assert.deepEqual(
    withoutTaxOrCommission.map((entry) => entry.header.entryType),
    ["endorsement_premium_written", "endorsement_premium_collected"],
  );
});

test("a refund or a zero delta is refused by the collection entries", () => {
  assert.throws(
    () =>
      endorsementCollectionEntries({
        operationId: "x",
        ...POLICY,
        effectiveAt: "2028-06-09",
        paymentDate: "2028-06-09",
        deltaPremiumCents: 0,
        deltaTaxCents: 0,
        commissionCents: 0,
      }),
    /positive delta/,
  );
});

test("a premium reduction opens the refund liability with the premium and its tax", () => {
  const requested = endorsementRefundRequestedEntry({
    refundOperationId: "77777777-7777-4777-8777-777777777777",
    ...POLICY,
    effectiveAt: "2028-06-09",
    refundedPremiumCents: 43562,
    refundedTaxCents: 1024,
    createdBy: "user-1",
  });
  assert.equal(requested.header.entryType, "endorsement_refund_requested");
  assert.equal(requested.header.sourceId, "77777777-7777-4777-8777-777777777777");
  assert.equal(amountOn(requested, "unearned_premium").debitCents, 43562);
  assert.equal(amountOn(requested, "premium_tax_payable").debitCents, 1024);
  assert.equal(amountOn(requested, "refund_payable").creditCents, 44586);
  const totals = entryTotals(requested);
  assert.equal(totals.debitCents, totals.creditCents);

  // A capped tax of zero simply leaves the tax line out.
  const withoutTax = endorsementRefundRequestedEntry({
    refundOperationId: "77777777-7777-4777-8777-777777777777",
    ...POLICY,
    effectiveAt: "2028-06-09",
    refundedPremiumCents: 43562,
    refundedTaxCents: 0,
    createdBy: null,
  });
  assert.equal(withoutTax.lines.length, 2);
  assert.equal(amountOn(withoutTax, "refund_payable").creditCents, 43562);
});
