import { test } from "node:test";
import assert from "node:assert/strict";
import { foldPolicyEvents, type PolicyEvent } from "./policy-as-of";
import {
  AFTER_BOTH_ENDORSEMENTS,
  BEFORE_BOTH_ENDORSEMENTS,
  BETWEEN_THE_TWO_ENDORSEMENTS,
  EXAMPLE_FIRST_ENDORSEMENT,
  EXAMPLE_GENERATED_AT,
  EXAMPLE_ISSUED_EVENT,
  EXAMPLE_POLICY_EVENTS,
  EXAMPLE_SECOND_ENDORSEMENT,
} from "./example-policy";

function snapshotOn(asOf: string, events: PolicyEvent[] = EXAMPLE_POLICY_EVENTS) {
  return foldPolicyEvents(events, asOf, EXAMPLE_GENERATED_AT);
}

test("the recited example: the policy as issued, March 1 2028, California", () => {
  // Decided by Yoann (docs/DECISIONS.md): $1,200 premium, 2.35% California tax = $28.20,
  // $25 fee, charge $1,253.20. The fold must produce exactly those cents.
  const snapshot = snapshotOn(BEFORE_BOTH_ENDORSEMENTS);
  assert.equal(snapshot.policyNumber, "POL-2028-000001");
  assert.equal(snapshot.annualPremiumCents, 120000);
  assert.equal(snapshot.taxRateBasisPoints, 235);
  assert.equal(snapshot.taxCents, 2820);
  assert.equal(snapshot.feeCents, 2500);
  assert.equal(snapshot.totalChargeCents, 125320);
  assert.equal(snapshot.termStart, "2028-03-01");
  assert.equal(snapshot.termEnd, "2029-03-01");
  assert.equal(snapshot.status, "issued");
  assert.equal(snapshot.stateName, "California");
});

test("before the first endorsement, neither endorsement is on the document", () => {
  const snapshot = snapshotOn(BEFORE_BOTH_ENDORSEMENTS);
  assert.equal(snapshot.endorsements.length, 0);
  assert.equal(snapshot.annualPremiumCents, 120000);
  assert.equal(snapshot.coverageLines[0].limitCents, 100000000); // $1,000,000 each occurrence
});

test("between the two endorsements, only the first one counts", () => {
  const snapshot = snapshotOn(BETWEEN_THE_TWO_ENDORSEMENTS);
  assert.equal(snapshot.endorsements.length, 1);
  assert.equal(snapshot.endorsements[0].effectiveAt, "2028-06-09");
  assert.equal(snapshot.endorsements[0].premiumDeltaCents, 43561); // prorated charge
  assert.equal(snapshot.endorsements[0].annualPremiumCentsAfter, 180000);
  assert.equal(snapshot.annualPremiumCents, 180000);
  assert.equal(snapshot.taxCents, 4230); // 180000 x 2.35% exactly
  assert.equal(snapshot.totalChargeCents, 186730);
  assert.equal(snapshot.coverageLines[0].limitCents, 200000000); // raised to $2,000,000
});

test("after both endorsements, the running annual premium is the second one's", () => {
  const snapshot = snapshotOn(AFTER_BOTH_ENDORSEMENTS);
  assert.equal(snapshot.endorsements.length, 2);
  assert.equal(snapshot.endorsements[1].premiumDeltaCents, -14877); // credited, ceiled
  assert.equal(snapshot.annualPremiumCents, 150000);
  assert.equal(snapshot.taxCents, 3525);
  assert.equal(snapshot.totalChargeCents, 156025);
  // Coverage is unchanged by an endorsement that carries no coverage lines.
  assert.equal(snapshot.coverageLines[0].limitCents, 200000000);
  assert.equal(snapshot.annualPremiumCentsAtIssuance, 120000);
});

test("an endorsement effective exactly on the as-of date is included", () => {
  const snapshot = snapshotOn("2028-06-09");
  assert.equal(snapshot.endorsements.length, 1);
  assert.equal(snapshot.annualPremiumCents, 180000);
});

test("the day before, it is not", () => {
  const snapshot = snapshotOn("2028-06-08");
  assert.equal(snapshot.endorsements.length, 0);
  assert.equal(snapshot.annualPremiumCents, 120000);
});

test("the result does not depend on the order the events arrive in", () => {
  const shuffled = [EXAMPLE_SECOND_ENDORSEMENT, EXAMPLE_ISSUED_EVENT, EXAMPLE_FIRST_ENDORSEMENT];
  assert.deepEqual(snapshotOn(AFTER_BOTH_ENDORSEMENTS, shuffled), snapshotOn(AFTER_BOTH_ENDORSEMENTS));
});

