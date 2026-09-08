# B9 independent review: broker monthly statement, knowledge cutoff, revisions, PDF

Reviewer: independent sub-agent, no authorship of any B9 code.
Written 2026-09-08T17:10:00+00:00.
Reviewed revision: `44188bd` (the B9 merge). Working tree clean at review start (`a89d81b`); other
agents merged LOW-finding fixes onto `main` during the review, so the code was re-read at
`9a8f7ae` and the only change inside the B9 scope is noted in F-B9-06.
Deployed revision checked: `/api/health` reported
`44188bdf4880f8fae52a21ebe4cbf993462c69ff` at 17:02:24Z, so every HTTP check below ran against the
revision under review.

**Verdict: FAIL.** One HIGH finding (F-B9-01). Net due is correct and ties to the ledger in every
case tested, including on the trial database; but two of the four figures the brief asks a broker
statement to carry are wrong for any month containing an endorsement, and endorsements are already
merged and deployed (B4, `dfdca38`).

Walkthrough status: **NOT REVIEWED WITH YOANN.**

**Read section 9 before acting on this record.** The decision 19 follow-ups landed on `main` while this review was being written. Section 9 is the independent re-check at `afeba97`: it resolves F-B9-01 and raises a new HIGH, F-B9-09. The verdict at `afeba97` is also FAIL, for a different reason.

## 1. Startup receipt

Read in full, in this order: `CLAUDE.md`, `AUTOMATIC-FAILS.md`, `READABLE-CODE.md`, `AGENTS.md`,
`WORKFLOW-48H.md`, `REVIEWER.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (all entries,
including commission on collected premium, clawback rounded down, closed-month statements with a
knowledge cutoff at 10:02Z, and decision 19 at 16:53Z), `docs/handoffs/b9-implementation-notes.md`.
Read by targeted search: `docs/reviews/FINDINGS.md` (the statement rows and the B9 context),
`docs/STATUS.md` (head plus the last six sections, the file is 39 KB of history), `README.md` (the
deployed URL and demo users).

Code read line by line: `db/migrations/0012_broker_statements.sql`, `lib/statements/compute.ts`,
`journal.ts`, `run.ts`, `read.ts`, `pdf.tsx`, `compute.test.ts` (test list), `app/ops/statements/page.tsx`,
`app/broker/statements/page.tsx`, `app/statements/[runId]/page.tsx`,
`app/api/statements/run/route.ts`, `app/api/statements/[runId]/pdf/route.ts`,
`scripts/check-statements.ts`, the statement probes added to `scripts/check-money-guards.ts`.
Read as context because the statement reads what they post: `lib/ledger/post.ts`, `reverse.ts`,
`policy-entries.ts`, `cancellation-entries.ts`, `endorsement-entries.ts`, `db/client.ts`,
`lib/payments/collection.ts` (the binding transaction), `db/migrations/0001` (the recorded_at
trigger).

Not read: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`,
`GAP-REVIEW.md`, `docs/COMPLIANCE-MATRIX.md`. Absent files: none.

Applicability: this slice moves no money and touches no provider. It reads the application's own
ledger and appends an immutable document. The requirements in scope are the trial's Track 1
statement requirement, AF-03 (append-only money rows), AF-06 (explainability) and the
authorisation rules of `AGENTS.md`. No external legal regime is engaged by a read of an internal
ledger, so no new source was consulted; the California premium tax basis was already settled in
DECISIONS.md and is not re-opened here.

## 2. Findings

| ID | Sev | Finding |
|---|---|---|
| F-B9-01 | HIGH | A month containing an endorsement drops the endorsement cash from "premium collected" and files the endorsement commission under "adjustment" instead of "commission earned" |
| F-B9-02 | MEDIUM | The statement page and the PDF promise unconditional reproducibility that the code cannot give for a month still open |
| F-B9-03 | MEDIUM | The handoff note names the wrong month for parked-then-applied cash; the code is right and the written explanation is wrong |
| F-B9-04 | LOW | `POST /api/statements/run` answers 500 on a malformed `brokerId` instead of refusing it |
| F-B9-05 | LOW | The detail page answers 200 with a message to a non-owner while the PDF route answers 404 for the same request |
| F-B9-06 | LOW | Duplicated uuid guard on the statement page and PDF route after `9a8f7ae` |
| F-B9-07 | LOW | The refusal message says "only staff operations", but `staff_approver` may also run a statement |
| F-B9-08 | LOW | Long descriptions overprint in the PDF description column |

### F-B9-01 (HIGH): a month with an endorsement misreports two of the four required figures

**Trigger.** Slice B4 posts `endorsement_premium_collected` (cash into `cash_stripe` or
`unapplied_customer_cash`) and `endorsement_commission_earned` (credit to `commission_payable`),
in `lib/ledger/endorsement-entries.ts`. B9 does not know either name.

- `lib/statements/journal.ts:44-49` lists the cash entry types by hand. `endorsement_premium_collected`
  is not in the list and moves no payable, so the `HAVING` clause at lines 76-78 drops the entry
  entirely. The endorsement cash never reaches the statement, not even as a line.
