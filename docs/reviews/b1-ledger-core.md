# Implementation review: slice B1 (ledger core, webhook inbox, premium arithmetic)

- Scope: slice B1 as defined in `docs/PLAN.md`, B1a (migration `db/migrations/0001_ledger_core_and_webhook_inbox.sql`, runtime role and `scripts/set-runtime-role-password.ts`, guard checks `scripts/check-ledger-guards.ts`, `db/client.ts`, `lib/stripe.ts`, `app/api/webhooks/stripe/route.ts`) and B1b (`lib/money/dates.ts`, `lib/money/premium.ts`, `lib/money/*.test.ts`). Business handlers for payments, policies, approvals and reconciliation are later slices and are not judged here; anything in this slice that would make them unsafe is flagged.
- Reviewer: independent reviewer sub-agent (implementation review, no implementation, no delegation; only this file was written).
- Timestamp: 2026-09-08T09:35:00Z (review started 09:18:29Z).
- Revision reviewed: `2b1539706554e60b1459a3333ed1ba24506642da` (branch `main`, equal to `origin/main`). The assignment named HEAD `5f0dba4`; while the review was running the coordinator pushed three commits (`29312ca` docs and a 15th test, `ffbcd8e` test naming, `2b15397` gitignore). The code diff between `5f0dba4` and `2b15397` touches only `lib/money/premium.test.ts` (one test added, one renamed) and `.gitignore`; every other file in scope is identical at `3c9ef3a`/`ea5085d` and at `2b15397`. `git status` at the end of the review: clean, no unstaged or staged changes. Production `/api/health` reports revision `2b15397`.
- Verdict: **FAIL** (one HIGH finding, F-B1-01, correctable with one small migration and one negative test; everything else in the declared scope passes). See section 9.

## 1. Startup receipt

