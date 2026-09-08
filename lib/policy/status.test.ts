import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePolicyStatus } from "./status";

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
