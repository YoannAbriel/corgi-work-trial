# Slice B10: reconciliation against Stripe and the claim payout rail

Written by the B10 delegate builder on branch `worktree-agent-a58157f24b9758bdf`. The coordinator
merges, reviews, deploys and owns STATUS, DECISIONS and FINDINGS; nothing in those files was
touched here.

## Corrections after the independent review (docs/reviews/b10-reconciliation.md, FAIL)

Six findings answered, in the order the reviewer numbered them. F-B10-07, F-B10-08 and F-B10-09
are deliberately left open and are listed at the end of this section.

**F-B10-01 (HIGH), a break that ages out of the window read as resolved.** A run only compares what
falls inside its window, so a break older than the seven-day default was compared by nobody, left
the open list on its own and was filed under "breaks that went away". The screen answered "is this
break in the latest run" when an operator asks "is this break explained".

Migration 0016 stores the DATE OF THE COMPARED RECORD on each item: the provider's created time,
or the money operation's creation time when there is no provider record. A break is now resolved
only by a later COMPLETE run OF THE SAME SOURCE whose window CONTAINS that date and which reports
it as matched or not at all. A break nobody re-examined stays open with its age. The daily job
opens its window backwards far enough to cover the oldest open break, capped at the 31-day
maximum; beyond that cap the break is not covered, so it is not resolved either, and the job's
answer says how far it reached (`reachesTheOldestOpenBreak`) rather than hiding the gap. Closing
such a break needs a staff run with an explicit window on the screen.

The column is nullable on purpose: `reconciliation_items` is a protected append-only table, so a
migration may add a column but must never write a value into rows that already exist. Items
written before 0016 use their first-seen instant instead, which is inside the window of the run
that reported them, so one rule covers old and new items.

**F-B10-02 (MEDIUM), the age reset when a break changed classification.** Two things left the key.
The classification, now an attribute of the item read from the latest run that reported it. And
the precedence between the two references: our money operation id comes first when there is one,
because it exists from the moment we intend to move money and never changes, where a provider
reference appears late. Keying on the provider reference first would have broken the identity of
the reviewer's own example, a refund that is `stale` while the ledger is alone with it and
`provider_only` the day Stripe lists it.

**F-B10-03 (MEDIUM), the clearing balances list.** Built, in `lib/reconciliation/clearing-balances.ts`
and on the screen: the four clearing accounts, per policy and per claim, read from the journal with
NO window, so nothing here can be missed for being old. It is the second net under the break list
and it says so on the page. This also closes F-B4-02 in the register, which was deferred to B13
presuming a list that did not exist.

**F-B10-04 (LOW), a failure after the fetch left no run at all.** The storing step is now inside a
try of its own, so a failure there leaves a failed run carrying its reason. The per-source loop is
wrapped too, so a source whose failure cannot even be recorded reports itself with no run id and
does not stop the source after it.

**F-B10-05 (LOW), the banner overstated.** Computed per source, from the latest run of each; one
banner per source that is actually failing.

**F-B10-06 (LOW), the dropped PaymentIntent statuses.** The run note now counts the PaymentIntents
it did not compare, by status, or says outright that none was left out.

**Left open, and why.** F-B10-07 (unbounded reads): `resolvedBreaks` now applies its limit in SQL,
but `openBreaks` is deliberately still unbounded, because it is the one list whose whole purpose is
that nothing is forgotten and a limit would silently drop rows. F-B10-08 (the deployed board is all
sandbox probes) and F-B10-09 (two ledger records sharing one provider reference) are untouched and
belong to the coordinator to schedule. One consequence of the F-B10-01 fix worth expecting: breaks
that used to disappear now stay, so the deployed board will be longer than it was.

## What the slice does

A job pulls a provider's own records for a time window, reads what our ledger says about the same
money, compares the two and stores the comparison. Two providers, one code path:

| Source | Mode | Where its records come from |
|---|---|---|
| `stripe` | LIVE SANDBOX | `paymentIntents.list`, `refunds.list` and `balanceTransactions.list` over the API, paginated |
| `claims_rail` | LOCAL SIMULATOR | `simulator_provider_records`, the rail's own append-only table, written only by `lib/rails/simulator.ts` |

Five classifications, one item per record compared: `matched`, `local_only`, `provider_only`,
`amount_mismatch`, `stale`. Every run stores a summary and its items in two append-only tables
with the same guards as the money tables. A failed fetch stores a failed run with its reason and
no items at all, so it can never be read as "zero breaks".

The screen is `/ops/reconciliation`, staff only, linked from `/ops`.

## The reading path, file by file

Read in this order. Each line says what the file is for.

