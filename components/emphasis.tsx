import { Fragment } from "react";
import { emphasisParts } from "@/lib/ui/emphasis";

// One explanatory sentence, with the money, the dates, the counts and the words that say what
// happens to the money in bold (Yoann, 2026-09-09 22:10: the sentences are right, but they read
// as a wall of even grey and the figures do not stand out).
//
// PRESENTATION ONLY, AND ONLY MARKUP. The child is a plain string and every character of it is
// printed back in order; all this adds is <strong> around the pieces lib/ui/emphasis.ts picked
// out, which is the file that holds the rule and its test. Nothing is reworded, reordered,
// rounded or recomputed.
//
// It belongs in a sentence, never in a table cell or a chip: those are already short, aligned and
// scanned by position, and bold inside them would fight the alignment instead of helping it.
export function Emphasis({ children }: { children: string }) {
  return (
    <>
      {emphasisParts(children).map((part, index) =>
        part.strong ? <strong key={index}>{part.text}</strong> : <Fragment key={index}>{part.text}</Fragment>,
      )}
    </>
  );
}
