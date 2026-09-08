# Slice B5 implementation notes (cancellation, real Stripe refund, commission clawback)

Written by the B5 delegate on 2026-09-08. Branch `worktree-agent-ac261835488664a28`, worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/agent-ac261835488664a28`, eight
commits on top of `81f3109`. Nothing was pushed, nothing was deployed, no shared planning file
was edited.

**A REAL Stripe sandbox refund was created: `re_3UDM4KK6R3v50tIy0scSGaps`, 324156 cents, status
`succeeded`, on `pi_3UDM4KK6R3v50tIy0F5xaBbu` (policy CGP-01062).** Section 5 says exactly what
the coordinator has to do after deploying to get the completion webhook, and why a plain
"Resend" in the Stripe dashboard will NOT do it.

## 1. Startup receipt

Read in full before writing any code: `CLAUDE.md`, `AGENTS.md`, `AUTOMATIC-FAILS.md`,
`READABLE-CODE.md`, `WORKFLOW-48H.md`, `REVIEWER.md`, `docs/BRIEF-REFERENCE.md` (general and
Track 1; Tracks 2 and 3 read as reference), `docs/ARCHITECTURE.md` (sections 1 to 9, with
section 2's refund paragraph and section 4's refund allocation), `docs/reviews/architecture.md`
section 10 (re-review, R-01 to R-08 and the disposition table), `docs/reviews/b1-ledger-core.md`
(the parts covering F-B1-07 and the findings table), `docs/reviews/FINDINGS.md`,
`docs/DECISIONS.md` (all entries), `docs/PLAN.md`, `docs/handoffs/b2-implementation-notes.md`.

Existing code read in full: `db/migrations/0001` to `0004`, `db/client.ts`, `lib/stripe.ts`,
`lib/money/*` and their tests, `lib/ledger/post.ts`, `lib/ledger/policy-entries.ts` and its
test, `lib/payments/checkout.ts`, `lib/payments/collection.ts`, `lib/policy/*`,
`lib/broker/eligibility.ts`, `lib/broker/kyb.ts`, `lib/auth/session.ts`,
`lib/auth/current-user.ts`, `app/api/webhooks/stripe/route.ts`, the four other route handlers
under `app/api`, `app/policies/[policyId]/page.tsx`, `app/broker/*`, `app/globals.css`,
`scripts/check-payment-replay.ts`, `scripts/check-money-guards.ts`, `scripts/migrate.ts`,
`scripts/post-local-webhook.ts`, `scripts/seed.ts`, `package.json`, `.env.example`,
`.githooks/pre-commit`.

Not read: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`,
`GAP-REVIEW.md` (advisory catalogues, outside this slice), `docs/ATTACK-PLAN.md`,
`docs/PROVENANCE.md`, `docs/COMPLIANCE-MATRIX.md`, `docs/STATUS.md`. Absent files: none of the
mandatory files were missing. `.env.local` was copied from the main checkout and never printed,
logged or committed.

Provider documentation actually fetched (2026-09-08): `docs.stripe.com/refunds` (refund
statuses, the refund events table, failed refunds, refunds requiring action),
`docs.stripe.com/api/refunds/object` (the Refund object and its fields),
`docs.stripe.com/api/refunds/list` (the `payment_intent` filter used by the recovery path).

Acceptance criterion worked on: PLAN.md B5, "cancellation with real refund and clawback", plus
the two B2 review corrections the coordinator sent mid-slice (F-B2-02, F-B2-03). Planned checks,
all executed: `npm run typecheck`, `npm run build`, `npm test`, both migrations,
`npm run check:ledger-guards`, `check:ledger-seal`, `check:money-guards` on both databases,
`check:payment-replay`, the new `check:refund-replay`, a local end-to-end through the running
application, and the live Stripe refund.

## 2. Reading path, in order

1. `db/migrations/0005_cancellations_and_refunds.sql` — the one new table and the two new
   database facts.
2. `lib/money/premium.ts`, `cancellationBreakdown()` — every figure a cancellation owes.
3. `lib/money/refund-allocation.ts` — which Stripe payment gives the money back.
4. `lib/ledger/cancellation-entries.ts` — the four entries, with the worked example on top.
5. `lib/policy/cancel.ts` — who may cancel, what is refused, and the one transaction.
6. `lib/payments/refunds.ts` — the Stripe call, the recovery, and what each webhook does.
7. `app/api/webhooks/stripe/route.ts` — which event type reaches which handler.
8. `app/policies/[policyId]/cancel/page.tsx` — the preview, then
   `app/policies/[policyId]/page.tsx` for the explained amounts and the refund states.

Everything else is support: `lib/money/idempotency.ts` (how a key is derived, and when a new one
is allowed), `lib/payments/webhook-inbox.ts` (what to answer when the lease is refused),
`lib/policy/read.ts` (the two new reads the pages use).

## 3. The money, in one worked example

The recited example (DECISIONS.md): $1,200 written premium, California 2.35%, $25 fee, 15%
commission, policy effective 2028-03-01, cancelled effective 2028-06-09, day 100 of a 365-day
term.

```
written premium                                       120000 cents
earned  = floor(120000 x 100 / 365)                    32876      the insurer eats the fraction
unearned = 120000 - 32876                              87124      refunded
tax back = ceil(87124 x 235 / 10000)                    2048      capped at the 2820 charged
fee back                                                   0      earned at issuance, never refunded
refund   = 87124 + 2048                                89172      $891.72
clawback = floor(87124 x 1500 / 10000)                 13068      13068.6, rounded down
```

At cancellation, one transaction:

| entry | effective date | debit | credit |
|---|---|---|---|
| `premium_earned_to_date` | cancellation date | unearned_premium 32876 | earned_premium 32876 |
| `refund_requested` | cancellation date | unearned_premium 87124, premium_tax_payable 2048 | refund_payable 89172 |

The two together empty this policy's unearned premium: 32876 + 87124 = 120000. When Stripe's
webhook says the money left, one transaction again:

| entry | effective date | debit | credit |
|---|---|---|---|
| `refund_completed` | day the cash moved | refund_payable 89172 | cash_stripe 89172 |
| `commission_clawback` | day the cash moved | commission_payable 13068 | commission_expense 13068 |

The broker keeps 18000 - 13068 = 4932 cents, the commission on the premium the customer really
used. Cash entries carry the day the cash moved and premium entries the business date, exactly
as slice B2 does at issuance.

## 4. What was built

**Migration 0005** (applied to both databases, strictly additive): the table
`refund_allocations`, which records for each Stripe refund the payment it is created against,
the policy event that decided it, and its split into premium, tax and commission clawback. It is
a protected financial record: append-only trigger, TRUNCATE trigger, server-set `recorded_at`,
and `app_runtime` holds SELECT and INSERT only. A database CHECK keeps `amount_cents =
refunded_premium_cents + refunded_tax_cents`, which is the fee-is-never-refunded rule expressed
at the database boundary. A partial unique index makes "a policy is cancelled at most once" a
database fact.

Nothing else needed a schema change: `policy_events.event_type` already allowed `cancelled`,
`money_operations.kind` already allowed `stripe_refund`, and the six accounts the entries use
were seeded by migration 0001.

**The money rules** are pure functions with tests. `cancellationBreakdown()` returns earned and
unearned premium, the refunded tax, the fee (always zero), the total and the clawback in one
object; the preview screen and the execution both call it, so the screen cannot promise a figure
the ledger will not book. `refundedTaxCentsCappedAtCharged()` closes review finding F-B1-07: the
tax charged is rounded down and the tax refunded is rounded up, so a day-zero cancellation of a
100001-cent premium at 3% would give back 3001 for 3000 collected and leave
`premium_tax_payable` negative; the refund is capped at what was charged, and the test uses that
exact example and California's 2.35% variant of it.

**The allocation** (`allocateRefundNewestCollectionFirst`) splits a refund over the payments that
funded the policy, newest first, one slice per PaymentIntent. Every policy in v0 has one
collection, so there is one slice; the endorsement of slice B4 will add a second one and the
function already handles it, with a property test over many two-payment splits proving that
premium and tax always add up to the amount asked of Stripe and that no cent is created or lost.

**The cancellation** (`lib/policy/cancel.ts`) validates on the server: the owning broker or
staff operations, a bound and not already cancelled policy, a real calendar date inside the
term, and pro-rata only. Then one transaction writes the `cancelled` policy event carrying every
computed figure, the earning entry, and per Stripe payment a `stripe_refund` operation in status
`requested` with its allocation row and its `refund_requested` entry. Only after that commit is
Stripe called.

**The refund** (`lib/payments/refunds.ts`): `assertStripeSandbox()` first (AF-04), then
`recoverPendingRefund()` lists the refunds of the PaymentIntent and matches
`metadata.operation_id` before `create` is ever called, then `refunds.create` with the stable key
`policy-refund:<policy id>:<payment intent id>`. A provider error appends `failed` and leaves
the liability open and visible. `reissueRefund()` is the staff action after a failed refund: a
new operation, a new key, the same split, and no journal entry, because the liability was opened
once and must be cleared once.

**The webhooks** act on the refund's STATUS rather than on the event name. Stripe documents
`refund.created`, `refund.updated` and `refund.failed` and recommends listening to
`refund.created` at a minimum; an API card refund is normally already `succeeded` in its first
event, and the live run confirmed that all of `refund.created`, `refund.updated`,
`charge.refunded` and `charge.refund.updated` fired within the same second. So whichever event
first reports `succeeded` posts the completion, and the journal's unique key on (money
operation, entry type) makes every later delivery a no-op. `failed` and `canceled` post nothing
at all and leave `refund_payable` open, which is design finding R-01. `charge.refunded` is kept
as a confirmation and posts nothing.

**The screens.** `/policies/{id}/cancel?effectiveAt=...` previews without writing anything and
carries the policy version in a hidden field; the confirmation is refused if the policy changed
in between. The policy page then shows the same breakdown as explained amounts, read from the
cancellation event rather than recomputed, above the journal entries that book it, and lists the
refunds with requested and completed kept apart.

**Also, at the coordinator's request**, the two B2 review corrections, each in its own commit:
F-B2-02 (a refused webhook lease answers 503 unless the event is really handled) and F-B2-03 (an
expired Checkout Session starts a new payment attempt under a new idempotency key).

## 5. The live proof, and what the coordinator must do next

Run from this worktree against the trial database and the real Stripe sandbox, as the owning
broker through the running application:

```
POST /api/policies/31509261-.../cancel  effectiveAt=2026-10-31  calculationMethod=pro_rata
303 -> /policies/31509261-...?cancelled=1
```

CGP-01062 runs from 2026-10-01 to 2027-10-01, so 2026-10-31 is its term start plus 30 days, as
asked. Today is 2026-09-08, so that date is in the FUTURE. That is deliberate and it is not a
workaround: this policy was bound before its term starts, so a rule forbidding future dates would
make it impossible to cancel at all, and "cancel at the end of the month" is ordinary notice
practice. A past date is allowed too, because an insurer routinely learns late that cover stopped.

What it produced, all verified in the database and at Stripe:

```
cancellation event   effective 2026-10-31, method pro_rata, 30 of 365 days earned
earned premium       28362      floor(345075 x 30 / 365)
unearned premium    316713      refunded
tax refunded          7443      ceil(316713 x 235 / 10000), below the 8109 charged
fee refunded             0
total refund        324156      $3,241.56
commission clawback  47506      floor(316713 x 15%)
Stripe refund        re_3UDM4KK6R3v50tIy0scSGaps, status succeeded, livemode false,
                     metadata.operation_id 4bb39f3e-fe37-4cb4-9cd0-b8ac42ed34b1
policy               status cancelled; refund shown as "requested $3,241.56"
ledger               unearned_premium 345075 debit = 345075 credit (emptied),
                     refund_payable 324156 credit (open), global 1384287 = 1384287
```

CGP-01061 was not touched, as instructed.

**The completion is not posted yet, and it needs one action after deployment.** Stripe delivered
`refund.created`, `refund.updated` and `charge.refunded` to the deployed URL within a second of
the refund. The deployed revision is still B2, so the inbox stored all three and marked them
`ignored` with "no handler for refund.*". That is correct behaviour, and it is also a trap:

- a "Resend" from the Stripe dashboard replays the SAME event id, which the inbox deduplicates,
  and the processing row is `ignored`, which the lease does not pick up. Nothing would happen.
- the fix is to make Stripe emit a NEW event: after deploying, update the refund's metadata,
  which fires a fresh `refund.updated` with a new event id and status `succeeded`:

```
stripe refunds update re_3UDM4KK6R3v50tIy0scSGaps --metadata[posted_after_deploy]=true
```

That is a genuine provider event through the real webhook endpoint, visible in the Stripe
delivery log, and the new handler will post `refund_completed` (324156) and
`commission_clawback` (47506) and clear `refund_payable` to zero. The operation already carries
the refund id, so the handler finds it by metadata either way.

The alternative, if the team prefers not to touch the refund, is the staff replay action the
design promises in section 5 (re-lease an `ignored` event); it does not exist yet and is not in
this slice.

## 6. Assumptions, all visible in the code or the interface

1. **A future-dated cancellation is allowed** (section 5 explains why it has to be). The
   consequence to know: for a policy whose refund is paid before the cancellation takes effect,
   an as-of view between the two dates shows `refund_payable` with a debit balance, the mirror
   of the negative `premium_receivable` that slice B2 documented for a policy paid in advance.
2. **The clawback is decided at cancellation time and stored on the allocation row**, then
   posted unchanged when the refund completes. The broker sees the figure before confirming and
   the ledger books that same figure even if the commission rate changes in between.
3. **The residual cent of a multi-payment refund** lands on the oldest payment touched. Not
   reachable in v0 (one collection per policy); tested for B4.
4. **`created_by` on a cancellation is the signed-in user**; the refund operation carries the
   same id. The webhook-driven entries carry no user, like B2's collection entries.
5. **The tax refund follows the premium** and is capped at the tax charged. The California base
   is gross premiums less return premiums (Cal. Const. art. XIII s. 28(c)), which supports the
   rule; the per-policy treatment remains this build's stated rule, not a legal claim.

## 7. Deviations from the assignment, and why

- **Posting on the refund's status, not on `refund.updated` alone.** The assignment named
  `refund.updated` as the posting event. Stripe's documented contract makes that unsafe on its
  own: an API card refund is normally `succeeded` in its very first event, and the docs
  recommend listening to `refund.created` at a minimum. Posting on whichever event first reports
  `succeeded` is one rule for four events, and the unique key still guarantees a single posting.
  `refund.failed` and a `canceled` status still post nothing, as R-01 requires.
- **`proRataCancellationRefund()` was replaced rather than kept.** It computed an uncapped tax
  refund and was used only by its own tests; leaving it next to the capped function would have
  been an invitation to call the wrong one. Its test cases moved to `cancellationBreakdown()`.
- **An expired Checkout Session reuses the existing `payment_failed` status** instead of a new
  `payment_expired` value. The coordinator allowed either. `payment_failed` already lets the
  broker pay again, and adding a value would have meant dropping and recreating the CHECK
  constraint on `policy_current` in a second migration, which is not additive. The precise
  reason is on the operation event (`stage: checkout_session, reason: expired`).
- **`refundIdempotencyKey` uses `:<attempt>` for later attempts**, the same shape the coordinator
  specified for checkout keys, so the two keys read alike. First attempts are unchanged.
- **`startCheckout` and `brokerKybState` gained a database parameter**, following the pattern
  `lib/payments/collection.ts` already used, so the checks exercise the production code.
- **`existingCheckoutOperation` had no ORDER BY** and would have picked an arbitrary operation
  once a policy had two; it is now `latestCheckoutOperation`, ordered by creation time.

## 8. Commands actually run, with results

All from the worktree root.

```
$ npm run typecheck            exit 0
$ npm run build                exit 0, 15 routes
$ npm test                     82 tests, 82 pass, 0 fail   (56 before this slice)
$ npm run migrate              applied 0005 on the trial database, then skip on re-run
$ npm run migrate -- --database=test   applied 0005 on corgi_test, then skip on re-run
$ npm run check:ledger-guards          10 PASS, 0 FAIL, exit 0
$ npm run check:ledger-seal             4 PASS, 0 FAIL, exit 0
$ npm run check:money-guards           51 PASS, 0 FAIL, exit 0   (43 before)
$ npm run check:money-guards -- --database=test   51 PASS, 0 FAIL, exit 0
$ npm run check:payment-replay         22 PASS, 0 FAIL, exit 0   (15 before)
$ npm run check:refund-replay          27 PASS, 0 FAIL, exit 0   (new)
```

`npm run check:refund-replay`, the lines that matter:

```
PASS  the breakdown is the recited one  (earned 32876, unearned 87124, tax 2048, refund 89172, clawback 13068)
PASS  the cancellation posts the earning entry and the refund request, and nothing else
PASS  the whole written premium has left the unearned liability  (120000 cents)
PASS  the customer is owed the refund, and it is not paid yet  (refund_payable net -89172)
PASS  the same policy cannot be cancelled twice  (this policy is already cancelled)
PASS  the first refund.updated posts the completion  (outcome: posted)
PASS  a second delivery of the same refund is recognised as already posted
PASS  the completion and the clawback are posted exactly once each
PASS  the customer is owed nothing any more: refund_payable is back to zero
PASS  the broker keeps commission on the earned premium only  (net -4932 after a 13068 clawback on 18000)
PASS  a refund for another amount is refused, not journaled
PASS  a failed refund posts NO journal entry
PASS  the customer is still owed the money: refund_payable stays open  (net -89172)
PASS  re-issuing creates a new operation with a new idempotency key  (...:2)
PASS  re-issuing posts NO journal entry: the liability was opened once
PASS  the customer was paid once, whatever the number of attempts
PASS  every journal line in the database balances  (debits 2333856 = credits 2333856)
```

`npm run check:payment-replay`, the new expiry case (it creates two real test-mode Checkout
Sessions):

```
PASS  clicking Pay twice reuses the same hosted page
PASS  one payment attempt exists so far, under the first key  (policy-checkout:<policy>)
PASS  checkout.session.expired is recorded on the operation
PASS  an expired session posts no journal entry: no money moved  (0 journal entries)
PASS  after the expiry, a new Pay click opens a SECOND session
PASS  the second attempt has its own idempotency key  (policy-checkout:<policy>:2)
PASS  the two attempts are two different Stripe sessions  (cs_test_b1Qu4m... then cs_test_b1q5Y2...)
```

### Local end-to-end, on the running application

Against the TRIAL database (read-only paths, then the one real cancellation of section 5):

```
preview 2026-10-31 as the owning broker  -> $283.62 earned, $3,167.13 unearned, $74.43 tax,
                                            $0.00 fee, $3,241.56 total, $475.06 clawback,
                                            pi_3UDM4KK6R3v50tIy0F5xaBbu, version 2:8f329152-...
preview as staff_ops                     -> the same figures
preview as staff_approver                -> "only the broker who owns this policy, or staff
                                            operations, can cancel it"
preview as the customer                  -> the same refusal, and no policy figure is shown
preview with no session                  -> 307 /login
effectiveAt=2026-09-30 (before the term) -> "a cancellation cannot take effect before the policy
                                            starts (2026-10-01)"
effectiveAt=2027-10-02 (after the term)  -> "the policy ends on 2027-10-01"
effectiveAt=2026-02-30 / tomorrow        -> "is not a calendar date"
no date at all                           -> back to the policy, "pick a cancellation date first"
POST with a stale policyVersion          -> "this policy changed since the preview was computed"
POST with calculationMethod=short_rate   -> "this build only computes pro-rata cancellations"
POST with no policyVersion field         -> "the confirmation form is incomplete"
POST as the customer / with no session   -> refused / 303 to /login
```

Every one of those refusals was checked to have written nothing: before the real cancellation the
policy still had exactly its two events, no refund operation, no allocation and its four
issuance entries.

Against the DISPOSABLE database only (a second dev server pointed at `corgi_test`), locally
signed events through the real HTTP route, which is a development tool and never evidence of a
Stripe delivery:

```
refund.updated succeeded, delivery 1     -> 200 {"status":"done"}      entries posted
refund.updated succeeded, delivery 2     -> 200 {"duplicate":true,"reason":"already done"}
refund.updated, a DIFFERENT event id     -> 200 "already posted by an earlier delivery"
refund.created for the same refund       -> 200 "already posted by an earlier delivery"
refund.failed after the success          -> 200 "nothing posted, the refund is still owed",
                                            no journal entry, flagged needs_human
inbox row forced to 'processing', resend -> 503 "another delivery is processing this event, or
                                            one died before it committed; Stripe should retry"
checkout.session.expired, twice          -> 200 done, then 200 duplicate; 'failed' event with
                                            reason 'expired' on the operation
```

## 9. What was NOT verified, and why

- **The completion webhook on the deployed application.** It cannot happen before the code is
  deployed; section 5 gives the exact command that makes Stripe emit a fresh event afterwards.
  Until then `refund_payable` legitimately shows 324156 cents open on CGP-01062.
- **A refund that really fails at Stripe.** Stripe's test mode gives no documented way to force
  `refund.failed` on a card refund, so the failure path was exercised through the production
  functions (`check:refund-replay`) and through the HTTP route on the disposable database, not
  with a provider-generated failure.
- **The re-issue route over HTTP.** The database half is covered by `check:refund-replay`; the
  route is four lines around it and was type-checked and built, not clicked.
- **The tax cap in a real cancellation.** It cannot trigger on either demo policy (both are far
  from the fractional-cent edge); it is covered by unit tests with the exact 100001-cent example
  from the B1 review.
- **A second collection on one policy** (the two-slice allocation). B4 does not exist yet, so it
  is covered by unit tests only.
- **Concurrent cancellations of the same policy.** The database refuses the second one (unique
  index on the `cancelled` event, unique idempotency key on the refund operation), and the
  serial second attempt was tested; two truly simultaneous requests were not run.
- **Independent review.** Not performed by this delegate, by design.
- **Walkthrough with Yoann: NOT REVIEWED WITH YOANN.**

## 10. Needs a decision or an action

1. **Maker-checker does not cover this refund yet, and the threshold was already crossed.**
   DECISIONS.md (2026-09-08, 08:04) sets money-out above $1,000 as needing a distinct human
   approver. The live cancellation sent $3,241.56 with no approval, because the approval queue
   is slice B7 and does not exist. Slice B7 must route `stripe_refund` operations above the
   threshold through the queue before `issueRefundsAtStripe` is called; the split between
   `recordCancellation` (database) and `issueRefundsAtStripe` (provider) is already the seam for
   it. This is the most important open item of the slice.
2. **The completion of `re_3UDM4KK6R3v50tIy0scSGaps` after deployment** (section 5). Until it is
   done, the reconciliation screen of B10 will correctly show a non-zero `refund_payable` with
   its age.
3. **`assertCancellationAllowed(policy)`** in `lib/policy/cancel.ts` is the hook B7 extends. The
   written rule is in the comment above it: an open claim does not block a cancellation and does
   not change the refund, because the refund gives back unearned premium only while the claim is
   a loss that happened while the policy was in force.
4. **A staff replay action for `ignored` inbox events** is now clearly needed (it is what section
   5 works around). The design promises it in section 5 of ARCHITECTURE.md; it belongs to B6 or
   B13.
5. **`webhook_processing` still has a table-wide UPDATE grant** (review finding F-B1-10, still
   open). Not touched here to stay inside this slice; it is a two-line column-level grant in a
   future migration.
6. **The refund of a policy paid before its term starts** produces the as-of oddity described in
   section 6.1. Worth one sentence in the README limitations next to B2's mirror case.
