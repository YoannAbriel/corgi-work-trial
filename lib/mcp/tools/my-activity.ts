import type { McpTool } from "./tool";

// list_my_activity: what this key's own calls to the MCP endpoint did, newest first.
//
// WHY IT EXISTS. An agent that has just been told "this call was refused" has no way to look at
// its own trail, and a person debugging an agent has to open the operations console to see it.
// This is the same trail, restricted to the caller: the rows withActivity wrote for the MCP
// endpoint (migration 0021), which are the requests the endpoint actually answered, with the
// rule that refused them and how long each took.
//
// WHAT IT CAN NEVER RETURN, and why that is structural rather than a promise:
//
//   ANOTHER USER'S ROWS.   The query filters on actor_user_id = the user behind this key, on the
//                          MCP route alone. A broker key cannot see a staff key's calls, and a
//                          staff key cannot see a broker's.
//   A PAYLOAD.             activity_log has no payload column and never will: migration 0021
//                          leaves nowhere to put one, so there is nothing here to leak. The
//                          arguments of a call are not stored anywhere but as a sha256 in
//                          mcp_calls, and this tool does not read that table.
//   THE REFUSAL SENTENCE.  `message` is not returned. It is a sanitised sentence, but it is not
//                          one of the fields this tool promises, and the fewer free-text fields
//                          an agent reads back, the fewer ways a sentence can travel.
//
// ONE HONEST LIMIT, stated in the description as well as here: activity_log records the USER
// behind a call, not the key. A user holding two keys sees both keys' calls through either of
// them. Making it exact would mean a new column on the activity table and a migration, which
// this slice did not take; the visibility is the user's own, which is the rule the whole surface
// follows (lib/mcp/scope.ts).

// The most rows this tool ever returns. A bound rather than an argument: an agent asking for its
// last calls wants the recent ones, and an unbounded read of an append-only table grows with the
// life of the database.
const MOST_ROWS = 50;

// Every activity row of this endpoint is written with the route "/api/mcp <tool or method>"
// (app/api/mcp/route.ts), so the name after the space is what the call ran.
const MCP_ROUTE = "/api/mcp";

export const listMyActivity: McpTool = {
  name: "list_my_activity",
  title: "This key's own recent calls",
  effect: "read",
  description:
    `The last ${MOST_ROWS} calls this API key's user made to this MCP endpoint, newest first: when, which tool or method, how it ended (ok, refused or error), the rule that refused it, how long it took, and the correlation id that identifies the request in the server logs. ` +
    "It never returns another user's calls and never returns a payload: the activity log has no column for one. Note that the log records the user behind the key, so a user holding two keys sees both keys' calls. Reads only.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  async run(_args, context) {
    const rows = await context.database<
      {
        recorded_at: Date;
        route: string;
        outcome: string;
        rule: string | null;
        duration_ms: number;
        correlation_id: string;
      }[]
    >`
      select recorded_at, route, outcome, rule, duration_ms, correlation_id
        from activity_log
       where actor_user_id = ${context.user.id}
         and actor_kind in ('agent', 'human')
         and (route = ${MCP_ROUTE} or route like ${`${MCP_ROUTE} %`})
       order by recorded_at desc, id desc
       limit ${MOST_ROWS}
    `;

    const calls = rows.map((row) => ({
      recordedAt: row.recorded_at.toISOString(),
      // The tool or the JSON-RPC method the route recorded. Null on a row written before the
      // endpoint knew which one it was (an unauthenticated call, a rejected protocol header).
      tool: row.route === MCP_ROUTE ? null : row.route.slice(MCP_ROUTE.length + 1),
      outcome: row.outcome,
      rule: row.rule,
      durationMs: row.duration_ms,
      correlationId: row.correlation_id,
    }));
    const refusedCount = calls.filter((call) => call.outcome === "refused").length;

    return {
      callCount: calls.length,
      bounded: MOST_ROWS,
      calls,
      whatThisMeans:
        `The last ${calls.length} call(s) made to this endpoint by the user this key belongs to, newest first, ` +
        `${refusedCount} of them refused. "rule" is the rule that said no when one did. ` +
        "This is the request log, not the ledger: no amount, no argument and no payload is recorded, " +
        "and a call made with another user's key is not here.",
    };
  },
};
