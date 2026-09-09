import type postgres from "postgres";
import { formatCentsAsUsd } from "@/lib/money/cents";
import type { McpPrincipal } from "@/lib/mcp/keys";
import type { ScopedUser } from "@/lib/mcp/scope";

// What every MCP tool of this build is made of, and the three helpers they all share.
//
// A tool is a name, a description, a JSON Schema for its arguments, and one function. It gets
// the principal behind the API key and a database handle, and it returns a plain object. The
// transport (lib/mcp/jsonrpc.ts) turns that object into the two shapes an MCP client expects:
// `structuredContent` (the object itself) and `content` (the same object as pretty JSON text,
// which is what a model actually reads).
//
// TWO RULES EVERY TOOL FOLLOWS, so that an agent cannot misread an amount:
//   1. every money figure is an object { cents, formatted }: the integer the arithmetic uses
//      and the string a person reads, never a float and never a bare number of dollars;
//   2. every answer carries `whatThisMeans`, one sentence in English saying what the figures
//      say. A model that only reads that sentence should still not be misled.

export type ToolContext = {
  principal: McpPrincipal;
  user: ScopedUser;
  database: postgres.Sql;
  // The clock, passed in rather than read inside a tool, so ages and default dates are
  // deterministic in the check script.
  now: Date;
};

// A refusal a caller can act on: not visible to this key, wrong role, malformed argument.
// It becomes an MCP tool error (isError: true) with this sentence, and the call is logged as
// 'refused'. It is never a 500 and never carries anything the caller may not see.
export class ToolRefused extends Error {}

export type ToolAnswer = Record<string, unknown>;

// WHAT A TOOL CHANGES, declared by the tool rather than guessed from its name:
//   'read'                it writes nothing at all;
//   'appends_a_run'       it appends a reconciliation run and its items, and moves no money;
//   'queues_for_a_human'  the ONE write tool of this surface: it creates an approval request.
// tools/list publishes it as the protocol's readOnlyHint, and lib/mcp/never-delegated.test.ts
// asserts that exactly one tool of the last kind exists, so a future write tool cannot be added
// without that test saying so.
export type ToolEffect = "read" | "appends_a_run" | "queues_for_a_human";

export type McpTool = {
  name: string;
  title: string;
  description: string;
  effect: ToolEffect;
  // Extra fields for this tool's tools/list annotations, on top of the hints the transport adds
  // for every tool. Used by explain_amount to publish the closed list of figure keys it accepts.
  annotations?: Record<string, unknown>;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
  run: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolAnswer>;
};

// One money figure, both ways round.
export function usd(amountCents: number): { cents: number; formatted: string } {
  return { cents: amountCents, formatted: formatCentsAsUsd(amountCents) };
}

// ---------------------------------------------------------------------------
// The advertised schema, enforced
// ---------------------------------------------------------------------------

// Every tool declares `additionalProperties: false`, and until review finding F-B11-06 nothing
// checked it: each tool read its own named fields and ignored the rest, so the closed schema was
// a promise to the client rather than a control. This is the check, run once by the transport
// before a tool sees its arguments, so no tool can ever rely on a guarantee nobody enforces.
//
// It stays deliberately small: the shapes this build advertises are strings, numbers, booleans,
// a required list and a closed `enum`. It is not a JSON Schema implementation, and it says so.
//
// THE `enum` IS ENFORCED HERE TOO (review finding F-MCPTOOLS-07 of round 1). explain_amount
// advertises the fifteen figure keys it accepts as an enum; until now nothing read that
// declaration, so the tool's own check was the only thing standing behind an advertised
// guarantee. It is now refused before the tool runs, which means BEFORE ANY DATABASE READ: a
// caller that misspells a figure key never reaches a policy row.
//
// The sentence never repeats what the caller sent, only what the tool declares, because it is
// written into the append-only call log (review finding F-B11-02).
export function argumentsSchemaRefusal(
  schema: McpTool["inputSchema"],
  args: Record<string, unknown>,
): string | null {
  const declared = Object.keys(schema.properties);
  const undeclaredCount = Object.keys(args).filter((name) => !declared.includes(name)).length;
  if (undeclaredCount > 0) {
    return (
      `this tool accepts ${declared.length === 0 ? "no arguments" : declared.map((name) => `"${name}"`).join(", ")} ` +
      `and nothing else; the call sent ${undeclaredCount} argument(s) it does not declare`
    );
  }

  for (const name of schema.required ?? []) {
    if (args[name] === undefined || args[name] === null) {
      return `"${name}" is required`;
    }
  }

  for (const [name, definition] of Object.entries(schema.properties)) {
    const value = args[name];
    if (value === undefined || value === null) {
      continue;
    }
    const declaredType = (definition as { type?: unknown }).type;
    if (declaredType === "string" && typeof value !== "string") {
      return `"${name}" must be a string`;
    }
    if (declaredType === "number" && typeof value !== "number") {
      return `"${name}" must be a number`;
    }
    if (declaredType === "boolean" && typeof value !== "boolean") {
      return `"${name}" must be true or false`;
    }
    // The closed list, when the tool declares one. The sentence names the list the TOOL declares
    // and never the value the CALLER sent, for the same reason as every other refusal here: it
    // is written into mcp_calls, which can never be updated, deleted or truncated (F-B11-02).
    const allowedValues = (definition as { enum?: unknown }).enum;
    if (Array.isArray(allowedValues) && !allowedValues.includes(value)) {
      return `"${name}" must be one of: ${allowedValues.join(", ")}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reading arguments: refuse early, with the field name in the sentence
// ---------------------------------------------------------------------------

export function requiredText(args: Record<string, unknown>, field: string): string {
  const value = args[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ToolRefused(`"${field}" is required and must be a non-empty string`);
  }
  return value.trim();
}

export function optionalText(args: Record<string, unknown>, field: string): string | null {
  const value = args[field];
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new ToolRefused(`"${field}" must be a string when it is given`);
  }
  return value.trim();
}

export function requiredWholeNumber(args: Record<string, unknown>, field: string): number {
  const value = args[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new ToolRefused(`"${field}" is required and must be a whole number (integer cents, never dollars)`);
  }
  return value;
}

export function optionalWholeNumber(args: Record<string, unknown>, field: string): number | null {
  const value = args[field];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new ToolRefused(`"${field}" must be a whole number when it is given`);
  }
  return value;
}
