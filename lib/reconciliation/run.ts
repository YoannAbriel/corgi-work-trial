import type postgres from "postgres";
import { sql } from "@/db/client";
import { breakKey, type Classification, type ReconciliationSourceName } from "./breaks";
import { claimsRailSourceOn } from "./claims-rail-source";
import { countByClassification, diffProviderAgainstLedger, type DiffItem } from "./diff";
import type { ReconciliationSource } from "./source";
import { stripeSource } from "./stripe-source";
import { oldestOpenBreakRecordDate } from "./read";
import { defaultWindow, MAX_WINDOW_DAYS, type ReconciliationWindow } from "./window";

// One reconciliation run: one source, one window.
//
// The order of the three steps is the whole safety argument:
//
//   1. ASK THE PROVIDER FIRST, and read the ledger, before anything is written. Anything that
//      goes wrong there (Stripe is down, the key is wrong, the listing was cut short, a query
//      failed) stores a FAILED run carrying the message and NO items. A failed run can therefore
//      never be read as "zero breaks", which is the rule the brief states outright. The storing
//      step below is inside a try of its own for the same reason (finding F-B10-04).
//   2. COMPARE, purely. The diff is a function of two lists, a clock and a threshold.
//   3. STORE the run and its items in ONE transaction, so a run summary never exists without
//      the items it counted, and the items never exist without their run.
//
// The job never writes to the ledger and never touches a money row. It only appends to its own
// two tables, which are append-only too: a break that was reported stays reported, even after it
// is fixed, and "resolved" is read from a later run that no longer reports it.

export type ReconciliationRunSummary = {
  // Null in one case only: the run failed AND storing the failed run failed too (the database is
  // unreachable). The summary still says which source and why, so the caller reports something
  // rather than nothing (review finding F-B10-04).
  runId: string | null;
  source: ReconciliationSourceName;
  window: ReconciliationWindow;
  status: "complete" | "failed";
  fetchError: string | null;
  counts: Record<Classification, number>;
  providerRecordCount: number;
  ledgerRecordCount: number;
  note: string;
  finishedAt: Date;
};

export type ReconciliationRunInput = {
  source: ReconciliationSource;
  window: ReconciliationWindow;
  // The staff member who pressed "Run now"; null when the daily cron ran it.
  runByUserId: string | null;
  // The clock the staleness rule uses. An argument, not Date.now() inside the diff, so a check
  // script can prove the rule without waiting a day.
  now: Date;
};

export async function runReconciliation(
  input: ReconciliationRunInput,
  database: postgres.Sql = sql,
): Promise<ReconciliationRunSummary> {
  const startedAt = new Date();

  let providerRecords;
  let ledgerRecords;
  let providerNote: string;
  try {
    const fetched = await input.source.fetch(input.window);
    providerRecords = fetched.records;
    providerNote = fetched.note;
    ledgerRecords = await input.source.readLedger(input.window, database);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return storeFailedRun(input, startedAt, message.slice(0, 1000), database);
  }

  const items = diffProviderAgainstLedger({
    provider: providerRecords,
    ledger: ledgerRecords,
    now: input.now,
    staleAfterHours: input.source.staleAfterHours,
  });
  const counts = countByClassification(items);

  // The storage is inside a try too (review finding F-B10-04). The comment above promised that
  // anything going wrong stores a failed run; it only held for the two reads. A key that cannot
  // be built or an insert that fails now also leaves a failed run behind, rather than nothing.
  try {
    return await storeCompleteRun(input, startedAt, providerRecords, ledgerRecords, providerNote, items, counts, database);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return storeFailedRun(input, startedAt, `the comparison could not be stored: ${message.slice(0, 900)}`, database);
  }
}

