import { test } from "node:test";
import assert from "node:assert/strict";
import { documentEventsFromRows, type PolicyEventRowForDocuments, type PolicyFacts } from "./from-database";
import { foldPolicyEvents } from "./policy-as-of";

// The recited policy as the database holds it (snake_case payloads written by
// lib/policy/terms.ts and lib/policy/endorse.ts), turned into document events and folded.

const FACTS: PolicyFacts = {
  policyNumber: "CGP-01001",
  insuredName: "Bay Area Fabrication LLC",
  insuredEmail: "customer@example.com",
  brokerName: "Redwood Commercial Brokers",
  stateCode: "CA",
};

const TERMS = {
  state_code: "CA",
  term_start: "2028-03-01",
  term_end: "2029-03-01",
  annual_premium_cents: 120000,
  tax_rate_bps: 235,
  tax_cents: 2820,
  fee_cents: 2500,
  total_charge_cents: 125320,
  per_occurrence_limit_cents: 100000000,
  aggregate_limit_cents: 200000000,
};

function row(id: string, eventType: string, effectiveAt: string, payload: Record<string, unknown>, supersedes: string | null = null): PolicyEventRowForDocuments {
  return { id, event_type: eventType, effective_at: effectiveAt, recorded_at: new Date("2028-06-09T10:00:00.000Z"), supersedes_event_id: supersedes, payload };
}

const ROWS: PolicyEventRowForDocuments[] = [
  row("e1", "quoted", "2028-03-01", TERMS),
  row("e2", "issued", "2028-03-01", TERMS),
  row("e3", "endorsement_requested", "2028-06-09", { new_annual_premium_cents: 180000, quote_hash: "abc" }),
  row("e4", "endorsement_approved", "2028-06-09", { request_event_id: "e3" }),
  row("e5", "endorsed", "2028-06-09", {
    ...TERMS,
    annual_premium_cents: 180000,
    tax_cents: 4230,
    total_charge_cents: 186730,
    per_occurrence_limit_cents: 200000000,
    aggregate_limit_cents: 400000000,
    request_event_id: "e3",
    delta_premium_cents: 43561,
    delta_tax_cents: 1023, // floor(43561 x 235 / 10000): charged with the premium
    description: "Annual premium $1,200.00 to $1,800.00; per-occurrence limit $1,000,000.00 to $2,000,000.00",
  }),
];

test("only the events in force reach the document: quoted, request and approval are left out", () => {
  const events = documentEventsFromRows(ROWS, FACTS);
  assert.deepEqual(events.map((event) => event.eventType), ["issued", "endorsed"]);
  assert.equal(events[0].payload.policyNumber, "CGP-01001");
  assert.equal(events[0].payload.stateName, "California");
  assert.equal(events[0].payload.annualPremiumCents, 120000);
  assert.equal(events[0].payload.coverageLines?.[0].limitCents, 100000000);
  assert.equal(events[1].payload.premiumDeltaCents, 43561);
  assert.equal(events[1].payload.annualPremiumCents, 180000);
  assert.equal(events[1].payload.coverageLines?.[0].limitCents, 200000000);
});

test("the fold of those events prints the policy as it stood before and after the endorsement", () => {
  const events = documentEventsFromRows(ROWS, FACTS);
  const before = foldPolicyEvents(events, "2028-06-08", "2026-09-08T12:00:00.000Z");
  assert.equal(before.annualPremiumCents, 120000);
  assert.equal(before.totalChargeCents, 125320);
  assert.equal(before.endorsements.length, 0);

  const after = foldPolicyEvents(events, "2028-06-09", "2026-09-08T12:00:00.000Z");
  assert.equal(after.annualPremiumCents, 180000);
  assert.equal(after.taxCents, 4230);
  assert.equal(after.endorsements.length, 1);
  assert.equal(after.endorsements[0].premiumDeltaCents, 43561);
  // What the customer was charged for it: the prorated premium plus its tax (F-INT-07).
  assert.equal(after.endorsements[0].amountChargedCents, 44584);
  assert.equal(after.endorsements[0].annualPremiumCentsAfter, 180000);
  assert.equal(after.coverageLines[0].limitCents, 200000000);
});

test("a superseded endorsement disappears from the document, and a voided issuance stops it", () => {
  const reversal = row("e6", "correction_reversal", "2028-06-09", { reason: "wrong date" }, "e5");
  const corrected = foldPolicyEvents(documentEventsFromRows([...ROWS, reversal], FACTS), "2028-12-01", "2026-09-08T12:00:00.000Z");
  assert.equal(corrected.endorsements.length, 0);
  assert.equal(corrected.annualPremiumCents, 120000);

  const voided = row("e7", "correction_reversal", "2028-03-01", { reason: "fabricated payment" }, "e2");
  assert.throws(
    () => foldPolicyEvents(documentEventsFromRows([ROWS[0], ROWS[1], voided], FACTS), "2028-12-01", "2026-09-08T12:00:00.000Z"),
    /no issued policy event effective on or before/,
  );
});

test("a malformed payload stops the document with the field name", () => {
  const broken = row("e9", "endorsed", "2028-06-09", { ...TERMS, delta_premium_cents: 43561.5, description: "x" });
  assert.throws(() => documentEventsFromRows([ROWS[1], broken], FACTS), /delta_premium_cents is not a whole number/);
});

test("the address line says the address was not collected, instead of inventing one", () => {
  const [issued] = documentEventsFromRows([ROWS[1]], FACTS);
  assert.equal(issued.payload.insuredAddress?.line2, "Mailing address not collected by this build");
  assert.equal(issued.payload.insuredAddress?.line1, "Contact: customer@example.com");
});
