import type { FormulaLine } from "./endorsement";
import { commissionCents, stateTaxCents } from "./premium";

// "Explain this amount": what sits under every figure on a screen (slice B12-2, decided by Yoann
// on 2026-09-08, DECISIONS.md 18:52Z, display shape confirmed 2026-09-09 08:20 local).
//
// One rule governs this file: AN EXPLANATION IS NEVER A SECOND CALCULATION. It is built from the
// same pure functions and the same stored figures the page already shows, so the fold under a
// figure cannot say something the figure does not. Where a screen already has formula lines
// (endorsement, correction: lib/money/endorsement.ts and lib/money/correction.ts) those lines are
// reused as they are; where it does not, the lines are built here from the stored figures.
//
// Every function below is pure: no database, no clock, no provider. The screens format the cents;
// nothing is computed in the browser.

// One journal entry that proves a figure, reduced to what a reader needs to find it: what kind of
// entry it is, the business date it belongs to, the instant it was recorded, and the line that
// moved the account in question.
export type ExplanationEvidence = {
  entryType: string;
  effectiveAt: string;
  recordedAt: Date;
  detail: string; // "Dr cash_stripe 125320" or "Cr premium_tax_payable 2820"
};

// What the fold under a figure shows.
export type AmountExplanation = {
  // The arithmetic, in integer cents.
  lines: FormulaLine[];
  // The key of the line that IS the figure the fold sits under. The component compares it with
  // the figure and says so out loud if the two ever disagree.
  resultKey: string;
  // The rounding rule, named. Null when the figure is a sum of whole cents and nothing is rounded.
  rounding: string | null;
  // One sentence of business reason, when there is one worth reading.
  note?: string;
  // The journal entries that prove it, when there are any.
  evidence?: ExplanationEvidence[];
  // What those entries are, when "proved by these journal entries" would be too strong. A figure
  // that is a sum of journal lines is proved by them; a figure read from the terms in force is
  // only accompanied by the entries booked so far, and the difference has to be said.
  evidenceLabel?: string;
};

// The rounding rules of this build, named once so every screen says the same words.
// They are Yoann's rules (DECISIONS.md, 2026-09-08): the insurer eats the penny.
export const ROUNDED_DOWN_CUSTOMER_PAYS =
  "Rounded down (floor): the customer pays this amount, so the fraction of a cent is dropped and the insurer absorbs it.";
export const ROUNDED_UP_CUSTOMER_RECEIVES =
  "Rounded up (ceil): the customer receives this amount, so the fraction of a cent goes their way.";
export const ROUNDED_DOWN_COMMISSION =
  "Rounded down (floor): broker commission drops the fraction of a cent, on what is earned and on what is clawed back.";
export const NOTHING_ROUNDED = null;

// The line an explanation ends on, or null when the explanation was built with a key it does not
// carry. Null is a real answer here: a screen must be able to say "this fold does not match" and
// keep rendering, instead of turning a display defect into a 500.
export function explanationResultLine(explanation: AmountExplanation): FormulaLine | null {
  return explanation.lines.find((line) => line.key === explanation.resultKey) ?? null;
}

// The cents an explanation comes to. Throws when the result line is missing, which is a
// programming mistake, not a state of the data: the tests call this one.
export function explainedCents(explanation: AmountExplanation): number {
  const line = explanationResultLine(explanation);
  if (!line) {
    throw new Error(`this explanation has no line keyed "${explanation.resultKey}"`);
  }
  return line.cents;
}

