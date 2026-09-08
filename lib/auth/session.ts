import { createHmac, timingSafeEqual } from "node:crypto";

// The whole session mechanism, in one file, small enough to read in a minute.
//
// The cookie carries three parts joined by dots: the user id, the moment it stops being valid
// (seconds since 1970, UTC), and an HMAC-SHA256 signature of the first two computed with
// SESSION_SECRET. There is no session table and no encryption: the cookie says who you are,
// the signature proves the server wrote it, the expiry limits how long it is worth stealing.
// Changing one character of the user id or the expiry invalidates the signature.
//
// This is enough for a trial with four synthetic demo accounts. It is not a production
// authentication system: there is no revocation list, so a stolen cookie stays valid until it
// expires, and every demo user shares the DEMO_PASSWORD.

export const SESSION_COOKIE_NAME = "corgi_session";
export const SESSION_LIFETIME_SECONDS = 12 * 60 * 60;

// Pure: the secret and the clock come in as arguments, so the tests need no environment.
export function signSessionCookie(userId: string, expiresAtEpochSeconds: number, secret: string): string {
  if (userId.includes(".")) {
    throw new Error("a user id cannot contain a dot: it is the separator of the cookie");
  }
  const signedPart = `${userId}.${expiresAtEpochSeconds}`;
  return `${signedPart}.${signature(signedPart, secret)}`;
}

// Returns the user id when the cookie is genuine and still valid, null in every other case:
// wrong shape, wrong signature, signature from another secret, or expired.
export function readSessionCookie(
  cookieValue: string | undefined,
  secret: string,
  nowEpochSeconds: number,
): string | null {
  if (!cookieValue) {
    return null;
  }
  const parts = cookieValue.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [userId, expiresAtText, providedSignature] = parts;
  const expectedSignature = signature(`${userId}.${expiresAtText}`, secret);
  if (!signaturesMatch(providedSignature, expectedSignature)) {
    return null;
  }
  const expiresAtEpochSeconds = Number(expiresAtText);
  if (!Number.isSafeInteger(expiresAtEpochSeconds) || expiresAtEpochSeconds <= nowEpochSeconds) {
    return null;
  }
  return userId;
}

function signature(signedPart: string, secret: string): string {
  return createHmac("sha256", secret).update(signedPart).digest("base64url");
}

// Compared byte by byte in constant time so that the server does not leak, through its answer
// time, how much of a forged signature was correct.
function signaturesMatch(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  if (providedBytes.length !== expectedBytes.length) {
    return false;
  }
  return timingSafeEqual(providedBytes, expectedBytes);
}

// The same constant-time comparison for the shared demo password.
export function passwordMatches(submitted: string, expected: string): boolean {
  return signaturesMatch(submitted, expected);
}

export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET must be set to at least 16 characters");
  }
  return secret;
}

export function demoPassword(): string {
  const password = process.env.DEMO_PASSWORD;
  if (!password) {
    throw new Error("DEMO_PASSWORD must be set");
  }
  return password;
}