Read in full: `AUTOMATIC-FAILS.md`, `AGENTS.md`, `WORKFLOW-48H.md`, `REVIEWER.md`, `READABLE-CODE.md`, `docs/BRIEF-REFERENCE.md` (general and Track 1 sections in full; Track 2 and 3 skimmed), `docs/DECISIONS.md` (including the 09:20:05Z entry added during this review), `docs/PLAN.md` (B1, B2 and the coverage map; the file changed on disk during the review and was re-read), `docs/ARCHITECTURE.md`, `docs/reviews/architecture.md`, `docs/STATUS.md`, `docs/COMPLIANCE-MATRIX.md`. Code read line by line: the migration, both scripts, `scripts/migrate.ts`, `db/client.ts`, `lib/stripe.ts`, the webhook route, `app/api/health/route.ts`, `lib/money/dates.ts`, `lib/money/premium.ts`, both test files, `package.json`, `.env.example`, `.gitignore`, `.githooks/pre-commit`, `next.config.ts`, `tsconfig.json` paths. Not read: `.env.local` (exists; deliberately never opened or printed; the project scripts and two reviewer scripts loaded it through `process.loadEnvFile` and printed only role names, trigger names, grants and counts), `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `GAP-REVIEW.md`, `READINESS-BACKLOG.json` (advisory, not needed for this scope). Absent files: none of the mandatory kit files is missing. `README.md` was searched by keyword only (no mention of `app_runtime`, `DATABASE_URL_APP` or the webhook endpoint yet). No external legal source was consulted: this slice has no legal applicability question beyond the modeled state's tax rate, which is still pending an official source (DECISIONS.md) and is not used by any code yet.

## 2. Applicability and assumptions

Confirmed from the brief extraction and the decisions: US only, USD integer cents, own append-only double-entry ledger with as-of balances, Stripe test mode as the live premium-collection slot, verified webhooks with idempotency. Money rules used by the code are Yoann's recorded decisions (DECISIONS.md 08:04:03Z and 09:20:05Z): insurer eats the rounding penny (charges floored, refunds ceiled), term ends on the same calendar date next year or February 28, real day count, tax refunded pro-rata with premium, flat fee never refunded, commission on collected premium floored. Assumptions still open and correctly labeled open: commission clawback rounding (design review F-17), negative endorsement delta handling (F-05), closed-month revision rule (F-07), the modeled state and its rate. None of them is exercised by B1 code. No FinCEN, OFAC or CFPB duty is asserted for this scope.

## 3. Requirement matrix

| Requirement | Control and location | Evidence (this review) | Verdict |
|---|---|---|---|
| Balanced double-entry, atomic posting (NN-2, NN-9, PLAN B1) | `journal_lines` check one positive side; deferred constraint triggers `journal_entry_must_balance` (AFTER INSERT on lines) and `journal_entry_must_have_lines` (AFTER INSERT on headers), one function `check_journal_entry_balances`; migration lines 90 to 148 | Catalog listing shows both triggers, deferrable; guard checks 3 and 4 refuse an unbalanced entry and an entry without lines; lines cannot precede their header because the foreign key is immediate | PASS |
| Append-only: no UPDATE or DELETE on protected tables (AF-03) | `forbid_change_of_financial_record` BEFORE UPDATE OR DELETE on `accounts`, `journal_entries`, `journal_lines`, `webhook_events`; role `app_runtime` with SELECT and INSERT only, UPDATE only on `webhook_processing`, no DELETE anywhere, no TRUNCATE | Catalog: four append-only triggers present; grants exactly as designed; guard checks 1, 2, 6 pass; runtime DELETE on `webhook_processing` also refused | PASS for UPDATE and DELETE; see F-B1-01 (lines appended to a booked entry) and F-B1-03 (owner TRUNCATE) |
| Original entries preserved; history rewritten only by linked reversal (AF-03, NN-5) | `reverses_entry_id` unique, foreign keys without cascade, unique (`source_kind`, `source_id`, `entry_type`) | Read; but a runtime INSERT of balanced lines into an existing entry is accepted (probe: 4 lines on a complete entry, rolled back) | **FAIL** (F-B1-01) |
| `recorded_at` set by the database, never by the client (design section 1, F-15) | `set_recorded_at_from_database_clock` BEFORE INSERT on `journal_entries` | Guard check 5: client value 2000-01-01 replaced by the server clock. `webhook_events.received_at` has no such trigger (probe stored 2000-01-01) | PASS for the journal; LOW F-B1-04 for the inbox |
| Runtime role, sequences, default privileges | `grant usage, select on sequence journal_lines_id_seq`; no `ALTER DEFAULT PRIVILEGES` by the project | Sequence grant present; the two `pg_default_acl` rows belong to Neon (`cloud_admin` to `neon_superuser`), none touches `app_runtime`; runtime connection logs in as `app_runtime`, superuser off | PASS |
| No secret in migration or scripts; password from the environment (AF-05) | Role created `NOLOGIN` in the migration; `set-runtime-role-password.ts` reads `APP_RUNTIME_DB_PASSWORD`, quotes the literal, prints nothing sensitive | Read; gitleaks history scan of 16 commits: no leaks; `core.hooksPath` points at `.githooks`; pre-commit runs `gitleaks protect --staged --redact` | PASS |
| Webhook: signature on the raw body, live-mode refused, stored once, lease, 500 on failure, no 200 before durable storage, unknown types stored and marked ignored (NN-4, design section 5, F-01, F-20) | `route.ts`: `request.text()` then `stripe.webhooks.constructEvent`; `event.livemode` refused with 400 before storage; `storeEventOnce` with `ON CONFLICT DO NOTHING` and winner re-read inside one transaction with the `pending` row; `takeProcessingLease` single UPDATE limited to `pending`, `failed`, or `processing` older than five minutes; `processStripeEvent` outcome or `failed` + 500 | Production: no signature 400, bad signature 400, health 200 at the reviewed revision; database: three stored events all `ignored` with reason, including the real delivery `evt_3UDL2q...`; lease SQL exercised in rolled-back transactions: `pending` and `failed` leased, `done` and `ignored` not, `processing` aged 6 minutes leased, aged 4 minutes not; concurrent duplicate reasoning in section 5 | PASS (LOW F-B1-11, F-B1-12, F-B1-13) |
| Sandbox only (AF-04) | `lib/stripe.ts` refuses a key not starting with `sk_test_` at module load; route refuses `livemode: true` | Read; STATUS reports the production live-mode test returning 400 (not re-executed here: it needs the signing secret). Table accepts `livemode = true` (probe) | PASS for this slice; LOW F-B1-05, F-B1-06 |
| Pure arithmetic: integer cents, penny rule, term with real days, delta from the effective date, taxes and fee separated (NN-9, Track 1 gauntlet) | `lib/money/dates.ts`, `lib/money/premium.ts`: bigint arithmetic, `floorDiv` and `ceilDiv`, clamped elapsed days, `termEnd` clamps February 29 | 15 tests pass; every figure recomputed by hand in section 6 and matches; edge cases in F-B1-07 and F-B1-08 | PASS |
| Readable for a line-by-line debrief (AF-06, READABLE-CODE.md) | Small files, names with units, business comments with examples | Assessment in section 7 | PASS as an assessment; walkthrough status NOT REVIEWED WITH YOANN |

## 4. Migration read line by line (what was verified)

- Guard functions (lines 12 to 27): the raise carries `tg_op` and `tg_table_name`, errcode `insufficient_privilege`, so an owner-side violation reads like a permission error. `set_recorded_at_from_database_clock` overwrites whatever the client sent.
- `accounts` (33 to 58): append-only trigger, 15 accounts seeded. The design table in ARCHITECTURE.md section 2 lists 16, `claims_paid` being absent here; the design's own claim examples never use it (F-B1-09).
- `journal_entries` (64 to 88): `recorded_at` default plus trigger; `reverses_entry_id` unique and a self foreign key without cascade; unique (`source_kind`, `source_id`, `entry_type`) implements the event-keying fix of design finding F-02; `effective_at` is a date, `recorded_at` a timestamptz, as decided.
- `journal_lines` (90 to 105): `bigserial`, foreign keys to entries and accounts without cascade, non-negative amounts, exactly one positive side, append-only trigger.
- Balance check (107 to 148): one function reads the entry id from either table, sums lines, refuses zero lines or unequal totals; both constraint triggers are `DEFERRABLE INITIALLY DEFERRED`. Ordering cannot bypass it: lines before their header fail on the immediate foreign key; a header alone fails at commit; lines added later to an existing entry are checked too, and that is the problem (F-B1-01): the check accepts any balanced set of lines, so balanced additions to an old entry pass.
- Webhook inbox (154 to 178): immutable `webhook_events` unique per provider event, append-only trigger; mutable `webhook_processing` with a status check that includes `ignored`, foreign key without cascade.
- Role (184 to 195): `app_runtime` created `NOLOGIN` if absent; grants exactly SELECT and INSERT on the four protected tables, SELECT, INSERT, UPDATE on `webhook_processing`, USAGE and SELECT on the one sequence. No TRUNCATE, no DELETE, no default privileges, no column-level exclusion of `recorded_at` (the trigger alone enforces it, which is sufficient).
- Nothing in the migration or in the two scripts performs an UPDATE or DELETE on a money row. The guard script attempts one UPDATE and one DELETE as the owner on rows it created in the same transaction, expects the trigger to refuse them, and rolls back; that is the negative test AF-03 asks for.

## 5. Webhook route: concurrency and failure reasoning

Two deliveries of one event: both `SELECT` nothing, both `INSERT ... ON CONFLICT DO NOTHING`; the loser blocks on the unique index until the winner commits (event and `pending` row together), then inserts nothing and re-reads the winner's id. Both then run the lease `UPDATE`; row-level locking lets exactly one row-update succeed, the other sees `processing` with a fresh `updated_at` and gets no lease. A lease holder that throws marks `failed` and answers 500, so Stripe retries; the retry finds the row `failed` and leases it. A lease holder whose function dies leaves `processing`; after five minutes any delivery or replay can lease it again. No code path answers 200 before `storeEventOnce` has committed; a database error there propagates to a 500. These paths were verified by reading and by the rolled-back lease probes; the concurrent production replay (four deliveries, two rows) is reported in STATUS and was not re-executed here because signing a request needs the webhook secret.

## 6. Arithmetic checked by hand (Python integers, independent of the tests)

- 2028-03-01 to 2029-03-01: 365 days; day 100 is 2028-06-09. Earned 120000 x 100 / 365 = 32876 floored; unearned 87124; tax refund ceil(87124 x 300 / 10000) = 2614; total 89738. Endorsement +60000 on day 100: 265 days remain, 60000 x 265 / 365 = 43561 floored; backdated to 2028-05-10: 295 days, 48493; lowered: ceil gives 43562. Commission 18000. All match the 09:20:05Z decision and test 15.
- 2028-01-01 to 2029-01-01: 366 days; day 100 is 2028-04-10. Earned 32786, unearned 87214, tax refund 2617, total 89831; endorsement 43606, backdated 48524, lowered 43607. All match tests 6, 10, 11, 13.
- 2028-02-29 to 2029-02-28: 365 days; 2027-06-15 to 2028-06-15: 366 days. Match tests 2 and 3.
- Edge found: written 100001 at 3 percent: tax charged floor = 3000, tax refunded on a day-0 cancellation ceil = 3001, one cent more than collected (F-B1-07).

## 7. Readability assessment (READABLE-CODE.md)

Reading path for the ledger: migration top to bottom, then `check-ledger-guards.ts`, each check one paragraph. Reading path for the inbox: the six-step comment at the top of the route, then the three functions in order. Reading path for money: `dates.ts` then `premium.ts`, each function with its rule, its decision reference and a numeric example. Names carry units (`writtenPremiumCents`, `taxRateBps`, `CalendarDate`). Side effects at import time (`db/client.ts`, `lib/stripe.ts` throwing on a missing or live key) are explicit and commented. Two idioms need one sentence each at the debrief: the balance function serving two tables through `tg_table_name`, and the `RollbackSentinel` used to force a rollback in the guard script. Missing comments worth adding: the day convention (coverage counted from the term start inclusive to the as-of date exclusive, so "cancelled on day 100" earns 100 days), and, in `db/client.ts`, why a fallback to the owner exists at all (F-B1-02 recommends removing it). No opaque formula, no hidden side effect, no ambiguous unit was found. Walkthrough status: NOT REVIEWED WITH YOANN (no evidence of a walkthrough exists; a reviewer cannot certify his understanding).

## 8. Findings

### HIGH

**F-B1-01 A booked journal entry can be changed after the fact by inserting more lines into it.** Trigger: any transaction running as `app_runtime` inserts a balanced pair of lines (or any balanced set) with the `entry_id` of an entry committed earlier; the only INSERT-time trigger on `journal_lines` is the deferred balance check, which accepts it. Evidence: rolled-back probe as `app_runtime`: header plus two lines, balance check forced and passed, two more balanced lines inserted, `count(*) = 4`, no error; catalog listing of triggers on `journal_lines` shows nothing that ties a line to its header's transaction. Consequence: the content of a historical entry changes without any UPDATE or DELETE, without a reversal entry, without lineage, and without a recording time (lines carry none; the header keeps its original `recorded_at`), so the knowledge-time view (ARCHITECTURE.md section 2, "what was known on date K") and a closed statement reproduced by `recorded_at` cutoff (B8, B9) can change silently, and mirrored lines would net an entry to zero while looking like the original booking. This is the "rewrite financial history as a workaround" class that AF-03 bans; no application code does it today, so it is a bypass path, not an observed violation. Location: `db/migrations/0001_ledger_core_and_webhook_inbox.sql` lines 90 to 148. Required correction, as a new migration 0002 (0001 is applied on the trial database and must not be edited): a `BEFORE INSERT` row trigger on `journal_lines` that raises unless the header was recorded in the current transaction, for example `if (select recorded_at from journal_entries where id = new.entry_id) <> now() then raise exception 'lines can only be added in the transaction that books their entry'` (`now()` is the transaction start time and the header trigger sets `recorded_at := now()` in that same transaction, so equality holds only inside the posting transaction; one comment explains this). Prove it with a negative test that commits an entry and then tries to add lines in a second transaction; that test needs a disposable database (Neon branch or local Postgres, as ARCHITECTURE.md section 1 already promises), because committing probe entries into the trial ledger is not acceptable.

### MEDIUM

**F-B1-02 The application silently falls back to the owner connection.** Trigger: `DATABASE_URL_APP` missing in any environment (a preview deployment, a fresh machine, a Vercel environment edited by hand). Evidence: `db/client.ts` line 7, `process.env.DATABASE_URL_APP ?? process.env.DATABASE_URL`; `.env.example` still advises leaving the two equal "until that migration has run". Consequence: the role boundary AF-03 requires disappears with no signal; the append-only triggers still stop UPDATE and DELETE, but the owner can TRUNCATE and disable triggers. Verified locally that the runtime URL logs in as `app_runtime`; the Vercel production value was not inspected by this review (STATUS asserts it). Correction: require `DATABASE_URL_APP` at runtime (keep the build-phase exception), fail closed with a clear message, and update `.env.example`. Optional: have `/api/health` return `current_user` so the deployed role is visible from outside without exposing anything sensitive.

**F-B1-03 No TRUNCATE guard on the owner path.** Trigger: any owner-connected script (migrations, the B6 seed, a manual repair) runs `TRUNCATE` on a protected table. Evidence: `has_table_privilege` is true for the owner on `journal_entries`, `journal_lines`, `webhook_events`; no `BEFORE TRUNCATE` trigger exists (catalog). `app_runtime` is proven to lack TRUNCATE (guard check). Consequence: AF-03 names TRUNCATE explicitly and binds privileged maintenance scripts to the same rule; today only discipline protects the owner path. Correction in migration 0002: `create trigger <table>_no_truncate before truncate on <table> for each statement execute function forbid_change_of_financial_record()` on the four protected tables (the message already prints `tg_op`), and a negative test on the disposable database used for F-B1-01.

### LOW

**F-B1-04** `webhook_events.received_at` is client-settable (probe stored 2000-01-01); ARCHITECTURE.md section 1 promises server-set recording times. Add the same `BEFORE INSERT` clock trigger in 0002.

**F-B1-05** The table accepts `livemode = true` (probe); only the route refuses live events. A `check (livemode = false)` constraint makes AF-04 hold at the database for every future writer (replay action, jobs, MCP). Cheap, explainable, recommended in 0002.

**F-B1-06** The startup `GET /v1/account` with `livemode === false` promised in ARCHITECTURE.md section 4 (design finding F-08) is not implemented; only the `sk_test_` prefix is checked. Nothing in this slice makes an outbound Stripe call, so nothing is violated; B2 must add the check before the first Checkout Session is created. Note that restricted keys (`rk_test_`) would be refused by the prefix check, which fails closed and is acceptable.

**F-B1-07** `refundedTaxCents` can return one cent more than the tax collected (written 100001 at 3 percent, cancelled on day 0: charged 3000, refund 3001), which would leave `premium_tax_payable` one cent negative for that policy. B5 should cap the refunded tax at the tax actually charged for the policy while keeping the ceiling otherwise; a test with this example should accompany it.

**F-B1-08** Input bounds and conventions: rates in basis points are not bounded to 0..10000; `assertCents` uses `Number.isInteger` where `Number.isSafeInteger` states the real limit; an endorsement `effectiveAt` before `termStart` silently yields the full annual difference (callers must reject a pre-inception date; no test covers it); the elapsed-day convention deserves a one-line comment (section 7). None changes the tested figures.

**F-B1-09** Chart of accounts: `claims_paid` is in the ARCHITECTURE.md section 2 table but not in the migration, and the design's own claim entries do not use it. Reconcile the document at B7 or insert the account then (INSERT on `accounts` is granted, so nothing blocks).

**F-B1-10** The UPDATE grant on `webhook_processing` is table-wide; restrict it to (`status`, `attempts`, `last_error`, `updated_at`) so the runtime cannot re-point a processing row at another event.

**F-B1-11** A concurrent duplicate that arrives while the lease holder is in flight is answered 200. If that holder then dies, Stripe holds a 2xx for the event and does not redeliver; the row becomes leasable after five minutes but only a staff replay or the recovery job (design finding F-01, item 6, due in B2) picks it up. Acceptable for B1; the failed and stuck events view and job must land in B2 and be documented.

**F-B1-12** For B2: the route sets `done` in a separate autocommit UPDATE after `processStripeEvent` returns. The design requires posting and completion in one transaction; if B2 keeps the current shape, a crash between posting and marking done relies on the unique (`source_kind`, `source_id`, `entry_type`) constraint to make the re-lease idempotent. Either move the status update into the posting transaction or write down that reliance explicitly.

**F-B1-13** Two synthetic events with fabricated ids (`evt_replaytest_*`, type `payment_intent.succeeded`, signed with the real endpoint secret) live permanently in the production inbox, marked `ignored`. They are not money rows and cannot be removed, which is correct; they must be disclosed in the evidence pack, and B2's handler must ignore events that match no local money operation (design finding F-20) so a replay can never post them.

**F-B1-14** Guard checks run on the trial database rather than a disposable one (ARCHITECTURE.md section 1 says fresh database per run). Every check rolls back and the committed ledger holds zero journal rows, so nothing was polluted; the commit-time path is exercised through `set constraints all immediate`, which runs the same function. Fine for these checks; F-B1-01 and F-B1-03 need a disposable database.

**F-B1-15** Documentation: `README.md` does not yet mention `DATABASE_URL_APP`, the role password script, `check:ledger-guards` or the webhook endpoint setup; `.env.example` still describes Sumsub and Middesk as the KYB provider although DECISIONS.md (08:54:29Z) moved the slot to Stripe Connect. B6 material, listed so it is not forgotten.

## 9. AF-01 to AF-06 for this scope

| Rule | Control | Status |
|---|---|---|
| AF-01 deployed URL | Vercel production; `/api/health` from outside: HTTP 200, database ok, revision `2b15397`; webhook route from outside: 400 without signature, 400 with a bad signature | NOT RUN as a final-delivery check (no product behaviour, no credentials yet); supportive evidence recorded |
| AF-02 no simulation presented as live | Inbox stores real Stripe test-mode deliveries (`evt_3UDL2q...` present, `signature_verified = true`, `livemode = false`); no integration inventory exists yet | NOT RUN (B6) |
| AF-03 no UPDATE or DELETE on money rows | Triggers and role as described; no script performs a mutation; negative checks refused and rolled back | PASS for UPDATE and DELETE at the database boundary; FAIL for the append bypass (F-B1-01); owner TRUNCATE unguarded (F-B1-03) |
| AF-04 sandbox only | `sk_test_` prefix at load, `livemode` refused by the route, stored events all `livemode = false` | PASS for the Stripe paths in this slice; no outbound side effect exists yet (F-B1-06); key values never inspected |
| AF-05 no committed secrets | Migration creates the role `NOLOGIN`; password from `APP_RUNTIME_DB_PASSWORD`; `.env.example` placeholders only; gitleaks 8.30.1 history scan of 16 commits: no leaks; pre-commit hook active | PASS (this revision) |
| AF-06 explainable code | Readability assessment PASS (section 7) | Walkthrough NOT REVIEWED WITH YOANN |

## 10. Checks executed

- `git status` (clean), `git rev-parse HEAD`, `git log`, `git fetch origin`, `git diff 5f0dba4..2b15397`.
- `npm run typecheck`: exit 0, no output from `tsc --noEmit`.
- `npm test`: `node --import tsx --test lib/**/*.test.ts`, 15 tests, 15 pass, 0 fail (dates: 5, premium: 10 including "the recited example: March 1, 2028 policy, 365 days, cancelled on day 100 (June 9)").
- `npm run check:ledger-guards` on the Neon trial database, 10/10 PASS, exit 0. Excerpt:
  ```
  PASS  owner cannot UPDATE journal_entries  (financial records are append-only: UPDATE on journal_entries is not allowed (correct with a reversal entry))
  PASS  owner cannot DELETE journal_lines  (financial records are append-only: DELETE on journal_lines is not allowed (correct with a reversal entry))
  PASS  unbalanced entry is refused  (journal entry ... does not balance: debits 100 <> credits 99)
  PASS  entry without lines is refused  (journal entry ... has no lines)
  PASS  recorded_at ignores the client value  (stored 2026-09-08T09:23:55.684Z instead of 2000-01-01)
  PASS  app_runtime lacks UPDATE on journal_entries  (permission denied for table journal_entries)
  PASS  app_runtime lacks DELETE on webhook_events  (permission denied for table webhook_events)
  PASS  app_runtime lacks TRUNCATE on journal_lines  (permission denied for table journal_lines)
  PASS  app_runtime can INSERT a balanced entry  (inserted then rolled back)
  PASS  committed journal balances globally  (debits 0 = credits 0)
  ```
- Reviewer evidence scripts (scratchpad, not committed; catalog reads and rolled-back probes, no secret printed). Excerpt:
  ```
  runtime connection logs in as: app_runtime (superuser=off)
  trigger journal_lines.journal_entry_must_balance: AFTER INSERT ROW deferrable
  trigger journal_lines.journal_lines_are_append_only: BEFORE DELETE|UPDATE ROW
  grant app_runtime on journal_lines: INSERT, SELECT
  grant app_runtime on webhook_processing: INSERT, SELECT, UPDATE
  default acl: role=cloud_admin schema=public objtype=r acl={neon_superuser=a*r*w*d*D*x*t*m*/cloud_admin}
  owner may TRUNCATE journal_entries=true journal_lines=true webhook_events=true
  runtime DELETE on webhook_processing: refused (permission denied for table webhook_processing)
  runtime added two balanced lines to a complete entry: lines=4 error=none (rolled back)
  runtime inserted webhook_events with client received_at 2000-01-01: stored 2000-01-01T00:00:00.000Z (rolled back)
  runtime inserted webhook_events with livemode=true: ALLOWED (rolled back)
  lease on a 'processing' row aged 6 minutes: leased (attempts now 2) (rolled back)
  lease on a 'processing' row aged 4 minutes: no lease (rolled back)
  lease on a 'pending' row: leased / 'failed': leased / 'done': no lease / 'ignored': no lease (rolled back)
  committed rows: journal_entries=0 journal_lines=0 webhook_events=3 webhook_processing=3
  ```
- `gitleaks git --redact --no-banner --no-color .`: 16 commits scanned, no leaks found; `git config core.hooksPath` = `.githooks`.
- `curl https://corgi-work-trial-iota.vercel.app/api/health`: 200, revision `2b15397`; `POST /api/webhooks/stripe` without header: 400 "missing stripe-signature header"; with `t=1,v1=deadbeef`: 400 "invalid signature".
- Python integer recomputation of every worked example (section 6).

