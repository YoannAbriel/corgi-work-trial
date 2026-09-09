import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateOneTimePassword,
  hashPassword,
  ONE_TIME_PASSWORD_ALPHABET,
  ONE_TIME_PASSWORD_LENGTH,
  passwordHashMatches,
} from "./password";

// A fixed plain password for the tests, written as words so a secret scanner reads it as text.
const PASSWORD = "the-one-time-password-of-a-test-broker";
const ANOTHER_PASSWORD = "the-one-time-password-of-another-broker";

test("a password hashed here is recognised by the same password", async () => {
  const stored = await hashPassword(PASSWORD);
  assert.ok(stored.startsWith("scrypt$"));
  assert.equal(await passwordHashMatches(PASSWORD, stored), true);
});

test("another password is refused", async () => {
  const stored = await hashPassword(PASSWORD);
  assert.equal(await passwordHashMatches(ANOTHER_PASSWORD, stored), false);
  assert.equal(await passwordHashMatches("", stored), false);
});

test("two hashes of the same password differ, because the salt is random", async () => {
  const first = await hashPassword(PASSWORD);
  const second = await hashPassword(PASSWORD);
  assert.notEqual(first, second);
  // Both still open the account: the salt travels inside the stored string.
  assert.equal(await passwordHashMatches(PASSWORD, first), true);
  assert.equal(await passwordHashMatches(PASSWORD, second), true);
});

test("a malformed stored value is refused rather than interpreted", async () => {
  const stored = await hashPassword(PASSWORD);
  const [, saltHex, hashHex] = stored.split("$");
  for (const malformed of [
    "",
    "scrypt",
    "scrypt$",
    `scrypt$${saltHex}`,
    `bcrypt$${saltHex}$${hashHex}`, // an algorithm this build does not know
    `scrypt$${saltHex}$${hashHex}$extra`,
    `scrypt$zzzz$${hashHex}`, // a salt that is not hexadecimal
    `scrypt$${saltHex}$${hashHex.slice(0, 32)}`, // a hash of the wrong length
    `scrypt$$${hashHex}`, // an empty salt
    PASSWORD, // the plain password, stored by mistake
  ]) {
    assert.equal(await passwordHashMatches(PASSWORD, malformed), false, `accepted "${malformed.slice(0, 20)}"`);
  }
});

test("a generated password is twenty characters of the unambiguous alphabet", () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const password = generateOneTimePassword();
    assert.equal(password.length, ONE_TIME_PASSWORD_LENGTH);
    for (const character of password) {
      assert.ok(ONE_TIME_PASSWORD_ALPHABET.includes(character), `"${character}" is not in the alphabet`);
    }
    // The characters a person cannot tell apart on a screen are not in the alphabet at all.
    assert.doesNotMatch(password, /[0O1lI]/);
  }
});

test("two generated passwords are not the same", () => {
  const passwords = new Set(Array.from({ length: 50 }, generateOneTimePassword));
  assert.equal(passwords.size, 50);
});

test("a generated password opens the account it was hashed for", async () => {
  const password = generateOneTimePassword();
  const stored = await hashPassword(password);
  assert.equal(await passwordHashMatches(password, stored), true);
  assert.equal(await passwordHashMatches(generateOneTimePassword(), stored), false);
});