- `lib/statements/compute.ts:166-191` matches four literal names. `endorsement_commission_earned`
  matches none of them and falls into the catch-all `adjustment` branch at line 187.

**Consequence.** Premium collected understates the cash by the endorsement amount, commission
earned understates the commission by the endorsement commission, and the difference reappears
under a generic "Adjustment" label. Net due stays correct, so the ledger tie holds and nothing is
lost, but the migration comment (`adjustment_cents ... Zero in this build`) and the delegate's
notes are both untrue as soon as an endorsement is priced. The staff and broker LIST screens have
no adjustment column at all (`app/ops/statements/page.tsx:107-110`,
`app/broker/statements/page.tsx:65-68`), so on those tables premium, commission and clawback
visibly do not add up to net due.

**Evidence.** Probe on the disposable database `corgi_test`, using B4's own entry builder and
`lib/ledger/post.ts`, then the production `runStatement`:

```
posted endorsement entry types: endorsement_premium_written, endorsement_tax_billed,
                                endorsement_premium_collected, endorsement_commission_earned
lines:
  premium_collected     125320  Policy CGP-03634 premium, tax and fee collected at Stripe
  commission_earned      18000  Broker commission on the collected premium of policy CGP-03634
  adjustment              6534  Broker commission on the endorsement premium collected for CGP-03634
totals: premiumCollected 125320, commissionEarned 18000, clawback 0, adjustment 6534, netDue 24534
ledger commission_payable movement: 24534  net due: 24534 TIES
EXPECTED cash collected in March = 125320 + 44584 = 169904   REPORTED 125320
EXPECTED commission earned       = 18000 + 6534  =  24534    REPORTED 18000
```

**Required correction.** Add `endorsement_premium_collected` and
`reversal_of_endorsement_premium_collected` to `CASH_ENTRY_TYPES`, and recognise
`endorsement_commission_earned` in `classify` as `commission_earned`. Add the case to
`lib/statements/compute.test.ts` and one end-to-end proof to `scripts/check-statements.ts`. The
endorsement refund path needs no change: a negative delta completes through
`refundCompletedEntries`, so it posts `refund_completed` and `commission_clawback`, which B9
already handles (verified in `lib/payments/refunds.ts:440`).

### F-B9-02 (MEDIUM): the published document promises more than the code can give

`lib/statements/pdf.tsx:180-184` and `app/statements/[runId]/page.tsx` both state, without
qualification, that re-running the month with the printed cutoff "reads the same journal entries
and produces the same content hash". `set_recorded_at_from_database_clock` uses `now()`, which is
the transaction start time (`db/migrations/0001`, line 24), so an entry whose transaction began
before the cutoff and committed after it is invisible to the run and visible to a later re-run
with the same cutoff, giving a different hash for the same cutoff. The delegate states this
honestly in `lib/statements/run.ts:35-41` and in section 8 of its notes; the document a broker
receives does not. Decision 19 explicitly allows running a month that is not over, which is
exactly when this happens. Correction: qualify the sentence on the page and the PDF, or restrict
the unconditional claim to a month that has ended. The follow-up "month in progress, provisional"
label the delegate is adding may carry the caveat; the wording still needs checking when it lands.

### F-B9-03 (MEDIUM): the note names the wrong month for parked cash

`docs/handoffs/b9-implementation-notes.md` section 5 says the `premium_collected` entry that
applies parked cash "appears on the statement of the month of that application". It does not.
`postCollectionAndBind` dates that entry `payment.paidOn` (`lib/payments/collection.ts:148`), so
it belongs to the month the cash arrived, whatever month staff bind in. The behaviour is correct
and is exactly what decision 19 asks for; only the written explanation is wrong, and it is the
explanation Yoann would recite.

**Evidence.** Probe on `corgi_test`: payment succeeds 2028-03-31 while the broker is not eligible
(`binding_refused`), the March statement is empty, the broker becomes eligible, staff bind today.

```
journal entries: unapplied_cash_received eff=2028-03-31 rec=2026-09-08T17:01:24
                 premium_collected       eff=2028-03-31 rec=2026-09-08T17:01:28
                 commission_earned       eff=2028-03-31 rec=2026-09-08T17:01:28
March statement AFTER the binding: revision 2, superseding revision 1
  premium_collected  125320  "applied from the customer's unapplied cash"
  commission_earned   18000
  totals netDue 18000, ledger movement 18000 TIES
April statement (the month the binding was RECORDED in): 0 lines, everything zero
```

The cash is counted exactly once, and it is counted in March. The same probe proves the month
boundary: an entry effective on the last day of the month is inside it, and April is empty.

### F-B9-04 (LOW): 500 on a malformed broker id

`app/api/statements/run/route.ts:23` takes `brokerId` as a raw string and passes it to
`lib/statements/run.ts:89`, where it reaches a `uuid` column. On the deployed app, as `ops`:

```
month=2026-9              -> 303 "...is not a statement month; write it as YYYY-MM"
cutoff=last tuesday       -> 303 "...is not an instant; write it as 2028-04-01T00:00:00Z"
unknown broker uuid       -> 303 "this broker does not exist"
brokerId=not-a-uuid       -> 500
```

