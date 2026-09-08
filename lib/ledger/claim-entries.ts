import type { JournalEntryDraft } from "./post";

// The journal entries of a claim: setting a reserve, adjusting it, and a payment travelling
// along the payout rail.
//
// Pure: these functions build drafts, they do not write them (lib/ledger/post.ts does), they
// read no database and they call no provider. Every one of them is keyed on the CLAIM EVENT
// that caused it (source kind 'claim_event', source id the event id), so the unique index on
// (source_kind, source_id, entry_type) makes a replayed job or a double-clicked button post
// once and only once.
//
// -------------------------------------------------------------------------------------------
// WORKED EXAMPLE, the one in ARCHITECTURE.md section 2: reserve $5,000, payment $1,200, return.
// -------------------------------------------------------------------------------------------
//
//   1. reserve set, $5,000
//        claim_reserve_set        Dr incurred_loss_expense 500000  Cr claim_reserve      500000
//      outstanding reserve 500000, paid 0, incurred 500000
//
//   2. reserve adjusted to $4,000 (a $1,000 reduction: the adjuster now expects less)
//        claim_reserve_adjusted   Dr claim_reserve         100000  Cr incurred_loss_expense 100000
//      outstanding reserve 400000, paid 0, incurred 400000
//
//   3. payment of $1,200 sent on the rail
//        claim_payment_sent       Dr claim_reserve         120000  Cr claims_payable     120000
//      outstanding reserve 280000, paid 120000, incurred 400000   (incurred does not move:
//      paying out of a reserve is not a new loss, it is the same loss becoming cash)
//
//   4. the rail settles it two days later
//        claim_payment_settled    Dr claims_payable        120000  Cr cash_claims_rail   120000
//      outstanding reserve 280000, paid 120000, settled 120000, incurred 400000
//
//   5. the bank returns it
//        claim_payment_returned   Dr cash_claims_rail      120000  Cr claims_payable     120000
//        claim_reserve_restored   Dr claims_payable        120000  Cr claim_reserve      120000
//      outstanding reserve 400000, paid 0, settled 0, incurred 400000   (the money is back and
//      the reserve is exactly what it was before the payment)
//
// At every step: incurred = paid + outstanding reserve, and that number is also the balance of
// incurred_loss_expense. scripts/check-claims-and-approvals.ts asserts both after each step.
//
// A note on cash_claims_rail (design re-review R-04): this build does not model funding the
// payout account, so cash_claims_rail carries a CREDIT balance equal to the cash that has left
// through the claims rail. Read it as "paid out through the rail", not as "cash we hold".

// Every entry type this module can post; see POLICY_ENTRY_TYPES in lib/ledger/policy-entries.ts
// for why the list exists. `header` below only accepts one of these, so a new claim entry type
// cannot be posted without being added here first.
export const CLAIM_ENTRY_TYPES = [
  "claim_reserve_set",
  "claim_reserve_adjusted",
  "claim_payment_sent",
  "claim_payment_settled",
  "claim_payment_returned",
  "claim_reserve_restored",
] as const;

export type ClaimEntryType = (typeof CLAIM_ENTRY_TYPES)[number];

export type ClaimEntryContext = {
  claimEventId: string; // claim_events.id, the key every claim entry is filed under
  claimId: string;
  claimNumber: string;
  policyId: string;
  brokerId: string;
  effectiveAt: string; // business date the entry belongs to, "YYYY-MM-DD"
  createdBy: string | null; // user id when a person caused it, null for the settlement job
};

function header(context: ClaimEntryContext, entryType: ClaimEntryType, description: string) {
  return {
    entryType,
    effectiveAt: context.effectiveAt,
    policyId: context.policyId,
    claimId: context.claimId,
    brokerId: context.brokerId,
    sourceKind: "claim_event" as const,
    sourceId: context.claimEventId,
    createdBy: context.createdBy,
    description,
  };
}

function assertPositiveCents(name: string, amountCents: number): void {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error(`${name} must be a positive whole number of cents, got ${amountCents}`);
  }
}