function percentOfBasisPoints(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(2)}%`;
}

// ---------------------------------------------------------------------------
// The policy's terms in force: tax, fee, total
// ---------------------------------------------------------------------------

// State premium tax on the annual premium. The figure is RECOMPUTED here with the same pure
// function the issuance used (stateTaxCents), so a stored tax that no longer matches its own
// premium and rate would be caught by the component instead of being explained away.
export function explainStateTax(input: {
  stateCode: string;
  annualPremiumCents: number;
  taxRateBps: number;
  evidence?: ExplanationEvidence[];
}): AmountExplanation {
  return {
    lines: [
      {
        key: "premium",
        label: "Annual premium the tax is charged on",
        formula: `${input.annualPremiumCents}`,
        cents: input.annualPremiumCents,
      },
      {
        key: "tax",
        label: `${input.stateCode} premium tax at ${percentOfBasisPoints(input.taxRateBps)} (${input.taxRateBps} basis points)`,
        formula: `floor(${input.annualPremiumCents} x ${input.taxRateBps} / 10000)`,
        cents: stateTaxCents(input.annualPremiumCents, input.taxRateBps),
      },
    ],
    resultKey: "tax",
    rounding: ROUNDED_DOWN_CUSTOMER_PAYS,
    note: "Premium tax is charged on the premium alone: never on the policy fee, and never on itself.",
    evidence: input.evidence,
  };
}

// The flat policy fee. Nothing is prorated and nothing is rounded: it is a configured amount,
// charged once, and it is never given back on a cancellation.
export function explainPolicyFee(input: { feeCents: number; evidence?: ExplanationEvidence[] }): AmountExplanation {
  return {
    lines: [
      {
        key: "fee",
        label: "Flat policy fee, charged once at issuance",
        formula: `${input.feeCents}`,
        cents: input.feeCents,
      },
    ],
    resultKey: "fee",
    rounding: NOTHING_ROUNDED,
    note: "A configured flat amount, fully earned the day the policy is issued, so a mid-term cancellation never refunds it.",
    evidence: input.evidence,
  };
}

// What a full annual term at these terms costs the customer: the three figures above, added.
export function explainTotalCharge(input: {
  stateCode: string;
  annualPremiumCents: number;
  taxCents: number;
  feeCents: number;
  evidence?: ExplanationEvidence[];
}): AmountExplanation {
  return {
    lines: [
      {
        key: "premium",
        label: "Annual premium",
        formula: `${input.annualPremiumCents}`,
        cents: input.annualPremiumCents,
      },
      {
        key: "tax",
        label: `${input.stateCode} premium tax`,
        formula: `${input.taxCents}`,
        cents: input.taxCents,
      },
      { key: "fee", label: "Policy fee", formula: `${input.feeCents}`, cents: input.feeCents },
      {
        key: "total",
        label: "Total for a full annual term at these terms",
        formula: `${input.annualPremiumCents} + ${input.taxCents} + ${input.feeCents}`,
        cents: input.annualPremiumCents + input.taxCents + input.feeCents,
      },
    ],
    resultKey: "total",
    rounding: NOTHING_ROUNDED,
    note: "The terms in force, not what was collected: what actually moved is in the endorsement schedule, the refunds and the journal.",
    evidence: input.evidence,
  };
}

// ---------------------------------------------------------------------------
// A cancellation, figure by figure
// ---------------------------------------------------------------------------

// Every figure the cancellation panel prints, exactly as the cancellation event stored them
// (lib/money/premium.ts, cancellationBreakdown, computed once when the policy was cancelled).
export type CancellationFigures = {
  effectiveAt: string;
  termDays: number;
  earnedDays: number;
  writtenPremiumCents: number;
  earnedPremiumCents: number;
  unearnedPremiumCents: number;
  refundedTaxCents: number;
  taxRefundWasCappedAtCharged: boolean;
  refundedFeeCents: number;
  totalRefundCents: number;
  commissionClawbackCents: number;
  taxRateBps: number;
  commissionRateBps: number;
};

export type CancellationFigureKey =
  | "written_premium"
  | "earned_premium"
  | "unearned_premium"
  | "refunded_tax"
  | "refunded_fee"
  | "total_refund"
  | "commission_clawback";

// The whole pro-rata cancellation as one table of lines. Every screen that explains one of its
// figures shows this same table and points at a different line of it, so the seven folds of the
// panel can never tell seven different stories.
export function cancellationFormulaLines(cancellation: CancellationFigures): FormulaLine[] {
  return [
    {
      key: "written_premium",
      label: "Written premium: every piece of premium written on this policy, added up",
      formula: `${cancellation.writtenPremiumCents}`,
      cents: cancellation.writtenPremiumCents,
    },
    {
      key: "earned_premium",
      label: `Earned over ${cancellation.earnedDays} of ${cancellation.termDays} days, kept by the insurer (each written segment earns over its own window, rounded down)`,
      formula: `floor(written x ${cancellation.earnedDays} / ${cancellation.termDays}) per segment`,
      cents: cancellation.earnedPremiumCents,
    },
    {
      key: "unearned_premium",
      label: "Unearned premium, refunded: written minus earned",
      formula: `${cancellation.writtenPremiumCents} - ${cancellation.earnedPremiumCents}`,
      cents: cancellation.unearnedPremiumCents,
    },
    {
      key: "refunded_tax",
      label: cancellation.taxRefundWasCappedAtCharged
        ? `Premium tax on the refunded premium at ${percentOfBasisPoints(cancellation.taxRateBps)}, capped at the tax actually charged`
        : `Premium tax on the refunded premium at ${percentOfBasisPoints(cancellation.taxRateBps)} (rounded up)`,
      formula: cancellation.taxRefundWasCappedAtCharged
        ? `min(ceil(${cancellation.unearnedPremiumCents} x ${cancellation.taxRateBps} / 10000), tax charged)`
        : `ceil(${cancellation.unearnedPremiumCents} x ${cancellation.taxRateBps} / 10000)`,
      cents: cancellation.refundedTaxCents,
    },
    {
      key: "refunded_fee",
      label: "Policy fee given back: none, it was fully earned at issuance",
      formula: "0",
      cents: cancellation.refundedFeeCents,
    },
    {
      key: "total_refund",
      label: "Total refunded to the customer through Stripe",
      formula: `${cancellation.unearnedPremiumCents} + ${cancellation.refundedTaxCents} + ${cancellation.refundedFeeCents}`,
      cents: cancellation.totalRefundCents,
    },
    {
      key: "commission_clawback",
      label: `Broker commission clawed back on the refunded premium at ${percentOfBasisPoints(cancellation.commissionRateBps)}`,
      formula: `floor(${cancellation.unearnedPremiumCents} x ${cancellation.commissionRateBps} / 10000)`,
      cents: cancellation.commissionClawbackCents,
    },
  ];
}

const CANCELLATION_ROUNDING: Record<CancellationFigureKey, string | null> = {
  written_premium: NOTHING_ROUNDED,
  earned_premium: ROUNDED_DOWN_CUSTOMER_PAYS,
  unearned_premium: ROUNDED_UP_CUSTOMER_RECEIVES,
  refunded_tax: ROUNDED_UP_CUSTOMER_RECEIVES,
  refunded_fee: NOTHING_ROUNDED,
  total_refund: NOTHING_ROUNDED,
  commission_clawback: ROUNDED_DOWN_COMMISSION,
};

export function explainCancellationFigure(
  cancellation: CancellationFigures,
  key: CancellationFigureKey,
  evidence?: ExplanationEvidence[],
): AmountExplanation {
  return {
    lines: cancellationFormulaLines(cancellation),
    resultKey: key,
    rounding: CANCELLATION_ROUNDING[key],
    note: `Cancellation effective ${cancellation.effectiveAt}, pro rata. Each figure is the one stored on the cancellation event and posted to the journal; the earned part is rounded down per written segment, so the part given back is the larger one.`,
    evidence,
  };
}

// ---------------------------------------------------------------------------
// A claim: incurred = paid + reserve
// ---------------------------------------------------------------------------

export function explainClaimIncurred(input: {
  paidCents: number;
  reserveCents: number;
  incurredCents: number;
  settledCents: number;
  evidence?: ExplanationEvidence[];
}): AmountExplanation {
  return {
    lines: [
      {
        key: "paid",
        label: "Paid: every payment sent on the rail, minus anything the bank returned",
        formula: `${input.paidCents}`,
        cents: input.paidCents,
      },
      {
        key: "settled",
        label: "Of which the rail has confirmed as settled (a fact about the rail, not a third term)",
        formula: `${input.settledCents}`,
        cents: input.settledCents,
      },
      {
        key: "reserve",
        label: "Reserve still outstanding: the latest reserve set, less every payment sent out of it",
        formula: `${input.reserveCents}`,
        cents: input.reserveCents,
      },
      {
        key: "incurred",
        label: "Incurred = paid + reserve",
        formula: `${input.paidCents} + ${input.reserveCents}`,
        cents: input.paidCents + input.reserveCents,
      },
    ],
    resultKey: "incurred",
    rounding: NOTHING_ROUNDED,
    note: "Folded from this claim's events every time the page is rendered, never stored. A payment counts as paid the moment it is sent on the rail (Yoann's rule of 2026-09-08); a return puts it back into the reserve.",
    evidence: input.evidence,
  };
}

// ---------------------------------------------------------------------------
// A sum of journal lines
// ---------------------------------------------------------------------------

// The shape both the policy journal and the claim journal already have (lib/policy/read.ts,
// lib/claims/read.ts). Nothing else about an entry matters for a sum.
export type JournalEntryForExplanation = {
  entryType: string;
  effectiveAt: string;
  recordedAt: Date;
  lines: { accountId: string; accountName: string; debitCents: number; creditCents: number }[];
};

// Which side of an account a figure counts. `debits` is money that arrived on a debit-side
// account, `credits` money that left it, and `credits_minus_debits` is the balance of a
// credit-side account such as commission_payable or unearned_premium.
export type AccountSumRule = "debits" | "credits" | "credits_minus_debits";

function contributionOf(
  line: { debitCents: number; creditCents: number },
  rule: AccountSumRule,
): number {
  if (rule === "debits") return line.debitCents;
  if (rule === "credits") return line.creditCents;
  return line.creditCents - line.debitCents;
}

// THE sum. The screen prints this number and the fold under it lists the very lines that made it,
// because both call this function: there is one implementation, so they cannot disagree.
export function accountSumCents(
  entries: JournalEntryForExplanation[],
  accountId: string,
  rule: AccountSumRule,
): number {
  let total = 0;
  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.accountId === accountId) {
        total += contributionOf(line, rule);
      }
    }
  }
  return total;
}

// The same sum, written out: one formula line per journal line that contributed, then the total.
export function explainAccountSum(input: {
  entries: JournalEntryForExplanation[];
  accountId: string;
  rule: AccountSumRule;
  totalLabel: string;
  note?: string;
}): AmountExplanation {
  const lines: FormulaLine[] = [];
  const evidence: ExplanationEvidence[] = [];
  let position = 0;
  for (const entry of input.entries) {
    for (const line of entry.lines) {
      if (line.accountId !== input.accountId) continue;
      const contribution = contributionOf(line, input.rule);
      const side = line.debitCents > 0 ? "Dr" : "Cr";
      const movedCents = line.debitCents > 0 ? line.debitCents : line.creditCents;
      lines.push({
        key: `line_${position}`,
        label: `${entry.entryType}, effective ${entry.effectiveAt}`,
        formula: `${side} ${line.accountName} ${movedCents}`,
        cents: contribution,
      });
      evidence.push({
        entryType: entry.entryType,
        effectiveAt: entry.effectiveAt,
        recordedAt: entry.recordedAt,
        detail: `${side} ${line.accountName} ${movedCents}`,
      });
      position += 1;
    }
  }
  lines.push({
    key: "total",
    label: input.totalLabel,
    formula: lines.length === 0 ? "no line on this account yet" : lines.map((line) => line.cents).join(" + "),
    cents: accountSumCents(input.entries, input.accountId, input.rule),
  });
  return {
    lines,
    resultKey: "total",
    rounding: NOTHING_ROUNDED,
    note: input.note,
    evidence,
  };
}

// The journal entries that touched one account, as the evidence under a figure that was NOT
// computed from them (the terms in force, for instance): they are what proves the figure was
// really booked, not how it was calculated.
export function evidenceFromJournal(
  entries: JournalEntryForExplanation[],
  accountId: string,
): ExplanationEvidence[] {
  const evidence: ExplanationEvidence[] = [];
  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.accountId !== accountId) continue;
      const side = line.debitCents > 0 ? "Dr" : "Cr";
      const movedCents = line.debitCents > 0 ? line.debitCents : line.creditCents;
      evidence.push({
        entryType: entry.entryType,
        effectiveAt: entry.effectiveAt,
        recordedAt: entry.recordedAt,
        detail: `${side} ${line.accountName} ${movedCents}`,
      });
    }
  }
  return evidence;
}

// ---------------------------------------------------------------------------
// A broker statement total
// ---------------------------------------------------------------------------

// One stored statement line, reduced to what an explanation needs (lib/statements/read.ts).
export type StatementLineForExplanation = {
  kind: "premium_collected" | "commission_earned" | "clawback" | "refund" | "adjustment";
  journalEntryId: string;
  policyNumber: string | null;
  effectiveAt: Date;
  entryRecordedAt: Date;
  amountCents: number;
  commissionBaseCents: number | null;
  description: string;
};

export type StatementTotalKey =
  | "cash_collected"
  | "premium_collected"
  | "commission_earned"
  | "clawback"
  | "net_due";

// A date column comes back from the driver as a Date at midnight UTC; a business date is printed
// as the calendar day it stands for.
function calendarDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Which statement lines each total is made of, and what the total means. Everything a broker
// statement prints is the movement of a ledger account that was posted when the money moved: no
// total on this page multiplies a rate by anything.
export function explainStatementTotal(input: {
  lines: StatementLineForExplanation[];
  key: StatementTotalKey;
  commissionEarnedCents: number;
  clawbackCents: number;
  adjustmentCents: number;
  netDueCents: number;
}): AmountExplanation {
  if (input.key === "net_due") {
    return {
      lines: [
        {
          key: "commission_earned",
          label: "Commission earned in the month",
          formula: `${input.commissionEarnedCents}`,
          cents: input.commissionEarnedCents,
        },
        {
          key: "clawback",
          label: "Commission clawed back on refunded premium",
          formula: `-${input.clawbackCents}`,
          cents: -input.clawbackCents,
        },
        {
          key: "adjustment",
          label: "Other movements of this broker's commission payable",
          formula: `${input.adjustmentCents}`,
          cents: input.adjustmentCents,
        },
        {
          key: "net_due",
          label: "Net due to the broker",
          formula: `${input.commissionEarnedCents} - ${input.clawbackCents} + ${input.adjustmentCents}`,
          cents: input.commissionEarnedCents - input.clawbackCents + input.adjustmentCents,
        },
      ],
      resultKey: "net_due",
      rounding: NOTHING_ROUNDED,
      note: "Net due IS the movement of this broker's commission payable account for the month, to the cent: the page checks it against a second, independent read of the journal.",
    };
  }

  // Every other total is a sum of stored statement lines. `key` is taken out of `input` here so
  // that the type says what the guard above already proved: net due is behind us.
  const key = input.key;
  const contributing = input.lines.filter((line) => contributesTo(line, key));
  const lines: FormulaLine[] = contributing.map((line, position) => ({
    key: `line_${position}`,
    label: `${line.policyNumber ?? "no policy"}, effective ${calendarDay(line.effectiveAt)}, entry ${line.journalEntryId.slice(0, 8)}`,
    formula: line.description,
    cents: amountOnStatementLine(line, key),
  }));
  const total = lines.reduce((sum, line) => sum + line.cents, 0);
  lines.push({
    key: "total",
    label: TOTAL_LABEL[key],
    formula: lines.length === 0 ? "no line of this kind this month" : lines.map((line) => line.cents).join(" + "),
    cents: total,
  });
  return {
    lines,
    resultKey: "total",
    rounding: key === "commission_earned" || key === "clawback" ? ROUNDED_DOWN_COMMISSION : NOTHING_ROUNDED,
    note: NOTE[key],
    evidence: contributing.map((line) => ({
      entryType: line.kind,
      effectiveAt: calendarDay(line.effectiveAt),
      recordedAt: line.entryRecordedAt,
      detail: `entry ${line.journalEntryId.slice(0, 8)}, ${line.description}`,
    })),
  };
}

const TOTAL_LABEL: Record<Exclude<StatementTotalKey, "net_due">, string> = {
  cash_collected: "Cash collected from customers in the month",
  premium_collected: "Premium collected in the month, the commission base",
  commission_earned: "Commission earned in the month",
  clawback: "Commission clawed back in the month, as a negative movement of what the broker is owed",
};

const NOTE: Record<Exclude<StatementTotalKey, "net_due">, string> = {
  cash_collected:
    "The cash side of every collection entry: premium, state premium tax and policy fee together. Refunds are not netted into it; they are on their own lines.",
  premium_collected:
    "The premium part of that same cash, read from the unearned premium written by the same payment. Commission is earned on this figure alone, never on tax or fee.",
  commission_earned:
    "Each line is the commission the ledger posted when the money was collected: floor(premium x rate / 10000). The statement adds whole cents and never multiplies a rate itself.",
  clawback:
    "Each line is the clawback the ledger posted when a refund completed: floor(refunded premium x rate / 10000), taken back from the broker.",
};

function contributesTo(line: StatementLineForExplanation, key: Exclude<StatementTotalKey, "net_due">): boolean {
  if (key === "cash_collected" || key === "premium_collected") return line.kind === "premium_collected";
  if (key === "commission_earned") return line.kind === "commission_earned";
  return line.kind === "clawback";
}

function amountOnStatementLine(
  line: StatementLineForExplanation,
  key: Exclude<StatementTotalKey, "net_due">,
): number {
  if (key === "premium_collected") return line.commissionBaseCents ?? 0;
  // A clawback line is already negative in the store (it reduces what the broker is owed), and the
  // screen prints it negative too, so it is carried through as it is.
  return line.amountCents;
}

// The commission a rate would give on an amount, for a screen that wants to show the
// multiplication beside a stored figure. It calls the same function the ledger posted with.
export function commissionOnPremiumCents(premiumCents: number, commissionRateBps: number): number {
  return commissionCents(premiumCents, commissionRateBps);
}
