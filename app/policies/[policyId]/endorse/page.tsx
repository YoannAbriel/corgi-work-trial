import { PortalShell } from "@/components/portal-shell";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { MONEY_OUT_APPROVAL_THRESHOLD_CENTS } from "@/lib/approvals/threshold";
import { currentUser } from "@/lib/auth/current-user";
import { formatCentsAsUsd, parseUsdAmountToCents } from "@/lib/money/cents";
import { CUSTOMER_APPROVAL_THRESHOLD_CENTS } from "@/lib/money/endorsement";
import { EndorsementRefused, planEndorsement } from "@/lib/policy/endorse";
import { endorsementsOfPolicy } from "@/lib/policy/endorsement-read";
import { policyDetail } from "@/lib/policy/read";
import { MoneyAmountInput } from "@/components/money-amount-input";
import { FormulaLinesTable } from "../formula-lines";
import { isUuid } from "@/lib/http/path-ids";

// The impact preview, and the point of this slice: the broker sees exactly what the endorsement
// will do to the money BEFORE anything is recorded, line by line with the formula behind each
// figure, computed by the same pure function that will price the execution
// (lib/money/endorsement.ts).
//
// It is honest in three ways:
//   - every amount is priced from the effective date typed in, never from today;
//   - nothing is written by this page: no event, no operation, no journal entry;
//   - the quote hash is carried in a hidden field, so if the policy changes between this screen
//     and the confirmation, the confirmation is refused instead of executing stale figures.
export default async function EndorsePolicyPage({
  params,
  searchParams,
}: {
  params: Promise<{ policyId: string }>;
  searchParams: Promise<{
    effectiveAt?: string;
    newAnnualPremium?: string;
    newPerOccurrenceLimit?: string;
    newAggregateLimit?: string;
    reason?: string;
  }>;
}) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  const [{ policyId }, query] = await Promise.all([params, searchParams]);
  if (!isUuid(policyId)) notFound(); // a malformed id is an unknown page, not a 500 (F-B7-07)

  // Opened from the "Endorse" button with nothing typed yet: show the form. Since the layout
  // rebuild of 2026-09-08 the form lives here, not on the policy page. Same field names as
  // before; the preview below and the confirmation route check every rule again.
  if (query.newAnnualPremium === undefined && query.effectiveAt === undefined) {
    return <EndorsementForm policyId={policyId} user={user} />;
  }

  let plan;
  try {
    plan = await planEndorsement({
      policyId,
      effectiveAt: (query.effectiveAt ?? "").trim(),
      newAnnualPremiumCents: amountCents(query.newAnnualPremium, "new annual premium"),
      newPerOccurrenceLimitCents: amountCents(query.newPerOccurrenceLimit, "new per-occurrence limit"),
      newAggregateLimitCents: amountCents(query.newAggregateLimit, "new aggregate limit"),
      reason: query.reason ?? null,
      actor: { userId: user.id, role: user.role, brokerId: user.brokerId, customerId: user.customerId },
    });
  } catch (error) {
    if (error instanceof EndorsementRefused || error instanceof FormError) {
      // A refusal is part of the preview: the broker sees why and changes the input. Nothing was
      // written, so there is nothing to undo.
      return (
        <PortalShell user={user} active="policies" trail={[...(user.role === "broker" ? [] : [{ label: "Policies", href: "/ops/policies" }]), { label: "Policy", href: `/policies/${policyId}` }, { label: "Endorsement preview" }]}>
          <h1>Endorsement preview</h1>
          <p className="error" role="alert">{error.message}</p>
        </PortalShell>
      );
    }
    throw error;
  }

  const { figures } = plan;
  const direction =
    figures.direction === "charge"
      ? `The customer pays ${formatCentsAsUsd(figures.deltaTotalCents)} through Stripe`
      : figures.direction === "refund"
        ? `The customer is refunded ${formatCentsAsUsd(-figures.deltaTotalCents)} through Stripe, at once`
        : "No money moves";

  return (
    <PortalShell user={user} active="policies" trail={[...(user.role === "broker" ? [] : [{ label: "Policies", href: "/ops/policies" }]), { label: "Policy", href: `/policies/${policyId}` }, { label: "Endorsement preview" }]}>

      <h1>Endorse policy {plan.policyNumber}</h1>
      <p className="lead">
        Nothing has happened yet. These are the amounts as of <strong>{figures.effectiveAt}</strong>, the day the change
        takes effect: {figures.daysRemaining} of {figures.termDays} days of the term remain from that date.
      </p>

      <h2>What changes</h2>
      <div className="table-scroll" role="region" aria-label="Policies table 1" tabIndex={0}>
<table className="amounts">
        <tbody>
          <tr>
            <th>Annual premium</th>
            <td className="amount">
              {formatCentsAsUsd(figures.oldAnnualPremiumCents)} to {formatCentsAsUsd(figures.newAnnualPremiumCents)}
            </td>
          </tr>
          <tr>
            <th>Limits</th>
            <td className="amount">{plan.newLimitLabel}</td>
          </tr>
          {plan.reason ? (
            <tr>
              <th>Reason</th>
              <td className="amount">{plan.reason}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
</div>

      <h2>Impact, line by line</h2>
      <p className="note">{direction}. Each line shows the integer-cent formula that produced it.</p>
      <FormulaLinesTable lines={plan.lines} />
      {figures.taxRefundWasCappedAtCharged ? (
        <p className="note">
          The tax refund is capped at the premium tax still held on this policy: rounding it up would otherwise give
          back a cent that was never collected.
        </p>
      ) : null}

      <h2>What happens on confirm</h2>
      {figures.direction === "charge" ? (
        <p className="note">
          The request is recorded as a policy event carrying these figures and their hash.{" "}
          {figures.customerApprovalRequired
            ? `Because this endorsement takes what this policy is asking the customer for above ${formatCentsAsUsd(CUSTOMER_APPROVAL_THRESHOLD_CENTS)}, the customer must approve it before the delta can be paid.`
            : `At or below ${formatCentsAsUsd(CUSTOMER_APPROVAL_THRESHOLD_CENTS)}, counting anything else already waiting for this customer, no approval is needed and the delta can be paid straight away.`}{" "}
          The endorsement takes effect only when Stripe confirms the delta was paid; until then the policy terms are
          unchanged.
        </p>
      ) : figures.direction === "refund" ? (
        <p className="note">
          The endorsement is applied in one transaction with the refund request and its journal entries.{" "}
          {plan.refundNeedsApproval
            ? `This refund is above ${formatCentsAsUsd(MONEY_OUT_APPROVAL_THRESHOLD_CENTS)}, so it waits in the approval queue: a second person, never you, has to approve it before anything is sent to Stripe.`
            : `At or below ${formatCentsAsUsd(MONEY_OUT_APPROVAL_THRESHOLD_CENTS)} no second approver is needed, so Stripe is asked to refund the original payment straight away.`}{" "}
          The refund counts as completed only when Stripe&apos;s webhook says the money left.
        </p>
      ) : (
        <p className="note">The endorsement is applied at once: no money moves and no journal entry is posted.</p>
      )}

      <form method="post" action={`/api/policies/${policyId}/endorsements`} className="card">
        <input type="hidden" name="effectiveAt" value={figures.effectiveAt} />
        <input type="hidden" name="newAnnualPremiumCents" value={String(figures.newAnnualPremiumCents)} />
        <input type="hidden" name="newPerOccurrenceLimitCents" value={String(plan.newPerOccurrenceLimitCents)} />
        <input type="hidden" name="newAggregateLimitCents" value={String(plan.newAggregateLimitCents)} />
        <input type="hidden" name="reason" value={plan.reason ?? ""} />
        {/* The quote as it was computed. The server recomputes it under a lock and refuses the
            confirmation if the policy changed in between. */}
        <input type="hidden" name="quoteHash" value={figures.quoteHash} />
        <button type="submit">
          {figures.direction === "charge"
            ? `Request the endorsement (${formatCentsAsUsd(figures.deltaTotalCents)} to collect)`
            : figures.direction === "refund"
              ? `Apply the endorsement and refund ${formatCentsAsUsd(-figures.deltaTotalCents)}`
              : "Apply the endorsement"}
        </button>
      </form>
    </PortalShell>
  );
}

// The form that opens the preview. The owning broker or staff operations, on a bound policy with
// no endorsement already in progress; the server refuses everybody else at the preview and at the
// confirmation whatever this page shows.
async function EndorsementForm({
  policyId,
  user,
}: {
  policyId: string;
  user: NonNullable<Awaited<ReturnType<typeof currentUser>>>;
}) {
  const [policy, endorsements] = await Promise.all([policyDetail(policyId), endorsementsOfPolicy(policyId)]);
  if (!policy) {
    notFound();
  }
  const isOwningBroker = user.role === "broker" && user.brokerId === policy.brokerId;
  const canChange = (isOwningBroker || user.role === "staff_ops") && policy.status === "bound";
  if (!canChange) {
    redirect(`/policies/${policyId}?error=${encodeURIComponent("only the owning broker or staff operations can endorse a bound policy")}`);
  }
  const inProgress = endorsements.some(
    (endorsement) => endorsement.standing.state === "awaiting_approval" || endorsement.standing.state === "approved",
  );
  if (inProgress) {
    redirect(`/policies/${policyId}?error=${encodeURIComponent("an endorsement is already in progress on this policy")}`);
  }
  const today = new Date().toISOString().slice(0, 10);

  return (
    <PortalShell user={user} active="policies" trail={[...(user.role === "broker" ? [] : [{ label: "Policies", href: "/ops/policies" }]), { label: `Policy ${policy.policyNumber}`, href: `/policies/${policyId}` }, { label: "Endorse" }]}>
      <h1>Endorse policy {policy.policyNumber}</h1>
      <p className="lead">
        Change the annual premium or the limits from a date inside the term ({policy.effectiveAt} to {policy.termEnd}).
        The next screen shows the exact money it moves, line by line, before anything is recorded. The money is always
        priced from the effective date: a backdated endorsement charges more days, never the day it was typed.
      </p>
      <form method="get" action={`/policies/${policy.policyId}/endorse`} className="card">
        <label htmlFor="newAnnualPremium">New annual premium (USD)</label>
        <MoneyAmountInput
          id="newAnnualPremium"
          name="newAnnualPremium"
          required
          defaultValue={(policy.annualPremiumCents / 100).toFixed(2)}
        />
        <label htmlFor="newPerOccurrenceLimit">New per-occurrence limit (USD)</label>
        <MoneyAmountInput
          id="newPerOccurrenceLimit"
          name="newPerOccurrenceLimit"
          required
          defaultValue={(policy.perOccurrenceLimitCents / 100).toFixed(2)}
        />
        <label htmlFor="newAggregateLimit">New aggregate limit (USD)</label>
        <MoneyAmountInput
          id="newAggregateLimit"
          name="newAggregateLimit"
          required
          defaultValue={(policy.aggregateLimitCents / 100).toFixed(2)}
        />
        <label htmlFor="endorsementEffectiveAt">Effective date</label>
        <input
          id="endorsementEffectiveAt"
          name="effectiveAt"
          type="date"
          required
          defaultValue={today > policy.effectiveAt ? (today < policy.termEnd ? today : policy.termEnd) : policy.effectiveAt}
          min={policy.effectiveAt}
          max={policy.termEnd}
        />
        <label htmlFor="reason">Reason (optional)</label>
        <input id="reason" name="reason" maxLength={200} />
        <button type="submit">Preview the endorsement</button>
        <Link href={`/policies/${policyId}`} className="button-link secondary">
          Back to the policy
        </Link>
      </form>
    </PortalShell>
  );
}

class FormError extends Error {}

function amountCents(text: string | undefined, name: string): number {
  if (!text || text.trim().length === 0) {
    throw new FormError(`the ${name} is required`);
  }
  try {
    return parseUsdAmountToCents(text);
  } catch (error) {
    throw new FormError(error instanceof Error ? error.message : `the ${name} is not a valid amount`);
  }
}
