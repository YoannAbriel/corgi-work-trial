import { createHash } from "node:crypto";
import { customerApprovalNeeded } from "@/lib/approvals/threshold";
import { daysBetween, termDays, type CalendarDate } from "./dates";
import {
  commissionCents,
  elapsedTermDays,
  endorsementDeltaCents,
  refundedTaxCents,
  refundedTaxCentsCappedAtCharged,
  stateTaxCents,
} from "./premium";

// Everything a mid-term endorsement moves, in one pure function.
//
// The preview shown to the broker BEFORE anything is recorded, the customer's approval screen,
// the amounts posted at execution and the explanation printed afterwards all come from
// `computeEndorsement` and from nowhere else. That is the differentiator of this build: the
// screen cannot promise a figure the ledger will not book, because both read the same function.
//
// Money rules (decided by Yoann, DECISIONS.md), with the recited example: $1,200 annual premium
// written 2028-03-01 (365-day term), California 2.35%, 15% commission, endorsed on day 100
// (2028-06-09, 265 days remaining):
//
//   raise to $1,800   delta = floor(60000 x 265 / 365) = 43561 cents charged (customer pays, floored)
//                     tax   = floor(43561 x 235 / 10000) = 1023 cents charged
//                     total = 44584 cents; commission earned floor(43561 x 15%) = 6534
//   same, 30 days earlier (295 days remaining): floor(60000 x 295 / 365) = 48493
//   lower to $600     delta = ceil(60000 x 265 / 365) = 43562 cents refunded (customer receives, ceiled)
//                     tax   = ceil(43562 x 235 / 10000) = 1024, capped at the tax charged so far
//                     total = 44586 cents refunded; commission clawed back floor(43562 x 15%) = 6534
//
// The flat policy fee is charged at issuance only: never again, never refunded, so it is 0 here.
// The customer must approve when the amount to collect (premium plus tax) is above $500.

// Assumption of this build, not a Corgi rule (DECISIONS.md, 08:04Z): an endorsement adding more
// than $500 needs the customer's explicit approval before the money is collected. The threshold
// is read against the policy, not against one endorsement: see customerApprovalNeeded in
// lib/approvals/threshold.ts (review finding F-B4-09).
export const CUSTOMER_APPROVAL_THRESHOLD_CENTS = 50000;

export type EndorsementInput = {
  policyId: string;
  // How many policy events the fold applied when this quote was computed. Any later event
  // changes it, which is what makes an old quote refusable (see endorsementQuoteHash).
  policyVersion: number;
  termStart: CalendarDate;
  termEnd: CalendarDate;
  effectiveAt: CalendarDate; // the day the change takes effect, never the day it was typed in
  oldAnnualPremiumCents: number;
  newAnnualPremiumCents: number;
  taxRateBps: number; // the rate in force on the policy, 235 = 2.35%
  // Premium tax charged on this policy and not yet refunded. A refund of tax can never exceed
  // it (the same cap as a cancellation, review finding F-B1-07).
  taxChargedSoFarCents: number;
  commissionRateBps: number;
  // Additional premium already asked for on this policy and not yet approved by the customer,
  // excluding this quote. The customer-approval threshold is cumulative per policy (review
  // finding F-B4-09), so two raises of $400 in a row cannot each escape the question.
  otherUnapprovedRequestedCents?: number;
};

// "charge": the customer pays the delta. "refund": the customer is refunded. "none": nothing
// moves (same premium, or an endorsement effective on the last day of the term).
export type EndorsementDirection = "charge" | "refund" | "none";

export type EndorsementFigures = {
  policyId: string;
  policyVersion: number;
  termStart: CalendarDate;
  termEnd: CalendarDate;
  effectiveAt: CalendarDate;
  termDays: number;
  daysRemaining: number; // from the effective date to the end of the term
  oldAnnualPremiumCents: number;
  newAnnualPremiumCents: number;
  annualDifferenceCents: number; // new minus old, signed
  // Signed amounts: positive means charged to the customer, negative means refunded.
  deltaPremiumCents: number; // prorated over the remaining days; floored when charged, ceiled when refunded
  deltaTaxCents: number; // tax on the delta; floored when charged, ceiled and capped when refunded
  taxRefundWasCappedAtCharged: boolean;
  deltaFeeCents: 0; // the flat fee is charged at issuance only
  deltaTotalCents: number; // premium plus tax, signed: what Stripe collects or refunds
  commissionDeltaCents: number; // earned on a charge (positive), clawed back on a refund (negative), floored
  direction: EndorsementDirection;
  customerApprovalRequired: boolean;
  taxRateBps: number;
  taxChargedSoFarCents: number;
  commissionRateBps: number;
  quoteHash: string;
};

