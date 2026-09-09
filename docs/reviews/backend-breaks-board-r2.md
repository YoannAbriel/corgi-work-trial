# Independent review: the honest breaks board, round 2

- **Feature:** the honest breaks board (probe classification, append-only break notes, and the round-2 correction of F-BREAKSBOARD-01).
- **Findings addressed:** F-YA-10, F-LS-01, F-LS-04 (original slice), and the six findings of round 1 recorded in `docs/reviews/backend-breaks-board-r1.md` on branch `review/breaks-board-r1`.
- **Reviewer:** independent reviewer sub-agent, no part in the implementation.
- **Timestamp:** 2026-09-09T15:00Z (checks run between 14:45Z and 15:03Z).
- **Reviewed revision:** `4cf3cc9d5144fdeef633f97a5197f1c3f8dca593` on `worktree-wf_46bb3e09-77f-1-fix`, read as `git diff main...4cf3cc9`. Working tree clean at review time; no code was modified by this review.
- **Verdict: FAIL**, on one MEDIUM finding (F-BREAKSBOARD-07). Round 1's MEDIUM, F-BREAKSBOARD-01, is resolved and verified; four LOW findings of round 1 are still open.
- **Walkthrough status: NOT REVIEWED WITH YOANN.**

## Startup receipt

Read in full, in this order: `CLAUDE.md`, `AUTOMATIC-FAILS.md`, `READABLE-CODE.md`, `AGENTS.md`, `REVIEWER.md`. Then the round-1 record `docs/reviews/backend-breaks-board-r1.md` (from branch `review/breaks-board-r1`) and the register lines of `docs/reviews/FINDINGS.md` for F-YA-10, F-LS-01 and F-LS-04.

Code and SQL read at the reviewed SHA: `db/migrations/0022_reconciliation_break_notes.sql`, `0023_reconciliation_probe_classification.sql`, `0024_break_notes_say_what_they_explain.sql`, and for the guard shape `0001_ledger_core_and_webhook_inbox.sql`, `0004_truncate_guards_for_policy_and_money_tables.sql`, `0011_reconciliation.sql`, `0018_mcp_api_keys.sql`, `0019_policy_change_requests.sql`; `lib/reconciliation/read.ts` (whole file), `lib/reconciliation/break-notes.ts`, `lib/reconciliation/diff.ts`, `lib/reconciliation/diff.test.ts`, `lib/reconciliation/run.ts`, `lib/reconciliation/breaks.ts`, `lib/reconciliation/stripe-records.ts`, `lib/reconciliation/claims-rail-source.ts`, `lib/reconciliation/window.ts`, `lib/mcp/tools/reconciliation-breaks.ts`, `lib/observability/log.ts`, `lib/money/cents.ts`, `lib/console/read.ts` (`openBreaksOfSubject`), `app/api/reconciliation/breaks/[breakKey]/explain/route.ts`, `app/api/jobs/reconcile/route.ts`, `app/api/jobs/daily/route.ts`, `app/ops/reconciliation/page.tsx`, `scripts/check-reconciliation.ts`, `scripts/check-money-guards.ts`, `README.md`.

Absent: no `docs/reviews/backend-breaks-board*.md` exists on `main`; the round-1 record lives only on the unmerged branch `review/breaks-board-r1` and was read from there.

Next acceptance criterion for this scope: F-BREAKSBOARD-07 corrected, then a re-review of the corrected diff.

## Applicability

Sandbox-only engineering review of an internal operations screen and its append-only annotation table. Money paths touched: none. Nothing here posts, moves, reverses or repairs money; the only write the slice adds is one INSERT into `reconciliation_break_notes`.

