# Independent review: the three key screens in five states, at 375 px and 1280 px

Slice B13-1 (docs/PLAN.md row B13, Linear YOA-602): "three key screens (policy detail with
as-of, reconciliation breaks, broker statement) with default, loading, empty, error and one edge
state". Reviewed on the deployed application, not locally.

**Reviewer:** independent sub-agent, own git worktree, branch `worktree-agent-a6c9cf5ef50d46411`.
**Timestamp:** 2026-09-09T09:03:33Z.
**Reviewed tree:** `08b3678` (`Merge branch 'codex/corgi-interface'`), which is the tree this
branch is based on and the tree that was deployed while the evidence was captured.
**Deployment:** https://corgi-work-trial-iota.vercel.app

**Verdict: FAIL**, on one MEDIUM finding (F-B13-30): a single click on "Explain this amount"
makes the policy screen and the statement run screen scroll sideways at 375 px. Everything else
in the declared scope passes, including the five states, the error wording, the amount alignment
and the as-of control.

**Walkthrough status: NOT REVIEWED WITH YOANN.** No part of this record establishes that Yoann
can explain these screens; it is a technical assessment only.

---

## Startup receipt

Files actually read in full before assessing anything:

| File | What I took from it |
|---|---|
| `CLAUDE.md` | entry point, Track 1, reading order, French with Yoann and English artifacts |
| `AUTOMATIC-FAILS.md` | the six bans; AF-02, AF-04 and AF-05 are the ones this UI scope can violate |
| `REVIEWER.md` | the implementation-review contract, the record shape, PASS/FAIL/BLOCKED meaning |
| `AGENTS.md` | startup receipt, delegate ownership rules, "only the coordinator edits shared files" |
| `READABLE-CODE.md` | what to flag: ambiguous units, hidden side effects, type lies, opaque math |
| `docs/PLAN.md` row B13 | the exact five states and three screens this slice owes |
| `docs/reviews/ui-rebuild.md` | F-UI-22 to F-UI-26 and their re-review; F-UI-25 closed in code only |
| `docs/reviews/ui-polish.md` | F-UI-12 to F-UI-20; **its "375 pixels" section says "Not measured"** |
| `docs/reviews/FINDINGS.md` (tail) | F-B13-08 to F-B13-29, so my numbering starts at F-B13-30 |

Code read for this scope, at `08b3678`:
`app/policies/[policyId]/page.tsx` (1271 lines), `app/policies/[policyId]/correction-sections.tsx`
(the `PolicyAsOf` panel), `app/ops/reconciliation/page.tsx`, `app/broker/statements/page.tsx`,
`app/statements/[runId]/page.tsx`, `components/detail-layout.tsx`, `components/journal-table.tsx`,
`components/amount-explained.tsx`, `components/disclosures.tsx`, `app/error.tsx`,
`app/not-found.tsx`, `lib/policy/correction-read.ts` (`policyAsItStoodOn`), and the relevant
blocks of `app/globals.css`.

Absent files: none of the mandatory kit was missing. **`app/loading.tsx` and every other
`loading.tsx` are absent**, which is a finding in itself (F-B13-31), not a missing-file blocker:
`find app -name "loading.tsx"` returns nothing; only `app/error.tsx` and `app/not-found.tsx` exist.

### Which revision this record describes

Production moved five times during the review. That matters, so it is recorded rather than
smoothed over:

| Revision | When I saw it | Relation to this review |
|---|---|---|
| `7bc6ff4` | 08:28Z to 08:35Z | the brief's target `5590242` never deployed: its head commit was docs-only and Vercel's ignored build step skipped it |
| `0b92476` | 08:35Z | `5590242` plus a comment-only login change; no screen code differs |
| `d786644` | 08:40Z | first full capture pass; console and `lib/reconciliation/read.ts` only |
| **`08b3678`** | 08:47Z to 08:52Z | **the reviewed tree.** Merges the Codex illustration work, which touched `components/detail-layout.tsx` and `app/globals.css` |
| `e117a61` | 08:52Z to 08:56Z | 375 px capture pass; console and docs only |
| `41ea2c5` | 09:00Z onward | live at the time of writing |

I verified with `git diff` that the reviewed screens are **byte-identical across `08b3678`,
`e117a61` and `41ea2c5`** for `app/policies/[policyId]/page.tsx`, `correction-sections.tsx`,
`app/ops/reconciliation/`, `app/broker/statements/`, `app/statements/`, `detail-layout.tsx`,
`journal-table.tsx`, `amount-explained.tsx`, `disclosures.tsx`, `globals.css`, `error.tsx` and
`not-found.tsx`. The evidence therefore describes one behaviour, even though the deployment
identifier changed underneath it. The `41ea2c5` health response was read again at 09:03Z, after
the last measurement.