// Opening a case reserve: we now expect this claim to cost us this much, so the expense is
// recognised at once and the money is set aside as a liability.
export function claimReserveSetEntry(context: ClaimEntryContext, reserveCents: number): JournalEntryDraft {
  assertPositiveCents("reserveCents", reserveCents);
  return {
    header: header(context, "claim_reserve_set", `Claim ${context.claimNumber}: reserve set`),
    lines: [
      { accountId: "incurred_loss_expense", debitCents: reserveCents },
      { accountId: "claim_reserve", creditCents: reserveCents },
    ],
  };
}

// Changing the estimate. The DELTA is what is booked, and its sign decides which way the two
// lines go: expecting more is more expense, expecting less gives expense back.
// The caller never passes zero: an adjustment that changes nothing is recorded as a claim event
// with no journal entry, because an entry with no amount would be an entry with no meaning.
export function claimReserveAdjustedEntry(context: ClaimEntryContext, deltaCents: number): JournalEntryDraft {
  if (!Number.isSafeInteger(deltaCents) || deltaCents === 0) {
    throw new Error(`a reserve adjustment must move a whole non-zero number of cents, got ${deltaCents}`);
  }
  const increase = deltaCents > 0;
  const amountCents = Math.abs(deltaCents);
  return {
    header: header(
      context,
      "claim_reserve_adjusted",
      `Claim ${context.claimNumber}: reserve ${increase ? "increased" : "decreased"}`,
    ),
    lines: increase
      ? [
          { accountId: "incurred_loss_expense", debitCents: amountCents },
          { accountId: "claim_reserve", creditCents: amountCents },
        ]
      : [
          { accountId: "claim_reserve", debitCents: amountCents },
          { accountId: "incurred_loss_expense", creditCents: amountCents },
        ],
  };
}

// The payment leaves the reserve and becomes something we owe the claimant on the rail.
// No cash moves here: the rail has accepted the transfer, it has not settled it.
export function claimPaymentSentEntry(context: ClaimEntryContext, amountCents: number): JournalEntryDraft {
  assertPositiveCents("amountCents", amountCents);
  return {
    header: header(context, "claim_payment_sent", `Claim ${context.claimNumber}: payment sent on the payout rail`),
    lines: [
      { accountId: "claim_reserve", debitCents: amountCents },
      { accountId: "claims_payable", creditCents: amountCents },
    ],
  };
}

// The rail says the money has actually left. What we owed is settled, cash has gone out.
export function claimPaymentSettledEntry(context: ClaimEntryContext, amountCents: number): JournalEntryDraft {
  assertPositiveCents("amountCents", amountCents);
  return {
    header: header(context, "claim_payment_settled", `Claim ${context.claimNumber}: payment settled on the payout rail`),
    lines: [
      { accountId: "claims_payable", debitCents: amountCents },
      { accountId: "cash_claims_rail", creditCents: amountCents },
    ],
  };
}

// The bank sent the money back. Two entries, in this order, because they say two different
// things and a reader should be able to see both:
//   1. the cash came back and we owe the claimant again;
//   2. what we owe stops being a payment in flight and becomes a reserve again.
// Together they leave the claim exactly where it was before the payment was sent.
export function claimPaymentReturnedEntries(context: ClaimEntryContext, amountCents: number): JournalEntryDraft[] {
  assertPositiveCents("amountCents", amountCents);
  return [
    {
      header: header(context, "claim_payment_returned", `Claim ${context.claimNumber}: payment returned by the bank`),
      lines: [
        { accountId: "cash_claims_rail", debitCents: amountCents },
        { accountId: "claims_payable", creditCents: amountCents },
      ],
    },
    {
      header: header(context, "claim_reserve_restored", `Claim ${context.claimNumber}: reserve restored after the return`),
      lines: [
        { accountId: "claims_payable", debitCents: amountCents },
        { accountId: "claim_reserve", creditCents: amountCents },
      ],
    },
  ];
}
