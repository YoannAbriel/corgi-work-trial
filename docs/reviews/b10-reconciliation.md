# Independent review: slice B10, reconciliation against Stripe and the claim payout rail

Reviewer: independent sub-agent, no authorship of any B10 code.
Written at 2026-09-08T17:05:00+00:00.
Stage: implementation review (feature).
Verdict: **FAIL** on F-B10-01. Everything else in the declared scope is supported.
Candidate walkthrough status: **NOT REVIEWED WITH YOANN**.

## Startup receipt

Read in full, in this order, before touching the code: `CLAUDE.md`, `AUTOMATIC-FAILS.md`,
`READABLE-CODE.md`, `AGENTS.md`, `WORKFLOW-48H.md`, `REVIEWER.md`, `docs/ARCHITECTURE.md`,
`docs/DECISIONS.md` (including decisions 16 and 17 at the end), `docs/STATUS.md`,
`docs/handoffs/b10-implementation-notes.md`. Read by targeted search: `docs/reviews/FINDINGS.md`
(all B7 and B10 rows), `README.md` (integration inventory and demo users).

Absent files: none of the ones I was pointed at. Not read, out of scope for this slice:
`READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`, `GAP-REVIEW.md`.

Reviewed revision: the B10 merge `28a361c` (branch commits `e4aa7f4` to `a505ec7`), read at
working-tree state, which is byte-identical to `65b06be` for every file in scope:

```
git diff --stat 65b06be..HEAD -- lib/reconciliation db/migrations/0011_reconciliation.sql \
  app/api/jobs app/ops/reconciliation vercel.json scripts/check-reconciliation.ts \
  lib/payments/refund-state.ts lib/claims/settle-due-payouts.ts lib/jobs/authorize.ts
(no output: nothing in scope changed after 65b06be)
```

`main` moved several times during the review (B4 and the B7 re-review merged). Nothing in the B10
scope moved with it, so every reading below applies to the assigned revision.

## What production reported

At the start of the review, `GET /api/health` on https://corgi-work-trial-iota.vercel.app
reported revision `4decb8cde4a57669b6665da96fdd4e37f36d1b28`. That commit is the ancestor
`4decb8c`, which is **before** the B10 merge, so the slice was not deployed:
`/ops/reconciliation`, `/api/jobs/reconcile` and `/api/jobs/daily` all answered 404.

At 16:35 UTC the same endpoint reported `dfdca387c3792038df925955ce1f64f54dcee6ac`, a merge that
contains `65b06be`, and every B10 route answered. All deployed evidence below was taken at that
revision. This is a timing note, not a finding: the coordinator deployed while the review ran.

## Scope

Files read line by line: `db/migrations/0011_reconciliation.sql`, `lib/reconciliation/`
(`diff.ts`, `breaks.ts`, `window.ts`, `source.ts`, `ledger-side.ts`, `stripe-records.ts`,
`stripe-source.ts`, `claims-rail-source.ts`, `run.ts`, `read.ts`, the fixture),
`lib/payments/refund-state.ts` and the re-export in `lib/payments/refunds.ts`,
`lib/claims/settle-due-payouts.ts` and the shortened
`app/api/jobs/settle-simulated-payouts/route.ts`, `app/api/jobs/reconcile/route.ts`,
`app/api/jobs/daily/route.ts`, `lib/jobs/authorize.ts`, `app/ops/reconciliation/page.tsx`, the
new link in `app/ops/page.tsx`, `vercel.json`, `scripts/check-reconciliation.ts`, the new lines of
`scripts/check-money-guards.ts`, and the four test files.

Out of scope, read only where a B10 path crosses it: `db/client.ts`, `lib/auth/session.ts`,
`app/api/session/login/route.ts`.

## Requirement matrix

