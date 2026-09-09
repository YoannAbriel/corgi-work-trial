# Independent review: the honest breaks board, round 3

- **Feature:** the honest breaks board (probe classification, append-only break notes, and the round-3 correction of the ten findings of rounds 1 and 2).
- **Findings addressed:** F-YA-10, F-LS-01, F-LS-04 (original slice), F-BREAKSBOARD-01 to 06 (round 1, `docs/reviews/backend-breaks-board-r1.md`) and F-BREAKSBOARD-07 to 10 (round 2, `docs/reviews/backend-breaks-board-r2.md`).
- **Reviewer:** independent reviewer sub-agent, no part in the implementation.
- **Timestamp:** 2026-09-09T16:10Z (checks run between 15:35Z and 16:20Z).
- **Reviewed revision:** `48d6e63d81c617dbc9bf607468eb47a3feb04373` on `slice/breaks-board-fix-r3`, read as `git diff origin/main...48d6e63` (20 files, +1369 / -101) and, for the round-3 work alone, `git diff 268d23f 48d6e63` (9 files, +135 / -60). Reviewed from a detached worktree at that SHA; working tree clean apart from two throwaway inspection scripts, deleted before this record was committed. **No code was modified by this review.**
- **Verdict: PASS.** Both MEDIUM findings (F-BREAKSBOARD-01 and 07) are resolved and I reproduced both fixes live. The seven LOW findings are resolved; F-BREAKSBOARD-06 and 10 stay as accepted INFO. Five new findings, one LOW and four INFO, none blocking.
- **Walkthrough status: NOT REVIEWED WITH YOANN.**

## Startup receipt

Read in full, in this order: `CLAUDE.md`, `AUTOMATIC-FAILS.md`, `READABLE-CODE.md`, `AGENTS.md`, `REVIEWER.md`. Then the two prior records, `docs/reviews/backend-breaks-board-r1.md` (from `review/breaks-board-r1`, byte-identical to the copy now on `main`) and `docs/reviews/backend-breaks-board-r2.md` (same), and the `F-BREAKSBOARD-*` register lines of `docs/reviews/FINDINGS.md`, plus rules 28, 29 and 32 of `docs/DECISIONS.md`.

Code and SQL read at the reviewed SHA: `lib/reconciliation/read.ts` (whole file), `lib/reconciliation/break-notes.ts`, `diff.ts`, `run.ts`, `breaks.ts`; `lib/console/read.ts` (`openBreaksOfSubject` and its callers); `lib/mcp/tools/reconciliation-breaks.ts`; `lib/inbox/read.ts`, `tasks.ts`, `sections.ts` (the two consumers of the shared rule); `app/api/reconciliation/breaks/[breakKey]/explain/route.ts`; `app/api/jobs/daily/route.ts`; `app/ops/reconciliation/page.tsx`; `db/migrations/0011`, `0022`, `0023`, `0024_mcp_key_creator`, `0025`; `scripts/migrate.ts`, `scripts/check-reconciliation.ts`, `scripts/check-money-guards.ts`, `scripts/check-inbox-counts.ts`; `README.md`.

Absent or not read: nothing mandatory was missing. `WORKFLOW-48H.md` was read only for its checkpoint list, `READINESS-CHECKLIST.md` and `STRESS-TEST-PLAN.md` not at all (no performance evidence and no advisory control is in this scope).

Next acceptance criterion this review gates: the reconciliation break screen showing breaks and their age honestly (general brief, reconciliation section), with the two mechanisms of decision 28.

## Applicability

Sandbox-only engineering review of an internal operations screen, one append-only annotation table and the window computation of the daily job. No money moves anywhere in this slice.

