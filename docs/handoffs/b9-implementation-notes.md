# Slice B9 implementation notes (broker monthly statement tied to the ledger)

Written by the B9 delegate on 2026-09-08. Branch `worktree-agent-acc6bc5b711cdb318`, worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/agent-acc6bc5b711cdb318`. First seven
commits on top of `44ccc72`, then a merge of `main` (which carries B4 and the B9 merge) and the
follow-up that implements decision 19. Nothing was pushed, nothing was deployed, no shared
planning file was edited.

**Decision 19 (DECISIONS.md, 16:53Z) is implemented on this branch**, points 2 and 3: the
statement shows the cash collected AND the premium that is the commission base, and a run made
before its month is over is labeled provisional. Point 1 (the month is the effective date) was
already how the slice was built. Migration `0015_statement_commission_base.sql` carries the two new
columns; see section 7 for what changed and why.

## 1. Startup receipt

Read in full before writing any code: `CLAUDE.md`, `AUTOMATIC-FAILS.md`, `READABLE-CODE.md`,
`AGENTS.md`, `WORKFLOW-48H.md`, `REVIEWER.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (all
entries, in particular commission on collected premium, clawback rounded down, and "Closed-month
statements: knowledge cutoff and revisions" at 10:02Z), `docs/reviews/FINDINGS.md`,
`docs/PLAN.md` (row B9), `docs/handoffs/b2-implementation-notes.md`,
`docs/handoffs/b5-implementation-notes.md`, `docs/handoffs/b10-implementation-notes.md`.
`docs/STATUS.md` read as the head plus the last five sections (the file is 34 KB of history).

Existing code read in full: `db/migrations/0001` to `0008`, `0010`, `0011`, `db/client.ts`,
`lib/ledger/post.ts`, `policy-entries.ts`, `cancellation-entries.ts`, `reverse.ts`,
`lib/money/premium.ts`, `cents.ts`, `dates.ts`, `lib/reconciliation/ledger-side.ts`, `run.ts`,
`read.ts`, `lib/documents/render.tsx`, `format.ts`, `policy-snapshot.ts`, `lib/auth/session.ts`,
`current-user.ts`, `lib/policy/cancel.ts`, `void-fabricated-binding.ts`, `lib/stripe.ts`,
`lib/payments/refunds.ts` (the completion and recovery half) and `collection.ts` (the entry
points), `app/ops/page.tsx`, `app/ops/reconciliation/page.tsx`, `app/broker/page.tsx`,
`app/api/jobs/reconcile/route.ts`, `app/api/policies/[policyId]/cancel/route.ts`,
`scripts/check-reconciliation.ts`, `check-money-guards.ts`, `seed.ts`, `migrate.ts`,
`void-fabricated-binding.ts`, `app/globals.css`, `package.json`, `.gitignore`,
`.githooks/pre-commit`.

Not read: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`,
`GAP-REVIEW.md` (advisory catalogues, outside this slice), `docs/COMPLIANCE-MATRIX.md`,
`docs/ATTACK-PLAN.md`. Absent files: none of the mandatory files were missing. `.env.local` was
copied from the main checkout into the worktree and never printed, logged or committed.

Acceptance criterion worked on: `docs/PLAN.md` row B9. Planned checks, all executed:
`npm run typecheck`, `npm run build`, `npm test`, `npm run migrate -- --database=test`, the new
`npm run check:statements`, `npm run check:money-guards -- --database=test`,
`npm run check:refund-replay`, and an HTTP walk of every new screen and route on a dev server.

## 2. What the slice does

A broker statement is one broker's commission account for one calendar month, read from the
journal and frozen. It carries the four figures the brief asks for (premium collected, commission
earned, clawbacks, net due) and two dates that make a closed month reproducible, exactly as Yoann
decided at 10:02Z:

| date | what it selects | why it matters |
|---|---|---|
| statement month | journal entries whose `effective_at` falls inside it | the BUSINESS month the money belongs to |
| knowledge cutoff | entries whose `recorded_at` is at or before it | what we KNEW at that instant |

A third property falls out of those two: **a run whose cutoff falls before the month is over is
provisional** (decision 19, point 3). The question is asked against the run's OWN cutoff, never
against the reader's clock, so a statement produced on March 12 is provisional and stays
provisional forever, and the run made once April started is the definitive one. It is derived from
the two stored dates rather than stored, so it cannot drift. Worth knowing at the debrief: the demo
policies are dated 2028 while the clock says 2026, so the March 2028 statement is correctly marked
provisional; `scripts/check-statements.ts` proves both cases, the provisional one on March 2028 and
the definitive one on the calendar month before today.

Running the same month again with the same cutoff reads exactly the same journal entries, because
`recorded_at` is stamped by the database and a journal row can never change. It therefore produces
the same content hash, and the re-run is stored as a new revision flagged as identical. A
correction recorded after the cutoff is invisible to that run and appears in the next revision,
which names the one it supersedes. Nothing is ever rewritten.

**Net due is the movement of the broker's `commission_payable` account for the month.** That is
the invariant the whole slice rests on: the pure computation refuses to produce a statement if any
entry that moved the payable was left off a line, and the statement page recomputes the movement
live with a second, much smaller query and shows whether it equals the stored figure.

## 3. The reading path, file by file

Read in this order. One sentence each.

1. `db/migrations/0012_broker_statements.sql` - the two tables, their guards, their grants, and the
   CHECK constraints that stop a run from publishing arithmetic that does not add up.
2. `lib/statements/compute.ts` - **THE FILE TO READ FIRST if you only read one.** The whole
   statement: journal entries in, lines and totals and a hash out, no database, no clock, no
   provider. Every rule in it is a test in `compute.test.ts`.
3. `lib/statements/journal.ts` - the one SQL query a run makes, and the separate small query that
   asks the ledger for the same month's commission payable movement on its own.
4. `lib/statements/run.ts` - the job: read, compute, then store the run and its lines in one
   transaction; what a re-run does and why the cutoff comes from the database clock.
5. `lib/statements/read.ts` - what the screens read: the runs, one run with its lines, and what
   changed against the revision it supersedes.
6. `lib/statements/pdf.tsx` - the document, built only from what the run stored.
7. `app/ops/statements/page.tsx` - the staff screen: run a statement, and every run ever made.
8. `app/statements/[runId]/page.tsx` - the statement itself, for staff and for the owning broker,
   with the "ties to the ledger" line.
9. `app/broker/statements/page.tsx` - the broker's own list, read-only.
10. `app/api/statements/run/route.ts` and `app/api/statements/[runId]/pdf/route.ts` - the two
    doors, each asking the role and ownership question itself.
11. `scripts/check-statements.ts` - the proof, end to end, on the disposable database.

## 4. The money, in one worked example

The recited example (DECISIONS.md): $1,200 annual premium written and paid on 2028-03-01,
California premium tax 2820 cents, $25 fee, 15% commission, cancelled effective 2028-06-09 with
the refund completing the same day.

```
March 2028 statement
  premium_collected  CGP-xxxxx  cash +125320   of which premium +120000
  commission_earned  CGP-xxxxx       +18000    15% of the 120000
  cash collected 125320, premium collected 120000, commission earned 18000, NET DUE 18000

June 2028 statement
  refund             CGP-xxxxx  cash -89172    of which premium -87124
  clawback           CGP-xxxxx       -13068    15% of the 87124, rounded down
  cash collected 0, premium collected 0, clawback 13068, NET DUE -13068
```

The two collected totals count COLLECTIONS only: a refund is money going the other way, so it stays
a line next to the clawback it produced rather than being netted into a total called "collected".

The broker keeps 18000 - 13068 = 4932 cents, the commission on the premium the customer really
used. Both months tie to the ledger: 18000 and -13068 are the movements of `commission_payable`
for that broker in those months.

**Both money figures, and where the premium comes from** (decision 19, point 2). The cash side of a
collection entry is what the customer paid; commission is earned on the premium alone, so 18000 is
15% of 120000 and not of 125320. The premium is not recomputed from a rate: it is the movement of
`unearned_premium` posted by the SAME money operation as the cash entry (`premium_written` at
issuance, `endorsement_premium_written` on an endorsement, `refund_requested` on a refund). Each of
those moves the account the same way round as the cash, so one sum over the operation's entries
answers the question for every case, reversals included. The subquery is bounded by the same cutoff,
so a sibling entry recorded later cannot change a figure a closed month already published; it is
deliberately NOT bounded by the month, because premium is written on the policy effective date,
often an earlier month than the day the money arrived.

## 5. What is on a statement, and what is not

Two selection rules, and the second one is what makes net due true:

1. **Every entry that moves the broker's `commission_payable` is on the statement**, whatever its
   type. An entry type nobody anticipated becomes an `adjustment` line rather than being dropped.
2. **The collections and the refunds are on it too**, because they are the cash the commission and
   the clawback were computed on. They add nothing to net due.

Everything else in the journal (writing premium, billing tax, earning premium, claim money) is not
a movement of what the broker is owed and is deliberately absent.

One case is worth saying out loud because it looks like an omission: money parked in the suspense
account for a broker who lost eligibility (`unapplied_cash_received`, rule 14) is NOT on the
statement of the month it arrived in. No policy was bound and no commission was earned on it. When
staff bind the policy later, the `premium_collected` entry that applies the parked cash appears on
the statement of the month of that application, and the commission with it. The cash is therefore
counted exactly once, in the month it becomes premium.

Reversals need no special arithmetic: a reversal entry carries the mirror image of the original
lines (`lib/ledger/reverse.ts`), so its movement is already the opposite sign, and the line kind is
found by stripping the `reversal_of_` prefix. A voided binding therefore contributes +125320 and
-125320, +18000 and -18000 in the same month and nets to zero on its own, with all four lines
visible: nothing is hidden, the statement shows the money and the correction that took it back.

## 6. Decisions, three of them now settled by Yoann

Points 1 to 3 below were put to Yoann and decided at 16:53Z (DECISIONS.md, decision 19). They are
implemented on this branch.

1. **The statement month is the EFFECTIVE date of the entry, not its recording date.** DECIDED as
   built. "Mars reste mars": a correction recorded on June 20 with effect on March 1 becomes
   revision 2 of the March statement, dated June 20, and is never a line of June.
2. **Both money figures are shown.** DECIDED: the cash collected (125320) and the premium that is
   the commission base (120000), so that 120000 x 15% = 18000 reads on the line. Migration 0013
   adds `statement_runs.cash_collected_cents` and `statement_lines.commission_base_cents`, and
   `premium_collected_cents` now holds the premium alone (see section 7).
3. **A month that is not over may be run.** DECIDED: the run is immutable like any other and is
   labeled "month in progress, provisional" on both screens and on the PDF; the run made at month
   end is the next revision and the definitive one.
4. **The clawback total is stored positive** ("how much was clawed back") while the clawback LINES
   are negative (they reduce what the broker is owed). The database CHECK states the relation:
   `net_due = commission_earned - clawback + adjustment`. Worth one sentence at the debrief because
   the screen shows the total with a minus sign in front of it.
5. **Only staff run a statement; a broker only reads.** A broker choosing the cutoff of their own
   commission statement is not a power we wanted to give. Not a money rule, but it is a rule.

## 7. Deviations from the assignment, and why

- **Migration 0013 changes what `statement_runs.premium_collected_cents` MEANS.** Before it, the
  column held the cash; from it, the premium alone, which is what "premium collected" means in
  Yoann's commission rule, with the new `cash_collected_cents` holding what the customer paid. This
  was done rather than worked around because it was provably safe: when 0013 was written the trial
  database held the statement tables and ZERO published runs (checked read-only), so no statement
  anybody has ever been shown carries the old meaning. Only the disposable database held rows, and
  they are test fixtures.
- **The canonical text that is hashed went from `corgi.broker-statement.v1` to `v2`** with the same
  change, because the document now says more. A run made under v1 keeps its lines, its totals and
  its hash forever, and a re-run today is a new revision that is honestly NOT flagged identical to
  it. The version marker is the first line of the hashed text, so this is visible rather than
  implicit. No v1 run had been published.
- **The endorsement entry types of slice B4 are now recognised.** `endorsement_premium_collected`
  and `endorsement_commission_earned` map to the same statement lines as their issuance
  counterparts. Without that they would have read as an "adjustment" and the endorsement's cash
  would have been missing from the statement. Covered by a unit test on the pure function; no end
  to end run has produced an endorsement statement yet (see section 10).

- **Two extra columns beyond the four totals the assignment named.** `adjustment_cents` exists so
  that net due is ALWAYS the movement of `commission_payable` and never an approximation of it: an
  entry type a later slice adds that touches the payable lands there instead of being silently
  dropped. It is zero in this build. `identical_to_previous` is stored rather than derived, so the
  run list needs no self-join, which is the same reasoning as the counts on `reconciliation_runs`.
- **The statement detail page is `/statements/{runId}`, not under `/ops` or `/broker`.** It is the
  same document for both audiences, and duplicating it would have meant two places to keep honest.
  The two lists (`/ops/statements` and `/broker/statements`) are separate, as asked, and both link
  to it. The page asks the ownership question itself, and so does the PDF route.
- **"What changed against the previous revision" is computed on read, not stored.** A statement
  line is one journal entry and entries are immutable, so the difference between two revisions can
  only be "these entries appeared" and "these are no longer there". Computing it from the two runs'
  lines cannot drift; storing it could.
- **The default knowledge cutoff comes from the DATABASE clock**, not from `new Date()` in the
  application. `recorded_at` is stamped by Postgres, so a web server whose clock runs a second
  behind would silently drop entries that were already recorded. One extra `select now()` per run.
- **A link to `/broker/statements` was added on `/broker`** (one line). The assignment only asked
  for the `/ops` link, but a broker had no way to reach their own statements. Watch for a conflict
  with slice B4, which may be editing the same paragraph.
- **`scripts/check-money-guards.ts` fixture now also creates a journal entry.** A statement line
  has to name a real journal entry, and the fixture type gained a `journal_entries` key for it.
  Every existing check is unaffected; the fixture is always rolled back.

## 8. Known limitation, stated rather than discovered at a debrief

A cutoff taken while money is being posted can miss an entry whose transaction had not committed
yet, and a later re-run with that same cutoff would then see it and produce a different hash.
Postgres stamps `recorded_at` with the transaction's start time, so an entry's recording time can
be below a cutoff the run has already passed. It cannot happen for a month that is closed and
quiet, which is what a monthly statement is for; a run taken in the middle of live activity is an
interim view and is not promised to reproduce. This is written in the header of
`lib/statements/run.ts` as well.

Second, smaller one: a statement line carries the entry's recording time to the MILLISECOND, since
Postgres keeps microseconds and a JavaScript Date keeps milliseconds. It is deterministic (the same
row always reads back to the same instant), which is all the content hash needs, and
`scripts/check-statements.ts` compares the two at that resolution.

## 9. Commands actually run, with results

All from the worktree root. The trial database was never migrated and never written to.

Before the merge of main and decision 19:

```
$ npm ci                                        clean install
$ npm run migrate -- --database=test            applied 0012_broker_statements.sql (corgi_test only)
$ npm run typecheck                             exit 0
$ npm run build                                 exit 0, 38 routes, the four new ones listed
$ npm test                                      291 tests, 290 pass, 1 skipped (the live Stripe test)
$ npm run check:statements                      29 of 29 PASS, exit 0
$ npm run check:refund-replay                   27 of 27 PASS, exit 0, unchanged by this slice
$ npm run check:money-guards -- --database=test  146 of 147 PASS, then 143 of 147 on a rerun
```

After the merge of main (B4 included) and decision 19:

```
$ git merge main                                clean, no conflict
$ npm run migrate -- --database=test            applied 0015_statement_commission_base.sql
$ npm run typecheck                             exit 0
$ npm run build                                 exit 0
$ npm test                                      333 tests, 332 pass, 1 skipped
$ npm run check:statements                      34 of 34 PASS, exit 0
```

The guards were NOT run again after the merge, on the coordinator's instruction: the disposable
database is contended by several agents and the TRUNCATE probes deadlock there, so the coordinator
proves them on an ephemeral database at merge time.

The six proof lines decision 19 adds:

```
PASS  the March statement is the recited example: 125320 cash, 120000 premium, 18000 earned
PASS  THE COMMISSION READS ON THE LINE: 15% of the premium collected is the commission earned
      (120000 x 15% = 18000, against 125320 of cash)
PASS  the collection line carries the premium inside the cash, and the commission line carries none
PASS  the clawback reads on the line too: 15% of the premium given back is the commission taken back
      (refund cash -89172 of which premium -87124, clawback 13068)
PASS  a run made before its month is over is marked provisional
PASS  a run of a month that is over is definitive, not provisional
```

A note on counting, since the coordinator saw 29 where the first version of this file said 30: the
script prints one line per check and then a summary line, and the summary line contains the word
PASSED, so counting lines that hold "PASS" gives one more than there are checks. The script has 29
checks before decision 19 and 34 after it.

The PDF is no longer only asserted to be a PDF: `lib/statements/pdf.test.ts` renders one and reads
the text back out of the file with the repository's own reader (`lib/documents/pdf-text.ts`), so
the cash, the premium, the commission, the revision, the cutoff, the hash and the provisional
banner are proved to be printed.

**The money-guards failures are lock contention, not guard failures, and they are on tables this
slice does not touch.** `corgi_test` is shared, and three `check:money-guards` processes from other
agents were running against it at the same time (verified with `ps`); its TRUNCATE probes take an
ACCESS EXCLUSIVE lock, so they deadlock against each other. First run: one FAIL, `owner cannot
TRUNCATE approval_requests (deadlock detected)`. Rerun: four, on `brokers`, `policies`, `claims`
and `approval_requests`, all `deadlock detected`. **All 19 checks this slice adds passed in both
runs**: the six privilege checks on `statement_runs` and `statement_lines`, the six owner
UPDATE/DELETE/TRUNCATE checks on them, and the seven shape checks of migration 0012. The
coordinator proves the whole set on an ephemeral database at merge time.

The trial database was read once, read-only, to confirm it was untouched: its last applied
migration is `0011_reconciliation.sql` and it holds zero `statement%` tables.

`npm run check:statements`, the lines that matter:

```
PASS  the March statement is the recited example: 125320 collected, 18000 earned, nothing clawed back
PASS  it lists exactly the two journal entries a collection produces for a broker
PASS  every line names the journal entry it came from, and that entry really exists
PASS  another broker's money is not on this broker's statement
PASS  THE STATEMENT TIES TO THE LEDGER: net due is the movement of commission_payable, to the cent
PASS  RE-RUNNING THE CLOSED MONTH WITH ITS OWN CUTOFF PRODUCES THE SAME CONTENT HASH
PASS  the re-run is stored as revision 2 and names revision 1 as the run it supersedes
PASS  the re-run is flagged as identical to the revision it supersedes
PASS  nothing was rewritten: revision 1 is still readable with its own figures and its own hash
PASS  A CORRECTION RECORDED AFTER THE CUTOFF IS INVISIBLE TO A RUN WITH THAT CUTOFF: same hash
PASS  A FRESH RUN IS A NEW REVISION SHOWING THE CORRECTED FIGURE: the clawback of 13068
PASS  the revision says WHAT CHANGED against the previous one, by journal entry id
PASS  the corrected June statement ties to the ledger to the cent
PASS  over the two months the broker keeps the commission on the premium the customer really used
PASS  A VOIDED OPERATION NETS TO ZERO: the collection, the commission and their reversals cancel out
PASS  a knowledge cutoff in the future is refused
PASS  the runtime role cannot rewrite a published statement
PASS  the runtime role cannot delete the lines of a published statement
PASS  the statement renders as a real PDF file  (4313 bytes starting with %PDF-)
```

The check leaves its own brokers, policies and statement runs in `corgi_test` and creates fresh
ones on every run, so it is repeatable and never collides with another slice's rows. It makes one
read-only call to the real Stripe sandbox (the void asks whether the payment intent exists) and
creates nothing there.

### The screens and routes over HTTP

A dev server on port 3500 pointed at the DISPOSABLE database (a git-ignored `.local/` aid, because
the trial database has no 0012 tables yet), signed in with real session cookies. The server was
stopped afterwards and port 3500 is free.

| Call | Answer |
|---|---|
| `GET /ops/statements`, no session | 307 to `/login` |
| `GET /broker/statements`, no session | 307 to `/login` |
| `GET /statements/{run}`, no session | 307 to `/login` |
| `GET /api/statements/{run}/pdf`, no session | 401 |
| `POST /api/statements/run`, no session | 303 to `/login?error=Please+sign+in+again` |
| `GET /ops/statements`, staff | 200, the form and the run list |
| `GET /statements/{run}`, staff | 200, "$1,253.20" cash and "$1,200.00" premium and "$180.00" commission, the "Premium in it" column, "Net due", the ties line, the identical badge, the provisional badge, "What changed against revision" |
| `GET /api/statements/{run}/pdf`, staff | 200 `application/pdf`, 4317 bytes |
| `GET /statements/not-a-uuid` and the pdf route | 404, not a 500 |
| `GET /statements/{unknown uuid}` | 404 |
| `POST run` with month `2028-3` | 303 back with "is not a statement month; write it as YYYY-MM" |
| `POST run` with cutoff "last tuesday" | 303 back with "is not an instant" |
| `POST run` with an unknown broker | 303 back with "this broker does not exist" |
| `POST run`, valid | 303 to `/statements/{new run}` |
| `GET /broker/statements`, broker | 200, own months only |
| `GET /statements/{own run}`, broker | 200 |
| `GET /statements/{another broker's run}`, broker | 200 with "This statement belongs to another broker" and no figure |
| `GET /api/statements/{another broker's run}/pdf`, broker | 404 |
| `GET /ops/statements`, broker | 307 to `/broker` |
| `POST /api/statements/run`, broker | 303 back with "only staff operations can run a broker statement" |

## 10. What was NOT verified here

- **The guards after the merge.** See section 9: not rerun, on the coordinator's instruction.

- **The deployed application.** The screens, the forms and the PDF have only been exercised on a
  local dev server against the disposable database. Running them on the deployed URL, after the
  coordinator applies migration 0012 to the trial database, is the coordinator's.
- **Migration 0012 on the trial database.** Not applied from this worktree, as instructed.
- **A statement over a month with an endorsement.** B4 is merged and its entry types are now
  recognised and unit-tested (`endorsement_premium_collected` and `endorsement_commission_earned`),
  but no end to end run has produced a statement containing a real endorsement. Worth one run by
  the coordinator on the deployed app.
- **A statement for a broker whose money was parked in the suspense account and applied later.**
  The rule is covered by a unit test on the pure function and by the SQL adding both cash accounts
  together; no end-to-end run exercised it.
- **A month with more than a few hundred journal entries.** The query is a single grouped scan with
  an index on `journal_entries`, but no run of that size has been timed.
- **Independent review.** Not performed by this delegate, by design.
- **Walkthrough with Yoann: NOT REVIEWED WITH YOANN.**
