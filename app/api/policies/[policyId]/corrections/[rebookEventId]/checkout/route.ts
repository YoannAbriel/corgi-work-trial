import { currentUser } from "@/lib/auth/current-user";
import { badPathIdResponse } from "@/lib/http/path-ids";
import { CorrectionCheckoutRefused, startCorrectionCheckout } from "@/lib/payments/correction-collection";
import { withActivity } from "@/lib/observability/log";

// POST /api/policies/{policyId}/corrections/{rebookEventId}/checkout
//
// Opens the hosted Stripe page for the difference a correction created. The money operation was
// written and committed by the correction itself (the outbox rule), so this route only asks
// Stripe for the page and stores its URL. Every gate is re-checked on the server: who is asking,
// whether the policy is still in force, and whether the customer has approved a difference above
// $500. The endorsement is already in force at the corrected date whether or not this is paid;
// what is outstanding is the receivable, visible on the reconciliation screen.
export const POST = withActivity({ route: "/api/policies/[policyId]/corrections/[rebookEventId]/checkout", rule: "correction", subject: "policy" }, handlePost);

async function handlePost(request: Request, context: { params: Promise<{ policyId: string; rebookEventId: string }> }) {
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
    const checkoutUrl = await startCorrectionCheckout({
      policyId,
      rebookEventId,
      actor: { userId: user.id, role: user.role, brokerId: user.brokerId },
    });
    return redirectTo(checkoutUrl);
  } catch (error) {
    if (error instanceof CorrectionCheckoutRefused) {
      return backToPolicy(policyId, error.message);
    }
    throw error;
  }
}

function backToPolicy(policyId: string, message: string): Response {
  return redirectTo(`/policies/${policyId}?error=${encodeURIComponent(message)}`);
}

function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
