import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current-user";
import { sql } from "@/db/client";
import { claimsWithPositions } from "@/lib/claims/read";
import { formatCentsAsUsd } from "@/lib/money/cents";

// Every claim in the system, for staff. A broker never reaches this page: their claims are on
// the policy page, scoped to the policies they own.
export default async function OpsClaimsPage() {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "staff_ops" && user.role !== "staff_approver") {
    redirect("/broker");
  }

  const claims = await claimsWithPositions(sql, null);

  return (
    <main>
      <h1>Claims</h1>
      <p className="lead">
        Signed in as {user.displayName} ({user.role}). Incurred is what a claim has cost so far:
        paid plus the reserve still outstanding.
      </p>
      <p className="note">
        <Link href="/ops/approvals">Money-out approvals</Link>
      </p>

      {claims.length === 0 ? (
        <p className="note">
          No claim yet. A claim is opened from a policy page, by staff operations, on a policy
          that was bound.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Claim</th>
              <th>Policy</th>
              <th>Claimant</th>
              <th>Loss date</th>
              <th>State</th>
              <th className="amount">Reserve</th>
              <th className="amount">Paid</th>
              <th className="amount">Incurred</th>
            </tr>
          </thead>
          <tbody>
            {claims.map((claim) => (
              <tr key={claim.claimId}>
                <td>
                  <Link href={`/ops/claims/${claim.claimId}`}>{claim.claimNumber}</Link>
                </td>
                <td>
                  <Link href={`/policies/${claim.policyId}`}>{claim.policyNumber}</Link>
                </td>
                <td>{claim.claimantName}</td>
                <td>{claim.occurredAt}</td>
                <td>{claim.position.isClosed ? "closed" : "open"}</td>
                <td className="amount">{formatCentsAsUsd(claim.position.reserveCents)}</td>
                <td className="amount">{formatCentsAsUsd(claim.position.paidCents)}</td>
                <td className="amount">{formatCentsAsUsd(claim.position.incurredCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
