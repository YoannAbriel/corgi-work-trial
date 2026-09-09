import type postgres from "postgres";
import { sql } from "@/db/client";
import { centsFromDatabase } from "@/lib/money/cents";
import { endorsementFormulaLines, type EndorsementFigures, type FormulaLine } from "@/lib/money/endorsement";
import { refundStateFromEvents, type RefundState } from "@/lib/payments/refunds";
import type { MoneyOperationStatus } from "./status";
import {
  endorsementRequestsOfPolicy,
  endorsementRequestStanding,
  figuresFromPayload,
  liveEndorsementRequest,
  type EndorsementRequest,
  type EndorsementRequestStanding,
} from "./endorsement-requests";

// Every read the policy page, the customer page and the approval page need about
// endorsements. Nothing here computes money: the figures come from the immutable request and
// 'endorsed' events, and the formula lines are rebuilt from those stored figures by the same
// pure function that produced them (lib/money/endorsement.ts).

// One endorsement as the pages show it: the request, where it stands, and the money that
// collected or refunded its delta.
export type EndorsementView = {
  request: EndorsementRequest;
  standing: EndorsementRequestStanding;
  lines: FormulaLine[];
  // The applied change, when there is one.
  endorsedAt: Date | null;
  // The payment collecting a positive delta: the latest attempt.
  collection: DeltaCollectionView | null;
  // The refund(s) of a negative delta.
  refunds: DeltaRefundView[];
  // True while at least one refund of this endorsement is above $1,000 and still has no
  // decision: nothing has been asked of Stripe and nothing will be until a second person says
  // yes (lib/approvals). Read from the approval request itself, never assumed from the amount.
  refundHeldForApproval: boolean;
};

export type DeltaCollectionView = {
  operationId: string;
  amountCents: number;
  latestStatus: MoneyOperationStatus | null;
  checkoutUrl: string | null;
  sessionId: string | null;
  paymentIntentId: string | null;
  paidOn: string | null;
  applicationRefusedReason: string | null; // money arrived, endorsement not applied, and why
  isDead: boolean; // the hosted page expired: a new Pay click opens a new attempt
};

export type DeltaRefundView = {
  operationId: string;
  amountCents: number;
  refundedPremiumCents: number;
  refundedTaxCents: number;
  commissionClawbackCents: number;
  paymentIntentId: string;
  state: RefundState;
  refundId: string | null;
  completedOn: string | null;
  failureReason: string | null;
  // Maker-checker (slice B7). Null below $1,000: no second person is involved at all.
  approvalRequestId: string | null;
  approvalDecision: "approved" | "rejected" | null;
};

export async function endorsementsOfPolicy(policyId: string, database: postgres.Sql = sql): Promise<EndorsementView[]> {
  const requests = await endorsementRequestsOfPolicy(database, policyId);
  const views: EndorsementView[] = [];
  for (const request of requests) {
    const standing = await endorsementRequestStanding(database, request);
    const endorsedAt = standing.endorsedEventId ? await recordedAtOfEvent(database, standing.endorsedEventId) : null;
    const refunds = standing.endorsedEventId ? await refundsOfEndorsement(database, standing.endorsedEventId) : [];
    views.push({
      request,
      standing,
      lines: endorsementFormulaLines(request.figures),
      endorsedAt,
      collection: await latestCollectionOfRequest(database, request.eventId),
      refunds,
      refundHeldForApproval: refunds.some(
        (refund) => refund.approvalRequestId !== null && refund.approvalDecision === null,
      ),
    });
  }
  return views;
}

// One row of the endorsement schedule: every applied endorsement, oldest effective date first.
// Read from the 'endorsed' events, which carry every figure they were applied with.
export type EndorsementScheduleRow = {
  endorsedEventId: string;
  effectiveAt: string;
  recordedAt: Date;
  description: string;
  newLimitLabel: string;
  figures: EndorsementFigures;
  lines: FormulaLine[];
  collectionOperationId: string | null;
  stripeReferences: string[]; // payment intent or refund ids, for the explanation block
  // Set when this row is a 'correction_rebook' (slice B8): the endorsement was entered with the
  // wrong effective date and re-booked on the right one. The date it used to carry, and why.
  correctedFromEffectiveAt: string | null;
  correctionReason: string | null;
};

