# Implementation review: slice B4 (endorsements, delta collection and refund, as-of documents)

- **Scope**: slice B4 as merged at `dfdca38` (`Merge branch 'worktree-agent-ace13549089ca5fe0'`): mid-term endorsement with a pro-rata delta, customer approval above $500 bound to a quote hash, collection of a positive delta through Stripe Checkout, immediate refund of a negative delta through the Stripe Refunds API with maker-checker above $1,000, cancellation of an endorsed policy segment by segment (decision 18), the policy as of any date, and the two PDF documents. Files read line by line: `db/migrations/0009_endorsements.sql`, `lib/money/endorsement.ts` and `endorsement.test.ts`, `lib/money/premium.ts` (`earnedPremiumOfSegment`, `earnedPremiumAcrossSegments`, `cancellationBreakdown`, `endorsementDeltaCents`) and `premium.test.ts`, `lib/money/dates.ts`, `lib/money/idempotency.ts`, `lib/policy/endorse.ts`, `endorsement-requests.ts`, `endorsement-read.ts`, `current.ts` and `current.test.ts`, `cancel.ts` (diff since B5), `read.ts`, `lib/payments/endorsement-collection.ts`, `checkout.ts` and `collection.ts` (diffs), `lib/payments/refunds.ts` (the send gate), `lib/approvals/threshold.ts`, `lib/ledger/endorsement-entries.ts` and its test, `lib/ledger/policy-entries.ts` (diff), `lib/documents/from-database.ts` and `policy-as-of.ts`, `app/policies/[policyId]/endorse/page.tsx`, `app/policies/[policyId]/page.tsx`, `app/policies/[policyId]/endorsements/[requestEventId]/approve/page.tsx`, `app/customer/page.tsx`, the four route handlers under `app/api/policies/[policyId]/endorsements`, `app/api/policies/[policyId]/documents/[document]/route.ts`, `app/api/webhooks/stripe/route.ts` (diff), `app/api/session/login/route.ts`, `scripts/check-endorsement-replay.ts`, `scripts/check-money-guards.ts` (new lines), `scripts/migrate.ts`.
- **Reviewer**: independent reviewer sub-agent. Wrote no code, delegated to nobody, and wrote no file in the repository except this one.
- **Timestamp**: 2026-09-08T16:45:00Z (review started 16:05Z).
- **Revision reviewed**: `dfdca38` (the B4 merge). Working tree clean at `17f0afa` (a docs-only commit on top: decision 18 and the B4 register rows). Production reported `dfdca38` at `/api/health` before the HTTP work started, so the deployed screens below are this revision.
- **Walkthrough status**: `NOT REVIEWED WITH YOANN`.

## 1. Startup receipt

Read in full, in this order, before any check: `CLAUDE.md`, `AUTOMATIC-FAILS.md`, `READABLE-CODE.md`, `AGENTS.md`, `WORKFLOW-48H.md`, `REVIEWER.md`, `docs/ARCHITECTURE.md` (nine sections including 3.x), `docs/DECISIONS.md` (every entry, decisions 14 to 18 included), `docs/reviews/FINDINGS.md`, `docs/STATUS.md`, `docs/handoffs/b4-implementation-notes.md` (all nine sections), `README.md` (deployment, credentials and integration inventory rows).

