import Link from "next/link";
import { ArrowRight, FileText, ShieldCheck } from "lucide-react";
import { DecorativeIllustration } from "@/components/decorative-illustration";
import { PortalShell } from "@/components/portal-shell";

export default function HomePage() {
  return (
    <PortalShell>
      <div className="home-intro">
        <h1>
          Your policy <em>workspace.</em>
        </h1>
        <p className="lead">
          One place for the whole policy story. Manage coverage, follow payments
          and keep every detail in view.
        </p>
        {/* Visible before signing in, on purpose (review finding F-UI-02): a reader who never
            gets past this page still learns that nothing here is real money. */}
        <p className="sandbox-note">Work-trial build on sandbox providers and test data. No real money moves here.</p>
      </div>
      <div className="action-grid">
        <Link className="action-card" href="/login">
          <span className="icon-tile">
            <FileText aria-hidden="true" />
          </span>
          <span>
            <strong>Sign in to your workspace</strong>
            <span>Policies, verification and operations.</span>
          </span>
          <ArrowRight size={18} aria-hidden="true" />
        </Link>
        <section className="action-card">
          <span className="icon-tile">
            <ShieldCheck aria-hidden="true" />
          </span>
          <span>
            <strong>Coverage with context</strong>
            <span>Policy details, claims and history in one place.</span>
          </span>
        </section>
      </div>
      <section className="welcome-banner">
        <div>
          <h2>
            Every policy. <em>Clearly covered.</em>
          </h2>
          <p>
            Clear records. Thoughtful decisions.
            <br />
            Every policy, followed through.
          </p>
        </div>
        <DecorativeIllustration name="meadow-path" variant="banner" eager />
      </section>
    </PortalShell>
  );
}
