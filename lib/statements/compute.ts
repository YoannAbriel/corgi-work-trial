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
//     premium_collected  CGP-01234   cash +125320   of which premium +120000
//     commission_earned  CGP-01234        +18000    15% of the 120000
//     cash collected 125320, premium collected 120000, commission earned 18000, NET DUE 18000
//
//   June 2028 statement
//     refund             CGP-01234   cash -89172    of which premium -87124
//     clawback           CGP-01234        -13068    15% of the 87124, rounded down
//     cash collected 0, premium collected 0, clawback 13068, NET DUE -13068
//
// The two collected totals count COLLECTIONS only. A refund is money going the other way, so it
// stays a line, next to the clawback it produced, rather than being netted into a total called
// "collected".
//
// The broker keeps 18000 - 13068 = 4932 cents, the commission on the premium the customer really
// used. Nothing in either month is recomputed from a rate table: every figure is the movement of
// a ledger account that was posted when the money moved.
//
// TWO MONEY FIGURES, AND WHY BOTH (decision 19, DECISIONS.md 16:53Z). The cash side of a
// collection entry is what the customer paid: premium, state premium tax and policy fee together.
// Commission is earned on the premium alone (Yoann's rule), so 18000 is 15% of 120000 and not 15%
// of 125320. The statement therefore prints both, and the multiplication reads on the line. The
// premium part is not recomputed either: it is the movement of unearned_premium posted by the same
// money operation as the cash entry, read by lib/statements/journal.ts.
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
  // Signed movement of unearned_premium posted by the same money operation as this entry, credits
  // minus debits: the PREMIUM part of the cash, which is what commission is earned on. Positive on
  // a collection (+120000 in the recited example), negative on a refund (-87124), and zero on an
  // entry whose operation wrote no premium.
  unearnedPremiumCents: number;
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
  // On a cash line, the premium part of that cash: what commission is earned on. Null on a
  // commission, clawback or adjustment line, where the question does not arise.
  commissionBaseCents: number | null;
  description: string;
};

