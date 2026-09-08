import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePolicyStatus, policyWasVoided } from "./status";

test("a quoted policy with no payment started is a draft", () => {
  assert.equal(derivePolicyStatus({ policyEventTypes: ["quoted"], latestPaymentStatus: null }), "draft");
});

test("money in flight makes the policy awaiting payment, never bound", () => {
  for (const status of ["requested", "provider_accepted", "unknown"] as const) {
    assert.equal(derivePolicyStatus({ policyEventTypes: ["quoted"], latestPaymentStatus: status }), "awaiting_payment");
  }
});

test("a declined card shows as payment failed and leaves the policy unbound", () => {
  assert.equal(derivePolicyStatus({ policyEventTypes: ["quoted"], latestPaymentStatus: "failed" }), "payment_failed");
});

test("the policy is bound once the issuance event exists", () => {
  assert.equal(
    derivePolicyStatus({ policyEventTypes: ["quoted", "issued"], latestPaymentStatus: "succeeded" }),
    "bound",
  );
});

test("a later payment failure cannot un-bind a policy that was issued", () => {
  // A refund or a chargeback is a new money event, not a reason to hide the coverage that
  // was granted: correcting it is a reversal entry, not a status flip.
  assert.equal(derivePolicyStatus({ policyEventTypes: ["quoted", "issued"], latestPaymentStatus: "failed" }), "bound");
});

test("a cancelled policy stays cancelled", () => {
  assert.equal(
    derivePolicyStatus({ policyEventTypes: ["quoted", "issued", "cancelled"], latestPaymentStatus: "succeeded" }),
    "cancelled",
  );
});

test("a policy whose issuance was reversed by a correction is voided", () => {
  // The void marks the payment attempt dead (reason 'expired'), so without this rule the
  // policy would read as 'payment_failed' and the correction would be invisible.
  assert.equal(
    derivePolicyStatus({ policyEventTypes: ["quoted", "correction_reversal"], latestPaymentStatus: "failed" }),
    "voided",
  );
});

test("a correction that re-books the policy is not a void", () => {
  // Only the negative is asserted, and deliberately: what a re-booked policy shows instead is
  // decided by slice B8, which does not exist yet. What matters here is that the re-book stops
  // the policy from reading as voided.
  assert.notEqual(
    derivePolicyStatus({
      policyEventTypes: ["quoted", "correction_reversal", "correction_rebook"],
      latestPaymentStatus: "succeeded",
    }),
    "voided",
  );
});

test("policyWasVoided answers the question on its own, for the checkout guard", () => {
  assert.equal(policyWasVoided(["quoted", "correction_reversal"]), true);
  assert.equal(policyWasVoided(["quoted", "issued"]), false);
  assert.equal(policyWasVoided(["quoted"]), false);
});
