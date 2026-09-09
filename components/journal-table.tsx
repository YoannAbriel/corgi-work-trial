import type { ReactNode } from "react";
import { EntryLinesTable } from "@/components/ui/table";
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
  // The sentence the posting itself stored (journal_entries.description). Optional because one
  // of the four readers does not select it: journalEntriesOfSubject in lib/console/read.ts, which
  // feeds the 360 journal. That panel prints the block without the sentence rather than a blank
  // line; nothing under lib/ was changed to add it.
  description?: string;
  lines: { accountId: string; accountName: string; debitCents: number; creditCents: number }[];
};

// A short mark beside one entry's type, and whether that entry's amounts are struck through.
// Only the corrections panel passes it: a correction posts two entries that undo something and
// two that re-book it, and without a mark the reader has to match entry ids to see that the four
// are two pairs and not four movements (Yoann, 2026-09-09). It only labels; the figures printed
// are the ones the ledger stored, unchanged.
export type EntryMark = { chip: ReactNode; struck?: boolean };

export function JournalTable({
  entries,
  panelKey,
  visibleEntries = 4,
  ariaLabel = "Journal",
  legend = true,
  mark,
}: {
  entries: JournalEntryForTable[];
  // Which panel this table is: it goes into the id of every block, so two panels printing the same
  // entry cannot produce the same id. Required, so no new panel can forget it.
  panelKey: string;
  visibleEntries?: number;
  ariaLabel?: string;
  // What a debit and a credit mean, under the entries. On by default; a panel that sits on a
  // screen where another journal table already says it passes false, so the screen says it once.
  legend?: boolean;
  // Returns the mark for one entry, or null for no mark. Absent on every panel but corrections.
  mark?: (entry: JournalEntryForTable) => EntryMark | null;
}) {
  // Newest first: the last thing that happened is what the reader is looking for.
  const newestFirst = [...entries].sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime());
  const shown = newestFirst.slice(0, visibleEntries);
  const folded = newestFirst.slice(visibleEntries);

  return (
    <div className="journal" role="region" aria-label={ariaLabel}>
      <div className="journal-list">
        {shown.map((entry) => (
          <EntryBlock key={entry.entryId} entry={entry} panelKey={panelKey} mark={mark} />
        ))}
      </div>
      {folded.length > 0 ? (
        <details className="show-all">
          <summary>
            Show all {entries.length} entries ({folded.length} older)
          </summary>
          <div className="journal-list">
            {folded.map((entry) => (
              <EntryBlock key={entry.entryId} entry={entry} panelKey={panelKey} mark={mark} />
            ))}
          </div>
        </details>
      ) : null}
      {legend ? (
        <div className="legend journal-legend">
          <span>
            <b>Credit:</b> where the money comes from. <b>Debit:</b> where it goes. Every entry takes as much as it
            brings.
          </span>
        </div>
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

function EntryBlock({
  entry,
  panelKey,
  mark,
}: {
  entry: JournalEntryForTable;
  panelKey: string;
  mark?: (entry: JournalEntryForTable) => EntryMark | null;
}) {
  const tone = toneOf(entry.entryType);
  const marked = mark ? mark(entry) : null;
  const recorded = entry.recordedAt.toISOString().replace("T", " ").slice(0, 19);
  return (
    <div
      // `entry-struck` only strikes the amounts through in CSS; the cents below are the stored
      // ones, printed unchanged, and nothing is subtracted anywhere to draw them.
      className={marked?.struck ? "entry-block entry-struck" : "entry-block"}
      id={journalEntryElementId(panelKey, entry.entryId)}
    >
      <div className="entry-head">
        <span className={`entry-tag entry-${tone}`}>{entry.entryType}</span>
        {marked ? marked.chip : null}
        <span className="entry-when">
          effective <b>{entry.effectiveAt}</b> · recorded {recorded} UTC
        </span>
        {entry.reversesEntryId ? <span className="entry-when">reverses {entry.reversesEntryId.slice(0, 8)}</span> : null}
      </div>
      {/* The sentence the posting stored, under the header and above the lines: what this entry
          did, in words, for a reader who does not read debits and credits (Yoann, 2026-09-09). */}
      {entry.description ? <p className="entry-description">{entry.description}</p> : null}
      {/* The lines of the entry, through the shared table of the interface system
          (components/ui/table.tsx, EntryLinesTable): Account, Debit, Credit, credits indented
          under the account they answer, and bounded to 720 px so that at 1920 px an account name
          and its amount are still read together (cycle 2, decision 10; round 1 measured 1415 px
          between the two). The header travels with the lines it labels (F-LU-02), and the box
          scrolls sideways inside the block rather than being cut off by it (F-UA-04).
          Focusable, because a region that scrolls has to be reachable from the keyboard as well
          as by a finger. F-LU-03: it carries role="group" with its name, because a named element
          with no role names nothing; a landmark is not used on purpose, since eight entry blocks
          would otherwise put eight landmarks on one page. */}
      <div className="entry-lines-scroll" role="group" tabIndex={0} aria-label={`${entry.entryType} lines`}>
        <EntryLinesTable
          lines={entry.lines.map((line) => ({
            account: line.accountName,
            debit: line.debitCents > 0 ? formatCentsAsUsd(line.debitCents) : "",
            credit: line.creditCents > 0 ? formatCentsAsUsd(line.creditCents) : "",
            isCredit: line.creditCents > 0,
          }))}
        />
      </div>
    </div>
  );
}
