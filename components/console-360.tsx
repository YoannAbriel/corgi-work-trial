import "@/app/styles/lists.css";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Chip } from "@/components/detail-layout";
import { PortalShell } from "@/components/portal-shell";
import { JournalTable } from "@/components/journal-table";
import { FailureLine, Masked, formatSeconds, utc } from "@/components/console-parts";
import { About } from "@/components/ui/about";
import { EmptyState } from "@/components/ui/empty";
import { Inspector } from "@/components/ui/inspector";
import { ExpandHead, ExpandRow, FactGrid, DataTable, Num, Primary, Ref, Row } from "@/components/ui/table";
import { When } from "@/components/ui/time";
import { sql } from "@/db/client";
import { requireStaff } from "@/lib/console/guard";
import { formatCentsAsUsd } from "@/lib/money/cents";
import {
  activityOfSubject,
  approvalsOfSubject,
  changeRequestsOfSubject,
  claimsOfSubject,
  consoleSubject,
  integrationModeOf,
  journalEntriesOfSubject,
  kybEventsOfBroker,
  mcpCallsOfParty,
  MOST_ACTIVITY_ROWS_ON_A_360_PAGE,
  MOST_BREAKS_ON_A_360_PAGE,
  openBreaksOfSubject,
  operationsOfSubject,
  policiesOfSubject,
  statementRunsOfBroker,
  subjectTimeline,
  webhooksTouching,
  type ConsoleEvent,
  type ConsoleSubjectKind,
  type OperationWithTimeline,
} from "@/lib/console/read";
import { attempt, valueOr } from "@/lib/console/safe-read";
import { closeInspectorHref, inspectedReference, inspectHref, pickView, withParams, type Query } from "@/lib/ui/views";

// The 360 page of one object: a customer, a broker, a policy or a claim.
//
// ONE COMPONENT, FOUR ROUTES. The four pages differ only in which id they read from the path, so
// they share this component and each route file is four lines: check the role, check the id is a
// uuid, render. Writing it four times would guarantee that the fourth one drifts.
//
// WHAT IT SHOWS. The identity band, then ONE panel at a time, chosen in the section navigation:
// the object's overview, its money operations, the provider events that named its references, its
// journal, its policies and claims, its timeline, its approvals, its statements, the requests this
// application answered about it, the change requests and the MCP calls made with a key that
// borrows its visibility. Every panel is one table of at most six columns; what does not fit is
// in the row's own expansion. Every row links to the ordinary screen of the object.
//
// SOLID. Every read goes through `attempt`: a panel whose query fails prints one red line and
// the page still renders. Every read is bounded, and the policy and claim id lists are read ONCE
// by consoleSubject and reused by every panel, so no panel loops over rows issuing queries.

// The panels a 360 page can show. Which of them exist depends on the kind of the subject; the
// list is built below, once, and both the navigation and the render read the same list.
type PanelView =
  | "overview"
  | "operations"
  | "webhooks"
  | "journal"
  | "policies"
  | "claims"
  | "timeline"
  | "approvals"
  | "statements"
  | "activity"
  | "change-requests"
  | "mcp-calls";

const PANEL_LABEL: Record<PanelView, string> = {
  overview: "Overview",
  operations: "Money",
  webhooks: "Webhooks",
  journal: "Journal",
  policies: "Policies",
  claims: "Claims",
  timeline: "Timeline",
  approvals: "Approvals",
  statements: "Statements",
  activity: "Activity",
  "change-requests": "Change requests",
  "mcp-calls": "MCP calls",
};

