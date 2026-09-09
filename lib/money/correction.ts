import {
  endorsementNeedsCustomerApproval,
  MONEY_OUT_APPROVAL_THRESHOLD_CENTS,
  refundNeedsApproval,
} from "@/lib/approvals/threshold";
import { formatCentsAsUsd } from "./cents";
import type { CalendarDate } from "./dates";
import {
  computeEndorsement,
  CUSTOMER_APPROVAL_THRESHOLD_CENTS,
  type EndorsementFigures,
  type FormulaLine,
} from "./endorsement";
import { commissionCents } from "./premium";

// Everything a backdated correction of an endorsement's effective date moves, in one pure
// function. The preview shown to the operator BEFORE anything is recorded, the amounts posted at
// execution and the explanation printed afterwards all come from `correctEndorsementDateMoney`
// and from nowhere else, which is the differentiator of this build: the screen cannot promise a
// figure the ledger will not book, because both read the same function.
//
// It re-prices the SAME endorsement with ONE input changed, the effective date. Every other
// input is the one the endorsement was priced with (the annual premium before and after, the tax
// rate in force on the policy, the commission rate, the tax already charged), read back from the
// immutable event. That is what "the date was wrong and nothing else" means, and it is why a
// correction can never quietly re-price a policy at today's rates.
//
// Worked example, the recited one (DECISIONS.md): $1,200 annual premium written 2028-03-01,
// California 2.35%, 15% commission, 365-day term, raised to $1,800.
//
//   entered by mistake at 2028-07-09 (day 130, 235 days remain)
//       premium floor(60000 x 235 / 365) = 38630   tax floor(38630 x 235 / 10000) =  907   total 39537
//   corrected to 2028-06-09 (day 100, 265 days remain)
//       premium floor(60000 x 265 / 365) = 43561   tax floor(43561 x 235 / 10000) = 1023   total 44584
//
//   difference    premium 4931, tax 116, total 5047 to COLLECT from the customer
//   commission    floor(4931 x 1500 / 10000) = 739 earned on the extra premium
//
// The same correction the other way round (entered at day 100, corrected to day 130) gives the
// mirror image: 5047 to REFUND and 739 of commission clawed back.

export type CorrectionSettlement = "collect" | "refund" | "none";

// What the two approval thresholds are read AGAINST. Neither is a question about this correction
// alone (review findings F-B8-02 and F-B8-04, and F-B4-04 and F-B4-09 before them, which decided
// the rule for endorsements): three differences of $600 given back on one policy are $1,800 out of
// the door, and an endorsement of $400 followed by a correction difference of $200 collects $600
// from a customer who was never asked. The caller reads these totals from the policy at the moment
// the gate is applied (lib/policy/correct-endorsement-date.ts) and passes them in, so this file
// stays pure and the rule stays in one place.
export type CorrectionThresholdTotals = {
  // Refunds this policy has already sent, and refunds on their way (lib/payments/refunds.ts,
  // policyRefundTotals). A refund that FAILED gave the money back to us and counts for nothing.
  policyRefundedCents: number;
  policyPendingRefundCents: number;
  // The running total the $500 customer threshold is read against, BEFORE this correction's own
  // difference: the additional premium (before tax) of this term's endorsements, the applied ones
  // and the open requests together (decision 24, additionalPremiumOfTheTerm in
  // lib/policy/endorsement-requests.ts). It is the SAME base an endorsement is judged on, which
  // is the whole point: a correction re-prices an endorsement, so its difference belongs to that
  // same total rather than to a base of its own.
  additionalPremiumOfTheTermCents: number;
};

