import { currentUser } from "@/lib/auth/current-user";
import { cancelPolicy, CancellationRefused } from "@/lib/policy/cancel";

// POST /api/policies/{policyId}/cancel, called by the Confirm button of the preview page.
//
// The form carries three fields: the effective date, the calculation method (pro-rata) and the
// policy version the preview was computed against. Everything is checked again on the server,
// so calling this URL directly goes through exactly the same gates as the button.
export async function POST(request: Request, context: { params: Promise<{ policyId: string }> }) {
  const user = await currentUser();
  const { policyId } = await context.params;
  if (!user) {
    return redirectTo("/login?error=Please+sign+in+again");
  }

  const form = await request.formData();
  const effectiveAt = String(form.get("effectiveAt") ?? "").trim();
  const calculationMethod = String(form.get("calculationMethod") ?? "pro_rata").trim();
  const expectedPolicyVersion = String(form.get("policyVersion") ?? "").trim();
  if (!expectedPolicyVersion) {
    // Without it we could not tell whether the policy changed since the preview, so the
    // confirmation is refused rather than executed against unknown figures.
    return backToPolicy(policyId, "the confirmation form is incomplete; open the cancellation preview again");
  }

  try {
    const cancellation = await cancelPolicy({
      policyId,
      effectiveAt,
      calculationMethod,
      expectedPolicyVersion,
      actor: { userId: user.id, role: user.role, brokerId: user.brokerId },
    });
    return redirectTo(`/policies/${policyId}?cancelled=${cancellation.refundOperationIds.length}`);
  } catch (error) {
    if (error instanceof CancellationRefused) {
      // A refusal the person can act on: wrong actor, wrong date, already cancelled, or a
      // policy that changed since the preview.
      return backToPolicy(policyId, error.message);
    }
    // Anything else is a real failure: it must surface as a 500 in the logs rather than look
    // like a rejected form.
    throw error;
  }
}

function backToPolicy(policyId: string, message: string): Response {
  return redirectTo(`/policies/${policyId}?error=${encodeURIComponent(message)}`);
}

// 303 turns the POST into a GET, so refreshing the next page does not resubmit the form.
function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