- **AF-01** (deployed URL): NOT RUN, out of scope for a branch review; the slice is not deployed.
- **AF-02** (no simulation presented as live): PASS in scope. The board keeps its `Stripe: LIVE SANDBOX` / `claim payout rail: LOCAL SIMULATOR` chips; the probe panel states in plain words that these payments are created by this project's own check script. The README paragraph carries one tense problem, F-BREAKSBOARD-04, still open.
- **AF-03** (never UPDATE or DELETE a money row): PASS. Grepping every added line of the branch diff for `update `, `delete from` and `truncate ` finds only: the two guard triggers of migration 0022, comment text, and the two negative assertions of `check:reconciliation` that attempt an UPDATE and a DELETE as the runtime role and prove both are refused. Migration 0023 drops and re-adds a CHECK constraint on `reconciliation_items`; that is a constraint widening, writes no row and redefines no column, and it is the shape migrations 0007, 0009, 0010, 0014, 0018 and 0020 already used (verified with `grep -n "drop constraint" db/migrations/*.sql`). Migration 0024 adds three nullable columns only. No applied migration file was edited (0022's SQL is byte-identical to what was applied; the correction is written in 0024's header and in `lib/reconciliation/break-notes.ts`).
- **AF-04** (sandbox only): PASS in scope. `check:reconciliation` calls `assertStripeSandbox()` before creating its probe PaymentIntent, uses `pm_card_visa` and 4242 cents. No real person and no live key.
- **AF-05** (no committed secret): PASS. `gitleaks detect --no-git` over the full `main...4cf3cc9` diff (110.91 KB): no leaks found. No connection string was printed by any command I ran. My own inspection script used `process.loadEnvFile` and printed only schema metadata; it was deleted before the review commit.
- **AF-06** (explainable line by line): PASS with a reservation. `break-notes.ts` is 111 lines with the rule and its reasons beside it; `THE_NOTE_EXPLAINS_THE_LATEST_REPORT` is three lines of SQL. The one part that needs Yoann to be able to defend it is the interaction between `IT_IS_A_BREAK_TO_ACT_ON` and the daily job's window, which is exactly F-BREAKSBOARD-07.

## Requirement matrix