| Requirement | Control and code location | Evidence | Status |
|---|---|---|---|
| AF-03: no UPDATE or DELETE on money rows | `db/migrations/0011_reconciliation.sql` lines 85 to 95 and 133 to 143 (three triggers per table), line 149 (grant limited to select and insert); the whole `lib/reconciliation/` tree issues three INSERT statements and nothing else | catalog read on both databases; `check:money-guards` | PASS |
| AF-03: the job reads the ledger with the runtime role | `db/client.ts` lines 9 to 16 refuse to start without `DATABASE_URL_APP` and never fall back to the owner; `ledger-side.ts` and `read.ts` are SELECT only | grants read from `information_schema.role_table_grants` | PASS |
| A failed fetch is never a clean run | `run.ts` lines 59 to 67 (both reads inside one try, `storeFailedRun` on any error), migration CHECK `reconciliation_runs_check2` | `check:reconciliation` lines 25 to 29; catalog constraint definitions | PASS |
| Five classifications from the brief | `diff.ts` `classifyPair`, `classifyProviderAlone`, `classifyLedgerAlone` | `diff.test.ts` 27 tests; `check:reconciliation` produced all five on a real database | PASS |
| Planted mismatch found on both sources | `scripts/check-reconciliation.ts` parts 4 and 6 | 29 of 29 PASS; the deployed run found the probe PaymentIntents | PASS |
| Job authorisation | `lib/jobs/authorize.ts` (constant-time compare, fail closed under 16 chars); `app/api/jobs/reconcile/route.ts` lines 20 to 33 | deployed matrix below | PASS |
| Staff-only screen | `app/ops/reconciliation/page.tsx` lines 44 to 50 | deployed matrix below | PASS with a note |
| AF-02 honest labels | `page.tsx` `SOURCE_LABEL` and the paragraph at lines 73 to 79; `claims-rail-source.ts` note | rendered page carries "LIVE SANDBOX" and "LOCAL SIMULATOR" | PASS |
| AF-04 sandbox only | `stripe-source.ts` line 24 `assertStripeSandbox()` before any listing; `stripe-records.ts` `refuseLiveMode` | deployed run completed against the test-mode key; probe uses `pm_card_visa` | PASS |
| AF-05 no secrets | gitleaks over the merged range | no leaks found | PASS |
| Breaks screen with their age | `read.ts` `openBreaks`, `breaks.ts` `describeAge`, `page.tsx` `BreakTable` | rendered page shows age per break | **FAIL, see F-B10-01** |
| Unresolved mismatches remain visible (AGENTS.md, reconciliation) | `read.ts` `openBreaks` and `resolvedBreaks` | reproduced disappearance, see F-B10-01 | **FAIL** |
| Non-zero clearing balances with age on the screen (ARCHITECTURE section 1) | not built | see F-B10-03 | BLOCKED |
| AF-06 candidate understanding | not establishable by a reviewer | none | NOT RUN |

## Findings

| ID | Severity | Finding |
|---|---|---|
| F-B10-01 | HIGH | A break whose records fall outside the compared window leaves the open list and is displayed as resolved, although nothing fixed it. |
| F-B10-02 | MEDIUM | The break key contains the classification, so a break that changes classification resets its age to zero and its former key is shown as resolved. |
| F-B10-03 | MEDIUM | The non-zero clearing balances list with age that the architecture asks the reconciliation screen for is not built, and the substitute does not cover the case F-B10-01 hides. |
| F-B10-04 | LOW | An error after the fetch stores no run at all, and stops the second source, despite the comment promising the opposite. |
| F-B10-05 | LOW | The failed-run banner claims the most recent run of a source failed even when that source has completed runs since. |
| F-B10-06 | LOW | PaymentIntents are filtered to `succeeded`, so money in flight at Stripe is invisible to the provider side and the run note does not say so. |
| F-B10-07 | LOW | `resolvedBreaks` reads every resolved break ever recorded and then slices in JavaScript; `openBreaks` has no bound at all. |
| F-B10-08 | LOW | On the deployed database the breaks screen is eleven sandbox probe payments with no way to acknowledge them, so a real break would be buried. |
| F-B10-09 | LOW | Pairing by provider reference keeps the last ledger record when two share one reference, silently dropping the other from the pairing map. |

### F-B10-01 (HIGH): a break that ages out of the window reads as resolved