test("a cancellation sets the status and its effective date", () => {
  const cancellation: PolicyEvent = {
    id: "evt-cancelled",
    eventType: "cancelled",
    effectiveAt: "2028-06-09",
    recordedAt: "2028-06-09T16:00:00.000Z",
    payload: { description: "Cancelled at the insured's request" },
  };
  const events = [...EXAMPLE_POLICY_EVENTS, cancellation];
  const beforeCancellation = foldPolicyEvents(events, "2028-06-08", EXAMPLE_GENERATED_AT);
  assert.equal(beforeCancellation.status, "issued");
  assert.equal(beforeCancellation.cancelledEffectiveAt, null);

  const afterCancellation = foldPolicyEvents(events, "2028-06-30", EXAMPLE_GENERATED_AT);
  assert.equal(afterCancellation.status, "cancelled");
  assert.equal(afterCancellation.cancelledEffectiveAt, "2028-06-09");
});

// --------------------------------------------------------------------------------------
// The correction the brief asks about: an endorsement was booked three weeks ago with the
// wrong effective date. Nothing is edited. The wrong event is reversed and the corrected
// one is re-booked, and both stay in the list forever.
// --------------------------------------------------------------------------------------

const ENDORSEMENT_WITH_WRONG_DATE: PolicyEvent = {
  id: "evt-endorsement-wrong-date",
  eventType: "endorsed",
  effectiveAt: "2028-07-01", // typed in as July 1
  recordedAt: "2028-07-01T09:00:00.000Z",
  payload: {
    description: "General Liability each-occurrence limit raised to $2,000,000",
    annualPremiumCents: 180000,
    // 60000 x 243 remaining days / 365 = 39945.2 -> 39945 cents, the amount charged when
    // the endorsement was believed to start on July 1.
    premiumDeltaCents: 39945,
  },
};

const REVERSAL_OF_THE_WRONG_DATE: PolicyEvent = {
  id: "evt-correction-reversal",
  eventType: "correction_reversal",
  effectiveAt: "2028-07-01", // the reversal lands on the date it is undoing
  recordedAt: "2028-07-22T10:15:00.000Z",
  supersedesEventId: ENDORSEMENT_WITH_WRONG_DATE.id,
  payload: { description: "Reverses the endorsement booked with the wrong effective date" },
};

const REBOOK_AT_THE_RIGHT_DATE: PolicyEvent = {
  id: "evt-correction-rebook",
  eventType: "correction_rebook",
  effectiveAt: "2028-06-09", // the date the change really took effect
  recordedAt: "2028-07-22T10:15:00.000Z",
  payload: {
    rebookedEventType: "endorsed",
    description: "General Liability each-occurrence limit raised to $2,000,000 (corrected date)",
    annualPremiumCents: 180000,
    premiumDeltaCents: 43561, // repriced from June 9: 60000 x 265 / 365
  },
};

const CORRECTED_POLICY_EVENTS = [
  EXAMPLE_ISSUED_EVENT,
  ENDORSEMENT_WITH_WRONG_DATE,
  REVERSAL_OF_THE_WRONG_DATE,
  REBOOK_AT_THE_RIGHT_DATE,
];

test("after the correction, the endorsement is in force from the corrected date", () => {
  const snapshot = foldPolicyEvents(CORRECTED_POLICY_EVENTS, "2028-06-20", EXAMPLE_GENERATED_AT);
  assert.equal(snapshot.endorsements.length, 1);
  assert.equal(snapshot.endorsements[0].effectiveAt, "2028-06-09");
  assert.equal(snapshot.endorsements[0].premiumDeltaCents, 43561);
  assert.equal(snapshot.annualPremiumCents, 180000);
});

test("the reversed event never appears again, not even on a later date", () => {
  const snapshot = foldPolicyEvents(CORRECTED_POLICY_EVENTS, "2028-12-31", EXAMPLE_GENERATED_AT);
  assert.equal(snapshot.endorsements.length, 1);
  assert.deepEqual(
    snapshot.endorsements.map((endorsement) => endorsement.premiumDeltaCents),
    [43561],
  );
});

