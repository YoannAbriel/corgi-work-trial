import Link from "next/link";
import { SandboxReferences } from "@/components/disclosures";
import { Chip } from "@/components/detail-layout";
import { JournalTable } from "@/components/journal-table";
import { About } from "@/components/ui/about";
import { EmptyState } from "@/components/ui/empty";
import { DataTable, FactGrid } from "@/components/ui/table";
import { SubmitButton } from "@/components/ui/submit-button";
import { When } from "@/components/ui/time";
import { formatCentsAsUsd } from "@/lib/money/cents";
import {
  correctionsOfPolicy,
  policyAsItStoodOn,
  policyAsOfSteps,
  policyTimeline,
  type TimelineAudience,
} from "@/lib/policy/correction-read";
import { FormulaLinesTable } from "./formula-lines";

// The four blocks slice B8 adds to a policy: the form that corrects an effective date, what a
// correction did, the whole history of the policy with both of its clocks, and the policy as it
// stood on any business date. The interface system of 2026-09-09 spread them over the views of
// the policy screen: the corrections go with the money, the timeline and the date answer make the
// timeline view, and the dates a policy changed sit beside the documents they rebuild.
//
// They are server components. Every amount arrives already computed in integer cents from the
// events and the journal; nothing here does arithmetic, and no money value is ever computed in
// the browser.

// ---------------------------------------------------------------------------
// The form: correct the effective date of one endorsement
// ---------------------------------------------------------------------------

