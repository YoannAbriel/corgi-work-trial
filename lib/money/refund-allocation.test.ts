import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allocateRefundNewestCollectionFirst,
  RefundCannotBeAllocated,
  type CollectionToRefund,
} from "./refund-allocation";

// The v0 case: one payment collected the whole charge, so one Stripe refund gives it back.
const singleCollection: CollectionToRefund[] = [
  { operationId: "op-issuance", paymentIntentId: "pi_issuance", refundableCents: 125320, collectedOn: "2028-03-01" },
];

test("one collection takes the whole refund", () => {
  // The recited example: 87124 premium + 2048 tax back, 13068 of commission clawed back.
  const slices = allocateRefundNewestCollectionFirst({
    refundedPremiumCents: 87124,
    refundedTaxCents: 2048,
    commissionClawbackCents: 13068,
    collections: singleCollection,
  });
  assert.deepEqual(slices, [
    {
      collectionOperationId: "op-issuance",
      paymentIntentId: "pi_issuance",
      amountCents: 89172,
      refundedPremiumCents: 87124,
      refundedTaxCents: 2048,
      commissionClawbackCents: 13068,
    },
  ]);
});

test("a refund of nothing produces no Stripe call at all", () => {
  assert.deepEqual(
    allocateRefundNewestCollectionFirst({
      refundedPremiumCents: 0,
      refundedTaxCents: 0,
      commissionClawbackCents: 0,
      collections: singleCollection,
    }),
    [],
  );
});

test("the newest collection is refunded first, the older one takes the rest", () => {
  // Issuance in March, endorsement in June (slice B4). The endorsement payment is the newest,
  // so it gives its money back first even though it is the smaller of the two.
  const collections: CollectionToRefund[] = [
    { operationId: "op-issuance", paymentIntentId: "pi_issuance", refundableCents: 125320, collectedOn: "2028-03-01" },
    { operationId: "op-endorsement", paymentIntentId: "pi_endorsement", refundableCents: 40000, collectedOn: "2028-06-09" },
  ];
  const slices = allocateRefundNewestCollectionFirst({
    refundedPremiumCents: 57000,
    refundedTaxCents: 3000,
    commissionClawbackCents: 8550,
    collections,
  });

  assert.equal(slices.length, 2);
  assert.equal(slices[0].paymentIntentId, "pi_endorsement");
  assert.equal(slices[0].amountCents, 40000); // everything that payment can still give back
  assert.equal(slices[1].paymentIntentId, "pi_issuance");
  assert.equal(slices[1].amountCents, 20000); // 60000 - 40000

  // 57000 x 40000 / 60000 = 38000 premium on the newest slice, the rest on the older one.
  assert.deepEqual(
    slices.map((slice) => [slice.refundedPremiumCents, slice.refundedTaxCents, slice.commissionClawbackCents]),
    [
      [38000, 2000, 5700],
      [19000, 1000, 2850],
    ],
  );
});

test("collections are ordered by their collection date, whatever order they arrive in", () => {
  const collections: CollectionToRefund[] = [
    { operationId: "op-b", paymentIntentId: "pi_b", refundableCents: 500, collectedOn: "2028-06-09" },
    { operationId: "op-c", paymentIntentId: "pi_c", refundableCents: 500, collectedOn: "2028-09-01" },
    { operationId: "op-a", paymentIntentId: "pi_a", refundableCents: 500, collectedOn: "2028-03-01" },
  ];
  const slices = allocateRefundNewestCollectionFirst({
    refundedPremiumCents: 1000,
    refundedTaxCents: 0,
    commissionClawbackCents: 150,
    collections,
  });
  assert.deepEqual(
    slices.map((slice) => slice.paymentIntentId),
    ["pi_c", "pi_b"],
  );
});

test("a payment with nothing left to refund is skipped", () => {
  const collections: CollectionToRefund[] = [
    { operationId: "op-issuance", paymentIntentId: "pi_issuance", refundableCents: 1000, collectedOn: "2028-03-01" },
    { operationId: "op-endorsement", paymentIntentId: "pi_endorsement", refundableCents: 0, collectedOn: "2028-06-09" },
  ];
  const slices = allocateRefundNewestCollectionFirst({
    refundedPremiumCents: 900,
    refundedTaxCents: 100,
    commissionClawbackCents: 135,
    collections,
  });
  assert.deepEqual(
    slices.map((slice) => slice.paymentIntentId),
    ["pi_issuance"],
  );
});

test("a refund larger than what the payments can give back is refused, never truncated", () => {
  assert.throws(
    () =>
      allocateRefundNewestCollectionFirst({
        refundedPremiumCents: 200000,
        refundedTaxCents: 4000,
        commissionClawbackCents: 30000,
        collections: singleCollection,
      }),
    RefundCannotBeAllocated,
  );
});

test("premium and tax always add up to the amount asked of Stripe, on every split", () => {
  // Two payments of awkward sizes, refunded at every possible split point: the parts must add
  // up exactly, no negative part, and the totals must be preserved. This is the property the
  // database CHECK in migration 0005 enforces (amount = premium + tax).
  const totalPremiumCents = 98_765;
  const totalTaxCents = 2_321;
  const totalRefundCents = totalPremiumCents + totalTaxCents;
  const totalClawbackCents = 14_814;

  for (let newestRefundable = 1; newestRefundable < totalRefundCents; newestRefundable += 997) {
    const slices = allocateRefundNewestCollectionFirst({
      refundedPremiumCents: totalPremiumCents,
      refundedTaxCents: totalTaxCents,
      commissionClawbackCents: totalClawbackCents,
      collections: [
        { operationId: "old", paymentIntentId: "pi_old", refundableCents: totalRefundCents, collectedOn: "2028-01-01" },
        { operationId: "new", paymentIntentId: "pi_new", refundableCents: newestRefundable, collectedOn: "2028-06-01" },
      ],
    });

    let premium = 0;
    let tax = 0;
    let clawback = 0;
    let amount = 0;
    for (const slice of slices) {
      assert.equal(
        slice.refundedPremiumCents + slice.refundedTaxCents,
        slice.amountCents,
        `slice does not add up at ${newestRefundable}`,
      );
      assert.ok(slice.refundedPremiumCents >= 0 && slice.refundedTaxCents >= 0 && slice.commissionClawbackCents >= 0);
      premium += slice.refundedPremiumCents;
      tax += slice.refundedTaxCents;
      clawback += slice.commissionClawbackCents;
      amount += slice.amountCents;
    }
    assert.equal(premium, totalPremiumCents, `premium lost at ${newestRefundable}`);
    assert.equal(tax, totalTaxCents, `tax lost at ${newestRefundable}`);
    assert.equal(clawback, totalClawbackCents, `clawback lost at ${newestRefundable}`);
    assert.equal(amount, totalRefundCents, `amount lost at ${newestRefundable}`);
  }
});
