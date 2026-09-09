# Independent review: the LOW library sweep (nine findings), merge bf36b27

Reviewer: independent reviewer sub-agent, working in the worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/agent-a34efb789734571e0`, branch
`worktree-agent-a34efb789734571e0`. Written at 2026-09-09T12:43Z. Linear YOA-644, library half.

Reviewed revision: **bf36b27** (`Merge branch 'low-backlog-sweep'`, pushed 12:23Z), whose single
code commit is **2b904a7**. The diff read line by line is `git diff bf36b27^1 bf36b27`: 11 files,
+439 / -69. Working tree clean at review time; nothing was fixed or edited by me outside this
record.

The deployed application answers `/api/health` with revision
**3890300** (`Merge branch 'worktree-agent-ae5d4a08dba9ec97a'`), which has bf36b27 as an ancestor
(`git merge-base --is-ancestor bf36b27 3890300`: yes). `git diff --name-only bf36b27 3890300`
touches 24 files and **none of the eleven files under review**, so the production measurements
below were taken against the reviewed code, with the reservation that the reconciliation page
component itself (`app/ops/reconciliation/page.tsx`) did change between the two revisions.

This is a scoped engineering assessment of one batch of LOW fixes on money-adjacent code. It is
not a legal certification and it does not say that the six delivery gates pass for the submission.

## 1. Startup receipt

Read in full, in this order, before looking at any code: `CLAUDE.md`, `AUTOMATIC-FAILS.md`,
`REVIEWER.md`, `AGENTS.md`, `READABLE-CODE.md`, `WORKFLOW-48H.md`.

Then, for this scope, read in full: the whole diff `bf36b27^1..bf36b27`; the nine register lines
of `docs/reviews/FINDINGS.md` (F-PP-01, F-PP-03, F-PP-09, F-PP-11, F-PP-12, F-B10-07, F-B13-10,
F-B13-11, F-B13-12, F-B13-14, F-B8-06) plus the F-B10-11 and F-B10-09 lines; `post-pass-changes.md`
sections A (A.1 to A.4), B (B.3 to B.6) and F (F.1 to F.4); `b13-2-low-batch.md` matrix rows 9, 11
and 15 and the F-B13-10, F-B13-11, F-B13-12 sections; `b8-corrections.md` the F-B8-06 section, its
matrix rows and its re-review line; `b10-reconciliation.md` the F-B10-07, F-B10-09 sections and the
whole F-B10-11 section with its checks table; `lib/payments/collection.ts`;
`lib/reconciliation/read.ts`; `lib/reconciliation/diff.ts`; `lib/ledger/post.ts`;
`lib/policy/correction-read.ts`; `app/api/mcp/route.ts` (the POST handler) and the two endorsement
route files; the three new blocks of `scripts/check-correction-replay.ts`.

Read in part, with what was read named: `lib/policy/endorse.ts` (`recordEndorsementRequest`,
`requestEndorsement`, `approveEndorsement`, `openRefundsForReduction`);
`lib/policy/correct-endorsement-date.ts` (the transaction at 340-360, the two refusal sentences at
169 and 235); `lib/payments/endorsement-collection.ts` (the two lock sites and
`startEndorsementCheckout`); `lib/payments/correction-collection.ts` (the lock site and its
imports); `lib/broker/kyb.ts`, `lib/broker/kyb-onboarding.ts`, `lib/claims/claims.ts` (their lock
sites); `lib/policy/issue.ts`, `lib/policy/cancel.ts`, `lib/policy/void-fabricated-binding.ts`
(their `policy_events` transactions); `lib/claims/read.ts` (the two remaining `recorded_at`
orderings); `lib/money/premium.ts` (`cancellationBreakdown`, `earnedPremiumOfSegment`,
`elapsedTermDays`, `refundedTaxCents`); `lib/money/cents.ts`; `lib/mcp/jsonrpc.ts` (the envelope
and id handling); `lib/inbox/read.ts` (the defective-policy guard) and `lib/inbox/tasks.ts`
(`workspaceTasks`); `db/migrations/0009_endorsements.sql` (the two partial indexes),
`0013` (the succeeded index), `0002` (`money_operations.idempotency_key`);
`app/ops/reconciliation/page.tsx` (its four reads); `README.md` (the deployed URL line only).

Not read, and not consulted: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`,
`READINESS-BACKLOG.json`, `GAP-REVIEW.md`, `docs/PLAN.md`, `docs/DECISIONS.md`,
`docs/COMPLIANCE-MATRIX.md`, `docs/STATUS.md` beyond one grep for the deployed URL, the other slice
reviews. No retained readiness control was identified for this scope beyond what `AGENTS.md`
already requires. Absent files: none.

