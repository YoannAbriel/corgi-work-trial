# Slice B9 implementation notes (broker monthly statement tied to the ledger)

Written by the B9 delegate on 2026-09-08. Branch `worktree-agent-acc6bc5b711cdb318`, worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/agent-acc6bc5b711cdb318`, five commits
on top of `44ccc72`. Nothing was pushed, nothing was deployed, no shared planning file was edited.

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
  premium_collected  CGP-xxxxx  +125320   cash side of the premium_collected entry
  commission_earned  CGP-xxxxx   +18000   credit to commission_payable, 15% of the 120000 premium
  premium collected 125320, commission earned 18000, clawback 0, NET DUE 18000

June 2028 statement
  refund             CGP-xxxxx   -89172   87124 unearned premium + 2048 tax
  clawback           CGP-xxxxx   -13068   debit to commission_payable, 15% of 87124, rounded down
  premium collected 0, commission earned 0, clawback 13068, NET DUE -13068
```

The broker keeps 18000 - 13068 = 4932 cents, the commission on the premium the customer really
used. Both months tie to the ledger: 18000 and -13068 are the movements of `commission_payable`
for that broker in those months.

**Why commission is not 15% of "premium collected".** The premium collected line is the CASH side
of the ledger's `premium_collected` entry, so it is 125320: the premium, the state premium tax and
the policy fee together, which is what the customer actually paid. Commission is earned on the
premium alone (Yoann's rule), so 18000 is 15% of 120000. The screens and the PDF say this in words
next to the figures. See the open question in section 6.

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

## 6. Decisions the coordinator must put to Yoann

1. **The statement month is the EFFECTIVE date of the entry, not its recording date.** Implemented
   that way, as instructed. Consequence to know before the debrief: a payment collected on
   2028-03-01 is March money even if the webhook was processed in April, and a correction effective
   in March is March money even when it is recorded in June (it then lands in a new revision of the
   March statement). The alternative reading, "the month the money event was recorded in", would
   make every statement final on the last day of the month and would need no revisions at all,
   which is a different product. Changing it is one line in `lib/statements/journal.ts`, but it
   changes every figure, so it needs Yoann's word.
2. **"Premium collected" is the cash the customer paid, tax and fee included.** That is what the
   ledger books on a `premium_collected` entry and it is what the brief's wording maps onto, but it
   means the commission line is not that figure times the commission rate. The ledger holds the
   pieces (the `premium_written` entry of the same money operation is exactly the premium), so a
   later revision could split the line into premium, tax and fee. It is a display decision with no
   effect on net due.
3. **The clawback total is stored positive** ("how much was clawed back") while the clawback LINES
   are negative (they reduce what the broker is owed). The database CHECK states the relation:
   `net_due = commission_earned - clawback + adjustment`. Worth one sentence at the debrief because
   the screen shows the total with a minus sign in front of it.
4. **A statement can be run for a month that is not over.** Nothing refuses it, and the cutoff still
   makes it reproducible. If Yoann wants a monthly close to be possible only after the month ends,
   that is a refusal to add in `lib/statements/run.ts`.
5. **Only staff run a statement; a broker only reads.** A broker choosing the cutoff of their own
   commission statement is not a power we wanted to give. Not a money rule, but it is a rule.

## 7. Deviations from the assignment, and why

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

```
$ npm ci                                        clean install
$ npm run migrate -- --database=test            applied 0012_broker_statements.sql (corgi_test only)
$ npm run typecheck                             exit 0
$ npm run build                                 exit 0, 38 routes, the four new ones listed
$ npm test                                      291 tests, 290 pass, 1 skipped (the live Stripe test)
$ npm run check:statements                      30 of 30 PASS, exit 0
$ npm run check:refund-replay                   27 of 27 PASS, exit 0, unchanged by this slice
$ npm run check:money-guards -- --database=test  146 of 147 PASS, then 143 of 147 on a rerun
```

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
| `GET /statements/{run}`, staff | 200, "$1,253.20", "$180.00", "Net due", the ties line, the identical badge, "What changed against revision" |
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

- **The deployed application.** The screens, the forms and the PDF have only been exercised on a
  local dev server against the disposable database. Running them on the deployed URL, after the
  coordinator applies migration 0012 to the trial database, is the coordinator's.
- **Migration 0012 on the trial database.** Not applied from this worktree, as instructed.
- **A statement over a month with an endorsement** (slice B4, in parallel). An endorsement's
  collection and its commission go through the same `premium_collected` and `commission_earned`
  entries, so the statement should carry them without a change, but no run has seen one.
- **A statement for a broker whose money was parked in the suspense account and applied later.**
  The rule is covered by a unit test on the pure function and by the SQL adding both cash accounts
  together; no end-to-end run exercised it.
- **A month with more than a few hundred journal entries.** The query is a single grouped scan with
  an index on `journal_entries`, but no run of that size has been timed.
- **Independent review.** Not performed by this delegate, by design.
- **Walkthrough with Yoann: NOT REVIEWED WITH YOANN.**
