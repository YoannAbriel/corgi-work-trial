import { sql } from "@/db/client";
import { centsFromDatabase } from "@/lib/money/cents";
import type { MoneyOperationStatus, PolicyStatus } from "./status";

// Every read the pages need. Amounts come back from Postgres as strings (bigint columns) and
// are turned into whole numbers of cents here, once, by centsFromDatabase.

export type PolicyListRow = {
  policyId: string;
  policyNumber: string;
  customerName: string;
  stateCode: string;
  status: PolicyStatus;
  effectiveAt: string;
  totalChargeCents: number;
};

export async function policiesOfBroker(brokerId: string): Promise<PolicyListRow[]> {
  const rows = await sql<
    {
      policy_id: string;
      policy_number: string;
      customer_name: string;
      state_code: string;
      status: PolicyStatus;
      effective_at: string;
      total_charge_cents: string;
    }[]
  >`
    select policy.id            as policy_id,
           policy.policy_number as policy_number,
           customer.name        as customer_name,
           policy.state_code    as state_code,
           current_policy.status,
           to_char(current_policy.effective_at, 'YYYY-MM-DD') as effective_at,
           current_policy.total_charge_cents
      from policies policy
      join customers customer      on customer.id = policy.customer_id
      join policy_current current_policy on current_policy.policy_id = policy.id
     where policy.broker_id = ${brokerId}
     order by policy.created_at desc
  `;
  return rows.map((row) => ({
    policyId: row.policy_id,
    policyNumber: row.policy_number,
    customerName: row.customer_name,
    stateCode: row.state_code,
    status: row.status,
    effectiveAt: row.effective_at,
    totalChargeCents: centsFromDatabase(row.total_charge_cents, "total_charge_cents"),
  }));
}

export type PolicyDetail = {
  policyId: string;
  policyNumber: string;
  brokerId: string;
  brokerName: string;
  commissionRateBps: number;
  customerName: string;
  customerEmail: string;
  stateCode: string;
  status: PolicyStatus;
  effectiveAt: string;
  termEnd: string;
  annualPremiumCents: number;
  taxRateBps: number;
  taxCents: number;
  feeCents: number;
  totalChargeCents: number;
  perOccurrenceLimitCents: number;
  aggregateLimitCents: number;
  boundAt: Date | null;
};

export async function policyDetail(policyId: string): Promise<PolicyDetail | null> {
  const [row] = await sql<
    {
      policy_id: string;
      policy_number: string;
      broker_id: string;
      broker_name: string;
      commission_rate_bps: number;
      customer_name: string;
      customer_email: string;
      state_code: string;
      status: PolicyStatus;
      effective_at: string;
      term_end: string;
      annual_premium_cents: string;
      tax_rate_bps: number;
      tax_cents: string;
      fee_cents: string;
      total_charge_cents: string;
      per_occurrence_limit_cents: string;
      aggregate_limit_cents: string;
      bound_at: Date | null;
    }[]
  >`
    select policy.id            as policy_id,
           policy.policy_number as policy_number,
           broker.id            as broker_id,
           broker.name          as broker_name,
           broker.commission_rate_bps,
           customer.name        as customer_name,
           customer.email       as customer_email,
           policy.state_code,
           current_policy.status,
           to_char(current_policy.effective_at, 'YYYY-MM-DD') as effective_at,
           to_char(current_policy.term_end, 'YYYY-MM-DD')     as term_end,
           current_policy.annual_premium_cents,
           current_policy.tax_rate_bps,
           current_policy.tax_cents,
           current_policy.fee_cents,
           current_policy.total_charge_cents,
           current_policy.per_occurrence_limit_cents,
           current_policy.aggregate_limit_cents,
           current_policy.bound_at
      from policies policy
      join brokers broker          on broker.id = policy.broker_id
      join customers customer      on customer.id = policy.customer_id
      join policy_current current_policy on current_policy.policy_id = policy.id
     where policy.id = ${policyId}
  `;
  if (!row) {
    return null;
  }
  return {
    policyId: row.policy_id,
    policyNumber: row.policy_number,
    brokerId: row.broker_id,
    brokerName: row.broker_name,
    commissionRateBps: row.commission_rate_bps,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    stateCode: row.state_code,
    status: row.status,
    effectiveAt: row.effective_at,
    termEnd: row.term_end,
    annualPremiumCents: centsFromDatabase(row.annual_premium_cents, "annual_premium_cents"),
    taxRateBps: row.tax_rate_bps,
    taxCents: centsFromDatabase(row.tax_cents, "tax_cents"),
    feeCents: centsFromDatabase(row.fee_cents, "fee_cents"),
    totalChargeCents: centsFromDatabase(row.total_charge_cents, "total_charge_cents"),
    perOccurrenceLimitCents: centsFromDatabase(row.per_occurrence_limit_cents, "per_occurrence_limit_cents"),
    aggregateLimitCents: centsFromDatabase(row.aggregate_limit_cents, "aggregate_limit_cents"),
    boundAt: row.bound_at,
  };
}

