import { sql } from "@/db/client";
import { settleClaimPayment } from "@/lib/claims/payments";
import { assertJobIsAuthorised, jobResponse, JobNotAuthorised } from "@/lib/jobs/authorize";
import { todayUtc } from "@/lib/claims/claims";
import { simulatedTransfersDueForSettlement } from "@/lib/rails/simulator";

// POST /api/jobs/settle-simulated-payouts
// Authorization: Bearer <CRON_SECRET>
//
// LOCAL SIMULATOR. This is the job that plays the part of the bank telling us that a claim
// payment has settled. It settles every simulated transfer whose settlement date has passed and
// which has not already settled or been returned, and for each one it appends the claim event,
// the operation event and the journal entry in one transaction.
//
// It is safe to run again, at any time, as many times as anyone likes:
//   - the simulator refuses a second 'settled' row for the same transfer (unique on
//     (transfer_ref, status));
//   - the claim refuses a second 'payment_settled' event for the same payment (unique on
//     (money_operation_id, event_type));
//   - the journal refuses a second entry for the same claim event.
// A rerun therefore reports nothing to do rather than paying anything twice.
export async function POST(request: Request) {
  try {
    assertJobIsAuthorised(request);
  } catch (error) {
    if (error instanceof JobNotAuthorised) {
      return jobResponse({ error: error.message }, 401);
    }
    throw error;
  }

  const today = todayUtc();
  const due = await simulatedTransfersDueForSettlement(sql, today);

  const settled: string[] = [];
  const skipped: { transferRef: string; reason: string }[] = [];
  for (const transfer of due) {
    // The link back from the rail's world to ours: the transfer reference we stored on the
    // money operation when the rail accepted it. If we cannot find it, the job says so rather
    // than guessing, and the transfer stays visible for the reconciliation of slice B10.
    const [operation] = await sql<{ operation_id: string }[]>`
      select operation_id from money_operation_events
       where provider_ref = ${transfer.transferRef}
       order by sequence_number
       limit 1
    `;
    if (!operation) {
      skipped.push({ transferRef: transfer.transferRef, reason: "no money operation carries this transfer reference" });
      continue;
    }

    const result = await settleClaimPayment(
      { operationId: operation.operation_id, settledOn: transfer.settlementDate, broughtForwardBy: null },
      sql,
    );
    if (result.outcome === "settled") {
      settled.push(transfer.transferRef);
    } else {
      skipped.push({ transferRef: transfer.transferRef, reason: "already settled" });
    }
  }

  return jobResponse({
    job: "settle-simulated-payouts",
    provider: "LOCAL SIMULATOR",
    ranOn: today,
    dueCount: due.length,
    settledCount: settled.length,
    settled,
    skipped,
  });
}
