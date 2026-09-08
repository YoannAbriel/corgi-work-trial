import { PortalShell } from "@/components/portal-shell";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MONEY_OUT_APPROVAL_THRESHOLD_CENTS } from "@/lib/approvals/threshold";
import { currentUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/http/path-ids";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { CancellationRefused, planCancellation } from "@/lib/policy/cancel";

// The preview, and the point of this slice: the broker sees exactly what the cancellation will
// do to the money BEFORE anything happens, computed by the same pure functions that will post
// the entries a moment later (lib/money/premium.ts, lib/money/refund-allocation.ts).
//
// It is honest in three ways:
//   - every amount is labelled "as of" the effective date it was computed for;
//   - nothing is written by this page: no event, no operation, no journal entry;
//   - the version of the policy is carried in a hidden field, so if an endorsement or a
//     correction lands between this screen and the confirmation, the confirmation is refused
//     instead of executing figures that are no longer true.
export default async function CancelPolicyPage({
  params,
  searchParams,
}: {
  params: Promise<{ policyId: string }>;
  searchParams: Promise<{ effectiveAt?: string }>;
}) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }

  const [{ policyId }, query] = await Promise.all([params, searchParams]);
  if (!isUuid(policyId)) notFound(); // a malformed id is an unknown policy, not a 500 (F-B7-07)
  const effectiveAt = (query.effectiveAt ?? "").trim();
  if (!effectiveAt) {
    redirect(`/policies/${policyId}?error=${encodeURIComponent("pick a cancellation date first")}`);
  }

  let plan;
  try {
    plan = await planCancellation({
      policyId,
      effectiveAt,
      calculationMethod: "pro_rata",
      actor: { userId: user.id, role: user.role, brokerId: user.brokerId },
    });
  } catch (error) {
    if (error instanceof CancellationRefused) {
      // A refusal is part of the preview: the broker sees why, on the page, and can change the
      // date. Nothing was written, so there is nothing to undo.
      return (
        <PortalShell active="policies" user={user} trail={[
          ...(user.role === "broker" ? [] : [{ label: "Policies", href: "/ops/policies" }]),
          { label: "Policy", href: `/policies/${policyId}` },
          { label: "Cancellation preview" },
        ]}>
              <h1>Cancellation preview</h1>
          <p className="error" role="alert">{error.message}</p>
        </PortalShell>
      );
    }
    throw error;
  }

  const { breakdown, terms } = plan;

  return (
    <PortalShell active="policies" user={user} trail={[
          ...(user.role === "broker" ? [] : [{ label: "Policies", href: "/ops/policies" }]),
      { label: `Policy ${plan.policyNumber}`, href: `/policies/${policyId}` },
      { label: "Cancellation preview" },
    ]}>

      <h1>Cancel policy {plan.policyNumber}</h1>
      <p className="lead">
        Nothing has happened yet. These are the amounts as of <strong>{plan.effectiveAt}</strong>, the day cover would
        stop. Pro-rata calculation on the actual days of the term.
      </p>

      <h2>What the customer gets back</h2>
      <div className="table-scroll" role="region" aria-label="Customer refund" tabIndex={0}>
        <table className="amounts">
        <tbody>
          <tr>
            <th>
              Premium written on this policy
              {breakdown.writtenPremiumCents !== terms.annualPremiumCents
                ? `, the ${formatCentsAsUsd(plan.writtenPremiumSegments[0].writtenPremiumCents)} of the issuance plus every endorsement delta`
                : ""}
            </th>
            <td className="amount">{formatCentsAsUsd(breakdown.writtenPremiumCents)}</td>
          </tr>
          <tr>
            <th>
              Premium earned, {breakdown.earnedDays} of {breakdown.termDays} days covered
            </th>
            <td className="amount">{formatCentsAsUsd(breakdown.earnedPremiumCents)}</td>
          </tr>
          <tr>
            <th>Unearned premium, refunded</th>
            <td className="amount">{formatCentsAsUsd(breakdown.unearnedPremiumCents)}</td>
          </tr>
          <tr>
            <th>
              {terms.stateCode} premium tax on the refunded premium ({(terms.taxRateBps / 100).toFixed(2)}%)
            </th>
            <td className="amount">{formatCentsAsUsd(breakdown.refundedTaxCents)}</td>
          </tr>
          <tr>
            <th>Policy fee, fully earned at issuance and never refunded</th>
            <td className="amount">{formatCentsAsUsd(breakdown.refundedFeeCents)}</td>
          </tr>
          <tr className="total">
            <th>Total refunded to the customer</th>
            <td className="amount">{formatCentsAsUsd(breakdown.totalRefundCents)}</td>
          </tr>
        </tbody>
      </table>
        </div>
      {breakdown.taxRefundWasCappedAtCharged ? (
        <p className="note">
          The tax refund is capped at the {formatCentsAsUsd(plan.taxChargedCents)} of premium tax this policy still
          holds: rounding up the refund would otherwise give back a cent that was never collected.
        </p>
      ) : null}

      {/* Slice B7: an open claim is the live-fire question, so the answer is on the screen the
          operator is looking at when they take the decision, with the claim's own figures. */}
      {plan.openClaims.explanation ? (
        <>
          <h2>This policy has an open claim</h2>
          <p className="note">{plan.openClaims.explanation}</p>
          <div className="table-scroll" role="region" aria-label="Open claim position" tabIndex={0}>
        <table className="amounts">
            <tbody>
              <tr>
                <th>Reserve still held on the open claim, untouched by this cancellation</th>
                <td className="amount">{formatCentsAsUsd(plan.openClaims.reserveCents)}</td>
              </tr>
              <tr>
                <th>Already paid on it, untouched too</th>
                <td className="amount">{formatCentsAsUsd(plan.openClaims.paidCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        </>
      ) : null}

      <h2>What the broker gives back</h2>
      <div className="table-scroll" role="region" aria-label="Commission clawback" tabIndex={0}>
        <table className="amounts">
        <tbody>
          <tr>
            <th>
              Commission clawback, {(plan.commissionRateBps / 100).toFixed(2)}% of the refunded premium, rounded down
            </th>
            <td className="amount">{formatCentsAsUsd(breakdown.commissionClawbackCents)}</td>
          </tr>
        </tbody>
      </table>
        </div>

      <h2>How the money goes back</h2>
      {plan.slices.length === 0 ? (
        <p className="note">Nothing is owed back on this date, so no refund will be sent to Stripe.</p>
      ) : (
        <div className="table-scroll" role="region" aria-label="Refund allocation" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Stripe payment refunded</th>
              <th className="amount">Premium</th>
              <th className="amount">Tax</th>
              <th className="amount">Refund</th>
            </tr>
          </thead>
          <tbody>
            {plan.slices.map((slice) => (
              <tr key={slice.paymentIntentId}>
                <td>{slice.paymentIntentId}</td>
                <td className="amount">{formatCentsAsUsd(slice.refundedPremiumCents)}</td>
                <td className="amount">{formatCentsAsUsd(slice.refundedTaxCents)}</td>
                <td className="amount">{formatCentsAsUsd(slice.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      <h2>Confirm</h2>
      <p className="note">
        {breakdown.totalRefundCents === 0
          ? "Confirming records the cancellation and its journal entries. No refund is due on this date."
          : plan.refundNeedsApproval
            ? "Confirming records the cancellation, its journal entries and the refund request. The refund waits for approval before it is sent."
            : "Confirming records the cancellation, its journal entries and the refund request, then asks Stripe for the money. The refund is complete only after the provider confirms it."}
      </p>
      {/* Slice B7: maker-checker. Above the threshold the cancellation still happens, and so do
          its journal entries; what waits is the money leaving. */}
      {plan.refundNeedsApproval ? (
        <p className="note">
          <strong>
            This refund is above {formatCentsAsUsd(MONEY_OUT_APPROVAL_THRESHOLD_CENTS)}, so it requires approval.
          </strong>{" "}
          Confirming cancels the policy and records what the customer is owed, but nothing is sent to Stripe until a
          staff approver who is not you approves it in the money-out queue. The threshold is an assumption of this
          build, not a regulatory figure.
        </p>
      ) : null}
      <form method="post" action={`/api/policies/${policyId}/cancel`} className="card">
        <input type="hidden" name="effectiveAt" value={plan.effectiveAt} />
        {/* Short-rate is representable but not computed by this build: the method is stored on
            the cancellation event and any other value is refused by the server. */}
        <input type="hidden" name="calculationMethod" value={plan.calculationMethod} />
        {/* The policy as it stood when these figures were computed. The server refuses the
            confirmation if the policy changed in the meantime. */}
        <input type="hidden" name="policyVersion" value={plan.policyVersion} />
        <button type="submit">
          Cancel the policy as of {plan.effectiveAt}
          {breakdown.totalRefundCents > 0 ? ` and request a ${formatCentsAsUsd(breakdown.totalRefundCents)} refund` : ""}
        </button>
      </form>
    </PortalShell>
  );
}
