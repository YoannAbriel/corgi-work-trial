# Independent review, slice corrections-rule-24 (round 1)

Reviewer: independent reviewer sub-agent, working in the worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/wf_46bb3e09-77f-8`, detached at the
reviewed SHA, review branch `review/corrections-rule-24-r1`. Written at 2026-09-09T13:50Z.

Reviewed revision: `slice/corrections-rule-24` at **0510c1b51e66f9245789c8523005f877e49ea012**
(two commits: `f0aa2d9` the rule, `0510c1b` the replay scenario). Diff read:
`git diff main...0510c1b`, with `main` at `0ee1b6e` and the merge base at `03a55c1`. Eight files,
353 insertions, 154 deletions. The working tree was clean at the reviewed SHA; the only files this
review created are this record, a `.env.local` symlink and a `node_modules` symlink to the main
checkout, both removed before the commit.

This is a scoped engineering assessment of one slice on an unpushed branch. It is not a legal
certification and it does not state that the six delivery gates pass for the submission.

## 1. Startup receipt

Read in full, in this order, before looking at any slice code: `CLAUDE.md`, `AUTOMATIC-FAILS.md`,
`READABLE-CODE.md`, `AGENTS.md`, `WORKFLOW-48H.md`, `REVIEWER.md`.

Then, for this scope, read in full: `lib/approvals/threshold.ts`, `lib/money/correction.ts`,
`lib/payments/correction-collection.ts` (lines 1 to 400), `lib/policy/correction-read.ts`
(lines 60 to 340), `lib/policy/correct-endorsement-date.ts` (lines 36 to 330, 455 to 600, 790 to
835), `lib/policy/endorsement-requests.ts` (lines 130 to 233, 241 to 340), `lib/money/endorsement.ts`
(lines 1 to 140), `lib/money/correction.test.ts` (the threshold section), the diff of
`lib/approvals/threshold.test.ts`, `scripts/check-correction-replay.ts` (the whole diff plus the
fixture helpers it uses), `app/api/policies/[policyId]/corrections/[rebookEventId]/approve/route.ts`,
`app/policies/[policyId]/correction-sections.tsx` (lines 110 to 140), `db/.gitignore` conventions
via `.gitignore`, `package.json`.

Read in part, with what was read named: `docs/DECISIONS.md` (decision 24 in full, plus the heading
list of the whole file); `docs/reviews/b8-corrections.md` (the matrix and the finding table, for
F-B8-02 and F-B8-04); `docs/reviews/integration.md` (sections 12.1, 12.2 and 12.5);
`docs/reviews/FINDINGS.md` (the tail, for the register format); `docs/reviews/b13-6-change-requests.md`
(its startup receipt, for the record format); `db/migrations/0002_policies_and_money_operations.sql`
(the `policy_events` guards and grants), `db/migrations/0003_seal_journal_entries_and_truncate_guards.sql`
and `db/migrations/0004_truncate_guards_for_policy_and_money_tables.sql` (the truncate guards).

Not read, and not consulted: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`,
`READINESS-BACKLOG.json`, `GAP-REVIEW.md`, `docs/PLAN.md`, `docs/STATUS.md`,
`docs/COMPLIANCE-MATRIX.md`, the other slice reviews. No retained readiness control was identified
for this scope beyond what `AGENTS.md` already requires. Absent files: none.

Next acceptance criterion under review: the customer-approval decision on a correction difference
follows decision 24 (per policy, cumulative over the term's additional premium before tax, strictly
above $500, a decrease never counts), decided by one function shared with the endorsement path.

Planned checks and what happened: `npx tsc --noEmit` (exit 0), `npm test` (477 tests, 476 pass,
1 skipped, 0 fail), `npm run check:correction-replay` once on `corgi_test` (65 PASS, 0 FAIL),
`npm run check:endorsement-replay` once on `corgi_test` (90 PASS, 0 FAIL), `gitleaks detect` over the
two commits (no leaks). `check:money-guards` was deliberately not run: the coordinator proves the
guards on an ephemeral database.

Nothing was pushed, nothing was deployed, no migration was applied anywhere, no shared planning
file was edited, no code file was modified, and no UPDATE or DELETE was issued against any
database. The database URLs were read by the npm scripts themselves from a symlink to the main
checkout's `.env.local`; no connection string, password or secret was printed at any point and none
appears in this file. No local server was started, so port 3800 was never touched.

