# Slice B8 implementation notes (backdated correction of an endorsement date, and the policy as of any date)

Written by the B8 delegate on 2026-09-08. Branch `worktree-agent-ad5f18bc6b3b9a884`, worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/agent-ad5f18bc6b3b9a884`, three commits
on top of `main` at `e7fe35e`. Nothing was pushed, nothing was deployed, no shared planning file
was edited.

## 1. Startup receipt

Read in full before any edit: `CLAUDE.md`, `AUTOMATIC-FAILS.md`, `READABLE-CODE.md`, `AGENTS.md`,
`WORKFLOW-48H.md`, `REVIEWER.md`, `docs/ARCHITECTURE.md` (all nine sections), `docs/DECISIONS.md`
(every entry, including CGP-01061 corrected by reversal, closed-month revisions with a knowledge
cutoff, and decision 18 on segment-by-segment cancellation), `docs/reviews/FINDINGS.md`,
`docs/PLAN.md` (row B8 and the coverage tables), `docs/handoffs/b4-implementation-notes.md`.
`docs/STATUS.md` was read by its tail and its first sections; `docs/handoffs/b2-implementation-notes.md`
and `docs/handoffs/b5-implementation-notes.md` were read for their money-operation, webhook and
refund sections rather than end to end.

Existing code read line by line: `db/migrations/0001` to `0011`, `lib/ledger/reverse.ts` and its
test, `lib/ledger/post.ts`, `policy-entries.ts`, `cancellation-entries.ts`, `endorsement-entries.ts`,
`lib/policy/void-fabricated-binding.ts`, `current.ts`, `status.ts`, `terms.ts`, `endorse.ts`,
`endorsement-requests.ts`, `endorsement-read.ts`, `cancel.ts`, `read.ts`, `lib/money/premium.ts`,
`endorsement.ts`, `dates.ts`, `cents.ts`, `idempotency.ts`, `refund-allocation.ts`,
`lib/payments/collection.ts`, `endorsement-collection.ts`, `refunds.ts`, `lib/approvals/approvals.ts`,
`threshold.ts`, `lib/documents/policy-as-of.ts`, `from-database.ts`, `policy-snapshot.ts`,
`app/policies/[policyId]/page.tsx` and its `endorse` page, `app/customer/page.tsx`,
`app/api/webhooks/stripe/route.ts`, the route handlers under `app/api/policies`,
`scripts/check-endorsement-replay.ts`, `scripts/check-money-guards.ts`, `scripts/migrate.ts`.

Not read: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`,
`GAP-REVIEW.md` (advisory catalogues, outside this slice), `docs/COMPLIANCE-MATRIX.md`,
`docs/ATTACK-PLAN.md`. Absent files: none of the mandatory files were missing. `.env.local` was
copied from the main checkout into the worktree, is git-ignored, and no value from it was printed,
logged or committed.

Acceptance criterion worked on: `docs/PLAN.md` row B8. Planned checks, all executed: `npm run
typecheck`, `npm run build`, `npm test`, `npm run check:correction-replay`,
`npm run check:endorsement-replay`, `npm run check:refund-replay`, `npm run check:payment-replay`,
`npm run check:money-guards -- --database=test`, plus `check:claims-and-approvals`,
`check:kyb-replay` and `check:reconciliation` because this slice touches files those checks cover,
plus one rendering pass over every screen of the slice through a dev server on port 3700 pointed at
the disposable database.

## 2. Reading path for Yoann, file by file

1. `lib/money/correction.ts`: the one pure function. It re-prices the endorsement with ONE input
   changed, the effective date, and returns the difference, its sign, the commission on it and the
   two approval questions. Nothing else computes correction money.
2. `lib/ledger/correction-entries.ts`: the entries, with the worked example on top and the reason
   the cash is never touched written out in full.
3. `db/migrations/0014_corrections.sql`: one new event type, one new table saying which Stripe
   payment settles which correction, and two indexes that make "one re-book per corrected event"
   and "one customer approval per re-book" database facts.
4. `lib/policy/correct-endorsement-date.ts`: the whole action. Preview at the top (reads
   everything, writes nothing), then the one transaction: correction event, reversal entries,
   re-book event, re-booked entries, and the settlement.
