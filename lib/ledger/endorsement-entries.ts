import type { CollectedFrom } from "./policy-entries";
import type { JournalEntryDraft, JournalLineDraft } from "./post";

// The journal entries of an endorsement.
// Pure: these functions build drafts, they do not write them (lib/ledger/post.ts does), they
// read no database and they call no provider, so every amount is testable line by line and the
// preview can print the same figures before anything happens.
//
// Worked example, the recited one (DECISIONS.md): $1,200 annual premium written 2028-03-01,
// California 2.35%, 15% commission, raised to $1,800 effective 2028-06-09 (day 100 of 365,
// 265 days remain), paid the same day.
//
//   delta premium = floor(60000 x 265 / 365) = 43561     delta tax = floor(43561 x 235 / 10000) = 1023
//   collected     = 43561 + 1023              = 44584     commission = floor(43561 x 1500 / 10000) = 6534
//
// When Stripe confirms the delta was paid, in one transaction with the 'endorsed' event:
//
//   endorsement_premium_written     Dr premium_receivable   43561  Cr unearned_premium      43561
//   endorsement_tax_billed          Dr premium_receivable    1023  Cr premium_tax_payable    1023
//   endorsement_premium_collected   Dr cash_stripe          44584  Cr premium_receivable    44584
//   endorsement_commission_earned   Dr commission_expense    6534  Cr commission_payable     6534
//
// When the delta is paid while the endorsement CANNOT be applied (the broker lost eligibility,
// or a later request superseded the quote), the cash is booked at receipt into the suspense
// account exactly as at issuance (rule 14, DECISIONS.md 12:54Z):
//
//   unapplied_cash_received         Dr cash_stripe          44584  Cr unapplied_customer_cash 44584
//
// and when staff later apply it, endorsement_premium_collected debits unapplied_customer_cash
// instead of cash_stripe, so the money is applied rather than booked twice and the suspense
// balance returns to zero.
//
// The mirror image of the four issuance entries (lib/ledger/policy-entries.ts), minus the fee:
// the flat policy fee is charged at issuance only, never again on an endorsement. Same two
// business dates as at issuance: the premium and its tax are written on the endorsement's
// effective date (the day the extra cover starts), cash and commission on the day the money
// moved. Each endorsement is its own earning segment from its effective date to the term end
// (ARCHITECTURE.md section 3).
//
// Lowering the premium to $600 on the same day is a refund, recorded at once:
//
//   refunded premium = ceil(60000 x 265 / 365) = 43562    tax back = ceil(43562 x 235 / 10000) = 1024
//   refund = 44586                                        clawback = floor(43562 x 1500 / 10000) = 6534
//
//   endorsement_refund_requested    Dr unearned_premium     43562  Cr refund_payable        44586
//                                   Dr premium_tax_payable   1024
//
// The refund completes through the same Stripe refund path as a cancellation
// (lib/payments/refunds.ts posts refund_completed and commission_clawback on the operation),
// and a FAILED refund posts nothing: the customer is still owed the money.

export type EndorsementCollectionInput = {
  operationId: string; // money_operations.id: the key every entry is filed under
  policyId: string;
  policyNumber: string;
  brokerId: string;
  effectiveAt: string; // the endorsement effective date, "YYYY-MM-DD"
  paymentDate: string; // the day the delta was paid at Stripe, "YYYY-MM-DD"
  deltaPremiumCents: number; // positive
  deltaTaxCents: number; // zero or positive
  commissionCents: number; // already computed by lib/money/endorsement.ts, zero or positive
  // Where the cash comes from when the entries are posted. 'cash_stripe' is the ordinary case:
  // the money arrives and the endorsement is applied in the same transaction. When the delta was
  // paid while the endorsement could NOT be applied, the cash was already booked into the
  // suspense account at receipt (rule 14, unappliedCashReceivedEntry), so applying it later
  // debits 'unapplied_customer_cash' instead and the suspense balance returns to zero.
  collectedFrom?: CollectedFrom; // defaults to cash_stripe
};

