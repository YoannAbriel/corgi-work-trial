import type Stripe from "stripe";
import type postgres from "postgres";
import { sql } from "@/db/client";
import { refundCompletedEntries } from "@/lib/ledger/cancellation-entries";
import { isUniqueViolation, postJournalEntry } from "@/lib/ledger/post";
import { centsFromDatabase } from "@/lib/money/cents";
import { refundIdempotencyKey } from "@/lib/money/idempotency";
import { assertStripeSandbox, stripe } from "@/lib/stripe";

// Everything Stripe-facing about a refund: asking for it, recovering from a lost answer,
// re-issuing a failed one, and turning the webhooks back into ledger entries.
//
// The database part of a cancellation is in lib/policy/cancel.ts and has already committed by
// the time anything here runs. That order is the whole safety argument: an operation row and a
// refund_requested entry exist BEFORE Stripe is asked for money, so a crash can never leave a
// refund at Stripe that our books do not know about.
//
// Each function below takes the database handle as a parameter whose default is the application
// pool. Production always uses the default; scripts/check-refund-replay.ts passes the disposable
// test database so the replay checks run this exact code, with real commits.

export type RefundOutcome =
  | { kind: "posted" } // journal entries written now
  | { kind: "already_posted" } // an earlier delivery of the same fact did the work
  | { kind: "recorded" } // lifecycle event appended, no money posted
  | { kind: "refused"; reason: string }; // we do not know how to book this; visible, never silent

// ---------------------------------------------------------------------------
// Asking Stripe for the money (the second half of the outbox)
// ---------------------------------------------------------------------------

export type RefundIssueOutcome = {
  operationId: string;
  status: "provider_accepted" | "failed";
  refundId: string | null;
  detail: string;
};

// Sends the refunds of one cancellation. Never throws on a provider error: a refusal by Stripe
// is a fact about the operation, so it is appended to its history and stays visible on the
// policy page, with refund_payable still open because the customer is still owed the money.
export async function issueRefundsAtStripe(
  refundOperationIds: string[],
  database: postgres.Sql = sql,
): Promise<RefundIssueOutcome[]> {
  const outcomes: RefundIssueOutcome[] = [];
  for (const operationId of refundOperationIds) {
    outcomes.push(await issueOneRefundAtStripe(operationId, database));
  }
  return outcomes;
}

