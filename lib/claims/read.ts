import type postgres from "postgres";
import { sql } from "@/db/client";
import { centsFromDatabase } from "@/lib/money/cents";
import { claimMoneyPosition, type ClaimMoneyEvent, type ClaimMoneyPosition } from "./money-position";

// Every read the claim screens need. Nothing here decides anything: the money rules live in
// lib/claims/claims.ts and lib/claims/payments.ts, and every figure below is folded from
// claim_events by the same function the money paths use, so a screen can never show a reserve
// the ledger does not agree with.

type Queryable = postgres.Sql | postgres.TransactionSql;

export type ClaimListRow = {
  claimId: string;
  claimNumber: string;
  policyId: string;
  policyNumber: string;
  claimantName: string;
  occurredAt: string;
  reportedAt: string;
  description: string;
  position: ClaimMoneyPosition;
};

// The claims of one policy, or of every policy when policyId is null, each with its money
// position. Two queries whatever the number of claims: one for the claims, one for all their
// events, folded in memory.
export async function claimsWithPositions(
  database: Queryable,
  policyId: string | null,
): Promise<ClaimListRow[]> {
  const claims = await database<
    {
      id: string;
      claim_number: string;
      policy_id: string;
      policy_number: string;
      claimant_name: string;
      occurred_at: string;
      reported_at: string;
      description: string;
    }[]
  >`
    select claim.id,
           claim.claim_number,
           claim.policy_id,
           policy.policy_number,
           claim.claimant_name,
           to_char(claim.occurred_at, 'YYYY-MM-DD') as occurred_at,
           to_char(claim.reported_at, 'YYYY-MM-DD') as reported_at,
           claim.description
      from claims claim
      join policies policy on policy.id = claim.policy_id
     where ${policyId === null ? database`true` : database`claim.policy_id = ${policyId}`}
     order by claim.recorded_at desc
  `;
  if (claims.length === 0) {
    return [];
  }

  const events = await database<{ claim_id: string; event_type: string; amount_cents: string | null }[]>`
    select event.claim_id, event.event_type, event.amount_cents
      from claim_events event
      join claims claim on claim.id = event.claim_id
     where ${policyId === null ? database`true` : database`claim.policy_id = ${policyId}`}
     order by event.sequence_number
  `;

  const eventsByClaim = new Map<string, ClaimMoneyEvent[]>();
  for (const event of events) {
    const list = eventsByClaim.get(event.claim_id) ?? [];
    list.push({
      eventType: event.event_type as ClaimMoneyEvent["eventType"],
      amountCents: event.amount_cents === null ? null : centsFromDatabase(event.amount_cents, "amount_cents"),
    });
    eventsByClaim.set(event.claim_id, list);
  }

  return claims.map((claim) => ({
    claimId: claim.id,
    claimNumber: claim.claim_number,
    policyId: claim.policy_id,
    policyNumber: claim.policy_number,
    claimantName: claim.claimant_name,
    occurredAt: claim.occurred_at,
    reportedAt: claim.reported_at,
    description: claim.description,
    position: claimMoneyPosition(eventsByClaim.get(claim.id) ?? []),
  }));
}

// The claims of a policy that are still open, with what they hold. This is what a cancellation
// screen shows: an open claim does not stop a cancellation and does not change the refund, and
// saying so with the actual figures is the whole point (see assertCancellationAllowed in
// lib/policy/cancel.ts).
export async function openClaimsOfPolicy(
  database: Queryable,
  policyId: string,
): Promise<ClaimListRow[]> {
  const claims = await claimsWithPositions(database, policyId);
  return claims.filter((claim) => !claim.position.isClosed);
}

// The reserve history of one claim: every decision, what it changed, and who took it.
export type ReserveHistoryRow = {
  claimEventId: string;
  eventType: "reserve_set" | "reserve_adjusted";
  newReserveCents: number;
  previousReserveCents: number;
  deltaCents: number;
  note: string | null;
  recordedAt: Date;
  recordedByName: string | null;
};

