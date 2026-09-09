import { test } from "node:test";
import assert from "node:assert/strict";
import {
  brokerSections,
  customerSections,
  staffSections,
  type BrokerPolicyFacts,
  type CustomerPolicyFacts,
  type InboxSection,
  type StaffFacts,
} from "./sections";

// The grouping of the inbox, proved without a database: the facts go in as plain objects, the
// sections come out. What is checked here is what the notification centre promises:
//
//   1. an item lands in exactly one section, and in the right one;
//   2. every section exists even when it is empty, so its anchor and its empty sentence exist;
//   3. the link of an item points at the page that does the work, with the ids of that item;
//   4. two payments still to move on one claim make ONE line, because the sidebar counts claims.

const QUOTED_AT = new Date("2026-09-01T10:00:00Z");
const REQUESTED_AT = new Date("2026-09-02T10:00:00Z");
const APPROVED_AT = new Date("2026-09-03T10:00:00Z");

function brokerPolicy(fields: Partial<BrokerPolicyFacts> = {}): BrokerPolicyFacts {
  return {
    policyId: "policy-1",
    policyNumber: "COR-2026-0001",
    customerName: "Acme Roofing",
    status: "bound",
    totalChargeCents: 120000,
    quotedAt: QUOTED_AT,
    liveEndorsement: null,
    correctionsToCollect: [],
    ...fields,
  };
}

function section(sections: InboxSection[], anchor: string): InboxSection {
  const found = sections.find((candidate) => candidate.anchor === anchor);
  assert.ok(found, `no section with anchor ${anchor}`);
  return found;
}

test("a broker sees a policy to pay only while it is not bound", () => {
  const sections = brokerSections([
    brokerPolicy({ policyId: "a", policyNumber: "COR-A", status: "awaiting_payment" }),
    brokerPolicy({ policyId: "b", policyNumber: "COR-B", status: "bound" }),
  ]);
  const toPay = section(sections, "policies");
  assert.equal(toPay.items.length, 1);
  assert.equal(toPay.items[0].subject, "COR-A");
  assert.equal(toPay.items[0].amountCents, 120000);
  assert.equal(toPay.items[0].href, "/policies/a");
  assert.equal(toPay.items[0].since, QUOTED_AT);
});

test("an approved endorsement is the broker's delta to pay, an unapproved one is only information", () => {
  const sections = brokerSections([
    brokerPolicy({
      policyId: "a",
      policyNumber: "COR-A",
      liveEndorsement: {
        requestEventId: "event-a",
        state: "approved",
        description: "limit raised to $2,000,000.00",
        deltaTotalCents: 45000,
        requestedAt: REQUESTED_AT,
        approvedAt: APPROVED_AT,
      },
    }),
    brokerPolicy({
      policyId: "b",
      policyNumber: "COR-B",
      liveEndorsement: {
        requestEventId: "event-b",
        state: "awaiting_approval",
        description: "limit raised to $3,000,000.00",
        deltaTotalCents: 90000,
        requestedAt: REQUESTED_AT,
        approvedAt: null,
      },
    }),
  ]);

  const deltas = section(sections, "endorsement-deltas");
  assert.equal(deltas.items.length, 1);
  assert.equal(deltas.items[0].subject, "COR-A");
  assert.equal(deltas.items[0].amountCents, 45000);
  // The delta became payable when the customer said yes, not when the quote was made.
  assert.equal(deltas.items[0].since, APPROVED_AT);

  const waiting = section(sections, "waiting-for-the-customer");
  assert.equal(waiting.items.length, 1);
  assert.equal(waiting.items[0].subject, "COR-B");
  assert.match(waiting.items[0].what, /Nothing for you to do/);
});

test("every broker section exists when nothing is waiting, with its empty sentence", () => {
  const sections = brokerSections([]);
  assert.deepEqual(
    sections.map((one) => one.anchor),
    ["policies", "endorsement-deltas", "correction-differences", "waiting-for-the-customer"],
  );
  for (const one of sections) {
    assert.equal(one.items.length, 0);
    assert.ok(one.emptySentence.length > 0);
  }
});

test("a customer's approval links carry the event that is being approved", () => {
  const policies: CustomerPolicyFacts[] = [
    {
      policyId: "p1",
      policyNumber: "COR-A",
      liveEndorsement: {
        requestEventId: "event-9",
        state: "awaiting_approval",
        description: "limit raised",
        deltaTotalCents: 70000,
        requestedAt: REQUESTED_AT,
        approvedAt: null,
      },
      correctionsToApprove: [
        { rebookEventId: "rebook-7", amountCents: 55000, recordedAt: REQUESTED_AT, correctedEffectiveAt: "2026-03-01" },
      ],
    },
  ];
  const sections = customerSections(policies);
  assert.equal(section(sections, "policies").items[0].href, "/policies/p1/endorsements/event-9/approve");
  assert.equal(section(sections, "corrections").items[0].href, "/policies/p1/corrections/rebook-7/approve");
  assert.equal(section(sections, "corrections").items[0].amountCents, 55000);
});

function staffFacts(fields: Partial<StaffFacts> = {}): StaffFacts {
  return { approvals: [], paidNotBound: [], paidNotApplied: [], claimPayments: [], breaks: [], ...fields };
}

test("two payments still to move on one claim make one line, with their total", () => {
  const sections = staffSections(
    staffFacts({
      claimPayments: [
        { claimId: "c1", claimNumber: "CLM-1", amountCents: 30000, railStatus: "ready to send", requestedAt: APPROVED_AT },
        { claimId: "c1", claimNumber: "CLM-1", amountCents: 20000, railStatus: "waiting for approval", requestedAt: REQUESTED_AT },
        { claimId: "c2", claimNumber: "CLM-2", amountCents: 10000, railStatus: "ready to send", requestedAt: REQUESTED_AT },
      ],
    }),
    "staff_ops",
  );
  const claims = section(sections, "claims");
  assert.equal(claims.items.length, 2);
  assert.equal(claims.items[0].subject, "CLM-1");
  assert.equal(claims.items[0].amountCents, 50000);
  assert.equal(claims.items[0].href, "/ops/claims/c1");
  // The oldest of the two requests is how long this claim has been waiting.
  assert.equal(claims.items[0].since, REQUESTED_AT);
  assert.match(claims.items[0].what, /ready to send, waiting for approval/);
});

test("a request raised by an agent says so, and only an approver is told they can decide", () => {
  const facts = staffFacts({
    approvals: [
      {
        kind: "claim_payment",
        amountCents: 120000,
        requestedByName: "Dana Ops",
        raisedByAgent: true,
        requestedAt: REQUESTED_AT,
      },
    ],
  });

  const approver = section(staffSections(facts, "staff_approver"), "approvals");
  assert.match(approver.title, /waiting for your decision/);
  assert.match(approver.items[0].what, /raised by an agent/);
  assert.equal(approver.items[0].actionLabel, "Decide");
  assert.equal(approver.items[0].href, "/ops/approvals");

  const operator = section(staffSections(facts, "staff_ops"), "approvals");
  assert.match(operator.title, /waiting for an approver/);
  assert.match(operator.items[0].what, /distinct staff approver/);
});

test("the five staff sections exist in order, empty or not", () => {
  assert.deepEqual(
    staffSections(staffFacts(), "staff_ops").map((one) => one.anchor),
    ["approvals", "policies", "endorsements", "claims", "reconciliation"],
  );
});