export function endorsementCollectionEntries(input: EndorsementCollectionInput): JournalEntryDraft[] {
  if (input.deltaPremiumCents <= 0) {
    throw new Error("endorsementCollectionEntries needs a positive delta; a refund or a zero delta is handled elsewhere");
  }
  const collectedCents = input.deltaPremiumCents + input.deltaTaxCents;
  const collectedFrom: CollectedFrom = input.collectedFrom ?? "cash_stripe";

  const commonHeader = {
    policyId: input.policyId,
    brokerId: input.brokerId,
    sourceKind: "money_operation" as const,
    sourceId: input.operationId,
    createdBy: null, // caused by a Stripe event, not by a person clicking
  };

  const entries: JournalEntryDraft[] = [
    {
      header: {
        ...commonHeader,
        entryType: "endorsement_premium_written",
        effectiveAt: input.effectiveAt,
        description: `Policy ${input.policyNumber} additional premium written by the endorsement effective ${input.effectiveAt}`,
      },
      lines: [
        { accountId: "premium_receivable", debitCents: input.deltaPremiumCents },
        { accountId: "unearned_premium", creditCents: input.deltaPremiumCents },
      ],
    },
  ];

  if (input.deltaTaxCents > 0) {
    entries.push({
      header: {
        ...commonHeader,
        entryType: "endorsement_tax_billed",
        effectiveAt: input.effectiveAt,
        description: `Policy ${input.policyNumber} state premium tax on the endorsement premium`,
      },
      lines: [
        { accountId: "premium_receivable", debitCents: input.deltaTaxCents },
        { accountId: "premium_tax_payable", creditCents: input.deltaTaxCents },
      ],
    });
  }

  entries.push({
    header: {
      ...commonHeader,
      entryType: "endorsement_premium_collected",
      effectiveAt: input.paymentDate,
      description:
        collectedFrom === "cash_stripe"
          ? `Policy ${input.policyNumber} endorsement premium and tax collected at Stripe`
          : `Policy ${input.policyNumber} endorsement premium and tax applied from the customer's unapplied cash`,
    },
    lines: [
      { accountId: collectedFrom, debitCents: collectedCents },
      { accountId: "premium_receivable", creditCents: collectedCents },
    ],
  });

  if (input.commissionCents > 0) {
    entries.push({
      header: {
        ...commonHeader,
        entryType: "endorsement_commission_earned",
        effectiveAt: input.paymentDate,
        description: `Broker commission on the endorsement premium collected for policy ${input.policyNumber}`,
      },
      lines: [
        { accountId: "commission_expense", debitCents: input.commissionCents },
        { accountId: "commission_payable", creditCents: input.commissionCents },
      ],
    });
  }

  return entries;
}

// What we owe the customer the moment a premium reduction is applied. One entry per Stripe
// refund, keyed on the refund operation, exactly like refund_requested at cancellation.
export type EndorsementRefundRequestedInput = {
  refundOperationId: string;
  policyId: string;
  policyNumber: string;
  brokerId: string;
  effectiveAt: string; // the endorsement effective date
  refundedPremiumCents: number; // positive
  refundedTaxCents: number; // zero or positive
  createdBy: string | null;
};

export function endorsementRefundRequestedEntry(input: EndorsementRefundRequestedInput): JournalEntryDraft {
  const totalRefundCents = input.refundedPremiumCents + input.refundedTaxCents;
  if (input.refundedPremiumCents <= 0) {
    throw new Error("endorsementRefundRequestedEntry needs a positive refunded premium");
  }

  const lines: JournalLineDraft[] = [
    // The premium the customer no longer pays for leaves the unearned liability: it was never
    // earned and it is going back.
    { accountId: "unearned_premium", debitCents: input.refundedPremiumCents },
  ];
  if (input.refundedTaxCents > 0) {
    // The tax rides back out with the premium, as at cancellation (Cal. Const. art. XIII s. 28(c):
    // the base is gross premiums less return premiums).
    lines.push({ accountId: "premium_tax_payable", debitCents: input.refundedTaxCents });
  }
  lines.push({ accountId: "refund_payable", creditCents: totalRefundCents });

  return {
    header: {
      entryType: "endorsement_refund_requested",
      effectiveAt: input.effectiveAt,
      policyId: input.policyId,
      brokerId: input.brokerId,
      sourceKind: "money_operation",
      sourceId: input.refundOperationId,
      createdBy: input.createdBy,
      description: `Policy ${input.policyNumber} refund owed to the customer after the endorsement effective ${input.effectiveAt}`,
    },
    lines,
  };
}
