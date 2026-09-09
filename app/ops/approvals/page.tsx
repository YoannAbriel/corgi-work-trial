import "@/app/styles/money.css";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Chip } from "@/components/detail-layout";
import { SandboxReferences } from "@/components/disclosures";
import { PortalShell } from "@/components/portal-shell";
import { About } from "@/components/ui/about";
import { EmptyState } from "@/components/ui/empty";
import { Stat, Stats } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable, ExpandHead, ExpandRow, FactGrid, Num } from "@/components/ui/table";
import { When } from "@/components/ui/time";
import { sql } from "@/db/client";
import { approvalRequests, type ApprovalRequestView } from "@/lib/approvals/approvals";
import { MONEY_OUT_APPROVAL_THRESHOLD_CENTS } from "@/lib/approvals/threshold";
import { currentUser, type SignedInUser } from "@/lib/auth/current-user";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { pickView, toastsFromQuery, withParams, type Query } from "@/lib/ui/views";

// The maker-checker queue: every money-out above the threshold, who asked for it, exactly what
// they asked for, and the two buttons that decide it.
//
// Two views of the same read: what is waiting, and what has been decided. The columns are the
// same in both, so an approver reads the queue and its history the same way.
//
// The screen is deliberately explicit about WHY a viewer cannot decide, because "the button is
// not there" is not an explanation. Three reasons, and each one is a rule of general
// non-negotiable 6:
//   - you are not a staff approver;
//   - you asked for this yourself;
//   - somebody has already decided it.
// The row says which one in one word; About says what each one means.

const PATH = "/ops/approvals";
const VIEWS = ["waiting", "decided"] as const;

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "staff_ops" && user.role !== "staff_approver") {
    redirect("/broker");
  }

  const [requests, query] = await Promise.all([approvalRequests(sql), searchParams]);
  // One clock for the whole page, so every age on it is measured from the same instant.
  const now = new Date();
  const waiting = requests.filter((request) => request.decision === null);
  const decided = requests.filter((request) => request.decision !== null);
  const waitingCents = waiting.reduce((total, request) => total + request.amountCents, 0);
  const approved = decided.filter((request) => request.decision === "approved").length;
  const raisedByAgent = requests.filter((request) => request.raisedByAgent).length;

  const view = pickView(query.view, VIEWS);
  const rows = view === "waiting" ? waiting : decided;
  const isApprover = user.role === "staff_approver";

  const toasts = toastsFromQuery(query, {
    error: { tone: "error", title: "Refused" },
    decided: { tone: "ok", title: "Decision recorded" },
  });

  const views = VIEWS.map((one) => ({
    key: one,
    label: one === "waiting" ? "Waiting" : "Decided",
    href: withParams(PATH, query, { view: one }),
    current: one === view,
    count: one === "waiting" ? waiting.length : decided.length,
  }));

  return (
    <PortalShell
      user={user}
      active="approvals"
      views={views}
      toasts={toasts}
      band={{
        title: "Money-out approvals",
        meta: (
          <>
            <Chip tone={waiting.length > 0 ? "warn" : "ok"}>
              {waiting.length === 0 ? "nothing waiting" : `${waiting.length} waiting, ${formatCentsAsUsd(waitingCents)}`}
            </Chip>
            <Chip tone="neutral">above {formatCentsAsUsd(MONEY_OUT_APPROVAL_THRESHOLD_CENTS)}</Chip>
            {/* A refund leaves through Stripe, a claim payment through the simulated rail: both
                slots are named here, in the same words as every other screen (AF-02). */}
            <Chip tone="ok">Stripe: LIVE SANDBOX</Chip>
            <Chip tone="neutral">claim rail: LOCAL SIMULATOR</Chip>
            {isApprover ? null : <Chip tone="warn">you cannot decide: not an approver</Chip>}
          </>
        ),
      }}
    >
      {query.error ? (
        <div className="notices">
          <p className="error" role="alert">
            {typeof query.error === "string" ? query.error : query.error[0]}
          </p>
        </div>
      ) : null}

      <Stats>
        <Stat label="Waiting" value={waiting.length} tone={waiting.length > 0 ? "warn" : "ok"} note="no money moves until decided" />
        <Stat label="Amount waiting" value={formatCentsAsUsd(waitingCents)} tone="accent" note="sum of the requests above" />
        <Stat label="Approved" value={approved} note={`of ${decided.length} decided`} />
        <Stat label="Agent raised" value={raisedByAgent} tone={raisedByAgent > 0 ? "warn" : "neutral"} note="asked through the MCP endpoint" />
      </Stats>

      <DataTable ariaLabel={view === "waiting" ? "Money-out requests waiting" : "Money-out requests already decided"}>
        <thead>
          <tr>
            <ExpandHead />
            <th className="num">Amount</th>
            <th>What</th>
            <th>Asked by</th>
            <th>Destination</th>
            <th>Subject</th>
            <th>Decision</th>
          </tr>
        </thead>
        {rows.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={7} className="dt-empty">
                <EmptyState illustration={view === "waiting" ? "all-clear" : "closed-folder"}>
                  {view === "waiting" ? "Nothing is waiting for a decision." : "No request has been decided yet."}
                </EmptyState>
              </td>
            </tr>
          </tbody>
        ) : (
          rows.map((request) => (
            <ExpandRow
              key={request.requestId}
              columns={6}
              cells={
                <>
                  <Num>{formatCentsAsUsd(request.amountCents)}</Num>
                  <td>
                    {request.kind.replace(/_/g, " ")}
                    {/* An approver has to see that a machine asked before deciding, so this badge
                        is never folded away; the agent itself can never decide, here or in the
                        database (slice B11). */}
                    {request.raisedByAgent ? (
                      <span className="dt-sub">
                        <Chip tone="warn">agent raised</Chip>
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {request.requestedByName}
                    <span className="dt-sub">
                      <When instant={request.requestedAt} now={now} />
                    </span>
                  </td>
                  <td>{request.destination}</td>
                  <td>
                    <Link href={request.subjectKind === "claim" ? `/ops/claims/${request.subjectId}` : `/policies/${request.subjectId}`} prefetch={false}>
                      {request.subjectKind}
                    </Link>
                  </td>
                  <td className="dt-actions">
                    <Decision request={request} user={user} />
                  </td>
                </>
              }
            >
              {/* "What was approved, exactly": the very bytes that were hashed when the request
                  was written. It is what an approver reads before deciding, and what the
                  execution compares against. */}
              <p className="dt-muted" style={{ margin: "0 0 6px" }}>
                What was approved, exactly
              </p>
              <pre className="money-intent">{request.canonicalIntent}</pre>
              <FactGrid
                items={[
                  { label: "sha256 of that text", value: request.intentHash },
                  { label: "Asked at", value: `${utc(request.requestedAt)} UTC` },
                  ...(request.raisedThrough ? [{ label: "Raised through", value: request.raisedThrough }] : []),
                  ...(request.decidedAt
                    ? [{ label: "Decided at", value: `${utc(request.decidedAt)} UTC by ${request.decidedByName ?? "unknown"}` }]
                    : []),
                  ...(request.decisionReason ? [{ label: "Reason", value: request.decisionReason }] : []),
                  {
                    label: "References",
                    value: (
                      <SandboxReferences
                        inline
                        references={[
                          { label: "Approval request id", value: request.requestId },
                          { label: "sha256 of the approved text", value: request.intentHash },
                        ]}
                      />
                    ),
                  },
                ]}
              />
            </ExpandRow>
          ))
        )}
      </DataTable>

      <About>
        <h4>The threshold</h4>
        <p>
          Anything above {formatCentsAsUsd(MONEY_OUT_APPROVAL_THRESHOLD_CENTS)} leaving this system, a claim payment or
          a cancellation refund, waits here until a staff approver who is not the person who asked says yes. The
          threshold is an assumption of this build, decided on 2026-09-08 and recorded in the decision log. It is not a
          regulatory figure.
        </p>
        <h4>It is cumulative</h4>
        <p>
          A payment below the threshold still waits here when it takes the claim&rsquo;s money out above the line, and
          a refund below it waits when it takes the policy&rsquo;s refunds above the line
          (<code>lib/approvals/threshold.ts</code>), so a payout cannot be split into sub-threshold pieces to skip the
          approver. That is why a small request can be in the list with no agent behind it.
        </p>
        <h4>Agent raised</h4>
        <p>
          The other sub-threshold case is a request an agent raised through the MCP endpoint, which waits for a human
          approver whatever the amount (rule 21 of the decision log). The person named in the row holds that key; an
          agent principal can never approve a money-out.
        </p>
        <h4>What you approve</h4>
        <p>
          Open a row to read it. What you approve is the exact text shown there, and its sha256 is stored with the
          request: at execution time the intent is rebuilt from the state of the world at that moment and the payment
          is refused if it differs by one character, so an approval can never authorise a different amount, claim or
          destination account.
        </p>
        <h4>Why a decision can be refused</h4>
        <p>
          Three reasons stop a decision, and the database enforces all three, not the screen. <strong>Not an
          approver</strong>: only a staff approver can decide, including against an automated agent. <strong>Your own
          request</strong>: maker-checker needs a second person, so the database refuses a decision whose author is the
          requester. <strong>Decided</strong>: somebody has already answered it, and a different amount, claim or
          destination account needs a new request.
        </p>
      </About>
    </PortalShell>
  );
}

