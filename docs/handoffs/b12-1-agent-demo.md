# B12-1: the live MCP agent demo, run once on production

Written by the B12-1 delegate on 2026-09-08. Linear YOA-624. Branch
`worktree-agent-a8aee1e89e3365b42`, worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/agent-a8aee1e89e3365b42`, based on
`main` at `5f2c841`. **No application code was changed by this slice**: it is a client
configuration, a demo script, and one rehearsal against the deployed application.

What it is for: at the debrief Yoann points a real MCP client at
`https://corgi-work-trial-iota.vercel.app/api/mcp` with a staff agent key, the panel watches an
agent read the ledger's answers and ask for a claim payment, and then watches the application
refuse to let that agent approve its own request. Everything below was executed against
production, not against a local server.

## 1. Startup receipt

Read in full before doing anything: `CLAUDE.md`, `AUTOMATIC-FAILS.md`, `READABLE-CODE.md`,
`AGENTS.md`, `WORKFLOW-48H.md`, `REVIEWER.md`, `README.md` (whole file, MCP surface section and
demo users), `docs/PLAN.md`, `docs/DECISIONS.md` (all entries from 12:54Z to the B12 entry of
18:52Z, in particular 15:12Z item 3 and 15:34Z on the cumulative per-claim threshold),
`docs/handoffs/b11-implementation-notes.md`, `docs/handoffs/b11-mcp-session.md`,
`app/api/mcp/route.ts`, `lib/mcp/never-delegated.ts`, `lib/mcp/scope.ts`,
`lib/mcp/tools/tool.ts`, `lib/mcp/tools/claim-payment.ts`, `lib/mcp/tools/broker-statement.ts`,
`lib/mcp/jsonrpc.ts` (header and dispatch), `lib/claims/payments.ts` (`requestClaimPayment` and
the intent helpers), `lib/approvals/threshold.ts` (`claimPayoutNeedsApproval`),
`app/ops/approvals/page.tsx`, `app/api/approvals/[requestId]/route.ts`,
`app/api/session/login/route.ts`, the trigger sections of `db/migrations/0008` and `0018`.

Not read, and why: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`,
`GAP-REVIEW.md`, `docs/COMPLIANCE-MATRIX.md`, `docs/STATUS.md` (advisory catalogues or shared
records outside this scope; this slice adds no behaviour to review against them). No mandatory
file was missing.

Acceptance criterion worked on: `docs/DECISIONS.md` 18:52Z item (1), the live MCP agent. Planned
checks, all executed: a real MCP client handshake against production, the five tools, the write
tool, the approval screen, the four refusals, and one rejection recorded by a human approver.

## 2. The two clients, validated end to end

The key is the existing demo key: holder `ops@example.com` (Sam Patel, operations, `staff_ops`),
kind **agent**, public prefix `cmk_e96f88a4`. **Its secret lives in
`/Users/yoannabriel/dev/corgi-work-trial/.local/mcp-demo-key.txt`, which the repository ignores.
It is never written into this repository, a screenshot, a commit or an email.** If it is ever
seen by anyone else, revoke it on `/ops/mcp-keys` and create another; nothing else changes.

### Claude Code CLI (what Yoann drives at the debrief)

Syntax verified against `claude mcp add --help` on Claude Code 2.1.263, 2026-09-08:

```bash
claude mcp add --transport http corgi-trial \
  https://corgi-work-trial-iota.vercel.app/api/mcp \
  --header "Authorization: Bearer $(sed -n 's/^ *\(cmk_[A-Za-z0-9_-]\{20,\}\) *$/\1/p' ~/dev/corgi-work-trial/.local/mcp-demo-key.txt)"
