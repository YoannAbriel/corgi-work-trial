import { randomUUID } from "node:crypto";
import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/http/path-ids";
import { redact, sanitisedSentence } from "./redact";

// withActivity: the one wrapper every route handler of this application is wrapped in.
//
// WHAT IT IS FOR (decision 25 of DECISIONS.md, review finding F-RC-07). AGENTS.md asks for
// structured, redacted logs with correlation ids. Before this, a request that worked left its
// effects (a journal entry, an mcp_calls row) and a request that was REFUSED left nothing at
// all: an operator could not see that a broker had been told no eleven times, nor how long any
// screen took. This wrapper gives every request one record, in two places at once:
//
//   1. ONE ROW in activity_log (migration 0021), append-only, which the console reads;
//   2. ONE JSON LINE on stdout, the same fields and nothing else, which is what a Vercel log
//      holds. The two carry the same correlation id, so a line and a row are the same request.
//
// WHAT IT NEVER DOES:
//
//   - it never changes what a handler answers. The response is returned untouched, and a throw
//     is re-thrown after being recorded, so every route behaves exactly as it did before;
//   - it never breaks a request when the database refuses the insert. The row is best effort,
//     said once here and never argued about again: an operations log that could take the
//     application down would be worse than no operations log. (The MCP endpoint is the one
//     surface that does the opposite, and deliberately: mcp_calls is an AUDIT record, and
//     app/api/mcp/route.ts refuses to answer a call it could not write down. This table is not
//     that record; it is the diagnostic one, and it fails open.)
//   - it never logs a body. There is no payload column in migration 0021 and no payload field
//     here. Every sentence goes through redact() (lib/observability/redact.ts).
//
// THE SHAPE AT A CALL SITE, three lines in each route file:
//
//   export const POST = withActivity({ route: "/api/policies/[policyId]/bind", subject: "policy" }, handlePost);
//   async function handlePost(request: Request, context: { params: Promise<{ policyId: string }> }) {
//     ... the handler exactly as it was ...
//
// The handler body is not indented, not reordered and not otherwise touched, so a reviewer reads
// the same code and one extra line naming the route.

export type ActorKind = "human" | "agent" | "cron" | "anonymous" | "stripe";
export type ActivitySubjectKind = "policy" | "claim" | "broker" | "customer";
export type ActivityOutcome = "ok" | "refused" | "error";

// What the wrapper knows about a request while it runs. A handler may correct any of it: the MCP
// endpoint replaces the route with the tool it ran and the actor kind with the principal of the
// key, because "POST /api/mcp" is the same route for every agent and every tool, and grouping
// them together would hide exactly what an operator wants to see.
export type Activity = {
  correlationId: string;
  route: string;
  actorKind: ActorKind;
  actorUserId: string | null;
  actorRole: string | null;
  subjectKind: ActivitySubjectKind | null;
  subjectId: string | null;
  rule: ActivityRule | null;
  message: string | null;
  // The outcome when the handler knows it better than the classifier below can. The MCP endpoint
  // is the case this exists for: the protocol answers a REFUSED tool call with HTTP 200 and an
  // isError result, so the status code says "ok" about a call that was told no.
  outcome: ActivityOutcome | null;
};

export type ActivityDescriptor = {
  // The route PATTERN, not the URL: "/api/policies/[policyId]/endorsements". The latency panel
  // groups by this column, so a per-id string would make every row its own group.
  route: string;
  // Which object this route is about, when it is about one. The id is read from the path
  // parameter of the same name (policyId, claimId, brokerId, customerId) and is stored only when
  // it is a well-formed uuid, so a malformed URL cannot put junk in the column the 360 pages
  // read.
  subject?: ActivitySubjectKind;
  // THE RULE THIS ROUTE ENFORCES, named for the refusals the route answers itself: the redirect
  // it builds with ?error= and the 401 or 403 it returns. It is NOT applied to a request that
  // was refused before this route's gate was reached, which is the whole reason it can be
  // trusted: a missing session redirects to /login and reads "sign in", and a malformed path id
  // answers 400 and names no rule at all. Left out on a route with no gate of its own
  // (/api/health) and on the MCP endpoint, which names its rule per call.
  rule?: ActivityRule;
  // Who the caller is:
  //   'session'    (the default) a signed-in person, or nobody;
  //   'anonymous'  nobody, by construction: the login form has no actor before it succeeds, and
  //                the password it receives must never be read by this wrapper;
  //   'cron'       the Vercel cron job, unless a signed-in staff member pressed "Run now";
  //   'stripe'     the webhook endpoint, whose caller is a signature and not a user;
  //   'declared'   the handler sets it (the MCP endpoint, from the principal of its API key).
  actor?: "session" | "anonymous" | "cron" | "stripe" | "declared";
};