async function issueOneRefundAtStripe(operationId: string, database: postgres.Sql): Promise<RefundIssueOutcome> {
  const operation = await loadRefundOperation(database, operationId);
  if (!operation) {
    return { operationId, status: "failed", refundId: null, detail: `no stripe_refund money operation ${operationId}` };
  }
  if (operation.refundId) {
    // Already accepted by Stripe (a second click, or a page reloaded): nothing more to send.
    return {
      operationId,
      status: "provider_accepted",
      refundId: operation.refundId,
      detail: "this refund was already created at Stripe",
    };
  }

  try {
    // AF-04: Stripe's own statement that it is answering in test mode, before any money moves.
    await assertStripeSandbox();

    // Recovery first, always. See recoverPendingRefund below for why.
    const alreadyThere = await recoverPendingRefund(operation);
    const refund =
      alreadyThere ??
      (await stripe.refunds.create(
        {
          payment_intent: operation.paymentIntentId,
          amount: operation.amountCents,
          metadata: { operation_id: operation.operationId, policy_id: operation.policyId },
        },
        { idempotencyKey: operation.idempotencyKey },
      ));

    await recordAcceptedRefund({ operationId: operation.operationId, refund }, database);
    return {
      operationId,
      status: "provider_accepted",
      refundId: refund.id,
      detail: alreadyThere ? "recovered a refund Stripe had already created for this operation" : `refund ${refund.id} created`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "unknown provider error";
    await database`
      insert into money_operation_events (operation_id, status, payload)
      values (${operationId}, 'failed', ${database.json({ stage: "create_refund", message })})
    `;
    return { operationId, status: "failed", refundId: null, detail: message };
  }
}

// The crash case: the process died between `refunds.create` and storing Stripe's answer.
//
// The refund may well exist at Stripe, and we would have no record of it. Before creating
// anything we therefore ask Stripe what refunds already exist on this PaymentIntent and look
// for the one carrying our operation id in its metadata. Only if none is found do we call
// create, and even then with the stable idempotency key, so two attempts that race each other
// still produce a single refund.
//
// It runs on every attempt, including the first: one extra read is a small price for never
// having to decide, from inside the process, whether "this is the first attempt".
export async function recoverPendingRefund(operation: RefundOperation): Promise<Stripe.Refund | null> {
  const existing = await stripe.refunds.list({ payment_intent: operation.paymentIntentId, limit: 100 });
  const ours = existing.data.find((refund) => refund.metadata?.operation_id === operation.operationId);
  return ours ?? null;
}

// Staff action after a FAILED refund: the bank sent the money back, the customer is still owed
// it, and refund_payable is still open. A new attempt is a NEW intent, so it gets a new money
// operation with a new idempotency key (reusing the old key would make Stripe hand back the
// failed refund forever).
//
// It posts NO journal entry: the liability was opened once by the original refund_requested
// entry and must be cleared exactly once, by whichever attempt finally completes.
export class RefundReissueRefused extends Error {}

export async function reissueRefund(
  input: { policyId: string; failedOperationId: string; actorUserId: string },
  database: postgres.Sql = sql,
): Promise<{ operationId: string; outcome: RefundIssueOutcome }> {
  const operationId = await createReissuedRefundOperation(input, database);
  const [outcome] = await issueRefundsAtStripe([operationId], database);
  return { operationId, outcome };
}

// The database half of a re-issue, on its own so that scripts/check-refund-replay.ts can prove
// the important property (a re-issue creates a new operation and posts NO journal entry)
// without calling Stripe.
export async function createReissuedRefundOperation(
  input: { policyId: string; failedOperationId: string; actorUserId: string },
  database: postgres.Sql = sql,
): Promise<string> {
  const failed = await loadRefundOperation(database, input.failedOperationId);
  // The operation id comes from a URL, so it is checked against the policy in that same URL
  // rather than trusted: no refund of another policy can be re-issued from this page.
  if (!failed || failed.policyId !== input.policyId) {
    throw new RefundReissueRefused("this refund operation does not belong to this policy");
  }
  if (failed.state !== "failed") {
    throw new RefundReissueRefused(
      `only a failed refund can be re-issued; this one is "${failed.state}". Sending another refund for the same liability would pay the customer twice`,
    );
  }

  let newOperationId = "";
  await database.begin(async (transaction) => {
    const attempt = await countRefundOperations(transaction, failed.policyId, failed.paymentIntentId);
    const [operation] = await transaction<{ id: string }[]>`
      insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key, created_by)
      values ('stripe_refund', 'stripe', ${failed.amountCents}, ${failed.policyId},
              ${refundIdempotencyKey(failed.policyId, failed.paymentIntentId, attempt + 1)}, ${input.actorUserId})
      returning id
    `;
    await transaction`
      insert into money_operation_events (operation_id, status, payload)
      values (${operation.id}, 'requested',
              ${transaction.json({ note: "re-issued after a failed refund", replaces_operation_id: input.failedOperationId })})
    `;
    // The same split as the failed attempt: the customer is owed the same money, made of the
    // same premium and tax, and the same commission has to come back from the broker.
    await transaction`
      insert into refund_allocations (
        refund_operation_id, policy_id, policy_event_id, collection_operation_id, payment_intent_id,
        amount_cents, refunded_premium_cents, refunded_tax_cents, commission_clawback_cents
      ) values (
        ${operation.id}, ${failed.policyId}, ${failed.policyEventId}, ${failed.collectionOperationId},
        ${failed.paymentIntentId}, ${failed.amountCents}, ${failed.refundedPremiumCents},
        ${failed.refundedTaxCents}, ${failed.commissionClawbackCents}
      )
    `;
    newOperationId = operation.id;
  });

  return newOperationId;
}

// ---------------------------------------------------------------------------
// What the webhooks do
// ---------------------------------------------------------------------------

// Stripe accepted the refund. No money has moved yet, so nothing is journaled: the refund id is
// recorded on the operation, which is how a later event, or the reconciliation job, finds it.
export async function recordAcceptedRefund(
  input: { operationId: string; refund: Stripe.Refund },
  database: postgres.Sql = sql,
): Promise<RefundOutcome> {
  const alreadyRecorded = await database<{ id: string }[]>`
    select id from money_operation_events
     where operation_id = ${input.operationId}
       and status = 'provider_accepted'
       and provider_ref = ${input.refund.id}
     limit 1
  `;
  if (alreadyRecorded.length > 0) {
    return { kind: "already_posted" };
  }
  await database`
    insert into money_operation_events (operation_id, status, provider_ref, payload)
    values (${input.operationId}, 'provider_accepted', ${input.refund.id},
            ${database.json({ refund_status: input.refund.status, amount_cents: input.refund.amount })})
  `;
  return { kind: "recorded" };
}

// The money left Stripe. This is the only place that posts a completed refund, and it does it
// in one transaction with the 'succeeded' lifecycle event: either the ledger shows the refund
// paid and the commission clawed back, or nothing happened at all.
export async function recordCompletedRefund(
  input: { operationId: string; refundId: string; amountCents: number; refundedOn: string },
  database: postgres.Sql = sql,
): Promise<RefundOutcome> {
  const operation = await loadRefundOperation(database, input.operationId);
  if (!operation) {
    return { kind: "refused", reason: `no stripe_refund money operation ${input.operationId}` };
  }
  // The provider's amount must be the amount we asked for. Anything else is not a money event
  // we know how to book, so it stops here and stays visible for a human.
  if (operation.amountCents !== input.amountCents) {
    return {
      kind: "refused",
      reason: `amount mismatch: Stripe refunded ${input.amountCents} cents, the operation asked for ${operation.amountCents}`,
    };
  }

  try {
    await database.begin(async (transaction) => {
      // The clawback was decided and stored when the cancellation was recorded, so the amount
      // posted here is the amount the broker was shown, not a fresh calculation against a rate
      // that may have changed in the meantime.
      const entries = refundCompletedEntries({
        refundOperationId: operation.operationId,
        policyId: operation.policyId,
        policyNumber: operation.policyNumber,
        brokerId: operation.brokerId,
        refundedOn: input.refundedOn,
        totalRefundCents: operation.amountCents,
        commissionClawbackCents: operation.commissionClawbackCents,
      });
      for (const entry of entries) {
        await postJournalEntry(transaction, entry.header, entry.lines);
      }
      await transaction`
        insert into money_operation_events (operation_id, status, provider_ref, payload)
        values (${operation.operationId}, 'succeeded', ${input.refundId},
                ${transaction.json({ amount_cents: input.amountCents, refunded_on: input.refundedOn })})
      `;
    });
    return { kind: "posted" };
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Same refund operation, second delivery: the entries are already in the journal.
      return { kind: "already_posted" };
    }
    throw error;
  }
}

