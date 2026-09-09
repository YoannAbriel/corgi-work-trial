import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  explainAccountSum,
  explainStateTax,
  explainTotalCharge,
  explainCancellationFigure,
  runningSubtotals,
  type CancellationFigures,
} from "./explain";

// Slice B12-4 (YOA-637), the animated "explain this amount".
//
// The animation is the only client component in the feature, and the whole feature is worthless if
// the browser starts producing money. These tests hold the line in two places:
//   1. against the SOURCE of the client component, so the ban on arithmetic is checked and not
//      merely written in a comment;
//   2. against `runningSubtotals`, the server function whose strings the animation ticks along.

const motionSource = readFileSync(
  join(process.cwd(), "components", "amount-explained-motion.tsx"),
  "utf8",
);

describe("the client component computes no money", () => {
  it("is the client component it claims to be", () => {
    assert.match(motionSource, /^"use client";/);
  });

  it("never converts between dollars and cents", () => {
    assert.ok(!motionSource.includes("* 100"), "a multiplication by 100 is a currency conversion");
    assert.ok(!motionSource.includes("/ 100"), "a division by 100 is a currency conversion");
  });

  it("never parses an amount", () => {
    assert.ok(!motionSource.includes("parseInt"), "parseInt on a displayed amount is browser money");
    assert.ok(!motionSource.includes("parseFloat"), "parseFloat on a displayed amount is browser money");
    assert.ok(!/\bBigInt\b/.test(motionSource));
  });

  it("reads exactly one number, and reads it from the digits of the server's own text", () => {
    const numberCalls = motionSource.match(/Number\(/g) ?? [];
    assert.equal(numberCalls.length, 1, "the count-up is the only place a number may be read");
    const line = motionSource.split("\n").find((candidate) => candidate.includes("Number("));
    assert.equal(line?.trim(), "const digitsAsNumber = Number(digits);");
    // `digits` can only be the digits of the text the server rendered.
    assert.ok(motionSource.includes('const digits = textFromServer.replace(/[^0-9]/g, "");'));
    // And the frame the count-up stops on is that text itself, not a rebuilt one.
    assert.ok(motionSource.includes("resultCell.textContent = textFromServer;"));
  });

  it("borrows no money helper and no money type", () => {
    assert.ok(!/from "@\/lib\/money/.test(motionSource), "the browser has no business importing money code");
    // Not even in a comment: the money formatter is named nowhere in this file, and no identifier
    // carries an amount. Every name of an amount in this build ends in "Cents".
    assert.ok(!motionSource.includes("formatCentsAsUsd"));
    assert.ok(!/[A-Za-z]Cents/.test(motionSource));
  });

  it("respects a reader who asked not to be animated", () => {
    assert.ok(motionSource.includes("(prefers-reduced-motion: reduce)"));
  });
});

describe("runningSubtotals", () => {
  const entries = [
    {
      entryId: "entry-1",
      entryType: "premium_collected",
      effectiveAt: "2026-09-08",
      recordedAt: new Date("2026-09-08T10:00:00Z"),
      lines: [{ accountId: "cash_stripe", accountName: "Cash held at Stripe", debitCents: 125320, creditCents: 0 }],
    },
    {
      entryId: "entry-2",
      entryType: "endorsement_collected",
      effectiveAt: "2026-10-08",
      recordedAt: new Date("2026-10-08T10:00:00Z"),
      lines: [{ accountId: "cash_stripe", accountName: "Cash held at Stripe", debitCents: 112724, creditCents: 0 }],
    },
  ];

  it("ticks along the lines of a journal sum and ends on the figure", () => {
    const explanation = explainAccountSum({
      entries,
      accountId: "cash_stripe",
      rule: "debits",
      totalLabel: "Collected at Stripe, all debits added",
    });
    const subtotals = runningSubtotals(explanation);
    assert.deepEqual(subtotals, [
      { key: "line_0", cents: 125320 },
      { key: "line_1", cents: 238044 },
    ]);
    // The last subtotal IS the figure the fold sits under: 125320 + 112724 = 238044.
    assert.equal(subtotals?.[subtotals.length - 1].cents, 238044);
  });

  it("ticks along premium, tax and fee up to the full annual term", () => {
    const subtotals = runningSubtotals(
      explainTotalCharge({ stateCode: "TX", annualPremiumCents: 120000, taxCents: 2820, feeCents: 2500 }),
    );
    assert.deepEqual(subtotals, [
      { key: "premium", cents: 120000 },
      { key: "tax", cents: 122820 },
      { key: "fee", cents: 125320 },
    ]);
  });

  it("refuses a fold whose lines are not an addition ending on the figure", () => {
    // The tax is floor(premium x rate / 10000), not a sum: a running total would be a lie.
    assert.equal(
      runningSubtotals(explainStateTax({ stateCode: "TX", annualPremiumCents: 120000, taxRateBps: 235 })),
      null,
    );
  });

  it("refuses a cancellation fold, whose seven lines do not add up to any one of them", () => {
    const cancellation: CancellationFigures = {
      effectiveAt: "2026-10-31",
      writtenPremiumCents: 231200,
      earnedPremiumCents: 27870,
      unearnedPremiumCents: 203330,
      refundedTaxCents: 4779,
      taxRefundWasCappedAtCharged: false,
      refundedFeeCents: 0,
      totalRefundCents: 208109,
      commissionClawbackCents: 30499,
      earnedDays: 44,
      termDays: 365,
      taxRateBps: 235,
      commissionRateBps: 1500,
    };
    assert.equal(runningSubtotals(explainCancellationFigure(cancellation, "unearned_premium")), null);
  });

  it("refuses a single line, which is not a running total worth watching", () => {
    const explanation = explainAccountSum({
      entries: [entries[0]],
      accountId: "cash_stripe",
      rule: "debits",
      totalLabel: "Collected at Stripe, all debits added",
    });
    assert.equal(runningSubtotals(explanation), null);
  });
});
