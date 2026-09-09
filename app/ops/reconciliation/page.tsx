import "@/app/styles/money.css";
import { redirect } from "next/navigation";
import { Chip } from "@/components/detail-layout";
import { SandboxReferences } from "@/components/disclosures";
import { PortalShell } from "@/components/portal-shell";
import { About } from "@/components/ui/about";
import { Bars, Chart, ChartRow, Donut, HBars } from "@/components/ui/charts";
import { EmptyState } from "@/components/ui/empty";
import { Inspector } from "@/components/ui/inspector";
import { Legend } from "@/components/ui/legend";
import { Stat, Stats } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable, ExpandHead, ExpandRow, FactGrid, MoreRows, Num, Ref, Row } from "@/components/ui/table";
import { FilterChip, Toolbar, ToolbarCount, ToolbarGroup, ToolbarSpacer } from "@/components/ui/toolbar";
import { When } from "@/components/ui/time";
import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { CLAIMS_RAIL_STALE_AFTER_HOURS } from "@/lib/reconciliation/claims-rail-source";
import { CLEARING_ACCOUNT_MEANING, nonZeroClearingBalances } from "@/lib/reconciliation/clearing-balances";
import { openBreaks, recentRuns, resolvedBreaks, type ReconciliationBreakRow } from "@/lib/reconciliation/read";
import { STRIPE_STALE_AFTER_HOURS } from "@/lib/reconciliation/stripe-source";
import { DEFAULT_WINDOW_DAYS } from "@/lib/reconciliation/window";
import {
  closeInspectorHref,
  firstValue,
  inspectHref,
  inspectedReference,
  pickFilter,
  pickView,
  toastsFromQuery,
  withParams,
  type Query,
} from "@/lib/ui/views";

// /ops/reconciliation: what the provider says, what the ledger says, and everything that does
// not agree.
//
// Staff only. Everything on this page is read from two append-only tables: nothing here fixes a
// break, and there is deliberately no button that could. A break is repaired by doing the real
// thing (replaying a webhook, running the settlement job, opening a correction), and the next run
// stops reporting it. That is why the page also lists breaks that were resolved: they were never
// deleted, they simply stopped being found.
//
// Four views of the same four reads, chosen in the URL: the open breaks, the runs that produced
// them, the clearing balances that have not returned to zero, and the breaks that went away.

const PATH = "/ops/reconciliation";
const VIEWS = ["breaks", "runs", "clearing", "resolved"] as const;
const VIEW_LABEL: Record<(typeof VIEWS)[number], string> = {
  breaks: "Open breaks",
  runs: "Runs",
  clearing: "Clearing",
  resolved: "Resolved",
};

const HOW_MANY_RUNS_SHOWN = 12;
const HOW_MANY_RESOLVED_SHOWN = 20;
// A long list of breaks is bounded on the screen and says so, rather than dropping rows in
// silence; ?all=1 asks for the rest.
const HOW_MANY_BREAKS_ON_ONE_PAGE = 50;

// The two sources, in one to three words, with the integration mode under them. The mode is
// printed on every row and not only in the band: a reader looking at one break has to see
// whether that record came from Stripe or from the simulator (AF-02).
const SOURCES = ["stripe", "claims_rail"] as const;
const SOURCE_NAME: Record<string, string> = { stripe: "Stripe", claims_rail: "Claim rail" };
const SOURCE_MODE: Record<string, string> = { stripe: "LIVE SANDBOX", claims_rail: "LOCAL SIMULATOR" };

// The four classifications a break can carry. "matched" is the fifth value of the union and is
// never a break, so it is not a filter; the legend still defines it.
const BREAK_CLASSES = ["local_only", "provider_only", "amount_mismatch", "stale"] as const;

// What each classification means, in one line, on the screen rather than in a document nobody
// opens while an incident is running.
const CLASSIFICATION_MEANING: Record<string, string> = {
  local_only: "the ledger booked cash the provider shows no record of",
  provider_only: "the provider moved money the ledger has no cash entry for",
  amount_mismatch: "both sides moved money on the same operation, for different amounts",
  stale: "money out promised long ago and still not confirmed either way",
  matched: "both sides agree",
};

