import "@/app/styles/policy-detail.css";
import { PortalShell } from "@/components/portal-shell";
import { Chip } from "@/components/detail-layout";
import { About } from "@/components/ui/about";
import { EmptyState } from "@/components/ui/empty";
import { Stat, Stats } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable, FactGrid, Num } from "@/components/ui/table";
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
        <PortalShell
          user={user}
          active="policies"
          trail={[
            ...(user.role === "broker" ? [] : [{ label: "Policies", href: "/ops/policies" }]),
            { label: "Policy", href: `/policies/${policyId}` },
            { label: "Correction preview" },
          ]}
          band={{ title: "Correction preview", meta: <Chip tone="warn">refused</Chip> }}
        >
          <div className="notices">
            <p className="error" role="alert">
              {error.message}
            </p>
          </div>
          <Link href={`/policies/${policyId}/corrections/new`} className="button-link secondary">
            Back to the correction form
          </Link>
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
    <PortalShell
      user={user}
      active="policies"
      trail={[
        ...(user.role === "broker" ? [] : [{ label: "Policies", href: "/ops/policies" }]),
        { label: `Policy ${plan.policyNumber}`, href: `/policies/${policyId}` },
        { label: "Correction preview" },
      ]}
      band={{
        title: "Correction preview",
        suffix: `Policy ${plan.policyNumber}`,
        meta: (
          <>
            <Chip tone="warn">nothing recorded yet</Chip>
            <Chip tone="ok">Stripe: LIVE SANDBOX</Chip>
            <Chip tone="neutral">
              {money.wrongEffectiveAt} to {money.correctedEffectiveAt}
            </Chip>
          </>
        ),
      }}
    >
      <Stats>
        <Stat label="Booked" value={formatCentsAsUsd(money.before.deltaTotalCents)} note={`for ${money.before.daysRemaining} days`} />
        <Stat
          label="Corrected"
          value={formatCentsAsUsd(money.after.deltaTotalCents)}
          note={`for ${money.after.daysRemaining} of ${money.after.termDays} days`}
        />
        <Stat label="Difference" tone="accent" value={formatCentsAsUsd(money.differenceTotalCents)} note={money.settlement} />
      </Stats>

      <div className="layout-2">
        <div className="stack">
          <section className="card">
            <h2>What changes</h2>
            <FactGrid
              items={[
                { label: "Endorsement", value: plan.description },
                { label: "Effective date", value: `${money.wrongEffectiveAt} to ${money.correctedEffectiveAt}` },
                { label: "Reason on every entry", value: plan.reason },
              ]}
            />
          </section>

          <section className="card">
            <h2>Impact, line by line</h2>
            <p className="pd-note">{direction}. Each line shows the integer-cent formula that produced it.</p>
            <FormulaLinesTable lines={plan.lines} />
          </section>

          <DataTable ariaLabel="Entries that will be reversed">
            <thead>
              <tr>
                <th>Entry</th>
                <th className="nowrap">Effective</th>
                <th className="nowrap">Recorded (UTC)</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {plan.entriesToReverse.map((entry) => (
                <tr key={entry.entryId} className="dt-row">
                  <td>
                    <Chip tone="neutral">{entry.entryType.replace(/_/g, " ")}</Chip>
                  </td>
                  <td className="nowrap">{entry.effectiveAt}</td>
                  <td className="nowrap">{entry.recordedAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                  <Num>{formatCentsAsUsd(entry.amountCents)}</Num>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>

        <section className="card pd-form-card">
          <h2>Confirm</h2>
          <p className="pd-note">
            In one transaction: a dated correction event superseding the endorsement that was wrong, one reversal entry
            per line beside, the endorsement re-booked on {money.correctedEffectiveAt} with fresh premium and tax
            entries, and the difference opened as a money operation. Nothing is deleted and nothing is updated.
            {money.settlement === "collect"
              ? ` The ${formatCentsAsUsd(money.differenceTotalCents)} difference is then collected through a hosted Stripe page.`
              : money.settlement === "refund"
                ? ` The ${formatCentsAsUsd(-money.differenceTotalCents)} goes back through the Stripe Refunds API on the original payment.`
                : ""}
          </p>
          {/* The verdict on each threshold, always with the total it was read against: both are
              cumulative over the policy, so the amount of this correction alone does not answer
              them (review finding F-B8-02). */}
          {plan.approvalSentences.customer ? <p className="pd-note">Customer approval: {plan.approvalSentences.customer}.</p> : null}
          {plan.approvalSentences.refund ? <p className="pd-note">Second approver: {plan.approvalSentences.refund}.</p> : null}

          <form method="post" action={`/api/policies/${policyId}/corrections`} className="card">
            <input type="hidden" name="endorsedEventId" value={plan.correctedEventId} />
            <input type="hidden" name="correctedEffectiveAt" value={money.correctedEffectiveAt} />
            <input type="hidden" name="reason" value={plan.reason} />
            {/* The policy as it stood when this preview was computed. The server recomputes it
                under a lock and refuses the confirmation if the policy changed in between. */}
            <input type="hidden" name="expectedPolicyVersion" value={String(plan.policyVersion)} />
            <SubmitButton>
              Correct the effective date to {money.correctedEffectiveAt}
              {money.settlement === "collect"
                ? ` and ask for ${formatCentsAsUsd(money.differenceTotalCents)}`
                : money.settlement === "refund"
                  ? ` and give back ${formatCentsAsUsd(-money.differenceTotalCents)}`
                  : ""}
            </SubmitButton>
          </form>
        </section>
      </div>

      <About>
        <h4>Only what was billed is reversed</h4>
        <p>
          The cash entries stay exactly as they are: Stripe really does hold that money, and reversing them would make
          the ledger claim it left. What the correction changes is what the customer was billed, and the difference sits
          in premium receivable until it is settled.
        </p>
        <h4>Nothing is deleted</h4>
        <p>
          The originals stay in the journal for ever; a mirrored entry is appended beside each of them, on the same
          effective date, recorded now.
        </p>
        <h4>Re-priced from the corrected date</h4>
        <p>
          The endorsement is priced again from the corrected effective date with every other input unchanged, so a
          correction can never quietly re-price a policy at today&apos;s rates.
        </p>
      </About>
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
  const band = {
    title: "Correct a date",
    suffix: `Policy ${policy.policyNumber}`,
    meta: (
      <>
        <Chip tone="ok">Stripe: LIVE SANDBOX</Chip>
        <Chip tone="neutral">
          term {policy.effectiveAt} to {policy.termEnd}
        </Chip>
      </>
    ),
  };

  if (schedule.length === 0) {
    return (
      <PortalShell user={user} active="policies" trail={trail} band={band}>
        <EmptyState
          illustration="closed-folder"
          action={
            <Link href={`/policies/${policyId}`} className="button-link secondary">
              Back to the policy
            </Link>
          }
        >
          This policy has no endorsement in force, so there is no effective date to correct.
        </EmptyState>
      </PortalShell>
    );
  }

  // The endorsement recorded most recently. The server lets that one be corrected and no other:
  // anything entered after it was priced against it. It is the default selection here; the older
  // ones stay selectable so the refusal comes from the preview, in its own words, rather than
  // from a second copy of the rule on this screen.
  const mostRecentlyRecorded = schedule.reduce((latest, row) => (row.recordedAt > latest.recordedAt ? row : latest));

  return (
    <PortalShell user={user} active="policies" trail={trail} band={band}>
      <div className="layout-2">
        <section className="card pd-form-card">
          <h2>The date it should have carried</h2>
          <form method="get" action={`/policies/${policyId}/corrections/new`} className="card">
            <label htmlFor="endorsedEventId">Endorsement to correct</label>
            <select id="endorsedEventId" name="endorsedEventId" defaultValue={mostRecentlyRecorded.endorsedEventId}>
              {schedule.map((row) => (
                <option key={row.endorsedEventId} value={row.endorsedEventId}>
                  {`Effective ${row.effectiveAt}, recorded ${row.recordedAt.toISOString().slice(0, 10)}: ${row.description || "endorsement"}`}
                </option>
              ))}
            </select>
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
          </form>
        </section>

        <section className="card">
          <h2>The endorsement in force</h2>
          <FactGrid
            items={[
              { label: "Effective", value: mostRecentlyRecorded.effectiveAt },
              { label: "Recorded", value: mostRecentlyRecorded.recordedAt.toISOString().slice(0, 10) },
              { label: "Prorated delta", value: formatCentsAsUsd(mostRecentlyRecorded.figures.deltaTotalCents) },
              { label: "Annual premium after it", value: formatCentsAsUsd(mostRecentlyRecorded.figures.newAnnualPremiumCents) },
            ]}
          />
          <p className="pd-note">
            Only the endorsement recorded most recently can be corrected. Any endorsement entered after it was priced
            against it, so that one has to be put right first; the preview refuses the others and says so.
          </p>
        </section>
      </div>

      <About>
        <h4>What the next screen shows</h4>
        <p>
          The exact money the correction moves, line by line, before anything is recorded. Nothing is ever deleted: what
          was booked is reversed and the endorsement is re-booked on the corrected date.
        </p>
        <h4>Inside the term</h4>
        <p>
          The corrected date has to be inside the term ({policy.effectiveAt} to {policy.termEnd}); the preview refuses
          anything else and says why.
        </p>
      </About>
    </PortalShell>
  );
}