```

Reading the secret from the file rather than typing it keeps it off the screen and out of the
shell history. Typing it literally works too; do not do it with a projector on.

Verify, and this is the line to show the panel:

```
$ claude mcp list
...
corgi-trial: https://corgi-work-trial-iota.vercel.app/api/mcp (HTTP) - ✔ Connected
```

**Actually run on 2026-09-08 at 19:17Z: `Added HTTP MCP server corgi-trial ... to local config`,
then `corgi-trial: ... ✔ Connected`.** The CLI prints headers as `"Authorization": "[REDACTED]"`,
so adding the server in front of the panel is safe. `claude mcp get corgi-trial` may print more:
do not run it on screen. Remove it afterwards with `claude mcp remove corgi-trial`.

Scope note: `claude mcp add` defaults to `--scope local`, which stores the server (and the
header) in `~/.claude.json` under the current directory. Add it from the trial repository
directory so the entry belongs to this project, and remove it when the debrief is over.

### MCP Inspector (what produces the screenshots)

Version 2.5.0, `npx @modelcontextprotocol/inspector@latest`. It declares `node >= 22.19.0` and
Yoann's Mac runs Node 20.19.5 through nvm: npm prints an `EBADENGINE` warning **and the
Inspector works anyway**, in both CLI and UI mode. That warning is expected; it is not a failure.

One-shot check, no browser, nothing to click:

```bash
npx -y @modelcontextprotocol/inspector@latest --cli \
  https://corgi-work-trial-iota.vercel.app/api/mcp \
  --transport http --header "Authorization: Bearer <key>" \
  --method tools/list
```

Executed at 19:16Z: the five tools with their full JSON Schemas came back. **This is the first
time a real MCP client SDK has completed a handshake with this endpoint**; slice B11 called that
the largest gap of its slice (`b11-implementation-notes.md` section 9), and it is now closed.

For the UI, put the server in a configuration file **outside the repository** (the same
`.local/` directory is the right place) and launch the Inspector against it, so the token is
never typed into a form on screen:

```json
{
  "mcpServers": {
    "corgi-trial": {
      "type": "streamable-http",
      "url": "https://corgi-work-trial-iota.vercel.app/api/mcp",
      "headers": { "Authorization": "Bearer <key>" }
    }
  }
}
```

```bash
npx -y @modelcontextprotocol/inspector@latest --config <that file> --server corgi-trial
```

It prints `http://127.0.0.1:6274?MCP_INSPECTOR_API_TOKEN=...`; open that, flip the toggle next to
`corgi-trial` to connect, then use the **Tools** tab. The Inspector shows the URL and the
negotiated protocol version but never renders the bearer header, which is why the screenshots in
`docs/evidence/b12-1/` carry no secret. The Inspector prints `--server has no effect on the web
UI yet; it lists every server in the file`, which is harmless when the file holds one server.

### Claude Desktop, optional, not used here

Claude Desktop reads stdio servers, so a streamable HTTP endpoint needs a bridge
(`npx mcp-remote <url> --header "Authorization: Bearer <key>"`). **Not validated by this slice
and not needed**: the CLI and the Inspector both speak HTTP directly. No dependency was added to
the repository for any of this; `npx` downloads the Inspector into the user's npm cache.

## 3. The demo script

Seven beats, about four minutes. The client is the Claude Code CLI unless the line says
Inspector. The prompts are what Yoann types; the model chooses the tool, which is the point.

**Beat 0, the setup, 20 seconds.** Show `claude mcp list` with `corgi-trial ✔ Connected` and say
what the key is: one API key, one user, `staff_ops`, marked as held by an agent. Say the URL is
the deployed application, not a local server.

**Beat 1, what is broken right now.**

> Use the corgi-trial server. List the open reconciliation breaks and tell me, in one sentence,
> what they are and whether any clearing account is not zero.

Expect `list_reconciliation_breaks`: **20 open breaks, every one of them `provider_only` on the
`stripe` source**, and **all four clearing balances at $0.00** (`premium_receivable`,
`refund_payable`, `claims_payable`, `unapplied_customer_cash`). The tool also returns the recent
runs, failed ones included, because a failed run is not zero breaks. What to say: the breaks are
the sandbox probe PaymentIntents that were created in Stripe by the check scripts and never
belonged to a policy, and the reconciliation names them instead of hiding them. Panel screen:
none needed; `/ops/reconciliation` shows the same 20 if they ask.

