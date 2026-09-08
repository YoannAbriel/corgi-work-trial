// The status a policy shows in the interface. It is derived, never stored as a fact: it is a
// reading of the immutable policy events plus the lifecycle of the payment operation.
// lib/policy/current.ts writes the result into the policy_current cache; nothing posts money
// from it.

export type PolicyStatus = "draft" | "awaiting_payment" | "payment_failed" | "bound" | "cancelled";

export type MoneyOperationStatus =
  | "requested"
  | "provider_accepted"
  | "succeeded"
  | "failed"
  | "returned"
  | "unknown";

export type PolicyStatusInput = {
  policyEventTypes: string[]; // every event type recorded for the policy
  latestPaymentStatus: MoneyOperationStatus | null; // last status of the checkout operation, null when none exists
};

// Order matters and is read top to bottom:
//   a cancelled policy stays cancelled; a policy with an 'issued' event is bound, whatever
//   happened afterwards to the payment operation; without issuance, the payment tells the
//   story: failed, in flight, or never started.
export function derivePolicyStatus(input: PolicyStatusInput): PolicyStatus {
  if (input.policyEventTypes.includes("cancelled")) {
    return "cancelled";
  }
  if (input.policyEventTypes.includes("issued")) {
    return "bound";
  }
  if (input.latestPaymentStatus === "failed") {
    return "payment_failed";
  }
  if (input.latestPaymentStatus !== null) {
    // requested, provider_accepted, unknown: money is in flight, the policy is not bound yet.
    return "awaiting_payment";
  }
  return "draft";
}
