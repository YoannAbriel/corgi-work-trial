// Calendar dates for policy terms. A date is an ISO string "YYYY-MM-DD" with no time and no
// timezone: a policy effective date is a calendar day, not an instant. All arithmetic runs in
// UTC so that daylight-saving changes can never add or remove a day.

export type CalendarDate = string; // "YYYY-MM-DD"

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(date: CalendarDate): { year: number; month: number; day: number } {
  const match = ISO_DATE.exec(date);
  if (!match) {
    throw new Error(`not a calendar date: ${date}`);
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function toUtcMillis(date: CalendarDate): number {
  const { year, month, day } = parts(date);
  const millis = Date.UTC(year, month - 1, day);
  // Date.UTC silently rolls invalid days over (Feb 30 becomes Mar 1); reject those.
  const roundTrip = new Date(millis);
  if (roundTrip.getUTCFullYear() !== year || roundTrip.getUTCMonth() !== month - 1 || roundTrip.getUTCDate() !== day) {
    throw new Error(`not a real calendar date: ${date}`);
  }
  return millis;
}

function fromUtcMillis(millis: number): CalendarDate {
  return new Date(millis).toISOString().slice(0, 10);
}

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

// True when the text is a calendar date that really exists: the right shape, a month between
// 1 and 12, and a day the month actually has. Used to reject a date typed into a form before it
// is compared with anything: "2026-02-30" is not a date, and comparing it as text with the
// policy term would answer a question nobody asked.
export function isCalendarDate(text: string): boolean {
  try {
    toUtcMillis(text);
    return true;
  } catch {
    return false;
  }
}

// Whole days from `from` to `to`; negative when `to` is earlier.
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return Math.round((toUtcMillis(to) - toUtcMillis(from)) / MILLIS_PER_DAY);
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  return fromUtcMillis(toUtcMillis(date) + days * MILLIS_PER_DAY);
}

// A policy term is one year: it ends on the same calendar date next year.
// When that date does not exist (a term starting February 29), it ends on February 28.
// Decided by Yoann on 2026-09-08 (DECISIONS.md). Examples:
//   2028-03-01 -> 2029-03-01 (365 days: February 29, 2028 is before the term)
//   2028-01-01 -> 2029-01-01 (366 days: the term contains February 29, 2028)
//   2028-02-29 -> 2029-02-28 (365 days)
export function termEnd(termStart: CalendarDate): CalendarDate {
  const { year, month, day } = parts(termStart);
  toUtcMillis(termStart); // validates
  const nextYear = year + 1;
  const lastDayOfMonthNextYear = new Date(Date.UTC(nextYear, month, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfMonthNextYear);
  return fromUtcMillis(Date.UTC(nextYear, month - 1, clampedDay));
}

// Number of days in the term, counted for real (365 or 366).
export function termDays(termStart: CalendarDate, termEndDate: CalendarDate = termEnd(termStart)): number {
  const days = daysBetween(termStart, termEndDate);
  if (days <= 0) {
    throw new Error(`term must end after it starts: ${termStart} to ${termEndDate}`);
  }
  return days;
}
