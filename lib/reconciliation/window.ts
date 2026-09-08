// The time window a reconciliation run compares. Pure: the clock comes in as an argument.
//
// Semantics, the same for both sides of the comparison:
//   - provider records are those the provider says were CREATED inside [from, to];
//   - ledger records are the money operations with any activity RECORDED inside [from, to]
//     (a lifecycle event or a journal entry), read with the database's own recorded_at.
// Both bounds are UTC instants. The default is the last 7 days ending now: long enough that
// a webhook delayed by a day still lands inside the window of the next daily run, short enough
// to keep the Stripe listing small. Running two overlapping windows is harmless: every run
// stores its own items, and a break is identified by its key across runs, not by the window.

export const DEFAULT_WINDOW_DAYS = 7;

// The longest window the job accepts. A bound, not a business rule: the Stripe listing is
// paginated in pages of 100 and a year of records would take minutes on a serverless function.
export const MAX_WINDOW_DAYS = 31;

export type ReconciliationWindow = {
  from: Date;
  to: Date;
};

export function defaultWindow(now: Date): ReconciliationWindow {
  return { from: new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 24 * 3600 * 1000), to: now };
}

export class WindowRefused extends Error {}

// Reads the optional `from` and `to` a person typed into the "Run now" form (or a script passed
// on the command line). Either may be missing, in which case the default bound is used.
// Anything that is not an instant, an empty window or a window longer than MAX_WINDOW_DAYS is
// refused with a sentence the screen can show.
export function parseWindow(input: { from?: string | null; to?: string | null }, now: Date): ReconciliationWindow {
  const fallback = defaultWindow(now);
  const from = parseInstant(input.from, "from") ?? fallback.from;
  const to = parseInstant(input.to, "to") ?? fallback.to;
  if (from.getTime() >= to.getTime()) {
    throw new WindowRefused(`the window is empty: "from" (${from.toISOString()}) must be before "to" (${to.toISOString()})`);
  }
  const lengthDays = (to.getTime() - from.getTime()) / (24 * 3600 * 1000);
  if (lengthDays > MAX_WINDOW_DAYS) {
    throw new WindowRefused(`the window is ${Math.ceil(lengthDays)} days long; at most ${MAX_WINDOW_DAYS} days can be reconciled in one run`);
  }
  return { from, to };
}

function parseInstant(text: string | null | undefined, name: string): Date | null {
  if (text === null || text === undefined || text.trim() === "") {
    return null;
  }
  // A date-only value ("2026-09-08") is read as midnight UTC, which is what a form's date
  // input produces and what an operator means by "from the 8th".
  const parsed = new Date(text.trim());
  if (Number.isNaN(parsed.getTime())) {
    throw new WindowRefused(`"${text}" is not a date or an instant for "${name}" (expected 2026-09-08 or 2026-09-08T10:00:00Z)`);
  }
  return parsed;
}

// Stripe filters on whole seconds since 1970 (UTC); our window is in milliseconds.
export function unixSeconds(instant: Date): number {
  return Math.floor(instant.getTime() / 1000);
}
