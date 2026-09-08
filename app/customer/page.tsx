import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { liveEndorsementRequest } from "@/lib/policy/endorsement-requests";
import { centsFromDatabase } from "@/lib/money/cents";

// The customer's own policies: what is in force, the documents, and any endorsement waiting for
// their approval. A customer only ever sees the policies of the customer their user account is
// attached to: the list is queried by customer_id from the session, never by an id in the URL.
export default async function CustomerPage({ searchParams }: { searchParams: Promise<{ error?: string; approved?: string }> }) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "customer" || !user.customerId) {
    redirect("/broker");
  }
  const query = await searchParams;
  const today = new Date().toISOString().slice(0, 10);

  const policies = await sql<
    { policy_id: string; policy_number: string; broker_name: string; status: string; effective_at: string; term_end: string; annual_premium_cents: string }[]
  >`
    select policy.id as policy_id, policy.policy_number, broker.name as broker_name, current_policy.status,
           to_char(current_policy.effective_at, 'YYYY-MM-DD') as effective_at,
           to_char(current_policy.term_end, 'YYYY-MM-DD') as term_end,
           current_policy.annual_premium_cents
      from policies policy
      join brokers broker on broker.id = policy.broker_id
      join policy_current current_policy on current_policy.policy_id = policy.id
     where policy.customer_id = ${user.customerId}
     order by policy.created_at desc
  `;

  const rows = [];
  for (const policy of policies) {
    const live = await liveEndorsementRequest(sql, policy.policy_id);
    rows.push({ ...policy, live });
  }

  return (
    <main>
      <h1>Your policies</h1>
      <p className="lead">
        Signed in as {user.displayName} ({user.email}).
      </p>
      {query.error ? <p className="error">{query.error}</p> : null}
      {query.approved === "1" ? <p className="note">Thank you, the endorsement is approved. Your broker collects the delta.</p> : null}
      {query.approved === "already" ? <p className="note">This endorsement was already approved.</p> : null}

      {rows.length === 0 ? (
        <p className="note">No policy is attached to your account yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Policy</th>
              <th>Broker</th>
              <th>Term</th>
              <th>Status</th>
              <th className="amount">Annual premium in force</th>
              <th>Endorsement</th>
              <th>Documents</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((policy) => (
              <tr key={policy.policy_id}>
                <td>{policy.policy_number}</td>
                <td>{policy.broker_name}</td>
                <td>
                  {policy.effective_at} to {policy.term_end}
                </td>
                <td>{policy.status}</td>
                <td className="amount">{formatCentsAsUsd(centsFromDatabase(policy.annual_premium_cents, "annual_premium_cents"))}</td>
                <td>
                  {policy.live?.standing.state === "awaiting_approval" ? (
                    <Link href={`/policies/${policy.policy_id}/endorsements/${policy.live.request.eventId}/approve`}>
                      Approval needed: {formatCentsAsUsd(policy.live.request.figures.deltaTotalCents)}
                    </Link>
                  ) : policy.live ? (
                    <span className="note">{policy.live.request.description} (approved, awaiting payment by the broker)</span>
                  ) : (
                    <span className="note">none pending</span>
                  )}
                </td>
                <td>
                  <a href={`/api/policies/${policy.policy_id}/documents/declarations?asOf=${today}`}>Declarations</a>
                  {" / "}
                  <a href={`/api/policies/${policy.policy_id}/documents/endorsement-schedule?asOf=${today}`}>Schedule</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form method="post" action="/api/session/logout" className="inline-form">
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
