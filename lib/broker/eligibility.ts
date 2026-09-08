// Whether a broker may bind a policy, and what the interface says about it. Every function
// here is pure, so it can be read and tested on its own; the statuses themselves come from the
// append-only broker_kyb_events table (lib/broker/kyb.ts).

export type KybStatus = "unknown" | "pending" | "approved" | "failed";

// Only an approved broker may bind. "unknown" and "pending" are not permission: eligibility
// that has not been established blocks the action (AGENTS.md, KYC section), and a broker whose
// verification failed does not become eligible by waiting.
export function bindingIsAllowed(status: KybStatus): boolean {
  return status === "approved";
}

// The provider name written by the seed script. Its row exists so the issuance flow could be
// demonstrated before this slice connected Stripe; it is not provider evidence and the
// interface says so wherever it appears (AF-02).
export const SEED_PROVIDER = "seed";

// The provider name written by every real Stripe Connect status row.
export const STRIPE_CONNECT_PROVIDER = "stripe_connect";

// ---------------------------------------------------------------------------------------
// The settling window
// ---------------------------------------------------------------------------------------

// Decided by Yoann on 2026-09-08 (docs/DECISIONS.md, 11:14Z): a broker account is held at
// pending for at least two minutes after it is submitted, and is approved only once Stripe has
// had time to answer and reported no requirement error.
//
// Why two minutes, and why the rule exists at all. Stripe creates the connected account
// immediately and returns a payload that says nothing about the business identity check; the
// result of that check lands 45 to 50 seconds later (measured three times out of three on
// 2026-09-08, docs/handoffs/docs-kyb-implementation-notes.md). During those first seconds an
// account whose EIN will fail is indistinguishable from one whose EIN will pass, and Stripe
// exposes no "check in progress" flag. So an approval read too early is not an approval at
// all: it is the absence of an answer. Two minutes is the measurement with room to spare.
//
// It is a floor, not a guarantee: a slower check could still come back after it. That is
// acceptable because the rule is safe in one direction only, and it is the direction that
// matters: it can delay an approval, it can never grant one early.
//
// The same window is applied twice, at two different boundaries and against two different
// clocks, on purpose:
//   * lib/kyb/eligibility.ts measures it from Stripe's own `created` timestamp when it maps a
//     freshly read account, so a read taken seconds after creation reports pending;
//   * this function measures it from our own submission row to the moment of the reading, so an
//     approval that somehow reached the table too early is still not acted on until the window
//     has passed.
export const KYB_SETTLING_WINDOW_SECONDS = 120;

export type RecordedKybEvent = {
  status: KybStatus;
  provider: string;
  recordedAt: Date;
};

export type ReportedKybStatus = {
  status: KybStatus;
  // True when an 'approved' row exists but is being reported as pending because it was
  // recorded inside the settling window. Shown to staff so the screen explains itself.
  heldBySettlingWindow: boolean;
};

// The status the rest of the application acts on, given the latest recorded event and the
// submission that produced the account it talks about.
//
// The rule, in one sentence: report what the latest event says, unless it is a Stripe Connect
// approval and less than the settling window has passed since the broker submitted, in which
// case report pending.
//
// THE HOLD IS MEASURED AGAINST `now`, NOT AGAINST THE INSTANT THE APPROVAL WAS RECORDED (review
// finding F-B3-04). Yoann's rule is "held at pending for at least two minutes after the broker
// submits", and reading it from the recorded row said something else: an approval that landed
// inside the window (a few seconds of skew between Stripe's clock and ours is enough) was held
// for ever, a re-read appended nothing because the status had not changed, and a resubmission
// was refused as already verified. Time-relative, the hold ends by itself.
//
// Everything else passes through unchanged, and deliberately so:
//   * a 'failed' or 'pending' row is reported as it is; the window never makes a status worse
//     than pending or better than what was recorded;
//   * a row from another provider (the seed placeholder) is reported as it is; the window
//     describes Stripe's behaviour and has nothing to say about a row Stripe did not write;
//   * a Stripe approval with no submission on file has nothing to be measured against, so it
//     is reported as recorded. That state cannot be reached by this build, where a submission
//     is always committed before the account exists.
//
// `now` is an argument rather than a call to the clock, so the function stays pure and every
// case below can be written as a pair of instants in the tests.
export function reportedKybStatus(
  latestEvent: RecordedKybEvent | null,
  submissionRecordedAt: Date | null,
  now: Date,
): ReportedKybStatus {
  if (!latestEvent) {
    return { status: "unknown", heldBySettlingWindow: false };
  }
  const isStripeApproval =
    latestEvent.provider === STRIPE_CONNECT_PROVIDER && latestEvent.status === "approved";
  if (!isStripeApproval || !submissionRecordedAt) {
    return { status: latestEvent.status, heldBySettlingWindow: false };
  }
  if (secondsBetween(submissionRecordedAt, now) < KYB_SETTLING_WINDOW_SECONDS) {
    return { status: "pending", heldBySettlingWindow: true };
  }
  // An approval recorded BEFORE the submission it is measured against describes the connected
  // account of an earlier submission, so it is not evidence about this one and no amount of
  // waiting makes it so. The new submission writes its own status row, which then takes over as
  // the latest event, so nothing is stuck: this only decides what to say in between.
  if (latestEvent.recordedAt < submissionRecordedAt) {
    return { status: "pending", heldBySettlingWindow: true };
  }
  return { status: "approved", heldBySettlingWindow: false };
}

// Whole seconds between two instants.
function secondsBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 1000);
}

// ---------------------------------------------------------------------------------------
// What the interface says
// ---------------------------------------------------------------------------------------

// Shown next to the status while the only evidence is the seed placeholder. AF-02: a
// placeholder is never labelled live.
export const KYB_NOT_LIVE_LABEL = "KYB: not yet live";

// Is this status row evidence from a provider, or our own development placeholder?
// 'none' is the provider of the empty state, when no row exists at all.
export function isProviderEvidence(provider: string): boolean {
  return provider !== SEED_PROVIDER && provider !== "none";
}

export type KybExplanationInput = {
  status: KybStatus;
  // Stripe's own error code for a failure, or our short reason for a pending or unknown state.
  reason: string | null;
  heldBySettlingWindow: boolean;
};

// One sentence explaining the status, in the words the broker and the operator need. It is a
// pure function so the same sentence appears on every screen and can be tested.
export function kybStatusExplanation(input: KybExplanationInput): string {
  switch (input.status) {
    case "approved":
      return "Stripe's business verification passed. This broker can bind policies.";
    case "pending":
      if (input.heldBySettlingWindow) {
        return (
          "Verification in progress at Stripe, at least 2 minutes. Stripe has already answered, " +
          "but an approval recorded inside those first two minutes is not acted on: the identity " +
          "check lands about a minute after submission, so an earlier answer is the absence of a " +
          "result rather than a result."
        );
      }
      return `Verification in progress at Stripe, at least 2 minutes. Binding is refused until it passes.${detailSentence(input.reason)}`;
    case "failed":
      return `Stripe refused this verification. Binding is refused; submitting corrected details starts a new verification.${detailSentence(input.reason)}`;
    case "unknown":
      return `No verification on file for this broker. Binding is refused until one passes.${detailSentence(input.reason)}`;
  }
}

// " Stripe reason: verification_failed_tax_id_match." when there is one, nothing when there is
// not, so no sentence ever ends with a dangling colon.
function detailSentence(reason: string | null): string {
  return reason ? ` Stripe reason: ${reason}.` : "";
}