Staff-only, so nothing is exposed, but it is the same class of defect `2a0737a` closed for path
ids (F-B7-07), and it is still open on `main` at `9a8f7ae`. One `isUuid` call fixes it.

### F-B9-05 (LOW): the two doors answer differently to a non-owner

`app/statements/[runId]/page.tsx:59-66` returns 200 with "This statement belongs to another
broker" and no figures; `app/api/statements/[runId]/pdf/route.ts:36-39` returns 404 with the
comment "an outsider learns nothing about which statements exist". Both refusals are effective and
neither leaks a figure, but they disagree about what a stranger is allowed to learn. Confirmed on
the deployed app for a second broker and for a customer.

### F-B9-06 (LOW): duplicated uuid guard

`9a8f7ae` added `isUuid(runId)` and `badPathIdResponse` in front of the `UUID` regex that was
already in the same function (`app/statements/[runId]/page.tsx:49-53`,
`app/api/statements/[runId]/pdf/route.ts:25-32`). Two guards answer one question; the second is
now dead code. Harmless, but it is exactly the kind of line a reviewer points at under AF-06.

### F-B9-07 (LOW): the refusal message names the wrong role

`app/api/statements/run/route.ts:18-20` admits `staff_ops` and `staff_approver`, then refuses
everyone else with "only staff operations can run a broker statement". Admitting the approver is
the right call (they are staff, and running a statement moves no money); the message should say
so.

### F-B9-08 (LOW): the PDF overprints long descriptions

The correction description on CGP-01061 overruns its column and overprints in the rendered file
(`pi_local_fafe3cc` is cut mid-token). Cosmetic only; the PDF visual pass is already assigned to
the interface session.

## 3. The five questions, answered with evidence

### 3.1 Does it tie to the ledger to the cent?

Yes, in every case tested, including the deployed app against the trial ledger.

Every figure comes from journal lines. `lib/statements/journal.ts:55-80` is the only query a run
makes: it joins `journal_entries` to `journal_lines` and reduces each entry to two signed
movements, cash (`cash_stripe` plus `unapplied_customer_cash`, debits minus credits) and
`commission_payable` (credits minus debits). No cache, no `policy_current`, no rate table: I grep
verified that `lib/statements/` reads neither.

Net due is the payable movement by construction and by assertion. `lib/statements/compute.ts:129-134`
sums `commissionPayableCents` over every entry the query returned and throws if the totals differ,
so an entry that moved the payable and was left off a line makes the statement refuse to be
produced rather than understate what a broker is owed. The screen then asks the ledger a second
time, through a separate small query (`commissionPayableMovementCents`), and prints whether the two
agree.

Reversals carry the mirrored lines and the **same** `effective_at` as the original
(`lib/ledger/reverse.ts:51-58`), so a reversal can never land in a different statement month from
the entry it undoes, and its movement is already the opposite sign. A voided binding therefore
shows all four lines and nets to zero.

Parked-then-applied cash counts as collected: the applying `premium_collected` debits
`unapplied_customer_cash`, which is inside the cash filter, so it is `+125320` (proven above under
F-B9-03).

Recited example, reproduced through `npm run check:statements` on `corgi_test`:

```
PASS  the March statement is the recited example: 125320 collected, 18000 earned, nothing clawed back
PASS  the cancellation and its completed refund posted the recited clawback  (refund 89172, clawback 13068)
PASS  over the two months the broker keeps the commission on the premium the customer really used  (18000 + -13068 = 4932)
PASS  A VOIDED OPERATION NETS TO ZERO  (4 lines adding up to 0, net due 0)
PASS  THE STATEMENT TIES TO THE LEDGER: net due is the movement of commission_payable, to the cent
```

On the trial database, September 2026 for Redwood Commercial Brokers, run as `staff_ops` through
the deployed app. I computed the expected figures first with a read-only query of my own, then ran
the statement:

| figure | my read of the ledger | the statement |
|---|---|---|
| premium collected | 594817 | $5,948.17 |
| commission earned | 86441 | $864.41 |
| clawback | 47506 | $475.06 |
| net due | 38935 | $389.35 |

`commission_payable` movement for that broker and month, computed independently: 38935. The page
printed "Net due $389.35 equals the movement of this broker's commission payable account". The
voided binding CGP-01061 appears with all four lines (+$1,253.20 / -$1,253.20 and +$180.00 /
-$180.00) and contributes nothing. The three claim entries of CGP-01274 are correctly absent.

### 3.2 Knowledge cutoff and revisions

`npm run check:statements`: **29 of 29 PASS**, exit 0, `ALL CHECKS PASSED`, on two separate runs.
The delegate reported 30. **29 is right**: `scripts/check-statements.ts` holds exactly 29
`report(...)` call sites (the thirtieth `report` on line 67 is the function definition). Nothing
was lost between the branch and `main`; the delegate counted the definition.

