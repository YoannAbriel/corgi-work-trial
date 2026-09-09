// The shape of the inbox and the rules that group what is waiting into sections.
//
// Pure on purpose: no database, no framework, nothing but facts in and sections out. That is what
// makes the grouping readable on its own and provable line by line in lib/inbox/sections.test.ts.
// lib/inbox/read.ts reads the facts from the same readers the screens use and calls these
// functions; app/inbox/page.tsx only prints what comes back.

// THE ANCHOR OF EACH SECTION, named once for everybody who links to one.
//
// A link to /inbox#<anchor> has to land on the section that holds the very items it counted, so
// the names cannot be typed twice. They are declared here, used by the sections below, and used
// by components/what-needs-you.tsx to say which section each of its counts belongs to: a task
// that names an anchor no section has is a type error rather than a link to an empty panel
// (review findings F-B13-15 and F-B13-16).
//
// Several kinds of work share the anchor `policies`, one per role: it is the name the sidebar
// uses, and each role has exactly one section carrying it, so a sidebar chip always lands
// somewhere sensible too.
export const INBOX_ANCHORS = {
  brokerPoliciesToPay: "policies",
  endorsementDeltasToPay: "endorsement-deltas",
  correctionDifferencesToCollect: "correction-differences",
  changeRequestsToAnswer: "change-requests",
  endorsementsWaitingForTheCustomer: "waiting-for-the-customer",
  customerEndorsementsToApprove: "policies",
  customerCorrectionsToApprove: "corrections",
  approvalRequestsWaiting: "approvals",
  policiesPaidNotBound: "policies",
  endorsementsPaidNotApplied: "endorsements",
  claimPaymentsStillToMove: "claims",
  openBreaks: "reconciliation",
} as const;

export type InboxAnchor = (typeof INBOX_ANCHORS)[keyof typeof INBOX_ANCHORS];

// One line of the inbox: an object, what is waiting on it, and the one link that acts on it.
export type InboxItem = {
  subject: string; // the object itself: a policy number, a claim number, a break key
  what: string; // what is waiting, in one sentence
  amountCents: number | null; // already in cents; the page only formats it
  since: Date | null;
  actionLabel: string;
  href: string;
};

export type InboxSection = {
  // The anchor of the section, from INBOX_ANCHORS above.
  anchor: InboxAnchor;
  title: string;
  // What the "since" column means for THIS section: a quote is not a request is not a payment,
  // and one column header for all of them would be a small lie about the age of the work.
  sinceHeading: string;
  emptySentence: string;
  items: InboxItem[];
};

// ---------------------------------------------------------------------------
// The facts each role's grouping needs, read once from the database below
// ---------------------------------------------------------------------------

export type LiveEndorsementFacts = {
  requestEventId: string;
  state: "awaiting_approval" | "approved";
  description: string;
  deltaTotalCents: number;
  requestedAt: Date;
  approvedAt: Date | null;
};

export type CorrectionFacts = {
  rebookEventId: string;
  amountCents: number;
  recordedAt: Date;
  correctedEffectiveAt: string;
};

export type ChangeRequestFacts = {
  requestId: string;
  policyId: string;
  policyNumber: string;
  askedByName: string;
  whatWasAsked: string; // the lines of the request, already in words
  recordedAt: Date;
};

export type BrokerPolicyFacts = {
  policyId: string;
  policyNumber: string;
  customerName: string;
  status: string;
  totalChargeCents: number;
  quotedAt: Date;
  liveEndorsement: LiveEndorsementFacts | null;
  // Differences a correction created that nobody is blocking and nobody has collected.
  correctionsToCollect: CorrectionFacts[];
};

export type CustomerPolicyFacts = {
  policyId: string;
  policyNumber: string;
  liveEndorsement: LiveEndorsementFacts | null;
  // Differences waiting for this customer's yes before the broker may collect them.
  correctionsToApprove: CorrectionFacts[];
};

