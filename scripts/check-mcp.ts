import postgres from "postgres";

// Proves the MCP surface of slice B11 OVER HTTP, against a real server and a real database:
//
//   1. the transport: initialize, tools/list (with the never-delegated list), tools/call, ping,
//      a notification, an unknown method, an unsupported protocol version, GET;
//   2. authentication: no key, a wrong key and a REVOKED key all answer 401 with no detail;
//   3. scoping: a broker key sees its own policy and not another broker's, a customer key sees
//      the policy that covers it, a staff key sees everything, and the staff-only tools refuse
//      everybody else;
//   4. the write tool: a staff_ops key above the threshold creates an approval request and MOVES
//      NO MONEY (the journal is unchanged); a broker key is refused; an AGENT-flagged key has its
//      request marked as agent-raised, and that same principal is refused as an approver by the
//      application AND by the database trigger;
//   5. the reconciliation tool stores runs and posts no journal entry;
//   6. every single call is written down in mcp_calls, including the ones that were refused.
//
// IT NEEDS A DEV SERVER pointed at the disposable database. In one terminal:
//
//   DATABASE_URL_APP="$DATABASE_URL_TEST_APP" npm run dev -- -p 3800
//
// (an environment variable set on the command line wins over .env.local), then:
//
//   npm run check:mcp
//
// It commits rows, so it refuses to run anywhere but corgi_test: financial rows can never be
// deleted (AF-03) and the trial database must stay clean. Set MCP_BASE_URL to point elsewhere.

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on the environment
}

const ownerUrl = process.env.DATABASE_URL_TEST;
const runtimeUrl = process.env.DATABASE_URL_TEST_APP;
if (!ownerUrl || !runtimeUrl) {
  console.error("DATABASE_URL_TEST and DATABASE_URL_TEST_APP must be set: this check only runs on the disposable database");
  process.exit(1);
}
const baseUrl = process.env.MCP_BASE_URL ?? "http://127.0.0.1:3800";

// The worked example of the trial, one year of cover written on the first of March 2028.
const ANNUAL_PREMIUM_CENTS = 120000;
const TAX_CENTS = 2820;
const FEE_CENTS = 2500;
const TOTAL_CHARGE_CENTS = 125320;
const TERM_START = "2028-03-01";
const TERM_END = "2029-03-01";
const STATEMENT_MONTH = "2028-03";
const PER_OCCURRENCE_LIMIT_CENTS = 1000000; // $10,000
const AGGREGATE_LIMIT_CENTS = 1500000; // $15,000
const RESERVE_CENTS = 500000; // $5,000
const PAYMENT_CENTS = 120000; // $1,200, above the $1,000 money-out threshold
const REACHABLE_ROUTING_NUMBER = "110000000";
const CLAIMANT_NAME = "Bay Area Fabrication LLC";

let failures = 0;
function report(name: string, passed: boolean, detail: string) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}  (${detail})`);
  if (!passed) failures += 1;
}

const owner = postgres(ownerUrl, { max: 2, prepare: false });
const runtime = postgres(runtimeUrl, { max: 2, prepare: false });

// ---------------------------------------------------------------------------
// Talking to the endpoint
// ---------------------------------------------------------------------------

type JsonRpcAnswer = { status: number; body: Record<string, unknown> | null };

// Every POST this check sends is counted here, so the last check can compare the count with the
// number of rows the endpoint appended to mcp_calls: one row per call, exactly.
let postsSent = 0;

// A value no date parser accepts, sent on purpose so the refusal and the audit row can be read
// back: neither of them may repeat it (review finding F-B11-02).
const MALFORMED_AS_OF = "not-a-date-but-a-long-string-a-caller-chose";

async function rpc(key: string | null, method: string, params?: unknown, id: number | null = 1): Promise<JsonRpcAnswer> {
  postsSent += 1;
  const response = await fetch(`${baseUrl}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(id === null ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params }),
  });
  const text = await response.text();
  return { status: response.status, body: text.length > 0 ? JSON.parse(text) : null };
}

// One tool call, unwrapped: the structured answer when it worked, the refusal text when it did
// not. Every tool answers both shapes (lib/mcp/jsonrpc.ts), and this is the caller's side of it.
type ToolAnswer = { ok: true; value: Record<string, unknown> } | { ok: false; refusal: string };

async function callTool(key: string, name: string, args: Record<string, unknown>): Promise<ToolAnswer> {
  const answer = await rpc(key, "tools/call", { name, arguments: args });
  const result = (answer.body as { result?: Record<string, unknown>; error?: { message: string } } | null)?.result;
  const error = (answer.body as { error?: { message: string } } | null)?.error;
  if (!result) {
    return { ok: false, refusal: error?.message ?? `no result: ${JSON.stringify(answer.body)}` };
  }
  if (result.isError === true) {
    const content = result.content as { text: string }[] | undefined;
    return { ok: false, refusal: content?.[0]?.text ?? "refused with no text" };
  }
  return { ok: true, value: result.structuredContent as Record<string, unknown> };
}

// Money figures come back as { cents, formatted }; this reads the integer.
function cents(value: unknown): number {
  return (value as { cents: number }).cents;
}

