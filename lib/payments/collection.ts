import type postgres from "postgres";
import { sql } from "@/db/client";
import { bindingIsAllowed } from "@/lib/broker/eligibility";
import { brokerKybState } from "@/lib/broker/kyb";
import { isUniqueViolation, postJournalEntry } from "@/lib/ledger/post";
import { issuanceAndCollectionEntries } from "@/lib/ledger/policy-entries";
import { centsFromDatabase } from "@/lib/money/cents";
import { foldPolicyEvents, refreshPolicyCurrent } from "@/lib/policy/current";
import { policyTermsToPayload } from "@/lib/policy/terms";

// What happens when Stripe says the customer paid. This is the only place in the application
// that turns a provider event into journal entries.
//
// The posting runs in ONE transaction: the four journal entries, the 'succeeded' status of the
// money operation, the 'issued' policy event that binds the policy, and the refreshed cache.
// Either the policy is bound and the ledger shows the money, or nothing happened.
//
// Replay safety comes from the database, not from a flag: the journal's unique index on
// (source_kind, source_id, entry_type) refuses a second set of entries for the same money
// operation, and the partial unique index on policy_events refuses a second issuance. A
// unique violation therefore means "this was already posted", which is a success for the
// caller: Stripe gets a 200 and stops retrying.
//
// BROKER ELIGIBILITY IS CHECKED HERE, AT BINDING TIME (review finding F-B2-L).
// The check already runs when the payment page is opened (lib/payments/checkout.ts), but the
// question "may this broker bind?" is answered again at the moment the policy would actually
// be bound, because minutes pass between the two and a verification can fail in between. When
// the broker is not approved, the money is recorded as arrived and NOTHING is journaled and
// NOTHING is bound: the payment becomes an operations case that a human resolves with
// retryBindingAfterEligibility once the broker is verified. See its comment for the ledger
// consequence, which is deliberate and visible rather than hidden.

// Each function below takes the database handle as a parameter whose default is the
// application pool. Production always uses the default; scripts/check-payment-replay.ts and
// scripts/check-kyb-replay.ts pass the disposable test database so that the checks run this
// exact code, with real commits, without writing into the trial ledger.
export type CollectionOutcome =
  | { kind: "posted" }
  | { kind: "already_posted" }
  // The money arrived and is recorded on the operation, but the policy was NOT bound and
  // nothing was journaled, because the broker is not eligible.
  | { kind: "binding_refused"; reason: string }
  | { kind: "refused"; reason: string };

export type SuccessfulPayment = {
  operationId: string;
  paymentIntentId: string;
  amountReceivedCents: number;
  paidOn: string; // "YYYY-MM-DD" in UTC: the day the money arrived at Stripe
};

export async function recordSuccessfulPayment(
  payment: SuccessfulPayment,
  database: postgres.Sql = sql,
): Promise<CollectionOutcome> {
  const operation = await loadCheckoutOperation(database, payment.operationId);
  if (!operation) {
    return { kind: "refused", reason: `no stripe_checkout money operation ${payment.operationId}` };
  }
  // The provider's amount must be the amount we asked for. A different amount is not a money
  // event we know how to journal, so it stops here and stays visible for a human.
  if (operation.amountCents !== payment.amountReceivedCents) {
    return {
      kind: "refused",
      reason: `amount mismatch: Stripe collected ${payment.amountReceivedCents} cents, the operation asked for ${operation.amountCents}`,
    };
  }

  const kyb = await brokerKybState(operation.brokerId, database);
  if (!bindingIsAllowed(kyb.status)) {
    const reason = `broker not eligible: the KYB status is "${kyb.status}" and must be "approved"`;
    await recordPaymentWithoutBinding(database, operation, payment, reason);
    return { kind: "binding_refused", reason };
  }

  return postCollectionAndBind(database, operation, payment, null);
}

