import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalJson,
  DEFAULT_TOKEN_LIFETIME,
  expiryInstant,
  generateApiKey,
  hashApiKey,
  hashArguments,
  isTokenLifetime,
  keyPrefixOf,
  tokenExpiresSoon,
  tokenHasExpired,
  TOKEN_LIFETIMES,
} from "./key-format";

// The key format and the hashing, proved without a database: these are the two facts the whole
// authentication of the MCP endpoint rests on.

test("a generated key is prefix plus secret, and the prefix is the public half", () => {
  const key = generateApiKey();
  assert.match(key.presentedKey, /^cmk_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/);
  assert.equal(keyPrefixOf(key.presentedKey), key.keyPrefix);
  assert.match(key.keyPrefix, /^cmk_[0-9a-f]{8}$/);
  // The stored prefix is a PREFIX of the presented key and nothing more: knowing it gives away
  // none of the secret.
  assert.ok(key.presentedKey.startsWith(`${key.keyPrefix}_`));
  assert.equal(key.presentedKey.length, key.keyPrefix.length + 1 + 43);
});

test("two generated keys never collide", () => {
  const first = generateApiKey();
  const second = generateApiKey();
  assert.notEqual(first.presentedKey, second.presentedKey);
  assert.notEqual(first.keyPrefix, second.keyPrefix);
  assert.notEqual(first.keyHash, second.keyHash);
});

test("the stored hash is the sha256 of the WHOLE presented key", () => {
  const key = generateApiKey();
  assert.equal(key.keyHash, hashApiKey(key.presentedKey));
  assert.match(key.keyHash, /^[0-9a-f]{64}$/);
  // The secret itself is nowhere in what is stored.
  const secret = key.presentedKey.slice(key.keyPrefix.length + 1);
  assert.ok(!key.keyHash.includes(secret));
});

test("the hash of a known value, so a change of algorithm cannot pass unnoticed", () => {
  // sha256("cmk_00000000_test"), computed independently with `printf %s ... | shasum -a 256`.
  assert.equal(hashApiKey("cmk_00000000_test"), "3d2b6b6ea9c6631fa17922a485930be3d1f2b79abd0599f339b05aa643968075");
});

test("one wrong character gives a completely different hash", () => {
  const key = generateApiKey();
  const nearlyRight = `${key.presentedKey.slice(0, -1)}${key.presentedKey.endsWith("A") ? "B" : "A"}`;
  assert.notEqual(hashApiKey(nearlyRight), key.keyHash);
});

test("anything not shaped like one of our keys has no prefix, so it is refused before the database", () => {
  assert.equal(keyPrefixOf(""), null);
  assert.equal(keyPrefixOf("Bearer something"), null);
  assert.equal(keyPrefixOf("cmk_1234_short"), null);
  assert.equal(keyPrefixOf("sk_test_pretending_to_be_a_stripe_key"), null);
  // The right shape but the wrong family marker.
  assert.equal(keyPrefixOf("abc_1a2b3c4d_0123456789012345678901234567890123456789012"), null);
});

// ---------------------------------------------------------------------------
// The fingerprint of a call's arguments
// ---------------------------------------------------------------------------

test("the argument fingerprint does not depend on the order the client sent the fields in", () => {
  assert.equal(
    hashArguments({ policyNumber: "CGP-01274", asOf: "2028-03-01" }),
    hashArguments({ asOf: "2028-03-01", policyNumber: "CGP-01274" }),
  );
});

test("different arguments give different fingerprints", () => {
  assert.notEqual(hashArguments({ amountCents: 120000 }), hashArguments({ amountCents: 120001 }));
});

test("the fingerprint does not contain what was asked", () => {
  const fingerprint = hashArguments({ policyNumber: "CGP-01274" });
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
  assert.ok(!fingerprint.includes("CGP"));
});

test("canonical JSON sorts keys everywhere, including inside arrays and nested objects", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } }), '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}');
  assert.equal(canonicalJson(undefined), "null");
  assert.equal(canonicalJson({ kept: 1, dropped: undefined }), '{"kept":1}');
});

// ---------------------------------------------------------------------------
// When a token stops answering (migration 0026)
// ---------------------------------------------------------------------------

// The clock is an argument everywhere below, so these facts are the same in every timezone and
// at every hour of the day.
const NOON = new Date("2026-09-09T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

test("the five expirations the form offers, and the instant each one produces", () => {
  assert.deepEqual(
    TOKEN_LIFETIMES.map((lifetime) => lifetime.value),
    ["7d", "30d", "90d", "1y", "never"],
  );
  assert.equal(expiryInstant("7d", NOON)?.toISOString(), "2026-09-16T12:00:00.000Z");
  assert.equal(expiryInstant("30d", NOON)?.toISOString(), "2026-10-09T12:00:00.000Z");
  assert.equal(expiryInstant("90d", NOON)?.toISOString(), "2026-12-08T12:00:00.000Z");
  assert.equal(expiryInstant("1y", NOON)?.toISOString(), "2027-09-09T12:00:00.000Z");
  // "never" is stored as null, which is exactly what every token created before 0026 holds.
  assert.equal(expiryInstant("never", NOON), null);
  assert.equal(DEFAULT_TOKEN_LIFETIME, "90d");
});

test("anything that is not one of the five is refused rather than turned into never", () => {
  assert.ok(isTokenLifetime("90d"));
  assert.ok(!isTokenLifetime(""));
  assert.ok(!isTokenLifetime("90"));
  assert.ok(!isTokenLifetime("10y"));
  assert.ok(!isTokenLifetime("NEVER"));
});

test("a token with no expiration never expires; one dated in the past does", () => {
  assert.equal(tokenHasExpired(null, NOON), false);
  assert.equal(tokenHasExpired(new Date(NOON.getTime() + 1), NOON), false);
  // The stored instant is the moment it is over: at exactly that instant the token is refused.
  assert.equal(tokenHasExpired(NOON, NOON), true);
  assert.equal(tokenHasExpired(new Date(NOON.getTime() - 1), NOON), true);
});

test("expiring soon is the last seven days, and neither never nor already expired", () => {
  assert.equal(tokenExpiresSoon(new Date(NOON.getTime() + 6 * DAY_MS), NOON), true);
  assert.equal(tokenExpiresSoon(new Date(NOON.getTime() + 7 * DAY_MS), NOON), false);
  assert.equal(tokenExpiresSoon(new Date(NOON.getTime() + 30 * DAY_MS), NOON), false);
  assert.equal(tokenExpiresSoon(null, NOON), false);
  assert.equal(tokenExpiresSoon(new Date(NOON.getTime() - DAY_MS), NOON), false);
});
