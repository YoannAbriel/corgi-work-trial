import { test } from "node:test";
import assert from "node:assert/strict";
import { NEVER_DELEGATED, NEVER_DELEGATED_SUMMARY } from "./never-delegated";
import type { McpTool } from "./tools/tool";

// The list of operations never delegated to an agent, checked against the surface it describes.
// A document can drift; these assertions cannot.
//
// The tool list pulls in the modules that do the real work, and those create the database pool
// and the Stripe client as soon as they are loaded. Both accept a missing configuration during
// Next's build phase, which is exactly the situation here: this test loads the tool modules to
// read their names and descriptions and never calls one. Saying so with the flag those two
// modules already honour is better than inventing a fake connection string and a fake key.
process.env.NEXT_PHASE = process.env.NEXT_PHASE ?? "phase-production-build";

async function loadTools(): Promise<McpTool[]> {
  return (await import("./tools")).MCP_TOOLS;
}

test("the four operations the brief cares about most are on the list", () => {
  const operations = NEVER_DELEGATED.map((entry) => entry.operation).join(" | ");
  assert.match(operations, /approve or reject a money-out request/);
  assert.match(operations, /send a claim payment/);
  assert.match(operations, /bind a policy/);
  assert.match(operations, /cancel a policy/);
});

test("every entry says why, in a sentence and not in a word", () => {
  for (const entry of NEVER_DELEGATED) {
    assert.ok(entry.reason.length > 40, `"${entry.operation}" has no real reason: "${entry.reason}"`);
  }
});

test("no tool is named after an operation that is never delegated", async () => {
  const tools = await loadTools();
  const forbiddenVerbs = [/^approve/, /^reject/, /^decide/, /^send/, /^bind/, /^cancel/, /^void/, /^correct/, /key$/];
  for (const tool of tools) {
    for (const verb of forbiddenVerbs) {
      assert.ok(!verb.test(tool.name), `the tool "${tool.name}" is named after something that is never delegated`);
    }
  }
});

test("the surface is six read tools, the reconciliation job, and one write tool", async () => {
  const tools = await loadTools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [
      "get_policy_as_of",
      "get_broker_statement",
      "explain_amount",
      "list_my_activity",
      "inspect_reference",
      "list_reconciliation_breaks",
      "run_reconciliation",
      "request_claim_payment",
    ],
  );
});

// The two tools of slice B13-16 (decision 29) and the eighth tool of decision 42. All three were
// added to a surface whose whole promise is that an agent reads and asks, so the two assertions
// that matter are that they only read and that the list of operations never delegated did not
// have to move to make room for them.
const THE_TOOLS_ADDED_AFTER_SLICE_B11 = ["explain_amount", "list_my_activity", "inspect_reference"];

test("the tools added after slice B11 only read", async () => {
  const tools = await loadTools();
  for (const name of THE_TOOLS_ADDED_AFTER_SLICE_B11) {
    const tool = tools.find((candidate) => candidate.name === name);
    assert.ok(tool, `${name} is not on the surface`);
    assert.equal(tool.effect, "read", name);
    assert.match(tool.description, /[Rr]eads only/, name);
  }
});

test("none of them is named anywhere in the never-delegated list, which did not change", async () => {
  const tools = await loadTools();
  const list = NEVER_DELEGATED.map((entry) => `${entry.operation} ${entry.reason}`).join(" | ");
  for (const name of THE_TOOLS_ADDED_AFTER_SLICE_B11) {
    assert.ok(!list.includes(name), `${name} appears in the never-delegated list`);
  }
  // The ten operations of slice B11, still ten: reading a figure's explanation, reading one's own
  // call log and opening the file of a reference neither add an operation an agent must not do,
  // nor remove one.
  assert.equal(NEVER_DELEGATED.length, 10);
  assert.equal(tools.filter((tool) => tool.effect !== "read").length, 2);
});

// The eighth tool opens the file of any reference the console search accepts, and one of those
// shapes is the public prefix of an MCP API key. Reading a key is on the never-delegated list, so
// the tool recognises that shape in order to REFUSE it and say why, rather than making the list
// smaller. This assertion is what keeps a later version from quietly answering it.
test("inspect_reference says in its own description that an MCP key prefix is refused, and why", async () => {
  const tools = await loadTools();
  const tool = tools.find((candidate) => candidate.name === "inspect_reference");
  assert.ok(tool);
  assert.match(tool.description, /cmk_/);
  assert.match(tool.description, /never delegated/);
  const keyRule = NEVER_DELEGATED.find((entry) => entry.operation.includes("MCP API key"));
  assert.ok(keyRule, "the never-delegated list no longer names reading an MCP API key");
});

test("THE WRITE TOOL COUNT IS STILL ONE: only request_claim_payment queues anything for a human", async () => {
  const tools = await loadTools();
  const writeTools = tools.filter((tool) => tool.effect === "queues_for_a_human");
  assert.deepEqual(
    writeTools.map((tool) => tool.name),
    ["request_claim_payment"],
  );
  // The reconciliation job is the only other tool that writes at all, and what it writes is a
  // comparison run: no journal entry, no money row.
  assert.deepEqual(
    tools.filter((tool) => tool.effect === "appends_a_run").map((tool) => tool.name),
    ["run_reconciliation"],
  );
});

test("the only tool that writes anything about money says in its own description that it moves none", async () => {
  const tools = await loadTools();
  const writeTool = tools.find((tool) => tool.name === "request_claim_payment");
  assert.ok(writeTool);
  assert.match(writeTool.description, /NEVER moves money/);
  assert.match(writeTool.description, /approv/i);
});

test("every tool declares a closed argument schema", async () => {
  // additionalProperties: false, so a client cannot smuggle a field a later version might read.
  const tools = await loadTools();
  for (const tool of tools) {
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
    assert.equal(tool.inputSchema.type, "object", tool.name);
  }
});

test("the summary says the write tool only queues, and that approving is never delegated", () => {
  assert.match(NEVER_DELEGATED_SUMMARY, /never moves money/);
  assert.match(NEVER_DELEGATED_SUMMARY, /Approving/);
});
