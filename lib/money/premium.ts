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

// One piece of written premium and the day it starts earning.
//
// A policy that was never endorsed has exactly ONE segment: the annual premium, earning from the
// term start to the term end. An endorsement adds a second one: the prorated delta it charged
// (or gave back, and then the amount is negative) earns from ITS OWN effective date to the same
// term end (ARCHITECTURE.md section 3). That is why the current annual premium is not the
// written premium after an endorsement: $1,200 raised to $1,800 on day 100 wrote 120000 over the
// whole term plus 43561 over the last 265 days, never 180000 over the whole term.
export type WrittenPremiumSegment = {
  writtenPremiumCents: number; // signed: negative when an endorsement gave premium back
  startsOn: CalendarDate; // the day this piece of premium starts earning
  endsOn: CalendarDate; // always the end of the policy term
};

// Earned premium of one segment at `asOf`, rounded DOWN in every case, including a negative
// segment: rounding down always makes the earned figure smaller, so the unearned figure (what
// the customer gets back) is the larger one. That is the same "insurer eats the penny" rule as
// everywhere else, applied once per segment.
export function earnedPremiumOfSegment(segment: WrittenPremiumSegment, asOf: CalendarDate): number {
  const total = BigInt(termDays(segment.startsOn, segment.endsOn));
  const elapsed = BigInt(elapsedTermDays(segment.startsOn, segment.endsOn, asOf));
  const written = BigInt(segment.writtenPremiumCents);
  const product = written * elapsed;
  // BigInt division truncates towards zero, which for a negative product would round UP.
  // floorDiv is written out here so the direction is the same on both signs.
  const quotient = product / total;
  const roundedDown = product % total === 0n || product >= 0n ? quotient : quotient - 1n;
  return Number(roundedDown);
}