export class EndorsementNotComputable extends Error {}

export function computeEndorsement(input: EndorsementInput): EndorsementFigures {
  assertCents("oldAnnualPremiumCents", input.oldAnnualPremiumCents);
  assertCents("newAnnualPremiumCents", input.newAnnualPremiumCents);
  assertCents("taxChargedSoFarCents", input.taxChargedSoFarCents);

  // The effective date must be a day the policy actually covers. Before the term start there is
  // nothing to endorse (the issuance itself would have to be corrected); after the term end
  // there is no remaining day to price.
  if (daysBetween(input.termStart, input.effectiveAt) < 0) {
    throw new EndorsementNotComputable(
      `an endorsement cannot take effect before the policy starts (${input.termStart})`,
    );
  }
  if (daysBetween(input.effectiveAt, input.termEnd) < 0) {
    throw new EndorsementNotComputable(`the policy ends on ${input.termEnd}, so nothing can be endorsed after that date`);
  }

  const totalTermDays = termDays(input.termStart, input.termEnd);
  const daysRemaining = totalTermDays - elapsedTermDays(input.termStart, input.termEnd, input.effectiveAt);
  const annualDifferenceCents = input.newAnnualPremiumCents - input.oldAnnualPremiumCents;

  // The prorated delta, signed: lib/money/premium.ts floors a charge and ceils a refund.
  const deltaPremiumCents = endorsementDeltaCents(
    input.oldAnnualPremiumCents,
    input.newAnnualPremiumCents,
    input.termStart,
    input.termEnd,
    input.effectiveAt,
  );

  let deltaTaxCents = 0;
  let taxRefundWasCappedAtCharged = false;
  let commissionDeltaCents = 0;
  let direction: EndorsementDirection = "none";
  if (deltaPremiumCents > 0) {
    direction = "charge";
    deltaTaxCents = stateTaxCents(deltaPremiumCents, input.taxRateBps);
    commissionDeltaCents = commissionCents(deltaPremiumCents, input.commissionRateBps);
  } else if (deltaPremiumCents < 0) {
    direction = "refund";
    const refundedPremium = -deltaPremiumCents;
    const uncappedTax = refundedTaxCents(refundedPremium, input.taxRateBps);
    const cappedTax = refundedTaxCentsCappedAtCharged(refundedPremium, input.taxRateBps, input.taxChargedSoFarCents);
    deltaTaxCents = -cappedTax;
    taxRefundWasCappedAtCharged = cappedTax < uncappedTax;
    commissionDeltaCents = -commissionCents(refundedPremium, input.commissionRateBps);
  }

  const deltaTotalCents = deltaPremiumCents + deltaTaxCents;

  return {
    policyId: input.policyId,
    policyVersion: input.policyVersion,
    termStart: input.termStart,
    termEnd: input.termEnd,
    effectiveAt: input.effectiveAt,
    termDays: totalTermDays,
    daysRemaining,
    oldAnnualPremiumCents: input.oldAnnualPremiumCents,
    newAnnualPremiumCents: input.newAnnualPremiumCents,
    annualDifferenceCents,
    deltaPremiumCents,
    deltaTaxCents,
    taxRefundWasCappedAtCharged,
    deltaFeeCents: 0,
    deltaTotalCents,
    commissionDeltaCents,
    direction,
    // Approval is about money the customer has to pay: a refund never needs it.
    customerApprovalRequired:
      deltaTotalCents > 0 &&
      customerApprovalNeeded({
        amountCents: deltaTotalCents,
        unapprovedRequestedCents: input.otherUnapprovedRequestedCents ?? 0,
        thresholdCents: CUSTOMER_APPROVAL_THRESHOLD_CENTS,
      }),
    taxRateBps: input.taxRateBps,
    taxChargedSoFarCents: input.taxChargedSoFarCents,
    commissionRateBps: input.commissionRateBps,
    quoteHash: endorsementQuoteHash({
      policyId: input.policyId,
      policyVersion: input.policyVersion,
      effectiveAt: input.effectiveAt,
      newAnnualPremiumCents: input.newAnnualPremiumCents,
      deltaPremiumCents,
      deltaTaxCents,
    }),
  };
}

