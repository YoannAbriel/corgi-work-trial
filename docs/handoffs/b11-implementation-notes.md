# Slice B11 implementation notes (the MCP surface)

Written by the B11 delegate on 2026-09-08. Branch `worktree-agent-a0f8e7758a0bbff1b`, worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/agent-a0f8e7758a0bbff1b`, four commits
on top of `6fd5ff4`. Nothing was pushed, nothing was deployed, no shared planning file was edited.

Companion document: `docs/handoffs/b11-mcp-session.md`, a sanitized curl session the coordinator
can replay call by call.

## 1. Startup receipt

Read in full before writing any code: `CLAUDE.md`, `AUTOMATIC-FAILS.md`, `READABLE-CODE.md`,
`AGENTS.md`, `WORKFLOW-48H.md`, `REVIEWER.md`, `docs/ARCHITECTURE.md` (sections 1 to 9, with 4, 6
and 7 in detail), `docs/DECISIONS.md` (every entry, in particular 16 on the reconciliation tool
and 17 on the cumulative per-claim threshold, plus the maker-checker entries of 08:04Z and
15:34Z), `docs/reviews/FINDINGS.md`, `docs/PLAN.md` (row B11),
`docs/handoffs/b7-implementation-notes.md`, `docs/handoffs/b9-implementation-notes.md`,
`docs/handoffs/b10-implementation-notes.md`. `docs/STATUS.md` read as the head plus the last
sections (the file is 33 KB of history).

Existing code read in full: `lib/auth/session.ts`, `lib/auth/current-user.ts`,
`lib/jobs/authorize.ts`, `lib/claims/payments.ts`, `lib/claims/claims.ts` (the actor and lock
parts), `lib/approvals/approvals.ts`, `lib/approvals/intent.ts`, `lib/statements/read.ts`,
`lib/statements/run.ts`, `lib/statements/compute.ts` (the month and format-version functions),
`lib/reconciliation/read.ts`, `lib/reconciliation/run.ts`, `lib/reconciliation/window.ts`,
`lib/reconciliation/breaks.ts`, `lib/documents/policy-as-of.ts`, `lib/documents/from-database.ts`,
`lib/documents/policy-snapshot.ts`, `lib/policy/read.ts` (its exports), `lib/money/cents.ts`,
`lib/http/path-ids.ts`, `db/client.ts`, `lib/stripe.ts`, `db/migrations/0001`, `0002` (the users
table), `0008` (the maker-checker trigger), `0011`, `0012`, `0013`, `0016`,
`app/api/jobs/reconcile/route.ts`, `app/api/jobs/authorize`, `app/api/approvals/[requestId]`,
`app/api/policies/[policyId]/documents/[document]`, `app/api/session/login`, `app/ops/page.tsx`,
`app/ops/approvals/page.tsx`, `app/ops/reconciliation/page.tsx`,
`scripts/check-claims-and-approvals.ts`, `scripts/check-money-guards.ts`, `scripts/migrate.ts`,
`scripts/seed.ts`, `package.json`, `.gitignore`, `.githooks/pre-commit`.

Not read: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`,
`GAP-REVIEW.md` (advisory catalogues, outside this slice), `docs/COMPLIANCE-MATRIX.md`,
`docs/ATTACK-PLAN.md`. Absent files: none of the mandatory files were missing. `.env.local` was
copied from the main checkout into the worktree and never printed, logged or committed.

Provider documentation consulted: the MCP specification revision 2025-11-25 (basic/transports,
basic/lifecycle, server/tools, schema), through Context7, on 2026-09-08. No provider call is added
by this slice; `run_reconciliation` reaches Stripe only through slice B10's existing source, which
carries its own sandbox assertion.

Acceptance criterion worked on: `docs/PLAN.md` row B11. Planned checks, all executed:
`npm run typecheck`, `npm run build`, `npm test`, `npm run migrate -- --database=test`, the new
`npm run check:mcp` over HTTP, `npm run check:money-guards -- --database=test` and
`npm run check:claims-and-approvals`.

## 2. What was built

