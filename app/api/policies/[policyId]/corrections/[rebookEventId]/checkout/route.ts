import { currentUser } from "@/lib/auth/current-user";
import { CorrectionCheckoutRefused, startCorrectionCheckout } from "@/lib/payments/correction-collection";

// POST /api/policies/{policyId}/corrections/{rebookEventId}/checkout
//
// Opens the hosted Stripe page for the difference a correction created. The money operation was
// written and committed by the correction itself (the outbox rule), so this route only asks
// Stripe for the page and stores its URL. Every gate is re-checked on the server: who is asking,
// whether the policy is still in force, and whether the customer has approved a difference above
// $500. The endorsement is already in force at the corrected date whether or not this is paid;
// what is outstanding is the receivable, visible on the reconciliation screen.
export async function POST(request: Request, context: { params: Promise<{ policyId: string; rebookEventId: string }> }) {
  const user = await currentUser();
  const { policyId, rebookEventId } = await context.params;
  if (!user) {
    return redirectTo("/login?error=Please+sign+in+again");
  }
  if (!UUID.test(rebookEventId)) {
    return backToPolicy(policyId, "that is not a correction of this policy");
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function backToPolicy(policyId: string, message: string): Response {
  return redirectTo(`/policies/${policyId}?error=${encodeURIComponent(message)}`);
}

function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