// Offered on the endorsement in force, to staff operations only. It writes nothing: it opens the
// impact preview, which computes the whole thing with the same pure function the execution uses
// and shows it before anything is recorded.
export function CorrectEndorsementDateForm({
  policyId,
  endorsedEventId,
  effectiveAt,
  termStart,
  termEnd,
}: {
  policyId: string;
  endorsedEventId: string;
  effectiveAt: string;
  termStart: string;
  termEnd: string;
}) {
  return (
    <form method="get" action={`/policies/${policyId}/corrections/new`} className="card">
      <input type="hidden" name="endorsedEventId" value={endorsedEventId} />
      <label htmlFor={`correctedEffectiveAt-${endorsedEventId}`}>Effective date it should have carried</label>
      <input
        id={`correctedEffectiveAt-${endorsedEventId}`}
        name="correctedEffectiveAt"
        type="date"
        required
        defaultValue={effectiveAt}
        min={termStart}
        max={termEnd}
      />
      <label htmlFor={`reason-${endorsedEventId}`}>Why (written on the correction and on every entry)</label>
      <input
        id={`reason-${endorsedEventId}`}
        name="reason"
        required
        minLength={10}
        maxLength={300}
        placeholder="the broker's email asked for June 9, the endorsement was keyed as July 9"
      />
      <button type="submit">Preview the correction</button>
      <p className="pd-note">
        Correcting reverses what was booked and re-books the endorsement on the right date. Nothing is deleted, and the
        money already collected stays exactly where it is.
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Corrections, explained
// ---------------------------------------------------------------------------

export async function CorrectionsExplained({ policyId, canPay, now }: { policyId: string; canPay: boolean; now: Date }) {
  const corrections = await correctionsOfPolicy(policyId);
  if (corrections.length === 0) {
    return null;
  }

  return (
    <>
      {corrections.map((correction) => (
        <section className="card" key={correction.rebookEventId}>
          <h2>
            Correction: {correction.wrongEffectiveAt} to {correction.correctedEffectiveAt}
            {correction.money.settlement === "collect" ? (
              <Chip tone="warn">to collect</Chip>
            ) : correction.money.settlement === "refund" ? (
              <Chip tone="warn">to give back</Chip>
            ) : (
              <Chip tone="ok">no money</Chip>
            )}
          </h2>
          <FactGrid
            items={[
              { label: "What", value: correction.description || "Endorsement" },
              { label: "Recorded", value: <When instant={correction.recordedAt} now={now} mode="utc" /> },
              ...(correction.operatorName ? [{ label: "By", value: correction.operatorName }] : []),
              { label: "Reason", value: correction.reason },
            ]}
          />
          <p className="pd-note">
            The effective dates are business dates in the past; the recording time is when we learned we were wrong.
            Every figure below is the one stored on those events and posted to the journal.
          </p>

          <FormulaLinesTable lines={correction.lines} />

          <JournalTable entries={correction.entries} panelKey="correction" visibleEntries={6} ariaLabel="Correction entries" />
          <p className="pd-note">
            The cash entries of the original endorsement are not in this table on purpose: Stripe really does hold that
            money, so reversing them would make the ledger claim it left. What the correction changes is what the
            customer was billed, and the difference sits in premium receivable until it is settled.
          </p>

          {correction.money.settlement === "collect" && correction.collection ? (
            <>
              <p className={correction.collection.paidOn ? "badge badge-ok" : "badge badge-warn"}>
                {correction.collection.paidOn
                  ? `The difference of ${formatCentsAsUsd(correction.collection.amountCents)} was collected on ${correction.collection.paidOn}`
                  : `${formatCentsAsUsd(correction.collection.amountCents)} still to collect from the customer`}
              </p>
              {!correction.collection.paidOn && correction.collection.customerApprovalRequired && !correction.collection.customerApprovedAt ? (
                <p className="pd-note">
                  The customer has to approve it from their own screen before it can be collected:{" "}
                  {correction.approvalSentences.customer ?? "it is above the customer approval threshold"}.
                </p>
              ) : null}
              {!correction.collection.paidOn && !correction.collection.customerApprovalRequired && correction.approvalSentences.customer ? (
                <p className="pd-note">Customer approval: {correction.approvalSentences.customer}.</p>
              ) : null}
              {!correction.collection.paidOn &&
              canPay &&
              (!correction.collection.customerApprovalRequired || correction.collection.customerApprovedAt) ? (
                <form
                  method="post"
                  action={`/api/policies/${policyId}/corrections/${correction.rebookEventId}/checkout`}
                  className="inline-form"
                >
                  <SubmitButton>
                    {correction.collection.checkoutUrl && !correction.collection.isDead
                      ? "Continue the payment of the difference at Stripe"
                      : `Collect the difference (${formatCentsAsUsd(correction.collection.amountCents)}) with Stripe (test mode)`}
                  </SubmitButton>
                </form>
              ) : null}
            </>
          ) : null}
          {correction.money.settlement === "refund" ? (
            <p className="pd-note">
              The corrected date charges fewer days, so {formatCentsAsUsd(-correction.money.differenceTotalCents)} goes
              back to the customer through Stripe. It is listed under the refunds above, with its state and the approver
              it is waiting for. Second approver: {correction.approvalSentences.refund ?? "read from the refund itself"}.
            </p>
          ) : null}
          {correction.money.settlement === "none" ? (
            <p className="pd-note">The corrected date prices the same amount, so no money moves.</p>
          ) : null}
        </section>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// The timeline: effective time and recorded time, side by side
// ---------------------------------------------------------------------------

// `audience` decides the words, never the rows (review finding F-B13-06). An operator reads the
// reason a colleague typed into a correction; a customer reads the same events, the same two
// dates and the same amounts, without the operator's free text and the internal references it
// carries.
export async function PolicyTimeline({
  policyId,
  now,
  audience = "operator",
}: {
  policyId: string;
  now: Date;
  audience?: TimelineAudience;
}) {
  const rows = await policyTimeline(policyId, undefined, audience);
  if (rows.length === 0) {
    return null;
  }
  return (
    <DataTable ariaLabel="Policy timeline">
      <thead>
        <tr>
          <th className="nowrap">Effective</th>
          <th className="nowrap">Recorded</th>
          <th>Event</th>
          <th>What it says</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.eventId} className="dt-row">
            <td className="nowrap">{row.supersededByEventId ? <s>{row.effectiveAt}</s> : row.effectiveAt}</td>
            <td className="nowrap">
              <When instant={row.recordedAt} now={now} />
            </td>
            <td>
              <Chip tone={row.supersededByEventId ? "neutral" : "ok"}>{row.eventType.replace(/_/g, " ")}</Chip>
            </td>
            <td>
              {row.supersededByEventId ? <s>{row.summary}</s> : row.summary}
              {row.supersededByEventId ? (
                <span className="dt-sub">
                  {audience === "customer"
                    ? "Put right by a later correction: this line no longer counts."
                    : `Superseded by the ${row.supersededByEventType} recorded later (${row.supersededByEventId.slice(0, 8)}).`}
                </span>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

// ---------------------------------------------------------------------------
// The dates a policy changed, and the policy as it stood on one of them
// ---------------------------------------------------------------------------

// Slice B12-3 (YOA-626), decided by Yoann: the dates this policy changed, as links that carry
// ?asOf in the address. Server-rendered on every click, no slider and no state in the browser:
// the page IS the answer for that date, and it can be bookmarked and shown to somebody else.
export async function PolicyChangeSteps({
  policyId,
  termStart,
  today,
  hrefForDate,
  currentDate,
}: {
  policyId: string;
  termStart: string;
  today: string;
  // Where a step goes. The screen owns its address, so it builds the link and this only draws it.
  hrefForDate: (date: string) => string;
  currentDate?: string;
}) {
  const steps = await policyAsOfSteps(policyId, termStart, today);
  return (
    <nav className="as-of-steps pd-steps" aria-label="Dates this policy changed">
      {steps.map((step) => {
        const isCurrent = step.date === currentDate;
        return (
          <Link
            key={step.date}
            href={hrefForDate(step.date)}
            className={isCurrent ? "as-of-step current" : "as-of-step"}
            aria-current={isCurrent ? "date" : undefined}
          >
            <span className="as-of-step-date">{step.date}</span>
            <span className="as-of-step-label">{step.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export async function PolicyAsOf({
  policyId,
  asOf,
  termStart,
  today,
}: {
  policyId: string;
  asOf: string | undefined;
  termStart: string;
  today: string;
}) {
  const requested = asOf ?? "";
  const result = requested ? await policyAsItStoodOn(policyId, requested) : null;
  // The field cannot start on a date it would refuse: on a policy whose term has not begun,
  // today is before the minimum the input accepts, so the term start is the honest default.
  const defaultDate = requested || (today > termStart ? today : termStart);

  return (
    <section className="card pd-form-card" id="as-of">
      <h2>As it stood on a date</h2>
      <form method="get" className="card">
        <label htmlFor="asOf">As it stood on</label>
        <input id="asOf" name="asOf" type="date" required defaultValue={defaultDate} min={termStart} />
        {/* The view is carried with the date, so the answer comes back on this same view. */}
        <input type="hidden" name="view" value="timeline" />
        <button type="submit">Show the policy on that date</button>
      </form>

      {result === null ? (
        <EmptyState illustration="magnifying-glass">
          Pick a date: the policy is rebuilt from the events effective on or before it, superseded events dropped.
        </EmptyState>
      ) : "error" in result ? (
        <p className="error">
          Nothing to show on {result.asOf}: {result.error}
        </p>
      ) : (
        <div className="pd-answer">
          <h3>The policy on {result.asOf}</h3>
          <FactGrid
            items={[
              {
                label: "Status",
                value:
                  result.snapshot.status === "cancelled"
                    ? `cancelled, effective ${result.snapshot.cancelledEffectiveAt}`
                    : "in force",
              },
              { label: "Annual premium", value: formatCentsAsUsd(result.snapshot.annualPremiumCents) },
              {
                label: `${result.snapshot.stateName} tax (${(result.snapshot.taxRateBasisPoints / 100).toFixed(2)}%)`,
                value: formatCentsAsUsd(result.snapshot.taxCents),
              },
              { label: "Policy fee", value: formatCentsAsUsd(result.snapshot.feeCents) },
              { label: "Full annual term", value: formatCentsAsUsd(result.snapshot.totalChargeCents) },
              ...result.snapshot.coverageLines.map((line) => ({
                label: line.name,
                value: formatCentsAsUsd(line.limitCents),
              })),
            ]}
          />

          <DataTable ariaLabel="Written premium segments">
            <thead>
              <tr>
                <th className="nowrap">From</th>
                <th className="nowrap">Recorded</th>
                <th>What</th>
                <th className="num">Written premium</th>
              </tr>
            </thead>
            <tbody>
              <tr className="dt-row">
                <td className="nowrap">{result.snapshot.termStart}</td>
                <td className="nowrap dt-muted">at issuance</td>
                <td>Annual premium written at issuance</td>
                <td className="num">{formatCentsAsUsd(result.snapshot.annualPremiumCentsAtIssuance)}</td>
              </tr>
              {result.snapshot.endorsements.map((endorsement) => (
                <tr className="dt-row" key={`${endorsement.effectiveAt}-${endorsement.recordedAt}`}>
                  <td className="nowrap">{endorsement.effectiveAt}</td>
                  <td className="nowrap">{endorsement.recordedAt.replace("T", " ").slice(0, 19)}</td>
                  <td>{endorsement.description}</td>
                  <td className="num">{formatCentsAsUsd(endorsement.premiumDeltaCents)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>

          <p className="pd-note">
            The same date as a PDF:{" "}
            <Link href={`/api/policies/${policyId}/documents/declarations?asOf=${result.asOf}`}>declarations</Link>
            {" / "}
            <Link href={`/api/policies/${policyId}/documents/endorsement-schedule?asOf=${result.asOf}`}>schedule</Link>.
          </p>
          <About title="About the written premium segments">
            <p>
              Each piece of premium earns over its own window. The issuance premium earns over the whole term; an
              endorsement earns its prorated amount from its own effective date to the end of the term. This is why the
              annual premium in force is not the written premium once a policy has been endorsed.
            </p>
          </About>
        </div>
      )}
    </section>
  );
}
