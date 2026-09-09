import { PortalShell } from "@/components/portal-shell";
import { Chip, DetailHeading, Empty, Panel } from "@/components/detail-layout";
import { WhatNeedsYou, workspaceTasks } from "@/components/what-needs-you";
import { IllustrationBanner } from "@/components/decorative-illustration";
import Link from "next/link";
import { redirect } from "next/navigation";
import { brokerKybState, KYB_NOT_LIVE_LABEL } from "@/lib/broker/kyb";
import { currentUser } from "@/lib/auth/current-user";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { policiesOfBroker } from "@/lib/policy/read";

// The broker's own policies. A broker only ever sees the policies of the broker their user
// account is attached to: the list is queried by broker_id, never by an id from the URL.
export default async function BrokerPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "broker" || !user.brokerId) {
    const isStaff = user.role === "staff_ops" || user.role === "staff_approver";
    return (
      <PortalShell active="policies" user={user}>
        <DetailHeading title="Your policies" />
        <p className="error" role="alert">
          This page is the broker journey. Your account has the role &quot;{user.role}&quot;.
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

  const [policies, kyb, tasks, query] = await Promise.all([
    policiesOfBroker(user.brokerId),
    brokerKybState(user.brokerId),
    // What is waiting on this broker's policies, read once for the sidebar count and the block.
    workspaceTasks(user),
    searchParams,
  ]);

  return (
    <PortalShell active="policies" user={user} tasks={tasks}>
      <DetailHeading
        title="Your policies"
        lead={`${user.displayName} · ${user.email}`}
        chips={<Chip tone={kyb.status === "approved" ? "ok" : "warn"}>business verification {kyb.status}</Chip>}
        actions={
          <>
            <Link className="button-link orange" href="/broker/policies/new">
              New policy
            </Link>
            <Link className="button-link secondary" href="/broker/kyb">
              Business verification
            </Link>
            <Link className="button-link secondary" href="/broker/statements">
              Statements
            </Link>
          </>
        }
      />

      {/* A refused action elsewhere sends the broker back here with its sentence (F-B13-08). */}
      {query.error ? (
        <div className="notices">
          <p className="error" role="alert">{query.error}</p>
        </div>
      ) : null}
      {kyb.status === "approved" ? null : (
        <div className="notices">
          <p className="note">{kyb.explanation}</p>
          {kyb.isProviderEvidence || !kyb.providerAccountId ? null : (
            <p className="note">{KYB_NOT_LIVE_LABEL}. The status above is a seeded placeholder, not provider evidence.</p>
          )}
        </div>
      )}

      <WhatNeedsYou tasks={tasks} showEmptyIllustration={policies.length > 0} />

      <Panel title="Policies" className="list-panel">
        {policies.length === 0 ? (
          <Empty illustration="closed-folder">No policy yet. Start with &quot;New policy&quot;.</Empty>
        ) : (
          <div className="table-scroll" role="region" aria-label="Policies" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Policy</th>
                  <th>Customer</th>
                  <th>State</th>
                  <th>Effective</th>
                  <th>Status</th>
                  <th className="amount">Total charge</th>
                  <th></th>
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
                    <td>
                      <Chip tone={policy.status === "bound" ? "ok" : policy.status === "cancelled" || policy.status === "voided" ? "neutral" : "warn"}>
                        {policy.status.replace(/_/g, " ")}
                      </Chip>
                    </td>
                    <td className="amount">{formatCentsAsUsd(policy.totalChargeCents)}</td>
                    <td>
                      <Link href={`/policies/${policy.policyId}`} className="button-link secondary small">
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <IllustrationBanner
        name="garden-gate"
        title={<>Built for <em>growing businesses.</em></>}
      >
        Coverage, records and the next customer decision stay together.
      </IllustrationBanner>
    </PortalShell>
  );
}
