# Independent review, slice "mcp-tools", round 2: explain_amount and list_my_activity

Reviewer: independent adversarial reviewer sub-agent, working in the worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/wf_46bb3e09-77f-11`, detached at the
reviewed SHA. Written at 2026-09-09T13:55:02Z (15:55 CEST).

Reviewed revision: **5976e4f6f90c08aca55e7e76db0fd2a37ec244ee**, the head of the builder's branch
`worktree-wf_46bb3e09-77f-2-fix`, read as `git diff main...5976e4f` (six commits, 17 files, 1190
insertions, 30 deletions). Working tree clean apart from this record. `main` was not touched, no
code was modified, nothing was pushed to `main`, no migration was applied anywhere.

This is a scoped engineering assessment of one slice. It is not a legal certification and it is
not a statement that the six delivery gates pass for the whole submission.

**Verdict: FAIL.** One HIGH and one MEDIUM finding, both confirmed by running the code against
`corgi_test`. The round 1 finding F-MCPTOOLS-01 is only partly closed: the new gate filters the
figure KEY a caller may name, not the CONTENT of the answer it gets back, and the answer for two
keys a customer key is allowed to name carries figures the same key is refused when it names them
directly. The tool's own refusal sentence, its description and the README all state the opposite.

## 1. Startup receipt

Read in full, in this order, before looking at any code of the slice: `CLAUDE.md`,
`AUTOMATIC-FAILS.md` (all six rules and the operating gate), `READABLE-CODE.md`, `AGENTS.md`,
`WORKFLOW-48H.md`, `REVIEWER.md`.

Then, for this scope: `docs/DECISIONS.md` (the numbered money rules; the commission basis at
lines 37, 54, 80, 84 and 130), `docs/COMPLIANCE-MATRIX.md` rows MCP-01 and BLD-09,
`docs/PLAN.md` (the B-row table and the header note), `docs/reviews/FINDINGS.md` (header, the
register conventions and the tail sections), `docs/reviews/b11-mcp.md` (startup receipt and
format).

Code read in full at the reviewed SHA: `lib/mcp/tools/explain-amount.ts`,
`lib/mcp/tools/my-activity.ts`, `lib/mcp/tools/tool.ts`, `lib/mcp/tools/index.ts`,
`lib/mcp/scope.ts`, `lib/policy/explain-figure.ts`, `scripts/dev-on-test-database.ts`,
`lib/mcp/never-delegated.test.ts` (the diff and the surrounding tests), the whole diff of
`scripts/check-mcp.ts`, `lib/mcp/jsonrpc.ts` (the diff plus `handleJsonRpcMessage`, `callTool`,
`toolsListResult`, `methodForTheRecord`), `app/api/mcp/route.ts`, the README diff.
Read in the parts that matter here: `lib/money/endorsement.ts` (`endorsementFormulaLines`,
`recheckEndorsementFigures`), `lib/money/explain.ts` (`evidenceFromJournal`,
`explainCancellationFigure`), `app/policies/[policyId]/customer-view.tsx` (whole file, to
establish what a customer's own screen actually prints), `lib/policy/read.ts`,
`lib/policy/endorsement-read.ts` and `lib/policy/correction-read.ts` (the signatures the new
module passes a handle to), `lib/observability/log.ts` (`correlationIdOf`, `withActivity`),
`db/migrations/0021_activity_log.sql` (the guards and the absence of a payload column),
`lib/auth/current-user.ts` (the five roles), `lib/mcp/tools/policy-as-of.ts` (to compare the
visibility rule the new tool claims to copy), `tsconfig.json`, `package.json`, `.gitignore`.

Not read, and why: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`,
`GAP-REVIEW.md` (advisory catalogues; no retained control beyond what AGENTS.md already requires
was identified for a read-only MCP slice), `START-PROMPT.md` (explicitly not a rule source),
`docs/handoffs/b12-1-agent-demo.md` (read only through the README paragraph that cites it),
the other slice review records. Absent files: none. There is no round 1 record on `origin`
(`git branch -r` lists only `origin/main`), so the round 1 finding is reconstructed from the
assignment text and from the fix's own commit message and comments.