// Every endorsement in force, oldest effective date first. A 'correction_rebook' that re-books an
// endorsement is one of them: it carries the same payload keys as the 'endorsed' event it
// replaced, at the corrected date, so it reads through the same code (slice B8). The superseded
// rows stay in the table and are skipped here; the timeline screen is where they are shown.
export async function endorsementScheduleOfPolicy(policyId: string, database: postgres.Sql = sql): Promise<EndorsementScheduleRow[]> {
  const rows = await database<
    { id: string; effective_at: string; recorded_at: Date; payload: Record<string, unknown>; superseded: boolean }[]
  >`
    select event.id,
           to_char(event.effective_at, 'YYYY-MM-DD') as effective_at,
           event.recorded_at,
           event.payload,
           exists (select 1 from policy_events correction where correction.supersedes_event_id = event.id) as superseded
      from policy_events event
     where event.policy_id = ${policyId}
       and (event.event_type = 'endorsed'
            or (event.event_type = 'correction_rebook' and event.payload ->> 'rebooked_event_type' = 'endorsed'))
     order by event.effective_at, event.sequence_number
  `;
  const schedule: EndorsementScheduleRow[] = [];
  for (const row of rows) {
    if (row.superseded) {
      continue; // reversed by a correction: the row stays in the table, the schedule no longer shows it
    }
    const figures = figuresFromPayload(policyId, row.payload);
    const collectionOperationId =
      typeof row.payload.collection_operation_id === "string" ? row.payload.collection_operation_id : null;
    schedule.push({
      endorsedEventId: row.id,
      effectiveAt: row.effective_at,
      recordedAt: row.recorded_at,
      description: String(row.payload.description ?? ""),
      newLimitLabel: String(row.payload.new_limit_label ?? ""),
      figures,
      lines: endorsementFormulaLines(figures),
      collectionOperationId,
      stripeReferences: await stripeReferencesOfEndorsement(database, row.id, collectionOperationId),
      correctedFromEffectiveAt: typeof row.payload.wrong_effective_at === "string" ? row.payload.wrong_effective_at : null,
      correctionReason: typeof row.payload.correction_reason === "string" ? row.payload.correction_reason : null,
    });
  }
  return schedule;
}

// ---------------------------------------------------------------------------
// The money behind one endorsement
// ---------------------------------------------------------------------------

async function latestCollectionOfRequest(database: postgres.Sql, requestEventId: string): Promise<DeltaCollectionView | null> {
  const [operation] = await database<{ id: string; amount_cents: string }[]>`
    select operation.id, operation.amount_cents
      from endorsement_collections link
      join money_operations operation on operation.id = link.collection_operation_id
     where link.request_event_id = ${requestEventId}
     order by operation.created_at desc
     limit 1
  `;
  if (!operation) {
    return null;
  }
  const events = await database<{ status: MoneyOperationStatus; provider_ref: string | null; payload: Record<string, unknown> }[]>`
    select status, provider_ref, payload from money_operation_events
     where operation_id = ${operation.id}
     order by sequence_number
  `;
  const accepted = events.find((event) => event.status === "provider_accepted" && typeof event.payload.checkout_url === "string");
  const succeeded = [...events].reverse().find((event) => event.status === "succeeded");
  const expired = events.some((event) => event.status === "failed" && event.payload.reason === "expired");
  const failedWithoutSession = events.some((event) => event.status === "failed") && !accepted;
  return {
    operationId: operation.id,
    amountCents: centsFromDatabase(operation.amount_cents, "amount_cents"),
    latestStatus: events.length > 0 ? events[events.length - 1].status : null,
    checkoutUrl: accepted ? String(accepted.payload.checkout_url) : null,
    sessionId: accepted?.provider_ref ?? null,
    paymentIntentId: succeeded?.provider_ref ?? null,
    paidOn: succeeded && typeof succeeded.payload.paid_on === "string" ? succeeded.payload.paid_on : null,
    applicationRefusedReason:
      succeeded && typeof succeeded.payload.application_refused_reason === "string"
        ? succeeded.payload.application_refused_reason
        : null,
    isDead: expired || failedWithoutSession,
  };
}

