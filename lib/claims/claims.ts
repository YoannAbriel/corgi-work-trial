import type postgres from "postgres";
import { sql } from "@/db/client";
import type { UserRole } from "@/lib/auth/current-user";
import { claimReserveAdjustedEntry, claimReserveSetEntry, type ClaimEntryContext } from "@/lib/ledger/claim-entries";
import { postJournalEntry } from "@/lib/ledger/post";
import { centsFromDatabase } from "@/lib/money/cents";
import { foldPolicyEvents } from "@/lib/policy/current";
import { claimCoverageRefusal, coveredPeriod, type CoveredPeriod } from "./coverage";
import { claimMoneyPosition, reserveAdjustmentDeltaCents, type ClaimMoneyEvent, type ClaimMoneyPosition } from "./money-position";

// Opening a claim and moving its reserve. The payments themselves are in lib/claims/payments.ts;
// what they share (the lock, the snapshot) is here.
//
// The reading path for this slice, in order:
//   1. lib/claims/money-position.ts   what a claim's reserve, paid and incurred mean
//   2. this file                       opening a claim, setting and adjusting the reserve
//   3. lib/claims/limits.ts            the three ceilings a payment must clear
//   4. lib/claims/payments.ts          asking to pay, sending, settling, returning
//   5. lib/approvals/*                 the second human above $1,000
//   6. lib/rails/*                     the two LOCAL SIMULATORs

// A refusal a person can act on: wrong actor, wrong date, no reserve, past a limit. It becomes
// a message on the page, never a 500.
export class ClaimRefused extends Error {}

export type ClaimActor = { userId: string; role: UserRole };

// Every money action on a claim is staff operations' to take. A broker sees the claims of their
// own policies (the policy page) and can neither open one nor move a cent, and staff_approver
// is deliberately not allowed to act either: the approver's only job is to approve, and letting
// the checker also be the maker would empty maker-checker of its meaning.
export function assertClaimsOperator(actor: ClaimActor): void {
  if (actor.role !== "staff_ops") {
    throw new ClaimRefused(
      `only staff operations can act on a claim; your role is "${actor.role}"`,
    );
  }
}

// The two scheduled jobs (settling due payouts, recovering stuck operations) act on claims with
// no user behind them: they only ever finish work a person already asked for, and their HTTP
// entry points are authenticated by CRON_SECRET (lib/jobs/authorize.ts). They say so explicitly
// instead of passing no actor at all, so that a future caller cannot forget to be checked
// (review findings F-B7-05 and F-B7-10).
export const SCHEDULED_JOB = "scheduled_job";

export type ClaimActorOrJob = ClaimActor | typeof SCHEDULED_JOB;

export function assertClaimsOperatorOrJob(actor: ClaimActorOrJob): void {
  if (actor !== SCHEDULED_JOB) {
    assertClaimsOperator(actor);
  }
}

// The user id recorded on the rows an action writes, or null when the scheduled job wrote them.
export function actorUserId(actor: ClaimActorOrJob): string | null {
  return actor === SCHEDULED_JOB ? null : actor.userId;
}

// ---------------------------------------------------------------------------
// The lock every money decision on a claim takes first
// ---------------------------------------------------------------------------

// Two staff members asking to pay the same claim at the same moment must not both pass the
// limit checks (design finding F-21). One of them has to wait for the other to finish and then
// see what the first one wrote.
//
// WHY THIS IS AN ADVISORY LOCK AND NOT `select ... from claims for update`, which is what the
// design asks for: PostgreSQL requires the UPDATE privilege on a table to take a row lock on it
// ("The FOR UPDATE ... clauses require UPDATE privilege as well", SELECT reference), and the
// runtime role has SELECT and INSERT only on every protected table, on purpose (AF-03).
// Measured on corgi_test on 2026-09-08: `select id from policies limit 1 for update` as
// app_runtime fails with "permission denied for table policies". Granting UPDATE on a money
// table just to be able to lock it would weaken the guard this whole build rests on.
//
// A transaction-scoped advisory lock gives the same serialisation and needs no privilege. It is
// released when the transaction ends, whether it commits, rolls back or the connection dies, so
// it cannot be left held. The key is a 64-bit hash of the claim id: two different claims could
// in principle hash to the same key, and the only consequence would be that those two claims
// wait for each other, which costs a few milliseconds and breaks nothing.
export async function lockClaimForMoneyDecision(
  transaction: postgres.TransactionSql,
  claimId: string,
): Promise<void> {
  await transaction`select pg_advisory_xact_lock(hashtextextended(${claimId}, 0))`;
}

