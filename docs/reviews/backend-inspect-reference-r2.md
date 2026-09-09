# Independent review, slice inspect_reference (round 2): the fix of F-INSPECT-01

Reviewer: independent reviewer sub-agent, working in the worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/wf_5802e08c-9ee-5`, detached at the
reviewed SHA. Written at 2026-09-09T18:22Z.

Reviewed revision: **9b9902a992a4958c0dd54ec08fd0d93fb51b1628** (branch
`worktree-wf_5802e08c-9ee-1-fix`, five commits `4b201d8`, `e5a0c2c`, `0b9202d`, `4ac3160`,
`9b9902a`), read as `git diff origin/main...9b9902a` (merge base `5f345ac`) and, for the fix
itself, as `git diff 0b9202d..9b9902a` against the revision round 1 failed. `origin/main` was at
`59c41b5` at review time; the commits the branch does not carry touch `app/` and `docs/`, which
this slice does not touch, so the diff is readable on its own. No code was modified, nothing was
pushed to a shared branch, `main` was not touched, no migration was applied, no money row was
updated or deleted.

This is a scoped engineering assessment of one slice. It is not a legal certification and it is
not a statement that the six delivery gates pass for the whole submission.

## 1. Startup receipt

Read in full, in this order, before looking at any code: `CLAUDE.md`, `AUTOMATIC-FAILS.md`,
`READABLE-CODE.md`, `AGENTS.md`, `REVIEWER.md`.

Read for this scope: `docs/DECISIONS.md` (rule 21 at 2026-09-08T20:38Z, rules 24 to 27 at
2026-09-09T09:50Z, rules 28 to 32 at 13:05Z including rule 29, the correction note at 16:08Z, and
decision 42 at 16:55Z, which is the assignment of this slice), the round 1 record
`docs/reviews/backend-inspect-reference-r1.md` in full (branch `review/inspect-reference-r1`,
commit `53e5c1b`), `docs/reviews/FINDINGS.md` (head and tail, for the severity and status
vocabulary), the README "MCP surface" section before and after.

Code read at the reviewed SHA: `lib/mcp/tools/inspect-reference.ts` (all 698 lines),
`lib/mcp/tools/broker-book.ts` and `lib/mcp/tools/broker-book.test.ts` (both new, in full),
`lib/mcp/scope.ts` and `lib/mcp/scope.test.ts`, `lib/mcp/tools/tool.ts` (the argument schema gate)
and `lib/mcp/tools/tool.test.ts`, `lib/mcp/tools/index.ts`, `lib/mcp/never-delegated.test.ts`,
`lib/mcp/jsonrpc.ts` (the `tools/call` dispatch, the refusal and internal-error paths), the whole
`scripts/check-mcp.ts` diff and its fixture builders (`createPeople`, `createPaidPolicy`,
`fixtureJournalCount`), the new `latestBreakReportsFor` and the `LATEST_REPORT_OF_EACH_BREAK`
change in `lib/reconciliation/read.ts`, and in `lib/console/read.ts` the readers this tool stands
on (`consoleSubject` and its four subject builders, `operationsOfSubject` with
`statusPreferringTerminal`, `journalEntriesOfSubject`, `webhooksTouching`, `activityOfSubject`,
`activityOfCorrelationId`), plus `scripts/dev-on-test-database.ts` and `.gitignore`.

Not read, and why: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`,
`GAP-REVIEW.md` (advisory catalogues, no retained control identified for this scope beyond what
`AGENTS.md` already requires of an MCP read tool). Absent files: none.

Acceptance criterion reviewed: `docs/COMPLIANCE-MATRIX.md` row **MCP-01** as extended by decision
42, narrowed for this round to the correction of **F-INSPECT-01** and to whether that correction
broke anything else.

Planned checks, each executed once: `npm run typecheck`, `npm test`, `npm run check:mcp` against a
dev server started from this worktree on port 3800 through `scripts/dev-on-test-database.ts`, two
read-only probes of the tool written for this review, and a secret scan.
`npm run check:money-guards` was NOT run (forbidden by this assignment). No secret value appears in
this record.

## 2. Applicability