// The refund failed at the customer's bank, or was cancelled before it settled.
//
// NO JOURNAL ENTRY IS POSTED, on purpose (design re-review finding R-01): the customer is still
// owed the money and the policy is still cancelled, so refund_payable must stay open. Reversing
// refund_requested would put the premium back into unearned_premium on a policy that no longer
// covers anything and would make the books say nobody is owed anything. The failure is recorded
// on the operation, the policy page shows "requested, not completed" with the reason, and staff
// re-issue a new refund operation (reissueRefund above).
export async function recordFailedRefund(
  input: { operationId: string; refundId: string; reason: string },
  database: postgres.Sql = sql,
): Promise<RefundOutcome> {
  const operation = await loadRefundOperation(database, input.operationId);
  if (!operation) {
    return { kind: "refused", reason: `no stripe_refund money operation ${input.operationId}` };
  }
  const alreadyFailed = await database<{ id: string }[]>`
    select id from money_operation_events
     where operation_id = ${input.operationId} and status = 'failed' and provider_ref = ${input.refundId}
     limit 1
  `;
  if (alreadyFailed.length > 0) {
    return { kind: "already_posted" };
  }
  await database`
    insert into money_operation_events (operation_id, status, provider_ref, payload)
    values (${input.operationId}, 'failed', ${input.refundId},
            ${database.json({ stage: "refund_lifecycle", reason: input.reason.slice(0, 500) })})
  `;
  return { kind: "recorded" };
}