## 2. Applicability

Feature: staff operations correct the effective date of an endorsement already in force; the
correction re-prices that endorsement and creates a premium difference the customer owes or is
owed. The slice changes ONE decision: whether the customer must approve paying that difference.
Sandbox only, synthetic fixtures, USD integer cents, California 2.35 percent premium tax, one
Stripe test-mode account. No provider call is added or changed by the slice.

Confirmed facts: decision 24 of `docs/DECISIONS.md` (2026-09-09T09:50Z) sets the $500 customer
threshold per policy, cumulative over the additional premium **before tax** of the endorsements of
the current term, applied ones and open requests together, strictly above, a reduction never
counting. Yoann's recited example (300, 300, 50) is in the decision.

Assumption, named because it matters: decision 24 as written speaks of **endorsements**, not of
correction differences. Extending it to a correction difference is the substance of this slice and
rests on the instruction given to the builder ("Yoann 15:00 local: yes"), which is not yet in
`docs/DECISIONS.md`. The extension is coherent (a date correction re-prices an endorsement of the
same term, so its difference is additional premium of that term) and it removes the asymmetry
`docs/reviews/integration.md` section 12.5 recorded as an accepted scope line. It remains a
decision to record; see F-CORRECTIONSRULE24-05.

No US legal rule is engaged by this slice beyond what B4 and B8 already carry: the threshold is an
internal control of this build, not a regulatory figure, and the code says so
(`lib/money/endorsement.ts:35`).

## 3. What the slice actually does, traced

1. **Preview.** `planEndorsementDateCorrection` (`lib/policy/correct-endorsement-date.ts:224`)
   reads `additionalPremiumOfTheTerm(policyId, wrongEvent.figures.termStart, exceptRequestEventId:
   null)` and passes it as `totals.additionalPremiumOfTheTermCents`. Nothing is excluded because
   the endorsement being corrected is still in force at that instant, so the base contains its
   premium as booked and base + difference is the total the term will carry once the re-book has
   replaced it. Checked against the query itself (`lib/policy/endorsement-requests.ts:173`): the
   applied branch counts `endorsed` and `correction_rebook` rows of the term with
   `delta_premium_cents > 0` that no correction supersedes, the open-request branch counts
   unanswered requests, and the sum can therefore never be negative, which is what the shared
   predicate requires.
2. **The verdict.** `correctEndorsementDateMoney` (`lib/money/correction.ts:138`) calls
   `endorsementNeedsCustomerApproval` with `additionalPremiumSoFarCents` = that base and
   `additionalPremiumCents` = `differencePremiumCents` (before tax, signed). The settlement test
   that used to guard the call is gone; I checked it is safe rather than accepting the comment:
   the predicate returns false on any value at or below zero (`lib/approvals/threshold.ts:141`),
   and a positive premium difference always implies a positive total because the charge tax is
   `floor(premium x rate)`, monotone in the premium (`lib/money/endorsement.ts:133`). So
   "approval required" always comes with a settlement of `collect` and with a sentence.
3. **Recorded once, inside the transaction.** `recordEndorsementDateCorrection`
   (`lib/policy/correct-endorsement-date.ts:349`) re-plans under `pg_advisory_xact_lock`, so the
   base is read at execution time, not carried from the screen. The verdict and the base are
   written on the re-book payload (`:490`, `:497`) as new keys; nothing is updated.
4. **The payment gate.** `differenceNeedsTheCustomer`
   (`lib/payments/correction-collection.ts:202`) reads the re-book event (policy, term start,
   `difference_premium_cents`), reads the same query, subtracts the difference back out because
   the re-book is already in force, and asks the same predicate. Both callers use it:
   `approveCorrectionCollection:161` and `startCorrectionCheckout:317`. I checked the subtraction
   cannot go negative in practice: the planner refuses any endorsement whose delta was refunded
   (`correct-endorsement-date.ts:242`), so the corrected endorsement was a charge, and the re-book
   carries old premium + difference, which the query counts whenever the difference is positive.
5. **Read back.** `correctionsOfPolicy` (`lib/policy/correction-read.ts:129`) still reads the
   verdict from the event and never recomputes it; the base is read from the NEW key, and a
   correction recorded before decision 24, which does not carry it, is named in `totalsNotStored`
   and the sentence carries the caveat (`:296`).