5. `lib/policy/current.ts`: the fold. One added line makes a re-book apply exactly like an
   endorsement, which is what puts the corrected segment in `writtenPremiumSegments`.
6. `lib/payments/correction-collection.ts`: the hosted Stripe page for a difference the customer
   owes, the customer's approval above $500, and the entries posted when Stripe confirms.
7. `lib/policy/correction-read.ts`: every read the screens need. What a correction did, the
   timeline with both clocks, and the policy rebuilt on any business date.
8. `app/policies/[policyId]/corrections/new/page.tsx` (the impact preview),
   `app/policies/[policyId]/correction-sections.tsx` (the explanation, the timeline, the as-of
   view), `app/policies/[policyId]/corrections/[rebookEventId]/approve/page.tsx` (the customer).
9. `scripts/check-correction-replay.ts`: 47 assertions on a real database, including the byte for
   byte comparison of every row that existed before the correction.

## 3. What was built

**A correction is four appended things and nothing else.** In ONE transaction:

- a `correction_reversal` policy event, effective on the WRONG date, carrying the reason, both
  dates, the operator and the ids of the entries it reverses, and superseding the `endorsed` event
  that was wrong. The fold already skips a superseded event, so the wrong date leaves the picture
  while its row stays in the table;
- reversal journal entries for the two entries that said what the customer was BILLED
  (`endorsement_premium_written` and `endorsement_tax_billed`), through `lib/ledger/reverse.ts`:
  mirrored lines, the SAME effective date as the originals, `recorded_at` set by the database now;
- a `correction_rebook` policy event, effective on the RIGHT date, carrying the endorsement
  re-priced at that date, with fresh premium and tax entries on that date;
- the difference, opened as a money operation.

**The cash is never touched, and that is the point.** Stripe really holds the money the customer
paid, so `endorsement_premium_collected` and `endorsement_commission_earned` are left exactly as
they are. Reversing them would make the ledger say the money left Stripe, which is false and would
break the reconciliation against Stripe's own records. What a correction changes is what the
customer was billed, and the difference between billed and collected lands in
`premium_receivable`, the account whose whole job is "billed and not yet collected". A negative
balance there is the mirror image: collected and not billed, which is money owed back.

**The difference is settled through the machinery B4 and B5 already have.**

- Corrected date charges MORE days: the customer owes the difference. An ordinary
  `stripe_checkout` money operation is committed with the correction (the outbox rule), keyed
  `correction-checkout:<re-book event id>`, and a `correction_collections` row says which
  correction it settles. Above $500 the customer approves it first, recorded as a
  `correction_approved` policy event. When Stripe confirms, `correction_premium_collected` clears
  the receivable and `correction_commission_earned` pays the broker on the extra premium.
- Corrected date charges FEWER days: the customer is owed money back. One `stripe_refund`
  operation per Stripe payment, allocated newest collection first by
  `allocateRefundNewestCollectionFirst`, with a `refund_allocations` row, the entry
  `correction_refund_requested` (Dr premium_receivable, Cr refund_payable), and B7's approval
  queue above $1,000. B5's existing path posts `refund_completed` and `commission_clawback` when
  Stripe says the money left.

**Correcting a correction is allowed.** The second correction names the first re-book as the event
it corrects, supersedes it, and reverses the entries the re-book posted. Correcting the SAME event
twice is refused in the code (the event is no longer the latest one in force) and at the database
(`journal_entries.reverses_entry_id` is unique). Both are proved by the check.

**The fold, and therefore cancellation.** `applyPolicyEvents` treats a `correction_rebook` whose
payload says `rebooked_event_type: "endorsed"` exactly like an `endorsed` event: it replaces the
terms and it adds a written premium segment starting on the corrected date. A later cancellation
therefore gives back the corrected figure segment by segment (decision 18). The policy status stays
`bound`: `policyWasVoided` already required the absence of a re-book.

**The screens.**

- On each endorsement in force, for staff operations, a "Correct the effective date" form. It
  writes nothing: it opens the impact preview.
- The preview shows the two dates, the two amounts, the difference, what happens to the money and
  the exact entries that will be reversed, all from the same pure function the execution uses.
- After execution, "Corrections, explained" lists each correction with its formula lines and every
  entry it posted, with the effective date and the recording time side by side.
