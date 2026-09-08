import { currentUser } from "@/lib/auth/current-user";
import { retryEndorsementApplication } from "@/lib/payments/endorsement-collection";

// POST /api/policies/{policyId}/endorsements/{requestEventId}/apply
//
// The staff action offered when the delta was paid but the endorsement was NOT applied because
// the broker was not eligible at that moment. The money is already recorded on the operation
// and nothing was journaled; this re-runs the same posting transaction a first delivery would
// have run, once the broker is verified. Staff operations only, and the eligibility question is
// asked again inside retryEndorsementApplication.
export async function POST(request: Request, context: { params: Promise<{ policyId: string; requestEventId: string }> }) {
  const user = await currentUser();
  const { policyId, requestEventId } = await context.params;
  if (!user) {
    return redirectTo("/login?error=Please+sign+in+again");
  }
  if (user.role !== "staff_ops") {
    return backToPolicy(policyId, "only staff operations can apply an endorsement after a refused application");
  }

  const outcome = await retryEndorsementApplication({ policyId, requestEventId, actorUserId: user.id });
  switch (outcome.kind) {
    case "posted":
      return redirectTo(`/policies/${policyId}?endorsement=applied`);
    case "already_posted":
      return redirectTo(`/policies/${policyId}?endorsement=already-applied`);
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
