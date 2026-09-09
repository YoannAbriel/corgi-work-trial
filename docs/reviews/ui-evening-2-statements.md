# Review: STATEMENTS slice of the second evening UI batch

> **Current verdict: PASS**, recorded in the re-review at the end of this file (fix commit `dfc38ef`,
> all five findings resolved). The first pass below is kept unchanged as history, FAIL and all.

## First pass, base `0fadcfa`, head `426d8ff`

**Verdict: FAIL.** Two blocking findings (F-ST-01, F-ST-02), both small fixes on the list pages.
Everything the slice claims about the run page totals, the figures, the arithmetic, the PDF, the
grouping itself, the form and the roles is true and was checked against production.

## Startup receipt

Files actually read in full before reviewing: `CLAUDE.md`, `AUTOMATIC-FAILS.md`, `AGENTS.md`,
`WORKFLOW-48H.md`, `REVIEWER.md`. Read for scope: `lib/statements/compute.ts` (totals and net due
formula), `lib/statements/read.ts` (`listStatementRuns`, `StatementRunRow`), `lib/statements/pdf.tsx`
(totals block), `lib/documents/pdf-theme.ts` (`strongCell`), `lib/money/cents.ts`
(`formatCentsAsUsd`), `components/ui/table.tsx` (`Num`, `ExpandRow`, `FactGrid`),
`app/login/page.tsx`, `docs/reviews/FINDINGS.md` (register format). Absent files: none.
This is an implementation review, not a design review. No legal research was in scope for this
slice: it moves no money, adds no provider call and touches no SQL.

- Reviewer worktree: `/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/agent-ab600fffaf82542e5`
- Merged `ui-evening-2`, worktree HEAD **426d8ff** (merge of `d26b5b4`), working tree clean.
- Reviewed diff: `git diff 0fadcfa..ui-evening-2 -- app/statements app/ops/statements app/broker/statements components/statement-revisions.tsx app/styles/money.css lib/statements`, that is commits **baf1faf** and **30523a3**.
- `ui-evening-2` advanced to **ce22ea1** during the review (an unrelated policy Billing view, `5051e7a`). `git diff 426d8ff..ui-evening-2` restricted to the scope above is **empty**, so the slice I ran and the slice on the branch head are the same code. The Billing commit also changed `lib/inbox/sections.ts`; that is outside this review.
- Evidence produced under `/private/tmp/claude-501/-Users-yoannabriel-dev-corgi-work-trial/2cf3a4fc-98fd-48cb-ba5b-2a6ccd324ec6/scratchpad/st/`.

## Automatic-fail gate for this scope

| Rule | Applicability here | Result |
|---|---|---|
| AF-01 deployed URL | Production compared throughout at https://corgi-work-trial-iota.vercel.app | PASS for this scope; the slice is not deployed yet, which is expected |
| AF-02 simulation as live | Slice adds no provider path; the mode line is unchanged on every page read | PASS |
| AF-03 no UPDATE or DELETE on money rows | `git diff 0fadcfa..ui-evening-2 --stat -- lib/statements db app/api/statements scripts` is **empty**; the slice contains no SQL, no migration and no script. Every check I ran was a GET, plus the session login POST each script needs. I sent no POST to `/api/statements/run`. | PASS |
| AF-04 sandbox only | Trial database and demo accounts only; `.env.local` copied, gitignored, never printed | PASS |
| AF-05 no committed secrets | `gitleaks detect --source .`: 645 commits scanned, **no leaks found** | PASS |
| AF-06 explainable | Both new comment headers name the decision, the date and the person; `groupRunsByBrokerAndMonth` is 15 lines of plain grouping. Candidate walkthrough status is Yoann's to confirm and is **not** established by this review. | PASS on readability, walkthrough NOT RUN |

## Checks actually executed

Environment: `npm ci` (exit 0), `npx next dev -p 3044` on the merged worktree, `.env.local` copied
from the main checkout. Demo logins from `app/login/page.tsx`; `DEMO_PASSWORD` read from
`.env.local` by every script and never printed.

### Diff hygiene

