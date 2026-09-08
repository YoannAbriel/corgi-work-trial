// Turning Stripe's account payload into the four states this application acts on.
//
// This file is pure: no Stripe client, no database, no clock. It is separate from
// stripe-connect.ts for two reasons. Reading an account is a network call and mapping it is
// a decision about a payload, and they fail for different reasons. And `npm test` must stay
// offline: importing lib/stripe.ts throws when no API key is set, so the tests of this
// mapping import this file and never that one.
//
// What was actually observed on the Stripe sandbox on 2026-09-08, with the published test
// EINs, an accepted terms-of-service attestation and a business URL supplied at creation
// (see docs/handoffs/docs-kyb-implementation-notes.md for the raw runs):
//   - the account is created and `stripe_balance.stripe_transfers` is `active` immediately;
//   - the result of the business identity check arrives 45 to 50 seconds LATER, as a new
//     requirement entry `identity.business_details.id_numbers.us_ein` carrying the error
//     `verification_failed_tax_id_match` for EIN 111111111;
//   - during those first 45 seconds the payload of an account whose EIN will fail is byte
//     for byte the same shape as one whose EIN passes. Stripe exposes no "check in progress"
//     flag, on the v2 account or on its v1 view (`requirements.pending_verification` stays
//     empty).
// That last point is the whole reason for the settling window below. Without it, reading an
// account straight after creating it would report a broker as approved because the check
// had not come back yet.

// Only the fields the mapping reads. Stripe's `Stripe.V2.Core.Account` satisfies this type,
// and so does a fixture parsed from a JSON file, which is what the tests use.
export type VerifiableAccount = {
  id: string;
  // false in test mode. Never approved when this is not false (AF-04).
  livemode: boolean;
  // When Stripe created the account, RFC 3339 UTC. Used to tell a fresh account from one
  // whose verification has had time to come back.
  created: string;
  // Present only when the account was fetched with `include: ["requirements"]`. Absent means
  // "we did not ask", not "nothing is required", so it can never mean approved.
  requirements?: {
    entries?: RequirementEntry[];
  };
  // Present only when fetched with `include: ["configuration.recipient"]`.
  configuration?: {
    recipient?: {
      capabilities?: {
        stripe_balance?: {
          stripe_transfers?: { status?: string };
        };
      };
    };
  };
};

// One outstanding requirement on the account, as Stripe v2 describes it.
export type RequirementEntry = {
  // Machine-readable path of what is being asked for, for example
  // "identity.business_details.id_numbers.us_ein" or "external_account". This is what the
  // mapping reads to decide whether the business identity itself is in question.
  description?: string;
  // Why the information already given is not satisfactory. A code starting with
  // `verification_failed` is Stripe saying the check ran and did not pass.
  errors?: { code?: string; description?: string }[];
  // 'user' or 'stripe': who has to act next. 'stripe' means Stripe is still working on it.
  awaiting_action_from?: string;
  // What breaks if the requirement is not met. Read for the operator-facing reason only; the
  // decision below is taken on the description and the error codes, because `impact` says
  // which capability suffers, not what is being verified.
  impact?: {
    restricts_capabilities?: { capability?: string; configuration?: string; deadline?: { status?: string } }[];
  };
  minimum_deadline?: { status?: string };
  requested_reasons?: { code?: string }[];
};

// What the rest of the application is allowed to know about a broker.
//   unknown  no usable answer (requirements were not requested, live-mode account).
//            Blocks binding, like pending.
//   pending  Stripe is still asking for, or still checking, the business identity.
//   approved the business identity is settled and nothing about it is outstanding.
//   failed   a verification check ran and did not pass.
// Binding a policy is allowed only on `approved`, checked server-side at execution time.
export type BrokerEligibilityStatus = "unknown" | "pending" | "approved" | "failed";

