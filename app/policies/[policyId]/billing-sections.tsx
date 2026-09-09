import type { ReactNode } from "react";
import { Chip } from "@/components/detail-layout";
import { Emphasis } from "@/components/emphasis";
import { DataTable, Num, Ref } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty";
import { When } from "@/components/ui/time";
import { formatCentsAsUsd } from "@/lib/money/cents";
import type { PolicyDetail, CheckoutOperationView, RefundOperationView } from "@/lib/policy/read";
import type { EndorsementView } from "@/lib/policy/endorsement-read";
import type { CorrectionView } from "@/lib/policy/correction-read";
import { openCollectionOf } from "./correction-sections";

// The Billing view of a policy: what is owed, what was paid, what is being refunded.
//
// Decision 43 (Yoann, 2026-09-09, live at 19:50Z): "on dit que le broker collecte, mais c'est lui
// qui paye ?". Every button that takes money sat in the broker's space with nothing saying whose
// card pays, so a broker reading "Collect the difference" could believe they were being billed.
// This view says it in one sentence and puts the three questions about money side by side.
//
// THIS FILE ONLY DRAWS. Every row below is built from rows the policy page already reads for its
// Money view: the issuance payment, the endorsements, the corrections and the refunds. Nothing
// here queries anything, and no amount is computed: the cents arrive in integer cents and are
// only formatted. The broker's page and the customer's page both call `billingRows` with their
// own rows, so the two screens cannot print different money for the same policy.

// The sentence under the title of the view. Two wordings of one fact: the broker takes the money,
// the card belongs to the customer.
export const AGENCY_BILL_SENTENCE_FOR_STAFF =
  "The broker collects on the customer's behalf (agency bill). The card entered on the Stripe page is the customer's.";
export const AGENCY_BILL_SENTENCE_FOR_CUSTOMER =
  "Your broker collects on your behalf; the card entered on the Stripe page is yours.";

// ---------------------------------------------------------------------------
// The three lists, built from the rows the page already read
// ---------------------------------------------------------------------------

export type OwedRow = {
  key: string;
  amountCents: number;
  what: string;
  // When the amount became owed. An instant, so the row can print it as an age.
  since: Date | null;
};

export type PaidRow = {
  key: string;
  amountCents: number;
  what: string;
  // The Stripe object this collection is known by, when the reader that produced the row carries
  // one. Null is printed as "no reference read", never as a blank.
  reference: string | null;
  // The UTC day the money arrived, as the provider reported it. Null while it has not.
  paidOn: string | null;
};

export type RefundRow = {
  key: string;
  amountCents: number;
  reference: string | null;
  state: string;
  tone: "ok" | "warn" | "neutral";
  // What has to happen next before the customer has the money, in one sentence.
  waitsFor: string;
};

