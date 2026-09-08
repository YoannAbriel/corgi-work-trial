# Slice B2 implementation notes (issuance and live Stripe collection)

Written by the B2 delegate on 2026-09-08. Branch `worktree-agent-a0144807529a6d166`, worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/agent-a0144807529a6d166`, four
commits on top of `29312ca`. Nothing was pushed, nothing was deployed, no shared planning file
was edited.

## 1. Startup receipt

Read in full before writing any code: `CLAUDE.md`, `AGENTS.md`, `AUTOMATIC-FAILS.md`,
`READABLE-CODE.md`, `WORKFLOW-48H.md`, `REVIEWER.md`, `docs/BRIEF-REFERENCE.md` (general and
Track 1 sections; Tracks 2 and 3 read as reference), `docs/ARCHITECTURE.md` (sections 1 to 9),
`docs/reviews/architecture.md` (all 21 findings), `docs/DECISIONS.md`, `docs/PLAN.md`,
`docs/STATUS.md`, `docs/COMPLIANCE-MATRIX.md`.

Existing code read in full: `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore`,
`.env.example`, `.githooks/pre-commit`, `db/client.ts`, `scripts/migrate.ts`,
`scripts/set-runtime-role-password.ts`, `scripts/check-ledger-guards.ts`,
`db/migrations/0001_ledger_core_and_webhook_inbox.sql`, `lib/stripe.ts`, `lib/money/dates.ts`,
`lib/money/premium.ts` and their tests, `app/api/webhooks/stripe/route.ts`,
`app/api/health/route.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`.

Not read: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`,
`GAP-REVIEW.md` (advisory catalogues, outside this slice), `docs/ATTACK-PLAN.md`,
`docs/PROVENANCE.md`. Absent files: none of the mandatory files were missing. `.env.local` was
copied from the main checkout and never printed, logged or committed.

Acceptance criterion worked on: PLAN.md B2, "issuance and live Stripe collection". Planned
checks, all executed: `npm run typecheck`, `npm run build`, `npm test`, `npm run migrate`,
`npm run seed`, `npm run check:ledger-guards`, `npm run check:money-guards`,
`npm run check:payment-replay`, and a local end-to-end through the running application.

## 2. Reading path, in order

1. `db/migrations/0002_policies_and_money_operations.sql` — the tables and their guards.
2. `lib/policy/charge.ts` — what the customer is charged (premium, tax, fee).
3. `lib/policy/issue.ts` — creating a draft: prices it and writes the immutable `quoted` event.
4. `lib/payments/checkout.ts` — the outbox: intent committed, then Stripe, then the answer.
5. `app/api/webhooks/stripe/route.ts` — which event type does what.
6. `lib/payments/collection.ts` — the one transaction that posts the money and binds the policy.
7. `lib/ledger/policy-entries.ts` — the four entries, with the worked example in the header.
8. `lib/ledger/post.ts` — the only function that writes into the journal.
9. `lib/policy/current.ts` — the fold of the events and the rebuildable cache.

Everything else is support: `lib/auth/session.ts` (the cookie, ten lines of real logic),
`lib/policy/read.ts` (the queries the pages use), `lib/money/cents.ts` (dollars to cents without
floats), `lib/broker/eligibility.ts` (only "approved" allows binding).

## 3. The money, in one worked example

Recited example, decided by Yoann (DECISIONS.md): $1,200 annual premium, California, policy
effective 2028-03-01.

```
annual premium                        120000 cents
California premium tax, 235 bps       floor(120000 x 235 / 10000) =   2820 cents
flat policy fee (assumption)                                          2500 cents
charged to the customer                                             125320 cents
broker commission, 15% of collected premium   floor(120000 x 1500 / 10000) = 18000 cents
```

The four entries posted when Stripe confirms the payment, all filed under
(`money_operation`, operation id, entry type):

