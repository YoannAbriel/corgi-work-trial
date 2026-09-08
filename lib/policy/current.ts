import type postgres from "postgres";
import type { WrittenPremiumSegment } from "@/lib/money/premium";
import { derivePolicyStatus, type MoneyOperationStatus } from "./status";
import { policyTermsFromPayload, type PolicyTerms } from "./terms";

// The fold of a policy's immutable events, and the cache built from it.
//
// policy_current is a cache: emptying it and running refreshPolicyCurrent for every policy
// gives the same table back (scripts/rebuild-policy-current.ts). No amount is ever posted to
// the ledger from the cache; money code calls foldPolicyEvents and reads the events.

// Both a pool and an open transaction can run these queries.
type Queryable = postgres.Sql | postgres.TransactionSql;

export type PolicyFold = {
  eventTypes: string[]; // in recording order, superseded events left out
  terms: PolicyTerms; // the terms carried by the last event that changed them
  boundAt: Date | null; // recording time of the 'issued' event, null while not bound
  // How many events the fold applied. This is the "policy version" an endorsement quote is
  // bound to (lib/money/endorsement.ts): any later event, applied or superseding, changes it.
  appliedEventCount: number;
  // Effective date of the latest applied 'endorsed' event, null when none. A new endorsement
  // cannot be backdated before it (lib/policy/endorse.ts says why).
  latestEndorsementEffectiveAt: string | null;
  // Every piece of premium written on this policy and the day it starts earning: the annual
  // premium over the whole term, then each applied endorsement's prorated delta from its own
  // effective date to the term end (ARCHITECTURE.md section 3). This is what a cancellation
  // gives back, and it is NOT `terms.annualPremiumCents` once the policy has been endorsed.
  writtenPremiumSegments: WrittenPremiumSegment[];
};

// One row of policy_events, as the fold reads it.
export type PolicyEventRow = {
  id: string;
  event_type: string;
  effective_at: string; // "YYYY-MM-DD"
  payload: unknown;
  recorded_at: Date;
  supersedes_event_id: string | null;
};

// Reads every event of the policy in recording order and folds them (applyPolicyEvents).
export async function foldPolicyEvents(database: Queryable, policyId: string): Promise<PolicyFold> {
  const events = await database<PolicyEventRow[]>`
    select id, event_type, to_char(effective_at, 'YYYY-MM-DD') as effective_at, payload, recorded_at, supersedes_event_id
      from policy_events
     where policy_id = ${policyId}
     order by sequence_number
  `;
  if (events.length === 0) {
    throw new Error(`policy ${policyId} has no events, so there is nothing to fold`);
  }
  return applyPolicyEvents(events);
}

// The fold itself, pure so it can be tested on plain rows:
//   - an event carrying terms (quoted, endorsed, and corrections that re-book terms) replaces
//     the terms: after an endorsement the annual premium and the limits are the endorsed ones;
//   - 'issued' records when the policy became bound;
//   - an event named by a later correction's supersedes_event_id is skipped: the correction
//     row stays, the superseded row stays, but the fold no longer applies it. This is how a
//     reversal un-binds a policy without deleting anything (slice B8);
//   - 'endorsement_requested' and 'endorsement_approved' carry no terms (their payload has no
//     annual_premium_cents key on purpose), so they count as applied events, which moves the
//     policy version, without changing what the policy covers.
export function applyPolicyEvents(events: PolicyEventRow[]): PolicyFold {
  const supersededEventIds = new Set(
    events.filter((event) => event.supersedes_event_id !== null).map((event) => event.supersedes_event_id as string),
  );

  const eventTypes: string[] = [];
  let terms: PolicyTerms | null = null;
  let boundAt: Date | null = null;
  let latestEndorsementEffectiveAt: string | null = null;
  const endorsementSegments: WrittenPremiumSegment[] = [];
  for (const event of events) {
    if (supersededEventIds.has(event.id)) {
      continue; // reversed by a correction: kept in the table, no longer applied
    }
    eventTypes.push(event.event_type);
    if (carriesTerms(event.payload)) {
      terms = policyTermsFromPayload(event.payload);
    }
    if (event.event_type === "issued") {
      boundAt = event.recorded_at;
    }
    if (event.event_type === "endorsed") {
      latestEndorsementEffectiveAt = event.effective_at;
      // The money the endorsement actually moved, signed: what the customer paid for the extra
      // cover, or gave back. It earns from the endorsement's own effective date, so a policy
      // endorsed on day 100 has two pieces of premium earning over two different windows.
      endorsementSegments.push({
        writtenPremiumCents: deltaPremiumCents(event.payload),
        startsOn: event.effective_at,
        endsOn: terms!.termEnd,
      });
    }
  }
  if (terms === null) {
    throw new Error("the policy has no event carrying its terms");
  }
  // The issuance segment first: the annual premium of the FIRST applied event that carried
  // terms (the quote, or the re-booked terms when a correction superseded it), over the term.
  const issuance = policyTermsFromPayload(firstAppliedTerms(events, supersededEventIds));
  return {
    eventTypes,
    terms,
    boundAt,
    appliedEventCount: eventTypes.length,
    latestEndorsementEffectiveAt,
    writtenPremiumSegments: [
      { writtenPremiumCents: issuance.annualPremiumCents, startsOn: issuance.termStart, endsOn: issuance.termEnd },
      ...endorsementSegments,
    ],
  };
}

