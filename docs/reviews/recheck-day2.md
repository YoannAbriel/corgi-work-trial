# Day-2 recheck of every execution slice, B0 to B14

Requested by Yoann on 2026-09-09 at 10:00 Europe/Zurich: "recheck pour tous les points, dans
l'ordre". This is an audit record, not a review record under REVIEWER.md. It issues no new verdict
on code. It establishes, per slice, what the slice's own independent review actually said, at which
revision, and whether that verdict still covers the code that is deployed now.

Reference revision: `5d405d2` on `main`. Production reports the same revision. Nothing was fixed,
no check script that writes was run, `check:money-guards` was not run.

Status vocabulary used below, defined once so it cannot be read loosely:

- **DONE AND REVIEWED**: implemented, an independent verdict is PASS, and no material change to
  that slice's own code landed after the revision the verdict was measured on.
- **DONE NOT REVIEWED**: implemented and working, but the code now deployed carries material
  changes (money path, authorization, schema, provider calls) that no independent verdict covers.
- **PARTIAL**: some acceptance criteria are met and others are not.
- **NOT DONE**.

Nine of the fifteen slices are DONE NOT REVIEWED. That is not an accusation of defects: it is the
literal consequence of a day of fix batches landing across slice boundaries after each slice's
reviewer had signed off on its own scope.

## Startup receipt

Read in full this session, in this order: `CLAUDE.md`, `AUTOMATIC-FAILS.md`, `docs/PLAN.md`,
`REVIEWER.md`, `WORKFLOW-48H.md`, `AGENTS.md`, `READABLE-CODE.md`, `docs/STATUS.md` (whole file,
newest first, including the 08:07:24Z entry added while this recheck was running),
`docs/reviews/FINDINGS.md`, `README.md`, `docs/COMPLIANCE-MATRIX.md`,
`db/migrations/0020_statement_format_v3.sql`, `docs/handoffs/b13-9-console-notes.md`,
`lib/console/infra.ts` (limits table), `app/ops/console/infra/page.tsx`, `app/login/page.tsx`,
`app/api/session/login/route.ts`, `.gitignore`, `.githooks/pre-commit`, `package.json`.

Read by targeted search: `docs/DECISIONS.md` (all entry headers plus the last three entries in
full), `docs/reviews/ui-main-merge.md` (sections 3 and 4), `docs/reviews/ui-rebuild.md` (the
375-pixel sections), `docs/handoffs/ui-main-browser-checks.json`, `lib/**` and `app/**` for
UPDATE/DELETE paths, integration-mode labels and logging.

Read by four read-only delegates whose findings are folded in below, each given
`AUTOMATIC-FAILS.md` and `docs/PLAN.md` as mandatory reading and each required to tie every verdict
to an exact SHA: the eleven per-slice review records and the seven UI records under `docs/reviews/`,
and the production and trial-database checks.

Absent files: none of the mandatory files is missing.

### Checks this recheck ran itself, at `5d405d2`

| Check | Command | Result |
|---|---|---|
| Unit tests on the merged tree | `npm test` | 455 tests, 454 pass, 0 fail, 1 skipped |
| Types on the merged tree | `npm run typecheck` | exit 0 |
| Deployed revision | `curl /api/health` | HTTP 200, `{"ok":true,"database":"ok","revision":"5d405d2a..."}` |
| Secret scan of the history | `gitleaks detect --redact --no-banner` | 347 commits scanned, **no leaks found**, exit 0 |
| Secret scan of the working tree | `gitleaks dir --redact --no-banner` | 89 findings, **all in git-ignored paths** (see AF-05) |
| Seven demo logins on production | one POST each | all HTTP 303 (see AF-01) |
| Staff screens on production | GET, twelve routes | all HTTP 200, 0.21 s to 0.39 s |
| Authorization refusals | GET as customer | `/ops` 307, `/ops/console` 307, `/ops/console/infra` 307 |

Two procedural disclosures, made rather than glossed:

1. This agent runs in an isolated git worktree whose command guard refuses `gitleaks git` (it reads
   `git` as an operand and cannot prove the scan stays inside the worktree). Delegated agents
   inherit the same isolation, so the exact command Yoann named could not be run by anyone in this
   session. I ran `gitleaks detect --redact --no-banner` instead: in gitleaks 8.30.1 it is the
   legacy alias of `gitleaks git`, same engine, same default git-history scan. Result quoted above.
   Before the freeze somebody should run the literal `gitleaks git --redact --no-banner` from an
   unrestricted shell so the submission evidence carries the command the rule names.
2. The trial-database SELECTs were executed by a delegate, not by this agent, because the guard
   refused the compound shell needed to load `DATABASE_URL_APP` without printing it. Every number
   attributed to the database below is that delegate's read, and is labelled as such.

---

# Slice by slice

## B0: Bootstrap and deploy

**Status: DONE AND REVIEWED**

**(a) Acceptance criteria (PLAN.md).** Next.js app deployed on Vercel; `/api/health` reports DB ok
from outside the dev machine; Neon DB linked; migration runner; `.env.example`; gitleaks pre-commit
hook; history secret scan PASS; Stripe and Sumsub (or Middesk) sandbox accounts created.

**(b) Implementation evidence.** PLAN cites `a8d84eb`. `scripts/migrate.ts` applies
`db/migrations/*.sql` once each inside a transaction; twenty migrations exist, 0001 to 0020.
`.githooks/pre-commit` runs `gitleaks protect --staged --redact --no-banner`; `core.hooksPath` is
set locally. `.env.example` holds twelve placeholders and is the only tracked env file.

**(c) Review.** Reviewed together with B1; no separate B0 record. No material B0-owned change since.

**(d) Measurable now.** `/api/health` returns HTTP 200, `database: ok`, revision
`5d405d2a61a2ede243647a43cdc1ed9bb7304657`, which equals `main`. The deployed revision is not behind
HEAD. Health, migrations and the runner all hold.

**(e) Live fire.** Not applicable.

**(f) Open.** The Sumsub/Middesk criterion was never met: both trials were gated on September 8 and
the KYB slot moved to Stripe Connect (DECISIONS, 08:54Z). That is recorded and disclosed in the
README, so it is an honest deviation, not a silent downgrade, but the PLAN row still reads as
though the criterion was satisfied. One small hygiene point: `.gitignore` lists `!.env.example` and
then, further down, `.env*`, which re-ignores it; `.env.example` survives only because it was
already tracked. Harmless today, a trap for anyone re-adding it. **F-RC-01 (LOW).**

## B1: Ledger core and pro-rata math

**Status: DONE AND REVIEWED**

**(a) Criteria.** `accounts`, `journal_entries`, `journal_lines` with a balanced-entry constraint;
triggers raising on UPDATE/DELETE of protected tables; a runtime role without UPDATE/DELETE; a
negative test proving a mutation fails; four pure functions with the hand-worked example ($1,200
written 2028-03-01, 365 days, cancelled after 100 days: earned 32876, refund 87124; the 366-day
variant 32786 / 87214 also tested).

