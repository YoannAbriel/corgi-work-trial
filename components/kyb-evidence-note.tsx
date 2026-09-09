import { KYB_NOT_LIVE_LABEL, SEED_PROVIDER } from "@/lib/broker/eligibility";
import type { KybState } from "@/lib/broker/kyb";

// WHAT A SCREEN SAYS ABOUT THE EVIDENCE BEHIND A VERIFICATION STATUS: one sentence, written once
// and said the same way everywhere that status is shown.
//
// Every screen used to print the seeded-placeholder sentence whenever `isProviderEvidence` was
// false. That flag is false in TWO different situations and the sentence was only ever true of
// one of them: Sierra Crest has never submitted anything (no status row, no connected account, no
// seed row) and its screens still announced a placeholder that does not exist, under a label
// saying its verification is not live. Both halves were wrong (Yoann, 2026-09-09, LIVE-3).
//
// The cases, in the order they are decided:
//   1. the status IS provider evidence: nothing to add, the status speaks for itself;
//   2. nothing has ever been recorded for this broker: the screen says so plainly, rather than
//      naming a placeholder that was never written;
//   3. the latest status row was written by the seed script: the AF-02 label, because a
//      placeholder must never be read as a live verification.
// Anything else keeps the label without the word "seeded": a status that is neither provider
// evidence nor the seed is still not evidence, and the screen must not pass over that in silence
// nor claim a source it cannot name.
export function KybEvidenceNote({ kyb, className }: { kyb: KybState; className?: string }) {
  if (kyb.isProviderEvidence) {
    return null;
  }
  // `provider` is "none" in the empty state (lib/broker/kyb.ts, NO_EVENT_YET), so this branch is
  // a broker who has not submitted, never one whose seeded row happens to read unknown.
  if (kyb.status === "unknown" && kyb.providerAccountId === null && kyb.provider !== SEED_PROVIDER) {
    return <p className={className}>Not submitted yet: no verification on file.</p>;
  }
  if (kyb.provider === SEED_PROVIDER) {
    return <p className={className}>{KYB_NOT_LIVE_LABEL}: the status above is a seeded placeholder, not provider evidence.</p>;
  }
  return <p className={className}>{KYB_NOT_LIVE_LABEL}: the status above is not provider evidence.</p>;
}