export function billingRows({
  policy,
  payment,
  endorsements,
  corrections,
  refunds,
}: {
  policy: PolicyDetail;
  // The issuance payment of the policy itself, when the broker has started one.
  payment: CheckoutOperationView | null;
  endorsements: EndorsementView[];
  corrections: CorrectionView[];
  refunds: RefundOperationView[];
}): { owed: OwedRow[]; paid: PaidRow[]; refunded: RefundRow[] } {
  const owed: OwedRow[] = [];
  const paid: PaidRow[] = [];

  // 1. THE POLICY ITSELF. It is owed until it is bound, and the terms on the record are what a
  // full term costs. `boundAt` is the only instant the policy record carries, so a policy still
  // waiting for its payment has no "since" to print and says so by leaving the cell empty.
  if (policy.status === "draft" || policy.status === "awaiting_payment" || policy.status === "payment_failed") {
    owed.push({
      key: "policy-premium",
      amountCents: policy.totalChargeCents,
      what: "Policy premium, tax and fee",
      since: null,
    });
  }
  if (payment && payment.latestStatus === "succeeded") {
    paid.push({
      key: `payment-${payment.operationId}`,
      amountCents: payment.amountCents,
      what: "Policy premium, tax and fee",
      reference: payment.providerRef,
      // The issuance reader does not carry the day the money arrived; the policy was bound on it,
      // and that is the instant the record does carry.
      paidOn: policy.boundAt ? policy.boundAt.toISOString().slice(0, 10) : null,
    });
  }

  // 2. THE ENDORSEMENT DELTAS. Owed once the change is approved and until the delta is collected;
  // paid once the collection reports the day it arrived.
  for (const endorsement of endorsements) {
    const { request, standing, collection } = endorsement;
    if (standing.state === "approved" && (!collection || collection.latestStatus !== "succeeded")) {
      owed.push({
        key: `delta-${request.eventId}`,
        amountCents: request.figures.deltaTotalCents,
        what: `Endorsement delta, effective ${request.figures.effectiveAt}`,
        since: standing.approvedAt ?? request.recordedAt,
      });
    }
    if (collection?.paidOn) {
      paid.push({
        key: `delta-paid-${collection.operationId}`,
        amountCents: collection.amountCents,
        what: `Endorsement delta, effective ${request.figures.effectiveAt}`,
        reference: collection.paymentIntentId ?? collection.sessionId,
        paidOn: collection.paidOn,
      });
    }
  }

  // 3. THE CORRECTION DIFFERENCES. `openCollectionOf` is the same test the collect button below
  // is drawn from, asked with canPay=true because this is a list of what is owed, not of what
  // this reader may press.
  for (const correction of corrections) {
    const open = openCollectionOf(correction, true);
    if (open) {
      owed.push({
        key: `difference-${correction.rebookEventId}`,
        amountCents: open.amountCents,
        what: `Correction difference, effective date put right to ${correction.correctedEffectiveAt}`,
        since: correction.recordedAt,
      });
    }
    if (correction.collection?.paidOn) {
      paid.push({
        key: `difference-paid-${correction.collection.operationId}`,
        amountCents: correction.collection.amountCents,
        what: `Correction difference, effective date put right to ${correction.correctedEffectiveAt}`,
        // The correction reader carries no Stripe object; the collection is a money operation and
        // its own id is not a provider reference, so nothing is printed rather than a wrong one.
        reference: null,
        paidOn: correction.collection.paidOn,
      });
    }
  }

  const refunded: RefundRow[] = refunds.map((refund) => ({
    key: refund.operationId,
    amountCents: refund.amountCents,
    reference: refund.refundId,
    state: refundStateWord(refund),
    tone: refundStateTone(refund),
    waitsFor: refundWaitsFor(refund),
  }));

  return { owed, paid, refunded };
}

// The word the refund tables of this product use for a state, kept here so the Billing view and
// the Money view say the same word about the same refund.
export function refundStateWord(refund: RefundOperationView): string {
  if (refund.state === "completed") return "completed";
  if (refund.state === "failed") return refund.failureStage === "approval" ? "rejected" : "failed";
  if (refund.approvalRequestId && refund.approvalDecision !== "approved") {
    return refund.approvalDecision === "rejected" ? "rejected" : "awaiting approval";
  }
  return refund.state === "accepted" ? "sent" : "requested";
}

export function refundStateTone(refund: RefundOperationView): "ok" | "warn" | "neutral" {
  if (refund.state === "completed") return "ok";
  if (refund.state === "failed" || refund.approvalDecision === "rejected") return "warn";
  return "neutral";
}

// What still has to happen before the customer has this money, in one sentence.
function refundWaitsFor(refund: RefundOperationView): string {
  if (refund.state === "completed") {
    return refund.completedOn ? `Stripe confirmed the money left on ${refund.completedOn}.` : "Stripe confirmed the money left.";
  }
  if (refund.failureReason) {
    return refund.failureStage === "approval"
      ? "An approver refused it. The customer is still owed the money and nothing was reversed."
      : `It failed: ${refund.failureReason}. The customer is still owed the money and nothing was reversed.`;
  }
  if (refund.approvalRequestId && refund.approvalDecision !== "approved") {
    return "Above the approval threshold: a second person decides before anything is sent to Stripe.";
  }
  if (refund.state === "accepted") {
    return "Sent to Stripe. It counts as completed only when Stripe's webhook confirms the money left.";
  }
  return "Recorded and owed. Nothing has been sent to Stripe yet.";
}

// ---------------------------------------------------------------------------
// The three tables
// ---------------------------------------------------------------------------

// One reference cell. Staff can open the whole trail of a reference in the inspector; a broker
// and a customer read the same string without the console behind it.
function ReferenceCell({
  value,
  inspectHrefFor,
  inspected,
}: {
  value: string | null;
  inspectHrefFor?: (reference: string) => string;
  inspected?: string | null;
}) {
  if (!value) {
    return <span className="dt-muted">no reference read</span>;
  }
  return <Ref value={value} inspectHref={inspectHrefFor ? inspectHrefFor(value) : undefined} open={inspected === value} />;
}

