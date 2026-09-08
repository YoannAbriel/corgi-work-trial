import type postgres from "postgres";
import { sql } from "@/db/client";
import { bindingIsAllowed } from "@/lib/broker/eligibility";
import { brokerKybState } from "@/lib/broker/kyb";
import { isUniqueViolation, postJournalEntry } from "@/lib/ledger/post";
import { issuanceAndCollectionEntries, unappliedCashReceivedEntry, type CollectedFrom } from "@/lib/ledger/policy-entries";
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
// the broker is not approved, the policy is NOT bound, but the money is journaled the moment
// it exists (rule 14, DECISIONS.md, review findings F-B2-17 and F-B3-01): cash at Stripe
// against a liability to the customer, in the suspense account unapplied_customer_cash. The
// payment becomes an operations case: retryBindingAfterEligibility applies the parked cash to
// the policy once the broker is verified. Ledger cash equals Stripe cash at every instant.

// Each function below takes the database handle as a parameter whose default is the
// application pool. Production always uses the default; scripts/check-payment-replay.ts and
// scripts/check-kyb-replay.ts pass the disposable test database so that the checks run this
// exact code, with real commits, without writing into the trial ledger.
export type CollectionOutcome =
  | { kind: "posted" }
  | { kind: "already_posted" }
  // The money arrived: it is recorded on the operation and journaled in the suspense account,
  // but the policy was NOT bound, because the broker is not eligible.
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
  // An endorsement delta is collected by a stripe_checkout operation too, but it is posted by
  // lib/payments/endorsement-collection.ts (the webhook route sends it there first). Posting
  // the four ISSUANCE entries under it would double the written premium, so it is refused here
  // as a second line of defence, never silently.
  if (operation.endorsementRequestEventId) {
    return {
      kind: "refused",
      reason: `operation ${payment.operationId} collects an endorsement delta and is posted by the endorsement path, not as an issuance`,
    };
  }
  // Same second line of defence for the difference a correction created (slice B8): posting the
  // four issuance entries under it would write the whole annual premium a second time.
  if (operation.correctionRebookEventId) {
    return {
      kind: "refused",
      reason: `operation ${payment.operationId} collects the difference of a correction and is posted by the correction path, not as an issuance`,
    };
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
// under the same money operation id, the same 'issued' event, with one difference that the
// transaction works out for itself: the cash of this payment was already booked at receipt
// (unapplied_cash_received), so premium_collected debits unapplied_customer_cash instead of
// cash_stripe. Nothing else is special-cased, which is why a second run answers "already
// posted" instead of doubling anything. After it, the suspense account is back to zero for
// this policy and cash_stripe shows the money exactly once.
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

      // Was this payment parked at receipt? Then the cash is applied, not booked again.
      const collectedFrom: CollectedFrom = (await cashWasParked(transaction, operation.operationId))
        ? "unapplied_customer_cash"
        : "cash_stripe";

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
        collectedFrom,
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
      return interpretUniqueViolation(database, operation, error);
    }
    throw error;
  }
}

// The journal's unique key: one entry of a given type per business operation. A violation of
// this constraint always concerns the operation we were posting, because that is what the
// entries are keyed on.
const JOURNAL_ENTRY_KEY = "journal_entries_source_kind_source_id_entry_type_key";

// Why the posting was refused, and whether that refusal is good news.
//
// A unique violation used to mean one thing, "somebody already posted this", and answering
// already_posted told Stripe to stop retrying. Two situations break that reading, and both end
// with real money at Stripe and nothing in the ledger (review finding F-B2-13):
//
//   * a correction reversed this operation's entries. The entries are still there, so the
//     unique key still refuses, but the ledger no longer holds that money.
//   * the violation came from ANOTHER operation. After a void, the superseded 'issued' row
//     stays in policy_events, so a payment made on a second attempt posts four fresh entries
//     under its own operation id and is then rolled back by
//     policy_events_one_issuance_per_policy. Nothing of that payment was journaled.
//
// So the constraint that actually fired is read from the Postgres error rather than guessed,
// and already_posted is answered only when this operation's own entries are in the journal.
// Everything else is refused, which lands the delivery in the inbox as ignored and visible.
async function interpretUniqueViolation(
  database: postgres.Sql,
  operation: CheckoutOperation,
  error: unknown,
): Promise<CollectionOutcome> {
  const constraintName = violatedConstraintName(error);

  const correction = await correctionThatReversedOperation(database, operation);
  if (correction) {
    return {
      kind: "refused",
      reason: `this policy was voided by correction event ${correction.correctionEventId} (${correction.reason}); a payment on it must be handled by operations`,
    };
  }

  if (constraintName === JOURNAL_ENTRY_KEY) {
    // Same money operation, second delivery: its entries are already in the journal.
    return { kind: "already_posted" };
  }

  // Any other constraint: the issuance entries of THIS operation decide. They are the only
  // proof that this payment was ever applied to the policy. The operation's own 'succeeded'
  // status is not proof, and neither is the parking entry, because a payment whose binding
  // was refused carries both with nothing applied.
  if (await operationHasIssuanceEntries(database, operation.operationId)) {
    return { kind: "already_posted" };
  }

  return {
    kind: "refused",
    reason: `the posting was refused by ${constraintName ?? "a unique constraint"} and nothing of this payment was journaled; operations must decide what to do with this money`,
  };
}

// The constraint Postgres named in the error. postgres.js copies the server's error fields onto
// the error object, so this is the database's own answer rather than a guess from the message.
function violatedConstraintName(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const named = (error as { constraint_name?: unknown }).constraint_name;
  return typeof named === "string" ? named : null;
}

