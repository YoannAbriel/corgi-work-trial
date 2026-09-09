import { PortalShell } from "@/components/portal-shell";
import { Chip } from "@/components/detail-layout";
import { About } from "@/components/ui/about";
import { EmptyState } from "@/components/ui/empty";
import { Legend } from "@/components/ui/legend";
import { Stat, Stats } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
import { Toolbar, ToolbarCount, ToolbarGroup, ToolbarSpacer } from "@/components/ui/toolbar";
import { DataTable, ExpandHead, ExpandRow, FactGrid, Num } from "@/components/ui/table";
import { When } from "@/components/ui/time";
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
import { firstValue, pickView, toastsFromQuery, withParams, type Query } from "@/lib/ui/views";
import { PolicyDocuments, PolicyTimeline } from "./correction-sections";

// The customer's own view of their policy, and the change requests that go with it (slice B13-6,
// decided by Yoann on 2026-09-08 at 20:35 UTC).
//
// Two components live here, one for each side of the same conversation:
//
//   CustomerPolicyView       what the customer sees at /policies/{id}: their policy, read-only,
//                            plus the form that asks the broker for a change.
//   CustomerChangeRequestsPanel  the card the owning broker and staff see on the same page,
//                            with the requests waiting for them and the box to answer one.
//
// WHAT THE CUSTOMER DOES NOT SEE, deliberately: the journal, the ledger sums, the broker's
// commission, the claims, the corrections, and every button that changes something. The only
// action they have is asking. Their page is a read of the policy as it stood today (the same fold
// the staff page uses), the endorsement events and their own requests; the server checks who they
// are before rendering a single line of it (app/policies/[policyId]/page.tsx), and every route
// they can reach checks it again.

const VIEWS = ["overview", "documents"] as const;