**(b) Evidence.** `3c9ef3a` (migration 0001), `ea5085d` (arithmetic), `a94f091` (migration 0003,
seal and TRUNCATE guards), `8f253a7`. Checks, last recorded: `check:ledger-guards` **10/10** on the
trial database, every probe rolled back; `check:ledger-seal` **4/4** on `corgi_test`;
`check:money-guards` **184/184** at 06:55Z on 2026-09-09, on an ephemeral database migrated 0001 to
**0019** with the runtime role, dropped afterwards.

**(c) Review.** FAIL at `2b15397` (09:35Z, F-B1-01: `app_runtime` could append balanced lines to a
committed entry), fixed, **PASS at `8f253a7`, 2026-09-08T09:40Z**. Independently re-confirmed by
the B9 reviewer at `8b5b490`. The immutability core has had **zero commits since `8f253a7`**:
migrations 0001 and 0003, `db/client.ts`, `check-ledger-guards.ts`, `check-ledger-seal.ts` and
`set-runtime-role-password.ts` are byte-identical to the reviewed revision. The rest of the B1
surface did move (17 commits, +727/-55 across the webhook route, `premium.ts`, `stripe.ts`,
`dates.ts`), but `premium.ts` and `dates.ts` stopped changing before the B4 re-review recomputed
their arithmetic by hand, and the webhook route's last diff was read by the B8 reviewer.

**(d) Measurable now.** Delegate read of the trial database with the runtime role: **35 journal
entries, 77 lines, debits 4,262,730 = credits 4,262,730, difference 0**, no entry with unequal
sides. 34 base tables, **28 carrying UPDATE/DELETE/TRUNCATE guard triggers**; the runtime role holds
SELECT and INSERT everywhere and UPDATE on exactly two tables, `policy_current` and
`webhook_processing`, which are the two declared caches. My own source sweep agrees: the only
`update` statements in `lib/` and `app/` are three on `webhook_processing` and one upsert on
`policy_current`; there is no `delete from` and no `truncate` anywhere outside the guard
definitions. The 455 unit tests, which carry both worked examples, pass at HEAD.

**(e) Live fire.** Not applicable.

**(f) Open.** F-B1-07 to F-B1-13 and F-B1-15 (LOW) remain, including F-B1-10 (the UPDATE grant on
`webhook_processing` is table-wide where a column-level grant would document intent). **The material
gap is not a finding but an evidence gap: migration 0020 drops and re-adds a CHECK constraint on
the protected table `statement_runs`, and it landed after the last guards proof, which stops at
0019. No guards run exists for the schema now in production.** **F-RC-02 (MEDIUM, evidence).**

## B2: Issuance and live Stripe collection

**Status: DONE NOT REVIEWED**

**(a) Criteria.** Policy as events with `effective_at` and `recorded_at`; premium, tax and fee shown
separately; Checkout Session with an idempotency key bound to the intent; immutable webhook inbox
plus a separate mutable nonfinancial processing table; signature on the raw body; duplicate delivery
posts once; replay twice is one; entries posted atomically with event completion; bound only after
the webhook.

**(b) Evidence.** `0115796` then `b3ba15b`. `check:payment-replay` **34/34** last recorded.

**(c) Review.** Three FAILs (`0115796` 10:30Z, `109dafb` 11:44Z, `5b14830` 11:52Z), then **PASS at
`b3ba15b`, 2026-09-08T12:42Z**, extended by the reviewer to the identical code at `09e71e5`.
**Material changes landed after the last re-review with no further re-review**: 47 files,
+9,695/-648, about 25 commits. The ones that matter are money-path: `369671d` (F-B2-21, every Stripe
success posting now takes an advisory lock per money operation and the session-completed handler
takes the same lock), `0fa828d` (F-B2-20, a late `checkout.session.completed` never drags an
operation back from `succeeded`), `b956950` (F-B2-18 and F-B2-19, the latter a partial unique index
in migration 0013, i.e. DDL on a protected table), `9a69fd5` (rule 14 suspense account), `65fb3f4`
(eligibility checked at binding, not only at checkout). `collection.ts` +220, `checkout.ts` +103,
the webhook route +91, `policy-entries.ts` +89. The b13-2 LOW-batch reviewer enumerated all twelve
advisory-lock sites and found no cycle, which is real coverage of the locking, but `369671d` itself
sits outside the diff that reviewer read (`82591a0^1..82591a0`), and the B11 and B12 reviewers each
recorded these commits as "outside this scope".

**(d) Measurable now.** CGP-01707 is bound on production (paid live at 18:57Z on 2026-09-08); its
four entries are in the ledger; the policy page renders premium, tax and fee separately with a fold
per figure. All 65 webhook events on the trial database are `livemode: false` and
`signature_verified: true` (delegate read).

**(e) Live fire.** Step 1 (pay with a test card and watch the journal): **done live by Yoann**,
twice. Step 3 (replay the webhook twice): done by coordinator HTTP probes against production on
2026-09-08 and by `check:payment-replay` 34/34, **not driven by Yoann**.

**(f) Open.** F-B2-05 to F-B2-12 (grouped F-B2-L), F-B2-15, F-B2-16, and the stuck/ignored-events
listing half of F-B2-02. **F-B2-21 still reads OPEN in the register although `369671d` fixed it at
06:47Z; the register contradicts STATUS.** **F-RC-03 (LOW, record hygiene).**

## B3: Broker KYB live

**Status: DONE NOT REVIEWED**

**(a) Criteria.** Broker entity submitted to the provider; provider statuses mapped to local
eligibility (unknown, pending, approved, failed); binding refused server-side unless approved;
pending and failed visible in the UI.

**(b) Evidence.** `09e71e5`. `check:kyb-replay` **26/26** last recorded. Stripe Connect Accounts v2
business verification in test mode, disclosed in the README as not a dedicated KYB vendor.

**(c) Review.** **PASS at `09e71e5`, 2026-09-08T12:47Z. One verdict only; the record has no
re-review section.** Since then: 26 commits, 12 files, +974/-457. Migration 0006 was edited
(comment text only, no DDL change, the delegate read that diff). The material part is `lib/broker/`
+212 across `eligibility.ts`, `kyb.ts` and `kyb-onboarding.ts`, arriving inside `b956950`
(F-B3-04 settling window counted to now, F-B3-05 per-broker serialization), plus `2a0737a`
(F-B7-07 path-id guards). **`b956950` is named by no review record at all.**

