import type postgres from "postgres";
import { centsFromDatabase } from "@/lib/money/cents";
import type { BrokerJournalEntry } from "./compute";
import { firstDayOfMonth, lastDayOfMonth } from "./compute";

// The one query a statement run makes: the journal entries of one broker, for one month, as they
// were known at one instant. Read-only, with the runtime role (SELECT and INSERT only), plain SQL.
//
// THE THREE CONDITIONS, and why each is the right one:
//
//   entry.broker_id = the broker      the entry says which broker it belongs to; the statement
//                                     never guesses it from a policy that may have moved.
//   effective_at inside the month     the BUSINESS date decides which month an entry belongs to.
//                                     A payment collected on 2028-03-01 is March money even if it
//                                     was recorded in April, and a correction effective in March
//                                     is March money even when it is recorded in June. This is the
//                                     open question flagged to Yoann in the handoff note.
//   recorded_at <= knowledge_cutoff   what we knew at that instant, and nothing later. recorded_at
//                                     is set by the database clock (migrations 0001, 0003) and a
//                                     journal row can never be changed, so re-reading with the
//                                     same cutoff returns the same rows forever.
//
// Each entry is reduced to two signed movements, because those are the only two things a broker
// statement is about:
//
//   cash_cents               debits minus credits on cash_stripe and unapplied_customer_cash:
//                            the customer money that moved. Both accounts, because a payment
//                            parked in the suspense account and applied later (rule 14) debits
//                            unapplied_customer_cash instead of cash_stripe.
//   commission_payable_cents credits minus debits on commission_payable: what the broker is owed.
//                            Its sum over the month IS the net due of the statement.
//
// The HAVING clause is the selection rule of lib/statements/compute.ts, expressed in SQL: every
// entry that moved the broker's payable, plus the collections and refunds that explain them.

export type StatementJournalQuery = {
  brokerId: string;
  statementMonth: string; // "YYYY-MM"
  knowledgeCutoff: Date;
};

// The cash side of a collection or a refund, and their reversals. Written out rather than matched
// by prefix so that adding an entry type to the statement is a deliberate edit in one place.
const CASH_ENTRY_TYPES = [
  "premium_collected",
  "reversal_of_premium_collected",
  "refund_completed",
  "reversal_of_refund_completed",
];

export async function brokerJournalEntriesInMonth(
  query: StatementJournalQuery,
  database: postgres.Sql,
): Promise<BrokerJournalEntry[]> {
  const rows = await database<JournalRow[]>`
    select entry.id,
           entry.entry_type,
           entry.effective_at,
           entry.recorded_at,
           entry.policy_id,
           policy.policy_number,
           entry.description,
           coalesce(sum(line.debit_cents - line.credit_cents)
                      filter (where line.account_id in ('cash_stripe', 'unapplied_customer_cash')), 0)::text
             as cash_cents,
           coalesce(sum(line.credit_cents - line.debit_cents)
                      filter (where line.account_id = 'commission_payable'), 0)::text
             as commission_payable_cents
      from journal_entries entry
      join journal_lines line on line.entry_id = entry.id
      left join policies policy on policy.id = entry.policy_id
     where entry.broker_id = ${query.brokerId}
       and entry.effective_at between ${firstDayOfMonth(query.statementMonth)} and ${lastDayOfMonth(query.statementMonth)}
       and entry.recorded_at <= ${query.knowledgeCutoff}
     group by entry.id, policy.id
    having coalesce(sum(line.credit_cents - line.debit_cents)
                      filter (where line.account_id = 'commission_payable'), 0) <> 0
        or entry.entry_type = any(${CASH_ENTRY_TYPES})
     order by entry.effective_at, entry.id
  `;

  return rows.map((row) => ({
    entryId: row.id,
    entryType: row.entry_type,
    // The driver returns a date column as a Date at midnight UTC; the statement speaks in
    // calendar dates, so it is cut back to "YYYY-MM-DD" here and nowhere else.
    effectiveAt: row.effective_at.toISOString().slice(0, 10),
    // Postgres keeps microseconds and a JavaScript Date keeps milliseconds, so this is the entry's
    // recording time to the millisecond. That is the resolution the whole application works in,
    // and it is deterministic: the same row always reads back to the same instant, which is what
    // the content hash needs.
    recordedAt: row.recorded_at.toISOString(),
    policyId: row.policy_id,
    policyNumber: row.policy_number,
    description: row.description,
    cashCents: centsFromDatabase(row.cash_cents, "cash_cents"),
    commissionPayableCents: centsFromDatabase(row.commission_payable_cents, "commission_payable_cents"),
  }));
}

type JournalRow = {
  id: string;
  entry_type: string;
  effective_at: Date;
  recorded_at: Date;
  policy_id: string | null;
  policy_number: string | null;
  description: string;
  cash_cents: string;
  commission_payable_cents: string;
};

// The same month's commission_payable movement, asked of the journal on its own.
//
// It is deliberately a SECOND, much smaller query rather than a sum over the query above: the
// statement page uses it to say "this run still ties to the ledger" without going through any of
// the code that produced the run. If the two ever disagreed, the ledger would be right and the
// screen would say so.
export async function commissionPayableMovementCents(
  query: StatementJournalQuery,
  database: postgres.Sql,
): Promise<number> {
  const [row] = await database<{ movement_cents: string }[]>`
    select coalesce(sum(line.credit_cents - line.debit_cents), 0)::text as movement_cents
      from journal_lines line
      join journal_entries entry on entry.id = line.entry_id
     where entry.broker_id = ${query.brokerId}
       and line.account_id = 'commission_payable'
       and entry.effective_at between ${firstDayOfMonth(query.statementMonth)} and ${lastDayOfMonth(query.statementMonth)}
       and entry.recorded_at <= ${query.knowledgeCutoff}
  `;
  return centsFromDatabase(row.movement_cents, "movement_cents");
}