// ---------------------------------------------------------------------------------------
// Repricing a stored endorsement, to check the fold that explains it
// ---------------------------------------------------------------------------------------

// One printed figure that the recomputation does not agree with.
export type FigureDisagreement = {
  // What the figure is, in the words the fold uses.
  figure: string;
  storedCents: number; // what the event holds, and what the ledger posted
  recomputedCents: number; // what the same inputs price today
};

export type FiguresRecheck = {
  agrees: boolean;
  disagreements: FigureDisagreement[]; // empty when they agree
  // Set when the stored inputs cannot be priced at all today (a date outside the term, a figure
  // the pure function refuses). Nothing is compared then, and the fold says so rather than
  // claiming agreement.
  notComputable: string | null;
};

// THE AGREEMENT CHECK UNDER THE ENDORSEMENT FOLD (review finding F-INT-05).
//
// The fold used to compare the stored total with itself, so its alert could not fire whatever the
// data said. This prices the endorsement AGAIN from the inputs stored on its own event, which are
// the same inputs the preview used (the term, its dates, the effective date, the two annual
// premiums, the tax rate, the tax charged so far and the commission rate), and compares every
// money figure the fold prints with the one the ledger holds.
//
// computeEndorsement stays the single source of the arithmetic: there is no second formula here,
// only a call and a subtraction. The day counts are not compared on their own because they are
// inputs to the figures below: a wrong number of days shows up as a wrong prorated premium.
export function recheckEndorsementFigures(stored: EndorsementFigures): FiguresRecheck {
  let recomputed: EndorsementFigures;
  try {
    recomputed = computeEndorsement({
      policyId: stored.policyId,
      policyVersion: stored.policyVersion,
      termStart: stored.termStart,
      termEnd: stored.termEnd,
      effectiveAt: stored.effectiveAt,
      oldAnnualPremiumCents: stored.oldAnnualPremiumCents,
      newAnnualPremiumCents: stored.newAnnualPremiumCents,
      taxRateBps: stored.taxRateBps,
      taxChargedSoFarCents: stored.taxChargedSoFarCents,
      commissionRateBps: stored.commissionRateBps,
    });
  } catch (error) {
    return {
      agrees: false,
      disagreements: [],
      notComputable: error instanceof Error ? error.message : String(error),
    };
  }

  const comparisons: FigureDisagreement[] = [
    { figure: "annual premium difference", storedCents: stored.annualDifferenceCents, recomputedCents: recomputed.annualDifferenceCents },
    { figure: "prorated premium", storedCents: stored.deltaPremiumCents, recomputedCents: recomputed.deltaPremiumCents },
    { figure: "state premium tax", storedCents: stored.deltaTaxCents, recomputedCents: recomputed.deltaTaxCents },
    { figure: "policy fee", storedCents: stored.deltaFeeCents, recomputedCents: recomputed.deltaFeeCents },
    { figure: "total collected or refunded", storedCents: stored.deltaTotalCents, recomputedCents: recomputed.deltaTotalCents },
    { figure: "broker commission", storedCents: stored.commissionDeltaCents, recomputedCents: recomputed.commissionDeltaCents },
  ];
  const disagreements = comparisons.filter((comparison) => comparison.storedCents !== comparison.recomputedCents);
  return { agrees: disagreements.length === 0, disagreements, notComputable: null };
}

// ---------------------------------------------------------------------------------------
// The quote hash: what an approval and a payment are bound to
// ---------------------------------------------------------------------------------------

export type QuoteHashInput = {
  policyId: string;
  policyVersion: number;
  effectiveAt: CalendarDate;
  newAnnualPremiumCents: number;
  deltaPremiumCents: number;
  deltaTaxCents: number;
};

// SHA-256 over the six facts that make a quote what it is. The customer approves THIS hash and
// the broker pays THIS hash; if any of the six changed in between (a second endorsement was
// requested, so the version moved; a different date or premium was typed), the hash no longer
// matches and the server refuses with a plain message instead of executing stale figures.
// The separator cannot appear in any of the parts (ids, dates and integers), so two different
// inputs cannot produce the same joined string.
export function endorsementQuoteHash(input: QuoteHashInput): string {
  const joined = [
    input.policyId,
    String(input.policyVersion),
    input.effectiveAt,
    String(input.newAnnualPremiumCents),
    String(input.deltaPremiumCents),
    String(input.deltaTaxCents),
  ].join("|");
  return createHash("sha256").update(joined).digest("hex");
}

