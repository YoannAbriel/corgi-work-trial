import type postgres from "postgres";
import { sql } from "@/db/client";
import { bindingIsAllowed } from "@/lib/broker/eligibility";
import { brokerKybState } from "@/lib/broker/kyb";
import { endorsementCollectionEntries } from "@/lib/ledger/endorsement-entries";
import { unappliedCashReceivedEntry, type CollectedFrom } from "@/lib/ledger/policy-entries";
import { isUniqueViolation, postJournalEntry } from "@/lib/ledger/post";
import { centsFromDatabase } from "@/lib/money/cents";
import { endorsementCheckoutIdempotencyKey } from "@/lib/money/idempotency";
import { foldPolicyEvents, refreshPolicyCurrent } from "@/lib/policy/current";
import { applyEndorsement, EndorsementRefused, requireLiveRequest } from "@/lib/policy/endorse";
import { endorsementRequestStanding, readEndorsementRequest, type EndorsementRequest } from "@/lib/policy/endorsement-requests";
import { policyWasVoided } from "@/lib/policy/status";
import { assertStripeSandbox, stripe } from "@/lib/stripe";
import { CHECKOUT_EXPIRED_REASON, type SuccessfulPayment } from "./collection";

// Collecting a positive endorsement delta through Stripe, and applying the endorsement when the
// money is confirmed. The mirror of lib/payments/checkout.ts and lib/payments/collection.ts for
// the issuance payment, with the same three safety rules:
//
//   1. the outbox: the money operation (an ordinary stripe_checkout row) and its
//      endorsement_collections row are committed BEFORE Stripe is called, with an idempotency
//      key derived from the request event and the attempt number;
//   2. entries are posted only on payment_intent.succeeded, in ONE transaction with the
//      'endorsed' policy event and the operation's 'succeeded' status; the journal's unique key
//      on (money operation, entry type) and the unique index "one 'endorsed' per request" make a
//      second delivery a no-op;
//   3. an expired hosted page marks the attempt dead (reason "expired") and the next Pay click
//      opens a new operation under a new key.
//
// Every function takes the database handle as a parameter whose default is the application
// pool, so scripts/check-endorsement-replay.ts runs this exact code on the disposable database.

export class EndorsementCheckoutRefused extends Error {}

export type EndorsementCollectionOutcome =
  | { kind: "posted" }
  | { kind: "already_posted" }
  // The money arrived and was parked in the suspense account (rule 14), but the endorsement was
  // NOT applied: the policy was cancelled, the broker lost eligibility, or the quote was
  // superseded meanwhile. Ledger cash still equals Stripe cash; what is undecided is whose
  // premium it is.
  | { kind: "application_refused"; reason: string }
  | { kind: "refused"; reason: string };

// ---------------------------------------------------------------------------
// Starting the payment of the delta
// ---------------------------------------------------------------------------

export type StartEndorsementCheckoutRequest = {
  policyId: string;
  requestEventId: string;
  quoteHash: string; // the hidden field of the Pay form
  brokerId: string; // the broker of the signed-in user
  userId: string;
};

