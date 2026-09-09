import "@/app/styles/policy-detail.css";
import { PortalShell } from "@/components/portal-shell";
import { About } from "@/components/ui/about";
import { SubmitButton } from "@/components/ui/submit-button";
import { FactGrid } from "@/components/ui/table";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/http/path-ids";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { policyDetail } from "@/lib/policy/read";
import { policyFormViews } from "../../correction-sections";

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
      views={policyFormViews({ policyId, formLabel: "New claim", formHref: `/policies/${policyId}/claims/new` })}
      band={{
        title: "Open a claim",
        suffix: `Policy ${policy.policyNumber}`,
        // No chip: this is a form, and the state it showed belonged to the policy, which has its
        // own page and its own chip (Yoann, 2026-09-09).
      }}
    >
      <div className="layout-2">
        <section className="card pd-form-card">
          <h2>The loss</h2>
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
            <SubmitButton>Open a claim</SubmitButton>
          </form>
        </section>

        <section className="card">
          {/* The limits written on the record, endorsements included whatever their effective
              date (finding F-YA-07). The limits a payment is measured against are folded from the
              claim's own events on the claim screen. */}
          <h2>On the policy record</h2>
          <FactGrid
            items={[
              { label: "Customer", value: policy.customerName },
              { label: "Term", value: `${policy.effectiveAt} to ${policy.termEnd}` },
              { label: "Per-occurrence limit", value: formatCentsAsUsd(policy.perOccurrenceLimitCents) },
              { label: "Aggregate limit", value: formatCentsAsUsd(policy.aggregateLimitCents) },
            ]}
          />
          <p className="pd-note">
            The loss must have happened while the policy was in force. The reserve is set on the claim screen once the
            claim exists.
          </p>
        </section>
      </div>

      <About>
        <h4>What opening a claim does</h4>
        <p>
          It records the claim and nothing else: no money moves, and nothing is reserved until a person sets a reserve on
          the claim screen.
        </p>
        <h4>Cover on the loss date</h4>
        <p>
          The server checks that cover existed on the date of loss, whatever this page displayed. A claim can be opened on
          a cancelled policy when the loss predates the cancellation.
        </p>
      </About>
    </PortalShell>
  );
}