// ---------------------------------------------------------------------------
// Opening a claim
// ---------------------------------------------------------------------------

export type OpenClaimRequest = {
  policyId: string;
  occurredAt: string; // the day the loss happened
  reportedAt: string; // the day it reached us
  description: string;
  claimantName: string;
  actor: ClaimActor;
};

export async function openClaim(
  request: OpenClaimRequest,
  database: postgres.Sql = sql,
): Promise<{ claimId: string; claimNumber: string }> {
  assertClaimsOperator(request.actor);

  if (request.description.trim().length === 0) {
    throw new ClaimRefused("a claim needs a description of the loss");
  }
  if (request.claimantName.trim().length === 0) {
    throw new ClaimRefused("a claim needs the name of the claimant: it is what the bank check compares");
  }

  const coverage = await policyCoverage(database, request.policyId);
  if (!coverage) {
    throw new ClaimRefused("this policy does not exist");
  }
  if (!coverage.wasBound) {
    throw new ClaimRefused("this policy was never bound, so it never covered anything");
  }
  const refusal = claimCoverageRefusal({
    occurredAt: request.occurredAt,
    reportedAt: request.reportedAt,
    period: coverage.period,
  });
  if (refusal) {
    throw new ClaimRefused(refusal);
  }

  const [claim] = await database<{ id: string; claim_number: string }[]>`
    insert into claims (policy_id, occurred_at, reported_at, description, claimant_name, created_by)
    values (${request.policyId}, ${request.occurredAt}, ${request.reportedAt},
            ${request.description.trim()}, ${request.claimantName.trim()}, ${request.actor.userId})
    returning id, claim_number
  `;
  return { claimId: claim.id, claimNumber: claim.claim_number };
}

// The window during which this policy covered anything, and whether it ever did. A cancelled
// policy still covers everything up to its cancellation date, which is why a claim can be
// opened on one.
export async function policyCoverage(
  database: postgres.Sql | postgres.TransactionSql,
  policyId: string,
): Promise<{ wasBound: boolean; period: CoveredPeriod } | null> {
  const [policy] = await database<{ id: string }[]>`select id from policies where id = ${policyId}`;
  if (!policy) {
    return null;
  }
  const { eventTypes, terms } = await foldPolicyEvents(database, policyId);
  const [cancellation] = await database<{ effective_at: string }[]>`
    select to_char(effective_at, 'YYYY-MM-DD') as effective_at
      from policy_events where policy_id = ${policyId} and event_type = 'cancelled'
  `;
  return {
    wasBound: eventTypes.includes("issued"),
    period: coveredPeriod({
      termStart: terms.termStart,
      termEnd: terms.termEnd,
      cancelledEffectiveAt: cancellation?.effective_at ?? null,
    }),
  };
}

// ---------------------------------------------------------------------------
// The snapshot every money decision reads
// ---------------------------------------------------------------------------

export type ClaimSnapshot = {
  claimId: string;
  claimNumber: string;
  claimantName: string;
  occurredAt: string;
  reportedAt: string;
  policyId: string;
  policyNumber: string;
  brokerId: string;
  perOccurrenceLimitCents: number;
  aggregateLimitCents: number;
  position: ClaimMoneyPosition;
  // Asked for and not yet sent, on this claim. It has moved no money and has not touched the
  // reserve, but it holds its place against every ceiling until it is sent or refused.
  pendingCents: number;
  // Paid plus pending across EVERY claim of this policy: what the aggregate limit is measured
  // against.
  policyCommittedCents: number;
};