export type BrokerEligibility = {
  status: BrokerEligibilityStatus;
  // One short reason, stored with the event and shown to staff. For a failure it is Stripe's
  // own error code, so the debrief can point at the provider's word rather than ours.
  reason: string;
  providerAccountId: string;
  // When we looked, ISO-8601 UTC. Passed in rather than read from a clock so this function
  // stays pure and the stored event carries the instant its caller recorded.
  checkedAt: string;
};

// Stripe's error codes for a check that ran and did not pass all start with this prefix, for
// example `verification_failed_tax_id_match` (the EIN does not match the registered name) or
// `verification_failed_name_match`. A prefix rather than a list of codes: a code we have
// never seen must fail closed, not fall through to approved.
const FAILED_VERIFICATION_CODE_PREFIX = "verification_failed";

// Requirement paths that put the company's own identity in question. Stripe names a
// requirement with a dotted path, so a prefix match covers
// `identity.business_details.id_numbers.us_ein`, `.registered_name`, `.address.line1` and
// the documents Stripe asks for to settle them.
const BUSINESS_IDENTITY_REQUIREMENT_PREFIXES = [
  "identity.business_details", // registered name, EIN, registered address, company documents
  "identity.individual", // the natural person representing the company
  "identity.entity_type",
];

// The capability that says Stripe accepts this account as a recipient of our money. It is
// requested at creation (stripe-connect.ts) and is `active` only once Stripe is satisfied
// with what it has been given so far.
const REQUIRED_RECIPIENT_CAPABILITY = "stripe_balance.stripe_transfers";

// How long after creation a clean-looking account is still treated as pending.
//
// Measured, not guessed: on 2026-09-08 the identity check result took 45 to 50 seconds to
// appear, three times out of three, and until it did there was nothing in the payload to
// distinguish an unverified account from a verified one. Two minutes is that measurement
// with room to spare.
//
// This is a floor and not a guarantee: a slower check could still come back after it. It is
// safe in one direction only, which is the direction that matters here (it can delay an
// approval, never grant one early). The real trigger is the `account.updated` event, which
// makes us re-read the account whenever Stripe changes it; the settling window only stops a
// read taken seconds after creation from reporting an approval that nobody has made yet.
export const VERIFICATION_SETTLING_SECONDS = 120;

// Reads an account and says whether its broker may bind a policy.
//
// The rules, in the order they are applied. Every one of them can only refuse; `approved` is
// what is left when none of them fires.
//   1. `livemode` is not false: refuse. AF-04 forbids handling a live account at all, so
//      there is nothing to say about it. Reported as `unknown`, which blocks binding.
//   2. No `requirements` on the payload: `unknown`. The account was read without asking for
//      them, and answering "approved" would be inventing a verification that never ran.
//   3. Any requirement entry carrying an error code starting with `verification_failed`:
//      `failed`, with that code, unchanged, as the reason.
//   4. Any requirement entry that names part of the business identity, that Stripe says it
//      is working on itself, or that we cannot classify because it names nothing: `pending`.
//   5. The recipient capability is missing from the payload, or is not `active`: `pending`
//      (or `unknown` when we simply did not ask for it). Stripe has not accepted the account.
//   6. The account is younger than the settling window: `pending`. See the constant above.
//   7. Otherwise `approved`.
//
// Every uncertain case lands on `pending` or `unknown`, never on `approved`: blocking a
// verified broker for two minutes costs a support message, and binding a policy for an
// unverified one is the thing the brief is testing.
export function mapAccountToEligibility(account: VerifiableAccount, checkedAt: string): BrokerEligibility {
  const decide = (status: BrokerEligibilityStatus, reason: string): BrokerEligibility => ({
    status,
    reason,
    providerAccountId: account.id,
    checkedAt,
  });

  if (account.livemode !== false) {
    return decide("unknown", "live_mode_account_refused");
  }

  const entries = account.requirements?.entries;
  if (!entries) {
    return decide("unknown", "requirements_not_requested");
  }

  for (const entry of entries) {
    for (const error of entry.errors ?? []) {
      if (error.code?.startsWith(FAILED_VERIFICATION_CODE_PREFIX)) {
        return decide("failed", error.code);
      }
    }
  }

  const identityEntry = entries.find(questionsTheBusinessIdentity);
  if (identityEntry) {
    return decide("pending", `awaiting ${identityEntry.description || "an unnamed requirement"}`);
  }

  const recipientCapabilities = account.configuration?.recipient?.capabilities;
  if (!recipientCapabilities) {
    return decide("unknown", "recipient_configuration_not_requested");
  }
  const transfersStatus = recipientCapabilities.stripe_balance?.stripe_transfers?.status;
  if (transfersStatus !== "active") {
    return decide("pending", `${REQUIRED_RECIPIENT_CAPABILITY} is ${transfersStatus ?? "absent"}`);
  }

  if (secondsBetween(account.created, checkedAt) < VERIFICATION_SETTLING_SECONDS) {
    return decide("pending", "awaiting the first verification result");
  }

  return decide("approved", "business identity settled and recipient capability active");
}