| Check | Command | Result |
|---|---|---|
| Nothing outside the UI | `git diff 0fadcfa..ui-evening-2 --stat -- lib/statements db app/api/statements scripts` | empty |
| `lib/statements` untouched | same diff, `lib/statements` path | empty |
| Slice file list | scope diff `--stat` | 5 files, 304 insertions, 43 deletions, one of them new (`components/statement-revisions.tsx`) |
| No form change | `grep -E '^[-+].*(action=\|method=\|name=")'` on the scope diff | no match (exit 1) |
| No em or en dash | `grep -P '^[+].*[\x{2013}\x{2014}]'` on the scope diff | no match. Rendered pages also report 0 dash characters at 1440 and 375 |
| Secret scan | `gitleaks detect --source . --no-banner --redact` | no leaks found |
| Types | `npm run typecheck` | exit 0 |
| Tests | `npm test` | **540 pass, 0 fail, 1 skipped** (541 total), exit 0 |

### The run page totals, on Yoann's figures

Run `c0f845bd-a57c-4086-8796-c36375a021ba`, Redwood Commercial Brokers 2026-09 revision 5, found
from `/ops/statements` (it is the newest revision carrying $429.56; revisions 6 and 7 were produced
this evening and carry $437.45).

Rendered totals block, read off the DOM at 1440:

| Line | Value | Computed colour | Weight and size | Class |
|---|---|---|---|---|
| Commission earned | `$1,209.61` | `rgb(25,25,25)` | 400 / 15px | none |
| Clawback | `-$780.05` | `rgb(141,48,39)` = `#8d3027` = `var(--danger)` | 400 / 15px | `money-totals-negative` |
| Net due | `$429.56` | `rgb(25,25,25)` | **500 / 21px**, rule above | `money-totals-net` |

Block width `360px` as the CSS declares. The kept sentence "equals the journal movement" is under
the figure. "Other adjustments" is absent because `run.adjustmentCents === 0`.

**Arithmetic on screen**: $1,209.61 plus (-$780.05) = $429.56. Exact. The page's own explain drawer
prints the same subtraction in cents: `120961 - 78005 + 0 = 42956`, which agrees with
`lib/statements/compute.ts:360` `netDueCents: commissionEarnedCents - clawbackCents + adjustmentCents`.
The three printed terms are therefore the three terms of the stored formula, in order.

**Figures byte-identical against production.** The `\$[0-9,]+\.[0-9]{2}` multiset extracted from the
rendered page, on the same run id, on production (92379e2) and on the branch:

```
["$8,328.61","$8,064.11","$1,209.61","-$780.05","$429.56","-$1,253.20","-$1,200.00","$3,556.84",
 "$3,450.75","$1,253.20","$1,200.00","$1,253.20","$1,200.00","$2,391.33","$2,312.00","$346.80",
 "$517.61","$180.00","$180.00","-$180.00","-$2,081.09","-$2,033.30","-$3,241.56","-$3,167.13",
 "-$304.99","-$475.06","$1,127.24","$1,101.36","$165.20"]
```

Identical, same values and same order. Production still shows them as five tiles, the branch as two
tiles plus the subtraction block; not one cent moved.

Screenshots: `st/totals-1440.png`, `st/totals-375.png`,
`st/break-ops-1440/statements_c0f845bd-...-1440-a-plain.png`, `st/review-stmt-375/`.

### The PDF

Fetched with a session cookie from the dev server and from production for the same run.

Branch PDF, TOTALS block, read with `pdftotext -layout`, five labelled lines in this order:

```
Cash collected from customers (premium, tax and fee)          $8,328.61
Premium collected, which is the commission base               $8,064.11
Commission earned on that premium                             $1,209.61
Commission clawed back on refunded premium                     -$780.05
Net due to the broker                                          $429.56
```

Sign and weight as claimed: `lib/statements/pdf.tsx:204` prints `formatCents(-run.clawbackCents)`,
and `:213-215` puts `styles.strongCell` on both cells of the net due row, which
`lib/documents/pdf-theme.ts:385` defines as `{ fontFamily: PDF_FONT.bold }`. The PDF also prints
"Other adjustments to the commission owed" between the clawback and the net due when non zero
(`:206-212`), which is the same order the web page now uses.

