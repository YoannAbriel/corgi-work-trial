import { currentUser } from "@/lib/auth/current-user";
import { badPathIdResponse } from "@/lib/http/path-ids";
import { CheckoutRefused, startCheckout } from "@/lib/payments/checkout";
import { withActivity } from "@/lib/observability/log";

// POST /api/policies/{policyId}/checkout, called by the "Pay with Stripe" button.
// Authorisation and eligibility are checked here and again inside startCheckout: a direct
// call to this URL goes through exactly the same gates as the button.
export const POST = withActivity({ route: "/api/policies/[policyId]/checkout", subject: "policy" }, handlePost);

async function handlePost(request: Request, context: { params: Promise<{ policyId: string }> }) {
  const user = await currentUser();
  if (!user) {
    return redirectTo("/login?error=Please+sign+in+again");
  }
  const { policyId } = await context.params;
  const malformedId = badPathIdResponse({ policy: policyId });
  if (malformedId) {
    return malformedId;
  }

  if (user.role !== "broker" || !user.brokerId) {
    return redirectTo(`/policies/${policyId}?error=${encodeURIComponent("Only the owning broker can pay a policy")}`);
  }

  try {
    const checkoutUrl = await startCheckout({ policyId, brokerId: user.brokerId, userId: user.id });
    return redirectTo(checkoutUrl);
  } catch (error) {
    if (error instanceof CheckoutRefused) {
      // A refusal the broker can act on: wrong owner, already bound, KYB not approved, or a
      // provider error that was recorded on the operation.
      return redirectTo(`/policies/${policyId}?error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }
}

function redirectTo(url: string): Response {
  return new Response(null, { status: 303, headers: { location: url } });
}