export async function CustomerPolicyView({
  user,
  policy,
  searchParams,
}: {
  user: SignedInUser;
  policy: PolicyDetail;
  // The page's own searchParams, passed through: this component reads the notices its own forms
  // produce and the view being read, and ignores everything else. A repeated parameter arrives as
  // an array, which is why every value is taken through `firstValue` (review finding F-B13-32).
  searchParams: Promise<Query>;
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

  const path = `/policies/${policy.policyId}`;
  const view = pickView(query.view, VIEWS);
  const now = new Date();
  const refusal = firstValue(query.error);
  const sent = firstValue(query.changeRequest) === "sent";

  const toasts = [
    ...toastsFromQuery(query, { error: { tone: "error" as const, title: "Refused" } }),
    ...(sent
      ? [{ tone: "ok" as const, title: "Request sent", text: "Your broker answers it on this page.", param: "changeRequest" }]
      : []),
  ];

  const notices = [
    refusal ? (
      <p key="error" className="error" role="alert">
        {refusal}
      </p>
    ) : null,
    sent ? (
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
      toasts={toasts}
      viewsSubtitle={policy.policyNumber}
      views={VIEWS.map((one) => ({
        key: one,
        label: one === "overview" ? "Overview" : "Documents",
        href: withParams(path, query, { view: one }),
        current: one === view,
      }))}
      trail={[{ label: "Your policies", href: "/customer" }, { label: `Policy ${policy.policyNumber}` }]}
      band={{
        title: `Policy ${policy.policyNumber}`,
        suffix: policy.customerName,
        // ONE chip, the policy's own state, the same rule as the staff page (Yoann, 2026-09-09).
        // The term is a fact, not a state, and it is printed in full on the overview below. The
        // AF-02 words are the grey line in the top bar of every signed-in screen, this one
        // included.
        status: <Chip tone={statusTone}>{policy.status.replace(/_/g, " ")}</Chip>,
      }}
    >
      {notices.length > 0 ? <div className="notices">{notices}</div> : null}

      {view === "overview" ? (
        <>
          <Stats>
            <Stat
              label="Annual premium"
              value={formatCentsAsUsd(terms.annualPremiumCents)}
              note={terms.onDate ? `in force on ${terms.onDate}` : "on your policy record"}
            />
            <Stat
              label={`${policy.stateCode} premium tax`}
              value={formatCentsAsUsd(terms.taxCents)}
              note={`${(terms.taxRateBps / 100).toFixed(2)}% of the premium`}
            />
            <Stat label="Policy fee" value={formatCentsAsUsd(terms.feeCents)} note="once at issuance" />
            <Stat label="Full annual term" tone="accent" value={formatCentsAsUsd(terms.totalChargeCents)} note="premium, tax and fee" />
          </Stats>

          {/* UI-036: a voided policy cannot be rebuilt on a date, so the figures above are the
              ones on the policy record. The page used to promise "the terms in force on that
              date" and warn underneath that they were nothing of the kind. */}
          {terms.onDate === null ? (
            <div className="notices">
              <p className="note">
                Your policy cannot be rebuilt on {documentDate}: {"error" in termsToday ? termsToday.error : "no answer"}.
                The figures above are the ones written on your policy record. They are not cover in force on a date, and
                this policy is {policy.status.replace(/_/g, " ")}.
              </p>
            </div>
          ) : null}
          {/* The same line the staff page prints (F-YA-07, F-INT-02): what the policy is today,
              and separately what it becomes. One short line here, the rest under its own heading
              in About (round 1: a 40 word paragraph in the reading flow). The figures come from
              the endorsement's own stored event; nothing is recomputed. */}
          {endorsementsNotYetInForce.length > 0 ? (
            <p className="pd-lead">
              {endorsementsNotYetInForce.map((row) => (
                <span key={`not-yet-${row.endorsedEventId}`}>
                  From {row.effectiveAt} your annual premium becomes{" "}
                  {formatCentsAsUsd(row.figures.newAnnualPremiumCents)}.{" "}
                </span>
              ))}
            </p>
          ) : null}

          {/* The form is tall and the facts beside it are short: `.layout-2` lets the short card
              keep its own height instead of stretching to the form's. */}
          <div className="layout-2">
            <section className="card pd-form-card">
              <h2>Ask for a change</h2>
              <form method="post" action={`/api/policies/${policy.policyId}/change-requests`} className="card">
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
                <SubmitButton className="orange">Request a change</SubmitButton>
                {/* The rule the field enforces stays beside the field; what asking means is in
                    About (cycle 2, decision 9). */}
                <p className="pd-note">
                  Between {COMMENT_MINIMUM_CHARACTERS} and {COMMENT_MAXIMUM_CHARACTERS} characters.
                </p>
              </form>
            </section>

            <section className="card">
              <h2>Your cover</h2>
              <FactGrid
                items={[
                  ...terms.limits.map((limit) => ({ label: limit.label, value: formatCentsAsUsd(limit.cents) })),
                  { label: "Term", value: `${policy.effectiveAt} to ${policy.termEnd}` },
                  { label: "State", value: policy.stateCode },
                  { label: "Written by", value: policy.brokerName },
                ]}
              />
            </section>
          </div>

          <DataTable
            ariaLabel="Endorsement schedule"
            toolbar={
              <Toolbar>
                <ToolbarGroup>
                  <span className="toolbar-label">Changes to this policy</span>
                </ToolbarGroup>
                <ToolbarSpacer />
                <ToolbarCount>{schedule.length}</ToolbarCount>
              </Toolbar>
            }
            legend={
              <Legend
                items={[
                  { term: "Charged", meaning: "the money that moved at the time, priced over the days left in the year" },
                  { term: "New annual premium", meaning: "the yearly rate after the change, not the money that moved" },
                ]}
              />
            }
          >
            <thead>
              <tr>
                <th className="nowrap">Effective</th>
                <th>Change</th>
                <th className="num">Charged</th>
                <th className="num">New annual premium</th>
              </tr>
            </thead>
            <tbody>
              {schedule.length === 0 ? (
                <tr>
                  <td colSpan={4} className="dt-empty">
                    <EmptyState illustration="closed-folder">No change has been made since this policy was written.</EmptyState>
                  </td>
                </tr>
              ) : (
                schedule.map((row) => (
                  <tr key={row.endorsedEventId} className="dt-row">
                    <td className="nowrap">{row.effectiveAt}</td>
                    <td>
                      {formatCentsAsUsd(row.figures.oldAnnualPremiumCents)} to{" "}
                      {formatCentsAsUsd(row.figures.newAnnualPremiumCents)}
                      <span className="dt-sub">{row.newLimitLabel}</span>
                    </td>
                    <td className="num">{formatCentsAsUsd(row.figures.deltaTotalCents)}</td>
                    <td className="num">{formatCentsAsUsd(row.figures.newAnnualPremiumCents)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>

          {/* Nothing asked, nothing to head: the empty state stands on its own rather than under
              a row of column names describing rows that do not exist (round 1, MEDIUM). */}
          {requests.length === 0 ? (
            <section className="card">
              <h2>Your requests</h2>
              <EmptyState illustration="in-tray">You have not asked for anything on this policy yet.</EmptyState>
            </section>
          ) : (
            <DataTable
              ariaLabel="Your change requests"
              toolbar={
                <Toolbar>
                  <ToolbarGroup>
                    <span className="toolbar-label">Your requests</span>
                  </ToolbarGroup>
                  <ToolbarSpacer />
                  <ToolbarCount>{requests.length}</ToolbarCount>
                </Toolbar>
              }
            >
              <thead>
                <tr>
                  <ExpandHead />
                  <th className="nowrap">Asked</th>
                  <th>About</th>
                  <th>Answer</th>
                </tr>
              </thead>
              {requests.map((request) => (
                <ExpandRow
                  key={request.requestId}
                  columns={3}
                  cells={
                    <>
                      <td className="nowrap">
                        <When instant={request.recordedAt} now={now} />
                      </td>
                      <td>{linesOf(request)}</td>
                      <td>
                        {request.reply ? (
                          <Chip tone={request.reply.outcome === "done" ? "ok" : "neutral"}>
                            {request.reply.outcome === "done" ? "change made" : "answered"}
                          </Chip>
                        ) : (
                          <Chip tone="warn">waiting</Chip>
                        )}
                      </td>
                    </>
                  }
                >
                  <FactGrid
                    items={[
                      { label: "What you asked", value: request.comment },
                      {
                        label: "Answer",
                        value: request.reply ? (
                          <>
                            {request.reply.text}
                            <span className="dt-sub">
                              {request.reply.repliedByName}, {instant(request.reply.recordedAt)}
                            </span>
                          </>
                        ) : (
                          "Waiting for your broker. Nothing has changed on the policy."
                        ),
                      },
                    ]}
                  />
                </ExpandRow>
              ))}
            </DataTable>
          )}

          {/* The customer audience: the same events, the same two dates and the same amounts,
              without the free text a staff operator writes into a correction reason for
              operations (F-B13-06). */}
          <PolicyTimeline policyId={policy.policyId} now={now} audience="customer" />

          <About>
            {endorsementsNotYetInForce.length > 0 ? (
              <>
                <h4>Why two premiums</h4>
                {endorsementsNotYetInForce.map((row) => (
                  <p key={`about-not-yet-${row.endorsedEventId}`}>
                    An endorsement effective {row.effectiveAt} brings the annual premium to{" "}
                    {formatCentsAsUsd(row.figures.newAnnualPremiumCents)}
                    {row.newLimitLabel ? ` (${row.newLimitLabel})` : ""}. It is in the schedule above with the amount it
                    collected; the figures in the tiles are the ones in force on {terms.onDate}.
                  </p>
                ))}
              </>
            ) : null}
            <h4>Who writes a change</h4>
            <p>
              Your broker writes every change to this policy. Asking on this page is the way to reach them about it, and
              their answer stays here. Asking for a change does not make one, and no money moves until your broker
              prices it.
            </p>
            <h4>This page only reads</h4>
            <p>
              Nothing here changes your policy. Your broker writes the changes, and the timeline records every one of
              them with the date it applies from and the moment it was written down.
            </p>
            <h4>What happens to a request</h4>
            <p>
              It reaches your broker as work waiting for them. They answer it once, either with an answer or by making
              the change. A change that costs money is quoted first, and once this term&apos;s changes add more than{" "}
              {formatCentsAsUsd(CUSTOMER_APPROVAL_THRESHOLD_CENTS)} of premium you accept the quote yourself before
              anything is collected.
            </p>
            <h4>Why a change costs less than a full year</h4>
            <p>
              A change made in the middle of the term is priced over the days that remain from its effective date to the
              end of the year, plus the state premium tax on that amount, rounded in your favour.
            </p>
          </About>
        </>
      ) : null}

      {view === "documents" ? (
        <>
          {/* One card, two lines, the same block the staff overview uses: a two-word button that
              cannot wrap (round 1: both labels ran to two lines at 1024 px) and the date said
              again in the ISO format the rest of the product prints, because a browser draws a
              date field in its own locale (round 1: 09/09/2026 beside 2026-09-08). */}
          <section className="card">
            <h2>Documents</h2>
            <PolicyDocuments
              policyId={policy.policyId}
              documentDate={documentDate}
              termStart={policy.effectiveAt}
            />
          </section>

          <About>
            <h4>Rebuilt on the date you pick</h4>
            <p>
              Both documents are rebuilt from the events effective on or before the date: between two changes, the
              declarations page shows the premium and the limits that were in force that day.
            </p>
          </About>
        </>
      ) : null}
    </PortalShell>
  );
}

// ---------------------------------------------------------------------------
// The broker's side of the same conversation
// ---------------------------------------------------------------------------

// The card on the policy page for the owning broker and for staff: what the customer has asked on
// this policy, and the box to answer one request. Read-only for a staff approver, whose job is
// deciding money out, not writing policies. Nothing is drawn when nothing was asked.
export async function CustomerChangeRequestsPanel({
  policyId,
  canReply,
  now,
}: {
  policyId: string;
  canReply: boolean;
  now: Date;
}) {
  const requests = await changeRequestsOfPolicy(policyId);
  if (requests.length === 0) {
    return null;
  }
  const waiting = requests.filter((request) => request.reply === null).length;

  return (
    // The anchor the reply route comes back to, so the broker lands on their own answer.
    <div id="customer-requests">
      <DataTable
        ariaLabel="Customer change requests"
        toolbar={
          <Toolbar>
            <ToolbarGroup label="Customer requests">
              <Chip tone={waiting > 0 ? "warn" : "ok"}>{waiting === 0 ? "all answered" : `${waiting} waiting`}</Chip>
            </ToolbarGroup>
            <ToolbarSpacer />
            <ToolbarCount>{requests.length}</ToolbarCount>
          </Toolbar>
        }
        legend={
          <Legend
            items={[
              { term: "waiting", meaning: "the customer is waiting for an answer from the broker" },
              { term: "answered", meaning: "answered once, in writing; neither side can edit what was said" },
              { term: "change made", meaning: "the broker says the change itself has been endorsed" },
            ]}
          />
        }
      >
        <thead>
          <tr>
            <ExpandHead />
            <th className="nowrap">Asked</th>
            <th>By</th>
            <th>About</th>
            <th>Answer</th>
          </tr>
        </thead>
        {requests.map((request) => (
          <ExpandRow
            key={request.requestId}
            columns={4}
            cells={
              <>
                <td className="nowrap">
                  <When instant={request.recordedAt} now={now} />
                </td>
                <td>{request.requestedByName}</td>
                <td>{linesOf(request)}</td>
                <td>
                  {request.reply ? (
                    <Chip tone={request.reply.outcome === "done" ? "ok" : "neutral"}>
                      {request.reply.outcome === "done" ? "change made" : "answered"}
                    </Chip>
                  ) : (
                    <Chip tone="warn">waiting</Chip>
                  )}
                </td>
              </>
            }
          >
            <FactGrid
              items={[
                { label: "What the customer says", value: request.comment },
                ...(request.reply
                  ? [
                      {
                        label: "Your answer",
                        value: (
                          <>
                            {request.reply.text}
                            <span className="dt-sub">
                              {request.reply.repliedByName}, {instant(request.reply.recordedAt)}
                            </span>
                          </>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
            {request.reply === null && canReply ? (
              <form
                method="post"
                action={`/api/policies/${policyId}/change-requests/${request.requestId}/reply`}
                className="card"
              >
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
                <SubmitButton className="orange">Send the answer</SubmitButton>
                <p className="pd-note">
                  Answering does not change the policy. Make the change through Endorse, then say so here.
                </p>
              </form>
            ) : null}
            {request.reply === null && !canReply ? (
              <p className="pd-note">Waiting for the broker who writes this policy.</p>
            ) : null}
          </ExpandRow>
        ))}
      </DataTable>
    </div>
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
