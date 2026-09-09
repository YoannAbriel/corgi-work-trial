# B12-4: "explain this amount", animated

Slice B12, item 4, Linear YOA-637. Asked for by Yoann on 2026-09-09: the explanation of a figure
should be watchable, from the figure down to the ledger line that proves it ("faut le faire en
dynamique, en animé"). Built on top of B12-2 (`docs/handoffs/b12-2-3-notes.md`), which is the
static version of the same fold and stays exactly as it was for a reader with no JavaScript.

Presentation only. No migration, no endpoint, no form, no field, no role check, no row written,
updated or deleted, and **no money computed in the browser**.

## What a reader now sees

Clicking the figure (or its "Explain this amount" summary, or Enter/Space on the figure) opens the
fold and builds the proof in front of them:

1. **t+120 ms, the words.** What the figure is, the disagreement alert if there is one, and the
   business sentence.
2. **t+240 ms, the arithmetic in integer cents.** The operands of the formula table light up one
   after another, 70 ms apart, and a **running total** ticks along beside them.
3. **t+360 ms, the rounding rule**, as a small badge.
4. **t+480 ms, the result line**, which then **counts up from 0 to the figure over 600 ms**.
5. **When it lands**, a thin curve is drawn from the figure to the **journal entry block that
   proves it**, which lights up for 1.5 s. A **"Trace to the ledger"** link under the fold scrolls
   to that block and lights it again, opening the journal's "show all" fold if the entry was
   inside it.

## The rule the slice rests on, and how it is held

**The browser never computes money.** Every string on the screen was rendered on the server; the
client component decides WHEN a string appears, never WHAT it says.

| What moves | Where its text comes from |
|---|---|
| the figure | `formatCentsAsUsd(amountCents)` on the server, passed as `finalText` and repeated in `data-final-amount` on the figure |
| each formula line | `FormulaLinesTable`, server, `data-final-amount` per amount cell |
| the running subtotals | `runningSubtotals(explanation)` in `lib/money/explain.ts`, server, one `data-subtotal` per row |
| the result line, once landed | the same `data-final-amount` string, written back verbatim |
| the count-up frames | the DIGITS of that string, and nothing else |

The count-up is the one place a number is read at all: `Number(digits)` where `digits` is the digit
characters of the server's own text, used to choose which digits to draw on the way there. The last
frame is not a rebuilt string, it is `textFromServer` itself.
`lib/money/amount-explained-motion.test.ts` asserts this **against the source of the client
component**: no `* 100`, no `/ 100`, no `parseInt`, no `parseFloat`, no import from `lib/money`, no
identifier ending in `Cents`, exactly one `Number(` and it is `Number(digits)`.

`runningSubtotals` refuses to produce a ticker unless the lines really do add up to the figure, and
checks the last subtotal against the result line. A tax fold (`floor(premium x rate / 10000)`) and
a cancellation fold (seven lines, one of which is the figure) get no ticker rather than a subtotal
that would mean nothing.

## With JavaScript off, and at rest

- The shell server-renders as the same native `<details>` with its `<summary>`. Every line is in
  the HTML and visible: the CSS that hides a line before its turn applies **only inside a panel
  carrying `data-reveal`**, and only the client component ever writes that attribute.
- The figure is a `<span>`. It is promoted to `role="button"` with `tabIndex` and `aria-expanded`
  **after hydration**, so a control that cannot work is never advertised, and because it is the
  same element with the same box, **the page at rest does not move** when that happens.
- "Trace to the ledger" is a plain `<a href="#journal-entry-...">`: it jumps to the entry with no
  JavaScript at all.
- The connector is a `position: fixed` SVG portalled into the body, `pointer-events: none`,
  removed after 1.8 s. It takes no space in the layout.
- `prefers-reduced-motion: reduce` is read at the moment the fold opens: everything appears at
  once, the result keeps the server's text with no count-up, no connector is drawn, and the proving
  entry is marked with a plain colour instead of a pulse. Held twice, in the component and in CSS.

## Where to read it, in order

1. `components/amount-explained-motion.tsx` (new, the only client component of the feature): the
   shell, the reveal loop, the count-up, the connector.
2. `components/amount-explained.tsx`: still the server component, still renders every word and
   every cent; it now hands its four parts to the shell as props.
3. `lib/money/explain.ts`: `runningSubtotals` (new, pure), and `entryId` carried on
   `ExplanationEvidence` so a fold can point at the journal entry block already on the page.
4. `components/formula-lines.tsx`: data attributes only (`data-formula-line`,
   `data-formula-result`, `data-final-amount`, `data-subtotal`, `--operand-rank`). Inert for the
   five preview and approval screens that also use this table.
5. `components/journal-table.tsx`: `journalEntryElementId(entryId)`, and each entry block carries
   that id.
6. `app/globals.css`, last section: the classes and keyframes, and the reduced-motion block.
7. `lib/money/amount-explained-motion.test.ts`: the source assertions and the `runningSubtotals`
   cases.

## Evidence

`docs/evidence/b12-4/`, twelve PNG frames captured with Playwright driving Chrome at 900x940
against `next dev`, at rest and then at 140, 280, 420, 560, 760, 1000, 1400 and 2200 ms after the
click, plus the same run under `prefers-reduced-motion: reduce`.

Measured in the same run:

| Moment | data-reveal | operand rows lit | result cell | connector | proving entry |
|---|---|---|---|---|---|
| 140 ms | 1 | 0 | `$2,380.44` | 0 | 0 |
| 280 ms | 2 | 2 | `$2,380.44` | 0 | 0 |
| 420 ms | 3 | 2 | `$2,380.44` | 0 | 0 |
| 560 ms | 4 | 2 | `$0,609.18` | 0 | 0 |
| 760 ms | 4 | 2 | `$2,051.17` | 0 | 0 |
| 1000 ms | 4 | 2 | `$2,379.52` | 0 | 0 |
| 1400 ms | 4 | 2 | `$2,380.44` | 1 | 1 |
| reduced, 140 ms | 4 | 2 | `$2,380.44` | 0 | 0 |

The final cell text equals its own `data-final-amount`, `$2,380.44`. The figure's `role` after
hydration is `button`; the server-rendered HTML carries no `role="button"` and no `data-reveal`.

**These frames were captured on a fixture page, not on real trial data.** This worktree carries no
`.env.local` and none may be put in it (AF-05), so there is no database here. A throwaway route was
added, rendered with two hand-typed journal entries in the shape of CGP-01707's "Collected at
Stripe" fold (`125320 + 112724 = 238044`), photographed, and **deleted before the commit**. Nothing
in the frames is a real policy, and no claim is made about the deployed application from them.

## Checks actually run

| Check | Command | Result |
|---|---|---|
| Types | `npx tsc --noEmit` | PASS, no output |
| Unit tests | `npm test` | 447 tests, 446 pass, 1 skipped, 0 fail (11 new in `lib/money/amount-explained-motion.test.ts`) |
| Production build | `npm run build` | PASS, 30 routes generated, compiled successfully |
| Secrets, staged | `gitleaks protect --staged --redact` | no leaks found |
| Secrets, working tree | `gitleaks detect --no-git --redact` | 10 hits, all inside `.next/`, which is gitignored and not committed; nothing in tracked content |
| Animation | Playwright + Chrome, table above | 8 frames, the reveal, the count-up, the connector and the pulse all observed |
| Merge | merged `78f93c6`, no conflict | types, tests and build rerun on the merged tree; every result above is the merged one |

## Not done, and why

- **Not seen on real data.** The animation has never run on CGP-01274's "Unearned premium,
  refunded" fold, nor on any real policy, claim or statement screen: no database in this worktree.
  The first thing to check on the next deploy is that fold, and that the connector reaches the
  cancellation entry block rather than an entry hidden behind the journal's "show all" fold.
- **No check script was run**, by instruction and because nothing here writes to a database.
- **No independent review yet** (`REVIEWER.md`). The reviewer should look hardest at two things:
  the count-up writing into a server-rendered cell, and whether the connector can ever be drawn to
  an element the reader cannot see.
- **The count-up shows leading zeros** (`$0,609.18` on the way to `$2,380.44`). Deliberate: the
  width never changes, so the row does not jitter while it counts, and the number shown is the
  count's own value at that instant, not a wrong figure. It is worth a sentence at the debrief.
- **Only the folds that already existed are animated.** The reconciliation screen, the approvals
  queue and the broker and staff lists still have no folds at all, exactly as B12-2 left them.
- **No recording, only frames.** A video would need a screen recorder this worktree does not have.
