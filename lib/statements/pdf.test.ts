import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTextFromPdf } from "@/lib/documents/pdf-text";
import { renderStatementPdf } from "./pdf";
import type { StatementRunDetail } from "./read";

// What the statement PDF actually prints, read back out of the file with the repository's own
// reader (lib/documents/pdf-text.ts). A test that only checked the bytes exist would pass on a
// blank page.
//
// The run below is the recited March 2028 example (DECISIONS.md), built by hand so the test says
// exactly which figures it expects: 125320 of cash collected, 120000 of premium inside it, 18000
// of commission, which is 15% of 120000 and not of 125320.

const MARCH: StatementRunDetail = {
  run: {
    runId: "11111111-1111-4111-8111-111111111111",
    brokerId: "33333333-3333-4333-8333-333333333333",
    brokerName: "Redwood Commercial Brokers",
    statementMonth: "2028-03",
    revision: 2,
    knowledgeCutoff: new Date("2028-04-01T06:00:00.000Z"),
    supersedesRunId: "22222222-2222-4222-8222-222222222222",
    contentHash: "a".repeat(64),
    identicalToPrevious: false,
    canonicalVersion: 2,
    previousCanonicalVersion: 2,
    monthWasStillRunning: false,
    cashCollectedCents: 125320,
    premiumCollectedCents: 120000,
    commissionEarnedCents: 18000,
    clawbackCents: 0,
    adjustmentCents: 0,
    netDueCents: 18000,
    runByName: "Sam Patel, operations",
    createdAt: new Date("2028-04-01T06:00:02.000Z"),
  },
  lines: [
    {
      lineOrder: 0,
      kind: "premium_collected",
      policyId: "44444444-4444-4444-8444-444444444444",
      policyNumber: "CGP-01001",
      journalEntryId: "55555555-5555-4555-8555-555555555555",
      effectiveAt: new Date("2028-03-01T00:00:00.000Z"),
      entryRecordedAt: new Date("2028-03-01T10:00:00.000Z"),
      amountCents: 125320,
      commissionBaseCents: 120000,
      description: "Policy CGP-01001 premium, tax and fee collected at Stripe",
    },
    {
      lineOrder: 1,
      kind: "commission_earned",
      policyId: "44444444-4444-4444-8444-444444444444",
      policyNumber: "CGP-01001",
      journalEntryId: "66666666-6666-4666-8666-666666666666",
      effectiveAt: new Date("2028-03-01T00:00:00.000Z"),
      entryRecordedAt: new Date("2028-03-01T10:00:00.000Z"),
      amountCents: 18000,
      commissionBaseCents: null,
      description: "Broker commission on the collected premium of policy CGP-01001",
    },
  ],
};

function assertIsPdfFile(pdf: Buffer) {
  assert.equal(pdf.subarray(0, 4).toString("latin1"), "%PDF");
  assert.ok(pdf.length > 1024, `a one-page statement PDF is larger than 1 KB, got ${pdf.length} bytes`);
  assert.ok(pdf.subarray(-8).toString("latin1").includes("%%EOF"), "the file is not terminated");
}

test("the statement PDF prints both money figures, the commission and the identity of the run", async () => {
  const pdf = await renderStatementPdf(MARCH);
  assertIsPdfFile(pdf);

  const printedText = extractTextFromPdf(pdf);
  assert.ok(printedText.includes("Redwood Commercial Brokers"), "the broker is not on the page");
  assert.ok(printedText.includes("2028-03"), "the statement month is not on the page");
  assert.ok(printedText.includes("$1,253.20"), "the cash collected is not on the page");
  assert.ok(printedText.includes("$1,200.00"), "the premium collected is not on the page");
  assert.ok(printedText.includes("$180.00"), "the commission is not on the page");
  assert.ok(printedText.includes("Premium collected"), "the commission base is not labelled");
  assert.ok(printedText.includes("Cash collected"), "the cash is not labelled");
  assert.ok(printedText.includes("Net due to the broker"), "the net due is not labelled");
  // The three things that make a statement reproducible have to be ON the document.
  assert.ok(printedText.includes("revision 2"), "the revision is not on the page");
  // Only the date part: a long run is split into several drawn pieces by the font's kerning, so
  // asserting a whole timestamp would be asserting on a rendering detail.
  assert.ok(printedText.includes("2028-04-01"), "the knowledge cutoff is not on the page");
  assert.ok(printedText.includes("a".repeat(64)), "the content hash is not on the page");
  // A month that is over says nothing about being provisional.
  assert.ok(!printedText.includes("MONTH IN PROGRESS"), "a closed month must not be marked provisional");
});

test("a statement produced before its month is over says so on the document", async () => {
  const provisional: StatementRunDetail = {
    run: { ...MARCH.run, monthWasStillRunning: true, knowledgeCutoff: new Date("2028-03-12T09:00:00.000Z") },
    lines: MARCH.lines,
  };
  const printedText = extractTextFromPdf(await renderStatementPdf(provisional));
  assert.ok(printedText.includes("MONTH IN PROGRESS, PROVISIONAL"), "the provisional label is not on the page");
  assert.ok(printedText.includes("2028-03-12"), "the cutoff it is provisional at is not on the page");
});

test("a statement stored in the older format is printed with the older format's meaning", async () => {
  // Migration 0016, review finding F-B9-09: three runs on the trial database were written before
  // the premium column changed meaning. Their premium column holds the CASH and no line carries a
  // commission base, so the document says so instead of printing "Cash collected $0.00".
  const v1: StatementRunDetail = {
    run: {
      ...MARCH.run,
      canonicalVersion: 1,
      previousCanonicalVersion: null,
      supersedesRunId: null,
      revision: 1,
      cashCollectedCents: 0, // filled by the migration's default, never by a run
      premiumCollectedCents: 125320, // the CASH, in the column that now means premium
    },
    lines: MARCH.lines.map((line) => ({ ...line, commissionBaseCents: null })),
  };
  const printedText = extractTextFromPdf(await renderStatementPdf(v1));
  assert.ok(printedText.includes("Statement format v1"), "the format note is not on the page");
  assert.ok(printedText.includes("$1,253.20"), "the cash is not on the page");
  assert.ok(printedText.includes("not stored"), "the missing premium is not said to be missing");
  // Never the labels of a format this run was not written in: on a v1 row the commission line
  // cannot say "on that premium", because the premium it rests on was not stored.
  assert.ok(!printedText.includes("on that premium"), "a v1 statement must not carry the v2 labels");
});

test("a month with no movement prints an empty statement rather than an empty page", async () => {
  const empty: StatementRunDetail = {
    run: {
      ...MARCH.run,
      cashCollectedCents: 0,
      premiumCollectedCents: 0,
      commissionEarnedCents: 0,
      netDueCents: 0,
      revision: 1,
      supersedesRunId: null,
    },
    lines: [],
  };
  const printedText = extractTextFromPdf(await renderStatementPdf(empty));
  assert.ok(printedText.includes("No premium was collected"), "the empty state is not on the page");
  assert.ok(printedText.includes("$0.00"), "the zero total is not on the page");
});
