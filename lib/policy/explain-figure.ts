import type postgres from "postgres";
import { sql } from "@/db/client";
import { endorsementFormulaLines, type FiguresRecheck } from "@/lib/money/endorsement";
import {
  accountSumCents,
  evidenceFromJournal,
  explainAccountSum,
  explainCancellationFigure,
  explainPolicyFee,
  explainStateTax,
  explainTotalCharge,
  explanationResultLine,
  type AmountExplanation,
  type CancellationFigureKey,
} from "@/lib/money/explain";
import { endorsementScheduleOfPolicy } from "./endorsement-read";
import { policyAsItStoodOn } from "./correction-read";
import {
  cancellationOfPolicy,
  journalEntriesOfPolicy,
  policyDetail,
  type JournalEntryView,
  type PolicyDetail,
} from "./read";
import { termsInForceOn } from "./terms-in-force";

// One figure of one policy, explained: the fold the policy screen renders, without the screen.
//
// WHY THIS FILE EXISTS (slice B13-16, decision 29: the MCP tool explain_amount). The explanation
// under a figure on /policies/{id} is built by the page from lib/money/explain.ts. An agent asking
// "where does this $28.20 come from" must get THE SAME lines, and the only way to promise that
// is to call the same functions with the same arguments rather than write a second explanation
// for machines. So this module composes, once, what the page composes inline:
//
//   the terms in force on a date   policyAsItStoodOn -> termsInForceOn, then explainStateTax,
//                                  explainPolicyFee, explainTotalCharge;
//   the four ledger sums           journalEntriesOfPolicy, the reversed pairs left out, then
//                                  accountSumCents and explainAccountSum;
//   the seven cancellation figures explainCancellationFigure over the stored cancellation event;
//   the prorated endorsement delta the formula lines stored on the endorsement event.
//
// NOTHING HERE COMPUTES MONEY. Every `amountCents` below is read from a stored figure or from
// the same summing function the screen calls, and every explanation comes from lib/money. The
// caller is told, per figure, whether the explanation ends on it (`endsOnTheFigure`), which is
// the check components/amount-explained.tsx prints on every render: a disagreement is reported,
// never hidden.
//
// KNOWN LIMIT, said out loud: the page builds the endorsement fold inline in its own JSX, so the
// wording of that one explanation is copied here rather than shared. The FIGURES and the LINES
// are the stored ones either way (endorsementFormulaLines over the endorsement event), so the
// two can differ in a sentence and never in a cent.

// The closed list of figures this module can explain, in the order a reader meets them on the
// policy page. `what` is what the tool description and the tools/list annotation publish, so an
// agent never has to guess a key.
export type PolicyFigureKey =
  | "premium_tax"
  | "policy_fee"
  | "total_charge"
  | "collected_at_stripe"
  | "refunded_from_stripe"
  | "commission_payable"
  | "unearned_premium_held"
  | "endorsement_delta"
  | "cancellation_written_premium"
  | "cancellation_earned_premium"
  | "cancellation_unearned_premium"
  | "cancellation_refunded_tax"
  | "cancellation_refunded_fee"
  | "cancellation_total_refund"
  | "cancellation_commission_clawback";

export const POLICY_FIGURE_KEYS: { key: PolicyFigureKey; what: string }[] = [
  { key: "premium_tax", what: "state premium tax on the annual premium in force on the date asked for" },
  { key: "policy_fee", what: "the flat policy fee, charged once at issuance" },
  { key: "total_charge", what: "what a full annual term at the terms in force costs the customer" },
  { key: "collected_at_stripe", what: "money that arrived on the Stripe cash account for this policy" },
  { key: "refunded_from_stripe", what: "money that left the Stripe cash account for this policy" },
  { key: "commission_payable", what: "the balance of this broker's commission payable on this policy" },
  { key: "unearned_premium_held", what: "the balance of unearned premium on this policy" },
  { key: "endorsement_delta", what: "the prorated delta of the latest endorsement applied to this policy" },
  { key: "cancellation_written_premium", what: "written premium, at cancellation" },
  { key: "cancellation_earned_premium", what: "premium earned up to the cancellation date, kept by the insurer" },
  { key: "cancellation_unearned_premium", what: "unearned premium given back to the customer" },
  { key: "cancellation_refunded_tax", what: "premium tax given back with the refunded premium" },
  { key: "cancellation_refunded_fee", what: "policy fee given back (none: it is earned at issuance)" },
  { key: "cancellation_total_refund", what: "total refunded to the customer through Stripe" },
  { key: "cancellation_commission_clawback", what: "broker commission clawed back on the refunded premium" },
];

