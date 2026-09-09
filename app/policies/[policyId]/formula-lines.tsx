// The table moved to components/formula-lines.tsx when slice B12-2 started using it outside the
// policy screens (the claim page and the broker statement). It is re-exported here so the five
// preview and approval pages that import it by relative path keep reading the same component.
export { FormulaLinesTable } from "@/components/formula-lines";
