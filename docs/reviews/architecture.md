# Initial architecture review (design stage)

- Scope: `docs/ARCHITECTURE.md` (v0 design for slices B1 to B12): data model, money rules, trust boundaries, webhooks and outbox, approvals, jobs and reconciliation, checked against the general non-negotiables, the Track 1 gauntlet and live-fire items in `docs/BRIEF-REFERENCE.md`, and AF-01 to AF-06.
- Reviewer: independent reviewer sub-agent (design review, no implementation, no delegation).
- Timestamp: 2026-09-08T08:28:00Z.
- Revision: HEAD `a8d84eba4a7572b2f70e3e4fccb2916137da5edd` (branch `main`). `docs/ARCHITECTURE.md` is uncommitted in the working tree; SHA-256 `419345fa4e5323517e0daf699c41bf021337fe1e83c94d833203f9e839c2de67` (`shasum -a 256`).
- Verdict: **DESIGN FAIL** (three HIGH findings, all correctable at document level; see section 8 for which slices are affected).

## 1. Startup receipt

Read in full: `AUTOMATIC-FAILS.md`, `AGENTS.md`, `WORKFLOW-48H.md`, `REVIEWER.md`, `READABLE-CODE.md`, `docs/BRIEF-REFERENCE.md` (general and Track 1 sections; Track 2 and 3 skimmed only), `docs/DECISIONS.md`, `docs/PLAN.md`, `docs/ARCHITECTURE.md`, `docs/STATUS.md`. Scaffold inspected: `db/client.ts`, `scripts/migrate.ts`, `app/api/health/route.ts`, `.env.example`, `.githooks/pre-commit`, `.gitignore`, `db/migrations/` (only `.gitkeep`, no migration yet). Not read: `.env.local` (exists, deliberately not opened), `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `GAP-REVIEW.md`, `READINESS-BACKLOG.json` (advisory, out of scope for a design review). Absent files: none of the mandatory kit files are missing. No external legal or provider documentation was fetched during this review; Stripe behaviours mentioned below are marked "verify at B2".

## 2. Confirmed applicability and assumptions

Confirmed from the brief extraction: US only, USD integer cents, own append-only double-entry ledger, Stripe test mode as the live premium-collection slot with a real refund API, a live broker KYB slot, simulated bank verification and claim payout allowed, real PDF generation, maker-checker above a threshold, reconciliation with a planted break, MCP with three read tools and one approval-queued write tool.

Assumptions carried by the design and treated as assumptions, not rules: thresholds ($1,000 money-out, $500 endorsement customer approval), commission basis (collected premium, one rate per broker), penny rule (insurer eats it), term end rule, tax refundability on cancellation, flat fee fully earned at issuance. The modeled state and its premium tax rate are not chosen yet and must come from an official source (design section 9, open point 3). Whether the chosen state's premium tax is refundable on the unearned portion is a rule of this build until an official source says otherwise; it must be labeled that way in the UI and README. No FinCEN, OFAC or CFPB duty was asserted by the design and none is asserted here; broker KYB is a trial requirement satisfied with sandbox test entities.

## 3. Requirement matrix (design level)

| Requirement | Planned control in ARCHITECTURE.md | Planned evidence (PLAN.md) | Design verdict |
|---|---|---|---|
| Own immutable double-entry ledger, balances derivable as of any date (NN-2, AF-03) | `journal_entries` + `journal_lines`, check one positive side per line, deferred balance trigger, unique (source_kind, source_id, entry_type), as-of by `effective_at`, knowledge view by `recorded_at` | B1 unit and negative tests | PASS with LOW findings F-14 to F-16 |
| AF-03 enforced at the database boundary | BEFORE UPDATE OR DELETE trigger raising on 12 listed tables, `app_runtime` role with SELECT and INSERT only, owner for migrations and seed | B1 negative test | PASS with F-09 (seed, TRUNCATE, cascades) and F-14 (list inconsistent) |
| Verified webhooks, idempotency, out-of-order (NN-4) | Raw-body SDK verification, immutable `webhook_events` unique per provider event id, mutable `webhook_processing`, journal uniqueness, regressions ignored | B2 replay test, Stripe webhook log | FAIL: F-01, F-02 |
| Outbox and recovery never re-send with a new key | `money_operations` immutable intent with unique idempotency key, `requested` event committed before the provider call, recovery job resolves by lookup | B2, B5 | PASS in principle, F-11 (Stripe lookup mechanism unspecified) |
| Issuance and live collection with taxes and fees separated | Separate accounts `premium_tax_payable`, `fee_income`; commission on premium only; issuance example balances | B2 real test-card payment | PASS (arithmetic checked, see section 6) |
| Endorsement delta from effective date, not entry date | `endorsementDeltaCents` over remaining days | B4 numeric tests | PASS with F-05 (earning window per segment, negative delta) |
| Cancellation pro-rata, real refund, clawback, short-rate representable | Refund = unearned ceiled + tax ceiled + 0 fee; `refund_requested` then `refund_completed`; `commission_clawback`; `calculation_method` on the event, penalty account exists | B5 Stripe dashboard, journal rows | FAIL: F-02 (refund event keying), F-12 (allocation across payments), F-17 (clawback rounding undecided) |
| Backdated correction by reversal plus re-book, originals untouched, both time views | `correction_reversal` and `correction_rebook` events, `reverses_entry_id`, `recorded_at` set by database | B8 rehearsal script | PASS with F-07 (statement revisions) and F-15 |
| Claims: reserve append-only, payments reduce reserve, incurred = paid + reserve, limit cap | `claim_events`, `claim_reserve`, `claims_paid`, `claims_payable` | B7 tests | FAIL at design level: F-06 (chart cannot book a reserve double-entry, no payout cash account) |
| Maker-checker: initiator and agent cannot approve, any path (NN-6) | Self-approval trigger, role check, `intent_hash` re-check at execution, `approval_request_id` unique on operations | B7 self-approval, concurrency, changed-intent tests | PASS with F-10 (where the human/role check lives, API-key principals) |
| Broker statement tied to cents, closed month rerun identical | `statement_runs` immutable with content hash | B9 equality test | BLOCKED pending F-07 definition |
| Reconciliation from provider truth with breaks screen and planted break (NN-7, live fire) | Job lists Stripe PaymentIntents, Refunds, BalanceTransactions with overlap; immutable runs, append-only breaks | B10 screen with planted break | FAIL: F-03 (payout rail not reconciled), F-13 (fees) |
| MCP: three read tools, one approval-queued write tool (NN-8) | Streamable HTTP endpoint, per-user API key, write tool inserts an `approval_request` only | B11 inspector log | PASS with F-10 |
| Sandbox only, fail closed (AF-04) | `livemode === false` on every Stripe event | B2 | PASS for webhooks, F-08 for outbound calls, Sumsub, jobs, seed, MCP |
| Simulated slots honestly labeled (AF-02) | `provider = 'simulator'`, labeled in README and UI | B6 integration inventory | PASS at design level |
| Money never float, stated rounding, deterministic penny (NN-9) | bigint cents, floor charges, ceil refunds, insurer eats the penny | B1 | PASS with F-04 (example day count wrong) and F-17 |
| Readable for a line-by-line debrief (AF-06, READABLE-CODE.md) | Small chart, one posting function, pure functions with examples | walkthrough in B13 | PASS with F-19 (suggestions) |

## 4. Flow traces (actor, entry, authorization, service, database, provider, webhook, journal, reconciliation)

- Issuance with Stripe Checkout: broker (session cookie, role and ownership check) creates the policy quote; server computes premium, tax and fee with pure functions; inserts `money_operations` (`stripe_checkout`, idempotency key from intent) and a `requested` event, commits, creates the Checkout Session with `client_reference_id` = operation id; Stripe webhook verified on raw body, `livemode` false, stored in `webhook_events`; processing posts `premium_written`, `tax_and_fee_billed`, `premium_collected`, `commission_earned` keyed by the operation; policy bound only after the webhook; reconciliation diffs PaymentIntents against the ledger. Gaps: F-01, F-02, F-08, F-11.
- Endorsement with pro-rata delta: broker requests a limit change from an effective date; delta priced over remaining days; above $500 the customer approves against a quote hash and policy version; positive delta collected by a second Checkout operation; negative delta path undefined. Gaps: F-05.
- Cancellation with real refund and clawback: broker or staff cancels; `earned_to_date` then `refund_requested` posted at the cancellation effective date; refund above $1,000 waits for a distinct human approver; `stripe_refund` operation against the original PaymentIntent(s); `refund.*` webhooks post `refund_completed` and `commission_clawback`. Gaps: F-02, F-12, F-17, F-18.
- Backdated correction: staff posts `correction_reversal` (mirrored lines, `reverses_entry_id`, original effective date) and `correction_rebook` at the corrected date; `recorded_at` is the booking time; originals untouched. Gaps: F-07 (published statement), F-15.
- Claim reserve and payout with maker-checker: staff_ops opens the claim, sets and adjusts the reserve as events; payment above $1,000 queued as `approval_request`; staff_approver (not the requester, not an agent) decides; execution re-checks hash and approval, inserts `claim_payout` operation on the simulator; settlement and return are later events. Gaps: F-06, F-10, F-21.
- Broker statement: staff or broker runs the month; `statement_runs` stores the figures and a content hash derived from journal lines filtered by broker and period. Gaps: F-07.
- Reconciliation with a planted break: cron or "Run now" with `CRON_SECRET`; Stripe records diffed against operations and journal; breaks with age. Gaps: F-03, F-13.
- MCP write tool: agent with a per-user API key calls `request_claim_payment`; the tool inserts an `approval_request` with `requested_by` = key owner; no approval tool exists; approval is a human session action. Gaps: F-10 (must be stated that the approve route never accepts an API key and that API keys are agent principals).

## 5. Findings

### HIGH

**F-01 Webhook retry after a processing failure is acknowledged without processing.** Trigger: event inserted and committed, processing fails, Stripe retries; the retry hits the unique key and the design returns 200 ("duplicate key means already received"). If instead the insert and the processing share one transaction, the failure rolls the event back and the `webhook_processing` error row has nothing to reference. Consequence: a real money event is never journaled and the provider stops retrying; only the daily reconciliation could notice. Concurrent duplicate deliveries also have no lease, so two workers can both enter processing. Location: section 5. Required correction: (1) commit the immutable event first in its own transaction; (2) take a lease with `UPDATE webhook_processing SET status = 'processing', attempts = attempts + 1 WHERE webhook_event_id = $1 AND status IN ('pending', 'failed') RETURNING *` and process only when a row comes back; (3) on a duplicate delivery, run the same lease step, so a not-yet-done event is processed by the retry and a done event returns 200; (4) return 500 only while processing is not done; (5) treat a unique violation on journal posting as "already posted", not as an error; (6) add the failed-events view with an authorized replay action required by AGENTS.md, and let `/api/jobs/recover-operations` also re-process stale `processing` or `failed` rows.

**F-02 Journal uniqueness keyed on the webhook event double-posts one financial effect described by two events.** Trigger: the design subscribes to `checkout.session.completed` and `payment_intent.succeeded` (both mean "collected") and to `refund.created`, `refund.updated` and `charge.refunded` (all describe the same refund). Section 2 allows `source_id` to be "the webhook event", so each event posts `premium_collected` or `refund_completed` once, twice in total. Consequence: cash and receivable overstated, commission earned twice. Location: sections 2, 4, 5. Required correction: money entries caused by provider events are keyed by (`source_kind = 'money_operation'`, `source_id` = operation id, `entry_type`); state which event and status posts each entry (for example `checkout.session.completed` with `payment_status = 'paid'` posts collection, `payment_intent.succeeded` is stored and used only if no posting exists; `refund_completed` posts when the refund object status is `succeeded` regardless of which event carried it); define `refund.failed`: `money_operation_events` gets `failed`, `refund_payable` stays open, staff re-issues with a new operation and the failure is visible. Verify the refund status transitions at B2 on docs.stripe.com (not verified in this review).

**F-03 Reconciliation has no provider-truth source for the claim payout rail, so the live-fire "planted payout mismatch" cannot be detected.** Trigger: section 7 pulls Stripe objects only; claim payouts live on the `LOCAL SIMULATOR`. If the panel plants a payout mismatch (a payout on the rail that the ledger does not show, or a different amount), nothing is compared. Consequence: a stated live-fire item fails, and PLAN.md's coverage claim for B10 is not backed by the design. Location: sections 4 and 7. Required correction: the simulator keeps its own provider-side record (for example `simulated_rail_transfers`, written only by the simulator code path, never by ledger code) that the same reconciliation job treats as provider truth and diffs by reference, amount, currency and status; a labeled staff action or seed fixture can plant a break on the provider side without touching the ledger; also cover Stripe BalanceTransactions of type payout in case the panel means Stripe payouts. Keep the ledger comparison primary and operation records secondary, as AGENTS.md requires.

### MEDIUM

**F-04 The shared worked example counts the term wrong.** March 1, 2028 to March 1, 2029 is 365 days (February 29, 2028 falls before the term starts). Checked with a date calculation. With 365 days: earned 120000 x 100 / 365 = 32876 floored, refund 87124, tax refund ceil(87124 x 3%) = 2614, total refund 89738. The example's figures (366, 32786, 87214, 2617, 89831) are correct only for a term that contains February 29, 2028, for example written January 1, 2028. Location: ARCHITECTURE.md section 3, DECISIONS.md 08:04 entry, PLAN.md B1. Consequence: the test fixture would encode a wrong expectation and Yoann would explain wrong numbers in the debrief. Correction: either change the example start date to January 1, 2028 (keeps every figure) or recompute the figures for 365 days; record the fix as a superseding decision entry, not a rewrite. Needs Yoann because the example is his recorded decision.

**F-05 Earning window per written segment is undefined.** `earnedCents(writtenCents, termStart, termEnd, asOf)` takes one amount over the full term, but an endorsement delta booked at day 100 earns over the remaining 266 days from its effective date, not over the full term. Correction: represent each `premium_written` entry as a segment (`writtenCents`, `earnFrom`, `earnTo`) and earn per segment with floor per segment, then sum; give one worked example with an endorsement. Also define the negative delta: immediate Stripe refund (a money-out, subject to the threshold) or a customer credit account; the chart has no credit account today.

**F-06 The chart of accounts cannot book claims double-entry.** A reserve needs a debit side (incurred loss expense) and a payout needs a cash account other than `cash_stripe`; neither exists. Correction: add `claims_incurred_expense` (debit) and `cash_claims_bank` (debit, simulated in v0), and specify the entries with one example: reserve set Dr claims_incurred_expense / Cr claim_reserve; payment sent Dr claims_paid / Cr claims_payable and Dr claim_reserve / Cr claims_incurred_expense for the same amount, so incurred = claims_paid + claim_reserve as ledger balances; settlement Dr claims_payable / Cr cash_claims_bank; return reverses the settlement and leaves `claims_payable` open for re-issue.

**F-07 Closed-month reproducibility versus corrected month is not defined.** The gauntlet requires both "closed-month rerun identical forever" and "correction three weeks ago, month reconciled". As-of by `effective_at` alone changes a closed month after a re-book. Correction: `statement_runs` records the period (by `effective_at`) and a knowledge cutoff (`recorded_at <= closed_at`); a rerun uses both and is therefore identical; a correction touching a closed month creates a new statement revision row linked to the previous one (or a prior-period adjustment line in the open month). Yoann must choose the representation; AGENTS.md requires the definition before B8 and B9.

**F-08 Sandbox verification exists only for Stripe webhooks.** AF-04 requires validation before every provider side effect, on jobs, seed, MCP and webhooks, and fail-closed when the mode cannot be established. Correction: at startup or before the first Stripe side effect, retrieve the account or balance and require `livemode === false` (the `sk_test_` prefix is supportive evidence only); for the KYB provider, establish the documented sandbox mechanism at B3 and process only webhooks whose entity id was created by this application; apply the same guard to the job endpoints and the seed. Note: DECISIONS.md (08:28:41Z, recorded while this review was being written) states that Sumsub KYB is unavailable on the trial plan and Middesk is next; the design's section 4 still describes Sumsub and must be updated to the provider actually used, with that provider's sandbox marker and webhook signature scheme verified from its documentation.

**F-09 Seed and test databases are not addressed.** AF-03 bans TRUNCATE, table replacement and reset scripts on financial history. Correction: the seed-from-zero script refuses to run when any protected table has rows; tests use a fresh database or Neon branch; no foreign key into a protected table uses ON DELETE CASCADE; `app_runtime` is never granted TRUNCATE; state this in the design and prove it with the B1 negative test.

**F-10 The human-approver check has no stated location and API-key principals are not distinguished.** Correction: a trigger on `approval_decisions` insert checks that `decided_by` differs from `requested_by`, that the user's role is `staff_approver` and that the principal is human; MCP API keys are agent principals and the approve route accepts session cookies only; one decision per request (unique `request_id`); execution inserts the `money_operation` and re-checks the hash in the same transaction, relying on the unique `approval_request_id` for at-most-once.

**F-11 "Look the intent up at the provider by idempotency key" is not a Stripe capability.** Correction per operation kind: `stripe_checkout`, re-send the identical create request with the same key (Stripe returns the original response within the key retention window, to verify at B2) or find the session through the operation id in metadata; `stripe_refund`, list refunds for the PaymentIntent and match the operation id in metadata; after the retention window, mark `unknown` and surface to staff. Put the operation id in `payment_intent_data.metadata` and refund `metadata` so every Stripe object is traceable to the operation.

**F-12 Refund allocation across several payments is undefined.** After an endorsement there are two PaymentIntents and a refund cannot exceed one charge. Correction: allocate the refund to payments newest first up to each payment's refundable remainder, one `money_operation` per Stripe refund, the sum tied to the single `refund_requested` entry; state the rule and give one example.

**F-13 Stripe fees are an external money event exposed by BalanceTransactions but are not journaled.** The design keeps `cash_stripe` gross; the reconciliation would then show every fee as a difference and the displayed Stripe cash never equals Stripe's balance. Correction (recommended, small): post `stripe_fee` (Dr `stripe_fee_expense` / Cr `cash_stripe`) from the charge's balance transaction when collection is posted; otherwise compare gross amounts only, label fees as excluded in the run summary and disclose the limitation in README.

**F-17 Commission rounding is undecided and the design text contradicts itself.** Section 3 says "ceiled in the broker's favor: 13082.1 becomes 13082, floor". The clawback in the broker's favor is a floor; commission earned on a non-round collected amount (endorsement delta 21803 x 15% = 3270.45) has no rule either. Needs Yoann: one rule for both directions, consistent with "the penny goes against the insurer" (earned ceiled, clawback floored) or another explicit choice.

### LOW

**F-14** Protected-table list in section 1 omits `reconciliation_runs`, `reconciliation_breaks` (called immutable in section 7) and `accounts`. Use one `protect_table(name)` helper in the migration and one visible list.

**F-15** `recorded_at` "set by the database, never by the client" needs enforcement: a BEFORE INSERT trigger forcing `now()`, or a column-level INSERT grant that excludes the column.

**F-16** Journal integrity details: unique `reverses_entry_id` (one reversal per entry), the deferred check must also reject a header with zero lines, amounts strictly positive, `account_id` must exist.

**F-18** Cancel with an open claim: state the rule (cancellation never changes a reserve; the loss date must fall inside coverage; refund and clawback computed as usual) so the live-fire explanation has a written basis.

**F-19** Readability: a `post_journal_entry(header, lines[])` SQL function taking composite arrays is harder to explain than a small TypeScript function inserting the header and its lines in one transaction with the database constraints as the guard; choose the simpler one. Add a two-line worked example for the policy fold and for the `effective_at` versus `recorded_at` filters in the code comments.

**F-20** Webhook events referencing an unknown operation id (other test activity on the same Stripe account) should be stored and flagged, never posted. Accept exactly one webhook secret per environment.

**F-21** "Cannot pay past the limit" with concurrent payments needs serialization per claim (row lock on the `claims` identity row inside the payment transaction).

## 6. Arithmetic checked

Issuance example: 120000 + 6100 = 126100 collected; commission 15% of 120000 = 18000, tax and fee excluded. Cancellation refund lines 87214 + 2617 = 89831, balanced. Clawback 87214 x 15% = 13082.1 (rounding undecided, F-17). Day counts: 2028-03-01 to 2029-03-01 = 365; 2028-02-29 to 2029-02-28 = 365; 2028-01-01 to 2029-01-01 = 366 (F-04).

## 7. AF-01 to AF-06 mapping for this scope

| Rule | Design control | Status now |
|---|---|---|
| AF-01 deployed URL | Vercel deployment, `/api/health` returns revision; STATUS records a 200 from the dev machine for revision 1e40dc7 | NOT RUN by this reviewer (no product behaviour yet; final check at delivery) |
| AF-02 no simulation presented as live | `provider = 'simulator'`, README inventory planned in B6 | NOT RUN (design only) |
| AF-03 no UPDATE or DELETE on money rows | Trigger plus `app_runtime` role, corrections by reversal and re-book | Design PASS with F-09, F-14, F-15; implementation NOT RUN (no migration exists) |
| AF-04 sandbox only | `livemode` check on Stripe events, `.env.example` test placeholders | Design gap F-08; key values NOT inspected (`.env.local` not read) |
| AF-05 no committed secrets | gitleaks 8.30.1 installed, `core.hooksPath = .githooks`, pre-commit runs `gitleaks protect --staged --redact` | Executed: `gitleaks git --redact` over 8 commits, no leaks found (working tree file `docs/ARCHITECTURE.md` contains no secret). Push-time scan NOT RUN |
| AF-06 explainable code | Small chart, pure functions with examples, one posting path | Walkthrough status: NOT REVIEWED WITH YOANN (nothing implemented) |

## 8. Checks executed and not executed

Executed: full reads listed in section 1; `git rev-parse HEAD`, `git status`, `shasum -a 256 docs/ARCHITECTURE.md`; date arithmetic for the worked example (Python `datetime`); integer-cent recomputation of the issuance and cancellation examples for 365 and 366 days; `git config core.hooksPath`; `gitleaks version`; `gitleaks git --redact --no-banner --no-color .` (no leaks). Not executed: no tests exist; no provider documentation fetched (timebox), so Stripe idempotency retention, refund status transitions and the Sumsub sandbox marker remain to be verified at B2 and B3; no legal source consulted, none needed for this scope beyond the tax rate flagged in section 2.

## 9. Final verdict and residual limitations

**DESIGN FAIL** for `docs/ARCHITECTURE.md` at SHA-256 `419345fa...2de67`. The ledger core, correction lineage, approval binding and outbox intent are sound; the failures are three material gaps (F-01 webhook retry and lease, F-02 event keying, F-03 payout reconciliation source) plus decisions Yoann must take (F-04, F-07, F-17) and definitions the design must add (F-05, F-06, F-08 to F-13). All corrections are document-level and small; a re-review of the corrected document can be short.

Slice impact: B0 and B1 may proceed now, taking F-04, F-06 (chart additions), F-09, F-14, F-15 and F-16 into account; B2 waits for F-01, F-02, F-08, F-11; B4 for F-05; B5 for F-02, F-12, F-17; B7 for F-06, F-10, F-21; B8 and B9 for F-07; B10 for F-03, F-13; B11 for F-10. This is a scoped engineering assessment of a design, not a legal certification, and a later DESIGN PASS will not mean anything is implemented or compliant.

Needs Yoann's decision: F-04 (example date or figures), F-07 (statement revision representation), F-17 (commission rounding), F-05 negative delta handling (refund now or customer credit), and the modeled state and tax rate from an official source.

## 10. Re-review of the revised design (2026-09-08T10:06:00Z)

- Revision: HEAD `32a521b1f3731b4cd94a871faa0c6548f968ddf1`, working tree clean. `docs/ARCHITECTURE.md` SHA-256 `e7acaee177a83f76c23fbb3c9a9535eb2d4779709da217a9266429b821fdc7b1` (revised 08:50Z and 10:05Z).
- Read for this re-review: the revised `docs/ARCHITECTURE.md` in full; `docs/DECISIONS.md` entries 08:28Z to 10:02Z; `docs/reviews/b1-ledger-core.md` (verdict, matrix, findings F-B1-01 to F-B1-15, re-review section); `db/migrations/0001_ledger_core_and_webhook_inbox.sql` and `0003_seal_journal_entries_and_truncate_guards.sql`; `app/api/webhooks/stripe/route.ts`; `lib/stripe.ts`; `lib/money/dates.ts`, `lib/money/premium.ts`, `lib/money/premium.test.ts`; `.env.example` by keyword. `.env.local` not opened. No provider documentation fetched; items marked "verify at B2/B3/B5" stay unverified here.
- Checks executed: recited example recomputed with Python integers (tax floor(120000 x 235 / 10000) = 2820; charge 125320; day 100 of 365: earned 32876, unearned 87124; tax refund ceil(87124 x 235 / 10000) = 2048; total 89172; commission 18000; clawback floor(87124 x 15%) = 13068), all equal to the design, DECISIONS.md and the tests; March 1, 2028 plus 100 days is June 9, 2028 as stated; `gitleaks git --redact` over 28 commits, no leaks. Not executed: the B1 guard and seal scripts (executed and recorded by the B1 reviewer at 8f253a7; not re-run here).

### Disposition of the initial findings

| Finding | Disposition | Where |
|---|---|---|
| F-01 webhook retry, lease, replay | Resolved. Event committed first with a `pending` row, duplicate continues to the lease, single UPDATE lease, 500 while not done, failed and ignored events view with audited replay | section 5; route implements it (see R-03) |
| F-02 entries keyed on the webhook event | Resolved. `source_kind = money_operation`, one posting status per entry type, unique violation treated as success | section 2 (see R-01 for the refund-failed sentence and R-08 for the PaymentIntent link) |
| F-03 payout rail not reconciled | Resolved. `simulator_provider_records` written only by the simulator, diffed by the same job, protected table; Stripe payouts included | sections 4 and 7 |
| F-04 example day count | Resolved. Recited example March 1, 2028, 365 days, figures correct; 366-day table labeled illustrative and internally consistent | section 3, DECISIONS 09:20Z and 09:29Z, tests |
| F-05 earning window, negative delta | Resolved. Segments with their own window; negative delta refunded at once through Stripe (Yoann, 09:57Z) | section 3 (see R-06) |
| F-06 claim accounts | Resolved. `incurred_loss_expense`, `cash_claims_rail`, worked claim example, incurred = paid + reserve holds on the example | section 2 (see R-04) |
| F-07 closed-month revisions | Resolved. `knowledge_cutoff` on `statement_runs`, revision 2 references revision 1 (Yoann, 10:02Z) | section 3 |
| F-08 sandbox guards | Resolved in design (prefix plus `GET /v1/account` at every entry point, DB check `livemode = false` in 0003). Implementation of the account call is still due in B2 (B1 review F-B1-06) | section 4 |
| F-09 seed and test databases | Resolved. Seed refuses a non-empty protected table, fresh database per test run, no cascade, TRUNCATE trigger in 0003 | section 1 |
| F-10 approver check location | Resolved. Trigger on `approval_decisions` (not requester, role, human principal, first decision), approve route cookie-only | section 6 |
| F-11 Stripe recovery per kind | Resolved as design; the `client_reference_id` listing and the key retention window are to verify at B2 | section 4 |
| F-12 refund allocation | Resolved. Newest collection first, one operation per PaymentIntent, allocation stored | section 4 |
| F-13 Stripe fees | Accepted with disclosure. Fees excluded by the reconciliation classifier with a reason, README states gross cash at Stripe | sections 4 and 7 |
| F-14 protected list | Resolved. 16 tables listed including `accounts`, reconciliation tables and simulator records; 0001 protects the four that exist | section 1 |
| F-15 server-set `recorded_at` | Resolved by trigger in 0001 (see R-05 on the wording) | section 1 |
| F-16 journal integrity | Resolved. Unique `reverses_entry_id`, no-lines check, both in 0001; entries sealed at commit by 0003 | section 2 |
| F-17 clawback rounding | Resolved. Rounded down (Yoann, 09:57Z); table text no longer contradicts itself | section 3 |
| F-18 cancel with open claim | Resolved. Written rule | section 3 |
| F-19 readability | Resolved. TypeScript `postJournalEntry`, no composite SQL types | section 2 |
| F-20 unknown events, one secret | Resolved. Stored and marked `ignored` with reason; one secret per environment | section 5 |
| F-21 per-claim lock | Resolved. Payment refused inside a transaction locking the claim row | section 2 |

### New findings on the revised text

**R-01 (MEDIUM) `refund.failed` must not reverse the customer's refund liability.** Section 2 says `refund_failed` "reverses `refund_requested` and reopens the receivable". After a failed Stripe refund the customer is still owed the money and the policy is still cancelled; reversing `refund_requested` would restore `unearned_premium` and `premium_tax_payable` on a cancelled policy and make the ledger say nothing is owed. Correction: on `refund.failed` post no journal entry; record `failed` on the operation; `refund_payable` stays open and shows up in the non-zero clearing list of section 1 with its age; staff re-issue a new `stripe_refund` operation for the same liability. Verify at B5 whether Stripe can fail a refund after reporting `succeeded`; only in that case reverse `refund_completed` (cash came back), never `refund_requested`. To be corrected in the document before B5 starts and checked in the B5 feature review.

**R-02 (LOW) KYB paragraph reads as both decided and conditional.** Section 4 opens with the decision (Stripe Connect Accounts v2, test mode) and closes with "If the last resort is Stripe Connect business verification", and the sandbox-marker example cites a Persona key prefix. Rewrite as settled, keep the disclosure sentence unconditional. Add for B3: Accounts v2 events may be delivered as v2 thin events through an event destination, which need the SDK's thin-event parsing and a fetch of the related object rather than `constructEvent`; verify on docs.stripe.com at B3. The inbox key (`provider`, `provider_event_id`) still applies.

**R-03 (LOW) Section 5 lease wording versus the implemented route.** The route also re-leases a `processing` row older than five minutes (a function that died mid-way); the design does not mention it. Document the expiry and why it is safe (a Vercel function cannot run five minutes). The route today marks `done` in a separate statement after processing; section 5 requires posting and completion in one transaction, so B2 must move the status update into the posting transaction (B1 review F-B1-12).

**R-04 (LOW) Chart table versus migration and example.** Section 2 still lists `claims_paid`, which migration 0001 does not seed and the claim example does not use (B1 review F-B1-09): remove it or define its use. The claim example leaves `cash_claims_rail` with a credit balance (net paid out) because no funding or capital account exists; either state that reading or add an `opening_capital` account with a seed funding entry.

**R-05 (LOW) Section 1 overstates the `recorded_at` control.** It promises a column grant that excludes `recorded_at`; 0001 grants table-wide INSERT and relies on the BEFORE INSERT trigger, which is sufficient. Align the wording with what exists.

**R-06 (LOW) Negative endorsement delta details.** State that the immediate refund also returns the tax on the returned premium (ceiled, consistent with "tax follows the premium" and the California base "less return premiums" recorded at 09:29Z), that it follows the newest-collection-first allocation, and how a negative segment rounds inside the earned sum (round the reduction up in absolute value so the insurer eats the fraction). Cap the refunded tax at the tax charged for the policy (B1 review F-B1-07).

**R-07 (LOW) Stale comments and placeholders outside the design.** `lib/money/premium.test.ts` still says the clawback rounding is open; add the 13068 assertion in B5. `.env.example` still describes Sumsub and Middesk as the KYB provider (B1 review F-B1-15); B6.

**R-08 (LOW) Link between `payment_intent.succeeded` and the operation.** Collection posts on `payment_intent.succeeded`, but the operation id is carried by the Checkout Session (`client_reference_id`). Set `payment_intent_data.metadata.operation_id` at session creation so the PaymentIntent event resolves the operation directly; otherwise the handler must call `checkout.sessions.list({ payment_intent })`. Say which in section 4. Whether the sessions list endpoint filters by `client_reference_id` is to verify at B2; if it does not, recovery is the same-key re-issue plus metadata.

### AF-01 to AF-06 at this revision

AF-01: production `/api/health` reported by the B1 reviewer at 2b15397; not re-checked here, NOT RUN. AF-02: design labels every simulator and discloses that both live slots run on Stripe; README inventory still due in B6, NOT RUN. AF-03: triggers, role, seal and TRUNCATE guards implemented in 0001 and 0003 with negative checks recorded PASS by the B1 review at 8f253a7; design PASS. AF-04: `sk_test_` prefix, route refusal and DB check `livemode = false`; outbound account check due in B2; key values not inspected. AF-05: gitleaks history scan at 32a521b, 28 commits, no leaks; pre-commit hook active. AF-06: walkthrough status NOT REVIEWED WITH YOANN.

### Verdict

**DESIGN PASS** for `docs/ARCHITECTURE.md` at SHA-256 `e7acaee1...dc7b1`, permitting implementation of B1 to B12, with one scoped exclusion: the `refund_failed` sentence in section 2 (R-01) is not approved as written and must be corrected before B5 starts; the B5 feature review must confirm it. The LOW items R-02 to R-08 are documentation alignments and B2, B3, B5 and B6 implementation notes; none blocks implementation. This verdict does not mean anything beyond slice B1 is implemented or compliant, and it is not a legal certification. Residual limitations: Stripe idempotency retention, the sessions list filter, the refund status transitions and the Accounts v2 event delivery shape remain to be verified against docs.stripe.com at B2, B3 and B5; the California tax rule is applied as this build's rule with its official sources recorded, not as a legal claim.