A **streamable HTTP MCP endpoint inside the Next.js application**, `POST /api/mcp`, JSON-RPC 2.0,
authenticated by a per-user API key carried as a bearer token. Five tools: three that only read,
one that runs the reconciliation job (which moves no money), and one write tool that can only put
a claim payment into the human approval queue of slice B7.

**No new dependency.** The official TypeScript SDK's streamable HTTP transport is built around
Node's `IncomingMessage`/`ServerResponse` and wants to own the response stream; a Next.js route
handler is given a web `Request` and must return a web `Response`, so bridging them is more code
than the protocol itself. What a tools-only server needs is `initialize`, `tools/list`,
`tools/call`, `ping` and one notification, all over one POST. That is `lib/mcp/jsonrpc.ts`, 265
lines including the comments, and it is testable and explainable line by line. The assignment
allowed either; this is the deviation it asked to be stated.

**The endpoint answers `application/json`, never an SSE stream**, which the specification permits
for a POST carrying a request, and it keeps **no session** (`Mcp-Session-Id` is never issued): the
API key identifies every call on its own. `GET` and `DELETE` are refused with 405 and the reason.

**Three append-only tables** (migration 0018), with the same three guards and the same
`SELECT, INSERT` grant as every protected table: `mcp_api_keys`, `mcp_key_revocations`,
`mcp_calls`. **Revoking is inserting a row**, because nothing here can be updated: "revoked" is
read as the existence of a revocation row, exactly as "resolved" is read for a reconciliation
break. That is the simplest append-only shape and it also records who revoked, and when, which an
overwritten column could not.

**An agent principal can never approve, and now that is provable four ways over.** Migration 0018
widens the `users.role` CHECK with `'agent'`, which is the promise migration 0008 wrote down; the
maker-checker trigger demands exactly `staff_approver`, so it refuses that role, and
`decideApprovalRequest` refuses it earlier with a sentence. A new trigger refuses to create an
agent-held key for a `staff_approver` at all, so an agent never holds an approver's visibility.
And the surface exposes no approve tool: `/api/approvals` reads session cookies and never an
Authorization header.

**A request raised through MCP says so on the immutable row.** `requestClaimPayment` gained one
optional field, `requestedThrough`, carried into the approval request payload and the claim event.
`/ops/approvals` prints **Raised by an AGENT** and the key prefix above the two buttons.

## 3. The reading path for Yoann, file by file

Read in this order. One sentence each.

1. `db/migrations/0018_mcp_api_keys.sql` - the three tables, why they are append-only although
   they hold no money, why a revocation is a row, and the two rules that are database facts.
2. `lib/mcp/key-format.ts` - **read this first if you only read one**: what a key looks like, why
   it has a public half and a secret half, and what is stored (a sha256, never the secret).
3. `lib/mcp/keys.ts` - the same subject against the database: presented key to principal, create,
   revoke, list, and one row per call.
4. `lib/mcp/scope.ts` - what a key may see, as four small functions that return a refusal
   sentence or null. This is the whole authorisation model.
5. `lib/mcp/never-delegated.ts` - the ten operations no tool exposes, each with its reason.
6. `lib/mcp/jsonrpc.ts` - the protocol: five methods, what is deliberately not implemented, and
   why a refusal comes back as a tool error rather than as a protocol error.
7. `app/api/mcp/route.ts` - the four things the route does: authenticate, parse, dispatch, log.
8. `lib/mcp/tools/tool.ts` - what a tool is, and the two rules every answer follows (integer
   cents plus a formatted string, and a `whatThisMeans` sentence).
9. `lib/mcp/tools/policy-as-of.ts`, `broker-statement.ts`, `reconciliation-breaks.ts`,
   `run-reconciliation.ts`, `claim-payment.ts` - one file per tool, in that order. The last one
   is the only write.
10. `app/ops/mcp-keys/page.tsx` and `app/api/mcp-keys/route.ts` - the staff screen and its two
    actions, including why creating a key answers with a page and not a redirect.
11. `scripts/create-mcp-key.ts` - the same thing from a terminal, and why it uses the runtime
    role rather than the owner connection.
12. `scripts/check-mcp.ts` - the proof, end to end, over HTTP.

## 4. The five tools, with a call and an answer each

Every answer is trimmed here; the full ones are in `docs/handoffs/b11-mcp-session.md`.

