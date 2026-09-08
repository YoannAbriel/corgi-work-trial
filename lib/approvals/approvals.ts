import type postgres from "postgres";
import { sql } from "@/db/client";
import { centsFromDatabase } from "@/lib/money/cents";
import { canonicalIntentText, intentHash, type MoneyOutIntent } from "./intent";

// The approval queue: creating a request before money can move, recording one human's decision,
// and refusing an execution that does not match what was approved.
//
// General non-negotiable 6: "Money-out above a threshold requires maker-checker. Initiator
// cannot approve their own action; neither can an agent."
//
// WHERE EACH HALF OF THAT RULE LIVES, because it is deliberately in two places:
//
//   the database  migration 0008 puts a trigger on approval_decisions that refuses a decision
//                 by the requester, by a user who does not exist, or by anyone whose role is
//                 not exactly 'staff_approver'. That is the guarantee: it holds for the routes
//                 below, for a psql session, for a future MCP tool and for any code written
//                 after this slice.
//   this module   refuses the same things earlier, so an operator gets a sentence instead of a
//                 database error, and refuses at EXECUTION time as well: an approval only
//                 authorises the exact intent it was given.
//
// Nothing here calls a provider. It is all our own database, which is what makes "the request
// exists before any money moves" a fact rather than an intention.

// A refusal a person can act on. It becomes a message on the page, never a 500.
export class ApprovalRefused extends Error {}

type Queryable = postgres.Sql | postgres.TransactionSql;

// ---------------------------------------------------------------------------
// Creating a request
// ---------------------------------------------------------------------------

export type ApprovalRequestDraft = {
  intent: MoneyOutIntent;
  destinationDescription: string; // what the approver reads: "simulated bank account ...6789"
  requestedByUserId: string;
  // Anything else worth showing on the approval screen. Kept to plain JSON scalars so what is
  // stored is exactly what is displayed.
  payload?: Record<string, string | number | boolean | null>;
};

// Inserts the request inside the CALLER'S transaction, on purpose: the request and the money
// operation it gates are written together or not at all, so there is no instant in which an
// operation exists that nothing is waiting on.
export async function createApprovalRequest(
  transaction: postgres.TransactionSql,
  draft: ApprovalRequestDraft,
): Promise<string> {
  const [request] = await transaction<{ id: string }[]>`
    insert into approval_requests (kind, subject_kind, subject_id, amount_cents, intent_hash, destination, requested_by, payload)
    values (${draft.intent.kind}, ${draft.intent.subjectKind}, ${draft.intent.subjectId},
            ${draft.intent.amountCents}, ${intentHash(draft.intent)}, ${draft.destinationDescription},
            ${draft.requestedByUserId},
            ${transaction.json({
              // The exact bytes that were hashed, kept so the approvals screen can show an
              // approver what they are approving instead of only a hash they cannot check.
              intent_text: canonicalIntentText(draft.intent),
              ...(draft.payload ?? {}),
            })})
    returning id
  `;
  return request.id;
}

// ---------------------------------------------------------------------------
// Reading a request and its decision
// ---------------------------------------------------------------------------

export type ApprovalRequestView = {
  requestId: string;
  kind: "claim_payment" | "refund";
  subjectKind: "claim" | "policy";
  subjectId: string;
  amountCents: number;
  intentHash: string;
  destination: string;
  requestedByUserId: string;
  requestedByName: string;
  requestedAt: Date;
  decision: "approved" | "rejected" | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  decisionReason: string | null;
  // The exact text whose sha256 is intentHash, so an approver can read what they approve.
  canonicalIntent: string;
  // How the request reached the queue. Null for the ordinary case, a person on a screen; set by
  // the MCP endpoint of slice B11, which fills it with the API key's public prefix and whether
  // the key is held by an agent. An approver has to be able to see that a machine asked for
  // this money before they decide (general non-negotiable 6).
  raisedThrough: string | null;
  raisedByAgent: boolean;
};

type ApprovalRequestRow = {
  id: string;
  kind: "claim_payment" | "refund";
  subject_kind: "claim" | "policy";
  subject_id: string;
  amount_cents: string;
  intent_hash: string;
  destination: string;
  requested_by: string;
  requested_by_name: string;
  requested_at: Date;
  payload: { intent_text?: string; raised_through?: string | null; raised_by_agent?: boolean };
  decision: "approved" | "rejected" | null;
  decided_by_name: string | null;
  decided_at: Date | null;
  decision_reason: string | null;
};

function toView(row: ApprovalRequestRow): ApprovalRequestView {
  return {
    requestId: row.id,
    kind: row.kind,
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    amountCents: centsFromDatabase(row.amount_cents, "amount_cents"),
    intentHash: row.intent_hash,
    destination: row.destination,
    requestedByUserId: row.requested_by,
    requestedByName: row.requested_by_name,
    requestedAt: row.requested_at,
    decision: row.decision,
    decidedByName: row.decided_by_name,
    decidedAt: row.decided_at,
    decisionReason: row.decision_reason,
    canonicalIntent: row.payload?.intent_text ?? "",
    raisedThrough: row.payload?.raised_through ?? null,
    raisedByAgent: row.payload?.raised_by_agent === true,
  };
}

