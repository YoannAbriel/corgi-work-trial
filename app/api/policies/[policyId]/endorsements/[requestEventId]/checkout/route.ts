import { currentUser } from "@/lib/auth/current-user";
import { isViolationOf } from "@/lib/ledger/post";
import { EndorsementCheckoutRefused, startEndorsementCheckout } from "@/lib/payments/endorsement-collection";
import { badPathIdResponse } from "@/lib/http/path-ids";
import { withActivity } from "@/lib/observability/log";

// POST /api/policies/{policyId}/endorsements/{requestEventId}/checkout, the "Pay the delta"
// button. Authorisation, eligibility, the customer's approval and the quote hash are all
// checked inside startEndorsementCheckout: a direct call to this URL goes through exactly the
// same gates as the button.
export const POST = withActivity({ route: "/api/policies/[policyId]/endorsements/[requestEventId]/checkout", rule: "endorsement", subject: "policy" }, handlePost);

async function handlePost(request: Request, context: { params: Promise<{ policyId: string; requestEventId: string }> }) {
  const user = await currentUser();
  const { policyId, requestEventId } = await context.params;
  const malformedId = badPathIdResponse({ policy: policyId, request: requestEventId }); // a malformed id answers 400, not 500 (F-B7-07)
  if (malformedId) {
    return malformedId;
  }
  if (!user) {
    return redirectTo("/login?error=Please+sign+in+again");
  }
  if (user.role !== "broker" || !user.brokerId) {
    return backToPolicy(policyId, "only the owning broker can pay an endorsement delta");
  }

  const form = await request.formData();
  const quoteHash = String(form.get("quoteHash") ?? "").trim();
  if (!/^[0-9a-f]{64}$/.test(quoteHash)) {
    return backToPolicy(policyId, "the payment form is incomplete; reload the policy page");
  }

  try {
    const checkoutUrl = await startEndorsementCheckout({ policyId, requestEventId, quoteHash, brokerId: user.brokerId, userId: user.id });
    return redirectTo(checkoutUrl);
  } catch (error) {
    if (error instanceof EndorsementCheckoutRefused) {
      return backToPolicy(policyId, error.message);
    }
    // Two Pay clicks at the same instant: the loser hits the unique index on
    // money_operations.idempotency_key, which is the guard doing its job (one operation per
    // attempt, never two). It used to reach the browser as HTTP 500 (review finding F-B4-10).
    //
    // THAT INDEX AND NO OTHER (review finding F-B13-10): the sentence below tells the broker
    // nothing was charged twice, which is only true of this constraint. Any other unique
    // violation raised under startEndorsementCheckout stays a failure.
    if (isViolationOf(error, "money_operations_idempotency_key_key")) {
      return backToPolicy(
        policyId,
        "this payment was already started a moment ago, so nothing was charged twice; reload the policy and open the payment page again",
      );
    }
    throw error;
  }
}

function backToPolicy(policyId: string, message: string): Response {
  return redirectTo(`/policies/${policyId}?error=${encodeURIComponent(message)}`);
}

function redirectTo(url: string): Response {
  return new Response(null, { status: 303, headers: { location: url } });
}
