import type postgres from "postgres";
import { centsFromDatabase } from "@/lib/money/cents";
import type { ProviderRecord } from "./diff";
import { ledgerCashMovements } from "./ledger-side";
import type { ReconciliationSource } from "./source";
import type { ReconciliationWindow } from "./window";

// The claim payout rail as a reconciliation source.
//
// LOCAL SIMULATOR, and that is exactly why this is still a real diff. The rail keeps its own
// provider-side table, simulator_provider_records, written by one module and one module only
// (lib/rails/simulator.ts) from the rail's point of view; our journal is written by the claims
// code from ours. Nothing joins the two except the transfer reference the money operation
// recorded when the rail accepted the transfer. A payout can therefore be planted on the
// provider side, or a settlement can be missed on ours, without either side noticing, and this
// source is what finds it (design finding F-03, live-fire scenario 6 of the brief).
//
// There is no network here, so there is no fetch error to simulate away: the failure this source
// can raise is a database error, and the run stores it as a failed run exactly like a Stripe one.

// A transfer the rail accepted and has neither settled nor returned after this long is reported
// as stale. ASSUMPTION of this build: the simulator settles two calendar days out
// (SIMULATED_SETTLEMENT_DELAY_DAYS), so three days is one full day past the promise; a real ACH
// credit would be one to three BUSINESS days and this simulator models no banking calendar.
// Flagged for Yoann in the notes.
export const CLAIMS_RAIL_STALE_AFTER_HOURS = 72;

type SimulatorRow = {
  transfer_ref: string;
  amount_cents: string;
  status: "sent" | "settled" | "returned";
  recorded_at: Date;
};

// Every row the simulated rail holds for the transfers it touched during the window, oldest
// first. A transfer is IN the window when any of its rows was recorded inside it; all of its
// rows are then read, so the fold below sees the true latest status of the transfer and not
// just the part of its life that happens to fall inside the window.
export async function fetchClaimsRailWindow(
  window: ReconciliationWindow,
  database: postgres.Sql,
): Promise<{ records: ProviderRecord[]; note: string }> {
  const rows = await database<SimulatorRow[]>`
    select record.transfer_ref, record.amount_cents::text as amount_cents, record.status, record.recorded_at
      from simulator_provider_records record
     where record.transfer_ref in (
             select inside.transfer_ref from simulator_provider_records inside
              where inside.recorded_at between ${window.from} and ${window.to}
           )
     order by record.transfer_ref, record.sequence_number
  `;
  const records = foldTransfers(rows);
  return {
    records,
    note:
      `LOCAL SIMULATOR: ${rows.length} rail records for ${records.length} transfers. ` +
      "The rail is a simulator, not a bank: it keeps its own append-only records and settles two calendar days after a transfer is sent, with no banking calendar.",
  };
}

// One ProviderRecord per transfer, built from all of its rows.
//
// The three rail statuses fold onto the three outcomes the diff reasons about:
//   sent      accepted, not settled yet                       -> pending
//   settled   the money left                                  -> succeeded
//   returned  the money left and the receiving bank sent it
//             back, so the net movement is zero               -> failed
// 'returned' is deliberately not "succeeded": a returned transfer moved no money in the end, and
// our ledger nets to zero for it too, so both sides agree at zero. The rail's own word is kept
// on the record so the note says "returned" rather than "failed".
export function foldTransfers(rows: SimulatorRow[]): ProviderRecord[] {
  const rowsByTransfer = new Map<string, SimulatorRow[]>();
  for (const row of rows) {
    const existing = rowsByTransfer.get(row.transfer_ref) ?? [];
    existing.push(row);
    rowsByTransfer.set(row.transfer_ref, existing);
  }

  const records: ProviderRecord[] = [];
  for (const [transferRef, transferRows] of rowsByTransfer) {
    const latest = transferRows[transferRows.length - 1];
    const sent = transferRows.find((row) => row.status === "sent") ?? transferRows[0];
    records.push({
      providerRef: transferRef,
      direction: "out",
      status: latest.status === "settled" ? "succeeded" : latest.status === "returned" ? "failed" : "pending",
      statusWord: latest.status,
      amountCents: centsFromDatabase(latest.amount_cents, "amount_cents"),
      // When the rail accepted the transfer, which is what an operator means by "how long has
      // this been out there".
      createdAt: sent.recorded_at.toISOString(),
      // The rail carries no operation id of ours, by design: it is a provider, and the only link
      // is the transfer reference our money operation recorded. That is also what makes a
      // planted transfer provider-only rather than silently attached to something.
      operationId: null,
      policyId: null,
      feeCents: null, // the simulated rail charges nothing
      label: "claim payout",
    });
  }
  return records;
}

// The rail lives in our own database, so its "network call" is a query and it needs the handle
// the run is using. Stripe's source is a plain constant because a network provider needs nothing
// from us; this one is built with the handle bound in, which keeps the ReconciliationSource
// interface identical for both providers.
export function claimsRailSourceOn(database: postgres.Sql): ReconciliationSource {
  return {
    name: "claims_rail",
    staleAfterHours: CLAIMS_RAIL_STALE_AFTER_HOURS,
    fetch: (window) => fetchClaimsRailWindow(window, database),
    readLedger: (readWindow, readDatabase) =>
      ledgerCashMovements({ cashAccount: "cash_claims_rail", operationProvider: "simulator", window: readWindow }, readDatabase),
  };
}
