import { createHash } from "node:crypto";

// The broker monthly statement, computed from the journal and from nothing else.
//
// Pure: this file reads no database, calls no provider and has no clock. It takes the journal
// entries of one broker for one month (already filtered by the caller on effective_at and on the
// knowledge cutoff) and returns the statement lines, the totals and the canonical text that is
// hashed. That is what makes the figures testable line by line, and what makes a re-run of a
// closed month byte-for-byte identical: same entries in, same text out, same hash.
//
// WORKED EXAMPLE, the recited one (DECISIONS.md): $1,200 annual premium, California premium tax
// 2820 cents, $25 fee, 15% commission, policy effective and paid 2028-03-01, cancelled effective
// 2028-06-09 with the refund completing the same day.
//
//   March 2028 statement
//     premium_collected  policy CGP-01234   +125320   (1200.00 premium + 28.20 tax + 25.00 fee)
//     commission_earned  policy CGP-01234    +18000   (15% of the 120000 premium)
//     premium collected 125320, commission earned 18000, clawback 0, NET DUE 18000
//
//   June 2028 statement
//     refund             policy CGP-01234    -89172   (87124 unearned premium + 2048 tax)
//     clawback           policy CGP-01234    -13068   (15% of the 87124 refunded, rounded down)
//     premium collected 0, commission earned 0, clawback 13068, NET DUE -13068
//
// The broker keeps 18000 - 13068 = 4932 cents, the commission on the premium the customer really
// used. Nothing in either month is recomputed from a rate table: every figure is the movement of
// a ledger account that was posted when the money moved.
//
// WHY "PREMIUM COLLECTED" IS NOT COMMISSION DIVIDED BY THE RATE. The premium_collected line is
// the CASH side of the ledger's premium_collected entry, so it holds the premium, the state
// premium tax and the policy fee together: that is the money the customer actually paid.
// Commission is earned on the premium alone (Yoann's rule, DECISIONS.md), so 18000 is 15% of
// 120000 and not 15% of 125320. The screens and the PDF say this in words next to the figures.
//
// WHICH ENTRIES ARE ON THE STATEMENT. Two rules, and the second one is what makes net due true:
//   1. every entry that moves this broker's commission_payable is on the statement, whatever its
//      type. An entry type nobody anticipated becomes an 'adjustment' line rather than being
//      dropped, so net due is ALWAYS the movement of commission_payable, never an approximation.
//   2. the collections and the refunds are on it too, because they are the cash the commission
//      and the clawback were computed on. They do not add to net due.
// Everything else in the journal (writing premium, billing tax, earning premium, claim money) is
// not a movement of what the broker is owed and is deliberately absent.
//
// REVERSALS NEED NO SPECIAL ARITHMETIC. A reversal entry carries the mirror image of the original
// lines (lib/ledger/reverse.ts), so its movement is already the opposite sign. A voided binding
// therefore contributes +18000 and -18000 in the same month and nets to zero on its own.

export type StatementLineKind =
  | "premium_collected"
  | "commission_earned"
  | "clawback"
  | "refund"
  | "adjustment";

// One journal entry of the broker, reduced to the two account movements a statement cares about.
// The caller (lib/statements/journal.ts) produces these with one SQL query; the shape is small on
// purpose, so this file can be read without knowing any SQL.
export type BrokerJournalEntry = {
  entryId: string;
  entryType: string; // 'premium_collected', 'commission_earned', 'reversal_of_commission_earned', ...
  effectiveAt: string; // business date, "YYYY-MM-DD"
  recordedAt: string; // booking time, ISO-8601 UTC, set by the database
  policyId: string | null;
  policyNumber: string | null;
  description: string;
  // Signed movement of the cash accounts (cash_stripe and unapplied_customer_cash), debits minus
  // credits: positive when money came in, negative when it went out.
  cashCents: number;
  // Signed movement of commission_payable, credits minus debits: positive when the broker is owed
  // more, negative when commission is taken back.
  commissionPayableCents: number;
};

export type StatementLine = {
  lineOrder: number;
  kind: StatementLineKind;
  policyId: string | null;
  policyNumber: string | null;
  journalEntryId: string;
  effectiveAt: string;
  entryRecordedAt: string;
  amountCents: number;
  description: string;
};

