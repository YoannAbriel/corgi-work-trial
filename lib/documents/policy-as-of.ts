import { daysBetween, type CalendarDate } from "@/lib/money/dates";
import { stateTaxCents } from "@/lib/money/premium";
import type { CoverageLine, MailingAddress, PolicySnapshot, PolicyStatus } from "./policy-snapshot";

// Rebuilding a policy as it stood on a given business date.
//
// A policy is not a row that gets edited: it is the ordered list of the events that happened
// to it (docs/ARCHITECTURE.md section 3). `foldPolicyEvents` replays those events up to a
// date and returns the snapshot the declarations page prints. The same function answers
// "the policy today" and "the policy on June 9, 2028, between the two endorsements".
//
// Two different questions, and this file answers only the first one:
//   - business time ("what was true on June 9"): filter on `effectiveAt`, which is what
//     `asOf` does here;
//   - knowledge time ("what we believed on June 9"): drop the events whose `recordedAt` is
//     after that instant BEFORE calling this function, then fold as usual. A backdated
//     endorsement recorded later then disappears from the picture, which is exactly what
//     a reprint of an old document has to show.

export type PolicyEventType =
  | "issued" // the policy comes into existence with its term, coverage and premium
  | "endorsed" // a mid-term change: new annual premium, possibly new coverage lines
  | "cancelled" // coverage stops on `effectiveAt`
  | "correction_reversal" // undoes an earlier event that was recorded with wrong facts
  | "correction_rebook"; // replays that event with the corrected facts

// Fields carried by a policy event, flat and optional because each event type uses a subset.
// Which type requires which field is stated in the comment on each field and enforced by
// `foldPolicyEvents`, which throws with the field name when one is missing.
//
// Mapping to the database (slice B2 owns the `policy_events` table; this comment is the one
// place to change when the column names are settled):
//   PolicyEvent.id                -> policy_events.id
//   PolicyEvent.eventType         -> policy_events.event_type
//   PolicyEvent.effectiveAt       -> policy_events.effective_at   (date)
//   PolicyEvent.recordedAt        -> policy_events.recorded_at    (timestamptz, server-set)
//   PolicyEvent.supersedesEventId -> policy_events.supersedes_event_id
//   PolicyEvent.payload           -> policy_events.payload        (jsonb, keys exactly as below)
export type PolicyEventPayload = {
  // --- required on `issued` -------------------------------------------------------------
  policyNumber?: string;
  insuredName?: string;
  insuredAddress?: MailingAddress;
  brokerName?: string;
  stateCode?: string; // "CA"
  stateName?: string; // "California"
  taxRateBasisPoints?: number; // 235 = 2.35%
  termStart?: CalendarDate; // "YYYY-MM-DD"
  termEnd?: CalendarDate; // "YYYY-MM-DD"
  feeCents?: number; // flat policy fee, integer cents

  // --- required on `issued` and on `endorsed` -------------------------------------------
  // Annual premium in force after this event, integer cents. An endorsement states the new
  // annual premium; the prorated money it moves is `premiumDeltaCents` below.
  annualPremiumCents?: number;

  // --- optional on `issued` and `endorsed` ----------------------------------------------
  // The complete coverage table after this event. When an endorsement omits it, coverage is
  // unchanged (a premium-only endorsement).
  coverageLines?: CoverageLine[];

  // --- required on `endorsed` -----------------------------------------------------------
  // Prorated premium charged (positive) or credited (negative) for this endorsement, from
  // its effective date to the end of the term, integer cents. Computed by
  // `endorsementDeltaCents` in lib/money/premium.ts.
  premiumDeltaCents?: number;
  // One sentence for the endorsement schedule, e.g. "General Liability limit raised to $2M".
  description?: string;

  // --- required on `correction_rebook` --------------------------------------------------
  // Which kind of event this re-book replays. The re-book then applies exactly like an event
  // of that type and must carry that type's fields.
  rebookedEventType?: "issued" | "endorsed" | "cancelled";
};

export type PolicyEvent = {
  id: string;
  eventType: PolicyEventType;
  // Business date the event takes effect, "YYYY-MM-DD".
  effectiveAt: CalendarDate;
  // Instant the event was written down, ISO-8601 UTC. Never used to price anything; it is
  // there so a backdated event can be recognised as one.
  recordedAt: string;
  // On a `correction_reversal`: the id of the event it undoes. Unused on other types.
  supersedesEventId?: string | null;
  payload: PolicyEventPayload;
};