**Beat 2, the policy as it stood on a date.**

> Read policy CGP-01274 as it stood on 2026-09-20, then as it stood on 2026-11-01.

Expect two calls to `get_policy_as_of`. On 2026-09-20: **issued**, term 2026-09-17 to
2027-09-17, annual premium **$2,312.00** (231200 cents), premium tax **$54.33** at 235 basis
points, policy fee **$25.00**, total if written that day **$2,391.33**. On 2026-11-01:
**cancelled**, `cancelledEffectiveAt` **2026-10-31**, every other figure identical. What to say:
same rows, two business dates, two answers; the figures are rebuilt from the policy's immutable
events, not read from a cache.

> **Demo trap, know it before the panel finds it.** Ask for CGP-01274 without a date and the tool
> refuses with `no issued policy event effective on or before 2026-09-08`: this policy's term
> starts on 2026-09-17, which is still in the future today. That is correct behaviour (business
> time, not recording time) but it looks like a bug on a projector. **Always pass `asOf`
> for CGP-01274.** Policy **CGP-01707**, bound by Yoann today, answers with no `asOf` at all:
> issued, term 2026-09-08 to 2027-09-08, premium **$1,200.00**, tax **$28.20**, fee **$25.00**,
> total **$1,253.20**, limits $1,000,000 per occurrence and $2,000,000 aggregate. Use CGP-01707
> if you want the no-argument version.

**Beat 3, a published statement, unchanged since it was published.**

> Read the Redwood Commercial Brokers statement for 2026-09.
> The broker id is edae60d2-2192-4347-8083-945818e10ce8.

Expect `get_broker_statement`: **revision 3**, provisional (September is not over), knowledge
cutoff **2026-09-08T17:26:29.529Z**, content hash **799dcbe10d49f428...**, format version 2,
supersedes run `5321274f-b35e-46ae-997c-35364969ca90`. Totals: cash collected **$5,948.17**,
premium collected **$5,762.75**, commission earned **$864.41**, clawback **$475.06**, net due
**$389.35**. Every line names the journal entry that proves it, including the reversal of
CGP-01061 as a negative line with its reason on the line itself. What to say: the tool reads a
stored run, it recomputes nothing, and asking again in a year gives the same figures.

**Beat 4, the agent asks for money.**

> Ask for a payment of $1,200.00 on claim CLM-00212.

Expect `request_claim_payment` with `amountCents: 120000` (the schema says integer cents, never
dollars). The answer: `approvalRequestCreated: true`, an `approvalRequestId`, `raisedByAgent:
true`, **`moneyMoved: false`**, `thresholdUsed: $1,000.00`, and `mustBeDecidedBy: "a user with
the role staff_approver, who cannot be Sam Patel, operations (the requester)"`. What to say:
$1,200 is above $1,000 on its own, **and** the claim has already paid $1,200, so the cumulative
per-claim rule of decision 17 would have queued it even at $600.

**Beat 5, the panel sees it land, marked.** Open `/ops/approvals` signed in as
`ops@example.com`. The request is there for **$1,200.00, claim payment**, asked by Sam Patel,
operations, with **`raised by an AGENT`** and **`MCP API key cmk_e96f88a4 (agent)`** next to it,
the exact canonical intent that was hashed, and its sha256. Say: the approver reads that a
machine asked before deciding anything.

**Beat 6, the agent cannot approve.** Section 5 below, live, in this order: no tool, then the
bearer key on the human endpoint, then the two database triggers as facts.

**Beat 7, why, in the agent's own words.**

> What are you not allowed to do on this server?

Expect the model to read the `policy.neverDelegated` block that came back with `tools/list`
(section 6). The list is part of the surface, so the agent states its own limits.

