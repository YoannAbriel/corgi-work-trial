import type postgres from "postgres";
import { sql } from "@/db/client";
import { simulatedTransfersDueForSettlement } from "@/lib/rails/simulator";
import { todayUtc } from "./claims";
import { settleClaimPayment } from "./payments";

// LOCAL SIMULATOR. The work behind POST /api/jobs/settle-simulated-payouts, in a function of its
// own so the daily job (app/api/jobs/daily) runs exactly the same code as the standalone
// endpoint, the way lib/payments/recover.ts already serves both its callers.
//
// It plays the part of the bank telling us a claim payment has settled: every simulated transfer
// whose settlement date has passed and which has neither settled nor been returned gets its
// claim event, its operation event and its journal entry, in one transaction each.
//
// It is safe to run again, at any time, as many times as anyone likes:
//   - the simulator refuses a second 'settled' row for the same transfer (unique on
//     (transfer_ref, status));
//   - the claim refuses a second 'payment_settled' event for the same payment (unique on
//     (money_operation_id, event_type));
//   - the journal refuses a second entry for the same claim event.
// A rerun therefore reports nothing to do rather than paying anything twice.

export type SettleDuePayoutsReport = {
  ranOn: string; // "YYYY-MM-DD", UTC
  dueCount: number;
  settledCount: number;
  settled: string[]; // transfer references
  skipped: { transferRef: string; reason: string }[];
};

export async function settleDueSimulatedPayouts(database: postgres.Sql = sql): Promise<SettleDuePayoutsReport> {
  const today = todayUtc();
  const due = await simulatedTransfersDueForSettlement(database, today);

  const settled: string[] = [];
  const skipped: { transferRef: string; reason: string }[] = [];
  for (const transfer of due) {
    // The link back from the rail's world to ours: the transfer reference we stored on the money
    // operation when the rail accepted it. If we cannot find it, the job says so rather than
    // guessing, and the transfer stays visible to the reconciliation job as a provider-only
    // record, which is exactly what it is.
    const [operation] = await database<{ operation_id: string }[]>`
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
      database,
    );
    if (result.outcome === "settled") {
      settled.push(transfer.transferRef);
    } else {
      skipped.push({ transferRef: transfer.transferRef, reason: "already settled" });
    }
  }

  return { ranOn: today, dueCount: due.length, settledCount: settled.length, settled, skipped };
}