// Earned premium of a whole policy at `asOf`: every segment, added up.
export function earnedPremiumAcrossSegments(segments: WrittenPremiumSegment[], asOf: CalendarDate): number {
  return segments.reduce((earned, segment) => earned + earnedPremiumOfSegment(segment, asOf), 0);
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

// The same tax refund, never larger than the tax the customer actually paid.
//
// Why the cap exists (review finding F-B1-07, docs/reviews/b1-ledger-core.md): the tax charged
// is rounded DOWN and the tax refunded is rounded UP, so a cancellation on the very first day
// of the term can give back one cent more than was ever collected. Written premium 100001 at
// 3%: charged floor(100001 x 3%) = 3000, refunded on day 0 ceil(100001 x 3%) = 3001. That one
// cent would leave premium_tax_payable negative for the policy, which would mean the state owes
// us tax we never collected. The cap is the honest rule: the customer gets back at most what
// was charged, and the ceiling still applies everywhere below that.
export function refundedTaxCentsCappedAtCharged(
  refundedPremiumCents: number,
  taxRateBps: number,
  taxChargedCents: number,
): number {
  assertCents("taxChargedCents", taxChargedCents);
  return Math.min(refundedTaxCents(refundedPremiumCents, taxRateBps), taxChargedCents);
}

// Broker commission on collected premium (tax and fee excluded), rate in basis points,
// rounded down. Example: 15% of 120000 = 18000 cents.
export function commissionCents(collectedPremiumCents: number, commissionRateBps: number): number {
  assertCents("collectedPremiumCents", collectedPremiumCents);
  assertCents("commissionRateBps", commissionRateBps);
  return Number(floorDiv(BigInt(collectedPremiumCents) * BigInt(commissionRateBps), 10000n));
}

// Everything a mid-term cancellation owes, in one place. The cancellation preview shown to the
// broker BEFORE confirming and the amounts actually posted to the ledger both come from this
// function and from nowhere else, so the screen cannot promise a figure the ledger will not book.
export type CancellationBreakdownInput = {
  // Every piece of premium written on the policy and the day it starts earning. A policy that
  // was never endorsed has exactly one segment (the annual premium over the whole term); each
  // applied endorsement adds its own (lib/policy/current.ts builds the list from the events).
  writtenPremiumSegments: WrittenPremiumSegment[];
  taxChargedCents: number; // state premium tax charged and not yet given back
  taxRateBps: number;
  commissionRateBps: number; // broker commission rate, for the clawback
  cancellationEffectiveAt: CalendarDate; // the day coverage stops, not the day the form was filled
};

export type CancellationBreakdown = {
  termDays: number; // actual days of the term, 365 or 366
  earnedDays: number; // days of cover the customer keeps
  writtenPremiumCents: number; // every segment added up: not the current annual premium
  earnedPremiumCents: number; // premium earned up to the cancellation date, rounded down
  unearnedPremiumCents: number; // written minus earned: exactly what is refunded
  refundedTaxCents: number; // tax on the unearned premium, rounded up, capped at the tax charged
  taxRefundWasCappedAtCharged: boolean; // true when the ceiling was cut by the cap (F-B1-07)
  refundedFeeCents: number; // always 0: the flat policy fee is fully earned at issuance
  totalRefundCents: number; // what Stripe is asked to send back
  commissionClawbackCents: number; // commission taken back from the broker, rounded down
};

// Pro-rata cancellation: the customer keeps the days of cover already used and gets the rest
// back, with the state premium tax that rode on it, and never the policy fee. The broker gives
// back commission on the refunded premium.
//
// Worked example, the recited one (DECISIONS.md, 2026-09-08): $1,200 written on 2028-03-01,
// California 2.35% (2820 cents charged), $25 fee, 15% commission, cancelled on 2028-06-09,
// which is day 100 of a 365-day term. One segment, because nothing was endorsed.
//   earned    = floor(120000 x 100 / 365) = 32876 cents (the insurer eats the fraction)
//   unearned  = 120000 - 32876            = 87124 cents
//   tax back  = ceil(87124 x 235 / 10000) = 2048 cents, and 2048 < 2820 so the cap does nothing
//   fee back  =                              0 cents
//   refund    = 87124 + 2048              = 89172 cents ($891.72)
//   clawback  = floor(87124 x 1500/10000) = 13068 cents (13068.6, rounded down)
//
// Second worked example, the same policy raised to $1,800 effective 2028-06-09 (43561 cents of
// prorated premium charged over the last 265 days) and cancelled on 2028-09-07, day 190:
//   issuance segment  earned floor(120000 x 190 / 365)      = 62465, unearned 57535
//   endorsement segm. earned floor(43561 x 90 / 265)        = 14794, unearned 28767
//   written 163561, earned 77259, unearned                  = 86302 cents
//   tax back  = ceil(86302 x 235 / 10000)                   = 2029, under the 3843 charged
//   refund    = 86302 + 2029                                = 88331 cents
//   clawback  = floor(86302 x 1500 / 10000)                 = 12945 cents
// Each segment is rounded in the customer's favour, so the total sits just above pricing the
// whole thing on the new annual premium (180000 x 175 / 365 = 86301.37, one cent less). That is
// the same penny rule as everywhere else, applied once per segment.
export function cancellationBreakdown(input: CancellationBreakdownInput): CancellationBreakdown {
  const [issuanceSegment] = input.writtenPremiumSegments;
  if (!issuanceSegment) {
    throw new Error("a cancellation needs at least the issuance segment of written premium");
  }
  // The term is the issuance segment's window: an endorsement changes what is covered, never
  // when the policy ends.
  const totalTermDays = termDays(issuanceSegment.startsOn, issuanceSegment.endsOn);
  const earnedDays = elapsedTermDays(issuanceSegment.startsOn, issuanceSegment.endsOn, input.cancellationEffectiveAt);
  const written = input.writtenPremiumSegments.reduce((total, segment) => total + segment.writtenPremiumCents, 0);
  const earned = earnedPremiumAcrossSegments(input.writtenPremiumSegments, input.cancellationEffectiveAt);
  const unearned = written - earned;

  // Two calls on purpose: the capped function is the single implementation of the rule, and the
  // uncapped one is only used to say whether the cap changed anything (shown in the preview).
  const uncappedTax = refundedTaxCents(unearned, input.taxRateBps);
  const tax = refundedTaxCentsCappedAtCharged(unearned, input.taxRateBps, input.taxChargedCents);

  return {
    termDays: totalTermDays,
    earnedDays,
    writtenPremiumCents: written,
    earnedPremiumCents: earned,
    unearnedPremiumCents: unearned,
    refundedTaxCents: tax,
    taxRefundWasCappedAtCharged: tax < uncappedTax,
    refundedFeeCents: 0,
    totalRefundCents: unearned + tax,
    commissionClawbackCents: commissionCents(unearned, input.commissionRateBps),
  };
}
