# Architecture (v0 design, before implementation)

Written at 2026-09-08T08:22:00+00:00 for the initial design review required by AGENTS.md and REVIEWER.md. Revised at 2026-09-08T08:50:00+00:00 after the DESIGN FAIL recorded in docs/reviews/architecture.md (findings F-01 to F-21); items marked OPEN (Yoann) wait for his decision. Scope: the data model, money rules, trust boundaries and jobs for slices B1 to B12 in PLAN.md. Decisions with money impact were taken by Yoann and are recorded in DECISIONS.md; this document turns them into tables and functions. It is a design, not evidence of implementation.

## 1. Shape of the system

One Next.js application on Vercel. Server code lives in route handlers and server actions; there is no separate worker. Postgres on Neon holds two kinds of tables:

- **Protected financial records** (append-only, AF-03): `accounts`, `journal_entries`, `journal_lines`, `policy_events`, `money_operations`, `money_operation_events`, `webhook_events`, `claim_events`, `approval_requests`, `approval_decisions`, `broker_kyb_events`, `statement_runs`, `state_tax_rates`, `reconciliation_runs`, `reconciliation_breaks`, `simulator_provider_records`. Two independent guards: a `BEFORE UPDATE OR DELETE` trigger that raises on each of them, and a runtime role `app_runtime` that only has `SELECT` and `INSERT` on them. Migrations and the seed run as the owner; the application never does. `recorded_at` columns are set by a `BEFORE INSERT` trigger from the database clock and the runtime role has no column grant to write them. No protected table has `ON DELETE CASCADE` pointing into it, and `TRUNCATE` is not granted. The seed script refuses to run when any protected table already holds a row; tests use a fresh database per run (Neon branch or a local Postgres), never the trial database.
- **Nonfinancial mutable tables**: `users`, `sessions`, `webhook_processing` (retry metadata), `policy_current` (a rebuildable projection, explicitly a cache). Nothing here determines a balance.

Money is `bigint` cents everywhere. No floats, no numeric with scale in application code. `recorded_at` is UTC; `effective_at` is a calendar date without timezone, like a policy effective date. Ledger practice check (2026-09-08, against Modern Treasury, Square Books and Stripe Ledger write-ups): balanced transactions enforced in the database, normal balance per account, immutability with reversal entries, effective versus recorded time, idempotency per source, balances derived from entries, integer minor units. Deliberate simplification: no pending ledger status; uncertainty lives in `money_operation_events` and in the clearing accounts `premium_receivable`, `refund_payable` and `claims_payable`, which must return to zero once a flow completes. The reconciliation screen (B10) therefore also lists non-zero clearing balances with their age.

## 2. Ledger

`accounts` is a small chart of accounts seeded once (id, name, side: `debit` or `credit`). v0 accounts:

| id | side | meaning |
|---|---|---|
| `cash_stripe` | debit | money held at Stripe for us (gross of Stripe fees, which we do not model in v0) |
| `premium_receivable` | debit | premium billed to a customer and not yet collected |
| `unearned_premium` | credit | written premium not yet earned, owed back on cancellation |
| `earned_premium` | credit | premium earned to date (posted at events, see 3) |
| `premium_tax_payable` | credit | state premium tax collected, owed to the state |
| `fee_income` | credit | flat policy fee, fully earned at issuance |
| `commission_expense` | debit | broker commission earned on collected premium |
| `commission_payable` | credit | commission owed to brokers, reduced by clawbacks |
| `refund_payable` | credit | refunds requested at Stripe and not yet completed |
| `claim_reserve` | credit | open case reserves (estimates) |
| `claims_paid` | debit | claim payments sent on the rail |
| `claims_payable` | credit | claim payments sent and not yet settled on the rail |
| `short_rate_penalty_income` | credit | present so short-rate cancellation is representable; unused in v0 |
| `incurred_loss_expense` | debit | claims expense recognised when a reserve is set or adjusted |
| `cash_claims_rail` | debit | money at the claim payout rail (simulator) after settlement |
| `customer_credit` | credit | credit owed to a customer after a negative endorsement delta, if that option is chosen |

Claim entries (example: reserve $5,000, payment $1,200, then a return): reserve set: Dr incurred_loss_expense 500000 / Cr claim_reserve 500000; reserve adjusted to $4,000: Dr claim_reserve 100000 / Cr incurred_loss_expense 100000; payment sent: Dr claim_reserve 120000 / Cr claims_payable 120000; payment settled on the rail: Dr claims_payable 120000 / Cr cash_claims_rail 120000; payment returned by the bank: Dr cash_claims_rail 120000 / Cr claims_payable 120000 then Dr claims_payable 120000 / Cr claim_reserve 120000 (the money is back and the reserve is restored). Paid = settled payments minus returns; incurred = paid + reserve; a payment that would take paid past the policy limit is refused inside a per-claim transaction that locks the claim row.

