import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { describeAge } from "@/lib/reconciliation/breaks";
import { CLAIMS_RAIL_STALE_AFTER_HOURS } from "@/lib/reconciliation/claims-rail-source";
import { openBreaks, recentRuns, resolvedBreaks, type ReconciliationBreakRow, type ReconciliationRunRow } from "@/lib/reconciliation/read";
import { STRIPE_STALE_AFTER_HOURS } from "@/lib/reconciliation/stripe-source";
import { DEFAULT_WINDOW_DAYS } from "@/lib/reconciliation/window";

// /ops/reconciliation: what the provider says, what the ledger says, and everything that does
// not agree.
//
// Staff only. Everything on this page is read from two append-only tables: nothing here fixes a
// break, and there is deliberately no button that could. A break is repaired by doing the real
// thing (replaying a webhook, running the settlement job, opening a correction), and the next run
// stops reporting it. That is why the page also lists breaks that were resolved: they were never
// deleted, they simply stopped being found.

const HOW_MANY_RUNS_SHOWN = 12;
const HOW_MANY_RESOLVED_SHOWN = 20;

const SOURCE_LABEL: Record<string, string> = {
  stripe: "Stripe (LIVE SANDBOX)",
  claims_rail: "Claim payout rail (LOCAL SIMULATOR)",
};

// What each classification means, in one line, on the screen rather than in a document nobody
// opens while an incident is running.
const CLASSIFICATION_MEANING: Record<string, string> = {
  local_only: "the ledger booked cash the provider shows no record of",
  provider_only: "the provider moved money the ledger has no cash entry for",
  amount_mismatch: "both sides moved money on the same operation, for different amounts",
  stale: "money out promised long ago and still not confirmed either way",
  matched: "both sides agree",
};

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ran?: string }>;
}) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "staff_ops" && user.role !== "staff_approver") {
    redirect("/broker");
  }

  // The three reads and the query string, together: the page renders once, with everything.
  const [runs, breaks, resolved, query] = await Promise.all([
    recentRuns(sql, HOW_MANY_RUNS_SHOWN),
    openBreaks(sql),
    resolvedBreaks(sql, HOW_MANY_RESOLVED_SHOWN),
    searchParams,
  ]);
  const now = new Date();
  const lastFailedRun = runs.find((run) => run.status === "failed");

  return (
    <main>
      <p className="note">
        <Link href="/ops">Operations</Link>
      </p>

      <h1>Reconciliation</h1>
      <p className="lead">
        Every run pulls a provider&apos;s own records for a time window, reads what our ledger says about the same money,
        and stores the comparison. Signed in as {user.displayName} ({user.role}). All times are UTC.
      </p>
      <p className="note">
        Two sources: <strong>Stripe</strong> (LIVE SANDBOX: PaymentIntents, Refunds and BalanceTransactions listed
        through the API) and the <strong>claim payout rail</strong> (LOCAL SIMULATOR: the rail keeps its own
        provider-side records, written by the simulator and never by the ledger code, so a mismatch planted there is
        found the same way a Stripe one is). Stripe processing fees are not journaled in this build, so a matched
        payment notes the fee as information only.
      </p>

      {query.error ? <p className="error">{query.error}</p> : null}
      {query.ran ? <p className="note">Run finished: {query.ran}</p> : null}

      {/* A failed run is called out above everything else: it found nothing because it could not
          look, and reading its zero as "clean" is the exact mistake the brief forbids. */}
      {lastFailedRun ? (
        <p className="error">
          The most recent {SOURCE_LABEL[lastFailedRun.source] ?? lastFailedRun.source} run FAILED at{" "}
          {utc(lastFailedRun.finishedAt)} and compared nothing: {lastFailedRun.fetchError}. The breaks below are what the
          last run that actually completed found, not a fresh answer.
        </p>
      ) : null}

      <section className="card-block">
        <h2>Run now</h2>
        <p className="note">
          Both sources, one after the other. The window defaults to the last {DEFAULT_WINDOW_DAYS} days, which is long
          enough that a webhook delayed by a day is still inside the next run&apos;s window. Running an overlapping
          window again is harmless: each run stores its own items and a break is identified across runs by its key.
        </p>
        <form method="post" action="/api/jobs/reconcile" className="card">
          <label htmlFor="from">From (UTC date or instant, optional)</label>
          <input id="from" name="from" type="text" placeholder="2026-09-01" />
          <label htmlFor="to">To (UTC date or instant, optional)</label>
          <input id="to" name="to" type="text" placeholder="2026-09-08" />
          <button type="submit">Reconcile both sources</button>
        </form>
      </section>

      <h2>Open breaks</h2>
      <p className="note">
        Everything the latest completed run of each source reported as anything but matched. The age is counted from the
        first run that ever reported the same break, not from the latest one. Staleness thresholds are assumptions of
        this build: {STRIPE_STALE_AFTER_HOURS} hours at Stripe, {CLAIMS_RAIL_STALE_AFTER_HOURS} hours on the simulated
        rail.
      </p>
      {runs.length === 0 ? (
        <p className="note">No reconciliation has ever run. Press &ldquo;Reconcile both sources&rdquo; above.</p>
      ) : breaks.length === 0 ? (
        <p className="note">
          No open break. The latest completed run of each source compared{" "}
          {runs
            .filter((run) => run.status === "complete")
            .slice(0, 2)
            .map((run) => `${run.providerRecordCount} provider records for ${run.source}`)
            .join(" and ")}{" "}
          and found every one of them in the ledger.
        </p>
      ) : (
        <BreakTable rows={breaks} now={now} ageColumn="Open for" />
      )}

      <h2>Runs</h2>
      {runs.length === 0 ? (
        <p className="note">Nothing has run yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Finished (UTC)</th>
              <th>Source</th>
              <th>Status</th>
              <th>Window (UTC)</th>
              <th>Compared</th>
              <th>Result</th>
              <th>Run by</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <RunRow key={run.runId} run={run} />
            ))}
          </tbody>
        </table>
      )}

      <h2>Breaks that went away</h2>
      <p className="note">
        Reported by an earlier run and absent from the latest completed run of that source. Nothing was deleted: the
        items of every run are still on file, which is how a break can be shown as resolved rather than vanish.
      </p>
      {resolved.length === 0 ? (
        <p className="note">No break has been resolved yet.</p>
      ) : (
        <BreakTable rows={resolved} now={now} ageColumn="Was open for" />
      )}
    </main>
  );
}