1. `db/migrations/0011_reconciliation.sql` - the two tables, their guards, their grants, and the
   CHECK constraints that stop a failed run from claiming it compared anything;
   `db/migrations/0017_reconciliation_item_record_date.sql` - the record date each item carries,
   which is what lets a later run say whether it re-examined a break or never looked at it.
2. `lib/reconciliation/window.ts` - what a time window is, how a typed date is read, why the
   default is seven days and why a maximum exists.
3. `lib/reconciliation/breaks.ts` - the identity of a break across runs (`breakKey`) and how its
   age is put into words. Pure, no clock of its own.
4. `lib/reconciliation/diff.ts` - THE FILE TO READ FIRST if you only read one. The whole
   comparison: two lists in, classified items out, no database, no provider, no clock. Every rule
   in it is a unit test in `diff.test.ts`.
5. `lib/reconciliation/ledger-side.ts` - our side, in one SQL query: the signed cash movement of
   each money operation, reversals included, plus what is still open on its clearing account.
6. `lib/reconciliation/stripe-records.ts` - Stripe objects to plain records. Pure, so it is tested
   on a captured sandbox listing with no network.
7. `lib/reconciliation/stripe-source.ts` - the network half of Stripe: three paginated listings,
   the sandbox assertion, and the staleness threshold.
8. `lib/reconciliation/claims-rail-source.ts` - the rail's half: its own rows folded into one
   record per transfer, and why a returned transfer counts as money that did not stay out.
9. `lib/reconciliation/source.ts` - the three fields a provider has to expose. Ten lines.
10. `lib/reconciliation/run.ts` - the job: fetch first, compare, then store the run and its items
    in one transaction. The failed-run path is the important part.
11. `lib/reconciliation/read.ts` - what the screen reads, and where the rule that decides whether
    a break is open or resolved lives. Read the two SQL fragments at the top before the functions.
12. `lib/reconciliation/clearing-balances.ts` - the four accounts that must end at zero, read from
    the journal with no window at all.
13. `app/api/jobs/reconcile/route.ts` - one endpoint, two callers (the cron secret and a staff
    session), two answers (JSON and a redirect).
14. `app/api/jobs/daily/route.ts` and `vercel.json` - the one scheduled job: recover, settle,
    reconcile, in that order, over a window widened to cover the oldest open break.
15. `app/ops/reconciliation/page.tsx` - the screen.
16. `scripts/check-reconciliation.ts` - the proof, end to end, on the disposable database.

Two supporting changes outside the slice, both mechanical:

- `lib/payments/refund-state.ts` is new: `refundStateFromEvents` moved out of
  `lib/payments/refunds.ts` into a file with no imports, because the reconciliation job needs the
  rule and `refunds.ts` opens the database pool and the Stripe client as soon as it is loaded.
  `refunds.ts` re-exports both names, so no existing caller changed.
- `lib/claims/settle-due-payouts.ts` is new: the body of
  `app/api/jobs/settle-simulated-payouts/route.ts` moved into a function, so the daily job runs
  exactly the same code as the standalone endpoint. The route is now four lines of authorisation
  and a call.

## Who may run it

`POST /api/jobs/reconcile` accepts two callers and nobody else:

- the daily job, with `Authorization: Bearer <CRON_SECRET>`, and it answers with a JSON summary;
- a signed-in `staff_ops` or `staff_approver` session pressing "Run now", and it answers with a
  redirect back to the screen.

A broker or a customer session falls through to the cron-secret check and gets a 401. The job
cannot move money: it reads the provider, reads the ledger with the runtime role, and appends to
its own two tables. It is authorised at all because it calls Stripe (so it is not free) and
because its runs are records of what we knew.

`/api/jobs/daily` takes the cron secret only: there is no staff path into it, because it runs the
recovery and the settlement jobs as well.

## The rules the comparison applies

Both sides speak the same language: money in is positive, money out is negative, in cents.

- **matched** - same operation, same signed amount. Also: a payment parked in the suspense account
  (`unapplied_cash_received` moves `cash_stripe`, so it is matched cash whatever the policy
  status); an operation whose entries were reversed by a correction, when the provider shows
  nothing for it (both sides at zero); a refund or a payout the provider refused or returned, when
  the ledger booked no cash for it.
- **local_only** - the ledger booked cash and the provider has no record of it in the window.
- **provider_only** - the provider moved money and the ledger has no cash entry for it. Three ways
  in: a PaymentIntent with no `metadata.operation_id` at all, a PaymentIntent naming an operation
  we do not have, and an operation the provider settled while our books did not (a missing webhook
  or an unrun settlement job). A reversed operation for which Stripe shows a succeeded payment is
  provider-only too: that is real money with nothing left in the ledger.
