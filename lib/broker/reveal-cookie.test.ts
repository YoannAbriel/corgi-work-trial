import { test } from "node:test";
import assert from "node:assert/strict";
import { isCookieSafeValue, readRevealCookieValue, revealCookieValue } from "./reveal-cookie";

// The value the reveal cookie carries, both ways: what goes in comes back out whole.
test("an email and a password survive the trip through the cookie value", () => {
  const signIn = { email: "broker@example.invalid", password: "aBcDeFgHjKmNpQrStUvW" };
  assert.deepEqual(readRevealCookieValue(revealCookieValue(signIn)), signIn);
});

test("anything that is not <email>|<password> reads as nothing at all", () => {
  // No bar, a bar in first position, a bar in last position: the page must then say the password
  // is gone rather than print half of it.
  assert.equal(readRevealCookieValue("broker@example.invalid"), null);
  assert.equal(readRevealCookieValue("|aBcDeFgHjKmNpQrStUvW"), null);
  assert.equal(readRevealCookieValue("broker@example.invalid|"), null);
  assert.equal(readRevealCookieValue(undefined), null);
});

// ---------------------------------------------------------------------------------------
// The characters a cookie value may hold (review finding F-NEWBROKER-01). The two that matter
// are the semicolon, which would cut the password off the value, and the comma, which some HTTP
// clients read as the start of a second cookie on this cookie's path.
// ---------------------------------------------------------------------------------------

test("an ordinary address and a one-time password are cookie safe", () => {
  assert.equal(isCookieSafeValue("broker@example.invalid|aBcDeFgHjKmNpQrStUvW"), true);
  // The punctuation a real address does use, none of which a cookie value forbids.
  assert.equal(isCookieSafeValue("first.last+tag_1-2@sub.example.invalid"), true);
});

test("the five characters a cookie value may not hold are refused", () => {
  assert.equal(isCookieSafeValue("probe;max-age=99999@example.invalid"), false);
  assert.equal(isCookieSafeValue("probe,corgi_session=x@example.invalid"), false);
  assert.equal(isCookieSafeValue('probe"quote@example.invalid'), false);
  assert.equal(isCookieSafeValue("probe\\backslash@example.invalid"), false);
  assert.equal(isCookieSafeValue("probe space@example.invalid"), false);
});

test("a control character is refused too", () => {
  // A newline in a header value is the header-splitting case. It never gets as far as the header.
  assert.equal(isCookieSafeValue("probe\nSet-Cookie: x=y@example.invalid"), false);
  // The delete character, written as an escape so the source file holds no invisible byte.
  assert.equal(isCookieSafeValue("probe\u007f@example.invalid"), false);
});
