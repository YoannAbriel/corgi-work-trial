import type postgres from "postgres";
import { sql } from "@/db/client";
import { documentEventsFromRows, type PolicyEventRowForDocuments } from "@/lib/documents/from-database";
import { foldPolicyEvents as foldForDocuments } from "@/lib/documents/policy-as-of";
import type { PolicySnapshot } from "@/lib/documents/policy-snapshot";
import { centsFromDatabase, formatCentsAsUsd } from "@/lib/money/cents";
import {
  correctionApprovalSentences,
  correctionFormulaLines,
  type CorrectionApprovalSentences,
  type EndorsementDateCorrection,
} from "@/lib/money/correction";
import type { FormulaLine } from "@/lib/money/endorsement";
import { isCalendarDate } from "@/lib/money/dates";
import { figuresFromPayload } from "./endorsement-requests";
import type { MoneyOperationStatus } from "./status";

// Every read the correction screens need: what a correction did, the whole timeline of a policy
// with both its clocks, and the policy as it stood on any business date.
//
// Nothing here computes money. Every figure comes from an immutable event or from the journal,
// and the formula lines are rebuilt from those stored figures by the same pure function that
// produced them (lib/money/correction.ts).

type Queryable = postgres.Sql | postgres.TransactionSql;

// ---------------------------------------------------------------------------
// One correction, explained
// ---------------------------------------------------------------------------

// One journal entry a correction posted, with its lines, both its dates and its provenance.
export type CorrectionEntryView = {
  entryId: string;
  entryType: string;
  effectiveAt: string;
  recordedAt: Date;
  description: string;
  reversesEntryId: string | null;
  lines: { accountId: string; accountName: string; debitCents: number; creditCents: number }[];
};

export type CorrectionCollectionView = {
  operationId: string;
  amountCents: number;
  latestStatus: MoneyOperationStatus | null;
  checkoutUrl: string | null;
  paidOn: string | null;
  isDead: boolean;
  customerApprovalRequired: boolean;
  customerApprovedAt: Date | null;
};

export type CorrectionView = {
  reversalEventId: string;
  rebookEventId: string;
  reason: string;
  wrongEffectiveAt: string;
  correctedEffectiveAt: string;
  recordedAt: Date; // when the correction was written down: the "we learned it today" clock
  operatorName: string | null;
  description: string; // what the endorsement itself changed
  money: EndorsementDateCorrection;
  lines: FormulaLine[];
  // The verdict on each threshold with the total behind it, rebuilt from the figures the
  // correction stored: the same sentence the preview showed before it was executed.
  approvalSentences: CorrectionApprovalSentences;
  entries: CorrectionEntryView[];
  collection: CorrectionCollectionView | null; // the difference to collect, when there is one
};