function RunRow({ run }: { run: ReconciliationRunRow }) {
  const breaks = run.counts.local_only + run.counts.provider_only + run.counts.amount_mismatch + run.counts.stale;
  return (
    <tr>
      <td>{utc(run.finishedAt)}</td>
      <td>{SOURCE_LABEL[run.source] ?? run.source}</td>
      <td>
        <span className={`badge ${run.status === "complete" ? "badge-ok" : "badge-warn"}`}>{run.status}</span>
      </td>
      <td>
        {utc(run.windowFrom)}
        <br />
        {utc(run.windowTo)}
      </td>
      <td>
        {run.status === "failed" ? (
          <span className="note">nothing: the run never got its records</span>
        ) : (
          <>
            {run.providerRecordCount} provider
            <br />
            {run.ledgerRecordCount} ledger
          </>
        )}
      </td>
      <td>
        {run.status === "failed" ? (
          /* Never "0 breaks": a failed run has no result at all, only a reason. */
          <span className="note">FAILED, no comparison was made: {run.fetchError}</span>
        ) : (
          <>
            {breaks === 0 ? "no break" : `${breaks} breaks`} ({run.counts.matched} matched, {run.counts.local_only} local
            only, {run.counts.provider_only} provider only, {run.counts.amount_mismatch} amount mismatch,{" "}
            {run.counts.stale} stale)
            {run.note ? (
              <>
                <br />
                <span className="note">{run.note}</span>
              </>
            ) : null}
          </>
        )}
      </td>
      <td>{run.runByName ?? <span className="note">scheduled job</span>}</td>
    </tr>
  );
}

function BreakTable({ rows, now, ageColumn }: { rows: ReconciliationBreakRow[]; now: Date; ageColumn: string }) {
  return (
    <table className="ledger">
      <thead>
        <tr>
          <th>Reference</th>
          <th>Source</th>
          <th>Classification</th>
          <th className="amount">Provider</th>
          <th className="amount">Ledger</th>
          <th className="amount">Difference</th>
          <th>First seen (UTC)</th>
          <th>{ageColumn}</th>
          <th>What it means</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.breakKey}-${row.lastReportedAt.toISOString()}`}>
            <td>
              {row.providerRef ?? <span className="note">no provider reference</span>}
              <br />
              <span className="note">{row.ledgerRef ? `operation ${row.ledgerRef}` : "no ledger operation"}</span>
            </td>
            <td>{SOURCE_LABEL[row.source] ?? row.source}</td>
            <td>
              <span className="badge badge-warn">{row.classification.replace(/_/g, " ")}</span>
              <br />
              <span className="note">{CLASSIFICATION_MEANING[row.classification]}</span>
            </td>
            <td className="amount">{money(row.providerAmountCents)}</td>
            <td className="amount">{money(row.ledgerAmountCents)}</td>
            <td className="amount">{money(row.differenceCents)}</td>
            <td>{utc(row.firstSeenAt)}</td>
            <td>{describeAge(row.firstSeenAt, now)}</td>
            <td>{row.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// A missing amount is a side that has no record at all, which is not the same as zero.
function money(amountCents: number | null) {
  return amountCents === null ? <span className="note">no record</span> : formatCentsAsUsd(amountCents);
}

function utc(instant: Date): string {
  return instant.toISOString().replace("T", " ").slice(0, 19);
}