## 4. Expected figures on today's trial data, in one table

| Fact | Value on 2026-09-08 |
|---|---|
| Open reconciliation breaks | 20, all `provider_only`, source `stripe` |
| Clearing balances | all four $0.00 |
| CGP-01274 | Redwood / Santa CaFE, term 2026-09-17 to 2027-09-17, premium $2,312.00, tax $54.33, fee $25.00, total $2,391.33, cancelled effective 2026-10-31 |
| CGP-01274 with no `asOf` | refused: the term starts after today. Pass `asOf` |
| CGP-01707 | Redwood / Bay Area Fabrication LLC, bound today, term 2026-09-08 to 2027-09-08, premium $1,200.00, tax $28.20, fee $25.00, total $1,253.20 |
| Redwood 2026-09 statement | revision 3, provisional, hash `799dcbe10d49f428...`, cash $5,948.17, premium $5,762.75, commission $864.41, clawback $475.06, net due $389.35 |
| Claim CLM-00212 | open, on CGP-01274, claimant Bay Area Fabrication LLC, reserve $3,800.00, paid $1,200.00, incurred $5,000.00 |
| Threshold | $1,000.00, cumulative per claim (an assumption of this build, not a Corgi rule) |

These are live figures. Reconciliation runs daily at 06:00 UTC and anyone can run it from
`/ops/reconciliation`, so the break count can move; the four clearing balances at zero is the
number that matters. Re-read this table before the debrief and correct anything that changed.

## 5. The "agent cannot approve" moment, four proofs

Run the first two live. State the last two; they are database facts and the check script proves
them.

**1. There is no approve tool.** Ask the model to approve its own request. The server answers:

```json
{"jsonrpc":"2.0","id":9,"error":{"code":-32602,"message":"unknown tool \"approve_claim_payment\""}}
```

`tools/list` returns five tools and none of them decides anything. The name is not hidden, it
does not exist.

**2. The key does not work on the human endpoint.** `POST /api/approvals/<requestId>` with
`Authorization: Bearer <the agent key>` and no session cookie:

```
HTTP/2 303
location: /login?error=Please+sign+in+again
```

`app/api/approvals/[requestId]/route.ts` calls `currentUser()`, which reads the signed
`corgi_session` cookie and nothing else. It never looks at an Authorization header, so the key
that opens the MCP surface is not a credential there at all.

**3. The 0008 trigger refuses any decider who is not an approver.** `db/migrations/0008`, the
trigger on `approval_decisions`, raises `maker-checker: only a staff_approver may decide a
money-out request; user % has the role %`. A user whose role is `agent` fails that test, through
the most privileged connection there is.

**4. The 0018 trigger refuses an agent key for an approver.** `db/migrations/0018`, the trigger
`mcp_api_keys_agent_is_never_an_approver`, raises `mcp key: an agent principal cannot hold a
staff_approver key; agents never approve money out`. So the door is shut from the other side
too: an agent never holds an approver's visibility in the first place.

The sentence to say: an agent asks, a person decides, and that is enforced in four independent
places, one of which is the database itself.

## 6. The never-delegated list, exactly as `tools/list` returns it

`tools/list` carries a `policy` object next to `tools`. Its `summary`:

> Read tools answer with exactly what the key's user may see. The only write tool puts a claim
> payment into the human approval queue: it never moves money. Approving, sending, binding,
> cancelling, correcting, publishing a statement, changing KYB and managing API keys are never
> delegated to an agent.

Its `neverDelegated` array, ten entries, each with a reason (read back from production on
2026-09-08 at 19:12Z):

1. approve or reject a money-out request
2. send a claim payment on the payout rail
3. issue or re-issue a refund at Stripe
4. bind a policy
5. cancel a policy
6. void a binding or record a correction
7. run or publish a broker statement
8. change a broker's KYB status, or submit a verification
9. create, revoke or read an MCP API key
10. replay a webhook, or write anything into the ledger directly

