import { PortalShell } from "@/components/portal-shell";
import { Disclosure, SandboxReferences } from "@/components/disclosures";
import { redirect } from "next/navigation";
import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { describeAge } from "@/lib/reconciliation/breaks";
import { CLAIMS_RAIL_STALE_AFTER_HOURS } from "@/lib/reconciliation/claims-rail-source";
import {
  CLEARING_ACCOUNT_MEANING,
  nonZeroClearingBalances,
  type ClearingBalanceRow,
} from "@/lib/reconciliation/clearing-balances";
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

  // The four reads and the query string, together: the page renders once, with everything.
  const [runs, breaks, resolved, clearingBalances, query] = await Promise.all([
    recentRuns(sql, HOW_MANY_RUNS_SHOWN),
    openBreaks(sql),
    resolvedBreaks(sql, HOW_MANY_RESOLVED_SHOWN),
    nonZeroClearingBalances(sql),
    searchParams,
  ]);
  const now = new Date();
  // The banner is about the LATEST run of each source, not about any failed run in the list
  // (review finding F-B10-05): a source that failed at noon and completed twice since is not
  // failing. `runs` arrives newest first, so the first row of a source is its latest run.
  const sourcesWhoseLatestRunFailed = runs.filter(
    (run) => run.status === "failed" && runs.find((other) => other.source === run.source) === run,
  );

  return (
    <PortalShell user={user} active="reconciliation">

      <h1>Reconciliation</h1>
      <p className="lead">
        Every run pulls a provider&apos;s own records for a time window, reads what our ledger says about the same money,
        and stores the comparison. Signed in as {user.displayName} ({user.role}). All times are UTC.
      </p>

      {/* The two integration labels stay on the page, never behind a disclosure: what is live and
          what is simulated is the first thing a reader has to know (AF-02). The detail of each
          one is in "how to read this" below. */}
      <p className="note">
        Two sources: <strong>Stripe (LIVE SANDBOX)</strong> and the{" "}
        <strong>claim payout rail (LOCAL SIMULATOR)</strong>.
      </p>

      <Disclosure>
        <p>
          Two sources: <strong>Stripe</strong> (LIVE SANDBOX: PaymentIntents, Refunds and BalanceTransactions listed
          through the API) and the <strong>claim payout rail</strong> (LOCAL SIMULATOR: the rail keeps its own
          provider-side records, written by the simulator and never by the ledger code, so a mismatch planted there is
          found the same way a Stripe one is). Stripe processing fees are not journaled in this build, so a matched
          payment notes the fee as information only.
        </p>
        <p>
          Nothing on this page repairs a break, and there is deliberately no button that could. A break is repaired by
          doing the real thing (replaying a webhook, running the settlement job, opening a correction), and the next
          run stops reporting it. That is why resolved breaks are still listed: they were never deleted, they simply
          stopped being found.
        </p>
      </Disclosure>

      {query.error ? <p className="error" role="alert">{query.error}</p> : null}
      {query.ran ? <p className="note">Run finished: {query.ran}</p> : null}

      {/* A failed latest run is called out above everything else: it found nothing because it
          could not look, and reading its zero as "clean" is the exact mistake the brief forbids. */}
      {sourcesWhoseLatestRunFailed.map((run) => (
        <p className="error" key={run.runId}>
          The most recent {SOURCE_LABEL[run.source] ?? run.source} run FAILED at {utc(run.finishedAt)} and compared
          nothing: {run.fetchError}. Nothing below has been re-examined for that source since.
        </p>
      ))}

      <Disclosure title="Run a reconciliation now" open>
        <p>
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
      </Disclosure>

      <h2>Open breaks</h2>
      <Disclosure title="What counts as open">
        <p>
          Everything a completed run reported as anything but matched and that no later run has explained. A break
          leaves this list only when a later completed run of the same source, <strong>whose window covers the date of
          the record</strong>, no longer reports it: a break nobody has looked at again stays here, however old it
          gets. The age is counted from the first run that ever reported it as a break. Staleness thresholds are
          assumptions of this build: {STRIPE_STALE_AFTER_HOURS} hours at Stripe, {CLAIMS_RAIL_STALE_AFTER_HOURS} hours
          on the simulated rail.
        </p>
      </Disclosure>
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
        <div className="table-scroll" role="region" aria-label="Reconciliation table 1" tabIndex={0}>
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
</div>
      )}

      <h2>Clearing balances that have not returned to zero</h2>
      <Disclosure title="Why this list exists">
        <p>
          Read straight from the journal, with no window at all, so nothing here can be missed for being old. These
          four accounts hold money on its way somewhere and must end at zero; a balance that is still open is a flow
          that has not finished, and one that is weeks old is an operations case. This list is the second net under the
          break list above: it does not depend on any provider answering, or on any run having compared anything.
        </p>
      </Disclosure>
      {clearingBalances.length === 0 ? (
        <p className="note">Every clearing account is at zero: no premium billed and uncollected, no refund owed and
        unpaid, no claim payment in flight, no customer money waiting to be applied.</p>
      ) : (
        <div className="table-scroll" role="region" aria-label="Reconciliation table 2" tabIndex={0}>
<table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Policy or claim</th>
              <th className="amount">Still open</th>
              <th>Oldest entry (UTC)</th>
              <th>Open for</th>
            </tr>
          </thead>
          <tbody>
            {clearingBalances.map((balance) => (
              <ClearingRow key={`${balance.accountId}-${balance.policyId}-${balance.claimId}`} balance={balance} now={now} />
            ))}
          </tbody>
        </table>
</div>
      )}

      <h2>Breaks that went away</h2>
      <Disclosure title="What resolved them">
        <p>
          Reported by an earlier run, and looked at again since by a completed run of the same source whose window
          covered the record, which no longer reports it. Nothing was deleted: the items of every run are still on
          file, which is how a break can be shown as resolved rather than vanish.
        </p>
      </Disclosure>
      {resolved.length === 0 ? (
        <p className="note">No break has been resolved yet.</p>
      ) : (
        <BreakTable rows={resolved} now={now} ageColumn="Was open for" />
      )}
    </PortalShell>
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
            {breaks === 0 ? "no break" : breaks === 1 ? "1 break" : `${breaks} breaks`} ({run.counts.matched} matched,{" "}
            {run.counts.local_only} local only, {run.counts.provider_only} provider only, {run.counts.amount_mismatch}{" "}
            amount mismatch, {run.counts.stale} stale)
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