- **AF-01** (accessible deployed URL): **NOT RUN.** Nothing on this branch is deployed and no server was started; out of scope for a branch review.
- **AF-02** (no simulation presented as live): **PASS in scope.** The board keeps its `Stripe: LIVE SANDBOX` and `claim payout rail: LOCAL SIMULATOR` chips, and the probe panel says in plain words that these payments are created by this project's own check script. The README no longer dates a claim about the deployed board; one residual wording point is finding F-BREAKSBOARD-14 (INFO).
- **AF-03** (never UPDATE or DELETE a money row): **PASS.** Every added line of `git diff origin/main...48d6e63` was grepped for `update `, `delete from`, `truncate `, `drop table`, `drop column` and `alter column`. The only matches are: the two guard triggers of migration 0022, comment text, and the two negative assertions of `check:reconciliation` that attempt an UPDATE and a DELETE as the runtime role and prove both are refused. Migration 0023 widens a CHECK (the shape 0007, 0009, 0010, 0014, 0018 and 0020 already use); migration 0025 adds three nullable columns and nothing else. No applied migration file was edited: 0022 and 0023 are byte-identical to the round-2 revision (`git diff 4cf3cc9 48d6e63 -- db/migrations/0022... 0023...` is empty), and the only migration touched in round 3 is the rename of the branch-only file, which is finding F-BREAKSBOARD-09 and is discussed below.
- **AF-04** (sandbox only): **PASS in scope.** `check:reconciliation` calls `assertStripeSandbox()` before creating its probe PaymentIntent, uses `pm_card_visa` and 4242 cents. No real person, no live key. My own run created one such test-mode PaymentIntent, disclosed below.
- **AF-05** (no committed secret): **PASS.** `gitleaks detect --no-git` over the whole `origin/main...48d6e63` diff (122.19 KB): no leaks found. `.env.local` was copied into this worktree to run the database checks, is covered by `.gitignore` (`git status` stayed clean with it present), was never printed and was deleted before this record was committed. My two inspection scripts read the connection string with `process.loadEnvFile` and printed only schema metadata and dates.
- **AF-06** (explainable line by line): **PASS with the standing reservation.** The reading path is short: one function for the probe rule, one file for the note rule, four exported SQL fragments in `lib/reconciliation/read.ts`. The part Yoann must be able to defend is now written out in full beside the code: why `oldestOpenBreakRecordDate` asks a wider question than `IT_IS_A_BREAK_TO_ACT_ON`. One comment still contradicts that decision, in the MCP tool, and that is finding F-BREAKSBOARD-11.

## Status of the ten findings of rounds 1 and 2, at this SHA