Next acceptance criterion for this scope: none of the nine is a new acceptance criterion; each is
a LOW finding closed against an existing one. Planned checks were those listed in section 5.

## 2. Applicability

Nine LOW findings on a US commercial policy administration application, Track 1, sandbox only.
Five touch money-adjacent code (the issuance posting lock, the agent-marker ordering, the two
concurrency catch blocks, the correction reader, the correction replay check), four touch the
reconciliation read path and the MCP transport. No new provider call, no new migration, no new
money movement, no schema change. No US legal rule is newly engaged by this diff; the applicable
requirements are the trial's own financial invariants and AF-03, AF-05 and AF-06 as they apply to
changed code.

## 3. Requirement matrix

| # | Finding, requirement | Control and code location | Evidence | Verdict |
|---|---|---|---|---|
| 1 | **F-PP-03**: the issuance posting takes the policy lock before the operation lock | `postCollectionAndBind`, `lib/payments/collection.ts:155` then `:158` | 13 advisory-lock sites enumerated (section 4.1); exactly two transactions hold two locks, both policy then operation; `check:payment-replay` 34 PASS 0 FAIL | PASS |
| 2 | F-PP-03: no cycle between the webhook path and a concurrent endorsement | Global order policy → operation; the endorsement request and both correction paths hold the policy lock only; the four other operation-lock transactions hold one lock and call nothing that locks | Enumeration plus an import trace of every transaction body (section 4.1) | PASS |
| 3 | **F-PP-01**: every read deciding the agent marker or the requested-through channel orders by `sequence_number` | `wasRaisedByAnAgent` (`lib/claims/payments.ts:829`) and the `requested_through` subselect (`:786`) | Both changed in the diff; grep over `lib/claims` and over every reader of `raised_by_agent` / `principalKind` (section 4.2); `check:claims-and-approvals` 74 PASS 0 FAIL | PASS |
| 4 | **F-PP-11 / F-B10-07**: `resolvedBreaks` correlates the open list in SQL | `open_report` CTE, `SHARES_A_REFERENCE_WITH_THE_RESOLVED_ROW`, the lateral join and the `not exists`, `lib/reconciliation/read.ts:202-297` | Read; `check:reconciliation` 39 PASS 0 FAIL; measured on `corgi_test` (section 4.3) | PASS |
| 5 | F-PP-11: the new result set loses nothing the old one showed | Same rule, exclusion set now strictly smaller | Measured on `corgi_test` against the previous implementation restored from `bf36b27^1`: limit 20 new 20 / old 6, limit 100 new 58 / old 6, **rows in old only: 0** at both limits. NOT identical: see finding **F-LS-02** | PASS with a finding |
| 6 | F-B10-07: `openBreaksPage` returns rows, `totalOpen` and `capped` | `lib/reconciliation/read.ts:326-345` | Measured: limit 5 → 5 rows, totalOpen 1395, capped true; limit 20 → 20/1395/true; limit 1000 → 1000/1395/true; each page is the first N of `openBreaks` in the same order. **No caller anywhere**: finding **F-LS-01** | PASS with a finding |
| 7 | F-B10-07: the open list stays complete for the inbox, the MCP tool and the job | `openBreaks` unchanged and unbounded; `oldestOpenBreakRecordDate` is now one `min()` on the same rule | Read; the aggregate returns the same instant as the old fold on `corgi_test` (2026-09-08T08:50:13.000Z, equal true) | PASS |
| 8 | **F-PP-12 / F-B13-12**: a resolved break sharing a reference with an open break of another operation is listed and annotated | `IS_THE_SAME_MONEY_AS_THE_RESOLVED_ROW` and the note built in `resolvedBreaks` | 11 annotated rows in the first 100 on `corgi_test`, each naming the shared reference and the open break key; both sides read back in full (section 4.3) | PASS |
| 9 | F-PP-12: the same money under an older key stays excluded (F-B10-11 not reopened) | The `not exists` on `SHARES ∧ IS_THE_SAME_MONEY` | Measured: **809** resolved rows whose ledger reference is still open under another key are excluded; the annotated rows all carry a ledger reference different from the open row's | PASS |
| 10 | F-B13-12: the classifier note is true of the record it is written on | `theOtherOneWasPairedByItsOperationId` in `diff.ts:146-160`, the two-branch `sharedRefNote` | The added assertion in `diff.test.ts:400-406` matches the new wording and refuses the old one; 62 reconciliation unit tests pass (60 before) | PASS |
| 11 | **F-B13-10**: the two catch blocks test the constraint name | `isViolationOf` (`lib/ledger/post.ts:92`), used in both routes | Both names exist in the database read as `app_runtime`: `policy_events_one_approval_per_request` (unique index, migration 0009:112, partial on `event_type = 'endorsement_approved'`) and `money_operations_idempotency_key_key` (constraint and index, migration 0002:195) | PASS |
| 12 | F-B13-10: a different 23505 now propagates | `isViolationOf` returns false unless `constraint_name` matches; the routes rethrow | Read. `approveEndorsement` performs exactly one insert, reachable only by that index; `startEndorsementCheckout` inserts `money_operations` first, so the idempotency key is the constraint a double click hits. That postgres.js surfaces an **index** name in `constraint_name` is shown by `check:payment-replay`, which prints `23505 money_operation_events_one_succeeded_per_operation` from `error.constraint_name` for a `create unique index` | PASS |
| 13 | **F-B13-11**: the not-recorded answer echoes the request id | `notRecorded(handled.response?.id ?? null)`, `app/api/mcp/route.ts:131` | Read on all three call sites: the post-dispatch one echoes, the unsupported-version and unparseable-body ones keep `null` because no id was ever read. `handleJsonRpcMessage` puts the envelope id (string or number, else null) on the answer; a notification has no answer, so `?? null` is right | PASS |
| 14 | **F-B13-14**: a payload without the totals reads as zero, with the reason on the view and in the sentence | `centsOrZeroWhenTheKeyIsAbsent`, `TOTALS_ADDED_AFTER_THE_FIRST_CORRECTIONS`, `qualifiedWhenTotalsAreMissing` | Measured on `corgi_test`: 117 `correction_rebook` events, 49 without the totals; `correctionsOfPolicy` over the 90 policies carrying a correction read 90, threw 0; an example view carries `totalsNotStored [policy_refunded_cents, policy_pending_refund_cents, customer_unapproved_requested_cents]`, `policyRefundedCents 0` and the caveat sentence | PASS |
| 15 | F-B13-14: a present but corrupt value still throws, and nothing rewrites the payload | `key in payload ? centsFromDatabase(...) : 0`; no write statement in the file | `centsFromDatabase` throws on `"not-a-number"`, on `12.5` and on `null`; the diff adds no `insert`/`update` anywhere | PASS |
| 16 | **F-B8-06**: the three assertions build the states they claim and quote the sentences the code emits | `scripts/check-correction-replay.ts:688-810` | `check:correction-replay` 58 PASS 0 FAIL; the three lines quoted in section 5; both refusal sentences are the literals of `lib/policy/correct-endorsement-date.ts:169` and `:235`; the cancellation figures recomputed by hand in section 4.4 | PASS |
| 17 | AF-03: nothing is updated or deleted | The diff adds one advisory lock, one exported predicate, read-side SQL, a tolerant reader and check assertions | `git diff bf36b27^1 bf36b27` filtered on added lines for `update`/`delete`/`truncate`/`drop`: no hit. The one write the new check makes is an `insert` of a `correction_reversal` policy event on the disposable database, which is the shape a real void writes | PASS |
| 18 | AF-04: sandbox only | No provider call added; the new check calls none | Read: `check:correction-replay` header says it calls no provider; the new blocks call `planEndorsementDateCorrection`, `recordCancellation` and `cancellationBreakdown` only | PASS |
| 19 | AF-05: no secret in the diff | n/a | Added lines grepped for `sk_live`/`sk_test`/`whsec`/`password`/`secret`/`api key`: no hit. No secret value appears in this record | PASS |
| 20 | AF-06: the reading path stays short and the money rule stays checkable | Comments carry the business reason beside each change; the two SQL fragments are named once and reused | Read. Two reservations: the comment of finding **F-LS-01** describes a caller that does not exist, and the comment of finding **F-LS-03** claims a lock discipline three other policy-writing transactions do not follow | PASS with findings |

