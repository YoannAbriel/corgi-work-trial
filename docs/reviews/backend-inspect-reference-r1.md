# Independent review, slice inspect_reference (round 1): the eighth read-only MCP tool

Reviewer: independent reviewer sub-agent, working in the worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/wf_5802e08c-9ee-3`, detached at the
reviewed SHA. Written at 2026-09-09T19:55Z.

Reviewed revision: **0b9202d897f9d620dbf302c22accdf07e85d5d81** (branch
`worktree-wf_5802e08c-9ee-1`, three commits `4b201d8`, `e5a0c2c`, `0b9202d`), read as
`git diff origin/main...0b9202d` with `origin/main` at `2387190`. The branch is based on
`5f345ac`, two commits behind `origin/main`; the two commits it does not carry touch
`app/` routes and `docs/`, which this slice does not touch, so the diff is readable on its own.
The working tree was clean at review time apart from this file. No code was modified, nothing was
pushed to a shared branch, `main` was not touched, no migration was applied.

This is a scoped engineering assessment of one slice. It is not a legal certification and it is
not a statement that the six delivery gates pass for the whole submission.

## 1. Startup receipt

Read in full, in this order, before looking at any code of the slice: `CLAUDE.md`,
`AUTOMATIC-FAILS.md`, `READABLE-CODE.md`, `AGENTS.md`, `REVIEWER.md`, `WORKFLOW-48H.md`.

Read for this scope: `docs/DECISIONS.md` (rule 21 at 2026-09-08T20:38Z, rules 25 to 27 at
2026-09-09T09:50Z including rule 26 on key minting, rules 28 to 32 at 13:05Z including rule 29 on
the two previous read tools, rules 33 to 41 at 15:20Z, the correction note at 16:08Z and decision
42 at 16:55Z), `docs/reviews/FINDINGS.md` (register head and tail, for the severity and status
vocabulary), `docs/reviews/backend-mcp-tools-r1.md` (record format and the findings this slice
says it reuses), `docs/COMPLIANCE-MATRIX.md` rows `MCP-01` and `BLD-09`, `README.md` (the MCP
surface section, before and after).

Code read in full at the reviewed SHA: `lib/mcp/tools/inspect-reference.ts` (all 663 lines),
`lib/mcp/scope.ts` and `lib/mcp/scope.test.ts`, `lib/mcp/tools/tool.ts` (the argument schema
gate) and `lib/mcp/tools/tool.test.ts`, `lib/mcp/tools/index.ts`,
`lib/mcp/never-delegated.test.ts`, the whole `scripts/check-mcp.ts` diff, the new
`latestBreakReportsFor` in `lib/reconciliation/read.ts` and the `LATEST_REPORT_OF_EACH_BREAK`
change, the `webhooksTouching` change in `lib/console/read.ts`, `scripts/dev-on-test-database.ts`.
Read in the parts that matter here: `lib/mcp/jsonrpc.ts` (`tools/call` dispatch, the schema gate,
the refusal and internal-error paths), `lib/console/read.ts` (`consoleSubject` and its four
subject builders, `operationsOfSubject`, `journalEntriesOfSubject`, `webhooksTouching`,
`activityOfSubject`, `activityOfCorrelationId`, `integrationModeOf`), `lib/claims/read.ts`
(`claimHeader`), `lib/observability/log.ts` (`correlationIdOf`, the route descriptor),
`app/policies/[policyId]/page.tsx` (what an owning broker actually sees on a policy screen),
`db/migrations/0002_policies_and_money_operations.sql` (the nullable `policy_id` on
`money_operations`).

Not read, and why: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`,
`GAP-REVIEW.md` (advisory catalogues; no retained control was identified for this scope beyond
what `AGENTS.md` already requires of an MCP read tool), the other slice handoffs. Absent files:
none.

