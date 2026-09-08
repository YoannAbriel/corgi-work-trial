import { daysBetween, termDays, type CalendarDate } from "./dates";

// Pure premium arithmetic. Inputs and outputs are integer cents (bigint arithmetic inside,
// numbers outside). No floats, no rounding modes to configure: the rules below are the ones
// Yoann decided on 2026-09-08 (DECISIONS.md):
//   - premium earns pro-rata daily over the actual days of the term;
//   - the insurer eats the rounding penny: what the customer pays is rounded down,
//     what the customer gets back is rounded up.

// Integer division rounded down (both arguments non-negative).
function floorDiv(numerator: bigint, denominator: bigint): bigint {
  return numerator / denominator;
}

// Integer division rounded up (both arguments non-negative).
function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function assertCents(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer number of cents, got ${value}`);
  }
}

// Days of the term elapsed at `asOf`, clamped to [0, termDays]. Before the term nothing is
// earned; after the term everything is.
export function elapsedTermDays(termStart: CalendarDate, termEndDate: CalendarDate, asOf: CalendarDate): number {
  const total = termDays(termStart, termEndDate);
  const elapsed = daysBetween(termStart, asOf);
  return Math.min(Math.max(elapsed, 0), total);
}

// Earned premium at `asOf`, rounded down (insurer eats the penny).
// Example: $1,200 written for 2028-01-01 to 2029-01-01 (366 days), as of day 100:
//   120000 x 100 / 366 = 32786.885... -> 32786 cents earned.
export function earnedPremiumCents(
  writtenPremiumCents: number,
  termStart: CalendarDate,
  termEndDate: CalendarDate,
  asOf: CalendarDate,
): number {
  assertCents("writtenPremiumCents", writtenPremiumCents);
  const total = BigInt(termDays(termStart, termEndDate));
  const elapsed = BigInt(elapsedTermDays(termStart, termEndDate, asOf));
  return Number(floorDiv(BigInt(writtenPremiumCents) * elapsed, total));
}

// Unearned premium at `asOf`: the liability owed back on cancellation.
// Same example: 120000 - 32786 = 87214 cents (this is the rounded-up remainder).
export function unearnedPremiumCents(
  writtenPremiumCents: number,
  termStart: CalendarDate,
  termEndDate: CalendarDate,
  asOf: CalendarDate,
): number {
  return writtenPremiumCents - earnedPremiumCents(writtenPremiumCents, termStart, termEndDate, asOf);
}

// Premium delta of an endorsement, priced over the days remaining from its effective date,
// never from the day it was typed in. Positive: the customer pays, rounded down.
// Negative: the customer is credited, rounded up in absolute value.
// Example: annual premium goes from $1,200 to $1,800 on day 100 of a 366-day term:
//   60000 x 266 / 366 = 43606.55... -> 43606 cents charged.
//   The reverse change on the same day credits 43607 cents.
export function endorsementDeltaCents(
  oldAnnualPremiumCents: number,
  newAnnualPremiumCents: number,
  termStart: CalendarDate,
  termEndDate: CalendarDate,
  effectiveAt: CalendarDate,
): number {
  assertCents("oldAnnualPremiumCents", oldAnnualPremiumCents);
  assertCents("newAnnualPremiumCents", newAnnualPremiumCents);
  const total = BigInt(termDays(termStart, termEndDate));
  const remaining = total - BigInt(elapsedTermDays(termStart, termEndDate, effectiveAt));
  const annualDifference = BigInt(newAnnualPremiumCents - oldAnnualPremiumCents);
  if (annualDifference >= 0n) {
    return Number(floorDiv(annualDifference * remaining, total));
  }
  return -Number(ceilDiv(-annualDifference * remaining, total));
}

// State premium tax charged on a premium amount, rate in basis points (300 = 3.00%),
// rounded down because the customer pays it. Example: 3% of 120000 = 3600 cents.
export function stateTaxCents(premiumCents: number, taxRateBps: number): number {
  assertCents("premiumCents", premiumCents);
  assertCents("taxRateBps", taxRateBps);
  return Number(floorDiv(BigInt(premiumCents) * BigInt(taxRateBps), 10000n));
}

// Tax given back with a premium refund, rounded up because the customer receives it.
// Example: 3% of 87214 = 2616.42 -> 2617 cents refunded.
export function refundedTaxCents(refundedPremiumCents: number, taxRateBps: number): number {
  assertCents("refundedPremiumCents", refundedPremiumCents);
  assertCents("taxRateBps", taxRateBps);
  return Number(ceilDiv(BigInt(refundedPremiumCents) * BigInt(taxRateBps), 10000n));
}

// Broker commission on collected premium (tax and fee excluded), rate in basis points,
// rounded down. Example: 15% of 120000 = 18000 cents.
export function commissionCents(collectedPremiumCents: number, commissionRateBps: number): number {
  assertCents("collectedPremiumCents", collectedPremiumCents);
  assertCents("commissionRateBps", commissionRateBps);
  return Number(floorDiv(BigInt(collectedPremiumCents) * BigInt(commissionRateBps), 10000n));
}

export type CancellationRefund = {
  unearnedPremiumCents: number;
  refundedTaxCents: number;
  refundedFeeCents: number; // always 0: the flat policy fee is fully earned at issuance
  totalRefundCents: number;
};

// Pro-rata cancellation refund: unearned premium, the tax on it, never the fee.
// Example (366-day term, 3% tax, cancelled on day 100): 87214 + 2617 + 0 = 89831 cents.
export function proRataCancellationRefund(
  writtenPremiumCents: number,
  taxRateBps: number,
  termStart: CalendarDate,
  termEndDate: CalendarDate,
  cancelAt: CalendarDate,
): CancellationRefund {
  const unearned = unearnedPremiumCents(writtenPremiumCents, termStart, termEndDate, cancelAt);
  const tax = refundedTaxCents(unearned, taxRateBps);
  return { unearnedPremiumCents: unearned, refundedTaxCents: tax, refundedFeeCents: 0, totalRefundCents: unearned + tax };
}
