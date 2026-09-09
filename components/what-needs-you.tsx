import "@/app/styles/lists.css";
import Link from "next/link";
import { ArrowRight, BellRing } from "lucide-react";
import { Emphasis } from "@/components/emphasis";
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

// Every task label from lib/inbox/tasks.ts is a whole sentence that ALREADY begins with its count
// and is already pluralised: "1 endorsement delta to pay", "2 endorsement deltas to pay", "4 open
// breaks between a provider and the ledger". This block prints the count as a chip of its own, so
// printing the sentence unchanged said the number twice, and with no space between the two the row
// read as "11 endorsement delta to pay" for a count of 1 (Yoann, on the broker home, 2026-09-09).
//
// The count is removed HERE and not in lib/inbox/tasks.ts, because the sentence with its count is
// the counting module's own wording and nothing else should have to reassemble it; what this block
// needs is the same sentence minus the number it is already showing. The pluralisation stays where
// it is, which is what makes "endorsement deltas" appear beside a chip saying 2.
//
// The count is matched as a prefix rather than assumed: a label that does not start with its own
// count (the blocking task below has none) is printed exactly as it was written.
function withoutTheLeadingCount(label: string, count: number): string {
  const prefix = `${count} `;
  return label.startsWith(prefix) ? label.slice(prefix.length) : label;
}

// The block at the top of each role's workspace home. It lists the same tasks the sidebar counts,
// with a link to the screen where the work is done.
export function WhatNeedsYou({
  tasks,
  blocking = null,
}: {
  tasks: WorkspaceTask[];
  blocking?: BlockingTask | null;
}) {
  // NOTHING WAITING: nothing at all, and the next block moves up (Yoann, 2026-09-09). A bar
  // saying "Nothing is waiting for you." was still a bar: it cost a row of the home screen to
  // report an absence. The fact is not lost. The sidebar shows a count beside a section only
  // while something waits there, and /inbox draws "Nothing is waiting for you." with its own
  // illustration when nothing waits anywhere (app/inbox/page.tsx, `inbox.totalWaiting === 0`).
  if (tasks.length === 0 && !blocking) {
    return null;
  }

  // `lists-needs` is the dense shape of the interface system of 2026-09-09: 32 px rows, the count
  // as a chip, one line of detail. The rules are in app/styles/lists.css, imported at the top of
  // this file so that every screen showing this block gets the same density.
  return (
    <section className="needs-you lists-needs" aria-labelledby="needs-you-heading">
      <h2 id="needs-you-heading">
        <BellRing size={15} aria-hidden="true" /> What needs you
      </h2>
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
                {/* The title keeps the plain sentence for the tooltip and for a text search; only
                    what is drawn carries the emphasis (Yoann, 2026-09-09 22:10). */}
                <span title={blocking.detail}>
                  <Emphasis>{blocking.detail}</Emphasis>
                </span>
              </span>
              <ArrowRight size={16} aria-hidden="true" />
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
                {/* The chip above is the count, so the sentence beside it drops the one it carried:
                    the two together read "4 open breaks between a provider and the ledger", once. */}
                <strong>{withoutTheLeadingCount(task.label, task.count)}</strong>
                {/* One line, cut with an ellipsis: the whole sentence stays in the title and in
                    the inbox section this row links to. */}
                <span title={task.detail}>
                  <Emphasis>{task.detail}</Emphasis>
                </span>
              </span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
