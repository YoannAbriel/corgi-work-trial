import Link from "next/link";
import { PortalShell } from "@/components/portal-shell";
import { Disclosure } from "@/components/disclosures";
import { AsideList, Chip, DetailGrid, DetailHeading, Empty, Panel } from "@/components/detail-layout";
import { EventTable, FailureLine, RecoveryCell, describeMinutes, formatSeconds, utc } from "@/components/console-parts";
import { sql } from "@/db/client";
import { requireStaff } from "@/lib/console/guard";
import {
  CONSOLE_EVENT_KINDS,
  MOST_FEED_ROWS,
  UNKNOWN_OUTCOME_AFTER_MINUTES,
  LATENCY_WINDOW_HOURS,
  acceptedAndUnconfirmedOperations,
  consoleFeed,
  isConsoleEventKind,
  latencyTiles,
  operationsProblems,
  parseSince,
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
// LIVE WITHOUT JAVASCRIPT. The page carries <meta http-equiv="refresh" content="10">, so the
// browser reloads it every ten seconds by itself. There is no websocket, no polling script and
// no paid service: a reload of a server-rendered page is the cheapest live view there is, and it
// costs nothing on the Hobby plan. A "Refresh now" button (a plain GET form) is there for the
// moment ten seconds is too long to wait. The refresh keeps the query string, so the filters and
// the cursor survive it.
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

  const [feed, tiles, problems, inFlight] = await Promise.all([
    attempt("the feed", consoleFeed(sql, { since, kinds: selectedKinds, limit: MOST_FEED_ROWS })),
    attempt("the latency tiles", latencyTiles(sql)),
    attempt("the errors and unknowns", operationsProblems(sql, { since })),
    attempt("the operations in flight", acceptedAndUnconfirmedOperations(sql)),
  ]);

  const events = valueOr(feed, []);
  const problemRows = valueOr(problems, []);
  const checking = valueOr(inFlight, { checking: [], unknownOutcome: [] }).checking;

  // The hidden inputs that make "Refresh now" and the meta refresh keep the current view.
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
      {/* React hoists this into <head>: the browser reloads the page every ten seconds, with no
          JavaScript of ours and nothing to pay for. */}
      <meta httpEquiv="refresh" content="10" />

      <DetailHeading
        title="Operations console"
        lead={`Everything the system did, how long it took and what is unresolved. Showing ${reading}. All times UTC. This page reloads itself every 10 seconds.`}
        chips={
          <>
            <Chip tone={problemRows.length > 0 ? "warn" : "ok"}>
              {problemRows.length === 0 ? "nothing failing" : `${problemRows.length} to look at`}
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

      <Panel title={`How long things are taking, over the last ${LATENCY_WINDOW_HOURS} hours`}>
        <FailureLine attempted={tiles} />
        <div className="table-scroll" role="region" aria-label="Latency" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>Step</th>
                <th className="amount">p50</th>
                <th className="amount">p95</th>
                <th className="amount">max</th>
                <th className="amount">Samples</th>
                <th>What is measured</th>
              </tr>
            </thead>
            <tbody>
              {valueOr(tiles, []).map((tile) => (
                <tr key={tile.name}>
                  <td>
                    <strong>{tile.name}</strong>
                  </td>
                  <td className="amount">{formatSeconds(tile.p50Seconds)}</td>
                  <td className="amount">{formatSeconds(tile.p95Seconds)}</td>
                  <td className="amount">{formatSeconds(tile.maxSeconds)}</td>
                  <td className="amount">{tile.sampleCount}</td>
                  <td>
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

      <DetailGrid
        main={
          <>
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
                  <table>
                    <thead>
                      <tr>
                        <th>When (UTC)</th>
                        <th>Age</th>
                        <th>Family</th>
                        <th>What</th>
                        <th>Reason</th>
                        <th>Reference</th>
                        <th>Recovery</th>
                      </tr>
                    </thead>
                    <tbody>
                      {problemRows.map((problem, index) => (
                        <tr key={`${problem.family}-${problem.instant.toISOString()}-${index}`}>
                          <td>{utc(problem.instant)}</td>
                          <td>{describeMinutes(problem.ageMinutes)}</td>
                          <td>{problem.family.replace(/_/g, " ")}</td>
                          <td>
                            <Chip tone="warn">{problem.title}</Chip>
                          </td>
                          <td>{problem.detail}</td>
                          <td>
                            <code>{problem.reference ?? "none"}</code>
                          </td>
                          <td>
                            <RecoveryCell recovery={problem.recovery} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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
                  <table>
                    <thead>
                      <tr>
                        <th>Accepted (UTC)</th>
                        <th>Waiting</th>
                        <th>Operation</th>
                        <th className="amount">Amount</th>
                        <th>Provider reference</th>
                        <th>Object</th>
                      </tr>
                    </thead>
                    <tbody>
                      {checking.map((operation) => (
                        <tr key={operation.operationId}>
                          <td>{utc(operation.acceptedAt)}</td>
                          <td>
                            <Chip tone="neutral">checking, {operation.ageMinutes} min</Chip>
                          </td>
                          <td>{operation.kind}</td>
                          <td className="amount">{formatCentsAsUsd(operation.amountCents)}</td>
                          <td>
                            <code>{operation.providerRef ?? "none yet"}</code>
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
                errors panel as an unknown outcome.
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
                ]}
              />
            </Panel>

            <Panel title="How to read this page">
              <Disclosure title="Why it reloads instead of streaming">
                <p>
                  A meta refresh every ten seconds, plus a button when ten seconds is too long. No websocket, no polling
                  script, no paid service: the page is rendered on the server and a reload is the whole mechanism. It
                  also means the console works with JavaScript switched off, which is the state a browser is in when a
                  reviewer is looking hard at what a page really does.
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
    </PortalShell>
  );
}
