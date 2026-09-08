import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapAccountToEligibility,
  parseAccountUpdatedEvent,
  VERIFICATION_SETTLING_SECONDS,
  type VerifiableAccount,
} from "./eligibility";
import approvedAccount from "./fixtures/account-approved.json";
import failedAccount from "./fixtures/account-failed-tax-id-mismatch.json";
import justCreatedAccount from "./fixtures/account-pending-just-created.json";
import documentedPendingEinAccount from "./fixtures/account-ein-documented-as-pending.json";

// These four fixtures are real Stripe responses, captured on 2026-09-08 by the opt-in live
// test (stripe-connect.live.test.ts) against the test-mode sandbox. They are checked in so
// this test runs offline: `npm test` never calls Stripe. Re-run the live test to refresh
// them when Stripe changes the payload; this test then says whether the mapping still holds.
//
//   account-approved.json                    EIN 000000000, read after the settling window
//   account-pending-just-created.json        the create response of that same account
//   account-failed-tax-id-mismatch.json      EIN 111111111, after Stripe returned the failure
//   account-ein-documented-as-pending.json   EIN 222221005, read after the settling window

const approved = approvedAccount as VerifiableAccount;
const failed = failedAccount as VerifiableAccount;
const justCreated = justCreatedAccount as VerifiableAccount;
const documentedPendingEin = documentedPendingEinAccount as VerifiableAccount;

// A moment `seconds` after Stripe created the account, as an ISO-8601 UTC string.
function checkedSecondsAfterCreation(account: VerifiableAccount, seconds: number): string {
  return new Date(Date.parse(account.created) + seconds * 1000).toISOString();
}

const WELL_AFTER_THE_SETTLING_WINDOW = VERIFICATION_SETTLING_SECONDS + 60;

test("EIN 000000000: the broker is approved once the verification has had time to come back", () => {
  const eligibility = mapAccountToEligibility(approved, checkedSecondsAfterCreation(approved, WELL_AFTER_THE_SETTLING_WINDOW));
  assert.equal(eligibility.status, "approved");
  assert.equal(eligibility.providerAccountId, approved.id);
  assert.equal(eligibility.checkedAt, checkedSecondsAfterCreation(approved, WELL_AFTER_THE_SETTLING_WINDOW));
});

test("EIN 111111111: the broker fails, with Stripe's own error code as the reason", () => {
  const eligibility = mapAccountToEligibility(failed, checkedSecondsAfterCreation(failed, WELL_AFTER_THE_SETTLING_WINDOW));
  assert.equal(eligibility.status, "failed");
  assert.equal(eligibility.reason, "verification_failed_tax_id_match");
  assert.equal(eligibility.providerAccountId, failed.id);
});

test("a brand new account is pending, because Stripe has not answered yet", () => {
  // This is the case that makes the settling window necessary: the account below is the one
  // whose EIN passes, and thirty seconds after its creation its payload says nothing about
  // that. Approving it here would be approving a check that had not run.
  const eligibility = mapAccountToEligibility(justCreated, checkedSecondsAfterCreation(justCreated, 30));
  assert.equal(eligibility.status, "pending");
  assert.equal(eligibility.reason, "awaiting the first verification result");
});

test("the same payload flips from pending to approved only because time passed", () => {
  // Proof that Stripe puts nothing in the payload to distinguish the two: the fixture is one
  // account, read once. Only `checkedAt` changes between these two calls.
  assert.equal(mapAccountToEligibility(approved, checkedSecondsAfterCreation(approved, 30)).status, "pending");
  assert.equal(mapAccountToEligibility(approved, checkedSecondsAfterCreation(approved, 121)).status, "approved");
});

test("EIN 222221005, which Stripe documents as pending, is approved here", () => {
  // Recorded, not assumed. Stripe publishes this EIN as the "pending directory response"
  // fixture, but on 2026-09-08 an account created with it came back like a verified one:
  // no requirement about the business identity, recipient capability active. The trial's
  // pending state is therefore the real one above (the check has not come back yet), not
  // this fixture. Written down here so nobody demonstrates a pending broker with it.
  const eligibility = mapAccountToEligibility(
    documentedPendingEin,
    checkedSecondsAfterCreation(documentedPendingEin, WELL_AFTER_THE_SETTLING_WINDOW),
  );
  assert.equal(eligibility.status, "approved");
});

// ---------------------------------------------------------------------------------------
// The refusals. Each one starts from a real fixture and changes exactly one thing.
// ---------------------------------------------------------------------------------------

function copyOfApprovedAccount(): VerifiableAccount {
  return structuredClone(approved);
}

const LATE_ENOUGH = checkedSecondsAfterCreation(approved, WELL_AFTER_THE_SETTLING_WINDOW);

test("a live-mode account is refused, whatever its requirements say (AF-04)", () => {
  const liveAccount = copyOfApprovedAccount();
  liveAccount.livemode = true;
  const eligibility = mapAccountToEligibility(liveAccount, LATE_ENOUGH);
  assert.equal(eligibility.status, "unknown");
  assert.equal(eligibility.reason, "live_mode_account_refused");
});

