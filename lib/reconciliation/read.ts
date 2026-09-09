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
// and a break would end up in both lists or in neither. They are exported for that same reason:
// the console reads the open breaks of ONE object, bounded and filtered in SQL
// (openBreaksOfSubject in lib/console/read.ts, review finding F-B13-22), and it must ask the
// same question this screen asks, not a second version of it.
export const LATEST_REPORT_OF_EACH_BREAK = `
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
export const A_LATER_RUN_RE_EXAMINED_IT = `
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

// The columns of one break row, qualified so the same list reads correctly in a query that
// joins something else beside it. Shared for the ordinary reason: three readers return this shape
// (BreakRowShape below), and a column added to one of them and not the others would give the
// three lists of the same screen three different meanings.
const THE_COLUMNS_OF_A_BREAK_ROW = `
  latest_report.source, latest_report.classification, latest_report.break_key,
  latest_report.provider_ref, latest_report.ledger_ref,
  latest_report.provider_amount_cents::text as provider_amount_cents,
  latest_report.ledger_amount_cents::text as ledger_amount_cents,
  latest_report.difference_cents::text as difference_cents,
  latest_report.record_at, latest_report.first_seen_at, latest_report.last_reported_at,
  latest_report.note
`;

// Everything still unexplained: reported as a break by some complete run, and not re-examined
// since by a run that covered it.
//
// STILL DELIBERATELY UNBOUNDED, and it is the callers that decide. The inbox, the MCP tool and
// the daily job ask this question because they must not miss a break, so the answer is complete
// by construction. A screen showing a page of it asks `openBreaksPage` below, which bounds the
// read and says so on the page rather than dropping rows in silence (finding F-B10-07).
export async function openBreaks(database: postgres.Sql): Promise<ReconciliationBreakRow[]> {
  const rows = await database<BreakRowShape[]>`
    with latest_report as (${database.unsafe(LATEST_REPORT_OF_EACH_BREAK)})
    select ${database.unsafe(THE_COLUMNS_OF_A_BREAK_ROW)}
      from latest_report
     where not ${database.unsafe(A_LATER_RUN_RE_EXAMINED_IT)}
     order by first_seen_at, source, break_key
  `;
  return rows.map(toBreakRow);
}

// A resolved row and an open row TOUCH THE SAME REFERENCE. Written once, used three times
// below, because the two answers it decides (drop, or annotate) must rest on one definition.
//
// A break key is built from the source and a reference, so two rows can name the same money
// under two different keys: that is the whole of finding F-B10-11, where items stored before the
// key changed shape keep the old key for ever. The reference is compared both ways round
// (a provider reference on one side can be the ledger reference on the other) because the two
// halves of one money movement are filed from opposite sides.
const SHARES_A_REFERENCE_WITH_THE_RESOLVED_ROW = `
  open_report.source = latest_report.source
  and open_report.break_key <> latest_report.break_key
  and (
        (open_report.provider_ref is not null
         and (open_report.provider_ref = latest_report.provider_ref or open_report.provider_ref = latest_report.ledger_ref))
     or (open_report.ledger_ref is not null
         and (open_report.ledger_ref = latest_report.provider_ref or open_report.ledger_ref = latest_report.ledger_ref))
      )
`;

// True when the two rows CANNOT BE TOLD APART as two different money movements: one of them does
// not name a money operation at all, or they name the same one. That is the F-B10-11 shape, the
// same money seen twice, and the resolved half of it is not a resolution.
//
// When both rows name an operation and the operations differ, they are two different movements
// that happen to carry one provider reference (the case lib/reconciliation/diff.ts refuses to
// pair, finding F-B10-09). One of them really did stop being reported, and dropping its line
// would hide a resolution rather than a problem (finding F-PP-12): it is listed, annotated.
const IS_THE_SAME_MONEY_AS_THE_RESOLVED_ROW = `
  open_report.ledger_ref is null
  or latest_report.ledger_ref is null
  or open_report.ledger_ref = latest_report.ledger_ref
`;

