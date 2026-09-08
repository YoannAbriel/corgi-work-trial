import type postgres from "postgres";
import { sql } from "@/db/client";
import { correctionCollectionEntries } from "@/lib/ledger/correction-entries";
import { isUniqueViolation, postJournalEntry } from "@/lib/ledger/post";
import { centsFromDatabase } from "@/lib/money/cents";
import { commissionCents } from "@/lib/money/premium";
import { customerApprovalNeeded } from "@/lib/approvals/threshold";
import { CUSTOMER_APPROVAL_THRESHOLD_CENTS } from "@/lib/money/endorsement";
import { moneyStillWaitingForTheCustomer } from "@/lib/policy/correct-endorsement-date";
import { correctionCheckoutIdempotencyKey } from "@/lib/money/idempotency";
import { foldPolicyEvents } from "@/lib/policy/current";
import { policyWasVoided } from "@/lib/policy/status";
import { assertStripeSandbox, stripe } from "@/lib/stripe";
import { CHECKOUT_EXPIRED_REASON, type SuccessfulPayment } from "./collection";
import type { UserRole } from "@/lib/auth/current-user";

// Collecting the difference a backdated correction created, when the corrected date charges more
// days of cover than the date that was entered by mistake (slice B8).
//
// The shape is the one this application uses for every payment (lib/payments/checkout.ts,
// lib/payments/endorsement-collection.ts), with the same three safety rules:
//
//   1. the outbox: the money operation and its correction_collections row were committed by the
//      correction itself, BEFORE Stripe is ever called, with an idempotency key derived from the
//      re-book event and the attempt number;
//   2. entries are posted only on payment_intent.succeeded, in ONE transaction with the
//      operation's 'succeeded' status; the journal's unique key on (money operation, entry type)
//      makes a second delivery a no-op;
//   3. an expired hosted page marks the attempt dead and the next Pay click opens a new operation
//      under a new key.
//
// TWO THINGS ARE DELIBERATELY DIFFERENT FROM AN ENDORSEMENT DELTA.
//
//   * The correction is already in force when this money is collected. An endorsement waits for
//     its delta because the change only takes effect when it is paid; a correction is not a
//     change of cover, it is the record being put right, and the books have to tell the truth
//     immediately. So the re-book is posted first and the difference is collected afterwards,
//     with premium_receivable holding it in between, visible on the reconciliation screen.
//   * No broker eligibility gate. Collecting this money binds nothing and applies nothing: it
//     settles a receivable the ledger already carries. Refusing it would leave the customer owing
//     money we will not take, which helps nobody. (Rule 14 exists for money that arrives when a
//     policy CANNOT be bound; there is nothing here that could be refused.)

export class CorrectionCheckoutRefused extends Error {}

export type CorrectionCollectionOutcome =
  | { kind: "posted" }
  | { kind: "already_posted" }
  | { kind: "refused"; reason: string };

// ---------------------------------------------------------------------------
// The difference to collect, as the screens and the routes read it
// ---------------------------------------------------------------------------

export type CorrectionCollection = {
  operationId: string;
  policyId: string;
  policyNumber: string;
  brokerId: string;
  rebookEventId: string;
  amountCents: number;
  premiumCents: number;
  taxCents: number;
  commissionRateBps: number;
};

// Does this money operation collect the difference of a correction? The webhook route asks this
// so a payment goes to this file and never to the issuance or the endorsement path.
export async function correctionCollectionOfOperation(
  operationId: string,
  database: postgres.Sql = sql,
): Promise<{ rebookEventId: string; policyId: string } | null> {
  const [row] = await database<{ correction_rebook_event_id: string; policy_id: string }[]>`
    select correction_rebook_event_id, policy_id from correction_collections where collection_operation_id = ${operationId}
  `;
  return row ? { rebookEventId: row.correction_rebook_event_id, policyId: row.policy_id } : null;
}

