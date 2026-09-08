import Link from "next/link";
import {
  ArrowRight,
  ClipboardCheck,
  FileText,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

export function WorkspaceOverview({ isApprover }: { isApprover: boolean }) {
  return (
    <>
      <div className="page-heading">
        <h1>
          Your <em>operations.</em>
        </h1>
        <p className="lead">
          Review verification, follow claims and move requests to the right
          person.
        </p>
      </div>
      <div className="action-grid">
        <Link className="action-card" href="/ops/brokers" prefetch={false}>
          <span className="icon-tile">
            <ShieldCheck aria-hidden="true" />
          </span>
          <span>
            <strong>Brokers and their verification</strong>
            <span>Review eligibility and verification details.</span>
          </span>
          <ArrowRight size={18} aria-hidden="true" />
        </Link>
        <Link className="action-card" href="/ops/claims" prefetch={false}>
          <span className="icon-tile">
            <WalletCards aria-hidden="true" />
          </span>
          <span>
            <strong>Claims</strong>
            <span>Follow reserves, payments and claim history.</span>
          </span>
          <ArrowRight size={18} aria-hidden="true" />
        </Link>
        <Link className="action-card" href="/ops/reconciliation" prefetch={false}>
          <span className="icon-tile"><ClipboardCheck aria-hidden="true" /></span>
          <span><strong>Reconciliation</strong><span>Compare provider records with the ledger and investigate open breaks.</span></span>
          <ArrowRight size={18} aria-hidden="true" />
        </Link>
        <Link className="action-card" href="/ops/statements" prefetch={false}>
          <span className="icon-tile"><FileText aria-hidden="true" /></span>
          <span><strong>Broker statements</strong><span>Read monthly commission, frozen revisions and their knowledge cutoff.</span></span>
          <ArrowRight size={18} aria-hidden="true" />
        </Link>
      </div>
      <div className="overview-grid">
        <section className="panel">
          <h2>
            <ClipboardCheck size={18} aria-hidden="true" /> Your role in the
            workflow
          </h2>
          <span className="role-label">
            {isApprover ? "Staff approver" : "Staff operations"}
          </span>
          <h3>
            {isApprover
              ? "An independent pair of eyes."
              : "Move the right work forward."}
          </h3>
          <p>
            {isApprover
              ? "You approve money out that somebody else requested; you cannot request it yourself."
              : "You request money out and bind policies; a distinct approver decides above the threshold."}
          </p>
          <Link
            href="/ops/approvals"
            className="button-link"
            prefetch={false}
          >
            Open approvals <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <p className="note">
            Money out above $1,000 needs a distinct human approver. This
            threshold is an assumption of this trial build.
          </p>
        </section>
        <section className="panel">
          <h2>
            <FileText size={18} aria-hidden="true" /> Keep the context close
          </h2>
          <div className="context-item">
            <strong>Verification before binding</strong>
            <p>
              See each broker’s status and re-read it at Stripe when needed.
            </p>
          </div>
          <div className="context-item">
            <strong>A traceable money history</strong>
            <p>Policy journals show original entries and their corrections.</p>
          </div>
          <div className="context-item">
            <strong>Claim payout rail: LOCAL SIMULATOR</strong>
            <p>
              Claim payouts and bank verification are simulated. They do not
              move real money.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
