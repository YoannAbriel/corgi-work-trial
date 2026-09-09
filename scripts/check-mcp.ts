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
//   6. explain_amount: the explanation of a figure is the one the policy page reads, key by key,
//      a figure key that does not exist is refused by naming the closed list, a broker key reads
//      its own policy's lines and cannot explain another broker's policy, a staff key reads the
//      journal entry ids behind a ledger sum, and a CUSTOMER KEY IS REFUSED THE TOOL ALTOGETHER,
//      with the same sentence whatever figure or policy it names;
//   7. list_my_activity: a key reads back the calls it just made, and none of another key's;
//   8. inspect_reference: a staff key opens a policy number and gets the journal entry ids the
//      policy page reads, a PaymentIntent id resolves to its own operation with its lifecycle and
//      its collection entry, a break key resolves to its latest report and then to the note a
//      human wrote on it, a reference that resolves to a BROKER (a connected account id, or the
//      correlation id of a request that named one) opens that broker's whole book and names no
//      policy at all, a broker key is refused another broker's reference without the refusal
//      naming it, a customer key is refused the tool before any read, an unknown reference
//      answers nothing matches, an over-long one is refused by the schema, and every list
//      respects the bound the answer publishes beside it;
//   9. every single call is written down in mcp_calls, including the ones that were refused;
//  10. who may mint a key: a staff_approver session is refused by POST /api/mcp-keys, because
//      the role that decides a money-out must not be able to create the maker's credential
//      (review finding F-INT-01).
//
// IT NEEDS A DEV SERVER pointed at the disposable database. In one terminal:
//
//   npm run dev:test-db
//
// (scripts/dev-on-test-database.ts: it reads .env.local itself, starts the application on port
// 3800 with DATABASE_URL_APP set to the disposable database, and prints no connection string),
// then in another:
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

// The same count, PER PRESENTED KEY. corgi_test is shared: another agent running its own check
// against the same database appends its own rows to mcp_calls while this one runs, so a global
// count of the table cannot say "one row per POST" about THIS run. Counting the rows of the keys
// this run created, against the POSTs this run sent with them, is exact whoever else is working.
const postsByPresentedKey = new Map<string, number>();

// A value no date parser accepts, sent on purpose so the refusal and the audit row can be read
// back: neither of them may repeat it (review finding F-B11-02).
const MALFORMED_AS_OF = "not-a-date-but-a-long-string-a-caller-chose";

// The same trap for explain_amount: a figure key that does not exist. The refusal must name the
// closed list instead of repeating it.
const UNKNOWN_FIGURE_KEY = "premium_tax_but_spelled_by_a_confident_agent";

