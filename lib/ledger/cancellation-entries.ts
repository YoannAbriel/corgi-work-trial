import type { JournalEntryDraft, JournalLineDraft } from "./post";

// The journal entries of a cancellation and of the refund it triggers.
// Pure: these functions build drafts, they do not write them (lib/ledger/post.ts does), they
// read no database and they call no provider. That is what makes the amounts testable line by
// line, and what lets the preview screen show the very same figures before anything happens.
//
// Worked example, the recited one (DECISIONS.md): $1,200 annual premium written on 2028-03-01,
// California premium tax 2820 cents, $25 fee, 15% broker commission, cancelled effective
// 2028-06-09, day 100 of a 365-day term.
//
//   earned to date  = floor(120000 x 100 / 365) = 32876    unearned = 87124
//   tax refunded    = ceil(87124 x 235 / 10000) = 2048     fee refunded = 0
//   refund          = 87124 + 2048              = 89172
//   clawback        = floor(87124 x 1500/10000) = 13068
//
// At cancellation, in one transaction with the cancellation event and the refund operation:
//
//   premium_earned_to_date  Dr unearned_premium     32876  Cr earned_premium      32876
//   refund_requested        Dr unearned_premium     87124  Cr refund_payable      89172
//                           Dr premium_tax_payable   2048
//
// The two together empty the unearned premium liability of this policy: 32876 + 87124 =
// 120000, the whole written premium. What the customer is owed now sits in refund_payable,
// and the tax we no longer owe California has been taken back out of premium_tax_payable.
//
// When Stripe confirms the refund actually left, in one transaction:
//
//   refund_completed        Dr refund_payable       89172  Cr cash_stripe         89172
//   commission_clawback     Dr commission_payable   13068  Cr commission_expense  13068
//
// refund_payable returns to zero (the customer has the money) and the broker's commission is
// reduced by the commission on the premium that was given back.
//
// A FAILED refund posts nothing at all: the customer is still owed the money, so refund_payable
// must stay open (design re-review finding R-01, docs/reviews/architecture.md section 10).

// Every entry type this module can post; see POLICY_ENTRY_TYPES for why the list exists.
export const CANCELLATION_ENTRY_TYPES = [
  "premium_earned_to_date",
  "refund_requested",
  "refund_completed",
  "commission_clawback",
] as const;

export type CancellationEntryType = (typeof CANCELLATION_ENTRY_TYPES)[number];

// Moving premium from "not earned yet" to "earned" at a point in time. Posted at cancellation
// so that the as-of balances and the refund tell the same story on the same day.
export type PremiumEarnedToDateInput = {
  cancellationEventId: string; // policy_events.id: the key this entry is filed under
  policyId: string;
  policyNumber: string;
  brokerId: string;
  effectiveAt: string; // the cancellation effective date, "YYYY-MM-DD"
  earnedPremiumCents: number; // premium earned that is not yet recognised in the journal
  createdBy: string | null;
};

export function premiumEarnedToDateEntry(input: PremiumEarnedToDateInput): JournalEntryDraft {
  if (input.earnedPremiumCents <= 0) {
    throw new Error("premiumEarnedToDateEntry needs a positive amount; the caller skips the entry when nothing is left to earn");
  }
  return {
    header: {
      entryType: "premium_earned_to_date" satisfies CancellationEntryType,
      effectiveAt: input.effectiveAt,
      policyId: input.policyId,
      brokerId: input.brokerId,
      // Filed under the policy event, not under a money operation: no money moves here, the
      // premium simply stops being a liability and becomes income.
      sourceKind: "policy_event",
      sourceId: input.cancellationEventId,
      createdBy: input.createdBy,
      description: `Policy ${input.policyNumber} premium earned up to its cancellation on ${input.effectiveAt}`,
    },
    lines: [
      { accountId: "unearned_premium", debitCents: input.earnedPremiumCents },
      { accountId: "earned_premium", creditCents: input.earnedPremiumCents },
    ],
  };
}

