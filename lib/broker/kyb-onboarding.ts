import type postgres from "postgres";
import { sql } from "@/db/client";
import { mapAccountToEligibility, requirementErrorCodes, type VerifiableAccount } from "@/lib/kyb/eligibility";
import { readBrokerVerification, startBrokerVerification, type UsBusinessAddress } from "@/lib/kyb/stripe-connect";
import { expireOpenCheckoutSessionsOfBroker } from "@/lib/payments/checkout";
import { assertStripeSandbox } from "@/lib/stripe";
import { STRIPE_CONNECT_PROVIDER, bindingIsAllowed, type KybStatus } from "./eligibility";
import {
  appendBrokerKybEvent,
  appendBrokerKybEventIfChanged,
  countBrokerKybSubmissions,
  insertBrokerKybSubmission,
  latestBrokerKybEvent,
  submissionAwaitingProviderAnswer,
} from "./kyb";

// The two operations that talk to Stripe about a broker's business verification.
//
//   submitBrokerKyb          the broker fills the form on /broker/kyb: we record what they
//                            declared, then ask Stripe to verify it.
//   refreshBrokerKybFromStripe   something changed at Stripe (a webhook, or a human pressing
//                            "Re-read from Stripe"): we read the account again and record the
//                            new status if it is new.
//
// The order of writes in submitBrokerKyb is the point of the whole file, and it is the same
// outbox rule the payment code follows (ARCHITECTURE.md section 4):
//
//   1. the submission row is written and COMMITTED before Stripe is called. It carries what
//      the broker declared and, above all, the Stripe Connected Account Agreement acceptance
//      with its real instant and IP address. If the process dies during the provider call,
//      that acceptance is still on file, with the key the call was made under.
//   2. Stripe is called with that key. The key protects against the SAME request being sent
//      twice (a double-clicked form): Stripe answers with the account it already created.
//      It does not replay a lost answer: the EIN is never stored, so a broker who submits
//      again after a lost answer sends a new request under a new key, and Stripe may hold a
//      second, unused connected account for that broker (review finding F-B3-02, accepted:
//      an orphan test account costs nothing and binds nothing).
//   3. what Stripe answered is appended to broker_kyb_events, never written over anything.
//
// A provider error at step 2 is a fact about the broker, so it is appended as a 'failed'
// status carrying Stripe's own sanitized message, and binding stays refused.

export class BrokerKybRefused extends Error {}

export type BrokerKybSubmissionRequest = {
  brokerId: string;
  legalName: string;
  // Nine digits, no dash. It is sent to Stripe, which is the party that verifies it, and only
  // its last four digits are ever written to our database (migration 0006).
  employerIdentificationNumber: string;
  address: UsBusinessAddress;
  businessUrl: string;
  contactEmail: string;
  // The real instant and address of the broker's click on the agreement checkbox, read from
  // the request by the route handler. Never invented: Stripe records them as the account's
  // own acceptance of its services agreement.
  termsAcceptedAt: Date;
  termsAcceptedFromIp: string;
  submittedByUserId: string;
};

export type BrokerKybSubmissionResult = {
  submissionId: string;
  providerAccountId: string;
  status: KybStatus;
  reason: string;
};

// How long a submission whose Stripe answer never came back blocks a new one. Stripe creates the
// connected account in about four seconds, so two minutes is long enough that a second click can
// never start a second account, and short enough that a broker whose process died is not locked
// out for the afternoon.
export const SUBMISSION_IN_FLIGHT_MINUTES = 2;