Unchanged from round 1 and restated in one paragraph. One read-only MCP tool on the existing
per-user-API-key surface of a Track 1 policy administration application. Actors: an agent or a
person holding an MCP key bound to one user (`broker`, `customer`, `staff_ops`, `staff_approver`,
`agent`). Data: identifiers, money figures, lifecycle instants, journal lines, reconciliation
reports and request metadata the application already stores. No provider is called by the tool.
Nothing in this round changes a money path, a rate, a tax rule or an approval gate, so no new
external legal source was consulted. The applicable requirements are the trial's own:
non-negotiable 8 of the brief (MCP surface, authorization and tenant isolation on read tools),
`AGENTS.md` "Maker-checker and MCP", `AUTOMATIC-FAILS.md` AF-02 to AF-06, `READABLE-CODE.md`, and
decision 42.

## 3. Requirement matrix for this round

| # | Requirement | Control and code location | Evidence | Verdict |
|---|---|---|---|---|
| 1 | A reference resolving to a broker no longer publishes one policy as the file's policy | `belongsTo` returns `brokerBookHeader(subject)` when `subject.kind === "broker"`, in the new pure `lib/mcp/tools/broker-book.ts`; every policy field is null by construction | Probe 1 on the `acct_` of a broker holding 2 policies: `policyId`, `policyNumber`, `policyStatus`, `term`, `termsInForceToday` all null; check:mcp asserts the same over HTTP | PASS |
| 2 | The header says it spans a book and how many policies the lists came from | `spansAWholeBrokerBook: true` and `policiesTheseListsWereDrawnFrom: subject.policyIds.length` | Probe 1: `spansAWholeBrokerBook true`, count 2, and the same for a broker key on its own account | PASS |
| 3 | The sentence says it FIRST, before the counts | `whatThisMeans` puts `brokerBookSentence(...)` ahead of every other branch | Probe 1 read the sentence in full: it opens with "This reference resolved to a BROKER, not to one policy" and ends "open a policy number (CGP-nnnnn) or a policy id to read one policy" | PASS |
| 4 | The 200-policy cap of a book is published beside the five other bounds | `MOST_POLICIES_OF_A_BROKER_BOOK` in `broker-book.ts`, repeated in `bounds` (annotation and answer) and in the description and the sentence | Read in `tools/list` annotation, in the description string and in the answer's `bounds`; the sentence says "its 200 newest at most" | PASS |
| 5 | The rule is proved without a database | `lib/mcp/tools/broker-book.test.ts`, 5 tests on invented brokers: all-null policy fields, the book flags, a book of zero, the sentence with its count and cap, and the singular wording | `npm test`: 534 tests, 533 pass, 0 fail, 1 pre-existing skip | PASS |
| 6 | check:mcp proves both broker-resolving shapes over HTTP | Second paid policy for broker A, an `acct_` on its KYB log, one past request naming it; three new assertions in `scripts/check-mcp.ts` | Run once: "A CONNECTED ACCOUNT ID (acct_) RESOLVES TO THE BROKER'S WHOLE BOOK AND NAMES NO POLICY (book of 2 policies, policyNumber null, terms null)", "the money operations of BOTH of that broker's policies are on the file (2 operations, 9 journal entries, both policies present: true)", "A CORRELATION ID WHOSE REQUEST NAMED A BROKER OPENS THE SAME BOOK (broker, 1 request(s) on the file, policyNumber null)" | PASS |
| 7 | The fix breaks no other header | `belongsTo` is unchanged below the new early return; `FileHeader` adds two fields with `false` and `null` for a policy and a claim | Probe 1 on a claim number and on the same claim's uuid: identical header, `CGP-05034`, status `bound`, term 2028-03-01 to 2029-03-01, terms in force present; check:mcp still asserts the policy-number file | PASS |
| 8 | Reads only, no migration, no money row touched | The whole branch diff adds no `db/migrations` file; `grep` over the added lines finds no `update`, `delete`, `truncate` or `drop`; the three added `insert`s are all fixtures in `scripts/check-mcp.ts` (`broker_kyb_events`, `activity_log`, `simulator_provider_records`, plus a second paid policy through the production function) | Diff read line by line and grepped | PASS |
| 9 | Never-delegated list unchanged, still one write tool | `never-delegated.test.ts`: ten operations, exactly one `queues_for_a_human`, the eighth tool refuses `cmk_` | `npm test`; check:mcp: "AN MCP KEY PREFIX IS REFUSED WITH ITS REASON" | PASS |
| 10 | README states the new rule honestly | The `inspect_reference` paragraph gained one sentence naming the broker case, the finding it fixes and what it used to do | Read in the diff; it matches the code, including "names no policy at all" | PASS |
| 11 | The two scope gates are unchanged and still fail closed | `inspectionVisibilityRefusal` and `referenceInBookRefusal` are byte-identical to round 1 | Probe 2: a customer key gets the SAME refusal object for an existing policy number and an unknown one; `scope.test.ts` cases still pass | PASS |

