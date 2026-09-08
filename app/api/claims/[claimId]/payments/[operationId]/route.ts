import { currentUser } from "@/lib/auth/current-user";
import { ClaimRefused, todayUtc } from "@/lib/claims/claims";
import {
  assertPaymentBelongsToClaim,
  returnClaimPayment,
  sendClaimPayment,
  settleClaimPayment,
} from "@/lib/claims/payments";
import { ApprovalRefused } from "@/lib/approvals/approvals";
import { badPathIdResponse } from "@/lib/http/path-ids";

// POST /api/claims/{claimId}/payments/{operationId}: the three stages of one claim payment.
//
//   send    the money leaves the reserve for the LOCAL SIMULATOR rail. Refused unless the
//           approval that gates it (above $1,000) has been given, by someone else, for exactly
//           this payment to exactly this bank account.
//   settle  a LOCAL SIMULATOR control: it brings the settlement forward instead of waiting for
//           the scheduled job. It is a control of the simulated bank, not a business action,
//           and the screen says so.
//   return  a LOCAL SIMULATOR control: the receiving bank sends the money back. The cash comes
//           home and the reserve is restored.
export async function POST(
  request: Request,
  context: { params: Promise<{ claimId: string; operationId: string }> },
) {
  const user = await currentUser();
  const { claimId, operationId } = await context.params;
  if (!user) {
    return redirectTo("/login?error=Please+sign+in+again");
  }
  const malformedId = badPathIdResponse({ claim: claimId, payment: operationId });
  if (malformedId) {
    return malformedId;
  }

  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  const actor = { userId: user.id, role: user.role };

  try {
    // The two ids in the URL must name the same payment. Checked before anything else, so a
    // hand-made URL cannot drive a stage of another claim's payment (review finding F-B7-08).
    await assertPaymentBelongsToClaim(claimId, operationId);

    switch (action) {
      case "send": {
        const sent = await sendClaimPayment({ operationId, actor });
        return backToClaim(claimId, `payment=${sent.outcome}`);
      }

      case "settle": {
        // Only staff operations drive the simulated rail, like every other money action here.
        // The role is checked inside settleClaimPayment, from the actor passed here, so a
        // future caller cannot settle a payment without being checked (finding F-B7-10).
        const settled = await settleClaimPayment({
          operationId,
          settledOn: todayUtc(),
          settledBy: actor,
        });
        return backToClaim(claimId, `payment=${settled.outcome}`);
      }

      case "return": {
        const returned = await returnClaimPayment({
          operationId,
          returnedOn: todayUtc(),
          returnReason: String(form.get("returnReason") ?? "account_closed"),
          actor,
        });
        return backToClaim(claimId, `payment=${returned.outcome}`);
      }

      default:
        return backToClaim(claimId, `error=${encodeURIComponent(`unknown action "${action}"`)}`);
    }
  } catch (error) {
    if (error instanceof ClaimRefused || error instanceof ApprovalRefused) {
      return backToClaim(claimId, `error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }
}

function backToClaim(claimId: string, query: string): Response {
  return redirectTo(`/ops/claims/${claimId}?${query}`);
}

function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
