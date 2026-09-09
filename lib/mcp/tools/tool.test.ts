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
