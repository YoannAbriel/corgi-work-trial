import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current-user";
import { brokerKybState, KYB_NOT_LIVE_LABEL } from "@/lib/broker/kyb";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { checkoutOperationOfPolicy, journalEntriesOfPolicy, policyDetail } from "@/lib/policy/read";

// One policy: what it costs, where it stands, and every journal entry it produced.
// The ledger table is the point of the page: the amounts shown at the top must be findable,
// line by line, in the entries below.
export default async function PolicyPage({
  params,
  searchParams,
}: {
  params: Promise<{ policyId: string }>;
  searchParams: Promise<{ error?: string; payment?: string }>;
}) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }

  const { policyId } = await params;
  const policy = await policyDetail(policyId);
  if (!policy) {
    notFound();
  }

  // Ownership, checked on the server for every visit: a broker sees their own policies, staff
  // can read any policy, nobody else gets in.
  const isOwningBroker = user.role === "broker" && user.brokerId === policy.brokerId;
  const isStaff = user.role === "staff_ops" || user.role === "staff_approver";
  if (!isOwningBroker && !isStaff) {
    redirect("/broker");
  }

  const [kyb, operation, entries, query] = await Promise.all([
    brokerKybState(policy.brokerId),
    checkoutOperationOfPolicy(policyId),
    journalEntriesOfPolicy(policyId),
    searchParams,
  ]);

  const canPay = isOwningBroker && policy.status !== "bound" && policy.status !== "cancelled";

  return (
    <main>
      <p className="note">
        <Link href="/broker">Back to the policy list</Link>
      </p>

      <h1>Policy {policy.policyNumber}</h1>
      <p className="lead">
        {policy.customerName} ({policy.customerEmail}) — {policy.stateCode} — term {policy.effectiveAt} to{" "}
        {policy.termEnd}
      </p>

      <p className={`badge ${policy.status === "bound" ? "badge-ok" : "badge-warn"}`}>Status: {policy.status}</p>
      <p className={`badge ${kyb.status === "approved" ? "badge-ok" : "badge-warn"}`}>KYB: {kyb.status}</p>
      {kyb.isProviderEvidence ? null : (
        <p className="note">{KYB_NOT_LIVE_LABEL}. The status above is a seeded placeholder, not provider evidence.</p>
      )}

      {query.error ? <p className="error">{query.error}</p> : null}
      {query.payment === "returned" ? (
        <p className="note">
          You came back from the Stripe hosted page. The policy is bound when Stripe&apos;s webhook confirms the
          payment, not when the browser returns: refresh in a moment if the status is still awaiting payment.
        </p>
      ) : null}
      {query.payment === "cancelled" ? <p className="note">The payment page was left without paying.</p> : null}

      <h2>Charge</h2>
      <table className="amounts">
        <tbody>
          <tr>
            <th>Annual premium</th>
            <td className="amount">{formatCentsAsUsd(policy.annualPremiumCents)}</td>
          </tr>
          <tr>
            <th>
              {policy.stateCode} premium tax ({(policy.taxRateBps / 100).toFixed(2)}%)
            </th>
            <td className="amount">{formatCentsAsUsd(policy.taxCents)}</td>
          </tr>
          <tr>
            <th>Policy fee (flat, assumption of this build)</th>
            <td className="amount">{formatCentsAsUsd(policy.feeCents)}</td>
          </tr>
          <tr className="total">
            <th>Total charged to the customer</th>
            <td className="amount">{formatCentsAsUsd(policy.totalChargeCents)}</td>
          </tr>
        </tbody>
      </table>

      <h2>Coverage</h2>
      <table className="amounts">
        <tbody>
          <tr>
            <th>Per-occurrence limit</th>
            <td className="amount">{formatCentsAsUsd(policy.perOccurrenceLimitCents)}</td>
          </tr>
          <tr>
            <th>Aggregate limit</th>
            <td className="amount">{formatCentsAsUsd(policy.aggregateLimitCents)}</td>
          </tr>
          <tr>
            <th>Broker commission rate</th>
            <td className="amount">{(policy.commissionRateBps / 100).toFixed(2)}%</td>
          </tr>
        </tbody>
      </table>

      <h2>Payment</h2>
      {operation ? (
        <p className="note">
          Money operation {operation.operationId} — last status: {operation.latestStatus ?? "none"}
          {operation.providerRef ? ` — Stripe session ${operation.providerRef}` : ""}
        </p>
      ) : (
        <p className="note">No payment started yet.</p>
      )}

      {canPay ? (
        <form method="post" action={`/api/policies/${policy.policyId}/checkout`} className="inline-form">
          <button type="submit">
            {operation ? "Continue the payment at Stripe" : "Pay with Stripe (test mode)"}
          </button>
        </form>
      ) : null}

      <h2>Journal entries</h2>
      {entries.length === 0 ? (
        <p className="note">
          Nothing has been posted yet. The four issuance entries are written when Stripe confirms the payment.
        </p>
      ) : (
        <table className="ledger">
          <thead>
            <tr>
              <th>Entry</th>
              <th>Effective</th>
              <th>Recorded (UTC)</th>
              <th>Account</th>
              <th className="amount">Debit</th>
              <th className="amount">Credit</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) =>
              entry.lines.map((line, lineIndex) => (
                <tr key={`${entry.entryId}-${line.accountId}-${lineIndex}`}>
                  {lineIndex === 0 ? (
                    <>
                      <td rowSpan={entry.lines.length}>{entry.entryType}</td>
                      <td rowSpan={entry.lines.length}>{entry.effectiveAt}</td>
                      <td rowSpan={entry.lines.length}>{entry.recordedAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                    </>
                  ) : null}
                  <td>{line.accountName}</td>
                  <td className="amount">{line.debitCents > 0 ? formatCentsAsUsd(line.debitCents) : ""}</td>
                  <td className="amount">{line.creditCents > 0 ? formatCentsAsUsd(line.creditCents) : ""}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      )}
    </main>
  );
}
