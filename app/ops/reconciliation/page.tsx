import "@/app/styles/money.css";
import { redirect } from "next/navigation";
import { Chip } from "@/components/detail-layout";
import { FailureLine } from "@/components/console-parts";
import { PortalShell } from "@/components/portal-shell";
import { About } from "@/components/ui/about";
import { EmptyState } from "@/components/ui/empty";
import { Inspector, type InspectorContext } from "@/components/ui/inspector";
import { Legend } from "@/components/ui/legend";
import { Stat, Stats } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable, ExpandHead, ExpandRow, FactGrid, MoreRows, Num, Ref, Row, RowMenu } from "@/components/ui/table";
import { FilterChip, Toolbar, ToolbarCount, ToolbarGroup, ToolbarSpacer } from "@/components/ui/toolbar";
import { When } from "@/components/ui/time";
import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { attempt, valueOr } from "@/lib/console/safe-read";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { NOTE_MAXIMUM_CHARACTERS, NOTE_MINIMUM_CHARACTERS } from "@/lib/reconciliation/break-notes";
import { CLAIMS_RAIL_STALE_AFTER_HOURS } from "@/lib/reconciliation/claims-rail-source";
import { CLEARING_ACCOUNT_MEANING, nonZeroClearingBalances } from "@/lib/reconciliation/clearing-balances";
import {
  countOpenBreaksBySource,
  explainedBreaksPage,
  openBreaksPage,
  probesPage,
  recentRuns,
  resolvedBreaks,
  type ExplainedBreakRow,
  type ReconciliationBreakRow,
  type SupersededExplanation,
} from "@/lib/reconciliation/read";
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
// Staff only. Everything on this page is read from append-only tables: nothing here moves money,
// and there is deliberately no button that could. A break is repaired by doing the real thing
// (replaying a webhook, running the settlement job, opening a correction), and the next run stops
// reporting it. That is why the page also lists breaks that were resolved: they were never
// deleted, they simply stopped being found.
//
// Four views of the same reads, chosen in the URL: the breaks to act on, the runs that produced
// them, the clearing balances that have not returned to zero, and the breaks that went away.
//
// THE BREAKS VIEW HOLDS THREE DISJOINT LISTS, and that is the whole point of the split
// (lib/reconciliation/read.ts). A break to act on carries no note that describes it as the latest
// run describes it and is not a probe; a probe is a payment one of our own check runs planted at
// the provider; an explained break carries such a note. A record appears on this page once.

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
// The three break lists are read a page at a time and say so when the page is not the whole list.
// The probe list is the one that grows on its own: every run of scripts/check-reconciliation.ts
// plants one more.
const HOW_MANY_BREAKS_ON_ONE_PAGE = 50;
const HOW_MANY_PROBES_SHOWN = 50;
const HOW_MANY_EXPLAINED_SHOWN = 50;
// `?all=1` raises the bound instead of removing it: the read is still bounded, so a database with
// tens of thousands of breaks cannot be asked to draw all of them into one page of HTML, and the
// cap sentence still tells the truth when even this bound is reached.
const EVERY_BREAK_THE_PAGE_WILL_DRAW = 1000;

// The two sources, in one to three words, with the integration mode under them. The mode is
// printed on every row and not only in the band: a reader looking at one break has to see
// whether that record came from Stripe or from the simulator (AF-02).
const SOURCES = ["stripe", "claims_rail"] as const;
const SOURCE_NAME: Record<string, string> = { stripe: "Stripe", claims_rail: "Claim rail" };
const SOURCE_MODE: Record<string, string> = { stripe: "LIVE SANDBOX", claims_rail: "LOCAL SIMULATOR" };

// The four classifications a break TO ACT ON can carry. "probe" and "matched" are the two other
// values of the union and are never a break to act on, so they are not filters; the legend still
// defines them.
const BREAK_CLASSES = ["local_only", "provider_only", "amount_mismatch", "stale"] as const;

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

