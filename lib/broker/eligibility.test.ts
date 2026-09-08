import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bindingIsAllowed,
  isProviderEvidence,
  KYB_SETTLING_WINDOW_SECONDS,
  kybStatusExplanation,
  reportedKybStatus,
} from "./eligibility";

test("only an approved broker may bind a policy", () => {
  assert.equal(bindingIsAllowed("approved"), true);
});

test("unknown, pending and failed all block binding", () => {
  // A broker with no KYB event at all is "unknown": the absence of a verification is not a
  // permission, so the payment button is refused on the server.
  assert.equal(bindingIsAllowed("unknown"), false);
  assert.equal(bindingIsAllowed("pending"), false);
  assert.equal(bindingIsAllowed("failed"), false);
});

// ---------------------------------------------------------------------------------------
// The settling window. Fixed timestamps, no clock: every case below is a pair of instants.
// ---------------------------------------------------------------------------------------

const SUBMITTED_AT = new Date("2026-09-08T12:00:00.000Z");
const secondsAfterSubmission = (seconds: number) => new Date(SUBMITTED_AT.getTime() + seconds * 1000);

test("the settling window is the decided two minutes", () => {
  assert.equal(KYB_SETTLING_WINDOW_SECONDS, 120);
});

test("a Stripe approval is reported as pending while the window since the submission runs", () => {
  // Stripe's identity check lands 45 to 50 seconds after the account is created. An approval
  // read at 90 seconds is therefore an answer we cannot yet distinguish from "no answer has
  // come back", so it is not acted on (Yoann's decision, DECISIONS.md 11:14Z).
  const reported = reportedKybStatus(
    { status: "approved", provider: "stripe_connect", recordedAt: secondsAfterSubmission(90) },
    SUBMITTED_AT,
    secondsAfterSubmission(90),
  );
  assert.equal(reported.status, "pending");
  assert.equal(reported.heldBySettlingWindow, true);
  assert.equal(bindingIsAllowed(reported.status), false);
});

test("the very last second of the window still holds the approval", () => {
  const reported = reportedKybStatus(
    { status: "approved", provider: "stripe_connect", recordedAt: secondsAfterSubmission(50) },
    SUBMITTED_AT,
    secondsAfterSubmission(119),
  );
  assert.equal(reported.status, "pending");
});

test("once two minutes have passed since the submission, the approval is reported", () => {
  const reported = reportedKybStatus(
    { status: "approved", provider: "stripe_connect", recordedAt: secondsAfterSubmission(50) },
    SUBMITTED_AT,
    secondsAfterSubmission(120),
  );
  assert.equal(reported.status, "approved");
  assert.equal(reported.heldBySettlingWindow, false);
  assert.equal(bindingIsAllowed(reported.status), true);
});

test("an approval recorded INSIDE the window is released once the window has passed", () => {
  // The corner the review found (F-B3-04): a few seconds of skew between Stripe's clock and
  // ours put the approval inside the window, and the old rule then held it for ever, with a
  // re-read appending nothing and a resubmission refused as already verified. Held at 90
  // seconds, approved at 130: the hold ends by itself.
  const skewed = { status: "approved" as const, provider: "stripe_connect", recordedAt: secondsAfterSubmission(3) };
  assert.equal(reportedKybStatus(skewed, SUBMITTED_AT, secondsAfterSubmission(90)).status, "pending");
  const released = reportedKybStatus(skewed, SUBMITTED_AT, secondsAfterSubmission(130));
  assert.equal(released.status, "approved");
  assert.equal(released.heldBySettlingWindow, false);
});

test("the window never makes a status worse: a failure inside it stays a failure", () => {
  // Stripe answering "the EIN does not match" after 40 seconds is a real answer, and waiting
  // longer would not make it better. Only an approval needs the window.
  const reported = reportedKybStatus(
    { status: "failed", provider: "stripe_connect", recordedAt: secondsAfterSubmission(40) },
    SUBMITTED_AT,
    secondsAfterSubmission(40),
  );
  assert.equal(reported.status, "failed");
  assert.equal(reported.heldBySettlingWindow, false);
});

