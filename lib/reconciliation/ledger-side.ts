import type postgres from "postgres";
import { centsFromDatabase } from "@/lib/money/cents";
import { refundStateFromEvents } from "@/lib/payments/refund-state";
import type { CashDirection, LedgerRecord } from "./diff";
import type { ReconciliationWindow } from "./window";

// The ledger's side of the comparison: for every money operation of one provider, the signed net
// movement of one cash account filed under it. Read-only, with the runtime role, plain SQL,
// nothing written.
//
// "Filed under an operation" means three sets of journal entries put together:
//   1. the entries whose source IS that money operation (source_kind 'money_operation');
//   2. the entries of a CLAIM EVENT that names that money operation, because a claim payment's
//      entries are filed under the event and not under the operation (lib/ledger/claim-entries.ts);
//   3. the reversal entries that point at any of those through reverses_entry_id. A correction
//      files its reversal under the correction event, not under the operation, so without this
//      third part a voided payment would still look collected. With it, original plus reversal
//      nets to zero (lib/ledger/reverse.ts).
//
// TWO amounts are read per operation, and they answer two different questions:
//
//   cash        the net movement of the CASH account (cash_stripe or cash_claims_rail): "how
//               much money actually moved at the provider, according to our books". This is the
//               figure the diff compares with the provider's own.
//   clearing    the net movement of this operation's CLEARING account (premium_receivable for a
//               checkout, refund_payable for a refund, claims_payable for a claim payout):
//               "what is still open on our side". It returns to zero when a flow completes, so
//               a non-zero value on an old operation is an obligation nobody has closed.
//
// The entry type does not matter here, only the account: premium_collected, a refund_completed
// and a parked unapplied_cash_received all move cash_stripe and all count. That is what makes a
// parked payment matched cash, and what keeps this query valid for entry types other slices add.
//
// Which operations are in the window: those with a lifecycle event or a journal entry (or a
// reversal of one) RECORDED inside it. recorded_at is the database clock (migrations 0001 and
// 0002), so the window means "what the books received during that time", which is the right side
// to compare with "what the provider created during that time".

export type LedgerCashQuery = {
  cashAccount: "cash_stripe" | "cash_claims_rail"; // the account the provider's money lives in
  operationProvider: "stripe" | "simulator"; // money_operations.provider
  window: ReconciliationWindow;
};

