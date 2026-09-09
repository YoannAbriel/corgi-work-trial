import Link from "next/link";
import { Disclosure } from "@/components/disclosures";
import { Empty, Panel } from "@/components/detail-layout";
import { JournalTable } from "@/components/journal-table";
import { formatCentsAsUsd } from "@/lib/money/cents";
import {
  correctionsOfPolicy,
  policyAsItStoodOn,
  policyAsOfSteps,
  policyTimeline,
  type TimelineAudience,
} from "@/lib/policy/correction-read";
import { FormulaLinesTable } from "./formula-lines";

// The three screens slice B8 adds to a policy: what a correction did, the whole history of the
// policy with both of its clocks, and the policy as it stood on any business date.
//
// They are server components. Every amount arrives already computed in integer cents from the
// events and the journal; nothing here does arithmetic, and no money value is ever computed in
// the browser.

// ---------------------------------------------------------------------------
// The form: correct the effective date of one endorsement
// ---------------------------------------------------------------------------

// Offered on each endorsement in force, to staff operations only. It writes nothing: it opens the
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
      <p className="note">
        Entered with the wrong effective date? Correcting it reverses what was booked and re-books the endorsement on the
        right date. Nothing is deleted, and the money already collected stays exactly where it is.
      </p>
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
    </form>
  );
}

// ---------------------------------------------------------------------------
// Corrections, explained
// ---------------------------------------------------------------------------

