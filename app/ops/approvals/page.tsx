import "@/app/styles/money.css";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Chip } from "@/components/detail-layout";
import { PortalShell } from "@/components/portal-shell";
import { About } from "@/components/ui/about";
import { EmptyState } from "@/components/ui/empty";
import { Stat, Stats } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable, ExpandHead, ExpandRow, FactGrid, Num, Ref } from "@/components/ui/table";
import { When } from "@/components/ui/time";
import { sql } from "@/db/client";
import { approvalRequests, type ApprovalRequestView } from "@/lib/approvals/approvals";
import { MONEY_OUT_APPROVAL_THRESHOLD_CENTS } from "@/lib/approvals/threshold";
import { currentUser, type SignedInUser } from "@/lib/auth/current-user";
import { claimHeader } from "@/lib/claims/read";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { policyDetail } from "@/lib/policy/read";
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

// The rule, in one sentence, said in the band and again in the row that is waiting for it
// (cycle 2, decision 15). The threshold itself comes from lib/approvals/threshold.ts, so the
// sentence and the code that refuses a payment cannot disagree.
const MAKER_CHECKER_RULE =
  "Money out above the threshold needs a second person to approve it, never the person who asked. The database refuses a decision by the requester and by anybody who is not a staff approver.";

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
  const raisedByAgent = requests.filter((request) => request.raisedByAgent).length;

  const view = pickView(query.view, VIEWS);
  const rows = view === "waiting" ? waiting : decided;

  // THE NUMBER A PERSON RECOGNISES. The queue stores the subject's id, not its number, so the
  // Subject column used to be four identical links reading "claim" (round 1, MEDIUM). The number
  // lives on the claim and on the policy, and is read here with the readers those two screens
  // already use: read only, one row at a time, on the rows this view draws (the queue holds the
  // money-out above the threshold, so it is short). A subject that cannot be read keeps the word.
  const subjectNumbers = new Map(
    await Promise.all(
      rows.map(async (request) => {
        const number =
          request.subjectKind === "claim"
            ? (await claimHeader(request.subjectId, sql))?.claimNumber
            : (await policyDetail(request.subjectId, sql))?.policyNumber;
        return [request.requestId, number ?? request.subjectKind] as const;
      }),
    ),
  );

  const toasts = toastsFromQuery(query, {
    error: { tone: "error", title: "Refused" },
    decided: { tone: "ok", title: "Decision recorded" },
  });

  const views = VIEWS.map((one) => ({
    key: one,
    label: one === "waiting" ? "Waiting" : "Decided",
    href: withParams(PATH, query, { view: one }),
    current: one === view,
    // Only what somebody must act on carries a count (cycle 2, decision 3): the decided ones are
    // a record, not a queue.
    count: one === "waiting" ? waiting.length : undefined,
  }));

  return (
    <PortalShell
      user={user}
      active="approvals"
      views={views}
      toasts={toasts}
      band={{
        title: "Money-out approvals",
        // No chip on a list screen (Yoann, 2026-09-09): what is waiting and its amount are the
        // first two tiles, and the second-person rule is spelled out in About this screen.
      }}
    >
      {query.error ? (
        <div className="notices">
          <p className="error" role="alert">
            {typeof query.error === "string" ? query.error : query.error[0]}
          </p>
        </div>
      ) : null}

      {/* Three figures somebody acts on. How many were approved of the decided ones is history,
          and the Decided view is where it is read (cycle 2, decision 2). */}
      <Stats>
        <Stat
          label="Waiting"
          value={waiting.length}
          tone={waiting.length > 0 ? "warn" : "ok"}
          note="no money moves until decided"
          hint={MAKER_CHECKER_RULE}
        />
        <Stat label="Amount waiting" value={formatCentsAsUsd(waitingCents)} tone="accent" note="sum of the requests waiting" />
        <Stat
          label="Agent raised"
          value={raisedByAgent}
          tone={raisedByAgent > 0 ? "warn" : "neutral"}
          note="asked through the MCP endpoint"
          hint="A request an agent raised waits for a human approver whatever the amount. An agent can never decide one."
        />
      </Stats>

      {/* Five columns and the fold: what is asked, who asked, where the money would go, which
          record it hangs off, and the decision. The kind of money-out reads under its amount and
          "agent raised" under the person who asked, so the Decision cell keeps the room its two
          buttons need at 1024 px (round 1, MEDIUM). */}
      <DataTable ariaLabel={view === "waiting" ? "Money-out requests waiting" : "Money-out requests already decided"}>
        <thead>
          <tr>
            <ExpandHead />
            <th className="num">Amount</th>
            <th>Asked by</th>
            <th>Destination</th>
            <th>Subject</th>
            <th>Decision</th>
          </tr>
        </thead>
        {rows.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={6} className="dt-empty">
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
              columns={5}
              cells={
                <>
                  <Num sub={request.kind.replace(/_/g, " ")}>{formatCentsAsUsd(request.amountCents)}</Num>
                  <td>
                    {request.requestedByName}
                    <span className="dt-sub">
                      <When instant={request.requestedAt} now={now} />
                    </span>
                    {/* An approver has to see that a machine asked before deciding, so this badge
                        is never folded away; the agent itself can never decide, here or in the
                        database (slice B11). */}
                    {request.raisedByAgent ? (
                      <span className="dt-sub">
                        <Chip tone="warn">agent raised</Chip>
                      </span>
                    ) : null}
                  </td>
                  {/* The mode word and the masked tail, never the whole sentence: the account
                      holder and the parenthetical are facts of the expansion (round 1, MEDIUM).
                      The AF-02 word stays exact on the row of a simulated destination. */}
                  <td>{shortDestination(request.destination)}</td>
                  <td className="nowrap">
                    <Link href={request.subjectKind === "claim" ? `/ops/claims/${request.subjectId}` : `/policies/${request.subjectId}`} prefetch={false}>
                      {subjectNumbers.get(request.requestId)}
                    </Link>
                  </td>
                  <td className="money-decision">
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
              {/* The identifiers read as ordinary facts, one to a line, with the whole value in
                  `title`: behind a dark dot the panel was cut off by the edge of the card, and it
                  repeated the hash the row above it already prints (round 1, cycle 2 decision 7). */}
              <FactGrid
                items={[
                  { label: "Where the money would go", value: request.destination, wide: true },
                  { label: "sha256 of that text", value: <Ref value={request.intentHash} /> },
                  { label: "Approval request id", value: <Ref value={request.requestId} /> },
                  { label: "Asked at", value: `${utc(request.requestedAt)} UTC` },
                  ...(request.raisedThrough ? [{ label: "Raised through", value: request.raisedThrough }] : []),
                  ...(request.decidedAt
                    ? [{ label: "Decided at", value: `${utc(request.decidedAt)} UTC by ${request.decidedByName ?? "unknown"}` }]
                    : []),
                  ...(request.decisionReason ? [{ label: "Reason", value: request.decisionReason, wide: true }] : []),
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
      {/* The rule, above the two buttons that apply it (cycle 2, decision 15). */}
      <span className="money-decision-rule" title={MAKER_CHECKER_RULE}>
        needs a second person: not the requester
      </span>
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

// The destination in a cell: the rail, then the tail that tells one account from another. The
// whole sentence the request stored is printed in the expansion, untouched.
//
//   "LOCAL SIMULATOR bank account ...6789 held by Bay Area Fabrication LLC" -> "LOCAL SIMULATOR ...6789"
//   "Stripe payment pi_3UDN8aK6R3v50tIy0bsGOcBN (card refund to the customer)" -> "Stripe ...GOcBN"
//
// A sentence written in any other shape is cut to its first three words rather than guessed at.
// The rail keeps its own line when the cell is narrow, so the AF-02 words are never split in
// half; only the tail after them wraps.
function shortDestination(destination: string) {
  const maskedAccount = /^LOCAL SIMULATOR .*?(\.\.\.\w+)/.exec(destination);
  if (maskedAccount) return <Rail name="LOCAL SIMULATOR" tail={maskedAccount[1]} />;
  const stripePayment = /^Stripe payment (\S+)/.exec(destination);
  if (stripePayment) return <Rail name="Stripe" tail={`...${stripePayment[1].slice(-5)}`} />;
  return destination.split(" ").slice(0, 3).join(" ");
}

function Rail({ name, tail }: { name: string; tail: string }) {
  return (
    <>
      <span className="money-rail">{name}</span> {tail}
    </>
  );
}

function utc(instant: Date): string {
  return instant.toISOString().replace("T", " ").slice(0, 19);
}

function calendarDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}
