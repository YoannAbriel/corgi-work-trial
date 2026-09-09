import { PortalShell } from "@/components/portal-shell";
import { Chip, DetailHeading, Empty, Panel } from "@/components/detail-layout";
import { Disclosure } from "@/components/disclosures";
import { WhatNeedsYou, workspaceTasks, type BlockingTask } from "@/components/what-needs-you";
import { IllustrationBanner } from "@/components/decorative-illustration";
import Link from "next/link";
import { redirect } from "next/navigation";
import { brokerKybState, KYB_NOT_LIVE_LABEL } from "@/lib/broker/kyb";
import { bindingIsAllowed } from "@/lib/broker/eligibility";
import { currentUser } from "@/lib/auth/current-user";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { policiesOfBroker, policyDetail } from "@/lib/policy/read";
import { policyAsItStoodOn } from "@/lib/policy/correction-read";
import { termsInForceOn } from "@/lib/policy/terms-in-force";

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

  const [storedPolicies, kyb, tasks, query] = await Promise.all([
    policiesOfBroker(user.brokerId),
    brokerKybState(user.brokerId),
    // What is waiting on this broker's policies, read once for the sidebar count and the block.
    workspaceTasks(user),
    searchParams,
  ]);

  // UI-004, review finding F-UA-01. The total in the column below is the one the policy's own
  // page prints under its terms, folded by the same helper for the same date
  // (lib/policy/terms-in-force.ts), exactly as /ops/policies and /customer already do. It used to
  // come straight from policy_current, which applies every event whatever its effective date: a
  // policy carrying a future-dated endorsement was listed here at next month's total while its
  // own page, the staff list and the customer's list all printed today's. The broker is the
  // person who sells the policy; showing them a different current charge from everyone else is
  // the contradiction UI-004 numbered.
  const today = new Date().toISOString().slice(0, 10);
  const policies = await Promise.all(
    storedPolicies.map(async (policy) => {
      // The date the policy page uses: today, or the term start when the term has not begun.
      const onDate = today > policy.effectiveAt ? today : policy.effectiveAt;
      const [detail, asOfResult] = await Promise.all([
        policyDetail(policy.policyId),
        policyAsItStoodOn(policy.policyId, onDate),
      ]);
      return { ...policy, terms: detail ? termsInForceOn(detail, asOfResult) : null };
    }),
  );

  // UI-031: a verification that does not allow binding is the first thing waiting on this broker.
  // The notice below already explains the status; the block used to say "nothing is waiting for
  // you right now" three lines under it. The rule is the one the server enforces before binding
  // (lib/broker/eligibility.ts): unknown and pending are not permission either.
  const verificationBlocking: BlockingTask | null = bindingIsAllowed(kyb.status)
    ? null
    : {
        label: `Business verification ${kyb.status}: you cannot bind a policy`,
        detail: kyb.explanation,
        href: "/broker/kyb",
      };

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

      <WhatNeedsYou tasks={tasks} blocking={verificationBlocking} showEmptyIllustration={policies.length > 0} />

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
                    <td className="amount">
                      {formatCentsAsUsd(policy.terms ? policy.terms.totalChargeCents : policy.totalChargeCents)}
                      {policy.terms && policy.terms.onDate === null ? (
                        // The fold has no answer on that date (the policy was not issued yet, or a
                        // correction reversed its issuance), so these are the policy record's own
                        // figures and the row says so rather than calling them cover.
                        <>
                          <br />
                          <span className="note">on the policy record</span>
                        </>
                      ) : null}
                    </td>
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
        {/* The same reading help the staff list carries, so the two say the same thing about the
            same column (F-UA-01). */}
        <Disclosure>
          <p>
            <strong>Total charge</strong> is the annual premium plus the state premium tax and the flat policy fee{" "}
            <strong>in force on the date the policy&apos;s own page shows</strong>: today, or the first day of the term
            when the term has not begun. An endorsement dated later is not in this figure, and the policy page names it
            under the terms. A row marked <em>on the policy record</em> could not be rebuilt on that date, so its figures
            are the ones written on the policy. What was actually collected and refunded is on the policy page, in its
            journal.
          </p>
        </Disclosure>
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