## 4. What was verified, and how

### 4.1 The lock order (F-PP-03), enumerated

`grep -rn pg_advisory --include=*.ts .` over the repository, excluding `node_modules`: **13 sites**,
the twelve the post-PASS record enumerated in its section B.3 plus the one this diff adds.

| Site | Key | Also takes |
|---|---|---|
| `collection.ts:155` `postCollectionAndBind` | **policy** | then the operation at `:158` |
| `collection.ts:346` `recordPaymentWithoutBinding` | operation | nothing |
| `collection.ts:531` `recordCheckoutSessionCompleted` | operation | nothing |
| `endorsement-collection.ts:373` `postDeltaAndApply` | **policy** | then the operation at `:377` |
| `endorsement-collection.ts:653` `parkPaymentWithoutApplying` | operation | nothing |
| `correction-collection.ts:443` `recordSuccessfulCorrectionPayment` | operation | nothing |
| `endorse.ts:291` `recordEndorsementRequest` | policy | nothing |
| `correct-endorsement-date.ts:353` `recordEndorsementDateCorrection` | policy | nothing |
| `kyb.ts:184`, `kyb-onboarding.ts:95` | broker | nothing |
| `claims.ts:85` `lockClaimForMoneyDecision` | claim (`hashtextextended`) | nothing |

