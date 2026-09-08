import Link from "next/link";
import { ArrowRight, FileText, ShieldCheck } from "lucide-react";
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
        <img
          src="/illustrations/corgi-engraving.webp"
          width="1152"
          height="768"
          alt=""
        />
      </section>
    </PortalShell>
  );
}