export async function submitBrokerKyb(
  request: BrokerKybSubmissionRequest,
  database: postgres.Sql = sql,
): Promise<BrokerKybSubmissionResult> {
  assertSubmissionIsUsable(request);

  // Step 1, in ONE transaction that holds an advisory lock on the broker: decide whether this
  // broker may submit, and write the submission. The lock is the same key
  // appendBrokerKybEventIfChanged takes, so a status arriving from a webhook and a submission
  // cannot interleave either.
  //
  // Without it the guards below were read outside any lock and the only serialisation was the
  // unique index on the derived idempotency key, which stops two clicks that computed the SAME
  // attempt number and nothing else: a second click arriving after the first insert committed
  // computed attempt 2 and created a SECOND connected account at Stripe (review finding F-B3-05).
  //
  // Stripe is deliberately NOT called inside this transaction: the outbox rule wants the
  // submission and its terms acceptance committed before anything leaves, and a network call
  // must never hold a database transaction open.
  const { submissionId, idempotencyKey } = await database.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtext(${request.brokerId}))`;

    // One verification at a time. A broker whose Stripe verification is pending or approved does
    // not need a second connected account; re-reading the one they have is the right action, and
    // it is what the screens offer. A failed verification can always be submitted again with
    // corrected details, which is the whole point of showing the failure.
    const latestEvent = await latestBrokerKybEvent(request.brokerId, transaction);
    if (latestEvent?.provider === STRIPE_CONNECT_PROVIDER) {
      if (latestEvent.status === "approved") {
        throw new BrokerKybRefused("this broker is already verified at Stripe");
      }
      if (latestEvent.status === "pending") {
        throw new BrokerKybRefused(
          "a verification is already in progress at Stripe for this broker; check its status instead of starting another one",
        );
      }
    }

    // The case the latest event cannot see: a submission committed moments ago whose Stripe
    // answer has not been recorded yet. Its status row is exactly what does not exist yet.
    const inFlight = await submissionAwaitingProviderAnswer(
      request.brokerId,
      SUBMISSION_IN_FLIGHT_MINUTES,
      transaction,
    );
    if (inFlight) {
      throw new BrokerKybRefused(
        "a verification for this broker was sent to Stripe moments ago and has not answered yet; " +
          "wait for it and check its status instead of starting another one",
      );
    }

    const attempt = (await countBrokerKybSubmissions(request.brokerId, transaction)) + 1;
    const key = brokerKybIdempotencyKey(request.brokerId, attempt);
    const inserted = await insertBrokerKybSubmission(
      {
        brokerId: request.brokerId,
        provider: STRIPE_CONNECT_PROVIDER,
        providerIdempotencyKey: key,
        legalName: request.legalName,
        einLast4: request.employerIdentificationNumber.slice(-4),
        addressLine1: request.address.line1,
        addressCity: request.address.city,
        addressState: request.address.state,
        addressPostalCode: request.address.postalCode,
        businessUrl: request.businessUrl,
        contactEmail: request.contactEmail,
        termsAcceptedAt: request.termsAcceptedAt,
        termsAcceptedIp: request.termsAcceptedFromIp,
        submittedBy: request.submittedByUserId,
      },
      transaction,
    );
    return { submissionId: inserted.submissionId, idempotencyKey: key };
  });

  // AF-04: Stripe's own statement that it is answering in test mode, before the first call
  // that creates anything.
  await assertStripeSandbox();

  // Step 2.
  let started;
  try {
    started = await startBrokerVerification({
      brokerId: request.brokerId,
      legalName: request.legalName,
      employerIdentificationNumber: request.employerIdentificationNumber,
      address: request.address,
      contactEmail: request.contactEmail,
      businessUrl: request.businessUrl,
      termsOfServiceAcceptedAt: request.termsAcceptedAt.toISOString(),
      termsOfServiceAcceptedFromIp: request.termsAcceptedFromIp,
      idempotencyKey,
    });
  } catch (error) {
    const message = sanitizedProviderMessage(error);
    await appendBrokerKybEvent(
      {
        brokerId: request.brokerId,
        provider: STRIPE_CONNECT_PROVIDER,
        status: "failed",
        providerAccountId: null,
        payload: {
          submission_id: submissionId,
          source: "create_account",
          stage: "create_account",
          reason: message,
          requirement_error_codes: [],
        },
        createdBy: request.submittedByUserId,
      },
      database,
    );
    throw new BrokerKybRefused(`Stripe refused the verification request: ${message}`);
  }

  // Step 3. The status recorded is the one the mapping reads on the account Stripe just
  // returned, not a value we choose: in every observed run that is 'pending', because the
  // business identity check has not answered yet and the settling window says so.
  const checkedAt = new Date().toISOString();
  const eligibility = mapAccountToEligibility(started.rawResponse, checkedAt);
  await appendBrokerKybEvent(
    {
      brokerId: request.brokerId,
      provider: STRIPE_CONNECT_PROVIDER,
      status: eligibility.status,
      providerAccountId: started.providerAccountId,
      payload: {
        submission_id: submissionId,
        source: "create_account",
        reason: eligibility.reason,
        checked_at: checkedAt,
        requirement_error_codes: requirementErrorCodes(started.rawResponse),
      },
      createdBy: request.submittedByUserId,
    },
    database,
  );

  return {
    submissionId,
    providerAccountId: started.providerAccountId,
    status: eligibility.status,
    reason: eligibility.reason,
  };
}

// ---------------------------------------------------------------------------------------
// Reading an account again
// ---------------------------------------------------------------------------------------

export type KybAccountUpdate = {
  brokerId: string;
  // The account as Stripe returned it. Always a fresh read, never a webhook payload: a v1
  // `account.updated` event carries the v1 view of a v2 account, and a webhook body is
  // untrusted input that can arrive out of order.
  account: VerifiableAccount;
  checkedAt: string; // ISO-8601 UTC, the instant of the read
  source: string; // 'account.updated', 'staff_re_read', 'broker_re_read'
  actorUserId: string | null; // the human who asked, null for a webhook
};

export type KybUpdateOutcome = {
  status: KybStatus;
  reason: string;
  requirementErrorCodes: string[];
  appended: boolean;
  previousStatus: KybStatus | null;
  // How many of the broker's open payment pages were closed because the new status forbids
  // binding (see expireOpenCheckoutSessionsOfBroker). Only set by the Stripe refresh.
  expiredCheckoutSessions?: number;
  // Set instead of the count when Stripe refused to close the pages; the status stays recorded.
  expiryError?: string;
};

// Maps a freshly read account and records the result if, and only if, the status changed.
// Kept separate from the network call so the replay check (scripts/check-kyb-replay.ts) can
// feed it the captured Stripe payloads in lib/kyb/fixtures without a network round trip.
export async function applyKybAccountUpdate(
  update: KybAccountUpdate,
  database: postgres.Sql = sql,
): Promise<KybUpdateOutcome> {
  const eligibility = mapAccountToEligibility(update.account, update.checkedAt);
  const errorCodes = requirementErrorCodes(update.account);

  const { appended, previousStatus } = await appendBrokerKybEventIfChanged(
    {
      brokerId: update.brokerId,
      provider: STRIPE_CONNECT_PROVIDER,
      status: eligibility.status,
      providerAccountId: eligibility.providerAccountId,
      payload: {
        source: update.source,
        reason: eligibility.reason,
        checked_at: update.checkedAt,
        requirement_error_codes: errorCodes,
      },
      createdBy: update.actorUserId,
    },
    database,
  );

  return {
    status: eligibility.status,
    reason: eligibility.reason,
    requirementErrorCodes: errorCodes,
    appended,
    previousStatus,
  };
}

export type RefreshRequest = {
  brokerId: string;
  providerAccountId: string;
  source: string;
  actorUserId: string | null;
};

// Reads the account at Stripe and records what it says.
//
// This is the only way an approval is ever recorded, and it is deliberate: Stripe stops
// emitting `account.updated` once the identity check has landed, which happens INSIDE the
// two-minute settling window, so every event-driven read during that window maps to pending
// and writes nothing new. Something has to look again afterwards. The screens therefore give
// the broker and the operations team a button that calls this, and the handoff note says so.
//
// It reads with readBrokerVerification and maps with mapAccountToEligibility rather than
// calling readBrokerEligibility, which is the two of them in one line: the raw account is
// needed as well, to store Stripe's requirement error codes with the status.
export async function refreshBrokerKybFromStripe(
  request: RefreshRequest,
  database: postgres.Sql = sql,
): Promise<KybUpdateOutcome> {
  await assertStripeSandbox();
  const account = await readBrokerVerification(request.providerAccountId);
  const outcome = await applyKybAccountUpdate(
    {
      brokerId: request.brokerId,
      account,
      checkedAt: new Date().toISOString(),
      source: request.source,
      actorUserId: request.actorUserId,
    },
    database,
  );
  // The broker can no longer bind: close the payment pages still open on their policies, so
  // that a customer does not pay for a policy that cannot be bound (rule 14, technical
  // addition). Done after the status is committed, and only on a real change.
  if (outcome.appended && !bindingIsAllowed(outcome.status)) {
    // The status row is already committed. A Stripe error while closing the pages must not turn
    // that committed transition into a webhook failure that a retry could not repair (the retry
    // would find nothing to append): it is recorded on the outcome and shown, not thrown
    // (review finding F-B7-11). A page left open is caught by rule 14 at payment time anyway.
    try {
      outcome.expiredCheckoutSessions = await expireOpenCheckoutSessionsOfBroker(request.brokerId, database);
    } catch (error) {
      outcome.expiryError = error instanceof Error ? error.message.slice(0, 300) : "unknown error while expiring sessions";
    }
  }
  return outcome;
}

// ---------------------------------------------------------------------------------------
// Small rules used above
// ---------------------------------------------------------------------------------------

// Derived from the broker and the attempt number, never random, and unique in the database:
// a double-clicked form computes the same key twice and the unique index on
// broker_kyb_submissions turns the second insert into an error instead of a second Stripe
// account. The shape matches the payment keys (lib/money/idempotency.ts).
export function brokerKybIdempotencyKey(brokerId: string, attempt: number): string {
  if (!brokerId) {
    throw new Error("brokerId is required to derive a KYB idempotency key");
  }
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`an attempt must be a whole number starting at 1, got ${attempt}`);
  }
  return attempt === 1 ? `broker-kyb:${brokerId}` : `broker-kyb:${brokerId}:${attempt}`;
}

// What the form must contain before anything is written or sent. Checked here rather than
// only in the route handler, so a direct API call meets the same rules as the button.
function assertSubmissionIsUsable(request: BrokerKybSubmissionRequest): void {
  if (!/^[0-9]{9}$/.test(request.employerIdentificationNumber)) {
    throw new BrokerKybRefused("the EIN must be nine digits with no dash, for example 000000000");
  }
  if (request.legalName.trim().length < 2) {
    throw new BrokerKybRefused("the registered legal name is required");
  }
  if (!/^[A-Z]{2}$/.test(request.address.state)) {
    throw new BrokerKybRefused("the state must be a two-letter code, for example CA");
  }
  if (!/^https?:\/\/\S+$/.test(request.businessUrl)) {
    // Stripe is the authority on whether the URL is acceptable (it refuses example.com with
    // `url_invalid`); this only stops something that is not a URL at all.
    throw new BrokerKybRefused("the business website must be a full URL starting with https://");
  }
  if (!request.contactEmail.includes("@")) {
    throw new BrokerKybRefused("a contact email is required");
  }
  if (!request.termsAcceptedFromIp) {
    throw new BrokerKybRefused("the address the agreement was accepted from could not be read");
  }
}

// Provider errors are appended to the broker's history, so they must be short and carry no
// credential. Stripe's SDK errors have a human message; anything else is reported as unknown
// rather than stringified blindly.
function sanitizedProviderMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "unknown provider error";
}
