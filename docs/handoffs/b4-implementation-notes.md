# Slice B4 implementation notes (endorsements, delta collection and refund, as-of documents)

Written by the B4 delegate on 2026-09-08. Branch `worktree-agent-ace13549089ca5fe0`, worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/agent-ace13549089ca5fe0`. Eight commits
on top of `main` at `4decb8c`, including two merges of `main`: the first brought rule 14 and the
B7 claims and approvals, the second the B10 reconciliation. Nothing was pushed, nothing was
deployed, no shared planning file was edited.

This slice was started by a previous delegate that an API session limit cut off. Its two commits
(`c4ce8ac`, `9d72c03`) and its uncommitted screens are kept; what changed is described in
section 5.

## 1. Startup receipt

Read in full before any edit: `CLAUDE.md`, `AUTOMATIC-FAILS.md`, `READABLE-CODE.md`, `AGENTS.md`,
`WORKFLOW-48H.md`, `REVIEWER.md`, `docs/ARCHITECTURE.md` (nine sections, including 3.x on rule
14), `docs/DECISIONS.md` (every entry), `docs/reviews/FINDINGS.md`, `docs/PLAN.md` (row B4 and
the coverage tables), `docs/STATUS.md`, `docs/handoffs/b7-implementation-notes.md` (sections 1
to 9). `docs/handoffs/b2-implementation-notes.md` and `docs/handoffs/b5-implementation-notes.md`
were read for their money-operation, webhook and refund sections rather than end to end.

Existing code read line by line: `db/migrations/0001` to `0010`, `db/client.ts`,
`lib/money/dates.ts`, `cents.ts`, `premium.ts`, `endorsement.ts`, `idempotency.ts`,
`refund-allocation.ts` and their tests, `lib/ledger/post.ts`, `policy-entries.ts`,
`cancellation-entries.ts`, `endorsement-entries.ts`, `reverse.ts`, `lib/payments/checkout.ts`,
`collection.ts`, `endorsement-collection.ts`, `refunds.ts`, `webhook-inbox.ts`,
`app/api/webhooks/stripe/route.ts`, `lib/policy/current.ts`, `status.ts`, `cancel.ts`, `read.ts`,
`endorse.ts`, `endorsement-requests.ts`, `endorsement-read.ts`, `terms.ts`, `lib/approvals/*`,
`lib/auth/session.ts`, `lib/documents/*`, `app/policies/[policyId]/page.tsx` and the route
handlers under `app/api/policies`, `scripts/check-payment-replay.ts`,
`scripts/check-refund-replay.ts`, `scripts/check-endorsement-replay.ts`,
`scripts/check-money-guards.ts`, `scripts/migrate.ts`, `scripts/seed.ts`.

Not read: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`,
`GAP-REVIEW.md` (advisory catalogues, outside this slice), `docs/COMPLIANCE-MATRIX.md`,
`docs/ATTACK-PLAN.md`. Absent files: none of the mandatory files were missing.
`docs/handoffs/b7-implementation-notes.md` exists on `main` and was read from there, because the
branch was cut before the B7 merge. `.env.local` was already in the worktree; no value was
printed, logged or committed.

Acceptance criterion worked on: `docs/PLAN.md` row B4. Planned checks, all executed: `npm run
typecheck`, `npm run build`, `npm test`, `npm run check:endorsement-replay`,
`npm run check:payment-replay`, `npm run check:refund-replay`, `npm run check:kyb-replay`,
`npm run check:claims-and-approvals`, `npm run check:money-guards -- --database=test`,
`npm run check:ledger-guards`, plus one rendering pass over every screen of the slice through a
dev server on port 3300 pointed at the disposable database.

## 2. Reading path for Yoann, file by file

1. `lib/money/endorsement.ts`: the one pure function. It prices an endorsement, decides whether
   the customer has to approve, hashes the quote, and returns the formula lines the screens
   print. Nothing else computes endorsement money.
2. `db/migrations/0009_endorsements.sql`: two new policy event types, the table that says which
   Stripe payment collects which endorsement, and the two indexes that make "applied once" and
   "approved once" database facts.
3. `lib/policy/endorse.ts`: the broker asks for a change. One transaction takes a lock,
   recomputes the quote, refuses a stale hash, writes the request; a reduction is applied in
   that same transaction with its refund operation.
4. `lib/policy/endorsement-requests.ts`: reading a request back and saying where it stands
   (awaiting approval, approved, applied, superseded). No flag is stored; the standing is read
   from the events that follow the request.
5. `lib/payments/endorsement-collection.ts`: the hosted Stripe page for a positive delta, and
   the one transaction that posts the four entries and applies the endorsement when Stripe
   confirms the money.
6. `lib/ledger/endorsement-entries.ts`: the four entries of a collected delta and the one entry
   of a refunded one, with the worked example on top.
7. `lib/policy/current.ts`: the fold. It applies endorsements, skips superseded events, and now
   lists the written premium segments a cancellation gives back.
8. `lib/money/premium.ts`: `earnedPremiumOfSegment` and `cancellationBreakdown`, which is why an
   endorsed policy can be cancelled correctly.
9. `lib/policy/endorsement-read.ts`: every read the screens need, including the schedule.
10. `app/policies/[policyId]/endorse/page.tsx` (the preview), `app/policies/[policyId]/page.tsx`
    (the endorsement in progress, the schedule and the explanation),
    `app/policies/[policyId]/endorsements/[requestEventId]/approve/page.tsx` (the customer),
    `app/customer/page.tsx` (the customer's own list).
11. `lib/documents/from-database.ts` and `lib/documents/policy-as-of.ts`: the policy rebuilt on
    any date, and the two PDFs served by
    `app/api/policies/[policyId]/documents/[document]/route.ts`.

## 3. What was built

**An endorsement is three policy events, never a row that gets edited.**
`endorsement_requested` carries the whole quote: the figures, the days remaining, the policy
version it was priced against, and the SHA-256 quote hash. `endorsement_approved` records the
customer accepting that hash, and is required only when the amount to collect is above $500.
`endorsed` is the change in force, and it carries both the new terms and the delta that moved,
so the explanation can be given later from that row alone.

**The quote hash is what an approval and a payment are bound to.** It is the SHA-256 of six
facts: policy id, policy version (the number of applied policy events), effective date, new
annual premium, delta premium, delta tax. Any later event on the policy moves the version, so a
second request makes the first quote unpayable and unapprovable, with a plain message rather
than a stale execution. The hash is recomputed from the stored figures at every use, so a
tampered payload is refused too.

**The same pure function prices the preview and the execution.** `computeEndorsement` is called
by the preview page, by the customer's approval screen, by the confirmation (recomputed under a
lock) and by the explanation. `endorsementFormulaLines` turns its result into the printed lines,
so a screen cannot promise a figure the ledger will not book. This is the differentiator of
`docs/PLAN.md` row B12, delivered here for endorsements.

**A positive delta is collected through a real hosted Checkout Session**, keyed
`endorsement-checkout:<request event id>` plus the attempt number. The operation and its
`endorsement_collections` row are committed before Stripe is called. Entries are posted only on
`payment_intent.succeeded`, in one transaction with the `endorsed` event and the operation's
`succeeded` status. `checkout.session.expired` marks the attempt dead and the next Pay click
opens a new operation under a new key, exactly as at issuance.

**A negative delta is refunded at once through the Stripe Refunds API**, allocated newest
collection first, with the tax ceiled and capped and the commission clawed back rounded down.
Above $1,000 the refund waits in the B7 approval queue: the approval request is written in the
same transaction as the refund operation, nothing is sent to Stripe, and the existing staff
action "send this approved refund" moves it once a distinct `staff_approver` has decided.

**Money that arrives when the endorsement cannot be applied is parked, not ignored** (rule 14).
A delta paid while the broker is no longer eligible, or for a quote a later request superseded,
posts `unapplied_cash_received` (Dr `cash_stripe` / Cr `unapplied_customer_cash`) in the same
transaction as the succeeded status. Ledger cash equals Stripe cash at every instant. When staff
apply it, `endorsement_premium_collected` debits the suspense account instead of `cash_stripe`,
so the money is applied rather than booked twice and the suspense balance returns to zero.

**An endorsed policy can be cancelled.** The fold now lists the written premium segments: the
annual premium earning over the whole term, then each applied endorsement's prorated delta
earning from its own effective date to the term end. `cancellationBreakdown` adds them up. The
tax cap is the premium tax the ledger still holds rather than the tax on the annual premium in
force, which after an endorsement are different figures.

**The documents are real PDFs rebuilt from the events on any date.** `?asOf=YYYY-MM-DD` keeps
only the events effective on or before that date and drops the ones a correction reversed, so
between two endorsements the declarations page shows the premium and limits in force that day.
Verified on the disposable database: the same policy prints $1,200 annual with $1M limits on
2028-06-08, $1,800 with $2M limits on 2028-07-01, and "Cancelled, effective September 1, 2028"
on 2028-10-01.

## 4. The money, in the recited example

$1,200 annual premium written 2028-03-01, California 2.35%, $25 fee, 15% commission, 365-day
term. Endorsed to $1,800 effective 2028-06-09, which is day 100, with 265 days remaining.

```
                                 formula                          cents
delta premium charged            floor(60000 x 265 / 365)         43561
  the same, backdated 30 days    floor(60000 x 295 / 365)         48493
delta tax charged                floor(43561 x 235 / 10000)        1023
total collected at Stripe        43561 + 1023                     44584
policy fee                       charged at issuance only             0
commission earned                floor(43561 x 1500 / 10000)       6534

lowered to $600 instead
delta premium refunded           -ceil(60000 x 265 / 365)        -43562
delta tax refunded               -ceil(43562 x 235 / 10000)       -1024
total refunded at Stripe                                         -44586
commission clawed back           -floor(43562 x 1500 / 10000)     -6534
```

The four entries of a collected delta:

```
endorsement_premium_written     Dr premium_receivable  43561   Cr unearned_premium      43561
endorsement_tax_billed          Dr premium_receivable   1023   Cr premium_tax_payable    1023
endorsement_premium_collected   Dr cash_stripe         44584   Cr premium_receivable    44584
endorsement_commission_earned   Dr commission_expense   6534   Cr commission_payable     6534
```

Cancelling that raised policy on 2028-09-01, which is day 184 of the term and day 84 of the
endorsement's 265:

```
issuance segment      earned floor(120000 x 184 / 365) = 60493 of 120000
endorsement segment   earned floor(43561 x 84 / 265)   = 13808 of  43561
written 163561, earned 74301, unearned                            89260
tax back              ceil(89260 x 235 / 10000)                    2098   (cap 3843, not binding)
total refunded                                                    91358   split over two payments
commission clawback   floor(89260 x 1500 / 10000)                 13389
```

The written premium is 163561, not the 180000 annual premium in force. That distinction is the
whole reason the segments exist, and it is the question to expect at the debrief.

## 5. Deviations from the assignment, and why

- **The B7 hook the previous delegate left is gone.** It held a refund above $1,000 with a local
  constant and no queue. Refunds now create an approval request through `lib/approvals` in the
  same transaction as the operation, and `assertRefundMaySend` refuses to send until a distinct
  `staff_approver` has approved. Nothing new was written for the endorsement path: it uses B7's
  queue, B7's intent hash and B5's send action unchanged.
- **Cancelling an endorsed policy was refused by the previous delegate, and is now computed.**
  Its refusal was a safe guard, but it broke a feature that worked before this slice, and the
  per-segment rule was already decided in `ARCHITECTURE.md` section 3, so implementing it was
  not a new money rule. What changed in B5's code: `cancellationBreakdown` takes segments rather
  than one written premium, and the tax cap is read from the ledger. Both were re-proved by
  `check:refund-replay` (27 of 27, unchanged) and by the existing unit tests.
- **The tax cap on a cancellation is now the `premium_tax_payable` balance of the policy**, not
  `terms.taxCents`. For a policy that was never endorsed the two are the same figure; after an
  endorsement they are not, and only the ledger balance is the money actually collected and not
  yet given back.
- **Each written segment rounds in the customer's favour, so a cancelled endorsed policy gives
  back a cent or two more than pricing the whole thing on the annual premium in force.** In the
  example above the segments give 86302 where the annual figure would give 86301.37. This is the
  same penny rule as everywhere else, applied once per segment, and it is stated in the code and
  in a test rather than hidden.
- **The endorsement effective date cannot be earlier than the endorsement already in force.**
  The annual premium a new quote changes is the one of the latest segment, so an earlier date
  would need the previous endorsement corrected first, which is slice B8. Refused with that
  sentence rather than priced against the wrong base.
- **One route handler per action under `/api/policies/[policyId]/endorsements`**, matching the
  existing style of the repository rather than one handler with a named action field.
- **No new dependency.** The PDFs use `@react-pdf/renderer`, already chosen for the documents.

## 6. Assumptions, all visible in the code or on the screen

1. **$500 of premium plus tax is the customer-approval threshold, strictly above.** Yoann's
   decision of 2026-09-08, an assumption of this build and not a regulatory figure. One constant,
   `CUSTOMER_APPROVAL_THRESHOLD_CENTS`, one comparison, named on both screens.
2. **Only a reduction can cross the money-out threshold**, because only a reduction sends money
   out. A collection is money in and never needs a second approver.
3. **The delta of an endorsement is priced at the tax rate in force on the policy**, not at
   today's rate table. An endorsement changes the cover, not the rate the policy was written at.
4. **A payment that arrives for a superseded quote is parked, not applied and not refunded
   automatically.** Refunding it is money out and belongs in the approval queue; the operations
   screen shows it with the reason.
5. **The endorsement schedule shows both the prorated delta and the new annual premium**, with a
   footnote on the difference. Yoann's decision of 2026-09-08 at 11:14Z.

## 7. Commands actually run, with results

All from the worktree root, after the merge of `main`.

```
$ npm run typecheck                                exit 0
$ npm run build                                    exit 0, 42 routes
$ npm test                                         312 tests, 311 pass, 0 fail, 1 skipped
                                                   (the skipped one is B3's live KYB test; 257 of
                                                   them before the B10 merge)
$ npm run check:endorsement-replay                 69 PASS, 0 FAIL, exit 0
$ npm run check:payment-replay                     29 PASS, 0 FAIL, exit 0   (B2, unchanged)
$ npm run check:refund-replay                      27 PASS, 0 FAIL, exit 0   (B5, unchanged)
$ npm run check:kyb-replay                         23 PASS, 0 FAIL, exit 0   (B3, unchanged)
$ npm run check:claims-and-approvals               55 PASS, 0 FAIL, exit 0   (B7, unchanged)
$ npm run check:money-guards -- --database=test    135 PASS, 1 FAIL (a deadlock, see below),
                                                   exit 1  (118 PASS, 0 FAIL before the B10
                                                   merge; 110 checks before this slice)
$ npm run check:ledger-guards                      10 PASS, 0 FAIL, exit 0   (trial database,
                                                   every check rolled back)
```

**The one failing check is contention on the shared database, and the guard behind it was
verified another way.** After the B10 merge, `check:money-guards` reported "deadlock detected" on
two TRUNCATE probes; rerun once, one of them passed and `owner cannot TRUNCATE approval_requests`
failed the same way. Postgres takes ACCESS EXCLUSIVE locks on every cascaded table BEFORE the
BEFORE TRUNCATE trigger can speak, and `corgi_test` had two other non-idle backends at the time
(the parallel slices), so the probe deadlocks before reaching the guard. This is the contention
the B7 delegate documented.

What was verified instead, read-only and in one second: `approval_requests` carries all three of
its triggers (`approval_requests_are_append_only`, `approval_requests_cannot_be_truncated`,
`approval_requests_recorded_at_is_server_set`) and `app_runtime` holds `INSERT, SELECT` and
nothing else on it. The same check ran 118 PASS, 0 FAIL earlier today on the same schema, before
the B10 merge added its tables, and that run exercised this probe. Nothing about
`approval_requests` changed in this slice: it belongs to B7 and is untouched here.

The lesson stays the one B7 recorded: run one check script at a time against one database.

`npm run check:endorsement-replay` calls Stripe for real three times in test mode (two Checkout
Sessions, one payment-intent lookup) and no money moves. It commits rows, so it refuses to run
anywhere but `corgi_test`. The lines that matter:

```
PASS  the preview gives the recited figures for +$600 on day 100 (43561, 1023, 44584, 6534)
PASS  the preview writes nothing
PASS  the same change backdated 30 days charges 48493
PASS  a request with a hash that is not the current quote is refused
PASS  the policy terms are unchanged until the money arrives
PASS  a real hosted page is opened for the delta, and a second click reuses it
PASS  checkout.session.expired is recorded, no entry posted; the next click opens a new key
PASS  a delta payment for another amount is refused, not journaled
PASS  the issuance path refuses a delta operation
PASS  the first delivery applies the endorsement, the second is already posted
PASS  exactly four endorsement entries exist, one of each type
PASS  unearned premium grows by the prorated delta, not by the annual difference
PASS  no fee is charged again
PASS  an endorsement cannot be backdated before the one in force
PASS  an endorsed policy is cancelled on its segments: 163561 written, 74301 earned, 89260 back
PASS  the tax cap is the tax the ledger still holds, not the tax on the premium in force
PASS  the refund is split over the two payments that funded the policy, newest first
PASS  the delta cannot be collected before the customer approves
PASS  the broker cannot approve in the customer's place / another policy's customer cannot
PASS  an approval carrying another quote's hash is refused
PASS  after a second request, paying or approving the first quote is refused as superseded
PASS  a payment arriving for a superseded quote is recorded, not applied
PASS  a delta paid while the broker is not eligible is recorded and NOT applied
PASS  the delta cash is parked in the suspense account, not left out of the ledger
PASS  the same parked payment delivered twice parks once
PASS  applying the parked delta clears the suspense account and books the cash once
PASS  the preview of -$600 on day 100 refunds 43562 + 1024 with a 6534 clawback
PASS  the completed refund delivered twice posts once
PASS  a failed endorsement refund posts NO journal entry and the customer is still owed
PASS  the refund waits for a distinct human approver: one request written, nothing sent
PASS  the endorsement is applied all the same: the cover is reduced and the money is owed
PASS  the refund cannot be sent before somebody approves it
PASS  the person who asked for it cannot approve it, even claiming the approver role
PASS  an operator who is not a staff approver cannot approve it
PASS  once a distinct staff approver has approved it, the refund may be sent
PASS  a cancelled / voided / unbound policy cannot be endorsed
PASS  the effective date must be inside the term
PASS  an endorsement that changes nothing is refused
PASS  a customer cannot request an endorsement
PASS  every journal line in the database balances
```

**The screens were rendered, not only type-checked.** A dev server was started on port 3300 with
`DATABASE_URL` and `DATABASE_URL_APP` overridden to the disposable database, never the trial one,
and stopped afterwards. Every page answered 200 with the expected content: the policy page with
the schedule and the explanation, the preview of a raise and of a reduction with their formula
lines, the preview refusals (a date outside the term, a missing amount), the endorsement in
progress awaiting the customer, the superseded requests, the customer's list, the customer's
approval screen, and the two PDFs. The negative paths answered as they should: a customer opening
the broker policy page is redirected (307), a customer asking for another policy's document gets
403 with "this policy is not yours to read", and a declarations page dated before the policy
existed gets 404 with "no issued policy event effective on or before".

The declarations page as of three dates on one endorsed and cancelled policy, read back out of
the PDFs:

```
2028-06-08   $1,000,000 / $2,000,000 limits   annual $1,200.00   tax $28.20   total $1,253.20
2028-07-01   $2,000,000 / $4,000,000 limits   annual $1,800.00   tax $42.30   total $1,867.30
2028-10-01   Cancelled, effective September 1, 2028, same figures
```

**Shared-database interference, noticed and explained.** After my run, two refund operations of
one `corgi_test` fixture had moved from `requested` to `failed` at stage `create_refund` with
"No such payment_intent". Nothing in this slice calls Stripe from a cancellation:
`recordCancellation` writes only to our database. The cause is B7's `recoverStuckOperations`,
which another session ran against the shared disposable database and which asks Stripe about
operations stuck in `requested`. No money moved and no trial row is involved. It is recorded
here because the coordinator asked for interference to be named.

## 8. What was NOT verified, and why

- **No live Stripe collection of a delta from the deployed application.** The hosted pages this
  slice opened at Stripe were created from this worktree against the disposable database, and
  none was paid. The coordinator owns that run after the merge, with Yoann's own test card.
- **No live Stripe refund of a negative delta.** The refund path is B5's, already proved live at
  cancellation, and the endorsement leg is exercised by the check script against a fixture
  PaymentIntent. The two halves have not been run together.
- **The approval queue was exercised through its functions, not through the screens.**
  `/ops/approvals` already existed and is unchanged by this slice, but nobody clicked Approve on
  an endorsement refund.
- **Migration 0009 has not been applied to the trial database.** The coordinator applies it at
  merge time. It is strictly additive and independent of 0008, 0010 and 0011, so the order does
  not matter.
- **`npm run check:money-guards` was not run against the trial database.** The B7 delegate
  recorded deadlocks when its TRUNCATE probes contend with the live application, so it was run
  on `corgi_test` only, as the assignment asked.
- **One TRUNCATE probe was not exercised on the last run** (`approval_requests`, section 7): it
  deadlocked against the other sessions using the shared disposable database. The guard was read
  out of the catalogue instead, and the same probe passed earlier today.
- **Independent review.** Not performed by this delegate, by design.
- **Walkthrough with Yoann: NOT REVIEWED WITH YOANN.**

## 9. Needs a decision or an action from the coordinator

1. **Apply migration `0009_endorsements.sql` to the trial database before deploying**, otherwise
   every policy page fails: the fold and the status query both read `endorsement_collections`.
2. **One live endorsement on the deployed application** closes the last gap of this slice: a
   broker raises a premium above $500, the customer approves from `/customer`, the broker pays
   the delta with a test card, and the webhook applies the endorsement. Then one reduction below
   $1,000 to see a real Stripe refund of a delta.
3. **A decision for Yoann on rounding, worth two sentences at the debrief.** Cancelling an
   endorsed policy gives back a cent or two more than pricing the cover in force over the
   remaining days, because each written segment is rounded in the customer's favour. The
   alternative is to price the cancellation on the annual premium in force, which is simpler to
   say but no longer ties to the `premium_written` entries in the journal. This build ties to the
   journal. Yoann should confirm he is happy defending that.
4. **Money parked for a quote that will never be applied has no refund action yet.** The cash
   sits in `unapplied_customer_cash` and is visible on the operation, but returning it is money
   out and needs the approval queue, the same leg rule 14 still owes for a broker who fails for
   good. One shared action would close both.
5. **A dev server belonging to another worktree was killed by mistake.** Stopping my own server
   with `pkill -9 -f "next dev"` also matched a Next dev server running from
   `/Users/yoannabriel/dev/corgi-work-trial/.worktrees/corgi-interface` on port 3107. Reported to
   the coordinator at the time; whoever owns it has to restart it. No file outside this worktree
   was touched.
6. **The reconciliation screen does not list the suspense account.** B10 names one clearing
   account per operation kind (`premium_receivable`, `refund_payable`, `claims_payable`), so cash
   parked in `unapplied_customer_cash` by rule 14, at issuance or now on an endorsement delta,
   shows no open clearing balance anywhere. `ARCHITECTURE.md` section 1 asks the reconciliation
   screen to list non-zero clearing balances with their age. This belongs to B10 or B13, not to
   this slice, and is recorded here because this slice adds a second way to fill that account.
7. **`README.md` needs no new integration row for this slice**: the endorsement delta and its
   refund run on the Stripe slot that is already listed as `LIVE SANDBOX`. The document
   generation row (`REAL`) now covers the two as-of PDFs, which is worth one sentence.