// Has a correction undone what this operation posted? Two shapes count, because a void writes
// both: reversal entries pointing at the entries filed under this operation, and a
// 'correction_reversal' policy event superseding the issuance they produced. The policy event
// is what carries the reason, and it is also what catches a payment made on a LATER attempt,
// whose own entries were never reversed because they were never committed.
async function correctionThatReversedOperation(
  database: postgres.Sql,
  operation: CheckoutOperation,
): Promise<{ correctionEventId: string; reason: string } | null> {
  const [correction] = await database<{ id: string; reason: string | null }[]>`
    select reversal.id, reversal.payload ->> 'reason' as reason
      from policy_events reversal
      join policy_events superseded on superseded.id = reversal.supersedes_event_id
     where reversal.policy_id = ${operation.policyId}
       and reversal.event_type = 'correction_reversal'
       and superseded.event_type = 'issued'
     order by reversal.sequence_number desc
     limit 1
  `;
  if (correction) {
    return { correctionEventId: correction.id, reason: correction.reason ?? "no reason recorded" };
  }

  const [reversedEntries] = await database<{ count: string }[]>`
    select count(*)::text as count
      from journal_entries reversal
      join journal_entries original on original.id = reversal.reverses_entry_id
     where original.source_kind = 'money_operation'
       and original.source_id = ${operation.operationId}
  `;
  if (Number(reversedEntries.count) > 0) {
    return { correctionEventId: "none", reason: "this operation's journal entries carry reversals" };
  }
  return null;
}

async function operationHasIssuanceEntries(database: postgres.Sql, operationId: string): Promise<boolean> {
  const [row] = await database<{ count: string }[]>`
    select count(*)::text as count from journal_entries
     where source_kind = 'money_operation' and source_id = ${operationId} and entry_type = 'premium_collected'
  `;
  return Number(row.count) > 0;
}

// True when the cash of this operation was booked at receipt into the suspense account and
// that booking still stands (a reversal of it would mean a correction took the money out).
async function cashWasParked(database: postgres.Sql | postgres.TransactionSql, operationId: string): Promise<boolean> {
  const [row] = await database<{ count: string }[]>`
    select count(*)::text as count
      from journal_entries parked
     where parked.source_kind = 'money_operation'
       and parked.source_id = ${operationId}
       and parked.entry_type = 'unapplied_cash_received'
       and not exists (select 1 from journal_entries reversal where reversal.reverses_entry_id = parked.id)
  `;
  return Number(row.count) > 0;
}

// The money arrived, the policy is not bound. One transaction: the cash is journaled into the
// suspense account (Dr cash_stripe, Cr unapplied_customer_cash, rule 14), the operation's
// history says the payment succeeded AND why nothing was applied, and the cache reads
// paid_not_bound. The policy page reads the reason back from the operation's payload.
//
// A second delivery of the same payment meets the journal's unique key on the parking entry:
// the whole transaction rolls back and nothing is appended twice, which is the answer wanted.
async function recordPaymentWithoutBinding(
  database: postgres.Sql,
  operation: CheckoutOperation,
  payment: SuccessfulPayment,
  reason: string,
): Promise<void> {
  try {
    await database.begin(async (transaction) => {
      const parked = unappliedCashReceivedEntry({
        operationId: operation.operationId,
        policyId: operation.policyId,
        policyNumber: operation.policyNumber,
        brokerId: operation.brokerId,
        paymentDate: payment.paidOn,
        amountCents: payment.amountReceivedCents,
        reason,
      });
      await postJournalEntry(transaction, parked.header, parked.lines);
      await appendSucceededEventOnce(transaction, payment, {
        amount_received_cents: payment.amountReceivedCents,
        paid_on: payment.paidOn,
        binding_refused_reason: reason,
      });
      await refreshPolicyCurrent(transaction, operation.policyId);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return; // already parked by an earlier delivery of the same payment
    }
    throw error;
  }
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
       -- the issuance payment only: neither an endorsement delta nor a correction difference
       -- can bind a policy
       and not exists (select 1 from endorsement_collections link where link.collection_operation_id = operation.id)
       and not exists (select 1 from correction_collections fix where fix.collection_operation_id = operation.id)
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
  // The expiry of an endorsement's hosted page is recorded by the endorsement path (the route
  // sends it there first); the rule below ("already bound, nothing to reopen") is about the
  // issuance and would be wrong for an endorsement on a bound policy.
  if (operation.endorsementRequestEventId || operation.correctionRebookEventId) {
    return {
      kind: "refused",
      reason: `operation ${expiry.operationId} collects an endorsement delta or a correction difference; its expiry belongs to that path`,
    };
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
  // Set when this operation collects an endorsement delta rather than the issuance charge
  // (an endorsement_collections row names the request it pays for, migration 0009).
  endorsementRequestEventId: string | null;
  // Set when it collects the difference a backdated correction created (migration 0014).
  correctionRebookEventId: string | null;
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
      endorsement_request_event_id: string | null;
      correction_rebook_event_id: string | null;
    }[]
  >`
    select operation.id,
           operation.amount_cents,
           policy.id            as policy_id,
           policy.policy_number as policy_number,
           broker.id            as broker_id,
           broker.commission_rate_bps,
           link.request_event_id as endorsement_request_event_id,
           correction.correction_rebook_event_id
      from money_operations operation
      join policies policy on policy.id = operation.policy_id
      join brokers broker  on broker.id = policy.broker_id
      left join endorsement_collections link on link.collection_operation_id = operation.id
      left join correction_collections correction on correction.collection_operation_id = operation.id
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
    endorsementRequestEventId: row.endorsement_request_event_id,
    correctionRebookEventId: row.correction_rebook_event_id,
  };
}
