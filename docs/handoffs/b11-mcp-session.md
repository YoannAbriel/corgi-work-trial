# B11: an MCP session over HTTP, as it really ran

Recorded by the B11 delegate on 2026-09-08 against a dev server on port 3800 pointed at the
DISPOSABLE database (`corgi_test`), with a key created for the demo `ops@example.com` user of
that database. Every answer below is copied from the terminal. **The key value is replaced by
`$MCP_KEY` everywhere: the real one was created on a disposable database, was never written into
a file this repository tracks, and is not needed to replay this.** Create your own first.

The endpoint is one POST. There is no SDK on the server side (see the header of
`lib/mcp/jsonrpc.ts` for why), so a client is either a real MCP client speaking streamable HTTP
or, as here, `curl`.

## 0. Create a key, then put it in a shell variable

```
$ npm run create-mcp-key -- --email=ops@example.com --label="curl session" --kind=agent --database=test

key created for   Ops (test db) (staff_ops), ops@example.com
label             curl session
holder            an autonomous agent
prefix            cmk_4ccf5179    (public, shown on /ops/mcp-keys)

THE SECRET, SHOWN ONCE AND NEVER STORED. Put it in your MCP client configuration now:

  cmk_4ccf5179_<43 characters, printed once, not reproduced here>

Use it as: Authorization: Bearer <that value>   against POST /api/mcp
Do not paste it into a document, a ticket, a screenshot or a commit.
```

```
$ export MCP_KEY='cmk_...'      # the value above, from your own run
$ export MCP=http://localhost:3800/api/mcp
```

Drop `--database=test` to create one against the trial database, and use the deployed URL as
`$MCP`. The same key works for a real MCP client: the transport is streamable HTTP with a bearer
token, and this server answers `application/json` rather than opening an SSE stream, which the
specification allows.

## 1. initialize

```
$ curl -s -X POST $MCP -H "Authorization: Bearer $MCP_KEY" -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"8"}}}'
```

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-06-18",
    "capabilities": { "tools": {} },
    "serverInfo": {
      "name": "corgi-policy-admin",
      "title": "Corgi policy administration (trial)",
      "version": "0.1.0"
    },
    "instructions": "Corgi policy administration, work-trial build. Sandbox data only. Read tools answer with exactly what the key's user may see. The only write tool puts a claim payment into the human approval queue: it never moves money. Approving, sending, binding, cancelling, correcting, publishing a statement, changing KYB and managing API keys are never delegated to an agent. Every amount is in integer US cents; each figure also carries a formatted string. Every answer carries a whatThisMeans sentence: read it before reporting a figure."
  }
}
```

The server answers with the revision the client asked for when it knows it (`2025-11-25`,
`2025-06-18` and `2025-03-26`), otherwise with its own. Only `tools` is offered: no resources,
no prompts, no sampling, so a client never proposes them.

## 2. tools/list, and the never-delegated list that comes with it

```
$ curl -s -X POST $MCP -H "Authorization: Bearer $MCP_KEY" -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

```json
{
  "tools": [
    { "name": "get_policy_as_of",           "title": "Policy as of a date" },
    { "name": "get_broker_statement",       "title": "Broker monthly statement" },
    { "name": "list_reconciliation_breaks", "title": "Open reconciliation breaks" },
    { "name": "run_reconciliation",         "title": "Run the reconciliation job" },
    { "name": "request_claim_payment",      "title": "Request a claim payment (approval queue only)" }
  ],
  "policy": {
    "summary": "Read tools answer with exactly what the key's user may see. The only write tool puts a claim payment into the human approval queue: it never moves money. Approving, sending, binding, cancelling, correcting, publishing a statement, changing KYB and managing API keys are never delegated to an agent.",
    "neverDelegated": [
      {
        "operation": "approve or reject a money-out request",
        "reason": "maker-checker exists so that a second HUMAN looks at money leaving. An agent deciding would be the same actor twice. There is no tool for it, the approval route accepts session cookies only, and the database refuses a decision by anyone whose role is not staff_approver."
      }
      // 9 more, one per operation, each with its reason
    ]
  }
}
```