// What we owe the customer, the moment we decide to refund it. One entry per Stripe refund,
// because one Stripe refund is one PaymentIntent and one money operation.
export type RefundRequestedInput = {
  refundOperationId: string; // money_operations.id: the key this entry is filed under
  policyId: string;
  policyNumber: string;
  brokerId: string;
  effectiveAt: string; // the cancellation effective date, "YYYY-MM-DD"
  refundedPremiumCents: number;
  refundedTaxCents: number;
  createdBy: string | null;
};

export function refundRequestedEntry(input: RefundRequestedInput): JournalEntryDraft {
  const totalRefundCents = input.refundedPremiumCents + input.refundedTaxCents;
  if (totalRefundCents <= 0) {
    throw new Error("refundRequestedEntry needs a positive refund; the caller creates no operation when nothing is owed");
  }

  const lines: JournalLineDraft[] = [];
  if (input.refundedPremiumCents > 0) {
    lines.push({ accountId: "unearned_premium", debitCents: input.refundedPremiumCents });
  }
  if (input.refundedTaxCents > 0) {
    // The tax rides back out with the premium: California's base is gross premiums less return
    // premiums (Cal. Const. art. XIII s. 28(c)), so a refunded premium reduces the tax we owe.
    lines.push({ accountId: "premium_tax_payable", debitCents: input.refundedTaxCents });
  }
  lines.push({ accountId: "refund_payable", creditCents: totalRefundCents });

  return {
    header: {
      entryType: "refund_requested" satisfies CancellationEntryType,
      effectiveAt: input.effectiveAt,
      policyId: input.policyId,
      brokerId: input.brokerId,
      sourceKind: "money_operation",
      sourceId: input.refundOperationId,
      createdBy: input.createdBy,
      description: `Policy ${input.policyNumber} refund owed to the customer after cancellation`,
    },
    lines,
  };
}

// The two entries posted when Stripe says the refund actually went out.
export type RefundCompletedInput = {
  refundOperationId: string;
  policyId: string;
  policyNumber: string;
  brokerId: string;
  refundedOn: string; // the UTC day the refund left Stripe, "YYYY-MM-DD"
  totalRefundCents: number;
  commissionClawbackCents: number;
};

export function refundCompletedEntries(input: RefundCompletedInput): JournalEntryDraft[] {
  const commonHeader = {
    policyId: input.policyId,
    brokerId: input.brokerId,
    sourceKind: "money_operation" as const,
    sourceId: input.refundOperationId,
    createdBy: null, // caused by a Stripe event, not by a person clicking
  };

  const entries: JournalEntryDraft[] = [
    {
      header: {
        ...commonHeader,
        entryType: "refund_completed" satisfies CancellationEntryType,
        // Cash entries carry the day the cash moved, as premium_collected does at issuance.
        effectiveAt: input.refundedOn,
        description: `Policy ${input.policyNumber} refund paid back to the customer at Stripe`,
      },
      lines: [
        { accountId: "refund_payable", debitCents: input.totalRefundCents },
        { accountId: "cash_stripe", creditCents: input.totalRefundCents },
      ],
    },
  ];

  // Commission is earned on collected premium and clawed back on refunded premium (Yoann's
  // rule, DECISIONS.md). It follows the cash, so it is dated the day the refund went out, and
  // it is skipped entirely for a broker on a zero rate or a refund too small to move a cent.
  if (input.commissionClawbackCents > 0) {
    entries.push({
      header: {
        ...commonHeader,
        entryType: "commission_clawback" satisfies CancellationEntryType,
        effectiveAt: input.refundedOn,
        description: `Broker commission clawed back on the refunded premium of policy ${input.policyNumber}`,
      },
      lines: [
        { accountId: "commission_payable", debitCents: input.commissionClawbackCents },
        { accountId: "commission_expense", creditCents: input.commissionClawbackCents },
      ],
    });
  }

  return entries;
}