export async function startEndorsementCheckout(
  request: StartEndorsementCheckoutRequest,
  database: postgres.Sql = sql,
): Promise<string> {
  const policy = await loadPolicyForDelta(database, request.policyId);
  if (!policy) {
    throw new EndorsementCheckoutRefused("this policy does not exist");
  }
  if (policy.brokerId !== request.brokerId) {
    throw new EndorsementCheckoutRefused("this policy belongs to another broker");
  }

  const fold = await foldPolicyEvents(database, request.policyId);
  if (policyWasVoided(fold.eventTypes) || !fold.eventTypes.includes("issued") || fold.eventTypes.includes("cancelled")) {
    throw new EndorsementCheckoutRefused("only a bound policy that is still in force can collect an endorsement delta");
  }

  // Server-side eligibility, at execution time: an unapproved broker collects nothing.
  const kyb = await brokerKybState(policy.brokerId, database);
  if (!bindingIsAllowed(kyb.status)) {
    throw new EndorsementCheckoutRefused(
      `collection is refused: the broker's KYB status is "${kyb.status}" and must be "approved"`,
    );
  }

  // The quote must be the live one, and approved by the customer when the amount asks for it.
  let live;
  try {
    live = await requireLiveRequest(database, request.policyId, request.requestEventId, request.quoteHash);
  } catch (error) {
    if (error instanceof EndorsementRefused) {
      throw new EndorsementCheckoutRefused(error.message);
    }
    throw error;
  }
  const { request: quote, standing } = live;
  if (quote.figures.direction !== "charge") {
    throw new EndorsementCheckoutRefused("this endorsement collects nothing: it was applied without a payment");
  }
  if (standing.state === "awaiting_approval") {
    throw new EndorsementCheckoutRefused(
      "the customer has to approve this endorsement before the delta can be collected (above $500)",
    );
  }
  // Belt and braces: the quote was priced against the annual premium in force at the time.
  if (quote.figures.oldAnnualPremiumCents !== fold.terms.annualPremiumCents) {
    throw new EndorsementCheckoutRefused("this quote was priced against terms that are no longer in force; open the endorsement again");
  }

  // Which attempt to collect this delta we are on, and whether the last one can still be used.
  const latest = await latestDeltaAttempt(database, quote.eventId);
  if (latest && !latest.isDead && latest.checkoutUrl) {
    return latest.checkoutUrl; // same hosted page, no second session
  }
  const attempt =
    latest && !latest.isDead
      ? // Stripe's answer never made it to disk: call again with the SAME key.
        { operationId: latest.operationId, idempotencyKey: latest.idempotencyKey }
      : await createEndorsementCheckoutOperation(
          { quote, userId: request.userId, attempt: (latest?.attemptsSoFar ?? 0) + 1 },
          database,
        );

  await assertStripeSandbox();

  let session;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        // Two line items, so the payer sees the same split as our ledger. No fee: the flat policy
        // fee is charged at issuance only.
        line_items: [
          lineItem(
            `Policy ${policy.policyNumber}: additional premium, endorsement effective ${quote.figures.effectiveAt}`,
            quote.figures.deltaPremiumCents,
          ),
          ...(quote.figures.deltaTaxCents > 0
            ? [lineItem(`${fold.terms.stateCode} premium tax (${(quote.figures.taxRateBps / 100).toFixed(2)}%)`, quote.figures.deltaTaxCents)]
            : []),
        ],
        client_reference_id: attempt.operationId,
        metadata: {
          operation_id: attempt.operationId,
          policy_id: request.policyId,
          endorsement_request_event_id: quote.eventId,
        },
        // The webhook reads the operation id off the payment intent.
        payment_intent_data: {
          metadata: { operation_id: attempt.operationId, policy_id: request.policyId, endorsement_request_event_id: quote.eventId },
        },
        success_url: `${appBaseUrl()}/policies/${request.policyId}?endorsement=returned`,
        cancel_url: `${appBaseUrl()}/policies/${request.policyId}?endorsement=cancelled`,
      },
      { idempotencyKey: attempt.idempotencyKey },
    );
  } catch (error) {
    await recordProviderFailure(database, attempt.operationId, error);
    throw new EndorsementCheckoutRefused(
      "Stripe did not accept the payment request; the failure was recorded and the same request can be retried",
    );
  }
  if (!session.url) {
    await recordProviderFailure(database, attempt.operationId, new Error("Stripe returned a session without a URL"));
    throw new EndorsementCheckoutRefused("Stripe returned a session without a payment page; the failure was recorded");
  }

  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
  await database`
    insert into money_operation_events (operation_id, status, provider_ref, payload)
    values (${attempt.operationId}, 'provider_accepted', ${session.id},
            ${database.json({ checkout_url: session.url, payment_intent_id: paymentIntentId })})
  `;
  return session.url;
}

