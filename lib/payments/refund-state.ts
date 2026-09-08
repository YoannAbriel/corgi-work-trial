// Where a refund stands, read from its append-only events.
//
// Not "the latest event wins": the answer from our own API call and the webhook describing the
// same refund can be stored in either order, and a 'provider_accepted' appended a moment after
// 'succeeded' must not make a completed refund look pending. Precedence instead, from the most
// final state backwards. A failed refund that is re-issued becomes a NEW operation, so no
// operation ever has to go back from 'completed' to anything else.
//
// This rule lives in a file of its own, with no imports at all, because the reconciliation job
// reads it too (lib/reconciliation/ledger-side.ts) and lib/payments/refunds.ts opens the
// database pool and the Stripe client the moment it is loaded. One rule, one definition, and a
// unit test can import it without a database. lib/payments/refunds.ts re-exports both names, so
// nothing that already imported them from there had to change.

export type RefundState = "requested" | "accepted" | "completed" | "failed";

export function refundStateFromEvents(statuses: string[]): RefundState {
  if (statuses.includes("succeeded")) {
    return "completed";
  }
  if (statuses.includes("failed")) {
    return "failed";
  }
  if (statuses.includes("provider_accepted")) {
    return "accepted";
  }
  return "requested";
}