async function loadCorrectionCollection(
  database: postgres.Sql,
  operationId: string,
): Promise<CorrectionCollection | null> {
  const [row] = await database<
    {
      operation_id: string;
      policy_id: string;
      policy_number: string;
      broker_id: string;
      commission_rate_bps: number;
      correction_rebook_event_id: string;
      amount_cents: string;
      premium_cents: string;
      tax_cents: string;
    }[]
  >`
    select operation.id         as operation_id,
           policy.id            as policy_id,
           policy.policy_number as policy_number,
           broker.id            as broker_id,
           broker.commission_rate_bps,
           link.correction_rebook_event_id,
           link.amount_cents,
           link.premium_cents,
           link.tax_cents
      from correction_collections link
      join money_operations operation on operation.id = link.collection_operation_id
      join policies policy on policy.id = link.policy_id
      join brokers broker  on broker.id = policy.broker_id
     where link.collection_operation_id = ${operationId}
  `;
  if (!row) {
    return null;
  }
  return {
    operationId: row.operation_id,
    policyId: row.policy_id,
    policyNumber: row.policy_number,
    brokerId: row.broker_id,
    rebookEventId: row.correction_rebook_event_id,
    amountCents: centsFromDatabase(row.amount_cents, "amount_cents"),
    premiumCents: centsFromDatabase(row.premium_cents, "premium_cents"),
    taxCents: centsFromDatabase(row.tax_cents, "tax_cents"),
    commissionRateBps: row.commission_rate_bps,
  };
}

// ---------------------------------------------------------------------------
// The customer's approval, above $500
// ---------------------------------------------------------------------------

export type CorrectionApprovalActor = {
  userId: string;
  // Every role the application knows, including 'agent' (slice B11); the checks are allowlists.
  role: UserRole;
  customerId: string | null;
};

// The customer accepts to pay a difference above $500, exactly as they accept an endorsement that
// collects more than $500 (lib/policy/endorse.ts). Recorded as its own policy event so that the
// acceptance is part of the policy's history and not a flag somewhere.
export async function approveCorrectionCollection(
  input: { policyId: string; rebookEventId: string; actor: CorrectionApprovalActor },
  database: postgres.Sql = sql,
): Promise<{ approvedEventId: string; alreadyApproved: boolean }> {
  const [policy] = await database<{ customer_id: string }[]>`
    select customer_id from policies where id = ${input.policyId}
  `;
  if (!policy) {
    throw new CorrectionCheckoutRefused("this policy does not exist");
  }
  // The customer of the policy, and nobody else: not the broker, not staff, not an agent. The
  // customer id comes from the session, never from the form.
  if (input.actor.role !== "customer" || input.actor.customerId !== policy.customer_id) {
    throw new CorrectionCheckoutRefused("only the customer of this policy can approve paying the difference");
  }

  const outstanding = await outstandingCorrectionCollection(database, input.policyId, input.rebookEventId);
  if (!outstanding) {
    throw new CorrectionCheckoutRefused("this correction has no difference waiting to be collected");
  }
  if (!(await differenceNeedsTheCustomer(database, input.policyId, input.rebookEventId, outstanding.amountCents))) {
    throw new CorrectionCheckoutRefused(
      "this difference is at or below the $500 threshold, counting anything else waiting for you on this policy, so it needs no approval",
    );
  }

  const existing = await correctionApprovalEventId(database, input.rebookEventId);
  if (existing) {
    return { approvedEventId: existing, alreadyApproved: true };
  }

  const [approval] = await database<{ id: string }[]>`
    insert into policy_events (policy_id, event_type, effective_at, payload, created_by)
    values (${input.policyId}, 'correction_approved',
            ${outstanding.correctedEffectiveAt},
            ${database.json({
              correction_rebook_event_id: input.rebookEventId,
              amount_cents: outstanding.amountCents,
              approved_by: input.actor.userId,
            })},
            ${input.actor.userId})
    returning id
  `;
  return { approvedEventId: approval.id, alreadyApproved: false };
}

// Does this difference need the customer's yes, asked at the GATE, right now?
//
// It is the cumulative rule (review findings F-B4-09 and F-B8-02): the amount of this difference
// plus anything else on the policy still waiting for this customer, against the $500 line. The
// correction wrote its own verdict down when it happened, and the screens read that; this asks
// the question again at the moment money would actually be collected, because more may have
// piled up since. It can only ever ask for MORE approval, never less.
async function differenceNeedsTheCustomer(
  database: postgres.Sql,
  policyId: string,
  rebookEventId: string,
  amountCents: number,
): Promise<boolean> {
  return customerApprovalNeeded({
    amountCents,
    unapprovedRequestedCents: await moneyStillWaitingForTheCustomer(database, policyId, rebookEventId),
    thresholdCents: CUSTOMER_APPROVAL_THRESHOLD_CENTS,
  });
}