// The intent, committed before any provider call: the operation, its 'requested' status and the
// row that says which endorsement it collects. Exported so the replay check can build attempts
// without opening a hosted page.
export async function createEndorsementCheckoutOperation(
  input: { quote: EndorsementRequest; userId: string; attempt: number },
  database: postgres.Sql = sql,
): Promise<{ operationId: string; idempotencyKey: string }> {
  const figures = input.quote.figures;
  if (figures.direction !== "charge") {
    throw new EndorsementCheckoutRefused("only a positive delta is collected through Stripe");
  }
  const idempotencyKey = endorsementCheckoutIdempotencyKey(input.quote.eventId, input.attempt);
  return database.begin(async (transaction) => {
    const [operation] = await transaction<{ id: string }[]>`
      insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key, created_by)
      values ('stripe_checkout', 'stripe', ${figures.deltaTotalCents}, ${input.quote.policyId},
              ${idempotencyKey}, ${input.userId})
      returning id
    `;
    await transaction`
      insert into money_operation_events (operation_id, status, payload)
      values (${operation.id}, 'requested',
              ${transaction.json({ note: "endorsement delta: checkout session not created yet", attempt: input.attempt })})
    `;
    await transaction`
      insert into endorsement_collections (
        collection_operation_id, policy_id, request_event_id, quote_hash,
        amount_cents, delta_premium_cents, delta_tax_cents
      ) values (
        ${operation.id}, ${input.quote.policyId}, ${input.quote.eventId}, ${figures.quoteHash},
        ${figures.deltaTotalCents}, ${figures.deltaPremiumCents}, ${figures.deltaTaxCents}
      )
    `;
    return { operationId: operation.id, idempotencyKey };
  });
}

// ---------------------------------------------------------------------------
// What the webhooks do
// ---------------------------------------------------------------------------

// Stripe says the delta was paid: the only place that applies an endorsement collected through
// Stripe. Same shape as recordSuccessfulPayment for the issuance.
export async function recordSuccessfulEndorsementPayment(
  payment: SuccessfulPayment,
  database: postgres.Sql = sql,
): Promise<EndorsementCollectionOutcome> {
  const link = await loadEndorsementCollection(database, payment.operationId);
  if (!link) {
    return { kind: "refused", reason: `no endorsement delta operation ${payment.operationId}` };
  }
  if (link.amountCents !== payment.amountReceivedCents) {
    return {
      kind: "refused",
      reason: `amount mismatch: Stripe collected ${payment.amountReceivedCents} cents, the operation asked for ${link.amountCents}`,
    };
  }

  // A cancelled or voided policy cannot take an endorsement, whatever Stripe collected. The
  // money still arrived, so it is PARKED like any other delta we cannot apply (review finding
  // F-B4-05): returning "refused" and journaling nothing left ledger cash below what Stripe
  // held, which is the very hole rule 14 exists to close. The cancellation now expires the
  // policy's open pages (lib/policy/cancel.ts), so this is the narrow race where the customer
  // paid in the seconds before that call, not the ordinary path.
  const fold = await foldPolicyEvents(database, link.policyId);
  if (policyWasVoided(fold.eventTypes) || fold.eventTypes.includes("cancelled") || !fold.eventTypes.includes("issued")) {
    const reason = "the policy is cancelled, voided or not bound: an endorsement delta cannot be applied to it";
    await parkPaymentWithoutApplying(database, link, payment, reason);
    return { kind: "application_refused", reason };
  }

  // The quote must still be the live one. A payment on a superseded quote is money we did not
  // ask for any more: parked, nothing else journaled, visible for staff.
  const request = await readEndorsementRequest(database, link.policyId, link.requestEventId);
  if (!request) {
    // The request row is unreadable, so there is no endorsement to speak of, but the money is
    // real: park it and let a human decide.
    const reason = `endorsement request ${link.requestEventId} cannot be read`;
    await parkPaymentWithoutApplying(database, link, payment, reason);
    return { kind: "application_refused", reason };
  }
  const standing = await endorsementRequestStanding(database, request);
  if (standing.state === "superseded") {
    const reason = `the quote was superseded by a later ${standing.supersededByEventType ?? "event"} before the payment arrived`;
    await parkPaymentWithoutApplying(database, link, payment, reason);
    return { kind: "application_refused", reason };
  }
  if (standing.state === "awaiting_approval") {
    const reason = "the customer has not approved this endorsement";
    await parkPaymentWithoutApplying(database, link, payment, reason);
    return { kind: "application_refused", reason };
  }

  // Eligibility at application time, as at binding time (lib/payments/collection.ts).
  const kyb = await brokerKybState(link.brokerId, database);
  if (!bindingIsAllowed(kyb.status)) {
    const reason = `broker not eligible: the KYB status is "${kyb.status}" and must be "approved"`;
    await parkPaymentWithoutApplying(database, link, payment, reason);
    return { kind: "application_refused", reason };
  }

  return postDeltaAndApply(database, link, request, payment, null);
}

