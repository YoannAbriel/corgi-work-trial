# Independent review: automatic monthly statements (slice `monthly-statements`, round 1)

Reviewer: independent sub-agent. No authorship of any line under review.
Written 2026-09-09T14:42:12Z.
Reviewed revision: `ffa1b691fe1e21cc1d37c70b3a0f48874d090b7f` (branch `worktree-wf_46bb3e09-77f-3`,
four commits `33018aa`, `3f05a02`, `f6a6005`, `ffa1b69`). Read as a detached checkout in a separate
worktree; `main` was not touched. Diff read: `git diff main...ffa1b69`, 11 files, +711 / -32.
Working tree of the reviewed revision: clean.

**Verdict: PASS.** No HIGH and no MEDIUM finding. Eight LOW/INFO findings are recorded below; six
of them are about the blast radius of a close that does not complete, about the strength of two
check assertions, and about wording that promises slightly more than the code delivers. None of
them changes a figure, mutates a money row, weakens a permission or presents a simulation as live.

Walkthrough status: **NOT REVIEWED WITH YOANN.**

## 1. Startup receipt

Read in full, in this order: `CLAUDE.md`, `AUTOMATIC-FAILS.md`, `READABLE-CODE.md`, `AGENTS.md`,
`REVIEWER.md`, `WORKFLOW-48H.md`.

Read in full for this scope: the whole diff (`README.md`, `app/api/jobs/daily/route.ts`,
`lib/inbox/read.ts`, `lib/inbox/sections.ts`, `lib/inbox/sections.test.ts`, `lib/inbox/tasks.ts`,
`lib/statements/compute.ts`, `lib/statements/compute.test.ts`, `lib/statements/monthly-job.ts`,
`lib/statements/read.ts`, `scripts/check-statements.ts`), plus the code the diff calls into:
`lib/statements/run.ts`, `lib/observability/log.ts` (`withActivity`, `recordActivity`),
`lib/jobs/authorize.ts`, `app/api/statements/run/route.ts`,
`db/migrations/0001_ledger_core_and_webhook_inbox.sql` (journal shape and the `recorded_at`
trigger), `db/migrations/0012_broker_statements.sql` (`statement_runs`),
`db/migrations/0021_activity_log.sql` (column checks and grants), `vercel.json`,
`components/portal-shell.tsx` (the `statements` nav section), `scripts/check-inbox-counts.ts`
(header and owner batch).

Read by targeted search: `docs/DECISIONS.md` (the statement entries of 10:02Z and 16:53Z, the
format-version entry, decision 19 point 3), `docs/reviews/FINDINGS.md` (format and the statement
rows), `docs/reviews/b9-statements.md` (record format).

