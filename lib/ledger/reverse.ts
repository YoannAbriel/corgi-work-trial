import type postgres from "postgres";
import type { JournalLineDraft } from "./post";

// Reversal of a journal entry: the only way to undo money in this ledger (AF-03).
//
// The original entry is never touched. A new entry is posted whose lines are the mirror image
// of the original (every debit becomes a credit of the same amount on the same account, and
// the other way round), with the SAME effective date, so that any as-of view after that date
// nets the two to zero, while any view of "what was known before the correction" still shows
// the original. reverses_entry_id links the two and is unique: an entry can be reversed once.

// The name of a reversal entry is the name of the entry it undoes, behind this prefix. The
// broker statement strips it to land a reversal on the same line kind as the original with the
// opposite amount (lib/statements/compute.ts), and lib/statements/entry-types.test.ts enumerates
// every builder's types through it, so the prefix is written once and read from here.
export const REVERSAL_ENTRY_TYPE_PREFIX = "reversal_of_";

export type JournalLineRecord = { account_id: string; debit_cents: string; credit_cents: string };

// Pure: the mirrored lines of an original entry. Amounts arrive as text from the driver
// (bigint columns) and are converted without ever touching a float.
export function mirroredLines(originalLines: JournalLineRecord[]): JournalLineDraft[] {
  return originalLines.map((line) => {
    const debit = Number(line.debit_cents);
    const credit = Number(line.credit_cents);
    if (!Number.isInteger(debit) || !Number.isInteger(credit)) {
      throw new Error(`journal line on ${line.account_id} does not hold integer cents`);
    }
    return debit > 0 ? { accountId: line.account_id, creditCents: debit } : { accountId: line.account_id, debitCents: credit };
  });
}

export type ReversalRequest = {
  originalEntryId: string;
  correctionEventId: string; // the policy event that explains the reversal; source of the new entry
  createdBy: string | null; // user id of the human who ordered the correction
  description: string; // the business reason, shown on the ledger
};

// Posts the reversal of one entry inside the caller's transaction and returns the new entry id.
// Fails (unique reverses_entry_id) if the original was already reversed.
export async function reverseJournalEntry(
  transaction: postgres.TransactionSql,
  request: ReversalRequest,
): Promise<string> {
  const [original] = await transaction<
    { id: string; entry_type: string; effective_at: Date; policy_id: string | null; broker_id: string | null }[]
  >`
    select id, entry_type, effective_at, policy_id, broker_id from journal_entries where id = ${request.originalEntryId}
  `;
  if (!original) {
    throw new Error(`journal entry ${request.originalEntryId} does not exist`);
  }
  const originalLines = await transaction<JournalLineRecord[]>`
    select account_id, debit_cents::text, credit_cents::text from journal_lines where entry_id = ${original.id} order by id
  `;
  const effectiveAt = original.effective_at.toISOString().slice(0, 10);

  const [reversal] = await transaction<{ id: string }[]>`
    insert into journal_entries
      (entry_type, effective_at, policy_id, broker_id, source_kind, source_id, reverses_entry_id, created_by, description)
    values
      (${REVERSAL_ENTRY_TYPE_PREFIX + original.entry_type}, ${effectiveAt}, ${original.policy_id}, ${original.broker_id},
       'correction', ${request.correctionEventId}, ${original.id}, ${request.createdBy}, ${request.description})
    returning id
  `;
  for (const line of mirroredLines(originalLines)) {
    await transaction`
      insert into journal_lines (entry_id, account_id, debit_cents, credit_cents)
      values (${reversal.id}, ${line.accountId}, ${line.debitCents ?? 0}, ${line.creditCents ?? 0})
    `;
  }
  return reversal.id;
}
