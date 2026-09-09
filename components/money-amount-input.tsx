"use client";

import { useState } from "react";

// A US dollar field that shows thousands separators and echoes underneath what the browser
// understood: "= $1,200.00".
//
// WHAT THIS DOES NOT DO, because it matters for the money rules of this build:
//   * it never computes. It groups the digits that were typed and pads the decimals to two. No
//     addition, no proration, no rounding, no currency conversion, no reading of any amount from
//     the database. Every amount this application DISPLAYS is still formatted on the server by
//     formatCentsAsUsd.
//   * it never decides. The server parses the field again with parseUsdAmountToCents
//     (lib/money/cents.ts) and refuses anything that is not a whole number of cents, so a person
//     who disables JavaScript, pastes a strange string or edits the DOM changes nothing.
//   * it never rewrites while the person types. Review findings F-UI-12 and F-UI-22: a mask that
//     reformats on every keystroke cannot tell a decimal comma from its own thousands comma, and
//     "1200,50" typed one character at a time became 120,050. So the field keeps exactly what
//     was typed until it loses focus; only then, and only when the text is plainly a dollar
//     amount with no comma at all ("1200", "1200.5", "$1200.50"), the thousands commas are put
//     in. Anything else stays as typed and the server is the one that says no.
//
// WHY THERE IS NO HIDDEN FIELD. The obvious alternative is to show a formatted value and submit a
// raw one from a hidden input. It was not chosen: the visible field would lose its name and its
// `required` attribute would have to move to a hidden field, which browsers cannot focus when
// validation fails, and the two values could drift apart. Instead the field keeps its exact name
// and attributes and submits what the person sees. No server change was needed:
// parseUsdAmountToCents already accepts thousands separators and a dollar sign, and already
// refuses "1 200,50", three decimals and everything else (lib/money/cents.test.ts).
// The sentence under an empty field. It is said ONCE on a form: printed under all three money
// fields of the quote, its example (1,200.00) contradicted the placeholders of the two limit
// fields (1,000,000 and 2,000,000), so the same figure meant two things on one screen (round 1,
// MEDIUM). A caller passes `hint={null}` to keep the echo and drop the sentence.
const DEFAULT_HINT = "Type an amount in US dollars, for example 1,200.00";

export function MoneyAmountInput({
  id,
  name,
  defaultValue = "",
  placeholder,
  required = false,
  hint = DEFAULT_HINT,
}: {
  id: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  // DISPLAY ONLY. It changes nothing about what is typed, parsed, formatted or submitted: the
  // echo below the field, and the server's own parsing, are untouched.
  hint?: string | null;
}) {
  // A default comes from the server ("1200.00"), never from a person, so grouping it is safe.
  const [text, setText] = useState(groupWhenPlain(defaultValue));
  const echo = echoOf(text);

  return (
    <>
      <input
        id={id}
        name={name}
        required={required}
        inputMode="decimal"
        placeholder={placeholder}
        aria-describedby={`${id}-echo`}
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
        onBlur={(event) => setText(groupWhenPlain(event.currentTarget.value))}
      />
      <span className="amount-echo" id={`${id}-echo`}>
        {echo === null ? hint : `= $${echo}`}
      </span>
    </>
  );
}

// Puts the thousands commas into a plain dollar amount, and only into one: digits, at most one
// point, at most two decimals, an optional dollar sign or spaces around. A text with a comma in
// it, a letter, a minus sign, a second point or a third decimal is returned exactly as it was.
function groupWhenPlain(typed: string): string {
  const bare = typed.replace(/[$\s]/g, "");
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(bare);
  if (!match) {
    return typed;
  }
  const wholeDollars = match[1].replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return match[2] === undefined ? wholeDollars : `${wholeDollars}.${match[2]}`;
}

// What the field says, printed the way the application prints money. Null while the text is not
// a US dollar amount the server would accept: an empty field, "12." mid-typing, a decimal comma.
// Thousands commas are accepted only in their proper places, which is also what the server does.
function echoOf(text: string): string | null {
  const bare = text.replace(/[$\s]/g, "");
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(bare);
  if (!match) {
    return null;
  }
  const wholeDollars = match[1].replace(/,/g, "").replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (match[2] ?? "").padEnd(2, "0");
  return `${wholeDollars}.${cents}`;
}