- **amount_mismatch** - same operation, both sides moved money, different amounts. The difference
  is signed, provider minus ledger, so a negative number reads "the provider holds less than the
  books say".
- **stale** - money out promised long ago and still not confirmed either way.

Stripe fees are not journaled in this build (`cash_stripe` is gross of fees, disclosed in the
README, design finding F-13). The fee is carried on the matched item as information, and the run
note says which balance transactions were seen and deliberately not reconciled.

## Decisions the coordinator has to put to Yoann

1. **The two staleness thresholds are assumptions of this build, not provider guarantees.**
   - Stripe: **24 hours**. A refund neither completed nor refused after a day is reported stale.
     Reasoning: card refunds settle in minutes at Stripe, and the 5 to 10 business days Stripe
     documents are for the money to reach the cardholder, not for Stripe to answer.
   - Claim payout rail: **72 hours**. The simulator settles two calendar days out, so three days
     is one full day past its own promise. A real ACH credit would be one to three BUSINESS days
     and this simulator models no banking calendar.
   Both are single constants (`STRIPE_STALE_AFTER_HOURS`, `CLAIMS_RAIL_STALE_AFTER_HOURS`), both
   are printed on the screen as assumptions, and changing either is a one-line edit.
2. **The order of the daily job**: recover stuck operations, then settle the simulated payouts,
   then reconcile. The reasoning is that a comparison run on a half-recovered ledger reports
   breaks that are not real. If Yoann prefers reconciling first (so the morning report shows the
   overnight state before anything is repaired), it is a reordering of three lines.
3. **One daily cron at 06:00 UTC** on a single endpoint, because Vercel's Hobby plan allows only a
   small number of cron jobs at a daily granularity. Three schedules would need a paid plan.

## Deviations from the brief given to this slice, and why

- **The daily endpoint answers GET as well as POST.** The instruction said POST. Vercel Cron
  invokes a path with a **GET** request (Vercel docs, cron jobs quickstart, read 2026-09-08), so a
  POST-only endpoint would never run. Both methods go through the same authorisation and the same
  work; POST is kept so the endpoint can be driven by hand like the other job endpoints.
- **The items table is `reconciliation_items`, not `reconciliation_breaks`** as
  `docs/ARCHITECTURE.md` section 1 names it. Every record compared produces an item, matched or
  not, so the run counts add up to what was actually compared and a "clean" run says how much it
  looked at. A break is an item whose classification is not `matched`. The architecture document
  is the coordinator's to update.
- **The check script uses the captured Stripe listing with rewritten ids and amounts.** The
  objects are the real sanitized sandbox capture; only which operation each one names, and for how
  much, is rewritten, because the check runs on the disposable database, which does not contain
  the demo policy the captured ids belong to. The mapping itself is unit-tested on the untouched
  fixture. The run stores a note starting with `FIXTURE (captured sandbox listing, no network
  call)`, so nobody reading the run history can mistake it for a live comparison.
- **`lib/reconciliation/fixtures/stripe-window-listing.json` was recaptured** with
  `.local/capture-stripe-fixtures.ts` (git-ignored) because the previous draft typed a `livemode`
  field on Stripe Refunds that the API does not return (checked against the stripe 22.6.1 SDK
  types). The live-mode guard now reads the PaymentIntents, which are the only objects in the
  listing carrying the flag; `assertStripeSandbox()` and the database CHECK on `webhook_events`
  remain the other two layers.
- **The architecture also asks the reconciliation screen to list non-zero clearing balances with
  their age** (section 1). That list is not built. What is built instead: every ledger record
  carries `openClearingCents`, the net movement of its own clearing account, and the notes on
  stale and provider-only breaks say how much is still open on it. A separate account-level list
  is a small addition and is left to the coordinator to schedule.

## Two real defects the check script found before it passed

Both were in code that type-checked, built and looked right.

1. **The ledger side saw no cash at all on the payout rail.** A claim payment's journal entries
   are filed under its CLAIM EVENT (`source_kind = 'claim_event'`), not under the money operation,
   because that is what makes a replayed settlement job post once. The first version of
   `ledger-side.ts` only attributed entries whose source kind was `money_operation`, so every
   settled payout looked like a provider-only break. The query now also joins `claim_events` on
   its `money_operation_id`.
2. **A provider record stamped a moment after the clock a run was given read as minus one hour of
   waiting.** `hoursBetween` now never returns a negative number, because the provider's clock and
   ours are not the same clock.

## Things worth knowing before the next run

