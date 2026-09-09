# Independent review: the honest breaks board (slice `breaks-board`, round 1)

- **Reviewer:** independent reviewer sub-agent, no part in the implementation.
- **Date:** 2026-09-09 (UTC), review run from a detached worktree at the builder's commit.
- **Scope:** findings F-YA-10 (probes), F-LS-01 (bounded board read), F-LS-04 (resolved-break annotation)
  and everything the diff touches: the sixth classification `probe`, migrations 0022 and 0023, the
  append-only break notes, `POST /api/reconciliation/breaks/[breakKey]/explain`, the readers in
  `lib/reconciliation/read.ts`, the reconciliation board, the MCP tool description, the reconcile job
  sentence, the check scripts and the README paragraph.
- **Reviewed SHA:** `dee775b00cb933b47a52b600931c128ddc1aae78` (branch `worktree-wf_46bb3e09-77f-1`,
  five commits `f33db1a`, `9309804`, `ef72990`, `231a7a6`, `dee775b` on top of `main`). Working tree
  clean at review time; no code was modified by this review.
- **Diff reviewed:** `git diff main...dee775b00cb933b47a52b600931c128ddc1aae78`, 18 files,
  +1053 / -82.
- **Verdict: FAIL** (one MEDIUM finding, plus one check assertion that failed on the shared database).
- **Walkthrough status: NOT REVIEWED WITH YOANN.**

## Startup receipt

Read in full before reviewing: `CLAUDE.md`, `AUTOMATIC-FAILS.md`, `READABLE-CODE.md`, `AGENTS.md`,
`REVIEWER.md`. Read for scope: the `docs/reviews/FINDINGS.md` lines for F-YA-10, F-LS-01 and F-LS-04,
`docs/reviews/b13-14-low-sweep.md` (F-LS-01 and F-LS-04 as originally written), the `docs/STATUS.md`
entries on the 28 production probes, and every file in the diff plus the files they depend on:
`lib/reconciliation/{diff,breaks,read,run,stripe-records,stripe-source,claims-rail-source,break-notes}.ts`,
`lib/reconciliation/diff.test.ts`, `lib/console/read.ts`, `lib/inbox/{read,tasks,sections}.ts`,
`lib/observability/log.ts`, `lib/auth/current-user.ts`, `app/api/session/login/route.ts`,
`app/api/reconciliation/breaks/[breakKey]/explain/route.ts`, `app/api/jobs/reconcile/route.ts`,
`app/ops/reconciliation/page.tsx`, `db/migrations/0001`, `0003`, `0004`, `0018`, `0019`, `0021`,
`0022`, `0023`, `scripts/check-reconciliation.ts`, `scripts/check-money-guards.ts`,
`lib/payments/checkout.ts`.

Not read (out of scope for this slice): `WORKFLOW-48H.md` beyond its checkpoints,
`READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`. No new legal source was consulted: this slice adds
no money movement, no provider call and no personal data, so no US requirement changes with it.

Next acceptance criterion this review gates: the reconciliation break screen showing breaks and their
age honestly (general brief, reconciliation section), with the two mechanisms Yoann decided on
2026-09-09.

## Applicability

- Actors unchanged by this slice: staff operations and staff approvers on `/ops/reconciliation`, a
  staff MCP key on `list_reconciliation_breaks`, the daily reconcile job.
- Money: **none moves**. No journal entry is written, no provider call is made, no reconciliation row
  is updated or deleted. Confirmed by reading the diff (the only `update` and `delete` statements it
  adds are the two negative assertions of `scripts/check-reconciliation.ts`) and by the check
  assertion "explaining a break repairs nothing" (PASS).
- Provider: Stripe test mode only. The check script still plants one real sandbox PaymentIntent of
  4242 cents per run, now with `metadata.probe = "check-reconciliation"`, and `assertStripeSandbox()`
  still runs before it (AF-04).
- Data: a free-text note written by a staff operations user, plus that user's id. No customer
  personal data, no secret.

## Requirement matrix

