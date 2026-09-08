import { commissionCents } from "../money/premium";
import type { JournalEntryDraft, JournalLineDraft } from "./post";

// The four entries posted when a policy is issued and its first payment is collected.
// Pure: it builds the drafts, it does not write them (lib/ledger/post.ts does) and it does not
// read the database. That is what makes the amounts testable line by line.
//
// Worked example, the recited one (DECISIONS.md): $1,200 annual premium, California premium
// tax 235 bps = 2820 cents, flat fee 2500 cents, broker commission 15%, policy effective
// 2028-03-01, paid the same day.
//
//   premium_written      Dr premium_receivable  120000   Cr unearned_premium     120000
//   tax_and_fee_billed   Dr premium_receivable    5320   Cr premium_tax_payable    2820
//                                                        Cr fee_income             2500
//   premium_collected    Dr cash_stripe         125320   Cr premium_receivable   125320
//   commission_earned    Dr commission_expense   18000   Cr commission_payable    18000
//
// After the four, premium_receivable is back to zero (120000 + 5320 collected as 125320),
// the unearned premium liability holds the whole written premium, the tax owed to California
// is separated from the premium, and the fee is income straight away.
//
// Two different business dates on purpose:
//   - premium_written and tax_and_fee_billed carry the policy effective date: that is when
//     coverage starts and when the premium is written;
//   - premium_collected and commission_earned carry the date the money actually arrived at
//     Stripe: cash entries carry the date the cash moved, and the broker's commission is
//     earned on collected premium (Yoann's rule, DECISIONS.md).
// When a customer pays in advance of the effective date, premium_receivable is temporarily
// negative in an as-of view: that is the customer's credit balance, and it clears when
// coverage starts. recorded_at (set by the database) shows that all four were booked together.

export type IssuanceCollectionInput = {
  operationId: string; // money_operations.id: the key every entry is filed under
  policyId: string;
  policyNumber: string;
  brokerId: string;
  effectiveAt: string; // policy term start, "YYYY-MM-DD"
  paymentDate: string; // date the payment succeeded at Stripe, "YYYY-MM-DD"
  annualPremiumCents: number;
  taxCents: number;
  feeCents: number;
  commissionRateBps: number;
};

export function issuanceAndCollectionEntries(input: IssuanceCollectionInput): JournalEntryDraft[] {
  const { annualPremiumCents, taxCents, feeCents } = input;
  const totalChargeCents = annualPremiumCents + taxCents + feeCents;
  // Commission is earned on the premium actually collected, tax and fee excluded.
  const brokerCommissionCents = commissionCents(annualPremiumCents, input.commissionRateBps);

  const sourceKind = "money_operation" as const;
  const commonHeader = {
    policyId: input.policyId,
    brokerId: input.brokerId,
    sourceKind,
    sourceId: input.operationId,
    createdBy: null, // caused by a Stripe event, not by a person clicking
  };

  const entries: JournalEntryDraft[] = [
    {
      header: {
        ...commonHeader,
        entryType: "premium_written",
        effectiveAt: input.effectiveAt,
        description: `Policy ${input.policyNumber} written premium`,
      },
      lines: [
        { accountId: "premium_receivable", debitCents: annualPremiumCents },
        { accountId: "unearned_premium", creditCents: annualPremiumCents },
      ],
    },
  ];

  // Tax and fee are billed on the same charge as the premium but never mixed into it.
  const taxAndFeeCents = taxCents + feeCents;
  if (taxAndFeeCents > 0) {
    const taxAndFeeLines: JournalLineDraft[] = [{ accountId: "premium_receivable", debitCents: taxAndFeeCents }];
    if (taxCents > 0) {
      taxAndFeeLines.push({ accountId: "premium_tax_payable", creditCents: taxCents });
    }
    if (feeCents > 0) {
      taxAndFeeLines.push({ accountId: "fee_income", creditCents: feeCents });
    }
    entries.push({
      header: {
        ...commonHeader,
        entryType: "tax_and_fee_billed",
        effectiveAt: input.effectiveAt,
        description: `Policy ${input.policyNumber} state premium tax and policy fee`,
      },
      lines: taxAndFeeLines,
    });
  }

  entries.push({
    header: {
      ...commonHeader,
      entryType: "premium_collected",
      effectiveAt: input.paymentDate,
      description: `Policy ${input.policyNumber} premium, tax and fee collected at Stripe`,
    },
    lines: [
      { accountId: "cash_stripe", debitCents: totalChargeCents },
      { accountId: "premium_receivable", creditCents: totalChargeCents },
    ],
  });

  if (brokerCommissionCents > 0) {
    entries.push({
      header: {
        ...commonHeader,
        entryType: "commission_earned",
        effectiveAt: input.paymentDate,
        description: `Broker commission on the collected premium of policy ${input.policyNumber}`,
      },
      lines: [
        { accountId: "commission_expense", debitCents: brokerCommissionCents },
        { accountId: "commission_payable", creditCents: brokerCommissionCents },
      ],
    });
  }

  return entries;
}

// Sums both sides of a draft. Used by the tests, and by nothing else: in production the
// database's deferred trigger is the guard that an entry balances.
export function entryTotals(draft: JournalEntryDraft): { debitCents: number; creditCents: number } {
  let debitCents = 0;
  let creditCents = 0;
  for (const line of draft.lines) {
    debitCents += line.debitCents ?? 0;
    creditCents += line.creditCents ?? 0;
  }
  return { debitCents, creditCents };
}
