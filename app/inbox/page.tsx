import "@/app/styles/lists.css";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Chip } from "@/components/detail-layout";
import { PortalShell } from "@/components/portal-shell";
import { EmptyState } from "@/components/ui/empty";
import { DataTable, Num, Primary, Row } from "@/components/ui/table";
import { When } from "@/components/ui/time";
import { currentUser } from "@/lib/auth/current-user";
import { workspaceInbox, type InboxSection } from "@/lib/inbox/read";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { toastsFromQuery, type Query } from "@/lib/ui/views";

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
// URL beyond the notice a redirect left there, and this page never changes anything: every link
// leads to a screen that asks the identity question again for itself and enforces its own rules.
//
// GENERIC OVER THE SECTIONS. This file names no section and no anchor. It renders whatever
// lib/inbox/read.ts returns, in the order lib/inbox/sections.ts put them, so a section added
// there appears here with no change to this page.
//
// Server component: plain HTML, no JavaScript of ours, and every amount arrives in integer cents
// from lib/inbox/read.ts and is only formatted here.
export default async function InboxPage({ searchParams }: { searchParams: Promise<Query> }) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }

  const [inbox, query] = await Promise.all([workspaceInbox(user), searchParams]);
  // One clock for the whole screen, so every age on it is measured from the same instant.
  const now = new Date();
  const isStaff = user.role === "staff_ops" || user.role === "staff_approver";
  // A refused action elsewhere sends the person back here with its sentence (F-B13-08).
  const toasts = toastsFromQuery(query, { error: { tone: "error", title: "Refused" } });

  return (
    <PortalShell
      active="inbox"
      user={user}
      toasts={toasts}
      band={{
        title: "Inbox",
        suffix: user.displayName,
        meta: (
          <>
            <Chip tone={inbox.totalWaiting > 0 ? "warn" : "ok"}>
              {inbox.totalWaiting === 0 ? "nothing waiting" : `${inbox.totalWaiting} waiting`}
            </Chip>
            {/* AF-02. The rows below name Stripe payments, and the staff inbox also names claim
                payments on the simulated rail, so both modes are said here, in the band, where a
                reader meets them before the first reference. */}
            <Chip tone="ok">Stripe: LIVE SANDBOX</Chip>
            {isStaff ? <Chip tone="neutral">claim rail: LOCAL SIMULATOR</Chip> : null}
          </>
        ),
      }}
    >
      {/* The inline sentence stays beside the toast: the review scripts read this block. */}
      {query.error ? (
        <div className="notices">
          <p className="error" role="alert">
            {query.error}
          </p>
        </div>
      ) : null}

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
        <div className="card lists-section">
          <h2>Nothing to do here</h2>
          <EmptyState illustration="in-tray">
            This account has no workspace of its own. Sign in as a broker, a customer or a member
            of staff to see what is waiting.
          </EmptyState>
        </div>
      ) : (
        inbox.sections.map((section, index) => (
          <InboxSectionCard
            key={section.anchor}
            section={section}
            now={now}
            showEmptyIllustration={inbox.totalWaiting === 0 && index === 0}
          />
        ))
      )}
    </PortalShell>
  );
}

// One section. The anchor is on the wrapper, so the count chip in the sidebar (/inbox#approvals)
// lands on the section that holds exactly the items it counted, and scripts/check-inbox-counts.ts
// checks that pairing.
//
// A section with nothing in it folds to a single line (UI-016): it keeps its anchor, its title
// and its sentence, so the link still lands somewhere that answers "there is nothing here", but
// it no longer costs a whole card of the first screen. lib/inbox/read.ts has already put the
// sections holding work first.
function InboxSectionCard({
  section,
  now,
  showEmptyIllustration = false,
}: {
  section: InboxSection;
  now: Date;
  showEmptyIllustration?: boolean;
}) {
  if (section.items.length === 0 && !showEmptyIllustration) {
    return (
      <div className="lists-section lists-empty-line" id={section.anchor}>
        <h2>{section.title}</h2>
        <p>{section.emptySentence}</p>
      </div>
    );
  }
  return (
    <section className="card lists-section" id={section.anchor}>
      <h2>
        {section.title}
        <span className="count-chip">{section.items.length}</span>
      </h2>
      <DataTable ariaLabel={section.title}>
        <thead>
          <tr>
            <th>Object</th>
            <th>What is waiting</th>
            <th className="num">Amount</th>
            <th className="nowrap">{section.sinceHeading}</th>
            <th aria-label="Action" />
          </tr>
        </thead>
        <tbody>
          {section.items.length === 0 ? (
            <tr>
              <td colSpan={5} className="dt-empty">
                <EmptyState illustration={showEmptyIllustration ? "in-tray" : undefined}>{section.emptySentence}</EmptyState>
              </td>
            </tr>
          ) : (
            section.items.map((item, index) => (
              <Row key={`${section.anchor}-${index}`}>
                <Primary>{item.subject}</Primary>
                <td>{item.what}</td>
                <Num>{item.amountCents === null ? "" : formatCentsAsUsd(item.amountCents)}</Num>
                <td className="nowrap">
                  <When instant={item.since} now={now} />
                </td>
                <td className="dt-actions">
                  <Link href={item.href} className="button-link orange" prefetch={false}>
                    {item.actionLabel}
                  </Link>
                </td>
              </Row>
            ))
          )}
        </tbody>
      </DataTable>
    </section>
  );
}
