// Whether a broker may bind a policy. Pure, so it can be read and tested on its own; the
// status itself comes from the append-only broker_kyb_events table (lib/broker/kyb.ts).

export type KybStatus = "unknown" | "pending" | "approved" | "failed";

// Only an approved broker may bind. "unknown" and "pending" are not permission: eligibility
// that has not been established blocks the action (AGENTS.md, KYC section), and a broker whose
// verification failed does not become eligible by waiting.
export function bindingIsAllowed(status: KybStatus): boolean {
  return status === "approved";
}
