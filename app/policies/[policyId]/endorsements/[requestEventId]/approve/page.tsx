import "@/app/styles/policy-detail.css";
import { PortalShell } from "@/components/portal-shell";
import { Chip } from "@/components/detail-layout";
import { About } from "@/components/ui/about";
import { EmptyState } from "@/components/ui/empty";
import { Stat, Stats } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
import { FactGrid } from "@/components/ui/table";
import { redirect, notFound } from "next/navigation";
import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { CUSTOMER_APPROVAL_THRESHOLD_CENTS, endorsementFormulaLines } from "@/lib/money/endorsement";
import { endorsementRequestStanding, readEndorsementRequest } from "@/lib/policy/endorsement-requests";
import { policyDetail } from "@/lib/policy/read";
import { toastsFromQuery } from "@/lib/ui/views";
import { customerPolicyViews } from "../../../correction-sections";
import { FormulaLinesTable } from "../../../formula-lines";
import { isUuid } from "@/lib/http/path-ids";

// The customer's approval screen: the same formula lines the broker previewed, read back from
// the immutable request event, and one checkbox. Only the policy's customer sees it. Approving
// binds the customer to the quote hash: if the broker requests a different change afterwards,
// this approval no longer matches and cannot be used.
export default async function ApproveEndorsementPage({
  params,
  searchParams,
}: {
  params: Promise<{ policyId: string; requestEventId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  const [{ policyId, requestEventId }, query] = await Promise.all([params, searchParams]);
  if (!isUuid(policyId) || !isUuid(requestEventId)) notFound(); // a malformed id is an unknown page, not a 500 (F-B7-07)

  const policy = await policyDetail(policyId);
  if (!policy) {
    redirect("/customer");
  }
  if (user.role !== "customer" || user.customerId !== policy.customerId) {
    redirect(`/customer?error=${encodeURIComponent("only the customer of a policy can see its approval screen")}`);
  }

  const trail = [
    { label: "Your policies", href: "/customer" },
    { label: `Policy ${policy.policyNumber}`, href: `/policies/${policyId}` },
    { label: "Endorsement approval" },
  ];
  // The customer's two views of their policy stay in the sidebar while they read the quote.
  const views = customerPolicyViews(policyId, "Approval", `/policies/${policyId}/endorsements/${requestEventId}/approve`);
  // POST .../approve redirects back here with ?error= when it refuses, and the screen showed the
  // sentence but raised no toast (feedback audit of 2026-09-09 19:10).
  const toasts = toastsFromQuery(query, { error: { tone: "error", title: "Refused" } });

  const request = await readEndorsementRequest(sql, policyId, requestEventId);
  if (!request) {
    return (
      <PortalShell
        user={user}
        active="policies"
        trail={trail}
        views={views}
        band={{ title: "Endorsement approval", suffix: `Policy ${policy.policyNumber}`, meta: <Chip tone="warn">unknown</Chip> }}
      >
        <div className="notices">
          <p className="error" role="alert">
            This endorsement request does not exist on this policy.
          </p>
        </div>
        <EmptyState illustration="closed-folder">Nothing to approve here.</EmptyState>
      </PortalShell>
    );
  }
  const standing = await endorsementRequestStanding(sql, request);
  const figures = request.figures;
  const refusal = query.error;

  return (
    <PortalShell
      user={user}
      active="policies"
      trail={trail}
      views={views}
      toasts={toasts}
      band={{
        title: "Approve the change",
        suffix: `Policy ${policy.policyNumber}`,
        meta: (
          <>
            <Chip
              tone={
                standing.state === "applied" ? "ok" : standing.state === "superseded" ? "warn" : standing.approvedEventId ? "ok" : "warn"
              }
            >
              {standing.state === "applied"
                ? "in force"
                : standing.state === "superseded"
                  ? "superseded"
                  : standing.approvedEventId
                    ? "approved"
                    : "waiting for you"}
            </Chip>
            <Chip tone="neutral">effective {figures.effectiveAt}</Chip>
          </>
        ),
      }}
    >
      {refusal ? (
        <div className="notices">
          <p className="error" role="alert">
            {refusal}
          </p>
        </div>
      ) : null}

      <Stats>
        <Stat label="Annual premium" value={formatCentsAsUsd(figures.newAnnualPremiumCents)} note={`from ${formatCentsAsUsd(figures.oldAnnualPremiumCents)}`} />
        <Stat
          label="You would pay"
          tone="accent"
          value={formatCentsAsUsd(figures.deltaTotalCents)}
          note={`${figures.daysRemaining} of ${figures.termDays} days remain`}
        />
        <Stat label="Effective" value={figures.effectiveAt} note="the day the change starts" />
      </Stats>

      <div className="layout-2">
        <div className="stack">
          <section className="card">
            <h2>What your broker asks</h2>
            <FactGrid
              items={[
                { label: "Broker", value: policy.brokerName },
                { label: "The change", value: request.description },
                ...(request.reason ? [{ label: "Reason given", value: request.reason }] : []),
                { label: "Effective", value: figures.effectiveAt },
              ]}
            />
          </section>

          <section className="card">
            <h2>What you would pay, line by line</h2>
            <p className="pd-note">
              {figures.daysRemaining} of {figures.termDays} days of the term remain from {figures.effectiveAt}. Every
              figure is the one stored on the request; none of it is recomputed for display.
            </p>
            <FormulaLinesTable lines={endorsementFormulaLines(figures)} />
          </section>
        </div>

        <section className="card pd-form-card">
          <h2>Your approval</h2>
          {standing.state === "applied" ? (
            <p className="pd-note">This endorsement is already in force.</p>
          ) : standing.state === "superseded" ? (
            <p className="error" role="alert">
              This quote was superseded by a later change on the policy; the figures beside are no longer the ones on
              offer.
            </p>
          ) : standing.approvedEventId ? (
            <p className="badge badge-ok">
              Approved on {standing.approvedAt?.toISOString().replace("T", " ").slice(0, 19)} UTC. The delta is collected
              by your broker.
            </p>
          ) : !standing.approvalRequired ? (
            <p className="pd-note">
              This endorsement does not take the additional premium of this policy above{" "}
              {formatCentsAsUsd(CUSTOMER_APPROVAL_THRESHOLD_CENTS)}, so it needs no approval.
            </p>
          ) : null}

          {standing.state === "awaiting_approval" ? (
            <form method="post" action={`/api/policies/${policyId}/endorsements/${requestEventId}/approve`} className="card">
              <input type="hidden" name="quoteHash" value={figures.quoteHash} />
              <label className="checkbox-label">
                <input type="checkbox" name="approved" value="yes" required />
                <span>
                  I approve paying {formatCentsAsUsd(figures.deltaTotalCents)} for this change, as computed beside. This
                  approval is bound to these exact figures.
                </span>
              </label>
              <SubmitButton className="orange">Approve</SubmitButton>
            </form>
          ) : null}
        </section>
      </div>

      <About>
        <h4>Why you are asked</h4>
        <p>
          Once this term&apos;s changes add more than {formatCentsAsUsd(CUSTOMER_APPROVAL_THRESHOLD_CENTS)} of premium,
          you accept the quote yourself before anything is collected.
        </p>
        <h4>Bound to these figures</h4>
        <p>
          Your approval carries the hash of this quote. If your broker asks for a different change afterwards, this
          approval no longer matches and cannot be used for it.
        </p>
        <h4>Nothing is charged here</h4>
        <p>Approving records your acceptance. Your broker then opens the Stripe payment page for the difference.</p>
      </About>
    </PortalShell>
  );
}
