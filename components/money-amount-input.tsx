"use client";

import { useState } from "react";

// A US dollar field that groups thousands while the person types, and echoes underneath what the
// browser understood: "= $1,200.00".
//
// WHAT THIS DOES NOT DO, because it matters for the money rules of this build:
//   * it never computes. It groups the digits that were typed and pads the decimals to two. No
//     addition, no proration, no rounding, no currency conversion, no reading of any amount from
//     the database. Every amount this application DISPLAYS is still formatted on the server by
//     formatCentsAsUsd.
//   * it never decides. The server parses the field again with parseUsdAmountToCents
//     (lib/money/cents.ts) and refuses anything that is not a whole number of cents, so a person
//     who disables JavaScript, pastes a strange string or edits the DOM changes nothing.
//
// WHY THERE IS NO HIDDEN FIELD. The obvious alternative is to show a formatted value and submit a
// raw one from a hidden input. It was not chosen: the visible field would lose its name and its
// `required` attribute would have to move to a hidden field, which browsers cannot focus when
// validation fails, and the two values could drift apart. Instead the field keeps its exact name
// and attributes and submits what the person sees, "1,200.00". No server change was needed:
// parseUsdAmountToCents already accepts thousands separators and a dollar sign, and already
// refuses "1 200,50", three decimals and everything else (lib/money/cents.test.ts).
export function MoneyAmountInput({
  id,
  name,
  defaultValue = "",
  placeholder,
  required = false,
}: {
  id: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const [text, setText] = useState(groupThousands(defaultValue));
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
        onChange={(event) => {
          const field = event.currentTarget;
          const caret = field.selectionStart ?? field.value.length;
          const digitsBeforeCaret = countDigits(field.value.slice(0, caret));
          const formatted = groupThousands(field.value);
          setText(formatted);
          // Grouping inserts and removes commas, so the caret has to be put back after the same
          // number of digits instead of at the same index, or it jumps a character every comma.
          queueMicrotask(() => {
            const position = positionAfterDigits(formatted, digitsBeforeCaret);
            field.setSelectionRange(position, position);
          });
        }}
      />
      <span className="amount-echo" id={`${id}-echo`}>
        {echo === null ? "Type an amount in US dollars, for example 1,200.00" : `= $${echo}`}
      </span>
    </>
  );
}

// Groups the whole-dollar digits in threes. Only the mask's own characters are removed: the
// dollar sign, spaces and the commas it inserted. Anything else stays exactly as typed, so the
// field never turns a string the server refuses into one it accepts (review finding F-UI-12:
// "1 200,50" used to become "120,050"). A decimal comma, a second point, a minus sign, a letter
// or a third decimal all reach the server untouched, and the server's parser is the one that
// says no.
function groupThousands(typed: string): string {
  const bare = typed.replace(/[$\s]/g, "");
  if (bare === "") {
    return "";
  }
  if (!/^[\d,]*(\.\d*)?$/.test(bare)) {
    return typed;
  }
  // "1200,50": a comma followed by one or two digits at the end, with no point, is a decimal
  // comma, not a thousands separator. Left alone on purpose.
  if (/,\d{1,2}$/.test(bare) && !bare.includes(".")) {
    return typed;
  }
  const [wholePart, decimals] = bare.replace(/,/g, "").split(".");
  const grouped = wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decimals === undefined ? grouped : `${grouped}.${decimals}`;
}

// What the field says, printed the way the application prints money. Null while the text is not
// yet a US dollar amount: an empty field, or "12." mid-typing.
function echoOf(text: string): string | null {
  const cleaned = text.replace(/,/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) {
    return null;
  }
  // Leading zeros are not part of an amount: "007" echoes as $7.00 (F-UI-19).
  const wholeDollars = match[1].replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (match[2] ?? "").padEnd(2, "0");
  return `${wholeDollars}.${cents}`;
}

function countDigits(text: string): number {
  return text.replace(/\D/g, "").length;
}

// The index just after the nth digit of the formatted text.
function positionAfterDigits(formatted: string, digits: number): number {
  if (digits === 0) {
    return 0;
  }
  let seen = 0;
  for (let index = 0; index < formatted.length; index += 1) {
    if (/\d/.test(formatted[index])) {
      seen += 1;
      if (seen === digits) {
        return index + 1;
      }
    }
  }
  return formatted.length;
}
