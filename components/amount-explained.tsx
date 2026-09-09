import { AmountExplainedMotion } from "@/components/amount-explained-motion";
import { FormulaLinesTable } from "@/components/formula-lines";
import { journalEntryElementId } from "@/components/journal-table";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { explanationResultLine, runningSubtotals, type AmountExplanation } from "@/lib/money/explain";

// "Explain this amount" (slice B12-2, YOA-625). A figure, and under it a fold that says how it
// was produced: the arithmetic in integer cents, the days and the rate where they apply, the
// rounding rule by name, and the journal entries that prove it when there are any.
//
// Yoann's display decision of 2026-09-09 08:20 local: the explanation is opened from the figure
// ON THE SCREENS, not in the PDFs. The PDFs keep their own printed schedules. Since the interface
// system of 2026-09-09 the panel opens in the browser's top layer (a native popover) rather than
// inside the cell, where a table's scroll container clipped it.
//
// THIS COMPONENT IS STILL THE SERVER COMPONENT, and it still renders every word and every cent.
// Slice B12-4 (YOA-637) only wrapped its output in a client shell that decides WHEN each part
// appears (components/amount-explained-motion.tsx). Everything below is computed here, on the
// server, from the same pure functions the ledger posted with (lib/money/explain.ts); nothing is
// computed in the browser, and with JavaScript off the fold is the same native <details> it was.
export function AmountExplained({
  amountCents,
  explanation,
  label,
  size = "figure",
  tracePanelKey = "policy",
}: {
  // The figure being explained, in integer cents. The component formats it, so the fold and the
  // number above it can never be formatted from two different values.
  amountCents: number;
  explanation: AmountExplanation;
  // What the figure is, repeated inside the fold's summary so that "Explain" is never on its own.
  label: string;
  // "figure" in a facts grid or a panel, "inline" inside a table cell or a side list.
  size?: "figure" | "inline";
  // Which journal panel on this page the fold points at (review finding F-B12-18). A page can
  // print the same entry in two panels, so the id of a block carries the panel it is in, and a
  // fold has to say which of them it means. Every screen but the claim page points at the policy
  // journal, which is why that is the default.
  tracePanelKey?: string;
}) {
  const resultLine = explanationResultLine(explanation);
  // THE CHECK THAT MAKES THE FOLD WORTH TRUSTING: the explanation has to end on the figure it
  // sits under. It cannot be assumed, so it is asked here on every render, and a disagreement is
  // printed rather than hidden. lib/money/explain.test.ts asserts the same property on the money
  // side, before anything reaches a screen.
  const agrees = resultLine !== null && resultLine.cents === amountCents;

  // The running total after each line, formatted here (slice B12-4). It exists only when the
  // lines really do add up to the figure; every other fold gets no ticker rather than a subtotal
  // that would mean nothing.
  const subtotals = runningSubtotals(explanation);
  const subtotalTexts = subtotals
    ? Object.fromEntries(subtotals.map((subtotal) => [subtotal.key, formatCentsAsUsd(subtotal.cents)]))
    : undefined;

  // The first journal entry of the evidence that is printed on this same page. The animation draws
  // a connector to its block and the "Trace to the ledger" link jumps to it. Undefined on a fold
  // whose evidence is not journal entries (a broker statement is built from stored statement
  // lines), and then neither the connector nor the link exists.
  const traceEntryId = explanation.evidence?.find((entry) => entry.entryId)?.entryId;

  return (
    <AmountExplainedMotion
      finalText={formatCentsAsUsd(amountCents)}
      label={label}
      size={size}
      traceEntryElementId={traceEntryId ? journalEntryElementId(tracePanelKey, traceEntryId) : undefined}
      hasTicker={subtotalTexts !== undefined}
      inWords={
        <>
          <p className="amount-explain-title">{label}</p>
          {agrees ? null : (
            <p className="error" role="alert">
              This explanation does not end on the figure above it ({formatCentsAsUsd(amountCents)}
              {resultLine ? ` against ${formatCentsAsUsd(resultLine.cents)}` : ", and it carries no result line"}). The
              figure is what the ledger holds; do not read the arithmetic below as an explanation of it until this is
              resolved.
            </p>
          )}
          {/* THE SECOND HALF OF THE CHECK, for a fold that replays stored figures rather than
              computing them here (review finding F-INT-05): the same inputs, priced again on the
              server, figure by figure. Nothing below is computed in the browser. */}
          {explanation.recheck ? (
            explanation.recheck.notComputable !== null ? (
              <p className="error" role="alert">
                These figures could not be priced again from the inputs stored with them:{" "}
                {explanation.recheck.notComputable}. The figure above is what the ledger holds; nothing here confirms it.
              </p>
            ) : explanation.recheck.agrees ? (
              <p className="note">Recomputed today from the same inputs: identical.</p>
            ) : (
              <p className="error" role="alert">
                Recomputed today from the same inputs, and it does not agree on{" "}
                {explanation.recheck.disagreements
                  .map(
                    (disagreement) =>
                      `${disagreement.figure} (${formatCentsAsUsd(disagreement.storedCents)} stored, ${formatCentsAsUsd(
                        disagreement.recomputedCents,
                      )} recomputed)`,
                  )
                  .join(", ")}
                . The figure above is what the ledger holds; do not read the arithmetic below as an explanation of it
                until this is resolved.
              </p>
            )
          ) : null}
          {explanation.note ? <p className="note">{explanation.note}</p> : null}
        </>
      }
      formula={
        <FormulaLinesTable lines={explanation.lines} highlightKey={explanation.resultKey} subtotalTexts={subtotalTexts} />
      }
      rounding={
        <p className="amount-explain-rounding">
          <span className="rounding-badge">Rounding</span>{" "}
          {explanation.rounding ?? "nothing is rounded here: this figure is a sum of whole cents."}
        </p>
      }
      evidence={
        explanation.evidence && explanation.evidence.length > 0 ? (
          <>
            <p className="note">
              <b>{explanation.evidenceLabel ?? "Proved by these journal entries."}</b> The effective date is the
              business date the entry belongs to; the recorded time is when the database wrote it.
            </p>
            <div className="table-scroll" role="region" aria-label="Journal entries behind this amount" tabIndex={0}>
              <table className="formula">
                <thead>
                  <tr>
                    <th>Entry</th>
                    <th>Effective</th>
                    <th>Recorded (UTC)</th>
                    <th>Line</th>
                  </tr>
                </thead>
                <tbody>
                  {explanation.evidence.map((entry, index) => (
                    <tr key={`${entry.entryType}-${index}`} data-entry-id={entry.entryId}>
                      <td>{entry.entryType}</td>
                      <td>{entry.effectiveAt}</td>
                      <td>{entry.recordedAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                      <td>
                        <code>{entry.detail}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null
      }
    />
  );
}