- A timeline of every policy event with both clocks, superseded rows struck through and named.
- An "as it stood on" date picker that rebuilds the policy in HTML through the same fold the PDFs
  use, showing the premium, the tax, the limits and the written premium segments in force that day.
- The customer's approval screen for a difference above $500.

## 4. The money, in the recited example

$1,200 annual premium written 2028-03-01, California 2.35%, $25 fee, 15% commission, 365-day term,
raised to $1,800. The endorsement was keyed with the effective date 2028-07-09 (day 130) and should
have been 2028-06-09 (day 100).

```
                                  formula                            cents
as booked, 2028-07-09 (235 days remain)
  delta premium                   floor(60000 x 235 / 365)           38630
  delta tax                       floor(38630 x 235 / 10000)           907
  collected at Stripe                                                39537
  commission earned               floor(38630 x 1500 / 10000)         5794

corrected, 2028-06-09 (265 days remain)
  delta premium                   floor(60000 x 265 / 365)           43561
  delta tax                       floor(43561 x 235 / 10000)          1023
  owed                                                               44584

the difference
  premium                         43561 - 38630                       4931
  tax                             1023 - 907                           116
  total to collect                                                    5047
  commission on it                floor(4931 x 1500 / 10000)           739
```

The entries, in one transaction:

```
reversal_of_endorsement_premium_written  Dr unearned_premium    38630  Cr premium_receivable  38630   effective 2028-07-09
reversal_of_endorsement_tax_billed       Dr premium_tax_payable   907  Cr premium_receivable    907   effective 2028-07-09
endorsement_premium_written              Dr premium_receivable  43561  Cr unearned_premium    43561   effective 2028-06-09
endorsement_tax_billed                   Dr premium_receivable   1023  Cr premium_tax_payable  1023   effective 2028-06-09
```

`premium_receivable` then holds 44584 - 39537 = 5047: the customer owes it. When it is paid:

```
correction_premium_collected  Dr cash_stripe          5047  Cr premium_receivable   5047
correction_commission_earned  Dr commission_expense    739  Cr commission_payable    739
```

The same correction the other way round (keyed 2028-06-09, corrected to 2028-07-09) leaves
`premium_receivable` at -5047 and gives the money back:

```
correction_refund_requested   Dr premium_receivable   5047  Cr refund_payable       5047
refund_completed              Dr refund_payable       5047  Cr cash_stripe          5047   (Stripe webhook)
commission_clawback           Dr commission_payable    739  Cr commission_expense    739   (same webhook)
```

**The commission rounds per piece, and the broker can end a cent off a direct calculation.**
5794 + 739 = 6533, where 15% of the corrected 43561 computed in one go is 6534. That is the same
per-piece flooring as the written premium segments (decision 18): each amount rounds down on its
own, and the insurer absorbs the fraction. It is stated in the code and in a test, not hidden.

## 5. Effective time and recorded time, and what B9 needs to know

Every event and every entry a correction writes carries an `effective_at` in the past (the day the
cover really changed) and a `recorded_at` of now (the moment we learned we were wrong). Nothing
overwrites `recorded_at`: a `BEFORE INSERT` trigger sets it from the database clock, so a client
value is ignored. The timeline screen shows the two columns side by side and never merges them.

**Nothing in this slice knows about statements, and nothing needs to.** B9's knowledge cutoff on
`recorded_at` is enough on its own: a closed month rerun with its stored cutoff sees neither the
correction event nor the reversal entries nor the re-book, so it reproduces revision 1 exactly; a
fresh run with a later cutoff sees all three and produces revision 2 with the corrected figure.
The one thing B9 must not do is filter on `effective_at` alone when it means "what was known then".
The reversal entries carry the ORIGINAL effective date on purpose, so an as-of view of a date after
the correction nets them against the originals to zero.

## 6. Deviations from the assignment, and why

1. **The correction event supersedes the wrong `endorsed` event only, not its
   `endorsement_requested` row.** `policy_events.supersedes_event_id` holds one id, so superseding
   the request would need a second `correction_reversal` row. That row would break the document
   fold: `lib/documents/policy-as-of.ts` raises when a reversal names an event the document fold
   does not carry, and a request is deliberately not a document event. The request carries no terms
   and no money, so skipping it changes no figure; the correction event names it in its payload
   (`request_event_id`) and the re-book carries it too, so the link is readable.