`cmp` against the production PDF: **they differ** (branch 84,534 bytes, production 12,960 bytes,
first difference at char 343). That difference is **not** this slice. Two brand commits, `03be800`
and `799ad9d`, changed the document theme and compiled the wordmark in; `git merge-base --is-ancestor
03be800 92379e2` says NO, so production predates them, and both are ancestors of `0fadcfa`, the base
of this slice. Production's own TOTALS block prints the same five lines and the same figures.

The claim "byte-identical before and after this slice" is supported by the import graph rather than
by a rebuild: the slice diff touches no file the PDF route reads. `git diff 0fadcfa..ui-evening-2
--stat -- lib/statements/pdf.tsx app/api/statements` is empty, and the five changed files
(`app/statements/[runId]/page.tsx`, `app/ops/statements/page.tsx`, `app/broker/statements/page.tsx`,
`app/styles/money.css`, `components/statement-revisions.tsx`) are not in the PDF's import graph.
**I did not build the PDF from `0fadcfa` in a second worktree**, so I have no byte comparison of the
before and after; I have a proof that no input to the renderer changed.

### The two lists

`/ops/statements` as ops, at 1440, every `<details>` opened.

| | Production (92379e2) | Branch |
|---|---|---|
| Rows | 14, one per run | **3**, one per (broker, month) |
| Distinct run links in the HTML | 14 | **14** |
| Runs on production missing from the branch page | n/a | **none** (set difference computed both ways, empty) |

Branch rows, in order, with their folds:

```
ROW 1  Redwood Commercial Brokers  10 min  2026-09  rev 7 "6 earlier"  $437.45  provisional identical
       "The 6 revisions this one replaces"
       Revision 6  14 min  $437.45  provisional            -> /statements/8df46119-...
       Revision 5  37 min  $429.56  provisional identical  -> /statements/c0f845bd-...
       Revision 4  1 h     $429.56  provisional            -> /statements/c602abcf-...
       Revision 3  27 h    $389.35  provisional            -> /statements/c775c8ce-...
       Revision 2  27 h    $389.35  provisional identical  -> /statements/5321274f-...
       Revision 1  27 h    $389.35  provisional            -> /statements/de8416cd-...
ROW 2  Harbor Point Insurance Services  2 h  2026-09  rev 2 "1 earlier"  $0.00
       "The revision this one replaces"
       Revision 1  4 h  $0.00  provisional  -> /statements/245893de-...
ROW 3  Redwood Commercial Brokers  8 h  2027-09  rev 5 "4 earlier"  $0.00
       "The 4 revisions this one replaces"  (revisions 4, 3, 2, 1, newest first, each linked)
```

Confirmed: one row per broker and month; the row is the newest revision by `createdAt` (revision 7 at
10 minutes leads, not revision 1 by number); groups ordered newest first by that revision's age, so
a rerun of 2026-09 sits above 2027-09; the Revision cell carries "N earlier" as a `Num` sub-line; the
fold lists earlier revisions newest first with a link each. A month with one revision renders no
list: `EarlierRevisions` returns `null` at `components/statement-revisions.tsx:62-64`, and no
`stmt-earlier` block appears in the HTML of such a row.

`/broker/statements` as broker@example.com: 12 rows on production become **2 rows** on the branch,
**12 distinct run links preserved**, both months are Redwood's. The broker never sees Harbor Point's
two runs on either page.

**The "Run a statement" form is unchanged.** DOM read of every form on the page, production and
branch, identical:

```
{"action":"/api/statements/run","method":"post","fields":["brokerId","month","knowledgeCutoff"]}
```

(plus the unchanged `/api/session/logout` and `/ops/console/search` forms). No POST was sent.

**The Provisional tile.** Branch reads **3**, note "months whose newest revision is provisional".
Rows whose newest revision is provisional: **3** of 3. The two numbers agree. Production reads 14
with the old note, which is the one deliberate change and is disclosed in the code comment at
`app/ops/statements/page.tsx:66-69`.

### Roles and hostile paths

