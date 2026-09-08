import type postgres from "postgres";
import Stripe from "stripe";
import { sql } from "@/db/client";
import { bindingIsAllowed } from "@/lib/broker/eligibility";
import { brokerKybState } from "@/lib/broker/kyb";
import { checkoutIdempotencyKey } from "@/lib/money/idempotency";
import { CHECKOUT_EXPIRED_REASON } from "./collection";
import { foldPolicyEvents, refreshPolicyCurrent } from "@/lib/policy/current";
import { policyWasVoided } from "@/lib/policy/status";
import { assertStripeSandbox, stripe } from "@/lib/stripe";

// Starting the payment of a policy draft: the outbox rule of ARCHITECTURE.md section 4.
//
//   1. the intent is written and committed BEFORE Stripe is called, with an idempotency key
//      derived from the policy id;
//   2. Stripe is called with that same key, so a retry after a timeout returns the session
//      that was already created instead of creating a second one;
//   3. what Stripe answered is appended to the operation's history.
//
// If the process dies between 1 and 3, the operation stays in status 'requested' and the next
// attempt calls Stripe again with the same key: the money can never be requested twice under
// two different keys. A hosted page that can no longer be paid (an expired session, or a
// creation that never returned one) is the one case where the next attempt is a NEW operation
// with a NEW key, because reusing the key would make Stripe hand the dead session back.
//
// The database handle is a parameter whose default is the application pool. Production always
// uses the default; scripts/check-payment-replay.ts passes the disposable test database so the
// checks run this exact code.

export class CheckoutRefused extends Error {}

export type StartCheckoutRequest = {
  policyId: string;
  brokerId: string; // the broker of the signed-in user, already checked as the policy's owner
  userId: string;
};

