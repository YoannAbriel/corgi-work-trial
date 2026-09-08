import { PortalShell } from "@/components/portal-shell";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current-user";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { CorrectionRefused, planEndorsementDateCorrection } from "@/lib/policy/correct-endorsement-date";
import { FormulaLinesTable } from "../../formula-lines";

// The impact preview of a backdated correction, and the point of this slice: the operator sees
// exactly what the correction will do to the money BEFORE anything is recorded, line by line with
// the formula behind each figure, computed by the same pure function that will price the
// execution (lib/money/correction.ts).
//
// It is honest in three ways:
//   - the endorsement is re-priced from the corrected effective date, with every other input
//     unchanged, so a correction can never quietly re-price a policy at today's rates;
//   - nothing is written by this page: no event, no journal entry, no money operation;
//   - the policy version is carried in a hidden field, so if the policy changes between this
//     screen and the confirmation, the confirmation is refused instead of executing stale figures.
export default async function CorrectEndorsementDatePage({
  params,
  searchParams,
}: {
  params: Promise<{ policyId: string }>;
  searchParams: Promise<{ endorsedEventId?: string; correctedEffectiveAt?: string; reason?: string }>;
}) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  const [{ policyId }, query] = await Promise.all([params, searchParams]);
  const endorsedEventId = (query.endorsedEventId ?? "").trim();

  let plan;
  try {
    plan = await planEndorsementDateCorrection({
      policyId,
      correctedEventId: endorsedEventId,
      correctedEffectiveAt: (query.correctedEffectiveAt ?? "").trim(),
      reason: query.reason ?? "",
      actor: { userId: user.id, role: user.role },
    });
  } catch (error) {
    if (error instanceof CorrectionRefused) {
      // A refusal is part of the preview: the operator sees why and changes the input. Nothing
      // was written, so there is nothing to undo.
      return (
        <PortalShell user={user} active="policies" trail={[...(user.role === "broker" ? [] : [{ label: "Policies", href: "/ops/policies" }]), { label: "Policy", href: `/policies/${policyId}` }, { label: "Correction preview" }]}>
          <h1>Correct the effective date</h1>
          <p className="error" role="alert">{error.message}</p>
        </PortalShell>
      );
    }
    throw error;
  }

  const { money } = plan;
  const direction =
    money.settlement === "collect"
      ? `The customer owes ${formatCentsAsUsd(money.differenceTotalCents)} more, collected through Stripe`
      : money.settlement === "refund"
        ? `The customer is owed ${formatCentsAsUsd(-money.differenceTotalCents)} back, refunded through Stripe`
        : "No money moves: the corrected date prices the same amount";

  return (
    <PortalShell user={user} active="policies" trail={[...(user.role === "broker" ? [] : [{ label: "Policies", href: "/ops/policies" }]), { label: "Policy", href: `/policies/${policyId}` }, { label: "Correction preview" }]}>

      <h1>Correct an endorsement date on policy {plan.policyNumber}</h1>
      <p className="lead">
        Nothing has happened yet. The endorsement is in force from <strong>{money.wrongEffectiveAt}</strong> and would be
        put right to <strong>{money.correctedEffectiveAt}</strong>, which leaves {money.after.daysRemaining} of{" "}
        {money.after.termDays} days of the term instead of {money.before.daysRemaining}.
      </p>

      <h2>What changes</h2>
      <div className="table-scroll" role="region" aria-label="Policies table 1" tabIndex={0}>
<table className="amounts">
        <tbody>
          <tr>
            <th>Endorsement</th>
            <td className="amount">{plan.description}</td>
          </tr>
          <tr>
            <th>Effective date</th>
            <td className="amount">
              {money.wrongEffectiveAt} to {money.correctedEffectiveAt}
            </td>
          </tr>
          <tr>
            <th>Prorated premium and tax as booked</th>
            <td className="amount">{formatCentsAsUsd(money.before.deltaTotalCents)}</td>
          </tr>
          <tr>
            <th>Prorated premium and tax at the corrected date</th>
            <td className="amount">{formatCentsAsUsd(money.after.deltaTotalCents)}</td>
          </tr>
          <tr className="total">
            <th>Difference</th>
            <td className="amount">{formatCentsAsUsd(money.differenceTotalCents)}</td>
          </tr>
          <tr>
            <th>Reason that will be written on every entry</th>
            <td className="amount">{plan.reason}</td>
          </tr>
        </tbody>
      </table>
</div>

      <h2>Impact, line by line</h2>
      <p className="note">{direction}. Each line shows the integer-cent formula that produced it.</p>
      <FormulaLinesTable lines={plan.lines} />

      <h2>The entries that will be reversed</h2>
      <p className="note">
        Only what the customer was BILLED is reversed. The cash entries stay exactly as they are: Stripe really does hold
        that money, and reversing them would make the ledger claim it left. The originals below stay in the journal for
        ever; a mirrored entry is appended beside each of them, on the same effective date, recorded now.
      </p>
      <div className="table-scroll" role="region" aria-label="Policies table 2" tabIndex={0}>
<table>
        <thead>
          <tr>
            <th>Entry</th>
            <th>Effective</th>
            <th>Recorded (UTC)</th>
            <th className="amount">Amount</th>
          </tr>
        </thead>
        <tbody>
          {plan.entriesToReverse.map((entry) => (
            <tr key={entry.entryId}>
              <td>{entry.entryType}</td>
              <td>{entry.effectiveAt}</td>
              <td>{entry.recordedAt.toISOString().replace("T", " ").slice(0, 19)}</td>
              <td className="amount">{formatCentsAsUsd(entry.amountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
</div>

      <h2>What happens on confirm</h2>
      <p className="note">
        In one transaction: a dated correction event superseding the endorsement that was wrong, one reversal entry per
        line above, the endorsement re-booked on {money.correctedEffectiveAt} with fresh premium and tax entries, and the
        difference opened as a money operation. Nothing is deleted and nothing is updated.
        {money.settlement === "collect"
          ? ` The ${formatCentsAsUsd(money.differenceTotalCents)} difference is then collected through a hosted Stripe page.`
          : money.settlement === "refund"
            ? ` The ${formatCentsAsUsd(-money.differenceTotalCents)} goes back through the Stripe Refunds API on the original payment.`
            : ""}
      </p>
      {/* The verdict on each threshold, always with the total it was read against: both are
          cumulative over the policy, so the amount of this correction alone does not answer
          them (review finding F-B8-02). */}
      {plan.approvalSentences.customer ? <p className="note">Customer approval: {plan.approvalSentences.customer}.</p> : null}
      {plan.approvalSentences.refund ? <p className="note">Second approver: {plan.approvalSentences.refund}.</p> : null}

      <form method="post" action={`/api/policies/${policyId}/corrections`} className="card">
        <input type="hidden" name="endorsedEventId" value={plan.correctedEventId} />
        <input type="hidden" name="correctedEffectiveAt" value={money.correctedEffectiveAt} />
        <input type="hidden" name="reason" value={plan.reason} />
        {/* The policy as it stood when this preview was computed. The server recomputes it under
            a lock and refuses the confirmation if the policy changed in between. */}
        <input type="hidden" name="expectedPolicyVersion" value={String(plan.policyVersion)} />
        <button type="submit">
          Correct the effective date to {money.correctedEffectiveAt}
          {money.settlement === "collect"
            ? ` and ask for ${formatCentsAsUsd(money.differenceTotalCents)}`
            : money.settlement === "refund"
              ? ` and give back ${formatCentsAsUsd(-money.differenceTotalCents)}`
              : ""}
        </button>
      </form>
    </PortalShell>
  );
}
