import type postgres from "postgres";
import { centsFromDatabase } from "@/lib/money/cents";
import type { BrokerJournalEntry } from "./compute";
import { firstDayOfMonth, lastDayOfMonth, STATEMENT_CASH_ENTRY_TYPES } from "./compute";

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
// Each entry is reduced to three signed movements, because those are the only things a broker
// statement is about:
//
//   cash_cents               debits minus credits on cash_stripe and unapplied_customer_cash:
//                            the customer money that moved. Both accounts, because a payment
//                            parked in the suspense account and applied later (rule 14) debits
//                            unapplied_customer_cash instead of cash_stripe.
//   commission_payable_cents credits minus debits on commission_payable: what the broker is owed.
//                            Its sum over the month IS the net due of the statement.
//   unearned_premium_cents   the PREMIUM part of that cash, which is what commission is earned on
//                            (decision 19). See the subquery's own comment below.
//
// The HAVING clause is the selection rule of lib/statements/compute.ts, expressed in SQL: every
// entry that moved the broker's payable, plus the collections and refunds that explain them.

export type StatementJournalQuery = {
  brokerId: string;
  statementMonth: string; // "YYYY-MM"
  knowledgeCutoff: Date;
};

// The cash side of a collection or a refund, and their reversals. It is derived from the one
// table that says what the statement does with each entry type (lib/statements/compute.ts), so
// this query and the classifier can never disagree about which entries carry cash: that
// disagreement is exactly how a collected correction difference went missing (F-B8-01) and how an
// endorsement did before it (F-B9-01).
const CASH_ENTRY_TYPES = STATEMENT_CASH_ENTRY_TYPES;

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
             as commission_payable_cents,
           -- The premium part of this entry's cash, which is what commission is earned on.
           --
           -- It is not on this entry: a collection entry moves cash against the receivable. It is
           -- on the SIBLING entry filed under the same money operation, which is the one that
           -- wrote the premium: premium_written at issuance, endorsement_premium_written on an
           -- endorsement, refund_requested on a refund. Each of them moves unearned_premium, and
           -- each moves it the same way round as the cash (credited when premium is written and
           -- money comes in, debited when premium is given back and money goes out), so one sum
           -- over the operation's entries answers the question for every case, reversals
           -- included: a reversal group holds the mirrored premium entry too.
           --
           -- The cutoff is applied here as well, so a sibling entry recorded later cannot change
           -- the figure a closed month already published. The MONTH is deliberately not applied:
           -- premium is written on the policy effective date, which is often an earlier month
           -- than the day the money arrived, and it is still the premium of that cash.
           --
           -- A CORRECTION IS THE ONE CASE WHERE THE SIBLING READ FINDS NOTHING, so a second sum
           -- is added to it (review finding F-B8-01). A backdated correction does not write its
           -- premium under the money operation that settles the difference: it writes it under
           -- its own two policy events, the reversal of what was booked and the re-book of what
           -- is right (lib/ledger/correction-entries.ts, source_kind 'correction'). Their net
           -- movement of unearned_premium IS the premium the difference is made of: +4931 when
           -- the corrected date charges more days, -4931 when it charges fewer, in the recited
           -- example. Exactly one of the two sums below is ever non-zero for a given entry.
           --
           -- The correction is found from the money operation that settles it: correction_
           -- collections names the re-book for money coming in, refund_allocations names it for
           -- money going back out, and the re-book's payload names the reversal beside it.
           (coalesce((select sum(premium_line.credit_cents - premium_line.debit_cents)
                       from journal_entries premium_entry
                       join journal_lines premium_line on premium_line.entry_id = premium_entry.id
                      where premium_entry.source_kind = entry.source_kind
                        and premium_entry.source_id = entry.source_id
                        and premium_entry.recorded_at <= ${query.knowledgeCutoff}
                        and premium_line.account_id = 'unearned_premium'), 0)
            + coalesce((select sum(premium_line.credit_cents - premium_line.debit_cents)
                          from policy_events rebook
                          join journal_entries premium_entry
                            on premium_entry.source_kind = 'correction'
                           and premium_entry.source_id in (rebook.id::text, rebook.payload ->> 'correction_reversal_event_id')
                          join journal_lines premium_line on premium_line.entry_id = premium_entry.id
                         where rebook.event_type = 'correction_rebook'
                           and rebook.id = coalesce(
                                 (select link.correction_rebook_event_id from correction_collections link
                                   where link.collection_operation_id::text = entry.source_id),
                                 (select allocation.policy_event_id from refund_allocations allocation
                                   where allocation.refund_operation_id::text = entry.source_id))
                           and premium_entry.recorded_at <= ${query.knowledgeCutoff}
                           and premium_line.account_id = 'unearned_premium'), 0))::text
             as unearned_premium_cents
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
    unearnedPremiumCents: centsFromDatabase(row.unearned_premium_cents, "unearned_premium_cents"),
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
  unearned_premium_cents: string;
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
