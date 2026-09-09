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
      probe_count: number | null; // null on every run stored before migration 0023
      provider_record_count: number;
      ledger_record_count: number;
      note: string | null;
      run_by_name: string | null;
    }[]
  >`
    select run.id, run.source, run.status, run.fetch_error, run.window_from, run.window_to,
           run.started_at, run.finished_at, run.matched_count, run.local_only_count,
           run.provider_only_count, run.amount_mismatch_count, run.stale_count, run.probe_count,
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
      // NULL means the run was stored before the probe classification existed (migration 0023),
      // so it classified no item as a probe: zero is what that run actually recorded, and the
      // payments that are probes today are inside its provider_only count.
      probe: row.probe_count ?? 0,
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
//
// `run.id` is selected here for latestBreakReportsFor below, which answers "which run said this,
// and when": every other reader picks its columns by name, so the extra column costs them
// nothing and no reader can end up with a different notion of "the latest report".
export const LATEST_REPORT_OF_EACH_BREAK = `
  select distinct on (item.break_key)
         run.source,
         run.id as run_id,
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

// A PROBE IS NOT A BREAK TO ACT ON. It is a payment one of our own check runs planted at the
// provider on purpose, recognised by the classifier and stored as its own classification
// (lib/reconciliation/diff.ts, isProbeFromACheckRun). It stays reported by every run that sees
// it, it is listed on the board under its own heading, and it is counted separately.
export const IT_IS_A_PROBE_FROM_A_CHECK_RUN = `latest_report.classification = 'probe'`;

// A NOTE EXPLAINS ONE REPORT OF A BREAK, not the break for ever, and that is the correction of
// review finding F-BREAKSBOARD-01.
//
// The break key is deliberately the money and not the classification (lib/reconciliation/breaks.ts):
// a break that gets worse keeps its key and its age. A note keyed on nothing but that key
// therefore went on excluding the break after a later run described it differently, so a `stale`
// refund somebody had explained stayed out of the count, the inbox, the MCP tool and the daily
// job's window on the day it became a `provider_only` with a real difference.
//
// So the note carries the description it was written against: the classification and the two
// amounts of the latest report at that moment (migration 0025). It explains that report and no
// other. `is not distinct from` rather than `=` because either amount is legitimately null.
//
// A note written before migration 0025 has no recorded classification, so it matches nothing and
// its break is work again: we cannot know what it was about, and writing a new note is one click.
export const THE_NOTE_EXPLAINS_THE_LATEST_REPORT = `
  note.explained_classification = latest_report.classification
  and note.explained_provider_amount_cents is not distinct from latest_report.provider_amount_cents
  and note.explained_ledger_amount_cents is not distinct from latest_report.ledger_amount_cents
`;

// SOMEBODY HAS EXPLAINED IT: a staff operations user wrote a note against this break key
// (reconciliation_break_notes, migration 0022) describing the break exactly as the latest run
// still describes it. The note repairs nothing and hides nothing. It says a human has looked at
// this break and knows what it is, which is what takes it out of the list of things to act on and
// out of the inbox; the break stays on the screen, under its own heading, with the note, its
// author and its date. The day a run reports it differently, no note matches any more and the
// break is back in the list, its notes still on file and shown beside it.
export const SOMEBODY_HAS_EXPLAINED_IT = `
  exists (
    select 1 from reconciliation_break_notes note
     where note.break_key = latest_report.break_key
       and ${THE_NOTE_EXPLAINS_THE_LATEST_REPORT}
  )
`;