## 4. Findings

Numbering continues the round 1 record. F-INSPECT-01 is resolved; F-INSPECT-02 to F-INSPECT-07
were not touched by the builder and are restated with their round 1 severity so that nothing is
lost; F-INSPECT-08 and F-INSPECT-09 are new to this round.

### F-INSPECT-01 (MEDIUM) RESOLVED at 9b9902a

Verified by execution and not by reading the builder's claim. A read-only probe called
`inspectReference.run` with a staff context and with a broker context against `corgi_test`, on the
`acct_` reference of a broker holding two policies:

```
resolvedTo: broker
belongsTo: {"kind":"broker","policyId":null,"policyNumber":null,"claimId":null,"claimNumber":null,
            "brokerId":"6835...","policyStatus":null,"term":null,"termsInForceToday":null,
            "spansAWholeBrokerBook":true,"policiesTheseListsWereDrawnFrom":2}
whatThisMeans: "This reference resolved to a BROKER, not to one policy: the money operations, the
journal entries and the requests below span that broker's whole book, drawn from 2 policies (its
200 newest at most). This file therefore names no policy number, no status, no term and no terms in
force: open a policy number (CGP-nnnnn) or a policy id to read one policy. 4 money operation(s), 9
journal entr(ies) and 2 reconciliation report(s) are on this file ..."
```

The correction is at the right place: the rule lives in a pure file (`lib/mcp/tools/broker-book.ts`)
that reaches no database, so `broker-book.test.ts` proves it as a rule, and `check:mcp` proves the
same thing over HTTP on a real broker with a real book of two policies. Both entry points that
reach a broker subject are now asserted (`acct_` and a correlation id whose newest object-naming
request named a broker), which was the untested gap the round 1 finding lived in. The policy and
claim headers are unchanged, verified on a claim number and on the same claim's uuid.

### F-INSPECT-08 (LOW, new) A broker book file names no policy anywhere, so its money operations and journal entries cannot be attributed

`describeOperation` returns `operationId`, `kind`, `provider`, `rail`, `amount`, `createdAt`,
`latestStatus`, the four instants, `providerRef`, `failureReason`, `approvalRequestId` and
`idempotencyKey`, and no policy or claim identity, although `operationsOfSubject` already reads
`policyId`, `policyNumber`, `claimId` and `claimNumber`. The journal entries carry no policy id
either. On a policy file that is harmless (there is one policy). On a broker book it is the
opposite of harmless: the file is now correctly headed "no policy", and the four operations and
nine entries of the probe above are a flat list of amounts with nothing saying which policy each
belongs to. An agent asked "which policy is the $1,200 claim payout on" cannot answer from this
file and must open another tool, which is the trip this tool exists to save.

No false statement is made, which is why this is LOW and not a repeat of F-INSPECT-01. Required
correction: add `policyNumber` and `claimNumber` (already read, already free) to
`describeOperation`, and `policyId` to the journal entries, at least when
`spansAWholeBrokerBook` is true.

### F-INSPECT-09 (INFO, new) The second fixture policy is outside the check's own "no money moved" guard

`scripts/check-mcp.ts` plants a second paid policy for broker A at line 246 to give the `acct_`
reference a book of two, but `ourPolicies` (line 1215), the list the four `fixtureJournalCount`
assertions watch to prove that asking for a payment and running reconciliation move no money, is
still `[policy.policyId, otherPolicy.policyId]`. Nothing in the check touches the second policy
after it is created, so no assertion is wrong today; the guard simply covers two of the three
fixture policies. Cheap to close by adding the id to that list.

### Carried forward from round 1, unchanged and still open