Not executed: the concurrent duplicate delivery and the live-mode event against production (both need the webhook signing secret, never read); inspection of the Vercel environment values (role identity in production rests on STATUS); no Stripe documentation fetched (the `sk_test_` prefix and `constructEvent` behaviour are well known and the design review already asked B2 to verify idempotency retention and refund transitions).

## 11. Final verdict and residual limitations

**FAIL** for slice B1 at `2b1539706554e60b1459a3333ed1ba24506642da`, on F-B1-01 alone. Everything the acceptance criteria name is implemented and proven: balanced entries enforced at commit, UPDATE and DELETE refused for every role on every protected table of this slice, runtime role without mutation or TRUNCATE privileges, server-set booking time, immutable inbox with an atomic lease that expires after five minutes, signature verification on the raw body with live mode refused, and pure integer-cent arithmetic whose every figure was recomputed by hand. The failing item is a bypass of the append-only guarantee through INSERT, which the ledger core exists to prevent; the correction is one trigger in a migration 0002 plus a negative test on a disposable database, and F-B1-02 to F-B1-05 fit in the same migration and the same short session. B2 may proceed in parallel: none of its planned code depends on the missing trigger, and the posting function it introduces already inserts header and lines in one transaction.

Needs Yoann's decision: none for the corrections above (they are technical and follow his recorded rules). Still open from earlier reviews and unchanged by this one: commission clawback rounding (F-17), negative endorsement delta (F-05), closed-month revision rule (F-07), the modeled state and tax rate from an official source. He should also be told that two synthetic `evt_replaytest_*` events sit permanently in the production inbox (F-B1-13) and that the recited example in DECISIONS.md is now the March 1, 2028 policy with 365 days (09:20:05Z entry), which the tests carry.

