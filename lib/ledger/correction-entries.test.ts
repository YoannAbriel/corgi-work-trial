import { test } from "node:test";
import assert from "node:assert/strict";
import { correctionCollectionEntries, correctionRebookEntries, correctionRefundRequestedEntry } from "./correction-entries";
import { entryTotals } from "./policy-entries";
import type { JournalEntryDraft } from "./post";

// The recited example (DECISIONS.md): $1,200 raised to $1,800, 365-day term from 2028-03-01.
// Entered by mistake effective 2028-07-09 (premium 38630, tax 907, collected 39537) and
// corrected to 2028-06-09 (premium 43561, tax 1023, owed 44584). Difference: 4931 of premium,
// 116 of tax, 5047 in total, 739 of commission.

const POLICY = {
  policyId: "22222222-2222-4222-8222-222222222222",
  policyNumber: "CGP-01001",
  brokerId: "33333333-3333-4333-8333-333333333333",
};
const REBOOK_EVENT_ID = "44444444-4444-4444-8444-444444444444";

const rebooked = correctionRebookEntries({
  rebookEventId: REBOOK_EVENT_ID,
  ...POLICY,
  correctedEffectiveAt: "2028-06-09",
  deltaPremiumCents: 43561,
  deltaTaxCents: 1023,
  createdBy: "55555555-5555-4555-8555-555555555555",
});

function amountOn(entry: JournalEntryDraft, accountId: string): { debitCents: number; creditCents: number } {
  const line = entry.lines.find((candidate) => candidate.accountId === accountId);
  assert.ok(line, `no ${accountId} line on ${entry.header.entryType}`);
  return { debitCents: line.debitCents ?? 0, creditCents: line.creditCents ?? 0 };
}

test("the re-book writes the corrected premium and tax on the CORRECTED date", () => {
  assert.deepEqual(
    rebooked.map((entry) => entry.header.entryType),
    ["endorsement_premium_written", "endorsement_tax_billed"],
  );
  for (const entry of rebooked) {
    assert.equal(entry.header.effectiveAt, "2028-06-09");
    // Filed under the correction, not under the Stripe payment: that is what tells the re-booked
    // entries apart from the ones the endorsement itself posted.
    assert.equal(entry.header.sourceKind, "correction");
    assert.equal(entry.header.sourceId, REBOOK_EVENT_ID);
  }
  assert.deepEqual(amountOn(rebooked[0], "premium_receivable"), { debitCents: 43561, creditCents: 0 });
  assert.deepEqual(amountOn(rebooked[0], "unearned_premium"), { debitCents: 0, creditCents: 43561 });
  assert.deepEqual(amountOn(rebooked[1], "premium_tax_payable"), { debitCents: 0, creditCents: 1023 });
});

test("the re-book never touches cash: Stripe still holds the money the customer paid", () => {
  for (const entry of rebooked) {
    assert.ok(
      !entry.lines.some((line) => line.accountId === "cash_stripe"),
      `${entry.header.entryType} touches cash_stripe, which a correction must never do`,
    );
  }
});

test("a correction to the last day of the term prices nothing, so it writes nothing", () => {
  assert.deepEqual(
    correctionRebookEntries({
      rebookEventId: REBOOK_EVENT_ID,
      ...POLICY,
      correctedEffectiveAt: "2029-03-01",
      deltaPremiumCents: 0,
      deltaTaxCents: 0,
      createdBy: null,
    }),
    [],
  );
});

test("the difference owed back leaves premium receivable, not unearned premium", () => {
  const owedBack = correctionRefundRequestedEntry({
    refundOperationId: "66666666-6666-4666-8666-666666666666",
    ...POLICY,
    correctedEffectiveAt: "2028-07-09",
    amountCents: 5047,
    createdBy: "55555555-5555-4555-8555-555555555555",
  });

  assert.equal(owedBack.header.entryType, "correction_refund_requested");
  assert.equal(owedBack.header.effectiveAt, "2028-07-09");
  // The unearned premium is already the corrected figure: the re-book wrote it. What is going
  // back is the part of the payment that turned out not to be premium at all.
  assert.deepEqual(amountOn(owedBack, "premium_receivable"), { debitCents: 5047, creditCents: 0 });
  assert.deepEqual(amountOn(owedBack, "refund_payable"), { debitCents: 0, creditCents: 5047 });
  assert.ok(!owedBack.lines.some((line) => line.accountId === "unearned_premium"));
  assert.deepEqual(entryTotals(owedBack), { debitCents: 5047, creditCents: 5047 });
});

test("the difference collected clears the receivable and earns commission on the extra premium", () => {
  const collected = correctionCollectionEntries({
    operationId: "77777777-7777-4777-8777-777777777777",
    ...POLICY,
    paymentDate: "2028-09-15",
    amountCents: 5047,
    commissionCents: 739,
  });

  assert.deepEqual(
    collected.map((entry) => entry.header.entryType),
    ["correction_premium_collected", "correction_commission_earned"],
  );
  // Cash entries carry the day the cash moved, never the corrected effective date.
  assert.equal(collected[0].header.effectiveAt, "2028-09-15");
  assert.deepEqual(amountOn(collected[0], "cash_stripe"), { debitCents: 5047, creditCents: 0 });
  assert.deepEqual(amountOn(collected[0], "premium_receivable"), { debitCents: 0, creditCents: 5047 });
  assert.deepEqual(amountOn(collected[1], "commission_payable"), { debitCents: 0, creditCents: 739 });
});

test("every entry a correction posts balances", () => {
  const everything = [
    ...rebooked,
    correctionRefundRequestedEntry({
      refundOperationId: "66666666-6666-4666-8666-666666666666",
      ...POLICY,
      correctedEffectiveAt: "2028-07-09",
      amountCents: 5047,
      createdBy: null,
    }),
    ...correctionCollectionEntries({
      operationId: "77777777-7777-4777-8777-777777777777",
      ...POLICY,
      paymentDate: "2028-09-15",
      amountCents: 5047,
      commissionCents: 739,
    }),
  ];
  for (const entry of everything) {
    const totals = entryTotals(entry);
    assert.equal(totals.debitCents, totals.creditCents, `${entry.header.entryType} does not balance`);
  }
});

test("an empty or negative amount is refused rather than posted as a meaningless entry", () => {
  assert.throws(() =>
    correctionRefundRequestedEntry({
      refundOperationId: "66666666-6666-4666-8666-666666666666",
      ...POLICY,
      correctedEffectiveAt: "2028-07-09",
      amountCents: 0,
      createdBy: null,
    }),
  );
  assert.throws(() =>
    correctionCollectionEntries({
      operationId: "77777777-7777-4777-8777-777777777777",
      ...POLICY,
      paymentDate: "2028-09-15",
      amountCents: 0,
      commissionCents: 0,
    }),
  );
  assert.throws(() =>
    correctionRebookEntries({
      rebookEventId: REBOOK_EVENT_ID,
      ...POLICY,
      correctedEffectiveAt: "2028-06-09",
      deltaPremiumCents: -1,
      deltaTaxCents: 0,
      createdBy: null,
    }),
  );
});