| ID | Sev | State at 9b9902a |
|---|---|---|
| F-INSPECT-02 | LOW | Still present. `readTheFile` reads 20 operations ordered by `created_at desc` and only then filters to `resolution.operationId`, so on a subject with more than 20 money operations the named operation can be absent from its own file while the answer still names it in `narrowedToOneMoneyOperation`. Not reachable on the current data (the richest fixture subject carries 4). |
| F-INSPECT-03 | LOW, partly closed | The two shapes that carried F-INSPECT-01 (`acct_`, correlation id) now have assertions. A claim number and an application uuid still have none in `check:mcp`; I exercised both by probe and they answer correctly (identical header for `CLM-02798` and for its uuid). |
| F-INSPECT-04 | LOW | Unchanged. A broker key still reads `activityOfSubject` rows written by staff actors on its own book, while the webhook and reconciliation panels are withheld on the argument that no broker screen shows them. Inside the tenant boundary, inconsistent with the tool's own stated principle. |
| F-INSPECT-05 | LOW, needs Yoann | Unchanged. A broker key can still tell "exists but not yours" (a refusal) from "matches nothing" (an answer), so it can probe existence. Verified again in probe 2. This is a design tension between two requirements of the assignment, not a defect the builder can close alone. |
| F-INSPECT-06 | INFO | Unchanged. `provider_record_only` still names a correlation id that matched no policy, claim or broker row, including one that named only a customer. |
| F-INSPECT-07 | INFO | Disclosed history of `corgi_test` contention. This round adds two more sets of fixtures: the builder's second run (their own disclosure) and my one authorised run below. |

## 5. Automatic-fail gate for this scope

| Rule | Status | Evidence |
|---|---|---|
| AF-01 accessible deployment | NOT RUN | This slice deploys nothing; the deployed endpoint belongs to the coordinator |
| AF-02 no simulation presented as live | PASS | Every operation and webhook row carries `rail` from `integrationModeOf`; the probe read `"provider":"simulator","rail":"LOCAL SIMULATOR"` on a claim payout and the check read `Stripe LIVE SANDBOX` on the Stripe collection. Noted, not new to this slice: `rail` is derived from the provider column alone, so the check's own locally fabricated `pi_mcp_check_...` fixture is labelled `LIVE SANDBOX` on the disposable database |
| AF-03 no UPDATE or DELETE on money rows | PASS | The whole branch diff adds only `SELECT`s in the library code and three `INSERT`s in the check fixtures; no migration; grep over the added lines finds no `update`, `delete`, `truncate` or `drop` |
| AF-04 sandbox only | PASS | Everything ran against `corgi_test` through `scripts/dev-on-test-database.ts` and the runtime role; no live key, no real personal data, no money moved, no provider side effect from the tool |
| AF-05 no secret committed | PASS | `gitleaks protect --staged --redact` on the one commit of this record: no leaks. No connection string, key or password was printed at any point; the `.env.local` copied into this worktree for the run is git-ignored (`.env*`) and was deleted afterwards, as were the two probe files under the ignored `.local/` |
| AF-06 explainable line by line | QUESTIONS OPEN | The fix is small, pure and commented with the reason rather than the mechanics, and the new file is the most readable part of the slice. Not confirmed with Yoann |

## 6. Checks executed

| Check | Result |
|---|---|
| `npm ci` (this worktree had no `node_modules`) | Installed, `package-lock.json` unchanged, `git status` clean |
| `npm run typecheck` | PASS, `tsc --noEmit`, no output |
| `npm test` | PASS, 534 tests, 533 pass, 0 fail, 1 skipped (pre-existing). Matches the builder's report; the 5 tests of `broker-book.test.ts` are in it |
| `npm run check:mcp`, once, dev server on port 3800 through `npm run dev:test-db` against `DATABASE_URL_TEST_APP` | **ALL CHECKS PASSED**, 96 PASS lines, 0 FAIL, counted from the saved output of that single run and not from a second run. Server stopped afterwards, port 3800 confirmed free |
| Read-only probe 1 (`inspectReference.run`, staff and broker contexts, `acct_` of a two-policy broker, a claim number, a claim uuid) | Produced the F-INSPECT-01 evidence above; 0 email-like strings in the two whole answers |
| Read-only probe 2 (13 hostile references as staff, plus the customer gate) | No raw error, no stack, no crash on any of them: over-long, malformed break keys, an uppercase uuid, a 200-character string, `robert'); drop table policies;--`. All answered "nothing matches" except `cmk_deadbeef`, refused with its reason. The customer key received the SAME refusal object for an existing policy number and an unknown one |
| `gitleaks protect --staged --redact` before the commit of this record | No leaks found |
| `npm run check:money-guards` | NOT RUN, forbidden by this assignment |

Both probes ran `SELECT` only, through the runtime role, from files under the git-ignored `.local/`
that were deleted afterwards.

Contention on the shared `corgi_test`: one run of `check:mcp` for this review, no failure and no
deadlock observed. That run appended one more set of this check's fixtures (two brokers, their
users and keys, now three paid policies instead of two, one claim, one statement, one planted
`claims_rail` provider record of 777700 cents with its explanatory note, and the `mcp_calls` rows
of the session). Another agent counting rows or breaks on `corgi_test` should know.