// Binds the policy after the broker has become eligible, for a payment that arrived while they
// were not. Staff operations only; the eligibility question is asked again here, so a stale
// screen or a direct call to the route cannot bind an ineligible broker's policy.
//
// It re-runs the same posting transaction as a first delivery would: the same four entries
// under the same money operation id, the same 'issued' event. Nothing is special-cased, which
// is why a second run answers "already posted" instead of doubling anything.
//
// The ledger consequence of the refusal, stated plainly because it is a real gap and the
// reconciliation screen will show it: between the refusal and this retry, Stripe holds cash
// that our ledger does not show. The money is recorded on the operation (status 'succeeded',
// with the refusal reason), the policy page says "paid, binding refused", and the difference
// is a provider-only record that reconciliation reports as a break with its age. Posting the
// cash to a suspense account instead would keep the ledger complete; that is a design question
// for the coordinator and Yoann, not a decision this function should make quietly.
export async function retryBindingAfterEligibility(
  request: { policyId: string; actorUserId: string },
  database: postgres.Sql = sql,
): Promise<CollectionOutcome> {
  const payment = await latestSuccessfulPayment(database, request.policyId);
  if (!payment) {
    return { kind: "refused", reason: "no successful payment on this policy, so there is nothing to bind" };
  }
  const operation = await loadCheckoutOperation(database, payment.operationId);
  if (!operation) {
    return { kind: "refused", reason: `no stripe_checkout money operation ${payment.operationId}` };
  }

  const kyb = await brokerKybState(operation.brokerId, database);
  if (!bindingIsAllowed(kyb.status)) {
    return {
      kind: "binding_refused",
      reason: `broker not eligible: the KYB status is "${kyb.status}" and must be "approved"`,
    };
  }

  return postCollectionAndBind(database, operation, payment, request.actorUserId);
}

// The one posting transaction, shared by the webhook and by the staff retry.
// `boundBy` is the user id when a human asked for the binding, null when a Stripe event did.
async function postCollectionAndBind(
  database: postgres.Sql,
  operation: CheckoutOperation,
  payment: SuccessfulPayment,
  boundBy: string | null,
): Promise<CollectionOutcome> {
  try {
    await database.begin(async (transaction) => {
      const { terms } = await foldPolicyEvents(transaction, operation.policyId);

      const entries = issuanceAndCollectionEntries({
        operationId: operation.operationId,
        policyId: operation.policyId,
        policyNumber: operation.policyNumber,
        brokerId: operation.brokerId,
        effectiveAt: terms.termStart,
        paymentDate: payment.paidOn,
        annualPremiumCents: terms.annualPremiumCents,
        taxCents: terms.taxCents,
        feeCents: terms.feeCents,
        commissionRateBps: operation.commissionRateBps,
      });
      for (const entry of entries) {
        await postJournalEntry(transaction, entry.header, entry.lines);
      }

      await appendSucceededEventOnce(transaction, payment, {
        amount_received_cents: payment.amountReceivedCents,
        paid_on: payment.paidOn,
      });

      // The policy becomes bound here and nowhere else: coverage starts once the premium is paid.
      await transaction`
        insert into policy_events (policy_id, event_type, effective_at, payload, created_by)
        values (${operation.policyId}, 'issued', ${terms.termStart},
                ${transaction.json(policyTermsToPayload(terms))}, ${boundBy})
      `;

      await refreshPolicyCurrent(transaction, operation.policyId);
    });
    return { kind: "posted" };
  } catch (error) {
    if (isUniqueViolation(error)) {
      // The entries of this operation are already in the journal. That is normally a replayed
      // delivery and a success. It is NOT a success when those entries have since been
      // reversed by a correction: the unique index still refuses the insert, but the ledger no
      // longer holds the money, so answering "already posted" would accept real cash with
      // nothing booked anywhere (review finding F-B2-13). A reversed operation is an
      // operations case, so it is refused loudly and stays visible in the inbox.
      if (await entriesOfOperationWereReversed(database, operation)) {
        return {
          kind: "refused",
          reason: "this operation's entries were reversed by a correction; a payment on it must be handled by operations",
        };
      }
      // Same money operation, second delivery: the entries are already in the journal.
      return { kind: "already_posted" };
    }
    throw error;
  }
}