| # | Requirement | Control / code location | Evidence | Verdict |
|---|---|---|---|---|
| 1 | A sixth classification `probe`, decided by one explicit function with its reason beside it | `lib/reconciliation/diff.ts:56-95` (`isProbeFromACheckRun`, `PROBE_METADATA_MARKER`, `PROBE_AMOUNT_CENTS`, `PROBE_DESCRIPTION_PREFIX`) | Read; 5 new unit tests in `lib/reconciliation/diff.test.ts:425-478`; live check "THE PLANTED SANDBOX PAYMENT IS FOUND, and it is classified as the probe it is" PASS | PASS |
| 2 | A record naming one of our operations is never a probe | `diff.ts:81-83`: `operationId !== null` returns false, first and unconditionally | Unit test "a record naming an operation is never a probe, whatever its metadata says"; verified independently that the application always sets `operation_id` metadata on its PaymentIntents (`lib/payments/checkout.ts:112-113`) and never sets a `description`, so neither probe branch can reach real application money | PASS |
| 3 | The probes planted before the marker existed are recognised | `diff.ts:88-90`: amount 4242 **and** description starting `corgi_probe:` | Verified against `main:scripts/check-reconciliation.ts:558`, which has always sent that description; unit test "a probe planted before the marker existed is recognised by its amount and its description"; the negative twin "the planted amount without the description is an ordinary provider-only break" also passes, and the pre-existing fixture assertion "a payment carrying no operation id at all is provider only" (also 4242 cents, no description) still PASSes | PASS |
| 4 | The check script sets the marker from now on | `scripts/check-reconciliation.ts:569-577` | Read; my run created `pi_3UDlr7K6R3v50tIy0QljajXB` with the marker and it came back classified `probe` | PASS |
| 5 | A probe is listed under its own heading with the sentence naming who creates them | `app/ops/reconciliation/page.tsx:186-213`; `lib/reconciliation/read.ts:397-431` (`probesPage`) | Read; check assertion "a probe is listed under its own heading, with the sentence saying who plants it" PASS | PASS |
| 6 | A probe is not counted as a break to act on, and is out of the inbox count and the what-needs-you tasks | `read.ts:175-196` (`IT_IS_A_PROBE_FROM_A_CHECK_RUN`, `IT_IS_A_BREAK_TO_ACT_ON`), used by `openBreaks`, `countOpenBreaks`, `openBreaksPage`, `oldestOpenBreakRecordDate`; the inbox reads those (`lib/inbox/read.ts:273`, `lib/inbox/tasks.ts:72`) | Check assertion "a probe is NOT a break to act on: it is out of the open list, the count and the inbox" PASS; `npm run check:inbox-counts` PASS (see checks) | PASS |
| 7 | The run summary counts probes separately | `lib/reconciliation/run.ts:113-124` and `breakCount` (probe excluded); `app/api/jobs/reconcile/route.ts:88` ("N probes, M breaks to act on"); `page.tsx:404-410` | Read; check assertion "the run counts probes on their own line" PASS | PASS |
| 8 | Migration 0023 widens only, redefines nothing | `db/migrations/0023_reconciliation_probe_classification.sql` | Same drop-and-re-add CHECK shape as 0007, 0009, 0010, 0014, 0018 and 0020 (verified with `grep -n "drop constraint" db/migrations/*.sql`); `probe_count` is a NEW nullable column with its own `>= 0` CHECK and a separate failed-run CHECK, and the CHECK of 0011 is untouched. Read back from `corgi_test`: `reconciliation_items_classification_check` now lists the six values, `reconciliation_runs_check2` is unchanged | PASS |
| 9 | Migration 0022 carries the guards of every protected table for every role, runtime SELECT and INSERT only | `db/migrations/0022_reconciliation_break_notes.sql:52-64` | Identical shape to 0018 and 0019 and to the functions declared in 0001, 0003 and 0004. Read back from `corgi_test`: triggers `reconciliation_break_notes_are_append_only`, `..._cannot_be_truncated`, `..._recorded_at_is_server_set`; grants `app_runtime: SELECT, INSERT` and nothing else; CHECKs `char_length(note) between 10 and 500` and `char_length(break_key) between 1 and 300`; `recorded_at` set by the server-clock trigger | PASS |
| 10 | The runtime role cannot UPDATE or DELETE a note | grants of 0022 | Live: "the runtime role cannot UPDATE a break note" and "... DELETE ..." both PASS with `permission denied for table reconciliation_break_notes` | PASS |
| 11 | The owner cannot UPDATE, DELETE or TRUNCATE a note either | trigger `reconciliation_break_notes_are_append_only` plus the table in `PROTECTED_TABLES` of `scripts/check-money-guards.ts:56`, with its fixture row and map entry | The triggers exist in `corgi_test` and use the same functions 0001 declares; the guard loops of `check-money-guards.ts:417-451` are generic over `PROTECTED_TABLES`, and the `Fixture` type forces the map entry (typecheck passes). **Not executed**: `check:money-guards` is the coordinator's ephemeral-database run | BLOCKED, pending the coordinator's run |
| 12 | Only staff operations can explain a break; every other role refused | `lib/reconciliation/break-notes.ts:44-46`, an allowlist of exactly one role; the route reads the session, never the form (`route.ts:22-31`) | Check assertion "a user who is not staff operations cannot explain a break" PASS against a real `staff_approver`; no other writer of `reconciliation_break_notes` exists in the codebase (grep) | PASS |
| 13 | A note is 10 to 500 characters, trimmed before it is measured | `break-notes.ts:48-58`, mirrored by the CHECK of 0022 | Check assertion "a note shorter than the minimum is refused" PASS | PASS |
| 14 | A note cannot be filed on a break no run ever reported | `break-notes.ts:64-73` | Check assertion "a note on a break no run has ever reported is refused" PASS | PASS |
| 15 | The route is wrapped with the activity helper and carries the outcome in the redirect | `route.ts:15-18`; new rule `"break note"` in `lib/observability/log.ts:120-123` | Read. The 303 plus `?error=` shape is exactly what `classify()` reads as `refused` with the route's own rule (`log.ts:271-276`). The `rule` column of 0021 is free text with a length CHECK, so the new value needs no migration | PASS |
| 16 | An explained break stays listed with its note, author and date, and leaves the count and the inbox | `read.ts:432-508` (`explainedBreaksPage`), `page.tsx:216-243` and `540-582` | Check assertions "an explained break leaves the list to act on and the count the inbox reads" (1579 to act on before, 1578 after) and "an explained break stays listed, with its note, who wrote it and when" both PASS | PASS, with finding F-BREAKSBOARD-01 |
| 17 | Nothing here repairs money | `break-notes.ts` (one INSERT), `route.ts` (no provider call) | Check assertion "explaining a break repairs nothing: no journal entry, and the break's items are all still on file" PASS (20 journal entries on this check's policies before and after, 3 items still on file). Diff scan: the only `update` and `delete` statements added anywhere are the two negative assertions | PASS |
| 18 | F-LS-01: the board calls the bounded reader and prints the cap sentence | `page.tsx:41-46`, `84`, `160-172`; `read.ts:381-394` | Read. `totalOpen` is `countOpenBreaks`, that is the same rule, and `capped` drives the sentence; the two new lists carry the same sentence. **No dedicated assertion** exercises the cap itself | PASS, with a gap recorded below |
| 19 | F-LS-04: the resolved-break annotation names or counts every open break sharing the reference | `read.ts:276-345` | Read: the `limit 1` is replaced by `count(*)` plus `string_agg(... order by break_key)`, the aggregate returns exactly one row, and the mapper words the singular and the plural separately. **No dedicated assertion**; verified by reading only | PASS, with a gap recorded below |
| 20 | The three board lists are disjoint | `read.ts`: to act on = not re-examined AND not probe AND not explained; probes = not re-examined AND probe AND not explained; explained = not re-examined AND explained | Read; the three predicates partition the non-re-examined set exactly, so a record appears once | PASS |
| 21 | AF-03: no money row updated or deleted | the whole diff | Verified by reading and by scanning the diff for `update`, `delete from` and `truncate`: only the two negative assertions and the guard comments | PASS |
| 22 | AF-04: sandbox only | `assertStripeSandbox()` still called before the plant; test card `pm_card_visa`; no real person | Read; my live run created a test-mode PaymentIntent | PASS |
| 23 | AF-05: no secret added | the whole diff | Scanned for key prefixes, connection strings and password-shaped assignments: none. `.env.local` was copied into the worktree to run the database checks, is covered by `.gitignore` (`git status` stayed clean with it present), was never printed and was deleted before this record was committed | PASS |
| 24 | AF-06: a short reading path and checkable rules | one function for the probe rule, one file for the note rule, one exported SQL fragment for "a break to act on" | Read. The reading path is genuinely short and the comments carry the business reason. Three comments overstate what the code does: findings 01, 02 and 03 | PASS, with findings |
| 25 | AF-01 and AF-02 | not touched by this slice; nothing is deployed by it | The README paragraph makes a present-tense claim about the deployed board (finding F-BREAKSBOARD-04) | AF-01 NOT RUN; AF-02 PASS |

## Findings

### F-BREAKSBOARD-01 (MEDIUM): an explanation is keyed on the break key alone and never expires, so a break that later gets worse never comes back to the queue

**Where.** `lib/reconciliation/read.ts:184-196` (`SOMEBODY_HAS_EXPLAINED_IT` and
`IT_IS_A_BREAK_TO_ACT_ON`) and `db/migrations/0022_reconciliation_break_notes.sql`: the table holds
nothing about what was explained.

**Trigger.** A staff operations user explains a break whose key is `stripe|op:<uuid>` while its
classification is `stale` ("the refund is with the bank, I called them"). A later complete run reports
the same key as `amount_mismatch` or `provider_only`, with a real signed difference. The codebase's own
design note says this is exactly the case the key was built for: "a refund the ledger owed and Stripe
did not list was keyed as `stale`, and the day Stripe listed it as succeeded with nothing booked on our
side it became `provider_only` ... Same money, one break that had just got worse"
(`lib/reconciliation/breaks.ts:13-20`). The check proves it happens: the assertion "a break that changes
classification keeps its key and its age" PASSed on my run, `stale then provider_only, key
stripe|op:1a7df762-...`.

**Consequence.** `SOMEBODY_HAS_EXPLAINED_IT` matches on `break_key` alone, with no reference to the
classification, the amounts or the run that was explained. The worsened break is therefore excluded
from `countOpenBreaks` (the sidebar badge), `openBreaks` (the operations inbox and its what-needs-you
task), `openBreaksPage` (the board's own count) and the MCP tool `list_reconciliation_breaks` -
permanently, because the table is append-only and no path removes or supersedes a note. It also leaves
`oldestOpenBreakRecordDate`, so the daily job stops widening its window to cover that record
(`lib/reconciliation/run.ts:330-349`) and may never re-examine it at all. The only surface that still
shows it is the "Explained breaks" panel, ordered by note recency and capped at 50, carrying a note
that describes the previous problem.

**Two comments say the opposite.** `db/migrations/0022_reconciliation_break_notes.sql:16-17`: "A break
that was explained wrongly is still a break: the next run reports it again, and the note beside it is
what an operator argues with." The next run does report it; nothing brings it back to the count, the
inbox or the agent tool. `lib/reconciliation/break-notes.ts:11-16` makes the same claim.

**Required correction.** Bind the note to what it explained and re-open when that changes: store on the
note the classification (and ideally the provider and ledger amounts) of the latest report at the time
it was written, and make `SOMEBODY_HAS_EXPLAINED_IT` require that the latest report still matches one
of the notes. A break whose latest report differs from every note it carries is work again. Minimum
acceptable alternative: keep the current filter, add a "changed since it was explained" predicate that
puts such breaks back into the count and the inbox, and correct the two comments.

### F-BREAKSBOARD-02 (LOW): the 360 console still asks the old question, while the shared comment says it asks the same one

**Where.** `lib/console/read.ts:2612` still filters on `not A_LATER_RUN_RE_EXAMINED_IT` alone, while
`lib/reconciliation/read.ts:137-141` says of that reader: "it must ask the same question this screen
asks, not a second version of it".

**Trigger.** Explain a break that carries a policy's operation id, then open that policy's 360 page.

**Consequence.** The break has left the board's list to act on and the inbox, and is still listed as an
open break on the console. The divergence is in the safe direction (the console shows more, never
less), but the comment that justifies sharing the fragment is now false and the next reader will assume
the two agree. Probes are not affected: they carry no operation id and no shared reference, so they
cannot appear on a subject's page.

**Required correction.** Either use `IT_IS_A_BREAK_TO_ACT_ON` there too, or reword the comment to say
the console deliberately shows every break still reported about this subject, probes and explained
breaks included.

### F-BREAKSBOARD-03 (LOW): the probe rule's comment claims more safety than the rule provides

**Where.** `lib/reconciliation/diff.ts:69-73`: "no forged marker can turn a real break into a line the
board stops counting".

**Trigger.** A PaymentIntent in our Stripe sandbox account with no `operation_id` metadata and
`metadata.probe = "check-reconciliation"`.

**Consequence.** That record is classified `probe` and leaves the count, the inbox and the MCP tool.
That is precisely the class of break the planted probe exists to demonstrate: money at the provider
with nothing behind it in our books. What the code actually guarantees is narrower and is worth saying
exactly: a record naming one of our money operations is never a probe, so no forged marker can hide
money one of our own operations owns. In this trial only a holder of our sandbox key can write that
metadata, which is why this is LOW.

**Required correction.** Reword the comment to the guarantee the code gives.

### F-BREAKSBOARD-04 (LOW): the README states as a present fact something that is true only after the migrations are applied and the code is deployed

**Where.** `README.md`, reconciliation note: "Since 2026-09-09 the board says which is which."

**Consequence.** Migrations 0022 and 0023 are applied to `corgi_test` only and nothing in this slice has
been deployed, so a reader of the submission README would take the deployed board to already separate
probes from breaks. This is not AF-02 (no simulation is presented as a live integration), but it is a
claim about the deployed application that is not yet true.

**Required correction.** Word it as what the code does, or land the sentence together with the deploy of
0022 and 0023 to the trial database.

### F-BREAKSBOARD-05 (LOW): one pre-existing assertion of `check:reconciliation` fails on the shared database, and it is the one the builder did not narrow

**Where.** `scripts/check-reconciliation.ts:279-283`, using the global `journalEntryCount()`.

**Observed.** On my single run: `FAIL a run posts no money and no journal entry: reconciliation only
appends to its own two tables (8514 journal entries before the run, 8516 after)`. The two entries were
committed by another agent's check on the shared `corgi_test` between the two reads; this check owns 20
journal entries on its own policies. Nothing in this slice writes a journal entry, and the assertion is
unchanged by the diff.

**Consequence.** The check is not reproducibly green on the shared database, so the builder's reported
"51 assertions, 51 PASS 0 FAIL" cannot be reproduced by a reviewer. The builder narrowed his own new
journal assertion to this check's policies for exactly this reason (`journalEntryCountForPolicies`) and
left the older one global.

**Required correction.** Narrow this assertion the same way, so the check answers a question about this
check.

### F-BREAKSBOARD-06 (INFO): the success notice is printed from the query string alone

**Where.** `app/ops/reconciliation/page.tsx:103-110`. Any reader of the board can open
`/ops/reconciliation?explained=anything` and see "Break anything is explained." No state changes and
React escapes the value, so this is cosmetic. Worth one line only if the panel is revisited.

## Checks actually executed

All on the shared disposable database `corgi_test`, once each, one at a time, from a detached worktree
at `dee775b`. `npm ci` was run first: the worktree had no `node_modules`.

| Check | Result |
|---|---|
| `npm run typecheck` | **PASS**, clean, no output |
| `npm test` | **PASS**: 479 tests, 478 passed, 0 failed, 1 skipped, 2 suites. Matches the builder's report |
| `npm run check:reconciliation` | **51 assertions, 50 PASS, 1 FAIL.** The failure is the pre-existing global journal-entry assertion of F-BREAKSBOARD-05 (8514 before, 8516 after: another agent's rows on the shared database). Every assertion belonging to this slice passed, including the five new probe ones and the eight new note ones. Run once; not repeated |
| `npm run check:inbox-counts` | **PASS**: 53 assertions, 53 PASS, 0 FAIL, "All inbox count checks passed". The two staff inboxes agree with their lists under the new rule: `staff_ops` 1937 counted = 1937 listed with `#reconciliation 1592/1592`, `staff_approver` 1853 = 1853 with `#reconciliation 1578/1578`. The 14-break difference between the two roles is the shared database moving between the two users' reads, not a rule divergence: both roles read the same `openBreaks`, and `staff_approver`'s 1578 is exactly the figure my `check:reconciliation` run ended on. Run once; not repeated |
| `npm run check:money-guards` | **NOT RUN**, as instructed: the coordinator proves the guards on an ephemeral database. The runtime half is proven by `check:reconciliation` (`permission denied` on UPDATE and on DELETE); the owner half and the TRUNCATE guard stay unproven by execution |
| Read-only schema inspection of `corgi_test` | Triggers, grants, columns and CHECK constraints of `reconciliation_break_notes`, `reconciliation_items` and `reconciliation_runs` read back and compared with 0022 and 0023. `schema_migrations` shows `0021`, `0022`, `0023` and `0024` applied |
| Migration numbering | `git log --all --diff-filter=A` over `db/migrations/0022*`, `0023*`, `0024*`: 0022 and 0023 exist only on the builder's branch, 0024 (`mcp_key_creator`) only on another branch. **No collision**; the renumbering risk the builder flagged did not materialise |
| Secret scan of the diff | No key prefix, connection string or password-shaped assignment added |

Side effects of my run, disclosed: one more real sandbox PaymentIntent of 4242 cents now exists at
Stripe (`pi_3UDlr7K6R3v50tIy0QljajXB`), carrying the new marker; one rail transfer and one break note
were left on `corgi_test`, as that script always does. No connection string was printed by any tool.

**Disclosed operating mistake.** While waiting for my own `check:inbox-counts` to finish I ran an
unscoped `pkill -f "check-inbox-counts"` at about 16:07 local. My own run had already exited, so the
pattern could only have matched another agent's run of the same check. I could not establish whether
one was in flight at that instant. `scripts/check-inbox-counts.ts` performs no `insert` and opens no
transaction (verified by grep), so nothing on `corgi_test` can have been left inconsistent by it; the
only possible harm is that another agent lost a check result and has to run it again. Reported rather
than hidden.

## What was not verified

- **`check:money-guards`** was not run (instructed). Requirement 11 stays BLOCKED until the
  coordinator's ephemeral-database run: the owner-level UPDATE, DELETE and TRUNCATE guards on
  `reconciliation_break_notes` are supported only by reading the migration and by the triggers existing
  in `corgi_test`.
- **The route was not exercised over HTTP.** `explainBreak` was exercised directly by the check script,
  which is where the role, the length and the unknown-key refusals live; the wrapper, the session read
  and the redirect shape were reviewed by reading only. No local server was started.
- **No screen was rendered.** The board changes were reviewed as source. The interface is being redone
  in another session.
- **The bound of `openBreaksPage` and the cap sentence** have no dedicated assertion, as the builder
  states. They are exercised only through the board and through the `countOpenBreaks` equality.
- **The F-LS-04 aggregate** has no dedicated assertion either; it was verified by reading the SQL.
- **The 28 existing production probes** were not observed: production was not touched. Their recognition
  rests on `main:scripts/check-reconciliation.ts:558` having always sent the `corgi_probe:` description,
  which I verified in Git history, and on my live run proving the rule end to end against the real
  sandbox. Note for the coordinator: those 28 rows are stored as `provider_only`, so they become probes
  only once a run whose window covers their creation dates re-examines them.
- **Deployment (AF-01)** is outside this slice and was not checked.

## Verdict

**FAIL.** The slice does what it was asked to do, the money rules are respected, the migrations follow
the established shape, and the probe rule is genuinely narrow: I could not construct an input in which
real application money is classified as a probe, and the operation-id guard that makes that true is
tested. But F-BREAKSBOARD-01 is a MEDIUM: an explanation is permanent and unscoped, so a break that
later becomes a worse problem under the same key never returns to the badge, the inbox, the daily job's
window or the MCP tool, and two comments state the opposite. One check assertion also failed on the
shared database (F-BREAKSBOARD-05), which is contention rather than a defect of this slice but leaves
the builder's reported result unreproducible.

Fix F-BREAKSBOARD-01, correct the three overstating comments (01, 02, 03) and re-run
`check:reconciliation` once on a quiet database; the rest can be registered as LOW backlog.

**Walkthrough status: NOT REVIEWED WITH YOANN.** Nothing in this review establishes that Yoann can
explain these lines.

## Register lines

| ID | Severity | Finding | Required correction | Status |
|---|---|---|---|---|
| F-BREAKSBOARD-01 | MEDIUM | An explanation is keyed on `break_key` alone and never expires, so a break that later changes to a worse classification never returns to the count, the inbox, the daily job's window or the MCP tool; two comments claim it does | Bind the note to the classification and amounts it explained, and re-open when the latest report differs; correct the comments | OPEN |
| F-BREAKSBOARD-02 | LOW | `openBreaksOfSubject` in the console still uses the old rule while the shared comment says both readers ask the same question | Use `IT_IS_A_BREAK_TO_ACT_ON` there, or reword the comment | OPEN |
| F-BREAKSBOARD-03 | LOW | The probe rule's comment claims no forged marker can silence a real break; a provider-only record carrying a forged marker is silenced | Reword to the guarantee the code gives | OPEN |
| F-BREAKSBOARD-04 | LOW | The README says the deployed board already separates probes; 0022 and 0023 are on `corgi_test` only | Reword, or land with the deploy | OPEN |
| F-BREAKSBOARD-05 | LOW | The pre-existing global journal-entry assertion of `check:reconciliation` fails under shared-database contention (8514 to 8516 on my run) | Narrow it to this check's own policies, as the new assertion already is | OPEN |
| F-BREAKSBOARD-06 | INFO | The "explained" notice is printed from the query string alone | One line if the panel is revisited | OPEN, accepted |
