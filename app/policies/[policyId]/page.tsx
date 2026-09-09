import "@/app/styles/policy-detail.css";
import { PortalShell } from "@/components/portal-shell";
import { AmountExplained } from "@/components/amount-explained";
import { SandboxReferences } from "@/components/disclosures";
import { Chip } from "@/components/detail-layout";
import { JournalTable } from "@/components/journal-table";
import { About } from "@/components/ui/about";
import { EmptyState } from "@/components/ui/empty";
import { Legend } from "@/components/ui/legend";
import { Stat, Stats } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
import { Chevron, DataTable, ExpandHead, ExpandRow, FactGrid, Num, Primary, Ref, Row } from "@/components/ui/table";
import { When } from "@/components/ui/time";
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
import {
  accountSumCents,
  evidenceFromJournal,
  explainAccountSum,
  explainCancellationFigure,
  explainPolicyFee,
  explainStateTax,
  explainTotalCharge,
} from "@/lib/money/explain";
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
import { policyAsItStoodOn } from "@/lib/policy/correction-read";
import { termsInForceOn } from "@/lib/policy/terms-in-force";
import { firstValue, pickView, toastsFromQuery, withParams, type Query, type ToastNotice } from "@/lib/ui/views";
import {
  CorrectEndorsementDateForm,
  CorrectionsExplained,
  PolicyAsOf,
  PolicyChangeSteps,
  PolicyTimeline,
} from "./correction-sections";
import { CustomerChangeRequestsPanel, CustomerPolicyView } from "./customer-view";
import { FormulaLinesTable } from "./formula-lines";

// One policy: what it costs, where it stands, and every journal entry it produced.
//
// Layout (rebuilt on the interface system of 2026-09-09): the sticky band names the policy, its
// state and the mode of every slot whose money is on the page, and holds the actions. The screen
// then has six views, one at a time, named in the address (?view=): the terms in force, the
// endorsements, the claims, the money, the timeline, the documents. Only the view being read is
// rendered, so a reader meets one table at a time instead of eleven panels.
//
// The forms that start a change live on their own pages (endorse, cancel, open a claim); the
// server checks every rule again there and again on submit, so what this page shows or hides is
// never the control.
//
// The ledger is still the point of the page: the amounts at the top must be findable, line by
// line, in the journal of the money view.
const VIEWS = ["overview", "endorsements", "claims", "money", "timeline", "documents"] as const;
const VIEW_LABEL: Record<(typeof VIEWS)[number], string> = {
  overview: "Overview",
  endorsements: "Endorsements",
  claims: "Claims",
  money: "Money",
  timeline: "Timeline",
  documents: "Documents",
};

