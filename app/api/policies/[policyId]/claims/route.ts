import { currentUser } from "@/lib/auth/current-user";
import { openClaim, todayUtc, ClaimRefused } from "@/lib/claims/claims";
import { badPathIdResponse } from "@/lib/http/path-ids";
import { withActivity } from "@/lib/observability/log";

// POST /api/policies/{policyId}/claims: staff operations open a claim on a policy.
//
// Every check is on the server: who is signed in, whether the policy was ever bound, and
// whether the loss falls inside the period the policy actually covered (which is shorter than
// the term when the policy was cancelled). Calling this URL directly changes nothing.
export const POST = withActivity({ route: "/api/policies/[policyId]/claims", rule: "claim rules", subject: "policy" }, handlePost);

async function handlePost(request: Request, context: { params: Promise<{ policyId: string }> }) {
  const user = await currentUser();
  const { policyId } = await context.params;
  if (!user) {
    return redirectTo("/login?error=Please+sign+in+again");
  }
  const malformedId = badPathIdResponse({ policy: policyId });
  if (malformedId) {
    return malformedId;
  }

  const form = await request.formData();
  try {
    const claim = await openClaim({
      policyId,
      occurredAt: String(form.get("occurredAt") ?? "").trim(),
      reportedAt: String(form.get("reportedAt") ?? "").trim(),
      // The day the claim is opened comes from the server clock, never from the form: it is what
      // makes "a loss cannot be dated in the future" true (review finding F-B7-06).
      openedOn: todayUtc(),
      description: String(form.get("description") ?? ""),
      claimantName: String(form.get("claimantName") ?? ""),
      actor: { userId: user.id, role: user.role },
    });
    return redirectTo(`/ops/claims/${claim.claimId}?opened=1`);
  } catch (error) {
    if (error instanceof ClaimRefused) {
      return redirectTo(`/policies/${policyId}?error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }
}

// 303 turns the POST into a GET, so refreshing the next page does not resubmit the form.
function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
