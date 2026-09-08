import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import type { VerifiableAccount } from "@/lib/kyb/eligibility";

// Proves, against a real database, the four properties broker verification depends on:
//
//   1. a status row is appended once per CHANGE, never once per delivery, so replaying an
//      `account.updated` event adds nothing;
//   2. a read taken inside the settling window never approves a broker;
//   3. an approval recorded inside the settling window is reported as pending, so binding
//      stays refused for at least two minutes after the broker submits;
//   4. a payment that arrives while the broker is not approved does NOT bind the policy: the
//      cash is parked in the suspense account (rule 14), and staff bind later, which applies
//      the parked cash to the policy without booking it a second time.
//
// It runs the production functions on the payloads Stripe actually returned, captured in
// lib/kyb/fixtures by the live test (lib/kyb/stripe-connect.live.test.ts). It never calls
// Stripe: what is being checked here is our own mapping, appending and eligibility, and a
// fixture replayed offline is exactly the right instrument for that. The live proof that those
// payloads are what Stripe sends is the live test and the run recorded in the handoff note.
//
// It commits rows, so it refuses to run anywhere but the disposable database corgi_test:
// financial rows can never be deleted (AF-03), and the trial ledger must stay clean.
// Run with: npm run check:kyb-replay

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on the environment
}

// Two connections, as in production: the owner creates the fixtures (a broker cannot be
// inserted by the application) and the runtime role runs the application code, so the check
// also proves that appending works with the restricted privileges the deployed app has.
const ownerUrl = process.env.DATABASE_URL_TEST;
const runtimeUrl = process.env.DATABASE_URL_TEST_APP;
if (!ownerUrl || !runtimeUrl) {
  console.error("DATABASE_URL_TEST and DATABASE_URL_TEST_APP must be set: this check only runs on the disposable database");
  process.exit(1);
}

// The recited example (DECISIONS.md): $1,200 premium, California 2.35% = 2820, $25 fee.
const ANNUAL_PREMIUM_CENTS = 120000;
const TAX_CENTS = 2820;
const FEE_CENTS = 2500;
const TOTAL_CHARGE_CENTS = 125320;
const TERM_START = "2028-03-01";