| ID | Severity | Status now | Evidence |
|---|---|---|---|
| F-BREAKSBOARD-01 | MEDIUM | **RESOLVED** (already at 4cf3cc9, unchanged here) | `THE_NOTE_EXPLAINS_THE_LATEST_REPORT` plus migration 0025. Live on my run: `a break explained while it is stale leaves the list to act on`, `a break a later run reports differently is WORK AGAIN, and leaves the explained list`, `the superseded note is still on file and shown beside the break it no longer explains` (note written against `stale`, row now `provider_only`) |
| F-BREAKSBOARD-02 | LOW | **RESOLVED** | `lib/console/read.ts` imports and uses `IT_IS_A_BREAK_TO_ACT_ON`, and the comment now names the shared rule and says why the reader changed. Proved live: see "The two mechanisms, proved live" below, where the same break is 1 row on the 360 reader before the note and 0 rows after it |
| F-BREAKSBOARD-03 | LOW | **RESOLVED** | `lib/reconciliation/diff.ts` now states the rule exactly (a record naming one of our money operations is never a probe; a record naming none is a probe only with the check-run marker or with the planted amount AND the `corgi_probe:` description) and states the residual in its own paragraph (a real payment of exactly that amount with a forged description would be classified as a probe), with the reason probes stay listed under their own heading rather than dropped. The code matches the comment line by line |
| F-BREAKSBOARD-04 | LOW | **RESOLVED**, with an INFO residual | `Since 2026-09-09 the board says which is which` is gone; the sentence now describes the mechanism, and the window sentence at the end of the paragraph was corrected the same way. Residual wording: F-BREAKSBOARD-14 |
| F-BREAKSBOARD-05 | LOW | **RESOLVED** | `checkPolicyIds` is declared once beside the three policies and both journal assertions use `journalEntryCountForPolicies`; the global `journalEntryCount()` helper is deleted (grep: no caller left). Live: `a run posts no money and no journal entry ... (14 journal entries on this check's policies before the run, 14 after)` |
| F-BREAKSBOARD-06 | INFO | **STILL OPEN, accepted** as in rounds 1 and 2 | The `?explained=` notice is still printed from the query string alone. No state changes and React escapes the value |
| F-BREAKSBOARD-07 | MEDIUM | **RESOLVED** | `oldestOpenBreakRecordDate` is back to `not A_LATER_RUN_RE_EXAMINED_IT`, with a comment that says why the two questions differ (the desk of today versus how far back one run must look, since looking is what un-explains a break). **Proved live**, which round 2 could not do: see below |
| F-BREAKSBOARD-08 | LOW | **RESOLVED** | `app/ops/reconciliation/page.tsx` branches on `explainedClassification`: a stored classification prints "Explained before, and changed since."; a null one prints "Explained before this build recorded what was explained" and says the note predates the columns and the break needs explaining again as it stands today. The lateral that feeds it takes the LATEST note, and a note written after 0025 always records a classification, so a null value can only be a pre-0025 note: the branch cannot mislabel |
| F-BREAKSBOARD-09 | LOW | **RESOLVED** | The file is `db/migrations/0025_break_notes_say_what_they_explain.sql`; `ls db/migrations` shows 25 files and no repeated number; every statement is `add column if not exists`; the header says why the number changed and why the statements are idempotent. `npm run migrate -- --database=test` on my run: all 25 skipped, nothing applied, which is what the builder's "already applied under the new name" means. 0022 and 0023 untouched |
| F-BREAKSBOARD-10 | INFO | **ADDRESSED IN CODE, NOT EXECUTED** | The fixture of `scripts/check-money-guards.ts` now writes the three columns of 0025 with the same classification and the same two amounts as the reconciliation item beside it. `check:money-guards` is forbidden to me and was not run, so the guard proof over the real row shape is still unexecuted. The guard loop itself updates `id`, so the two amount columns are still not named in an UPDATE the way `brokers.commission_rate_bps` is at step 2b; that was not asked for and is not required |

## The two mechanisms, proved live

Round 2 recorded that F-BREAKSBOARD-07 could only be proved on an empty database with a controlled clock. It can be proved on the shared one, inside a transaction that is rolled back, and I did that rather than accept the fix by reading. The fixture: one complete `stripe` run whose window is 2020-01-01 to 2020-01-03, one `provider_only` item it reported with `record_at` 2020-01-02, then one break note explaining exactly that report. Everything inside `database.begin` and rolled back by throwing at the end.

```
oldestOpenBreakRecordDate on the database as it stands: 2026-09-08T08:50:13.000Z
countOpenBreaks unexplained / explained: 1647 / 1646
360 page rows unexplained / explained  : 1 / 0
with the old break unexplained: 2020-01-02T00:00:00.000Z
with the old break EXPLAINED  : 2020-01-02T00:00:00.000Z
transaction rolled back on purpose
oldestOpenBreakRecordDate after the rollback: 2026-09-08T08:50:13.000Z
fixture rows left behind: 0
```

Read line by line, that is the whole of what rounds 1 to 3 were about:

- the daily job's window still reaches 2020-01-02 **after** the break is explained, which is F-BREAKSBOARD-07 fixed. At 4cf3cc9 that line would have read 2026-09-08, the window would have been the seven-day default, and no later run could ever have re-examined the record;
- `countOpenBreaks` drops by exactly one when the note is written, so the badge, the inbox and the MCP tool keep the narrow question;
- `openBreaksOfSubject` returns the row before the note and no row after it, which is F-BREAKSBOARD-02 fixed, and it also proves the query runs: the fragment inserts a subquery aliased `note` into a select list that already has a column called `note`, and Postgres resolves it without ambiguity;
- nothing was left behind.