**Trigger.** `openBreaks` (`lib/reconciliation/read.ts` lines 109 to 134) shows the non-matched
items of the latest complete run of each source. `resolvedBreaks` (lines 139 to 174) shows every
break key that some complete run reported and the latest complete run does not. The window that
decides what a run compares is bounded on both sides: `stripe-source.ts` line 25 filters Stripe on
`created` inside the window, and `ledger-side.ts` lines 114 to 119 keep only operations with a
lifecycle event or a journal entry recorded inside it. The daily cron always uses
`defaultWindow(new Date())`, seven days (`app/api/jobs/daily/route.ts` line 51).

So a break older than seven days, on an operation with no recent activity, is compared by nobody.
It leaves the open list, and the screen files it under "Breaks that went away", whose text reads
"Reported by an earlier run and absent from the latest completed run of that source. Nothing was
deleted". Nothing was deleted, and nothing was fixed either.

**Reproduced** on `corgi_test`, calling the production functions with no fabricated rows: one run
over a wide window, then the same source over a window that no longer covers the records.

```
WIDE  run: complete {"matched":94,"provider_only":14,...} | open rail breaks: 14
sample break key: claims_rail|provider_only|sim_tr_6110403a4286d65dca990f738dd79a67
AFTER run: complete {"matched":0,"local_only":0,"provider_only":0,...} | open rail breaks: 0
sample still open? false
sample listed as RESOLVED? true
```

**Consequence.** The breaks the age column exists for are exactly the ones that disappear. An
operator reading the screen after eight days sees a clean board and a resolved list containing a
payout the rail made and the ledger never booked. This is the "unresolved mismatches remain
visible" control of `AGENTS.md`, and the whole point of a breaks screen.

**Required correction.** Do not let absence from the latest run mean resolution. Either carry
every still-unmatched key forward into the next run when its records fall outside the window, or
separate "no longer compared, still unexplained" from "compared again and now matched", or open
the window from the oldest unresolved break rather than from a fixed seven days. Whichever is
chosen, the screen must never call a break resolved that no run has re-examined.

### F-B10-02 (MEDIUM): the age resets when a break changes classification

`breakKey` (`lib/reconciliation/breaks.ts` line 25) is `source|classification|reference`. A break
that gets worse gets a new identity: `first_seen_at` restarts at the current run, and the previous
key, absent from the latest run, moves to the resolved list. A reachable path: a refund the ledger
owes and Stripe does not list is `stale` (`classifyLedgerAlone`); once Stripe lists it as
succeeded with nothing booked on our side it becomes `provider_only` (`classifyPair`, line 147).
Same money, same reference, one key resolved and one break aged zero minutes.

Correction: key on `source|reference` and keep the classification as an attribute of the item.

### F-B10-03 (MEDIUM): the clearing balances list is not built

`docs/ARCHITECTURE.md` section 1 ends with "The reconciliation screen (B10) therefore also lists
non-zero clearing balances with their age", and section 3 relies on that list for a failed refund
whose liability stays open. The screen has no such list. The delegate's substitute is
`openClearingCents` carried in the note of each item (`ledger-side.ts` lines 96 to 104,
`diff.ts` `openClearingNote`).

The substitute is not equivalent, and the gap matters more because of F-B10-01: an operation whose
`refund_payable` stays open but whose events are older than the window produces no item at all, so
its open clearing balance appears nowhere. An account-level list read straight from
`journal_lines` would be immune to the window and would be the second net under the first hole.

The absence is already propagating into other slices' bookkeeping. `docs/STATUS.md` records
F-B4-02 as "suspense account missing from the clearing balances list", deferred to B13, which
presumes a list that does not exist. Building it would close F-B4-02 as well.

### F-B10-04 (LOW): an error after the fetch leaves no run at all

`run.ts` catches only the fetch and the ledger read. An error raised by `breakKey`, by the item
insert or by the transaction itself propagates out of `runReconciliation`, so no row is written,
not even a failed one, and `runAllSources` (lines 201 to 211) stops without reconciling the second
source, although its comment says a Stripe failure "must not cancel the rail comparison". True for
fetch errors, not for storage errors. `breakKey` cannot throw today, because every classifier sets
at least one reference, so this is a robustness gap and not a live defect.