// Does this requirement put the company's identity in question?
//
// Deliberately pessimistic on the two cases where we do not know enough: an entry with no
// description at all, and an entry Stripe says it is still working on itself. An outstanding
// requirement we cannot read, and a check still running, are both "not verified yet".
function questionsTheBusinessIdentity(entry: RequirementEntry): boolean {
  const description = entry.description?.trim() ?? "";
  if (description.length === 0) return true;
  if (entry.awaiting_action_from === "stripe") return true;
  return BUSINESS_IDENTITY_REQUIREMENT_PREFIXES.some((prefix) => description.startsWith(prefix));
}

// Whole seconds between two RFC 3339 instants. Both come from Stripe or from our own clock,
// never from a user, and a value we cannot parse is treated as zero elapsed time, which
// keeps the account pending rather than approving it on a broken timestamp.
function secondsBetween(from: string, to: string): number {
  const fromMillis = Date.parse(from);
  const toMillis = Date.parse(to);
  if (Number.isNaN(fromMillis) || Number.isNaN(toMillis)) return 0;
  return Math.floor((toMillis - fromMillis) / 1000);
}

// ---------------------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------------------

// The shape of the v1 `account.updated` event we care about. Typed here rather than pulling
// Stripe's type in, so this file keeps no dependency on the SDK and a test can hand it a
// literal.
export type AccountUpdatedEventShape = {
  id: string;
  type: string;
  livemode: boolean;
  account?: string; // the connected account the event is about, on Connect events
  data?: { object?: { id?: string; object?: string } };
};

// Reads the connected account id out of an `account.updated` webhook event, or returns null
// when the event is about something else, so the webhook router can move on.
//
// Accounts created through the v2 API still emit the v1 `account.updated` event, which is
// what the deployed endpoint is registered for. Stripe also has thin v2 events
// (`v2.core.account[requirements].updated`) that carry the changed section rather than the
// whole object; they need a separate endpoint configuration and a fetch of the event's
// related object, and are noted in the handoff as a later improvement. Nothing in this file
// trusts the event's contents beyond the id: the account is always re-read from the API
// (readBrokerVerification), because a webhook payload is untrusted input and can arrive out
// of order.
export function parseAccountUpdatedEvent(event: AccountUpdatedEventShape): string | null {
  if (event.type !== "account.updated") return null;

  // AF-04 again, at the last boundary before a broker's state changes: a live-mode event
  // means a live endpoint is pointed at this application.
  if (event.livemode !== false) {
    throw new Error(`Stripe event ${event.id} is live-mode; this trial only ever handles test-mode data`);
  }

  const providerAccountId = event.data?.object?.id ?? event.account;
  if (!providerAccountId) {
    throw new Error(`Stripe event ${event.id} is an account.updated event with no account id`);
  }
  return providerAccountId;
}
