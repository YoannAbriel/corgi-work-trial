import type { CalendarDate } from "@/lib/money/dates";

// Turning stored values into the strings printed on a document.
//
// Money is stored as an integer number of cents and is formatted here, once, for every
// document. The conversion is done on the digits of the number, not by dividing by 100:
// there is no division and therefore no float anywhere in this file. A rendering bug can
// still misplace a decimal point; it cannot round a customer's money.

// 125320 -> "$1,253.20", 0 -> "$0.00", -43562 -> "-$435.62".
export function formatCents(amountCents: number): string {
  if (!Number.isInteger(amountCents)) {
    throw new Error(`amountCents must be an integer number of cents, got ${amountCents}`);
  }
  const isNegative = amountCents < 0;
  const digits = String(Math.abs(amountCents)).padStart(3, "0"); // "0" -> "000" -> $0.00
  const dollarDigits = digits.slice(0, -2);
  const centDigits = digits.slice(-2);
  return `${isNegative ? "-" : ""}$${groupThousands(dollarDigits)}.${centDigits}`;
}

// "1253" -> "1,253". Inserts a comma every three digits from the right.
function groupThousands(dollarDigits: string): string {
  let grouped = "";
  for (let index = 0; index < dollarDigits.length; index += 1) {
    const digitsRemaining = dollarDigits.length - index;
    if (index > 0 && digitsRemaining % 3 === 0) grouped += ",";
    grouped += dollarDigits[index];
  }
  return grouped;
}

// A rate in basis points, as printed on the tax line: 235 -> "2.35%", 300 -> "3.00%".
// Same digit arithmetic as the money formatter, for the same reason.
export function formatBasisPoints(rateBasisPoints: number): string {
  if (!Number.isInteger(rateBasisPoints) || rateBasisPoints < 0) {
    throw new Error(`rateBasisPoints must be a non-negative whole number, got ${rateBasisPoints}`);
  }
  const digits = String(rateBasisPoints).padStart(3, "0");
  return `${groupThousands(digits.slice(0, -2))}.${digits.slice(-2)}%`;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// "2028-03-01" -> "March 1, 2028". Written out in full because "03/01/2028" and "01/03/2028"
// are the same string to two different readers, and a policy term must not be ambiguous.
// The date is read digit by digit: no Date object, so no timezone can shift the day.
export function formatCalendarDate(date: CalendarDate): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(`not a calendar date: ${date}`);
  }
  const [, year, month, day] = match;
  const monthName = MONTH_NAMES[Number(month) - 1];
  if (!monthName) {
    throw new Error(`not a real month: ${date}`);
  }
  return `${monthName} ${Number(day)}, ${year}`;
}

// "2026-09-08T12:34:56.789Z" -> "2026-09-08 12:34:56 UTC".
// The timezone is spelled out on the document: every instant we store is UTC (AGENTS.md),
// and a footer that says "12:34" without saying where is not evidence of anything.
export function formatUtcTimestamp(isoTimestamp: string): string {
  // The trailing "Z" is required: an offset such as "+02:00" would be printed as if it were
  // UTC and the footer would state the wrong time.
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z$/.exec(isoTimestamp);
  if (!match) {
    throw new Error(`not an ISO-8601 UTC timestamp ending in Z: ${isoTimestamp}`);
  }
  return `${match[1]} ${match[2]} UTC`;
}
