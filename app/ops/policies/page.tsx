import Link from "next/link";
import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { currentUser } from "@/lib/auth/current-user";
import { brokersWithKybState } from "@/lib/broker/kyb";
import { policiesOfBroker } from "@/lib/policy/read";
import { formatCentsAsUsd } from "@/lib/money/cents";

// Staff already have access to policy detail. This read-only index makes those
// policies discoverable using the existing broker-scoped read helpers.
export default async function StaffPoliciesPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "staff_ops" && user.role !== "staff_approver") redirect("/broker");

  let policies;
  try {
    const brokers = await brokersWithKybState();
    const groups = await Promise.all(brokers.map(async (broker) => {
      const rows = await policiesOfBroker(broker.brokerId);
      return rows.map((policy) => ({ ...policy, brokerName: broker.brokerName }));
    }));
    policies = groups.flat();
  } catch {
    return (
      <PortalShell user={user} active="policies">
        <h1>Your <em>policies.</em></h1>
        <p className="error" role="alert">Policies could not be loaded. Refresh the list to try again.</p>
        <Link className="button-link" href="/ops/policies" prefetch={false}>Reload policies</Link>
      </PortalShell>
    );
  }

  return (
    <PortalShell user={user} active="policies">
      <h1>Your <em>policies.</em></h1>
      <p className="lead">Review coverage, policy status and the broker responsible for each account.</p>
      {policies.length === 0 ? (
        <section className="empty-state">
          <h2>No policies yet.</h2>
          <p>Policies will appear here when a broker creates the first draft.</p>
          <Link href="/ops/brokers" className="button-link secondary">View brokers</Link>
        </section>
      ) : (
        <div className="table-scroll" role="region" aria-label="Policies" tabIndex={0}>
          <table>
            <thead><tr><th>Policy</th><th>Customer</th><th>Broker</th><th>State</th><th>Effective</th><th>Status</th><th className="amount">Total charge</th></tr></thead>
            <tbody>{policies.map((policy) => (
              <tr key={policy.policyId}>
                <td><Link href={`/policies/${policy.policyId}`}>{policy.policyNumber}</Link></td>
                <td>{policy.customerName}</td><td>{policy.brokerName}</td><td>{policy.stateCode}</td>
                <td>{policy.effectiveAt}</td><td>{policy.status}</td>
                <td className="amount">{formatCentsAsUsd(policy.totalChargeCents)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </PortalShell>
  );
}
