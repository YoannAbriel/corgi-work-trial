# Production confirmation of the five backend slices (decisions 28 to 32)

Reviewer: independent reviewer sub-agent, own git worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/agent-a59827931a0645ffc`, branch
`worktree-agent-a59827931a0645ffc`. Written 2026-09-09, checks run between 16:33Z and 16:45Z.
No part of the implementation is mine, no code file was modified, nothing was pushed, no shared
document was edited.

**Reviewed revision: `100ef4124e1c3d8fcb9625211019f9bb35063a69`.** Confirmed on
`https://corgi-work-trial-iota.vercel.app/api/health` before the first check
(`{"ok":true,"database":"ok","databaseTime":"2026-09-09T16:33:50.473Z","revision":"100ef41..."}`)
and again after the last one (`databaseTime 2026-09-09T16:42:28.872Z`, same revision). The
revision did not move while this review ran. `100ef41` was committed at 2026-09-09T16:30:42Z;
migrations 0022, 0023 and 0025 were applied to the trial database at 16:31Z by the coordinator,
0024 earlier.

**Verdict: FAIL.** Items 2 to 7 PASS on the deployed application, measured. Item 1 FAILS: the
breaks board on production still counts the probe payments (35 breaks to act on, 31 of them the
$42.42 probes), because `probe` is a classification a run stores and no reconciliation run has
happened since the deploy; and an explained break disappears from every view of the deployed
board instead of staying visible under its note. Two MEDIUM findings, both about the deployed
state rather than about the reviewed code, and both cheap to close.

**Walkthrough status: NOT REVIEWED WITH YOANN.**

This is a scoped engineering assessment of what the deployed application does at one revision. It
is not a legal certification and it does not state that the six delivery gates pass for the whole
submission.

## 1. Startup receipt

Read in full, in this order, before any check: `CLAUDE.md`, `AUTOMATIC-FAILS.md` (the six rules
and the operating gate), `REVIEWER.md`, `AGENTS.md`, `READABLE-CODE.md`.

Then `docs/DECISIONS.md` decisions 28, 29, 30, 31 and 32 with Yoann's quoted words of 15:02
local, decisions 24, 25, 26 and 27 that they amend, and the correction note of 16:08Z on the
migration numbers.

Review records read **in full**: `docs/reviews/backend-breaks-board-r3.md`,
`docs/reviews/backend-mcp-tools-r3.md`, `docs/reviews/backend-corrections-rule-24-r1.md`,
`docs/reviews/backend-guards-and-key-trigger-r1.md`,
`docs/reviews/backend-monthly-statements-r1.md`. The four earlier rounds
(`backend-breaks-board-r1.md`, `-r2.md`, `backend-mcp-tools-r1.md`, `-r2.md`) were **not** read in
full: the assignment named the round-3 records for those two slices, and each round-3 record
carries the full status of every finding of its earlier rounds. Nine `backend-*.md` files exist,
not seven; that is the only difference between the assignment's list and what is on `main`.

Also read: `docs/handoffs/b12-1-agent-demo.md` (the whole file: the client configuration, the
demo script, the rehearsal facts, the sanitised transcript), `README.md` (the integration
inventory line for Stripe, the MCP surface section, the money rules, the statements paragraph,
the week-two paragraph and the reconciliation note), `docs/reviews/integration.md` sections 1 and
4.1 (the 24 figures of item 1b).

Code and SQL read at this revision: `lib/reconciliation/read.ts` (whole file),
`lib/reconciliation/break-notes.ts`, the probe rule and its comment in
`lib/reconciliation/diff.ts`, `lib/reconciliation/stripe-records.ts` (the two mappers),
`breakCount` and the run insert of `lib/reconciliation/run.ts`,
`app/api/reconciliation/breaks/[breakKey]/explain/route.ts`, `lib/mcp/scope.ts`,
`lib/mcp/tools/explain-amount.ts`, `lib/mcp/tools/my-activity.ts`, `lib/policy/explain-figure.ts`
(the closed key list), `lib/statements/monthly-job.ts`, `app/api/jobs/daily/route.ts`,
`app/api/jobs/reconcile/route.ts` (the summary line), `app/api/session/login/route.ts`,
`app/policies/[policyId]/corrections/new/page.tsx`, `scripts/migrate.ts`,
`db/migrations/0022_reconciliation_break_notes.sql`,
`0023_reconciliation_probe_classification.sql`, `0024_mcp_key_creator.sql` and
`0025_break_notes_say_what_they_explain.sql`.