// Rebuilds the policy as it stood on `asOf`.
//
// `generatedAt` is passed in rather than read from the clock so this function stays pure:
// the same events and the same dates always produce the same snapshot, which is what makes
// a reprint of an old document reproducible and the tests deterministic.
//
// Rules, in order:
//   1. only events with `effectiveAt` on or before `asOf` count;
//   2. an event undone by a `correction_reversal` that is itself effective by `asOf` is
//      dropped, together with the reversal itself (a reversal carries no policy facts);
//   3. a `correction_rebook` applies like a normal event of the type it names;
//   4. the surviving events are replayed in business order: effective date first, then
//      recording time, then id, so two endorsements effective the same day apply in the
//      order they were recorded and the result never depends on the caller's array order.
export function foldPolicyEvents(
  events: PolicyEvent[],
  asOf: CalendarDate,
  generatedAt: string,
): PolicySnapshot {
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const reversedEventIds = collectReversedEventIds(events, asOf, eventsById);

  const applicableEvents = events
    .filter((event) => isOnOrBefore(event.effectiveAt, asOf))
    .filter((event) => event.eventType !== "correction_reversal")
    .filter((event) => !reversedEventIds.has(event.id))
    .sort(compareInBusinessOrder);

  // Facts fixed at issuance. They stay null until the `issued` event is replayed, which is
  // how a snapshot taken before the policy existed is caught below.
  let issuance: IssuedFacts | null = null;
  let annualPremiumCentsAtIssuance = 0;
  let annualPremiumCents = 0;
  let coverageLines: CoverageLine[] = [];
  let status: PolicyStatus = "issued";
  let cancelledEffectiveAt: CalendarDate | null = null;
  const endorsements: PolicySnapshot["endorsements"] = [];

  for (const event of applicableEvents) {
    // A re-book is the corrected replay of an earlier event, so it applies as that kind of
    // event. Everything else applies as itself.
    const appliedAs =
      event.eventType === "correction_rebook" ? requireRebookedEventType(event) : event.eventType;

    switch (appliedAs) {
      case "issued": {
        issuance = readIssuedFacts(event);
        annualPremiumCents = requireCents(event, "annualPremiumCents", { allowNegative: false });
        annualPremiumCentsAtIssuance = annualPremiumCents;
        coverageLines = event.payload.coverageLines ?? [];
        break;
      }
      case "endorsed": {
        if (!issuance) {
          throw new Error(`policy event ${event.id}: an endorsement cannot precede the issuance`);
        }
        annualPremiumCents = requireCents(event, "annualPremiumCents", { allowNegative: false });
        if (event.payload.coverageLines) {
          coverageLines = event.payload.coverageLines;
        }
        endorsements.push({
          effectiveAt: event.effectiveAt,
          recordedAt: event.recordedAt,
          description: requireText(event, "description"),
          premiumDeltaCents: requireCents(event, "premiumDeltaCents", { allowNegative: true }),
          annualPremiumCentsAfter: annualPremiumCents,
        });
        break;
      }
      case "cancelled": {
        if (!issuance) {
          throw new Error(`policy event ${event.id}: a cancellation cannot precede the issuance`);
        }
        status = "cancelled";
        cancelledEffectiveAt = event.effectiveAt;
        break;
      }
      default: {
        // Unknown event types are refused rather than ignored: silently skipping an event
        // would print a document that does not match the policy.
        throw new Error(`policy event ${event.id}: unsupported event type "${event.eventType}"`);
      }
    }
  }

  if (!issuance) {
    throw new Error(`no issued policy event effective on or before ${asOf}`);
  }

  // The tax shown on the document is the tax on the annual premium in force on `asOf`,
  // computed by the same function the ledger uses (rounded down, the insurer eats the
  // fraction). It is a policy figure, not a payment history: what was actually charged and
  // collected lives in the journal.
  const taxCents = stateTaxCents(annualPremiumCents, issuance.taxRateBasisPoints);

  return {
    policyNumber: issuance.policyNumber,
    insuredName: issuance.insuredName,
    insuredAddress: issuance.insuredAddress,
    brokerName: issuance.brokerName,
    stateCode: issuance.stateCode,
    stateName: issuance.stateName,
    termStart: issuance.termStart,
    termEnd: issuance.termEnd,
    coverageLines,
    annualPremiumCents,
    annualPremiumCentsAtIssuance,
    taxRateBasisPoints: issuance.taxRateBasisPoints,
    taxCents,
    feeCents: issuance.feeCents,
    totalChargeCents: annualPremiumCents + taxCents + issuance.feeCents,
    status,
    cancelledEffectiveAt,
    endorsements,
    asOf,
    generatedAt,
  };
}