export function isPolicyFigureKey(candidate: string): candidate is PolicyFigureKey {
  return POLICY_FIGURE_KEYS.some((figure) => figure.key === candidate);
}

// The figure exists on this build, but not on THIS policy: no cancellation, no endorsement, or a
// policy that cannot be rebuilt on the date asked for. It is a sentence a caller can act on, not
// a failure, so it carries its own class.
export class FigureNotOnThisPolicy extends Error {}

// What each branch below produces. The agreement check is added once, by explainPolicyFigure,
// so no branch can forget it.
type FigureWithoutItsCheck = Omit<ExplainedFigure, "endsOnTheFigure">;

export type ExplainedFigure = {
  key: PolicyFigureKey;
  // What the screen calls this figure, so an answer can be read next to the screen.
  label: string;
  amountCents: number;
  explanation: AmountExplanation;
  // The business date the figure is in force on, for the three figures that depend on one; null
  // for a ledger sum, a cancellation figure and an endorsement delta, which are events.
  asOf: string | null;
  // The check components/amount-explained.tsx makes on every render: the explanation has to end
  // on the figure it explains. False is a real answer and is reported, never silently dropped.
  endsOnTheFigure: boolean;
  // The endorsement fold's second check: the stored figures priced again from the inputs stored
  // beside them (review finding F-INT-05). Null on every fold that computes its own result line.
  recheck: FiguresRecheck | null;
};

export async function explainPolicyFigure(input: {
  policyId: string;
  key: PolicyFigureKey;
  // The date the "terms in force" figures are asked for. Null means the same default the policy
  // page uses: today, or the term start when the term has not begun yet.
  asOf: string | null;
  today: string;
  database?: postgres.Sql;
}): Promise<ExplainedFigure> {
  const database = input.database ?? sql;
  const policy = await policyDetail(input.policyId, database);
  if (!policy) {
    throw new FigureNotOnThisPolicy("this policy does not exist");
  }
  const figure = await figureOf(database, policy, input.key, input.asOf, input.today);
  // THE CHECK THAT MAKES THE ANSWER WORTH TRUSTING, asked here for every figure and never
  // assumed: the explanation has to end on the figure it explains. The screen prints an alert
  // when it does not (components/amount-explained.tsx); the caller is told in a field.
  const resultLine = explanationResultLine(figure.explanation);
  return { ...figure, endsOnTheFigure: resultLine !== null && resultLine.cents === figure.amountCents };
}

async function figureOf(
  database: postgres.Sql,
  policy: PolicyDetail,
  key: PolicyFigureKey,
  asOf: string | null,
  today: string,
): Promise<FigureWithoutItsCheck> {
  if (key === "premium_tax" || key === "policy_fee" || key === "total_charge") {
    return termsFigure(database, policy, key, asOf, today);
  }
  if (
    key === "collected_at_stripe" ||
    key === "refunded_from_stripe" ||
    key === "commission_payable" ||
    key === "unearned_premium_held"
  ) {
    return ledgerFigure(await journalEntriesOfPolicy(policy.policyId, database), key);
  }
  if (key === "endorsement_delta") {
    return endorsementFigure(database, policy.policyId);
  }
  return cancellationFigure(database, policy.policyId, key);
}

// ---------------------------------------------------------------------------
// The terms in force on a date
// ---------------------------------------------------------------------------