| Request | Branch | Production | Same? |
|---|---|---|---|
| `/ops/statements` as broker | 307 to `/broker` | 307 to `/broker` | yes |
| `/statements/e4ba3f53-...` (Harbor's newest) as broker | 200, body says "This statement belongs to another broker", no figure of any kind | identical | yes |
| `/statements/245893de-...` (Harbor's revision 1) as broker | 200, same refusal page | identical | yes |
| `/statements/not-a-uuid` | 404 | 404 | yes |
| `/statements/00000000-0000-0000-0000-000000000000` | 404 | 404 | yes |
| `/ops/statements?all=1` as ops | 200, 3 rows, unknown parameter ignored, no toast, no error | 200, 14 rows | behaviour unchanged |

The cross-broker run page answers **200 with a refusal page**, not 307 or 404, on the branch **and**
on production. That is pre-existing and unchanged by this slice, and it leaks nothing: the page
prints one sentence and no amount. Recording it as an observation, not as a finding of this slice.

### Narrow width

`WIDTHS=375 node break.mjs`, plain, all folds open, and scrolled.

| Page | Role | Horizontal overflow |
|---|---|---|
| `/ops/statements` | ops | **none** |
| `/statements/c0f845bd-...` | ops | **none** |
| `/broker/statements` | broker | **none** |
| `/broker/statements` at 1440 | broker | **none** |

No `HORIZONTAL OVERFLOW` line anywhere. The script also reported `BAND NOT STICKY` and, on the run
page, `BAND TOO TALL 198px`. Both reproduce on production for the same paths (`BAND TOO TALL 138px`),
so they are pre-existing and belong to the page band, which this slice does not touch. The band did
grow from 138 px to 198 px at 375 between production and the branch; that is another slice's change,
recorded here only so it is not lost.

## Findings

### F-ST-01 (MEDIUM, blocking): the fold drops the `format changed` chip, and the About says nothing is hidden

`components/statement-revisions.tsx:80-88` renders exactly two chips per earlier revision:
`provisional`/`closed` and `identical`. The row it replaced, `app/ops/statements/page.tsx:243-246`,
renders a third: `format changed`, shown when `previousCanonicalVersion !== canonicalVersion`.

Concrete trigger, verified against production: four runs carried that chip on the old list and no
longer carry it anywhere on the new one.

| Run | Production row | Branch fold line |
|---|---|---|
| Redwood 2026-09 rev 4 (`c602abcf`) | `provisional` `format changed` | `provisional` |
| Redwood 2026-09 rev 3 (`c775c8ce`) | `provisional` `format changed` | `provisional` |
| Redwood 2027-09 rev 3 (`5265f3fb`) | `provisional` `format changed` | `provisional` |
| Redwood 2027-09 rev 2 (`8effa7c1`) | `provisional` `format changed` | `provisional` |

Consequence. The chip is the screen's only warning that two revisions of the same month were written
in different formats and therefore **cannot be compared by hash**, which is exactly the question a
fold of superseded revisions exists to answer. It is still on each run's own page (checked: the
rendered page of `c602abcf` contains "format changed"), so the fact is one click away, not lost. But
the legend printed under the table, `app/ops/statements/page.tsx:39-44`, still names four terms while
only two of them can now appear on the table: `format changed` only ever reaches a row that is the
newest revision of its month, and `format v1` only ever reaches the newest revision's FactGrid at
`:269`. And the About paragraph added by this slice, `app/ops/statements/page.tsx:201-204`, states
**"Nothing is hidden"**, which is now false about this very screen.

Required correction: render the `format changed` chip in `EarlierRevisions` (the field is already on
`StatementRunRow`), or remove the term from `STATUS_LEGEND` and delete the "Nothing is hidden"
clause. Do not leave the legend and the About promising what the fold does not show.

### F-ST-02 (MEDIUM, blocking): "The N revisions this one replaces" is a count of the query window, not of the month

`components/statement-revisions.tsx:66-70` prints a definite heading, "The 6 revisions this one
replaces", and `app/ops/statements/page.tsx:231` and `app/broker/statements/page.tsx:168` print "6 earlier" on the row. Both are derived from
`month.earlier.length`, which counts only the runs that came back from
`listStatementRuns(sql, { limit: HOW_MANY_RUNS_SHOWN })` with `HOW_MANY_RUNS_SHOWN = 30`
(`app/ops/statements/page.tsx:36`, `app/broker/statements/page.tsx:28`).

Concrete trigger: any month whose revisions do not all fit inside the 30 newest runs of the whole
table. The fold then lists fewer revisions than the month has, and the heading and the "N earlier"
sub-line **state the truncated number as a fact about the month**. Nothing on either page says the
list is capped.

Consequence and why it is new. Before this slice the same cap existed, but it capped visible rows: a
reader saw a table that stopped, and no sentence claimed completeness. After it, the cap silently
changes the value of a printed count on a money document's history, next to a paragraph that says
"Nothing is hidden". Redwood 2026-09 alone already holds 7 of the 30 slots today, and 14 of 30 are
used across three months on a two-day-old database.

Required correction: either count a month's revisions independently of the display window (a
`count(*)` per group, or fetch by month once a month is on screen), or state the cap on the page and
soften the heading to what it actually is (for example "Earlier revisions in the last 30 runs").