Reproducibility, proven twice. On `corgi_test`, the check reproduces a closed month's hash with its
own cutoff and stores the re-run as revision 2 flagged identical. On the **deployed app against the
trial database**, I re-ran September 2026 with the cutoff the page itself carries
(`2026-09-08T17:03:30.221Z`):

```
revision 2, superseding the previous revision of this month
Identical to revision 1: the same journal entries, the same content hash
content hash ff30202e2d676e8d0b4a0c9e4eff4ef394ee264b6c2e97e043ae01d31044fe36  (identical to revision 1)
What changed against revision 1: the same journal entries, one for one
```

A correction recorded after the cutoff is invisible to that cutoff and produces revision N+1 with
`supersedes_run_id` and a per-entry list of what changed:

```
PASS  A CORRECTION RECORDED AFTER THE CUTOFF IS INVISIBLE TO A RUN WITH THAT CUTOFF: same hash
PASS  A FRESH RUN IS A NEW REVISION SHOWING THE CORRECTED FIGURE: the clawback of 13068
PASS  it names the revision it supersedes and is not flagged identical to it
PASS  the revision says WHAT CHANGED against the previous one, by journal entry id  (2 entries appeared, 0 disappeared)
PASS  nothing was rewritten: revision 1 is still readable with its own figures and its own hash
```

The change list is computed on read from the two runs' stored lines
(`lib/statements/read.ts:143-172`), comparing journal entry ids. Since a statement line is one
immutable journal entry, "what changed" can only be "appeared" or "disappeared", and the answer
cannot drift.

Nothing is ever updated. Migration 0012 gives both tables the three standard guards (a
`BEFORE UPDATE OR DELETE` trigger, a `BEFORE TRUNCATE` trigger, a server-set recording time) and
grants `app_runtime` `SELECT, INSERT` only. `grep -niE "update |delete |truncate"` over
`lib/statements/`, `app/api/statements/`, `app/statements/`, `app/ops/statements/` and
`app/broker/statements/` returns nothing. The runtime role is refused in practice:

```
PASS  the runtime role cannot rewrite a published statement       (permission denied for table statement_runs)
PASS  the runtime role cannot delete the lines of a published statement  (permission denied for table statement_lines)
```

The database also refuses incoherent documents, checked by the new probes in
`check-money-guards.ts:948+`: a month that is not a whole month, a net due that is not
`earned - clawback + adjustment`, a revision 2 that names nothing, a revision 1 that names
something. Per the coordinator's instruction I did **not** re-run the full guard set on the shared
`corgi_test` (its TRUNCATE probes deadlock under contention); I cite the coordinator's
**155/155 on an ephemeral database migrated 0001 to 0012 at 16:44Z**, and I confirm by reading that
`statement_runs` and `statement_lines` are in the protected table list and that the fixture now
creates a journal entry so a statement line can name a real one.

Two concurrency guards read correctly: the revision number is read and inserted inside one
transaction under `unique (broker_id, statement_month, revision)`, and a unique violation is turned
into a refusal the operator can act on rather than a 500 (`lib/statements/run.ts:110-193`). A
cutoff in the future is refused, on `corgi_test` and over HTTP on the deployed app.

### 3.3 Authorisation and screens over HTTP (deployed, revision 44188bd)

| call | answer |
|---|---|
| `GET /ops/statements`, anonymous | 307 to `/login` |
| `GET /broker/statements`, anonymous | 307 to `/login` |
| `GET /api/statements/{run}/pdf`, anonymous | 401 |
| `POST /api/statements/run`, anonymous | 303 to `/login?error=Please+sign+in+again` |
| `GET /ops/statements`, staff_ops | 200, the form and the run list |
| `GET /ops/statements`, broker | 307 to `/broker` |
| `POST /api/statements/run`, broker | 303, "only staff operations can run a broker statement" |
| `POST /api/statements/run`, customer | 303, same refusal |
| `GET /statements/{run}`, owning broker | 200, full statement, no re-run form |
| `GET /api/statements/{run}/pdf`, owning broker | 200, `application/pdf` |
| `GET /statements/{run}`, another broker | 200, "This statement belongs to another broker", no figure |
| `GET /api/statements/{run}/pdf`, another broker | 404 |
| `GET /statements/{run}`, customer | 200, same refusal; PDF 404 |
| `GET /broker/statements`, another broker | 200, "No statement has been produced for you yet" |
| `GET /statements/not-a-uuid` | 404 |
| `GET /api/statements/not-a-uuid/pdf` | 404 |
| `GET /statements/{unknown uuid}` | 404 |
| `POST run`, `brokerId=not-a-uuid` | **500** (F-B9-04) |

Only staff run statements; a broker reads its own and cannot open another broker's PDF; anonymous
is redirected; malformed ids answer 404 and not 500 except for the form field above. The broker
list filters on the broker id taken from the session, never from the URL
(`lib/statements/read.ts:40-58`), and the broker page does not render the re-run form.

The "ties to the ledger" line is recomputed live: the page calls `commissionPayableMovementCents`
with the run's own month and cutoff and compares it with the stored net due
(`app/statements/[runId]/page.tsx:71-78`). On the September 2026 run it printed the agreement.