2. **Only an endorsement whose delta was COLLECTED can be corrected here.** An endorsement that
   refunded premium posts `endorsement_refund_requested` rather than premium and tax entries, and
   correcting it would have to reason about a refund that may already have left. It is refused with
   that sentence. Disclosed limitation, not a silent gap.
3. **Only the most recent endorsement in force can be corrected.** A later endorsement was priced
   against the one before it, so correcting an older one would leave the later quote resting on a
   base that no longer exists. Refused with "correct them first", which is the same reasoning B4
   used when it refused to backdate an endorsement before the one in force.
4. **A correction is refused while an earlier difference is unsettled.** Two guards, because the
   two directions leave different traces: the policy's `premium_receivable` balance must be zero
   (an unpaid difference to collect), and no correction refund may still be uncompleted (a
   difference given back leaves the receivable at zero the moment it is opened). Without this, a
   second correction could charge the customer money we were simultaneously sending back.
5. **The re-booked entries carry the SAME entry types as the endorsement that produced them**
   (`endorsement_premium_written`, `endorsement_tax_billed`). They are the same accounting fact,
   written on the corrected date; what tells them apart is the source (`source_kind = 'correction'`
   and the re-book event id) and the effective date. The settlement entries have no equivalent in
   the endorsement flow, so they get their own names.
6. **No broker eligibility gate on collecting a difference.** Collecting it binds nothing and
   applies nothing: it settles a receivable the ledger already carries. Rule 14 exists for money
   that arrives when a policy CANNOT be bound; there is nothing here that could be refused.
7. **The preview page lives at `/policies/{id}/corrections/new?endorsedEventId=...` rather than
   under `/endorsements/{id}/correct`.** Next.js refuses two different dynamic segment names at the
   same path level, and `[requestEventId]` was already taken by B4.
