import type postgres from "postgres";

// The single place that writes into the journal. Every money entry in the application goes
// through this function, inside a transaction opened by the caller, so a posting either lands
// completely or not at all.
//
// The database keeps the invariants, not this code:
//   - a deferred trigger refuses at commit any entry whose debits differ from its credits,
//     and any entry with no lines (migration 0001);
//   - a unique index on (source_kind, source_id, entry_type) refuses a second entry of the
//     same type for the same business operation, which is how a replayed webhook posts once;
//   - an UPDATE or DELETE trigger refuses every later change (AF-03).

export type JournalEntryHeader = {
  entryType: string; // 'premium_written', 'premium_collected', ...
  effectiveAt: string; // business date, "YYYY-MM-DD"
  policyId: string | null;
  brokerId: string | null;
  // Optional because most entries have no claim; the claim entries of slice B7 set it so that a
  // claim's ledger can be read on its own (lib/ledger/claim-entries.ts).
  claimId?: string | null;
  sourceKind: "money_operation" | "policy_event" | "claim_event" | "correction" | "statement_run";
  sourceId: string;
  createdBy: string | null; // user id when a human caused it, null for provider events
  description: string;
};

// Exactly one side of a line is positive; the database rejects any other shape.
export type JournalLineDraft = {
  accountId: string;
  debitCents?: number;
  creditCents?: number;
};

export type JournalEntryDraft = {
  header: JournalEntryHeader;
  lines: JournalLineDraft[];
};

// Inserts one header and its lines. Returns the new entry id.
// Throws a unique-violation error (Postgres 23505) when this source already posted this entry
// type: the caller decides whether that means "already done" (a replay) or a real conflict.
export async function postJournalEntry(
  transaction: postgres.TransactionSql,
  header: JournalEntryHeader,
  lines: JournalLineDraft[],
): Promise<string> {
  if (lines.length === 0) {
    throw new Error(`journal entry ${header.entryType} has no lines`);
  }

  const [entry] = await transaction<{ id: string }[]>`
    insert into journal_entries
      (entry_type, effective_at, policy_id, claim_id, broker_id, source_kind, source_id, created_by, description)
    values
      (${header.entryType}, ${header.effectiveAt}, ${header.policyId}, ${header.claimId ?? null},
       ${header.brokerId}, ${header.sourceKind}, ${header.sourceId}, ${header.createdBy}, ${header.description})
    returning id
  `;

  for (const line of lines) {
    await transaction`
      insert into journal_lines (entry_id, account_id, debit_cents, credit_cents)
      values (${entry.id}, ${line.accountId}, ${line.debitCents ?? 0}, ${line.creditCents ?? 0})
    `;
  }

  return entry.id;
}

// True when the error is Postgres' unique-violation. Used to turn "this entry already exists"
// into a successful replay instead of a 500 that would make the provider retry forever.
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}
