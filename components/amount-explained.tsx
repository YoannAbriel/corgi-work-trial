import { ChevronRight } from "lucide-react";
import { FormulaLinesTable } from "@/components/formula-lines";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { explanationResultLine, type AmountExplanation } from "@/lib/money/explain";

// "Explain this amount" (slice B12-2, YOA-625). A figure, and under it a fold that says how it
// was produced: the arithmetic in integer cents, the days and the rate where they apply, the
// rounding rule by name, and the journal entries that prove it when there are any.
//
// Yoann's display decision of 2026-09-09 08:20 local: the explanation is a fold under the figure
// ON THE SCREENS, not in the PDFs. The PDFs keep their own printed schedules.
//
// It is a server component and a native <details>: no client component, no state, no JavaScript
// of ours. The content is in the HTML whether the fold is open or not, which matters for a
// reviewer and for a text search. Every cent arrives already computed, from the same pure
// functions the ledger posted with (lib/money/explain.ts); nothing is computed in the browser.
export function AmountExplained({
  amountCents,
  explanation,
  label,
  size = "figure",
}: {
  // The figure being explained, in integer cents. The component formats it, so the fold and the
  // number above it can never be formatted from two different values.
  amountCents: number;
  explanation: AmountExplanation;
  // What the figure is, repeated inside the fold's summary so that "Explain" is never on its own.
  label: string;
  // "figure" in a facts grid or a panel, "inline" inside a table cell or a side list.
  size?: "figure" | "inline";
}) {
  const resultLine = explanationResultLine(explanation);
  // THE CHECK THAT MAKES THE FOLD WORTH TRUSTING: the explanation has to end on the figure it
  // sits under. It cannot be assumed, so it is asked here on every render, and a disagreement is
  // printed rather than hidden. lib/money/explain.test.ts asserts the same property on the money
  // side, before anything reaches a screen.
  const agrees = resultLine !== null && resultLine.cents === amountCents;

  return (
    <div className={size === "inline" ? "amount-explained inline" : "amount-explained"}>
      <span className="amount-explained-figure">{formatCentsAsUsd(amountCents)}</span>
      <details className="amount-explain">
        <summary>
          <ChevronRight size={13} aria-hidden="true" className="disclosure-chevron" />
          <span>Explain this amount</span>
        </summary>
        <div>
          <p className="amount-explain-title">{label}</p>
          {agrees ? null : (
            <p className="error" role="alert">
              This explanation does not end on the figure above it ({formatCentsAsUsd(amountCents)}
              {resultLine ? ` against ${formatCentsAsUsd(resultLine.cents)}` : ", and it carries no result line"}). The
              figure is what the ledger holds; do not read the arithmetic below as an explanation of it until this is
              resolved.
            </p>
          )}
          <FormulaLinesTable lines={explanation.lines} highlightKey={explanation.resultKey} />
          <p className="note">
            <b>Rounding:</b>{" "}
            {explanation.rounding ?? "nothing is rounded here: this figure is a sum of whole cents."}
          </p>
          {explanation.note ? <p className="note">{explanation.note}</p> : null}
          {explanation.evidence && explanation.evidence.length > 0 ? (
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
                      <tr key={`${entry.entryType}-${index}`}>
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
          ) : null}
        </div>
      </details>
    </div>
  );
}
