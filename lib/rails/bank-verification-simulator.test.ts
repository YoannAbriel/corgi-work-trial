import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BankAccountRejected,
  SIMULATED_REACHABLE_ROUTING_NUMBERS,
  verifyClaimantBankAccount,
} from "./bank-verification-simulator";

const CLAIMANT = "Bay Area Fabrication LLC";
const REACHABLE_ROUTING_NUMBER = SIMULATED_REACHABLE_ROUTING_NUMBERS[0];

function check(overrides: Partial<Parameters<typeof verifyClaimantBankAccount>[0]> = {}) {
  return verifyClaimantBankAccount({
    claimantName: CLAIMANT,
    accountHolderName: CLAIMANT,
    routingNumber: REACHABLE_ROUTING_NUMBER,
    accountNumber: "000123456789",
    ...overrides,
  });
}

test("the account is verified when the holder is the claimant and the bank is reachable", () => {
  const result = check();
  assert.equal(result.status, "verified");
  assert.match(result.reason, /LOCAL SIMULATOR/);
});

test("it stores only the last four digits of each number, never the numbers", () => {
  const result = check({ routingNumber: "110000000", accountNumber: "000123456789" });
  assert.equal(result.routingNumberLast4, "0000");
  assert.equal(result.accountNumberLast4, "6789");
  assert.equal(result.accountToken.includes("000123456789"), false);
  assert.match(result.accountToken, /^sim_ba_[0-9a-f]{32}$/);
});

test("an unreachable bank fails the check instead of being paid", () => {
  const result = check({ routingNumber: "999999999" });
  assert.equal(result.status, "failed");
  assert.match(result.reason, /not a bank this simulator can reach/);
});

test("an account held by somebody other than the claimant fails the check", () => {
  const result = check({ accountHolderName: "Someone Else Holdings" });
  assert.equal(result.status, "failed");
  assert.match(result.reason, /not by the claimant/);
});

test("the name comparison ignores case, commas and extra spaces, and nothing looser", () => {
  assert.equal(check({ accountHolderName: "bay area fabrication llc" }).status, "verified");
  assert.equal(check({ accountHolderName: "Bay Area Fabrication, LLC" }).status, "verified");
  assert.equal(check({ accountHolderName: "  Bay   Area Fabrication LLC  " }).status, "verified");
  // Not an abbreviation matcher: "B.A. Fabrication" is a different name, and guessing would be
  // inventing a matching policy.
  assert.equal(check({ accountHolderName: "B.A. Fabrication LLC" }).status, "failed");
});

test("the token is the same for the same account and different for a different one", () => {
  const first = check().accountToken;
  const again = check().accountToken;
  const other = check({ accountNumber: "000987654321" }).accountToken;
  // Stable, so an approval bound to this destination still matches when the same account is
  // recorded again; different, so swapping the account invalidates the approval.
  assert.equal(first, again);
  assert.notEqual(first, other);
});

test("spaces and dashes in the typed numbers are ignored", () => {
  assert.equal(check({ routingNumber: "1100-0000-0", accountNumber: "0001 2345 6789" }).status, "verified");
});

test("a malformed number is a form mistake, not a failed check: nothing is recorded", () => {
  assert.throws(() => check({ routingNumber: "12345" }), BankAccountRejected);
  assert.throws(() => check({ accountNumber: "12" }), BankAccountRejected);
  assert.throws(() => check({ accountNumber: "123456789012345678" }), BankAccountRejected);
  assert.throws(() => check({ accountHolderName: "   " }), BankAccountRejected);
});
