import "@/app/styles/ops-tables.css";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { Disclosure } from "@/components/disclosures";
import { AsideList, Chip, DetailGrid, DetailHeading, Empty, Panel } from "@/components/detail-layout";
import { JournalTable } from "@/components/journal-table";
import { ActivityTable, EventTable, FailureLine, IntegrationModes, Masked, formatSeconds, utc } from "@/components/console-parts";
import { sql } from "@/db/client";
import { requireStaff } from "@/lib/console/guard";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { describeAge } from "@/lib/reconciliation/breaks";
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
  type ConsoleSubjectKind,
} from "@/lib/console/read";
import { attempt, valueOr } from "@/lib/console/safe-read";

// The 360 page of one object: a customer, a broker, a policy or a claim.
//
// ONE COMPONENT, FOUR ROUTES. The four pages differ only in which id they read from the path, so
// they share this component and each route file is four lines: check the role, check the id is a
// uuid, render. Writing it four times would guarantee that the fourth one drifts.
//
// WHAT IT SHOWS. The identity band, then one panel per table that has anything to say about the
// object: its policies and claims, its money operations with their timeline and the two durations
// the database subtracted, the provider events that named its Stripe references, its journal
// entries through the same JournalTable the policy and claim screens use, its approvals, its
// statements, its open reconciliation breaks, its change requests and the MCP calls made with a
// key that borrows its visibility. Every row links to the ordinary screen of the object.
//
// SOLID. Every read goes through `attempt`: a panel whose query fails prints one red line and
// the page still renders. Every read is bounded, and the policy and claim id lists are read ONCE
// by consoleSubject and reused by every panel, so no panel loops over rows issuing queries.

