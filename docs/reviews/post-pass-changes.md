# Independent review: money-path changes that landed after their slice's last PASS

Reviewer: independent reviewer sub-agent, working in the worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/agent-af4de43be0974c8fe`, branch
`worktree-agent-af4de43be0974c8fe`. Written at 2026-09-09T09:05Z.

Reviewed revision: `main` at **cc7bdda** (the tip of the shared checkout when this worktree was
cut; `5d405d2` is four commits behind it, and the three commits between them are documentation
and a console navigation entry outside this scope). The working tree carries no code change of
mine: the only file added here is this record. Two throwaway probe scripts
(`probe-rule21.ts`, `probe-prod-read.ts`) were written at the worktree root, run, and deleted
before the commit; their content is quoted in section 5 so the probe can be repeated.

Scope: seven changes that landed **after** the last PASS of the slice they belong to and that
carry no review record of their own. Sections A to D were assigned by the day-2 recheck,
section E by the coordinator's B7-B10 audit message at 10:18 local, sections F and G by its
follow-up. Each has its own matrix, findings and verdict; there is one overall line at the end.

This is a scoped engineering assessment of seven diffs. It is not a legal certification, it is
not a statement that the six delivery gates pass for the submission, and it does not re-open the
slice reviews these changes sit on top of.

## 1. Startup receipt

**Read in full, in this order, before looking at any code**: `CLAUDE.md`, `AUTOMATIC-FAILS.md`,
`READABLE-CODE.md`, `AGENTS.md`, `WORKFLOW-48H.md`, `REVIEWER.md`.

**Read in part, with what was read named**: `docs/DECISIONS.md` (the four entries of
2026-09-09 06:24Z, 06:35Z, 07:40Z and 07:45Z, that last one being decision 22, the statement
format version 3; the entries before 2026-09-08 20:36Z were not read);
`docs/reviews/FINDINGS.md` (the register lines for F-B2-17 to 21, F-B3-04 to 09, F-B4-04,
F-B4-12, F-B7-01 to 13, F-B8-08, F-B9-09, F-B10-09/11/12, F-B11-01 to 07, F-B12-10, F-B13-08 to
13; the file is 179 lines and was read by targeted grep, not end to end);
`docs/reviews/b13-2-low-batch.md` (sections 1 to 4 in full, including matrix row 5 on the lock
order and findings F-B13-09 to 13); `docs/handoffs/low-findings-notes.md` (the F-B2-18, F-B2-19
and F-B3-05 sections); `README.md` (the MCP surface paragraph, the demo roles line and the cut
list). `docs/reviews/b2-issuance-and-collection.md`, `b4-endorsements.md`,
`b7-claims-and-approvals.md`, `b9-statements.md` and `b11-mcp.md` were **not** read in full: they
were consulted only through their register lines in `FINDINGS.md` and through the b13-2 record.
A reader should not assume this review re-checked those slices against their own records.

**Code read for this scope**: the seven diffs line by line (`git show` of `4ddb33b`, `0fa828d`,
`5f2c841`, `369671d`, `919cd51`, `85b40b3`, `b1a0bce`, `4cef315`, and `git diff b956950^1
b956950` for the merge); `lib/claims/payments.ts` (`requestClaimPayment`, `sendClaimPayment`,
`wasRaisedByAnAgent`, `assertPaymentBelongsToClaim`, `settleClaimPayment`);
`lib/payments/collection.ts` (`postCollectionAndBind`, `recordPaymentWithoutBinding`,
`recordCheckoutSessionCompleted`, `appendSucceededEventOnce`, `correctionThatReversedOperation`,
`loadCheckoutOperation`); `lib/payments/endorsement-collection.ts` (`postDeltaAndApply` and
`parkPaymentWithoutApplying`); `lib/payments/correction-collection.ts`
(`recordSuccessfulCorrectionPayment`); `lib/policy/read.ts`, `endorsement-read.ts` and
`correction-read.ts` (the three `latestStatus` readers); `lib/statements/compute.ts` (the version
block and `collectedFigures`), `lib/statements/run.ts` (lines 115 to 145),
`app/statements/[runId]/page.tsx` (the version and chip block);
`lib/reconciliation/read.ts` (`openBreaks`, `resolvedBreaks`);
`app/api/webhooks/stripe/route.ts` (the success and expiry dispatch);
`lib/policy/change-requests.ts` (`workspaceHomeOf`); `app/ops/claims/[claimId]/page.tsx` (the
requested-through marker); `db/migrations/0013_low_findings.sql`,
`0016_statement_format_version.sql` and `0020_statement_format_v3.sql`; `scripts/check-mcp.ts`
(the header, the rule-21 block and the statement block), `scripts/check-statements.ts` (the two
version assertions), `scripts/check-claims-and-approvals.ts` (its report lines).

**Not read, and not consulted**: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`,
`READINESS-BACKLOG.json`, `GAP-REVIEW.md`, `docs/PLAN.md`, `docs/STATUS.md`,
`docs/COMPLIANCE-MATRIX.md`, `docs/ARCHITECTURE.md`, and every review record other than the two
named above. No readiness control was retained for this scope beyond what `AGENTS.md` already
requires. Absent files: none.

**Planned checks, and what happened** (counts in section 5): one run each of `check:mcp` (behind
a local dev server on the disposable database, per the script header), `check:claims-and-approvals`,
`check:payment-replay`, `check:endorsement-replay`, `check:correction-replay`, `check:statements`,
plus `npm test`; a hand-built probe of the rule-21 send gate on `corgi_test`; read-only
measurements on the deployed application. `check:money-guards` was **deliberately not run**, as
instructed: it is the known shared-database contention case, and it was proven at 184/184 at
06:55Z on an ephemeral database migrated to **0019**. **Migration 0020 has not been proven that
way**, and this review does not claim it has.

Nothing was pushed, nothing was deployed, no migration was applied anywhere, no shared planning
file was edited, and **no `UPDATE` or `DELETE` was issued against any database**. The probe wrote
inserts on `corgi_test` only; the single query against the trial database was a `select`. The
demo password was read from the main checkout's `.env.local` into a shell variable and never
printed. No secret appears in this file.

## 2. Applicability

Product: Track 1 commercial policy administration, USD in integer cents. Actors: `customer`,
`broker`, `staff_ops`, `staff_approver`, `agent`. Rails: Stripe test mode for premium collection,
endorsement deltas, correction differences and refunds; a local simulator for claim payouts.

