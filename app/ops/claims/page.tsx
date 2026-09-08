import { PortalShell } from "@/components/portal-shell";
import { Disclosure } from "@/components/disclosures";
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
    <PortalShell active="claims" user={user}>
      <h1>Track your <em>claims.</em></h1>
      <p className="lead">
        Every claim in the system, with what it has cost so far. Signed in as {user.displayName} ({user.role}).
      </p>

      <Disclosure>
        <p>
          <strong>Incurred</strong> is what a claim has cost so far: paid plus the reserve still
          outstanding. <strong>Paid</strong> counts a payment from the moment it is sent on the
          rail, and a return puts it back. Both figures are folded from the claim&apos;s own events
          every time this page is rendered, never stored.
        </p>
        <p>
          Open a claim number to set its reserve, record the claimant&apos;s bank account and ask
          for a payment. A payment above the threshold waits in the{" "}
          <Link href="/ops/approvals">money-out approvals</Link> queue until a second person decides.
        </p>
      </Disclosure>

      {claims.length === 0 ? (
        <p className="note">
          No claim yet. A claim is opened from a policy page, by staff operations, on a policy
          that was bound.
        </p>
      ) : (
        <div className="table-scroll" role="region" aria-label="Claims" tabIndex={0}>
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
        </div>
      )}
    </PortalShell>
  );
}