// Every correction of an endorsement date on this policy, oldest first.
export async function correctionsOfPolicy(policyId: string, database: Queryable = sql): Promise<CorrectionView[]> {
  const rows = await database<
    {
      reversal_id: string;
      reversal_recorded_at: Date;
      reversal_payload: Record<string, unknown>;
      operator_name: string | null;
      wrong_payload: Record<string, unknown>;
      rebook_id: string;
      rebook_payload: Record<string, unknown>;
    }[]
  >`
    select reversal.id           as reversal_id,
           reversal.recorded_at  as reversal_recorded_at,
           reversal.payload      as reversal_payload,
           operator.display_name as operator_name,
           wrong.payload         as wrong_payload,
           rebook.id             as rebook_id,
           rebook.payload        as rebook_payload
      from policy_events reversal
      join policy_events wrong  on wrong.id = reversal.supersedes_event_id
      join policy_events rebook on rebook.policy_id = reversal.policy_id
                              and rebook.event_type = 'correction_rebook'
                              and rebook.payload ->> 'correction_reversal_event_id' = reversal.id::text
      left join users operator  on operator.id::text = reversal.created_by
     where reversal.policy_id = ${policyId}
       and reversal.event_type = 'correction_reversal'
     order by reversal.sequence_number
  `;

  const corrections: CorrectionView[] = [];
  for (const row of rows) {
    // The figures as they were booked come from the superseded event, which is still in the
    // table; the corrected ones and the difference come from the re-book. Nothing is recomputed.
    const before = figuresFromPayload(policyId, row.wrong_payload);
    const after = figuresFromPayload(policyId, row.rebook_payload);
    const money: EndorsementDateCorrection = {
      wrongEffectiveAt: before.effectiveAt,
      correctedEffectiveAt: after.effectiveAt,
      before,
      after,
      differencePremiumCents: signedCents(row.rebook_payload, "difference_premium_cents"),
      differenceTaxCents: signedCents(row.rebook_payload, "difference_tax_cents"),
      differenceTotalCents: signedCents(row.rebook_payload, "difference_total_cents"),
      differenceCommissionCents: signedCents(row.rebook_payload, "difference_commission_cents"),
      settlement: settlementOf(row.rebook_payload),
      // THE VERDICTS ARE READ FROM THE EVENT, NEVER RECOMPUTED (review finding F-B8-02). The
      // correction decided them once, against the totals it stored beside them; asking the
      // question again here with today's totals is how a screen ends up saying "no approval
      // needed" two lines above the approval it is waiting for.
      customerApprovalRequired: row.rebook_payload.difference_customer_approval_required === true,
      refundNeedsApproval: row.rebook_payload.difference_refund_needs_approval === true,
      totals: {
        policyRefundedCents: signedCents(row.rebook_payload, "policy_refunded_cents"),
        policyPendingRefundCents: signedCents(row.rebook_payload, "policy_pending_refund_cents"),
        customerUnapprovedRequestedCents: signedCents(row.rebook_payload, "customer_unapproved_requested_cents"),
      },
    };
    corrections.push({
      reversalEventId: row.reversal_id,
      rebookEventId: row.rebook_id,
      reason: String(row.reversal_payload.reason ?? "no reason recorded"),
      wrongEffectiveAt: before.effectiveAt,
      correctedEffectiveAt: after.effectiveAt,
      recordedAt: row.reversal_recorded_at,
      operatorName: row.operator_name,
      description: String(row.rebook_payload.description ?? ""),
      money,
      lines: correctionFormulaLines(money),
      approvalSentences: correctionApprovalSentences(money),
      entries: await entriesOfCorrection(database, row.reversal_id, row.rebook_id),
      collection: await collectionOfCorrection(database, row.rebook_id),
    });
  }
  return corrections;
}

