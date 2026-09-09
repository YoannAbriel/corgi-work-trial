import { currentUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/http/path-ids";
import { runStatement, StatementRunRefused } from "@/lib/statements/run";
import { withActivity } from "@/lib/observability/log";

// POST /api/statements/run, called by the two forms on /ops/statements and /statements/{runId}.
//
// Staff operations and staff approvers only. A broker never runs a statement: they read the ones
// operations produced, which is what keeps a broker from choosing the cutoff of their own
// commission statement.
//
// The route moves no money at all. It reads the journal and appends one run and its lines, so the
// worst a repeated submission can do is store another revision, which is exactly what the model
// says a re-run is: an event, not an edit.
export const POST = withActivity({ route: "/api/statements/run", rule: "statement run" }, handlePost);

async function handlePost(request: Request) {
  const user = await currentUser();
  if (!user) {
    return redirectTo("/login?error=Please+sign+in+again");
  }
  if (user.role !== "staff_ops" && user.role !== "staff_approver") {
    return backToList("only staff can run a broker statement: operations or an approver");
  }

  const form = await request.formData();
  const brokerId = String(form.get("brokerId") ?? "").trim();
  const month = String(form.get("month") ?? "").trim();
  const cutoffText = String(form.get("knowledgeCutoff") ?? "").trim();
  if (!brokerId || !month) {
    return backToList("pick a broker and a month first");
  }
  // The broker id comes from a form field, so it is text until it is checked. Without this it
  // reached a uuid column and answered 500 instead of refusing like every other bad input
  // (review finding F-B9-04); it is the same guard the path ids already use.
  if (!isUuid(brokerId)) {
    return backToList("that broker identifier is not a valid identifier; pick a broker from the list");
  }

  // An empty cutoff means "everything the ledger knows now", which is what a monthly close does.
  let knowledgeCutoff: Date | undefined;
  if (cutoffText.length > 0) {
    const parsed = new Date(cutoffText);
    if (Number.isNaN(parsed.getTime())) {
      return backToList(`"${cutoffText}" is not an instant; write it as 2028-04-01T00:00:00Z`);
    }
    knowledgeCutoff = parsed;
  }

  try {
    const run = await runStatement({ brokerId, statementMonth: month, knowledgeCutoff, actorUserId: user.id });
    return redirectTo(`/statements/${run.runId}`);
  } catch (error) {
    if (error instanceof StatementRunRefused) {
      // A refusal the person can act on: unknown broker, a month written wrong, a cutoff in the
      // future, or another run that committed at the same instant.
      return backToList(error.message);
    }
    if (error instanceof Error && error.message.includes("statement month")) {
      return backToList(error.message);
    }
    // Anything else is a real failure and must surface as a 500 in the logs rather than look like
    // a rejected form.
    throw error;
  }
}

function backToList(message: string): Response {
  return redirectTo(`/ops/statements?error=${encodeURIComponent(message)}`);
}

// 303 turns the POST into a GET, so refreshing the next page does not run the statement again.
function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