**A first capture pass ran against `d786644` and was discarded**, not merged into this record: the
illustration merge changed the layout result materially (see F-B13-30 history below), so mixing
the two would have described a tree that never existed. The screenshots in
`docs/evidence/b13-screens/` are all from `08b3678`/`e117a61`.

---

## How this was measured

Playwright is **not** a dependency of this repository (`node_modules/.bin/playwright` is absent and
`package.json` has no Playwright entry), but five Chromium builds are in the user's shared
`ms-playwright` cache. I installed `playwright-core@1.61.0` **in the scratchpad, never in the
repository**, because that version resolves to the cached `chromium-1228`, and drove the real
browser. So this is a rendered-browser measurement, not a code reading. It is the first one in
this repository: `docs/reviews/ui-polish.md` states plainly that 375 px was "Not measured", and
F-UI-25 was closed "in code, still not verified visually".

The overflow test is the one the brief specifies, and nothing softer:
`document.documentElement.scrollWidth` against `window.innerWidth`, read in the page.

Two measurement traps were hit and fixed, which is why the numbers below can be trusted:

1. **A silently signed-out context measures the login page.** An early pass reported "no overflow"
   on screens that overflow, because the login submit had bounced back to `/login` and the script
   measured a short public page. The capture script now asserts that login left `/login`, retries
   four times, and records the final URL and `<h1>` of every shot. Two later runs did fail login
   and threw instead of reporting a clean result.
2. **Measuring before layout settles.** `domcontentloaded` alone is too early. Every shot now waits
   for `load` plus 1800 ms, and every reported number was reproduced by a second, independently
   written script (`diag2.mjs`) that walks named selectors rather than the whole DOM.

Sandbox only. GET requests plus the login POST; no other form was submitted, no job was run, no
money moved, nothing was written. The demo password was loaded with `process.loadEnvFile` from
`.env.local` and never echoed, never passed on a command line, and never written to any file in
this record or its evidence.

---

## Requirement matrix

| # | Requirement (from the slice and the assignment) | Evidence | Verdict |
|---|---|---|---|
| 1 | Three screens x five states, captured at 375 px and 1280 px | 36 PNGs in `docs/evidence/b13-screens/`, 2.9 MB | PASS |
| 2 | Nothing overflows horizontally at 375 px; the body must not scroll sideways | 28 shots, `scrollWidth == innerWidth` on all of them | PASS as rendered |
| 2b | ... including the states a reader reaches by opening a fold | one click: 375 -> 731 px on two screens | **FAIL (F-B13-30)** |
| 3 | Amounts stay aligned and readable | 1444 `td.amount`/`th.amount` cells measured, **0** not right-aligned | PASS |
| 4 | Every state names itself in words | every empty and error state carries a sentence, quoted below | PASS |
| 5 | Error states carry no stack trace | 9 stack/digest markers searched in the rendered text of 28 states: **0 hits** | PASS |
| 6 | No secret and no unmasked personal data appears | 0 `sk_`/`whsec_`/`Bearer` matches; only `customer@example.com`, a seeded demo identity | PASS |
| 7 | Integration-mode labels visible where a simulated record is shown | reconciliation carries both chips; no simulated record appears on the other two screens | PASS, with F-B13-34 |
| 8 | The as-of control changes the figures | $1,200.00 -> $2,400.00, limits 1M/2M -> 2M/4M | PASS |
| 9 | A loading state exists | no `loading.tsx` anywhere; nothing on screen says "loading" | **gap (F-B13-31)** |

### Automatic-fail mapping for this scope

| Rule | Applicability here | Result |
|---|---|---|
| AF-01 | reviewed on the deployed URL, not localhost | PASS for this scope |
| AF-02 | do the screens claim a simulation is live | PASS; reconciliation names both modes on the page, never behind a fold |
| AF-03 | no money row is written by a GET; I submitted no form | NOT APPLICABLE to this scope |
| AF-04 | sandbox only, seeded identities | PASS; only `customer@example.com` appears |
| AF-05 | no secret printed in this record or its evidence | PASS; password loaded via `process.loadEnvFile`, never echoed |
| AF-06 | can these screens be defended line by line | one type lie found (F-B13-32); walkthrough NOT REVIEWED WITH YOANN |

---

## 1. Horizontal overflow at 375 px

The headline number, for all 28 non-loading shots:

| Screen | State | 375 px `scrollWidth` | 1280 px `scrollWidth` |
|---|---|---|---|
| policy | default, empty, error, edge | 375 | 1280 |
| policy | wrong id (404) | 375 | 1280 |
| reconciliation | default, empty, error, edge | 375 | 1280 |
| statement | list, run, empty run, edge | 375 | 1280 |
| statement | unknown run (404) | 375 | 1280 |