// What one row offers the person reading it: the decision that was taken, or the form that takes
// it, or the one word saying why this viewer cannot. The form itself is unchanged: same action,
// same method, same field names, same two submit values.
function Decision({ request, user }: { request: ApprovalRequestView; user: SignedInUser }) {
  if (request.decision !== null) {
    return (
      <>
        <Chip tone={request.decision === "approved" ? "ok" : "neutral"}>{request.decision}</Chip>
        <span className="dt-sub">
          {request.decidedByName}
          {request.decidedAt ? `, ${calendarDate(request.decidedAt)}` : ""}
        </span>
      </>
    );
  }
  if (user.role !== "staff_approver") {
    return <Chip tone="neutral">not an approver</Chip>;
  }
  if (request.requestedByUserId === user.id) {
    return <Chip tone="neutral">your own request</Chip>;
  }
  return (
    <form method="post" action={`/api/approvals/${request.requestId}`} className="money-decide">
      <label className="visually-hidden" htmlFor={`reason-${request.requestId}`}>
        Reason, optional, kept with the decision
      </label>
      <input id={`reason-${request.requestId}`} name="reason" type="text" placeholder="Reason, optional" />
      <span className="money-decide-buttons">
        <SubmitButton className="orange" name="decision" value="approved">
          Approve
        </SubmitButton>
        <SubmitButton className="danger" name="decision" value="rejected">
          Reject
        </SubmitButton>
      </span>
    </form>
  );
}

function utc(instant: Date): string {
  return instant.toISOString().replace("T", " ").slice(0, 19);
}

function calendarDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}
