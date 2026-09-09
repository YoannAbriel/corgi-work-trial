import "@/app/styles/ops-tables.css";
import Link from "next/link";
import { ConsoleAutoRefresh } from "./auto-refresh";
import { PortalShell } from "@/components/portal-shell";
import { Disclosure } from "@/components/disclosures";
import { AsideList, Chip, DetailGrid, DetailHeading, Empty, Panel } from "@/components/detail-layout";
import { ActivityTable, EventTable, FailureLine, IntegrationModes, RecoveryCell, describeMinutes, formatSeconds, utc } from "@/components/console-parts";
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
} from "@/lib/console/read";
import { attempt, valueOr } from "@/lib/console/safe-read";
import { formatCentsAsUsd } from "@/lib/money/cents";

// /ops/console: the operations cockpit.
//
// WHAT IT IS FOR. One screen an operator keeps open while something is happening: what the
// system is doing right now, how long each step is taking, and everything that failed or is
// still unresolved, with the recovery action that already exists next to each line.
//
// LIVE, AND ONLY WHILE IT IS ON SCREEN. A ten-second timer that lives in a small client
// component (./auto-refresh.tsx) asks the SERVER to render this page again; nothing is computed
// in the browser. The timer is cleared when the console is left, which is the correction of
// UI-025: the <meta http-equiv="refresh"> this replaces kept counting after the user had
// navigated away and brought them back to the console. A "Refresh now" button (a plain GET form)
// is there for the moment ten seconds is too long to wait, and it keeps the query string, so the
// filters survive it.
//
// READ ONLY. Nothing on this page writes. The only forms that post are the ones that already
// exist elsewhere, re-rendered next to the problem they repair: the reconciliation "Run now" of
// /ops/reconciliation and the KYB re-read of /ops/brokers. Everything else is a link to the
// screen that owns the action.
//
// SOLID BY CONSTRUCTION. Every read goes through `attempt` (lib/console/safe-read.ts): a panel
// whose query fails prints one red line and the rest of the page still renders. Every query is
// bounded, and the feed can never return more than MOST_FEED_ROWS rows.

const KIND_LABEL: Record<ConsoleEventKind, string> = {
  money: "money operations",
  webhook: "webhooks",
  journal: "journal entries",
  policy: "policy events",
  claim: "claim events",
  approval: "approvals",
  reconciliation: "reconciliation",
  statement: "statements",
  mcp: "MCP calls",
  kyb: "broker verification",
  change_request: "change requests",
};

