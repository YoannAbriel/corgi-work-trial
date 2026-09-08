import { randomBytes } from "node:crypto";
import type postgres from "postgres";
import { addDays } from "@/lib/money/dates";

// ===========================================================================================
// LOCAL SIMULATOR: the claim payout rail
// ===========================================================================================
//
// THIS IS NOT A LIVE INTEGRATION. Nothing leaves this process; "the bank" is the table
// simulator_provider_records in our own database. It stands in for a real delayed-settlement
// rail (Increase's sandbox was the stretch, DECISIONS.md 2026-09-08 07:39) and it is labelled
// LOCAL SIMULATOR in the README integration inventory, on every screen that shows it, and here.
// AF-02 forbids presenting it as anything else.
//
// THIS MODULE IS THE ONLY WRITER OF simulator_provider_records. That is the point of the design
// (ARCHITECTURE.md section 4, design finding F-03): the table holds what the bank believes,
// our journal holds what we believe, and the two are written by different code from different
// facts. The reconciliation job of slice B10 can therefore diff them for real, and a mismatch
// can be planted on the provider side without touching a single journal entry.
//
// What the rail does, and it is deliberately the smallest thing that is still a real rail:
//
//   send    a transfer appears with status 'sent' and a settlement date two days out;
//   settle  on or after that date, a SECOND row says 'settled';
//   return  the bank can send the money back, a THIRD row says 'returned'.
//
// Rows are appended, never updated, so the history of a transfer at the bank is as immutable as
// our own ledger, and unique (transfer_ref, status) makes a replayed settlement job a no-op.

// How long the simulated rail takes. Two calendar days, chosen so that a settlement is visibly
// in the future at a demo and so the settle job has something to do. A real ACH credit would be
// one to three business days and would skip weekends and bank holidays; this simulator does not
// model a banking calendar, which is stated in the README rather than half-implemented.
export const SIMULATED_SETTLEMENT_DELAY_DAYS = 2;

export type SimulatedTransfer = {
  transferRef: string;
  amountCents: number;
  destinationToken: string;
  status: "sent" | "settled" | "returned";
  settlementDate: string; // "YYYY-MM-DD"
};

// A reference in the shape a provider would give: opaque, unique, and nothing of ours encoded
// in it. It is stored on our money operation as its provider_ref, exactly as a Stripe refund id
// is, and it is the only thing linking our world to the simulator's.
export function newTransferRef(): string {
  return `sim_tr_${randomBytes(16).toString("hex")}`;
}

// "The bank has accepted the transfer." Called inside the caller's transaction: the simulator
// lives in the same database, so there is no network gap to cross here and no outbox to run.
// The intent (the money operation) was nevertheless committed before this call, exactly as the
// Stripe path does, so the code reads the same whichever rail it is talking to.
export async function sendSimulatedPayout(
  transaction: postgres.TransactionSql,
  input: { transferRef: string; amountCents: number; destinationToken: string; sentOn: string },
): Promise<SimulatedTransfer> {
  const settlementDate = addDays(input.sentOn, SIMULATED_SETTLEMENT_DELAY_DAYS);
  await transaction`
    insert into simulator_provider_records (transfer_ref, amount_cents, destination_token, status, settlement_date, payload)
    values (${input.transferRef}, ${input.amountCents}, ${input.destinationToken}, 'sent', ${settlementDate},
            ${transaction.json({ note: "LOCAL SIMULATOR: transfer accepted by the simulated rail", sent_on: input.sentOn })})
  `;
  return {
    transferRef: input.transferRef,
    amountCents: input.amountCents,
    destinationToken: input.destinationToken,
    status: "sent",
    settlementDate,
  };
}

// "The money has left." A second row for the same transfer.
export async function settleSimulatedPayout(
  transaction: postgres.TransactionSql,
  input: { transferRef: string; amountCents: number; destinationToken: string; settledOn: string; note: string },
): Promise<void> {
  await transaction`
    insert into simulator_provider_records (transfer_ref, amount_cents, destination_token, status, settlement_date, payload)
    values (${input.transferRef}, ${input.amountCents}, ${input.destinationToken}, 'settled', ${input.settledOn},
            ${transaction.json({ note: input.note })})
  `;
}

// "The receiving bank sent it back." A third row, with the reason the bank gave.
export async function returnSimulatedPayout(
  transaction: postgres.TransactionSql,
  input: {
    transferRef: string;
    amountCents: number;
    destinationToken: string;
    returnedOn: string;
    returnReason: string;
  },
): Promise<void> {
  await transaction`
    insert into simulator_provider_records (transfer_ref, amount_cents, destination_token, status, settlement_date, payload)
    values (${input.transferRef}, ${input.amountCents}, ${input.destinationToken}, 'returned', ${input.returnedOn},
            ${transaction.json({ note: "LOCAL SIMULATOR: returned by the receiving bank", return_reason: input.returnReason })})
  `;
}

// ---------------------------------------------------------------------------
// Reading what the bank believes
// ---------------------------------------------------------------------------

export type SimulatedTransferState = {
  transferRef: string;
  amountCents: number;
  destinationToken: string;
  settlementDate: string; // the date carried by the LATEST row
  latestStatus: "sent" | "settled" | "returned";
  isSettled: boolean;
  isReturned: boolean;
};

type Queryable = postgres.Sql | postgres.TransactionSql;

// Every row the simulator holds for one transfer, folded into where it stands. Nothing here is
// derived from our own tables: this is the bank's answer, and reconciliation compares it with
// ours rather than assuming they agree.
export async function simulatedTransferState(
  database: Queryable,
  transferRef: string,
): Promise<SimulatedTransferState | null> {
  const rows = await database<
    { amount_cents: string; destination_token: string; status: string; settlement_date: string }[]
  >`
    select amount_cents, destination_token, status, to_char(settlement_date, 'YYYY-MM-DD') as settlement_date
      from simulator_provider_records
     where transfer_ref = ${transferRef}
     order by sequence_number
  `;
  if (rows.length === 0) {
    return null;
  }
  const latest = rows[rows.length - 1];
  return {
    transferRef,
    amountCents: Number(latest.amount_cents),
    destinationToken: latest.destination_token,
    settlementDate: latest.settlement_date,
    latestStatus: latest.status as "sent" | "settled" | "returned",
    isSettled: rows.some((row) => row.status === "settled"),
    isReturned: rows.some((row) => row.status === "returned"),
  };
}

// The transfers the simulated bank would settle today: sent, not settled yet, not returned, and
// past their settlement date. The settle job (app/api/jobs/settle-simulated-payouts) asks this
// question and then books each answer in our ledger.
export async function simulatedTransfersDueForSettlement(
  database: Queryable,
  today: string,
): Promise<{ transferRef: string; amountCents: number; destinationToken: string; settlementDate: string }[]> {
  const rows = await database<
    { transfer_ref: string; amount_cents: string; destination_token: string; settlement_date: string }[]
  >`
    select sent.transfer_ref,
           sent.amount_cents,
           sent.destination_token,
           to_char(sent.settlement_date, 'YYYY-MM-DD') as settlement_date
      from simulator_provider_records sent
     where sent.status = 'sent'
       and sent.settlement_date <= ${today}::date
       and not exists (
             select 1 from simulator_provider_records later
              where later.transfer_ref = sent.transfer_ref
                and later.status in ('settled', 'returned')
           )
     order by sent.settlement_date, sent.sequence_number
  `;
  return rows.map((row) => ({
    transferRef: row.transfer_ref,
    amountCents: Number(row.amount_cents),
    destinationToken: row.destination_token,
    settlementDate: row.settlement_date,
  }));
}