Residual limitations: production role identity not inspected by this reviewer; concurrent-delivery evidence taken from STATUS; this is a scoped engineering assessment of a slice, not a legal certification and not a statement that the six delivery gates pass.

## 12. Addendum: commit 8bb9063 pushed while this record was being written

At 2026-09-08T09:38:00Z `main` moved to `8bb9063` ("docs: California 2.35 percent premium tax decided, with official sources; test it"). Diff against the reviewed `2b15397`: `docs/DECISIONS.md` (+8, the 09:29:25Z decision naming California at 235 basis points with the constitutional source) and `lib/money/premium.test.ts` (+12, one test). No other in-scope file changed, so every finding and verdict above stands for `8bb9063` as well. The new test was re-run and its figures recomputed by hand: `npm test` 16/16 pass; 120000 x 235 / 10000 = 2820 floored; 87124 x 235 / 10000 = 2047.41, ceiled 2048; total 87124 + 2048 = 89172, matching the test and the decision entry. The rate itself is Yoann's decision from a cited official source; this review checks the arithmetic, not the tax law, and the interpretation recorded in DECISIONS.md (insurer-owed tax shown as a separate customer line) stays labeled as an interpretation. F-B1-07 applies to this rate too: written 100001 at 2.35 percent would charge 2350 and refund 2351 on a day-0 cancellation.

