// The parts of an explanatory sentence a reader's eye should land on: the money, the dates, the
// counts, and the small set of words that say what is about to happen to the money.
//
// Yoann, 2026-09-09 22:10, reading the Confirm paragraph of the correction preview: the sentences
// are right, but they are a wall of even grey and the figures inside them do not stand out.
//
// THIS FUNCTION ADDS NOTHING AND REWORDS NOTHING. It cuts one string into consecutive pieces and
// says which of them deserve a <strong>; joining the pieces back together gives the sentence
// character for character, which is what lib/ui/emphasis.test.ts asserts on every case. The tags
// themselves are components/emphasis.tsx. It lives in lib/ because that is where the test runner
// looks (package.json globs lib/*/*.test.ts); it computes no money and reads no database.
//
//   emphasisParts("It costs $53.84")
//     -> [{ text: "It costs ", strong: false }, { text: "$53.84", strong: true }]
//   emphasisParts("re-booked on 2026-09-22")
//     -> [{ text: "re-booked", strong: true }, { text: " on ", strong: false }, { text: "2026-09-22", strong: true }]
//   emphasisParts("a plain sentence")
//     -> [{ text: "a plain sentence", strong: false }]

export type EmphasisPart = {
  text: string;
  strong: boolean;
};

// The words and phrases that carry the meaning of these sentences. LONGEST FIRST: the regex takes
// the first alternative that matches at a position, so "no second approver" has to be offered
// before "second approver", which has to be offered before "approver" would ever be reached.
// Every one of them is a word about what happens to the money, never a figure: the figures are
// the patterns below.
const EMPHASISED_PHRASES = [
  "nothing is deleted",
  "nothing is updated",
  "no second approver",
  "second approver",
  "customer approval",
  "re-booked",
  "superseding",
  "superseded",
  "reversal",
  "reversed",
  "collected",
  "collect",
  "refunded",
  "refund",
  "approved",
  "approve",
  "above",
  "below",
];

// One pass, one regex, alternatives in the order they should win.
//   1. a US dollar amount, with the sign the signed convention prints in front of it when it has
//      one (components/signed.tsx writes "+$52.61", lib/money/cents.ts writes "-$52.61");
//   2. an ISO business date, which is the only date format these screens print;
//   3. a percentage, tax rate or commission rate;
//   4. a count of days, the unit every proration is expressed in;
//   5. one of the phrases above, whatever its case at the start of a sentence.
// \b around the phrases keeps "collect" out of "collected" and "approve" out of "approver", and
// the phrase list being longest-first settles which of two overlapping phrases wins.
const EMPHASIS_PATTERN = new RegExp(
  [
    "[-+]?\\$-?[0-9,]+\\.[0-9]{2}",
    "\\d{4}-\\d{2}-\\d{2}",
    "\\d+(?:\\.\\d+)?%",
    "\\d+ days?\\b",
    `\\b(?:${EMPHASISED_PHRASES.join("|")})\\b`,
  ].join("|"),
  "gi",
);

export function emphasisParts(sentence: string): EmphasisPart[] {
  const parts: EmphasisPart[] = [];
  let cursor = 0;
  for (const match of sentence.matchAll(EMPHASIS_PATTERN)) {
    const start = match.index;
    if (start > cursor) {
      parts.push({ text: sentence.slice(cursor, start), strong: false });
    }
    // Sliced from the sentence rather than taken from the match, so the text is the reader's own
    // characters even where the pattern matched case-insensitively.
    parts.push({ text: sentence.slice(start, start + match[0].length), strong: true });
    cursor = start + match[0].length;
  }
  if (cursor < sentence.length) {
    parts.push({ text: sentence.slice(cursor), strong: false });
  }
  return parts;
}