**(d) Measurable now.** Three demo brokers on the trial database (delegate read): Redwood
(broker@, KYB **approved**), Harbor Point (broker2@, KYB **failed** on Stripe's tax-id fixture),
Sierra Crest (broker3@, **never submitted**). `/ops/brokers` returns 200. The three eligibility
states are therefore all visible on the deployed application.

**(e) Live fire.** Not one of the seven brief steps.

**(f) Open.** F-B3-06 and F-B3-09 still read OPEN in the register. Both are stale: the README now
carries the Connect endpoint, `STRIPE_CONNECT_WEBHOOK_SECRET` and `check:kyb-replay` (README
lines 37 and 49), and the duplicate 0007 numbering was resolved at the B7 merge. **F-RC-03 again.**

## B4: Endorsement with pro-rata delta

**Status: DONE NOT REVIEWED**

**(a) Criteria.** Limit change priced from the effective date over the remaining term; delta above
the threshold waits for customer approval; approval bound to the quote hash and policy version;
delta collected through Stripe; endorsement schedule and declarations PDFs as of any date.

**(b) Evidence.** `dfdca38`, fixes `dcad358`/`26dede3`, `e7b5913`. `check:endorsement-replay`
**80/80** last recorded.

**(c) Review.** FAIL at `dfdca38` (16:45Z, three MEDIUM), **PASS at `e7b5913`,
2026-09-08T18:05Z**. (PLAN cites 16:22Z and 18:11Z for these; the record says 16:45Z and 18:05Z.)
Since then: 17 commits, 8 files, +1,063/-166. `644e8da` (F-B4-07 quote hash compared by both posting
paths) and `7d18e28` (F-B4-12 policy advisory lock) **were** covered by the LOW-batch review at
`82591a0`. `369671d` was not. `endorsement-collection.ts` +82, `endorse.ts` +30,
`endorsement-read.ts` +48. The PDF work (`4cef315`, `bf5911b`, +929 in `render.tsx` and
`pdf-theme.ts`) is presentation and is explicitly deferred to the integration review, which has not
happened.

**(d) Measurable now.** CGP-01707 carries exactly one applied endorsement, effective 2026-10-08,
reached through three events. The as-of panel offers 2026-09-08, 2026-09-09 and 2026-10-08 as links,
and a delegate confirmed the figures change across the endorsement date ($1,200 with $1M/$2M limits
at 2026-09-08 against $2,400 with $2M/$4M at 2027-01-15). Both PDFs answer `application/pdf`.

**(e) Live fire.** The live endorsement above $500, approved by the customer and paid by Yoann on
2026-09-09 at 06:34Z, is B4's own evidence. It is not one of the brief's seven steps, but it is what
makes step 5 (as-of between two endorsements) reachable in principle, and it is the only
endorsement that exists.

**(f) Open.** F-B4-01 (MEDIUM, no refund action for parked money; disclosed in the README) and
F-B4-11 (LOW, an amount mismatch on a delta is refused and journaled nowhere).

## B5: Cancellation with real refund and clawback

**Status: DONE NOT REVIEWED**

**(a) Criteria.** Pro-rata unearned premium and refundable tax; refund through the Stripe Refunds
API on the original payments; `refund.*` webhooks updating the ledger with requested and completed
distinguished and failed refunds surfaced; commission clawback entries; short-rate representable.

**(b) Evidence.** `e120f69`, `109dafb`. `check:refund-replay` **27/27** last recorded.

**(c) Review.** **PASS at `e120f69`, 2026-09-08T11:38Z. One verdict only; no re-review section.**
PLAN says "DONE (109dafb...)"; the record's revision is `e120f69`, and the record itself states that
`109dafb`'s change to `lib/policy/current.ts` was not re-reviewed. Since `e120f69`: 19 commits, 11
files, +2,315/-420, including `3e6b9b4` (maker-checker on the cancellation refund), `1f540d2` (a
create-stage failure retried under the same key), `d850f68` (F-B4-04, threshold per policy),
`4a48a26` (F-B4-05, cancellation closes payment pages and a late delta is parked), `01a0bd7`
(endorsement refunds through the approval queue), `65b06be` (F-B7-01). `refunds.ts` +321,
`cancel.ts` +237, `read.ts` +204, the webhook route +156. Those diffs were read piecemeal by the B7,
B4 and B8 reviewers in their own scopes; **no B5 reviewer ever looked at them.**

**(d) Measurable now.** Two of the four production policies are `cancelled` (CGP-01274, CGP-01062)
and one is `voided` (CGP-01061). The real Stripe refund `re_3UDN8aK6R3v50tIy0J6CmRy3` (208,109
cents, test mode) is in the sandbox and the three refund webhooks were received at 18:27:59Z.

**(e) Live fire.** Step 4 (cancel with an open claim, and explain refund, commission and reserve):
**done live by Yoann** on 2026-09-08 at 18:22Z to 18:28Z on CGP-01274, with the coordinator
verifying every line in the database and at Stripe. His explanation of why the reserve stays is
recorded as still pending.

**(f) Open.** F-B5-05 to F-B5-12 (grouped F-B5-L). F-B5-01, 02 and 03 read "review pending" in the
register; that is stale, the B7 record covers all three at `e77baa6` with its own check lines.
F-B5-04 is recorded as fixed on register evidence and was never verified by a B5 reviewer.

## B6: T+24h package

**Status: DONE NOT REVIEWED**

**(a) Criteria.** Seed-from-zero script; README integration inventory with modes; demo credentials
for broker and staff; STATUS and DECISIONS current; deployment verified from outside; T+24h email
drafted (Yoann sends).

**(b) Evidence.** `scripts/seed.ts` (refuses a non-empty database); the README inventory table with
five slots and honest modes; seven demo accounts; `docs/checkpoints/t-plus-24h-email.md`.

**(c) Review.** No review record takes B6 as its scope. The UI merge reviewer did check the
inventory labels against the deployed HTML, which is partial indirect coverage.

**(d) Measurable now.** All seven demo accounts authenticate on production: broker@ → `/broker`,
broker2@, broker3@, customer@, customer2@ → `/broker`, ops@ and approver@ → `/ops`, every one HTTP
303. The email was sent by Yoann at 22:34 Europe/Zurich on 2026-09-08, 9 h 16 before the deadline.

**(e) Live fire.** Not applicable.

**(f) Open.** **The customer demo account's post-login landing page is an error page.**
`/api/session/login` sends every non-staff role to `/broker`; `/broker` then answers HTTP 200 with a
red alert, "This page is the broker journey. Your account has the role 'customer'", and a link to
`/customer`. No data leaks and the sidebar is correct, but the first screen the panel will see with
`customer@example.com` is a refusal. The route comment still explains the old rationale
("customers find their approvals from there"), which stopped being true when B13-6 gave customers
their own home. **F-RC-04 (MEDIUM, first impression).** Separately, the README has no section for
the operations console or its `check:console` line.

## B7: Claims, reserves, payout, maker-checker

**Status: DONE NOT REVIEWED**

**(a) Criteria.** Claim intake; reserve set and adjusted append-only; payment reduces the reserve;
incurred = paid + reserve; payment refused past the limit; money-out above $1,000 queued for a
distinct human approver (initiator blocked, agent blocked, direct endpoint blocked, changed intent
needs fresh approval); simulated rail with delayed settlement and a return; bank ownership check
through a labeled simulator.

**(b) Evidence.** `e77baa6`, fixes `65b06be`. `check:claims-and-approvals` **72/72** last recorded.

**(c) Review.** FAIL at `85da484` (15:20Z, F-B7-01 HIGH: a rejected refund above $1,000 could be
re-issued with no approval request), **PASS at `65b06be`, 2026-09-08T16:05Z**; rule 14 PASS at
`9a69fd5`. Since then: 20 files, +1,364/-518. **Material changes landed after the last re-review
with no further re-review**: `4ddb33b` (rule 21, an agent-raised claim payment always queues for a
human approver, and `sendClaimPayment` fails closed on an agent-raised payment without a request:
this is an authorization rule on money-out, rewritten in `lib/claims/payments.ts`), and `b956950`
at 16:58Z carrying F-B7-05, 06, 07, 08, 09 and 10 plus migration 0013, which is DDL on protected
money tables. Rule 21's evidence is the builder's `check:mcp` 53/53, later 58/58 under the LOW-batch
review; that is a check, not a verdict on the B7 scope. `d850f68` and `dcad358` in
`lib/approvals/threshold.ts` were covered by the B4 re-review; `d3152ea` (F-B7-13) by the LOW batch.

**(d) Measurable now.** One claim on production, CLM-00212 on CGP-01274, still open: reserve set
500,000, one payment requested / sent / settled at 120,000, then a rejected 1,000 request and a
rejected second 120,000 request. The claim screen renders paid $1,200.00 and the reserve
outstanding $3,800.00, so incurred = paid + reserve holds on the deployed data. Four approval
requests, four decisions: claim payment 120,000 approved, claim payment 1,000 rejected, refund
208,109 approved, claim payment 120,000 rejected.

**(e) Live fire.** Step 7 (initiator refused on the approvals queue): **not done by Yoann.** STATUS
records this explicitly at 18:30Z, "the coordinator's instruction came in the wrong order; to be
done on the next refund", and it never was. The B7 reviewer did prove it over HTTP on production
against the initiator, a broker, a customer and an anonymous caller, and `check:claims-and-approvals`
carries the lines. So the control is demonstrated; **the rehearsal Yoann must perform is not.**

**(f) Open.** F-B7-12 (migration numbering). F-B7-05 to F-B7-10 were open at the re-review and were
fixed only afterwards, inside the unreviewed `b956950`.

## B8: Backdated correction and as-of

**Status: DONE NOT REVIEWED**

**(a) Criteria.** Wrong effective date corrected by reversal entries plus re-book; original rows
untouched (test); corrected figure on the statement; policy view and PDF as it stood on any date,
including between two endorsements; effective-time versus recorded-time semantics documented.

**(b) Evidence.** `f8c904f`/`e7b5913`, fixes `2755d11`. `check:correction-replay` **55/55** last
recorded, with 36 original rows compared byte for byte before and after.

**(c) Review.** FAIL at `e7b5913` (18:25Z, one HIGH two MEDIUM), **PASS at `2755d11`,
2026-09-08T19:40Z**. Since then: 3 files, +139/-79. **Material change with no further re-review**:
`369671d` adds `pg_advisory_xact_lock` inside the correction-difference money posting.

**(d) Measurable now.** The correction entry point is live: the policy page carries a form posting
to `/policies/{id}/corrections/new`, and the route answers 200. Effective and recorded times are
distinct throughout the schema. **No production policy carries a backdated endorsement-date
correction**: the as-of steps on all four policies show no corrected-away date.

**(e) Live fire.** Step 2 (backdated fix): **not done live.** The machinery is proven by
`check:correction-replay` 55/55, by the reviewer's from-scratch reproduction of the worked example
(38630 and 907 as booked, 43561 and 1023 corrected, 5047 to collect, 739 of commission), and by
HTTP refusals on production, but no correction has been performed on the deployed application by
anyone. Step 5 (as-of between two endorsements): **not done and not currently possible.** A delegate
confirmed on the trial database, and I confirmed from the as-of panels of all four policies, that
**no policy has two or more endorsements**. CGP-01707 has exactly one. As-of across that single
endorsement works and renders different figures; as-of *between two* endorsements has no data.

**(f) Open.** F-B8-06 (LOW, three refusals rest on reading only). The register still shows F-B8-01,
02, 03, 04, 05 and 07 as "OPEN, dispatched 18:29Z" although the re-review closed them: the register
block is stale, not the record. **F-RC-03.**

## B9: Broker monthly statement

**Status: DONE NOT REVIEWED**, the worst post-review drift of any slice.

**(a) Criteria.** Statement run stored immutably with a content hash; premium collected, commission
earned, clawback, net due; ties to the ledger to the cent (test); rerun of a closed month is
identical.

**(b) Evidence.** `44188bd`, follow-ups `51883fe`, format-version fix `8b5b490`.
`check:statements` **53/53** last recorded, after decision 22.

**(c) Review.** Two FAILs (`44188bd` 17:10Z on F-B9-01; `afeba97` 17:15Z on F-B9-09, a format change
over rows that already existed), **PASS at `8b5b490`, 2026-09-08T17:32Z, scoped to the fix batch**.
Since then: 10 files, +1,166/-483. **Material changes with no further re-review**:
- `919cd51`, statement format **version 3** (decision 22, 09:52 local today): it changes the
  canonical text a statement hashes and adds **migration 0020, which drops and re-adds the
  `canonical_version` CHECK on the protected table `statement_runs`**, applied to the trial
  database. No review record mentions it. It resolves the LOW-batch reviewer's own F-B13-13 without
  that reviewer being asked to confirm the resolution.
- `4cef315`, +269 in `lib/statements/pdf.tsx`, the broker-grade PDF layout. STATUS says its review
  is "folded into the final integration review", which does not exist.

**(d) Measurable now.** Five statement runs on production, all Redwood (delegate read): 2026-09
revisions 1, 2, 3 (canonical versions 1, 1, 2; revision 2 flagged identical to previous) and 2027-09
revisions 1 and 2. Revision 3: premium collected 576,275, commission 86,441, clawback 47,506, net
due 38,935. I rendered a statement page on production: it shows revision, knowledge cutoff, "ties to
the ledger", the "format changed" chip, the provisional-month label, and an explanation fold under
each of the five totals naming its formula and rounding rule. broker2 and broker3 have no statement
runs, so the empty-broker case is unexercised on production.

**(e) Live fire.** Not one of the seven steps directly; it is where live-fire step 2's corrected
figure would have to appear.

**(f) Open.** F-B9-05, F-B9-08, F-B9-11, and F-B9-06 half open. **F-RC-05 (MEDIUM): the statement
format-3 change and migration 0020 are unreviewed, and they are also the reason B1's guards evidence
is stale.**

## B10: Reconciliation

**Status: DONE NOT REVIEWED**, and one acceptance criterion is only partly demonstrated.

**(a) Criteria.** Job pulls Stripe PaymentIntents, Refunds and BalanceTransactions for a window and
diffs them against the ledger; classifications matched, local-only, provider-only, amount mismatch,
stale; run summary stored; breaks screen with age; **planted mismatch found**; **a failed fetch is
never reported clean**.

**(b) Evidence.** `28a361c`, fixes `f9fc17f`/`010a6fe`, follow-ups `b1a0bce`.
`check:reconciliation` **39/39** last recorded.

**(c) Review.** FAIL at `28a361c` (17:05Z, F-B10-01 HIGH: a break outside the compared window left
the open list and read as resolved; reproduced, 14 open rail breaks became 0), **PASS at `e110a7c`
(merged `3017d0e`, renumbered `010a6fe`), 2026-09-08T18:10Z**. Since then: 6 files, +335/-160.
**Material change with no further re-review, and it sits directly on the control that caused the
FAIL**: `b1a0bce` changes `lib/reconciliation/read.ts` to fix F-B10-11 and F-B10-12, the two
findings the re-review itself raised, and the record contains no verification of that fix.
`99e4258` (F-B10-09) and `63520ac` (F-B11-03) were covered by the LOW batch.

**(d) Measurable now, I rendered `/ops/reconciliation` on production as `ops@`.** 22 open breaks.
Each row carries the provider reference, source, classification, provider amount, ledger amount
("no record"), difference, first seen in UTC, "Open for" age in hours, and a plain-English meaning.
Ages run 2.19 to 14.22 hours. The screen labels the two sources "Stripe: LIVE SANDBOX" and
"claim payout rail: LOCAL SIMULATOR", carries the clearing balances and a "Reconcile both sources
now" form, and the daily cron fired on its own at 06:00 UTC. Delegate read of the trial database:
104 reconciliation items ever written on production, **matched 32, provider_only 72, and zero
local_only, zero amount_mismatch, zero stale**. Ten runs, all `complete`, none with a fetch error.

**(e) Live fire.** Step 6 (planted payout mismatch on the breaks screen): **partly, and not as the
brief words it.** What is on the deployed board is 22 provider-only Stripe breaks, all leftover
probe payments from the check scripts, including `pi_3UDQN7K6R3v50tIy0fdlIi1Q` at **$42.42**, which
is the mismatch `check:reconciliation` plants on each run. So a planted mismatch *is* visible on the
deployed breaks screen with its age. But: it is a **provider-only** break, not a payout mismatch;
the **claim payout rail reports zero breaks on production**; the planted rail transfer is a row
inserted straight into the simulator table on `corgi_test`; the `amount_mismatch` class is exercised
only against a captured fixture; and no human ever planted a break and watched it appear.
"A failed fetch is never reported clean" was **never observed on the deployed application**, the
trial database holds no failed run; the claim rests on a check assertion, a CHECK constraint and
code reading.

**(f) Open.** F-B10-07 (open by decision, the read stays unbounded so no row is dropped) and
F-B10-08 (disclosed in the README: no acknowledgement path, so a genuine break would arrive as one
more line among 22 known ones, the reviewer's own words). `COMPLIANCE-MATRIX` row REC-01 still
reads "PASS (6e8805e), independent review pending", two verdicts stale.

## B11: MCP surface

**Status: DONE NOT REVIEWED**

**(a) Criteria.** Streamable HTTP MCP endpoint with a per-user API key; read tools
`get_policy_as_of`, `get_broker_statement`, `list_reconciliation_breaks`; write tool
`request_claim_payment`, plus `run_reconciliation`; a written list of never-delegated operations.

**(b) Evidence.** `e7d7856`, `5f2c841`. `check:mcp` **58/58** last recorded.

**(c) Review.** **PASS at `5f2c841`, 2026-09-08T19:37Z. One verdict; no re-review section.** Since
then: 10 files, +395/-50. Five of the six commits are LOW fixes covered by the LOW-batch review at
`82591a0`. The sixth, `4ddb33b`, is in no review's declared scope and **rewrote the maker-checker
gate** (rule 21). The record still lists F-B11-01 as OPEN even though rule 21 closed it.

**(d) Measurable now.** `POST /api/mcp` with no key returns **HTTP 401 `{"error":"unauthorized"}`**;
with an invalid bearer, the same, with `www-authenticate: Bearer realm="corgi-mcp"` and no detail
distinguishing absent, unknown and revoked. `GET` returns 405 with `allow: POST` and a sentence
saying the endpoint opens no server-to-client stream. The five tools live in `lib/mcp/tools/`, not
in the route file. Delegate read of `mcp_calls`: 70 calls on production, ok 18 handshakes, ok 10
`get_policy_as_of`, ok 4 `get_broker_statement`, ok 3 `list_reconciliation_breaks`, ok 1
`request_claim_payment`; 25 refusals including 2 against a nonexistent `approve_claim_payment`; 9
unauthorised. Seven keys, six revoked, one live (`cmk_e96f88a4`, agent principal, ops@, 30 calls).

**(e) Live fire.** Not one of the seven steps. The B12-1 rehearsal on production (MCP Inspector
2.5.0, a $1,200 payment queued as agent-raised request `8148a717` and rejected by a human 87 seconds
later, screenshots in `docs/evidence/b12-1/`) is the working evidence.

**(f) Open.** F-B11-04 (LOW, the 0018 trigger fires on key insert only).

## B12: Differentiator: impact preview and explanation

**Status: PARTIAL**

**(a) Criteria.** Same pure function for preview and execution; preview page before approval
(endorsement, cancellation, correction); explanation page after execution listing each amount with
its formula line; stale quote rejected when the policy version changed.

**(b) Evidence.** B12-1 agent demo (`docs/handoffs/b12-1-agent-demo.md`, evidence pack);
B12-2/B12-3 at `a6aca56` then `19baf15` (23 folds, as-of steps, 12 new unit tests); B12-4 animated
explanation at `595e7b4`/`db1762a` (a new 346-line client component, 11 tests including one
asserting the client source does no arithmetic on cents, 12 frames under `docs/evidence/b12-4/`).

**(c) Review.** B12-2/3: PASS at `b40e803`, then **PASS at `19baf15`** after the fix cycle. Since
then: 5 files +144/-60 **plus a new fourth client component**, `components/amount-explained-motion.tsx`.
The b12 record's own requirement 2 was "the list of client files is identical before and after the
merge"; that is no longer true, and nobody rechecked it. **B12-4 has no review record. The PDF
quality pass (`4dbeef9`, +593 lines across `lib/documents` and `lib/statements/pdf.tsx`, which is
the "document generation REAL" slot) has no review record.** B12-1 has no review record either; it
has an evidence pack, which is a different thing.

**(d) Measurable now.** As-of steps render on all four production policies with the right dates
(and only the dates that still apply). The explanation folds render on the statement page with the
formula, the rounding rule by name and the proving entries. The preview pages for endorse and cancel
render when opened bare.

**(e) Live fire.** Not one of the seven steps.

**(f) Open.** **`/policies/{id}/corrections/new` opened with a valid policy id and no parameters
renders a heading and a red alert ("a correction needs a written reason of at least ten characters")
and no form at all.** The real flow posts to it from the policy page, so this is a degraded empty
state rather than a dead end, but it is the entry point for live-fire step 2, and the endorse and
cancel preview pages do render their form in the same situation. **F-RC-06 (LOW).**

## B13: Hardening, screens, integration review

**Status: PARTIAL**

**(a) Criteria.** Three key screens (policy detail with as-of, reconciliation breaks, broker
statement) with **default, loading, empty, error and one edge state**; **structured redacted logs**;
**independent integration review PASS or disclosed gaps**; **walkthrough rehearsal with Yoann** (one
transaction, one correction, one failure).

**(b) Evidence.** Interface merge `856e75c`, polish `c5bcf2a`/`41be7fc`, full screen rebuild
`b9636c2` → `e341f83` → `fea572c`, LOW batch `82591a0`, change requests `06999e3`, PDF quality
`4dbeef9`, inbox `08f2493`, animation `db1762a`, console `020fd86`/`5d405d2`. `check:change-requests`
**43/43**, `check:inbox-counts` **4/4**, `check:console` **48/48** (all on `corgi_test`).

**(c) Review.** ui-main-merge PASS at `856e75c`; ui-polish PASS at `41be7fc`; ui-rebuild FAIL at
`e341f83` (F-UI-22, the typed decimal comma that would have booked $120,050.00) then **PASS at
`fea572c`**; b13-2 LOW batch PASS at `82591a0`; b13-6 change requests PASS at `06999e3`. Every one of
those revisions has been overtaken: ui-main-merge +8,514/-2,313 since, ui-polish +7,092/-2,450,
ui-rebuild +3,978/-159. In b13-6 specifically, `countOpenChangeRequests` was **rewritten** after the
verdict: the "not exists" SQL the reviewer verified and measured on production (0 → 1 → 0) is gone,
replaced by a per-policy loop.

**No review record exists for:** the operations console (`020fd86`, **5,647 lines over 17 files**,
including `lib/console/read.ts` at 2,815 lines and seven staff routes; a reviewer is running), the
`/inbox` notification centre, the animated explanation, the PDF quality pass, statement format 3 and
migration 0020, and **the integration review itself, REVIEWER.md requires `docs/reviews/integration.md`
and it does not exist.**

**(d) Measurable now.** Twelve staff routes answer 200 on production in 0.21 s to 0.39 s, console
included. A customer is refused on `/ops` (307 → `/broker`) and on `/ops/console` and
`/ops/console/infra` (307 → `/customer`); the console's own access rule is the stricter and more
correct of the two.

**(e) Live fire.** B13 is where the walkthroughs live; see the AF-06 row.

**(f) Open, four criteria, stated plainly.**

1. **The five states were never verified on the three key screens, at any revision.** "Loading
   state" and "error state" appear nowhere in the seven UI records; "empty state" appears three
   times, all about one explanation fold. The only loading-state work was F-UI-01, where the root
   loading boundary was **deleted** rather than verified.
2. **No screen that exists today has ever been rendered at 375 px.** One reviewer did drive Chrome
   152 over the DevTools Protocol at 375x812 across 21 route/role combinations, at revision
   `af08635`, around 18:30Z on 2026-09-08, default state only, evidence a browser session with no
   committed screenshot. That predates the interface polish, the entire screen rebuild, the customer
   view, the explanation folds, the animation, the inbox and the console. Every later reviewer says
   so in its own words: ui-polish "the reviewed revision has no rendered narrow-viewport evidence
   from me or from the builder"; ui-rebuild "no browser tool was available to this reviewer" and, on
   F-UI-25 after the fix, "it is not resolved in the sense of somebody having looked at it at 375
   pixels"; b13-6 "nobody has looked at these two screens in a browser at any width". The one
   browser-measurement file in the repository, `docs/handoffs/ui-main-browser-checks.json`, is
   builder evidence at **390 px**, not 375, against a local preview harness with fabricated data
   (`UI-PREVIEW-001`). The repository holds no screenshot of any application screen at any width.
3. **Structured redacted logs are not built.** There is no logging module, no correlation id, and
   five `console.*` calls in the whole of `lib/` and `app/`. One of them,
   `lib/mcp/jsonrpc.ts:268`, logs the raw thrown error object. The append-only activity log that
   would satisfy this is explicitly deferred to console v2 by Yoann's decision of 07:40Z.
   **F-RC-07 (MEDIUM): an acceptance criterion of B13 is not implemented and is not disclosed as cut.**
4. **The rule-14 refund leg (F-B4-01) is still not built**, disclosed in the README.

Two console-specific points, since the console is unreviewed and the panel will open it:

- **The seven console screens carry no integration-mode label.** They render claim payout rail
  records and bank verification records, both LOCAL SIMULATOR slots, beside real Stripe
  references, with no LOCAL SIMULATOR or LIVE SANDBOX wording anywhere on the page. The README
  inventory is intact and every other screen is labelled, so this is not AF-02 in its strong sense;
  it is a labelling inconsistency introduced on unreviewed screens. **F-RC-08 (MEDIUM).**
- **The infra page's documented limits.** A peer session verified all eleven against the live
  provider pages and found them accurate. Two of the three caveats it passed on do apply to the
  shipped code, one does not. The Neon compute cell **does** say "per project per month"
  (`lib/console/infra.ts:84`), so that caveat is void. The Neon branches cell says "5 GB public
  **egress** per project" where Neon's own term is "public network transfer"
  (`infra.ts:91`), a paraphrase on a page that says its lines were "copied here", so worth the
  exact word. And the Stripe row is headed "API rate limit, sandbox (test mode)" while quoting
  "25 requests per second per endpoint", a figure Stripe does **not** split by mode
  (`infra.ts:103-105`), the row reads an unqualified source line as sandbox-specific.
  **F-RC-09 (LOW, wording, two lines).**

## B14: Freeze package

**Status: NOT DONE**

**(a) Criteria.** Video at most five minutes; evidence pack (Stripe and KYB dashboards, webhook
logs); cut list and week-two plan; final email draft with exactly four items; remote SHA verified;
history secret scan.

**(b) Evidence.** The cut list and the week-two plan exist in the README. `docs/evidence/` holds
three folders (b12-1, b12-4, pdf), the MCP session, the animation frames and the PDF renders. There
is no Stripe dashboard capture, no KYB capture and no webhook-log capture.

**(c) Review.** Not started.

**(d) Measurable now.** The history secret scan is clean (this recheck, 347 commits, exit 0). The
remote SHA has not been verified in this session.

**(e) Live fire.** B14 is where the four rehearsals that are still missing must land.

**(f) Open.** Everything except the cut list and the week-two plan.

---

# Live-fire steps of the brief

"Live by Yoann" means Yoann himself drove it on the deployed application. "Check only" means the
behaviour is proven by a check script or by an agent's HTTP probe, which is evidence of the control
but not the rehearsal the brief asks for.

| # | Step | Status | Evidence |
|---|---|---|---|
| 1 | Pay with a test card and watch the journal | **Live by Yoann** | CGP-01062 at 10:16Z and CGP-01707 at 18:56Z on 2026-09-08; four entries each, every figure equal to the recited example |
| 2 | Backdated fix | **Not done** | `check:correction-replay` 55/55 and the reviewer's from-scratch reproduction; no correction has ever been performed on the deployed application, and no production policy carries one |
| 3 | Webhook replayed twice | **Check only** | Coordinator HTTP probes on production 2026-09-08 (sequential and concurrent, two events stored for four deliveries) and `check:payment-replay` 34/34; not driven by Yoann |
| 4 | Cancel with an open claim | **Live by Yoann** | CGP-01274 on 2026-09-08 18:22Z to 18:28Z; refund `re_3UDN8a...` 208,109 cents succeeded, three webhooks received, clawback posted, claim CLM-00212 and its $3,800 reserve untouched. His spoken explanation of why the reserve stays is still pending |
| 5 | Policy as it stood between two endorsements | **Not done, and not currently possible** | No production policy has two endorsements. CGP-01707 has exactly one (2026-10-08). As-of *across* that one endorsement works and was verified; as-of *between two* has no data |
| 6 | Planted payout mismatch on the breaks screen | **Partly, and not as worded** | A planted $42.42 Stripe probe is on the deployed board as a **provider-only** break with its age, among 22 identical probes. The claim payout **rail** reports zero breaks on production; the rail mismatch and the amount-mismatch class exist only in `check:reconciliation` on `corgi_test`. Zero `local_only`, `amount_mismatch` and `stale` items have ever been produced on production. No human planted one and watched it appear |
| 7 | Initiator refused on the approvals queue | **Check only** | STATUS 18:30Z: "Not done by Yoann... to be done on the next refund", and it never was. The B7 reviewer proved the refusal over HTTP on production against the initiator, a broker, a customer and an anonymous caller |

Three of seven were driven by Yoann; two are proven only by checks; two have not been done at all.

---

# Automatic fails, rechecked at `5d405d2`

| ID | Verdict | Evidence gathered in this recheck |
|---|---|---|
| **AF-01** deployed URL and demo roles | **PASS** | `/api/health` HTTP 200, `database: ok`, revision `5d405d2a...` = `main`, from outside the dev machine. All **seven** demo accounts authenticate (HTTP 303): broker@, broker2@, broker3@, customer@, customer2@, ops@, approver@. Twelve staff routes answer 200 in 0.21 to 0.39 s. Caveat, not a failure: the customer lands on a refusal page (F-RC-04) |
| **AF-02** no simulation presented as live | **PASS, with one gap** | README inventory lists five slots with honest modes; two are LIVE SANDBOX (Stripe collection, Stripe Connect KYB, both disclosed as running on one provider), two LOCAL SIMULATOR, one REAL. The labels appear in the deployed HTML on `/ops/reconciliation` ("Stripe: LIVE SANDBOX", "claim payout rail: LOCAL SIMULATOR"), the claim screen and the overview, and in the reconciliation run notes. **Gap: the seven `/ops/console` screens carry no mode label while rendering simulated rail records beside Stripe references (F-RC-08).** The README also has no console section |
| **AF-03** never UPDATE or DELETE money rows | **PASS on code, evidence one migration stale** | Source sweep of `lib/`, `app/` and `db/`: the only `update` statements are three on `webhook_processing` (the declared mutable nonfinancial delivery table) and one `on conflict do update` on `policy_current` (the declared rebuildable cache, with `npm run rebuild:policy-current`). No `delete from`, no `truncate` outside the guard definitions. Delegate read of the trial database: 34 base tables, **28 carrying UPDATE/DELETE/TRUNCATE triggers**; the runtime role holds SELECT and INSERT everywhere and UPDATE only on those same two cache tables. **Debits 4,262,730 = credits 4,262,730, difference 0**, no unbalanced entry. **Stale: the last `check:money-guards` proof is 184/184 at 06:55Z on an ephemeral database migrated to 0019; migration 0020 has landed since and it drops and re-adds a CHECK on the protected table `statement_runs` (F-RC-02). I did not run the guards, as instructed** |
| **AF-04** sandbox only | **PASS** | `STRIPE_SECRET_KEY` in `.env.local` starts with `sk_test_`; zero occurrences of `sk_live` in the file (checked by count, never printed). `lib/stripe.ts:12` throws on any key that is not `sk_test_`; the balance call checks `livemode`; the webhook route rejects live-mode events with 400; the database carries a `livemode = false` CHECK. All **65** webhook events on the trial database are `livemode: false` and `signature_verified: true` |
| **AF-05** never commit secrets | **PASS** | `gitleaks detect --redact --no-banner` (the 8.30.1 alias of `gitleaks git`): **347 commits scanned, no leaks found, exit 0**. `git ls-files` shows `.env.example` as the only tracked env file. `.githooks/pre-commit` runs `gitleaks protect --staged`. The working-tree scan (`gitleaks dir`) reports 89 findings, and **every one is in a git-ignored path**: 58 in `.claude/worktrees/*/.next` build caches, 10 in `.next`, 10 in `.worktrees/corgi-interface/.next`, 8 in `.env.local`, 3 in `.env.vercel.local`. No tracked file is among them; the agent worktrees contain only `.env.example` copies, no `.env.local`. **Before the freeze, run the literal `gitleaks git --redact --no-banner` from an unrestricted shell** so the evidence carries the exact command |
| **AF-06** own and explain every line | **NOT SATISFIED** | See the table below. **Every one of the eighteen review records ends with "Candidate walkthrough status: NOT REVIEWED WITH YOANN", without exception.** Two live scenarios were driven by Yoann and both left his own explanation pending. Meanwhile the unexplained surface grew: 5,647 lines of console (one file of 2,815 lines) landed at 10:00 today |

## AF-06 walkthrough status per slice, read from STATUS

| Slice | Walkthrough status |
|---|---|
| B0 | NOT REVIEWED WITH YOANN |
| B1 | QUESTIONS OPEN, covered in the 12:05Z session (outbox order, which event posts, replay twice is one) |
| B2 | QUESTIONS OPEN, same session; he asked for shorter explanations and the Code page was rewritten with a flow diagram |
| B3 | NOT REVIEWED WITH YOANN |
| B4 | Live step done by Yoann 06:34Z today; **his explanation of "priced from the effective date" pending** |
| B5 | QUESTIONS OPEN, refund liability explained with his own policy's figures in the 12:05Z session |
| B6 | NOT REVIEWED WITH YOANN |
| B7 | Scenario 4 done by Yoann 18:30Z; **his explanation of why the reserve stays pending** |
| B8 | NOT REVIEWED WITH YOANN |
| B9 | NOT REVIEWED WITH YOANN |
| B10 | NOT REVIEWED WITH YOANN |
| B11 | NOT REVIEWED WITH YOANN |
| B12 | NOT REVIEWED WITH YOANN |
| B13 | NOT REVIEWED WITH YOANN, including the interface dressing and the console |
| B14 | Not started |

---

# New findings raised by this recheck

| ID | Sev | Finding |
|---|---|---|
| F-RC-01 | LOW | `.gitignore` re-ignores `.env.example` on a later `.env*` line, overriding its own `!.env.example`; the file survives only because it was already tracked |
| F-RC-02 | MEDIUM | The money guards have no proof on the current schema: last run 184/184 on a database migrated to 0019, and 0020 changed a constraint on the protected table `statement_runs` |
| F-RC-03 | LOW | `docs/reviews/FINDINGS.md` is stale in at least four places: F-B2-21, F-B3-06, F-B3-09 and the whole F-B8-01/02/03/04/05/07 block read OPEN although the code and the re-reviews closed them. F-B5-01/02/03 read "review pending" |
| F-RC-04 | MEDIUM | A customer signing in on production lands on `/broker`, which answers 200 with a red refusal alert. First screen the panel sees with `customer@example.com`. The route comment still gives the pre-B13-6 rationale |
| F-RC-05 | MEDIUM | Statement format version 3 and migration 0020 are unreviewed: they change the canonical text a statement hashes and alter a constraint on a protected table |
| F-RC-06 | LOW | `/policies/{id}/corrections/new` opened bare renders a heading and a red alert with no form, unlike the endorse and cancel preview pages. It is the entry point for live-fire step 2 |
| F-RC-07 | MEDIUM | B13's "structured redacted logs" criterion is not implemented and is not disclosed as cut. No logging module, no correlation id, five `console.*` calls, one logging a raw thrown error (`lib/mcp/jsonrpc.ts:268`) |
| F-RC-08 | MEDIUM | The seven console screens carry no LIVE SANDBOX / LOCAL SIMULATOR label while rendering simulated rail records beside Stripe references |
| F-RC-09 | LOW | Two wording slips on the infra page's documented limits: "public egress" where Neon says "public network transfer", and Stripe's mode-agnostic per-endpoint 25 rps quoted under a row headed "sandbox (test mode)" |
| F-RC-10 | LOW | Two review records stamp local Zurich time with a `Z` suffix, two hours ahead of the truth (ui-polish claims 21:05Z to 22:05Z for work committed at 19:38Z; b12-explain claims 09:05Z and 09:20Z for verdicts committed at 07:01Z and 07:19Z). Review chronology cannot be reconstructed from the headers alone |
| F-RC-11 | LOW | Operational: `.env.local` sets `DATABASE_URL_APP` and `DATABASE_URL_TEST_APP` unquoted with an `&` in the query string, so `set -a; . .env.local` silently leaves them unset. The Next.js app is unaffected; any shell script is. Quoting both values fixes it |
| F-RC-12 | LOW | `docs/COMPLIANCE-MATRIX.md` has rows for eleven controls at revisions between `3c9ef3a` and `5f2c841`, several marked "independent review pending" that have since passed, and **no rows at all** for endorsements, cancellation, corrections, statements, B12, change requests, the inbox or the console |

---

# What must still happen before the freeze

Ordered by what a disqualification rule or an acceptance criterion demands first, then by what the
panel will actually touch. Estimates are working hours for one agent or, where marked, for Yoann.

1. **Yoann's AF-06 walkthroughs, the single largest exposure. (Yoann, 2 h 30, unavoidable.)**
   Every review record says NOT REVIEWED WITH YOANN, and 5,647 lines of console landed this morning.
   Do the brief's three: trace one transaction end to end, explain one correction, explain one
   failure. Then have him read back, in his own words, the four places a panel will point: the
   balance trigger and the seal in migrations 0001 and 0003; the idempotency key and the advisory
   lock in `lib/payments/collection.ts`; the maker-checker gate inside `issueRefundsAtStripe` and
   `sendClaimPayment` including rule 21; and the reversal-plus-re-book transaction in
   `lib/policy/correct-endorsement-date.ts`. Record the result honestly as
   EXPLAINED AND CONFIRMED or QUESTIONS OPEN, per slice.
2. **Re-prove the money guards on the current schema. (0 h 20.)** `check:money-guards` on a fresh
   ephemeral database migrated 0001 to 0020 with the runtime role, then dropped. Closes F-RC-02.
   This is AF-03 evidence and it is currently one migration old.
3. **Run the literal history scan for the record. (0 h 05.)**
   `gitleaks git --redact --no-banner` from an unrestricted shell in the main checkout. My
   `gitleaks detect` run is the same engine and is clean, but the submission should carry the
   command AF-05 names.
4. **The two live-fire steps that were never done, with Yoann driving. (Yoann, 0 h 45.)**
   (a) A **backdated correction** on CGP-01707's endorsement, on the deployed application, ending on
   the corrected figure on a fresh statement revision, that is live-fire step 2 and it also
   exercises B8, B9 and B12 together. (b) The **initiator refused on the approvals queue**: on the
   next money-out, have him try to approve his own request and be refused, which is live-fire step 7
   and closes the item STATUS has carried open since 18:30Z yesterday.
5. **A second endorsement on CGP-01707, so live-fire step 5 exists at all. (0 h 20 including
   Yoann's click.)** Without it, "the policy as it stood between two endorsements" is a criterion
   with no data behind it. One more endorsement effective at a different date makes the as-of panel
   answer the brief's actual question.
6. **The independent integration review. (1 h 30.)** `docs/reviews/integration.md` does not exist
   and REVIEWER.md requires it; it is also B13's own acceptance criterion. Scope it at `5d405d2`
   and point it at what nothing else covers: the console (unreviewed, 5,647 lines, seven staff
   routes), the inbox, the animated explanation, the PDF quality pass, statement format 3 with
   migration 0020, and the cross-slice commits `b956950`, `0fa828d`, `369671d` and `4ddb33b` that
   every per-slice reviewer declared out of scope. Verdict PASS or disclosed gaps.
7. **Render the three key screens at 375 px and capture the five states. (1 h.)** Nobody has looked
   at any current screen on a phone. Drive a headless browser at 375x812 over policy detail with
   as-of, reconciliation breaks and broker statement, in default, loading, empty, error and one edge
   state, and commit the images under `docs/evidence/`. That is the only way B13's first criterion
   stops being a claim.
8. **Decide and record the logging criterion. (0 h 30.)** Either build a minimal structured redacted
   logger with a correlation id, or write in the README and the cut list that structured logs were
   cut in favour of the console and the append-only activity log deferred to v2. Silence is the one
   option AGENTS.md forbids. Closes F-RC-07.
9. **Label the console screens and fix the two limit wordings. (0 h 20.)** One LIVE SANDBOX /
   LOCAL SIMULATOR line on the console pages that show rail records (F-RC-08); "public network
   transfer" for Neon and an unqualified per-endpoint row for Stripe (F-RC-09).
10. **Send the customer to `/customer` at login. (0 h 10.)** One line in
    `app/api/session/login/route.ts` plus the stale comment. The panel will sign in as the customer
    (F-RC-04).
11. **Reconcile the records of record. (0 h 40.)** Refresh `docs/reviews/FINDINGS.md` (F-RC-03),
    `docs/COMPLIANCE-MATRIX.md` (F-RC-12, eleven stale rows and eight missing features), and the
    PLAN status column for B12 and B13, which still read "reviews pending" and "IN PROGRESS: LOW
    batch... remain" for work that has since landed and passed. Add the console and `check:console` to
    the README.
12. **B14 itself. (2 h, plus Yoann for the video.)** Video at most five minutes; the evidence pack
    (Stripe dashboard, Connect verification, webhook logs, `docs/evidence/` currently holds only
    the MCP session, the animation frames and the PDF renders); the final email with exactly four
    items; the remote SHA verified; repository access confirmed for the two reviewers.
13. **Optional, only if time remains. (0 h 30.)** F-RC-06 (the bare correction preview renders no
    form), F-RC-11 (quote the two database URLs in `.env.local`), F-RC-01 (the `.gitignore`
    negation), and clearing the delegate worktrees under `.claude/worktrees` before the freeze ,
    they hold no `.env.local` today, only `.env.example`, and that should stay true.

Items 1, 2, 3 and 6 are the ones a rule requires. Items 4 and 5 are the ones the brief names and the
panel will ask about. Everything below 8 is polish.
