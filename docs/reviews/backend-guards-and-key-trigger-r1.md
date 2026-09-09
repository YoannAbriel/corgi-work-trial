# Independent review, slice guards-and-key-trigger, round 1

Reviewer: independent reviewer sub-agent, working in the worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/wf_46bb3e09-77f-7`, branch
`review/guards-and-key-trigger-r1`. Written at 2026-09-09T13:35Z (15:35 local).

Reviewed revision: **845443abf3d2146c4471ee6f161bc81e9d40333d** on the builder's branch
`worktree-wf_46bb3e09-77f-5`, checked out detached in this worktree. Two commits above `main`:
`7e47a9d58e66388179576363699ca3a710f5a320` (two named assertions in `check:money-guards`) and
`845443a` (migration 0024 and the fourth maker-checker refusal). The diff read line by line is
`git diff main...845443a`: **6 files, +306, -2**. No screen, no component and no route file is
touched. The working tree was clean at checkout; the only files this review wrote are this
record and a throwaway probe script kept outside the repository.

This is a scoped engineering assessment of one slice. It is not a legal certification, and it is
not a statement that the six delivery gates pass for the submission.

## 1. Startup receipt

Read in full, in this order, before looking at any code: `CLAUDE.md`, `AUTOMATIC-FAILS.md`,
`READABLE-CODE.md`, `AGENTS.md`, `REVIEWER.md`.

Read in full, for the scope itself: `db/migrations/0024_mcp_key_creator.sql` (all 97 lines),
the diff hunks of `lib/approvals/approvals.ts`, `lib/claims/payments.ts`,
`lib/mcp/tools/claim-payment.ts`, `scripts/check-claims-and-approvals.ts` and
`scripts/check-money-guards.ts`, plus their surrounding functions:
`decideApprovalRequest` and `createApprovalRequest` in `lib/approvals/approvals.ts`,
`requestClaimPayment` in `lib/claims/payments.ts`, `requestClaimPaymentTool` in
`lib/mcp/tools/claim-payment.ts`, `lib/mcp/keys.ts` (`McpPrincipal`,
`principalForPresentedKey`, `createApiKey`), `lib/mcp/tools/tool.ts` (`ToolContext`),
`app/api/mcp-keys/route.ts`, `scripts/create-mcp-key.ts` (the `createApiKey` call),
`scripts/migrate.ts`.

Read in part, with what was read named: `db/migrations/0001` lines 12 to 24 and 192 to 195
(`forbid_change_of_financial_record`, the `app_runtime` grants); `db/migrations/0002` lines 37
to 50, 104 to 125 and 263 to 274 (the `brokers` and `state_tax_rates` tables, their append-only
triggers, the grants); `db/migrations/0004` (the two truncate triggers); `db/migrations/0008`
lines 225 to 275 (the original maker-checker function and its trigger) and line 344 (grants);
`db/migrations/0018` line 91 (`created_by`) and line 212 (grants);
`scripts/check-money-guards.ts` lines 1 to 120, 364 to 460 and 730 to 850;
`scripts/check-claims-and-approvals.ts` lines 1 to 90, 1055 to 1180 and 1354 to 1369;
`scripts/seed.ts` lines 20 to 60 and 118; `README.md` (the migrate commands);
`docs/reviews/b13-9-console.md` and `docs/reviews/FINDINGS.md` (the tail, for the record and
register format only).

Not read, and named as such: the released brief and `WORKFLOW-48H.md` (this round is a code and
migration review of a bounded diff, and the assignment fixed its scope); `docs/DECISIONS.md` and
`docs/reviews/integration.md` beyond the finding statements quoted to me in the assignment,
because `docs/` belongs to the coordinator and the two findings at issue (F-INT-01, F-INT-09)
were quoted verbatim in the task.

Absent files: `db/migrations/0022_*.sql` and `db/migrations/0023_*.sql` do not exist, on this
branch or on `main`. That gap is deliberate on the builder's side for 0023 and unexplained for
0022; see F-GUARDSANDKEYTRIGGER-04.

Next acceptance criterion in scope: the person who created an MCP API key can never decide an
approval request raised through that key, refused by the database for every role and every
route, and refused first by the application with the same sentence; and the two rate-carrying
columns are covered by named append-only evidence.

## 2. Applicability

Product: an insurance policy administration application (Track 1), USD, integer cents,
sandbox providers, synthetic data. The slice adds no provider call, no network destination, no
screen and no money arithmetic. It adds one nullable column, one replaced trigger function, one
application refusal and six check assertions.

Confirmed facts, each checked in the code rather than taken from the builder's summary:

- `approval_requests`, `approval_decisions`, `brokers`, `state_tax_rates` and `mcp_api_keys` are
  all in `PROTECTED_TABLES` of `scripts/check-money-guards.ts` and all carry
  `forbid_change_of_financial_record` on `before update or delete`.
- `app_runtime` holds `select, insert` on `approval_requests`, `approval_decisions` and
  `mcp_api_keys`, and `select` only on `brokers` and `state_tax_rates`. All grants are
  table-level, so the new column is reachable by the runtime role without any new grant.
- The maker-checker rule is a trial requirement (`AGENTS.md`, Maker-checker and MCP) plus the
  general non-negotiable quoted in migration 0008. No external legal source is engaged by this
  diff; nothing here interprets a statute, a rail rule or a provider contract.

Assumption, unresolved and left to the coordinator: that decision 26 ("only staff_ops create
keys") is still the rule of record. The route enforces it at `app/api/mcp-keys/route.ts` line 31
and this diff does not touch it, but `docs/DECISIONS.md` was not read in this round.

## 3. Requirement matrix

| Requirement | Control / code location | Test / evidence | Verdict |
|---|---|---|---|
| The creator of an MCP key cannot decide a request raised through it, at the database, for every role | `db/migrations/0024_mcp_key_creator.sql`, fourth refusal in `enforce_maker_checker_on_approval_decision` | `check:claims-and-approvals` 11f, owner insert refused; reviewer probe: the same insert refused under the restricted `app_runtime` role | PASS |
| The same case is refused by the application first, with the same sentence | `lib/approvals/approvals.ts`, `creatorOfTheKeyThatRaised` + the fourth refusal in `decideApprovalRequest`, before `database.begin` | `check:claims-and-approvals` 11f, "THE APPLICATION refuses..." | PASS |
| The key id reaches the request row from the real MCP principal, not only from a fixture | `McpPrincipal.keyId` (non-optional, `key.id` in `principalForPresentedKey`) -> `ToolContext.principal` -> `requestClaimPaymentTool` -> `RequestChannel.keyId` -> `requestClaimPayment` -> `createApprovalRequest` | Static: the chain typechecks with `keyId: string` non-optional at the source; `npm run typecheck` clean. Not exercised over HTTP (see section 6) | PASS (static) |
| Nothing is redefined: only a nullable column is added | `alter table approval_requests add column raised_through_key_id uuid references mcp_api_keys (id)` | Diff read; no `alter ... type`, no `alter ... set/drop default`, no `update`, no `drop trigger` anywhere in 0024 | PASS |
| The 0008 body is preserved word for word | 0024 `create or replace function` | Mechanical diff of the two function bodies: the only changes are two declaration lines re-aligned, one new declaration, and the appended block. All three original refusal sentences are byte-identical | PASS |
| No applied migration file is edited | 0001 to 0021 untouched | `git diff --stat main...845443a` lists no file under `db/migrations/` except the new 0024 | PASS |
| AF-03: no UPDATE or DELETE of a money row | Diff read in full | The only `update` statements added are two negative assertions inside `expectError`, which always rolls back and whose whole point is that the statement is refused | PASS |
| Decision 26 line one is untouched | `app/api/mcp-keys/route.ts` | Not in the diff; the role gate at line 31 reads `user.role !== "staff_ops"` | PASS |
| `brokers.commission_rate_bps` and `state_tax_rates.rate_bps` carry an append-only guard | `db/migrations/0002` lines 45 and 116, `db/migrations/0004` lines 24 and 44 | Read directly. The premise of F-INT-09 ("no UPDATE or DELETE guard") is wrong on this schema | PASS |
| No code path updates or deletes those two tables | `grep -rniE "(update\|delete +from) +(brokers\|state_tax_rates)" db lib app scripts components` | Three hits, all inside the new negative assertions of `check-money-guards.ts`. `scripts/seed.ts` only inserts and refuses a non-empty table | PASS |
| The two named rate assertions can actually fail | `scripts/check-money-guards.ts` 2b | `expectError` returns `null` when nothing is raised, and `!!error` is then false, so a missing guard reports FAIL. NOT EXECUTED here (see section 6) | BLOCKED (evidence, not defect) |
| AF-05: no secret committed or printed | Both commits | `gitleaks protect --staged --redact --no-banner` on this record's commit; no connection string, password or key value appears in the diff or in any output collected. `mintKeyCreatedBy` stores the sha256 of a random uuid and no secret exists for it | PASS |
| AF-02: no simulation presented as live | Comments in 0024 and in `check-claims-and-approvals.ts` 11f | The 11f header says in its own words that no HTTP is used and why (`port 3800 belongs to another slice`); the destination string still reads `LOCAL SIMULATOR` | PASS |
| AF-06: the code can be explained line by line | `lib/approvals/approvals.ts`, 0024 | One helper, one query, one equality; the migration states the attack, the rule and why a column rather than the payload. No abstraction, no indirection, no generated SQL | PASS |

## 4. Findings

### F-GUARDSANDKEYTRIGGER-01, LOW: a key minted by the CLI script escapes the new refusal entirely

`scripts/create-mcp-key.ts` line 67 calls `createApiKey` with `createdByUserId: null`. The
fourth refusal fires on an equality and never on a null, in the trigger
(`key_creator_user_id is not null and ...`) and in `lib/approvals`
(`keyCreatorUserId !== null && ...`). So a request raised through a script-minted key is not
covered by this slice at all.

Concrete trigger: a staff_approver with shell access runs `npm run create-mcp-key` for the
staff_ops user, raises a claim payment through that key, then approves it as themselves. Both
halves of the gate are the same human and nothing refuses.

Consequence: the F-INT-01 attack survives for script-minted keys. Severity is LOW rather than
MEDIUM because minting that way needs the runtime connection string, that is server or database
access, and anyone holding it already outranks the maker-checker gate; and because the only
route that mints keys always records the creator.

Required correction, and it is the coordinator's call, not the builder's: either say in
`DECISIONS.md` and the README that a script-minted key is outside the rule and why, or record an
operator identity for script-minted keys and treat a null creator as refusing every approver.
The migration comment already names the null case honestly; what is missing is the decision.

### F-GUARDSANDKEYTRIGGER-02, LOW: requests raised before 0024 keep a null key and stay decidable by their key's creator

`raised_through_key_id` is populated at INSERT time only. Every approval request created before
0024 is applied keeps `null` there, whatever key raised it, and no backfill is legitimate:
`approval_requests` is append-only, so filling the column later would need exactly the UPDATE
that AF-03 forbids, and the only trace of the key on an old row is the prose
`MCP API key cmk_xxxxxxxx (human)` in `payload`.

Concrete trigger: any approval request raised over MCP and still undecided at the moment 0024 is
applied to the trial database can still be decided by the person who created its key.

Consequence: the rule is prospective only. This is a property of the chosen design, not a
mistake in it, but it is not stated anywhere in the diff and it changes what the coordinator
must check before deploying.

Required correction: before 0024 reaches the trial database, list the undecided approval
requests whose `payload` names an MCP key, and either decide them under the old rule knowingly or
reject and re-raise them afterwards. Record the residual in the review record of the slice.

### F-GUARDSANDKEYTRIGGER-03, LOW: every approval request breaks on the deployed database until 0024 is applied

`createApprovalRequest` now names `raised_through_key_id` in its INSERT column list. That
function is the single door for five money paths, not only for MCP: claim payments
(`lib/claims/payments.ts`), refunds (`lib/payments/refunds.ts`), endorsements
(`lib/policy/endorse.ts`), cancellations (`lib/policy/cancel.ts`) and backdated endorsement-date
corrections (`lib/policy/correct-endorsement-date.ts`). On a database where 0024 has not run,
every one of them fails with an undefined-column error at the moment the approval queue is
written.

Concrete trigger: merge and deploy this branch to Vercel before running `npm run migrate`
against the trial database. Any above-threshold money-out then throws instead of queueing.

Consequence: a submission-visible outage of the whole approval queue, and the failure appears in
paths that have nothing to do with MCP.

Required correction: the coordinator applies 0024 to the trial database before deploying this
code, and only then pushes. The README already documents `npm run migrate`; the ordering is what
needs to be respected, and it is the coordinator's gate, not a defect in the diff.

### F-GUARDSANDKEYTRIGGER-04, INFO: the 0022 and 0023 numbers are free, and a later file taking one of them could silently undo the fourth refusal

`scripts/migrate.ts` applies unapplied files in file-name order and remembers what it applied.
On the shared `corgi_test`, 0024 is applied now; a migration created later and numbered 0022 or
0023 would be applied AFTER it there, but BEFORE it on any fresh database. If such a file also
does `create or replace function enforce_maker_checker_on_approval_decision`, the two databases
end with different function bodies, and the fourth refusal disappears on the one where 0024 ran
first. Nothing in the repository detects that.

I could not check whether an in-flight slice takes 0022 or 0023: `origin` carries only `main`,
and the other builders' branches are local worktrees I must not read.

Required correction: the coordinator confirms that no in-flight migration replaces that
function, or renumbers this migration when the gap closes.

### F-GUARDSANDKEYTRIGGER-05, INFO: the two new `check:money-guards` assertions are unexecuted by anyone so far

`npm run check:money-guards` is reserved to the coordinator's ephemeral database, so neither the
builder nor this review ran the two assertions added by `7e47a9d`. Their correctness is argued
statically only: `insertFixtureRows` does return `brokers` and `state_tax_rates` ids (lines 368
and 373), `forbid_change_of_financial_record` raises a message containing `append-only`
(migration 0001 line 15), and `expectError` reports FAIL when no error is raised. The expected
count moves from 184 to 186.

Required correction: the coordinator runs the script once on the ephemeral database and records
the two new lines. Until then this evidence is BLOCKED, not PASS.

### F-GUARDSANDKEYTRIGGER-06, INFO: `0023_rate_table_guards.sql` was not written, and refusing to write it was right

The assignment asked for a migration adding append-only guards to `brokers` and
`state_tax_rates`, and asked that on `brokers` only a change of `commission_rate_bps` be refused
"because brokers has non-money columns the app may legitimately update". Both premises are
false on this schema, and I checked them myself rather than taking the builder's word:

- `brokers_are_append_only` (0002 line 45) and `state_tax_rates_are_append_only` (0002 line 116)
  already refuse UPDATE and DELETE for every role, and 0004 adds the TRUNCATE guards;
- `app_runtime` holds `select` only on both tables (0002 line 264), so the application cannot
  update a `brokers` column at all, money or not, and no code path tries to.

Writing the migration as specified would have required loosening `brokers` from fully
append-only to column-restricted, which weakens an AF-03 control to satisfy a finding whose
premise is wrong. The builder instead named the two columns in the evidence. That is the correct
call, and it is recorded here so the deviation is visible rather than silent.

Consequence for the coordinator: `docs/reviews/integration.md` F-INT-09 needs correcting, and
`docs/DECISIONS.md` decision 26 needs the note that the week-two item was brought forward. This
review does not touch `docs/` beyond this file.

### F-GUARDSANDKEYTRIGGER-07, INFO: `keyId` joins an append-only JSON payload with no format marker

`RequestChannel` gains an optional `keyId`, and `RequestChannel` is serialised into the
append-only `claim_events.payload` (`lib/claims/payments.ts` line 307) and read back at line
810. Rows written before this commit carry a channel without `keyId`; rows written after carry
one with it. No format version distinguishes them.

No meaning changed and every reader is correct today (`keyId?: string`, and the claim screen
reads only `keyPrefix`), so this is INFO, not a defect. It is recorded because the repository's
own rule for schema evolution is that a stored shape carries a version rather than changing
silently, and a later reader could mistake an absent `keyId` for a request that was not raised
through a key when in fact it predates this commit.

## 5. Attacks attempted and what they proved

- **The F-INT-01 attack itself**, replayed by section 11f of the check on a key whose
  `created_by` is the approver and whose holder is the operator: refused by the application, then
  refused again by the database under the owner role, and the request stays decidable by a
  different approver. Both refusals carry the same sentence.
- **The trigger under the restricted role.** The check proves the database refusal under the
  owner connection only, and the application refusal short-circuits before the trigger on the
  runtime path, so the trigger's own `select` on `mcp_api_keys` was never exercised as
  `app_runtime`. I inserted the decision directly with the runtime connection, inside a
  transaction that always rolls back. Result:
  `maker-checker: the person who created the key that raised this request cannot decide it
  (request 0b9233ef-...)`. The trigger is not silently failing on a missing grant, and nothing
  was persisted.
- **A different sentence winning the race.** With `requested_by` = the operator and the decider a
  `staff_approver`, refusals 1, 2 and 3 of the function all pass, so the message the check
  matches can only come from the new fourth refusal. The assertion is not passing for the wrong
  reason.
- **A weakened check.** All four new assertions in `check-claims-and-approvals.ts` and both new
  assertions in `check-money-guards.ts` report FAIL when nothing is raised or when the value is
  absent; none is a tautology.
- **A second write path into `approval_decisions`.** `grep -rn "insert into approval_decisions"
  lib app scripts` finds one application site (`decideApprovalRequest`) and check scripts. The
  trigger covers all of them regardless.
- **A second write path into `approval_requests`.** `createApprovalRequest` is the only one in
  `lib/` and `app/`; the four non-claim callers pass no `raisedThroughKeyId`, which resolves to
  null and refuses nobody.
- **An unbounded query.** Both new queries (the trigger's and `creatorOfTheKeyThatRaised`) filter
  on `approval_requests.id`, the primary key, and return at most one row.
- **A money row moved.** No `update` or `delete` against a money table exists in the diff outside
  the two rolled-back negative assertions, and the check's own final assertion still shows the
  whole journal balancing (debits 797952099 = credits 797952099).
- **A comment that overstates.** I checked the four load-bearing claims of the 0024 header
  individually: the 0008 body kept word for word (mechanically diffed), `created_by` already
  present in 0018 (line 91), `createApiKey` already filling it (`lib/mcp/keys.ts` line 116), and
  null only for the CLI script (`scripts/create-mcp-key.ts` line 67). All four hold.

## 6. Checks executed, and what was not

Executed in this worktree, at `845443a`, each once:

| Command | Result |
|---|---|
| `npm run typecheck` | PASS, no output |
| `npm test` | 474 tests, 2 suites, **473 pass, 1 skipped, 0 fail** |
| `npm run check:claims-and-approvals` | **78 PASS, 0 FAIL**, exit 0, including the four assertions of section 11f |
| Reviewer probe: the fourth refusal under the `app_runtime` role, in a rolled-back transaction | Refused with the expected sentence |
| `gitleaks protect --staged --redact --no-banner` before committing this record | no leaks found |
| `git diff main...845443a` scanned for em and en dashes | 0 and 0 |
| `grep -rniE "(update\|delete +from) +(brokers\|state_tax_rates)" db lib app scripts components` | only the two new negative assertions |

The builder's reported counts reproduce exactly: 473/1/0 on the tests and 78/0 on the check.

Not executed, and why:

- **`npm run check:money-guards`**: forbidden to me by the assignment; the coordinator proves the
  guards on an ephemeral database. The two assertions added by `7e47a9d` are therefore
  unexecuted by anyone. See F-GUARDSANDKEYTRIGGER-05.
- **`npm run check:mcp`**: it needs the application listening on `http://127.0.0.1:3800`
  (`scripts/check-mcp.ts` lines 44 and 139), and port 3800 belongs to the MCP slice. `MCP_BASE_URL`
  would let me move it above 4100, but the server would also need `DATABASE_URL_APP` overridden to
  the disposable database on its command line; getting that wrong points the run at the trial
  database, so I did not do it. The consequence is that the end-to-end HTTP path
  (a real key presented to `/api/mcp` -> `principalForPresentedKey` -> `raised_through_key_id`)
  is verified statically and not by execution. The static chain is strong: `McpPrincipal.keyId`
  is non-optional and assigned from `key.id`, and `typecheck` is clean.
