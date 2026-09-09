import Link from "next/link";
import { ArrowRight, BellRing } from "lucide-react";
import { DecorativeIllustration } from "./decorative-illustration";
import { sql } from "@/db/client";
import { countApprovalRequestsWaitingForDecision } from "@/lib/approvals/read";
import type { SignedInUser } from "@/lib/auth/current-user";
import { countClaimsWithPaymentsStillToMove } from "@/lib/claims/read";
import { countEndorsementsPaidButNotApplied, countPoliciesPaidButNotBound } from "@/lib/policy/read";
import { countOpenChangeRequests } from "@/lib/policy/change-requests";
import { countOpenBreaks } from "@/lib/reconciliation/read";
import { correctionsOfPolicy } from "@/lib/policy/correction-read";
import { liveEndorsementRequest } from "@/lib/policy/endorsement-requests";

// What is waiting for the signed-in person, counted on the server.
//
// One list feeds two things: the numbers on the sidebar (PortalShell) and the "what needs you"
// block at the top of the workspace home of each role. Both are read from the same tables the
// screens themselves read, in these server components; nothing is counted in the browser.
//
// A task is a piece of work with a person attached, so the wording changes with the role: the
// same undecided money-out request is "waiting for your decision" for an approver and "waiting
// for a second person" for the operator who asked for it and cannot approve it.

// Which sidebar entry carries the count. The strings are the section names of PortalShell.
export type WorkspaceSection = "policies" | "claims" | "approvals" | "reconciliation";

export type WorkspaceTask = {
  section: WorkspaceSection;
  count: number;
  label: string;
  detail: string;
  href: string;
};

export async function workspaceTasks(
  user: Pick<SignedInUser, "role" | "brokerId" | "customerId">,
): Promise<WorkspaceTask[]> {
  try {
    if (user.role === "staff_approver" || user.role === "staff_ops") {
      return await staffTasks(user.role);
    }
    if (user.role === "broker" && user.brokerId) {
      return await brokerTasks(user.brokerId);
    }
    if (user.role === "customer" && user.customerId) {
      return await customerTasks(user.customerId);
    }
    return [];
  } catch {
    // A count is a hint, never a control: the screens themselves show the real state and enforce
    // every rule. A page must not fail to render because a hint could not be read, so a failed
    // count shows no badge rather than an error, and the operator still reaches every screen.
    return [];
  }
}

async function staffTasks(role: "staff_ops" | "staff_approver"): Promise<WorkspaceTask[]> {
  const [approvals, breaks, claims, paidNotBound, paidNotApplied] = await Promise.all([
    countApprovalRequestsWaitingForDecision(sql),
    countOpenBreaks(sql),
    countClaimsWithPaymentsStillToMove(sql),
    role === "staff_ops" ? countPoliciesPaidButNotBound() : Promise.resolve(0),
    role === "staff_ops" ? countEndorsementsPaidButNotApplied() : Promise.resolve(0),
  ]);
  const isApprover = role === "staff_approver";

  const tasks: WorkspaceTask[] = [
    {
      section: "approvals",
      count: approvals,
      label: isApprover
        ? `${plural(approvals, "money-out request")} waiting for your decision`
        : `${plural(approvals, "money-out request")} waiting for an approver`,
      detail: isApprover
        ? "You decide requests somebody else made; you can never decide your own."
        : "A distinct staff approver has to decide them. Nothing leaves before that.",
      href: "/ops/approvals",
    },
    {
      section: "policies",
      count: paidNotBound,
      label: `${plural(paidNotBound, "policy", "policies")} paid and not bound`,
      detail: "The customer's money is in the suspense account until you bind or send it back.",
      href: "/ops/policies",
    },
    {
      section: "policies",
      count: paidNotApplied,
      label: `${plural(paidNotApplied, "endorsement")} paid and not in force`,
      detail: "The delta was collected while the broker was not eligible. Apply it from the policy page.",
      href: "/ops/policies",
    },
    {
      section: "claims",
      count: claims,
      label: `${plural(claims, "claim")} with a payment still to move`,
      detail: "Asked for and not sent on the rail: waiting for an approver, or for you to send it.",
      href: "/ops/claims",
    },
    {
      section: "reconciliation",
      count: breaks,
      label: `${plural(breaks, "open break")} between a provider and the ledger`,
      detail: "Nobody has explained them yet. The age is counted from the run that first found them.",
      href: "/ops/reconciliation",
    },
  ];
  return tasks.filter((task) => task.count > 0);
}