| entry | effective date | debit | credit |
|---|---|---|---|
| `premium_written` | policy effective date | premium_receivable 120000 | unearned_premium 120000 |
| `tax_and_fee_billed` | policy effective date | premium_receivable 5320 | premium_tax_payable 2820, fee_income 2500 |
| `premium_collected` | day the money arrived | cash_stripe 125320 | premium_receivable 125320 |
| `commission_earned` | day the money arrived | commission_expense 18000 | commission_payable 18000 |

Two different business dates on purpose: premium is written when coverage starts, cash is dated
the day it moved, and commission is earned on collected premium (Yoann's rule). Consequence to
know before the debrief: when a customer pays before the effective date, an as-of view between
the two dates shows `premium_receivable` negative, which is the customer's credit balance; it
clears when coverage starts. The local end-to-end below shows exactly that, because the policy
was written for 2028-03-01 and paid on 2026-09-08.

## 4. What was built

**Migration 0002** (applied, strictly additive): `brokers`, `customers`, `users`, `policies`,
`policy_events`, `money_operations`, `money_operation_events`, `state_tax_rates`,
`broker_kyb_events`, `policy_current`, one sequence for policy numbers, and the grants.
Protected (append-only trigger + runtime role with SELECT/INSERT only + server-set
`recorded_at`/`created_at`): brokers, policies, policy_events, money_operations,
money_operation_events, state_tax_rates, broker_kyb_events. `brokers` and `policies` are
protected because they carry facts that decide money (the commission rate, the state whose tax
rate applies). Nonfinancial: `customers`, `users` (identity, no money, no UPDATE granted
either), `policy_current` (a cache, the only table the application may update).

**Migration 0004**: the TRUNCATE guards for those tables. See "deviations" below for why it is
a separate file.

**Two extra policy-event types beyond the design**: `quoted` (the priced draft) alongside
`issued`. The architecture note said the terms live in `policy_events`, but a draft has no
event until binding, and its price had to live somewhere immutable so the amount charged cannot
drift from the amount quoted. Partial unique indexes enforce one `quoted` and one `issued` per
policy.

**Checkout**: `money_operations` row with `idempotency_key = policy-checkout:<policy id>`,
committed with its `requested` event before the provider call; then
`stripe.checkout.sessions.create(..., { idempotencyKey })` with `client_reference_id`,
`metadata.operation_id` and `payment_intent_data.metadata.operation_id`; then a
`provider_accepted` event carrying the session id and the hosted page URL. Clicking Pay again
returns the stored URL. If the process died before the answer was stored, the next attempt
calls Stripe again with the same key, which is why no retry can ever use a new key.

**Webhook handlers**: `payment_intent.succeeded` posts the money in one transaction (four
entries, `succeeded` operation event, `issued` policy event, cache refresh); a unique violation
means already posted and answers 200. `checkout.session.completed` records the session
completion as an operation event and posts nothing. `payment_intent.payment_failed` appends a
`failed` event and leaves the policy unbound. Every other type stays stored and ignored with a
reason.

**UI** (plain CSS, no client JavaScript at all, forms POST to route handlers that answer 303):
`/login`, `/broker` (the broker's policies + KYB label), `/broker/policies/new`,
`/policies/[id]` (charge split, coverage, status, KYB label, Pay button, journal entries table
with account, debit, credit, effective date and recording time).

**Seed**: `npm run seed` refuses to run when any of the eleven tables it fills already holds a
row, prints what it found and exits 1. It inserts one broker at 15%, four demo users, one
customer, the California tax rate row and one `broker_kyb_events` row with provider `seed`.

## 5. State premium tax: what is seeded

Yoann's decision, relayed by the coordinator during this slice and seeded verbatim:

- state `CA`, `rate_bps` 235 (2.35%), `effective_from` 1986-01-01
- `source_url`: `https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CONS&sectionNum=SEC.%2028.&article=XIII`
- `source_checked_on` 2026-09-08
- `note`: "Cal. Const. art. XIII s. 28(d): 2.35 percent; effective_from derived from RTC 12202
  (1982 to 1985 were 2.33 percent), not stated verbatim"

The rate is data, not code: `lib/policy/tax-rate.ts` reads the row in force on the policy
effective date, and a rate change is a new row. If the panel disputes the effective date, only
that seeded row changes; no code moves.

Independent corroboration, fetched on 2026-09-08 by a separate read-only research agent, kept
here so the figure can be defended without re-searching:

- Cal. Const. art. XIII s. 28(d), verbatim: "The rate of the tax to be applied to the basis of
  the annual tax in respect to each year is 2.35 percent."
- Cal. Const. art. XIII s. 28(c), the base, verbatim: "the amount of gross premiums, less return
  premiums, received in such year by such insurer upon its business done in this State, other
  than premiums received for reinsurance and for ocean marine insurance."
- Rev. & Tax. Code s. 12202 (`.../codes_displaySection.xhtml?lawCode=RTC&sectionNum=12202.`):
  2.35 percent for all years except 1982 to 1985, which were 2.33 percent. **No source states an
  effective date for the rate itself**, so the seeded `effective_from` of 1986-01-01 is derived
  from that exception window and the seeded note says so.
- California Department of Insurance 2025 P&C return instructions FS-001, verbatim: "Line 2:
  Tax Rate - the tax rate of 2.35 %."

Caveats worth knowing at the debrief, none of which change the modelled rate: surplus lines are
3 percent on the broker (Ins. Code s. 1775.5), not 2.35; a retaliatory tax exists for foreign
insurers (Const. s. 28(f)(3), Ins. Code ss. 685, 685.1) and is a separate schedule; ocean marine
and reinsurance are outside the base. **Directly relevant to slice B5**: the base is gross
premiums *less return premiums* received in the year (CDI FS-001 Schedule A line 3.3 cites RTC
12221 and the Constitution), which supports Yoann's decision that the premium tax follows the
premium and is refunded on the unearned portion at cancellation. It is an annual net
computation at the insurer level, not a per-policy refund of tax by the state; the build's
per-policy treatment is the practical equivalent and stays a stated rule of this build.

## 6. Assumptions, all labelled in the code and the interface

1. **Flat policy fee $25** (`FLAT_POLICY_FEE_CENTS`, `lib/policy/charge.ts`). An assumption of
   this build, not a filed fee. The policy page says so next to the amount.
2. **The seeded KYB status is not provider evidence.** The seed writes provider `seed` and the
   payload note "development placeholder until slice B3 wires Stripe Connect; not provider
   evidence"; the broker page and the policy page print "KYB: not yet live. The status above is
   a seeded placeholder, not provider evidence." (AF-02).
3. **All demo users share `DEMO_PASSWORD`**; no password material is stored. Deliberate for a
   trial with four synthetic accounts, and a limitation to disclose in the README.
4. **Session cookies cannot be revoked** before they expire (12 hours). No session table.
5. **`checkout.session.completed` is recorded with status `provider_accepted`** because the
   agreed status vocabulary has no better value for "the hosted page was completed". The payload
   carries a note saying exactly what it was. If the reviewer prefers a dedicated status, that
   is one line in the check constraint plus a migration.
6. **Cash and commission are dated the day the money moved**, premium and tax the effective
   date (section 3 above). The architecture note did not state the effective dates.

## 7. Deviations from the assignment, and why

- **A fifth migration file (0004) instead of editing 0002.** The instruction to add TRUNCATE
  guards arrived after 0002 had already been applied to the shared Neon database. The runner
  applies each file once by name, so editing 0002 would have left the shared database without
  the new statements while a fresh database received them. 0004 keeps both identical and leaves
  an honest record. It defines `forbid_truncate_of_financial_record()` with CREATE OR REPLACE
  and a body identical to the one in the coordinator's 0003, so the order of application does
  not matter. **The coordinator should check that 0003 and 0004 agree once they are merged.**
- **`scripts/migrate.ts` learned `--database=test`.** Needed to migrate the disposable database.
  It also now loads `.env.local` unconditionally (variables already in the environment still
  win), otherwise `DATABASE_URL_TEST` was unreachable.
- **`lib/payments/collection.ts` takes the database handle as a defaulted parameter.** So the
  replay check runs the production function against the disposable database. Production callers
  pass nothing.
- **`next.config.ts` sets `agentRules: false`.** Next.js 16's `next dev` appends a block to
  `AGENTS.md` on every run. The file was restored with `git checkout` and the generator turned
  off; without this every dev run produces a spurious diff on a mandatory trial file.

## 8. Two defects found in existing code, one fixed here

- **Fixed: jsonb payloads were being stored double-encoded.** `${JSON.stringify(x)}::jsonb` in
  postgres.js stores a jsonb *string*, not an object, so `payload -> 'data'` found nothing. This
  was already the case for `webhook_events.payload` in slice B1a. Every insert now uses
  `handle.json(x)`. Verified: `jsonb_typeof(payload)` is now `object`, and the events of the
  local run are findable by `payload->'data'->'object'->'metadata'->>'operation_id'`. **Rows
  written before this fix keep their old shape and cannot be updated (AF-03); they are the B1a
  probe events only.**
- **Not fixed, for the coordinator:** `webhook_events` rows stored before today's fix hold a
  jsonb string. Any future reconciliation query over historical payloads must tolerate both
  shapes, or ignore those probe rows.

## 9. Commands actually run, with results

All from the worktree root, against the shared Neon database unless stated.

```
$ npm run migrate
skip    0001_ledger_core_and_webhook_inbox.sql
applied 0002_policies_and_money_operations.sql
applied 0004_truncate_guards_for_policy_and_money_tables.sql

$ npm run migrate -- --database=test          # disposable database corgi_test
skip    0001_ledger_core_and_webhook_inbox.sql
applied 0002_policies_and_money_operations.sql
applied 0004_truncate_guards_for_policy_and_money_tables.sql

$ npm run typecheck        # tsc --noEmit, no output, exit 0
$ npm run build            # compiled, 12 routes listed, exit 0
$ npm test                 # 55 tests, 55 pass, 0 fail
$ npm run check:ledger-guards      # 10 PASS, 0 FAIL (migration 0001 guards)
$ npm run check:money-guards       # 43 PASS, 0 FAIL (migration 0002 and 0004 guards)
$ npm run check:payment-replay     # 15 PASS, 0 FAIL (on corgi_test)
```

`npm run check:money-guards`, sample lines (every check runs in a rolled-back transaction):

```
PASS  owner cannot UPDATE money_operations  (financial records are append-only: UPDATE on money_operations is not allowed (correct with a reversal entry))
PASS  owner cannot TRUNCATE policy_events  (financial records are append-only: TRUNCATE on policy_events is not allowed)
PASS  app_runtime lacks DELETE on journal-adjacent tables ... (permission denied for table ...)
PASS  recorded_at and created_at ignore the client value  (stored 2026-09-08T09:45:29.495Z instead of 2000-01-01)
```

`npm run check:payment-replay` (runs the production function twice under the restricted runtime
role, on `corgi_test`):

```
PASS  the first delivery posts the money  (outcome: posted)
PASS  the second delivery of the same payment is recognised as already posted  (outcome: already_posted)
PASS  exactly four entries exist, one of each type  (commission_earned x1, premium_collected x1, premium_written x1, tax_and_fee_billed x1)
PASS  cash at Stripe is debited once with the whole charge  (125320 cents)
PASS  unearned premium is credited with the written premium  (120000 cents)
PASS  the state premium tax is separated from the premium  (2820 cents)
PASS  the policy fee is income at issuance  (2500 cents)
PASS  the broker commission is 15% of the collected premium  (18000 cents)
PASS  the receivable opened by the billing entries is fully cleared  (debit 125320 = credit 125320)
PASS  the four entries balance  (debits 268640 = credits 268640)
PASS  the policy was issued exactly once  (1 issuance event(s))
PASS  the policy shows as bound  (status: bound)
PASS  one success event was appended, not two  (1 succeeded event(s))
PASS  a payment for another amount is refused, not journaled  (amount mismatch: Stripe collected 999 cents, the operation asked for 125320)
```

```
$ npm run seed
broker              Redwood Commercial Brokers (15.00% commission) edae60d2-...
customer            Bay Area Fabrication LLC 5f55b8dd-...
users               broker@example.com, customer@example.com, ops@example.com, approver@example.com
                    password: the value of DEMO_PASSWORD (not printed)
state tax rate      CA 235 bps from 1986-01-01
broker KYB          approved by provider 'seed' (development placeholder, not provider evidence)

$ npm run seed        # second run, must refuse
This database already holds data, so a seed from zero is refused:
  brokers: 1 row(s)
  customers: 1 row(s)
  users: 4 row(s)
  state_tax_rates: 1 row(s)
  broker_kyb_events: 1 row(s)
Financial rows can never be deleted (AF-03). Use an empty database.
```

### Local end-to-end, on `http://localhost:3100` against the shared Neon database

```
$ APP_BASE_URL=http://localhost:3100 PORT=3100 npm run dev
$ curl ... POST /api/session/login  (broker@example.com)
  login: HTTP 303 -> http://localhost:3100/broker
$ curl ... POST /api/policies  (CA, 2028-03-01, premium 1200.00, limits 1000000 / 2000000)
  create policy: HTTP 303 -> http://localhost:3100/policies/de2fb99f-8db4-4aa3-9ee5-827e444ab5ad
  page shows: CGP-01061, Status: draft, KYB: approved + "KYB: not yet live" note,
              $1,200.00 premium, $28.20 tax, $25.00 fee, $1,253.20 total
$ curl ... POST /api/policies/<id>/checkout
  HTTP 303 -> https://checkout.stripe.com/c/pay/cs_test_b1BblgFhUnCOfCMvMA7QNrlkZpcq4Fbc9tbMmQWsD8WRgnBmoX...
  (a real Stripe test-mode Checkout Session; page now shows Status: awaiting_payment,
   last status: provider_accepted, Stripe session cs_test_b1Bblg...)
$ curl ... POST /api/policies/<id>/checkout      # clicking Pay a second time
  HTTP 303 -> the SAME cs_test_b1Bblg... URL, no second session, no second operation
```

Completing the hosted Checkout page needs a browser, so the payment confirmation was delivered
by signing a `payment_intent.succeeded` event with the LOCAL webhook secret
(`STRIPE_WEBHOOK_SECRET` in the copied `.env.local` was changed to a local value; the production
secret was not touched) and posting it to the local route:

```
$ npx tsx scripts/post-local-webhook.ts --operation=fafe3cc4-... --amount=125320 \
      --url=http://localhost:3100/api/webhooks/stripe --times=2
delivery 1: HTTP 200 {"received":true,"status":"done"}
delivery 2: HTTP 200 {"received":true,"duplicate":true}        # same event id: the inbox lease refuses it

$ npx tsx scripts/post-local-webhook.ts --operation=fafe3cc4-... --amount=125320 --tag=second-event --times=1
delivery 1: HTTP 200 {"received":true,"status":"done"}         # a DIFFERENT event, same payment
```

State after those three deliveries, read straight from the database:

```
journal entries: commission_earned(2026-09-08) x1, premium_collected(2026-09-08) x1,
                 premium_written(2028-03-01) x1, tax_and_fee_billed(2028-03-01) x1
  cash_stripe            debit  125320  credit       0
  commission_expense     debit   18000  credit       0
  commission_payable     debit       0  credit   18000
  fee_income             debit       0  credit    2500
  premium_receivable     debit  125320  credit  125320
  premium_tax_payable    debit       0  credit    2820
  unearned_premium       debit       0  credit  120000
totals: debits 268640 credits 268640
operation lifecycle: requested -> provider_accepted(cs_test_b1BblgFhUn) -> succeeded(pi_local_fafe3cc4)
policy events: quoted@2028-03-01, issued@2028-03-01
policy_current: {"status":"bound","total_charge_cents":"125320","tax_cents":"2820","fee_cents":"2500",...}
webhook inbox:
  evt_local_fafe3cc4_payment_intent_succeeded               done    attempts=1
  evt_local_fafe3cc4_payment_intent_succeeded_second-event  done    attempts=1  "already posted by an earlier delivery of this payment"
  evt_local_00000000_payment_intent_succeeded_1             ignored attempts=1  "no stripe_checkout money operation 00000000-..."
  evt_local_ddede650_payment_intent_payment_failed_1        done    attempts=1
```

Failure and authorisation paths, same session:

```
second draft, premium 3,450.75 -> tax floor(345075 x 235 / 10000) = 8109, total 355684  ($3,556.84)
payment_intent.payment_failed on it -> Status: payment_failed, last status: failed,
                                       "Nothing has been posted yet" (no journal entry at all)
GET /broker with no cookie                       -> 307 /login
POST /api/policies/<id>/checkout with no cookie  -> 303 /login?error=Please+sign+in+again
GET the broker's policy as the customer user     -> 307 /broker
POST checkout as the customer user               -> 303 ...?error=Only the owning broker can pay a policy
GET /broker with a forged cookie signature       -> 307 /login
$ npm run rebuild:policy-current                 -> 2 policy rows rebuilt from their events, identical
```

## 10. What was NOT verified, and why

- **A real card payment through the hosted Checkout page.** It needs a browser; the delivery was
  simulated locally as described above. The Checkout Session itself is real (`cs_test_...`
  created by the Stripe API). **Slice B2 is not proven live until someone pays with a test card
  on the deployed URL and Stripe's own webhook arrives there.** That run belongs to the
  coordinator, and the integration inventory must stay honest until then.
- **The KYB refusal, live.** The rule is unit-tested (`lib/broker/eligibility.test.ts`) and the
  call site is one line in `startCheckout`, but no HTTP run exercised it: the seeded broker is
  approved and a KYB event cannot be deleted, so making it pending would permanently block the
  demo broker. Slice B3 will exercise it with real Stripe Connect statuses.
- **Concurrent duplicate deliveries of the same event** were verified in B1a, not re-run here.
- **The processing-lease expiry path** (a function killed mid-processing) was not exercised.
- **Deployment.** Nothing was pushed or deployed by this delegate.
- **Independent review.** Not performed by this delegate, by design.
- **Walkthrough with Yoann: NOT REVIEWED WITH YOANN.**

## 11. Needs a decision or an action

1. **Merge order with migration 0003.** Check that 0003 and 0004 define
   `forbid_truncate_of_financial_record()` identically and touch disjoint tables.
2. **`db/client.ts` fail-closed change** announced by the coordinator was left untouched here to
   avoid a merge conflict.
3. **Demo data now in the trial database**: two policies (CGP-01061 bound, CGP-01062 payment
   failed) and their entries were created by the local end-to-end. They cannot be deleted. They
   are legitimate demo data, but the coordinator should decide whether the demo starts from them
   or from fresh policies.
4. **`payment_intent.succeeded` posts on `amount_received`.** A partial capture would be refused
   as an amount mismatch rather than posted; that is deliberate for v0 and worth a line in the
   README limitations.
5. **The flat $25 fee** stays an assumption until Yoann confirms or replaces it.
6. **Stripe processing fees are still not journaled** (F-13 of the design review). Unchanged by
   this slice; `cash_stripe` is gross.