**`get_policy_as_of(policyNumber, asOf?)`** - the policy as it stood on a business date, rebuilt
from `policy_events` by the same two functions the declarations PDF uses.

```
{"name":"get_policy_as_of","arguments":{"policyNumber":"CGP-04084","asOf":"2028-03-01"}}
-> status "issued", annualPremium {cents 120000, "$1,200.00"}, premiumTax {2820, rateBasisPoints 235},
   policyFee {2500}, two coverage limits, endorsementsApplied [], whatThisMeans "On 2028-03-01, ..."
```

**`get_broker_statement(brokerId|"me", month, revision?)`** - the stored run: lines, totals, hash,
knowledge cutoff, format version, and whether it is provisional.

```
{"name":"get_broker_statement","arguments":{"brokerId":"me","month":"2028-03"}}
-> revision 1, contentHash "a3e42bba...", formatVersion 2, provisional true,
   totals {cashCollected 125320, premiumCollected 120000, commissionEarned 18000, netDue 18000},
   two lines each naming its journal entry
```

**`list_reconciliation_breaks(source?)`** - the open breaks of the latest complete run of each
source, with age and meaning, the four clearing balances, and the recent runs (failed ones
included, because a failed run is not "zero breaks"). Staff only.

```
{"name":"list_reconciliation_breaks","arguments":{"source":"claims_rail"}}
-> openBreakCount 36, breaks[0] {classification "provider_only", providerAmount -90000,
   openFor "3 hours", meaning "the provider shows a settled claim payout ... no cash movement"},
   clearingBalances [premium_receivable 207954, refund_payable 23691974, ...]
```

**`run_reconciliation(windowDays?)`** - runs both sources for a window ending now and answers the
run ids and counts. Staff only. Moves no money (decision 16).

```
{"name":"run_reconciliation","arguments":{"windowDays":1}}
-> runs [{runId, source "stripe", status "complete", counts, breaks}, {source "claims_rail", ...}],
   moneyMoved false
```

**`request_claim_payment(claimNumber, amountCents)`** - the only write tool. `staff_ops` keys only.

```
{"name":"request_claim_payment","arguments":{"claimNumber":"CLM-02338","amountCents":120000}}
-> approvalRequestCreated true, approvalRequestId "c39d1b73-...", moneyMoved false,
   mustBeDecidedBy "a user with the role staff_approver, who cannot be <requester> (the requester)",
   raisedByAgent true, thresholdUsed 100000
```

## 5. The never-delegated list, and where it is visible

`lib/mcp/never-delegated.ts` holds ten operations with their reasons: approve or reject a
money-out, send a claim payment, issue or re-issue a refund, bind a policy, cancel a policy, void
or correct, run or publish a statement, change a KYB status, create or revoke an API key, replay a
webhook or write into the ledger directly. It is returned by `tools/list` under `policy`,
summarised in the `initialize` instructions (which is what a client shows the model), printed on
`/ops/mcp-keys`, and asserted by a unit test that no tool is named after one of them.

**Text for the README, for the coordinator to place (this delegate does not edit README.md):**

> ### MCP surface
>
> `POST /api/mcp` is a streamable HTTP MCP endpoint (JSON-RPC 2.0) authenticated by a per-user API
> key: `Authorization: Bearer <key>`. A key is created by staff on `/ops/mcp-keys` or with
> `npm run create-mcp-key -- --email=<demo user> --label="<what it is>" --kind=agent|human`; the
> secret is shown once and only its sha256 is stored. A wrong or revoked key answers 401 with no
> detail. Every call is recorded in `mcp_calls`. There is no rate limiting in this build.
>
> Tools: `get_policy_as_of`, `get_broker_statement`, `list_reconciliation_breaks` (read),
> `run_reconciliation` (appends a comparison run, moves no money) and `request_claim_payment`,
> which only puts a payment into the human approval queue.
>
> **Never delegated to an agent:** approving or rejecting a money-out, sending a claim payment,
> issuing a refund, binding a policy, cancelling a policy, voiding or correcting, running or
> publishing a broker statement, changing a KYB status, creating or revoking an API key, replaying
> a webhook or writing into the ledger directly. An agent principal is refused as an approver by
> the application and by a database trigger, and an agent-held key cannot be created for a
> `staff_approver` at all. A request raised through the MCP endpoint is marked as agent-raised on
> the approval queue so the human approver sees it before deciding.

