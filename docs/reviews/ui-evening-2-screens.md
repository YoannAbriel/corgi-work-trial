# Independent review: interface batch 2, the screens

**Reviewer:** independent reviewer sub-agent (screens part). The access tokens slice is reviewed
separately and is excluded here.
**Date:** 2026-09-09, evening (UTC).
**Reviewed revision:** `0fadcfa` (`ui-evening-2` head at the time of assignment), merged into the
review worktree as `31075d3`. Baseline `c120944` (`ui-evening`, interface batch 1, reviewed
elsewhere).
**Scope:** `git diff ui-evening...0fadcfa`, minus `app/ops/mcp-keys/**`, `app/api/mcp*`,
`lib/mcp/**`, `lib/observability/**`, `db/migrations/0026*`.

> **Branch drift.** `ui-evening-2` advanced during the review and is now `a29beef`, 41 commits
> ahead of the reviewed SHA (a Billing view, a statements rework, an emphasis slice, and two fixes
> from the batch 1 review). **Every statement in this record is pinned to `0fadcfa`**; each diff
> command below names that SHA explicitly. Nothing here judges the newer commits.

> **Two re-reviews follow at the end of this record.** The verdict below is the first pass, at
> `0fadcfa`, and is kept as written.
>
> **The current verdict is PASS at `7b527f0`**, in **Re-review, second pass**, with one accepted
> LOW residual (F-EV2-09). The middle section, **Re-review, 2026-09-09 late evening** at
> `b5929b2`, closed the seven findings below and raised F-EV2-08, which the second pass then
> verified as fixed.

## Verdict, first pass

**FAIL at `0fadcfa`**, on two MEDIUM findings and two only:

