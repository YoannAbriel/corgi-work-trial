import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current-user";
import { brokerKybState, KYB_NOT_LIVE_LABEL } from "@/lib/broker/kyb";
import { formatCentsAsUsd } from "@/lib/money/cents";
import {
  cancellationOfPolicy,
  checkoutOperationOfPolicy,
  journalEntriesOfPolicy,
  policyDetail,
  refundOperationsOfPolicy,
} from "@/lib/policy/read";

// One policy: what it costs, where it stands, and every journal entry it produced.
// The ledger table is the point of the page: the amounts shown at the top must be findable,
// line by line, in the entries below.
export default async function PolicyPage({
  params,
  searchParams,
}: {
  params: Promise<{ policyId: string }>;
  searchParams: Promise<{ error?: string; payment?: string; cancelled?: string; reissued?: string }>;
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

  const [kyb, operation, entries, cancellation, refunds, query] = await Promise.all([
    brokerKybState(policy.brokerId),
    checkoutOperationOfPolicy(policyId),
    journalEntriesOfPolicy(policyId),
    cancellationOfPolicy(policyId),
    refundOperationsOfPolicy(policyId),
    searchParams,
  ]);

  const canPay = isOwningBroker && policy.status !== "bound" && policy.status !== "cancelled";
  // Cancelling is the owning broker's or staff operations' decision. The same check runs again
  // on the server when the preview is computed and when the cancellation is confirmed, so
  // hiding the form is a convenience, never the control.
  const canCancel = (isOwningBroker || user.role === "staff_ops") && policy.status === "bound";
  const today = new Date().toISOString().slice(0, 10);

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
      {query.cancelled ? (
        <p className="note">
          The policy is cancelled and {query.cancelled} refund request(s) were sent to Stripe. A refund counts as
          completed only when Stripe&apos;s webhook confirms the money left; refresh in a moment.
        </p>
      ) : null}
      {query.reissued ? <p className="note">A new refund was re-issued: Stripe answered {query.reissued}.</p> : null}

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

      {canCancel ? (
        <>
          <h2>Cancel this policy</h2>
          <p className="note">
            Pick the day cover stops. The next screen shows exactly what would be refunded and clawed back before
            anything is written. A past date is allowed: an insurer often learns late that cover stopped, and the money
            is always computed from the day cover really stopped.
          </p>
          <form method="get" action={`/policies/${policy.policyId}/cancel`} className="card">
            <label htmlFor="effectiveAt">Cancellation effective date</label>
            <input
              id="effectiveAt"
              name="effectiveAt"
              type="date"
              required
              defaultValue={today > policy.effectiveAt ? today : policy.effectiveAt}
              min={policy.effectiveAt}
              max={policy.termEnd}
            />
            <label htmlFor="calculationMethod">Calculation method</label>
            {/* Short-rate cancellation is representable, not computed: the method is stored on
                the event and the short_rate_penalty_income account exists, but this build only
                calculates pro-rata and the server refuses any other value. */}
            <select id="calculationMethod" name="calculationMethod" defaultValue="pro_rata">
              <option value="pro_rata">Pro-rata (the only method this build computes)</option>
            </select>
            <button type="submit">Preview the cancellation</button>
          </form>
        </>
      ) : null}

      {cancellation ? (
        <>
          <h2>Cancellation, explained</h2>
          <p className="note">
            Effective {cancellation.effectiveAt}, recorded {cancellation.recordedAt.toISOString().slice(0, 19)} UTC,
            method {cancellation.calculationMethod}. Every figure below is the one stored on the cancellation event and
            posted to the journal; none of it is recomputed for display.
          </p>
          <table className="amounts">
            <tbody>
              <tr>
                <th>Written premium</th>
                <td className="amount">{formatCentsAsUsd(cancellation.writtenPremiumCents)}</td>
              </tr>
              <tr>
                <th>
                  Earned over {cancellation.earnedDays} of {cancellation.termDays} days, kept by the insurer
                </th>
                <td className="amount">{formatCentsAsUsd(cancellation.earnedPremiumCents)}</td>
              </tr>
              <tr>
                <th>Unearned premium, refunded</th>
                <td className="amount">{formatCentsAsUsd(cancellation.unearnedPremiumCents)}</td>
              </tr>
              <tr>
                <th>
                  {policy.stateCode} premium tax on the refunded premium ({(cancellation.taxRateBps / 100).toFixed(2)}%)
                </th>
                <td className="amount">{formatCentsAsUsd(cancellation.refundedTaxCents)}</td>
              </tr>
              <tr>
                <th>Policy fee, earned at issuance, never refunded</th>
                <td className="amount">{formatCentsAsUsd(cancellation.refundedFeeCents)}</td>
              </tr>
              <tr className="total">
                <th>Total refunded</th>
                <td className="amount">{formatCentsAsUsd(cancellation.totalRefundCents)}</td>
              </tr>
              <tr>
                <th>
                  Commission clawed back from the broker ({(cancellation.commissionRateBps / 100).toFixed(2)}% of the
                  refunded premium, rounded down)
                </th>
                <td className="amount">{formatCentsAsUsd(cancellation.commissionClawbackCents)}</td>
              </tr>
            </tbody>
          </table>
          {cancellation.taxRefundWasCappedAtCharged ? (
            <p className="note">
              The tax refund was capped at the premium tax actually charged on this policy: rounding it up would have
              given back a cent that was never collected.
            </p>
          ) : null}
        </>
      ) : null}

      {refunds.length > 0 ? (
        <>
          <h2>Refunds</h2>
          <table>
            <thead>
              <tr>
                <th>State</th>
                <th className="amount">Amount</th>
                <th>Stripe</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {refunds.map((refund) => (
                <tr key={refund.operationId}>
                  <td>
                    {/* Requested and completed are never mixed up: money asked for is not money
                        the customer has received. */}
                    {refund.state === "completed"
                      ? `completed ${formatCentsAsUsd(refund.amountCents)}${refund.completedOn ? ` on ${refund.completedOn}` : ""}`
                      : refund.state === "failed"
                        ? "requested, not completed"
                        : `requested ${formatCentsAsUsd(refund.amountCents)}`}
                  </td>
                  <td className="amount">{formatCentsAsUsd(refund.amountCents)}</td>
                  <td>
                    {refund.refundId ?? "not created yet"}
                    <br />
                    <span className="note">on {refund.paymentIntentId}</span>
                  </td>
                  <td>
                    {refund.failureReason ? (
                      <>
                        {refund.failureReason}
                        <br />
                        <span className="note">
                          The customer is still owed this money: nothing was reversed in the ledger, and the refund
                          stays open until a new one completes.
                        </span>
                        {user.role === "staff_ops" ? (
                          <form
                            method="post"
                            action={`/api/policies/${policy.policyId}/refunds/${refund.operationId}/reissue`}
                            className="inline-form"
                          >
                            <button type="submit">Re-issue this refund</button>
                          </form>
                        ) : null}
                      </>
                    ) : (
                      <span className="note">
                        {formatCentsAsUsd(refund.refundedPremiumCents)} premium +{" "}
                        {formatCentsAsUsd(refund.refundedTaxCents)} tax, clawback{" "}
                        {formatCentsAsUsd(refund.commissionClawbackCents)}
                      </span>
                    )}
                    {refund.failedAfterCompletion ? (
                      <p className="error">
                        Stripe reported a failure after this refund had completed. Nothing was reversed
                        automatically: an operator has to decide whether the cash came back and post a reversal.
                      </p>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
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