export type ApprovalFacts = {
  kind: "claim_payment" | "refund";
  amountCents: number;
  requestedByName: string;
  raisedByAgent: boolean;
  requestedAt: Date;
};

export type ClaimPaymentFacts = {
  claimId: string;
  claimNumber: string;
  amountCents: number;
  railStatus: string;
  requestedAt: Date;
};

export type BreakFacts = {
  source: string;
  classification: string;
  breakKey: string;
  differenceCents: number | null;
  firstSeenAt: Date;
};

export type StaffFacts = {
  approvals: ApprovalFacts[];
  paidNotBound: { policyId: string; policyNumber: string; customerName: string; totalChargeCents: number; quotedAt: Date }[];
  paidNotApplied: { policyId: string; policyNumber: string; amountCents: number; paidAt: Date }[];
  claimPayments: ClaimPaymentFacts[];
  breaks: BreakFacts[];
};

// ---------------------------------------------------------------------------
// The grouping: pure, so it can be read and tested without a database
// ---------------------------------------------------------------------------

// A broker pays. Four things can be waiting on them, and the fourth one is not their move: an
// endorsement quote the customer has not accepted yet is shown so that the broker knows why the
// delta cannot be collected, not so that they do something about it.
export function brokerSections(
  policies: BrokerPolicyFacts[],
  // Change requests come as their own list, not folded into the policies above: a customer can
  // ask a question about a policy that carries no money work at all (slice B13-6).
  changeRequests: ChangeRequestFacts[],
): InboxSection[] {
  const toPay = policies.filter(
    (policy) => policy.status === "draft" || policy.status === "awaiting_payment" || policy.status === "payment_failed",
  );
  const deltasToPay = policies.filter((policy) => policy.liveEndorsement?.state === "approved");
  const waitingForCustomer = policies.filter((policy) => policy.liveEndorsement?.state === "awaiting_approval");

  return [
    {
      anchor: INBOX_ANCHORS.brokerPoliciesToPay,
      title: "Policies to pay",
      sinceHeading: "Quoted",
      emptySentence: "No policy of yours is waiting for a payment.",
      items: toPay.map((policy) => ({
        subject: policy.policyNumber,
        what: `Quoted for ${policy.customerName} and not bound: the policy binds when Stripe confirms the payment.`,
        amountCents: policy.totalChargeCents,
        since: policy.quotedAt,
        actionLabel: "Pay",
        href: `/policies/${policy.policyId}`,
      })),
    },
    {
      anchor: INBOX_ANCHORS.endorsementDeltasToPay,
      title: "Endorsement deltas to pay",
      sinceHeading: "Approved",
      emptySentence: "No approved endorsement is waiting for its delta.",
      items: deltasToPay.map((policy) => ({
        subject: policy.policyNumber,
        what: `${policy.liveEndorsement!.description}: the customer approved the quote, the endorsement takes effect when the delta is paid.`,
        amountCents: policy.liveEndorsement!.deltaTotalCents,
        since: policy.liveEndorsement!.approvedAt ?? policy.liveEndorsement!.requestedAt,
        actionLabel: "Pay the delta",
        href: `/policies/${policy.policyId}`,
      })),
    },
    {
      anchor: INBOX_ANCHORS.correctionDifferencesToCollect,
      title: "Correction differences to collect",
      sinceHeading: "Corrected",
      emptySentence: "No correction has left a difference to collect.",
      items: policies.flatMap((policy) =>
        policy.correctionsToCollect.map((correction) => ({
          subject: policy.policyNumber,
          what: `The endorsement now takes effect on ${correction.correctedEffectiveAt}, which charges more days of cover.`,
          amountCents: correction.amountCents,
          since: correction.recordedAt,
          actionLabel: "Collect",
          href: `/policies/${policy.policyId}`,
        })),
      ),
    },
    {
      anchor: INBOX_ANCHORS.changeRequestsToAnswer,
      title: "Change requests to answer",
      sinceHeading: "Asked",
      emptySentence: "No customer is waiting for an answer.",
      items: changeRequests.map((request) => ({
        subject: request.policyNumber,
        what: `${request.askedByName} asked about ${request.whatWasAsked}. Answering changes nothing on the policy on its own.`,
        amountCents: null,
        since: request.recordedAt,
        actionLabel: "Answer",
        href: `/policies/${request.policyId}`,
      })),
    },
    {
      anchor: INBOX_ANCHORS.endorsementsWaitingForTheCustomer,
      title: "Endorsement quotes waiting for the customer",
      sinceHeading: "Quoted",
      emptySentence: "No endorsement quote is waiting for a customer.",
      items: waitingForCustomer.map((policy) => ({
        subject: policy.policyNumber,
        what: `Waiting: ${policy.customerName} has to accept the quote before you can collect the delta. Nothing for you to do.`,
        amountCents: policy.liveEndorsement!.deltaTotalCents,
        since: policy.liveEndorsement!.requestedAt,
        actionLabel: "Open the policy",
        href: `/policies/${policy.policyId}`,
      })),
    },
  ];
}