// Staff action after an application was refused (broker eligibility, at the time): re-runs the
// same posting transaction once the broker is eligible again. Same gates as a first delivery.
export async function retryEndorsementApplication(
  input: { policyId: string; requestEventId: string; actorUserId: string },
  database: postgres.Sql = sql,
): Promise<EndorsementCollectionOutcome> {
  const payment = await latestSuccessfulDeltaPayment(database, input.requestEventId);
  if (!payment) {
    return { kind: "refused", reason: "no successful payment of this delta, so there is nothing to apply" };
  }
  const link = await loadEndorsementCollection(database, payment.operationId);
  if (!link || link.policyId !== input.policyId) {
    return { kind: "refused", reason: "this delta payment does not belong to this policy" };
  }
  const request = await readEndorsementRequest(database, link.policyId, link.requestEventId);
  if (!request) {
    return { kind: "refused", reason: `endorsement request ${link.requestEventId} cannot be read` };
  }
  const standing = await endorsementRequestStanding(database, request);
  if (standing.state === "superseded" || standing.state === "awaiting_approval") {
    return { kind: "refused", reason: `the quote is ${standing.state.replace("_", " ")}: it cannot be applied` };
  }
  // The policy may have been cancelled or voided since the money arrived; the money stays parked.
  const fold = await foldPolicyEvents(database, link.policyId);
  if (policyWasVoided(fold.eventTypes) || fold.eventTypes.includes("cancelled") || !fold.eventTypes.includes("issued")) {
    return { kind: "refused", reason: "the policy is cancelled, voided or not bound: an endorsement delta cannot be applied to it" };
  }
  const kyb = await brokerKybState(link.brokerId, database);
  if (!bindingIsAllowed(kyb.status)) {
    return { kind: "application_refused", reason: `broker not eligible: the KYB status is "${kyb.status}" and must be "approved"` };
  }
  return postDeltaAndApply(database, link, request, payment, input.actorUserId);
}

// The one posting transaction: the four entries, the 'succeeded' status (once), the 'endorsed'
// event and the refreshed cache. Either the endorsement is in force and the ledger shows the
// money, or nothing happened.
async function postDeltaAndApply(
  database: postgres.Sql,
  link: EndorsementCollection,
  request: EndorsementRequest,
  payment: SuccessfulPayment,
  appliedBy: string | null,
): Promise<EndorsementCollectionOutcome> {
  try {
    await database.begin(async (transaction) => {
      const { terms } = await foldPolicyEvents(transaction, link.policyId);
      // Was this delta parked in the suspense account at receipt (rule 14)? Then the cash is
      // applied, not booked a second time.
      const collectedFrom: CollectedFrom = (await cashWasParked(transaction, link.operationId))
        ? "unapplied_customer_cash"
        : "cash_stripe";
      const entries = endorsementCollectionEntries({
        operationId: link.operationId,
        policyId: link.policyId,
        policyNumber: link.policyNumber,
        brokerId: link.brokerId,
        effectiveAt: request.figures.effectiveAt,
        paymentDate: payment.paidOn,
        // Posted from the allocation row decided at checkout, never recomputed.
        deltaPremiumCents: link.deltaPremiumCents,
        deltaTaxCents: link.deltaTaxCents,
        commissionCents: request.figures.commissionDeltaCents,
        collectedFrom,
      });
      for (const entry of entries) {
        await postJournalEntry(transaction, entry.header, entry.lines);
      }
      await appendSucceededEventOnce(transaction, payment, {
        amount_received_cents: payment.amountReceivedCents,
        paid_on: payment.paidOn,
      });
      await applyEndorsement(transaction, {
        request,
        termsBefore: terms,
        appliedBy,
        collectionOperationId: link.operationId,
      });
      await refreshPolicyCurrent(transaction, link.policyId);
    });
    return { kind: "posted" };
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Either the journal key (this operation already posted the delta) or the
      // one-endorsement-per-request index (another attempt applied it). The proof of a posting
      // is THIS operation's own endorsement_premium_collected entry, not any entry at all: a
      // payment that was parked in the suspense account (rule 14) already has an entry and has
      // NOT been applied. Anything else is refused and stays visible for a human.
      if (await deltaWasCollected(database, link.operationId)) {
        return { kind: "already_posted" };
      }
      return {
        kind: "refused",
        reason: "the endorsement was already applied by another payment attempt; nothing of this payment was journaled and operations must decide what to do with this money",
      };
    }
    throw error;
  }
}

