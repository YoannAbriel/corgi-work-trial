import type postgres from "postgres";
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
  eventTypes: string[]; // in recording order
  terms: PolicyTerms; // the terms carried by the last event that changed them
  boundAt: Date | null; // recording time of the 'issued' event, null while not bound
};

// Reads every event of the policy in recording order and applies them:
//   - an event carrying terms (quoted today; endorsed and corrections in later slices)
//     replaces the terms;
//   - 'issued' records when the policy became bound;
//   - an event named by a later correction's supersedes_event_id is skipped: the correction
//     row stays, the superseded row stays, but the fold no longer applies it. This is how a
//     reversal un-binds a policy without deleting anything (slice B8).
export async function foldPolicyEvents(database: Queryable, policyId: string): Promise<PolicyFold> {
  const events = await database<
    { id: string; event_type: string; payload: unknown; recorded_at: Date; supersedes_event_id: string | null }[]
  >`
    select id, event_type, payload, recorded_at, supersedes_event_id
      from policy_events
     where policy_id = ${policyId}
     order by sequence_number
  `;
  if (events.length === 0) {
    throw new Error(`policy ${policyId} has no events, so there is nothing to fold`);
  }

  const supersededEventIds = new Set(
    events.filter((event) => event.supersedes_event_id !== null).map((event) => event.supersedes_event_id as string),
  );

  const eventTypes: string[] = [];
  let terms: PolicyTerms | null = null;
  let boundAt: Date | null = null;
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
  }
  if (terms === null) {
    throw new Error(`policy ${policyId} has no event carrying its terms`);
  }
  return { eventTypes, terms, boundAt };
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

// The last thing the payment provider told us about this policy's checkout operation.
// Null when the broker has not started a payment yet.
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
     order by event.sequence_number desc
     limit 1
  `;
  return latest ? latest.status : null;
}

function carriesTerms(payload: unknown): boolean {
  return typeof payload === "object" && payload !== null && "annual_premium_cents" in payload;
}
