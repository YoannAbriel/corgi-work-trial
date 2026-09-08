import { currentUser } from "@/lib/auth/current-user";
import { EndorsementRefused, requestEndorsement } from "@/lib/policy/endorse";
import { badPathIdResponse } from "@/lib/http/path-ids";

// POST /api/policies/{policyId}/endorsements, called by the Confirm button of the preview page.
//
// The form carries the effective date, the new annual premium and limits in integer cents, the
// optional reason, and the quote hash the preview was computed with. Everything is recomputed
// on the server under a lock, so calling this URL directly goes through the same gates as the
// button.
export async function POST(request: Request, context: { params: Promise<{ policyId: string }> }) {
  const user = await currentUser();
  const { policyId } = await context.params;
  const malformedId = badPathIdResponse({ policy: policyId }); // a malformed id answers 400, not 500 (F-B7-07)
  if (malformedId) {
    return malformedId;
  }
  if (!user) {
    return redirectTo("/login?error=Please+sign+in+again");
  }

  const form = await request.formData();
  const quoteHash = String(form.get("quoteHash") ?? "").trim();
  if (!/^[0-9a-f]{64}$/.test(quoteHash)) {
    // Without the hash we could not tell whether the policy changed since the preview, so the
    // confirmation is refused rather than executed against unknown figures.
    return backToPolicy(policyId, "the confirmation form is incomplete; open the endorsement preview again");
  }

  try {
    const result = await requestEndorsement({
      policyId,
      effectiveAt: String(form.get("effectiveAt") ?? "").trim(),
      newAnnualPremiumCents: wholeCents(form, "newAnnualPremiumCents"),
      newPerOccurrenceLimitCents: wholeCents(form, "newPerOccurrenceLimitCents"),
      newAggregateLimitCents: wholeCents(form, "newAggregateLimitCents"),
      reason: String(form.get("reason") ?? "").trim() || null,
      expectedQuoteHash: quoteHash,
      actor: { userId: user.id, role: user.role, brokerId: user.brokerId, customerId: user.customerId },
    });
    const outcome = !result.appliedImmediately
      ? "requested"
      : result.refundOperationIdsAwaitingApproval.length > 0
        ? "refund-held"
        : result.refundOperationIds.length > 0
          ? "refund-requested"
          : "applied";
    return redirectTo(`/policies/${policyId}?endorsement=${outcome}`);
  } catch (error) {
    if (error instanceof EndorsementRefused || error instanceof InputError) {
      return backToPolicy(policyId, error.message);
    }
    // Anything else is a real failure: it must surface as a 500 in the logs rather than look
    // like a rejected form.
    throw error;
  }
}

class InputError extends Error {}

// The hidden fields carry integer cents written by the preview page; anything else is refused.
function wholeCents(form: FormData, field: string): number {
  const text = String(form.get(field) ?? "").trim();
  if (!/^\d{1,15}$/.test(text)) {
    throw new InputError(`${field} must be a whole number of cents`);
  }
  return Number(text);
}

function backToPolicy(policyId: string, message: string): Response {
  return redirectTo(`/policies/${policyId}?error=${encodeURIComponent(message)}`);
}

// 303 turns the POST into a GET, so refreshing the next page does not resubmit the form.
function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
