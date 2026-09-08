# Independent review, slice B11: the MCP surface

Reviewer: independent reviewer sub-agent, working in the worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/agent-a407ddec8017ffa1b`, branch
`worktree-agent-a407ddec8017ffa1b`. Written at 2026-09-08T19:35:12Z.

Reviewed revision: `main` at **5f2c841**. The slice itself landed with the merge `e7d7856`; the
two follow-on commits `0fa828d` and `5f2c841` are the F-B2-20 fix and were read only where they
touch this scope (they do not). Working tree clean at review time apart from this file.

This is a scoped engineering assessment of one slice. It is not a legal certification, and it is
not a statement that the six delivery gates pass for the whole submission.

## 1. Startup receipt

Read in full, in this order, before looking at any B11 code: `CLAUDE.md`,
`AUTOMATIC-FAILS.md`, `READABLE-CODE.md`, `AGENTS.md`, `WORKFLOW-48H.md`, `REVIEWER.md`.

Then, for this scope: `docs/PLAN.md` (whole file, row B11), `docs/ARCHITECTURE.md` (sections 1,
6, 7, 8 and 9), `docs/DECISIONS.md` (the stack and provider entries, decision 15 of 14:32Z,
decision 16 of 15:12Z, decision 17 of 15:34Z, decision 18 of 16:09Z and the 18:52Z entry on the
B12 differentiator), `docs/COMPLIANCE-MATRIX.md` (whole file, row MCP-01),
`docs/reviews/FINDINGS.md` (whole register), `docs/handoffs/b11-implementation-notes.md` (whole
file), `docs/handoffs/b11-mcp-session.md` (sections 0 to 3 and the tail),
`docs/reviews/b7-claims-and-approvals.md` (matrix, findings, sections 11 and 12), `README.md`
(the MCP surface section and the money-rules section).

Code read in full: `db/migrations/0018_mcp_api_keys.sql`, `lib/mcp/key-format.ts`,
`lib/mcp/keys.ts`, `lib/mcp/scope.ts`, `lib/mcp/never-delegated.ts`, `lib/mcp/jsonrpc.ts`,
`lib/mcp/tools/tool.ts`, `lib/mcp/tools/index.ts`, `lib/mcp/tools/policy-as-of.ts`,
`lib/mcp/tools/broker-statement.ts`, `lib/mcp/tools/reconciliation-breaks.ts`,
`lib/mcp/tools/run-reconciliation.ts`, `lib/mcp/tools/claim-payment.ts`,
`app/api/mcp/route.ts`, `app/api/mcp-keys/route.ts`, `app/ops/mcp-keys/page.tsx`,
`scripts/create-mcp-key.ts`, `scripts/check-mcp.ts` (header, fixtures and the assertion bodies),
`lib/mcp/scope.test.ts`, `lib/mcp/never-delegated.test.ts`. Read in the parts that matter here:
`lib/claims/payments.ts` (the request and send paths), `lib/claims/claims.ts` (the actor
guards), `lib/approvals/approvals.ts` (the view), `lib/auth/current-user.ts`,
`app/api/session/login/route.ts`, `app/api/approvals/[requestId]/route.ts`,
`app/ops/approvals/page.tsx`, `app/ops/claims/[claimId]/page.tsx` (the payments table),
`lib/stripe.ts`, `lib/reconciliation/stripe-source.ts`, `lib/reconciliation/run.ts`,
`lib/reconciliation/read.ts`, `db/migrations/0008` (the maker-checker trigger),
`components/portal-shell.tsx`, `components/workspace-overview.tsx`, and the whole B11 merge diff
on the small touched files (`git diff e7d7856^1 e7d7856`).

Not read, and why: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`,
`GAP-REVIEW.md` (advisory catalogues; no retained control was identified for this scope beyond
what AGENTS.md already requires), `docs/STATUS.md` (read only the B11 entry), the other slice
handoffs. Absent files: none.

Acceptance criterion reviewed: `docs/PLAN.md` row B11 and `docs/COMPLIANCE-MATRIX.md` row
MCP-01. Planned checks, all executed: `npm run typecheck`, `npm test`,
`npm run check:mcp` against a local server on `corgi_test`, `npm run check:money-guards --
--database=test` (once), the deployed endpoint exercised from outside with keys I created and
revoked, and a read-only inspection of `mcp_calls` on `corgi_test`.

Nothing was pushed, nothing was deployed, no migration was applied anywhere, and no shared
planning file was edited. The demo password and every key secret stayed out of every output.

## 2. Applicability

Product: policy administration for commercial insurance in one modelled US state (California),
sold by brokers to business customers, in USD, in a sandbox. This slice adds a machine surface:
an HTTP endpoint an autonomous agent can call with a per-user API key.

Confirmed facts for this scope: the endpoint moves no money on any branch (proven below); it
reaches one external provider, Stripe in test mode, and only through slice B10's reconciliation
source; the data an agent can read is sandbox data about seeded brokers, customers and policies.

Requirements that govern this scope, and their type:

- Trial requirement (released brief, general non-negotiables, and `AGENTS.md` "Maker-checker and
  MCP"): at least three read MCP tools with authorization and tenant isolation; one write tool
  that creates a request in the human approval queue rather than moving money; documented
  operations never delegated autonomously; agents cannot approve, including through human
  endpoint impersonation or admin shortcuts; the same gate server-side across UI, direct API,
  worker, admin and MCP paths.
- Engineering safeguard (`AUTOMATIC-FAILS.md`): AF-03 (no UPDATE or DELETE on money rows, and
  the ban explicitly names MCP tools), AF-04 (sandbox only, guard applied to MCP paths), AF-05
  (no committed secrets, redacted logs), AF-06 (every line explainable).
- Provider contract: the Model Context Protocol, revision 2025-11-25 and the two earlier
  revisions the server declares. The server answers `application/json` to a POST carrying a
  request and refuses the GET stream, both of which the transport permits.

No law or regulation was identified as applying to this slice beyond what already applies to the
money paths it exposes; the agent surface adds no new customer data, no new rail and no new
provider. Unresolved: nothing material within this scope. Recorded as outside it: whether a
production deployment would need per-key scopes, key rotation and rate limiting is a production
question, not a trial deliverable.

## 3. Architecture trace

Actor to journal, following the write tool, which is the only path that touches money at all:

agent or MCP client
→ `POST /api/mcp` with `Authorization: Bearer cmk_<public>_<secret>`
→ `principalForPresentedKey` hashes the presented value with sha256 and matches `key_hash`; the
  user row is re-read on every call, so a revocation or a role change takes effect at once
→ no key, an unknown key or a revoked key: one identical 401 with no detail, one row in
  `mcp_calls` with `outcome = 'unauthorised'` and nothing from the presented value
→ `MCP-Protocol-Version` checked after authentication, so every answered POST has exactly one
  log row
→ `handleJsonRpcMessage` dispatches `initialize`, `ping`, `tools/list`, `tools/call`; a
  notification is answered 202 without running anything; an array body is refused
→ `tools/call request_claim_payment` → `claimPaymentRequesterRefusal` (staff_ops only;
  staff_approver refused so the checker is never the maker) → claim looked up by number →
  `requestClaimPayment` with `requestedThrough = { channel: "mcp", principalKind, keyPrefix }`
→ inside one transaction, under the per-claim advisory lock: claim open, bank account verified,
  the three ceilings (reserve, per-occurrence, aggregate), then the cumulative per-claim
  threshold of decision 17
→ above the threshold: an `approval_requests` row with the sha256 intent and a payload carrying
  `raised_by_agent` and `raised_through`; below it: no approval request
→ in both cases a `money_operations` row, a `money_operation_events` row with status
  `requested`, and a `claim_events` row `payment_requested` carrying `requested_through`
→ **no journal entry, no provider call, nothing on the rail**
→ the money only leaves later, through `sendClaimPayment`, which is a staff_ops session action on
  `/ops/claims/[claimId]` (or the recovery job), re-reads everything, re-checks the approval and
  the intent hash, and is exposed by no tool.

The read path is shorter: each tool calls one function of `lib/mcp/scope.ts` before it reads
anything, and those four functions are the whole authorization model. A key borrows exactly its
user's visibility; there is no second permission table to drift.

Alternate entry points inspected, and what they do with an MCP key: `/api/approvals/{id}` reads
the session cookie only and ignores the header; `/api/mcp-keys` likewise, so a key cannot mint a
key; `/ops/*` pages redirect to the login form; `/api/jobs/*` authenticate with `CRON_SECRET`
and answer 401 to a bearer MCP key. All four were exercised against the deployed application
(section 6). The login form refuses an `agent` role with the same message as a wrong password.

Trust boundaries: the key is a bearer token over HTTPS; only its sha256 is stored; the secret is
shown once, on the body of a POST answer with `no-store, no-cache, must-revalidate`, never in a
URL, never in a redirect, never in the database. The runtime role holds `SELECT, INSERT` on the
three new tables and nothing else.

## 4. Requirement matrix

| Requirement | Control and code location | Evidence from this review | Verdict |
|---|---|---|---|
| At least three read tools | `lib/mcp/tools/index.ts`: `get_policy_as_of`, `get_broker_statement`, `list_reconciliation_breaks`, plus `run_reconciliation` | `tools/list` on the deployed endpoint returned all five; three reads exercised from outside with real data | PASS |
| Authorization on the read tools | `lib/mcp/scope.ts`, called first by every tool | Deployed: a broker key read its own policy, another broker key was refused on the same policy, a customer key read the policy that covers it and was refused another customer's, a broker key was refused `list_reconciliation_breaks` and `run_reconciliation`, a customer key was refused a broker statement | PASS |
| Tenant isolation, proven with real cross-tenant calls | same | Deployed, five cross-tenant refusals (section 6.2); `check:mcp` 52/52 on `corgi_test` repeats them over HTTP; unit tests in `lib/mcp/scope.test.ts` | PASS |
| No enumeration through the refusals | `POLICY_NOT_VISIBLE`, one sentence for "not yours" and "does not exist" | Deployed: `CGP-99999` and another broker's real policy gave the identical sentence | PASS |
| One write tool that creates a request, never a money movement | `lib/mcp/tools/claim-payment.ts` → `requestClaimPayment`; no send tool, no approve tool | `corgi_test`, above the threshold: approval request created, journal unchanged, operation `requested`. `corgi_test`, **below** the threshold ($500 on a fresh claim, reviewer probe): `approvalRequestCreated false`, `approval_request_id null`, journal entries on the claim 1 before and 1 after, latest status `requested`, no rail transfer | PASS on "no money movement"; see F-B11-01 for the queue half |
| Agents cannot approve: no tool | `lib/mcp/tools/index.ts`, `lib/mcp/never-delegated.ts` | Deployed: `tools/call approve_claim_payment` answers `-32602 unknown tool` | PASS |
| Agents cannot approve: the 0008 trigger | `enforce_maker_checker_on_approval_decision` demands `staff_approver` and refuses the requester | `check:mcp`: the application refuses, then the same insert through the OWNER connection raises `maker-checker: the person who requested this money-out cannot approve it`; and for a real `'agent'` user, `only a staff_approver may decide`. `check:money-guards`: same, 184/184 | PASS |
| Agents cannot approve: the 0018 trigger | `forbid_agent_key_for_an_approver` on `mcp_api_keys` | `check:mcp` and `check:money-guards` both: an agent key for a `staff_approver` is refused by the database, a human key for one is allowed | PASS |
| The approver route accepts session cookies only | `app/api/approvals/[requestId]/route.ts` uses `currentUser()` and reads no header | Deployed: `POST /api/approvals/...` with a valid MCP key and no cookie answers 303 to `/login?error=Please+sign+in+again` | PASS |
| No direct-endpoint bypass from a key | key-only requests to `/api/mcp-keys`, `/ops/approvals`, `/api/jobs/reconcile` | Deployed: 303 to login, 307 to login, 401 | PASS |
| A request raised through MCP is marked as agent-raised on the immutable row | `requestClaimPayment` payload `raised_by_agent` / `raised_through`; `claim_events.payload.requested_through` | `check:mcp` reads back `{"raised_by_agent":true,"raised_through":"MCP API key cmk_… (agent)"}`; the reviewer probe reads back `{"channel":"mcp","keyPrefix":"cmk_…","principalKind":"agent"}` on the claim event | PASS for the record; F-B11-01 for what a human is actually shown |
| The changed-intent and self-approval rules are not reopened | intent built by `claimPaymentIntent`, identical whatever the channel; `requested_by` is the key's user | `check:mcp`: the key's own user is refused as the decider by the application and by the trigger; the intent hash carries no channel field, so an agent-raised request is approved and executed under exactly B7's rules | PASS |
| Keys: sha256 only, secret never stored or leaked | `key-format.ts`, migration 0018, `app/api/mcp-keys/route.ts` | `git grep` for a full key pattern over the tracked tree: one hit, a deliberately invalid literal in `scripts/check-mcp.ts`. Docs carry public prefixes only. Deployed: the secret is in the POST answer body with `no-store`, not in the `Location`, and is absent from `/ops/mcp-keys` afterwards | PASS |
| A revoked key answers 401 | `route.ts` refuses `principal.revokedAt !== null` | Deployed: all six reviewer keys answered 401 immediately after revocation. `check:mcp`: the three 401s are byte-identical | PASS |
| An unknown key answers 401 with no row pointing at the presented value | `api_key_id` null, `detail` "unknown key" | Read-only query on `corgi_test`: `no bearer token` 9 rows / 0 naming a key, `unknown key` 9 rows / 0 naming a key, `revoked key` 8 rows / 8 naming a key | PASS |
| Every call recorded, without payloads | `recordMcpCall`, `mcp_calls` | `check:mcp`: 30 POSTs sent, 30 rows appended, one per POST; 174 rows carry a 64-hex argument fingerprint | PASS with F-B11-02 (some caller strings do reach `detail` and `tool`) |
| AF-03 append-only guards on the three new tables | migration 0018: update/delete trigger, truncate trigger, server-set clock, `SELECT, INSERT` grant | `check:money-guards --database=test`: **184 PASS, 0 FAIL, exit 0**, including owner UPDATE/DELETE/TRUNCATE refused on all three tables, `app_runtime` lacking UPDATE/DELETE/TRUNCATE on all three, revocation possible once, and `called_at` set by the database clock rather than a client value of 2000-01-01 | PASS |
| AF-03: no tool writes into the ledger | no tool posts a journal entry; `run_reconciliation` appends runs and items only | `check:mcp`: "RUNNING THE RECONCILIATION MOVES NO MONEY: not one journal entry was posted"; the write tool likewise, above and below the threshold | PASS |
| AF-04: the sandbox assertion runs before the endpoint reaches Stripe | `fetchStripeWindow` calls `assertStripeSandbox()` first; `lib/stripe.ts` throws at import on a key that is not `sk_test_` | Code path traced end to end; `run_reconciliation` completed against the Stripe sandbox through the endpoint on `corgi_test`, so the assertion ran on the MCP path. The negative case (a live key) is not exercisable in this trial and stays NOT RUN | PASS for the guard, NOT RUN for the negative case |
| AF-05 for this slice | secret shown once, sha256 stored, prefixes only in docs, `.env.local` never committed | Repository grep above; the review record carries no secret | PASS |
| The never-delegated list exists, is returned by `tools/list`, and matches the code | `lib/mcp/never-delegated.ts`, ten operations with reasons | Deployed `tools/list` returns 10 operations under `policy`; the list is also in `initialize` instructions, on `/ops/mcp-keys` and in the README; `never-delegated.test.ts` asserts no tool is named after one | PASS |
| Rate limiting | absent, disclosed | README: "There is no rate limiting in this build." See F-B11-03 | DISCLOSED |
| AF-06: readable line by line | 12-step reading path in the handoff; the largest file is `jsonrpc.ts` at 265 lines | Section 7 | PASS |

## 5. Findings

| ID | Severity | Finding |
|---|---|---|
| F-B11-01 | MEDIUM | An agent-raised claim payment below the $1,000 threshold never reaches the human approval queue, and no screen tells the staff operator who sends it that a machine asked |
| F-B11-02 | LOW | Caller-supplied strings reach the append-only `mcp_calls` table verbatim: the `tool` column takes the client's tool name unbounded, and several refusal sentences quote an argument or a header back into `detail` |
| F-B11-03 | LOW | `run_reconciliation` is agent-callable, spends unbounded Stripe sandbox calls with no rate limiting, and its run is attributed on `/ops/reconciliation` to the key's human user with no agent marker |
| F-B11-04 | LOW | `forbid_agent_key_for_an_approver` fires on INSERT of a key only; `users.role` is a mutable column, so a later promotion to `staff_approver` would leave an agent key attached to an approver |
| F-B11-05 | LOW | Writing the call record is best effort: a failure to insert into `mcp_calls` is caught and logged to the console, and the answer is still returned, so an audited surface can answer with no row |
| F-B11-06 | LOW | Every tool advertises `additionalProperties: false` but the server validates no argument against the schema; unknown fields are silently ignored |
| F-B11-07 | LOW | A key never expires; revocation is the only end, and neither the README nor the screen says so |

### F-B11-01 MEDIUM: below the threshold, nobody is told a machine asked

**Trigger.** A `staff_ops` key held by an `agent` principal calls
`request_claim_payment` with an amount that, with what the claim has already paid and has
waiting, stays at or below $1,000.

**What happens, measured** (reviewer probe on `corgi_test`, $500 on a fresh claim with a $5,000
reserve, 2026-09-08T19:33Z): the answer is `approvalRequestCreated: false`,
`approvalRequestId: null`, `mustBeDecidedBy: null`, `moneyMoved: false`, `raisedByAgent: true`.
In the database: `approval_requests` rows for that claim = 0, `money_operations.approval_request_id`
= null, latest `money_operation_events.status` = `requested`, journal entries on the claim
unchanged (1 before, 1 after), no transfer on the rail. The agent origin **is** recorded
immutably, in `claim_events.payload.requested_through`.

**Consequence.** Two things follow. First, for these amounts the write tool creates a request
that is not in the human approval queue, which is the shape `AGENTS.md` asks for; the money still
cannot move without a human, so this is not a bypass, but it is a narrower reading of the
requirement than the sentence gives. Second, and this is the part that matters operationally:
the human who does move the money is the `staff_ops` operator clicking **Send** on
`/ops/claims/[claimId]`, and that screen shows only "requested by <the key holder's display
name>" (`app/ops/claims/[claimId]/page.tsx`, the payments table) plus, when there is an approval,
"asked by <name>". The string `raised_through` is read back and printed **only** on
`/ops/approvals` (`app/ops/approvals/page.tsx`). So below the threshold the agent marker exists
in the row and reaches no human at all, and above the threshold the sender still sees a human
name with no machine marker. Combined with the absence of rate limiting (F-B11-03), a key in a
loop can fill a claim screen with sub-threshold requests that look human-made.

**Code location.** `lib/claims/payments.ts` lines 240 to 300 (the `needsApproval` branch and the
`claim_events` payload), `app/ops/claims/[claimId]/page.tsx` lines 288 to 312,
`app/ops/approvals/page.tsx` lines 79 to 91.

**Required correction, cheapest first.** (a) Read `requested_through` back on the claim payments
view and print "Raised by an AGENT, MCP key cmk_xxxx" next to the amount, exactly as
`/ops/approvals` already does; this is the two-line fix and it closes the operational half.
(b) A money rule for Yoann, not for a delegate: whether **any** agent-raised claim payment should
create an approval request regardless of the amount. That would make the write tool always
"create a request in the human approval queue" and would cost one extra condition in
`claimPayoutNeedsApproval`'s caller. Recommended, because the threshold was chosen for humans
asking on a screen, not for a machine asking through an API.

### F-B11-02 LOW: caller strings land in a table nothing can ever clean

**Trigger.** Any authenticated call whose refusal sentence quotes the caller back, or any
`tools/call` naming a tool that does not exist.

**What happens.** `mcp_calls.tool` is written from `params.name` verbatim
(`lib/mcp/jsonrpc.ts`, the `findTool` miss branch), with no length bound and no character check;
only `detail` is truncated, to 500 characters, in `recordMcpCall`. And several refusals echo an
argument or a header into `detail`. Observed on `corgi_test` by read-only query:
`[get_policy_as_of] "no issued policy event effective on or before 2027-01-01"` (the caller's
`asOf`), `[-] "this server does not implement \"resources/list\""` (the caller's method),
`[-] "unsupported MCP-Protocol-Version \"1999-01-01\""` (the caller's header), and the row
`tool = "approve_claim_payment"` (the caller's tool name).

**Consequence.** Migration 0018 states that this table stores "never a payload, never a stack
trace, never a secret", and reasons for the unknown-key case that a presented value "could be
somebody's real secret typed into the wrong terminal". The same reasoning is not applied to tool
arguments: a caller who pastes a credential into `asOf`, into `name`, or into the protocol header
puts it into a table that has an UPDATE trigger, a DELETE trigger and a TRUNCATE trigger, so it
can never be removed. The `check:mcp` line "a logged call names the tool, fingerprints the
arguments and times itself, and **stores no argument**" asserts only that `arguments_hash` is 64
hex characters and that `duration_ms >= 0`, on a successful call whose `detail` is null; it does
not test the claim it makes.

**Code location.** `lib/mcp/jsonrpc.ts` (the unknown-tool branch and the two `refuse` calls
quoting `method`), `app/api/mcp/route.ts` (the protocol-version message),
`lib/mcp/tools/policy-as-of.ts` (`got "${asOf}"`), `lib/mcp/tools/broker-statement.ts`
(`"${month}" is not a statement month`), `lib/mcp/keys.ts` `recordMcpCall`.

**Required correction.** Store `null` in `tool` when no tool matched (the `detail` already says
"unknown tool"), or cap it; and build these refusal sentences without quoting the caller's value,
saying the expected shape instead. Then make the check assert it.

### F-B11-03 LOW: the one tool that spends provider calls, unmarked and unlimited

`run_reconciliation` is exposed to any staff key, agent-held included. It calls Stripe through
three paginated listings and took 8.5 seconds for a one-day window on the sandbox during
`check:mcp`. There is no rate limiting anywhere in this build (`app/api/mcp/route.ts` says so and
the README discloses it). `runAllSources` is given `runByUserId: context.user.id`, so
`/ops/reconciliation` prints "Run by <the key holder's name>" and an operator cannot tell a
machine-launched run from a human one; the only trace is the `mcp_calls` row, which nothing links
to the run. The tool moves no money and every run is append-only, so this is LOW.

**Assessment asked for by the assignment.** Absent rate limiting is **acceptable for a sandbox
trial and is honestly disclosed**, on two conditions that hold here: every call is recorded and a
key is revoked in one click. It is a finding only for this tool, because it is the one that
reaches a third party. Recommendation, and it is the builder's open decision 1 for Yoann: either
restrict `run_reconciliation` to `human` principals, or mark the run as agent-launched so the
reconciliation screen shows it.

### F-B11-04 LOW: the agent-key rule is checked once, at creation

`forbid_agent_key_for_an_approver` is a `before insert` trigger on `mcp_api_keys`. `users` is a
mutable table (ARCHITECTURE section 1). If a user holding an agent key were later given the role
`staff_approver`, nothing would re-check the pair. No code path in the repository updates
`users.role` today (grep: none), so this is theoretical; it becomes real the day an admin screen
or a support script changes a role. `AGENTS.md` asks that agents be blocked "including through
admin shortcuts", which is what makes it worth writing down. Correction: the same check as a
trigger on `users`, or a documented rule that a role change revokes that user's keys.

### F-B11-05 LOW: the audit row is best effort

`logCall` in `app/api/mcp/route.ts` wraps `recordMcpCall` in a try/catch that writes to the
server console and swallows. The comment explains the intent (writing the log must never be the
reason a caller gets an error), and it is a defensible tradeoff for a read tool. For the write
tool and for the 401s it means the surface can answer without leaving the row the migration
promises. Correction, if it is wanted: fail the write tool closed when its own call record cannot
be written, or count the failures on a screen.

### F-B11-06 LOW: a closed schema that nothing closes

Every tool declares `additionalProperties: false`, and `never-delegated.test.ts` says the point is
that "a client cannot smuggle a field a later version might read". The server never validates
arguments against the schema: each tool reads its named fields with `requiredText`,
`optionalText` and the two number helpers, and ignores everything else. That is safe today
precisely because no tool reads an unnamed field, so the schema is a promise to the client rather
than a control. Worth one sentence in the notes, or a small validation step, so a future tool
cannot rely on a guarantee that is not enforced.

### F-B11-07 LOW: keys do not expire

There is no expiry column and no rotation. A key lives until somebody revokes it on
`/ops/mcp-keys`. That is a reasonable v0 choice, and the screen shows the last call and the call
count so an unused key is visible; it is not stated as a limitation in the README next to the
rate-limiting sentence, and it should be.

### Items evaluated and deliberately not findings

- **The hand-written JSON-RPC subset instead of the SDK.** The reason given in
  `lib/mcp/jsonrpc.ts` is accurate: the SDK's streamable HTTP transport wants Node's
  `ServerResponse`, and a Next.js route handler returns a web `Response`. 265 readable lines
  against an adapter of comparable size is the right call for AF-06. The revisions it accepts and
  the two things it refuses (the GET stream, batching) match the specification it names.
- **Answering `application/json` rather than opening an SSE stream.** Permitted by the transport
  for a POST carrying a request.
- **A revocation as a row rather than a nullable column.** Forced by the append-only triggers and
  better besides: it records who revoked and when.
- **`principal_kind` on the key rather than on the user.** Correct: a key must borrow a real
  user's visibility, and re-roling a user to `agent` would take that visibility away.
- **CSRF on the two form routes.** The session cookie is `SameSite=Lax`, so a cross-site form
  POST carries no cookie. Not a gap.
- **`request_claim_payment` looks a claim up by number with no visibility filter.** Safe because
  `claimPaymentRequesterRefusal` has already restricted the caller to `staff_ops`, who sees every
  claim. Noted so that a future widening of that scope does not silently open it.
- **`scripts/create-mcp-key.ts` can create a key for any user.** It needs the runtime database
  URL, which is equivalent to owning the deployment. Using the runtime role rather than the owner
  is the right choice and is explained in the file.
- **The prefix `keyPrefixOf` bug the builder found and fixed** (splitting on the last underscore
  when base64url contains underscores) is genuinely fixed: `key-format.ts` takes the first two
  segments, and the prefix written to a log always comes from the matched row.

## 6. Checks executed, with results

### 6.1 On `corgi_test` and locally

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | exit 0 |
| Unit and integration tests | `npm test` | 404 tests, **403 pass, 0 fail, 1 skipped** (the skipped one is B3's live KYB test) |
| The MCP surface over HTTP | `MCP_BASE_URL=http://127.0.0.1:3811 npm run check:mcp`, against a dev server pointed at `corgi_test` | **52 of 52 PASS**, exit 0, "ALL CHECKS PASSED". Run **once**, as instructed |
| Append-only guards | `npm run check:money-guards -- --database=test` | **184 PASS, 0 FAIL, exit 0**. Run **once**, as instructed. No deadlock this time: the TRUNCATE contention the builder met on the shared database did not recur. It covers 18 privilege and trigger assertions on the three new tables plus six shape assertions, including "an AGENT MCP key cannot be created for a staff_approver", "a HUMAN MCP key for a staff_approver is allowed", "an MCP key can be revoked only once", "a user with the role 'agent' exists and CANNOT decide a money-out", and "an MCP call is timed by the database, not by the caller" |
| Sub-threshold write, reviewer probe | one HTTP `tools/call` with `amountCents: 50000` on a claim created for it, then the database read back | `approvalRequestCreated false`, `approvalRequestId null`, `moneyMoved false`, `raisedByAgent true`; 0 approval requests, `approval_request_id` null, status `requested`, journal 1 before / 1 after, `requested_through` recorded on the claim event. Key revoked, then answers 401 |
| The call log, read only | `select` over `mcp_calls` on `corgi_test` | 249 rows; `no bearer token` 9 / 0 naming a key, `unknown key` 9 / 0, `revoked key` 8 / 8; 174 rows carrying a 64-hex fingerprint; 14 distinct refusal sentences, three of which quote the caller (F-B11-02) |
| Secret scan of the tracked tree | `git grep -nE 'cmk_[0-9a-f]{8}_[A-Za-z0-9_-]{20,}'` | one hit, the deliberately invalid literal in `scripts/check-mcp.ts`. Documents carry public prefixes only |

Everything above ran against `corgi_test` or a local dev server pointed at it. No migration was
applied. Nothing was updated or deleted anywhere; every row this review created is an INSERT.

### 6.2 Against the deployed application, from outside

`https://corgi-work-trial-iota.vercel.app`, signed in as `ops@example.com` on `/ops/mcp-keys`.
Six keys were created for this review and **all six were revoked before it ended**:
`cmk_b03b5d79` ("B11 reviewer", human), `cmk_3406a68e` (broker), `cmk_c83341c2` (another broker),
`cmk_3d521874` (customer), `cmk_824766ae` (cross-broker), `cmk_7e21871d` (staff). Each answered
401 immediately after its revocation. `request_claim_payment` was **not** called on production, as
instructed; `run_reconciliation` was not either, since it is not a read tool and spends provider
calls.

Protocol and transport:

- `initialize` 200, protocol `2025-06-18` negotiated, server `corgi-policy-admin`, capabilities
  `{"tools":{}}`.
- `tools/list` 200, the five tools, and 10 never-delegated operations under `policy`.
- `tools/call approve_claim_payment` → `-32602 unknown tool "approve_claim_payment"`.
- `GET /api/mcp` → 405 with `Allow: POST`. A batch body → `-32600` with the sentence saying so.
  An unknown `MCP-Protocol-Version` → 400.
- No key → 401 `{"error":"unauthorized"}`. A wrong key → the identical 401. A revoked key → the
  identical 401.

Read tools, with real deployed data:

- `get_policy_as_of("CGP-01707", "2028-06-01")` with the staff key: issued, annual premium
  `{cents 120000, "$1,200.00"}`, tax `{2820, 235 bp}`, fee `{2500}`, two coverage lines, no
  endorsement.
- `get_broker_statement` with the staff key naming Redwood and `2026-09`: revision 3, net due
  `$389.35`, hash `799dcbe10d49`, format version 2.
- `list_reconciliation_breaks` with the staff key: 20 open breaks, the first the `$100.00`
  provider-only Stripe probe, open for 1 hour; four clearing balances, all zero; the recent runs
  listed with their status.

Tenant isolation, five real cross-tenant calls:

| Call | Answer |
|---|---|
| Redwood's broker key on Redwood's policy `CGP-01707` | OK, broker "Redwood Commercial Brokers" |
| Another broker's key on the same policy | REFUSED "no policy with that number is visible to this key" |
| The same key on `CGP-99999`, which does not exist | the identical sentence |
| The covered customer's key on `CGP-01707` | OK, insured "Bay Area Fabrication LLC" |
| The same customer's key on `CGP-01062`, another customer's policy | REFUSED, identical sentence |
| Another broker's key naming Redwood's broker id for `2026-09` | REFUSED `a broker key can only read its own statements; pass "me"` |
| A staff key naming the same broker and month | OK, revision 3, `$389.35` |
| A customer key on `get_broker_statement` | REFUSED, "only a broker or staff can read a broker statement" |
| A broker key and a customer key on `list_reconciliation_breaks` | REFUSED, "only staff can read reconciliation breaks" |
| A broker key on `run_reconciliation` | REFUSED, "only staff can run the reconciliation job" |
| A broker key and a customer key on `request_claim_payment` | REFUSED, "only staff operations can ask for a claim payment" |
| A staff key passing `"me"` for a statement | REFUSED, "a staff key has no broker of its own" |

Bypass attempts with a valid MCP key and no session cookie:

| Attempt | Answer |
|---|---|
| `POST /api/approvals/{uuid}` with `decision=approved` | 303 → `/login?error=Please+sign+in+again` |
| `POST /api/mcp-keys` action=create (mint a key with a key) | 303 → `/login?error=Please+sign+in+again` |
| `GET /ops/approvals` | 307 → `/login` |
| `POST /api/jobs/reconcile` | 401 |

Key handling on the deployed screen: creating answers 200 with the secret in the body and
`cache-control: no-store, no-cache, must-revalidate`, with no redirect and therefore no URL
carrying it; revoking answers 303 → `/ops/mcp-keys?revoked=1`; revoking twice answers 303 with
"this key was already revoked"; the key stays on the list marked revoked; the secret appears
nowhere on the screen afterwards.

### 6.3 Checks not executed, and why

- **A real MCP client handshake.** I spoke the protocol with `fetch`, in the shapes a client
  sends, and read the answers back; no Inspector, Claude Desktop or SDK client completed its own
  negotiation against the deployed endpoint. This is the builder's stated largest gap and it is
  still open. It is the B12-1 rehearsal item (decision of 18:52Z).
- **`request_claim_payment` on the deployed database.** Deliberately left to the coordinator's
  debrief rehearsal, as instructed. Proven on `corgi_test` instead, above and below the
  threshold.
- **The AF-04 negative case.** A live-mode key cannot be used in this trial, so "a live key fails
  closed" stays NOT RUN; the guard itself is `lib/stripe.ts`, which throws at import, plus
  `assertStripeSandbox` before the listing.
- **Concurrency through the endpoint.** Two simultaneous `request_claim_payment` calls were not
  run. B7 proves the per-claim advisory lock and `check:claims-and-approvals` covers it; this
  slice adds no new concurrency path, since the tool calls that same function.
- **`run_reconciliation` over a large window.** Not timed beyond the one-day run.
- **Load, and any behaviour under many keys.** Out of scope, and there is no rate limiting to
  test.
- **`npm run build`.** Not rerun: `typecheck` passed, the builder and the coordinator both ran it
  on the merged tree, and nothing in this scope changed since.
- **`check:claims-and-approvals`.** Not rerun; unchanged by this slice, and the parts that matter
  here are re-proven by `check:mcp`.

## 7. Readability, AF-06

The reading path in the handoff is real and it works: `key-format.ts` (88 lines) explains what a
key is; `scope.ts` (98 lines) is the whole authorization model as four functions that return a
sentence or null; `never-delegated.ts` is a list with reasons; `jsonrpc.ts` (265 lines) is the
protocol with a header saying what is deliberately absent; each tool is one file. Money figures
are `{ cents, formatted }` everywhere, so an agent cannot read dollars as cents. Names carry
units and purpose. The migration explains why three tables that hold no money carry the money
guards, and why a revocation is a row.

Three places a panel will point at, and what the answer is:

1. **"Show me where an agent is stopped from approving."** Four places, and Yoann should name
   them in this order: there is no tool (`lib/mcp/tools/index.ts`); the approve route reads the
   session cookie and never a header (`app/api/approvals/[requestId]/route.ts`); the 0008 trigger
   demands `staff_approver` and refuses the requester; the 0018 trigger refuses to create an
   agent key for an approver at all.
2. **"What does your write tool do to the ledger?"** Nothing. It inserts a money operation, an
   operation event with status `requested`, a claim event, and above the threshold an approval
   request. Journal entries are posted by `sendClaimPayment`, which no tool exposes.
3. **"How does a key become a user?"** `principalForPresentedKey`: sha256 of the presented value,
   matched against `key_hash`, joined to `users`, with the revocation left-joined so a revoked key
   is recognised and refused rather than not found.

No opaque abstraction, no hidden side effect and no financial formula was introduced by this
slice: it reuses B7's, B9's and B10's functions unchanged. The one thing worth simplifying is
noted as F-B11-02, and it is a message, not a structure.

## 8. AF-01 to AF-06 for this scope

| Rule | Status | Evidence |
|---|---|---|
| AF-01 accessible deployed URL | PASS for this scope | the endpoint and `/ops/mcp-keys` exercised from outside the development session, section 6.2 |
| AF-02 no simulation presented as live | PASS | the surface is real, not simulated; the README adds no integration slot for it; `run_reconciliation` labels the claim rail as LOCAL SIMULATOR in its own description |
| AF-03 no UPDATE or DELETE on money rows | PASS | `check:money-guards` 184/0; no tool posts or mutates a journal entry; the three new tables carry the same guards |
| AF-04 sandbox only | PASS for the guard, NOT RUN for the negative case | `assertStripeSandbox` before the listing, `sk_test_` enforced at import; the MCP path exercised the guard for real |
| AF-05 no committed secrets | PASS | repository grep, prefixes only in docs, secret shown once with `no-store`, `.env.local` ignored and never committed; this record carries no secret |
| AF-06 explainable line by line | PASS technically, walkthrough NOT DONE | section 7; the human walkthrough is not this reviewer's to certify |

## 9. Verdict

**B11 scope at `5f2c841`: PASS**, with one MEDIUM to close before submission.

The brief's MCP non-negotiables are met and, where it matters, proven rather than argued: three
read tools with authorization and tenant isolation, demonstrated with real cross-tenant calls
against the deployed application and not only in a test database; one write tool that moves no
money on either side of the threshold, demonstrated with the journal counted before and after in
both cases; agents cannot approve, closed at four doors of which two are database triggers
exercised through the most privileged connection there is; a written never-delegated list that
the surface itself returns and that no tool contradicts; keys stored as sha256 with the secret
shown once, a revoked key answering an identical 401, and no full key anywhere in the repository
or the documents; and append-only guards on the three new tables at 184 PASS with 0 FAIL.

F-B11-01 is a MEDIUM and not a FAIL because no money can move from an agent call on any branch,
because the threshold behaviour is the same for a human maker and is Yoann's recorded decision 17,
and because the agent origin is recorded immutably on the row. What is missing is that the fact
never reaches the human who completes the movement. That is cheap to fix and it should be fixed
before the debrief, where the live agent demonstration (decision of 18:52Z) will put exactly this
screen in front of a panel. The second half of F-B11-01, whether an agent-raised payment should
always queue regardless of amount, is a money rule and belongs to Yoann, not to a delegate.

Residual limitations of this review: no real MCP client has completed its own negotiation against
the endpoint; the write tool was not exercised on the deployed database, by instruction; the
AF-04 negative case cannot be run in a trial that forbids live keys; concurrency through the
endpoint was not tested, and rests on B7's evidence for the function underneath; `corgi_test` is
shared, so the aggregate counts in `mcp_calls` include other agents' runs and only the deltas
this review measured are its own.

**Candidate walkthrough status: NOT REVIEWED WITH YOANN.**

## 10. Register lines for the coordinator to copy into `docs/reviews/FINDINGS.md`

| ID | Sev | Finding (one line) | Fix | Status |
|---|---|---|---|---|
| F-B11-01 | MEDIUM | An agent-raised claim payment at or below $1,000 creates no approval request, and the claim screen where a staff operator clicks Send shows only the key holder's human name: the "raised by an agent" fact is printed on /ops/approvals only, so below the threshold no human is ever told a machine asked | Print `requested_through` on the claim payments table; and a decision for Yoann: make any agent-raised claim payment queue regardless of the amount | OPEN |
| F-B11-02 | LOW | Caller-supplied strings reach the append-only `mcp_calls` verbatim: `tool` takes the client's tool name unbounded, and refusals quote `asOf`, the method and the protocol-version header into `detail`, in a table that can never be updated or truncated | Store null for an unknown tool or cap it; word the refusals without quoting the caller; make check:mcp assert it | OPEN |
| F-B11-03 | LOW | `run_reconciliation` is agent-callable, spends unbounded Stripe sandbox calls with no rate limiting (disclosed), and its run is attributed on /ops/reconciliation to the key holder's name with no agent marker | Yoann's call: restrict it to human principals, or mark the run as agent-launched | OPEN (builder decision 1) |
| F-B11-04 | LOW | `forbid_agent_key_for_an_approver` is an INSERT trigger on the key only, and `users.role` is mutable, so a later promotion to staff_approver would leave an agent key on an approver (no code path changes a role today) | Same check as a trigger on users, or a documented rule that a role change revokes that user's keys | OPEN |
| F-B11-05 | LOW | A failure to write the `mcp_calls` row is swallowed and the answer is still returned, so an audited surface can answer with no record | Fail the write tool closed when its own call record cannot be written, or surface the failures | OPEN |
| F-B11-06 | LOW | Every tool advertises `additionalProperties: false` but nothing validates arguments against the schema; unknown fields are silently ignored | Validate at the tool boundary, or say in the notes that the closed schema is a promise to the client and not a control | OPEN |
| F-B11-07 | LOW | An MCP key never expires; revocation is the only end, and neither the README nor the screen says so | One sentence next to the rate-limiting disclosure | OPEN |