// Every entry the correction posted: the reversals (filed under the correction event) and the
// re-booked premium and tax (filed under the re-book event).
async function entriesOfCorrection(
  database: Queryable,
  reversalEventId: string,
  rebookEventId: string,
): Promise<CorrectionEntryView[]> {
  const rows = await database<
    {
      entry_id: string;
      entry_type: string;
      effective_at: string;
      recorded_at: Date;
      description: string;
      reverses_entry_id: string | null;
      account_id: string;
      account_name: string;
      debit_cents: string;
      credit_cents: string;
      line_id: string;
    }[]
  >`
    select entry.id as entry_id, entry.entry_type,
           to_char(entry.effective_at, 'YYYY-MM-DD') as effective_at,
           entry.recorded_at, entry.description, entry.reverses_entry_id,
           line.id as line_id, line.account_id, account.name as account_name, line.debit_cents, line.credit_cents
      from journal_entries entry
      join journal_lines line on line.entry_id = entry.id
      join accounts account on account.id = line.account_id
     where entry.source_kind = 'correction'
       and entry.source_id in (${reversalEventId}, ${rebookEventId})
     order by entry.recorded_at, entry.id, line.id
  `;

  const entries: CorrectionEntryView[] = [];
  for (const row of rows) {
    let entry = entries.find((candidate) => candidate.entryId === row.entry_id);
    if (!entry) {
      entry = {
        entryId: row.entry_id,
        entryType: row.entry_type,
        effectiveAt: row.effective_at,
        recordedAt: row.recorded_at,
        description: row.description,
        reversesEntryId: row.reverses_entry_id,
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

// The difference this correction created and asked the customer for, and where it stands.
async function collectionOfCorrection(database: Queryable, rebookEventId: string): Promise<CorrectionCollectionView | null> {
  const [link] = await database<{ operation_id: string; amount_cents: string; approval_required: boolean }[]>`
    select link.collection_operation_id as operation_id,
           link.amount_cents,
           -- Read from the re-book event, not recomputed from the amount: the correction decided
           -- it once, cumulatively, and the approval event below has to agree with it.
           coalesce((rebook.payload ->> 'difference_customer_approval_required')::boolean, false) as approval_required
      from correction_collections link
      join money_operations operation on operation.id = link.collection_operation_id
      join policy_events rebook on rebook.id = link.correction_rebook_event_id
     where link.correction_rebook_event_id = ${rebookEventId}
     order by operation.created_at desc
     limit 1
  `;
  if (!link) {
    return null;
  }
  const events = await database<{ status: MoneyOperationStatus; payload: Record<string, unknown> }[]>`
    select status, payload from money_operation_events where operation_id = ${link.operation_id} order by sequence_number
  `;
  const [approval] = await database<{ recorded_at: Date }[]>`
    select recorded_at from policy_events
     where event_type = 'correction_approved' and payload ->> 'correction_rebook_event_id' = ${rebookEventId}
  `;
  const accepted = events.find((event) => typeof event.payload.checkout_url === "string");
  const succeeded = [...events].reverse().find((event) => event.status === "succeeded");
  const amountCents = centsFromDatabase(link.amount_cents, "amount_cents");
  return {
    operationId: link.operation_id,
    amountCents,
    // A final status wins over a later step (F-B2-20, F-B2-21): rows written before the guard
    // keep their order forever, and what the screen calls the last status is the furthest the
    // operation got.
    latestStatus: succeeded ? "succeeded" : events.length > 0 ? events[events.length - 1].status : null,
    checkoutUrl: accepted ? String(accepted.payload.checkout_url) : null,
    paidOn: succeeded && typeof succeeded.payload.paid_on === "string" ? succeeded.payload.paid_on : null,
    isDead: events.some((event) => event.status === "failed" && event.payload.reason === "expired"),
    customerApprovalRequired: link.approval_required,
    customerApprovedAt: approval?.recorded_at ?? null,
  };
}

function signedCents(payload: Record<string, unknown>, key: string): number {
  return centsFromDatabase(payload[key], key);
}

function settlementOf(payload: Record<string, unknown>): "collect" | "refund" | "none" {
  const value = payload.settlement;
  return value === "collect" || value === "refund" ? value : "none";
}

// ---------------------------------------------------------------------------
// The timeline: both clocks, side by side
// ---------------------------------------------------------------------------

// EFFECTIVE TIME AND RECORDED TIME, which is the question the panel asks.
//   effective_at  the business date the fact applies from: the day cover changed. It is what
//                 prices money, and it can be in the past or in the future.
//   recorded_at   the instant we wrote it down, set by the database clock and never by a
//                 client. It is what answers "what did we know on that day".
// A backdated correction has an effective date in the past and a recording time of now, which
// is why the two columns below are never merged.
export type TimelineRow = {
  eventId: string;
  eventType: string;
  effectiveAt: string;
  recordedAt: Date;
  summary: string;
  // Set when a later correction superseded this event: the fold no longer applies it, the row
  // stays in the table, and the screen strikes it through and names what replaced it.
  supersededByEventId: string | null;
  supersededByEventType: string | null;
  // Set on a correction event: the event it supersedes.
  supersedesEventId: string | null;
};

export async function policyTimeline(policyId: string, database: Queryable = sql): Promise<TimelineRow[]> {
  const rows = await database<
    {
      id: string;
      event_type: string;
      effective_at: string;
      recorded_at: Date;
      payload: Record<string, unknown>;
      supersedes_event_id: string | null;
      superseded_by_id: string | null;
      superseded_by_type: string | null;
    }[]
  >`
    select event.id, event.event_type,
           to_char(event.effective_at, 'YYYY-MM-DD') as effective_at,
           event.recorded_at, event.payload, event.supersedes_event_id,
           correction.id         as superseded_by_id,
           correction.event_type as superseded_by_type
      from policy_events event
      left join policy_events correction on correction.supersedes_event_id = event.id
     where event.policy_id = ${policyId}
     order by event.sequence_number
  `;
  return rows.map((row) => ({
    eventId: row.id,
    eventType: row.event_type,
    effectiveAt: row.effective_at,
    recordedAt: row.recorded_at,
    summary: summarise(row.event_type, row.payload),
    supersededByEventId: row.superseded_by_id,
    supersededByEventType: row.superseded_by_type,
    supersedesEventId: row.supersedes_event_id,
  }));
}

// One sentence per event, built from the figures the event itself carries. Formatted on the
// server: no money value is ever computed in the browser.
function summarise(eventType: string, payload: Record<string, unknown>): string {
  const cents = (key: string): string => {
    const value = payload[key];
    return typeof value === "number" ? formatCentsAsUsd(value) : "an amount not recorded";
  };
  switch (eventType) {
    case "quoted":
      return `Quote priced at ${cents("annual_premium_cents")} of annual premium`;
    case "issued":
      return `Policy bound at ${cents("annual_premium_cents")} of annual premium`;
    case "endorsement_requested":
      return `Endorsement quoted: ${payload.description ?? "change"}, ${cents("delta_total_cents")} to settle`;
    case "endorsement_approved":
      return `The customer approved that quote (${cents("delta_total_cents")})`;
    case "endorsed":
      return `Endorsement in force: ${payload.description ?? "change"}, ${cents("delta_premium_cents")} of prorated premium`;
    case "cancelled":
      return `Policy cancelled, ${cents("total_refund_cents")} refunded`;
    case "correction_reversal": {
      // Two different corrections write this event type. A date correction (slice B8) carries the
      // two dates; the void of a binding that rested on a payment that never happened
      // (lib/policy/void-fabricated-binding.ts, CGP-01061) carries neither, and printing
      // "effective date ? put right to ?" for it was simply wrong.
      const reason = payload.reason ?? "no reason recorded";
      const wrongDate = payload.wrong_effective_at;
      const rightDate = payload.corrected_effective_at;
      if (typeof wrongDate === "string" && typeof rightDate === "string") {
        return `Correction: effective date ${wrongDate} put right to ${rightDate} (${reason})`;
      }
      return `Correction: the event above was reversed and nothing re-books it, so it no longer counts (${reason})`;
    }
    case "correction_rebook":
      return `Endorsement re-booked on ${payload.corrected_effective_at ?? "?"}: ${cents("delta_premium_cents")} of prorated premium, difference ${cents("difference_total_cents")}`;
    case "correction_approved":
      return `The customer approved paying the correction difference of ${cents("amount_cents")}`;
    default:
      return eventType;
  }
}

// ---------------------------------------------------------------------------
// The dates the "as it stood on" control steps through (slice B12-3)
// ---------------------------------------------------------------------------

export type PolicyAsOfStep = {
  date: string; // "YYYY-MM-DD", the value the ?asOf link carries
  label: string; // what happened that day, in the reader's words
};

// An event type that changes what the policy IS on a date, and the word the step wears. A
// correction_reversal is deliberately absent: it carries the WRONG date, the one being put right,
// and offering it as a step would invite a reader to rebuild the policy on a date the correction
// exists to erase. The re-book carries the corrected date and is the step.
const STEP_LABEL: Record<string, string> = {
  endorsed: "endorsement",
  correction_rebook: "corrected endorsement",
  cancelled: "cancellation",
};

// The dates worth asking about on one policy: the term start, every effective date of an event
// still in force, and today. Superseded events are skipped, exactly as the timeline strikes them
// through: the fold no longer applies them, so rebuilding the policy on their date would answer a
// question about a fact that was put right.
//
// Two steps on the same day become one step with both words, so the row never shows the same date
// twice and the highlight can be decided by date alone.
export async function policyAsOfSteps(
  policyId: string,
  termStart: string,
  today: string,
  database: Queryable = sql,
): Promise<PolicyAsOfStep[]> {
  const rows = await policyTimeline(policyId, database);

  const labelsByDate = new Map<string, string[]>();
  const addStep = (date: string, label: string): void => {
    const labels = labelsByDate.get(date);
    if (!labels) {
      labelsByDate.set(date, [label]);
      return;
    }
    if (!labels.includes(label)) {
      labels.push(label);
    }
  };

  addStep(termStart, "term start");
  for (const row of rows) {
    if (row.supersededByEventId) {
      continue; // struck through on the timeline: the fold no longer applies it
    }
    const label = STEP_LABEL[row.eventType];
    if (label) {
      addStep(row.effectiveAt, label);
    }
  }
  addStep(today, "today");

  return [...labelsByDate.entries()]
    .map(([date, labels]) => ({ date, label: labels.join(", ") }))
    .sort((first, second) => (first.date < second.date ? -1 : first.date > second.date ? 1 : 0));
}

// ---------------------------------------------------------------------------
// The policy as it stood on a business date
// ---------------------------------------------------------------------------

export type PolicyAsOfResult = { asOf: string; snapshot: PolicySnapshot } | { asOf: string; error: string };

// The same fold the PDFs use (lib/documents/policy-as-of.ts), rendered as HTML instead. Only the
// events effective on or before `asOf` count, and an event superseded by a correction effective
// by then is dropped: between two endorsements this shows the premium and the limits that were
// really in force that day.
export async function policyAsItStoodOn(policyId: string, asOf: string, database: Queryable = sql): Promise<PolicyAsOfResult> {
  if (!isCalendarDate(asOf)) {
    return { asOf, error: `"${asOf}" is not a calendar date` };
  }
  const [policy] = await database<
    {
      policy_number: string;
      state_code: string;
      broker_name: string;
      customer_name: string;
      customer_email: string;
    }[]
  >`
    select policy.policy_number, policy.state_code, broker.name as broker_name,
           customer.name as customer_name, customer.email as customer_email
      from policies policy
      join brokers broker on broker.id = policy.broker_id
      join customers customer on customer.id = policy.customer_id
     where policy.id = ${policyId}
  `;
  if (!policy) {
    return { asOf, error: "this policy does not exist" };
  }

  const rows = await database<PolicyEventRowForDocuments[]>`
    select id, event_type, to_char(effective_at, 'YYYY-MM-DD') as effective_at, recorded_at, supersedes_event_id, payload
      from policy_events
     where policy_id = ${policyId}
     order by sequence_number
  `;
  try {
    const events = documentEventsFromRows(rows, {
      policyNumber: policy.policy_number,
      insuredName: policy.customer_name,
      insuredEmail: policy.customer_email,
      brokerName: policy.broker_name,
      stateCode: policy.state_code,
    });
    return { asOf, snapshot: foldForDocuments(events, asOf, new Date().toISOString()) };
  } catch (error) {
    // A date before the policy existed has no answer, and inventing one would be worse than
    // saying so.
    return { asOf, error: error instanceof Error ? error.message : "the policy cannot be rebuilt on that date" };
  }
}
