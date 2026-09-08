# Implementation review: slice B8 (backdated correction of an endorsement's effective date)

- **Scope**: slice B8 as merged at `e7b5913` (`Merge branch 'worktree-agent-ad5f18bc6b3b9a884'`): correcting the effective date of an applied endorsement by reversal plus re-book in one transaction, settlement of the difference through the existing Stripe rails, the impact preview, the explanation, the timeline with both clocks, the policy as it stood on any business date, and the effect on the broker statement. Files read line by line: `db/migrations/0014_corrections.sql`, `lib/money/correction.ts` and `correction.test.ts`, `lib/ledger/correction-entries.ts` and its test, `lib/ledger/reverse.ts`, `lib/policy/correct-endorsement-date.ts` (all 762 lines), `lib/policy/correction-read.ts`, `lib/payments/correction-collection.ts`, `lib/payments/refunds.ts` (`assertRefundMaySend`, `policyRefundTotals`, `issueOneRefundAtStripe`, the re-issue path), `lib/approvals/threshold.ts`, `lib/policy/current.ts` (the fold, `appliesAsEndorsement`, `firstAppliedTerms`), `lib/policy/status.ts`, `lib/documents/policy-as-of.ts` and the `correction_rebook` branch of `lib/documents/from-database.ts`, `lib/statements/journal.ts` and the `classify` function of `lib/statements/compute.ts`, the diffs of `lib/payments/collection.ts`, `lib/policy/read.ts`, `lib/policy/endorsement-read.ts`, `lib/money/idempotency.ts` and `app/api/webhooks/stripe/route.ts`, the three route handlers under `app/api/policies/[policyId]/corrections`, `app/policies/[policyId]/corrections/new/page.tsx`, `app/policies/[policyId]/corrections/[rebookEventId]/approve/page.tsx`, `app/policies/[policyId]/correction-sections.tsx`, the refund block of `app/policies/[policyId]/page.tsx`, `scripts/check-correction-replay.ts` and the B8 additions to `scripts/check-money-guards.ts`.
- **Reviewer**: independent reviewer sub-agent. Wrote no code, delegated to nobody, and wrote no file in the repository except this one. Created nothing on the trial database.
- **Timestamp**: 2026-09-08T18:25:00Z (review started 17:52Z).
- **Revision reviewed**: `e7b5913`. Production reported `e7b5913` at `/api/health` at 17:54Z, before any HTTP work, so the deployed screens below are this revision. The repository has since moved to `3c74266` (an interface branch plus B4 and B10 re-reviews); `git diff e7b5913 3c74266` over the B8 scope touches only page presentation (`PortalShell`, table wrappers) and no file under `lib/`, `db/`, `scripts/` or `app/api/`, so the money reading below is still current.
- **Walkthrough status**: `NOT REVIEWED WITH YOANN`.
- **Verdict**: **FAIL**, on one HIGH and two MEDIUM findings. The correction transaction itself is sound; the failures are downstream of it.

## 1. Startup receipt

