# Independent review, slice "mcp-tools", round 3: explain_amount and list_my_activity

Reviewer: independent adversarial reviewer sub-agent, working in the worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/wf_4bff1824-553-3`, detached at the
reviewed SHA. Written at 2026-09-09T15:46:18Z (17:46 CEST).

Reviewed revision: **ce42a3c331f8dc2006ead1f2ee6887c181047e9d**, the head of the fix branch
`worktree-wf_4bff1824-553-2-mcp-fix-r3` (five commits `735a202`, `24d08a9`, `76fcb33`, `3908a11`,
`ec2f641`, `ce42a3c`), read as `git diff origin/main...ce42a3c`: 20 files, 1433 insertions, 38
deletions, no `.sql` file. Working tree clean apart from this record. No code was modified,
nothing was pushed to `main`, no migration was applied anywhere, no `docs/` file other than this
one was touched.

This is a scoped engineering assessment of one slice. It is not a legal certification, and it is
not a statement that the six delivery gates pass for the whole submission.

**Verdict: PASS.** The two HIGH and the one MEDIUM of round 2 are closed, and closed by the
structural rule rather than by another filter: `explain_amount` refuses every key whose user is
not a broker or staff, before the policy is looked up, so the fold that carried the broker's
commission, the 1500 bps rate and the journal entry ids is never reached by a customer key. I
confirmed the refusal over HTTP on four different arguments and the rule exhaustively in unit
tests. Four LOW and two INFO findings remain open, three of them carried from round 1 and never
addressed by any round; none of them blocks.

## 1. Startup receipt

Read in full, in this order, before looking at any code of the slice: `CLAUDE.md`,
`AUTOMATIC-FAILS.md` (the six rules and the operating gate), `READABLE-CODE.md`, `AGENTS.md`,
`REVIEWER.md`.

Then, for this scope: `docs/DECISIONS.md` rules 28 and 29 and the surrounding money rules (the
2.35 percent California rate, the recited cancellation example, the 15 percent commission),
`git show review/mcp-tools-r1:docs/reviews/backend-mcp-tools-r1.md` in full,
`git show review/mcp-tools-r2:docs/reviews/backend-mcp-tools-r2.md` in full,
`docs/reviews/FINDINGS.md` on `origin/main` (the two MCPTOOLS register blocks, lines 452 to 470).

Code read in full at the reviewed SHA: `lib/mcp/scope.ts`, `lib/mcp/scope.test.ts`,
`lib/mcp/tools/explain-amount.ts`, `lib/mcp/tools/my-activity.ts`, `lib/mcp/tools/tool.ts`,
`lib/mcp/tools/tool.test.ts`, `lib/mcp/tools/index.ts`, `lib/policy/explain-figure.ts` (all 431
lines), the whole diff of `scripts/check-mcp.ts` plus its fixture builders,
`scripts/dev-on-test-database.ts`, `lib/mcp/never-delegated.test.ts` (diff and surroundings), the
`lib/mcp/jsonrpc.ts` diff, the README diff, the `package.json` diff, the `lib/policy/read.ts`
diff.
Read in the parts that matter here: `lib/money/explain.ts` (`explainAccountSum`,
`evidenceFromJournal`, `explanationResultLine`), `app/policies/[policyId]/page.tsx` (the role
branching at lines 99 to 107, the `AmountExplained` folds, the unconditional `JournalTable` at
line 949), `app/policies/[policyId]/customer-view.tsx` **on `origin/main`, not only on the
branch** (to check the premise the whole fix rests on against the interface that is being
rebuilt), `db/migrations/0021_activity_log.sql` (the guards, the absence of a payload column, the
`message` column), `app/api/mcp/route.ts` (`activity.message = handled.log.detail`),
`lib/claims/limits.ts` (`claimPaymentRefusal`, which is where a refusal sentence gets an amount),
`lib/auth/current-user.ts` (the five roles), `lib/claims/claims.ts` and `lib/claims/payments.ts`
(the refusal texts that reach the activity log).

Not read, and why: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`,
`GAP-REVIEW.md` (advisory catalogues; no retained control beyond what `AGENTS.md` already
requires was identified for two read-only MCP tools), `START-PROMPT.md` (explicitly not a rule
source), `WORKFLOW-48H.md` (no checkpoint of it is decided by this slice), the other slices'
review records. Absent files: none.

Acceptance criterion in scope: `docs/COMPLIANCE-MATRIX.md` row **MCP-01** (a working MCP surface,
read tools carrying authorization and tenant isolation, exactly one write tool that only queues),
extended by decision 29's two read tools, plus `AGENTS.md` "Maker-checker and MCP" and the
surface's own stated rule in `lib/mcp/scope.ts`.