export async function startCheckout(
  request: StartCheckoutRequest,
  database: postgres.Sql = sql,
): Promise<string> {
  const policy = await loadPolicyForPayment(database, request.policyId);
  if (!policy) {
    throw new CheckoutRefused("this policy does not exist");
  }
  if (policy.brokerId !== request.brokerId) {
    throw new CheckoutRefused("this policy belongs to another broker");
  }

  const { eventTypes, terms } = await foldPolicyEvents(database, request.policyId);
  if (eventTypes.includes("issued")) {
    throw new CheckoutRefused("this policy is already bound and paid");
  }
  // A correction reversed this policy's issuance. The superseded 'issued' row is still in the
  // table, so a payment made on a new attempt would post its four entries and then be rolled
  // back by the one-issuance index, leaving real money at Stripe with nothing journaled
  // (review finding F-B2-13). The refusal happens here, before a hosted page can be opened.
  if (policyWasVoided(eventTypes)) {
    throw new CheckoutRefused("this policy was voided by a correction; create a new draft");
  }

  // Server-side eligibility, rechecked at execution time and not merely when the page was
  // rendered: an unapproved or unknown broker cannot bind.
  const kyb = await brokerKybState(policy.brokerId, database);
  if (!bindingIsAllowed(kyb.status)) {
    throw new CheckoutRefused(
      `binding is refused: the broker's KYB status is "${kyb.status}" and must be "approved"`,
    );
  }

  // Which attempt to pay this policy we are on, and whether the last one can still be used.
  const latest = await latestCheckoutOperation(database, request.policyId);
  if (latest && !latest.isDead && latest.checkoutUrl) {
    // The same intent was already accepted by Stripe: send the broker back to the same hosted
    // page instead of opening a second one.
    return latest.checkoutUrl;
  }

  const attempt =
    latest && !latest.isDead
      ? // The intent is on disk but Stripe's answer never was: this is the recovery path, and
        // it calls Stripe again with the SAME key, so no second session can be created.
        { operationId: latest.operationId, idempotencyKey: latest.idempotencyKey }
      : // Either nothing was ever attempted, or the last attempt is dead: an expired hosted page
        // or a creation that never produced one. A dead attempt cannot be revived, and reusing
        // its key would make Stripe hand the dead session back, so this is a new operation with
        // a new key (review finding F-B2-03).
        await createCheckoutOperation({
          policyId: request.policyId,
          amountCents: terms.totalChargeCents,
          userId: request.userId,
          attempt: (latest?.attemptsSoFar ?? 0) + 1,
          database,
        });

  await assertStripeSandbox();

  let session;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        // Three line items so the payer sees the same split as our ledger.
        line_items: [
          lineItem(`Policy ${policy.policyNumber}: annual premium`, terms.annualPremiumCents),
          lineItem(`${terms.stateCode} premium tax (${(terms.taxRateBps / 100).toFixed(2)}%)`, terms.taxCents),
          lineItem("Policy fee", terms.feeCents),
        ],
        // Three ways back to the operation: the reference, the session metadata and the
        // payment intent metadata. The webhook reads the payment intent one.
        client_reference_id: attempt.operationId,
        metadata: { operation_id: attempt.operationId, policy_id: request.policyId },
        payment_intent_data: { metadata: { operation_id: attempt.operationId, policy_id: request.policyId } },
        success_url: `${appBaseUrl()}/policies/${request.policyId}?payment=returned`,
        cancel_url: `${appBaseUrl()}/policies/${request.policyId}?payment=cancelled`,
      },
      // The key stored on the operation, never a freshly derived one: one operation, one key.
      { idempotencyKey: attempt.idempotencyKey },
    );
  } catch (error) {
    await recordProviderFailure(database, attempt.operationId, request.policyId, error);
    throw new CheckoutRefused(
      "Stripe did not accept the payment request; the failure was recorded and the same request can be retried",
    );
  }

  if (!session.url) {
    await recordProviderFailure(
      database,
      attempt.operationId,
      request.policyId,
      new Error("Stripe returned a session without a URL"),
    );
    throw new CheckoutRefused("Stripe returned a session without a payment page; the failure was recorded");
  }

  // The payment intent is expanded to an object by some API versions; only its id is kept.
  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);

  await database.begin(async (transaction) => {
    await transaction`
      insert into money_operation_events (operation_id, status, provider_ref, payload)
      values (${attempt.operationId}, 'provider_accepted', ${session.id},
              ${transaction.json({ checkout_url: session.url, payment_intent_id: paymentIntentId })})
    `;
    await refreshPolicyCurrent(transaction, request.policyId);
  });

  return session.url;
}

function lineItem(name: string, amountCents: number) {
  return {
    quantity: 1,
    price_data: { currency: "usd", unit_amount: amountCents, product_data: { name } },
  };
}

function appBaseUrl(): string {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) {
    throw new Error("APP_BASE_URL must be set to build the Stripe return URLs");
  }
  return baseUrl.replace(/\/$/, "");
}

async function loadPolicyForPayment(
  database: postgres.Sql,
  policyId: string,
): Promise<{ policyId: string; policyNumber: string; brokerId: string } | null> {
  const [row] = await database<{ id: string; policy_number: string; broker_id: string }[]>`
    select id, policy_number, broker_id from policies where id = ${policyId}
  `;
  return row ? { policyId: row.id, policyNumber: row.policy_number, brokerId: row.broker_id } : null;
}

// The most recent attempt to pay this policy, and whether it can still be used.
type CheckoutAttempt = {
  operationId: string;
  idempotencyKey: string;
  checkoutUrl: string | null; // the hosted page, once Stripe has accepted the session
  isDead: boolean; // true when this attempt can never be paid again
  attemptsSoFar: number; // how many payment attempts this policy has had
};