export async function correctionApprovalEventId(
  database: postgres.Sql,
  rebookEventId: string,
): Promise<string | null> {
  const [row] = await database<{ id: string }[]>`
    select id from policy_events
     where event_type = 'correction_approved' and payload ->> 'correction_rebook_event_id' = ${rebookEventId}
  `;
  return row ? row.id : null;
}

// The difference of one correction that is still waiting for its money: the latest attempt that
// has not succeeded. Null once the money has arrived.
async function outstandingCorrectionCollection(
  database: postgres.Sql,
  policyId: string,
  rebookEventId: string,
): Promise<{ operationId: string; amountCents: number; correctedEffectiveAt: string } | null> {
  const [row] = await database<{ operation_id: string; amount_cents: string; corrected_effective_at: string }[]>`
    select link.collection_operation_id as operation_id,
           link.amount_cents,
           to_char(event.effective_at, 'YYYY-MM-DD') as corrected_effective_at
      from correction_collections link
      join policy_events event on event.id = link.correction_rebook_event_id
     where link.policy_id = ${policyId}
       and link.correction_rebook_event_id = ${rebookEventId}
       and not exists (select 1 from money_operation_events paid
                        where paid.operation_id = link.collection_operation_id and paid.status = 'succeeded')
     order by link.recorded_at desc
     limit 1
  `;
  return row
    ? {
        operationId: row.operation_id,
        amountCents: centsFromDatabase(row.amount_cents, "amount_cents"),
        correctedEffectiveAt: row.corrected_effective_at,
      }
    : null;
}

// ---------------------------------------------------------------------------
// Opening the hosted page
// ---------------------------------------------------------------------------

export type StartCorrectionCheckoutRequest = {
  policyId: string;
  rebookEventId: string;
  actor: { userId: string; role: UserRole; brokerId: string | null };
};

export async function startCorrectionCheckout(
  request: StartCorrectionCheckoutRequest,
  database: postgres.Sql = sql,
): Promise<string> {
  const outstanding = await outstandingCorrectionCollection(database, request.policyId, request.rebookEventId);
  if (!outstanding) {
    throw new CorrectionCheckoutRefused("this correction has no difference left to collect");
  }
  const link = await loadCorrectionCollection(database, outstanding.operationId);
  if (!link) {
    throw new CorrectionCheckoutRefused("this difference has no money operation");
  }

  // Who may pay: the broker who owns the policy, or staff operations. Checked on the server every
  // time, so calling the route directly changes nothing.
  const isOwningBroker = request.actor.role === "broker" && request.actor.brokerId === link.brokerId;
  if (!isOwningBroker && request.actor.role !== "staff_ops") {
    throw new CorrectionCheckoutRefused("only the broker who owns this policy, or staff operations, can pay the difference");
  }

  const fold = await foldPolicyEvents(database, request.policyId);
  if (policyWasVoided(fold.eventTypes) || fold.eventTypes.includes("cancelled")) {
    throw new CorrectionCheckoutRefused("this policy is cancelled or voided: the difference has to be settled by operations");
  }

  if (
    (await differenceNeedsTheCustomer(database, link.policyId, link.rebookEventId, link.amountCents)) &&
    !(await correctionApprovalEventId(database, link.rebookEventId))
  ) {
    throw new CorrectionCheckoutRefused(
      "the customer has to approve this difference before it can be collected: it is above $500 counting anything else still waiting for them on this policy",
    );
  }

  const attempt = await latestAttempt(database, link.rebookEventId);
  if (attempt.checkoutUrl && !attempt.isDead) {
    return attempt.checkoutUrl; // same hosted page, no second session
  }
  const payable = attempt.isDead
    ? await createCorrectionCheckoutAttempt(
        { policyId: link.policyId, rebookEventId: link.rebookEventId, userId: request.actor.userId, attempt: attempt.attemptsSoFar + 1 },
        database,
      )
    : // Stripe's answer never made it to disk: call again with the SAME key.
      { operationId: link.operationId, idempotencyKey: attempt.idempotencyKey };

  await assertStripeSandbox();

  const paying = attempt.isDead ? (await loadCorrectionCollection(database, payable.operationId))! : link;
  let session;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        // Two line items, so the payer sees the same split as our ledger. No fee: the flat policy
        // fee is charged at issuance only.
        line_items: [
          lineItem(`Policy ${paying.policyNumber}: additional premium after the endorsement date was corrected`, paying.premiumCents),
          ...(paying.taxCents > 0 ? [lineItem(`${fold.terms.stateCode} premium tax on that premium`, paying.taxCents)] : []),
        ],
        client_reference_id: payable.operationId,
        metadata: { operation_id: payable.operationId, policy_id: paying.policyId, correction_rebook_event_id: paying.rebookEventId },
        // The webhook reads the operation id off the payment intent.
        payment_intent_data: {
          metadata: { operation_id: payable.operationId, policy_id: paying.policyId, correction_rebook_event_id: paying.rebookEventId },
        },
        success_url: `${appBaseUrl()}/policies/${paying.policyId}?correction=returned`,
        cancel_url: `${appBaseUrl()}/policies/${paying.policyId}?correction=cancelled`,
      },
      { idempotencyKey: payable.idempotencyKey },
    );
  } catch (error) {
    await recordProviderFailure(database, payable.operationId, error);
    throw new CorrectionCheckoutRefused(
      "Stripe did not accept the payment request; the failure was recorded and the same request can be retried",
    );
  }
  if (!session.url) {
    await recordProviderFailure(database, payable.operationId, new Error("Stripe returned a session without a URL"));
    throw new CorrectionCheckoutRefused("Stripe returned a session without a payment page; the failure was recorded");
  }

  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
  await database`
    insert into money_operation_events (operation_id, status, provider_ref, payload)
    values (${payable.operationId}, 'provider_accepted', ${session.id},
            ${database.json({ checkout_url: session.url, payment_intent_id: paymentIntentId })})
  `;
  return session.url;
}

