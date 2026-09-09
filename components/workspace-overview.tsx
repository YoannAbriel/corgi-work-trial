import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DecorativeIllustration } from "./decorative-illustration";
import { SECTIONS, type SectionId } from "./shell/sections";
import { WhatNeedsYou, type WorkspaceTask } from "./what-needs-you";
import { About } from "./ui/about";
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
  const endorsements = countOf(INBOX_ANCHORS.endorsementsPaidNotApplied);

  const sections: { section: SectionId; href: string; blurb: string }[] = [
    { section: "policies", href: "/ops/policies", blurb: "Every policy, its terms and its journal." },
    { section: "verification", href: "/ops/brokers", blurb: "Who may bind, and what Stripe says." },
    { section: "claims", href: "/ops/claims", blurb: "Reserves, payments, limits." },
    { section: "approvals", href: "/ops/approvals", blurb: "Money out above the threshold." },
    { section: "reconciliation", href: "/ops/reconciliation", blurb: "Provider records against the ledger." },
    { section: "statements", href: "/ops/statements", blurb: "Monthly commission, frozen revisions." },
    { section: "console", href: "/ops/console", blurb: "Live feed, errors, latency, the ledger." },
    ...(isApprover ? [] : [{ section: "mcp-keys" as SectionId, href: "/ops/mcp-keys", blurb: "Agent keys and what they may never do." }]),
  ];

  return (
    <>
      <Stats>
        <Stat label="Open breaks" value={breaks} tone={breaks > 0 ? "warn" : "ok"} href={`/inbox#${INBOX_ANCHORS.openBreaks}`} note={breaks > 0 ? "provider and ledger disagree" : "provider and ledger agree"} />
        <Stat label={isApprover ? "Your decisions" : "Waiting for an approver"} value={approvals} tone={approvals > 0 ? "warn" : "neutral"} href={`/inbox#${INBOX_ANCHORS.approvalRequestsWaiting}`} note={`money out above ${formatCentsAsUsd(MONEY_OUT_APPROVAL_THRESHOLD_CENTS)}`} />
        <Stat label="Claim payments to move" value={claims} tone={claims > 0 ? "warn" : "neutral"} href={`/inbox#${INBOX_ANCHORS.claimPaymentsStillToMove}`} note="asked for, not yet on the rail" />
        {isApprover ? null : (
          <>
            <Stat label="Paid, not bound" value={paidNotBound} tone={paidNotBound > 0 ? "warn" : "neutral"} href={`/inbox#${INBOX_ANCHORS.policiesPaidNotBound}`} note="money in the suspense account" />
            <Stat label="Endorsements to apply" value={endorsements} tone={endorsements > 0 ? "warn" : "neutral"} href={`/inbox#${INBOX_ANCHORS.endorsementsPaidNotApplied}`} note="paid, not in force" />
          </>
        )}
      </Stats>

      <WhatNeedsYou tasks={tasks} showEmptyIllustration={false} />

      <div className="cards" style={{ marginTop: 16 }}>
        {sections.map(({ section, href, blurb }) => {
          const definition = SECTIONS[section];
          return (
            <Link key={href} href={href} prefetch={false} className="section-card">
              <span className="section-card-art" aria-hidden="true">
                <DecorativeIllustration name={definition.illustration} variant="card" />
              </span>
              <span>
                <strong>{section === "verification" ? "Brokers and verification" : definition.label}</strong>
                <small>{blurb}</small>
              </span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          );
        })}
      </div>

      <section className="welcome-card">
        <div>
          <h2>
            The whole operation, <em>in view.</em>
          </h2>
          <p>Every screen reads append-only tables. Nothing here edits or deletes a money row: a correction is a reversal plus a re-booking.</p>
        </div>
        <DecorativeIllustration name="moonlit-hills" variant="banner" />
      </section>

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
    </>
  );
}
