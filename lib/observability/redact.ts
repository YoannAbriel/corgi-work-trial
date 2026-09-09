// One function decides what a log line is allowed to say. Nothing else in this application
// writes to a log, so this file is the whole of the redaction rule and the whole of its risk.
//
// WHY IT IS ONE FUNCTION. AGENTS.md (Operations and security) asks for structured redacted logs
// and never full request or response bodies; AF-05 says sandbox credentials are secrets too, and
// that logs, fixtures and evidence must be redacted. A rule spread over five call sites is a
// rule with five ways to be forgotten. This one is called on every sentence that reaches the
// JSON line and the activity_log row, and it has its own tests (redact.test.ts).
//
// WHAT IT DOES NOT DO. It is not a security boundary against a caller deliberately hiding a
// secret from it (base64, a split string). It is the discipline that keeps the ordinary things
// out of the log: an error message quoting an email, a database URL with its password, a header
// that was pasted into the wrong terminal. The stronger control is upstream and structural: the
// helper logs error.message and never error.stack, and migration 0021 gives the table no column
// a payload could be put in.

// A sentence, not a document. A log line is read during an incident; 300 characters is what an
// operator reads. The database allows 500, so a cut sentence can never fail an insert.
export const MOST_CHARACTERS_OF_A_MESSAGE = 300;

// The Stripe and application prefixes that are REFERENCES and stay readable. Every one of them
// is an identifier a person needs during an incident and none of them authenticates anything:
//   pi_ cs_ re_ acct_ evt_   Stripe objects, already printed on the console screens;
//   cmk_                     the PUBLIC prefix of an MCP API key (migration 0018), never the key.
// The secrets are the other family: sk_ (secret key), rk_ (restricted key) and whsec_ (webhook
// signing secret). Those are masked, below, and a reviewer greps a log for them expecting zero.
const SECRET_KEY_SHAPE = /\b(sk|rk|whsec)_[A-Za-z0-9_-]{3,}/g;

// "Authorization: Bearer <token>" is how the cron secret and every MCP API key arrive. The token
// itself never appears, whatever it was.
const BEARER_SHAPE = /bearer\s+[A-Za-z0-9._~+/=-]{4,}/gi;

// A password in a form field, a query string or a JSON body: password=..., "password": "...".
// DEMO_PASSWORD is shared by every demo account, so one leaked line is every account.
const PASSWORD_FIELD_SHAPE = /("?)(password|passwd|secret|token)\1(\s*[:=]\s*)("?)([^"\s,&}]+)\4/gi;

// The password inside a connection string: postgres://user:password@host/database. A postgres.js
// error can carry one, and DATABASE_URL_APP is a credential.
const CONNECTION_STRING_CREDENTIALS = /\/\/[^\s:/@]+:[^\s@/]+@/g;

// An email address. Masked rather than removed: "who was this about" is often the question, and
// the first three characters answer it for an operator who already knows the account.
const EMAIL_SHAPE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// The mask an email gets: its first three characters and four asterisks. The console masks names
// and emails the same way on screen (components/console-parts.tsx, maskToFirstThree), so a
// person reading a log line and a person reading the console see the same shape.
export function maskEmail(email: string): string {
  return `${email.slice(0, 3)}****`;
}

// The one sanitiser. Order matters: the connection string and the bearer token are removed before
// the email rule can match the "user:password@host" that looks like one.
export function redact(raw: string): string {
  const onOneLine = raw.replace(/\s+/g, " ").trim();
  const withoutCredentials = onOneLine
    .replace(CONNECTION_STRING_CREDENTIALS, "//****:****@")
    .replace(BEARER_SHAPE, "Bearer ****")
    .replace(PASSWORD_FIELD_SHAPE, "$1$2$1$3$4****$4")
    .replace(SECRET_KEY_SHAPE, "$1_****")
    .replace(EMAIL_SHAPE, maskEmail);
  return withoutCredentials.slice(0, MOST_CHARACTERS_OF_A_MESSAGE);
}

// What a thrown value is allowed to contribute to a log line: its message, redacted, and never
// its stack. A stack names file paths, and the frames of a database driver carry the query,
// which carries the values. `error.stack` is deliberately not read anywhere in this file.
export function sanitisedSentence(thrown: unknown): string {
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  const firstLine = message.split("\n")[0] ?? "";
  const sanitised = redact(firstLine);
  return sanitised === "" ? "no message" : sanitised;
}
