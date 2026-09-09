import Link from "next/link";
import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { Disclosure } from "@/components/disclosures";
import { Chip, DetailHeading, Empty, Panel } from "@/components/detail-layout";
import { currentUser } from "@/lib/auth/current-user";
import { brokersWithKybState } from "@/lib/broker/kyb";
import { policiesOfBroker, policyDetail } from "@/lib/policy/read";
import { policyAsItStoodOn } from "@/lib/policy/correction-read";
import { termsInForceOn } from "@/lib/policy/terms-in-force";
import { formatCentsAsUsd } from "@/lib/money/cents";

// Staff already have access to policy detail. This read-only index makes those
// policies discoverable using the existing broker-scoped read helpers.
export default async function StaffPoliciesPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "staff_ops" && user.role !== "staff_approver") redirect("/broker");

  const today = new Date().toISOString().slice(0, 10);

  let policies;
  try {
    const brokers = await brokersWithKybState();
    const groups = await Promise.all(brokers.map(async (broker) => {
      const rows = await policiesOfBroker(broker.brokerId);
      return rows.map((policy) => ({ ...policy, brokerName: broker.brokerName }));
    }));
    // UI-004: the total in this column is the one the policy's own page prints under its terms,
    // folded by the same helper for the same date (lib/policy/terms-in-force.ts). The column used
    // to come straight from policy_current, which applies every event whatever its effective
    // date: a policy carrying a future-dated endorsement was listed at next month's total under a
    // help text that said "as they stand today", and its own page said something else.
    // It costs two reads per policy, which is what folding a policy's events honestly costs; the
    // page already reads once per broker and the estate it lists is small.
    policies = await Promise.all(
      groups.flat().map(async (policy) => {
        // The date the policy page uses: today, or the term start when the term has not begun.
        const onDate = today > policy.effectiveAt ? today : policy.effectiveAt;
        const [detail, asOfResult] = await Promise.all([
          policyDetail(policy.policyId),
          policyAsItStoodOn(policy.policyId, onDate),
        ]);
        return { ...policy, terms: detail ? termsInForceOn(detail, asOfResult) : null };
      }),
    );
  } catch {
    return (
      <PortalShell user={user} active="policies">
        <DetailHeading title="Policies" />
        <p className="error" role="alert">Policies could not be loaded. Refresh the list to try again.</p>
        <Link className="button-link" href="/ops/policies" prefetch={false}>Reload policies</Link>
      </PortalShell>
    );
  }

  const needsAPerson = policies.filter((policy) => policy.status === "paid_not_bound").length;

  return (
    <PortalShell user={user} active="policies">
      <DetailHeading
        title="Policies"
        lead={`${policies.length} ${policies.length === 1 ? "policy" : "policies"} across every broker, newest broker first`}
        chips={needsAPerson > 0 ? <Chip tone="warn">{needsAPerson} paid, not bound</Chip> : undefined}
      />

      <Panel title="All policies" className="list-panel">
        {policies.length === 0 ? (
          <Empty illustration="closed-folder">No policy yet. Policies appear here when a broker creates the first draft.</Empty>
        ) : (
          <div className="table-scroll" role="region" aria-label="Policies" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Policy</th>
                  <th>Customer</th>
                  <th>Broker</th>
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
                    <td><Link href={`/policies/${policy.policyId}`}>{policy.policyNumber}</Link></td>
                    <td>{policy.customerName}</td>
                    <td>{policy.brokerName}</td>
                    <td>{policy.stateCode}</td>
                    <td>{policy.effectiveAt}</td>
                    <td>
                      {/* The status is the one derived from the policy's events; the colour only
                          separates "in force" from "somebody has to look at this". */}
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
                      <Link href={`/policies/${policy.policyId}`} className="button-link secondary small">Open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Disclosure>
          <p>
            <strong>Total charge</strong> is the annual premium plus the state premium tax and the flat policy fee{" "}
            <strong>in force on the date the policy&apos;s own page shows</strong>: today, or the first day of the term
            when the term has not begun. An endorsement dated later is not in this figure, and the policy page names it
            under the terms. A row marked <em>on the policy record</em> could not be rebuilt on that date, so its figures
            are the ones written on the policy. What was actually collected and refunded is on the policy page, in its
            journal.
          </p>
          <p>
            A policy marked <strong>paid not bound</strong> is the one that needs a person: the customer&apos;s money
            arrived while the broker was not eligible to bind, so it sits in the suspense account until staff
            operations bind the policy or send it back. Open the policy to do either.
          </p>
        </Disclosure>
      </Panel>
    </PortalShell>
  );
}
