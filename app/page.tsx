import Link from "next/link";
import { ArrowRight, FileText, ShieldCheck } from "lucide-react";
import { PortalShell } from "@/components/portal-shell";

export default function HomePage() {
  return (
    <PortalShell>
      <div className="home-intro">
        <h1>Corgi policy administration</h1>
        <p className="lead">
          One place for the whole policy story. Manage coverage, follow payments and keep every detail in
          view.
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
            <strong>A sandbox, built for the trial</strong>
            <span>Synthetic data. Test payments. No real money.</span>
          </span>
        </section>
      </div>
      <section className="welcome-banner">
        <div>
          <h2>A little care goes a long way.</h2>
          <p>
            Clear records. Thoughtful decisions.
            <br />
            Every policy, followed through.
          </p>
          <span className="note">Track 1 work trial build</span>
        </div>
        <img src="/illustrations/corgi-desk.webp" width="1024" height="1024" alt="" />
      </section>
      <p className="note">
        Payments run on Stripe in test mode: no real card, no real money. Health check:{" "}
        <a href="/api/health">/api/health</a>
      </p>
    </PortalShell>
  );
}