async function main() {
  const { openClaim, setClaimReserve } = await import("@/lib/claims/claims");
  const { addClaimantBankAccount } = await import("@/lib/claims/payments");
  const { recordSuccessfulPayment } = await import("@/lib/payments/collection");
  const { runStatement } = await import("@/lib/statements/run");
  const { createApiKey, revokeApiKey, KeyRefused } = await import("@/lib/mcp/keys");
  const { decideApprovalRequest, ApprovalRefused } = await import("@/lib/approvals/approvals");

  const [{ current_database: databaseName }] = await owner<{ current_database: string }[]>`select current_database()`;
  if (databaseName !== "corgi_test") {
    console.error(`refusing to run: connected to "${databaseName}", expected the disposable database "corgi_test"`);
    process.exit(1);
  }
  try {
    const health = await fetch(`${baseUrl}/api/health`);
    if (!health.ok) throw new Error(`answered ${health.status}`);
  } catch (error) {
    console.error(
      `no server at ${baseUrl}: ${error instanceof Error ? error.message : error}\n` +
        `start one against the disposable database with:\n` +
        `  DATABASE_URL_APP="$DATABASE_URL_TEST_APP" npm run dev -- -p 3800`,
    );
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // Fixtures: two brokers, a customer, the three staff people, one paid policy,
  // one claim with a reserve and a verified bank account, one statement.
  // -------------------------------------------------------------------------

  const people = await createPeople();
  const policy = await createPaidPolicy(recordSuccessfulPayment, people.brokerAId, people.customerId);
  const otherPolicy = await createPaidPolicy(recordSuccessfulPayment, people.brokerBId, people.otherCustomerId);

  const claim = await openClaim(
    {
      policyId: policy.policyId,
      occurredAt: "2028-05-01",
      reportedAt: "2028-05-02",
      openedOn: "2028-05-02",
      description: "water damage in the workshop",
      claimantName: CLAIMANT_NAME,
      actor: { userId: people.opsId, role: "staff_ops" },
    },
    runtime,
  );
  await setClaimReserve(
    { claimId: claim.claimId, newReserveCents: RESERVE_CENTS, note: "first estimate", actor: { userId: people.opsId, role: "staff_ops" } },
    runtime,
  );
  await addClaimantBankAccount(
    {
      claimId: claim.claimId,
      accountHolderName: CLAIMANT_NAME,
      routingNumber: REACHABLE_ROUTING_NUMBER,
      accountNumber: "000123456789",
      actor: { userId: people.opsId, role: "staff_ops" },
    },
    runtime,
  );
  const statement = await runStatement(
    { brokerId: people.brokerAId, statementMonth: STATEMENT_MONTH, actorUserId: people.opsId },
    runtime,
  );

  // -------------------------------------------------------------------------
  // Keys. Created through the production function, with the runtime role, which
  // is exactly what the staff screen and the script do.
  // -------------------------------------------------------------------------

  const brokerKey = await createApiKey(
    { userId: people.brokerAUserId, label: "check: broker A", principalKind: "human", createdByUserId: people.opsId },
    runtime,
  );
  const otherBrokerKey = await createApiKey(
    { userId: people.brokerBUserId, label: "check: broker B", principalKind: "human", createdByUserId: people.opsId },
    runtime,
  );
  const customerKey = await createApiKey(
    { userId: people.customerUserId, label: "check: customer", principalKind: "human", createdByUserId: people.opsId },
    runtime,
  );
  const staffKey = await createApiKey(
    { userId: people.opsId, label: "check: staff operations", principalKind: "human", createdByUserId: people.opsId },
    runtime,
  );
  const agentKey = await createApiKey(
    { userId: people.secondOpsId, label: "check: an autonomous agent", principalKind: "agent", createdByUserId: people.opsId },
    runtime,
  );
  const doomedKey = await createApiKey(
    { userId: people.opsId, label: "check: to be revoked", principalKind: "human", createdByUserId: people.opsId },
    runtime,
  );
  await revokeApiKey({ keyId: doomedKey.keyId, revokedByUserId: people.opsId, reason: "revoked by the check" }, runtime);

  let agentKeyForApprover = "created, which it should not have been";
  try {
    await createApiKey(
      { userId: people.approverId, label: "check: agent key for an approver", principalKind: "agent", createdByUserId: people.opsId },
      runtime,
    );
  } catch (error) {
    agentKeyForApprover = error instanceof KeyRefused ? error.message : String(error);
  }
  report(
    "AN AGENT KEY CANNOT BE CREATED FOR A STAFF APPROVER: the database refuses it",
    /agent principal cannot hold a staff_approver key/.test(agentKeyForApprover),
    agentKeyForApprover,
  );

  const callsBefore = await mcpCallCount();

  // -------------------------------------------------------------------------
  // 1. The transport
  // -------------------------------------------------------------------------

  const initialised = await rpc(staffKey.presentedKey, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "check-mcp", version: "1.0.0" },
  });
  const initResult = (initialised.body as { result: Record<string, unknown> }).result;
  report(
    "initialize answers with the negotiated protocol version and the server name",
    initialised.status === 200 &&
      initResult.protocolVersion === "2025-06-18" &&
      (initResult.serverInfo as { name: string }).name === "corgi-policy-admin",
    `${initialised.status}, protocol ${String(initResult.protocolVersion)}`,
  );
  report(
    "the instructions tell the client what is never delegated to an agent",
    /never moves money/.test(String(initResult.instructions)) && /Approving/.test(String(initResult.instructions)),
    String(initResult.instructions).slice(0, 90) + "...",
  );
  report(
    "only tools are offered: no resources, no prompts, no sampling",
    JSON.stringify(initResult.capabilities) === '{"tools":{}}',
    JSON.stringify(initResult.capabilities),
  );

  const initialisedNotification = await rpc(staffKey.presentedKey, "notifications/initialized", {}, null);
  report(
    "a notification is accepted with 202 and no body",
    initialisedNotification.status === 202 && initialisedNotification.body === null,
    String(initialisedNotification.status),
  );

  const pinged = await rpc(staffKey.presentedKey, "ping");
  report("ping answers a result", pinged.status === 200 && "result" in (pinged.body ?? {}), JSON.stringify(pinged.body));

  const listed = await rpc(staffKey.presentedKey, "tools/list");
  const listResult = (listed.body as { result: { tools: { name: string }[]; policy: { neverDelegated: unknown[] } } }).result;
  report(
    "tools/list returns the five tools of this build",
    listResult.tools.map((tool) => tool.name).join(",") ===
      "get_policy_as_of,get_broker_statement,list_reconciliation_breaks,run_reconciliation,request_claim_payment",
    listResult.tools.map((tool) => tool.name).join(", "),
  );
  report(
    "THE NEVER-DELEGATED LIST IS PART OF THE SURFACE: tools/list carries it under policy",
    Array.isArray(listResult.policy?.neverDelegated) && listResult.policy.neverDelegated.length >= 8,
    `${listResult.policy?.neverDelegated?.length ?? 0} operations, each with its reason`,
  );

  const unknownMethod = await rpc(staffKey.presentedKey, "resources/list");
  report(
    "a method this server does not implement answers -32601",
    (unknownMethod.body as { error: { code: number } }).error.code === -32601,
    JSON.stringify((unknownMethod.body as { error: unknown }).error),
  );

  const unknownTool = await callTool(staffKey.presentedKey, "approve_claim_payment", {});
  report(
    "THERE IS NO APPROVE TOOL: calling one is an unknown tool",
    !unknownTool.ok && /unknown tool/.test(unknownTool.refusal),
    unknownTool.ok ? "it answered" : unknownTool.refusal,
  );

  postsSent += 1;
  const wrongVersion = await fetch(`${baseUrl}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${staffKey.presentedKey}`,
      "mcp-protocol-version": "1999-01-01",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });
  report("an unsupported MCP-Protocol-Version answers 400", wrongVersion.status === 400, String(wrongVersion.status));

  const getAnswer = await fetch(`${baseUrl}/api/mcp`, { headers: { authorization: `Bearer ${staffKey.presentedKey}` } });
  report("GET is refused: this endpoint opens no event stream", getAnswer.status === 405, String(getAnswer.status));

  // -------------------------------------------------------------------------
  // 2. Authentication
  // -------------------------------------------------------------------------

  const noKey = await rpc(null, "tools/list");
  const wrongKey = await rpc("cmk_deadbeef_ThisIsNotAKeyThatWasEverIssuedByThisSystem0", "tools/list");
  const revokedKey = await rpc(doomedKey.presentedKey, "tools/list");
  report(
    "no key, a wrong key and a REVOKED key all answer 401",
    noKey.status === 401 && wrongKey.status === 401 && revokedKey.status === 401,
    `${noKey.status}, ${wrongKey.status}, ${revokedKey.status}`,
  );
  report(
    "the three 401s are identical: a caller cannot tell a revoked key from a typo",
    JSON.stringify(noKey.body) === JSON.stringify(wrongKey.body) &&
      JSON.stringify(wrongKey.body) === JSON.stringify(revokedKey.body) &&
      JSON.stringify(revokedKey.body) === '{"error":"unauthorized"}',
    JSON.stringify(revokedKey.body),
  );

  // -------------------------------------------------------------------------
  // 3. The three read tools, with four different keys
  // -------------------------------------------------------------------------

  const ownPolicy = await callTool(brokerKey.presentedKey, "get_policy_as_of", {
    policyNumber: policy.policyNumber,
    asOf: TERM_START,
  });
  report(
    "a broker key reads its own policy as it stood on a date, with the figures in cents",
    ownPolicy.ok &&
      cents(ownPolicy.value.annualPremium) === ANNUAL_PREMIUM_CENTS &&
      cents(ownPolicy.value.premiumTax) === TAX_CENTS &&
      cents(ownPolicy.value.policyFee) === FEE_CENTS &&
      ownPolicy.value.status === "issued",
    ownPolicy.ok
      ? `premium ${cents(ownPolicy.value.annualPremium)}, tax ${cents(ownPolicy.value.premiumTax)}, fee ${cents(ownPolicy.value.policyFee)}, ${String(ownPolicy.value.status)}`
      : ownPolicy.refusal,
  );
  report(
    "every money figure carries a formatted string next to the integer cents",
    ownPolicy.ok && (ownPolicy.value.annualPremium as { formatted: string }).formatted === "$1,200.00",
    ownPolicy.ok ? (ownPolicy.value.annualPremium as { formatted: string }).formatted : ownPolicy.refusal,
  );
  report(
    "the answer says what it means, in a sentence",
    ownPolicy.ok && /On 2028-03-01, policy .* was issued/.test(String(ownPolicy.value.whatThisMeans)),
    ownPolicy.ok ? String(ownPolicy.value.whatThisMeans).slice(0, 80) + "..." : ownPolicy.refusal,
  );
  report(
    "the coverage limits are on it",
    ownPolicy.ok && cents((ownPolicy.value.coverageLimits as { limit: unknown }[])[0].limit) === PER_OCCURRENCE_LIMIT_CENTS,
    ownPolicy.ok ? `${(ownPolicy.value.coverageLimits as unknown[]).length} lines` : ownPolicy.refusal,
  );

  const anotherBrokersPolicy = await callTool(brokerKey.presentedKey, "get_policy_as_of", {
    policyNumber: otherPolicy.policyNumber,
    asOf: TERM_START,
  });
  const madeUpPolicy = await callTool(brokerKey.presentedKey, "get_policy_as_of", {
    policyNumber: "CGP-99999",
    asOf: TERM_START,
  });
  report(
    "A BROKER KEY CANNOT READ ANOTHER BROKER'S POLICY",
    !anotherBrokersPolicy.ok && /no policy with that number is visible to this key/.test(anotherBrokersPolicy.refusal),
    anotherBrokersPolicy.ok ? "it answered" : anotherBrokersPolicy.refusal,
  );
  report(
    "and it is the same sentence as for a policy that does not exist, so the tool leaks no policy numbers",
    !anotherBrokersPolicy.ok && !madeUpPolicy.ok && anotherBrokersPolicy.refusal === madeUpPolicy.refusal,
    madeUpPolicy.ok ? "it answered" : madeUpPolicy.refusal,
  );

  const customersPolicy = await callTool(customerKey.presentedKey, "get_policy_as_of", {
    policyNumber: policy.policyNumber,
    asOf: TERM_START,
  });
  report(
    "a customer key reads the policy that covers it",
    customersPolicy.ok && cents(customersPolicy.value.annualPremium) === ANNUAL_PREMIUM_CENTS,
    customersPolicy.ok ? String(customersPolicy.value.policyNumber) : customersPolicy.refusal,
  );
  const staffPolicy = await callTool(staffKey.presentedKey, "get_policy_as_of", {
    policyNumber: otherPolicy.policyNumber,
    asOf: TERM_START,
  });
  report("a staff key reads any policy", staffPolicy.ok, staffPolicy.ok ? String(staffPolicy.value.policyNumber) : staffPolicy.refusal);

  // Review finding F-B11-06: every tool advertises additionalProperties: false, and nothing read
  // that declaration, so a field a tool ignores looked to the client as if it had been understood.
  const undeclaredField = await callTool(brokerKey.presentedKey, "get_policy_as_of", {
    policyNumber: policy.policyNumber,
    asOfDate: TERM_START,
  });
  report(
    "AN ARGUMENT THE TOOL DOES NOT DECLARE IS REFUSED, not ignored: additionalProperties false is now enforced",
    !undeclaredField.ok &&
      /does not declare/.test(undeclaredField.refusal) &&
      !undeclaredField.refusal.includes("asOfDate"),
    undeclaredField.ok ? "it answered" : undeclaredField.refusal,
  );

  const malformedAsOf = await callTool(brokerKey.presentedKey, "get_policy_as_of", {
    policyNumber: policy.policyNumber,
    asOf: MALFORMED_AS_OF,
  });
  report(
    "a malformed asOf is refused with the SHAPE it should have, and the value the caller sent is not repeated",
    !malformedAsOf.ok &&
      /written as YYYY-MM-DD/.test(malformedAsOf.refusal) &&
      !malformedAsOf.refusal.includes(MALFORMED_AS_OF),
    malformedAsOf.ok ? "it answered" : malformedAsOf.refusal,
  );

  const beforeTheTerm = await callTool(brokerKey.presentedKey, "get_policy_as_of", {
    policyNumber: policy.policyNumber,
    asOf: "2027-01-01",
  });
  report(
    "a date before the policy existed answers a reason AND THE DATE THE COVER BEGINS, not an empty policy",
    !beforeTheTerm.ok &&
      /was not yet in force/.test(beforeTheTerm.refusal) &&
      beforeTheTerm.refusal.includes(TERM_START) &&
      !beforeTheTerm.refusal.includes("2027-01-01"),
    beforeTheTerm.ok ? "it answered" : beforeTheTerm.refusal,
  );

  const ownStatement = await callTool(brokerKey.presentedKey, "get_broker_statement", { brokerId: "me", month: STATEMENT_MONTH });
  report(
    'a broker key reads its own statement with "me": the stored run, with its hash and its cutoff',
    ownStatement.ok &&
      ownStatement.value.contentHash === statement.contentHash &&
      ownStatement.value.revision === statement.revision &&
      cents((ownStatement.value.totals as { netDue: unknown }).netDue) === statement.totals.netDueCents,
    ownStatement.ok
      ? `revision ${String(ownStatement.value.revision)}, net due ${cents((ownStatement.value.totals as { netDue: unknown }).netDue)}, hash ${String(ownStatement.value.contentHash).slice(0, 12)}...`
      : ownStatement.refusal,
  );
  // F-PP-05: the expected format version is the application's own constant, never a pinned
  // number, so a version bump cannot leave this assertion behind again.
  const { CANONICAL_STATEMENT_VERSION } = await import("@/lib/statements/compute");
  report(
    "it carries the format version and the lines it published",
    ownStatement.ok && ownStatement.value.formatVersion === CANONICAL_STATEMENT_VERSION && (ownStatement.value.lines as unknown[]).length >= 2,
    ownStatement.ok ? `format v${String(ownStatement.value.formatVersion)}, ${(ownStatement.value.lines as unknown[]).length} lines` : ownStatement.refusal,
  );

  const anotherBrokersStatement = await callTool(brokerKey.presentedKey, "get_broker_statement", {
    brokerId: people.brokerBId,
    month: STATEMENT_MONTH,
  });
  report(
    "A BROKER KEY CANNOT READ ANOTHER BROKER'S STATEMENT",
    !anotherBrokersStatement.ok && /can only read its own statements/.test(anotherBrokersStatement.refusal),
    anotherBrokersStatement.ok ? "it answered" : anotherBrokersStatement.refusal,
  );
  const staffStatement = await callTool(staffKey.presentedKey, "get_broker_statement", {
    brokerId: people.brokerAId,
    month: STATEMENT_MONTH,
  });
  report(
    "a staff key reads that broker's statement by naming the broker",
    staffStatement.ok && staffStatement.value.contentHash === statement.contentHash,
    staffStatement.ok ? String(staffStatement.value.month) : staffStatement.refusal,
  );
  const customerStatement = await callTool(customerKey.presentedKey, "get_broker_statement", { brokerId: "me", month: STATEMENT_MONTH });
  report(
    "a customer key has no broker statement to read",
    !customerStatement.ok && /only a broker or staff/.test(customerStatement.refusal),
    customerStatement.ok ? "it answered" : customerStatement.refusal,
  );
  const emptyMonth = await callTool(brokerKey.presentedKey, "get_broker_statement", { brokerId: "me", month: "2029-01" });
  report(
    "a month with no published statement answers a sentence, not an empty document",
    !emptyMonth.ok && /no statement has been published/.test(emptyMonth.refusal),
    emptyMonth.ok ? "it answered" : emptyMonth.refusal,
  );

  const breaks = await callTool(staffKey.presentedKey, "list_reconciliation_breaks", {});
  report(
    "a staff key reads the open breaks and the clearing balances",
    breaks.ok && Array.isArray(breaks.value.breaks) && (breaks.value.clearingBalances as unknown[]).length === 4,
    breaks.ok
      ? `${String(breaks.value.openBreakCount)} open breaks, ${(breaks.value.clearingBalances as unknown[]).length} clearing accounts`
      : breaks.refusal,
  );
  const brokerBreaks = await callTool(brokerKey.presentedKey, "list_reconciliation_breaks", {});
  const customerBreaks = await callTool(customerKey.presentedKey, "list_reconciliation_breaks", {});
  report(
    "a broker key and a customer key cannot read reconciliation breaks",
    !brokerBreaks.ok && !customerBreaks.ok && /only staff/.test(brokerBreaks.refusal) && /only staff/.test(customerBreaks.refusal),
    brokerBreaks.ok ? "it answered" : brokerBreaks.refusal,
  );

  // -------------------------------------------------------------------------
  // 4. The write tool: it queues, it never pays
  // -------------------------------------------------------------------------

  const ourPolicies = [policy.policyId, otherPolicy.policyId];
  const journalBefore = await fixtureJournalCount(ourPolicies, claim.claimId);

  const brokerAsksToPay = await callTool(brokerKey.presentedKey, "request_claim_payment", {
    claimNumber: claim.claimNumber,
    amountCents: PAYMENT_CENTS,
  });
  report(
    "a broker key cannot ask for a claim payment",
    !brokerAsksToPay.ok && /only staff operations/.test(brokerAsksToPay.refusal),
    brokerAsksToPay.ok ? "it answered" : brokerAsksToPay.refusal,
  );

  const agentAsks = await callTool(agentKey.presentedKey, "request_claim_payment", {
    claimNumber: claim.claimNumber,
    amountCents: 50000,
  });
  report(
    "an AGENT key can ask too, and the answer says the request was raised by an agent",
    agentAsks.ok && agentAsks.value.raisedByAgent === true,
    agentAsks.ok ? `approval request created: ${String(agentAsks.value.approvalRequestCreated)}` : agentAsks.refusal,
  );
  // $500 is below the $1,000 threshold and nothing is waiting on this claim yet: a person would
  // get "ready to send". An agent does not: rule 21 (decided 2026-09-08) puts every agent-raised
  // payment in the human queue, whatever the amount (review finding F-B11-01).
  const agentRequestId = agentAsks.ok ? String(agentAsks.value.approvalRequestId) : "";
  const agentRequestPayload = await approvalPayload(agentRequestId);
  report(
    "AND THE IMMUTABLE REQUEST ITSELF SAYS SO: the approver sees it was raised by an agent",
    agentRequestPayload?.raised_by_agent === true && String(agentRequestPayload?.raised_through).includes(agentKey.keyPrefix),
    JSON.stringify({ raised_by_agent: agentRequestPayload?.raised_by_agent, raised_through: agentRequestPayload?.raised_through }),
  );
  report(
    "RULE 21: AN AGENT ASKING FOR $500 ON A QUIET CLAIM CREATES AN APPROVAL REQUEST ANYWAY, below the threshold",
    agentAsks.ok && agentAsks.value.approvalRequestCreated === true && /staff_approver/.test(String(agentAsks.value.mustBeDecidedBy)),
    agentAsks.ok ? `$500, nothing pending before it: approval request created ${String(agentAsks.value.approvalRequestCreated)}` : agentAsks.refusal,
  );
  report(
    "and the agent-raised operation is 'requested', never 'ready to send'",
    (await latestOperationStatus(agentAsks.ok ? String(agentAsks.value.moneyOperationId) : "")) === "requested",
    "operation status read back from money_operation_events",
  );


  const asked = await callTool(staffKey.presentedKey, "request_claim_payment", {
    claimNumber: claim.claimNumber,
    amountCents: PAYMENT_CENTS,
  });
  // $1,200 alone is above the threshold; with the agent's $500 already waiting on this claim the
  // cumulative rule of decision 17 applies twice over.
  report(
    "A STAFF_OPS KEY ASKING FOR $1,200 CREATES AN APPROVAL REQUEST, and says who must decide it",
    asked.ok && asked.value.approvalRequestCreated === true && /staff_approver/.test(String(asked.value.mustBeDecidedBy)),
    asked.ok ? String(asked.value.mustBeDecidedBy) : asked.refusal,
  );
  report(
    "the answer says outright that no money moved",
    asked.ok && asked.value.moneyMoved === false && /Nothing has left/.test(String(asked.value.whatThisMeans)),
    asked.ok ? String(asked.value.whatThisMeans).slice(0, 90) + "..." : asked.refusal,
  );

  const requestId = asked.ok ? String(asked.value.approvalRequestId) : "";
  const operationStatus = await latestOperationStatus(asked.ok ? String(asked.value.moneyOperationId) : "");
  const journalAfterAsking = await fixtureJournalCount(ourPolicies, claim.claimId);
  report(
    "NO MONEY MOVED: the journal is unchanged and the operation is still only 'requested'",
    journalAfterAsking === journalBefore && operationStatus === "requested",
    `${journalBefore} journal entries before, ${journalAfterAsking} after, operation status "${operationStatus}"`,
  );

  // The agent principal is a staff_ops user. It cannot approve, twice over.
  let agentApprovesInCode = "no error raised";
  try {
    await decideApprovalRequest(
      { requestId: agentRequestId, decidedByUserId: people.secondOpsId, decidedByRole: "staff_ops", decision: "approved", reason: null },
      runtime,
    );
  } catch (error) {
    agentApprovesInCode = error instanceof ApprovalRefused ? error.message : String(error);
  }
  report(
    "AN AGENT PRINCIPAL CANNOT APPROVE ITS OWN REQUEST: the application refuses it",
    /only a staff approver can decide/.test(agentApprovesInCode),
    agentApprovesInCode,
  );

  const agentApprovesInDatabase = await expectDatabaseError(
    async (transaction) =>
      transaction`insert into approval_decisions (request_id, decided_by, decision)
                  values (${agentRequestId}, ${people.secondOpsId}, 'approved')`,
  );
  report(
    "AND THE DATABASE REFUSES IT TOO, through the most privileged connection there is",
    /maker-checker/.test(agentApprovesInDatabase ?? ""),
    agentApprovesInDatabase ?? "no error raised",
  );

  // The same two refusals for a user whose ROLE is 'agent', which is what migration 0018 makes
  // representable and what migration 0008 promised would be refused.
  let agentRoleApprovesInCode = "no error raised";
  try {
    await decideApprovalRequest(
      { requestId, decidedByUserId: people.agentUserId, decidedByRole: "agent", decision: "approved", reason: null },
      runtime,
    );
  } catch (error) {
    agentRoleApprovesInCode = error instanceof ApprovalRefused ? error.message : String(error);
  }
  const agentRoleApprovesInDatabase = await expectDatabaseError(
    async (transaction) =>
      transaction`insert into approval_decisions (request_id, decided_by, decision)
                  values (${requestId}, ${people.agentUserId}, 'approved')`,
  );
  report(
    "a user with the role 'agent' is refused by the application AND by the database trigger",
    /only a staff approver can decide/.test(agentRoleApprovesInCode) && /maker-checker/.test(agentRoleApprovesInDatabase ?? ""),
    `${agentRoleApprovesInCode.slice(0, 50)}... | ${(agentRoleApprovesInDatabase ?? "").slice(0, 60)}...`,
  );

  // A distinct human approver can, which is the other half of the rule.
  await decideApprovalRequest(
    { requestId, decidedByUserId: people.approverId, decidedByRole: "staff_approver", decision: "approved", reason: "checked the estimate" },
    runtime,
  );
  report(
    "a distinct staff approver still can: the queue works, it is agents that are refused",
    (await approvalDecision(requestId)) === "approved",
    `request ${requestId.slice(0, 8)} approved by the checker`,
  );
  report(
    "approving still moves no money: sending is a separate staff action the surface does not expose",
    (await fixtureJournalCount(ourPolicies, claim.claimId)) === journalBefore &&
      (await latestOperationStatus(asked.ok ? String(asked.value.moneyOperationId) : "")) === "requested",
    `${journalBefore} journal entries on this check's policies and claim, operation still 'requested'`,
  );

  const badAmount = await callTool(staffKey.presentedKey, "request_claim_payment", {
    claimNumber: claim.claimNumber,
    amountCents: 12.5,
  });
  report(
    "an amount that is not whole cents is refused before anything is written",
    !badAmount.ok && /whole number/.test(badAmount.refusal),
    badAmount.ok ? "it answered" : badAmount.refusal,
  );

  // -------------------------------------------------------------------------
  // 5. Running the reconciliation
  // -------------------------------------------------------------------------

  const beforeReconciliation = await fixtureJournalCount(ourPolicies, claim.claimId);
  const reconciled = await callTool(staffKey.presentedKey, "run_reconciliation", { windowDays: 1 });
  const runs = reconciled.ok ? (reconciled.value.runs as { runId: string; source: string; status: string }[]) : [];
  report(
    "a staff key runs the reconciliation and gets the run ids and the counts back",
    reconciled.ok && runs.length === 2 && runs.every((run) => run.runId.length === 36),
    reconciled.ok ? runs.map((run) => `${run.source}: ${run.status}`).join(", ") : reconciled.refusal,
  );
  report(
    "the runs were really stored",
    (await runsExist(runs.map((run) => run.runId))) === runs.length,
    `${runs.length} runs found in reconciliation_runs`,
  );
  report(
    "RUNNING THE RECONCILIATION MOVES NO MONEY: not one journal entry was posted",
    (await fixtureJournalCount(ourPolicies, claim.claimId)) === beforeReconciliation &&
      reconciled.ok &&
      reconciled.value.moneyMoved === false,
    `${beforeReconciliation} journal entries on this check's policies and claim, before and after`,
  );
  // Review finding F-B11-03: run_by names the key HOLDER, so without this the reconciliation
  // screen would print a person's name for a run no person launched. The marker rides in the
  // note the screen already shows, and it names the public key prefix.
  const noteOfTheFirstRun = runs.length > 0 ? await runNote(runs[0].runId) : "";
  report(
    "THE RUN SAYS IT CAME THROUGH THE MCP SURFACE, and names the key: run_by alone would read as the holder's own work",
    noteOfTheFirstRun.includes("Launched through the MCP surface") &&
      noteOfTheFirstRun.includes(staffKey.keyPrefix) &&
      noteOfTheFirstRun.includes("human key"),
    noteOfTheFirstRun.slice(0, 140),
  );

  const brokerReconciles = await callTool(brokerKey.presentedKey, "run_reconciliation", {});
  report(
    "a broker key cannot run it",
    !brokerReconciles.ok && /only staff/.test(brokerReconciles.refusal),
    brokerReconciles.ok ? "it ran" : brokerReconciles.refusal,
  );

  // -------------------------------------------------------------------------
  // 6. Every call is written down
  // -------------------------------------------------------------------------

  const callsAfter = await mcpCallCount();
  report(
    "EVERY CALL IS LOGGED, refusals and 401s included: one row per POST, exactly",
    callsAfter - callsBefore === postsSent,
    `${postsSent} calls sent, ${callsAfter - callsBefore} rows appended to mcp_calls`,
  );
  const unauthorisedRows = await callsWithOutcome("unauthorised");
  report(
    "the three 401s are in the log, and the revoked one is linked to the key that made it",
    unauthorisedRows.total >= 3 && unauthorisedRows.withKey >= 1,
    `${unauthorisedRows.total} unauthorised calls, ${unauthorisedRows.withKey} of them naming a key`,
  );
  const refusedRows = await callsWithOutcome("refused");
  report(
    "a refusal is logged as refused, with the sentence the caller was given",
    refusedRows.total >= 8,
    `${refusedRows.total} refused calls`,
  );
  const stored = await oneCallRow(staffKey.keyId, "run_reconciliation");
  report(
    "a logged call names the tool, fingerprints the arguments and times itself, and stores no argument",
    stored !== null && /^[0-9a-f]{64}$/.test(stored.arguments_hash ?? "") && stored.duration_ms >= 0,
    stored ? `tool ${stored.tool}, hash ${stored.arguments_hash?.slice(0, 12)}..., ${stored.duration_ms} ms` : "no row",
  );

  // Review finding F-B11-02: mcp_calls can never be updated, deleted or truncated, so a string a
  // caller chose the text of would sit in it for the life of the database. This run deliberately
  // sent four of them: the method "resources/list", the tool name "approve_claim_payment", the
  // header "1999-01-01" and a malformed asOf. None of the four may be in the rows it wrote.
  const rowsThisRunWrote = await lastCallRows(postsSent);
  const callerStrings = ["resources/list", "approve_claim_payment", "1999-01-01", MALFORMED_AS_OF];
  const rowsQuotingTheCaller = rowsThisRunWrote.filter((row) =>
    callerStrings.some(
      (caller) => (row.tool ?? "").includes(caller) || row.method.includes(caller) || (row.detail ?? "").includes(caller),
    ),
  );
  report(
    "NO CALLER STRING REACHES THE APPEND-ONLY CALL LOG: not the method, the tool name, the header or the argument",
    rowsQuotingTheCaller.length === 0,
    `${rowsThisRunWrote.length} rows read back, ${rowsQuotingTheCaller.length} quoting one of the four strings this run sent`,
  );
  const boundedRows = rowsThisRunWrote.every(
    (row) => row.method.length <= 64 && (row.tool ?? "").length <= 64 && (row.detail ?? "").length <= 500,
  );
  report(
    "and every column the caller can influence is bounded: 64 for the method and the tool, 500 for the detail",
    boundedRows,
    `longest method ${Math.max(...rowsThisRunWrote.map((row) => row.method.length))}, longest tool ${Math.max(
      ...rowsThisRunWrote.map((row) => (row.tool ?? "").length),
    )}, longest detail ${Math.max(...rowsThisRunWrote.map((row) => (row.detail ?? "").length))}`,
  );

  console.log("");
  console.log(`${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
}

// ---------------------------------------------------------------------------
// Fixtures and reads
// ---------------------------------------------------------------------------

async function createPeople(): Promise<{
  brokerAId: string;
  brokerBId: string;
  brokerAUserId: string;
  brokerBUserId: string;
  customerId: string;
  otherCustomerId: string;
  customerUserId: string;
  opsId: string;
  secondOpsId: string;
  approverId: string;
  agentUserId: string;
}> {
  return owner.begin(async (transaction) => {
    const unique = () => `mcp-check-${crypto.randomUUID()}@example.invalid`;
    const newBroker = async (name: string) => {
      const [broker] = await transaction<{ id: string }[]>`
        insert into brokers (name, commission_rate_bps) values (${name}, 1500) returning id
      `;
      await transaction`
        insert into broker_kyb_events (broker_id, provider, status) values (${broker.id}, 'seed', 'approved')
      `;
      return broker.id;
    };
    const newUser = async (name: string, role: string, brokerId: string | null, customerId: string | null) => {
      const [user] = await transaction<{ id: string }[]>`
        insert into users (email, display_name, role, broker_id, customer_id)
        values (${unique()}, ${name}, ${role}, ${brokerId}, ${customerId}) returning id
      `;
      return user.id;
    };
    const newCustomer = async (name: string) => {
      const [customer] = await transaction<{ id: string }[]>`
        insert into customers (name, email) values (${name}, ${unique()}) returning id
      `;
      return customer.id;
    };

    const brokerAId = await newBroker("MCP check broker A");
    const brokerBId = await newBroker("MCP check broker B");
    const customerId = await newCustomer(CLAIMANT_NAME);
    const otherCustomerId = await newCustomer("MCP check other customer");
    return {
      brokerAId,
      brokerBId,
      brokerAUserId: await newUser("MCP check broker A user", "broker", brokerAId, null),
      brokerBUserId: await newUser("MCP check broker B user", "broker", brokerBId, null),
      customerId,
      otherCustomerId,
      customerUserId: await newUser("MCP check customer user", "customer", null, customerId),
      opsId: await newUser("MCP check operator", "staff_ops", null, null),
      secondOpsId: await newUser("MCP check agent operator", "staff_ops", null, null),
      approverId: await newUser("MCP check approver", "staff_approver", null, null),
      // A principal whose ROLE is 'agent' (migration 0018), used to prove that both the
      // application and the database refuse it as an approver.
      agentUserId: await newUser("MCP check agent principal", "agent", null, null),
    };
  });
}

// A bound, paid policy, built exactly as slice B2 builds one.
async function createPaidPolicy(
  recordSuccessfulPayment: typeof import("@/lib/payments/collection").recordSuccessfulPayment,
  brokerId: string,
  customerId: string,
): Promise<{ policyId: string; policyNumber: string }> {
  const { policyId, policyNumber, operationId } = await owner.begin(async (transaction) => {
    const [policy] = await transaction<{ id: string; policy_number: string }[]>`
      insert into policies (broker_id, customer_id, state_code) values (${brokerId}, ${customerId}, 'CA')
      returning id, policy_number
    `;
    await transaction`
      insert into policy_events (policy_id, event_type, effective_at, payload)
      values (${policy.id}, 'quoted', ${TERM_START}, ${transaction.json({
        state_code: "CA",
        term_start: TERM_START,
        term_end: TERM_END,
        annual_premium_cents: ANNUAL_PREMIUM_CENTS,
        tax_rate_bps: 235,
        tax_cents: TAX_CENTS,
        fee_cents: FEE_CENTS,
        total_charge_cents: TOTAL_CHARGE_CENTS,
        per_occurrence_limit_cents: PER_OCCURRENCE_LIMIT_CENTS,
        aggregate_limit_cents: AGGREGATE_LIMIT_CENTS,
      })})
    `;
    const [operation] = await transaction<{ id: string }[]>`
      insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key)
      values ('stripe_checkout', 'stripe', ${TOTAL_CHARGE_CENTS}, ${policy.id}, 'mcp-check:' || ${policy.id})
      returning id
    `;
    await transaction`insert into money_operation_events (operation_id, status) values (${operation.id}, 'requested')`;
    return { policyId: policy.id, policyNumber: policy.policy_number, operationId: operation.id };
  });

  const collected = await recordSuccessfulPayment(
    {
      operationId,
      paymentIntentId: `pi_mcp_check_${operationId.slice(0, 8)}`,
      amountReceivedCents: TOTAL_CHARGE_CENTS,
      paidOn: TERM_START,
    },
    runtime,
  );
  if (collected.kind !== "posted") {
    throw new Error(`the fixture policy could not be paid: ${JSON.stringify(collected)}`);
  }
  return { policyId, policyNumber };
}

class RollbackSentinel extends Error {}

// Runs a statement through the OWNER connection inside a transaction that is always rolled back,
// and returns the error it raised. Used to prove that a database trigger refuses something even
// for the role that owns the schema.
async function expectDatabaseError(
  action: (transaction: postgres.TransactionSql) => Promise<unknown>,
): Promise<string | null> {
  try {
    await owner.begin(async (transaction) => {
      await action(transaction);
      throw new RollbackSentinel();
    });
    return null;
  } catch (error) {
    if (error instanceof RollbackSentinel) return null;
    return error instanceof Error ? error.message : String(error);
  }
}

// How many journal entries exist for THIS check's own policies and claim. Counting every entry
// in the database would be wrong here: corgi_test is shared, and another agent's check running at
// the same time would change the total and make "no money moved" look false when nothing of ours
// moved at all.
async function fixtureJournalCount(policyIds: string[], claimId: string): Promise<number> {
  const [row] = await owner<{ count: string }[]>`
    select count(*)::text as count from journal_entries
     where policy_id in ${owner(policyIds)} or claim_id = ${claimId}
  `;
  return Number(row.count);
}

async function mcpCallCount(): Promise<number> {
  const [row] = await owner<{ count: string }[]>`select count(*)::text as count from mcp_calls`;
  return Number(row.count);
}

async function callsWithOutcome(outcome: string): Promise<{ total: number; withKey: number }> {
  const [row] = await owner<{ total: string; with_key: string }[]>`
    select count(*)::text as total, count(api_key_id)::text as with_key
      from mcp_calls where outcome = ${outcome}
  `;
  return { total: Number(row.total), withKey: Number(row.with_key) };
}

async function oneCallRow(
  keyId: string,
  tool: string,
): Promise<{ tool: string; arguments_hash: string | null; duration_ms: number } | null> {
  const [row] = await owner<{ tool: string; arguments_hash: string | null; duration_ms: number }[]>`
    select tool, arguments_hash, duration_ms from mcp_calls
     where api_key_id = ${keyId} and tool = ${tool}
     order by called_at desc limit 1
  `;
  return row ?? null;
}

// The rows this run appended, newest first: the last `count` of them, because the disposable
// database keeps every earlier run's rows too.
async function lastCallRows(
  count: number,
): Promise<{ method: string; tool: string | null; detail: string | null }[]> {
  return owner<{ method: string; tool: string | null; detail: string | null }[]>`
    select method, tool, detail from mcp_calls order by called_at desc, id desc limit ${count}
  `;
}

async function latestOperationStatus(operationId: string): Promise<string> {
  if (!operationId) return "no operation";
  const [row] = await owner<{ status: string }[]>`
    select status from money_operation_events where operation_id = ${operationId}
     order by recorded_at desc, id desc limit 1
  `;
  return row?.status ?? "no event";
}

async function approvalPayload(requestId: string): Promise<{ raised_by_agent?: boolean; raised_through?: string } | null> {
  if (!requestId || requestId === "null") return null;
  const [row] = await owner<{ payload: { raised_by_agent?: boolean; raised_through?: string } }[]>`
    select payload from approval_requests where id = ${requestId}
  `;
  return row?.payload ?? null;
}

async function approvalDecision(requestId: string): Promise<string | null> {
  const [row] = await owner<{ decision: string }[]>`
    select decision from approval_decisions where request_id = ${requestId}
  `;
  return row?.decision ?? null;
}

async function runNote(runId: string): Promise<string> {
  const [row] = await owner<{ note: string | null }[]>`
    select note from reconciliation_runs where id = ${runId}
  `;
  return row?.note ?? "";
}

async function runsExist(runIds: string[]): Promise<number> {
  if (runIds.length === 0) return 0;
  const [row] = await owner<{ count: string }[]>`
    select count(*)::text as count from reconciliation_runs where id in ${owner(runIds)}
  `;
  return Number(row.count);
}

main()
  .then(async () => {
    await owner.end();
    await runtime.end();
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (error) => {
    console.error("the check itself failed:", error instanceof Error ? error.stack : error);
    await owner.end();
    await runtime.end();
    process.exit(1);
  });