async function refundsOfEndorsement(database: postgres.Sql, endorsedEventId: string): Promise<DeltaRefundView[]> {
  const allocations = await database<
    {
      operation_id: string;
      amount_cents: string;
      refunded_premium_cents: string;
      refunded_tax_cents: string;
      commission_clawback_cents: string;
      payment_intent_id: string;
      approval_request_id: string | null;
      approval_decision: "approved" | "rejected" | null;
    }[]
  >`
    select operation.id as operation_id, operation.amount_cents, allocation.refunded_premium_cents,
           allocation.refunded_tax_cents, allocation.commission_clawback_cents, allocation.payment_intent_id,
           operation.approval_request_id,
           decision.decision as approval_decision
      from refund_allocations allocation
      join money_operations operation on operation.id = allocation.refund_operation_id
      left join approval_decisions decision on decision.request_id = operation.approval_request_id
     where allocation.policy_event_id = ${endorsedEventId}
     order by operation.created_at
  `;
  const refunds: DeltaRefundView[] = [];
  for (const allocation of allocations) {
    const events = await database<{ status: string; provider_ref: string | null; payload: Record<string, unknown> }[]>`
      select status, provider_ref, payload from money_operation_events
       where operation_id = ${allocation.operation_id}
       order by sequence_number
    `;
    const state = refundStateFromEvents(events.map((event) => event.status));
    const succeeded = events.find((event) => event.status === "succeeded");
    const lastFailure = [...events].reverse().find((event) => event.status === "failed");
    refunds.push({
      operationId: allocation.operation_id,
      amountCents: centsFromDatabase(allocation.amount_cents, "amount_cents"),
      refundedPremiumCents: centsFromDatabase(allocation.refunded_premium_cents, "refunded_premium_cents"),
      refundedTaxCents: centsFromDatabase(allocation.refunded_tax_cents, "refunded_tax_cents"),
      commissionClawbackCents: centsFromDatabase(allocation.commission_clawback_cents, "commission_clawback_cents"),
      paymentIntentId: allocation.payment_intent_id,
      state,
      refundId: events.find((event) => event.provider_ref !== null)?.provider_ref ?? null,
      completedOn: succeeded && typeof succeeded.payload.refunded_on === "string" ? succeeded.payload.refunded_on : null,
      failureReason:
        state === "failed" && lastFailure
          ? String(lastFailure.payload.reason ?? lastFailure.payload.message ?? "Stripe refused the refund")
          : null,
      approvalRequestId: allocation.approval_request_id,
      approvalDecision: allocation.approval_decision,
    });
  }
  return refunds;
}

async function stripeReferencesOfEndorsement(
  database: postgres.Sql,
  endorsedEventId: string,
  collectionOperationId: string | null,
): Promise<string[]> {
  const references: string[] = [];
  if (collectionOperationId) {
    const [paid] = await database<{ provider_ref: string | null }[]>`
      select provider_ref from money_operation_events
       where operation_id = ${collectionOperationId} and status = 'succeeded'
       order by sequence_number desc limit 1
    `;
    if (paid?.provider_ref) {
      references.push(`payment ${paid.provider_ref}`);
    }
  }
  for (const refund of await refundsOfEndorsement(database, endorsedEventId)) {
    references.push(refund.refundId ? `refund ${refund.refundId} (${refund.state})` : `refund not created yet (${refund.state})`);
  }
  return references;
}

async function recordedAtOfEvent(database: postgres.Sql, eventId: string): Promise<Date | null> {
  const [row] = await database<{ recorded_at: Date }[]>`select recorded_at from policy_events where id = ${eventId}`;
  return row ? row.recorded_at : null;
}

// ---------------------------------------------------------------------------
// Count for the sidebar badge and the "what needs you" block
// ---------------------------------------------------------------------------

// How many endorsement requests are waiting for a customer's yes, either across the policies of
// one customer (their own badge) or across the policies of one broker (the broker cannot approve,
// but they are the one who has to chase it).
//
// It reuses liveEndorsementRequest policy by policy rather than asking the question in SQL, and
// that is deliberate: "awaiting_approval" is decided in lib/policy/endorsement-requests.ts from
// the events recorded after the request, including the cumulative $500 rule. A SQL copy of that
// rule would be a second definition, and a badge that disagrees with the screen it points at is
// worse than no badge.
//
// What the SQL below DOES decide is which policies are worth asking about, and that is not the
// rule: a policy that has never carried an endorsement request cannot have one waiting, whatever
// the rule says. Without that condition this ran one read per policy of the whole book, on every
// page a broker or a customer opens (review finding F-UI-18); with it, it runs one read per
// policy that has ever been endorsed, which is the small fraction of a book that it should be.
export async function countEndorsementsAwaitingCustomerApproval(
  owner: { customerId: string } | { brokerId: string },
  database: postgres.Sql = sql,
): Promise<number> {
  const policies = await database<{ id: string }[]>`
    select policy.id from policies policy
     where ${"customerId" in owner ? database`policy.customer_id = ${owner.customerId}` : database`policy.broker_id = ${owner.brokerId}`}
       and exists (
             select 1 from policy_events request
              where request.policy_id = policy.id
                and request.event_type = 'endorsement_requested'
           )
  `;
  let waiting = 0;
  for (const policy of policies) {
    const live = await liveEndorsementRequest(database, policy.id);
    if (live?.standing.state === "awaiting_approval") {
      waiting += 1;
    }
  }
  return waiting;
}