The same list is printed on `/ops/mcp-keys`, summarised in the `initialize` instructions a client
shows the model, and asserted by a unit test that no tool is named after one of these
(`lib/mcp/never-delegated.test.ts`). It is code, not prose, so it cannot drift from the surface.

## 7. Rehearsal facts on the trial database

Run once against production on 2026-09-08. Nothing is hidden; the panel may see all of it. **No
money moved and no row was updated or deleted: a rejection is an appended decision.**

| Fact | Value |
|---|---|
| Endpoint | `https://corgi-work-trial-iota.vercel.app/api/mcp` |
| Deployed revision at the start | `5f2c841abba79d4a2929e73ca34efd16bc276c50` |
| Deployed revision at the end | `c5bcf2aeb6091713250fac73ceb04060fef834be` (another slice deployed at about 19:18Z, mid-rehearsal; see the note below) |
| Key used | prefix `cmk_e96f88a4`, holder `ops@example.com`, kind `agent` |
| Protocol negotiated | `2025-06-18` with curl, `2025-11-25` with the Inspector |
| Claim | CLM-00212 on CGP-01274, reserve $3,800.00, paid $1,200.00, incurred $5,000.00, before and after |
| Amount requested | 120000 cents, $1,200.00 |
| Money operation id | `3c1484cf-759f-441f-943a-6d2764e6d21f` |
| Approval request id | `8148a717-5ad2-4e0e-9486-ff6ffeec05fd` |
| Requested at | 2026-09-08T19:13:53Z, by Sam Patel, operations, through the agent key |
| Canonical intent | `kind=claim_payment` / `subject=claim:2f78c23c-17fc-4746-85dd-77f64d6db45a` / `amount_cents=120000` / `destination=simulated_bank_account:sim_ba_acf099c0d5bf30a04b6d0cefd2d816ec` |
| Intent sha256 | `d8e5b1b77ed7f56ef599a0cd78552b5210ef10a7a59f3ed067d01d0acd1b7fae` |
| Shown on `/ops/approvals` | "Raised by an AGENT. MCP API key cmk_e96f88a4 (agent)." |
| No approve tool, checked at | 2026-09-08T19:14:17Z, `-32602 unknown tool "approve_claim_payment"` |
| Bearer key on `/api/approvals`, checked at | 2026-09-08T19:14:17Z, `303 -> /login?error=Please+sign+in+again` |
| Rejected at | 2026-09-08T19:15:20Z by Alex Kim, approver (`approver@example.com`) |
| Rejection reason | `B12-1 rehearsal: agent-raised request rejected on purpose` |
| Claim after the rejection | reserve $3,800.00, paid $1,200.00, incurred $5,000.00, unchanged |

**The queue is clean for the debrief**: after the rejection, `/ops/approvals` shows "Nothing is
waiting" under "Waiting for a decision".

**About the two revisions.** Production was redeployed by another slice while this rehearsal was
running. The data facts above are unaffected, but the two approvals screenshots show two
different layouts of the same screen: `03-...waiting.png` is revision `5f2c841` (one card per
request) and `04-...rejected.png` is revision `c5bcf2a` (a "Waiting for a decision" section and
an "Already decided" table with a `raised by an AGENT` pill). **Both carry the agent marker and
the key prefix**, which is what the demo depends on. Check the current screen once before the
debrief rather than trusting a screenshot's layout.

## 8. Sanitized transcript

Every request below is a `POST` to `$MCP` with `Content-Type: application/json` and
`Authorization: Bearer $MCP_KEY`. **The key is written `cmk_e96f88a4_...` everywhere; the real
value was read from the ignored local file straight into the client and was never printed.**
Answers are trimmed to the fields the demo uses; the full ones came back from production.

```
$ export MCP=https://corgi-work-trial-iota.vercel.app/api/mcp
$ export MCP_KEY='cmk_e96f88a4_...'          # read from .local/mcp-demo-key.txt, never echoed
```

