import type postgres from "postgres";
import { sql } from "@/db/client";
import { breakKey, type Classification, type ReconciliationSourceName } from "./breaks";
import { claimsRailSourceOn } from "./claims-rail-source";
import { countByClassification, diffProviderAgainstLedger, type DiffItem } from "./diff";
import type { ReconciliationSource } from "./source";
import { stripeSource } from "./stripe-source";
import type { ReconciliationWindow } from "./window";

// One reconciliation run: one source, one window.
//
// The order of the three steps is the whole safety argument:
//
//   1. ASK THE PROVIDER FIRST, and read the ledger, before anything is written. Both reads are
//      inside one try. Anything that goes wrong there (Stripe is down, the key is wrong, the
//      listing was cut short, a query failed) stores a FAILED run carrying the message and NO
//      items. A failed run can therefore never be read as "zero breaks", which is the rule the
//      brief states outright and the reason this function has no other error path.
//   2. COMPARE, purely. The diff is a function of two lists, a clock and a threshold.
//   3. STORE the run and its items in ONE transaction, so a run summary never exists without
//      the items it counted, and the items never exist without their run.
//
// The job never writes to the ledger and never touches a money row. It only appends to its own
// two tables, which are append-only too: a break that was reported stays reported, even after it
// is fixed, and "resolved" is read from a later run that no longer reports it.

export type ReconciliationRunSummary = {
  runId: string;
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
      breakKey: breakKey(input.source.name, item.classification, item.providerRef, item.ledgerRef),
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
        // The age of a break is measured from the FIRST run that reported it, so an item copies
        // the earliest instant already on file for its key and falls back to this run's own
        // finishing time when the key is new.
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

// The earliest instant each of these break keys was ever reported at. Read inside the storing
// transaction so two runs finishing at the same moment cannot each decide they are the first.
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
export async function runAllSources(
  input: { window: ReconciliationWindow; runByUserId: string | null; now: Date },
  database: postgres.Sql = sql,
): Promise<ReconciliationRunSummary[]> {
  const sources: ReconciliationSource[] = [stripeSource, claimsRailSourceOn(database)];
  const summaries: ReconciliationRunSummary[] = [];
  for (const source of sources) {
    summaries.push(await runReconciliation({ ...input, source }, database));
  }
  return summaries;
}

// How many items of a run are breaks, that is everything that is not matched.
export function breakCount(summary: ReconciliationRunSummary): number {
  return (
    summary.counts.local_only + summary.counts.provider_only + summary.counts.amount_mismatch + summary.counts.stale
  );
}
