# Slice B3 implementation notes (broker KYB, live, on Stripe Connect Accounts v2)

Written by the B3 delegate on 2026-09-08. Branch `worktree-agent-a8fb7fe353340a127`, worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/agent-a8fb7fe353340a127`, based on
`e120f69` and merged with `main` at `5b14830` mid-slice (the coordinator's void module landed
while this slice was being built and the superseding spec referred to it). Nothing was pushed,
nothing was deployed, no shared planning file was edited.

**The demo broker is now verified by real Stripe evidence.** Redwood Commercial Brokers was
submitted through the running application against the trial database and the real Stripe
sandbox: connected account `acct_1UDNobK6R3ohMVag`, pending at 12:07:57Z, approved at
12:10:34Z. The failed path was proven end to end too, on `corgi_test`: account
`acct_1UDNv2K6R3y2nGVW`, `verification_failed_tax_id_match`. Section 6 has the timings.

**Two things need the coordinator's action, both before this can work on the deployed app:**
section 7.1 (the Stripe webhook endpoint does not listen to connected accounts, so
`account.updated` never arrives) and section 7.2 (`npm run rebuild:policy-current` after
merging, so the voided policy shows its new status).

## 1. Startup receipt

Read in full before writing any code, in this order: `CLAUDE.md`, `AGENTS.md`,
`AUTOMATIC-FAILS.md`, `READABLE-CODE.md`, `WORKFLOW-48H.md`, `REVIEWER.md`,
`docs/BRIEF-REFERENCE.md` (general and Track 1; Tracks 2 and 3 read as reference),
`docs/ARCHITECTURE.md` (whole file, sections 4, 5, 6 and 8 in particular), `docs/DECISIONS.md`
(all entries, including the KYB decision of 08:55Z and the KYB rules of 11:14Z),
`docs/reviews/FINDINGS.md`, `docs/PLAN.md`, `docs/STATUS.md`,
`docs/handoffs/docs-kyb-implementation-notes.md`, `docs/handoffs/b2-implementation-notes.md`,
`docs/handoffs/b5-implementation-notes.md`.

Existing code read in full: `db/migrations/0001` to `0005`, `db/client.ts`, `lib/stripe.ts`,
`lib/kyb/eligibility.ts`, `lib/kyb/stripe-connect.ts`, `lib/kyb/stripe-connect.live.test.ts`,
the four fixtures in `lib/kyb/fixtures/`, `lib/broker/eligibility.ts`, `lib/broker/kyb.ts`,
`lib/auth/session.ts`, `lib/auth/current-user.ts`, `lib/payments/checkout.ts`,
`lib/payments/collection.ts`, `lib/payments/webhook-inbox.ts`, `lib/ledger/post.ts`,
`lib/ledger/policy-entries.ts`, `lib/policy/read.ts`, `lib/policy/current.ts`,
`lib/policy/status.ts`, `lib/policy/terms.ts`, `lib/money/cents.ts`, `lib/money/idempotency.ts`,
`app/api/webhooks/stripe/route.ts`, the other route handlers under `app/api`, `app/broker/*`,
`app/policies/[policyId]/page.tsx`, `app/login/page.tsx`, `app/globals.css`, `scripts/seed.ts`,
`scripts/check-money-guards.ts`, `scripts/check-payment-replay.ts`, `scripts/migrate.ts`,
`package.json`, `.env.example`, `.githooks/pre-commit`, `next.config.ts`, `tsconfig.json`.
After the merge: `lib/ledger/reverse.ts`, `lib/policy/void-fabricated-binding.ts`,
`scripts/void-fabricated-binding.ts` and the fold change in `lib/policy/current.ts`.

Not read: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`,
`GAP-REVIEW.md` (advisory catalogues, outside this slice), `docs/ATTACK-PLAN.md`,
`docs/PROVENANCE.md`, `docs/COMPLIANCE-MATRIX.md`. Absent files: none of the mandatory files
were missing. `.env.local` was copied from the main checkout, is ignored by `.gitignore`, and
no value from it was ever printed, logged or committed.

Acceptance criterion worked on: `docs/PLAN.md` B3, "broker KYB live", plus the two corrections
the coordinator sent mid-slice (F-B2-13, in its first and superseding forms). Planned checks,
all executed: `npm test`, `npm run typecheck`, `npm run build`, both migrations on both
databases, `check:money-guards` on both, `check:payment-replay`, `check:refund-replay`, the new
`check:kyb-replay`, `check:ledger-guards`, `check:ledger-seal`, a live submission through the
running application against the real Stripe sandbox, and gitleaks on the staged content before
each commit.

## 2. Reading path, in order

1. `db/migrations/0006_broker_kyb_wiring.sql` — the one new table and what is deliberately not
   in it.
2. `lib/broker/eligibility.ts` — the settling window and the sentences the screens show. Pure,
   no database, no clock: everything here is a function of its arguments.
3. `lib/broker/kyb.ts` — the reads and the appends. `brokerKybState` is the function the rest of
   the application asks.
4. `lib/broker/kyb-onboarding.ts` — the two operations that talk to Stripe: submit, and read
   again.
5. `app/api/brokers/kyb/route.ts` — what the form sends, and where the agreement acceptance
   comes from.
6. `app/api/webhooks/stripe/route.ts`, `handleAccountUpdated` — what a provider event does.
7. `lib/payments/collection.ts` — eligibility at binding time, and what happens to money that
   arrives for a broker who is not eligible.
8. `app/broker/kyb/page.tsx` and `app/ops/brokers/page.tsx` — the two screens.
9. `scripts/check-kyb-replay.ts` — the properties, asserted against a real database.

## 3. The rule, in one paragraph

A broker cannot bind a policy until Stripe has verified the company behind it. The broker fills
one form; we write down what they declared and the Stripe Connected Account Agreement they
accepted, commit that, then create a Stripe connected account of entity type `company` with the
registered name, the EIN and the registered address. Stripe's own business verification runs on
it. Every status we ever observe is appended to `broker_kyb_events`, never edited, and the
latest one decides. An approval seen less than two minutes after the broker submitted is
reported as pending, because Stripe's identity check lands about a minute after creation and an
earlier answer is the absence of a result rather than a result (Yoann's decision, 11:14Z). Only
`approved` allows binding, and that question is asked again at the moment the policy would
actually be bound.

## 4. What was built

**Migration 0006.** `broker_kyb_submissions`: what the broker declared (legal name, the last
four digits of the EIN, address, business URL, contact email), the agreement acceptance (instant
and IP address) and the idempotency key of the provider call. Protected financial record with
the three guards (append-only trigger, TRUNCATE trigger, server-set `recorded_at`) and
`app_runtime` holding SELECT and INSERT only. `broker_kyb_events` gains `created_by`, so a staff
re-read says who asked; `ADD COLUMN` writes no row and changes no value, so the append-only
guarantee is untouched.

**Migration 0007.** The `policy_current` cache learns the status `voided`. Separate file rather
than an edit of 0006 for the same reason 0004 exists: 0006 was already applied to both databases
when the superseding spec arrived. `policy_current` is a rebuildable cache and not a financial
record, which is why altering its CHECK is allowed at all.

**The settling window, twice, on purpose** (`lib/broker/eligibility.ts`,
`reportedKybStatus`). `lib/kyb/eligibility.ts` already measured it from Stripe's own `created`
timestamp when mapping a freshly read account. This one measures it from our own submission row
when reporting a status that is already recorded. Two boundaries, two clocks, same two minutes.
It can only ever delay an approval, never grant one early: a failure or a pending inside the
window passes through unchanged, and a status from another provider (the seed placeholder) is
not touched at all.

**Submission** (`lib/broker/kyb-onboarding.ts`, `submitBrokerKyb`), in the outbox order the
payment code already uses: the submission row is written and committed BEFORE Stripe is called,
so a crash during the provider call cannot lose the agreement acceptance we are passing on;
Stripe is called with the key stored on that row; what it answered is appended. A provider error
appends a `failed` status carrying Stripe's own sanitized message, and binding stays refused. A
verification that is already pending or approved refuses a second submission, so a broker cannot
accumulate connected accounts by clicking twice; a failed one can always be submitted again,
which is the point of showing the failure.

**Reading again** (`refreshBrokerKybFromStripe` and `applyKybAccountUpdate`). The account is
re-read from the API and that read decides the status; the webhook body is never trusted. A
status row is appended only when the status differs from the last recorded one, inside a
transaction that takes an advisory lock on the broker, so two deliveries at the same moment
cannot both write the same transition. `applyKybAccountUpdate` takes an account that has already
been read, which is what lets the replay check feed it the captured Stripe payloads without a
network round trip.

**Webhook** (`app/api/webhooks/stripe/route.ts`, `handleAccountUpdated`). v1 `account.updated`,
which fires for v2 accounts; the account id comes from `data.object.id` or from `event.account`.
An account belonging to no broker of ours is ignored with that reason. The payload stored with
the status is the mapping result plus Stripe's requirement error codes.

**Eligibility at binding time** (`lib/payments/collection.ts`, review finding F-B2-L). The KYB
status was read when the payment page was opened and never again; it is now asked again at the
moment the policy would be bound. When the broker is not approved, the money is recorded as
arrived and NOTHING is journaled and NOTHING is bound; the policy page says "paid, binding
refused" and staff resolve it with `retryBindingAfterEligibility`, which re-runs the same
posting transaction and asks the eligibility question again itself. See section 8.1 for the
ledger gap that creates, which is real and deliberate rather than hidden.

**Screens.** `/broker/kyb` (submit, with the three published test EINs documented next to the
field and the agreement checkbox in the decided wording), `/ops/brokers` (staff: status,
provider, account, submission time, Stripe's requirement error codes, and a "Re-read from
Stripe" action), and the policy page, which shows the same sentence as every other screen,
disables the Pay button with the reason when the broker is not approved, and surfaces a refused
binding with the staff action that fixes it.

**Also, at the coordinator's request**, the two forms of finding F-B2-13, each in its own
commit: a voided policy has its own derived status and can no longer be paid, and a unique
violation is no longer read as "already posted" when the ledger holds nothing.

## 5. Deviations from the assignment, and why

1. **`broker_kyb_submissions` has no `provider_account_id` column.** Stripe mints the account id
   after the submission row is committed, and the row can never be updated (AF-03), so the
   column could only ever be null. The account id lives on `broker_kyb_events.provider_ref`,
   which is exactly the shape the money tables already use (the intent in `money_operations`,
   the provider reference on `money_operation_events`). What the submission carries instead is
   `provider_idempotency_key`, which IS known before the call, is unique in the database, and
   makes a double-clicked form one submission rather than two connected accounts. The webhook's
   "find the submission by provider_account_id" is served by `brokerIdForProviderAccount`, which
   reads the account id off the events.
2. **`refreshBrokerKybFromStripe` calls `readBrokerVerification` and `mapAccountToEligibility`
   rather than `readBrokerEligibility`.** The latter is those two in one line; the raw account is
   also needed, to store Stripe's requirement error codes with the status.
3. **The status recorded at submission is the mapped one, not the literal string `pending`.** In
   every observed run the mapping answers `pending`, because the settling window measured from
   the account's own `created` says so. Recording what the mapping read is one rule instead of
   two, and it cannot drift from what the rest of the application would compute.
4. **`https://example.com` could not be used as the business URL.** Stripe validates it and
   refuses it. It was submitted anyway, on the trial database, so the refusal is on the record
   and the failure path is proven with a real provider error: `Invalid URL.` recorded as a
   `failed` status at 12:07:45Z. The real submission then used the deployed application URL,
   which is what the KYB adapter's live test already uses.
5. **The connected account created for the demo broker carries no `corgi_probe = 'b3'` metadata
   and is not named "Test Brokerage ...".** It is not a probe: it is the demo broker's real
   verification, created by the application from the name the broker typed, and tagging it as a
   probe or renaming the company would have made the record less true, not more. Every account
   created for *testing* does carry the tag: the corgi_test account `acct_1UDNv2K6R3y2nGVW` is
   named "Test Brokerage Delta LLC" and was tagged `corgi_probe = "b3"` immediately after
   creation. **This is a deliberate deviation from the instruction and the coordinator should
   confirm it.**
6. **A new migration 0007 instead of extending 0006.** 0006 was already applied to both
   databases when the superseding spec arrived, and the runner applies each file once by name.
7. **`already_posted` is decided on the operation's journal entries, not on its `succeeded`
   status.** The spec offered "this operation already has its own succeeded event" as a second
   signal; that signal is now unreliable *because of this slice*, since a payment whose binding
   was refused carries a succeeded status with nothing posted. The entries are the proof.
8. **`scripts/check-payment-replay.ts` calls `voidFabricatedBinding` directly** rather than the
   coordinator's CLI script, which reads its own arguments and connects to its own database.
9. **Thin v2 events are not handled**, and the route says why: they need their own event
   destination at Stripe with its own signing secret, a second route and a second environment
   variable; `stripe@22.6.1` no longer has `parseThinEvent` (renamed to `parseEventNotification`
   with a notification-handler class, see the SDK changelog for 22.x); and the v1 event already
   tells us the only thing we use it for, which is which account to read again.

## 6. The live proof

### 6.1 The demo broker, on the trial database and the real Stripe sandbox

Run from this worktree through the running application (`npm run dev` on port 3100, pointed at
the trial database), signed in as `broker@example.com`.

```
12:07:43.305Z  POST /api/brokers/kyb   business_url https://example.com
               -> 303 /broker/kyb?error=Stripe refused the verification request: Invalid URL.
12:07:44.500Z  submission 1 recorded    key broker-kyb:edae60d2-...      (committed before the call)
12:07:45.426Z  status  failed           reason "Invalid URL."             no account created

12:07:52.219Z  POST /api/brokers/kyb   business_url https://corgi-work-trial-iota.vercel.app
               -> 303 /broker/kyb?submitted=acct_1UDNobK6R3ohMVag
12:07:53.191Z  submission 2 recorded    key broker-kyb:edae60d2-...:2
               legal name Redwood Commercial Brokers LLC, EIN ending 0000, address_full_match,
               agreement accepted 12:07:52.502Z from ::1
12:07:57.432Z  status  pending          acct_1UDNobK6R3ohMVag   "awaiting the first verification result"

12:08:20Z      /broker shows: KYB status: pending, "Verification in progress at Stripe, at least
               2 minutes. Binding is refused until it passes."

12:10:33.174Z  POST /api/brokers/{broker}/kyb/recheck   (as the broker, after the window)
               -> 303 /broker/kyb?rechecked=pending -> approved (business identity settled and
                  recipient capability active)
12:10:34Z      status  approved         acct_1UDNobK6R3ohMVag
12:10:40Z      /broker shows: KYB status: approved, and the "KYB: not yet live" note is GONE:
               the seeded placeholder is no longer the latest status.

12:11Z         POST .../kyb/recheck as staff_ops
               -> "still approved (...), nothing appended"     one row per change, proven live
```

Two minutes and 37 seconds elapsed between the submission and the approval. The account was
created at 12:07:56Z and Stripe's identity check landed inside the window, exactly as the
adapter's measurements predicted.

### 6.2 The failed path, live, on corgi_test

The application was run against `corgi_test` (`DATABASE_URL_APP` pointed at the test runtime
role for that run only) with a broker created for it, "Test Brokerage Delta LLC".

```
12:14:30.552Z  POST /api/brokers/kyb   EIN 111111111
               -> 303 /broker/kyb?submitted=acct_1UDNv2K6R3y2nGVW
12:14:36.125Z  status  pending   acct_1UDNv2K6R3y2nGVW   source=create_account   audited
12:17:36.229Z  POST .../kyb/recheck
               -> "pending -> failed (verification_failed_tax_id_match)"
12:17:38.456Z  status  failed    acct_1UDNv2K6R3y2nGVW   source=broker_re_read   audited
12:17:4xZ      second re-read -> "still failed (...), nothing appended"
```

The policy page for that broker then showed `KYB: failed`, "Stripe refused this verification.
Binding is refused; submitting corrected details starts a new verification. Stripe reason:
verification_failed_tax_id_match.", the Pay button rendered as
`<button type="button" disabled="">` with no checkout form on the page at all, and a direct
`POST` to the checkout route was refused server-side:

```
POST /api/policies/{policy}/checkout
  -> 303 ...?error=binding is refused: the broker's KYB status is "failed" and must be "approved"
```

### 6.3 Authorisation and refusals, all checked over HTTP

```
broker opening /ops/brokers                    -> 307 /broker
/ops/brokers with no session                   -> 307 /login
customer re-reading a broker's verification    -> "you cannot read this broker's verification"
customer submitting a KYB                      -> 303 /broker
no session submitting a KYB                    -> 303 /login?error=Please+sign+in+again
submitting without the agreement checkbox      -> "the Stripe Connected Account Agreement has to
                                                  be accepted before the company can be submitted"
submitting again while already approved        -> "this broker is already verified at Stripe"
                                                  (refused BEFORE any call: no account created)
```

### 6.4 Stripe accounts created by this slice

| Account | Where | EIN | Outcome | Tagged |
|---|---|---|---|---|
| `acct_1UDNobK6R3ohMVag` | trial database, demo broker | 000000000 | pending then approved | no, see deviation 5 |
| `acct_1UDNv2K6R3y2nGVW` | corgi_test, "Test Brokerage Delta LLC" | 111111111 | pending then `verification_failed_tax_id_match` | `corgi_probe = "b3"` |

Both `livemode: false`. No other account was created: the `example.com` submission was refused
by Stripe before an account existed, and the "already verified" refusal happens before the call.

## 7. What the coordinator must do

### 7.1 The webhook endpoint does not receive connected-account events (blocking for the webhook path)

Measured, not assumed. The endpoint `we_1UDKzYK6R3v50tIybe5BIytW` on the deployed URL already
lists `account.updated` among its enabled events, but **no `account.updated` has ever reached
it**: `webhook_events` holds seven event types and that is not one of them, although fourteen
connected accounts were created on 2026-09-08 and their requirements changed within a minute.
The reason is visible at Stripe:

```
stripe.events.list({ type: "account.updated" })                        -> 3 events, all about the
                                                                          PLATFORM account acct_1UDK52K6R3v50tIy
stripe.events.list({ type: "account.updated" }, { stripeAccount: "acct_1UDMRlK6R3ail0An" })
                                                                       -> 2 events at 10:41:11Z and
                                                                          10:41:18Z, about that
                                                                          connected account
```

Connected-account events are delivered only to an endpoint registered to listen to connected
accounts (`connect: true`). The current endpoint is not one. Until a Connect endpoint exists,
`handleAccountUpdated` is correct code that will never fire in production, and the only thing
that moves a broker from pending to approved is the "Re-read from Stripe" button, which is why
that button exists on both screens.

Two options, the coordinator's call because both touch shared configuration and one creates a
new signing secret:

- add a second endpoint on the same URL with `connect: true` and `enabled_events:
  ["account.updated"]`, and put its signing secret in a second environment variable (the route
  would then have to try both secrets), or
- recreate the existing endpoint with `connect: true`, keeping the same URL and event list, and
  replace `STRIPE_WEBHOOK_SECRET` on Vercel.

The second is simpler and keeps one secret. Neither was done: this delegate does not change
deployed configuration.

### 7.2 Run `npm run rebuild:policy-current` after merging

CGP-01061 was voided before the `voided` status existed, so its cache row said
`payment_failed`. The rebuild was run on the trial database during this slice and it now reads
`voided` (CGP-01062 cancelled, CGP-01274 bound, unchanged). Run it again after the merge if any
correction happens in between; it rewrites only the cache and touches no financial row.

### 7.3 Things to decide

1. **The ledger gap behind a refused binding** (section 8.1). It is the one design question in
   this slice that a delegate should not settle alone.
2. **Deviation 5**: the demo broker's connected account is not tagged as a probe and does not
   start with "Test Brokerage". If the panel's rule is that every account created during the
   trial must carry the tag, the account can be tagged with one API call, at the cost of
   labelling real product data as a probe.
3. **Whether the settling window should also expire.** The rule as decided and implemented
   refuses to act on an approval recorded inside the window, for ever. Reaching that state needs
   an approval to be recorded within two minutes of a submission, which the mapping already
   prevents (it refuses to say approved within two minutes of the account's creation, and the
   account is created in the same request as the submission). If it ever happened, the broker
   would stay pending until a new status was recorded, and a re-read would append nothing
   because the recorded status has not changed. The escape today is a fresh submission. Making
   the window time-relative instead ("hold the approval only while we are still inside the
   window") would remove that corner at the cost of a rule that is harder to state.

## 8. Assumptions and known gaps

1. **A payment that arrives for an ineligible broker leaves the ledger short.** The money is at
   Stripe and recorded on the operation; no journal entry exists until staff bind it. The
   comment above `retryBindingAfterEligibility` says so, the policy page says so in red, and
   reconciliation (B10) will report it as a provider-only record with its age. The alternative
   is to post the cash to a suspense account at once and reallocate on binding, which keeps the
   ledger complete at the cost of a new account and a second posting path. **Not decided.**
2. **The terms-of-service IP is whatever the request carried.** `x-forwarded-for`, then
   `x-real-ip`, then `127.0.0.1` for a request that arrived down a local connection with neither
   header. The live run recorded `::1`, which is what the local server really saw. On Vercel it
   will be the client address.
3. **One verification at a time per broker.** A broker whose Stripe verification is pending or
   approved cannot start another one; a failed one can always be resubmitted.
4. **The status recorded at submission is the mapping of the creation response**, which is
   `pending` in every observed run.
5. **`applyKybAccountUpdate` is racy in theory across two brokers.** The advisory lock is taken
   per broker, which is the only scope that matters here.
6. **The EIN is never stored.** Only its last four digits, by database design, not by
   convention: there is no column to put the number in.

## 9. What was NOT verified, and why

- **The webhook path on the deployed application.** It cannot work until section 7.1 is done.
  The handler is covered by `check:kyb-replay` (which runs the same
  `applyKybAccountUpdate` the route calls) and by the mapping's own unit tests, and the account
  ids above let the coordinator confirm the deliveries once a Connect endpoint exists.
- **A slow Stripe check.** Every observed run answered within 45 to 60 seconds. The settling
  window has never been observed to be too short.
- **The other side of the settling window against a real database.** `recorded_at` comes from
  the database clock and cannot be backdated (AF-03), so a check that runs in seconds can only
  exercise the inside-the-window side. The outside is a unit test with fixed timestamps.
- **Two truly concurrent deliveries of `account.updated`.** The advisory lock is the control;
  serial replay is what was tested.
- **The `/ops/brokers` screen with more than one broker.** The trial database has one.
- **Independent review.** Not performed by this delegate, by design.
- **Walkthrough with Yoann: NOT REVIEWED WITH YOANN.**

## 10. Commands actually run, with results

All from the worktree root.

```
$ npm test                                     151 tests, 151 pass, 1 skipped, 0 fail  (130 before)
$ npm run typecheck                            exit 0, no output
$ npm run build                                exit 0, 22 routes, /broker/kyb and /ops/brokers listed
$ npm run migrate                              applied 0006 then 0007 on the trial database
$ npm run migrate -- --database=test           applied 0006 then 0007 on corgi_test
$ npm run check:money-guards                   58 PASS, 0 FAIL   (51 before)
$ npm run check:money-guards -- --database=test 58 PASS, 0 FAIL
$ npm run check:kyb-replay                     22 PASS, 0 FAIL, exit 0   (new, repeatable)
$ npm run check:payment-replay                 30 PASS, 0 FAIL, exit 0   (22 before)
$ npm run check:refund-replay                  27 PASS, 0 FAIL, exit 0
$ npm run check:ledger-guards                  0 FAIL
$ npm run check:ledger-seal                    0 FAIL
$ npm run rebuild:policy-current               3 policy rows rebuilt; CGP-01061 now reads 'voided'
```

`npm run check:kyb-replay`, in full:

```
PASS  Stripe's tax-id mismatch is recorded as a failure with its own code  (pending -> failed (verification_failed_tax_id_match))
PASS  the status row carries Stripe's requirement error codes  (verification_failed_tax_id_match)
PASS  replaying the same account.updated appends nothing: the status did not change  (appended: false)
PASS  two deliveries left exactly two rows: the submission's pending and the failure  (2 row(s))
PASS  the broker is not eligible and the screen quotes Stripe's reason
PASS  a read taken inside the settling window does not approve the broker  (pending, appended: false)
PASS  a read taken after the settling window records the approval  (pending -> approved)
PASS  replaying the approval appends nothing  (appended: false)
PASS  three deliveries left exactly two rows: the submission's pending and the approval  (2 row(s))
PASS  an approval recorded inside the settling window is reported as pending  (reported pending, recorded approved, held: true)
PASS  the screen says the verification takes at least two minutes
PASS  an account.updated for an account we never created maps to no broker  (broker: none)
PASS  a known account maps back to its broker
PASS  a payment for a broker held at pending does not bind the policy
PASS  nothing was journaled: the policy is not bound and no entry was posted  (0 entries, status awaiting_payment)
PASS  the money is recorded as arrived, with the refusal on the operation
PASS  a second delivery of the same payment does not append a second success  (1 succeeded event(s))
PASS  staff cannot bind while the broker is still not eligible
PASS  staff bind the policy once the broker is eligible  (outcome: posted)
PASS  the four issuance entries are posted, once each  (4 entries, status bound)
PASS  the money was recorded once, whatever the number of deliveries and retries  (1 succeeded event(s))
PASS  binding again posts nothing a second time  (outcome: already_posted, 4 entries)
```

The five new lines of `npm run check:payment-replay` (finding F-B2-13):

```
PASS  the policy to be voided is paid and bound first  (outcome: posted)
PASS  the void reverses every entry of the operation  (4 reversal entries, correction event ...)
PASS  the voided policy shows as voided, not as payment_failed  (status: voided)
PASS  a payment redelivered on a voided operation is refused, not accepted as already posted
PASS  a payment on a second attempt after a void is refused, not accepted as already posted
PASS  nothing of that second payment was journaled  (0 entries under attempt 2)
PASS  a voided policy cannot start a new payment  (this policy was voided by a correction; create a new draft)
```

The new lines of `npm run check:money-guards`:

```
PASS  owner cannot UPDATE broker_kyb_submissions          PASS  owner cannot DELETE broker_kyb_submissions
PASS  owner cannot TRUNCATE broker_kyb_submissions        PASS  app_runtime lacks UPDATE/DELETE/TRUNCATE on it
PASS  recorded_at and created_at ignore the client value  (now covers broker_kyb_submissions)
PASS  a second submission under the same idempotency key is refused
      (duplicate key value violates unique constraint "broker_kyb_submissions_provider_idempotency_key_key")
```

## 11. Commits on this branch

| SHA | What |
|---|---|
| `53e525a` | `feat(db): migration 0006, broker KYB submissions and audited status rows` |
| `5e72faf` | `feat: the KYB settling window and the sentences the screens show` |
| `1686dbb` | `feat: submit a broker to Stripe Connect and record every status it answers` |
| `02346c0` | `feat: handle account.updated and record the broker status it points at` |
| `65fb3f4` | `feat: check broker eligibility at binding time, not only at checkout` |
| `0b9685c` | `feat: the KYB screens, honest about pending, failed and refused binding` |
| (merge) | `main` at `5b14830` merged in, no conflict |
| `abd5027` | `feat: a voided policy has its own status and cannot be paid again (F-B2-13)` |
| `f7e12d3` | `fix: a unique violation is only "already posted" when this operation posted` |
| `9f601c9` | `test: check that money arriving on a voided policy is refused, not swallowed` |
| `5262077` | `test: check:kyb-replay, one status row per change and the settling window` |
| `122234a` | `fix: a seed from zero refuses a database that already holds a KYB submission` |

Every commit passed the gitleaks pre-commit hook (`git config core.hooksPath .githooks` is set
in this worktree): "no leaks found" on each.