**As rendered on arrival, no screen scrolls sideways at either width.** Every wide table sits in a
`.table-scroll` region with `overflow-x: auto`, and at 375 px those regions do scroll internally
(`clientWidth` 277, `scrollWidth` 948 on the breaks table), which is the intended behaviour: the
table scrolls, the page does not.

This is a change that landed during the review. On `d786644` the same measurement was
**864 px on the policy screen, 1023 px on reconciliation and 811 px on the statement run**, all at
`innerWidth` 375, because `.detail-main` was `display: grid` with no `grid-template-columns`: its
implicit single column is an `auto` track, sized to the max-content of the widest `.panel`, and an
`auto` track is not clamped by its container. `08b3678` added
`grid-template-columns: minmax(0, 1fr)` to `.detail-main, .detail-aside` (`app/globals.css:1502`),
which is exactly the correction that defect needed. I re-measured after the merge and confirm it
is fixed: the track computes to `329px` instead of `999.953px`. I claim no credit for this; the
illustration branch fixed it independently.

### F-B13-30: the same defect survives one class down, and a single click reaches it

`.fact` (`app/globals.css:1569`) declares `display: grid` and `min-width: 0` but **no
`grid-template-columns`**. Its `min-width: 0` protects the box from widening its own parent track;
it does nothing about the track *inside* it, which is again `auto`, again max-content sized.

Nothing shows while the folds are closed: a closed `<details>` is laid out but contained, so it
never extends the document. Open one, and the box expands. Measured, one fold, on `08b3678`:

| Screen | Fold opened | `scrollWidth` closed | `scrollWidth` after one click | Overflow |
|---|---|---|---|---|
| policy detail, 375 px | first "Explain this amount" | 375 | **731** | **+356 px** |
| statement run, 375 px | first "Explain this amount" | 375 | **731** | **+356 px** |
| policy detail, 375 px | first "Sandbox references" | 375 | 375 | none |
| statement run, 375 px | first "Sandbox references" | 375 | 375 | none |
| reconciliation, 375 px | first "Sandbox references" | 375 | 375 | none |
| all three, 1280 px | either fold | 1280 | 1280 | none |

The containing chain, read from the open panel outward at 375 px, names the box:

```
<div class="amount-explain-panel">  w=668  right=731
<details class="amount-explain">    w=668
<div class="amount-explained">      w=668
<dd>                                w=668           min-width: auto
<div class="fact">                  w=279  clientW=277  display=grid  cols=668px   <-- here
<dl class="facts">                  w=279                display=grid  cols=279px  (correct)
<section class="panel">             w=329
<div class="detail-main">           w=329                display=grid  cols=329px  (fixed at 08b3678)
<body>                              w=375  scrollWidth=731
```

`.facts` sizes its columns correctly (`repeat(auto-fit, minmax(150px, 1fr))`). `.fact` resolves to
a single `668px` track inside a 277 px content box. The 668 px comes from the panel's max-content:
the explanation sentence and the `.note` paragraph lay out on one unbroken line, 642 px wide.

**Consequence.** "Explain this amount" is the slice-B12 feature that proves a figure against the
ledger, and it is the affordance a reader is most likely to use on the two money screens. On a
phone, using it once pushes the whole page 356 px wider than the viewport: the reader must scroll
the page sideways to read the explanation, and the rest of the layout, including the amount column
they were checking, slides off screen. The `.table-scroll` escape hatch inside the panel does not
help, because the panel itself, not its table, is what widened.

**Required correction.** One line, the same one `08b3678` applied one level up:

```css
.fact { grid-template-columns: minmax(0, 1fr); }
```

Re-measure `document.documentElement.scrollWidth` with a fold open at 375 px afterwards; the code
reading alone is what let this survive the previous two UI reviews.

**Severity MEDIUM.** No money is wrong, no data leaks, and the desktop width is unaffected. It
breaks an explicit acceptance criterion of this slice ("nothing overflows horizontally at 375 px")
in a state a normal reader reaches with one click.

**Evidence:** `policy-fold-explain-375.png`, `statement-run-fold-explain-375.png`.

---

## 2. The five states, on each screen

### Policy detail, CGP-01707 (`3c3697b7-33f8-45a4-beaf-5a1892fc9483`), staff session

| State | URL | What is on screen |
|---|---|---|
| default | `/policies/<id>` | h1 `Policy CGP-01707`, chips `bound` and `KYB approved`, 76 amount cells |
| loading | same, throttled | see section 3 |
| empty | same, empty panels | "The customer has not asked for anything on this policy.", "No claim on this policy." |
| error | `?asOf=banana&junk=%%%` | `Nothing to show on banana: "banana" is not a calendar date` |
| error (wrong id) | `/policies/not-a-uuid` | HTTP 404, `This page couldn't be found.` |
| edge | `?asOf=2026-09-08` | the policy before the 2026-10-08 endorsement, 85 amount cells |

