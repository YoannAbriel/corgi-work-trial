import Link from "next/link";
import { redirect } from "next/navigation";
import { DecorativeIllustration } from "@/components/decorative-illustration";
import { SignedOutFrame } from "@/components/signed-out-frame";
import { currentUser } from "@/lib/auth/current-user";
import "@/app/styles/landing.css";

// The public landing. It is outside the workspace shell on purpose: nobody is signed in here, so
// a sidebar of destinations a visitor cannot open would be a row of locked doors.
//
// A visitor who IS signed in is sent to their own home with the same role routing /login uses, so
// the two entry points can never disagree about where a role belongs. The redirect stays above
// every piece of markup.
//
// AF-02 and review finding F-UI-02: the sandbox sentence is printed verbatim, in the first screen,
// never inside a fold. A reader who goes no further than this page still learns that no real money
// moves here. The demo password is not on this page and is not in the repository (AF-05).

export default async function LandingPage() {
  const user = await currentUser();
  if (user) {
    redirect(user.role === "staff_ops" || user.role === "staff_approver" ? "/ops" : user.role === "customer" ? "/customer" : "/broker");
  }

  return (
    <SignedOutFrame
      actions={
        <Link className="button-link" href="/login" prefetch={false}>
          Sign in
        </Link>
      }
    >
      <div className="landing-page">
        <section className="landing-hero">
          <div>
            <h1>
              Commercial policies,
              <br />
              on an <em>append-only</em> ledger.
            </h1>
            <p className="landing-lead">Brokers quote and bind, customers pay, operations reconcile. Every dollar lands in one immutable journal.</p>
            <Link className="button-link" href="/login" prefetch={false}>
              Sign in
            </Link>
          </div>
          <div className="landing-hero-art">
            <DecorativeIllustration name="welcome-corgi" variant="banner" sizes="(max-width: 720px) 16px, 300px" />
          </div>
        </section>

        <p className="landing-sandbox">Work-trial build on sandbox providers and test data. No real money moves here.</p>

        <section className="landing-section">
          <h2>What it does</h2>
          <p>Three things, in one place.</p>
          <div className="landing-cards">
            <article className="landing-card">
              <DecorativeIllustration name="open-ledger" variant="card" />
              <h3>Double entry</h3>
              <p>Every money event posts balanced debits and credits, forever.</p>
            </article>
            <article className="landing-card">
              <DecorativeIllustration name="balance-scales" variant="card" />
              <h3>Reconciliation</h3>
              <p>A rerunnable job compares the provider&apos;s records with ours.</p>
            </article>
            <article className="landing-card">
              <DecorativeIllustration name="checker-corgi" variant="card" />
              <h3>Maker-checker</h3>
              <p>Money out above the threshold waits for a second person.</p>
            </article>
          </div>
        </section>

        <section className="landing-section">
          <h2>Who uses it</h2>
          <p>Four demo accounts, one password, shared with the reviewers.</p>
          <div className="landing-cards">
            <article className="landing-card">
              <h3>Broker</h3>
              <p>Quotes, binds and follows commission on their policies.</p>
              <ul className="landing-accounts">
                <li>broker@example.com</li>
              </ul>
            </article>
            <article className="landing-card">
              <h3>Customer</h3>
              <p>Pays, reads the coverage and follows a claim.</p>
              <ul className="landing-accounts">
                <li>customer@example.com</li>
              </ul>
            </article>
            <article className="landing-card">
              <h3>Operations</h3>
              <p>Runs the console, the ledger and the approvals.</p>
              <ul className="landing-accounts">
                <li>ops@example.com</li>
                <li>approver@example.com</li>
              </ul>
            </article>
          </div>
        </section>
      </div>
    </SignedOutFrame>
  );
}
