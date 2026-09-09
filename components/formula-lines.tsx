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
export function FormulaLinesTable({
  lines,
  highlightKey = "delta_total",
}: {
  lines: FormulaLine[];
  highlightKey?: string;
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
          {lines.map((line) => (
            <tr key={line.key} className={line.key === highlightKey ? "total" : undefined}>
              <td>{line.label}</td>
              <td>
                <code>{line.formula}</code>
              </td>
              <td className="amount">{formatCentsAsUsd(line.cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