async function storeCompleteRun(
  input: ReconciliationRunInput,
  startedAt: Date,
  providerRecords: { length: number },
  ledgerRecords: { length: number },
  providerNote: string,
  items: DiffItem[],
  counts: Record<Classification, number>,
  database: postgres.Sql,
): Promise<ReconciliationRunSummary> {
  return database.begin(async (transaction) => {
    const [run] = await transaction<{ id: string; finished_at: Date }[]>`
      insert into reconciliation_runs (
        source, window_from, window_to, started_at, status, note, run_by,
        matched_count, local_only_count, provider_only_count, amount_mismatch_count, stale_count,
        provider_record_count, ledger_record_count
      ) values (
        ${input.source.name}, ${input.window.from}, ${input.window.to}, ${startedAt}, 'complete',
        ${providerNote}, ${input.runByUserId},
        ${counts.matched}, ${counts.local_only}, ${counts.provider_only}, ${counts.amount_mismatch},
        ${counts.stale}, ${providerRecords.length}, ${ledgerRecords.length}
      )
      returning id, finished_at
    `;

    const keyedItems = items.map((item) => ({
      ...item,
      breakKey: breakKey(input.source.name, item.providerRef, item.ledgerRef),
    }));
    const firstSeen = await firstSeenByBreakKey(transaction, keyedItems.map((item) => item.breakKey));

    if (keyedItems.length > 0) {
      // One statement for all the items of the run: postgres.js expands the array of objects
      // into a multi-row INSERT with exactly these columns, in this order.
      const rows = keyedItems.map((item) => ({
        run_id: run.id,
        classification: item.classification,
        break_key: item.breakKey,
        provider_ref: item.providerRef,
        ledger_ref: item.ledgerRef,
        provider_amount_cents: item.providerAmountCents,
        ledger_amount_cents: item.ledgerAmountCents,
        difference_cents: item.differenceCents,
        // When the compared record belongs, so a later run can say whether it re-examined this
        // break or simply did not look at it (review finding F-B10-01).
        record_at: item.recordAt,
        // The age of a break is measured from the FIRST run that reported it AS A BREAK, so an
        // item copies the earliest instant already on file for its key and falls back to this
        // run's own finishing time when no earlier run reported this key as anything but matched.
        first_seen_at: firstSeen.get(item.breakKey) ?? run.finished_at,
        note: item.note,
      }));
      await transaction`
        insert into reconciliation_items ${transaction(
          rows,
          "run_id",
          "classification",
          "break_key",
          "provider_ref",
          "ledger_ref",
          "provider_amount_cents",
          "ledger_amount_cents",
          "difference_cents",
          "record_at",
          "first_seen_at",
          "note",
        )}
      `;
    }

    return {
      runId: run.id,
      source: input.source.name,
      window: input.window,
      status: "complete" as const,
      fetchError: null,
      counts,
      providerRecordCount: providerRecords.length,
      ledgerRecordCount: ledgerRecords.length,
      note: providerNote,
      finishedAt: run.finished_at,
    };
  });
}

// The earliest instant each of these keys was ever reported AS A BREAK, which is what makes the
// age of a break the time since it first appeared rather than since the latest run.
//
// Only non-matched items count. Since the key no longer carries the classification (finding
// F-B10-02), a key that has always agreed also has items on file, and copying their instant would
// date a brand new break from the first time the money was ever compared.
//
// One consequence, stated rather than hidden: a break that was genuinely resolved and comes back
// months later inherits the old instant and reads as older than it is. That errs towards showing
// a break as older, never younger, which is the safe direction for the one screen whose job is to
// stop things being forgotten.
//
// Read inside the storing transaction, so the lookup and the insert see one state. It is NOT a
// lock: two runs of the same source committing at the same instant could each believe it is the
// first to see a key, and the age would then be off by the distance between those two runs. That
// is seconds, the daily job runs one source at a time, and the alternative would be locking a
// table the rest of the application never touches.
async function firstSeenByBreakKey(
  transaction: postgres.TransactionSql,
  keys: string[],
): Promise<Map<string, Date>> {
  if (keys.length === 0) {
    return new Map();
  }
  const rows = await transaction<{ break_key: string; first_seen_at: Date }[]>`
    select break_key, min(first_seen_at) as first_seen_at
      from reconciliation_items
     where break_key = any(${keys})
       and classification <> 'matched'
     group by break_key
  `;
  return new Map(rows.map((row) => [row.break_key, row.first_seen_at]));
}

// A run that could not read one of its two sides. It carries the message and no items at all.
async function storeFailedRun(
  input: ReconciliationRunInput,
  startedAt: Date,
  fetchError: string,
  database: postgres.Sql,
): Promise<ReconciliationRunSummary> {
  const [run] = await database<{ id: string; finished_at: Date }[]>`
    insert into reconciliation_runs (source, window_from, window_to, started_at, status, fetch_error, run_by)
    values (${input.source.name}, ${input.window.from}, ${input.window.to}, ${startedAt}, 'failed',
            ${fetchError}, ${input.runByUserId})
    returning id, finished_at
  `;
  return {
    runId: run.id,
    source: input.source.name,
    window: input.window,
    status: "failed",
    fetchError,
    counts: { matched: 0, local_only: 0, provider_only: 0, amount_mismatch: 0, stale: 0 },
    providerRecordCount: 0,
    ledgerRecordCount: 0,
    note: "",
    finishedAt: run.finished_at,
  };
}