**initialize**

```json
--> {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"8"}}}
<-- {"jsonrpc":"2.0","id":1,"result":{
      "protocolVersion":"2025-06-18",
      "capabilities":{"tools":{}},
      "serverInfo":{"name":"corgi-policy-admin","title":"Corgi policy administration (trial)","version":"0.1.0"},
      "instructions":"Corgi policy administration, work-trial build. Sandbox data only. ... The only write tool puts a claim payment into the human approval queue: it never moves money. Approving, sending, binding, cancelling, correcting, publishing a statement, changing KYB and managing API keys are never delegated to an agent. ..."}}
```

**tools/list**

```json
--> {"jsonrpc":"2.0","id":2,"method":"tools/list"}
<-- {"tools":[
      {"name":"get_policy_as_of","title":"Policy as of a date"},
      {"name":"get_broker_statement","title":"Broker monthly statement"},
      {"name":"list_reconciliation_breaks","title":"Open reconciliation breaks"},
      {"name":"run_reconciliation","title":"Run the reconciliation job"},
      {"name":"request_claim_payment","title":"Request a claim payment (approval queue only)"}],
    "policy":{"summary":"Read tools answer with exactly what the key's user may see. ...",
              "neverDelegated":[ ... 10 entries, each with its reason ... ]}}
```

**get_policy_as_of, twice on the same policy**

```json
--> {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_policy_as_of","arguments":{"policyNumber":"CGP-01274","asOf":"2026-09-20"}}}
<-- {"policyNumber":"CGP-01274","asOf":"2026-09-20","status":"issued","cancelledEffectiveAt":null,
     "broker":"Redwood Commercial Brokers","insured":"Santa CaFE","state":{"code":"CA","name":"California"},
     "term":{"start":"2026-09-17","end":"2027-09-17"},
     "annualPremium":{"cents":231200,"formatted":"$2,312.00"},
     "premiumTax":{"cents":5433,"formatted":"$54.33","rateBasisPoints":235},
     "policyFee":{"cents":2500,"formatted":"$25.00"},
     "totalChargeIfWrittenToday":{"cents":239133,"formatted":"$2,391.33"},
     "endorsementsApplied":[],
     "whatThisMeans":"On 2026-09-20, policy CGP-01274 was issued with an annual premium of $2,312.00 and 0 endorsement(s) applied. ..."}

--> {"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_policy_as_of","arguments":{"policyNumber":"CGP-01274","asOf":"2026-11-01"}}}
<-- {"policyNumber":"CGP-01274","asOf":"2026-11-01","status":"cancelled","cancelledEffectiveAt":"2026-10-31", ... same figures ... }

--> {"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_policy_as_of","arguments":{"policyNumber":"CGP-01274"}}}
<-- {"content":[{"type":"text","text":"no issued policy event effective on or before 2026-09-08"}],"isError":true}
```

**get_broker_statement**

```json
--> {"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"get_broker_statement","arguments":{"brokerId":"edae60d2-2192-4347-8083-945818e10ce8","month":"2026-09"}}}
<-- {"runId":"c775c8ce-34a3-48a3-bea5-558b4d63a546",
     "broker":{"id":"edae60d2-2192-4347-8083-945818e10ce8","name":"Redwood Commercial Brokers"},
     "month":"2026-09","revision":3,"supersedesRunId":"5321274f-b35e-46ae-997c-35364969ca90",
     "knowledgeCutoff":"2026-09-08T17:26:29.529Z",
     "contentHash":"799dcbe10d49f4289dbad95a2f7358e8db9bf1e16c40392024accd30fab37012",
     "formatVersion":2,"provisional":true,
     "totals":{"cashCollected":{"cents":594817,"formatted":"$5,948.17"},
               "premiumCollected":{"cents":576275,"formatted":"$5,762.75"},
               "commissionEarned":{"cents":86441,"formatted":"$864.41"},
               "clawback":{"cents":47506,"formatted":"$475.06"},
               "netDue":{"cents":38935,"formatted":"$389.35"}},
     "lines":[ ... one line per journal entry, the CGP-01061 reversal among them ... ]}
```