// A new attempt after a dead hosted page: a new operation, a new key, the same amount. Exported
// so scripts/check-correction-replay.ts can build an attempt without opening a hosted page.
export async function createCorrectionCheckoutAttempt(
  input: { policyId: string; rebookEventId: string; userId: string; attempt: number },
  database: postgres.Sql = sql,
): Promise<{ operationId: string; idempotencyKey: string }> {
  const idempotencyKey = correctionCheckoutIdempotencyKey(input.rebookEventId, input.attempt);
  return database.begin(async (transaction) => {
    const [previous] = await transaction<{ amount_cents: string; premium_cents: string; tax_cents: string }[]>`
      select amount_cents, premium_cents, tax_cents from correction_collections
       where correction_rebook_event_id = ${input.rebookEventId}
       order by recorded_at limit 1
    `;
    if (!previous) {
      throw new CorrectionCheckoutRefused("this correction created no difference to collect");
    }
    const [operation] = await transaction<{ id: string }[]>`
      insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key, created_by)
      values ('stripe_checkout', 'stripe', ${previous.amount_cents}, ${input.policyId}, ${idempotencyKey}, ${input.userId})
      returning id
    `;
    await transaction`
      insert into money_operation_events (operation_id, status, payload)
      values (${operation.id}, 'requested',
              ${transaction.json({ note: "correction difference: hosted page not created yet", attempt: input.attempt })})
    `;
    await transaction`
      insert into correction_collections (collection_operation_id, policy_id, correction_rebook_event_id, amount_cents, premium_cents, tax_cents)
      values (${operation.id}, ${input.policyId}, ${input.rebookEventId}, ${previous.amount_cents}, ${previous.premium_cents}, ${previous.tax_cents})
    `;
    return { operationId: operation.id, idempotencyKey };
  });
}

type CollectionAttempt = {
  operationId: string;
  idempotencyKey: string;
  checkoutUrl: string | null;
  isDead: boolean;
  attemptsSoFar: number;
};

// The most recent attempt to collect this difference, and whether it can still be used.
async function latestAttempt(database: postgres.Sql, rebookEventId: string): Promise<CollectionAttempt> {
  const operations = await database<{ id: string; idempotency_key: string }[]>`
    select operation.id, operation.idempotency_key
      from correction_collections link
      join money_operations operation on operation.id = link.collection_operation_id
     where link.correction_rebook_event_id = ${rebookEventId}
     order by operation.created_at desc
  `;
  const latest = operations[0];
  const events = await database<{ status: string; payload: { checkout_url?: string; reason?: string } }[]>`
    select status, payload from money_operation_events where operation_id = ${latest.id} order by sequence_number
  `;
  const checkoutUrl = events.find((event) => event.payload?.checkout_url)?.payload.checkout_url ?? null;
  const expired = events.some((event) => event.status === "failed" && event.payload?.reason === CHECKOUT_EXPIRED_REASON);
  const failedWithoutSession = events.some((event) => event.status === "failed") && checkoutUrl === null;
  return {
    operationId: latest.id,
    idempotencyKey: latest.idempotency_key,
    checkoutUrl,
    isDead: expired || failedWithoutSession,
    attemptsSoFar: operations.length,
  };
}

