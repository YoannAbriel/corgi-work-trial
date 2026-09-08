import { test } from "node:test";
import assert from "node:assert/strict";
import { entryTotals, issuanceAndCollectionEntries, unappliedCashReceivedEntry } from "./policy-entries";

// The recited example, decided by Yoann on 2026-09-08:
//   $1,200 annual premium, California premium tax 235 bps = 2820 cents, $25 fee,
//   15% broker commission, term starting 2028-03-01, paid the same day.
const RECITED_EXAMPLE = {
  operationId: "11111111-1111-4111-8111-111111111111",
  policyId: "22222222-2222-4222-8222-222222222222",
  policyNumber: "CGP-01001",
  brokerId: "33333333-3333-4333-8333-333333333333",
  effectiveAt: "2028-03-01",
  paymentDate: "2028-03-01",
  annualPremiumCents: 120000,
  taxCents: 2820,
  feeCents: 2500,
  commissionRateBps: 1500,
};

function amountOn(
  entries: ReturnType<typeof issuanceAndCollectionEntries>,
  entryType: string,
  accountId: string,
): { debitCents: number; creditCents: number } {
  const entry = entries.find((candidate) => candidate.header.entryType === entryType);
  assert.ok(entry, `no ${entryType} entry`);
  const line = entry.lines.find((candidate) => candidate.accountId === accountId);
  assert.ok(line, `no ${accountId} line on ${entryType}`);
  return { debitCents: line.debitCents ?? 0, creditCents: line.creditCents ?? 0 };
}

test("issuance and collection post exactly four entries", () => {
  const entries = issuanceAndCollectionEntries(RECITED_EXAMPLE);
  assert.deepEqual(
    entries.map((entry) => entry.header.entryType),
    ["premium_written", "tax_and_fee_billed", "premium_collected", "commission_earned"],
  );
});

test("every entry balances: debits equal credits", () => {
  for (const entry of issuanceAndCollectionEntries(RECITED_EXAMPLE)) {
    const totals = entryTotals(entry);
    assert.equal(totals.debitCents, totals.creditCents, `${entry.header.entryType} does not balance`);
  }
});

test("the amounts are the recited ones", () => {
  const entries = issuanceAndCollectionEntries(RECITED_EXAMPLE);
  // Written premium: the whole annual premium becomes a receivable and an unearned liability.
  assert.equal(amountOn(entries, "premium_written", "premium_receivable").debitCents, 120000);
  assert.equal(amountOn(entries, "premium_written", "unearned_premium").creditCents, 120000);
  // Tax and fee are billed on the same charge but kept in their own accounts.
  assert.equal(amountOn(entries, "tax_and_fee_billed", "premium_receivable").debitCents, 5320);
  assert.equal(amountOn(entries, "tax_and_fee_billed", "premium_tax_payable").creditCents, 2820);
  assert.equal(amountOn(entries, "tax_and_fee_billed", "fee_income").creditCents, 2500);
  // Collection: the full charge arrives at Stripe and clears the receivable.
  assert.equal(amountOn(entries, "premium_collected", "cash_stripe").debitCents, 125320);
  assert.equal(amountOn(entries, "premium_collected", "premium_receivable").creditCents, 125320);
  // Commission: 15% of the collected PREMIUM, tax and fee excluded.
  assert.equal(amountOn(entries, "commission_earned", "commission_expense").debitCents, 18000);
  assert.equal(amountOn(entries, "commission_earned", "commission_payable").creditCents, 18000);
});

test("the receivable opened by the two billing entries is exactly the amount collected", () => {
  const entries = issuanceAndCollectionEntries(RECITED_EXAMPLE);
  const billed =
    amountOn(entries, "premium_written", "premium_receivable").debitCents +
    amountOn(entries, "tax_and_fee_billed", "premium_receivable").debitCents;
  assert.equal(billed, amountOn(entries, "premium_collected", "premium_receivable").creditCents);
});