Acceptance criterion reviewed: `docs/COMPLIANCE-MATRIX.md` row **MCP-01** (working MCP surface,
read tools with authorization and tenant isolation, one write tool that only queues, a written
never-delegated list), extended by an eighth tool under decision 42.

Planned checks, all executed once each: `npm run typecheck`, `npm test`, `npm run check:mcp`
against a dev server started from this worktree on port 3800 through
`scripts/dev-on-test-database.ts`, a secret scan, and two read-only probes of the tool written for
this review. `npm run check:money-guards` was deliberately NOT run (forbidden by this assignment).
No secret value appears in this record.

## 2. Applicability

Feature: one read-only MCP tool on the existing per-user-API-key surface of a Track 1 policy
administration application. Actors: an agent or a person holding an MCP key bound to one user
(role `broker`, `customer`, `staff_ops`, `staff_approver`). Data: identifiers, money figures,
lifecycle instants, journal lines, reconciliation reports and request metadata the application
already stores. No provider is called by the tool. Jurisdiction and rail are unchanged by this
slice; nothing here changes a money path, a rate, a tax rule or an approval gate, so no new
external legal source was consulted for it. The applicable requirements are the trial's own:
non-negotiable 8 of the brief (MCP surface, authorization and tenant isolation on read tools),
`AGENTS.md` "Maker-checker and MCP", `AUTOMATIC-FAILS.md` AF-02 to AF-06, `READABLE-CODE.md`, and
decision 42 as recorded on 2026-09-09T16:55Z.

## 3. Requirement matrix

