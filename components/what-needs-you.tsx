import Link from "next/link";
import { ArrowRight, BellRing } from "lucide-react";
import { DecorativeIllustration } from "./decorative-illustration";
import type { WorkspaceTask } from "@/lib/inbox/tasks";

// The "what needs you" block at the top of each role's workspace home: the work waiting for the
// signed-in person, drawn as a list, with a link to the screen where each piece of it is done.
//
// This file only draws. The counting is lib/inbox/tasks.ts, which reads the same tables the
// screens themselves read and returns plain objects. The two live apart because this file imports
// its illustrations as .webp FILES for next/image, which only the Next toolchain can read, while
// scripts/check-inbox-counts.ts has to import the counting under tsx to compare every count
// against the inbox section it points at.
//
// The counting is re-exported below so that every screen already importing `workspaceTasks` from
// this file keeps working; a new caller should import it from lib/inbox/tasks.ts directly.
export { workspaceTasks } from "@/lib/inbox/tasks";
export type { WorkspaceSection, WorkspaceTask } from "@/lib/inbox/tasks";

// A thing to do that the inbox does not list, because it is not a queue of items: business
// verification blocking a broker from binding anything (UI-031). It comes FIRST in the block and
// links to the screen that clears it, which is why it carries its own href instead of an inbox
// anchor. It is deliberately not a WorkspaceTask: the tasks are counted work, compared item by
// item against the inbox by scripts/check-inbox-counts.ts, and a count with no inbox section
// behind it is exactly what that check exists to catch.
export type BlockingTask = {
  label: string;
  detail: string;
  href: string;
};

// The block at the top of each role's workspace home. It lists the same tasks the sidebar counts,
// with a link to the screen where the work is done.
export function WhatNeedsYou({
  tasks,
  blocking = null,
  showEmptyIllustration = true,
}: {
  tasks: WorkspaceTask[];
  blocking?: BlockingTask | null;
  showEmptyIllustration?: boolean;
}) {
  return (
    <section className="needs-you" aria-labelledby="needs-you-heading">
      <h2 id="needs-you-heading">
        <BellRing size={18} aria-hidden="true" /> What needs you
      </h2>
      {tasks.length === 0 && !blocking ? (
        <div className="needs-you-empty">
          {showEmptyIllustration ? <DecorativeIllustration name="all-clear" variant="empty" /> : null}
          <p className="note">
            Nothing is waiting for you right now. New work appears here, in your{" "}
            <Link href="/inbox">inbox</Link>, and as a number next to the screen it belongs to.
          </p>
        </div>
      ) : (
        <ul className="needs-you-list">
          {blocking ? (
            // First, because it stops everything else on this screen: a broker whose verification
            // does not allow binding was being told that nothing needed them, immediately under
            // the sentence saying Stripe had refused the verification (UI-031).
            <li key="blocking">
              <Link href={blocking.href} prefetch={false}>
                <span className="count-chip">1</span>
                <span>
                  <strong>{blocking.label}</strong>
                  <span>{blocking.detail}</span>
                </span>
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </li>
          ) : null}
          {tasks.map((task) => (
            <li key={`${task.section}-${task.label}`}>
              {/*
                The count opens the inbox section that holds exactly these items, never the screen
                this block already sits on: that link led back to /broker, which is the complaint
                the inbox answers (YOA-636), and the sidebar's section name landed it on a panel
                counting something else (F-B13-15, F-B13-16).
              */}
              <Link href={`/inbox#${task.anchor}`} prefetch={false}>
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
