import type postgres from "postgres";
import { sql } from "@/db/client";
import { centsFromDatabase } from "@/lib/money/cents";
import type { EndorsementDirection, EndorsementFigures } from "@/lib/money/endorsement";

// Reading endorsement requests back from policy_events.
//
// An endorsement lives entirely in policy_events (migration 0009):
//   endorsement_requested   the quote: every figure, the quote hash, the policy version it was
//                           computed against, who asked;
//   endorsement_approved    the customer accepted that quote hash (only needed above $500);
//   endorsed                the change is in force: new terms, plus the delta that moved.
//
// This file reads those rows and says where a request stands. It writes nothing. Amounts come
// back from jsonb as numbers and are refused unless they are whole cents, like lib/policy/terms.ts.

type Queryable = postgres.Sql | postgres.TransactionSql;

export type EndorsementRequest = {
  eventId: string;
  policyId: string;
  sequenceNumber: number; // where the request sits among the policy's events
  recordedAt: Date;
  requestedBy: string | null;
  figures: EndorsementFigures; // exactly what computeEndorsement returned when the quote was made
  newPerOccurrenceLimitCents: number;
  newAggregateLimitCents: number;
  newLimitLabel: string; // e.g. "$2,000,000.00 per occurrence / $4,000,000.00 aggregate"
  description: string; // one sentence for the endorsement schedule
  reason: string | null; // free text typed by the broker, if any
};

// Where a request stands. Read from the events, never stored as a flag.
//   superseded          a later event other than this request's own approval or application
//                       exists (a second request, a cancellation, a correction): the quote is
//                       stale and can neither be approved nor paid;
//   awaiting_approval   above $500 and the customer has not approved yet;
//   approved            approved (or approval not needed) and the delta not collected yet;
//   applied             the 'endorsed' event exists.
export type EndorsementRequestState = "superseded" | "awaiting_approval" | "approved" | "applied";

export type EndorsementRequestStanding = {
  state: EndorsementRequestState;
  approvedEventId: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  endorsedEventId: string | null;
  supersededByEventType: string | null;
};

// The request named by a policy event id, or null when that id is not an endorsement request
// of that policy. The policy id is checked because the event id comes from a URL.
export async function readEndorsementRequest(
  database: Queryable,
  policyId: string,
  requestEventId: string,
): Promise<EndorsementRequest | null> {
  const [row] = await database<EventRow[]>`
    select id, policy_id, sequence_number::text, recorded_at, created_by, payload
      from policy_events
     where id = ${requestEventId} and policy_id = ${policyId} and event_type = 'endorsement_requested'
  `;
  return row ? toEndorsementRequest(row) : null;
}

// Every request ever made on a policy, oldest first.
export async function endorsementRequestsOfPolicy(database: Queryable, policyId: string): Promise<EndorsementRequest[]> {
  const rows = await database<EventRow[]>`
    select id, policy_id, sequence_number::text, recorded_at, created_by, payload
      from policy_events
     where policy_id = ${policyId} and event_type = 'endorsement_requested'
     order by sequence_number
  `;
  return rows.map(toEndorsementRequest);
}

// Where one request stands, from the events recorded after it.
export async function endorsementRequestStanding(
  database: Queryable,
  request: EndorsementRequest,
): Promise<EndorsementRequestStanding> {
  const later = await database<
    { id: string; event_type: string; request_event_id: string | null; created_by: string | null; recorded_at: Date }[]
  >`
    select id, event_type, payload ->> 'request_event_id' as request_event_id, created_by, recorded_at
      from policy_events
     where policy_id = ${request.policyId} and sequence_number > ${request.sequenceNumber}
     order by sequence_number
  `;

  const approval = later.find((event) => event.event_type === "endorsement_approved" && event.request_event_id === request.eventId);
  const application = later.find((event) => event.event_type === "endorsed" && event.request_event_id === request.eventId);
  // Anything else recorded after the request makes the quote stale: a second request moves the
  // policy version, a cancellation ends the policy, a correction changes its history.
  const supersededBy = later.find((event) => event !== approval && event !== application);

  let state: EndorsementRequestState;
  if (application) {
    state = "applied";
  } else if (supersededBy) {
    state = "superseded";
  } else if (request.figures.customerApprovalRequired && !approval) {
    state = "awaiting_approval";
  } else {
    state = "approved";
  }

  return {
    state,
    approvedEventId: approval?.id ?? null,
    approvedBy: approval?.created_by ?? null,
    approvedAt: approval?.recorded_at ?? null,
    endorsedEventId: application?.id ?? null,
    supersededByEventType: state === "superseded" ? (supersededBy?.event_type ?? null) : null,
  };
}

// The request the policy page acts on: the latest one that is neither applied nor superseded.
export async function liveEndorsementRequest(
  database: Queryable,
  policyId: string,
): Promise<{ request: EndorsementRequest; standing: EndorsementRequestStanding } | null> {
  const requests = await endorsementRequestsOfPolicy(database, policyId);
  const latest = requests[requests.length - 1];
  if (!latest) {
    return null;
  }
  const standing = await endorsementRequestStanding(database, latest);
  if (standing.state === "applied" || standing.state === "superseded") {
    return null;
  }
  return { request: latest, standing };
}

// The pool is the default so pages can call this without passing anything.
export function liveEndorsementRequestOfPolicy(policyId: string) {
  return liveEndorsementRequest(sql, policyId);
}

// ---------------------------------------------------------------------------------------
// Payload shapes: written in snake_case, read back strictly
// ---------------------------------------------------------------------------------------

