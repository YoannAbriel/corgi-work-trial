import { sql } from "@/db/client";
import { approvalRequests } from "@/lib/approvals/approvals";
import type { SignedInUser } from "@/lib/auth/current-user";
import { claimPayments } from "@/lib/claims/payments";
import { claimsWithPositions } from "@/lib/claims/read";
import { correctionsOfPolicy } from "@/lib/policy/correction-read";
import { liveEndorsementRequest } from "@/lib/policy/endorsement-requests";
import { endorsementsPaidButNotApplied, policiesOfBroker, policiesPaidButNotBound } from "@/lib/policy/read";
import { openBreaks } from "@/lib/reconciliation/read";
import {
  brokerSections,
  customerSections,
  staffSections,
  type BrokerPolicyFacts,
  type ClaimPaymentFacts,
  type CorrectionFacts,
  type CustomerPolicyFacts,
  type InboxSection,
  type LiveEndorsementFacts,
  type StaffFacts,
} from "./sections";

export type { InboxItem, InboxSection } from "./sections";

// The notification centre: everything waiting for the signed-in person, with the link that does
// the work (app/inbox/page.tsx).
//
// components/what-needs-you.tsx answers "how many"; this file answers "which ones, and where do I
// click". Both read the same readers the screens themselves read, so a number and its list can
// never tell two different stories: the policy sections use `policiesOfBroker`,
// `liveEndorsementRequest` and `correctionsOfPolicy`, the staff sections use `approvalRequests`,
// `policiesPaidButNotBound`, `endorsementsPaidButNotApplied`, `claimPayments` and `openBreaks`.
// No business rule is restated in SQL here.
//
// Reading is split in two on purpose: this file asks the database for facts, and the pure
// functions of ./sections turn those facts into sections. The grouping is the part that carries
// the wording and the rules of who does what, so it is the part worth testing on its own.

export type WorkspaceInbox = {
  totalWaiting: number;
  sections: InboxSection[];
  // Policies whose own readers refused to answer, by number. The inbox shows what it could read
  // and names the rest out loud (app/inbox/page.tsx): emptying a whole role's inbox because one
  // policy cannot be read is worse than a short, visible warning, and hiding the failure in
  // silence would be worse than both.
  unreadablePolicyNumbers: string[];
};

// ---------------------------------------------------------------------------
// Reading the facts
// ---------------------------------------------------------------------------

// Everything waiting for this person, in the order they should look at it.
//
// The role comes from the session, and so does the broker or customer the user belongs to: no id
// from a URL ever reaches these queries. A role with nothing to do gets no section at all rather
// than empty ones, which is how an unknown role ends up seeing nothing.
export async function workspaceInbox(
  user: Pick<SignedInUser, "role" | "brokerId" | "customerId">,
): Promise<WorkspaceInbox> {
  const inbox = await sectionsFor(user);
  const totalWaiting = inbox.sections.reduce((total, section) => total + section.items.length, 0);
  return { totalWaiting, ...inbox };
}

async function sectionsFor(
  user: Pick<SignedInUser, "role" | "brokerId" | "customerId">,
): Promise<{ sections: InboxSection[]; unreadablePolicyNumbers: string[] }> {
  if (user.role === "staff_ops" || user.role === "staff_approver") {
    return { sections: staffSections(await readStaffFacts(), user.role), unreadablePolicyNumbers: [] };
  }
  if (user.role === "broker" && user.brokerId) {
    const read = await readBrokerPolicies(user.brokerId);
    return { sections: brokerSections(read.policies), unreadablePolicyNumbers: read.unreadablePolicyNumbers };
  }
  if (user.role === "customer" && user.customerId) {
    const read = await readCustomerPolicies(user.customerId);
    return { sections: customerSections(read.policies), unreadablePolicyNumbers: read.unreadablePolicyNumbers };
  }
  return { sections: [], unreadablePolicyNumbers: [] };
}

// The broker's own policies, each with the endorsement request that is live on it and the
// corrections that left a difference. One policy at a time, as the policy page does: a broker of
// this trial has a handful of policies, and reading them through the same functions the screens
// use is worth more than one clever query that could disagree with them.
async function readBrokerPolicies(
  brokerId: string,
): Promise<{ policies: BrokerPolicyFacts[]; unreadablePolicyNumbers: string[] }> {
  const policies = await policiesOfBroker(brokerId);
  const facts: BrokerPolicyFacts[] = [];
  const unreadablePolicyNumbers: string[] = [];
  for (const policy of policies) {
    try {
      facts.push({
        policyId: policy.policyId,
        policyNumber: policy.policyNumber,
        customerName: policy.customerName,
        status: policy.status,
        totalChargeCents: policy.totalChargeCents,
        quotedAt: policy.quotedAt,
        liveEndorsement: await readLiveEndorsement(policy.policyId),
        correctionsToCollect: await readCorrections(policy.policyId, "to_collect"),
      });
    } catch {
      // A policy whose own readers refuse to answer, because an older format wrote a payload
      // they no longer accept, must not empty the whole inbox. It is named on the screen
      // instead, and its own page shows the real error.
      unreadablePolicyNumbers.push(policy.policyNumber);
    }
  }
  return { policies: facts, unreadablePolicyNumbers };
}

