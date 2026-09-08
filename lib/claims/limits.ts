// Whether a claim payment may be made at all, expressed as pure arithmetic so it can be read,
// tested and defended without a database.
//
// Track 1: "payments reduce reserve, incurred = paid + reserve, cannot pay past limit". Three
// separate ceilings, and a payment has to clear all three:
//
//   1. the reserve of this claim: you cannot pay out of an estimate you have not made. Raising
//      the reserve is a deliberate, recorded act, so the refusal names it rather than raising
//      the reserve quietly on the operator's behalf;
//   2. the per-occurrence limit: the most the policy pays for one loss;
//   3. the aggregate limit: the most the policy pays over the whole term, across every claim.
//
// PENDING PAYMENTS COUNT. A payment that has been requested and is waiting for an approver has
// not moved a cent and has not touched the reserve, but it must still occupy its share of all
// three ceilings. Otherwise two requests made at the same moment would each look affordable and
// together break the limit (design finding F-21). The caller counts a request as pending until
// it is either sent or refused, and passes the totals in.

export type ClaimPaymentLimitsInput = {
  amountCents: number; // what is being asked for now
  reserveCents: number; // outstanding reserve of this claim (payments already sent are out of it)
  claimPendingCents: number; // requested and not yet sent, on this claim
  claimPaidCents: number; // sent and not returned, on this claim
  perOccurrenceLimitCents: number;
  policyCommittedCents: number; // paid + pending across EVERY claim of the policy, this one included
  aggregateLimitCents: number;
};

// Returns the reason the payment is refused, in words an operator can act on, or null when it
// may go ahead. One function, one sentence per rule, used by the request screen, the request
// route, the execution path and the check script, so no entry point can be more permissive than
// another.
export function claimPaymentRefusal(input: ClaimPaymentLimitsInput): string | null {
  const { amountCents } = input;
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return "a claim payment must be a positive amount";
  }

  const reserveLeftCents = input.reserveCents - input.claimPendingCents;
  if (amountCents > reserveLeftCents) {
    return (
      `this payment of ${amountCents} cents is more than the ${reserveLeftCents} cents left in the reserve; ` +
      "raise the reserve first, so that the increase is recorded as its own decision"
    );
  }

  const claimAfterCents = input.claimPaidCents + input.claimPendingCents + amountCents;
  if (claimAfterCents > input.perOccurrenceLimitCents) {
    return (
      `this payment would take what this claim has been paid to ${claimAfterCents} cents, ` +
      `past the per-occurrence limit of ${input.perOccurrenceLimitCents} cents`
    );
  }

  const policyAfterCents = input.policyCommittedCents + amountCents;
  if (policyAfterCents > input.aggregateLimitCents) {
    return (
      `this payment would take what this policy has paid in claims to ${policyAfterCents} cents, ` +
      `past the aggregate limit of ${input.aggregateLimitCents} cents across all its claims`
    );
  }

  return null;
}