// The rules this application refuses by, in the words a person uses. A closed list rather than
// free text, so the console's Rule column can never hold two spellings of the same rule, and so
// a typo in a route's descriptor is a compile error.
//
// WHY A LIST OF NAMES AND NOT A LIST OF REFUSAL CLASSES (review finding F-OB-01). The first
// version mapped eleven refusal classes to rule names with `instanceof`, on the branch where a
// handler THROWS. No shipped route reaches that branch: every one of them catches its own
// refusal and answers with a redirect carrying ?error=, or with a status code. So the column
// read "none named" on every real refusal while eleven business modules were imported into all
// 34 serverless bundles for a code path nothing took. The names now come from the route, which
// is the only place that knows which gate it enforces.
export type ActivityRule =
  | "sign in"
  | "maker-checker"
  | "cron secret"
  | "MCP key"
  | "MCP tool scope"
  | "claim rules"
  | "ownership"
  | "policy draft"
  | "broker eligibility"
  | "broker verification"
  | "payment eligibility"
  | "endorsement"
  | "cancellation"
  | "correction"
  | "refund gate"
  | "statement run"
  | "change request"
  // Who may write a note saying what a reconciliation break is: staff operations only
  // (lib/reconciliation/break-notes.ts). The note repairs nothing, so this gate is about the
  // record, not about money.
  | "break note"
  | "webhook signature";

// The one refusal every route shares, and the one the route itself cannot name: there is no
// session, so the rule is the session rule and not the gate the route was about to apply. The
// wrapper recognises it by where the redirect goes, which is exact: /login is where this
// application sends a request it could not identify, and nowhere else.
const SIGN_IN_PATH = "/login";

// A caller may bring its own correlation id (a proxy, a reviewer's curl, a load test), which is
// how a trace crosses systems. It is untrusted text, so it is reduced to the characters an id is
// made of and cut to what the column accepts; anything else gets a fresh uuid.
const MOST_CHARACTERS_OF_A_CORRELATION_ID = 200;

export function correlationIdOf(request: Request): string {
  const presented = (request.headers.get("x-request-id") ?? "").trim();
  const usable = presented.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, MOST_CHARACTERS_OF_A_CORRELATION_ID);
  return usable.length >= 8 ? usable : randomUUID();
}