// No chart on this screen (cycle 2, decision 4). The split by classification was one full ring at
// 100 % with a single legend entry, and the split by age said nothing the "Open for" column and
// the Oldest tile do not (round 1, MEDIUM). The counts stay: in the tiles, in the toolbar chips
// and in the band.

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<Query> }) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "staff_ops" && user.role !== "staff_approver") {
    redirect("/broker");
  }

  // The query string first, because the bound of the open read depends on `?all=1`.
  const query = await searchParams;
  const showAll = firstValue(query.all) === "1";

  // EVERY READ GOES THROUGH `attempt`, for the reason lib/console/safe-read.ts gives: this is a
  // screen an operator opens WHILE something is broken, and one read that cannot answer must say
  // so on its own block rather than replace the whole page with an error. It also matters here
  // for a plain reason of order: these reads need migrations 0022 to 0025, so on a database where
  // they have not run yet the page still renders and names what it could not read.
  const [runsRead, openRead, bySourceRead, probeRead, explainedRead, resolvedRead, clearingRead] = await Promise.all([
    attempt("The reconciliation runs", recentRuns(sql, HOW_MANY_RUNS_SHOWN)),
    attempt("The breaks to act on", openBreaksPage(sql, showAll ? EVERY_BREAK_THE_PAGE_WILL_DRAW : HOW_MANY_BREAKS_ON_ONE_PAGE)),
    // Counted in SQL over the WHOLE open set, with the same rule as the badge, because the list
    // above is one page of it: a tile that counted the rows drawn understates a source the moment
    // the page is capped.
    attempt("The breaks to act on by source", countOpenBreaksBySource(sql)),
    attempt("The probe payments", probesPage(sql, HOW_MANY_PROBES_SHOWN)),
    attempt("The explained breaks", explainedBreaksPage(sql, HOW_MANY_EXPLAINED_SHOWN)),
    attempt("The resolved breaks", resolvedBreaks(sql, HOW_MANY_RESOLVED_SHOWN)),
    attempt("The clearing balances", nonZeroClearingBalances(sql)),
  ]);
  const runs = valueOr(runsRead, []);
  const openPage = valueOr(openRead, { rows: [], totalOpen: 0, capped: false });
  const openBreaksBySource = valueOr(bySourceRead, {} as Record<string, number>);
  const probes = valueOr(probeRead, { rows: [], totalProbes: 0, capped: false });
  const explained = valueOr(explainedRead, { rows: [], totalExplained: 0, capped: false });
  const resolved = valueOr(resolvedRead, []);
  const clearingBalances = valueOr(clearingRead, []);
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
  const inspected = inspectedReference(query.inspect);
  // Only a staff operations user may write a note; the route checks the session again and refuses
  // everybody else (lib/reconciliation/break-notes.ts). Hiding the form is not the control, it is
  // what keeps an approver from opening a menu whose only action would refuse them.
  const canExplain = user.role === "staff_ops";

  // The source and class chips filter the rows the page drew. They are counted on those same
  // rows, so what a chip promises is what the table then shows; the true total of breaks to act
  // on is `openPage.totalOpen`, printed in the band, in the tile and in the cap sentence.
  const matchesFilters = (row: ReconciliationBreakRow) =>
    (sourceFilter === null || row.source === sourceFilter) && (classFilter === null || row.classification === classFilter);
  const breaksOnThePage = openPage.rows.filter(matchesFilters);

  // The rows arrive oldest first, so the first of them is the oldest break the page holds, and
  // that stays exact even when the read was capped.
  const oldestBreak = openPage.rows.length > 0 ? openPage.rows[0].firstSeenAt : null;
  const oldestClearingEntry = clearingBalances.reduce<Date | null>(
    (oldest, balance) => (oldest === null || balance.oldestEntryAt < oldest ? balance.oldestEntryAt : oldest),
    null,
  );
  const latestRunOf = (source: string) => runs.find((run) => run.source === source) ?? null;
  // The whole open set, by source, counted in SQL. It is the sentence behind the "To act on"
  // figure rather than two tiles of its own (cycle 2, decision 2).
  const openBySourceSentence = SOURCES.map(
    (source) => `${SOURCE_NAME[source]} ${openBreaksBySource[source] ?? 0}`,
  ).join(", ");

  // The row the reader clicked a reference in, whatever list it is in. A provider-only payment
  // has no operation in this database, so the drawer would answer "nothing matches" for every
  // reference this table offers (round 1, HIGH). It is handed the row's own facts instead.
  const rowOfReference =
    inspected === null
      ? undefined
      : [...openPage.rows, ...probes.rows, ...explained.rows].find((row) => referenceOf(row) === inspected);
  const inspectorContext: InspectorContext | undefined = rowOfReference
    ? {
        title: "What this screen knows about it",
        sentence:
          rowOfReference.ledgerRef === null
            ? "No operation in this database carries this reference: the money exists only at the provider. These are the facts the run recorded."
            : "These are the facts the latest run recorded about it.",
        facts: [
          { label: "Provider reference", value: rowOfReference.providerRef ?? "none" },
          { label: "Ledger operation id", value: rowOfReference.ledgerRef ?? "none" },
          { label: "At the provider", value: amountText(rowOfReference.providerAmountCents) },
          { label: "In the ledger", value: amountText(rowOfReference.ledgerAmountCents) },
          { label: "Source", value: `${SOURCE_NAME[rowOfReference.source] ?? rowOfReference.source}, ${SOURCE_MODE[rowOfReference.source]}` },
          { label: "Classification", value: rowOfReference.classification.replace(/_/g, " ") },
          { label: "First seen", value: rowOfReference.firstSeenAt.toISOString() },
          { label: "What the run says", value: noteInDollars(rowOfReference.note) },
        ],
      }
    : undefined;

  const toasts = toastsFromQuery(query, {
    error: { tone: "error", title: "Refused" },
    ran: { tone: "ok", title: "Reconciliation finished" },
    // The explain route redirects here with the key it filed the note under. The link goes back
    // to the row, in the breaks view, where the note now sits under "Explained breaks".
    explained: {
      tone: "ok",
      title: "Break explained",
      href: (breakKey) => `${withParams(PATH, query, { view: "breaks", inspect: null, explained: null })}#break-${breakKey}`,
      hrefLabel: "See the break",
    },
  });

  const views = VIEWS.map((one) => ({
    key: one,
    label: VIEW_LABEL[one],
    href: withParams(PATH, query, { view: one, inspect: null, all: null }),
    current: one === view,
    // A count in the navigation is a count of work waiting, never a count of records (cycle 2,
    // decision 3): the breaks to act on are the only figure here somebody has to act on.
    count: one === "breaks" ? openPage.totalOpen : undefined,
  }));

  return (
    <PortalShell
      user={user}
      active="reconciliation"
      views={views}
      toasts={toasts}
      inspector={
        inspected ? (
          <Inspector
            reference={inspected}
            closeHref={closeInspectorHref(PATH, query)}
            user={user}
            now={now}
            context={inspectorContext}
          />
        ) : undefined
      }
      band={{
        title: "Reconciliation",
        // No chip on a list screen (Yoann, 2026-09-09): the breaks to act on are the first tile
        // and the sidebar badge, the probes are the second tile, and a failed latest run keeps
        // its own sentence in the notices below, which no dismissed toast can hide.
        actions: (
          <form method="post" action="/api/jobs/reconcile" className="inline-form">
            <SubmitButton className="orange">Reconcile both sources now</SubmitButton>
          </form>
        ),
      }}
    >
      {/* The toasts above are the glance; these sentences stay in the page, because the review
          scripts read them and because a failed latest run must survive a dismissed toast. */}
      {query.error || query.ran || query.explained || sourcesWhoseLatestRunFailed.length > 0 ? (
        <div className="notices">
          {query.error ? (
            <p className="error" role="alert">
              {firstValue(query.error)}
            </p>
          ) : null}
          {query.ran ? <p className="note">Run finished: {firstValue(query.ran)}</p> : null}
          {query.explained ? (
            <p className="note">
              Break {firstValue(query.explained)} is explained. It is no longer counted as a break to act on and it has
              left the operations inbox. Nothing was repaired: it is listed below with your note, and every later run
              compares it again exactly as before.
            </p>
          ) : null}
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
          <FailureLine attempted={openRead} />
          {/* Three tiles: what to act on, what is planted, and how old the oldest is. The split by
              source is the WHOLE open set, counted in SQL, and it is the sentence behind the first
              figure rather than two tiles of its own (cycle 2, decision 2). */}
          <Stats>
            <Stat
              label="To act on"
              value={openPage.totalOpen}
              tone={openPage.totalOpen > 0 ? "warn" : "ok"}
              note="not a probe, nobody has explained it"
              hint={`By source, over every open break: ${openBySourceSentence}`}
            />
            <Stat
              label="Probes"
              value={probes.totalProbes}
              note="planted by our own check runs"
              hint="Payments the check script puts at the provider on purpose. They are reported for ever and are not breaks to act on."
            />
            <Stat
              label="Oldest"
              value={oldestBreak ? <When instant={oldestBreak} now={now} /> : "none"}
              note="since it was first reported"
            />
          </Stats>

          <BreakTable
            rows={breaksOnThePage}
            now={now}
            query={query}
            inspected={inspected}
            ariaLabel="Open breaks"
            ageColumn="Open for"
            anchorRows
            explain={canExplain}
            menuPrefix="open"
            empty={
              runs.length === 0 ? (
                <EmptyState illustration="all-clear">No reconciliation has ever run. Press Reconcile both sources now.</EmptyState>
              ) : openPage.totalOpen === 0 ? (
                <EmptyState illustration="all-clear">No break to act on. The latest completed run of each source found every record.</EmptyState>
              ) : (
                <EmptyState illustration="closed-folder">No break to act on matches this filter.</EmptyState>
              )
            }
            toolbar={
              <Toolbar>
                <ToolbarGroup label="Source">
                  <FilterChip href={withParams(PATH, query, { source: null, all: null })} active={sourceFilter === null} count={openPage.rows.length}>
                    All
                  </FilterChip>
                  {SOURCES.map((source) => (
                    <FilterChip
                      key={source}
                      href={withParams(PATH, query, { source, all: null })}
                      active={sourceFilter === source}
                      count={openPage.rows.filter((row) => row.source === source).length}
                    >
                      {SOURCE_NAME[source]}
                    </FilterChip>
                  ))}
                </ToolbarGroup>
                <ToolbarGroup label="Class">
                  <FilterChip href={withParams(PATH, query, { class: null, all: null })} active={classFilter === null} count={openPage.rows.length}>
                    All
                  </FilterChip>
                  {BREAK_CLASSES.map((name) => (
                    <FilterChip
                      key={name}
                      href={withParams(PATH, query, { class: name, all: null })}
                      active={classFilter === name}
                      count={openPage.rows.filter((row) => row.classification === name).length}
                    >
                      {name.replace(/_/g, " ")}
                    </FilterChip>
                  ))}
                </ToolbarGroup>
                <ToolbarSpacer />
                <ToolbarCount>
                  {breaksOnThePage.length} of {openPage.totalOpen}
                </ToolbarCount>
              </Toolbar>
            }
            footer={
              <>
                {/* The cap is said, never hidden: the read is bounded and the number it did not
                    draw is the number that matters (review findings F-B10-07 and F-LS-01). */}
                {openPage.capped ? (
                  <p className="note money-cap">
                    Showing the {openPage.rows.length} oldest of {openPage.totalOpen} breaks to act on. The rest are on
                    file and counted; nothing was dropped.
                  </p>
                ) : null}
                <MoreRows
                  shown={openPage.rows.length}
                  total={openPage.totalOpen}
                  href={withParams(PATH, query, { all: "1" })}
                  label="Show every break to act on"
                />
              </>
            }
          />

          {/* The two lists below are DISJOINT from the list to act on, by construction in SQL
              (lib/reconciliation/read.ts): a record is in exactly one of the three. They are here
              so that nothing is hidden, and apart so that nothing is counted twice. */}
          <h2 className="money-heading">Probe payments from check runs</h2>
          <FailureLine attempted={probeRead} />
          <ProbeTable rows={probes.rows} now={now} query={query} inspected={inspected} />
          {probes.capped ? (
            <p className="note money-explainer">
              Showing the {probes.rows.length} oldest of {probes.totalProbes} probe payments. The rest are on file and
              counted; nothing was dropped.
            </p>
          ) : null}
          {/* One line, because About says the rest: a paragraph of seven lines sat between two
              tables (cycle 2, decision 9). */}
          <p className="note money-explainer">
            Payments our own check script plants at the provider on purpose. No ledger entry can explain one, so they
            are reported for ever and are not breaks to act on.
          </p>

          <h2 className="money-heading">Explained breaks</h2>
          <FailureLine attempted={explainedRead} />
          <ExplainedTable rows={explained.rows} now={now} query={query} inspected={inspected} />
          {explained.capped ? (
            <p className="note money-explainer">
              Showing {explained.rows.length} of {explained.totalExplained} explained breaks, most recently explained
              first. The rest are on file and counted; nothing was dropped.
            </p>
          ) : null}
        </>
      ) : null}

      {view === "runs" ? (
        <>
          <FailureLine attempted={runsRead} />
          {/* One tile per source: when the last run of that source finished, and whether it
              worked. The number of runs drawn is not something a person acts on, so it is not a
              tile any more (cycle 2, decision 2). */}
          <Stats>
            {SOURCES.map((source) => {
              const latest = latestRunOf(source);
              return (
                <Stat
                  key={source}
                  label={`Latest ${SOURCE_NAME[source]} run`}
                  value={latest ? <When instant={latest.finishedAt} now={now} /> : "never"}
                  tone={latest?.status === "failed" ? "warn" : "neutral"}
                  note={latest ? latest.status : SOURCE_MODE[source]}
                />
              );
            })}
          </Stats>

          {/* The table and the form that feeds it, side by side (round 1, MEDIUM: the form sat
              alone in a 1450 px row). No chart: two bar charts of the same twelve runs restated
              the two columns beside them (cycle 2, decision 4). */}
          <div className="layout-2">
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
                        {/* Never "0 breaks" on a failed run: it has no result at all, only a
                            reason. And the probes this run saw are named beside the breaks rather
                            than added to them (finding F-YA-10). */}
                        <Num sub={run.status === "failed" ? "no comparison" : describeRunResult(run.counts.probe, breakCount)}>
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
                        { label: "Probe", value: run.counts.probe },
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

          {/* Same action, same two field names as before; only the button became a SubmitButton
              (F-YA-09). */}
          <div className="card">
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
          </div>
        </>
      ) : null}

      {view === "clearing" ? (
        <>
          <FailureLine attempted={clearingRead} />
          {/* One tile (cycle 2, decision 2): how many accounts are not back at zero. The oldest
              entry and the amount of each balance are columns of the table under it. */}
          <Stats>
            <Stat
              label="Open balances"
              value={clearingBalances.length}
              tone={clearingBalances.length > 0 ? "warn" : "ok"}
              note="clearing accounts not back at zero"
              hint={
                oldestClearingEntry
                  ? `The oldest of them started ${utc(oldestClearingEntry)} UTC. These accounts hold money moving in opposite directions, so they are counted, never added up.`
                  : "These accounts hold money moving in opposite directions, so they are counted, never added up."
              }
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
          <FailureLine attempted={resolvedRead} />
          {/* One tile: the breaks still open are the subject of the first view and its badge. */}
          <Stats>
            <Stat
              label="Resolved"
              value={resolved.length}
              tone="ok"
              note={`newest ${HOW_MANY_RESOLVED_SHOWN}`}
              hint="A later completed run of the same source, whose window covered the record, no longer reports it. Nothing was deleted."
            />
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
        <h4>What counts as a break to act on</h4>
        <p>
          Everything a completed run reported as anything but matched, that no later run has explained, that is not a
          probe from one of our own check runs and that nobody has written a note on. A break leaves the list only when
          a later completed run of the same source, whose window covers the date of the record, no longer reports it. A
          break nobody has looked at again stays open, however old it gets. The age is counted from the first run that
          ever reported it. This is the number the sidebar badge and the operations inbox show.
        </p>
        <h4>What a note does, and what it does not do</h4>
        <p>
          A note says that a staff operations user looked at this break and knows what it is. It repairs nothing: no
          money moves, no journal entry is posted, and no reconciliation row is edited or deleted. The break is still
          compared by every later run and it stays listed, with the note, its author and its date. The only thing that
          changes is that it stops being counted as a break to act on and leaves the operations inbox. Notes are
          append-only: a correction is a second note, and the latest one is shown.
        </p>
        <h4>Why a break comes back after a note</h4>
        <p>
          A note explains the break as the latest run described it: its classification and its two amounts are recorded
          on it. The day a run reports the same break differently, no note matches any more and the break returns to the
          list to act on, with the earlier note beside it in its expansion. A note written before this build recorded
          what it explained matches nothing, so its break needs explaining again as it stands today.
        </p>
        <h4>Probe payments</h4>
        <p>
          Every run of <code>npm run check:reconciliation</code> puts one real PaymentIntent of $42.42 into the Stripe
          sandbox with a test card and no operation id, to prove the comparison finds money at a provider with nothing
          behind it in our books. No ledger entry will ever explain one, so they are reported for ever and counted
          apart from the breaks to act on. They are not hidden: they are listed and counted in their own table, and a
          real provider-only break appears in the table of breaks to act on and not in that one.
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
          breaks are still listed: they were never deleted, they simply stopped being found. Explaining a break is not
          repairing it either.
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

// The break table, rendered for the breaks to act on and for the resolved ones. `ariaLabel` names
// the scrolling region and `ageColumn` names the last column: a name generated from a counter had
// both of them announced as "Reconciliation table 3" (review finding F-B13-33).
function BreakTable({
  rows,
  now,
  query,
  inspected,
  ariaLabel,
  ageColumn,
  anchorRows = false,
  explain = false,
  menuPrefix = "row",
  empty,
  toolbar,
  footer,
}: {
  // A row of the open list may carry a note that no longer explains it (review finding
  // F-BREAKSBOARD-01); the resolved rows arrive without the field.
  rows: (ReconciliationBreakRow & { supersededExplanation?: SupersededExplanation | null })[];
  now: Date;
  query: Query;
  inspected: string | null;
  ariaLabel: string;
  ageColumn: string;
  // Only the open list carries the anchors the inbox links to; the same key in two tables of the
  // same page would be the same id twice.
  anchorRows?: boolean;
  // Adds the note form, in the row's menu. Off on the resolved table: a break that stopped being
  // reported has nothing left to explain. Off for everybody but staff operations.
  explain?: boolean;
  // Makes the menu ids of this table unique on the page, and valid as a CSS anchor name: a break
  // key carries a `|` and a `:`, which cannot go in one.
  menuPrefix?: string;
  empty: React.ReactNode;
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const columns = explain ? 7 : 6;
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
          {explain ? <th className="dt-actions" aria-label="Explain this break" /> : null}
        </tr>
      </thead>
      {rows.length === 0 ? (
        <tbody>
          <tr>
            <td colSpan={columns + 1} className="dt-empty">
              {empty}
            </td>
          </tr>
        </tbody>
      ) : (
        rows.map((row, index) => {
          const reference = referenceOf(row);
          return (
            <ExpandRow
              key={`${row.breakKey}-${row.lastReportedAt.toISOString()}`}
              // The id another screen links one break by: the inbox sends an operator straight to
              // the row of the break it is telling them about (lib/inbox/sections.ts). The break
              // key is the identity the runs file a break under, so the anchor survives a later
              // run reporting it again.
              id={anchorRows ? `break-${row.breakKey}` : undefined}
              selected={inspected === reference}
              columns={columns}
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
                  {explain ? (
                    <td className="dt-actions">
                      <ExplainForm breakKey={row.breakKey} menuId={`${menuPrefix}-${index}`} />
                    </td>
                  ) : null}
                </>
              }
            >
              {/* What the classification means is defined once, in the legend under the table, and
                  is not repeated on every row; the note prints its amounts as dollars like every
                  other figure on the screen (round 1, MEDIUM). */}
              <FactGrid
                items={[
                  { label: "Difference", value: money(row.differenceCents) },
                  { label: "First seen", value: `${utc(row.firstSeenAt)} UTC` },
                  { label: "Last reported", value: `${utc(row.lastReportedAt)} UTC` },
                  { label: "What the run says", value: noteInDollars(row.note), wide: true },
                  {
                    label: "References",
                    wide: true,
                    value: (
                      <span className="money-references">
                        {[
                          { label: "Provider reference", value: row.providerRef },
                          { label: "Ledger operation id", value: row.ledgerRef },
                          { label: "Break key", value: row.breakKey },
                        ].map((reference) => (
                          <span key={reference.label}>
                            {reference.label}{" "}
                            {reference.value === null ? (
                              <span className="dt-muted">none</span>
                            ) : (
                              <Ref value={reference.value} />
                            )}
                          </span>
                        ))}
                      </span>
                    ),
                  },
                ]}
              />
              {row.supersededExplanation ? <SupersededLine row={row} explanation={row.supersededExplanation} /> : null}
            </ExpandRow>
          );
        })
      )}
    </DataTable>
  );
}

// A note somebody wrote on this break that no longer explains it, said inside the row's expansion.
//
// Two different things put a break back on the list to act on with a note beside it, and the
// operator must be able to tell them apart (review finding F-BREAKSBOARD-08). A note that RECORDS
// a classification no longer matches the break, so something about the report did change and
// "changed since" is the true heading. A note with no recorded classification predates migration
// 0025: nothing changed, we simply cannot know what that note was about.
function SupersededLine({
  row,
  explanation,
}: {
  row: ReconciliationBreakRow;
  explanation: SupersededExplanation;
}) {
  return (
    <p className="dt-sub">
      {explanation.explainedClassification ? (
        <>
          <strong>Explained before, and changed since.</strong> {explanation.explainedByName} wrote &ldquo;
          {explanation.note}&rdquo; on {utc(explanation.recordedAt)}, when the run reported this break as{" "}
          {explanation.explainedClassification.replace(/_/g, " ")}. The latest run reports it as{" "}
          {row.classification.replace(/_/g, " ")}, so it is work again.
        </>
      ) : (
        <>
          <strong>Explained before this build recorded what was explained.</strong> {explanation.explainedByName} wrote
          &ldquo;{explanation.note}&rdquo; on {utc(explanation.recordedAt)}, before a note recorded which report it
          explained. No run has reported anything different; the note simply cannot be matched against this break as it
          stands, so it needs explaining again as it stands today.
        </>
      )}{" "}
      The note is still on file; nothing was edited or deleted.
    </p>
  );
}

// The note form of one row, in that row's menu. Staff operations only on the screen, and the route
// reads the session and refuses everybody else again (lib/reconciliation/break-notes.ts): the form
// being hidden is a courtesy, the server is the control.
//
// The break key goes in the path and is encoded here: it carries a `|` and a `:`.
function ExplainForm({ breakKey, menuId }: { breakKey: string; menuId: string }) {
  return (
    <RowMenu id={menuId} label="Explain this break">
      <span className="pop-title">Explain this break</span>
      <form
        method="post"
        action={`/api/reconciliation/breaks/${encodeURIComponent(breakKey)}/explain`}
        className="card money-explain"
      >
        <label htmlFor={`note-${menuId}`}>
          What is this break? ({NOTE_MINIMUM_CHARACTERS} to {NOTE_MAXIMUM_CHARACTERS} characters)
        </label>
        <textarea
          id={`note-${menuId}`}
          name="note"
          rows={3}
          minLength={NOTE_MINIMUM_CHARACTERS}
          maxLength={NOTE_MAXIMUM_CHARACTERS}
          required
        />
        <SubmitButton className="secondary">Explain this break</SubmitButton>
      </form>
    </RowMenu>
  );
}

// The probes still being reported: four columns, because a probe has no ledger side to compare
// and no classification to read. The amount is the provider's, which is the only one there is.
function ProbeTable({
  rows,
  now,
  query,
  inspected,
}: {
  rows: ReconciliationBreakRow[];
  now: Date;
  query: Query;
  inspected: string | null;
}) {
  return (
    <DataTable ariaLabel="Probe payments">
      <thead>
        <tr>
          <th>Reference</th>
          <th className="num">Amount</th>
          <th className="nowrap">First seen</th>
          <th className="nowrap">Run</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={4} className="dt-empty">
              <EmptyState illustration="all-clear">No probe payment is being reported.</EmptyState>
            </td>
          </tr>
        ) : (
          rows.map((row) => {
            const reference = referenceOf(row);
            return (
              <Row key={row.breakKey} selected={inspected === reference}>
                <td>
                  <Ref value={reference} inspectHref={inspectHref(PATH, query, reference)} open={inspected === reference} />
                </td>
                <Num>{money(row.providerAmountCents)}</Num>
                <td className="nowrap">
                  <When instant={row.firstSeenAt} now={now} mode="utc" />
                </td>
                <td className="nowrap">
                  <When instant={row.lastReportedAt} now={now} />
                  <span className="dt-sub">{SOURCE_NAME[row.source] ?? row.source}</span>
                </td>
              </Row>
            );
          })
        )}
      </tbody>
    </DataTable>
  );
}

