import { sql } from "@/db/client";
import {
  handleJsonRpcMessage,
  SUPPORTED_PROTOCOL_VERSIONS,
  unparseableBody,
  type CallLog,
} from "@/lib/mcp/jsonrpc";
import { principalForPresentedKey, recordMcpCall, type McpPrincipal } from "@/lib/mcp/keys";
import { withActivity, type Activity } from "@/lib/observability/log";
import { sanitisedSentence } from "@/lib/observability/redact";

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
//      this transport does not use, not calls, and are not recorded. A call whose row CANNOT be
//      written is refused rather than answered (review finding F-B11-05): an audited surface
//      that answers with no record is not audited.
//
// Authorisation lives in the tools, not here, because every tool answers a different question
// about a different thing (lib/mcp/scope.ts). What lives here is the identity: the key names one
// user, on every call, and the tools never see anything else.
//
// Rate limiting is out of scope for this build and is stated as a limitation in the notes: an
// authenticated caller can call as often as it likes, and every call is recorded.

// The activity row of this endpoint says more than "POST /api/mcp" (decision 25). The ROUTE
// carries the JSON-RPC method and the tool, because every agent and every tool arrive on the
// same URL and one latency figure over all of them would hide the slow one; the ACTOR KIND comes
// from the principal_kind of the key, so an operator reads "agent" or "human" and not "whoever
// held a token". The arguments are not read here and are stored nowhere but as a hash in
// mcp_calls (migration 0018).
export const POST = withActivity({ route: "/api/mcp", actor: "declared" }, handlePost);

async function handlePost(request: Request, _context: unknown, activity: Activity): Promise<Response> {
  const startedAtMs = Date.now();

  const presentedKey = bearerToken(request);
  const principal = presentedKey ? await principalForPresentedKey(presentedKey) : null;
  describeCaller(activity, principal);
  if (!principal || principal.revokedAt !== null) {
    activity.rule = "MCP key";
    const recorded = await logCall({
      apiKeyId: principal?.keyId ?? null,
      log: { method: "unknown", tool: null, argumentsHash: null, outcome: "error", detail: null },
      outcome: "unauthorised",
      detail: principal ? "revoked key" : presentedKey ? "unknown key" : "no bearer token",
      startedAtMs,
    });
    if (!recorded) {
      return notRecorded();
    }
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
    // The answer quotes the header the caller sent; the audit row does not (review finding
    // F-B11-02). mcp_calls can never be updated, deleted or truncated, so a header holding a
    // pasted credential would sit there for the life of the database.
    const recorded = await logCall({
      apiKeyId: principal.keyId,
      log: { method: "unknown", tool: null, argumentsHash: null, outcome: "refused", detail: null },
      outcome: "refused",
      detail: "unsupported MCP-Protocol-Version header",
      startedAtMs,
    });
    if (!recorded) {
      return notRecorded();
    }
    return jsonResponse({ jsonrpc: "2.0", id: null, error: { code: -32600, message } }, 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const handled = unparseableBody();
    const recorded = await logCall({
      apiKeyId: principal.keyId,
      log: handled.log,
      outcome: "refused",
      detail: handled.log.detail,
      startedAtMs,
    });
    if (!recorded) {
      return notRecorded();
    }
    return jsonResponse(handled.response, 400);
  }

  const handled = await handleJsonRpcMessage(body, {
    principal,
    user: userOf(principal),
    database: sql,
    now: new Date(),
  });
  // The activity row is told the verdict rather than left to read the status code, because this
  // protocol answers a REFUSED tool call with HTTP 200 and an isError result: the caller was told
  // no, and a row that read "ok" would hide exactly the thing the console exists to show.
  activity.route = `/api/mcp ${handled.log.tool ?? handled.log.method}`;
  activity.outcome = handled.log.outcome === "ok" ? "ok" : handled.log.outcome === "error" ? "error" : "refused";
  activity.rule = handled.log.outcome === "refused" ? "MCP tool scope" : null;
  activity.message = handled.log.detail;
  const recorded = await logCall({
    apiKeyId: principal.keyId,
    log: handled.log,
    outcome: handled.log.outcome === "ok" ? "ok" : handled.log.outcome,
    detail: handled.log.detail,
    startedAtMs,
  });
  if (!recorded) {
    return notRecorded();
  }

  // A notification is answered with 202 and no body, as the transport requires.
  if (!handled.response) {
    return new Response(null, { status: 202 });
  }
  return jsonResponse(handled.response, 200);
}

// The transport also defines a GET (the server-to-client event stream) and a DELETE (ending a
// session). This server pushes nothing and keeps no session, so both are refused with the reason
// rather than left to 404 as if the endpoint did not exist.
export const GET = withActivity({ route: "/api/mcp", actor: "anonymous" }, handleGet);

async function handleGet(): Promise<Response> {
  return methodNotAllowed("this MCP endpoint answers POST only: it opens no server-to-client stream");
}

export const DELETE = withActivity({ route: "/api/mcp", actor: "anonymous" }, handleDelete);

async function handleDelete(): Promise<Response> {
  return methodNotAllowed("this MCP endpoint keeps no session: the API key identifies every call on its own");
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// Who made this call, for the activity row. An unknown or missing key leaves the row anonymous:
// nothing from the presented value is stored, because it could be somebody's real secret typed
// into the wrong terminal (the same rule mcp_calls follows in migration 0018).
function describeCaller(activity: Activity, principal: McpPrincipal | null): void {
  if (!principal) return;
  activity.actorKind = principal.principalKind === "agent" ? "agent" : "human";
  activity.actorUserId = principal.user.id;
  activity.actorRole = principal.user.role;
}

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

// Writes the call down and says whether it managed to. It was best effort until review finding
// F-B11-05: the failure was caught, written to the console and forgotten, so the surface could
// answer a call that no row records. It is now the caller's decision, and above the caller
// refuses the call.
//
// The failure line is structured and carries no caller text: an operator greps for
// `mcp_call_not_recorded` and gets the key, the method and the tool, which is what identifies
// the call in the middle of a request log. The reason is the database error's own message,
// never the arguments and never the detail sentence.
async function logCall(input: {
  apiKeyId: string | null;
  log: CallLog;
  outcome: "ok" | "refused" | "error" | "unauthorised";
  detail: string | null;
  startedAtMs: number;
}): Promise<boolean> {
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
    return true;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "mcp_call_not_recorded",
        apiKeyId: input.apiKeyId,
        method: input.log.method,
        tool: input.log.tool,
        outcome: input.outcome,
        reason: sanitisedSentence(error),
      }),
    );
    return false;
  }
}

// The answer when the call happened but its row did not. It is deliberately not a plain 500:
// the caller is told the work may already have been done, so a retry is a decision and not a
// reflex. Nothing this surface exposes moves money on its own; the write tool creates an
// approval request, which is visible on the approvals screen.
function notRecorded(): Response {
  return jsonResponse(
    {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32603,
        message:
          "this call could not be written to the audit log, so this surface will not answer it. " +
          "The call may already have been carried out: check the approvals screen before retrying.",
      },
    },
    500,
  );
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
