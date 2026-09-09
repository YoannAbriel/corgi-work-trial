import { currentUser } from "@/lib/auth/current-user";
import { closeClaim, setClaimReserve, ClaimRefused } from "@/lib/claims/claims";
import { addClaimantBankAccount, requestClaimPayment, sendClaimPayment } from "@/lib/claims/payments";
import { badPathIdResponse } from "@/lib/http/path-ids";
import { parseUsdAmountToCents } from "@/lib/money/cents";
import { withActivity } from "@/lib/observability/log";

// POST /api/claims/{claimId}: the four things staff operations can do to a claim.
//
// One route with a named `action` field rather than four routes, because the four share the
// same authorisation, the same refusal handling and the same redirect, and a reader can see all
// four in one screen. The action never carries authority: `currentUser()` reads the signed
// session cookie and the money functions check the role again themselves.
export const POST = withActivity({ route: "/api/claims/[claimId]", rule: "claim rules", subject: "claim" }, handlePost);

async function handlePost(request: Request, context: { params: Promise<{ claimId: string }> }) {
  const user = await currentUser();
  const { claimId } = await context.params;
  if (!user) {
    return redirectTo("/login?error=Please+sign+in+again");
  }
  const malformedId = badPathIdResponse({ claim: claimId });
  if (malformedId) {
    return malformedId;
  }

  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  const actor = { userId: user.id, role: user.role };

  try {
    switch (action) {
      case "set-reserve": {
        const { deltaCents } = await setClaimReserve(
          {
            claimId,
            newReserveCents: parseUsdAmountToCents(String(form.get("reserveAmount") ?? "")),
            note: text(form.get("note")),
            actor,
          },
        );
        return backToClaim(claimId, `reserved=${deltaCents}`);
      }

      case "add-bank-account": {
        const result = await addClaimantBankAccount({
          claimId,
          accountHolderName: String(form.get("accountHolderName") ?? ""),
          routingNumber: String(form.get("routingNumber") ?? ""),
          accountNumber: String(form.get("accountNumber") ?? ""),
          actor,
        });
        return backToClaim(claimId, `bank=${result.status}`);
      }

      case "request-payment": {
        const requested = await requestClaimPayment({
          claimId,
          amountCents: parseUsdAmountToCents(String(form.get("paymentAmount") ?? "")),
          actor,
        });
        // Below the threshold there is nobody to wait for, so the payment goes to the rail
        // straight away, in its own transaction, exactly as an approved one would.
        if (!requested.approvalRequestId) {
          await sendClaimPayment({ operationId: requested.operationId, actor });
          return backToClaim(claimId, "payment=sent");
        }
        return backToClaim(claimId, "payment=awaiting-approval");
      }

      case "close": {
        await closeClaim({ claimId, note: text(form.get("note")), actor });
        return backToClaim(claimId, "closed=1");
      }

      default:
        return backToClaim(claimId, `error=${encodeURIComponent(`unknown action "${action}"`)}`);
    }
  } catch (error) {
    // A refusal a person can act on becomes a message on the claim page. Anything else is a real
    // failure and must surface as a 500 in the logs rather than look like a rejected form.
    if (error instanceof ClaimRefused || isAmountFormatError(error, action)) {
      return backToClaim(claimId, `error=${encodeURIComponent((error as Error).message)}`);
    }
    throw error;
  }
}

// parseUsdAmountToCents throws a plain Error for "12.345" or "twelve dollars". That is a form
// mistake, not a system failure, so it is shown next to the form it came from.
function isAmountFormatError(error: unknown, action: string): boolean {
  const amountActions = ["set-reserve", "request-payment"];
  return amountActions.includes(action) && error instanceof Error && /US dollar amount/.test(error.message);
}

function text(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function backToClaim(claimId: string, query: string): Response {
  return redirectTo(`/ops/claims/${claimId}?${query}`);
}

function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
