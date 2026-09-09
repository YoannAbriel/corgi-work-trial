import type postgres from "postgres";
import { centsFromDatabase } from "@/lib/money/cents";
import { monthOfFirstDay, monthWasStillRunningAt, type StatementLineKind } from "./compute";

// What the statement screens read. Four questions, four queries, nothing written.
//
//   listStatementRuns          the runs, newest first, for the staff list and the broker list;
//   statementRun               one run with its broker, its totals and its stored lines;
//   changesAgainstPrevious     which journal entries appeared or disappeared since the revision
//                              this run supersedes, by entry id;
//   brokersWithStatements      the brokers a statement can be run for (the form's drop-down).
//
// Nothing here recomputes money. A stored run is the document we published; the only figure the
// screen computes live is the ledger's own commission_payable movement
// (lib/statements/journal.ts, commissionPayableMovementCents), which is shown NEXT TO the stored
// net due so a reader can see the two agree rather than take our word for it.

export type StatementRunRow = {
  runId: string;
  brokerId: string;
  brokerName: string;
  statementMonth: string; // "YYYY-MM"
  revision: number;
  knowledgeCutoff: Date;
  supersedesRunId: string | null;
  contentHash: string;
  identicalToPrevious: boolean;
  // Which shape this row is in (migration 0016). Read it through collectedFigures rather than
  // branching on it by hand: a v1 row's premium column holds the cash.
  canonicalVersion: number;
  // The format of the revision this run supersedes, null on revision 1. When it differs, the two
  // documents are not comparable by hash and the screens say "format changed".
  previousCanonicalVersion: number | null;
  // True when the month was still running at this run's own cutoff: the statement is provisional
  // (decision 19). Derived from the two stored dates, never stored, so it can never drift.
  monthWasStillRunning: boolean;
  cashCollectedCents: number; // what the customers paid: premium, tax and fee
  premiumCollectedCents: number; // the premium alone, which is the commission base
  commissionEarnedCents: number;
  clawbackCents: number;
  adjustmentCents: number;
  netDueCents: number;
  runByName: string | null; // null when no signed-in staff member ran it
  createdAt: Date;
};

// The runs, newest first. `brokerId` narrows the list to one broker, which is how the broker's own
// page is limited to the broker's own statements: it passes the id from the session, never one
// taken from the URL.
export async function listStatementRuns(
  database: postgres.Sql,
  options: { brokerId?: string; limit: number },
): Promise<StatementRunRow[]> {
  const rows = await database<RunRowShape[]>`
    select run.id, run.broker_id, broker.name as broker_name, run.statement_month, run.revision,
           run.knowledge_cutoff, run.supersedes_run_id, run.content_hash, run.identical_to_previous,
           run.canonical_version, previous.canonical_version as previous_canonical_version,
           run.cash_collected_cents::text, run.premium_collected_cents::text,
           run.commission_earned_cents::text,
           run.clawback_cents::text, run.adjustment_cents::text, run.net_due_cents::text,
           operator.display_name as run_by_name, run.created_at
      from statement_runs run
      join brokers broker on broker.id = run.broker_id
      left join users operator on operator.id::text = run.run_by
      -- The revision this one replaces, for its format alone: two runs written in different
      -- formats cannot be compared by hash (review finding F-B9-09).
      left join statement_runs previous on previous.id = run.supersedes_run_id
     -- No broker asked for means every broker: the condition then compares the column with
     -- itself, which is true for every row.
     where run.broker_id = coalesce(${options.brokerId ?? null}::uuid, run.broker_id)
     order by run.created_at desc
     limit ${options.limit}
  `;
  return rows.map(toRunRow);
}

export type StatementLineRow = {
  lineOrder: number;
  kind: StatementLineKind;
  policyId: string | null;
  policyNumber: string | null;
  journalEntryId: string;
  effectiveAt: Date;
  entryRecordedAt: Date;
  amountCents: number;
  // On a cash line, the premium part of that cash: what commission is earned on. Null on a
  // commission, clawback or adjustment line, and on the lines of a run made before migration 0013.
  commissionBaseCents: number | null;
  description: string;
};

export type StatementRunDetail = {
  run: StatementRunRow;
  lines: StatementLineRow[];
};

