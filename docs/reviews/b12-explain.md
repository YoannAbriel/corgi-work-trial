# Independent review: B12-2 "explain this amount" and B12-3 "as it stood on" steps

Feature IDs: B12 (docs/PLAN.md), items 2 and 3 of the three decided by Yoann on 2026-09-08
(docs/DECISIONS.md 18:52:54Z, display shape confirmed 2026-09-09 06:24:14Z). Linear YOA-625 and
YOA-626.

Reviewer: independent reviewer sub-agent, own worktree `worktree-agent-ae1296a4ce5b46bb2`.
Timestamp: 2026-09-09T09:05Z. Timebox: 60 minutes.

Reviewed revision: `b40e803` (main), working tree clean at review start. The slice under review
landed with the merge `a6aca56` of `worktree-agent-acc7e1cd088537310` (branch commit `d7ee2d3`).
The diff actually inspected is `a6aca56^1..a6aca56`, that is `369671d..a6aca56`, 12 files,
+1719/-80. The other two changes carried by `b40e803` (customer change requests, merge
`a6aca56..b40e803`; the F-B2-21 lock fix at `369671d`) are outside this scope and are reviewed
elsewhere.

Deployed revision measured: `https://corgi-work-trial-iota.vercel.app`, `/api/health` reporting
`{"ok":true,"database":"ok","revision":"b40e80388a8f95d8fdc5fce533da0838012a76c9"}` at 06:49Z, so
the deployment carries the reviewed revision.

## Startup receipt

Files actually read in full: `CLAUDE.md`, `AUTOMATIC-FAILS.md`, `READABLE-CODE.md`, `AGENTS.md`,
`WORKFLOW-48H.md`, `REVIEWER.md`, `docs/handoffs/b12-2-3-notes.md`, `lib/money/explain.ts`,
`components/amount-explained.tsx`, `components/formula-lines.tsx`.

Read in the parts relevant to the scope: `docs/PLAN.md` (the B12 row and the backlog preamble),
`docs/DECISIONS.md` (2026-09-08T18:52:54Z, 2026-09-08T20:38:26Z, 2026-09-09T06:24:14Z,
2026-09-09T06:35:24Z), `docs/reviews/FINDINGS.md` (the whole register tail, F-B8, F-UI, F-YA,
F-B11, F-B12-01), `lib/money/explain.test.ts`, `app/policies/[policyId]/page.tsx`,
`app/policies/[policyId]/correction-sections.tsx`, `app/ops/claims/[claimId]/page.tsx`,
`app/statements/[runId]/page.tsx`, `lib/policy/correction-read.ts` (`policyAsOfSteps`),
`lib/policy/endorsement-read.ts` (`endorsementScheduleOfPolicy`), `lib/money/endorsement.ts`
(`endorsementFormulaLines`, `delta_total`), `lib/money/premium.ts` (`stateTaxCents`,
`earnedPremiumOfSegment`, `CancellationBreakdown`), `lib/statements/compute.ts`
(`collectedFigures`, `totalsOf`), `lib/statements/read.ts`, `lib/claims/money-position.ts`,
`app/globals.css` (the added block), `app/login/page.tsx`.