- **No migration was applied by this review.** 0024 was already applied to `corgi_test` by the
  builder; I ran only the check script, exactly as instructed.
- **The trial and deployed databases were not touched or queried**, so F-GUARDSANDKEYTRIGGER-02
  and F-GUARDSANDKEYTRIGGER-03 are stated as risks the coordinator must clear, not as measured
  facts about production.
- **`docs/DECISIONS.md`, `docs/reviews/integration.md` and the README** were not read in full and
  were not touched; the coordinator owns them and owes them the updates named in
  F-GUARDSANDKEYTRIGGER-06.

Shared-database honesty: `corgi_test` is shared with other builders. I ran
`check:claims-and-approvals` exactly once and saw no contention and no foreign fixture noise; the
run committed its own rows, which is why cumulative counts in its output keep growing (605
operations, 128 claim payouts). The reviewer probe ran inside a transaction that always rolls
back and left nothing behind. `.env.local` was copied into this worktree to run the checks and is
deleted at the end of this review; no connection string, password or key value was printed by any
tool, and the one command that could have printed one was piped through a redaction filter.

## 7. Verdict

**PASS** at `845443abf3d2146c4471ee6f161bc81e9d40333d`.

No HIGH and no MEDIUM finding. Every check that this reviewer is allowed to run passed, and the
builder's reported counts reproduce exactly. The rule the slice exists to add is real at both
boundaries, and I proved the database half under the restricted runtime role as well as under the
owner role, which the builder's own evidence did not cover.

