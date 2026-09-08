import type postgres from "postgres";
import { sql } from "@/db/client";
import { isUniqueViolation, postJournalEntry } from "@/lib/ledger/post";
import { issuanceAndCollectionEntries } from "@/lib/ledger/policy-entries";
import { centsFromDatabase } from "@/lib/money/cents";
import { foldPolicyEvents, refreshPolicyCurrent } from "@/lib/policy/current";
import { policyTermsToPayload } from "@/lib/policy/terms";

// What happens when Stripe says the customer paid. This is the only place in the application
// that turns a provider event into journal entries.
//
// Everything below runs in ONE transaction: the four journal entries, the 'succeeded' status
// of the money operation, the 'issued' policy event that binds the policy, and the refreshed
// cache. Either the policy is bound and the ledger shows the money, or nothing happened.
//
// Replay safety comes from the database, not from a flag: the journal's unique index on
// (source_kind, source_id, entry_type) refuses a second set of entries for the same money
// operation, and the partial unique index on policy_events refuses a second issuance. A
// unique violation therefore means "this was already posted", which is a success for the
// caller: Stripe gets a 200 and stops retrying.

// Each function below takes the database handle as a parameter whose default is the
// application pool. Production always uses the default; scripts/check-payment-replay.ts passes
// the disposable test database so that the replay check runs this exact code, with real
// commits, without writing into the trial ledger.
export type CollectionOutcome =
  | { kind: "posted" }
  | { kind: "already_posted" }
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

      await transaction`
        insert into money_operation_events (operation_id, status, provider_ref, payload)
        values (${operation.operationId}, 'succeeded', ${payment.paymentIntentId},
                ${transaction.json({ amount_received_cents: payment.amountReceivedCents, paid_on: payment.paidOn })})
      `;

      // The policy becomes bound here and nowhere else: coverage starts once the premium is paid.
      await transaction`
        insert into policy_events (policy_id, event_type, effective_at, payload, created_by)
        values (${operation.policyId}, 'issued', ${terms.termStart},
                ${transaction.json(policyTermsToPayload(terms))}, null)
      `;

      await refreshPolicyCurrent(transaction, operation.policyId);
    });
    return { kind: "posted" };
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Same money operation, second delivery: the entries are already in the journal.
      return { kind: "already_posted" };
    }
    throw error;
  }
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
