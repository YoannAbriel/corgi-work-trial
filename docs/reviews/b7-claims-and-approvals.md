# Independent implementation review: slice B7 (claims, reserves, simulated payout rail, maker-checker) and rule 14 (suspense account)

- Scope, two separately judged parts:
  - **B7**: merge `e77baa6` (branch commits `3eb6fb3` to `336b6bb`) plus the staff landing page `59f2fcd`. Claims and reserves, the claim limits, the claim journal entries, the two LOCAL SIMULATORs, the money-out approval queue, the maker-checker trigger, the gate on the B5 cancellation refund, the two job endpoints, the four screens, and the B5 corrections F-B5-01, F-B5-02, F-B5-03.
  - **Rule 14**: commit `9a69fd5`, the suspense account `unapplied_customer_cash` for money received after a broker lost eligibility. It answers F-B2-17, F-B3-01, F-B3-02, F-B3-07, F-B3-08 and F-B3-10.
- Reviewer: independent reviewer sub-agent. Not the implementer, no delegation. The only file written in the repository is this one.
- Timestamp: 2026-09-08T15:20:00Z (review started 14:25Z).
- Revision reviewed: the code was read at `85da484`. While the review ran, `main` moved to `ab49f0d`; `git diff --name-only 85da484 ab49f0d` touches only `.gitignore`, `docs/DECISIONS.md` and `docs/STATUS.md`, so every code finding below applies unchanged at `ab49f0d`. The deployed application reported revision `4decb8c` throughout, which carries the whole B7 and rule-14 code. `git status --porcelain` was empty at the start and holds only this file at the end.
- Verdicts: **B7: FAIL** on one HIGH finding (F-B7-01, an approver's rejection of an above-threshold refund can be overridden by the maker). **Rule 14: PASS**, with two LOW findings.
- Walkthrough status: **NOT REVIEWED WITH YOANN**.

This is a scoped engineering assessment of two slices, not a legal certification and not a statement that the six delivery gates pass.

## 1. Startup receipt

Read in full, in this order: `CLAUDE.md`, `AUTOMATIC-FAILS.md`, `READABLE-CODE.md`, `AGENTS.md`, `WORKFLOW-48H.md`, `REVIEWER.md`, `docs/ARCHITECTURE.md` (all nine sections including 3.x), `docs/DECISIONS.md` (every entry, including the 14:32Z entry on paid-when-sent that landed during the review), `docs/reviews/FINDINGS.md`, `docs/STATUS.md`, `docs/reviews/b5-cancellation-and-refund.md`, `docs/handoffs/b7-implementation-notes.md` (all nine sections, treated as claims to verify). Read in part by targeted search: `docs/reviews/b3-broker-kyb.md` (startup receipt, applicability, requirement matrix, F-B3-01), `README.md` (integration inventory, demo roles, known facts about the demo data).

Code read line by line: `db/migrations/0008_claims_and_approvals.sql`, `db/migrations/0010_unapplied_customer_cash.sql`, `lib/claims/money-position.ts`, `lib/claims/limits.ts`, `lib/claims/coverage.ts`, `lib/claims/claims.ts`, `lib/claims/payments.ts`, `lib/claims/read.ts`, `lib/approvals/intent.ts`, `lib/approvals/threshold.ts`, `lib/approvals/approvals.ts`, `lib/ledger/claim-entries.ts`, `lib/ledger/policy-entries.ts`, `lib/ledger/post.ts`, `lib/rails/simulator.ts`, `lib/rails/bank-verification-simulator.ts`, `lib/jobs/authorize.ts`, `lib/payments/recover.ts`, `lib/payments/refunds.ts` (whole file, and its diff since the B5 review), `lib/payments/collection.ts`, `lib/payments/checkout.ts`, `lib/policy/cancel.ts` (diff), `lib/policy/read.ts` (refund view), `lib/policy/status.ts`, `lib/broker/kyb-onboarding.ts` (rule-14 diff), the routes under `app/api/claims`, `app/api/approvals`, `app/api/jobs`, `app/api/policies/[policyId]/claims`, `.../refunds/[operationId]/send` and `.../reissue`, the pages `app/ops/page.tsx`, `app/ops/claims/page.tsx`, `app/ops/claims/[claimId]/page.tsx`, `app/ops/approvals/page.tsx`, `app/policies/[policyId]/page.tsx` (payment, refund and claims sections), `scripts/migrate.ts`, `scripts/check-claims-and-approvals.ts` (the identity assertion, the fixtures and the concurrency block), and the assertions of `scripts/check-money-guards.ts` and `scripts/check-kyb-replay.ts` that this scope adds.

Not read: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`, `GAP-REVIEW.md`, `START-PROMPT.md` (advisory catalogues, outside this scope), `docs/COMPLIANCE-MATRIX.md` (coordinator owned), `docs/PLAN.md` (read only for the B7 row). `.env.local` was never opened or printed; scripts loaded it through `process.loadEnvFile` and the HTTP probes read the demo password and the cron secret into a shell variable that was never echoed. Absent files: none of the mandatory files is missing. No provider documentation was fetched: this scope adds no new provider call, and the only Stripe traffic it makes is the existing refund path.

Planned checks, all executed: typecheck, build, unit tests, `check:claims-and-approvals`, `check:money-guards` on the disposable database, `check:kyb-replay`, a read-only catalogue inspection of the trial database, `npm run migrate` on the trial database, a throwaway database migrated 0001 to 0010 and dropped, HTTP probes of every new screen and route as four roles on the deployed application, both job endpoints with a wrong and a correct bearer token, two adversarial probes of my own on the disposable database, and a secret scan of the merged range, the whole history and the working tree.

## 2. Applicability and assumptions

Feature: claim handling and money-out control for a US commercial liability policy administration system, USD integer cents, own append-only double-entry ledger. Confirmed facts: the $1,000 money-out threshold and the two roles are Yoann's decisions of 2026-09-08 recorded in `docs/DECISIONS.md`, explicitly labelled assumptions of this build and not regulatory figures, and the code and the approvals screen say so. The claim payout rail and the bank ownership check are LOCAL SIMULATORs, disclosed in `README.md`, in the module headers and on every screen. Rule 14 is Yoann's decision of 12:54Z. The "paid when sent" reading of a claim payment was the delegate's deviation and became Yoann's own decision at 14:32Z, during this review.

Requirements applied: the brief's general non-negotiable 6 (maker-checker on money-out above a threshold, the initiator cannot approve, an agent cannot approve), the Track 1 claim requirements (reserve adjustments append-only, payments reduce the reserve, incurred equals paid plus reserve, cannot pay past a limit), the live-fire rule "cancel with an open claim", AF-01 to AF-06, and the engineering rules of `AGENTS.md`. No legal regime is asserted as applicable to this sandbox. I consulted no legal source: the only legal fact in this scope is the California rate decided earlier, which this slice does not touch.

## 3. Requirement matrix

| Requirement | Control and location | Evidence from this review | Verdict |
|---|---|---|---|
| No UPDATE or DELETE on any money row, from the app or from the owner | Migration 0008 gives each of the six new tables an append-only trigger, a TRUNCATE trigger and a server-set recording time, and grants `app_runtime` only SELECT and INSERT | `check:money-guards --database=test` 110 PASS, 0 FAIL, exit 0, of which 18 owner refusals and 18 runtime refusals on the six new tables. Trial database, read-only catalogue: all 16 protected tables carry their three triggers, `app_runtime` holds `INSERT,SELECT` and nothing else on all 16, no protected table lacks a grant row. Repository grep: the only mutations anywhere are the `policy_current` upsert and the `webhook_processing` lease | PASS |
| Maker-checker enforced by the database, not only by code | Trigger `approval_decisions_enforce_maker_checker` refuses the requester, an unknown user and any role other than `staff_approver`; unique `request_id` refuses a second decision | Trigger present on the trial database. Guard script, raw SQL on the owner connection: the requester refused, `staff_ops`, `broker` and `customer` refused, an unknown user refused, a second decision refused, one approval funds at most one operation, an `agent` role cannot even be created today | PASS |
| The initiator cannot approve; agents cannot approve; only a distinct `staff_approver` decides | `decideApprovalRequest` refuses the role and the self-approval before the write; the approve route accepts the session cookie only and reads the role from the session | Deployed application: the initiator (staff_ops) refused, a broker refused, a customer refused, no cookie redirected to the login page, the `staff_approver` accepted, a second decision refused. The self-approval branch is unreachable through the application today because only `staff_ops` can request a money-out and `staff_ops` is already refused on the role; it is proven at the database level instead | PASS |
| A changed intent needs a fresh approval | `lib/approvals/intent.ts` hashes four labelled lines; execution rebuilds the intent from the current world and compares | Deployed application: after the approval, a different bank account was recorded for the claim and the send was refused with "what would be paid is no longer what was approved". Recording the original account again restored the token and the send was allowed. The screen prints the exact hashed text; I recomputed its SHA-256 independently and it equals the stored hash | PASS |
| Two simultaneous executions produce one transfer | Per-claim advisory lock plus the unique index on `(money_operation_id, event_type)` | Check script: "two executions of the same approved payment produce ONE payment (one claim event, one journal entry, one transfer at the rail)". Deployed application: the second send answered `already_sent` with no second transfer | PASS |
| Two simultaneous requests cannot both pass the limits | `requestClaimPayment` holds the claim lock over the snapshot, the ceilings and the write; a requested payment holds its place until sent or refused | Check script: two $2,500 requests against a $4,000 reserve, one accepted, one refused | PASS |
| incurred = paid + reserve after every transition, against the journal | `claimMoneyPosition` folds the events; `expectIdentity` compares the fold with the balances of `incurred_loss_expense` and `claim_reserve` | `check:claims-and-approvals` 55 PASS, 0 FAIL, exit 0, with the identity asserted after set, lower, request, send, settle, return, rejection and close. Reproduced on the trial database for the claim I created: incurred 500000 = paid 120000 plus reserve 380000, equal to the journal | PASS |
| The three ceilings: reserve, per occurrence, aggregate | `claimPaymentRefusal`, one pure function used by the screen, the request path and the execution path | Check script covers all three. Deployed application: $5,000.01 against a $5,000 reserve refused with the sentence naming the reserve | PASS |
| A refund above $1,000 waits for an approver (F-B5-01) | `recordCancellation` writes the approval request in the same transaction as the operation; `cancelPolicy` sends only the operations that are not waiting | Check script: the cancellation is recorded, the policy is cancelled, the customer is owed the money, the operation is still `requested`, the send is refused before approval and allowed after. Deployed cancellation preview says so before the broker confirms | PASS |
| A create-stage refund failure is retried under the same key (F-B5-02) | `reissueRefund` branches on `lastFailureStage`; `createReissuedRefundOperation` refuses a create-stage failure as well | Check script proves both branches | PASS |
| A refund stuck in `requested` has a resume action and a job (F-B5-03) | `sendRequestedRefund` behind one button, and `/api/jobs/recover-operations` | Both routes answered correctly over HTTP; the job returned `stuckCount 0` twice with no side effect | PASS |
| Cancel with an open claim: the reserve is untouched and explained | `assertCancellationAllowed` reads the open claims and returns the sentence and the figures; `recordCancellation` writes them onto the cancellation event and touches no claim table | Deployed preview on a policy with my open claim: the explanation, "reserve still held on the open claim, untouched by this cancellation $3,800.00", "already paid on it, untouched too $1,200.00", and a refund made of unearned premium and its tax only. Recomputed the whole breakdown by hand: 120 of 365 days, earned 76010, unearned 155190, tax 3647, refund 158837, clawback 23278, all equal to the screen. The preview is a GET and wrote nothing | PASS |
| The claim entries are the ones the architecture specifies | `lib/ledger/claim-entries.ts`, keyed on the claim event | Trial database, my claim: `claim_reserve_set` Dr incurred_loss_expense 500000 / Cr claim_reserve 500000, `claim_payment_sent` Dr claim_reserve 120000 / Cr claims_payable 120000, `claim_payment_settled` Dr claims_payable 120000 / Cr cash_claims_rail 120000. Global journal balances, 51 lines, debits 3277535 equal credits | PASS |
| The simulated rail is a real provider-side record, diffable by B10 | `simulator_provider_records`, written only by `lib/rails/simulator.ts`, no foreign key into the money tables, linked by `transfer_ref` only | Two rows for my transfer, `sent` then `settled`, both append-only. Confirmed by reading that no other module writes the table | PASS |
| Job endpoints authenticated, idempotent, and settling only what is due | `assertJobIsAuthorised` compares `CRON_SECRET` in constant time and fails closed when it is unset | Deployed: no header 401, wrong bearer 401 on both endpoints, GET 405, correct secret 200. `settle-simulated-payouts` returned `dueCount 0` twice while my transfer was correctly not yet due (settlement date 2026-09-10). `recover-operations` returned `stuckCount 0` twice | PASS |
| Screens render, default and empty states, error states, no money computed in the browser | Four server components, no `use client` anywhere in the repository | Every screen rendered over HTTP as four roles. Empty states are explicit sentences. `/ops/claims/<unknown uuid>` is a 404. A malformed uuid is a 500 (F-B7-07) | PASS with F-B7-07 |
| AF-02: every simulator labelled LOCAL SIMULATOR on screen | Module headers, `README.md` inventory rows, the claim screen headings and both rail buttons | Rendered: "Claimant bank account (LOCAL SIMULATOR)", "LOCAL SIMULATOR: settle now", "LOCAL SIMULATOR: the bank returns the money", `/ops` naming the rail, and the destination on the approvals screen reading "LOCAL SIMULATOR bank account ...6789". README carries both rows | PASS |
| Rule 14: the cash is journaled at receipt, applied at the bind, never twice | `unappliedCashReceivedEntry`, `collectedFrom`, `cashWasParked`, `operationHasIssuanceEntries` | `check:kyb-replay` 23 PASS, 0 FAIL, exit 0: the parking entry at receipt with `cash_stripe` up and the suspense down, no second parking on redelivery, the bind posting the four issuance entries with `premium_collected` debiting `unapplied_customer_cash`, the suspense back to zero, `cash_stripe` showing the money once, and a second bind answering `already_posted` | PASS |
| Rule 14: a `paid_not_bound` policy offers no Pay button | `derivePolicyStatus` returns `paid_not_bound`; `policyCanBePaid` excludes it | Code path only: no such policy exists on the trial database, so the screen could not be exercised. `startCheckout` would also return the already-paid session URL rather than opening a second page, so a direct POST cannot take a second payment | PASS by code path, NOT OBSERVED live |
| Rule 14: the KYB disclosure wording is on the screens (F-B3-08) | Both KYB screens | Rendered on the deployed application: `/broker/kyb` and `/ops/brokers` both carry the "not a dedicated KYB vendor" sentence | PASS |
| Migrations apply from zero, in order, once | `scripts/migrate.ts`, file-name order, one transaction per file | Throwaway Neon database created, migrated 0001 to 0008 then 0010 in order, second run skipped all nine, catalogue identical to the trial database (196 columns, 57 triggers, 275 constraints, 58 indexes, 45 `app_runtime` grants on both), `unapplied_customer_cash` present, database dropped. Both real databases record `0008_claims_and_approvals.sql`, so the rename was corrected; `npm run migrate` on the trial database skipped all nine | PASS with F-B7-12 |
| AF-05: no secret committed | `.githooks/pre-commit`, `.gitignore` | `gitleaks git` over the merged range (43 commits) and over the whole history (105 commits): no leaks. Working-tree scan: 135 findings, every one inside an ignored path (`.claude/worktrees`, `.worktrees`, `.env.local`, `.env.vercel.local`, `.next`); no tracked file is affected. No value was inspected or printed | PASS |
| Maker-checker cannot be bypassed on any money-out path | See F-B7-01 and F-B7-02 | An approver's rejection of an above-threshold refund can be overridden by the maker, and the threshold can be evaded on claim payments by splitting | **FAIL** |

## 4. Findings

| ID | Sev | Finding (one line) |
|---|---|---|
| F-B7-01 | HIGH | A rejected or failed refund above $1,000 can be re-issued by the maker as a new operation with no approval request, and nothing on that path checks maker-checker before calling Stripe |
| F-B7-02 | MEDIUM | The $1,000 threshold is applied to each claim payment separately, so a maker can move any amount out of a claim as several sub-threshold payments with no approver |
| F-B7-03 | MEDIUM | Neither job endpoint is scheduled or reachable from any screen: there is no `vercel.json` cron and no "Run now" button, so a simulated payout never settles on its own |
| F-B7-04 | LOW | A refund rejected by an approver is displayed as "requested, not completed" with a "Re-issue this refund" button, instead of reading as rejected with no action |
| F-B7-05 | LOW | `claim_payout` operations are outside `recoverStuckOperations`, so a claim payment stuck in `requested` is only recoverable by a human clicking Send |
| F-B7-06 | LOW | A claim can be opened for a loss dated in the future: nothing bounds `occurred_at` or `reported_at` above by today |
| F-B7-07 | LOW | A malformed uuid in any id-carrying path returns HTTP 500 rather than a 404 or a refusal (pre-existing, now also on the B7 routes) |
| F-B7-08 | LOW | The payment-stage route does not check that the operation in the URL belongs to the claim in the URL |
| F-B7-09 | LOW | `journal_entries.claim_id` has no foreign key to `claims`, and B7 is the first slice to populate it |
| F-B7-10 | LOW | `settleClaimPayment` has no actor check of its own, unlike `returnClaimPayment`; the role check lives only in the route |
| F-B7-11 | LOW (rule 14) | A Stripe error while expiring a broker's open Checkout Sessions turns an already-committed KYB transition into a webhook failure, and the retry expires nothing because the status no longer changes |
| F-B7-12 | LOW | Migration numbering skips 0009 on `main`, so a later 0009 would be applied after 0010 on the existing databases and before it on a fresh one |

### F-B7-01 HIGH: an approver's rejection of an above-threshold refund can be overridden by the person who asked for it

**Trigger.** A cancellation refund above $1,000 is queued (this part works). The `staff_approver` rejects it. `decideApprovalRequest` then appends a `failed` lifecycle event to the gated money operation with `payload.stage = 'approval'`, which is correct in itself: the payment must stop holding its place. But that same `failed` event makes the operation read as a failed refund everywhere else. `lib/policy/read.ts` sets `failureReason` from it, `app/policies/[policyId]/page.tsx` therefore shows "Re-issue this refund" to any `staff_ops` user, including the one who asked, and `POST /api/policies/{id}/refunds/{operationId}/reissue` accepts the click.

**What then happens.** `reissueRefund` classifies the failure by `lastFailureStage`, which is `create_refund` only when the payload says so; a rejection is classified as `refund_lifecycle`. `assertPreviousRefundIsReallyDead` asks Stripe for refunds carrying the failed operation id and finds none, because nothing was ever sent, so it passes. `createReissuedRefundOperation` then inserts a new `stripe_refund` operation with a new idempotency key and **no `approval_request_id`**, and `reissueRefund` calls `issueRefundsAtStripe` on it. `issueRefundsAtStripe` checks the sandbox and the recovery listing, and nothing else: it never calls `assertRefundMaySend`, which is the only function that enforces the gate. The money leaves.

**Evidence** (`corgi_test`, my own probe, stopped before any Stripe call):

```
1. fixture policy bound and paid: posted
2. cancellation refund: 371545 cents, needs approval: true | approval requests: 1
3. after the REJECTION: state = failed | lastFailureStage = refund_lifecycle | approvalRequestId = set
   assertRefundMaySend on the REJECTED operation refuses: this money-out was rejected: probe: the approver says no
4. createReissuedRefundOperation ACCEPTED the rejected refund and made a new operation
   amount: 371545 cents (threshold is 100000)
   approvalRequestId on the new operation: NULL
   idempotency key differs from the rejected one: true
5. assertRefundMaySend WOULD refuse the new operation: this refund is above the approval threshold
   but carries no approval request; it cannot be sent
   ...but reissueRefund never calls it: it calls issueRefundsAtStripe(newOperationId) directly.
```

The last two lines are the whole finding: the guard exists and says the right thing, and the re-issue path does not ask it. On the deployed application I confirmed the route is live and gated only on the role: a broker and the approver are both refused with "only staff operations can re-issue a failed refund", and `staff_ops` reaches the business logic (on a completed refund it was stopped by `assertPreviousRefundIsReallyDead`, which read the real Stripe sandbox and reported the refund as still succeeded). I deliberately did not run the full path on the trial database, because it would have created a real refund at Stripe.

**Consequence.** General non-negotiable 6 is not met for the refund path. The control that maker-checker exists for, the checker saying no, can be undone by the maker with one button and no second person. A second trigger of the same defect is milder but real: after a genuine `refund.failed` from Stripe, the re-issued above-threshold refund also goes out unapproved.

**Required correction.** Call `assertRefundMaySend` (or an equivalent) inside `issueRefundsAtStripe`, so that every path to Stripe passes the gate, rather than relying on each caller. Separately, a rejection should not be laundered into a re-issuable failure: either give the rejection its own status, or make `reissueRefund` refuse an operation whose approval request was rejected, and make `createReissuedRefundOperation` carry a fresh approval request when the amount is above the threshold. Add the rejected-then-re-issued case to `check:refund-replay` or `check:claims-and-approvals`; neither covers it today.

The equivalent door does not exist on the claim payment path: a rejected claim payment is refused by `sendClaimPayment` on `hasFailed`, and there is no re-issue action, so a new payment is a new request that queues again. Only the refund path is affected.

### F-B7-02 MEDIUM: the threshold is per payment, so money-out can be split below it

`requestClaimPayment` computes `moneyOutNeedsApproval(input.amountCents)` on the single amount being asked for. Nothing looks at what the claim has already paid or has in flight. The refund path was deliberately written the other way ("the threshold is read against the WHOLE refund, not against each Stripe payment it is split over, so splitting cannot slip a refund under it"), which shows the risk was understood there and not here.

Evidence, `corgi_test`, through the production functions, one claim with a $5,000 reserve:

```
  60000 cents -> approval request: NONE; send: sent (sim_tr_84fddf1c...)
  60000 cents -> approval request: NONE; send: sent (sim_tr_65a00096...)
CLM-00874 events: reserve_set 500000 | payment_requested 60000 | payment_sent 60000
                  | payment_requested 60000 | payment_sent 60000
payment_sent total: 120000 cents | approval requests for this claim: 0
                  | claim_payment_sent journal entries: 2
```

$1,200 left one claim with no approver, in two clicks. The reserve and the two policy limits still cap the total, so this is not unbounded, but the maker chooses the reserve too. Required correction: compare the threshold against what this claim has already paid plus what is pending plus the new amount, the way the ceilings already do, or state the per-payment reading as an explicit decision of Yoann's with its reason. This is a money rule, so it belongs to Yoann rather than to the implementer.

### F-B7-03 MEDIUM: nothing runs the jobs

`ARCHITECTURE.md` section 7 promises the job endpoints are "triggered by a staff Run now button and a daily Vercel cron". There is no `vercel.json` in the repository, so no cron is registered, and no screen posts to `/api/jobs/*` (grep over `app/**/*.tsx` returns nothing). Both endpoints work, as proven above, but only for someone holding `CRON_SECRET` at a terminal. Practical consequence for the demo: a claim payment sent on the simulated rail never settles by itself; the only settlement path in the product is the LOCAL SIMULATOR "settle now" button, which is a simulator control rather than the rail doing its job, and `recover-operations` never runs. Required correction: add the cron entries and a staff Run now action, or state in `README.md` that the jobs are manual in this build.

### F-B7-04 LOW: a rejected refund is displayed as a Stripe failure

Consequence of the same event shape as F-B7-01. On the policy page a rejected above-threshold refund reads "requested, not completed", with the approver's reason presented under a heading about the customer still being owed the money, and offers a re-issue button. The branch that would have said "awaiting approval: rejected" is unreachable, because `refund.state` is `failed` and the failed branch is tested first. Fix it with F-B7-01.

### F-B7-05 LOW: a stuck claim payment is not recovered by the job

`stuckOperations` filters `kind in ('stripe_refund', 'stripe_checkout')`. A below-threshold claim payment is requested and sent in two separate transactions from the route; if the send fails between them, the operation stays `requested`, holds its place against the reserve and all three ceilings, and the recovery job ignores it. The claim screen does show it as "ready to send" with a working button, so nothing is lost, but the job's name promises more than it does. Either include `claim_payout` (its rail is local, so recovery is a read of `simulator_provider_records`) or say so in the module header.

### F-B7-06 LOW: a loss can be dated in the future

`claimCoverageRefusal` bounds `occurredAt` below by the start of cover and above by the end of cover, and requires `reportedAt >= occurredAt`; the database adds the same `reported_at >= occurred_at` check. Nothing bounds either date above by today. Because every policy on the trial database starts cover in the future, the only claim that can be opened there today is one for a loss that has not happened, which is what I had to do. Add "a loss cannot be reported before it happened, and cannot have happened after today".

### F-B7-07 LOW: a malformed id is a 500

Deployed, as `staff_ops`: `/ops/claims/not-a-uuid` returns 500, and so do `POST /api/claims/not-a-uuid`, `POST /api/approvals/not-a-uuid`, `POST /api/claims/<real>/payments/not-a-uuid` and the pre-existing `/policies/not-a-uuid`. An unknown but well-formed uuid is handled correctly (404 on the page, a refusal sentence on the routes). This is a repository-wide habit rather than a B7 invention, but B7 added five more places where it shows. One shared "not a uuid" guard would close all of them.

### F-B7-08 LOW: the operation is not checked against the claim in its URL

`POST /api/claims/{claimId}/payments/{operationId}` passes only `operationId` to the money functions, which look the operation up and use its own `claim_id` for the lock, the snapshot and the entries. Acting on another claim's payment from this URL therefore produces a correct financial effect on the right claim, and only the redirect is wrong. The refund routes do check the pair (`sendRequestedRefund` and `createReissuedRefundOperation` both refuse an operation that does not belong to the policy in the URL), so this is an inconsistency rather than a hole. Add the same check.

### F-B7-09 LOW: no foreign key on `journal_entries.claim_id`

The column has existed since migration 0001 without a reference to `claims`, which did not exist then. Migration 0008 creates `claims` and B7 becomes the column's first writer, so 0008 was the natural place to add the constraint. Nothing can write a wrong value today, because the value always comes from a snapshot that was read from `claims`.

### F-B7-10 LOW: `settleClaimPayment` trusts its callers

`returnClaimPayment` calls `assertClaimsOperator` and `sendClaimPayment` does too; `settleClaimPayment` does not, because the settlement job has no user. The route does check `staff_ops` before the settle action, and the job checks `CRON_SECRET`, so both callers are covered today. Make the actor optional and explicit rather than absent, so a future caller cannot forget.

### F-B7-11 LOW (rule 14): expiring the sessions is not retryable

`refreshBrokerKybFromStripe` commits the new status through `applyKybAccountUpdate`, then calls `expireOpenCheckoutSessionsOfBroker` when the broker may no longer bind. That call catches `StripeInvalidRequestError` (a session that is no longer open, which is expected) but rethrows anything else. A network error or a rate limit therefore escapes a function whose database work has already committed, the webhook handler records the delivery as failed and answers 500, and Stripe's retry finds no status change, so `outcome.appended` is false and the sessions are never expired. The money stays safe, because rule 14 books whatever arrives into the suspense account, which is exactly why this is LOW: the expiry is a narrowing of a race, not the control. Either swallow and report the failure (returning a count and a reason) or move it to a retryable step.

### F-B7-12 LOW: the missing 0009 on `main`

`main` holds 0001 to 0008 and then 0010; 0009 belongs to the endorsement branch and is already applied on `corgi_test` (which also carries 0011). `scripts/migrate.ts` applies files in name order and skips what is recorded, so when 0009 merges it will be applied after 0010 on the trial database and before it on any fresh database. The two files are independent today, so nothing breaks; it is worth knowing before a later migration depends on ordering. Note also that `corgi_test` is ahead of `main` by two migrations, so the checks I ran there ran against a superset of the schema.

### Items evaluated and accepted, not findings

The transaction-scoped advisory lock instead of `SELECT ... FOR UPDATE` is the right call and the reason is written above the function: `app_runtime` deliberately has no UPDATE privilege, and PostgreSQL requires it for a row lock, so granting it to buy a lock would weaken the guard the build rests on. `pg_advisory_xact_lock` is also the correct variant for a pooled connection, since it is released at the end of the transaction. The hash collision the comment mentions costs only a wait.

`reserve_adjusted` carrying the new outstanding reserve rather than the delta is well documented, enforced by a CHECK, and easier to defend at a debrief ("the reserve is now $4,000") than a signed delta; the journal books the difference and both facts stay readable.

The `cash_claims_rail` credit balance is stated rather than papered over, both in the module header and in the delegate's notes.

`decideApprovalRequest` rejecting a request also closes the gated operation in the same transaction, so a rejected payment stops holding its place against the reserve. That is correct and is proven by the check script; it is only its display and its re-issuability that F-B7-01 and F-B7-04 object to.

The bank token being a salted digest rather than a vault token is disclosed as such, and only last four digits reach the database. No account number is stored anywhere, which I confirmed by reading the four rows my probes created.

## 5. Money path, as verified end to end on the deployed application

1. `staff_ops` opens a claim from the policy page. `openClaim` checks the role, that the policy was ever bound, and that the loss falls inside the period the policy actually covered, then inserts one row. A broker and the approver were both refused.
2. `staff_ops` sets the reserve. `setClaimReserve` takes the claim lock, reads the fold, refuses a reserve below what is already waiting to be paid, appends one `reserve_set` or `reserve_adjusted` event and posts the difference to the journal. The approver was refused.
3. `staff_ops` records the claimant's bank account. The LOCAL SIMULATOR compares the holder name with the claimant and the routing number against two published test values, and only the last four digits and a one-way token are stored. An account held by someone else was recorded as `failed`, and a payment to it was refused.
4. `staff_ops` asks to pay. One transaction under the claim lock checks the account, the reserve, the per-occurrence limit and the aggregate limit, writes the approval request when the amount is above $1,000, then the money operation carrying its id, its `requested` lifecycle event and the `payment_requested` claim event. Nothing has moved.
5. The `staff_approver` reads the exact hashed text on `/ops/approvals` and decides. The initiator, a broker and a customer were all refused; the approver was accepted; a second decision was refused.
6. `staff_ops` sends. A separate transaction re-reads everything: the operation, the claim, the destination account, the approval and its intent hash, and the three ceilings again. I changed the destination account between the approval and the send, and the send was refused; restoring the account restored the hash and the send was allowed. The rail accepted the transfer, one `payment_sent` claim event, one `provider_accepted` lifecycle event and one journal entry were written, and a second send answered `already_sent`.
7. Settlement. The scheduled job settles only what is due (it returned nothing, correctly, because the transfer settles on 2026-09-10). The LOCAL SIMULATOR button brought it forward: one `payment_settled` event, one `succeeded` lifecycle event, one entry moving `claims_payable` to `cash_claims_rail`, and a second click answering `already_settled`.

After all of it, on the trial database: paid 120000, reserve 380000, incurred 500000, equal to the journal balances of `incurred_loss_expense` and `claim_reserve`; the global journal balances at 3277535 on 51 lines.

## 6. Checks executed, with results

- `git rev-parse HEAD` (`85da484`, later `ab49f0d`), `git status --porcelain` (empty at the start), `git diff --name-only 85da484 ab49f0d` (`.gitignore`, `docs/DECISIONS.md`, `docs/STATUS.md` only), `git log --graph 109dafb..HEAD`.
- `npm run typecheck`: exit 0, no output.
- `npm run build`: exit 0, 31 routes including `/ops`, `/ops/claims`, `/ops/claims/[claimId]`, `/ops/approvals`, the two job endpoints and the two refund actions.
- `npm test`: 220 tests, 219 pass, 0 fail, 1 skipped (the opt-in live KYB test).
- `npm run check:claims-and-approvals` (`corgi_test`): **55 PASS, 0 FAIL, exit 0**, matching the delegate's claim line for line, including the identity after every transition against both the fold and the journal, the three ceilings, the two simultaneous requests, the four maker-checker refusals, the changed-intent refusal, the double execution, the rail lifecycle, the queued refund, and the two F-B5-02 branches. Closing line: `every journal line in the database balances, debits against credits (debits 83010408 = credits 83010408)`.
- `npm run check:money-guards -- --database=test`: **110 PASS, 0 FAIL, exit 0**; 18 owner refusals and 18 runtime refusals on the six new tables, the six maker-checker trigger refusals, and the seven new CHECK and unique-constraint refusals.
- `npm run check:kyb-replay` (`corgi_test`): **23 PASS, 0 FAIL, exit 0**, including the five rule-14 lines quoted in the matrix.
- Trial database, read-only catalogue (owner connection, no write, no TRUNCATE probe): the 16 protected tables and their 3 triggers each, `approval_decisions_enforce_maker_checker` present, `app_runtime` holding `INSERT,SELECT` and nothing else on all 16, both new `money_operations` columns present, `schema_migrations` holding 0001 to 0008 and 0010 with `0008_claims_and_approvals.sql` recorded under its new name. I did not run the guard script against the trial database: the delegate's report of deadlocks under contention is credible, the script probes TRUNCATE guards with `TRUNCATE ... CASCADE` against a database serving the live application, and a catalogue read plus a full behavioural run on `corgi_test` answers the same question without hammering shared infrastructure.
- `npm run migrate` on the trial database: `skip` for all nine files, nothing applied.
- Throwaway database `corgi_review_b7_oqj5ujn1` created on the same Neon server, migrated 0001 to 0010 in order, second run skipped all nine, catalogue compared with the trial database (columns 196 = 196, triggers 57 = 57, constraints 275 = 275, indexes 58 = 58, `app_runtime` grants 45 = 45), `unapplied_customer_cash` present, database dropped. Yes, I did create and drop one.
- Deployed application `https://corgi-work-trial-iota.vercel.app`, revision `4decb8c`, `/api/health` 200 with the database ok. Signed in as the four demo roles through `/api/session/login`; the demo password was read from `.env.local` into a shell variable and never printed. Probes: every screen as every role, the claim creation and refusals, the reserve and bank-account refusals, the eight maker-checker probes, the changed-intent probe, the two send probes, the settle probes, the refund send and reissue refusals, both job endpoints with no header, a wrong bearer, a GET and the real secret, and the cancellation preview.
- Two adversarial probes of my own on `corgi_test`, written in the scratchpad and not committed: the rejected-refund re-issue (F-B7-01) and the split payment (F-B7-02). Both use the production functions with the restricted runtime role. Neither wrote to Stripe.
- `gitleaks git --redact` over `109dafb..HEAD` (43 commits) and over the whole history (105 commits): no leaks. `gitleaks dir --redact`: 135 findings, all inside ignored paths, none in a tracked file; `git check-ignore` confirms `.worktrees/`, `.claude/worktrees/`, `.next/`, `.env.local` and `.env.vercel.local` are all ignored.
- Independent arithmetic: the intent hash on the approvals screen recomputed with Python's `hashlib` from the four lines the screen prints, equal to the stored hash; the cancellation preview recomputed by hand (120 of 365 days, 76010 / 155190 / 3647 / 158837 / 23278), equal to the screen.

**Not executed, and why.** The full F-B7-01 path on the trial database, because completing it would have created a real refund at Stripe; the finding is proven at the last step before that call. A provider-generated `refund.failed` (Stripe test mode offers no fixture, as B5 already recorded). A `paid_not_bound` policy on the trial database, because none exists and creating one would mean deliberately breaking a broker's eligibility and paying a live Checkout Session. Two concurrent executions from two separate processes or two deployed instances; the concurrency evidence is two connections from one process, as the delegate disclosed, and the guarantees exercised are database ones. The `check:money-guards` behavioural run against the trial database, for the reason above. No legal source was consulted.

## 7. What I created on the trial database

All of it is real product data, made through the deployed screens as the demo users, with example.com identities only and amounts inside the reserve and both limits. Nothing was created at Stripe; the only Stripe traffic was two read-only refund listings caused by the reissue refusal probes.

- Claim **CLM-00212**, id `2f78c23c-17fc-4746-85dd-77f64d6db45a`, on policy **CGP-01274**, claimant "Bay Area Fabrication LLC" (the seeded demo customer), loss dated 2026-09-20 and reported 2026-09-21 (both inside the policy's cover, both in the future: see F-B7-06), description "Independent review probe (B7): synthetic loss, example.com data only", opened by `ops@example.com` at 14:54:50Z.
- One `reserve_set` claim event of $5,000 and its `claim_reserve_set` journal entry.
- Four `claimant_bank_accounts` rows, in this order: one failed (holder "Someone Else Holdings"), one verified, one verified on the second test routing number (this is the one that broke the approved intent), and one verified back on the first. All synthetic, last four digits and a token only.
- One approval request `29d3bdfa-0c23-4643-8e20-a9e615b6731c` for $1,200, asked by `ops@example.com`, approved by `approver@example.com` at 14:55:38Z with the reason "Independent review probe: within the reserve and the policy limits".
- One `claim_payout` money operation `1d70be32-8f8a-40d1-b2de-5b2f9432d881` of $1,200, sent on the LOCAL SIMULATOR rail as transfer `sim_tr_36c1b06a8b55970ea6457fa8f2b33b83`, then settled at my request through the simulator control. Two `simulator_provider_records` rows (`sent` with settlement date 2026-09-10, `settled` on 2026-09-08).
- Journal: three entries, six lines, `claim_reserve_set`, `claim_payment_sent`, `claim_payment_settled`.
- Two calls each to `/api/jobs/settle-simulated-payouts` and `/api/jobs/recover-operations` with the real secret; all four were no-ops.

The claim is left **open** with a $3,800 reserve and $1,200 paid, deliberately: it is what makes the "cancel with an open claim" preview on CGP-01274 demonstrable at the debrief. Nothing on the trial database was cancelled, refunded or voided by this review, and `unapplied_customer_cash` is still zero there.

On `corgi_test` (disposable, and the same place the committed check scripts write): the two probe fixtures described above, plus whatever the three check scripts wrote on their normal runs.

## 8. AF-01 to AF-06 for this scope

| Rule | Control and evidence | Status |
|---|---|---|
| AF-01 deployed URL | Every new screen and route exercised from outside the development session against revision `4decb8c`, with authentication and role checks enforced server-side | Supportive PASS; final-delivery gate NOT RUN |
| AF-02 no simulation presented as live | Both new rails are LOCAL SIMULATOR in the module header, in the README inventory, on the claim screen, on both rail buttons, on `/ops`, and in the approvals screen's destination line. The job endpoint even names the provider as LOCAL SIMULATOR in its JSON answer | PASS |
| AF-03 no UPDATE or DELETE on money rows | 110 guard checks on the disposable database, a catalogue read of all 16 protected tables on the trial database, and a repository grep showing the only mutations are the cache and the webhook lease | PASS |
| AF-04 sandbox only | This scope adds no provider call. `assertStripeSandbox` still runs before the refund listing and before `refunds.create`; `expireOpenCheckoutSessionsOfBroker` is only reached through `refreshBrokerKybFromStripe`, which asserts the sandbox first. The two simulators reach no network at all | PASS |
| AF-05 no committed secrets | 105 commits scanned clean; every working-tree finding is inside an ignored path; no value was inspected or printed, here or in the probes | PASS for this revision |
| AF-06 explainable code | Section 9 | Technically PASS; walkthrough NOT REVIEWED WITH YOANN |

## 9. Readability assessment, and the three places a panel will point at

The reading path in the delegate's notes is the right one and it holds: the migration, then what the numbers mean, then the entries, then the ceilings, then the two money modules, then the approvals, then the simulators. Every file opens with the business reason. Names carry units and purpose (`reserveCents`, `claimPendingCents`, `policyCommittedCents`, `intentHash`, `destinationToken`, `settlementDate`). Pure rules are separated from persistence and from the rail, so the arithmetic can be read without a database. Failure paths are named types (`ClaimRefused`, `ApprovalRefused`, `RefundSendRefused`, `RefundReissueRefused`, `BankAccountRejected`, `JobNotAuthorised`) and every one of them becomes a sentence on a screen rather than a 500. There are no client components anywhere, so no money value is computed in a browser.

Can Yoann explain the three hard parts line by line? My assessment is yes for two of them and yes with one sentence of preparation for the third.

- **The per-claim advisory lock**, `lockClaimForMoneyDecision` in `lib/claims/claims.ts`. Twelve lines of comment for one line of SQL, and the comment answers the exact question a reviewer will ask ("why not `SELECT ... FOR UPDATE`?") with a measured fact. What Yoann has to add in his own words is why it is `xact` and not a session lock: it is released when the transaction ends, however it ends.
- **The hashed intent**, `canonicalIntentText` and `intentHash` in `lib/approvals/intent.ts`, with `assertIntentIsApproved` in `lib/approvals/approvals.ts`. Four labelled lines, one hash, rebuilt from the current world before the money moves. The approvals screen prints the hashed text next to the hash, so an approver can check it; I recomputed the hash independently and it matched, which is the demonstration to do live.
- **The parked-cash path**, `unappliedCashReceivedEntry` in `lib/ledger/policy-entries.ts` and `cashWasParked` plus `collectedFrom` in `lib/payments/collection.ts`. This is the subtlest of the three, because the same four issuance entries are posted either way and only one account changes. The sentence to have ready is the one the check script proves: the cash is booked once at receipt and applied at the bind, so `unapplied_customer_cash` returns to zero and `cash_stripe` shows the money exactly once.

The three places I would expect a panel to point at are those three. If a fourth is wanted, `interpretUniqueViolation` in `lib/payments/collection.ts` is the densest function in the slice: it reads the constraint name from the Postgres error and answers "already posted" only when this operation's own `premium_collected` entry is in the journal. It is correct, and it needs its paragraph read aloud rather than summarised.

## 10. The two delegate deviations

**"A payment counts as paid when it is sent."** This is now Yoann's decision, not the delegate's: `docs/DECISIONS.md` records it at 2026-09-08T14:32:14Z, during this review, in his own words ("payé dès lundi"), with the rejected alternative named. I flag it as his call rather than ruling on it. What I can say technically: the code and the decision agree, `settledCents` is reported separately on the claim screen so nothing is hidden, `incurred = paid + reserve` holds at every instant with two terms instead of three, and a bank return puts everything back exactly where it was, which the check script proves after each transition. The one consequence worth writing into the README before submission is that `cash_claims_rail` moves only at settlement, so between sending and settling the claim shows money as paid while the rail has not confirmed it; that is the honest reading of "the money left our control at sending" and the screen shows both numbers.

**"`reserve_adjusted` carries the new outstanding reserve."** Sound, and I would keep it. An adjuster states a level, not a delta, so the event records what the human decided and the journal books the difference; both facts stay readable and the fold is an assignment rather than a running sum. It is documented at the top of the migration, in `money-position.ts` and in `claim-entries.ts`, and it is enforced at the database boundary by the CHECK that allows zero for `reserve_adjusted` and only positive amounts elsewhere. The only thing to watch is the wording on screen, which already says "from / to / booked" and is unambiguous.

## 11. Verdicts and residual limitations

**B7: FAIL** at `85da484` (unchanged at `ab49f0d`). Everything the slice set out to do is implemented and, with one exception, proven: the claim arithmetic and its identity against the journal, the three ceilings, the concurrency guarantees, the maker-checker queue with a hashed intent bound to the destination, the database trigger behind it, the two labelled simulators with their own provider-side records, the gate on the B5 refund, and the two B5 recovery corrections. The exception is F-B7-01, and it is not a gap in evidence but an observed violation of the requirement the slice exists to satisfy: the checker's rejection can be overridden by the maker, and the only function that enforces the gate is not called on that path. F-B7-02 is the same requirement weakened a second way. Both must be corrected and re-reviewed before the slice can be marked done; the correction for F-B7-01 is small (move the gate inside `issueRefundsAtStripe`) and the one for F-B7-02 is a money rule for Yoann.

**Rule 14: PASS** at `9a69fd5`. The cash is journaled the moment it exists, a redelivery cannot park it twice, the bind applies the parked amount instead of booking it again, the suspense account returns to zero, `cash_stripe` shows the money exactly once, a `paid_not_bound` policy offers no second payment, and the two disclosure lines are live on the deployed screens. I looked for the three bypasses named in the assignment and found none: a reversed parking entry correctly makes the bind book from `cash_stripe` again, because the reversal has already credited it back; a replay after the bind is answered `already_posted` because the guard now reads the `premium_collected` entry rather than any entry; and a payment on a second attempt cannot happen, because `startCheckout` returns the existing completed session rather than opening a new one. The two LOW findings (F-B7-11, and F-B7-12 which is a coordination note) do not affect the money.

Residual limitations of this review: the maker-checker bypass was proven up to the last step before Stripe rather than through it, deliberately; the concurrency evidence is two connections from one process; `paid_not_bound` was verified by code path only, because the trial database holds no such policy; `corgi_test` carries two migrations that `main` does not, so the checks there ran against a superset of the schema; and the claim I created on the trial database carries future dates, because no policy there is in force today.

Findings for the coordinator's register: F-B7-01 HIGH, F-B7-02 and F-B7-03 MEDIUM, F-B7-04 to F-B7-12 LOW. Walkthrough status: **NOT REVIEWED WITH YOANN**.

---

## 12. Re-review at `65b06be`, after the fixes

- Requested by the coordinator for F-B7-01, F-B7-02, F-B7-04 and F-B7-11, with F-B7-03 said to be closed by the B10 merge.
- Reviewer: the same independent reviewer, same rules. Read-only on the code, read-only on Stripe, nothing committed, this file is still the only one written.
- Timestamp: 2026-09-08T16:05:00Z.
- Revision reviewed: `65b06be`, read at `d7d173d` (the two later commits are documentation only). Deployed and verified at `6e8805e`, which has `65b06be` as an ancestor; `/api/health` reported it throughout. Working tree clean apart from this file.
- **Verdict for the B7 scope after the fixes: PASS.** The HIGH finding is closed, both MEDIUMs are closed, and the two LOWs in this batch are closed. One new LOW is recorded below. Prior findings and the FAIL verdict of sections 1 to 11 stay as they were: this section appends to that history rather than replacing it.
- Walkthrough status: still **NOT REVIEWED WITH YOANN**.

### 12.1 Diffs read

`lib/payments/refunds.ts`, `lib/approvals/threshold.ts`, `lib/claims/payments.ts`, `lib/policy/read.ts`, `app/policies/[policyId]/page.tsx`, `app/api/policies/[policyId]/refunds/[operationId]/reissue/route.ts`, `lib/broker/kyb-onboarding.ts`, `app/api/webhooks/stripe/route.ts`, and the 127 added lines of `scripts/check-claims-and-approvals.ts` (sections 11b and 11c). Also read, because the B10 merge moved code inside my scope: `lib/claims/settle-due-payouts.ts` (extracted from the settle job), the rewritten `app/api/jobs/settle-simulated-payouts/route.ts`, `app/api/jobs/daily/route.ts` and `vercel.json`. Nothing else of B10 was reviewed; it is not my scope.

### 12.2 F-B7-01, closed

The fix is the one I asked for and it is placed where it cannot be forgotten: `issueOneRefundAtStripe` now calls `assertRefundMaySend` before it does anything, so every caller passes the gate rather than each caller remembering to. A refusal returns `status: "refused"` and appends nothing, which is right: a gate saying no is not a provider failure and must not pollute the operation's history. Around it, three supporting changes that I checked individually: `lastFailureStage` gains `"approval"`, so a rejection is no longer read as a Stripe failure; `assertPreviousRefundIsReallyDead` is called only for a genuine `refund_lifecycle` failure, so a rejection no longer triggers a pointless Stripe listing; and `createReissuedRefundOperation` raises a fresh approval request whenever the amount is above the threshold, inside the same transaction as the operation it gates, exactly as the cancellation does.

I re-ran my own probe from section 4 against the fixed code, on `corgi_test`, and it now ends the other way:

```
3. after the REJECTION: state = failed | lastFailureStage = approval | approvalRequestId = set
4. reissueRefund on the REJECTED refund returned status: queued_for_approval
   new operation: 9d266bcd-... | amount: 371545 | approvalRequestId: SET
                | refundId: none (nothing at Stripe)
5. the new attempt is still gated: this money-out is above the approval threshold and is still
   waiting for a second person to approve it
6. calling issueRefundsAtStripe directly on it: refused | ...still waiting for a second person
   lifecycle of the new operation after that call: requested
```

Line 6 is the part that matters most: I called the Stripe-facing function directly, the way a future code path might, and it refused and appended nothing. The delegate's own new lines agree ("issueRefundsAtStripe itself refuses an above-threshold refund that carries no approval request", "that refusal is not a provider failure: nothing was appended to the operation", "a rejection is recognised as an approval-stage failure, not as a Stripe failure").

Behaviour change worth knowing: a re-issue attempt on a completed refund is now refused earlier and without asking Stripe, because the listing is reserved for lifecycle failures. Confirmed on the deployed application: `staff_ops` gets "only a failed refund can be re-issued; this one is completed", where before the same click made a Stripe call to find out. That is cheaper and no weaker.

### 12.3 F-B7-02, closed

`claimPayoutNeedsApproval` counts what the claim has already sent and not had returned, plus what is requested and still waiting, plus this payment, and compares the total with the threshold. It is used at request time and again at send time, so neither entry point is more permissive. The rule is written as Yoann's decision with its reason, and the comment says plainly why the refund path needs no equivalent (a cancellation refunds one total, computed once). Unit tests cover the boundary.

My split probe from section 4, re-run against the fixed code on `corgi_test`:

```
  60000 cents -> approval request: NONE; send: sent
  60000 cents -> approval request: created; send: not attempted
CLM-01067 events: reserve_set 500000 | payment_requested 60000 | payment_sent 60000
                  | payment_requested 60000
payment_sent total: 60000 cents | approval requests for this claim: 1
```

Before the fix the same probe put $1,200 out of one claim with zero approvals; now the second $600 waits for a checker. Proven live as well, on the deployed application: a further $10 requested on CLM-00212, which has already paid $1,200, was answered `payment=awaiting-approval`.

### 12.4 F-B7-04, closed

`refundOperationsOfPolicy` now carries `failureStage`, and the policy page words both the state and the action from it: a rejected refund reads "rejected by the approver, nothing sent" instead of "requested, not completed", the button says "Raise a new approval request for this refund" instead of "Re-issue this refund", and the banner after the action distinguishes `queued_for_approval` and `refused` from a Stripe answer. Read in the diff; not observed on a screen, because no rejected refund exists on the trial database and creating one would mean cancelling a real policy.

### 12.5 F-B7-11, closed

The expiry is now wrapped in a try/catch that records `expiryError` on the outcome instead of throwing, and the webhook route reports it in the processing reason. A committed KYB transition therefore stays a successful delivery, and the operator is told in words that the payment pages were not closed. The comment states the fallback correctly: a page left open is caught by rule 14 at payment time anyway.

### 12.6 F-B7-03, closed, with one honest reduction

I agree it is closed. `vercel.json` now declares a daily cron on `/api/jobs/daily`, and that endpoint runs all three pieces of recurring work in a defensible order: recovery, then settlement, then reconciliation, with the reason for the order written above it. It accepts GET as well as POST, which is what Vercel Cron sends, and I confirmed the GET path is authorised the same way (no header 401, wrong bearer 401). The settle work was extracted to `lib/claims/settle-due-payouts.ts` so the standalone endpoint and the daily job run the same code; I read the extraction line by line and it is faithful, including the idempotency argument, and the standalone endpoint still answers correctly (`dueCount 0` with nothing due).

The reduction: the Run now button on `/ops/reconciliation` posts to `/api/jobs/reconcile` only. Settlement and recovery have no button, so between two cron runs they can only be driven with the cron secret from a terminal. At a demo, a due settlement still has to be brought forward with the LOCAL SIMULATOR control on the claim screen. That is a smaller thing than the finding I raised and I am not reopening it; it is worth one line in the README so nobody expects a button that is not there.

### 12.7 New finding

| ID | Sev | Finding (one line) |
|---|---|---|
| F-B7-13 | LOW | A claim payment that was legitimately below the threshold when it was requested can no longer be sent while a second request is waiting on the same claim, and the only way to release it is to have that second request rejected |

A consequence of the cumulative rule, and it fails closed, which is the right direction. Reproduced on `corgi_test`: request $600 (no approval, correctly), request another $600 (approval raised, correctly), then send the first one, which is refused with "this payment would take the claim above the approval threshold but carries no approval request". The order I used in section 12.3, sending the first before requesting the second, has no such problem. The recovery exists (reject the waiting request and the first becomes sendable again) but it is not obvious from the screen. Either say so in the refusal message, or let the send raise its own approval request instead of refusing. Not a money defect: nothing goes out unapproved either way.

### 12.8 Checks executed in this re-review

- `npm run typecheck`: exit 0. `npm test`: 276 tests, 275 pass, 0 fail, 1 skipped.
- `npm run check:claims-and-approvals` (`corgi_test`): **63 PASS, 0 FAIL, exit 0** (55 before). The eight added lines are exactly the two findings, including "a first $600 on a claim goes without an approver", "a second $600 on the same claim needs an approver: the claim would reach $1,200", "issueRefundsAtStripe itself refuses an above-threshold refund that carries no approval request", "that refusal is not a provider failure: nothing was appended to the operation", and "re-issuing an above-threshold refund raises a NEW approval request on the new operation". Closing line: debits 185829202 equal credits 185829202.
- `npm run check:refund-replay` (`corgi_test`): **27 PASS, 0 FAIL, exit 0**, unchanged, so the gate added inside `issueOneRefundAtStripe` breaks none of the B5 refund behaviour: the re-issued refund still completes and still clears the liability exactly once.
- My own two adversarial probes from the first review, re-run unchanged in shape against the fixed code, plus a third for the ordering case of F-B7-13. Neither wrote to Stripe.
- `npm run check:money-guards -- --database=test`: **126 PASS, 2 FAIL, exit 1**, twice. Both failures are `owner cannot TRUNCATE claims` and `owner cannot TRUNCATE approval_requests`, both reporting `deadlock detected`. I did not treat that as a product failure and I did not treat it as a pass either. `pg_stat_activity` on `corgi_test` showed four and then seven other sessions, one of them blocked on `truncate "policies" cascade` and two idle in transaction holding locks: another agent is running checks on the shared disposable database at the same time, which is exactly the contention the B7 delegate described for the trial database. I waited for a quiet window, did not get one, and stopped rather than keep hammering it. I then proved the two guards in isolation instead, on a throwaway database created and dropped for the purpose: `truncate claims cascade` and `truncate approval_requests cascade` are both refused by their trigger, as are the four other new tables. Taken together with the 12 owner UPDATE and DELETE passes, the 4 clean TRUNCATE passes and the 18 `app_runtime` passes in the same run, AF-03 coverage on the six B7 tables is complete. The fix commit touches no migration and no trigger, so no regression was possible here in any case.
- Deployed application at `6e8805e`: the reissue route on a completed refund, the further $10 on CLM-00212 (queued, as the fix requires), the rejection of that request by the approver, and the authorisation of the daily endpoint on GET.

### 12.9 What this re-review added to the trial database

One `payment_requested` claim event of $10 on CLM-00212 and its `claim_payout` money operation, one approval request `b6519f0c-7d96-4e80-b30a-0d51498dcd18` raised by `ops@example.com`, and its rejection by `approver@example.com` with the reason "Independent re-review probe: raised only to prove the per-claim threshold; not needed". I raised it to prove the per-claim threshold on the deployed application and rejected it to leave the claim where it was.

Nothing moved: the rejection posted no journal entry, the claim still holds three entries, the pending total on the claim is back to zero, the global journal is unchanged at 51 lines with debits 3277535 equal to credits 3277535, and CLM-00212 is still open with a $3,800 reserve and $1,200 paid. The audit trail of the probe stays visible, which is the point of an append-only ledger. On `corgi_test`, three more probe fixtures.

### 12.10 What is still not verified

The rejected-refund wording and the new button label were read in the diff, not seen on a screen: no rejected refund exists on the trial database and making one would mean cancelling a real policy. The `expiryError` path was read, not triggered, because forcing a Stripe error on the expiry call would mean breaking a broker's eligibility against the real sandbox. The daily cron has not yet fired at 06:00 UTC, so it is a declaration in `vercel.json` and a working endpoint rather than an observed scheduled run. The two TRUNCATE guards were proven in isolation rather than in the shared guard run, for the reason given above. A `paid_not_bound` policy is still unverified live, unchanged from section 6.

**Verdict, B7 scope at `65b06be`: PASS.** F-B7-01, F-B7-02, F-B7-03, F-B7-04 and F-B7-11 are closed; F-B7-05 to F-B7-10 and F-B7-12 remain open as recorded, all LOW; F-B7-13 is new and LOW. **Rule 14 stays PASS**, now with F-B7-11 closed. Walkthrough status: **NOT REVIEWED WITH YOANN**.