**list_reconciliation_breaks**

```json
--> {"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"list_reconciliation_breaks","arguments":{}}}
<-- {"openBreakCount":20,
     "breaks":[{"source":"stripe","classification":"provider_only",
                "providerRef":"pi_3UDKjJK6R3v50tIy0nLbDPOc",
                "difference":{"cents":10000,"formatted":"$100.00"},"openFor":"1 hour", ...}, ...],
     "clearingBalances":[{"account":"premium_receivable","openBalance":{"cents":0,"formatted":"$0.00"},"isZero":true},
                         {"account":"refund_payable","openBalance":{"cents":0,"formatted":"$0.00"},"isZero":true},
                         {"account":"claims_payable","openBalance":{"cents":0,"formatted":"$0.00"},"isZero":true},
                         {"account":"unapplied_customer_cash","openBalance":{"cents":0,"formatted":"$0.00"},"isZero":true}],
     "recentRuns":[ ... last runs of each source, failed ones included ... ],
     "whatThisMeans":"20 break(s) are open. ... Reading this changes nothing: reconciliation appends runs and items and never touches a money row."}
```

**request_claim_payment, the only write, at 19:13:53Z**

```json
--> {"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"request_claim_payment","arguments":{"claimNumber":"CLM-00212","amountCents":120000}}}
<-- {"claimNumber":"CLM-00212","policyNumber":"CGP-01274",
     "amount":{"cents":120000,"formatted":"$1,200.00"},
     "moneyOperationId":"3c1484cf-759f-441f-943a-6d2764e6d21f",
     "approvalRequestCreated":true,
     "approvalRequestId":"8148a717-5ad2-4e0e-9486-ff6ffeec05fd",
     "mustBeDecidedBy":"a user with the role staff_approver, who cannot be Sam Patel, operations (the requester)",
     "raisedByAgent":true,
     "moneyMoved":false,
     "thresholdUsed":{"cents":100000,"formatted":"$1,000.00"},
     "whatThisMeans":"The payment of $1,200.00 on claim CLM-00212 is waiting in the approval queue. Nothing has left: no journal entry was posted and nothing was sent to the payout rail. ... The threshold is cumulative per claim: what the claim has already paid and what is still waiting count with this amount."}
```

**the agent tries to approve, at 19:14:17Z**

```json
--> {"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"approve_claim_payment","arguments":{"approvalRequestId":"8148a717-5ad2-4e0e-9486-ff6ffeec05fd","decision":"approved"}}}
<-- {"jsonrpc":"2.0","id":9,"error":{"code":-32602,"message":"unknown tool \"approve_claim_payment\""}}
```

**the key on the human endpoint, at 19:14:17Z**

```
$ curl -i -X POST "$APP/api/approvals/8148a717-5ad2-4e0e-9486-ff6ffeec05fd" \
    -H "Authorization: Bearer $MCP_KEY" \
    --data-urlencode "decision=approved" --data-urlencode "reason=agent trying to approve"

HTTP/2 303
location: /login?error=Please+sign+in+again
```

**a human rejects it, at 19:15:20Z**, signed in as `approver@example.com` with a session cookie,
form POST to the same endpoint, `decision=rejected`, reason
`B12-1 rehearsal: agent-raised request rejected on purpose` -> `303 /ops/approvals?decided=rejected`.
The screen then reads: `rejected by Alex Kim, approver on 2026-09-08T19:15:20 UTC, reason: B12-1
rehearsal: agent-raised request rejected on purpose`.

## 9. Evidence

`docs/evidence/b12-1/`, four PNGs, each one inspected before it was committed; none shows a
secret, a session cookie or the Inspector's own token.

