# B12-2 "explain this amount" and B12-3 "as it stood on" steps

Slice B12, items 2 and 3 of the three Yoann decided on 2026-09-08 (DECISIONS.md 18:52Z, Linear
YOA-625 and YOA-626). Display shape confirmed by Yoann on 2026-09-09 at 08:20 local: a fold under
each figure **on the screens** (the PDFs keep their own printed schedules), and **server-rendered
steps** for the as-of control.

Written by the B12-2/3 builder on a delegate worktree. Presentation and one new read function
only: no migration, no change to any form, field name, endpoint or role check, no money computed
in the browser, no row updated or deleted.

## What B12-2 adds

A figure on a screen now carries a native `<details>` fold saying how it was produced: the formula
in **integer cents**, the **days and the rate** where they apply, the **rounding rule by name**,
and the **journal entries** (type, effective date, recorded time, the line that moved the account)
that prove it when there are any.

**The rule the slice rests on: an explanation is never a second calculation.** It is built from the
same pure functions and the same stored figures the page already shows. Three mechanisms enforce
it, in increasing strength:

1. Where formula lines already existed (endorsement, correction), the fold **reuses those lines**
   as they are and points at one of them.
2. Where a figure is a sum of journal lines, the figure and its fold call the **same function**
   (`accountSumCents`), so there is one implementation and they cannot differ.
3. `AmountExplained` compares the explanation's result line with the figure it sits under **on
   every render** and prints a visible alert if they disagree, instead of hiding it.

## What B12-3 adds

On the policy page, panel "As it stood on a date": a row of steps above the date field. One step
per date worth asking about, each a plain link carrying `?asOf=YYYY-MM-DD#as-of`:

- the **term start**;
- every **effective date of an event still in force**: endorsements, the corrected date of a
  correction (`correction_rebook`), a cancellation;
- **today**.

The current step is highlighted (`aria-current="date"`). A superseded event is **not** a step: the
timeline already strikes it through, and rebuilding the policy on the date a correction exists to
put right would answer a question nobody asked. A `correction_reversal` carries the wrong date and
is skipped for the same reason. Two events on the same day become one step wearing both words.

No slider, no client state, no JavaScript of ours: every click is a fresh server render, and the
address can be bookmarked or sent to somebody else. The PDF links under the result already follow
the chosen date (unchanged, `PolicyAsOf`).

## Where to read it, in order

1. `lib/money/explain.ts` (new, pure, no database and no clock): the `AmountExplanation` type, the
   named rounding rules, and one builder per family of figure. `explainedCents` and
   `explanationResultLine` are the two ways of asking what an explanation comes to.
2. `lib/money/explain.test.ts` (new): the property every case asserts is that an explanation ends
   on the figure it sits under.
3. `components/amount-explained.tsx` (new): the server component. Figure, fold, the agreement
   check, the rounding sentence, the evidence table.
4. `components/formula-lines.tsx` (moved from `app/policies/[policyId]/formula-lines.tsx`, which is
   now a one-line re-export so the five preview and approval pages keep their relative import).
   New optional `highlightKey` prop: the line that IS the figure, in bold. It defaults to
   `delta_total`, which is what every screen written before this slice expects.
5. `lib/policy/correction-read.ts`: `policyAsOfSteps` (new, B12-3), built on the existing
   `policyTimeline` query.
6. The six application sites listed below.

## The six places a figure is now explained

| Screen | Figures | Where the explanation comes from |
|---|---|---|
| Policy, "Terms in force" | tax, fee, full annual term | `explainStateTax` recomputes `floor(premium x rateBps / 10000)` with the same `stateTaxCents` the issuance used; `explainPolicyFee`; `explainTotalCharge` |
| Policy, "Endorsement schedule" | prorated delta per row | the endorsement's own `FormulaLine[]`, stored on the event, pointing at `delta_total` |
| Policy, "Cancellation" | all seven figures | one table of lines from the stored cancellation figures (`cancellationFormulaLines`), each fold pointing at a different line |
| Policy, "So far, from the journal" | collected, refunded, commission net, unearned | `explainAccountSum`, which lists the journal lines and totals them with `accountSumCents`, the same call that produced the figure |
| Claim, "What this claim has cost" | paid, reserve, incurred | `explainClaimIncurred` on the position folded from the claim's events, with the entries of `claims_payable`, `claim_reserve` and `incurred_loss_expense` as evidence |
| Broker statement, "Totals" | cash collected, premium collected, commission earned, clawback, net due | `explainStatementTotal` over the **stored statement lines**; commission rounding named as `floor(premium x rate / 10000)`, posted by the ledger and never recomputed here |

23 folds in all: 15 on the policy page, 3 on the claim page, 5 on the statement page.

## Two deliberate refusals

- **A statement run in the older format (v1) gets no fold.** Its premium column held the cash and
  its commission base was never stored (`collectedFigures`, `CANONICAL_STATEMENT_VERSION`).
  Explaining a figure whose meaning has changed would be exactly the mistake that function exists
  to prevent, so the page prints the amount alone on those runs.
- **`evidenceLabel`.** A figure that IS a sum of journal lines is *proved* by them. A figure read
  from the terms in force is only *accompanied* by the entries booked so far: after an endorsement,
  today's tax on today's annual premium is not the sum of the tax entries. The label says which of
  the two the reader is looking at, rather than letting "proved by these journal entries" stand
  over something it does not prove.

## Checks actually run

| Check | Command | Result |
|---|---|---|
| Types | `npx tsc --noEmit` | PASS, no output |
| Unit tests | `npm test` | 426 tests, 425 pass, 1 skipped, 0 fail (12 of them new, in `lib/money/explain.test.ts`) |
| Production build | `npm run build` | PASS, 35 routes compiled |
| Merge | `git merge origin/main` | fast-forward to 1526ef7, documentation only, no conflict |

`lib/money/explain.test.ts`, 12 tests: the tax explanation on the recited example
(`floor(120000 x 235 / 10000) = 2820`) and on a second rate and premium that rounds
(`floor(99999 x 175 / 10000) = 1749`); the fee; the total `120000 + 2820 + 2500 = 125320`; the
endorsement delta on a charge (`44584`) and on a refund (`-44586`), lines and label included; the
seven cancellation folds against the recited breakdown (32876 earned, 87124 unearned, 2048 tax
back, 89172 refunded, 13068 clawed back); incurred = paid + reserve; the journal sums against
`accountSumCents`, including an account with no line yet; the five statement totals against a
stored run, and the commission rounding sentence.

## Not done, and why

- **No check script was run on `corgi_test`.** The delegate worktree carries no `.env.local` and
  copying one into it would put a credential where the trial says none may go (AF-05, and the
  worktree cleanup recorded in STATUS on 2026-09-08 at 20:43Z). `check-money-guards` was out of
  scope by instruction. Nothing in this slice writes to a database, and the one new query
  (`policyAsOfSteps`) reuses `policyTimeline`, but **the two screens have not been rendered against
  real data by this builder**. That is the gap to close first in review: open a policy with an
  endorsement, a correction and a cancellation, and check that each fold's result line equals the
  figure above it and that no fold shows the disagreement alert.
- **No visual check in a browser.** The CSS is written and the build passes; nobody has looked at
  the folds inside the narrow side column or on a phone.
- **No independent review yet** (REVIEWER.md). The slice is presentation, but the statement folds
  read stored money and the claim folds read a folded position, so the review should check the
  agreement property on real rows rather than on the fixtures above.
- **Not applied** to the reconciliation screen, the approvals queue or the broker and staff lists:
  the six places above are the ones Yoann's decision named.