export default async function PolicyPage({
  params,
  searchParams,
}: {
  params: Promise<{ policyId: string }>;
  // Every parameter is read through `firstValue`: a repeated parameter arrives as an array, and a
  // page that prints one where a string is expected runs its two values together (review finding
  // F-B13-32). The type says so, and the reads below take the first value and only that.
  searchParams: Promise<Query>;
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

  // Ownership, checked on the server for every visit: a broker sees their own policies, staff can
  // read any policy, the policy's own customer gets the read-only view of slice B13-6, nobody
  // else gets in.
  const isOwningBroker = user.role === "broker" && user.brokerId === policy.brokerId;
  const isStaff = user.role === "staff_ops" || user.role === "staff_approver";
  if (user.role === "customer" && user.customerId === policy.customerId) {
    // A different page for a different reader: no journal, no ledger sums, no action but asking
    // for a change (app/policies/[policyId]/customer-view.tsx). Nothing below this line runs.
    return <CustomerPolicyView user={user} policy={policy} searchParams={searchParams} />;
  }
  if (!isOwningBroker && !isStaff) {
    redirect(user.role === "customer" ? "/customer" : "/broker");
  }

  const today = new Date().toISOString().slice(0, 10);
  // A date field cannot start on a date it would refuse: on a policy whose term has not begun,
  // today is before the minimum, so the term start is the honest default (F-B8-07, F-B8-09).
  const documentDate = today > policy.effectiveAt ? today : policy.effectiveAt;

  const [kyb, operation, entries, cancellation, refunds, voidCorrection, endorsements, schedule, claims, termsToday, query] =
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
      // Finding F-YA-07: the terms panel asks the SAME fold the "as it stood on" panel below uses,
      // for today. policy_current applies every event whatever its effective date, so on a policy
      // carrying a future-dated endorsement it answers next month's premium under a heading that
      // says "in force".
      policyAsItStoodOn(policyId, documentDate),
      searchParams,
    ]);

  const path = `/policies/${policy.policyId}`;
  const view = pickView(query.view, VIEWS);
  const now = new Date();

  // ONE as-of date, even when the address carries several (review finding F-B13-32). Next gives
  // an array for a repeated parameter, and the panel below prints the value it was given twice:
  // once in its refusal sentence and once in the heading. React concatenates an array while a
  // template string comma-joins it, so "?asOf=2026-09-08&asOf=2026-10-08" refused
  // "2026-09-082026-10-08" and named "2026-09-08,2026-10-08" in the same sentence. The first
  // entry is the value the panel answers for, and it is refused by name like any other date that
  // is not a calendar date.
  const asOfRequested = firstValue(query.asOf);

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
  const liveEndorsement = endorsements.find(
    (endorsement) => endorsement.standing.state === "awaiting_approval" || endorsement.standing.state === "approved",
  );
  const historicalRequests = endorsements.filter((endorsement) => endorsement.standing.state === "superseded");
  // Slice B7: an open claim survives a cancellation untouched, which is the live-fire question,
  // so the explanation sits next to the cancellation amounts it explains.
  const openClaims = claims.filter((claim) => !claim.position.isClosed);
  const openClaimReserveCents = openClaims.reduce((total, claim) => total + claim.position.reserveCents, 0);
  // UI-022: what the four sums in the money view are allowed to add up. An entry a correction
  // reversed and the reversal that mirrors it cancel each other out, and adding both made a
  // voided policy read "Collected at Stripe $1,253.20" and "Refunded from Stripe $1,253.20" on a
  // policy whose own notice says Stripe never collected anything: a reversal is a correction of
  // our own books, not money coming back from the provider. Both entries stay in the journal,
  // untouched; only these summary lines leave them out, and the folds that explain each figure
  // are given the same list, so a fold can never list a line the figure above it did not count.
  const entriesStillStanding = entries.filter((entry) => !entry.reversesEntryId && !entry.isReversedByACorrection);
  // How many pairs were left out, counted on the reversals: one reversal mirrors one entry.
  const reversedPairCount = entries.filter((entry) => entry.reversesEntryId !== null).length;
  const ledger = ledgerSoFar(entriesStillStanding);

  // WHAT THE POLICY IS TODAY, not what it will be (Yoann's finding F-YA-07). On CGP-01707 the
  // panel printed the $2,400 annual premium and its $56.40 tax on 2026-09-09, although the
  // endorsement that raises it is effective 2026-10-08 and only $54.08 of tax was ever booked.
  // The figures come from the same fold as the timeline view's answer, for today, folded by the
  // one function the customer's own page reads too (lib/policy/terms-in-force.ts, review finding
  // F-INT-02); policy_current stays what the rest of the page uses, because a future-dated change
  // IS on the policy.
  const terms = termsInForceOn(policy, termsToday);
  // Applied endorsements that have not taken effect yet: the gap between what the policy is today
  // and what policy_current already carries. Named under the facts rather than folded into them.
  const endorsementsNotYetInForce = schedule.filter((row) => row.effectiveAt > documentDate);
  const entriesEffectiveByPanelDate = entries.filter((entry) => entry.effectiveAt <= documentDate);

  // The sentences the routes send this page back with. The notices below are the long form, which
  // the review scripts read; the toasts are the same events in one line, in the corner.
  const refusal = firstValue(query.error);
  const paymentOutcome = firstValue(query.payment);
  const cancelledOutcome = firstValue(query.cancelled);
  const reissuedOutcome = firstValue(query.reissued);
  const refundSentOutcome = firstValue(query.refundSent);
  const boundOutcome = firstValue(query.bound);
  const endorsementOutcome = firstValue(query.endorsement);
  const correctionOutcome = firstValue(query.correction);
  const changeRequestOutcome = firstValue(query.changeRequest);

  const toasts: ToastNotice[] = [
    ...toastsFromQuery(query, { error: { tone: "error", title: "Refused" } }),
    ...toast("bound", boundOutcome, "ok", "Bound", boundOutcome === "already" ? "It was already bound." : "The issuance entries are in the journal."),
    ...toast("cancelled", cancelledOutcome, "ok", "Cancelled", "The refunds it opened are in the money view."),
    ...toast("payment", paymentOutcome, "info", "Stripe", paymentOutcome === "cancelled" ? "The page was left without paying." : "Bound when the webhook confirms it."),
    ...toast("endorsement", endorsementOutcome, "info", "Endorsement", (endorsementOutcome ?? "").replace(/-/g, " ")),
    ...toast("correction", correctionOutcome, "info", "Correction", (correctionOutcome ?? "").replace(/-/g, " ")),
    ...toast("reissued", reissuedOutcome, "info", "Refund re-issued", (reissuedOutcome ?? "").replace(/_/g, " ")),
    ...toast("refundSent", refundSentOutcome, "ok", "Refund sent", refundSentOutcome ?? ""),
    ...toast("changeRequest", changeRequestOutcome, "ok", "Answer sent", "It is under the request it answers."),
  ];

  const notices = [
    refusal ? <p key="error" className="error" role="alert">{refusal}</p> : null,
    paymentOutcome === "returned" ? (
      <p key="returned" className="note" role="status">
        You came back from the Stripe hosted page. The policy is bound when Stripe&apos;s webhook confirms the payment,
        not when the browser returns: refresh in a moment if the status is still awaiting payment.
      </p>
    ) : null,
    paymentOutcome === "cancelled" ? <p key="left" className="note" role="status">The payment page was left without paying.</p> : null,
    changeRequestOutcome === "answered" ? (
      <p key="changeRequest" className="note" role="status">
        Your answer is on the customer&apos;s policy page, under the request it answers. It changed nothing on the
        policy itself: a change goes through Endorse.
      </p>
    ) : null,
    cancelledOutcome ? <p key="cancelled" className="note" role="status">{cancellationRefundNotice(refunds)}</p> : null,
    reissuedOutcome ? (
      <p key="reissued" className="note">
        {reissuedOutcome === "queued_for_approval"
          ? "A new refund attempt was raised and waits for a distinct approver (/ops/approvals); nothing was sent."
          : reissuedOutcome === "refused"
            ? "The refund was not sent: the maker-checker gate refused it (see the reason on the refund line)."
            : `A new refund was re-issued: Stripe answered ${reissuedOutcome}.`}
      </p>
    ) : null,
    refundSentOutcome ? <p key="sent" className="note">The refund was sent to Stripe: {refundSentOutcome}.</p> : null,
    boundOutcome === "1" ? (
      <p key="bound" className="note" role="status">The policy is now bound and the four issuance entries are in the journal.</p>
    ) : null,
    boundOutcome === "already" ? (
      <p key="already" className="note" role="status">This policy was already bound; nothing was posted a second time.</p>
    ) : null,
    endorsementOutcome ? <p key="endorsement" className="note">{endorsementNotice(endorsementOutcome)}</p> : null,
    correctionOutcome ? <p key="correction" className="note">{correctionNotice(correctionOutcome)}</p> : null,
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
  const views = VIEWS.map((one) => ({
    key: one,
    label: VIEW_LABEL[one],
    href: withParams(path, query, { view: one }),
    current: one === view,
    count: one === "claims" ? claims.length : one === "endorsements" ? schedule.length : one === "money" ? entries.length : undefined,
  }));

  return (
    <PortalShell
      user={user}
      active="policies"
      views={views}
      viewsSubtitle={policy.policyNumber}
      toasts={toasts}
      trail={[...(isOwningBroker ? [] : [{ label: "Policies", href: "/ops/policies" }]), { label: `Policy ${policy.policyNumber}` }]}
      band={{
        title: `Policy ${policy.policyNumber}`,
        suffix: policy.customerName,
        meta: (
          <>
            <Chip tone={statusTone}>{policy.status.replace(/_/g, " ")}</Chip>
            <Chip tone={kyb.status === "approved" ? "ok" : "warn"}>KYB {kyb.status}</Chip>
            {/* The mode of each slot whose money is on this page, in the same words as the
                reconciliation screen and never behind a fold (AF-02, review finding F-B13-34).
                The premium, the endorsement deltas and the refunds are Stripe; the amount paid on
                a claim went out on the simulated rail, so the second chip appears with the claims
                that carry it and never on its own. */}
            <Chip tone="ok">Stripe: LIVE SANDBOX</Chip>
            {claims.length > 0 ? <Chip tone="neutral">claim payout rail: LOCAL SIMULATOR</Chip> : null}
            {liveEndorsement ? <Chip tone="warn">endorsement in progress</Chip> : null}
            {openClaims.length > 0 ? (
              <Chip tone="warn">{openClaims.length === 1 ? "1 open claim" : `${openClaims.length} open claims`}</Chip>
            ) : null}
          </>
        ),
        actions: (
          <>
            {policyCanBePaid && brokerMayBind ? (
              <form method="post" action={`/api/policies/${policy.policyId}/checkout`} className="inline-form">
                <SubmitButton>{operation ? "Continue the payment at Stripe" : "Pay with Stripe (test mode)"}</SubmitButton>
              </form>
            ) : null}
            {policyCanBePaid && !brokerMayBind ? (
              <button type="button" disabled>
                Pay with Stripe (test mode)
              </button>
            ) : null}
            {operation?.bindingRefusedReason && user.role === "staff_ops" ? (
              <form method="post" action={`/api/policies/${policy.policyId}/bind`} className="inline-form">
                <SubmitButton>Bind now that the broker is eligible</SubmitButton>
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
        ),
      }}
    >
      {notices.length > 0 ? <div className="notices">{notices}</div> : null}

      {view === "overview" ? (
        <>
          <Stats>
            <Stat
              label="Annual premium"
              value={formatCentsAsUsd(terms.annualPremiumCents)}
              note={terms.onDate ? `in force on ${terms.onDate}` : "on the policy record"}
            />
            <Stat
              label={`${policy.stateCode} premium tax`}
              value={
                <AmountExplained
                  amountCents={terms.taxCents}
                  label={
                    terms.onDate
                      ? `${policy.stateCode} premium tax on the annual premium in force on ${terms.onDate}`
                      : `${policy.stateCode} premium tax on the annual premium`
                  }
                  explanation={{
                    // Slice B12-2: the fold recomputes the tax with the same pure function the
                    // issuance used, so a stored figure that no longer matches its own premium
                    // and rate would be said out loud instead of explained away.
                    ...explainStateTax({
                      stateCode: policy.stateCode,
                      annualPremiumCents: terms.annualPremiumCents,
                      taxRateBps: terms.taxRateBps,
                      // Only the entries effective on or before the panel's date: a future-dated
                      // endorsement's tax is not part of today's figure (review finding F-B12-10).
                      evidence: evidenceFromJournal(entriesEffectiveByPanelDate, "premium_tax_payable"),
                    }),
                    evidenceLabel:
                      "The premium tax entries booked on this policy so far (issuance, and any endorsement or cancellation). They are what was charged over time; the figure above is the tax on the annual premium in force on this date.",
                  }}
                />
              }
              note={`${(terms.taxRateBps / 100).toFixed(2)}% of the premium`}
            />
            <Stat
              label="Policy fee"
              value={
                <AmountExplained
                  amountCents={terms.feeCents}
                  label="Flat policy fee"
                  explanation={explainPolicyFee({
                    feeCents: terms.feeCents,
                    evidence: evidenceFromJournal(entriesEffectiveByPanelDate, "fee_income"),
                  })}
                />
              }
              note="once at issuance"
            />
            <Stat
              label="Full annual term"
              tone="accent"
              value={
                <AmountExplained
                  amountCents={terms.totalChargeCents}
                  label={
                    terms.onDate
                      ? `What a full annual term at the terms in force on ${terms.onDate} costs the customer`
                      : "What a full annual term at these terms costs the customer"
                  }
                  explanation={explainTotalCharge({
                    stateCode: policy.stateCode,
                    annualPremiumCents: terms.annualPremiumCents,
                    taxCents: terms.taxCents,
                    feeCents: terms.feeCents,
                  })}
                />
              }
              note="premium, tax and fee"
            />
          </Stats>

          {/* UI-036: when the fold cannot rebuild the policy on the date, the figures above are the
              policy record's and nothing says they were in force. It is said here rather than
              promised in a heading and denied three paragraphs lower. */}
          {terms.onDate === null ? (
            <div className="notices">
              <p className="note">
                The policy cannot be rebuilt on {documentDate}: {"error" in termsToday ? termsToday.error : "no answer"}.
                The figures above are the ones on the policy record, not a state of cover on a date.
              </p>
            </div>
          ) : null}
          {/* Finding F-YA-07: what the policy is today, and separately what it becomes. The
              figures come from the endorsement's own stored event; nothing is recomputed. */}
          {endorsementsNotYetInForce.length > 0 ? (
            <div className="notices">
              {endorsementsNotYetInForce.map((row) => (
                <p key={`not-yet-${row.endorsedEventId}`} className="note">
                  An endorsement effective {row.effectiveAt} brings the annual premium to{" "}
                  {formatCentsAsUsd(row.figures.newAnnualPremiumCents)}
                  {row.newLimitLabel ? ` (${row.newLimitLabel})` : ""}. It is in the endorsements view with the delta it
                  collected; the figures above are the ones in force on {terms.onDate}.
                </p>
              ))}
            </div>
          ) : null}

          <div className="cards">
            <section className="card">
              <h2>Cover</h2>
              <FactGrid
                items={[
                  ...terms.limits.map((limit) => ({ label: limit.label, value: formatCentsAsUsd(limit.cents) })),
                  { label: "Term", value: `${policy.effectiveAt} to ${policy.termEnd}` },
                  { label: "State", value: policy.stateCode },
                  { label: "Commission rate", value: `${(policy.commissionRateBps / 100).toFixed(2)}%` },
                ]}
              />
            </section>

            <section className="card">
              <h2>So far, from the journal</h2>
              <LedgerSoFarFacts
                ledger={ledger}
                entries={entriesStillStanding}
                operation={operation}
                openClaims={openClaims.length}
                openClaimReserveCents={openClaimReserveCents}
              />
              <p className="pd-note">
                Sums of the journal lines of this policy: cash at Stripe in and out, the commission payable balance, the
                unearned premium balance.
              </p>
              {reversedPairCount > 0 ? (
                // UI-022: said out loud rather than left to be inferred from four figures that no
                // longer match the journal line by line.
                <p className="pd-note">
                  {reversedPairCount === 1
                    ? "One entry a correction reversed is left out, with its mirror: "
                    : `${reversedPairCount} entries a correction reversed are left out, with their mirrors: `}
                  a reversal puts our own books right. Both sides are in the money view.
                </p>
              ) : null}
            </section>

            <section className="card">
              <h2>Broker</h2>
              <dl className="pd-facts">
                <div>
                  <dt>Name</dt>
                  <dd>{policy.brokerName}</dd>
                </div>
                <div>
                  <dt>Verification</dt>
                  <dd>
                    <Chip tone={kyb.status === "approved" ? "ok" : "warn"}>{kyb.status}</Chip>
                  </dd>
                </div>
                <div>
                  <dt>Customer</dt>
                  <dd>{policy.customerEmail}</dd>
                </div>
              </dl>
              <p className="pd-note">{kyb.explanation}</p>
              {kyb.isProviderEvidence ? null : (
                <p className="pd-note">{KYB_NOT_LIVE_LABEL}. The status above is a seeded placeholder, not provider evidence.</p>
              )}
            </section>

            <section className="card pd-form-card">
              <h2>Documents</h2>
              <DocumentForms policyId={policy.policyId} documentDate={documentDate} termStart={policy.effectiveAt} />
            </section>
          </div>

          {/* Slice B13-6: what the customer has asked for on this policy, and the box to answer
              one. A request moves no money and changes nothing; the change itself goes through
              Endorse, in the band. */}
          <CustomerChangeRequestsPanel policyId={policy.policyId} canReply={isOwningBroker || user.role === "staff_ops"} now={now} />

          <About>
            <h4>In force is not collected</h4>
            <p>
              The terms in force are today&apos;s premium and limits. What was actually collected and refunded is in the
              endorsements view, the money view and the journal, never in the terms.
            </p>
            <h4>Total</h4>
            <p>
              The annual premium plus the state premium tax and the flat policy fee, in force on the date named under the
              figures: today, or the first day of the term when the term has not begun.
            </p>
            <h4>Endorse, cancel, correct</h4>
            <p>
              An endorsement is priced from its effective date over the days remaining in the term; once this term&apos;s
              endorsements add more than {formatCentsAsUsd(CUSTOMER_APPROVAL_THRESHOLD_CENTS)} of premium the customer
              approves first, and it takes effect when the delta is paid. A cancellation refunds the unearned premium pro
              rata and claws back the commission on it. A correction never changes a row: it reverses and re-books.
            </p>
            <h4>Paid, not bound</h4>
            <p>
              The customer&apos;s money arrived while the broker was not eligible to bind, so it sits in the suspense
              account until staff operations bind the policy or send it back.
            </p>
          </About>
        </>
      ) : null}

      {view === "endorsements" ? (
        <>
          {liveEndorsement ? (
            <EndorsementInProgress
              endorsement={liveEndorsement}
              policyId={policy.policyId}
              isOwningBroker={isOwningBroker}
              isStaffOperations={user.role === "staff_ops"}
              now={now}
            />
          ) : null}

          <DataTable
            ariaLabel="Endorsement schedule"
            legend={
              <Legend
                items={[
                  { term: "Prorated delta", meaning: "the money that moved, priced over the days left in the term" },
                  { term: "New annual premium", meaning: "the yearly rate after the change, not the money that moved" },
                  { term: "Ref", meaning: "the Stripe reference of the money that moved, in the row's details" },
                ]}
              />
            }
          >
            <thead>
              <tr>
                <ExpandHead />
                <th className="nowrap">Effective</th>
                <th>Change</th>
                <th className="num">Prorated delta</th>
                <th className="num">New annual premium</th>
                <th>Ref</th>
              </tr>
            </thead>
            {schedule.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={6} className="dt-empty">
                    <EmptyState illustration="closed-folder">No endorsement is in force on this policy.</EmptyState>
                  </td>
                </tr>
              </tbody>
            ) : (
              schedule.map((row) => (
                <ExpandRow
                  key={row.endorsedEventId}
                  columns={5}
                  cells={
                    <>
                      <td className="nowrap">
                        {row.effectiveAt}
                        <span className="dt-sub">
                          <When instant={row.recordedAt} now={now} />
                        </span>
                      </td>
                      <td>
                        {formatCentsAsUsd(row.figures.oldAnnualPremiumCents)} to{" "}
                        {formatCentsAsUsd(row.figures.newAnnualPremiumCents)}
                        {row.correctedFromEffectiveAt ? <span className="dt-sub">corrected date</span> : null}
                      </td>
                      <Num
                        sub={`${formatCentsAsUsd(row.figures.deltaPremiumCents)} premium, ${formatCentsAsUsd(row.figures.deltaTaxCents)} tax`}
                      >
                        {/* Slice B12-2: the fold reuses the endorsement's OWN formula lines,
                            rebuilt from the figures stored on the event by the same function
                            that priced it (endorsementFormulaLines), and points at their total
                            line. The line the fold points at IS figures.deltaTotalCents, the
                            amount posted to the journal, so that comparison alone could never
                            fail; `recheck` is the one that can, because it prices the endorsement
                            again from the inputs stored on the same event (F-INT-05). */}
                        <AmountExplained
                          amountCents={row.figures.deltaTotalCents}
                          size="inline"
                          label={`Prorated delta of the endorsement effective ${row.effectiveAt}`}
                          explanation={{
                            lines: row.lines,
                            resultKey: "delta_total",
                            recheck: row.recheck,
                            rounding:
                              row.figures.direction === "refund"
                                ? "Rounded up (ceil) on the premium given back and its tax: the customer receives this, so the fraction of a cent goes their way. Commission is rounded down."
                                : "Rounded down (floor) on the premium charged and its tax: the customer pays this, so the insurer absorbs the fraction of a cent.",
                            note: `${row.figures.daysRemaining} of ${row.figures.termDays} days remained from ${row.effectiveAt}. The delta is the money that moved, not the change in the annual premium.`,
                            evidence: row.stripeReferences.map((reference) => ({
                              entryType: "Stripe reference",
                              effectiveAt: row.effectiveAt,
                              recordedAt: row.recordedAt,
                              detail: reference,
                            })),
                            evidenceLabel:
                              "The Stripe references of the money that moved for this endorsement (the journal entries are in the money view).",
                          }}
                        />
                      </Num>
                      <Num>{formatCentsAsUsd(row.figures.newAnnualPremiumCents)}</Num>
                      <td>
                        {row.stripeReferences.length > 0 ? (
                          <Ref value={row.stripeReferences[0]} />
                        ) : (
                          <span className="dt-muted">none</span>
                        )}
                      </td>
                    </>
                  }
                >
                  <FactGrid
                    items={[
                      { label: "What changed", value: row.description },
                      { label: "Limits after it", value: row.newLimitLabel },
                      { label: "Days left in the term", value: `${row.figures.daysRemaining} of ${row.figures.termDays}` },
                      { label: "Recorded", value: <When instant={row.recordedAt} now={now} mode="utc" /> },
                      ...(row.correctedFromEffectiveAt
                        ? [{ label: "Entered as", value: `${row.correctedFromEffectiveAt}, put right to ${row.effectiveAt}` }]
                        : []),
                    ]}
                  />
                  <SandboxReferences
                    references={
                      row.stripeReferences.length > 0
                        ? row.stripeReferences.map((reference, index) => ({ label: `Stripe reference ${index + 1}`, value: reference }))
                        : [{ label: "Stripe references", value: null }]
                    }
                  />
                  <FormulaLinesTable lines={row.lines} />
                </ExpandRow>
              ))
            )}
          </DataTable>

          {/* Slice B8: the live-fire test of this view. Staff operations can put a wrong effective
              date right; the preview shows the whole impact before anything is written. It is a
              primary action, so it is an open card and not a fold (F-YA-05). */}
          {user.role === "staff_ops" && policy.status === "bound" && schedule.length > 0 ? (
            <section className="card pd-form-card">
              <h2>Correct an effective date</h2>
              <CorrectEndorsementDateForm
                policyId={policy.policyId}
                endorsedEventId={schedule[schedule.length - 1].endorsedEventId}
                effectiveAt={schedule[schedule.length - 1].effectiveAt}
                termStart={policy.effectiveAt}
                termEnd={policy.termEnd}
              />
            </section>
          ) : null}

          {historicalRequests.length > 0 ? (
            <section className="card">
              <h2>Superseded requests</h2>
              <p className="pd-note">
                Quotes replaced by a later change before they took effect. Nothing was collected or applied for them
                {historicalRequests.some((request) => request.collection?.applicationRefusedReason)
                  ? ", except where a payment is noted below."
                  : "."}
              </p>
              <ul className="aside-list">
                {historicalRequests.map((request) => (
                  <li key={request.request.eventId} className="pd-note">
                    {request.request.recordedAt.toISOString().replace("T", " ").slice(0, 19)} UTC:{" "}
                    {request.request.description}, effective {request.request.figures.effectiveAt},{" "}
                    {formatCentsAsUsd(request.request.figures.deltaTotalCents)}
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
            </section>
          ) : null}

          {canChange && liveEndorsement && (isOwningBroker || user.role === "staff_ops") ? (
            <p className="note">
              Requesting another change now would replace the quote in progress (its hash would no longer match).{" "}
              <Link
                href={`/policies/${policy.policyId}/endorse?effectiveAt=${liveEndorsement.request.figures.effectiveAt}&newAnnualPremium=${(liveEndorsement.request.figures.newAnnualPremiumCents / 100).toFixed(2)}&newPerOccurrenceLimit=${(liveEndorsement.request.newPerOccurrenceLimitCents / 100).toFixed(2)}&newAggregateLimit=${(liveEndorsement.request.newAggregateLimitCents / 100).toFixed(2)}`}
              >
                Re-quote the same change
              </Link>
              .
            </p>
          ) : null}

          <About>
            <h4>Prorated delta</h4>
            <p>
              The money that actually moved: the annual premium difference priced over the days remaining from the
              effective date to the end of the term, plus the state premium tax on it, rounded in the customer&apos;s
              favour. It is not the change in the annual premium, which is the last column.
            </p>
            <h4>A change in progress</h4>
            <p>
              The policy terms stay as they are until the delta is paid. Above{" "}
              {formatCentsAsUsd(CUSTOMER_APPROVAL_THRESHOLD_CENTS)} of additional premium in the term, the customer
              approves the quote from their own screen first.
            </p>
            <h4>Correcting a date</h4>
            <p>
              A correction reverses what was booked and re-books the endorsement on the right date. Nothing is deleted,
              and the money already collected stays where it is; the difference is collected or given back.
            </p>
          </About>
        </>
      ) : null}

      {view === "claims" ? (
        <>
          <DataTable
            ariaLabel="Policy claims"
            legend={
              <Legend
                items={[
                  { term: "Reserve", meaning: "what the claim is still expected to cost" },
                  { term: "Incurred", meaning: "paid plus the reserve still outstanding" },
                  { term: "LOCAL SIMULATOR", meaning: "claim payments move on a simulated rail, never a live one" },
                ]}
              />
            }
          >
            <thead>
              <tr>
                <th>Claim</th>
                <th className="nowrap">Loss</th>
                <th>State</th>
                <th className="num">Reserve</th>
                <th className="num">Paid</th>
                <th className="num">Incurred</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {claims.length === 0 ? (
                <tr>
                  <td colSpan={7} className="dt-empty">
                    <EmptyState illustration="umbrella">No claim on this policy.</EmptyState>
                  </td>
                </tr>
              ) : (
                claims.map((claim) => (
                  // Only staff work on a claim, so only staff get the link to its screen.
                  <Row key={claim.claimId} href={isStaff ? `/ops/claims/${claim.claimId}` : undefined}>
                    <Primary href={isStaff ? `/ops/claims/${claim.claimId}` : undefined} sub={claim.claimantName}>
                      {claim.claimNumber}
                    </Primary>
                    <td className="nowrap">{claim.occurredAt}</td>
                    <td>
                      <Chip tone={claim.position.isClosed ? "neutral" : "warn"}>{claim.position.isClosed ? "closed" : "open"}</Chip>
                    </td>
                    <Num>{formatCentsAsUsd(claim.position.reserveCents)}</Num>
                    <Num>{formatCentsAsUsd(claim.position.paidCents)}</Num>
                    <Num>{formatCentsAsUsd(claim.position.incurredCents)}</Num>
                    <Chevron />
                  </Row>
                ))
              )}
            </tbody>
          </DataTable>

          <About>
            <h4>Incurred, reserve, paid</h4>
            <p>
              Incurred is what a claim has cost so far: paid plus the reserve still outstanding. A claim can be opened on
              a cancelled policy too, as long as the loss happened while the policy was in force.
            </p>
            <h4>Cancelling with a claim open</h4>
            <p>
              Cancelling never touches an open claim or its reserve. The refund covers unearned premium only, because the
              loss happened while the policy was in force.
            </p>
          </About>
        </>
      ) : null}

      {view === "money" ? (
        <>
          <section className="card">
            <h2>So far, from the journal</h2>
            <LedgerSoFarFacts
              ledger={ledger}
              entries={entriesStillStanding}
              operation={operation}
              openClaims={openClaims.length}
              openClaimReserveCents={openClaimReserveCents}
            />
            {reversedPairCount > 0 ? (
              <p className="pd-note">
                {reversedPairCount === 1
                  ? "One entry a correction reversed is left out of these sums, with its mirror: "
                  : `${reversedPairCount} entries a correction reversed are left out of these sums, with their mirrors: `}
                a reversal puts our own books right, it is not money coming back from Stripe. Both sides are in the
                journal below, where each reversal names the entry it mirrors.
              </p>
            ) : null}
          </section>

          {cancellation ? (
            <section className="card">
              <h2>Cancellation</h2>
              <p className="pd-note">
                Effective {cancellation.effectiveAt}, method {cancellation.calculationMethod}, recorded{" "}
                <When instant={cancellation.recordedAt} now={now} mode="utc" />.
              </p>
              {/* Slice B12-2: every figure of this card carries its own fold. All seven show the
                  SAME table of lines, built once from the figures the cancellation event stored
                  (lib/money/explain.ts, cancellationFormulaLines), each pointing at a different
                  line of it, so the seven folds cannot tell seven different stories. */}
              <dl className="pd-facts">
                <div>
                  <dt>Written premium</dt>
                  <dd>
                    <AmountExplained
                      amountCents={cancellation.writtenPremiumCents}
                      size="inline"
                      label="Written premium on this policy"
                      explanation={explainCancellationFigure(cancellation, "written_premium")}
                    />
                  </dd>
                </div>
                <div>
                  <dt>
                    Earned, {cancellation.earnedDays} of {cancellation.termDays} days
                  </dt>
                  <dd>
                    <AmountExplained
                      amountCents={cancellation.earnedPremiumCents}
                      size="inline"
                      label="Premium earned up to the cancellation date"
                      explanation={{
                        ...explainCancellationFigure(cancellation, "earned_premium", evidenceFromJournal(entries, "earned_premium")),
                        evidenceLabel: "The entries that moved premium from unearned to earned.",
                      }}
                    />
                  </dd>
                </div>
                <div>
                  <dt>Unearned, refunded</dt>
                  <dd>
                    <AmountExplained
                      amountCents={cancellation.unearnedPremiumCents}
                      size="inline"
                      label="Unearned premium given back to the customer"
                      explanation={explainCancellationFigure(cancellation, "unearned_premium")}
                    />
                  </dd>
                </div>
                <div>
                  <dt>
                    {policy.stateCode} tax back ({(cancellation.taxRateBps / 100).toFixed(2)}%)
                  </dt>
                  <dd>
                    <AmountExplained
                      amountCents={cancellation.refundedTaxCents}
                      size="inline"
                      label={`${policy.stateCode} premium tax given back with the refunded premium`}
                      explanation={explainCancellationFigure(cancellation, "refunded_tax")}
                    />
                  </dd>
                </div>
                <div>
                  <dt>Policy fee back</dt>
                  <dd>
                    <AmountExplained
                      amountCents={cancellation.refundedFeeCents}
                      size="inline"
                      label="Policy fee given back"
                      explanation={explainCancellationFigure(cancellation, "refunded_fee")}
                    />
                  </dd>
                </div>
                <div>
                  <dt>Total refunded</dt>
                  <dd>
                    <AmountExplained
                      amountCents={cancellation.totalRefundCents}
                      size="inline"
                      label="Total refunded to the customer through Stripe"
                      explanation={{
                        ...explainCancellationFigure(cancellation, "total_refund", evidenceFromJournal(entries, "refund_payable")),
                        evidenceLabel: "The entries that opened the refund and, once Stripe confirmed it, sent the cash back.",
                      }}
                    />
                  </dd>
                </div>
                <div>
                  <dt>Commission clawback ({(cancellation.commissionRateBps / 100).toFixed(2)}%)</dt>
                  <dd>
                    <AmountExplained
                      amountCents={cancellation.commissionClawbackCents}
                      size="inline"
                      label="Broker commission clawed back on the refunded premium"
                      explanation={{
                        ...explainCancellationFigure(cancellation, "commission_clawback", evidenceFromJournal(entries, "commission_payable")),
                        evidenceLabel:
                          "Every entry that moved this broker's commission payable on this policy: the commission earned at collection, then the clawback.",
                      }}
                    />
                  </dd>
                </div>
              </dl>
              {cancellation.taxRefundWasCappedAtCharged ? (
                <p className="pd-note">
                  The tax refund was capped at the premium tax actually charged: rounding it up would have given back a
                  cent that was never collected.
                </p>
              ) : null}
              {openClaims.length > 0 ? (
                <p className="pd-note">
                  The cancellation did not touch the open claim: it keeps its reserve of{" "}
                  {formatCentsAsUsd(openClaimReserveCents)}, anything already paid on it stays paid, and the refund
                  covers unearned premium only. The clawback follows the refunded premium alone, for the same reason.
                </p>
              ) : null}
            </section>
          ) : null}

          {refunds.length > 0 ? (
            <DataTable
              ariaLabel="Refunds"
              legend={
                <Legend
                  items={[
                    { term: "requested", meaning: "recorded and owed, nothing sent to Stripe yet" },
                    { term: "awaiting approval", meaning: "above the threshold, a second person decides before anything is sent" },
                    { term: "completed", meaning: "Stripe's webhook confirmed the money left" },
                  ]}
                />
              }
            >
              <thead>
                <tr>
                  <ExpandHead />
                  <th>State</th>
                  <th className="num">Amount</th>
                  <th>Stripe</th>
                  <th>Action</th>
                </tr>
              </thead>
              {refunds.map((refund) => (
                <ExpandRow
                  key={refund.operationId}
                  columns={4}
                  cells={
                    <>
                      <td>
                        {/* Requested and completed are never mixed up: money asked for is not money
                            the customer has received. Above $1,000 a third state sits in front of
                            both: the refund is recorded and owed, and it is not going anywhere
                            until a second person approves it (slice B7, /ops/approvals). */}
                        <Chip tone={refundTone(refund)}>{refundState(refund)}</Chip>
                        {refund.completedOn ? <span className="dt-sub">{refund.completedOn}</span> : null}
                      </td>
                      <Num>{formatCentsAsUsd(refund.amountCents)}</Num>
                      <td>
                        {refund.refundId ? (
                          <Ref value={refund.refundId} />
                        ) : (
                          <span className="dt-muted">not created yet</span>
                        )}
                      </td>
                      <td className="dt-actions">
                        {/* Slice B7: one button for two situations. A refund above $1,000 that a
                            second person has approved, and a refund stuck in 'requested' because
                            the process died before Stripe was called (review finding F-B5-03).
                            Both are sent with the operation's own idempotency key, so Stripe can
                            never create a second refund for it. */}
                        {refund.failureReason && user.role === "staff_ops" ? (
                          <form
                            method="post"
                            action={`/api/policies/${policy.policyId}/refunds/${refund.operationId}/reissue`}
                            className="inline-form"
                          >
                            <SubmitButton className="secondary">
                              {refund.failureStage === "approval" ? "Ask again" : "Re-issue"}
                            </SubmitButton>
                          </form>
                        ) : null}
                        {refund.state === "requested" &&
                        user.role === "staff_ops" &&
                        (!refund.approvalRequestId || refund.approvalDecision === "approved") ? (
                          <form
                            method="post"
                            action={`/api/policies/${policy.policyId}/refunds/${refund.operationId}/send`}
                            className="inline-form"
                          >
                            <SubmitButton>Send to Stripe</SubmitButton>
                          </form>
                        ) : null}
                      </td>
                    </>
                  }
                >
                  <FactGrid
                    items={[
                      { label: "Premium", value: formatCentsAsUsd(refund.refundedPremiumCents) },
                      { label: "Tax", value: formatCentsAsUsd(refund.refundedTaxCents) },
                      { label: "Commission clawback", value: formatCentsAsUsd(refund.commissionClawbackCents) },
                      ...(refund.failureReason ? [{ label: "Why it failed", value: refund.failureReason }] : []),
                    ]}
                  />
                  {refund.failureReason ? (
                    <p className="pd-note">
                      The customer is still owed this money: nothing was reversed in the ledger, and the refund stays
                      open until a new one completes.
                    </p>
                  ) : null}
                  {refund.state === "requested" && refund.approvalRequestId && refund.approvalDecision !== "approved" ? (
                    <p className="pd-note">
                      Above the approval threshold: it waits in <Link href="/ops/approvals">the approvals queue</Link>{" "}
                      until a second person decides.
                    </p>
                  ) : null}
                  {refund.failedAfterCompletion ? (
                    <p className="error" role="alert">
                      Stripe reported a failure after this refund had completed. Nothing was reversed automatically: an
                      operator has to decide whether the cash came back and post a reversal.
                    </p>
                  ) : null}
                  <SandboxReferences
                    references={[
                      { label: "Stripe Refund", value: refund.refundId },
                      { label: "On Stripe PaymentIntent", value: refund.paymentIntentId },
                      { label: "Money operation id", value: refund.operationId },
                      { label: "Approval request id", value: refund.approvalRequestId },
                    ]}
                  />
                </ExpandRow>
              ))}
            </DataTable>
          ) : null}

          {/* Slice B8: backdated corrections, both clocks, and what they did to the money. */}
          <CorrectionsExplained policyId={policy.policyId} canPay={isOwningBroker || user.role === "staff_ops"} now={now} />

          <section className="card">
            <h2>Journal entries</h2>
            {entries.length === 0 ? (
              <EmptyState illustration="open-ledger">
                Nothing has been posted yet. The four issuance entries are written when Stripe confirms the payment.
              </EmptyState>
            ) : (
              <JournalTable entries={entries} panelKey="policy" ariaLabel="Policy journal" />
            )}
          </section>

          <About>
            <h4>Where a figure comes from</h4>
            <p>
              Each sum above is the addition of the journal lines of this policy; open one to see the lines it added and
              follow it to the entry that proves it. Nothing here is recomputed from the terms.
            </p>
            <h4>A correction never changes a row</h4>
            <p>
              It appends a reversal entry mirroring the original on the same effective date, and a re-booked event on the
              corrected date. Both stay in the journal for ever.
            </p>
            <h4>Refunds</h4>
            <p>
              A refund counts as completed only when Stripe&apos;s webhook confirms the money left. A failed refund
              reverses nothing: the customer is still owed the money.
            </p>
          </About>
        </>
      ) : null}

      {view === "timeline" ? (
        <>
          <PolicyTimeline policyId={policy.policyId} now={now} />
          {/* UI-020: the key is the date the page was asked for. Following one of the step links
              is a client-side navigation, so React keeps the same date input; a field the reader
              had already typed in keeps what they typed (the browser's dirty value flag) while
              the panel beside it answers another date, and the next submit silently goes back to
              the typed one. A new key builds a new field, which starts on the date that was
              applied. Nothing else changes: the answer is still server-rendered and the form is
              still a plain GET. */}
          <PolicyAsOf key={asOfRequested ?? "default"} policyId={policy.policyId} asOf={asOfRequested} termStart={policy.effectiveAt} today={today} />

          <About>
            <h4>Two clocks, never merged</h4>
            <p>
              Effective is the business date a fact applies from: it prices the money, and it can be in the past or in
              the future. Recorded is the instant the row was written, set by the database and never by a client: it
              answers what we knew that day.
            </p>
            <h4>A struck-through row</h4>
            <p>
              It was superseded by a correction. The row stays in the table for ever; the fold that rebuilds the policy
              no longer applies it.
            </p>
          </About>
        </>
      ) : null}

      {view === "documents" ? (
        <>
          <div className="cards">
            <section className="card pd-form-card">
              <h2>Documents as of a date</h2>
              <DocumentForms policyId={policy.policyId} documentDate={documentDate} termStart={policy.effectiveAt} />
            </section>
            <section className="card">
              <h2>Dates this policy changed</h2>
              <PolicyChangeSteps
                policyId={policy.policyId}
                termStart={policy.effectiveAt}
                today={today}
                hrefForDate={(date) => withParams(path, query, { view: "timeline", asOf: date })}
                currentDate={asOfRequested}
              />
              <p className="pd-note">
                The term start, every change still in force, and today. A change a correction put right is not a step.
              </p>
            </section>
          </div>

          <About>
            <h4>Rebuilt, not stored</h4>
            <p>
              Real PDFs rebuilt from the events effective on or before the date: between two endorsements the
              declarations page shows the premium and limits in force that day.
            </p>
            <h4>The same date on the screen</h4>
            <p>The timeline view answers the same question on the page, with the written premium segments behind it.</p>
          </About>
        </>
      ) : null}
    </PortalShell>
  );
}

// The two as-of document forms, on the overview and in the documents view. Same action, same
// method, same field name as before: the route reads `asOf` and rebuilds the PDF from the events.
function DocumentForms({ policyId, documentDate, termStart }: { policyId: string; documentDate: string; termStart: string }) {
  return (
    <div className="pd-stack">
      <form method="get" action={`/api/policies/${policyId}/documents/declarations`} className="card">
        <label htmlFor="asOfDeclarations">Declarations page as of</label>
        <input id="asOfDeclarations" name="asOf" type="date" defaultValue={documentDate} min={termStart} required />
        <button type="submit" className="secondary">
          Open the declarations page (PDF)
        </button>
      </form>
      <form method="get" action={`/api/policies/${policyId}/documents/endorsement-schedule`} className="card">
        <label htmlFor="asOfSchedule">Endorsement schedule as of</label>
        <input id="asOfSchedule" name="asOf" type="date" defaultValue={documentDate} min={termStart} required />
        <button type="submit" className="secondary">
          Open the endorsement schedule (PDF)
        </button>
      </form>
    </div>
  );
}

// The four sums the journal already says about this policy, each with the fold that lists the
// lines it added. Printed on the overview and again at the top of the money view, from the same
// figures: two views, one reading.
function LedgerSoFarFacts({
  ledger,
  entries,
  operation,
  openClaims,
  openClaimReserveCents,
}: {
  ledger: ReturnType<typeof ledgerSoFar>;
  entries: JournalEntryView[];
  operation: Awaited<ReturnType<typeof checkoutOperationOfPolicy>>;
  openClaims: number;
  openClaimReserveCents: number;
}) {
  return (
    <dl className="pd-facts">
      <div>
        <dt>Premium payment</dt>
        <dd>
          {operation ? operation.latestStatus ?? "none" : "not started"}
          {operation ? (
            <SandboxReferences
              references={[
                { label: "Money operation id", value: operation.operationId },
                { label: "Stripe Checkout Session", value: operation.providerRef },
              ]}
            />
          ) : null}
        </dd>
      </div>
      {/* Slice B12-2: each of these four folds lists the journal lines that were summed, and its
          total comes from the same accountSumCents call that produced the figure beside it. */}
      <div>
        <dt>Collected at Stripe</dt>
        <dd>
          <AmountExplained
            amountCents={ledger.collectedCents}
            size="inline"
            label="Money that arrived on the Stripe cash account for this policy"
            explanation={explainAccountSum({
              entries,
              accountId: "cash_stripe",
              rule: "debits",
              totalLabel: "Collected at Stripe, all debits added",
              note: "Every debit of cash_stripe on this policy that a correction has not reversed: the premium collection and any endorsement or correction difference the customer paid.",
            })}
          />
        </dd>
      </div>
      <div>
        <dt>Refunded from Stripe</dt>
        <dd>
          <AmountExplained
            amountCents={ledger.refundedCents}
            size="inline"
            label="Money that left the Stripe cash account for this policy"
            explanation={explainAccountSum({
              entries,
              accountId: "cash_stripe",
              rule: "credits",
              totalLabel: "Refunded from Stripe, all credits added",
              note: "Every credit of cash_stripe on this policy that is not the mirror of a reversed entry. A refund appears here only once Stripe's webhook confirms the money left.",
            })}
          />
        </dd>
      </div>
      <div>
        <dt>Commission owed, net</dt>
        <dd>
          <AmountExplained
            amountCents={ledger.commissionNetCents}
            size="inline"
            label="Balance of this broker's commission payable on this policy"
            explanation={explainAccountSum({
              entries,
              accountId: "commission_payable",
              rule: "credits_minus_debits",
              totalLabel: "Commission payable, credits minus debits",
              note: "Commission earned when premium was collected, less every clawback on premium given back. Entries a correction reversed, and their mirrors, are left out.",
            })}
          />
        </dd>
      </div>
      <div>
        <dt>Unearned premium held</dt>
        <dd>
          <AmountExplained
            amountCents={ledger.unearnedPremiumCents}
            size="inline"
            label="Balance of unearned premium on this policy"
            explanation={explainAccountSum({
              entries,
              accountId: "unearned_premium",
              rule: "credits_minus_debits",
              totalLabel: "Unearned premium, credits minus debits",
              note: "Premium written and not yet earned: what would be owed back if the policy stopped today. Entries a correction reversed, and their mirrors, are left out.",
            })}
          />
        </dd>
      </div>
      <div>
        <dt>Open claims</dt>
        <dd>{openClaims === 0 ? "none" : `${openClaims}, reserve ${formatCentsAsUsd(openClaimReserveCents)}`}</dd>
      </div>
    </dl>
  );
}

// What the journal already says about this policy, as plain sums of the lines shown on the page.
// Debits on the Stripe cash account are money that arrived, credits are money that left; the
// commission payable and unearned premium balances are credits minus debits. No proration, no
// rounding: a reader can check each figure against the journal table.
//
// Slice B12-2: the four sums and the four folds that explain them call the SAME function
// (accountSumCents, lib/money/explain.ts), so a fold listing the lines cannot come to a different
// total from the figure it sits under.
function ledgerSoFar(entries: JournalEntryView[]) {
  return {
    collectedCents: accountSumCents(entries, "cash_stripe", "debits"),
    refundedCents: accountSumCents(entries, "cash_stripe", "credits"),
    commissionNetCents: accountSumCents(entries, "commission_payable", "credits_minus_debits"),
    unearnedPremiumCents: accountSumCents(entries, "unearned_premium", "credits_minus_debits"),
  };
}

// One toast, when the route sent the page back with that parameter. The long sentence stays in
// the notices block under the band; this is the same event in one line.
function toast(param: string, value: string | undefined, tone: ToastNotice["tone"], title: string, text: string): ToastNotice[] {
  if (value === undefined || value.trim() === "") return [];
  return [{ tone, title, text, param }];
}

// The state of a refund in one word, and its colour. Requested and completed are never mixed up.
function refundState(refund: RefundOperationView): string {
  if (refund.state === "completed") return "completed";
  if (refund.state === "failed") return refund.failureStage === "approval" ? "rejected" : "failed";
  if (refund.approvalRequestId && refund.approvalDecision !== "approved") {
    return refund.approvalDecision === "rejected" ? "rejected" : "awaiting approval";
  }
  return refund.state === "accepted" ? "sent" : "requested";
}

function refundTone(refund: RefundOperationView): "ok" | "warn" | "neutral" {
  if (refund.state === "completed") return "ok";
  if (refund.state === "failed" || refund.approvalDecision === "rejected") return "warn";
  return "neutral";
}

// The endorsement that is neither applied nor superseded: where it stands and what to do next.
// Every figure comes from the immutable request event; every button is a form that the server
// checks again. A primary action is never hidden (F-YA-05), so the forms are in an open card.
function EndorsementInProgress({
  endorsement,
  policyId,
  isOwningBroker,
  isStaffOperations,
  now,
}: {
  endorsement: EndorsementView;
  policyId: string;
  isOwningBroker: boolean;
  isStaffOperations: boolean;
  now: Date;
}) {
  const { request, standing, collection } = endorsement;
  const figures = request.figures;
  const paymentInFlight = collection && !collection.isDead && collection.latestStatus !== "succeeded" && collection.checkoutUrl;

  return (
    <section className="card">
      <h2>
        Endorsement in progress
        {standing.state === "awaiting_approval" ? (
          <Chip tone="warn">awaiting the customer</Chip>
        ) : (
          <Chip tone="ok">approved</Chip>
        )}
      </h2>
      <FactGrid
        items={[
          { label: "Effective", value: figures.effectiveAt },
          { label: "Requested", value: <When instant={request.recordedAt} now={now} mode="utc" /> },
          { label: "Change", value: request.description },
          { label: "Delta to settle", value: formatCentsAsUsd(figures.deltaTotalCents) },
          ...(request.reason ? [{ label: "Reason", value: request.reason }] : []),
          ...(standing.approvedAt
            ? [{ label: "Approved", value: <When instant={standing.approvedAt} now={now} mode="utc" /> }]
            : []),
        ]}
      />
      <p className="pd-note">
        The policy terms stay as they are until the delta is paid.
        {standing.state === "awaiting_approval"
          ? ` This endorsement takes the additional premium above ${formatCentsAsUsd(CUSTOMER_APPROVAL_THRESHOLD_CENTS)}, so the customer approves from their own screen first.`
          : ""}
      </p>

      <FormulaLinesTable lines={endorsement.lines} />

      {collection ? (
        // A div, not a p: a details element is not allowed inside a paragraph.
        <div className="pd-note">
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
              <SubmitButton>Apply now that the broker is eligible</SubmitButton>
            </form>
          ) : (
            <p className="pd-note">Staff operations can apply it once the broker&apos;s verification passes.</p>
          )}
        </>
      ) : null}

      {standing.state === "approved" && isOwningBroker && !collection?.applicationRefusedReason ? (
        <form method="post" action={`/api/policies/${policyId}/endorsements/${request.eventId}/checkout`} className="inline-form">
          <input type="hidden" name="quoteHash" value={figures.quoteHash} />
          <SubmitButton>
            {paymentInFlight
              ? "Continue the delta payment at Stripe"
              : `Pay the delta (${formatCentsAsUsd(figures.deltaTotalCents)}) with Stripe (test mode)`}
          </SubmitButton>
        </form>
      ) : null}
      {standing.state === "approved" && !isOwningBroker ? (
        <p className="pd-note">The owning broker pays the delta from this page.</p>
      ) : null}
    </section>
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
    // "waiting for an approver", never "sent to Stripe": nothing has left, and the words the
    // banner uses here are the ones Yoann asked for (review finding F-YA-04).
    parts.push(`${waitingForApproval} is waiting for an approver, and nothing has been sent to Stripe`);
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
    "A refund counts as completed only when Stripe's webhook confirms the money left; the money view is the detail."
  );
}

// What the operator sees after a backdated correction (slice B8).
function correctionNotice(outcome: string): string {
  switch (outcome) {
    case "collect":
      return "The effective date is corrected. The endorsement is in force on the right date, and the difference is now owed by the customer: collect it from the money view.";
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
