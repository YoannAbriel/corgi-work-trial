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

// THE CUSTOMER-APPROVAL THRESHOLD IS PER POLICY AND CUMULATIVE (decision 24 of
// DECISIONS.md, 2026-09-09, the same shape as the claims rule above; it widens the base of review
// finding F-B4-09 and closes F-INT-12).
//
// An endorsement that adds more than $500 of premium needs the customer's explicit yes. The $500
// is read against THE POLICY, not against one endorsement at a time: the running total is the
// additional premium of the endorsements of the current term, the applied ones and the open
// requests together. Yoann's example, decided with the figures:
//
//   endorsement 1   +$300.00   running total $300.00   no approval
//   endorsement 2   +$300.00   running total $600.00   the customer approves
//   endorsement 3    +$50.00   running total $650.00   the customer approves
//
// THE BASE IS THE PREMIUM, BEFORE TAX: the delta premium, never the delta total. The tax follows
// the premium and is owed to the state, so letting it push a policy over the line would make the
// question depend on the state the policy is written in rather than on the cover sold.
//
// A reduction never counts and never needs approval (rule 8 is unchanged): the customer is being
// given money back, not asked for any.
//
// A CORRECTION DIFFERENCE IS JUDGED BY THIS SAME FUNCTION AND THIS SAME RUNNING TOTAL. Correcting
// the effective date of an endorsement re-prices that endorsement: the premium difference it
// creates is additional premium of the same term, so it moves the same total and is read against
// the same $500 (review findings F-B8-02 and F-B8-04, which had the correction path counting a
// base of its own). An endorsement of $400 followed by a correction difference of $200 collects
// $600 from a customer nobody ever asked, unless the two are counted together. A correction that
// lowers the premium gives money back and asks for nothing, like a reduction.
//
// ONE function decides it, for the preview, for the request being recorded, for the payment gate
// and for a correction difference, so none of them can disagree (F-INT-12). The running total it
// reads comes from one place too: additionalPremiumOfTheTerm in lib/policy/endorsement-requests.ts. The threshold itself
// lives in lib/money/endorsement.ts, next to the function that prices an endorsement, so this
// file takes it as an argument rather than importing it back.
export type EndorsementCustomerApprovalInput = {
  // The running total BEFORE this endorsement: the additional premium of the term's other
  // endorsements, applied and open together, this one excluded.
  additionalPremiumSoFarCents: number;
  // The additional premium of this endorsement, before tax. Zero or negative on a reduction.
  additionalPremiumCents: number;
  thresholdCents: number;
};

export function endorsementNeedsCustomerApproval(input: EndorsementCustomerApprovalInput): boolean {
  if (!Number.isSafeInteger(input.additionalPremiumSoFarCents) || input.additionalPremiumSoFarCents < 0) {
    throw new Error(
      `additionalPremiumSoFarCents must be a whole number of cents, zero or more, got ${input.additionalPremiumSoFarCents}`,
    );
  }
  if (!Number.isSafeInteger(input.additionalPremiumCents)) {
    throw new Error(`additionalPremiumCents must be a whole number of cents, got ${input.additionalPremiumCents}`);
  }
  if (!Number.isSafeInteger(input.thresholdCents) || input.thresholdCents <= 0) {
    throw new Error(`thresholdCents must be a positive whole number of cents, got ${input.thresholdCents}`);
  }
  // A reduction gives money back: it adds nothing to the total and asks the customer for nothing.
  if (input.additionalPremiumCents <= 0) {
    return false;
  }
  // "Above $500" is strictly above: a running total of exactly $500.00 still needs no approval.
  return input.additionalPremiumSoFarCents + input.additionalPremiumCents > input.thresholdCents;
}
