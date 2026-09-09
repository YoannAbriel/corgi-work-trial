import "@/app/styles/ops-tables.css";
import { PortalShell } from "@/components/portal-shell";
import { Disclosure, SandboxReferences } from "@/components/disclosures";
import { Chip, DetailGrid, DetailHeading, Empty, Panel } from "@/components/detail-layout";
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
import { NOTE_MAXIMUM_CHARACTERS, NOTE_MINIMUM_CHARACTERS } from "@/lib/reconciliation/break-notes";
import {
  explainedBreaksPage,
  openBreaksPage,
  probesPage,
  recentRuns,
  resolvedBreaks,
  type ExplainedBreakRow,
  type ReconciliationBreakRow,
  type ReconciliationRunRow,
} from "@/lib/reconciliation/read";
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
// The three break lists are read a page at a time and say so when the page is not the whole list
// (review finding F-LS-01). The probe list is the one that grows on its own: every run of
// scripts/check-reconciliation.ts plants one more.
const HOW_MANY_BREAKS_SHOWN = 50;
const HOW_MANY_PROBES_SHOWN = 50;
const HOW_MANY_EXPLAINED_SHOWN = 50;

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
  probe: "a payment one of our own check runs planted at the provider; no ledger entry is expected for it",
  matched: "both sides agree",
};

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ran?: string; explained?: string }>;
}) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "staff_ops" && user.role !== "staff_approver") {
    redirect("/broker");
  }

  // The six reads and the query string, together: the page renders once, with everything.
  //
  // The three break lists are disjoint by construction (lib/reconciliation/read.ts): a break to
  // act on carries no note and is not a probe, a probe carries no note, and an explained break is
  // any break carrying one. So a record appears on this page exactly once.
  const [runs, breaks, probes, explained, resolved, clearingBalances, query] = await Promise.all([
    recentRuns(sql, HOW_MANY_RUNS_SHOWN),
    openBreaksPage(sql, HOW_MANY_BREAKS_SHOWN),
    probesPage(sql, HOW_MANY_PROBES_SHOWN),
    explainedBreaksPage(sql, HOW_MANY_EXPLAINED_SHOWN),
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

  const latestComplete = runs.filter((run) => run.status === "complete").slice(0, 2);
  const notices = [
    query.error ? <p key="error" className="error" role="alert">{query.error}</p> : null,
    query.ran ? <p key="ran" className="note">Run finished: {query.ran}</p> : null,
    query.explained ? (
      <p key="explained" className="note">
        Break {query.explained} is explained. It is no longer counted as a break to act on and it has left the
        operations inbox. Nothing was repaired: it is listed below with your note, and every later run compares it
        again exactly as before.
      </p>
    ) : null,
    // A failed latest run is called out above everything else: it found nothing because it
    // could not look, and reading its zero as "clean" is the exact mistake the brief forbids.
    ...sourcesWhoseLatestRunFailed.map((run) => (
      <p className="error" key={run.runId}>
        The most recent {SOURCE_LABEL[run.source] ?? run.source} run FAILED at {utc(run.finishedAt)} and compared
        nothing: {run.fetchError}. Nothing below has been re-examined for that source since.
      </p>
    )),
  ].filter(Boolean);

  return (
    <PortalShell user={user} active="reconciliation">
      <DetailHeading
        title="Reconciliation"
        lead="Every run pulls a provider's own records for a time window, reads what our ledger says about the same money, and stores the comparison. All times are UTC."
        chips={
          <>
            {/* The two integration labels stay on the page, never behind a disclosure: what is
                live and what is simulated is the first thing a reader has to know (AF-02). */}
            <Chip tone="ok">Stripe: LIVE SANDBOX</Chip>
            <Chip tone="neutral">claim payout rail: LOCAL SIMULATOR</Chip>
            <Chip tone={breaks.totalOpen > 0 ? "warn" : "ok"}>
              {breaks.totalOpen === 0
                ? "no break to act on"
                : `${breaks.totalOpen} ${breaks.totalOpen === 1 ? "break" : "breaks"} to act on`}
            </Chip>
            {probes.totalProbes > 0 ? <Chip tone="neutral">{probes.totalProbes} probes from check runs</Chip> : null}
            {sourcesWhoseLatestRunFailed.length > 0 ? <Chip tone="warn">latest run failed</Chip> : null}
          </>
        }
        actions={
          <form method="post" action="/api/jobs/reconcile" className="inline-form">
            <button type="submit" className="orange">Reconcile both sources now</button>
          </form>
        }
      />

      {notices.length > 0 ? <div className="notices">{notices}</div> : null}

      {/* UI-011: the break table has nine columns a reader scans together, which do not fit the
          736 px left-hand card of the two-column grid. The page stacks: the tables take the full
          content width and the run form and the reading notes move under them. */}
      <div className="ops-stacked">
      <DetailGrid
        main={
          <>
            <Panel title="Open breaks to act on">
              {runs.length === 0 ? (
                <Empty illustration="all-clear">No reconciliation has ever run. Press &ldquo;Reconcile both sources now&rdquo;.</Empty>
              ) : breaks.rows.length === 0 ? (
                <Empty illustration="all-clear">
                  No break to act on. The latest completed run of each source compared{" "}
                  {latestComplete.map((run) => `${run.providerRecordCount} provider records for ${run.source}`).join(" and ")}{" "}
                  and found every one of them in the ledger.
                </Empty>
              ) : (
                <>
                  <BreakTable rows={breaks.rows} now={now} label="Open breaks" ageColumn="Open for" explain />
                  {/* The cap is said, never hidden: the read is bounded and the number it did not
                      draw is the number that matters (review findings F-B10-07 and F-LS-01). */}
                  {breaks.capped ? (
                    <p className="note">
                      Showing the {breaks.rows.length} oldest of {breaks.totalOpen} breaks to act on. The rest are on
                      file and counted; nothing was dropped.
                    </p>
                  ) : null}
                </>
              )}
              <Disclosure title="What counts as a break to act on">
                <p>
                  Everything a completed run reported as anything but matched, that no later run has explained,{" "}
                  <strong>that is not a probe from one of our own check runs and that nobody has written a note
                  on</strong>. A break leaves this list when a later completed run of the same source, <strong>whose
                  window covers the date of the record</strong>, no longer reports it: a break nobody has looked at
                  again stays here, however old it gets. The age is counted from the first run that ever reported it as
                  a break. Staleness thresholds are assumptions of this build: {STRIPE_STALE_AFTER_HOURS} hours at
                  Stripe, {CLAIMS_RAIL_STALE_AFTER_HOURS} hours on the simulated rail. This is the number the sidebar
                  badge and the operations inbox show.
                </p>
              </Disclosure>
            </Panel>

            <Panel title="Probe payments from check runs">
              {probes.rows.length === 0 ? (
                <Empty>No probe payment is being reported.</Empty>
              ) : (
                <>
                  <BreakTable rows={probes.rows} now={now} label="Probe payments" ageColumn="Reported for" explain />
                  {probes.capped ? (
                    <p className="note">
                      Showing the {probes.rows.length} oldest of {probes.totalProbes} probe payments. The rest are on
                      file and counted; nothing was dropped.
                    </p>
                  ) : null}
                </>
              )}
              <p className="note">
                These are payments <strong>this project&apos;s own check script creates</strong>. Every run of{" "}
                <code>npm run check:reconciliation</code> puts one real PaymentIntent of $42.42 into the Stripe sandbox
                with a test card and no operation id, to prove that money at the provider with nothing behind it in our
                books is found by the comparison. No ledger entry will ever explain them, by construction, so they are
                reported for ever and they are <strong>not breaks to act on</strong>. They are not hidden either: they
                are listed here, counted here, and a real provider-only break would appear in the panel above and not in
                this one.
              </p>
            </Panel>

            <Panel title="Explained breaks">
              {explained.rows.length === 0 ? (
                <Empty>Nobody has written a note on a break yet.</Empty>
              ) : (
                <>
                  <ExplainedTable rows={explained.rows} now={now} />
                  {explained.capped ? (
                    <p className="note">
                      Showing {explained.rows.length} of {explained.totalExplained} explained breaks, most recently
                      explained first. The rest are on file and counted; nothing was dropped.
                    </p>
                  ) : null}
                </>
              )}
              <Disclosure title="What a note does, and what it does not do">
                <p>
                  A note says that a staff operations user looked at this break and knows what it is. It{" "}
                  <strong>repairs nothing</strong>: no money moves, no journal entry is posted, and no reconciliation
                  row is edited or deleted. The break is still compared by every later run and it stays listed here with
                  the note, its author and its date. The only thing that changes is that it stops being counted as a
                  break to act on and leaves the operations inbox. Notes are append-only: a correction is a second note,
                  and the latest one is shown.
                </p>
              </Disclosure>
            </Panel>

            <Panel title="Runs">
              {runs.length === 0 ? (
                <Empty>Nothing has run yet.</Empty>
              ) : (
                <div className="table-scroll" role="region" aria-label="Reconciliation runs" tabIndex={0}>
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th className="col-when">Finished (UTC)</th>
                        <th className="col-label">Source</th>
                        <th className="col-age">Status</th>
                        <th className="col-when">Window (UTC)</th>
                        <th className="col-age">Compared</th>
                        <th className="col-text">Result</th>
                        <th className="col-name">Run by</th>
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
            </Panel>

            <Panel title="Clearing balances that have not returned to zero">
              {clearingBalances.length === 0 ? (
                <Empty>
                  Every clearing account is at zero: no premium billed and uncollected, no refund owed and unpaid, no
                  claim payment in flight, no customer money waiting to be applied.
                </Empty>
              ) : (
                <div className="table-scroll" role="region" aria-label="Clearing balances" tabIndex={0}>
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th className="col-text">Account</th>
                        <th className="col-name">Policy or claim</th>
                        <th className="amount">Still open</th>
                        <th className="col-when">Oldest entry (UTC)</th>
                        <th className="col-age">Open for</th>
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
              <Disclosure title="Why this list exists">
                <p>
                  Read straight from the journal, with no window at all, so nothing here can be missed for being old.
                  These four accounts hold money on its way somewhere and must end at zero; a balance that is still
                  open is a flow that has not finished, and one that is weeks old is an operations case. This list is
                  the second net under the break list: it does not depend on any provider answering, or on any run
                  having compared anything.
                </p>
              </Disclosure>
            </Panel>

            <Panel title="Breaks that went away">
              {resolved.length === 0 ? <Empty>No break has been resolved yet.</Empty> : <BreakTable rows={resolved} now={now} label="Resolved breaks" ageColumn="Was open for" />}
              <Disclosure title="What resolved them">
                <p>
                  Reported by an earlier run, and looked at again since by a completed run of the same source whose
                  window covered the record, which no longer reports it. Nothing was deleted: the items of every run
                  are still on file, which is how a break can be shown as resolved rather than vanish.
                </p>
              </Disclosure>
            </Panel>
          </>
        }
        aside={
          <>
            <Panel title="Run with a window">
              <form method="post" action="/api/jobs/reconcile" className="card">
                <label htmlFor="from">From (UTC date or instant, optional)</label>
                <input id="from" name="from" type="text" placeholder="2026-09-01" />
                <label htmlFor="to">To (UTC date or instant, optional)</label>
                <input id="to" name="to" type="text" placeholder="2026-09-08" />
                <button type="submit" className="secondary">Reconcile both sources</button>
              </form>
              <p className="note">
                Both sources, one after the other. The window defaults to the last {DEFAULT_WINDOW_DAYS} days, long
                enough that a webhook delayed by a day is still inside the next run&apos;s window. Running an
                overlapping window again is harmless: each run stores its own items and a break is identified across
                runs by its key.
              </p>
            </Panel>
            <Panel title="How to read this page">
              <Disclosure title="The two sources">
                <p>
                  <strong>Stripe</strong> (LIVE SANDBOX: PaymentIntents, Refunds and BalanceTransactions listed through
                  the API) and the <strong>claim payout rail</strong> (LOCAL SIMULATOR: the rail keeps its own
                  provider-side records, written by the simulator and never by the ledger code, so a mismatch planted
                  there is found the same way a Stripe one is). Stripe processing fees are not journaled in this build,
                  so a matched payment notes the fee as information only.
                </p>
              </Disclosure>
              <Disclosure title="Nothing here repairs a break">
                <p>
                  There is deliberately no button that could. A break is repaired by doing the real thing (replaying a
                  webhook, running the settlement job, opening a correction), and the next run stops reporting it. That
                  is why resolved breaks are still listed: they were never deleted, they simply stopped being found.{" "}
                  <strong>Explaining a break is not repairing it either</strong>: the note says a human knows what this
                  break is, the money is exactly where it was, and the comparison keeps reporting it.
                </p>
              </Disclosure>
              <Disclosure title="The six classifications">
                <ul>
                  {Object.entries(CLASSIFICATION_MEANING).map(([name, meaning]) => (
                    <li key={name}>
                      <strong>{name.replace(/_/g, " ")}</strong>: {meaning}
                    </li>
                  ))}
                </ul>
              </Disclosure>
            </Panel>
          </>
        }
      />
      </div>
    </PortalShell>
  );
}

function RunRow({ run }: { run: ReconciliationRunRow }) {
  // Breaks to act on and probes are counted separately, never added up: a run of this build finds
  // one more probe every time the check script has been run, and reading "28 breaks" when they are
  // 28 planted payments is the confusion review finding F-YA-10 recorded.
  const breaks = run.counts.local_only + run.counts.provider_only + run.counts.amount_mismatch + run.counts.stale;
  return (
    <tr>
      <td className="col-when">{utc(run.finishedAt)}</td>
      <td className="col-label">{SOURCE_LABEL[run.source] ?? run.source}</td>
      <td className="col-age">
        <Chip tone={run.status === "complete" ? "ok" : "warn"}>{run.status}</Chip>
      </td>
      <td className="col-when">
        {utc(run.windowFrom)}
        <br />
        {utc(run.windowTo)}
      </td>
      <td className="col-age">
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
      <td className="col-text">
        {run.status === "failed" ? (
          /* Never "0 breaks": a failed run has no result at all, only a reason. */
          <span className="note">FAILED, no comparison was made: {run.fetchError}</span>
        ) : (
          <>
            {run.counts.probe > 0 ? `${run.counts.probe} ${run.counts.probe === 1 ? "probe" : "probes"}, ` : ""}
            {breaks === 0 ? "no break to act on" : breaks === 1 ? "1 break to act on" : `${breaks} breaks to act on`} (
            {run.counts.matched} matched, {run.counts.local_only} local only, {run.counts.provider_only} provider only,{" "}
            {run.counts.amount_mismatch} amount mismatch, {run.counts.stale} stale, {run.counts.probe} probe)
            {run.note ? (
              <>
                <br />
                <span className="note">{run.note}</span>
              </>
            ) : null}
          </>
        )}
      </td>
      <td className="col-name">{run.runByName ?? <span className="note">scheduled job</span>}</td>
    </tr>
  );
}

function ClearingRow({ balance, now }: { balance: ClearingBalanceRow; now: Date }) {
  return (
    <tr>
      <td className="col-text">
        {balance.accountName}
        <br />
        <span className="note">{CLEARING_ACCOUNT_MEANING[balance.accountId]}</span>
      </td>
      <td className="col-name">{balance.policyNumber ?? balance.claimNumber ?? <span className="note">no policy or claim on the entry</span>}</td>
      <td className="amount">{formatCentsAsUsd(balance.openCents)}</td>
      <td className="col-when">{utc(balance.oldestEntryAt)}</td>
      <td className="col-age">{describeAge(balance.oldestEntryAt, now)}</td>
    </tr>
  );
}

// `label` names the scrolling region, exactly as `ageColumn` names the last column: this table is
// rendered twice, for the open breaks and for the resolved ones, and a name generated from a
// counter had both of them announced as "Reconciliation table 3" (review finding F-B13-33).
function BreakTable({
  rows,
  now,
  label,
  ageColumn,
  explain = false,
}: {
  rows: ReconciliationBreakRow[];
  now: Date;
  label: string;
  ageColumn: string;
  // Adds the last column, the note form. Off on the resolved table: a break that stopped being
  // reported has nothing left to explain.
  explain?: boolean;
}) {
  return (
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
<table className="ledger ops-table">
      <thead>
        <tr>
          <th className="col-ref">Reference</th>
          <th className="col-label">Source</th>
          <th className="col-text">Classification</th>
          <th className="amount">Provider</th>
          <th className="amount">Ledger</th>
          <th className="amount">Difference</th>
          <th className="col-when">First seen (UTC)</th>
          <th className="col-age">{ageColumn}</th>
          <th className="col-text">What it means</th>
          {explain ? <th className="col-controls">Explain this break</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          /* The id another screen links one break by: the inbox sends an operator straight to
             the row of the break it is telling them about. The break key is the identity the
             runs file a break under, so the anchor survives a later run reporting it again. */
          <tr key={`${row.breakKey}-${row.lastReportedAt.toISOString()}`} id={`break-${row.breakKey}`}>
            <td className="col-ref">
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
            <td className="col-label">{SOURCE_LABEL[row.source] ?? row.source}</td>
            <td className="col-text">
              <Chip tone="warn">{row.classification.replace(/_/g, " ")}</Chip>
              <br />
              <span className="note">{CLASSIFICATION_MEANING[row.classification]}</span>
            </td>
            <td className="amount">{money(row.providerAmountCents)}</td>
            <td className="amount">{money(row.ledgerAmountCents)}</td>
            <td className="amount">{money(row.differenceCents)}</td>
            <td className="col-when">{utc(row.firstSeenAt)}</td>
            <td className="col-age">{describeAge(row.firstSeenAt, now)}</td>
            <td className="col-text">{row.note}</td>
            {explain ? (
              <td className="col-controls">
                <ExplainForm breakKey={row.breakKey} />
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
</div>
  );
}

// The note form of one row. Staff operations only, server-side: the route reads the session and
// refuses everybody else (lib/reconciliation/break-notes.ts). It is shown to every reader of this
// page because hiding it would not be the control, and a staff approver pressing it gets the
// refusal sentence rather than a silent failure.
//
// The break key goes in the path and is encoded here: it carries a `|` and a `:`.
function ExplainForm({ breakKey }: { breakKey: string }) {
  return (
    <form method="post" action={`/api/reconciliation/breaks/${encodeURIComponent(breakKey)}/explain`} className="card">
      <label htmlFor={`note-${breakKey}`} className="note">
        What is this break? ({NOTE_MINIMUM_CHARACTERS} to {NOTE_MAXIMUM_CHARACTERS} characters)
      </label>
      <textarea
        id={`note-${breakKey}`}
        name="note"
        rows={2}
        minLength={NOTE_MINIMUM_CHARACTERS}
        maxLength={NOTE_MAXIMUM_CHARACTERS}
        required
      />
      <button type="submit" className="secondary">Explain this break</button>
    </form>
  );
}

// The explained breaks: the same row, plus the note that took it out of the list to act on.
function ExplainedTable({ rows, now }: { rows: ExplainedBreakRow[]; now: Date }) {
  return (
    <div className="table-scroll" role="region" aria-label="Explained breaks" tabIndex={0}>
      <table className="ledger ops-table">
        <thead>
          <tr>
            <th className="col-ref">Reference</th>
            <th className="col-label">Source</th>
            <th className="col-text">Classification</th>
            <th className="amount">Difference</th>
            <th className="col-age">Open for</th>
            <th className="col-text">What an operator says it is</th>
            <th className="col-name">Explained by</th>
            <th className="col-when">Explained (UTC)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.breakKey}-${row.explanation.recordedAt.toISOString()}`} id={`break-${row.breakKey}`}>
              <td className="col-ref">
                <code>{row.providerRef ?? "no provider reference"}</code>
                <SandboxReferences
                  references={[
                    { label: "Provider reference", value: row.providerRef },
                    { label: "Ledger operation id", value: row.ledgerRef },
                    { label: "Break key", value: row.breakKey },
                  ]}
                />
              </td>
              <td className="col-label">{SOURCE_LABEL[row.source] ?? row.source}</td>
              <td className="col-text">
                <Chip tone="neutral">{row.classification.replace(/_/g, " ")}</Chip>
              </td>
              <td className="amount">{money(row.differenceCents)}</td>
              <td className="col-age">{describeAge(row.firstSeenAt, now)}</td>
              <td className="col-text">
                {row.explanation.note}
                {row.explanation.noteCount > 1 ? (
                  <>
                    <br />
                    <span className="note">
                      latest of {row.explanation.noteCount} notes on this break; the earlier ones are on file
                    </span>
                  </>
                ) : null}
              </td>
              <td className="col-name">{row.explanation.explainedByName}</td>
              <td className="col-when">{utc(row.explanation.recordedAt)}</td>
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
