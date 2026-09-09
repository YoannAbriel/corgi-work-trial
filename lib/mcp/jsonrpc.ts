import { hashArguments } from "./keys";
import { NEVER_DELEGATED, NEVER_DELEGATED_SUMMARY } from "./never-delegated";
import { findTool, MCP_TOOLS } from "./tools";
import { argumentsSchemaRefusal, ToolRefused, type ToolContext } from "./tools/tool";

// The Model Context Protocol, the part of it this application needs, written out.
//
// WHY THERE IS NO SDK HERE. The official TypeScript SDK's streamable HTTP transport is built
// around Node's IncomingMessage and ServerResponse and wants to own the response stream; a
// Next.js route handler is given a web `Request` and must return a web `Response`, so bridging
// the two means an adapter that is more code than the protocol itself. What a client actually
// needs from a server that only exposes tools is three methods, one notification and one health
// check, all of them plain JSON-RPC 2.0 over one POST. That is this file, and it is small
// enough to read in one sitting, which is worth more here than a dependency (READABLE-CODE.md,
// and the assignment says to say so: no new dependency was added for slice B11).
//
// WHAT IS IMPLEMENTED
//   initialize                  version negotiation, capabilities, and the instructions a client
//                               shows the model (including what is never delegated);
//   notifications/initialized   accepted and answered 202 with no body, as the spec requires;
//   ping                        answers {}: clients use it to check the connection;
//   tools/list                  the five tools, plus this build's `policy` block;
//   tools/call                  runs one tool.
//
// WHAT IS NOT, deliberately, each with the reason:
//   the SSE stream (GET /api/mcp)   this server never pushes anything to a client: every answer
//                                   is the response to the POST that asked for it. The spec
//                                   allows a server to answer a POST with application/json
//                                   instead of text/event-stream, which is what we do, and to
//                                   refuse the GET, which we do with 405.
//   sessions (Mcp-Session-Id)       the server keeps no state between calls. The API key is the
//                                   identity, on every single call.
//   resources, prompts, sampling    not needed by this surface, and absent from `capabilities`
//                                   so a client never offers them.
//   JSON-RPC batching               removed from the protocol in the 2025-06-18 revision; an
//                                   array body is refused with a sentence saying so.

export const LATEST_PROTOCOL_VERSION = "2025-11-25";

// The methods this server knows about. It is also the allow-list used before a method name is
// written into mcp_calls: that table has an UPDATE trigger, a DELETE trigger and a TRUNCATE
// trigger, so anything stored in it is stored forever, and a caller must never be able to choose
// what goes in (review finding F-B11-02). A caller who pastes a credential into "method" or into
// a tool name gets it echoed back in the answer it asked for, and nowhere else.
const KNOWN_METHODS = ["initialize", "notifications/initialized", "ping", "tools/list", "tools/call"];

// The method name as the audit row will keep it: ours when we recognise it, one fixed word when
// we do not. "unknown" is what the envelope refusals already record, so a reader sees three
// values only: a real method, "unrecognised" (a method we do not implement) and "unknown" (a
// message so malformed it never named one).
function methodForTheRecord(method: string): string {
  return KNOWN_METHODS.includes(method) ? method : "unrecognised";
}

// The revisions this endpoint answers. They agree on everything it implements (the JSON-RPC
// envelope, initialize, tools/list and tools/call), so a client asking for any of them gets the
// same behaviour and is told which one was agreed.
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];

export const SERVER_INFO = {
  name: "corgi-policy-admin",
  title: "Corgi policy administration (trial)",
  version: "0.1.0",
};

// JSON-RPC 2.0 error codes, the four this endpoint uses plus the internal one.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
};

export type CallOutcome = "ok" | "refused" | "error";

// What the route needs to write one row in mcp_calls, filled in by the handler that knows.
export type CallLog = {
  method: string;
  tool: string | null;
  argumentsHash: string | null;
  outcome: CallOutcome;
  detail: string | null;
};

