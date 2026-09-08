import { test } from "node:test";
import assert from "node:assert/strict";
import { centsFromDatabase, formatCentsAsUsd, parseUsdAmountToCents } from "./cents";

test("a typed dollar amount becomes whole cents without any floating point", () => {
  assert.equal(parseUsdAmountToCents("1200"), 120000);
  assert.equal(parseUsdAmountToCents("1200.00"), 120000);
  assert.equal(parseUsdAmountToCents("1,200.50"), 120050);
  assert.equal(parseUsdAmountToCents("$1,200.50"), 120050);
  assert.equal(parseUsdAmountToCents("0.07"), 7);
  assert.equal(parseUsdAmountToCents("1200.5"), 120050);
});

test("the classic floating point trap does not happen here", () => {
  // parseFloat("19.99") * 100 is 1998.9999999999998 in IEEE 754 arithmetic: truncating it
  // loses a cent. The parser never multiplies a fraction.
  assert.notEqual(parseFloat("19.99") * 100, 1999);
  assert.equal(parseUsdAmountToCents("19.99"), 1999);
  assert.equal(parseUsdAmountToCents("8.20"), 820);
  assert.equal(parseUsdAmountToCents("70.35"), 7035);
});

test("anything that is not a plain positive dollar amount is refused", () => {
  for (const bad of ["", "abc", "-5", "1200.005", "1e3", "1200.", ".5", "1 200,50"]) {
    assert.throws(() => parseUsdAmountToCents(bad), /not a US dollar amount/, `accepted "${bad}"`);
  }
});

test("bigint columns arrive as strings and become whole numbers of cents", () => {
  assert.equal(centsFromDatabase("125320", "total_charge_cents"), 125320);
  assert.equal(centsFromDatabase(0, "debit_cents"), 0);
  assert.throws(() => centsFromDatabase("12.5", "amount_cents"), /not a whole number of cents/);
  assert.throws(() => centsFromDatabase(null, "amount_cents"), /not a whole number of cents/);
});

test("cents are displayed with two decimals and thousands separators", () => {
  assert.equal(formatCentsAsUsd(125320), "$1,253.20");
  assert.equal(formatCentsAsUsd(7), "$0.07");
  assert.equal(formatCentsAsUsd(0), "$0.00");
  assert.equal(formatCentsAsUsd(-2820), "-$28.20");
});