`journal_entries` (header): `id`, `entry_type`, `effective_at` (business date the entry belongs to), `recorded_at` (booking time, set by the database, never by the client), `policy_id`, `claim_id`, `broker_id`, `source_kind` + `source_id` (the business operation, webhook event or statement that caused it), `reverses_entry_id` (set only on reversal entries), `description`. Unique constraint on (`source_kind`, `source_id`, `entry_type`). For provider money, `source_kind` is always `money_operation` and `source_id` the operation id, never the webhook event id: two Stripe events (`checkout.session.completed`, `payment_intent.succeeded`) describe one collection and three (`refund.created`, `refund.updated`, `charge.refunded`) describe one refund, so keying on the event would double-post. Each entry type names the single provider status that posts it (collection: `payment_intent.succeeded`; refund completed: `refund.updated` with status `succeeded`; refund failed: `refund.failed` posts `refund_failed`, which reverses `refund_requested` and reopens the receivable for operations). A unique violation on posting means already posted and is treated as success. `reverses_entry_id` is unique (an entry is reversed at most once); an entry with no lines is rejected by the same deferred trigger that checks balance.

`journal_lines`: `entry_id`, `account_id`, `debit_cents`, `credit_cents`, with a check that exactly one of them is positive. A deferred constraint trigger checks at commit that every entry balances (sum of debits = sum of credits); an unbalanced entry cannot be committed. Posting goes through one TypeScript function `postJournalEntry(transaction, header, lines)` in `lib/ledger/post.ts` that inserts the header and its lines inside the caller's transaction; the database trigger remains the guard. One place to read, no composite SQL types.

Every displayed balance is `sum(debit) - sum(credit)` (or the reverse for credit-side accounts) over lines whose entry has `effective_at <= as_of`. Historical balances are the same query with an earlier `as_of`. "What was known on date K" is the same query filtered on `recorded_at <= K` instead.

## 3. Policy events and premium

`policies`: identity only (`id`, `policy_number`, `broker_id`, `customer_id`, `state_code`, `created_at`). `policy_events` is the truth: `id`, `policy_id`, `event_type` (`issued`, `endorsed`, `cancelled`, `correction_reversal`, `correction_rebook`), `effective_at`, `recorded_at`, `payload` (limits, vehicles, annual premium cents, tax and fee cents, calculation inputs), `supersedes_event_id` for corrections, `created_by`. The policy as of any date is the fold of its events with `effective_at <= as_of` (excluding events reversed by a correction whose reversal has `effective_at <= as_of`). `policy_current` caches the fold for lists and is rebuilt from events.

Premium rules (pure functions in `lib/money/`, each with a worked example in its test):

- `termEnd(termStart)`: same calendar date next year, or the last day of February when it does not exist. `termDays = daysBetween(termStart, termEnd)`.
- `earnedCents(writtenCents, termStart, termEnd, asOf)` = floor(written x elapsedDays / termDays), elapsedDays clamped to [0, termDays]. Unearned = written - earned. Insurer eats the penny.
- `endorsementDeltaCents(oldAnnual, newAnnual, effectiveAt, termStart, termEnd)` = (newAnnual - oldAnnual) x remainingDays / termDays, floored when the customer pays, ceiled in absolute value when the customer is credited. Each `premium_written` entry is a segment with its own earning window: the issuance segment earns from `termStart` to `termEnd`; an endorsement segment earns its delta from its `effectiveAt` to `termEnd`. Earned premium as of a date is the sum over segments. OPEN (Yoann): a negative delta is either refunded immediately through Stripe (a `refund_requested` operation) or held as a customer credit against the next charge; the account `customer_credit` (credit side) exists for the second option.
- `stateTaxCents(premiumCents, rateBps)` = floor(premium x rate / 10000), rate taken from `state_tax_rates` for the policy state at `effective_at`. Flat fee from configuration, charged once at issuance.
- Cancellation refund = unearned premium (ceiled) + tax on the unearned premium (ceiled) + 0 fee. Short-rate is not computed; the cancellation event carries `calculation_method = 'pro_rata'` and the penalty account exists.

Entries posted per event (issuance example, $1,200 premium, 3% tax, $25 fee). OPEN (Yoann): the recorded example says March 1, 2028 to March 1, 2029 with 366 days, but that term has 365 days (February 29, 2028 falls before it). Either the example moves to January 1, 2028 (366 days, all figures below unchanged) or the figures become earned 32876, refund 87124, tax refund 2614, total 89738. The figures below assume the 366-day term pending that decision:

| moment | entry | lines |
|---|---|---|
| bound (after payment) | `premium_written` | Dr premium_receivable 120000 / Cr unearned_premium 120000 |
| bound | `tax_and_fee_billed` | Dr premium_receivable 6100 / Cr premium_tax_payable 3600, Cr fee_income 2500 |
| Stripe webhook | `premium_collected` | Dr cash_stripe 126100 / Cr premium_receivable 126100 |
| Stripe webhook | `commission_earned` | Dr commission_expense 18000 / Cr commission_payable 18000 (15% of collected premium, tax and fee excluded) |
| cancellation day 100 | `premium_earned_to_date` | Dr unearned_premium 32786 / Cr earned_premium 32786 |
| cancellation | `refund_requested` | Dr unearned_premium 87214, Dr premium_tax_payable 2617 / Cr refund_payable 89831 |
| refund webhook | `refund_completed` | Dr refund_payable 89831 / Cr cash_stripe 89831 |
| refund webhook | `commission_clawback` | Dr commission_payable 13082 or 13083 / Cr commission_expense (15% of refunded premium 87214 = 13082.1; OPEN (Yoann): floor 13082 keeps the single rule "the insurer absorbs every fraction", ceil 13083 recovers it from the broker) |

Earned premium between events is derived by the pure function from the `premium_written` entries and their policy term; the ledger posts an `earned_to_date` entry whenever a money event needs it (cancellation, statement close), so as-of balances and the statement agree.

Correction of a wrong effective date (B8): a `correction_reversal` policy event plus reversal journal entries (`reverses_entry_id` set, lines mirrored) at the original effective date, then a `correction_rebook` event and fresh entries at the correct date. Original rows are untouched; both `effective_at` views and `recorded_at` views stay queryable.

OPEN (Yoann): a closed month whose figures are later corrected. Design proposal: `statement_runs` stores the effective period and a `knowledge_cutoff` (the `recorded_at` upper bound used); rerunning with the same cutoff reproduces the same document forever, and a correction recorded after the cutoff produces a new run (revision 2) that shows the corrected figure and references revision 1. Both stay readable.

Cancellation with an open claim (live fire): the refund covers unearned premium only; the claim, its reserve and any payment are unaffected because the loss occurred during the covered period; commission is clawed back on the refunded premium; the policy status becomes `cancelled` with the claim still open. This is written here so the answer at the debrief is the written rule, not an improvisation.

## 4. Money operations and providers

`money_operations` (immutable intent): `id`, `kind` (`stripe_checkout`, `stripe_refund`, `claim_payout`), `amount_cents`, `policy_id`, `claim_id`, `idempotency_key` (unique, derived from the business intent), `approval_request_id` (unique when set), `created_by`, `created_at`. `money_operation_events` (append-only lifecycle): `operation_id`, `status` (`requested`, `provider_accepted`, `succeeded`, `failed`, `returned`, `unknown`), `provider_ref`, `payload`, `recorded_at`. Current status = latest event. The outbox rule: insert the operation and a `requested` event, commit, then call the provider with the same idempotency key, then insert the outcome event. A crash between the provider call and the outcome leaves a `requested` operation that `/api/jobs/recover-operations` resolves per kind, never by re-sending with a new key: `stripe_checkout` re-issues the identical Checkout Session request with the same idempotency key (Stripe returns the original response within its retention window) or lists sessions by `client_reference_id`; `stripe_refund` lists refunds for the PaymentIntent and matches `metadata.operation_id`; `claim_payout` on the simulator reads the simulator's provider record. When nothing is found the operation gets an `unknown` event and appears in the operations view for a human.

Stripe: hosted Checkout Session with `client_reference_id = operation id` and the idempotency key; webhooks `checkout.session.completed`, `payment_intent.succeeded`, `refund.created`, `refund.updated`, `refund.failed`, `charge.refunded`. Refunds are created against the original PaymentIntent. When a policy has several collections (issuance plus endorsement), the refund is allocated newest collection first until the refund amount is covered, one Stripe refund per PaymentIntent, each its own money operation; the allocation is stored on the operations. Sandbox guard (AF-04): the Stripe secret key must start with `sk_test_` and `GET /v1/account` is called at startup of every entry point (routes, jobs, seed, MCP); a `livemode: true` event or key fails closed. Stripe fees: v0 does not journal Stripe processing fees; BalanceTransactions of type `stripe_fee` are excluded explicitly by the reconciliation classifier and the exclusion is disclosed in README (the ledger shows gross cash at Stripe).