// `correlationId` rides in the x-request-id header, which lib/observability/log.ts stores on the
// activity row of that very request. It is how the list_my_activity checks below prove WHOSE
// calls came back: a call this check labelled must be in its own key's answer and in no other's.
async function rpc(
  key: string | null,
  method: string,
  params?: unknown,
  id: number | null = 1,
  correlationId?: string,
): Promise<JsonRpcAnswer> {
  postsSent += 1;
  if (key !== null) {
    postsByPresentedKey.set(key, (postsByPresentedKey.get(key) ?? 0) + 1);
  }
  const response = await fetch(`${baseUrl}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(correlationId ? { "x-request-id": correlationId } : {}),
    },
    body: JSON.stringify(id === null ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params }),
  });
  const text = await response.text();
  return { status: response.status, body: text.length > 0 ? JSON.parse(text) : null };
}

// One tool call, unwrapped: the structured answer when it worked, the refusal text when it did
// not. Every tool answers both shapes (lib/mcp/jsonrpc.ts), and this is the caller's side of it.
type ToolAnswer = { ok: true; value: Record<string, unknown> } | { ok: false; refusal: string };

async function callTool(
  key: string,
  name: string,
  args: Record<string, unknown>,
  correlationId?: string,
): Promise<ToolAnswer> {
  const answer = await rpc(key, "tools/call", { name, arguments: args }, 1, correlationId);
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

// The line of an explain_amount answer that IS the figure: the one the fold highlights.
function resultLine(answer: Record<string, unknown>): { inWords: string; inCents: string } {
  const formula = answer.formula as { isTheResult: boolean; inWords: string; inCents: string }[];
  return formula.find((line) => line.isTheResult) ?? { inWords: "no result line", inCents: "no result line" };
}

async function main() {
  const { openClaim, setClaimReserve } = await import("@/lib/claims/claims");
  const { addClaimantBankAccount } = await import("@/lib/claims/payments");
  const { recordSuccessfulPayment } = await import("@/lib/payments/collection");
  const { runStatement } = await import("@/lib/statements/run");
  const { createApiKey, revokeApiKey, KeyRefused } = await import("@/lib/mcp/keys");
  const { decideApprovalRequest, ApprovalRefused } = await import("@/lib/approvals/approvals");
  // Signing one session cookie by hand is how this check reaches a browser-only route
  // (POST /api/mcp-keys) as a given role, with the server's own secret and its own function.
  const { signSessionCookie, sessionSecret, SESSION_COOKIE_NAME } = await import("@/lib/auth/session");

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
        `  npm run dev:test-db`,
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

  // A BROKER'S FILE IS A BOOK, NOT ONE OF ITS POLICIES (review finding F-INSPECT-01). Two
  // references resolve to a broker rather than to one object, and both were unproved: a connected
  // account id, and the correlation id of a request that named a broker. So broker A gets a
  // SECOND paid policy, an account id to be found by, and one such request. Planted after the
  // statement above on purpose: the statement is a frozen document and this must not change it.
  const secondPolicyOfBrokerA = await createPaidPolicy(recordSuccessfulPayment, people.brokerAId, people.customerId);
  // The connected account of broker A, appended to the KYB log the way slice B3 appends one. It
  // is the reference an alert from Stripe carries, and it names a broker and no policy at all.
  const brokerAccountRef = `acct_mcpcheck${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  await owner`
    insert into broker_kyb_events (broker_id, provider, status, provider_ref)
    values (${people.brokerAId}, 'seed', 'approved', ${brokerAccountRef})
  `;
  // One request of the past that named broker A. Appended straight to the activity log, as the
  // owner, because no MCP call names a broker: the correlation id an operator pastes during an
  // incident comes from a browser request to a broker screen, and this check speaks MCP.
  const brokerRequestTrace = `mcp-check-broker-trace-${crypto.randomUUID().slice(0, 8)}`;
  await owner`
    insert into activity_log (
      correlation_id, actor_user_id, actor_role, actor_kind, route, method,
      subject_kind, subject_id, duration_ms, outcome, status_code
    ) values (
      ${brokerRequestTrace}, ${people.opsId}, 'staff_ops', 'human',
      '/ops/console/broker/[brokerId]', 'GET', 'broker', ${people.brokerAId}, 12, 'ok', 200
    )
  `;

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
  // A token whose expiry is already behind it (migration 0026). One minute in the past is enough:
  // the endpoint compares the stored instant with its own clock, and nothing rounds.
  const expiredKey = await createApiKey(
    {
      userId: people.opsId,
      label: "check: expired an hour ago",
      principalKind: "human",
      createdByUserId: people.opsId,
      expiresAt: new Date(Date.now() - 60 * 1000),
    },
    runtime,
  );

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

  // Review finding F-INT-01, over HTTP with a real signed session cookie: the role that DECIDES
  // a money-out cannot mint the credential that REQUESTS one. Without this refusal a single
  // staff_approver could create a key for the staff_ops user, raise a claim payment through it
  // and then approve it as themselves, which is the maker-checker gate defeated in a browser.
  const keysBeforeTheApproverTried = await apiKeyCountOf(people.opsId);
  const approverSessionCookie = signSessionCookie(
    people.approverId,
    Math.floor(Date.now() / 1000) + 300,
    sessionSecret(),
  );
  const mintedByAnApprover = await fetch(`${baseUrl}/api/mcp-keys`, {
    method: "POST",
    redirect: "manual", // the answer is a 303 to the screen: read it, do not follow it
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${approverSessionCookie}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      action: "create",
      userId: people.opsId, // the maker's own eyes: the whole point of the attack
      label: "check: a key minted by an approver",
      principalKind: "human",
    }).toString(),
  });
  const refusalToTheApprover = decodeURIComponent(mintedByAnApprover.headers.get("location") ?? "");
  report(
    "A STAFF APPROVER CANNOT CREATE AN MCP KEY: POST /api/mcp-keys refuses the session and writes no key",
    mintedByAnApprover.status === 303 &&
      /only staff operations can manage MCP API keys/.test(refusalToTheApprover) &&
      (await apiKeyCountOf(people.opsId)) === keysBeforeTheApproverTried,
    `${mintedByAnApprover.status} ${refusalToTheApprover}`,
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
  const listResult = (
    listed.body as {
      result: {
        tools: {
          name: string;
          annotations?: {
            readOnlyHint?: boolean;
            figureKeys?: { key: string }[];
            acceptedReferenceShapes?: { shape: string; meaning: string }[];
            bounds?: Record<string, number>;
          };
        }[];
        policy: { neverDelegated: unknown[] };
      };
    }
  ).result;
  report(
    "tools/list returns the eight tools of this build",
    listResult.tools.map((tool) => tool.name).join(",") ===
      "get_policy_as_of,get_broker_statement,explain_amount,list_my_activity,inspect_reference,list_reconciliation_breaks,run_reconciliation,request_claim_payment",
    listResult.tools.map((tool) => tool.name).join(", "),
  );
  const readOnlyToolNames = listResult.tools.filter((tool) => tool.annotations?.readOnlyHint === true).map((tool) => tool.name);
  report(
    "EVERY TOOL SAYS WHETHER IT READS ONLY, and the three added last do",
    readOnlyToolNames.includes("explain_amount") &&
      readOnlyToolNames.includes("list_my_activity") &&
      readOnlyToolNames.includes("inspect_reference") &&
      !readOnlyToolNames.includes("request_claim_payment") &&
      !readOnlyToolNames.includes("run_reconciliation"),
    `read-only: ${readOnlyToolNames.join(", ")}`,
  );
  const inspectAnnotations = listResult.tools.find((tool) => tool.name === "inspect_reference")?.annotations;
  const publishedShapes = inspectAnnotations?.acceptedReferenceShapes ?? [];
  report(
    "inspect_reference publishes its closed list of reference shapes and its bounds in tools/list",
    publishedShapes.length === 8 &&
      publishedShapes.some((shape) => shape.shape === "break_key") &&
      inspectAnnotations?.bounds?.activity === 20,
    `${publishedShapes.length} shapes published, activity bound ${String(inspectAnnotations?.bounds?.activity)}`,
  );
  const publishedFigureKeys =
    listResult.tools.find((tool) => tool.name === "explain_amount")?.annotations?.figureKeys ?? [];
  report(
    "explain_amount publishes its closed list of figure keys in tools/list, with what each one means",
    publishedFigureKeys.length === 15 && publishedFigureKeys.some((figure) => figure.key === "premium_tax"),
    `${publishedFigureKeys.length} figure keys published`,
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
  postsByPresentedKey.set(
    staffKey.presentedKey,
    (postsByPresentedKey.get(staffKey.presentedKey) ?? 0) + 1,
  );
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
  // An EXPIRED token is refused the same way, with the one difference decided on 2026-09-09: it
  // is told why. That sentence is only ever reached by a caller who presented a token that
  // exists, so it tells nobody anything they do not already hold.
  const expiredAnswer = await rpc(expiredKey.presentedKey, "tools/list");
  report(
    'an EXPIRED token answers 401 with "token expired", and no tool ran',
    expiredAnswer.status === 401 && JSON.stringify(expiredAnswer.body) === '{"error":"token expired"}',
    `${expiredAnswer.status} ${JSON.stringify(expiredAnswer.body)}`,
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
  // 3b. explain_amount: the fold under a figure, over the protocol
  // -------------------------------------------------------------------------

  const { policyDetail, journalEntriesOfPolicy } = await import("@/lib/policy/read");
  const { policyAsItStoodOn } = await import("@/lib/policy/correction-read");
  const { termsInForceOn } = await import("@/lib/policy/terms-in-force");
  const { accountSumCents } = await import("@/lib/money/explain");

  // THE FIGURES THE POLICY PAGE READS, computed here exactly as app/policies/[policyId]/page.tsx
  // computes them: the terms-in-force fold for the three figures of the top panel, and the same
  // account sums over the entries no correction has reversed for the side panel. This does not
  // call the module the tool uses, so an agreement below is two paths meeting, not one path
  // meeting itself.
  const pageDetail = await policyDetail(policy.policyId, runtime);
  if (!pageDetail) {
    throw new Error("the fixture policy cannot be read back: the check cannot compare anything");
  }
  const pageTerms = termsInForceOn(pageDetail, await policyAsItStoodOn(policy.policyId, TERM_START, runtime));
  const pageEntries = (await journalEntriesOfPolicy(policy.policyId, runtime)).filter(
    (entry) => !entry.reversesEntryId && !entry.isReversedByACorrection,
  );
  const pageCommissionCents = accountSumCents(pageEntries, "commission_payable", "credits_minus_debits");
  const pageUnearnedCents = accountSumCents(pageEntries, "unearned_premium", "credits_minus_debits");

  const explainedTax = await callTool(brokerKey.presentedKey, "explain_amount", {
    policy: policy.policyNumber,
    figure: "premium_tax",
    asOf: TERM_START,
  });
  report(
    "explain_amount gives the premium tax the POLICY PAGE reads, with the formula in words and in integer cents",
    explainedTax.ok &&
      cents(explainedTax.value.amount) === pageTerms.taxCents &&
      explainedTax.value.explanationEndsOnTheFigure === true &&
      /floor\(120000 x 235 \/ 10000\)/.test(resultLine(explainedTax.value).inCents),
    explainedTax.ok
      ? `${cents(explainedTax.value.amount)} cents, page reads ${pageTerms.taxCents}, formula "${resultLine(explainedTax.value).inCents}"`
      : explainedTax.refusal,
  );
  report(
    "and it names the rounding rule the way the screen names it",
    explainedTax.ok && /Rounded down \(floor\)/.test(String(explainedTax.value.rounding)),
    explainedTax.ok ? String(explainedTax.value.rounding).slice(0, 60) + "..." : explainedTax.refusal,
  );

  const explainedFee = await callTool(brokerKey.presentedKey, "explain_amount", {
    policy: policy.policyNumber,
    figure: "policy_fee",
    asOf: TERM_START,
  });
  const explainedTotal = await callTool(brokerKey.presentedKey, "explain_amount", {
    policy: policy.policyId, // the policy id works as well as the number
    figure: "total_charge",
    asOf: TERM_START,
  });
  report(
    "the fee and the total charge agree with the same panel, and a policy id is accepted as well as its number",
    explainedFee.ok &&
      explainedTotal.ok &&
      cents(explainedFee.value.amount) === pageTerms.feeCents &&
      cents(explainedTotal.value.amount) === pageTerms.totalChargeCents &&
      explainedTotal.value.policyNumber === policy.policyNumber,
    explainedFee.ok && explainedTotal.ok
      ? `fee ${cents(explainedFee.value.amount)} = ${pageTerms.feeCents}, total ${cents(explainedTotal.value.amount)} = ${pageTerms.totalChargeCents}`
      : `${explainedFee.ok ? "" : explainedFee.refusal} ${explainedTotal.ok ? "" : explainedTotal.refusal}`,
  );

  const explainedCommission = await callTool(staffKey.presentedKey, "explain_amount", {
    policy: policy.policyNumber,
    figure: "commission_payable",
  });
  const explainedUnearned = await callTool(staffKey.presentedKey, "explain_amount", {
    policy: policy.policyNumber,
    figure: "unearned_premium_held",
  });
  report(
    "the two ledger sums agree with the same account sums the page's side panel prints",
    explainedCommission.ok &&
      explainedUnearned.ok &&
      cents(explainedCommission.value.amount) === pageCommissionCents &&
      cents(explainedUnearned.value.amount) === pageUnearnedCents &&
      explainedCommission.value.explanationEndsOnTheFigure === true,
    explainedCommission.ok && explainedUnearned.ok
      ? `commission ${cents(explainedCommission.value.amount)} = ${pageCommissionCents}, unearned ${cents(explainedUnearned.value.amount)} = ${pageUnearnedCents}`
      : `${explainedCommission.ok ? "" : explainedCommission.refusal} ${explainedUnearned.ok ? "" : explainedUnearned.refusal}`,
  );
  const provenBy = explainedCommission.ok
    ? (explainedCommission.value.provenBy as { journalEntryId: string | null; line: string }[])
    : [];
  report(
    "AND IT HANDS BACK THE JOURNAL ENTRY IDS THAT PROVE IT: a person can open every line it summed",
    provenBy.length > 0 &&
      provenBy.every((entry) => typeof entry.journalEntryId === "string" && entry.journalEntryId.length === 36),
    provenBy.map((entry) => `${entry.journalEntryId?.slice(0, 8)} ${entry.line}`).join(" | ") || "no evidence",
  );

  const wrongFigure = await callTool(staffKey.presentedKey, "explain_amount", {
    policy: policy.policyNumber,
    figure: UNKNOWN_FIGURE_KEY,
  });
  report(
    "A FIGURE KEY THIS TOOL DOES NOT KNOW IS REFUSED BY NAMING THE CLOSED LIST, and the value the caller sent is not repeated",
    !wrongFigure.ok &&
      /must be one of: premium_tax/.test(wrongFigure.refusal) &&
      !wrongFigure.refusal.includes(UNKNOWN_FIGURE_KEY),
    wrongFigure.ok ? "it answered" : wrongFigure.refusal.slice(0, 110) + "...",
  );

  // Review finding F-MCPTOOLS-07 of round 1: the enum is enforced by the transport
  // (lib/mcp/tools/tool.ts) BEFORE the tool runs, so a misspelled key never reaches a policy row.
  // The proof is that the same misspelling on a policy number that does not exist gives the enum
  // sentence and not "no policy with that number is visible": the read never happened.
  const wrongFigureOnAGhostPolicy = await callTool(staffKey.presentedKey, "explain_amount", {
    policy: "CGP-00000",
    figure: UNKNOWN_FIGURE_KEY,
  });
  report(
    "AND IT IS REFUSED BEFORE ANY READ: the same unknown key on a policy that does not exist gives the enum sentence, not the policy one",
    !wrongFigureOnAGhostPolicy.ok &&
      /must be one of: premium_tax/.test(wrongFigureOnAGhostPolicy.refusal) &&
      !/no policy with that number is visible/.test(wrongFigureOnAGhostPolicy.refusal),
    wrongFigureOnAGhostPolicy.ok ? "it answered" : wrongFigureOnAGhostPolicy.refusal.slice(0, 90) + "...",
  );

  const notCancelled = await callTool(staffKey.presentedKey, "explain_amount", {
    policy: policy.policyNumber,
    figure: "cancellation_total_refund",
  });
  report(
    "a figure this policy does not have answers a sentence saying why, not a zero",
    !notCancelled.ok && /has not been cancelled/.test(notCancelled.refusal),
    notCancelled.ok ? `it answered ${cents(notCancelled.value.amount)}` : notCancelled.refusal,
  );

  const explainAnotherBroker = await callTool(brokerKey.presentedKey, "explain_amount", {
    policy: otherPolicy.policyNumber,
    figure: "premium_tax",
  });
  report(
    "A BROKER KEY CANNOT EXPLAIN ANOTHER BROKER'S POLICY, with the same sentence get_policy_as_of gives",
    !explainAnotherBroker.ok &&
      !anotherBrokersPolicy.ok &&
      explainAnotherBroker.refusal === anotherBrokersPolicy.refusal,
    explainAnotherBroker.ok ? "it answered" : explainAnotherBroker.refusal,
  );

  // Review findings F-MCPTOOLS-01, F-MCPTOOLS-02 and F-MCPTOOLS-03. Round 2 gated the figure key
  // a customer key could NAME and never what the answer CONTAINED, so the commission it refused
  // by name came back inside the endorsement delta it allowed. The rule is now the whole tool: a
  // customer key is refused, whatever figure it names, because its own policy screen prints no
  // explanation fold at all. These four calls walk that line: two figures it used to be allowed,
  // one it was already refused, and a policy that does not exist.
  const customerRefusals: { what: string; refusal: string; answered: boolean }[] = [];
  for (const [what, figure, askedPolicy] of [
    ["the broker's commission", "commission_payable", policy.policyNumber],
    ["the premium tax, which round 2 allowed it", "premium_tax", policy.policyNumber],
    ["the endorsement delta, which round 2 allowed it and which carries the commission line", "endorsement_delta", policy.policyNumber],
    ["a policy number that does not exist", "premium_tax", "CGP-00000"],
  ] as const) {
    const answer = await callTool(customerKey.presentedKey, "explain_amount", {
      policy: askedPolicy,
      figure,
    });
    customerRefusals.push({
      what,
      refusal: answer.ok ? "" : answer.refusal,
      answered: answer.ok,
    });
  }
  report(
    "A CUSTOMER KEY IS REFUSED explain_amount ALTOGETHER, and the refusal names the rule rather than the figure",
    customerRefusals.every(
      (attempt) =>
        !attempt.answered &&
        /reads no explanation on their own policy screen/.test(attempt.refusal) &&
        /no explanation fold, no journal entries and no broker commission/.test(attempt.refusal),
    ),
    customerRefusals
      .map((attempt) => `${attempt.what}: ${attempt.answered ? "IT ANSWERED" : "refused"}`)
      .join(" | "),
  );
  report(
    "the four refusals are the SAME sentence, so the tool cannot be used to learn which figures or policies exist",
    new Set(customerRefusals.map((attempt) => attempt.refusal)).size === 1 &&
      ["commission_payable", "premium_tax", "endorsement_delta", "CGP-00000"].every(
        (secret) => !customerRefusals[0].refusal.includes(secret),
      ),
    `${new Set(customerRefusals.map((attempt) => attempt.refusal)).size} distinct sentence(s): "${customerRefusals[0].refusal.slice(0, 90)}..."`,
  );

  // The other side of the same rule, measured rather than assumed: what a customer key is refused
  // is exactly what a BROKER key on its own policy still reads, commission line included. Two
  // figures, one of them the one that leaked in round 2.
  const brokerReadsEndorsement = await callTool(brokerKey.presentedKey, "explain_amount", {
    policy: policy.policyNumber,
    figure: "endorsement_delta",
  });
  report(
    "A BROKER KEY STILL READS ITS OWN POLICY'S EXPLANATION LINES: the same fold its own screen renders",
    (brokerReadsEndorsement.ok && (brokerReadsEndorsement.value.formula as unknown[]).length > 0) ||
      // A fixture with no endorsement answers a sentence saying so, which is an answer and not a
      // refusal of the tool; the tax read above already proves the lines come back for this key.
      (!brokerReadsEndorsement.ok && /carries no endorsement/.test(brokerReadsEndorsement.refusal)),
    brokerReadsEndorsement.ok
      ? `${(brokerReadsEndorsement.value.formula as unknown[]).length} lines`
      : brokerReadsEndorsement.refusal,
  );

  // -------------------------------------------------------------------------
  // 3c. list_my_activity: this key's own calls, and nobody else's
  // -------------------------------------------------------------------------

  // Two labelled calls, one per key. The label rides in x-request-id and is stored as the
  // correlation id of that request's activity row, so each key's answer can be checked for the
  // label it made and against the one it did not.
  const staffTrace = `mcp-check-staff-${crypto.randomUUID()}`;
  const brokerTrace = `mcp-check-broker-${crypto.randomUUID()}`;
  await callTool(staffKey.presentedKey, "explain_amount", { policy: policy.policyNumber, figure: "policy_fee" }, staffTrace);
  await callTool(brokerKey.presentedKey, "explain_amount", { policy: policy.policyNumber, figure: "policy_fee" }, brokerTrace);

  type ActivityRow = {
    recordedAt: string;
    tool: string | null;
    outcome: string;
    rule: string | null;
    durationMs: number;
    correlationId: string;
  };
  const staffActivity = await callTool(staffKey.presentedKey, "list_my_activity", {});
  const staffCalls = staffActivity.ok ? (staffActivity.value.calls as ActivityRow[]) : [];
  report(
    "list_my_activity returns the calls this key just made, newest first and bounded to 50",
    staffActivity.ok &&
      staffCalls.length > 0 &&
      staffCalls.length <= 50 &&
      staffCalls.some((call) => call.correlationId === staffTrace && call.tool === "explain_amount") &&
      staffCalls.every((call, index) => index === 0 || staffCalls[index - 1].recordedAt >= call.recordedAt),
    staffActivity.ok ? `${staffCalls.length} calls, newest "${staffCalls[0]?.tool ?? "none"}"` : staffActivity.refusal,
  );
  report(
    "IT RETURNS NOTHING FROM ANOTHER KEY: the call the broker key labelled is not in the staff key's answer",
    staffActivity.ok && !staffCalls.some((call) => call.correlationId === brokerTrace),
    staffActivity.ok ? `${staffCalls.length} calls read back, none of them the broker's` : staffActivity.refusal,
  );
  report(
    "the refusals are in it too, with the rule that refused them, and every row carries a duration",
    staffActivity.ok &&
      staffCalls.some((call) => call.outcome === "refused" && call.rule === "MCP tool scope") &&
      staffCalls.every((call) => Number.isInteger(call.durationMs) && call.durationMs >= 0),
    staffActivity.ok
      ? `${staffCalls.filter((call) => call.outcome === "refused").length} refused of ${staffCalls.length}`
      : staffActivity.refusal,
  );

  const brokerActivity = await callTool(brokerKey.presentedKey, "list_my_activity", {});
  const brokerCalls = brokerActivity.ok ? (brokerActivity.value.calls as ActivityRow[]) : [];
  report(
    "and the broker key sees its own call and none of the staff key's",
    brokerActivity.ok &&
      brokerCalls.some((call) => call.correlationId === brokerTrace) &&
      !brokerCalls.some((call) => call.correlationId === staffTrace),
    brokerActivity.ok ? `${brokerCalls.length} calls, its own label present, the staff label absent` : brokerActivity.refusal,
  );
  report(
    "no payload and no argument can come back: a row carries six fields and none of them is one",
    brokerActivity.ok &&
      brokerCalls.length > 0 &&
      brokerCalls.every(
        (call) => Object.keys(call).sort().join(",") === "correlationId,durationMs,outcome,recordedAt,rule,tool",
      ),
    brokerActivity.ok ? Object.keys(brokerCalls[0] ?? {}).join(", ") : brokerActivity.refusal,
  );

  // -------------------------------------------------------------------------
  // 3d. inspect_reference: the operational file of one reference (decision 42)
  // -------------------------------------------------------------------------

  type InspectedFile = {
    reference: string;
    recognisedAs: string;
    resolvedTo: string;
    found: boolean;
    narrowedToOneMoneyOperation: string | null;
    belongsTo: {
      kind: string;
      policyId: string | null;
      policyNumber: string | null;
      claimNumber: string | null;
      brokerId: string | null;
      policyStatus: string | null;
      term: { start: string; end: string } | null;
      termsInForceToday: { onDate: string | null; annualPremium: { cents: number } } | null;
      spansAWholeBrokerBook: boolean;
      policiesTheseListsWereDrawnFrom: number | null;
    } | null;
    moneyOperations: {
      operationId: string;
      kind: string;
      rail: string;
      amount: { cents: number };
      latestStatus: string | null;
      providerRef: string | null;
      events: { requestedAt: string | null; succeededAt: string | null };
    }[];
    webhookEvents: { webhookEventId: string; type: string; receivedAt: string; outcome: string }[];
    journalEntries: { journalEntryId: string; entryType: string; lines: { accountCode: string }[] }[];
    reconciliationReports: {
      breakKey: string;
      source: string;
      classification: string;
      runId: string;
      reportedAt: string;
      providerAmount: { cents: number } | null;
      isBreakToActOn: boolean;
      explainedNote: { note: string; byName: string; at: string } | null;
    }[];
    activity: { route: string; outcome: string; correlationId: string }[];
    bounds: Record<string, number>;
    sectionsThisKeyMayNotRead: string[];
    whatThisMeans: string;
  };

  async function inspect(key: string, reference: string): Promise<{ ok: true; file: InspectedFile } | { ok: false; refusal: string }> {
    const answer = await callTool(key, "inspect_reference", { reference });
    return answer.ok ? { ok: true, file: answer.value as unknown as InspectedFile } : answer;
  }

  // Every list of a file is bounded, and the file returns its own bounds beside them: an agent
  // must never have to guess whether it is holding all of something.
  function everyListRespectsItsBound(file: InspectedFile): boolean {
    return (
      file.moneyOperations.length <= file.bounds.moneyOperations &&
      file.webhookEvents.length <= file.bounds.webhookEvents &&
      file.journalEntries.length <= file.bounds.journalEntries &&
      file.reconciliationReports.length <= file.bounds.reconciliationReports &&
      file.activity.length <= file.bounds.activity
    );
  }

  const policyFile = await inspect(staffKey.presentedKey, policy.policyNumber);
  // THE JOURNAL ENTRY IDS THE POLICY PAGE READS, from the reader the page itself calls. The file
  // of a policy also carries the entries of its claims (they hang off the same object), so this
  // is a containment on the policy that has a claim, and an equality below on the one that does
  // not.
  const pageEntryIds = (await journalEntriesOfPolicy(policy.policyId, runtime)).map((entry) => entry.entryId);
  const fileEntryIds = policyFile.ok ? policyFile.file.journalEntries.map((entry) => entry.journalEntryId) : [];
  const otherPolicyFile = await inspect(staffKey.presentedKey, otherPolicy.policyNumber);
  const otherPageEntryIds = (await journalEntriesOfPolicy(otherPolicy.policyId, runtime)).map((entry) => entry.entryId);
  const otherFileEntryIds = otherPolicyFile.ok ? otherPolicyFile.file.journalEntries.map((entry) => entry.journalEntryId) : [];
  report(
    "A STAFF KEY OPENS A POLICY NUMBER AND GETS THE JOURNAL ENTRIES THE POLICY PAGE READS, id for id",
    policyFile.ok &&
      otherPolicyFile.ok &&
      pageEntryIds.length > 0 &&
      pageEntryIds.every((entryId) => fileEntryIds.includes(entryId)) &&
      // The second policy has no claim, so the two sets are the same set.
      otherPageEntryIds.length > 0 &&
      [...otherPageEntryIds].sort().join(",") === [...otherFileEntryIds].sort().join(","),
    policyFile.ok && otherPolicyFile.ok
      ? `${pageEntryIds.length} page entries inside ${fileEntryIds.length} file entries; the claimless policy: ${otherPageEntryIds.length} = ${otherFileEntryIds.length}`
      : `${policyFile.ok ? "" : policyFile.refusal} ${otherPolicyFile.ok ? "" : otherPolicyFile.refusal}`,
  );
  report(
    "and the file says what the policy is: its number, its cached status and the terms in force today",
    policyFile.ok &&
      policyFile.file.resolvedTo === "policy" &&
      policyFile.file.belongsTo?.policyNumber === policy.policyNumber &&
      policyFile.file.belongsTo?.termsInForceToday !== null &&
      cents(policyFile.file.belongsTo?.termsInForceToday?.annualPremium) === ANNUAL_PREMIUM_CENTS,
    policyFile.ok
      ? `${String(policyFile.file.belongsTo?.policyNumber)}, status ${String(policyFile.file.belongsTo?.policyStatus)}, premium in force ${cents(policyFile.file.belongsTo?.termsInForceToday?.annualPremium)}`
      : policyFile.refusal,
  );
  report(
    "every list of the file respects the bound the file publishes beside it",
    policyFile.ok && everyListRespectsItsBound(policyFile.file),
    policyFile.ok
      ? `operations ${policyFile.file.moneyOperations.length}/${policyFile.file.bounds.moneyOperations}, entries ${policyFile.file.journalEntries.length}/${policyFile.file.bounds.journalEntries}, activity ${policyFile.file.activity.length}/${policyFile.file.bounds.activity}`
      : policyFile.refusal,
  );

  // The PaymentIntent this check planted, resolved back to the operation it paid.
  const paymentFile = await inspect(staffKey.presentedKey, policy.paymentIntentId);
  const paidOperation = paymentFile.ok ? paymentFile.file.moneyOperations[0] : null;
  report(
    "A STRIPE PaymentIntent ID RESOLVES TO ITS MONEY OPERATION, narrowed to that one, with its lifecycle instants",
    paymentFile.ok &&
      paymentFile.file.narrowedToOneMoneyOperation === policy.operationId &&
      paymentFile.file.moneyOperations.length === 1 &&
      paidOperation?.providerRef === policy.paymentIntentId &&
      cents(paidOperation?.amount) === TOTAL_CHARGE_CENTS &&
      paidOperation?.latestStatus === "succeeded" &&
      paidOperation?.events.requestedAt !== null &&
      paidOperation?.events.succeededAt !== null &&
      paidOperation?.rail === "Stripe LIVE SANDBOX",
    paymentFile.ok
      ? `${String(paidOperation?.kind)} ${cents(paidOperation?.amount)} cents, ${String(paidOperation?.latestStatus)}, ${String(paidOperation?.rail)}`
      : paymentFile.refusal,
  );
  report(
    "AND THE COLLECTION ENTRY IS ON THAT FILE: the journal entry the payment posted, with its lines",
    paymentFile.ok &&
      paymentFile.file.journalEntries.some(
        (entry) => entry.entryType === "premium_collected" && entry.lines.length >= 2,
      ),
    paymentFile.ok
      ? paymentFile.file.journalEntries.map((entry) => `${entry.entryType} (${entry.lines.length} lines)`).join(", ")
      : paymentFile.refusal,
  );

  // A REFERENCE THAT RESOLVES TO A BROKER OPENS A BOOK, AND SAYS SO (review finding
  // F-INSPECT-01). Before the fix the answer carried one policy of that broker in the header, the
  // newest one, with its number, its cached status, its term and its four terms in force, beside
  // money operations and journal entries read across the whole book: a reader would have quoted
  // that policy for figures that are not its own.
  const accountFile = await inspect(staffKey.presentedKey, brokerAccountRef);
  const bookHeader = accountFile.ok ? accountFile.file.belongsTo : null;
  report(
    "A CONNECTED ACCOUNT ID (acct_) RESOLVES TO THE BROKER'S WHOLE BOOK AND NAMES NO POLICY",
    accountFile.ok &&
      accountFile.file.resolvedTo === "broker" &&
      bookHeader?.kind === "broker" &&
      bookHeader.brokerId === people.brokerAId &&
      bookHeader.spansAWholeBrokerBook === true &&
      bookHeader.policyId === null &&
      bookHeader.policyNumber === null &&
      bookHeader.policyStatus === null &&
      bookHeader.term === null &&
      bookHeader.termsInForceToday === null &&
      bookHeader.policiesTheseListsWereDrawnFrom === 2 &&
      // And the sentence says it in words, for a reader who reads prose and not nulls.
      /span that broker's whole book, drawn from 2 policies/.test(accountFile.file.whatThisMeans),
    accountFile.ok
      ? `book of ${String(bookHeader?.policiesTheseListsWereDrawnFrom)} policies, policyNumber ${String(bookHeader?.policyNumber)}, terms ${String(bookHeader?.termsInForceToday)}`
      : accountFile.refusal,
  );
  const operationIdsOnTheBook = accountFile.ok
    ? accountFile.file.moneyOperations.map((operation) => operation.operationId)
    : [];
  report(
    "and the lists really do span the book: the money operations of BOTH of that broker's policies are on the file",
    accountFile.ok &&
      operationIdsOnTheBook.includes(policy.operationId) &&
      operationIdsOnTheBook.includes(secondPolicyOfBrokerA.operationId) &&
      accountFile.file.journalEntries.length > 0 &&
      everyListRespectsItsBound(accountFile.file),
    accountFile.ok
      ? `${operationIdsOnTheBook.length} operations, ${accountFile.file.journalEntries.length} journal entries, both policies present: ${String(operationIdsOnTheBook.includes(policy.operationId) && operationIdsOnTheBook.includes(secondPolicyOfBrokerA.operationId))}`
      : accountFile.refusal,
  );

  // The other way in to a broker: the correlation id of a request that named one.
  const traceFile = await inspect(staffKey.presentedKey, brokerRequestTrace);
  const tracedHeader = traceFile.ok ? traceFile.file.belongsTo : null;
  report(
    "A CORRELATION ID WHOSE REQUEST NAMED A BROKER OPENS THE SAME BOOK, still with no policy in the header",
    traceFile.ok &&
      traceFile.file.resolvedTo === "broker" &&
      tracedHeader?.spansAWholeBrokerBook === true &&
      tracedHeader.policyNumber === null &&
      tracedHeader.termsInForceToday === null &&
      tracedHeader.policiesTheseListsWereDrawnFrom === 2 &&
      // The request that was pasted is itself on the file, which is what an operator came for.
      traceFile.file.activity.some((row) => row.correlationId === brokerRequestTrace),
    traceFile.ok
      ? `${traceFile.file.resolvedTo}, ${traceFile.file.activity.length} request(s) on the file, policyNumber ${String(tracedHeader?.policyNumber)}`
      : traceFile.refusal,
  );

  // A broker key: its own book, and nothing else. The refusal must not say what the reference is.
  const brokerOwnFile = await inspect(brokerKey.presentedKey, policy.policyNumber);
  const brokerOnAnotherBook = await inspect(brokerKey.presentedKey, otherPolicy.policyNumber);
  report(
    "A BROKER KEY OPENS ITS OWN POLICY AND IS REFUSED ANOTHER BROKER'S, WITHOUT THE REFUSAL NAMING IT",
    brokerOwnFile.ok &&
      !brokerOnAnotherBook.ok &&
      /not in this key's own book of business/.test(brokerOnAnotherBook.refusal) &&
      !brokerOnAnotherBook.refusal.includes(otherPolicy.policyNumber) &&
      !brokerOnAnotherBook.refusal.includes(people.brokerBId),
    brokerOnAnotherBook.ok ? "it answered" : brokerOnAnotherBook.refusal,
  );
  report(
    "and a broker key is told which sections it did NOT read, rather than shown two empty lists",
    brokerOwnFile.ok &&
      brokerOwnFile.file.webhookEvents.length === 0 &&
      brokerOwnFile.file.reconciliationReports.length === 0 &&
      brokerOwnFile.file.sectionsThisKeyMayNotRead.length === 2 &&
      brokerOwnFile.file.sectionsThisKeyMayNotRead.join(" ").includes("staff only"),
    brokerOwnFile.ok ? brokerOwnFile.file.sectionsThisKeyMayNotRead.join(" | ") : brokerOwnFile.refusal,
  );

  // A customer key is refused the tool itself, BEFORE any read: the same sentence for a policy
  // that exists and for one that does not, so the refusal teaches a caller nothing.
  const customerOnItsOwnPolicy = await inspect(customerKey.presentedKey, policy.policyNumber);
  const customerOnAGhost = await inspect(customerKey.presentedKey, "CGP-00000");
  report(
    "A CUSTOMER KEY IS REFUSED inspect_reference ALTOGETHER, before any read",
    !customerOnItsOwnPolicy.ok &&
      !customerOnAGhost.ok &&
      /reads no operational file/.test(customerOnItsOwnPolicy.refusal) &&
      customerOnItsOwnPolicy.refusal === customerOnAGhost.refusal &&
      !customerOnItsOwnPolicy.refusal.includes(policy.policyNumber),
    customerOnItsOwnPolicy.ok ? "it answered" : customerOnItsOwnPolicy.refusal.slice(0, 110) + "...",
  );

  // A reference of an accepted shape that matches nothing is an ANSWER, not an error: an agent
  // must be able to tell "I looked and there is nothing" from "the tool broke".
  const unknownPolicyNumber = await inspect(staffKey.presentedKey, "CGP-99998");
  const unknownPaymentIntent = await inspect(staffKey.presentedKey, "pi_never_created_by_this_system");
  report(
    "AN UNKNOWN REFERENCE ANSWERS NOTHING MATCHES, and is not an error",
    unknownPolicyNumber.ok &&
      unknownPolicyNumber.file.found === false &&
      unknownPolicyNumber.file.resolvedTo === "nothing" &&
      unknownPaymentIntent.ok &&
      unknownPaymentIntent.file.found === false,
    unknownPolicyNumber.ok
      ? unknownPolicyNumber.file.whatThisMeans.slice(0, 90) + "..."
      : unknownPolicyNumber.refusal,
  );

  // The schema advertises a reference of 1 to 200 characters. Enforced by the transport before
  // the tool runs, like the enum of explain_amount, so an over-long string never reaches a query.
  const overLongReference = `pi_${"x".repeat(300)}`;
  const tooLong = await inspect(staffKey.presentedKey, overLongReference);
  report(
    "AN OVER-LONG REFERENCE IS REFUSED BY THE SCHEMA, naming the bound and never the value",
    !tooLong.ok && /must be at most 200 characters long/.test(tooLong.refusal) && !tooLong.refusal.includes("xxxx"),
    tooLong.ok ? "it answered" : tooLong.refusal,
  );

  // Reading an MCP API key stays on the never-delegated list: the shape is recognised so the
  // refusal can say why, rather than pretending the reference means nothing.
  const keyPrefixInspected = await inspect(staffKey.presentedKey, staffKey.keyPrefix);
  report(
    "AN MCP KEY PREFIX IS REFUSED WITH ITS REASON: reading a key is never delegated to an agent",
    !keyPrefixInspected.ok && /never delegated to an agent/.test(keyPrefixInspected.refusal),
    keyPrefixInspected.ok ? "it answered" : keyPrefixInspected.refusal.slice(0, 100) + "...",
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

  // A BREAK OF THIS CHECK'S OWN, planted before the run so that inspect_reference has a break key
  // to open afterwards. It is written on the PROVIDER's side only, straight into the simulated
  // rail's own table as the owner: no money operation, no claim event, no journal entry, which is
  // exactly the situation a reconciliation exists to find. Its break key is built the way
  // lib/reconciliation/breaks.ts builds one for a record our ledger has never heard of.
  const plantedTransferRef = `sim_tr_mcp_check_${crypto.randomUUID().slice(0, 8)}`;
  const PLANTED_RAIL_TRANSFER_CENTS = 777700;
  await owner`
    insert into simulator_provider_records (transfer_ref, amount_cents, destination_token, status, settlement_date, payload)
    values (${plantedTransferRef}, ${PLANTED_RAIL_TRANSFER_CENTS}, 'sim_ba_planted_by_the_mcp_check', 'sent', current_date,
            ${owner.json({ note: "LOCAL SIMULATOR: planted by scripts/check-mcp.ts on the provider side only" })})
  `;
  const plantedBreakKey = `claims_rail|${plantedTransferRef}`;

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
  // 5b. inspect_reference on the break the run just reported, before and after
  //     a human explains it
  // -------------------------------------------------------------------------

  const brokenFile = await inspect(staffKey.presentedKey, plantedBreakKey);
  const plantedReport = brokenFile.ok
    ? brokenFile.file.reconciliationReports.find((report) => report.breakKey === plantedBreakKey)
    : undefined;
  report(
    "A BREAK KEY RESOLVES TO ITS LATEST REPORT: the run that said it, when, and the two amounts",
    brokenFile.ok &&
      brokenFile.file.resolvedTo === "reconciliation_break" &&
      plantedReport !== undefined &&
      plantedReport.source === "claims_rail" &&
      plantedReport.classification === "provider_only" &&
      plantedReport.runId.length === 36 &&
      Math.abs(cents(plantedReport.providerAmount)) === PLANTED_RAIL_TRANSFER_CENTS &&
      plantedReport.isBreakToActOn === true &&
      plantedReport.explainedNote === null,
    brokenFile.ok
      ? plantedReport
        ? `${plantedReport.classification} of ${cents(plantedReport.providerAmount)} cents, run ${plantedReport.runId.slice(0, 8)} at ${plantedReport.reportedAt}, to act on`
        : `no report for ${plantedBreakKey} among ${brokenFile.file.reconciliationReports.length}`
      : brokenFile.refusal,
  );

  // A human explains it, through the function the reconciliation screen calls. Nothing is
  // repaired by that: no journal entry, no edited row. The break stays on file with the note.
  const { explainBreak } = await import("@/lib/reconciliation/break-notes");
  await explainBreak(
    {
      breakKey: plantedBreakKey,
      note: "Planted on the rail by the MCP check to prove inspect_reference reads an explained break.",
      actor: { userId: people.opsId, role: "staff_ops" },
    },
    runtime,
  );
  const explainedFile = await inspect(staffKey.presentedKey, plantedBreakKey);
  const explainedReport = explainedFile.ok
    ? explainedFile.file.reconciliationReports.find((report) => report.breakKey === plantedBreakKey)
    : undefined;
  report(
    "AND ONCE A HUMAN HAS EXPLAINED IT, THE FILE SHOWS THE NOTE, its author and its time, and stops calling it work",
    explainedFile.ok &&
      explainedReport !== undefined &&
      /Planted on the rail by the MCP check/.test(explainedReport.explainedNote?.note ?? "") &&
      explainedReport.explainedNote?.byName === "MCP check operator" &&
      typeof explainedReport.explainedNote?.at === "string" &&
      explainedReport.isBreakToActOn === false &&
      // The break itself is untouched: same key, same classification, same amount.
      explainedReport.classification === "provider_only" &&
      Math.abs(cents(explainedReport.providerAmount)) === PLANTED_RAIL_TRANSFER_CENTS,
    explainedFile.ok
      ? explainedReport
        ? `"${explainedReport.explainedNote?.note.slice(0, 60)}..." by ${String(explainedReport.explainedNote?.byName)}, to act on ${explainedReport.isBreakToActOn}`
        : "the break vanished from the file once explained, which it must not"
      : explainedFile.refusal,
  );
  report(
    "a broker key cannot open a break key at all: it is nobody's book, and the refusal says nothing else",
    await (async () => {
      const brokerOnABreak = await inspect(brokerKey.presentedKey, plantedBreakKey);
      return !brokerOnABreak.ok && /not in this key's own book of business/.test(brokerOnABreak.refusal);
    })(),
    "a break names another party's money; only staff read reconciliation, exactly as list_reconciliation_breaks says",
  );

  // -------------------------------------------------------------------------
  // 6. Every call is written down
  // -------------------------------------------------------------------------

  // ONE ROW PER POST, EXACTLY, counted over the six keys THIS RUN created rather than over the
  // whole table. corgi_test is shared, and a global count of mcp_calls also counts the rows
  // another agent's check appended while this one was running, which made this assertion fail on
  // a run that was in fact correct. Each key here belongs to this run alone, so its rows are
  // this run's calls and nobody else's. The 401s that presented no key at all (they log no key
  // id) are proved by the next assertion instead.
  const thisRunsKeys = [brokerKey, otherBrokerKey, customerKey, staffKey, agentKey, doomedKey, expiredKey];
  const postsWithThisRunsKeys = thisRunsKeys.reduce(
    (total, key) => total + (postsByPresentedKey.get(key.presentedKey) ?? 0),
    0,
  );
  const rowsOfThisRunsKeys = await mcpCallCountForKeys(thisRunsKeys.map((key) => key.keyId));
  const callsAfter = await mcpCallCount();
  report(
    "EVERY CALL IS LOGGED, refusals included: one row per POST, exactly, for the keys this run created",
    rowsOfThisRunsKeys === postsWithThisRunsKeys,
    `${postsWithThisRunsKeys} calls sent with this run's keys, ${rowsOfThisRunsKeys} rows appended for them ` +
      `(the whole table grew by ${callsAfter - callsBefore} for ${postsSent} POSTs: the difference, if any, is ` +
      "another agent working on the shared disposable database)",
  );
  const unauthorisedRows = await callsWithOutcome("unauthorised");
  report(
    "the four 401s are in the log, and the revoked and expired ones name the key that made them",
    unauthorisedRows.total >= 4 && unauthorisedRows.withKey >= 2,
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
  // sent five of them: the method "resources/list", the tool name "approve_claim_payment", the
  // header "1999-01-01", a malformed asOf and an unknown figure key. None may be in its rows.
  const rowsThisRunWrote = await lastCallRows(postsSent);
  const callerStrings = [
    "resources/list",
    "approve_claim_payment",
    "1999-01-01",
    MALFORMED_AS_OF,
    UNKNOWN_FIGURE_KEY,
    // The over-long reference inspect_reference was handed: the schema refuses it by naming the
    // bound, so nothing of those 300 characters may reach the row either.
    overLongReference,
  ];
  const rowsQuotingTheCaller = rowsThisRunWrote.filter((row) =>
    callerStrings.some(
      (caller) => (row.tool ?? "").includes(caller) || row.method.includes(caller) || (row.detail ?? "").includes(caller),
    ),
  );
  report(
    "NO CALLER STRING REACHES THE APPEND-ONLY CALL LOG: not the method, the tool name, the header or either argument",
    rowsQuotingTheCaller.length === 0,
    `${rowsThisRunWrote.length} rows read back, ${rowsQuotingTheCaller.length} quoting one of the ${callerStrings.length} strings this run sent`,
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
): Promise<{ policyId: string; policyNumber: string; operationId: string; paymentIntentId: string }> {
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

  // The PaymentIntent id is returned as well as stored: inspect_reference is asked to resolve it
  // back to this very operation, so the check must know the string it planted.
  const paymentIntentId = `pi_mcp_check_${operationId.slice(0, 8)}`;
  const collected = await recordSuccessfulPayment(
    {
      operationId,
      paymentIntentId,
      amountReceivedCents: TOTAL_CHARGE_CENTS,
      paidOn: TERM_START,
    },
    runtime,
  );
  if (collected.kind !== "posted") {
    throw new Error(`the fixture policy could not be paid: ${JSON.stringify(collected)}`);
  }
  return { policyId, policyNumber, operationId, paymentIntentId };
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

// How many keys are held by ONE user. Counting the whole table would be wrong for the same
// reason as fixtureJournalCount above: corgi_test is shared with other checks.
async function apiKeyCountOf(userId: string): Promise<number> {
  const [row] = await owner<{ count: string }[]>`
    select count(*)::text as count from mcp_api_keys where user_id = ${userId}
  `;
  return Number(row.count);
}

async function mcpCallCount(): Promise<number> {
  const [row] = await owner<{ count: string }[]>`select count(*)::text as count from mcp_calls`;
  return Number(row.count);
}

// The rows of a given set of keys. Used instead of a count of the whole table, which on the
// shared disposable database also counts another agent's calls.
async function mcpCallCountForKeys(keyIds: string[]): Promise<number> {
  const [row] = await owner<{ count: string }[]>`
    select count(*)::text as count from mcp_calls where api_key_id = any(${keyIds}::uuid[])
  `;
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
