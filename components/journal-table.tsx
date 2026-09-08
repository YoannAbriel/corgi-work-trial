import { formatCentsAsUsd } from "@/lib/money/cents";

// The journal of one thing (a policy, a claim, a correction), read straight from the entries
// and their lines. Each entry is a small block: a header row with the entry type, its effective
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
    <>
      <div className="table-scroll" role="region" aria-label={ariaLabel} tabIndex={0}>
        <table className="journal">
          <thead>
            <tr>
              <th>Entry</th>
              <th>Effective</th>
              <th>Recorded (UTC)</th>
              <th>Account</th>
              <th className="amount">Debit</th>
              <th className="amount">Credit</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((entry) => (
              <EntryRows key={entry.entryId} entry={entry} />
            ))}
          </tbody>
        </table>
      </div>
      {folded.length > 0 ? (
        <details className="show-all">
          <summary>
            Show all {entries.length} entries ({folded.length} older)
          </summary>
          <div className="table-scroll" role="region" aria-label={`${ariaLabel}, older entries`} tabIndex={0}>
            <table className="journal">
              <tbody>
                {folded.map((entry) => (
                  <EntryRows key={entry.entryId} entry={entry} />
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </>
  );
}

// The colour of an entry says which way the money went, nothing more: in, out, or a reversal.
function toneOf(entryType: string): "in" | "out" | "reversal" | "neutral" {
  if (entryType.startsWith("reversal") || entryType.includes("reversed")) return "reversal";
  if (/collected|received|earned|cash_received|applied|written|billed/.test(entryType)) return "in";
  if (/refund|clawback|paid|payable|sent|returned|payout/.test(entryType)) return "out";
  return "neutral";
}

function EntryRows({ entry }: { entry: JournalEntryForTable }) {
  const tone = toneOf(entry.entryType);
  return (
    <>
      {entry.lines.map((line, index) => (
        <tr key={`${entry.entryId}-${line.accountId}-${index}`} className={index === 0 ? "entry-first" : "entry-line"}>
          {index === 0 ? (
            <>
              <td rowSpan={entry.lines.length}>
                <span className={`entry-tag entry-${tone}`}>{entry.entryType}</span>
                {entry.reversesEntryId ? (
                  <>
                    <br />
                    <span className="note">reverses {entry.reversesEntryId.slice(0, 8)}</span>
                  </>
                ) : null}
              </td>
              <td rowSpan={entry.lines.length}>{entry.effectiveAt}</td>
              <td rowSpan={entry.lines.length} className="note">
                {entry.recordedAt.toISOString().replace("T", " ").slice(0, 19)}
              </td>
            </>
          ) : null}
          <td className={line.debitCents > 0 ? "account-debit" : "account-credit"}>{line.accountName}</td>
          <td className="amount debit">{line.debitCents > 0 ? formatCentsAsUsd(line.debitCents) : ""}</td>
          <td className="amount credit">{line.creditCents > 0 ? formatCentsAsUsd(line.creditCents) : ""}</td>
        </tr>
      ))}
    </>
  );
}
