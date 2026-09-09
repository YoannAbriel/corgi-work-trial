import "@/app/styles/policy-detail.css";
import "@/app/styles/signed.css";
import { PortalShell } from "@/components/portal-shell";
import { Chip } from "@/components/detail-layout";
import { formatSignedCentsAsUsd, formatSignedDays, signedArrow, signedTone } from "@/components/signed";
import { About } from "@/components/ui/about";
import { EmptyState } from "@/components/ui/empty";
import { Stat, Stats } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
import { FactGrid } from "@/components/ui/table";
import { notFound, redirect } from "next/navigation";
import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/http/path-ids";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { correctionsOfPolicy } from "@/lib/policy/correction-read";
import { customerPolicyViews } from "../../../correction-sections";
import { FormulaLinesTable } from "../../../formula-lines";

// The customer's screen for a correction that costs them more money.
//
// An endorsement was recorded with the wrong effective date, the correction put it right, and the
// corrected date charges more days of cover. Above $500 the customer decides, exactly as they do
// for an endorsement above $500. They see the two dates, the two amounts and the difference,
// computed by the same pure function that priced the correction, before they accept anything.
export default async function ApproveCorrectionPage({
  params,
}: {
  params: Promise<{ policyId: string; rebookEventId: string }>;
}) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  const { policyId, rebookEventId } = await params;
  // Both come from the URL: a value that is not a uuid is a malformed link, answered 404 before
  // it can reach a query that would cast it and raise (review finding F-B8-03).
  if (!isUuid(policyId) || !isUuid(rebookEventId)) {
    notFound();
  }

  const [policy] = await sql<{ policy_number: string; customer_id: string }[]>`
    select policy_number, customer_id from policies where id = ${policyId}
  `;
  if (!policy) {
    notFound();
  }
  // Ownership, checked on the server: the customer of this policy and nobody else. The server
  // checks it again when the button is pressed, so this is the explanation, not the control.
  if (user.role !== "customer" || user.customerId !== policy.customer_id) {
    redirect("/customer");
  }

  const correction = (await correctionsOfPolicy(policyId)).find((row) => row.rebookEventId === rebookEventId);
  if (!correction || !correction.collection) {
    notFound();
  }

  const trail = [{ label: "Your policies", href: "/customer" }, { label: "Correction approval" }];
  const views = customerPolicyViews(policyId, "Approval", `/policies/${policyId}/corrections/${rebookEventId}/approve`);

  if (correction.collection.paidOn) {
    return (
      <PortalShell
        user={user}
        active="policies"
        trail={trail}
        views={views}
        band={{ title: "Nothing to approve", suffix: `Policy ${policy.policy_number}`, status: <Chip tone="ok">paid</Chip> }}
      >
        <EmptyState illustration="all-clear">This difference was already paid on {correction.collection.paidOn}.</EmptyState>
      </PortalShell>
    );
  }

  return (
    <PortalShell
      user={user}
      active="policies"
      trail={trail}
      views={views}
      band={{
        title: "A correction to approve",
        suffix: `Policy ${policy.policy_number}`,
        // ONE chip, the state of the correction being approved (Yoann, 2026-09-09). The corrected
        // effective date is a figure of the correction and is printed in the panel below.
        status: (
          <Chip tone={correction.collection.customerApprovedAt ? "ok" : "warn"}>
            {correction.collection.customerApprovedAt ? "approved" : "waiting for you"}
          </Chip>
        ),
      }}
    >
      <Stats>
        <Stat label="Charged then" value={formatCentsAsUsd(correction.money.before.deltaTotalCents)} note={`${correction.money.before.daysRemaining} days`} />
        <Stat label="Correct amount" value={formatCentsAsUsd(correction.money.after.deltaTotalCents)} note={`${correction.money.after.daysRemaining} days`} />
        {/* The tile that carries the direction, read exactly as on the operator's preview: the
            customer owes more, so it is green with a plus, and the note says the movement in days,
            which is the two counts beside subtracted and nothing else. */}
        <Stat
          label="To pay"
          tone={signedTone(correction.collection.amountCents)}
          valueIcon={signedArrow(correction.collection.amountCents)}
          value={formatSignedCentsAsUsd(correction.collection.amountCents)}
          note={`the difference between the two, ${formatSignedDays(correction.money.after.daysRemaining - correction.money.before.daysRemaining)}`}
        />
      </Stats>

      <div className="layout-2">
        <div className="stack">
          <section className="card">
            <h2>What was put right</h2>
            <FactGrid
              items={[
                { label: "Start date recorded", value: correction.wrongEffectiveAt },
                { label: "Start date corrected to", value: correction.correctedEffectiveAt },
                { label: "Days of cover", value: `${correction.money.after.daysRemaining} instead of ${correction.money.before.daysRemaining}` },
                { label: "Reason recorded by our operations team", value: correction.reason },
              ]}
            />
          </section>

          <section className="card">
            <h2>Every figure, and how it was computed</h2>
            {/* Same reading as the operator's preview: the differences carry the direction, what
                was booked and what the corrected date prices step back, the total is bold. */}
            <FormulaLinesTable
              lines={correction.lines}
              highlightKey="difference_total"
              signedKeys={["premium_difference", "tax_difference", "difference_total"]}
              referenceKeys={["premium_as_booked", "premium_corrected"]}
            />
          </section>
        </div>

        <section className="card pd-form-card">
          <h2>Your approval</h2>
          <p className="pd-note">
            Why it is needed: {correction.approvalSentences.customer ?? "the difference is above the approval threshold"}
            . Approving records your acceptance; your broker then opens the Stripe payment page. Nothing is charged by
            this button.
          </p>
          {correction.collection.customerApprovedAt ? (
            <p className="badge badge-ok">
              Already approved on {correction.collection.customerApprovedAt.toISOString().replace("T", " ").slice(0, 19)} UTC
            </p>
          ) : (
            <form method="post" action={`/api/policies/${policyId}/corrections/${rebookEventId}/approve`} className="card">
              <SubmitButton className="orange">Approve paying {formatCentsAsUsd(correction.collection.amountCents)}</SubmitButton>
            </form>
          )}
        </section>
      </div>

      <About>
        <h4>Why you are asked</h4>
        <p>
          A change to your policy was recorded with the wrong start date. It was put right, and the corrected date covers
          more days, so the amount is higher than the one charged at the time. Above the approval threshold you decide
          before anything is collected.
        </p>
        <h4>Nothing was deleted</h4>
        <p>
          The original figures stay on your policy record with the corrected ones beside them; the timeline on your
          policy page shows both, with the date each was written.
        </p>
      </About>
    </PortalShell>
  );
}