## 13. Re-review after the fix commit

- Timestamp: 2026-09-08T09:40:00Z. Revision: HEAD `8f253a76fe260a72c7791fa6225956fdeccb09a8` (branch `main`, tree clean); fix commit `a94f091` ("fix: seal journal entries at commit, truncate guards, fail-closed runtime connection"); the two commits after it (`5b25f3c`, `8f253a7`) touch only `docs/`. Production `/api/health`: 200, revision `8f253a7`.
- Files examined: `db/migrations/0003_seal_journal_entries_and_truncate_guards.sql` line by line, `db/client.ts` diff, `scripts/check-ledger-seal.ts` line by line, `package.json` diff, `docs/reviews/FINDINGS.md`, `.env.example`. `.env.local` not read; the project scripts and one reviewer probe script loaded it and printed only role names, trigger names, constraint definitions, migration file names and counts.

### Checks executed

- `npm run typecheck`: exit 0.
- `npm test`: 16 tests, 16 pass, 0 fail.
- `npm run check:ledger-guards` on the trial database: 10/10 PASS, exit 0, every check rolled back, committed journal still 0 debits = 0 credits.
- `npm run check:ledger-seal` on `corgi_test`: 4/4 PASS, exit 0. Excerpt:
  ```
  PASS  committed entry refuses new lines in a later transaction  (journal entry ... is sealed: lines can only be added in t; lines still 2)
  PASS  owner cannot TRUNCATE journal_lines  (financial records are append-only: TRUNCATE on journal_lines is not allowed)
  PASS  live-mode webhook event is refused by the database  (new row for relation "webhook_events" violates check constraint "webhook_events_are_test_m)
  PASS  header and lines in one transaction still post  (committed)
  ```