// ---------------------------------------------------------------------------------------
// The formula lines the screens print
// ---------------------------------------------------------------------------------------

// One printed line: what it is, how it was computed, and the cents it came to. The screens
// format the cents; nothing here is a string a browser could compute differently.
export type FormulaLine = {
  key: string;
  label: string;
  formula: string;
  cents: number;
};

// The same lines before approval (preview) and after execution (explanation). The figures are
// either freshly computed (preview) or read back from the immutable endorsement event
// (explanation); the lines are built the same way from either.
export function endorsementFormulaLines(figures: EndorsementFigures): FormulaLine[] {
  const rate = `${figures.taxRateBps} / 10000`;
  const commissionRate = `${figures.commissionRateBps} / 10000`;
  const absoluteDifference = Math.abs(figures.annualDifferenceCents);
  const absolutePremium = Math.abs(figures.deltaPremiumCents);

  const lines: FormulaLine[] = [
    {
      key: "annual_difference",
      label: "Annual premium difference (new minus old)",
      formula: `${figures.newAnnualPremiumCents} - ${figures.oldAnnualPremiumCents}`,
      cents: figures.annualDifferenceCents,
    },
  ];

  if (figures.direction === "charge") {
    lines.push(
      {
        key: "delta_premium",
        label: `Prorated premium charged, ${figures.daysRemaining} of ${figures.termDays} days remain from ${figures.effectiveAt} (rounded down)`,
        formula: `floor(${absoluteDifference} x ${figures.daysRemaining} / ${figures.termDays})`,
        cents: figures.deltaPremiumCents,
      },
      {
        key: "delta_tax",
        label: "State premium tax on the charged premium (rounded down)",
        formula: `floor(${absolutePremium} x ${rate})`,
        cents: figures.deltaTaxCents,
      },
    );
  } else if (figures.direction === "refund") {
    lines.push(
      {
        key: "delta_premium",
        label: `Prorated premium refunded, ${figures.daysRemaining} of ${figures.termDays} days remain from ${figures.effectiveAt} (rounded up)`,
        formula: `-ceil(${absoluteDifference} x ${figures.daysRemaining} / ${figures.termDays})`,
        cents: figures.deltaPremiumCents,
      },
      {
        key: "delta_tax",
        label: figures.taxRefundWasCappedAtCharged
          ? `State premium tax refunded, capped at the ${figures.taxChargedSoFarCents} cents charged so far`
          : "State premium tax refunded on the refunded premium (rounded up)",
        formula: figures.taxRefundWasCappedAtCharged
          ? `-min(ceil(${absolutePremium} x ${rate}), ${figures.taxChargedSoFarCents})`
          : `-ceil(${absolutePremium} x ${rate})`,
        cents: figures.deltaTaxCents,
      },
    );
  } else {
    lines.push({
      key: "delta_premium",
      label: `Prorated premium, ${figures.daysRemaining} of ${figures.termDays} days remain from ${figures.effectiveAt}`,
      formula: `${absoluteDifference} x ${figures.daysRemaining} / ${figures.termDays}`,
      cents: 0,
    });
  }

  lines.push(
    {
      key: "delta_fee",
      label: "Policy fee (charged at issuance only, never again, never refunded)",
      formula: "0",
      cents: figures.deltaFeeCents,
    },
    {
      key: "delta_total",
      label:
        figures.direction === "charge"
          ? "Total collected from the customer through Stripe"
          : figures.direction === "refund"
            ? "Total refunded to the customer through Stripe"
            : "Total: no money moves",
      formula: `${figures.deltaPremiumCents} + ${figures.deltaTaxCents}`,
      cents: figures.deltaTotalCents,
    },
  );

  if (figures.direction === "charge") {
    lines.push({
      key: "commission",
      label: "Broker commission earned on the collected premium (rounded down)",
      formula: `floor(${absolutePremium} x ${commissionRate})`,
      cents: figures.commissionDeltaCents,
    });
  } else if (figures.direction === "refund") {
    lines.push({
      key: "commission",
      label: "Broker commission clawed back on the refunded premium (rounded down)",
      formula: `-floor(${absolutePremium} x ${commissionRate})`,
      cents: figures.commissionDeltaCents,
    });
  }

  return lines;
}

function assertCents(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer number of cents, got ${value}`);
  }
}