| # | Requirement (builder's assignment / decision 42) | Control and code location | Evidence | Verdict |
|---|---|---|---|---|
| 1 | One argument `reference`, string, 1 to 200 characters | `inputSchema` in `lib/mcp/tools/inspect-reference.ts`; both bounds enforced by `argumentsSchemaRefusal` in `lib/mcp/tools/tool.ts` before `run` | check:mcp "AN OVER-LONG REFERENCE IS REFUSED BY THE SCHEMA"; `tool.test.ts` three new cases; the refusal names the bound and not the value | PASS |
| 2 | Accepts what the console search accepts (Stripe id, uuid, policy number, claim number, break key, correlation id, MCP key prefix) | `shapeOf` and the eight regexes; `resolve` and its five resolvers | check:mcp on a policy number, a PaymentIntent id, a break key and `cmk_`; my probes on a claim number, a claim uuid, a policy uuid, an operation uuid, a correlation id and an `acct_` | PASS on resolution, see F-INSPECT-01 for what the answer then says on a broker subject |
| 3 | Output: what it resolved to, the money operations with their timeline and the terminal-preferring status | `describeOperation`; `operationsOfSubject` computes `latest_status` with `statusPreferringTerminal` in SQL (F-INT-03) | check:mcp: the planted PaymentIntent comes back `succeeded`, 125320 cents, with `requestedAt` and `succeededAt` | PASS |
| 4 | The webhook events that touched them, never the payload | `webhooksTouching` selects identity, delivery status, attempts, a cut `last_error` and `payload -> data -> object ->> id` only | Reader read line by line; no `payload` column reaches the answer; new `processing_updated_at` column is the delivery row's instant and is documented as such | PASS |
| 5 | The journal entries with their lines, integer cents | `journalEntriesOfSubject`, bounded to 20; `usd()` on every figure | check:mcp: the file's entry ids contain the ids `journalEntriesOfPolicy` reads on the policy page, and equal them exactly on the claimless policy | PASS |
| 6 | The reconciliation reports: latest classification, run id and time, both amounts, the explained note with author and time | new `latestBreakReportsFor` in `lib/reconciliation/read.ts`, built on the shared fragments `LATEST_REPORT_OF_EACH_BREAK`, `IT_IS_A_BREAK_TO_ACT_ON`, `IT_IS_A_PROBE_FROM_A_CHECK_RUN`, `THE_NOTE_EXPLAINS_THE_LATEST_REPORT` | check:mcp: the planted `claims_rail` break resolves to `provider_only`, 777700 cents, a 36-character run id, `isBreakToActOn true`, then after `explainBreak` the note, its author and its time, `isBreakToActOn false`, same classification and amount | PASS |
| 7 | The policy or claim it belongs to, number, status, terms in force today | `belongsTo` composing `policyDetail`, `policyAsItStoodOn` and `termsInForceOn`, the two functions the policy screens use | check:mcp: `CGP-05024`, status `bound`, premium in force 120000. My probes: correct for a policy and for a claim; **wrong for a broker subject** | FAIL (F-INSPECT-01) |
| 8 | The last 20 activity rows carrying the reference | `activityOfSubject` / `activityOfCorrelationId` at limit 20; `describeActivity` drops the actor name and the `message` column | Readers read; probe on a correlation id returned 7 rows | PASS, with F-INSPECT-04 on whose rows a broker key sees |
| 9 | Every list bounded, the bound published | five constants, repeated in the description, in the `tools/list` annotation and in `bounds` beside the lists | check:mcp asserts the annotation (`activity: 20`) and that every list is under its bound | PASS, assertion is weak (see section 6) |
| 10 | An unknown reference answers "nothing matches", never an error | `nothingMatches` for an unknown shape and for a shape that resolves to no row | check:mcp on `CGP-99998` and `pi_never_created_by_this_system`; my probe on `CGP-99997` with a broker key | PASS |
| 11 | Fail-closed role gate: a customer key refused before any read | `inspectionVisibilityRefusal` (only `broker` and the two staff roles pass), called first in `run` | `scope.test.ts` four new cases including the fail-closed one on an `agent` role; check:mcp: same sentence for an existing and a non-existing policy | PASS |
| 12 | A broker key sees only its own book; the refusal reveals nothing | `referenceInBookRefusal` on `subject.brokerId`, applied after resolution and before every read of the file | `scope.test.ts` (including a broker with a null `brokerId`, and a refusal that names no kind, number or owner); check:mcp on another broker's policy and on a break key; my probe on a policy number and a correlation id of another broker | PASS on content, see F-INSPECT-05 on existence |
| 13 | Never a secret, a payload or an email in the output | no `payload`, no key material, no email column selected anywhere in the answer path; `ConsoleSubject.identity` (which does carry the customer name and email) is deliberately not spread into the answer | Read line by line; the two probes printed whole answers and carried no name and no email; the note author's display name is present by design (the requirement asks for the author) | PASS |
| 14 | `tools/list`: honest description, `readOnlyHint`, the closed list in the description | `description` and `annotations` on the tool; `effect: "read"` | check:mcp: eight tools in order, the three added last are read-only, eight shapes and the bounds published | PASS |
| 15 | Never-delegated list unchanged; still one write tool | `never-delegated.test.ts`: ten operations, one `queues_for_a_human`, plus a new case that the description refuses `cmk_` and says why | `npm test`; check:mcp refuses a `cmk_` prefix with the reason | PASS |
| 16 | check:mcp extended and run once | `scripts/check-mcp.ts` sections 3d and 5b | Run once from this worktree: ALL CHECKS PASSED, 0 FAIL | PASS |
| 17 | README: eight tools, one example, one line in the never-delegated paragraph | `README.md` MCP section | Read in the diff | PASS |
| 18 | No migration, reads only, no money row updated or deleted | The diff carries no `db/migrations` file; one `insert` in the check fixture, into `simulator_provider_records` (the simulated provider's own table), nothing else | `grep` over the whole diff for `update`, `delete`, `truncate`, `drop`: no hit | PASS |

## 4. Findings

### F-INSPECT-01 (MEDIUM) A reference that resolves to a broker is answered with one arbitrary policy of that broker, named as the file's policy

`belongsTo` in `lib/mcp/tools/inspect-reference.ts` starts with
`const policyId = subject.policyIds[0] ?? null` and then reports that policy's number, its cached
status, its term and its four terms in force today. For a policy subject and a claim subject that
is exactly right, and it is what the checks cover. For a **broker** subject it is wrong: a broker's
`ConsoleSubject` carries up to 200 policy ids (`brokerSubject` in `lib/console/read.ts`), and
`policyIds[0]` is simply the broker's most recently created policy. The money operations and the
journal entries printed beside it are read for that whole book (`journalEntriesOfSubject` widens to
`entry.broker_id` when the subject is a broker), bounded to 20, under a header naming one policy.

Two references reach this state, and the second is common: `acct_...` (a Stripe connected account,
resolved through `broker_kyb_events`), and **any correlation id whose newest object-naming activity
row named a broker**, which is what a request against a broker screen writes.

Verified by execution, not by reading. Read-only probe against `corgi_test` calling
`inspectReference.run` with a staff context:

- `acct_...` of a broker holding 3 policies: `resolvedTo "broker"`, `belongsTo.policyNumber
  "CGP-01124"`, `policyStatus "bound"`, `term 2028-03-01 to 2029-03-01`, `annualPremium $1,200.00`,
  `premiumTax $28.20`, `policyFee $25.00`, `totalCharge $1,253.20`, plus the two coverage limits.
- a correlation id read from `activity_log`: `resolvedTo "broker"`, `belongsTo.policyNumber
  "CGP-04992"`, `policyStatus "bound"`, `premiumInForce "$1,200.00"`, 1 money operation, 4 journal
  entries, 7 activity rows.

Consequence: this is the tool an agent uses during an incident, and its own README promises that
"a figure an agent quotes here is the figure a person reads on `/ops/console`". Here it hands back a
specific policy number with a specific premium as the file of a reference that belongs to no single
policy, with nothing in the answer saying the header is one of several. An agent summarising
"`acct_x` is policy CGP-01124, $1,200.00 in force" states a fact the application does not hold.
`whatThisMeans` says "This reference belongs to a broker", which is true but does not disown the
policy header printed above it. No check exercises either path (see F-INSPECT-03), which is why it
survived.

Required correction: when `subject.kind === "broker"`, return no single-policy header (null
`policyId`, `policyNumber`, `policyStatus`, `term` and `termsInForceToday`), and say in the answer
that the money operations, journal entries and activity rows span that broker's book, with the
number of policies they were drawn from. A `check:mcp` assertion on an `acct_` reference and on a
correlation id resolving to a broker should hold the fix.

### F-INSPECT-02 (LOW) The narrowing filters after the bound, so the operation a reference names can be missing from its own file

`readTheFile` reads `operationsOfSubject(database, subject, MOST_MONEY_OPERATIONS)` and only then
filters that page of 20 down to `resolution.operationId`. The reader orders by
`operation.created_at desc`, so on a subject carrying more than 20 money operations the named
operation may not be in the page that was read. The answer then carries
`narrowedToOneMoneyOperation: "<the id>"` with `moneyOperations: []` and a `whatThisMeans` reading
"0 money operation(s)": an agent chasing a PaymentIntent would report that the payment has no
operation behind it, which is the opposite of the truth and exactly the kind of statement that
leads a human to re-send money.

Not reachable on the current data: the busiest subject I saw carried 3 operations, and the check's
own fixtures carry 1. It is a latent defect, not an observed one, which is why it is LOW and not
MEDIUM. Required correction: when `resolution.operationId` is set, read that operation by id
(or read it first and merge), instead of filtering a bounded page.

### F-INSPECT-03 (LOW) Half the published reference shapes have no assertion anywhere

`tools/list` publishes eight shapes and `check:mcp` asserts that it publishes eight. The behaviour
of only four is asserted: `policy_number`, `stripe_object` (a `pi_`), `break_key` and
`mcp_key_prefix`, plus an unknown shape and an over-long string. Nothing exercises
`connected_account` (`acct_`), `uuid`, `claim_number` or `correlation_id`, and no unit test
substitutes for it because the tool has none. F-INSPECT-01 lives in precisely that untested area,
and I found it only by running the tool myself. Required correction: one assertion per published
shape in `scripts/check-mcp.ts`, including the two that resolve to a broker.

### F-INSPECT-04 (LOW) A broker key reads the activity rows of every actor on its own book, which no broker screen and no other tool shows

The tool withholds the webhook inbox and the reconciliation reports from a broker key, and states
the reason honestly in `sectionsThisKeyMayNotRead`: "no broker screen shows a provider event". The
same reasoning applies to the activity log, which is a staff console panel (decision 25,
`components/console-360.tsx`), and `list_my_activity` deliberately returns the rows of the key's own
user and of nobody else. `inspect_reference` returns up to 20 `activityOfSubject` rows to a broker
key, including rows written by staff actors on that broker's policies: route, method, outcome, the
rule that refused a request, the status code, the duration and the actor's role. No money figure, no
name and no message text is in them, and every row is inside the key's own book, so the tenant rule
of the assignment is respected; it is the tool's own stated principle that is applied
inconsistently. Required correction: either restrict the panel to the key's own user, as
`list_my_activity` does, or say in the description and in the answer that these rows include other
actors' requests on this object.

### F-INSPECT-05 (LOW) A broker key can still tell that a reference exists from one that does not

A reference outside the book is a refusal; a reference that matches no row is an answer. A broker
key can therefore enumerate policy numbers, claim numbers, break keys and Stripe ids and learn which
ones exist, learning nothing else about them. Observed in the check run ("A BROKER KEY OPENS ITS OWN
POLICY AND IS REFUSED ANOTHER BROKER'S") and in my probe (`CGP-99997` with a broker key answers
`resolvedTo "nothing"`, another broker's number is refused). The builder documented it at
`REFERENCE_NOT_IN_THIS_BOOK` and disclosed it, and it follows from two requirements of the
assignment held at the same time ("refuse a reference outside the book" and "an unknown reference
answers a nothing-matches result, not an error"). It is not a silent flaw; it is a design tension
that only Yoann can close. Required correction: none by the builder. Decision needed: either accept
it and put one line in the README beside the tool, or answer "nothing matches" to a broker key in
both cases and lose the ability to tell an operator "this one is not yours".

### F-INSPECT-06 (INFO) Two resolution states are named for something they are not

`resolvedTo: "provider_record_only"` is also returned for a correlation id that named no object
(`byCorrelationId`), which is a request log and not a provider record; `whatThisMeans` covers the
three cases in one sentence but the enum value stays misleading. Separately, `byOperationId` returns
the `NOTHING` shape with `operationId` set when a money operation carries neither a policy nor a
claim, so `run` answers "nothing matches" for an operation that exists, while `byProviderReference`
answers `provider_record_only` in the same situation. `money_operations.policy_id` is nullable
(migration 0002) and `claim_id` was added nullable, so the state is representable; no such row exists
today. Cheap to fix, no consequence observed.

### F-INSPECT-07 (INFO) The shared disposable database carries a second complete run of this check, caused by the reviewer

Reported honestly, mirroring the builder's own disclosure. After the single authorised run of
`npm run check:mcp` (the one whose result is recorded below), I ran a one-line command intended to
count the PASS lines of that output; it re-invoked `npm run check:mcp` and completed a **second full
run** before I could stop it. `corgi_test` therefore carries two more sets of this check's fixtures
than the assignment intended (brokers, users, two paid policies, keys, `mcp_calls` rows, one more
planted `claims_rail` provider record of 777700 cents and its explanatory note), on top of the
builder's own partial second run. Nothing was updated or deleted, nothing touched the trial or
development databases, no money moved, and the only provider contact is the reconciliation reading
the Stripe sandbox. Another agent counting rows or breaks on `corgi_test` should know. The result
reported below is the first, complete, authorised run.

## 5. Automatic-fail gate for this scope

| Rule | Status | Evidence |
|---|---|---|
| AF-01 accessible deployment | NOT RUN | This slice deploys nothing; the endpoint's deployed proof belongs to the coordinator |
| AF-02 no simulation presented as live | PASS | Every operation and webhook row carries `rail` from `integrationModeOf`, which labels anything that is not exactly `stripe` as `LOCAL SIMULATOR`; the check's planted break is inserted into the simulator's own provider table and comes back labelled `claims_rail` |
| AF-03 no UPDATE or DELETE on money rows | PASS | Every query added is a `SELECT`; the only write in the diff is one `INSERT` of a simulated provider record in the check script; no migration; `grep` over the whole diff confirms it |
| AF-04 sandbox only | PASS | The check runs against `corgi_test` through `scripts/dev-on-test-database.ts`; no live key, no real personal data, no money moved |
| AF-05 no secret committed | PASS | `gitleaks detect --source . --no-git --redact`: 4 hits, all four inside `.next/` build output produced by my own dev-server run, which `.gitignore` line 13 excludes and which `git ls-files` confirms is untracked. No secret in the diff; no value printed at any point; the `.env.local` symlink I created for the run was removed |
| AF-06 explainable line by line | QUESTIONS OPEN | The code is readable and the comments say why, but F-INSPECT-01 shows the answer shape has a case the author did not walk through. Not confirmed with Yoann |

## 6. Checks executed

| Check | Result |
|---|---|
| `npm ci` (the worktree had no `node_modules`) | Installed, `package-lock.json` unchanged, `git status` clean |
| `npm run typecheck` | PASS, `tsc --noEmit`, no output |
| `npm test` | PASS, 529 tests, 528 pass, 1 skipped, 0 fail. Matches the builder's report exactly |
| `npm run check:mcp` (once, dev server on port 3800 through `npm run dev:test-db` against `DATABASE_URL_TEST_APP`) | **ALL CHECKS PASSED**, 0 FAIL, including the 15 new assertions. Server stopped afterwards, port 3800 confirmed free, `.env.local` symlink removed |
| `gitleaks detect --source . --no-git --redact` | 4 findings, all in untracked `.next/` build output (see AF-05) |
| Read-only probe 1: `inspectReference.run` on an `acct_` reference, staff context | Produced the evidence of F-INSPECT-01 |
| Read-only probe 2: `inspectReference.run` on a claim number, a claim uuid, a policy uuid, an operation uuid, a correlation id, and the same references with another broker's key | Four shapes correct; the correlation id reproduced F-INSPECT-01; the broker key was refused every reference outside its book and answered "nothing matches" on an unknown one |
| `npm run check:money-guards` | NOT RUN, forbidden by this assignment |

Both probes were `SELECT` only, ran from a temporary file that was deleted, and wrote nothing.

On the weakness of one published assertion: "every list of the file respects the bound the file
publishes beside it" compares 1 operation against 20 and 5 entries against 20. It can fail in
principle, but on this fixture data it cannot distinguish a bounded reader from an unbounded one.
It is the bounds in the readers themselves (`limit ${limit}` in all five) that carry the guarantee,
and I read each of them.

## 7. What was not verified

- The deployed endpoint. Nothing in this review was exercised over HTTP against production; the
  check ran against a local server on the disposable database.
- The webhook panel of the file with real rows: no `webhook_events` row in `corgi_test` matched the
  references I probed, so `webhookEvents` came back empty in every observation. Its bound, its
  columns and the absence of `payload` were verified by reading the query; the panel was not seen
  populated. The unindexed `jsonb` scan it performs is disclosed by the builder and unchanged.
- The `provider_record_only` path (a Stripe reference known to the inbox and to no operation) was
  read but never executed, for the same reason.
- Cross-broker leakage through a shared correlation id. `correlationIdOf` accepts a caller's
  `x-request-id`, and `activityOfCorrelationId` is not scoped by subject, so rows of several
  subjects can share one id in principle. I could not construct a case where a broker sees another
  broker's rows: `route` is a declared template and never carries an id, and `describeActivity`
  returns no subject id. Treated as not exploitable on the evidence, not as proved safe.
- Concurrency, load and the behaviour of the tool on a subject with more than 20 money operations
  (F-INSPECT-02), which would have required writing many fixture rows to the shared database.
- Merge behaviour. The branch is two commits behind `origin/main` and the builder flags a conflict
  risk on `lib/reconciliation/read.ts` and `lib/console/read.ts`. The merged tree was never built or
  tested; that belongs to the coordinator.

## 8. Verdict

**FAIL** at `0b9202d897f9d620dbf302c22accdf07e85d5d81`, on F-INSPECT-01 (MEDIUM), following this
assignment's rule that any HIGH or MEDIUM finding fails the slice.

The slice is close. The transport gate, the two scope gates, the never-delegated list, the
bounds, the terminal-preferring status, the reuse of the console readers and the new reconciliation
reader are all sound, and the fifteen new check assertions are real assertions that could fail. One
answer shape is wrong, on two reference shapes that no assertion covers, and it is the kind of wrong
an agent will quote out loud during an incident. F-INSPECT-02 to F-INSPECT-04 are LOW and can be
fixed with it or disclosed; F-INSPECT-05 needs Yoann's decision rather than a fix; F-INSPECT-06 and
F-INSPECT-07 are recorded for visibility.

Re-review needed on the corrected diff: the broker-subject header, and the new assertions on the
four unasserted shapes.

Candidate walkthrough status: **NOT REVIEWED WITH YOANN**. No claim is made here about what Yoann
can explain.

## 9. Register lines

| ID | Sev | Finding (one line) | Fix | Status |
|---|---|---|---|---|
| F-INSPECT-01 | MED | A reference resolving to a broker (`acct_`, or a correlation id naming a broker) is answered with one arbitrary policy of that broker as the file's policy, with its number, status, term and terms in force, while the operations and entries beside it span the whole book | Return no single-policy header for a broker subject and say the lists span the book; assert both paths in check:mcp | OPEN |
| F-INSPECT-02 | LOW | The narrowing filters a bounded page, so on a subject with more than 20 money operations the named operation is absent from its own file while the answer still names it | Read the named operation by id instead of filtering a page of 20 | OPEN |
| F-INSPECT-03 | LOW | Four of the eight published reference shapes (`acct_`, uuid, claim number, correlation id) have no assertion anywhere; F-INSPECT-01 lives in that gap | One check:mcp assertion per published shape | OPEN |
| F-INSPECT-04 | LOW | A broker key reads the activity rows of every actor on its own book, which no broker screen and no other tool shows, while webhook events and reconciliation are withheld on exactly that argument | Restrict to the key's own user like list_my_activity, or say so in the description and in the answer | OPEN |
| F-INSPECT-05 | LOW | A broker key can tell a reference that exists but is not its own (refusal) from one that matches nothing (answer), so it can enumerate existence | Yoann decides: accept and disclose in the README, or answer "nothing matches" in both cases | OPEN, needs a decision |
| F-INSPECT-06 | INFO | `provider_record_only` also names a correlation id that matched no object, and an operation with neither policy nor claim answers "nothing matches" while the same case answers `provider_record_only` by another path | Name the states for what they are; no consequence observed | OPEN |
| F-INSPECT-07 | INFO | The reviewer accidentally ran a second complete `check:mcp` on the shared `corgi_test`, adding one more set of fixtures and one more planted 777700-cent break with its note | None; another agent counting rows or breaks on `corgi_test` should know | DISCLOSED |
