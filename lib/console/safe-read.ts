import { sanitisedSentence } from "@/lib/observability/redact";

// One panel of the console must never take the whole page down with it.
//
// WHY THIS EXISTS. The console is the screen an operator opens WHILE something is broken. If a
// single query fails (a permission the runtime role does not have, a statistics view the host
// does not expose, a table that is momentarily unreadable), the natural behaviour of a server
// component is to throw and render the error page instead of the console. That is exactly
// backwards: the one panel that cannot answer should say so, and the other twelve should still
// be readable.
//
// So every read behind a panel goes through `attempt`, and every panel renders either its rows
// or one red line saying which read failed and why. Nothing is retried and nothing is hidden.

export type Attempted<T> = { ok: true; value: T } | { ok: false; failure: string };

// The failure sentence goes through the SAME redaction as every log line
// (lib/observability/redact.ts, review finding F-OB-03). It used to be cut and stripped of
// newlines here, by hand, which stopped a query from reaching the screen but not a credential:
// a postgres.js connection error carries the connection string, and the connection string
// carries the password of the runtime role. This line renders on all seven console screens and
// from there into a screenshot, which AF-05 names as something to redact. `sanitisedSentence`
// also reads the message and never the stack, and caps the length.
export async function attempt<T>(what: string, read: Promise<T>): Promise<Attempted<T>> {
  try {
    return { ok: true, value: await read };
  } catch (error) {
    return { ok: false, failure: `${what} could not be read: ${sanitisedSentence(error)}` };
  }
}

// The value when the read worked, the fallback when it did not. Used by a panel that has a
// sensible empty shape (a list) and wants to print the failure line separately.
export function valueOr<T>(attempted: Attempted<T>, fallback: T): T {
  return attempted.ok ? attempted.value : fallback;
}