The full tool entry carries its argument schema, closed to unknown fields:

```json
{
  "name": "get_policy_as_of",
  "title": "Policy as of a date",
  "description": "The policy as it stood on a business date: status, term, annual premium in force, state premium tax, policy fee, coverage limits and every endorsement applied by that date. Rebuilt from the policy's immutable events, not from a cache. Scoped to what this API key's user may see.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "policyNumber": { "type": "string", "description": "The policy number, for example CGP-01274." },
      "asOf": { "type": "string", "description": "Business date, YYYY-MM-DD. Defaults to today (UTC). This is an effective date, not a recording date." }
    },
    "required": ["policyNumber"],
    "additionalProperties": false
  }
}
```

## 3. get_policy_as_of

```
$ curl -s -X POST $MCP -H "Authorization: Bearer $MCP_KEY" -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_policy_as_of","arguments":{"policyNumber":"CGP-04084","asOf":"2028-03-01"}}}'
```

The result carries the same object twice: as `structuredContent` for a client that reads
structured output, and as pretty JSON text in `content[0].text` for a model that reads text.
The text:

```json
{
  "policyNumber": "CGP-04084",
  "asOf": "2028-03-01",
  "status": "issued",
  "cancelledEffectiveAt": null,
  "broker": "MCP check broker B",
  "insured": "MCP check other customer",
  "state": { "code": "CA", "name": "California" },
  "term": { "start": "2028-03-01", "end": "2029-03-01" },
  "annualPremium": { "cents": 120000, "formatted": "$1,200.00" },
  "annualPremiumAtIssuance": { "cents": 120000, "formatted": "$1,200.00" },
  "premiumTax": { "cents": 2820, "formatted": "$28.20", "rateBasisPoints": 235 },
  "policyFee": { "cents": 2500, "formatted": "$25.00" },
  "totalChargeIfWrittenToday": { "cents": 125320, "formatted": "$1,253.20" },
  "coverageLimits": [
    { "name": "General Liability - Each Occurrence", "limit": { "cents": 1000000, "formatted": "$10,000.00" }, "description": "Bodily injury and property damage arising from operations." },
    { "name": "General Liability - Aggregate", "limit": { "cents": 1500000, "formatted": "$15,000.00" }, "description": "Total payable for the policy term." }
  ],
  "endorsementsApplied": [],
  "generatedAt": "2026-09-08T18:17:01.799Z",
  "whatThisMeans": "On 2028-03-01, policy CGP-04084 was issued with an annual premium of $1,200.00 and 0 endorsement(s) applied. These are business-time facts: an endorsement recorded later but effective before this date is included, and the money actually charged and collected is in the ledger, not on this answer."
}
```

With a BROKER key on another broker's policy, and with any key on a policy number that does not
exist, the answer is the same sentence, so the tool cannot be used to discover policy numbers:

```json
{ "content": [{ "type": "text", "text": "no policy with that number is visible to this key" }], "isError": true }
```

## 4. get_broker_statement

```
$ curl -s -X POST $MCP -H "Authorization: Bearer $MCP_KEY" -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_broker_statement","arguments":{"brokerId":"584c5b32-...","month":"2028-03"}}}'
```