- Reviewer probes (scratchpad script, not committed). Trial database, catalog reads and rolled-back transactions only; `corgi_test` for attempts on a committed entry. Excerpt:
  ```
  schema_migrations (trial): 0001..., 0002_policies_and_money_operations.sql, 0003_seal..., 0004_truncate_guards_for_policy_and_money_tables.sql
  trigger journal_lines.journal_lines_only_in_creating_transaction: BEFORE INSERT ROW
  trigger accounts/journal_entries/journal_lines/webhook_events ..._never_truncated: BEFORE TRUNCATE STATEMENT
  trigger webhook_events.webhook_events_received_at_is_server_set: BEFORE INSERT ROW
  check webhook_events_are_test_mode_only: CHECK ((livemode = false))
  header, 1.2 s pause, lines in one transaction: accepted
  posting with time zone Asia/Tokyo set locally: accepted
  line for a missing header: journal entry ... does not exist
  app_runtime ALTER TABLE ... DISABLE TRIGGER: must be owner of table journal_lines
  app_runtime SET session_replication_role = replica: permission denied to set parameter
  owner SET session_replication_role = replica: permission denied to set parameter
  trial owner connection: role neondb_owner, superuser=off
  webhook_events with client received_at 2000-01-01: stored 2026-09-08T09:37:11.297Z (rolled back)
  corgi_test: append as app_runtime: ... is sealed; append as owner: ... is sealed; append after SET LOCAL knobs: ... is sealed
  max_prepared_transactions: 0; lines on the sealed entry before/after probes: 2/2
  owner TRUNCATE webhook_events on corgi_test: cannot truncate a table referenced in a foreign key constraint
  ```

