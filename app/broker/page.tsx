import { PortalShell } from "@/components/portal-shell";
import Link from "next/link";
import { redirect } from "next/navigation";
import { brokerKybState, KYB_NOT_LIVE_LABEL } from "@/lib/broker/kyb";
import { currentUser } from "@/lib/auth/current-user";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { policiesOfBroker } from "@/lib/policy/read";

// The broker's own policies. A broker only ever sees the policies of the broker their user
// account is attached to: the list is queried by broker_id, never by an id from the URL.
export default async function BrokerPage() {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "broker" || !user.brokerId) {
    const isStaff = user.role === "staff_ops" || user.role === "staff_approver";
    return (
      <PortalShell active="policies" user={user}>
        <h1>
          Your <em>policies.</em>
        </h1>
        <p className="error" role="alert">
          This page is the broker journey. Your account has the role &quot;
          {user.role}&quot;.
        </p>
        {isStaff ? (
          <p>
            <Link href="/ops/brokers">Brokers and their verification</Link>
          </p>
        ) : (
          <p>
            <Link href="/customer">Your policies, documents and endorsement approvals</Link>
          </p>
        )}
      </PortalShell>
    );
  }

  const [policies, kyb] = await Promise.all([
    policiesOfBroker(user.brokerId),
    brokerKybState(user.brokerId),
  ]);

  return (
    <PortalShell active="policies" user={user}>
      <h1>
        Your <em>policies.</em>
      </h1>
      <p className="lead">
        Signed in as {user.displayName} ({user.email}).
      </p>

      <p
        className={
          kyb.status === "approved" ? "badge badge-ok" : "badge badge-warn"
        }
      >
        KYB status: {kyb.status}
      </p>
      <p className="note">{kyb.explanation}</p>
      {kyb.isProviderEvidence || !kyb.providerAccountId ? null : (
        <p className="note">
          {KYB_NOT_LIVE_LABEL}. The status above is a seeded placeholder, not
          provider evidence.
        </p>
      )}

      <div className="page-actions">
        <Link className="button-link" href="/broker/policies/new">
          New policy
        </Link>
        <Link className="button-link secondary" href="/broker/kyb">
          Business verification
        </Link>
        <Link className="button-link secondary" href="/broker/statements">Statements</Link>
      </div>

      {policies.length === 0 ? (
        <section className="empty-state">
          <img
            src="/illustrations/corgi-engraving.webp"
            width="1152"
            height="768"
            alt=""
          />
          <h2>
            Your next policy <em>starts here.</em>
          </h2>
          <p>No policy yet. Start with &quot;New policy&quot;.</p>
        </section>
      ) : (
        <div
          className="table-scroll"
          role="region"
          aria-label="Policies"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>Policy</th>
                <th>Customer</th>
                <th>State</th>
                <th>Effective</th>
                <th>Status</th>
                <th className="amount">Total charge</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((policy) => (
                <tr key={policy.policyId}>
                  <td>
                    <Link href={`/policies/${policy.policyId}`}>
                      {policy.policyNumber}
                    </Link>
                  </td>
                  <td>{policy.customerName}</td>
                  <td>{policy.stateCode}</td>
                  <td>{policy.effectiveAt}</td>
                  <td>{policy.status}</td>
                  <td className="amount">
                    {formatCentsAsUsd(policy.totalChargeCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PortalShell>
  );
}