// One run and the lines it stored. Returns null when the id is unknown, so a page can answer 404
// instead of throwing.
export async function statementRun(database: postgres.Sql, runId: string): Promise<StatementRunDetail | null> {
  const [row] = await database<RunRowShape[]>`
    select run.id, run.broker_id, broker.name as broker_name, run.statement_month, run.revision,
           run.knowledge_cutoff, run.supersedes_run_id, run.content_hash, run.identical_to_previous,
           run.canonical_version, previous.canonical_version as previous_canonical_version,
           run.cash_collected_cents::text, run.premium_collected_cents::text,
           run.commission_earned_cents::text,
           run.clawback_cents::text, run.adjustment_cents::text, run.net_due_cents::text,
           operator.display_name as run_by_name, run.created_at
      from statement_runs run
      join brokers broker on broker.id = run.broker_id
      left join users operator on operator.id::text = run.run_by
      -- The revision this one replaces, for its format alone: two runs written in different
      -- formats cannot be compared by hash (review finding F-B9-09).
      left join statement_runs previous on previous.id = run.supersedes_run_id
     where run.id = ${runId}
  `;
  if (!row) {
    return null;
  }
  const lines = await database<LineRowShape[]>`
    select line_order, kind, policy_id, policy_number, journal_entry_id, effective_at,
           entry_recorded_at, amount_cents::text, commission_base_cents::text, description
      from statement_lines
     where run_id = ${runId}
     order by line_order
  `;
  return {
    run: toRunRow(row),
    lines: lines.map((line) => ({
      lineOrder: line.line_order,
      kind: line.kind,
      policyId: line.policy_id,
      policyNumber: line.policy_number,
      journalEntryId: line.journal_entry_id,
      effectiveAt: line.effective_at,
      entryRecordedAt: line.entry_recorded_at,
      amountCents: centsFromDatabase(line.amount_cents, "amount_cents"),
      commissionBaseCents:
        line.commission_base_cents === null ? null : centsFromDatabase(line.commission_base_cents, "commission_base_cents"),
      description: line.description,
    })),
  };
}

export type RevisionChange = {
  journalEntryId: string;
  kind: StatementLineKind;
  policyNumber: string | null;
  effectiveAt: Date;
  entryRecordedAt: Date;
  amountCents: number;
  description: string;
};

export type RevisionChanges = {
  previousRunId: string;
  appeared: RevisionChange[]; // on this revision and not on the one it supersedes
  disappeared: RevisionChange[]; // on the previous revision and not on this one
};

// What changed against the revision this run supersedes, entry by entry.
//
// The comparison is on the JOURNAL ENTRY ID, not on amounts: a statement line is one journal
// entry, and entries are immutable, so "what changed" can only ever be "these entries appeared"
// and "these entries are no longer there". That is exactly the answer to the panel's question
// about a correction landing after a month closed.
//
// Returns null on revision 1, which supersedes nothing.
export async function changesAgainstPrevious(
  database: postgres.Sql,
  runId: string,
): Promise<RevisionChanges | null> {
  const [run] = await database<{ supersedes_run_id: string | null }[]>`
    select supersedes_run_id from statement_runs where id = ${runId}
  `;
  if (!run?.supersedes_run_id) {
    return null;
  }
  const previousRunId = run.supersedes_run_id;

  const appeared = await database<ChangeRowShape[]>`
    select journal_entry_id, kind, policy_number, effective_at, entry_recorded_at,
           amount_cents::text, description
      from statement_lines
     where run_id = ${runId}
       and journal_entry_id not in (select journal_entry_id from statement_lines where run_id = ${previousRunId})
     order by effective_at, journal_entry_id
  `;
  const disappeared = await database<ChangeRowShape[]>`
    select journal_entry_id, kind, policy_number, effective_at, entry_recorded_at,
           amount_cents::text, description
      from statement_lines
     where run_id = ${previousRunId}
       and journal_entry_id not in (select journal_entry_id from statement_lines where run_id = ${runId})
     order by effective_at, journal_entry_id
  `;
  return { previousRunId, appeared: appeared.map(toChange), disappeared: disappeared.map(toChange) };
}

export type BrokerChoice = { brokerId: string; name: string };

// The brokers the staff form can pick from. Every broker, in name order: a broker with no policy
// yet is a legitimate choice and produces an empty statement rather than an error.
export async function brokersForStatements(database: postgres.Sql): Promise<BrokerChoice[]> {
  const rows = await database<{ id: string; name: string }[]>`
    select id, name from brokers order by name
  `;
  return rows.map((row) => ({ brokerId: row.id, name: row.name }));
}

// ---------------------------------------------------------------------------
// What the inbox shows: the statements the monthly job produced
// ---------------------------------------------------------------------------

// How many of them the inbox lists. The inbox promises that a count is the LENGTH of the list it
// opens (scripts/check-inbox-counts.ts), so the count is taken from this same list and never from
// a separate count(*): a badge saying 516 over a panel showing 25 would be the exact disagreement
// that check exists to catch. The whole list lives on /ops/statements.
export const MOST_STATEMENTS_IN_THE_INBOX = 25;

export type StatementProducedByTheJob = {
  runId: string;
  brokerId: string;
  brokerName: string;
  statementMonth: string; // "YYYY-MM"
  netDueCents: number;
  createdAt: Date;
};