**No transaction takes the operation lock before a policy lock.** Two transactions hold both, and
both take the policy first, so the acquisition order is a total order and no cycle can form.
Checked transitively as well: none of the four operation-only transactions calls a function that
takes a policy lock. `foldPolicyEvents`, `refreshPolicyCurrent`, `cashWasParked` and
`postJournalEntry` take no lock; `correction-collection.ts` imports only the read
`moneyStillWaitingForTheCustomer` from the correction module, never
`recordEndorsementDateCorrection`; `collection.ts` calls `brokerKybState` (a read) **outside** the
transaction, so the broker lock is never nested under the policy lock.

Deadlock between the webhook path and a concurrent endorsement on the same policy: impossible.
The endorsement request holds the policy key alone and the issuance posting now queues behind it,
which is the intended serialisation; the late `checkout.session.completed` handler holds the
operation key alone and needs nothing the posting holds. No transaction holding a policy lock makes
a network call: `expireOpenEndorsementCheckouts` and `issueRefundsAtStripe` both run outside
`database.begin`, so the new lock cannot be held across a Stripe round trip.

Not verified: no live race was run. This is an enumeration and a reading, as the post-PASS record's
B.3 was.

### 4.2 The agent marker and the channel (F-PP-01)

Both decisive reads now order by `sequence_number`: `wasRaisedByAnAgent` and the
`requested_through` subselect of `claimPayments`. `grep -rn recorded_at lib/claims` leaves two
orderings, and both are display only:

