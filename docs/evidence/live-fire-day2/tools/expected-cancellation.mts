// Read-only: the expected refund of CGP-01707 cancelled pro rata effective 2026-11-08, from the
// repository's pure function (lib/money/premium.ts, cancellationBreakdown) and nothing else.
// The segments are the written premium entries read on the policy page after LIVE-9.
import { cancellationBreakdown } from "@/lib/money/premium";

const breakdown = cancellationBreakdown({
  writtenPremiumSegments: [
    { writtenPremiumCents: 120000, startsOn: "2026-09-08", endsOn: "2027-09-08" }, // issuance
    { writtenPremiumCents: 115397, startsOn: "2026-09-22", endsOn: "2027-09-08" }, // corrected endorsement (LIVE-8)
    { writtenPremiumCents: 28109, startsOn: "2026-10-01", endsOn: "2027-09-08" }, // second endorsement (LIVE-9)
  ],
  taxChargedCents: 2820 + 2711 + 660, // tax billed and not given back: issuance, re-booked endorsement, second endorsement
  taxRateBps: 235,
  commissionRateBps: 1500,
  cancellationEffectiveAt: "2026-11-08",
});

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
console.log(JSON.stringify(breakdown, null, 2));
console.log(`refund ${usd(breakdown.totalRefundCents)}, clawback ${usd(breakdown.commissionClawbackCents)}, earned ${usd(breakdown.earnedPremiumCents)}, unearned ${usd(breakdown.unearnedPremiumCents)}, tax back ${usd(breakdown.refundedTaxCents)}`);
console.log(`money-out threshold: ${breakdown.totalRefundCents > 100000 ? "above $1,000, a distinct approver is required" : "at or below $1,000"}`);
