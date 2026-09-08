import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeStatement,
  firstDayOfMonth,
  lastDayOfMonth,
  monthOfFirstDay,
  type BrokerJournalEntry,
} from "./compute";

// The recited example (DECISIONS.md): $1,200 annual premium written and paid on 2028-03-01,
// California premium tax 2820 cents, $25 fee, 15% commission, cancelled effective 2028-06-09 with
// the refund completing the same day.
//   collected 125320 (120000 + 2820 + 2500), commission 18000, refund 89172, clawback 13068.
const BROKER_ID = "33333333-3333-4333-8333-333333333333";
const POLICY = { policyId: "22222222-2222-4222-8222-222222222222", policyNumber: "CGP-01001" };

// A journal entry built by hand, so every test says exactly which movements it is about.
function entry(fields: Partial<BrokerJournalEntry> & { entryId: string; entryType: string; effectiveAt: string }): BrokerJournalEntry {
  return {
    recordedAt: "2028-03-01T10:00:00.000Z",
    policyId: POLICY.policyId,
    policyNumber: POLICY.policyNumber,
    description: fields.entryType,
    cashCents: 0,
    commissionPayableCents: 0,
    ...fields,
  };
}

const marchCollection = entry({
  entryId: "aaaaaaa1-0000-4000-8000-000000000001",
  entryType: "premium_collected",
  effectiveAt: "2028-03-01",
  cashCents: 125320,
  description: "Policy CGP-01001 premium, tax and fee collected at Stripe",
});
const marchCommission = entry({
  entryId: "aaaaaaa1-0000-4000-8000-000000000002",
  entryType: "commission_earned",
  effectiveAt: "2028-03-01",
  commissionPayableCents: 18000,
  description: "Broker commission on the collected premium of policy CGP-01001",
});

test("the March statement of the recited example: cash collected, commission earned, nothing else", () => {
  const statement = computeStatement({
    brokerId: BROKER_ID,
    statementMonth: "2028-03",
    entries: [marchCollection, marchCommission],
  });

  assert.equal(statement.lines.length, 2);
  assert.deepEqual(
    statement.lines.map((line) => [line.kind, line.amountCents]),
    [
      ["premium_collected", 125320],
      ["commission_earned", 18000],
    ],
  );
  assert.equal(statement.totals.premiumCollectedCents, 125320);
  assert.equal(statement.totals.commissionEarnedCents, 18000);
  assert.equal(statement.totals.clawbackCents, 0);
  // What the broker is owed for March: the whole commission, because nothing was given back yet.
  assert.equal(statement.totals.netDueCents, 18000);
});

test("commission is earned on the premium, so it is not 15% of the cash collected", () => {
  const statement = computeStatement({
    brokerId: BROKER_ID,
    statementMonth: "2028-03",
    entries: [marchCollection, marchCommission],
  });
  // 15% of the 120000 premium, not of the 125320 the customer paid (which includes the 2820 of
  // state premium tax and the 2500 policy fee). The screens say this in words next to the figures.
  assert.equal(statement.totals.commissionEarnedCents, 18000);
  assert.notEqual(statement.totals.commissionEarnedCents, Math.floor((125320 * 1500) / 10000));
});

const juneRefund = entry({
  entryId: "bbbbbbb1-0000-4000-8000-000000000001",
  entryType: "refund_completed",
  effectiveAt: "2028-06-09",
  cashCents: -89172,
  description: "Policy CGP-01001 refund paid back to the customer at Stripe",
});
const juneClawback = entry({
  entryId: "bbbbbbb1-0000-4000-8000-000000000002",
  entryType: "commission_clawback",
  effectiveAt: "2028-06-09",
  commissionPayableCents: -13068,
  description: "Broker commission clawed back on the refunded premium of policy CGP-01001",
});

test("the June statement of the recited example: the clawback, and the refund it was computed on", () => {
  const statement = computeStatement({
    brokerId: BROKER_ID,
    statementMonth: "2028-06",
    entries: [juneRefund, juneClawback],
  });

  assert.deepEqual(
    statement.lines.map((line) => [line.kind, line.amountCents]),
    [
      ["refund", -89172],
      ["clawback", -13068],
    ],
  );
  // The total is read out loud as "how much was clawed back", so it is stored positive.
  assert.equal(statement.totals.clawbackCents, 13068);
  assert.equal(statement.totals.commissionEarnedCents, 0);
  // The refund is the customer's money, not the broker's: it is on the statement as the reason
  // for the clawback and it changes no total.
  assert.equal(statement.totals.premiumCollectedCents, 0);
  assert.equal(statement.totals.netDueCents, -13068);
});

