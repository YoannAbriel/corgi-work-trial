// The identity and the age of a break. Pure: no database, no clock of its own.

export const CLASSIFICATIONS = ["matched", "local_only", "provider_only", "amount_mismatch", "stale"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export type ReconciliationSourceName = "stripe" | "claims_rail";

// One string per break, stable from one run to the next: the source, what kind of break it is,
// and the reference it is about. The provider reference wins when there is one, because that
// is the identity the provider itself uses; a ledger-only break has only its operation id.
//
// Two runs storing an item with the same key are talking about the same break. That is what
// lets the screen say "first seen 3 days ago" (the earliest run with this key) and "resolved"
// (a key reported before and absent from the latest run).
export function breakKey(
  source: ReconciliationSourceName,
  classification: Classification,
  providerRef: string | null,
  ledgerRef: string | null,
): string {
  const reference = providerRef ?? (ledgerRef ? `op:${ledgerRef}` : null);
  if (!reference) {
    throw new Error("a break needs a provider reference or a ledger reference to be identified");
  }
  return `${source}|${classification}|${reference}`;
}

// How long a break has been open, in the unit a person would use. Whole numbers only: an
// operator reads "3 hours", not "3.25 hours".
export function describeAge(firstSeenAt: Date, now: Date): string {
  const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - firstSeenAt.getTime()) / 60000));
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"}`;
  }
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 48) {
    return `${elapsedHours} hour${elapsedHours === 1 ? "" : "s"}`;
  }
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays} days`;
}

// Whole hours between two instants, used by the staleness rule of the diff. Never negative: a
// provider record stamped a moment AFTER the clock the run was given (the provider's clock and
// ours are not the same clock) has been waiting zero hours, not minus one.
export function hoursBetween(earlier: Date, later: Date): number {
  return Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / 3600000));
}