Not read: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`,
`GAP-REVIEW.md`, `START-PROMPT.md`. No performance work and no retained readiness control applies
to a read-only presentation slice; no stress test was planned or run.

Absent files: none in the scope.

## Applicability

Product and scope: Track 1 policy administration, sandbox only, USD integer cents. This slice is
**presentation plus one new read query**. It creates no money row, sends nothing to a provider,
adds no endpoint, no form, no field and no migration. It therefore raises no new question under
FinCEN CIP/CDD, OFAC or CFPB product rules: no new data is collected, transmitted or decided on.
The applicable requirements are the trial's own and the repository's engineering safeguards:
AF-01, AF-03, AF-05, AF-06, `READABLE-CODE.md`, and the money-display invariant the slice itself
states ("an explanation is never a second calculation").

Confirmed facts: the deployed revision, the trial database contents observed through the deployed
screens, the diff. Assumption carried forward, not verified here: that the stored cancellation and
endorsement figures were themselves computed correctly at execution time (that is B4/B5/B7 scope,
already reviewed).

## Requirement matrix

| # | Requirement | Control / code location | Evidence | Verdict |
|---|---|---|---|---|
| 1 | Every explanation ends on the figure it sits under, from the same pure function or the stored lines, never a second formula | `lib/money/explain.ts`; `components/amount-explained.tsx` agreement check; `ledgerSoFar` refactored onto `accountSumCents` | 23 fold sites classified below; 47 folds rendered live, 0 disagreement alerts; 12 unit tests | PASS |
| 2 | Nothing computed in the browser | `AmountExplained` and `FormulaLinesTable` are server components; native `<details>` | No `"use client"` added; the list of client files is identical before and after the merge | PASS |
| 3 | Forms, field names, role checks and uuid guards unchanged | none touched | `name="…"` multiset, `<form action=…>` targets and the guard lines of the four changed pages are byte-identical across the merge | PASS |
| 4 | As-of steps: term start, non-superseded event dates, today; superseded absent; same-day merged; current marked; PDF links follow the date | `policyAsOfSteps` (`lib/policy/correction-read.ts`), `PolicyAsOf` | Live on CGP-01274, CGP-01707, CGP-01062, CGP-01061; `aria-current="date"` on the requested step; both PDFs 200 `application/pdf` with `?asOf=2026-10-08` | PASS with F-B12-04 |
| 5 | AF-06 readability of `explain.ts` and the component | one pure file, no database, no clock, named rounding rules | short reading path, hand-worked examples in the tests | PASS with F-B12-02, F-B12-03 |
| AF-01 | Accessible deployed URL carrying the reviewed revision | Vercel | `/api/health` revision `b40e803`; both roles signed in; every screen 200 | PASS |
| AF-03 | No UPDATE or DELETE on money rows | the slice is read-only | no `insert`/`update`/`delete` in `explain.ts` or `policyAsOfSteps`; `policyAsOfSteps` reuses the existing `policyTimeline` select | PASS |
| AF-05 | No secrets committed | gitleaks | `gitleaks detect --log-opts=369671d..d7ee2d3` and `--log-opts=a6aca56^1..a6aca56`: no leaks; working tree `--no-git`: no leaks; no secret printed in this record | PASS |
| AF-06 | Candidate can explain every line | see below | technical only; walkthrough NOT REVIEWED WITH YOANN | see status |
| AF-02, AF-04 | Simulation labels, sandbox only | untouched by this slice | no provider call, no label changed | NOT APPLICABLE to this diff |

## The 23 folds, and which mechanism covers each

The handoff names three mechanisms. Read against the code, they are: **(1) the event's own stored
lines**, **(2) the figure and the fold call the same function or are literally the same value**,
**(3) a genuine render-time comparison** where the figure and the explanation come from two
different places and the component checks them.

| Folds | Screen and figure | Figure comes from | Explanation comes from | Mechanism |
|---|---|---|---|---|
| 1 | Policy, terms in force: premium tax | `policy.tax_cents`, stored | `stateTaxCents(annualPremiumCents, taxRateBps)`, recomputed | **3**, and it is real: a stored tax that no longer matches its own premium and rate raises the alert |
| 2 | Policy: policy fee | `policy.fee_cents` | `explainPolicyFee` echoes the same value | **2**, identity by construction |
| 3 | Policy: full annual term | `policy.total_charge_cents`, stored column | premium + tax + fee from the same stored row | **3**: a stored total that drifted from its three parts raises the alert |
| 4 | Endorsement schedule: prorated delta, one per non-superseded endorsement | `row.figures.deltaTotalCents`, from the event payload | `endorsementFormulaLines(figures)`; the `delta_total` line is `figures.deltaTotalCents` | **1**, identity by construction |
| 5-11 | Cancellation: written, earned, unearned, refunded tax, refunded fee, total refund, clawback | the seven fields of the stored cancellation event | `cancellationFormulaLines(cancellation)` reads those same seven fields | **1**, identity by construction; the seven folds share one table and point at seven different lines |
| 12-15 | Policy, so far from the journal: collected, refunded, commission net, unearned | `ledgerSoFar(entries)`, now `accountSumCents(...)` | `explainAccountSum` totals with `accountSumCents(...)` | **2**, one implementation, verified: the old inline loop was replaced by the same four calls with the same rules |
| 16-17 | Claim: paid, reserve | `claim.position.paidCents` / `reserveCents` | `explainClaimIncurred` echoes both | **2**, identity by construction |
| 18 | Claim: incurred | `claim.position.incurredCents` | `paidCents + reserveCents` | **3** in form; in practice identity, because `money-position.ts` sets `incurredCents: paidCents + reserveCents` in the same fold |
| 19-23 | Statement: cash collected, premium collected, commission earned, clawback, net due | the stored `statement_runs` totals | re-summed from the stored `statement_lines`; net due re-derived from the three stored totals | **3**, the strongest of the three: this is the one that would catch a store whose lines and totals had drifted apart |

15 + 3 + 5 = 23, matching the handoff. On the trial data the maximum reached on one policy page is
14 (no policy carries both an endorsement row and a cancellation).

### Cases constructed to make the explanation and the figure disagree

- **Rounding at a boundary.** The tax fold is the one place a stored figure meets a recomputation.
  Measured: CGP-01274 stored 5433, `floor(231200 x 235 / 10000) = 5433`; CGP-01707 stored 5640,
  `floor(240000 x 235 / 10000) = 5640`. Agree. Had they not, the component prints a `role="alert"`
  paragraph saying the figure is what the ledger holds and the arithmetic must not be read as an
  explanation of it, and keeps rendering.
- **A cancellation after an endorsement.** No alert can fire: the figure and every line come from
  the same stored cancellation event. The exposure is not a wrong number but a wrong printed
  ratio, see F-B12-03.
- **A v1 statement run.** Verified live: runs `c2a6aa84` and `de8416cd` render **0 folds** and
  print "not stored on this revision" for the premium base. Runs `8effa7c1` and `c775c8ce` (v2)
  render 5 folds each, 0 alerts. The deliberate refusal works.
- **A reversed entry inside a sum.** Verified live on statement `c775c8ce`: the reversal of the
  fabricated CGP-01061 binding appears as `-$1,253.20` in cash collected and `-$180.00` in
  commission earned, and the totals `-125320 + 355684 + 125320 + 239133 = 594817` and
  `34680 + 51761 + 18000 + -18000 = 86441` end on the printed figures. Correct.
- **An explanation whose `resultKey` names no line.** `explanationResultLine` returns null and the
  component says "and it carries no result line" instead of throwing. Not reachable from any of
  the 23 sites; the type does not prevent it, which is the right trade for a display path.

## Measurements on the deployed application

Signed in as `broker@example.com` and `ops@example.com` with the demo password read from the main
tree's `.env.local` and never printed; both logins returned 303 with a session cookie.

| Screen | Folds rendered | Disagreement alerts | As-of steps |
|---|---|---|---|
| CGP-01274 (cancelled, open claim), ops | 14 | 0 | 3: 2026-09-09 today, 2026-09-17 term start, 2026-10-31 cancellation |
| CGP-01274, broker | 14 | 0 | 3 |
| CGP-01707 (endorsed 2026-10-08, delta collected 2026-09-09), ops | 8 | 0 | 3: 2026-09-08 term start, 2026-09-09 today, 2026-10-08 endorsement |
| CGP-01707, broker | 8 | 0 | 3 |
| CGP-01062 (cancelled), ops | 14 | 0 | 3 |
| CGP-01061 (voided by correction), ops | 7 | 0 | 2: 2026-09-09 today, 2028-03-01 term start |
| Claim `2f78c23c`, ops | 3 | 0 | n/a |
| Statement `8effa7c1` (v2), ops and broker | 5 | 0 | n/a |
| Statement `c775c8ce` (v2), ops | 5 | 0 | n/a |
| Statements `5321274f`, `c2a6aa84`, `de8416cd` (v1 or empty) | 0 | 0 | n/a |

**Total: 47 folds rendered on the deployed revision, 0 disagreement alerts.**

Figures checked by hand against the fold contents:

- CGP-01274 tax `floor(231200 x 235 / 10000) = 5433`; earned `floor(231200 x 44 / 365) = 27870`;
  unearned `231200 - 27870 = 203330`; tax back `ceil(203330 x 235 / 10000) = 4779`; total refund
  `203330 + 4779 + 0 = 208109`; clawback `floor(203330 x 1500 / 10000) = 30499`. All seven
  cancellation folds print exactly these and end on their own line.
- CGP-01707 endorsement delta: `floor(120000 x 335 / 365) = 110136`, tax
  `floor(110136 x 235 / 10000) = 2588`, total `110136 + 2588 = 112724 = $1,127.24`, which is the
  figure in the schedule row.
- CGP-01707 ledger sums: collected `125320 + 112724 = 238044`; commission payable
  `18000 + 16520 = 34520`; unearned `120000 + 110136 = 230136`. CGP-01274 commission payable
  `34680 - 30499 = 4181`; unearned `231200 - 203330 - 27870 = 0`.
- Claim `2f78c23c`: paid 120000, reserve 380000, incurred 500000, and the fold ends on each.
- Statement `c775c8ce`: net due `86441 - 47506 + 0 = 38935 = $389.35`.

As-of control: `?asOf=2026-10-08` on CGP-01707 marks that step `aria-current="date"` (exactly one
occurrence), the result heading reads 2026-10-08, and both PDF links carry `?asOf=2026-10-08` and
return `application/pdf` (7739 and 5991 bytes).

## Checks executed

| Check | Command | Result |
|---|---|---|
| Unit tests | `npm test` in this worktree after `npm ci` | 426 tests, 425 pass, 1 skipped, 0 fail, including the 12 in `lib/money/explain.test.ts` |
| Types | `npx tsc --noEmit` | clean, no output |
| Secrets, branch commits | `gitleaks detect --log-opts="369671d..d7ee2d3"` | no leaks found |
| Secrets, merge | `gitleaks detect --log-opts="a6aca56^1..a6aca56"` | no leaks found |
| Secrets, working tree | `gitleaks detect --no-git` | no leaks found, ~4.44 MB scanned |
| Client-side computation | diff of the `"use client"` file list across the merge | identical |
| Forms and guards | diff of `name="…"`, `<form action=…>` and the guard lines of the four changed pages | identical, only line numbers moved |
| Deployed revision | `GET /api/health` | `b40e803…` |
| Deployed screens | 11 authenticated page fetches as two roles, plus 2 PDF fetches | all 200 |

## Checks not executed, and why

- **No browser render.** No headless browser is available here. Every measurement above is taken
  from the server-rendered HTML of the deployed revision. The appearance of the folds inside the
  narrow side column, on a phone, and the contrast of the current step's hard-coded
  `#f4cdb5`/`#fff1e8` are **unverified**. The builder recorded the same gap.
