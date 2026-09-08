import type postgres from "postgres";
import { sql } from "@/db/client";
import { SCHEDULED_JOB } from "@/lib/claims/claims";
import { sendClaimPayment } from "@/lib/claims/payments";
import { startCheckout, CheckoutRefused } from "./checkout";
import { assertRefundMaySend, issueRefundsAtStripe, loadRefundOperation, RefundSendRefused } from "./refunds";

// Finishing money operations that were started and never finished (review finding F-B5-03,
// ARCHITECTURE.md section 7).
//
// The outbox rule writes and commits the intent BEFORE the provider is called, so a process that
// dies in between leaves an operation whose only lifecycle event is 'requested'. Nothing will
// ever pick it up on its own: this build has no worker (DECISIONS.md, 2026-09-08 07:39), so the
// recovery is an authenticated HTTP endpoint called by a daily cron job and by a staff button.
//
// IT NEVER INVENTS A NEW INTENT. For each stuck operation it repeats the SAME call with the SAME
// idempotency key, after asking the provider what it already holds:
//
//   stripe_refund    lists the refunds of the PaymentIntent and adopts one carrying this
//                    operation id before creating anything (recoverPendingRefund);
//   stripe_checkout  calls startCheckout again, which reuses the operation's key, so Stripe
//                    returns the session it already created instead of opening a second one.
//   claim_payout     calls sendClaimPayment, the same function the claim screen's button calls,
//                    which re-reads the approval, the destination account and the three ceilings
//                    before the LOCAL SIMULATOR rail sees anything (review finding F-B7-05).
//
// Maker-checker is not bypassed: an operation still waiting for an approver is left alone, because
// assertRefundMaySend and sendClaimPayment refuse it here exactly as they refuse it on the screen.

// Five minutes: long enough that an operation created by a request still in flight is never
// touched, short enough that a crash is repaired within one cron run.
export const STUCK_AFTER_MINUTES = 5;

type Queryable = postgres.Sql | postgres.TransactionSql;

export type StuckOperationKind = "stripe_refund" | "stripe_checkout" | "claim_payout";

export type StuckOperation = {
  operationId: string;
  kind: StuckOperationKind;
  policyId: string;
  brokerId: string;
  createdBy: string | null;
};

// Operations whose only lifecycle event is 'requested': the provider was never reached, or its
// answer was never stored. Anything already accepted, succeeded or failed has an outcome and is
// not this job's business.
//
// `olderThanMinutes` is the age from which an operation counts as stuck. The job always uses the
// default; scripts/check-claims-and-approvals.ts passes 0 so it can prove which kinds the query
// returns without waiting five minutes for a fixture to age.
export async function stuckOperations(
  database: Queryable,
  olderThanMinutes: number = STUCK_AFTER_MINUTES,
): Promise<StuckOperation[]> {
  const rows = await database<
    {
      id: string;
      kind: StuckOperationKind;
      policy_id: string;
      broker_id: string;
      created_by: string | null;
    }[]
  >`
    select operation.id, operation.kind, operation.policy_id, policy.broker_id, operation.created_by
      from money_operations operation
      join policies policy on policy.id = operation.policy_id
     where operation.kind in ('stripe_refund', 'stripe_checkout', 'claim_payout')
       and operation.created_at < now() - ${`${olderThanMinutes} minutes`}::interval
       and not exists (
             select 1 from money_operation_events event
              where event.operation_id = operation.id and event.status <> 'requested'
           )
     order by operation.created_at
  `;
  return rows.map((row) => ({
    operationId: row.id,
    kind: row.kind,
    policyId: row.policy_id,
    brokerId: row.broker_id,
    createdBy: row.created_by,
  }));
}

export type RecoveryReport = {
  stuckCount: number;
  recovered: { operationId: string; kind: string; detail: string }[];
  leftAlone: { operationId: string; kind: string; reason: string }[];
};

export async function recoverStuckOperations(database: postgres.Sql = sql): Promise<RecoveryReport> {
  const stuck = await stuckOperations(database);
  const recovered: RecoveryReport["recovered"] = [];
  const leftAlone: RecoveryReport["leftAlone"] = [];

  for (const operation of stuck) {
    const decision = await recoverStuckOperation(database, operation);
    if (decision.kind === "recovered") {
      recovered.push({ ...operation, detail: decision.detail });
    } else {
      leftAlone.push({ ...operation, reason: decision.reason });
    }
  }

  return { stuckCount: stuck.length, recovered, leftAlone };
}

export type RecoveryDecision =
  | { kind: "recovered"; detail: string }
  | { kind: "left_alone"; reason: string };

// What the job does with ONE stuck operation. Written as its own function so that a check can
// exercise the decision for a chosen operation without asking the job to walk the whole database.
export async function recoverStuckOperation(
  database: postgres.Sql,
  operation: StuckOperation,
): Promise<RecoveryDecision> {
  if (operation.kind === "stripe_refund") {
    const refund = await loadRefundOperation(database, operation.operationId);
    if (!refund) {
      return { kind: "left_alone", reason: "no refund allocation for this operation" };
    }
    try {
      await assertRefundMaySend(database, refund);
    } catch (error) {
      return {
        kind: "left_alone",
        reason: error instanceof RefundSendRefused || error instanceof Error ? error.message : "refused",
      };
    }
    const [outcome] = await issueRefundsAtStripe([operation.operationId], database);
    return { kind: "recovered", detail: outcome.detail };
  }

  if (operation.kind === "claim_payout") {
    // The claim screen requests the payment and sends it in two transactions, so a crash between
    // them leaves it 'requested' while it still holds its place against the reserve and the two
    // policy limits. sendClaimPayment is the button's own function: it refuses a payment whose
    // approval has not been given, and it is safe to call twice (a payment already on the rail
    // answers 'already_sent').
    try {
      const sent = await sendClaimPayment({ operationId: operation.operationId, actor: SCHEDULED_JOB }, database);
      return { kind: "recovered", detail: `the claim payment was ${sent.outcome} on the simulated rail` };
    } catch (error) {
      return {
        kind: "left_alone",
        reason: error instanceof Error ? error.message : "the claim payment could not be sent",
      };
    }
  }

  // stripe_checkout: the policy's own payment flow knows how to resume itself, under the key
  // the operation already carries. The hosted page URL it returns is a capability URL and is
  // deliberately not logged.
  try {
    await startCheckout(
      { policyId: operation.policyId, brokerId: operation.brokerId, userId: operation.createdBy ?? "" },
      database,
    );
    return { kind: "recovered", detail: "the checkout session was recovered under the same key" };
  } catch (error) {
    return {
      kind: "left_alone",
      reason: error instanceof CheckoutRefused ? error.message : "the checkout could not be recovered",
    };
  }
}