Broker KYB (B3), provider OPEN (Yoann): Sumsub's trial exposes KYC only (verified by API on 2026-09-08), Middesk requires a sales contact, Persona's KYB needs a transaction type provisioned by Persona (being checked). Whichever provider is used sits behind one small interface `BrokerKybProvider { start(broker), parseWebhook(request) }` with an explicit sandbox marker check (Persona key prefix `persona_sandbox_`, Stripe `livemode` false); every status event is stored append-only in `broker_kyb_events`; local eligibility is `unknown` until a webhook or poll says `approved`, and binding checks eligibility server-side at execution time. If the last resort is Stripe Connect business verification, README and UI say so and disclose that both live slots then run on Stripe.

Simulated rails (B7): `LOCAL SIMULATOR` implementations for bank ownership and claim payout live behind the same operation tables with `provider = 'simulator'`. The simulator keeps its own provider-side table `simulator_provider_records` (append-only, written only by the simulator module, never by the ledger code) holding what "the bank" believes: transfer id, amount, status (`sent`, `settled`, `returned`), settlement date. Settlement and returns are later records created by a job or a staff action. The reconciliation job diffs this table against the ledger exactly as it diffs Stripe, so a mismatch can be planted on the provider side without touching the ledger (the live-fire test). Labeled as simulated in README and UI.

## 5. Webhooks

`webhook_events` (immutable): `provider`, `provider_event_id`, `event_type`, `livemode`, `payload`, `signature_verified`, `received_at`; unique (`provider`, `provider_event_id`). `webhook_processing` (mutable, nonfinancial): `webhook_event_id`, `status`, `attempts`, `last_error`, `updated_at`. Flow: verify the signature on the raw body with the provider SDK; insert the event in its own committed transaction together with a `webhook_processing` row in status `pending` (a duplicate key means the event is already stored, and the handler continues to the lease step instead of returning early); take a lease with `UPDATE webhook_processing SET status = 'processing', attempts = attempts + 1 WHERE webhook_event_id = $1 AND status IN ('pending', 'failed') RETURNING *` so that two concurrent deliveries of the same event cannot both process it; process inside one transaction that posts the journal entries and sets status `done`; on failure set status `failed` with a sanitized error and answer 500 so the provider retries; an event already `done` answers 200 without work. Replaying an event twice from the provider dashboard therefore posts once. Events of an unknown type or for an unknown operation are stored and marked `ignored` with a reason, visible in the failed-events view. A staff screen lists `failed` and `ignored` events with a replay action that re-enters the lease; replay is authorized and audited. One webhook signing secret per environment (production, preview, local). Out-of-order updates are tolerated because each entry type is posted at most once per operation and lifecycle regressions are ignored.

## 6. Approvals, roles, MCP

Roles: `broker`, `customer`, `staff_ops` (maker), `staff_approver` (checker). Sessions are signed cookies. `approval_requests` (immutable): `kind`, `subject_id`, `amount_cents`, `intent_hash`, `requested_by`; `approval_decisions` (append-only): `request_id`, `decided_by`, `decision`; a database trigger on `approval_decisions` rejects a decision whose `decided_by` equals the request's `requested_by`, whose decider is not a user with role `staff_approver`, whose decider is not a human principal (users created through MCP API keys are `agent` principals and can never decide), or that is not the first decision for the request (unique `request_id`). The approve route accepts session cookies only, never API keys. Execution re-reads the request, recomputes `intent_hash` and refuses on mismatch or missing approval. Thresholds: money-out above $1,000 and endorsement additional premium above $500 (assumptions, DECISIONS.md).

MCP (B11): one streamable HTTP endpoint; three read tools scoped by the API key's user; the write tool only inserts an `approval_request`.

## 7. Jobs and reconciliation

`/api/jobs/recover-operations` and `/api/jobs/reconcile`, authenticated by `CRON_SECRET`, triggered by a staff "Run now" button and a daily Vercel cron. Reconciliation (B10) lists Stripe PaymentIntents, Refunds and BalanceTransactions (including type `payout` and, excluded with a reason, `stripe_fee`) for a window with overlap, and reads `simulator_provider_records` for the claim rail; it compares both sources to `money_operation_events` and journal entries by provider reference and amount, stores a `reconciliation_runs` summary (immutable) and `reconciliation_breaks` (append-only, with resolution events), and shows breaks with their age.

## 8. Trust boundaries

Browser to server: session cookie, role check on every action, ownership check on every policy and claim. Providers to server: signature verification, `livemode` check, raw-body parsing. Cron and MCP: bearer secret and per-user API key. Database: owner for migrations and seed, `app_runtime` for the app. Logs: structured, correlation id, no payloads.

## 9. Open points

Waiting for Yoann: worked-example date (F-04), negative endorsement delta handling (F-05), closed-month revision rule (F-07), commission clawback rounding (F-17), the KYB provider given trial access, and the modeled state with its tax rate from an official source. Design choice kept: `earned_to_date` entries are posted at money events only; the v0 statement shows collected figures, not earned premium.