### F-B10-05 (LOW): the failed-run banner overstates

`page.tsx` line 60 takes the first failed run among the twelve most recent, then line 88 says "The
most recent ... run FAILED" and "The breaks below are ... not a fresh answer". If that source has
completed runs since, both sentences are false. The error is on the alarming side, which is the
right side, but the sentence should be scoped to the latest run of each source.

### F-B10-06 (LOW): only succeeded PaymentIntents are compared

`stripe-records.ts` line 64 keeps `status === "succeeded"`. A PaymentIntent in `processing` or
`requires_capture` is money in flight that neither side reports. Card-only v0 makes this
unreachable today, and the choice is defensible, but the run note names the balance-transaction
types it deliberately skipped and says nothing about the PaymentIntent statuses it dropped. One
sentence in `balanceTransactionNote` would keep the disclosure symmetric.

### F-B10-07 (LOW): unbounded reads behind the screen

`resolvedBreaks` selects every resolved key ever recorded, sorts in JavaScript and then applies the
limit (`read.ts` lines 139 to 174). `openBreaks` has no limit. Both are fine at trial scale and
both grow with every run.

### F-B10-08 (LOW): the deployed board is all probes

The authorised run on production reported eleven provider-only breaks, every one a sandbox probe
payment (six of $42.42 from `check:reconciliation` runs, two of $12.61, one of $100.00, one refund
of $8.98). They are honestly classified, and there is deliberately no button to dismiss them, but
a genuine break would arrive as a twelfth line among eleven known ones. Worth a sentence in the
demo script, or a seeded genuine break to point at.

### F-B10-09 (LOW): pairing map keeps the last record on a duplicated reference

`diff.ts` lines 94 to 96 build `ledgerByProviderRef` with `new Map`, so two ledger records carrying
the same provider reference silently collapse to the last one. No current path produces that (each
operation gets its own PaymentIntent, refund or transfer), so this is a defensive note.

## Checks executed

All commands run from `/Users/yoannabriel/dev/corgi-work-trial` on `main`.

| Command | Result |
|---|---|
| `npm run typecheck` | clean, exit 0 |
| `npm test` | 276 tests, 275 pass, 1 skipped (the opt-in live Stripe test) |
| `node --import tsx --test lib/reconciliation/*.test.ts` | 55 pass, 0 fail |
| `npm run check:reconciliation` (first run) | 28 PASS, 1 FAIL |
| `npm run check:reconciliation` (solo rerun) | 29 of 29 PASS, exit 0 |
| `npm run check:money-guards -- --database=test` at `d7d173d` | 128 result lines: 125 PASS, 3 FAIL, all three "deadlock detected" on TRUNCATE probes |
| `npm run check:money-guards -- --database=test` solo at `44188bd` | 155 of 155 PASS, 0 FAIL, 19 of them reconciliation lines |
| `gitleaks git --log-opts="4decb8c..d7d173d"` | 14 commits scanned, no leaks found |

Coordinator evidence, not rerun by me and cited as reported in `docs/STATUS.md`: the same guard
script gave **136 PASS, 0 FAIL at 16:22Z** on an ephemeral database created on the same Neon
server, migrated 0001 to 0011 in order with the runtime role, then dropped. That is the clean
measurement for the B4 revision, on a database no other agent was touching.

**The 127 versus 128 question is settled.** At the B10 revision the script emits **128** result
lines. The coordinator's shorter count and my own three failures came from another agent running
the same script against the shared `corgi_test` at the same moment: the three failures were
`owner cannot TRUNCATE brokers`, `... claims` and `... approval_requests`, each reported as
"deadlock detected" rather than as the trigger message. Run alone the script is clean. The line
count grows with every slice that adds a protected table, which is why the three clean figures
differ: 128 at `d7d173d`, 136 on the coordinator's ephemeral run at the B4 merge, 155 solo at
`44188bd`. Only the first is a B10 fact.