// What goes on the 'endorsement_requested' event. Deliberately NO `annual_premium_cents` key:
// that name is how lib/policy/current.ts recognises an event that REPLACES the policy terms,
// and a request changes nothing until it is applied.
export function endorsementRequestPayload(input: {
  figures: EndorsementFigures;
  newPerOccurrenceLimitCents: number;
  newAggregateLimitCents: number;
  newLimitLabel: string;
  description: string;
  reason: string | null;
}): Record<string, string | number | boolean | null> {
  const figures = input.figures;
  return {
    quote_hash: figures.quoteHash,
    policy_version: figures.policyVersion,
    effective_at: figures.effectiveAt,
    term_start: figures.termStart,
    term_end: figures.termEnd,
    term_days: figures.termDays,
    days_remaining: figures.daysRemaining,
    old_annual_premium_cents: figures.oldAnnualPremiumCents,
    new_annual_premium_cents: figures.newAnnualPremiumCents,
    annual_difference_cents: figures.annualDifferenceCents,
    delta_premium_cents: figures.deltaPremiumCents,
    delta_tax_cents: figures.deltaTaxCents,
    tax_refund_was_capped_at_charged: figures.taxRefundWasCappedAtCharged,
    delta_fee_cents: figures.deltaFeeCents,
    delta_total_cents: figures.deltaTotalCents,
    commission_delta_cents: figures.commissionDeltaCents,
    direction: figures.direction,
    customer_approval_required: figures.customerApprovalRequired,
    tax_rate_bps: figures.taxRateBps,
    tax_charged_so_far_cents: figures.taxChargedSoFarCents,
    commission_rate_bps: figures.commissionRateBps,
    new_per_occurrence_limit_cents: input.newPerOccurrenceLimitCents,
    new_aggregate_limit_cents: input.newAggregateLimitCents,
    new_limit_label: input.newLimitLabel,
    description: input.description,
    reason: input.reason,
  };
}

type EventRow = {
  id: string;
  policy_id: string;
  sequence_number: string;
  recorded_at: Date;
  created_by: string | null;
  payload: Record<string, unknown>;
};

function toEndorsementRequest(row: EventRow): EndorsementRequest {
  const fields = row.payload;
  return {
    eventId: row.id,
    policyId: row.policy_id,
    sequenceNumber: Number(row.sequence_number),
    recordedAt: row.recorded_at,
    requestedBy: row.created_by,
    figures: figuresFromPayload(row.policy_id, fields),
    newPerOccurrenceLimitCents: readCents(fields, "new_per_occurrence_limit_cents"),
    newAggregateLimitCents: readCents(fields, "new_aggregate_limit_cents"),
    newLimitLabel: readText(fields, "new_limit_label"),
    description: readText(fields, "description"),
    reason: typeof fields.reason === "string" && fields.reason.length > 0 ? fields.reason : null,
  };
}

// The figures exactly as they were stored. Signed amounts (the deltas) may be negative; every
// other amount must be a whole non-negative number of cents.
export function figuresFromPayload(policyId: string, fields: Record<string, unknown>): EndorsementFigures {
  const direction = readText(fields, "direction");
  if (direction !== "charge" && direction !== "refund" && direction !== "none") {
    throw new Error(`endorsement payload field direction is not charge, refund or none: ${direction}`);
  }
  return {
    policyId,
    policyVersion: readWholeNumber(fields, "policy_version"),
    termStart: readText(fields, "term_start"),
    termEnd: readText(fields, "term_end"),
    effectiveAt: readText(fields, "effective_at"),
    termDays: readWholeNumber(fields, "term_days"),
    daysRemaining: readWholeNumber(fields, "days_remaining"),
    oldAnnualPremiumCents: readCents(fields, "old_annual_premium_cents"),
    newAnnualPremiumCents: readCents(fields, "new_annual_premium_cents"),
    annualDifferenceCents: readSignedCents(fields, "annual_difference_cents"),
    deltaPremiumCents: readSignedCents(fields, "delta_premium_cents"),
    deltaTaxCents: readSignedCents(fields, "delta_tax_cents"),
    taxRefundWasCappedAtCharged: fields.tax_refund_was_capped_at_charged === true,
    deltaFeeCents: 0,
    deltaTotalCents: readSignedCents(fields, "delta_total_cents"),
    commissionDeltaCents: readSignedCents(fields, "commission_delta_cents"),
    direction: direction as EndorsementDirection,
    customerApprovalRequired: fields.customer_approval_required === true,
    taxRateBps: readWholeNumber(fields, "tax_rate_bps"),
    taxChargedSoFarCents: readCents(fields, "tax_charged_so_far_cents"),
    commissionRateBps: readWholeNumber(fields, "commission_rate_bps"),
    quoteHash: readText(fields, "quote_hash"),
  };
}

function readText(fields: Record<string, unknown>, key: string): string {
  const value = fields[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`endorsement payload field ${key} is missing or not text`);
  }
  return value;
}

function readWholeNumber(fields: Record<string, unknown>, key: string): number {
  const value = fields[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`endorsement payload field ${key} is not a whole non-negative number: ${String(value)}`);
  }
  return value;
}

function readCents(fields: Record<string, unknown>, key: string): number {
  const value = centsFromDatabase(fields[key], key);
  if (value < 0) {
    throw new Error(`endorsement payload field ${key} must not be negative: ${value}`);
  }
  return value;
}

function readSignedCents(fields: Record<string, unknown>, key: string): number {
  return centsFromDatabase(fields[key], key);
}
