import { sql } from "@/db/client";
import {
  handleJsonRpcMessage,
  SUPPORTED_PROTOCOL_VERSIONS,
  unparseableBody,
  type CallLog,
} from "@/lib/mcp/jsonrpc";
import { principalForPresentedKey, recordMcpCall, type McpPrincipal } from "@/lib/mcp/keys";

// POST /api/mcp: the MCP surface, streamable HTTP transport, JSON-RPC 2.0 over one POST.
//
// THE FOUR THINGS THIS ROUTE DOES, in order, and nothing else:
//
//   1. reads the bearer token and turns it into a principal (lib/mcp/keys.ts). No key, an
//      unknown key or a revoked key all get the SAME 401 with no detail: a caller must not be
//      able to tell a revoked key from a typo, and must not learn that a prefix exists;
//   2. parses the body as one JSON-RPC message;
//   3. hands it to lib/mcp/jsonrpc.ts, which owns the protocol and the tools;
//   4. writes one row in mcp_calls, whatever happened, including the 401s. Every POST this
//      endpoint answers has exactly one row; the GET and DELETE below are refusals of methods
//      this transport does not use, not calls, and are not recorded.
//
// Authorisation lives in the tools, not here, because every tool answers a different question
// about a different thing (lib/mcp/scope.ts). What lives here is the identity: the key names one
// user, on every call, and the tools never see anything else.
//
// Rate limiting is out of scope for this build and is stated as a limitation in the notes: an
// authenticated caller can call as often as it likes, and every call is recorded.

export async function POST(request: Request): Promise<Response> {
  const startedAtMs = Date.now();

  const presentedKey = bearerToken(request);
  const principal = presentedKey ? await principalForPresentedKey(presentedKey) : null;
  if (!principal || principal.revokedAt !== null) {
    await logCall({
      apiKeyId: principal?.keyId ?? null,
      log: { method: "unknown", tool: null, argumentsHash: null, outcome: "error", detail: null },
      outcome: "unauthorised",
      detail: principal ? "revoked key" : presentedKey ? "unknown key" : "no bearer token",
      startedAtMs,
    });
    // One answer for all three cases. WWW-Authenticate names the scheme; this build authenticates
    // with an API key issued by staff, not with OAuth, so there is no metadata URL to point at.
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="corgi-mcp"' },
    });
  }

  // The protocol version header, when the client sends one. The specification asks a server to
  // refuse a version it does not know rather than guess; a client that sends none is answered
  // anyway, which is what a curl session does. Checked AFTER authentication so that every POST
  // this endpoint answers has a row in mcp_calls, this one included.
  const declaredVersion = request.headers.get("mcp-protocol-version");
  if (declaredVersion && !SUPPORTED_PROTOCOL_VERSIONS.includes(declaredVersion)) {
    const message = `unsupported MCP-Protocol-Version "${declaredVersion}"; this server speaks ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}`;
    await logCall({
      apiKeyId: principal.keyId,
      log: { method: "unknown", tool: null, argumentsHash: null, outcome: "refused", detail: message },
      outcome: "refused",
      detail: message,
      startedAtMs,
    });
    return jsonResponse({ jsonrpc: "2.0", id: null, error: { code: -32600, message } }, 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const handled = unparseableBody();
    await logCall({ apiKeyId: principal.keyId, log: handled.log, outcome: "refused", detail: handled.log.detail, startedAtMs });
    return jsonResponse(handled.response, 400);
  }

  const handled = await handleJsonRpcMessage(body, {
    principal,
    user: userOf(principal),
    database: sql,
    now: new Date(),
  });
  await logCall({
    apiKeyId: principal.keyId,
    log: handled.log,
    outcome: handled.log.outcome === "ok" ? "ok" : handled.log.outcome,
    detail: handled.log.detail,
    startedAtMs,
  });

  // A notification is answered with 202 and no body, as the transport requires.
  if (!handled.response) {
    return new Response(null, { status: 202 });
  }
  return jsonResponse(handled.response, 200);
}

// The transport also defines a GET (the server-to-client event stream) and a DELETE (ending a
// session). This server pushes nothing and keeps no session, so both are refused with the reason
// rather than left to 404 as if the endpoint did not exist.
export async function GET(): Promise<Response> {
  return methodNotAllowed("this MCP endpoint answers POST only: it opens no server-to-client stream");
}

export async function DELETE(): Promise<Response> {
  return methodNotAllowed("this MCP endpoint keeps no session: the API key identifies every call on its own");
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

// The tools see the key's user, and only the fields the scoping rules need.
function userOf(principal: McpPrincipal) {
  return {
    id: principal.user.id,
    displayName: principal.user.displayName,
    role: principal.user.role,
    brokerId: principal.user.brokerId,
    customerId: principal.user.customerId,
  };
}

// Writing the call down must never be the reason a caller gets an error: the answer is already
// built by the time this runs, and a failure here is logged on the server instead.
async function logCall(input: {
  apiKeyId: string | null;
  log: CallLog;
  outcome: "ok" | "refused" | "error" | "unauthorised";
  detail: string | null;
  startedAtMs: number;
}): Promise<void> {
  try {
    await recordMcpCall({
      apiKeyId: input.apiKeyId,
      method: input.log.method,
      tool: input.log.tool,
      argumentsHash: input.log.argumentsHash,
      outcome: input.outcome,
      detail: input.detail,
      durationMs: Date.now() - input.startedAtMs,
    });
  } catch (error) {
    console.error("mcp call could not be recorded", error);
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function methodNotAllowed(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 405,
    headers: { "content-type": "application/json", allow: "POST" },
  });
}
