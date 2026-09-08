import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { mapAccountToEligibility, type BrokerEligibility, type VerifiableAccount } from "./eligibility";

// Broker KYB on Stripe Connect Accounts v2 (slice B3).
//
// A broker cannot bind a policy until somebody has checked that the company exists and is
// who it says it is. We do not run that check ourselves: the broker is created as a Stripe
// connected account of entity type `company`, with its registered name, its EIN and its
// registered address, and Stripe's own business verification runs on it. What comes back is
// a list of requirement entries, which `mapAccountToEligibility` (eligibility.ts) turns into
// the four states this application understands.
//
// Test mode only (AF-04). lib/stripe.ts refuses to build a client from anything but an
// `sk_test_` key, and every account read here is refused unless `livemode` is false, so a
// live account can never reach the database.
//
// Disclosed in README and at the debrief, decided by Yoann on 2026-09-08 (docs/DECISIONS.md):
// Stripe is a payments provider performing entity verification on its connected accounts,
// not a dedicated KYB vendor. Sumsub, Middesk and Persona all gate business verification
// behind a real legal entity Yoann does not have. The verification is real sandbox activity
// with Stripe's published test fixtures; it is not a claim that we integrated a KYB bureau.

// The registered address of the business, as Stripe wants it for a US company.
export type UsBusinessAddress = {
  line1: string;
  city: string;
  state: string; // two-letter USPS code, e.g. "CA"
  postalCode: string;
};

export type BrokerVerificationRequest = {
  // Our own broker id. Stored in the account's metadata so a Stripe event can be traced back
  // to the broker without a second lookup table.
  brokerId: string;
  // Legal name as registered. Used both as the account's display name and as the
  // `registered_name` Stripe verifies.
  legalName: string;
  // Employer Identification Number, nine digits, no dash. Stripe publishes test values:
  // 000000000 verifies, 111111111 fails with a tax-id mismatch, 222221005 stays pending.
  employerIdentificationNumber: string;
  address: UsBusinessAddress;
  contactEmail: string;
  // The broker's public website. Stripe asks for it (`defaults.profile.business_url`) before
  // it enables the account, so an account created without it stays pending for ever.
  businessUrl: string;
  // When and from where the broker accepted the Stripe services agreement in our own UI.
  // An account with no Stripe dashboard (`dashboard: "none"`) cannot accept it on Stripe's
  // side, so the platform passes on the acceptance it collected. Never invented: the caller
  // records the real instant and IP address of the broker's click.
  termsOfServiceAcceptedAt: string; // ISO-8601 UTC
  termsOfServiceAcceptedFromIp: string;
  // Extra metadata to store on the account. The fixture-capture test uses it to tag its
  // probe accounts with `corgi_probe`; the application does not set it.
  additionalMetadata?: Record<string, string>;
};

// The fields we ask Stripe to expand on the account. Without `requirements` the response
// carries no verification result at all, and the eligibility mapping would have to answer
// "unknown" for every account.
const INCLUDED_ACCOUNT_FIELDS = ["requirements", "identity", "configuration.recipient"] as const;

// Sends the broker to Stripe for verification and returns the account it created.
// The caller stores `providerAccountId` on the broker and appends the raw response to
// `broker_kyb_events`; nothing here writes to the database.
export async function startBrokerVerification(
  request: BrokerVerificationRequest,
): Promise<{ providerAccountId: string; rawResponse: Stripe.V2.Core.Account }> {
  const account = await stripe.v2.core.accounts.create({
    display_name: request.legalName,
    contact_email: request.contactEmail,
    // No Stripe-hosted dashboard for the broker: this account exists to be verified and to
    // receive commission, not to be logged into.
    dashboard: "none",
    identity: {
      country: "us",
      entity_type: "company",
      attestations: {
        terms_of_service: {
          account: { date: request.termsOfServiceAcceptedAt, ip: request.termsOfServiceAcceptedFromIp },
        },
      },
      business_details: {
        registered_name: request.legalName,
        id_numbers: [{ type: "us_ein", value: request.employerIdentificationNumber }],
        address: {
          country: "us",
          line1: request.address.line1,
          city: request.address.city,
          state: request.address.state,
          postal_code: request.address.postalCode,
        },
      },
      // No `structure` field: Stripe rejects `private_company` for a US company, and the
      // entity type above is what drives the verification.
    },
    configuration: {
      // The recipient configuration is what makes Stripe verify the entity: it is the
      // configuration that lets the account receive money from the platform.
      recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
    },
    defaults: {
      // The platform (us) pays the fees and carries the losses. Stated explicitly because it
      // decides which requirements Stripe asks the account for.
      responsibilities: { fees_collector: "application", losses_collector: "application" },
      profile: { business_url: request.businessUrl },
    },
    metadata: { broker_id: request.brokerId, ...request.additionalMetadata },
    include: [...INCLUDED_ACCOUNT_FIELDS],
  });

  refuseLiveModeAccount(account);
  return { providerAccountId: account.id, rawResponse: account };
}

// Re-reads an account from Stripe, with its requirements and identity.
// This is the authoritative read: a webhook tells us something changed, this says what.
export async function readBrokerVerification(providerAccountId: string): Promise<Stripe.V2.Core.Account> {
  const account = await stripe.v2.core.accounts.retrieve(providerAccountId, {
    include: [...INCLUDED_ACCOUNT_FIELDS],
  });
  refuseLiveModeAccount(account);
  return account;
}

// Convenience for the callers that only want the four-state answer.
export async function readBrokerEligibility(
  providerAccountId: string,
  checkedAt: string,
): Promise<BrokerEligibility> {
  const account = await readBrokerVerification(providerAccountId);
  return mapAccountToEligibility(account satisfies VerifiableAccount, checkedAt);
}

// AF-04, at the provider boundary: a live account is refused before its id can be written
// anywhere. lib/stripe.ts already refuses a live key, so reaching this error means the
// account itself came back marked live, which is a configuration problem, not a broker
// problem.
function refuseLiveModeAccount(account: Stripe.V2.Core.Account): void {
  if (account.livemode !== false) {
    throw new Error(
      `Stripe account ${account.id} is a live-mode account; this trial only ever handles test-mode data`,
    );
  }
}