test("what we believed before the correction is still reproducible", () => {
  // Knowledge time is the caller's filter: keep only the events recorded by then, then fold
  // exactly as usual. On July 10 the correction had not been made yet, so on June 20 the
  // policy still showed the original $1,200 premium and no endorsement.
  const knownOn = "2028-07-10T00:00:00.000Z";
  const knownEvents = CORRECTED_POLICY_EVENTS.filter((event) => event.recordedAt <= knownOn);
  const asWeBelievedIt = foldPolicyEvents(knownEvents, "2028-06-20", EXAMPLE_GENERATED_AT);
  assert.equal(asWeBelievedIt.endorsements.length, 0);
  assert.equal(asWeBelievedIt.annualPremiumCents, 120000);

  // And on July 5, with the same knowledge, the wrongly dated endorsement was in force.
  const asWeBelievedItInJuly = foldPolicyEvents(knownEvents, "2028-07-05", EXAMPLE_GENERATED_AT);
  assert.equal(asWeBelievedItInJuly.endorsements.length, 1);
  assert.equal(asWeBelievedItInJuly.endorsements[0].premiumDeltaCents, 39945);
});

test("a correction not yet effective on the as-of date does not apply", () => {
  // The reversal is effective July 1, so a document for June 20 that ignores the re-book
  // would be wrong: the re-book itself is effective June 9 and does apply. This checks the
  // other side: on June 1 nothing at all has happened yet.
  const snapshot = foldPolicyEvents(CORRECTED_POLICY_EVENTS, "2028-06-01", EXAMPLE_GENERATED_AT);
  assert.equal(snapshot.endorsements.length, 0);
  assert.equal(snapshot.annualPremiumCents, 120000);
});

// --------------------------------------------------------------------------------------
// Failure paths: a malformed event must stop the document, not print a wrong one.
// --------------------------------------------------------------------------------------

test("a policy with no issuance on that date cannot produce a document", () => {
  assert.throws(
    () => snapshotOn("2028-02-28"),
    /no issued policy event effective on or before 2028-02-28/,
  );
});

test("a reversal that names nothing, or an unknown event, is refused", () => {
  const namelessReversal: PolicyEvent = {
    id: "evt-bad-reversal",
    eventType: "correction_reversal",
    effectiveAt: "2028-06-09",
    recordedAt: "2028-06-10T00:00:00.000Z",
    payload: {},
  };
  assert.throws(
    () => foldPolicyEvents([EXAMPLE_ISSUED_EVENT, namelessReversal], "2028-07-01", EXAMPLE_GENERATED_AT),
    /must name the event it reverses/,
  );

  const danglingReversal: PolicyEvent = { ...namelessReversal, supersedesEventId: "evt-does-not-exist" };
  assert.throws(
    () => foldPolicyEvents([EXAMPLE_ISSUED_EVENT, danglingReversal], "2028-07-01", EXAMPLE_GENERATED_AT),
    /reverses unknown event evt-does-not-exist/,
  );
});

test("a re-book that does not say what it re-books is refused", () => {
  const rebookWithoutType: PolicyEvent = { ...REBOOK_AT_THE_RIGHT_DATE, payload: { annualPremiumCents: 180000 } };
  assert.throws(
    () => foldPolicyEvents([EXAMPLE_ISSUED_EVENT, rebookWithoutType], "2028-07-01", EXAMPLE_GENERATED_AT),
    /payload.rebookedEventType is required/,
  );
});

test("a missing or fractional payload field is refused with the field name", () => {
  const withoutPremium: PolicyEvent = {
    ...EXAMPLE_FIRST_ENDORSEMENT,
    payload: { description: "no premium", premiumDeltaCents: 1 },
  };
  assert.throws(
    () => foldPolicyEvents([EXAMPLE_ISSUED_EVENT, withoutPremium], "2028-07-01", EXAMPLE_GENERATED_AT),
    /payload.annualPremiumCents must be an integer number of cents/,
  );

  const fractionalDelta: PolicyEvent = {
    ...EXAMPLE_FIRST_ENDORSEMENT,
    payload: { ...EXAMPLE_FIRST_ENDORSEMENT.payload, premiumDeltaCents: 43561.5 },
  };
  assert.throws(
    () => foldPolicyEvents([EXAMPLE_ISSUED_EVENT, fractionalDelta], "2028-07-01", EXAMPLE_GENERATED_AT),
    /payload.premiumDeltaCents must be an integer number of cents/,
  );
});

test("an endorsement before the issuance is refused", () => {
  const earlyEndorsement: PolicyEvent = { ...EXAMPLE_FIRST_ENDORSEMENT, effectiveAt: "2028-01-01" };
  assert.throws(
    () => foldPolicyEvents([EXAMPLE_ISSUED_EVENT, earlyEndorsement], "2028-07-01", EXAMPLE_GENERATED_AT),
    /an endorsement cannot precede the issuance/,
  );
});

test("a malformed date is refused instead of being compared as a string", () => {
  assert.throws(() => snapshotOn("2028-6-9"), /not a calendar date/);
});
