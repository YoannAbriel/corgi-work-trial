import type { CoverageLine, MailingAddress } from "./policy-snapshot";
import type { PolicyEvent, PolicyEventPayload } from "./policy-as-of";

// Turning the rows of policy_events into the events the document fold understands.
//
// The database stores each event's payload in snake_case with the keys of lib/policy/terms.ts
// and lib/policy/endorsement-requests.ts; the document fold (policy-as-of.ts) wants camelCase
// events that also carry the names printed on the page (insured, broker, state). This is the
// one place that translates between the two, and it is pure: the route reads the rows and the
// names, this function builds the events, the fold and the renderer do the rest.
//
// Only the events that describe the policy in force are passed on:
//   issued, endorsed, cancelled, correction_reversal, correction_rebook.
// 'quoted' (the draft, before any coverage), 'endorsement_requested' and 'endorsement_approved'
// (steps towards an endorsement, not a change in force) are left out: the document shows what
// covered the insured on the as-of date, not what was being negotiated.

// What the document prints that the events do not carry: the parties and the state name.
export type PolicyFacts = {
  policyNumber: string;
  insuredName: string;
  insuredEmail: string;
  brokerName: string;
  stateCode: string;
};

// One row of policy_events, as the route reads it.
export type PolicyEventRowForDocuments = {
  id: string;
  event_type: string;
  effective_at: string; // "YYYY-MM-DD"
  recorded_at: Date;
  supersedes_event_id: string | null;
  payload: Record<string, unknown>;
};

// The one state modelled by this build. Any other code is printed as the code itself, which
// is honest rather than wrong.
const STATE_NAMES: Record<string, string> = { CA: "California" };

export function stateName(stateCode: string): string {
  return STATE_NAMES[stateCode] ?? stateCode;
}

export function documentEventsFromRows(rows: PolicyEventRowForDocuments[], facts: PolicyFacts): PolicyEvent[] {
  const events: PolicyEvent[] = [];
  for (const row of rows) {
    const event = documentEventFromRow(row, facts);
    if (event) {
      events.push(event);
    }
  }
  return events;
}

function documentEventFromRow(row: PolicyEventRowForDocuments, facts: PolicyFacts): PolicyEvent | null {
  const base = { id: row.id, effectiveAt: row.effective_at, recordedAt: row.recorded_at.toISOString() };
  switch (row.event_type) {
    case "issued":
      return { ...base, eventType: "issued", payload: issuedPayload(row.payload, facts) };
    case "endorsed":
      return { ...base, eventType: "endorsed", payload: endorsedPayload(row.payload) };
    case "cancelled":
      return { ...base, eventType: "cancelled", payload: {} };
    case "correction_reversal":
      return { ...base, eventType: "correction_reversal", supersedesEventId: row.supersedes_event_id, payload: {} };
    case "correction_rebook": {
      // Slice B8 writes re-books; they apply as the event type they name. Until B8 settles the
      // payload, the terms and delta keys are read the same way as on the event they replay.
      const rebooked = String(row.payload.rebooked_event_type ?? "");
      if (rebooked !== "issued" && rebooked !== "endorsed" && rebooked !== "cancelled") {
        return { ...base, eventType: "correction_rebook", payload: {} }; // the fold refuses it with the field name
      }
      const replayed =
        rebooked === "issued" ? issuedPayload(row.payload, facts) : rebooked === "endorsed" ? endorsedPayload(row.payload) : {};
      return { ...base, eventType: "correction_rebook", payload: { ...replayed, rebookedEventType: rebooked } };
    }
    default:
      return null; // quoted, endorsement_requested, endorsement_approved: not a change in force
  }
}

function issuedPayload(fields: Record<string, unknown>, facts: PolicyFacts): PolicyEventPayload {
  return {
    policyNumber: facts.policyNumber,
    insuredName: facts.insuredName,
    insuredAddress: addressOnFile(facts),
    brokerName: facts.brokerName,
    stateCode: facts.stateCode,
    stateName: stateName(facts.stateCode),
    taxRateBasisPoints: wholeNumber(fields, "tax_rate_bps"),
    termStart: text(fields, "term_start"),
    termEnd: text(fields, "term_end"),
    feeCents: wholeNumber(fields, "fee_cents"),
    annualPremiumCents: wholeNumber(fields, "annual_premium_cents"),
    coverageLines: coverageLines(wholeNumber(fields, "per_occurrence_limit_cents"), wholeNumber(fields, "aggregate_limit_cents")),
  };
}

function endorsedPayload(fields: Record<string, unknown>): PolicyEventPayload {
  return {
    description: text(fields, "description"),
    annualPremiumCents: wholeNumber(fields, "annual_premium_cents"),
    premiumDeltaCents: signedWholeNumber(fields, "delta_premium_cents"),
    coverageLines: coverageLines(wholeNumber(fields, "per_occurrence_limit_cents"), wholeNumber(fields, "aggregate_limit_cents")),
  };
}

// The two limits of a commercial general liability policy, as the declarations page prints them.
export function coverageLines(perOccurrenceLimitCents: number, aggregateLimitCents: number): CoverageLine[] {
  return [
    {
      name: "General Liability - Each Occurrence",
      limitCents: perOccurrenceLimitCents,
      description: "Bodily injury and property damage arising from operations.",
    },
    { name: "General Liability - Aggregate", limitCents: aggregateLimitCents, description: "Total payable for the policy term." },
  ];
}

// This build collects a customer's name and email, not a mailing address (docs/PLAN.md cut
// list: no customer portal beyond approvals and documents). The declarations page says so
// instead of printing an invented address (AF-04: synthetic data only, and no pretending).
function addressOnFile(facts: PolicyFacts): MailingAddress {
  return { line1: `Contact: ${facts.insuredEmail}`, line2: "Mailing address not collected by this build", city: "", state: facts.stateCode, postalCode: "" };
}

function text(fields: Record<string, unknown>, key: string): string {
  const value = fields[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`policy event payload field ${key} is missing or not text`);
  }
  return value;
}

function wholeNumber(fields: Record<string, unknown>, key: string): number {
  const value = fields[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`policy event payload field ${key} is not a whole non-negative number: ${String(value)}`);
  }
  return value;
}

function signedWholeNumber(fields: Record<string, unknown>, key: string): number {
  const value = fields[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`policy event payload field ${key} is not a whole number: ${String(value)}`);
  }
  return value;
}