- **No check script.** All of `scripts/check-*.ts` write to a database; the instruction forbids a
  writing script and the slice contains no write path to prove.
- **No `npm run build`.** Types and tests were run instead; the builder recorded a passing build
  at the branch head.
- **A `correction_rebook` step was never rendered.** The trial database holds four policies and
  none carries a corrected endorsement (CGP-01061 was corrected by a void, which produces no
  step, as designed). The `"corrected endorsement"` label and the two-events-on-one-day merge are
  therefore verified **by code reading only**, not observed live.
- **An endorsed-then-cancelled policy does not exist in the trial data.** F-B12-03 is a
  code-reading finding; it was not observed on a screen. I did not create one: a reviewer does not
  book money rows.
- **The correctness of the stored cancellation and endorsement figures themselves** is out of this
  scope (B4/B5/B7, already reviewed). This review checks that the fold ends on the stored figure,
  not that the stored figure was right when it was computed.

## Findings

### F-B12-02 (MEDIUM): a journal-sum fold lists lines that contributed nothing, with a formula cell that contradicts its own result cell

`explainAccountSum` (`lib/money/explain.ts`) walks **every** line on the account and emits a
formula line for each, whatever the rule. Under `rule: "debits"` a credit line contributes 0 but
is still printed, with its formula cell showing the credit that moved.