| # | Requirement | Control / code location | Evidence | Verdict |
|---|---|---|---|---|
| 1 | A sixth classification `probe`, one explicit function with its reason | `isProbeFromACheckRun`, `lib/reconciliation/diff.ts`; `CLASSIFICATIONS` in `breaks.ts`; CHECK widened by migration 0023 | 5 unit tests in `diff.test.ts`; live assertion `THE PLANTED SANDBOX PAYMENT IS FOUND, and it is classified as the probe it is` (`pi_3UDmmGK6R3v50tIy1644vwL5`) | PASS |
| 2 | Probe requires no operation id, then marker OR (planted amount AND description) | `isProbeFromACheckRun` returns false first when `operationId !== null` | test `a record naming an operation is never a probe, whatever its metadata says` | PASS |
| 3 | The check script sets the metadata marker on what it plants | `scripts/check-reconciliation.ts`, `metadata: { probe: PROBE_METADATA_MARKER }` plus `PROBE_DESCRIPTION_PREFIX` | assertion `the amount this script plants is the amount the probe rule knows` | PASS |
| 4 | Probes listed under their own heading with the explaining sentence, counted separately, out of the count, the inbox and the tasks | `probesPage` + `IT_IS_A_PROBE_FROM_A_CHECK_RUN` in `read.ts`; `Probe payments from check runs` panel; `countOpenBreaks` feeds `lib/inbox/tasks.ts`, `openBreaks` feeds `lib/inbox/read.ts` and the MCP tool | assertions `a probe is NOT a break to act on` and `a probe is listed under its own heading` | PASS |
| 5 | The run summary counts probes separately | `describe()` in `app/api/jobs/reconcile/route.ts`; `RunRow` in the board; `probe_count` column (0023, nullable, NULL read as 0) | assertion `the run counts probes on their own line` | PASS |
| 6 | Migration 0022: append-only table, same guards as the money tables for every role, runtime SELECT and INSERT only | `db/migrations/0022_reconciliation_break_notes.sql` | read back on `corgi_test`: triggers `..._are_append_only`, `..._cannot_be_truncated`, `..._recorded_at_is_server_set`; `app_runtime` grants exactly `INSERT, SELECT` | PASS |
| 7 | The table is in the protected list of `check-money-guards` | `PROTECTED_TABLES` in `scripts/check-money-guards.ts` plus a fixture row | code read only; the script is the coordinator's to run on an ephemeral database | PASS (not executed) |
| 8 | POST route, staff_ops only, session cookie, `withActivity`, outcome in the redirect query | `app/api/reconciliation/breaks/[breakKey]/explain/route.ts`, rule `"break note"` added to `ActivityRule` | assertions `a user who is not staff operations cannot explain a break`, `a note on a break no run has ever reported is refused`, `a note shorter than the minimum is refused` | PASS |
| 9 | A minimal form on the board row | `ExplainForm` in `app/ops/reconciliation/page.tsx`, one textarea and one button | code read | PASS |
| 10 | An explained break stays listed with its note, author and date, and leaves the count and the inbox | `explainedBreaksPage` + `SOMEBODY_HAS_EXPLAINED_IT` | assertions `an explained break leaves the list to act on and the count the inbox reads` (1612 to 1611) and `an explained break stays listed, with its note, who wrote it and when` | PASS |
| 11 | Explaining repairs nothing | `break-notes.ts` inserts one row and nothing else | assertion `explaining a break repairs nothing: no journal entry, and the break's items are all still on file` (20 to 20 on this check's policies, 3 items still on file) | PASS |
| 12 | F-LS-01: the board reads the bounded `openBreaksPage` and prints the cap sentence | `openBreaksPage` + the three `capped` sentences on the board | code read; `HOW_MANY_BREAKS_SHOWN = 50` with `totalOpen` counted by the same rule | PASS |
| 13 | F-LS-04: the resolved annotation names or counts every shared open break | `resolvedBreaks`, `string_agg` with no limit, `open_count` | code read; the previous `order by ... limit 1` is gone | PASS |
| 14 | F-BREAKSBOARD-01: a note explains the report it was written against | migration 0024, `THE_NOTE_EXPLAINS_THE_LATEST_REPORT`, `explainBreak` reading `LATEST_REPORT_OF_EACH_BREAK` | assertions `a break explained while it is stale leaves the list to act on`, `a break a later run reports differently is WORK AGAIN, and leaves the explained list`, `the superseded note is still on file and shown beside the break it no longer explains` | PASS |
| 15 | The three board lists are disjoint | `IT_IS_A_BREAK_TO_ACT_ON` / probes with `not SOMEBODY_HAS_EXPLAINED_IT` / explained with an inner lateral join on the same predicate | predicate algebra checked by hand: the three where-clauses partition the rows that `not A_LATER_RUN_RE_EXAMINED_IT` selects | PASS |
| 16 | The re-open mechanism reaches the count, the inbox, the MCP tool, `oldestOpenBreakRecordDate` and the daily job's window | `IT_IS_A_BREAK_TO_ACT_ON` used by all five readers | the first four hold; the daily job's window does not, see F-BREAKSBOARD-07 | **FAIL** |
| 17 | README: one paragraph on what a probe is and what explaining does and does not do | `README.md`, reconciliation note | read; accurate except for the deployment tense (F-BREAKSBOARD-04) and the window claim (F-BREAKSBOARD-07) | PARTIAL |

## Status of the round-1 findings at this SHA

| ID | Round-1 severity | Status now | Evidence |
|---|---|---|---|
| F-BREAKSBOARD-01 | MEDIUM | **RESOLVED** | Migration 0024 plus `THE_NOTE_EXPLAINS_THE_LATEST_REPORT`; three new live assertions, all passing on my own run |
| F-BREAKSBOARD-02 | LOW | **STILL OPEN, and wider than it was** | `openBreaksOfSubject` (`lib/console/read.ts:2612`) still filters on `not A_LATER_RUN_RE_EXAMINED_IT` alone, while the shared comment at `lib/reconciliation/read.ts:138-141` still says the console "must ask the same question this screen asks". The gap grew: the board's question now also excludes probes and explained breaks, so a 360 page shows as "open breaks" rows the board counts as zero, and shows them without the note that explains them |
| F-BREAKSBOARD-03 | LOW | **STILL OPEN** | `lib/reconciliation/diff.ts` still says "no forged marker can turn a real break into a line the board stops counting". A provider-only record with no operation id and a forged `probe=check-reconciliation` marker is classified `probe` and leaves the count. The guarantee the code actually gives is narrower: a record naming one of our operations is never a probe |
| F-BREAKSBOARD-04 | LOW | **STILL OPEN** | The README paragraph opens on "the deployed application" and then states "Since 2026-09-09 the board says which is which". Migrations 0022 to 0024 are applied to `corgi_test` only; nothing on this branch is deployed |
| F-BREAKSBOARD-05 | LOW | **STILL OPEN** | `scripts/check-reconciliation.ts:275,280` still uses the global `journalEntryCount()` for `a run posts no money and no journal entry`. The new assertion correctly uses `journalEntryCountForPolicies`, the pre-existing one was not narrowed. It passed on my run (8680 to 8680) but remains contention-sensitive |
| F-BREAKSBOARD-06 | INFO | **STILL OPEN, accepted** | The `?explained=` notice is still printed from the query string alone |

## Findings

Numbering continues from round 1, which used F-BREAKSBOARD-01 to 06.

### F-BREAKSBOARD-07 (MEDIUM): the daily job stopped widening its window to cover explained breaks, so the re-open mechanism this round adds cannot fire once the record is more than seven days old

**Where.** `lib/reconciliation/read.ts`, `oldestOpenBreakRecordDate`, whose predicate changed from `not A_LATER_RUN_RE_EXAMINED_IT` to `IT_IS_A_BREAK_TO_ACT_ON`; `lib/reconciliation/run.ts`, `windowCoveringOpenBreaks`; `app/api/jobs/daily/route.ts:58`.

**Trigger.** An operator explains a break. `SOMEBODY_HAS_EXPLAINED_IT` becomes true, so the row leaves `IT_IS_A_BREAK_TO_ACT_ON`, so `oldestOpenBreakRecordDate` no longer sees it. `windowCoveringOpenBreaks` widens the daily window only as far back as that date; with no remaining break to act on it returns null and the window is the default `DEFAULT_WINDOW_DAYS = 7`. A run only compares provider records created inside its window. So from the eighth day after the record date, no daily run reports that break at all.

**Consequence.** The whole correction of round 1 is "a later run that reports the same break differently matches no note, and the break is work again". If no later run ever reports the break, no later run can report it differently: the note goes on matching for ever and the break stays out of the count, the operations inbox and the MCP tool permanently. This is the steady state, not a corner case: on a board where every break has been explained there is no break to act on left to widen the window, so every explained break older than seven days is frozen. `reachesTheOldestOpenBreak` in the daily job's answer will also report `true` while such a break sits outside the window, so the job's own honesty signal no longer covers them.

Two things limit the severity, and they are why this is MEDIUM and not HIGH: nothing is hidden (the break stays listed under "Explained breaks" with its note, its author and its date), and a staff member can still run an explicit window from the screen up to the 31-day cap.

**Overstated claims that go with it.** The comment on `IT_IS_A_BREAK_TO_ACT_ON` and the `README.md` sentence both say the break returns to "the daily job's window". That is only true after some run has reported it differently, and this change is what prevents that run from happening. `lib/reconciliation/read.ts` also states the intent of the widening in its own words ("the daily job asks this so its one window reaches back far enough to re-examine what is still open instead of leaving it unlooked at for ever, finding F-B10-01"); an explained break is still open money, and it is now left unlooked at.

**Required correction.** Decide the question explicitly and write the decision beside the code: either `oldestOpenBreakRecordDate` keeps widening for explained breaks (excluding probes only, which is the part of the change that is right, since a probe is money we planted and never needs looking at again), accepting a window that stays wide while old explained breaks exist; or the widening stays as it is and the README, the comment on `IT_IS_A_BREAK_TO_ACT_ON` and the board's "What a note does" panel stop promising that a changed break comes back, and say instead for how long that promise holds. The first option is the one that matches what the slice was asked to build. Note that `resolvedBreaks` already keeps the wider rule for its own `open_report` CTE, with a comment saying why ("a probe and an explained break are money that is still exactly where it was"); the same reasoning applies here and points the same way.

### F-BREAKSBOARD-08 (LOW): the superseded-note sentence tells the operator the break "changed since", including when nothing changed

**Where.** `app/ops/reconciliation/page.tsx`, the `supersededExplanation` block of `BreakTable`.

**Trigger.** A note written before migration 0024 carries no `explained_classification`, so it matches nothing and its break is work again. The row then prints the fixed heading **"Explained before, and changed since."**, followed by "before a note recorded which report it explained", followed by "The latest run reports it as X, so it is work again."

**Consequence.** For a pre-0024 note the break did not change; the note simply predates the column. The operator is told a run reported something differently when no run did, and may go looking for a movement that never happened. The migration header itself states the honest wording ("we cannot know what such a note was about"); the screen does not use it.

**Required correction.** Branch the heading on `explainedClassification === null` and say, in that case, that the note predates the record of which report it explained, so the break needs explaining again as it stands today.

### F-BREAKSBOARD-09 (LOW): two different migrations numbered 0024 are applied to `corgi_test`

**Where.** `db/migrations/0024_break_notes_say_what_they_explain.sql` on this branch; `0024_mcp_key_creator.sql`, from another slice, already recorded in `schema_migrations` on `corgi_test`.

**Trigger.** `main` ends at `0021_activity_log.sql`. This branch adds 0022, 0023 and 0024; a concurrent branch independently chose 0024 as well. Read back from `corgi_test`: `0024_mcp_key_creator.sql, 0024_break_notes_say_what_they_explain.sql, 0023_reconciliation_probe_classification.sql, 0022_reconciliation_break_notes.sql, 0021_activity_log.sql`.

**Consequence.** Not a defect of this diff, and not something the builder can fix alone, but the coordinator must know before merging: the number no longer expresses the order, a reviewer reading "0024" cannot tell which file is meant, and a third branch could pick 0024 again. Both files are independent of each other, so applying them in either order is safe today.

**Required correction.** Coordinator decision at merge: renumber one of the two, or record explicitly that migration numbers are unique per file name and not per number.

### F-BREAKSBOARD-10 (INFO): two small honest-but-worth-knowing points, both already disclosed by the builder

- `scripts/check-money-guards.ts` inserts its fixture note without the three columns migration 0024 added. That is valid (they are nullable) and the guard assertions do not depend on them, so the guard check never exercises the new columns. No correction needed.
- The "Explained breaks" panel prints "latest of N notes on this break", where N counts every note on the break key, superseded ones included. The sentence is literally accurate; a reader may take N for the number of notes that still apply.
- The explain route carries no CSRF token. Every state-changing POST route in this build is the same, so this is a systemic, pre-existing property and not a regression of this slice; it is recorded here so it is not read as reviewed-and-cleared.

## Checks actually executed

All on the shared disposable database `corgi_test`, each once, one at a time, from the review worktree at the reviewed SHA. `npm ci` first (96 packages).

| Command | Result |
|---|---|
| `npm run typecheck` | PASS, no output |
| `npm test` | PASS: 479 tests, 478 passed, 1 skipped, 0 failed, 2 suites |
| `npm run check:reconciliation` | **ALL CHECKS PASSED.** Every assertion of the slice passed, including `a break explained while it is stale leaves the list to act on`, `a break a later run reports differently is WORK AGAIN, and leaves the explained list`, `the superseded note is still on file and shown beside the break it no longer explains` (note written against `stale`, row now `provider_only`), `a probe is NOT a break to act on`, `the runtime role cannot UPDATE a break note` and `... cannot DELETE a break note` (both `permission denied for table reconciliation_break_notes`). Planted and left open on purpose by this run: rail transfer `sim_tr_planted_1788965114547` and Stripe sandbox PaymentIntent `pi_3UDmmGK6R3v50tIy1644vwL5` (4242 cents, test card, sandbox asserted before creation). Honest limit on this line: I captured the last 54 PASS lines of the run plus the final `ALL CHECKS PASSED`, not the whole transcript, so I read the verdict from the script's own summary line and from the 54 assertions I did see, none of which failed |
| `npm run check:inbox-counts` | see the line below the table |
| `gitleaks detect --no-git` over `git diff main...4cf3cc9` | no leaks found, 110.91 KB scanned |
| Schema read-back on `corgi_test` (columns, grants, triggers, CHECK constraint, applied migrations) | as recorded in the matrix; the temporary script was deleted and never committed |

`check:inbox-counts`: **All inbox count checks passed**, 28 assertions, 0 failed. The two staff inboxes are the ones this slice can move: `staff_ops` 1962 counted and 1962 listed (`#reconciliation` 1611/1611), `staff_approver` 1891 counted and 1891 listed (`#reconciliation` 1611/1611). 50 of 1186 brokers and customers compared, 2 staff, one of each role. The number and the list agree anchor by anchor, so the probe exclusion and the note exclusion moved the badge and the section it opens together.

**Not run, deliberately:** `npm run check:money-guards` (reserved for the coordinator on an ephemeral database), and `npm run migrate` (migrations 0022 to 0024 were already applied to `corgi_test` by the builder; I applied nothing).

**Shared-database contention observed.** `corgi_test` held about 1600 open breaks and 8680 journal entries from other agents' runs while I ran. The slice's own assertions key on this check's own uuids and policies, so they are unaffected; every absolute number quoted above is shared-database noise and must not be read as a property of the build. I saw no deadlock and no fixture collision, and I did not loop any check.

## What was not verified

- **Nothing was deployed or exercised over HTTP.** The explain route was reviewed by reading it; `explainBreak` was exercised directly by `check:reconciliation`, which does not go through `withActivity`, the session cookie or the redirect. The role refusal is proved at the function, not at the route.
- **No browser rendering.** The board's three panels, the cap sentences, the superseded-note sentence and the form were read as source only. Another session is rebuilding the interface, so I changed nothing there and did not start a server.
- **F-BREAKSBOARD-07 was established by reading the code, not by a live run.** Proving it live needs an empty database and a controlled clock; on `corgi_test` the 1600 shared open breaks pin the window at the 31-day cap and would mask it. The reasoning is short enough to check by hand: `oldestOpenBreakRecordDate` excludes explained breaks, `windowCoveringOpenBreaks` widens only to that date, and a run compares only records created inside its window.
- **`check:money-guards` was not run**, so the new table's guards were proved by the two live negative assertions of `check:reconciliation` (runtime role) and by reading the triggers back from `corgi_test` (owner path), not by that script.
- **No legal or regulatory question is in scope.** Nothing here is a compliance statement; this is an engineering review of an internal operations screen.
- **Production data was not inspected.** The claim that the 28 open breaks on the deployed application will be reclassified as probes on the next covering run follows from the code and from the fact that the old script already sent the `corgi_probe:` description (verified with `git show main:scripts/check-reconciliation.ts`), but it was not observed.

## Verdict

**FAIL.** One MEDIUM finding, F-BREAKSBOARD-07: the change that removed probes from the daily job's window computation also removed explained breaks, and that stops the very mechanism this round was asked to build from ever firing on a break older than the default seven-day window. Round 1's MEDIUM is genuinely fixed and I could reproduce the fix live; the four LOW findings of round 1 are still open, three of them being comments and a README sentence that promise more than the code delivers.

Residual limitations: no deployment, no browser, no `check:money-guards`, and every absolute count above comes from a database shared with other agents.

**Walkthrough status: NOT REVIEWED WITH YOANN.**

## Register lines

| ID | Severity | Finding | Correction | Status |
|---|---|---|---|---|
| F-BREAKSBOARD-01 | MEDIUM | A note was keyed on `break_key` alone and never expired | Migration 0024 records the classification and both amounts of the report the note explains; `THE_NOTE_EXPLAINS_THE_LATEST_REPORT` re-opens the break when the latest report differs | RESOLVED at 4cf3cc9, verified live |
| F-BREAKSBOARD-02 | LOW | `openBreaksOfSubject` still uses the old rule while the shared comment says both readers ask the same question; the gap widened, since the board now also excludes probes and explained breaks | Use `IT_IS_A_BREAK_TO_ACT_ON` there, or reword the comment and say what the 360 page shows | OPEN |
| F-BREAKSBOARD-03 | LOW | The probe rule's comment claims no forged marker can silence a real break; a provider-only record with no operation id and a forged marker is silenced | Reword to the guarantee the code gives: a record naming one of our operations is never a probe | OPEN |
| F-BREAKSBOARD-04 | LOW | The README says the deployed board already separates probes; 0022 to 0024 are on `corgi_test` only | Reword, or land the sentence with the deploy | OPEN |
| F-BREAKSBOARD-05 | LOW | The pre-existing global journal-entry assertion of `check:reconciliation` is still global and contention-sensitive | Narrow it to this check's own policies, as the new assertion already is | OPEN, passed on this run |
| F-BREAKSBOARD-06 | INFO | The "explained" notice is printed from the query string alone | One line if the panel is revisited | OPEN, accepted |
| F-BREAKSBOARD-07 | MEDIUM | `oldestOpenBreakRecordDate` now excludes explained breaks, so the daily job stops widening its window to cover them and no later run can ever report them differently; the README and two comments promise that it does | Keep the widening for explained breaks (exclude probes only), or stop promising the break comes back and say for how long the promise holds | OPEN |
| F-BREAKSBOARD-08 | LOW | The board tells the operator a break was "changed since" even when the note simply predates migration 0024 | Branch the sentence on a null `explained_classification` and use the migration header's honest wording | OPEN |
| F-BREAKSBOARD-09 | LOW | Two different migrations numbered 0024 are applied to `corgi_test`, one from this branch and one from another slice | Coordinator decision at merge: renumber one, or record that file names and not numbers are the identity | OPEN, coordinator |
| F-BREAKSBOARD-10 | INFO | `check-money-guards` never exercises the three new columns; "latest of N notes" counts superseded notes; the explain route has no CSRF token, like every other POST route of this build | None required; recorded so none of the three is read as reviewed-and-cleared | OPEN, accepted |
