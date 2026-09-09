import assert from "node:assert/strict";
import { test } from "node:test";
import type postgres from "postgres";
import type { McpPrincipal } from "@/lib/mcp/keys";
import type { ToolContext } from "./tool";

// What inspect_reference answers when it finds NOTHING (decision 53, Yoann).
//
// The two ways to find nothing must read the same, because they are the same fact for the caller:
//   1. the reference is not even one of the shapes this tool opens;
//   2. the shape is one it opens, and no row carries that value.
// Both answer ONE sentence, and that sentence does not repeat the closed list of accepted shapes:
// the list is published in the tool description and in the `reference` schema, which a client
// reads at tools/list before it ever calls.
//
// The tool module pulls in the readers that create the database pool and the Stripe client as
// soon as they are loaded. Both accept a missing configuration during Next's build phase, which
// is the situation here: this test loads the module and hands it a fake handle, so it opens no
// connection. Same flag, and same reason, as lib/mcp/never-delegated.test.ts.
process.env.NEXT_PHASE = process.env.NEXT_PHASE ?? "phase-production-build";

async function loadInspectReference() {
  return (await import("./inspect-reference")).inspectReference;
}

// A database that answers every query with no rows: the "recognised shape, no row" case, without
// a server. It is only ever asked the one `select ... limit 1` that resolve() runs first.
const databaseWithNoRows = (async () => []) as unknown as postgres.Sql;

// A staff key, because the role gate runs BEFORE any lookup and a customer key would be refused
// the whole tool rather than reaching the answer under test.
const staffUser = {
  id: "11111111-1111-1111-1111-111111111111",
  displayName: "Ops staff",
  role: "staff_ops" as const,
  brokerId: null,
  customerId: null,
};

function staffContext(): ToolContext {
  return {
    principal: { keyId: "key", keyPrefix: "cmk_00000000", principalKind: "human", revokedAt: null, user: staffUser } as McpPrincipal,
    user: staffUser,
    database: databaseWithNoRows,
    now: new Date("2026-09-09T20:48:00.000Z"),
  };
}

const THE_ONE_SENTENCE = "Nothing in this database matches that reference.";

test("a reference of a shape this tool does not open answers the one sentence", async () => {
  const tool = await loadInspectReference();
  const answer = await tool.run({ reference: "not a reference at all" }, staffContext());
  assert.equal(answer.whatThisMeans, THE_ONE_SENTENCE);
  assert.equal(answer.found, false);
  assert.equal(answer.resolvedTo, "nothing");
});

test("a shape this tool does open, with no row behind it, answers the SAME one sentence", async () => {
  const tool = await loadInspectReference();
  const answer = await tool.run({ reference: "CGP-99998" }, staffContext());
  assert.equal(answer.whatThisMeans, THE_ONE_SENTENCE);
  assert.equal(answer.found, false);
  assert.equal(answer.resolvedTo, "nothing");
});

// The point of decision 53: the answer to "is there a row?" is not buried under a catalogue.
test("the answer no longer lists the reference shapes the tool accepts", async () => {
  const tool = await loadInspectReference();
  const answer = await tool.run({ reference: "CGP-99998" }, staffContext());
  const sentence = String(answer.whatThisMeans);
  assert.ok(!sentence.includes("CGP-nnnnn"), "the sentence still names the policy-number shape");
  assert.ok(!sentence.includes("pi_"), "the sentence still names the Stripe shapes");
  // One sentence: one full stop, at the end.
  assert.equal(sentence.trim().split(". ").length, 1);
});

// The list itself is not gone, it stays where a client reads it once instead of at every miss.
test("the closed list of shapes is still published in the description and in the schema", async () => {
  const tool = await loadInspectReference();
  assert.match(tool.description, /CGP-nnnnn/);
  const reference = tool.inputSchema.properties.reference as { description: string };
  assert.match(reference.description, /CGP-nnnnn/);
});
