import { randomUUID } from "node:crypto";
import { sql } from "@/db/client";
import { ApprovalRefused } from "@/lib/approvals/approvals";
import { currentUser } from "@/lib/auth/current-user";
import { ClaimRefused } from "@/lib/claims/claims";
import { isUuid } from "@/lib/http/path-ids";
import { JobNotAuthorised } from "@/lib/jobs/authorize";
import { KeyRefused } from "@/lib/mcp/keys";
import { ToolRefused } from "@/lib/mcp/tools/tool";
import { EndorsementNotComputable } from "@/lib/money/endorsement";
import { RefundCannotBeAllocated } from "@/lib/money/refund-allocation";
import { ChangeRequestRefused } from "@/lib/policy/change-requests";
import { PolicyDraftRefused } from "@/lib/policy/issue";
import { BankAccountRejected } from "@/lib/rails/bank-verification-simulator";
import { WindowRefused } from "@/lib/reconciliation/window";
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
  rule: string | null;
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
  // Who the caller is:
  //   'session'    (the default) a signed-in person, or nobody;
  //   'anonymous'  nobody, by construction: the login form has no actor before it succeeds, and
  //                the password it receives must never be read by this wrapper;
  //   'cron'       the Vercel cron job, unless a signed-in staff member pressed "Run now";
  //   'stripe'     the webhook endpoint, whose caller is a signature and not a user;
  //   'declared'   the handler sets it (the MCP endpoint, from the principal of its API key).
  actor?: "session" | "anonymous" | "cron" | "stripe" | "declared";
};

// The refusal classes this file recognises, each with the name of the rule it enforces.
//
// WHY `instanceof` AND NOT THE CLASS NAME. Reading `thrown.constructor.name` would have needed
// no imports at all, and it does not work: the production server bundle mangles class names
// (`class a extends Error` in .next/server/chunks after `npm run build`), so the test would pass
// in development and in the check scripts and silently fail on the deployed application, which
// is the worst possible behaviour for a diagnostic. `instanceof` compares prototypes and is
// unaffected by the renaming.
//
// WHY THIS LIST AND NOT ALL TWENTY-TWO. Every route file of the application imports this module,
// so anything imported here is bundled into every serverless function, /api/health included.
// The refusals below cost nothing to import: their modules pull the database client, the money
// helpers and nothing else. The ones deliberately left out (CheckoutRefused, RefundSendRefused,
// EndorsementRefused, CancellationRefused, CorrectionRefused and the payment gates) live in
// modules that import the Stripe SDK, and every one of them is CAUGHT by its own handler and
// answered as a redirect carrying ?error=, which the response branch below already classifies as
// a refusal. Their loss is the rule name on a row that would say "refused" either way.
const RULE_OF_REFUSAL: { refusal: abstract new (...args: never[]) => Error; rule: string }[] = [
  { refusal: ApprovalRefused, rule: "maker-checker" },
  { refusal: ClaimRefused, rule: "claim rules" },
  { refusal: KeyRefused, rule: "MCP key" },
  { refusal: ToolRefused, rule: "MCP tool scope" },
  { refusal: JobNotAuthorised, rule: "cron secret" },
  { refusal: WindowRefused, rule: "reconciliation window" },
  { refusal: PolicyDraftRefused, rule: "policy draft" },
  { refusal: ChangeRequestRefused, rule: "change request" },
  { refusal: BankAccountRejected, rule: "bank account check" },
  { refusal: RefundCannotBeAllocated, rule: "refund allocation" },
  { refusal: EndorsementNotComputable, rule: "endorsement pricing" },
];

function refusalRuleOf(thrown: unknown): string | null {
  if (!(thrown instanceof Error)) return null;
  return RULE_OF_REFUSAL.find((known) => thrown instanceof known.refusal)?.rule ?? null;
}

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

    const startedAtMs = Date.now();
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
    const durationMs = Date.now() - startedAtMs;

    // The signed-in person is read AFTER the handler, so the extra lookup is never on the path
    // between a request and the work it asks for. `cookies()` throws outside a request scope
    // (a check script calling a wrapped handler directly), and that is not a reason to lose the
    // row: the actor is simply unknown.
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

    // A value the handler set itself always wins: it knows more than the classifier does.
    const verdict = classify(response, thrown, handlerThrew);
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
//   a throw       a refusal class -> 'refused' with its rule; anything else -> 'error';
//   a redirect    carrying ?error= in its location -> 'refused' with the sentence it carries.
//                 This is how nearly every screen of this application says no, so it is the
//                 branch that matters most;
//   a 4xx         -> 'refused' (the MCP 401, a malformed path id, a job with no cron secret);
//   a 5xx         -> 'error';
//   anything else -> 'ok'.
//
// The response BODY is never read: a body can be a PDF, and reading it would consume the stream
// the caller is waiting for.
type Verdict = { outcome: ActivityOutcome; statusCode: number; rule: string | null; message: string | null };

export function classify(response: Response | null, thrown: unknown, handlerThrew: boolean): Verdict {
  if (handlerThrew) {
    const rule = refusalRuleOf(thrown);
    // A thrown error that is not a refusal ends as a 500: that is what the framework answers.
    return {
      outcome: rule ? "refused" : "error",
      statusCode: rule ? 400 : 500,
      rule,
      message: sanitisedSentence(thrown),
    };
  }
  const status = response?.status ?? 500;
  const refusalInRedirect = status >= 300 && status < 400 ? errorInLocation(response) : null;
  if (refusalInRedirect) {
    return { outcome: "refused", statusCode: status, rule: null, message: refusalInRedirect };
  }
  if (status >= 400 && status < 500) return { outcome: "refused", statusCode: status, rule: null, message: null };
  if (status >= 500) return { outcome: "error", statusCode: status, rule: null, message: null };
  return { outcome: "ok", statusCode: status, rule: null, message: null };
}

// The sentence a screen puts in its own redirect: /policies/{id}?error=only+staff+may+bind.
// Read from the location header, decoded by URL, and redacted like every other sentence.
function errorInLocation(response: Response | null): string | null {
  const location = response?.headers.get("location");
  if (!location || !location.includes("error=")) return null;
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
