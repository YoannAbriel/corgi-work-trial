import type Stripe from "stripe";
import type { ProviderRecord } from "./diff";

// Stripe objects in, plain ProviderRecords out. PURE: no network, no key, no clock, so it is
// unit-tested on the sanitized fixtures under ./fixtures and the diff never sees a Stripe
// object. The network part that produces the listing is lib/reconciliation/stripe-source.ts.
//
// What is listed and why:
//   PaymentIntents  money collected. Only `succeeded` ones are records: the amount is
//                   amount_received, the operation is metadata.operation_id (set at Checkout
//                   Session creation, lib/payments/checkout.ts).
//   Refunds         money sent back. succeeded, pending and failed are all records, with their
//                   status, because a pending refund that never completes is a stale break and
//                   a failed one must not be read as money that left.
//   BalanceTransactions  Stripe's own ledger of its balance. Used for one thing: the fee Stripe
//                   kept on each payment, carried on the matched item as information. Nothing
//                   else in that listing is reconciled: fees and payouts are not journaled in
//                   this build (cash_stripe is gross of fees, disclosed in README, design
//                   finding F-13), and the note on the run says how many were seen.

// The subsets of the Stripe objects the mapping reads. Declared as types of their own so the
// sanitized JSON fixtures can be typed against them without carrying whole Stripe objects.
export type StripePaymentIntentFacts = {
  id: string;
  status: Stripe.PaymentIntent.Status;
  amount_received: number;
  created: number; // seconds since 1970, UTC
  livemode: boolean;
  metadata: Record<string, string | null> | null;
  latest_charge: string | { id: string } | null;
};

// A Stripe Refund carries no `livemode` field (checked against the SDK types of stripe 22.6.1
// on 2026-09-08), which is why the live-mode guard below reads the PaymentIntents only.
export type StripeRefundFacts = {
  id: string;
  status: string | null; // succeeded, pending, failed, canceled, requires_action
  amount: number;
  created: number;
  metadata: Record<string, string | null> | null;
  payment_intent: string | { id: string } | null;
};

export type StripeBalanceTransactionFacts = {
  id: string;
  type: string; // charge, payment, refund, payout, stripe_fee, ...
  amount: number; // signed, in cents
  fee: number; // what Stripe kept, in cents
  created: number;
  source: string | { id: string } | null; // the charge, refund or payout it describes
};

export type StripeWindowListing = {
  paymentIntents: StripePaymentIntentFacts[];
  refunds: StripeRefundFacts[];
  balanceTransactions: StripeBalanceTransactionFacts[];
};

export function stripeRecordsFromListing(listing: StripeWindowListing): { records: ProviderRecord[]; note: string } {
  refuseLiveMode(listing);
  const feeByChargeId = feesByCharge(listing.balanceTransactions);

  const payments: ProviderRecord[] = listing.paymentIntents
    .filter((paymentIntent) => paymentIntent.status === "succeeded")
    .map((paymentIntent) => ({
      providerRef: paymentIntent.id,
      direction: "in",
      status: "succeeded",
      statusWord: paymentIntent.status,
      amountCents: paymentIntent.amount_received,
      createdAt: isoFromUnixSeconds(paymentIntent.created),
      operationId: readUuid(paymentIntent.metadata?.operation_id),
      policyId: readUuid(paymentIntent.metadata?.policy_id),
      feeCents: feeByChargeId.get(idOf(paymentIntent.latest_charge) ?? "") ?? null,
      label: "payment",
    }));

  const refunds: ProviderRecord[] = listing.refunds.map((refund) => ({
    providerRef: refund.id,
    direction: "out",
    status: refundStatus(refund.status),
    // Stripe's own word, kept for the notes: "canceled" and "failed" both fold to failed above,
    // and an operator reading a break should see which one Stripe actually said.
    statusWord: refund.status ?? "unknown",
    amountCents: refund.amount,
    createdAt: isoFromUnixSeconds(refund.created),
    operationId: readUuid(refund.metadata?.operation_id),
    policyId: readUuid(refund.metadata?.policy_id),
    feeCents: null,
    label: "refund",
  }));

  return { records: [...payments, ...refunds], note: balanceTransactionNote(listing.balanceTransactions) };
}

// A live-mode object can only come from a live key, which lib/stripe.ts already refuses, and
// fetchStripeWindow asks Stripe itself which mode it is answering in before listing anything.
// This is the same rule applied a third time, to the data, so a mistake upstream still fails
// closed. Only PaymentIntents are checked because they are the only objects in this listing that
// carry the flag; a live PaymentIntent would mean the whole listing is live.
function refuseLiveMode(listing: StripeWindowListing): void {
  const live = listing.paymentIntents.find((paymentIntent) => paymentIntent.livemode);
  if (live) {
    throw new Error(`Stripe returned a live-mode object (${live.id}); this trial reconciles test-mode money only`);
  }
}

// Stripe's refund statuses, folded to the three the diff reasons about.
function refundStatus(status: string | null): ProviderRecord["status"] {
  if (status === "succeeded") return "succeeded";
  if (status === "failed" || status === "canceled") return "failed";
  return "pending"; // pending, requires_action, or a value we do not know: not settled either way
}

// The fee Stripe kept on each charge, from the balance transaction that describes the charge.
// A charge's balance transaction has type 'charge' (or 'payment' for some methods) and its
// `source` is the charge id, which the PaymentIntent exposes as latest_charge.
function feesByCharge(balanceTransactions: StripeBalanceTransactionFacts[]): Map<string, number> {
  const fees = new Map<string, number>();
  for (const transaction of balanceTransactions) {
    const sourceId = idOf(transaction.source);
    if ((transaction.type === "charge" || transaction.type === "payment") && sourceId) {
      fees.set(sourceId, transaction.fee);
    }
  }
  return fees;
}

// What the balance listing contained, for the run's note. Fees and payouts are named here
// precisely because they are NOT reconciled: the reader must not mistake their absence from
// the items for their absence at Stripe.
function balanceTransactionNote(balanceTransactions: StripeBalanceTransactionFacts[]): string {
  const countByType = new Map<string, number>();
  let feesCents = 0;
  for (const transaction of balanceTransactions) {
    countByType.set(transaction.type, (countByType.get(transaction.type) ?? 0) + 1);
    feesCents += transaction.fee;
  }
  const summary = [...countByType.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, count]) => `${type} ${count}`)
    .join(", ");
  return (
    `balance transactions in the window: ${summary || "none"}; fees kept by Stripe ${feesCents} cents. ` +
    "Fees and payouts are not journaled in this build (cash_stripe is gross of fees; a payout moves money from the Stripe balance to the bank account, outside the ledger), disclosed in README."
  );
}

function idOf(reference: string | { id: string } | null): string | null {
  if (reference === null) return null;
  return typeof reference === "string" ? reference : reference.id;
}

function isoFromUnixSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

// Provider metadata is untrusted input: only a value shaped like one of our uuids is used.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readUuid(candidate: unknown): string | null {
  return typeof candidate === "string" && UUID.test(candidate) ? candidate : null;
}