The single failure of the first `check:reconciliation` run was the same interference:
`a run posts no money and no journal entry` compared the journal count before and after the run
and saw 1928 then 1932, four entries committed by another agent's script during the window. The
solo rerun passed. Each run of that script creates one real PaymentIntent of $42.42 in the
sandbox with a published test payment method and no metadata; I created two,
`pi_3UDRg7K6R3v50tIy0gT73SMV` and `pi_3UDRpWK6R3v50tIy1583aoau`, and they are the planted
provider-only breaks the run is supposed to find.

### Database guards, read from the catalog rather than from the notes

Same result on `corgi_test` and on the trial database:

```
GRANTS   reconciliation_items  INSERT,SELECT
         reconciliation_runs   INSERT,SELECT
TRIGGERS both tables carry *_are_append_only (before row update or delete),
         *_cannot_be_truncated (before statement truncate) and a before-insert
         server-clock trigger
CHECKS   reconciliation_runs_check   window_from < window_to
         reconciliation_runs_check1  (status = 'failed') = (fetch_error is not null)
         reconciliation_runs_check2  status = 'complete' or every count is zero
```

`check:money-guards` proves the same three properties by exercise, including that the owner is
refused, that `TRUNCATE reconciliation_runs` is refused even though it cascades to
`reconciliation_items`, and that a client-supplied `finished_at` of 2000-01-01 is overwritten by
the database clock.

That the job writes nothing else is a code fact, not a privilege fact: `app_runtime` can insert
into the journal because the rest of the application posts entries. The proof is that the whole
`lib/reconciliation/` tree contains three write statements and no others:

```
lib/reconciliation/run.ts:79   insert into reconciliation_runs (
lib/reconciliation/run.ts:117  insert into reconciliation_items ${transaction(
lib/reconciliation/run.ts:180  insert into reconciliation_runs (source, window_from, ...
```

No UPDATE, DELETE or TRUNCATE anywhere in the slice.

### Authorisation over HTTP, on the deployed application

| Call | Answer |
|---|---|
| `POST /api/jobs/reconcile`, no credential | 401, `this job endpoint needs the cron secret as a bearer token` |
| `POST /api/jobs/reconcile`, wrong bearer | 401, same body |
| `GET /api/jobs/daily`, no credential | 401, same body |
| `DELETE /api/jobs/daily` | 405 |
| `GET /api/jobs/reconcile` | 405 |
| `POST /api/jobs/reconcile`, cron secret from the local environment file | 200, JSON summary of both runs |
| broker session, `GET /ops/reconciliation` | 307 to `/broker` |
| broker session, `POST /api/jobs/reconcile` with a form body | 401 |
| customer session, `GET /ops/reconciliation` | 307 to `/broker` |
| `staff_ops` session, `GET /ops/reconciliation` | 200 |
| `staff_approver` session, `GET /ops/reconciliation` | 200 |
| `staff_ops` session, Run now with an empty window | 303 to `/ops/reconciliation?ran=...` |
| `staff_ops` session, Run now with `from=last tuesday` | 303 to `?error="last tuesday" is not a date or an instant for "from"` |
| `staff_ops` session, Run now over 250 days | 303 to `?error=the window is 250 days long; at most 31 days can be reconciled in one run` |

No secret value was printed at any point. The 401 body deserves a note: it says the endpoint
"needs the cron secret", not that it "is not configured", which is the other branch of
`assertJobIsAuthorised`. That proves `CRON_SECRET` is set in the production environment and is at
least sixteen characters, which the delegate had listed as unverified.

The screen accepts `staff_ops` **and** `staff_approver`, not `staff_ops` alone. That matches
`page.tsx` line 48 and the route's line 22, and it is a defensible reading of "staff only", but it
is not what the review assignment expected, so it is recorded here rather than assumed.

Cross-site request forgery on the Run now form: the session cookie is set with `SameSite=Lax`
(`app/api/session/login/route.ts` line 38), so a cross-site POST carries no cookie and falls
through to the cron-secret check. No finding.

### What the authorised deployed run reported

`POST /api/jobs/reconcile` with the cron secret, window 2026-09-01T16:35:57Z to
2026-09-08T16:35:57Z:

| Source | Provider records | Ledger records | Result |
|---|---|---|---|
| stripe | 14 | 4 | 4 matched, 11 provider only, 0 local only, 0 amount mismatch, 0 stale |
| claims_rail | 1 | 2 | 2 matched, no break |

