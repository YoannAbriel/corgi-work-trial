import "@/app/styles/policy-detail.css";
import "@/app/styles/signed.css";
import { PortalShell } from "@/components/portal-shell";
import { SandboxReferences } from "@/components/disclosures";
import { Chip } from "@/components/detail-layout";
import { formatSignedCentsAsUsd, signedArrow, signedTone } from "@/components/signed";
import { About } from "@/components/ui/about";
import { Stat, Stats } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable, FactGrid, Num } from "@/components/ui/table";
import { notFound, redirect } from "next/navigation";
import { MONEY_OUT_APPROVAL_THRESHOLD_CENTS } from "@/lib/approvals/threshold";
import { currentUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/http/path-ids";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { CancellationRefused, planCancellation } from "@/lib/policy/cancel";
import { endorsementScheduleOfPolicy } from "@/lib/policy/endorsement-read";
import { policyDetail } from "@/lib/policy/read";
import { policyFormViews } from "../correction-sections";

// The preview, and the point of this slice: the broker sees exactly what the cancellation will
// do to the money BEFORE anything happens, computed by the same pure functions that will post
// the entries a moment later (lib/money/premium.ts, lib/money/refund-allocation.ts).
//
// It is honest in three ways:
//   - every amount is labelled "as of" the effective date it was computed for;
//   - nothing is written by this page: no event, no operation, no journal entry;
//   - the version of the policy is carried in a hidden field, so if an endorsement or a
//     correction lands between this screen and the confirmation, the confirmation is refused
//     instead of executing figures that are no longer true.
export default async function CancelPolicyPage({
  params,
  searchParams,
}: {
  params: Promise<{ policyId: string }>;
  searchParams: Promise<{ effectiveAt?: string }>;
}) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }

  const [{ policyId }, query] = await Promise.all([params, searchParams]);
  if (!isUuid(policyId)) notFound(); // a malformed id is an unknown policy, not a 500 (F-B7-07)
  const effectiveAt = (query.effectiveAt ?? "").trim();
  if (!effectiveAt) {
    // Opened from the "Cancel the policy" button with no date yet: show the form. Since the
    // layout rebuild of 2026-09-08 the form lives here, not on the policy page.
    return <CancellationForm policyId={policyId} user={user} />;
  }

  let plan;
  try {
    plan = await planCancellation({
      policyId,
      effectiveAt,
      calculationMethod: "pro_rata",
      actor: { userId: user.id, role: user.role, brokerId: user.brokerId },
    });
  } catch (error) {
    if (error instanceof CancellationRefused) {
      // A refusal is part of the preview: the broker sees why, on the page, and can change the
      // date. Nothing was written, so there is nothing to undo.
      return (
        <PortalShell
          active="policies"
          user={user}
          trail={[
            ...(user.role === "broker" ? [] : [{ label: "Policies", href: "/ops/policies" }]),
            { label: "Policy", href: `/policies/${policyId}` },
            { label: "Cancellation preview" },
          ]}
          views={policyFormViews({ policyId, formLabel: "Cancel", formHref: `/policies/${policyId}/cancel` })}
          band={{ title: "Cancellation preview", status: <Chip tone="warn">refused</Chip> }}
        >
          <div className="notices">
            <p className="error" role="alert">
              {error.message}
            </p>
          </div>
        </PortalShell>
      );
    }
    throw error;
  }

  const { breakdown, terms } = plan;

  return (
    <PortalShell
      active="policies"
      user={user}
      trail={[
        ...(user.role === "broker" ? [] : [{ label: "Policies", href: "/ops/policies" }]),
        { label: `Policy ${plan.policyNumber}`, href: `/policies/${policyId}` },
        { label: "Cancellation preview" },
      ]}
      views={policyFormViews({ policyId, formLabel: "Cancel", formHref: `/policies/${policyId}/cancel` })}
      band={{
        title: "Cancellation preview",
        suffix: `Policy ${plan.policyNumber}`,
        // ONE chip, the state of this preview: nothing is booked until the form below is sent
        // (Yoann, 2026-09-09). The day cover stops is a figure of the preview, not a state.
        status: <Chip tone="warn">nothing recorded yet</Chip>,
      }}
    >
      <Stats>
        {/* Money going back to the customer, so the same red minus as a refunding correction
            (Yoann, 2026-09-09). The breakdown below holds the refund as a positive amount, which
            is what it is; the MOVEMENT is that amount leaving, hence the sign here. */}
        <Stat
          label="Refunded"
          tone={signedTone(-breakdown.totalRefundCents)}
          valueIcon={signedArrow(-breakdown.totalRefundCents)}
          value={formatSignedCentsAsUsd(-breakdown.totalRefundCents)}
          note="unearned premium and its tax"
        />
        <Stat
          label="Earned, kept"
          value={formatCentsAsUsd(breakdown.earnedPremiumCents)}
          note={`${breakdown.earnedDays} of ${breakdown.termDays} days covered`}
        />
        <Stat
          label="Commission clawback"
          value={formatCentsAsUsd(breakdown.commissionClawbackCents)}
          note={`${(plan.commissionRateBps / 100).toFixed(2)}% of the refunded premium`}
        />
      </Stats>

      <div className="layout-2">
        <div className="stack">
          <section className="card">
            <h2>What the customer gets back</h2>
            <dl className="pd-facts">
              <div>
                <dt>
                  Written premium
                  {breakdown.writtenPremiumCents !== terms.annualPremiumCents
                    ? `, the ${formatCentsAsUsd(plan.writtenPremiumSegments[0].writtenPremiumCents)} of the issuance plus every endorsement delta`
                    : ""}
                </dt>
                <dd>{formatCentsAsUsd(breakdown.writtenPremiumCents)}</dd>
              </div>
              <div>
                <dt>
                  Earned, {breakdown.earnedDays} of {breakdown.termDays} days covered
                </dt>
                <dd>{formatCentsAsUsd(breakdown.earnedPremiumCents)}</dd>
              </div>
              <div>
                <dt>Unearned premium, refunded</dt>
                <dd>{formatCentsAsUsd(breakdown.unearnedPremiumCents)}</dd>
              </div>
              <div>
                <dt>
                  {terms.stateCode} premium tax on it ({(terms.taxRateBps / 100).toFixed(2)}%)
                </dt>
                <dd>{formatCentsAsUsd(breakdown.refundedTaxCents)}</dd>
              </div>
              <div>
                <dt>Policy fee, earned at issuance</dt>
                <dd>{formatCentsAsUsd(breakdown.refundedFeeCents)}</dd>
              </div>
              {/* The total of this list, in the colour of money going back. NO SIGN HERE, unlike
                  the tile: every line above is a part of this one refund, and a lone minus at the
                  foot of a column of positive parts would read as an arithmetic mistake rather
                  than as a direction. The direction is the tile's job; this row's job is to be
                  the total, which is why it is bold. */}
              <div>
                <dt>Total refunded</dt>
                <dd>
                  <b className={`signed-${signedTone(-breakdown.totalRefundCents)}`}>{formatCentsAsUsd(breakdown.totalRefundCents)}</b>
                </dd>
              </div>
            </dl>
            {breakdown.taxRefundWasCappedAtCharged ? (
              <p className="pd-note">
                The tax refund is capped at the {formatCentsAsUsd(plan.taxChargedCents)} of premium tax this policy still
                holds: rounding up the refund would otherwise give back a cent that was never collected.
              </p>
            ) : null}
          </section>

          {/* Slice B7: an open claim is the live-fire question, so the answer is on the screen the
              operator is looking at when they take the decision, with the claim's own figures. */}
          {plan.openClaims.explanation ? (
            <section className="card">
              <h2>This policy has an open claim</h2>
              <FactGrid
                items={[
                  { label: "Reserve still held, untouched", value: formatCentsAsUsd(plan.openClaims.reserveCents) },
                  { label: "Already paid on it, untouched", value: formatCentsAsUsd(plan.openClaims.paidCents) },
                ]}
              />
              <p className="pd-note">{plan.openClaims.explanation}</p>
            </section>
          ) : null}

          <DataTable ariaLabel="Refund allocation">
            <thead>
              <tr>
                <th>Stripe payment refunded</th>
                <th className="num">Premium</th>
                <th className="num">Tax</th>
                <th className="num">Refund</th>
              </tr>
            </thead>
            <tbody>
              {plan.slices.length === 0 ? (
                <tr>
                  <td colSpan={4} className="dt-empty">
                    <p className="note">Nothing is owed back on this date, so no refund will be sent to Stripe.</p>
                  </td>
                </tr>
              ) : (
                plan.slices.map((slice) => (
                  <tr key={slice.paymentIntentId} className="dt-row">
                    <td>
                      the payment that collected it
                      <SandboxReferences references={[{ label: "Stripe PaymentIntent", value: slice.paymentIntentId }]} />
                    </td>
                    <Num>{formatCentsAsUsd(slice.refundedPremiumCents)}</Num>
                    <Num>{formatCentsAsUsd(slice.refundedTaxCents)}</Num>
                    <Num>{formatCentsAsUsd(slice.amountCents)}</Num>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </div>

        <section className="card pd-form-card">
          <h2>Confirm</h2>
          <p className="pd-note">
            {breakdown.totalRefundCents === 0
              ? "Confirming records the cancellation and its journal entries. No refund is due on this date."
              : plan.refundNeedsApproval
                ? "Confirming records the cancellation, its journal entries and the refund request. The refund waits for approval before it is sent."
                : "Confirming records the cancellation, its journal entries and the refund request, then asks Stripe for the money. The refund is complete only after the provider confirms it."}
          </p>
          {/* Slice B7: maker-checker. Above the threshold the cancellation still happens, and so do
              its journal entries; what waits is the money leaving. */}
          {plan.refundNeedsApproval ? (
            <p className="pd-note">
              <strong>
                This refund is above {formatCentsAsUsd(MONEY_OUT_APPROVAL_THRESHOLD_CENTS)}, so it requires approval.
              </strong>{" "}
              Confirming cancels the policy and records what the customer is owed, but nothing is sent to Stripe until a
              staff approver who is not you approves it in the money-out queue. The threshold is an assumption of this
              build, not a regulatory figure.
            </p>
          ) : null}
          <form method="post" action={`/api/policies/${policyId}/cancel`} className="card">
            <input type="hidden" name="effectiveAt" value={plan.effectiveAt} />
            {/* Short-rate is representable but not computed by this build: the method is stored on
                the cancellation event and any other value is refused by the server. */}
            <input type="hidden" name="calculationMethod" value={plan.calculationMethod} />
            {/* The policy as it stood when these figures were computed. The server refuses the
                confirmation if the policy changed in the meantime. */}
            <input type="hidden" name="policyVersion" value={plan.policyVersion} />
            {/* Three words (cycle 2, decision 8). The date is the band's own chip and the amount
                is the tile above; the sentence beside says what confirming records. */}
            <SubmitButton className="danger">Cancel the policy</SubmitButton>
          </form>
        </section>
      </div>

      <About>
        <h4>Nothing has happened yet</h4>
        <p>
          These are the amounts as of {plan.effectiveAt}, the day cover would stop. Pro-rata calculation on the actual
          days of the term; this page writes nothing.
        </p>
        <h4>Segment by segment</h4>
        <p>
          The issuance premium earns over the whole term and each endorsement earns its prorated amount from its own
          effective date, so the refund is computed on each piece of written premium separately.
        </p>
        <h4>An open claim is untouched</h4>
        <p>
          Cancelling never touches an open claim or its reserve: the loss happened while the policy was in force. The
          refund covers unearned premium only, and the clawback follows the refunded premium alone.
        </p>
      </About>
    </PortalShell>
  );
}

// The form that opens the preview. The owning broker or staff operations, on a bound policy; the
// server refuses everybody else at the preview and at the confirmation whatever this page shows.
async function CancellationForm({
  policyId,
  user,
}: {
  policyId: string;
  user: NonNullable<Awaited<ReturnType<typeof currentUser>>>;
}) {
  const [policy, schedule] = await Promise.all([policyDetail(policyId), endorsementScheduleOfPolicy(policyId)]);
  if (!policy) {
    notFound();
  }
  const isOwningBroker = user.role === "broker" && user.brokerId === policy.brokerId;
  const canChange = (isOwningBroker || user.role === "staff_ops") && policy.status === "bound";
  if (!canChange) {
    redirect(`/policies/${policyId}?error=${encodeURIComponent("only the owning broker or staff operations can cancel a bound policy")}`);
  }
  const today = new Date().toISOString().slice(0, 10);

  return (
    <PortalShell
      active="policies"
      user={user}
      trail={[
        ...(user.role === "broker" ? [] : [{ label: "Policies", href: "/ops/policies" }]),
        { label: `Policy ${policy.policyNumber}`, href: `/policies/${policyId}` },
        { label: "Cancel" },
      ]}
      views={policyFormViews({ policyId, formLabel: "Cancel", formHref: `/policies/${policyId}/cancel` })}
      band={{
        title: "Cancel the policy",
        suffix: `Policy ${policy.policyNumber}`,
        // No chip: a form screen has no state of its own, and the term is printed in the form
        // below (Yoann, 2026-09-09).
      }}
    >
      <div className="layout-2">
        <section className="card pd-form-card">
          <h2>The day cover stops</h2>
          <form method="get" action={`/policies/${policy.policyId}/cancel`} className="card">
            {/* One date and one method: two short fields on one line (cycle 2, decision 16).
                Short-rate cancellation is representable, not computed: the method is stored on
                the event and the short_rate_penalty_income account exists, but this build only
                calculates pro-rata and the server refuses any other value. */}
            <div className="pd-field-pair">
              <span>
                <label htmlFor="effectiveAt">Cancellation effective date</label>
                <input
                  id="effectiveAt"
                  name="effectiveAt"
                  type="date"
                  required
                  defaultValue={today > policy.effectiveAt ? (today < policy.termEnd ? today : policy.termEnd) : policy.effectiveAt}
                  min={policy.effectiveAt}
                  max={policy.termEnd}
                />
              </span>
              <span>
                <label htmlFor="calculationMethod">Calculation method</label>
                <select id="calculationMethod" name="calculationMethod" defaultValue="pro_rata">
                  <option value="pro_rata">Pro-rata</option>
                </select>
              </span>
            </div>
            <button type="submit">Preview the cancellation</button>
          </form>
        </section>

        <section className="card">
          {/* The figures on the record, endorsements included whatever their effective date. The
              preview prices the refund segment by segment from the events themselves. */}
          <h2>On the policy record</h2>
          <FactGrid
            items={[
              { label: "Customer", value: policy.customerName },
              { label: "Annual premium", value: formatCentsAsUsd(policy.annualPremiumCents) },
              { label: "Term", value: `${policy.effectiveAt} to ${policy.termEnd}` },
              { label: "Endorsements", value: schedule.length === 0 ? "none" : String(schedule.length) },
            ]}
          />
        </section>
      </div>

      <About>
        <h4>A past date is allowed</h4>
        <p>
          An insurer often learns late that cover stopped, and the money is always computed from the day cover really
          stopped, never from the day the cancellation was typed.
        </p>
        <h4>What the next screen shows</h4>
        <p>Exactly what would be refunded and clawed back, before anything is written.</p>
        <h4>Endorsed policies</h4>
        <p>
          The refund is computed segment by segment: the issuance premium earns over the whole term and each endorsement
          earns its prorated amount from its own effective date.
        </p>
      </About>
    </PortalShell>
  );
}
