import { currentUser } from "@/lib/auth/current-user";
import { isUniqueViolation } from "@/lib/ledger/post";
import { approveEndorsement, EndorsementRefused } from "@/lib/policy/endorse";
import { badPathIdResponse } from "@/lib/http/path-ids";
import { withActivity } from "@/lib/observability/log";

// POST /api/policies/{policyId}/endorsements/{requestEventId}/approve
//
// The customer's explicit approval of a quote above $500. The form carries the quote hash the
// customer saw; the server checks that it is the hash on file and that the quote is still the
// live one, so a stale page or a forged field is refused. Only the policy's own customer, read
// from the session, can approve; the broker, staff and any agent are refused.
export const POST = withActivity({ route: "/api/policies/[policyId]/endorsements/[requestEventId]/approve", rule: "endorsement", subject: "policy" }, handlePost);

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

  const form = await request.formData();
  const quoteHash = String(form.get("quoteHash") ?? "").trim();
  if (form.get("approved") !== "yes" || !/^[0-9a-f]{64}$/.test(quoteHash)) {
    return backToApproval(policyId, requestEventId, "tick the approval box to accept these figures");
  }

  try {
    const result = await approveEndorsement({
      policyId,
      requestEventId,
      quoteHash,
      actor: { userId: user.id, role: user.role, brokerId: user.brokerId, customerId: user.customerId },
    });
    return redirectTo(`/customer?approved=${result.alreadyApproved ? "already" : "1"}`);
  } catch (error) {
    if (error instanceof EndorsementRefused) {
      return backToApproval(policyId, requestEventId, error.message);
    }
    // Two Approve clicks at the same instant: both read the standing, both insert, and the loser
    // hits policy_events_one_approval_per_request. The database did its job (one approval, never
    // two) and the customer used to see HTTP 500 for it (review finding F-B4-10). The answer is
    // the one the winner got, because it is the true one: the endorsement is approved.
    if (isUniqueViolation(error)) {
      return redirectTo("/customer?approved=already");
    }
    throw error;
  }
}

function backToApproval(policyId: string, requestEventId: string, message: string): Response {
  return redirectTo(`/policies/${policyId}/endorsements/${requestEventId}/approve?error=${encodeURIComponent(message)}`);
}

function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