export type StatementTotals = {
  cashCollectedCents: number; // what the customers paid: premium, tax and fee
  premiumCollectedCents: number; // the premium alone, which is the commission base
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

// Which shape a statement is in. It is written on every run (statement_runs.canonical_version,
// migration 0016) and on the first line of the text that is hashed, so a stored document can
// always say how to read itself.
//
//   1  the premium column held the CASH, there was no separate cash column, and no line carried a
//      commission base. Every run written before migration 0015 is in this shape.
//   2  the cash and the premium are two figures, and every cash line carries the premium it holds.
//
// Bumping this is not a formality: a run of an older version keeps its lines, its totals and its
// hash forever, and a new run is honestly not comparable with it by hash.
// v3 since 2026-09-09 (decision 22): the F-B8-08 fix made each refund line carry its own premium
// base, which changes the canonical text, so the format number moves with it. A run of an
// earlier version keeps the meaning it was written with; the screen says "format changed, not
// comparable by hash" between two revisions of different versions instead of "identical" or
// "changed". Versions 2 and 3 share the same column meanings (cash and premium stored apart);
// version 1 does not (its premium column held the cash).
export const CANONICAL_STATEMENT_VERSION = 3;
export const FIRST_VERSION_WITH_PREMIUM_COLUMN = 2;
// F-PP-06: declared as a plain readonly list of numbers so its use site needs no cast.
export const STATEMENT_VERSIONS_WITH_KNOWN_TOTALS: readonly number[] = [2, 3];

// What the note says on a screen or a document rendered from a v1 row.
export const STATEMENT_FORMAT_V1_NOTE =
  "Statement format v1: the premium column holds the cash collected (premium, tax and fee together), and the commission base was not stored. A newer revision of this month, run today, records both figures.";

// The two collected figures of a run, read according to the shape the run says it is in. This is
// the one place that knows what an old column meant, so no screen has to.
export type CollectedFigures = {
  cashCollectedCents: number;
  // Null on a v1 run: the premium alone was never stored, and showing the cash under a "premium"
  // label is exactly the mistake this function exists to prevent.
  premiumCollectedCents: number | null;
  formatNote: string | null;
};

export function collectedFigures(run: {
  canonicalVersion: number;
  cashCollectedCents: number;
  premiumCollectedCents: number;
}): CollectedFigures {
  if (run.canonicalVersion >= FIRST_VERSION_WITH_PREMIUM_COLUMN) {
    return {
      cashCollectedCents: run.cashCollectedCents,
      premiumCollectedCents: run.premiumCollectedCents,
      formatNote: null,
    };
  }
  // v1: the column named premium held the cash, and cash_collected_cents was filled by a default
  // rather than by a run, so it says nothing at all.
  return {
    cashCollectedCents: run.premiumCollectedCents,
    premiumCollectedCents: null,
    formatNote: STATEMENT_FORMAT_V1_NOTE,
  };
}

export function computeStatement(input: StatementInput): ComputedStatement {
  assertStatementMonth(input.statementMonth);

  // Classify first, then order, then number: the reading order depends on what each entry turned
  // out to be, and the line number is simply its place in that order.
  const classified = input.entries.map(statementLineFor).filter((line) => line !== null);
  const lines = sortedForReading(classified).map((line, position) => ({ ...line, lineOrder: position }));

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
// multiplies a rate by anything. The line number is filled in afterwards, once the lines are in
// their reading order.
function statementLineFor(entry: BrokerJournalEntry): StatementLine | null {
  const baseType = entry.entryType.startsWith(REVERSAL_PREFIX)
    ? entry.entryType.slice(REVERSAL_PREFIX.length)
    : entry.entryType;

  const kindAndAmount = classify(baseType, entry);
  if (!kindAndAmount) {
    return null;
  }
  return {
    lineOrder: 0, // replaced by the position in the ordered list
    kind: kindAndAmount.kind,
    policyId: entry.policyId,
    policyNumber: entry.policyNumber,
    journalEntryId: entry.entryId,
    effectiveAt: entry.effectiveAt,
    entryRecordedAt: entry.recordedAt,
    amountCents: kindAndAmount.amountCents,
    // Only a cash line has a premium part. A commission line IS the commission, so asking what
    // premium it was computed on would be asking the question twice.
    commissionBaseCents: isCashLine(kindAndAmount.kind) ? entry.unearnedPremiumCents : null,
    description: entry.description,
  };
}

function isCashLine(kind: StatementLineKind): boolean {
  return kind === "premium_collected" || kind === "refund";
}

// WHAT THE STATEMENT DOES WITH EVERY ENTRY TYPE THE LEDGER CAN POST, in one table.
//
// It exists because the same bug happened twice: a slice added an entry type, nobody told the
// statement about it, and the money quietly stopped being counted (review findings F-B9-01 and
// F-B8-01). Every builder now exports the list of types it can post, and
// lib/statements/entry-types.test.ts walks all of them through this function and fails if any
// one comes back "unknown". A type that is deliberately absent from a broker statement is
// written down here WITH ITS REASON rather than left out, so "we forgot" and "we decided" can
// never look the same again.
//
// The runtime keeps its safety net all the same: an unknown type that moved the broker's payable
// still becomes an 'adjustment' line (rule 1 above), because net due must equal the movement of
// commission_payable whatever anyone forgot. The test is what stops it being needed.
export type StatementDisposition =
  // The entry belongs on a line. `movement` says which of the entry's two figures the amount is.
  | { kind: "line"; lineKind: StatementLineKind; movement: "cash" | "commission" }
  // Deliberately not a broker movement, and why.
  | { kind: "ignored"; reason: string }
  // Nobody has decided. Only reachable for a type no builder produces.
  | { kind: "unknown" };

const DISPOSITIONS: Record<string, StatementDisposition> = {
  // The cash the commission was earned on. An endorsement books the same movements under its own
  // names (lib/ledger/endorsement-entries.ts) and a corrected endorsement collects its difference
  // under a third set (lib/ledger/correction-entries.ts); all three are the same customer money.
  premium_collected: { kind: "line", lineKind: "premium_collected", movement: "cash" },
  endorsement_premium_collected: { kind: "line", lineKind: "premium_collected", movement: "cash" },
  correction_premium_collected: { kind: "line", lineKind: "premium_collected", movement: "cash" },
  // The cash the clawback was computed on. Every refund completes through this one entry,
  // whether it came from a cancellation, an endorsement reduction or a correction.
  refund_completed: { kind: "line", lineKind: "refund", movement: "cash" },
  commission_earned: { kind: "line", lineKind: "commission_earned", movement: "commission" },
  endorsement_commission_earned: { kind: "line", lineKind: "commission_earned", movement: "commission" },
  correction_commission_earned: { kind: "line", lineKind: "commission_earned", movement: "commission" },
  commission_clawback: { kind: "line", lineKind: "clawback", movement: "commission" },

  premium_written: { kind: "ignored", reason: "writing premium moves no cash and no commission; the collection that follows is on the statement" },
  endorsement_premium_written: { kind: "ignored", reason: "same as premium_written, for an endorsement and for a correction re-book" },
  tax_and_fee_billed: { kind: "ignored", reason: "state premium tax and the policy fee are billed to the customer; the broker earns nothing on them" },
  endorsement_tax_billed: { kind: "ignored", reason: "same as tax_and_fee_billed, for an endorsement and for a correction re-book" },
  premium_earned_to_date: { kind: "ignored", reason: "earning premium is an insurer figure; it moves neither the customer's cash nor the broker's payable" },
  unapplied_cash_received: { kind: "ignored", reason: "it debits cash_stripe and credits unapplied_customer_cash, both counted as cash, so it nets to zero; the money reaches the statement when it is applied to the policy" },
  refund_requested: { kind: "ignored", reason: "the liability is opened here and no money has moved; the refund is on the statement when it completes" },
  endorsement_refund_requested: { kind: "ignored", reason: "same as refund_requested, for an endorsement reduction" },
  correction_refund_requested: { kind: "ignored", reason: "same as refund_requested, for the difference a backdated correction gives back" },
  claim_reserve_set: { kind: "ignored", reason: "claims money is the insurer's, not the broker's: no commission is earned or clawed back on it" },
  claim_reserve_adjusted: { kind: "ignored", reason: "same as claim_reserve_set" },
  claim_reserve_restored: { kind: "ignored", reason: "same as claim_reserve_set" },
  claim_payment_sent: { kind: "ignored", reason: "same as claim_reserve_set: it moves the claim reserve and the claims payable, never the broker's payable" },
  claim_payment_settled: { kind: "ignored", reason: "same as claim_payment_sent: it moves the claims rail, not the broker's payable" },
  claim_payment_returned: { kind: "ignored", reason: "same as claim_payment_sent" },
};

// What the statement does with one entry type, reversals included: a reversal is named after the
// entry it undoes, so it lands on the same line with the opposite amount.
export function statementDisposition(entryType: string): StatementDisposition {
  const baseType = entryType.startsWith(REVERSAL_PREFIX) ? entryType.slice(REVERSAL_PREFIX.length) : entryType;
  return DISPOSITIONS[baseType] ?? { kind: "unknown" };
}

// The entry types whose CASH the statement lists, and their reversals. lib/statements/journal.ts
// selects on this list, so an entry type reaches the query and the classifier from the same
// table: there is no second list to keep in step.
export const STATEMENT_CASH_ENTRY_TYPES: string[] = Object.entries(DISPOSITIONS)
  .filter(([, disposition]) => disposition.kind === "line" && disposition.movement === "cash")
  .flatMap(([entryType]) => [entryType, `${REVERSAL_PREFIX}${entryType}`]);

function classify(
  baseType: string,
  entry: BrokerJournalEntry,
): { kind: StatementLineKind; amountCents: number } | null {
  const disposition = statementDisposition(baseType);
  if (disposition.kind === "line") {
    return {
      kind: disposition.lineKind,
      amountCents: disposition.movement === "cash" ? entry.cashCents : entry.commissionPayableCents,
    };
  }
  // Rule 1: anything else that moved the broker's payable still has to be on the statement, even
  // an entry type this file has never heard of, so net due stays the movement of the payable.
  if (entry.commissionPayableCents !== 0) {
    return { kind: "adjustment", amountCents: entry.commissionPayableCents };
  }
  return null;
}

function totalsOf(lines: StatementLine[]): StatementTotals {
  let cashCollectedCents = 0;
  let premiumCollectedCents = 0;
  let commissionEarnedCents = 0;
  let clawbackCents = 0;
  let adjustmentCents = 0;

  for (const line of lines) {
    if (line.kind === "premium_collected") {
      cashCollectedCents += line.amountCents;
      premiumCollectedCents += line.commissionBaseCents ?? 0;
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
    // does not pay the refund, so they change nothing in the totals. The cash and the premium they
    // gave back are on the lines themselves, next to the clawback they produced.
  }

  return {
    cashCollectedCents,
    premiumCollectedCents,
    commissionEarnedCents,
    clawbackCents,
    adjustmentCents,
    netDueCents: commissionEarnedCents - clawbackCents + adjustmentCents,
  };
}

// The order a statement is printed and hashed in: by business date, then in the order a reader
// expects a day to be told (the cash first, then what it did to the commission), then by the
// journal entry id, which is unique and breaks every remaining tie.
//
// The last step is what makes the content hash reproducible: two runs over the same entries build
// the same list even when the database returns the rows in a different order.
const KIND_READING_ORDER: Record<StatementLineKind, number> = {
  premium_collected: 0,
  commission_earned: 1,
  refund: 2,
  clawback: 3,
  adjustment: 4,
};

function sortedForReading(lines: StatementLine[]): StatementLine[] {
  return [...lines].sort((left, right) => {
    if (left.effectiveAt !== right.effectiveAt) {
      return left.effectiveAt < right.effectiveAt ? -1 : 1;
    }
    if (left.kind !== right.kind) {
      return KIND_READING_ORDER[left.kind] - KIND_READING_ORDER[right.kind];
    }
    return left.journalEntryId < right.journalEntryId ? -1 : left.journalEntryId > right.journalEntryId ? 1 : 0;
  });
}

// The text the content hash is taken of. It is deliberately plain and pipe-separated rather than
// JSON: a reader can see, in one glance, that the hash covers the broker, the month, every line
// with the journal entry it came from, and the totals. What it does NOT cover is the revision
// number, the knowledge cutoff and the moment the run happened: two runs that listed the same
// money have the same hash, which is exactly the question "did anything change?".
// The version marker on the first line is part of what is hashed, on purpose. When the document
// gains a figure, as it did when the premium base was added beside the cash (migration 0013), it
// is a NEW document: runs made under the old version keep their lines, their totals and their
// hash forever, and a re-run today is a new revision that is honestly not flagged identical to
// them. No v1 run had been published when v2 arrived.
function canonicalTextOf(input: StatementInput, lines: StatementLine[], totals: StatementTotals): string {
  const rows = [
    `corgi.broker-statement.v${CANONICAL_STATEMENT_VERSION}`,
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
        line.commissionBaseCents ?? "",
      ].join("|"),
    );
  }
  rows.push(
    [
      "totals",
      totals.cashCollectedCents,
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

// Was the month still running when this statement was produced? (decision 19, point 3.)
//
// The question is asked against the run's own KNOWLEDGE CUTOFF, never against the clock of
// whoever is reading. A run is immutable, so its label has to be immutable too: a statement
// produced on March 12 is provisional and stays provisional forever, and the run made once April
// has started is the definitive one. Comparing with "now" instead would silently turn yesterday's
// provisional document into a definitive one overnight, which is exactly the kind of quiet
// rewriting this slice exists to avoid.
//
// The month is over at the cutoff when the cutoff is at or after midnight UTC on the first day of
// the next month.
export function monthWasStillRunningAt(statementMonth: string, knowledgeCutoff: Date): boolean {
  assertStatementMonth(statementMonth);
  const year = Number(statementMonth.slice(0, 4));
  const monthNumber = Number(statementMonth.slice(5, 7)); // 1-based, and 0-based in Date.UTC
  const firstInstantOfNextMonth = Date.UTC(year, monthNumber, 1);
  return knowledgeCutoff.getTime() < firstInstantOfNextMonth;
}
