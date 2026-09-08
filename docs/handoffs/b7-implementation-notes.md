# Slice B7 implementation notes (claims, reserves, payout simulator, maker-checker)

Written by the B7 delegate on 2026-09-08. Branch `worktree-agent-a801f173f5bb5852a`, worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/agent-a801f173f5bb5852a`, eleven
commits on top of `109dafb` plus a merge of `main` at `faa12a8`. Nothing was pushed, nothing was
deployed, no shared planning file was edited.

**Read section 9 first if you are the coordinator: the migration was renamed to
`0008_claims_and_approvals.sql` after it had already been applied to both databases under the
name `0007_claims_and_approvals.sql`, so `npm run migrate` must not be run on either database
until that record is corrected.**

Closes finding **B5-MC**: the live refund of $3,241.56 crossed the $1,000 money-out threshold
with no human approver because the queue did not exist. It exists now, and the same gate covers
claim payments. Also closes the two B5 review findings the coordinator sent mid-slice, **F-B5-02**
(a create-stage failure must be retried under the same key, not re-issued) and **F-B5-03** (a
refund stuck in `requested` had no resume action).

## 1. Startup receipt

Read in full before writing any code: `CLAUDE.md`, `AGENTS.md`, `AUTOMATIC-FAILS.md`,
`READABLE-CODE.md`, `WORKFLOW-48H.md`, `REVIEWER.md`, `docs/BRIEF-REFERENCE.md` (general and
Track 1; Tracks 2 and 3 read as reference), `docs/ARCHITECTURE.md` (all nine sections, with
section 2's claim example, section 4's simulated rails, section 6's approvals and section 7's
jobs), `docs/reviews/architecture.md` (sections 1 to 3 and section 10 in full, F-06, F-10, F-21,
R-04), `docs/DECISIONS.md` (every entry), `docs/reviews/FINDINGS.md`, `docs/PLAN.md`,
`docs/handoffs/b5-implementation-notes.md`. `docs/handoffs/b2-implementation-notes.md` was read
for its money-operation and webhook sections rather than end to end.

Existing code read in full: `db/migrations/0001` to `0005`, `db/client.ts`, `lib/ledger/post.ts`,
`lib/ledger/reverse.ts`, `lib/ledger/cancellation-entries.ts`, `lib/ledger/policy-entries.ts`
(the parts the entry builders reuse), `lib/policy/cancel.ts`, `lib/policy/current.ts`,
`lib/policy/read.ts`, `lib/policy/status.ts`, `lib/policy/terms.ts`, `lib/payments/refunds.ts`,
`lib/payments/checkout.ts`, `lib/money/*` (cents, dates, idempotency, premium),
`lib/auth/session.ts`, `lib/auth/current-user.ts`, `app/policies/[policyId]/page.tsx`,
`app/policies/[policyId]/cancel/page.tsx`, `app/broker/page.tsx`, the five route handlers under
`app/api`, `app/globals.css`, `scripts/check-money-guards.ts`, `scripts/check-refund-replay.ts`,
`scripts/migrate.ts`, `scripts/seed.ts`, `package.json`, `.gitignore`, `.githooks/pre-commit`.

Not read: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`,
`GAP-REVIEW.md` (advisory catalogues, outside this slice), `docs/ATTACK-PLAN.md`,
`docs/COMPLIANCE-MATRIX.md`, `docs/STATUS.md`, `docs/PROVENANCE.md`. Absent files: none of the
mandatory files were missing. `.env.local` was copied from the main checkout and never printed,
logged or committed.

No provider documentation was fetched: this slice makes no new provider call. The only Stripe
code it touches is the existing refund path, and its behaviour is unchanged.

Acceptance criterion worked on: `docs/PLAN.md` B7. Planned checks, all executed: `npm run
typecheck`, `npm run build`, `npm test`, `npm run check:money-guards` on both databases, the new
`npm run check:claims-and-approvals`, `npm run check:refund-replay` (to prove B5 still holds) and
`npm run check:ledger-guards`.

## 2. Reading path, in order

1. `db/migrations/0008_claims_and_approvals.sql` — the six new tables and the one rule that is a
   database trigger rather than code.
2. `lib/claims/money-position.ts` — what a claim's reserve, paid and incurred mean, and the
   identity the whole slice rests on.
3. `lib/ledger/claim-entries.ts` — the six entries, with the worked example on top.
4. `lib/claims/limits.ts` — the three ceilings a payment has to clear.
5. `lib/claims/claims.ts` — opening a claim, moving the reserve, and the lock every money
   decision takes first.
6. `lib/claims/payments.ts` — the bank account, asking to pay, and the three rail stages.
7. `lib/approvals/threshold.ts`, `intent.ts`, `approvals.ts` — the second human above $1,000.
8. `lib/rails/simulator.ts` and `lib/rails/bank-verification-simulator.ts` — the two LOCAL
   SIMULATORs.
9. `lib/policy/cancel.ts` (the added block in `recordCancellation` and `cancelPolicy`) and
   `lib/payments/refunds.ts` (`assertRefundMaySend`, `sendRequestedRefund`, `reissueRefund`) —
   the same gate on the refund path.
10. `app/ops/claims/[claimId]/page.tsx`, then `app/ops/approvals/page.tsx`.

Everything else is support: `lib/claims/coverage.ts` (whether a loss is covered),
`lib/claims/read.ts` (the reads the screens use), `lib/jobs/authorize.ts` (the cron secret),
`lib/payments/recover.ts` (finishing operations nobody finished).

## 3. The money, in one worked example

The example of `ARCHITECTURE.md` section 2, which the entry builders, the unit tests and the
check script all follow: reserve $5,000, lowered to $4,000, payment $1,200 sent, settled, then
returned by the bank.

```
                              entry                    debit                    credit
reserve set $5,000            claim_reserve_set        incurred_loss_expense    claim_reserve
                                                       500000                   500000
reserve lowered to $4,000     claim_reserve_adjusted   claim_reserve            incurred_loss_expense
                                                       100000                   100000
payment $1,200 sent           claim_payment_sent       claim_reserve            claims_payable
                                                       120000                   120000
settled two days later        claim_payment_settled    claims_payable           cash_claims_rail
                                                       120000                   120000
returned by the bank          claim_payment_returned   cash_claims_rail         claims_payable
                                                       120000                   120000
                              claim_reserve_restored   claims_payable           claim_reserve
                                                       120000                   120000
```

And the number that matters, after every one of those steps:

```
step                     paid      reserve   incurred    incurred_loss_expense balance
reserve set                 0       500000     500000       500000
reserve lowered             0       400000     400000       400000
payment sent           120000       280000     400000       400000
settled                120000       280000     400000       400000
returned                    0       400000     400000       400000
```

`incurred = paid + reserve` holds at every step, and it equals the journal balance of
`incurred_loss_expense` at every step. `scripts/check-claims-and-approvals.ts` asserts both, from
two independent sources (the fold of `claim_events` and the journal), after each transition.

Reading `cash_claims_rail`: this build does not model funding the payout account, so the account
carries a credit balance equal to the cash that has left through the claims rail. Read it as
"paid out through the rail", not as "cash we hold". That is design re-review item R-04, stated
rather than papered over.

## 4. What was built

**Migration 0008** (applied to both databases, strictly additive). Six new protected financial
records, each with the same three guards as every money table since 0001 (an append-only trigger
for UPDATE and DELETE, a TRUNCATE trigger, a server-set recording time) and `app_runtime` holding
`SELECT` and `INSERT` only: `claims`, `claim_events`, `claimant_bank_accounts`,
`approval_requests`, `approval_decisions`, `simulator_provider_records`. Two nullable columns are
added to `money_operations` (`claim_id`, `approval_request_id`), both already named by
`ARCHITECTURE.md` section 4, plus a partial unique index making "one approval funds at most one
money operation" a database fact. **No mutable table is added**: a claim's reserve, what it has
paid and whether it is closed are folded from its events, so nothing about a claim is stored as a
second truth that could drift from the journal.

**Maker-checker is a database rule, not only code.** A trigger on `approval_decisions` refuses a
decision whose author is the requester, whose author does not exist, or whose author's role is
not exactly `staff_approver`. That last branch is also what will refuse the `agent` principals of
the MCP surface in B11: they will be users with the role `agent`, and the trigger demands
`staff_approver`. `scripts/check-money-guards.ts` proves all of it with the OWNER connection and
raw SQL, which is the most privileged path there is.

**The approval is bound to the intent by a hash.** `lib/approvals/intent.ts` writes four labelled
lines (kind, subject, amount, destination) and takes their SHA-256. The execution rebuilds that
text from the CURRENT state of the world and refuses when it differs by one character. The bank
account token is part of the destination, so an approval given for one account does not authorise
paying another. The exact hashed text is stored beside the hash and printed on the approvals
screen, so an approver is not asked to trust the application about what it hashed.

**The three ceilings.** A payment is refused unless it clears the claim's outstanding reserve,
the policy's per-occurrence limit and the policy's aggregate limit across every claim, all read
from the policy fold rather than from the cache. A payment that has been requested and not yet
sent holds its place against all three until it is sent or refused, which is what stops two
simultaneous requests from each looking affordable.

**The claim payment lifecycle.** Requesting writes the intent and, above $1,000, the approval
request, in ONE transaction holding the claim lock. Sending is a separate transaction that
re-reads and re-checks everything first: the approval, the destination account and the three
ceilings. Settling and returning are the rail's own events. Every stage appends one claim event,
one money-operation event and its journal entries, and a unique index on
`(money_operation_id, event_type)` means each stage happens at most once per payment.

**The two LOCAL SIMULATORs**, labelled as such in the file, in the module header, on every screen
and in every payload. The payout rail keeps its own append-only provider-side table with no
foreign key into our money tables, linked to our world only by the transfer reference, so slice
B10 can diff the two for real and a mismatch can be planted on the provider side without touching
a journal entry (design finding F-03). The bank check says verified when the account holder name
matches the claimant and the routing number is one of two documented test values, failed
otherwise, and stores only the last four digits of each number plus a one-way token.

**The refund path** now goes through the same gate. The cancellation transaction is unchanged in
what it records: the policy really is cancelled, the premium really has stopped earning, and the
customer really is owed the money. What waits is the money leaving. Above the threshold the
`stripe_refund` operation stays `requested`, the approval request is written in the same
transaction, and `issueRefundsAtStripe` is not called until a staff action sends it after an
approval. The threshold is read against the WHOLE refund, not against each Stripe payment it is
split over, so splitting cannot slip a refund under it.

**`assertCancellationAllowed`**, the hook B5 left, is filled in. An open claim does not block a
cancellation and does not change the refund, and the function now returns the sentence and the
figures the cancellation preview and the explained-amounts section show, taken from the claim's
own events. The figures at the moment of cancellation are also stored on the cancellation event,
so the explanation can be given later from the event rather than from claims that have moved on.

**Two job endpoints**, both authenticated with `CRON_SECRET` as a bearer token compared in
constant time: `/api/jobs/settle-simulated-payouts` settles every simulated transfer whose
settlement date has passed, and `/api/jobs/recover-operations` finishes money operations left in
`requested` by a crash (F-B5-03). Neither can be run into a double effect: three separate unique
constraints make a rerun a no-op, and the recovery job never invents a new intent.

**The screens.** `/ops/claims` lists every claim; `/ops/claims/{id}` shows the reserve history
with what each decision booked, the payments with their rail status and approval state, what is
left before each ceiling, the bank account and its check, and the claim's own journal entries;
`/ops/approvals` shows the amount, who asked, where the money would go, the exact hashed text and
its SHA-256, and either the two buttons or the reason this viewer cannot decide. The policy page
gains a claims section and shows a gated refund as "awaiting approval"; the cancellation preview
says that a refund above $1,000 requires approval and explains what an open claim keeps.

## 5. Deviations from the assignment, and why

- **The per-claim lock is a transaction-scoped advisory lock, not `SELECT ... FOR UPDATE`.**
  PostgreSQL requires the UPDATE privilege on a table to take a row lock on it ("The FOR UPDATE
  ... clauses require UPDATE privilege as well", SELECT reference), and `app_runtime` has SELECT
  and INSERT only on every protected table, on purpose (AF-03). Measured on `corgi_test` on
  2026-09-08: `select id from policies limit 1 for update` as `app_runtime` fails with
  `permission denied for table policies`. Granting UPDATE on a money table just to be able to
  lock it would weaken the guard the whole build rests on. `pg_advisory_xact_lock` gives the same
  serialisation, needs no privilege, and is released whether the transaction commits, rolls back
  or the connection dies. The key is a 64-bit hash of the claim id: two different claims could in
  principle collide, and the only consequence would be that they wait for each other. The reason
  is written above `lockClaimForMoneyDecision` in `lib/claims/claims.ts`.
- **A payment counts as paid from the moment it is SENT, not when it settles.**
  `ARCHITECTURE.md` section 2 books the payment out of the reserve at sending (Dr claim_reserve /
  Cr claims_payable) and also says "paid = settled payments minus returns". Those two sentences
  cannot both hold: between sending and settling the money has left the reserve, so counting only
  settled money would make incurred drop for two days and come back. This build counts a payment
  as paid when it is issued and reports settled money separately, which is what an insurer does
  and what keeps `incurred = paid + reserve` true at every instant. Both numbers are on the claim
  screen. The reasoning is at the top of `lib/claims/money-position.ts`.
- **`reserve_adjusted` carries the NEW OUTSTANDING RESERVE, not the change.** An adjuster says
  "the reserve is now $4,000"; the delta is derived and is what the journal books. The rule is
  written at the top of the migration and enforced by a CHECK constraint.
- **One route handler per subject with a named `action` field**, rather than one route per verb:
  `/api/claims/{id}` carries set-reserve, add-bank-account, request-payment and close, and
  `/api/claims/{id}/payments/{operationId}` carries send, settle and return. The four (and the
  three) share the same authorisation, refusal handling and redirect, and a reader sees them all
  in one screen. The action never carries authority: the role is read from the session and
  checked again inside every money function.
- **One button, not two, for sending a waiting refund.** "Execute this approved refund" and
  "send this stuck refund to Stripe again" need exactly the same thing, so `sendRequestedRefund`
  is one function with one gate. That also means F-B5-03's staff action landed in the
  maker-checker commit rather than in its own.
- **A `closed` claim event and a close action were implemented** although the assignment only
  listed the event type. An enum value nothing can produce is dead weight, and closing has a real
  rule: a claim closes only when nothing is left to pay and nothing is in flight. Closing does not
  release the reserve on the operator's behalf, because releasing a reserve is a money decision
  and money decisions are taken one at a time.
- **`webhook_processing` still has a table-wide UPDATE grant** (finding F-B1-10, still open). Not
  touched here: it belongs to the webhook inbox, not to this slice.

## 6. Assumptions, all visible in the code or on the screen

1. **$1,000 is the money-out threshold, strictly above.** Yoann's decision of 2026-09-08, an
   assumption of this build and not a regulatory figure. It is one constant,
   `MONEY_OUT_APPROVAL_THRESHOLD_CENTS`, and one comparison, used by both money-out paths and both
   screens. A payment of exactly $1,000.00 needs no approver; $1,000.01 does. The approvals screen
   says it is an assumption.
2. **Only `staff_ops` acts on claim money, and only `staff_approver` decides.** The approver is
   deliberately not allowed to open a claim, move a reserve or send a payment: letting the checker
   also be the maker would empty maker-checker of its meaning. A broker sees the claims of their
   own policies on the policy page and can do nothing to them.
3. **The bank account that counts is the latest one recorded**, whatever its status. The most
   recent evidence about where the money would go is the evidence that governs, and that is also
   what makes an approval given for the old account refuse to pay a new one.
4. **The simulated rail settles two calendar days later** and does not model a banking calendar.
   A real ACH credit would be one to three business days and would skip weekends and holidays.
5. **A return can only follow a settlement.** A transfer cancelled at the rail before settling
   would be a different pair of entries and is not modelled.
6. **The reserve cannot be taken below what is already waiting to be paid out of it.** Refuse the
   payment first, then lower the reserve.
7. **The bank token is a salted digest of the account, not a vault token.** It is stable, so
   re-recording the same account keeps an approval valid, and one-way, so the token does not give
   the account back. The salt is a constant of this build, not a secret: this is a simulator
   holding synthetic accounts only.

## 7. Commands actually run, with results

All from the worktree root, after the merge of `main` at `faa12a8`.

```
$ npm run typecheck                              exit 0
$ npm run build                                  exit 0, 30 routes
$ npm test                                       217 tests, 216 pass, 0 fail, 1 skipped
                                                 (133 before this slice; the skipped one is B3's
                                                 live KYB test, unchanged)
$ npm run check:money-guards -- --database=test   110 PASS, 0 FAIL, exit 0   (51 before)
$ npm run check:money-guards                      110 PASS, 0 FAIL, exit 0   (trial database)
$ npm run check:ledger-guards                     13 PASS, 0 FAIL, exit 0
$ npm run check:claims-and-approvals              55 PASS, 0 FAIL, exit 0    (new)
$ npm run check:refund-replay                     27 PASS, 0 FAIL, exit 0    (B5, unchanged)
```

`npm run check:claims-and-approvals`, the lines that matter:

```
PASS  incurred = paid + reserve after the reserve is set / lowered / payment sent / settled /
      returned / rejection / closing            (six separate assertions, each checking the fold
      AND the journal balance of incurred_loss_expense and claim_reserve)
PASS  a payment larger than the reserve is refused, and says to raise the reserve first
PASS  a payment past the per-occurrence limit is refused
PASS  a payment inside the per-occurrence limit but past the aggregate limit is refused
PASS  two payment requests made at the same moment produce at most one payment
PASS  a payment above the threshold is queued for approval instead of being sent
PASS  an unapproved payment cannot be sent, however it is called
PASS  the person who asked cannot approve it
PASS  somebody who is not a staff approver cannot approve it
PASS  the database refuses it too, even when the application is told the role is staff_approver
PASS  a distinct staff approver can approve it
PASS  an approval does not authorise paying a DIFFERENT account: the changed intent is refused
PASS  two executions of the same approved payment produce ONE payment
      (one claim event, one journal entry, one transfer at the rail)
PASS  the rail settles the payment / running the settlement again does nothing
PASS  the bank returns the payment, and the claim is exactly where it was
PASS  a rejected payment cannot be sent, and stops holding its place against the reserve
PASS  a refund above $1,000 is queued for approval by the cancellation itself
PASS  the cancellation is recorded anyway: the policy is cancelled and the customer is owed
PASS  nothing was sent to Stripe: the operation is still only 'requested'
PASS  the refund cannot be sent before it is approved / once approved it is allowed
PASS  a second execution of the same approved refund is refused
PASS  a loss that happened while a since-cancelled policy was in force can still be claimed
PASS  a loss after the cancellation date is refused
PASS  a broker cannot open a claim or touch claim money
PASS  a create-stage failure cannot be re-issued as a NEW refund      (F-B5-02)
PASS  a failure reported by Stripe about the refund itself CAN be re-issued, under a new key
PASS  every journal line in the database balances  (debits 36626914 = credits 36626914)
```

`npm run check:money-guards`, the lines this slice adds:

```
PASS  owner cannot UPDATE / DELETE / TRUNCATE   x 6 new tables x 3 = 18 checks
PASS  app_runtime lacks UPDATE / DELETE / TRUNCATE on the same six      = 18 checks
PASS  the person who asked cannot approve their own money-out
PASS  a user with the role staff_ops / broker / customer cannot approve a money-out
PASS  an 'agent' principal cannot be created today, and the approver trigger would refuse it
PASS  a decision by a user that does not exist is refused
PASS  a request can be decided only once
PASS  a different staff_approver can approve it
PASS  one approval can fund at most one money operation
PASS  a claim payment cannot be sent twice
PASS  the simulated rail cannot settle one transfer twice
PASS  a 'closed' claim event cannot carry an amount
PASS  a payment event must name the money operation it is about
PASS  a reserve event cannot name a money operation
PASS  a loss cannot be reported before it happened
PASS  an approval request must carry a real sha256 of its intent
```

The two check scripts must not run at the same time against `corgi_test`: `TRUNCATE ... CASCADE`
on `approval_requests` takes locks across half the schema, and two concurrent runs deadlock. One
run at a time is clean; the deadlock was observed once, only while two scripts overlapped.

## 8. What was NOT verified, and why

- **Nothing was clicked in a browser.** The screens were type-checked and built, not exercised
  through a running application. Every rule they show is proved through the production functions
  by the check script, but the forms themselves, their redirects and their refusal messages have
  not been seen on screen. This is the largest gap of the slice.
- **The two job endpoints were never called over HTTP.** Their bodies are thin wrappers around
  `settleClaimPayment` and `recoverStuckOperations`, both exercised by the check script, and the
  cron-secret comparison is unit-testable but untested. Nobody has sent a request with a wrong
  bearer token and seen a 401.
- **`sendRequestedRefund` was never run against Stripe.** The gate in front of it
  (`assertRefundMaySend`) is proved refused-then-allowed by the check script, and the Stripe leg
  it then calls is B5's unchanged `issueRefundsAtStripe`, already proved by `check:refund-replay`
  and by the live refund. The two halves have not been run together.
- **The F-B5-02 recovery path was proved at the decision, not at Stripe.** The check script proves
  that a create-stage failure is refused as a re-issue and that a Stripe-reported failure is
  allowed. `assertPreviousRefundIsReallyDead`, which lists the PaymentIntent's refunds before
  opening a new operation, calls Stripe and was not run: Stripe's test mode gives no documented
  way to force a refund failure.
- **`/api/jobs/recover-operations` has never recovered anything for real**, because no operation
  has been stuck for five minutes on either database. The query was run and correctly returned
  nothing for a seconds-old operation.
- **Two concurrent executions were tested with two connections from one process**, not with two
  processes or two deployed instances. The guarantees they exercise are database ones (an advisory
  lock and three unique indexes), so the result should hold, but that is an argument, not a
  measurement.
- **Independent review.** Not performed by this delegate, by design.
- **Walkthrough with Yoann: NOT REVIEWED WITH YOANN.**

## 9. Needs a decision or an action

1. **The migration file name and the recorded name differ, and `npm run migrate` must not be run
   until that is fixed.** The file was applied to the trial database and to `corgi_test` as
   `0007_claims_and_approvals.sql`, then renamed in the repository to
   `0008_claims_and_approvals.sql` on the coordinator's instruction, because `main` already
   carried `0007_policy_current_voided_status.sql`. Both databases therefore have
   `0007_claims_and_approvals.sql` in `schema_migrations` and no row for `0008_...`. Running the
   migration runner now would try to apply the file a second time and fail on the first
   `create table`. The coordinator said they would correct the recorded name themselves at merge
   time; nothing in this branch touches `schema_migrations`. Verified on 2026-09-08: both
   databases hold all six of the new tables and the two new `money_operations` columns.
2. **There is no staff landing page.** A `staff_ops` or `staff_approver` user who signs in lands
   on `/broker`, which tells them this build implements the broker journey. `/ops/claims` and
   `/ops/approvals` are reachable only by typing the URL or from a policy page. A hub at `/ops`
   was deliberately not created to avoid a file collision with the B3 delegate's
   `app/ops/brokers`. It is a one-file addition and belongs to whoever owns the navigation.
3. **The MCP write tool of B11 should call `requestClaimPayment`**, which already creates the
   approval request and moves no money. Its actor must be rejected as a decider, and that is
   already the case in two independent places: `decideApprovalRequest` refuses any role but
   `staff_approver`, and the database trigger refuses it again. When B11 adds `agent` to the
   `users.role` CHECK, no change is needed here.
4. **The claim payment intent does not include the policy.** It names the claim, and the claim
   names the policy, so an approval cannot be moved between policies. If a later slice ever lets a
   claim be re-pointed at another policy, the intent must gain the policy id.
5. **The settlement job needs a cron entry** if the simulated rail is to settle without a human.
   Vercel Hobby allows one cron run per day (DECISIONS.md, 07:39Z), which is enough for a
   two-day settlement window. The claim screen also has a labelled LOCAL SIMULATOR button that
   settles one payment immediately, which is what a demo should use.
6. **`README.md` must gain two integration inventory rows** (AF-02): claim payout rail LOCAL
   SIMULATOR and bank account ownership LOCAL SIMULATOR, with their supported scenarios (send,
   delayed settlement, return; verified and failed ownership) and their limitation (no banking
   calendar, no real bank directory). This delegate does not edit README.