Read in full, in this order, before any check: `CLAUDE.md`, `AUTOMATIC-FAILS.md`, `READABLE-CODE.md`, `AGENTS.md`, `WORKFLOW-48H.md`, `REVIEWER.md`, `docs/ARCHITECTURE.md` (all nine sections including 3.x), `docs/DECISIONS.md` (every entry, including the CGP-01061 reversal, the closed-month revisions, and decisions 17, 18 and 19), `docs/reviews/FINDINGS.md`, `docs/handoffs/b8-implementation-notes.md` (all ten sections). Read by targeted section rather than end to end: `docs/STATUS.md` (the tail and the B8, B9 and B10 sections), `docs/reviews/b4-endorsements.md` (scope, money table, requirement matrix, findings F-B4-04 to F-B4-12), `docs/reviews/b9-statements.md` (findings and the statement selection rules), `README.md` (deployment, demo roles, integration inventory). Not read: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`, `GAP-REVIEW.md`, `docs/COMPLIANCE-MATRIX.md`, `docs/PLAN.md`. Absent files: none of the mandatory files were missing.

Acceptance criterion under review: `docs/PLAN.md` row B8, plus the part of row B12 (impact preview and explanation) that this slice delivers for corrections. Planned checks, all executed: read the migration and the money code line by line; reproduce the worked example with arithmetic written from scratch; run `npm run typecheck`, `npm test`, `npm run check:correction-replay` and `npm run check:money-guards -- --database=test`; probe the statement effect of a correction directly on the disposable database with hand written SQL; run `gitleaks` on the merged range; and exercise the screens and the refusals over HTTP on the deployed application.

## 2. Applicability

Confirmed facts: US commercial general liability, one modelled state (California, premium tax 2.35 percent), synthetic brokers, customers and policies, Stripe test mode, no real money and no real personal data. Requirements applied to this scope: the six automatic fails; from `AGENTS.md` the financial invariants (integer cents, append-only journal, correction by linked reversal plus re-book, effective and recorded time preserved, idempotency keys bound to the business intent, transactions and unique constraints), the webhook contract, and maker-checker on money out; from `DECISIONS.md` decision 18 (each written premium piece rounds on its own) and decision 19 (the broker statement shows the premium collected that is the commission base). The $500 customer threshold, the $1,000 money-out threshold and the $25 flat fee are assumptions of this build and are labelled as such in the code. No legal interpretation is asserted here.

## 3. The money, reproduced independently

I recomputed the delegate's worked example in Python, without importing any repository code, before comparing it with the tests and the check.

| Quantity | Formula | Cents |
|---|---|---|
| Term 2028-03-01 to 2029-03-01 | actual days | 365 |
| Wrong date 2028-07-09 | day 130 | 235 days remain |
| Corrected date 2028-06-09 | day 100 | 265 days remain |
| Premium as booked | `floor(60000 x 235 / 365)` | 38630 |
| Tax as booked | `floor(38630 x 235 / 10000)` | 907 |
| Collected at Stripe | 38630 + 907 | 39537 |
| Commission as booked | `floor(38630 x 1500 / 10000)` | 5794 |
| Premium corrected | `floor(60000 x 265 / 365)` | 43561 |
| Tax corrected | `floor(43561 x 235 / 10000)` | 1023 |
| Owed at the corrected date | 43561 + 1023 | 44584 |
| Difference premium, tax, total | 43561 - 38630, 1023 - 907 | 4931, 116, 5047 |
| Commission on the difference | `floor(4931 x 1500 / 10000)` | 739 |
| Commission per piece against one calculation | 5794 + 739 against `floor(43561 x 1500 / 10000)` | 6533 against 6534 |

Every figure matches `lib/money/correction.ts`, its test, the entries in `lib/ledger/correction-entries.ts` and the check script's output. The one cent gap on the commission is real, is the same per piece flooring decision 18 applies to the written premium segments, and is stated in the code and in a test rather than hidden. The direction of each rounding is right: the customer charge is floored, the commission is floored on the absolute amount in both directions, and the tax follows the premium and is rounded down on each figure separately rather than on the total.

Both threshold answers in the recited example are "no approval": 5047 cents is below the $500 customer threshold and below the $1,000 money-out threshold. That is why the two approval questions had to be checked against the cumulative rules rather than against this example, which is finding F-B8-02 and finding F-B8-04.

## 4. Requirement matrix

| Requirement | Control and code location | Evidence | Verdict |
|---|---|---|---|
| A correction is one transaction: correction event, reversal entries, re-book event, re-booked entries, settlement | `recordEndorsementDateCorrection`, one `database.begin` with an advisory lock per policy | code read; `check:correction-replay` 47 PASS, including "not one row that existed before the correction changed, byte for byte (36 rows compared)" and "the correction only added rows (36 before, 52 after)" | PASS |
| The `correction_reversal` supersedes the wrong endorsed event and the fold stops applying it | `supersedes_event_id` on the event, `applyPolicyEvents` skips superseded ids | replay: "the wrong endorsement is superseded, the policy stays bound, and the terms are the endorsed ones" | PASS |
| Reversal entries linked by `reverses_entry_id`, mirrored, at the originals' effective date | `reverseJournalEntry` in `lib/ledger/reverse.ts` | replay: "two reversal entries exist, mirroring the originals on the SAME effective date"; "every reversal line is the mirror image of the line it reverses" | PASS |
| Two clocks preserved: effective in the past, recorded now, database set | `BEFORE INSERT` trigger from migrations 0001 and 0003; no client value anywhere in B8 | replay: "the reversals were RECORDED after the originals, and effective before them"; timeline on production shows the two columns | PASS |
| Re-book with fresh premium and tax at the corrected date | `correctionRebookEntries`, filed under `source_kind = 'correction'` and the re-book event id | replay: "the re-book posts the corrected premium and tax on the corrected date" | PASS |
| Cash entries never touched, difference lands in `premium_receivable` | `BILLED_ENTRY_TYPES` is the two billed entries only | replay: "no cash entry was reversed and no cash entry was posted: Stripe still holds the money (cash_stripe net 164857)"; "the customer owes 5047, visible as an open receivable" | PASS |
| No UPDATE or DELETE on money rows (AF-03) | grep of every added line in the B8 diff: the only match is the guard trigger declaration in `0014`; the only mutation in the slice is the `policy_current` upsert, the declared cache | `check:money-guards` covers `correction_collections` as a protected table with its own fixture row (three triggers plus the `app_runtime` grant test) | PASS |
| The correction is refused twice on the same endorsement | code check plus `journal_entries.reverses_entry_id` unique, plus the partial unique index `policy_events_one_rebook_per_corrected_event` | replay: "the same endorsement cannot be corrected a second time"; "and the database refuses it too" | PASS |
| Refused on a cancelled policy, outside the term, by a broker, without a reason | guards at the top of `planEndorsementDateCorrection` | replay lines for all four; the broker refusal reproduced over HTTP on production | PASS |
| Refused on a voided policy | `policyWasVoided(fold.eventTypes)` | code read only: the check script has no voided probe | PASS by reading, F-B8-06 |
| Refused on an endorsement that refunded premium (disclosed limitation) | `money.before.direction !== "charge"` | code read only: the check script has no probe | PASS by reading, F-B8-06 |
| Refused while an earlier difference is unsettled | `premiumReceivableBalance` must be zero, plus `hasCorrectionRefundInFlight` | replay: "a third correction is refused while that refund is in flight" | PASS |
| Settlement of a difference to collect through the existing rails | `stripe_checkout` operation committed with the correction, `correction_collections` link row, key `correction-checkout:<re-book event>` | replay: "one collection operation was opened, keyed on the re-book, nothing sent"; "the difference paid, and the same payment delivered twice posts once"; "the receivable is back to zero" | PASS |
| Settlement of a difference to give back through the existing rails | `allocateRefundNewestCollectionFirst`, one operation per PaymentIntent, `correction_refund_requested` entry | replay: "it gives back the difference: 2524 to refund with a 369 clawback"; "the refund takes the money out of premium receivable, not out of unearned premium" | PASS |
| Money out above $1,000 waits for a distinct approver | request time uses the per correction rule; the send gate `assertRefundMaySend` uses the cumulative rule | no money can leave unapproved, but the two rules disagree and strand the refund | FAIL: F-B8-02 |
| The customer approves a difference above $500 | `startCorrectionCheckout` re-checks before opening the hosted page; `correction_approved` event with a partial unique index | code read; the delegate's screen pass exercised it | PASS for one correction, F-B8-04 across several collections |
| The fold applies the re-book like an endorsement, at the corrected date | `appliesAsEndorsement` in `lib/policy/current.ts` | replay: "the fold applies the re-book like an endorsement: 120000 from 2028-03-01, 43561 from 2028-06-09" | PASS |
| The policy as it stood before, between and after the two dates | `foldPolicyEvents` in `lib/documents/policy-as-of.ts`, reversal effective on the wrong date, re-book on the corrected one | replay: "$1,200 on 2028-06-20 before"; "$1,800 after"; "$1,200 the day before the corrected date"; as-of view exercised on production | PASS |
| A later cancellation gives back the corrected figure segment by segment | `writtenPremiumSegments` from the fold, read by `cancel.ts` | the segment list is proven by the replay; no cancellation after a correction is exercised end to end | PASS by reading, F-B8-06 |
| Timeline with both dates, superseded rows struck through and named | `policyTimeline`, `<s>` markup plus the "Superseded by" sentence | fetched from production on CGP-01061: `<s>issued</s>`, "Superseded by the correction_reversal recorded later (bb83bd6d)" | PASS with F-B8-05 |
| A correction recorded after a month's cutoff is invisible to that cutoff | `entry.recorded_at <= knowledge_cutoff` in `brokerJournalEntriesInMonth`, applied to the sibling premium subquery too | code read; every correction entry carries a database set `recorded_at` of now | PASS |
| The corrected figure reaches the statement | `CASH_ENTRY_TYPES` and `classify` | the difference cash is dropped and its commission becomes an adjustment | FAIL: F-B8-01 |
| AF-04 sandbox only | `assertStripeSandbox()` before the only Stripe call in the slice; `check:correction-replay` refuses any database whose name is not `corgi_test` | code read; the check refused nothing because it was pointed at the disposable database | PASS |
| AF-05 no secrets | `gitleaks git --log-opts="e7fe35e..e7b5913"` | 63 commits scanned, no leaks found | PASS |
| AF-01 deployed and exercised | screens and refusals over HTTP | preview, refusals, timeline and as-of view all work on `e7b5913`; no correction has ever run on the deployed application | BLOCKED for the live evidence, see section 7 |
| AF-06 explainable line by line | one pure function, one entries module, one transaction | see section 6 | PASS with reservations |

## 5. Findings

| ID | Sev | Finding (one line) |
|---|---|---|
| F-B8-01 | HIGH | The broker statement drops the cash of a collected correction difference and files its commission as an unexplained adjustment, because `correction_premium_collected` is in neither the statement's cash entry list nor its classifier. |
| F-B8-02 | MEDIUM | The correction decides maker-checker per correction rather than cumulatively per policy, so a refund it opens can be permanently unsendable: the send gate refuses it, the outcome is discarded, and no screen action can raise the approval it now needs. |
| F-B8-03 | MEDIUM | All five new correction entry points answer HTTP 500 on a malformed policy id, where the B4 and B7 equivalents answer 404 on a page and 400 on a route (regression of the F-B7-07 fix). |
| F-B8-04 | LOW | The $500 customer-approval threshold on a correction difference is read per correction, so an endorsement under $500 followed by a correction difference under $500 collects more than $500 from a customer who was never asked. |
| F-B8-05 | LOW | The timeline prints "effective date ? put right to ?" for a `correction_reversal` that is not an endorsement-date correction, which is what the deployed CGP-01061 shows today. |
| F-B8-06 | LOW | Three claims of the slice rest on code reading alone: the refusal on a voided policy, the refusal of an endorsement that refunded premium, and the cancellation of a corrected policy segment by segment. |
| F-B8-07 | LOW | On a future-dated policy the as-of date field defaults to today while its `min` is the term start, so the form ships with a value its own constraint rejects. |
| F-B4-13 | LOW as rated by the B4 re-reviewer | Referred to this review by the coordinator. Same fact as F-B8-02 and F-B8-04, plus two read paths in `lib/policy/correction-read.ts`. Accepted, kept at the severities of F-B8-02 and F-B8-04, with the reasoning and the required preview text in section 5. |

### F-B8-01 (HIGH): the correction difference never reaches the broker statement

**Trigger.** Any correction that moves an endorsement to an earlier date, so the customer owes a difference, and that difference is paid at Stripe. The webhook posts `correction_premium_collected` (Dr `cash_stripe`, Cr `premium_receivable`) and `correction_commission_earned` (Dr `commission_expense`, Cr `commission_payable`). `lib/statements/journal.ts` selects an entry only when it moves `commission_payable` or when its type is one of the six names in `CASH_ENTRY_TYPES`, and B8 added neither of its two new names there or in `classify` in `lib/statements/compute.ts`.

**Consequence, measured.** On the disposable database, on the policy `3f07c5fd-1eeb-40ff-9349-6a6aedec22dc` built by `check:correction-replay`:

```
ledger cash_stripe on that policy                167380 cents
cash the statement selection would report        162333 cents
difference                                         5047 cents (the correction difference, exactly)
premium the statement would report               158630 cents (the corrected 4931 missing)
commission_earned                                 24163 cents
adjustment                                          739 cents (the correction commission, unexplained)
```

The net due is unaffected, because the 739 is still counted, as an adjustment. What is wrong is the month's collected cash, the premium that is the commission base, and the reading of the statement: decision 19 exists so that a broker can multiply the premium line by the rate and see the commission line, and here 739 appears against no premium at all. This is the same defect that review finding F-B9-01 rated HIGH for an endorsement month, reintroduced on a new pair of entry types, and it sits directly on the brief's live fire 2, which asks for the corrected figure on the statement.

**Second half of the same fix.** Adding `correction_premium_collected` to `CASH_ENTRY_TYPES` and to `classify` is not enough on its own. The statement reads the premium part of a cash entry from the `unearned_premium` lines filed under the same `source_kind` and `source_id`. The difference payment is filed under its money operation, while the re-booked premium is filed under `source_kind = 'correction'` and the re-book event id, so the sibling sum is zero: the probe above reports `base = 0` for that entry. The premium base has to be taken from `correction_collections.premium_cents`, or the re-booked entries have to be reachable from the collecting operation.

**Required correction.** Extend the statement's entry selection and classifier to the two correction entry types, and give the difference line its real premium base. Add a line to `check:statements` that runs a correction and asserts the month's cash and premium.

### F-B8-02 (MEDIUM): a correction refund can be stranded between two different threshold rules

**Trigger.** `lib/money/correction.ts:103` computes `refundNeedsApproval: settlement === "refund" && moneyOutNeedsApproval(-differenceTotalCents)`, which looks at this correction alone. `lib/policy/correct-endorsement-date.ts:524` uses that boolean to decide whether to write an approval request. The send gate `assertRefundMaySend` in `lib/payments/refunds.ts:235` uses the cumulative rule `refundNeedsApproval({ amountCents, policyRefundedCents, policyPendingRefundCents })` that B4's fix at `26dede3` made the rule for every policy refund, and `policyRefundTotals` counts every `stripe_refund` operation on the policy whatever opened it. Demonstrated with the repository's own functions:

```
correction.ts asks   moneyOutNeedsApproval(60000)                                      false
send gate asks       refundNeedsApproval(60000, already refunded 60000 on the policy)  true
```

A reachable sequence with two ordinary endorsements: reduce the premium by $900 and let that refund complete; raise the premium and pay the delta; then correct the raise to a later date so that $200 goes back. The correction writes no approval request ($200 is under $1,000), `issueRefundsAtStripe` calls the gate, the gate sees $900 plus $200 and refuses.

**Consequence.** No money leaves unapproved, so this is not an AF-03 or maker-checker breach: the gate fails closed, which is the behaviour F-B7-01 was fixed to produce. The damage is that the refusal is invisible and terminal. `correctEndorsementDate` discards the return value of `issueRefundsAtStripe`, the route redirects with `correction=refund-requested`, and the operator is told the refund was requested. The operation then sits in `requested` with no approval request: the "Send to Stripe again" button calls the same gate and is refused again, and "Re-issue this refund" is only offered for a `failed` operation. The customer is owed money, `refund_payable` stays open, and nothing in the application can release it. The preview screen also states the opposite of what will happen, printing "At or below $1,000.00 no second approver is needed".

**Required correction.** Read the same cumulative rule at request time: pass the policy's refunded and pending totals into `refundNeedsApproval` inside `planEndorsementDateCorrection`, exactly as `lib/policy/endorse.ts:193` and `lib/policy/cancel.ts:278` already do. As a second line of defence, stop discarding the outcome of `issueRefundsAtStripe` in `correctEndorsementDate` and surface a refused outcome on the redirect.

### F-B8-03 (MEDIUM): every new entry point answers 500 on a malformed policy id

**Trigger.** `lib/http/path-ids.ts` exists precisely for this (review finding F-B7-07) and is used by seventeen routes and six pages. None of B8's five entry points calls it. Each validates its own event id with a locally copied regex and passes `policyId` straight through to a query that casts it to `uuid`. Measured on production at `e7b5913`:

| Request | Answer |
|---|---|
| `GET /policies/not-a-uuid` (B2) | 404 |
| `GET /policies/not-a-uuid/endorse` (B4) | 404 |
| `POST /api/policies/not-a-uuid/endorsements` (B4) | 400 |
| `GET /policies/not-a-uuid/corrections/new?...` | 500 |
| `GET /policies/not-a-uuid/corrections/<uuid>/approve` | 500 |
| `POST /api/policies/not-a-uuid/corrections` | 500 |
| `POST /api/policies/not-a-uuid/corrections/<uuid>/checkout` | 500 |
| `POST /api/policies/not-a-uuid/corrections/<uuid>/approve` | 500 |

The preview needs the staff role, a reason of ten characters, a valid date and a well formed event id before it reaches the query, so the page case takes a deliberate URL; the three API routes reach it immediately.

**Consequence.** An error page and a stack trace in the logs instead of a refusal, on five deployed entry points, and an inconsistency a reviewer will notice next to the routes that answer correctly.

**Required correction.** Call `badPathIdResponse` on the first line of the three routes and `isUuid` plus `notFound()` on the two pages, and delete the four copies of the UUID regex in favour of `isUuid`.

### F-B8-04 (LOW): the customer threshold on a correction is per correction

`lib/money/correction.ts:102` and `lib/payments/correction-collection.ts:157` and `:256` compare `amountCents` against `CUSTOMER_APPROVAL_THRESHOLD_CENTS` directly, while B4's fix for F-B4-09 made the rule cumulative through `customerApprovalNeeded`, counting what is still waiting for that customer. Demonstrated with the repository's own functions: `customerApprovalNeeded({ amountCents: 40000, unapprovedRequestedCents: 40000, thresholdCents: 50000 })` is true, while the correction's own comparison of 40000 against 50000 is false. The correction refuses to run while the policy's `premium_receivable` is not zero, so two correction differences cannot be open at once, but an endorsement request of $400 waiting for approval and a correction difference of $400 can, and neither counts the other. Rated LOW to match F-B4-09, and because a correction is a staff action on an error that was already made.

### F-B4-13, referred from the B4 re-review: the same fact, two more locations, and what the preview must say

The coordinator passed me F-B4-13, rated LOW by the B4 re-reviewer: `lib/money/correction.ts` asks both approval questions per operation instead of using the cumulative functions, and `lib/policy/correction-read.ts` repeats the customer one. I agree with the fact and with their reading that it is not a bypass, for the reason they give: a correction refund is an ordinary `stripe_refund` sent through `issueRefundsAtStripe`, which passes the cumulative send gate. It is the same defect I found independently, split across F-B8-02 (the refund side) and F-B8-04 (the collection side). The two read locations they name are `correction-read.ts:110` and `:220`, which I had read but not called out separately.

**On severity, I keep mine and disagree in one place.** The collection side stays LOW, matching both their rating and F-B4-09. The refund side stays MEDIUM in this record, not because anything overpays, but because of what happens after the gate refuses: the outcome of `issueRefundsAtStripe` is discarded, the operator is told the refund was requested, and no screen action can then release it. "Send to Stripe again" calls the same gate, and "Re-issue this refund" is only offered on a `failed` operation. A customer left owed money with no in-application way to pay them is more than a wrong sentence on a screen. If the coordinator prefers one row in the register, F-B4-13 and F-B8-02 are the same fix and can be closed together.

**Should the correction plan adopt the two cumulative functions? Yes, for the two gates, and no for the two read paths.**

The gates should adopt them, and the shape already exists twice: `lib/policy/endorse.ts:193` and `lib/policy/cancel.ts:278` both pass `policyRefundTotals` into `refundNeedsApproval`, and `lib/policy/endorsement-requests.ts:145` passes what is still waiting into `customerApprovalNeeded`. `planEndorsementDateCorrection` should do the same, which means `correctEndorsementDateMoney` takes the totals as arguments rather than reaching for the thresholds itself. That also removes the oddity of `lib/money/correction.ts` re-exporting two constants it does not own.

The two read paths should not. `correctionsOfPolicy` and `collectionOfCorrection` render a correction that already happened, and recomputing a threshold there answers the question with today's totals rather than the ones that applied on the day, which would restate history. Review finding F-B4-08 settled this for endorsements: derive the standing from the events. `collectionOfCorrection` already reads `customerApprovedAt` from the `correction_approved` event two lines below, so the recomputed `customerApprovalRequired` beside it can contradict it. Both should read "an approval was required if and only if the events say one was asked for", and `correctionsOfPolicy` should do the same instead of comparing `difference_total_cents` against the constant.

**What the preview must print.** Today the second branch of each sentence is the part that can be false. The correct minimum is that the boolean behind it be cumulative; what makes it defensible at the debrief is naming the basis, which B4's own customer branch already does and its refund branch does not. In `app/policies/[policyId]/corrections/new/page.tsx`, the four sentences should read in this shape:

- collect, approval needed: "The difference is above $500.00 counting anything else still waiting for this customer, so the customer has to approve it before it can be collected."
- collect, no approval: "At or below $500.00, counting anything else already waiting for this customer, no customer approval is needed."
- refund, approval needed: "This $200.00 takes what this policy has given back past $1,000.00, so a second person, never you, has to approve it before anything is sent."
- refund, no approval: "At or below $1,000.00, counting the $900.00 this policy has already refunded and anything still waiting, no second approver is needed."

The figures in the last two are the reachable sequence from F-B8-02 and are there to show the shape, not to be hard coded. The rule is that the screen never states a verdict without the total it was read against, because that total is the whole difference between the sentence being true and being false.

### F-B8-05 (LOW): the timeline prints two question marks on any other kind of correction

`summarise` in `lib/policy/correction-read.ts:315` reads `payload.wrong_effective_at` and `payload.corrected_effective_at`, which only an endorsement-date correction carries. The B8a void of CGP-01061 is a `correction_reversal` of an `issued` event and carries neither. Fetched from production today:

```
Correction: effective date ? put right to ? (Bound on 2026-09-08 through a locally signed webhook
during development (pi_local_...); Stripe never collected this payment. Reversed by the coordinator
per review finding F-B2-01 and Yoann's decision.)
```

The reason is shown in full and no figure is wrong, but this is on the deployed demo data and a panel reading the timeline will see it. Fall back to the effective date of the superseded event, or to the reason alone, when the two keys are absent.

### F-B8-06 (LOW): three claims are proven by reading only

`check:correction-replay` runs 47 assertions and 47 pass, but it contains no probe for a voided policy, none for an endorsement whose delta was refunded (deviation 2, the disclosed limitation), and none for a cancellation after a correction. The first two are single guards I read and believe; the third matters more, because "a later cancellation gives back the corrected figure segment by segment" is the decision 18 claim the slice makes, and what the check proves is the segment list the fold produces, not the refund `cancellationBreakdown` computes from it. Three more assertions would close all three.

### F-B8-07 (LOW): the as-of field ships with a value its own constraint rejects

`app/policies/[policyId]/correction-sections.tsx:272` sets `defaultValue={requested || today}` and `min={termStart}`. On CGP-01274, whose term starts 2026-09-17, production renders `min="2026-09-17" value="2026-09-08"`. The browser refuses to submit until the operator changes the date, on the one bound policy of the demo. Default to the term start, or to today clamped to the term.

## 6. Readability (AF-06)

The reading path is short and the code is explicit. `lib/money/correction.ts` is one pure function that re-prices the same endorsement with one input changed and returns the difference, its commission and the two approval questions, with the worked example in a comment above it. `lib/ledger/correction-entries.ts` builds the four entries and writes out, in full, why the cash is not touched. `lib/policy/correct-endorsement-date.ts` numbers the five steps of the transaction in comments that match the code below them. Names carry units and purpose throughout, money is integer cents everywhere, and no figure is computed in the browser.

**The three places the panel will point at.**

1. `lib/money/correction.ts`, lines 66 to 106: the whole money rule. One call to `computeEndorsement` with `effectiveAt` replaced and every other input read back from the immutable event, then four subtractions.
2. `lib/ledger/correction-entries.ts`, lines 10 to 60: the comment block and `correctionRebookEntries`. The four entries of the recited example are written there in full, and so is the reason the two cash entries are left alone.
3. `lib/policy/correct-endorsement-date.ts`, lines 302 to 390: the single transaction, in order, with the advisory lock at the top and `refreshPolicyCurrent` at the bottom.

**The one sentence he must say about the two clocks.** "Every row a correction writes carries the effective date the cover really changed on, which is in the past, and a recording time of now that the database sets and no client can touch, so the same closed month re-read with its old cutoff still shows what we believed then, while a fresh read shows the corrected figure."

Two reservations, both small. The four copies of the UUID regex (F-B8-03) are the kind of duplication he will be asked about, and `lib/money/correction.ts` re-exports two threshold constants it does not own, which makes it look like the place the thresholds live when it is not.

## 7. Deviations and decision points assessed

1. **Superseding the endorsed event only, not its request.** Sound. `supersedes_event_id` holds one id, the request carries no terms and no money, and the document fold raises on a reversal naming an event it does not carry. The link is kept in the payload. No figure changes.
2. **Only an endorsement that collected premium can be corrected.** Acceptable as a disclosed limitation, and the refusal sentence is clear. It should be named in README, which it is not yet. Correcting a reduction would have to reason about a refund that may already have left, which is genuinely a different piece of work.
3. **Only the most recent endorsement in force can be corrected.** Sound and consistent with B4's refusal to backdate before the endorsement in force. It is also what keeps deviation 2 airtight: an in-flight reduction refund always means the latest endorsement is a reduction, so the correction is refused before the refund can interfere.
4. **Refused while an earlier difference is unsettled, with two guards.** Sound, and the reasoning for needing both is correct: a difference given back leaves `premium_receivable` at zero the moment it is opened, so the balance alone cannot see it. `hasCorrectionRefundInFlight` looks only for `correction_refund_requested`, which is right given deviation 3.
5. **Re-booked entries reuse the endorsement entry types with `source_kind = 'correction'`.** Correct accounting and it keeps the schedule and the PDFs reading them with no special case. It is also the mechanism behind the second half of F-B8-01: the statement's premium base is keyed on source, so the re-booked premium is invisible from the collecting operation.
6. **No broker eligibility gate on collecting a difference.** Agreed. Rule 14 exists for money that arrives when a policy cannot be bound; this settles a receivable the ledger already carries and binds nothing.
7. **The preview route name.** A framework constraint, correctly worked around, no consequence.
8. **The stale sentence on the policy page corrected.** Fine.
9. **`correction_collections` added to the protected tables of `check:money-guards`.** Verified in the diff: the table is in `PROTECTED_TABLES` with its own fixture row, so it gets the three trigger probes and the `app_runtime` grant probe like every other protected table.

**Decision point A, the commission penny.** The per piece flooring is arithmetically consistent with decision 18 and the broker loses one cent against a single calculation on the corrected premium. It is stated in the code, in a test and in the notes. This is a decision for Yoann, not a defect; my only remark is that the alternative he would be choosing between is not "reverse and re-book the commission in full", which would also reverse a cash-dated entry, but "re-book the commission on the corrected premium and post the delta", which is a third rule. Worth naming precisely before he is asked.

**Decision point B, the scope limit.** Same judgement as deviation 2: a clean disclosed limitation, which needs one sentence in README to actually be disclosed.

## 8. Checks executed

| Check | Result |
|---|---|
| `curl /api/health` | `e7b5913` at 17:54Z, database ok, before any HTTP work |
| `npm run typecheck` | exit 0 |
| `npm test` | 370 tests, 369 pass, 0 fail, 1 skipped (B3's live KYB test) |
| `npm run check:correction-replay` | 47 PASS, 0 FAIL, exit 0, on the disposable database |
| `npm run check:money-guards -- --database=test` | see the disclosure below |
| `gitleaks git --log-opts="e7fe35e..e7b5913"` | 63 commits scanned, no leaks found |
| Independent arithmetic of the worked example (Python, no repository code) | every figure matches |
| Hand written SQL probe of the statement selection on the disposable database | F-B8-01, figures in section 5 |
| Threshold divergence demonstrated with the repository's own functions | F-B8-02 and F-B8-04 |
| Screens over HTTP on production: three policy pages, timeline, as-of view inside and before the term, correction preview with no endorsement, broker refusal, malformed event id, malformed policy id on five entry points | all as reported in section 5; the deployed application answers correctly except F-B8-03 |

**Disclosure on the guards.** The assignment allowed one run on the shared disposable database. I wrote the command as a compound that invoked `check:money-guards` twice, once piped to `tail -25` and once piped to a count. I stopped the second run partway (it had reported 24 PASS and no FAIL). The consequence is extra contention on `corgi_test` for the other builders, and that I do not have a complete count from my own run: the 25 lines I saw were all PASS with no FAIL, and my own `tail` cut off the summary. I therefore rely on the coordinator's 161 of 161 on an ephemeral database at 17:45Z after migration 0017 for the total, and on my reading of the diff for the fact that `correction_collections` is a protected table with a fixture row. Nothing touched the trial database.

## 9. Checks not executed, and why

- **No correction on the deployed application.** No endorsement exists on the trial database, so no correction can be previewed against a real event there; I verified the refusal path over HTTP instead. Creating an endorsement or a correction on the trial database was outside my mandate and is Yoann's rehearsal with the coordinator.
- **No difference paid at Stripe.** No `correction_premium_collected` has ever been posted from a real webhook. The delegate opened two test-mode hosted pages and left them unpaid.
- **No correction refund sent to Stripe.**
- **No approval clicked on a correction refund above $1,000.**
- **`check:money-guards` was not run against the trial database.**
- **`collectionsStillRefundable` was not audited for the case of a completed earlier refund followed by a raise and a correction**; the allocation is B5 code that the correction reuses unchanged, and the replay exercises the ordinary path.
- **No load or concurrency testing.** The advisory lock and the unique indexes were read, and the replay proves the double-correction refusal, but two simultaneous Confirm clicks were not fired at production.

## 10. Verdict and residual limitations

**FAIL** for slice B8 at `e7b5913`. The verdict is unchanged by the referred finding F-B4-13, which is the same fact as F-B8-02 and F-B8-04 and was already counted. F-B8-01 is an observed defect on the path the brief's live fire 2 names: after a correction, the broker statement for the month of the difference understates the cash and the premium collected and shows the commission as an adjustment with no base. F-B8-02 leaves a real refund permanently unsendable through the interface while telling the operator it was requested. F-B8-03 turns five deployed entry points into 500s on a malformed id that the rest of the application already handles. None of these is an AF-03 breach: the ledger is append only, the correction is one transaction, the original rows are provably untouched byte for byte, the cash is never reversed, and no money can leave without the approval the cumulative gate demands.

Residual limitations of this review: the correction has never run on the deployed application or against real Stripe money, so every money figure above is proven on the disposable database and by arithmetic rather than by a provider round trip. The verdict covers `e7b5913` only; the interface commits since then change the pages this slice added and would need a look before submission, though they touch no money code. This is an engineering assessment of a sandbox implementation, not a legal or regulatory certification.

**Walkthrough status: NOT REVIEWED WITH YOANN.**

---

# Re-review after the fixes, slice B8

- **Timestamp**: 2026-09-08T19:40:00Z (re-review started 19:12Z).
- **Revision re-reviewed**: `2755d11a135007780d0c989e9176268d47a5c895`, the merge of the fix branch onto main. The four fix commits are `2bb5e13` (F-B8-01), `512f991` (F-B8-02, F-B8-04, F-B4-13), `27c988a` (F-B8-03, F-B8-05, F-B8-07) and `45ea482` (the last uuid regex copy). The first review covered `e7b5913`.
- **Reviewer**: independent re-reviewer sub-agent, a different context from the builder who wrote the fixes and from the reviewer who wrote the record above. Wrote no application code, delegated to nobody, and wrote no file in the repository except this section. Created nothing on the trial database and nothing on the deployed application.
- **Walkthrough status**: `NOT REVIEWED WITH YOANN`.
- **Verdict**: **PASS** for slice B8 at `2755d11`, with two new LOW findings (F-B8-08, F-B8-09) and F-B8-06 left open by the coordinator's decision. The three findings that carried the FAIL are resolved and each is proven by a check line or a deployed response rather than by a claim.

## 11. Startup receipt of this re-review

Read in full before any check: `CLAUDE.md`, `AUTOMATIC-FAILS.md` (all six rules and the operating gate), `READABLE-CODE.md`, `AGENTS.md`, `WORKFLOW-48H.md`, `REVIEWER.md`, and sections 1 to 10 of this record (the first review, verdict FAIL, findings F-B8-01 to F-B8-07 and the referred F-B4-13). Read by targeted section: `docs/DECISIONS.md` entries 17, 18 and 19 (cumulative money-out on a claim, cancellation segment by segment, the broker statement's two money columns), `docs/ARCHITECTURE.md` sections 3, 3.x and 6, and the eight B8 and F-B4-13 rows of `docs/reviews/FINDINGS.md`. Read line by line in the corrected tree: `lib/statements/compute.ts` (the `DISPOSITIONS` table, `statementDisposition`, `STATEMENT_CASH_ENTRY_TYPES`, `classify`, `statementLineFor`, `totalsOf`, `canonicalTextOf`), `lib/statements/journal.ts` (the whole query, both premium subqueries), `lib/statements/entry-types.test.ts`, the five `*_ENTRY_TYPES` exports and `REVERSAL_ENTRY_TYPE_PREFIX` in `lib/ledger/`, `lib/ledger/correction-entries.ts`, `lib/money/correction.ts` and its test additions, `lib/policy/correct-endorsement-date.ts` (the plan, the transaction, `rebookPayload`, `settleTheDifference`, `openRefundsForDifference`, `moneyStillWaitingForTheCustomer`), `lib/policy/correction-read.ts`, `lib/payments/correction-collection.ts`, `lib/http/path-ids.ts`, the recovery block and `loadRefundOperation` of `lib/payments/refunds.ts`, the three correction routes, the two correction pages, `app/policies/[policyId]/correction-sections.tsx`, the correction notices of `app/policies/[policyId]/page.tsx`, and the B8 additions to `scripts/check-statements.ts` and `scripts/check-correction-replay.ts`. Not read this time: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`, `GAP-REVIEW.md`, `docs/COMPLIANCE-MATRIX.md`, `docs/PLAN.md`, `docs/STATUS.md`, `docs/handoffs/b8-implementation-notes.md`. Absent files: none of the mandatory files were missing.

Planned checks, all executed except where section 15 says otherwise: read the corrected diff finding by finding; run `check:statements` once and `check:correction-replay` once on `corgi_test`; run the typecheck and the two unit files the fix adds to; scan the fix range for secrets; and exercise the five correction entry points over HTTP on the deployed revision. `check:money-guards` was deliberately NOT run: the coordinator proved it at 19:11Z on an ephemeral database, 184 of 184, and a second run would only add contention on the shared database.

## 12. Finding by finding

| ID | Sev | State at `2755d11` | The line that proves it |
|---|---|---|---|
| F-B8-01 | HIGH | **RESOLVED** | `check:statements`: "THE CORRECTION DIFFERENCE IS ON THE STATEMENT: 5047 of cash, 4931 of premium, 739 earned (cash 5047, premium 4931, earned 739, net due 739)" |
| F-B8-02 | MEDIUM | **RESOLVED** | `check:correction-replay`: "and it STILL NEEDS AN APPROVER, because the policy already has 90068 on its way back (pending 90068, already refunded 0)" and "so it is QUEUED with an approval request and nothing is sent to Stripe (1 approval request(s), 0 sent)" |
| F-B8-03 | MEDIUM | **RESOLVED** | section 14: the five entry points answer 400 or 404 on a malformed id on the deployed revision |
| F-B8-04 | LOW | **RESOLVED** | `check:correction-replay`: "and it STILL NEEDS THE CUSTOMER, because 48762 of quotes are already waiting for them (waiting 48762: $50.47 to collect, counting the $487.62 still waiting for this customer on this policy, is above $500.00, so the customer has to approve it)" |
| F-B8-05 | LOW | **RESOLVED** | `lib/policy/correction-read.ts:337` now branches on the two date keys being strings and otherwise says "the event above was reversed and nothing re-books it, so it no longer counts", with the reason. Read in the diff; the deployed CGP-01061 timeline is in section 14. |
| F-B8-06 | LOW | **OPEN**, by the coordinator's decision (B13-2 batch). Not a blocker of this verdict. | unchanged: `check:correction-replay` still has no probe for a voided policy, none for an endorsement whose delta was refunded, and none for a cancellation after a correction |
| F-B8-07 | LOW | **RESOLVED** | `app/policies/[policyId]/correction-sections.tsx:265`: the field defaults to `today` only when `today > termStart`, and to the term start otherwise, so it can no longer start on a date its own `min` rejects |
| F-B4-13 | LOW as referred | **RESOLVED**, closed with F-B8-02 and F-B8-04 as the first review said it would be | the two read paths it named, `correction-read.ts:110` and `:220`, now read `difference_customer_approval_required` and `difference_refund_needs_approval` from the re-book event instead of recomputing; replay line: "the verdict and the totals behind it are written on the correction event, not recomputed later (read back: needs approval true)" |
| F-B8-08 | LOW | **NEW**, opened by this re-review, section 13 | a correction refund split over more than one Stripe payment gives every one of its refund lines the whole correction's premium as the commission base |
| F-B8-09 | LOW | **NEW**, opened by this re-review, section 13 | the F-B8-07 clamp was applied to the as-of field and not to the two document date fields beside it, which still ship `min="2026-09-17" value="2026-09-08"` on the deployed CGP-01274 |

### F-B8-01, what I checked beyond the check line

The fix is two halves and both hold.

**The classification.** `DISPOSITIONS` in `lib/statements/compute.ts` now names every entry type with either a line or an explicit "ignored, because", and `STATEMENT_CASH_ENTRY_TYPES` is derived from that same table, so `lib/statements/journal.ts` selects on a list it can no longer disagree with. I checked the exhaustiveness claim rather than believing the test: `grep -rn "entryType:" lib scripts app db` returns 19 literals, every one of them written `satisfies` one of the five exported unions, and the only other writers of `journal_entries.entry_type` are `lib/ledger/reverse.ts` (which prefixes an existing type) and four guard check scripts that insert deliberately fabricated rows on the disposable database. So the five `*_ENTRY_TYPES` lists really are the set of types the application can post, and `lib/statements/entry-types.test.ts` walking all of them plus their reversals is a real gate: 19 assertions, all passing. The runtime fallback of rule 1 is kept, so an unknown type that moved the payable still lands as an adjustment rather than disappearing.

**The premium base.** The second sum added to `unearned_premium_cents` reads the correction's own two events rather than the money operation. I traced the ids by hand: the reversal entries are filed `source_kind = 'correction'`, `source_id = reversalEvent.id` by `reverseJournalEntry`; the re-booked premium and tax under `source_id = rebookEvent.id`; and the re-book payload carries `correction_reversal_event_id`, which is exactly the pair the subquery reads. Their net movement of `unearned_premium` is the premium of the difference (43561 - 38630 = 4931 in the recited example, and the check asserts 4931 x 15% = 739 with adjustment 0). Both scalar subqueries are safe against a multi-row error: `correction_collections.collection_operation_id` and `refund_allocations.refund_operation_id` are both declared `unique`. The two sums cannot both fire: a correction posts nothing moving `unearned_premium` under its settlement operation, which I verified in `correctionCollectionEntries` (cash against the receivable) and `correctionRefundRequestedEntry` (receivable against refund payable). An ordinary cancellation refund is untouched by the new branch, because its `refund_allocations.policy_event_id` is the `cancelled` event and the subquery filters on `event_type = 'correction_rebook'`. `premium_earned_to_date`, the other entry that moves `unearned_premium`, is filed under the policy event and not under the refund operation, so it does not pollute the first sum either.

**The three months.** The check adds them up independently of the classifier and against a separate SQL sum of the ledger cash: "the three months add up to the CORRECTED endorsement: 169904 of cash, 163561 of premium, 24533 earned" and "the cash on the three statements is the cash the ledger holds for that policy, to the cent (ledger 169904, statements 169904)". The closed month is unchanged and reproducible: "JULY STILL RECONCILES after the correction (revision 2, same hash true)". That is the right answer under decision 19: the correction's cash is effective on the day the money moved, so it is a September line and July keeps what it published.

### F-B8-02, what I checked beyond the check line

The gate is read from the policy at plan time (`policyRefundTotals` and `moneyStillWaitingForTheCustomer` in `planEndorsementDateCorrection`), the pure function takes the totals as arguments and no longer reaches for the thresholds itself, and both verdicts plus the three totals behind them are written on the re-book event and read back by `correctionsOfPolicy` and `collectionOfCorrection`. `startCorrectionCheckout` and `approveCorrectionCollection` ask the cumulative question again at the moment money would be collected, which can only ever demand more approval, never less.

The second half of the finding, the part that made it MEDIUM, is the terminal refusal. `correctEndorsementDate` no longer discards the outcome of `issueRefundsAtStripe`; a `refused` outcome is written as a `failed` money operation event with `stage: "approval"`, which is the exact shape `loadRefundOperation` maps to `lastFailureStage === "approval"` and that `reissueRefund` releases by opening a new operation **with** a new approval request rather than calling Stripe. The route turns the same outcome into `correction=refund-refused`, and the policy page prints a notice saying nothing was sent and pointing at the button. So the customer is no longer left owed money with no in-application way to pay them. The rejection race itself (a refusal arriving after the plan said the refund could go) is proven by reading the recovery path and by the shape B7 already exercises, not by a new check line: see section 15.

One note for the record, not a finding. The read paths now default both verdicts to `false` when the re-book payload does not carry them, which is the honest reading for a correction written before this commit. No `correction_rebook` event exists on the trial database today (the only correction there is the B8a void of CGP-01061, a `correction_reversal` with no re-book), so no stored correction reads back a wrong verdict, and the collection gate re-asks the question cumulatively before any money is taken in any case.

### F-B8-03, F-B8-05, F-B8-07

All three read as described in `27c988a`. The three routes call `badPathIdResponse` on their first line, before `currentUser()` and before any query, and the two pages call `isUuid` plus `notFound()`. The four local copies of the uuid regex inside the correction module are gone (`45ea482` removed the last one, in `planEndorsementDateCorrection`); the copies that remain in `lib/payments/refunds.ts`, `lib/auth/current-user.ts`, `lib/reconciliation/stripe-records.ts`, `app/api/webhooks/stripe/route.ts` and `app/api/statements/[runId]/pdf/route.ts` are outside this slice and outside this verdict. The deployed behaviour is in section 14.

## 13. New finding

### F-B8-08 (LOW): a correction refund split over two payments counts its premium base twice

**Trigger.** `lib/statements/journal.ts`, the second premium sum. It finds the correction from `refund_allocations.refund_operation_id` and then sums the whole correction's movement of `unearned_premium`. A correction refund is allocated newest collection first and opens **one money operation per PaymentIntent** (`openRefundsForDifference`), and every one of those rows carries the same `policy_event_id = rebookEventId`. So when a correction gives back more than the newest collection holds, each of its `refund_completed` entries is given the whole correction's premium as its commission base.

**Reachable sequence**, on the recited policy. An endorsement keyed 2028-07-09 collects 39537 on its own PaymentIntent. Correction 1 to 2028-06-09 collects a difference of 5047 on a second PaymentIntent. Correction 2 on that re-book, to 2028-08-09, owes back 10262: 5047 comes off the newest collection and 5215 off the endorsement's, so two refund operations. When both complete, both refund lines print "of which premium" as the same -10027 instead of roughly -4931 and -5096. Nothing blocks the sequence: the guards a correction applies are "the most recent endorsement in force", a zero premium receivable and no correction refund in flight, and all three hold at that point.

**Consequence, and why it is LOW.** The totals are unaffected: `totalsOf` never adds a refund line's base to `premiumCollectedCents`, and net due is still asserted against the movement of `commission_payable`, so the statement still ties to the ledger to the cent and the invariant assertion in `computeStatement` cannot be tripped by this. What is wrong is a figure printed on the refund line of the screen, the PDF and the MCP tool output, and hashed into the canonical text. It needs a chain of two corrections whose second refund exceeds the newest collection, which no check exercises today and which the demo does not reach.

**Required correction.** Read the slice's own figure instead of the correction's total: `refund_allocations.refunded_premium_cents` is already stored per operation, decided once at correction time, and is exactly the premium that refund gives back. One added check line covering a correction refund over two payments would close it.

### F-B8-09 (LOW): the F-B8-07 fix was applied to one date field and not to the two beside it

**Trigger.** `app/policies/[policyId]/page.tsx:226` and `:231`, the two document as-of fields: `defaultValue={today} min={policy.effectiveAt}`, which is exactly the shape F-B8-07 named and `correction-sections.tsx` fixed. On a policy whose term has not begun, they ship a value the input itself rejects.

**Measured on the deployed CGP-01274**, whose term starts 2026-09-17: `id="asOfDeclarations" min="2026-09-17" value="2026-09-08"` and the same for `asOfSchedule`, one section above the corrected `asOf` field that now reads `min="2026-09-17" value="2026-09-17"`.

**Consequence.** The browser refuses to submit either form until the operator changes the date, so "Open the declarations page (PDF)" and "Open the endorsement schedule (PDF)" do nothing on the one bound future-dated policy of the demo. Every other date input on that page already clamps its default into its own range (`endorsementEffectiveAt`, the cancellation date, the date of loss), so these two are the exception rather than the pattern.

**Required correction.** The same one-line clamp the F-B8-07 fix used, in the two places: `today > policy.effectiveAt ? today : policy.effectiveAt`.

## 14. The deployed application

**Which revision was exercised, and why it is the right one.** `/api/health` reported `c5bcf2a` at 19:31Z, before any HTTP work, and `41be7fc` at 19:35Z, after it: main moved forward twice during the re-review. Both are strict DESCENDANTS of `2755d11` (`git merge-base --is-ancestor 2755d11 41be7fc` exits 0), so both carry every B8 fix commit. I checked what they add on top: `git diff --stat 2755d11 41be7fc` touches interface files, `components/`, docs and four read modules, and NOT one file of the B8 scope. `lib/statements/*`, `lib/money/correction.ts`, `lib/policy/correct-endorsement-date.ts`, `lib/policy/correction-read.ts`, `lib/payments/correction-collection.ts`, `lib/ledger/*`, `lib/http/path-ids.ts`, the three correction routes, the two correction pages, `correction-sections.tsx` and the scripts are byte for byte those of `2755d11`. The one B8 file that is touched is `app/policies/[policyId]/page.tsx`, and I checked in the deployed source that the two notices the F-B8-02 fix added, `refund-refused` and `refund-failed`, are still there (lines 1019 and 1021). So the responses below are this slice's code.

**F-B8-03, the five entry points, malformed policy id**, signed in as `ops@example.com`, session cookie only, nothing created:

| Request | At `e7b5913` | Now |
|---|---|---|
| `GET /policies/not-a-uuid/corrections/new?endorsedEventId=<uuid>` | 500 | **404** |
| `GET /policies/not-a-uuid/corrections/<uuid>/approve` | 500 | **404** |
| `POST /api/policies/not-a-uuid/corrections` | 500 | **400** |
| `POST /api/policies/not-a-uuid/corrections/<uuid>/checkout` | 500 | **400** |
| `POST /api/policies/not-a-uuid/corrections/<uuid>/approve` | 500 | **400** |

The malformed re-book event id is answered the same way: `POST .../corrections/not-a-uuid/checkout` and `.../approve` answer 400, and the approval page answers 404. The neighbouring slices still answer as they did, so the register is now consistent: `GET /policies/not-a-uuid` 404, `GET /policies/not-a-uuid/endorse` 404, `POST /api/policies/not-a-uuid/endorsements` 400. The 400 body echoes nothing a caller put in the URL: it is the single line `the policyId in this URL is not a valid identifier`.

A well-formed but unknown policy id is still a refusal and not an error: `POST /api/policies/<unknown uuid>/corrections` with a complete form answers `303` to `?error=this%20policy%20does%20not%20exist`. Nothing was created by that probe, because the policy it names does not exist, and no other probe reached a write path.

**F-B8-05** on the deployed CGP-01061 (`de2fb99f-8db4-4aa3-9ee5-827e444ab5ad`), the timeline entry that used to print two question marks:

```
Correction: the event above was reversed and nothing re-books it, so it no longer counts
(Bound on 2026-09-08 through a locally signed webhook during development (pi_local_...);
Stripe never collected this payment. Reversed by the coordinator per review finding F-B2-01
and Yoann's decision.)
```

No occurrence of "put right to ?" remains anywhere on that page.

**F-B8-07** on the deployed CGP-01274 (`104d2966-be96-4c36-9956-caf0762f8b15`), the one policy whose term has not begun: the field the finding named now renders `min="2026-09-17" value="2026-09-17"`, so it no longer ships a value its own constraint rejects. Two sibling fields on the same page still do, which is F-B8-09 below.

**One observation outside this slice, for the coordinator, not a B8 finding.** A POST with no form body at all answers 500 rather than 400, on the correction route and equally on B4's `POST /api/policies/<uuid>/endorsements`. It is the house-wide consequence of `await request.formData()` on an empty body, it predates B8, and it is not what F-B8-03 was about (a malformed path id, which is now handled). Worth one shared guard at some point; it blocks nothing here.

## 15. Checks executed, and checks not executed

| Check | Result |
|---|---|
| `curl /api/health` before and after the HTTP work | `c5bcf2a` at 19:31Z and `41be7fc` at 19:35Z, database ok; both strict descendants of `2755d11` that touch no B8 file, see section 14 |
| `npm run typecheck` | exit 0 |
| `npx tsx --test lib/statements/entry-types.test.ts lib/money/correction.test.ts` | 19 tests, 19 pass, 0 fail |
| `npm run check:statements` (one run, `corgi_test`) | 48 PASS, 0 FAIL, "ALL CHECKS PASSED" |
| `npm run check:correction-replay` (one run, `corgi_test`) | 55 PASS, 0 FAIL, exit 0 |
| `gitleaks dir` over the whole `e7b5913..2755d11` diff | 844 KB scanned, no leaks found |
| Independent read of the entry-type exhaustiveness claim (every `entryType:` literal and every raw `insert into journal_entries`) | 19 literals, all `satisfies` one of the five exported unions; the only other writers are `reverse.ts` and four guard check scripts |
| Independent read of the two premium subqueries against the schema (`correction_collections`, `refund_allocations`, migrations 0005 and 0014) | both scalar subqueries are unique-constrained; the two sums are mutually exclusive; F-B8-08 is the one case they get wrong |
| The correction entry points over HTTP on the deployed revision | section 14 |

**Not executed, and why.**

- **`npm run check:money-guards`**: deliberately not run. The coordinator proved it at 19:11Z on an ephemeral database, 184 of 184, and the shared `corgi_test` was already carrying two of my runs. The B8 fixes add no table, no trigger and no grant, so the guard surface is unchanged since that run.
- **The full `npm test` suite**: only the two files the fix touches were run, to keep the shared database free. The typecheck covers the whole tree.
- **No correction, and no money movement of any kind, on the deployed application.** The HTTP work was malformed-id probes and read-only page fetches, signed in as `ops@example.com`.
- **The refusal race of F-B8-02** (the gate saying no after the plan said yes) is proven by reading the recovery path, not by a check line: no check drives a correction refund to `refused` through `correctEndorsementDate`.
- **F-B8-08 is not reproduced end to end.** It is derived from the schema, the allocation code and the query; no check exercises a correction refund split over two payments.
- **No load or concurrency testing**, and no re-audit of `collectionsStillRefundable`, unchanged since the first review.

## 16. Verdict

**PASS** for slice B8 at `2755d11`. F-B8-01, F-B8-02, F-B8-03, F-B8-04, F-B8-05, F-B8-07 and the referred F-B4-13 are resolved, each against a check line or a deployed response rather than against a claim. F-B8-06 stays open by the coordinator's decision and is not a blocker here. F-B8-08 and F-B8-09 are new and both LOW: neither touches a total, the ledger tie or a money movement, and neither is a reason to hold the slice.

Nothing in the corrected diff updates or deletes a money row: the four commits add a lookup table, a query branch, two threshold arguments, one `insert into money_operation_events`, path-id guards and screen sentences. The correction transaction itself is unchanged, and the replay still proves that not one of the 36 rows that existed before a correction changes, byte for byte. On AF-06 the fix improves the reading path rather than lengthening it: the disposition table is one screen of names with a reason beside each, the approval sentence is one pure function, and the two threshold questions now live where every other slice asks them. The one place a reader has to work is the second premium subquery in `lib/statements/journal.ts`, twenty lines of SQL joining three tables through a payload key; its comment explains why it exists, and F-B8-08 is the corner it gets wrong.

Residual limitations: the correction still has never run against real Stripe money, so every figure remains proven on the disposable database and by arithmetic. This verdict covers `2755d11` and the B8 scope only, not the B11 and F-B2-20 work merged alongside it. This is an engineering assessment of a sandbox implementation, not a legal or regulatory certification.

**Walkthrough status: NOT REVIEWED WITH YOANN.**