* `lib/claims/read.ts:55`, `order by claim.recorded_at desc` orders the **claims** list on the
  screen. It picks no row and decides nothing; `claims` is one row per claim.
* `lib/claims/read.ts:189`, `order by entry.recorded_at, entry.id, line.id` orders journal lines
  for display, tie-broken by two ids, so it is deterministic and has no `limit`.

Every other reader of the marker (`lib/console/read.ts:606` and `:2501`, `lib/inbox/read.ts:283`,
`lib/approvals/approvals.ts:132`) reads `raised_by_agent` from one approval request row, not from an
ordered event list. The reserve history in `lib/claims/read.ts:134` already ordered by
`sequence_number`.

### 4.3 The reconciliation read, measured against the implementation it replaced

The previous `lib/reconciliation/read.ts` was restored from `bf36b27^1` into a temporary module and
run beside the new one against `corgi_test`, read only, in the same process. Both temporary files
were deleted before this record was committed.

| Measurement | Old | New |
|---|---|---|
| `resolvedBreaks(db, 20)` | 6 rows | 20 rows, 0 of the old rows missing |
| `resolvedBreaks(db, 100)` | 6 rows | 58 rows, 0 of the old rows missing |
| `oldestOpenBreakRecordDate` | 2026-09-08T08:50:13.000Z | identical |
| open breaks | 1395 | 1395 |

The difference is **not** the F-PP-12 annotation alone. Two causes, measured:

1. The old query applied `limit` in SQL **before** the JavaScript filter, so it selected the newest
   100 resolved rows and then threw away the ones sharing a reference, leaving 6. The new query
   filters in SQL and applies the limit last. This is a real paging defect that the fix removes as a
   side effect, and no record names it (finding **F-LS-02**).
2. Eleven rows in the first 100 are kept and annotated because the open break beside them names
   another operation. Read back in full, every one of them is a distinct refund operation sharing a
   **fabricated** provider reference produced by the check scripts (`re_check_now_at_stripe`,
   `pi_check_short`): resolved `stripe|op:6a7d013a-…` (ledger `6a7d013a-…`) beside open
   `stripe|op:2dfbf3d6-…` (ledger `2dfbf3d6-…`). Different ledger operations, so listing the
   resolution of one of them and saying nothing about the other is right.

F-B10-11 is **not** reopened: 809 resolved rows whose ledger reference is still open under another
key remain excluded by the `not exists`. I agree with the builder that annotating those instead of
excluding them would put the same money in both lists again, which is exactly the contradiction
F-B10-11 recorded on production. The discriminator is `ledger_ref` alone, and where either side has
none the rule falls back to "same money" and excludes, which is the safe direction: it can hide a
resolution, never invent one.

### 4.4 The cancellation figure, recomputed by hand (F-B8-06)

The check prints `refund 122653, and 121307 if nobody had corrected it`. Recomputed from the rule
in `lib/money/premium.ts`, term 2028-03-01 to 2029-03-01 (365 days), tax 235 bps, cancellation
2028-07-01:

Corrected history, segments 120000 from 2028-03-01 and 41095 from 2028-06-24 (250 days left):

* elapsed on the issuance segment: 2028-03-01 → 2028-07-01 = 31 + 30 + 31 + 30 = **122 days**
* earned issuance = floor(120000 × 122 / 365) = floor(40109.58…) = **40109**
* elapsed on the corrected segment = 2028-06-24 → 2028-07-01 = **7 days**
* earned correction = floor(41095 × 7 / 250) = floor(1150.66) = **1150**
* written 161095, earned 41259, unearned = **119836**
* tax back = ceil(119836 × 235 / 10000) = ceil(2816.146) = **2817**
* refund = 119836 + 2817 = **122653** ✔