Ownership and roles are unchanged and were re-checked at the two entry points the slice touches:
only the customer of the policy may approve (`correction-collection.ts:153`, customer id from the
session), only the owning broker or staff operations may open the hosted page (`:306`), and the
`policyId` the caller passes is still the one the `correction_collections` row is scoped to
(`outstandingCorrectionCollection:254`), so deriving the policy from the re-book event inside the
gate cannot cross policies.

## 4. Requirement matrix

| Requirement | Control and code location | Evidence | Verdict |
|---|---|---|---|
| A correction difference is decided by the same predicate as an endorsement | `endorsementNeedsCustomerApproval` called from `lib/money/correction.ts:138` and `lib/payments/correction-collection.ts:209` | code read; `lib/approvals/threshold.test.ts` new case; replay lines 54 to 58 | PASS |
| ... on the same running total (term's additional premium, applied and open together) | `additionalPremiumOfTheTerm` at `correct-endorsement-date.ts:224` and `correction-collection.ts:204` | replay: "running total 38630 ... $501.36 of additional premium in this term"; "running total 86273 ... $912.04" | PASS |
| Premium before tax; the tax never decides | `differencePremiumCents` passed, never `differenceTotalCents` | unit test "the tax is excluded": base 45069 + 4931 = 50000 exactly, tax 116 on top, verdict still false | PASS |
| Strictly above $500.00 | `>` in `threshold.ts:144` | unit test "exactly $500.00 is not above it, one cent more is" | PASS |
| A correction that lowers the premium never needs the customer | `additionalPremiumCents <= 0` returns false, no settlement test in front | unit test "a correction that lowers the premium never needs the customer" on a term at 90000 | PASS |
| The preview names the running total the way the endorsement preview does | `correctionApprovalSentences` at `correction.ts:168` | replay prints the sentence in full | PASS with F-CORRECTIONSRULE24-02 |
| `customerApprovalNeeded` and `moneyStillWaitingForTheCustomer` removed, no caller left | both deleted | `grep -rn` over `app lib scripts components db`: two comment mentions only, no code reference | PASS |
| No posting amount changes: only the decision moved | `git diff main...HEAD -- db lib/ledger app components` | **empty**, 0 files; the eight touched files are the rule, its tests and the replay | PASS |
| The gate cannot be bypassed by another caller | both callers of `differenceNeedsTheCustomer`; routes are thin | code read of the approve and checkout routes; replay: gate refuses, 0 `provider_accepted` events | PASS |
| Role and ownership checks unchanged | `correction-collection.ts:153` and `:303`; `planEndorsementDateCorrection:147` | replay: "only the customer of this policy can approve paying the difference" | PASS |
| No column redefined, no applied migration edited | new payload key `additional_premium_of_the_term_before_difference_cents`; old key never reused | `git diff` on `db/` empty; `TOTALS_ADDED_AFTER_THE_FIRST_CORRECTIONS` names the new key so an older correction reads as "not recorded" | PASS |
| AF-03: no UPDATE or DELETE on money rows | every write in the slice is an INSERT; `policy_events` carries `policy_events_are_append_only` (0002:172) and `app_runtime` holds `select, insert` only (0002:263) | grep of every added line for `update`/`delete`/`truncate`/`drop`: no match; replay: "every journal line balances", "0 unbalanced entries" | PASS |
| AF-04: sandbox only | no provider call added; the gate refuses before `assertStripeSandbox()`; the replay calls no provider and refuses any database not named `corgi_test` (`check-correction-replay.ts:110`) | replay ran on `corgi_test` only | PASS |
| AF-05: no secret committed | `gitleaks detect --log-opts main..HEAD` | 2 commits scanned, **no leaks found**; no secret printed in this session | PASS |
| AF-01: deployed evidence | none: the branch is unpushed and undeployed | not applicable to this slice at this SHA | NOT RUN |
| AF-06: explainable line by line | one predicate, one query, one sentence builder | see section 5; walkthrough status below | PASS with reservations |

## 5. Findings

| ID | Severity | Finding |
|---|---|---|
| F-CORRECTIONSRULE24-01 | LOW | The gate comment claims it "can only ever ask for MORE approval, never less"; the new base can shrink, so a difference the correction recorded as needing the customer can become collectable without one, and the screen then blocks the only button that would collect it. |
| F-CORRECTIONSRULE24-02 | LOW | The customer sentence names a tax-included amount and a tax-excluded running total side by side, so a reader cannot check the arithmetic from the sentence alone. |
| F-CORRECTIONSRULE24-03 | LOW | `additionalPremiumOfTheTermCents` means "before this change" in `CorrectionThresholdTotals` and "including this quote" in the endorsement plan: one name, two meanings, in the two files Yoann has to explain together. |
| F-CORRECTIONSRULE24-04 | LOW | A correction recorded before this change prints a sentence whose figures contradict its own verdict ("carries $50.47 of additional premium ... above $500.00"), qualified only by a caveat appended after it. |
| F-CORRECTIONSRULE24-05 | LOW | Decision 24 in `docs/DECISIONS.md` speaks of endorsements only; the extension to correction differences, which is this slice, is not recorded there. |
| F-CORRECTIONSRULE24-06 | INFO | The re-book payload still carries `customer_approval_required` computed with an empty base, beside the `difference_customer_approval_required` that decides. Nothing reads it to gate money. |

### F-CORRECTIONSRULE24-01 (LOW): the gate can also ask for LESS than the correction recorded

**Trigger.** `lib/payments/correction-collection.ts:194` states "It can only ever ask for MORE
approval, never less." Construct: endorsement A applied, +40000 of premium; endorsement request R1
open, +20000; a correction of A adds +1000. The preview base is 60000, the running total 61000,
above $500, so the correction is recorded with `difference_customer_approval_required = true`.
The broker then requests R2 of +100, which supersedes R1. At the gate the term total is
41000 + 100 = 41100; the difference is subtracted back out and added again, so the predicate
compares 41100 against 50000 and answers false.

**Consequence.** `startCorrectionCheckout` no longer requires the approval, while
`approveCorrectionCollection` refuses the customer's own approval ("this difference leaves this
term's additional premium at or below the $500 threshold"), and
`app/policies/[policyId]/correction-sections.tsx:132` hides the Pay button because the stored
verdict is true and no approval event exists. The difference is then collectable only by a direct
POST to the checkout route by the owning broker or staff. No money moves without an authorised
actor and no threshold of decision 24 is broken (41100 really is under the line at that moment),
so this is a consistency and dead-end problem, not a money-rule violation.

**Not a regression.** The base of the deleted `moneyStillWaitingForTheCustomer` shrank more easily
(any quote that got answered dropped out of it), so the same shape existed at `main`. What the
slice adds is a comment that is now demonstrably wrong.

**Required correction.** Either delete the sentence and say the gate re-reads the rule as it stands
now, in both directions; or make the screen fall back to the gate's answer so the customer is not
shown an approval nobody can give. I did not run this scenario against a database: it is derived
from the query and the two callers, and it is reported as reasoned, not measured.

### F-CORRECTIONSRULE24-02 (LOW): two bases in one sentence

`lib/money/correction.ts:168` prints, measured in the replay:
"$117.77 to collect: with this difference, this policy carries $501.36 of additional premium in
this term, above $500.00, so the customer has to approve it before it is collected". $117.77 is
premium plus tax; $501.36 is premium only, and the premium part of the difference (11506) appears
nowhere. A reader who tries to check the claim by subtracting $117.77 from $501.36 lands on the
wrong figure. `READABLE-CODE.md` asks for a checkable example beside a financial rule, and the
file's own comment says "never state a verdict without the total it was read against".

**Required correction.** Name the premium part in the same sentence, for example "$117.77 to
collect, of which $115.06 of premium: with it this policy carries $501.36 of additional premium in
this term". The change is in the pure function, so no screen moves.

### F-CORRECTIONSRULE24-03 (LOW): one name, two meanings

`CorrectionThresholdTotals.additionalPremiumOfTheTermCents` (`lib/money/correction.ts:62`) is the
total **before** the difference. `EndorsementPlan.additionalPremiumOfTheTermCents`
(`lib/policy/endorse.ts:215`) is the total **including** the quote. The stored event key was
carefully disambiguated (`additional_premium_of_the_term_before_difference_cents`) but the two
TypeScript fields were not. The two files are read together during a debrief on exactly this rule.

**Required correction.** Rename the correction one `additionalPremiumOfTheTermBeforeDifferenceCents`
(or the endorsement one `...WithThisQuoteCents`), a mechanical change with the payload key as the
model.

### F-CORRECTIONSRULE24-04 (LOW): the old corrections print a contradictory sentence

For a correction recorded before this change, `centsOrZeroWhenTheKeyIsAbsent`
(`lib/policy/correction-read.ts:289`) reads the missing key as zero, so
`correctionApprovalSentences` prints the running total as the difference alone while the branch is
chosen by the stored verdict. A correction that needed the customer under the old rule therefore
reads "with this difference, this policy carries $50.47 of additional premium in this term, above
$500.00", with the caveat sentence appended after it. The caveat is honest and the verdict shown is
the one the correction decided, which is why this is LOW and not higher; the sentence in front of
it still states arithmetic that is false on its face. This is reachable on any database carrying a
correction recorded before this slice, the deployed one included.

**Required correction.** When `totalsNotStored` contains the running-total key, drop the figure from
the sentence rather than printing zero plus a caveat: "the running total behind this verdict was not
recorded".

### F-CORRECTIONSRULE24-05 (LOW): the decision itself is not recorded

Decision 24 covers endorsements. This slice applies it to correction differences on the strength of
an instruction relayed in the task ("Yoann 15:00 local: yes"). The builder correctly did not edit
`docs/`. For AF-06 the register needs the decision in Yoann's own terms, dated, beside decision 24.

**Required correction.** Coordinator adds one entry to `docs/DECISIONS.md` and updates section 12.5
of `docs/reviews/integration.md`, which still describes the correction path as having a base of its
own.

### F-CORRECTIONSRULE24-06 (INFO): a stale flag beside the one that decides

`rebookPayload` spreads `endorsementRequestPayload({ figures: plan.money.after })`
(`correct-endorsement-date.ts:464`), which writes `customer_approval_required` from a re-pricing
computed with no running total, so it can read false beside a
`difference_customer_approval_required` of true. I checked every reader: the correction screens and
the inbox read the `difference_` key through `collectionOfCorrection`
(`correction-read.ts:227`), and `lib/policy/endorsement-requests.ts:46` says the standing decides
for endorsements. Nothing gates money on the stale flag. Pre-existing, not introduced here, recorded
so nobody later reads it as a verdict.

## 6. Checks executed

| Check | Where | Result |
|---|---|---|
| `npx tsc --noEmit` | this worktree at `0510c1b` | **exit 0** |
| `npm test` | this worktree at `0510c1b` | **477 tests, 476 pass, 1 skipped, 0 fail**; the skip is the opt-in live Stripe sandbox test (`RUN_LIVE_STRIPE_TESTS`), unrelated |
| `npm run check:correction-replay` | `corgi_test`, once, one at a time | **65 PASS, 0 FAIL**, including the new section 4b end to end |
| `npm run check:endorsement-replay` | `corgi_test`, once, one at a time | **90 PASS, 0 FAIL**, the same count the decision 24 re-review reported: the endorsement path is unchanged by this slice |
| `gitleaks detect --log-opts "main..HEAD"` | the two commits | 2 commits scanned, **no leaks found** |
| `git diff main...HEAD -- db lib/ledger app components` | this worktree | **empty** |
| `grep` for the two deleted functions and the old payload key | `app lib scripts components db` | no code reference left, two comment mentions |
| Guard shape read in the migration SQL, no database queried | `db/migrations/0002`, `0003`, `0004` | `policy_events_are_append_only` before update or delete, truncate guard, `app_runtime` granted `select, insert` only |

From the replay output, for the new scenario (the third line's parenthesis abridged where marked):

```
PASS  the endorsement itself added 38630 of premium: under $500, collected with no approval
PASS  the correction adds 11506 of premium, which is under $500 on its own
PASS  but it takes the term's additional premium to 50136, above $500: THE CUSTOMER APPROVES
      (running total 38630: $117.77 to collect: with this difference, this policy carries
       $501.36 of additional premium in this term, above $500.00, ...)
PASS  the payment gate refuses to collect the difference before the customer has approved
PASS  only the customer of the policy can approve it, not their broker
PASS  once the customer has approved, the same difference is collected and the receivable closes
PASS  the verdict and the running total behind it are written on the correction event
```

Contention: `corgi_test` is shared with other builders. Both replays ran in about six minutes
each (correction 15:34 to 15:40 local, endorsement 15:41 to 15:47), which is slow for the work they
do but far below the two hours per script the builder reported: the contention had largely cleared
by the time this review ran. Each check was run once and one at a time; nothing was retried or
looped, and no fixture noise from another agent appeared in either output.

## 7. What was not verified

- **No deployed evidence.** The branch is unpushed and undeployed; every measurement above comes
  from this worktree and from `corgi_test`. AF-01 for this slice is NOT RUN, not PASS.
- **F-CORRECTIONSRULE24-01 was reasoned, not executed.** I did not build the superseded-request
  fixture on the shared database; the finding is derived from
  `additionalPremiumOfTheTerm`'s open-request branch and the two gate callers.
- **`check:money-guards` was not run** (the coordinator owns it), so this review does not restate
  that the guards hold; it reads the migrations that declare them.
- **No screen was exercised.** No app file changed, and I did not render the corrections screens;
  the claim that the new sentence reaches them rests on reading the three files that print
  `approvalSentences`.
- **The other check scripts were not run** (payment, refund, statements, reconciliation, mcp,
  console, claims, inbox). The slice touches no posting and no migration, so a regression there is
  unlikely, but it is unmeasured.
- **The builder's two operational notes were not independently reproduced**: the killed first run of
  the correction replay and the `.env.local` symlink it created and removed. `git status` at the
  reviewed SHA is clean and `gitleaks` finds nothing, which is consistent with the account given.

## 8. Verdict

**PASS** for the reviewed scope at `0510c1b51e66f9245789c8523005f877e49ea012`.

The rule the task asked for is implemented once, in the function the endorsement path already uses,
on the running total that path already reads, and the three places that ask the question (preview,
recorded event, payment gate) cannot disagree on the rule itself. No posting amount moved, no
migration was touched, no money row can be updated or deleted by anything in the diff, no role or
ownership check was weakened, and the new replay section proves the crossing case end to end with
figures that would fail if the rule were per correction. All six findings are LOW or INFO; none of
them blocks the slice, and F-CORRECTIONSRULE24-05 is a coordinator action on `docs/`.

Residual limitations: the deployed-application evidence is missing for this slice, the shared test
database was under heavy contention while the checks ran, and the wording findings (02 and 04) are
exactly the kind a panel reads out loud.

Candidate walkthrough status: **NOT REVIEWED WITH YOANN**. No walkthrough took place in this
session and none is claimed. The rule is explainable in one reading path (`threshold.ts:127` for
the predicate, `endorsement-requests.ts:173` for the running total, `correction.ts:138` for the
correction's call, `correction-collection.ts:202` for the gate), which is what the slice was for.

## 9. Register lines

| ID | Severity | Finding | Required correction | Status |
|---|---|---|---|---|
| F-CORRECTIONSRULE24-01 | LOW | The payment gate comment claims it can only ask for more approval than the correction recorded; a superseded open request makes it ask for less, and the screen then hides the only button that would collect the difference | Correct the comment and let the screen follow the gate | OPEN |
| F-CORRECTIONSRULE24-02 | LOW | The customer sentence names $117.77 (tax included) beside a $501.36 running total (premium only), so its arithmetic cannot be checked from the sentence | Name the premium part of the difference in the same sentence | OPEN |
| F-CORRECTIONSRULE24-03 | LOW | `additionalPremiumOfTheTermCents` means "before this change" in the correction totals and "including this quote" in the endorsement plan | Rename one of them, as the payload key already does | OPEN |
| F-CORRECTIONSRULE24-04 | LOW | A correction recorded before this slice prints "carries $50.47 of additional premium ... above $500.00" plus a caveat | Drop the figure when the running total was not recorded | OPEN |
| F-CORRECTIONSRULE24-05 | LOW | Decision 24 covers endorsements only; its extension to correction differences is not in `docs/DECISIONS.md`, and `integration.md` 12.5 still describes the old asymmetry | Coordinator records the decision and updates 12.5 | OPEN (coordinator) |
| F-CORRECTIONSRULE24-06 | INFO | The re-book payload carries a `customer_approval_required` computed with an empty base beside the verdict that decides | Leave, or stop writing it on a re-book | OPEN |
