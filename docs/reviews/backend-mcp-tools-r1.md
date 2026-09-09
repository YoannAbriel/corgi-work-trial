# Independent review, slice mcp-tools (round 1): explain_amount and list_my_activity

Reviewer: independent reviewer sub-agent, working in the worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/wf_46bb3e09-77f-6`, detached at the
reviewed SHA. Written at 2026-09-09T13:32:11Z.

Reviewed revision: **6a41c2a96ba35b3bc840c63fab71647275ca89e1** (branch
`worktree-wf_46bb3e09-77f-2`, five commits `5837dbd`, `fe0dd7c`, `caece34`, `d45a7f6`,
`6a41c2a`), read as `git diff main...6a41c2a` against `main` at `0ee1b6e`. The working tree was
clean at review time apart from this file. Nothing on `main` was touched, no code was modified,
no migration was applied.

This is a scoped engineering assessment of one slice. It is not a legal certification, and it is
not a statement that the six delivery gates pass for the whole submission.

## 1. Startup receipt

Read in full, in this order, before looking at any code of the slice: `CLAUDE.md`,
`AUTOMATIC-FAILS.md`, `READABLE-CODE.md`, `AGENTS.md`, `REVIEWER.md`.

Read for this scope: `docs/PLAN.md` (row B14 and the header), `docs/COMPLIANCE-MATRIX.md` (rows
MCP-01 and BLD-09), `docs/reviews/FINDINGS.md` (register head and tail, for the severity and
status vocabulary), `docs/reviews/b11-mcp.md` (startup receipt and format), `README.md` (the MCP
surface section, before and after).

Code read in full at the reviewed SHA: `lib/mcp/tools/explain-amount.ts`,
`lib/mcp/tools/my-activity.ts`, `lib/policy/explain-figure.ts`, `lib/mcp/tools/tool.ts`,
`lib/mcp/tools/index.ts`, `lib/mcp/jsonrpc.ts` (transport, `tools/list`, `tools/call` dispatch),
`lib/mcp/scope.ts`, `lib/mcp/never-delegated.test.ts`, `app/api/mcp/route.ts`,
`scripts/dev-on-test-database.ts`, `scripts/check-mcp.ts` (the whole diff plus the surrounding
assertions), `db/migrations/0021_activity_log.sql`, `lib/mcp/tools/policy-as-of.ts`.
Read in the parts that matter here: `lib/money/explain.ts` (the folds the new module composes),
`lib/policy/read.ts`, `lib/policy/terms-in-force.ts`, `lib/policy/correction-read.ts` and
`lib/policy/endorsement-read.ts` (the signatures that gained a database handle),
`app/policies/[policyId]/page.tsx` (access control, the terms panel, the four ledger folds, the
seven cancellation folds), `app/policies/[policyId]/customer-view.tsx` (what a customer is shown),
`app/ops/mcp-keys/page.tsx` and `scripts/create-mcp-key.ts` (who can hold a key).

Not read, and why: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`,
`GAP-REVIEW.md` (advisory catalogues; no retained control was identified for this scope beyond
what `AGENTS.md` already requires for MCP read tools), `WORKFLOW-48H.md` (read previously in this
role; no checkpoint of it is decided by this slice), the other slice handoffs. Absent files:
none.

Acceptance criterion reviewed: `docs/COMPLIANCE-MATRIX.md` row **MCP-01** (working MCP surface,
read tools with authorization and tenant isolation, one write tool that only queues), extended by
two read tools. Planned checks, all executed once: `npm run typecheck`, `npm test`,
`npm run check:mcp` against a local server started from this worktree. `npm run check:money-guards`
was deliberately NOT run (reserved for the coordinator).

Nothing was pushed to a shared branch, nothing was deployed, no shared planning file was edited.
No secret value appears in this record.

## 2. Applicability

Feature: two read-only MCP tools on the existing per-user-API-key surface of a Track 1 policy
administration application. Actors: an agent or a person holding an MCP key bound to one user
(role `broker`, `customer`, `staff_ops` or `staff_approver`). Data: policy money figures already
computed and stored by the application, plus the application's own request log. No provider is
called by either tool; no money row is written or read for mutation.

Applicable requirements for this scope, confirmed rather than assumed:

- `AGENTS.md`, "Maker-checker and MCP": at least three read tools and one write tool that only
  queues; **"Apply authorization and tenant isolation to read tools too."**
