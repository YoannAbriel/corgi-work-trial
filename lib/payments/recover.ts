import type postgres from "postgres";
import { sql } from "@/db/client";
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
//
// Maker-checker is not bypassed: a refund still waiting for an approver is left alone, because
// assertRefundMaySend refuses it here exactly as it refuses it on the screen.

// Five minutes: long enough that an operation created by a request still in flight is never
// touched, short enough that a crash is repaired within one cron run.
export const STUCK_AFTER_MINUTES = 5;

type Queryable = postgres.Sql | postgres.TransactionSql;

export type StuckOperation = {
  operationId: string;
  kind: "stripe_refund" | "stripe_checkout";
  policyId: string;
  brokerId: string;
  createdBy: string | null;
};

// Operations whose only lifecycle event is 'requested': the provider was never reached, or its
// answer was never stored. Anything already accepted, succeeded or failed has an outcome and is
// not this job's business.
export async function stuckOperations(database: Queryable): Promise<StuckOperation[]> {
  const rows = await database<
    {
      id: string;
      kind: "stripe_refund" | "stripe_checkout";
      policy_id: string;
      broker_id: string;
      created_by: string | null;
    }[]
  >`
    select operation.id, operation.kind, operation.policy_id, policy.broker_id, operation.created_by
      from money_operations operation
      join policies policy on policy.id = operation.policy_id
     where operation.kind in ('stripe_refund', 'stripe_checkout')
       and operation.created_at < now() - ${`${STUCK_AFTER_MINUTES} minutes`}::interval
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
    if (operation.kind === "stripe_refund") {
      const refund = await loadRefundOperation(database, operation.operationId);
      if (!refund) {
        leftAlone.push({ ...operation, reason: "no refund allocation for this operation" });
        continue;
      }
      try {
        await assertRefundMaySend(database, refund);
      } catch (error) {
        leftAlone.push({
          ...operation,
          reason: error instanceof RefundSendRefused || error instanceof Error ? error.message : "refused",
        });
        continue;
      }
      const [outcome] = await issueRefundsAtStripe([operation.operationId], database);
      recovered.push({ ...operation, detail: outcome.detail });
      continue;
    }

    // stripe_checkout: the policy's own payment flow knows how to resume itself, under the key
    // the operation already carries. The hosted page URL it returns is a capability URL and is
    // deliberately not logged.
    try {
      await startCheckout(
        { policyId: operation.policyId, brokerId: operation.brokerId, userId: operation.createdBy ?? "" },
        database,
      );
      recovered.push({ ...operation, detail: "the checkout session was recovered under the same key" });
    } catch (error) {
      leftAlone.push({
        ...operation,
        reason: error instanceof CheckoutRefused ? error.message : "the checkout could not be recovered",
      });
    }
  }

  return { stuckCount: stuck.length, recovered, leftAlone };
}
