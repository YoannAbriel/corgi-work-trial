import { PortalShell } from "@/components/portal-shell";
import { Chip, DetailHeading, Empty, Panel } from "@/components/detail-layout";
import { WhatNeedsYou, workspaceTasks } from "@/components/what-needs-you";
import { IllustrationBanner } from "@/components/decorative-illustration";
import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { correctionsOfPolicy } from "@/lib/policy/correction-read";
import { liveEndorsementRequest } from "@/lib/policy/endorsement-requests";
import { centsFromDatabase } from "@/lib/money/cents";

// The customer's own policies: what is in force, the documents, and any endorsement waiting for
// their approval. A customer only ever sees the policies of the customer their user account is
// attached to: the list is queried by customer_id from the session, never by an id in the URL.
export default async function CustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; approved?: string; correctionApproved?: string }>;
}) {
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
    // Slice B8: a correction that moved an endorsement to an earlier date charges more days of
    // cover. Above $500 the customer decides, exactly as for an endorsement above $500.
    const correctionsToApprove = (await correctionsOfPolicy(policy.policy_id)).filter(
      (correction) =>
        correction.collection !== null &&
        correction.collection.customerApprovalRequired &&
        correction.collection.customerApprovedAt === null &&
        correction.collection.paidOn === null,
    );
    rows.push({ ...policy, live, correctionsToApprove });
  }

  // What is waiting for this customer, read once for the sidebar count and for the block below.
  const tasks = await workspaceTasks(user);

  const notices = [
    query.error ? <p key="error" className="error" role="alert">{query.error}</p> : null,
    query.approved === "1" ? <p key="approved" className="note">Thank you, the endorsement is approved. Your broker collects the delta.</p> : null,
    query.approved === "already" ? <p key="already" className="note">This endorsement was already approved.</p> : null,
    query.correctionApproved === "1" ? (
      <p key="capproved" className="note">Thank you, the correction is approved. Your broker collects the difference.</p>
    ) : null,
    query.correctionApproved === "already" ? <p key="calready" className="note">This correction was already approved.</p> : null,
  ].filter(Boolean);

  return (
    <PortalShell user={user} active="policies" tasks={tasks}>
      <DetailHeading title="Your policies" lead={`${user.displayName} · ${user.email}`} />

      {notices.length > 0 ? <div className="notices">{notices}</div> : null}

      <WhatNeedsYou tasks={tasks} />

      <Panel title="Policies" className="list-panel">
        {rows.length === 0 ? (
          <Empty illustration="coverage-corgi">No policy is attached to your account yet.</Empty>
        ) : (
          <div className="table-scroll" role="region" aria-label="Your policies" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Policy</th>
                  <th>Broker</th>
                  <th>Term</th>
                  <th>Status</th>
                  <th className="amount">Annual premium in force</th>
                  <th>Waiting for you</th>
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
                    <td>
                      <Chip tone={policy.status === "bound" ? "ok" : policy.status === "cancelled" || policy.status === "voided" ? "neutral" : "warn"}>
                        {policy.status.replace(/_/g, " ")}
                      </Chip>
                    </td>
                    <td className="amount">{formatCentsAsUsd(centsFromDatabase(policy.annual_premium_cents, "annual_premium_cents"))}</td>
                    <td>
                      {policy.live?.standing.state === "awaiting_approval" ? (
                        <Link
                          href={`/policies/${policy.policy_id}/endorsements/${policy.live.request.eventId}/approve`}
                          className="button-link orange small"
                        >
                          Approve the endorsement, {formatCentsAsUsd(policy.live.request.figures.deltaTotalCents)}
                        </Link>
                      ) : policy.live ? (
                        <span className="note">{policy.live.request.description}: approved, awaiting payment by the broker</span>
                      ) : null}
                      {policy.correctionsToApprove.map((correction) => (
                        <Link
                          key={correction.rebookEventId}
                          href={`/policies/${policy.policy_id}/corrections/${correction.rebookEventId}/approve`}
                          className="button-link orange small"
                        >
                          Approve the correction, {formatCentsAsUsd(correction.collection!.amountCents)}
                        </Link>
                      ))}
                      {!policy.live && policy.correctionsToApprove.length === 0 ? <span className="note">nothing</span> : null}
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
          </div>
        )}
      </Panel>
      <IllustrationBanner
        name="orchard-morning"
        title={<>Your coverage. <em>Close at hand.</em></>}
      >
        The policy, its documents and every decision live in one clear place.
      </IllustrationBanner>
    </PortalShell>
  );
}