// Has a correction undone what this operation posted? Two shapes count, because a correction
// writes both: a journal entry whose reverses_entry_id points at one of the entries filed
// under this operation, and a 'correction_reversal' policy event superseding the issuance the
// operation produced.
async function entriesOfOperationWereReversed(
  database: postgres.Sql,
  operation: CheckoutOperation,
): Promise<boolean> {
  const [reversedEntries] = await database<{ count: string }[]>`
    select count(*)::text as count
      from journal_entries reversal
      join journal_entries original on original.id = reversal.reverses_entry_id
     where original.source_kind = 'money_operation'
       and original.source_id = ${operation.operationId}
  `;
  if (Number(reversedEntries.count) > 0) {
    return true;
  }

  const [reversedIssuance] = await database<{ count: string }[]>`
    select count(*)::text as count
      from policy_events reversal
      join policy_events superseded on superseded.id = reversal.supersedes_event_id
     where reversal.policy_id = ${operation.policyId}
       and reversal.event_type = 'correction_reversal'
       and superseded.event_type = 'issued'
  `;
  return Number(reversedIssuance.count) > 0;
}

// The money arrived, the policy is not bound. One appended status, no journal entry at all:
// the operation's history says the payment succeeded AND why nothing was booked, and the
// policy page reads the reason back from this payload.
async function recordPaymentWithoutBinding(
  database: postgres.Sql,
  operation: CheckoutOperation,
  payment: SuccessfulPayment,
  reason: string,
): Promise<void> {
  await database.begin(async (transaction) => {
    await appendSucceededEventOnce(transaction, payment, {
      amount_received_cents: payment.amountReceivedCents,
      paid_on: payment.paidOn,
      binding_refused_reason: reason,
    });
    await refreshPolicyCurrent(transaction, operation.policyId);
  });
}

// Appends the 'succeeded' status of an operation, and only the first time.
//
// The guard is inside the statement rather than a read followed by a write, so two deliveries
// of the same payment cannot both decide that the status is missing. It matters on the refused
// path: there the posting transaction's unique index is not what stops a replay, since nothing
// is posted, so this statement is the whole protection against a second identical status row.
async function appendSucceededEventOnce(
  transaction: postgres.TransactionSql,
  payment: SuccessfulPayment,
  payload: Record<string, string | number>,
): Promise<void> {
  await transaction`
    insert into money_operation_events (operation_id, status, provider_ref, payload)
    select ${payment.operationId}, 'succeeded', ${payment.paymentIntentId}, ${transaction.json(payload)}
     where not exists (
       select 1 from money_operation_events
        where operation_id = ${payment.operationId} and status = 'succeeded'
     )
  `;
}

// The payment facts of the last successful collection of a policy, read back from the
// operation's own history so the staff retry re-posts exactly what Stripe reported.
async function latestSuccessfulPayment(
  database: postgres.Sql,
  policyId: string,
): Promise<SuccessfulPayment | null> {
  const [row] = await database<
    { operation_id: string; provider_ref: string | null; payload: Record<string, unknown> }[]
  >`
    select event.operation_id, event.provider_ref, event.payload
      from money_operation_events event
      join money_operations operation on operation.id = event.operation_id
     where operation.policy_id = ${policyId}
       and operation.kind = 'stripe_checkout'
       and event.status = 'succeeded'
     order by event.sequence_number desc
     limit 1
  `;
  if (!row) {
    return null;
  }
  return {
    operationId: row.operation_id,
    paymentIntentId: String(row.provider_ref ?? ""),
    amountReceivedCents: centsFromDatabase(row.payload.amount_received_cents, "amount_received_cents"),
    paidOn: String(row.payload.paid_on ?? ""),
  };
}

// Stripe says the payment failed. No money moved, so nothing is journaled: the failure is
// appended to the operation's history and the policy stays unbound.
export async function recordFailedPayment(
  failure: { operationId: string; paymentIntentId: string; reason: string },
  database: postgres.Sql = sql,
): Promise<CollectionOutcome> {
  const operation = await loadCheckoutOperation(database, failure.operationId);
  if (!operation) {
    return { kind: "refused", reason: `no stripe_checkout money operation ${failure.operationId}` };
  }
  await database.begin(async (transaction) => {
    await transaction`
      insert into money_operation_events (operation_id, status, provider_ref, payload)
      values (${failure.operationId}, 'failed', ${failure.paymentIntentId},
              ${transaction.json({ stage: "payment_intent", reason: failure.reason.slice(0, 500) })})
    `;
    await refreshPolicyCurrent(transaction, operation.policyId);
  });
  return { kind: "posted" };
}

