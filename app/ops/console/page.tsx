import "@/app/styles/console.css";
import Link from "next/link";
import { BookOpenText, Gauge, Rss, Search, ServerCog, TriangleAlert } from "lucide-react";
import { ConsoleAutoRefresh } from "./auto-refresh";
import { PortalShell } from "@/components/portal-shell";
import { Chip } from "@/components/detail-layout";
import { ActivityTable, EventTable, FailureLine, IntegrationModes, RecoveryCell, describeMinutes, formatSeconds } from "@/components/console-parts";
import { About } from "@/components/ui/about";
import { Bars, Chart, ChartRow, HBars } from "@/components/ui/charts";
import { EmptyState } from "@/components/ui/empty";
import { Inspector } from "@/components/ui/inspector";
import { Legend } from "@/components/ui/legend";
import { Stat, Stats } from "@/components/ui/stat";
import { DataTable, ExpandHead, ExpandRow, FactGrid, Num, Ref, Row } from "@/components/ui/table";
import { When } from "@/components/ui/time";
import { FilterChip, Toolbar, ToolbarCount, ToolbarGroup, ToolbarSpacer } from "@/components/ui/toolbar";
import { sql } from "@/db/client";
import { requireStaff } from "@/lib/console/guard";
import {
  CONSOLE_EVENT_KINDS,
  MOST_ACTIVITY_ROWS,
  MOST_FEED_ROWS,
  MOST_LATENCY_ROUTES,
  MOST_PROBLEM_ROWS,
  UNKNOWN_OUTCOME_AFTER_MINUTES,
  UNRESOLVED_OPERATIONS_FLOOR_DAYS,
  LATENCY_WINDOW_HOURS,
  acceptedAndUnconfirmedOperations,
  consoleFeed,
  isConsoleEventKind,
  latencyByRoute,
  latencyTiles,
  operationsProblems,
  parseSince,
  refusedAndFailedActivity,
  type ConsoleEventKind,
  type ProblemFamily,
} from "@/lib/console/read";
import { attempt, valueOr } from "@/lib/console/safe-read";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { closeInspectorHref, firstValue, inspectHref, inspectedReference, pickView, withParams, type Query } from "@/lib/ui/views";

// /ops/console: the operations cockpit.
//
// WHAT IT IS FOR. One screen an operator keeps open while something is happening: what the
// system is doing right now, how long each step is taking, and everything that failed or is
// still unresolved, with the recovery action that already exists next to each line.
//
// THREE VIEWS, ONE URL. `?view=feed` (the default), `?view=problems`, `?view=latency`. Only the
// current view is rendered, and the section navigation on the left lists the three plus the
// sibling screens of the console. Every filter stays in the query string, so a filtered console
// can be pasted into a ticket.
//
// LIVE, AND ONLY WHILE IT IS ON SCREEN. A ten-second timer that lives in a small client
// component (./auto-refresh.tsx) asks the SERVER to render this page again; nothing is computed
// in the browser. The timer is cleared when the console is left, which is the correction of
// UI-025: the <meta http-equiv="refresh"> this replaces kept counting after the user had
// navigated away and brought them back to the console. A "Refresh now" button (a plain GET form)
// is there for the moment ten seconds is too long to wait, and it keeps the query string, so the
// view and the filters survive it.
//
// READ ONLY. Nothing on this page writes. The only forms that post are the ones that already
// exist elsewhere, re-rendered next to the problem they repair: the reconciliation "Run now" of
// /ops/reconciliation and the KYB re-read of /ops/brokers. Everything else is a link to the
// screen that owns the action.
//
// SOLID BY CONSTRUCTION. Every read goes through `attempt` (lib/console/safe-read.ts): a block
// whose query fails prints one red line and the rest of the page still renders. Every query is
// bounded, and the feed can never return more than MOST_FEED_ROWS rows.

const PATH = "/ops/console";

