import { PortalShell } from "@/components/portal-shell";
import { Disclosure, RowActions } from "@/components/disclosures";
import { AsideList, Chip, DetailGrid, DetailHeading, Empty, Facts, Panel } from "@/components/detail-layout";
import type { SignedInUser } from "@/lib/auth/current-user";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { CUSTOMER_APPROVAL_THRESHOLD_CENTS } from "@/lib/money/endorsement";
import {
  changeRequestsOfPolicy,
  CHANGE_REQUEST_LINES,
  CHANGE_REQUEST_LINE_LABELS,
  COMMENT_MAXIMUM_CHARACTERS,
  COMMENT_MINIMUM_CHARACTERS,
  REPLY_MAXIMUM_CHARACTERS,
  type ChangeRequestView,
} from "@/lib/policy/change-requests";
import { policyAsItStoodOn } from "@/lib/policy/correction-read";
import { endorsementScheduleOfPolicy } from "@/lib/policy/endorsement-read";
import type { PolicyDetail } from "@/lib/policy/read";
import { termsInForceOn } from "@/lib/policy/terms-in-force";
import { PolicyTimeline } from "./correction-sections";

// The customer's own view of their policy, and the change requests that go with it (slice B13-6,
// decided by Yoann on 2026-09-08 at 20:35 UTC).
//
// Two components live here, one for each side of the same conversation:
//
//   CustomerPolicyView       what the customer sees at /policies/{id}: their policy, read-only,
//                            plus the form that asks the broker for a change.
//   CustomerChangeRequestsPanel  the panel the owning broker and staff see on the same page,
//                            with the requests waiting for them and the box to answer one.
//
// WHAT THE CUSTOMER DOES NOT SEE, deliberately: the journal, the ledger sums, the broker's
// commission, the claims, the corrections, and every button that changes something. The only
// action they have is asking. Their page is a read of the policy as it stood today (the same fold
// the staff page uses), the endorsement events and their own requests; the server checks who they
// are before rendering a single line of it (app/policies/[policyId]/page.tsx), and every route
// they can reach checks it again.

