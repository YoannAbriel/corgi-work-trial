import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEndorsement, endorsementFormulaLines, type EndorsementInput } from "./endorsement";
import {
  accountSumCents,
  cancellationFormulaLines,
  explainAccountSum,
  explainCancellationFigure,
  explainClaimIncurred,
  explainPolicyFee,
  explainStateTax,
  explainStatementTotal,
  explainTotalCharge,
  explainedCents,
  type AmountExplanation,
  type JournalEntryForExplanation,
  type StatementLineForExplanation,
} from "./explain";
import { cancellationBreakdown } from "./premium";

// THE ONE PROPERTY EVERY TEST BELOW CHECKS: an explanation ends on the figure it sits under.
// A fold that disagreed with the amount printed above it would be worse than no fold at all, so
// each case computes the figure the way the application computes it, builds the explanation, and
// asserts that the two are the same integer number of cents.
function assertExplains(explanation: AmountExplanation, figureCents: number): void {
  assert.equal(explainedCents(explanation), figureCents);
}

// The recited example (DECISIONS.md, decided by Yoann): $1,200 annual premium written
// 2028-03-01, 365-day term, California 2.35%, $25 fee, 15% commission.

test("the tax explanation ends on the tax the policy charged: floor(120000 x 235 / 10000) = 2820", () => {
  const explanation = explainStateTax({ stateCode: "CA", annualPremiumCents: 120000, taxRateBps: 235 });
  assertExplains(explanation, 2820);
  const taxLine = explanation.lines.find((line) => line.key === "tax");
  assert.equal(taxLine?.formula, "floor(120000 x 235 / 10000)");
  assert.match(explanation.rounding ?? "", /Rounded down/);
});

test("the tax explanation follows a different rate and premium, so it can never be a fixed sentence", () => {
  // A policy in another state, at a rate that rounds: floor(99999 x 175 / 10000) = 1749.98 -> 1749.
  assertExplains(explainStateTax({ stateCode: "TX", annualPremiumCents: 99999, taxRateBps: 175 }), 1749);
});

test("the fee explanation is the flat fee itself, and nothing is rounded", () => {
  const explanation = explainPolicyFee({ feeCents: 2500 });
  assertExplains(explanation, 2500);
  assert.equal(explanation.rounding, null);
});

test("the total explanation adds premium, tax and fee: 120000 + 2820 + 2500 = 125320", () => {
  assertExplains(
    explainTotalCharge({ stateCode: "CA", annualPremiumCents: 120000, taxCents: 2820, feeCents: 2500 }),
    125320,
  );
});

// ---------------------------------------------------------------------------
// The endorsement delta: the lines the endorsement itself already produces
// ---------------------------------------------------------------------------

const RECITED_ENDORSEMENT: EndorsementInput = {
  policyId: "22222222-2222-4222-8222-222222222222",
  policyVersion: 2,
  termStart: "2028-03-01",
  termEnd: "2029-03-01",
  effectiveAt: "2028-06-09", // day 100, 265 days remain
  oldAnnualPremiumCents: 120000,
  newAnnualPremiumCents: 180000,
  taxRateBps: 235,
  taxChargedSoFarCents: 2820,
  commissionRateBps: 1500,
};

test("the endorsement delta explanation ends on the delta the ledger booked: 44584 cents", () => {
  const figures = computeEndorsement(RECITED_ENDORSEMENT);
  // The fold reuses the lines the endorsement already produces; it points at the total line.
  const explanation: AmountExplanation = {
    lines: endorsementFormulaLines(figures),
    resultKey: "delta_total",
    rounding: null,
  };
  assertExplains(explanation, figures.deltaTotalCents);
  assert.equal(figures.deltaTotalCents, 44584); // 43561 premium + 1023 tax
  const premiumLine = explanation.lines.find((line) => line.key === "delta_premium");
  assert.equal(premiumLine?.formula, "floor(60000 x 265 / 365)");
  assert.match(premiumLine?.label ?? "", /265 of 365 days remain from 2028-06-09/);
});

