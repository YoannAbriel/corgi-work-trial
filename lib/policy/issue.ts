import type postgres from "postgres";
import { sql } from "@/db/client";
import { termEnd } from "@/lib/money/dates";
import { computePolicyCharge } from "./charge";
import { refreshPolicyCurrent } from "./current";
import { lookupStateTaxRate } from "./tax-rate";
import { policyTermsToPayload, type PolicyTerms } from "./terms";

// Creating a policy draft. No money moves here and no coverage starts: the broker asks for a
// price, and the price is written down as an immutable 'quoted' policy event so that the
// amount charged later can never drift from the amount quoted.

export type NewPolicyDraft = {
  brokerId: string;
  createdByUserId: string;
  customerName: string;
  customerEmail: string;
  stateCode: string;
  effectiveAt: string; // "YYYY-MM-DD", the term start
  annualPremiumCents: number;
  perOccurrenceLimitCents: number;
  aggregateLimitCents: number;
};

// Thrown when the request is not something we can price. The message is shown to the broker.
export class PolicyDraftRefused extends Error {}

export async function createPolicyDraft(draft: NewPolicyDraft): Promise<{ policyId: string; policyNumber: string }> {
  // termEnd validates the date and applies the term rule (same calendar date next year, or
  // February 28 when that date does not exist). It throws on a date that does not exist.
  const termEndDate = termEnd(draft.effectiveAt);

  const taxRate = await lookupStateTaxRate(draft.stateCode, draft.effectiveAt);
  if (!taxRate) {
    throw new PolicyDraftRefused(
      `no premium tax rate is on file for ${draft.stateCode} on ${draft.effectiveAt}; this build prices one state only`,
    );
  }

  const charge = computePolicyCharge(draft.annualPremiumCents, taxRate.rateBps);
  const terms: PolicyTerms = {
    stateCode: draft.stateCode,
    termStart: draft.effectiveAt,
    termEnd: termEndDate,
    annualPremiumCents: charge.annualPremiumCents,
    taxRateBps: charge.taxRateBps,
    taxCents: charge.taxCents,
    feeCents: charge.feeCents,
    totalChargeCents: charge.totalChargeCents,
    perOccurrenceLimitCents: draft.perOccurrenceLimitCents,
    aggregateLimitCents: draft.aggregateLimitCents,
  };

  // One transaction: either the customer, the policy, its quote and the cache row all exist,
  // or none of them does.
  return sql.begin(async (transaction) => {
    const customerId = await findOrCreateCustomer(transaction, draft.customerName, draft.customerEmail);

    const [policy] = await transaction<{ id: string; policy_number: string }[]>`
      insert into policies (broker_id, customer_id, state_code, created_by)
      values (${draft.brokerId}, ${customerId}, ${draft.stateCode}, ${draft.createdByUserId})
      returning id, policy_number
    `;

    await transaction`
      insert into policy_events (policy_id, event_type, effective_at, payload, created_by)
      values (${policy.id}, 'quoted', ${draft.effectiveAt},
              ${transaction.json(policyTermsToPayload(terms))}, ${draft.createdByUserId})
    `;

    await refreshPolicyCurrent(transaction, policy.id);
    return { policyId: policy.id, policyNumber: policy.policy_number };
  });
}

// Customers are matched on their email so the demo does not accumulate a new row per policy.
// Two simultaneous drafts for a brand-new email would create two customer rows; nothing
// financial depends on the customer row, so that duplicate is a cosmetic issue, not a money one.
async function findOrCreateCustomer(
  transaction: postgres.TransactionSql,
  name: string,
  email: string,
): Promise<string> {
  const [existing] = await transaction<{ id: string }[]>`select id from customers where email = ${email}`;
  if (existing) {
    return existing.id;
  }
  const [created] = await transaction<{ id: string }[]>`
    insert into customers (name, email) values (${name}, ${email}) returning id
  `;
  return created.id;
}
