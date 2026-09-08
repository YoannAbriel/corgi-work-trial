import type { CalendarDate } from "@/lib/money/dates";

// What a policy looked like on one particular day.
//
// This is the only input the document renderers accept. It is a plain value: no database
// handle, no provider client, nothing to fetch. `foldPolicyEvents` (policy-as-of.ts) builds
// it from the policy's events, so a declarations page for "March 15, 2028" and one for
// "today" go through exactly the same code with a different `asOf`.
//
// Every money field is an integer number of cents (USD). There is no float anywhere in this
// file, and none in the renderers either.

// One line of coverage on the declarations page, for example "General Liability, $1,000,000".
export type CoverageLine = {
  // Name printed in the coverage table, e.g. "General Liability - Each Occurrence".
  name: string;
  // Limit of liability, in integer cents. $1,000,000 is 100_000_000.
  limitCents: number;
  // One short sentence printed under the name; empty string when there is nothing to add.
  description: string;
};

// An endorsement that had taken effect on or before the snapshot date.
// The endorsement schedule prints one row per entry, in effective-date order.
export type AppliedEndorsement = {
  // Business date the change took effect. This is the date the money is priced from,
  // never the date somebody typed it in (Track 1 rule, docs/DECISIONS.md).
  effectiveAt: CalendarDate;
  // Instant the change was recorded in our system, ISO-8601 in UTC, e.g.
  // "2028-06-09T14:32:07.000Z". Printed next to the effective date so a reader can see a
  // backdated endorsement for what it is.
  recordedAt: string;
  // What changed, in one sentence, e.g. "General Liability limit raised to $2,000,000".
  description: string;
  // Prorated premium for this endorsement, in integer cents, priced from `effectiveAt` to
  // the end of the term. Positive: charged to the customer. Negative: credited back.
  // This is the amount that moves money; it is NOT the change in the annual premium.
  premiumDeltaCents: number;
  // The policy's annual premium once this endorsement had applied, in integer cents.
  // The endorsement schedule prints this as the running annual premium.
  annualPremiumCentsAfter: number;
};

// Lifecycle state of the policy on the snapshot date.
// `issued` covers a policy in force; `cancelled` means a cancellation was effective on or
// before `asOf`. A policy whose term has ended is still `issued` here: expiry is not a
// business decision, and the term dates on the document already say it.
export type PolicyStatus = "issued" | "cancelled";

// A US mailing address, printed as-is on the declarations page.
export type MailingAddress = {
  line1: string;
  line2: string; // empty string when there is no second line
  city: string;
  state: string; // two-letter USPS code, e.g. "CA"
  postalCode: string;
};

export type PolicySnapshot = {
  // Identity of the policy, e.g. "POL-2028-000001".
  policyNumber: string;

  // Who is insured, and where. Printed on the declarations page.
  insuredName: string;
  insuredAddress: MailingAddress;

  // Producing broker, printed on both documents.
  brokerName: string;

  // Two-letter code of the state whose premium tax applies, e.g. "CA", and its full name
  // ("California") for the tax line of the declarations page.
  stateCode: string;
  stateName: string;

  // Policy term. Both are calendar dates "YYYY-MM-DD" with no time and no timezone
  // (see lib/money/dates.ts). A term runs to the same calendar date next year.
  termStart: CalendarDate;
  termEnd: CalendarDate;

  // Coverage as it stood on `asOf`, in the order it is printed.
  coverageLines: CoverageLine[];

  // Annual premium in force on `asOf`, in integer cents: the issuance premium plus the
  // annual effect of every endorsement applied by then. $1,200.00 is 120000.
  annualPremiumCents: number;

  // Annual premium the policy was issued with, in integer cents. The endorsement schedule
  // starts its running annual premium from this figure; without it the column would begin
  // in mid-air, because an endorsement's `premiumDeltaCents` is a prorated amount and not
  // the change in the annual premium.
  annualPremiumCentsAtIssuance: number;

  // State premium tax on `annualPremiumCents`, in integer cents, at `taxRateBasisPoints`.
  // California is 235 basis points = 2.35% (docs/DECISIONS.md, Cal. Const. art. XIII s. 28(d)).
  // Computed by the same function the ledger uses (lib/money/premium.ts, rounded down).
  taxRateBasisPoints: number;
  taxCents: number;

  // Flat policy fee, in integer cents, charged once at issuance and never refunded.
  feeCents: number;

  // What the customer is charged for a full annual term as it stands on `asOf`:
  // annualPremiumCents + taxCents + feeCents. This is a policy figure, not a payment
  // history: what was actually collected lives in the ledger, not on this document.
  totalChargeCents: number;

  status: PolicyStatus;
  // Set only when `status` is "cancelled": the date the cancellation took effect.
  cancelledEffectiveAt: CalendarDate | null;

  // Endorsements effective on or before `asOf`, oldest first.
  endorsements: AppliedEndorsement[];

  // The business date this snapshot describes: "the policy as it stood on `asOf`".
  asOf: CalendarDate;

  // Instant the document was produced, ISO-8601 in UTC. Printed in the footer so two
  // copies of the same as-of date can be told apart.
  generatedAt: string;
};