// ---------------------------------------------------------------------------------------
// Helpers. Each one has a single job and throws with the event id and the field name, so a
// malformed event says what is wrong instead of producing a quietly wrong document.
// ---------------------------------------------------------------------------------------

type IssuedFacts = {
  policyNumber: string;
  insuredName: string;
  insuredAddress: MailingAddress;
  brokerName: string;
  stateCode: string;
  stateName: string;
  taxRateBasisPoints: number;
  termStart: CalendarDate;
  termEnd: CalendarDate;
  feeCents: number;
};

function readIssuedFacts(event: PolicyEvent): IssuedFacts {
  const address = event.payload.insuredAddress;
  if (!address) {
    throw new Error(`policy event ${event.id}: payload.insuredAddress is required to issue a policy`);
  }
  return {
    policyNumber: requireText(event, "policyNumber"),
    insuredName: requireText(event, "insuredName"),
    insuredAddress: address,
    brokerName: requireText(event, "brokerName"),
    stateCode: requireText(event, "stateCode"),
    stateName: requireText(event, "stateName"),
    taxRateBasisPoints: requireBasisPoints(event, "taxRateBasisPoints"),
    termStart: requireText(event, "termStart"),
    termEnd: requireText(event, "termEnd"),
    feeCents: requireCents(event, "feeCents", { allowNegative: false }),
  };
}

function requireRebookedEventType(event: PolicyEvent): "issued" | "endorsed" | "cancelled" {
  const rebookedEventType = event.payload.rebookedEventType;
  if (!rebookedEventType) {
    throw new Error(
      `policy event ${event.id}: payload.rebookedEventType is required on a correction_rebook ` +
        `(which of issued, endorsed or cancelled it replays)`,
    );
  }
  return rebookedEventType;
}

function requireText(event: PolicyEvent, field: keyof PolicyEventPayload): string {
  const value = event.payload[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`policy event ${event.id}: payload.${String(field)} is required`);
  }
  return value;
}

// A premium tax rate, in basis points: 235 means 2.35%. Never a float.
function requireBasisPoints(event: PolicyEvent, field: keyof PolicyEventPayload): number {
  const value = event.payload[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`policy event ${event.id}: payload.${String(field)} must be a non-negative whole number of basis points`);
  }
  return value;
}

function requireCents(
  event: PolicyEvent,
  field: keyof PolicyEventPayload,
  options: { allowNegative: boolean },
): number {
  const value = event.payload[field];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`policy event ${event.id}: payload.${String(field)} must be an integer number of cents`);
  }
  if (!options.allowNegative && value < 0) {
    throw new Error(`policy event ${event.id}: payload.${String(field)} must not be negative, got ${value}`);
  }
  return value;
}

// The ids of the events undone by a correction that is itself effective by `asOf`.
// A reversal that names an event we do not have is a data integrity problem, not something
// to ignore: it would silently leave the reversed facts in the document.
function collectReversedEventIds(
  events: PolicyEvent[],
  asOf: CalendarDate,
  eventsById: Map<string, PolicyEvent>,
): Set<string> {
  const reversedEventIds = new Set<string>();
  for (const event of events) {
    if (event.eventType !== "correction_reversal") continue;
    if (!isOnOrBefore(event.effectiveAt, asOf)) continue;
    const reversedEventId = event.supersedesEventId;
    if (!reversedEventId) {
      throw new Error(`policy event ${event.id}: a correction_reversal must name the event it reverses`);
    }
    if (!eventsById.has(reversedEventId)) {
      throw new Error(`policy event ${event.id}: reverses unknown event ${reversedEventId}`);
    }
    reversedEventIds.add(reversedEventId);
  }
  return reversedEventIds;
}

// `daysBetween` also validates both dates, so a malformed date throws here instead of
// producing a wrong comparison.
function isOnOrBefore(date: CalendarDate, limit: CalendarDate): boolean {
  return daysBetween(date, limit) >= 0;
}

function compareInBusinessOrder(left: PolicyEvent, right: PolicyEvent): number {
  const dayDifference = daysBetween(right.effectiveAt, left.effectiveAt);
  if (dayDifference !== 0) return dayDifference;
  if (left.recordedAt !== right.recordedAt) return left.recordedAt < right.recordedAt ? -1 : 1;
  if (left.id !== right.id) return left.id < right.id ? -1 : 1;
  return 0;
}
