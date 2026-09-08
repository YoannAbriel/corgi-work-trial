import { PortalShell } from "@/components/portal-shell";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/http/path-ids";
import { policyDetail } from "@/lib/policy/read";

// Opening a claim on a policy (slice B7), on its own page since the layout rebuild of
// 2026-09-08: the policy page shows the button, this page holds the form. The form posts to the
// same route with the same field names as before; openClaim checks on the server that cover
// existed on the loss date, whatever this page displayed.
export default async function NewClaimPage({ params }: { params: Promise<{ policyId: string }> }) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  const { policyId } = await params;
  if (!isUuid(policyId)) notFound();
  const policy = await policyDetail(policyId);
  if (!policy) {
    notFound();
  }
  // Only staff operations open claims. The route refuses everybody else too.
  if (user.role !== "staff_ops") {
    redirect(`/policies/${policyId}`);
  }
  // A claim needs cover to have existed: a bound policy, or a cancelled one whose loss predates
  // the cancellation. A voided or unpaid policy never had cover.
  if (policy.status !== "bound" && policy.status !== "cancelled") {
    redirect(`/policies/${policyId}?error=${encodeURIComponent("a claim needs a policy that was in force")}`);
  }
  const today = new Date().toISOString().slice(0, 10);

  return (
    <PortalShell
      active="policies"
      user={user}
      trail={[
        { label: "Policies", href: "/ops/policies" },
        { label: `Policy ${policy.policyNumber}`, href: `/policies/${policyId}` },
        { label: "Open a claim" },
      ]}
    >
      <h1>Open a claim on policy {policy.policyNumber}</h1>
      <p className="lead">
        {policy.customerName}, term {policy.effectiveAt} to {policy.termEnd}. The loss must have happened while the
        policy was in force; the reserve is set on the claim screen once it exists.
      </p>
      <form method="post" action={`/api/policies/${policy.policyId}/claims`} className="card">
        <label htmlFor="claimantName">Claimant name</label>
        {/* The bank ownership check compares the account holder with this name, so it is the
            name on the claim that decides where money may go. */}
        <input id="claimantName" name="claimantName" defaultValue={policy.customerName} required />
        <label htmlFor="occurredAt">Date of loss</label>
        <input
          id="occurredAt"
          name="occurredAt"
          type="date"
          required
          min={policy.effectiveAt}
          max={policy.termEnd}
          defaultValue={today > policy.effectiveAt && today <= policy.termEnd ? today : policy.effectiveAt}
        />
        <label htmlFor="reportedAt">Date reported to us</label>
        <input id="reportedAt" name="reportedAt" type="date" required defaultValue={today} />
        <label htmlFor="description">What happened</label>
        <input id="description" name="description" placeholder="water damage in the workshop" required />
        <button type="submit">Open a claim</button>
      </form>
    </PortalShell>
  );
}