// WHAT "OPEN" MEANS FOR THE COUNT, THE INBOX, THE MCP TOOL AND THE BOARD: still reported by the
// latest complete run that looked, not re-examined since by a run that covered it, not a probe,
// and not explained by anybody. Declared once, for the reason the two fragments above are: the
// badge, the list it points at, the 360 page and the MCP tool must ask the same question.
//
// THE DAILY JOB DELIBERATELY ASKS A WIDER QUESTION, and it is not the same question at all
// (oldestOpenBreakRecordDate below, review finding F-BREAKSBOARD-07).
export const IT_IS_A_BREAK_TO_ACT_ON = `
  not ${A_LATER_RUN_RE_EXAMINED_IT}
  and not ${IT_IS_A_PROBE_FROM_A_CHECK_RUN}
  and not ${SOMEBODY_HAS_EXPLAINED_IT}
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

// Everything still to act on: reported as a break by some complete run, not re-examined since by
// a run that covered it, not a probe and not explained by anybody.
//
// STILL DELIBERATELY UNBOUNDED, and it is the callers that decide. The inbox, the MCP tool and
// the daily job ask this question because they must not miss a break, so the answer is complete
// by construction. The board asks `openBreaksPage` below, which bounds the read and says so on
// the page rather than dropping rows in silence (finding F-B10-07).
export async function openBreaks(database: postgres.Sql): Promise<ReconciliationBreakRow[]> {
  const rows = await database<BreakRowShape[]>`
    with latest_report as (${database.unsafe(LATEST_REPORT_OF_EACH_BREAK)})
    select ${database.unsafe(THE_COLUMNS_OF_A_BREAK_ROW)}
      from latest_report
     where ${database.unsafe(IT_IS_A_BREAK_TO_ACT_ON)}
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
  const rows = await database<(BreakRowShape & { open_count: number; open_breaks_named: string | null })[]>`
    with latest_report as (${database.unsafe(LATEST_REPORT_OF_EACH_BREAK)}),
         -- STILL BEING REPORTED, which here is deliberately wider than "a break to act on": a
         -- probe and an explained break are money that is still exactly where it was, so a
         -- resolved row sharing a reference with one of them is not resolved either. The
         -- question this list asks is about the money, not about the operator's queue.
         open_report as (
           select source, break_key, provider_ref, ledger_ref
             from latest_report
            where not ${database.unsafe(A_LATER_RUN_RE_EXAMINED_IT)}
         )
    select ${database.unsafe(THE_COLUMNS_OF_A_BREAK_ROW)},
           still_open.open_count,
           still_open.open_breaks_named
      from latest_report
      -- The open breaks of ANOTHER money movement that carry one of this row's references. They
      -- annotate the line; they never remove it.
      --
      -- ALL OF THEM, counted and named, and that is review finding F-LS-04: this used to take the
      -- first by key and say "ANOTHER BREAK", which sent the operator to one of two or three real
      -- open breaks and said nothing about the others. An aggregate with no limit always returns
      -- exactly one row, so open_count is 0 and open_breaks_named is null when there is none.
      left join lateral (
        select count(*)::int as open_count,
               string_agg(
                 open_report.break_key || ' carrying ' ||
                 coalesce(
                   case
                     when open_report.provider_ref is not null
                      and (open_report.provider_ref = latest_report.provider_ref
                           or open_report.provider_ref = latest_report.ledger_ref)
                     then open_report.provider_ref
                     else open_report.ledger_ref
                   end,
                   '(unnamed)'
                 ),
                 '; ' order by open_report.break_key
               ) as open_breaks_named
          from open_report
         where ${database.unsafe(SHARES_A_REFERENCE_WITH_THE_RESOLVED_ROW)}
           and not (${database.unsafe(IS_THE_SAME_MONEY_AS_THE_RESOLVED_ROW)})
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
    if (row.open_count === 0 || !row.open_breaks_named) {
      return resolved;
    }
    // Worded for THIS record: what stopped being reported is this one, and every break still open
    // on a reference it shares is named, so the reader is sent to all of them and not to one of
    // them (review finding F-LS-04).
    const heading =
      row.open_count === 1
        ? "ANOTHER BREAK ON THIS SOURCE IS STILL OPEN CARRYING THE SAME REFERENCE"
        : `${row.open_count} OTHER BREAKS ON THIS SOURCE ARE STILL OPEN CARRYING THE SAME REFERENCE`;
    return {
      ...resolved,
      note:
        `${resolved.note}; ${heading} (${row.open_breaks_named}), so this line says that THIS record ` +
        `stopped being reported, and nothing about the money behind ${row.open_count === 1 ? "that other break" : "those other breaks"}`,
    };
  });
}

// The oldest record date among the breaks STILL BEING REPORTED, of every source, or null when
// none is. The daily job asks this so its one window reaches back far enough to re-examine what
// is still open instead of leaving it unlooked at for ever (finding F-B10-01). One window for
// both sources, because the job runs them on the same window and the older of the two decides.
//
// WHY THIS QUESTION IS WIDER THAN IT_IS_A_BREAK_TO_ACT_ON, and it is review finding
// F-BREAKSBOARD-07. The two readers ask two different things:
//
//   the count, the badge, the inbox, the MCP tool and the board ask "what is on the operator's
//   desk today", so a probe and an explained break are correctly out of it;
//
//   the daily job asks "how far back must one run look", and the answer must include them,
//   because looking is exactly how an explained break stops being explained. A note explains one
//   report of a break (THE_NOTE_EXPLAINS_THE_LATEST_REPORT); the note stops matching only when a
//   LATER RUN reports the break differently, and no later run can report it at all once the
//   record falls outside the window. Narrowing this question froze every explained break older
//   than the seven-day default: the note went on matching for ever because nothing ever looked
//   again. A probe is included for the same mechanical reason, at no cost: it is money we planted
//   and re-comparing it changes nothing, while leaving it out would let the window snap shut on
//   the day the only rows left are probes and explained breaks.
//
// So the rule here is `not A_LATER_RUN_RE_EXAMINED_IT` alone, which is exactly the rule the
// `open_report` CTE of resolvedBreaks already uses, and for the reason written there: a probe and
// an explained break are money that is still exactly where it was.
export async function oldestOpenBreakRecordDate(database: postgres.Sql): Promise<Date | null> {
  // One aggregate, not every open row read back to take a minimum of it (finding F-B10-07).
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
  rows: OpenBreakRow[];
  totalOpen: number;
  capped: boolean; // totalOpen > rows.length: the screen must say so
};

// A note somebody wrote on this break that no longer explains it: the run now describes the break
// differently, so the note is superseded and the break is work again (review finding
// F-BREAKSBOARD-01). It is carried on the row so that the note does not simply disappear from the
// screen the moment it stops counting: the operator reads what was said, when, about which
// classification, and decides again.
//
// Only the open list needs this. A break to act on that carries a note carries no matching one,
// by the rule above, so the latest note of the break is the superseded one.
export type SupersededExplanation = {
  note: string;
  explainedByName: string;
  recordedAt: Date;
  explainedClassification: string | null; // null on a note written before migration 0025
};

export type OpenBreakRow = ReconciliationBreakRow & { supersededExplanation: SupersededExplanation | null };

export async function openBreaksPage(database: postgres.Sql, limit: number): Promise<OpenBreaksPage> {
  const [rows, totalOpen] = await Promise.all([
    database<
      (BreakRowShape & {
        superseded_note: string | null;
        superseded_by_name: string | null;
        superseded_recorded_at: Date | null;
        superseded_classification: string | null;
      })[]
    >`
      with latest_report as (${database.unsafe(LATEST_REPORT_OF_EACH_BREAK)})
      select ${database.unsafe(THE_COLUMNS_OF_A_BREAK_ROW)},
             superseded.note as superseded_note,
             superseded.explained_by_name as superseded_by_name,
             superseded.recorded_at as superseded_recorded_at,
             superseded.explained_classification as superseded_classification
        from latest_report
        -- A left join: most breaks to act on carry no note at all, and those that do keep their
        -- line unchanged with one sentence added.
        left join lateral (
          select note.note, note.recorded_at, note.explained_classification,
                 author.display_name as explained_by_name
            from reconciliation_break_notes note
            left join users author on author.id = note.explained_by
           where note.break_key = latest_report.break_key
           order by note.recorded_at desc
           limit 1
        ) superseded on true
       where ${database.unsafe(IT_IS_A_BREAK_TO_ACT_ON)}
       order by first_seen_at, source, break_key
       limit ${limit}
    `,
    countOpenBreaks(database),
  ]);
  return {
    rows: rows.map((row) => ({
      ...toBreakRow(row),
      supersededExplanation:
        row.superseded_note === null || row.superseded_recorded_at === null
          ? null
          : {
              note: row.superseded_note,
              explainedByName: row.superseded_by_name ?? "a user who no longer exists",
              recordedAt: row.superseded_recorded_at,
              explainedClassification: row.superseded_classification,
            },
    })),
    totalOpen,
    capped: totalOpen > rows.length,
  };
}

// The probes still being reported, for the board's own heading.
//
// Same shape and same bound as the page above, and the same reason for the bound: the check
// script plants one more probe on every run, so this list grows for ever by construction and a
// screen must never draw all of it while pretending it drew all of it.
//
// A probe an operator has ALSO written a note on is left out here and shown under the explained
// breaks with its note: the three lists of the board are disjoint, so no record is read twice.
export type ProbePage = {
  rows: ReconciliationBreakRow[];
  totalProbes: number;
  capped: boolean;
};

export async function probesPage(database: postgres.Sql, limit: number): Promise<ProbePage> {
  const [rows, [count]] = await Promise.all([
    database<BreakRowShape[]>`
      with latest_report as (${database.unsafe(LATEST_REPORT_OF_EACH_BREAK)})
      select ${database.unsafe(THE_COLUMNS_OF_A_BREAK_ROW)}
        from latest_report
       where not ${database.unsafe(A_LATER_RUN_RE_EXAMINED_IT)}
         and ${database.unsafe(IT_IS_A_PROBE_FROM_A_CHECK_RUN)}
         and not ${database.unsafe(SOMEBODY_HAS_EXPLAINED_IT)}
       order by first_seen_at, source, break_key
       limit ${limit}
    `,
    database<{ probes: number }[]>`
      with latest_report as (${database.unsafe(LATEST_REPORT_OF_EACH_BREAK)})
      select count(*)::int as probes
        from latest_report
       where not ${database.unsafe(A_LATER_RUN_RE_EXAMINED_IT)}
         and ${database.unsafe(IT_IS_A_PROBE_FROM_A_CHECK_RUN)}
         and not ${database.unsafe(SOMEBODY_HAS_EXPLAINED_IT)}
    `,
  ]);
  return { rows: rows.map(toBreakRow), totalProbes: count.probes, capped: count.probes > rows.length };
}

// A break somebody has explained: the row exactly as it was reported, plus the latest note
// written on it, who wrote it and when.
//
// The LATEST note, and the number of notes, because the table is append-only: a correction is a
// new note and the earlier ones stay on file. Nothing here says the break was repaired; it says
// a human has looked at it.
export type BreakExplanation = {
  note: string;
  explainedByName: string;
  recordedAt: Date;
  noteCount: number;
};

export type ExplainedBreakRow = ReconciliationBreakRow & { explanation: BreakExplanation };

export type ExplainedBreaksPage = {
  rows: ExplainedBreakRow[];
  totalExplained: number;
  capped: boolean;
};

export async function explainedBreaksPage(database: postgres.Sql, limit: number): Promise<ExplainedBreaksPage> {
  const [rows, [count]] = await Promise.all([
    database<(BreakRowShape & { note_text: string; explained_by_name: string | null; note_recorded_at: Date; note_count: number })[]>`
      with latest_report as (${database.unsafe(LATEST_REPORT_OF_EACH_BREAK)})
      select ${database.unsafe(THE_COLUMNS_OF_A_BREAK_ROW)},
             explanation.note as note_text,
             explanation.explained_by_name,
             explanation.recorded_at as note_recorded_at,
             explanation.note_count
        from latest_report
        -- The latest note THAT EXPLAINS THE BREAK AS IT STANDS, with the name of whoever wrote it
        -- and how many notes the break carries in all. An inner join, not a left join: a row
        -- without such a note is not an explained break and has no business in this list, and
        -- that is what keeps this list and the list to act on disjoint after a break has changed
        -- (review finding F-BREAKSBOARD-01). The count beside it uses the same rule.
        join lateral (
          select note.note, note.recorded_at, author.display_name as explained_by_name,
                 (select count(*)::int from reconciliation_break_notes all_notes
                   where all_notes.break_key = latest_report.break_key) as note_count
            from reconciliation_break_notes note
            left join users author on author.id = note.explained_by
           where note.break_key = latest_report.break_key
             and ${database.unsafe(THE_NOTE_EXPLAINS_THE_LATEST_REPORT)}
           order by note.recorded_at desc
           limit 1
        ) explanation on true
       where not ${database.unsafe(A_LATER_RUN_RE_EXAMINED_IT)}
       order by explanation.recorded_at desc
       limit ${limit}
    `,
    database<{ explained: number }[]>`
      with latest_report as (${database.unsafe(LATEST_REPORT_OF_EACH_BREAK)})
      select count(*)::int as explained
        from latest_report
       where not ${database.unsafe(A_LATER_RUN_RE_EXAMINED_IT)}
         and ${database.unsafe(SOMEBODY_HAS_EXPLAINED_IT)}
    `,
  ]);
  return {
    rows: rows.map((row) => ({
      ...toBreakRow(row),
      explanation: {
        note: row.note_text,
        // The author is read through a left join, so a note whose user row disappeared still
        // shows the note rather than the whole line vanishing.
        explainedByName: row.explained_by_name ?? "a user who no longer exists",
        recordedAt: row.note_recorded_at,
        noteCount: row.note_count,
      },
    })),
    totalExplained: count.explained,
    capped: count.explained > rows.length,
  };
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
     where ${database.unsafe(IT_IS_A_BREAK_TO_ACT_ON)}
  `;
  return row.open_breaks;
}