async function termsFigure(
  database: postgres.Sql,
  policy: PolicyDetail,
  key: "premium_tax" | "policy_fee" | "total_charge",
  asOf: string | null,
  today: string,
): Promise<FigureWithoutItsCheck> {
  const policyId = policy.policyId;
  const stateCode = policy.stateCode;
  // The policy page's own default: a policy whose term has not begun is shown on its term start,
  // because a date field cannot start on a date it would refuse (findings F-B8-07, F-B8-09).
  const onDate = asOf ?? (today > policy.effectiveAt ? today : policy.effectiveAt);
  const asOfResult = await policyAsItStoodOn(policyId, onDate, database);
  const terms = termsInForceOn(policy, asOfResult);
  if (terms.onDate === null) {
    // The screen falls back to the figures on the policy record and says so in a paragraph. An
    // agent gets the refusal instead: a figure with no date attached is exactly what a machine
    // reader would go on to quote as "the premium tax".
    const reason = "error" in asOfResult ? asOfResult.error : "no answer";
    throw new FigureNotOnThisPolicy(`this policy cannot be rebuilt on that date, so it has no terms in force: ${reason}`);
  }
  const inForceOn = terms.onDate;

  const entries = await journalEntriesOfPolicy(policyId, database);
  // Only the entries effective on or before the date: a future-dated endorsement's tax is not
  // part of today's figure (review finding F-B12-10).
  const entriesByThen = entries.filter((entry) => entry.effectiveAt <= inForceOn);

  if (key === "premium_tax") {
    return {
      key,
      label: `${stateCode} premium tax on the annual premium in force on ${inForceOn}`,
      amountCents: terms.taxCents,
      explanation: {
        ...explainStateTax({
          stateCode,
          annualPremiumCents: terms.annualPremiumCents,
          taxRateBps: terms.taxRateBps,
          evidence: evidenceFromJournal(entriesByThen, "premium_tax_payable"),
        }),
        evidenceLabel:
          "The premium tax entries booked on this policy so far (issuance, and any endorsement or cancellation). They are what was charged over time; the figure above is the tax on the annual premium in force on this date.",
      },
      asOf: inForceOn,
      recheck: null,
    };
  }
  if (key === "policy_fee") {
    return {
      key,
      label: "Flat policy fee",
      amountCents: terms.feeCents,
      explanation: explainPolicyFee({
        feeCents: terms.feeCents,
        evidence: evidenceFromJournal(entriesByThen, "fee_income"),
      }),
      asOf: inForceOn,
      recheck: null,
    };
  }
  return {
    key,
    label: `What a full annual term at the terms in force on ${inForceOn} costs the customer`,
    amountCents: terms.totalChargeCents,
    explanation: explainTotalCharge({
      stateCode,
      annualPremiumCents: terms.annualPremiumCents,
      taxCents: terms.taxCents,
      feeCents: terms.feeCents,
    }),
    asOf: inForceOn,
    recheck: null,
  };
}

// ---------------------------------------------------------------------------
// The four ledger sums
// ---------------------------------------------------------------------------

// Which account each ledger figure sums, and how, exactly as the policy page's side panel does
// it (ledgerSoFar and the four folds beside it).
const LEDGER_FIGURES: Record<
  "collected_at_stripe" | "refunded_from_stripe" | "commission_payable" | "unearned_premium_held",
  { accountId: string; rule: "debits" | "credits" | "credits_minus_debits"; label: string; totalLabel: string; note: string }
> = {
  collected_at_stripe: {
    accountId: "cash_stripe",
    rule: "debits",
    label: "Money that arrived on the Stripe cash account for this policy",
    totalLabel: "Collected at Stripe, all debits added",
    note: "Every debit of cash_stripe on this policy that a correction has not reversed: the premium collection and any endorsement or correction difference the customer paid.",
  },
  refunded_from_stripe: {
    accountId: "cash_stripe",
    rule: "credits",
    label: "Money that left the Stripe cash account for this policy",
    totalLabel: "Refunded from Stripe, all credits added",
    note: "Every credit of cash_stripe on this policy that is not the mirror of a reversed entry. A refund appears here only once Stripe's webhook confirms the money left.",
  },
  commission_payable: {
    accountId: "commission_payable",
    rule: "credits_minus_debits",
    label: "Balance of this broker's commission payable on this policy",
    totalLabel: "Commission payable, credits minus debits",
    note: "Commission earned when premium was collected, less every clawback on premium given back. Entries a correction reversed, and their mirrors, are left out.",
  },
  unearned_premium_held: {
    accountId: "unearned_premium",
    rule: "credits_minus_debits",
    label: "Balance of unearned premium on this policy",
    totalLabel: "Unearned premium, credits minus debits",
    note: "Premium written and not yet earned: what would be owed back if the policy stopped today. Entries a correction reversed, and their mirrors, are left out.",
  },
};

function ledgerFigure(
  entries: JournalEntryView[],
  key: "collected_at_stripe" | "refunded_from_stripe" | "commission_payable" | "unearned_premium_held",
): FigureWithoutItsCheck {
  // The same list the page's four sums add up: an entry a correction reversed and the reversal
  // that mirrors it cancel each other out, so both are left out of the summary (UI-022).
  const standing = entries.filter((entry) => !entry.reversesEntryId && !entry.isReversedByACorrection);
  const figure = LEDGER_FIGURES[key];
  return {
    key,
    label: figure.label,
    amountCents: accountSumCents(standing, figure.accountId, figure.rule),
    explanation: explainAccountSum({
      entries: standing,
      accountId: figure.accountId,
      rule: figure.rule,
      totalLabel: figure.totalLabel,
      note: figure.note,
    }),
    asOf: null,
    recheck: null,
  };
}

// ---------------------------------------------------------------------------
// The seven cancellation figures
// ---------------------------------------------------------------------------

// The tool's key, the key of the line inside the shared cancellation table, and the account whose
// entries the page shows as evidence under that figure (nothing for the four that have none).
const CANCELLATION_FIGURES: Record<
  string,
  { figureKey: CancellationFigureKey; label: string; evidenceAccountId: string | null; evidenceLabel: string | null }
