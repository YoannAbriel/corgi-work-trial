import { currentUser } from "@/lib/auth/current-user";
import { workspaceHomeOf } from "@/lib/policy/change-requests";
import { BreakNoteRefused, explainBreak } from "@/lib/reconciliation/break-notes";
import { withActivity } from "@/lib/observability/log";

// POST /api/reconciliation/breaks/{breakKey}/explain
//
// A staff operations user writes what a break is. The note is appended (migration 0022) and the
// break leaves the list of breaks to act on and the inbox; it stays on the board under "Explained
// breaks" with the note. NOTHING HERE REPAIRS MONEY: no journal entry, no provider call, no
// reconciliation row edited or deleted. The rule and the reasons are in
// lib/reconciliation/break-notes.ts.
//
// The break key is a path parameter because it is the identity of the thing being explained; it
// carries a `|` and a `:`, so the form encodes it and Next.js hands it back decoded.
export const POST = withActivity(
  { route: "/api/reconciliation/breaks/[breakKey]/explain", rule: "break note" },
  handlePost,
);

async function handlePost(request: Request, context: { params: Promise<{ breakKey: string }> }) {
  const user = await currentUser();
  if (!user) {
    return redirectTo("/login?error=Please+sign+in+again");
  }
  const { breakKey } = await context.params;
  const form = await request.formData();
  const note = String(form.get("note") ?? "");

  // Where a refusal can actually be read. A person who may not open /ops/reconciliation is
  // redirected away from it, and the message would go with the redirect (review finding F-B13-02),
  // so their own workspace home is the page that will print it.
  const canReadTheBoard = user.role === "staff_ops" || user.role === "staff_approver";
  const board = "/ops/reconciliation";

  try {
    await explainBreak({ breakKey, note, actor: { userId: user.id, role: user.role } });
    return redirectTo(`${board}?explained=${encodeURIComponent(breakKey)}#break-${breakKey}`);
  } catch (error) {
    if (error instanceof BreakNoteRefused) {
      const destination = canReadTheBoard ? board : workspaceHomeOf(user.role);
      return redirectTo(`${destination}?error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }
}

function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