### Inspection of migration 0003 for bypasses

The seal compares the header's `recorded_at` with `now()`. In Postgres `now()` is `transaction_timestamp()`: fixed at transaction start, identical for every statement of the transaction, unaffected by `statement_timestamp()`, `clock_timestamp()`, `pg_sleep`, savepoints, `SET LOCAL time zone` (timestamptz equality is absolute) or any user-settable parameter; no GUC changes what `now()` returns, and neither role can set `session_replication_role` (a superuser-only parameter, and the Neon owner `neondb_owner` is not a superuser). The 0001 trigger sets the header's `recorded_at` from the same `now()`, so equality holds only inside the creating transaction; a later transaction has a strictly later start time. Two transactions starting in the same microsecond on different connections is the only theoretical collision, and it could only add lines to an entry booked in that same microsecond. A missing header is refused by the seal before the foreign key. `max_prepared_transactions = 0`, so two-phase commit cannot hold a transaction open across sessions. The TRUNCATE triggers are statement-level and fire for cascaded truncations as well; a plain `TRUNCATE webhook_events` fails earlier on the foreign key from `webhook_processing`, and `TRUNCATE ... CASCADE` hits the trigger. What remains is inherent to table ownership: the owner can `DROP TRIGGER` or `ALTER TABLE ... DISABLE TRIGGER`; the application never connects as owner (now fail-closed), migrations are committed and reviewed, and no DDL of that kind exists in the repository. Infrastructure-level restores (Neon branch or point-in-time restore) are outside the database guards and remain a disclosed limitation.