Read by targeted section rather than end to end: `docs/reviews/b2-issuance-and-collection.md` and `docs/reviews/b5-cancellation-and-refund.md` (scope, findings and the refund and webhook sections that B4 extends). Not read: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`, `GAP-REVIEW.md`, `docs/COMPLIANCE-MATRIX.md`, `docs/PLAN.md` (advisory or outside this scope). Absent files: none of the mandatory files were missing.

Acceptance criterion under review: `docs/PLAN.md` row B4, plus the part of row B12 (impact preview and explanation) that this slice delivers for endorsements. Planned checks, all executed: read the migration and the money code line by line, reproduce the recited arithmetic independently of the repository, run `npm test`, `npm run typecheck`, `npm run check:endorsement-replay`, `npm run check:money-guards -- --database=test`, migrate a throwaway database from `0001` to `0011`, run `gitleaks` on the merged range and the working tree, and exercise the screens, the documents and the refusals over HTTP on the deployed application.

## 2. Applicability

Confirmed facts: US commercial general liability, one modelled state (California, premium tax 2.35 percent, decision of 2026-09-08T09:29Z), synthetic brokers, customers and policies, Stripe test mode for both live slots, no real money and no real personal data. The parties printed on the PDFs generated over HTTP are the seeded synthetic ones (Sierra Roofing Co, Santa CaFE, Bay Area Fabrication LLC) and the address block states that no mailing address is collected instead of inventing one.

Requirements applied to this scope: the six automatic fails, and from `AGENTS.md` the financial invariants (integer cents, append-only journal, idempotency keys bound to the business intent, database transactions and unique constraints), the webhook contract (authenticity, deduplication, atomic completion), and maker-checker (queue above-threshold money out before any provider side effect, a distinct human approver, the same gate on every path). Assumptions of this build, not regulatory facts, and labelled as such in the code: the $500 customer-approval threshold, the $1,000 money-out threshold, the $25 flat fee. No legal interpretation is asserted by this review.

## 3. The money rules, reproduced

I recomputed every figure of the assignment with arithmetic written from scratch, without importing any repository code, before comparing it with the tests.

| Quantity | Formula | Cents |
|---|---|---|
| Term 2028-03-01 to 2029-03-01 | actual days | 365 |
| Day 100 | calendar | 2028-06-09, 265 days remain |
| Raise to $1,800, delta premium | `floor(60000 x 265 / 365)` | 43561 |
| Delta tax | `floor(43561 x 235 / 10000)` | 1023 |
| Same change backdated 30 days | `floor(60000 x 295 / 365)` | 48493 |
| Lower to $600, premium refunded | `ceil(60000 x 265 / 365)` | 43562 |
| Tax refunded | `ceil(43562 x 235 / 10000)` | 1024 |
| Commission on the collected delta | `floor(43561 x 1500 / 10000)` | 6534 |
| Cancellation 2028-09-01, issuance segment earned | `floor(120000 x 184 / 365)` | 60493 |
| Endorsement segment earned | `floor(43561 x 84 / 265)` | 13808 |
| Written, earned, unearned | 163561, 74301 | 89260 |
| Tax back | `ceil(89260 x 235 / 10000)`, cap 3843 not binding | 2098 |
| Commission clawback | `floor(89260 x 1500 / 10000)` | 13389 |

Every one of these matches the code and the tests. The direction of each rounding is right: a customer charge is floored, a customer refund is ceiled, the commission is floored in both directions, and the tax refund is capped at the premium tax the ledger still holds for the policy rather than at the tax on the annual premium in force. `earnedPremiumOfSegment` writes out its own floor division instead of relying on BigInt truncation, so a negative segment rounds down rather than towards zero, which keeps the unearned figure on the customer's side on both signs. The flat fee is `deltaFeeCents: 0` by type, so it cannot be charged again.

The tax cap is read from the ledger (`premiumTaxStillHeldForPolicy`, the credit balance of `premium_tax_payable` over the policy's entries) in both `lib/policy/endorse.ts` and `lib/policy/cancel.ts`. That is the correct source: after an endorsement, the tax collected and the tax on the premium in force are different figures, and only the first one is money.

The four collection entries and the single refund entry balance and are keyed on the money operation, never on the webhook event, so the two Stripe events that describe one collection post once.

## 4. Requirement matrix

| Requirement | Control and code location | Evidence | Verdict |
|---|---|---|---|
| Pro-rata delta priced from the effective date, not from today | `computeEndorsement`, `endorsementDeltaCents` | recomputed above; `check:endorsement-replay` lines 1 and 3; deployed preview shows `floor(68800 x 351 / 365)` | PASS |
| One pure function prices preview, approval, execution and explanation | `lib/money/endorsement.ts`, read by the four screens and by `applyEndorsement` | code read; no `use client` anywhere under `app/policies` or `app/customer`, so no money is computed in the browser | PASS |
| Approval above $500 bound to a quote hash of six facts | `endorsementQuoteHash`, `requireLiveRequest` recomputes and compares twice | replay lines "an approval carrying another quote's hash is refused", "after a second request, paying the first quote is refused as superseded" | PASS |
| Only the policy's customer approves | `approveEndorsement` reads `customerId` from the session | replay lines for the broker and for another policy's customer; HTTP 303 refusals on the deployed app | PASS |
| One approval and one application per request are database facts | two partial unique indexes in `0009` | `check:money-guards` "an endorsement request cannot be applied twice"; both indexes present on all three databases | PASS |
| Delta collected under `endorsement-checkout:<event>[:attempt]` | `endorsementCheckoutIdempotencyKey`, operation and link row committed before Stripe | replay "one delta operation exists, keyed on the request event"; "a new Pay click opens a SECOND session under its own key" | PASS |
| Entries posted only on `payment_intent.succeeded`, twice is once | `postDeltaAndApply` in one transaction, journal unique key plus the `endorsed` index | replay "the first delivery applies the endorsement, the second is already posted"; "exactly four endorsement entries exist, one of each type" | PASS |
| Amount checked against the operation | `link.amountCents !== payment.amountReceivedCents` | replay "a delta payment for another amount is refused, not journaled" | PASS with F-B4-11 |
| The issuance path cannot post a delta operation | `operation.endorsementRequestEventId` guard in `collection.ts` | replay "the issuance path refuses a delta operation" | PASS |
| Rule 14 parking when the endorsement cannot be applied | `parkPaymentWithoutApplying`, `cashWasParked` flips `collectedFrom` | replay: parked once, applied later, suspense back to zero, cash booked once | PASS for the two covered cases, F-B4-05 for the third |
| `checkout.session.expired` kills the attempt | `recordExpiredEndorsementCheckout`, refuses when entries exist | replay "checkout.session.expired is recorded on the delta operation, no entry posted" | PASS |
| Negative delta refunded through B5, failed refund posts nothing | `openRefundsForReduction`, `lib/payments/refunds.ts` unchanged | replay "the completed refund delivered twice posts once", "a failed endorsement refund posts NO journal entry" | PASS |
| Money out above $1,000 waits for a distinct approver | approval request written in the same transaction, gate inside `issueRefundsAtStripe` | replay: initiator refused, `staff_ops` refused, distinct `staff_approver` accepted | PASS for one endorsement, FAIL across several: F-B4-04 |
| Cancellation of an endorsed policy, segment by segment | `writtenPremiumSegments` from the fold, `cancellationBreakdown` | replay "163561 written, 74301 earned, 89260 given back"; tax cap 3843 read from the ledger | PASS |
| The fold skips superseded events and applies endorsements | `applyPolicyEvents`, `foldPolicyEvents` in `policy-as-of.ts` | ran the production fold on a real endorsed policy at five dates: $1,200 and $1M limits on 2028-06-08, $1,800 and $2M from 2028-06-09 | PASS |
| Two PDFs from that fold with `?asOf=` | `render.tsx` through `@react-pdf/renderer`, seeded synthetic names | six real PDFs fetched from production, text extracted, before issuance 404, in force, after cancellation | PASS |
| AF-03: no UPDATE or DELETE on money rows | grep of every file in the slice; the only mutation is the `policy_current` upsert, the declared cache | `check:money-guards` 136 PASS, 0 FAIL on the coordinator's ephemeral database, including the eight `endorsement_collections` guards, which also passed in my own shared run | PASS |
| AF-03: every external money event journaled | rule 14 parking | a delta paid on a cancelled policy is journaled nowhere | FAIL: F-B4-05 |
| AF-04: sandbox only | `assertStripeSandbox()` before every Stripe call in the slice; `livemode` refused at the webhook | code read; the replay script refuses any database but `corgi_test` | PASS |
| AF-05: no secrets committed | `gitleaks` on `6d4120e..dfdca38` | 7 commits scanned, no leaks; only `.env.example` is tracked | PASS |
| AF-01: deployed and exercised | screens and documents over HTTP | preview, refusals and both PDFs work; no endorsement has ever run on the deployed app | BLOCKED: F-B4-06 |

## 5. Findings

| ID | Sev | Finding (one line) |
|---|---|---|
| F-B4-04 | MEDIUM | The money-out threshold is read per endorsement, so repeated sub-$1,000 premium reductions on one policy send refund after refund to Stripe with no second approver. |
| F-B4-05 | MEDIUM | A delta paid after the policy is cancelled or voided is refused and journaled nowhere, so Stripe holds cash the ledger does not record, and cancellation does not expire the open hosted page. |
| F-B4-06 | MEDIUM | No endorsement exists on the deployed application, and the only bound policy there belongs to a customer with no user account, so the approval leg above $500 cannot be shown over HTTP with the demo credentials. |
| F-B4-07 | LOW | `endorsement_collections.quote_hash` is written and never read, while migration `0009` describes it as recomputed and compared at posting time. |
| F-B4-08 | LOW | The checkout gate trusts `customer_approval_required` as stored on the request instead of re-deriving it from the delta, and that flag is not one of the six facts the quote hash covers. |
| F-B4-09 | LOW | The $500 customer-approval threshold is per endorsement, so two sub-$500 raises collect more than $500 without any approval event. |
| F-B4-10 | LOW | Two simultaneous Approve clicks, or two simultaneous Pay clicks, hit a unique index and return HTTP 500 instead of a plain refusal. |
| F-B4-11 | LOW | A delta whose amount does not match the operation is refused and not journaled, so Stripe cash exceeds ledger cash until reconciliation names the break. |
| F-B4-12 | LOW | `postDeltaAndApply` does not take the policy advisory lock that `recordEndorsementRequest` takes, so a request committed in between could be superseded and still applied. |

### F-B4-04 (MEDIUM): the money-out threshold can be split across endorsements

**Trigger.** The owning broker reduces the annual premium of their own bound policy several times in a row, each reduction refunding less than $1,000. `planEndorsement` sets `refundNeedsApproval = figures.direction === "refund" && moneyOutNeedsApproval(-figures.deltaTotalCents)`, which looks at this endorsement alone, and the gate inside `issueRefundsAtStripe` re-derives the same rule per operation (`assertRefundMaySend`, `moneyOutNeedsApproval(operation.amountCents)`). Nothing counts what the policy has already refunded. An endorsement cannot be backdated before the one in force, but nothing stops several reductions on the same effective date, so this needs no race and no unusual state.

**Consequence.** Money leaves for Stripe in sub-threshold slices with no distinct approver, which is the control `AGENTS.md` states as a general non-negotiable and which review finding F-B7-02 closed for claims when Yoann decided the threshold is cumulative per claim (decision of 2026-09-08T15:34Z). The comment in `lib/approvals/threshold.ts` justifies the omission with "The refund path has no equivalent rule because a cancellation refunds one total, computed once", which was true when it was written and stopped being true when this slice added a repeatable money-out path.

**Mitigation that limits it, and does not remove it.** A Stripe refund can only go back to the PaymentIntent that paid, so the money returns to the payer's own card and not to a destination the initiator chooses, and the total is bounded by what the policy collected. That is why this is MEDIUM and not HIGH.

**Required correction.** Apply the shape of `claimPayoutNeedsApproval` to policy refunds: count what the policy has already refunded and what is waiting, add this one, and compare against the threshold, at the request and again inside `issueRefundsAtStripe`. Alternatively, record an explicit decision from Yoann that the endorsement refund threshold stays per endorsement, with the reason.

### F-B4-05 (MEDIUM): a delta paid on a cancelled policy is journaled nowhere

**Trigger.** A broker requests a raise, the customer approves, the hosted page opens and stays valid for 24 hours. The policy is then cancelled. The customer pays the open page. `recordSuccessfulEndorsementPayment` folds the events, sees `cancelled`, and returns `{ kind: "refused" }`; `app/api/webhooks/stripe/route.ts` turns that into `status: "ignored"` and answers 200. No journal entry is posted, and no parking entry either. `recordCancellation` does not expire the policy's open endorsement Checkout Sessions: `expireOpenEndorsementCheckouts` is called only from `recordEndorsementRequest`, and the only other place that expires a session at Stripe is the void path in `lib/payments/checkout.ts`.

**Consequence.** Real money sits at Stripe with nothing in the ledger, against `AUTOMATIC-FAILS.md` AF-03 ("Every external money event must be reflected in the journal") and against the invariant `ARCHITECTURE.md` section 3.x states for rule 14 ("Ledger cash equals Stripe cash at every instant"). It is also invisible on every screen: there is no operations view of ignored or failed webhook events yet (F-B2-02, open for B13), so nothing lists it. The B10 reconciliation would eventually classify the PaymentIntent as a break, which is a genuine safety net but a slow and manual one.

**Required correction.** Two small changes, either of which shrinks the hole and both of which close it: expire the policy's open endorsement Checkout Sessions inside `recordCancellation`, exactly as the void path already does for the issuance session; and park the cash with `parkPaymentWithoutApplying` in the cancelled and voided branch instead of returning `refused`, which is the same code, the same account and the same entry type already used for the other two cases. The refund of parked money is already tracked as F-B4-01.

### F-B4-06 (MEDIUM): the endorsement path has never run on the deployed application

**Trigger.** The trial database holds three policies. `CGP-01061` is voided, `CGP-01062` is cancelled, and `CGP-01274` is the only bound one. No `endorsed`, `endorsement_requested` or `endorsement_approved` event exists on any of them, and `endorsement_collections` is empty. `CGP-01274` belongs to the customer `customer-33a18c4d@example.com`, which has no row in `users`, while the demo customer `customer@example.com` owns only the voided `CGP-01061`, which cannot be endorsed.

**Consequence.** The customer approval screen above $500, the delta collection, the schedule with a row in it and the explanation block cannot be reached over HTTP with the credentials the README hands over, and no as-of document on the deployed app can show a premium change between two dates. This is the last gap the delegate named in its open item 2, and it is larger than the note suggests: creating the request is not enough, because nobody can sign in to approve it. I deliberately did not create a request that would sit awaiting an approval nobody can give on the one bound demo policy.

**Required correction.** Attach a demo user to the customer of a bound policy, or bind a fresh policy for `customer@example.com`, then run one endorsement end to end on the deployed application: raise above $500, approve as the customer, pay the delta with a test card, and let the webhook apply it. One reduction below $1,000 afterwards shows a real Stripe refund of a delta.

### The LOW findings, in one paragraph each

**F-B4-07.** `endorsement_collections.quote_hash` is inserted by `createEndorsementCheckoutOperation` and read by nothing (`grep` over `app`, `lib`, `db` and `scripts` returns only the writes). The comment above the column in `0009` says "Recomputed and compared at posting time, so a payment can never apply figures the customer did not approve". The protection is real but it comes from somewhere else: the link row names `request_event_id`, and `requireLiveRequest` recomputes the hash from the stored figures at checkout time. Fix the comment, or compare the column at posting time and make the comment true. This matters for AF-06: Yoann would otherwise defend a control that does not exist.

**F-B4-08.** `startEndorsementCheckout` decides whether the customer had to approve by reading `request.figures.customerApprovalRequired`, which comes from the stored payload, and `endorsementQuoteHash` covers six facts that do not include it. The row is append-only and only the server writes it, so this is defence in depth rather than a live hole, but re-deriving `deltaTotalCents > CUSTOMER_APPROVAL_THRESHOLD_CENTS` at the gate costs one comparison and removes the question.

**F-B4-09.** The customer approval threshold is per endorsement, so two raises of $400 each collect $800 with no `endorsement_approved` event. The customer still has to enter card details on a hosted page for each, so consent is not bypassed, but the recorded approval trail is. Worth one sentence of disclosure or a cumulative rule, consistent with whatever is decided for F-B4-04.

**F-B4-10.** `approveEndorsement` reads the standing and then inserts; two simultaneous submissions race, the loser hits `policy_events_one_approval_per_request`, and the route rethrows anything that is not `EndorsementRefused`, so the customer sees a 500. The same holds for two simultaneous Pay clicks against `money_operations.idempotency_key`. Nothing is double posted, which is the important part. This is the same class as the tracked F-B2-L item on the first Pay click, now on two more routes.

**F-B4-11.** When Stripe collected an amount that is not the operation's amount, `recordSuccessfulEndorsementPayment` returns `refused` and nothing is journaled, so the ledger again holds less than Stripe. Same shape as F-B4-05 and as the amount-mismatch item already tracked in F-B2-L for the issuance. Reconciliation is the only thing that names it.

**F-B4-12.** `recordEndorsementRequest` takes `pg_advisory_xact_lock(hashtext(policy_id))`, but `postDeltaAndApply` does not. Between the standing check and the `endorsed` insert, a new request could commit and supersede the quote, and the payment would still apply it. The window is short and `expireOpenEndorsementCheckouts` closes most of it by refusing a new request while a completed session is unprocessed, but taking the same lock in the posting transaction would close it outright.

## 6. Checks actually executed, with results

| Check | Command | Result |
|---|---|---|
| Unit and pure-function tests | `npm test` | 313 tests, 312 pass, 0 fail, 1 skipped (B3's live KYB test) |
| Types | `npm run typecheck` | exit 0, no output |
| Endorsement replay, disposable database | `npm run check:endorsement-replay` | 69 PASS, 0 FAIL, exit 0. Every line of the expected 69 is present |
| Money guards, ephemeral database (coordinator evidence) | `npm run check:money-guards` on a database created for the run on the same Neon server, migrated `0001` to `0011` in order with the runtime role, then dropped | **136 PASS, 0 FAIL at 16:22Z**, recorded by the coordinator in `docs/STATUS.md`. This is the authoritative result for this slice: it is the only run free of the contention described below |
| Money guards, shared disposable database (my own run, corroborating) | `npm run check:money-guards -- --database=test` | 133 PASS, 3 FAIL, exit 1, run twice. The three failures are `deadlock detected` on the TRUNCATE probes for `brokers`, `claims` and `approval_requests`, none of them a B4 table. 133 plus 3 is exactly the coordinator's 136, so the same checks ran and only the three that deadlock under load differ. Contention, not a defect: five agents share `corgi_test`, and Postgres takes ACCESS EXCLUSIVE locks on every cascaded table before the BEFORE TRUNCATE trigger can speak. Not rerun again, on the coordinator's instruction |
| The eight B4 guard lines, read from the code | `scripts/check-money-guards.ts` and `db/migrations/0009_endorsements.sql` | `endorsement_collections` is in `PROTECTED_TABLES`, which generates six probes (owner UPDATE, DELETE and TRUNCATE; `app_runtime` lacks UPDATE, DELETE and TRUNCATE), and the script adds two explicit ones (the premium plus tax split CHECK, and one application per request). The migration declares the matching three triggers and grants `select, insert` only. All eight passed in my own run as well, and I read the grant back on a fresh database: `INSERT, SELECT` and nothing else |
| Arithmetic, independent of the repository | node script written from scratch | every figure of section 3 reproduced |
| Migration order on a fresh database | created `corgi_review_b4_tmp` on the same Neon server, ran the migration runner, then dropped it | `0001` to `0011` applied in file order, `0009` before `0010`. Final constraints identical to both existing databases. Database dropped, nothing left behind |
| Migration order on the existing databases | read `schema_migrations` | trial: `0009` applied at 15:58Z, after `0010` (13:34Z) and `0011` (15:14Z). Disposable: `0009` at 13:07Z, before `0010` (13:26Z). Both orders exercised, both give the same schema. F-B7-12 closed |
| `0009` independence | read every migration that touches `policy_current_status_check` and `policy_events_event_type_check` | `0009` touches only the policy event type list, and no other migration touches that constraint; it does not touch the `policy_current` CHECK, does not read `0008`'s columns, and its `create role` is guarded by `if not exists` |
| Secret scan, merged range | `gitleaks detect --log-opts 6d4120e..dfdca38` | 7 commits scanned, no leaks found |
| Secret scan, working tree | `gitleaks detect --no-git` | 183 hits, every one under `.claude/worktrees`, `.worktrees`, `.next` or a `.env` file, all git-ignored and untracked. Only `.env.example` is tracked |
| AF-03 grep over the slice | `grep` for UPDATE, DELETE, TRUNCATE in every B4 file | the only mutation is the `policy_current` upsert, which is the declared rebuildable cache |
| As-of fold on real rows | ran `documentEventsFromRows` plus `foldPolicyEvents` against an endorsed policy on the disposable database, read only | 2028-03-01 and 2028-06-08 give $1,200 with $1M and $2M limits; 2028-06-09 onwards give $1,800 with $2M and $4M, and list the endorsement with its 43561 delta |

### Over HTTP on the deployed application at `dfdca38`

Signed in with the README demo users, password taken from `.env.local` and never printed.

| What | Result |
|---|---|
| `/api/health` | `ok`, database `ok`, revision `dfdca38` |
| Policy page of `CGP-01274` as the owning broker | 200, terms in force, both document forms, the endorsement form, the schedule saying no endorsement is in force, the claim and the journal |
| Endorsement preview, raise to $3,000 effective 2026-10-01 | 200. Printed `floor(68800 x 351 / 365)` giving $661.61, tax `floor(66161 x 235 / 10000)` giving $15.54, total $677.15, commission `floor(66161 x 1500 / 10000)` giving $99.24, and the sentence that the amount is above $500 so the customer must approve. Every figure matches an independent recomputation. Nothing was written |
| Same preview as the customer, and as `staff_approver` | 200 with the refusal "only the broker who owns this policy, or staff operations, can endorse it" and nothing else on the page |
| Confirm with a well-formed but wrong quote hash | 303 to the policy page with "this quote is out of date: the policy changed since the preview was computed" |
| Confirm as the customer | 303 with "only the broker who owns this policy, or staff operations, can endorse it" |
| Confirm with no session | 303 to `/login` |
| Checkout route as the customer, and as `staff_ops` | 303 with "only the owning broker can pay an endorsement delta" |
| Checkout route as the owning broker, unknown request id | 303 with "this endorsement request does not exist on this policy", refused before any Stripe call |
| Apply route as the broker | 303 with "only staff operations can apply an endorsement after a refused application" |
| Approve route as the broker, and as another policy's customer | 303 with "only the customer of this policy can approve an endorsement" |
| Declarations PDF, `asOf` before the issuance | HTTP 404, `no issued policy event effective on or before 2026-09-16` |
| Declarations PDF, `CGP-01062` at 2026-10-15 and 2026-11-01 | two real PDFs, `In force` on the first and `Cancelled, effective October 31, 2026` on the second, same figures and same term |
| Endorsement schedule PDF | real PDF, "No endorsement had taken effect on December 1, 2026", annual premium in force printed |
| `asOf=2026-13-40` | HTTP 400 with the reason |
| Unknown document name | HTTP 404 |
| Document of another customer's policy | HTTP 403, "this policy is not yours to read" |
| Document with no session | HTTP 401, "sign in first" |
| Customer page as `customer@example.com` | 200, lists only that customer's own policy, queried by the session customer id |

## 7. Checks not executed, and why

- **No live Stripe collection or refund of a delta on the deployed application.** Not possible with the current demo data (F-B4-06), and paying was outside the assignment.
- **No Checkout Session created.** The assignment stopped at the preview, so `startEndorsementCheckout` was exercised only through its refusal paths over HTTP and through the replay script on the disposable database.
- **`npm run build`** was not rerun. `typecheck` passed and the deployed revision is the merged one, which is the same evidence at a coarser grain.
- **`check:money-guards` against the trial database** was not run, as instructed: its TRUNCATE probes deadlock against the live application.
- **The three TRUNCATE probes that deadlocked in my own shared run** (`brokers`, `claims`, `approval_requests`) were not reproven by me. The coordinator instructed me not to rerun the script on the shared database and to cite its ephemeral run instead, where all 136 checks passed. I accept that as the result and note that it is the coordinator's evidence rather than mine; none of the three is a B4 table.
- **The B10 reconciliation classification** of an unjournaled delta payment (the safety net named in F-B4-05) was reasoned from the architecture and the code, not executed.
- **Yoann's understanding** is not assessed here and cannot be: see section 9.

## 8. What I created or changed

- **On the trial database: nothing.** No policy event, no money operation, no journal entry, no approval. Every write path was exercised only through refusals, which write nothing. I deliberately did not create the one endorsement request the assignment permitted, because the customer of the only bound policy has no login and the request would have sat awaiting an approval nobody can give, on the single bound policy the demo uses. F-B4-06 records that as a finding instead.
- **On the Stripe sandbox: nothing.** No session, no payment, no refund. The endorsement replay script created two test-mode Checkout Sessions and one payment-intent lookup as part of its normal run; no money moved.
- **On the disposable database `corgi_test`:** the rows that `check:endorsement-replay` and `check:money-guards` commit as part of their normal run, plus read-only queries.
- **On the Neon server:** created the database `corgi_review_b4_tmp`, migrated it from `0001` to `0011`, verified its schema, and dropped it. Nothing remains.
- **In the repository:** this file only. Working tree clean apart from it.

## 9. Readability and candidate ownership (AF-06)

The reading path the delegate wrote in section 2 of its notes is accurate and short, and it is the right order. The money lives in one pure function with the recited example written above it, the journal entries live in one pure function with the same example, and the screens print the formula behind each figure rather than a number. The strongest single design choice is that the preview, the customer's approval screen, the execution and the explanation all call `computeEndorsement`, so a screen cannot promise a figure the ledger will not book.

Three places the panel will point at, and what Yoann has to be able to say:

1. **The quote hash.** `endorsementQuoteHash` in `lib/money/endorsement.ts`: SHA-256 over policy id, policy version, effective date, new annual premium, delta premium and delta tax, joined by a character none of them can contain. The policy version is `appliedEventCount` from the fold, so any later event on the policy moves it. `requireLiveRequest` in `lib/policy/endorse.ts` checks it twice: it recomputes the hash from the stored figures, which catches a tampered payload, and it compares the hash on the form, which catches a stale screen.
2. **The segments in the fold.** The `endorsed` branch of `applyPolicyEvents` in `lib/policy/current.ts` pushes one segment per applied endorsement, carrying the prorated delta and starting on that endorsement's own effective date, and `earnedPremiumOfSegment` plus `cancellationBreakdown` in `lib/money/premium.ts` add them up. The sentence to have ready is the one in the delegate's notes: the written premium of the example is 163561, not the 180000 annual premium in force, and that is the whole reason segments exist.
3. **The parked delta.** `parkPaymentWithoutApplying` in `lib/payments/endorsement-collection.ts` posts `unapplied_cash_received` through `unappliedCashReceivedEntry`, and `cashWasParked` later flips `collectedFrom` to `unapplied_customer_cash` inside `postDeltaAndApply`, so applying the delta clears the suspense account instead of booking the cash twice. Yoann should also be able to say what F-B4-05 says: the third refusal case does not park, and why that is wrong.

Three things make the explanation harder than it needs to be, and none of them is a correctness defect. `lib/policy/endorse.ts` is 692 lines and `lib/payments/endorsement-collection.ts` is 641; both are coherent but each holds several jobs, so "read this file" is a long instruction. `endorsementRequestStanding` decides what superseded a request by comparing array elements by object identity (`event !== approval && event !== application`), which is correct and quietly clever, and needs one sentence of explanation that the code does not give. And the dead `quote_hash` column of F-B4-07 is exactly the kind of thing a reviewer points at.

Nothing in this slice is opaque financial math, a generic engine, or a hidden side effect. The rounding, the dates and the residual cent are explicit and each has a worked example beside its test.

## 10. Verdict

**FAIL.**

The arithmetic, the rounding rules, the quote hash, the approval binding, the idempotency, the twice-is-once guarantees, the segment-by-segment cancellation and the as-of documents are all correct and proven by evidence I ran myself. Decision 18 reproduces exactly. Migration `0009` is additive and order-independent, and F-B7-12 is closed. AF-03 holds for every write in the slice, AF-04 and AF-05 hold.

Two things in the reviewed scope are not satisfied and are not cosmetic:

- **F-B4-04**, a second door to the maker-checker control the build claims to enforce on money out, reachable by an ordinary broker action with no race.
- **F-B4-05**, an external money event that reaches Stripe and is reflected in no journal entry, against AF-03 and against the invariant the architecture states for rule 14.

Both are narrow fixes in code that already exists elsewhere in the repository: the cumulative shape of `claimPayoutNeedsApproval` for the first, and `parkPaymentWithoutApplying` plus the session expiry the void path already performs for the second. **F-B4-06** additionally blocks the live evidence for this slice and needs a demo user attached to a bound policy's customer before an endorsement can be run end to end on the deployed application.

Residual limitations: nothing here is legal certification, no claim is made about production readiness, the money guards are clean on the coordinator's ephemeral run rather than on one of mine, and Yoann's understanding is recorded as `NOT REVIEWED WITH YOANN` and cannot be certified by a reviewer on his behalf.

---

## 11. Re-review at `e7b5913`, 2026-09-08T18:05:00Z

Scoped to the five findings the coordinator asked about. Same reviewer, no implementation, this file is still the only one written. Revision re-reviewed: `e7b5913` (the B8 merge; the B4 fixes are `d850f68`, `4a48a26`, `503ee45`, `dcad358`, merged at `26dede3`). Production reported `8e6d468` when the request arrived, which predates the fixes, so the code and disposable-database work was done first and the HTTP work once `/api/health` reported `e7b5913`. Prior findings and the section 10 verdict are preserved above; nothing there is rewritten.

### Verdict for the B4 scope after the fixes: **PASS**

| ID | Sev | Status |
|---|---|---|
| F-B4-04 | MEDIUM | **RESOLVED** |
| F-B4-05 | MEDIUM | **RESOLVED** |
| F-B4-06 | MEDIUM | **RESOLVED** |
| F-B4-08 | LOW | **RESOLVED** |
| F-B4-09 | LOW | **RESOLVED** |
| F-B4-07, F-B4-10, F-B4-11, F-B4-12 | LOW | Still open, outside this fix round |
| F-B4-13 | LOW | New, and it belongs to the B8 scope: see below |

**F-B4-04, resolved.** `refundNeedsApproval` in `lib/approvals/threshold.ts` now reads the threshold against the policy: refunds Stripe accepted or completed, plus refunds requested and not failed, plus this one. A failed refund counts for nothing, which is right because the money came back. It is called in three places, and the third is the one that matters: `assertRefundMaySend` recomputes the total at send time with `policyRefundTotals`, excluding the operation being decided, so a refund that was under the threshold when it was written cannot leave once another reduction has gone out in between. `createReissuedRefundOperation` uses the same rule. The comment that used to justify the omission has been replaced by one that names the finding. Proven on the disposable database: the first $800 reduction goes without an approver, the second is queued with one approval request and nothing sent to Stripe, a refund written under the threshold is refused at the gate with a sentence that says why, and a $538.41 cancellation refund that follows an endorsement refund waits for an approver although it is under $1,000 on its own. Four unit tests cover the rule itself, including the failed-refund case and the non-integer guard.

**F-B4-05, resolved, and by both routes I suggested.** `expireOpenCheckoutSessionsOfPolicy` in `lib/payments/checkout.ts` is called after the cancellation commits and closes every open hosted page of the policy, the issuance one and the endorsement ones, because the query asks about the policy rather than about what the operation is for. Failures are returned in `checkoutSessionsLeftOpen` rather than thrown, which is the right call: the cancellation is committed and the customer is already owed the money, so a Stripe outage must not undo either. And the narrow race that remains is now parked: a delta paid for a cancelled, voided or unbound policy, and one whose request row cannot be read, both post the rule-14 `unapplied_cash_received` entry instead of returning `refused`. Proven: the cash is at Stripe and owed to the customer, no endorsement was applied, and a second delivery parks it once. `retryEndorsementApplication` also re-reads the fold, so staff cannot apply a delta to a policy cancelled since the money arrived.

**F-B4-06, resolved.** `customer2@example.com` is attached to the customer of `CGP-01274` and is listed in the README with the reason it exists. Verified over HTTP: it signs in, `/customer` shows `Signed in as Santa CaFE` and lists `CGP-01274` as bound with its endorsement and correction columns, and the declarations PDF for that policy renders for it. I did not create an endorsement, as instructed; the live run belongs to the walkthrough session.

**F-B4-08, resolved.** `EndorsementRequestStanding` now carries `approvalRequired`, recomputed by `customerApprovalIsRequired` from the events, and both `approveEndorsement` and the checkout gate read it. The payload flag is still stored and still printed, which is honest: it is what the quote said when it was written. A payload claiming that no approval was needed can no longer open the Pay button.

**F-B4-09, resolved.** `customerApprovalNeeded` takes the additional premium of the other requests still waiting for this customer, so two raises of $400 cannot each escape the question. Requests the customer already approved, and those already in force, are excluded, which is the right base: money they said yes to does not make the next one need a second yes. The deployed preview now reads "Because this endorsement takes what this policy is asking the customer for above $500.00", so the screen states the cumulative rule rather than the old per-endorsement one.

**F-B4-13 (LOW), and it is B8's, not B4's.** `lib/money/correction.ts` still asks both questions per operation: `moneyOutNeedsApproval(-differenceTotalCents)` and `differenceTotalCents > CUSTOMER_APPROVAL_THRESHOLD_CENTS`, and `lib/policy/correction-read.ts` repeats the second one. This is not a bypass, and I checked why: a correction settles its difference through an ordinary `stripe_refund` operation sent by `issueRefundsAtStripe`, so it passes the now-cumulative `assertRefundMaySend`, and money above the policy total cannot leave. The consequence is a misleading preview followed by a refund that cannot be sent, rather than an unapproved payment. The B8 reviewer should decide whether the correction plan adopts `refundNeedsApproval` and `customerApprovalNeeded`.

**One observation, not a finding.** `customerApprovalIsRequired` counts superseded requests in the total still waiting for the customer, because it excludes only the approved and the applied ones. That errs toward asking the customer more often, which is the safe direction, at the cost of some friction after several abandoned quotes.

**F-B4-11 is now the only case left where a delta payment is journaled nowhere:** an amount that does not match the operation still returns `refused` without parking. It stays LOW and open.

### Checks run for this re-review

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm test` | 370 tests, 369 pass, 0 fail, 1 skipped |
| `npm run check:endorsement-replay` | **80 PASS, 0 FAIL**, exit 0, the expected 80 lines, including the eight new ones that prove F-B4-04 and F-B4-05 |
| Money guards | not rerun, on the coordinator's instruction. Cited: **161 PASS, 0 FAIL at 17:45Z** on an ephemeral database migrated `0001` to `0017` with the runtime role, then dropped, recorded in `docs/STATUS.md` |
| Threshold call sites | grep over `lib`, `app` and `scripts` for all five threshold functions, to find any path still on the per-operation rule. One found, F-B4-13, and it is B8's |
| HTTP at `e7b5913` | `customer2@example.com` signs in and sees `CGP-01274`; raise preview $677.15 and reduction preview $799.22, both recomputed independently and both correct; the cumulative wording on the approval sentence; wrong hash, customer endorsing, unknown request on the checkout route and broker approving all refused with 303 and a plain message; declarations PDF 200 for the policy's own customer |
| Created on the trial database | nothing, again. No endorsement, no request, no money operation |

Walkthrough status is unchanged: `NOT REVIEWED WITH YOANN`.
