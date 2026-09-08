import { test } from "node:test";
import assert from "node:assert/strict";
import { policyTermsFromPayload, policyTermsToPayload, type PolicyTerms } from "./terms";

const TERMS: PolicyTerms = {
  stateCode: "CA",
  termStart: "2028-03-01",
  termEnd: "2029-03-01",
  annualPremiumCents: 120000,
  taxRateBps: 235,
  taxCents: 2820,
  feeCents: 2500,
  totalChargeCents: 125320,
  perOccurrenceLimitCents: 100000000,
  aggregateLimitCents: 200000000,
};

test("terms survive a round trip through the event payload", () => {
  // The payload goes to Postgres as jsonb and comes back parsed: this is the shape the ledger
  // reads before posting, so it must return exactly what was written.
  const roundTripped = policyTermsFromPayload(JSON.parse(JSON.stringify(policyTermsToPayload(TERMS))));
  assert.deepEqual(roundTripped, TERMS);
});

test("an amount that is not a whole number stops the flow instead of being rounded", () => {
  const payload = { ...policyTermsToPayload(TERMS), tax_cents: 2820.4 };
  assert.throws(() => policyTermsFromPayload(payload), /tax_cents is not a whole non-negative number/);
});

test("a missing field is refused, never defaulted to zero", () => {
  const payload = { ...policyTermsToPayload(TERMS) } as Record<string, unknown>;
  delete payload.total_charge_cents;
  assert.throws(() => policyTermsFromPayload(payload), /total_charge_cents/);
});

test("a payload that is not an object is refused", () => {
  assert.throws(() => policyTermsFromPayload(null), /not an object/);
  assert.throws(() => policyTermsFromPayload("120000"), /not an object/);
});
