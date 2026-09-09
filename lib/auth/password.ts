import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// The password of a user created by the operations team, hashed.
//
// WHAT THIS FILE IS FOR. Every seeded demo account of this build shares DEMO_PASSWORD
// (lib/auth/session.ts). A broker created from /ops/brokers?view=new is not seeded: the route
// generates one password, shows it to the operator once, and stores only this hash
// (users.password_hash, migration 0027). The plain password is never written to the database,
// never logged and never put in a URL.
//
// WHY SCRYPT AND NOT A HASH OF OUR OWN. scrypt is in node:crypto, it is deliberately slow and
// memory-hard, and it takes a salt, which is what stops one stolen hash from being reused
// against another account. We write no cryptography here: we call the library and store what it
// returns (READABLE-CODE.md, "use documented third-party libraries").
//
// THE STORED FORMAT, one string, three parts joined by a dollar sign:
//
//   scrypt$<saltHex>$<hashHex>
//
// The algorithm name is stored beside the value so that a future build can add a second one
// without having to guess what an old row was made with. Anything that is not exactly this shape
// is refused rather than interpreted.

// 64 bytes of derived key and 16 bytes of salt: the sizes the node documentation uses in its own
// scrypt example. The salt is random per password, so two users with the same password have two
// different hashes.
const DERIVED_KEY_LENGTH_BYTES = 64;
const SALT_LENGTH_BYTES = 16;

// The characters a one-time password is made of: no 0, no O, no 1, no l, no I. An operator reads
// this password off a screen and types it into a chat message or reads it out loud, so the pairs
// that look alike are simply not in the alphabet.
// Written in three pieces so each one says out loud which characters it leaves out.
const UPPERCASE_WITHOUT_I_AND_O = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWERCASE_WITHOUT_L_AND_O = "abcdefghijkmnpqrstuvwxyz";
const DIGITS_WITHOUT_ZERO_AND_ONE = "23456789";
export const ONE_TIME_PASSWORD_ALPHABET =
  UPPERCASE_WITHOUT_I_AND_O + LOWERCASE_WITHOUT_L_AND_O + DIGITS_WITHOUT_ZERO_AND_ONE;
export const ONE_TIME_PASSWORD_LENGTH = 20;

// Hashes a password with a fresh random salt. Async because scrypt is slow on purpose: doing it
// synchronously would block the whole server for the time it takes.
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH_BYTES);
  const derivedKey = await deriveKey(plain, salt);
  return `scrypt$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

// True only when `plain` is the password `stored` was made from. Every other case is false:
// a stored value of another shape, an unknown algorithm name, a salt or a hash that is not
// hexadecimal, a hash of the wrong length. A malformed row can never be made to match.
export async function passwordHashMatches(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }
  const salt = hexToBytes(parts[1]);
  const expectedKey = hexToBytes(parts[2]);
  if (!salt || !expectedKey || salt.length === 0 || expectedKey.length !== DERIVED_KEY_LENGTH_BYTES) {
    return false;
  }
  const derivedKey = await deriveKey(plain, salt);
  // Constant time: the server must not leak, through its answer time, how many bytes of a
  // guessed password were right. The two buffers have the same length here, which is what
  // timingSafeEqual requires.
  return timingSafeEqual(derivedKey, expectedKey);
}

// The password the operator reads once, on the screen that created the broker.
//
// 20 characters out of an alphabet of 56 is roughly 116 bits of entropy, which is far more than
// a person could guess and short enough to be typed. The bytes come from crypto.randomBytes,
// never from Math.random.
export function generateOneTimePassword(): string {
  const alphabetSize = ONE_TIME_PASSWORD_ALPHABET.length;
  // A byte holds 0 to 255. 256 is not a multiple of 56, so the last, incomplete run of the
  // alphabet (bytes 224 to 255) is thrown away instead of being wrapped around: wrapping would
  // make the first characters of the alphabet slightly more likely than the last ones.
  const largestUsableByte = Math.floor(256 / alphabetSize) * alphabetSize - 1;

  let password = "";
  while (password.length < ONE_TIME_PASSWORD_LENGTH) {
    // One draw of fresh bytes per round; a round keeps only the bytes it may keep.
    for (const byte of randomBytes(ONE_TIME_PASSWORD_LENGTH)) {
      if (byte > largestUsableByte) continue;
      password += ONE_TIME_PASSWORD_ALPHABET[byte % alphabetSize];
      if (password.length === ONE_TIME_PASSWORD_LENGTH) break;
    }
  }
  return password;
}

// scrypt with a callback, wrapped once so the two functions above read as plain awaits.
function deriveKey(plain: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(plain, salt, DERIVED_KEY_LENGTH_BYTES, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

// Buffer.from(text, "hex") quietly stops at the first character that is not hexadecimal and
// returns a short buffer, which would make a truncated stored value look usable. This checks the
// shape first and returns null when the text is not whole bytes of hexadecimal.
function hexToBytes(text: string): Buffer | null {
  if (text.length === 0 || text.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(text)) {
    return null;
  }
  return Buffer.from(text, "hex");
}