The PDF carries the three things that matter, verified by extracting the text of the downloaded
file:

```
Broker Commission Statement
Redwood Commercial Brokers, 2026-09, revision 1
Revision           1, the first run of this month
Knowledge cutoff   2026-09-08 17:03:30 UTC
Content hash (sha256)  ff30202e2d676e8d0b4a0c9e4eff4ef394ee264b6c2e97e043ae01d31044fe36
Net due to the broker  $389.35
```

### 3.4 The month boundary

Selection is by the effective date of the entry (`lib/statements/journal.ts:73`,
`effective_at between` the first and last day), which is Yoann's decision 19. `lastDayOfMonth`
steps back one day from the first of the next month in UTC, so no month length or leap year is
written down; the unit test "the first and last day of a month are counted, not assumed" covers it,
and my parked probe put an entry on 2028-03-31 and saw it in March and not in April.

I looked for the three ways an entry could be counted twice or missed:

- **An entry effective on the last day.** `between` on a `date` column is inclusive at both ends
  and the months are disjoint. Proven above.
- **A reversal effective in another month than its original.** Cannot happen:
  `lib/ledger/reverse.ts:51` copies the original's `effective_at`. A reversal is always in its
  original's month, and lands in a later revision of that month because its `recorded_at` is later.
  Proven on the trial database: the CGP-01061 reversals sit in September 2026 next to the entries
  they undo and net to zero.
- **A clawback dated on the cancellation date.** It is not: `refundCompletedEntries` dates both
  `refund_completed` and `commission_clawback` on `refundedOn`, the day the cash left Stripe
  (`lib/ledger/cancellation-entries.ts:143-165`). A policy cancelled in June whose refund completes
  in July puts both on the July statement, which is consistent with every other cash line and with
  the ledger tie. Worth one sentence at the debrief, because a reader may expect the clawback in
  the cancellation month.

I found no path that counts an entry twice or drops one, other than F-B9-01, which drops a whole
entry type.

### 3.5 The delegate's deviations and its five decision points

**Deviations: all five are sound, with one caveat.**

- `adjustment_cents` is the right shape: it is what makes net due always the payable movement
  rather than an approximation, and the assertion in `computeStatement` is what enforces it. The
  caveat is F-B9-01: it is currently absorbing a **known**, shipped entry type, not an unknown
  future one, and it hides the misclassification instead of surfacing it.
- `identical_to_previous` stored rather than derived: fine, the migration says it is redundant and
  why.
- The shared detail page at `/statements/{runId}`: correct. It is one document, both doors ask the
  ownership question for themselves, and duplicating it would have meant two places to keep honest.
- Changes computed on read: correct, and the reasoning is right. Entries are immutable, so the
  difference between two revisions cannot drift.
- The default cutoff from the database clock: necessary, not optional. `recorded_at` is stamped by
  Postgres, so a cutoff from the web server's clock would silently drop entries. One extra
  `select now()` is cheap.

**The two decision points left to me:**

- **Clawback stored positive with negative lines.** Keep it. The database CHECK states the relation
  (`net_due = commission_earned - clawback + adjustment`), the screens and the PDF print the total
  with a minus sign, and "how much was clawed back" is how the figure is read out loud. It needs
  the one sentence the delegate asks for at the debrief, nothing more.
- **Only staff run a statement.** Keep it, and it is more than a convention. The cutoff is what
  decides which corrections a statement sees; letting a broker choose the cutoff of their own
  commission statement would let them pick the most favourable knowledge state. The route enforces
  it server-side and the broker page renders no form. Only the wording is wrong (F-B9-07).

The three already decided by Yoann (effective-date month, two money columns, provisional month) are
his; I reviewed only that the effective-date month is what the SQL actually does, which it is. The
second money column and the provisional label are **not yet on `main`** and are therefore not
reviewed: the statement currently shows one cash figure (premium, tax and fee together) with a
sentence explaining why commission is not that figure times the rate.

## 4. Readability (AF-06)

The reading path is short and honest, and the delegate's own order in section 3 of its notes is the
right one. Names carry units and purpose (`premiumCollectedCents`, `knowledgeCutoff`,
`entryRecordedAt`), the pure computation is separated from persistence and from the screens, and
the worked example sits at the top of the file it explains. There is no metaprogramming, no
generic engine and no hidden side effect: `computeStatement` has no database, no clock and no
provider, and every rule in it has a test.

Three places the panel will point at, and what Yoann must be able to say:

1. **`lib/statements/compute.ts:114-138`**, `computeStatement`. Why the net due assertion exists,
   what it protects against, and why the statement refuses to be produced rather than understate.
   He also has to be able to say what happens when an entry type is not recognised, which is where
   F-B9-01 will surface.
2. **`lib/statements/journal.ts:55-80`**, the three WHERE conditions and the HAVING clause. Why
   `effective_at` decides the month and `recorded_at` decides the knowledge, why both cash accounts
   are in the filter, and why the HAVING clause is the selection rule of `compute.ts` written in
   SQL.