// Breaks a later covering run looked at again and no longer reports. The row shown is the last one
// that reported the break, so the screen can say what it was and when it was last seen. Nothing is
// deleted or updated to get here: this is the absence of a break in a run that DID compare it.
//
// The open list is correlated IN SQL rather than read whole and filtered in JavaScript (finding
// F-PP-11): the old shape read every open break on every page load, so the screen slowed down
// exactly as the number that matters grew. `open_report` is the same rule the open list uses,
// declared once above, so the two lists cannot drift apart.
export async function resolvedBreaks(database: postgres.Sql, limit: number): Promise<ReconciliationBreakRow[]> {
  const rows = await database<(BreakRowShape & { open_break_key: string | null; open_shared_ref: string | null })[]>`
    with latest_report as (${database.unsafe(LATEST_REPORT_OF_EACH_BREAK)}),
         open_report as (
           select source, break_key, provider_ref, ledger_ref
             from latest_report
            where not ${database.unsafe(A_LATER_RUN_RE_EXAMINED_IT)}
         )
    select ${database.unsafe(THE_COLUMNS_OF_A_BREAK_ROW)},
           still_open.break_key as open_break_key,
           still_open.shared_ref as open_shared_ref
      from latest_report
      -- The open break of ANOTHER money movement that carries one of this row's references, when
      -- there is one. It annotates the line; it never removes it.
      left join lateral (
        select open_report.break_key,
               case
                 when open_report.provider_ref is not null
                  and (open_report.provider_ref = latest_report.provider_ref
                       or open_report.provider_ref = latest_report.ledger_ref)
                 then open_report.provider_ref
                 else open_report.ledger_ref
               end as shared_ref
          from open_report
         where ${database.unsafe(SHARES_A_REFERENCE_WITH_THE_RESOLVED_ROW)}
           and not (${database.unsafe(IS_THE_SAME_MONEY_AS_THE_RESOLVED_ROW)})
         order by open_report.break_key
         limit 1
      ) still_open on true
     where ${database.unsafe(A_LATER_RUN_RE_EXAMINED_IT)}
       -- The same money, still open under another key, is not resolved at all (F-B10-11): that
       -- row is left out, which is what stops one break showing twice, open and "went away".
       and not exists (
         select 1
           from open_report
          where ${database.unsafe(SHARES_A_REFERENCE_WITH_THE_RESOLVED_ROW)}
            and (${database.unsafe(IS_THE_SAME_MONEY_AS_THE_RESOLVED_ROW)})
       )
     order by latest_report.last_reported_at desc
     limit ${limit}
  `;
  return rows.map((row) => {
    const resolved = toBreakRow(row);
    if (!row.open_break_key) {
      return resolved;
    }
    // Worded for THIS record: what stopped being reported is this one, and the reference it
    // shares is still open on another break, which the reader has to be sent to.
    return {
      ...resolved,
      note:
        `${resolved.note}; ANOTHER BREAK ON THIS SOURCE IS STILL OPEN CARRYING THE SAME REFERENCE ` +
        `${row.open_shared_ref ?? "(unnamed)"} (break ${row.open_break_key}), so this line says that THIS record ` +
        `stopped being reported, and nothing about the money behind that other break`,
    };
  });
}

// The oldest record date among the open breaks of EVERY source, or null when nothing is open. The
// daily job asks this so its one window reaches back far enough to re-examine what is still open
// instead of leaving it unlooked at for ever (finding F-B10-01). One window for both sources,
// because the job runs them on the same window and the older of the two is what decides.
export async function oldestOpenBreakRecordDate(database: postgres.Sql): Promise<Date | null> {
  // One aggregate, not every open row read back to take a minimum of it (finding F-B10-07). The
  // rule is the shared one, so this date and the open list can never disagree.
  const [row] = await database<{ oldest: Date | null }[]>`
    with latest_report as (${database.unsafe(LATEST_REPORT_OF_EACH_BREAK)})
    select min(record_at) as oldest
      from latest_report
     where not ${database.unsafe(A_LATER_RUN_RE_EXAMINED_IT)}
  `;
  return row.oldest ?? null;
}

// The page of open breaks a screen shows, and whether there are more than it asked for.
//
// The open list itself is unbounded on purpose (openBreaks above), because the inbox, the MCP
// tool and the daily job must not miss one. A screen is a different question: it renders a table
// a person reads, and reading every open break to draw twenty of them is the cost finding
// F-B10-07 recorded. So the read is bounded here, and the bound is REPORTED rather than hidden:
// `totalOpen` is counted with the same rule, and `capped` is true when the page does not hold
// every open break, so the screen can print the sentence instead of quietly showing a part of the
// list as if it were the whole of it.
export type OpenBreaksPage = {
  rows: ReconciliationBreakRow[];
  totalOpen: number;
  capped: boolean; // totalOpen > rows.length: the screen must say so
};

export async function openBreaksPage(database: postgres.Sql, limit: number): Promise<OpenBreaksPage> {
  const [rows, totalOpen] = await Promise.all([
    database<BreakRowShape[]>`
      with latest_report as (${database.unsafe(LATEST_REPORT_OF_EACH_BREAK)})
      select ${database.unsafe(THE_COLUMNS_OF_A_BREAK_ROW)}
        from latest_report
       where not ${database.unsafe(A_LATER_RUN_RE_EXAMINED_IT)}
       order by first_seen_at, source, break_key
       limit ${limit}
    `,
    countOpenBreaks(database),
  ]);
  return { rows: rows.map(toBreakRow), totalOpen, capped: totalOpen > rows.length };
}

export type BreakRowShape = {
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

export function toBreakRow(row: BreakRowShape): ReconciliationBreakRow {
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