export function withActivity<C>(
  descriptor: ActivityDescriptor,
  handler: (request: Request, context: C, activity: Activity) => Promise<Response>,
): (request: Request, context: C) => Promise<Response> {
  return async (request: Request, context: C): Promise<Response> => {
    // The clock starts on the FIRST line of the wrapper and not around the handler (review
    // finding F-OB-05), so everything this slice adds before the answer is inside the figure the
    // latency panel shows: reading the correlation id, awaiting the path parameters, the handler
    // itself, and the session lookup below. Only the INSERT is outside, and deliberately: it
    // happens after the response is built and cannot change it, and a request whose row fails to
    // be written must still be timed.
    const startedAtMs = Date.now();
    const activity: Activity = {
      correlationId: correlationIdOf(request),
      route: descriptor.route,
      actorKind: descriptor.actor === "stripe" ? "stripe" : descriptor.actor === "cron" ? "cron" : "anonymous",
      actorUserId: null,
      actorRole: null,
      subjectKind: null,
      subjectId: null,
      rule: null,
      message: null,
      outcome: null,
    };
    await attachSubject(activity, descriptor, context);

    let response: Response | null = null;
    let thrown: unknown = null;
    // A separate flag, and not `thrown !== null`, because `throw null` and `throw ""` are legal
    // and would otherwise be read as "the handler answered".
    let handlerThrew = false;
    try {
      response = await handler(request, context, activity);
    } catch (error) {
      thrown = error;
      handlerThrew = true;
    }

    // The signed-in person is read AFTER the handler, so the extra lookup is never on the path
    // between a request and the work it asks for. It IS inside the measured duration, because it
    // is a cost this slice added. `cookies()` throws outside a request scope (a check script
    // calling a wrapped handler directly), and that is not a reason to lose the row: the actor
    // is simply unknown.
    if (descriptor.actor === undefined || descriptor.actor === "session" || descriptor.actor === "cron") {
      try {
        const user = await currentUser();
        if (user) {
          activity.actorKind = "human";
          activity.actorUserId = user.id;
          activity.actorRole = user.role;
        }
      } catch {
        // no session to read: the actor stays whatever the descriptor said.
      }
    }

    // Everything the request cost is now known. The insert below is outside the figure, because
    // it happens after the response is built.
    const durationMs = Date.now() - startedAtMs;

    // A value the handler set itself always wins: it knows more than the classifier does.
    const verdict = classify(response, thrown, handlerThrew, descriptor);
    await recordActivity({
      ...activity,
      rule: activity.rule ?? verdict.rule,
      message: activity.message ?? verdict.message,
      method: request.method,
      durationMs,
      outcome: activity.outcome ?? verdict.outcome,
      statusCode: verdict.statusCode,
    });

    if (handlerThrew) {
      throw thrown;
    }
    // Never null here: the only path that leaves `response` unset is the throw above.
    return response as Response;
  };
}

// ---------------------------------------------------------------------------
// How a request is classified
// ---------------------------------------------------------------------------

// The three outcomes, decided from what the handler did and never from what it meant to do:
//
//   a throw       -> 'error', HTTP 500, with the sanitised sentence. No shipped route lets a
//                    refusal escape: every one of them catches its own and answers. If one ever
//                    did escape, the caller would receive the framework's 500, and this row says
//                    what the caller received rather than what the code meant (finding F-OB-02);
//   a redirect    carrying ?error= in its location -> 'refused' with the sentence it carries.
//                 This is how nearly every screen of this application says no, so it is the
//                 branch that matters most;
//   a 4xx         -> 'refused' (the MCP 401, a malformed path id, a job with no cron secret);
//   a 5xx         -> 'error';
//   anything else -> 'ok'.
//
// THE RULE A REFUSAL NAMED (review finding F-OB-01) comes from the route's descriptor, on the
// three shapes that mean "this route's own gate said no", and from nowhere else:
//
//   a redirect carrying ?error=   the route's gate, unless it goes to /login, which is the
//                                 session rule whatever the route was about to do;
//   403                           the route's gate: identified, and not allowed;
//   401                           NOT identified, so the rule is "sign in" and not the route's
//                                 gate. The exception is a cron endpoint, where the identity
//                                 that failed IS the cron secret, which is the route's gate.
//
// Anything else names no rule: a 400 (a malformed path id, an unparseable body, a date that is
// not a date) is refused before the route reaches its gate, and calling that "endorsement" or
// "claim rules" would be a false statement in a record that can never be corrected.
//
// The response BODY is never read: a body can be a PDF, and reading it would consume the stream
// the caller is waiting for.
type Verdict = { outcome: ActivityOutcome; statusCode: number; rule: ActivityRule | null; message: string | null };

export function classify(
  response: Response | null,
  thrown: unknown,
  handlerThrew: boolean,
  descriptor: ActivityDescriptor,
): Verdict {
  if (handlerThrew) {
    return { outcome: "error", statusCode: 500, rule: null, message: sanitisedSentence(thrown) };
  }
  // The status the caller actually received, never a status this function decided (F-OB-02).
  const status = response?.status ?? 500;
  const location = response?.headers.get("location") ?? "";
  const routeRule = descriptor.rule ?? null;

  if (status >= 300 && status < 400) {
    const refusalInRedirect = errorInLocation(location);
    if (refusalInRedirect) {
      const rule = location.startsWith(SIGN_IN_PATH) ? "sign in" : routeRule;
      return { outcome: "refused", statusCode: status, rule, message: refusalInRedirect };
    }
  }
  if (status === 401) {
    const rule = descriptor.actor === "cron" ? routeRule : "sign in";
    return { outcome: "refused", statusCode: status, rule, message: null };
  }
  if (status === 403) {
    return { outcome: "refused", statusCode: status, rule: routeRule, message: null };
  }
  if (status >= 400 && status < 500) return { outcome: "refused", statusCode: status, rule: null, message: null };
  if (status >= 500) return { outcome: "error", statusCode: status, rule: null, message: null };
  return { outcome: "ok", statusCode: status, rule: null, message: null };
}

