import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { CUSTOMER_APPROVAL_THRESHOLD_CENTS, endorsementFormulaLines } from "@/lib/money/endorsement";
import { endorsementRequestStanding, readEndorsementRequest } from "@/lib/policy/endorsement-requests";
import { policyDetail } from "@/lib/policy/read";
import { FormulaLinesTable } from "../../../formula-lines";

// The customer's approval screen: the same formula lines the broker previewed, read back from
// the immutable request event, and one checkbox. Only the policy's customer sees it. Approving
// binds the customer to the quote hash: if the broker requests a different change afterwards,
// this approval no longer matches and cannot be used.
export default async function ApproveEndorsementPage({
  params,
  searchParams,
}: {
  params: Promise<{ policyId: string; requestEventId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  const [{ policyId, requestEventId }, query] = await Promise.all([params, searchParams]);

  const policy = await policyDetail(policyId);
  if (!policy) {
    redirect("/customer");
  }
  if (user.role !== "customer" || user.customerId !== policy.customerId) {
    redirect(`/customer?error=${encodeURIComponent("only the customer of a policy can see its approval screen")}`);
  }

  const request = await readEndorsementRequest(sql, policyId, requestEventId);
  if (!request) {
    return (
      <main>
        <p className="note">
          <Link href="/customer">Back to your policies</Link>
        </p>
        <h1>Endorsement approval</h1>
        <p className="error">This endorsement request does not exist on this policy.</p>
      </main>
    );
  }
  const standing = await endorsementRequestStanding(sql, request);
  const figures = request.figures;

  return (
    <main>
      <p className="note">
        <Link href="/customer">Back to your policies</Link>
      </p>

      <h1>Approve the endorsement of policy {policy.policyNumber}</h1>
      <p className="lead">
        Your broker {policy.brokerName} asks to change the policy from <strong>{figures.effectiveAt}</strong>:{" "}
        {request.description}. {request.reason ? `Reason given: ${request.reason}.` : null}
      </p>

      {query.error ? <p className="error">{query.error}</p> : null}

      {standing.state === "applied" ? (
        <p className="note">This endorsement is already in force.</p>
      ) : standing.state === "superseded" ? (
        <p className="error">
          This quote was superseded by a later change on the policy; the figures below are no longer the ones on offer.
        </p>
      ) : standing.approvedEventId ? (
        <p className="badge badge-ok">
          Approved on {standing.approvedAt?.toISOString().replace("T", " ").slice(0, 19)} UTC. The delta is collected by
          your broker.
        </p>
      ) : !standing.approvalRequired ? (
        <p className="note">
          This endorsement is at or below {formatCentsAsUsd(CUSTOMER_APPROVAL_THRESHOLD_CENTS)}, counting anything else
          this policy is waiting on you for, and needs no approval.
        </p>
      ) : null}

      <h2>What you would pay, line by line</h2>
      <p className="note">
        {figures.daysRemaining} of {figures.termDays} days of the term remain from {figures.effectiveAt}. Every figure is
        the one stored on the request; none of it is recomputed for display.
      </p>
      <FormulaLinesTable lines={endorsementFormulaLines(figures)} />

      {standing.state === "awaiting_approval" ? (
        <form method="post" action={`/api/policies/${policyId}/endorsements/${requestEventId}/approve`} className="card">
          <input type="hidden" name="quoteHash" value={figures.quoteHash} />
          <label className="checkbox-label">
            <input type="checkbox" name="approved" value="yes" required />
            <span>
              I approve paying {formatCentsAsUsd(figures.deltaTotalCents)} for this change, as computed above. This
              approval is bound to these exact figures.
            </span>
          </label>
          <button type="submit">Approve</button>
        </form>
      ) : null}
    </main>
  );
}