Planned checks, all executed once: `npm ci`, `npm run typecheck`, `npm test`,
`npm run check:mcp` against a local server on port **4310** (3800 belongs to the builder's slice),
`gitleaks` on the slice diff, static AF-03 and dash scans, and two read-only `EXPLAIN (ANALYZE,
BUFFERS)` runs on `corgi_test` to re-measure the numbers written into `my-activity.ts`.
`npm run check:money-guards` was deliberately **NOT** run: it belongs to the coordinator on an
ephemeral database.

Environment handling: this worktree had no `node_modules` and no `.env.local`. I ran `npm ci`
(96 packages, lockfile untouched) and copied the main checkout's `.env.local` in to run the
checks; no value from it was printed, echoed, logged or committed, both paths are gitignored, and
the file was deleted at the end of the review. The dev server printed one line naming a port and
no connection string. No secret value appears in this record.

## 2. Applicability

Feature: two read-only MCP tools on the existing per-user API key surface of a Track 1 policy
administration application, sandbox only. Actors: an agent or a person holding a key bound to one
user with role `broker`, `customer`, `staff_ops`, `staff_approver` (and, in principle, `agent`).
Data: policy money figures the application already computed and stored, the journal entries
behind them, the broker's commission and commission rate, and the application's own request log.
No provider is called by either tool and neither writes anything.

The requirements that bite are the trial's own, not a statute. There is no external authority on
whether a policyholder may see their broker's commission; the governing rule for this build is
the one the codebase states for itself in `lib/mcp/scope.ts` ("an API key sees exactly what its
user sees on the screens, never more") and repeats in the customer view's header comment ("WHAT
THE CUSTOMER DOES NOT SEE, deliberately: the journal, the ledger sums, the broker's commission").
The applicability analysis of rounds 1 and 2 carries over unchanged; no new source needed to be
checked.

**One premise I re-verified rather than inherited.** The whole fix rests on the claim that the
customer's own policy screen prints no explanation fold. Another session is rebuilding the
interface and `origin/main` has moved 87 files since this branch's base, `customer-view.tsx`
among them. I read that file at `origin/main`: the words `explain`, `journal` and `commission`
appear in it only inside the comment saying what the customer does not see. The premise holds at
the current head of `main`, not only at the branch's base.

Assumption, stated: as in round 2, "the screen this key's user reads" means the whole customer
view file. Nothing in the trial brief defines it.

## 3. Requirement matrix

| # | Requirement | Control and code location | Evidence | Verdict |
|---|---|---|---|---|
| R1 | Both new tools read only, and the write-tool count is still one | `effect: "read"` on both; `ToolEffect` declared per tool in `lib/mcp/tools/tool.ts` | `npm test`: "THE WRITE TOOL COUNT IS STILL ONE" and `NEVER_DELEGATED.length === 10`; diff carries no added write statement | PASS |
| R2 | A customer key cannot reach the explanation fold | `explanationVisibilityRefusal` in `lib/mcp/scope.ts`, applied in `explain-amount.ts` **before the policy lookup** | `check:mcp`: four calls (commission, tax, endorsement delta, a policy that does not exist) all refused with ONE identical sentence; `scope.test.ts` six tests | PASS, closes F-MCPTOOLS-01/02/03 of round 2 |
| R3 | The refusal teaches nothing | The sentence names the rule and `get_policy_as_of`, never a figure key or a policy number | `check:mcp` "1 distinct sentence(s)", none of the four caller strings inside it; unit test asserts three figure keys are absent | PASS |
| R4 | The rule fails closed | `isStaff(user) || user.role === "broker"`, everything else refused | `scope.test.ts` "the rule FAILS CLOSED" on the fifth role `agent` | PASS |
| R5 | Which policies are reachable is exactly `get_policy_as_of`'s rule | `policyVisibilityRefusal`, same arguments in both tools | `check:mcp`: a broker key refused another broker's policy with the byte-identical sentence | PASS |
| R6 | A broker key reads what the broker screen renders | `app/policies/[policyId]/page.tsx` shows the owning broker the same page as staff: the four `AmountExplained` folds, `ledgerSoFar`, and `JournalTable` unconditionally at line 949 | Read; `check:mcp` broker key gets the tax fold and the formula in integer cents | PASS |
| R7 | The advertised `enum` is enforced before any read | `argumentsSchemaRefusal` in `lib/mcp/tools/tool.ts`, called by the transport before `tool.run` | Two unit tests; `check:mcp` proves an unknown key on a policy that does not exist gives the enum sentence and **not** the policy one | PASS, closes F-MCPTOOLS-07 of round 1 |
| R8 | `tools/list` cannot publish a false hint | `{...tool.annotations, readOnlyHint, destructiveHint, openWorldHint}` in `toolsListResult` | Read; `check:mcp` "EVERY TOOL SAYS WHETHER IT READS ONLY" lists exactly the five read tools | PASS, closes F-MCPTOOLS-04 |
| R9 | `list_my_activity` returns this user's rows and no other's | `where actor_user_id = ${context.user.id}` plus the route filter | `check:mcp`: two labelled `x-request-id` traces, each present in its own key's answer and absent from the other's | PASS |
| R10 | `list_my_activity` returns no payload and no free text | `activity_log` has no payload column (0021); `message` is not selected | `check:mcp`: rows carry exactly `correlationId,durationMs,outcome,recordedAt,rule,tool` | PASS |
| R11 | The boundedness claim is measured, not asserted | The comment in `my-activity.ts` says the answer is bounded and the work is not, with plans and buffer counts | **Re-measured independently**, see section 5: same plan, same conclusion | PASS, closes F-MCPTOOLS-05 of round 1 |
| R12 | AF-03: no money row updated or deleted, no column redefined, no applied migration edited | No `.sql` file in the diff; `lib/policy/read.ts` only adds an optional parameter with a default | `git diff --name-status`; grep for added `update ... set` / `delete from` / `truncate` / `insert into` / `alter` / `drop`: zero | PASS (static) |
| R13 | AF-05: no secret printed or committed | `dev-on-test-database.ts` uses `process.loadEnvFile` and hands the value to the child through `env` | `gitleaks` on the 108 KB diff: no leaks found; the server log of my own run contains no connection string | PASS |
| R14 | AF-02: nothing simulated presented as live | No provider call added; the README's MCP Inspector paragraph stays a dated past statement | Read | PASS |
| R15 | AF-06: the code can be followed with a short reading path | `explain-amount.ts` (204 lines) then `explain-figure.ts` (431) then `lib/money/explain.ts`; the rule is one exported four-line function | Readable; two comments still claim slightly more than the code does (F-MCPTOOLS-09, F-MCPTOOLS-10) | PASS with findings |
| R16 | AF-01: the two tools exercised on the deployed application | Not part of this slice | Never run for either tool | NOT RUN, F-MCPTOOLS-08 of round 1 stays open for the coordinator |

## 4. Findings

### 4.1 Round 1 findings, status at ce42a3c

| ID (round 1) | Sev | Status at this SHA | The line that closes it, or why it is still open |
|---|---|---|---|
| F-MCPTOOLS-01 | MED | **CLOSED** | `lib/mcp/scope.ts` `explanationVisibilityRefusal`, applied at `explain-amount.ts` before the policy row is read. A customer key reads no figure at all, so the eleven keys the finding named are unreachable. |
| F-MCPTOOLS-02 | LOW | **OPEN** | `explain-figure.ts` lines 136 to 140 are unchanged. For the seven cancellation keys `amountCents` is still `explanationResultLine(explanation)?.cents`, i.e. the very line it is compared against (line 383); for the four ledger sums both sides are the same `accountSumCents` walk (line 297 against `explainAccountSum`); for `policy_fee` both sides are `terms.feeCents`. The comment still reads "THE CHECK THAT MAKES THE ANSWER WORTH TRUSTING, asked here for every figure and never assumed". No round was asked to fix it and no round did. See F-MCPTOOLS-09. |
| F-MCPTOOLS-03 | LOW | **OPEN** | The `check:mcp` fixture (`createPaidPolicy`) still creates a bound, paid policy with no endorsement and no cancellation, and `explain-figure.ts` still has no unit test. Ten of the fifteen keys are returned by no automated run. Confirmed in my own run: `cancellation_total_refund` answered "this policy has not been cancelled" and `endorsement_delta` answered "this policy carries no endorsement". |
| F-MCPTOOLS-04 | LOW | **CLOSED** | `lib/mcp/jsonrpc.ts`: `annotations: { ...(tool.annotations ?? {}), readOnlyHint, destructiveHint, openWorldHint }`. The derived hints now win. |
| F-MCPTOOLS-05 | LOW | **CLOSED** by the "reword and measure" option the finding allowed. The comment now separates the bounded answer from the unbounded work and carries the plans. I re-measured both, independently, and they reproduce (section 5). The index is deliberately not added; the reason (parallel migration numbering) is written down and is honest. |
| F-MCPTOOLS-06 | LOW | **PARTLY FIXED** | The payload half is now exact: the tool says one sanitised sentence per call is recorded in `message` and that this tool does not read that column. The other half survives: `whatThisMeans` still opens with "no amount, no argument and no request or response body is **recorded**", and `activity_log.message` does record amounts. See F-MCPTOOLS-10. |
| F-MCPTOOLS-07 | LOW | **CLOSED** | The `enum` is enforced in `argumentsSchemaRefusal` before `tool.run`, with two unit tests and a `check:mcp` assertion that proves no read happened (the same unknown key on a nonexistent policy gives the enum sentence, not the policy sentence). |
| F-MCPTOOLS-08 | LOW | **OPEN**, coordinator's | The README now describes seven tools, but `docs/COMPLIANCE-MATRIX.md` rows MCP-01 and BLD-09 still cite a five-tool surface, and neither new tool has ever been called on the deployed application. `docs/` is not this slice's to edit. |

### 4.2 Round 2 findings, status at ce42a3c

| ID (round 2) | Sev | Status at this SHA | Evidence |
|---|---|---|---|
| F-MCPTOOLS-01 | HIGH | **CLOSED** | The per-figure allowlist `FIGURE_KEYS_A_CUSTOMER_KEY_READS` and `figureVisibilityRefusal` are deleted from the branch. The replacement is a role refusal, so there is no "key a caller may name" to gate any more. |
| F-MCPTOOLS-02 | HIGH | **CLOSED** | A customer key naming `endorsement_delta` is refused before `endorsementFigure` runs, so `endorsementFormulaLines` and its `commission` line (and the 1500 bps rate inside the formula string) are unreachable. Asserted over HTTP in `check:mcp` on the exact key that leaked, and in `scope.test.ts`. The refusal sentence, the tool description and the README now all say the same thing as the code, which is what the finding asked for. |
| F-MCPTOOLS-03 | MED | **CLOSED** | Same mechanism: `premium_tax` and `policy_fee` are refused to a customer key, so `evidenceFromJournal` never runs for one and no `provenBy` entry, account name, entry type or cancellation figure comes back. |
| F-MCPTOOLS-04 | LOW | **CLOSED** | Same line as round 1's F-MCPTOOLS-04. |
| F-MCPTOOLS-05 | LOW | **CLOSED** | `explanationVisibilityRefusal` and `NO_EXPLANATION_FOR_THIS_KEY` are exported and covered by six tests in `lib/mcp/scope.test.ts`: a customer refused, the refusal naming no figure key, a broker allowed on its own policy and refused on another's, both staff roles allowed, the fifth role `agent` refused (fail closed), and a broker user with no broker attached passing the role gate and stopped by the policy gate. The rule is now one line, so the enumeration is genuinely exhaustive rather than a sample. |
| F-MCPTOOLS-06 | INFO | **CLOSED** | `lib/policy/explain-figure.ts` line 29 and `lib/mcp/never-delegated.test.ts` now say "slice B13-16 (decision 29)". `grep -rn B14 lib scripts README.md` returns nothing. |

### 4.3 New findings, numbered on from the last id used (F-MCPTOOLS-08)

### F-MCPTOOLS-09, LOW: the check assertion written to prove the other side of the visibility rule cannot exercise it on this fixture, and passed through its escape branch

**Location:** `scripts/check-mcp.ts`, the assertion "A BROKER KEY STILL READS ITS OWN POLICY'S
EXPLANATION LINES: the same fold its own screen renders"; the fixture `createPaidPolicy` at the
end of the same file.

**Trigger:** the assertion is a disjunction. It passes if the answer carries formula lines, **or**
if the answer is the refusal `/carries no endorsement/`. The fixture policy is bound and paid and
carries no endorsement, so the second branch is the one that fires, always.

**Measured, in my own run:**

```
PASS  A BROKER KEY STILL READS ITS OWN POLICY'S EXPLANATION LINES: the same fold its own screen renders
      (this policy carries no endorsement, so it has no prorated delta to explain)
```

**Consequence:** the assertion's stated purpose is to prove that what a customer key is now
refused is exactly what a broker key still receives, "commission line included", on the very
figure that leaked in round 2. On this fixture it proves nothing of the sort: it observes that a
policy with no endorsement has no endorsement. It cannot fail for the reason it was written. The
underlying behaviour is fine (I read the code path and the broker's own screen renders the same
fold), and the tax and ledger assertions above it do prove a broker key gets lines, so this is a
weak proof rather than a wrong one. It is the same shape of gap that let round 2's HIGH survive
round 1: an assertion whose fixture cannot reach the branch it is about. This finding merges with
F-MCPTOOLS-03 of round 1.

**Required correction:** endorse (and cancel) one fixture policy in `check:mcp` and assert the
endorsement fold's `commission` line for a broker key and its absence for a customer key, or add
a unit test over `explain-figure.ts` with a stubbed handle covering the seven cancellation keys
and the endorsement delta. Until then, drop the escape branch or rename the assertion to what it
actually checks.

### F-MCPTOOLS-10, LOW: `list_my_activity` still tells its caller that no amount is recorded, and an amount is recorded

**Location:** `lib/mcp/tools/my-activity.ts`, the `whatThisMeans` sentence:
"This is the request log, not the ledger: no amount, no argument and no request or response body
is **recorded**. One sanitised sentence per call IS recorded, in a column this tool does not read
back."

**Trigger:** `app/api/mcp/route.ts` line 121 sets `activity.message = handled.log.detail`, which
is the refusal sentence the caller was given. `lib/claims/limits.ts` `claimPaymentRefusal`
returns sentences such as `this payment of <n> cents is more than the <m> cents left in the
reserve`. So a refused `request_claim_payment` writes two integer-cent amounts into
`activity_log.message`, a column that can never be updated, deleted or truncated.

**Consequence:** the two sentences in the same paragraph contradict each other, and the first one
is the one a reader trusts. This is exactly round 1's F-MCPTOOLS-06, half fixed: the finding asked
for "returned" instead of "recorded", and the fix added a true second sentence while leaving the
false first one. It leaks nothing (the tool genuinely does not select `message`); it is an AF-06
problem, because the sentence is what a reader would rely on to decide what the log holds.

**Required correction:** one word. "no amount, no argument and no request or response body is
**returned**", and keep the sentence that follows.

### F-MCPTOOLS-11, INFO: `rolesThatMayExplain` is a second, hand-written statement of the visibility rule, published to every client and tied to nothing

**Location:** `lib/mcp/tools/explain-amount.ts` line 68,
`rolesThatMayExplain: ["broker", "staff_ops", "staff_approver"]`.

**Trigger:** the array is a literal. `explanationVisibilityRefusal` is the rule. Nothing compares
them: `grep -rn rolesThatMayExplain lib scripts app README.md` returns that one line, so no test
and no check assertion reads it. It is correct today (`isStaff` is exactly `staff_ops` and
`staff_approver`), and it is published in `tools/list` to every client as an authorization
statement.

**Consequence:** if the rule ever changes, `tools/list` keeps advertising the old one, silently.
Two statements about who may see what, with nothing keeping them equal, is the precise mechanism
that produced round 2's HIGH (the refusal sentence, the description and the README all said the
gate was closed while the code left it open). The severity is INFO rather than LOW because the
annotation cannot itself grant access.

**Required correction:** derive it, or assert it. Either build the array from the roles the rule
accepts, or add one line to `lib/mcp/scope.test.ts` asserting that
`explanationVisibilityRefusal` returns null for exactly the roles the annotation names.

### F-MCPTOOLS-12, LOW: the "no caller string reaches the call log" assertion still reads the last N rows of a shared table, which is the contention the assertion beside it was just fixed for

**Location:** `scripts/check-mcp.ts`, `const rowsThisRunWrote = await lastCallRows(postsSent)`
and the assertion "NO CALLER STRING REACHES THE APPEND-ONLY CALL LOG".

**Trigger:** the neighbouring assertion was rewritten in this very round, correctly, to count rows
**per key created by this run** rather than globally, with the comment "corgi_test is shared, and
a global count of mcp_calls also counts the rows another agent's check appended while this one was
running". `lastCallRows(postsSent)` was left global: it takes the most recent `postsSent` rows of
`mcp_calls` whoever wrote them. If another agent's run appends rows while this one is in flight,
this run's own earliest rows fall out of the window and are never inspected, while that agent's
rows are inspected instead.

**Consequence:** a negative assertion (no row quotes a caller string) that can silently stop
looking at the rows it is about. It passed honestly in my run (50 rows read back for 50 POSTs, the
table having grown by exactly 50), so nothing is wrong today; the assertion is simply not robust
to the condition its neighbour was hardened against two lines earlier.

**Required correction:** filter `lastCallRows` by `api_key_id = any(...)` over `thisRunsKeys`, the
same set the fixed assertion already builds.

### F-MCPTOOLS-13, INFO: provenance and freshness of the reviewed revision

Three facts a reader of this record needs, none of which is a defect in the code.

1. **The branch is not the assigned name.** The assignment named
   `worktree-wf_46bb3e09-77f-2-fix-r3`; the work is on
   `worktree-wf_4bff1824-553-2-mcp-fix-r3`. The builder disclosed that the assigned branch already
   existed and was checked out in another live worktree, and that a second agent appears to have
   been given the same task. Two branches may now claim round 3. **The coordinator must pick one
   before merging; this record certifies `ce42a3c` and nothing else.**
2. **The builder disclosed that another process was committing inside its worktree**, that four of
   the five commits carry that process's authorship, and that it corrected two fabricated
   measurement claims in `my-activity.ts`. I did not take the commit messages on trust: I read
   every added line of the diff, and I re-ran the two measurements those claims rest on. Both
   reproduce (section 5). I found no fabricated claim left in the branch.
3. **The reviewed SHA is behind `origin/main`.** `main` has moved 87 files since this branch's
   base (the interface rework, decisions 33 to 41). `git merge-tree --write-tree origin/main
   ce42a3c` succeeds, and the two changed-file sets are **disjoint**: no file this slice touches
   was touched by `main`. So the merge is textually clean. It has not been typechecked or tested
   in its merged form by anybody, and that remains the coordinator's step, not this slice's.

## 5. Checks executed

All run once, in this worktree, at the reviewed SHA. The shared disposable database `corgi_test`
was used through the URLs in the copied `.env.local`; nothing was applied to any other database.

| Check | Command | Result |
|---|---|---|
| Install | `npm ci` | 96 packages, 0 vulnerabilities, lockfile untouched |
| Types | `npm run typecheck` | **PASS**, no output |
| Unit tests | `npm test` | **PASS**: 495 tests, 494 pass, 0 fail, 1 skipped (pre-existing), 2 suites, 486 subtests, 2.69 s. Matches the builder's figure exactly. |
| MCP surface over HTTP | `PORT=4310 npm run dev:test-db`, then `MCP_BASE_URL=http://127.0.0.1:4310 npm run check:mcp` | **ALL CHECKS PASSED**, 0 FAIL, 77 reported assertions. 50 POSTs sent, 48 of them with this run's six keys, 48 rows appended for those keys. |
| Secret scan | `gitleaks detect --no-git --source <the slice diff> --redact` | **no leaks found**, 108.11 KB scanned |
| Credential-shape scan | added lines matched against `postgres://`, `sk_`, `rk_`, `whsec_`, `DEMO_PASSWORD=`, `password="` | **zero**; the only `process.env` reads added are `DATABASE_URL_TEST_APP` and `PORT`, both by name |
| AF-03 static scan | `git diff --name-status`, plus added lines matched against `update ... set`, `delete from`, `truncate`, `insert into`, `alter table`, `drop` | **zero**; **no `.sql` file in the diff**, no migration added or edited |
| Dash scan | the whole slice diff matched against U+2014 and U+2013 | **zero** |
| Merge safety | `git merge-tree --write-tree origin/main ce42a3c`; intersection of the two changed-file lists | clean tree, **empty intersection** |
| Query plan, re-measured | read-only `explain (analyze, buffers)` of the exact `list_my_activity` query on `corgi_test` | `Limit -> Sort (recorded_at DESC, id DESC) -> Seq Scan`, 1255 rows in the table, 21 for the busiest MCP actor, Rows Removed by Filter 1234, **shared hit=57**, **0.267 ms**. The comment's plan and order of magnitude reproduce. |
| The "the index would not help" claim, re-measured | the same query with `enable_seqscan = off` | `Incremental Sort -> Index Scan using activity_log_by_time`, **shared hit=488**, **1.139 ms**, still removing 1234 rows of 1255 by filter. Slower, exactly as the comment says. `pg_indexes` confirms the four indexes and no index on `actor_user_id`. |
| Customer-screen premise | `customer-view.tsx` **at `origin/main`** grepped for `explain`, `journal`, `commission` | Only inside the comment listing what the customer does not see. The premise holds on the rebuilt interface. |
| Broker-screen premise | `app/policies/[policyId]/page.tsx` lines 99 to 107 and 949 | The owning broker gets the staff page: the `AmountExplained` folds, `ledgerSoFar` and `JournalTable` are not staff-gated. |
| Money guards | `npm run check:money-guards` | **NOT RUN**, reserved for the coordinator on an ephemeral database |

Server: started with `PORT=4310 npm run dev:test-db`, health `{"ok":true,"database":"ok"}`,
stopped at the end of the review, port 4310 verified free afterwards. Its log contains no
connection string. Two throwaway read-only scripts were written into the gitignored `.next/`
directory and deleted; they only ran `select` and `explain`.

Shared-database notes, reported and not looped on: `corgi_test` carried 1255 `activity_log` rows,
1648 open reconciliation breaks, 562 refused and 97 unauthorised `mcp_calls` at review time, up
from the 1582 breaks round 2 saw an hour earlier. That is accumulation from every agent using the
database, not something this slice writes. No deadlock, no fixture collision and no flake in the
single run; nothing was repeated. `run_reconciliation` took 15.5 s against the Stripe sandbox, as
it does on every run of this check, and planted its usual $42.42 probe PaymentIntent.

## 6. What was not verified

- **`npm run check:money-guards`.** Not run, by assignment. The AF-03 evidence here is static (no
  SQL write and no migration in the diff), not a fresh proof of the database guards.
- **The deployed application.** Neither tool has ever been called on the deployed URL. AF-01 and
  AF-02 evidence for `explain_amount` and `list_my_activity` does not exist, and
  `docs/COMPLIANCE-MATRIX.md` still describes a five-tool surface (F-MCPTOOLS-08 of round 1,
  coordinator's).
- **Ten of the fifteen figure keys.** `collected_at_stripe`, `refunded_from_stripe`,
  `endorsement_delta` and the seven cancellation figures were returned by no run I made and by no
  automated run in the branch. F-MCPTOOLS-03 of round 1 and F-MCPTOOLS-09.
- **The merged result.** I reviewed `ce42a3c`, not `ce42a3c` merged into the current
  `origin/main`. The merge is textually clean and the file sets are disjoint, but no typecheck or
  test has run on the merged tree.
- **The other candidate branch.** I did not read `worktree-wf_46bb3e09-77f-2-fix-r3`. If a second
  agent produced a different round 3, this record says nothing about it.
- **`list_my_activity` under a user holding two keys.** The limit is stated in the description,
  in the module header and in the README; I read all three and did not mint a second key.
- **Concurrency, load and rate limiting** on the endpoint: out of scope for two read tools, and
  already a disclosed build limitation.
- **The arithmetic of the fifteen figures.** That is `docs/reviews/b12-explain.md`'s scope and is
  unchanged here; I checked that the tool composes the same functions the page composes, on the
  current `origin/main` page as well as on the branch's.

## 7. Verdict

**PASS** at `ce42a3c331f8dc2006ead1f2ee6887c181047e9d`, for the scope of this slice.

The two HIGH and the one MEDIUM of round 2 are closed, and closed by the shape the review asked
for: not another filter over the same fold, but a rule that never reaches the fold. A customer key
is refused `explain_amount` outright, before the policy row is read, with one sentence that is
identical for every figure and every policy number and that names no figure key. The rule is four
lines in `lib/mcp/scope.ts`, exported, and walked exhaustively by six unit tests including the
fail-closed case for a role that does not exist on this endpoint yet. The per-figure allowlist
that produced both leaks is deleted rather than patched. The three round-1 findings the assignment
carried forward are closed too: the enum is enforced by the transport before any read and proved
so by an assertion that could not pass if a read had happened, the annotation spread can no longer
publish a false hint, and the boundedness comment now states what is bounded and what is not, with
plans I re-measured myself rather than took on trust.

No money row is written, no column is redefined, no migration is added or edited, no `.sql` file
is in the diff, no secret is printed or committed, nothing simulated is presented as live, the
never-delegated list is still ten and the write-tool count is still one, and every check that
could be run passed.

Four LOW and two INFO findings stay open. Three of them are carried from round 1 and were never
in any round's assignment (F-MCPTOOLS-02, F-MCPTOOLS-03, F-MCPTOOLS-08 of round 1); the new ones
are a check assertion that cannot fail for its stated reason, a sentence that still overstates by
one word, a duplicated authorization statement, and a shared-database weakness in a negative
assertion. None of them is a leak, an authorization gap or a money-path defect, and none blocks
completion of the slice.

Residual limitations for the coordinator, not for the builder:

- **Two branches claim round 3.** Pick one before merging. This record certifies `ce42a3c`.
- **A product decision belongs to Yoann, not to a reviewer.** Refusing a customer key the whole
  tool is a deliberate narrowing of what customer keys could do at `5976e4f`. Round 2 recommended
  it and the code, the description, the refusal sentence and the README now agree on it, which is
  what a reviewer can check. Whether Corgi wants a policyholder to be able to explain their own
  premium tax through an agent is his call, and `docs/DECISIONS.md` rule 29 does not answer it.
- **AF-01 and AF-02 evidence** for both new tools, and the `COMPLIANCE-MATRIX` rows that still say
  five tools.

**Walkthrough status: NOT REVIEWED WITH YOANN.** No part of this slice has been explained to him
and confirmed by him in his own words. Nothing in this record establishes AF-06; a reviewer can
assess explainability and cannot certify his understanding on his behalf.

## 8. Register lines

For `docs/reviews/FINDINGS.md`, owned by the coordinator. Round 1 and round 2 reused the same id
range, so each carried line names its round.

| ID | Sev | Finding (one line) | Fix | Status |
|---|---|---|---|---|
| F-MCPTOOLS-01 (r1, r2) | HIGH | explain_amount let a customer key read the broker's commission, the ledger sums, the cancellation figures and journal entry ids | Role refusal in lib/mcp/scope.ts applied before the policy lookup; per-figure allowlist deleted | **CLOSED ce42a3c** |
| F-MCPTOOLS-02 (r2) | HIGH | endorsement_delta handed a customer key the commission line and the 1500 bps rate | Same refusal; asserted over HTTP on that exact key | **CLOSED ce42a3c** |
| F-MCPTOOLS-03 (r2) | MED | premium_tax and policy_fee handed a customer key journal entry ids and the cancellation's refunded tax | Same refusal | **CLOSED ce42a3c** |
| F-MCPTOOLS-04 (r1, r2) | LOW | tools/list spread a tool's own annotations after the derived hints | Annotations spread first, hints last | **CLOSED ce42a3c** |
| F-MCPTOOLS-05 (r2) | LOW | Nothing enumerated the visibility rule against the roles | Rule exported, six tests in lib/mcp/scope.test.ts including fail-closed | **CLOSED ce42a3c** |
| F-MCPTOOLS-05 (r1) | LOW | list_my_activity bounded its answer and not its work, and the comment claimed otherwise | Comment rewritten with measured plans; index deliberately deferred and the reason written down; re-measured by the reviewer | **CLOSED ce42a3c** |
| F-MCPTOOLS-06 (r2) | INFO | The code called this "slice B14" | Now "slice B13-16, decision 29" in both files | **CLOSED ce42a3c** |
| F-MCPTOOLS-07 (r1) | LOW | The advertised enum was enforced by no validator | Enforced in argumentsSchemaRefusal before the tool runs, two unit tests, one check assertion proving no read happened | **CLOSED ce42a3c** |
| F-MCPTOOLS-02 (r1) | LOW | explanationEndsOnTheFigure compares a number with itself for 12 of the 15 keys; the comment calls it the check made for every figure | Take the cancellation amount from the stored event figure, or say which keys the check can falsify | **OPEN** at ce42a3c |
| F-MCPTOOLS-03 (r1) | LOW | Ten of the fifteen figure keys are exercised by no test and no check; explain-figure.ts has no unit test | Endorse and cancel a fixture policy in check:mcp, or unit-test the module | **OPEN** at ce42a3c |
| F-MCPTOOLS-08 (r1) | LOW | COMPLIANCE-MATRIX MCP-01 and BLD-09 still describe a five-tool surface; neither new tool has deployed-app evidence | Coordinator updates the records; exercise both tools on the deployed URL before the AF-01 claim | **OPEN** at ce42a3c |
| F-MCPTOOLS-09 | LOW | The check assertion "a broker key still reads its own policy's explanation lines" passes through its "carries no endorsement" escape branch, so it cannot fail for the reason it was written | Endorse a fixture policy and assert the commission line for a broker and its absence for a customer, or drop the escape branch | OPEN |
| F-MCPTOOLS-10 | LOW | list_my_activity still says "no amount is recorded"; activity_log.message records refusal sentences carrying integer-cent amounts (lib/claims/limits.ts) | One word: "returned" instead of "recorded" | OPEN |
| F-MCPTOOLS-11 | INFO | rolesThatMayExplain is a hand-written second statement of the visibility rule, published in tools/list and compared to the rule by nothing | Derive it from the rule, or assert the two agree in lib/mcp/scope.test.ts | OPEN |
| F-MCPTOOLS-12 | LOW | The "no caller string reaches the call log" assertion still reads the last N rows of the shared mcp_calls globally, the contention the assertion beside it was just fixed for | Filter lastCallRows by this run's key ids, as the fixed assertion already does | OPEN |
| F-MCPTOOLS-13 | INFO | Two branches claim round 3, four of five commits were authored by another process, and the reviewed SHA is behind origin/main (clean merge, disjoint file sets, merged tree never built) | Coordinator picks the branch and runs typecheck and tests on the merged tree | OPEN |
