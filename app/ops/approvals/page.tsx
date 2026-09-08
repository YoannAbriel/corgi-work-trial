import { PortalShell } from "@/components/portal-shell";
import { Disclosure, RowActions, SandboxReferences } from "@/components/disclosures";
import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/db/client";
import { approvalRequests, type ApprovalRequestView } from "@/lib/approvals/approvals";
import { MONEY_OUT_APPROVAL_THRESHOLD_CENTS } from "@/lib/approvals/threshold";
import { currentUser, type SignedInUser } from "@/lib/auth/current-user";
import { formatCentsAsUsd } from "@/lib/money/cents";

// The maker-checker queue: every money-out above the threshold, who asked for it, exactly what
// they asked for, and the two buttons that decide it.
//
// The screen shows the queue as a table, because an approver's first question is "how many, how
// much and how old", and opens the decision of one row on demand. Deciding is deliberately two
// gestures: open the row, then read the exact text that was hashed before pressing a button.
//
// The page is deliberately explicit about WHY a viewer cannot decide, because "the button is not
// there" is not an explanation. Three reasons, and each one is a rule of general non-negotiable 6:
//   - you are not a staff approver;
//   - you asked for this yourself;
//   - somebody has already decided it.
export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; decided?: string }>;
}) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "staff_ops" && user.role !== "staff_approver") {
    redirect("/broker");
  }

  const [requests, query] = await Promise.all([approvalRequests(sql), searchParams]);
  const waiting = requests.filter((request) => request.decision === null);
  const decided = requests.filter((request) => request.decision !== null);

  return (
    <PortalShell active="approvals" user={user}>
      <h1>Money-out approvals</h1>
      <p className="lead">
        Anything above {formatCentsAsUsd(MONEY_OUT_APPROVAL_THRESHOLD_CENTS)} leaving this system,
        a claim payment or a cancellation refund, waits here until a staff approver who is not the
        person who asked says yes. Signed in as {user.displayName} ({user.role}).
      </p>

      <Disclosure>
        <p>
          The threshold is an assumption of this build, decided on 2026-09-08 and recorded in the
          decision log. It is not a regulatory figure. A money-out below it never appears here.
        </p>
        <p>
          Open a row to decide it. What you approve is the exact text shown there, and its sha256
          is stored with the request: at execution time the intent is rebuilt from the state of the
          world at that moment and the payment is refused if it differs by one character, so an
          approval can never authorise a different amount, claim or destination account.
        </p>
        <p>
          Three reasons stop a decision, and the database enforces all three, not the screen: you
          are not a staff approver, you asked for this money-out yourself, or somebody has already
          decided it.
        </p>
        <p>
          <Link href="/ops/claims">All claims</Link>
        </p>
      </Disclosure>

      {query.error ? <p className="error" role="alert">{query.error}</p> : null}
      {query.decided ? <p className="note" role="status">Recorded: the request was {query.decided}.</p> : null}

      <h2>Waiting for a decision</h2>
      {waiting.length === 0 ? (
        <p className="note" role="status">Nothing is waiting. A money-out below the threshold never appears here.</p>
      ) : (
        <RequestTable requests={waiting} user={user} />
      )}

      <h2>Already decided</h2>
      {decided.length === 0 ? (
        <p className="note">No request has been decided yet.</p>
      ) : (
        <RequestTable requests={decided} user={user} />
      )}
    </PortalShell>
  );
}

// One table for both lists: the same columns, so an approver reads the queue and its history the
// same way. The last column holds the decision, or the reason there is not one to make.
function RequestTable({
  requests,
  user,
}: {
  requests: ApprovalRequestView[];
  user: SignedInUser;
}) {
  return (
    <div className="table-scroll" role="region" aria-label="Money-out approval requests" tabIndex={0}>
      <table>
        <thead>
          <tr>
            <th className="amount">Amount</th>
            <th>What</th>
            <th>Asked by</th>
            <th>Where the money would go</th>
            <th>Subject</th>
            <th>State</th>
            <th>Decision</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.requestId}>
              <td className="amount">{formatCentsAsUsd(request.amountCents)}</td>
              <td>
                {request.kind.replace("_", " ")}
                <SandboxReferences
                  references={[
                    { label: "Approval request id", value: request.requestId },
                    { label: "sha256 of the approved text", value: request.intentHash },
                  ]}
                />
              </td>
              <td>
                {request.requestedByName}
                <br />
                <span className="note">{request.requestedAt.toISOString().slice(0, 19)} UTC</span>
              </td>
              <td>{request.destination}</td>
              <td>
                {request.subjectKind === "claim" ? (
                  <Link href={`/ops/claims/${request.subjectId}`}>this claim</Link>
                ) : (
                  <Link href={`/policies/${request.subjectId}`}>this policy</Link>
                )}
              </td>
              <td>
                {request.decision === null ? (
                  <span className="badge badge-warn">waiting</span>
                ) : (
                  <span className={`badge ${request.decision === "approved" ? "badge-ok" : "badge-warn"}`}>
                    {request.decision}
                  </span>
                )}
              </td>
              <td>
                <Decision request={request} user={user} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// What one row offers the person reading it: the decision that was taken, or the form that takes
// it, or the sentence explaining why this viewer cannot.
function Decision({ request, user }: { request: ApprovalRequestView; user: SignedInUser }) {
  const isOwnRequest = request.requestedByUserId === user.id;
  const isApprover = user.role === "staff_approver";

  if (request.decision !== null) {
    return (
      <>
        {request.decision} by {request.decidedByName} on {request.decidedAt?.toISOString().slice(0, 19)} UTC
        {request.decisionReason ? <span className="note"> ({request.decisionReason})</span> : null}
        <br />
        <span className="note">
          A different amount, claim or destination account needs a new request: the approval is
          bound to the intent below and refuses anything else.
        </span>
        <ApprovedText request={request} />
      </>
    );
  }
  if (!isApprover) {
    return (
      <>
        <span className="note">
          You are signed in as {user.role}. Only a staff approver can decide a money-out request,
          and the database refuses a decision from anyone else, including an automated agent.
        </span>
        <ApprovedText request={request} />
      </>
    );
  }
  if (isOwnRequest) {
    return (
      <>
        <span className="note">
          You asked for this money-out yourself, so you cannot approve it. Maker-checker needs a
          second person; the database refuses a decision whose author is the requester.
        </span>
        <ApprovedText request={request} />
      </>
    );
  }
  return (
    <RowActions label="Decide this request">
      <ApprovedTextBody request={request} />
      <form method="post" action={`/api/approvals/${request.requestId}`} className="card">
        <label htmlFor={`reason-${request.requestId}`}>Reason (optional, kept with the decision)</label>
        <input id={`reason-${request.requestId}`} name="reason" placeholder="checked against the file" />
        <button type="submit" name="decision" value="approved">
          Approve {formatCentsAsUsd(request.amountCents)}
        </button>
        <button type="submit" name="decision" value="rejected" className="secondary destructive">
          Reject
        </button>
      </form>
    </RowActions>
  );
}

// The very bytes that were hashed when the request was written, behind a disclosure: it is what
// an approver reads before deciding, and what the execution compares against.
function ApprovedText({ request }: { request: ApprovalRequestView }) {
  return (
    <RowActions label="What was approved, exactly">
      <ApprovedTextBody request={request} />
    </RowActions>
  );
}

function ApprovedTextBody({ request }: { request: ApprovalRequestView }) {
  return (
    <>
      <pre className="intent">{request.canonicalIntent}</pre>
      <span className="note">sha256 of that text: {request.intentHash}</span>
    </>
  );
}