Uncorrected counterfactual, segments 120000 from 2028-03-01 and 38630 from 2028-07-09:

* the second segment has not started on 2028-07-01, so `elapsedTermDays` clamps to 0 and it earns 0
* written 158630, earned 40109, unearned = **118521**
* tax back = ceil(118521 × 235 / 10000) = ceil(2785.24) = **2786**
* refund = 118521 + 2786 = **121307** ✔, and 122653 minus 121307 = **1346 cents apart**

Both figures reproduce exactly, uncapped, which also shows the tax charged on the policy is at
least 2817 so the F-B1-07 cap changed nothing here. The assertion itself compares the two totals
for inequality rather than asserting 122653, which is weaker than the sentence in the commit
message; the figures are printed in the detail line, so a reader sees them.

The two other new assertions build their states honestly. The voided policy is written as the void
writes it, an appended `correction_reversal` superseding the `issued` event (nothing updated or
deleted), which is exactly what `policyWasVoided` reads: `correction_reversal` present, `issued`
and `correction_rebook` absent. The refused endorsement is a real reduction applied immediately,
and the assertion checks the plan's direction is `refund` before matching the sentence. Both
sentences are the string literals the production function throws.

### 4.5 Production, GET only

`/api/health` → 200, revision 3890300 (bf36b27 is an ancestor). One `POST /api/session/login` as
`ops@example.com`, 303 to `/ops`, no form submitted afterwards, no money moved.

* `GET /ops/reconciliation` → 200. **22 open breaks**, the same count the post-PASS record measured
  at b1a0bce. The resolved panel renders "No break has been resolved yet". Under the new rule the
  exclusion set is a strict subset of the old one, so an empty new list proves the old list was
  empty too: the board's resolved panel is unchanged by this diff. No annotated row on production.
* `GET /policies/3c3697b7-…` (**CGP-01707**) → 200. Terms in force $2,400.00, issuance $1,200.00 +
  $28.20 tax + $25.00 fee = $1,253.20, endorsement delta $1,101.36 + $25.88 = $1,127.24, all
  matching the figures recorded in `b13-2-low-batch.md` and `post-pass-changes.md`
  (`120000 × 335 / 365 = 110136`; `125320 + 112724 = 238044`). The page still renders `succeeded`
  and contains no `provider_accepted`, so the B5 repair of the post-PASS record still holds.

## 5. Checks executed

All run from the review worktree at bf36b27, on `corgi_test` unless stated, one at a time.

| Command | Result |
|---|---|
| `npm run check:payment-replay` | exit 0, **0 FAIL**. The output was piped through `tail -25` by my own mistake, so I did not count its PASS lines; the script has exactly 34 `report(` calls and no loop around one, and it exits non-zero on any failure, so 34 PASS 0 FAIL follows from the exit code |
| `npm run check:reconciliation` | **39 PASS, 0 FAIL**, exit 0 |
| `npm run check:correction-replay` | **58 PASS, 0 FAIL**, exit 0, including the three new lines quoted below |
| `npm run check:claims-and-approvals` | **74 PASS, 0 FAIL**, exit 0 |
| `npm run typecheck` | clean, exit 0 |
| `npm test` | **472 pass, 1 skipped, 0 fail** |
| `node --import tsx --test lib/reconciliation/*.test.ts` | **62 pass, 0 fail** (60 before this batch) |
| reviewer probe, read only, `corgi_test` | the measurements of sections 4.3 and 4.4 and the two constraint names |
| production, GET only | section 4.5 |

The three new correction-replay lines, verbatim:

```
PASS  a voided policy cannot have its endorsement corrected: there is no policy under it any more  (this policy was voided by a correction: there is no endorsement on it to correct)
PASS  an endorsement whose delta was REFUNDED is refused by name, not half corrected  (direction refund: this build only corrects an endorsement whose delta was collected; an endorsement that refunded premium has to be corrected by hand for now)
PASS  a cancellation after a correction gives back the CORRECTED segment: 41095 from 2028-06-24, not the 38630 booked on 2028-07-09  (segments 120000 from 2028-03-01, 41095 from 2028-06-24; refund 122653, and 121307 if nobody had corrected it)
```