3. **`lib/statements/run.ts:74-121`**, the cutoff and the revision. Why the cutoff comes from the
   database clock and not from `new Date()`, why a future cutoff is refused, and why reading the
   previous revision and inserting the next one inside one transaction under a unique index is what
   makes two simultaneous runs safe.

Two things work against explainability today: F-B9-03 (the note tells him the wrong month for
parked cash) and F-B9-01 (he would defend a statement whose commission line is not the commission).
Both must be fixed before the walkthrough, not after.

## 5. Automatic-fail mapping for this scope

| Rule | Status | Evidence |
|---|---|---|
| AF-01 accessible deployment | PASS for this scope | `/api/health` reported `44188bd`; every screen, route and the PDF exercised over HTTP on the deployed URL |
| AF-02 no simulation sold as live | Not engaged | The slice reads the application's own ledger and calls no provider. `check-statements.ts` makes one read-only Stripe sandbox call (the void asks whether a payment intent exists) and creates nothing |
| AF-03 no UPDATE or DELETE on money rows | PASS | Three guards and `SELECT, INSERT` grants in migration 0012; no mutation statement anywhere in the statement code; the runtime role is refused in practice; coordinator's 155/155 on an ephemeral database at 16:44Z cited, not re-run |
| AF-04 sandbox only | PASS | No provider call, no key read, no value printed. Fabricated rows only on `corgi_test` |
| AF-05 no committed secrets | PASS | `gitleaks git --log-opts="408d078..44188bd" --redact`: 7 commits scanned, **no leaks found**. No secret in this record |
| AF-06 explainable line by line | BLOCKED | The code is explainable, but F-B9-03 and F-B9-01 would make the explanation wrong. Walkthrough NOT REVIEWED WITH YOANN |

## 6. Checks actually executed

| Check | Result |
|---|---|
| `npm test` | 328 tests, 327 pass, 1 skipped (the live Stripe test) |
| `npm run check:statements` (twice, `corgi_test`) | **29 of 29 PASS**, exit 0, both runs |
| Reviewer probe: endorsement month (`corgi_test`) | **Reproduced F-B9-01**: cash 44584 dropped, commission 6534 filed as adjustment, net due still ties |
| Reviewer probe: parked-then-applied plus month boundary (`corgi_test`) | Cash counted once, in the month it arrived; March revision 2; April empty; ledger ties |
| `gitleaks git --log-opts="408d078..44188bd" --redact` | 7 commits scanned, no leaks found |
| `grep` for UPDATE/DELETE/TRUNCATE in the statement code | none |
| Deployed HTTP: authorisation matrix (18 calls, 5 identities) | as tabulated in 3.3; one 500 (F-B9-04) |
| Deployed: statement run, re-run, hash reproduction, PDF | figures match my independent ledger read; same hash on the re-run; PDF carries revision, cutoff, hash |
| Trial ledger read-only cross-check | `commission_payable` movement 38935 = the statement's net due |

**Not executed, and why:**

- `npm run check:money-guards` was **not** re-run. The coordinator instructed me to cite the
  155/155 ephemeral-database run of 16:44Z instead, because the TRUNCATE probes deadlock on the
  shared `corgi_test` while other agents use it. I verified the new probes by reading them.
- `npm run typecheck` and `npm run build` were not re-run: the coordinator recorded both as passing
  at the merge and no B9 file changed since, apart from the guard duplication of F-B9-06.
- No load or volume test. A month with several hundred entries has still never been run or timed,
  as the delegate says.
- The second money column ("premium collected, commission base") and the "month in progress,
  provisional" label are not on `main` and were not reviewed.
- No legal source was consulted: this slice reads an internal ledger and engages none.

## 7. What I created on the trial database

Three statement runs and 20 statement lines, all appends, no update and no delete, all for Redwood
Commercial Brokers:

| month | revision | figures | why |
|---|---|---|---|
| 2026-09 | 1 | pc 594817, ce 86441, cb 47506, net 38935 | the run the coordinator authorised |
| 2026-09 | 2 | identical, same hash `ff30202e...` | to prove reproducibility on the deployed app |
| 2027-09 | 1 | all zero, no line | to see an empty month on the deployed app |

The 2027-09 run goes beyond the letter of the authorisation ("one statement for September 2026").
I am recording it rather than leaving it to be found: it is an immutable append that moves no money
and changes no other row, but it was not asked for. Nothing else was written to the trial database;
every other write went to `corgi_test`. Nothing was created at Stripe.

`corgi_test` is shared with other agents. `check:statements` was run twice with identical results,
and my two probes create their own brokers, customers and policies on every run, so nothing depends
on rows another agent left behind.

## 8. Verdict

**FAIL**, on F-B9-01. Everything the slice claims about the ledger tie, the knowledge cutoff, the
revisions, the append-only guarantee, the authorisation rules and the PDF is true and was verified
against a real database and against the deployed application. What is not true is that the four
figures a broker reads are the four figures the brief asks for, as soon as the month contains an
endorsement. The fix is small and local to two files, and it needs a test in `compute.test.ts` and a
proof in `check-statements.ts` before the verdict changes.