> = {
  cancellation_written_premium: {
    figureKey: "written_premium",
    label: "Written premium on this policy",
    evidenceAccountId: null,
    evidenceLabel: null,
  },
  cancellation_earned_premium: {
    figureKey: "earned_premium",
    label: "Premium earned up to the cancellation date",
    evidenceAccountId: "earned_premium",
    evidenceLabel: "The entries that moved premium from unearned to earned.",
  },
  cancellation_unearned_premium: {
    figureKey: "unearned_premium",
    label: "Unearned premium given back to the customer",
    evidenceAccountId: null,
    evidenceLabel: null,
  },
  cancellation_refunded_tax: {
    figureKey: "refunded_tax",
    label: "Premium tax given back with the refunded premium",
    evidenceAccountId: null,
    evidenceLabel: null,
  },
  cancellation_refunded_fee: {
    figureKey: "refunded_fee",
    label: "Policy fee given back",
    evidenceAccountId: null,
    evidenceLabel: null,
  },
  cancellation_total_refund: {
    figureKey: "total_refund",
    label: "Total refunded to the customer through Stripe",
    evidenceAccountId: "refund_payable",
    evidenceLabel: "The entries that opened the refund and, once Stripe confirmed it, sent the cash back.",
  },
  cancellation_commission_clawback: {
    figureKey: "commission_clawback",
    label: "Broker commission clawed back on the refunded premium",
    evidenceAccountId: "commission_payable",
    evidenceLabel:
      "Every entry that moved this broker's commission payable on this policy: the commission earned at collection, then the clawback.",
  },
};

async function cancellationFigure(
  database: postgres.Sql,
  policyId: string,
  key: PolicyFigureKey,
): Promise<FigureWithoutItsCheck> {
  const cancellation = await cancellationOfPolicy(policyId, database);
  if (!cancellation) {
    throw new FigureNotOnThisPolicy("this policy has not been cancelled, so it has no cancellation figures to explain");
  }
  const figure = CANCELLATION_FIGURES[key];
  const entries = figure.evidenceAccountId ? await journalEntriesOfPolicy(policyId, database) : [];
  const explanation = explainCancellationFigure(
    cancellation,
    figure.figureKey,
    figure.evidenceAccountId ? evidenceFromJournal(entries, figure.evidenceAccountId) : undefined,
  );
  // The cents beside the figure on the screen: the stored line of the shared table, which is the
  // figure the cancellation event holds.
  const amountCents = explanationResultLine(explanation)?.cents ?? 0;
  return {
    key,
    label: figure.label,
    amountCents,
    explanation: figure.evidenceLabel ? { ...explanation, evidenceLabel: figure.evidenceLabel } : explanation,
    asOf: null,
    recheck: null,
  };
}

// ---------------------------------------------------------------------------
// The prorated endorsement delta
// ---------------------------------------------------------------------------

async function endorsementFigure(database: postgres.Sql, policyId: string): Promise<FigureWithoutItsCheck> {
  const schedule = await endorsementScheduleOfPolicy(policyId, database);
  const row = schedule[schedule.length - 1];
  if (!row) {
    throw new FigureNotOnThisPolicy("this policy carries no endorsement, so it has no prorated delta to explain");
  }
  return {
    key: "endorsement_delta",
    label: `Prorated delta of the endorsement effective ${row.effectiveAt}`,
    amountCents: row.figures.deltaTotalCents,
    explanation: {
      lines: endorsementFormulaLines(row.figures),
      resultKey: "delta_total",
      rounding:
        row.figures.direction === "refund"
          ? "Rounded up (ceil) on the premium given back and its tax: the customer receives this, so the fraction of a cent goes their way. Commission is rounded down."
          : "Rounded down (floor) on the premium charged and its tax: the customer pays this, so the insurer absorbs the fraction of a cent.",
      note: `${row.figures.daysRemaining} of ${row.figures.termDays} days remained from ${row.effectiveAt}. The delta is the money that moved, not the change in the annual premium.`,
      evidence: row.stripeReferences.map((reference) => ({
        entryType: "Stripe reference",
        effectiveAt: row.effectiveAt,
        recordedAt: row.recordedAt,
        detail: reference,
      })),
      evidenceLabel:
        "The Stripe references of the money that moved for this endorsement (the journal entries are in the policy journal).",
    },
    asOf: null,
    // The endorsement fold replays stored figures, so comparing its result line with the figure
    // would be a number against itself. This is the comparison that can fail: the endorsement
    // priced again on the server from the inputs stored on its own event (finding F-INT-05).
    recheck: row.recheck,
  };
}
