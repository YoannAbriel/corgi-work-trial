import { currentUser } from "@/lib/auth/current-user";
import { decideApprovalRequest, ApprovalRefused } from "@/lib/approvals/approvals";

// POST /api/approvals/{requestId}: a checker approves or rejects one money-out request.
//
// THIS ROUTE ACCEPTS THE SESSION COOKIE AND NOTHING ELSE. `currentUser()` reads the signed
// `corgi_session` cookie and looks the user up in the database; it does not look at an
// Authorization header, an API key or any field of the form. There is deliberately no other way
// in: when slice B11 adds MCP API keys, its principals will be users with the role 'agent', they
// will never hold a session cookie, and even if one were forged the database trigger on
// approval_decisions demands the role 'staff_approver' (migration 0008).
//
// The three refusals an approver can meet are all sentences on the approvals screen:
// wrong role, own request, already decided.
export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const user = await currentUser();
  const { requestId } = await context.params;
  if (!user) {
    return redirectTo("/login?error=Please+sign+in+again");
  }

  const form = await request.formData();
  const decision = String(form.get("decision") ?? "");
  if (decision !== "approved" && decision !== "rejected") {
    return backToApprovals(`unknown decision "${decision}"`);
  }
  const reason = String(form.get("reason") ?? "").trim();

  try {
    await decideApprovalRequest({
      requestId,
      decidedByUserId: user.id,
      // The role comes from the session, never from the form.
      decidedByRole: user.role,
      decision,
      reason: reason.length > 0 ? reason : null,
    });
    return redirectTo(`/ops/approvals?decided=${decision}`);
  } catch (error) {
    if (error instanceof ApprovalRefused) {
      return backToApprovals(error.message);
    }
    throw error;
  }
}

function backToApprovals(message: string): Response {
  return redirectTo(`/ops/approvals?error=${encodeURIComponent(message)}`);
}

function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