test("the illustrative 3% example of ARCHITECTURE.md section 3 posts as written there", () => {
  const entries = issuanceAndCollectionEntries({ ...RECITED_EXAMPLE, taxCents: 3600 });
  assert.equal(amountOn(entries, "tax_and_fee_billed", "premium_receivable").debitCents, 6100);
  assert.equal(amountOn(entries, "premium_collected", "cash_stripe").debitCents, 126100);
  assert.equal(amountOn(entries, "commission_earned", "commission_expense").debitCents, 18000);
});

test("premium is dated on the effective date, cash on the day it moved", () => {
  const entries = issuanceAndCollectionEntries({
    ...RECITED_EXAMPLE,
    effectiveAt: "2028-03-01",
    paymentDate: "2028-02-20", // paid ten days before coverage starts
  });
  const dateOf = (entryType: string) => entries.find((entry) => entry.header.entryType === entryType)?.header.effectiveAt;
  assert.equal(dateOf("premium_written"), "2028-03-01");
  assert.equal(dateOf("tax_and_fee_billed"), "2028-03-01");
  assert.equal(dateOf("premium_collected"), "2028-02-20");
  assert.equal(dateOf("commission_earned"), "2028-02-20");
});

test("every entry is filed under the money operation, one entry type each", () => {
  const entries = issuanceAndCollectionEntries(RECITED_EXAMPLE);
  const keys = entries.map((entry) => `${entry.header.sourceKind}:${entry.header.sourceId}:${entry.header.entryType}`);
  assert.equal(new Set(keys).size, keys.length, "two entries share the same unique key");
  for (const entry of entries) {
    assert.equal(entry.header.sourceKind, "money_operation");
    assert.equal(entry.header.sourceId, RECITED_EXAMPLE.operationId);
  }
});

test("a broker on a 0% commission gets no commission entry rather than an empty one", () => {
  const entries = issuanceAndCollectionEntries({ ...RECITED_EXAMPLE, commissionRateBps: 0 });
  assert.equal(
    entries.find((entry) => entry.header.entryType === "commission_earned"),
    undefined,
  );
});

// Rule 14: money that arrives while the broker is not eligible is parked, then applied.
test("parked money is booked at receipt against the customer liability, and balances", () => {
  const parked = unappliedCashReceivedEntry({
    operationId: RECITED_EXAMPLE.operationId,
    policyId: RECITED_EXAMPLE.policyId,
    policyNumber: RECITED_EXAMPLE.policyNumber,
    brokerId: RECITED_EXAMPLE.brokerId,
    paymentDate: "2028-03-01",
    amountCents: 125320,
    reason: "broker not eligible",
  });
  assert.equal(parked.header.entryType, "unapplied_cash_received");
  assert.equal(parked.header.sourceId, RECITED_EXAMPLE.operationId);
  assert.deepEqual(parked.lines, [
    { accountId: "cash_stripe", debitCents: 125320 },
    { accountId: "unapplied_customer_cash", creditCents: 125320 },
  ]);
  assert.deepEqual(entryTotals(parked), { debitCents: 125320, creditCents: 125320 });
});

test("binding a parked payment applies the cash instead of booking it a second time", () => {
  const entries = issuanceAndCollectionEntries({ ...RECITED_EXAMPLE, collectedFrom: "unapplied_customer_cash" });
  assert.equal(amountOn(entries, "premium_collected", "unapplied_customer_cash").debitCents, 125320);
  assert.equal(amountOn(entries, "premium_collected", "premium_receivable").creditCents, 125320);
  // cash_stripe is never touched by the application step: it was debited at receipt.
  for (const entry of entries) {
    assert.ok(!entry.lines.some((line) => line.accountId === "cash_stripe"), `${entry.header.entryType} touches cash_stripe`);
  }
  // The default path is unchanged.
  assert.equal(amountOn(issuanceAndCollectionEntries(RECITED_EXAMPLE), "premium_collected", "cash_stripe").debitCents, 125320);
});