async function latestCheckoutOperation(
  database: postgres.Sql,
  policyId: string,
): Promise<CheckoutAttempt | null> {
  const operations = await database<{ id: string; idempotency_key: string }[]>`
    select id, idempotency_key from money_operations
     where policy_id = ${policyId} and kind = 'stripe_checkout'
     order by created_at desc
  `;
  if (operations.length === 0) {
    return null;
  }
  const latest = operations[0];

  const events = await database<{ status: string; payload: { checkout_url?: string; reason?: string } }[]>`
    select status, payload from money_operation_events
     where operation_id = ${latest.id}
     order by sequence_number
  `;
  const checkoutUrl = events.find((event) => event.payload?.checkout_url)?.payload.checkout_url ?? null;
  const expired = events.some((event) => event.status === "failed" && event.payload?.reason === CHECKOUT_EXPIRED_REASON);
  const failedWithoutSession = events.some((event) => event.status === "failed") && checkoutUrl === null;

  return {
    operationId: latest.id,
    idempotencyKey: latest.idempotency_key,
    checkoutUrl,
    // Dead means "this hosted page can never be paid": Stripe expired it, or it never existed.
    // A card declined inside a live session is NOT dead: that session is still open and the
    // customer can try another card on it, so opening a second one could take two payments.
    isDead: expired || failedWithoutSession,
    attemptsSoFar: operations.length,
  };
}

// The intent, committed before any provider call.
async function createCheckoutOperation(input: {
  policyId: string;
  amountCents: number;
  userId: string;
  attempt: number;
  database: postgres.Sql;
}): Promise<{ operationId: string; idempotencyKey: string }> {
  const idempotencyKey = checkoutIdempotencyKey(input.policyId, input.attempt);
  return input.database.begin(async (transaction) => {
    const [operation] = await transaction<{ id: string }[]>`
      insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key, created_by)
      values ('stripe_checkout', 'stripe', ${input.amountCents}, ${input.policyId},
              ${idempotencyKey}, ${input.userId})
      returning id
    `;
    await transaction`
      insert into money_operation_events (operation_id, status, payload)
      values (${operation.id}, 'requested',
              ${transaction.json({ note: "checkout session not created yet", attempt: input.attempt })})
    `;
    await refreshPolicyCurrent(transaction, input.policyId);
    return { operationId: operation.id, idempotencyKey };
  });
}

// A provider error is a fact about the operation, so it is appended, never swallowed.
// Only the message is stored, never the request or the credentials.
async function recordProviderFailure(
  database: postgres.Sql,
  operationId: string,
  policyId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message.slice(0, 500) : "unknown provider error";
  await database.begin(async (transaction) => {
    await transaction`
      insert into money_operation_events (operation_id, status, payload)
      values (${operationId}, 'failed', ${transaction.json({ stage: "create_checkout_session", message })})
    `;
    await refreshPolicyCurrent(transaction, policyId);
  });
}

// Closes the open payment pages of a broker who has just lost eligibility (technical addition
// to rule 14, DECISIONS.md). A hosted Checkout Session lives 24 hours; a customer could pay one
// that was legitimately opened while the broker was approved, and that money would then have
// to be parked in the suspense account. Expiring the pages shrinks that window to seconds.
// The bookkeeping is not done here: Stripe answers with checkout.session.expired, and the
// webhook records the attempt as dead exactly as for any other expiry.
//
// Returns how many pages were asked to expire. A page that is no longer open (paid, or already
// expired) makes Stripe refuse the call; that refusal is expected and skipped.
export async function expireOpenCheckoutSessionsOfBroker(
  brokerId: string,
  database: postgres.Sql = sql,
): Promise<number> {
  const openSessions = await database<{ operation_id: string; session_id: string }[]>`
    select operation.id as operation_id, latest.provider_ref as session_id
      from money_operations operation
      join policies policy on policy.id = operation.policy_id
      join lateral (
        select status, provider_ref from money_operation_events
         where operation_id = operation.id
         order by sequence_number desc
         limit 1
      ) latest on true
     where policy.broker_id = ${brokerId}
       and operation.kind = 'stripe_checkout'
       and latest.status = 'provider_accepted'
       and latest.provider_ref like 'cs_%'
  `;
  let expired = 0;
  for (const open of openSessions) {
    try {
      await stripe.checkout.sessions.expire(open.session_id);
      expired += 1;
    } catch (error) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError) {
        continue; // not open any more: paid or already expired, nothing to close
      }
      throw error;
    }
  }
  return expired;
}
