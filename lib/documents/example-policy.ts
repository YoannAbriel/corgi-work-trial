import type { PolicyEvent } from "./policy-as-of";

// The worked example everybody in this repository uses, as policy events.
//
// It is the one Yoann decided on 2026-09-08 and recites at the debrief (docs/DECISIONS.md):
// $1,200 annual premium, written March 1, 2028, term to March 1, 2029 (365 days: February
// 29, 2028 falls before the term), California premium tax 2.35% = $28.20, flat policy fee
// $25, so the customer is charged $1,253.20 (125320 cents).
//
// Two endorsements are added so a document can be produced before, between and after them:
//   day 100 (June 9, 2028)  annual premium $1,200 -> $1,800; prorated charge
//                           60000 x 265 / 365 = 43561.64 -> 43561 cents (charged, so floored)
//   September 1, 2028       annual premium $1,800 -> $1,500; prorated credit
//                           30000 x 181 / 365 = 14876.71 -> 14877 cents (credited, so ceiled)
// Both figures come from `endorsementDeltaCents` in lib/money/premium.ts; they are written
// out here so a reader can check them without running anything.
//
// The values live in a shared module because the tests of the fold and the tests of the two
// PDF documents must be looking at the same policy; a seed script can use it too. Names,
// addresses and the policy number are invented for the trial: no real person or company.

export const EXAMPLE_TERM_START = "2028-03-01";
export const EXAMPLE_TERM_END = "2029-03-01";

// Effective dates worth printing a document for.
export const BEFORE_BOTH_ENDORSEMENTS = "2028-05-01";
export const BETWEEN_THE_TWO_ENDORSEMENTS = "2028-07-15";
export const AFTER_BOTH_ENDORSEMENTS = "2028-10-01";

export const EXAMPLE_ISSUED_EVENT: PolicyEvent = {
  id: "evt-issued",
  eventType: "issued",
  effectiveAt: EXAMPLE_TERM_START,
  recordedAt: "2028-02-25T15:04:11.000Z",
  payload: {
    policyNumber: "POL-2028-000001",
    insuredName: "Blue Ridge Contracting LLC",
    insuredAddress: {
      line1: "120 Market Street",
      line2: "Suite 300",
      city: "San Francisco",
      state: "CA",
      postalCode: "94105",
    },
    brokerName: "Golden Gate Brokerage LLC",
    stateCode: "CA",
    stateName: "California",
    taxRateBasisPoints: 235,
    termStart: EXAMPLE_TERM_START,
    termEnd: EXAMPLE_TERM_END,
    feeCents: 2500,
    annualPremiumCents: 120000,
    coverageLines: [
      {
        name: "General Liability - Each Occurrence",
        limitCents: 100000000,
        description: "Bodily injury and property damage arising from operations.",
      },
      {
        name: "General Liability - Aggregate",
        limitCents: 200000000,
        description: "Total payable for the policy term.",
      },
    ],
  },
};

export const EXAMPLE_FIRST_ENDORSEMENT: PolicyEvent = {
  id: "evt-endorsement-1",
  eventType: "endorsed",
  effectiveAt: "2028-06-09",
  recordedAt: "2028-06-09T09:12:45.000Z",
  payload: {
    description: "General Liability each-occurrence limit raised to $2,000,000",
    annualPremiumCents: 180000,
    premiumDeltaCents: 43561,
    coverageLines: [
      {
        name: "General Liability - Each Occurrence",
        limitCents: 200000000,
        description: "Bodily injury and property damage arising from operations.",
      },
      {
        name: "General Liability - Aggregate",
        limitCents: 400000000,
        description: "Total payable for the policy term.",
      },
    ],
  },
};

export const EXAMPLE_SECOND_ENDORSEMENT: PolicyEvent = {
  id: "evt-endorsement-2",
  eventType: "endorsed",
  effectiveAt: "2028-09-01",
  recordedAt: "2028-09-01T11:30:00.000Z",
  payload: {
    description: "Scheduled location removed",
    annualPremiumCents: 150000,
    premiumDeltaCents: -14877,
  },
};

// The policy with both endorsements, in the order the database would return them.
export const EXAMPLE_POLICY_EVENTS: PolicyEvent[] = [
  EXAMPLE_ISSUED_EVENT,
  EXAMPLE_FIRST_ENDORSEMENT,
  EXAMPLE_SECOND_ENDORSEMENT,
];

// A fixed instant for the footer of the generated documents, so a test comparing two runs
// compares the policy and not the clock.
export const EXAMPLE_GENERATED_AT = "2026-09-08T12:34:56.000Z";
