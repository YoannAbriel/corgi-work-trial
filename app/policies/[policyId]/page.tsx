import { PortalShell } from "@/components/portal-shell";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { bindingIsAllowed } from "@/lib/broker/eligibility";
import { brokerKybState, KYB_NOT_LIVE_LABEL } from "@/lib/broker/kyb";
import { claimsWithPositions } from "@/lib/claims/read";
import { formatCentsAsUsd } from "@/lib/money/cents";
import {
  cancellationOfPolicy,
  checkoutOperationOfPolicy,
  journalEntriesOfPolicy,
  policyDetail,
  refundOperationsOfPolicy,
  voidCorrectionOfPolicy,
} from "@/lib/policy/read";

// One policy: what it costs, where it stands, and every journal entry it produced.
// The ledger table is the point of the page: the amounts shown at the top must be findable,
// line by line, in the entries below.
export default async function PolicyPage({
  params,
  searchParams,
}: {
  params: Promise<{ policyId: string }>;
  searchParams: Promise<{
    error?: string;
    payment?: string;
    cancelled?: string;
    reissued?: string;
    refundSent?: string;
    bound?: string;
  }>;
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

  const [kyb, operation, entries, cancellation, refunds, voidCorrection, claims, query] = await Promise.all([
    brokerKybState(policy.brokerId),
    checkoutOperationOfPolicy(policyId),
    journalEntriesOfPolicy(policyId),
    cancellationOfPolicy(policyId),
    refundOperationsOfPolicy(policyId),
    voidCorrectionOfPolicy(policyId),
    // Slice B7: the claims of this policy, each with the reserve and the incurred amount folded
    // from its own events.
    claimsWithPositions(sql, policyId),
    searchParams,
  ]);

  // Two different questions, kept apart on purpose. The first is about this policy, the second
  // is about the broker behind it; the server asks both again when the button is pressed and
  // again when Stripe confirms the payment, so hiding or disabling a button is never the
  // control, only the explanation.
  // A policy whose money arrived but whose binding was refused (paid_not_bound) is not
  // payable either: its cash sits in the suspense account and staff apply it, so offering the
  // broker a second payment would collect the premium twice (review finding F-B3-07).
  const policyCanBePaid =
    isOwningBroker &&
    policy.status !== "bound" &&
    policy.status !== "cancelled" &&
    policy.status !== "voided" &&
    policy.status !== "paid_not_bound";
  const brokerMayBind = bindingIsAllowed(kyb.status);
  // Cancelling is the owning broker's or staff operations' decision. The same check runs again
  // on the server when the preview is computed and when the cancellation is confirmed, so
  // hiding the form is a convenience, never the control.
  const canCancel = (isOwningBroker || user.role === "staff_ops") && policy.status === "bound";
  const today = new Date().toISOString().slice(0, 10);
  // Slice B7: an open claim survives a cancellation untouched, which is the live-fire question,
  // so the explanation sits next to the cancellation amounts it explains.
  const openClaims = claims.filter((claim) => !claim.position.isClosed);
  const openClaimReserveCents = openClaims.reduce((total, claim) => total + claim.position.reserveCents, 0);

  return (
    <PortalShell active="policies" user={user}>
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
      <p className="note">{kyb.explanation}</p>
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
      {query.refundSent ? <p className="note">The refund was sent to Stripe: {query.refundSent}.</p> : null}
      {query.bound === "1" ? (
        <p className="note">The policy is now bound and the four issuance entries are in the journal below.</p>
      ) : null}
      {query.bound === "already" ? (
        <p className="note">This policy was already bound; nothing was posted a second time.</p>
      ) : null}

      <h2>Charge</h2>
      <div className="table-scroll" role="region" aria-label="Scrollable data table" tabIndex={0}>
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
        </div>

      <h2>Coverage</h2>
      <div className="table-scroll" role="region" aria-label="Scrollable data table" tabIndex={0}>
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
        </div>

      <h2>Payment</h2>
      {operation ? (
        <p className="note">
          Money operation {operation.operationId} — last status: {operation.latestStatus ?? "none"}
          {operation.providerRef ? ` — Stripe session ${operation.providerRef}` : ""}
        </p>
      ) : (
        <p className="note">No payment started yet.</p>
      )}

      {policy.status === "voided" && voidCorrection ? (
        <>
          {/* The issuance and its four entries are still in the database; the fold no longer
              applies them, and the reversal entries are visible in the journal below. */}
          <p className="error">
            Voided by a correction on {voidCorrection.recordedAt.toISOString().replace("T", " ").slice(0, 19)} UTC:{" "}
            {voidCorrection.reason}
          </p>
          <p className="note">
            Correction event {voidCorrection.correctionEventId}
            {voidCorrection.reversedEntryCount > 0 ? `, ${voidCorrection.reversedEntryCount} entries reversed` : ""}.
            Nothing was deleted: the original entries and their reversals are both in the journal below, and this
            policy can no longer be paid. A replacement needs a new draft.
          </p>
        </>
      ) : null}

      {operation?.bindingRefusedReason ? (
        <>
          <p className="error">
            Paid, binding refused: {operation.bindingRefusedReason}. The customer&apos;s money arrived at Stripe and is
            journaled in the suspense account unapplied_customer_cash (cash at Stripe up, liability to the customer
            up, entry unapplied_cash_received below), but the policy is NOT bound. Binding it applies that cash to
            premium, tax and fee; a broker who fails for good means the money goes back to the customer.
          </p>
          {user.role === "staff_ops" ? (
            <form method="post" action={`/api/policies/${policy.policyId}/bind`} className="inline-form">
              <button type="submit">Bind now that the broker is eligible</button>
            </form>
          ) : (
            <p className="note">Staff operations can bind this policy once the broker&apos;s verification passes.</p>
          )}
        </>
      ) : null}

      {policyCanBePaid && brokerMayBind ? (
        <form method="post" action={`/api/policies/${policy.policyId}/checkout`} className="inline-form">
          <button type="submit">
            {operation ? "Continue the payment at Stripe" : "Pay with Stripe (test mode)"}
          </button>
        </form>
      ) : null}
      {policyCanBePaid && !brokerMayBind ? (
        <>
          {/* Disabled with the reason next to it. The server refuses the same request anyway
              (lib/payments/checkout.ts and again at binding time), so this is the explanation,
              not the guard. */}
          <button type="button" disabled>
            Pay with Stripe (test mode)
          </button>
          <p className="note">
            Payment is blocked while the broker is not approved. {kyb.explanation}
            {isOwningBroker ? (
              <>
                {" "}
                <Link href="/broker/kyb">Submit or check the business verification</Link>.
              </>
            ) : null}
          </p>
        </>
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
          <div className="table-scroll" role="region" aria-label="Scrollable data table" tabIndex={0}>
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
        </div>
          {cancellation.taxRefundWasCappedAtCharged ? (
            <p className="note">
              The tax refund was capped at the premium tax actually charged on this policy: rounding it up would have
              given back a cent that was never collected.
            </p>
          ) : null}
          {/* Slice B7: the same explanation the cancellation preview gave, kept next to the
              amounts it explains. The figures are the claims as they stand now; the figures as
              they stood when the policy was cancelled are on the cancellation event itself. */}
          {openClaims.length > 0 ? (
            <p className="note">
              This policy has {openClaims.length} open claim, and the cancellation did not touch it: the open claim
              keeps its reserve of {formatCentsAsUsd(openClaimReserveCents)}, anything already paid on it stays paid,
              and the refund above covers unearned premium only, because the loss happened while the policy was in
              force. The commission clawback follows the refunded premium alone, for the same reason.
            </p>
          ) : null}
        </>
      ) : null}

      {refunds.length > 0 ? (
        <>
          <h2>Refunds</h2>
          <div className="table-scroll" role="region" aria-label="Scrollable data table" tabIndex={0}>
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
                        the customer has received. Above $1,000 a third state sits in front of
                        both: the refund is recorded and owed, and it is not going anywhere until
                        a second person approves it (slice B7, /ops/approvals). */}
                    {refund.state === "completed"
                      ? `completed ${formatCentsAsUsd(refund.amountCents)}${refund.completedOn ? ` on ${refund.completedOn}` : ""}`
                      : refund.state === "failed"
                        ? "requested, not completed"
                        : refund.approvalRequestId && refund.approvalDecision !== "approved"
                          ? refund.approvalDecision === "rejected"
                            ? "awaiting approval: rejected"
                            : "awaiting approval"
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
                    {/* Slice B7: one button for two situations. A refund above $1,000 that a
                        second person has approved, and a refund stuck in 'requested' because the
                        process died before Stripe was called (review finding F-B5-03). Both are
                        sent with the operation's own idempotency key, so Stripe can never create
                        a second refund for it. */}
                    {refund.state === "requested" &&
                    user.role === "staff_ops" &&
                    (!refund.approvalRequestId || refund.approvalDecision === "approved") ? (
                      <form
                        method="post"
                        action={`/api/policies/${policy.policyId}/refunds/${refund.operationId}/send`}
                        className="inline-form"
                      >
                        <button type="submit">
                          {refund.approvalRequestId ? "Send this approved refund to Stripe" : "Send to Stripe again"}
                        </button>
                      </form>
                    ) : null}
                    {refund.state === "requested" && refund.approvalRequestId && refund.approvalDecision !== "approved" ? (
                      <span className="note">
                        <br />
                        Above the approval threshold: it waits in{" "}
                        <Link href="/ops/approvals">the approvals queue</Link> until a second person decides.
                      </span>
                    ) : null}
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
        </div>
        </>
      ) : null}

      {/* --- Slice B7: claims on this policy --- */}
      <h2>Claims</h2>
      <p className="note">
        Incurred is what a claim has cost so far: paid plus the reserve still outstanding. A claim
        can be opened on a cancelled policy too, as long as the loss happened while the policy was
        in force. Cancelling never touches an open claim or its reserve.
      </p>
      {claims.length === 0 ? (
        <p className="note">No claim on this policy.</p>
      ) : (
        <div className="table-scroll" role="region" aria-label="Scrollable data table" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Claim</th>
              <th>Claimant</th>
              <th>Loss date</th>
              <th>State</th>
              <th className="amount">Reserve</th>
              <th className="amount">Paid</th>
              <th className="amount">Incurred</th>
            </tr>
          </thead>
          <tbody>
            {claims.map((claim) => (
              <tr key={claim.claimId}>
                <td>
                  {/* Only staff work on a claim, so only staff get the link to its screen. */}
                  {isStaff ? (
                    <Link href={`/ops/claims/${claim.claimId}`}>{claim.claimNumber}</Link>
                  ) : (
                    claim.claimNumber
                  )}
                </td>
                <td>{claim.claimantName}</td>
                <td>{claim.occurredAt}</td>
                <td>{claim.position.isClosed ? "closed" : "open"}</td>
                <td className="amount">{formatCentsAsUsd(claim.position.reserveCents)}</td>
                <td className="amount">{formatCentsAsUsd(claim.position.paidCents)}</td>
                <td className="amount">{formatCentsAsUsd(claim.position.incurredCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {/* A claim needs cover to have existed, so the form is offered on a bound policy and on a
          cancelled one (the loss can predate the cancellation). openClaim checks the same thing
          on the server from the policy's events, so a voided or unpaid policy is refused there
          whatever the page shows. */}
      {user.role === "staff_ops" && (policy.status === "bound" || policy.status === "cancelled") ? (
        <form method="post" action={`/api/policies/${policy.policyId}/claims`} className="card">
          <label htmlFor="claimantName">Claimant name</label>
          {/* The bank ownership check compares the account holder with this name, so it is the
              name on the claim that decides where money may go. */}
          <input id="claimantName" name="claimantName" defaultValue={policy.customerName} required />
          <label htmlFor="occurredAt">Date of loss</label>
          <input
            id="occurredAt"
            name="occurredAt"
            type="date"
            required
            min={policy.effectiveAt}
            max={policy.termEnd}
            defaultValue={today > policy.effectiveAt && today <= policy.termEnd ? today : policy.effectiveAt}
          />
          <label htmlFor="reportedAt">Date reported to us</label>
          <input id="reportedAt" name="reportedAt" type="date" required defaultValue={today} />
          <label htmlFor="description">What happened</label>
          <input id="description" name="description" placeholder="water damage in the workshop" required />
          <button type="submit">Open a claim</button>
        </form>
      ) : null}

      <h2>Journal entries</h2>
      {entries.length === 0 ? (
        <p className="note">
          Nothing has been posted yet. The four issuance entries are written when Stripe confirms the payment.
        </p>
      ) : (
        <div className="table-scroll" role="region" aria-label="Scrollable data table" tabIndex={0}>
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
        </div>
      )}
    </PortalShell>
  );
}