test("across the two months the broker keeps the commission on the premium the customer used", () => {
  const march = computeStatement({ brokerId: BROKER_ID, statementMonth: "2028-03", entries: [marchCollection, marchCommission] });
  const june = computeStatement({ brokerId: BROKER_ID, statementMonth: "2028-06", entries: [juneRefund, juneClawback] });
  assert.equal(march.totals.netDueCents + june.totals.netDueCents, 4932);
});

test("a voided binding nets to zero: the reversal carries the mirrored movement", () => {
  // A correction reverses the four issuance entries at their own effective date
  // (lib/ledger/reverse.ts), so the reversal lands in the same month with the opposite movement.
  const reversedCollection = entry({
    entryId: "ccccccc1-0000-4000-8000-000000000001",
    entryType: "reversal_of_premium_collected",
    effectiveAt: "2028-03-01",
    cashCents: -125320,
    description: "bound on a payment Stripe never made",
  });
  const reversedCommission = entry({
    entryId: "ccccccc1-0000-4000-8000-000000000002",
    entryType: "reversal_of_commission_earned",
    effectiveAt: "2028-03-01",
    commissionPayableCents: -18000,
    description: "bound on a payment Stripe never made",
  });

  const statement = computeStatement({
    brokerId: BROKER_ID,
    statementMonth: "2028-03",
    entries: [marchCollection, marchCommission, reversedCollection, reversedCommission],
  });

  // The four entries are all listed: nothing is hidden, the statement shows the money and the
  // correction that took it back.
  assert.equal(statement.lines.length, 4);
  assert.equal(statement.totals.premiumCollectedCents, 0);
  assert.equal(statement.totals.commissionEarnedCents, 0);
  assert.equal(statement.totals.netDueCents, 0);
});

test("a correction recorded after the cutoff is simply not among the entries, and the earlier hash comes back", () => {
  // The cutoff is applied by the SQL read (lib/statements/journal.ts); what this proves is the
  // consequence for the document: the hash is a function of the entries alone, so re-running with
  // the old cutoff reproduces revision 1 byte for byte, and running with a later cutoff, which
  // brings the correction in, produces a different hash.
  const revisionOne = computeStatement({ brokerId: BROKER_ID, statementMonth: "2028-03", entries: [marchCollection, marchCommission] });
  const correction = entry({
    entryId: "ddddddd1-0000-4000-8000-000000000001",
    entryType: "reversal_of_commission_earned",
    effectiveAt: "2028-03-01",
    recordedAt: "2028-07-02T09:00:00.000Z", // recorded four months later
    commissionPayableCents: -18000,
    description: "commission corrected",
  });

  const revisionTwo = computeStatement({
    brokerId: BROKER_ID,
    statementMonth: "2028-03",
    entries: [marchCollection, marchCommission, correction],
  });
  const rerunOfRevisionOne = computeStatement({ brokerId: BROKER_ID, statementMonth: "2028-03", entries: [marchCollection, marchCommission] });

  assert.equal(rerunOfRevisionOne.contentHash, revisionOne.contentHash);
  assert.notEqual(revisionTwo.contentHash, revisionOne.contentHash);
  assert.equal(revisionTwo.totals.netDueCents, 0);
});

test("a day is told in the order a reader expects: the cash first, then what it did to the commission", () => {
  // Fed in the opposite order on purpose. Without the reading order, two entries with the same
  // effective date would be printed in the order of their random ids.
  const march = computeStatement({ brokerId: BROKER_ID, statementMonth: "2028-03", entries: [marchCommission, marchCollection] });
  assert.deepEqual(march.lines.map((line) => line.kind), ["premium_collected", "commission_earned"]);
  assert.deepEqual(march.lines.map((line) => line.lineOrder), [0, 1]);

  const june = computeStatement({ brokerId: BROKER_ID, statementMonth: "2028-06", entries: [juneClawback, juneRefund] });
  assert.deepEqual(june.lines.map((line) => line.kind), ["refund", "clawback"]);
});