export async function CustomerPolicyView({
  user,
  policy,
  searchParams,
}: {
  user: SignedInUser;
  policy: PolicyDetail;
  // The page's own searchParams, passed through: this component reads the two notices its own
  // forms produce and ignores everything else. A repeated parameter arrives as an array, which is
  // why the values are typed with one (review finding F-B13-32); the two this component reads are
  // printed through `oneValue` below.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  // A date field cannot start on a date it would refuse: on a policy whose term has not begun,
  // today is before the minimum, so the term start is the honest default (F-B8-07, F-B8-09).
  const documentDate = today > policy.effectiveAt ? today : policy.effectiveAt;

  const [query, schedule, requests, termsToday] = await Promise.all([
    searchParams,
    endorsementScheduleOfPolicy(policy.policyId),
    changeRequestsOfPolicy(policy.policyId),
    // THE TERMS IN FORCE ON THIS DATE, not the latest terms on the policy record (review finding
    // F-INT-02). policy_current applies every event whatever its effective date, so this page was
    // printing a future endorsement's premium, tax and LIMITS as the cover in force today, to the
    // insured, while the staff page for the same policy printed the real ones. Same fold, same
    // function, same day, on both screens.
    policyAsItStoodOn(policy.policyId, documentDate),
  ]);
  const terms = termsInForceOn(policy, termsToday);
  // Applied endorsements that have not taken effect yet: the gap between what the policy is today
  // and what policy_current already carries. Named under the facts rather than folded into them.
  const endorsementsNotYetInForce = schedule.filter((row) => row.effectiveAt > documentDate);
  const statusTone =
    policy.status === "bound" ? "ok" : policy.status === "cancelled" || policy.status === "voided" ? "warn" : "neutral";

  // One value out of a query parameter, whatever the address carries: a repeated parameter is an
  // array, and React would print its entries run together (review finding F-B13-32).
  const oneValue = (parameter: string | string[] | undefined) =>
    Array.isArray(parameter) ? parameter[0] : parameter;
  const refusal = oneValue(query.error);

  const notices = [
    refusal ? (
      <p key="error" className="error" role="alert">
        {refusal}
      </p>
    ) : null,
    oneValue(query.changeRequest) === "sent" ? (
      <p key="sent" className="note" role="status">
        Your request is with your broker. It is on this page below, and it appears on their own screen as work waiting
        for them. Nothing on the policy has changed yet: your broker answers first.
      </p>
    ) : null,
  ].filter(Boolean);

  return (
    <PortalShell
      active="policies"
      user={user}
      trail={[{ label: "Your policies", href: "/customer" }, { label: `Policy ${policy.policyNumber}` }]}
    >
      <DetailHeading
        title={`Policy ${policy.policyNumber}`}
        lead={`${policy.customerName} · ${policy.stateCode} · ${policy.effectiveAt} to ${policy.termEnd} · written by ${policy.brokerName}`}
        chips={<Chip tone={statusTone}>{policy.status.replace(/_/g, " ")}</Chip>}
      />

      {notices.length > 0 ? <div className="notices">{notices}</div> : null}

      <DetailGrid
        main={
          <>
            {/* UI-036: a voided policy cannot be rebuilt on a date, so the figures below are the
                ones on the policy record. The section used to be headed "Terms in force", open on
                "These are the terms in force on that date", and then warn underneath that they
                were nothing of the kind. The heading and the sentence now follow the fold. */}
            <Panel title={terms.onDate ? `Terms in force on ${terms.onDate}` : "Figures on your policy record"}>
              <Facts
                items={[
                  { label: "Annual premium", value: formatCentsAsUsd(terms.annualPremiumCents) },
                  {
                    label: `${policy.stateCode} premium tax (${(terms.taxRateBps / 100).toFixed(2)}%)`,
                    value: formatCentsAsUsd(terms.taxCents),
                  },
                  { label: "Policy fee, once at issuance", value: formatCentsAsUsd(terms.feeCents) },
                  {
                    label: "Full annual term at these terms",
                    value: formatCentsAsUsd(terms.totalChargeCents),
                    emphasis: true,
                  },
                  ...terms.limits.map((limit) => ({ label: limit.label, value: formatCentsAsUsd(limit.cents) })),
                ]}
              />
              {terms.onDate !== null ? (
                <p className="note">
                  These are the terms in force on that date. What you were charged over the life of the policy is in the
                  endorsement schedule below and on your declarations page.
                </p>
              ) : (
                <p className="note">
                  Your policy cannot be rebuilt on {documentDate}: {"error" in termsToday ? termsToday.error : "no answer"}.
                  The figures above are the ones written on your policy record. They are not cover in force on a date,
                  and this policy is {policy.status.replace(/_/g, " ")}.
                </p>
              )}
              {/* The same sentence the staff page prints (F-YA-07, F-INT-02): what the policy is
                  today, and separately what it becomes. The figures come from the endorsement's
                  own stored event; nothing is recomputed. */}
              {endorsementsNotYetInForce.map((row) => (
                <p key={`not-yet-${row.endorsedEventId}`} className="note">
                  An endorsement effective {row.effectiveAt} brings the annual premium to{" "}
                  {formatCentsAsUsd(row.figures.newAnnualPremiumCents)}
                  {row.newLimitLabel ? ` (${row.newLimitLabel})` : ""}. It is in the schedule below with the amount it
                  collected; the figures above are the ones in force on {terms.onDate}.
                </p>
              ))}
            </Panel>

            <Panel title="Endorsement schedule">
              {schedule.length === 0 ? (
                <Empty>No change has been made to this policy since it was written.</Empty>
              ) : (
                <div className="table-scroll" role="region" aria-label="Endorsement schedule" tabIndex={0}>
                  <table>
                    <thead>
                      <tr>
                        <th>Effective</th>
                        <th>Change</th>
                        <th className="amount">Charged at the time</th>
                        <th className="amount">Annual premium after it</th>
                      </tr>
                    </thead>
                    <tbody>
                      {schedule.map((row) => (
                        <tr key={row.endorsedEventId}>
                          <td>{row.effectiveAt}</td>
                          <td>
                            {row.description}
                            <br />
                            <span className="note">{row.newLimitLabel}</span>
                          </td>
                          <td className="amount">{formatCentsAsUsd(row.figures.deltaTotalCents)}</td>
                          <td className="amount">{formatCentsAsUsd(row.figures.newAnnualPremiumCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Disclosure title="Why a change costs less than a full year">
                <p>
                  A change made in the middle of the term is priced over the days that remain from its effective date to
                  the end of the year, plus the state premium tax on that amount, rounded in your favour. The last column
                  is the new yearly rate; the column before it is the money that actually moved at the time.
                </p>
              </Disclosure>
            </Panel>

            <Panel title="Ask for a change">
              <form method="post" action={`/api/policies/${policy.policyId}/change-requests`} className="card">
                <p className="note">
                  Tick what the request is about and say what you would like changed. Your broker reads it on their own
                  screen and answers it here. This asks for a change; it does not make one, and no money moves until
                  your broker prices it and you accept the quote.
                </p>
                {CHANGE_REQUEST_LINES.map((line) => (
                  <label key={line} htmlFor={`line-${line}`} className="checkbox-label">
                    <input type="checkbox" id={`line-${line}`} name="lines" value={line} />
                    {CHANGE_REQUEST_LINE_LABELS[line]}
                  </label>
                ))}
                <label htmlFor="comment">What you would like changed</label>
                <textarea
                  id="comment"
                  name="comment"
                  rows={4}
                  required
                  minLength={COMMENT_MINIMUM_CHARACTERS}
                  maxLength={COMMENT_MAXIMUM_CHARACTERS}
                  placeholder="we have moved to 214 Bryant Street and the aggregate limit should cover the new workshop"
                />
                <span className="note">
                  Between {COMMENT_MINIMUM_CHARACTERS} and {COMMENT_MAXIMUM_CHARACTERS} characters. The server checks
                  the lines and the length again when you send it.
                </span>
                <button type="submit" className="orange">
                  Request a change
                </button>
              </form>
            </Panel>

            <Panel title="Your change requests">
              {requests.length === 0 ? (
                <Empty illustration="in-tray">You have not asked for anything on this policy yet.</Empty>
              ) : (
                <div className="table-scroll" role="region" aria-label="Your change requests" tabIndex={0}>
                  <table>
                    <thead>
                      <tr>
                        <th>Asked</th>
                        <th>About</th>
                        <th>What you asked</th>
                        <th>Answer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requests.map((request) => (
                        <tr key={request.requestId}>
                          <td>{instant(request.recordedAt)}</td>
                          <td>{linesOf(request)}</td>
                          <td>{request.comment}</td>
                          <td>
                            {request.reply ? (
                              <>
                                {request.reply.text}
                                <br />
                                <span className="note">
                                  {request.reply.repliedByName}, {instant(request.reply.recordedAt)}
                                  {request.reply.outcome === "done" ? ", and the change has been made" : ""}
                                </span>
                              </>
                            ) : (
                              <span className="note">Waiting for your broker. Nothing has changed on the policy.</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            {/* The customer audience: the same events, the same two dates and the same amounts,
                without the free text a staff operator writes into a correction reason for
                operations (F-B13-06). */}
            <PolicyTimeline policyId={policy.policyId} audience="customer" />
          </>
        }
        aside={
          <>
            <Panel title="Your broker">
              <AsideList items={[{ label: "Written by", value: policy.brokerName }]} />
              <p className="note">
                Your broker writes every change to this policy. Asking here is the way to reach them about it, and their
                answer stays on this page.
              </p>
            </Panel>

            <Panel title="Documents as of a date">
              <form method="get" action={`/api/policies/${policy.policyId}/documents/declarations`} className="card">
                <label htmlFor="asOfDeclarations">Declarations page as of</label>
                <input id="asOfDeclarations" name="asOf" type="date" defaultValue={documentDate} min={policy.effectiveAt} required />
                <button type="submit" className="secondary">
                  Open the declarations page (PDF)
                </button>
              </form>
              <form method="get" action={`/api/policies/${policy.policyId}/documents/endorsement-schedule`} className="card">
                <label htmlFor="asOfSchedule">Endorsement schedule as of</label>
                <input id="asOfSchedule" name="asOf" type="date" defaultValue={documentDate} min={policy.effectiveAt} required />
                <button type="submit" className="secondary">
                  Open the endorsement schedule (PDF)
                </button>
              </form>
              <p className="note">
                Rebuilt from the events effective on or before the date you pick: between two changes, the declarations
                page shows the premium and the limits that were in force that day.
              </p>
            </Panel>

            <Panel title="How to read this page">
              <Disclosure title="This page only reads">
                <p>
                  Nothing here changes your policy. Your broker writes the changes, and the timeline below records every
                  one of them with the date it applies from and the moment it was written down.
                </p>
              </Disclosure>
              <Disclosure title="What happens to a request">
                <p>
                  It reaches your broker as work waiting for them. They answer it once, either with an answer or by
                  making the change. A change that costs money is quoted first, and once this term&apos;s changes add
                  more than {formatCentsAsUsd(CUSTOMER_APPROVAL_THRESHOLD_CENTS)} of premium you accept the quote yourself
                  before anything is collected.
                </p>
              </Disclosure>
            </Panel>
          </>
        }
      />
    </PortalShell>
  );
}

// ---------------------------------------------------------------------------
// The broker's side of the same conversation
// ---------------------------------------------------------------------------

// The panel on the policy page for the owning broker and for staff: what the customer has asked
// on this policy, and the box to answer one request. Read-only for a staff approver, whose job is
// deciding money out, not writing policies.
export async function CustomerChangeRequestsPanel({ policyId, canReply }: { policyId: string; canReply: boolean }) {
  const requests = await changeRequestsOfPolicy(policyId);
  const waiting = requests.filter((request) => request.reply === null).length;

  return (
    <Panel title="Customer requests">
      {/* The anchor the reply route comes back to, so the broker lands on their own answer. */}
      <div id="customer-requests" />
      {requests.length === 0 ? (
        <Empty>The customer has not asked for anything on this policy.</Empty>
      ) : (
        <>
          <div className="table-scroll" role="region" aria-label="Customer change requests" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Asked</th>
                  <th>About</th>
                  <th>What the customer says</th>
                  <th>Your answer</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.requestId}>
                    <td>
                      {instant(request.recordedAt)}
                      <br />
                      <span className="note">{request.requestedByName}</span>
                    </td>
                    <td>{linesOf(request)}</td>
                    <td>{request.comment}</td>
                    <td>
                      {request.reply ? (
                        <>
                          {request.reply.text}
                          <br />
                          <span className="note">
                            {request.reply.repliedByName}, {instant(request.reply.recordedAt)}
                            {request.reply.outcome === "done" ? ", change made" : ""}
                          </span>
                        </>
                      ) : canReply ? (
                        <RowActions label="Answer this request">
                          <form
                            method="post"
                            action={`/api/policies/${policyId}/change-requests/${request.requestId}/reply`}
                            className="card"
                          >
                            <p className="note">
                              Answering does not change the policy. When you agree to the change, make it through
                              Endorse on this page, then say so here.
                            </p>
                            <label htmlFor={`outcome-${request.requestId}`}>What this is</label>
                            <select id={`outcome-${request.requestId}`} name="outcome" defaultValue="answered" required>
                              <option value="answered">An answer, no change made</option>
                              <option value="done">Done: the change has been made</option>
                            </select>
                            <label htmlFor={`text-${request.requestId}`}>What the customer reads</label>
                            <textarea
                              id={`text-${request.requestId}`}
                              name="text"
                              rows={3}
                              required
                              maxLength={REPLY_MAXIMUM_CHARACTERS}
                              placeholder="the aggregate limit is now $2,000,000 from June 9, endorsed today"
                            />
                            <button type="submit" className="orange">
                              Send the answer
                            </button>
                          </form>
                        </RowActions>
                      ) : (
                        <span className="note">Waiting for the broker who writes this policy.</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">
            {waiting === 0
              ? "Every request on this policy has been answered."
              : `${waiting === 1 ? "1 request is" : `${waiting} requests are`} waiting for an answer.`}{" "}
            A request is a message, not a change: it moves no money and writes nothing on the policy. An answer is one
            row, written once, and neither side can edit what was said.
          </p>
        </>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

// The lines a request names, in the words the customer ticked. Same sentence on both sides.
function linesOf(request: ChangeRequestView): string {
  return request.lines.map((line) => CHANGE_REQUEST_LINE_LABELS[line]).join(", ");
}

// The recording time, in UTC, the way every other screen prints it.
function instant(moment: Date): string {
  return `${moment.toISOString().replace("T", " ").slice(0, 19)} UTC`;
}