- **Each run of `check:reconciliation` creates one real PaymentIntent of $42.42 in the Stripe
  sandbox**, with a published test payment method, no metadata and a description starting with
  `corgi_probe`. It is meant to stay there: it is the planted provider-only break. Two exist so
  far (`pi_3UDQN7K6R3v50tIy0fdlIi1Q` and `pi_3UDQPZK6R3v50tIy0hKAIFiq`), and the README already
  discloses that probe payments exist in the sandbox.
- **`corgi_test` is shared with the B4 builder.** The check narrows its window to the instant it
  starts, so another slice's rows do not become its breaks, and it asserts per reference rather
  than on totals. The first run of the check reported three extra local-only items that came from
  another check running at the same time; the second run, after the fixes, did not.

## Commands run, with results

All on this branch, in this worktree.

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run build` | compiled, including `/ops/reconciliation`, `/api/jobs/reconcile`, `/api/jobs/daily` |
| `npm test` | 344 pass, 1 skipped (the pre-existing live Stripe test, gated on `RUN_LIVE_STRIPE_TESTS`) |
| `npm run check:reconciliation` | 39 of 39 PASS after the review corrections, 29 of 29 before them |
| `npm run check:money-guards -- --database=test` (after the corrections) | 155 of 155 PASS, exit 0, the same figure the reviewer measured on a solo run |
| `npm run check:claims-and-approvals` (after the corrections) | 63 of 63 PASS, exit 0 |
| `npm run check:money-guards -- --database=test` (at the first delivery) | 128 of 128 PASS (110 before this slice, plus the two new tables and their constraints) |
| `npm run check:claims-and-approvals` (at the first delivery) | 55 of 55 PASS, unchanged by this slice |

The screen was rendered for real, not only built: a dev server on port 3400 pointed at the
disposable database (a git-ignored `.local/` aid, because the trial database has no 0011 tables
yet), signed in as a staff user, and `/ops/reconciliation` returned 200 with the failed-run
banner, the open breaks with their ages and amounts, the run history and the resolved break.

The endpoints were called over HTTP on that same server, all five paths:

| Call | Answer |
|---|---|
| `POST /api/jobs/reconcile`, no credential | 401, "this job endpoint needs the cron secret as a bearer token" |
| `POST /api/jobs/reconcile`, cron secret | 200, a JSON summary of both runs |
| `GET /api/jobs/daily`, no credential | 401 |
| `GET /api/jobs/daily`, cron secret (what Vercel Cron sends) | 200, the three steps in order |
| `POST /api/jobs/reconcile`, staff session and form body | 303 to `/ops/reconciliation?ran=...` with a readable summary |
| `POST /api/jobs/reconcile`, staff session, window "last tuesday" | 303 to `/ops/reconciliation?error=...` with the refusal |

The dev server was stopped afterwards and port 3400 is free. Note on the daily job run: its
recovery step went looking at Stripe for the fabricated PaymentIntent references that other checks
have left in the disposable database, and reported "No such payment_intent" for each. Those are
read-only lookups, no money moved, and they are an artefact of running the daily job against a
database full of synthetic operations, not a defect.

`npm run migrate -- --database=test` reported `0011_reconciliation.sql` as already applied: the
previous builder of this slice had applied the identical file to `corgi_test` at 13:50Z, and the
columns in the database match the file exactly (checked column by column). The trial database has
NOT been migrated from this worktree.

One thing to know about migration 0016. It was written and applied to `corgi_test` as 0013, and
main then merged its own `0013_low_findings.sql`; two files sharing a number is what finding
F-B3-09 caught once already, so it was renumbered to the next free slot. The runner applies a file
once per NAME, so `corgi_test` has both names in `schema_migrations` and the column exists once;
`add column if not exists` is what makes the second name a no-op there. On the trial database only
0016 will ever be applied, as an ordinary creation.

## What is not verified here

- **The deployed application.** The screen, the "Run now" form and the cron have only been
  exercised locally and through the check script. Running `/api/jobs/reconcile` from the deployed
  URL, and confirming that the Vercel cron actually fires on `/api/jobs/daily`, are the
  coordinator's after the merge. `vercel.json` is new, so the cron only exists once this branch is
  deployed to production.
- **`CRON_SECRET` in the deployment.** The job endpoints fail closed when it is missing or shorter
  than 16 characters, so this has to be set in the Vercel project before the cron can do anything.
- **A window larger than a few hundred provider objects.** The Stripe listing is paginated and
  capped at 10000 objects per listing, and the window is capped at 31 days, but no run of that
  size has been timed.
- **Independent review.** None has been requested or performed for this slice.