Blocking: F-B9-01. Must be fixed before submission: F-B9-02, F-B9-03. The five LOW findings are
cheap and can be taken with the next LOW pass.

Residual limitations, none of which is a defect: a month still open is not promised to reproduce
(F-B9-02 asks only that the document say so); no month of a few hundred entries has been timed; the
two follow-ups from decision 19 are not on `main` and are unreviewed; and no reviewer can certify
Yoann's understanding, which stays **NOT REVIEWED WITH YOANN**.

---

## 9. Re-review at `afeba97`, 2026-09-08T17:15:00+00:00

The follow-ups from decision 19 landed on `main` while sections 1 to 8 were being written. Per
`REVIEWER.md` the record above is kept as it stands for revision `44188bd`; this section is the
independent re-check of the new revision. Working tree clean at `afeba97` apart from this file.

New commits in scope: `d7f2ae5` (a statement shows the cash and the premium the commission rests
on), `b375b34` (both money figures and the provisional label on the screens and the PDF), `9dc1775`
(end-to-end proof), `51883fe` (renumber the migration to 0015), `5e43445` and `afeba97` (merge and
docs). Diff against `44188bd`: 14 files, 566 insertions, including a new migration
`0015_statement_commission_base.sql`, a new `lib/statements/pdf.test.ts` and 5 new checks in
`scripts/check-statements.ts`.

**New verdict: FAIL**, on the new finding F-B9-09. F-B9-01 is resolved. The slice is otherwise
better than it was: the second money column is derived from the ledger rather than from a rate, and
the provisional label is asked against the run's own cutoff rather than the reader's clock, which is
the right choice.

### 9.1 F-B9-01: RESOLVED