// The same count split by source, for the tiles of the breaks board. The board lists at most
// one page of breaks (openBreaksPage), so a tile that counted the rows drawn would understate a
// source as soon as the page was capped; this count reads the whole open set, with the same rule
// as the badge, and the page can say "of N" honestly.
export async function countOpenBreaksBySource(database: postgres.Sql): Promise<Record<string, number>> {
  const rows = await database<{ source: string; open_breaks: number }[]>`
    with latest_report as (${database.unsafe(LATEST_REPORT_OF_EACH_BREAK)})
    select source, count(*)::int as open_breaks
      from latest_report
     where ${database.unsafe(IT_IS_A_BREAK_TO_ACT_ON)}
     group by source
  `;
  const bySource: Record<string, number> = {};
  for (const row of rows) bySource[row.source] = row.open_breaks;
  return bySource;
}

// THE LATEST REPORT OF NAMED BREAKS, whatever state they are in: to act on, probe, or explained.
//
// Every reader above answers a screen's question ("what is still work", "what are the probes",
// "what has been explained"), so each of them filters. The MCP tool inspect_reference asks a
// different question: an operator hands it one reference and wants what reconciliation has to
// say about it, including the case where the answer is "a human explained this last Tuesday".
// Filtering would turn that into an empty list, which reads as "reconciliation never saw it".
//
// So this reader filters on the REFERENCES only, and returns the state as two flags plus the
// note, computed with the very fragments the screens use. Nothing here is a second definition of
// what an open break is.
//
// Bounded by `limit`, and the references are compared in SQL: the caller passes the break keys,
// the ledger references and the provider references of one object, never the whole system.
export type LatestBreakReport = ReconciliationBreakRow & {
  runId: string;
  isBreakToActOn: boolean;
  isProbeFromACheckRun: boolean;
  // The latest note that explains the break AS THE LATEST RUN DESCRIBES IT, or null when no note
  // does. A note written against an earlier description is deliberately not returned: it explains
  // a report that no longer stands (review finding F-BREAKSBOARD-01).
  explanation: { note: string; explainedByName: string; recordedAt: Date } | null;
};

