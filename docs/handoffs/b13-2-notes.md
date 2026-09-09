# B13-2: the LOW findings batch (Linear YOA-628)

One line per finding taken, with the commit and the proof, or the reason it was skipped. Branch
`worktree-agent-a285d5858c4689d35`, opened on `main` at `62d8cc8` and merged with `origin/main`
at `bf7fffb` before this note was written. Nothing pushed, nothing deployed, no migration, no
UPDATE and no DELETE of any row.

## Fixed

| Finding | Commit | What changed, and the proof |
|---|---|---|
| F-B8-08 | `15d3efc` | `lib/statements/journal.ts` reads `refund_allocations.refunded_premium_cents` per refund line instead of the whole correction's movement of `unearned_premium`. `check:statements` section 7b (broker E, a correction of a correction giving back 10262 over two PaymentIntents): "EACH REFUND LINE CARRIES ITS OWN PREMIUM, not the whole correction's: -5096 and -4931, not -10027 twice" and "the two bases still add up to the premium the correction gave back, 10027". October still ties to the ledger (statement -1504, journal -1504, adjustment 0). |
| F-B11-02 | `52bdd2b` | The method is allow-listed to the five this server knows, the `tool` column stays null on an unknown tool, the protocol-version refusal logs a fixed sentence, and the `asOf` and `month` refusals say the expected shape instead of the value. `recordMcpCall` bounds method and tool to 64 characters and detail to 500. `check:mcp`: "NO CALLER STRING REACHES THE APPEND-ONLY CALL LOG" (32 rows read back, 0 quoting one of the four strings the run sent) and "every column the caller can influence is bounded" (longest method 25, tool 26, detail 123). |
| F-B11-03 | `63520ac` | `ReconciliationRunInput.launchedThrough`, one sentence stored at the head of the run's note, which `/ops/reconciliation` already shows: principal kind and public key prefix. The "Run now" button and the daily cron pass nothing and are unchanged. `check:mcp`: "THE RUN SAYS IT CAME THROUGH THE MCP SURFACE, and names the key" (`Launched through the MCP surface by a human key cmk_b39b7f79, not by a person on this screen.`). |
| F-B11-05 | `b3e9501` | `logCall` returns whether the row was written; every path checks it and a call whose audit row could not be written is answered with a JSON-RPC internal error saying the work may already have been done. The failure line is structured (`mcp_call_not_recorded`) with the key, method, tool and outcome, and no caller text. Not exercised by a check: forcing the insert to fail would mean breaking the database under a live call. |
| F-B11-06 | `2b78302` | `argumentsSchemaRefusal` in `lib/mcp/tools/tool.ts` enforces the closed property list, the required list and the declared types, once, before any tool sees its arguments. Five unit tests on the pure function; `check:mcp`: "AN ARGUMENT THE TOOL DOES NOT DECLARE IS REFUSED, not ignored" (`this tool accepts "policyNumber", "asOf" and nothing else; the call sent 1 argument(s) it does not declare`). |
| F-B12-01 | `8bb9fc0` | `get_policy_as_of` names the date the cover begins instead of repeating the date the caller sent. `check:mcp`: "a date before the policy existed answers a reason AND THE DATE THE COVER BEGINS" (`this policy was not yet in force on the date asked for: it takes effect on 2028-03-01, so ask for that date or a later one.`). |
| F-B7-13 | `d3152ea`, check line `7088ae2` | The refusal shows the arithmetic that blocked the payment and names the way out. `check:claims-and-approvals`: "AND THE FIRST $600, BELOW THE CEILING WHEN IT WAS ASKED FOR, IS BLOCKED TOO" (`this payment of $600.00 carries no approval request, and the claim already has $0.00 paid and $600.00 waiting, which takes it past the $1,000.00 approval ceiling. ... Have that request rejected and this payment becomes sendable again.`). |
| F-B4-07 | `644e8da` | **The column is used**, not the comment softened: both posting paths compare `endorsement_collections.quote_hash` with the request event's hash and recompute that hash from the six facts, which is what migration 0009 says happens at posting time. No migration touched; `docs/ARCHITECTURE.md` does not name the column, so there was no wording to fix there. `check:endorsement-replay` 80 PASS, 0 FAIL. |
| F-B4-10 | `0e87174` | Both routes catch the unique violation: Approve answers the "already approved" redirect the winner gets, Pay answers the policy page saying the attempt was already started and nothing was charged twice. Any other error still throws. Read in the diff, not raced live. |
| F-B4-12 | `7d18e28` | `postDeltaAndApply` takes `pg_advisory_xact_lock(hashtext(policy_id))` as its first statement and re-reads the standing under it, because a lock cannot undo a request that committed a moment before it was taken; a quote found superseded or unapproved rolls back and the money is parked. `check:endorsement-replay` 80 PASS, 0 FAIL, including the superseded-quote and parked-cash lines. |
| F-B10-09 | `99e4258` | A provider reference carried by more than one ledger record stops being a pairing link: the operation id still pairs on its own, the provider record is reported as `provider_only` saying why, and both ledger records are reported with a note naming each other. Two unit tests in `lib/reconciliation/diff.test.ts` (33 pass); `check:reconciliation` 39 PASS, 0 FAIL. |
| F-UI-03 | `28e6542` | The append-only sentence is a visible line under the heading of the staff overview again, not only in the page's meta description. |
| F-UI-13 | `efe9d90` | `table.approval-details` and its dedicated 600px block deleted, with the three older dead selectors (`loading-placeholder`, `demo-feedback`, `desktop-break`): 20 lines out of `app/globals.css`, `.table-scroll .badge` kept. Verified dead by grep over `app/` and `components/` before deleting. |
| F-UI-16 | `f8cbeb6` | `countPoliciesPaidButNotBound` and `countEndorsementsPaidButNotApplied` take the same optional `database: postgres.Sql = sql` as the other three, so all five have one shape and the two can be pointed at another connection. |
| F-UI-18 | `f8cbeb6` | `countEndorsementsAwaitingCustomerApproval` asks `liveEndorsementRequest` only about policies that carry an `endorsement_requested` event, instead of every policy of the book on every page. The approval rule itself stays where it is, decided policy by policy. See the note below on what "once per page" would still need. |

