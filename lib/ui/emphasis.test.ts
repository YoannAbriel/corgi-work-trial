import { strict as assert } from "node:assert";
import { test } from "node:test";
import { emphasisParts } from "./emphasis";

// The sentence put back together from its parts. THE PROPERTY THAT MATTERS: emphasis is markup
// and nothing else, so this has to give the original string back, character for character, on
// every case below.
function rejoined(sentence: string): string {
  return emphasisParts(sentence)
    .map((part) => part.text)
    .join("");
}

function strongPieces(sentence: string): string[] {
  return emphasisParts(sentence)
    .filter((part) => part.strong)
    .map((part) => part.text);
}

test("a sentence with nothing to emphasise comes back as one plain part", () => {
  assert.deepEqual(emphasisParts("a plain sentence"), [{ text: "a plain sentence", strong: false }]);
  assert.deepEqual(emphasisParts(""), []);
});

test("money, dates, percentages and day counts are the figures that stand out", () => {
  assert.deepEqual(strongPieces("It costs $53.84"), ["$53.84"]);
  assert.deepEqual(strongPieces("the difference is +$52.61 and the other -$52.61"), ["+$52.61", "-$52.61"]);
  assert.deepEqual(strongPieces("re-booked on 2026-09-22"), ["re-booked", "2026-09-22"]);
  assert.deepEqual(strongPieces("CA premium tax on it (2.35%)"), ["2.35%"]);
  assert.deepEqual(strongPieces("351 of 365 days remain"), ["365 days"]);
  assert.deepEqual(strongPieces("1 day of cover"), ["1 day"]);
});

test("the words that say what happens to the money, whatever their case", () => {
  assert.deepEqual(strongPieces("Nothing is deleted and nothing is updated."), [
    "Nothing is deleted",
    "nothing is updated",
  ]);
  assert.deepEqual(strongPieces("so no second approver is needed"), ["no second approver"]);
  assert.deepEqual(strongPieces("a second approver, never you, has to approve it"), ["second approver", "approve"]);
});

test("a word is never emphasised inside a longer word", () => {
  // "collect" inside "collected", "approve" inside "approver", "refund" inside "refunds".
  assert.deepEqual(strongPieces("collected through Stripe"), ["collected"]);
  assert.deepEqual(strongPieces("the money-out queue has one approver"), []);
  assert.deepEqual(strongPieces("the Stripe Refunds API"), []);
});

test("the parts always rebuild the sentence exactly", () => {
  const sentences = [
    "",
    "a plain sentence",
    "$53.84",
    "In one transaction: a dated correction event superseding the endorsement that was wrong, one reversal entry per line beside, the endorsement re-booked on 2026-09-22 with fresh premium and tax entries, and the difference opened as a money operation. Nothing is deleted and nothing is updated. The $53.84 difference is then collected through a hosted Stripe page.",
    "$53.84 to collect: with this difference, this policy carries $1,153.97 of additional premium in this term, above $500.00, so the customer has to approve it before it is collected",
    "this $26.92 is at or below $1,000.00 counting the $102.62 this policy has already refunded and the $0.00 still on its way, so no second approver is needed",
  ];
  for (const sentence of sentences) {
    assert.equal(rejoined(sentence), sentence);
  }
});

test("the parts alternate the way the markup expects: no empty part, no two plain parts in a row", () => {
  const parts = emphasisParts("The $53.84 difference is then collected through a hosted Stripe page.");
  for (const part of parts) {
    assert.notEqual(part.text, "");
  }
  for (let index = 1; index < parts.length; index += 1) {
    assert.ok(parts[index].strong || parts[index - 1].strong, "two plain parts should have been one");
  }
});
