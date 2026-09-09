import "@/app/styles/policy-detail.css";
import "@/app/styles/signed.css";
import { PortalShell } from "@/components/portal-shell";
import { Chip } from "@/components/detail-layout";
import { formatSignedCentsAsUsd, formatSignedDays, signedArrow, signedTone } from "@/components/signed";
import { About } from "@/components/ui/about";
import { EmptyState } from "@/components/ui/empty";
import { Legend } from "@/components/ui/legend";
import { Stat, Stats } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable, FactGrid, Num } from "@/components/ui/table";
import { Toolbar, ToolbarGroup } from "@/components/ui/toolbar";
import Link from "next/link";
import { Fragment } from "react";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/http/path-ids";
import { formatCentsAsUsd } from "@/lib/money/cents";
import type { EndorsementDateCorrection } from "@/lib/money/correction";
import { CorrectionRefused, planEndorsementDateCorrection } from "@/lib/policy/correct-endorsement-date";
import { endorsementScheduleOfPolicy } from "@/lib/policy/endorsement-read";
import { policyDetail } from "@/lib/policy/read";
import { policyFormViews } from "../../correction-sections";
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
          views={policyFormViews({ policyId, formLabel: "Correct", formHref: `/policies/${policyId}/corrections/new` })}
          band={{ title: "Correction preview", status: <Chip tone="warn">refused</Chip> }}
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
      views={policyFormViews({ policyId, formLabel: "Correct", formHref: `/policies/${policyId}/corrections/new` })}
      band={{
        title: "Correction preview",
        suffix: `Policy ${plan.policyNumber}`,
        // ONE chip, the state of this preview: nothing is booked until the form below is sent
        // (Yoann, 2026-09-09). The two dates are figures of the preview and are in the panel.
        status: <Chip tone="warn">nothing recorded yet</Chip>,
      }}
    >
      <Stats>
        <Stat label="Booked" value={formatCentsAsUsd(money.before.deltaTotalCents)} note={`${money.before.daysRemaining} days`} />
        <Stat
          label="Corrected"
          value={formatCentsAsUsd(money.after.deltaTotalCents)}
          note={`${money.after.daysRemaining} of ${money.after.termDays} days`}
        />
        {/* The one tile that carries a direction (Yoann, 2026-09-09): green and a plus when the
            customer owes more, red and a minus when money goes back, with the arrow saying it
            again for a reader who does not separate the two colours. The settlement word stays
            the note, followed by the movement in days, which is the two counts above subtracted
            and nothing else. */}
        <Stat
          label="Difference"
          tone={signedTone(money.differenceTotalCents)}
          valueIcon={signedArrow(money.differenceTotalCents)}
          value={formatSignedCentsAsUsd(money.differenceTotalCents)}
          note={`${money.settlement}, ${formatSignedDays(money.after.daysRemaining - money.before.daysRemaining)}`}
        />
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
            <p className="pd-note">{direction}.</p>
            {/* The three differences carry the direction; the two lines they are read against step
                back into the secondary ink. The broker commission line is neither: it is the
                broker's money, not the customer's, so it stays in the ordinary ink rather than
                borrowing a convention that speaks about what the customer owes. */}
            <FormulaLinesTable
              lines={plan.lines}
              // The bold row of THIS table is the correction's own total. The default key is the
              // endorsement's delta, which no correction line carries, so before this the table
              // ended without a total in bold.
              highlightKey="difference_total"
              signedKeys={["premium_difference", "tax_difference", "difference_total"]}
              referenceKeys={["premium_as_booked", "premium_corrected"]}
            />
          </section>

          {/* The mechanism, named in the title and shown as two rows per entry: what stops being
              what the customer was billed, and what is booked in its place on the corrected date.
              The re-booked figures are the corrected premium and the corrected tax, the same two
              the execution posts (lib/policy/correct-endorsement-date.ts, step 4). */}
          <DataTable
            ariaLabel="Entries reversed and re-booked by the correction"
            toolbar={
              <Toolbar>
                <ToolbarGroup>
                  <span className="toolbar-label">Reversal, then re-book on {money.correctedEffectiveAt}</span>
                </ToolbarGroup>
              </Toolbar>
            }
            legend={
              <Legend
                items={[
                  { term: "reversed", meaning: "a mirrored entry is appended beside the original, on the same effective date; nothing is deleted" },
                  { term: "re-booked", meaning: "the preview of the entry the correction will post on the corrected date; it does not exist yet" },
                ]}
              />
            }
          >
            <thead>
              <tr>
                <th>Entry</th>
                <th className="nowrap">Effective</th>
                <th className="nowrap">Recorded (UTC)</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {plan.entriesToReverse.map((entry) => {
                const rebookedCents = rebookedAmountCents(entry.entryType, money);
                return (
                  <Fragment key={entry.entryId}>
                    <tr className="dt-row will-be-reversed">
                      <td>
                        <span className="entry-move">
                          <Chip tone="neutral">{entry.entryType.replace(/_/g, " ")}</Chip>
                          <Chip tone="danger">reversed</Chip>
                        </span>
                      </td>
                      <td className="nowrap">{entry.effectiveAt}</td>
                      <td className="nowrap">{entry.recordedAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                      <Num>{formatCentsAsUsd(entry.amountCents)}</Num>
                    </tr>
                    {rebookedCents === null ? null : (
                      <tr className="dt-row rebook-preview">
                        <td>
                          <span className="entry-move">
                            <Chip tone="neutral">{entry.entryType.replace(/_/g, " ")}</Chip>
                            <Chip tone="ok">re-booked</Chip>
                          </span>
                        </td>
                        <td className="nowrap">{money.correctedEffectiveAt}</td>
                        <td className="nowrap">nothing recorded yet</td>
                        <Num>{formatCentsAsUsd(rebookedCents)}</Num>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
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
            {/* Three words (cycle 2, decision 8): the two dates are the band's chip, the
                difference is the tile above, and the paragraph beside says what is written. */}
            <SubmitButton>Correct the date</SubmitButton>
          </form>
        </section>
      </div>

      <About>
        <h4>Every line is integer-cent arithmetic</h4>
        <p>Each line of the table shows the formula in integer cents that produced its amount.</p>
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

// What the correction will book on the corrected date in place of an entry it reverses.
//
// NO FIGURE IS INVENTED HERE. The execution posts exactly two entries on the corrected date
// (lib/policy/correct-endorsement-date.ts, step 4): the premium and the tax priced at that date,
// which are `money.after.deltaPremiumCents` and `money.after.deltaTaxCents`, the same two figures
// the "Corrected" column of this page already prints. Any other entry type gets null, so its row
// has no preview beside it rather than an amount this screen made up.
function rebookedAmountCents(entryType: string, money: EndorsementDateCorrection): number | null {
  if (entryType === "endorsement_premium_written") {
    return money.after.deltaPremiumCents;
  }
  if (entryType === "endorsement_tax_billed") {
    return money.after.deltaTaxCents;
  }
  return null;
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
  // The policy's own navigation stays open while the form is (cycle 2, decision 17).
  const views = policyFormViews({ policyId, formLabel: "Correct", formHref: `/policies/${policyId}/corrections/new` });
  const band = {
    title: "Correct a date",
    suffix: `Policy ${policy.policyNumber}`,
    // No chip: a form screen has no state of its own, and the term is printed in the form below
    // (Yoann, 2026-09-09).
  };

  if (schedule.length === 0) {
    return (
      <PortalShell user={user} active="policies" trail={trail} views={views} band={band}>
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
    <PortalShell user={user} active="policies" trail={trail} views={views} band={band}>
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
        </section>
      </div>

      <About>
        <h4>Only the last endorsement</h4>
        <p>
          Only the endorsement recorded most recently can be corrected. Any endorsement entered after it was priced
          against it, so that one has to be put right first; the preview refuses the others and says so.
        </p>
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
