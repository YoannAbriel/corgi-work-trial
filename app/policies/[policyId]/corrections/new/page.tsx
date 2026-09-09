import { PortalShell } from "@/components/portal-shell";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/http/path-ids";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { CorrectionRefused, planEndorsementDateCorrection } from "@/lib/policy/correct-endorsement-date";
import { endorsementScheduleOfPolicy } from "@/lib/policy/endorsement-read";
import { policyDetail } from "@/lib/policy/read";
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
  // A path id that is not a uuid is a malformed URL, not a policy that exists somewhere: 404
  // before anything reaches a query that would cast it and raise (review finding F-B8-03).
  if (!isUuid(policyId)) {
    notFound();
  }
  const endorsedEventId = (query.endorsedEventId ?? "").trim();
  const correctedEffectiveAt = (query.correctedEffectiveAt ?? "").trim();

  // Opened from the "Correct" link with nothing typed yet: show the form, exactly as the endorse
  // and the cancel previews do (review finding F-RC-06). Without it the entry point of a
  // backdated correction was a heading and a red refusal with nothing to fill in.
  if (!correctedEffectiveAt) {
    return <CorrectionForm policyId={policyId} user={user} />;
  }

  let plan;
  try {
    plan = await planEndorsementDateCorrection({
      policyId,
      correctedEventId: endorsedEventId,
      correctedEffectiveAt,
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
      {/* UI-024: the three cells below hold sentences and dates, not amounts. Carrying the amount
          class gave them white-space: nowrap, so the endorsement's description held the table
          open on one 942 px line, the label column was squeezed to 44 px, and "Endorsement"
          came out one letter per line. Only the money rows keep the class. */}
      <div className="table-scroll" role="region" aria-label="What changes" tabIndex={0}>
<table className="amounts">
        <tbody>
          <tr>
            <th>Endorsement</th>
            <td>{plan.description}</td>
          </tr>
          <tr>
            <th>Effective date</th>
            <td>
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
            <td>{plan.reason}</td>
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
      <div className="table-scroll" role="region" aria-label="Entries that will be reversed" tabIndex={0}>
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

// The form that opens the preview. Staff operations only, on a policy that has an endorsement in
// force; the server checks every rule again at the preview and at the confirmation, whatever this
// page shows.
async function CorrectionForm({
  policyId,
  user,
}: {
  policyId: string;
  user: NonNullable<Awaited<ReturnType<typeof currentUser>>>;
}) {
  // Correcting the record is an operations job, never the broker's or the customer's. It is the
  // rule the preview enforces (lib/policy/correct-endorsement-date.ts), said here in the same
  // words so anybody else is sent back to the policy with it instead of reading it on a form
  // they are not allowed to submit.
  if (user.role !== "staff_ops") {
    redirect(
      `/policies/${policyId}?error=${encodeURIComponent("only staff operations can correct the effective date of an endorsement")}`,
    );
  }
  const [policy, schedule] = await Promise.all([policyDetail(policyId), endorsementScheduleOfPolicy(policyId)]);
  if (!policy) {
    notFound();
  }
  const trail = [
    { label: "Policies", href: "/ops/policies" },
    { label: `Policy ${policy.policyNumber}`, href: `/policies/${policyId}` },
    { label: "Correct" },
  ];

  if (schedule.length === 0) {
    return (
      <PortalShell user={user} active="policies" trail={trail}>
        <h1>Correct an endorsement date on policy {policy.policyNumber}</h1>
        <p className="note">
          This policy has no endorsement in force, so there is no effective date to correct. A correction puts right an
          endorsement that was entered with the wrong date.
        </p>
        <Link href={`/policies/${policyId}`} className="button-link secondary">
          Back to the policy
        </Link>
      </PortalShell>
    );
  }

  // The endorsement recorded most recently. The server lets that one be corrected and no other:
  // anything entered after it was priced against it. It is the default selection here; the older
  // ones stay selectable so the refusal comes from the preview, in its own words, rather than
  // from a second copy of the rule on this screen.
  const mostRecentlyRecorded = schedule.reduce((latest, row) => (row.recordedAt > latest.recordedAt ? row : latest));

  return (
    <PortalShell user={user} active="policies" trail={trail}>
      <h1>Correct an endorsement date on policy {policy.policyNumber}</h1>
      <p className="lead">
        Pick the endorsement that was keyed with the wrong effective date and the date it should have carried, inside the
        term ({policy.effectiveAt} to {policy.termEnd}). The next screen shows the exact money the correction moves, line
        by line, before anything is recorded. Nothing is ever deleted: what was booked is reversed and the endorsement is
        re-booked on the corrected date.
      </p>
      <form method="get" action={`/policies/${policyId}/corrections/new`} className="card">
        <label htmlFor="endorsedEventId">Endorsement to correct</label>
        <select id="endorsedEventId" name="endorsedEventId" defaultValue={mostRecentlyRecorded.endorsedEventId}>
          {schedule.map((row) => (
            <option key={row.endorsedEventId} value={row.endorsedEventId}>
              {`Effective ${row.effectiveAt}, recorded ${row.recordedAt.toISOString().slice(0, 10)}: ${row.description || "endorsement"}`}
            </option>
          ))}
        </select>
        <p className="note">
          Only the endorsement recorded most recently can be corrected, and it is the one selected. Any endorsement
          entered after it was priced against it, so that one has to be put right first; the preview refuses the others
          and says so.
        </p>
        <label htmlFor="correctedEffectiveAt">Effective date it should have carried</label>
        <input
          id="correctedEffectiveAt"
          name="correctedEffectiveAt"
          type="date"
          required
          defaultValue={mostRecentlyRecorded.effectiveAt}
          min={policy.effectiveAt}
          max={policy.termEnd}
        />
        <label htmlFor="reason">Why (written on the correction and on every entry)</label>
        <input
          id="reason"
          name="reason"
          required
          minLength={10}
          maxLength={300}
          placeholder="the broker's email asked for June 9, the endorsement was keyed as July 9"
        />
        <button type="submit">Preview the correction</button>
        <Link href={`/policies/${policyId}`} className="button-link secondary">
          Back to the policy
        </Link>
      </form>
    </PortalShell>
  );
}
