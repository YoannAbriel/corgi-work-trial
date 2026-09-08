# Corgi work trial, Track 1: policy administration

A commercial liability policy from sale to cancellation, with every dollar collected and refunded in the application's own append-only double-entry ledger. Built in the 48-hour window from September 8, 2026, 07:50 Europe/Zurich. Sandbox providers and synthetic data only; no live keys, no real money, no real people.

Deployed URL: https://corgi-work-trial-iota.vercel.app (health: `/api/health` reports the database and the built revision). Demo credentials are handed over in the submission email; roles: `broker@example.com` (broker, KYB approved), `broker2@example.com` (broker, KYB failed on Stripe's tax-id fixture), `broker3@example.com` (broker, never submitted, for a live pending demonstration), `customer@example.com` (customer), `ops@example.com` (staff operations, maker), `approver@example.com` (staff approver, checker). All share the demo password from the deployment secret store.

Decision log: [docs/DECISIONS.md](docs/DECISIONS.md). Status and evidence: [docs/STATUS.md](docs/STATUS.md). Plan and coverage of every official requirement: [docs/PLAN.md](docs/PLAN.md). Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Independent reviews and the findings register: [docs/reviews/](docs/reviews/). Compliance and control matrix: [docs/COMPLIANCE-MATRIX.md](docs/COMPLIANCE-MATRIX.md). Attack plan sent at T+2h: [docs/ATTACK-PLAN.md](docs/ATTACK-PLAN.md). Engineering rules of this repository: [AGENTS.md](AGENTS.md), [AUTOMATIC-FAILS.md](AUTOMATIC-FAILS.md), [READABLE-CODE.md](READABLE-CODE.md).

## Integration inventory (honest modes)

| Slot | Provider | Mode | What is exercised | Limitations |
|---|---|---|---|---|
| Premium collection | Stripe, test mode, hosted Checkout, Refunds API, signed webhooks received by the deployed app | LIVE SANDBOX | Issuance paid with a test card; `payment_intent.succeeded` posts the journal entries once; cancellation refunds through the real Refunds API; `refund.updated` clears the refund liability; replay twice is one | Card only (no ACH in v0); Stripe processing fees are not journaled (cash is gross), excluded explicitly by reconciliation; a Checkout Session expires after 24 h and a new attempt then gets a new operation and key |
| Broker KYB | Stripe Connect Accounts v2 business verification, test mode, published EIN fixtures, `account.updated` events | LIVE SANDBOX (disclosed) | Broker submitted as a connected company account; eligibility read only from Stripe's verification result; pending, approved and failed states; binding refused server-side unless approved | Stripe is not a dedicated KYB vendor and both live slots run on Stripe: Middesk, Sumsub and Persona trials proved gated on September 8 (see DECISIONS.md). A fresh account is held at pending for at least 2 minutes (our measured settling window, not a Stripe guarantee) |
| Bank account verification | Local simulator | LOCAL SIMULATOR | Account holder name and a documented test routing number decide verified or failed; a claim cannot be paid to an unverified account | Not a provider; Plaid sandbox was left as a stretch |
| Document generation | `@react-pdf/renderer` from the policy's event fold | REAL | Declarations page and endorsement schedule as the policy stood on any date | None |
| Claim payout rail | Local simulator with delayed settlement and returns, own provider-side record table | LOCAL SIMULATOR | Send, settle after two days, return; every transition journaled; reconciled against the simulator's own records so a planted mismatch is found | Not a provider; Increase sandbox was left as a stretch |

Anything not listed as LIVE SANDBOX above is not live. Evidence for the live slots is in docs/STATUS.md (event ids, payment intent and refund ids, amounts) and in the evidence pack.

## Run it from a clean clone

Prerequisites: Node 20.19 or later, npm, a Postgres database (Neon free tier is what the deployment uses), a Stripe sandbox (test-mode key), gitleaks for the pre-commit hook.

```bash
git clone https://github.com/YoannAbriel/corgi-work-trial.git && cd corgi-work-trial
npm install
cp .env.example .env.local            # fill in: DATABASE_URL (owner), STRIPE_SECRET_KEY (sk_test_), APP secrets
git config core.hooksPath .githooks   # gitleaks runs on every commit
npm run migrate                       # applies db/migrations/*.sql once each, in name order
npm run set-runtime-role-password     # gives the app_runtime role its password (APP_RUNTIME_DB_PASSWORD)
#   then set DATABASE_URL_APP to the app_runtime connection string; the app refuses to start without it
npm run seed                          # seed from zero: refuses if any table it fills already holds a row
npm run dev                           # http://localhost:3000, log in with a demo user and DEMO_PASSWORD
```

Webhooks: register `https://<your deployment>/api/webhooks/stripe` in the Stripe sandbox for `payment_intent.succeeded`, `payment_intent.payment_failed`, `checkout.session.completed`, `checkout.session.expired`, `refund.created`, `refund.updated`, `refund.failed`, `charge.refunded`, `account.updated`; put its signing secret in `STRIPE_WEBHOOK_SECRET`. Locally, `stripe listen --forward-to localhost:3000/api/webhooks/stripe` prints the secret to use instead. Connected-account events need a second endpoint on the same URL created with `connect=true` (listening to `account.updated`); it has its own signing secret, `STRIPE_CONNECT_WEBHOOK_SECRET`, and the route verifies each delivery against either secret.

