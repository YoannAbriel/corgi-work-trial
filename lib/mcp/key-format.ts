import { createHash, randomBytes } from "node:crypto";

// The shape of an MCP API key, and the two hashes the endpoint computes. Pure functions only:
// no database, no clock, no environment.
//
// It is a file of its own because lib/mcp/keys.ts opens the application's connection pool as
// soon as it is loaded, and these rules deserve unit tests that need no database at all (the
// same reason lib/payments/refund-state.ts was split out of refunds.ts in slice B10).
//
// THE SHAPE OF A KEY, and why it has two parts:
//
//   cmk_1a2b3c4d_<43 random characters>
//   ^^^ ^^^^^^^^ ^^^^^^^^^^^^^^^^^^^^^
//   |   |        the secret: 32 random bytes, base64url. Printed once, by the script or the
//   |   |        screen that created the key, and never stored anywhere.
//   |   the public id: 8 random hex characters. Stored in clear as key_prefix, shown on the
//   |   staff screen and in the call log, so two keys can be told apart without anybody ever
//   |   writing a secret down. It is not a credential: knowing it opens nothing.
//   the family marker, so a key found in a terminal is recognisable for what it is.
//
// WHAT IS STORED: sha256 of the WHOLE presented key, hex. A lookup hashes what the caller
// presented and matches on that column, so the database never holds anything that could be
// replayed as a key. Losing the secret means creating a new key; there is no way to read it
// back, by design (AF-05).

export const KEY_FAMILY = "cmk"; // corgi mcp key

// The shape a presented key has to have before we even hash it. Rejecting a malformed key here
// costs one regular expression and saves a database round trip on random noise.
export const PRESENTED_KEY = /^cmk_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/;

// Who holds a key. It says nothing about what the key may SEE (that is its user's business);
// it says whether a person or a machine is on the other end, which is what an approver has to
// know when a request reaches the queue.
export type PrincipalKind = "human" | "agent";

export type GeneratedKey = {
  // The one and only time this value exists. The caller prints it and forgets it.
  presentedKey: string;
  keyPrefix: string;
  keyHash: string;
};

export function generateApiKey(): GeneratedKey {
  const publicId = randomBytes(4).toString("hex"); // 8 hex characters
  const secret = randomBytes(32).toString("base64url"); // 43 characters
  const keyPrefix = `${KEY_FAMILY}_${publicId}`;
  const presentedKey = `${keyPrefix}_${secret}`;
  return { presentedKey, keyPrefix, keyHash: hashApiKey(presentedKey) };
}

export function hashApiKey(presentedKey: string): string {
  return createHash("sha256").update(presentedKey).digest("hex");
}

// The public half of a presented key, or null when the value is not shaped like one of our
// keys at all. Used for the shape check; the prefix that ends up in the log is always the one
// read from the matched row, never one parsed out of what a caller sent.
export function keyPrefixOf(presentedKey: string): string | null {
  if (!PRESENTED_KEY.test(presentedKey)) {
    return null;
  }
  // The FIRST two segments, not everything before the last underscore: base64url uses "_" as
  // one of its characters, so a secret can contain underscores of its own.
  const [family, publicId] = presentedKey.split("_");
  return `${family}_${publicId}`;
}

// The fingerprint of a call's arguments, so two identical calls can be recognised as identical
// without this application storing what was asked. Keys are sorted, so the same arguments
// always produce the same text whatever order the client sent them in.
export function hashArguments(argumentsValue: unknown): string {
  return createHash("sha256").update(canonicalJson(argumentsValue)).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, fieldValue]) => fieldValue !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([name, fieldValue]) => `${JSON.stringify(name)}:${canonicalJson(fieldValue)}`).join(",")}}`;
}