## 6. Deviations from the assignment, and why

- **No MCP SDK, the JSON-RPC subset is hand-written.** Reason in section 2. The assignment allowed
  this explicitly and asked for it to be stated.
- **`revoked_at` is not a column on the key; it is a row in `mcp_key_revocations`.** The
  assignment offered both shapes and asked for the simplest append-only one. A nullable column
  written once is not writable at all here: `app_runtime` has no UPDATE on the table and a trigger
  refuses it even for the owner, so a revocation had to be an INSERT somewhere. A row also carries
  who revoked and when.
- **`mcp_calls.api_key_id` is set for a revoked key, not only for a valid one.** A revoked key
  still being used is exactly what an operator wants to see. An unknown key stores nothing from
  the presented value: it could be somebody's real secret typed into the wrong terminal.
- **The `agent` marker is on the KEY, not on the user.** The assignment offered either. A key must
  be scoped to what its user may see, and re-roling a user to `agent` would take that scope away;
  so `principal_kind` says who holds the key, while the user says what it can see. The role
  `'agent'` was added anyway, because migration 0008 promised it and because it lets the trigger
  refusal be exercised for real rather than argued about.
- **`get_policy_as_of` reads `policies` and `policy_events` with its own small query** rather than
  reusing the document route's. The two are five lines of SQL each and go through the same two
  pure functions; sharing them would have meant editing
  `app/api/policies/[policyId]/documents/[document]/route.ts`, which slice B8 is working in.
  Worth revisiting after the B8 merge.
- **The clearing balances are computed in this slice** (`lib/mcp/tools/reconciliation-breaks.ts`)
  rather than read from a shared function, because finding F-B10-03 (the account-level clearing
  list on the screen) was dispatched to the B10 builder and is not merged. **If that fix lands
  with a shared reader, this query should be replaced by it.**
- **`lib/claims/payments.ts` gained one optional field** (`requestedThrough`) and
  `lib/approvals/approvals.ts` two read-only fields on its view. Both were needed for "the
  approver sees it was raised by an agent"; neither changes any money rule.
- **`UserRole` gained `'agent'`**, which forced two actor types (`CancellationActor`,
  `EndorsementActor`) that spelled the four roles out to use `UserRole` instead. Both check with
  allowlists, so the new role is refused by default. An `'agent'` user cannot sign in
  (`app/api/session/login/route.ts`).
- **The old money-guards assertion "an 'agent' principal cannot be created today" was rewritten**
  rather than deleted: it was true of the schema when B7 wrote it and is false now on purpose. It
  now asserts what 0018 intends, and the refusal it cared about is proved twice in section 11 of
  the same script.
- **The protocol-version header is checked after authentication**, so that every POST this
  endpoint answers has exactly one row in `mcp_calls`. Checking it first would have let an
  unauthenticated caller get a 400 that nothing recorded.

## 7. Decisions the coordinator must put to Yoann

1. **`run_reconciliation` is exposed to an agent, and it calls Stripe.** It moves no money, and it
   is Yoann's own suggestion (decision 16), but it is the one tool an agent can use to make the
   application spend a provider call. There is no rate limiting in this build, so an agent in a
   loop could list the Stripe sandbox repeatedly. Options: leave it (every call is logged and the
   key can be revoked in one click), or restrict it to `human` principals. **Not decided by this
   delegate.**
2. **An MCP key inherits its user's whole visibility.** A staff key can read every policy, every
   statement and every break, because the staff user can. If a narrower agent scope is wanted
   ("this key may read policies but not statements"), it is a per-key allowlist column and half a
   day of work; it is not in this build.
3. **Rate limiting is out of scope**, as the assignment said. Worth one sentence in the README's
   limitations if the coordinator agrees.
4. **Which demo keys the trial database should carry**, and who holds the secrets. The seed
   creates none on purpose (a seed that printed a secret would leave it in every terminal log).

## 8. Commands actually run, with results

All from the worktree root. The TRIAL DATABASE WAS NEVER MIGRATED AND NEVER WRITTEN TO by this
branch; every check ran against `corgi_test`.