export type HandledMessage = {
  // Null for a notification: there is nothing to answer, and the route replies 202 Accepted.
  response: JsonRpcResponse | null;
  log: CallLog;
};

// Handles ONE JSON-RPC message. Never throws: an unexpected failure becomes an internal error
// response with a generic sentence, because an exception message can carry things a caller may
// not see (AGENTS.md, Operations and security).
export async function handleJsonRpcMessage(message: unknown, context: ToolContext): Promise<HandledMessage> {
  if (Array.isArray(message)) {
    return refuse(null, "unknown", INVALID_REQUEST, "this server does not accept batched requests: send one JSON-RPC message per POST");
  }
  if (typeof message !== "object" || message === null) {
    return refuse(null, "unknown", INVALID_REQUEST, "the body must be a JSON-RPC 2.0 object");
  }

  const envelope = message as { jsonrpc?: unknown; method?: unknown; id?: unknown; params?: unknown };
  const id = typeof envelope.id === "string" || typeof envelope.id === "number" ? envelope.id : null;
  if (envelope.jsonrpc !== "2.0") {
    return refuse(id, "unknown", INVALID_REQUEST, 'every message must carry "jsonrpc": "2.0"');
  }
  if (typeof envelope.method !== "string") {
    return refuse(id, "unknown", INVALID_REQUEST, 'every message must carry a "method" string');
  }
  const method = envelope.method;
  const params = (typeof envelope.params === "object" && envelope.params !== null ? envelope.params : {}) as Record<
    string,
    unknown
  >;

  // A notification has no id and expects no answer. The only one this server is sent is
  // notifications/initialized, and anything else is accepted and ignored rather than answered,
  // which is what the JSON-RPC rule for notifications says.
  if (envelope.id === undefined) {
    return {
      response: null,
      log: { method: methodForTheRecord(method), tool: null, argumentsHash: null, outcome: "ok", detail: "notification accepted" },
    };
  }

  switch (method) {
    case "initialize":
      return { response: ok(id, initializeResult(params)), log: log(method, null, null, "ok", null) };

    case "ping":
      return { response: ok(id, {}), log: log(method, null, null, "ok", null) };

    case "tools/list":
      return { response: ok(id, toolsListResult()), log: log(method, null, null, "ok", null) };

    case "tools/call":
      return callTool(id, params, context);

    default:
      // The answer names the method, because the caller sent it and has to read it. The row
      // does not: it records that an unimplemented method was called, and nothing the caller
      // chose the text of.
      return refuse(
        id,
        methodForTheRecord(method),
        METHOD_NOT_FOUND,
        `this server does not implement "${method}"`,
        "method not implemented",
      );
  }
}

// ---------------------------------------------------------------------------
// initialize
// ---------------------------------------------------------------------------

function initializeResult(params: Record<string, unknown>) {
  const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : null;
  // Answer with the client's revision when we know it, otherwise with ours. The client then
  // decides whether it can live with the answer, which is what the lifecycle asks for.
  const protocolVersion = asked && SUPPORTED_PROTOCOL_VERSIONS.includes(asked) ? asked : LATEST_PROTOCOL_VERSION;
  return {
    protocolVersion,
    // Only tools. No resources, no prompts, no sampling, and no listChanged: the list of tools
    // of this build is fixed at deployment.
    capabilities: { tools: {} },
    serverInfo: SERVER_INFO,
    // Shown to the model by most clients. The rule an agent has to know comes first.
    instructions:
      "Corgi policy administration, work-trial build. Sandbox data only. " +
      NEVER_DELEGATED_SUMMARY +
      " Every amount is in integer US cents; each figure also carries a formatted string. " +
      "Every answer carries a whatThisMeans sentence: read it before reporting a figure.",
  };
}

// ---------------------------------------------------------------------------
// tools/list
// ---------------------------------------------------------------------------