test("the endorsement delta explanation follows a refund too, sign included", () => {
  const figures = computeEndorsement({ ...RECITED_ENDORSEMENT, newAnnualPremiumCents: 60000 });
  const explanation: AmountExplanation = {
    lines: endorsementFormulaLines(figures),
    resultKey: "delta_total",
    rounding: null,
  };
  assertExplains(explanation, figures.deltaTotalCents);
  assert.equal(figures.deltaTotalCents, -44586); // -43562 premium, -1024 tax
});

// ---------------------------------------------------------------------------
// The cancellation panel: seven figures, one table of lines
// ---------------------------------------------------------------------------

test("every cancellation fold ends on the figure it sits under", () => {
  const breakdown = cancellationBreakdown({
    writtenPremiumSegments: [{ writtenPremiumCents: 120000, startsOn: "2028-03-01", endsOn: "2029-03-01" }],
    taxChargedCents: 2820,
    taxRateBps: 235,
    commissionRateBps: 1500,
    cancellationEffectiveAt: "2028-06-09",
  });
  const figures = { ...breakdown, effectiveAt: "2028-06-09", taxRateBps: 235, commissionRateBps: 1500 };

  // The recited figures, so a wrong breakdown fails here before the folds are even looked at.
  assert.equal(figures.earnedPremiumCents, 32876);
  assert.equal(figures.unearnedPremiumCents, 87124);
  assert.equal(figures.refundedTaxCents, 2048);
  assert.equal(figures.totalRefundCents, 89172);
  assert.equal(figures.commissionClawbackCents, 13068);

  assertExplains(explainCancellationFigure(figures, "written_premium"), figures.writtenPremiumCents);
  assertExplains(explainCancellationFigure(figures, "earned_premium"), figures.earnedPremiumCents);
  assertExplains(explainCancellationFigure(figures, "unearned_premium"), figures.unearnedPremiumCents);
  assertExplains(explainCancellationFigure(figures, "refunded_tax"), figures.refundedTaxCents);
  assertExplains(explainCancellationFigure(figures, "refunded_fee"), figures.refundedFeeCents);
  assertExplains(explainCancellationFigure(figures, "total_refund"), figures.totalRefundCents);
  assertExplains(explainCancellationFigure(figures, "commission_clawback"), figures.commissionClawbackCents);

  // The lines add up the way the panel reads them.
  const lines = cancellationFormulaLines(figures);
  const earned = lines.find((line) => line.key === "earned_premium")?.cents ?? 0;
  const unearned = lines.find((line) => line.key === "unearned_premium")?.cents ?? 0;
  assert.equal(earned + unearned, figures.writtenPremiumCents);
});

// ---------------------------------------------------------------------------
// A claim: incurred = paid + reserve
// ---------------------------------------------------------------------------

test("the incurred fold ends on paid plus reserve", () => {
  const explanation = explainClaimIncurred({
    paidCents: 120000,
    reserveCents: 380000,
    incurredCents: 500000,
    settledCents: 120000,
  });
  assertExplains(explanation, 500000);
});

// ---------------------------------------------------------------------------
// A sum of journal lines: the screen and its fold call the same function
// ---------------------------------------------------------------------------

const JOURNAL: JournalEntryForExplanation[] = [
  {
    entryType: "premium_collected",
    effectiveAt: "2028-03-01",
    recordedAt: new Date("2028-03-01T10:00:00.000Z"),
    lines: [
      { accountId: "cash_stripe", accountName: "cash_stripe", debitCents: 125320, creditCents: 0 },
      { accountId: "premium_receivable", accountName: "premium_receivable", debitCents: 0, creditCents: 125320 },
    ],
  },
  {
    entryType: "refund_completed",
    effectiveAt: "2028-06-09",
    recordedAt: new Date("2028-06-09T11:00:00.000Z"),
    lines: [
      { accountId: "refund_payable", accountName: "refund_payable", debitCents: 89172, creditCents: 0 },
      { accountId: "cash_stripe", accountName: "cash_stripe", debitCents: 0, creditCents: 89172 },
    ],
  },
];