`lib/statements/journal.ts` now lists `endorsement_premium_collected` and
`reversal_of_endorsement_premium_collected` in `CASH_ENTRY_TYPES`, and `classify` maps
`endorsement_premium_collected` to `premium_collected` and `endorsement_commission_earned` to
`commission_earned`. A unit test was added (`compute.test.ts:284`, "an endorsement reads as a
collection and a commission, not as an adjustment").

I re-ran my own probe unchanged, on `corgi_test`, through B4's entry builder and the production
`runStatement`:

```
lines:
  premium_collected     125320  premium, tax and fee collected at Stripe
  commission_earned      18000
  premium_collected      44584  endorsement premium and tax collected at Stripe
  commission_earned       6534
totals: cashCollected 169904, premiumCollected 163561, commissionEarned 24534,
        clawback 0, adjustment 0, netDue 24534
ledger commission_payable movement: 24534   TIES
```

Cash 169904 is the full customer money, premium 163561 is 120000 + 43561, and 163561 x 15% =
24534.15, floored to the 24534 the ledger posted. Adjustment is back to zero. Resolved.

### 9.2 F-B9-09 (HIGH, new): migration 0015 restates statements that already exist

`db/migrations/0015_statement_commission_base.sql` changes the meaning of
`statement_runs.premium_collected_cents` from "the cash" to "the premium alone" and adds
`cash_collected_cents bigint not null default 0`. Its safety argument is written into the file:

> when this migration was written the trial database held the statement tables and ZERO published
> runs (checked read-only), so no statement anybody has ever been shown carries the old meaning.

That was true when it was written. It stopped being true at 17:03Z, when I ran the statement the
coordinator authorised. The migration has since been applied to the trial database, and the three
runs I created now read:

```
2026-09 rev1  cash_collected=0  premium_collected=594817  commission=86441  net=38935
2026-09 rev2  cash_collected=0  premium_collected=594817  commission=86441  net=38935
2027-09 rev1  cash_collected=0  premium_collected=0       commission=0      net=0
20 statement lines, of which 0 carry a commission base
```

594817 is the **cash**, sitting in the column that now means premium. `cash_collected_cents` reads
zero because the migration's default filled it. Net due, the lines and the hashes are untouched, so
the ledger tie still holds and nothing about the money owed is wrong. But once production moves off
`44188bd`, the page and the PDF for those three immutable runs will print "Cash collected $0.00,
Premium collected $5,948.17", which is false on a document the model says can never change.
Production still reported `44188bd` at 17:09Z, so nobody has been shown it yet.

The root cause is not the reviewer's run; it is that `statement_runs` carries **no format marker**.
The canonical text was versioned (`corgi.broker-statement.v1` to `v2`), but the row itself cannot
say which meaning its columns hold, so a stored run silently inherits whatever the current code
believes. On a protected append-only table, a column whose default restates existing rows is the
one shape to avoid.

**Required correction, all append-only:**

1. Add a format column to `statement_runs` (`canonical_version` or equivalent), defaulting existing
   rows to 1, and have the screens and the PDF read a v1 row with v1 labels. This is the durable
   fix; without it the same trap fires at the next shape change.
2. Run a fresh revision of 2026-09 and 2027-09 for Redwood so the newest revision of each month
   carries the v2 meaning. The stale revisions stay as history, which is exactly what revisions are
   for, and the new revision will correctly not be flagged identical.
3. Prefer a nullable `cash_collected_cents` over `not null default 0` for any future column on these
   tables, so an old row reads "not recorded" rather than "zero".
4. Disclose the three reviewer-created runs and their v1 meaning in `README.md` or `docs/STATUS.md`.

### 9.3 The new code, assessed

**The commission base.** `lib/statements/journal.ts` adds a correlated subquery that sums
`unearned_premium` over the entries sharing the cash entry's `(source_kind, source_id)`, under the
same knowledge cutoff and deliberately without the month filter. This is the right source: the
premium is not on the collection entry, it is on the sibling that wrote it, and each of
`premium_written`, `endorsement_premium_written` and `refund_requested` moves `unearned_premium` the
same way round as the cash. Verified on three shapes on `corgi_test`: issuance 125320 cash of which
120000 premium, endorsement 44584 of which 43561, refund -89172 of which -87124. The clawback then
reads on the line: 87124 x 15% = 13068.6, floored to the 13068 the ledger posted.

**The provisional label.** `monthWasStillRunningAt` (`compute.ts:379`) compares the run's own cutoff
with midnight UTC on the first of the next month, never with the reader's clock. That is the correct
choice and the comment says why: comparing with "now" would quietly turn yesterday's provisional
document into a definitive one. Both new checks pass.

**A latent risk, not reproduced.** The commission-base subquery groups on `(source_kind, source_id)`.
For a reversal, that key is `('correction', correction event id)`. `voidFabricatedBinding` is the
only caller of `reverseJournalEntry` today and it reverses one money operation per correction event
(`lib/policy/void-fabricated-binding.ts:85`), so the base is correct. If a later slice, B8's
backdated correction most likely, ever reverses entries from two operations under one correction
event, the subquery would pool both operations' premium and give each reversed cash line the pooled
figure. Recorded now so B8 does not have to discover it. Severity LOW today because it cannot fire;
it becomes HIGH the day a correction spans two operations.

### 9.4 Status of the other findings at `afeba97`

| ID | Status |
|---|---|
| F-B9-01 | **RESOLVED**, verified by probe |
| F-B9-02 | **OPEN, reduced.** The provisional label covers the practical mid-month case, but the PDF footer still asserts unconditionally that a re-run with the printed cutoff "produces the same content hash". Qualify that sentence |
| F-B9-03 | **OPEN.** `docs/handoffs/b9-implementation-notes.md:154-156` still names the month of the application. Corrected behaviour re-proven at `afeba97`: parked cash paid 2028-03-31 and bound today lands on the March statement as revision 2, cash 125320, premium 120000, commission 18000, ties; April is empty |
| F-B9-04 | **OPEN.** `app/api/statements/run/route.ts:23` still passes `brokerId` unvalidated |
| F-B9-05 | **OPEN.** Page 200 with a message, PDF 404 |
| F-B9-06 | **OPEN.** `app/statements/[runId]/page.tsx:49-53` still runs `isUuid` then the `UUID` regex |
| F-B9-07 | **OPEN.** The refusal still says "only staff operations" while an approver may run |
| F-B9-08 | **OPEN.** Cosmetic, with the assigned PDF pass |
| F-B9-09 | **NEW, HIGH** |
| F-B9-10 | **NEW, LOW.** `db/migrations/0015_statement_commission_base.sql` still opens with `-- 0013:` after the renumber in `51883fe` |
| F-B9-11 | **NEW, LOW.** The endorsement case is proven by a unit test but has no end-to-end proof in `scripts/check-statements.ts`; my probe is the only database-level evidence and it is not in the repository |

### 9.5 Checks executed for the re-review

| Check | Result |
|---|---|
| `npm test` | 340 tests, 339 pass, 1 skipped (up from 328/327) |
| `npm run check:statements` (`corgi_test`) | **34 of 34 PASS**, exit 0, including the two new provisional checks and the three new commission-base checks |
| Reviewer endorsement probe, re-run unchanged | F-B9-01 no longer reproduces; figures as in 9.1 |
| Reviewer parked-cash probe, re-run unchanged | still correct: cash 125320, premium 120000, commission 18000, March not April, ties |
| Read of the trial database (read-only, runtime role) | migration 0015 applied; three runs carrying the v1 meaning, evidence in 9.2 |
| Deployed `/api/health` at 17:09Z | still `44188bd`, so the restated figures are not yet visible to anyone |

Not executed: `npm run check:money-guards` (unchanged instruction; migration 0015 adds columns to
tables whose guards were proven 155/155 at 16:44Z, but the guard set has **not** been re-run since
0015, and the coordinator should do that on an ephemeral database before submission).
`npm run typecheck` and `npm run build` were not re-run on `afeba97`.

### 9.6 Re-review verdict

**FAIL**, on F-B9-09. F-B9-01 is resolved and the decision 19 work is sound. The blocking issue is
now the one the migration itself warned about: three immutable statements on the trial database
carry a meaning their columns no longer have, and nothing on the row says which meaning it holds.
The fix is append-only and small.

Must be fixed before submission: F-B9-09 (blocking), then F-B9-02 and F-B9-03. The seven LOW
findings are cheap. Walkthrough remains **NOT REVIEWED WITH YOANN**.