Residual limitations, all visible above and none of them a defect in this diff:
`check:money-guards` carries two unexecuted assertions (F-05); the end-to-end HTTP MCP path is
verified statically rather than by execution (section 6); script-minted keys are outside the rule
(F-01); the rule is prospective only (F-02); the migration must reach the trial database before
this code does (F-03); and the 0022/0023 numbering gap is unresolved (F-04).

Walkthrough status: **NOT REVIEWED WITH YOANN**. Nothing in this record establishes that he can
explain the fourth refusal, the join it makes, or why a null creator refuses nobody. The natural
question to put to him first is the one the code answers in one line: why comparing two user ids
was not enough.

## 8. Register lines

For the coordinator to paste into `docs/reviews/FINDINGS.md`; this review does not edit that file.

## guards-and-key-trigger round 1 (docs/reviews/backend-guards-and-key-trigger-r1.md, PASS at 845443a, 15:35 local; 78 PASS 0 FAIL on the claims check, trigger proven under both roles)

| ID | Severity | Finding | Required correction | Status |
|---|---|---|---|---|
| F-GUARDSANDKEYTRIGGER-01 | LOW | A key minted by `scripts/create-mcp-key.ts` has a null `created_by`, so a request raised through it escapes the fourth refusal | Decide and record: name the residual, or give script-minted keys an operator identity | OPEN (coordinator) |
| F-GUARDSANDKEYTRIGGER-02 | LOW | Requests raised through a key before 0024 keep a null `raised_through_key_id`; no backfill is legitimate on an append-only table | Clear the undecided MCP-raised requests before applying 0024 to the trial database | OPEN (coordinator) |
| F-GUARDSANDKEYTRIGGER-03 | LOW | `createApprovalRequest` now names a column absent from the trial database, which breaks all five approval paths, not only MCP | Apply 0024 before deploying this code | OPEN (coordinator) |
| F-GUARDSANDKEYTRIGGER-04 | INFO | 0022 and 0023 are free; a later file taking one and replacing the same function would undo the fourth refusal on databases where 0024 ran first | Confirm no in-flight migration replaces that function, or renumber | OPEN (coordinator) |
| F-GUARDSANDKEYTRIGGER-05 | INFO | The two new `check:money-guards` assertions are unexecuted by builder and reviewer alike (184 to 186 expected) | Run the script once on the ephemeral database and record the two lines | OPEN (coordinator) |
| F-GUARDSANDKEYTRIGGER-06 | INFO | `0023_rate_table_guards.sql` was not written; the premise of F-INT-09 is wrong and writing it as specified would have weakened the `brokers` guard | Correct F-INT-09 in `docs/reviews/integration.md` and note decision 26 was brought forward | OPEN (coordinator) |
| F-GUARDSANDKEYTRIGGER-07 | INFO | `keyId` joins the append-only `claim_events.payload` JSON with no format marker; absent means "old row" and "not raised through a key" alike | Note it, or version the stored channel shape when that payload next changes | OPEN (backlog) |
