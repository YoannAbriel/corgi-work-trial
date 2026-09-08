import { formatCentsAsUsd } from "@/lib/money/cents";
import type { FormulaLine } from "@/lib/money/endorsement";

// The formula lines of an endorsement, printed the same way everywhere they appear: on the
// preview before anything is recorded, on the customer's approval screen, and on the policy
// page after execution. The lines themselves come from lib/money/endorsement.ts; this only
// formats the cents. No money is computed in the browser: this is a server component and the
// figures arrive already computed.
export function FormulaLinesTable({ lines }: { lines: FormulaLine[] }) {
  return (
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
          <tr key={line.key} className={line.key === "delta_total" ? "total" : undefined}>
            <td>{line.label}</td>
            <td>
              <code>{line.formula}</code>
            </td>
            <td className="amount">{formatCentsAsUsd(line.cents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