// The four age buckets of the open breaks, oldest last. Computed here from the rows the page
// already read: a picture never costs a query.
const AGE_BUCKETS = [
  { label: "< 1 h", upToHours: 1 },
  { label: "< 24 h", upToHours: 24 },
  { label: "< 7 d", upToHours: 24 * 7 },
  { label: "older", upToHours: Number.POSITIVE_INFINITY },
];

function bucketOf(firstSeenAt: Date, now: Date): string {
  const hours = (now.getTime() - firstSeenAt.getTime()) / 3600000;
  return (AGE_BUCKETS.find((bucket) => hours < bucket.upToHours) ?? AGE_BUCKETS[AGE_BUCKETS.length - 1]).label;
}

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<Query> }) {
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

  const view = pickView(query.view, VIEWS);
  const sourceFilter = pickFilter(query.source, SOURCES);
  const classFilter = pickFilter(query.class, BREAK_CLASSES);
  const showAll = firstValue(query.all) === "1";
  const inspected = inspectedReference(query.inspect);

  const matchesFilters = (row: ReconciliationBreakRow) =>
    (sourceFilter === null || row.source === sourceFilter) && (classFilter === null || row.classification === classFilter);
  const shownBreaks = breaks.filter(matchesFilters);
  const breaksOnThePage = showAll ? shownBreaks : shownBreaks.slice(0, HOW_MANY_BREAKS_ON_ONE_PAGE);

  const oldestBreak = breaks.reduce<Date | null>(
    (oldest, row) => (oldest === null || row.firstSeenAt < oldest ? row.firstSeenAt : oldest),
    null,
  );
  const oldestClearingEntry = clearingBalances.reduce<Date | null>(
    (oldest, balance) => (oldest === null || balance.oldestEntryAt < oldest ? balance.oldestEntryAt : oldest),
    null,
  );
  const latestRunOf = (source: string) => runs.find((run) => run.source === source) ?? null;
  // One label per run for the two charts, and the scale they share. The label has to be unique,
  // because a chart keys its rows by it, and two runs of the same source can finish in the same
  // minute: the position in the list is what tells them apart.
  const runLabels: Record<string, string> = Object.fromEntries(
    runs.map((run, index) => [run.runId, `${index + 1}. ${SOURCE_NAME[run.source] ?? run.source} ${calendarDate(run.finishedAt)}`]),
  );
  // The two charts are read side by side, so a bar of the same length must mean the same count.
  const mostRecordsInARun = Math.max(1, ...runs.map((run) => Math.max(run.providerRecordCount, run.ledgerRecordCount)));

  const toasts = toastsFromQuery(query, {
    error: { tone: "error", title: "Refused" },
    ran: { tone: "ok", title: "Reconciliation finished" },
  });

  const views = VIEWS.map((one) => ({
    key: one,
    label: VIEW_LABEL[one],
    href: withParams(PATH, query, { view: one, inspect: null, all: null }),
    current: one === view,
    count:
      one === "breaks"
        ? breaks.length
        : one === "runs"
          ? runs.length
          : one === "clearing"
            ? clearingBalances.length
            : resolved.length,
  }));

  return (
    <PortalShell
      user={user}
      active="reconciliation"
      views={views}
      toasts={toasts}
      inspector={
        inspected ? <Inspector reference={inspected} closeHref={closeInspectorHref(PATH, query)} user={user} now={now} /> : undefined
      }
      band={{
        title: "Reconciliation",
        meta: (
          <>
            <Chip tone={breaks.length > 0 ? "warn" : "ok"}>
              {breaks.length === 0 ? "no open break" : `${breaks.length} open ${breaks.length === 1 ? "break" : "breaks"}`}
            </Chip>
            {/* The two integration labels stay in the band, never behind a fold: what is live and
                what is simulated is the first thing a reader has to know (AF-02). */}
            <Chip tone="ok">Stripe: LIVE SANDBOX</Chip>
            <Chip tone="neutral">claim rail: LOCAL SIMULATOR</Chip>
            {sourcesWhoseLatestRunFailed.length > 0 ? <Chip tone="warn">latest run failed</Chip> : null}
          </>
        ),
        actions: (
          <form method="post" action="/api/jobs/reconcile" className="inline-form">
            <SubmitButton className="orange">Reconcile both sources now</SubmitButton>
          </form>
        ),
      }}
    >
      {/* The toasts above are the glance; these sentences stay in the page, because the review
          scripts read them and because a failed latest run must survive a dismissed toast. */}
      {query.error || query.ran || sourcesWhoseLatestRunFailed.length > 0 ? (
        <div className="notices">
          {query.error ? (
            <p className="error" role="alert">
              {firstValue(query.error)}
            </p>
          ) : null}
          {query.ran ? <p className="note">Run finished: {firstValue(query.ran)}</p> : null}
          {/* A failed latest run is called out above everything else: it found nothing because it
              could not look, and reading its zero as "clean" is the exact mistake the brief forbids. */}
          {sourcesWhoseLatestRunFailed.map((run) => (
            <p className="error" key={run.runId}>
              The most recent {SOURCE_NAME[run.source] ?? run.source} ({SOURCE_MODE[run.source]}) run FAILED at{" "}
              {utc(run.finishedAt)} and compared nothing: {run.fetchError}. Nothing below has been re-examined for that
              source since.
            </p>
          ))}
        </div>
      ) : null}

      {view === "breaks" ? (
        <>
          <Stats>
            <Stat
              label="Open breaks"
              value={breaks.length}
              tone={breaks.length > 0 ? "warn" : "ok"}
              note="not explained by a later run"
            />
            {SOURCES.map((source) => (
              <Stat
                key={source}
                label={SOURCE_NAME[source]}
                value={breaks.filter((row) => row.source === source).length}
                note={SOURCE_MODE[source]}
                href={withParams(PATH, query, { view: "breaks", source, inspect: null, all: null })}
              />
            ))}
            <Stat
              label="Oldest"
              value={oldestBreak ? <When instant={oldestBreak} now={now} /> : "none"}
              note="since it was first reported"
            />
          </Stats>

          {breaks.length > 0 ? (
            <ChartRow>
              <Chart title="By classification" figure={breaks.length}>
                <Donut
                  caption="Open breaks by classification"
                  center={breaks.length}
                  slices={BREAK_CLASSES.map((name) => ({
                    label: name.replace(/_/g, " "),
                    value: breaks.filter((row) => row.classification === name).length,
                  })).filter((slice) => slice.value > 0)}
                />
              </Chart>
              <Chart title="By age" figure={breaks.length}>
                <Bars
                  caption="Open breaks by age bucket"
                  points={AGE_BUCKETS.map((bucket) => ({
                    label: bucket.label,
                    value: breaks.filter((row) => bucketOf(row.firstSeenAt, now) === bucket.label).length,
                  }))}
                />
              </Chart>
            </ChartRow>
          ) : null}

          <BreakTable
            rows={breaksOnThePage}
            now={now}
            query={query}
            inspected={inspected}
            ariaLabel="Open breaks"
            ageColumn="Open for"
            anchorRows
            empty={
              runs.length === 0 ? (
                <EmptyState illustration="all-clear">No reconciliation has ever run. Press Reconcile both sources now.</EmptyState>
              ) : breaks.length === 0 ? (
                <EmptyState illustration="all-clear">No open break. The latest completed run of each source found every record.</EmptyState>
              ) : (
                <EmptyState illustration="closed-folder">No open break matches this filter.</EmptyState>
              )
            }
            toolbar={
              <Toolbar>
                <ToolbarGroup label="Source">
                  <FilterChip href={withParams(PATH, query, { source: null, all: null })} active={sourceFilter === null} count={breaks.length}>
                    All
                  </FilterChip>
                  {SOURCES.map((source) => (
                    <FilterChip
                      key={source}
                      href={withParams(PATH, query, { source, all: null })}
                      active={sourceFilter === source}
                      count={breaks.filter((row) => row.source === source).length}
                    >
                      {SOURCE_NAME[source]}
                    </FilterChip>
                  ))}
                </ToolbarGroup>
                <ToolbarGroup label="Class">
                  <FilterChip href={withParams(PATH, query, { class: null, all: null })} active={classFilter === null} count={breaks.length}>
                    All
                  </FilterChip>
                  {BREAK_CLASSES.map((name) => (
                    <FilterChip
                      key={name}
                      href={withParams(PATH, query, { class: name, all: null })}
                      active={classFilter === name}
                      count={breaks.filter((row) => row.classification === name).length}
                    >
                      {name.replace(/_/g, " ")}
                    </FilterChip>
                  ))}
                </ToolbarGroup>
                <ToolbarSpacer />
                <ToolbarCount>
                  {breaksOnThePage.length} of {breaks.length}
                </ToolbarCount>
              </Toolbar>
            }
            footer={
              <MoreRows
                shown={breaksOnThePage.length}
                total={shownBreaks.length}
                href={withParams(PATH, query, { all: "1" })}
                label="Show every open break"
              />
            }
          />
        </>
      ) : null}

      {view === "runs" ? (
        <>
          <Stats>
            <Stat label="Runs shown" value={runs.length} note={`newest ${HOW_MANY_RUNS_SHOWN} of every source`} />
            {SOURCES.map((source) => {
              const latest = latestRunOf(source);
              return (
                <Stat
                  key={source}
                  label={`Latest ${SOURCE_NAME[source].toLowerCase()}`}
                  value={latest ? <When instant={latest.finishedAt} now={now} /> : "never"}
                  tone={latest?.status === "failed" ? "warn" : "neutral"}
                  note={latest ? latest.status : SOURCE_MODE[source]}
                />
              );
            })}
          </Stats>

          {/* The window form sits above the list it produces. Same action, same two field names as
              before; only the button became a SubmitButton (F-YA-09). */}
          <div className="card money-form-card">
            <h2>Run with a window</h2>
            <form method="post" action="/api/jobs/reconcile" className="card">
              <label htmlFor="from">From (UTC date, optional)</label>
              <input id="from" name="from" type="text" placeholder="2026-09-01" />
              <label htmlFor="to">To (UTC date, optional)</label>
              <input id="to" name="to" type="text" placeholder="2026-09-08" />
              <SubmitButton className="secondary">Reconcile both sources</SubmitButton>
            </form>
            <p className="note">
              Both sources, one after the other. The window defaults to {DEFAULT_WINDOW_DAYS} days.
            </p>
          </div>

          {runs.length > 0 ? (
            // The wrapper carries the one rule this screen adds for a horizontal bar, until the
            // interface coordinator moves it into the system stylesheet (see app/styles/money.css).
            <div className="money-charts">
            <ChartRow>
              <Chart title="Provider records" figure={runs.reduce((total, run) => total + run.providerRecordCount, 0)}>
                <HBars
                  caption="Provider records compared, one row per run, newest first"
                  max={mostRecordsInARun}
                  rows={runs.map((run) => ({ label: runLabels[run.runId], value: run.providerRecordCount }))}
                />
              </Chart>
              <Chart title="Ledger records" figure={runs.reduce((total, run) => total + run.ledgerRecordCount, 0)}>
                <HBars
                  caption="Ledger records compared, one row per run, newest first"
                  max={mostRecordsInARun}
                  rows={runs.map((run) => ({ label: runLabels[run.runId], value: run.ledgerRecordCount, color: "var(--chart-2)" }))}
                />
              </Chart>
            </ChartRow>
            </div>
          ) : null}

          <DataTable ariaLabel="Reconciliation runs">
            <thead>
              <tr>
                <ExpandHead />
                <th className="nowrap">Finished</th>
                <th>Source</th>
                <th>Status</th>
                <th className="nowrap">Window</th>
                <th className="num">Compared</th>
                <th className="num">Breaks</th>
              </tr>
            </thead>
            {runs.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={7} className="dt-empty">
                    <EmptyState illustration="balance-scales">Nothing has run yet.</EmptyState>
                  </td>
                </tr>
              </tbody>
            ) : (
              runs.map((run) => {
                const breakCount =
                  run.counts.local_only + run.counts.provider_only + run.counts.amount_mismatch + run.counts.stale;
                return (
                  <ExpandRow
                    key={run.runId}
                    columns={6}
                    cells={
                      <>
                        <td className="nowrap">
                          <When instant={run.finishedAt} now={now} />
                          <span className="dt-sub">{run.runByName ?? "scheduled job"}</span>
                        </td>
                        <td>
                          {SOURCE_NAME[run.source] ?? run.source}
                          <span className="dt-sub">{SOURCE_MODE[run.source]}</span>
                        </td>
                        <td>
                          <Chip tone={run.status === "complete" ? "ok" : "warn"}>{run.status}</Chip>
                        </td>
                        <td className="nowrap">
                          {calendarDate(run.windowFrom)}
                          <span className="dt-sub">{calendarDate(run.windowTo)}</span>
                        </td>
                        <Num sub={run.status === "failed" ? "nothing" : `${run.ledgerRecordCount} ledger`}>
                          {run.status === "failed" ? "none" : `${run.providerRecordCount} provider`}
                        </Num>
                        {/* Never "0 breaks" on a failed run: it has no result at all, only a reason. */}
                        <Num sub={run.status === "failed" ? "no comparison" : `${run.counts.matched} matched`}>
                          {run.status === "failed" ? "none" : breakCount}
                        </Num>
                      </>
                    }
                  >
                    <FactGrid
                      items={[
                        { label: "Window from", value: `${utc(run.windowFrom)} UTC` },
                        { label: "Window to", value: `${utc(run.windowTo)} UTC` },
                        { label: "Matched", value: run.counts.matched },
                        { label: "Local only", value: run.counts.local_only },
                        { label: "Provider only", value: run.counts.provider_only },
                        { label: "Amount mismatch", value: run.counts.amount_mismatch },
                        { label: "Stale", value: run.counts.stale },
                        { label: "Started", value: `${utc(run.startedAt)} UTC` },
                        ...(run.status === "failed" ? [{ label: "Why it failed", value: run.fetchError ?? "no reason stored" }] : []),
                        ...(run.note ? [{ label: "Note", value: run.note }] : []),
                      ]}
                    />
                  </ExpandRow>
                );
              })
            )}
          </DataTable>
        </>
      ) : null}

      {view === "clearing" ? (
        <>
          <Stats>
            <Stat
              label="Open balances"
              value={clearingBalances.length}
              tone={clearingBalances.length > 0 ? "warn" : "ok"}
              note="clearing accounts not back at zero"
            />
            {/* The oldest of the open balances, not a total: these four accounts hold money moving
                in opposite directions, and adding them would invent a figure the ledger never
                posted. The amount of each balance is in its own row. */}
            <Stat
              label="Oldest"
              value={oldestClearingEntry ? <When instant={oldestClearingEntry} now={now} /> : "none"}
              note="since the flow started"
            />
          </Stats>

          <DataTable ariaLabel="Clearing balances">
            <thead>
              <tr>
                <th>Account</th>
                <th>Policy or claim</th>
                <th className="num">Still open</th>
                <th className="nowrap">Oldest entry</th>
                <th className="nowrap">Open for</th>
              </tr>
            </thead>
            <tbody>
              {clearingBalances.length === 0 ? (
                <tr>
                  <td colSpan={5} className="dt-empty">
                    <EmptyState illustration="all-clear">Every clearing account is at zero.</EmptyState>
                  </td>
                </tr>
              ) : (
                clearingBalances.map((balance) => (
                  <Row key={`${balance.accountId}-${balance.policyId}-${balance.claimId}`}>
                    <td>
                      {balance.accountName}
                      <span className="dt-sub">{CLEARING_ACCOUNT_MEANING[balance.accountId]}</span>
                    </td>
                    <td>{balance.policyNumber ?? balance.claimNumber ?? <span className="dt-muted">none on the entry</span>}</td>
                    <Num>{formatCentsAsUsd(balance.openCents)}</Num>
                    <td className="nowrap">
                      <When instant={balance.oldestEntryAt} now={now} mode="utc" />
                    </td>
                    <td className="nowrap">
                      <When instant={balance.oldestEntryAt} now={now} />
                    </td>
                  </Row>
                ))
              )}
            </tbody>
          </DataTable>
        </>
      ) : null}

      {view === "resolved" ? (
        <>
          <Stats>
            <Stat label="Resolved" value={resolved.length} tone="ok" note={`newest ${HOW_MANY_RESOLVED_SHOWN}`} />
            <Stat label="Still open" value={breaks.length} tone={breaks.length > 0 ? "warn" : "ok"} note="not explained yet" />
          </Stats>

          <BreakTable
            rows={resolved}
            now={now}
            query={query}
            inspected={inspected}
            ariaLabel="Resolved breaks"
            ageColumn="Was open for"
            empty={<EmptyState illustration="all-clear">No break has been resolved yet.</EmptyState>}
          />
        </>
      ) : null}

      <About>
        <h4>What counts as open</h4>
        <p>
          Everything a completed run reported as anything but matched and that no later run has explained. A break
          leaves the list only when a later completed run of the same source, whose window covers the date of the
          record, no longer reports it. A break nobody has looked at again stays open, however old it gets. The age is
          counted from the first run that ever reported it.
        </p>
        <h4>The two sources</h4>
        <p>
          Stripe (LIVE SANDBOX: PaymentIntents, Refunds and BalanceTransactions listed through the API) and the claim
          payout rail (LOCAL SIMULATOR: the rail keeps its own provider-side records, written by the simulator and
          never by the ledger code, so a mismatch planted there is found the same way a Stripe one is). Stripe
          processing fees are not journaled in this build.
        </p>
        <h4>Staleness</h4>
        <p>
          Thresholds are assumptions of this build: {STRIPE_STALE_AFTER_HOURS} hours at Stripe,{" "}
          {CLAIMS_RAIL_STALE_AFTER_HOURS} hours on the simulated rail.
        </p>
        <h4>Nothing here repairs a break</h4>
        <p>
          There is deliberately no button that could. A break is repaired by doing the real thing (replaying a webhook,
          running the settlement job, opening a correction), and the next run stops reporting it. That is why resolved
          breaks are still listed: they were never deleted, they simply stopped being found.
        </p>
        <h4>Running a window again</h4>
        <p>
          Harmless. Each run stores its own items and a break is identified across runs by its key, so an overlapping
          window cannot duplicate anything. The window defaults to the last {DEFAULT_WINDOW_DAYS} days, long enough
          that a webhook delayed by a day is still inside the next run.
        </p>
        <h4>Clearing balances</h4>
        <p>
          Read straight from the journal, with no window at all, so nothing here can be missed for being old. These
          four accounts hold money on its way somewhere and must end at zero. This list is the second net under the
          break list: it does not depend on any provider answering, or on any run having compared anything.
        </p>
        <h4>What resolved a break</h4>
        <p>
          Reported by an earlier run, and looked at again since by a completed run of the same source whose window
          covered the record, which no longer reports it. Nothing was deleted: the items of every run are still on
          file, which is how a break can be shown as resolved rather than vanish.
        </p>
      </About>
    </PortalShell>
  );
}