Absent files: none of the mandatory files is missing.

Next acceptance criterion this review gates: that the five slices merged into `main` behave on the
deployed application the way their branch reviews and the records say they behave.

Planned checks, all executed once: `/api/health` before and after; the login POST for four demo
users; GET of the inbox, the reconciliation board and its four views, the two policy pages and
their four sub-views each, the correction preview, `/ops`, `/ops/mcp-keys`, `/` and `/login`; six
then two MCP calls with the demo key (read tools only); **exactly one** POST to the explain route;
read-only SELECTs on the trial database as `app_runtime` plus one UPDATE attempt inside a
transaction that always rolls back. `npm run check:money-guards` was **not** run, and no check
script was run against `corgi_test`: the disposable database belongs to the interface session.
The guards evidence cited here is the coordinator's own, 200 of 200 proven on an ephemeral
database migrated to 0025 at 16:30Z.

## 2. Applicability

Deployed Track 1 policy administration application, sandbox only, USD integer cents, one Stripe
test-mode account, one local payout simulator. The scope of this review is what five already
reviewed slices do on the deployed application: an operations screen and its counts, an
append-only annotation table, two read-only MCP tools, a scheduled statement close, one approval
predicate on a correction preview, and one database trigger.

No money was moved and no provider was called by this review. The single write it made is one
INSERT into `reconciliation_break_notes`, an annotation table that holds no money, and its effect
on the ledger is nil (item counts before and after: 72 `matched`, 199 `provider_only`, unchanged).

No US legal rule turns on anything measured here: no personal data was read beyond the four demo
identities, no rail was touched, no eligibility decision was taken. The requirements that bite are
the trial's own (`AGENTS.md` reconciliation and MCP sections) and the decisions of record.

### Automatic-fail gate for this scope

| Rule | Verdict | Evidence |
|---|---|---|
| AF-01 accessible deployed URL | **PASS in scope** | `/api/health` returned the reviewed revision before and after; four demo roles authenticated over HTTPS; every screen in the matrix below was rendered from outside any local session. No server was started. |
| AF-02 nothing simulated presented as live | **PASS in scope, with F-BP-03** | Every working screen rendered carries `Stripe: LIVE SANDBOX` and `claim rail: LOCAL SIMULATOR`; `/` and `/login` carry "Sandbox providers and test data. No real money." The residual is a README sentence about a board behaviour, not about a provider mode: F-BP-03. |
| AF-03 never UPDATE or DELETE a money row | **PASS** | The one write is an INSERT. `update reconciliation_break_notes set note = ...` as `app_runtime`, inside a transaction rolled back on purpose: `permission denied for table reconciliation_break_notes`. Grants read back: `INSERT, SELECT` and nothing else. Three triggers on the table: `..._are_append_only` (`forbid_change_of_financial_record`), `..._cannot_be_truncated`, `..._recorded_at_is_server_set`. Item classification counts identical before and after. |
| AF-04 sandbox only | **PASS in scope** | No provider call was made: no reconciliation was run, `run_reconciliation` and `request_claim_payment` were never called, and the explain route calls no provider. Spent $0. |
| AF-05 no secret committed or printed | **PASS** | `DEMO_PASSWORD` and the MCP demo key were read by scripts from `.env.local` and `.local/mcp-demo-key.txt` and never echoed; both paths are gitignored. The 34 artefacts this review captured were scanned for `sk_`/`rk_`/`whsec_` shapes, connection strings, `cmk_` values, `corgi_session=`, `DEMO_PASSWORD`, `SESSION_SECRET`, `CRON_SECRET`: zero hits. `gitleaks protect --staged` was run before the commit that carries this record. No secret value appears anywhere in this file. |
| AF-06 explainable line by line | **NOT ESTABLISHED** | Reviewer judgement on readability only; the walkthrough status below is the honest state. |

## 3. Matrix of the seven items

