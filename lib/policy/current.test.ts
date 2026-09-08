import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPolicyEvents, type PolicyEventRow } from "./current";
import { policyTermsToPayload, type PolicyTerms } from "./terms";

// The fold on plain rows: the recited policy ($1,200, California, 2028-03-01), then endorsed
// to $1,800 on day 100, with the request and approval events that precede an endorsement.

const ISSUED_TERMS: PolicyTerms = {
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

const ENDORSED_TERMS: PolicyTerms = {
  ...ISSUED_TERMS,
  annualPremiumCents: 180000,
  taxCents: 4230, // 180000 x 2.35% exactly
  totalChargeCents: 186730,
  perOccurrenceLimitCents: 200000000,
  aggregateLimitCents: 400000000,
};

function row(
  id: string,
  eventType: string,
  effectiveAt: string,
  payload: unknown,
  supersedes: string | null = null,
): PolicyEventRow {
  return {
    id,
    event_type: eventType,
    effective_at: effectiveAt,
    payload,
    recorded_at: new Date(`2028-06-09T10:00:0${id.length % 10}.000Z`),
    supersedes_event_id: supersedes,
  };
}

const QUOTED = row("e1", "quoted", "2028-03-01", policyTermsToPayload(ISSUED_TERMS));
const ISSUED = row("e2", "issued", "2028-03-01", policyTermsToPayload(ISSUED_TERMS));
// A request carries no annual_premium_cents key, so the terms stay as they were.
const REQUESTED = row("e3", "endorsement_requested", "2028-06-09", {
  new_annual_premium_cents: 180000,
  delta_premium_cents: 43561,
  quote_hash: "abc",
});
const APPROVED = row("e4", "endorsement_approved", "2028-06-09", { request_event_id: "e3", quote_hash: "abc" });
const ENDORSED = row("e5", "endorsed", "2028-06-09", {
  ...policyTermsToPayload(ENDORSED_TERMS),
  request_event_id: "e3",
  delta_premium_cents: 43561,
});

test("a bound policy: the quoted terms, bound at the issuance", () => {
  const fold = applyPolicyEvents([QUOTED, ISSUED]);
  assert.deepEqual(fold.eventTypes, ["quoted", "issued"]);
  assert.equal(fold.terms.annualPremiumCents, 120000);
  assert.equal(fold.boundAt?.toISOString(), ISSUED.recorded_at.toISOString());
  assert.equal(fold.appliedEventCount, 2);
  assert.equal(fold.latestEndorsementEffectiveAt, null);
});

test("a request and an approval move the policy version but not the terms", () => {
  const fold = applyPolicyEvents([QUOTED, ISSUED, REQUESTED, APPROVED]);
  assert.equal(fold.appliedEventCount, 4);
  assert.equal(fold.terms.annualPremiumCents, 120000);
  assert.equal(fold.terms.perOccurrenceLimitCents, 100000000);
  assert.equal(fold.latestEndorsementEffectiveAt, null);
});

test("an endorsement replaces the annual premium and the limits; the fee and term stay", () => {
  const fold = applyPolicyEvents([QUOTED, ISSUED, REQUESTED, APPROVED, ENDORSED]);
  assert.deepEqual(fold.eventTypes, ["quoted", "issued", "endorsement_requested", "endorsement_approved", "endorsed"]);
  assert.equal(fold.terms.annualPremiumCents, 180000);
  assert.equal(fold.terms.taxCents, 4230);
  assert.equal(fold.terms.perOccurrenceLimitCents, 200000000);
  assert.equal(fold.terms.feeCents, 2500);
  assert.equal(fold.terms.termStart, "2028-03-01");
  assert.equal(fold.terms.termEnd, "2029-03-01");
  assert.equal(fold.appliedEventCount, 5);
  assert.equal(fold.latestEndorsementEffectiveAt, "2028-06-09");
  // Still bound: the issuance is untouched by an endorsement.
  assert.ok(fold.boundAt);
});

test("a superseded endorsement is skipped, and so is the version count", () => {
  // A correction reversed the endorsement (slice B8 shape): the endorsed row stays in the table,
  // the fold no longer applies it, and the terms are the issued ones again.
  const REVERSAL = row("e6", "correction_reversal", "2028-06-09", { reason: "wrong date" }, "e5");
  const fold = applyPolicyEvents([QUOTED, ISSUED, REQUESTED, APPROVED, ENDORSED, REVERSAL]);
  assert.deepEqual(fold.eventTypes, ["quoted", "issued", "endorsement_requested", "endorsement_approved", "correction_reversal"]);
  assert.equal(fold.terms.annualPremiumCents, 120000);
  assert.equal(fold.appliedEventCount, 5); // six rows, one skipped
  assert.equal(fold.latestEndorsementEffectiveAt, null);
});

test("a superseded issuance un-binds the policy without deleting anything", () => {
  const VOID = row("e7", "correction_reversal", "2028-03-01", { reason: "fabricated payment" }, "e2");
  const fold = applyPolicyEvents([QUOTED, ISSUED, VOID]);
  assert.deepEqual(fold.eventTypes, ["quoted", "correction_reversal"]);
  assert.equal(fold.boundAt, null);
  assert.equal(fold.terms.annualPremiumCents, 120000); // the quote still carries the terms
});

test("a policy with no event carrying terms cannot be folded", () => {
  assert.throws(() => applyPolicyEvents([REQUESTED]), /no event carrying its terms/);
});