// One query for both reads below: the request, who asked, and the single decision it may have.
// `onlyRequestId` is null when the screen wants every request.
async function readApprovalRequests(
  database: Queryable,
  onlyRequestId: string | null,
): Promise<ApprovalRequestView[]> {
  const rows = await database<ApprovalRequestRow[]>`
    select request.id,
           request.kind,
           request.subject_kind,
           request.subject_id,
           request.amount_cents,
           request.intent_hash,
           request.destination,
           request.requested_by,
           requester.display_name as requested_by_name,
           request.recorded_at    as requested_at,
           request.payload,
           decision.decision,
           decider.display_name   as decided_by_name,
           decision.recorded_at   as decided_at,
           decision.reason        as decision_reason
      from approval_requests request
      join users requester                  on requester.id = request.requested_by
      left join approval_decisions decision  on decision.request_id = request.id
      left join users decider                on decider.id = decision.decided_by
     where ${onlyRequestId === null ? database`true` : database`request.id = ${onlyRequestId}`}
     -- Undecided first: those are the ones somebody has to look at.
     order by (decision.decision is not null), request.recorded_at desc
  `;
  return rows.map(toView);
}

export async function approvalRequest(
  database: Queryable,
  requestId: string,
): Promise<ApprovalRequestView | null> {
  const [view] = await readApprovalRequests(database, requestId);
  return view ?? null;
}

// Everything the approvals screen shows.
export async function approvalRequests(database: Queryable = sql): Promise<ApprovalRequestView[]> {
  return readApprovalRequests(database, null);
}

// ---------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------

export type ApprovalDecisionRequest = {
  requestId: string;
  decidedByUserId: string;
  decidedByRole: string; // the role of the SIGNED-IN user, read from the session, never from a form
  decision: "approved" | "rejected";
  reason: string | null;
};

// Records one human's answer. The database trigger of migration 0008 is what actually enforces
// the rule; the checks here exist so that the three refusals read as sentences on the screen
// instead of as a Postgres exception, and so that the reason is named before the write.
export async function decideApprovalRequest(
  request: ApprovalDecisionRequest,
  database: postgres.Sql = sql,
): Promise<void> {
  if (request.decidedByRole !== "staff_approver") {
    throw new ApprovalRefused(
      `only a staff approver can decide a money-out request; your role is "${request.decidedByRole}"`,
    );
  }

  const existing = await approvalRequest(database, request.requestId);
  if (!existing) {
    throw new ApprovalRefused("this approval request does not exist");
  }
  if (existing.requestedByUserId === request.decidedByUserId) {
    throw new ApprovalRefused(
      "you asked for this money-out yourself, so you cannot approve it: maker-checker needs a second person",
    );
  }
  if (existing.decision !== null) {
    throw new ApprovalRefused(`this request was already ${existing.decision}; a new intent needs a new request`);
  }

  try {
    await database.begin(async (transaction) => {
      await transaction`
        insert into approval_decisions (request_id, decided_by, decision, reason)
        values (${request.requestId}, ${request.decidedByUserId}, ${request.decision}, ${request.reason})
      `;

      // A rejection has to close the money operation it was gating, in the same transaction:
      // otherwise the payment would sit in the queue for ever, still counted against the claim's
      // reserve and limits (lib/claims/limits.ts counts a request until it is sent or refused).
      // No journal entry: a payment that never left moved no money.
      if (request.decision === "rejected") {
        const gated = await transaction<{ id: string }[]>`
          select id from money_operations where approval_request_id = ${request.requestId}
        `;
        for (const operation of gated) {
          await transaction`
            insert into money_operation_events (operation_id, status, payload)
            values (${operation.id}, 'failed',
                    ${transaction.json({
                      stage: "approval",
                      reason: request.reason ?? "rejected by the approver",
                    })})
          `;
        }
      }
    });
  } catch (error) {
    // The unique index on request_id, or the maker-checker trigger, said no. Both are refusals
    // an operator can understand, so neither becomes a 500.
    const message = error instanceof Error ? error.message : String(error);
    if (/maker-checker/.test(message)) {
      throw new ApprovalRefused(message.replace(/^.*maker-checker: /, "maker-checker: "));
    }
    if (/approval_decisions_request_id_key/.test(message)) {
      throw new ApprovalRefused("this request was decided by someone else a moment ago");
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// The execution guard
// ---------------------------------------------------------------------------

// Called immediately before the money moves, with the intent REBUILT FROM THE CURRENT STATE OF
// THE WORLD by the caller. Three refusals, and they are the whole point of maker-checker:
//
//   nobody has decided yet          the money waits;
//   somebody rejected it            the money never goes;
//   the intent no longer matches    the amount, the claim or the destination account changed
//                                   after the approval, so the approval does not cover this
//                                   payment and a new request has to be made.
export async function assertIntentIsApproved(
  database: Queryable,
  requestId: string,
  intent: MoneyOutIntent,
): Promise<void> {
  const request = await approvalRequest(database, requestId);
  if (!request) {
    throw new ApprovalRefused("this money-out names an approval request that does not exist");
  }
  if (request.decision === null) {
    throw new ApprovalRefused(
      "this money-out is above the approval threshold and is still waiting for a second person to approve it",
    );
  }
  if (request.decision === "rejected") {
    throw new ApprovalRefused(
      `this money-out was rejected${request.decisionReason ? `: ${request.decisionReason}` : ""}`,
    );
  }
  const currentHash = intentHash(intent);
  if (currentHash !== request.intentHash) {
    throw new ApprovalRefused(
      "what would be paid is no longer what was approved (the amount, the claim or the destination account has changed since), " +
        "so this approval does not authorise it; ask for a new approval",
    );
  }
}
