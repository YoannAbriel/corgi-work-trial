// The identity and the age of a break. Pure: no database, no clock of its own.

// The sixth value, `probe`, is not a comparison outcome like the other five: it is money one of
// our own check runs planted at the provider on purpose (lib/reconciliation/diff.ts,
// isProbeFromACheckRun). It is stored and listed like any other item, and it is never counted as
// a break to act on.
export const CLASSIFICATIONS = ["matched", "local_only", "provider_only", "amount_mismatch", "stale", "probe"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export type ReconciliationSourceName = "stripe" | "claims_rail";

// One string per thing compared, stable from one run to the next: the source and the reference it
// is about. Two things are deliberately NOT in it, and both were review finding F-B10-02.
//
// NOT THE CLASSIFICATION. It used to be, and that gave the same money two identities: a refund the
// ledger owed and Stripe did not list was keyed as `stale`, and the day Stripe listed it as
// succeeded with nothing booked on our side it became `provider_only`, a brand new key. Its age
// restarted at zero and the old key, absent from the latest run, was filed as resolved. Same
// money, one break that had just got worse. The classification is now an attribute of the item,
// read from the latest run that reported it; the key is the money.
//
// NOT THE PROVIDER REFERENCE FIRST. Our money operation id comes first when there is one, because
// it is the identity that exists from the moment we intend to move money and never changes. A
// provider reference appears late, when the provider accepts something, so keying on it first
// would break the identity of exactly the case above: the same refund would be `op:...` while the
// ledger was alone with it and `re_...` the moment Stripe listed it. The provider reference is the
// key only for a record the ledger has never heard of, which is the one case where there is no
// operation id to use.
export function breakKey(
  source: ReconciliationSourceName,
  providerRef: string | null,
  ledgerRef: string | null,
): string {
  const reference = ledgerRef ? `op:${ledgerRef}` : providerRef;
  if (!reference) {
    throw new Error("a compared record needs a provider reference or a ledger reference to be identified");
  }
  return `${source}|${reference}`;
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