export async function Console360({ kind, id, searchParams }: { kind: ConsoleSubjectKind; id: string; searchParams?: Query }) {
  const user = await requireStaff();
  const query = searchParams ?? {};

  // The identity read goes through `attempt` like every other read on this page, and that is
  // review finding F-B13-24. It was the one exception: a failure here replaced the whole console
  // page with the framework error page, which is exactly what safe-read.ts exists to prevent.
  // There is genuinely less to show without it, because the policy and claim ids it returns
  // scope every other panel, so the page answers with its heading and the named failure.
  const subjectRead = await attempt("the object itself", consoleSubject(sql, kind, id));
  if (!subjectRead.ok) {
    return (
      <PortalShell
        user={user}
        active="console"
        trail={[{ label: "Operations console", href: "/ops/console" }, { label: "Unreadable" }]}
        band={{
          title: `This ${kind} could not be read`,
          meta: <Chip tone="warn">read failed</Chip>,
          actions: (
            <Link href="/ops/console" prefetch={false} className="button-link">
              Back to the feed
            </Link>
          ),
        }}
      >
        {/* The top bar carries the AF-02 mode line here too (cycle 2, decision 1). */}
        <section className="card">
          <h2>What failed</h2>
          <FailureLine attempted={subjectRead} />
          <p className="note">
            The query that identifies the object failed, so the panels that describe it have nothing to be about. The id
            in the address is <code>{id}</code>. The feed, the reference search and the other 360 pages are unaffected:
            each page of this console reads on its own.
          </p>
        </section>
      </PortalShell>
    );
  }
  // The read worked and answered "no such object": that is a 404, not a failure.
  const subject = subjectRead.value;
  if (!subject) {
    notFound();
  }

  // The ids every panel below is scoped by. `kind` travels with them because the journal reader
  // needs it: a broker's own commission entries belong to a broker 360 and to nothing else
  // (UI-028, lib/console/read.ts).
  const scope = { kind: subject.kind, policyIds: subject.policyIds, claimIds: subject.claimIds, brokerId: subject.brokerId };

  // The money operations are read first and alone, because two panels are built from the SAME
  // rows: the webhooks panel needs their provider references, and the breaks panel needs their
  // ids. Reading them once is what keeps this page free of a second identical query.
  const operationsRead = await attempt("the money operations", operationsOfSubject(sql, scope));
  const operations = valueOr(operationsRead, []);
  const providerReferences = operations
    .map((operation) => operation.providerRef)
    .filter((reference): reference is string => reference !== null);

  const [journalRead, approvalsRead, breaksRead, changeRequestsRead, mcpRead, policiesRead, claimsRead, statementsRead, kybRead, timelineRead, webhooksRead, activityRead] =
    await Promise.all([
      attempt("the journal entries", journalEntriesOfSubject(sql, scope)),
      attempt("the approvals", approvalsOfSubject(sql, scope)),
      attempt("the reconciliation breaks", openBreaksOfSubject(sql, operations)),
      attempt("the change requests", changeRequestsOfSubject(sql, subject.policyIds)),
      attempt("the MCP calls", mcpCallsOfParty(sql, { brokerId: subject.brokerId, customerId: subject.customerId })),
      attempt("the policies", policiesOfSubject(sql, subject.policyIds)),
      attempt("the claims", claimsOfSubject(sql, subject.claimIds)),
      attempt("the statements", subject.kind === "broker" && subject.brokerId ? statementRunsOfBroker(sql, subject.brokerId) : Promise.resolve([])),
      attempt("the verification events", subject.kind === "broker" && subject.brokerId ? kybEventsOfBroker(sql, subject.brokerId) : Promise.resolve([])),
      attempt("the timeline", subjectTimeline(sql, scope)),
      attempt("the webhooks", webhooksTouching(sql, providerReferences)),
      // Console v2 (migration 0021): every request this application answered about this object.
      attempt("the activity", activityOfSubject(sql, subject)),
    ]);

  const breaks = valueOr(breaksRead, []);
  const journal = valueOr(journalRead, []);
  const approvals = valueOr(approvalsRead, []);
  const changeRequests = valueOr(changeRequestsRead, []);
  const mcpCalls = valueOr(mcpRead, []);
  const policies = valueOr(policiesRead, []);
  const claims = valueOr(claimsRead, []);
  const statements = valueOr(statementsRead, []);
  const kybEvents = valueOr(kybRead, []);
  const timeline = valueOr(timelineRead, []);
  const webhooks = valueOr(webhooksRead, []);
  const activity = valueOr(activityRead, []);
  const now = new Date();

  const hasParties = subject.kind === "customer" || subject.kind === "broker";
  const availableViews: PanelView[] = [
    "overview",
    "operations",
    "webhooks",
    "journal",
    ...(hasParties ? (["policies"] as PanelView[]) : []),
    "claims",
    "timeline",
    "approvals",
    ...(subject.kind === "broker" ? (["statements"] as PanelView[]) : []),
    "activity",
    "change-requests",
    ...(hasParties ? (["mcp-calls"] as PanelView[]) : []),
  ];
  const view = pickView(query.view, availableViews);
  // NO COUNT IN THE NAVIGATION (cycle 2, decision 3: counts are not notifications). A number
  // beside a view was the number of records behind it, which nobody has to act on, and it also
  // made "empty" and "not counted" the same thing to read: a panel with no rows showed no number
  // at all, so "Claims" read as uncounted beside "Money 2" (round 1, MEDIUM). Every panel now
  // prints its own count in its heading, zero included, where the rows are.
  const views = availableViews.map((one) => ({
    key: one,
    label: PANEL_LABEL[one],
    href: withParams(subject.consoleHref, query, { view: one, inspect: null }),
    current: one === view,
  }));

  const inspected = inspectedReference(query.inspect);
  const reference = (value: string) => (
    <Ref value={value} inspectHref={inspectHref(subject.consoleHref, query, value)} open={inspected === value} />
  );

  // F-LU-01. The timeline builds one row per money OPERATION, with the operation's LATEST status
  // as its title and its failure reason as its detail, so a payment that was declined and then
  // succeeded printed "Your card was declined." beside a green succeeded chip, dated with the
  // time of the SUCCESS. The reason belongs to the terminal status only when that status is
  // `failed`; otherwise it is an earlier attempt and is dated with the instant of the failure,
  // which is the wording the operations table above already uses. The operation is found again by
  // its provider reference, which is the reference the timeline row carries.
  const operationOfReference = new Map<string, OperationWithTimeline>();
  for (const operation of operations) {
    if (operation.providerRef) operationOfReference.set(operation.providerRef, operation);
  }
  function timelineDetail(event: ConsoleEvent): string {
    if (event.detail === "" || event.kind !== "money") return event.detail;
    const operation = event.reference ? operationOfReference.get(event.reference) : undefined;
    if (operation?.latestStatus === "failed") return event.detail;
    const failedAt = operation?.failedAt;
    return `Earlier attempt${failedAt ? `, ${utc(failedAt)}` : ""}: ${event.detail}`;
  }

  const bandKind = subject.kind === "broker" ? "Broker" : subject.kind === "customer" ? "Customer" : null;

  return (
    <PortalShell
      user={user}
      active="console"
      views={views}
      viewsSubtitle={subject.title}
      trail={[{ label: "Operations console", href: "/ops/console" }, { label: subject.title }]}
      inspector={
        inspected ? (
          <Inspector reference={inspected} closeHref={closeInspectorHref(subject.consoleHref, query)} user={user} now={now} />
        ) : undefined
      }
      band={{
        title: bandKind ? `${bandKind} ${subject.title}` : subject.title,
        suffix: subject.lead,
        // TWO CHIPS, and the AF-02 words said nowhere here (cycle 2, decision 1). They were
        // printed twice within 100 px, as two band chips and again in the IntegrationModes strip
        // under the band, and the two lists disagreed: the band never mentioned the bank check
        // (round 1, MEDIUM). The top bar of every workspace screen carries the three slots now,
        // and a simulated record still says LOCAL SIMULATOR on its own row below. The kind is
        // dropped too: the title already reads "Broker Redwood Commercial Brokers".
        meta: (
          <>
            <Chip tone={breaks.length > 0 ? "warn" : "ok"}>
              {breaks.length === 0 ? "no open break" : `${breaks.length} open break${breaks.length === 1 ? "" : "s"}`}
            </Chip>
            <Chip tone="neutral">{operations.length} money operations</Chip>
          </>
        ),
        // Two actions of two words, side by side (cycle 2, decision 8).
        actions: (
          <>
            {subject.existingHref ? (
              <Link href={subject.existingHref} prefetch={false} className="button-link secondary">
                Ordinary screen
              </Link>
            ) : null}
            <Link href="/ops/console" prefetch={false} className="button-link">
              Console feed
            </Link>
          </>
        ),
      }}
    >
      {/* AF-02 is said once, in the top bar of this and every workspace screen, exact and
          visible: "Stripe: LIVE SANDBOX · claim rail: LOCAL SIMULATOR · bank check: LOCAL
          SIMULATOR" (cycle 2, decision 1). The IntegrationModes strip that used to sit here
          repeated it a third time on the same screen. Every simulated row still carries its own
          LOCAL SIMULATOR, in the "kind" cell of the money table below. */}

      {view === "overview" ? (
        <>
          <section className="card lists-panel">
            <h3>Identity</h3>
            <FactGrid
              items={subject.identity.map((fact) => ({
                label: fact.label,
                // On the 360 page of a customer the identity is meant to be read, so a masked
                // field is one click from being open, exactly as it is elsewhere.
                value: fact.sensitive ? <Masked value={fact.value} what={fact.label} /> : fact.value,
              }))}
            />
          </section>

          <section className="card lists-panel">
            <h3>
              Open reconciliation breaks <span className="lists-count">{breaks.length}</span>
            </h3>
            <FailureLine attempted={breaksRead} />
            <DataTable ariaLabel="Open reconciliation breaks">
              <thead>
                <tr>
                  <ExpandHead />
                  <th>Break</th>
                  <th>Source</th>
                  <th className="nowrap">Open since</th>
                  <th className="num">Difference</th>
                  <th>Reference</th>
                </tr>
              </thead>
              {breaks.length === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={6} className="dt-empty">
                      <EmptyState illustration="all-clear">No open break names this object&apos;s money.</EmptyState>
                    </td>
                  </tr>
                </tbody>
              ) : (
                breaks.map((row) => (
                  <ExpandRow
                    key={row.breakKey}
                    columns={5}
                    cells={
                      <>
                        <Primary>{row.classification.replace(/_/g, " ")}</Primary>
                        <td>{row.source}</td>
                        <td className="nowrap">
                          <When instant={row.firstSeenAt} now={now} />
                        </td>
                        <Num>{row.differenceCents === null ? "" : formatCentsAsUsd(row.differenceCents)}</Num>
                        <td>{reference(row.providerRef ?? row.ledgerRef ?? "no reference")}</td>
                      </>
                    }
                  >
                    <FactGrid
                      items={[
                        { label: "Break key", value: row.breakKey },
                        { label: "Note", value: row.note },
                        { label: "Provider amount", value: row.providerAmountCents === null ? "none" : formatCentsAsUsd(row.providerAmountCents) },
                        { label: "Ledger amount", value: row.ledgerAmountCents === null ? "none" : formatCentsAsUsd(row.ledgerAmountCents) },
                        { label: "Last reported", value: <When instant={row.lastReportedAt} now={now} mode="both" /> },
                      ]}
                    />
                  </ExpandRow>
                ))
              )}
            </DataTable>
            {breaks.length >= MOST_BREAKS_ON_A_360_PAGE ? (
              <p className="lists-note">
                Showing {MOST_BREAKS_ON_A_360_PAGE} breaks, the cap of this panel. The{" "}
                <Link href="/ops/reconciliation" prefetch={false}>
                  reconciliation screen
                </Link>{" "}
                lists every open break of every object.
              </p>
            ) : null}
          </section>

          {subject.kind === "broker" ? (
            <section className="card lists-panel">
              <h3>
                Business verification <span className="lists-count">{kybEvents.length}</span>
              </h3>
              <FailureLine attempted={kybRead} />
              <DataTable ariaLabel="Business verification events">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th className="nowrap">When</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {kybEvents.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="dt-empty">
                        <EmptyState illustration="shield-leaf">No verification event: binding is refused while eligibility is unknown.</EmptyState>
                      </td>
                    </tr>
                  ) : (
                    kybEvents.map((event, index) => (
                      <Row key={`${event.instant.toISOString()}-${index}`}>
                        <td>
                          <Chip tone={event.outcome === "ok" ? "ok" : event.outcome === "failed" ? "warn" : "neutral"}>{event.title}</Chip>
                        </td>
                        <td className="nowrap">
                          <When instant={event.instant} now={now} mode="both" />
                        </td>
                        <td>{event.reference ? reference(event.reference) : <span className="dt-muted">no connected account</span>}</td>
                      </Row>
                    ))
                  )}
                </tbody>
              </DataTable>
              <p className="lists-note">
                The re-read form lives on{" "}
                <Link href="/ops/brokers" prefetch={false}>
                  /ops/brokers
                </Link>
                .
              </p>
            </section>
          ) : null}
        </>
      ) : null}

      {view === "operations" ? (
        <section className="card lists-panel">
          <h3>
            Money operations <span className="lists-count">{operations.length}</span>
          </h3>
          <FailureLine attempted={operationsRead} />
          <DataTable ariaLabel="Money operations">
            <thead>
              <tr>
                <ExpandHead />
                <th className="nowrap">Created</th>
                <th>Kind</th>
                <th className="num">Amount</th>
                <th>Status</th>
                <th>Reference</th>
                <th>Object</th>
              </tr>
            </thead>
            {operations.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={7} className="dt-empty">
                    <EmptyState illustration="open-ledger">No money operation has ever been created for this object.</EmptyState>
                  </td>
                </tr>
              </tbody>
            ) : (
              operations.map((operation) => (
                <ExpandRow
                  key={operation.operationId}
                  columns={6}
                  cells={
                    <>
                      <td className="nowrap">
                        <When instant={operation.createdAt} now={now} />
                      </td>
                      <td>
                        {operation.kind}
                        {/* The rail in full words, ON the row (AF-02, recheck finding F-RC-08).
                            It used to print the bare column value, "simulator", next to real
                            Stripe references. */}
                        <span className="dt-sub">{integrationModeOf(operation.provider)}</span>
                      </td>
                      <Num>{formatCentsAsUsd(operation.amountCents)}</Num>
                      <td>
                        <Chip
                          tone={
                            operation.latestStatus === "succeeded"
                              ? "ok"
                              : operation.latestStatus === "failed" || operation.latestStatus === "unknown"
                                ? "warn"
                                : "neutral"
                          }
                        >
                          {operation.latestStatus ?? "no event"}
                        </Chip>
                        {/* The reason is the newest one of any failed event of the operation,
                            whatever happened after it, so on an operation that failed and then
                            succeeded a green "succeeded" chip sat above "Your card was declined."
                            with nothing saying it was over (review finding F-INT-20). It belongs
                            to the status only when the status is failed; otherwise it is dated
                            and called what it is. */}
                        {operation.failureReason ? (
                          <span className="dt-sub">
                            {operation.latestStatus === "failed"
                              ? operation.failureReason
                              : `Earlier attempt${operation.failedAt ? `, ${utc(operation.failedAt)}` : ""}: ${operation.failureReason}`}
                          </span>
                        ) : null}
                      </td>
                      {/* The Stripe reference stays in the open on this screen, in a column of its
                          own, and is NOT folded away like the ones in the customer and broker
                          journeys (review finding F-YA-02): the console is the incident screen,
                          where the reference is what an operator types into the provider's own
                          dashboard. */}
                      <td>{operation.providerRef ? reference(operation.providerRef) : <span className="dt-muted">none</span>}</td>
                      <td>
                        {operation.claimId ? (
                          <Link href={`/ops/claims/${operation.claimId}`} prefetch={false}>
                            {operation.claimNumber ?? "claim"}
                          </Link>
                        ) : operation.policyId ? (
                          <Link href={`/policies/${operation.policyId}`} prefetch={false}>
                            {operation.policyNumber ?? "policy"}
                          </Link>
                        ) : (
                          <span className="dt-muted">none</span>
                        )}
                      </td>
                    </>
                  }
                >
                  <FactGrid
                    items={[
                      { label: "Requested to accepted", value: formatSeconds(operation.requestedToAcceptedSeconds) },
                      { label: "Accepted to succeeded", value: formatSeconds(operation.acceptedToSucceededSeconds) },
                      { label: "Requested", value: <When instant={operation.requestedAt} now={now} mode="both" /> },
                      { label: "Accepted", value: <When instant={operation.acceptedAt} now={now} mode="both" /> },
                      { label: "Succeeded", value: <When instant={operation.succeededAt} now={now} mode="both" /> },
                      { label: "Failed", value: <When instant={operation.failedAt} now={now} mode="both" /> },
                      { label: "Idempotency key", value: <code className="ref">{operation.idempotencyKey}</code> },
                      { label: "Operation id", value: <code className="ref">{operation.operationId}</code> },
                    ]}
                  />
                </ExpandRow>
              ))
            )}
          </DataTable>
        </section>
      ) : null}

      {view === "webhooks" ? (
        <section className="card lists-panel">
          <h3>
            Provider events that named these references <span className="lists-count">{webhooks.length}</span>
          </h3>
          <FailureLine attempted={webhooksRead} />
          <DataTable ariaLabel="Webhooks">
            <thead>
              <tr>
                <th className="nowrap">Received</th>
                <th>Type</th>
                <th>Processing</th>
                <th className="num">Attempts</th>
                <th>Last error</th>
                <th>Event id</th>
              </tr>
            </thead>
            <tbody>
              {webhooks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="dt-empty">
                    <EmptyState illustration="connected-link">
                      {providerReferences.length === 0
                        ? "This object has no provider reference yet, so no webhook could name it."
                        : "No stored provider event names any of this object's references."}
                    </EmptyState>
                  </td>
                </tr>
              ) : (
                webhooks.map((webhook) => (
                  <Row key={webhook.webhookEventId}>
                    <td className="nowrap">
                      <When instant={webhook.receivedAt} now={now} />
                    </td>
                    <td>{webhook.eventType}</td>
                    <td>
                      <Chip tone={webhook.status === "done" ? "ok" : webhook.status === "failed" ? "warn" : "neutral"}>
                        {webhook.status ?? "no processing row"}
                      </Chip>
                    </td>
                    <Num>{webhook.attempts ?? 0}</Num>
                    <td>{webhook.lastError ?? <span className="dt-muted">none</span>}</td>
                    <td>{reference(webhook.providerEventId)}</td>
                  </Row>
                ))
              )}
            </tbody>
          </DataTable>
        </section>
      ) : null}

      {view === "journal" ? (
        <section className="card lists-panel">
          <h3>
            Journal entries <span className="lists-count">{journal.length}</span>
          </h3>
          <FailureLine attempted={journalRead} />
          {journal.length === 0 ? (
            <EmptyState illustration="open-ledger">Nothing has been posted for this object.</EmptyState>
          ) : (
            <JournalTable
              panelKey="console"
              entries={journal.map((entry) => ({
                entryId: entry.entryId,
                entryType: entry.entryType,
                effectiveAt: entry.effectiveAt,
                recordedAt: entry.recordedAt,
                reversesEntryId: entry.reversesEntryId,
                lines: entry.lines,
              }))}
              ariaLabel={`${subject.title} journal`}
            />
          )}
        </section>
      ) : null}

      {view === "policies" ? (
        <section className="card lists-panel">
          <h3>
            Policies <span className="lists-count">{policies.length}</span>
          </h3>
          <FailureLine attempted={policiesRead} />
          <DataTable ariaLabel="Policies">
            <thead>
              <tr>
                <th>Policy</th>
                <th>Status</th>
                <th className="nowrap">Term</th>
                <th className="num">Charged</th>
                <th>{subject.kind === "customer" ? "Broker" : "Customer"}</th>
                <th aria-label="Console" />
              </tr>
            </thead>
            <tbody>
              {policies.length === 0 ? (
                <tr>
                  <td colSpan={6} className="dt-empty">
                    <EmptyState illustration="closed-folder">No policy.</EmptyState>
                  </td>
                </tr>
              ) : (
                policies.map((policy) => (
                  <Row key={policy.policyId}>
                    <Primary href={`/policies/${policy.policyId}`} sub={policy.stateCode}>
                      {policy.policyNumber}
                    </Primary>
                    <td>{policy.status ? <Chip tone={policy.status === "bound" ? "ok" : "neutral"}>{policy.status.replace(/_/g, " ")}</Chip> : <span className="dt-muted">not cached</span>}</td>
                    <td className="nowrap">
                      {policy.effectiveAt ? `${policy.effectiveAt} to ${policy.termEnd}` : <span className="dt-muted">not bound</span>}
                    </td>
                    <Num>{policy.totalChargeCents === null ? "" : formatCentsAsUsd(policy.totalChargeCents)}</Num>
                    <td>
                      {subject.kind === "customer" ? (
                        <Link href={`/ops/console/broker/${policy.brokerId}`} prefetch={false}>
                          {policy.brokerName}
                        </Link>
                      ) : (
                        // The fold and the link SIDE BY SIDE, never nested (review finding
                        // F-B13-25): Masked renders a details/summary, and interactive content
                        // inside an anchor is invalid HTML, so the click landed on the link and
                        // the name could never be revealed.
                        <>
                          <Masked value={policy.customerName} what="customer name" />{" "}
                          <Link href={`/ops/console/customer/${policy.customerId}`} prefetch={false}>
                            open
                          </Link>
                        </>
                      )}
                    </td>
                    <td className="dt-actions">
                      <Link href={`/ops/console/policy/${policy.policyId}`} prefetch={false}>
                        Everything about it
                      </Link>
                    </td>
                  </Row>
                ))
              )}
            </tbody>
          </DataTable>
        </section>
      ) : null}

      {view === "claims" ? (
        <section className="card lists-panel">
          <h3>
            Claims <span className="lists-count">{claims.length}</span>
          </h3>
          <FailureLine attempted={claimsRead} />
          <DataTable ariaLabel="Claims">
            <thead>
              <tr>
                <th>Claim</th>
                <th>Policy</th>
                <th>Claimant</th>
                <th className="nowrap">Loss</th>
                <th className="num">Events</th>
                <th aria-label="Console" />
              </tr>
            </thead>
            <tbody>
              {claims.length === 0 ? (
                <tr>
                  <td colSpan={6} className="dt-empty">
                    <EmptyState illustration="umbrella">No claim.</EmptyState>
                  </td>
                </tr>
              ) : (
                claims.map((claim) => (
                  <Row key={claim.claimId}>
                    <Primary href={`/ops/claims/${claim.claimId}`}>{claim.claimNumber}</Primary>
                    <td>
                      <Link href={`/policies/${claim.policyId}`} prefetch={false}>
                        {claim.policyNumber}
                      </Link>
                    </td>
                    <td>
                      <Masked value={claim.claimantName} what="claimant name" />
                    </td>
                    <td className="nowrap">{claim.occurredAt}</td>
                    <Num>{claim.eventCount}</Num>
                    <td className="dt-actions">
                      <Link href={`/ops/console/claim/${claim.claimId}`} prefetch={false}>
                        Everything about it
                      </Link>
                    </td>
                  </Row>
                ))
              )}
            </tbody>
          </DataTable>
        </section>
      ) : null}

      {view === "timeline" ? (
        <section className="card lists-panel">
          <h3>
            Timeline <span className="lists-count">{timeline.length}</span>
          </h3>
          <FailureLine attempted={timelineRead} />
          <DataTable ariaLabel={`${subject.title} timeline`}>
            <thead>
              <tr>
                <th className="nowrap">When</th>
                <th>Kind</th>
                <th>What</th>
                <th className="num">Amount</th>
                <th>Who</th>
                <th>Object</th>
              </tr>
            </thead>
            <tbody>
              {timeline.length === 0 ? (
                <tr>
                  <td colSpan={6} className="dt-empty">
                    <EmptyState illustration="all-clear">Nothing in this window.</EmptyState>
                  </td>
                </tr>
              ) : (
                timeline.map((event, index) => (
                  <Row key={`${event.kind}-${event.instant.toISOString()}-${event.reference ?? index}`}>
                    <td className="nowrap">
                      <When instant={event.instant} now={now} />
                    </td>
                    <td>{event.kind.replace(/_/g, " ")}</td>
                    <td>
                      <Chip tone={event.outcome === "ok" ? "ok" : event.outcome === "neutral" ? "neutral" : "warn"}>{event.title}</Chip>
                      {/* The rail, ON the row and not in a fold (AF-02, F-RC-08). A row that
                          moved no money carries no rail and prints nothing here. */}
                      {event.rail ? <Chip tone="neutral">{event.rail}</Chip> : null}
                      {timelineDetail(event) === "" ? null : <span className="dt-sub">{timelineDetail(event)}</span>}
                    </td>
                    <Num>{event.amountCents === null ? "" : formatCentsAsUsd(event.amountCents)}</Num>
                    {/* A person's name is masked, like an email. An actor that is not a person
                        ("stripe", "the ledger", a scheduled job) is printed as it is: masking it
                        would be noise, not discretion. */}
                    <td>{event.actorIsPerson ? <Masked value={event.actor} what="actor" /> : event.actor}</td>
                    <td>
                      {event.href ? (
                        <Link href={event.href} prefetch={false}>
                          {event.policyNumber ?? event.claimNumber ?? event.reference ?? "open"}
                        </Link>
                      ) : event.reference ? (
                        reference(event.reference)
                      ) : (
                        <span className="dt-muted">no object</span>
                      )}
                    </td>
                  </Row>
                ))
              )}
            </tbody>
          </DataTable>
        </section>
      ) : null}

      {view === "approvals" ? (
        <section className="card lists-panel">
          <h3>
            Approvals <span className="lists-count">{approvals.length}</span>
          </h3>
          <FailureLine attempted={approvalsRead} />
          <DataTable ariaLabel="Approvals">
            <thead>
              <tr>
                <ExpandHead />
                <th className="num">Amount</th>
                <th>Kind</th>
                <th>Decision</th>
                <th>Asked by</th>
                <th>Decided by</th>
              </tr>
            </thead>
            {approvals.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={6} className="dt-empty">
                    <EmptyState illustration="checker-corgi">No money-out of this object ever needed a second person.</EmptyState>
                  </td>
                </tr>
              </tbody>
            ) : (
              approvals.map((approval) => (
                <ExpandRow
                  key={approval.requestId}
                  columns={5}
                  cells={
                    <>
                      <Num>{formatCentsAsUsd(approval.amountCents)}</Num>
                      <td>{approval.kind.replace(/_/g, " ")}</td>
                      <td>
                        <Chip tone={approval.decision === "approved" ? "ok" : approval.decision === "rejected" ? "warn" : "neutral"}>
                          {approval.decision ?? "waiting"}
                        </Chip>
                      </td>
                      <td>
                        <Masked value={approval.requestedByName} what="requester" />
                        {approval.raisedByAgent ? <span className="dt-sub">raised by an agent</span> : null}
                      </td>
                      <td>
                        {approval.decidedByName ? <Masked value={approval.decidedByName} what="approver" /> : <span className="dt-muted">nobody yet</span>}
                      </td>
                    </>
                  }
                >
                  <FactGrid
                    items={[
                      { label: "Destination", value: approval.destination },
                      { label: "Requested", value: <When instant={approval.requestedAt} now={now} mode="both" /> },
                      { label: "Decided", value: <When instant={approval.decidedAt} now={now} mode="both" /> },
                      { label: "Reason", value: approval.reason ?? "none recorded" },
                    ]}
                  />
                </ExpandRow>
              ))
            )}
          </DataTable>
          <p className="lists-note">
            <Link href="/ops/approvals" prefetch={false}>
              The approvals screen
            </Link>{" "}
            is where a decision is taken; nothing on this page decides anything.
          </p>
        </section>
      ) : null}

      {view === "statements" ? (
        <section className="card lists-panel">
          <h3>
            Statements <span className="lists-count">{statements.length}</span>
          </h3>
          <FailureLine attempted={statementsRead} />
          <DataTable ariaLabel="Statements">
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">Revision</th>
                <th className="num">Net due</th>
                <th className="nowrap">Knowledge cutoff</th>
                <th>Format</th>
              </tr>
            </thead>
            <tbody>
              {statements.length === 0 ? (
                <tr>
                  <td colSpan={5} className="dt-empty">
                    <EmptyState illustration="accountant-corgi">No statement has been run for this broker.</EmptyState>
                  </td>
                </tr>
              ) : (
                statements.map((run) => (
                  <Row key={run.runId} href={`/statements/${run.runId}`}>
                    <Primary href={`/statements/${run.runId}`}>{run.statementMonth}</Primary>
                    <Num sub={run.identicalToPrevious ? "identical to the previous" : undefined}>{run.revision}</Num>
                    <Num>{formatCentsAsUsd(run.netDueCents)}</Num>
                    <td className="nowrap">
                      <When instant={run.knowledgeCutoff} now={now} mode="both" />
                    </td>
                    <td>v{run.canonicalVersion}</td>
                  </Row>
                ))
              )}
            </tbody>
          </DataTable>
        </section>
      ) : null}

      {view === "activity" ? (
        <section className="card lists-panel">
          <h3>
            Activity <span className="lists-count">{activity.length}</span>
          </h3>
          <FailureLine attempted={activityRead} />
          <DataTable ariaLabel="Activity about this object">
            <thead>
              <tr>
                <ExpandHead />
                <th className="nowrap">When</th>
                <th>Route</th>
                <th>Who</th>
                <th>Answered</th>
                <th>Reason</th>
              </tr>
            </thead>
            {activity.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={6} className="dt-empty">
                    <EmptyState illustration="engineer-corgi">
                      No request about this object has been recorded. Every route handler writes one row as it answers, so
                      this list starts when the activity log was added.
                    </EmptyState>
                  </td>
                </tr>
              </tbody>
            ) : (
              activity.map((row) => (
                <ExpandRow
                  key={row.activityId}
                  columns={5}
                  cells={
                    <>
                      <td className="nowrap">
                        <When instant={row.instant} now={now} />
                      </td>
                      <td>
                        <code className="ref">
                          {row.method} {row.route}
                        </code>
                      </td>
                      <td>
                        {row.actorIsPerson ? <Masked value={row.actor} what="actor" /> : row.actor}
                        {row.actorRole ? <span className="dt-sub">{row.actorRole}</span> : null}
                      </td>
                      <td>
                        <Chip tone={row.outcome === "ok" ? "ok" : "warn"}>{row.outcome}</Chip>
                        <span className="dt-sub">HTTP {row.statusCode}</span>
                      </td>
                      <td>{row.message ?? <span className="dt-muted">none recorded</span>}</td>
                    </>
                  }
                >
                  <FactGrid
                    items={[
                      { label: "Rule", value: row.rule ?? "none named" },
                      { label: "Took", value: `${row.durationMs} ms` },
                      {
                        label: "Object",
                        value: row.consoleHref ? (
                          <Link href={row.consoleHref} prefetch={false}>
                            {row.subjectKind}
                          </Link>
                        ) : (
                          "no object"
                        ),
                      },
                      { label: "Correlation id", value: reference(row.correlationId) },
                    ]}
                  />
                </ExpandRow>
              ))
            )}
          </DataTable>
          {activity.length >= MOST_ACTIVITY_ROWS_ON_A_360_PAGE ? (
            <p className="lists-note">Showing the newest {MOST_ACTIVITY_ROWS_ON_A_360_PAGE} requests, the hard limit of this panel.</p>
          ) : null}
        </section>
      ) : null}

      {view === "change-requests" ? (
        <section className="card lists-panel">
          <h3>
            Change requests <span className="lists-count">{changeRequests.length}</span>
          </h3>
          <FailureLine attempted={changeRequestsRead} />
          <DataTable ariaLabel="Change requests">
            <thead>
              <tr>
                <ExpandHead />
                <th>Policy</th>
                <th>Asked for</th>
                <th>Status</th>
                <th>Asked by</th>
                <th className="nowrap">Asked</th>
              </tr>
            </thead>
            {changeRequests.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={6} className="dt-empty">
                    <EmptyState illustration="closed-folder">No customer has asked for a change here.</EmptyState>
                  </td>
                </tr>
              </tbody>
            ) : (
              changeRequests.map((request) => (
                <ExpandRow
                  key={request.requestId}
                  columns={5}
                  cells={
                    <>
                      <Primary href={`/policies/${request.policyId}`}>{request.policyNumber}</Primary>
                      <td>{request.lines.join(", ")}</td>
                      <td>
                        <Chip tone={request.replyOutcome ? "ok" : "warn"}>{request.replyOutcome ?? "open"}</Chip>
                      </td>
                      <td>
                        <Masked value={request.requestedByName} what="requester" />
                      </td>
                      <td className="nowrap">
                        <When instant={request.requestedAt} now={now} />
                      </td>
                    </>
                  }
                >
                  <FactGrid
                    items={[
                      { label: "Comment", value: request.comment },
                      { label: "Answer", value: request.replyText ?? "none yet" },
                      { label: "Answered by", value: request.repliedByName ? <Masked value={request.repliedByName} what="replier" /> : "nobody yet" },
                      { label: "Answered", value: <When instant={request.repliedAt} now={now} mode="both" /> },
                    ]}
                  />
                </ExpandRow>
              ))
            )}
          </DataTable>
        </section>
      ) : null}

      {view === "mcp-calls" ? (
        <section className="card lists-panel">
          <h3>
            MCP calls <span className="lists-count">{mcpCalls.length}</span>
          </h3>
          <FailureLine attempted={mcpRead} />
          <DataTable ariaLabel="MCP calls">
            <thead>
              <tr>
                <th className="nowrap">When</th>
                <th>Tool</th>
                <th>Outcome</th>
                <th>Key</th>
                <th className="num">Took</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {mcpCalls.length === 0 ? (
                <tr>
                  <td colSpan={6} className="dt-empty">
                    <EmptyState illustration="key-ring">No key borrows this party&apos;s visibility, or no call was ever made with one.</EmptyState>
                  </td>
                </tr>
              ) : (
                mcpCalls.map((call) => (
                  <Row key={call.callId}>
                    <td className="nowrap">
                      <When instant={call.instant} now={now} />
                    </td>
                    <td>{call.tool ?? call.method}</td>
                    <td>
                      <Chip tone={call.outcome === "ok" ? "ok" : call.outcome === "refused" ? "warn" : "neutral"}>{call.outcome}</Chip>
                    </td>
                    <td>
                      {call.keyPrefix ? reference(call.keyPrefix) : <span className="dt-muted">none</span>}
                      {call.principalKind ? <span className="dt-sub">{call.principalKind}</span> : null}
                    </td>
                    <Num>{call.durationMs} ms</Num>
                    <td>{call.detail ?? <span className="dt-muted">none</span>}</td>
                  </Row>
                ))
              )}
            </tbody>
          </DataTable>
        </section>
      ) : null}

      <About>
        <h4>What this page is</h4>
        <p>
          Every table that has something to say about this object, one panel at a time. It writes nothing at all, and it
          is scoped by {subject.policyIds.length} policy id{subject.policyIds.length === 1 ? "" : "s"} and{" "}
          {subject.claimIds.length} claim id{subject.claimIds.length === 1 ? "" : "s"}. Every instant is UTC.
        </p>
        <h4>The two durations</h4>
        <p>
          Both are subtracted by Postgres from the operation&apos;s own append-only history: the <code>requested</code>{" "}
          row written before the provider is called, the <code>provider_accepted</code> row written when it answers, and
          the <code>succeeded</code> row written when the confirming event arrives. An empty cell means one of the two
          instants does not exist, which is a fact about the operation and not a fast one.
        </p>
        <h4>How a webhook is attached to an object</h4>
        <p>
          It is not: a provider event has no foreign key into our tables. What links the two is the id INSIDE the event,
          so that panel reads <code>data.object.id</code> and <code>data.object.payment_intent</code> and matches them
          against the provider references this object&apos;s operations carry. No payload reaches this screen beyond
          those two values and the sanitised processing error.
        </p>
        <h4>An earlier attempt</h4>
        <p>
          A failure reason is printed beside a status only when that status is the failure. On an operation that failed
          and then succeeded, the reason is dated with the instant of the failure and called an earlier attempt, on the
          money panel and on the timeline alike.
        </p>
        <h4>Breaks</h4>
        <p>
          Read through the same rule the{" "}
          <Link href="/ops/reconciliation" prefetch={false}>
            reconciliation screen
          </Link>{" "}
          uses, so the two can never disagree.
        </p>
        <h4>Why MCP calls are not on a policy or a claim</h4>
        <p>
          <code>mcp_calls</code> stores a hash of the arguments and never the arguments, so no stored fact says which
          policy or claim a call was about. The link that does exist is the key: a key borrows one user&apos;s
          visibility, and that user belongs to a broker or a customer. Pretending to know more would be inventing it.
        </p>
        <h4>Which requests count as this object&apos;s</h4>
        <p>
          A row is on the activity panel when its subject is this object, or one of the policies and claims this page is
          scoped by. A request that names no object (a sign-in, a scheduled job, a health check) is on the console feed
          and not here.
        </p>
      </About>
    </PortalShell>
  );
}