let failures = 0;
function report(name: string, passed: boolean, detail: string) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}  (${detail})`);
  if (!passed) failures += 1;
}

const owner = postgres(ownerUrl, { max: 2, prepare: false });
const runtime = postgres(runtimeUrl, { max: 2, prepare: false });

// The three payloads, exactly as Stripe returned them on 2026-09-08.
//   just-created and approved are the SAME account read at two moments: they differ only in an
//   unrelated documents sub-object, which is the whole reason the settling window exists.
//   failed is the account created with the EIN Stripe publishes as failing the tax-id match.
const fixture = (fileName: string): VerifiableAccount =>
  JSON.parse(readFileSync(join(process.cwd(), "lib", "kyb", "fixtures", fileName), "utf8"));

// One connected account belongs to one broker for ever, so the reverse lookup from an account
// id to its broker takes the first row that names it. Replaying this check on the same
// disposable database would otherwise attach the same account id to a second broker, which
// cannot happen in production and would fail the lookup. Each run therefore gives the accounts
// their own id; nothing else in the payloads is touched.
const runTag = randomUUID().slice(0, 8);
const withRunId = (account: VerifiableAccount, accountId: string): VerifiableAccount => ({ ...account, id: accountId });

const APPROVED_ACCOUNT_ID = `${fixture("account-approved.json").id}_${runTag}`;
const FAILED_ACCOUNT_ID = `${fixture("account-failed-tax-id-mismatch.json").id}_${runTag}`;

// just-created and approved are the same account, so they keep the same id here too.
const JUST_CREATED = withRunId(fixture("account-pending-just-created.json"), APPROVED_ACCOUNT_ID);
const APPROVED = withRunId(fixture("account-approved.json"), APPROVED_ACCOUNT_ID);
const FAILED = withRunId(fixture("account-failed-tax-id-mismatch.json"), FAILED_ACCOUNT_ID);

// Instants relative to the account's own creation time, so the check is deterministic.
const secondsAfterCreation = (account: VerifiableAccount, seconds: number): string =>
  new Date(Date.parse(account.created) + seconds * 1000).toISOString();

async function main() {
  // Imported here rather than at the top of the file: these modules open the application
  // connection pool as soon as they are loaded, which needs .env.local read first.
  const { applyKybAccountUpdate } = await import("@/lib/broker/kyb-onboarding");
  const { brokerIdForProviderAccount, brokerKybState, appendBrokerKybEvent } = await import("@/lib/broker/kyb");
  const { recordSuccessfulPayment, retryBindingAfterEligibility } = await import("@/lib/payments/collection");

  const [{ current_database: databaseName }] = await owner<{ current_database: string }[]>`
    select current_database()
  `;
  if (databaseName !== "corgi_test") {
    console.error(`refusing to run: connected to "${databaseName}", expected the disposable database "corgi_test"`);
    process.exit(1);
  }

  // ---------------------------------------------------------------------------------------
  // A broker whose EIN does not match: pending, then failed, then nothing more
  // ---------------------------------------------------------------------------------------

  const failingBrokerId = await createSubmittedBroker("Test Brokerage Bravo LLC", FAILED.id);

  const failedDelivery = await applyKybAccountUpdate(
    {
      brokerId: failingBrokerId,
      account: FAILED,
      checkedAt: secondsAfterCreation(FAILED, 300),
      source: "account.updated",
      actorUserId: null,
    },
    runtime,
  );
  report(
    "Stripe's tax-id mismatch is recorded as a failure with its own code",
    failedDelivery.appended && failedDelivery.status === "failed" && failedDelivery.reason === "verification_failed_tax_id_match",
    `${failedDelivery.previousStatus} -> ${failedDelivery.status} (${failedDelivery.reason})`,
  );
  report(
    "the status row carries Stripe's requirement error codes",
    failedDelivery.requirementErrorCodes.join(",") === "verification_failed_tax_id_match",
    failedDelivery.requirementErrorCodes.join(", ") || "none",
  );

  const failedReplay = await applyKybAccountUpdate(
    {
      brokerId: failingBrokerId,
      account: FAILED,
      checkedAt: secondsAfterCreation(FAILED, 600),
      source: "account.updated",
      actorUserId: null,
    },
    runtime,
  );
  report(
    "replaying the same account.updated appends nothing: the status did not change",
    !failedReplay.appended && failedReplay.status === "failed",
    `appended: ${failedReplay.appended}`,
  );
  report(
    "two deliveries left exactly two rows: the submission's pending and the failure",
    (await countKybEvents(failingBrokerId)) === 2,
    `${await countKybEvents(failingBrokerId)} row(s)`,
  );

  const failedState = await brokerKybState(failingBrokerId, runtime);
  report(
    "the broker is not eligible and the screen quotes Stripe's reason",
    failedState.status === "failed" && failedState.explanation.includes("verification_failed_tax_id_match"),
    failedState.explanation,
  );

  // ---------------------------------------------------------------------------------------
  // A broker whose EIN is fine: the settling window is the whole story
  // ---------------------------------------------------------------------------------------

  const settlingBrokerId = await createSubmittedBroker("Test Brokerage Alpha LLC", APPROVED.id);

  // Ten seconds after creation. Stripe has answered nothing yet, and the payload cannot be
  // told from an approved one: the mapping must still say pending.
  const earlyRead = await applyKybAccountUpdate(
    {
      brokerId: settlingBrokerId,
      account: JUST_CREATED,
      checkedAt: secondsAfterCreation(JUST_CREATED, 10),
      source: "account.updated",
      actorUserId: null,
    },
    runtime,
  );
  report(
    "a read taken inside the settling window does not approve the broker",
    !earlyRead.appended && earlyRead.status === "pending",
    `${earlyRead.status} (${earlyRead.reason}), appended: ${earlyRead.appended}`,
  );

  // Five minutes after creation: the identity check has had time to answer, and it asked for
  // nothing about the business identity, so the account maps to approved.
  const lateRead = await applyKybAccountUpdate(
    {
      brokerId: settlingBrokerId,
      account: APPROVED,
      checkedAt: secondsAfterCreation(APPROVED, 300),
      source: "staff_re_read",
      actorUserId: null,
    },
    runtime,
  );
  report(
    "a read taken after the settling window records the approval",
    lateRead.appended && lateRead.status === "approved",
    `${lateRead.previousStatus} -> ${lateRead.status} (${lateRead.reason})`,
  );

  const approvedReplay = await applyKybAccountUpdate(
    {
      brokerId: settlingBrokerId,
      account: APPROVED,
      checkedAt: secondsAfterCreation(APPROVED, 900),
      source: "account.updated",
      actorUserId: null,
    },
    runtime,
  );
  report(
    "replaying the approval appends nothing",
    !approvedReplay.appended,
    `appended: ${approvedReplay.appended}`,
  );
  report(
    "three deliveries left exactly two rows: the submission's pending and the approval",
    (await countKybEvents(settlingBrokerId)) === 2,
    `${await countKybEvents(settlingBrokerId)} row(s)`,
  );

  // The decided rule, seen end to end: the approval row exists, and it is NOT acted on,
  // because it was recorded less than two minutes after this broker submitted. The recorded_at
  // of both rows comes from the database clock and cannot be backdated (AF-03), so this check
  // can only ever exercise the inside-the-window side of the rule; the other side is a unit
  // test with fixed timestamps (lib/broker/eligibility.test.ts).
  const settlingState = await brokerKybState(settlingBrokerId, runtime);
  report(
    "an approval recorded inside the settling window is reported as pending",
    settlingState.status === "pending" && settlingState.recordedStatus === "approved" && settlingState.heldBySettlingWindow,
    `reported ${settlingState.status}, recorded ${settlingState.recordedStatus}, held: ${settlingState.heldBySettlingWindow}`,
  );
  report(
    "the screen says the verification takes at least two minutes",
    settlingState.explanation.includes("at least 2 minutes"),
    settlingState.explanation,
  );

  // ---------------------------------------------------------------------------------------
  // An unknown connected account belongs to nobody, and is ignored rather than guessed at
  // ---------------------------------------------------------------------------------------

  const unknownAccountBroker = await brokerIdForProviderAccount("acct_1NeverCreatedByUs", runtime);
  report(
    "an account.updated for an account we never created maps to no broker",
    unknownAccountBroker === null,
    `broker: ${unknownAccountBroker ?? "none"}`,
  );
  report(
    "a known account maps back to its broker",
    (await brokerIdForProviderAccount(APPROVED.id, runtime)) === settlingBrokerId,
    APPROVED.id,
  );

  // ---------------------------------------------------------------------------------------
  // Binding is refused at payment time, and staff can bind once the broker is eligible
  // ---------------------------------------------------------------------------------------

  const { policyId, operationId } = await createPolicyAwaitingPayment(settlingBrokerId);
  const payment = {
    operationId,
    paymentIntentId: `pi_kyb_check_${operationId.slice(0, 8)}`,
    amountReceivedCents: TOTAL_CHARGE_CENTS,
    paidOn: TERM_START,
  };

  const refused = await recordSuccessfulPayment(payment, runtime);
  report(
    "a payment for a broker held at pending does not bind the policy",
    refused.kind === "binding_refused",
    refused.kind === "binding_refused" ? refused.reason : `outcome: ${refused.kind}`,
  );
  report(
    "the cash is parked: one unapplied_cash_received entry, cash_stripe up by the charge, policy paid_not_bound",
    (await countEntriesOfPolicy(policyId)) === 1 &&
      (await entryTypesOfPolicy(policyId)).join(",") === "unapplied_cash_received" &&
      (await balanceOfPolicyAccount(policyId, "cash_stripe")) === TOTAL_CHARGE_CENTS &&
      (await balanceOfPolicyAccount(policyId, "unapplied_customer_cash")) === -TOTAL_CHARGE_CENTS &&
      (await policyStatus(policyId)) === "paid_not_bound",
    `${await countEntriesOfPolicy(policyId)} entries (${(await entryTypesOfPolicy(policyId)).join(",")}), cash_stripe ${await balanceOfPolicyAccount(policyId, "cash_stripe")}, unapplied ${await balanceOfPolicyAccount(policyId, "unapplied_customer_cash")}, status ${await policyStatus(policyId)}`,
  );
  report(
    "the money is recorded as arrived, with the refusal on the operation",
    (await bindingRefusalReason(operationId))?.includes("broker not eligible") === true,
    (await bindingRefusalReason(operationId)) ?? "no succeeded event",
  );

  const refusedTwice = await recordSuccessfulPayment(payment, runtime);
  report(
    "a second delivery of the same payment does not append a second success nor park the cash twice",
    refusedTwice.kind === "binding_refused" &&
      (await countSucceededEvents(operationId)) === 1 &&
      (await countEntriesOfPolicy(policyId)) === 1,
    `${await countSucceededEvents(operationId)} succeeded event(s), ${await countEntriesOfPolicy(policyId)} entries`,
  );

  const staffUserId = await createOperationsUser();
  const refusedRetry = await retryBindingAfterEligibility({ policyId, actorUserId: staffUserId }, runtime);
  report(
    "staff cannot bind while the broker is still not eligible",
    refusedRetry.kind === "binding_refused",
    refusedRetry.kind === "binding_refused" ? refusedRetry.reason : `outcome: ${refusedRetry.kind}`,
  );

  // The broker becomes eligible. The status is written with provider 'seed' on purpose: the
  // settling window applies to Stripe Connect statuses only, and recorded_at comes from the
  // database clock and cannot be backdated, so this is the only way to reach an approved state
  // inside a check that runs in seconds. What is being exercised below is the binding, not the
  // verification, which the sections above already cover.
  await appendBrokerKybEvent(
    {
      brokerId: settlingBrokerId,
      provider: "seed",
      status: "approved",
      providerAccountId: APPROVED.id,
      payload: { note: "check fixture: reaching the approved state without waiting for the settling window" },
      createdBy: staffUserId,
    },
    runtime,
  );

  const bound = await retryBindingAfterEligibility({ policyId, actorUserId: staffUserId }, runtime);
  report("staff bind the policy once the broker is eligible", bound.kind === "posted", `outcome: ${bound.kind}`);
  report(
    "the four issuance entries are posted once each, on top of the parking entry",
    (await countEntriesOfPolicy(policyId)) === 5 && (await policyStatus(policyId)) === "bound",
    `${await countEntriesOfPolicy(policyId)} entries, status ${await policyStatus(policyId)}`,
  );
  report(
    "binding applied the parked cash: unapplied_customer_cash back to zero, cash_stripe shows the money once",
    (await balanceOfPolicyAccount(policyId, "unapplied_customer_cash")) === 0 &&
      (await balanceOfPolicyAccount(policyId, "cash_stripe")) === TOTAL_CHARGE_CENTS &&
      (await debitAccountOfEntry(policyId, "premium_collected")) === "unapplied_customer_cash",
    `unapplied ${await balanceOfPolicyAccount(policyId, "unapplied_customer_cash")}, cash_stripe ${await balanceOfPolicyAccount(policyId, "cash_stripe")}, premium_collected debits ${await debitAccountOfEntry(policyId, "premium_collected")}`,
  );
  report(
    "the money was recorded once, whatever the number of deliveries and retries",
    (await countSucceededEvents(operationId)) === 1,
    `${await countSucceededEvents(operationId)} succeeded event(s)`,
  );

  const boundAgain = await retryBindingAfterEligibility({ policyId, actorUserId: staffUserId }, runtime);
  report(
    "binding again posts nothing a second time",
    boundAgain.kind === "already_posted" && (await countEntriesOfPolicy(policyId)) === 5,
    `outcome: ${boundAgain.kind}, ${await countEntriesOfPolicy(policyId)} entries`,
  );

  await owner.end();
  await runtime.end();
  process.exit(failures === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------------------
// Fixtures: the rows the application writes, written the same way
// ---------------------------------------------------------------------------------------

// A broker who has just submitted their company: the immutable submission, then the pending
// status the submission appended with the connected account id on it. Exactly what
// lib/broker/kyb-onboarding.ts leaves behind, minus the call to Stripe.
async function createSubmittedBroker(legalName: string, providerAccountId: string): Promise<string> {
  return owner.begin(async (transaction) => {
    const [broker] = await transaction<{ id: string }[]>`
      insert into brokers (name, commission_rate_bps) values (${legalName}, 1500) returning id
    `;
    await transaction`
      insert into broker_kyb_submissions (
        broker_id, provider, provider_idempotency_key, legal_name, ein_last4,
        address_line1, address_city, address_state, address_postal_code,
        business_url, contact_email, terms_accepted_at, terms_accepted_ip
      ) values (
        ${broker.id}, 'stripe_connect', 'broker-kyb:' || ${broker.id}, ${legalName}, '0000',
        'address_full_match', 'San Francisco', 'CA', '94105',
        'https://example.invalid/kyb-check', 'kyb-check@example.invalid',
        now(), '203.0.113.10'
      )
    `;
    await transaction`
      insert into broker_kyb_events (broker_id, provider, status, provider_ref, payload)
      values (${broker.id}, 'stripe_connect', 'pending', ${providerAccountId},
              ${transaction.json({ source: "create_account", reason: "awaiting the first verification result" })})
    `;
    return broker.id;
  });
}

// A quoted policy with a payment awaiting the provider's answer, for the given broker.
async function createPolicyAwaitingPayment(brokerId: string): Promise<{ policyId: string; operationId: string }> {
  return owner.begin(async (transaction) => {
    const [customer] = await transaction<{ id: string }[]>`
      insert into customers (name, email)
      values ('KYB check customer', 'kyb-check-' || gen_random_uuid()::text || '@example.invalid')
      returning id
    `;
    const [policy] = await transaction<{ id: string }[]>`
      insert into policies (broker_id, customer_id, state_code) values (${brokerId}, ${customer.id}, 'CA') returning id
    `;
    await transaction`
      insert into policy_events (policy_id, event_type, effective_at, payload)
      values (${policy.id}, 'quoted', ${TERM_START}, ${transaction.json({
        state_code: "CA",
        term_start: TERM_START,
        term_end: "2029-03-01",
        annual_premium_cents: ANNUAL_PREMIUM_CENTS,
        tax_rate_bps: 235,
        tax_cents: TAX_CENTS,
        fee_cents: FEE_CENTS,
        total_charge_cents: TOTAL_CHARGE_CENTS,
        per_occurrence_limit_cents: 100000000,
        aggregate_limit_cents: 200000000,
      })})
    `;
    const [operation] = await transaction<{ id: string }[]>`
      insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key)
      values ('stripe_checkout', 'stripe', ${TOTAL_CHARGE_CENTS}, ${policy.id}, 'policy-checkout:' || ${policy.id})
      returning id
    `;
    await transaction`
      insert into money_operation_events (operation_id, status) values (${operation.id}, 'requested')
    `;
    return { policyId: policy.id, operationId: operation.id };
  });
}

async function createOperationsUser(): Promise<string> {
  const [user] = await owner<{ id: string }[]>`
    insert into users (email, display_name, role)
    values ('kyb-check-' || gen_random_uuid()::text || '@example.invalid', 'KYB check operator', 'staff_ops')
    returning id
  `;
  return user.id;
}

// ---------------------------------------------------------------------------------------
// Reads, as the owner, so the assertions look at the database and not at a return value
// ---------------------------------------------------------------------------------------

async function countKybEvents(brokerId: string): Promise<number> {
  const [row] = await owner<{ count: string }[]>`
    select count(*)::text as count from broker_kyb_events where broker_id = ${brokerId}
  `;
  return Number(row.count);
}

async function countEntriesOfPolicy(policyId: string): Promise<number> {
  const [row] = await owner<{ count: string }[]>`
    select count(*)::text as count from journal_entries where policy_id = ${policyId}
  `;
  return Number(row.count);
}

async function entryTypesOfPolicy(policyId: string): Promise<string[]> {
  const rows = await owner<{ entry_type: string }[]>`
    select entry_type from journal_entries where policy_id = ${policyId} order by recorded_at, entry_type
  `;
  return rows.map((row) => row.entry_type);
}

// Debits minus credits of one account over the entries of one policy.
async function balanceOfPolicyAccount(policyId: string, accountId: string): Promise<number> {
  const [row] = await owner<{ balance: string }[]>`
    select (coalesce(sum(line.debit_cents), 0) - coalesce(sum(line.credit_cents), 0))::text as balance
      from journal_lines line
      join journal_entries entry on entry.id = line.entry_id
     where entry.policy_id = ${policyId} and line.account_id = ${accountId}
  `;
  return Number(row.balance);
}

// The account debited on one entry of the policy (the entry has exactly one debit line).
async function debitAccountOfEntry(policyId: string, entryType: string): Promise<string | null> {
  const [row] = await owner<{ account_id: string }[]>`
    select line.account_id
      from journal_lines line
      join journal_entries entry on entry.id = line.entry_id
     where entry.policy_id = ${policyId} and entry.entry_type = ${entryType} and line.debit_cents > 0
     limit 1
  `;
  return row ? row.account_id : null;
}

async function countSucceededEvents(operationId: string): Promise<number> {
  const [row] = await owner<{ count: string }[]>`
    select count(*)::text as count from money_operation_events
     where operation_id = ${operationId} and status = 'succeeded'
  `;
  return Number(row.count);
}

async function bindingRefusalReason(operationId: string): Promise<string | null> {
  const [row] = await owner<{ reason: string | null }[]>`
    select payload ->> 'binding_refused_reason' as reason from money_operation_events
     where operation_id = ${operationId} and status = 'succeeded'
     order by sequence_number desc limit 1
  `;
  return row ? row.reason : null;
}

async function policyStatus(policyId: string): Promise<string> {
  const [row] = await owner<{ status: string }[]>`select status from policy_current where policy_id = ${policyId}`;
  return row ? row.status : "no cache row";
}

main().catch(async (error) => {
  console.error("check failed to run:", error instanceof Error ? error.message : error);
  await owner.end();
  await runtime.end();
  process.exit(1);
});