// ---------------------------------------------------------------------------
// Finding the operation a Stripe refund belongs to
// ---------------------------------------------------------------------------

// Three ways, tried in order, because a webhook payload is untrusted input and metadata can be
// missing (a refund created from the Stripe dashboard by a human, for instance):
//   1. the operation id we put in the refund's metadata when we created it;
//   2. the refund id, which we stored on the operation as soon as Stripe accepted it;
//   3. the PaymentIntent, matched against the refund allocations of that payment.
// If the third way is ambiguous (two refunds in flight on the same payment) nothing is guessed:
// the event is stored and marked ignored with the reason, and a human looks at it.
export async function findRefundOperationId(
  refund: { id: string; payment_intent?: string | Stripe.PaymentIntent | null; metadata?: Stripe.Metadata | null },
  database: postgres.Sql = sql,
): Promise<{ operationId: string } | { operationId: null; reason: string }> {
  const fromMetadata = readUuid(refund.metadata?.operation_id);
  if (fromMetadata) {
    const [known] = await database<{ id: string }[]>`
      select id from money_operations where id = ${fromMetadata} and kind = 'stripe_refund'
    `;
    if (known) {
      return { operationId: known.id };
    }
    return { operationId: null, reason: `refund metadata names operation ${fromMetadata}, which is not a refund of ours` };
  }

  const [byRefundId] = await database<{ operation_id: string }[]>`
    select operation_id from money_operation_events
     where provider_ref = ${refund.id}
     order by sequence_number
     limit 1
  `;
  if (byRefundId) {
    return { operationId: byRefundId.operation_id };
  }

  const paymentIntentId = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id;
  if (!paymentIntentId) {
    return { operationId: null, reason: `refund ${refund.id} carries neither our operation id nor a payment intent` };
  }
  // Refunds of ours on that payment that have not completed yet: exactly one is unambiguous.
  const openOnThatPayment = await database<{ refund_operation_id: string }[]>`
    select allocation.refund_operation_id
      from refund_allocations allocation
     where allocation.payment_intent_id = ${paymentIntentId}
       and not exists (select 1 from money_operation_events event
                        where event.operation_id = allocation.refund_operation_id and event.status = 'succeeded')
  `;
  if (openOnThatPayment.length === 1) {
    return { operationId: openOnThatPayment[0].refund_operation_id };
  }
  return {
    operationId: null,
    reason:
      openOnThatPayment.length === 0
        ? `no refund of ours is waiting on payment ${paymentIntentId} (it may have been refunded from the Stripe dashboard)`
        : `${openOnThatPayment.length} refunds of ours are in flight on payment ${paymentIntentId}: which one this is cannot be decided safely`,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readUuid(candidate: unknown): string | null {
  return typeof candidate === "string" && UUID.test(candidate) ? candidate : null;
}

// ---------------------------------------------------------------------------
// Reading a refund operation and where it stands
// ---------------------------------------------------------------------------

export type RefundOperation = {
  operationId: string;
  policyId: string;
  policyNumber: string;
  brokerId: string;
  policyEventId: string;
  collectionOperationId: string;
  paymentIntentId: string;
  idempotencyKey: string;
  amountCents: number;
  refundedPremiumCents: number;
  refundedTaxCents: number;
  commissionClawbackCents: number;
  state: RefundState;
  refundId: string | null; // the Stripe refund id, once it exists
};

// Where a refund stands, read from its append-only events.
//
// Not "the latest event wins": the answer from our own API call and the webhook describing the
// same refund can be stored in either order, and a 'provider_accepted' appended a moment after
// 'succeeded' must not make a completed refund look pending. Precedence instead, from the most
// final state backwards. A failed refund that is re-issued becomes a NEW operation, so no
// operation ever has to go back from 'succeeded' to anything else.
export type RefundState = "requested" | "accepted" | "completed" | "failed";

export function refundStateFromEvents(statuses: string[]): RefundState {
  if (statuses.includes("succeeded")) {
    return "completed";
  }
  if (statuses.includes("failed")) {
    return "failed";
  }
  if (statuses.includes("provider_accepted")) {
    return "accepted";
  }
  return "requested";
}

async function loadRefundOperation(
  database: postgres.Sql,
  operationId: string,
): Promise<RefundOperation | null> {
  const [row] = await database<
    {
      id: string;
      amount_cents: string;
      idempotency_key: string;
      policy_id: string;
      policy_number: string;
      broker_id: string;
      policy_event_id: string;
      collection_operation_id: string;
      payment_intent_id: string;
      refunded_premium_cents: string;
      refunded_tax_cents: string;
      commission_clawback_cents: string;
    }[]
  >`
    select operation.id,
           operation.amount_cents,
           operation.idempotency_key,
           policy.id            as policy_id,
           policy.policy_number as policy_number,
           broker.id            as broker_id,
           allocation.policy_event_id,
           allocation.collection_operation_id,
           allocation.payment_intent_id,
           allocation.refunded_premium_cents,
           allocation.refunded_tax_cents,
           allocation.commission_clawback_cents
      from money_operations operation
      join refund_allocations allocation on allocation.refund_operation_id = operation.id
      join policies policy on policy.id = operation.policy_id
      join brokers broker  on broker.id = policy.broker_id
     where operation.id = ${operationId}
       and operation.kind = 'stripe_refund'
  `;
  if (!row) {
    return null;
  }

  const events = await database<{ status: string; provider_ref: string | null }[]>`
    select status, provider_ref from money_operation_events
     where operation_id = ${operationId}
     order by sequence_number
  `;
  // On a refund operation, provider_ref only ever holds the Stripe refund id: the PaymentIntent
  // being given back lives in refund_allocations, not in the lifecycle events.
  const refundId = events.find((event) => event.provider_ref !== null)?.provider_ref ?? null;

  return {
    operationId: row.id,
    policyId: row.policy_id,
    policyNumber: row.policy_number,
    brokerId: row.broker_id,
    policyEventId: row.policy_event_id,
    collectionOperationId: row.collection_operation_id,
    paymentIntentId: row.payment_intent_id,
    idempotencyKey: row.idempotency_key,
    amountCents: centsFromDatabase(row.amount_cents, "amount_cents"),
    refundedPremiumCents: centsFromDatabase(row.refunded_premium_cents, "refunded_premium_cents"),
    refundedTaxCents: centsFromDatabase(row.refunded_tax_cents, "refunded_tax_cents"),
    commissionClawbackCents: centsFromDatabase(row.commission_clawback_cents, "commission_clawback_cents"),
    state: refundStateFromEvents(events.map((event) => event.status)),
    refundId,
  };
}

async function countRefundOperations(
  database: postgres.TransactionSql,
  policyId: string,
  paymentIntentId: string,
): Promise<number> {
  const [row] = await database<{ count: string }[]>`
    select count(*)::text as count from refund_allocations
     where policy_id = ${policyId} and payment_intent_id = ${paymentIntentId}
  `;
  return Number(row.count);
}
