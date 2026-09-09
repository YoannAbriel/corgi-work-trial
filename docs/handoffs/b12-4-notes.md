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
5. **When it lands**, if the **journal entry block that proves it** is already on screen without
   anything having to be opened, a thin curve is drawn from the figure to that block and the block
   lights up for 1.5 s. If it is not, **nothing happens on its own**: the reveal never opens a
   fold and never moves the page (review finding F-B12-11).
6. **"Trace to the ledger"**, under the fold, is the one action that changes the page: it opens
   the folds the entry is hidden in, scrolls to it, lights it, and draws the connector only if the
   figure is still on screen once the scrolling has settled.

## The rule the slice rests on, and how it is held

**The browser never computes a money figure.** Every figure on the screen at rest is a string the
server rendered; the client component decides WHEN such a string appears, never WHAT it says.

The count-up is the one exception, and the wording matters (review finding F-B12-13): **while the
count runs, the browser does arithmetic.** It reads the digits of the server-rendered text as a
number and multiplies it by a fraction of the animation to pick each intermediate frame, so those
frames are strings the browser composed. They are frames of a count, not amounts: nothing this
application states, stores, posts, totals or compares is produced there, and the frame the count
stops on is the server's own text put back verbatim.

| What moves | Where its text comes from |
|---|---|
| the figure | `formatCentsAsUsd(amountCents)` on the server, passed as `finalText` and repeated in `data-final-amount` on the figure |
| each formula line | `FormulaLinesTable`, server, `data-final-amount` per amount cell |
| the running subtotals | `runningSubtotals(explanation)` in `lib/money/explain.ts`, server, one `data-subtotal` per row |
| the result line, once landed | the same `data-final-amount` string, written back verbatim |
| the count-up's intermediate frames | composed in the browser from the digits of that string, and nothing else; they are frames of a count, never a figure |

The count-up is the one place a number is read at all: `Number(digits)` where `digits` is the digit
characters of the server's own text, multiplied by the eased progress of the animation to choose
which digits to draw on the way there. The last frame is not a rebuilt string, it is
`textFromServer` itself.
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
- "Trace to the ledger" is a plain `<a href="#journal-entry-<panel>-<entry>">`: it jumps to the
  entry with no JavaScript at all. **With JavaScript off, whether the browser also opens the
  journal's "show all" fold around that entry is the browser's decision and not ours** (review
  finding F-B12-12). With JavaScript on, the fold that owns the entry opens it, scrolls to it and
  lights it, on the link and on arrival at that address.
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
5. `components/journal-table.tsx`: `journalEntryElementId(panelKey, entryId)`, and each entry block
   carries that id. The panel is in the id because a page can print the same entry twice
   (F-B12-18); `panelKey` is required so no new panel can forget it, and `AmountExplained` says
   which panel it points at through `tracePanelKey` (`"policy"` by default, `"claim"` on the claim
   page).
6. `app/globals.css`, last section: the classes and keyframes, and the reduced-motion block.
7. `lib/money/amount-explained-motion.test.ts`: the source assertions and the `runningSubtotals`
   cases.

## Evidence

`docs/evidence/b12-4/`, 18 PNG frames captured with Playwright driving Chrome against `next dev`,
with the measurements below taken in the same runs. Re-recorded after every review fix, so each
frame shows the corrected behaviour.

**The count-up value is read immediately before AND immediately after each frame is taken, and the
bracket is what is recorded** (review finding F-B12-14): the number in the frame is inside its
bracket, and no row can claim a digit the frame does not show. `motion-0560ms.png` shows
`$0,456.43`, inside `[$0,278.76 .. $0,456.43]`.

**The reveal** (900x940, `motion-*.png`). `focusable` is how many of the panel's three focusable
controls are actually visible, out of three:

| Moment | data-reveal | rows lit | result cell | connector | proving | scrolled | focusable |
|---|---|---|---|---|---|---|---|
| 140 ms | 1 | 0 | `$2,380.44` | 0 | 0 | no | **0/3** |
| 280 ms | 2 | 2 | `$2,380.44` | 0 | 0 | no | 1/3 |
| 420 ms | 3 | 2 | `$2,380.44` | 0 | 0 | no | 1/3 |
| 560 ms | 4 | 2 | `[$0,278.76 .. $0,456.43]` | 0 | 0 | no | 3/3 |
| 760 ms | 4 | 2 | `[$1,938.43 .. $2,000.02]` | 0 | 0 | no | 3/3 |
| 1000 ms | 4 | 2 | `[$2,375.65 .. $2,379.60]` | 0 | 0 | no | 3/3 |
| 1400 ms | 4 | 2 | `$2,380.44` | 0 | 0 | no | 3/3 |

No control is reachable while it is invisible (F-B12-17), and the count stops on the cell's own
`data-final-amount`, `$2,380.44`.

**Both ends of the connector on screen** (900x1500, `visible-1400ms.png`): connector 1, proving 1,
page not scrolled. This is the only case in which the reveal points at the ledger by itself.

**F-B12-11, the entry behind the journal's "show all" fold** (`hidden-1400ms.png`,
`hidden-after-trace-to-the-ledger.png`):

| After | show-all fold open | connector | proving | scrollY |
|---|---|---|---|---|
| the whole reveal | **0** | **0** | **0** | **0** |
| following "Trace to the ledger" | 1 | 0, the figure scrolled off screen | 1 | 450 |

The reveal opened nothing, drew nothing and moved nothing. Only the link acted.

**F-B12-12, arriving on the address of an entry inside the closed fold**
(`fragment-arrival-opens-the-fold.png`): the fold opened, the entry was lit and the connector drawn,
with the explanation fold itself still closed (`data-reveal=0`).

**F-B12-16, reduced motion** (900x1500, `reduced-*.png`): everything at once at 140 ms, no count-up,
no connector, and the proving entry marked (`proving=1`) with the flat colour.

**F-B12-18, ids unique per panel:** the journal panel's blocks render as
`journal-entry-policy-1111...` and `journal-entry-policy-2222...`.

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
  The first thing to check on the next deploy is that fold: that the reveal leaves the journal
  alone when the proving entry is behind the "show all" fold, and that "Trace to the ledger"
  reaches the cancellation entry.
- **All eight findings of `docs/reviews/inbox-and-motion.md` on the animation are closed**:
  F-B12-11 (MEDIUM) and F-B12-12 to F-B12-18. The record reached this branch on the second merge of
  `origin/main`; the first four were closed from the coordinator's description before it arrived
  and were rechecked against the record afterwards.
- **No check script was run**, by instruction and because nothing here writes to a database.
- **No independent review yet** (`REVIEWER.md`). The reviewer should look hardest at two things:
  the count-up writing into a server-rendered cell, and whether the connector can ever be drawn to
  an element the reader cannot see.
- **The count-up shows leading zeros** (`$0,456.43` on the way to `$2,380.44`). Deliberate: the
  width never changes, so the row does not jitter while it counts, and the string shown is a frame
  of the count and not a figure the application states. It is worth a sentence at the debrief.
- **Only the folds that already existed are animated.** The reconciliation screen, the approvals
  queue and the broker and staff lists still have no folds at all, exactly as B12-2 left them.
- **No recording, only frames.** A video would need a screen recorder this worktree does not have.