Observed live on CGP-01274, fold "Collected at Stripe $2,391.33":

```
refund_completed, effective 2026-09-08 ; Cr Cash held at Stripe (gross of Stripe fees) 208109 ; $0.00
```

and symmetrically in "Refunded from Stripe $2,081.09":

```
premium_collected, effective 2026-09-08 ; Dr Cash held at Stripe (gross of Stripe fees) 239133 ; $0.00
```

Consequence: inside a fold whose purpose is to be trusted, a reader sees a $2,081.09 refund
credited against a result of $0.00. Nothing is misstated (the total line reads `239133 + 0` and is
right, and the agreement check holds), but the row reads as a defect, and on a policy with no
refund at all the `"no line on this account yet"` empty state can never appear because the debit
lines fill the list. This is the fold a Corgi reviewer is most likely to open first.

Required correction: in `explainAccountSum`, skip a line whose contribution is zero under
`"debits"` or `"credits"` (keep every line under `"credits_minus_debits"`, where a zero can be
meaningful), and derive `side`/`movedCents` from the side the rule reads rather than from
`debitCents > 0`.

### F-B12-03 (MEDIUM): the cancellation "earned" line prints one concrete ratio for a figure that is a sum over several segments

`cancellationFormulaLines` prints, for `earned_premium`:

```
formula: `floor(written x ${cancellation.earnedDays} / ${cancellation.termDays}) per segment`
```

The figure it stands beside is `earnedPremiumAcrossSegments`, and `earnedPremiumOfSegment`
(`lib/money/premium.ts`) divides each segment's **own** elapsed days by that segment's **own**
window. On a policy endorsed mid-term, the second segment does not run `earnedDays / termDays`.
Worked case on CGP-01707's shape (term 2026-09-08 to 2027-09-08, endorsement 2026-10-08 writing
110136, hypothetical cancellation 2026-12-08, 91 earned days):

- segment 1: `floor(120000 x 91 / 365) = 29917`
- segment 2: `floor(110136 x 61 / 335) = 20053`
- earned = 49970, whereas the printed ratio applied to the written premium gives
  `floor(230136 x 91 / 365) = 57371`.

`CancellationBreakdown` does not carry the segment list, so the fold cannot print the real windows.
The agreement check cannot catch this: it compares the result line's **cents**, not the printed
formula, and both come from the same stored figure. This is the general limit of mechanism 3 and
worth stating at the debrief.

Not reachable on today's trial data (no policy is both endorsed and cancelled), no money effect,
no figure wrong. Required correction: carry the written-premium segments into
`CancellationFigures` and print one line per segment with its own days, as the endorsement fold
already does; or stop printing a concrete ratio and say `sum over each written segment of
floor(written x its own elapsed days / its own window)`.

### F-B12-04 (LOW): on a policy whose term starts after today, the steps offer a "today" step the panel then refuses

`policyAsOfSteps` always appends `today`. On CGP-01274 (term start 2026-09-17) and CGP-01061 (term
start 2028-03-01) the first step is `2026-09-09 today`, which is before the term start and outside
the `min={termStart}` of the date field in the very same panel. Following it renders:

