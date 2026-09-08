// The maker-checker threshold, in one place.
//
// $1,000 of money-out needs a second, different human being to approve it before anything
// leaves. Decided by Yoann on 2026-09-08 (DECISIONS.md, 08:04): "money-out (claim payments and
// refunds) above $1,000 requires a distinct human approver, never the initiator and never an
// agent". Rejected alternatives were $500, $250, and an approval on every amount.
//
// THIS IS AN ASSUMPTION OF THIS BUILD, NOT A REGULATORY FACT. No law, no rail rule and no Corgi
// instruction sets it. It is written here once, so there is exactly one number to change and
// exactly one number to defend.
export const MONEY_OUT_APPROVAL_THRESHOLD_CENTS = 100000;

// "Above $1,000" means strictly above: a payment of exactly $1,000.00 goes out without an
// approver, a payment of $1,000.01 does not. One comparison, written once, used by the claim
// payment path, the refund path and both screens, so no entry point can read the rule
// differently from another.
export function moneyOutNeedsApproval(amountCents: number): boolean {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error(`a money-out amount must be a positive whole number of cents, got ${amountCents}`);
  }
  return amountCents > MONEY_OUT_APPROVAL_THRESHOLD_CENTS;
}

// THE THRESHOLD IS PER CLAIM, NOT PER PAYMENT (decided by Yoann on 2026-09-08, review finding
// F-B7-02). Two payments of $600 on one claim are $1,200 out of the door; splitting a payout
// into sub-threshold lines must not skip the approver. A claim payment therefore needs an
// approval when the payment alone is above the threshold, OR when it would bring the claim's
// money out (already sent and not returned, plus requested and still waiting, plus this one)
// above the threshold. The refund path has the same rule, in refundNeedsApproval below: an
// earlier comment here claimed it did not need one because a cancellation refunds one total
// computed once. That was wrong, and it is review finding F-B4-04: a policy can be endorsed
// downwards again and again, and each reduction is its own refund.
export type ClaimPayoutApprovalInput = {
  amountCents: number; // this payment
  claimPaidCents: number; // sent and not returned, on this claim
  claimPendingCents: number; // requested and not yet sent, on this claim (this one excluded)
};

export function claimPayoutNeedsApproval(input: ClaimPayoutApprovalInput): boolean {
  for (const [name, value] of Object.entries(input)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a whole number of cents, zero or more, got ${value}`);
    }
  }
  if (moneyOutNeedsApproval(input.amountCents)) {
    return true;
  }
  const claimTotalAfterThisPayment = input.claimPaidCents + input.claimPendingCents + input.amountCents;
  return claimTotalAfterThisPayment > MONEY_OUT_APPROVAL_THRESHOLD_CENTS;
}

// THE THRESHOLD IS PER POLICY, NOT PER REFUND (review finding F-B4-04, the same rule Yoann
// decided for claims). A cancellation refunds one total computed once, but an endorsement does
// not: lowering a premium by $600 three times sends $1,800 back to the customer in three refunds
// that are each under $1,000, and nobody would ever be asked to approve. So a refund needs an
// approval when it alone is above the threshold, OR when it would bring the policy's refunds
// above it.
//
// What counts in the total, and why:
//   money already gone     refunds Stripe accepted or completed. A refund Stripe FAILED gave the
//                          money back to us, so it counts for nothing.
//   money on its way       refunds requested and not failed, this one excluded, whether they are
//                          waiting for an approver or waiting to be sent. Counting them is what
//                          stops two reductions asked for in the same minute from both looking
//                          affordable.
export type RefundApprovalInput = {
  amountCents: number; // this refund
  policyRefundedCents: number; // accepted or completed at Stripe on this policy
  policyPendingRefundCents: number; // requested and not failed, this one excluded
};

export function refundNeedsApproval(input: RefundApprovalInput): boolean {
  for (const [name, value] of Object.entries(input)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a whole number of cents, zero or more, got ${value}`);
    }
  }
  if (moneyOutNeedsApproval(input.amountCents)) {
    return true;
  }
  const policyTotalAfterThisRefund = input.policyRefundedCents + input.policyPendingRefundCents + input.amountCents;
  return policyTotalAfterThisRefund > MONEY_OUT_APPROVAL_THRESHOLD_CENTS;
}