export async function CorrectionsExplained({ policyId, canPay }: { policyId: string; canPay: boolean }) {
  const corrections = await correctionsOfPolicy(policyId);
  if (corrections.length === 0) {
    return null;
  }

  return (
    <Panel title="Corrections">
      <Disclosure>
        <p>
          A correction never changes a row. It appends a dated correction event that supersedes the wrong one, reversal
          entries that mirror the originals on the same effective date, and a re-booked endorsement on the corrected date.
          Every figure below is the one stored on those events and posted to the journal; none of it is recomputed here.
        </p>
      </Disclosure>
      {corrections.map((correction) => (
        <div key={correction.rebookEventId}>
          <h3>
            {correction.description || "Endorsement"}: effective date {correction.wrongEffectiveAt} corrected to{" "}
            {correction.correctedEffectiveAt}
          </h3>
          <p className="note">
            Recorded {correction.recordedAt.toISOString().replace("T", " ").slice(0, 19)} UTC
            {correction.operatorName ? ` by ${correction.operatorName}` : ""}. Reason: {correction.reason}. The effective
            dates are business dates in the past; the recording time above is when we learned we were wrong.
          </p>

          <FormulaLinesTable lines={correction.lines} />

          <h4>The entries it posted</h4>
          <JournalTable entries={correction.entries} panelKey="correction" visibleEntries={6} ariaLabel="Correction entries" />
          <p className="note">
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
                <p className="note">
                  The customer has to approve it from their own screen before it can be collected:{" "}
                  {correction.approvalSentences.customer ?? "it is above the customer approval threshold"}.
                </p>
              ) : null}
              {!correction.collection.paidOn && !correction.collection.customerApprovalRequired && correction.approvalSentences.customer ? (
                <p className="note">Customer approval: {correction.approvalSentences.customer}.</p>
              ) : null}
              {!correction.collection.paidOn &&
              canPay &&
              (!correction.collection.customerApprovalRequired || correction.collection.customerApprovedAt) ? (
                <form
                  method="post"
                  action={`/api/policies/${policyId}/corrections/${correction.rebookEventId}/checkout`}
                  className="inline-form"
                >
                  <button type="submit">
                    {correction.collection.checkoutUrl && !correction.collection.isDead
                      ? "Continue the payment of the difference at Stripe"
                      : `Collect the difference (${formatCentsAsUsd(correction.collection.amountCents)}) with Stripe (test mode)`}
                  </button>
                </form>
              ) : null}
            </>
          ) : null}
          {correction.money.settlement === "refund" ? (
            <p className="note">
              The corrected date charges fewer days, so {formatCentsAsUsd(-correction.money.differenceTotalCents)} goes
              back to the customer through Stripe. It is listed under Refunds above, with its state and the approver it
              is waiting for. Second approver: {correction.approvalSentences.refund ?? "read from the refund itself"}.
            </p>
          ) : null}
          {correction.money.settlement === "none" ? (
            <p className="note">The corrected date prices the same amount, so no money moves.</p>
          ) : null}
        </div>
      ))}
    </Panel>
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
  audience = "operator",
}: {
  policyId: string;
  audience?: TimelineAudience;
}) {
  const rows = await policyTimeline(policyId, undefined, audience);
  if (rows.length === 0) {
    return null;
  }
  return (
    <Panel title="Timeline">
      <div className="table-scroll" role="region" aria-label="Policy timeline" tabIndex={0}>
<table>
        <thead>
          <tr>
            <th>Effective</th>
            <th>Recorded (UTC)</th>
            <th>Event</th>
            <th>What it says</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.eventId}>
              <td>{row.supersededByEventId ? <s>{row.effectiveAt}</s> : row.effectiveAt}</td>
              <td>{row.recordedAt.toISOString().replace("T", " ").slice(0, 19)}</td>
              <td>{row.supersededByEventId ? <s>{row.eventType}</s> : row.eventType}</td>
              <td>
                {row.supersededByEventId ? <s>{row.summary}</s> : row.summary}
                {row.supersededByEventId ? (
                  <>
                    <br />
                    <span className="note">
                      {audience === "customer" ? (
                        "Put right by a later correction: this line no longer counts, and the corrected one is below."
                      ) : (
                        <>
                          Superseded by the {row.supersededByEventType} recorded later (
                          {row.supersededByEventId.slice(0, 8)}): the row stays in the table, the fold no longer applies
                          it.
                        </>
                      )}
                    </span>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
</div>
      <Disclosure title="Two clocks, never merged">
        <p>
          <strong>Effective</strong> is the business date the fact applies from: it is what prices the money, and it can
          be in the past or in the future. <strong>Recorded</strong> is the instant the row was written, set by the
          database and never by a client: it is what answers &quot;what did we know that day&quot;. A backdated
          correction has an old effective date and a recording time of today, which is exactly what makes a closed month
          reproducible. A struck-through row was superseded by a correction: it stays in the table, the fold no longer
          applies it.
        </p>
      </Disclosure>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// The policy as it stood on a date
// ---------------------------------------------------------------------------

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
  const [result, steps] = await Promise.all([
    requested ? policyAsItStoodOn(policyId, requested) : Promise.resolve(null),
    policyAsOfSteps(policyId, termStart, today),
  ]);
  // The field cannot start on a date it would refuse: on a policy whose term has not begun,
  // today is before the minimum the input accepts, so the term start is the honest default.
  const defaultDate = requested || (today > termStart ? today : termStart);

  return (
    <Panel title="As it stood on a date">
      {/* Where the step links land when they are followed from further down the page. */}
      <span id="as-of" aria-hidden="true" />

      {/* Slice B12-3 (YOA-626), decided by Yoann: the dates this policy changed, as links that
          carry ?asOf in the address. Server-rendered on every click, no slider and no state in
          the browser: the page IS the answer for that date, and it can be bookmarked and shown
          to somebody else. */}
      <nav className="as-of-steps" aria-label="Dates this policy changed">
        {steps.map((step) => {
          const isCurrent = step.date === requested;
          return (
            <Link
              key={step.date}
              href={`/policies/${policyId}?asOf=${step.date}#as-of`}
              className={isCurrent ? "as-of-step current" : "as-of-step"}
              aria-current={isCurrent ? "date" : undefined}
            >
              <span className="as-of-step-date">{step.date}</span>
              <span className="as-of-step-label">{step.label}</span>
            </Link>
          );
        })}
      </nav>
      <p className="note">
        The term start, every change still in force, and today. A change that a correction put
        right is not a step: the timeline above strikes it through, and the fold no longer applies
        it. Any other date can be typed below.
      </p>

      <form method="get" className="card">
        <label htmlFor="asOf">As it stood on</label>
        <input id="asOf" name="asOf" type="date" required defaultValue={defaultDate} min={termStart} />
        <button type="submit">Show the policy on that date</button>
      </form>

      {result === null ? (
        <Empty>Pick a date: the page rebuilds the policy from the events effective on or before it, superseded events dropped. Between two endorsements this is the premium and the limits really in force that day.</Empty>
      ) : "error" in result ? (
        <p className="error">Nothing to show on {result.asOf}: {result.error}</p>
      ) : (
        <>
          <h3>{result.asOf}</h3>
          <div className="table-scroll" role="region" aria-label="The policy on that date" tabIndex={0}>
<table className="amounts">
            <tbody>
              <tr>
                <th>Status on that date</th>
                <td className="amount">
                  {result.snapshot.status === "cancelled"
                    ? `cancelled, effective ${result.snapshot.cancelledEffectiveAt}`
                    : "in force"}
                </td>
              </tr>
              <tr>
                <th>Annual premium in force</th>
                <td className="amount">{formatCentsAsUsd(result.snapshot.annualPremiumCents)}</td>
              </tr>
              <tr>
                <th>
                  {result.snapshot.stateName} premium tax on it ({(result.snapshot.taxRateBasisPoints / 100).toFixed(2)}%)
                </th>
                <td className="amount">{formatCentsAsUsd(result.snapshot.taxCents)}</td>
              </tr>
              <tr>
                <th>Policy fee (charged at issuance only)</th>
                <td className="amount">{formatCentsAsUsd(result.snapshot.feeCents)}</td>
              </tr>
              <tr className="total">
                <th>Total for a full annual term at those terms</th>
                <td className="amount">{formatCentsAsUsd(result.snapshot.totalChargeCents)}</td>
              </tr>
            </tbody>
          </table>
</div>

          <h4>Limits in force on {result.asOf}</h4>
          <div className="table-scroll" role="region" aria-label="Limits in force on that date" tabIndex={0}>
<table className="amounts">
            <tbody>
              {result.snapshot.coverageLines.map((line) => (
                <tr key={line.name}>
                  <th>{line.name}</th>
                  <td className="amount">{formatCentsAsUsd(line.limitCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
</div>

          <h4>Written premium segments earning on {result.asOf}</h4>
          <p className="note">
            Each piece of premium earns over its own window. The issuance premium earns over the whole term; an
            endorsement earns its prorated amount from its own effective date to the end of the term. This is why the
            annual premium in force is not the written premium once a policy has been endorsed.
          </p>
          <div className="table-scroll" role="region" aria-label="Written premium segments" tabIndex={0}>
<table>
            <thead>
              <tr>
                <th>From</th>
                <th>Recorded (UTC)</th>
                <th>What</th>
                <th className="amount">Written premium</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{result.snapshot.termStart}</td>
                <td className="note">at issuance</td>
                <td>Annual premium written at issuance</td>
                <td className="amount">{formatCentsAsUsd(result.snapshot.annualPremiumCentsAtIssuance)}</td>
              </tr>
              {result.snapshot.endorsements.map((endorsement) => (
                <tr key={`${endorsement.effectiveAt}-${endorsement.recordedAt}`}>
                  <td>{endorsement.effectiveAt}</td>
                  <td>{endorsement.recordedAt.replace("T", " ").slice(0, 19)}</td>
                  <td>{endorsement.description}</td>
                  <td className="amount">{formatCentsAsUsd(endorsement.premiumDeltaCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
</div>
          <p className="note">
            The same date as a PDF:{" "}
            <Link href={`/api/policies/${policyId}/documents/declarations?asOf=${result.asOf}`}>declarations</Link>
            {" / "}
            <Link href={`/api/policies/${policyId}/documents/endorsement-schedule?asOf=${result.asOf}`}>schedule</Link>.
          </p>
        </>
      )}
    </Panel>
  );
}