// The sentence a screen puts in its own redirect: /policies/{id}?error=only+staff+may+bind.
// Read from the location header, decoded by URL, and redacted like every other sentence.
function errorInLocation(location: string): string | null {
  if (!location.includes("error=")) return null;
  try {
    const reason = new URL(location, "http://relative.invalid").searchParams.get("error");
    return reason ? redact(reason) : null;
  } catch {
    return null;
  }
}

// The object a route is about, read from the path parameter of the same name. Awaiting
// `context.params` a second time is free: it is the promise the handler awaits too.
async function attachSubject<C>(activity: Activity, descriptor: ActivityDescriptor, context: C): Promise<void> {
  if (!descriptor.subject) return;
  const parameters = await pathParameters(context);
  const candidate = parameters[`${descriptor.subject}Id`];
  if (typeof candidate === "string" && isUuid(candidate)) {
    activity.subjectKind = descriptor.subject;
    activity.subjectId = candidate;
  }
}

async function pathParameters<C>(context: C): Promise<Record<string, string | string[] | undefined>> {
  if (!context || typeof context !== "object" || !("params" in context)) return {};
  try {
    return (await (context as { params: Promise<Record<string, string | string[] | undefined>> }).params) ?? {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Writing it down
// ---------------------------------------------------------------------------

export type ActivityRecord = Omit<Activity, "outcome"> & {
  method: string;
  durationMs: number;
  outcome: ActivityOutcome;
  statusCode: number;
};

// The JSON line first, then the row. In that order on purpose: the line is what survives when
// the database is the thing that is broken, which is precisely the moment an operator is reading
// logs. Exported so scripts/check-console.ts can prove both halves against a real database.
export async function recordActivity(entry: ActivityRecord): Promise<void> {
  const message = entry.message === null ? null : redact(entry.message);
  const rule = entry.rule === null ? null : redact(entry.rule).slice(0, 100);

  console.log(
    JSON.stringify({
      recordedAt: new Date().toISOString(),
      correlationId: entry.correlationId,
      actorUserId: entry.actorUserId,
      actorRole: entry.actorRole,
      actorKind: entry.actorKind,
      route: entry.route,
      method: entry.method,
      subjectKind: entry.subjectKind,
      subjectId: entry.subjectId,
      durationMs: entry.durationMs,
      outcome: entry.outcome,
      rule,
      message,
      statusCode: entry.statusCode,
    }),
  );

  try {
    await sql`
      insert into activity_log (
        correlation_id, actor_user_id, actor_role, actor_kind, route, method,
        subject_kind, subject_id, duration_ms, outcome, rule, message, status_code
      ) values (
        ${entry.correlationId}, ${entry.actorUserId}, ${entry.actorRole}, ${entry.actorKind},
        ${entry.route.slice(0, 200)}, ${entry.method.slice(0, 10)},
        ${entry.subjectKind}, ${entry.subjectId}, ${entry.durationMs}, ${entry.outcome},
        ${rule}, ${message}, ${entry.statusCode}
      )
    `;
  } catch (error) {
    // BEST EFFORT, AND SAID OUT LOUD. The request keeps its answer; the JSON line above already
    // holds everything the row would have held, so nothing is lost silently. This second line
    // exists so a missing row is a fact an operator can grep for rather than a hole.
    console.error(
      JSON.stringify({
        activityRowNotWritten: true,
        correlationId: entry.correlationId,
        route: entry.route,
        reason: sanitisedSentence(error),
      }),
    );
  }
}
