import { strict as assert } from "node:assert";
import { test } from "node:test";
import { dayWindow, flowOfLine, intoWeeks, runningBalances, signedBalanceCents } from "./read";

// The five rules the ledger screen rests on, proven without a database. Each test uses the
// figures of the trial database so the numbers in the comments of read.ts can be checked here.

test("a debit account's balance is debits minus credits, a credit account's is the other way", () => {
  // cash_stripe is a debit account: 958181 collected, 657585 refunded, 300596 still held.
  assert.equal(signedBalanceCents("debit", 958181, 657585), 300596);
  // The same two figures on a credit account mean the opposite: money owed, not money held.
  assert.equal(signedBalanceCents("credit", 958181, 657585), -300596);
  // unearned_premium is a credit account: 926411 written, 696275 released, 230136 still unearned.
  assert.equal(signedBalanceCents("credit", 696275, 926411), 230136);
});

test("a debit account that has only been credited answers a negative balance", () => {
  assert.equal(signedBalanceCents("debit", 0, 120000), -120000);
  assert.equal(signedBalanceCents("debit", 0, 0), 0);
});

test("the running balance is counted from the oldest row shown to the newest", () => {
  // Newest first, as the screen prints them: +1000 today, -400 yesterday, +2500 the day before.
  assert.deepEqual(runningBalances([1000, -400, 2500]), [3100, 2100, 2500]);
  // The last element is always the oldest row's own movement: the window starts at zero.
  assert.deepEqual(runningBalances([5, 10]), [15, 10]);
  assert.deepEqual(runningBalances([]), []);
  assert.deepEqual(runningBalances([-750]), [-750]);
});

test("the running balance of one row is its own movement plus everything older shown", () => {
  const movements = [120300, -532265, 112561, 125320];
  const balances = runningBalances(movements);
  assert.equal(balances[3], 125320);
  assert.equal(balances[2], 125320 + 112561);
  assert.equal(balances[1], 125320 + 112561 - 532265);
  assert.equal(balances[0], 125320 + 112561 - 532265 + 120300);
  // The newest row's balance is the sum of the whole window, which is what makes it readable.
  assert.equal(
    balances[0],
    movements.reduce((total, one) => total + one, 0),
  );
});

test("a window of days ends on the day asked for and includes it", () => {
  assert.deepEqual(dayWindow(7, "2026-09-09"), ["2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09"]);
  assert.equal(dayWindow(30, "2026-09-09").length, 30);
  assert.equal(dayWindow(30, "2026-09-09")[0], "2026-08-11");
  assert.deepEqual(dayWindow(1, "2026-09-09"), ["2026-09-09"]);
});

test("a window of days crosses a month and a year without losing a day", () => {
  assert.deepEqual(dayWindow(3, "2026-03-02"), ["2026-02-28", "2026-03-01", "2026-03-02"]);
  assert.deepEqual(dayWindow(2, "2027-01-01"), ["2026-12-31", "2027-01-01"]);
  assert.equal(dayWindow(90, "2026-09-09")[0], "2026-06-12");
});

test("a line is classified by its account and the side it moves", () => {
  assert.deepEqual(flowOfLine("cash_stripe", 125320, 0), { kind: "collected", amountCents: 125320 });
  assert.deepEqual(flowOfLine("cash_stripe", 0, 532265), { kind: "refunded", amountCents: 532265 });
  assert.deepEqual(flowOfLine("commission_expense", 29450, 0), { kind: "commission", amountCents: 29450 });
  assert.deepEqual(flowOfLine("claim_reserve", 0, 500000), { kind: "reserves", amountCents: 500000 });
});

test("the facing line of a collection is not a flow of its own", () => {
  // Dr cash_stripe 125320 / Cr premium_receivable 125320: one collection, counted once.
  assert.equal(flowOfLine("premium_receivable", 0, 125320), null);
  // A commission CLAWBACK credits commission_expense; it is not commission booked that day.
  assert.equal(flowOfLine("commission_expense", 0, 29450), null);
  // A reserve being released debits claim_reserve; it does not open a reserve.
  assert.equal(flowOfLine("claim_reserve", 120000, 0), null);
  assert.equal(flowOfLine("cash_claims_rail", 0, 120000), null);
});

test("seven days at a time, named by the first day, with the sums of the days they hold", () => {
  const days = dayWindow(14, "2026-09-09").map((day, index) => ({
    day,
    collectedCents: index === 7 ? 845457 : 0,
    refundedCents: 0,
    commissionCents: index === 7 ? 122441 : 0,
    reservesCents: 0,
  }));
  const weeks = intoWeeks(days);
  assert.equal(weeks.length, 2);
  assert.equal(weeks[0].day, "2026-08-27");
  assert.equal(weeks[0].collectedCents, 0);
  assert.equal(weeks[1].day, "2026-09-03");
  assert.equal(weeks[1].collectedCents, 845457);
  assert.equal(weeks[1].commissionCents, 122441);
});

test("a window that is not a multiple of seven keeps its last days in a shorter group", () => {
  const days = dayWindow(9, "2026-09-09").map((day) => ({ day, collectedCents: 100, refundedCents: 0, commissionCents: 0, reservesCents: 0 }));
  const weeks = intoWeeks(days);
  assert.equal(weeks.length, 2);
  assert.equal(weeks[0].collectedCents, 700);
  assert.equal(weeks[1].collectedCents, 200);
  // Nothing is lost and nothing is counted twice: the groups add up to the window.
  assert.equal(
    weeks.reduce((total, one) => total + one.collectedCents, 0),
    900,
  );
});
