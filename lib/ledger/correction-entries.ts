import type { JournalEntryDraft } from "./post";

// The journal entries of a backdated correction: an endorsement that was applied with the wrong
// effective date, put right by reversal and re-booking (AF-03: nothing is ever updated).
//
// Pure: these functions build drafts, they do not write them (lib/ledger/post.ts does), they read
// no database and they call no provider, so every amount is testable line by line and the preview
// can print the same figures before anything happens.
//
// WHY THE CASH NEVER MOVES INSIDE THE CORRECTION ITSELF.
// The customer really did pay, and Stripe really does hold that money. A correction changes what
// we say the money was FOR, never whether it exists. So the two cash entries of the original
// endorsement (endorsement_premium_collected and endorsement_commission_earned) are left exactly
// as they are: reversing them would credit cash_stripe and make the ledger claim that money left
// Stripe, which would be a lie and would break the reconciliation against Stripe's own records.
// Only the two entries that say what the customer was BILLED are reversed and re-booked, and the
// difference between what was billed and what was collected lands in premium_receivable, the
// account whose whole job is "billed and not yet collected". A negative balance there is the
// mirror image: collected and not yet billed, which is money owed back.
//
// Worked example, the recited one (DECISIONS.md). $1,200 annual premium written 2028-03-01,
// California 2.35%, 15% commission, 365-day term, raised to $1,800. The endorsement was entered
// with the effective date 2028-07-09 (day 130, 235 days remaining) and should have been
// 2028-06-09 (day 100, 265 days remaining):
//
//   as booked (wrong)   premium floor(60000 x 235 / 365) = 38630   tax floor(38630 x 235/10000) =  907
//                       collected 39537                            commission floor(38630 x 15%) = 5794
//   corrected (right)   premium floor(60000 x 265 / 365) = 43561   tax floor(43561 x 235/10000) = 1023
//                       owed      44584                            commission on the difference
//
//   difference to collect  44584 - 39537 = 5047, of which premium 4931 and tax 116
//   commission on it       floor(4931 x 15%) = 739
//
// In ONE transaction, at the moment of the correction:
//
//   reversal_of_endorsement_premium_written  Dr unearned_premium    38630  Cr premium_receivable  38630   (effective 2028-07-09)
//   reversal_of_endorsement_tax_billed       Dr premium_tax_payable   907  Cr premium_receivable    907   (effective 2028-07-09)
//   endorsement_premium_written              Dr premium_receivable  43561  Cr unearned_premium    43561   (effective 2028-06-09)
//   endorsement_tax_billed                   Dr premium_receivable   1023  Cr premium_tax_payable  1023   (effective 2028-06-09)
//
// premium_receivable now holds 44584 - 39537 = 5047: the customer owes that much. When the
// difference is paid at Stripe:
//
//   correction_premium_collected  Dr cash_stripe          5047  Cr premium_receivable   5047
//   correction_commission_earned  Dr commission_expense    739  Cr commission_payable    739
//
// The other direction (entered at day 100, corrected to day 130) leaves premium_receivable at
// -5047: we hold 5047 cents of the customer's money that is not premium, so it goes back:
//
//   correction_refund_requested   Dr premium_receivable   5047  Cr refund_payable       5047
//
// and the existing refund path (lib/payments/refunds.ts) posts refund_completed and
// commission_clawback when Stripe says the money left, exactly as after a cancellation.
//
// The re-booked premium and tax carry the SAME entry types as the endorsement that produced them:
// they are the same accounting fact, written on the corrected date. What tells them apart is the
// source (source_kind 'correction' and the id of the correction_rebook event) and the effective
// date. The settlement entries have no equivalent in the endorsement flow, so they get their own
// names: correction_refund_requested, correction_premium_collected, correction_commission_earned.

// ---------------------------------------------------------------------------
// The re-booked endorsement, at the corrected effective date
// ---------------------------------------------------------------------------

export type CorrectionRebookInput = {
  rebookEventId: string; // policy_events.id of the correction_rebook: the key these entries are filed under
  policyId: string;
  policyNumber: string;
  brokerId: string;
  correctedEffectiveAt: string; // "YYYY-MM-DD": the date the endorsement should have carried
  deltaPremiumCents: number; // the corrected prorated premium, positive
  deltaTaxCents: number; // the tax on it, zero or positive
  createdBy: string | null; // the operator who ordered the correction
};