- `AGENTS.md`, "Operations and security": structured redacted logs, no full bodies, no credentials
  in output.
- `AUTOMATIC-FAILS.md` AF-03 (no UPDATE or DELETE on money rows), AF-04 (sandbox only), AF-05 (no
  secret committed), AF-06 (explainable code).
- `lib/mcp/scope.ts`, the surface's own stated rule: **"an API key sees exactly what its user sees
  on the screens, never more."** This is an engineering safeguard of this build, not an external
  legal rule, and it is the rule finding F-MCPTOOLS-01 is measured against.

No external legal regime is newly engaged by this slice: both tools read figures the application
already shows to the same principals through the browser, so the applicability analysis of
`docs/reviews/b11-mcp.md` (MCP-01) carries over unchanged. No new source needed to be checked.
Assumption stated: the trial's own decision records define which figures each role may see; there
is no external authority on broker commission disclosure to a covered customer.

## 3. Requirement matrix

| Requirement | Control and code location | Evidence | Verdict |
|---|---|---|---|
| MCP-01: at least three read tools | Five read tools in `lib/mcp/tools/index.ts` | `check:mcp` "tools/list returns the seven tools of this build" PASS; `npm test` name-list assertion | PASS |
| MCP-01: exactly one write tool, queue only | `effect: "queues_for_a_human"` on `request_claim_payment` alone; `lib/mcp/never-delegated.test.ts` "THE WRITE TOOL COUNT IS STILL ONE" | `npm test` 476 pass; `check:mcp` "NO MONEY MOVED" and "approving still moves no money" PASS | PASS |
| MCP-01: never-delegated list unchanged and published | `NEVER_DELEGATED.length === 10` asserted; `tools/list` carries it under `policy` | `npm test`; `check:mcp` "THE NEVER-DELEGATED LIST IS PART OF THE SURFACE" PASS | PASS |
| Read tools honour tenant isolation (broker to broker) | `policyVisibilityRefusal` called before anything about the policy is read (`explain-amount.ts` lines 80 to 91) | `check:mcp` "A BROKER KEY CANNOT EXPLAIN ANOTHER BROKER'S POLICY", identical sentence to `get_policy_as_of` | PASS |
| Read tools honour the surface's visibility rule (role to role) | Same gate, but no per-figure gate afterwards | Executed probe: a `customer` key reads `commission_payable` and a journal entry id | **FAIL, F-MCPTOOLS-01** |
| `list_my_activity` never returns another principal's rows | `where actor_user_id = ${context.user.id}` and the MCP route filter (`my-activity.ts` lines 52 to 71) | `check:mcp` two labelled correlation ids, each key sees its own and not the other's | PASS for users; the key-level limit is disclosed in the description, the module header and the README |
| `list_my_activity` leaks no payload | `activity_log` has no payload column (migration 0021); `message` is not selected | `check:mcp` "a row carries six fields and none of them is one" PASS; migration read | PASS |
| Answer is not a second calculation | `lib/policy/explain-figure.ts` composes `lib/money/explain.ts` and the same readers the page composes | `check:mcp` tax 2820 with `floor(120000 x 235 / 10000)`, fee 2500, total 125320, commission 18000, unearned 120000, all equal to the page-side computation | PASS with the reservation in F-MCPTOOLS-02 and F-MCPTOOLS-03 |
| AF-03: no money row updated or deleted | Diff contains no `update`, `delete`, `truncate`, `insert`, `alter` or `drop` on any table | `git diff main...HEAD` grep, zero hits; no migration added | PASS |
| AF-03: no column redefined, no applied migration edited | No file under `db/migrations` is in the diff | `git diff --stat` | PASS |
| AF-04: sandbox only | Both tools read the local database only; the check refuses to run without `DATABASE_URL_TEST`; `dev-on-test-database.ts` exits 1 without `DATABASE_URL_TEST_APP` | Script read; check run against `corgi_test` | PASS |
| AF-05: no secret committed or printed | No credential-shaped string added; `dev-on-test-database.ts` passes the URL through `env` and prints none | Diff grep; server log inspected, zero occurrences of a connection string | PASS |
| AF-02: no simulation presented as live | Neither tool touches a provider; the README keeps its LOCAL SIMULATOR wording | README diff read | PASS |
| AF-01: accessible deployed URL exercising the new tools | Not part of this slice | Not run: the two new tools have never been called on the deployed application | NOT RUN, see F-MCPTOOLS-08 |
| AF-06: explainable line by line | Short tools, one branch per figure family, comments give business reasons | Reading path is `explain-amount.ts` then `explain-figure.ts` then `lib/money/explain.ts`; 431 lines in the new module, of which about half are comments | PASS, with F-MCPTOOLS-02 (a comment that overstates) |

