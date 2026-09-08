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

**FAIL** for slice B8 at `e7b5913`. F-B8-01 is an observed defect on the path the brief's live fire 2 names: after a correction, the broker statement for the month of the difference understates the cash and the premium collected and shows the commission as an adjustment with no base. F-B8-02 leaves a real refund permanently unsendable through the interface while telling the operator it was requested. F-B8-03 turns five deployed entry points into 500s on a malformed id that the rest of the application already handles. None of these is an AF-03 breach: the ledger is append only, the correction is one transaction, the original rows are provably untouched byte for byte, the cash is never reversed, and no money can leave without the approval the cumulative gate demands.

Residual limitations of this review: the correction has never run on the deployed application or against real Stripe money, so every money figure above is proven on the disposable database and by arithmetic rather than by a provider round trip. The verdict covers `e7b5913` only; the interface commits since then change the pages this slice added and would need a look before submission, though they touch no money code. This is an engineering assessment of a sandbox implementation, not a legal or regulatory certification.

**Walkthrough status: NOT REVIEWED WITH YOANN.**
