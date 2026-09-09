import { currentUser } from "@/lib/auth/current-user";
import { badPathIdResponse } from "@/lib/http/path-ids";
import { ChangeRequestRefused, replyToChangeRequest, workspaceHomeOf } from "@/lib/policy/change-requests";

// POST /api/policies/{policyId}/change-requests/{requestId}/reply
//
// The owning broker (or staff operations) answers one change request: 'answered' or 'done', and
// the words the customer reads. A request is answered once, and that is a unique constraint in
// the database (migration 0019), not a check this route makes.
export async function POST(request: Request, context: { params: Promise<{ policyId: string; requestId: string }> }) {
  const user = await currentUser();
  const { policyId, requestId } = await context.params;
  const malformedId = badPathIdResponse({ policy: policyId, request: requestId }); // 400, not 500 (F-B7-07)
  if (malformedId) {
    return malformedId;
  }
  if (!user) {
    return redirectTo("/login?error=Please+sign+in+again");
  }

  const form = await request.formData();
  const outcome = String(form.get("outcome") ?? "");
  const text = String(form.get("text") ?? "");

  try {
    await replyToChangeRequest({
      policyId,
      requestId,
      outcome,
      text,
      actor: { userId: user.id, role: user.role, brokerId: user.brokerId, customerId: user.customerId },
    });
    // Back to the policy page, at the panel: the answer the broker just wrote is now under the
    // request it answers, which is the confirmation. A refusal comes back as ?error, which the
    // policy page already prints in its notices.
    return redirectTo(`/policies/${policyId}?changeRequest=answered#customer-requests`);
  } catch (error) {
    if (error instanceof ChangeRequestRefused) {
      // A refusal goes to a page this person may actually open: a broker who does not write this
      // policy is redirected away from it, and the message would go with the redirect (F-B13-02).
      if (error.readableFrom === "home") {
        return redirectTo(`${workspaceHomeOf(user.role)}?error=${encodeURIComponent(error.message)}`);
      }
      return redirectTo(`/policies/${policyId}?error=${encodeURIComponent(error.message)}#customer-requests`);
    }
    throw error;
  }
}

function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