Checks that exist and what they prove (every database check rolls back or runs on the disposable database `corgi_test`, never on the trial ledger):

```bash
npm run typecheck && npm run build && npm test        # unit tests: money rules with worked examples, folds, PDFs, sessions
npm run check:ledger-guards                          # AF-03 guards on the trial database, rolled back: UPDATE, DELETE, TRUNCATE refused; balance enforced at commit
npm run check:money-guards                           # the same guards on every protected table added since
npm run migrate -- --database=test                   # migrate corgi_test (create it once with `create database corgi_test`)
npm run check:ledger-seal                            # entries sealed at commit; live-mode events refused by the database
npm run check:payment-replay                         # same payment delivered twice posts once; wrong amount refused; expired session gets a new attempt
npm run check:refund-replay                          # refund posted once; refund.failed posts nothing; clawback once
npm run check:kyb-replay                             # KYB status appended only on change; settling window; binding refused unless approved
npm run check:claims-and-approvals                   # incurred = paid + reserve after every step; limits; maker-checker refusals; rejected refund re-issue returns to the queue
npm run check:reconciliation                         # every classification once; a planted PaymentIntent of $42.42 (created in the sandbox on each run) is found; a failed fetch never reads clean
# Jobs: the daily cron (06:00 UTC, /api/jobs/daily) runs recovery, simulated settlement and reconciliation; the staff Run now form covers reconciliation only, so between cron runs recovery and settlement are triggered with the CRON_SECRET bearer, or the claim screen's LOCAL SIMULATOR settle button for one payout.
npm run void:fabricated-binding -- --policy=CGP-xxxxx --reason="..."   # operations correction: reversal entries plus a dated event (asks Stripe first)
npm run rebuild:policy-current                       # rebuilds the policy_current cache from events, proving it is a cache
```

## Money rules of this build (decided by the candidate, see DECISIONS.md)

USD integer cents everywhere. A term is one calendar year (February 29 to February 28); premium earns pro-rata daily over the real day count. Endorsement deltas are priced over the remaining days from the effective date, never the entry date. The insurer eats the rounding penny: charges are rounded down, refunds rounded up. State premium tax: California, 2.35 percent (Cal. Const. art. XIII s. 28(d)), refunded pro-rata with the premium and capped at the tax charged; the $25 flat policy fee is an assumption of this build, fully earned at issuance, never refunded. Commission is earned on collected premium, clawed back on refunded premium, rounded down. Cancellation is pro-rata; short-rate is representable (method stored on the event, penalty account exists) but not computed. Money-out above $1,000 needs a distinct human approver (assumption, not a Corgi rule). Money that arrives for a broker who lost eligibility between the payment page and the payment is journaled at once in a suspense account (unapplied customer cash) and applied to the policy when staff bind it, so ledger cash equals Stripe cash at every instant. Known gap of v0: refunding that parked money to a customer whose broker fails for good is not built; the balance stays visible in the suspense account and on the reconciliation screen until it is applied or refunded by hand in the Stripe sandbox (which the reconciliation would then show as provider-only until recorded). A claim payment counts as paid when it is sent on the rail (incurred = paid + reserve stays two terms); cash leaves the rail account only at settlement, shown separately, and a bank return undoes the payment. The $1,000 approval threshold is cumulative per claim: a payment that alone or together with what the claim already sent or has waiting exceeds $1,000 needs a distinct approver.

Recited example: $1,200 written March 1, 2028 (365 days), tax $28.20, fee $25, charge $1,253.20; cancelled June 9, 2028: earned 32876 cents, unearned 87124, tax refunded 2048, fee 0, total refund $891.72, clawback 13068 cents.

## Corrections and history

Nothing financial is ever updated or deleted: Postgres triggers refuse UPDATE, DELETE and TRUNCATE on every money table for every role, the runtime role only has SELECT and INSERT, entries are sealed at commit, and the balance of each entry is checked by the database at commit. Corrections are reversal entries linked to the originals plus a dated policy event; the fold of policy events skips superseded events. Every entry carries an effective date (business time) and a recorded time (set by the database), so "as it stood on May 3" and "what was known on May 3" are two different queries over the same rows.

Known facts about the demo data: policy CGP-01061 was bound during development on a locally signed webhook, then corrected by reversal (the reversal entries and the correction event are visible on it; its Checkout Session was expired at Stripe). Two synthetic replay-test events (`evt_replaytest_*`) and a few probe payments with metadata `corgi_probe` exist in the Stripe sandbox and the inbox; they are stored, marked ignored, and never posted. The refund of CGP-01062 ($3,241.56) was issued before maker-checker existed and therefore had no approver; that gap is disclosed here and closed by the approvals slice.

## Cut list v0 and week-two plan

Deliberately not built: renewals, a public REST API (MCP is the machine surface), a customer portal beyond approvals and documents, ACH collection, installment billing, e-signature, USDC payout, a second product line, reinsurance, broker API keys. Production-only work recorded as limitations rather than built: a real KYB policy, real tax filings, real bank rails, Stripe fee accounting, revocable sessions. Week two, in order: a dedicated KYB vendor behind the same interface, ACH collection, Plaid bank verification and Increase payout rail live, renewals, installment billing, then the public API.