export default async function OperationsConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ since?: string; kind?: string | string[] }>;
}) {
  const user = await requireStaff();
  const query = await searchParams;

  const now = new Date();
  const { since, reading } = parseSince(query.since, now);
  // Checkboxes named `kind`: one value arrives as a string, several as an array. Anything that
  // is not one of the known kinds is dropped rather than passed to a reader.
  const selectedKinds = (Array.isArray(query.kind) ? query.kind : query.kind ? [query.kind] : []).filter(isConsoleEventKind);

  // Read FIRST and alone, because two panels are built from the same rows: "being checked" shows
  // the operations under the threshold, and the errors panel shows the ones over it as unknown
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

  // The hidden inputs that make "Refresh now" keep the current view. The ten-second timer keeps
  // it too, for free: it re-renders this URL rather than navigating to a new one.
  const currentView = (
    <>
      <input type="hidden" name="since" value={query.since ?? ""} />
      {selectedKinds.map((kind) => (
        <input key={kind} type="hidden" name="kind" value={kind} />
      ))}
    </>
  );

  return (
    <PortalShell user={user} active="console" trail={[{ label: "Operations console" }]}>
      {/* The ten-second refresh, mounted with this page and cleared when it is left (UI-025). */}
      <ConsoleAutoRefresh everySeconds={10} />

      <DetailHeading
        title="Operations console"
        lead={`Everything the system did, how long it took and what is unresolved. Showing ${reading}. All times UTC. This page reads itself again from the server every 10 seconds while it is open.`}
        chips={
          <>
            <Chip tone={problemRows.length > 0 ? "warn" : "ok"}>
              {problemRows.length === 0
                ? "nothing failing"
                : problemRows.length >= MOST_PROBLEM_ROWS
                  ? `${MOST_PROBLEM_ROWS} or more to look at`
                  : `${problemRows.length} to look at`}
            </Chip>
            <Chip tone={checking.length > 0 ? "warn" : "neutral"}>
              {checking.length} being checked
            </Chip>
            <Chip tone="neutral">{events.length} events in view</Chip>
          </>
        }
        actions={
          <>
            <form method="get" action="/ops/console" className="inline-form">
              {currentView}
              <button type="submit" className="orange">
                Refresh now
              </button>
            </form>
            <Link href="/ops/console/search" prefetch={false} className="button-link">
              Search a reference
            </Link>
            <Link href="/ops/console/infra" prefetch={false} className="button-link">
              Infrastructure
            </Link>
          </>
        }
      />

      <IntegrationModes />

      <Panel title={`How long things are taking, over the last ${LATENCY_WINDOW_HOURS} hours`}>
        <FailureLine attempted={tiles} />
        <div className="table-scroll" role="region" aria-label="Latency" tabIndex={0}>
          <table className="ops-table">
            <thead>
              <tr>
                <th className="col-name">Step</th>
                <th className="amount">p50</th>
                <th className="amount">p95</th>
                <th className="amount">max</th>
                <th className="amount">Samples</th>
                <th className="col-text">What is measured</th>
              </tr>
            </thead>
            <tbody>
              {valueOr(tiles, []).map((tile) => (
                <tr key={tile.name}>
                  <td className="col-name">
                    <strong>{tile.name}</strong>
                  </td>
                  <td className="amount">{formatSeconds(tile.p50Seconds)}</td>
                  <td className="amount">{formatSeconds(tile.p95Seconds)}</td>
                  <td className="amount">{formatSeconds(tile.maxSeconds)}</td>
                  <td className="amount">{tile.sampleCount}</td>
                  <td className="col-text">
                    <span className="note">{tile.measures}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Disclosure title="How these figures are produced">
          <p>
            Each row is one <code>percentile_cont</code> computed by Postgres over the whole window; this page adds
            nothing up and the browser computes nothing. A percentile over two or three samples is not a percentile,
            which is why the sample count is on the row. A duration is only measured when both of its instants exist:
            an operation still waiting for its second instant is not a fast one, it is in the list of what is being
            checked below.
          </p>
        </Disclosure>
      </Panel>

      <Panel title={`Latency by route, over the last ${LATENCY_WINDOW_HOURS} hours`}>
        <FailureLine attempted={routeLatency} />
        {valueOr(routeLatency, []).length === 0 ? (
          <Empty>
            No request has been recorded in this window. Every route handler writes one row in{" "}
            <code>activity_log</code> as it answers, so an empty table here means the application answered nothing
            in the last {LATENCY_WINDOW_HOURS} hours.
          </Empty>
        ) : (
          <div className="table-scroll" role="region" aria-label="Latency by route" tabIndex={0}>
            <table className="ops-table">
              <thead>
                <tr>
                  <th className="col-ref">Route</th>
                  <th className="amount">p50</th>
                  <th className="amount">p95</th>
                  <th className="amount">max</th>
                  <th className="amount">Requests</th>
                  <th className="amount">Not ok</th>
                </tr>
              </thead>
              <tbody>
                {valueOr(routeLatency, []).map((route) => (
                  <tr key={route.route}>
                    <td className="col-ref">
                      <code>{route.route}</code>
                    </td>
                    <td className="amount">{route.p50Ms === null ? "no sample" : `${Math.round(route.p50Ms)} ms`}</td>
                    <td className="amount">{route.p95Ms === null ? "no sample" : `${Math.round(route.p95Ms)} ms`}</td>
                    <td className="amount">{route.maxMs === null ? "no sample" : `${route.maxMs} ms`}</td>
                    <td className="amount">{route.sampleCount}</td>
                    <td className="amount">
                      {route.notOkCount === 0 ? <span className="note">0</span> : <Chip tone="warn">{route.notOkCount}</Chip>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Disclosure title="What this measures, and what it does not">
          <p>
            One row per <strong>route</strong>, sorted by p95 so the slowest is first. The figures are{" "}
            <code>percentile_cont</code> computed by Postgres over <code>activity_log.duration_ms</code>, which is
            the time this application spent inside the handler: it does not include the network, the browser, or the
            cold start of a serverless function. The table above it measures something different, the time an{" "}
            <strong>object</strong> took to move between two states, which includes the provider.
          </p>
          <p>
            A route is the URL <strong>pattern</strong> and never a URL with an id in it, so one policy cannot become
            its own row with one sample. Showing at most {MOST_LATENCY_ROUTES} routes.
          </p>
        </Disclosure>
      </Panel>

      {/* UI-026: the Recovery column of the errors table, which is the whole point of the panel,
          fell outside the 736 px left-hand card of the two-column grid. The console stacks: the
          tables take the full content width and the filters and reading notes move under them. */}
      <div className="ops-stacked">
      <DetailGrid
        main={
          <>
            <Panel title="Refused and failed actions">
              <FailureLine attempted={refusedActions} />
              {refusedRows.length === 0 ? (
                <Empty>
                  Nothing was refused and nothing failed in this window. A maker-checker refusal, a broker asking for
                  something they do not own, an expired session, a job called without the cron secret and an
                  unhandled failure would all be here.
                </Empty>
              ) : (
                <ActivityTable rows={refusedRows} ariaLabel="Refused and failed actions" />
              )}
              {refusedRows.length >= MOST_ACTIVITY_ROWS ? (
                <p className="note">
                  Showing {MOST_ACTIVITY_ROWS} rows, which is the hard limit of this panel. Narrow the window to see
                  the rest.
                </p>
              ) : null}
              <Disclosure title="Where these rows come from">
                <p>
                  Every route handler, every job and the MCP endpoint are wrapped in one helper
                  (<code>lib/observability/log.ts</code>) that writes one append-only row in <code>activity_log</code>{" "}
                  and prints the same fields as one JSON line in the server log. A row is <strong>refused</strong>{" "}
                  when a rule said no: the handler answered a 4xx, or redirected with an error message, which is how
                  most screens here say no. It is <strong>error</strong> when something broke, and the HTTP status is
                  the one the caller actually received.
                </p>
                <p>
                  The <strong>Rule</strong> column is named by the route, which declares the gate it enforces. A
                  request refused <em>before</em> that gate reads <code>sign in</code> when there was no session, and
                  names no rule at all when the URL itself was malformed: this column is a record that can never be
                  corrected, so it says nothing rather than guessing. The sentence next to it is always the real one.
                </p>
                <p>
                  <strong>No payload is ever stored</strong>: the table has no column for one. The reason is a single
                  sanitised sentence, with emails masked to their first three characters and any bearer token,
                  password or <code>sk_</code> secret replaced before it is written. The correlation id on the right
                  is the same id as on the JSON log line, and it is searchable.
                </p>
              </Disclosure>
            </Panel>

            <Panel title="Errors, refusals and unknown outcomes">
              <FailureLine attempted={problems} />
              {problemRows.length === 0 ? (
                <Empty>
                  Nothing failed, was refused, or is unresolved in this window. A failed reconciliation run, a webhook
                  that could not be processed, a refused MCP call and a payment the provider accepted more than{" "}
                  {UNKNOWN_OUTCOME_AFTER_MINUTES} minutes ago would all be here.
                </Empty>
              ) : (
                <div className="table-scroll" role="region" aria-label="Errors and unknowns" tabIndex={0}>
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th className="col-when">When (UTC)</th>
                        <th className="col-age">Age</th>
                        <th className="col-label">Family</th>
                        <th className="col-text">What</th>
                        <th className="col-text">Reason</th>
                        <th className="col-ref">Reference</th>
                        <th className="col-controls">Recovery</th>
                      </tr>
                    </thead>
                    <tbody>
                      {problemRows.map((problem, index) => (
                        <tr key={`${problem.family}-${problem.instant.toISOString()}-${index}`}>
                          <td className="col-when">{utc(problem.instant)}</td>
                          <td className="col-age">{describeMinutes(problem.ageMinutes)}</td>
                          <td className="col-label">
                            {problem.family.replace(/_/g, " ")}
                            {/* The rail, on the row (AF-02, recheck finding F-RC-08). */}
                            {problem.rail ? (
                              <>
                                <br />
                                <span className="note">{problem.rail}</span>
                              </>
                            ) : null}
                          </td>
                          <td className="col-text">
                            <Chip tone="warn">{problem.title}</Chip>
                          </td>
                          <td className="col-text">{problem.detail}</td>
                          <td className="col-ref">
                            <code>{problem.reference ?? "none"}</code>
                          </td>
                          <td className="col-controls">
                            <RecoveryCell recovery={problem.recovery} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {problemRows.length >= MOST_PROBLEM_ROWS ? (
                <p className="note">
                  Showing {MOST_PROBLEM_ROWS} rows, which is the hard limit of this panel. There are probably more:
                  narrow the window to see the rest.
                </p>
              ) : null}
              <Disclosure title="What counts as a problem here">
                <p>
                  A money operation whose last provider answer was <strong>failed</strong> or <strong>unknown</strong>;
                  a webhook whose processing row reads <strong>failed</strong> or <strong>ignored</strong>, or that
                  needed more than one attempt (a retry is not yet a failure, and seeing it before it becomes one is
                  the point); an MCP call the endpoint answered with <strong>error</strong> or{" "}
                  <strong>refused</strong>; a <strong>failed reconciliation run</strong>, which compared nothing and
                  must never read as clean; and an operation the provider accepted more than{" "}
                  {UNKNOWN_OUTCOME_AFTER_MINUTES} minutes ago that has said nothing since.
                </p>
                <p>
                  Every line here is inside the window above <strong>except the unknown outcomes</strong>: those are
                  read over a fixed floor of {UNRESOLVED_OPERATIONS_FLOOR_DAYS} days, whatever window the feed is
                  showing, because an operation nobody has confirmed must stay visible until a human resolves it.
                </p>
                <p>
                  The {UNKNOWN_OUTCOME_AFTER_MINUTES}-minute threshold is <strong>an assumption of this build</strong>,
                  not a rule of Stripe and not a rule of Corgi. Stripe promises no delay. It is a reading convention:
                  under it the operation is being checked, over it a human is asked to resolve it, and the job that
                  actually resolves one is <code>/api/jobs/recover-operations</code>.
                </p>
              </Disclosure>
            </Panel>

            <Panel title="Being checked: accepted by the provider, no answer yet">
              <FailureLine attempted={inFlight} />
              {checking.length === 0 ? (
                <Empty>No operation is waiting for its provider.</Empty>
              ) : (
                <div className="table-scroll" role="region" aria-label="Operations being checked" tabIndex={0}>
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th className="col-when">Accepted (UTC)</th>
                        <th className="col-label">Waiting</th>
                        <th className="col-label">Operation</th>
                        <th className="amount">Amount</th>
                        <th className="col-ref">Provider reference</th>
                        <th className="col-name">Object</th>
                      </tr>
                    </thead>
                    <tbody>
                      {checking.map((operation) => (
                        <tr key={operation.operationId}>
                          <td className="col-when">{utc(operation.acceptedAt)}</td>
                          <td className="col-label">
                            <Chip tone="neutral">checking, {operation.ageMinutes} min</Chip>
                          </td>
                          <td className="col-label">
                            {operation.kind}
                            <br />
                            <span className="note">{operation.rail}</span>
                          </td>
                          <td className="amount">{formatCentsAsUsd(operation.amountCents)}</td>
                          <td className="col-ref">
                            <code>{operation.providerRef ?? "none yet"}</code>
                          </td>
                          <td className="col-name">
                            {operation.claimId ? (
                              <Link href={`/ops/console/claim/${operation.claimId}`} prefetch={false}>
                                {operation.claimNumber ?? "claim"}
                              </Link>
                            ) : operation.policyId ? (
                              <Link href={`/ops/console/policy/${operation.policyId}`} prefetch={false}>
                                {operation.policyNumber ?? "policy"}
                              </Link>
                            ) : (
                              <span className="note">no object</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="note">
                A temporary status, not a problem: the provider has taken the request and we are waiting for the event
                that confirms it. Past {UNKNOWN_OUTCOME_AFTER_MINUTES} minutes the same operation moves up into the
                errors panel as an unknown outcome. This list <strong>ignores the window above</strong>: it is read
                over a fixed floor of {UNRESOLVED_OPERATIONS_FLOOR_DAYS} days, so an operation the provider accepted
                and never confirmed stays on this page whatever window the feed is showing.
              </p>
            </Panel>

            <Panel title="Feed">
              <FailureLine attempted={feed} />
              <EventTable events={events} ariaLabel="Operations feed" />
              {events.length >= MOST_FEED_ROWS ? (
                <p className="note">
                  Showing the newest {MOST_FEED_ROWS} events of this window, which is the hard limit of this page.
                  Narrow the window or the kinds to see the rest.
                </p>
              ) : null}
            </Panel>
          </>
        }
        aside={
          <>
            <Panel title="Window and filters">
              <form method="get" action="/ops/console" className="card">
                <label htmlFor="since">Since</label>
                <input
                  id="since"
                  name="since"
                  type="text"
                  defaultValue={query.since ?? ""}
                  placeholder="15m, 2h, 3d, or 2026-09-09T08:00:00Z"
                />
                <p className="note">A duration back from now, or a UTC instant. Empty means the last hour.</p>
                <fieldset>
                  <legend>Kinds</legend>
                  {CONSOLE_EVENT_KINDS.map((kind) => (
                    <label key={kind} className="checkbox-label" htmlFor={`kind-${kind}`}>
                      <input
                        id={`kind-${kind}`}
                        type="checkbox"
                        name="kind"
                        value={kind}
                        defaultChecked={selectedKinds.includes(kind)}
                      />
                      {KIND_LABEL[kind]}
                    </label>
                  ))}
                </fieldset>
                <p className="note">None ticked means every kind. An unticked kind is not queried at all.</p>
                <button type="submit" className="secondary">
                  Show this window
                </button>
              </form>
            </Panel>

            <Panel title="Where each line comes from">
              <AsideList
                items={[
                  { label: "money operations", value: "money_operations and money_operation_events" },
                  { label: "webhooks", value: "webhook_events, with webhook_processing next to it" },
                  { label: "journal entries", value: "journal_entries and journal_lines" },
                  { label: "policy events", value: "policy_events" },
                  { label: "claim events", value: "claim_events" },
                  { label: "approvals", value: "approval_requests and approval_decisions" },
                  { label: "reconciliation", value: "reconciliation_runs" },
                  { label: "statements", value: "statement_runs" },
                  { label: "MCP calls", value: "mcp_calls, joined to mcp_api_keys for the public prefix" },
                  { label: "broker verification", value: "broker_kyb_events" },
                  { label: "change requests", value: "policy_change_requests" },
                  { label: "refused and failed actions", value: "activity_log, one row per request (migration 0021)" },
                  { label: "latency by route", value: "activity_log.duration_ms, grouped by route" },
                ]}
              />
            </Panel>

            <Panel title="How to read this page">
              <Disclosure title="Why it re-reads instead of streaming">
                <p>
                  A ten-second timer that asks the server to render this page again, plus a button when ten seconds is
                  too long. No websocket, no polling script, no paid service, and no figure computed in the browser:
                  every number here is produced by the same server queries as the first render. The timer exists only
                  while the console is open and is cleared when you leave it, so an automatic refresh can never pull
                  you back to this screen from the page you went to.
                </p>
              </Disclosure>
              <Disclosure title="What is never shown">
                <p>
                  No provider payload, no secret, and no API key beyond its public <code>cmk_</code> prefix. A failure
                  reason is the short sanitised sentence the money path recorded, cut to 220 characters. Names and
                  emails are masked to their first three characters and revealed by clicking them: the console is
                  staff-only, and this is a reading discipline for a screen left open, not a security control.
                </p>
              </Disclosure>
              <Disclosure title="If a panel shows a red line">
                <p>
                  That panel&apos;s query failed and the rest of the page still rendered. Nothing was retried and
                  nothing was hidden. This is deliberate: the console is what an operator opens while something is
                  already broken, so one unreadable table must never replace the whole screen with an error page.
                </p>
              </Disclosure>
            </Panel>
          </>
        }
      />
      </div>
    </PortalShell>
  );
}