### F-ST-03 (LOW): a zero clawback prints in the danger red

`app/statements/[runId]/page.tsx:258-261` puts the clawback line in `money-totals-negative`
unconditionally, and `app/styles/money.css:163-165` paints that class `var(--danger)`. When
`run.clawbackCents === 0`, `formatCentsAsUsd(-0)` correctly returns `"$0.00"` with no minus sign
(`lib/money/cents.ts:47`, `-0 < 0` is false), but the line is still red.

Verified on run `c2a6aa84-...`: the clawback `<dd>` computes to `rgb(141,48,39)` while reading
`$0.00`. Eight of the 14 runs on the trial database have a zero clawback, so this is the common case,
not an edge. The red says "money was taken back" on a month where none was.

Required correction: `className={run.clawbackCents === 0 ? undefined : "money-totals-negative"}`, the
same shape the adjustment line already uses one block below at `:267`.

### F-ST-04 (LOW): two new branches of the totals block are unproven at runtime

The third signed term (`app/statements/[runId]/page.tsx:266-271`) and the negative net due sentence
(`:272`, `:284-290`) were read in code but never rendered. I fetched all 14 run pages on the branch
and parsed each `.money-totals` section: **no run has `adjustmentCents !== 0` and no run has
`netDueCents < 0`**, so neither branch appears on any page of the trial database.

Consequence: the claim that a negative net due is red with a sentence saying the broker owes, and
that adjustments appear as a third signed term, rests on reading the JSX, not on evidence. The code
is correct as written (the sign of `adjustmentCents` drives the class, the sentence is gated on
`netDueCents < 0`, and the display sum matches `commissionEarned - clawback + adjustment`), but this
review records it as **NOT RUN**, not as PASS.

Required action: exercise both on an ephemeral database, or state the limitation wherever the slice
is claimed done. Do not book a demo on the negative net due sentence without seeing it once.

### F-ST-05 (LOW): the new grouping function is untested and sits where the test runner cannot see it

`groupRunsByBrokerAndMonth` (`components/statement-revisions.tsx:34-52`) is pure, reads no database
and touches no React, yet it decides which revision every reader of either list sees as "the latest"
and in which order months appear. It has no test. It cannot easily get one where it is: the runner is
`node --import tsx --test lib/*/*.test.ts lib/*/*/*.test.ts` (`package.json:33`), so a test file next
to it under `components/` would never be collected.

One case is genuinely undefined today. The comment at `:29-33` says "newest" is decided by
`createdAt` and never by the revision number. `Array.prototype.sort` is stable, so two revisions of
the same month sharing a `createdAt` to the millisecond keep whatever order the SQL returned, and the
row could show revision 4 while revision 5 exists. The stored `revision` is the tie-break the code
declines to use.

Required correction: move the function to `lib/statements/` and add cases for the group order, the
order inside a group, two brokers with the same name, and a `createdAt` tie.

## Observations, not findings

- At 1440 the `.money-totals` block is `max-width: 360px` inside a full-width column, leaving roughly
  800 px of empty ground to its right while the two collected tiles above span the full width. The
  CSS comment at `app/styles/money.css:126-127` says the narrowness is deliberate, and it does read
  well (see `st/totals-1440.png`). Recording it because the same page's own code comment treats
  "roughly 300 px of empty grey" as an accepted round-1 MEDIUM elsewhere.
