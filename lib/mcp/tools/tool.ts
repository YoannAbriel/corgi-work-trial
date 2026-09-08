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

export type McpTool = {
  name: string;
  title: string;
  description: string;
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
