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
    return (
      <main>
        <h1>Broker workspace</h1>
        <p className="error">
          This build implements the broker journey. Your account has the role &quot;{user.role}&quot;; the staff
          and customer screens arrive in later slices.
        </p>
        <LogoutButton />
      </main>
    );
  }

  const [policies, kyb] = await Promise.all([policiesOfBroker(user.brokerId), brokerKybState(user.brokerId)]);

  return (
    <main>
      <h1>Broker workspace</h1>
      <p className="lead">
        Signed in as {user.displayName} ({user.email}).
      </p>

      <p className={kyb.status === "approved" ? "badge badge-ok" : "badge badge-warn"}>KYB status: {kyb.status}</p>
      {kyb.isProviderEvidence ? null : (
        <p className="note">{KYB_NOT_LIVE_LABEL}. The status above is a seeded placeholder, not provider evidence.</p>
      )}

      <p>
        <Link href="/broker/policies/new">New policy</Link>
      </p>

      {policies.length === 0 ? (
        <p className="note">No policy yet. Start with &quot;New policy&quot;.</p>
      ) : (
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
                  <Link href={`/policies/${policy.policyId}`}>{policy.policyNumber}</Link>
                </td>
                <td>{policy.customerName}</td>
                <td>{policy.stateCode}</td>
                <td>{policy.effectiveAt}</td>
                <td>{policy.status}</td>
                <td className="amount">{formatCentsAsUsd(policy.totalChargeCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <LogoutButton />
    </main>
  );
}

function LogoutButton() {
  return (
    <form method="post" action="/api/session/logout" className="inline-form">
      <button type="submit">Sign out</button>
    </form>
  );
}