| File | What it shows |
|---|---|
| `01-inspector-connected.png` | MCP Inspector 2.5.0 connected to the production endpoint over Streamable HTTP, protocol `MCP 2025-11-25`, `INITIALIZE` 312 ms OK and `TOOLS/LIST` 168 ms OK in the message log |
| `02-inspector-tools-list.png` | the five tools as a real client lists them |
| `03-approvals-agent-raised-waiting.png` | `/ops/approvals` as `approver@example.com` on revision `5f2c841`: the $1,200.00 request, "Raised by an AGENT. MCP API key cmk_e96f88a4 (agent)", the canonical intent, its sha256, and the Approve/Reject buttons |
| `04-approvals-agent-raised-rejected.png` | `/ops/approvals` as `ops@example.com` on revision `c5bcf2a`: nothing waiting, and the request in "Already decided" with the `raised by an AGENT` pill and the rejection with its reason |

## 10. Ce que tu dis (trois phrases, en français)

1. « Ce que vous voyez est un vrai client MCP branché sur l'application déployée, avec une clé
   d'API portée par un agent : il lit les écarts de rapprochement, une police à une date donnée
   et un relevé courtier déjà publié, exactement ce que l'utilisateur derrière la clé a le droit
   de voir, rien de plus. »
2. « L'agent demande un paiement de sinistre de 1 200 dollars : rien ne bouge, aucune écriture
   n'est passée, la demande arrive dans la file d'approbation humaine marquée "levée par un
   agent" avec le préfixe de la clé, parce que 1 200 dépasse le seuil de 1 000 et que le seuil
   est cumulé par sinistre. »
3. « Et l'agent ne peut pas approuver : il n'existe aucun outil pour ça, sa clé n'ouvre pas
   l'endpoint humain qui ne lit que le cookie de session, et deux déclencheurs en base refusent
   un décideur qui n'est pas approbateur et refusent même de créer une clé d'agent pour un
   approbateur. »

## 11. What was NOT verified, and one thing to watch

- **Claude Desktop.** Not tried. It needs an stdio bridge (`mcp-remote`); the CLI and the
  Inspector cover the debrief without it.
- **A second key to show tenant isolation.** Not created. Slice B11 proved broker and customer
  scoping over HTTP against the disposable database (`npm run check:mcp`), not on production. If
  Yoann wants that on stage, create a broker key on `/ops/mcp-keys` and put its secret in
  `.local/` next to this one; the demo then shows a broker key refused on
  `list_reconciliation_breaks` and on another broker's policy.
- **`run_reconciliation` was not called on production by this slice.** It moves no money, but it
  spends Stripe sandbox calls and would change the break count in the middle of the demo. If it
  is used on stage, call it before beat 1, not after.
- **Concurrency and rate limiting.** Unchanged from B11: there is none, and every call is logged
  in `mcp_calls`.
- **Independent review of this slice.** Not performed by this delegate, by design.
- **Walkthrough with Yoann: NOT REVIEWED WITH YOANN.**
- **One thing to watch, no code change proposed.** `get_policy_as_of` with no `asOf` on a policy
  whose term starts in the future refuses with `no issued policy event effective on or before
  <today>`. That is right: `asOf` is business time, and on 2026-09-08 nothing was in force yet.
  It reads as a failure on a projector, though. The sentence comes from `foldPolicyEvents` in
  `lib/documents/policy-as-of.ts` line 175, which the declarations PDF also uses, so it should
  not be changed there. **Proposed fix, for the coordinator to decide, not applied here**: in
  `lib/mcp/tools/policy-as-of.ts`, in the `catch` around line 88 that already turns that error
  into a `ToolRefused`, append the policy's first `issued` effective date, which the tool has
  just read: `no issued policy event effective on or before 2026-09-08; this policy's first
  effective date is 2026-09-17`. It touches one refusal string in one read tool, no shared
  function and no money code. Until then, the demo script passes `asOf`.
