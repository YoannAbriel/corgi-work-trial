import { sql } from "@/db/client";
import { centsFromDatabase } from "@/lib/money/cents";
import { refundStateFromEvents, type RefundState } from "@/lib/payments/refunds";
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
  customerId: string;
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
      customer_id: string;
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
           customer.id          as customer_id,
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
    customerId: row.customer_id,
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
  // Set when the money arrived but the policy was NOT bound because the broker was not
  // eligible at that moment (lib/payments/collection.ts). It is read back from the operation's
  // own 'succeeded' status row, so the page shows the reason that was recorded, not a fresh
  // guess at why.
  bindingRefusedReason: string | null;
};

// The policy's ISSUANCE payment operation, if the broker has started one: the latest attempt to
// pay the policy itself. An endorsement delta is also collected by a stripe_checkout operation
// (slice B4) and is shown with its endorsement, so those are left out here.
export async function checkoutOperationOfPolicy(policyId: string): Promise<CheckoutOperationView | null> {
  const [operation] = await sql<{ id: string; amount_cents: string }[]>`
    select id, amount_cents
      from money_operations operation
     where policy_id = ${policyId} and kind = 'stripe_checkout'
       and not exists (select 1 from endorsement_collections link where link.collection_operation_id = operation.id)
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

  // The payment succeeded; whether it also bound the policy is on that same row.
  const [succeeded] = await sql<{ payload: { binding_refused_reason?: string } }[]>`
    select payload from money_operation_events
     where operation_id = ${operation.id} and status = 'succeeded'
     order by sequence_number desc
     limit 1
  `;

  return {
    operationId: operation.id,
    amountCents: centsFromDatabase(operation.amount_cents, "amount_cents"),
    latestStatus: latest ? latest.status : null,
    checkoutUrl: accepted?.payload?.checkout_url ?? null,
    providerRef: accepted?.provider_ref ?? null,
    bindingRefusedReason: succeeded?.payload?.binding_refused_reason ?? null,
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

// The correction that reversed this policy's issuance, when there is one. The policy status is
// then 'voided': the issuance row and its entries are still in the database, the fold no longer
// applies them, and this is what the page shows instead of a bound policy.
export type VoidCorrectionView = {
  correctionEventId: string;
  reason: string;
  recordedAt: Date;
  reversedEntryCount: number;
};

export async function voidCorrectionOfPolicy(policyId: string): Promise<VoidCorrectionView | null> {
  const [row] = await sql<
    { id: string; reason: string | null; recorded_at: Date; reversed_entry_ids: string[] | null }[]
  >`
    select reversal.id,
           reversal.payload ->> 'reason' as reason,
           reversal.recorded_at,
           reversal.payload -> 'reversed_entry_ids' as reversed_entry_ids
      from policy_events reversal
      join policy_events superseded on superseded.id = reversal.supersedes_event_id
     where reversal.policy_id = ${policyId}
       and reversal.event_type = 'correction_reversal'
       and superseded.event_type = 'issued'
     order by reversal.sequence_number desc
     limit 1
  `;
  if (!row) {
    return null;
  }
  return {
    correctionEventId: row.id,
    reason: row.reason ?? "no reason recorded",
    recordedAt: row.recorded_at,
    reversedEntryCount: Array.isArray(row.reversed_entry_ids) ? row.reversed_entry_ids.length : 0,
  };
}

// ---------------------------------------------------------------------------
// Cancellation and refunds (slice B5)
// ---------------------------------------------------------------------------

// The cancellation as it was decided: every figure comes from the immutable policy event, not
// from a fresh calculation, so the page keeps explaining what was actually booked even if a
// rate or a rule changes later.
export type CancellationView = {
  effectiveAt: string;
  recordedAt: Date;
  calculationMethod: string;
  termDays: number;
  earnedDays: number;
  writtenPremiumCents: number;
  earnedPremiumCents: number;
  unearnedPremiumCents: number;
  refundedTaxCents: number;
  taxRefundWasCappedAtCharged: boolean;
  refundedFeeCents: number;
  totalRefundCents: number;
  commissionClawbackCents: number;
  commissionRateBps: number;
  taxRateBps: number;
};

export async function cancellationOfPolicy(policyId: string): Promise<CancellationView | null> {
  const [row] = await sql<{ effective_at: string; recorded_at: Date; payload: Record<string, unknown> }[]>`
    select to_char(effective_at, 'YYYY-MM-DD') as effective_at, recorded_at, payload
      from policy_events
     where policy_id = ${policyId} and event_type = 'cancelled'
  `;
  if (!row) {
    return null;
  }
  const amountCents = (field: string) => centsFromDatabase(row.payload[field], field);
  const wholeNumber = (field: string) => Number(row.payload[field] ?? 0);
  return {
    effectiveAt: row.effective_at,
    recordedAt: row.recorded_at,
    calculationMethod: String(row.payload.calculation_method ?? "pro_rata"),
    termDays: wholeNumber("term_days"),
    earnedDays: wholeNumber("earned_days"),
    writtenPremiumCents: amountCents("written_premium_cents"),
    earnedPremiumCents: amountCents("earned_premium_cents"),
    unearnedPremiumCents: amountCents("unearned_premium_cents"),
    refundedTaxCents: amountCents("refunded_tax_cents"),
    taxRefundWasCappedAtCharged: row.payload.tax_refund_was_capped_at_charged === true,
    refundedFeeCents: amountCents("refunded_fee_cents"),
    totalRefundCents: amountCents("total_refund_cents"),
    commissionClawbackCents: amountCents("commission_clawback_cents"),
    commissionRateBps: wholeNumber("commission_rate_bps"),
    taxRateBps: wholeNumber("tax_rate_bps"),
  };
}

// A refund the customer is owed, and where it stands. Requested and completed are kept apart
// everywhere: a refund we have asked Stripe for is not money the customer has received.
export type RefundOperationView = {
  operationId: string;
  amountCents: number;
  refundedPremiumCents: number;
  refundedTaxCents: number;
  commissionClawbackCents: number;
  paymentIntentId: string;
  state: RefundState;
  refundId: string | null; // the Stripe refund id, once Stripe has accepted it
  requestedAt: Date;
  completedOn: string | null; // the UTC day the money left Stripe
  failureReason: string | null;
  // Stripe reported a failure after this refund had already completed. It cannot happen on the
  // card refunds this build creates, and nothing is reversed automatically, so it is shown as
  // something an operator has to look at.
  failedAfterCompletion: boolean;
  // Maker-checker (slice B7): a refund above $1,000 carries an approval request and does not
  // leave for Stripe until a second person has approved it. Null below the threshold.
  approvalRequestId: string | null;
  approvalDecision: "approved" | "rejected" | null;
};

export async function refundOperationsOfPolicy(policyId: string): Promise<RefundOperationView[]> {
  const operations = await sql<
    {
      operation_id: string;
      amount_cents: string;
      refunded_premium_cents: string;
      refunded_tax_cents: string;
      commission_clawback_cents: string;
      payment_intent_id: string;
      requested_at: Date;
      approval_request_id: string | null;
      approval_decision: "approved" | "rejected" | null;
    }[]
  >`
    select operation.id as operation_id,
           operation.amount_cents,
           allocation.refunded_premium_cents,
           allocation.refunded_tax_cents,
           allocation.commission_clawback_cents,
           allocation.payment_intent_id,
           operation.created_at as requested_at,
           operation.approval_request_id,
           decision.decision as approval_decision
      from money_operations operation
      join refund_allocations allocation on allocation.refund_operation_id = operation.id
      left join approval_decisions decision on decision.request_id = operation.approval_request_id
     where operation.policy_id = ${policyId} and operation.kind = 'stripe_refund'
     order by operation.created_at
  `;
  if (operations.length === 0) {
    return [];
  }

  const events = await sql<
    { operation_id: string; status: string; provider_ref: string | null; payload: Record<string, unknown> }[]
  >`
    select event.operation_id, event.status, event.provider_ref, event.payload
      from money_operation_events event
      join money_operations operation on operation.id = event.operation_id
     where operation.policy_id = ${policyId} and operation.kind = 'stripe_refund'
     order by event.sequence_number
  `;

  return operations.map((operation) => {
    const ownEvents = events.filter((event) => event.operation_id === operation.operation_id);
    const state = refundStateFromEvents(ownEvents.map((event) => event.status));
    const succeeded = ownEvents.find((event) => event.status === "succeeded");
    const lastFailure = [...ownEvents].reverse().find((event) => event.status === "failed");
    return {
      operationId: operation.operation_id,
      amountCents: centsFromDatabase(operation.amount_cents, "amount_cents"),
      refundedPremiumCents: centsFromDatabase(operation.refunded_premium_cents, "refunded_premium_cents"),
      refundedTaxCents: centsFromDatabase(operation.refunded_tax_cents, "refunded_tax_cents"),
      commissionClawbackCents: centsFromDatabase(operation.commission_clawback_cents, "commission_clawback_cents"),
      paymentIntentId: operation.payment_intent_id,
      state,
      refundId: ownEvents.find((event) => event.provider_ref !== null)?.provider_ref ?? null,
      requestedAt: operation.requested_at,
      completedOn: succeeded ? String(succeeded.payload.refunded_on ?? "") || null : null,
      // Shown only while the refund has not completed: a failure followed by a successful
      // re-issue is history, not something to alarm the broker with.
      failureReason:
        state === "failed" && lastFailure
          ? String(lastFailure.payload.reason ?? lastFailure.payload.message ?? "Stripe refused the refund")
          : null,
      failedAfterCompletion: state === "completed" && ownEvents[ownEvents.length - 1]?.status === "failed",
      approvalRequestId: operation.approval_request_id,
      approvalDecision: operation.approval_decision,
    };
  });
}