- **F-EV2-01**: the band's orange **"Collect $X"** is drawn for readers who cannot collect
  (the approver, and the owning broker while the customer's approval is still pending), because
  `firstOpenCollection` ignores its own `canPay` argument. The comment beside it claims the
  opposite ("a link cannot appear where the button does not").
- **F-EV2-02**: at **1024 to about 1050 px**, signed in as staff operations, the **endorsement
  preview and the cancellation preview** render a three-row top bar of **91 px** while `--top-h`
  stays **62 px**, so the sticky band is overlapped by 29 px and its title is cut in half.

Five LOW findings follow. **Everything else the batch claims was checked and holds**, with a
measurement for each: the top bar at four widths, the two-stack overview, the Documents forms,
F-LIVE-01 across four roles and four policies, F-LIVE-02 ordering and folds, the signed colours
measured in computed pixels, the empty-state illustrations, `what-needs-you`, the 375 px sweep,
the figures, the hostile URLs, and typecheck / test / build.

**Walkthrough status: NOT REVIEWED WITH YOANN.** Nothing in this record establishes that Yoann can
explain `signedTone`, `openCollectionOf`, the `mark` prop of `JournalTable` or the `--top-h`
mechanism. Section 9 assesses the readability of the code, not his understanding of it.

**Automatic fails in this scope.** AF-02 PASS (the mode line is complete and verbatim at every
width measured, including 375 px). AF-03 NOT APPLICABLE, because no SQL, no migration and no write path
is touched by this part; the one strike-through is CSS on stored figures
(`app/globals.css:1376-1382`, `components/journal-table.tsx:120-125`) and the amounts printed are
the stored ones. AF-05 PASS (`gitleaks` on `ui-evening..0fadcfa`, 16 commits, no leaks). AF-01,
AF-04, AF-06 are delivery gates outside this diff and are NOT RUN here.

## 1. Startup receipt

Read in full, in this order: `CLAUDE.md`, `AUTOMATIC-FAILS.md`, `AGENTS.md`, `READABLE-CODE.md`,
`REVIEWER.md`. Then, in scope: the whole diff `ui-evening...0fadcfa` outside the tokens paths,
`docs/reviews/ui-system.md` (the recorded CGP-01707 / CGP-01274 figures), `docs/reviews/FINDINGS.md`
(register format), `lib/inbox/read.ts`, `lib/policy/endorsement-read.ts`,
`app/login/page.tsx` (demo accounts). Absent files: none.

Environment: `npm ci` (exit 0), `.env.local` copied from the main checkout (gitignored, never
printed), `npx next dev -p 3042` on the review worktree, and a second detached worktree of
`ui-evening` on port 3043 for the A/B comparisons. Both stopped by their port's PID at the end.
All database access was GET only.

> **The trial database moved under the review.** Another session created a second endorsement on
> CGP-01707 at about 22:20 and cancelled all four policies at about 22:30. Every A/B figure
> comparison below was therefore re-run **interleaved** (batch, baseline, batch, baseline) and is
> only reported where both sides were stable across two rounds. The screenshots of the previews
> were taken before the cancellations; the correction preview could not be re-shot afterwards.

## 2. Scope, forms and hygiene

| Check | Command | Result | Verdict |
|---|---|---|---|
| Diff size | `git diff ui-evening...0fadcfa --stat` | 57 files, +2183 / −681 | (no verdict) |
| `lib/` changes in scope | `git diff ui-evening...0fadcfa --stat -- lib` | `lib/inbox/sections.ts` **5 lines**, everything else under `lib/mcp` and `lib/observability` (tokens) | **PASS** |
| That one `lib` change | see below | one `href` line plus three comment lines, nothing else | **PASS** |
| Form contracts | `git diff ... \| grep -E '^[-+].*(action=\|method=\|name=")'` | **three lines**, listed below | **PASS** |
| Secrets | `gitleaks detect --log-opts "ui-evening..0fadcfa" --redact` | 16 commits, ~123 KB, **no leaks found** | **PASS** |
| Em / en dash | `grep -cP '^\+.*[\x{2014}\x{2013}]'` on the scoped diff | **0** | **PASS** |
| `loading.tsx` | `--stat \| grep -i loading`, `find app -name loading.tsx` | none added, none present | **PASS** |
| Working tree | `git status --short` | clean | **PASS** |

**The only `lib` change in this part**, verbatim:

```
-          href: `/policies/${policy.policyId}`,
+          // The Money view, at the correction's action row. It used to be the policy overview,
+          // where nothing says what is owed or how to take it (Yoann, 2026-09-09). The anchor is
+          // `collect`, put on the block by app/policies/[policyId]/correction-sections.tsx.
+          href: `/policies/${policy.policyId}?view=money#collect`,
```

**Every form line in the scoped diff**, all three of them:

```
+                    method="post"
+                    action={`/api/policies/${policyId}/corrections/${correction.rebookEventId}/checkout`}
-                  method="post"
-                  action={`/api/policies/${policyId}/corrections/${correction.rebookEventId}/checkout`}
-        {showEmptyIllustration ? <DecorativeIllustration name="all-clear" variant="empty" /> : null}
```

The first pair is one move: the collect form travelled from the foot of the correction card to the
`.pd-collect` row, with the same `method="post"` and the same `action`. The third line is the
removal of the `all-clear` illustration from the block that no longer draws itself. **No `name="`
line appears in the diff at all**, which means the Documents inputs were not even re-indented; the
DOM probe in section 6 confirms `action`, `method="get"`, `name="asOf"` and `target="_blank"` are
all still there on both forms.

## 3. Checks run

| Command | Result |
|---|---|
| `npm run typecheck` | **exit 0** |
| `npm test` | **exit 0**, 541 tests, **540 pass, 0 fail, 1 skipped**, 3.2 s |
| `npm run build` | **exit 0**, `✓ Compiled successfully in 3.4s`, no warning, 30 routes |

## 4. F-LIVE-01: is there a way into the correction, and only for the right role

Four fetches per policy with the session cookie, on the running batch head, DOM only.

| Role | Policy | Band "Correct a date" | Sub-menu "Correct" | `corrections/new` count | Verdict |
|---|---|---|---|---|---|
| ops | CGP-01707 (applied endorsement) | **1** | **1** | 4 (2 HTML + 2 flight) | **PASS** |
| ops | CGP-01274, CGP-01061, CGP-01062 (no endorsement) | **0** | **1** each | 2 each | **PASS** |
| broker (owning) | CGP-01707 | 0 | 0 | **0** | **PASS** |
| customer | CGP-01707 | 0 | 0 | **0** | **PASS** |
| approver | CGP-01707 | 0 | 0 | **0** | **PASS** |

The band link, in the DOM as ops:
`<a class="button-link secondary" href="/policies/3c3697b7-.../corrections/new">Correct a date</a>`.
The sub-menu entry, in the sidebar under the five views:
`<a href="/policies/3c3697b7-.../corrections/new"><span>Correct</span></a>`.

**The screen refuses the other roles server-side, which is the control.** GET
`/policies/<id>/corrections/new`: ops **200**; broker, customer and approver **307** to
`?error=only%20staff%20operations%20can%20correct%20the%20effective%20date%20of%20an%20endorsement`
(`app/policies/[policyId]/corrections/new/page.tsx:334-337`, and again in
`lib/policy/correct-endorsement-date.ts:148` for the plan itself). Hiding the link is a convenience,
not the gate. **PASS.**

The band's three conditions (`app/policies/[policyId]/page.tsx:438`) are
`user.role === "staff_ops" && policy.status === "bound" && schedule.length > 0`, and `schedule`
comes from `endorsementScheduleOfPolicy`, which reads `endorsed` and `correction_rebook` events and
**skips superseded rows** (`lib/policy/endorsement-read.ts:139-142`). So "carries an applied
endorsement" is what the condition actually tests. **PASS.**

## 5. F-LIVE-02: the correction block, the anchor and the inbox link

Measured on CGP-01707 `?view=money`, as broker and as ops, DOM with the flight payload stripped.

| Check | broker | ops | Verdict |
|---|---|---|---|
| `details` open on arrival | **0 of 9** | **0 of 9** | **PASS**, both folds closed |
| `id="collect"` | 0 | 0 | see below |
| Chip "reversed" / "re-booked on" / `entry-struck` | 2 / 2 / 2 | 2 / 2 / 2 | **PASS** |
| Fold titles | `Impact, line by line`, `The 4 entries this correction posted` | same | **PASS** |

**Block order**, read off the rendered card (screenshot `folds/correction-open.png`): title
`Correction: 2026-10-08 to 2026-09-22`, state chip `collected`, the four facts, the green state
line `The difference of $53.84 was collected on 2026-09-09`, then the two closed folds. That is the
claimed order. **PASS.**

**On the open state.** The difference on this policy was collected on 2026-09-09, so
`openCollectionOf` returns `null` (`correction-sections.tsx:289-303`, the `collection.paidOn`
test), the anchor is not placed, the band link is not drawn and the broker inbox lists no item:
`/inbox` as broker says **"Nothing is waiting for you."** and contains **0** occurrences of
`view=money#collect`. **I could not exercise the open state on this database and say so rather than
claim it.** Read from the code, when a difference is open the anchor is placed on exactly one
block (`correction-sections.tsx:332` and `:367`, `correction === anchored`), so `id="collect"` can
never appear twice on a page. See **F-EV2-05** for the multi-correction case.

**The inbox link cannot dangle.** `readCorrections(policyId, "to_collect")`
(`lib/inbox/read.ts:246-269`) lists an item only when `collection.paidOn === null` and the customer
is not still to approve; those are a subset of the rows for which `openCollectionOf` returns
non-null, so an inbox row always has an anchor waiting for it. **PASS.**

**Inside the folds**, computed styles read in the browser (see section 7).

## 6. The top bar, the band, the drawer, the overview

Measured with Playwright at four widths, signed in as ops, on `/policies/<CGP-01707>`, `/ops/console`
and the policy page with the inspector open.

| Width | `--top-h` | bar height | breadcrumb | mode line | band top / bar bottom (scrolled) | drawer top | overflow |
|---|---|---|---|---|---|---|---|
| 1024 | **62px** | 62 | 3 items, **none ellipsised** (58 / 47 / 109 px) | complete, not clipped | **62 / 62** | 342 | none |
| 1280 | **62px** | 62 | 3 items, none ellipsised | complete | **62 / 62** | 292 | none |
| 1440 | **40px** | 40 | 3 items, none ellipsised | complete | **40 / 40** | 248 | none |
| 1920 | **40px** | 40 | 3 items, none ellipsised | complete | **40 / 40** | 248 | none |

The AF-02 line is byte-identical at every width:
`Stripe: LIVE SANDBOX · claim rail: LOCAL SIMULATOR · bank check: LOCAL SIMULATOR`. Dash count on
the rendered text: **0** everywhere. **PASS.**

**What batch 1 did here, for contrast.** On `ui-evening` at 1024 and 1280 the breadcrumb was
`display: none` (measured width 0 for every item); at 1440 on a four-item trail **all four** items
were ellipsised (41 / 27 / 71 / 88 px). On this head the trail is visible at 1024 and 1280, and at
1440 the last item keeps its full 134 px while the three before it ellipsise (44 / 31 / 77 px). The
slice does what it claims, and the drawer improved too: on `ui-evening` at 1024 the drawer sat at
`top=30` against a 40 px bar, **overlapping it by 10 px**; here it sits at 342 against a 62 px bar.

At 1440 on a form page the trail reads `Over… > Pol… > Policy CG… > Endorsement preview`
(`crumb-new/bar-1440-0.png`). It is ellipsised, never cut mid-word, so it passes the check as
written; the policy number is nonetheless unreadable there, which is the cost of the `flex-shrink: 0`
on the last item when the last item is the form and not the policy. Recorded as an observation, not
a finding: it is not a regression.

**The overview, two stacks.** `.pd-column` contents read from the DOM at 1024, 1280, 1440 and 1920:
left `["Cover", "Broker"]`, right `["So far, from the journal", "Documents"]`, at every width. Each
card starts where the one above it ended; no card begins below a gap
(`review-screens/…-1920-full.png`). **PASS.**

**The Documents forms, in the DOM at every width:**

| | action | method | target | field | button |
|---|---|---|---|---|---|
| Declarations | `/api/policies/<id>/documents/declarations` | `get` | `_blank` | `name="asOf"` | `aria-label="Download Declarations as PDF"` |
| Endorsement schedule | `/api/policies/<id>/documents/endorsement-schedule` | `get` | `_blank` | `name="asOf"` | `aria-label="Download Endorsement schedule as PDF"` |

Rows are compact: name, 32 px date input, 32 px icon button, and one sentence under the list
("PDF as of the chosen date, opens in a new tab."). **PASS.**

## 7. The signed colours, measured

Computed styles read in the browser on the correction block of CGP-01707, folds forced open.

| Row | Text | Class | Colour | Weight | Verdict |
|---|---|---|---|---|---|
| Prorated premium **as booked** | `$1,101.36` | `amount`, row `formula-reference` | `rgb(93,94,99)` = `--ink-2` | 400 | **muted, PASS** |
| Prorated premium **at the corrected date** | `$1,153.97` | `amount`, row `formula-reference` | `rgb(93,94,99)` | 400 | **muted, PASS** |
| Premium difference | **`+$52.61`** | `amount signed-ok` | `rgb(54,102,72)` = `--ok` | **600** | **PASS** |
| Tax difference | **`+$1.23`** | `amount signed-ok` | `rgb(54,102,72)` | **600** | **PASS** |
| **Total to collect** | **`+$53.84`** | `amount signed-ok`, row `total` | `rgb(54,102,72)` | **600** | **PASS, bold** |
| Broker commission | `$7.89` | `amount` | `rgb(25,25,25)` = `--ink` | 400 | **plain, PASS** |

The four entries in the second fold:

| Entry type | Chip | `entry-struck` | `text-decoration` on the amounts |
|---|---|---|---|
| `reversal_of_endorsement_tax_billed` | `reversed` (danger) | yes | **line-through** |
| `reversal_of_endorsement_premium_written` | `reversed` (danger) | yes | **line-through** |
| `endorsement_premium_written` | `re-booked on 2026-09-22` (ok) | no | none |
| `endorsement_tax_billed` | `re-booked on 2026-09-22` (ok) | no | none |

**The tiles.** Endorsement preview (`p-endorse-3000`, 1440): "To collect" reads **`+$261.61`** in
green with an up-right arrow; the reference row "Annual premium difference (new minus old)"
`$300.00` is muted; "Total collected from the customer through Stripe" **`+$261.61`** green and
bold; "Broker commission earned on the collected premium" `$38.34` plain black. Cancellation
preview (`p-cancel`, 1440): "Refunded" reads **`−$1,446.10`** in red with a down-right arrow, and
the "Total refunded" row of the list is `$1,446.10` bold in red **without** a sign, exactly as the
comment in `cancel/page.tsx:164-169` says it should be. **PASS.**

**The two approval screens could not be exercised.** No endorsement request and no correction was
awaiting approval on the trial database at any point during the review
(`/ops/approvals` as ops and as approver both list none, and no `…/approve` href appears on any of
the four policies). Their `signedKeys` / `referenceKeys` arguments are identical to the previews'
and they typecheck and build, but **their rendering is NOT RUN** and I do not claim it passed.

## 8. Figures: nothing moved except what the builder declared

`ui-evening` on port 3043 against the same trial database, `ui-evening-2` on 3042, the multiset of
`\$[0-9,]+\.[0-9]{2}` extracted from the DOM of each page with the flight payload stripped. Because
another session was writing to the database, each page was fetched **twice on each side,
interleaved**, and only a difference stable across both rounds is reported.

| Page | Distinct values | Result |
|---|---|---|
| Policy overview, CGP-01707 | 38 | **identical** |
| Money view, CGP-01707 | 51 | **identical** |
| Money view, CGP-01274 | 16 | **identical** |
| Endorse preview, 1800.00 | 11 | **identical** |
| Endorse preview, 3000.00 | 12 | **identical** |
| Cancel preview | 19 | **identical** |
| **Correction preview** | 14 | **two added occurrences** |

The correction preview, twice, on two different endorsements (before and after the database moved),
gave the same shape of difference and nothing else:

- run A (endorsement of 2026-09-22, corrected to 2026-09-12): `$1,186.84` goes from 2 to 3
  occurrences, and `$27.89` appears once where it did not appear at all;
- run B (endorsement of 2026-10-01, corrected to 2026-09-15): `$294.24` goes from 2 to 3, and
  `$6.91` appears once.

Both are the two new re-book preview rows: the premium repeat is a value the page already printed
(`money.after.deltaPremiumCents`, also the "Corrected" tile and the `premium_corrected` line), and
the genuinely new value is the **corrected tax**, `money.after.deltaTaxCents`. In run A that is
`$27.11 + $0.78 = $27.89`, which is the booked tax plus the tax difference the page prints two rows
above, so the figure is read from `money.after` and not recomputed
(`corrections/new/page.tsx:303-315`, `rebookedAmountCents`, which returns `null` for any other
entry type rather than inventing an amount). **This is exactly the declared addition. PASS.**

**The figures recorded in `docs/reviews/ui-system.md`.** 12 of the 13 values listed there for
CGP-01707 and all 11 for CGP-01274 still print, and `/broker` still shows `$1,253.20` and not the
`$2,481.40` that made an earlier cycle fail. The one absentee, `$2,301.36`, is **absent on
`ui-evening` too** and the full multiset across the five views of CGP-01707 is identical between
the two heads, so it moved with the LIVE-8 correction of the policy, not with this batch. **PASS.**

## 9. Empty states, `what-needs-you`, 375 px, hostile URLs

**Empty states**, rendered size read from the browser at 1440:

| Screen | File served | Drawn |
|---|---|---|
| `/ops/console/search` | `007-magnifying-glass` (**library fallback**, as documented) | 200 × 200 |
| `/ops/approvals` | `045-bird-branch` (**cropped copy**) | 200 × 131 |
| `/ops/reconciliation?view=resolved` | `045-bird-branch` | 200 × 131 |
| customer `/inbox` | `045-bird-branch` | 200 × 131 |

200 px on the long side, each keeping its own shape, none clipped, and both the cropped resolution
and the fallback are demonstrated on real screens. `ls public/illustrations/empty | wc -l` = **16**,
**314,688 bytes** (336 K on disk). The comment in `decorative-illustration.tsx:76-79` claims 19
names with 3 deliberately absent: `grep -rhoE 'illustration="[a-z-]+"' app components | sort -u`
returns exactly **19**, and the three not in `emptyIllustrations` are `magnifying-glass`,
`open-ledger` and `broken-link`, the three the comment names. **PASS**, and the comment is
verifiable, which is the point.

**`what-needs-you`.** customer `/customer`: **no block** (`.lists-needs` absent). ops `/ops`:
**block present**. broker `/broker`: no block, and the broker's `/inbox` is all-clear, so that is
its data and not a swallowed block. `/inbox` still draws **"Nothing is waiting for you."** with its
own illustration. The three call sites (`app/broker/page.tsx:192`, `app/customer/page.tsx:144`,
`components/workspace-overview.tsx:54`) all dropped the removed prop; typecheck confirms. **PASS.**

**375 px**, the assigned sweep over the policy page, the money view, `/ops/console`, `/inbox` and
the correction preview:

```
BASE=http://localhost:3042 ROLE=ops@example.com WIDTHS=375 OUT=review-screens-375 \
  PATHS="…" node break.mjs
```

**No `HORIZONTAL OVERFLOW` line on any state**, folds open included, and **0 dash characters**.
The breadcrumb is whole at 375, the AF-02 line is complete over two wrapped lines
(`band375.png`). Two guard lines did trip and neither is a defect: `BAND NOT STICKY` fires on every
path **and fires identically on `ui-evening`** (the band is deliberately not sticky under 800 px),
and `BAND TOO TALL 153px` is **F-EV2-07** below.

**Hostile URLs**, as ops. No 500 anywhere.

| URL | HTTP | What the screen says |
|---|---|---|
| `?view=billing` (not built) | 200 | falls back to **`view=overview`** (`aria-current` on Overview) |
| `?view=../` and `?view=%2e%2e%2f` | 200 | same fallback |
| `?inspect=../../etc/passwd` | 200 | the policy page, no drawer content |
| `correctedEffectiveAt=not-a-date` | 200 | `"not-a-date" is not a calendar date`, **0 dollar figures on the page** |
| `endorsedEventId=abc` (and empty, and a foreign uuid) | 200 | `this policy has no endorsement in force with that id`, 0 figures |
| corrected date before the term / far in the future | 200 | `only the most recent endorsement in force can be corrected…`, 0 figures |
| `policies/not-a-uuid` | **404** | not found |
| `…/corrections/abc/approve`, `…/endorsements/abc/approve` | **404** | not found |
| `endorse?newAnnualPremium=abc` | 200 | `"abc" is not a US dollar amount (expected for example 1200 or 1,200.50)` |
| `cancel?effectiveAt=not-a-date` | 200 | `"not-a-date" is not a calendar date` |

A refused preview prints **no dollar amount at all**, which is the right behaviour: no half-computed
money on a screen that refused. **PASS.**

## 10. Readability (READABLE-CODE.md)

Good, and better than the diff's size suggests. `components/signed.tsx` is four pure functions of
one number with the convention written above them and three worked examples in the comment; nothing
in it touches persistence or arithmetic. `openCollectionOf` puts the three facts a button is drawn
from in one place instead of three inline tests, and the intention is right even though the wiring is
wrong (F-EV2-01). `rebookedAmountCents` returns `null` rather than inventing a figure, and says why.
`scripts/crop-illustrations.mjs` keeps the file list as a plain list and explains that choice. The
`mark` prop of `JournalTable` is documented as labelling only, with the stored figures untouched.

Two comments assert more than the code does (F-EV2-03, F-EV2-04) and one asserts the opposite of
what the code does (F-EV2-01). On a batch whose comments are otherwise this careful, that is worth
fixing rather than shrugging at: under AF-06 the comment is part of what has to be defensible.

## 11. Findings

### F-EV2-01 (MEDIUM): the band offers "Collect $X" to readers who cannot collect

**Where:** `app/policies/[policyId]/correction-sections.tsx:289-315`,
`app/policies/[policyId]/page.tsx:200-210` and `:413-419`.

**Trigger:** any correction on a policy whose difference is still open, viewed by a reader who is
neither the owning broker nor staff operations (the **approver**), or by the owning broker while
`customerApprovalRequired && !customerApprovedAt`.

**What happens:** `openCollectionOf` returns a truthy object whenever
`settlement === "collect" && collection && !collection.paidOn`; the `canPay` argument only feeds
the `canCollectNow` field. `firstOpenCollection` therefore returns non-null regardless of `canPay`,
and `page.tsx:209` `const collectable = firstOpenCollection(corrections, canPayTheDifference)` is
truthy for every reader of that page. The band then draws the orange
`Collect {formatCentsAsUsd(collectable.open.amountCents)}` at `:414`, and demotes Endorse to
secondary at `:422`, while the block itself correctly draws no button (`:394`,
`open?.canCollectNow`). The comment at `page.tsx:201-205` states "the band below draws its
'Collect' link from the same answer, so a link cannot appear where the button does not
(F-LIVE-02)". It can.

**Consequence:** an approver, and a broker waiting on the customer, are shown the policy's primary
orange action naming an amount, which scrolls them to a row with no button. Not a bypass: the
checkout route re-checks server-side, and the customer never reaches this band at all (they return
early at `page.tsx:119-122`). It is a false promise on a money screen, and it contradicts its own
comment.

**Evidence:** read from the two functions; **latent on the trial database**, where the $53.84
difference is collected (`paidOn = 2026-09-09`), so the band correctly shows nothing today. I could
not construct an open difference with GET-only access and do not claim to have seen it render.

**Correction:** return `null` from `openCollectionOf` when `!canPay`, or test
`collectable.open.canCollectNow` at `page.tsx:414`, and make the comment say what the code does.

### F-EV2-02 (MEDIUM): at 1024 px the top bar is 91 px tall while `--top-h` says 62, so the band is overlapped

**Where:** `app/styles/system.css:2489-2503` (the `@media (max-width: 1280px)` block: `--top-h: 62px`,
`.topbar { flex-wrap: wrap }`, `.topbar-modes { flex: 1 1 100%; order: 3 }`).

**Trigger:** staff operations, viewport **1024 to about 1050 px**, on a screen whose breadcrumb has
four items **and** whose last item is long: `/policies/<id>/endorse?…` and
`/policies/<id>/cancel?…`.

**What happens:** the bar has four children, `.page-navigation`, `.topbar-search`,
`.environment-badge` and `.topbar-modes`. Only `.topbar-modes` is given its own row. When the
four-item trail plus the 200 px search fills the first row, the **environment badge wraps as well**,
so the bar is three rows and **91 px** tall while `--top-h` is still **62 px**. The sticky band
offsets from the token, so it sits at `top: 62` and the bar's third row is painted over its title.

**Measured** (scrolled, so both are pinned):

| Screen | width | bar height | bar bottom | band top | overlap |
|---|---|---|---|---|---|
| endorse preview | **1024** | **91** | 91 | 62 | **29 px** |
| cancel preview | **1024** | **91** | 91 | 62 | **29 px** |
| endorse preview | **1040** | **91** | 91 | 62 | **29 px** |
| endorse preview | 1060, 1080, 1100, 1280, 1440 | 62 / 62 / 62 / 62 / 40 | n/a | n/a | **0** |
| policy page, money view, `/ops/console`, `/ops/reconciliation`, `/ops/statements`, `/ops/console/search`, claims/new, correction preview | 1024 | 62 | 62 | 62 | **0** |
| same endorse preview as **broker** or **customer** | 1024 | 62 | 62 | 62 | **0** (no staff search) |

**Screenshot:** `overlap-new/ov-1024-2.png`. The mode line sits across the band title, which reads
as a cut-off "Endorsement preview". The AF-02 words themselves stay legible (the bar is above), so
this is not an AF-02 breach.

**Not present on `ui-evening`**: there the breadcrumb was hidden below 1280, the bar was 40 px and
the band sat flush at 40.

**Correction:** let the bar carry its real height instead of a fixed token (a wrapper measured with
`position: sticky; top: 0` and the band offset from it), or give the environment badge the same
`order`/row treatment as the mode line so the bar can only ever be two rows here.

### F-EV2-03 (LOW): `signed.css` says "existing tokens only" and then writes two literal colours

**Where:** `app/styles/signed.css:1-8` against `:66-71`.

The header states "EXISTING TOKENS ONLY: `--ok` and `--danger`, the accent, and `--ink-2` … No new
palette." Lines 68-70 introduce `#c9cbd1` (the dashed border of the re-book preview row) and
`#fbfcfb` (its ground). Literal hexes are the house style elsewhere (120 in `app/globals.css`, 85 in
`system.css`), so the CSS itself is fine; the claim is what is wrong. Either add the two values to
the token list in the comment or move them into tokens.

### F-EV2-04 (LOW): the search field's comment claims a placeholder that does not fit

**Where:** `app/styles/system.css:564-569`.

The comment says the field "stops at 150 px, which still shows the whole 'Find a reference'
placeholder, so it never becomes a box nobody can read". At its 150 px minimum the placeholder is
cut: the bar reads `Find a referenc` (`crumb-new/bar-1440-0.png`, and `searchW: 150` on the endorse
preview at 1440). The behaviour is acceptable; the measurement in the comment is not.

### F-EV2-05 (LOW): one `collect` anchor, but the inbox can list several rows pointing at it

**Where:** `app/policies/[policyId]/correction-sections.tsx:332` and `:367`, against
`lib/inbox/sections.ts:231-244`.

The anchor is placed on `firstOpenCollection(...)` only. `readCorrections(policyId, "to_collect")`
returns **one row per** open collect correction, and each row's `href` ends in `#collect`. On a
policy carrying two corrections with open differences, both inbox rows land on the first block. No
such policy exists on the trial database, so this is a code reading. Either anchor per correction
(`#collect-<rebookEventId>`) or say in the comment that the anchor is the first one on purpose.

### F-EV2-06 (LOW): the "reversed" chip sits on the reversal, not on what was reversed

**Where:** `app/policies/[policyId]/correction-sections.tsx:459-464`.

`mark` keys on `entry.reversesEntryId`, so the chip lands on the entry that **performs** the
reversal. The rendered rows read `reversal_of_endorsement_tax_billed` + a red `reversed` chip, with
the amounts struck through. A reader can take that as "this reversal was itself reversed". The panel
only holds the four entries the correction posted, so the entry that actually stopped being true is
not in the table to be marked; a label such as `undoes 63646ae0` or `this undoes an earlier entry`
would say the direction without the ambiguity. The figures are correct and unmodified either way.

### F-EV2-07 (LOW): at 375 px the policy band grows 44 px and trips the sweep's own guard

**Where:** `app/policies/[policyId]/page.tsx:436-444` (the new band action).

`break.mjs` reports `BAND TOO TALL 153px` on `/policies/<id>` and `?view=money` at 375 px, against
**109 px** on `ui-evening`. The extra "Correct a date" pushes the actions onto a second row.
Nothing overlaps and there is no overflow (`band375.png`), so this is the tool's 120 px heuristic
firing on a real growth rather than a break. Worth knowing before more band actions are added.

## 12. Observations, not findings

- **`sharp` is not declared in `package.json`.** `scripts/crop-illustrations.mjs` imports it and
  `npm run illustrations:crop` is a published script, but `npm ls sharp` shows it arriving only
  through `next@16.3.4`, so the script would fail from a clean clone. **Pre-existing** (the
  replaced `crop-band-illustrations.mjs` imported it the same way on `ui-evening`), and **already
  fixed after the reviewed SHA** at `185bb92` / `4b34cae` as F-EV-03.
- **The two Documents forms carry `target="_blank"` without `rel="noopener"`** at `0fadcfa`.
  Same-origin destination, so the risk is small; **already fixed after the reviewed SHA** at
  `8353b3f` as F-EV-07.
- `components/shell/sections.tsx:68-70` renames the sidebar label "MCP keys" to "Access tokens".
  That belongs to the tokens slice and is **out of this scope**; noted so it is not lost between
  the two reviews. It broke nothing in the screens.
- The batch 1 content I was asked to watch for damage (the sidebar, the bands, the brand) came
  through intact at every width and role I measured. Nothing to report.
- `docs/reviews/ui-system.md` is the newest `ui-*` record naming both policies; its figures are
  checked in section 8.

## 13. What was not run, and why

| Not run | Why |
|---|---|
| The two approval screens rendered | No endorsement request and no correction awaited approval on the trial database at any time during the review. |
| The open-difference state of the correction block (`id="collect"`, the band link, the broker inbox row) | The one correction on the database was already collected, and the review is GET-only. Reported from the code, and said so. |
| Migration 0026 / `/ops/mcp-keys` | Out of scope (tokens), and the trial database lacks 0026 by design. |
| AF-01, AF-04, AF-06 delivery gates | Outside this diff. NOT RUN, never implicit PASS. |
| Production comparison | Not needed: a second worktree of `ui-evening` on port 3043 gave an exact A/B against the same database. |

## 14. Register lines

| ID | Sev | Finding (one line) | Fix | Status |
|---|---|---|---|---|
| F-EV2-01 | MED | Band "Collect $X" is drawn for any reader of the policy page, including the approver and a broker still waiting on the customer, because `firstOpenCollection` ignores `canPay` | Return null when `!canPay`, or test `canCollectNow` at the band; correct the comment | OPEN |
| F-EV2-02 | MED | At 1024 to 1050 px the endorse and cancel previews render a 91 px three-row top bar against `--top-h: 62px`, so the sticky band is overlapped by 29 px | Measure the bar instead of pinning a token, or give the environment badge its own row with the mode line | OPEN |
| F-EV2-03 | LOW | `signed.css` header claims "existing tokens only, no new palette" while lines 68-70 add `#c9cbd1` and `#fbfcfb` | List the two values in the comment or tokenise them | OPEN |
| F-EV2-04 | LOW | `system.css:566` claims the 150 px search still shows the whole "Find a reference" placeholder; it is cut | Correct the comment or raise the minimum | OPEN |
| F-EV2-05 | LOW | The `collect` anchor marks only the first open correction while the broker inbox lists one row per open correction, all pointing at `#collect` | Anchor per correction, or state the intent in the comment | OPEN |
| F-EV2-06 | LOW | The "reversed" chip and the strike-through land on the reversal entry, which reads as "this reversal was reversed" | Reword the chip to name what it undoes | OPEN |
| F-EV2-07 | LOW | At 375 px the policy band grows from 109 px to 153 px with the new "Correct a date" action, tripping the sweep's own 120 px guard | Accept, or fold the band actions into a menu at 375 | OPEN |

---

# Re-review, 2026-09-09 late evening

**New revision:** `b5929b2` (`ui-evening-2` head at re-review), merged into the same worktree as
`bec9daa`. Previous record above stands unchanged and is pinned to `0fadcfa`; this section is
appended, nothing was overwritten.

**Fixes checked:** `0259d6c` (F-EV2-01, F-EV2-05, F-EV2-06), `0bef75b` (F-EV2-02, F-EV2-04),
`f763714` (F-EV2-03). All three verified present in the merge with `git merge-base --is-ancestor`.
`3411331` is also an ancestor, so the head I was asked for is included.

**Scope of this pass:** the seven findings only, plus the regression surface each fix touches.
The Billing view's own collect block is the Billing reviewer's; I checked the band, the anchors and
the top bar. GET only on the trial database throughout.

## Verdict of the re-review

**FAIL at `b5929b2`**, on one new MEDIUM finding and one only:

- **F-EV2-08**: the `@media (max-width: 1000px) { .drawer { top: 0 } }` rule added by the F-EV2-02
  fix makes the opaque inspector panel paint over the top bar between **801 and 1000 px**, and the
  right end of the **AF-02 mode line** goes under it. Measured, and visible in a screenshot.

**All seven findings of the first pass are closed**, five of them with a runtime measurement and
two by code reading plus negative runtime evidence:

| ID | Sev | Fix | Status |
|---|---|---|---|
| F-EV2-01 | MED | `0259d6c` | **FIXED**, verified |
| F-EV2-02 | MED | `0bef75b` | **FIXED**, verified at 48 measurements |
| F-EV2-03 | LOW | `f763714` | **FIXED**, verified |
| F-EV2-04 | LOW | `0bef75b` | **FIXED**, verified |
| F-EV2-05 | LOW | `0259d6c` | **FIXED**, verified |
| F-EV2-06 | LOW | `0259d6c` | **FIXED**, verified at runtime |
| F-EV2-07 | LOW | none | **ACCEPTED** by the coordinator, no change, still 153 px |

**Checks re-run on the merge:** `npm run typecheck` **exit 0**; `npm test` **exit 0** (554 tests,
**553 pass, 0 fail, 1 skipped**); `npm run build` **exit 0** (`✓ Compiled successfully in 1098ms`,
no warning). `gitleaks detect --log-opts "ui-evening..b5929b2"`: 52 commits, ~653 KB, **no leaks
found**. Em or en dash added by the three fix commits: **0**. Form contract lines (`action=`,
`method=`, `name="`) changed by the three fix commits: **none at all**.

**The trial database moved again**, and further than last time: CGP-01707, CGP-01274 and CGP-01062
are cancelled, CGP-01061 is voided, and two new policies exist (CGP-01708 draft, **CGP-01709
bound**). The measurements below are on CGP-01709 where a bound policy was needed. **No correction
with an open difference exists on any of the six policies**, so F-EV2-01 and F-EV2-05 are again
verified by reading the code plus negative runtime evidence, and I say so rather than claim more.

## F-EV2-01: FIXED

Fixed twice over, which is the right belt-and-braces here:

1. `app/policies/[policyId]/correction-sections.tsx:445-447` now returns `null` from
   `openCollectionOf` when `!canPay`, with the finding quoted in the comment. That removes the
   **approver** case at the source: `firstOpenCollection` can no longer return a value for a reader
   who is neither the owning broker nor staff operations.
2. `app/policies/[policyId]/page.tsx:232` adds
   `const collectableNow = collectable?.open.canCollectNow ? collectable : null;` and the band at
   `:540` and `:548` reads `collectableNow`, not `collectable`. That removes the **broker waiting
   on the customer's approval** case, where `canPay` is true but `canCollectNow` is false.

So the band link exists exactly when the button exists, which is what the first record asked for,
and the comment at `:230-231` now says that instead of the opposite.

**Runtime, negative:** across all six policies and the three roles that reach this band (ops,
broker, approver), `button-link orange">Collect $` appears **0 times** and `id="collect"` (the old
bare anchor) appears **0 times**. There is nothing to collect on this database, so a band offering
it would be the bug; there is none.

**Not re-tested, and why:** no open difference exists, so the positive case (owning broker with an
approved difference sees the link) could not be exercised. The code path is short and the two tests
are `canPay` and `canCollectNow`, both read in one place.

**One boundary note for the Billing reviewer**, found while checking this and not mine to judge:
`CollectBlock` (`correction-sections.tsx:515`) now filters `stillOpen` on
`openCollectionOf(correction, canPay)`, which returns `null` for a reader who cannot pay, so an
**approver on the Billing view sees no "still to collect" row at all**, where before they saw the
state without a button. The fact is not lost, because `CorrectionsExplained` (`:595`) asks with
`canPay = true` on purpose and its badge still states it on the Money view. Recorded so the split
is a decision and not an accident.

## F-EV2-02: FIXED

The bar and the band are one sticky wrapper now (`components/portal-frame.tsx:56-61`,
`.portal-sticky`), and neither pins on its own: `app/styles/system.css` removed `position: sticky`
and `top: var(--top-h)` from `.page-band`. A wrapper cannot be wrong about its own height, which
is the right shape of fix rather than a wider token.

**Re-measured at the widths of the finding and the builder's, scrolled so both are pinned**: four
paths (cancel preview, endorse preview, policy page, `/ops/console`) at twelve widths, **48
measurements**. In **every one of them the gap between the bar's bottom and the band's top is
exactly 0 px**, and the band title is never covered.

| Width | bar height on the two previews | band top | gap | title covered |
|---|---|---|---|---|
| 810, 850, 900, 950, 1000 | **91** | 91 | **0** | no |
| **1024** | **91** | 91 | **0** | no |
| **1040** | **91** | 91 | **0** | no |
| 1060, 1100, 1280 | 62 | 62 | **0** | no |
| 1440, 1920 | 40 | 40 | **0** | no |

On the policy page and `/ops/console`, whose trail is three deep, the bar is 62 px at 810 to 1280
and 40 px at 1440 and up, and the gap is 0 at every width.

**One correction to the builder's note.** The message said the three-row bar could not be
reproduced at 1024 on this merge and was found at 810 to 950 instead. I measure a **91 px
three-row bar on both previews at 1024 and at 1040**, and a two-row bar from 1060. The band follows
it correctly at all of them, so it does not reopen F-EV2-02, but the range matters because the
drawer rule was scoped to `max-width: 1000px` on that assumption: see F-EV2-08 and the note under
it.

**On the `break.mjs` false positive.** The coordinator is right that the script's `r.top <= 60`
threshold now calls a correct 62 px band "NOT STICKY" at 1024. I did not judge by that line. The
numbers above come from a direct measurement of `getBoundingClientRect()` on both elements, and the
375 px sweep's `BAND NOT STICKY` lines are the deliberate behaviour under 800 px, which the first
record already established by measuring `ui-evening` the same way.

**No regression on the rest of the top bar.** At 1024, 1280, 1440 and 1920, on the policy page and
`/ops/console`: no horizontal overflow, 0 dash characters, the AF-02 line complete and unclipped
(`Stripe: LIVE SANDBOX · claim rail: LOCAL SIMULATOR · bank check: LOCAL SIMULATOR`), the two
stacks still `["Cover","Broker"]` and `["So far, from the journal","Documents"]`, and both Documents
forms still `method="get"`, `name="asOf"`, `target="_blank"` with their unchanged actions.

The four-item trail of the previews is now **whole and unellipsised at 1024 and 1280** (58 / 47 /
110 / 128 px), where the first record measured it whole too; at 1440 the three leading items
ellipsise and the last stays whole, as before. The new `.breadcrumb li:last-child { flex-shrink: 1 }`
under 1280 therefore costs nothing at the widths tested.

## F-EV2-08 (MEDIUM, new): the inspector panel covers the AF-02 line between 801 and 1000 px

**Where:** `app/styles/system.css:2524-2528`, the block added by `0bef75b`:

```css
@media (max-width: 1000px) {
  .drawer {
    top: 0;
    height: 100dvh;
  }
}
```

**Why it was added:** the drawer is `position: fixed` and offsets by `--top-h` (`:1740-1745`), so
it cannot follow a wrapper it does not measure; below 1000 px, where the bar can take a third row,
starting it at 0 stops it beginning halfway up the bar. The reasoning is sound. The consequence is
not: between **801 and 1000 px the bar is still sticky and visible**, so a 440 px opaque white
panel is now drawn on top of its right end.

**Trigger:** any staff screen with an inspector reference, opened with `?inspect=…`, at a viewport
of 801 to 1000 px. Measured on `/policies/<CGP-01709>?view=money&inspect=cs_test_…`.

**Measured**, `elementFromPoint` on each phrase of the mode line, plus the boxes of every fixed
element that intersects it:

| Width | bar | `aside.drawer` box | Phrases of the AF-02 line covered by the panel |
|---|---|---|---|
| **810** | 91 px, visible | `370,0 440x900` | `claim rail`, `bank check`, `LOCAL SIMULATOR` |
| **900** | 62 px, visible | `460,0 440x900` | `bank check`, `LOCAL SIMULATOR` |
| **999** | 62 px, visible | `559,0 440x900` | `bank check` |
| **1000** | 62 px, visible | `560,0 440x900` | `bank check` |
| **1001** and up | 62 / 40 px | does not intersect the bar | **none** |
| 790 and below | bar is `position: static` and has scrolled away | n/a | not applicable |

**Screenshot:** `drawerchk2/d-810.png`. The line reads `Stripe: LIVE SAND` and stops at the panel's
edge; the band title `Policy CGP-01709` is cut the same way.

**Not the backdrop.** `a.drawer-backdrop` also sits over the bar, at every width including 1440,
but its computed background is `rgba(0, 0, 0, 0)` and its opacity is 1: it is a transparent
click-catcher that paints nothing, so it does not hide anything. It is pre-existing and is not the
problem. The opaque `aside.drawer` is.

**Why it matters.** The project's own rule, written beside `.topbar-modes`, is "Never cut: AF-02
asks for these words exact and visible, so the search field beside it is what gives way on a narrow
screen, never this line." Between 801 and 1000 px, with the inspector open, the words are cut. This
is a UI regression against a rule the team set for itself, not a claim that the integration
inventory is wrong: the README and the labels are untouched, and the line is complete again as soon
as the drawer is closed or the window is 1001 px or wider. I record it as MEDIUM rather than an
AF-02 breach for that reason, and note that a reviewer taking screenshots at a laptop width with a
drawer open would capture a truncated AF-02 line.

**Not present before `0bef75b`**: `.drawer` was `top: var(--top-h)` at every width above 800, so it
began at 62 px and never touched the bar in this band. The pre-existing `top: 0` under 800 px is
harmless because the bar is `position: static` there and has scrolled away.

**Correction, either of:**
- have the sticky wrapper publish its measured height (a `ResizeObserver` writing a custom
  property on `:root`) and give `.drawer` `top: var(--sticky-h)`, which removes the token coupling
  the fix set out to remove and lets the 1000 px block go away; or
- keep the rule but raise `.portal-sticky` above the drawer (`z-index` over 40) in that band, so
  the bar paints over the panel instead of under it.

The second is one line; the first is what the rest of the fix already committed to.

**Residual, LOW, no finding raised:** `.drawer` still offsets by `--top-h` above 1000 px, so it is
only correct while every screen that carries an inspector keeps a two-row bar. Today they do: the
three-row bar appears on the endorse and cancel previews, which have no inspector, and I measured
`/policies/<id>?view=money&inspect=…` and `/ops/console` at 1001, 1010, 1024, 1040 and 1060 with no
intersection. It is a coupling to remember, not a defect to fix now.

## F-EV2-03: FIXED

`grep -nE "#[0-9a-fA-F]{3,8}" app/styles/signed.css` returns **nothing**. The re-book preview row is
`border: 1px dashed var(--line)` and `background: var(--bg)` (`:69-72`), both real tokens
(`--line: #dedee1`, `--bg: #f6f6f6`, `app/globals.css:33-34`), and the rule's own comment says which
token and why.

Residual, not worth a finding: the file header still reads "EXISTING TOKENS ONLY: `--ok` and
`--danger`, the accent, and `--ink-2`, all defined in `app/styles/system.css`". It now omits
`--line` and `--bg`, and of the four it does name only `--ok` and `--danger` are in `system.css`
(`--ink-2` is in `globals.css`). The substantive complaint, literal colours under a "no new palette"
claim, is gone.

## F-EV2-04: FIXED

`app/styles/system.css:578` is `min-width: 160px`, and the comment at `:572-576` now records the
measurement rather than an assumption: "screenshotted at 150, 160, 170 and 180, the 150 px box read
'Find a referenc' and 160 was the first that fitted (review finding F-EV2-04, corrected from the
150 px this comment used to claim)". Measured on the two previews at 1440, `topbar-search` is
**160 px**, its new floor, where the first pass measured 150.

## F-EV2-05: FIXED

`collectAnchorFor(rebookEventId)` (`correction-sections.tsx:430-432`) returns `collect-<id>`, the
collect row carries `id={collectAnchorFor(correction.rebookEventId)}` (`:535`), the band builds the
same id (`page.tsx:238`), and the broker inbox row builds it too
(`lib/inbox/sections.ts:246`, `?view=billing#collect-${correction.rebookEventId}`), with the finding
quoted in the comment above it. `CollectBlock` maps over **every** still-open correction rather than
anchoring only the first, so two open differences on one policy now get two rows and two anchors.

`grep -rn '#collect"' app lib components` returns **nothing**: no bare `#collect` href is left
anywhere. Runtime: `id="collect"` appears **0 times** on the six policies across three roles, and
the broker inbox contains **0** `collect-` anchors, which is correct with nothing open.

## F-EV2-06: FIXED, and verified at runtime

The chip reads what the entry does, and nothing is struck any more. On CGP-01707's Money view, in
the DOM:

```
<span class="badge badge-danger">undoes <!-- -->63646ae0</span>
<span class="badge badge-danger">undoes <!-- -->f1fc2553</span>
<span class="badge badge-ok">re-booked on <!-- -->2026-09-22</span>
<span class="badge badge-ok">re-booked on <!-- -->2026-09-22</span>
```

`grep -c entry-struck` on the same page: **0**. The comment at `correction-sections.tsx:685-690`
gives the reason the first record asked for: the four entries in this table are real postings that
stand, and the entry that stopped being true belongs to the endorsement and is not in the table, so
striking a line that is still true was the same mistake as the wording. The `struck` flag is gone
from `EntryMark` (`components/journal-table.tsx:34`).

## F-EV2-07: ACCEPTED, unchanged

`break.mjs` at 375 still reports `BAND TOO TALL 153px` on the policy page, the Billing view and the
Money view of CGP-01709. Nothing overlaps and there is no overflow. Recorded as accepted by the
coordinator, not as closed by a change.

## The 375 px sweep, re-run

Six paths on CGP-01709 (overview, Billing, Money, `/ops/console`, `/inbox`, the cancel preview),
plain, with every fold opened, with a popover open and with the inspector open:

**No `HORIZONTAL OVERFLOW` line on any state, and no `DASH CHARACTERS` line.** The fifteen guard
lines reported are the two known ones only: `BAND TOO TALL 153px` (F-EV2-07, accepted) and
`BAND NOT STICKY` (deliberate under 800 px, and identical on `ui-evening`). The Billing view is new
since the first record and behaves the same as the other two views at this width.

## Register lines, updated

| ID | Sev | Finding (one line) | Fix | Status |
|---|---|---|---|---|
| F-EV2-01 | MED | Band "Collect $X" was drawn for any reader of the policy page, including the approver and a broker still waiting on the customer | `openCollectionOf` returns null when `!canPay`, and the band tests `canCollectNow` | **FIXED 0259d6c** |
| F-EV2-02 | MED | At 810 to 1040 px a three-row top bar left the sticky band 29 px under it, its title cut | The bar and the band are one sticky wrapper (`.portal-sticky`); gap measured 0 px at 48 width/path pairs | **FIXED 0bef75b** |
| F-EV2-03 | LOW | `signed.css` claimed "existing tokens only" while adding two literal hexes | The re-book preview row uses `var(--line)` and `var(--bg)`; no literal hex left in the file | **FIXED f763714** |
| F-EV2-04 | LOW | The search minimum of 150 px cut the placeholder the comment said it fitted | Minimum raised to 160 px, comment records the four widths measured | **FIXED 0bef75b** |
| F-EV2-05 | LOW | One bare `collect` anchor for several open corrections, all inbox rows landing on the first | `collectAnchorFor(rebookEventId)`, one anchor per open correction, band and inbox build the same id | **FIXED 0259d6c** |
| F-EV2-06 | LOW | The "reversed" chip and the strike landed on the reversal, which still stands | The chip reads `undoes <entry id>`, the `struck` flag is gone | **FIXED 0259d6c** |
| F-EV2-07 | LOW | The 375 px policy band grows to 153 px with the new band action | None; accepted as it is | **DECIDED, accepted by the coordinator** |
| F-EV2-08 | MED | The `max-width: 1000px` drawer rule added by the F-EV2-02 fix paints the opaque inspector panel over the top bar from 801 to 1000 px, cutting the AF-02 mode line | Publish the sticky wrapper's measured height and offset the drawer from it, or raise `.portal-sticky` above the drawer in that band | **OPEN** |

## What this pass did not run

| Not run | Why |
|---|---|
| The positive case of the band "Collect $X" and of a per-correction anchor | No correction with an open difference exists on any of the six policies. Verified by code reading plus negative runtime evidence, and said so. |
| The Billing view's collect block itself | The Billing reviewer's scope, by the coordinator's assignment. One boundary note is recorded under F-EV2-01. |
| The signed colours, the empty states, `what-needs-you`, the figures, the hostile URLs | Unchanged scope, no fix touched them, and the first pass measured them at `0fadcfa`. Prior evidence stands for unchanged code only, which is why the top bar and the correction entries were re-measured and these were not. |
| AF-01, AF-04, AF-06 delivery gates | Outside this diff, as before. NOT RUN, never implicit PASS. |

**Walkthrough status: still NOT REVIEWED WITH YOANN.** Nothing in this pass establishes that Yoann
can explain `.portal-sticky`, `collectAnchorFor` or the `canPay` gate.

---

# Re-review, second pass, 2026-09-09 late evening

**New revision:** `7b527f0` (`ui-evening-2` head), merged into the same worktree as `5e7f9b6`.
Both sections above stand unchanged; this one is appended. `2fca4c6` and `d8aa06d` are both
ancestors of the merge.

**Scope of this pass:** F-EV2-08 only, plus the checks its fix could break.

## Verdict of the second re-review

**PASS at `7b527f0`** for the screens part, with **one accepted LOW residual**.

F-EV2-08 is **FIXED from 888 px up**, which covers every width in the brief's targets and every
width either pass of this review has measured on a real screen. Below that, on a screen carrying an
inspector, the panel still covers the right end of the AF-02 mode line; that is recorded as
**F-EV2-09 (LOW)** and accepted for tonight by the coordinator, with the week-two line already
named in the code.

| ID | Sev | Status |
|---|---|---|
| F-EV2-01 to F-EV2-06 | 2 MED, 4 LOW | **FIXED**, verified in the first re-review |
| F-EV2-07 | LOW | **DECIDED**, accepted, unchanged |
| F-EV2-08 | MED | **FIXED 2fca4c6** at 888 px and above |
| F-EV2-09 | LOW | **DECIDED**, accepted tonight, week-two fix named |

**Checks re-run on this merge:** `npm run typecheck` **exit 0**; `npm test` **exit 0** (554 tests,
**553 pass, 0 fail, 1 skipped**); `npm run build` **exit 0** (`✓ Compiled successfully in 730ms`,
no warning). `gitleaks detect --log-opts "ui-evening..7b527f0"`: 72 commits, ~895 KB, **no leaks
found**. Dashes added by `2fca4c6`: **0**. Form contract lines changed by `2fca4c6`: **0**.

## The fix

`2fca4c6` deletes the `@media (max-width: 1000px) { .drawer { top: 0; height: 100dvh } }` block
outright. `grep -n "max-width: 1000px" app/styles/system.css` returns **nothing**, and `.drawer`
(`:1747-1752`) is back to `top: var(--top-h)` and `height: calc(100dvh - var(--top-h))` at every
width above 800. The reason sits beside the rule (`:1740-1746`), including what to do if the case
ever widens: "If a three-row bar ever reaches a screen with an inspector, publish the sticky
wrapper's real height rather than start the panel higher." That is the right note to leave: the
rule is correct today because of a fact about the screens, and the note says which fact.

## Re-measured, the five widths and the exact boundary

`/policies/<CGP-01709>?view=money&inspect=cs_test_…` as staff operations, `elementFromPoint` on
each phrase of the AF-02 line, plus the box of every fixed element that intersects it, plus the
bar and band rectangles.

| Width | bar | band top | gap | inspector panel box | AF-02 line |
|---|---|---|---|---|---|
| **810** | 91 px, three rows | 91 | **0** | `370,62 440x838` | **cut**: `claim rail`, `bank check`, `LOCAL SIMULATOR` under the panel |
| 886 | 91 px | 91 | **0** | `446,62` | cut: `bank check`, `LOCAL SIMULATOR` |
| **887** | 91 px | 91 | **0** | `447,62` | cut: `bank check`, `LOCAL SIMULATOR` |
| **888** | 62 px, two rows | 62 | **0** | does not reach the bar | **whole** |
| **900** | 62 px | 62 | **0** | `460,62` | **whole** |
| **1000** | 62 px | 62 | **0** | below the bar | **whole** |
| **1024** | 62 px | 62 | **0** | below the bar | **whole** |
| **1280** | 62 px | 62 | **0** | below the bar | **whole** |
| 1440 | 40 px | 40 | **0** | below the bar | **whole** |

**The exact boundary is 887 / 888 px**, not "about 899": at 887 the Money view's bar is still
91 px and its third row carries the mode line at `y = 66..84`, under a panel that starts at 62; at
888 the bar drops to 62 px and the mode line moves to `y = 37..55`, clear of it. Bisected at 884,
885, 886, 887, 888, 890, 895, 899. The builder's "900 and up" is correct and conservative by
twelve pixels.

**Screenshots:** `drawerchk2/d-900.png` shows the whole line,
`Stripe: LIVE SANDBOX · claim rail: LOCAL SIMULATOR · bank check: LOCAL SIMULATOR`, with the panel
starting under the bar. `drawerchk2/d-810.png` shows the residual: the line reads
`Stripe: LIVE SAND` and stops at the panel's edge.

**The band still follows the bar exactly**, which is F-EV2-02 holding: the gap between the bar's
bottom and the band's top is **0 px at all nine widths above**, including the three-row cases, and
there is no horizontal overflow at any of them.

**A measurement note for whoever repeats this.** `document.querySelector("aside.drawer")` is the
wrong instrument on the Money view: the page carries **five** elements with that class, four of
them the closed amount-explained folds (`details.amount-explained-drawer`), and the inspector is
the last. A probe using the first match reads a panel at `y = 429` and concludes there is no
overlap at 810, which is wrong. The numbers above come from iterating every positioned element and
keeping the ones whose box intersects the mode line, then confirming with `elementFromPoint` per
phrase and with a screenshot. I raise it because it is the kind of instrument error that turns a
real overlap into a clean report.

**Not the backdrop, again.** `a.drawer-backdrop` covers the bar at every width including 1440, but
its computed background is `rgba(0, 0, 0, 0)`: it paints nothing and hides nothing. Only the opaque
`aside.drawer` matters, and above 887 px it never reaches the bar.

## F-EV2-09 (LOW, accepted): below 888 px the inspector still covers the end of the AF-02 line

**Where:** `app/styles/system.css:1747-1752` (`.drawer { top: var(--top-h) }`) against the top bar,
which can take a third row on the Money view below 888 px.

**Trigger:** staff operations, a screen with an inspector reference opened with `?inspect=…`, at a
viewport of **801 to 887 px**. Above 887 the bar is two rows and the panel is clear of it; at 800
and below the bar is `position: static` and has scrolled away, so there is nothing to cover.

**Consequence:** the right end of the mode line is behind the panel. Measured at 810: `claim rail`,
`bank check` and `LOCAL SIMULATOR` are under `div.drawer-head`. The words are complete again as
soon as the drawer is closed or the window is 888 px or wider, and nothing else on the screen is
wrong: the band still sits flush under the bar and there is no overflow.

**Accepted tonight** on the coordinator's decision: desktop widths below 900 px are outside the
brief's targets. Recorded rather than closed, because it is a real difference between what the
screen shows and the rule the project wrote for itself beside `.topbar-modes` ("Never cut: AF-02
asks for these words exact and visible"). **Two things follow from accepting it**, and they are the
reason the line is worth keeping in the register rather than dropping:

1. **Evidence discipline.** No submission screenshot should be taken at a viewport under 888 px
   with an inspector open, or it will carry a truncated AF-02 line. Every screenshot in this review
   is at 375, 810 to 1040 (measurement only, not evidence), 1440 or 1920.
2. **The named week-two fix** is already written in the code comment: publish the sticky wrapper's
   measured height as a custom property and offset the drawer by it. That removes the last token
   coupling in the shell and makes both F-EV2-08 and F-EV2-09 structurally impossible rather than
   true-by-observation.

This is not recorded as an AF-02 breach. The integration inventory, the labels and the README are
untouched and correct; this is a layout defect at one range of widths, on one screen state.

## Register lines, updated

| ID | Sev | Finding (one line) | Fix | Status |
|---|---|---|---|---|
| F-EV2-01 | MED | Band "Collect $X" was drawn for readers with no button behind it | `openCollectionOf` returns null when `!canPay`, band tests `canCollectNow` | **FIXED 0259d6c** |
| F-EV2-02 | MED | A three-row top bar left the sticky band 29 px under it | The bar and the band are one sticky wrapper; gap measured 0 px at 57 width/path pairs across both passes | **FIXED 0bef75b** |
| F-EV2-03 | LOW | `signed.css` claimed "existing tokens only" while adding two literal hexes | `var(--line)` and `var(--bg)`; no literal hex left in the file | **FIXED f763714** |
| F-EV2-04 | LOW | The 150 px search minimum cut the placeholder the comment said it fitted | Minimum 160 px, comment records the four widths measured | **FIXED 0bef75b** |
| F-EV2-05 | LOW | One bare `collect` anchor for several open corrections | `collectAnchorFor(rebookEventId)`, one anchor per open correction | **FIXED 0259d6c** |
| F-EV2-06 | LOW | The "reversed" chip and the strike landed on the reversal, which still stands | The chip reads `undoes <entry id>`, the `struck` flag is gone | **FIXED 0259d6c** |
| F-EV2-07 | LOW | The 375 px policy band grows to 153 px with the new band action | None; accepted as it is | **DECIDED, accepted** |
| F-EV2-08 | MED | The `max-width: 1000px` drawer rule painted the inspector panel over the top bar from 801 to 1000 px, cutting the AF-02 line | The block is deleted; the panel offsets by `--top-h` again. AF-02 line whole from **888 px** up, band gap 0 px at every width | **FIXED 2fca4c6** |
| F-EV2-09 | LOW | Between 801 and 887 px the Money view's bar takes a third row and the inspector panel covers the end of the AF-02 line | None tonight. Week two: publish the sticky wrapper's height as a custom property and offset the drawer by it (already named in the code comment) | **DECIDED, accepted tonight** |

## What this pass did not run

| Not run | Why |
|---|---|
| F-EV2-01 and F-EV2-05 positive cases | Still no correction with an open difference on any policy. Unchanged since the first re-review, where they were verified by code reading plus negative runtime evidence. |
| The signed colours, the empty states, `what-needs-you`, the figures, the hostile URLs, the 375 px sweep | `2fca4c6` touches one CSS block and nothing else; the form contract and dash checks on it are clean. Prior evidence stands for unchanged code. |
| AF-01, AF-04, AF-06 delivery gates | Outside this diff, as in both earlier passes. NOT RUN, never implicit PASS. |

**Walkthrough status: still NOT REVIEWED WITH YOANN.** Nothing in this pass establishes that Yoann
can explain `.portal-sticky`, the `--top-h` coupling or why the drawer offsets by a token.