> Nothing to show on 2026-09-09: no issued policy event effective on or before 2026-09-09

Verified live on CGP-01274 (`?asOf=2026-09-09`, HTTP 200, the step marked `aria-current="date"`,
the refusal printed). Same class as F-B8-07 and F-B8-09: a date control offering a value its own
constraint rejects.

Required correction: omit the "today" step when today is before the term start (the term-start
step already answers "the earliest date there is anything to show"), or keep it and say in the
label why it is empty.

### F-B12-05 (LOW): signed cents joined with " + " print a double sign

`explainAccountSum` and the net-due branch build the total formula by joining the line amounts, so
a negative contribution prints as `34680 + -30499` (CGP-01274 commission payable),
`231200 + -203330 + -27870` (unearned), and an empty month prints `-0` in the net-due clawback
line. Cosmetic. Correction: join with an explicit sign, and format `-0` as `0`.

### F-B12-06 (LOW): the statement fold is opened to any future format version

`explainable = run.canonicalVersion >= CANONICAL_STATEMENT_VERSION`. A future v3 that redefined a
stored column would be explained with v2 semantics, which is precisely the mistake the v1 refusal
exists to prevent (and the rule behind F-B9-09: a column never changes meaning). The `>=` shape
mirrors the pre-existing `collectedFigures`, so this slice did not introduce it. Correction when
a v3 is contemplated: `===`, or one explainer per stored version.

### F-B12-07 (LOW): the "Paid on this claim" evidence table nets to zero under a non-zero figure