8. **One stale sentence on the policy page was corrected** ("this build refuses to cancel an
   endorsed policy"). B4 implemented that cancellation; the sentence had been left behind.
9. **`correction_collections` was added to the protected tables of `check:money-guards`**, with its
   fixture row, so the new table's three guards and its grants are proved like every other.

## 7. Assumptions, all visible in the code or on the screen

1. **A correction is a staff operations action.** It changes history, so it belongs to the people
   who answer for the books. A broker gets a sentence, not a form.
2. **A written reason of at least ten characters is required**, and it is copied onto the
   correction event and onto every reversal entry.
3. **The correction re-prices with ONE input changed.** The annual premiums, the tax rate, the
   commission rate and the tax already charged all come from the event being corrected, never from
   today's tables, so a correction can never quietly re-price a policy at a new rate.
4. **The re-book is applied immediately, and the money follows.** Unlike an endorsement, which
   waits for its delta, a correction puts the record right at once: the cover really did start on
   the corrected date, and the books have to say so now. The difference is an open receivable in
   the meantime, visible on the reconciliation screen.
5. **The same two thresholds as everywhere else**, both assumptions of this build and not Corgi
   rules: the customer approves a difference to pay above $500; a distinct human approves a
   difference given back above $1,000.
6. **The refund liability is dated on the corrected effective date**, which is the date at which
   the re-booked premium and the money given back net to zero in an as-of view.

## 8. Commands actually run, with results

All from the worktree root.

```
$ npm run typecheck                                exit 0
$ npm run build                                    exit 0, 39 routes
$ npm test                                         329 tests, 328 pass, 0 fail, 1 skipped
                                                   (the skipped one is B3's live KYB test)
$ npm run check:correction-replay                  47 PASS, 0 FAIL, exit 0   (new)
$ npm run check:endorsement-replay                 69 PASS, 0 FAIL, exit 0   (B4, unchanged)
$ npm run check:refund-replay                      27 PASS, 0 FAIL, exit 0   (B5, unchanged)
$ npm run check:payment-replay                     29 PASS, 0 FAIL, exit 0   (B2, unchanged)
$ npm run check:claims-and-approvals               63 PASS, 0 FAIL, exit 0   (B7, unchanged)
$ npm run check:kyb-replay                         23 PASS, 0 FAIL, exit 0   (B3, unchanged)
$ npm run check:reconciliation                     29 PASS, 0 FAIL, exit 0   (B10, unchanged)
$ npm run check:money-guards -- --database=test    141 PASS, 1 FAIL (contention, see below)
$ npm run migrate -- --database=test               applied 0014_corrections.sql
```

**`check:correction-replay` calls no provider at all.** Every payment is simulated by calling the
webhook-side functions directly with the payloads Stripe would send, on fabricated payment intents,
which is why it refuses to run anywhere but `corgi_test`. The lines that matter:

```
PASS  not one row that existed before the correction changed, byte for byte  (36 rows compared)
PASS  the correction only added rows  (36 rows before, 52 after)
PASS  two reversal entries exist, mirroring the originals on the SAME effective date
PASS  every reversal line is the mirror image of the line it reverses
PASS  the reversals were RECORDED after the originals, and effective before them: two clocks
PASS  the re-book posts the corrected premium and tax on the corrected date
PASS  no cash entry was reversed and no cash entry was posted: Stripe still holds the money
PASS  the fold applies the re-book like an endorsement: the corrected segment, at the corrected date
PASS  the wrong endorsement is superseded, the policy stays bound, and the terms are the endorsed ones
PASS  before the correction, the policy on 2028-06-20 still reads $1,200 with the original limits
PASS  AFTER the correction, the policy on 2028-06-20 reads $1,800 with the raised limits
PASS  and the day before the corrected date it still reads $1,200
PASS  the customer owes 5047: premium billed and not collected, visible as an open receivable
PASS  one collection operation was opened for the difference, keyed on the re-book, nothing sent
PASS  an expired page posts nothing and leaves the difference owed
PASS  the issuance path refuses a correction operation instead of posting issuance entries under it
PASS  the difference paid, and the same payment delivered twice posts once
PASS  the receivable is back to zero and the broker earned commission on the extra premium only
PASS  unearned premium holds the issuance premium plus the CORRECTED delta
PASS  the same endorsement cannot be corrected a second time
PASS  and the database refuses it too: an entry can be reversed at most once
PASS  a correction of a correction supersedes the re-book and leaves one segment, at the newest date
PASS  it gives back the difference: 44584 collected, 42060 owed, 2524 to refund with a 369 clawback
PASS  the refund takes the money out of premium receivable, not out of unearned premium
PASS  a third correction is refused while that refund is in flight
PASS  when the refund completes, refund_payable clears and the commission is clawed back
PASS  corrected the other way: 44584 collected, 39537 owed, 5047 given back with a 739 clawback
PASS  a broker cannot correct a date: it is an operations job
PASS  a cancelled policy cannot have its endorsement corrected
PASS  every journal line in the database balances, debits against credits
```

**The one failing money-guards line is contention on the shared database, and the guard was
verified another way.** `owner cannot TRUNCATE claims` reported "deadlock detected"; a rerun moved
the failure to `brokers`, `policies` and `claims`. This is exactly what the B4 and B7 delegates
recorded: Postgres takes ACCESS EXCLUSIVE locks on every cascaded table BEFORE the BEFORE TRUNCATE
trigger can speak, and `corgi_test` had other sessions in it. Verified read-only instead:
`brokers`, `policies` and `claims` all carry their `_cannot_be_truncated` trigger, and `app_runtime`
holds `SELECT` (brokers) or `INSERT, SELECT` (policies, claims) and nothing else. The new table's
six checks passed on both runs:

```
PASS  owner cannot UPDATE correction_collections
PASS  owner cannot DELETE correction_collections
PASS  owner cannot TRUNCATE correction_collections
PASS  app_runtime lacks UPDATE / DELETE / TRUNCATE on correction_collections
```

**The screens were rendered, not only type-checked.** A dev server was started on port 3700 with
`DATABASE_URL` and `DATABASE_URL_APP` overridden to the disposable database, never the trial one,
and stopped afterwards. Sixteen page and route checks, all passing:

```
PASS  the policy page shows the correction explained, both clocks and the as-of picker
PASS  the as-of section rebuilds the policy on 2028-06-20 with the raised premium
PASS  the as-of section says so honestly for a date before the policy existed
PASS  the correction preview prices the change without writing anything
PASS  a preview with no reason / a date outside the term / no endorsement named is refused
PASS  the customer page renders with the correction column
PASS  a broker opening the correction preview is refused with a sentence
PASS  the policy page shows a difference of $1,039.77 still to collect and says the customer must approve it
PASS  the customer's list offers the correction for approval, and the approval screen shows every formula
PASS  another customer opening that approval screen is redirected away (307)
PASS  the broker cannot collect before the customer approves
PASS  staff cannot approve in the customer's place
PASS  the customer approves once; a second click changes nothing
PASS  the collect button appears once the customer has approved
PASS  a real test-mode hosted page is opened for the difference (cs_test_...)
PASS  a second click reuses the same session, it does not open a second one
```

Those runs created two real test-mode Stripe Checkout Sessions for a correction difference. Neither
was paid and no money moved. The probe scripts used for this pass were deleted.

**Shared-database interference, noticed and named.** `check:money-guards` deadlocked on TRUNCATE
probes belonging to other slices, twice, on the disposable database shared with the other builders.
Nothing this slice wrote is involved, and no trial row is involved.

## 9. What was NOT verified, and why

- **No live correction on the deployed application.** The whole slice ran against the disposable
  database from this worktree. The live rehearsal with Yoann is the coordinator's, after the merge.
- **No difference was actually PAID at Stripe.** Two hosted pages were opened for real in test mode
  and left unpaid, so `correction_premium_collected` has never been posted from a real
  `payment_intent.succeeded` webhook. It is posted by the check script through the same function
  the webhook calls.
- **No correction refund was sent to Stripe.** `issueRefundsAtStripe` is B5's code, already proved
  live at cancellation; the correction leg is exercised by the check against a fabricated
  PaymentIntent.
- **The approval queue was exercised through the screens for the customer approval only.** A
  correction refund above $1,000 raises a B7 approval request in the same transaction (the code
  path is identical to B4's reduction refund and B5's cancellation refund) but nobody clicked
  Approve on one in this slice.
- **Migration `0014_corrections.sql` has not been applied to the trial database.** The coordinator
  applies it at merge time. It is strictly additive and independent of 0012 and 0013.
- **`check:money-guards` was not run against the trial database**, as the assignment asked.
- **Correcting an endorsement that REFUNDED premium** is refused, not implemented (deviation 2).
- **Independent review.** Not performed by this delegate, by design.
- **Walkthrough with Yoann: NOT REVIEWED WITH YOANN.**

## 10. Needs a decision or an action from the coordinator

1. **Apply migration `0014_corrections.sql` to the trial database before deploying.** Without it
   every policy page fails: the fold, the issuance payment read and the policy detail all query
   `correction_collections`.
2. **The live rehearsal, which is the panel's test.** On the deployed app: endorse a bound policy
   with a deliberately wrong effective date, pay the delta, then correct the date as staff
   operations, show the preview, execute, show the explanation with both dates, show the timeline
   with the superseded row struck through, and ask for the policy as it stood between the two
   dates. Then collect the difference with a test card so a real
   `correction_premium_collected` exists.
3. **A decision for Yoann on the commission penny, worth two sentences at the debrief.** Correcting
   a date to charge more days pays the broker 5794 + 739 = 6533, one cent less than 15% of the
   corrected 43561 computed in one go. It is the same per-piece flooring as the written premium
   segments he already decided on (decision 18), applied to commission. He should confirm he is
   happy defending it, or ask for the commission to be reversed and re-booked in full like the
   premium, which would be a bigger correction and a different rule.
4. **A decision for Yoann on the scope limit.** This build corrects the date of an endorsement that
   COLLECTED premium. Correcting one that REFUNDED premium is refused with a sentence. If the panel
   is likely to ask for that case, it is roughly the same amount of work again; if not, it is a
   clean disclosed limitation.
5. **`README.md` needs no new integration row for this slice**: the correction difference and its
   refund run on the Stripe slot already listed as `LIVE SANDBOX`. One sentence in the backdated
   correction section would be worth it, saying that the original rows stay and that the cash is
   never reversed.
6. **Two test-mode Checkout Sessions were left open at Stripe** by the screen rendering pass, on
   fixtures of the disposable database. They expire on their own after 24 hours and no money moved.
