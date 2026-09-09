import { currentUser } from "@/lib/auth/current-user";
import { badPathIdResponse } from "@/lib/http/path-ids";
import { ChangeRequestRefused, createChangeRequest, workspaceHomeOf } from "@/lib/policy/change-requests";
import { withActivity } from "@/lib/observability/log";

// POST /api/policies/{policyId}/change-requests
//
// The customer asks their broker for a change on their own policy: the lines it is about and a
// comment. Nothing is priced and nothing moves; the request is a message stored append-only
// (migration 0019). Only the policy's customer, read from the session, can send one; the broker,
// staff and any agent are refused by createChangeRequest.
export const POST = withActivity({ route: "/api/policies/[policyId]/change-requests", rule: "change request", subject: "policy" }, handlePost);

async function handlePost(request: Request, context: { params: Promise<{ policyId: string }> }) {
  const user = await currentUser();
  const { policyId } = await context.params;
  const malformedId = badPathIdResponse({ policy: policyId }); // a malformed id answers 400, not 500 (F-B7-07)
  if (malformedId) {
    return malformedId;
  }
  if (!user) {
    return redirectTo("/login?error=Please+sign+in+again");
  }

  const form = await request.formData();
  // One checkbox per line, all named "lines": getAll returns every ticked one.
  const lines = form.getAll("lines").map((value) => String(value));
  const comment = String(form.get("comment") ?? "");

  try {
    await createChangeRequest({
      policyId,
      lines,
      comment,
      actor: { userId: user.id, role: user.role, brokerId: user.brokerId, customerId: user.customerId },
    });
    return redirectTo(`/policies/${policyId}?changeRequest=sent`);
  } catch (error) {
    if (error instanceof ChangeRequestRefused) {
      // A refusal goes to a page this person may actually open. Sending an ownership refusal back
      // to the policy page would lose it: that page redirects a customer who does not own the
      // policy to /customer, and the message would go with the redirect (F-B13-02).
      const destination = error.readableFrom === "policy" ? `/policies/${policyId}` : workspaceHomeOf(user.role);
      return redirectTo(`${destination}?error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }
}

function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