- The PDF keeps the two collected figures inside the same box as the subtraction, while the web page
  now separates them on the grounds that they are not terms of it. Not wrong, just no longer the same
  reading on the two surfaces.
- The cross-broker run page answers 200 with a refusal sentence rather than 404 or 307, identically
  before and after. Out of this slice's scope, no figure leaked.

## Register lines

| ID | Severity | Finding | Required action | Status |
|---|---|---|---|---|
| F-ST-01 | MEDIUM | The earlier-revisions fold renders only two of the three row chips, so `format changed` disappears from both lists for four superseded runs while the legend and the new About paragraph ("Nothing is hidden") still promise it | Render `format changed` in `EarlierRevisions`, or drop the term from `STATUS_LEGEND` and the "Nothing is hidden" clause | OPEN |
| F-ST-02 | MEDIUM | "The N revisions this one replaces" and "N earlier" count only what fit inside the 30-run query window, and no page says the list is capped | Count a month's revisions independently of the display window, or state the cap and soften the heading | OPEN |
| F-ST-03 | LOW | A zero clawback prints `$0.00` in `var(--danger)` because `money-totals-negative` is applied unconditionally; 8 of 14 runs are affected | Apply the class only when `run.clawbackCents !== 0` | OPEN |
| F-ST-04 | LOW | The "Other adjustments" third term and the negative net due sentence render on no run of the trial database, so both are code-read only | Exercise both on an ephemeral database, or record the limitation where the slice is claimed done | OPEN |
| F-ST-05 | LOW | `groupRunsByBrokerAndMonth` has no test and lives outside the runner's glob; a `createdAt` tie between two revisions of one month has undefined winner | Move it to `lib/statements/` and test group order, order inside a group, duplicate broker names and a `createdAt` tie | OPEN |

## Residual limitations

- I did not rebuild the statement PDF from `0fadcfa`; the before-and-after byte claim rests on the
  slice touching no file in the PDF's import graph, which I verified by path-restricted diff.
- Both list pages were read on the trial database as it stood tonight: 14 runs, 3 broker-months, no
  closed month, no negative net due, no non-zero adjustment, no run older than 27 hours. The
  `closed` chip branch of `EarlierRevisions` was therefore never rendered either.
- This is a UI review. It says nothing about statement correctness beyond the arithmetic printed on
  one run page, and it is an engineering check, never a legal certification.

---

# Re-review, 2026-09-09 evening: fixes F-ST-01 to F-ST-05

**New verdict: PASS.** All five findings are corrected and each correction was checked by the same
method that found it. The figures, the run coverage, the form, the roles and the narrow-width result
are unchanged from the first pass. The prior findings and the FAIL verdict above are preserved as
history; nothing in this section overwrites them.

## What was re-reviewed

- Merged `ui-evening-2` again. Worktree HEAD **b07d4d5**; `ui-evening-2` at **a29beef**.
  `git diff b07d4d5..ui-evening-2` restricted to the reviewed scope is **empty**, so the branch head
  and the code I ran are the same.
- Fix commit **dfc38ef**, "ui(statements): review fixes F-ST-01 to F-ST-05", 6 files, 267 insertions,
  69 deletions: `app/broker/statements/page.tsx`, `app/ops/statements/page.tsx`,
  `app/statements/[runId]/page.tsx`, `components/statement-revisions.tsx`, and the two new files
  `lib/statements/group-runs.ts` and `lib/statements/group-runs.test.ts`.
- The only additions under `lib`, `db`, `app/api` or `scripts` across the whole slice are those two
  new files, a pure function and its test. Still no SQL, no migration, no script, no route.
- Hygiene re-run on the fix commit: no `action=`, `method=` or `name="` line (exit 1), no em or en
  dash (exit 1), `gitleaks detect --source .` over 662 commits reports **no leaks found**.
- `npm run typecheck` exit 0. `npm test` exit 0: **551 pass, 0 fail, 1 skipped** (552 total), up from
  540 pass. The five new tests are numbered 521 to 525 in the run and each reports `ok`.
- Dev server restarted on 3044 from the merged worktree and stopped by its port's PID at the end.
  GET only, plus the session login each script needs. No POST to `/api/statements/run`.

## Finding by finding

### F-ST-01 RESOLVED