## 4. Findings

### F-MCPTOOLS-01, MEDIUM, confirmed by execution: a customer key reads ledger figures the customer's own screen deliberately withholds

**Code location:** `lib/mcp/tools/explain-amount.ts`, the visibility gate at lines 80 to 91; the
closed list in `lib/policy/explain-figure.ts` lines 56 to 89; the rule it is measured against is
`lib/mcp/scope.ts` lines 6 to 9 and the comment in
`app/policies/[policyId]/customer-view.tsx` lines 32 to 33.

**Trigger.** `explain_amount` gates on `policyVisibilityRefusal` only, which returns null for a
`customer` user whose `customerId` matches the policy. After that gate, all fifteen figure keys
are available. The browser does not work that way: `app/policies/[policyId]/page.tsx` line 104
sends a customer to `CustomerPolicyView`, whose own header comment says what that reader is not
shown, in these words: "the journal, the ledger sums, the broker's commission, the claims, the
corrections". The customer view prints the annual premium, the tax, the fee, the total charge and
the endorsement schedule, and nothing else.

**Executed proof** (local server on port 4180 against `corgi_test`, a `human` key minted for the
check fixture's own customer user of policy CGP-04925):

```
tools/call explain_amount {"policy":"CGP-04925","figure":"commission_payable"}
-> "label": "Balance of this broker's commission payable on this policy"
   "amount": { "cents": 18000, "formatted": "$180.00" }
   "provenBy": [ { "journalEntryId": "f2799a50-...", "entryType": "commission_earned", ... } ]
```

**Consequence.** Eleven of the fifteen keys are outside what a customer principal is shown on the
screens: the four ledger sums (`collected_at_stripe`, `refunded_from_stripe`, `commission_payable`,
`unearned_premium_held`) and the seven cancellation figures, each of them also carrying journal
entry ids. `commission_payable` is the sharpest case: it is a third party's commercial figure, and
the product hides it from that reader on purpose. The tool's own header comment claims "Visibility
is exactly get_policy_as_of's", which is true of WHICH policies may be reached and false of WHAT
comes back: `get_policy_as_of` returns a fixed customer-safe field set, `explain_amount` returns
account balances and journal evidence. `AGENTS.md` requires authorization on read tools, and
`lib/mcp/scope.ts` states the rule as "never more" than the screens. A customer key is a reachable
configuration: `/ops/mcp-keys` lists every user whatever their role, `scripts/create-mcp-key.ts`
accepts any email, and `scripts/check-mcp.ts` itself mints one and asserts it works.

**Required correction.** Gate the figure keys by role inside the tool, next to the visibility gate:
the three terms figures and `endorsement_delta` for every principal that can see the policy, the
four ledger sums and the seven cancellation figures for the owning broker and staff only, refused
for a customer key with a sentence that names the rule and not the caller's value. Add a
`check:mcp` assertion with a customer key on `commission_payable` proving the refusal, beside the
existing customer-key assertions. If Yoann decides instead that a customer may see the cancellation
figures of their own policy, that is a decision to record in `docs/DECISIONS.md`, and
`commission_payable` still has to be refused.

### F-MCPTOOLS-02, LOW: `explanationEndsOnTheFigure` cannot be false for twelve of the fifteen keys, and the comment presents it as a check made for every figure

**Code location:** `lib/policy/explain-figure.ts` lines 136 to 141 (the check), line 383 (the
cancellation amount), line 297 (the ledger amount), line 222 (the fee).

**Trigger.** The check is `resultLine.cents === figure.amountCents`. For the seven cancellation
keys, `amountCents` is read out of the result line itself
(`explanationResultLine(explanation)?.cents ?? 0`), so the comparison is a number against itself.
For the four ledger sums, both sides are the same `accountSumCents` call on the same filtered
entries. For `policy_fee`, both sides are `terms.feeCents`. Only `premium_tax` (stored tax against
`stateTaxCents` recomputed) and `total_charge` (stored total against the sum of three lines) can
disagree.

**Consequence.** An agent reading `"explanationEndsOnTheFigure": true` is told an agreement was
verified when for twelve keys nothing was compared. The module comment at lines 136 to 138 calls it
"THE CHECK THAT MAKES THE ANSWER WORTH TRUSTING, asked here for every figure and never assumed",
which overstates. This does not make any figure wrong: the check proves the cancellation and ledger
amounts equal the page's for the keys it exercises. The screen inherits the same shape for
cancellation, so the tool did not weaken a control the page has.

**Required correction.** Either take the cancellation amount from the stored figure on the
cancellation event rather than from the fold's own line, so the comparison has two sources, or say
in the comment and in the answer which keys the check can actually falsify.

### F-MCPTOOLS-03, LOW: ten of the fifteen published figure keys are exercised by no test and no check

**Code location:** `lib/policy/explain-figure.ts` (431 lines, no unit test file);
`scripts/check-mcp.ts` section 3b.

**Trigger.** `check:mcp` calls `explain_amount` for `premium_tax`, `policy_fee`, `total_charge`,
`commission_payable` and `unearned_premium_held`, plus one refusal on `cancellation_total_refund`
for a policy that was never cancelled. `collected_at_stripe`, `refunded_from_stripe`,
`endorsement_delta` and the seven cancellation figures are never returned by any automated run.
`lib/policy/` has five test files and none of them covers this module.

**Consequence.** The tool description and the `tools/list` annotation publish fifteen keys as
supported; ten are unproven end to end. The risk is bounded because `lib/money/explain.ts` has its
own tests and the ledger and cancellation branches copy the page's wiring, but a wrong account id,
a wrong `figureKey` mapping or a wrong evidence account in the two tables of constants would not be
caught. The endorsement branch is the least covered and the one the builder disclosed as copied
wording.

**Required correction.** Extend the check's fixture to cancel one policy and endorse one, then
assert the seven cancellation figures and the endorsement delta against the same stored figures the
page prints, or add a unit test over `explain-figure.ts` with a stubbed database handle.

### F-MCPTOOLS-04, LOW: a tool's own annotations are spread after the derived hints, so a future tool could publish `readOnlyHint: true` while declaring a write effect

**Code location:** `lib/mcp/jsonrpc.ts`, the `annotations` object in `toolsListResult`.

**Trigger.** The object is built as `{ readOnlyHint: tool.effect === "read", destructiveHint:
false, openWorldHint: false, ...(tool.annotations ?? {}) }`. A later spread wins, so a tool
declaring `annotations: { readOnlyHint: true }` alongside `effect: "queues_for_a_human"` would be
published to every client as read only. The comment above it says the hints are "taken from what
the tool declares it changes rather than from its name". No tool does this today, and the
`check:mcp` assertion that `request_claim_payment` is absent from the read-only list reads the same
overridable field.

**Required correction.** Spread `tool.annotations` first and let the derived hints win, so a tool
can add fields and can never contradict its own declared effect.

### F-MCPTOOLS-05, LOW: `list_my_activity` bounds its answer, not its work, and no index supports its filter

**Code location:** `lib/mcp/tools/my-activity.ts` lines 52 to 71 and the comment at lines 29 to 33;
`db/migrations/0021_activity_log.sql`, the three indexes.

**Measured** on `corgi_test` at review time, with the query the tool sends:

```
Limit  -> Sort (Sort Key: recorded_at DESC, id DESC)
       -> Seq Scan on activity_log
          Filter: actor_kind = ANY (...) AND actor_user_id = ... AND (route = ... OR route ~~ ...)
activity_log rows: 504
indexes: activity_log_pkey, activity_log_by_time, activity_log_by_subject, activity_log_by_correlation
```

**Consequence.** The `limit 50` caps the answer, and the comment gives that bound as the protection
against "an unbounded read of an append-only table [that] grows with the life of the database". The
scan and the sort still grow with the table. At trial scale this is microseconds; it is recorded
because the comment claims the growth is handled and it is not.

**Required correction.** Either add an index on `(actor_user_id, recorded_at desc)` in a new
additive migration, or reword the comment to say the answer is bounded and the scan is not.

### F-MCPTOOLS-06, INFO: `whatThisMeans` says no amount is recorded, when it is the return shape that omits it

**Code location:** `lib/mcp/tools/my-activity.ts`, the closing sentence of the answer.

The sentence reads "no amount, no argument and no payload is recorded". `activity_log.message`
does record one sanitised sentence, and a refusal sentence can carry an amount (the claim payment
refusals do). The module header is precise about this ("`message` is not returned"); the sentence
an agent reads is not. Replace "recorded" with "returned".

### F-MCPTOOLS-07, INFO: `explain_amount` declares an `enum` the shared schema validator does not enforce

**Code location:** `lib/mcp/tools/tool.ts`, `argumentsSchemaRefusal`; the `enum` in
`explain-amount.ts`'s `inputSchema`.

`argumentsSchemaRefusal` checks undeclared properties, required fields and the three scalar types.
It ignores `enum`. Behaviour is correct because the tool checks the key itself with
`isPolicyFigureKey` and the refusal names the closed list without repeating the caller's value
(proved by `check:mcp`). What is now inaccurate is the comment in `lib/mcp/jsonrpc.ts`, "The schema
the tool advertises is enforced here, once, before the tool sees anything", which was true when no
tool advertised anything the validator did not read. Either enforce `enum` in the validator or
narrow the comment.

### F-MCPTOOLS-08, INFO: the records of the surface still describe five tools, and the two new ones have no deployed-application evidence

`docs/COMPLIANCE-MATRIX.md` row MCP-01 cites "check:mcp 58/58" and row BLD-09 cites a demo of "five
tools"; `README.md` keeps the same dated sentence about the 2026-09-08 MCP Inspector session. Those
are honest statements about a past run, and they are now beside a README that says seven. AF-01 and
AF-02 evidence for `explain_amount` and `list_my_activity` on the deployed application does not
exist yet. `docs/` is the coordinator's, so this is reported and not fixed.

## 5. Checks actually executed

All run once, in this worktree, at the reviewed SHA, after `npm ci` (96 packages).

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | **PASS**, no output |
| Unit tests | `npm test` | **PASS**, 477 tests, 476 pass, 0 fail, 1 skipped (pre-existing) |
| MCP surface over HTTP | `MCP_BASE_URL=http://127.0.0.1:4180 npm run check:mcp` | **PASS**, ALL CHECKS PASSED, 0 FAIL, 74 reported assertions, 44 POSTs |
| Money guards | `npm run check:money-guards` | **NOT RUN**, reserved for the coordinator |
| Mutation scan of the diff | `git diff main...HEAD` filtered on update, delete, truncate, insert, alter, drop | **PASS**, zero added lines |
| Secret scan of the diff | same diff filtered on connection strings, `sk_`, `rk_`, `whsec_`, password, `DEMO_PASSWORD` | **PASS**, variable names only, no value |
| Dash scan of the diff | added lines matched against the two dash characters | **PASS**, zero |
| Server output | the log of `npm run dev:test-db` | **PASS**, zero occurrences of a connection string |
| Query plan | `explain` of the `list_my_activity` query on `corgi_test` | Seq Scan plus Sort, see F-MCPTOOLS-05 |
| Scope probe | one `tools/call explain_amount` with a customer key | Confirms F-MCPTOOLS-01 |

Local server: started with `PORT=4180 npm run dev:test-db` (port 3800 belongs to the builder's
slice), health `{"ok":true,"database":"ok"}`, stopped at the end of the review; port 4180 verified
free afterwards. A `.env.local` symlink was created in this worktree for the run and removed; it is
gitignored and was never staged. `git status` is clean apart from this record.

Shared database notes, reported and not looped on: `corgi_test` carried 504 `activity_log` rows,
1500 open reconciliation breaks and 394 refused `mcp_calls` at review time, which is accumulation
from other builders' runs, not contention. No run was repeated. One `human` MCP key was minted on
`corgi_test` for the fixture customer user of CGP-04925 to execute the F-MCPTOOLS-01 probe; its
secret was shown once in the terminal, is not in this record, in any file or in any commit, and the
key is bound to a disposable-database fixture user. `run_reconciliation` took 13.3 s against the
Stripe sandbox, as it does on every run of this check.

## 6. What was not verified

- **The deployed application.** Neither new tool was called on the deployed URL. AF-01 evidence for
  this slice is NOT RUN, and so is the AF-02 inventory line for it.
- **`check:money-guards`.** Reserved for the coordinator on an ephemeral database, per the
  assignment. The guards of `activity_log` were read in migration 0021 and not re-proved here.
- **Ten of the fifteen figure keys**, see F-MCPTOOLS-03. `endorsement_delta` in particular was
  never returned by any run I made, so the builder's own disclosure that its wording is copied from
  the page's JSX is recorded on the builder's word plus a reading of both, not on an execution.
- **Agreement with the rendered page.** `scripts/check-mcp.ts` compares `explain_amount` against a
  composition it performs itself with the same functions the page uses. The comment "two paths
  meeting, not one path meeting itself" overstates: they are the same functions re-composed, and a
  future change to the page's own composition would not make this check fail. The falsifiable part
  is real (the hard-coded `floor(120000 x 235 / 10000)` and 2820, 2500, 125320, 18000, 120000).
- **Concurrency and load.** No concurrent calls, no stress profile. Out of scope for two read tools.
- **The browser.** No screen was touched by this diff and none was opened.

## 7. Verdict

**FAIL** at `6a41c2a96ba35b3bc840c63fab71647275ca89e1`, on one MEDIUM finding: F-MCPTOOLS-01, a
customer key reads through `explain_amount` the broker's commission, the cash and unearned premium
balances, the cancellation figures and the journal entry ids that the same user's own screen
deliberately withholds. It is confirmed by execution, not inferred. Everything else in the slice
holds: no money row is written, no column is redefined, no migration was added or edited, no secret
appears, the write tool count is still one, tenant isolation between brokers is proved over HTTP,
and the three checks that could be run all pass.

The five LOW and INFO findings do not block on their own. F-MCPTOOLS-02 and F-MCPTOOLS-05 are
comments that claim more than the code does, which matters under AF-06 because they are what a
reader would rely on.

Residual limitations, for the coordinator: the deployed-application evidence for the two new tools
(F-MCPTOOLS-08), and the key-level versus user-level scope of `list_my_activity`, which is a
disclosed design limit and not a finding, since it is stated in the tool description, in the module
header and in the README.

**Walkthrough status: NOT REVIEWED WITH YOANN.** No part of this slice has been explained back by
him. A reviewer cannot certify his understanding.

## 8. Register lines

For `docs/reviews/FINDINGS.md`, owned by the coordinator:

| ID | Sev | Finding (one line) | Fix | Status |
|---|---|---|---|---|
| F-MCPTOOLS-01 | MED | A customer key reads through explain_amount the broker's commission, the ledger sums, the cancellation figures and journal entry ids that the customer's own screen withholds | Gate the eleven non-customer figure keys on owning broker or staff inside the tool; add a customer-key refusal assertion to check:mcp | OPEN |
| F-MCPTOOLS-02 | LOW | explanationEndsOnTheFigure compares a number with itself for 12 of the 15 keys; the comment calls it the check made for every figure | Take the cancellation amount from the stored event figure, or say which keys the check can falsify | OPEN |
| F-MCPTOOLS-03 | LOW | Ten of the fifteen published figure keys are exercised by no test and no check; explain-figure.ts has no unit test | Cancel and endorse a fixture policy in check:mcp, or unit-test the module | OPEN |
| F-MCPTOOLS-04 | LOW | tools/list spreads a tool's own annotations after the derived hints, so a future write tool could publish readOnlyHint true | Spread tool.annotations first and let the derived hints win | OPEN |
| F-MCPTOOLS-05 | LOW | list_my_activity bounds its answer and not its work: Seq Scan plus Sort on activity_log, no index on actor_user_id | Additive index on (actor_user_id, recorded_at desc), or reword the comment | OPEN |
| F-MCPTOOLS-06 | LOW | list_my_activity tells the caller no amount is recorded, when it is the return shape that omits it (message is stored) | Say returned, not recorded | OPEN |
| F-MCPTOOLS-07 | LOW | explain_amount advertises an enum the shared argument validator does not enforce; jsonrpc.ts says the advertised schema is enforced there | Enforce enum in argumentsSchemaRefusal, or narrow the comment | OPEN |
| F-MCPTOOLS-08 | LOW | COMPLIANCE-MATRIX MCP-01 and BLD-09 and the README demo paragraph still describe a five-tool surface; the two new tools have no deployed-app evidence | Coordinator updates the records; exercise both tools on the deployed URL before the AF-01 claim | OPEN |
