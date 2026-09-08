import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mapAccountToEligibility, VERIFICATION_SETTLING_SECONDS, type VerifiableAccount } from "./eligibility";

// Live sandbox test. It talks to Stripe, so it is opt-in and `npm test` never runs it:
//
//   RUN_LIVE_STRIPE_TESTS=1 node --env-file=.env.local --import tsx --test \
//     lib/kyb/stripe-connect.live.test.ts
//
// It does two jobs. It proves the adapter works against the real API in test mode, and it
// rewrites the three fixtures in lib/kyb/fixtures/ that the offline test in
// eligibility.test.ts reads. Run it again whenever Stripe changes the payload; the offline
// test then tells you whether the mapping still holds.
//
// Every account it creates carries metadata `corgi_probe: kyb-adapter-test` and a display
// name starting with "Test Brokerage", so the probes can be told apart from product data in
// the Stripe dashboard. Test mode only: lib/stripe.ts refuses a live key and every read
// asserts `livemode === false` (AF-04).

const LIVE_TESTS_ENABLED = process.env.RUN_LIVE_STRIPE_TESTS === "1";
const SKIP_REASON = "set RUN_LIVE_STRIPE_TESTS=1 to run the live Stripe sandbox test";

// Stripe's published test values for US business verification.
const EIN_THAT_VERIFIES = "000000000";
const EIN_THAT_FAILS_THE_TAX_ID_MATCH = "111111111";
const EIN_DOCUMENTED_AS_PENDING = "222221005";

// Stripe's test token for an address that matches the business records exactly.
const PROBE_ADDRESS = { line1: "address_full_match", city: "San Francisco", state: "CA", postalCode: "94105" };

const FIXTURE_DIRECTORY = join(__dirname, "fixtures");

test("a broker account created in the Stripe sandbox maps to the right eligibility", { skip: !LIVE_TESTS_ENABLED && SKIP_REASON }, async () => {
  const { startBrokerVerification, readBrokerVerification } = await import("./stripe-connect");

  async function createProbeAccount(label: string, employerIdentificationNumber: string) {
    const started = await startBrokerVerification({
      brokerId: `probe-${label.toLowerCase()}`,
      legalName: `Test Brokerage ${label} LLC`,
      employerIdentificationNumber,
      address: PROBE_ADDRESS,
      contactEmail: `broker-${label.toLowerCase()}@example.com`,
      businessUrl: "https://corgi-work-trial-iota.vercel.app",
      termsOfServiceAcceptedAt: new Date().toISOString(),
      termsOfServiceAcceptedFromIp: "203.0.113.10",
      additionalMetadata: { corgi_probe: "kyb-adapter-test" },
    });
    // AF-04: a live account must never come back from a test key.
    assert.equal(started.rawResponse.livemode, false, `${label} came back as a live-mode account`);
    return started;
  }

  const verified = await createProbeAccount("Alpha", EIN_THAT_VERIFIES);
  const failing = await createProbeAccount("Bravo", EIN_THAT_FAILS_THE_TAX_ID_MATCH);
  const documentedPending = await createProbeAccount("Charlie", EIN_DOCUMENTED_AS_PENDING);
  console.log("probe accounts:", verified.providerAccountId, failing.providerAccountId, documentedPending.providerAccountId);

  // A brand new account is pending, whatever its EIN turns out to be: Stripe has not
  // returned the identity check yet, and nothing in the payload says so.
  const justCreated = mapAccountToEligibility(verified.rawResponse, new Date().toISOString());
  assert.equal(justCreated.status, "pending");
  assert.equal(justCreated.reason, "awaiting the first verification result");
  writeFixture("account-pending-just-created.json", verified.rawResponse);

  // The identity check took 45 to 50 seconds on 2026-09-08. Wait for its result rather than
  // sleeping a fixed time, and give up loudly instead of asserting on a half-finished state.
  const failedAccount = await waitForVerificationFailure(failing.providerAccountId, readBrokerVerification);
  const failedEligibility = mapAccountToEligibility(failedAccount, new Date().toISOString());
  assert.equal(failedEligibility.status, "failed");
  assert.equal(failedEligibility.reason, "verification_failed_tax_id_match");
  writeFixture("account-failed-tax-id-mismatch.json", failedAccount);

  // The account whose EIN passes says nothing when it passes: there is no "verified" flag to
  // wait for, only the settling window. Wait it out, then read.
  await waitForTheSettlingWindow(verified.rawResponse.created);
  const verifiedAccount = await readBrokerVerification(verified.providerAccountId);
  const verifiedEligibility = mapAccountToEligibility(verifiedAccount, new Date().toISOString());
  assert.equal(verifiedEligibility.status, "approved", `expected approved, got ${verifiedEligibility.reason}`);
  writeFixture("account-approved.json", verifiedAccount);

  // Stripe documents 222221005 as the "pending" EIN. Whatever it does, it is recorded here
  // rather than assumed: read once its own settling window has passed, print what came out
  // and write the fixture. The handoff notes say what it actually produced.
  await waitForTheSettlingWindow(documentedPending.rawResponse.created);
  const documentedPendingAccount = await readBrokerVerification(documentedPending.providerAccountId);
  const documentedPendingEligibility = mapAccountToEligibility(documentedPendingAccount, new Date().toISOString());
  console.log(`EIN ${EIN_DOCUMENTED_AS_PENDING} maps to ${documentedPendingEligibility.status}: ${documentedPendingEligibility.reason}`);
  writeFixture("account-ein-documented-as-pending.json", documentedPendingAccount);
});

// Polls the account until Stripe adds the failed identity check, for at most three minutes.
async function waitForVerificationFailure(
  providerAccountId: string,
  readBrokerVerification: (id: string) => Promise<VerifiableAccount>,
): Promise<VerifiableAccount> {
  const startedAt = Date.now();
  const giveUpAfterMillis = 3 * 60 * 1000;
  while (Date.now() - startedAt < giveUpAfterMillis) {
    const account = await readBrokerVerification(providerAccountId);
    const carriesAVerificationError = (account.requirements?.entries ?? []).some((entry) =>
      (entry.errors ?? []).some((error) => error.code?.startsWith("verification_failed")),
    );
    if (carriesAVerificationError) return account;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(
    `Stripe returned no verification result for ${providerAccountId} within three minutes; ` +
      `the sandbox behaviour changed and the fixtures must be reviewed by hand`,
  );
}

// The mapping refuses to call a clean account approved until it is old enough for Stripe's
// identity check to have come back (see VERIFICATION_SETTLING_SECONDS). This waits it out.
async function waitForTheSettlingWindow(accountCreatedAt: string): Promise<void> {
  const settledAtMillis = Date.parse(accountCreatedAt) + VERIFICATION_SETTLING_SECONDS * 1000;
  const millisToWait = settledAtMillis - Date.now();
  if (millisToWait <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, millisToWait + 1000));
}

function writeFixture(fileName: string, account: unknown): void {
  mkdirSync(FIXTURE_DIRECTORY, { recursive: true });
  writeFileSync(join(FIXTURE_DIRECTORY, fileName), `${JSON.stringify(account, null, 2)}\n`);
}
