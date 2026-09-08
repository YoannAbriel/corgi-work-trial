import { currentUser } from "@/lib/auth/current-user";
import { badPathIdResponse } from "@/lib/http/path-ids";
import { approveCorrectionCollection, CorrectionCheckoutRefused } from "@/lib/payments/correction-collection";

// POST /api/policies/{policyId}/corrections/{rebookEventId}/approve
//
// The customer accepts to pay the difference a correction created, when it is above $500. The
// customer id comes from the session and is compared with the policy's; the broker, staff and an
// agent are all refused. The approval is written as its own policy event, so it is part of the
// policy's history like everything else.
export async function POST(request: Request, context: { params: Promise<{ policyId: string; rebookEventId: string }> }) {
  const { policyId, rebookEventId } = await context.params;
  // A path id that is not a uuid is a malformed request, not a missing row (review finding
  // F-B8-03): 400 before anything reaches a query that would cast it and raise.
  const badPathId = badPathIdResponse({ policyId, rebookEventId });
  if (badPathId) {
    return badPathId;
  }
  const user = await currentUser();
  if (!user) {
    return redirectTo("/login?error=Please+sign+in+again");
  }

  try {
    const result = await approveCorrectionCollection({
      policyId,
      rebookEventId,
      actor: { userId: user.id, role: user.role, customerId: user.customerId },
    });
    return redirectTo(`/customer?correctionApproved=${result.alreadyApproved ? "already" : "1"}`);
  } catch (error) {
    if (error instanceof CorrectionCheckoutRefused) {
      return redirectTo(`/customer?error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }
}

function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