// ---------------------------------------------------------------------------
// What the webhooks do
// ---------------------------------------------------------------------------

// Stripe says the difference was paid. The two entries and the 'succeeded' status go in ONE
// transaction: either the ledger shows the money and the receivable is cleared, or nothing
// happened. A second delivery meets the journal's unique key and answers already_posted.
export async function recordSuccessfulCorrectionPayment(
  payment: SuccessfulPayment,
  database: postgres.Sql = sql,
): Promise<CorrectionCollectionOutcome> {
  const link = await loadCorrectionCollection(database, payment.operationId);
  if (!link) {
    return { kind: "refused", reason: `no correction difference operation ${payment.operationId}` };
  }
  if (link.amountCents !== payment.amountReceivedCents) {
    return {
      kind: "refused",
      reason: `amount mismatch: Stripe collected ${payment.amountReceivedCents} cents, the operation asked for ${link.amountCents}`,
    };
  }

  try {
    await database.begin(async (transaction) => {
      const entries = correctionCollectionEntries({
        operationId: link.operationId,
        policyId: link.policyId,
        policyNumber: link.policyNumber,
        brokerId: link.brokerId,
        paymentDate: payment.paidOn,
        amountCents: link.amountCents,
        // Commission is earned on the extra premium only, tax excluded, rounded down like every
        // other commission figure in this build.
        commissionCents: commissionCents(link.premiumCents, link.commissionRateBps),
      });
      for (const entry of entries) {
        await postJournalEntry(transaction, entry.header, entry.lines);
      }
      await transaction`
        insert into money_operation_events (operation_id, status, provider_ref, payload)
        select ${payment.operationId}, 'succeeded', ${payment.paymentIntentId},
               ${transaction.json({ amount_received_cents: payment.amountReceivedCents, paid_on: payment.paidOn })}
         where not exists (
           select 1 from money_operation_events where operation_id = ${payment.operationId} and status = 'succeeded'
         )
      `;
    });
    return { kind: "posted" };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { kind: "already_posted" };
    }
    throw error;
  }
}

// The hosted page expired without being paid. No money moved and nothing is journaled: the
// attempt is dead and the next Pay click opens a new operation with a new key. The difference
// stays owed in premium_receivable, which is exactly where it should be.
export async function recordExpiredCorrectionCheckout(
  expiry: { operationId: string; sessionId: string },
  database: postgres.Sql = sql,
): Promise<CorrectionCollectionOutcome> {
  const link = await loadCorrectionCollection(database, expiry.operationId);
  if (!link) {
    return { kind: "refused", reason: `no correction difference operation ${expiry.operationId}` };
  }
  const [posted] = await database<{ count: string }[]>`
    select count(*)::text as count from journal_entries
     where source_kind = 'money_operation' and source_id = ${expiry.operationId}
  `;
  if (Number(posted.count) > 0) {
    return { kind: "refused", reason: "this difference was paid: an expired session changes nothing" };
  }
  await database`
    insert into money_operation_events (operation_id, status, provider_ref, payload)
    values (${expiry.operationId}, 'failed', ${expiry.sessionId},
            ${database.json({ stage: "checkout_session", reason: CHECKOUT_EXPIRED_REASON, session_id: expiry.sessionId })})
  `;
  return { kind: "posted" };
}

async function recordProviderFailure(database: postgres.Sql, operationId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message.slice(0, 500) : "unknown provider error";
  await database`
    insert into money_operation_events (operation_id, status, payload)
    values (${operationId}, 'failed', ${database.json({ stage: "create_checkout_session", message })})
  `;
}

function lineItem(name: string, amountCents: number) {
  return { quantity: 1, price_data: { currency: "usd", unit_amount: amountCents, product_data: { name } } };
}

function appBaseUrl(): string {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) {
    throw new Error("APP_BASE_URL must be set to build the Stripe return URLs");
  }
  return baseUrl.replace(/\/$/, "");
}