// The hosted page expired without being paid. No money moved, nothing is journaled; the attempt
// is dead and the next Pay click opens a new operation with a new key.
export async function recordExpiredEndorsementCheckout(
  expiry: { operationId: string; sessionId: string },
  database: postgres.Sql = sql,
): Promise<EndorsementCollectionOutcome> {
  const link = await loadEndorsementCollection(database, expiry.operationId);
  if (!link) {
    return { kind: "refused", reason: `no endorsement delta operation ${expiry.operationId}` };
  }
  // Any entry under this operation means the money arrived: either the delta was applied, or it
  // was parked in the suspense account. Either way the hosted page cannot be declared unpaid.
  if (await operationHasJournalEntries(database, link.operationId)) {
    return { kind: "refused", reason: "this delta was paid: an expired session changes nothing" };
  }
  await database`
    insert into money_operation_events (operation_id, status, provider_ref, payload)
    values (${expiry.operationId}, 'failed', ${expiry.sessionId},
            ${database.json({ stage: "checkout_session", reason: CHECKOUT_EXPIRED_REASON, session_id: expiry.sessionId })})
  `;
  return { kind: "posted" };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// Does this operation collect an endorsement delta? The webhook route asks this first, so the
// payment goes to this file and never to the issuance path.
export async function endorsementCollectionOfOperation(
  operationId: string,
  database: postgres.Sql = sql,
): Promise<{ requestEventId: string; policyId: string } | null> {
  const [row] = await database<{ request_event_id: string; policy_id: string }[]>`
    select request_event_id, policy_id from endorsement_collections where collection_operation_id = ${operationId}
  `;
  return row ? { requestEventId: row.request_event_id, policyId: row.policy_id } : null;
}

type EndorsementCollection = {
  operationId: string;
  policyId: string;
  policyNumber: string;
  brokerId: string;
  requestEventId: string;
  amountCents: number;
  deltaPremiumCents: number;
  deltaTaxCents: number;
};

async function loadEndorsementCollection(database: postgres.Sql, operationId: string): Promise<EndorsementCollection | null> {
  const [row] = await database<
    {
      operation_id: string;
      policy_id: string;
      policy_number: string;
      broker_id: string;
      request_event_id: string;
      amount_cents: string;
      delta_premium_cents: string;
      delta_tax_cents: string;
    }[]
  >`
    select operation.id         as operation_id,
           policy.id            as policy_id,
           policy.policy_number as policy_number,
           policy.broker_id     as broker_id,
           link.request_event_id,
           operation.amount_cents,
           link.delta_premium_cents,
           link.delta_tax_cents
      from endorsement_collections link
      join money_operations operation on operation.id = link.collection_operation_id
      join policies policy on policy.id = link.policy_id
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
    requestEventId: row.request_event_id,
    amountCents: centsFromDatabase(row.amount_cents, "amount_cents"),
    deltaPremiumCents: centsFromDatabase(row.delta_premium_cents, "delta_premium_cents"),
    deltaTaxCents: centsFromDatabase(row.delta_tax_cents, "delta_tax_cents"),
  };
}

type DeltaAttempt = {
  operationId: string;
  idempotencyKey: string;
  checkoutUrl: string | null;
  isDead: boolean;
  attemptsSoFar: number;
};

// The most recent attempt to collect this request's delta, and whether it can still be used.
async function latestDeltaAttempt(database: postgres.Sql, requestEventId: string): Promise<DeltaAttempt | null> {
  const operations = await database<{ id: string; idempotency_key: string }[]>`
    select operation.id, operation.idempotency_key
      from endorsement_collections link
      join money_operations operation on operation.id = link.collection_operation_id
     where link.request_event_id = ${requestEventId}
     order by operation.created_at desc
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
    isDead: expired || failedWithoutSession,
    attemptsSoFar: operations.length,
  };
}