The as-of refusal is well built. `policyAsItStoodOn` validates the date before it queries anything
(`lib/policy/correction-read.ts:411`), and a date the policy cannot answer is refused by name
rather than guessed at. Every hostile value I sent came back as a sentence, HTTP 200, no trace:

| `asOf` | Answer |
|---|---|
| `2020-01-01` | `no issued policy event effective on or before 2020-01-01` |
| `2026-13-45` | `"2026-13-45" is not a calendar date` |
| `%%%` | `"%" is not a calendar date` |
| `1' OR 1=1--` | `"1' OR 1=1--" is not a calendar date` |
| `asOf=A&asOf=B` | refused, but printed twice in two different shapes (F-B13-32) |

A malformed policy id is a 404, not a 500: `if (!isUuid(policyId)) notFound();`
(`app/policies/[policyId]/page.tsx:85`), with the reason recorded in the comment beside it.

**The as-of control changes the figures**, verified on the deployed revision:

| | `asOf=2026-09-08` | `asOf=2026-10-08` |
|---|---|---|
| Annual premium in force | $1,200.00 | **$2,400.00** |
| CA premium tax (2.35%) | $28.20 | **$56.40** |
| Total for a full annual term | $1,253.20 | **$2,481.40** |
| General Liability, each occurrence | $1,000,000.00 | **$2,000,000.00** |
| General Liability, aggregate | $2,000,000.00 | **$4,000,000.00** |

### Reconciliation breaks (`/ops/reconciliation`), staff session

| State | URL | What is on screen |
|---|---|---|
| default | `/ops/reconciliation` | 22 open breaks, chips `Stripe: LIVE SANDBOX` and `claim payout rail: LOCAL SIMULATOR` |
| loading | same, throttled | see section 3 |
| empty | same, empty panels | "Every clearing account is at zero: ...", "No break has been resolved yet." |
| error | `?error=...&ran=%%%` | the message printed in a `role="alert"` paragraph |
| edge | oldest break, negative amount | a refund break at `-$8.98`, provider side only, ledger `no record` |

