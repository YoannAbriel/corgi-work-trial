import { redirect } from "next/navigation";
import { DecorativeIllustration } from "@/components/decorative-illustration";
import { SignedOutFrame } from "@/components/signed-out-frame";
import { SubmitButton } from "@/components/ui/submit-button";
import { Toaster } from "@/components/ui/toast";
import { currentUser } from "@/lib/auth/current-user";
import { toastsFromQuery } from "@/lib/ui/views";
import "@/app/styles/landing.css";

// The only page a signed-out visitor can act on. One centred card, the illustration beside it on a
// wide screen, the sandbox sentence under it.
//
// THE FORM IS UNCHANGED: same method, same action, same field names, so /api/session/login sees
// exactly what it saw before. Only the submit button is the shared SubmitButton, which shows the
// post is in flight and changes nothing about what is posted.
//
// A refusal arrives as `?error=`. It is printed twice on purpose: as a toast, which is what a
// person notices, and as the inline `<p className="error" role="alert">` the review scripts read.
//
// The four demo accounts are created by `npm run seed` and share one password given to the
// reviewers with the deployed URL. The password is not in this file, not in the repository and
// not in any screenshot (AF-05).
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await currentUser();
  if (user) {
    redirect(user.role === "staff_ops" || user.role === "staff_approver" ? "/ops" : user.role === "customer" ? "/customer" : "/broker");
  }
  const query = await searchParams;
  const toasts = toastsFromQuery(query, { error: { tone: "error", title: "Refused" } });

  return (
    <SignedOutFrame>
      <div className="landing-signin">
        <div className="landing-signin-card">
          <h1>Sign in</h1>
          <p>Corgi policy administration.</p>

          {query.error ? (
            <div className="notices">
              <p className="error" role="alert">
                {query.error}
              </p>
            </div>
          ) : null}

          <form method="post" action="/api/session/login" className="card">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required autoComplete="username" spellCheck={false} />

            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required autoComplete="current-password" />

            <SubmitButton>Sign in</SubmitButton>
          </form>

          <details className="demo-accounts">
            <summary>Demo accounts and access</summary>
            {/* Four lines, one account each, the role first: the same shape as the "Who uses it"
                cards of the landing page. It was one 55-word paragraph (round 1, MEDIUM). */}
            <ul className="note">
              <li>Broker: broker@example.com</li>
              <li>Customer: customer@example.com</li>
              <li>Operations: ops@example.com</li>
              <li>Approver: approver@example.com</li>
            </ul>
            <p className="note">Created by the seed script. They share the demo password given to the reviewers.</p>
          </details>
        </div>

        <section className="landing-signin-art">
          {/* Hidden below 1000 px by app/styles/landing.css. A media query cannot cancel a
              download, so the narrow case asks for the smallest file the optimiser produces. */}
          <DecorativeIllustration name="welcome-corgi" variant="banner" sizes="(max-width: 1000px) 16px, 240px" />
          <p>Your policies, payments and next steps, in one workspace.</p>
        </section>
      </div>

      <p className="sandbox-note landing-signin-note">Work-trial build on sandbox providers and test data. No real money moves here.</p>

      {toasts.length > 0 ? <Toaster notices={toasts} /> : null}
    </SignedOutFrame>
  );
}