async function latestSuccessfulDeltaPayment(database: postgres.Sql, requestEventId: string): Promise<SuccessfulPayment | null> {
  const [row] = await database<{ operation_id: string; provider_ref: string | null; payload: Record<string, unknown> }[]>`
    select event.operation_id, event.provider_ref, event.payload
      from money_operation_events event
      join endorsement_collections link on link.collection_operation_id = event.operation_id
     where link.request_event_id = ${requestEventId}
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

async function operationHasJournalEntries(database: postgres.Sql, operationId: string): Promise<boolean> {
  const [row] = await database<{ count: string }[]>`
    select count(*)::text as count from journal_entries
     where source_kind = 'money_operation' and source_id = ${operationId}
  `;
  return Number(row.count) > 0;
}

// True when THIS operation posted the delta itself, which is the only proof that the endorsement
// was applied by this payment. A parked payment has an unapplied_cash_received entry and no
// endorsement_premium_collected one.
async function deltaWasCollected(database: postgres.Sql, operationId: string): Promise<boolean> {
  const [row] = await database<{ count: string }[]>`
    select count(*)::text as count from journal_entries
     where source_kind = 'money_operation'
       and source_id = ${operationId}
       and entry_type = 'endorsement_premium_collected'
  `;
  return Number(row.count) > 0;
}

// The money arrived and the endorsement is NOT applied. The cash exists, so the ledger records
// it the moment it exists: Dr cash_stripe / Cr unapplied_customer_cash, the same suspense
// account and the same entry type as an issuance payment that could not be bound (rule 14,
// DECISIONS.md 12:54Z). Ledger cash equals Stripe cash at every instant; what is not yet decided
// is whose premium it is.
//
// One transaction: the parking entry, and the operation's history saying the payment succeeded
// AND why nothing was applied. A second delivery of the same payment meets the journal's unique
// key on (money operation, entry type), the whole transaction rolls back, and nothing is
// appended twice.
//
// The way out is either retryEndorsementApplication (the endorsement is applied and
// endorsement_premium_collected debits the suspense account, clearing it) or, for a quote that
// will never be applied, a refund of the parked amount, which is money out and therefore goes
// through the approval queue.
async function parkPaymentWithoutApplying(
  database: postgres.Sql,
  link: EndorsementCollection,
  payment: SuccessfulPayment,
  reason: string,
): Promise<void> {
  try {
    await database.begin(async (transaction) => {
      const parked = unappliedCashReceivedEntry({
        operationId: link.operationId,
        policyId: link.policyId,
        policyNumber: link.policyNumber,
        brokerId: link.brokerId,
        paymentDate: payment.paidOn,
        amountCents: payment.amountReceivedCents,
        reason,
        whatWasRefused: "the endorsement",
      });
      await postJournalEntry(transaction, parked.header, parked.lines);
      await appendSucceededEventOnce(transaction, payment, {
        amount_received_cents: payment.amountReceivedCents,
        paid_on: payment.paidOn,
        application_refused_reason: reason,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return; // already parked by an earlier delivery of the same payment
    }
    throw error;
  }
}

// True when the cash of this delta operation was booked at receipt into the suspense account and
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

// Appends the 'succeeded' status once, the guard inside the statement so two deliveries cannot
// both decide it is missing (same as lib/payments/collection.ts).
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

async function recordProviderFailure(database: postgres.Sql, operationId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message.slice(0, 500) : "unknown provider error";
  await database`
    insert into money_operation_events (operation_id, status, payload)
    values (${operationId}, 'failed', ${database.json({ stage: "create_checkout_session", message })})
  `;
}

async function loadPolicyForDelta(
  database: postgres.Sql,
  policyId: string,
): Promise<{ policyId: string; policyNumber: string; brokerId: string } | null> {
  const [row] = await database<{ id: string; policy_number: string; broker_id: string }[]>`
    select id, policy_number, broker_id from policies where id = ${policyId}
  `;
  return row ? { policyId: row.id, policyNumber: row.policy_number, brokerId: row.broker_id } : null;
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
