import type { PolicyAsOfResult } from "./correction-read";
import type { PolicyDetail } from "./read";

// What the policy IS on a given business date, for the panel every screen prints at the top of a
// policy.
//
// WHY THIS IS ONE FUNCTION AND NOT TWO PANELS. `policy_current` holds the LATEST terms: it applies
// every event whatever its effective date, so a policy carrying a future-dated endorsement answers
// next month's premium and next month's limits. Printing that under "the terms in force today" is
// wrong, and it was wrong twice: Yoann found it on the staff page (F-YA-07) and the integration
// review found the same sentence still on the customer's own page a day later (F-INT-02), where an
// overstated per-occurrence limit is a statement made to the insured. The fold is now asked once,
// here, and both screens read the answer, so the two cannot drift apart again.
export type TermsInForce = {
  // The date the figures below are in force on, or null when the fold could not rebuild the
  // policy on that date (it was not issued yet, or its issuance was reversed by a correction).
  // The screens print the date in the panel heading, and say so when there is none.
  onDate: string | null;
  annualPremiumCents: number;
  taxRateBps: number;
  taxCents: number;
  feeCents: number;
  totalChargeCents: number;
  // Named limits in printing order, so a policy with more coverage lines than two needs no
  // change here.
  limits: { label: string; cents: number }[];
};

// `asOfResult` is the answer of policyAsItStoodOn (lib/policy/correction-read.ts) for the date the
// screen is showing. When it has no answer, the policy record is the only thing there is to print
// and `onDate` is null so the screen can say that instead of claiming a date.
export function termsInForceOn(policy: PolicyDetail, asOfResult: PolicyAsOfResult): TermsInForce {
  if ("snapshot" in asOfResult) {
    const snapshot = asOfResult.snapshot;
    return {
      onDate: snapshot.asOf,
      annualPremiumCents: snapshot.annualPremiumCents,
      taxRateBps: snapshot.taxRateBasisPoints,
      taxCents: snapshot.taxCents,
      feeCents: snapshot.feeCents,
      totalChargeCents: snapshot.totalChargeCents,
      limits: snapshot.coverageLines.map((line) => ({ label: line.name, cents: line.limitCents })),
    };
  }
  return {
    onDate: null,
    annualPremiumCents: policy.annualPremiumCents,
    taxRateBps: policy.taxRateBps,
    taxCents: policy.taxCents,
    feeCents: policy.feeCents,
    totalChargeCents: policy.totalChargeCents,
    limits: [
      { label: "Per-occurrence limit", cents: policy.perOccurrenceLimitCents },
      { label: "Aggregate limit", cents: policy.aggregateLimitCents },
    ],
  };
}