// Reads everything a payment or a reserve change has to decide on, from the events and the
// policy fold, never from a cache. Call it INSIDE the transaction that took the claim lock.
export async function claimSnapshot(
  database: postgres.Sql | postgres.TransactionSql,
  claimId: string,
): Promise<ClaimSnapshot | null> {
  const [row] = await database<
    {
      id: string;
      claim_number: string;
      claimant_name: string;
      occurred_at: string;
      reported_at: string;
      policy_id: string;
      policy_number: string;
      broker_id: string;
    }[]
  >`
    select claim.id,
           claim.claim_number,
           claim.claimant_name,
           to_char(claim.occurred_at, 'YYYY-MM-DD') as occurred_at,
           to_char(claim.reported_at, 'YYYY-MM-DD') as reported_at,
           policy.id            as policy_id,
           policy.policy_number as policy_number,
           policy.broker_id     as broker_id
      from claims claim
      join policies policy on policy.id = claim.policy_id
     where claim.id = ${claimId}
  `;
  if (!row) {
    return null;
  }

  const { terms } = await foldPolicyEvents(database, row.policy_id);
  const events = await claimMoneyEvents(database, claimId);

  return {
    claimId: row.id,
    claimNumber: row.claim_number,
    claimantName: row.claimant_name,
    occurredAt: row.occurred_at,
    reportedAt: row.reported_at,
    policyId: row.policy_id,
    policyNumber: row.policy_number,
    brokerId: row.broker_id,
    perOccurrenceLimitCents: terms.perOccurrenceLimitCents,
    aggregateLimitCents: terms.aggregateLimitCents,
    position: claimMoneyPosition(events),
    pendingCents: await pendingPaymentCents(database, { claimId }),
    policyCommittedCents:
      (await paidCentsOfPolicy(database, row.policy_id)) +
      (await pendingPaymentCents(database, { policyId: row.policy_id })),
  };
}

export async function claimMoneyEvents(
  database: postgres.Sql | postgres.TransactionSql,
  claimId: string,
): Promise<ClaimMoneyEvent[]> {
  const rows = await database<{ event_type: string; amount_cents: string | null }[]>`
    select event_type, amount_cents
      from claim_events where claim_id = ${claimId}
     order by sequence_number
  `;
  return rows.map((row) => ({
    eventType: row.event_type as ClaimMoneyEvent["eventType"],
    amountCents: row.amount_cents === null ? null : centsFromDatabase(row.amount_cents, "amount_cents"),
  }));
}

// A claim payout is pending from the moment it is asked for until it is either sent on the rail
// or marked failed (which is what a rejected approval does). Scoped to one claim or to a whole
// policy, because the per-occurrence and aggregate ceilings need both.
async function pendingPaymentCents(
  database: postgres.Sql | postgres.TransactionSql,
  scope: { claimId: string } | { policyId: string },
): Promise<number> {
  const [row] = await database<{ pending_cents: string }[]>`
    select coalesce(sum(operation.amount_cents), 0)::text as pending_cents
      from money_operations operation
      join claims claim on claim.id = operation.claim_id
     where operation.kind = 'claim_payout'
       and ${"claimId" in scope ? database`claim.id = ${scope.claimId}` : database`claim.policy_id = ${scope.policyId}`}
       and not exists (
             select 1 from claim_events event
              where event.money_operation_id = operation.id and event.event_type = 'payment_sent'
           )
       and not exists (
             select 1 from money_operation_events lifecycle
              where lifecycle.operation_id = operation.id and lifecycle.status = 'failed'
           )
  `;
  return centsFromDatabase(row.pending_cents, "pending_cents");
}

// Sent and not returned, across every claim of one policy.
async function paidCentsOfPolicy(
  database: postgres.Sql | postgres.TransactionSql,
  policyId: string,
): Promise<number> {
  const [row] = await database<{ paid_cents: string }[]>`
    select coalesce(sum(
             case event.event_type
               when 'payment_sent'     then event.amount_cents
               when 'payment_returned' then -event.amount_cents
               else 0
             end), 0)::text as paid_cents
      from claim_events event
      join claims claim on claim.id = event.claim_id
     where claim.policy_id = ${policyId}
  `;
  return centsFromDatabase(row.paid_cents, "paid_cents");
}

// The header every claim journal entry carries.
export function entryContext(
  snapshot: ClaimSnapshot,
  claimEventId: string,
  effectiveAt: string,
  createdBy: string | null,
): ClaimEntryContext {
  return {
    claimEventId,
    claimId: snapshot.claimId,
    claimNumber: snapshot.claimNumber,
    policyId: snapshot.policyId,
    brokerId: snapshot.brokerId,
    effectiveAt,
    createdBy,
  };
}

// Today in UTC, as a calendar date. Claim entries are booked on the day the decision is taken;
// the settlement and return entries carry the date the rail reports instead.
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Setting and adjusting the reserve
// ---------------------------------------------------------------------------

export type SetReserveRequest = {
  claimId: string;
  newReserveCents: number; // the OUTSTANDING reserve from now on, not the change
  note: string | null;
  actor: ClaimActor;
};