async function readCustomerPolicies(
  customerId: string,
): Promise<{ policies: CustomerPolicyFacts[]; unreadablePolicyNumbers: string[] }> {
  // Ownership comes from the session: the customer id is the one on the signed-in user.
  const policies = await sql<{ id: string; policy_number: string }[]>`
    select policy.id, policy.policy_number
      from policies policy
     where policy.customer_id = ${customerId}
     order by policy.created_at desc
  `;
  const facts: CustomerPolicyFacts[] = [];
  const unreadablePolicyNumbers: string[] = [];
  for (const policy of policies) {
    try {
      facts.push({
        policyId: policy.id,
        policyNumber: policy.policy_number,
        liveEndorsement: await readLiveEndorsement(policy.id),
        correctionsToApprove: await readCorrections(policy.id, "to_approve"),
      });
    } catch {
      // Same reason as the broker's list above.
      unreadablePolicyNumbers.push(policy.policy_number);
    }
  }
  return { policies: facts, unreadablePolicyNumbers };
}

// The endorsement request the policy page acts on, when it is still waiting for somebody. A
// request that is applied or superseded is not returned by liveEndorsementRequest at all.
async function readLiveEndorsement(policyId: string): Promise<LiveEndorsementFacts | null> {
  const live = await liveEndorsementRequest(sql, policyId);
  if (!live || (live.standing.state !== "awaiting_approval" && live.standing.state !== "approved")) {
    return null;
  }
  return {
    requestEventId: live.request.eventId,
    state: live.standing.state,
    description: live.request.description,
    deltaTotalCents: live.request.figures.deltaTotalCents,
    requestedAt: live.request.recordedAt,
    approvedAt: live.standing.approvedAt,
  };
}

// The two questions a correction's difference can be waiting on, read from the same view the
// policy page and the customer page read:
//
//   to_approve  the difference is above the customer threshold and the customer has not said yes;
//   to_collect  nobody is blocking it any more and the broker has not collected it.
//
// A difference that gives money back (`settlement` is not "collect") is not work for anybody
// here: the refund path handles it.
async function readCorrections(policyId: string, question: "to_approve" | "to_collect"): Promise<CorrectionFacts[]> {
  const corrections = await correctionsOfPolicy(policyId);
  const facts: CorrectionFacts[] = [];
  for (const correction of corrections) {
    const collection = correction.collection;
    if (!collection || collection.paidOn !== null) {
      continue;
    }
    const waitingForTheCustomer = collection.customerApprovalRequired && collection.customerApprovedAt === null;
    const matches =
      question === "to_approve"
        ? waitingForTheCustomer
        : correction.money.settlement === "collect" && !waitingForTheCustomer;
    if (!matches) {
      continue;
    }
    facts.push({
      rebookEventId: correction.rebookEventId,
      amountCents: collection.amountCents,
      recordedAt: correction.recordedAt,
      correctedEffectiveAt: correction.correctedEffectiveAt,
    });
  }
  return facts;
}

async function readStaffFacts(): Promise<StaffFacts> {
  const [requests, paidNotBound, paidNotApplied, breaks] = await Promise.all([
    approvalRequests(sql),
    policiesPaidButNotBound(),
    endorsementsPaidButNotApplied(),
    openBreaks(sql),
  ]);

  return {
    approvals: requests
      .filter((request) => request.decision === null)
      .map((request) => ({
        kind: request.kind,
        amountCents: request.amountCents,
        requestedByName: request.requestedByName,
        raisedByAgent: request.raisedByAgent,
        requestedAt: request.requestedAt,
      })),
    paidNotBound,
    paidNotApplied: paidNotApplied.map((endorsement) => ({
      policyId: endorsement.policyId,
      policyNumber: endorsement.policyNumber,
      amountCents: endorsement.amountCents,
      paidAt: endorsement.paidAt,
    })),
    claimPayments: await readClaimPaymentsStillToMove(),
    breaks: breaks.map((openBreak) => ({
      source: openBreak.source,
      classification: openBreak.classification,
      breakKey: openBreak.breakKey,
      differenceCents: openBreak.differenceCents,
      firstSeenAt: openBreak.firstSeenAt,
    })),
  };
}

// Every claim payment somebody still has to move. "Still to move" is the rail status the claim
// screen shows: waiting for an approver's decision, or approved and not sent yet. A payment that
// was sent, settled, returned or refused has left the queue, and a rejected approval writes the
// 'failed' lifecycle event that makes it "refused" here.
async function readClaimPaymentsStillToMove(): Promise<ClaimPaymentFacts[]> {
  const claims = await claimsWithPositions(sql, null);
  const facts: ClaimPaymentFacts[] = [];
  for (const claim of claims) {
    for (const payment of await claimPayments(sql, claim.claimId)) {
      if (payment.railStatus !== "waiting for approval" && payment.railStatus !== "ready to send") {
        continue;
      }
      facts.push({
        claimId: claim.claimId,
        claimNumber: claim.claimNumber,
        amountCents: payment.amountCents,
        railStatus: payment.railStatus,
        requestedAt: payment.requestedAt,
      });
    }
  }
  return facts;
}