export type StatementTotals = {
  premiumCollectedCents: number;
  commissionEarnedCents: number;
  clawbackCents: number; // positive: how much was clawed back
  adjustmentCents: number;
  netDueCents: number;
};

export type ComputedStatement = {
  lines: StatementLine[];
  totals: StatementTotals;
  // The exact text that was hashed, kept so a reader can see what the hash covers instead of
  // trusting it. It is short enough to print at the bottom of a debug page.
  canonicalText: string;
  contentHash: string; // sha256 of canonicalText, lowercase hex
};

export type StatementInput = {
  brokerId: string;
  statementMonth: string; // "YYYY-MM"
  entries: BrokerJournalEntry[];
};

// A journal entry that undoes another one is named after it: 'reversal_of_commission_earned'
// reverses 'commission_earned' (lib/ledger/reverse.ts). Stripping the prefix is how a reversal
// lands on the same statement line kind as the entry it undoes, with the opposite amount.
const REVERSAL_PREFIX = "reversal_of_";

export function computeStatement(input: StatementInput): ComputedStatement {
  assertStatementMonth(input.statementMonth);

  const lines: StatementLine[] = [];
  for (const entry of sortedForReading(input.entries)) {
    const line = statementLineFor(entry, lines.length);
    if (line) {
      lines.push(line);
    }
  }

  const totals = totalsOf(lines);

  // The invariant this whole slice rests on: what the broker is owed for the month IS the
  // movement of commission_payable, to the cent. Rule 1 above guarantees it by construction, and
  // this is the assertion that says so out loud: if an entry that moved the payable were ever
  // dropped, the statement would refuse to be computed rather than quietly understate what a
  // broker is owed.
  const payableMovementCents = input.entries.reduce((total, entry) => total + entry.commissionPayableCents, 0);
  if (totals.netDueCents !== payableMovementCents) {
    throw new Error(
      `statement net due ${totals.netDueCents} does not equal the commission_payable movement ${payableMovementCents}: an entry that moves the broker's payable was not put on a line`,
    );
  }

  const canonicalText = canonicalTextOf(input, lines, totals);
  return { lines, totals, canonicalText, contentHash: sha256Hex(canonicalText) };
}

// The one line a journal entry produces, or null when the entry is none of the statement's
// business. The amount always comes from a movement the ledger actually posted; nothing here
// multiplies a rate by anything.
function statementLineFor(entry: BrokerJournalEntry, lineOrder: number): StatementLine | null {
  const baseType = entry.entryType.startsWith(REVERSAL_PREFIX)
    ? entry.entryType.slice(REVERSAL_PREFIX.length)
    : entry.entryType;

  const kindAndAmount = classify(baseType, entry);
  if (!kindAndAmount) {
    return null;
  }
  return {
    lineOrder,
    kind: kindAndAmount.kind,
    policyId: entry.policyId,
    policyNumber: entry.policyNumber,
    journalEntryId: entry.entryId,
    effectiveAt: entry.effectiveAt,
    entryRecordedAt: entry.recordedAt,
    amountCents: kindAndAmount.amountCents,
    description: entry.description,
  };
}

function classify(
  baseType: string,
  entry: BrokerJournalEntry,
): { kind: StatementLineKind; amountCents: number } | null {
  // The cash the commission was earned on. Both accounts count: a payment that was parked in the
  // suspense account and applied later (rule 14, DECISIONS.md) debits unapplied_customer_cash
  // instead of cash_stripe, and it is the same customer money either way.
  if (baseType === "premium_collected") {
    return { kind: "premium_collected", amountCents: entry.cashCents };
  }
  // The cash the clawback was computed on.
  if (baseType === "refund_completed") {
    return { kind: "refund", amountCents: entry.cashCents };
  }
  if (baseType === "commission_earned") {
    return { kind: "commission_earned", amountCents: entry.commissionPayableCents };
  }
  if (baseType === "commission_clawback") {
    return { kind: "clawback", amountCents: entry.commissionPayableCents };
  }
  // Rule 1: anything else that moved the broker's payable still has to be on the statement.
  if (entry.commissionPayableCents !== 0) {
    return { kind: "adjustment", amountCents: entry.commissionPayableCents };
  }
  return null;
}