```
$ npm ci                                          clean install (the worktree had none)
$ npm run migrate -- --database=test              applied 0018_mcp_api_keys.sql (corgi_test only)
$ npm run typecheck                               exit 0
$ npm run build                                   exit 0, 42 routes, /api/mcp and /api/mcp-keys listed
$ npm test                                        375 tests, 374 pass, 0 fail, 1 skipped
                                                  (341 before this slice; the skipped one is B3's
                                                   live KYB test, unchanged)
$ npm run check:mcp                               52 of 52 PASS, exit 0   (new)
$ npm run check:claims-and-approvals              71 of 71 PASS, exit 0   (unchanged by this slice)
$ npm run check:money-guards -- --database=test    177 PASS, 1 FAIL: see below
```

**The money guards were run twice, and the reason matters.** The first run found one real failure:
the B7-era assertion that a user with the role `'agent'` cannot be created, which migration 0018
makes false on purpose. It was rewritten (section 6) and the second run passed everything except
`owner cannot TRUNCATE claims (deadlock detected)`, on a table this slice does not touch. That is
the contention every delegate has met on the shared `corgi_test`: the TRUNCATE probes take
ACCESS EXCLUSIVE locks and several agents run checks against that database at once. **All 24
checks this slice adds passed**: 18 privilege checks on the three new tables, and the six shape
checks (an agent key refused for an approver, a human key allowed for one, a key revoked only
once, an `'agent'` user refused as a decider by the trigger, a call timed by the database, and the
rewritten role assertion). The guards were not run a third time, as instructed.

`npm run check:mcp`, the lines that matter:

```
PASS  AN AGENT KEY CANNOT BE CREATED FOR A STAFF APPROVER: the database refuses it
PASS  tools/list returns the five tools of this build
PASS  THE NEVER-DELEGATED LIST IS PART OF THE SURFACE: tools/list carries it under policy
PASS  THERE IS NO APPROVE TOOL: calling one is an unknown tool
PASS  no key, a wrong key and a REVOKED key all answer 401
PASS  the three 401s are identical: a caller cannot tell a revoked key from a typo
PASS  a broker key reads its own policy as it stood on a date, with the figures in cents
PASS  A BROKER KEY CANNOT READ ANOTHER BROKER'S POLICY
PASS  and it is the same sentence as for a policy that does not exist, so the tool leaks no policy numbers
PASS  a customer key reads the policy that covers it / a staff key reads any policy
PASS  a broker key reads its own statement with "me" ... / A BROKER KEY CANNOT READ ANOTHER BROKER'S
PASS  a customer key has no broker statement to read
PASS  a staff key reads the open breaks and the clearing balances
PASS  a broker key and a customer key cannot read reconciliation breaks
PASS  A STAFF_OPS KEY ASKING FOR $1,200 CREATES AN APPROVAL REQUEST, and says who must decide it
PASS  NO MONEY MOVED: the journal is unchanged and the operation is still only 'requested'
PASS  an AGENT key can ask too, and the answer says the request was raised by an agent
PASS  AND THE IMMUTABLE REQUEST ITSELF SAYS SO: the approver sees it was raised by an agent
PASS  the cumulative per-claim threshold still applies to a request raised through MCP
PASS  AN AGENT PRINCIPAL CANNOT APPROVE ITS OWN REQUEST: the application refuses it
PASS  AND THE DATABASE REFUSES IT TOO, through the most privileged connection there is
PASS  a user with the role 'agent' is refused by the application AND by the database trigger
PASS  a distinct staff approver still can: the queue works, it is agents that are refused
PASS  approving still moves no money: sending is a separate staff action the surface does not expose
PASS  a staff key runs the reconciliation and gets the run ids and the counts back
PASS  RUNNING THE RECONCILIATION MOVES NO MONEY: not one journal entry was posted
PASS  EVERY CALL IS LOGGED, refusals and 401s included: one row per POST, exactly
PASS  a logged call names the tool, fingerprints the arguments and times itself, and stores no argument
```

**Two real defects the checks found**, both in code that type-checked and looked right:

1. `keyPrefixOf` cut the presented key at the LAST underscore, and base64url uses `_` as one of
   its characters, so a secret containing one produced the wrong prefix. Now it takes the first
   two segments. It is used for display only, but it would have made a log line wrong.
2. The clearing balances were reported as debits minus credits, so `refund_payable` read
   `-$236,919.74` for money we owe. They are now read in each account's own normal direction, and
   the field says so.

### The screens and routes over HTTP

A dev server on port 3800 pointed at the DISPOSABLE database (a git-ignored `.local/` aid, because
the trial database has no 0018 tables yet), with real session cookies. The server was stopped
afterwards and port 3800 is free.

| Call | Answer |
|---|---|
| `GET /ops/mcp-keys`, no session | 307 to `/login` |
| `POST /api/mcp-keys`, no session | 303 to `/login?error=Please+sign+in+again` |
| `GET /ops/mcp-keys`, staff | 200, the keys with prefix, holder, kind, calls, last call, and the never-delegated list |
| `POST /api/mcp-keys` create | 200 HTML, "Key cmk_b7c9ca43 created", the secret shown once and not in the URL |
| `POST /api/mcp-keys` revoke | 303 to `/ops/mcp-keys?revoked=1` |
| the same revoke again | 303 with "this key was already revoked" |
| revoke with an id that is not a key | 303 with "this key does not exist" |
| `GET /ops/approvals`, staff | 200, six requests carrying "Raised by an AGENT" and the key prefix |
| `POST /api/mcp` (the full curl session) | `docs/handoffs/b11-mcp-session.md` |

## 9. What was NOT verified here

- **The deployed application.** Everything ran on a local dev server against `corgi_test`. Running
  the endpoint on the deployed URL, after the coordinator applies migration 0018 to the trial
  database, is the coordinator's.
- **Migration 0018 on the trial database.** Not applied from this worktree, as instructed.
- **A real MCP client.** The transport was exercised with curl only. No Inspector, no Claude
  Desktop, no SDK client has completed a handshake against this endpoint. Every shape in the
  session log was read back from the running server, but a client's own negotiation has not been
  seen. **This is the largest gap of the slice**, and it is the coordinator's after the merge.
- **A key against the trial database.** None was created: the trial database has no 0018 tables
  yet. The demo keys are the coordinator's to create (section 10).
- **The endpoint under load.** No rate limiting, no concurrency test on the endpoint itself. Two
  concurrent `request_claim_payment` calls would meet slice B7's per-claim advisory lock, which is
  proved by `check:claims-and-approvals`, but not through this surface.
- **`run_reconciliation` against a large window.** It was run with `windowDays: 1`; the Stripe
  listing is paginated and capped at 31 days by `MAX_WINDOW_DAYS`, but no large run was timed.
  Measured: about 7 seconds for one day on the sandbox.
- **Independent review.** Not performed by this delegate, by design.
- **Walkthrough with Yoann: NOT REVIEWED WITH YOANN.**

## 10. What the coordinator has to do

1. **Apply `db/migrations/0018_mcp_api_keys.sql` to the trial database** (`npm run migrate`) and
   deploy. It is strictly additive: three tables, one trigger function, one widened CHECK. The
   CHECK widening is the only statement that touches an existing object, and it only adds a value.
2. **Create the demo keys on the trial database** once deployed, on `/ops/mcp-keys` or with
   `npm run create-mcp-key -- --email=ops@example.com --label="demo" --kind=agent`. Suggested set:
   one `staff_ops` agent key (the write tool and the staff reads), one broker key and one customer
   key (to show the scoping). **Where the secrets go:** into the MCP client configuration of
   whoever demonstrates it, or into a git-ignored local file. Never into the repository, the
   README, a ticket, a screenshot or the submission email. If one is ever exposed, revoke it on
   `/ops/mcp-keys` and create another; nothing else has to change.
3. **Add the README section** of section 5 above (integration inventory unchanged: this slice adds
   no provider).
4. **Replay `docs/handoffs/b11-mcp-session.md`** against the deployed URL, and, if time allows,
   point one real MCP client at it.
5. **Watch for the B10 clearing-balances fix** (F-B10-03): when it lands, replace the local query
   in `lib/mcp/tools/reconciliation-breaks.ts` with the shared reader.
