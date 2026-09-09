import assert from "node:assert/strict";
import { test } from "node:test";
import { argumentsSchemaRefusal } from "./tool";

// The advertised schema, enforced (review finding F-B11-06). Every tool declares
// `additionalProperties: false`; before this check nothing read that declaration, so a client
// could send a field the tool ignored and believe it had been understood.

const schema = {
  type: "object" as const,
  properties: {
    policyNumber: { type: "string" },
    asOf: { type: "string" },
    windowDays: { type: "number" },
    // A closed list, the shape explain_amount advertises for its fifteen figure keys.
    figure: { type: "string", enum: ["premium_tax", "policy_fee"] },
    // The two bounds, the shape inspect_reference advertises for the reference it opens.
    reference: { type: "string", minLength: 1, maxLength: 20 },
  },
  required: ["policyNumber"],
  additionalProperties: false as const,
};

test("arguments the tool declares are accepted", () => {
  assert.equal(argumentsSchemaRefusal(schema, { policyNumber: "CGP-01274", asOf: "2028-03-01" }), null);
  assert.equal(argumentsSchemaRefusal(schema, { policyNumber: "CGP-01274", windowDays: 7 }), null);
});

test("a field the tool does not declare is refused, and the refusal does not repeat it", () => {
  const refusal = argumentsSchemaRefusal(schema, { policyNumber: "CGP-01274", asOfDate: "2028-03-01" });
  assert.ok(refusal);
  assert.ok(refusal.includes("1 argument(s) it does not declare"));
  // The name is the caller's own string and this sentence is written into the append-only call
  // log (review finding F-B11-02), so it names what the tool accepts and nothing else.
  assert.ok(!refusal.includes("asOfDate"));
});

test("a required field that is missing is refused before the tool runs", () => {
  assert.equal(argumentsSchemaRefusal(schema, { asOf: "2028-03-01" }), '"policyNumber" is required');
});

test("a declared type that does not match is refused", () => {
  assert.equal(argumentsSchemaRefusal(schema, { policyNumber: 1274 }), '"policyNumber" must be a string');
  assert.equal(
    argumentsSchemaRefusal(schema, { policyNumber: "CGP-01274", windowDays: "7" }),
    '"windowDays" must be a number',
  );
});

test("an optional field left out or explicitly null is not a type error", () => {
  assert.equal(argumentsSchemaRefusal(schema, { policyNumber: "CGP-01274", asOf: null }), null);
});

// The closed list is enforced here too (review finding F-MCPTOOLS-07 of round 1: explain_amount
// advertised an enum that only the tool itself checked, while lib/mcp/jsonrpc.ts told the reader
// the advertised schema was enforced at the transport). Enforced here means enforced BEFORE the
// tool runs, so before any database read.
test("a value the advertised enum does not list is refused, and the refusal names the LIST, not the value", () => {
  const refusal = argumentsSchemaRefusal(schema, {
    policyNumber: "CGP-01274",
    figure: "premium_tax_but_spelled_by_a_confident_agent",
  });
  assert.equal(refusal, '"figure" must be one of: premium_tax, policy_fee');
  // The value is the caller's own string and this sentence goes into the append-only call log
  // (finding F-B11-02), so it may name only what the tool declares.
  assert.ok(!refusal.includes("confident_agent"));
});

test("a value the enum does list is accepted, and a field with no enum is unaffected", () => {
  assert.equal(argumentsSchemaRefusal(schema, { policyNumber: "CGP-01274", figure: "policy_fee" }), null);
  assert.equal(argumentsSchemaRefusal(schema, { policyNumber: "CGP-01274", asOf: "anything at all" }), null);
});

// The advertised lengths are enforced here too, for the same reason as the enum:
// inspect_reference says in its schema that it opens a reference of 1 to 200 characters, and a
// bound nothing reads is a promise to the client rather than a control.
test("a string longer than the advertised maxLength is refused, and the refusal names the BOUND, not the value", () => {
  const refusal = argumentsSchemaRefusal(schema, {
    policyNumber: "CGP-01274",
    reference: "pi_a_reference_far_longer_than_this_tool_accepts",
  });
  assert.equal(refusal, '"reference" must be at most 20 characters long');
  // The value is the caller's own string and this sentence goes into the append-only call log
  // (finding F-B11-02), so it may name only what the tool declares.
  assert.ok(!refusal.includes("pi_a_reference"));
});

test("a string shorter than the advertised minLength is refused, and one inside both bounds is accepted", () => {
  assert.equal(
    argumentsSchemaRefusal(schema, { policyNumber: "CGP-01274", reference: "" }),
    '"reference" must be at least 1 character(s) long',
  );
  assert.equal(argumentsSchemaRefusal(schema, { policyNumber: "CGP-01274", reference: "pi_short" }), null);
});

test("a field with no declared length is unaffected by the bounds check", () => {
  assert.equal(argumentsSchemaRefusal(schema, { policyNumber: "CGP-01274-and-a-very-long-tail-nobody-bounded" }), null);
});