function toolsListResult() {
  return {
    tools: MCP_TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
    // Not part of the protocol's own shape, and deliberately here: an agent reading this surface
    // must be able to see, without asking anybody, which operations are never delegated to it.
    // The brief asks for that list in writing; this is the machine-readable copy of it.
    policy: {
      summary: NEVER_DELEGATED_SUMMARY,
      neverDelegated: NEVER_DELEGATED,
    },
  };
}

// ---------------------------------------------------------------------------
// tools/call
// ---------------------------------------------------------------------------

async function callTool(
  id: string | number | null,
  params: Record<string, unknown>,
  context: ToolContext,
): Promise<HandledMessage> {
  const name = typeof params.name === "string" ? params.name : "";
  const args = (typeof params.arguments === "object" && params.arguments !== null ? params.arguments : {}) as Record<
    string,
    unknown
  >;
  const argumentsHash = hashArguments(args);

  const tool = findTool(name);
  if (!tool) {
    return {
      response: error(id, INVALID_PARAMS, `unknown tool "${name}"`),
      // The tool column stays null: the name is the caller's own string, and the detail beside
      // it already says what happened (review finding F-B11-02).
      log: log("tools/call", null, argumentsHash, "refused", "unknown tool"),
    };
  }

  // The schema the tool advertises is enforced here, once, before the tool sees anything (review
  // finding F-B11-06). A field the tool does not declare is refused rather than ignored, so no
  // future tool can be written against a guarantee that was never checked.
  const schemaRefusal = argumentsSchemaRefusal(tool.inputSchema, args);
  if (schemaRefusal) {
    return {
      response: ok(id, { content: [{ type: "text", text: schemaRefusal }], isError: true }),
      log: log("tools/call", tool.name, argumentsHash, "refused", schemaRefusal),
    };
  }

  try {
    const answer = await tool.run(args, context);
    return {
      // Both shapes at once, as the specification asks: the object for a client that reads
      // structured output, and the same object as text for a model that reads content.
      response: ok(id, {
        content: [{ type: "text", text: JSON.stringify(answer, null, 2) }],
        structuredContent: answer,
        isError: false,
      }),
      log: log("tools/call", tool.name, argumentsHash, "ok", null),
    };
  } catch (thrown) {
    if (thrown instanceof ToolRefused) {
      // A refusal is a TOOL error, not a protocol error: the model is meant to read it and act
      // on it, so it comes back as a normal result with isError set.
      return {
        response: ok(id, {
          content: [{ type: "text", text: thrown.message }],
          isError: true,
        }),
        log: log("tools/call", tool.name, argumentsHash, "refused", thrown.message),
      };
    }
    // Anything else is ours. The caller gets one sentence with no detail; the server keeps the
    // real message in its own log, never in the answer and never in the call record.
    console.error(`mcp tool ${tool.name} failed`, thrown);
    return {
      response: error(id, INTERNAL_ERROR, "this tool failed; the operations team can see why in the server log"),
      log: log("tools/call", tool.name, argumentsHash, "error", "unhandled failure, see the server log"),
    };
  }
}

// ---------------------------------------------------------------------------
// Small builders, so the shapes above stay readable
// ---------------------------------------------------------------------------

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function error(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// `message` is what the caller reads. `loggedDetail` is what the append-only row keeps, and it
// defaults to the message because most refusals here are fixed sentences with nothing of the
// caller's in them; the ones that quote the caller pass their own fixed sentence instead.
function refuse(
  id: string | number | null,
  method: string,
  code: number,
  message: string,
  loggedDetail: string = message,
): HandledMessage {
  return { response: error(id, code, message), log: log(method, null, null, "refused", loggedDetail) };
}

function log(
  method: string,
  tool: string | null,
  argumentsHash: string | null,
  outcome: CallOutcome,
  detail: string | null,
): CallLog {
  return { method, tool, argumentsHash, outcome, detail };
}

// A body that is not JSON at all: the route needs the same shape to answer and to log.
export function unparseableBody(): HandledMessage {
  return refuse(null, "unknown", PARSE_ERROR, "the body is not valid JSON");
}
