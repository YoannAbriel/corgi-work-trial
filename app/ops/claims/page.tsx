import { PortalShell } from "@/components/portal-shell";
import { Disclosure } from "@/components/disclosures";
import { Chip, DetailHeading, Empty, Panel } from "@/components/detail-layout";
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
  const open = claims.filter((claim) => !claim.position.isClosed);
  const reserveCents = open.reduce((total, claim) => total + claim.position.reserveCents, 0);

  return (
    <PortalShell active="claims" user={user}>
      <DetailHeading
        title="Claims"
        lead={`${claims.length} ${claims.length === 1 ? "claim" : "claims"}, ${open.length} open, ${formatCentsAsUsd(reserveCents)} of reserve outstanding`}
      />

      <Panel title="All claims" className="list-panel">
        {claims.length === 0 ? (
          <Empty illustration="search-corgi">No claim yet. A claim is opened from a policy page, by staff operations, on a policy that was bound.</Empty>
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
                  <th></th>
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
                    <td>
                      <Chip tone={claim.position.isClosed ? "neutral" : "warn"}>{claim.position.isClosed ? "closed" : "open"}</Chip>
                    </td>
                    <td className="amount">{formatCentsAsUsd(claim.position.reserveCents)}</td>
                    <td className="amount">{formatCentsAsUsd(claim.position.paidCents)}</td>
                    <td className="amount">{formatCentsAsUsd(claim.position.incurredCents)}</td>
                    <td>
                      <Link href={`/ops/claims/${claim.claimId}`} className="button-link secondary small">Open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Disclosure>
          <p>
            <strong>Incurred</strong> is what a claim has cost so far: paid plus the reserve still outstanding.{" "}
            <strong>Paid</strong> counts a payment from the moment it is sent on the rail, and a return puts it back.
            Both figures are folded from the claim&apos;s own events every time this page is rendered, never stored.
          </p>
          <p>
            Open a claim to set its reserve, record the claimant&apos;s bank account and ask for a payment. A payment
            above the threshold waits in the <Link href="/ops/approvals">money-out approvals</Link> queue until a second
            person decides.
          </p>
        </Disclosure>
      </Panel>
    </PortalShell>
  );
}
