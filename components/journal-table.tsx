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
  panelKey,
  visibleEntries = 4,
  ariaLabel = "Journal",
}: {
  entries: JournalEntryForTable[];
  // Which panel this table is: it goes into the id of every block, so two panels printing the same
  // entry cannot produce the same id. Required, so no new panel can forget it.
  panelKey: string;
  visibleEntries?: number;
  ariaLabel?: string;
}) {
  // Newest first: the last thing that happened is what the reader is looking for.
  const newestFirst = [...entries].sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime());
  const shown = newestFirst.slice(0, visibleEntries);
  const folded = newestFirst.slice(visibleEntries);

  return (
    <div className="journal" role="region" aria-label={ariaLabel}>
      <div className="journal-list">
        {shown.map((entry) => (
          <EntryBlock key={entry.entryId} entry={entry} panelKey={panelKey} />
        ))}
      </div>
      {folded.length > 0 ? (
        <details className="show-all">
          <summary>
            Show all {entries.length} entries ({folded.length} older)
          </summary>
          <div className="journal-list">
            {folded.map((entry) => (
              <EntryBlock key={entry.entryId} entry={entry} panelKey={panelKey} />
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

// The id an "explain this amount" fold points at (slice B12-4, YOA-637): the panel the block is
// rendered in, then the entry id the ledger gave the entry. The panel is part of the id because a
// page can print the SAME entry twice (review finding F-B12-18): the policy page shows a
// correction's entries in the corrections panel and again in the journal panel, which produced two
// elements with one id and an anchor that landed on whichever came first. It is only an anchor;
// nothing on the page reads money out of it.
export function journalEntryElementId(panelKey: string, entryId: string): string {
  return `journal-entry-${panelKey}-${entryId}`;
}

function EntryBlock({ entry, panelKey }: { entry: JournalEntryForTable; panelKey: string }) {
  const tone = toneOf(entry.entryType);
  const recorded = entry.recordedAt.toISOString().replace("T", " ").slice(0, 19);
  return (
    <div className="entry-block" id={journalEntryElementId(panelKey, entry.entryId)}>
      <div className="entry-head">
        <span className={`entry-tag entry-${tone}`}>{entry.entryType}</span>
        <span className="entry-when">
          effective <b>{entry.effectiveAt}</b> · recorded {recorded} UTC
        </span>
        {entry.reversesEntryId ? <span className="entry-when">reverses {entry.reversesEntryId.slice(0, 8)}</span> : null}
      </div>
      {/* The lines scroll sideways inside their own block instead of being cut off by it (review
          finding F-UA-04). At 375 px the block was 277 px around a 640 px table under
          `overflow: hidden`, so every DEBIT and CREDIT amount was unreachable on a phone with no
          scroller to reach it. Same pattern as `.table-scroll` on the other wide tables. */}
      {/* Focusable, because a region that scrolls has to be reachable from the keyboard as well
          as by a finger. F-LU-03: it carries role="group" with its name, because a named element
          with no role names nothing; a landmark is not used on purpose, since eight entry blocks
          would otherwise put eight landmarks on one page. */}
      <div className="entry-lines-scroll" role="group" tabIndex={0} aria-label={`${entry.entryType} lines`}>
      <table className="entry-lines">
        <colgroup>
          <col />
          <col className="amount-column" />
          <col className="amount-column" />
        </colgroup>
        {/* F-LU-02: the three columns are named inside the table, so the header scrolls with the
            lines it labels and is still there at 375 px, where the decorative header that used to
            sit above the blocks was hidden and the amounts were left unlabelled. */}
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col" className="amount">
              Debit
            </th>
            <th scope="col" className="amount">
              Credit
            </th>
          </tr>
        </thead>
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
    </div>
  );
}