Not read: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`,
`GAP-REVIEW.md`, `docs/COMPLIANCE-MATRIX.md`, `docs/PLAN.md`, `docs/STATUS.md`. Absent files: none.
Nothing under `docs/` was edited except this record.

Next acceptance criterion in scope and its planned checks: "on the first day of a month the daily
job publishes the closed month once per owed broker, idempotently, and the inbox tells both sides".
Planned checks, all executed below: `npm run typecheck`, `npm test`, `npm run check:statements`
once, `npm run check:inbox-counts` once, `gitleaks` over the four commits, and one read-only probe
of `corgi_test` to test one check assertion I suspected of being vacuous.
`npm run check:money-guards` was deliberately NOT run: the coordinator proves the guards on an
ephemeral database.

## 2. Applicability

This slice moves no money, calls no provider, opens no new network destination and collects no
personal data. It reads the application's own ledger through the existing `runStatement`, appends
immutable `statement_runs` / `statement_lines` rows and one `activity_log` row per document, and
adds two read-only inbox sections. The entry point is the existing cron endpoint, authenticated by
`CRON_SECRET` as a bearer token; nothing else can reach it.

Consequently no new US regulatory regime becomes applicable through this diff: no CIP/CDD data is
gathered, no OFAC-screened party is added, no rail is touched, and the statement content is
unchanged (`CANONICAL_STATEMENT_VERSION` is untouched). The requirements in scope are the trial's
own: Track 1 published statements with a knowledge cutoff and revisions (decision of
2026-09-08T10:02Z and decision 19 of 16:53Z), AF-03 append-only money records, AF-04 sandbox only,
AF-05 no committed secret, AF-06 explainability. This is an engineering assessment, not legal
certification.

## 3. Requirement matrix

| # | Requirement (from the slice assignment) | Control / code location | Evidence | Status |
|---|---|---|---|---|
| R1 | Runs on the first day of a month (UTC) only | `lib/statements/monthly-job.ts:86-94` (early return when `now.getUTCDate() !== 1`) | `check:statements`: "called on any day but the first of a month, the job produces nothing at all (2026-08-15…)" | PASS |
| R2 | The month is the one that just ended, never the running one | `monthThatEndedBefore` (`lib/statements/compute.ts:493-498`), one-day step back so no month length is written down | `compute.test.ts` (April 1 → 2028-03, Jan 1 → 2026-12, 00:30Z stays UTC); `check:statements` run reported `month 2026-08` | PASS |
| R3 | Every broker with a journal movement effective in that month, or a policy in force | `brokersOwedAStatementFor` (`monthly-job.ts:165-190`); `effective_at` is a `date` column (0001:67) so the inclusive `between` is exact | `check:statements`: broker F (paid on the first day of the closed month) and broker G (quiet, policy bound) are both in `produced` | PASS |
| R4 | Knowledge cutoff equal to now | `runStatement({ knowledgeCutoff: request.now })` (`monthly-job.ts:114`) | `check:statements`: "cutoff 2026-09-01T00:00:00.000Z", `monthWasStillRunning === false` | PASS, see F-…-02 |
| R5 | Exactly once: skip when a run of that broker and month already has a cutoff at or after the month end | `definitiveStatementExists` (`monthly-job.ts:192-206`), `knowledge_cutoff >= firstInstantAfterMonth(month)`, the same boundary `monthWasStillRunningAt` uses | `check:statements`: second close published nothing for F and G, "585 already published"; my run also skipped the 578 brokers a previous session had closed | PASS for sequential calls, see F-…-03 |
| R6 | Runs after reconciliation, as the last step | `app/api/jobs/daily/route.ts:70` (fourth `await`, after `runAllSources`) | Read; also the step comment states the reason | PASS |
| R7 | One activity row per statement produced | `recordActivity` with `MONTHLY_STATEMENT_ROUTE`, `actorKind: "cron"`, `method: "JOB"`, subject the broker (`monthly-job.ts:130-146`); all constraint-legal against 0021 (`method` ≤ 10 chars, `actor_kind` includes `cron`, `subject_kind` includes `broker`) | `check:statements`: "7 rows for 7 statements" under the job's correlation id | PASS |
| R8 | One line in the job summary | `route.ts:86-96` (`firstDayOfTheMonth`, `statementMonth`, `produced`, `alreadyPublished`, `refused`, `brokers`) | Read only; no check calls the HTTP endpoint | PASS (evidence is by reading, see section 6) |
| R9 | Failures never silent | `StatementRunRefused` collected into `refused[]`, everything else rethrown (`monthly-job.ts:147-154`) | Read; `check:statements` asserts `refused.length === 0` on the happy path only | PASS, see section 6 |
| R10 | Staff inbox section with a new anchor, in `INBOX_ANCHORS`, `INBOX_ANCHOR_OWNER` and the per-role test | `sections.ts:35-36, 58-59, 424-437`; `sections.test.ts` "the six staff sections exist in order" and "each role renders exactly the anchors its own kinds of work name" | `npm test` 475 pass; `check:inbox-counts` `#statements 25/25` for both staff roles | PASS |
| R11 | Broker inbox section "Your statement for &lt;month&gt; is ready" | `sections.ts:271-287`; the broker id comes from the session (`lib/inbox/read.ts:93`), never from a URL | `check:inbox-counts` `#statements 1/1` on broker rows | PASS |
| R12 | A count is the length of the list it opens | One reader for both (`statementsProducedByTheJob`, `lib/statements/read.ts:244-274`), same `limit` on both sides (`tasks.ts:80`, `read.ts:262`) | `check:inbox-counts` compares anchor by anchor: 53 PASS / 0 FAIL | PASS, see F-…-06 |
| R13 | No existing anchor renamed, no screen file touched | Diff contains no `app/**/page.tsx` and no `components/**`; `INBOX_ANCHORS` only gains keys | `git diff --stat` | PASS |
| R14 | README paragraph under the statements section | `README.md:119` plus the jobs line and the inbox line | Read | PASS, see F-…-03 |
| AF-03 | No UPDATE or DELETE on a money row; no column redefined; no applied migration edited | The diff contains no migration and no `update`/`delete`/`truncate` statement; every write is an INSERT through `runStatement` and `recordActivity`; `policy_current` is read for a boolean only and the comment says it is a cache | `check:statements` re-proved on this revision that the runtime role cannot rewrite a published statement or delete its lines (`permission denied`) | PASS |
| AF-04 | Sandbox only | The job touches no provider; both checks refuse to run against anything but `corgi_test` | Executed on `corgi_test` only | PASS in scope |
| AF-05 | No secret committed | `gitleaks detect --log-opts="main..HEAD"`: 4 commits scanned, no leaks found (run by me, independently of the builder's pre-commit hook) | See section 5 | PASS |
| AF-06 | Explainable line by line | Three short functions in `monthly-job.ts`, one SQL reader in `read.ts`, no new abstraction, the rules stated where they are encoded | Reviewer judgement; candidate understanding NOT established | PASS technically, walkthrough NOT REVIEWED WITH YOANN |
| AF-01, AF-02 | Deployed URL; live-vs-simulated labels | Out of this slice's scope: nothing is deployed or relabelled here | none | NOT RUN |

## 4. Findings

Severity key as in `docs/reviews/FINDINGS.md`: HIGH blocks the slice, MEDIUM must be fixed before
submission, LOW is fixed when cheap or disclosed. INFO is an observation, not a defect.

### F-MONTHLYSTATEMENTS-01 (LOW): a close that does not finish on the first day is never retried

Trigger: anything that stops the loop before the last broker, on the one day of the month it runs:
a serverless timeout, a transient database error (rethrown by design, `monthly-job.ts:153`), or a
blanket refusal (F-…-02). Consequence: the brokers after the cut have no statement for that month,
and the next invocation is on the first of the *next* month, for the *next* month, so the gap never
closes on its own. Recovery exists and is proven (a staff member re-runs the month by hand and gets
the identical hash), but nobody is told to: the miss is only visible in the JSON the cron caller
receives.

Measured relevance: the builder recorded ~20 minutes for 543 brokers and ~5 minutes for a fully
skipped pass on `corgi_test`; `vercel.json` sets no `maxDuration`, so the first-of-month invocation
is the one most likely to exceed the platform limit. On the trial database (a handful of brokers)
it is a second or two, which is why this is LOW and not MEDIUM.

Required correction (coordinator's call): either widen the rule from "the month that just ended" to
"any recent month whose definitive run is missing", so a later day catches up, or set an explicit
`maxDuration` and record the ceiling in the README as a known limitation.

### F-MONTHLYSTATEMENTS-02 (LOW): the cutoff comes from the web process clock, checked against the database clock

`route.ts:70` passes `now: new Date()` (the Node process clock) and `runStatement` refuses any
cutoff later than `select now()` on the database (`run.ts:79-88`). A forward skew of more than one
round trip between the web process and Postgres therefore refuses **every** broker: the month
produces zero statements, the job still answers 200, and per F-…-01 there is no second attempt. It
fails closed rather than wrong, which is why it is LOW.

Required correction: let `runStatement` default the cutoff to the database clock (pass
`knowledgeCutoff: undefined`) and keep `now` only for the "is it the first of the month / which
month ended" decision; or clamp `now` to `select now()` once at the top of the job. The check keeps
its determinism either way because it passes an instant firmly in the past.

### F-MONTHLYSTATEMENTS-03 (LOW): "exactly once" holds for sequential calls; two overlapping calls can publish twice, and two sentences promise otherwise

`definitiveStatementExists` then `runStatement` is a check-then-act with no constraint behind it:
the unique index is on `(broker_id, statement_month, revision)`, which prevents two runs claiming
the same revision number but not two *definitive* runs of the same month. Concrete interleaving:
call B evaluates the existence query while call A has not committed yet; A commits revision N; B
then reads the previous revision inside its own transaction, computes N+1 and commits. Both have a
cutoff after the month end, so the broker holds two definitive documents and the inbox lists both.
Reachable by a manual `POST /api/jobs/daily` with the cron secret while the cron is running, or by
an overlapping platform retry. No money effect, nothing rewritten, the later run legitimately
supersedes the earlier one, hence LOW.

What makes it a finding rather than an accepted limit is the wording: `monthly-job.ts:29-30` says
"a cron that fires twice, or a retry after a timeout, cannot hand a broker two documents for the
same month", and `README.md:119` says "a second call the same day, a retried cron or a manual
replay produces nothing". Both are true of sequential calls only.

Required correction: soften both sentences to name the sequential case, or make the guarantee real
(re-check inside `runStatement`'s transaction, or a new additive partial unique index on
definitive runs, a new migration and never an edit to an applied one).

### F-MONTHLYSTATEMENTS-04 (LOW): the "ties to the ledger to the cent" assertion of the new section compares 0 with 0

`scripts/check-statements.ts:936-940` (the report call at 936) is labelled "THE PRODUCED RUN TIES TO THE LEDGER TO THE CENT,
at its own knowledge cutoff, exactly as a manual run does" and both sides are structurally zero:
the fixture money is effective in the closed month but recorded *after* the cutoff, so the run has
nothing in it. My run printed `(statement 0, journal 0)`. The assertion cannot distinguish a
correct tie from a run that read the wrong month or nothing at all; the month itself is asserted
separately, and the non-zero tie is proven elsewhere in the file for manual runs only.

The builder recorded this honestly in the file's comments, and the limitation is inherent:
`recorded_at` is stamped by the database (0001/0003), so no fixture can be made visible to a cutoff
in the past. Two companion assertions carry the real weight (the same month reads 18000 at a cutoff
of now; a staff re-run with the job's cutoff reproduces the job's hash as revision 2,
`identical_to_previous`).

Required correction: rename the assertion so its label matches what it proves (for example "the
produced run and the ledger agree at the run's own cutoff, which for this fixture is zero on both
sides"), and keep the hash-reproduction assertion as the real tie evidence.

### F-MONTHLYSTATEMENTS-05 (LOW): "a month a staff member had already closed is not closed a second time" passes vacuously

`scripts/check-statements.ts:1001-1006` (the report call at 1003) compares broker A's run count before and after the close.
I probed `corgi_test` read-only after my run: for each of the three most recent "Statement check
broker A" rows, `movements_in_closed_month = 0` and `policies_in_force = 0` (its policy is
cancelled in section 2 and its journal is effective in 2028). Broker A is therefore never a
candidate of `brokersOwedAStatementFor`, so the assertion passes whether or not
`definitiveStatementExists` works, and its detail line ("its 2026-08 was published in section 1")
invites the wrong reading.

The skip rule is genuinely covered by the second-close assertion (brokers F and G still hold one
run each, 585 already published), so nothing is unproven; the assertion is simply not the proof it
claims to be.

Required correction: either give broker A a policy in force before section 9 so it really enters
the candidate list, or relabel the assertion "a broker the job does not owe a statement is left
untouched".

### F-MONTHLYSTATEMENTS-06 (LOW): the staff inbox count silently caps at 25

`MOST_STATEMENTS_IN_THE_INBOX = 25` keeps the badge equal to the list, which is the right call and
is what `check:inbox-counts` compares. But the label reads "25 statements produced this month"
whatever the real number is (on `corgi_test` the closes of this calendar month have published about
585 such runs), and neither the section title, the empty sentence nor the detail line says the list
is capped or where the rest are. The check printed `#statements 25/25` for both staff roles, so the
cap is already binding in practice.

Required correction: name the cap in the staff label or the section detail ("the 25 most recent;
the full list is on /ops/statements"). No code path changes.

### F-MONTHLYSTATEMENTS-07 (LOW): "a policy in force" is evaluated at close time, not against the statement month

`brokersOwedAStatementFor` reads `policy_current.status = 'bound'` as of the moment the job runs.
A broker who bound their first policy on the 20th of this month therefore receives a statement for
the month that ended before they were a client: net due 0, and the inbox says "Your statement for
&lt;month&gt; is ready". Harmless and arguably kinder than silence, but it is a judgement call the
implementation makes and no record states. The same reading also means a broker whose only policy
was cancelled last week gets no statement for a month in which it was live, unless money moved in
that month (in practice a cancellation moves money, so the second half is mostly theoretical).

Required correction: none in code. The coordinator should record the interpretation in
`docs/DECISIONS.md` (the builder could not: `docs/` was out of its scope), together with the two
other unrecorded calls the builder flagged: "job-produced" is recognised by `run_by is null` plus
a cutoff at or after the month end rather than by a new column, and the inbox cap of F-…-06.

### F-MONTHLYSTATEMENTS-08 (INFO): shape and cost notes, no action required for the trial

Three observations kept together because none is a defect:

1. One existence query plus one `runStatement` per broker, serially, with no bound on the candidate
   list; `journal_entries` carries no index on `(broker_id, effective_at)`, so the candidate query
   is a scan. This is the mechanical reason behind F-…-01's timings. At trial scale it is invisible.
2. `produceMonthlyStatements` takes a `database` argument, but `recordActivity` always writes
   through the module-level `sql` from `db/client`. Harmless here (both point at the same database
   under the check script, which redirects `DATABASE_URL_APP`), but the parameter is not the full
   injection point a reader would assume.
3. The job summary embeds `brokers: statements.produced` in full. With 543 documents that is a
   large JSON body on the cron response. Only the cron caller sees it.

## 5. Checks executed

All on the shared disposable database `corgi_test` where a database was needed, each command run
**once**, one at a time, at the reviewed revision.

| Command | Result |
|---|---|
| `npm run typecheck` | PASS, no output |
| `npm test` | PASS: 476 tests, 475 pass, 0 fail, 1 skipped (the pre-existing skip), 2 suites |
| `npm run check:statements` | **64 PASS / 0 FAIL**, `ALL CHECKS PASSED`, exit 0. Section 9: `month 2026-08, 7 produced, 578 already published, 0 refused`; `revision 1 of 2026-08, cutoff 2026-09-01T00:00:00.000Z, run by a job`; `7 rows for 7 statements`; second close `585 already published, 0 brokers created since the first close, brokers F and G still hold 1 and 1 run`; `2026-08-15 is not the first of a month`; `broker A still has 8 runs`; `revision 2, hash 72b637d78cf53fe9 identical true` |
| `npm run check:inbox-counts` | see the line below this table |
| `gitleaks detect --source=. --log-opts="main..HEAD"` (v8.30.1) | 4 commits scanned (`33018aa`, `3f05a02`, `f6a6005`, `ffa1b69`), ~38.9 KB, **no leaks found** |
| Read-only probe of `corgi_test` (three counts for "Statement check broker A") | Used only to test the assertion of F-…-05. Wrote nothing. Deleted after use |
| `npm run check:money-guards` | **NOT RUN**, per instruction: the coordinator proves the guards on an ephemeral database |

`npm run check:inbox-counts`: 53 PASS / 0 FAIL, `All inbox count checks passed`, exit 0. The two
staff rows read `staff_ops (1993 counted, 1993 listed; #approvals 207/207, #policies 20/20,
#endorsements 51/51, #claims 73/73, #reconciliation 1617/1617, #statements 25/25)` and
`staff_approver (1914 counted, 1914 listed; ... #statements 25/25)`; broker rows that hold a
statement read `#statements 1/1`. Coverage line: 50 of 1186 brokers and customers compared (the
most recent 25 of each role), 2 staff compared, one of each role.

Cross-session contention on `corgi_test`: none observed, and one useful side effect. My first close
found 578 brokers already published by the builder's earlier runs and produced only 7, which is
independent evidence that `definitiveStatementExists` skips across sessions and not merely within
one script. No fixture noise from other agents disturbed either run.

Environment note: this worktree carries neither `node_modules` nor `.env.local`. I symlinked the
repository's `node_modules` and copied `.env.local` in to run the checks, wrote the probe of the
line above as a temporary file at the worktree root, and removed all three afterwards; the only
tracked file this review adds is this record. No connection string, password or key was printed by any command I ran, and none is
quoted anywhere in this record.

## 6. What was not verified

- **The deployed behaviour.** Nothing was deployed and no HTTP request was made to any environment.
  `GET/POST /api/jobs/daily` was never invoked end to end, so the summary line of R8, the activity
  row of the job request itself and the correlation id shared between the job and its documents are
  supported by reading the code plus the check's direct call of `produceMonthlyStatements`, not by
  an observed HTTP response. AF-01 and AF-02 are consequently NOT RUN for this slice.
- **The refusal path (R9).** No check makes `runStatement` refuse inside the job; every executed
  assertion has `refused.length === 0`. The collection code is three lines and reads correctly, but
  a broker refused mid-month is untested behaviour.
- **The real cron trigger.** The job was never called on an actual first day of a month by Vercel;
  the first-day branch is exercised only by passing a first-of-month instant.
- **Concurrency.** F-…-03 is reasoned from the code (check-then-act, unique index scope) and was not
  reproduced: no test runs two closes in parallel.
- **The rendered screens.** No screen file changed and none was opened in a browser; the two new
  sections are proved by `lib/inbox/sections.test.ts` and by `check:inbox-counts` only. The
  interface session owns the visual side.
- **Volume.** I did not reproduce the builder's ~20-minute first-run measurement; my run started
  from a database where 578 brokers were already published, so it is not comparable.
- **Yoann's understanding.** Not established and not establishable by a reviewer.

## 7. Verdict

**PASS** at `ffa1b691fe1e21cc1d37c70b3a0f48874d090b7f`. Every requirement of the slice is
implemented and supported by evidence I executed myself; the four commands that could run all
passed; no HIGH and no MEDIUM finding. The eight findings above are LOW or INFO and none blocks
completion of the slice.

Residual limitations, for the coordinator rather than the builder: the recovery story of a close
that does not finish (F-…-01, F-…-02), the wording of the idempotency promise in `monthly-job.ts`
and `README.md` (F-…-03), and three interpretations that belong in `docs/DECISIONS.md` (F-…-07).
A technical PASS here is a scoped engineering assessment. It is not legal certification, not proof
that the deployed cron will behave as read, and not a statement about the integrated system.

## 8. Register lines for `docs/reviews/FINDINGS.md`

| ID | Sev | Finding (one line) | Fix | Status |
|---|---|---|---|---|
| F-MONTHLYSTATEMENTS-01 | LOW | A close interrupted on the first of the month is never retried; the remaining brokers get no statement until a human runs one | Catch up on a later day, or set an explicit `maxDuration` and disclose the ceiling | OPEN |
| F-MONTHLYSTATEMENTS-02 | LOW | The cutoff is the web process clock while `runStatement` validates it against the database clock; forward skew refuses the whole month | Default the cutoff to the database clock, or clamp `now` once at the top of the job | OPEN |
| F-MONTHLYSTATEMENTS-03 | LOW | "Exactly once" holds for sequential calls only; two overlapping closes can publish two definitive runs, and the code comment and README promise more | Soften both sentences, or enforce it (re-check in the transaction, or an additive partial unique index) | OPEN |
| F-MONTHLYSTATEMENTS-04 | LOW | The new "ties to the ledger to the cent" assertion compares 0 with 0 by construction | Rename it to what it proves; the hash-reproduction assertion carries the real weight | OPEN |
| F-MONTHLYSTATEMENTS-05 | LOW | "A month already closed is not closed twice" passes vacuously: broker A has no policy in force and no movement in the closed month, so the job never considers it (probed on `corgi_test`) | Give broker A a policy in force, or relabel the assertion | OPEN |
| F-MONTHLYSTATEMENTS-06 | LOW | The staff inbox count caps at 25 with nothing saying so; it already reads 25/25 of 585 on `corgi_test` | Name the cap in the label and point at `/ops/statements` | OPEN |
| F-MONTHLYSTATEMENTS-07 | LOW | "A policy in force" is read at close time, so a brand-new broker gets an empty statement for a month in which it had no policy; three interpretations are unrecorded | Record the three calls in `docs/DECISIONS.md` (coordinator; `docs/` was out of the builder's scope) | OPEN |
| F-MONTHLYSTATEMENTS-08 | INFO | Per-broker serial queries with no index on `(broker_id, effective_at)`; `recordActivity` ignores the injected `database`; the summary embeds every produced broker | None required at trial scale; noted as the mechanism behind F-…-01 | OPEN |