```json
{
  "runId": "a6dffce5-b62e-4ee7-9258-92c80ab325bf",
  "broker": { "id": "584c5b32-...", "name": "MCP check broker A" },
  "month": "2028-03",
  "revision": 1,
  "supersedesRunId": null,
  "identicalToPrevious": false,
  "knowledgeCutoff": "2026-09-08T18:15:44.842Z",
  "contentHash": "a3e42bbab93b40862187c85be350f1a8c94948d6a5cda251336d802643195dda",
  "formatVersion": 2,
  "formatNote": null,
  "provisional": true,
  "totals": {
    "cashCollected": { "cents": 125320, "formatted": "$1,253.20" },
    "premiumCollected": { "cents": 120000, "formatted": "$1,200.00" },
    "commissionEarned": { "cents": 18000, "formatted": "$180.00" },
    "clawback": { "cents": 0, "formatted": "$0.00" },
    "adjustment": { "cents": 0, "formatted": "$0.00" },
    "netDue": { "cents": 18000, "formatted": "$180.00" }
  },
  "lines": [
    { "order": 0, "kind": "premium_collected", "policyNumber": "CGP-04081", "journalEntryId": "23bc3471-...", "effectiveAt": "2028-03-01", "amount": { "cents": 125320, "formatted": "$1,253.20" }, "commissionBase": { "cents": 120000, "formatted": "$1,200.00" }, "description": "Policy CGP-04081 premium, tax and fee collected at Stripe" },
    { "order": 1, "kind": "commission_earned", "policyNumber": "CGP-04081", "journalEntryId": "7ca2a930-...", "effectiveAt": "2028-03-01", "amount": { "cents": 18000, "formatted": "$180.00" }, "commissionBase": null, "description": "Broker commission on the collected premium of policy CGP-04081" }
  ],
  "whatThisMeans": "MCP check broker A is owed $180.00 for 2028-03 on revision 1. Net due is the movement of this broker's commission_payable account in that month, so it ties to the ledger to the cent. The month was still running when this run was made, so it is provisional: a later run of the same month is the definitive one. A correction recorded after the knowledge cutoff is invisible here and appears in a new revision."
}
```

A broker key passes `"brokerId": "me"`. A staff key passing `"me"` is refused
(`a staff key has no broker of its own; pass the broker id`), and a broker key naming another
broker is refused too (`a broker key can only read its own statements; pass "me"`).

## 5. list_reconciliation_breaks (staff keys only)

```
$ curl -s -X POST $MCP -H "Authorization: Bearer $MCP_KEY" -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"list_reconciliation_breaks","arguments":{"source":"claims_rail"}}}'
```

```json
{
  "openBreakCount": 36,
  "breaks": [
    {
      "source": "claims_rail",
      "classification": "provider_only",
      "breakKey": "claims_rail|provider_only|sim_tr_planted_1788879025758",
      "providerRef": "sim_tr_planted_1788879025758",
      "ledgerRef": null,
      "providerAmount": { "cents": -90000, "formatted": "-$900.00" },
      "ledgerAmount": null,
      "difference": { "cents": -90000, "formatted": "-$900.00" },
      "firstSeenAt": "2026-09-08T14:51:31.514Z",
      "openFor": "3 hours",
      "lastReportedAt": "2026-09-08T18:16:21.659Z",
      "meaning": "the provider shows a settled claim payout of 90000 cents with no cash movement in the ledger; it carries no operation id at all"
    }
  ],
  "clearingBalances": [
    { "account": "premium_receivable", "meaning": "premium billed and not yet collected", "openBalance": { "cents": 207954, "formatted": "$2,079.54" }, "isZero": false, "lastMovedOn": "2029-01-01" },
    { "account": "refund_payable", "meaning": "refunds owed to customers and not yet completed at Stripe", "openBalance": { "cents": 23691974, "formatted": "$236,919.74" }, "isZero": false, "lastMovedOn": "2029-02-28" }
  ],
  "recentRuns": [ "... the last runs of that source, failed ones included, with their window and counts ..." ],
  "whatThisMeans": "36 break(s) are open. A break is one record the last complete run could not match between a provider's own records and our ledger; its age is how long it has been reported. A clearing balance that is not zero is money in flight or stuck, whatever the comparison window was. Reading this changes nothing: reconciliation appends runs and items and never touches a money row."
}
```

The figures above come from the disposable database, which every check script writes fixtures
into: the counts are large because a dozen other checks have run against it, not because the
trial ledger is in that state.

A broker key or a customer key is refused: `only staff can read reconciliation breaks; this key
belongs to a "broker"`.

## 6. request_claim_payment: the only write tool, and it moves no money