| # | Item | Measurement on the deployed application | Verdict |
|---|---|---|---|
| 1 | Breaks board rules | Badge and inbox counted **36** breaks before this review's one note and **35** after, of which **31** are the $42.42 probes; the MCP tool returned the same 36 then 35, all `provider_only`, no `probe`; the latest complete run predates the deploy; the note row and the count drop are correct; UPDATE refused | **FAIL** (1d and 1e PASS, 1a and 1c FAIL, 1b not observable) |
| 2 | MCP tools | `tools/list` returns **7** tools with honest hints; `explain_amount` on CGP-01707 returned **$28.20** and **$345.20**, the same figures and the same formula lines and journal entry ids the policy page renders; an unknown figure key is refused by naming the closed list and never repeating the caller's value; `list_my_activity` returned exactly the **6** calls this review made and nothing else; the never-delegated list is still **10** entries, word for word the ones of the B12-1 handoff | **PASS** |
| 3 | Monthly job | The daily route runs the close **last**, after `runAllSources`; both inbox sections exist on production and are empty: staff "Statements produced this month ... it runs on the first day of a month", broker "Your monthly statement ... the monthly close runs on the first day of a month". The job was not triggered | **PASS** |
| 4 | Corrections, decision 31 | The preview on CGP-01707 prints "**$60.57 to collect: with this difference, this policy carries $1,160.54 of additional premium in this term, above $500.00, so the customer has to approve it before it is collected**". 110136 booked + 5918 difference = 116054, the term's running total, against the $500 threshold | **PASS** |
| 5 | Key creator | `/ops/mcp-keys` as `approver@example.com`: **307** to `/ops`; the string `mcp-keys` appears **0** times on the approver's `/ops` and **6** times on the operator's. The deployed trigger function carries **five** refusals, the fifth being "the person who created the key that raised this request cannot decide it", and its body names `raised_through_key_id`; the column exists on `approval_requests` and is nullable | **PASS** |
| 6 | The 24 figures of `integration.md` 4.1 | All 24 read the same at this revision. CGP-01707: $1,200.00, $28.20, $25.00, $1,253.20, $180.00, 335 of 365, $1,101.36, $25.88, $0.00, $1,127.24, $165.20, $2,380.44, $345.20, $2,301.36, `pi_3UDf5YK6R3v50tIy1GkJdCCi`, terms in force $1,200.00 / $28.20 / $1,253.20 / $1M / $2M. CGP-01274: $2,312.00, $2,391.33, $278.70, $2,033.30, $47.79, $0.00, $2,081.09, $304.99, $41.81, $1,200.00, $3,800.00, $5,000.00, `re_3UDN8aK6R3v50tIy0J6CmRy3`. **Zero** explanation folds printed the disagreement alert on the nine pages rendered | **PASS** |
| 7 | AF gate on the rendered pages | 34 artefacts scanned: **0** secret shapes, **0** stack traces (the nine regex hits were the words "at Stripe (gross of Stripe fees)"). Mode labels on every working screen; the sandbox sentence on `/` and on `/login`; three refusals rendered as one sentence each (307 to `/ops`, 307 to `/broker`, 404, plus the MCP enum refusal and the correction preview's "a correction needs a written reason of at least ten characters") | **PASS** |

### Item 1, sub-check by sub-check

| Sub-check | Measured | Verdict |
|---|---|---|
| 1a. The badge and the inbox count no longer count the probes | Sidebar badge and inbox both read **36 waiting**, then **35** after the one note. 31 of the 35 are $42.42 probes; the other four are one $100.00, two $12.61 and one refund of -$8.98. The board's tiles read the same 36 then 35 by source (Stripe 36/35, claim rail 0), which is `countOpenBreaksBySource` of `100ef41` agreeing with the badge | **FAIL** |
| 1b. The run summary counts probes separately | `app/api/jobs/reconcile/route.ts:89` builds "`<source>: N provider records against M ledger records, P probes, B breaks to act on`", and `breakCount` excludes probes. **Not observable on production**: the latest complete Stripe run finished at 2026-09-09T16:25:19.787Z, five minutes before `100ef41` was committed, and every `reconciliation_runs` row on the trial database carries `probe_count` NULL. The deployed runs view has no probe column | **NOT OBSERVABLE, code correct by reading** |
| 1c. `list_reconciliation_breaks` returns no probe | 36 breaks returned, then 35, every one `provider_only`; 32 then 31 of them at $42.42. The answer's `recentRuns` does carry a `probe` count, reading the NULL column as 0 | **FAIL** |
| 1d. After the explain POST, the note exists and the break left the count | One POST, `303` to `/ops/reconciliation?explained=stripe%7Cpi_3UDQN7K6R3v50tIy0fdlIi1Q#break-...`. Row read back as `app_runtime`: break key `stripe|pi_3UDQN7K6R3v50tIy0fdlIi1Q`, `explained_classification` `provider_only`, `explained_provider_amount_cents` 4242, `explained_ledger_amount_cents` null, author `ops@example.com` (`staff_ops`), `recorded_at` 2026-09-09T16:39:11.986Z set by the database. Exactly one row in the whole table. Badge, inbox, board and MCP tool all went 36 to 35 and the key is in none of them | **PASS** |
| 1e. UPDATE refused for the runtime role | Attempted once as `app_runtime` inside `begin` and rolled back: `permission denied for table reconciliation_break_notes`. Migration 0022 grants `select, insert` only and adds `forbid_change_of_financial_record` before update or delete; both were read back from the live schema. The trigger itself was not exercised, because the grant refuses first | **PASS** |

## 4. Findings

Severity as in `docs/reviews/FINDINGS.md`: HIGH blocks the slice, MEDIUM must be fixed before
submission, LOW is fixed when cheap or disclosed, INFO is an observation.

### F-BP-01 (MEDIUM): on the deployed application the probes are still counted as breaks to act on, because no run has classified them yet

**Where.** The trial database: `reconciliation_items` holds 72 `matched` and 199 `provider_only`
rows and **not one** row with classification `probe`. The latest complete Stripe run started at
2026-09-09T16:25:18.694Z and finished at 16:25:19.787Z, with `provider_only_count` 36 and
`probe_count` NULL. `100ef41` was committed at 16:30:42Z and the migrations landed at 16:31Z.

**Why.** `probe` is a classification a run **stores** (migration 0023, `lib/reconciliation/diff.ts`
`isProbeFromACheckRun`), and every reader keys on the classification of the latest complete run
(`LATEST_REPORT_OF_EACH_BREAK`). Deploying the code and applying the migration therefore changes
nothing on their own: the 32 probe PaymentIntents were classified `provider_only` by a run made
before the code existed, and they stay `provider_only` until a run under the deployed code looks at
them again. Nothing is wrong in the code; the slice is simply not finished on production.

**Consequence.** Decision 28 says the board will read "0 to act on, 28 probes from check runs".
Today it reads 35 to act on, no probe heading, no probe count. The count is also **growing**, not
shrinking: it was 20 on 2026-09-08, 22 at the 06:00Z cron, 28 at 12:42Z, 35 at 15:38Z and 36 at
16:25Z, because every `check:reconciliation` run on the disposable database plants one more real
$42.42 PaymentIntent in the shared Stripe sandbox and production's reconciliation finds it. A panel
opening the board today sees the exact list the slice was built to fix.

**Required correction.** One reconciliation run under the deployed code: the "Reconcile both
sources now" button on `/ops/reconciliation`, or the 06:00 UTC cron, or `run_reconciliation`
through MCP. This review deliberately did not run one (forbidden by its assignment), so the
outcome is a **prediction, not a measurement**: the 32 records of $42.42 should move to the probe
classification, and 4 breaks should remain to act on (one $100.00, two $12.61, one refund of
-$8.98). The one this review explained is among those 32, so it leaves the count as a probe rather
than as an explained break, and its note stops matching the report it was written against, which
is what migration 0025 is for. Whether the 32 existing PaymentIntents are recognised depends on their
Stripe `description` starting with `corgi_probe:` or their metadata carrying
`probe=check-reconciliation`; that cannot be read from the application and was not checked at
Stripe. **Re-read the board after that run before claiming decision 28 is delivered.**

### F-BP-02 (MEDIUM): an explained break disappears from every view of the deployed board

**Where.** `/ops/reconciliation` on `100ef41`, all four views (`?view=breaks`, `resolved`, `runs`,
`clearing`).

**Trigger, measured.** After the one note this review appended, the break key
`stripe|pi_3UDQN7K6R3v50tIy0fdlIi1Q` appears in **none** of the four views, the note text appears
nowhere, and the headline count silently went from 36 to 35. There is no "Explained breaks"
section, no "Probe payments from check runs" section, no explain form and no occurrence of the
word "probe" anywhere on the page.

**Consequence.** This is the failure mode the slice exists to prevent. `SOMEBODY_HAS_EXPLAINED_IT`
takes the break out of the count, the inbox, the 360 page and the MCP tool, and the promise that
makes that honest ("the break stays on the screen, under its own heading, with the note, its
author and its date", `lib/reconciliation/read.ts` and migration 0022) is not kept by the deployed
screen. On production today an explained break is indistinguishable from one that was never
reported. The route is live and any `staff_ops` user can reach it by a direct POST, so this is not
hypothetical.

**Disclosed.** The one note this review wrote is currently invisible on the deployed board. It is
not lost: the row is on file and readable through the database, it is shown again as soon as the
interface session's port lands, and the break returns to the list by itself the day a run reports
it with a different classification or amount.

**Required correction.** Land the interface port of the three panels and the form (the interface
session owns it), or, until then, do not write break notes on production.

### F-BP-03 (LOW): the README's reconciliation note describes a board the deployment does not yet have

**Where.** `README.md`, the reconciliation note: "The board separates the two: a probe is
classified as a probe and listed apart from the breaks to act on ... they are listed under 'Probe
payments from check runs' ... it moves to 'Explained breaks' with the note, its author and its
date."

**Observed.** None of those three headings exists on the deployed board, and no probe is
classified as one. Round 3 of the breaks-board review raised the same sentence as
F-BREAKSBOARD-14 (INFO) and said it needed "one word ('this build'), or nothing at all once the
slice is deployed". The slice is now deployed and the sentence is still not true of what a reader
can open. Raised from INFO to LOW for that reason: it is now a statement about a live URL that a
reviewer can check in one click.

**Required correction.** Either close F-BP-01 and F-BP-02, after which the sentence becomes true,
or qualify it until then.

### F-BP-04 (LOW): F-CORRECTIONSRULE24-02 reproduced on the deployed application

The correction preview prints "$60.57 to collect: with this difference, this policy carries
$1,160.54 of additional premium in this term, above $500.00". $60.57 is premium plus tax
(5918 + 139); $1,160.54 is premium only (110136 + 5918). The premium part of the difference,
$59.18, is on the screen just above but not in the sentence, so the sentence's own arithmetic
cannot be checked from the sentence. This is exactly F-CORRECTIONSRULE24-02, still OPEN, now
confirmed on production rather than on a check script. Recorded here so the register can mark it
"reproduced at `100ef41`"; the correction remains the one that record already asks for.

### F-BP-05 (INFO): `list_my_activity` was proved to return the caller's own rows, not to exclude another user's

The tool returned exactly the six MCP calls this review had made, in order, and the seventh (its
own) appeared afterwards. Read back as `app_runtime`, the trial database holds **nine** MCP
activity rows in total: those seven, all for `ops@example.com`, plus two `anonymous` rows from
2026-09-09T10:50Z with no user, which the tool correctly did not return. No second user has ever
called the endpoint on this database, so the cross-user half of the isolation rule is **not**
exercised on production; it was proved over HTTP on the disposable database by `check:mcp` in the
round-3 record. Minting a second key to prove it on production would be a write to
`mcp_api_keys` and was out of this review's authorisation.

### F-BP-06 (INFO): every run row carries `probe_count` NULL, and the MCP answer reads it as 0

`recentRuns` in the `list_reconciliation_breaks` answer reports `"probe": 0` for runs that
recorded nothing at all in that column, because the reader coalesces NULL to zero. Migration 0023
states that reading exactly and it is the right one, but a client cannot tell "this run classified
no probe" from "this run predates the column". Nothing behaves wrongly; it will stop mattering
after the first run under the deployed code.

## 5. Checks executed

Every command run once, against the deployed application at `100ef41` and the trial database.
Nothing was run against `corgi_test`.

| Check | Result |
|---|---|
| `GET /api/health`, before and after | `ok:true`, `database:"ok"`, revision `100ef41...` both times, 16:33:50Z and 16:42:28Z |
| `POST /api/session/login` x4 | 303 to `/ops`, `/ops`, `/broker`, `/customer` for ops, approver, broker, customer |
| `GET /inbox` as ops, before and after the note | 36 waiting, then 35; the reconciliation section lists exactly as many rows as the count |
| `GET /inbox` as approver and as broker | approver 35 waiting with the staff statements section; broker with "Your monthly statement", both empty |
| `GET /ops/reconciliation` and its four views | 36 open breaks then 35; tiles Stripe 36/35, claim rail 0; classification tile "provider only: 36" and no probe tile; the explained key in no view |
| `GET /policies/<CGP-01707>` and `<CGP-01274>`, plus `?view=money|endorsements|claims|timeline` on each | 200 x 10; all 24 figures of `integration.md` 4.1 present; zero disagreement alerts |
| `GET /policies/<CGP-01707>/corrections/new` with `endorsedEventId`, `correctedEffectiveAt=2026-09-20`, and a reason | 200; the running-total sentence quoted in the matrix. A first GET without a reason returned the one-sentence refusal "a correction needs a written reason of at least ten characters". No form was submitted |
| `GET /ops/mcp-keys` as approver, then as ops | 307 to `/ops`, then 200 |
| `GET /ops` as approver and as ops | 200 and 200; `mcp-keys` absent for the approver, six occurrences for the operator |
| `GET /ops/reconciliation` as broker | 307 to `/broker`, one sentence, no stack |
| `GET /policies/<zero uuid>` as ops | 404, no stack |
| `GET /` and `/login`, unauthenticated | 200 both, sandbox sentence on both |
| MCP `initialize`, `tools/list`, `list_reconciliation_breaks`, `explain_amount` x3, `list_my_activity`, `list_reconciliation_breaks` | 8 calls, all 200. Read tools only. `request_claim_payment` and `run_reconciliation` were **never** called |
| `POST /api/reconciliation/breaks/{key}/explain` as ops, **once** | 303 to the board with the `explained=` query and the anchor. One `activity_log` row, route `/api/reconciliation/breaks/[breakKey]/explain`, outcome ok, 303, actor `ops@example.com`, `message` null |
| Read-only SELECTs on the trial database as `app_runtime` | runs, items, notes, columns, triggers, grants, activity rows, the maker-checker function body |
| One UPDATE on `reconciliation_break_notes` as `app_runtime`, inside a rolled-back transaction | `permission denied for table reconciliation_break_notes`; one note row before and after |
| Secret and stack scan over the 34 artefacts captured | 0 secret shapes, 0 stack traces |
| `npm run check:money-guards` | **NOT RUN**, forbidden to this review. The standing evidence is the coordinator's: 200 of 200 on an ephemeral database migrated to 0025 at 16:30Z |
| Any check script on `corgi_test` | **NOT RUN**, the disposable database belongs to the interface session |

Schema read back from the trial database as `app_runtime`, which establishes that the four
migrations are applied there without reading `schema_migrations` (that table is not readable by
the runtime role: `permission denied`, measured):

- 0022: `reconciliation_break_notes` exists with `break_key`, `note`, `explained_by`,
  `recorded_at`; grants to the current user are `INSERT, SELECT` and nothing else; three triggers
  present.
- 0023: `reconciliation_runs.probe_count` exists and is nullable.
- 0024: `approval_requests.raised_through_key_id` exists and is nullable;
  `enforce_maker_checker_on_approval_decision` carries five `raise exception` lines and names
  `raised_through_key_id`.
- 0025: `explained_classification`, `explained_provider_amount_cents` and
  `explained_ledger_amount_cents` exist on the notes table and are all nullable.

## 6. What was not verified

- **The board after a reconciliation run.** This review was forbidden to run one, so the central
  claim of decision 28 is unverified on production and F-BP-01's expected outcome is a prediction.
- **Whether the 32 existing $42.42 PaymentIntents carry the probe marker or the `corgi_probe:`
  description.** That is a fact about objects at Stripe; no provider call was made.
- **The probe classification path itself.** No item with classification `probe` exists anywhere on
  the trial database, so `isProbeFromACheckRun` has never run against production data. Its unit
  tests and the disposable-database evidence are in the round-3 record.
- **The three board panels, the explain form, the superseded-note sentences.** They are not on the
  deployed page (the interface session owns the port), so nothing about their rendering was
  checked.
- **The monthly close itself.** Not triggered, by instruction. The two inbox sections were
  observed empty; the job has never produced a statement on production, and it cannot until
  2026-10-01. R8, R9 and the concurrency finding of the statements record stay unmeasured.
- **A customer key on `explain_amount`.** Only one key exists on production, a staff key. The
  refusal that closed the two HIGH findings of MCP round 2 is proved on the disposable database
  and by unit tests, not here.
- **Cross-user isolation of `list_my_activity`** (F-BP-05).
- **`check:money-guards` and every other check script**, by instruction.
- **The correction path beyond the preview.** Nothing was submitted, so the payment gate, the
  re-plan under the advisory lock and the recorded verdict were read and not exercised.
- **The four open LOW findings of the corrections record and the eight of the statements record**
  were not re-examined; this review confirms one of them (F-BP-04) and takes no position on the
  others.
- **Yoann's understanding.** Not established, and not establishable by a reviewer.

## 7. Verdict

**FAIL** at `100ef4124e1c3d8fcb9625211019f9bb35063a69`, for the scope of this production
confirmation.

Six of the seven items pass on the deployed application, and several pass with stronger evidence
than a branch review could give. The two MCP tools work over HTTP against the deployed URL for the
first time: seven tools with honest annotations, an explanation whose formula lines and journal
entry ids are byte-identical to the fold the policy page renders, an unknown key refused by the
transport without repeating what the caller sent, and an activity list holding exactly the caller's
own six calls. The key-creator layer is real in the deployed database, not only in a migration
file. The correction preview names the running total against the threshold, with arithmetic that
checks out. All 24 money figures of the integration review still agree at this revision, and no
explanation fold on the nine pages rendered printed a disagreement. The append-only guarantee of
the notes table holds under the runtime role, measured.

Item 1 fails, and it fails on the deployed state rather than in the reviewed code. The board still
counts 35 breaks of which 31 are probes, because no run has classified them since the deploy, and
the count is rising rather than falling. An explained break leaves the count and appears on no
screen, which is the honesty problem the slice was built to remove, reappearing one layer down.
Both are cheap: one reconciliation run, and the interface port that is already in flight. Neither
requires a code change to the reviewed slices. Until both are done, decision 28 must not be
described as delivered on production, and the README sentence that describes the board should not
be read as a statement about the deployed application.

Residual limitations: no reconciliation run, no check script, no `check:money-guards`, no browser
(HTML was fetched and parsed, not rendered), one key and one user on the MCP surface, and a single
observation window of twelve minutes.

**Walkthrough status: NOT REVIEWED WITH YOANN.** Nothing in this record establishes that he can
explain these lines. The question this review would put to him first is the one F-BP-01 turns on:
why deploying the probe rule changes nothing until a run has looked again, and why that is the
right design rather than a bug.

## 8. Register lines

For `docs/reviews/FINDINGS.md`, owned by the coordinator. This review does not edit that file.

| ID | Sev | Finding (one line) | Fix | Status |
|---|---|---|---|---|
| F-BP-01 | MED | On production the breaks board still counts the probes (35 to act on, 31 of them $42.42) because `probe` is a stored classification and no run has happened since the deploy; the count is rising, not falling | Run the reconciliation once under the deployed code, then re-read the board and the MCP tool before claiming decision 28 is delivered | OPEN |
| F-BP-02 | MED | An explained break appears in no view of the deployed board: the count drops from 36 to 35 and the note, the author and the break itself are invisible | Land the interface port of the probe, explained and form panels; until then do not write break notes on production | OPEN |
| F-BP-03 | LOW | The README reconciliation note describes three board headings that the deployed board does not have (raised from F-BREAKSBOARD-14 INFO now that the slice is deployed) | Close F-BP-01 and F-BP-02, or qualify the sentence | OPEN |
| F-BP-04 | LOW | F-CORRECTIONSRULE24-02 reproduced on production: "$60.57 to collect ... carries $1,160.54 of additional premium" puts a tax-included amount beside a premium-only running total | Name the premium part ($59.18) in the same sentence, as that record already asks | OPEN (reproduced at 100ef41) |
| F-BP-05 | INFO | `list_my_activity` was proved on production to return the caller's own rows only; no second user has ever called the endpoint there, so cross-user exclusion is proved on the disposable database and not here | None required; do not cite production as evidence of tenant isolation for this tool | OPEN, accepted |
| F-BP-06 | INFO | Every `reconciliation_runs` row carries `probe_count` NULL and the MCP answer reads it as 0, so a client cannot tell "no probe" from "predates the column" | None; it stops mattering after the first run under the deployed code | OPEN, accepted |