// The statements the monthly close produced this calendar month (lib/statements/monthly-job.ts),
// newest first. `brokerId` narrows it to one broker, which is how a broker's own inbox is limited
// to their own statements: the id comes from the session, never from a URL.
//
// TWO CONDITIONS SAY "THE JOB PRODUCED THIS ONE", and they are the two the job itself works with:
//
//   run_by is null            nobody signed for it. Every human path passes the signed-in staff
//                             member (app/api/statements/run/route.ts), so a run with no author
//                             was produced by a job;
//   cutoff at or after the    it read a month that was already over, which is the definitive
//   end of its month          statement the job publishes and never a provisional one somebody
//                             ran during the month.
//
// "This calendar month" is measured in UTC, spelled out rather than left to the session's time
// zone, because the job itself decides its day in UTC.
export async function statementsProducedByTheJob(
  database: postgres.Sql,
  options: { brokerId?: string } = {},
): Promise<StatementProducedByTheJob[]> {
  const rows = await database<
    { id: string; broker_id: string; broker_name: string; statement_month: Date; net_due_cents: string; created_at: Date }[]
  >`
    select run.id, run.broker_id, broker.name as broker_name, run.statement_month,
           run.net_due_cents::text, run.created_at
      from statement_runs run
      join brokers broker on broker.id = run.broker_id
     where run.run_by is null
       and run.knowledge_cutoff >= (run.statement_month + interval '1 month') at time zone 'UTC'
       and run.created_at >= date_trunc('month', (now() at time zone 'UTC')) at time zone 'UTC'
       -- No broker asked for means every broker: the condition then compares the column with
       -- itself, which is true for every row.
       and run.broker_id = coalesce(${options.brokerId ?? null}::uuid, run.broker_id)
     order by run.created_at desc
     limit ${MOST_STATEMENTS_IN_THE_INBOX}
  `;
  return rows.map((row) => ({
    runId: row.id,
    brokerId: row.broker_id,
    brokerName: row.broker_name,
    statementMonth: monthOfFirstDay(row.statement_month.toISOString().slice(0, 10)),
    netDueCents: centsFromDatabase(row.net_due_cents, "net_due_cents"),
    createdAt: row.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Row shapes, and the conversions out of them
// ---------------------------------------------------------------------------

type RunRowShape = {
  id: string;
  broker_id: string;
  broker_name: string;
  statement_month: Date;
  revision: number;
  knowledge_cutoff: Date;
  supersedes_run_id: string | null;
  content_hash: string;
  identical_to_previous: boolean;
  canonical_version: number;
  previous_canonical_version: number | null;
  cash_collected_cents: string;
  premium_collected_cents: string;
  commission_earned_cents: string;
  clawback_cents: string;
  adjustment_cents: string;
  net_due_cents: string;
  run_by_name: string | null;
  created_at: Date;
};

type LineRowShape = {
  line_order: number;
  kind: StatementLineKind;
  policy_id: string | null;
  policy_number: string | null;
  journal_entry_id: string;
  effective_at: Date;
  entry_recorded_at: Date;
  amount_cents: string;
  commission_base_cents: string | null;
  description: string;
};

type ChangeRowShape = {
  journal_entry_id: string;
  kind: StatementLineKind;
  policy_number: string | null;
  effective_at: Date;
  entry_recorded_at: Date;
  amount_cents: string;
  description: string;
};

function toRunRow(row: RunRowShape): StatementRunRow {
  return {
    runId: row.id,
    brokerId: row.broker_id,
    brokerName: row.broker_name,
    // The database stores the first day of the month; a human reads "2028-03".
    statementMonth: monthOfFirstDay(row.statement_month.toISOString().slice(0, 10)),
    revision: row.revision,
    knowledgeCutoff: row.knowledge_cutoff,
    supersedesRunId: row.supersedes_run_id,
    contentHash: row.content_hash,
    identicalToPrevious: row.identical_to_previous,
    canonicalVersion: row.canonical_version,
    previousCanonicalVersion: row.previous_canonical_version,
    monthWasStillRunning: monthWasStillRunningAt(monthOfFirstDay(row.statement_month.toISOString().slice(0, 10)), row.knowledge_cutoff),
    cashCollectedCents: centsFromDatabase(row.cash_collected_cents, "cash_collected_cents"),
    premiumCollectedCents: centsFromDatabase(row.premium_collected_cents, "premium_collected_cents"),
    commissionEarnedCents: centsFromDatabase(row.commission_earned_cents, "commission_earned_cents"),
    clawbackCents: centsFromDatabase(row.clawback_cents, "clawback_cents"),
    adjustmentCents: centsFromDatabase(row.adjustment_cents, "adjustment_cents"),
    netDueCents: centsFromDatabase(row.net_due_cents, "net_due_cents"),
    runByName: row.run_by_name,
    createdAt: row.created_at,
  };
}

function toChange(row: ChangeRowShape): RevisionChange {
  return {
    journalEntryId: row.journal_entry_id,
    kind: row.kind,
    policyNumber: row.policy_number,
    effectiveAt: row.effective_at,
    entryRecordedAt: row.entry_recorded_at,
    amountCents: centsFromDatabase(row.amount_cents, "amount_cents"),
    description: row.description,
  };
}
