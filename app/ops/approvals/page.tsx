import { PortalShell } from "@/components/portal-shell";
import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/db/client";
import { approvalRequests } from "@/lib/approvals/approvals";
import { MONEY_OUT_APPROVAL_THRESHOLD_CENTS } from "@/lib/approvals/threshold";
import { currentUser } from "@/lib/auth/current-user";
import { formatCentsAsUsd } from "@/lib/money/cents";

// The maker-checker queue: every money-out above the threshold, who asked for it, exactly what
// they asked for, and the two buttons that decide it.
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

  return (
    <PortalShell active="approvals" user={user}>
      <p className="note">
        <Link href="/ops/claims">All claims</Link>
      </p>

      <h1>Money-out approvals</h1>
      <p className="lead">
        Anything above {formatCentsAsUsd(MONEY_OUT_APPROVAL_THRESHOLD_CENTS)} leaving this system,
        a claim payment or a cancellation refund, waits here until a staff approver who is not the
        person who asked says yes. Signed in as {user.displayName} ({user.role}).
      </p>
      <p className="note">
        The threshold is an assumption of this build, decided on 2026-09-08 and recorded in the
        decision log. It is not a regulatory figure.
      </p>

      {query.error ? <p className="error" role="alert">{query.error}</p> : null}
      {query.decided ? <p className="note" role="status">Recorded: the request was {query.decided}.</p> : null}

      {requests.length === 0 ? (
        <p className="note" role="status">Nothing is waiting. A money-out below the threshold never appears here.</p>
      ) : (
        requests.map((request) => {
          const isOwnRequest = request.requestedByUserId === user.id;
          const isApprover = user.role === "staff_approver";
          const alreadyDecided = request.decision !== null;

          return (
            <section key={request.requestId} className="card-block">
              <h2>
                {formatCentsAsUsd(request.amountCents)}, {request.kind.replace("_", " ")}
              </h2>
              <div className="table-scroll" role="region" aria-label="Approval request details" tabIndex={0}>
        <table className="approval-details">
                <tbody>
                  <tr>
                    <th>Asked by</th>
                    <td>
                      {request.requestedByName} on {request.requestedAt.toISOString().slice(0, 19)} UTC
                    </td>
                  </tr>
                  <tr>
                    <th>Where the money would go</th>
                    <td>{request.destination}</td>
                  </tr>
                  {request.raisedThrough ? (
                    <tr>
                      {/* Slice B11: the request came through the MCP endpoint. An approver has to
                          see that a machine asked before deciding; the agent itself can never
                          decide, in this application and in the database. */}
                      <th>How it was raised</th>
                      <td>
                        {request.raisedByAgent ? <strong>Raised by an AGENT. </strong> : null}
                        {request.raisedThrough}. The person named above holds that key; an agent
                        principal can never approve a money-out.
                      </td>
                    </tr>
                  ) : null}
                  <tr>
                    <th>What is being approved, exactly</th>
                    <td>
                      {/* The very bytes that were hashed when the request was written. The
                          execution rebuilds this text from the state of the world at that
                          moment and refuses to pay if it differs by one character. */}
                      <pre className="intent">{request.canonicalIntent}</pre>
                      <span className="note">sha256 of that text: {request.intentHash}</span>
                    </td>
                  </tr>
                  <tr>
                    <th>Subject</th>
                    <td>
                      {request.subjectKind === "claim" ? (
                        <Link href={`/ops/claims/${request.subjectId}`}>this claim</Link>
                      ) : (
                        <Link href={`/policies/${request.subjectId}`}>this policy</Link>
                      )}
                    </td>
                  </tr>
                  {alreadyDecided ? (
                    <tr>
                      <th>Decision</th>
                      <td>
                        {request.decision} by {request.decidedByName} on{" "}
                        {request.decidedAt?.toISOString().slice(0, 19)} UTC
                        {request.decisionReason ? `, reason: ${request.decisionReason}` : ""}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
        </div>

              {alreadyDecided ? (
                <p className="note">
                  This request has been decided. A different amount, claim or destination account needs a new
                  request: the approval is bound to the intent above and refuses anything else.
                </p>
              ) : !isApprover ? (
                <p className="note">
                  You are signed in as {user.role}. Only a staff approver can decide a money-out request, and the
                  database refuses a decision from anyone else, including an automated agent.
                </p>
              ) : isOwnRequest ? (
                <p className="note">
                  You asked for this money-out yourself, so you cannot approve it. Maker-checker needs a second
                  person; the database refuses a decision whose author is the requester.
                </p>
              ) : (
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
              )}
            </section>
          );
        })
      )}
    </PortalShell>
  );
}
