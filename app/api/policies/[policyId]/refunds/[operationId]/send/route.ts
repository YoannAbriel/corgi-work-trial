import { ApprovalRefused } from "@/lib/approvals/approvals";
import { currentUser } from "@/lib/auth/current-user";
import { sendRequestedRefund, RefundSendRefused } from "@/lib/payments/refunds";

// POST /api/policies/{policyId}/refunds/{operationId}/send
//
// One button for two situations that need exactly the same thing (see sendRequestedRefund in
// lib/payments/refunds.ts):
//
//   the refund is above $1,000 and an approver has now said yes;
//   the refund is stuck in 'requested' because the process died between the cancellation
//   committing and Stripe being called (review finding F-B5-03).
//
// Restricted to staff operations: sending money is an operations decision. The approver's job is
// to approve, and letting the checker also execute would blur the two roles.
export async function POST(
  request: Request,
  context: { params: Promise<{ policyId: string; operationId: string }> },
) {
  const user = await currentUser();
  const { policyId, operationId } = await context.params;
  if (!user) {
    return redirectTo("/login?error=Please+sign+in+again");
  }
  if (user.role !== "staff_ops") {
    return backToPolicy(policyId, "only staff operations can send a refund to Stripe");
  }

  try {
    const outcome = await sendRequestedRefund({ policyId, operationId, actorUserId: user.id });
    return redirectTo(`/policies/${policyId}?refundSent=${encodeURIComponent(outcome.status)}`);
  } catch (error) {
    if (error instanceof RefundSendRefused || error instanceof ApprovalRefused) {
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