// The explained breaks: the same record, plus the note that took it out of the list to act on,
// who wrote it and when. Nothing here says a break was repaired.
function ExplainedTable({
  rows,
  now,
  query,
  inspected,
}: {
  rows: ExplainedBreakRow[];
  now: Date;
  query: Query;
  inspected: string | null;
}) {
  return (
    <DataTable ariaLabel="Explained breaks">
      <thead>
        <tr>
          <th>Reference</th>
          <th>Classification</th>
          <th>What an operator says it is</th>
          <th>Explained by</th>
          <th className="nowrap">Explained</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={5} className="dt-empty">
              <EmptyState illustration="closed-folder">Nobody has written a note on a break yet.</EmptyState>
            </td>
          </tr>
        ) : (
          rows.map((row) => {
            const reference = referenceOf(row);
            return (
              <Row key={`${row.breakKey}-${row.explanation.recordedAt.toISOString()}`} selected={inspected === reference}>
                <td>
                  <Ref value={reference} inspectHref={inspectHref(PATH, query, reference)} open={inspected === reference} />
                </td>
                <td>
                  <Chip tone="neutral">{row.classification.replace(/_/g, " ")}</Chip>
                </td>
                <td>
                  {row.explanation.note}
                  {row.explanation.noteCount > 1 ? (
                    <span className="dt-sub">
                      latest of {row.explanation.noteCount} notes on this break; the earlier ones are on file
                    </span>
                  ) : null}
                </td>
                <td>{row.explanation.explainedByName}</td>
                <td className="nowrap">
                  <When instant={row.explanation.recordedAt} now={now} mode="both" />
                </td>
              </Row>
            );
          })
        )}
      </tbody>
    </DataTable>
  );
}