The Stripe run note reads: `balance transactions in the window: application_fee 2, charge 12,
refund 2, transfer 1; fees kept by Stripe 18835 cents`, followed by the disclosure that fees and
payouts are not journaled. The rail note reads `LOCAL SIMULATOR: 2 rail records for 1 transfers`.

The eleven provider-only breaks are the probe objects: `pi_3UDQN7K6R3v50tIy0fdlIi1Q`,
`pi_3UDQPZK6R3v50tIy0hKAIFiq`, `pi_3UDQkNK6R3v50tIy0LYkcx0u`, `pi_3UDQliK6R3v50tIy12QwbLZu` and my
two, all of $42.42 and all noted "it carries no operation id at all"; plus
`pi_3UDKq0K6R3v50tIy1mwQmeWT` and `pi_3UDL2qK6R3v50tIy0hthuI6E` at $12.61,
`pi_3UDKjJK6R3v50tIy0nLbDPOc` at $100.00 and refund `re_3UDKq0K6R3v50tIy11aPmuHK` at $8.98. So the
planted provider-only breaks are found on the deployed application against the real sandbox, which
is the live-fire property the slice exists for.

The `staff_ops` Run now afterwards returned `stripe: 14 provider records against 4 ledger records,
11 breaks | claims_rail: 1 provider records against 2 ledger records, 0 breaks`, and the run list
attributes those two runs to "Sam Patel, operations" while the cron-secret runs read "scheduled
job". Attribution works.

### The screen

Rendered as `staff_ops` on the deployed application, HTTP 200. It carries, in order: the source
paragraph naming "Stripe (LIVE SANDBOX)" and "the claim payout rail (LOCAL SIMULATOR)" with the
sentence that the rail keeps its own provider-side records; the Run now form; the open breaks table
with reference, source, classification and its plain-language meaning, provider amount, ledger
amount, difference, first-seen instant and age; the run list with window, records compared per
side and the per-classification counts; and an empty "Breaks that went away". The staleness
assumptions are printed above the breaks table as "24 hours at Stripe, 72 hours on the simulated
rail", which are decision 16's figures and the two constants in the code.

No money value is computed in the browser. The page is a server component: `formatCentsAsUsd` runs
on the server, every figure comes from a `bigint` column read as text and parsed by
`centsFromDatabase`, and the only client-side arithmetic anywhere is `describeAge`, which subtracts
two instants to produce a word. There is no button that could repair a break, which is the right
design.

The failed-run banner could not be exercised on the trial database, which holds no failed run. Its
path was read (`page.tsx` lines 60 and 86 to 92) and proved on `corgi_test` by
`check:reconciliation`, whose last four checks store a failed run for a provider outage and for a
ledger-read failure, confirm it carries no items, and confirm the open breaks of the previous
complete run are still there afterwards.

### The cron

`vercel.json` declares exactly one cron, `/api/jobs/daily` at `0 6 * * *`, which is 06:00 UTC and
matches decision 16. The endpoint exports GET and POST. GET is genuinely wired: an unauthenticated
GET returns 401 from `assertJobIsAuthorised`, while an unexported method on the same path returns
405, so the GET handler exists and runs. A wrong or missing bearer is refused.

**I cannot see the Vercel dashboard**, so I cannot confirm the cron is registered on the project,
that it fired, or what it returned. That remains the coordinator's check after this deployment.

I deliberately did **not** run `/api/jobs/daily` successfully against the trial database. Its
second step settles due simulated payouts, which posts journal entries, and appending to the trial
ledger is outside a reviewer's mandate and outside the "do not create anything else on the trial
database" instruction I was given. The successful path is therefore verified locally by the
delegate and by `check:reconciliation`, not by me on production.

## Readability, AF-06

A reviewer can assess explainability; he cannot certify Yoann's understanding. My assessment: the
slice is above the bar the rest of the repository sets, with one exception.