// A customer decides. Both sections lead to the page that records their yes, and nowhere else.
export function customerSections(policies: CustomerPolicyFacts[]): InboxSection[] {
  const endorsements = policies.filter((policy) => policy.liveEndorsement?.state === "awaiting_approval");

  return [
    {
      anchor: INBOX_ANCHORS.customerEndorsementsToApprove,
      title: "Endorsements waiting for your approval",
      sinceHeading: "Quoted",
      emptySentence: "No endorsement is waiting for your approval.",
      items: endorsements.map((policy) => ({
        subject: policy.policyNumber,
        what: `${policy.liveEndorsement!.description}: your broker cannot collect this difference until you accept it.`,
        amountCents: policy.liveEndorsement!.deltaTotalCents,
        since: policy.liveEndorsement!.requestedAt,
        actionLabel: "Read and approve",
        href: `/policies/${policy.policyId}/endorsements/${policy.liveEndorsement!.requestEventId}/approve`,
      })),
    },
    {
      anchor: INBOX_ANCHORS.customerCorrectionsToApprove,
      title: "Corrections waiting for your approval",
      sinceHeading: "Corrected",
      emptySentence: "No correction is waiting for your approval.",
      items: policies.flatMap((policy) =>
        policy.correctionsToApprove.map((correction) => ({
          subject: policy.policyNumber,
          what: `A corrected effective date, ${correction.correctedEffectiveAt}, charges more days of cover. The difference is collected once you accept it.`,
          amountCents: correction.amountCents,
          since: correction.recordedAt,
          actionLabel: "Read and approve",
          href: `/policies/${policy.policyId}/corrections/${correction.rebookEventId}/approve`,
        })),
      ),
    },
  ];
}

