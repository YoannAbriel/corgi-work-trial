// Postgres returns bigint columns (all our money columns) as strings, so that a value larger
// than JavaScript's safe integer range cannot lose precision on the way out. Every amount in
// this application is a number of US cents far below 2^53, so we convert once, here, and
// refuse anything that is not a whole number. No float ever touches an amount.
export function centsFromDatabase(value: unknown, columnName: string): number {
  // Number(null) and Number("") are both 0: a missing amount must not silently become zero.
  if (value === null || value === undefined || value === "") {
    throw new Error(`${columnName} is not a whole number of cents: it is missing`);
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${columnName} is not a whole number of cents: ${String(value)}`);
  }
  return parsed;
}

// A US dollar amount typed by a human into a form, turned into whole cents WITHOUT going
// through a floating point number: "19.99" is read as 19 dollars and 99 cents, then
// 19 * 100 + 99. parseFloat("19.99") * 100 gives 1998.9999999999998, which rounds to the
// wrong cent as soon as anyone truncates it.
// Accepts "1200", "1200.5", "1,200.50", "$1,200.50". Refuses anything else, including a
// negative amount, more than two decimals, and a comma that is not a thousands separator.
export function parseUsdAmountToCents(text: string): number {
  const withoutSymbols = text.trim().replace(/[$\s]/g, "");
  // A comma is only allowed where a thousands separator belongs, so "1 200,50" (a European
  // decimal comma) is refused instead of being read as one hundred and twenty thousand.
  if (withoutSymbols.includes(",") && !/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(withoutSymbols)) {
    throw new Error(`"${text}" is not a US dollar amount (expected for example 1200 or 1,200.50)`);
  }
  const cleaned = withoutSymbols.replace(/,/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) {
    throw new Error(`"${text}" is not a US dollar amount (expected for example 1200 or 1,200.50)`);
  }
  const wholeDollars = Number(match[1]);
  const decimals = (match[2] ?? "").padEnd(2, "0");
  const amountCents = wholeDollars * 100 + Number(decimals);
  if (!Number.isSafeInteger(amountCents)) {
    throw new Error(`"${text}" is too large to be a US dollar amount in this application`);
  }
  return amountCents;
}

// Cents to a displayable amount, for the interface only. Built from integer arithmetic:
// 125320 becomes "1,253.20".
export function formatCentsAsUsd(amountCents: number): string {
  const sign = amountCents < 0 ? "-" : "";
  const absolute = Math.abs(amountCents);
  const dollars = Math.floor(absolute / 100);
  const remainingCents = absolute % 100;
  return `${sign}$${dollars.toLocaleString("en-US")}.${remainingCents.toString().padStart(2, "0")}`;
}
