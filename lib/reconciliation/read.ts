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
  recordAt: Date; // when the compared record belongs; decides which runs re-examined it
  firstSeenAt: Date;
  lastReportedAt: Date;
  note: string;
};

// WHAT RESOLVES A BREAK, and it is the correction of review finding F-B10-01.
//
// It used to be "the latest complete run of this source no longer reports it". That is wrong,
// because a run only compares what falls inside its window: a break older than the seven-day
// default was compared by nobody, left the open list on its own, and was filed under "breaks that
// went away". Nothing had fixed it. The screen answered "is this break in the latest run" when
// the operator asks "is this break explained".
//
// A break is resolved only by a LATER complete run OF THE SAME SOURCE that actually looked at it:
//
//   * later      the run finished after the break was last reported;
//   * complete   a failed run compared nothing, so it can neither open nor close anything;
//   * covering   the record's own date falls inside that run's window (this is the new part);
//   * silent     that run reports the key as matched, or does not report it at all.
//
// A break nobody re-examined stays open, with its age. The daily job widens its window to cover
// the oldest open break, so the ordinary case resolves itself (lib/reconciliation/run.ts,
// windowCoveringOpenBreaks).
//
// record_at is null on items written before migration 0017. Their first-seen instant stands in
// for it: that is when we first saw the record, and it is by construction inside the window of
// the run that reported it, so one rule covers old and new items alike.
//
// The two constants below are SQL fragments written out here and inserted with `unsafe` into both
// queries. `unsafe` inserts them as text, so it would be dangerous with anything coming from a
// request; these are constants of this file, no value from anywhere else touches them, and every
// value the queries compare is still passed as a parameter. They are shared rather than copied
// because the rule that decides whether a break is open must exist once: two copies would drift,
// and a break would end up in both lists or in neither.
const LATEST_REPORT_OF_EACH_BREAK = `
  select distinct on (item.break_key)
         run.source,
         run.finished_at as last_reported_at,
         coalesce(item.record_at, item.first_seen_at) as record_at,
         item.break_key, item.classification, item.provider_ref, item.ledger_ref,
         item.provider_amount_cents, item.ledger_amount_cents, item.difference_cents,
         item.first_seen_at, item.note
    from reconciliation_items item
    join reconciliation_runs run on run.id = item.run_id
   where item.classification <> 'matched' and run.status = 'complete'
   order by item.break_key, run.finished_at desc
`;

// True when some later complete run of the same source covered this record's date and did not
// report it as a break.
const A_LATER_RUN_RE_EXAMINED_IT = `
  exists (
    select 1
      from reconciliation_runs later
     where later.source = latest_report.source
       and later.status = 'complete'
       and later.finished_at > latest_report.last_reported_at
       and latest_report.record_at between later.window_from and later.window_to
       and not exists (
             select 1 from reconciliation_items still
              where still.run_id = later.id
                and still.break_key = latest_report.break_key
                and still.classification <> 'matched'
           )
  )
`;

// Everything still unexplained: reported as a break by some complete run, and not re-examined
// since by a run that covered it.
// Deliberately not limited: this is the one list whose whole purpose is that nothing is
// forgotten, so it never silently drops a row. Finding F-B10-07 (unbounded reads) is left open
// and recorded; a bound here would trade a real guarantee for a performance worry that trial
// volumes do not have.
export async function openBreaks(database: postgres.Sql): Promise<ReconciliationBreakRow[]> {
  const rows = await database<BreakRowShape[]>`
    with latest_report as (${database.unsafe(LATEST_REPORT_OF_EACH_BREAK)})
    select source, classification, break_key, provider_ref, ledger_ref,
           provider_amount_cents::text as provider_amount_cents,
           ledger_amount_cents::text as ledger_amount_cents,
           difference_cents::text as difference_cents,
           record_at, first_seen_at, last_reported_at, note
      from latest_report
     where not ${database.unsafe(A_LATER_RUN_RE_EXAMINED_IT)}
     order by first_seen_at, source, break_key
  `;
  return rows.map(toBreakRow);
}

// Breaks a later covering run looked at again and no longer reports. The row shown is the last one
// that reported the break, so the screen can say what it was and when it was last seen. Nothing is
// deleted or updated to get here: this is the absence of a break in a run that DID compare it.
export async function resolvedBreaks(database: postgres.Sql, limit: number): Promise<ReconciliationBreakRow[]> {
  const rows = await database<BreakRowShape[]>`
    with latest_report as (${database.unsafe(LATEST_REPORT_OF_EACH_BREAK)})
    select source, classification, break_key, provider_ref, ledger_ref,
           provider_amount_cents::text as provider_amount_cents,
           ledger_amount_cents::text as ledger_amount_cents,
           difference_cents::text as difference_cents,
           record_at, first_seen_at, last_reported_at, note
      from latest_report
     where ${database.unsafe(A_LATER_RUN_RE_EXAMINED_IT)}
     order by last_reported_at desc
     limit ${limit}
  `;
  // Items written before the break key changed shape (review finding F-B10-02) are stored under
  // the old key and can never be rewritten. Without this filter such a break shows twice: open
  // under its new key with a fresh age, and "went away" under its old key (review finding
  // F-B10-11). The reference is the same money in both rows, so a reference that is still open
  // is not resolved, whatever key an earlier run filed it under. Decided in the read, not by
  // touching the stored rows.
  const open = await openBreaks(database);
  const stillOpen = new Set(
    open.flatMap((row) => [row.providerRef, row.ledgerRef].filter((ref): ref is string => ref !== null).map((ref) => `${row.source}|${ref}`)),
  );
  return rows
    .map(toBreakRow)
    .filter((row) => ![row.providerRef, row.ledgerRef].some((ref) => ref !== null && stillOpen.has(`${row.source}|${ref}`)));
}

// The oldest record date among the open breaks of EVERY source, or null when nothing is open. The
// daily job asks this so its one window reaches back far enough to re-examine what is still open
// instead of leaving it unlooked at for ever (finding F-B10-01). One window for both sources,
// because the job runs them on the same window and the older of the two is what decides.
export async function oldestOpenBreakRecordDate(database: postgres.Sql): Promise<Date | null> {
  const breaks = await openBreaks(database);
  if (breaks.length === 0) {
    return null;
  }
  return breaks.reduce((oldest, row) => (row.recordAt < oldest ? row.recordAt : oldest), breaks[0].recordAt);
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
  record_at: Date;
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
    recordAt: row.record_at,
    firstSeenAt: row.first_seen_at,
    lastReportedAt: row.last_reported_at,
    note: row.note,
  };
}

// How many breaks are open right now, for the sidebar badge and the "what needs you" block.
//
// It reuses the two SQL fragments above rather than restating the rule, for the reason written
// where they are declared: what makes a break open must exist once, or the number next to
// "Reconciliation" and the list it points at would drift apart. Only `count(*)` differs from
// openBreaks, so nothing is transferred: this runs on every page of the workspace.
export async function countOpenBreaks(database: postgres.Sql): Promise<number> {
  const [row] = await database<{ open_breaks: number }[]>`
    with latest_report as (${database.unsafe(LATEST_REPORT_OF_EACH_BREAK)})
    select count(*)::int as open_breaks
      from latest_report
     where not ${database.unsafe(A_LATER_RUN_RE_EXAMINED_IT)}
  `;
  return row.open_breaks;
}