**Database contention: none observed.** The four checks ran clean on their first run, sequentially,
with no deadlock and no retry. No other agent's run collided with mine while I held the database.

### Checks NOT executed, and why

* `npm run check:money-guards`: not run, as instructed. Cited as coordinator evidence: **192 of 192
  PASS** on an ephemeral database at migration 0021, 10:42Z. The diff adds no migration, no grant
  and no table, so it cannot weaken a guard; I did not re-establish that count myself.
* `npm run check:mcp`: not run (it needs a local server). The builder reports 59. I read the code
  path instead, which is what the F-B13-11 assertion needs; the not-recorded branch only runs when
  the audit insert fails and is not exercised by that check either.
* `npm run check:inbox-counts`: not run, it is outside the four I was allowed and another builder
  may hold it. The register cites 53 with no unreadable policy. My own probe is the stronger
  evidence for F-B13-14: 90 policies read through `correctionsOfPolicy`, 0 throws.
* No live concurrency race for the lock order or for either catch block. Both rest on an
  enumeration and a reading, as the two earlier records did.
* The previous `resolvedBreaks` was **not** run against the trial database: production is GET only
  for me, so the production claim in section 4.5 rests on the subset argument, not on a measurement
  of the old code there.

## 6. Findings

**F-LS-01 (LOW): `openBreaksPage` has no caller, and the comment beside it says a screen uses it.**
`grep -rn openBreaksPage lib app scripts` finds the definition and nothing else, at bf36b27 and at
the deployed revision 3890300. The board still calls the unbounded `openBreaks(sql)`
(`app/ops/reconciliation/page.tsx:63`), so the screen finding F-B10-07 named is not yet bounded on
any screen. The register discloses this ("the screen's cap sentence is a follow-up"); the code
comment does not, and reads in the present tense: "A screen showing a page of it asks
`openBreaksPage` below, which bounds the read and says so on the page". A reader trusting the
comment will believe the board is paged. Minor and related: `openBreaksPage` reads its rows and its
count in two statements outside a transaction, so `capped` is computed from two snapshots; harmless
for a hint on a screen, worth knowing before it is used for anything else. **Required correction**:
either call it from the board with the cap sentence, or word the comment as the intention it is.

**F-LS-02 (LOW): the new resolved list is a strict superset of the old one, and the record says it
correlates the same rule.** Measured in section 4.3: 58 rows against 6 at limit 100. Nothing is
lost, and both causes are defensible, but only one of them (the annotation) is written down. The
other is that the old implementation applied its SQL `limit` before its JavaScript filter, so the
resolved panel could show far fewer rows than the limit, and could show none while resolved breaks
existed. That was a real defect of the screen; this diff removes it, silently. On production the
panel is empty under both implementations, so nobody will notice, but on any database with shared
references the panel now shows a different number of rows than it did yesterday. **Required
correction**: one sentence in the record and in the F-PP-11 register line saying the limit now
applies after the filter. No code change.

**F-LS-03 (LOW): the new comment claims a lock discipline that three policy-writing transactions do
not follow.** `collection.ts:147` says the policy lock is "the lock discipline every other posting
path follows". `lib/policy/issue.ts:56` (`quoted`), `lib/policy/cancel.ts:362` (`cancelled`) and
`lib/policy/void-fabricated-binding.ts:103` (`correction_reversal`) each insert into `policy_events`
holding no advisory lock at all. None of them can deadlock, because they take no lock, and each has
its own guard; but "every other posting path" is not true, and this is exactly the kind of sentence
a panel will test. Pre-existing and outside this diff's scope; recorded against the comment, not
against the lock. **Required correction**: say "every other posting path that takes locks", or open
a separate finding for the cancellation path, which can interleave with an endorsement request on
the same policy today.

