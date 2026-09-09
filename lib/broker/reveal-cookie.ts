// The cookie that carries a new broker's sign-in details from POST /api/brokers to the screen
// that shows them once.
//
// WHY A COOKIE AND NOT THE URL. The route answers with a redirect, and a password in a redirect
// would be in the browser history, in the referrer of the next request, and in every proxy log
// on the way. The cookie is HttpOnly (no script reads it), SameSite=Strict (no other site can
// make the browser send it), scoped to Path=/ops/brokers (no other page of the application ever
// receives it) and it expires on its own after two minutes.
//
// WHY IT IS SHOWN ONCE. Nothing stores the password: the database has only its scrypt hash
// (lib/auth/password.ts). The operator copies it and presses Done, which posts to
// /ops/brokers/reveal/consume and deletes the cookie. If it is lost, the answer is to create the
// broker again, and the screen says so.

export const BROKER_PASSWORD_REVEAL_COOKIE = "broker_password_reveal";

// Two minutes: long enough to copy a password into a message, short enough that a shared screen
// or a walk to the coffee machine does not leave it readable.
export const REVEAL_COOKIE_MAX_AGE_SECONDS = 120;

// The path the cookie is scoped to. The browser sends it to this page and to the consume route
// underneath it, and to nothing else in the application.
export const REVEAL_COOKIE_PATH = "/ops/brokers";

export type RevealedSignIn = {
  email: string;
  password: string;
};

// The value is "<email>|<password>". A vertical bar cannot appear in an email address and is not
// in the password alphabet (lib/auth/password.ts), so the first bar is always the separator.
export function revealCookieValue(signIn: RevealedSignIn): string {
  return `${signIn.email}|${signIn.password}`;
}

// Reads that value back. Anything else is null: the page then says the password is gone rather
// than printing half of it.
export function readRevealCookieValue(raw: string | undefined): RevealedSignIn | null {
  if (!raw) return null;
  const separator = raw.indexOf("|");
  if (separator <= 0 || separator === raw.length - 1) return null;
  return { email: raw.slice(0, separator), password: raw.slice(separator + 1) };
}

// The Set-Cookie header that hands the details to the browser.
//
// Secure only in production: the flag would stop the cookie from being set at all on the plain
// HTTP of local development, and the deployment is HTTPS. This is the same rule as the session
// cookie (app/api/session/login/route.ts), written from NODE_ENV because this route has no
// APP_BASE_URL to read.
export function revealCookieHeader(signIn: RevealedSignIn): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${BROKER_PASSWORD_REVEAL_COOKIE}=${revealCookieValue(signIn)}; Path=${REVEAL_COOKIE_PATH}; HttpOnly; SameSite=Strict; Max-Age=${REVEAL_COOKIE_MAX_AGE_SECONDS}${secure}`;
}

// The Set-Cookie header that removes it. Same name and SAME PATH: a cookie is identified by both,
// so a deletion sent on another path would leave this one in place.
export function expiredRevealCookieHeader(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${BROKER_PASSWORD_REVEAL_COOKIE}=; Path=${REVEAL_COOKIE_PATH}; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}
