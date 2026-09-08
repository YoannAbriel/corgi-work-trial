import { test } from "node:test";
import assert from "node:assert/strict";
import { mirroredLines } from "./reverse";

test("a reversal mirrors every line: debits become credits and credits become debits", () => {
  const original = [
    { account_id: "cash_stripe", debit_cents: "125320", credit_cents: "0" },
    { account_id: "premium_receivable", debit_cents: "0", credit_cents: "125320" },
  ];
  assert.deepEqual(mirroredLines(original), [
    { accountId: "cash_stripe", creditCents: 125320 },
    { accountId: "premium_receivable", debitCents: 125320 },
  ]);
});

test("original plus reversal nets to zero on every account", () => {
  const original = [
    { account_id: "premium_receivable", debit_cents: "5320", credit_cents: "0" },
    { account_id: "premium_tax_payable", debit_cents: "0", credit_cents: "2820" },
    { account_id: "fee_income", debit_cents: "0", credit_cents: "2500" },
  ];
  const net = new Map<string, number>();
  for (const line of original) {
    net.set(line.account_id, (net.get(line.account_id) ?? 0) + Number(line.debit_cents) - Number(line.credit_cents));
  }
  for (const line of mirroredLines(original)) {
    net.set(line.accountId, (net.get(line.accountId) ?? 0) + (line.debitCents ?? 0) - (line.creditCents ?? 0));
  }
  for (const [account, balance] of net) {
    assert.equal(balance, 0, account);
  }
});

test("non-integer cents are refused", () => {
  assert.throws(() => mirroredLines([{ account_id: "cash_stripe", debit_cents: "12.5", credit_cents: "0" }]), /integer cents/);
});