function totalsOf(lines: StatementLine[]): StatementTotals {
  let premiumCollectedCents = 0;
  let commissionEarnedCents = 0;
  let clawbackCents = 0;
  let adjustmentCents = 0;

  for (const line of lines) {
    if (line.kind === "premium_collected") {
      premiumCollectedCents += line.amountCents;
    } else if (line.kind === "commission_earned") {
      commissionEarnedCents += line.amountCents;
    } else if (line.kind === "clawback") {
      // A clawback line is negative (it reduces what the broker is owed); the total is stored as
      // "how much was clawed back", which is the way it is read out loud.
      clawbackCents -= line.amountCents;
    } else if (line.kind === "adjustment") {
      adjustmentCents += line.amountCents;
    }
    // 'refund' lines are context: they are the cash the clawback was computed on, and the broker
    // does not pay the refund, so they change nothing in the totals.
  }

  return {
    premiumCollectedCents,
    commissionEarnedCents,
    clawbackCents,
    adjustmentCents,
    netDueCents: commissionEarnedCents - clawbackCents + adjustmentCents,
  };
}

// The order the statement is printed and hashed in: by business date, then by the entry id, which
// is unique. Two runs over the same entries therefore build the same list even if the database
// returned the rows in a different order.
function sortedForReading(entries: BrokerJournalEntry[]): BrokerJournalEntry[] {
  return [...entries].sort((left, right) => {
    if (left.effectiveAt !== right.effectiveAt) {
      return left.effectiveAt < right.effectiveAt ? -1 : 1;
    }
    return left.entryId < right.entryId ? -1 : left.entryId > right.entryId ? 1 : 0;
  });
}

// The text the content hash is taken of. It is deliberately plain and pipe-separated rather than
// JSON: a reader can see, in one glance, that the hash covers the broker, the month, every line
// with the journal entry it came from, and the totals. What it does NOT cover is the revision
// number, the knowledge cutoff and the moment the run happened: two runs that listed the same
// money have the same hash, which is exactly the question "did anything change?".
function canonicalTextOf(input: StatementInput, lines: StatementLine[], totals: StatementTotals): string {
  const rows = [
    "corgi.broker-statement.v1",
    `broker|${input.brokerId}`,
    `month|${input.statementMonth}`,
  ];
  for (const line of lines) {
    rows.push(
      [
        "line",
        line.lineOrder,
        line.kind,
        line.policyNumber ?? "",
        line.journalEntryId,
        line.effectiveAt,
        line.entryRecordedAt,
        line.amountCents,
      ].join("|"),
    );
  }
  rows.push(
    [
      "totals",
      totals.premiumCollectedCents,
      totals.commissionEarnedCents,
      totals.clawbackCents,
      totals.adjustmentCents,
      totals.netDueCents,
    ].join("|"),
  );
  return rows.join("\n") + "\n";
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// The statement month, as a small value
// ---------------------------------------------------------------------------

// A statement month is written "YYYY-MM" everywhere a human sees it, and stored as the first day
// of the month in the database. These three functions are the only place that conversion happens.

const STATEMENT_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isStatementMonth(text: string): boolean {
  return STATEMENT_MONTH.test(text);
}

export function assertStatementMonth(month: string): void {
  if (!isStatementMonth(month)) {
    throw new Error(`"${month}" is not a statement month; write it as YYYY-MM, for example 2028-03`);
  }
}

// "2028-03" -> "2028-03-01", the value stored in statement_runs.statement_month.
export function firstDayOfMonth(month: string): string {
  assertStatementMonth(month);
  return `${month}-01`;
}

// "2028-03" -> "2028-03-31". Computed by stepping back one day from the first of the next month,
// in UTC, so no month length and no leap year is written down anywhere.
export function lastDayOfMonth(month: string): string {
  assertStatementMonth(month);
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const firstOfNextMonth = Date.UTC(year, monthNumber, 1); // month is 1-based here, 0-based in Date.UTC
  return new Date(firstOfNextMonth - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// "2028-03-01" (as the database returns it) -> "2028-03".
export function monthOfFirstDay(firstDay: string): string {
  return firstDay.slice(0, 7);
}