export async function latestBreakReportsFor(
  database: postgres.Sql,
  references: { breakKeys: string[]; ledgerRefs: string[]; providerRefs: string[] },
  limit: number,
): Promise<LatestBreakReport[]> {
  const { breakKeys, ledgerRefs, providerRefs } = references;
  if (breakKeys.length === 0 && ledgerRefs.length === 0 && providerRefs.length === 0) {
    return [];
  }
  const rows = await database<
    (BreakRowShape & {
      run_id: string;
      is_break_to_act_on: boolean;
      is_probe: boolean;
      note_text: string | null;
      explained_by_name: string | null;
      note_recorded_at: Date | null;
    })[]
  >`
    with latest_report as (${database.unsafe(LATEST_REPORT_OF_EACH_BREAK)})
    select ${database.unsafe(THE_COLUMNS_OF_A_BREAK_ROW)},
           latest_report.run_id,
           (${database.unsafe(IT_IS_A_BREAK_TO_ACT_ON)}) as is_break_to_act_on,
           (${database.unsafe(IT_IS_A_PROBE_FROM_A_CHECK_RUN)}) as is_probe,
           explanation.note as note_text,
           explanation.explained_by_name,
           explanation.recorded_at as note_recorded_at
      from latest_report
      -- A left join: a break nobody has explained keeps its line with no note beside it.
      left join lateral (
        select note.note, note.recorded_at, author.display_name as explained_by_name
          from reconciliation_break_notes note
          left join users author on author.id = note.explained_by
         where note.break_key = latest_report.break_key
           and ${database.unsafe(THE_NOTE_EXPLAINS_THE_LATEST_REPORT)}
         order by note.recorded_at desc
         limit 1
      ) explanation on true
     where latest_report.break_key = any(${breakKeys}::text[])
        or latest_report.ledger_ref = any(${ledgerRefs}::text[])
        or latest_report.provider_ref = any(${providerRefs}::text[])
     order by latest_report.first_seen_at, latest_report.source, latest_report.break_key
     limit ${limit}
  `;
  return rows.map((row) => ({
    ...toBreakRow(row),
    runId: row.run_id,
    isBreakToActOn: row.is_break_to_act_on,
    isProbeFromACheckRun: row.is_probe,
    explanation:
      row.note_text === null || row.note_recorded_at === null
        ? null
        : {
            note: row.note_text,
            // Read through a left join, so a note whose user row disappeared still shows.
            explainedByName: row.explained_by_name ?? "a user who no longer exists",
            recordedAt: row.note_recorded_at,
          },
  }));
}
