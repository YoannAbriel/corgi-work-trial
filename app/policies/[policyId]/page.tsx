import { PortalShell } from "@/components/portal-shell";
import { Disclosure, RowActions, SandboxReferences } from "@/components/disclosures";
import { AsideList, Chip, DetailGrid, DetailHeading, Empty, Facts, Panel } from "@/components/detail-layout";
import { JournalTable } from "@/components/journal-table";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { bindingIsAllowed } from "@/lib/broker/eligibility";
import { brokerKybState, KYB_NOT_LIVE_LABEL } from "@/lib/broker/kyb";
import { claimsWithPositions } from "@/lib/claims/read";
import { isUuid } from "@/lib/http/path-ids";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { CUSTOMER_APPROVAL_THRESHOLD_CENTS } from "@/lib/money/endorsement";
import { endorsementScheduleOfPolicy, endorsementsOfPolicy, type EndorsementView } from "@/lib/policy/endorsement-read";
import {
  cancellationOfPolicy,
  checkoutOperationOfPolicy,
  journalEntriesOfPolicy,
  policyDetail,
  refundOperationsOfPolicy,
  voidCorrectionOfPolicy,
  type JournalEntryView,
  type RefundOperationView,
} from "@/lib/policy/read";
import {
  CorrectEndorsementDateForm,
  CorrectionsExplained,
  PolicyAsOf,
  PolicyTimeline,
} from "./correction-sections";
import { FormulaLinesTable } from "./formula-lines";