## 7. What was not verified

- The deployed endpoint. Nothing here was exercised over HTTP against production.
- A broker with more than 200 policies, or a subject with more than 20 money operations
  (F-INSPECT-02): both would have required writing many rows to the shared disposable database.
  The cap and the count are read from `subject.policyIds.length`, which `brokerSubject` caps at
  200, and the sentence says so; the behaviour past the cap was reasoned about, not run.
- The webhook panel populated. As in round 1, no `webhook_events` row in `corgi_test` matched the
  references probed, so `webhookEvents` came back empty every time. The absence of `payload` from
  the query and the new `processing_updated_at` column were verified by reading the SQL.
- Cross-broker leakage through a shared correlation id. `activityOfCorrelationId` is not scoped by
  subject, so rows of several subjects can share one id in principle; `describeActivity` returns no
  subject id and `route` is a declared template, so nothing identifying escapes. Treated as not
  exploitable on the evidence, not as proved safe. Unchanged from round 1.
- The merged tree. The branch is behind `origin/main` and was never merged, built or tested against
  it here; that belongs to the coordinator.
- Yoann's understanding of any line of this slice.

## 8. Verdict

**PASS** at `9b9902a992a4958c0dd54ec08fd0d93fb51b1628`.

F-INSPECT-01, the MEDIUM that failed round 1, is fixed at the right level of abstraction and is now
held by both a unit test of the rule and two HTTP assertions on the two references that reach it.
No HIGH or MEDIUM finding remains in the slice, every check executed passed, and the fix introduced
no regression I could find in the policy header, the two scope gates, the never-delegated list, the
bounds or the argument gate. The two new findings are LOW and INFO: a broker book file that names
no policy anywhere, header or lines (F-INSPECT-08), and a fixture policy left outside the check's
own no-money-moved guard (F-INSPECT-09). Five findings of round 1 remain open at LOW or INFO, one
of them (F-INSPECT-05) needing Yoann's decision rather than a builder's fix.

Candidate walkthrough status: **NOT REVIEWED WITH YOANN**. No claim is made here about what Yoann
can explain.

## 9. Register lines

| ID | Sev | Finding (one line) | Fix | Status |
|---|---|---|---|---|
| F-INSPECT-01 | MED | A reference resolving to a broker was answered with one arbitrary policy of that broker as the file's policy while the lists spanned the whole book | Broker header with every policy field null, the book flag, the policy count and a sentence that says it first, in the pure `lib/mcp/tools/broker-book.ts` | FIXED 9b9902a, verified by probe and by check:mcp |
| F-INSPECT-08 | LOW | A broker book file names no policy anywhere, so its money operations and journal entries cannot be attributed to a policy | Return `policyNumber` and `claimNumber` on each operation and `policyId` on each entry, at least on a book file | OPEN |
| F-INSPECT-09 | INFO | The second fixture policy planted for the `acct_` assertion is outside `ourPolicies`, the list the check's no-money-moved assertions watch | Add its id to `ourPolicies` | OPEN |
| F-INSPECT-02 | LOW | The narrowing filters a bounded page, so on a subject with more than 20 operations the named operation is absent from its own file | Read the named operation by id instead of filtering a page of 20 | OPEN, carried from round 1 |
| F-INSPECT-03 | LOW | Two published shapes (claim number, application uuid) still have no assertion in check:mcp; the two that carried F-INSPECT-01 now have three | One assertion per published shape | OPEN, partly closed at 9b9902a |
| F-INSPECT-04 | LOW | A broker key reads the activity rows of every actor on its own book, while webhook and reconciliation rows are withheld on exactly that argument | Restrict to the key's own user like list_my_activity, or say so in the description and the answer | OPEN, carried from round 1 |
| F-INSPECT-05 | LOW | A broker key can tell a reference that exists but is not its own (refusal) from one that matches nothing (answer) | Yoann decides: accept and disclose in the README, or answer "nothing matches" in both cases | OPEN, needs a decision |
| F-INSPECT-06 | INFO | `provider_record_only` also names a correlation id that matched no object, including one that named only a customer | Name the states for what they are | OPEN, carried from round 1 |
| F-INSPECT-07 | INFO | `corgi_test` carries several extra sets of this check's fixtures: the builder's second run and this reviewer's one authorised run | None; another agent counting rows or breaks on `corgi_test` should know | DISCLOSED |