`diff.ts` is the best file in the slice. It is pure, it takes its clock as an argument, each
classification is one branch with the sentence it will show on the screen written next to it, and
every rule has a named test. The three-step order in `run.ts` (ask the provider, compare, store in
one transaction) is stated at the top and the code follows it literally. `breakKey` is twelve lines
and `describeAge` is ten.

The exception is `ledger-side.ts`. Its single query nests two CTEs, a `union all` over three sets
of entries, three correlated subqueries and a `case` expression inside a `where` clause. It is the
one place in B10 where a walkthrough is likely to stall, and it is also where both defects the
delegate found came from. It is well commented and it is doing genuinely irreducible work (a claim
payment's entries are filed under the claim event, not the operation), but Yoann should rehearse it
out loud before the debrief.

The three places I would expect a panel to point at:

1. `diff.ts` `classifyPair`, the `provider.status === "succeeded"` branch: why equal amounts are
   matched, why a ledger at zero is provider-only rather than a mismatch, and what the sign of
   `differenceCents` means.
2. `run.ts` lines 59 to 77: why the fetch is outside the transaction, why the failure path returns
   before any comparison, and why the run and its items are written together.
3. `ledger-side.ts` `attributed_entries`: why a claim payment's cash is found through
   `claim_events.money_operation_id` and why the reversal join is what makes a voided operation net
   to zero.

A likely fourth: `breakKey` plus `first_seen_at` in `run.ts` lines 96 and 113, which is where
F-B10-01 and F-B10-02 both live.

## The delegate's deviations

- **`reconciliation_items` rather than `reconciliation_breaks`.** Right call. Storing every
  compared record is what lets a clean run say how much it looked at, which is the difference
  between "no break" and "nothing was compared". The coordinator has already aligned
  `docs/ARCHITECTURE.md`.
- **GET on the daily endpoint.** Necessary and correct. Vercel Cron issues GET; a POST-only
  endpoint would never fire. Both methods share one authorisation path and one body. Verified
  above by the 401 on GET against 405 on an unexported method.
- **`lib/payments/refund-state.ts`.** A pure move of `refundStateFromEvents` into a file with no
  imports, with `lib/payments/refunds.ts` line 614 re-exporting both names. No caller changed and
  the reconciliation job no longer opens the Stripe client to read one rule. Good.
- **`lib/claims/settle-due-payouts.ts`.** Same shape: the standalone endpoint is now eleven lines
  of authorisation and a call, and the daily job runs the identical function. Removes the risk of
  the two drifting.
- **The captured Stripe listing with rewritten ids in the check script.** Acceptable and correctly
  labeled: the run stores a note beginning `FIXTURE (captured sandbox listing, no network call)`,
  the mapping itself is unit-tested against the untouched capture, and the same script separately
  exercises the real sandbox. Nobody can mistake one for the other, so AF-02 holds.
- **The clearing balances list, not built.** This is the one deviation I do not accept as
  equivalent. Recorded as F-B10-03.

## Not verified

- The Vercel cron registration and its first firing. No dashboard access.
- `/api/jobs/daily` on its successful path against the trial database, for the reason given above.
- A window large enough to page the Stripe listing. The delegate's limitation stands.
- Whether the two staleness thresholds match any real provider behaviour. They are labeled as
  assumptions in the code, on the screen and in decision 16, which is what the rules require, and
  that is all a reviewer can confirm.
- Yoann's understanding of any line of this slice.

## Verdict

**FAIL**, on F-B10-01 alone. The slice is otherwise well built: the append-only guards are real and
proven on both databases, the job writes nothing but its own two tables, a failed fetch genuinely
cannot read as clean, the planted mismatches are found on the real sandbox from the deployed
application, the authorisation matrix holds on every path I could reach, and the labels are honest.

The one defect is that the screen answers the wrong question. It asks "is this break in the latest
run" when the operator's question is "is this break explained". Until absence from a window is
distinguished from resolution, the reconciliation screen quietly loses exactly the breaks that
have been open longest. F-B10-02 and F-B10-03 are the same weakness seen from two other angles and
should be fixed in the same pass.

This is a scoped engineering assessment of one slice at one revision. It is not a legal
certification, not a statement about the integrated system, and not evidence that Yoann can defend
the code.