// What a broker has to do, policy by policy, with the same readers the policy page uses (so the
// count never disagrees with the screen it points at): a policy still to pay, an endorsement the
// customer has approved and whose delta the broker pays, a correction difference to collect, and
// an endorsement quote still waiting for the customer (information, since the broker waits).
async function brokerTasks(brokerId: string): Promise<WorkspaceTask[]> {
  // Slice B13-6: change requests the broker's customers have sent and nobody has answered yet.
  // Counted in one query over the broker's policies, not folded from the loop below.
  const changeRequests = await countOpenChangeRequests({ brokerId });
  const policies = await sql<{ id: string; status: string }[]>`
    select policy.id, current_policy.status
      from policies policy
      join policy_current current_policy on current_policy.policy_id = policy.id
     where policy.broker_id = ${brokerId}
  `;
  const toPay = policies.filter((policy) =>
    policy.status === "draft" || policy.status === "awaiting_payment" || policy.status === "payment_failed",
  ).length;
  let waitingForCustomer = 0;
  let deltasToPay = 0;
  let differencesToCollect = 0;
  for (const policy of policies) {
    const live = await liveEndorsementRequest(sql, policy.id);
    if (live?.standing.state === "awaiting_approval") waitingForCustomer += 1;
    // Approved by the customer and not applied yet: the broker pays the delta. A delta paid while
    // the broker was not eligible is staff work (counted on the staff side), not the broker's.
    if (live?.standing.state === "approved") deltasToPay += 1;
    for (const correction of await correctionsOfPolicy(policy.id)) {
      const collection = correction.collection;
      if (
        correction.money.settlement === "collect" &&
        collection &&
        collection.paidOn === null &&
        (!collection.customerApprovalRequired || collection.customerApprovedAt !== null)
      ) {
        differencesToCollect += 1;
      }
    }
  }
  const tasks: WorkspaceTask[] = [
    {
      section: "policies",
      count: toPay,
      label: `${plural(toPay, "policy", "policies")} to pay`,
      detail: "Quoted and not bound yet: the policy is bound when Stripe confirms the payment.",
      href: "/broker",
    },
    {
      section: "policies",
      count: deltasToPay,
      label: `${plural(deltasToPay, "endorsement delta")} to pay`,
      detail: "The customer approved the quote; the endorsement takes effect when you pay the delta from the policy page.",
      href: "/broker",
    },
    {
      section: "policies",
      count: differencesToCollect,
      label: `${plural(differencesToCollect, "correction difference")} to collect`,
      detail: "A corrected effective date charges more days of cover; collect the difference from the policy page.",
      href: "/broker",
    },
    {
      section: "policies",
      count: waitingForCustomer,
      label: `${plural(waitingForCustomer, "endorsement")} waiting for the customer`,
      detail: "The delta cannot be collected until the customer approves the quote from their own screen.",
      href: "/broker",
    },
    {
      section: "policies",
      count: changeRequests,
      label: `${plural(changeRequests, "change request")} to answer`,
      detail: "A customer has asked for something on their policy. Answering it changes nothing on its own.",
      href: "/broker",
    },
  ];
  return tasks.filter((task) => task.count > 0);
}

// What a customer has to do: approve an endorsement quote above the threshold, or a correction
// difference above it. Same readers as the customer's own list.
async function customerTasks(customerId: string): Promise<WorkspaceTask[]> {
  const policies = await sql<{ id: string }[]>`select id from policies where customer_id = ${customerId}`;
  let endorsements = 0;
  let corrections = 0;
  for (const policy of policies) {
    const live = await liveEndorsementRequest(sql, policy.id);
    if (live?.standing.state === "awaiting_approval") endorsements += 1;
    for (const correction of await correctionsOfPolicy(policy.id)) {
      const collection = correction.collection;
      if (collection && collection.customerApprovalRequired && collection.customerApprovedAt === null && collection.paidOn === null) {
        corrections += 1;
      }
    }
  }
  const tasks: WorkspaceTask[] = [
    {
      section: "policies",
      count: endorsements,
      label: `${plural(endorsements, "endorsement")} waiting for your approval`,
      detail: "Your broker cannot collect the difference until you accept the quote.",
      href: "/customer",
    },
    {
      section: "policies",
      count: corrections,
      label: `${plural(corrections, "correction")} waiting for your approval`,
      detail: "A corrected effective date charges more days of cover; the difference is collected once you accept it.",
      href: "/customer",
    },
  ];
  return tasks.filter((task) => task.count > 0);
}

// "1 claim", "3 claims". English plurals only, and the irregular one is passed in when needed.
function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

// The block at the top of each role's workspace home. It lists the same tasks the sidebar counts,
// with a link to the screen where the work is done.
export function WhatNeedsYou({
  tasks,
  showEmptyIllustration = true,
}: {
  tasks: WorkspaceTask[];
  showEmptyIllustration?: boolean;
}) {
  return (
    <section className="needs-you" aria-labelledby="needs-you-heading">
      <h2 id="needs-you-heading">
        <BellRing size={18} aria-hidden="true" /> What needs you
      </h2>
      {tasks.length === 0 ? (
        <div className="needs-you-empty">
          {showEmptyIllustration ? <DecorativeIllustration name="all-clear" variant="empty" /> : null}
          <p className="note">
            Nothing is waiting for you right now. New work appears here, in your{" "}
            <Link href="/inbox">inbox</Link>, and as a number next to the screen it belongs to.
          </p>
        </div>
      ) : (
        <ul className="needs-you-list">
          {tasks.map((task) => (
            <li key={`${task.section}-${task.label}`}>
              <Link href={`/inbox#${task.section}`} prefetch={false}>
                <span className="count-chip">{task.count}</span>
                <span>
                  <strong>{task.label}</strong>
                  <span>{task.detail}</span>
                </span>
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
