import type { CSSProperties } from "react";
import { formatCentsAsUsd } from "@/lib/money/cents";
import type { FormulaLine } from "@/lib/money/endorsement";

// The formula lines of an amount, printed the same way everywhere they appear: on the preview
// before anything is recorded, on the customer's approval screen, on the policy page after
// execution, and inside every "explain this amount" fold (slice B12-2). The lines themselves come
// from lib/money/endorsement.ts, lib/money/correction.ts and lib/money/explain.ts; this only
// formats the cents. No money is computed in the browser: this is a server component and the
// figures arrive already computed.
//
// `highlightKey` is the line that IS the figure being explained, shown in bold. It defaults to
// the endorsement's own total, which is what every screen written before B12-2 expects.
//
// Slice B12-4 (YOA-637) adds data attributes and nothing else. They carry SERVER-RENDERED TEXT for
// the animation to read: the final amount of each line, and the running subtotal after it when the
// fold has one (lib/money/explain.ts, runningSubtotals). The browser never computes any of it; it
// only chooses which of these strings to show. With JavaScript off they are inert attributes and
// the table reads exactly as it did before.
export function FormulaLinesTable({
  lines,
  highlightKey = "delta_total",
  subtotalTexts,
}: {
  lines: FormulaLine[];
  highlightKey?: string;
  subtotalTexts?: Record<string, string>;
}) {
  return (
    <div className="table-scroll" role="region" aria-label="Amount calculation details" tabIndex={0}>
      <table className="formula">
        <thead>
          <tr>
            <th>Amount</th>
            <th>How it was computed (integer cents)</th>
            <th className="amount">Result</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr
              key={line.key}
              className={line.key === highlightKey ? "total" : undefined}
              data-formula-line={line.key}
              data-formula-result={line.key === highlightKey ? "true" : undefined}
              data-subtotal={subtotalTexts?.[line.key]}
              // The rank of the line in the table, so the animation can fade the operands in one
              // after another. It is a position, not an amount.
              style={{ "--operand-rank": index } as CSSProperties}
            >
              <td>{line.label}</td>
              <td>
                <code>{line.formula}</code>
              </td>
              <td className="amount" data-final-amount={formatCentsAsUsd(line.cents)}>
                {formatCentsAsUsd(line.cents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