No change in this scope engages a new external regime: none collects identity data, none calls a
new provider, none changes a tax or eligibility rule. The applicable requirements are therefore
the internal ones: **AF-03** (no `UPDATE` or `DELETE` on a money row; corrections are reversals
plus a re-book; a protected append-only table carries its own format marker), **AF-04**
(sandbox only), **AF-05** (no secrets), **AF-06** (explainable code), and from `AGENTS.md` the
maker-checker rules ("agents cannot approve"; "enforce the same gate server-side across UI,
direct API, worker, admin and MCP paths"), the concurrency rules ("use database transactions,
unique constraints and concurrency control for invariants"), the webhook rules ("do not assume
ordering or exactly-once delivery"; "reject stale state regressions") and the historical-query
rule that published statement revisions stay reproducible.

Confirmed facts: Track 1 selected 2026-09-08; rule 21 decided by Yoann 2026-09-08 20:35Z
(DECISIONS.md); statement format version 3 decided by Yoann 2026-09-09 07:45Z (decision 22).
Assumption carried and not verified here: that the deployed revision `7b8431c` contains every
commit in this scope, checked by ancestry rather than by reading the build.

---

## A. Rule 21: an agent-raised claim payment always waits for a human (commit 4ddb33b)

### A.1 What the change does

`requestClaimPayment` (`lib/claims/payments.ts:243`) now sets `needsApproval` to true whenever
`input.requestedThrough?.principalKind === "agent"`, whatever the amount, so an agent-raised
payment always creates an approval request bound to the immutable intent. `sendClaimPayment`
(`lib/claims/payments.ts:484`) gains a middle branch: an operation carrying **no**
`approval_request_id` whose `payment_requested` claim event says an agent raised it is refused
outright. `wasRaisedByAnAgent` (`lib/claims/payments.ts:800`) reads that answer from the
append-only `claim_events` row, not from the operation, so it cannot drift. The MCP tool
description and the ordering of the `check:mcp` probe follow.

### A.2 Matrix

| # | Requirement | Control and code location | Evidence | Verdict |
|---|---|---|---|---|
| A1 | An agent-raised payment below the threshold still reaches a human approver | `raisedByAgent \|\| claimPayoutNeedsApproval(...)` in `requestClaimPayment` | `check:mcp`: "RULE 21: AN AGENT ASKING FOR $500 ON A QUIET CLAIM CREATES AN APPROVAL REQUEST ANYWAY, below the threshold ($500, nothing pending before it: approval request created true)" | PASS |
| A2 | The approver can see it was a machine | `raised_by_agent` and `raised_through` on the approval request payload | `check:mcp`: `{"raised_by_agent":true,"raised_through":"MCP API key cmk_f035edcc (agent)"}`; and on the deployed claim CLM-00212 the payments table renders `raised by an AGENT, key cmk_e96f88a4` in the server HTML | PASS |
| A3 | Rule 21 does not over-fire on a person | The flag is read from `requestedThrough`, which is null for a screen action | Probe 1 on `corgi_test`: a `staff_ops` user asking $500 on a claim with nothing paid and nothing pending gets `approvalRequestId: null` | PASS |
| A4 | The send gate fails closed for an agent-raised payment with no request | The `else if (await wasRaisedByAnAgent(...))` branch | Probe 2 on `corgi_test`, the operation built by hand because rule 21 makes the state unreachable through `requestClaimPayment`: refused with "this payment was raised by an agent and carries no approval request; an agent-raised payment never leaves without a second person (rule 21)" | PASS |
| A5 | An ordinary human payment still sends | The chain falls through to `assertIntentIsApproved` or to the cumulative threshold | `check:claims-and-approvals`: "a distinct staff approver can approve it (approved)"; "two executions of the same approved payment produce ONE payment"; "a stuck claim payment below the threshold is sent by the job, through the screen's own function (the claim payment was sent on the simulated rail)" | PASS |
| A6 | The gate order cannot let an agent through by amount | The branches are `approvalRequestId` first, `wasRaisedByAnAgent` second, threshold third, so the agent branch is reached before the amount is ever consulted | Read at `lib/claims/payments.ts:478-497`; probe 2 fired the agent branch on an operation whose amount was below the ceiling | PASS |
| A7 | AF-03: nothing is updated or deleted | The change adds one read and two branches; no statement in the diff writes | `git show 4ddb33b -- lib/claims/payments.ts` grepped for `update `, `delete `: no hit outside comments | PASS |
| A8 | AF-06: the reading path is short | Two functions in one file plus one helper next to them, each with the business reason in the comment | Read; no indirection added | PASS |

### A.3 Findings

**F-PP-01 (LOW): `wasRaisedByAnAgent` orders by `recorded_at`, which is not a total order.**
The helper reads `order by recorded_at limit 1` over `claim_events`. `claim_events` also carries
`sequence_number bigserial` (migration 0008 line 76), described there as "total order of
recording, ties impossible", and `recorded_at` is a timestamp two rows can share. On today's code
one operation has exactly one `payment_requested` event, so the `limit 1` is not a choice between
rows and nothing is wrong. The failure mode is future: a second `payment_requested` row on one
operation would be picked by clock ties rather than by recording order, and the answer to "did an
agent raise this" would depend on timestamp resolution. **Required correction**: order by
`sequence_number`, which is what the schema comment says the column is for. One word.

**F-PP-02 (LOW): the send gate re-reads the claim event on every send, inside the money
transaction.** `wasRaisedByAnAgent` runs a second query against `claim_events` while the claim
lock is held. It is correct and cheap, and the alternative (trusting the operation row) is what
the comment deliberately rejects. Recorded only so the cost is visible, not as a required
correction.

### A.4 Verdict for A: **PASS**

The rule is implemented on both halves, the request side and the send side, the send side fails
closed on a state the request side can no longer produce, and both halves were exercised: the
request half by `check:mcp`, the send half by a hand-built probe. Two LOW findings, neither
reachable on today's code.

---

## B. The late `checkout.session.completed` (commits 0fa828d, 5f2c841, 369671d)

### B.1 What the changes do

`0fa828d` turned the unconditional `insert` in `recordCheckoutSessionCompleted` into an
`insert ... select ... where not exists (a 'succeeded' or 'failed' row)`, so a session-completed
event arriving after the money posted appends nothing and answers `already_posted`. `5f2c841`
made the policy reader prefer the final status over the last row. `369671d` closed the race the
guard alone could not: the guard read the operation before the posting transaction had
committed, so it saw no final status and appended anyway. Now every posting of a success takes
`pg_advisory_xact_lock(hashtext(operationId))` at the top of its transaction
(`postCollectionAndBind`, `recordPaymentWithoutBinding`, `postDeltaAndApply`,
`parkPaymentWithoutApplying`, `recordSuccessfulCorrectionPayment`), and the session-completed
handler takes the same lock before its not-exists check. The endorsement and correction readers
got the same "final status wins" rule as the policy reader.

### B.2 The race, and how far the lock closes it

Two Stripe events, `payment_intent.succeeded` and `checkout.session.completed`, 60 ms apart on
the endorsement delta of CGP-01707. Before `369671d`:

1. the success handler opens its transaction and starts posting;
2. 60 ms later the session handler runs its `where not exists` **outside** any lock. The
   success transaction has not committed, so its `succeeded` row is invisible;
3. the session handler appends `provider_accepted`;
4. the success transaction commits. The operation's last row now reads `provider_accepted`
   although the money is posted and the policy bound.

After `369671d`, step 2 blocks on the operation's advisory lock until step 4 releases it, and the
not-exists check then reads a committed `succeeded`. **The lock closes this race fully for the
window it covers**, and the reason is that both sides take the *same* key in the *same*
transaction that does the work: `pg_advisory_xact_lock` is held to commit, so there is no gap
between "I checked" and "I committed" on either side.

It does not make the ordering problem disappear, and two limits are worth stating plainly.
First, the lock is per process pool but the key space is a single 64-bit advisory namespace
shared by policy, operation, broker and claim keys (`hashtext` is 32-bit and widens; `claims.ts`
uses `hashtextextended`), so two unrelated ids that collide would serialize each other. That is
contention, not incorrectness, and at 2^-32 per pair it is not worth engineering around; it is
recorded as F-PP-04 because it is invisible in the code. Second, the fix protects **new** rows
only: rows written before it keep their order forever, which is precisely why the three readers
had to change as well. That pairing is right, and it is what makes the change append-only rather
than a repair.

### B.3 Lock order against the policy lock of F-B4-12

Every `pg_advisory_xact_lock` call site in the repository, enumerated independently
(`grep -rn pg_advisory lib app scripts db`, 12 sites):

| Site | Key | Also takes |
|---|---|---|
| `collection.ts:146` `postCollectionAndBind` | operation | nothing |
| `collection.ts:342` `recordPaymentWithoutBinding` | operation | nothing |
| `collection.ts:519` `recordCheckoutSessionCompleted` | operation | nothing |
| `endorsement-collection.ts:373` `postDeltaAndApply` | **policy** | then the operation at :377 |
| `endorsement-collection.ts:653` `parkPaymentWithoutApplying` | operation | nothing |
| `correction-collection.ts:443` `recordSuccessfulCorrectionPayment` | operation | nothing |
| `endorse.ts:276` | policy | nothing |
| `correct-endorsement-date.ts:353` | policy | nothing |
| `kyb.ts:184`, `kyb-onboarding.ts:95` | broker | nothing |
| `claims.ts:85` | claim (`hashtextextended`) | nothing |

**Confirmed: no transaction takes the operation lock before a policy lock.** `postDeltaAndApply`
is the only transaction holding two, policy first, and its comment says so. I also checked the
transitive case the b13-2 record asserts: none of the six operation-lock transactions calls a
function that takes a policy lock. `foldPolicyEvents` and `refreshPolicyCurrent`
(`lib/policy/current.ts`) take no advisory lock, and the grep above is exhaustive over `lib`,
`app`, `scripts` and `db`. This reproduces matrix row 5 of `docs/reviews/b13-2-low-batch.md`
independently, on the code as it stands after `369671d` rather than before it.

### B.4 Matrix

| # | Requirement | Control and code location | Evidence | Verdict |
|---|---|---|---|---|
| B1 | A late session-completed never drags an operation back from a final status | The `where not exists` in `recordCheckoutSessionCompleted`, under the operation lock | `check:payment-replay` (one run, no FAIL): the late session step is recorded as already known | PASS |
| B2 | The guard reads a committed status, not an in-flight one | Same advisory key on both sides, held to commit | `check:endorsement-replay` and `check:correction-replay`, one run each, no FAIL; and the reasoning in B.2 | PASS |
| B3 | The lock order cannot deadlock against F-B4-12 | Policy before operation in the only transaction holding both | The 12-site enumeration in B.3 | PASS |
| B4 | AF-03: no row is rewritten to fix the order | Every fix is an added `insert ... where not exists`, an added lock, or a read-side preference | `git show` of the three commits grepped for `update `/`delete `: no hit | PASS |
| B5 | Rows written before the fix still read correctly | `latestStatus: succeeded ? "succeeded" : ...` in `read.ts`, `endorsement-read.ts`, `correction-read.ts` | Deployed CGP-01707, the policy that produced the finding: the page renders `succeeded` and contains no `provider_accepted` | PASS |
| B6 | The parking paths are covered too | Locks added to `recordPaymentWithoutBinding` and `parkPaymentWithoutApplying` | Read; both are inside `database.begin` before any other statement | PASS |

### B.5 Findings

**F-PP-03 (LOW): `postCollectionAndBind` writes `policy_events` and `policy_current` while
holding only the operation lock.** The issuance posting inserts the `issued` policy event and
refreshes `policy_current` without taking the policy lock that `endorse.ts` and
`correct-endorsement-date.ts` take. It is safe today: a second issuance is refused by
`policy_events_one_issuance_per_policy`, and an endorsement cannot exist before a policy is
bound, so nothing races the issuance for the policy key. It is recorded because the invariant is
carried by a unique index and by an ordering fact about the product, not by the lock discipline
the endorsement path uses, and a reader comparing the two paths will ask why. **Required
correction**: none for the trial; state the reasoning in the code comment beside the operation
lock, or take the policy lock first there too, which the ordering in B.3 already permits.

**F-PP-04 (LOW): all advisory keys share one namespace, and `hashtext` is 32 bits.** Policy,
operation and broker keys all go through `hashtext(...)` into the single-argument
`pg_advisory_xact_lock(bigint)` space; claims use `hashtextextended(...)` into the same space. A
hash collision between two unrelated ids would serialize two unrelated transactions. No
correctness consequence, and no deadlock consequence given the order proven in B.3. Disclosed,
not corrected.

### B.6 Verdict for B: **PASS**

The race is closed for the window it covers, the lock order is compatible with F-B4-12, the
readers repair the history the fix cannot rewrite, and the three replay checks ran clean.

---

## C. Statement format version 3 (commit 919cd51, migration 0020)

### C.1 Widening only, compared with 0016

Migration 0016 added `canonical_version` with a default of 1 and a `check (canonical_version
between 1 and 2)`. Migration 0020 drops that constraint and recreates it as `between 1 and 3`.
Nothing else: no column added, no column removed, **no column redefined**, no row touched. That
is the rule F-B9-09 wrote down after migration 0015 changed what
`premium_collected_cents` means, and 0020 respects it: a run written under version 1 or 2 keeps
the version it was written with and reads exactly as before.

The one thing to check on a `drop constraint` / `add constraint` pair is the window between the
two statements, in which the table has no version check. Both statements are in one migration
file and the runner wraps a file in a transaction (`scripts/migrate.ts`), so the window is not
observable by another session, and no insert can land inside it. The `add` re-validates every
existing row, which is why a widening is safe and a narrowing would not be.

### C.2 The version constant and its two readers

`CANONICAL_STATEMENT_VERSION` moves to 3. Two new names carry the distinctions the single
constant used to conflate:

- `FIRST_VERSION_WITH_PREMIUM_COLUMN = 2` is what `collectedFigures` branches on
  (`run.canonicalVersion >= FIRST_VERSION_WITH_PREMIUM_COLUMN`). This is the correct predicate:
  versions 2 and 3 store cash and premium apart, version 1 does not, and the branch asks about
  the **column meaning**, which did not change at 3. Before the commit this line read
  `>= CANONICAL_STATEMENT_VERSION`, which would have silently demoted every v2 run to the v1
  reading the moment the constant moved. That is the sharpest line in the diff and it is right.
- `STATEMENT_VERSIONS_WITH_KNOWN_TOTALS = [2, 3]` is what the statement page uses to decide
  whether a figure gets an "explain this amount" fold. Membership, not `>=`, so an unknown future
  version 4 gets the amount alone rather than a v3 explanation. That preserves the intent of
  F-B12-06.

`run.ts` computes `identicalToPrevious` as `previous.canonical_version ===
CANONICAL_STATEMENT_VERSION && previous.content_hash === statement.contentHash`. A new run is
always written at `CANONICAL_STATEMENT_VERSION`, so this is "same version and same hash", which
is the honest reading: two texts hashed under different format headers cannot be compared.

### C.3 The first v3 run of Redwood 2026-09, reasoned

Measured on the trial database (read-only select): Redwood Commercial Brokers 2026-09 has
revision 1 (v1), revision 2 (v1, `identical_to_previous = true`) and **revision 3 (v2,
cash 594817, premium 576275, net due 38935)**. The next run of that month will be revision 4 at
version 3. Then:

- `identicalToPrevious`: `previous.canonical_version` is 2, `CANONICAL_STATEMENT_VERSION` is 3,
  so the first conjunct is false and the flag is **false**, whatever the hashes are. It cannot
  claim the new revision reproduces revision 3.
- the page's `formatChanged` is `previousCanonicalVersion !== canonicalVersion`, that is
  `2 !== 3`, so the screen shows **"format changed since revision 3"** and the paragraph that
  says the two documents hash different texts and cannot be compared.

So the required behaviour holds: **"format changed", not "identical"**. This is a reading of the
code plus the measured state of the row it will compare against; no v3 run has been produced on
either database, which is stated as a limitation rather than as evidence.

### C.4 Matrix

| # | Requirement | Control and code location | Evidence | Verdict |
|---|---|---|---|---|
| C1 | Migration 0020 is a widening and redefines nothing | `db/migrations/0020_statement_format_v3.sql`, two `alter table ... constraint` statements | Read against 0016; no column, no row, no default touched | PASS |
| C2 | A stored run keeps the meaning it was written with | `collectedFigures` branches on `FIRST_VERSION_WITH_PREMIUM_COLUMN`, not on the current version | Two deployed runs of the same broker and month, measured side by side after the constant moved to 3: revision 3 (v2) renders the v2 labels with **five** "Explain this amount" folds, while revision 2 (v1) renders the v1 note verbatim ("Statement format v1: the premium column holds the cash collected...") with **zero** folds. Neither was demoted or promoted by the bump | PASS |
| C3 | The published revision 3 still renders and ties to the ledger | `commissionPayableMovementCents` recomputed live on the page | Deployed `/statements/c775c8ce-...`: HTTP 200, "Canonical format version 2", the chip **"ties to the ledger"** rendered twice in the server HTML | PASS |
| C4 | Two revisions of different formats are never called identical | `run.ts:127-130` and the page's `formatChanged` | The reasoning in C.3, against the measured revision 3 row | PASS |
| C5 | The check script follows the constant | `scripts/check-statements.ts` imports `CANONICAL_STATEMENT_VERSION` in both assertions | `check:statements`, one run | PASS |
| C6 | Every check that asserts a version follows the constant | n/a | **`scripts/check-mcp.ts:454` still hard-codes 2: F-PP-05** | **FAIL** |
| C7 | AF-03 | No row written by the migration or the change | Read | PASS |

### C.5 Findings

**F-PP-05 (MEDIUM): `check:mcp` was left behind by the version bump and now fails.**

*Trigger.* `scripts/check-mcp.ts:454` asserts `ownStatement.value.formatVersion === 2` on the
statement the check publishes through the MCP surface. Commit `919cd51` moved
`CANONICAL_STATEMENT_VERSION` to 3 and updated the two assertions in `check-statements.ts` to
import the constant, but not this one. Run here against a dev server on `corgi_test` (57 PASS, 1 FAIL over 58 assertions):

```
FAIL  it carries the format version and the lines it published  (format v3, 2 lines)
1 CHECK(S) FAILED
```

*Consequence.* Two things, and the second is the one that matters. The application is correct:
the tool returned v3 because the run really was written at v3, which is the behaviour decision 22
asks for. But `docs/reviews/FINDINGS.md` line 135 closes **F-B11-01** (the rule-21 finding, a
MEDIUM on the agent surface) with the evidence "check:mcp 53/53", and that sentence is no longer
true at the reviewed head: the suite is 57 PASS, 1 FAIL. A register line that cites a green suite
which is now red is exactly the kind of evidence drift `AGENTS.md` forbids ("required checks
passed, with commands and actual results"), and the commit message for `919cd51` claims "the
check script follows the current version" without qualifying which script. Nobody is misled about
money; a reviewer is misled about proof.

*Required correction.* Import `CANONICAL_STATEMENT_VERSION` in `check-mcp.ts` and compare against
it, exactly as `check-statements.ts` now does. One import and one identifier. Then rerun
`check:mcp` and restate the count in the F-B11-01 register line.

**F-PP-06 (LOW): `STATEMENT_VERSIONS_WITH_KNOWN_TOTALS` needs a cast at its only use site.**
`app/statements/[runId]/page.tsx:97` reads
`(STATEMENT_VERSIONS_WITH_KNOWN_TOTALS as readonly number[]).includes(...)`, a cast forced by the
`as const` on the declaration. It is harmless and idiomatic TypeScript, but the cast is the sort
of line `READABLE-CODE.md` asks to justify or avoid; declaring the constant as
`readonly number[]` removes it. Cosmetic.

### C.6 Verdict for C: **FAIL**

The change itself is right: the migration widens without redefining, the column-meaning predicate
was correctly split from the format-number predicate, the published v2 revision still renders and
ties, and the first v3 run will say "format changed". But a check that the register cites as
passing now fails because this commit did not carry it, and `REVIEWER.md` reserves PASS for a
scope with no unresolved material issue and cited evidence that holds. The correction is one
line; the verdict moves to PASS once `check:mcp` is green again and the F-B11-01 register line
restates its count.

---

## D. The coordinator's small fixes (commit 85b40b3)

### D.1 Matrix

| # | Requirement | Control and code location | Evidence | Verdict |
|---|---|---|---|---|
| D1 | The tax fold cites only entries effective on or before the panel's date (F-B12-10) | `entriesEffectiveByPanelDate = entries.filter((entry) => entry.effectiveAt <= documentDate)` at `app/policies/[policyId]/page.tsx:194`, passed to `evidenceFromJournal` for `premium_tax_payable` | Deployed CGP-01707: the premium tax and flat fee folds render with their evidence captions; the filter is applied to both fold call sites and to no other figure | PASS |
| D2 | The same filter is applied to the fee fold | `evidenceFromJournal(entriesEffectiveByPanelDate, "fee_income")` | Read in the diff; both call sites changed, no third site left on the old variable for a fold | PASS |
| D3 | The filter changes evidence only, not the figure | The figures come from `terms.taxCents` / `terms.feeCents`, untouched | Read: the diff changes only the `evidence:` argument of the two `explain*` calls | PASS |
| D4 | A broker's refusal notice is printed (F-B13-08) | `app/broker/page.tsx`, `query.error` rendered in a `.notices` block | Deployed `GET /broker?error=probe+refusal+notice` as `broker@example.com`: `<p class="error" role="alert">probe refusal notice</p>` in the server HTML | PASS |
| D5 | A staff refusal notice is printed | `app/ops/page.tsx`, same shape | Deployed `GET /ops?error=probe+refusal+notice` as `ops@example.com`: `<p class="error" role="alert">probe refusal notice</p>` in the server HTML | PASS |
| D6 | The redirect targets that produce those notices exist | `workspaceHomeOf` in `lib/policy/change-requests.ts:43` returns `/broker` and `/ops`, and both change-request routes redirect to it with `?error=` | Read at `change-requests/route.ts:40` and `change-requests/[requestId]/reply/route.ts:42` | PASS |
| D7 | AF-05: the README lines add no secret | Three added sentences on key lifetime and reconciliation probe breaks | Read | PASS |

### D.2 Findings

**F-PP-07 (LOW): the two homes render the notice differently, and neither is dismissible.**
`app/broker/page.tsx` wraps the notice in `<div className="notices">`, `app/ops/page.tsx` prints a
bare `<p className="error">` outside any `.notices` block. Both render and both are announced
(`role="alert"`), so the finding is presentational: the two screens will not line up
visually, and neither notice clears on the next navigation because it lives in the query string.
Cosmetic; recorded so the difference is deliberate rather than accidental.

**F-PP-08 (LOW): `?error` is reflected into the page from the URL on both homes.** Anyone can
craft `/{ops,broker}?error=<text>` and have that text rendered inside a styled alert, as this
review did to measure D4 and D5. React escapes the value, so this is not an injection, and both
pages are behind a session, so the text can only be shown to someone who is already signed in as
that role. It is a phishing surface of the mildest kind (a signed-in user could be sent a link
that puts words in the application's mouth) and it is the price of the redirect-with-message
pattern the whole application uses. Disclosed, not corrected: closing it would mean carrying
refusal messages in a cookie or a store, which is a larger change than this finding warrants at
this hour.

### D.3 Verdict for D: **PASS**

Both findings the commit set out to close are closed, and both were measured on the deployed
application rather than read. Two LOW presentational findings, neither blocking.

---

## E. The first LOW-findings batch (merge b956950, migration 0013)

### E.1 Reading the diff correctly

A note first, because it changed the finding. `git diff c329caf 7635a70` (the merge's two
parents) shows the endorsement-delta guards being **removed** from `recordSuccessfulPayment`,
`recordExpiredCheckoutSession` and `latestSuccessfulPayment`. They are not: those guards landed
on the main line after the branch was cut, and the parent-to-parent diff misattributes them. The
diff that describes what the merge did is `git diff b956950^1 b956950`, and in it
`lib/payments/collection.ts` changes in exactly three places: one import, the
`policyWasVoided` early return in `correctionThatReversedOperation`, and the
`on conflict ... do nothing` clause in `appendSucceededEventOnce`. Everything below is read from
that diff.

### E.2 Migration 0013

Two objects, both additive, no row read, rewritten or deleted, nothing dropped or altered:

- `create unique index money_operation_events_one_succeeded_per_operation on
  money_operation_events (operation_id) where status = 'succeeded'`, a partial unique index that
  turns "at most one success per operation" into a database fact. **This is a new guard on an
  existing protected table**, so the question that matters is whether it can refuse a legitimate
  write. It can refuse exactly one thing: a second `succeeded` row on one operation, which is the
  state the finding says must not exist. The migration records that it was checked on both
  databases beforehand and that no operation carried two.
- `alter table journal_entries add constraint journal_entries_claim_id_fkey ... not valid`, then
  `validate constraint`, the ordinary two-step, which adds the rule for new rows without a
  blocking scan and then scans without blocking readers or writers. Also checked beforehand on
  both databases (3 rows on the trial database, 189 on `corgi_test`).

**No column is redefined and no column changes meaning.** That is the F-B9-09 rule, and 0013
predates the incident that produced it but satisfies it anyway.

### E.3 Matrix

| # | Requirement | Control and code location | Evidence | Verdict |
|---|---|---|---|---|
| E1 | Migration 0013 is additive | The index and the foreign key above | Read in full; no `alter column`, no `drop`, no `update` | PASS |
| E2 | The new index cannot refuse a legitimate write | Partial, on `status = 'succeeded'` only | Read; and `appendSucceededEventOnce` now answers `do nothing` rather than raising, so the loser of a race reads as already recorded | PASS |
| E3 | Two concurrent deliveries of one payment produce one success row (F-B2-19) | `where not exists` **and** `on conflict (operation_id) where status = 'succeeded' do nothing` | `check:payment-replay`, one run, no FAIL; the batch's own proof line inserts a second success row directly with the runtime role and gets `23505 money_operation_events_one_succeeded_per_operation` | PASS |
| E4 | A re-booked policy reads a late duplicate as already posted, not refused (F-B2-18) | `policyWasVoided(eventTypes)` early return in `correctionThatReversedOperation` | `check:payment-replay`, run here: "once the policy is re-booked, a redelivery of the original payment is already posted, not refused (outcome: already_posted)" and "that redelivery journaled nothing new (4 entries under the operation, 8 on the policy)" | PASS |
| E5 | A payment named in a URL belongs to the claim named in the same URL (F-B7-08) | `assertPaymentBelongsToClaim` in `lib/claims/payments.ts` | `check:claims-and-approvals`, run here: "a payment of another claim cannot be driven from this claim's URL (this payment belongs to another claim)" and "the claim that owns the payment passes the same check" | PASS |
| E6 | Settlement checks its own actor (F-B7-10) | `assertClaimsOperatorOrJob(input.settledBy)` at the top of `settleClaimPayment` | `check:claims-and-approvals`: "the approver cannot settle a payment: settleClaimPayment checks the actor itself" | PASS |
| E7 | Claim payouts are inside the recovery job (F-B7-05) | `claim_payout` added to `stuckOperations`; recovery resends through `sendClaimPayment`, so every gate re-runs | `check:claims-and-approvals`: "the recovery job's query returns claim payouts (69 claim payout(s) among 388 operation(s))"; "a stuck claim payment still waiting for its approver is left alone, with the reason"; "running the recovery again does not pay it twice (1 payment(s) sent on this claim)" | PASS |
| E8 | A future-dated loss is refused (F-B7-06) | The pure coverage rule | `check:claims-and-approvals`: "a claim for a loss dated in the future is refused, whatever the policy covers (the loss is dated 2028-05-01 ... today is 2026-09-09)" | PASS |
| E9 | A malformed id answers 400 or 404, not 500 (F-B7-07) | `lib/http/path-ids.ts` on the id routes and pages | The handoff notes list the five paths and their answers; **not re-measured here**, and `lib/http/path-ids.test.ts` passes inside `npm test` | PASS with the gap named |
| E10 | AF-03: the ledger still balances after the batch | n/a | `check:claims-and-approvals`: "every journal line in the database balances, debits against credits (debits 587900283 = credits 587900283)"; `check:endorsement-replay`: "(debits 618114717 = credits 618114717)" | PASS |

### E.4 Findings

**F-PP-09 (LOW): the `on conflict` clause and the partial index must stay in step, and nothing
says so at the index.** `appendSucceededEventOnce` names the index's predicate inline
(`on conflict (operation_id) where status = 'succeeded' do nothing`). PostgreSQL matches that
inference to the partial unique index of migration 0013; if the index were ever changed or
dropped, the statement would not degrade quietly, it would raise
`42P10 there is no unique or exclusion constraint matching the ON CONFLICT specification` at
runtime, on the money path. That is fail-loud, which is the right direction, but the migration
does not mention the caller and the caller does not name the migration in a way a `grep` for the
index name would find. **Required correction**: name the index in the SQL comment of
`appendSucceededEventOnce`, one line, so the two ends of the inference are greppable.

**F-PP-10 (LOW): `correctionThatReversedOperation` now folds the whole policy on every refused
payment.** The early return calls `foldPolicyEvents` before the query it guards, so a duplicate
delivery on a busy policy pays for a full event fold to answer a question about one operation. It
is correct and it is the choice the comment defends explicitly ("asking the fold rather than
repeating its rule here is what keeps the two answers from drifting apart"), which is the right
tradeoff for AF-06. Recorded so the cost is visible.

### E.5 Verdict for E: **PASS**

The migration is additive, its two new database facts cannot refuse a legitimate write, and every
money-path finding the batch claims to close was re-proven here by a check run rather than taken
from the handoff notes. The one item not re-measured (E9) is named.

---

## F. The resolved-break filter (commit b1a0bce)

### F.1 What the change does

`resolvedBreaks` (`lib/reconciliation/read.ts:201`) now reads the open breaks and drops from the
resolved list any row whose provider reference or ledger reference is still open **on the same
source**. The reason is F-B10-02: the break key changed shape, stored items keep the old key
forever, and without the filter one break shows twice, open under its new key and "went away"
under its old one. The fix is decided in the read, and no stored row is touched, which is the
only shape AF-03 allows.

### F.2 Matrix

| # | Requirement | Control and code location | Evidence | Verdict |
|---|---|---|---|---|
| F1 | A resolved break can never show as open | `openBreaks` is unchanged by this commit: it selects the latest report of each break and excludes any a later run re-examined. The filter added here only ever **removes** rows from the *resolved* list, so it cannot add one to the open list | Read; the diff touches `resolvedBreaks` only | PASS |
| F2 | An open break can never show as resolved | The `stillOpen` set is built from **all** open rows: `openBreaks(database)` takes no limit and returns every open break, so the filter cannot miss one because of paging | Read at `read.ts:173`, signature `openBreaks(database: postgres.Sql)`, no `limit` parameter and no `limit` in its SQL. This was the specific way the fix could have been wrong, and it is not | PASS |
| F3 | The match is on the money, not on the key | The set holds `${source}\|${ref}` for both the provider and the ledger reference, and a resolved row is dropped if **either** of its references is in it | Read | PASS |
| F4 | The deployed screen agrees with the ledger | n/a | Deployed `/ops/reconciliation` as `ops@example.com`: **"22 open breaks"** rendered in the server HTML, matching the count the coordinator's helper reported; the resolved list renders 8 "resolved" and 2 "went away" labels on the same page | PASS |
| F5 | AF-03 | No write anywhere in the commit; migration 0017 is touched only in a comment | `git show b1a0bce` read in full: 3 files, one of them a comment fix (`0016` to `0017`) and one a handoff note | PASS |

### F.3 Findings

**F-PP-11 (LOW): `resolvedBreaks` now runs two full scans and filters in the application.** It
reads every resolved row up to `limit`, then reads **every** open break to build the set, then
filters in JavaScript. On this data (22 open, 104 reconciliation items on the trial database) it
is free. It grows with the open-break count, which is the number that grows when something is
wrong, so the screen gets slower exactly when it is being read in anger. Recorded, not corrected:
the alternative is a `not exists` correlated on the reference pair, which is a real query change
and not a hot-fix.

**F-PP-12 (LOW): the filter can hide a genuinely resolved break that shares a reference with an
open one.** If two different money movements ever carried the same provider reference on one
source, and one is open, the other's resolution stops being listed. That is exactly the
shared-reference case F-B10-09 handles on the diff side, where the pairing is refused and both
sides annotated. Here the resolved row simply disappears from the list rather than being
annotated. No break is *created* and nothing open is hidden, so the failure is a missing
reassurance rather than a missed problem. Consistent with F-B13-12, which found the same
shared-reference case under-described on the other screen.

### F.4 Verdict for F: **PASS**

Both directions hold, and the one that could have failed (an open break slipping into the
resolved list because the open set was paged) does not, because `openBreaks` has no limit. The
production count matches.

---

## G. The PDF rewrite (commit 4cef315)

Kept short, as instructed. Four files, all presentational: `lib/documents/pdf-theme.ts`,
`lib/documents/render.tsx`, `lib/documents/write-sample-documents.ts`, `lib/statements/pdf.tsx`.

| # | Requirement | Control and code location | Evidence | Verdict |
|---|---|---|---|---|
| G1 | No figure is computed in the PDF layer | Every amount reaches the document as a prop from the `PolicySnapshot` or the stored `statement_run`, and is printed through the helpers in `lib/documents/format.ts` | Grepped both changed render files for arithmetic (`* `, `/ `, `+ `, `reduce(`, `Math.`) outside layout geometry: the only hit is a comment about column widths at `lib/statements/pdf.tsx:164`. No sum, no rounding, no percentage in either file | PASS |
| G2 | The version branch is still the shared one | The statement PDF reads `collectedFigures` from `lib/statements/compute.ts`, the same function the page and the check use | Covered by `lib/statements/pdf.test.ts` "a statement stored in the older format is printed with the older format's meaning" | PASS |
| G3 | The document is deterministic | n/a | `lib/documents/render.test.ts:55` "the same as-of date always produces the same declarations page"; `npm test`: **454 pass, 0 fail, 1 skipped** over 455 | PASS |
| G4 | The statement still renders as a real PDF | n/a | `check:statements` section at line 832, one run, no FAIL | PASS |
| G5 | No personal data beyond what the page shows | The declarations page prints the insured name, the mailing address and the producing broker, which are the same facts the policy page renders to the same audience; the signature block is printed **empty** with a caption saying this build signs nothing | Read in the commit message and the diff; no new field is sourced | PASS |

**Verdict for G: PASS.** No figure diverges and determinism is preserved. One note, not a
finding: G1 was established by grep and by reading the two render files, not by rendering a
document and diffing its numbers against the page, so it is a structural argument rather than a
measurement.

---

## 3. Overall

**Overall verdict: FAIL**, on the strength of C alone.

Six of the seven changes pass: A, B, D, E, F and G are correct, their money-path claims were
re-proven here by check runs and deployed measurements rather than taken from handoff notes, and
their findings are all LOW. C fails on one line: `scripts/check-mcp.ts` was not carried with the
version bump, so the suite the register cites at 53/53 to close F-B11-01 is now 57 PASS and 1
FAIL over 58 assertions. No money is at risk and the application's behaviour is the behaviour decision 22 asks for;
what is wrong is the evidence, and `REVIEWER.md` does not let a reviewer wave that through.

The correction is one import and one identifier in a check script, followed by a rerun and a
restated register line. When that is done, C moves to PASS and the overall line moves with it.
Nothing else in this scope blocks.

**Candidate walkthrough status: NOT REVIEWED WITH YOANN.** Nothing in this record was explained
to him or explained back by him. Four things in this scope are worth a walkthrough because they
are the kind of thing a panel points at: the three-branch send gate in `sendClaimPayment` and why
the agent branch sits *before* the amount branch (A.2 row A6); why the advisory lock had to be
taken by the *writer* as well as the reader, and what "held to commit" buys (B.2); why
`collectedFigures` branches on `FIRST_VERSION_WITH_PREMIUM_COLUMN` and not on
`CANONICAL_STATEMENT_VERSION` (C.2); and why migration 0013's index is *partial* (E.2).

## 4. Residual limitations

- `check:money-guards` was not run, as instructed. It was proven at 184/184 at 06:55Z on an
  ephemeral database migrated to **0019**. **Migration 0020 has not been proven that way**, and
  no claim is made that it has. It is a two-statement constraint widening inside one transaction,
  which is the cheapest thing to re-prove when a fresh ephemeral database is next available.
- No version 3 statement run exists on either database. Section C.3 is a reading of the code
  against the measured revision 3 row, not an observation of a v3 run.
- The under-lock refusal branches of B are not exercised by any check, for the same reason
  F-B13-09 records: producing a commit inside the lock window needs a race no check builds. B.2
  is a reasoned argument plus three clean replay runs, not negative evidence.
- E9 (the malformed-id paths) was not re-measured on the deployed application; only the unit
  tests were run.
- G1 is structural (grep plus reading), not a rendered-document comparison.
- Sections A to G were reviewed against `cc7bdda`; the deployed revision is `7b8431c`, which
  contains all seven changes by ancestry. The deployed measurements were taken there.
- The five slice reviews named in the assignment were consulted through their register lines and
  through `b13-2-low-batch.md`, not read in full.

## 5. Checks actually executed

| Check | Where | Result |
|---|---|---|
| `npm run check:mcp` | `corgi_test`, behind `next dev -p 3877` on `DATABASE_URL_TEST_APP` | **57 PASS, 1 FAIL** (F-PP-05), 58 assertions. Note the total: the register closes F-B11-01 with "53/53", and the suite now holds 58 assertions, so that line is stale in its count as well as in its outcome |
| `npm run check:claims-and-approvals` | `corgi_test` | **72 PASS, 0 FAIL** |
| `npm run check:payment-replay` | `corgi_test` | **34 PASS, 0 FAIL** |
| `npm run check:endorsement-replay` | `corgi_test` | **80 PASS, 0 FAIL** |
| `npm run check:correction-replay` | `corgi_test` | no FAIL line; last assertions "every journal line in the database balances (debits 621015132 = credits 621015132)" and "every single entry balances on its own (0 unbalanced entries)" |
| `npm run check:statements` | `corgi_test` | **ALL CHECKS PASSED** (the script's own summary line), last assertion "a broker's own list holds only that broker's statements (8 runs for broker A, 200 in the staff list)". The per-assertion count was not captured: the run was logged with a tail filter, so this review confirms zero failures but does not independently restate the "53/53" of the register |
| `npm test` | local | **454 pass, 0 fail, 1 skipped** of 455 |
| Rule-21 probe, 3 parts | `corgi_test`, inserts only | see below |
| Deployed measurements | `https://corgi-work-trial-iota.vercel.app`, revision `7b8431c` | see below |

**How many times each ran, stated plainly.** The first pass of the four replay and statement
checks was logged with a tail filter, which recorded the outcome but not the per-assertion count.
`check:payment-replay`, `check:endorsement-replay` and `check:mcp` were therefore run a second
time to count them; the counts above are from those runs and the outcomes agreed with the first
pass. `check:correction-replay` and `check:statements` were run **once** each and are reported by
their own summary lines rather than by a count. This exceeds the "one run each" the assignment
asked for on two checks; it is recorded rather than hidden, and every run was read-only apart
from the rows the checks themselves write on `corgi_test`.

**Not executed, and why**: `check:money-guards` (instructed not to; shared-database contention),
`check:reconciliation`, `check:kyb-replay`, `check:refund-replay`, `check:console`,
`check:change-requests`, `check:inbox-counts`, `check:ledger-guards`, `check:ledger-seal` (out of
scope for these seven diffs), `npm run typecheck` and `npm run build` (no source file was
changed by this review).

**The rule-21 probe**, run once on `corgi_test` with the runtime role for the application calls
and the owner role for the hand-built rows. It picked the claim with the smallest payout total
that had a verified claimant bank account and was not closed (CLM-02651):

1. `requestClaimPayment` as a `staff_ops` user, $500, on a claim with nothing paid and nothing
   pending: `approvalRequestId: null`. **A human's below-threshold request does not queue.**
2. A `claim_payout` money operation inserted by hand with `approval_request_id` null, one
   `money_operation_events` row `'requested'`, and one `claim_events` row `payment_requested`
   whose payload carries `requested_through: { principalKind: "agent" }`. Then `sendClaimPayment`
   on it: **refused**, "this payment was raised by an agent and carries no approval request; an
   agent-raised payment never leaves without a second person (rule 21)".
3. `sendClaimPayment` on the operation from step 1: **refused**, and *not* by rule 21, but by the
   cumulative ceiling of F-B7-13, because the $500 forged in step 2 now counts in that claim's
   pending total and $500 + $500 reaches the $1,000 ceiling. The refusal names the arithmetic and
   the way out. This is the cumulative rule working, and it means step 3 does **not** stand as
   the proof that a human's payment still sends; that proof is the three
   `check:claims-and-approvals` lines quoted at matrix row A5. Recorded as it happened.

Every write in the probe was an `insert`. No `UPDATE`, no `DELETE`, no `TRUNCATE`, on any
database. The two probe files were deleted before the commit.

**Deployed measurements**, all read-only `GET`s with a session cookie, revision `7b8431c`:

| What | Result |
|---|---|
| `/api/health` | `{"ok":true,"database":"ok","revision":"7b8431c..."}` |
| `/ops/claims/2f78c23c-...` (CLM-00212) as `ops@example.com` | 200; the payments table renders `raised by an AGENT, key cmk_e96f88a4` in the server HTML |
| `/policies/3c3697b7-...` (CGP-01707) as `ops@example.com` | 200; the premium tax and flat fee folds render with their date-filtered evidence captions; the page contains `succeeded` twice and **no** `provider_accepted`, which is the F-B2-20/21 reader fix holding on the policy that produced the finding |
| `/statements/c775c8ce-...` (Redwood 2026-09 **revision 3**) | 200; "Canonical format version 2"; the chip **"ties to the ledger"**; five "Explain this amount" folds |
| `/statements/5321274f-...` (Redwood 2026-09 **revision 2**, v1) | 200; "Canonical format version 1"; the v1 note rendered verbatim; **zero** "Explain this amount" folds |
| `/ops/reconciliation` as `ops@example.com` | 200; **"22 open breaks"** |
| `GET /broker?error=probe+refusal+notice` as `broker@example.com` | 200; `<p class="error" role="alert">probe refusal notice</p>` |
| `GET /ops?error=probe+refusal+notice` as `ops@example.com` | 200; `<p class="error" role="alert">probe refusal notice</p>` |
| Trial database, one `select` | Redwood 2026-09: rev1 v1, rev2 v1 (`identical=true`), **rev3 v2 cash 594817 premium 576275 net 38935**; Redwood 2027-09: rev1 v1, rev2 v2 |

A first attempt at the two home-page measurements used the wrong login path (`/api/session`
rather than `/api/session/login`) and read a redirect body in which the query string was echoed.
That reading was discarded; the rows above are from an authenticated 200 with the notice in the
rendered HTML.

## 6. Register lines

| ID | Sev | Finding (one line) | Fix | Status |
|---|---|---|---|---|
| F-PP-01 | LOW | `wasRaisedByAnAgent` orders `claim_events` by `recorded_at`, a timestamp two rows can share, where the schema provides `sequence_number` as the total order | Order by `sequence_number` | OPEN |
| F-PP-02 | LOW | The rule-21 send gate runs a second `claim_events` query inside the money transaction, under the claim lock | Accepted: the alternative is trusting the mutable operation row | OPEN (cost noted) |
| F-PP-03 | LOW | `postCollectionAndBind` writes `policy_events` and `policy_current` holding only the operation lock, unlike the endorsement path | Say why in the comment, or take the policy lock first (the order in B.3 permits it) | OPEN |
| F-PP-04 | LOW | Policy, operation, broker and claim advisory keys share one 64-bit namespace through 32-bit `hashtext`; a collision would serialize unrelated transactions | Disclosed; no correctness or deadlock consequence | OPEN (disclosed) |
| F-PP-05 | **MED** | `scripts/check-mcp.ts:454` hard-codes `formatVersion === 2`; commit 919cd51 bumped the canonical version to 3 without carrying it, so `check:mcp` is 57 PASS / 1 FAIL and the "53/53" evidence closing F-B11-01 no longer holds | Import `CANONICAL_STATEMENT_VERSION` and compare against it; rerun; restate the F-B11-01 register line | **OPEN, blocks C** |
| F-PP-06 | LOW | `STATEMENT_VERSIONS_WITH_KNOWN_TOTALS` needs a `readonly number[]` cast at its only use site | Declare it as `readonly number[]` | OPEN |
| F-PP-07 | LOW | The broker home wraps its refusal notice in `.notices`, the staff home does not; the two will not line up | One shape for both | OPEN |
| F-PP-08 | LOW | `?error` is reflected from the URL into a styled alert on both homes (escaped, session-gated) | Disclosed: the redirect-with-message pattern is application-wide | OPEN (disclosed) |
| F-PP-09 | LOW | `appendSucceededEventOnce` infers its `on conflict` from the partial index of migration 0013, and neither end names the other | Name the index in the SQL comment | OPEN |
| F-PP-10 | LOW | `correctionThatReversedOperation` folds the whole policy on every refused payment | Accepted: asking the fold is what stops the two answers drifting (AF-06) | OPEN (cost noted) |
| F-PP-11 | LOW | `resolvedBreaks` reads every open break and filters in the application, so the screen slows as the open-break count grows | A correlated `not exists` on the reference pair | OPEN |
| F-PP-12 | LOW | A genuinely resolved break sharing a provider reference with an open one disappears from the resolved list instead of being annotated (cf. F-B13-12) | Annotate rather than drop | OPEN |

---

## 7. Re-review, 2026-09-09T09:10Z: F-PP-05 fixed

**New revision**: `main` at **ea204d7**, merged into this worktree branch (fast-forward from
`d96451f` through `f722bd3`). Diff read: `git show ea204d7`, one file,
`scripts/check-mcp.ts`, +5 / -1.

**Resolved: F-PP-05 (MEDIUM).** The assertion at what is now line 457 compares
`ownStatement.value.formatVersion` against `CANONICAL_STATEMENT_VERSION`, imported from
`@/lib/statements/compute` immediately above it, instead of the pinned `2`. That is exactly the
required correction stated in C.5, and it is the same shape `check-statements.ts` already used.

**Evidence, my own run**, one run, against a dev server on `corgi_test`
(`DATABASE_URL_APP="$DATABASE_URL_TEST_APP" next dev -p 3877`, `MCP_BASE_URL` pointed at it,
server stopped afterwards):

```
PASS  it carries the format version and the lines it published  (format v3, 2 lines)
ALL CHECKS PASSED
```

**58 PASS, 0 FAIL**, which reproduces the coordinator's count exactly. The assertion now reads the
version the application actually wrote (v3) and agrees with it, rather than agreeing with a
number typed in the script.

**One observation, not a finding.** The import is dynamic (`await import(...)`) with a comment
saying it is placed there so the environment is loaded before lib modules. That reason does not
apply to this particular module: `lib/statements/compute.ts` imports only `node:crypto`, is pure,
and is imported statically at the top of `scripts/check-statements.ts` without trouble. The
dynamic form is harmless and defensive, and it is genuinely required for any lib module that
transitively pulls `db/client` (which throws at import time when `DATABASE_URL_APP` is unset, as
this reviewer found while writing the section A probe). No change requested; the comment slightly
overstates the necessity for this one module.

**Nothing else blocks.** The eleven remaining findings F-PP-01 to F-PP-04 and F-PP-06 to F-PP-12
are all LOW, none is reachable on today's code paths, and `REVIEWER.md` does not let cosmetic or
disclosed items block a scope on their own. The residual limitations of section 4 are unchanged
and still stand, in particular that **migration 0020 has not been proven under
`check:money-guards` on an ephemeral database** (that check was last proven at 184/184 at 06:55Z
at migration **0019**), and that no version 3 statement run exists on either database, so C.3
remains a reading of the code against the measured v2 row.

**Verdict for C, revised: PASS.**
**Overall verdict, revised: PASS**, for the seven changes A to G at revision `ea204d7`.

Scope and limits of this PASS are the ones declared in sections 1, 2 and 4: it covers these seven
diffs, it is a scoped engineering assessment rather than a legal certification, and it is not a
statement that the six delivery gates pass for the submission.

**Candidate walkthrough status: still NOT REVIEWED WITH YOANN.** Unchanged by this fix; the four
walkthrough topics listed in section 3 remain open.

### Register update

| ID | Sev | Finding (one line) | Fix | Status |
|---|---|---|---|---|
| F-PP-05 | MED | `scripts/check-mcp.ts` hard-coded `formatVersion === 2` after the canonical version moved to 3 | Compare against `CANONICAL_STATEMENT_VERSION` | **FIXED ea204d7**, re-review PASS 09:10Z: `check:mcp` 58 PASS, 0 FAIL on `corgi_test`, the line reads "format v3, 2 lines" |
