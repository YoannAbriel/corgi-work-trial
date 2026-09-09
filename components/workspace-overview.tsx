import "@/app/styles/lists.css";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SECTIONS, type SectionId } from "./shell/sections";
import { WhatNeedsYou, type WorkspaceTask } from "./what-needs-you";
import { About } from "./ui/about";
import { LandscapeFooter } from "./ui/landscape";
import { Stat, Stats } from "./ui/stat";
import { INBOX_ANCHORS } from "@/lib/inbox/sections";
import { MONEY_OUT_APPROVAL_THRESHOLD_CENTS } from "@/lib/approvals/threshold";
import { formatCentsAsUsd } from "@/lib/money/cents";

// The staff overview: the figures that need a person, the work waiting, the map of the
// sections, one welcome card. Nothing is computed here: the counts come from lib/inbox/tasks.ts,
// read once by the page and shared with the sidebar.
export function WorkspaceOverview({ isApprover, tasks }: { isApprover: boolean; tasks: WorkspaceTask[] }) {
  // A task the reader has none of is not in the list (only what waits is counted), so a zero
  // is drawn from its absence: "0 open breaks" is the good news the tile is for.
  const countOf = (anchor: string) => tasks.filter((task) => task.anchor === anchor).reduce((total, task) => total + task.count, 0);
  const breaks = countOf(INBOX_ANCHORS.openBreaks);
  const approvals = countOf(INBOX_ANCHORS.approvalRequestsWaiting);
  const claims = countOf(INBOX_ANCHORS.claimPaymentsStillToMove);
  const paidNotBound = countOf(INBOX_ANCHORS.policiesPaidNotBound);

  // One line each, short enough not to wrap: eight cards on two rows is what keeps this screen
  // inside 1440 x 900 (cycle 2, decision 12).
  const sections: { section: SectionId; href: string; blurb: string }[] = [
    { section: "policies", href: "/ops/policies", blurb: "Terms and journals." },
    { section: "verification", href: "/ops/brokers", blurb: "Who may bind." },
    { section: "claims", href: "/ops/claims", blurb: "Reserves and payments." },
    { section: "approvals", href: "/ops/approvals", blurb: "Money out to decide." },
    { section: "reconciliation", href: "/ops/reconciliation", blurb: "Provider against ledger." },
    { section: "statements", href: "/ops/statements", blurb: "Monthly commission." },
    { section: "console", href: "/ops/console", blurb: "Feed, errors, latency." },
    ...(isApprover ? [] : [{ section: "mcp-keys" as SectionId, href: "/ops/mcp-keys", blurb: "Agent keys." }]),
  ];

  return (
    <>
      {/* THREE TILES (cycle 2, decision 12). The two everybody acts on, and the one that belongs
          to the role reading the screen. Every other figure of this workspace is one line below,
          in "what needs you", where it comes with the sentence that says what to do about it:
          five tiles and a list saying the same five numbers was the screen counting twice. */}
      <Stats>
        <Stat label="Open breaks" value={breaks} tone={breaks > 0 ? "warn" : "ok"} href={`/inbox#${INBOX_ANCHORS.openBreaks}`} note={breaks > 0 ? "provider and ledger disagree" : "provider and ledger agree"} />
        <Stat label={isApprover ? "Your decisions" : "Waiting for an approver"} value={approvals} tone={approvals > 0 ? "warn" : "neutral"} href={`/inbox#${INBOX_ANCHORS.approvalRequestsWaiting}`} note={`money out above ${formatCentsAsUsd(MONEY_OUT_APPROVAL_THRESHOLD_CENTS)}`} />
        {isApprover ? (
          <Stat label="Claim payments to move" value={claims} tone={claims > 0 ? "warn" : "neutral"} href={`/inbox#${INBOX_ANCHORS.claimPaymentsStillToMove}`} note="asked for, not yet on the rail" />
        ) : (
          <Stat label="Paid, not bound" value={paidNotBound} tone={paidNotBound > 0 ? "warn" : "neutral"} href={`/inbox#${INBOX_ANCHORS.policiesPaidNotBound}`} note="money in the suspense account" />
        )}
      </Stats>

      <WhatNeedsYou tasks={tasks} />

      <div className="cards lists-sections">
        {sections.map(({ section, href, blurb }) => {
          const definition = SECTIONS[section];
          const Icon = definition.icon;
          return (
            <Link key={href} href={href} prefetch={false} className="section-card">
              <span className="section-card-icon" aria-hidden="true">
                <Icon size={20} strokeWidth={1.7} />
              </span>
              <span>
                {/* The name the sidebar uses, so one section has one name on this workspace. */}
                <strong>{section === "verification" ? "Brokers" : definition.label}</strong>
                <small>{blurb}</small>
              </span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          );
        })}
      </div>

      <About>
        <h4>Your role</h4>
        <p>
          {isApprover
            ? "You approve money out that somebody else requested. You can never request it yourself, and you can never approve your own request."
            : "You request money out and bind policies. A distinct staff approver decides above the threshold."}
        </p>
        <h4>The threshold</h4>
        <p>
          Money out above {formatCentsAsUsd(MONEY_OUT_APPROVAL_THRESHOLD_CENTS)} needs a distinct human approver. The figure is an assumption of this trial build, not a rule of Corgi.
        </p>
        <h4>What is real</h4>
        <p>
          Stripe runs in test mode on a live sandbox: payments, refunds and broker verification are real Stripe objects. The claim payout rail and the claimant bank check are local simulators, labeled LOCAL SIMULATOR wherever their records appear. No real money moves here.
        </p>
        <h4>Where the figures come from</h4>
        <p>The tiles count the same rows the inbox lists, read once per page. A tile opens the inbox section holding exactly those items.</p>
      </About>

      <LandscapeFooter name="moonlit-hills" title={<>The whole operation, <em>in view.</em></>}>
        Every screen reads append-only tables. Nothing here edits or deletes a money row: a correction is a reversal plus a re-booking.
      </LandscapeFooter>
    </>
  );
}
