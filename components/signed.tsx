import "@/app/styles/signed.css";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatCentsAsUsd } from "@/lib/money/cents";

// THE SIGN CONVENTION OF THE MONEY SCREENS, in one place. Yoann, 2026-09-09, reading the
// correction preview on production: "what is added should be green and what is taken away red;
// the differences must jump out". So: money the customer owes MORE is green and carries a plus,
// money that goes BACK to them is red and carries the minus the formatter already writes, and an
// amount that moves nothing carries neither.
//
// NOTHING HERE COMPUTES A FIGURE. Every amount still arrives from the lib readers in integer
// cents (lib/money/correction.ts, lib/money/endorsement.ts, lib/money/explain.ts); this only says
// how the figure that was handed over is dressed. A pure function of one number.
//
//   signedTone(5261)  === "ok"       "+$52.61" in green: the customer owes that much more
//   signedTone(-5261) === "danger"   "-$52.61" in red: that much goes back to them
//   signedTone(0)     === "neutral"  "$0.00" in the ordinary ink: the date moves no money
export type SignedTone = "ok" | "danger" | "neutral";

export function signedTone(cents: number): SignedTone {
  if (cents > 0) return "ok";
  if (cents < 0) return "danger";
  return "neutral";
}

// The amount with its sign always visible. formatCentsAsUsd already writes the minus of a
// negative amount, so only a positive one needs a character in front of it, and zero gets none:
// "+$0.00" would claim a direction that is not there.
export function formatSignedCentsAsUsd(cents: number): string {
  return `${cents > 0 ? "+" : ""}${formatCentsAsUsd(cents)}`;
}

// A whole number of days with its sign, for the movement a corrected date creates: "+16 days".
// Same rule as the amount above, on a count rather than on money.
export function formatSignedDays(days: number): string {
  return `${days > 0 ? "+" : ""}${days} ${Math.abs(days) === 1 ? "day" : "days"}`;
}

// The arrow that repeats the direction for a reader who does not separate the two colours: up and
// to the right when the customer owes more, down when money goes back. Undefined on zero, where
// there is no direction to point at.
export function signedArrow(cents: number): LucideIcon | undefined {
  if (cents > 0) return ArrowUpRight;
  if (cents < 0) return ArrowDownRight;
  return undefined;
}

// A signed amount inside a sentence or a list: the same text and the same colour as in a table,
// so one convention is learned once.
export function SignedAmount({ cents }: { cents: number }) {
  return <span className={`signed-${signedTone(cents)}`}>{formatSignedCentsAsUsd(cents)}</span>;
}
