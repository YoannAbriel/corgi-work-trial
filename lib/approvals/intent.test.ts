import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bankAccountDestination,
  canonicalIntentText,
  intentHash,
  stripePaymentDestination,
  type MoneyOutIntent,
} from "./intent";

const CLAIM_ID = "77777777-7777-4777-8777-777777777777";
// An obviously synthetic simulator token, not a credential: this build has no bank account
// numbers and no vault (see lib/rails/bank-verification-simulator.ts).
const SIMULATED_ACCOUNT = "sim_ba_00000000111111112222222233333333";

const PAY_THE_CLAIMANT: MoneyOutIntent = {
  kind: "claim_payment",
  subjectKind: "claim",
  subjectId: CLAIM_ID,
  amountCents: 120000,
  destination: bankAccountDestination(SIMULATED_ACCOUNT),
};

test("the canonical text is four labelled lines, in a fixed order", () => {
  assert.equal(
    canonicalIntentText(PAY_THE_CLAIMANT),
    [
      "kind=claim_payment",
      `subject=claim:${CLAIM_ID}`,
      "amount_cents=120000",
      `destination=simulated_bank_account:${SIMULATED_ACCOUNT}`,
    ].join("\n"),
  );
});

test("the same intent always hashes to the same 64 hex characters", () => {
  const first = intentHash(PAY_THE_CLAIMANT);
  const second = intentHash({ ...PAY_THE_CLAIMANT });
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
});

test("a different amount is a different intent", () => {
  assert.notEqual(intentHash(PAY_THE_CLAIMANT), intentHash({ ...PAY_THE_CLAIMANT, amountCents: 120001 }));
});

test("a different destination account is a different intent: this is the swap that must fail", () => {
  const otherAccount = bankAccountDestination("sim_ba_ffffffffffffffffffffffffffffffff");
  assert.notEqual(intentHash(PAY_THE_CLAIMANT), intentHash({ ...PAY_THE_CLAIMANT, destination: otherAccount }));
});

test("a different subject is a different intent", () => {
  assert.notEqual(
    intentHash(PAY_THE_CLAIMANT),
    intentHash({ ...PAY_THE_CLAIMANT, subjectId: "99999999-9999-4999-8999-999999999999" }),
  );
});

test("a claim payment and a refund of the same amount are different intents", () => {
  const refund: MoneyOutIntent = {
    kind: "refund",
    subjectKind: "policy",
    subjectId: CLAIM_ID,
    amountCents: 120000,
    destination: stripePaymentDestination("pi_3UDM4KK6R3v50tIy0F5xaBbu"),
  };
  assert.notEqual(intentHash(PAY_THE_CLAIMANT), intentHash(refund));
  assert.match(canonicalIntentText(refund), /destination=stripe_payment_intent:pi_/);
});

test("an intent with no amount, no subject or no destination cannot be hashed", () => {
  assert.throws(() => intentHash({ ...PAY_THE_CLAIMANT, amountCents: 0 }), /positive whole number of cents/);
  assert.throws(() => intentHash({ ...PAY_THE_CLAIMANT, subjectId: "" }), /subject and a destination/);
  assert.throws(() => intentHash({ ...PAY_THE_CLAIMANT, destination: "" }), /subject and a destination/);
});

test("the hash is a plain SHA-256 of that text, checkable outside this codebase", () => {
  // Computed with the shell, not with this code:
  //   printf '%s' "kind=claim_payment
  //   subject=claim:77777777-7777-4777-8777-777777777777
  //   amount_cents=120000
  //   destination=simulated_bank_account:sim_ba_00000000111111112222222233333333" | shasum -a 256
  // (2026-09-08, no trailing newline). Anyone can repeat it and get the same 64 characters, so
  // an approver is not asked to trust the application about what it hashed.
  assert.equal(
    intentHash(PAY_THE_CLAIMANT),
    "a9bd09e852acf9824a6dbffbf181bc2e469c24665df12e74d03dac5b1c2f1bad",
  );
});