// Staff operations and the staff approver see the same five sections, and their contents differ
// with the role, exactly as the sidebar counts already do:
//
//   the wording of the approvals section, because an operator cannot decide the requests they can
//   see, only a distinct staff approver can, and the database enforces that, not this page;
//
//   the two operational lists, binding a paid policy and applying a paid endorsement, which are
//   staff operations work. The approver keeps the section and its sentence, so the shape of the
//   screen does not change with the role, and reads who does it.
export function staffSections(facts: StaffFacts, role: "staff_ops" | "staff_approver"): InboxSection[] {
  const isApprover = role === "staff_approver";
  const operationsOnly = "Staff operations do this; it is not an approver's queue.";

  return [
    {
      anchor: INBOX_ANCHORS.approvalRequestsWaiting,
      title: isApprover ? "Money-out requests waiting for your decision" : "Money-out requests waiting for an approver",
      sinceHeading: "Requested",
      emptySentence: "No money-out request is waiting for a decision.",
      items: facts.approvals.map((approval) => ({
        subject: approval.kind === "claim_payment" ? "Claim payment" : "Cancellation refund",
        what: `Asked by ${approval.requestedByName}${approval.raisedByAgent ? ", raised by an agent through the MCP surface" : ""}. ${
          isApprover ? "You can decide it unless you asked for it yourself." : "A distinct staff approver has to decide it."
        }`,
        amountCents: approval.amountCents,
        since: approval.requestedAt,
        actionLabel: isApprover ? "Decide" : "Open the queue",
        href: "/ops/approvals",
      })),
    },
    {
      anchor: INBOX_ANCHORS.policiesPaidNotBound,
      title: "Policies paid and not bound",
      sinceHeading: "Quoted",
      emptySentence: isApprover ? operationsOnly : "No paid policy is waiting to be bound.",
      items: (isApprover ? [] : facts.paidNotBound).map((policy) => ({
        subject: policy.policyNumber,
        what: `${policy.customerName} paid while the broker was not eligible to bind. The cash sits in the suspense account until you bind the policy or send it back.`,
        amountCents: policy.totalChargeCents,
        since: policy.quotedAt,
        actionLabel: "Bind",
        href: `/policies/${policy.policyId}`,
      })),
    },
    {
      anchor: INBOX_ANCHORS.endorsementsPaidNotApplied,
      title: "Endorsements paid and not in force",
      sinceHeading: "Paid",
      emptySentence: isApprover ? operationsOnly : "No paid endorsement is waiting to be applied.",
      items: (isApprover ? [] : facts.paidNotApplied).map((endorsement) => ({
        subject: endorsement.policyNumber,
        what: "The delta was collected while the broker was not eligible, so the endorsement is not in force yet.",
        amountCents: endorsement.amountCents,
        since: endorsement.paidAt,
        actionLabel: "Apply",
        href: `/policies/${endorsement.policyId}`,
      })),
    },
    {
      anchor: INBOX_ANCHORS.claimPaymentsStillToMove,
      title: "Claims with a payment still to move",
      sinceHeading: "Requested",
      emptySentence: "No claim payment is waiting to move.",
      // One line per CLAIM, not per payment: the link opens a claim, and the sidebar badge counts
      // claims too. A claim carrying two payments still to move shows their total and both rail
      // states on its single line.
      items: claimsFromPayments(facts.claimPayments).map((claim) => ({
        subject: claim.claimNumber,
        what: `Asked for and not gone: ${claim.railStatuses.join(", ")}.`,
        amountCents: claim.amountCents,
        since: claim.requestedAt,
        actionLabel: "Open the claim",
        href: `/ops/claims/${claim.claimId}`,
      })),
    },
    {
      anchor: INBOX_ANCHORS.openBreaks,
      title: "Open breaks between a provider and the ledger",
      sinceHeading: "First seen",
      emptySentence: "No break is open: the last complete run of each source matched everything it compared.",
      items: facts.breaks.map((openBreak) => ({
        subject: openBreak.breakKey,
        what: `${openBreak.source}: ${openBreak.classification.replace(/_/g, " ")}. Nobody has explained it yet.`,
        amountCents: openBreak.differenceCents,
        since: openBreak.firstSeenAt,
        actionLabel: "Investigate",
        href: "/ops/reconciliation",
      })),
    },
  ];
}

// Payments still to move, folded onto the claim they belong to, oldest request first.
function claimsFromPayments(payments: ClaimPaymentFacts[]) {
  const byClaim = new Map<string, { claimId: string; claimNumber: string; amountCents: number; railStatuses: string[]; requestedAt: Date }>();
  for (const payment of payments) {
    const claim = byClaim.get(payment.claimId);
    if (!claim) {
      byClaim.set(payment.claimId, {
        claimId: payment.claimId,
        claimNumber: payment.claimNumber,
        amountCents: payment.amountCents,
        railStatuses: [payment.railStatus],
        requestedAt: payment.requestedAt,
      });
      continue;
    }
    claim.amountCents += payment.amountCents;
    if (!claim.railStatuses.includes(payment.railStatus)) {
      claim.railStatuses.push(payment.railStatus);
    }
    if (payment.requestedAt < claim.requestedAt) {
      claim.requestedAt = payment.requestedAt;
    }
  }
  return [...byClaim.values()];
}