export function correctionRebookEntries(input: CorrectionRebookInput): JournalEntryDraft[] {
  if (input.deltaPremiumCents < 0 || input.deltaTaxCents < 0) {
    throw new Error("a re-booked endorsement charges a positive premium and tax; a reduction is not corrected by this path");
  }

  const commonHeader = {
    policyId: input.policyId,
    brokerId: input.brokerId,
    sourceKind: "correction" as const,
    sourceId: input.rebookEventId,
    createdBy: input.createdBy,
  };

  const entries: JournalEntryDraft[] = [];
  // A correction to the very last day of the term prices no remaining day, so there is nothing
  // to write. An entry with no amount would be an entry with no meaning, and the database
  // refuses a line whose two sides are both zero anyway.
  if (input.deltaPremiumCents > 0) {
    entries.push({
      header: {
        ...commonHeader,
        entryType: "endorsement_premium_written",
        effectiveAt: input.correctedEffectiveAt,
        description: `Policy ${input.policyNumber} additional premium re-booked at the corrected effective date ${input.correctedEffectiveAt}`,
      },
      lines: [
        { accountId: "premium_receivable", debitCents: input.deltaPremiumCents },
        { accountId: "unearned_premium", creditCents: input.deltaPremiumCents },
      ],
    });
  }
  if (input.deltaTaxCents > 0) {
    entries.push({
      header: {
        ...commonHeader,
        entryType: "endorsement_tax_billed",
        effectiveAt: input.correctedEffectiveAt,
        description: `Policy ${input.policyNumber} state premium tax re-booked at the corrected effective date ${input.correctedEffectiveAt}`,
      },
      lines: [
        { accountId: "premium_receivable", debitCents: input.deltaTaxCents },
        { accountId: "premium_tax_payable", creditCents: input.deltaTaxCents },
      ],
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// The difference, when the customer is owed money back
// ---------------------------------------------------------------------------

export type CorrectionRefundRequestedInput = {
  refundOperationId: string; // money_operations.id: the key this entry is filed under
  policyId: string;
  policyNumber: string;
  brokerId: string;
  correctedEffectiveAt: string; // the business date from which the corrected premium applies
  amountCents: number; // what we collected in excess of the corrected bill, positive
  createdBy: string | null;
};

// One entry per Stripe refund, because one Stripe refund is one PaymentIntent and one money
// operation. It takes the money OUT OF premium_receivable, not out of unearned premium: the
// unearned premium is already the corrected figure (the re-book wrote it), and what is being
// given back is the part of the payment that turned out not to be premium at all.
export function correctionRefundRequestedEntry(input: CorrectionRefundRequestedInput): JournalEntryDraft {
  if (input.amountCents <= 0) {
    throw new Error("correctionRefundRequestedEntry needs a positive amount; the caller creates no operation when nothing is owed");
  }
  return {
    header: {
      entryType: "correction_refund_requested",
      effectiveAt: input.correctedEffectiveAt,
      policyId: input.policyId,
      brokerId: input.brokerId,
      sourceKind: "money_operation",
      sourceId: input.refundOperationId,
      createdBy: input.createdBy,
      description: `Policy ${input.policyNumber} overpayment owed back after the endorsement effective date was corrected to ${input.correctedEffectiveAt}`,
    },
    lines: [
      { accountId: "premium_receivable", debitCents: input.amountCents },
      { accountId: "refund_payable", creditCents: input.amountCents },
    ],
  };
}

// ---------------------------------------------------------------------------
// The difference, when the customer owes money
// ---------------------------------------------------------------------------

export type CorrectionCollectionInput = {
  operationId: string; // money_operations.id: the key these entries are filed under
  policyId: string;
  policyNumber: string;
  brokerId: string;
  paymentDate: string; // "YYYY-MM-DD": the day the money arrived at Stripe
  amountCents: number; // premium plus tax, positive
  commissionCents: number; // commission on the extra premium, already computed, zero or positive
};

export function correctionCollectionEntries(input: CorrectionCollectionInput): JournalEntryDraft[] {
  if (input.amountCents <= 0) {
    throw new Error("correctionCollectionEntries needs a positive amount");
  }
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
        entryType: "correction_premium_collected",
        // Cash entries carry the day the cash moved, as premium_collected does at issuance.
        effectiveAt: input.paymentDate,
        description: `Policy ${input.policyNumber}: the difference created by the corrected endorsement date, collected at Stripe`,
      },
      lines: [
        { accountId: "cash_stripe", debitCents: input.amountCents },
        { accountId: "premium_receivable", creditCents: input.amountCents },
      ],
    },
  ];

  // Commission is earned on collected premium (Yoann's rule, DECISIONS.md), so it follows the
  // cash and is dated the day the money arrived, exactly as at issuance and at an endorsement.
  if (input.commissionCents > 0) {
    entries.push({
      header: {
        ...commonHeader,
        entryType: "correction_commission_earned",
        effectiveAt: input.paymentDate,
        description: `Broker commission on the extra premium collected after the correction on policy ${input.policyNumber}`,
      },
      lines: [
        { accountId: "commission_expense", debitCents: input.commissionCents },
        { accountId: "commission_payable", creditCents: input.commissionCents },
      ],
    });
  }

  return entries;
}