// Every reserve decision is one append-only claim event plus, when the estimate actually moves,
// one journal entry for the difference. The reserve is never rewritten: setting it to $4,000
// after $5,000 books a $1,000 reduction and both facts stay readable.
export async function setClaimReserve(
  request: SetReserveRequest,
  database: postgres.Sql = sql,
): Promise<{ claimEventId: string; deltaCents: number }> {
  assertClaimsOperator(request.actor);
  if (!Number.isSafeInteger(request.newReserveCents) || request.newReserveCents < 0) {
    throw new ClaimRefused("a reserve must be a whole amount of dollars and cents, and cannot be negative");
  }

  return database.begin(async (transaction) => {
    await lockClaimForMoneyDecision(transaction, request.claimId);

    const snapshot = await claimSnapshot(transaction, request.claimId);
    if (!snapshot) {
      throw new ClaimRefused("this claim does not exist");
    }
    if (snapshot.position.isClosed) {
      throw new ClaimRefused("this claim is closed; its reserve can no longer be moved");
    }
    // A payment that has been asked for is going to come out of this reserve, so the reserve
    // cannot be taken below it. Refuse the payment first, then lower the reserve.
    if (request.newReserveCents < snapshot.pendingCents) {
      throw new ClaimRefused(
        `${snapshot.pendingCents} cents of payments are already waiting to be paid out of this reserve, so it cannot be set below that`,
      );
    }

    const isFirstReserve = !snapshot.position.hasReserve;
    const deltaCents = reserveAdjustmentDeltaCents(snapshot.position.reserveCents, request.newReserveCents);
    if (isFirstReserve && request.newReserveCents === 0) {
      throw new ClaimRefused("the first reserve on a claim has to be an amount: use an adjustment to bring it back to zero");
    }

    const [claimEvent] = await transaction<{ id: string }[]>`
      insert into claim_events (claim_id, event_type, amount_cents, payload, created_by)
      values (${request.claimId}, ${isFirstReserve ? "reserve_set" : "reserve_adjusted"},
              ${request.newReserveCents},
              ${transaction.json({
                previous_reserve_cents: snapshot.position.reserveCents,
                delta_cents: deltaCents,
                note: request.note ?? undefined,
              })},
              ${request.actor.userId})
      returning id
    `;

    // An adjustment that changes nothing is recorded (the adjuster looked and confirmed) but
    // posts no entry: an entry for zero cents would be an entry with no meaning.
    if (deltaCents !== 0) {
      const context = entryContext(snapshot, claimEvent.id, todayUtc(), request.actor.userId);
      const entry = isFirstReserve
        ? claimReserveSetEntry(context, request.newReserveCents)
        : claimReserveAdjustedEntry(context, deltaCents);
      await postJournalEntry(transaction, entry.header, entry.lines);
    }

    return { claimEventId: claimEvent.id, deltaCents };
  });
}

// ---------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------

// A claim closes when nothing is left to pay: no reserve outstanding and no payment in flight.
// Closing does not zero the reserve on the operator's behalf, because releasing a reserve is a
// money decision and money decisions are taken deliberately, one at a time.
export async function closeClaim(
  request: { claimId: string; note: string | null; actor: ClaimActor },
  database: postgres.Sql = sql,
): Promise<void> {
  assertClaimsOperator(request.actor);

  await database.begin(async (transaction) => {
    await lockClaimForMoneyDecision(transaction, request.claimId);
    const snapshot = await claimSnapshot(transaction, request.claimId);
    if (!snapshot) {
      throw new ClaimRefused("this claim does not exist");
    }
    if (snapshot.position.isClosed) {
      throw new ClaimRefused("this claim is already closed");
    }
    if (snapshot.pendingCents > 0) {
      throw new ClaimRefused("a payment is still waiting on this claim; deal with it before closing");
    }
    if (snapshot.position.reserveCents > 0) {
      throw new ClaimRefused(
        `this claim still holds ${snapshot.position.reserveCents} cents of reserve; adjust the reserve to zero first, so the release is recorded as its own decision`,
      );
    }
    if (snapshot.position.paidCents !== snapshot.position.settledCents) {
      throw new ClaimRefused("a payment has left the reserve but the rail has not confirmed it yet");
    }

    await transaction`
      insert into claim_events (claim_id, event_type, payload, created_by)
      values (${request.claimId}, 'closed', ${transaction.json({ note: request.note ?? undefined })}, ${request.actor.userId})
    `;
  });
}