The screen refuses to call a failed run clean, which is the exact mistake the brief names. A failed
latest run is promoted to a banner above everything ("compared nothing: ... Nothing below has been
re-examined for that source since"), the run row prints "FAILED, no comparison was made" instead of
a zero, and the "Compared" cell says "nothing: the run never got its records". No run had failed
during the review, so I read that path in the source rather than on screen; I did not fabricate a
failure to see it.

A missing side is `no record`, not `$0.00` (`money()` at the foot of the page), which is the right
distinction for a reconciliation screen.

### Broker statement (`/broker/statements` and `/statements/<runId>`), broker session

| State | URL | What is on screen |
|---|---|---|
| default (list) | `/broker/statements` | 5 runs, month, revision, cutoff, collected, commission, clawback, net due |
| default (run) | `/statements/c775c8ce-...` | 2026-09 revision 3, chips `ties to the ledger`, `provisional`, `format changed since revision 1` |
| loading | same, throttled | see section 3 |
| empty | `/statements/8effa7c1-...` | 2027-09, every figure $0.00, "No premium was collected and no commission moved for this broker in 2027-09. An empty statement is a real statement: it says the month was quiet, not that nothing was looked at." |
| error | `/statements/00000000-0000-4000-8000-000000000000` | HTTP 404, `This page couldn't be found.` |
| edge | 2026-09 revision 3 | clawback line `-$475.06`, journal line `-$1,253.20` / `-$1,200.00` |

The empty statement sentence is the best piece of writing on the three screens: it distinguishes
"nothing happened" from "nothing was looked at", which is the same distinction the reconciliation
screen makes about failed runs. Worth keeping.

The clawback edge state renders the negative figures with a leading minus and keeps them
right-aligned in their column, next to their own "Explain this amount" fold.

---

## 3. The loading state

There is no `loading.tsx` anywhere in `app/`. `find app -name "loading.tsx"` returns nothing; the
only framework boundaries are `app/error.tsx` and `app/not-found.tsx`.

So I measured what a user actually sees. Each screen was opened from another page over a throttled
connection (20 kB/s, 700 ms latency) and screenshotted 1200 ms into the navigation, while it was
still in flight:

| Screen | Width | `document.readyState` | `<h1>` already painted | Blank? | Spinner or skeleton? | Any word saying "loading"? |
|---|---|---|---|---|---|---|
| policy | 375 | loading | `Policy CGP-01707` | no | no | no |
| reconciliation | 375 | loading | `Reconciliation` | no | no | no |
| statement run | 375 | loading | `Redwood Commercial Brokers, 2026-09` | no | no | no |
| policy | 1280 | loading | `Policy CGP-01707` | no | no | no |
| reconciliation | 1280 | loading | `Reconciliation` | no | no | no |
| statement run | 1280 | loading | (not yet) | no | no | no |

**What the user sees is good and is not a blank screen.** The server streams the document, so the
shell, the sidebar, the breadcrumb, the identity band, the heading and the primary action buttons
are painted and usable while the panels below are still arriving. The last row shows an even
earlier moment, with the shell up and the heading not yet rendered.

**What is missing is any word.** No spinner, no skeleton, no `aria-busy`, no `role="status"`, and
no sentence saying the page is still loading. The slice owes five states each of which "names
itself in words"; the loading state does not name itself. That is F-B13-31, LOW: the behaviour is
sound, the labelling is absent, and a reviewer looking for the fifth state will not find one.

Evidence: `<screen>-loading-<width>.png`, six files.

---

## 4. Amounts, secrets and personal data

**Alignment.** 1444 `td.amount` and `th.amount` cells across the 28 shots. Computed `text-align`
is `right` on **every one of them**; zero exceptions at either width. The journal blocks use a
`<colgroup>` with two fixed amount columns and, since `fea572c` (F-UI-25), narrower ones under
580 px; at 375 px the entry blocks lay out inside their panel with no sideways push.

**Stack traces.** The rendered text of all 28 states was searched for `at Object.`, `at async`,
`.tsx:`, `.ts:`, `node_modules`, `webpack-internal`, `Digest:`, `PostgresError` and a newline
followed by `    at `. **Zero hits.** Both framework boundaries print a sentence and an action:
`app/error.tsx` does not even accept the `error` prop, so it cannot leak a digest, and
`app/not-found.tsx` says "The link may be incomplete, or this record is no longer available to
your account", which does not disclose whether the record exists.

**Secrets.** Zero matches for `sk_live_`/`sk_test_`, `whsec_` and `Bearer <token>` in the rendered
text of any state. Stripe `pi_`/`re_` identifiers are present, deliberately, behind the "Sandbox
references" folds; those are sandbox object references, not credentials, and the trial requires
them to be traceable.

**Personal data.** One email address renders anywhere in the 28 states: `customer@example.com`, the
seeded demo customer, shown to a staff reader on the policy they administer. That is a synthetic
identity from the seed script, not real personal data, so AF-04 holds.

---

## 5. Integration-mode labels

The reconciliation screen does this properly, and says why in a comment: both chips sit in the
heading, never behind a disclosure, because "what is live and what is simulated is the first thing
a reader has to know (AF-02)". Every row of both break tables also names its own source, as
`Stripe (LIVE SANDBOX)` or `Claim payout rail (LOCAL SIMULATOR)`.

Measured presence of the two labels in the rendered text:

| Screen | `LIVE SANDBOX` | `LOCAL SIMULATOR` |
|---|---|---|
| reconciliation, all 4 states, both widths | yes | yes |
| policy detail, all states, both widths | no | no |
| broker statements list and run, all states | no | no |

**This is not an AF-02 violation.** Neither the policy screen nor the statement screen displays a
record produced by the local simulator: CGP-01707 has no claim, and the statement figures derive
from Stripe collections and refunds. Nothing simulated is being presented as live. Both screens
also carry the shell's sandbox affordance ("Sandbox: Sandbox providers and test data. No real
money.").

It is an inconsistency worth one line: the money on the policy and statement screens is
LIVE SANDBOX money, and only the reconciliation screen says so in those words. Recorded as
F-B13-34, LOW.

---

## Findings

### F-B13-30 (MEDIUM, blocking) One click on "Explain this amount" makes the page scroll sideways at 375 px

`.fact` (`app/globals.css:1569`) is `display: grid` with no `grid-template-columns`, so its
implicit column is an `auto` track sized to max-content. With one fold open, the track computes to
`668px` inside a 277 px content box and `document.documentElement.scrollWidth` goes from 375 to
**731** on the policy detail and on the statement run. Same class of defect as the `.detail-main`
one that `08b3678` fixed one level up. Sandbox-reference folds are unaffected, and 1280 px is
unaffected. Correction: `.fact { grid-template-columns: minmax(0, 1fr); }`, then re-measure with a
fold open rather than re-reading the CSS.
Evidence: `policy-fold-explain-375.png`, `statement-run-fold-explain-375.png`.

### F-B13-31 (LOW) No state names itself as loading, on any of the three screens

No `loading.tsx` exists anywhere in `app/`. Measured mid-navigation on a throttled connection: the
shell and the heading are already painted, the page is never blank, and there is no spinner, no
skeleton, no `aria-busy`, no `role="status"` and no sentence saying the page is loading. The
behaviour is good; the fifth state the slice owes is unnamed. Correction: either add one
`app/loading.tsx` naming the wait, or record in the handoff that streamed server rendering is the
loading design and that this is deliberate.
Evidence: six `<screen>-loading-<width>.png`.

### F-B13-32 (LOW, AF-06) `asOf` is declared `string` but a repeated parameter delivers `string[]`

`app/policies/[policyId]/page.tsx:74` types `searchParams` as `{ ... asOf?: string }`. Next.js
gives an array when a parameter repeats. `?asOf=2026-09-08&asOf=2026-10-08` returns HTTP 200 and is
correctly refused, but prints the same value two ways in one sentence: "Nothing to show on
**2026-09-082026-10-08**: "**2026-09-08,2026-10-08**" is not a calendar date", because React
concatenates the array while the template string comma-joins it. No crash, no wrong figure, no
security consequence; the declared type does not describe the value, which is exactly what AF-06
asks to avoid. Correction: type it `string | string[] | undefined` and take the first entry, or
say in a comment that the array case is deliberately left to the calendar-date refusal.

### F-B13-33 (LOW) Scroll regions carry counter-generated names, and two of them share one

`aria-label="Reconciliation table 3"`, `"Statements table 1"`, `"Policy details table 3"`, `"4"`,
`"5"`. These name nothing a reader could use. The shared `BreakTable` in
`app/ops/reconciliation/page.tsx` hardcodes `aria-label="Reconciliation table 3"` and is rendered
twice, for "Open breaks" and for "Breaks that went away", so once a break resolves a screen-reader
user hears the same meaningless name for two different tables. On the deployed data only one is
rendered today, because the resolved list is empty, so this is a code reading confirmed against a
single-instance runtime. The same file already gets this right elsewhere:
`aria-label="Reconciliation runs"` and `"Clearing balances"`. Correction: pass the label in, as
`ageColumn` already is.

### F-B13-34 (LOW) Only one of the three screens names its integration mode in words

The reconciliation screen carries `Stripe: LIVE SANDBOX` and `claim payout rail: LOCAL SIMULATOR`
as chips and repeats the mode on every row. The policy detail and the broker statement show
LIVE SANDBOX Stripe money with no per-slot chip, only the shell's generic sandbox note. Neither
screen displays a simulated record, so AF-02 is satisfied and this is consistency, not a
misrepresentation. Correction: either add the `Stripe: LIVE SANDBOX` chip to those two headings, or
record that the per-slot chip is deliberately reserved for the reconciliation screen.

---

## Checks actually executed

| Check | Result |
|---|---|
| 28 rendered states, `scrollWidth` vs `innerWidth`, two widths | all equal; 0 overflowing states as rendered |
| the same measurement with one fold open, 5 cases x 2 widths | 2 overflow by +356 px at 375 px (F-B13-30) |
| the same measurement with every fold open, 4 screens x 2 widths | policy +429 and +150, statement run +356, reconciliation and list clean |
| independent re-measurement with a second script walking named selectors | reproduced every number |
| 1444 amount cells, computed `text-align` | 0 not right-aligned |
| 9 stack-trace and digest markers over 28 rendered states | 0 hits |
| secret-shaped strings (`sk_`, `whsec_`, `Bearer`) over 28 states | 0 hits |
| email addresses rendered over 28 states | only `customer@example.com`, seeded |
| 5 hostile `asOf` values, including a SQL-injection string | all refused by name, HTTP 200, no trace |
| malformed policy id, unknown statement uuid | HTTP 404 with a sentence, no leak of existence |
| as-of figures at two dates | premium, tax, total and both limits all change |
| loading state, throttled, mid-navigation, 3 screens x 2 widths | never blank, heading painted, no named loading state |
| integration-mode labels in rendered text, all states | reconciliation yes, other two no |
| login assertion on every browser context | 2 real login failures caught and retried, not reported as clean |
| deployed revision read before and after each capture batch | recorded in the table above |

Commands are in the scratchpad scripts (`capture.mjs`, `diag2.mjs`, `one-fold.mjs`, `chain.mjs`,
`loading.mjs`, `opened.mjs`); the raw per-state JSON is `measurements-375.json` and
`measurements-1280.json`. None of them is committed: they are review instrumentation, not
repository code, and they read `.env.local` at runtime.

## Checks not executed, and why

- **A policy with no journal entries.** Not reachable on the trial data. All four policies have
  entries: CGP-01707 and CGP-01274 and CGP-01062 are bound or cancelled, and the voided CGP-01061
  (`de2fb99f-8db4-4aa3-9ee5-827e444ab5ad`) carries 8 entries including 4 reversals. The policy page
  does have a correct guard for it (`entries.length === 0` renders "Nothing has been posted yet.
  The four issuance entries are written when Stripe confirms the payment."), read in the source at
  `app/policies/[policyId]/page.tsx:907`. I captured the reachable empty panels instead and did not
  invent a policy.
- **A reconciliation window with no breaks.** No URL selects one: the window is a POST-only form
  field on `/api/jobs/reconcile`, and the "Open breaks" panel is global with no window filter, so
  there is no GET that shows the "No open break" branch. I did not run a job, because running one
  writes. The claim payout rail does report "no break" in the Runs table for every one of its runs,
  which is the same fact seen from the run side. Gap recorded, not worked around.
- **A break older than 24 hours.** Not present. The 22 open breaks were 15 hours and 3 hours old at
  09:03Z (14 and 2 hours when I first looked). I used the negative-amount refund break
  (`re_3UDKq0K6R3v50tIy11aPmuHK`, provider `-$8.98`, ledger `no record`) as the reconciliation edge
  state instead, and say so rather than claiming an age I did not see.
- **A failed reconciliation run on screen.** None had failed. The failed-run banner, the "FAILED, no
  comparison was made" cell and the "nothing: the run never got its records" cell were read in the
  source only. I did not induce a failure.
- **Keyboard, screen-reader and contrast audits.** Out of the assigned scope, which is the five
  states at two widths. F-B13-33 is the one accessibility item I raise, because it fell out of the
  markup I was already reading.
- **Any write path.** No form other than the login POST was submitted, per the assignment.
- **The customer view of the policy** (`customer-view.tsx`) and `/ops/statements`. Different screens,
  not in the three named.

---

## Verdict and residual limitations

**FAIL** for slice B13-1 at `08b3678`, on F-B13-30. The three screens are otherwise in good shape:
the five states exist and all but the loading one name themselves in plain sentences, the error
paths refuse by name with no stack trace and no existence leak, the amounts are uniformly aligned
across 1444 cells, the as-of control genuinely re-renders the policy for a business date, and the
reconciliation screen labels its two integration modes exactly where AF-02 wants them.

The one blocking finding is a single missing CSS declaration whose fix is already present one level
up in the same file, and it is reachable in one click on the two money screens at phone width.

Residual limitations of this review:

- It is a rendered-browser assessment of **twelve URLs in five states**, not an audit of the
  application. Nothing here says anything about ledger correctness, authorization, or any screen
  outside the three named.
- The deployment moved five times while I worked. I pinned the reviewed tree to `08b3678` and
  verified by diff that the reviewed files are byte-identical through `41ea2c5`, but a later
  revision can invalidate this record without changing its SHA.
- `.fact` is not the only grid in `app/globals.css` declared without explicit columns. I checked the
  boxes on the reading path of these three screens; I did not sweep the stylesheet, and the same
  latent defect may exist elsewhere. `DetailGrid` alone is used by 10 pages.
- The overflow numbers are from Chromium 1228 at `deviceScaleFactor` 1. I did not test Safari or
  Firefox, and iOS Safari in particular handles `min-width: auto` on grid items differently.
- This is an engineering check, not legal certification, and no part of it establishes Yoann's
  understanding of the code.

**Walkthrough status: NOT REVIEWED WITH YOANN.**

---

## Register lines for the coordinator

| ID | Severity | Finding | Required correction | Status |
|---|---|---|---|---|
| F-B13-30 | MEDIUM | One click on "Explain this amount" makes the policy detail and the statement run scroll sideways at 375 px: `.fact` is a grid with no `grid-template-columns`, so its `auto` track sizes to max-content (668 px inside a 277 px box) and `documentElement.scrollWidth` goes 375 to 731 | `.fact { grid-template-columns: minmax(0, 1fr); }`, the same fix `08b3678` applied to `.detail-main`; re-measure with a fold open, not by re-reading the CSS | OPEN |
| F-B13-31 | LOW | No `loading.tsx` anywhere in `app/`, and nothing on screen names the wait: no spinner, no skeleton, no `aria-busy`, no sentence. The page is never blank (the shell and heading stream in first), so the behaviour is sound and only the label is missing | Add one `app/loading.tsx`, or record streamed rendering as the deliberate loading design in the handoff | OPEN |
| F-B13-32 | LOW | `asOf` is typed `string` but a repeated query parameter delivers `string[]`: the refusal is correct, but the same value prints two ways in one sentence ("on 2026-09-082026-10-08" then "2026-09-08,2026-10-08") | Type it `string \| string[] \| undefined` and take the first entry, or state that the array case is left to the calendar-date refusal | OPEN |
| F-B13-33 | LOW | Scroll regions are named by a counter (`Reconciliation table 3`, `Statements table 1`, `Policy details table 3/4/5`), and the shared `BreakTable` hardcodes one label for both the open and the resolved tables, so two regions will share a meaningless name once a break resolves | Pass the label in, as `ageColumn` already is | OPEN |
| F-B13-34 | LOW | Only the reconciliation screen names its integration mode in words; the policy detail and the broker statement show LIVE SANDBOX Stripe money with no per-slot chip. Not an AF-02 violation: neither screen displays a simulated record | Add the `Stripe: LIVE SANDBOX` chip to both headings, or record that the chip is reserved for the reconciliation screen | OPEN |

## Evidence

`docs/evidence/b13-screens/`, 36 PNGs, 2.9 MB, all captured on `08b3678`/`e117a61` (byte-identical
for these screens), Chromium 1228, `deviceScaleFactor` 1.

- `<screen>-<state>-<width>.png` for the five states of the three screens at 375 and 1280:
  `policy`, `reconciliation`, `statement`, with states `default`, `loading`, `empty`, `error` and
  `edge`, plus `policy-error-wrong-id`, `statement-default-run` and `statement-empty` for the
  statement run itself.
- `policy-fold-explain-375.png` and `statement-run-fold-explain-375.png`: the F-B13-30 overflow,
  captured with a single fold open.

---

# Re-review: `3e9d095`, F-B13-30 fixed

**Timestamp:** 2026-09-09T09:14:00Z. **Deployed revision re-measured:**
`3e9d0958e883a7fee03578c609f9501fb1f6c4c4`, confirmed on `/api/health` immediately before and
immediately after every reading below.

## What changed

The stylesheet delta between `08b3678` and `3e9d095` is three lines, and they are exactly the
correction this record asked for:

```css
.fact {
  display: grid;
  /* F-B13-30: one explicit column that can shrink; an implicit auto track sizes to the widest
     fold and made the page scroll sideways at 375 px once an explanation opened. */
  grid-template-columns: minmax(0, 1fr);
  ...
}
```

Nothing else in the stylesheet moved. The same commit also touches `app/inbox/page.tsx`,
`app/ops/console/page.tsx` and `components/what-needs-you.tsx`, none of which is on any of the three
reviewed screens.

## The measurement, on the exact case recorded above

375 px, both signed-in contexts, one real click on the first "Explain this amount" summary (a
`locator.click()`, not a scripted `details.open = true`, so the B12-4 reveal actually runs: 922 and
1820 characters of explanation were revealed before the reading was taken).

| Screen | Context | `scrollWidth` closed | `scrollWidth` with the fold open | `innerWidth` | Panel width | Verdict |
|---|---|---|---|---|---|---|
| policy detail CGP-01707 | `ops@example.com` | 375 | **375** | 375 | 249 px (was 668) | no sideways scroll |
| statement run 2026-09 rev 3 | `broker@example.com` | 375 | **375** | 375 | 249 px (was 668) | no sideways scroll |

Previously, at `08b3678`: 375 to **731** on both, an overflow of +356 px. The `.fact` track now
computes to the container width instead of the panel's max-content, and the panel's own inner
tables scroll inside their `.table-scroll` regions, which is the intended behaviour.

The other folds were re-measured at the same time and remain clean: sandbox references on all three
screens at 375 px, and every fold on all three screens at 1280 px.

## No regression at 1280 px

All 14 desktop states re-measured on `3e9d095`, and every number matches what this record captured
at `08b3678`:

| Check | `08b3678` | `3e9d095` |
|---|---|---|
| states with horizontal overflow | 0 of 14 | **0 of 14** |
| widest `.panel` (policy, reconciliation, statement run) | 556 px | **556 px** |
| widest `.panel` (statements list) | 918 px | **918 px** |
| amount cells not right-aligned | 0 of 722 | **0 of 722** |
| stack-trace markers | 0 | **0** |
| secret-shaped strings | 0 | **0** |
| emails rendered | `customer@example.com` only | **unchanged** |
| both integration chips on reconciliation | yes | **yes** |

## Verdict

**F-B13-30: RESOLVED at `3e9d095`.** Verified by measurement on the deployed application, not by
reading the diff.

F-B13-31, F-B13-32, F-B13-33 and F-B13-34 were not in scope for this fix and remain OPEN and
unchanged. **The slice verdict moves from FAIL to PASS**, with those four LOW items outstanding.

**Walkthrough status: still NOT REVIEWED WITH YOANN.**

### Evidence

Both states are kept, so the finding and its fix can each be seen:

- `policy-fold-explain-375.png`, `statement-run-fold-explain-375.png`: the overflow at `08b3678`.
- `policy-foldfixed-explain-375.png`, `statement-run-foldfixed-explain-375.png`: the same fold, same
  width, at `3e9d095`, fully revealed and inside the viewport.

### Register line, updated

| ID | Severity | Finding | Required correction | Status |
|---|---|---|---|---|
| F-B13-30 | MEDIUM | One click on "Explain this amount" made the policy detail and the statement run scroll sideways at 375 px: `.fact` was a grid with no `grid-template-columns`, so its `auto` track sized to max-content (668 px inside a 277 px box) and `documentElement.scrollWidth` went 375 to 731 | `.fact { grid-template-columns: minmax(0, 1fr); }` | **FIXED `3e9d095`** (re-review: 375 stays 375 with the fold open on both screens, panel 668 to 249 px, 14 desktop states unchanged) |