The seal check script refuses any URL whose database name is not `corgi_test`, so it cannot target the trial ledger; it commits `seal_check` entries there on every run, which is the purpose of a disposable database. The two checks that would be destructive if a guard were missing (TRUNCATE, live-mode insert) also run only there.

### Findings status

| ID | Status | Basis |
|---|---|---|
| F-B1-01 | RESOLVED at `a94f091` | Seal trigger present on the trial database and `corgi_test`; committed-entry negative test 4/4 PASS; append refused as runtime and as owner; lines 2/2 |
| F-B1-02 | RESOLVED at `a94f091` | `db/client.ts` throws without `DATABASE_URL_APP` (build phase excepted); production health 200 at `8f253a7` proves the variable is set there |
| F-B1-03 | RESOLVED at `a94f091` | BEFORE TRUNCATE statement triggers on the four protected tables; owner TRUNCATE refused on `corgi_test` |
| F-B1-04 | RESOLVED | `received_at` overwritten by the database clock (probe) |
| F-B1-05 | RESOLVED | CHECK `livemode = false` present; live-mode insert refused |
| F-B1-14 | RESOLVED | Disposable `corgi_test` database exists and is the only target of committing checks |
| F-B1-06 | OPEN (B2) | Startup Stripe account `livemode` check still to be added before the first outbound call; FINDINGS.md says the same under F-08 |
| F-B1-07, F-B1-08, F-B1-09, F-B1-11, F-B1-12, F-B1-13 | OPEN, tracked in B5, B4, B7, B2, B2, B6 | Unchanged; FINDINGS.md tracks them under the grouped line F-B1-L |
| F-B1-10 | OPEN, not in FINDINGS.md | Table-wide UPDATE grant on `webhook_processing`; cheap column-level grant, add to the register |
| F-B1-15 | OPEN, one line now misleading | `.env.example` line 8 still says to leave `DATABASE_URL_APP` equal to `DATABASE_URL` until migration 0001 has run; with the fail-closed client that advice would make the app connect as the owner. Replace it, and add `DATABASE_URL_TEST` and `DATABASE_URL_TEST_APP` placeholders for `check:ledger-seal`. README gaps remain for B6 |

FINDINGS.md statuses agree with this table for F-B1-01, F-B1-02, F-B1-03 and the grouped LOW line; F-B1-10 is missing from it.

### Observation outside this scope

Both databases record migrations `0002_policies_and_money_operations.sql` and `0004_truncate_guards_for_policy_and_money_tables.sql`, neither of which is on `main` at `8f253a7` (the working tree holds 0001 and 0003 only). They belong to slice B2 and were not reviewed here. The trial schema is therefore ahead of the repository; the B2 review must cover them, and no push or handoff should describe the database as reproducible from `main` until they are committed.

### New verdict

**PASS** for slice B1 (B1a + B1b) at `8f253a7`, fix code at `a94f091`. The HIGH and both MEDIUM findings are corrected and independently re-verified with committed-row negative tests on a disposable database and rolled-back probes on the trial database; the remaining items are LOW, tracked to named slices, plus the one-line `.env.example` correction above. Walkthrough status unchanged: NOT REVIEWED WITH YOANN. This remains a scoped engineering assessment, not a legal certification and not a statement that the six delivery gates pass.