**F-LS-04 (LOW, cosmetic): the annotation names one open break when several may carry the
reference.** The lateral is `order by open_report.break_key limit 1`, so a resolved row sharing a
reference with two open breaks names the first by key. On `corgi_test` all eleven annotated rows
have two candidates each. The sentence says "ANOTHER BREAK", which stays true, and the operator is
sent to a real open break either way. Recorded, no correction required.

No finding above is a blocker. Nothing in the diff writes, rewrites or deletes a money row; nothing
weakens a guard; no figure on a screen changed except the resolved panel discussed in F-LS-02.

## 7. Readability (AF-06)

The reading path is short in every file. `isViolationOf` sits beside `isUniqueViolation` with the
reason for the narrowing written above it. The two SQL fragments of `read.ts` are named once and
reused three times, which is what stops the three lists of one screen from drifting apart, and each
carries the finding it answers. `centsOrZeroWhenTheKeyIsAbsent` is four words long and says what it
does. The one place a reader will stumble is `resolvedBreaks`: three `database.unsafe` fragments, a
lateral join and a `not exists` in one statement, with the discriminating rule
(`IS_THE_SAME_MONEY_AS_THE_RESOLVED_ROW`) expressed as three `or`ed null tests. It is correct and it
is commented, but it is the hardest query in the build to explain out loud, and the explanation
needs the F-B10-11 story to make sense. Yoann should rehearse that one specifically, with the
809 / 11 split of section 4.3 as the concrete example.

## 8. Verdict

**PASS** for the nine findings at **bf36b27**, with four LOW findings opened (F-LS-01 to F-LS-04),
none of them a blocker and none of them a money defect.

Residual limitations: no live concurrency race was run for the lock order or for either catch
block; `check:money-guards`, `check:mcp` and `check:inbox-counts` were not run by me and are cited
from other runs; the production evidence is GET only and rests on a subset argument for the
resolved panel; `workspaceTasks` still returns an empty badge list on any read failure, which is
the accepted design the F-B13-14 fix removes one cause of, not all of them.

**Candidate walkthrough status: NOT REVIEWED WITH YOANN.** No part of this batch has been explained
back by him. The technical verdict above says nothing about that.

## 9. Register lines

| ID | Severity | Finding | Required correction | Status |
|---|---|---|---|---|
| F-LS-01 | LOW | `openBreaksPage` has no caller: the reconciliation board still calls the unbounded `openBreaks`, while the comment beside the new function says a screen already pages through it | Call it from the board with the cap sentence, or word the comment as an intention | OPEN |
| F-LS-02 | LOW | The new `resolvedBreaks` also moved the `limit` after the filter, so the resolved panel returns rows the old one dropped (58 against 6 at limit 100 on corgi_test, none lost); only the annotation half of that change is written down | One sentence in the F-PP-11 register line and in the record | OPEN |
| F-LS-03 | LOW | The F-PP-03 comment claims "the lock discipline every other posting path follows", but `issue.ts`, `cancel.ts` and `void-fabricated-binding.ts` write `policy_events` holding no lock | Reword, or open a finding for the cancellation path | OPEN |
| F-LS-04 | LOW | The resolved-break annotation names one open break when several carry the same reference | None required | OPEN, accepted |

Register update for the nine reviewed findings: **F-PP-01, F-PP-03, F-PP-09, F-PP-11, F-PP-12,
F-B10-07, F-B13-10, F-B13-11, F-B13-12, F-B13-14 and F-B8-06 are all verified FIXED at bf36b27**
by this review, with the F-B10-07 line to keep its "the screen still calls openBreaks" caveat and
the F-PP-11 line to gain the limit-after-filter sentence of F-LS-02. The coordinator owns
`docs/reviews/FINDINGS.md`; nothing in it was edited by me.
