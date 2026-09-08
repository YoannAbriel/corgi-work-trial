import Link from "next/link";
import { ArrowRight, BellRing } from "lucide-react";
import { sql } from "@/db/client";
import { countApprovalRequestsWaitingForDecision } from "@/lib/approvals/read";
import type { SignedInUser } from "@/lib/auth/current-user";
import { countClaimsWithPaymentsStillToMove } from "@/lib/claims/read";
import { countEndorsementsAwaitingCustomerApproval } from "@/lib/policy/endorsement-read";
import { countEndorsementsPaidButNotApplied, countPoliciesPaidButNotBound } from "@/lib/policy/read";
import { countOpenBreaks } from "@/lib/reconciliation/read";

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

async function brokerTasks(brokerId: string): Promise<WorkspaceTask[]> {
  const waiting = await countEndorsementsAwaitingCustomerApproval({ brokerId });
  if (waiting === 0) {
    return [];
  }
  return [
    {
      section: "policies",
      count: waiting,
      label: `${plural(waiting, "endorsement")} waiting for the customer`,
      detail: "The delta cannot be collected until the customer approves the quote from their own screen.",
      href: "/broker",
    },
  ];
}

async function customerTasks(customerId: string): Promise<WorkspaceTask[]> {
  const waiting = await countEndorsementsAwaitingCustomerApproval({ customerId });
  if (waiting === 0) {
    return [];
  }
  return [
    {
      section: "policies",
      count: waiting,
      label: `${plural(waiting, "endorsement")} waiting for your approval`,
      detail: "Your broker cannot collect the difference until you accept the quote.",
      href: "/customer",
    },
  ];
}

// "1 claim", "3 claims". English plurals only, and the irregular one is passed in when needed.
function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

// The block at the top of each role's workspace home. It lists the same tasks the sidebar counts,
// with a link to the screen where the work is done.
export function WhatNeedsYou({ tasks }: { tasks: WorkspaceTask[] }) {
  return (
    <section className="needs-you" aria-labelledby="needs-you-heading">
      <h2 id="needs-you-heading">
        <BellRing size={18} aria-hidden="true" /> What needs you
      </h2>
      {tasks.length === 0 ? (
        <p className="note">
          Nothing is waiting for you right now. New work appears here and as a number next to the
          screen it belongs to.
        </p>
      ) : (
        <ul className="needs-you-list">
          {tasks.map((task) => (
            <li key={`${task.section}-${task.label}`}>
              <Link href={task.href} prefetch={false}>
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