export async function Console360({ kind, id }: { kind: ConsoleSubjectKind; id: string }) {
  const user = await requireStaff();

  // The identity read goes through `attempt` like every other read on this page, and that is
  // review finding F-B13-24. It was the one exception: a failure here replaced the whole console
  // page with the framework error page, which is exactly what safe-read.ts exists to prevent.
  // There is genuinely less to show without it, because the policy and claim ids it returns
  // scope every other panel, so the page answers with its heading and the named failure.
  const subjectRead = await attempt("the object itself", consoleSubject(sql, kind, id));
  if (!subjectRead.ok) {
    return (
      <PortalShell user={user} active="console" trail={[{ label: "Operations console", href: "/ops/console" }, { label: "Unreadable" }]}>
        <DetailHeading
          title={`This ${kind} could not be read`}
          lead="The query that identifies the object failed, so the panels that describe it have nothing to be about. Nothing was retried and nothing is hidden."
          actions={
            <Link href="/ops/console" prefetch={false} className="button-link">
              Back to the feed
            </Link>
          }
        />
        <IntegrationModes />
        <Panel title="What failed">
          <FailureLine attempted={subjectRead} />
          <p className="note">
            The id in the address is <code>{id}</code>. The feed, the reference search and the other 360 pages are
            unaffected: each page of this console reads on its own.
          </p>
        </Panel>
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
  const now = new Date();

  return (
    <PortalShell
      user={user}
      active="console"
      trail={[{ label: "Operations console", href: "/ops/console" }, { label: subject.title }]}
    >
      <DetailHeading
        title={subject.title}
        lead={subject.lead}
        chips={
          <>
            <Chip tone="neutral">{subject.kind}</Chip>
            <Chip tone={breaks.length > 0 ? "warn" : "ok"}>
              {breaks.length === 0 ? "no open break" : `${breaks.length} open break${breaks.length === 1 ? "" : "s"}`}
            </Chip>
            <Chip tone="neutral">{operations.length} money operations</Chip>
          </>
        }
        actions={
          <>
            {subject.existingHref ? (
              <Link href={subject.existingHref} prefetch={false} className="button-link">
                The ordinary screen
              </Link>
            ) : null}
            <Link href="/ops/console" prefetch={false} className="button-link">
              Back to the feed
            </Link>
          </>
        }
      />

      <IntegrationModes />

      {/* UI-030: the money-operation table has eight columns, and in the 736 px left-hand card of
          the two-column grid its Kind column printed "stripe_checkout" as five fragments while
          the provider reference and the object fell outside the card. The 360 pages stack: the
          tables take the full content width and the side panels move under them. */}
      <div className="ops-stacked">
      <DetailGrid
        main={
          <>
            <Panel title="Money operations, with what each step took">
              <FailureLine attempted={operationsRead} />
              {operations.length === 0 ? (
                <Empty>No money operation has ever been created for this object.</Empty>
              ) : (
                <div className="table-scroll" role="region" aria-label="Money operations" tabIndex={0}>
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th className="col-when">Created (UTC)</th>
                        {/* "stripe_checkout" and "LOCAL SIMULATOR" are read as words, not as
                            fragments: this column carries a minimum width (UI-030). */}
                        <th className="col-label">Kind</th>
                        <th className="amount">Amount</th>
                        <th className="col-text">Last status</th>
                        <th className="col-age">Requested to accepted</th>
                        <th className="col-age">Accepted to succeeded</th>
                        <th className="col-ref">Provider reference</th>
                        <th className="col-name">Object</th>
                      </tr>
                    </thead>
                    <tbody>
                      {operations.map((operation) => (
                        <tr key={operation.operationId}>
                          <td className="col-when">{utc(operation.createdAt)}</td>
                          <td className="col-label">
                            {operation.kind}
                            <br />
                            {/* The rail in full words, ON the row (AF-02, recheck finding
                                F-RC-08). It used to print the bare column value, "simulator",
                                next to real Stripe references. */}
                            <span className="note">{integrationModeOf(operation.provider)}</span>
                          </td>
                          <td className="amount">{formatCentsAsUsd(operation.amountCents)}</td>
                          <td className="col-text">
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
                            {operation.failureReason ? (
                              <>
                                <br />
                                <span className="note">{operation.failureReason}</span>
                              </>
                            ) : null}
                          </td>
                          <td className="col-age">{formatSeconds(operation.requestedToAcceptedSeconds)}</td>
                          <td className="col-age">{formatSeconds(operation.acceptedToSucceededSeconds)}</td>
                          <td className="col-ref">
                            <code>{operation.providerRef ?? "none"}</code>
                          </td>
                          <td className="col-name">
                            {operation.claimId ? (
                              <Link href={`/ops/claims/${operation.claimId}`} prefetch={false}>
                                {operation.claimNumber ?? "claim"}
                              </Link>
                            ) : operation.policyId ? (
                              <Link href={`/policies/${operation.policyId}`} prefetch={false}>
                                {operation.policyNumber ?? "policy"}
                              </Link>
                            ) : (
                              <span className="note">none</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Disclosure title="Where the two durations come from">
                <p>
                  Both are subtracted by Postgres from the operation&apos;s own append-only history: the{" "}
                  <code>requested</code> row written before the provider is called, the <code>provider_accepted</code>{" "}
                  row written when it answers, and the <code>succeeded</code> row written when the confirming event
                  arrives. An empty cell means one of the two instants does not exist, which is a fact about the
                  operation and not a fast one.
                </p>
              </Disclosure>
            </Panel>

            <Panel title="Provider events that named these references">
              <FailureLine attempted={webhooksRead} />
              {valueOr(webhooksRead, []).length === 0 ? (
                <Empty>
                  {providerReferences.length === 0
                    ? "This object has no provider reference yet, so no webhook could name it."
                    : "No stored provider event names any of this object's references."}
                </Empty>
              ) : (
                <div className="table-scroll" role="region" aria-label="Webhooks" tabIndex={0}>
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th className="col-when">Received (UTC)</th>
                        <th className="col-label">Type</th>
                        <th className="col-label">Processing</th>
                        <th className="col-age">Attempts</th>
                        <th className="col-text">Last error</th>
                        <th className="col-ref">Event id</th>
                      </tr>
                    </thead>
                    <tbody>
                      {valueOr(webhooksRead, []).map((webhook) => (
                        <tr key={webhook.webhookEventId}>
                          <td className="col-when">{utc(webhook.receivedAt)}</td>
                          <td className="col-label">{webhook.eventType}</td>
                          <td className="col-label">
                            <Chip tone={webhook.status === "done" ? "ok" : webhook.status === "failed" ? "warn" : "neutral"}>
                              {webhook.status ?? "no processing row"}
                            </Chip>
                          </td>
                          <td className="col-age">{webhook.attempts ?? 0}</td>
                          <td className="col-text">{webhook.lastError ?? <span className="note">none</span>}</td>
                          <td className="col-ref">
                            <code>{webhook.providerEventId}</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Disclosure title="How a webhook is attached to an object">
                <p>
                  It is not: a provider event has no foreign key into our tables. What links the two is the id INSIDE
                  the event, so this panel reads <code>data.object.id</code> and <code>data.object.payment_intent</code>{" "}
                  and matches them against the provider references this object&apos;s operations carry. No payload
                  reaches this screen beyond those two values and the sanitised processing error.
                </p>
              </Disclosure>
            </Panel>

            <Panel title="Journal entries">
              <FailureLine attempted={journalRead} />
              {valueOr(journalRead, []).length === 0 ? (
                <Empty>Nothing has been posted for this object.</Empty>
              ) : (
                <JournalTable
                  panelKey="console"
                  entries={valueOr(journalRead, []).map((entry) => ({
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
            </Panel>

            {subject.kind === "customer" || subject.kind === "broker" ? (
              <Panel title="Policies">
                <FailureLine attempted={policiesRead} />
                {valueOr(policiesRead, []).length === 0 ? (
                  <Empty>No policy.</Empty>
                ) : (
                  <div className="table-scroll" role="region" aria-label="Policies" tabIndex={0}>
                    <table className="ops-table">
                      <thead>
                        <tr>
                          <th className="col-name">Policy</th>
                          <th className="col-label">Status (cache)</th>
                          <th className="col-label">Term</th>
                          <th className="amount">Charged</th>
                          <th className="col-name">{subject.kind === "customer" ? "Broker" : "Customer"}</th>
                          <th className="col-open">Everything about it</th>
                        </tr>
                      </thead>
                      <tbody>
                        {valueOr(policiesRead, []).map((policy) => (
                          <tr key={policy.policyId}>
                            <td className="col-name">
                              <Link href={`/policies/${policy.policyId}`} prefetch={false}>
                                {policy.policyNumber}
                              </Link>
                            </td>
                            <td className="col-label">{policy.status ?? <span className="note">not cached</span>}</td>
                            <td className="col-label">{policy.effectiveAt ? `${policy.effectiveAt} to ${policy.termEnd}` : <span className="note">not bound</span>}</td>
                            <td className="amount">
                              {policy.totalChargeCents === null ? "" : formatCentsAsUsd(policy.totalChargeCents)}
                            </td>
                            <td className="col-name">
                              {subject.kind === "customer" ? (
                                <Link href={`/ops/console/broker/${policy.brokerId}`} prefetch={false}>
                                  {policy.brokerName}
                                </Link>
                              ) : (
                                // The fold and the link SIDE BY SIDE, never nested (review
                                // finding F-B13-25): Masked renders a details/summary, and
                                // interactive content inside an anchor is invalid HTML, so the
                                // click landed on the link and the name could never be revealed.
                                <>
                                  <Masked value={policy.customerName} what="customer name" />{" "}
                                  <Link href={`/ops/console/customer/${policy.customerId}`} prefetch={false}>
                                    open
                                  </Link>
                                </>
                              )}
                            </td>
                            <td className="col-open">
                              <Link href={`/ops/console/policy/${policy.policyId}`} prefetch={false}>
                                open
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            ) : null}

            <Panel title="Claims">
              <FailureLine attempted={claimsRead} />
              {valueOr(claimsRead, []).length === 0 ? (
                <Empty>No claim.</Empty>
              ) : (
                <div className="table-scroll" role="region" aria-label="Claims" tabIndex={0}>
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th className="col-name">Claim</th>
                        <th className="col-name">Policy</th>
                        <th className="col-name">Claimant</th>
                        <th className="col-age">Loss</th>
                        <th className="col-age">Events</th>
                        <th className="col-open">Everything about it</th>
                      </tr>
                    </thead>
                    <tbody>
                      {valueOr(claimsRead, []).map((claim) => (
                        <tr key={claim.claimId}>
                          <td className="col-name">
                            <Link href={`/ops/claims/${claim.claimId}`} prefetch={false}>
                              {claim.claimNumber}
                            </Link>
                          </td>
                          <td className="col-name">
                            <Link href={`/policies/${claim.policyId}`} prefetch={false}>
                              {claim.policyNumber}
                            </Link>
                          </td>
                          <td className="col-name">
                            <Masked value={claim.claimantName} what="claimant name" />
                          </td>
                          <td className="col-age">{claim.occurredAt}</td>
                          <td className="col-age">{claim.eventCount}</td>
                          <td className="col-open">
                            <Link href={`/ops/console/claim/${claim.claimId}`} prefetch={false}>
                              open
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel title="Timeline">
              <FailureLine attempted={timelineRead} />
              <EventTable events={valueOr(timelineRead, [])} ariaLabel={`${subject.title} timeline`} />
            </Panel>
          </>
        }
        aside={
          <>
            <Panel title="Identity">
              <dl className="aside-list">
                {subject.identity.map((fact) => (
                  <div key={fact.label}>
                    <dt>{fact.label}</dt>
                    <dd>
                      {/* On the 360 page of a customer the identity is meant to be read, so a
                          masked field is one click from being open, exactly as it is elsewhere. */}
                      {fact.sensitive ? <Masked value={fact.value} what={fact.label} /> : fact.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </Panel>

            <Panel title="Open reconciliation breaks">
              <FailureLine attempted={breaksRead} />
              {breaks.length === 0 ? (
                <Empty>No open break names this object&apos;s money.</Empty>
              ) : (
                <ul>
                  {breaks.map((row) => (
                    <li key={row.breakKey}>
                      <strong>{row.classification.replace(/_/g, " ")}</strong> · {row.source} · open for{" "}
                      {describeAge(row.firstSeenAt, now)} · <code>{row.providerRef ?? row.ledgerRef ?? "no reference"}</code>
                      <br />
                      <span className="note">{row.note}</span>
                    </li>
                  ))}
                </ul>
              )}
              {breaks.length >= MOST_BREAKS_ON_A_360_PAGE ? (
                <p className="note">
                  Showing {MOST_BREAKS_ON_A_360_PAGE} breaks, which is the cap of this panel. There may be more of
                  them; the reconciliation screen lists every open break of every object.
                </p>
              ) : null}
              <p className="note">
                Read through the same rule the reconciliation screen uses, so the two can never disagree:{" "}
                <Link href="/ops/reconciliation" prefetch={false}>
                  /ops/reconciliation
                </Link>
                .
              </p>
            </Panel>

            <Panel title="Approvals">
              <FailureLine attempted={approvalsRead} />
              {valueOr(approvalsRead, []).length === 0 ? (
                <Empty>No money-out of this object ever needed a second person.</Empty>
              ) : (
                <ul>
                  {valueOr(approvalsRead, []).map((approval) => (
                    <li key={approval.requestId}>
                      {formatCentsAsUsd(approval.amountCents)} {approval.kind.replace(/_/g, " ")} ·{" "}
                      <Chip tone={approval.decision === "approved" ? "ok" : approval.decision === "rejected" ? "warn" : "neutral"}>
                        {approval.decision ?? "waiting"}
                      </Chip>
                      <br />
                      <span className="note">
                        asked by <Masked value={approval.requestedByName} what="requester" />
                        {approval.raisedByAgent ? " (raised by an agent)" : ""} on {utc(approval.requestedAt)}
                        {approval.decidedByName ? (
                          <>
                            {" "}
                            · decided by <Masked value={approval.decidedByName} what="approver" /> on {utc(approval.decidedAt)}
                          </>
                        ) : null}
                      </span>
                      <br />
                      <span className="note">to {approval.destination}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="note">
                <Link href="/ops/approvals" prefetch={false}>
                  The approvals screen
                </Link>{" "}
                is where a decision is taken; nothing on this page decides anything.
              </p>
            </Panel>

            {subject.kind === "broker" ? (
              <>
                <Panel title="Statements">
                  <FailureLine attempted={statementsRead} />
                  {valueOr(statementsRead, []).length === 0 ? (
                    <Empty>No statement has been run for this broker.</Empty>
                  ) : (
                    <ul>
                      {valueOr(statementsRead, []).map((run) => (
                        <li key={run.runId}>
                          <Link href={`/statements/${run.runId}`} prefetch={false}>
                            {run.statementMonth} revision {run.revision}
                          </Link>{" "}
                          · {formatCentsAsUsd(run.netDueCents)} net due
                          <br />
                          <span className="note">
                            format v{run.canonicalVersion} · knowledge cutoff {utc(run.knowledgeCutoff)}
                            {run.identicalToPrevious ? " · identical to the previous revision" : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>

                <Panel title="Business verification">
                  <FailureLine attempted={kybRead} />
                  {valueOr(kybRead, []).length === 0 ? (
                    <Empty>No verification event: binding is refused while eligibility is unknown.</Empty>
                  ) : (
                    <ul>
                      {valueOr(kybRead, []).map((event, index) => (
                        <li key={`${event.instant.toISOString()}-${index}`}>
                          <Chip tone={event.outcome === "ok" ? "ok" : event.outcome === "failed" ? "warn" : "neutral"}>{event.title}</Chip>{" "}
                          {utc(event.instant)}
                          <br />
                          <span className="note">{event.reference ?? "no connected account"}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="note">
                    The re-read form lives on{" "}
                    <Link href="/ops/brokers" prefetch={false}>
                      /ops/brokers
                    </Link>
                    .
                  </p>
                </Panel>
              </>
            ) : null}

            <Panel title="Activity">
              <FailureLine attempted={activityRead} />
              {valueOr(activityRead, []).length === 0 ? (
                <Empty>
                  No request about this object has been recorded. Every route handler writes one row as it answers,
                  so this list starts when the activity log was added and says nothing about what happened before.
                </Empty>
              ) : (
                <ActivityTable rows={valueOr(activityRead, [])} ariaLabel="Activity about this object" />
              )}
              {valueOr(activityRead, []).length >= MOST_ACTIVITY_ROWS_ON_A_360_PAGE ? (
                <p className="note">
                  Showing the newest {MOST_ACTIVITY_ROWS_ON_A_360_PAGE} requests, which is the hard limit of this panel.
                </p>
              ) : null}
              <Disclosure title="Which requests count as this object's">
                <p>
                  A row is here when its subject is this object, or one of the {subject.policyIds.length} polic
                  {subject.policyIds.length === 1 ? "y" : "ies"} and {subject.claimIds.length} claim
                  {subject.claimIds.length === 1 ? "" : "s"} this page is scoped by, which is the scope every other
                  panel here uses. A request that names no object (a sign-in, a scheduled job, a health check) is on
                  the console feed and not here.
                </p>
              </Disclosure>
            </Panel>

            <Panel title="Change requests">
              <FailureLine attempted={changeRequestsRead} />
              {valueOr(changeRequestsRead, []).length === 0 ? (
                <Empty>No customer has asked for a change here.</Empty>
              ) : (
                <ul>
                  {valueOr(changeRequestsRead, []).map((request) => (
                    <li key={request.requestId}>
                      <Chip tone={request.replyOutcome ? "ok" : "warn"}>{request.replyOutcome ?? "open"}</Chip>{" "}
                      {request.policyNumber} · {request.lines.join(", ")}
                      <br />
                      <span className="note">
                        <Masked value={request.requestedByName} what="requester" /> on {utc(request.requestedAt)}:{" "}
                        {request.comment}
                      </span>
                      {request.replyText ? (
                        <>
                          <br />
                          <span className="note">
                            answered by <Masked value={request.repliedByName} what="replier" />: {request.replyText}
                          </span>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {subject.kind === "customer" || subject.kind === "broker" ? (
              <Panel title="MCP calls">
                <FailureLine attempted={mcpRead} />
                {valueOr(mcpRead, []).length === 0 ? (
                  <Empty>No key borrows this party&apos;s visibility, or no call was ever made with one.</Empty>
                ) : (
                  <ul>
                    {valueOr(mcpRead, []).map((call) => (
                      <li key={call.callId}>
                        <Chip tone={call.outcome === "ok" ? "ok" : call.outcome === "refused" ? "warn" : "neutral"}>
                          {call.outcome}
                        </Chip>{" "}
                        {call.tool ?? call.method} · {call.durationMs} ms · {utc(call.instant)}
                        <br />
                        <span className="note">
                          {call.keyPrefix} ({call.principalKind}){call.detail ? ` · ${call.detail}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <Disclosure title="Why this panel is not on a policy or a claim">
                  <p>
                    <code>mcp_calls</code> stores a hash of the arguments and never the arguments, so no stored fact
                    says which policy or claim a call was about. The link that does exist is the key: a key borrows one
                    user&apos;s visibility, and that user belongs to a broker or a customer. Pretending to know more
                    would be inventing it.
                  </p>
                </Disclosure>
              </Panel>
            ) : null}

            <Panel title="What this page is">
              <AsideList
                items={[
                  { label: "Reads", value: "every table that has something to say about this object" },
                  { label: "Writes", value: "nothing at all" },
                  { label: "Scoped by", value: `${subject.policyIds.length} policy id(s), ${subject.claimIds.length} claim id(s)` },
                  { label: "Times", value: "UTC" },
                ]}
              />
            </Panel>
          </>
        }
      />
      </div>
    </PortalShell>
  );
}