const VIEWS = ["feed", "problems", "latency"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Record<View, string> = { feed: "Feed", problems: "Problems", latency: "Latency" };
const VIEW_ICON = { feed: Rss, problems: TriangleAlert, latency: Gauge };

// The windows an operator actually asks for, as chips. An empty `since` means the last hour,
// which is what lib/console/read.ts parseSince does, so "1 hour" is the chip lit by default.
const WINDOWS = [
  { value: "15m", label: "15 min" },
  { value: "1h", label: "1 hour" },
  { value: "6h", label: "6 hours" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
] as const;

const KIND_LABEL: Record<ConsoleEventKind, string> = {
  money: "Money",
  webhook: "Webhooks",
  journal: "Journal",
  policy: "Policy",
  claim: "Claims",
  approval: "Approvals",
  reconciliation: "Reconciliation",
  statement: "Statements",
  mcp: "MCP",
  kyb: "Verification",
  change_request: "Change requests",
};

const FAMILY_LABEL: Record<ProblemFamily, string> = {
  money: "Money",
  webhook: "Webhooks",
  mcp: "MCP",
  reconciliation: "Reconciliation",
  unknown_outcome: "Unknown outcome",
};
const FAMILIES = Object.keys(FAMILY_LABEL) as ProblemFamily[];

// The feed's slices, drawn from the rows this page already read and from nothing else.
const FEED_SLICES = 16;

// The link that toggles one kind on or off while keeping the others. `withParams` cannot express
// a repeated parameter, so the kinds are appended by hand after it has written everything else.
function hrefWithKinds(query: Query, kinds: ConsoleEventKind[]): string {
  const withoutKinds = withParams(PATH, { ...query, kind: undefined }, { inspect: null });
  const questionMark = withoutKinds.indexOf("?");
  const params = new URLSearchParams(questionMark === -1 ? "" : withoutKinds.slice(questionMark + 1));
  for (const kind of kinds) params.append("kind", kind);
  params.sort();
  const written = params.toString();
  return written === "" ? PATH : `${PATH}?${written}`;
}

export default async function OperationsConsolePage({ searchParams }: { searchParams: Promise<Query> }) {
  const user = await requireStaff();
  const query = await searchParams;
  const view = pickView(query.view, VIEWS);

  const now = new Date();
  const { since, reading } = parseSince(firstValue(query.since), now);
  // The parameter is named `kind` and may repeat: one value arrives as a string, several as an
  // array. Anything that is not one of the known kinds is dropped rather than passed to a reader.
  const selectedKinds = (Array.isArray(query.kind) ? query.kind : query.kind ? [query.kind] : []).filter(isConsoleEventKind);
  const sinceText = (firstValue(query.since) ?? "").trim();
  const inspected = inspectedReference(query.inspect);

  // Read FIRST and alone, because two blocks are built from the same rows: "being checked" shows
  // the operations under the threshold, and the problems view shows the ones over it as unknown
  // outcomes. Reading it once and passing it down is the correction of review finding F-B13-23;
  // before it, this page asked the same question twice on every ten-second refresh.
  //
  // It takes no cursor (review finding F-B13-50): an operation nobody has confirmed stays on
  // this page until a human resolves it, whatever window the operator is reading the feed in.
  const inFlight = await attempt("the operations in flight", acceptedAndUnconfirmedOperations(sql));
  const { checking, unknownOutcome } = valueOr(inFlight, { checking: [], unknownOutcome: [] });

  const [feed, tiles, problems, refusedActions, routeLatency] = await Promise.all([
    attempt("the feed", consoleFeed(sql, { since, kinds: selectedKinds, limit: MOST_FEED_ROWS })),
    attempt("the latency tiles", latencyTiles(sql)),
    attempt("the errors and unknowns", operationsProblems(sql, { since, unknownOutcome })),
    // Console v2 (migration 0021): what the application refused or failed to answer, and how
    // long each route takes. Both read activity_log and nothing else.
    attempt("the refused and failed actions", refusedAndFailedActivity(sql, { since, limit: MOST_ACTIVITY_ROWS })),
    attempt("the latency by route", latencyByRoute(sql)),
  ]);

  const events = valueOr(feed, []);
  const problemRows = valueOr(problems, []);
  const refusedRows = valueOr(refusedActions, []);
  const latencyRows = valueOr(tiles, []);
  const routeRows = valueOr(routeLatency, []);

  // How many events landed in each slice of the window. The rows are the ones already read, so
  // this picture costs no query; it therefore shows the shape of AT MOST MOST_FEED_ROWS events,
  // which the About says.
  const windowStartMs = since.getTime();
  const sliceMs = Math.max(1, Math.round((now.getTime() - windowStartMs) / FEED_SLICES));
  const sliceCounts = new Array<number>(FEED_SLICES).fill(0);
  for (const event of events) {
    const slice = Math.floor((event.instant.getTime() - windowStartMs) / sliceMs);
    if (slice >= 0) sliceCounts[Math.min(FEED_SLICES - 1, slice)] += 1;
  }
  const clockLabelOf = (index: number) => {
    const iso = new Date(windowStartMs + index * sliceMs).toISOString();
    if (sliceMs < 60_000) return iso.slice(14, 19); // MM:SS
    if (sliceMs < 3_600_000) return iso.slice(11, 16); // HH:MM
    if (sliceMs < 86_400_000) return `${iso.slice(8, 10)} ${iso.slice(11, 13)}`; // DD HH
    return iso.slice(5, 10); // MM-DD
  };
  const clockLabels = sliceCounts.map((_, index) => clockLabelOf(index));
  // A very short window can put two slices inside the same clock label. The chart then numbers
  // the slices rather than printing the same label twice, which would also collide as a key.
  const sliceLabels = new Set(clockLabels).size === clockLabels.length ? clockLabels : sliceCounts.map((_, index) => String(index + 1));

  const countOfFamily = (family: ProblemFamily) => problemRows.filter((problem) => problem.family === family).length;
  const toLookAt = problemRows.length;

  // The hidden inputs that make "Refresh now" keep the current view and filters. The ten-second
  // timer keeps them too, for free: it re-renders this URL rather than navigating to a new one.
  const currentView = (
    <>
      <input type="hidden" name="view" value={view} />
      <input type="hidden" name="since" value={sinceText} />
      {selectedKinds.map((kind) => (
        <input key={kind} type="hidden" name="kind" value={kind} />
      ))}
    </>
  );

  const views = [
    ...VIEWS.map((one) => ({
      key: one,
      label: VIEW_LABEL[one],
      href: withParams(PATH, query, { view: one, inspect: null }),
      current: one === view,
      icon: VIEW_ICON[one],
      count: one === "problems" ? toLookAt : undefined,
    })),
    { key: "ledger", label: "Ledger", href: "/ops/console/ledger", icon: BookOpenText, group: "More" },
    { key: "search", label: "Search", href: "/ops/console/search", icon: Search, group: "More" },
    { key: "infra", label: "Infrastructure", href: "/ops/console/infra", icon: ServerCog, group: "More" },
  ];

  const refOf = (reference: string) => inspectHref(PATH, query, reference);

  return (
    <PortalShell
      user={user}
      active="console"
      views={views}
      viewsSubtitle={reading}
      inspector={inspected ? <Inspector reference={inspected} closeHref={closeInspectorHref(PATH, query)} user={user} now={now} /> : undefined}
      band={{
        title: "Operations console",
        suffix: reading,
        meta: (
          <>
            <Chip tone={toLookAt > 0 ? "warn" : "ok"}>
              {toLookAt >= MOST_PROBLEM_ROWS ? `${MOST_PROBLEM_ROWS} or more to look at` : `${toLookAt} to look at`}
            </Chip>
            <Chip tone={checking.length > 0 ? "warn" : "neutral"}>{checking.length} being checked</Chip>
            <Chip tone="ok">Stripe: LIVE SANDBOX</Chip>
            <Chip tone="neutral">claim rail: LOCAL SIMULATOR</Chip>
          </>
        ),
        actions: (
          <>
            <form method="get" action={PATH} className="inline-form">
              {currentView}
              <button type="submit" className="orange">
                Refresh now
              </button>
            </form>
            <Link href="/ops/console/search" prefetch={false} className="button-link secondary">
              Search
            </Link>
          </>
        ),
      }}
    >
      {/* The ten-second refresh, mounted with this page and cleared when it is left (UI-025). */}
      <ConsoleAutoRefresh everySeconds={10} />

      <IntegrationModes />

      {view === "feed" ? (
        <>
          <FailureLine attempted={feed} />
          <Stats>
            <Stat label="Events" value={events.length} note="in this window" />
            <Stat
              label="Refused or failed"
              value={refusedRows.length}
              tone={refusedRows.length > 0 ? "warn" : "ok"}
              note="requests in this window"
            />
            <Stat
              label="To look at"
              value={toLookAt}
              tone={toLookAt > 0 ? "warn" : "ok"}
              href={withParams(PATH, query, { view: "problems", inspect: null })}
              note="errors and unknowns"
            />
            <Stat label="Being checked" value={checking.length} tone={checking.length > 0 ? "warn" : "neutral"} note="accepted, no answer yet" />
          </Stats>

          <ChartRow>
            <Chart title="Events per slice" figure={events.length}>
              {/* No value on top of each bar: the chart is drawn with preserveAspectRatio="none",
                  so at full width its text is stretched and "100" reads as "1 0 0". The shape is
                  what this picture is for, the total is beside the title, and the exact counts
                  are in the table the chart carries for screen readers. */}
              <Bars
                points={sliceCounts.map((value, index) => ({ label: sliceLabels[index], value }))}
                showValues={false}
                caption={`Events read in this window, split into ${FEED_SLICES} slices, oldest first`}
              />
            </Chart>
          </ChartRow>

          <EventTable
            events={events}
            ariaLabel="Operations feed"
            now={now}
            inspectHref={refOf}
            openReference={inspected}
            toolbar={
              <Toolbar>
                <ToolbarGroup label="Window">
                  {WINDOWS.map((window) => (
                    <FilterChip
                      key={window.value}
                      href={withParams(PATH, query, { since: window.value, inspect: null })}
                      active={sinceText === window.value || (sinceText === "" && window.value === "1h")}
                    >
                      {window.label}
                    </FilterChip>
                  ))}
                  <form method="get" action={PATH}>
                    <input type="hidden" name="view" value={view} />
                    {selectedKinds.map((kind) => (
                      <input key={kind} type="hidden" name="kind" value={kind} />
                    ))}
                    <input
                      id="since"
                      name="since"
                      type="text"
                      defaultValue={sinceText}
                      aria-label="Custom window"
                      placeholder="15m, 2h, 3d, or an instant"
                    />
                    <button type="submit" className="secondary">
                      Apply
                    </button>
                  </form>
                </ToolbarGroup>
                <ToolbarGroup label="Kinds">
                  <FilterChip href={hrefWithKinds(query, [])} active={selectedKinds.length === 0}>
                    All
                  </FilterChip>
                  {CONSOLE_EVENT_KINDS.map((kind) => {
                    const on = selectedKinds.includes(kind);
                    const next = on ? selectedKinds.filter((one) => one !== kind) : [...selectedKinds, kind];
                    return (
                      <FilterChip key={kind} href={hrefWithKinds(query, next)} active={on}>
                        {KIND_LABEL[kind]}
                      </FilterChip>
                    );
                  })}
                </ToolbarGroup>
                <ToolbarSpacer />
                <ToolbarCount>{events.length} events</ToolbarCount>
              </Toolbar>
            }
            legend={
              <Legend
                items={[
                  { term: "When", meaning: "age at a glance, the UTC instant on hover and in the fold" },
                  { term: "Stripe LIVE SANDBOX", meaning: "the row moved money on the real Stripe sandbox" },
                  { term: "LOCAL SIMULATOR", meaning: "the row moved money on a rail simulated in this application" },
                ]}
              />
            }
            footer={
              events.length >= MOST_FEED_ROWS ? (
                <div className="dt-more">Newest {MOST_FEED_ROWS} events, the hard limit of this page.</div>
              ) : undefined
            }
          />
        </>
      ) : null}

      {view === "problems" ? (
        <>
          <FailureLine attempted={problems} />
          <Stats>
            {FAMILIES.map((family) => (
              <Stat
                key={family}
                label={FAMILY_LABEL[family]}
                value={countOfFamily(family)}
                tone={countOfFamily(family) > 0 ? "warn" : "ok"}
                note="in this window"
              />
            ))}
          </Stats>

          <div className="console-problems">
            <DataTable
              ariaLabel="Errors and unknowns"
              toolbar={
                <Toolbar>
                  <ToolbarGroup label="Window">
                    {WINDOWS.map((window) => (
                      <FilterChip
                        key={window.value}
                        href={withParams(PATH, query, { since: window.value, inspect: null })}
                        active={sinceText === window.value || (sinceText === "" && window.value === "1h")}
                      >
                        {window.label}
                      </FilterChip>
                    ))}
                  </ToolbarGroup>
                  <ToolbarSpacer />
                  <ToolbarCount>{problemRows.length} to look at</ToolbarCount>
                </Toolbar>
              }
              legend={
                <Legend
                  items={[
                    { term: "Unknown outcome", meaning: `accepted over ${UNKNOWN_OUTCOME_AFTER_MINUTES} minutes ago, silent since` },
                    { term: "Age", meaning: "how long the line has been in this state" },
                    { term: "Recovery", meaning: "the form or the screen that already repairs it" },
                  ]}
                />
              }
              footer={
                problemRows.length >= MOST_PROBLEM_ROWS ? (
                  <div className="dt-more">{MOST_PROBLEM_ROWS} rows, the hard limit of this view.</div>
                ) : undefined
              }
            >
              <thead>
                <tr>
                  <th className="nowrap">When</th>
                  <th className="nowrap">Age</th>
                  <th>What</th>
                  <th>Reason</th>
                  <th>Reference</th>
                  <th>Recovery</th>
                </tr>
              </thead>
              <tbody>
                {problemRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="dt-empty">
                      <EmptyState illustration="all-clear">Nothing failed and nothing is unresolved.</EmptyState>
                    </td>
                  </tr>
                ) : (
                  problemRows.map((problem, index) => (
                    <Row
                      key={`${problem.family}-${problem.instant.toISOString()}-${index}`}
                      selected={problem.reference != null && problem.reference === inspected}
                    >
                      <td className="nowrap">
                        <When instant={problem.instant} now={now} />
                      </td>
                      <td className="nowrap">{describeMinutes(problem.ageMinutes)}</td>
                      <td>
                        <Chip tone="warn">{problem.title}</Chip>
                        {/* The rail, on the row and never in a fold (AF-02, recheck finding F-RC-08). */}
                        {problem.rail ? <Chip tone="neutral">{problem.rail}</Chip> : null}
                        <span className="dt-sub">{FAMILY_LABEL[problem.family]}</span>
                      </td>
                      <td>
                        <span className="console-reason">{problem.detail}</span>
                      </td>
                      <td>
                        {problem.reference ? (
                          <Ref value={problem.reference} inspectHref={refOf(problem.reference)} open={inspected === problem.reference} />
                        ) : (
                          <span className="dt-muted">none</span>
                        )}
                      </td>
                      <td>
                        <RecoveryCell recovery={problem.recovery} />
                      </td>
                    </Row>
                  ))
                )}
              </tbody>
            </DataTable>
          </div>

          <h2 className="console-heading">Being checked</h2>
          <FailureLine attempted={inFlight} />
          <DataTable
            ariaLabel="Operations being checked"
            legend={
              <Legend
                items={[
                  { term: "Waiting", meaning: "the provider took the request and has not answered yet" },
                  { term: "Floor", meaning: `read over ${UNRESOLVED_OPERATIONS_FLOOR_DAYS} days, whatever window the feed shows` },
                ]}
              />
            }
          >
            <thead>
              <tr>
                <th className="nowrap">Accepted</th>
                <th>Waiting</th>
                <th>Operation</th>
                <th className="num">Amount</th>
                <th>Provider reference</th>
                <th>Object</th>
              </tr>
            </thead>
            <tbody>
              {checking.length === 0 ? (
                <tr>
                  <td colSpan={6} className="dt-empty">
                    <EmptyState illustration="sleeping-corgi">No operation is waiting for its provider.</EmptyState>
                  </td>
                </tr>
              ) : (
                checking.map((operation) => (
                  <Row key={operation.operationId} selected={operation.providerRef != null && operation.providerRef === inspected}>
                    <td className="nowrap">
                      <When instant={operation.acceptedAt} now={now} />
                    </td>
                    <td className="nowrap">
                      {/* The only chip on the console allowed to move: it is a live wait. */}
                      <span className="badge badge-neutral is-live">{describeMinutes(operation.ageMinutes)}</span>
                    </td>
                    <td>
                      {operation.kind}
                      {/* The rail, on the row (AF-02). */}
                      <span className="dt-sub">{operation.rail}</span>
                    </td>
                    <Num>{formatCentsAsUsd(operation.amountCents)}</Num>
                    <td>
                      {operation.providerRef ? (
                        <Ref value={operation.providerRef} inspectHref={refOf(operation.providerRef)} open={inspected === operation.providerRef} />
                      ) : (
                        <span className="dt-muted">none yet</span>
                      )}
                    </td>
                    <td>
                      {operation.claimId ? (
                        <Link href={`/ops/console/claim/${operation.claimId}`} prefetch={false}>
                          {operation.claimNumber ?? "claim"}
                        </Link>
                      ) : operation.policyId ? (
                        <Link href={`/ops/console/policy/${operation.policyId}`} prefetch={false}>
                          {operation.policyNumber ?? "policy"}
                        </Link>
                      ) : (
                        <span className="dt-muted">no object</span>
                      )}
                    </td>
                  </Row>
                ))
              )}
            </tbody>
          </DataTable>
        </>
      ) : null}

      {view === "latency" ? (
        <>
          <FailureLine attempted={tiles} />
          <div className="console-charts">
            <ChartRow>
              <Chart title={`p50 per step, last ${LATENCY_WINDOW_HOURS} h`}>
                <HBars
                  rows={latencyRows.map((tile) => ({ label: tile.name, value: tile.p50Seconds ?? 0, display: formatSeconds(tile.p50Seconds) }))}
                  caption="Median seconds per step"
                />
              </Chart>
              <Chart title={`p95 per step, last ${LATENCY_WINDOW_HOURS} h`}>
                <HBars
                  rows={latencyRows.map((tile) => ({ label: tile.name, value: tile.p95Seconds ?? 0, display: formatSeconds(tile.p95Seconds) }))}
                  caption="95th percentile seconds per step"
                />
              </Chart>
            </ChartRow>
          </div>

          <DataTable
            ariaLabel="Latency by step"
            legend={<Legend items={[{ term: "Samples", meaning: "how many pairs of instants the percentile was computed over" }]} />}
          >
            <thead>
              <tr>
                <ExpandHead />
                <th>Step</th>
                <th className="num">p50</th>
                <th className="num">p95</th>
                <th className="num">max</th>
                <th className="num">Samples</th>
              </tr>
            </thead>
            {latencyRows.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={6} className="dt-empty">
                    <EmptyState illustration="sleeping-corgi">No step was measured in this window.</EmptyState>
                  </td>
                </tr>
              </tbody>
            ) : (
              latencyRows.map((tile) => (
                <ExpandRow
                  key={tile.name}
                  columns={5}
                  cells={
                    <>
                      <td>{tile.name}</td>
                      <Num>{formatSeconds(tile.p50Seconds)}</Num>
                      <Num>{formatSeconds(tile.p95Seconds)}</Num>
                      <Num>{formatSeconds(tile.maxSeconds)}</Num>
                      <Num>{tile.sampleCount}</Num>
                    </>
                  }
                >
                  {/* The sentence naming the two instants that were subtracted stays with its
                      row, in the fold: a table cell is not the place for a sentence. */}
                  <FactGrid items={[{ label: "Measures", value: tile.measures }]} />
                </ExpandRow>
              ))
            )}
          </DataTable>

          <h2 className="console-heading">By route</h2>
          <FailureLine attempted={routeLatency} />
          <DataTable
            ariaLabel="Latency by route"
            legend={<Legend items={[{ term: "Not ok", meaning: "requests on that route the application did not answer with ok" }]} />}
            footer={routeRows.length >= MOST_LATENCY_ROUTES ? <div className="dt-more">{MOST_LATENCY_ROUTES} routes, the hard limit of this view.</div> : undefined}
          >
            <thead>
              <tr>
                <th>Route</th>
                <th className="num">p50</th>
                <th className="num">p95</th>
                <th className="num">max</th>
                <th className="num">Requests</th>
                <th className="num">Not ok</th>
              </tr>
            </thead>
            <tbody>
              {routeRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="dt-empty">
                    <EmptyState illustration="sleeping-corgi">No request was recorded in this window.</EmptyState>
                  </td>
                </tr>
              ) : (
                routeRows.map((route) => (
                  <Row key={route.route}>
                    <td>
                      <code className="ref">{route.route}</code>
                    </td>
                    <Num>{route.p50Ms === null ? "no sample" : `${Math.round(route.p50Ms)} ms`}</Num>
                    <Num>{route.p95Ms === null ? "no sample" : `${Math.round(route.p95Ms)} ms`}</Num>
                    <Num>{route.maxMs === null ? "no sample" : `${route.maxMs} ms`}</Num>
                    <Num>{route.sampleCount}</Num>
                    <Num>{route.notOkCount === 0 ? <span className="dt-muted">0</span> : <Chip tone="warn">{route.notOkCount}</Chip>}</Num>
                  </Row>
                ))
              )}
            </tbody>
          </DataTable>

          <h2 className="console-heading">Refused and failed</h2>
          <FailureLine attempted={refusedActions} />
          <ActivityTable
            rows={refusedRows}
            ariaLabel="Refused and failed actions"
            now={now}
            legend={
              <Legend
                items={[
                  { term: "refused", meaning: "a rule said no: a 4xx, or a redirect carrying the reason" },
                  { term: "error", meaning: "something broke, with the status the caller received" },
                ]}
              />
            }
            footer={refusedRows.length >= MOST_ACTIVITY_ROWS ? <div className="dt-more">{MOST_ACTIVITY_ROWS} rows, the hard limit of this view.</div> : undefined}
          />
        </>
      ) : null}

      <About>
        <h4>The window</h4>
        <p>
          Showing {reading}. All instants are UTC; a cell shows the age and carries the full instant on hover and in its
          fold. The chips set <code>?since=</code>; the field beside them takes a duration such as <code>15m</code>,{" "}
          <code>2h</code> or <code>3d</code>, or a UTC instant. An empty field means the last hour.
        </p>
        <h4>The kinds</h4>
        <p>
          A kind chip adds or removes one kind and keeps the others; <strong>All</strong> clears them. None selected
          means every kind, and an unselected kind costs no query at all.
        </p>
        <h4>The feed is bounded</h4>
        <p>
          The feed can never return more than {MOST_FEED_ROWS} rows, whatever the query string asks for. The slices
          chart is drawn from those rows and from no extra query, so it shows the shape of what was read, not of what
          exists. Narrow the window or the kinds to see the rest.
        </p>
        <h4>What counts as a problem</h4>
        <p>
          A money operation whose last provider answer was <strong>failed</strong> or <strong>unknown</strong>; a
          webhook whose processing row reads <strong>failed</strong> or <strong>ignored</strong>, or that needed more
          than one attempt; an MCP call answered with <strong>error</strong> or <strong>refused</strong>; a{" "}
          <strong>failed reconciliation run</strong>, which compared nothing and must never read as clean; and an
          operation the provider accepted more than {UNKNOWN_OUTCOME_AFTER_MINUTES} minutes ago that has said nothing
          since. The view is bounded at {MOST_PROBLEM_ROWS} rows.
        </p>
        <h4>The fixed floor</h4>
        <p>
          Every problem line is inside the window <strong>except the unknown outcomes</strong>, and every line of Being
          checked: both are read over a fixed floor of {UNRESOLVED_OPERATIONS_FLOOR_DAYS} days, whatever window the feed
          is showing, because an operation nobody has confirmed must stay visible until a human resolves it.
        </p>
        <h4>The {UNKNOWN_OUTCOME_AFTER_MINUTES}-minute threshold</h4>
        <p>
          It is <strong>an assumption of this build</strong>, not a rule of Stripe and not a rule of Corgi. Stripe
          promises no delay. Under it the operation is being checked, over it a human is asked to resolve it, and the
          job that actually resolves one is <code>/api/jobs/recover-operations</code>.
        </p>
        <h4>How the latency figures are produced</h4>
        <p>
          Each step is one <code>percentile_cont</code> computed by Postgres over the whole window; this page adds
          nothing up and the browser computes nothing. A percentile over two or three samples is not a percentile, which
          is why the sample count is on the row. A duration is only measured when both of its instants exist: an
          operation still waiting for its second instant is not a fast one, it is in Being checked.
        </p>
        <h4>Steps and routes measure different things</h4>
        <p>
          The by-route table measures <code>activity_log.duration_ms</code>, the time this application spent inside the
          handler: it excludes the network, the browser and the cold start of a serverless function. The step table
          measures how long an <strong>object</strong> took to move between two states, which includes the provider. A
          route is the URL <strong>pattern</strong> and never a URL with an id in it, so one policy cannot become its own
          row with one sample. Showing at most {MOST_LATENCY_ROUTES} routes.
        </p>
        <h4>Where refused and failed rows come from</h4>
        <p>
          Every route handler, every job and the MCP endpoint are wrapped in one helper (
          <code>lib/observability/log.ts</code>) that writes one append-only row in <code>activity_log</code> and prints
          the same fields as one JSON line in the server log. A row is <strong>refused</strong> when a rule said no, and{" "}
          <strong>error</strong> when something broke. The rule column is named by the route; a request refused before
          that gate names no rule rather than guessing.
        </p>
        <h4>What is never shown</h4>
        <p>
          No provider payload, no secret, and no API key beyond its public <code>cmk_</code> prefix. A failure reason is
          the short sanitised sentence the money path recorded, cut to 220 characters, with emails masked and any bearer
          token, password or <code>sk_</code> secret replaced before it was written. Names and emails are masked to their
          first three characters and revealed by clicking them: the console is staff-only, and this is a reading
          discipline for a screen left open, not a security control.
        </p>
        <h4>Why it re-reads instead of streaming</h4>
        <p>
          A ten-second timer asks the server to render this page again, plus a button when ten seconds is too long. No
          websocket, no polling script and no figure computed in the browser. The timer exists only while the console is
          open and is cleared when you leave it, so an automatic refresh can never pull you back to this screen.
        </p>
        <h4>If a red line appears</h4>
        <p>
          That block&apos;s query failed and the rest of the page still rendered. Nothing was retried and nothing was
          hidden. The console is what an operator opens while something is already broken, so one unreadable table must
          never replace the whole screen with an error page.
        </p>
        <h4>Where each line comes from</h4>
        <p>
          Money operations from <code>money_operations</code> and <code>money_operation_events</code>; webhooks from{" "}
          <code>webhook_events</code> with <code>webhook_processing</code> beside them; journal entries from{" "}
          <code>journal_entries</code> and <code>journal_lines</code>; policy, claim and verification events from{" "}
          <code>policy_events</code>, <code>claim_events</code> and <code>broker_kyb_events</code>; approvals from{" "}
          <code>approval_requests</code> and <code>approval_decisions</code>; reconciliation from{" "}
          <code>reconciliation_runs</code>; statements from <code>statement_runs</code>; MCP calls from{" "}
          <code>mcp_calls</code> joined to <code>mcp_api_keys</code> for the public prefix; change requests from{" "}
          <code>policy_change_requests</code>; refused and failed actions and every latency by route from{" "}
          <code>activity_log</code> (migration 0021).
        </p>
      </About>
    </PortalShell>
  );
}
