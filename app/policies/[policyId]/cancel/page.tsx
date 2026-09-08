import Link from "next/link";
import { redirect } from "next/navigation";
import { MONEY_OUT_APPROVAL_THRESHOLD_CENTS } from "@/lib/approvals/threshold";
import { currentUser } from "@/lib/auth/current-user";
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
        <main>
          <p className="note">
            <Link href={`/policies/${policyId}`}>Back to the policy</Link>
          </p>
          <h1>Cancellation preview</h1>
          <p className="error">{error.message}</p>
        </main>
      );
    }
    throw error;
  }

  const { breakdown, terms } = plan;

  return (
    <main>
      <p className="note">
        <Link href={`/policies/${policyId}`}>Back to the policy</Link>
      </p>

      <h1>Cancel policy {plan.policyNumber}</h1>
      <p className="lead">
        Nothing has happened yet. These are the amounts as of <strong>{plan.effectiveAt}</strong>, the day cover would
        stop. Pro-rata calculation on the actual days of the term.
      </p>

      <h2>What the customer gets back</h2>
      <table className="amounts">
        <tbody>
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
      {breakdown.taxRefundWasCappedAtCharged ? (
        <p className="note">
          The tax refund is capped at the {formatCentsAsUsd(terms.taxCents)} of premium tax actually charged on this
          policy: rounding up the refund would otherwise give back a cent that was never collected.
        </p>
      ) : null}

      {/* Slice B7: an open claim is the live-fire question, so the answer is on the screen the
          operator is looking at when they take the decision, with the claim's own figures. */}
      {plan.openClaims.explanation ? (
        <>
          <h2>This policy has an open claim</h2>
          <p className="note">{plan.openClaims.explanation}</p>
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
        </>
      ) : null}

      <h2>What the broker gives back</h2>
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

      <h2>How the money goes back</h2>
      {plan.slices.length === 0 ? (
        <p className="note">Nothing is owed back on this date, so no refund will be sent to Stripe.</p>
      ) : (
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
      )}

      <h2>Confirm</h2>
      <p className="note">
        Confirming writes the cancellation, the journal entries and the refund request in one transaction, then asks
        Stripe for the money. The refund only counts as completed when Stripe&apos;s webhook says it left.
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
          Cancel the policy as of {plan.effectiveAt} and refund {formatCentsAsUsd(breakdown.totalRefundCents)}
        </button>
      </form>
    </main>
  );
}