// What one completed run found, in the words the board uses everywhere: the probes it saw named
// beside the breaks to act on, never added to them. A run that saw no probe says nothing about
// them rather than printing a zero.
function describeRunResult(probeCount: number, breakCount: number): string {
  const probes = probeCount > 0 ? `${probeCount} ${probeCount === 1 ? "probe" : "probes"}, ` : "";
  const breaks =
    breakCount === 0 ? "no break to act on" : breakCount === 1 ? "1 break to act on" : `${breakCount} breaks to act on`;
  return `${probes}${breaks}`;
}

// A missing amount is a side that has no record at all, which is not the same as zero.
function money(amountCents: number | null) {
  return amountCents === null ? <span className="dt-muted">no record</span> : formatCentsAsUsd(amountCents);
}

// The same answer as `money`, as plain text, for the drawer's fact list.
function amountText(amountCents: number | null): string {
  return amountCents === null ? "no record" : formatCentsAsUsd(amountCents);
}

// The reference a row is known by on this screen, and the value its inspector link carries.
function referenceOf(row: ReconciliationBreakRow): string {
  return row.providerRef ?? row.ledgerRef ?? row.breakKey;
}

// The note the comparison stored counts in cents ("a payment of 10000 cents"), beside the
// $100.00 the same row prints (round 1, MEDIUM). The stored text is untouched in the database;
// this is presentation only, and it is the same figure in the currency every other amount on the
// screen uses. A number too large to be an exact integer is left exactly as it was stored.
function noteInDollars(note: string): string {
  return note.replace(/(-?\d+) cents/g, (whole, cents: string) => {
    const amountCents = Number(cents);
    return Number.isSafeInteger(amountCents) ? formatCentsAsUsd(amountCents) : whole;
  });
}

function utc(instant: Date): string {
  return instant.toISOString().replace("T", " ").slice(0, 19);
}

function calendarDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}