export async function reserveHistory(database: Queryable, claimId: string): Promise<ReserveHistoryRow[]> {
  const rows = await database<
    {
      id: string;
      event_type: string;
      amount_cents: string;
      payload: { previous_reserve_cents?: number; delta_cents?: number; note?: string };
      recorded_at: Date;
      recorded_by_name: string | null;
    }[]
  >`
    select event.id, event.event_type, event.amount_cents, event.payload, event.recorded_at,
           author.display_name as recorded_by_name
      from claim_events event
      left join users author on author.id::text = event.created_by
     where event.claim_id = ${claimId}
       and event.event_type in ('reserve_set', 'reserve_adjusted')
     order by event.sequence_number
  `;
  return rows.map((row) => ({
    claimEventId: row.id,
    eventType: row.event_type as "reserve_set" | "reserve_adjusted",
    newReserveCents: centsFromDatabase(row.amount_cents, "amount_cents"),
    previousReserveCents: Number(row.payload?.previous_reserve_cents ?? 0),
    deltaCents: Number(row.payload?.delta_cents ?? 0),
    note: row.payload?.note ?? null,
    recordedAt: row.recorded_at,
    recordedByName: row.recorded_by_name,
  }));
}

// The journal entries of one claim, in booking order, exactly as the policy page shows a
// policy's entries. Reading them next to the reserve history is how an operator checks that the
// screen and the ledger say the same thing.
export type ClaimJournalLine = { accountId: string; accountName: string; debitCents: number; creditCents: number };
export type ClaimJournalEntry = {
  entryId: string;
  entryType: string;
  effectiveAt: string;
  recordedAt: Date;
  description: string;
  lines: ClaimJournalLine[];
};

export async function journalEntriesOfClaim(database: Queryable, claimId: string): Promise<ClaimJournalEntry[]> {
  const rows = await database<
    {
      entry_id: string;
      entry_type: string;
      effective_at: string;
      recorded_at: Date;
      description: string;
      line_id: string;
      account_id: string;
      account_name: string;
      debit_cents: string;
      credit_cents: string;
    }[]
  >`
    select entry.id as entry_id,
           entry.entry_type,
           to_char(entry.effective_at, 'YYYY-MM-DD') as effective_at,
           entry.recorded_at,
           entry.description,
           line.id as line_id,
           line.account_id,
           account.name as account_name,
           line.debit_cents,
           line.credit_cents
      from journal_entries entry
      join journal_lines line on line.entry_id = entry.id
      join accounts account   on account.id = line.account_id
     where entry.claim_id = ${claimId}
     order by entry.recorded_at, entry.id, line.id
  `;

  const entries: ClaimJournalEntry[] = [];
  for (const row of rows) {
    let entry = entries.find((candidate) => candidate.entryId === row.entry_id);
    if (!entry) {
      entry = {
        entryId: row.entry_id,
        entryType: row.entry_type,
        effectiveAt: row.effective_at,
        recordedAt: row.recorded_at,
        description: row.description,
        lines: [],
      };
      entries.push(entry);
    }
    entry.lines.push({
      accountId: row.account_id,
      accountName: row.account_name,
      debitCents: centsFromDatabase(row.debit_cents, "debit_cents"),
      creditCents: centsFromDatabase(row.credit_cents, "credit_cents"),
    });
  }
  return entries;
}

// The one read the claim screen needs before it can show anything: does this claim exist, and
// which policy does it belong to (so the page can check who is allowed to see it).
export async function claimHeader(
  claimId: string,
  database: Queryable = sql,
): Promise<{ claimId: string; claimNumber: string; policyId: string; brokerId: string } | null> {
  const [row] = await database<{ id: string; claim_number: string; policy_id: string; broker_id: string }[]>`
    select claim.id, claim.claim_number, claim.policy_id, policy.broker_id
      from claims claim
      join policies policy on policy.id = claim.policy_id
     where claim.id = ${claimId}
  `;
  return row
    ? { claimId: row.id, claimNumber: row.claim_number, policyId: row.policy_id, brokerId: row.broker_id }
    : null;
}
