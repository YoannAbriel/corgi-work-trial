import Link from "next/link";
import { redirect } from "next/navigation";
import { Chip, DetailHeading, Empty, Panel } from "@/components/detail-layout";
import { PortalShell } from "@/components/portal-shell";
import { currentUser } from "@/lib/auth/current-user";
import { workspaceInbox, type InboxSection } from "@/lib/inbox/read";
import { formatCentsAsUsd } from "@/lib/money/cents";

// The notification centre: one screen listing everything waiting for the signed-in person, each
// line with the link that does the work.
//
// It exists because a number is not an answer (ticket YOA-636). The sidebar said "3" and the
// "what needs you" block said "3 policies to pay", and both led to a list of every policy, where
// the three were still to be found. Here each waiting item is a row of its own, with its object,
// its amount, its age, and one link to the exact page that clears it.
//
// The role decides what is shown, and the role comes from the session: a broker sees their own
// broker's work, a customer their own, staff the operations queues. Nothing is read from the
// URL, and this page never changes anything: every link leads to a screen that asks the identity
// question again for itself and enforces its own rules.
//
// Server component: plain HTML, no JavaScript of ours, and every amount arrives in integer cents
// from lib/inbox/read.ts and is only formatted here.
export default async function InboxPage() {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }

  const inbox = await workspaceInbox(user);

  return (
    <PortalShell active="inbox" user={user}>
      <DetailHeading
        title="Inbox"
        lead={`${user.displayName} · everything waiting for you, with the link that does the work.`}
        chips={
          <Chip tone={inbox.totalWaiting > 0 ? "warn" : "ok"}>
            {inbox.totalWaiting === 0 ? "nothing waiting" : `${inbox.totalWaiting} waiting`}
          </Chip>
        }
      />

      {inbox.unreadablePolicies.length > 0 ? (
        <div className="notices">
          <p className="error" role="alert">
            Nothing below counts{" "}
            {inbox.unreadablePolicies.length === 1 ? "this policy" : "these policies"}, because a
            figure they have stored was refused when it was read:{" "}
            {inbox.unreadablePolicies.map((policy) => `${policy.policyNumber} (${policy.reason})`).join("; ")}. Open
            the policy itself to see the whole story.
          </p>
        </div>
      ) : null}

      {inbox.sections.length === 0 ? (
        <Panel title="Nothing to do here">
          <Empty illustration="in-tray">
            This account has no workspace of its own. Sign in as a broker, a customer or a member
            of staff to see what is waiting.
          </Empty>
        </Panel>
      ) : (
        inbox.sections.map((section, index) => (
          <InboxPanel
            key={section.anchor}
            section={section}
            showEmptyIllustration={inbox.totalWaiting === 0 && index === 0}
          />
        ))
      )}
    </PortalShell>
  );
}

// One section. The anchor is on the wrapper, so the count chip in the sidebar (/inbox#approvals)
// lands on the section that holds exactly the items it counted.
function InboxPanel({
  section,
  showEmptyIllustration = false,
}: {
  section: InboxSection;
  showEmptyIllustration?: boolean;
}) {
  return (
    <div id={section.anchor}>
      <Panel
        title={
          <>
            {section.title}
            <span className="count-chip">{section.items.length}</span>
          </>
        }
        className="list-panel"
      >
        {section.items.length === 0 ? (
          <Empty illustration={showEmptyIllustration ? "in-tray" : undefined}>{section.emptySentence}</Empty>
        ) : (
          <div className="table-scroll" role="region" aria-label={section.title} tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Object</th>
                  <th>What is waiting</th>
                  <th className="amount">Amount</th>
                  <th>{section.sinceHeading} (UTC)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {section.items.map((item, index) => (
                  <tr key={`${section.anchor}-${index}`}>
                    <td>
                      <strong>{item.subject}</strong>
                    </td>
                    <td>{item.what}</td>
                    <td className="amount">
                      {item.amountCents === null ? "" : formatCentsAsUsd(item.amountCents)}
                    </td>
                    <td>{item.since === null ? "" : asUtcText(item.since)}</td>
                    <td>
                      <Link href={item.href} className="button-link orange small" prefetch={false}>
                        {item.actionLabel}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

// Timestamps are persisted in UTC and printed in UTC, as everywhere else in the workspace.
function asUtcText(instant: Date): string {
  return instant.toISOString().replace("T", " ").slice(0, 19);
}