// Both sources, in sequence, on the same window. Sequential and not in parallel on purpose: a
// Stripe listing failing must not cancel the rail comparison, and each run is stored on its own.
//
// The try is the last net (finding F-B10-04): runReconciliation already turns every failure into a
// stored failed run, so the only way to land here is a database that cannot even accept that row.
// The loop still moves on to the next source, and the caller is told which one could not be
// recorded at all rather than being handed a shorter list with no explanation.
export async function runAllSources(
  input: { window: ReconciliationWindow; runByUserId: string | null; now: Date },
  database: postgres.Sql = sql,
): Promise<ReconciliationRunSummary[]> {
  return runSources([stripeSource, claimsRailSourceOn(database)], input, database);
}

// The loop, taking the sources as an argument, so scripts/check-reconciliation.ts can prove the
// guarantee above with a source built to fail instead of waiting for Stripe to have a bad day.
export async function runSources(
  sources: ReconciliationSource[],
  input: { window: ReconciliationWindow; runByUserId: string | null; now: Date },
  database: postgres.Sql = sql,
): Promise<ReconciliationRunSummary[]> {
  const summaries: ReconciliationRunSummary[] = [];
  for (const source of sources) {
    try {
      summaries.push(await runReconciliation({ ...input, source }, database));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summaries.push(unstorableRun(source.name, input.window, `nothing could be stored for this source: ${message.slice(0, 900)}`));
    }
  }
  return summaries;
}

// A run that left no trace in the database, because the database itself is the thing that failed.
function unstorableRun(
  source: ReconciliationSourceName,
  window: ReconciliationWindow,
  fetchError: string,
): ReconciliationRunSummary {
  return {
    runId: null,
    source,
    window,
    status: "failed",
    fetchError,
    counts: { matched: 0, local_only: 0, provider_only: 0, amount_mismatch: 0, stale: 0 },
    providerRecordCount: 0,
    ledgerRecordCount: 0,
    note: "",
    finishedAt: new Date(),
  };
}

// The window the scheduled job should use: the default seven days, opened backwards far enough to
// cover the oldest break that is still open (review finding F-B10-01).
//
// Without this, a break can never resolve itself: the new rule only lets a run close a break whose
// record date it actually covered, and a fixed seven-day window stops covering a break the moment
// it turns eight days old. With it, the ordinary case closes on its own on the next nightly run.
//
// THE CAP AND WHAT HAPPENS BEYOND IT. A run may not cover more than MAX_WINDOW_DAYS (31), because
// the Stripe listing is paginated and a year of records would not finish inside a serverless
// function. A break whose record is older than that is NOT covered, so it is not resolved either:
// it stays on the open list with its real age, which is the honest outcome. `widenedToCoverDays`
// on the returned value says how far back the job actually reached, and `oldestOpenBreakAt` says
// what it could not reach, so the answer of the job states the gap instead of hiding it. Closing
// such a break needs a staff run with an explicit window on the screen, which is a deliberate
// human act on a break that has been open for a month.
export type ScheduledWindow = {
  window: ReconciliationWindow;
  oldestOpenBreakAt: Date | null;
  reachesTheOldestOpenBreak: boolean;
};

export async function windowCoveringOpenBreaks(now: Date, database: postgres.Sql = sql): Promise<ScheduledWindow> {
  const standard = defaultWindow(now);
  const oldestOpenBreakAt = await oldestOpenBreakRecordDate(database);
  if (oldestOpenBreakAt === null || oldestOpenBreakAt >= standard.from) {
    return { window: standard, oldestOpenBreakAt, reachesTheOldestOpenBreak: true };
  }

  const earliestAllowed = new Date(standard.to.getTime() - MAX_WINDOW_DAYS * 24 * 3600 * 1000);
  const from = oldestOpenBreakAt < earliestAllowed ? earliestAllowed : oldestOpenBreakAt;
  return {
    window: { from, to: standard.to },
    oldestOpenBreakAt,
    reachesTheOldestOpenBreak: from <= oldestOpenBreakAt,
  };
}

// How many items of a run are breaks, that is everything that is not matched.
export function breakCount(summary: ReconciliationRunSummary): number {
  return (
    summary.counts.local_only + summary.counts.provider_only + summary.counts.amount_mismatch + summary.counts.stale
  );
}