Acceptance criterion in scope: `docs/COMPLIANCE-MATRIX.md` row MCP-01 (read tools with
authorization and tenant isolation), plus AGENTS.md "Maker-checker and MCP" ("Apply authorization
and tenant isolation to read tools too") and the surface rule stated in `lib/mcp/scope.ts` ("an
API key sees exactly what its user sees on the screens, never more").

Environment handling: this worktree had no `node_modules` and no `.env.local`. I ran `npm ci`
(package-lock.json untouched, both paths gitignored) and copied the main checkout's `.env.local`
in to run the checks. No value from it was printed, echoed or committed, the file is covered by
`.gitignore` lines 1 to 3 and 20, and it is deleted again at the end of this review. No tool
printed a connection string at any point. `npm run check:money-guards` was deliberately NOT run:
it is the coordinator's, on an ephemeral database.

## 2. Applicability

Product: US commercial policy administration, Track 1, sandbox only. The data in scope is
policy-level and commercial: annual premium, state premium tax, a flat fee, ledger balances, a
broker's commission payable and commission rate, journal entry identifiers, and one request log.
No money moves through either new tool and neither writes anything.

The requirements that bite here are the trial's own, not a statute: the brief's MCP
non-negotiable as recorded in MCP-01, and AGENTS.md's instruction that read tools carry the same
authorization and tenant isolation as the rest. There is no external legal source that decides
whether a policyholder may see their broker's commission; the governing rule for this build is
the one the codebase states for itself in `lib/mcp/scope.ts` and repeats in
`app/policies/[policyId]/customer-view.tsx` ("WHAT THE CUSTOMER DOES NOT SEE, deliberately: the
journal, the ledger sums, the broker's ... commission"). `docs/DECISIONS.md` records the
commission basis and rate as the broker's commercial terms and nowhere makes them customer
facing. I assess the slice against that stated rule; whether Corgi would want a different rule is
a product question for Yoann, not something a reviewer can settle.

Assumption, stated: I treat "the screen this key's user reads" as the whole customer view file,
which is what the builder's own comment cites. Nothing in the trial brief defines it.

## 3. Requirement matrix

| # | Requirement | Control / code location | Evidence | Verdict |
|---|---|---|---|---|
| R1 | Both new tools are read-only and write nothing | `effect: "read"` on both; no INSERT/UPDATE/DELETE in either file | `git diff main...5976e4f \| grep -Ei '^\+.*(update \|delete from\|truncate \|insert into)'` returns nothing; `npm test` asserts `effect === "read"` for both | PASS |
| R2 | The never-delegated list is unchanged and the write-tool count is still one | `lib/mcp/never-delegated.test.ts`, three new tests | `npm test` 476 pass; `NEVER_DELEGATED.length === 10`, one `queues_for_a_human`, one `appends_a_run` | PASS |
| R3 | `explain_amount` returns the explanation the screen renders, computed by the same functions, never a second computation | `lib/policy/explain-figure.ts` composes `lib/money/explain.ts` and `lib/money/endorsement.ts` | `check:mcp`: tax 2820 = page 2820, fee 2500 = 2500, total 125320 = 125320, commission 18000 = 18000, unearned 120000 = 120000, computed by a second path in the check | PASS |
| R4 | Which policies are reachable follows `get_policy_as_of` | `policyVisibilityRefusal` called with the same arguments in both tools | `check:mcp`: broker key refused another broker's policy with the identical sentence | PASS |
| R5 | Which figures come back follows the screen the key's user reads | `figureVisibilityRefusal`, `FIGURE_KEYS_A_CUSTOMER_KEY_READS` | Holds for the eleven refused keys; **fails** for `endorsement_delta` and for the evidence attached to `premium_tax` and `policy_fee` | **FAIL** (F-MCPTOOLS-02, F-MCPTOOLS-03) |
| R6 | No caller-chosen string reaches the append-only call log | fixed refusal sentences in `explain-amount.ts`; `log.tool` is null for an unknown tool; `methodForTheRecord` collapses unknown methods | `check:mcp`: 46 rows read back, 0 quoting any of the five caller strings; longest tool 26, longest detail 421 | PASS |
| R7 | `list_my_activity` never returns another user's rows | `where actor_user_id = ${context.user.id}` plus the route filter | `check:mcp`: the broker's labelled call absent from the staff answer and the reverse, proved with two distinct `x-request-id` labels | PASS |
| R8 | `list_my_activity` is bounded and leaks no payload | `limit 50`; `activity_log` has no payload column (migration 0021) | `check:mcp`: 16 and 15 rows, six fields exactly, `recordedAt,tool,outcome,rule,durationMs,correlationId` | PASS |
| R9 | No money row updated or deleted, no column redefined, no applied migration edited | no SQL file in the diff | `git diff --name-status main...5976e4f` lists no `.sql` file; `lib/policy/read.ts` only adds an optional parameter with a default | PASS (AF-03) |
| R10 | No secret printed or committed | `scripts/dev-on-test-database.ts` uses `process.loadEnvFile` and prints only the port | gitleaks on the 84.9 KB slice diff: no leaks found; the script's only `console.log` names the port and says nothing is printed | PASS (AF-05) |
| R11 | Nothing simulated is presented as live | no provider call added; the README paragraph about the MCP Inspector run stays a dated past statement about five tools | read | PASS (AF-02) |
| R12 | tools/list publishes an honest shape | `readOnlyHint` derived from `effect` | `check:mcp` asserts it; but a tool's own annotations are spread last and could override it | PASS with F-MCPTOOLS-04 (LOW) |
| R13 | The code can be followed line by line | two short pure functions, one closed list, comments that state the rule | Readable; but three of those comments and the README now state a rule the code does not enforce | **FAIL** as evidence (F-MCPTOOLS-02, F-MCPTOOLS-03) |

## 4. Findings

### F-MCPTOOLS-01 (round 1, HIGH): PARTLY FIXED, reopened

The round 1 finding was that `explain_amount` applied only the policy visibility gate, so a
customer key that could see its own policy could read every figure on it, including the broker's
commission payable and the cancellation figures.

What is genuinely fixed, and I confirmed it over HTTP: a customer key naming
`commission_payable` is now refused, with a sentence that names the rule and does not repeat the
caller's input, and the same key still reads `premium_tax` to the cent (2820, and the page reads
2820). Eleven of the fifteen keys are refused to a customer key by name.

What is not fixed: the gate decides which key a caller may NAME. It does not decide what the
answer for an allowed key CONTAINS. `explanation.lines` is always the whole formula table of the
fold, and `explanation.evidence` is always every journal line of the account behind it; the
figure key only selects which line is marked `isTheResult`. So a caller refused a figure by name
can still receive it inside the answer for a figure it is allowed to name. Two instances follow.
Status: OPEN, superseded by F-MCPTOOLS-02 and F-MCPTOOLS-03.

### F-MCPTOOLS-02 (HIGH): `endorsement_delta` hands a customer key the broker's commission and the broker's commission rate

**Location:** `lib/mcp/tools/explain-amount.ts` line 45 (`FIGURE_KEYS_A_CUSTOMER_KEY_READS`
includes `"endorsement_delta"`), reaching `lib/policy/explain-figure.ts` `endorsementFigure`,
which sets `lines: endorsementFormulaLines(row.figures)`; `lib/money/endorsement.ts` lines 379 to
393 push a `commission` line onto every charge and every refund.

**Trigger:** a customer key calls `explain_amount` with `{"policy": "<its own policy>", "figure":
"endorsement_delta"}` on any policy that carries an endorsement. The figure gate returns null
because the key is on the allowed list, and the answer's `formula` array carries every line of
the fold, the commission line included.

**Measured, read-only, against `corgi_test` through the runtime role** (a script run once and
deleted; it calls `explainPolicyFigure` exactly as the tool does):

```
--- policy 0113f768 amount cents -44586
   line: annual_difference | Annual premium difference (new minus old) | 60000 - 120000 | -60000
   line: delta_premium    | Prorated premium refunded, 265 of 365 days remain ... | -ceil(60000 x 265 / 365) | -43562
   line: delta_tax        | State premium tax refunded ...                       | -ceil(43562 x 235 / 10000) | -1024
   line: delta_fee        | Policy fee (charged at issuance only ...)            | 0 | 0
   line: delta_total      | Total refunded to the customer through Stripe        | -43562 + -1024 | -44586
   line: commission       | Broker commission clawed back on the refunded premium (rounded down) | -floor(43562 x 1500 / 10000) | -6534
```

The last line gives the customer the broker's commission movement (6534 cents) and, in the
formula string, the broker's commission rate (1500 bps, 15 percent). `recomputedFromStoredInputs`
can carry the same figure a second time: `recheckEndorsementFigures` compares a row labelled
`"broker commission"` and any disagreement is returned to the caller.

**Consequence:** the customer's own screen prints neither. `app/policies/[policyId]/customer-view.tsx`
shows the endorsement schedule as four columns (effective date, description,
`figures.deltaTotalCents`, `figures.newAnnualPremiumCents`) and the word commission appears in
that file only inside the comment saying the customer does not see it. So the surface rule in
`lib/mcp/scope.ts` is broken by the tool that claims to implement it, and three separate
statements are false at the reviewed SHA:

- the refusal sentence itself: "a customer sees the terms in force on a date ... and the
  endorsement delta, and never ... the broker's commission";
- the tool description: "a customer key gets premium_tax, policy_fee, total_charge,
  endorsement_delta and is refused ... the broker's commission";
- the README: "A customer key gets the three terms in force and the `endorsement_delta`, which is
  what its own policy page prints, and is refused ... the broker's commission".

A finding is not only the leak; it is that the documentation asserts the leak is closed. An agent
or a reviewer reading the README would conclude a customer key cannot reach commission, which is
the state the round 1 finding asked for and is not the state of the code.

**Required correction:** filter the answer, not only the key. Either drop the `commission` line
(and the `broker commission` recheck row) from what `explain_amount` returns when
`figureVisibilityRefusal` would refuse `commission_payable` for this user, or refuse
`endorsement_delta` to a customer key and say so. Whichever is chosen, add the assertion to
`scripts/check-mcp.ts` on a fixture policy that actually has an endorsement (the check's current
fixture has none, which is why the hole survived), and correct the refusal sentence, the
description and the README to match the code.

### F-MCPTOOLS-03 (MEDIUM): the evidence attached to an allowed figure carries the journal and a cancellation figure the same key is refused

**Location:** `lib/policy/explain-figure.ts` `termsFigure`, which attaches
`evidenceFromJournal(entriesByThen, "premium_tax_payable")` to `premium_tax` and
`evidenceFromJournal(entriesByThen, "fee_income")` to `policy_fee`; both keys are on
`FIGURE_KEYS_A_CUSTOMER_KEY_READS`. `lib/mcp/tools/explain-amount.ts` maps every evidence entry
into `provenBy` with its `journalEntryId`, `entryType`, `recordedAt` and the line detail.

**Trigger:** a customer key calls `explain_amount` with `{"figure": "premium_tax"}` on its own
policy. Measured read-only on a cancelled policy in `corgi_test`:

```
--- policy 00e3ebbf premium_tax cents 2820
   evidence: tax_and_fee_billed | Cr State premium tax collected, owed to the state 2820 | d4f2eb81
   evidence: refund_requested   | Dr State premium tax collected, owed to the state 2813 | 077ba467
```

The second line is the cancellation's refunded premium tax, 2813 cents. The same key asking for
`cancellation_refunded_tax` by name is refused with the sentence "never ... the cancellation
figures". The refusal is therefore bypassable by the same caller, from the same tool, by naming a
different key. The answer also gives internal account names, entry types, booking timestamps and
journal entry UUIDs, which the customer view does not render anywhere (the string `journal`
appears in that file only in the comment listing what the customer does not see).

**Consequence:** lower than F-MCPTOOLS-02 because the amounts involved are the customer's own tax
and fee rather than a third party's commercial terms, so I rate it MEDIUM rather than HIGH. It is
still an authorization statement the code does not keep, and it is the same root cause: the gate
never looks at the payload.

**Required correction:** decide, per figure, what a customer key's answer may carry, and drop the
rest before returning (the simplest honest version: no `provenBy` and no cross-event evidence for
a principal that is refused the journal). Then make the sentence, the description and the README
say exactly that. If instead the decision is that a customer may see the entries behind their own
tax and fee, remove "never the journal" from all three places rather than leave the code and the
prose disagreeing.

### F-MCPTOOLS-04 (LOW): a tool's own annotations are spread after the protocol hints and can override them

**Location:** `lib/mcp/jsonrpc.ts`, `toolsListResult`:

```ts
annotations: {
  readOnlyHint: tool.effect === "read",
  destructiveHint: false,
  openWorldHint: false,
  ...(tool.annotations ?? {}),
},
```

No tool exploits this today, and `explain_amount` publishes only `figureKeys` and
`figureKeysACustomerKeyReads`. But a future tool that declares `readOnlyHint: true` in its own
`annotations` while carrying `effect: "queues_for_a_human"` would publish a false hint, and the
new check assertion ("EVERY TOOL SAYS WHETHER IT READS ONLY") reads the published annotation, so
it would pass. **Correction:** spread `tool.annotations` first and let the three derived hints
win, which is one line and matches the comment's intent ("taken from what the tool declares it
changes rather than from its name").

### F-MCPTOOLS-05 (LOW): nothing enumerates the closed list against each role

`figureVisibilityRefusal` is not exported and has no unit test. `scripts/check-mcp.ts` asserts one
refused key (`commission_payable`) and one allowed key (`premium_tax`) out of fifteen, for one
role out of four. That is why F-MCPTOOLS-02 survived a round that was specifically about this
gate. **Correction:** export the function and add a table-driven test that walks all fifteen keys
for a customer, a broker, a staff_ops and a staff_approver user and asserts the expected verdict
for each, so a key added later cannot silently land on the wrong side. The builder's stated
reason for not adding one ("the finding asked for the assertion in the check script") is not a
reason: an assertion over HTTP on one key of fifteen proves one key of fifteen.

### F-MCPTOOLS-06 (INFO): the slice is labelled B14 in the code, and B14 in docs/PLAN.md is the freeze package

`lib/policy/explain-figure.ts` ("slice B14, the MCP tool explain_amount") and
`lib/mcp/never-delegated.test.ts` ("The two tools of slice B14") name a slice that
`docs/PLAN.md` row B14 defines as "Freeze package". Traceability nit only; the coordinator owns
the plan and may prefer a different label.

## 5. Checks executed

All run once, in this worktree, at the reviewed SHA. The shared disposable database `corgi_test`
was used through the URLs in `.env.local`; nothing was applied to any other database.

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | PASS, no output |
| Unit tests | `npm test` | PASS: 477 tests, 476 pass, 0 fail, 1 skipped, over 468 subtests, 3.38 s |
| MCP surface over HTTP | `PORT=4210 npm run dev:test-db` in one shell, then `MCP_BASE_URL=http://127.0.0.1:4210 npm run check:mcp` | **ALL CHECKS PASSED**, 0 FAIL. 46 POSTs sent, 46 rows appended to `mcp_calls`. The two new gate assertions passed, as did all 13 explain_amount and list_my_activity lines |
| Secret scan | `gitleaks detect --no-git --source <the slice diff> --redact` | no leaks found, 84.91 KB scanned |
| Dash scan | `git diff main...5976e4f \| grep -P "[\x{2014}\x{2013}]"` | none |
| Money-row and migration scan | `git diff --name-status`, plus a grep for added `update`/`delete from`/`truncate`/`insert into` | no `.sql` file touched, no write statement added |
| Adversarial probe 1 | read-only script calling `explainPolicyFigure(key: "endorsement_delta")` on an endorsed `corgi_test` policy | **the broker commission line and the 1500 bps rate are in the answer** (F-MCPTOOLS-02) |
| Adversarial probe 2 | read-only script calling `explainPolicyFigure(key: "premium_tax")` on a cancelled `corgi_test` policy | **the cancellation's 2813-cent tax refund and two journal entry ids are in the answer** (F-MCPTOOLS-03) |

Port: the assignment reserves 3800 for the MCP slice's own server, so this review used 4210 and
`MCP_BASE_URL`. The server was stopped at the end and nothing listens on 4210. The two probe
scripts were written into the gitignored `.next/` directory and deleted; they only read.

Shared-database note, not a failure: the check reported **1582 open reconciliation breaks**,
**434 refused calls** and **82 unauthorised calls** in the shared tables, against the builder's
1527 open breaks an hour earlier. That is accumulation from every agent using `corgi_test`, not
something this slice writes. No deadlock, no fixture collision and no flake was observed in the
single run, and the run was not repeated.

## 6. What was not verified

- `npm run check:money-guards`: deliberately not run, it belongs to the coordinator on an
  ephemeral database. The AF-03 evidence in this record is a static one (no SQL write and no
  migration in the diff), not a fresh proof of the database guards.
- The deployed application. Nothing in this slice was exercised against the deployed URL, and the
  README's MCP Inspector paragraph still describes a run of five tools; the two new tools have no
  deployed evidence at all (AF-01 and AF-02 remain the coordinator's, NOT RUN here).
- `list_my_activity` under a user who holds two keys. The honest limitation is written in the
  description and in the code; I read it but did not create a second key to demonstrate it.
- The customer view is a moving target: another session is rebuilding the interface. If the
  customer screen changes, `FIGURE_KEYS_A_CUSTOMER_KEY_READS` becomes wrong silently, and nothing
  in the build ties the two together. Worth a note for the coordinator rather than a finding.
- Concurrency, load and rate limiting on the endpoint: out of scope for this slice and already
  disclosed as a build limitation.
- I did not re-derive the fifteen figures' arithmetic; that is `docs/reviews/b12-explain.md`'s
  scope and is unchanged here.

## 7. Verdict

**FAIL** at `5976e4f6f90c08aca55e7e76db0fd2a37ec244ee`.

One HIGH (F-MCPTOOLS-02) and one MEDIUM (F-MCPTOOLS-03) finding, both confirmed by execution. The
round 1 finding F-MCPTOOLS-01 is partly closed and stays open in substance: the new gate is a
filter on the argument, and the disclosure it was raised against is still reachable through two
of the four keys the same gate allows. Two LOW findings and one INFO note accompany them.

Everything else in the slice holds up: no money row is touched, no column is redefined, no
migration is edited, no secret is printed or committed, nothing simulated is presented as live,
the never-delegated list and the write-tool count are unchanged and now tested, the transport
hints are derived rather than guessed, `list_my_activity` is correctly scoped and bounded, and
every figure the check compares agrees with a second computation of the same figure.

Residual limitation requiring Yoann, not a reviewer: whether a policyholder may see their
broker's commission at all is a product decision. This review only records that the code, the
tool description, the refusal sentence and the README currently disagree with each other, and
that the code is the most permissive of the four.

**Walkthrough status: NOT REVIEWED WITH YOANN.** No part of this slice has been explained to him
and confirmed by him. Nothing in this record establishes AF-06.

## 8. Register lines

| ID | Sev | Finding (one line) | Fix | Status |
|---|---|---|---|---|
| F-MCPTOOLS-01 | HIGH | explain_amount applied only the policy visibility gate, so a customer key read every figure on its own policy | Second gate `figureVisibilityRefusal` by role; eleven of fifteen keys now refused to a customer key | PARTLY FIXED 5976e4f, reopened as F-MCPTOOLS-02 and F-MCPTOOLS-03 |
| F-MCPTOOLS-02 | HIGH | `endorsement_delta`, allowed to a customer key, returns the broker's commission movement and the 1500 bps commission rate in its formula lines; the refusal sentence, the description and the README all say it does not | Filter the returned lines and the recheck rows, or refuse the key to a customer; assert it in check:mcp on a fixture that has an endorsement; correct the three statements | OPEN |
| F-MCPTOOLS-03 | MED | `premium_tax` and `policy_fee`, allowed to a customer key, return journal entry ids, account names and the cancellation's 2813-cent tax refund, which the same key is refused as `cancellation_refunded_tax` | Decide what a customer key's answer may carry and drop the rest before returning; align the sentence, the description and the README | OPEN |
| F-MCPTOOLS-04 | LOW | `toolsListResult` spreads a tool's own annotations after the derived hints, so a future tool could publish a false `readOnlyHint` and the new check assertion would still pass | Spread `tool.annotations` first | OPEN |
| F-MCPTOOLS-05 | LOW | Nothing enumerates the fifteen figure keys against the four roles; one refused key and one allowed key are asserted, which is why F-MCPTOOLS-02 survived | Export `figureVisibilityRefusal` and add a table-driven test over all keys and roles | OPEN |
| F-MCPTOOLS-06 | INFO | The code calls this "slice B14"; `docs/PLAN.md` row B14 is the freeze package | Relabel, coordinator's call | OPEN |