// The break table, rendered for the open breaks and for the resolved ones. `ariaLabel` names the
// scrolling region and `ageColumn` names the last column: a name generated from a counter had both
// of them announced as "Reconciliation table 3" (review finding F-B13-33).
function BreakTable({
  rows,
  now,
  query,
  inspected,
  ariaLabel,
  ageColumn,
  anchorRows = false,
  empty,
  toolbar,
  footer,
}: {
  rows: ReconciliationBreakRow[];
  now: Date;
  query: Query;
  inspected: string | null;
  ariaLabel: string;
  ageColumn: string;
  // Only the open list carries the anchors the inbox links to; the same key in two tables of the
  // same page would be the same id twice.
  anchorRows?: boolean;
  empty: React.ReactNode;
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <DataTable
      ariaLabel={ariaLabel}
      toolbar={toolbar}
      footer={footer}
      legend={
        <Legend
          items={Object.entries(CLASSIFICATION_MEANING).map(([name, meaning]) => ({
            term: name.replace(/_/g, " "),
            meaning,
          }))}
        />
      }
    >
      <thead>
        <tr>
          <ExpandHead />
          <th>Reference</th>
          <th>Source</th>
          <th>Classification</th>
          <th className="num">Provider</th>
          <th className="num">Ledger</th>
          <th className="nowrap">{ageColumn}</th>
        </tr>
      </thead>
      {rows.length === 0 ? (
        <tbody>
          <tr>
            <td colSpan={7} className="dt-empty">
              {empty}
            </td>
          </tr>
        </tbody>
      ) : (
        rows.map((row) => {
          const reference = row.providerRef ?? row.ledgerRef ?? row.breakKey;
          return (
            <ExpandRow
              key={`${row.breakKey}-${row.lastReportedAt.toISOString()}`}
              // The id another screen links one break by: the inbox sends an operator straight to
              // the row of the break it is telling them about (lib/inbox/sections.ts). The break
              // key is the identity the runs file a break under, so the anchor survives a later
              // run reporting it again.
              id={anchorRows ? `break-${row.breakKey}` : undefined}
              selected={inspected === reference}
              columns={6}
              cells={
                <>
                  <td>
                    <Ref value={reference} inspectHref={inspectHref(PATH, query, reference)} open={inspected === reference} />
                  </td>
                  <td>
                    {SOURCE_NAME[row.source] ?? row.source}
                    <span className="dt-sub">{SOURCE_MODE[row.source]}</span>
                  </td>
                  <td>
                    <Chip tone="warn">{row.classification.replace(/_/g, " ")}</Chip>
                  </td>
                  <Num>{money(row.providerAmountCents)}</Num>
                  <Num>{money(row.ledgerAmountCents)}</Num>
                  <td className="nowrap">
                    <When instant={row.firstSeenAt} now={now} />
                  </td>
                </>
              }
            >
              <FactGrid
                items={[
                  { label: "Difference", value: money(row.differenceCents) },
                  { label: "What it means", value: CLASSIFICATION_MEANING[row.classification] },
                  { label: "Note", value: row.note },
                  { label: "First seen", value: `${utc(row.firstSeenAt)} UTC` },
                  { label: "Last reported", value: `${utc(row.lastReportedAt)} UTC` },
                  {
                    label: "References",
                    value: (
                      <SandboxReferences
                        inline
                        references={[
                          { label: "Provider reference", value: row.providerRef },
                          { label: "Ledger operation id", value: row.ledgerRef },
                          { label: "Break key", value: row.breakKey },
                        ]}
                      />
                    ),
                  },
                ]}
              />
            </ExpandRow>
          );
        })
      )}
    </DataTable>
  );
}

// A missing amount is a side that has no record at all, which is not the same as zero.
function money(amountCents: number | null) {
  return amountCents === null ? <span className="dt-muted">no record</span> : formatCentsAsUsd(amountCents);
}

function utc(instant: Date): string {
  return instant.toISOString().replace("T", " ").slice(0, 19);
}

function calendarDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}
