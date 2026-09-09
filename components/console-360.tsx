import Link from "next/link";
import { notFound } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { Disclosure } from "@/components/disclosures";
import { AsideList, Chip, DetailGrid, DetailHeading, Empty, Panel } from "@/components/detail-layout";
import { JournalTable } from "@/components/journal-table";
import { EventTable, FailureLine, Masked, formatSeconds, utc } from "@/components/console-parts";
import { sql } from "@/db/client";
import { requireStaff } from "@/lib/console/guard";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { describeAge } from "@/lib/reconciliation/breaks";
import {
  approvalsOfSubject,
  changeRequestsOfSubject,
  claimsOfSubject,
  consoleSubject,
  journalEntriesOfSubject,
  kybEventsOfBroker,
  mcpCallsOfParty,
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

  const subject = await consoleSubject(sql, kind, id);
  if (!subject) {
    notFound();
  }

  const scope = { policyIds: subject.policyIds, claimIds: subject.claimIds, brokerId: subject.brokerId };

  // The money operations are read first and alone, because two panels are built from the SAME
  // rows: the webhooks panel needs their provider references, and the breaks panel needs their
  // ids. Reading them once is what keeps this page free of a second identical query.
  const operationsRead = await attempt("the money operations", operationsOfSubject(sql, scope));
  const operations = valueOr(operationsRead, []);
  const providerReferences = operations
    .map((operation) => operation.providerRef)
    .filter((reference): reference is string => reference !== null);

  const [journalRead, approvalsRead, breaksRead, changeRequestsRead, mcpRead, policiesRead, claimsRead, statementsRead, kybRead, timelineRead, webhooksRead] =
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
    ]);

  const breaks = valueOr(breaksRead, []);
  const now = new Date();

  return (
    <PortalShell
      user={user}
      active="home"
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

      <DetailGrid
        main={
          <>
            <Panel title="Money operations, with what each step took">
              <FailureLine attempted={operationsRead} />
              {operations.length === 0 ? (
                <Empty>No money operation has ever been created for this object.</Empty>
              ) : (
                <div className="table-scroll" role="region" aria-label="Money operations" tabIndex={0}>
                  <table>
                    <thead>
                      <tr>
                        <th>Created (UTC)</th>
                        <th>Kind</th>
                        <th className="amount">Amount</th>
                        <th>Last status</th>
                        <th>Requested to accepted</th>
                        <th>Accepted to succeeded</th>
                        <th>Provider reference</th>
                        <th>Object</th>
                      </tr>
                    </thead>
                    <tbody>
                      {operations.map((operation) => (
                        <tr key={operation.operationId}>
                          <td>{utc(operation.createdAt)}</td>
                          <td>
                            {operation.kind}
                            <br />
                            <span className="note">{operation.provider}</span>
                          </td>
                          <td className="amount">{formatCentsAsUsd(operation.amountCents)}</td>
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
                            {operation.failureReason ? (
                              <>
                                <br />
                                <span className="note">{operation.failureReason}</span>
                              </>
                            ) : null}
                          </td>
                          <td>{formatSeconds(operation.requestedToAcceptedSeconds)}</td>
                          <td>{formatSeconds(operation.acceptedToSucceededSeconds)}</td>
                          <td>
                            <code>{operation.providerRef ?? "none"}</code>
                          </td>
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
                  <table>
                    <thead>
                      <tr>
                        <th>Received (UTC)</th>
                        <th>Type</th>
                        <th>Processing</th>
                        <th>Attempts</th>
                        <th>Last error</th>
                        <th>Event id</th>
                      </tr>
                    </thead>
                    <tbody>
                      {valueOr(webhooksRead, []).map((webhook) => (
                        <tr key={webhook.webhookEventId}>
                          <td>{utc(webhook.receivedAt)}</td>
                          <td>{webhook.eventType}</td>
                          <td>
                            <Chip tone={webhook.status === "done" ? "ok" : webhook.status === "failed" ? "warn" : "neutral"}>
                              {webhook.status ?? "no processing row"}
                            </Chip>
                          </td>
                          <td>{webhook.attempts ?? 0}</td>
                          <td>{webhook.lastError ?? <span className="note">none</span>}</td>
                          <td>
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
                    <table>
                      <thead>
                        <tr>
                          <th>Policy</th>
                          <th>Status (cache)</th>
                          <th>Term</th>
                          <th className="amount">Charged</th>
                          <th>{subject.kind === "customer" ? "Broker" : "Customer"}</th>
                          <th>Everything about it</th>
                        </tr>
                      </thead>
                      <tbody>
                        {valueOr(policiesRead, []).map((policy) => (
                          <tr key={policy.policyId}>
                            <td>
                              <Link href={`/policies/${policy.policyId}`} prefetch={false}>
                                {policy.policyNumber}
                              </Link>
                            </td>
                            <td>{policy.status ?? <span className="note">not cached</span>}</td>
                            <td>{policy.effectiveAt ? `${policy.effectiveAt} to ${policy.termEnd}` : <span className="note">not bound</span>}</td>
                            <td className="amount">
                              {policy.totalChargeCents === null ? "" : formatCentsAsUsd(policy.totalChargeCents)}
                            </td>
                            <td>
                              {subject.kind === "customer" ? (
                                <Link href={`/ops/console/broker/${policy.brokerId}`} prefetch={false}>
                                  {policy.brokerName}
                                </Link>
                              ) : (
                                <Link href={`/ops/console/customer/${policy.customerId}`} prefetch={false}>
                                  <Masked value={policy.customerName} what="customer name" />
                                </Link>
                              )}
                            </td>
                            <td>
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
                  <table>
                    <thead>
                      <tr>
                        <th>Claim</th>
                        <th>Policy</th>
                        <th>Claimant</th>
                        <th>Loss</th>
                        <th>Events</th>
                        <th>Everything about it</th>
                      </tr>
                    </thead>
                    <tbody>
                      {valueOr(claimsRead, []).map((claim) => (
                        <tr key={claim.claimId}>
                          <td>
                            <Link href={`/ops/claims/${claim.claimId}`} prefetch={false}>
                              {claim.claimNumber}
                            </Link>
                          </td>
                          <td>
                            <Link href={`/policies/${claim.policyId}`} prefetch={false}>
                              {claim.policyNumber}
                            </Link>
                          </td>
                          <td>
                            <Masked value={claim.claimantName} what="claimant name" />
                          </td>
                          <td>{claim.occurredAt}</td>
                          <td>{claim.eventCount}</td>
                          <td>
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
    </PortalShell>
  );
}
