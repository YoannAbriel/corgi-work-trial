// The status a policy shows in the interface. It is derived, never stored as a fact: it is a
// reading of the immutable policy events plus the lifecycle of the payment operation.
// lib/policy/current.ts writes the result into the policy_current cache; nothing posts money
// from it.

export type PolicyStatus =
  | "draft"
  | "awaiting_payment"
  | "payment_failed"
  | "paid_not_bound" // money received, policy not bound: the broker was not eligible at that moment
  | "bound"
  | "cancelled"
  | "voided";

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

// True when a correction reversed this policy's issuance and nothing has re-booked it.
//
// The fold (lib/policy/current.ts) drops an event named by a later correction's
// supersedes_event_id, so a voided policy has a 'correction_reversal' in its event types and no
// 'issued' any more, while both rows stay in the table. The re-book of slice B8 will add a
// 'correction_rebook', which is what makes the policy bound again, so it is checked here too:
// a corrected policy must not read as voided.
export function policyWasVoided(policyEventTypes: string[]): boolean {
  return (
    policyEventTypes.includes("correction_reversal") &&
    !policyEventTypes.includes("issued") &&
    !policyEventTypes.includes("correction_rebook")
  );
}

// Order matters and is read top to bottom:
//   a cancelled policy stays cancelled; a policy whose issuance was reversed by a correction is
//   voided, whatever its payment operation says afterwards (the void marks the attempt dead, so
//   the payment status alone would read as 'payment_failed' and hide the correction); a policy
//   with an 'issued' event is bound, whatever happened afterwards to the payment operation;
//   without issuance, the payment tells the story: succeeded but not bound (the broker was not
//   eligible when the money arrived, so the cash sits in the suspense account until staff bind
//   or refund it), failed, in flight, or never started.
export function derivePolicyStatus(input: PolicyStatusInput): PolicyStatus {
  if (input.policyEventTypes.includes("cancelled")) {
    return "cancelled";
  }
  if (policyWasVoided(input.policyEventTypes)) {
    return "voided";
  }
  if (input.policyEventTypes.includes("issued")) {
    return "bound";
  }
  if (input.latestPaymentStatus === "succeeded") {
    return "paid_not_bound";
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
