import { currentUser } from "@/lib/auth/current-user";
import { badPathIdResponse } from "@/lib/http/path-ids";
import { retryBindingAfterEligibility } from "@/lib/payments/collection";
import { withActivity } from "@/lib/observability/log";

// POST /api/policies/{policyId}/bind
//
// The staff action offered when a customer paid but the policy was NOT bound because the
// broker was not eligible at that moment. The money is already recorded on the operation and
// nothing was journaled; this re-runs the same posting transaction a first delivery would have
// run, once the broker is verified.
//
// Restricted to staff operations, and the eligibility question is asked again inside
// retryBindingAfterEligibility, so calling this URL directly goes through the same gate as the
// button.
export const POST = withActivity({ route: "/api/policies/[policyId]/bind", rule: "broker eligibility", subject: "policy" }, handlePost);

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
  if (user.role !== "staff_ops") {
    return backToPolicy(policyId, "only staff operations can bind a policy after a refused binding");
  }

  const outcome = await retryBindingAfterEligibility({ policyId, actorUserId: user.id });
  switch (outcome.kind) {
    case "posted":
      return redirectTo(`/policies/${policyId}?bound=1`);
    case "already_posted":
      return redirectTo(`/policies/${policyId}?bound=already`);
    default:
      return backToPolicy(policyId, outcome.reason);
  }
}

function backToPolicy(policyId: string, message: string): Response {
  return redirectTo(`/policies/${policyId}?error=${encodeURIComponent(message)}`);
}

function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