test("an account read without its requirements answers unknown, never approved", () => {
  const withoutRequirements = copyOfApprovedAccount();
  delete withoutRequirements.requirements;
  const eligibility = mapAccountToEligibility(withoutRequirements, LATE_ENOUGH);
  assert.equal(eligibility.status, "unknown");
  assert.equal(eligibility.reason, "requirements_not_requested");
});

test("an account read without its recipient configuration answers unknown", () => {
  const withoutConfiguration = copyOfApprovedAccount();
  delete withoutConfiguration.configuration;
  const eligibility = mapAccountToEligibility(withoutConfiguration, LATE_ENOUGH);
  assert.equal(eligibility.status, "unknown");
  assert.equal(eligibility.reason, "recipient_configuration_not_requested");
});

test("a recipient capability that is not active keeps the broker pending", () => {
  const restricted = copyOfApprovedAccount();
  restricted.configuration!.recipient!.capabilities!.stripe_balance!.stripe_transfers!.status = "restricted";
  const eligibility = mapAccountToEligibility(restricted, LATE_ENOUGH);
  assert.equal(eligibility.status, "pending");
  assert.equal(eligibility.reason, "stripe_balance.stripe_transfers is restricted");
});

test("an outstanding requirement about the business identity keeps the broker pending", () => {
  const askingForTheRegisteredName = copyOfApprovedAccount();
  askingForTheRegisteredName.requirements!.entries!.push({
    description: "identity.business_details.registered_name",
    errors: [],
    awaiting_action_from: "user",
  });
  const eligibility = mapAccountToEligibility(askingForTheRegisteredName, LATE_ENOUGH);
  assert.equal(eligibility.status, "pending");
  assert.equal(eligibility.reason, "awaiting identity.business_details.registered_name");
});

test("a requirement Stripe is still working on itself keeps the broker pending", () => {
  const stillChecking = copyOfApprovedAccount();
  stillChecking.requirements!.entries!.push({
    description: "external_account",
    errors: [],
    awaiting_action_from: "stripe",
  });
  assert.equal(mapAccountToEligibility(stillChecking, LATE_ENOUGH).status, "pending");
});

test("a requirement that names nothing keeps the broker pending", () => {
  const unnamedRequirement = copyOfApprovedAccount();
  unnamedRequirement.requirements!.entries!.push({ description: "", errors: [] });
  const eligibility = mapAccountToEligibility(unnamedRequirement, LATE_ENOUGH);
  assert.equal(eligibility.status, "pending");
  assert.equal(eligibility.reason, "awaiting an unnamed requirement");
});

test("a verification error code we have never seen still fails", () => {
  // The rule is the `verification_failed` prefix, not a list of known codes: a new Stripe
  // code must block the broker, not slip through to approved.
  const unknownFailure = copyOfApprovedAccount();
  unknownFailure.requirements!.entries!.push({
    description: "identity.business_details.registered_name",
    errors: [{ code: "verification_failed_something_new", description: "invented for this test" }],
  });
  const eligibility = mapAccountToEligibility(unknownFailure, LATE_ENOUGH);
  assert.equal(eligibility.status, "failed");
  assert.equal(eligibility.reason, "verification_failed_something_new");
});

test("an error that is not a failed verification does not fail the broker", () => {
  // `invalid_url_website_incomplete` is Stripe asking for a better website, not a verdict on
  // who the company is. It leaves the identity untouched, so the broker stays approved.
  const websiteProblem = copyOfApprovedAccount();
  websiteProblem.requirements!.entries!.push({
    description: "defaults.profile.business_url",
    errors: [{ code: "invalid_url_website_incomplete", description: "the website is incomplete" }],
    awaiting_action_from: "user",
  });
  assert.equal(mapAccountToEligibility(websiteProblem, LATE_ENOUGH).status, "approved");
});

// ---------------------------------------------------------------------------------------
// The webhook
// ---------------------------------------------------------------------------------------

test("an account.updated event gives the account to re-read", () => {
  const accountId = parseAccountUpdatedEvent({
    id: "evt_test_1",
    type: "account.updated",
    livemode: false,
    account: "acct_connected",
    data: { object: { id: "acct_connected", object: "account" } },
  });
  assert.equal(accountId, "acct_connected");
});

test("an account.updated event without a data object still names its account", () => {
  const accountId = parseAccountUpdatedEvent({
    id: "evt_test_2",
    type: "account.updated",
    livemode: false,
    account: "acct_connected",
  });
  assert.equal(accountId, "acct_connected");
});

test("any other event type is not ours", () => {
  const accountId = parseAccountUpdatedEvent({
    id: "evt_test_3",
    type: "payment_intent.succeeded",
    livemode: false,
    data: { object: { id: "pi_123", object: "payment_intent" } },
  });
  assert.equal(accountId, null);
});

test("a live-mode event is refused (AF-04)", () => {
  assert.throws(
    () =>
      parseAccountUpdatedEvent({
        id: "evt_test_4",
        type: "account.updated",
        livemode: true,
        account: "acct_connected",
      }),
    /live-mode/,
  );
});

test("an account.updated event with no account id is refused, not ignored", () => {
  assert.throws(
    () => parseAccountUpdatedEvent({ id: "evt_test_5", type: "account.updated", livemode: false }),
    /no account id/,
  );
});
