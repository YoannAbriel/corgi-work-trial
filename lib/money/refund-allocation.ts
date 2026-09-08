// Which Stripe payment gives the money back, and how much of it.
//
// A Stripe refund is created against one PaymentIntent and can never exceed what that
// PaymentIntent collected. A policy paid once (every policy in v0) therefore produces one
// refund; a policy paid twice (issuance, then an endorsement in slice B4) can need two.
//
// The rule, decided in ARCHITECTURE.md section 4: NEWEST COLLECTION FIRST. The most recent
// payment is refunded up to what is still refundable on it, then the one before, until the
// refund is covered. Newest first is the ordinary insurance practice and it also keeps the
// oldest payment (the one most likely to be past a provider's refund window) untouched for
// as long as possible.
//
// Pure arithmetic in integer cents: it reads nothing, calls nothing, and is the only place
// that decides how a refund is split.

export type CollectionToRefund = {
  operationId: string; // our money_operations row for the collection
  paymentIntentId: string; // what the Stripe Refunds API needs
  refundableCents: number; // collected on that PaymentIntent, minus what was already refunded
  collectedOn: string; // "YYYY-MM-DD", used only to order the collections
};

export type RefundSlice = {
  collectionOperationId: string;
  paymentIntentId: string;
  amountCents: number; // what Stripe is asked to send back on this PaymentIntent
  refundedPremiumCents: number; // the premium part of this slice
  refundedTaxCents: number; // the state premium tax part of this slice
  commissionClawbackCents: number; // the commission taken back with this slice
};

export class RefundCannotBeAllocated extends Error {}

export type RefundAllocationInput = {
  refundedPremiumCents: number;
  refundedTaxCents: number;
  commissionClawbackCents: number;
  collections: CollectionToRefund[]; // any order; this function sorts them
};

// Splits one refund over the collections that funded the policy.
//
// Each slice carries its share of the premium and of the tax, so that the two parts add up to
// the amount Stripe is asked for, cent for cent (the database checks it: migration 0005). The
// commission clawback rides along in the same proportion. With one collection, which is every
// policy in v0, the single slice simply carries the three totals.
//
// Example with two collections, refunding 60000 cents made of 57000 premium and 3000 tax with
// an 8550 clawback, when the newest collection can only give back 40000:
//   slice 1 (newest, 40000): premium floor(57000 x 40000 / 60000) = 38000, tax 2000, clawback 5700
//   slice 2 (older,  20000): premium 57000 - 38000 = 19000, tax 1000, clawback 2850
export function allocateRefundNewestCollectionFirst(input: RefundAllocationInput): RefundSlice[] {
  const totalRefundCents = input.refundedPremiumCents + input.refundedTaxCents;
  if (totalRefundCents === 0) {
    // A cancellation on the last day of the term owes nothing back. No Stripe call, no operation.
    return [];
  }

  const newestFirst = [...input.collections]
    .filter((collection) => collection.refundableCents > 0)
    .sort((left, right) => (left.collectedOn < right.collectedOn ? 1 : left.collectedOn > right.collectedOn ? -1 : 0));

  const refundableInTotal = newestFirst.reduce((sum, collection) => sum + collection.refundableCents, 0);
  if (refundableInTotal < totalRefundCents) {
    // Never quietly refund less than is owed: the operator must see this.
    throw new RefundCannotBeAllocated(
      `the refund of ${totalRefundCents} cents is larger than the ${refundableInTotal} cents still refundable on this policy's payments`,
    );
  }

  // 1. How much each PaymentIntent gives back.
  const amounts: { collection: CollectionToRefund; amountCents: number }[] = [];
  let stillToCover = totalRefundCents;
  for (const collection of newestFirst) {
    if (stillToCover === 0) {
      break;
    }
    const amountCents = Math.min(collection.refundableCents, stillToCover);
    amounts.push({ collection, amountCents });
    stillToCover -= amountCents;
  }

  // 2. How each amount splits into premium, tax and clawback.
  //
  // Premium and tax are shared out slice by slice, keeping two invariants at every step:
  //   - a slice never carries more premium than its own amount, nor more than is left to give;
  //   - a slice always carries enough premium for the tax still to place to fit in the slices
  //     that come after it (that is the `amountCents - taxLeft` floor below).
  // Within those bounds each slice takes its proportional share of the premium, rounded down.
  // The two invariants mean the last slice ends up with exactly what is left, so premium and
  // tax always add up to the refund, with no cent created or lost.
  const slices: RefundSlice[] = [];
  let premiumLeft = input.refundedPremiumCents;
  let taxLeft = input.refundedTaxCents;
  let clawbackLeft = input.commissionClawbackCents;
  amounts.forEach(({ collection, amountCents }, index) => {
    const isLastSlice = index === amounts.length - 1;
    const smallestPremiumThatLetsTheTaxFit = Math.max(0, amountCents - taxLeft);
    const proportionalPremium = shareOf(input.refundedPremiumCents, amountCents, totalRefundCents);
    const premiumCents = Math.min(
      premiumLeft,
      amountCents,
      Math.max(smallestPremiumThatLetsTheTaxFit, proportionalPremium),
    );
    const taxCents = amountCents - premiumCents;
    // The clawback is not part of the amount Stripe sends back, so it only has to add up:
    // proportional share rounded down, and the last slice takes the remaining cents.
    const clawbackCents = isLastSlice
      ? clawbackLeft
      : shareOf(input.commissionClawbackCents, amountCents, totalRefundCents);

    premiumLeft -= premiumCents;
    taxLeft -= taxCents;
    clawbackLeft -= clawbackCents;
    slices.push({
      collectionOperationId: collection.operationId,
      paymentIntentId: collection.paymentIntentId,
      amountCents,
      refundedPremiumCents: premiumCents,
      refundedTaxCents: taxCents,
      commissionClawbackCents: clawbackCents,
    });
  });

  return slices;
}

// part x share / whole, rounded down, in integer arithmetic.
function shareOf(part: number, share: number, whole: number): number {
  return Number((BigInt(part) * BigInt(share)) / BigInt(whole));
}