export type CheckoutOperationView = {
  operationId: string;
  amountCents: number;
  latestStatus: MoneyOperationStatus | null;
  checkoutUrl: string | null; // the hosted Stripe page, kept so a retry reuses the same session
  providerRef: string | null; // Checkout Session id
};

// The policy's payment operation, if the broker has started one. There is at most one
// stripe_checkout operation per policy: its idempotency key is derived from the policy id.
export async function checkoutOperationOfPolicy(policyId: string): Promise<CheckoutOperationView | null> {
  const [operation] = await sql<{ id: string; amount_cents: string }[]>`
    select id, amount_cents
      from money_operations
     where policy_id = ${policyId} and kind = 'stripe_checkout'
     order by created_at desc
     limit 1
  `;
  if (!operation) {
    return null;
  }

  const [latest] = await sql<{ status: MoneyOperationStatus }[]>`
    select status from money_operation_events
     where operation_id = ${operation.id}
     order by sequence_number desc
     limit 1
  `;

  // The hosted page URL was stored when Stripe accepted the session creation.
  const [accepted] = await sql<{ provider_ref: string | null; payload: { checkout_url?: string } }[]>`
    select provider_ref, payload from money_operation_events
     where operation_id = ${operation.id} and status = 'provider_accepted'
     order by sequence_number
     limit 1
  `;

  return {
    operationId: operation.id,
    amountCents: centsFromDatabase(operation.amount_cents, "amount_cents"),
    latestStatus: latest ? latest.status : null,
    checkoutUrl: accepted?.payload?.checkout_url ?? null,
    providerRef: accepted?.provider_ref ?? null,
  };
}

export type JournalLineView = {
  accountId: string;
  accountName: string;
  debitCents: number;
  creditCents: number;
};

export type JournalEntryView = {
  entryId: string;
  entryType: string;
  effectiveAt: string;
  recordedAt: Date;
  description: string;
  lines: JournalLineView[];
};

// The ledger as the policy page shows it: entries in the order they were booked, each with
// its lines. Nothing is aggregated; a reader can add the columns up by hand.
export async function journalEntriesOfPolicy(policyId: string): Promise<JournalEntryView[]> {
  const rows = await sql<
    {
      entry_id: string;
      entry_type: string;
      effective_at: string;
      recorded_at: Date;
      description: string;
      account_id: string;
      account_name: string;
      debit_cents: string;
      credit_cents: string;
      line_id: string;
    }[]
  >`
    select entry.id           as entry_id,
           entry.entry_type,
           to_char(entry.effective_at, 'YYYY-MM-DD') as effective_at,
           entry.recorded_at,
           entry.description,
           line.id            as line_id,
           line.account_id,
           account.name       as account_name,
           line.debit_cents,
           line.credit_cents
      from journal_entries entry
      join journal_lines line on line.entry_id = entry.id
      join accounts account   on account.id = line.account_id
     where entry.policy_id = ${policyId}
     order by entry.recorded_at, entry.id, line.id
  `;

  const entries: JournalEntryView[] = [];
  for (const row of rows) {
    let entry = entries.find((candidate) => candidate.entryId === row.entry_id);
    if (!entry) {
      entry = {
        entryId: row.entry_id,
        entryType: row.entry_type,
        effectiveAt: row.effective_at,
        recordedAt: row.recorded_at,
        description: row.description,
        lines: [],
      };
      entries.push(entry);
    }
    entry.lines.push({
      accountId: row.account_id,
      accountName: row.account_name,
      debitCents: centsFromDatabase(row.debit_cents, "debit_cents"),
      creditCents: centsFromDatabase(row.credit_cents, "credit_cents"),
    });
  }
  return entries;
}
