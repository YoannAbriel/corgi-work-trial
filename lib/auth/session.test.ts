import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordMatches, readSessionCookie, signSessionCookie } from "./session";

const SECRET = "a-test-secret-of-at-least-16-characters";
const USER = "55555555-5555-4555-8555-555555555555";
const NOW = 1_800_000_000; // a fixed clock, so the test never depends on the current time

test("a cookie signed by the server is read back as its user", () => {
  const cookie = signSessionCookie(USER, NOW + 3600, SECRET);
  assert.equal(readSessionCookie(cookie, SECRET, NOW), USER);
});

test("changing the user id invalidates the signature", () => {
  const cookie = signSessionCookie(USER, NOW + 3600, SECRET);
  const forged = cookie.replace(USER, "66666666-6666-4666-8666-666666666666");
  assert.equal(readSessionCookie(forged, SECRET, NOW), null);
});

test("extending the expiry by hand invalidates the signature", () => {
  const cookie = signSessionCookie(USER, NOW + 3600, SECRET);
  const [userId, , signature] = cookie.split(".");
  assert.equal(readSessionCookie(`${userId}.${NOW + 999999}.${signature}`, SECRET, NOW), null);
});

test("a cookie signed with another secret is refused", () => {
  const cookie = signSessionCookie(USER, NOW + 3600, "another-secret-of-16-plus-characters");
  assert.equal(readSessionCookie(cookie, SECRET, NOW), null);
});

test("an expired cookie is refused", () => {
  const cookie = signSessionCookie(USER, NOW - 1, SECRET);
  assert.equal(readSessionCookie(cookie, SECRET, NOW), null);
});

test("a missing or malformed cookie is refused, never guessed", () => {
  assert.equal(readSessionCookie(undefined, SECRET, NOW), null);
  assert.equal(readSessionCookie("", SECRET, NOW), null);
  assert.equal(readSessionCookie("not-a-cookie", SECRET, NOW), null);
  assert.equal(readSessionCookie(`${USER}.${NOW + 10}`, SECRET, NOW), null);
});

test("the demo password is compared exactly", () => {
  assert.equal(passwordMatches("correct horse", "correct horse"), true);
  assert.equal(passwordMatches("correct hors", "correct horse"), false);
  assert.equal(passwordMatches("", "correct horse"), false);
});
