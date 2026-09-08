import { stateTaxCents } from "../money/premium";

// What a customer pays at issuance, split into its three parts. Pure arithmetic in integer
// cents; nothing here reads the database or calls a provider.
//
// The flat policy fee is an ASSUMPTION of this build, not a rate read from an official source:
// $25 per policy, charged once at issuance and never refunded on cancellation (the refund rule
// is Yoann's decision of 2026-09-08, DECISIONS.md). It is labelled as an assumption in the UI
// and in the README so nobody mistakes it for a filed fee.
export const FLAT_POLICY_FEE_CENTS = 2500;

export type PolicyCharge = {
  annualPremiumCents: number;
  taxRateBps: number;
  taxCents: number;
  feeCents: number;
  totalChargeCents: number;
};

// Worked example, the recited one (DECISIONS.md, California 2.35%):
//   annual premium $1,200            = 120000 cents
//   state premium tax 235 bps        = floor(120000 x 235 / 10000) = 2820 cents
//   flat policy fee                  =                                2500 cents
//   total charged to the customer    =                              125320 cents
// The tax is floored because the customer pays it: the insurer eats the fraction of a cent.
export function computePolicyCharge(annualPremiumCents: number, taxRateBps: number): PolicyCharge {
  if (!Number.isInteger(annualPremiumCents) || annualPremiumCents <= 0) {
    throw new Error(`annualPremiumCents must be a positive integer number of cents, got ${annualPremiumCents}`);
  }
  const taxCents = stateTaxCents(annualPremiumCents, taxRateBps);
  const feeCents = FLAT_POLICY_FEE_CENTS;
  return {
    annualPremiumCents,
    taxRateBps,
    taxCents,
    feeCents,
    totalChargeCents: annualPremiumCents + taxCents + feeCents,
  };
}