// The hosted payment page expired without being paid (Stripe keeps a Checkout Session alive for
// 24 hours). No money moved, so nothing is journaled: the expiry is appended to the operation's
// history and the policy stays unbound and payable again. The next click on Pay cannot reuse
// this session, which can no longer be paid, so lib/payments/checkout.ts starts a NEW operation
// with a new idempotency key (review finding F-B2-03).
export const CHECKOUT_EXPIRED_REASON = "expired";

export async function recordExpiredCheckoutSession(
  expiry: { operationId: string; sessionId: string },
  database: postgres.Sql = sql,
): Promise<CollectionOutcome> {
  const operation = await loadCheckoutOperation(database, expiry.operationId);
  if (!operation) {
    return { kind: "refused", reason: `no stripe_checkout money operation ${expiry.operationId}` };
  }
  // A session can expire after the payment succeeded on another attempt; the policy is bound
  // and there is nothing to reopen.
  const { eventTypes } = await foldPolicyEvents(database, operation.policyId);
  if (eventTypes.includes("issued")) {
    return { kind: "refused", reason: "the policy is already bound: an expired session changes nothing" };
  }

  await database.begin(async (transaction) => {
    await transaction`
      insert into money_operation_events (operation_id, status, provider_ref, payload)
      values (${expiry.operationId}, 'failed', ${expiry.sessionId},
              ${transaction.json({
                stage: "checkout_session",
                reason: CHECKOUT_EXPIRED_REASON,
                session_id: expiry.sessionId,
              })})
    `;
    await refreshPolicyCurrent(transaction, operation.policyId);
  });
  return { kind: "posted" };
}

// checkout.session.completed says the hosted page was completed. It is recorded because it is
// a real step of the operation's life, but it posts NO money: two Stripe events describe one
// collection, and only payment_intent.succeeded posts it (ARCHITECTURE.md section 3).
export async function recordCheckoutSessionCompleted(
  completion: { operationId: string; sessionId: string; paymentStatus: string | null },
  database: postgres.Sql = sql,
): Promise<CollectionOutcome> {
  const operation = await loadCheckoutOperation(database, completion.operationId);
  if (!operation) {
    return { kind: "refused", reason: `no stripe_checkout money operation ${completion.operationId}` };
  }
  await database`
    insert into money_operation_events (operation_id, status, provider_ref, payload)
    values (${completion.operationId}, 'provider_accepted', ${completion.sessionId},
            ${database.json({
              note: "checkout.session.completed: the hosted page was completed; money posts on payment_intent.succeeded",
              payment_status: completion.paymentStatus,
            })})
  `;
  return { kind: "posted" };
}

type CheckoutOperation = {
  operationId: string;
  policyId: string;
  policyNumber: string;
  brokerId: string;
  commissionRateBps: number;
  amountCents: number;
};

async function loadCheckoutOperation(
  database: postgres.Sql,
  operationId: string,
): Promise<CheckoutOperation | null> {
  const [row] = await database<
    {
      id: string;
      amount_cents: string;
      policy_id: string;
      policy_number: string;
      broker_id: string;
      commission_rate_bps: number;
    }[]
  >`
    select operation.id,
           operation.amount_cents,
           policy.id            as policy_id,
           policy.policy_number as policy_number,
           broker.id            as broker_id,
           broker.commission_rate_bps
      from money_operations operation
      join policies policy on policy.id = operation.policy_id
      join brokers broker  on broker.id = policy.broker_id
     where operation.id = ${operationId}
       and operation.kind = 'stripe_checkout'
  `;
  if (!row) {
    return null;
  }
  return {
    operationId: row.id,
    policyId: row.policy_id,
    policyNumber: row.policy_number,
    brokerId: row.broker_id,
    commissionRateBps: row.commission_rate_bps,
    amountCents: centsFromDatabase(row.amount_cents, "amount_cents"),
  };
}