test("the hash does not depend on the order the database returned the rows in", () => {
  const inOneOrder = computeStatement({ brokerId: BROKER_ID, statementMonth: "2028-03", entries: [marchCollection, marchCommission] });
  const inTheOther = computeStatement({ brokerId: BROKER_ID, statementMonth: "2028-03", entries: [marchCommission, marchCollection] });
  assert.equal(inTheOther.contentHash, inOneOrder.contentHash);
});

test("the hash is a sha256 of a text a human can read", () => {
  const statement = computeStatement({ brokerId: BROKER_ID, statementMonth: "2028-03", entries: [marchCollection, marchCommission] });
  assert.match(statement.contentHash, /^[0-9a-f]{64}$/);
  assert.match(statement.canonicalText, /^corgi\.broker-statement\.v1\n/);
  assert.match(statement.canonicalText, /\ntotals\|125320\|18000\|0\|0\|18000\n$/);
});

test("a payment parked in the suspense account and applied later is still premium collected", () => {
  // Rule 14 (DECISIONS.md): the premium_collected entry then debits unapplied_customer_cash
  // instead of cash_stripe. The SQL read adds both accounts together, so the statement sees the
  // same cash whichever path the payment took.
  const applied = entry({
    entryId: "eeeeeee1-0000-4000-8000-000000000001",
    entryType: "premium_collected",
    effectiveAt: "2028-03-04",
    cashCents: 125320,
    description: "Policy CGP-01001 premium, tax and fee applied from the customer's unapplied cash",
  });
  const statement = computeStatement({ brokerId: BROKER_ID, statementMonth: "2028-03", entries: [applied] });
  assert.equal(statement.totals.premiumCollectedCents, 125320);
});

test("an entry that moves the payable and nothing else recognises is an adjustment, and net due still ties", () => {
  const unknown = entry({
    entryId: "fffffff1-0000-4000-8000-000000000001",
    entryType: "commission_settlement_to_broker",
    effectiveAt: "2028-03-20",
    commissionPayableCents: -18000,
    description: "an entry type this build does not know yet",
  });
  const statement = computeStatement({
    brokerId: BROKER_ID,
    statementMonth: "2028-03",
    entries: [marchCollection, marchCommission, unknown],
  });
  assert.equal(statement.lines[2].kind, "adjustment");
  assert.equal(statement.totals.adjustmentCents, -18000);
  // The point of the adjustment kind: net due is the movement of commission_payable, always.
  assert.equal(statement.totals.netDueCents, 0);
});

test("an entry that moves neither cash nor the payable is not on the statement", () => {
  const earnedPremium = entry({
    entryId: "9999999a-0000-4000-8000-000000000001",
    entryType: "premium_earned_to_date",
    effectiveAt: "2028-03-31",
    description: "premium earned up to the cancellation",
  });
  const statement = computeStatement({ brokerId: BROKER_ID, statementMonth: "2028-03", entries: [marchCommission, earnedPremium] });
  assert.equal(statement.lines.length, 1);
  assert.equal(statement.lines[0].kind, "commission_earned");
});

test("a month with no entry at all is a real statement: no lines, everything zero", () => {
  const statement = computeStatement({ brokerId: BROKER_ID, statementMonth: "2028-04", entries: [] });
  assert.equal(statement.lines.length, 0);
  assert.equal(statement.totals.netDueCents, 0);
  assert.match(statement.contentHash, /^[0-9a-f]{64}$/);
});

test("the statement month is written YYYY-MM and refuses anything else", () => {
  assert.throws(() => computeStatement({ brokerId: BROKER_ID, statementMonth: "2028-3", entries: [] }), /statement month/);
  assert.throws(() => computeStatement({ brokerId: BROKER_ID, statementMonth: "2028-13", entries: [] }), /statement month/);
  assert.throws(() => computeStatement({ brokerId: BROKER_ID, statementMonth: "2028-03-01", entries: [] }), /statement month/);
});

test("the first and last day of a month are counted, not assumed", () => {
  assert.equal(firstDayOfMonth("2028-03"), "2028-03-01");
  assert.equal(lastDayOfMonth("2028-03"), "2028-03-31");
  assert.equal(lastDayOfMonth("2028-02"), "2028-02-29"); // 2028 is a leap year
  assert.equal(lastDayOfMonth("2029-02"), "2029-02-28");
  assert.equal(lastDayOfMonth("2028-12"), "2028-12-31");
  assert.equal(monthOfFirstDay("2028-03-01"), "2028-03");
});