test("the ledger sum and its fold are the same number, because they call the same function", () => {
  const collected = accountSumCents(JOURNAL, "cash_stripe", "debits");
  const refunded = accountSumCents(JOURNAL, "cash_stripe", "credits");
  assert.equal(collected, 125320);
  assert.equal(refunded, 89172);

  assertExplains(
    explainAccountSum({ entries: JOURNAL, accountId: "cash_stripe", rule: "debits", totalLabel: "Collected" }),
    collected,
  );
  assertExplains(
    explainAccountSum({ entries: JOURNAL, accountId: "cash_stripe", rule: "credits", totalLabel: "Refunded" }),
    refunded,
  );
});

test("an account with no line yet explains a zero instead of pretending there is nothing to say", () => {
  const explanation = explainAccountSum({
    entries: JOURNAL,
    accountId: "claim_reserve",
    rule: "credits_minus_debits",
    totalLabel: "Reserve",
  });
  assertExplains(explanation, 0);
  assert.equal(explanation.lines.length, 1); // the total alone
  assert.equal(explanation.evidence?.length, 0);
});

// ---------------------------------------------------------------------------
// A broker statement total
// ---------------------------------------------------------------------------

const STATEMENT_LINES: StatementLineForExplanation[] = [
  {
    kind: "premium_collected",
    journalEntryId: "aaaaaaaa-1111-4111-8111-111111111111",
    policyNumber: "CGP-01234",
    effectiveAt: new Date("2028-03-01T00:00:00.000Z"),
    entryRecordedAt: new Date("2028-03-01T10:00:00.000Z"),
    amountCents: 125320,
    commissionBaseCents: 120000,
    description: "premium collected",
  },
  {
    kind: "commission_earned",
    journalEntryId: "bbbbbbbb-2222-4222-8222-222222222222",
    policyNumber: "CGP-01234",
    effectiveAt: new Date("2028-03-01T00:00:00.000Z"),
    entryRecordedAt: new Date("2028-03-01T10:00:00.000Z"),
    amountCents: 18000,
    commissionBaseCents: null,
    description: "commission earned",
  },
  {
    kind: "clawback",
    journalEntryId: "cccccccc-3333-4333-8333-333333333333",
    policyNumber: "CGP-01234",
    effectiveAt: new Date("2028-03-20T00:00:00.000Z"),
    entryRecordedAt: new Date("2028-03-20T10:00:00.000Z"),
    amountCents: -13068,
    commissionBaseCents: null,
    description: "commission clawback",
  },
];

test("each statement total ends on the figure the run stored", () => {
  const totals = {
    lines: STATEMENT_LINES,
    commissionEarnedCents: 18000,
    clawbackCents: 13068, // stored positive: "how much was clawed back"
    adjustmentCents: 0,
    netDueCents: 4932,
  };
  assertExplains(explainStatementTotal({ ...totals, key: "cash_collected" }), 125320);
  assertExplains(explainStatementTotal({ ...totals, key: "premium_collected" }), 120000);
  assertExplains(explainStatementTotal({ ...totals, key: "commission_earned" }), 18000);
  // The screen prints the clawback as a negative movement, which is what the fold ends on.
  assertExplains(explainStatementTotal({ ...totals, key: "clawback" }), -13068);
  assertExplains(explainStatementTotal({ ...totals, key: "net_due" }), 4932);
});

test("the commission fold names the rounding rule the ledger posted with", () => {
  const explanation = explainStatementTotal({
    lines: STATEMENT_LINES,
    key: "commission_earned",
    commissionEarnedCents: 18000,
    clawbackCents: 13068,
    adjustmentCents: 0,
    netDueCents: 4932,
  });
  assert.match(explanation.rounding ?? "", /Rounded down/);
  assert.match(explanation.note ?? "", /floor\(premium x rate \/ 10000\)/);
});