export type EndorsementDateCorrection = {
  wrongEffectiveAt: CalendarDate;
  correctedEffectiveAt: CalendarDate;
  // The figures the endorsement was booked with, exactly as they were stored on its event.
  before: EndorsementFigures;
  // The same endorsement re-priced at the corrected date.
  after: EndorsementFigures;
  // Signed differences, positive when the customer owes more than was booked.
  differencePremiumCents: number;
  differenceTaxCents: number;
  differenceTotalCents: number;
  // Commission on the premium difference, signed: earned on more premium, clawed back on less.
  // Rounded down on the absolute amount, like every other commission figure in this build, so
  // the insurer absorbs the fraction (DECISIONS.md, clawback rounded down).
  differenceCommissionCents: number;
  settlement: CorrectionSettlement;
  // The customer has to approve when this difference takes the term's additional premium above
  // $500, counting the endorsements already in force and the quotes still open, exactly as for an
  // endorsement and through the same function (decision 24).
  customerApprovalRequired: boolean;
  // A difference given back waits for a distinct human approver when it takes what this policy
  // has given back past $1,000, exactly as every other money-out (lib/approvals/threshold.ts).
  refundNeedsApproval: boolean;
  // The totals the two verdicts above were read against. They are kept on the result, written on
  // the correction event and printed on the screens: a verdict is never shown without the figure
  // behind it.
  totals: CorrectionThresholdTotals;
};

export function correctEndorsementDateMoney(
  before: EndorsementFigures,
  correctedEffectiveAt: CalendarDate,
  totals: CorrectionThresholdTotals,
): EndorsementDateCorrection {
  const after = computeEndorsement({
    policyId: before.policyId,
    policyVersion: before.policyVersion,
    termStart: before.termStart,
    termEnd: before.termEnd,
    // The one input that changes.
    effectiveAt: correctedEffectiveAt,
    oldAnnualPremiumCents: before.oldAnnualPremiumCents,
    newAnnualPremiumCents: before.newAnnualPremiumCents,
    taxRateBps: before.taxRateBps,
    taxChargedSoFarCents: before.taxChargedSoFarCents,
    commissionRateBps: before.commissionRateBps,
  });

  const differencePremiumCents = after.deltaPremiumCents - before.deltaPremiumCents;
  const differenceTaxCents = after.deltaTaxCents - before.deltaTaxCents;
  const differenceTotalCents = differencePremiumCents + differenceTaxCents;

  const commissionOnDifference = commissionCents(Math.abs(differencePremiumCents), before.commissionRateBps);
  const differenceCommissionCents =
    differencePremiumCents > 0 ? commissionOnDifference : differencePremiumCents < 0 ? -commissionOnDifference : 0;

  const settlement: CorrectionSettlement =
    differenceTotalCents > 0 ? "collect" : differenceTotalCents < 0 ? "refund" : "none";

  return {
    wrongEffectiveAt: before.effectiveAt,
    correctedEffectiveAt,
    before,
    after,
    differencePremiumCents,
    differenceTaxCents,
    differenceTotalCents,
    differenceCommissionCents,
    settlement,
    // The same predicate the endorsement path uses, on the same running total. No settlement test
    // in front of it: a difference that lowers the premium is a negative number, and the predicate
    // already answers false on one. The base is the PREMIUM difference, never the total: the tax
    // follows the premium and never decides the question (decision 24).
    customerApprovalRequired: endorsementNeedsCustomerApproval({
      additionalPremiumSoFarCents: totals.additionalPremiumOfTheTermCents,
      additionalPremiumCents: differencePremiumCents,
      thresholdCents: CUSTOMER_APPROVAL_THRESHOLD_CENTS,
    }),
    refundNeedsApproval:
      settlement === "refund" &&
      refundNeedsApproval({
        amountCents: -differenceTotalCents,
        policyRefundedCents: totals.policyRefundedCents,
        policyPendingRefundCents: totals.policyPendingRefundCents,
      }),
    totals,
  };
}

// The sentence a screen prints beside each verdict. THE RULE: never state a verdict without the
// total it was read against, so an operator, a broker and a customer can all check the arithmetic
// instead of trusting a yes or a no.
export type CorrectionApprovalSentences = {
  customer: string | null; // null when no money is being collected
  refund: string | null; // null when no money is being given back
};

