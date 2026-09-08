import { MONEY_OUT_APPROVAL_THRESHOLD_CENTS, moneyOutNeedsApproval } from "@/lib/approvals/threshold";
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
  // The customer has to approve paying a difference above $500, exactly as for an endorsement
  // that collects more than $500 (lib/money/endorsement.ts).
  customerApprovalRequired: boolean;
  // A difference given back above $1,000 waits for a distinct human approver, exactly as every
  // other money-out (lib/approvals/threshold.ts).
  refundNeedsApproval: boolean;
};

export function correctEndorsementDateMoney(
  before: EndorsementFigures,
  correctedEffectiveAt: CalendarDate,
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
    customerApprovalRequired: differenceTotalCents > CUSTOMER_APPROVAL_THRESHOLD_CENTS,
    refundNeedsApproval: settlement === "refund" && moneyOutNeedsApproval(-differenceTotalCents),
  };
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

// The two thresholds this file compares against, re-exported so a screen can name the figure it
// is applying without importing two modules.
export { CUSTOMER_APPROVAL_THRESHOLD_CENTS, MONEY_OUT_APPROVAL_THRESHOLD_CENTS };