The paid fold's evidence lists `claims_payable`: `Cr 120000` then `Dr 120000`, a net of zero,
under a figure of $1,200.00. The `evidenceLabel` is honest ("Every entry that moved claims
payable: a payment sent, its settlement on the rail, and any return") and deliberately does not
claim to prove the figure, but the reader is left to work out why the two numbers cancel.
Correction: one sentence saying the settlement moves the payable out again, so the balance is
zero while the paid figure stands.

### F-B12-08 (LOW, informational, not caused by this slice): the tax fold now sits on top of the open F-YA-07

On CGP-01707 the panel titled "Terms in force" prints, on 2026-09-09, the annual premium $2,400.00
and tax $56.40 that only take effect on 2026-10-08, while the fold's own evidence table lists the
tax entries actually booked, $28.20 plus $25.88 = $54.08. The fold is honest (its `evidenceLabel`
says "booked on this policy so far") but it now displays the contradiction F-YA-07 already
records as OPEN against this exact file. Worth closing in the same pass, since a Corgi reviewer
opening the tax fold is where the discrepancy becomes visible.

### F-B12-09 (LOW): the handoff note overstates where the endorsement lines come from

`docs/handoffs/b12-2-3-notes.md` says the endorsement fold reuses the lines "stored on the event".
The lines are rebuilt at read time by `endorsementFormulaLines(figures)` from the figures stored
on the event (`lib/policy/endorsement-read.ts`); the value is identical because the `delta_total`
line is `figures.deltaTotalCents`, but the sentence is not what the code does. AF-06 asks for
descriptions Yoann can defend literally. Correction: "rebuilt from the figures stored on the
event, by the same function that priced it".

## AF-06 readability assessment

`lib/money/explain.ts` is 580 lines, pure, with no database, no clock and no provider, one
exported builder per family of figure, and the rounding rules named once as constants rather than
repeated as prose. The reading path the handoff gives (explain.ts, its tests, the component,
formula-lines, `policyAsOfSteps`, the six sites) is the right one and is short. `explainedCents`
throwing while `explanationResultLine` returns null is a good distinction and is explained in
place. `accountSumCents` being the single implementation behind both the figure and its fold is
the strongest readability decision in the slice, and replacing the old inline loop in `ledgerSoFar`
with it is an exact-equivalent refactor I checked line by line.

The gaps are F-B12-02 (a fold row a reader will have to be talked out of) and F-B12-03 (a printed
ratio Yoann would have to defend on an endorsed-then-cancelled policy). Both are explanations
Yoann should rehearse rather than discover at the debrief.

`components/amount-explained.tsx` is 99 lines and does one thing. The agreement check is three
lines and is commented with why it exists. No hidden side effect, no client state.

## Verdict

**PASS** for the scope declared above, at `b40e803`, deployed and measured.

The property the slice rests on holds: all 23 fold sites are covered by one of the three
mechanisms, 47 folds rendered on the deployed revision produced zero disagreement alerts, nothing
is computed in the browser, and no form, field name, role check or uuid guard moved. F-B12-02 and
F-B12-03 are presentation defects inside explanations that are arithmetically correct; neither
misstates a figure, creates a bypass or touches a money row, so neither is material in the
compliance sense, but both should be corrected before the debrief because this feature's whole
value is that a reviewer can trust what the fold says.

Residual limitations: no visual check in a browser, the `correction_rebook` step and the
same-day merge unverified live for want of such a policy in the trial data, and F-B12-03 reasoned
from the code rather than observed.

**Candidate walkthrough status: NOT REVIEWED WITH YOANN.** No walkthrough took place. A reviewer
cannot certify understanding on his behalf.

## Register lines for the coordinator

| ID | Severity | Finding | Required correction | Status |
|---|---|---|---|---|
| F-B12-02 | MEDIUM | `explainAccountSum` prints every line on the account whatever the rule, so a journal-sum fold shows `Cr Cash 208109` against a result of `$0.00` (live on CGP-01274, both cash folds); the empty state can never appear | Skip zero-contribution lines under `debits`/`credits`, take the side from the rule | OPEN |
| F-B12-03 | MEDIUM | The cancellation `earned_premium` line prints `floor(written x earnedDays / termDays) per segment`, a ratio that is right only for the segment starting at the term start; on an endorsed-then-cancelled policy the printed ratio is not the arithmetic that produced the figure, and the agreement check compares cents, not formulas | Carry the written-premium segments into `CancellationFigures` and print one line per segment, or drop the concrete ratio | OPEN, not reachable on today's data |
| F-B12-04 | LOW | On a policy whose term starts after today (CGP-01274, CGP-01061) the "today" step offers a date before the term start, outside the panel's own `min`, and answers "Nothing to show on 2026-09-09" | Omit the today step when today is before the term start | OPEN |
| F-B12-05 | LOW | Signed cents joined with " + " print `34680 + -30499` and `-0` | Explicit sign in the joined formula | OPEN |
| F-B12-06 | LOW | `canonicalVersion >= CANONICAL_STATEMENT_VERSION` would explain a future v3 with v2 semantics (pre-existing shape, mirrors `collectedFigures`) | `===`, or one explainer per version, when a v3 is contemplated | OPEN |
| F-B12-07 | LOW | The claim "Paid" evidence table nets to zero (Cr 120000, Dr 120000) under a $1,200.00 figure | One sentence saying the settlement moves the payable out again | OPEN |
| F-B12-08 | LOW | The new tax fold displays the open F-YA-07: "Terms in force" prints the post-endorsement $2,400.00 and $56.40 on 2026-09-09 while its own evidence lists $54.08 booked | Close F-YA-07 in the same file | OPEN, duplicate of F-YA-07 |
| F-B12-09 | LOW | `docs/handoffs/b12-2-3-notes.md` says the endorsement lines are "stored on the event"; they are rebuilt from the stored figures by `endorsementFormulaLines` | Reword to what the code does | OPEN |

---

# Re-review after the fixes, 2026-09-09T09:20Z

New revision reviewed: **`19baf15`** (merge of `worktree-agent-acc7e1cd088537310` into main,
"B12 explanation fixes (F-B12-02 to 07, 09) and terms in force on today (F-YA-07)"). The eight fix
commits are `986e1eb`, `5b31899`, `94debbc`, `41807f0`, `612ece6`, `339b5c4`, `bdb9c22`, `3b11db4`.
The isolated fix diff is `19baf15^1..19baf15`: 9 files, +482/-101.

My worktree branch `worktree-agent-ae1296a4ce5b46bb2` merged `origin/main` and fast-forwarded to
`bb54cce` (the coordinator had already carried the first review record, `ad242c8`, onto main;
`bb54cce` is a docs-only commit on top of `19baf15`, which is why production reports `19baf15`).

Deployed revision measured: `/api/health` returning
`{"ok":true,"database":"ok","revision":"19baf1599e7829ec2f780e4971dfcd477588bb09"}`.

Prior findings and the prior verdict above are preserved unchanged. This section only records what
changed.

## Checks executed in the re-review

| Check | Command | Result |
|---|---|---|
| Unit tests | `npm test` | 434 tests, 433 pass, 1 skipped, 0 fail (8 added since the first review) |
| Types | `npx tsc --noEmit` | clean, no output |
| Secrets | `gitleaks detect --log-opts="19baf15^1..19baf15"` | 8 commits scanned, no leaks found |
| Guards and forms unchanged by the fixes | `19baf15^1` against `19baf15`: guard lines of the three changed pages, `name="…"` multiset, `<form action=…>` targets, `"use client"` file list | all four IDENTICAL |
| Deployed screens | 7 authenticated fetches as ops and broker | all 200 |

Note on the guard comparison: measured against `369671d` (the parent of the slice's original merge)
the `name="…"` multiset now differs by `comment`, `lines`, `outcome`, `text` and two extra `asOf`
fields. Those come from the customer change-requests slice (`a6aca56..b40e803`, YOA-634), not from
this scope: the B12 comparison in isolation, `19baf15^1` against `19baf15`, is identical.

## Measurements on the deployed application, revision 19baf15

| Screen | Folds | Alerts | As-of steps (was) |
|---|---|---|---|
| CGP-01274 (cancelled, term start 2026-09-17) | 14 | 0 | **2** (was 3): 2026-09-17 term start, 2026-10-31 cancellation |
| CGP-01707 (endorsed 2026-10-08, term start 2026-09-08) | 8 | 0 | **3** (unchanged): term start, today, endorsement |
| CGP-01062 (cancelled, term start 2026-10-01) | 14 | 0 | **2** (was 3): term start, cancellation |
| CGP-01061 (voided, term start 2028-03-01) | 7 | 0 | **1** (was 2): term start |
| CGP-01707 as broker | 8 | 0 | 3 |
| Claim `2f78c23c` | 3 | 0 | n/a |
| Statement `c775c8ce` (v2) | 5 | 0 | n/a |
| Statement `c2a6aa84` (v1) | 0 | n/a | n/a, still "not stored on this revision" |

**Fold counts unchanged, alerts still zero on every screen.** No figure moved: CGP-01274 still
$2,391.33 collected, $2,081.09 refunded, $41.81 commission payable, $0.00 unearned, and the seven
cancellation figures are the same cents as before.

## Per-finding verdict

### F-B12-02 (MEDIUM) RESOLVED

`explainAccountSum` now skips a line whose contribution is zero under `"debits"` or `"credits"`
(every line is kept under `"credits_minus_debits"`, where a zero is meaningful), takes the side
from the rule rather than from whichever column is filled, and names the side in the empty state.
The total still comes from `accountSumCents`, so no figure could move. Live on CGP-01274:

```
Collected at Stripe $2,391.33
  premium_collected, effective 2026-09-08 ; Dr Cash held at Stripe 239133 ; $2,391.33
  Collected at Stripe, all debits added   ; 239133                        ; $2,391.33

Refunded from Stripe $2,081.09
  refund_completed, effective 2026-09-08  ; Cr Cash held at Stripe 208109 ; $2,081.09
  Refunded from Stripe, all credits added ; 208109                        ; $2,081.09
```

The refund credit is gone from the collection fold and the collection debit is gone from the refund
fold, in the formula table and in the evidence table. Two tests added.

### F-B12-03 (MEDIUM) RESOLVED

The earned line no longer prints a concrete ratio. Live on CGP-01274:

> Earned premium kept by the insurer, rounded down on each segment (the term had run 44 of its 365
> days) | `sum over each written segment of floor(its written premium x its own elapsed days / its
> own window)` | $278.70

and the earned and unearned folds carry a sentence saying the cancellation event stores the totals
and not the segment list, pointing the reader at the endorsement schedule and the `premium_written`
journal entries for the windows themselves. That is the honest fix: it stops printing arithmetic
the ledger never ran instead of inventing segments that are not stored. A test asserts the exact
formula string and that no `100 / 365`-shaped ratio survives.

### F-B12-04 (LOW) RESOLVED

`policyAsOfStepsFrom` (moved to the new pure `lib/policy/as-of-steps.ts`, with its own test file)
adds the today step only when `today >= termStart`. Live: the today step is gone from CGP-01274
(2 steps), CGP-01062 (2) and CGP-01061 (1), and is still there on CGP-01707 (3), whose term began
2026-09-08. No step now leads to a refusal, and none sits outside the date field's own `min`.
Moving the function to a pure module and testing it without a database is a readability gain
beyond the finding.

### F-B12-05 (LOW) RESOLVED

`joinSignedCents` writes a negative contribution as a subtraction. Live on CGP-01274:
`34680 - 30499` for commission payable and `231200 - 203330 - 27870` for unearned premium, against
`34680 + -30499` and `231200 + -203330 + -27870` before. The net-due clawback line is
`String(-clawbackCents)`, so an empty month prints `0` and no longer `-0`.

### F-B12-06 (LOW) RESOLVED

`explainable` is now `run.canonicalVersion === CANONICAL_STATEMENT_VERSION`. Live: the v2 run
`c775c8ce` still renders its 5 folds and the v1 run `c2a6aa84` still renders none with "not stored
on this revision", so the tightening did not cost anything on today's data while closing the
future-v3 hole.

### F-B12-07 (LOW) RESOLVED

`evidenceFromJournal` takes an optional entry-type filter and the paid fold passes
`["claim_payment_sent", "claim_reserve_restored"]`, the two entry types that actually move the paid
figure. Live on claim `2f78c23c` the evidence is now the single line
`claim_payment_sent … Cr Claim payments sent and not yet settled on the rail 120000`, equal to the
$1,200.00 figure above it; the offsetting `claim_payment_settled` debit that made the table net to
zero is gone, and the label explains that a settlement is the rail confirming a payment already
counted as paid. A test asserts the kept entries add up to the paid figure.

### F-B12-08 (LOW) RESOLVED, with a residual raised as F-B12-10

F-YA-07 is fixed at its root: the panel now asks `policyAsItStoodOn` for today, the same fold the
"as it stood on" panel below uses, instead of reading `policy_current`. Live on CGP-01707 on
2026-09-09:

- panel heading **"Terms in force on 2026-09-09"**;
- **annual premium $1,200.00**, **CA premium tax (2.35%) $28.20** with the fold reading
  `floor(120000 x 235 / 10000)` and the label "on the annual premium in force on 2026-09-09";
- full annual term `120000 + 2820 + 2500 = $1,253.20`;
- limits $1,000,000 / $2,000,000, the ones in force today;
- and under the facts: "An endorsement effective **2026-10-08** brings the annual premium to
  **$2,400.00** ($2,000,000.00 per occurrence / $4,000,000.00 aggregate). It is in the schedule
  below with the delta it collected; the figures above are the ones in force on 2026-09-09."

The fallback when the fold has no answer (policy not issued on that date, or its issuance
reversed) drops back to the policy record and drops the date from the heading rather than claiming
one, which is the right failure path. `policy_current` still drives the rest of the page,
correctly: a future-dated endorsement IS on the policy.

### F-B12-09 (LOW) RESOLVED

`docs/handoffs/b12-2-3-notes.md` now reads "rebuilt from the figures stored on the event by the
function that priced it" and records the correction of its own earlier wording.

## New finding

### F-B12-10 (LOW): the tax fold's evidence still lists a future-dated entry that is not part of the figure

`evidenceFromJournal(entries, "premium_tax_payable")` on the terms panel is not filtered by date,
so on CGP-01707 the fold under **$28.20** still lists both:

```
tax_and_fee_billed      ; 2026-09-08 ; Cr State premium tax collected 2820
endorsement_tax_billed  ; 2026-10-08 ; Cr State premium tax collected 2588
```

The figure now equals the first row, and the second is visibly dated a month ahead and matches the
endorsement the panel names, so this is a large improvement on the reviewed state (figure $56.40
against entries totalling $54.08 with no relation between them). It is not fully closed: a reader
who adds the evidence gets 5408 against a figure of 2820. The `evidenceLabel` denies the sum in
words ("They are what was charged over time; the figure above is the tax on the annual premium in
force on this date"), which is why this is LOW and not a reopening of F-B12-08.

Required correction: pass the panel's date into the evidence and keep the entries effective on or
before it, so the fold under a dated figure shows dated evidence.

Not a regression: the same unfiltered evidence was there before the fix.

## Re-review verdict

**PASS** at `19baf15`, deployed and measured.

Resolved: F-B12-02, F-B12-03, F-B12-04, F-B12-05, F-B12-06, F-B12-07, F-B12-08 (with F-YA-07 at
its root), F-B12-09. Open: F-B12-10 (LOW, new).

The property the slice rests on still holds and is now better served: 49 folds rendered across the
same screens plus the broker view, zero disagreement alerts, no figure changed by any fix, and the
two MEDIUM findings are closed by making the explanation say less rather than by making it say
something new, which is the right direction for this feature. Guards, form field names, form
actions and the client-file list are untouched by the fixes.

Residual limitations, unchanged from the first review: no visual check in a browser, and the
`correction_rebook` step and the two-events-on-one-day merge remain unverified live because the
trial database still holds no corrected endorsement. `lib/policy/as-of-steps.test.ts` now covers
both cases as unit tests, which is a real improvement on that gap without closing the live one.

**Candidate walkthrough status: NOT REVIEWED WITH YOANN.** Unchanged; no walkthrough took place.

## Register lines for the coordinator, re-review

| ID | Severity | Status after 19baf15 |
|---|---|---|
| F-B12-02 | MEDIUM | RESOLVED 986e1eb, verified live on CGP-01274 (both cash folds list only their own side) |
| F-B12-03 | MEDIUM | RESOLVED 5b31899, verified live (the earned line prints the rule, not a ratio) |
| F-B12-04 | LOW | RESOLVED 94debbc, verified live (no today step on CGP-01274, CGP-01062, CGP-01061; kept on CGP-01707) |
| F-B12-05 | LOW | RESOLVED 41807f0, verified live (`34680 - 30499`, `231200 - 203330 - 27870`) |
| F-B12-06 | LOW | RESOLVED 612ece6, verified live (v1 still no fold, v2 still 5) |
| F-B12-07 | LOW | RESOLVED 339b5c4, verified live (paid evidence is the single `claim_payment_sent` line, equal to the figure) |
| F-B12-08 | LOW | RESOLVED 3b11db4 with F-YA-07 at its root, verified live on CGP-01707 ("Terms in force on 2026-09-09", $1,200.00, $28.20, endorsement 2026-10-08 named) |
| F-B12-09 | LOW | RESOLVED bdb9c22 |
| F-B12-10 | LOW | NEW, OPEN: the tax fold's evidence is not filtered by the panel's date, so a future-dated `endorsement_tax_billed` row sits under a figure it is not part of; the label denies the sum in words. Filter the evidence by effective date |
