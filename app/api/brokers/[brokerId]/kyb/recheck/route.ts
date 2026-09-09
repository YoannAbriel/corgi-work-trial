import { currentUser } from "@/lib/auth/current-user";
import { badPathIdResponse } from "@/lib/http/path-ids";
import { brokerKybState } from "@/lib/broker/kyb";
import { refreshBrokerKybFromStripe } from "@/lib/broker/kyb-onboarding";
import { withActivity } from "@/lib/observability/log";

// POST /api/brokers/{brokerId}/kyb/recheck
//
// Reads the connected account again at Stripe and records the answer if it is new. It is the
// "Re-read from Stripe" button on the operations screen and the "Check the status at Stripe"
// button on the broker's own page, because both do exactly the same thing and neither should
// have its own copy of it.
//
// It exists because of a real gap, not for comfort: Stripe stops emitting `account.updated`
// once its identity check has landed, and that happens inside the two-minute settling window,
// so every webhook-driven read during the window maps to pending and appends nothing. Somebody
// has to look again afterwards.
//
// Who may press it: the broker it is about, or staff. The action is audited, because the
// status row it can append carries `created_by` (migration 0006).
export const POST = withActivity({ route: "/api/brokers/[brokerId]/kyb/recheck", subject: "broker" }, handlePost);

async function handlePost(request: Request, context: { params: Promise<{ brokerId: string }> }) {
  const user = await currentUser();
  const { brokerId } = await context.params;
  if (!user) {
    return redirectTo("/login?error=Please+sign+in+again");
  }
  const malformedId = badPathIdResponse({ broker: brokerId });
  if (malformedId) {
    return malformedId;
  }

  const isOwningBroker = user.role === "broker" && user.brokerId === brokerId;
  const isStaff = user.role === "staff_ops" || user.role === "staff_approver";
  const backTo = isStaff ? "/ops/brokers" : "/broker/kyb";
  if (!isOwningBroker && !isStaff) {
    return redirectTo(`${backTo}?error=${encodeURIComponent("you cannot read this broker's verification")}`);
  }

  const kyb = await brokerKybState(brokerId);
  if (!kyb.providerAccountId) {
    return redirectTo(
      `${backTo}?error=${encodeURIComponent("this broker has no Stripe connected account to read")}`,
    );
  }

  const outcome = await refreshBrokerKybFromStripe({
    brokerId,
    providerAccountId: kyb.providerAccountId,
    source: isStaff ? "staff_re_read" : "broker_re_read",
    actorUserId: user.id,
  });

  const summary = outcome.appended
    ? `${outcome.previousStatus ?? "unknown"} -> ${outcome.status} (${outcome.reason})`
    : `still ${outcome.status} (${outcome.reason}), nothing appended`;
  return redirectTo(`${backTo}?rechecked=${encodeURIComponent(summary)}`);
}

function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
