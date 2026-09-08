import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripeRecordsFromListing, type StripeWindowListing } from "./stripe-records";

// The fixture is a REAL listing captured from the Stripe test-mode sandbox and sanitized to the
// fields this mapping reads (.local/capture-stripe-fixtures.ts, git-ignored: no client secrets,
// no card or billing details). It holds the payment and the cancellation refund of demo policy
// CGP-01062, both visible in the Stripe dashboard.
//
// Cases the sandbox does not currently contain (a payment with no metadata, a pending refund, a
// live-mode object) are built here, on purpose and labelled, because the point of those tests is
// the mapping rule, not the sandbox.
const capturedListing = JSON.parse(
  readFileSync(new URL("./fixtures/stripe-window-listing.json", import.meta.url), "utf8"),
) as StripeWindowListing & { captured_on: string };

test("the captured sandbox listing maps to one payment and one refund, with the real amounts", () => {
  const { records } = stripeRecordsFromListing(capturedListing);
  assert.equal(records.length, 2);

  const payment = records.find((record) => record.label === "payment");
  assert.ok(payment, "the captured PaymentIntent should produce a payment record");
  assert.equal(payment.providerRef, "pi_3UDM4KK6R3v50tIy0F5xaBbu");
  assert.equal(payment.direction, "in");
  assert.equal(payment.status, "succeeded");
  assert.equal(payment.amountCents, 355684);
  assert.equal(payment.operationId, "ddede650-8ff4-427a-8d02-31dc45acf10e");
  // The fee comes from the balance transaction of the PaymentIntent's charge, not from the
  // PaymentIntent itself, which is why latest_charge has to be followed.
  assert.equal(payment.feeCents, 10345);

  const refund = records.find((record) => record.label === "refund");
  assert.ok(refund, "the captured Refund should produce a refund record");
  assert.equal(refund.direction, "out");
  assert.equal(refund.status, "succeeded");
  assert.equal(refund.amountCents, 324156);
  assert.equal(refund.feeCents, null);
});

test("the run note names the balance transactions that were seen and not reconciled", () => {
  const { note } = stripeRecordsFromListing(capturedListing);
  assert.match(note, /charge 1/);
  assert.match(note, /refund 1/);
  assert.match(note, /fees kept by Stripe 10345 cents/);
  assert.match(note, /not journaled/);
});

test("a PaymentIntent that did not succeed is not a record: no money moved", () => {
  const listing = withPaymentIntents([
    { ...capturedListing.paymentIntents[0], id: "pi_requires_payment_method", status: "requires_payment_method", amount_received: 0 },
  ]);
  assert.deepEqual(stripeRecordsFromListing(listing).records, []);
});

test("a succeeded PaymentIntent with no metadata at all keeps no operation id (the planted break)", () => {
  const listing = withPaymentIntents([{ ...capturedListing.paymentIntents[0], id: "pi_planted", metadata: {} }]);
  const [record] = stripeRecordsFromListing(listing).records;
  assert.equal(record.providerRef, "pi_planted");
  assert.equal(record.operationId, null);
  assert.equal(record.policyId, null);
});

test("metadata is untrusted input: anything that is not one of our uuids is ignored", () => {
  const listing = withPaymentIntents([
    { ...capturedListing.paymentIntents[0], id: "pi_bad_metadata", metadata: { operation_id: "'; drop table journal_entries; --" } },
  ]);
  const [record] = stripeRecordsFromListing(listing).records;
  assert.equal(record.operationId, null);
});

test("a live-mode object stops the mapping instead of being reconciled", () => {
  const listing = withPaymentIntents([{ ...capturedListing.paymentIntents[0], livemode: true }]);
  assert.throws(() => stripeRecordsFromListing(listing), /live-mode object/);
});

test("Stripe's refund statuses fold to the three the comparison reasons about, keeping the real word", () => {
  const listing: StripeWindowListing = {
    paymentIntents: [],
    balanceTransactions: [],
    refunds: [
      { ...capturedListing.refunds[0], id: "re_pending", status: "pending" },
      { ...capturedListing.refunds[0], id: "re_action", status: "requires_action" },
      { ...capturedListing.refunds[0], id: "re_failed", status: "failed" },
      { ...capturedListing.refunds[0], id: "re_canceled", status: "canceled" },
      { ...capturedListing.refunds[0], id: "re_unknown_to_us", status: "something_new" },
    ],
  };
  const byRef = new Map(stripeRecordsFromListing(listing).records.map((record) => [record.providerRef, record]));
  assert.equal(byRef.get("re_pending")?.status, "pending");
  // Not settled either way, so it is treated as still in flight rather than as money that left.
  assert.equal(byRef.get("re_action")?.status, "pending");
  assert.equal(byRef.get("re_failed")?.status, "failed");
  assert.equal(byRef.get("re_canceled")?.status, "failed");
  assert.equal(byRef.get("re_canceled")?.statusWord, "canceled");
  // A status we have never seen is not read as "the money left": it stays pending and shows up.
  assert.equal(byRef.get("re_unknown_to_us")?.status, "pending");
});

test("a refund is reported even when Stripe lists no balance transaction for it", () => {
  const listing: StripeWindowListing = { paymentIntents: [], refunds: [capturedListing.refunds[0]], balanceTransactions: [] };
  const { records, note } = stripeRecordsFromListing(listing);
  assert.equal(records.length, 1);
  assert.match(note, /balance transactions in the window: none/);
});

function withPaymentIntents(paymentIntents: StripeWindowListing["paymentIntents"]): StripeWindowListing {
  return { paymentIntents, refunds: [], balanceTransactions: capturedListing.balanceTransactions };
}