// One policy: what it costs, where it stands, and every journal entry it produced.
//
// Layout (rebuilt with Yoann on 2026-09-08, YOA-633): an identity band with the actions as
// buttons, then two columns. Left: the terms in force, the endorsement schedule, the
// cancellation, the refunds, the claims, the corrections, the policy as it stood on a date, the
// timeline and the journal, each a titled panel holding a table. Right: what the ledger says so
// far, the documents, and the explanations under a fold. The forms that start a change live on
// their own pages (endorse, cancel, open a claim); the server checks every rule again there and
// again on submit, so what this page shows or hides is never the control.
//
// The ledger table is still the point of the page: the amounts shown at the top must be
// findable, line by line, in the entries below.
export default async function PolicyPage({
  params,
  searchParams,
}: {
  params: Promise<{ policyId: string }>;
  searchParams: Promise<{
    error?: string;
    payment?: string;
    cancelled?: string;
    reissued?: string;
    refundSent?: string;
    bound?: string;
    endorsement?: string;
    // Slice B8: the outcome of a backdated correction, and the date the "as it stood on" panel
    // rebuilds the policy for.
    correction?: string;
    asOf?: string;
  }>;
}) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }

  const { policyId } = await params;
  if (!isUuid(policyId)) notFound(); // a malformed id is an unknown policy, not a 500 (F-B7-07)
  const policy = await policyDetail(policyId);
  if (!policy) {
    notFound();
  }

  // Ownership, checked on the server for every visit: a broker sees their own policies, staff
  // can read any policy, the customer has their own screens under /customer, nobody else gets in.
  const isOwningBroker = user.role === "broker" && user.brokerId === policy.brokerId;
  const isStaff = user.role === "staff_ops" || user.role === "staff_approver";
  if (!isOwningBroker && !isStaff) {
    redirect(user.role === "customer" ? "/customer" : "/broker");
  }

  const [kyb, operation, entries, cancellation, refunds, voidCorrection, endorsements, schedule, claims, query] =
    await Promise.all([
      brokerKybState(policy.brokerId),
      checkoutOperationOfPolicy(policyId),
      journalEntriesOfPolicy(policyId),
      cancellationOfPolicy(policyId),
      refundOperationsOfPolicy(policyId),
      voidCorrectionOfPolicy(policyId),
      endorsementsOfPolicy(policyId),
      endorsementScheduleOfPolicy(policyId),
      // Slice B7: the claims of this policy, each with the reserve and the incurred amount folded
      // from its own events.
      claimsWithPositions(sql, policyId),
      searchParams,
    ]);

  // Two different questions, kept apart on purpose. The first is about this policy, the second
  // is about the broker behind it; the server asks both again when the button is pressed and
  // again when Stripe confirms the payment, so hiding or disabling a button is never the
  // control, only the explanation.
  // A policy whose money arrived but whose binding was refused (paid_not_bound) is not
  // payable either: its cash sits in the suspense account and staff apply it, so offering the
  // broker a second payment would collect the premium twice (review finding F-B3-07).
  const policyCanBePaid =
    isOwningBroker &&
    policy.status !== "bound" &&
    policy.status !== "cancelled" &&
    policy.status !== "voided" &&
    policy.status !== "paid_not_bound";
  const brokerMayBind = bindingIsAllowed(kyb.status);
  // Cancelling and endorsing are the owning broker's or staff operations' decisions. The same
  // checks run again on the server when the preview is computed and when the action is
  // confirmed, so hiding a button is a convenience, never the control.
  const canChange = (isOwningBroker || user.role === "staff_ops") && policy.status === "bound";
  const canOpenClaim = user.role === "staff_ops" && (policy.status === "bound" || policy.status === "cancelled");
  const today = new Date().toISOString().slice(0, 10);
  // A date field cannot start on a date it would refuse: on a policy whose term has not begun,
  // today is before the minimum, so the term start is the honest default (F-B8-07, F-B8-09).
  const documentDate = today > policy.effectiveAt ? today : policy.effectiveAt;
  const liveEndorsement = endorsements.find(
    (endorsement) => endorsement.standing.state === "awaiting_approval" || endorsement.standing.state === "approved",
  );
  const historicalRequests = endorsements.filter((endorsement) => endorsement.standing.state === "superseded");
  // Slice B7: an open claim survives a cancellation untouched, which is the live-fire question,
  // so the explanation sits next to the cancellation amounts it explains.
  const openClaims = claims.filter((claim) => !claim.position.isClosed);
  const openClaimReserveCents = openClaims.reduce((total, claim) => total + claim.position.reserveCents, 0);
  const ledger = ledgerSoFar(entries);

  const notices = [
    query.error ? <p key="error" className="error" role="alert">{query.error}</p> : null,
    query.payment === "returned" ? (
      <p key="returned" className="note" role="status">
        You came back from the Stripe hosted page. The policy is bound when Stripe&apos;s webhook confirms the payment,
        not when the browser returns: refresh in a moment if the status is still awaiting payment.
      </p>
    ) : null,
    query.payment === "cancelled" ? <p key="left" className="note" role="status">The payment page was left without paying.</p> : null,
    query.cancelled ? <p key="cancelled" className="note" role="status">{cancellationRefundNotice(refunds)}</p> : null,
    query.reissued ? (
      <p key="reissued" className="note">
        {query.reissued === "queued_for_approval"
          ? "A new refund attempt was raised and waits for a distinct approver (/ops/approvals); nothing was sent."
          : query.reissued === "refused"
            ? "The refund was not sent: the maker-checker gate refused it (see the reason on the refund line)."
            : `A new refund was re-issued: Stripe answered ${query.reissued}.`}
      </p>
    ) : null,
    query.refundSent ? <p key="sent" className="note">The refund was sent to Stripe: {query.refundSent}.</p> : null,
    query.bound === "1" ? (
      <p key="bound" className="note" role="status">The policy is now bound and the four issuance entries are in the journal.</p>
    ) : null,
    query.bound === "already" ? (
      <p key="already" className="note" role="status">This policy was already bound; nothing was posted a second time.</p>
    ) : null,
    query.endorsement ? <p key="endorsement" className="note">{endorsementNotice(query.endorsement)}</p> : null,
    query.correction ? <p key="correction" className="note">{correctionNotice(query.correction)}</p> : null,
    policy.status === "voided" && voidCorrection ? (
      // The issuance and its four entries are still in the database; the fold no longer applies
      // them, and the reversal entries are visible in the journal.
      <div key="voided" className="error" role="alert">
        Voided by a correction on {voidCorrection.recordedAt.toISOString().replace("T", " ").slice(0, 19)} UTC:{" "}
        {voidCorrection.reason}.{" "}
        {voidCorrection.reversedEntryCount > 0 ? `${voidCorrection.reversedEntryCount} entries were reversed. ` : ""}
        Nothing was deleted: the original entries and their reversals are both in the journal, and this policy can no
        longer be paid. A replacement needs a new draft.
        <SandboxReferences references={[{ label: "Correction event id", value: voidCorrection.correctionEventId }]} />
      </div>
    ) : null,
    operation?.bindingRefusedReason ? (
      <p key="refused" className="error" role="alert">
        Paid, binding refused: {operation.bindingRefusedReason}. The customer&apos;s money arrived at Stripe and is
        journaled in the suspense account unapplied_customer_cash (entry unapplied_cash_received in the journal), but
        the policy is NOT bound. Binding it applies that cash to premium, tax and fee; a broker who fails for good means
        the money goes back to the customer.
        {user.role === "staff_ops" ? "" : " Staff operations can bind this policy once the broker's verification passes."}
      </p>
    ) : null,
    policyCanBePaid && !brokerMayBind ? (
      // The server refuses the same request anyway (lib/payments/checkout.ts and again at binding
      // time), so this is the explanation, not the guard.
      <p key="blocked" className="note">
        Payment is blocked while the broker is not approved. {kyb.explanation}
        {isOwningBroker ? (
          <>
            {" "}
            <Link href="/broker/kyb">Submit or check the business verification</Link>.
          </>
        ) : null}
      </p>
    ) : null,
  ].filter(Boolean);

  const statusTone = policy.status === "bound" ? "ok" : policy.status === "cancelled" || policy.status === "voided" ? "warn" : "neutral";

  return (
    <PortalShell active="policies" user={user} trail={[
      ...(isOwningBroker ? [] : [{ label: "Policies", href: "/ops/policies" }]),
      { label: `Policy ${policy.policyNumber}` },
    ]}>
      <DetailHeading
        title={`Policy ${policy.policyNumber}`}
        lead={`${policy.customerName} · ${policy.customerEmail} · ${policy.stateCode} · ${policy.effectiveAt} to ${policy.termEnd} · broker ${policy.brokerName}`}
        chips={
          <>
            <Chip tone={statusTone}>{policy.status.replace(/_/g, " ")}</Chip>
            <Chip tone={kyb.status === "approved" ? "ok" : "warn"}>KYB {kyb.status}</Chip>
            {liveEndorsement ? <Chip tone="warn">endorsement in progress</Chip> : null}
            {openClaims.length > 0 ? (
              <Chip tone="warn">{openClaims.length === 1 ? "1 open claim" : `${openClaims.length} open claims`}</Chip>
            ) : null}
          </>
        }
        actions={
          <>
            {policyCanBePaid && brokerMayBind ? (
              <form method="post" action={`/api/policies/${policy.policyId}/checkout`} className="inline-form">
                <button type="submit">{operation ? "Continue the payment at Stripe" : "Pay with Stripe (test mode)"}</button>
              </form>
            ) : null}
            {policyCanBePaid && !brokerMayBind ? (
              <button type="button" disabled>
                Pay with Stripe (test mode)
              </button>
            ) : null}
            {operation?.bindingRefusedReason && user.role === "staff_ops" ? (
              <form method="post" action={`/api/policies/${policy.policyId}/bind`} className="inline-form">
                <button type="submit">Bind now that the broker is eligible</button>
              </form>
            ) : null}
            {canChange && !liveEndorsement ? (
              <Link href={`/policies/${policy.policyId}/endorse`} className="button-link orange">
                Endorse
              </Link>
            ) : null}
            {canChange ? (
              <Link href={`/policies/${policy.policyId}/cancel`} className="button-link danger">
                Cancel the policy
              </Link>
            ) : null}
            {canOpenClaim ? (
              <Link href={`/policies/${policy.policyId}/claims/new`} className="button-link secondary">
                Open a claim
              </Link>
            ) : null}
          </>
        }
      />

      {notices.length > 0 ? <div className="notices">{notices}</div> : null}

      <DetailGrid
        main={
          <>
            <Panel title="Terms in force">
              <Facts
                items={[
                  { label: "Annual premium", value: formatCentsAsUsd(policy.annualPremiumCents) },
                  {
                    label: `${policy.stateCode} premium tax (${(policy.taxRateBps / 100).toFixed(2)}%)`,
                    value: formatCentsAsUsd(policy.taxCents),
                  },
                  { label: "Policy fee, once at issuance", value: formatCentsAsUsd(policy.feeCents) },
                  { label: "Full annual term at these terms", value: formatCentsAsUsd(policy.totalChargeCents), emphasis: true },
                  { label: "Per-occurrence limit", value: formatCentsAsUsd(policy.perOccurrenceLimitCents) },
                  { label: "Aggregate limit", value: formatCentsAsUsd(policy.aggregateLimitCents) },
                  { label: "Broker commission rate", value: `${(policy.commissionRateBps / 100).toFixed(2)}%` },
                ]}
              />
            </Panel>

            {liveEndorsement ? (
              <EndorsementInProgress
                endorsement={liveEndorsement}
                policyId={policy.policyId}
                isOwningBroker={isOwningBroker}
                isStaffOperations={user.role === "staff_ops"}
              />
            ) : null}

            <Panel title="Endorsement schedule">
              {schedule.length === 0 ? (
                <Empty>
                  No endorsement is in force on this policy.
                  {canChange && liveEndorsement
                    ? " A new one can be requested once the one in progress is paid or superseded."
                    : ""}
                </Empty>
              ) : (
                <>
                  <div className="table-scroll" role="region" aria-label="Endorsement schedule" tabIndex={0}>
                    <table>
                      <thead>
                        <tr>
                          <th>Effective</th>
                          <th>Recorded (UTC)</th>
                          <th>Change</th>
                          <th className="amount">Prorated delta</th>
                          <th className="amount">New annual premium</th>
                          <th>Stripe</th>
                        </tr>
                      </thead>
                      <tbody>
                        {schedule.map((row) => (
                          <tr key={row.endorsedEventId}>
                            <td>{row.effectiveAt}</td>
                            <td>{row.recordedAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                            <td>
                              {row.description}
                              <br />
                              <span className="note">{row.newLimitLabel}</span>
                              {row.correctedFromEffectiveAt ? (
                                <>
                                  <br />
                                  <span className="note">
                                    Corrected: entered as {row.correctedFromEffectiveAt}, put right to {row.effectiveAt}
                                  </span>
                                </>
                              ) : null}
                            </td>
                            <td className="amount">
                              {formatCentsAsUsd(row.figures.deltaTotalCents)}
                              <br />
                              <span className="note">
                                {formatCentsAsUsd(row.figures.deltaPremiumCents)} premium, {formatCentsAsUsd(row.figures.deltaTaxCents)} tax
                              </span>
                            </td>
                            <td className="amount">{formatCentsAsUsd(row.figures.newAnnualPremiumCents)}</td>
                            <td>
                              {row.stripeReferences.length > 0 ? "money moved" : "no money moved"}
                              {row.stripeReferences.length > 0 ? (
                                <SandboxReferences
                                  references={row.stripeReferences.map((reference, index) => ({
                                    label: `Stripe reference ${index + 1}`,
                                    value: reference,
                                  }))}
                                />
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Disclosure title="What the prorated delta is">
                    <p>
                      The prorated delta is the money that actually moved: the annual premium difference priced over the
                      days remaining from the effective date to the end of the term, plus the state premium tax on it,
                      rounded in the customer&apos;s favour. It is not the change in the annual premium, which is what the
                      last column shows.
                    </p>
                  </Disclosure>
                  {schedule.map((row, index) => (
                    <Disclosure key={`explained-${row.endorsedEventId}`} title={`Explained: effective ${row.effectiveAt}, ${row.description}`}>
                      <div className="note">
                        {row.figures.daysRemaining} of {row.figures.termDays} days remained from {row.effectiveAt}. Every
                        figure below is the one stored on the endorsement event and posted to the journal; none of it is
                        recomputed for display.
                        <SandboxReferences
                          references={
                            row.stripeReferences.length > 0
                              ? row.stripeReferences.map((reference, index) => ({
                                  label: `Stripe reference ${index + 1}`,
                                  value: reference,
                                }))
                              : [{ label: "Stripe references", value: null }]
                          }
                        />
                      </div>
                      <FormulaLinesTable lines={row.lines} />
                      {/* Slice B8: the panel's live-fire test. Staff operations can put a wrong effective
                          date right; the preview shows the whole impact before anything is written. */}
                      {user.role === "staff_ops" && policy.status === "bound" && index === schedule.length - 1 ? (
                        <CorrectEndorsementDateForm
                          policyId={policy.policyId}
                          endorsedEventId={row.endorsedEventId}
                          effectiveAt={row.effectiveAt}
                          termStart={policy.effectiveAt}
                          termEnd={policy.termEnd}
                        />
                      ) : null}
                    </Disclosure>
                  ))}
                </>
              )}
              {historicalRequests.length > 0 ? (
                <Disclosure title={`Superseded endorsement requests (${historicalRequests.length})`}>
                  <p>
                    Quotes that were replaced by a later change before they took effect. They stay on the record; nothing
                    was collected or applied for them
                    {historicalRequests.some((request) => request.collection?.applicationRefusedReason)
                      ? " except where a payment is noted below, which operations must resolve."
                      : "."}
                  </p>
                  <ul>
                    {historicalRequests.map((request) => (
                      <li key={request.request.eventId} className="note">
                        {request.request.recordedAt.toISOString().replace("T", " ").slice(0, 19)} UTC: {request.request.description},
                        effective {request.request.figures.effectiveAt}, {formatCentsAsUsd(request.request.figures.deltaTotalCents)}
                        {request.collection?.applicationRefusedReason ? (
                          <>
                            . Paid but not applied: {request.collection.applicationRefusedReason}
                            <SandboxReferences
                              references={[
                                { label: "Stripe PaymentIntent", value: request.collection.paymentIntentId },
                                { label: "Money operation id", value: request.collection.operationId },
                              ]}
                            />
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              ) : null}
              {canChange && liveEndorsement && (isOwningBroker || user.role === "staff_ops") ? (
                <p className="note">
                  Requesting another change now would replace the quote in progress (its hash would no longer match).{" "}
                  <Link href={`/policies/${policy.policyId}/endorse?effectiveAt=${liveEndorsement.request.figures.effectiveAt}&newAnnualPremium=${(liveEndorsement.request.figures.newAnnualPremiumCents / 100).toFixed(2)}&newPerOccurrenceLimit=${(liveEndorsement.request.newPerOccurrenceLimitCents / 100).toFixed(2)}&newAggregateLimit=${(liveEndorsement.request.newAggregateLimitCents / 100).toFixed(2)}`}>
                    Re-quote the same change
                  </Link>
                  .
                </p>
              ) : null}
            </Panel>

            {cancellation ? (
              <Panel title="Cancellation">
                <p className="note">
                  Effective {cancellation.effectiveAt}, recorded {cancellation.recordedAt.toISOString().slice(0, 19)} UTC,
                  method {cancellation.calculationMethod}. Every figure is the one stored on the cancellation event and
                  posted to the journal.
                </p>
                <div className="table-scroll" role="region" aria-label="Cancellation amounts" tabIndex={0}>
                  <table className="amounts">
                    <tbody>
                      <tr>
                        <th>Written premium</th>
                        <td className="amount">{formatCentsAsUsd(cancellation.writtenPremiumCents)}</td>
                      </tr>
                      <tr>
                        <th>Earned over {cancellation.earnedDays} of {cancellation.termDays} days, kept by the insurer</th>
                        <td className="amount">{formatCentsAsUsd(cancellation.earnedPremiumCents)}</td>
                      </tr>
                      <tr>
                        <th>Unearned premium, refunded</th>
                        <td className="amount">{formatCentsAsUsd(cancellation.unearnedPremiumCents)}</td>
                      </tr>
                      <tr>
                        <th>
                          {policy.stateCode} premium tax on the refunded premium ({(cancellation.taxRateBps / 100).toFixed(2)}%)
                        </th>
                        <td className="amount">{formatCentsAsUsd(cancellation.refundedTaxCents)}</td>
                      </tr>
                      <tr>
                        <th>Policy fee, earned at issuance, never refunded</th>
                        <td className="amount">{formatCentsAsUsd(cancellation.refundedFeeCents)}</td>
                      </tr>
                      <tr className="total">
                        <th>Total refunded</th>
                        <td className="amount">{formatCentsAsUsd(cancellation.totalRefundCents)}</td>
                      </tr>
                      <tr>
                        <th>
                          Commission clawed back from the broker ({(cancellation.commissionRateBps / 100).toFixed(2)}% of the
                          refunded premium, rounded down)
                        </th>
                        <td className="amount">{formatCentsAsUsd(cancellation.commissionClawbackCents)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {cancellation.taxRefundWasCappedAtCharged ? (
                  <p className="note">
                    The tax refund was capped at the premium tax actually charged on this policy: rounding it up would
                    have given back a cent that was never collected.
                  </p>
                ) : null}
                {openClaims.length > 0 ? (
                  <p className="note">
                    This policy has {openClaims.length} open claim, and the cancellation did not touch it: the open claim
                    keeps its reserve of {formatCentsAsUsd(openClaimReserveCents)}, anything already paid on it stays
                    paid, and the refund above covers unearned premium only, because the loss happened while the policy
                    was in force. The commission clawback follows the refunded premium alone, for the same reason.
                  </p>
                ) : null}
              </Panel>
            ) : null}

            {refunds.length > 0 ? (
              <Panel title="Refunds">
                <div className="table-scroll" role="region" aria-label="Refund history" tabIndex={0}>
                  <table>
                    <thead>
                      <tr>
                        <th>State</th>
                        <th className="amount">Amount</th>
                        <th>Stripe</th>
                        <th>Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {refunds.map((refund) => (
                        <tr key={refund.operationId}>
                          <td>
                            {/* Requested and completed are never mixed up: money asked for is not money
                                the customer has received. Above $1,000 a third state sits in front of
                                both: the refund is recorded and owed, and it is not going anywhere until
                                a second person approves it (slice B7, /ops/approvals). */}
                            {refund.state === "completed"
                              ? `completed${refund.completedOn ? ` on ${refund.completedOn}` : ""}`
                              : refund.state === "failed"
                                ? refund.failureStage === "approval"
                                  ? "rejected by the approver, nothing sent"
                                  : "failed, not completed"
                                : refund.approvalRequestId && refund.approvalDecision !== "approved"
                                  ? refund.approvalDecision === "rejected"
                                    ? "awaiting approval: rejected"
                                    : "awaiting approval"
                                  : "requested"}
                          </td>
                          <td className="amount">{formatCentsAsUsd(refund.amountCents)}</td>
                          <td>
                            {refund.refundId ? "created at Stripe" : "not created yet"}
                            <SandboxReferences
                              references={[
                                { label: "Stripe Refund", value: refund.refundId },
                                { label: "On Stripe PaymentIntent", value: refund.paymentIntentId },
                                { label: "Money operation id", value: refund.operationId },
                                { label: "Approval request id", value: refund.approvalRequestId },
                              ]}
                            />
                          </td>
                          <td>
                            {refund.failureReason ? (
                              <>
                                {refund.failureReason}
                                <br />
                                <span className="note">
                                  The customer is still owed this money: nothing was reversed in the ledger, and the
                                  refund stays open until a new one completes.
                                </span>
                                {user.role === "staff_ops" ? (
                                  <RowActions label="Try this refund again">
                                    <form
                                      method="post"
                                      action={`/api/policies/${policy.policyId}/refunds/${refund.operationId}/reissue`}
                                      className="inline-form"
                                    >
                                      <button type="submit">
                                        {refund.failureStage === "approval"
                                          ? "Raise a new approval request for this refund"
                                          : "Re-issue this refund"}
                                      </button>
                                    </form>
                                  </RowActions>
                                ) : null}
                              </>
                            ) : (
                              <span className="note">
                                {formatCentsAsUsd(refund.refundedPremiumCents)} premium +{" "}
                                {formatCentsAsUsd(refund.refundedTaxCents)} tax, clawback{" "}
                                {formatCentsAsUsd(refund.commissionClawbackCents)}
                              </span>
                            )}
                            {/* Slice B7: one button for two situations. A refund above $1,000 that a
                                second person has approved, and a refund stuck in 'requested' because the
                                process died before Stripe was called (review finding F-B5-03). Both are
                                sent with the operation's own idempotency key, so Stripe can never create
                                a second refund for it. */}
                            {refund.state === "requested" &&
                            user.role === "staff_ops" &&
                            (!refund.approvalRequestId || refund.approvalDecision === "approved") ? (
                              <RowActions label="Send this refund">
                                <form
                                  method="post"
                                  action={`/api/policies/${policy.policyId}/refunds/${refund.operationId}/send`}
                                  className="inline-form"
                                >
                                  <button type="submit">
                                    {refund.approvalRequestId ? "Send this approved refund to Stripe" : "Send to Stripe again"}
                                  </button>
                                </form>
                              </RowActions>
                            ) : null}
                            {refund.state === "requested" && refund.approvalRequestId && refund.approvalDecision !== "approved" ? (
                              <span className="note">
                                <br />
                                Above the approval threshold: it waits in{" "}
                                <Link href="/ops/approvals">the approvals queue</Link> until a second person decides.
                              </span>
                            ) : null}
                            {refund.failedAfterCompletion ? (
                              <p className="error" role="alert">
                                Stripe reported a failure after this refund had completed. Nothing was reversed
                                automatically: an operator has to decide whether the cash came back and post a reversal.
                              </p>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            ) : null}

            <Panel title="Claims">
              {claims.length === 0 ? (
                <Empty>No claim on this policy.</Empty>
              ) : (
                <div className="table-scroll" role="region" aria-label="Policy claims" tabIndex={0}>
                  <table>
                    <thead>
                      <tr>
                        <th>Claim</th>
                        <th>Claimant</th>
                        <th>Loss date</th>
                        <th>State</th>
                        <th className="amount">Reserve</th>
                        <th className="amount">Paid</th>
                        <th className="amount">Incurred</th>
                      </tr>
                    </thead>
                    <tbody>
                      {claims.map((claim) => (
                        <tr key={claim.claimId}>
                          <td>
                            {/* Only staff work on a claim, so only staff get the link to its screen. */}
                            {isStaff ? <Link href={`/ops/claims/${claim.claimId}`}>{claim.claimNumber}</Link> : claim.claimNumber}
                          </td>
                          <td>{claim.claimantName}</td>
                          <td>{claim.occurredAt}</td>
                          <td>
                            <Chip tone={claim.position.isClosed ? "neutral" : "warn"}>{claim.position.isClosed ? "closed" : "open"}</Chip>
                          </td>
                          <td className="amount">{formatCentsAsUsd(claim.position.reserveCents)}</td>
                          <td className="amount">{formatCentsAsUsd(claim.position.paidCents)}</td>
                          <td className="amount">{formatCentsAsUsd(claim.position.incurredCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            {/* --- Slice B8: backdated corrections, both clocks, and the policy on any date --- */}
            <CorrectionsExplained policyId={policy.policyId} canPay={isOwningBroker || user.role === "staff_ops"} />

            <PolicyAsOf policyId={policy.policyId} asOf={query.asOf} termStart={policy.effectiveAt} today={today} />

            <PolicyTimeline policyId={policy.policyId} />

            <Panel title="Journal entries">
              {entries.length === 0 ? (
                <Empty>Nothing has been posted yet. The four issuance entries are written when Stripe confirms the payment.</Empty>
              ) : (
                <JournalTable entries={entries} ariaLabel="Policy journal" />
              )}
            </Panel>
          </>
        }
        aside={
          <>
            <Panel title="So far, from the journal">
              <AsideList
                items={[
                  {
                    label: "Premium payment",
                    value: operation ? (
                      <>
                        {operation.latestStatus ?? "none"}
                        <SandboxReferences
                          references={[
                            { label: "Money operation id", value: operation.operationId },
                            { label: "Stripe Checkout Session", value: operation.providerRef },
                          ]}
                        />
                      </>
                    ) : (
                      "not started"
                    ),
                  },
                  { label: "Collected at Stripe", value: formatCentsAsUsd(ledger.collectedCents) },
                  { label: "Refunded from Stripe", value: formatCentsAsUsd(ledger.refundedCents) },
                  { label: "Commission owed to the broker, net", value: formatCentsAsUsd(ledger.commissionNetCents) },
                  { label: "Unearned premium held", value: formatCentsAsUsd(ledger.unearnedPremiumCents) },
                  {
                    label: "Open claims",
                    value: openClaims.length === 0 ? "none" : `${openClaims.length}, reserve ${formatCentsAsUsd(openClaimReserveCents)}`,
                  },
                ]}
              />
              <p className="note">
                Sums of the journal lines listed on this page: cash at Stripe in and out, the commission payable balance,
                the unearned premium balance. Nothing here is recomputed from the terms.
              </p>
            </Panel>

            <Panel title="Broker">
              <AsideList
                items={[
                  { label: "Name", value: policy.brokerName },
                  { label: "Business verification", value: <Chip tone={kyb.status === "approved" ? "ok" : "warn"}>{kyb.status}</Chip> },
                ]}
              />
              <p className="note">{kyb.explanation}</p>
              {kyb.isProviderEvidence ? null : (
                <p className="note">{KYB_NOT_LIVE_LABEL}. The status above is a seeded placeholder, not provider evidence.</p>
              )}
            </Panel>

            <Panel title="Documents as of a date">
              <form method="get" action={`/api/policies/${policy.policyId}/documents/declarations`} className="card">
                <label htmlFor="asOfDeclarations">Declarations page as of</label>
                <input id="asOfDeclarations" name="asOf" type="date" defaultValue={documentDate} min={policy.effectiveAt} required />
                <button type="submit" className="secondary">Open the declarations page (PDF)</button>
              </form>
              <form method="get" action={`/api/policies/${policy.policyId}/documents/endorsement-schedule`} className="card">
                <label htmlFor="asOfSchedule">Endorsement schedule as of</label>
                <input id="asOfSchedule" name="asOf" type="date" defaultValue={documentDate} min={policy.effectiveAt} required />
                <button type="submit" className="secondary">Open the endorsement schedule (PDF)</button>
              </form>
              <p className="note">
                Real PDFs rebuilt from the events effective on or before the date: between two endorsements the
                declarations page shows the premium and limits in force that day.
              </p>
            </Panel>

            <Panel title="How to read this page">
              <Disclosure title="In force is not collected">
                <p>
                  The terms in force are today&apos;s premium and limits. What was actually collected and refunded is in the
                  endorsement schedule, the refunds and the journal, never in the terms.
                </p>
              </Disclosure>
              <Disclosure title="Incurred, reserve, paid">
                <p>
                  Incurred is what a claim has cost so far: paid plus the reserve still outstanding. A claim can be opened
                  on a cancelled policy too, as long as the loss happened while the policy was in force. Cancelling never
                  touches an open claim or its reserve.
                </p>
              </Disclosure>
              <Disclosure title="Endorse, cancel, correct">
                <p>
                  An endorsement is priced from its effective date over the days remaining in the term; above{" "}
                  {formatCentsAsUsd(CUSTOMER_APPROVAL_THRESHOLD_CENTS)} the customer approves it first, and it takes effect
                  when the delta is paid. A cancellation refunds the unearned premium pro rata and claws back the commission
                  on it. A correction never changes a row: it reverses and re-books.
                </p>
              </Disclosure>
            </Panel>
          </>
        }
      />
    </PortalShell>
  );
}

// What the journal already says about this policy, as plain sums of the lines shown on the page.
// Debits on the Stripe cash account are money that arrived, credits are money that left; the
// commission payable and unearned premium balances are credits minus debits. No proration, no
// rounding: a reader can check each figure against the journal table.
function ledgerSoFar(entries: JournalEntryView[]) {
  let collectedCents = 0;
  let refundedCents = 0;
  let commissionNetCents = 0;
  let unearnedPremiumCents = 0;
  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.accountId === "cash_stripe") {
        collectedCents += line.debitCents;
        refundedCents += line.creditCents;
      }
      if (line.accountId === "commission_payable") {
        commissionNetCents += line.creditCents - line.debitCents;
      }
      if (line.accountId === "unearned_premium") {
        unearnedPremiumCents += line.creditCents - line.debitCents;
      }
    }
  }
  return { collectedCents, refundedCents, commissionNetCents, unearnedPremiumCents };
}

// The endorsement that is neither applied nor superseded: where it stands and what to do next.
// Every figure comes from the immutable request event; every button is a form that the server
// checks again.
function EndorsementInProgress({
  endorsement,
  policyId,
  isOwningBroker,
  isStaffOperations,
}: {
  endorsement: EndorsementView;
  policyId: string;
  isOwningBroker: boolean;
  isStaffOperations: boolean;
}) {
  const { request, standing, collection } = endorsement;
  const figures = request.figures;
  const paymentInFlight = collection && !collection.isDead && collection.latestStatus !== "succeeded" && collection.checkoutUrl;

  return (
    <Panel title="Endorsement in progress">
      <p className="note">
        Requested {request.recordedAt.toISOString().replace("T", " ").slice(0, 19)} UTC, effective {figures.effectiveAt}:{" "}
        {request.description}. {request.reason ? `Reason: ${request.reason}. ` : ""}
        The policy terms stay as they are until the delta is paid.
      </p>

      <div className="chips">
        {standing.state === "awaiting_approval" ? (
          <Chip tone="warn">
            Awaiting the customer&apos;s approval: {formatCentsAsUsd(figures.deltaTotalCents)} is above{" "}
            {formatCentsAsUsd(CUSTOMER_APPROVAL_THRESHOLD_CENTS)}
          </Chip>
        ) : null}
        {standing.approvedEventId ? (
          <Chip tone="ok">Approved by the customer on {standing.approvedAt?.toISOString().replace("T", " ").slice(0, 19)} UTC</Chip>
        ) : null}
      </div>
      {standing.state === "awaiting_approval" ? (
        <p className="note">The customer approves from their own screen (/customer).</p>
      ) : null}

      <FormulaLinesTable lines={endorsement.lines} />

      {collection ? (
        // A div, not a p: a details element is not allowed inside a paragraph.
        <div className="note">
          Last status of the delta payment: {collection.latestStatus ?? "none"}
          {collection.isDead ? ". The hosted page expired: the next Pay click opens a new session under a new key." : ""}
          <SandboxReferences
            references={[
              { label: "Money operation id", value: collection.operationId },
              { label: "Stripe Checkout Session", value: collection.sessionId },
              { label: "Stripe PaymentIntent", value: collection.paymentIntentId },
            ]}
          />
        </div>
      ) : null}

      {collection?.applicationRefusedReason ? (
        <>
          <p className="error">
            Paid, not applied: {collection.applicationRefusedReason}. The money arrived at Stripe and is recorded on the
            operation, but nothing was journaled and the endorsement is NOT in force.
          </p>
          {isStaffOperations ? (
            <form method="post" action={`/api/policies/${policyId}/endorsements/${request.eventId}/apply`} className="inline-form">
              <button type="submit">Apply now that the broker is eligible</button>
            </form>
          ) : (
            <p className="note">Staff operations can apply it once the broker&apos;s verification passes.</p>
          )}
        </>
      ) : null}

      {standing.state === "approved" && isOwningBroker && !collection?.applicationRefusedReason ? (
        <form method="post" action={`/api/policies/${policyId}/endorsements/${request.eventId}/checkout`} className="inline-form">
          <input type="hidden" name="quoteHash" value={figures.quoteHash} />
          <button type="submit">
            {paymentInFlight ? "Continue the delta payment at Stripe" : `Pay the delta (${formatCentsAsUsd(figures.deltaTotalCents)}) with Stripe (test mode)`}
          </button>
        </form>
      ) : null}
      {standing.state === "approved" && !isOwningBroker ? (
        <p className="note">The owning broker pays the delta from this page.</p>
      ) : null}
    </Panel>
  );
}

// What the banner says after a cancellation, read from the refunds it actually opened (review
// finding F-UI-04). It used to say "were sent to Stripe" for every refund, including one sitting
// in the approval queue with nothing sent at all. Each group below is a different fact about the
// customer's money, so each one is named separately and none is implied.
function cancellationRefundNotice(refunds: RefundOperationView[]): string {
  if (refunds.length === 0) {
    return "The policy is cancelled. Nothing was owed back, so no refund was opened.";
  }
  const waitingForApproval = refunds.filter(
    (refund) => refund.state === "requested" && refund.approvalRequestId !== null && refund.approvalDecision !== "approved",
  ).length;
  const notSentYet = refunds.filter(
    (refund) => refund.state === "requested" && (refund.approvalRequestId === null || refund.approvalDecision === "approved"),
  ).length;
  const sentToStripe = refunds.filter((refund) => refund.state === "accepted").length;
  const completed = refunds.filter((refund) => refund.state === "completed").length;
  const failed = refunds.filter((refund) => refund.state === "failed").length;

  const parts: string[] = [];
  if (waitingForApproval > 0) {
    parts.push(
      `${waitingForApproval} waits for a second person to approve it (nothing has been sent to Stripe)`,
    );
  }
  if (notSentYet > 0) {
    parts.push(`${notSentYet} is recorded and owed, and has not left for Stripe yet`);
  }
  if (sentToStripe > 0) {
    parts.push(`${sentToStripe} was sent to Stripe and is not confirmed yet`);
  }
  if (completed > 0) {
    parts.push(`${completed} is completed`);
  }
  if (failed > 0) {
    parts.push(`${failed} failed and the customer is still owed the money`);
  }
  const opened = refunds.length === 1 ? "one refund" : `${refunds.length} refunds`;
  return (
    `The policy is cancelled and it opened ${opened}: ${parts.join(", ")}. ` +
    "A refund counts as completed only when Stripe's webhook confirms the money left; the refunds panel is the detail."
  );
}

// What the operator sees after a backdated correction (slice B8).
function correctionNotice(outcome: string): string {
  switch (outcome) {
    case "collect":
      return "The effective date is corrected. The endorsement is in force on the right date, and the difference is now owed by the customer: collect it from the corrections panel.";
    case "refund-requested":
      return "The effective date is corrected and the difference was sent back to Stripe as a refund. It counts as completed only when Stripe's webhook confirms the money left; refresh in a moment.";
    case "refund-held":
      return "The effective date is corrected. The difference owed back is above $1,000, so it waits in the approval queue: a second person has to approve it before anything is sent to Stripe (/ops/approvals).";
    case "refund-refused":
      return "The effective date is corrected and the difference is owed back, but the maker-checker gate refused to send it: another refund on this policy crossed the $1,000 line in the meantime. The refund is listed with that reason and a button to raise a new approval request; nothing was sent.";
    case "refund-failed":
      return "The effective date is corrected and the difference is owed back, but Stripe refused the refund. The reason is on the refund, the customer is still owed the money, and nothing was reversed in the ledger.";
    case "done":
      return "The effective date is corrected. The corrected date prices the same amount, so no money moves.";
    case "returned":
      return "You came back from the Stripe hosted page. The difference is collected when Stripe's webhook confirms the payment, not when the browser returns: refresh in a moment.";
    case "cancelled":
      return "The payment page for the difference was left without paying. The difference is still owed and shows as an open receivable.";
    default:
      return outcome;
  }
}

function endorsementNotice(outcome: string): string {
  switch (outcome) {
    case "requested":
      return "The endorsement is requested. It takes effect when the delta is paid (after the customer's approval above $500).";
    case "applied":
      return "The endorsement is in force.";
    case "already-applied":
      return "This endorsement was already in force; nothing was posted a second time.";
    case "refund-requested":
      return "The endorsement is in force and the refund was sent to Stripe. It counts as completed only when Stripe's webhook confirms the money left; refresh in a moment.";
    case "refund-held":
      return "The endorsement is in force. The refund is above $1,000, so it waits in the approval queue: a second person has to approve it before anything is sent to Stripe (maker-checker, /ops/approvals).";
    case "returned":
      return "You came back from the Stripe hosted page. The endorsement takes effect when Stripe's webhook confirms the delta was paid, not when the browser returns: refresh in a moment.";
    case "cancelled":
      return "The delta payment page was left without paying.";
    default:
      return outcome;
  }
}