// The payload of the first applied event that carries terms. An endorsement carries terms too,
// so the order matters: the first one is the policy as it was issued.
function firstAppliedTerms(events: PolicyEventRow[], supersededEventIds: Set<string>): unknown {
  const first = events.find((event) => !supersededEventIds.has(event.id) && carriesTerms(event.payload));
  if (!first) {
    throw new Error("the policy has no event carrying its terms");
  }
  return first.payload;
}

// The prorated delta an 'endorsed' event moved, read strictly: a missing or malformed figure is
// a broken event, and guessing zero would silently refund the wrong amount at cancellation.
function deltaPremiumCents(payload: unknown): number {
  const value = (payload as { delta_premium_cents?: unknown })?.delta_premium_cents;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error("an 'endorsed' event must carry delta_premium_cents as a whole number of cents");
  }
  return value;
}

// Rebuilds the cache row of one policy inside the caller's transaction.
export async function refreshPolicyCurrent(
  transaction: postgres.TransactionSql,
  policyId: string,
): Promise<void> {
  const { eventTypes, terms, boundAt } = await foldPolicyEvents(transaction, policyId);
  const status = derivePolicyStatus({
    policyEventTypes: eventTypes,
    latestPaymentStatus: await latestCheckoutStatus(transaction, policyId),
  });

  await transaction`
    insert into policy_current (
      policy_id, status, effective_at, term_end, annual_premium_cents, tax_rate_bps,
      tax_cents, fee_cents, total_charge_cents, per_occurrence_limit_cents,
      aggregate_limit_cents, bound_at, rebuilt_at
    ) values (
      ${policyId}, ${status}, ${terms.termStart}, ${terms.termEnd}, ${terms.annualPremiumCents},
      ${terms.taxRateBps}, ${terms.taxCents}, ${terms.feeCents}, ${terms.totalChargeCents},
      ${terms.perOccurrenceLimitCents}, ${terms.aggregateLimitCents}, ${boundAt}, now()
    )
    on conflict (policy_id) do update set
      status                     = excluded.status,
      effective_at               = excluded.effective_at,
      term_end                   = excluded.term_end,
      annual_premium_cents       = excluded.annual_premium_cents,
      tax_rate_bps               = excluded.tax_rate_bps,
      tax_cents                  = excluded.tax_cents,
      fee_cents                  = excluded.fee_cents,
      total_charge_cents         = excluded.total_charge_cents,
      per_occurrence_limit_cents = excluded.per_occurrence_limit_cents,
      aggregate_limit_cents      = excluded.aggregate_limit_cents,
      bound_at                   = excluded.bound_at,
      rebuilt_at                 = now()
  `;
}

// The last thing the payment provider told us about this policy's ISSUANCE checkout operation.
// Null when the broker has not started a payment yet. An endorsement delta is also collected
// by a stripe_checkout operation (slice B4), but that payment has its own life on the
// endorsement and must not make a bound policy read as awaiting payment, so operations that
// have an endorsement_collections row are left out.
export async function latestCheckoutStatus(
  database: Queryable,
  policyId: string,
): Promise<MoneyOperationStatus | null> {
  const [latest] = await database<{ status: MoneyOperationStatus }[]>`
    select event.status
      from money_operation_events event
      join money_operations operation on operation.id = event.operation_id
     where operation.policy_id = ${policyId}
       and operation.kind = 'stripe_checkout'
       and not exists (select 1 from endorsement_collections link where link.collection_operation_id = operation.id)
     order by event.sequence_number desc
     limit 1
  `;
  return latest ? latest.status : null;
}

function carriesTerms(payload: unknown): boolean {
  return typeof payload === "object" && payload !== null && "annual_premium_cents" in payload;
}
