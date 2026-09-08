import type postgres from "postgres";
import { centsFromDatabase } from "@/lib/money/cents";
import type { Classification, ReconciliationSourceName } from "./breaks";

// What the reconciliation screen reads. Three questions, three queries, nothing written.
//
//   recentRuns      what the job did, run by run, including the runs that failed and why;
//   openBreaks      everything that is not matched in the LATEST COMPLETE run of each source;
//   resolvedBreaks  break keys an earlier run reported and the latest run no longer does.
//
// "Resolved" is derived, never stored: reconciliation_items is append-only, so a break that has
// been fixed is not deleted or updated, it simply stops being reported. Reading it as the
// absence of a key from the latest run is what makes the history honest.
//
// A FAILED run is deliberately not "the latest run" for this purpose: it compared nothing, so it
// can neither open a break nor close one. The open list therefore keeps showing what the last
// run that actually completed found, and the run list above it shows the failure.

// Both break queries below open with the same CTE, `latest`: the last COMPLETE run of each
// source. It is written out in full in each of them rather than built as a shared string,
// because a query you can read from top to bottom is worth four repeated lines.

export type ReconciliationRunRow = {
  runId: string;
  source: ReconciliationSourceName;
  status: "complete" | "failed";
  fetchError: string | null;
  windowFrom: Date;
  windowTo: Date;
  startedAt: Date;
  finishedAt: Date;
  counts: Record<Classification, number>;
  providerRecordCount: number;
  ledgerRecordCount: number;
  note: string | null;
  runByName: string | null; // null when the daily cron ran it
};

export async function recentRuns(database: postgres.Sql, limit: number): Promise<ReconciliationRunRow[]> {
  const rows = await database<
    {
      id: string;
      source: ReconciliationSourceName;
      status: "complete" | "failed";
      fetch_error: string | null;
      window_from: Date;
      window_to: Date;
      started_at: Date;
      finished_at: Date;
      matched_count: number;
      local_only_count: number;
      provider_only_count: number;
      amount_mismatch_count: number;
      stale_count: number;
      provider_record_count: number;
      ledger_record_count: number;
      note: string | null;
      run_by_name: string | null;
    }[]
  >`
    select run.id, run.source, run.status, run.fetch_error, run.window_from, run.window_to,
           run.started_at, run.finished_at, run.matched_count, run.local_only_count,
           run.provider_only_count, run.amount_mismatch_count, run.stale_count,
           run.provider_record_count, run.ledger_record_count, run.note,
           operator.display_name as run_by_name
      from reconciliation_runs run
      left join users operator on operator.id::text = run.run_by
     order by run.finished_at desc
     limit ${limit}
  `;
  return rows.map((row) => ({
    runId: row.id,
    source: row.source,
    status: row.status,
    fetchError: row.fetch_error,
    windowFrom: row.window_from,
    windowTo: row.window_to,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    counts: {
      matched: row.matched_count,
      local_only: row.local_only_count,
      provider_only: row.provider_only_count,
      amount_mismatch: row.amount_mismatch_count,
      stale: row.stale_count,
    },
    providerRecordCount: row.provider_record_count,
    ledgerRecordCount: row.ledger_record_count,
    note: row.note,
    runByName: row.run_by_name,
  }));
}

export type ReconciliationBreakRow = {
  source: ReconciliationSourceName;
  classification: Classification;
  breakKey: string;
  providerRef: string | null;
  ledgerRef: string | null;
  providerAmountCents: number | null;
  ledgerAmountCents: number | null;
  differenceCents: number | null;
  firstSeenAt: Date;
  lastReportedAt: Date;
  note: string;
};

// Everything the latest complete run of each source reported as anything but matched.
export async function openBreaks(database: postgres.Sql): Promise<ReconciliationBreakRow[]> {
  const rows = await database<BreakRowShape[]>`
    with latest as (
      select distinct on (source) id, source, finished_at
        from reconciliation_runs
       where status = 'complete'
       order by source, finished_at desc
    )
    select latest.source,
           item.classification,
           item.break_key,
           item.provider_ref,
           item.ledger_ref,
           item.provider_amount_cents::text as provider_amount_cents,
           item.ledger_amount_cents::text as ledger_amount_cents,
           item.difference_cents::text as difference_cents,
           item.first_seen_at,
           latest.finished_at as last_reported_at,
           item.note
      from reconciliation_items item
      join latest on latest.id = item.run_id
     where item.classification <> 'matched'
     order by item.first_seen_at, latest.source, item.classification
  `;
  return rows.map(toBreakRow);
}

// Break keys that were reported by some complete run and are absent from the latest complete run
// of their source: the break went away. The row shown is the LAST one that reported it, so the
// screen can say what it was and when it was last seen.
export async function resolvedBreaks(database: postgres.Sql, limit: number): Promise<ReconciliationBreakRow[]> {
  const rows = await database<BreakRowShape[]>`
    with latest as (
      select distinct on (source) id, source, finished_at
        from reconciliation_runs
       where status = 'complete'
       order by source, finished_at desc
    )
    select distinct on (item.break_key)
           run.source,
           item.classification,
           item.break_key,
           item.provider_ref,
           item.ledger_ref,
           item.provider_amount_cents::text as provider_amount_cents,
           item.ledger_amount_cents::text as ledger_amount_cents,
           item.difference_cents::text as difference_cents,
           item.first_seen_at,
           run.finished_at as last_reported_at,
           item.note
      from reconciliation_items item
      join reconciliation_runs run on run.id = item.run_id
     where item.classification <> 'matched'
       and run.status = 'complete'
       and not exists (
             select 1 from reconciliation_items still
              join latest on latest.id = still.run_id
             where still.break_key = item.break_key
           )
     order by item.break_key, run.finished_at desc
  `;
  return rows
    .map(toBreakRow)
    .sort((left, right) => right.lastReportedAt.getTime() - left.lastReportedAt.getTime())
    .slice(0, limit);
}

type BreakRowShape = {
  source: ReconciliationSourceName;
  classification: Classification;
  break_key: string;
  provider_ref: string | null;
  ledger_ref: string | null;
  provider_amount_cents: string | null;
  ledger_amount_cents: string | null;
  difference_cents: string | null;
  first_seen_at: Date;
  last_reported_at: Date;
  note: string;
};

function toBreakRow(row: BreakRowShape): ReconciliationBreakRow {
  return {
    source: row.source,
    classification: row.classification,
    breakKey: row.break_key,
    providerRef: row.provider_ref,
    ledgerRef: row.ledger_ref,
    providerAmountCents: row.provider_amount_cents === null ? null : centsFromDatabase(row.provider_amount_cents, "provider_amount_cents"),
    ledgerAmountCents: row.ledger_amount_cents === null ? null : centsFromDatabase(row.ledger_amount_cents, "ledger_amount_cents"),
    differenceCents: row.difference_cents === null ? null : centsFromDatabase(row.difference_cents, "difference_cents"),
    firstSeenAt: row.first_seen_at,
    lastReportedAt: row.last_reported_at,
    note: row.note,
  };
}