function ClearingRow({ balance, now }: { balance: ClearingBalanceRow; now: Date }) {
  return (
    <tr>
      <td>
        {balance.accountName}
        <br />
        <span className="note">{CLEARING_ACCOUNT_MEANING[balance.accountId]}</span>
      </td>
      <td>{balance.policyNumber ?? balance.claimNumber ?? <span className="note">no policy or claim on the entry</span>}</td>
      <td className="amount">{formatCentsAsUsd(balance.openCents)}</td>
      <td>{utc(balance.oldestEntryAt)}</td>
      <td>{describeAge(balance.oldestEntryAt, now)}</td>
    </tr>
  );
}

function BreakTable({ rows, now, ageColumn }: { rows: ReconciliationBreakRow[]; now: Date; ageColumn: string }) {
  return (
    <div className="table-scroll" role="region" aria-label="Reconciliation table 3" tabIndex={0}>
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
              {/* The provider reference stays visible: it is the identity of the break and what an
                  operator types into the provider's own console. The internal operation uuid and
                  the key the runs file it under are evidence, so they go behind the affordance. */}
              <code>{row.providerRef ?? "no provider reference"}</code>
              <SandboxReferences
                references={[
                  { label: "Provider reference", value: row.providerRef },
                  { label: "Ledger operation id", value: row.ledgerRef },
                  { label: "Break key", value: row.breakKey },
                ]}
              />
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
</div>
  );
}

// A missing amount is a side that has no record at all, which is not the same as zero.
function money(amountCents: number | null) {
  return amountCents === null ? <span className="note">no record</span> : formatCentsAsUsd(amountCents);
}

function utc(instant: Date): string {
  return instant.toISOString().replace("T", " ").slice(0, 19);
}