`components/statement-revisions.tsx:56-62` now renders the third chip on a folded revision, under the
same condition the row uses (`previousCanonicalVersion !== null && previousCanonicalVersion !==
canonicalVersion`). The four runs named in the original finding carry it again, read off the rendered
`/ops/statements`:

| Run | First pass (branch) | Now |
|---|---|---|
| Redwood 2026-09 rev 4 (`c602abcf`) | `provisional` | `provisional` **`format changed`** |
| Redwood 2026-09 rev 3 (`c775c8ce`) | `provisional` | `provisional` **`format changed`** |
| Redwood 2027-09 rev 3 (`5265f3fb`) | `provisional` | `provisional` **`format changed`** |
| Redwood 2027-09 rev 2 (`8effa7c1`) | `provisional` | `provisional` **`format changed`** |

The same four appear on `/broker/statements` as broker@example.com for the two Redwood months. The
broker legend gained the term at `app/broker/statements/page.tsx:39`, so both legends now define
every chip their table can show, and all four legend terms are reachable again: `provisional` and
`identical` on a row and in a fold, `format changed` on both, `format v1` in a revision's FactGrid.

`grep -rn "Nothing is hidden" app/ components/` returns one hit and it is an unrelated CSS comment in
`app/globals.css:1673`. The About paragraph at `app/ops/statements/page.tsx:213-221` now says what is
true, including how a reader gets past the window.

### F-ST-02 RESOLVED

The count is now labelled as a count of the window, in three places, and all three render:

- Row sub-line: **"6 earlier shown"**, **"1 earlier shown"**, **"4 earlier shown"** on the three ops
  rows (`app/ops/statements/page.tsx:250`, `app/broker/statements/page.tsx:189`).
- Fold heading: **"Earlier revisions in the last 30 runs"** on every fold of both pages, with the
  number interpolated from `HOW_MANY_RUNS_SHOWN` rather than typed
  (`components/statement-revisions.tsx:38`).
- A footer inside each table's own frame, under the legend, extracted from the served HTML
  (`app/ops/statements/page.tsx:122`, `app/broker/statements/page.tsx:113`):

```
/ops/statements      This table reads the 30 most recent runs. Earlier revisions of a month beyond
                     them are not counted here; each run page names the revision it supersedes.
/broker/statements   This table reads your 30 most recent statements. Earlier revisions of a month
                     beyond them are not counted here; each statement names the revision it supersedes.
```

