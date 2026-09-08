import { currentUser } from "@/lib/auth/current-user";
import { badPathIdResponse } from "@/lib/http/path-ids";
import { reissueRefund, RefundReissueRefused, RefundSendRefused } from "@/lib/payments/refunds";

// POST /api/policies/{policyId}/refunds/{operationId}/reissue
//
// The staff action offered when a refund FAILED at the customer's bank, or was REJECTED by the
// approver. The money never left, the customer is still owed it, and refund_payable is still
// open in the ledger, so this creates a NEW refund operation with a new idempotency key. Above
// the threshold the new attempt carries a new approval request and goes back to the queue;
// below it, Stripe is asked again. It posts no journal entry: the liability was opened once
// and is cleared once, by whichever attempt finally completes.
//
// Restricted to staff operations: re-sending money is an operations decision, and a broker
// should not be able to trigger a second payout attempt from the policy page.
export async function POST(
  request: Request,
  context: { params: Promise<{ policyId: string; operationId: string }> },
) {
  const user = await currentUser();
  const { policyId, operationId } = await context.params;
  if (!user) {
    return redirectTo("/login?error=Please+sign+in+again");
  }
  const malformedId = badPathIdResponse({ policy: policyId, refund: operationId });
  if (malformedId) {
    return malformedId;
  }
  if (user.role !== "staff_ops") {
    return backToPolicy(policyId, "only staff operations can re-issue a failed refund");
  }

  try {
    const { outcome } = await reissueRefund({ policyId, failedOperationId: operationId, actorUserId: user.id });
    return redirectTo(`/policies/${policyId}?reissued=${encodeURIComponent(outcome.status)}`);
  } catch (error) {
    if (error instanceof RefundReissueRefused || error instanceof RefundSendRefused) {
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