export function correctionApprovalSentences(correction: EndorsementDateCorrection): CorrectionApprovalSentences {
  const { totals } = correction;
  if (correction.settlement === "collect") {
    const amount = formatCentsAsUsd(correction.differenceTotalCents);
    // The running total WITH this difference in it, which is the figure the verdict compares, and
    // the same sentence shape the endorsement preview prints (app/policies/[policyId]/endorse).
    const runningTotal = formatCentsAsUsd(totals.additionalPremiumOfTheTermCents + correction.differencePremiumCents);
    const threshold = formatCentsAsUsd(CUSTOMER_APPROVAL_THRESHOLD_CENTS);
    return {
      customer: correction.customerApprovalRequired
        ? `${amount} to collect: with this difference, this policy carries ${runningTotal} of additional premium in this term, above ${threshold}, so the customer has to approve it before it is collected`
        : `${amount} to collect: with this difference, this policy carries ${runningTotal} of additional premium in this term, at or below ${threshold}, so no customer approval is needed`,
      refund: null,
    };
  }
  if (correction.settlement === "refund") {
    const amount = formatCentsAsUsd(-correction.differenceTotalCents);
    const refunded = formatCentsAsUsd(totals.policyRefundedCents);
    const pending = formatCentsAsUsd(totals.policyPendingRefundCents);
    const threshold = formatCentsAsUsd(MONEY_OUT_APPROVAL_THRESHOLD_CENTS);
    return {
      customer: null,
      refund: correction.refundNeedsApproval
        ? `this ${amount} takes what this policy has given back past ${threshold} (${refunded} already refunded, ${pending} still on its way), so a second person, never you, has to approve it`
        : `this ${amount} is at or below ${threshold} counting the ${refunded} this policy has already refunded and the ${pending} still on its way, so no second approver is needed`,
    };
  }
  return { customer: null, refund: null };
}

// The lines the screens print: what was booked, what it should have been, and what moves because
// of it. Same shape as the endorsement's own formula lines (lib/money/endorsement.ts), so the
// preview before the correction and the explanation after it are the same table.
export function correctionFormulaLines(correction: EndorsementDateCorrection): FormulaLine[] {
  const { before, after } = correction;
  const annualDifference = Math.abs(before.annualDifferenceCents);
  const rate = `${before.taxRateBps} / 10000`;
  const commissionRate = `${before.commissionRateBps} / 10000`;

  return [
    {
      key: "premium_as_booked",
      label: `Prorated premium as booked, ${before.daysRemaining} of ${before.termDays} days remained from ${before.effectiveAt}`,
      formula: `floor(${annualDifference} x ${before.daysRemaining} / ${before.termDays})`,
      cents: before.deltaPremiumCents,
    },
    {
      key: "premium_corrected",
      label: `Prorated premium at the corrected date, ${after.daysRemaining} of ${after.termDays} days remain from ${after.effectiveAt}`,
      formula: `floor(${annualDifference} x ${after.daysRemaining} / ${after.termDays})`,
      cents: after.deltaPremiumCents,
    },
    {
      key: "premium_difference",
      label: "Premium difference the correction creates",
      formula: `${after.deltaPremiumCents} - ${before.deltaPremiumCents}`,
      cents: correction.differencePremiumCents,
    },
    {
      key: "tax_difference",
      label: "State premium tax difference (the tax follows the premium, rounded down on each figure)",
      formula: `floor(${after.deltaPremiumCents} x ${rate}) - floor(${before.deltaPremiumCents} x ${rate})`,
      cents: correction.differenceTaxCents,
    },
    {
      key: "difference_total",
      label:
        correction.settlement === "collect"
          ? "Total to collect from the customer through Stripe"
          : correction.settlement === "refund"
            ? "Total to refund to the customer through Stripe"
            : "Total: the corrected date moves no money",
      formula: `${correction.differencePremiumCents} + ${correction.differenceTaxCents}`,
      cents: correction.differenceTotalCents,
    },
    {
      key: "difference_commission",
      label:
        correction.settlement === "collect"
          ? "Broker commission earned on the extra premium (rounded down)"
          : correction.settlement === "refund"
            ? "Broker commission clawed back on the premium given back (rounded down)"
            : "Broker commission: unchanged",
      formula:
        correction.settlement === "refund"
          ? `-floor(${Math.abs(correction.differencePremiumCents)} x ${commissionRate})`
          : `floor(${Math.abs(correction.differencePremiumCents)} x ${commissionRate})`,
      cents: correction.differenceCommissionCents,
    },
  ];
}
