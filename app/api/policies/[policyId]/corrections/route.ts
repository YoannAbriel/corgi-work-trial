import { currentUser } from "@/lib/auth/current-user";
import { correctEndorsementDate, CorrectionRefused } from "@/lib/policy/correct-endorsement-date";

// POST /api/policies/{policyId}/corrections, called by the Confirm button of the preview page.
//
// The form carries the endorsement whose effective date was wrong, the date it should have
// carried, the reason, and the policy version the preview was computed against. Everything is
// recomputed on the server under a lock, so calling this URL directly goes through the same
// gates as the button: staff operations only, one correction per endorsement, dates inside the
// term, and no correction on a cancelled or voided policy.
export async function POST(request: Request, context: { params: Promise<{ policyId: string }> }) {
  const user = await currentUser();
  const { policyId } = await context.params;
  if (!user) {
    return redirectTo("/login?error=Please+sign+in+again");
  }

  const form = await request.formData();
  const endorsedEventId = String(form.get("endorsedEventId") ?? "").trim();
  if (!UUID.test(endorsedEventId)) {
    return backToPolicy(policyId, "the confirmation form does not name an endorsement; open the correction preview again");
  }
  const expectedPolicyVersion = Number(String(form.get("expectedPolicyVersion") ?? ""));
  if (!Number.isSafeInteger(expectedPolicyVersion) || expectedPolicyVersion <= 0) {
    // Without the version we could not tell whether the policy changed since the preview, so the
    // confirmation is refused rather than executed against unknown figures.
    return backToPolicy(policyId, "the confirmation form is incomplete; open the correction preview again");
  }

  try {
    const result = await correctEndorsementDate({
      policyId,
      correctedEventId: endorsedEventId,
      correctedEffectiveAt: String(form.get("correctedEffectiveAt") ?? "").trim(),
      reason: String(form.get("reason") ?? "").trim(),
      expectedPolicyVersion,
      actor: { userId: user.id, role: user.role },
    });
    const outcome = result.plan.money.settlement === "collect"
      ? "collect"
      : result.refundOperationIdsAwaitingApproval.length > 0
        ? "refund-held"
        : result.refundOperationIds.length > 0
          ? "refund-requested"
          : "done";
    return redirectTo(`/policies/${policyId}?correction=${outcome}`);
  } catch (error) {
    if (error instanceof CorrectionRefused) {
      return backToPolicy(policyId, error.message);
    }
    // Anything else is a real failure: it must surface as a 500 in the logs rather than look
    // like a rejected form.
    throw error;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function backToPolicy(policyId: string, message: string): Response {
  return redirectTo(`/policies/${policyId}?error=${encodeURIComponent(message)}`);
}

// 303 turns the POST into a GET, so refreshing the next page does not resubmit the form.
function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