export async function ledgerCashMovements(query: LedgerCashQuery, database: postgres.Sql): Promise<LedgerRecord[]> {
  const rows = await database<LedgerRow[]>`
    with operation_entries as (
      -- Entries filed directly under a money operation: everything on the Stripe path
      -- (lib/ledger/policy-entries.ts, lib/ledger/cancellation-entries.ts).
      select entry.id as entry_id, entry.source_id as operation_id, entry.recorded_at
        from journal_entries entry
       where entry.source_kind = 'money_operation'
      union all
      -- A claim payment's entries are filed under the CLAIM EVENT that caused them
      -- (lib/ledger/claim-entries.ts), because that is what makes a replayed settlement job post
      -- once. The claim event names the money operation it is about, so this join is how the
      -- rail's cash finds its way back to an operation. Reserve events name no operation and are
      -- therefore excluded, which is right: a reserve is an estimate, not money at a provider.
      select entry.id as entry_id, claim_event.money_operation_id::text as operation_id, entry.recorded_at
        from journal_entries entry
        join claim_events claim_event on claim_event.id::text = entry.source_id
       where entry.source_kind = 'claim_event'
         and claim_event.money_operation_id is not null
    ),
    attributed_entries as (
      -- the operation's own entries ...
      select operation_id, entry_id, recorded_at from operation_entries
      union all
      -- ... and the reversals that undo them
      select original.operation_id, reversal.id as entry_id, reversal.recorded_at
        from journal_entries reversal
        join operation_entries original on original.entry_id = reversal.reverses_entry_id
    )
    select operation.id,
           operation.kind,
           operation.policy_id,
           operation.amount_cents::text as amount_cents,
           operation.created_at,
           -- The provider's id for the money itself: a PaymentIntent (pi_), a Refund (re_) or a
           -- rail transfer (sim_tr_). A Checkout Session (cs_) is the hosted page, not the
           -- money, so it is skipped.
           (select event.provider_ref
              from money_operation_events event
             where event.operation_id = operation.id
               and event.provider_ref is not null
               and event.provider_ref not like 'cs_%'
             order by event.sequence_number desc
             limit 1) as provider_ref,
           coalesce((select sum(line.debit_cents - line.credit_cents)
                       from attributed_entries attributed
                       join journal_lines line on line.entry_id = attributed.entry_id
                      where attributed.operation_id = operation.id::text
                        and line.account_id = ${query.cashAccount}), 0)::text as cash_cents,
           -- The clearing account of this operation's kind, named here rather than passed in,
           -- because it is a property of the kind and not of the provider being reconciled.
           coalesce((select sum(line.debit_cents - line.credit_cents)
                       from attributed_entries attributed
                       join journal_lines line on line.entry_id = attributed.entry_id
                      where attributed.operation_id = operation.id::text
                        and line.account_id = case operation.kind
                                                when 'stripe_checkout' then 'premium_receivable'
                                                when 'stripe_refund'   then 'refund_payable'
                                                when 'claim_payout'    then 'claims_payable'
                                              end), 0)::text as open_clearing_cents,
           exists (select 1
                     from journal_entries reversal
                     join operation_entries original on original.entry_id = reversal.reverses_entry_id
                    where original.operation_id = operation.id::text) as reversed,
           coalesce((select array_agg(event.status order by event.sequence_number)
                       from money_operation_events event
                      where event.operation_id = operation.id), '{}') as statuses
      from money_operations operation
     where operation.provider = ${query.operationProvider}
       and (exists (select 1 from money_operation_events event
                     where event.operation_id = operation.id
                       and event.recorded_at between ${query.window.from} and ${query.window.to})
            or exists (select 1 from attributed_entries attributed
                        where attributed.operation_id = operation.id::text
                          and attributed.recorded_at between ${query.window.from} and ${query.window.to}))
     order by operation.created_at, operation.id
  `;

  return rows
    .map(toLedgerRecord)
    // A payment page that was opened and never paid moved nothing anywhere and has no provider
    // id for the money: there is nothing to compare, so it is left out rather than reported as
    // a matched item every day.
    .filter((record) => !(record.direction === "in" && record.cashCents === 0 && record.providerRef === null));
}

type LedgerRow = {
  id: string;
  kind: string;
  policy_id: string | null;
  amount_cents: string;
  created_at: Date;
  provider_ref: string | null;
  cash_cents: string;
  open_clearing_cents: string;
  reversed: boolean;
  statuses: string[];
};

// Which way the money goes for each operation kind. A kind this function does not know is an
// error, never a guess: a new kind must say which side of the cash account it moves.
const DIRECTION_BY_KIND: Record<string, { direction: CashDirection; label: string }> = {
  stripe_checkout: { direction: "in", label: "checkout" },
  stripe_refund: { direction: "out", label: "refund" },
  claim_payout: { direction: "out", label: "claim payout" },
};

function toLedgerRecord(row: LedgerRow): LedgerRecord {
  const kind = DIRECTION_BY_KIND[row.kind];
  if (!kind) {
    throw new Error(`money operation kind "${row.kind}" has no cash direction; add it to DIRECTION_BY_KIND before reconciling it`);
  }
  return {
    operationId: row.id,
    direction: kind.direction,
    policyId: row.policy_id,
    providerRef: row.provider_ref,
    expectedCents: centsFromDatabase(row.amount_cents, "amount_cents"),
    cashCents: centsFromDatabase(row.cash_cents, "cash_cents"),
    openClearingCents: centsFromDatabase(row.open_clearing_cents, "open_clearing_cents"),
    reversed: row.reversed,
    state: ledgerState(row),
    requestedAt: row.created_at.toISOString(),
    label: kind.label,
  };
}

// A short word for where the operation stands, for the notes on the items.
function ledgerState(row: LedgerRow): string {
  if (row.reversed) {
    return "voided";
  }
  if (row.kind === "stripe_refund") {
    // Refunds have their own precedence rule (a late provider_accepted must not hide a
    // completion), already written for the webhooks; reused rather than copied.
    return refundStateFromEvents(row.statuses);
  }
  // A claim payout that the bank sent back has a 'returned' event after its 'succeeded' one, and
  // the return is the last word: the money came home. The latest status therefore reads
  // correctly for both rails without a second precedence rule.
  return row.statuses.length > 0 ? row.statuses[row.statuses.length - 1] : "requested";
}
