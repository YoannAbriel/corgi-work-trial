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
import { openCollectionOf, withoutTrailingStop } from "./correction-sections";

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
  // When the amount became owed. An instant, so the row can print it as an age. Null only when no
  // reader on this page carries one, which the row then says in words rather than leaving blank.
  since: Date | null;
  // F-BL-03: why this amount cannot be collected right now, when something stands in the way.
  // Without it an owed row sat on the screen with no button and no reason.
  blockedReason?: string;
};

export type PaidRow = {
  key: string;
  amountCents: number;
  what: string;
  // The Stripe object this collection is known by, when the reader that produced the row carries
  // one. Null is printed as "not recorded", never as a blank (F-BL-07: one wording for both
  // columns, because "no reference read" beside "not read" read as two different facts).
  reference: string | null;
  // The UTC day the policy was bound by this payment. Null when no reader carries one.
  paidOn: string | null;
  // F-BL-01 (HIGH): a correction can reverse the issuance of a policy. The four entries are
  // mirrored, the policy becomes voided, and Stripe kept nothing. This row used to print
  // "$1,253.20 paid" with its Checkout Session as if it stood. Money that was reversed reads as
  // reversed: struck through, with a danger chip and the void record's own sentence.
  reversed?: { reason: string; recordedAt: Date };
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
  voidCorrection,
}: {
  policy: PolicyDetail;
  // The issuance payment of the policy itself, when the broker has started one.
  payment: CheckoutOperationView | null;
  endorsements: EndorsementView[];
  corrections: CorrectionView[];
  refunds: RefundOperationView[];
  // The correction that reversed the issuance of this policy, when there is one: it is what makes
  // a policy `voided`. Both pages read it from lib/policy/read.ts.
  voidCorrection: { reason: string; recordedAt: Date } | null;
}): { owed: OwedRow[]; paid: PaidRow[]; refunded: RefundRow[] } {
  const owed: OwedRow[] = [];
  const paid: PaidRow[] = [];

  // 1. THE POLICY ITSELF. It is owed until it is bound, and the terms on the record are what a
  // full term costs. F-BL-06: `boundAt` is the only instant PolicyDetail carries, and a policy
  // waiting for its payment has not got one. The inbox prints the quote's age from `quotedAt`,
  // which is on PolicySummary and NOT on PolicyDetail; adding it would mean changing a reader
  // under lib/, which this work may not do. The cell says "no date recorded" instead of the
  // "not started" it used to say, which was a claim about the payment and not about the date.
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
      // F-BL-05: the issuance reader carries no day of its own, so this is the day the policy was
      // bound, which is the same event: binding is what a confirmed payment causes. On a policy
      // that was paid and not bound, or voided, there is no such day. The column is named "Bound
      // on" for exactly that reason, so it names what it holds instead of promising a paid date.
      paidOn: policy.boundAt ? policy.boundAt.toISOString().slice(0, 10) : null,
      // F-BL-01: a voided policy's issuance was reversed in the journal and Stripe kept nothing.
      reversed: voidCorrection ? { reason: voidCorrection.reason, recordedAt: voidCorrection.recordedAt } : undefined,
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
        // F-BL-03: the money reached Stripe but the endorsement could not be applied, so there is
        // no button to press. The row says why instead of sitting there mute.
        blockedReason: collection?.applicationRefusedReason
          ? `Paid, not applied: ${collection.applicationRefusedReason}. Staff operations apply it once that is put right.`
          : undefined,
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
    // F-BL-07: one wording for every "we do not hold this" cell of these tables.
    return <span className="dt-muted">not recorded</span>;
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
                <td>
                  {row.what}
                  {/* F-BL-03: what stands in the way, under the row it belongs to. */}
                  {row.blockedReason ? <span className="dt-sub">{row.blockedReason}</span> : null}
                </td>
                <td className="nowrap">
                  {row.since ? <When instant={row.since} now={now} /> : <span className="dt-muted">no date recorded</span>}
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
              {/* F-BL-05: what this column actually holds is the day the policy was bound, which
                  a policy that was paid and not bound, or voided, never got. Naming it "Paid on"
                  promised a date this page cannot read. */}
              <th>Bound on</th>
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
                <td className="nowrap">{row.paidOn ?? <span className="dt-muted">not recorded</span>}</td>
                {/* F-BL-01: a payment a correction reversed is struck through, because it no
                    longer stands: Stripe kept nothing and the four entries were mirrored. */}
                <Num>
                  {row.reversed ? <s>{formatCentsAsUsd(row.amountCents)}</s> : formatCentsAsUsd(row.amountCents)}
                </Num>
                <td>
                  {row.what}
                  {row.reversed ? (
                    <>
                      {" "}
                      <Chip tone="danger">reversed</Chip>
                      <span className="dt-sub">
                        Reversed by a correction on{" "}
                        {row.reversed.recordedAt.toISOString().replace("T", " ").slice(0, 19)} UTC:{" "}
                        {withoutTrailingStop(row.reversed.reason)}. Nothing was collected and nothing stands.
                      </span>
                    </>
                  ) : null}
                </td>
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
  // F-BL-08: this card used to disappear when there was nothing to refund, while both About
  // blocks went on explaining a table the reader could not see. It is the third of three answers
  // and it keeps its place, with an empty line, exactly as the two cards above it do.
  if (rows.length === 0) {
    return (
      <section className="card">
        <h2>What is being refunded</h2>
        <EmptyState illustration="all-clear">No money is on its way back on this policy.</EmptyState>
      </section>
    );
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