test("a pending recorded inside the window is simply pending", () => {
  const reported = reportedKybStatus(
    { status: "pending", provider: "stripe_connect", recordedAt: secondsAfterSubmission(1) },
    SUBMITTED_AT,
    secondsAfterSubmission(1),
  );
  assert.equal(reported.status, "pending");
  assert.equal(reported.heldBySettlingWindow, false);
});

test("the window applies to Stripe Connect statuses only, not to the seeded placeholder", () => {
  // The window describes how Stripe answers. A row Stripe did not write has nothing to do with
  // it, which is why the seeded demo broker keeps working and why the replay checks can reach
  // an approved state without waiting two minutes.
  const reported = reportedKybStatus(
    { status: "approved", provider: "seed", recordedAt: secondsAfterSubmission(1) },
    SUBMITTED_AT,
    secondsAfterSubmission(1),
  );
  assert.equal(reported.status, "approved");
  assert.equal(reported.heldBySettlingWindow, false);
});

test("a Stripe approval with no submission on file is reported as recorded", () => {
  // There is nothing to measure the window against. This state cannot be produced by the
  // application, where the submission is always committed before the account exists.
  const reported = reportedKybStatus(
    { status: "approved", provider: "stripe_connect", recordedAt: secondsAfterSubmission(10) },
    null,
    secondsAfterSubmission(10),
  );
  assert.equal(reported.status, "approved");
});

test("no event at all is unknown, which blocks binding", () => {
  const reported = reportedKybStatus(null, SUBMITTED_AT, secondsAfterSubmission(0));
  assert.equal(reported.status, "unknown");
  assert.equal(bindingIsAllowed(reported.status), false);
});

test("a submission newer than the approval holds it, because it belongs to another account", () => {
  // The broker submitted again: the approval on file describes the previous connected account,
  // so it is not evidence about the new one, and time does not change that. The new submission
  // writes its own status row, which then becomes the latest event.
  const approvalOfThePreviousAccount = {
    status: "approved" as const,
    provider: "stripe_connect",
    recordedAt: secondsAfterSubmission(-600),
  };
  assert.equal(reportedKybStatus(approvalOfThePreviousAccount, SUBMITTED_AT, secondsAfterSubmission(10)).status, "pending");
  const longAfter = reportedKybStatus(approvalOfThePreviousAccount, SUBMITTED_AT, secondsAfterSubmission(6000));
  assert.equal(longAfter.status, "pending");
  assert.equal(longAfter.heldBySettlingWindow, true);
});

// ---------------------------------------------------------------------------------------
// The labels the screens show
// ---------------------------------------------------------------------------------------

test("a pending broker is told the verification takes at least 2 minutes", () => {
  const sentence = kybStatusExplanation({ status: "pending", reason: null, heldBySettlingWindow: false });
  assert.match(sentence, /verification in progress at Stripe, at least 2 minutes/i);
  assert.match(sentence, /Binding is refused/);
});

test("a held approval says so, so nobody thinks the screen is stale", () => {
  const sentence = kybStatusExplanation({ status: "pending", reason: null, heldBySettlingWindow: true });
  assert.match(sentence, /verification in progress at Stripe, at least 2 minutes/i);
  assert.match(sentence, /Stripe has already answered/);
});

test("a failure quotes Stripe's own reason code", () => {
  const sentence = kybStatusExplanation({
    status: "failed",
    reason: "verification_failed_tax_id_match",
    heldBySettlingWindow: false,
  });
  assert.match(sentence, /Stripe reason: verification_failed_tax_id_match\./);
  assert.match(sentence, /Binding is refused/);
});

test("a status with no reason produces no dangling punctuation", () => {
  assert.equal(
    kybStatusExplanation({ status: "unknown", reason: null, heldBySettlingWindow: false }),
    "No verification on file for this broker. Binding is refused until one passes.",
  );
});

test("an approved broker is told it can bind", () => {
  const sentence = kybStatusExplanation({ status: "approved", reason: null, heldBySettlingWindow: false });
  assert.match(sentence, /can bind policies/);
});

test("only a real provider row counts as evidence", () => {
  // AF-02: the seeded placeholder is never labelled live, and neither is the empty state.
  assert.equal(isProviderEvidence("stripe_connect"), true);
  assert.equal(isProviderEvidence("seed"), false);
  assert.equal(isProviderEvidence("none"), false);
});
