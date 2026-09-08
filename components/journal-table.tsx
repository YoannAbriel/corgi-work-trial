import { formatCentsAsUsd } from "@/lib/money/cents";

// The journal of one thing (a policy, a claim, a correction), read straight from the entries
// and their lines. Each entry is one block: a header line with the entry type, its effective
// date and the instant it was recorded, then one row per line with the account, the debit and
// the credit. Every entry balances by construction (a database constraint), so a reader can add
// each block up.
//
// The most recent entries come first, and only the latest few are shown until "show all" is
// opened: a native <details>, no JavaScript of ours, all rows in the HTML for a reviewer.
// Nothing here is computed: the cents arrive from the database and are only formatted.

export type JournalEntryForTable = {
  entryId: string;
  entryType: string;
  effectiveAt: string;
  recordedAt: Date;
  reversesEntryId?: string | null;
  lines: { accountId: string; accountName: string; debitCents: number; creditCents: number }[];
};

export function JournalTable({
  entries,
  visibleEntries = 4,
  ariaLabel = "Journal",
}: {
  entries: JournalEntryForTable[];
  visibleEntries?: number;
  ariaLabel?: string;
}) {
  // Newest first: the last thing that happened is what the reader is looking for.
  const newestFirst = [...entries].sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime());
  const shown = newestFirst.slice(0, visibleEntries);
  const folded = newestFirst.slice(visibleEntries);

  return (
    <div className="journal" role="region" aria-label={ariaLabel}>
      <div className="entry-columns" aria-hidden="true">
        <span>Account</span>
        <span>Debit</span>
        <span>Credit</span>
      </div>
      <div className="journal-list">
        {shown.map((entry) => (
          <EntryBlock key={entry.entryId} entry={entry} />
        ))}
      </div>
      {folded.length > 0 ? (
        <details className="show-all">
          <summary>
            Show all {entries.length} entries ({folded.length} older)
          </summary>
          <div className="journal-list">
            {folded.map((entry) => (
              <EntryBlock key={entry.entryId} entry={entry} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

// The colour of an entry says which way the money went, nothing more: in, out, or a reversal.
function toneOf(entryType: string): "in" | "out" | "reversal" | "neutral" {
  if (entryType.startsWith("reversal") || entryType.includes("reversed")) return "reversal";
  if (/collected|received|earned|cash_received|applied|written|billed/.test(entryType)) return "in";
  if (/refund|clawback|paid|payable|sent|returned|payout/.test(entryType)) return "out";
  return "neutral";
}

function EntryBlock({ entry }: { entry: JournalEntryForTable }) {
  const tone = toneOf(entry.entryType);
  const recorded = entry.recordedAt.toISOString().replace("T", " ").slice(0, 19);
  return (
    <div className="entry-block">
      <div className="entry-head">
        <span className={`entry-tag entry-${tone}`}>{entry.entryType}</span>
        <span className="entry-when">
          effective <b>{entry.effectiveAt}</b> · recorded {recorded} UTC
        </span>
        {entry.reversesEntryId ? <span className="entry-when">reverses {entry.reversesEntryId.slice(0, 8)}</span> : null}
      </div>
      <table className="entry-lines">
        <colgroup>
          <col />
          <col className="amount-column" />
          <col className="amount-column" />
        </colgroup>
        <tbody>
          {entry.lines.map((line, index) => (
            <tr key={`${entry.entryId}-${line.accountId}-${index}`}>
              <td className={line.debitCents > 0 ? "account" : "account credit-side"}>{line.accountName}</td>
              <td className="amount debit">{line.debitCents > 0 ? formatCentsAsUsd(line.debitCents) : ""}</td>
              <td className="amount credit">{line.creditCents > 0 ? formatCentsAsUsd(line.creditCents) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