export function WhatIsOwed({ rows, now }: { rows: OwedRow[]; now: Date }) {
  return (
    <section className="card">
      <h2>What is owed</h2>
      {rows.length === 0 ? (
        <EmptyState illustration="all-clear">Nothing is waiting to be collected on this policy.</EmptyState>
      ) : (
        <DataTable ariaLabel="Amounts owed">
          <thead>
            <tr>
              <th className="num">Amount</th>
              <th>What it is</th>
              <th>Since</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <Num>{formatCentsAsUsd(row.amountCents)}</Num>
                <td>{row.what}</td>
                <td className="nowrap">
                  {row.since ? <When instant={row.since} now={now} /> : <span className="dt-muted">not started</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </section>
  );
}

export function WhatWasPaid({
  rows,
  inspectHrefFor,
  inspected,
}: {
  rows: PaidRow[];
  inspectHrefFor?: (reference: string) => string;
  inspected?: string | null;
}) {
  return (
    <section className="card">
      <h2>What was paid</h2>
      {rows.length === 0 ? (
        <EmptyState illustration="open-ledger">Nothing has been collected on this policy yet.</EmptyState>
      ) : (
        <DataTable ariaLabel="Collections">
          <thead>
            <tr>
              <th>Stripe</th>
              <th>Paid on</th>
              <th className="num">Amount</th>
              <th>What it paid for</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>
                  <ReferenceCell value={row.reference} inspectHrefFor={inspectHrefFor} inspected={inspected} />
                </td>
                <td className="nowrap">{row.paidOn ?? <span className="dt-muted">not read</span>}</td>
                <Num>{formatCentsAsUsd(row.amountCents)}</Num>
                <td>{row.what}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </section>
  );
}

export function WhatIsBeingRefunded({
  rows,
  inspectHrefFor,
  inspected,
}: {
  rows: RefundRow[];
  inspectHrefFor?: (reference: string) => string;
  inspected?: string | null;
}) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <section className="card">
      <h2>What is being refunded</h2>
      <DataTable ariaLabel="Refunds in flight">
        <thead>
          <tr>
            <th>Stripe</th>
            <th>State</th>
            <th className="num">Amount</th>
            <th>What it waits for</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>
                <ReferenceCell value={row.reference} inspectHrefFor={inspectHrefFor} inspected={inspected} />
              </td>
              <td>
                <Chip tone={row.tone}>{row.state}</Chip>
              </td>
              <Num>{formatCentsAsUsd(row.amountCents)}</Num>
              {/* THE ONE CELL OF THIS FILE THAT IS EMPHASISED, and the exception is deliberate.
                  Bold does not belong in a table cell that holds an aligned value: an amount and a
                  date are read by position and the emphasis would fight the alignment. This column
                  holds a SENTENCE, one per refund, with the date Stripe confirmed inside it, which
                  is exactly what a reader is looking for. */}
              <td>
                <Emphasis>{row.waitsFor}</Emphasis>
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </section>
  );
}

// The three tables in the order the view reads them, so the broker's page and the customer's page
// cannot drift apart. The actions, which only the broker's page has, are drawn above this.
export function BillingSummary({
  rows,
  now,
  inspectHrefFor,
  inspected,
  lead,
}: {
  rows: { owed: OwedRow[]; paid: PaidRow[]; refunded: RefundRow[] };
  now: Date;
  inspectHrefFor?: (reference: string) => string;
  inspected?: string | null;
  // The agency-bill sentence, in the words of the reader this page belongs to. Optional because
  // a page that draws actions above these tables says it there instead, once.
  lead?: ReactNode;
}) {
  return (
    <>
      {/* The agency-bill sentence. A caller that hands a plain string gets its figures and its
          words emphasised; one that builds its own element keeps exactly what it built. */}
      {lead ? <p className="pd-lead">{typeof lead === "string" ? <Emphasis>{lead}</Emphasis> : lead}</p> : null}
      <WhatIsOwed rows={rows.owed} now={now} />
      <WhatWasPaid rows={rows.paid} inspectHrefFor={inspectHrefFor} inspected={inspected} />
      <WhatIsBeingRefunded rows={rows.refunded} inspectHrefFor={inspectHrefFor} inspected={inspected} />
    </>
  );
}