## Skipped, and why

| Finding | Why |
|---|---|
| F-UI-17 | The bare `catch` it names is `components/what-needs-you.tsx:46`, which another builder owns this morning. The one structured log line goes there and nowhere else. |
| F-B11-07 | README only, and the README is not this batch's to edit. The line to add is in the report below. |
| F-B10-08 | Explicitly out of scope: the acknowledgement path is not built. One README sentence is proposed in the report below instead. |

## Two things the next builder should know

**F-UI-18 is narrowed, not closed.** The count now runs one read per policy that has ever been
endorsed rather than one per policy of the book, which is the cheap half. Reading it *once per
page* in the strict sense means memoising `workspaceTasks`, and that function lives in
`components/what-needs-you.tsx`, which was out of bounds for this batch. It is a hint on a badge,
never a control, so nothing depends on it being fast.

**F-B4-12 changed a posting path, so read it before the next endorsement change.**
`postDeltaAndApply` now holds the policy advisory lock for the whole posting transaction. Any
future code that takes another lock inside that transaction has to take it in the same order as
`recordEndorsementRequest` and `recordEndorsementDateCorrection`, which both take this one first.

## Checks actually run

All on `corgi_test`, once each, no loop, no contention observed (no deadlock in any run).

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0, no output |
| `npm test` | 416 tests, 415 pass, 0 fail, 1 skipped (the opt-in live Stripe test) |
| `npm run build` | exit 0, every route compiled |
| `npm run check:statements` | ALL CHECKS PASSED, 0 FAIL, including the four new section 7b lines |
| `npm run check:mcp` | 58 PASS, 0 FAIL (dev server on 127.0.0.1:3877 pointed at `corgi_test`) |
| `npm run check:endorsement-replay` | 80 PASS, 0 FAIL |
| `npm run check:claims-and-approvals` | 72 PASS, 0 FAIL |
| `npm run check:reconciliation` | 39 PASS, 0 FAIL |
| `npm run check:correction-replay` | 55 PASS, 0 FAIL |
| `npm run check:money-guards` | NOT RUN, as instructed: no migration and no trigger was touched by this batch |
| `gitleaks protect --staged` | run before every commit of this batch, no leaks found |