```
$ curl -s -X POST $MCP -H "Authorization: Bearer $MCP_KEY" -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"request_claim_payment","arguments":{"claimNumber":"CLM-02338","amountCents":120000}}}'
```

```json
{
  "claimNumber": "CLM-02338",
  "policyNumber": "CGP-04081",
  "amount": { "cents": 120000, "formatted": "$1,200.00" },
  "moneyOperationId": "ffe96a2a-553b-4480-9740-9d0d0d02090a",
  "approvalRequestCreated": true,
  "approvalRequestId": "c39d1b73-4f94-42b4-a78d-9409b2785661",
  "mustBeDecidedBy": "a user with the role staff_approver, who cannot be Ops (test db) (the requester)",
  "raisedByAgent": true,
  "moneyMoved": false,
  "thresholdUsed": { "cents": 100000, "formatted": "$1,000.00" },
  "whatThisMeans": "The payment of $1,200.00 on claim CLM-02338 is waiting in the approval queue. Nothing has left: no journal entry was posted and nothing was sent to the payout rail. A staff approver who is not the requester must approve it on /ops/approvals, and a staff operator then sends it. This tool cannot do either. The threshold is cumulative per claim: what the claim has already paid and what is still waiting count with this amount."
}
```

On `/ops/approvals` that request now reads, above the two buttons:

> **How it was raised**: **Raised by an AGENT.** MCP API key cmk_4ccf5179 (agent). The person
> named above holds that key; an agent principal can never approve a money-out.

Verified in the same session: the journal entry count is identical before and after, and the
money operation's latest status is still `requested`.

## 7. Authentication

```
$ export WRONG_KEY='cmk_deadbeef_' followed by 43 characters that were never issued
$ curl -s -i -X POST $MCP -H "Authorization: Bearer $WRONG_KEY" \
    -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":7,"method":"tools/list"}'

HTTP/1.1 401 Unauthorized
content-type: application/json
www-authenticate: Bearer realm="corgi-mcp"

{"error":"unauthorized"}
```

No key, an unknown key and a REVOKED key give byte-for-byte the same answer. All three are
written into `mcp_calls`; the revoked one names the key that made it, the unknown one names
nothing, because nothing from the presented value is stored.

```
$ curl -s -X GET $MCP -H "Authorization: Bearer $MCP_KEY"
{"error":"this MCP endpoint answers POST only: it opens no server-to-client stream"}   (405)
```

## 8. The staff screen, in the same session

Signed in as `ops@example.com` with the demo password:

| Call | Answer |
|---|---|
| `GET /ops/mcp-keys`, no session | 307 to `/login` |
| `POST /api/mcp-keys`, no session | 303 to `/login?error=Please+sign+in+again` |
| `GET /ops/mcp-keys`, staff | 200: the keys with their prefix, holder, kind, call count, last call, and the never-delegated list |
| `POST /api/mcp-keys` action=create | 200 HTML, "Key cmk_b7c9ca43 created", the secret shown once, not in the URL |
| `POST /api/mcp-keys` action=revoke | 303 to `/ops/mcp-keys?revoked=1` |
| the same revoke again | 303 with "this key was already revoked" |
| revoke with an id that is not a key | 303 with "this key does not exist" |

## 9. How to replay this against the deployed application

1. The coordinator applies migration `0018_mcp_api_keys.sql` to the trial database and deploys.
2. Sign in as staff on the deployed URL, open `/ops/mcp-keys`, create one key per demo identity
   (broker, customer, staff operations), copy each secret once into wherever it belongs, and do
   not paste it anywhere else. `scripts/create-mcp-key.ts` does the same from a terminal.
3. Point `$MCP` at `https://<deployed host>/api/mcp` and replay sections 1 to 7.
4. A real MCP client (an Inspector, or Claude Desktop with a streamable HTTP server entry) needs
   the same two things: the URL and the bearer token. **Not done by this delegate: no run
   against a real MCP client, only curl.** The transport is the specification's, and every shape
   above was read back from the running server, but a client's own handshake has not been seen.
