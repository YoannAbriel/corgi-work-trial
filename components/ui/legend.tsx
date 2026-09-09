import type { ReactNode } from "react";

// One line of definitions under a table: what each classification or status means, said once
// instead of once per row.
export function Legend({ items }: { items: { term: ReactNode; meaning: ReactNode }[] }) {
  return (
    <div className="legend">
      {items.map((item, index) => (
        <span key={index}>
          <b>{item.term}</b> {item.meaning}
        </span>
      ))}
    </div>
  );
}
