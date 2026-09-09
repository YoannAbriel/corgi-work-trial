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

// The message is cut and stripped of newlines: a database error can carry a query, and a query
// can carry a value. What reaches the screen is one short sentence.
const MOST_CHARACTERS_OF_A_FAILURE = 300;

export async function attempt<T>(what: string, read: Promise<T>): Promise<Attempted<T>> {
  try {
    return { ok: true, value: await read };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      failure: `${what} could not be read: ${message.replace(/\s+/g, " ").slice(0, MOST_CHARACTERS_OF_A_FAILURE)}`,
    };
  }
}

// The value when the read worked, the fallback when it did not. Used by a panel that has a
// sensible empty shape (a list) and wants to print the failure line separately.
export function valueOr<T>(attempted: Attempted<T>, fallback: T): T {
  return attempted.ok ? attempted.value : fallback;
}