I also read back the shape of `reconciliation_break_notes` on `corgi_test`: the three columns of 0025 are present and nullable, the `explained_classification` CHECK lists exactly the five non-matched classifications, `app_runtime` holds `INSERT, SELECT` and nothing else, and the three triggers of 0022 (`..._are_append_only`, `..._cannot_be_truncated`, `..._recorded_at_is_server_set`) are in place.

## Requirement matrix

| # | Requirement | Control / code location | Evidence | Verdict |
|---|---|---|---|---|
| 1 | The window question and the desk question are two different questions, each asked once, with the reason written beside them | `oldestOpenBreakRecordDate` (wide) and `IT_IS_A_BREAK_TO_ACT_ON` (narrow), `lib/reconciliation/read.ts` | Rolled-back fixture above; the comment states the reason and points at `resolvedBreaks`, which already used the wide rule for `open_report` | PASS |
| 2 | The count, the badge, the inbox, the board and the MCP tool keep the narrow rule | `countOpenBreaks`, `openBreaks`, `openBreaksPage`, `lib/inbox/tasks.ts`, `lib/inbox/read.ts`, `lib/mcp/tools/reconciliation-breaks.ts` | grep of every caller; `check:reconciliation` assertions; `check:inbox-counts` anchors | PASS, with finding F-BREAKSBOARD-11 on one comment |
| 3 | The 360 page asks the board's question | `openBreaksOfSubject`, `lib/console/read.ts` | rolled-back fixture, 1 row then 0 | PASS |
| 4 | The probe rule states what it guarantees and what it does not | `lib/reconciliation/diff.ts` | comment compared with `isProbeFromACheckRun` clause by clause; the operation-id guard is still the first and unconditional test | PASS |
| 5 | The README describes the mechanism, not the deployment | `README.md` reconciliation note | read; the dated deployment claim is gone and the window sentence is now the wide rule | PASS, with INFO F-BREAKSBOARD-14 |
| 6 | `check:reconciliation` asserts about its own policies | `checkPolicyIds` and `journalEntryCountForPolicies` | live: 14 before, 14 after; 20 before the note, 20 after | PASS |
| 7 | A reopened row says which of the two things happened | `BreakTable`'s `supersededExplanation` branch | read; the lateral takes the latest note, and only a pre-0025 note can carry a null classification | PASS, with INFO F-BREAKSBOARD-12 |
| 8 | One migration per number; the renamed file applies to `corgi_test` as a no-op | `0025_break_notes_say_what_they_explain.sql`, `scripts/migrate.ts` | `ls db/migrations`, 25 files, no repeat; migrate run: 25 skips; schema read-back | PASS |
| 9 | The guard fixture writes the real row shape | `scripts/check-money-guards.ts` | code read; **not executed** (forbidden to me) | PASS on the code, NOT RUN as proof |
| 10 | Only staff operations can explain a break, and the note bounds are enforced twice | `lib/reconciliation/break-notes.ts` (allowlist of one role, trim then measure), CHECK of 0022 | live assertions: wrong role refused, note too short refused, unknown break key refused | PASS |
| 11 | Explaining repairs nothing | one INSERT, no provider call | live: `explaining a break repairs nothing` (20 to 20 journal entries on this check's policies, 3 items still on file) | PASS |
| 12 | The runtime role cannot rewrite or erase a note | grants of 0022 | live: `permission denied for table reconciliation_break_notes` on UPDATE and on DELETE | PASS |
| 13 | The three board lists stay disjoint after the round-3 changes | `openBreaksPage` / `probesPage` / `explainedBreaksPage` | predicates re-checked by hand: `not re-examined` is partitioned into (probe and not explained), (explained), (neither) | PASS |

## New findings

Numbering continues from round 2, which ended at F-BREAKSBOARD-10.

### F-BREAKSBOARD-11 (LOW): the MCP tool's comment still says the daily job asks the same question, which is the opposite of the decision this round made

**Where.** `lib/mcp/tools/reconciliation-breaks.ts`, the comment above the tool: "It reads openBreaks, the same reader the inbox and the daily job use, so a probe planted by our own check script and a break somebody has explained are out of it for the same reason and by the same rule."

**Why it is wrong now.** The daily job does not read `openBreaks` and never did: it reads `oldestOpenBreakRecordDate` (`app/api/jobs/daily/route.ts` through `windowCoveringOpenBreaks`), and after this round that reader deliberately asks the wider question. A probe and an explained break are exactly what the daily job's question now includes. Verified by grep: the only callers of `openBreaks` are the inbox, this tool and the check script.

**Consequence.** A reader of the MCP surface, which is the file an agent-facing reviewer opens first, is told the daily job excludes probes and explained breaks. That is the belief round 2 recorded as the MEDIUM finding, restated in the one file the round-3 comment sweep did not reach. Nothing behaves wrongly; a comment that contradicts the decision beside the code is the failure mode AF-06 is about.

**Required correction.** Say that this tool asks the same question as the count and the inbox, and that the daily job's window asks the wider one, pointing at `oldestOpenBreakRecordDate` as the other three corrected comments already do.

### F-BREAKSBOARD-12 (INFO): "changed since" prints the same classification twice when only the amounts moved

**Where.** `app/ops/reconciliation/page.tsx`, the non-null branch of `supersededExplanation`.

**Trigger.** A note is written against `amount_mismatch` with a provider amount of 4242; a later run reports the same key as `amount_mismatch` with 5000. `THE_NOTE_EXPLAINS_THE_LATEST_REPORT` fails on the amount, so the break is correctly work again, and the row prints "when the run reported this break as amount mismatch. The latest run reports it as amount mismatch, so it is work again."

**Consequence.** The operator reads the same words twice and is told nothing changed in the only field the sentence names, while the thing that changed (one of the two amounts recorded on the note) is never shown: the table's amount columns carry the CURRENT amounts, not the explained ones. Cosmetic and honest in substance, so INFO.

**Suggested correction, if the panel is revisited.** Carry `explained_provider_amount_cents` and `explained_ledger_amount_cents` on the row and name the amount that moved, or word the heading "Explained before, and the report has changed since" without repeating the classification when it is unchanged.

### F-BREAKSBOARD-13 (INFO): the window assertion of `check:reconciliation` passes identically with and without the bug it is quoted for

**Where.** `scripts/check-reconciliation.ts`, `the scheduled window opens backwards far enough to cover the oldest open break`.

**Observed.** On my run: `oldest open break at 2026-09-08T08:50:13.000Z, window from 2026-09-02T15:49:14.791Z, reaches it: true`. The oldest reported break on `corgi_test` is inside the seven-day default window, so the widening is never exercised and the assertion holds whichever rule `oldestOpenBreakRecordDate` uses. It would have passed the same way at 4cf3cc9, where F-BREAKSBOARD-07 was open. The assertion is not dead (it fails when the oldest break is older than the 31-day cap), it simply does not separate the two rules.

**Consequence.** None for the build; it matters for the evidence trail. The builder cited this assertion as verification of F-BREAKSBOARD-07 and disclosed the limit honestly. The evidence that actually separates the two rules is the rolled-back fixture recorded above.

**Suggested correction, if the check is revisited.** Assert on a break this check owns and has explained: after the note, `oldestOpenBreakRecordDate` must still return that break's record date.

### F-BREAKSBOARD-14 (INFO): the corrected README sentence sits where it can still be read as a claim about the deployed board

**Where.** `README.md`, reconciliation note: "the open breaks on the deployed application were sandbox probe payments ... The board separates the two: a probe is classified as a probe and listed apart from the breaks to act on."

**Consequence.** The dated claim is gone, which is what F-BREAKSBOARD-04 asked for, and the sentence describes the mechanism. But it follows a sentence whose subject is the deployed application, so a reader can still take it as a statement about what is deployed today; migrations 0022, 0023 and 0025 are on `corgi_test` only and this branch is not merged. Worth one word ("this build separates the two") when the paragraph is next touched, or nothing at all once the slice is deployed.

### F-BREAKSBOARD-15 (INFO, coordinator): decision 32 names migration 0023 for the rate-table guards, which is this branch's probe classification

**Where.** `docs/DECISIONS.md`, rule 32: "Guards on the rate tables (migration 0023) built now too." On `main` the migrations jump from `0021_activity_log.sql` to `0024_mcp_key_creator.sql`; `0022` and `0023` are this branch's files.

**Consequence.** No collision exists today: `git log --all --diff-filter=A -- 'db/migrations/002*.sql'` shows exactly one commit adding each of 0022, 0023, 0024 and the renamed 0025, and no branch in this repository holds a rate-guard migration. But the decision record points a future reader at a number that means something else, which is the same class of problem F-BREAKSBOARD-09 corrected. The coordinator owns `docs/DECISIONS.md`; recorded here so the merge does not inherit the ambiguity silently.

## Checks actually executed

All on the shared disposable database `corgi_test`, each **once**, one at a time, from the review worktree at `48d6e63`. `npm ci` first (the worktree had no `node_modules`).

| Command | Result |
|---|---|
| `npm run typecheck` | **PASS**, no output |
| `npm test` | **PASS**: 484 tests, 483 passed, 1 skipped, 0 failed, 2 suites. Matches the builder's report exactly |
| `npm run migrate -- --database=test` | **PASS**: all 25 files skipped, nothing applied, one expected `relation "schema_migrations" already exists, skipping` notice. This is the read-back the builder described: `0025_break_notes_say_what_they_explain.sql` is already recorded, so the renamed file is a no-op |
| `npm run check:reconciliation` | **PASS: 54 assertions, 54 PASS, 0 FAIL**, final line `ALL CHECKS PASSED`. Whole transcript captured, not a tail. The assertions of this slice all pass, including the three of F-BREAKSBOARD-01, `a probe is NOT a break to act on` (1653 breaks to act on, the probe is not one), `the amount this script plants is the amount the probe rule knows`, the two runtime-role refusals on `reconciliation_break_notes`, and the narrowed `a run posts no money and no journal entry` (14 on this check's policies before, 14 after). Planted and left open on purpose by this run: rail transfer `sim_tr_planted_1788968867573` and Stripe sandbox PaymentIntent `pi_3UDnkbK6R3v50tIy06l6snib` (4242 cents, test card, sandbox asserted before creation) |
| `npm run check:inbox-counts` | see the paragraph below the table |
| `gitleaks detect --no-git` over `git diff origin/main...48d6e63` | **no leaks found**, 122.19 KB scanned |
| Rolled-back fixture on `corgi_test` (`oldestOpenBreakRecordDate`, `countOpenBreaks`, `openBreaksOfSubject` with and without a note) | **PASS**, output quoted above, 0 rows left behind |
| Schema read-back of `reconciliation_break_notes` on `corgi_test` (columns, CHECKs, grants, triggers, `schema_migrations`) | as recorded above. Both `0024_break_notes_say_what_they_explain.sql` (the old name) and `0025_break_notes_say_what_they_explain.sql` are listed in `schema_migrations`, which is the disposable-database artefact the 0025 header predicts and discloses. A fresh database gets the columns once, under the new name only |
| `npm run check:money-guards` | **NOT RUN**, as instructed. Reserved for the coordinator on an ephemeral database |

`check:inbox-counts`: **PASS, 53 assertions, 53 PASS, 0 FAIL**, final line `All inbox count checks passed`, exit code 0. Whole transcript captured. The two staff inboxes are the ones this slice can move, and both agree anchor by anchor: `staff_ops` 2042 counted and 2042 listed (`#approvals 214/214, #policies 22/22, #endorsements 51/51, #claims 78/78, #reconciliation 1652/1652, #statements 25/25`), `staff_approver` 1969 counted and 1969 listed (`#approvals 214/214, #claims 78/78, #reconciliation 1652/1652, #statements 25/25`). 50 of 1210 brokers and customers compared, plus one user of each staff role.

**The builder's reported failure did not reproduce.** The builder recorded `1 check(s) failed`, on `staff_ops` with `#claims 75/76`, and attributed it to another agent committing a claim between the two reads that the assertion compares. My run, on the same shared database roughly forty minutes later, read `#claims 78/78` and passed. That is consistent with the builder's explanation and inconsistent with a defect: nothing in this slice touches the claims inbox, the reconciliation anchor agreed exactly in both runs, and the check writes nothing. Run once, not repeated.

## What was not verified

- **`check:money-guards` was not run** (forbidden to me). F-BREAKSBOARD-10 is therefore addressed in code and unproven by execution: the owner-level UPDATE, DELETE and TRUNCATE guards over a note row carrying the three columns of 0025 rest on reading the migration and on the triggers existing in `corgi_test`. The runtime half is proved live by `check:reconciliation`.
- **Nothing was deployed and nothing was exercised over HTTP.** The explain route was reviewed by reading; `explainBreak` was exercised directly by `check:reconciliation`, which does not go through `withActivity`, the session cookie or the 303 redirect. The role refusal is proved at the function, not at the route. No server was started and no port was used.
- **No screen was rendered.** The board's three panels, the two superseded-note sentences, the cap sentences and the form were read as source only; another session is rebuilding the interface, so nothing there was touched.
- **The 28 open breaks of the deployed application were not observed.** Production was not inspected. Their reclassification as probes still follows from the code and from `main:scripts/check-reconciliation.ts` having always sent the `corgi_probe:` description, and still requires a run whose window covers their creation dates, which is exactly what the restored wide window rule now makes possible.
- **Every absolute count in this record is shared-database noise.** `corgi_test` held about 1650 open breaks and moved by roughly twenty of them while my checks ran. The slice's own assertions key on this check's own uuids and policies, so they are unaffected; the totals must not be read as properties of the build.
- **No legal or regulatory question is in scope.** No money moves, no provider call is added, no personal data is touched, so no US requirement changes with this slice. This record is an engineering assessment, not a compliance statement.
- **The other worktree the builder flagged** (`worktree-wf_46bb3e09-77f-1-fix-r3`, tip `f38dcd5`) was not inspected: it is checked out by another worktree and I am isolated from it. The coordinator still owns the decision of whether it is a duplicate run before merging either.

## Verdict

**PASS.** Both MEDIUM findings are closed and I reproduced both closures live rather than accepting them by reading: the daily job's window still reaches an explained break dated 2020, and the same break leaves the count, the board and the policy 360 page the moment a note is written. The seven LOW findings are genuinely fixed, the migration numbering collision is resolved without editing an applied file, and the three comments that overstated in rounds 1 and 2 now state the rule and its residual exactly.

Five new findings, none blocking: one LOW comment in the MCP tool that still contradicts the round-3 decision (F-BREAKSBOARD-11), and four INFO points, on a screen sentence, an assertion's discriminating power, a README wording residual and a decision-record numbering residual. F-BREAKSBOARD-06 and 10 remain as accepted INFO from the earlier rounds, and F-BREAKSBOARD-10 stays unproven by execution until the coordinator runs `check:money-guards` on an ephemeral database.

Residual limitations: no deployment, no browser, no HTTP, no `check:money-guards`, and a database shared with other agents throughout.

**Walkthrough status: NOT REVIEWED WITH YOANN.** Nothing in this review establishes that Yoann can explain these lines. The one place where an explanation is genuinely required of him is why two readers of the same table ask two different questions, which is now written out in `lib/reconciliation/read.ts` above `oldestOpenBreakRecordDate`.

## Register lines

| ID | Severity | Finding | Correction | Status |
|---|---|---|---|---|
| F-BREAKSBOARD-01 | MEDIUM | A note was keyed on `break_key` alone and never expired | Migration 0025 records the classification and both amounts of the report the note explains | RESOLVED at 48d6e63, verified live |
| F-BREAKSBOARD-02 | LOW | The 360 page asked a different question from the board | `openBreaksOfSubject` uses the shared `IT_IS_A_BREAK_TO_ACT_ON` | RESOLVED at 48d6e63, verified live |
| F-BREAKSBOARD-03 | LOW | The probe rule's comment claimed more safety than the rule gives | The comment states the rule exactly and its residual, and says why probes stay listed | RESOLVED at 48d6e63 |
| F-BREAKSBOARD-04 | LOW | The README stated as deployed fact something true only of the code | The dated claim is gone; the paragraph describes the mechanism | RESOLVED at 48d6e63; wording residual as F-BREAKSBOARD-14 |
| F-BREAKSBOARD-05 | LOW | A global journal-entry assertion was contention-sensitive | Scoped to `checkPolicyIds`; the global helper is deleted | RESOLVED at 48d6e63, verified live |
| F-BREAKSBOARD-06 | INFO | The `?explained=` notice is printed from the query string alone | One line if the panel is revisited | OPEN, accepted |
| F-BREAKSBOARD-07 | MEDIUM | The daily job stopped widening its window to explained breaks, so the re-open mechanism could never fire | `oldestOpenBreakRecordDate` is back to the wide rule, with the two questions distinguished in a comment | RESOLVED at 48d6e63, verified live with a rolled-back fixture |
| F-BREAKSBOARD-08 | LOW | A reopened row said "changed since" even when the note predated the columns | The heading branches on a null stored classification | RESOLVED at 48d6e63 |
| F-BREAKSBOARD-09 | LOW | Two migrations numbered 0024 | Renamed to 0025, idempotent statements, reason in the header; 0022 and 0023 untouched | RESOLVED at 48d6e63, verified by a migrate run and a schema read-back |
| F-BREAKSBOARD-10 | INFO | The guard fixture never wrote the three new columns | The fixture writes them with the item's own classification and amounts | ADDRESSED IN CODE; unproven until the coordinator runs `check:money-guards` |
| F-BREAKSBOARD-11 | LOW | The MCP tool's comment says the daily job reads `openBreaks` and excludes probes and explained breaks; it reads `oldestOpenBreakRecordDate`, which deliberately includes them | Reword to name the two questions, as the three other comments now do | OPEN |
| F-BREAKSBOARD-12 | INFO | "Explained before, and changed since" prints the same classification twice when only an amount moved, and never shows the amounts the note recorded | Name the amount that moved, or reword the heading | OPEN, accepted |
| F-BREAKSBOARD-13 | INFO | The window assertion passes identically with and without the F-BREAKSBOARD-07 bug on a database whose oldest break is inside the default window | Assert on a break this check owns and has explained | OPEN, accepted |
| F-BREAKSBOARD-14 | INFO | The corrected README sentence follows a sentence about the deployed application | One word ("this build"), or nothing once the slice is deployed | OPEN, accepted |
| F-BREAKSBOARD-15 | INFO | `docs/DECISIONS.md` rule 32 names migration 0023 for the rate-table guards; 0023 is the probe classification | Coordinator: correct the decision text or the future file name | OPEN, coordinator |