The footer reuses the existing `.money-cap` class (`app/styles/money.css:236-242`), whose own comment
already describes this exact use ("the sentence a bounded table prints INSIDE its own frame, under
the legend"), and the `footer` prop `DataTable` already had (`components/ui/table.tsx:14,21,32`). No
new CSS and no new component for this fix.

The window itself stays at 30, which the fix states plainly instead of hiding, and the escape route
it names is real: every run page prints the revision it supersedes. Accepted as the right scope for
tonight.

### F-ST-03 RESOLVED

`app/statements/[runId]/page.tsx:262` is now
`className={run.clawbackCents === 0 ? undefined : "money-totals-negative"}`. Read off the rendered
page of run `d314152f-4c0b-4e27-9079-fcae498d92b6` (Redwood 2027-09 revision 5, zero clawback), the
clawback `<dd>` computes to **`rgb(25,25,25)`** with **no class**, where it was `rgb(141,48,39)` in
the first pass. The signed case is unaffected: on `c0f845bd` the clawback is still `-$780.05` in
`rgb(141,48,39)` inside `money-totals-negative`.

### F-ST-04 RESOLVED

Both branches were rendered on a disposable database and both screenshots read correctly.

`scratchpad/stmt-shapes/statements_225c35e7-...-1440.png`, Harbor Point 2029-01: the block prints
four terms, Commission earned `$1,200.00`, Clawback `-$300.00`, **Other adjustments `-$45.00` in the
danger red**, rule, Net due `$855.00`. The arithmetic on screen is exact: 1200.00 - 300.00 - 45.00 =
855.00, which is `commissionEarned - clawback + adjustment` with a negative adjustment.

`scratchpad/stmt-shapes/statements_32813fee-...-1440.png`, Harbor Point 2029-02: Commission earned
`$200.00`, Clawback `-$950.00`, rule, **Net due `-$750.00` in the danger red at the net-due weight**,
then the sentence **"Negative: the clawbacks of this month are larger than the commission earned, so
the broker owes this amount rather than being owed it."** Arithmetic exact: 200.00 - 950.00 = -750.00.

Both pages also print "the journal disagrees", which is correct on a hand-seeded run with no journal
behind it: the page is working as designed, and that is not a defect of the seed.

The trial database was not touched to produce this. The two run ids appear nowhere in the 14 runs of
the trial data, and after the fix `/ops/statements` still lists exactly the **same 14 distinct run
links** and `/broker/statements` the same **12**, with the same figures as the first pass.

### F-ST-05 RESOLVED

`groupRunsByBrokerAndMonth` and `StatementMonthGroup` moved to `lib/statements/group-runs.ts`, inside
the runner's `lib/*/*.test.ts` glob. Both pages import from there and
`components/statement-revisions.tsx` keeps only the presentational component.
`lib/statements/group-runs.test.ts` holds five tests, all green, covering the four cases the finding
asked for plus one more:

1. three revisions of one month become one group whose row is the newest and whose fold is `[2, 1]`;
2. a month run once has an empty `earlier`;
3. group order is by the age of the shown revision, so a rerun of 2026-09 sits above 2027-09;
4. two brokers recorded under the same name stay two rows, which asserts the key is the broker id;
5. **the tie**: two revisions of one month at the same instant order by revision number, so the row
   is revision 5 and revision 4 is folded.

The tie is now broken deliberately in `newerFirst` (`lib/statements/group-runs.ts:27-36`): `createdAt`
first, higher `revision` on an exact tie, with a comment explaining why the tie is real (one
transaction, one `now()` for every row it writes). That is a better answer than the first pass's
"never by the revision number", and it follows the definition of a revision: the higher one names the
lower as superseded.

## Observations, not findings

- `newerFirst` is reused for the order **across** groups. Two different brokers' months produced at
  the same instant would then be ordered by revision number, which means nothing between two
  different months, though it is at least deterministic and stable. The comment's rationale only
  holds inside a month. Harmless; worth a sentence in that comment one day.
- The fold heading says "in the last 30 runs" even on a month whose whole history is inside the
  window, so it is slightly heavier than it needs to be in the common case. Honest beats short here;
  no change asked.
- The pre-existing `BAND NOT STICKY` and `BAND TOO TALL 198px` lines at 375 are unchanged and still
  reproduce on production. Not this slice.

## Checks re-run, with results

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm test` | 551 pass, 0 fail, 1 skipped; the five `group-runs` tests ok (521 to 525) |
| `gitleaks detect --source .` | 662 commits, no leaks found |
| Form lines and dashes in `dfc38ef` | no match |
| Run links on `/ops/statements` | 14 distinct, unchanged |
| Run links on `/broker/statements` as broker | 12 distinct, unchanged |
| Money multiset on `c0f845bd` | identical to the first pass and to production, same order |
| `/ops/statements` forms | `/api/statements/run`, post, `brokerId`, `month`, `knowledgeCutoff`, unchanged |
| Provisional tile | 3, and 3 of 3 rows are provisional |
| `/ops/statements` as broker | 307 to `/broker` |
| `/statements/e4ba3f53-...` as broker | 200, refusal sentence, no figure |
| `/statements/not-a-uuid` | 404 |
| `/ops/statements?all=1` as ops | 200, 3 rows, parameter ignored |
| 375 and 1440, ops and broker, folds open | no `HORIZONTAL OVERFLOW`, 0 dash characters |

## Residual limitations, unchanged

- The PDF was not rebuilt from `0fadcfa`. The fix commit adds nothing to the PDF's import graph
  either, so the earlier reasoning stands as it was.
- The `closed` chip branch of `EarlierRevisions` is still unexercised: no month in the trial data has
  been run after it ended.
- The 30-run window is now disclosed, not removed. A month with more than 30 runs between it and the
  present still shows a partial fold; the page says so.
- This remains a UI review and an engineering check, never a legal certification, and it does not
  establish that Yoann can explain these lines. That is his walkthrough to give.
