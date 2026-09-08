import { sql } from "@/db/client";
import { bindingIsAllowed } from "@/lib/broker/eligibility";
import { brokerKybState } from "@/lib/broker/kyb";
import { checkoutIdempotencyKey } from "@/lib/money/idempotency";
import { foldPolicyEvents, refreshPolicyCurrent } from "@/lib/policy/current";
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
// two different keys.

export class CheckoutRefused extends Error {}

export type StartCheckoutRequest = {
  policyId: string;
  brokerId: string; // the broker of the signed-in user, already checked as the policy's owner
  userId: string;
};

export async function startCheckout(request: StartCheckoutRequest): Promise<string> {
  const policy = await loadPolicyForPayment(request.policyId);
  if (!policy) {
    throw new CheckoutRefused("this policy does not exist");
  }
  if (policy.brokerId !== request.brokerId) {
    throw new CheckoutRefused("this policy belongs to another broker");
  }

  const { eventTypes, terms } = await foldPolicyEvents(sql, request.policyId);
  if (eventTypes.includes("issued")) {
    throw new CheckoutRefused("this policy is already bound and paid");
  }

  // Server-side eligibility, rechecked at execution time and not merely when the page was
  // rendered: an unapproved or unknown broker cannot bind.
  const kyb = await brokerKybState(policy.brokerId);
  if (!bindingIsAllowed(kyb.status)) {
    throw new CheckoutRefused(
      `binding is refused: the broker's KYB status is "${kyb.status}" and must be "approved"`,
    );
  }

  const existing = await existingCheckoutOperation(request.policyId);
  if (existing?.checkoutUrl) {
    // The same intent was already accepted by Stripe: send the broker back to the same hosted
    // page instead of opening a second one.
    return existing.checkoutUrl;
  }

  const operationId = existing
    ? existing.operationId
    : await createCheckoutOperation({
        policyId: request.policyId,
        amountCents: terms.totalChargeCents,
        userId: request.userId,
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
        client_reference_id: operationId,
        metadata: { operation_id: operationId, policy_id: request.policyId },
        payment_intent_data: { metadata: { operation_id: operationId, policy_id: request.policyId } },
        success_url: `${appBaseUrl()}/policies/${request.policyId}?payment=returned`,
        cancel_url: `${appBaseUrl()}/policies/${request.policyId}?payment=cancelled`,
      },
      { idempotencyKey: checkoutIdempotencyKey(request.policyId) },
    );
  } catch (error) {
    await recordProviderFailure(operationId, request.policyId, error);
    throw new CheckoutRefused(
      "Stripe did not accept the payment request; the failure was recorded and the same request can be retried",
    );
  }

  if (!session.url) {
    await recordProviderFailure(operationId, request.policyId, new Error("Stripe returned a session without a URL"));
    throw new CheckoutRefused("Stripe returned a session without a payment page; the failure was recorded");
  }

  // The payment intent is expanded to an object by some API versions; only its id is kept.
  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);

  await sql.begin(async (transaction) => {
    await transaction`
      insert into money_operation_events (operation_id, status, provider_ref, payload)
      values (${operationId}, 'provider_accepted', ${session.id},
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
  policyId: string,
): Promise<{ policyId: string; policyNumber: string; brokerId: string } | null> {
  const [row] = await sql<{ id: string; policy_number: string; broker_id: string }[]>`
    select id, policy_number, broker_id from policies where id = ${policyId}
  `;
  return row ? { policyId: row.id, policyNumber: row.policy_number, brokerId: row.broker_id } : null;
}

async function existingCheckoutOperation(
  policyId: string,
): Promise<{ operationId: string; checkoutUrl: string | null } | null> {
  const [operation] = await sql<{ id: string }[]>`
    select id from money_operations
     where policy_id = ${policyId} and kind = 'stripe_checkout'
     limit 1
  `;
  if (!operation) {
    return null;
  }
  const [accepted] = await sql<{ payload: { checkout_url?: string } }[]>`
    select payload from money_operation_events
     where operation_id = ${operation.id} and status = 'provider_accepted'
     order by sequence_number
     limit 1
  `;
  return { operationId: operation.id, checkoutUrl: accepted?.payload?.checkout_url ?? null };
}

// The intent, committed before any provider call.
async function createCheckoutOperation(input: {
  policyId: string;
  amountCents: number;
  userId: string;
}): Promise<string> {
  return sql.begin(async (transaction) => {
    const [operation] = await transaction<{ id: string }[]>`
      insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key, created_by)
      values ('stripe_checkout', 'stripe', ${input.amountCents}, ${input.policyId},
              ${checkoutIdempotencyKey(input.policyId)}, ${input.userId})
      returning id
    `;
    await transaction`
      insert into money_operation_events (operation_id, status, payload)
      values (${operation.id}, 'requested', ${transaction.json({ note: "checkout session not created yet" })})
    `;
    await refreshPolicyCurrent(transaction, input.policyId);
    return operation.id;
  });
}

// A provider error is a fact about the operation, so it is appended, never swallowed.
// Only the message is stored, never the request or the credentials.
async function recordProviderFailure(operationId: string, policyId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message.slice(0, 500) : "unknown provider error";
  await sql.begin(async (transaction) => {
    await transaction`
      insert into money_operation_events (operation_id, status, payload)
      values (${operationId}, 'failed', ${transaction.json({ stage: "create_checkout_session", message })})
    `;
    await refreshPolicyCurrent(transaction, policyId);
  });
}
