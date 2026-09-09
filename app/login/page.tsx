import { SignedOutFrame } from "@/components/signed-out-frame";
import { DecorativeIllustration } from "@/components/decorative-illustration";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current-user";
// UI-003: the width of the signed-out page is fixed there, so opening the demo-account help
// cannot move the form sideways any more. The rule and its measurements are in that file.
import "@/app/styles/shell.css";

// The only page a signed-out visitor can use. The four demo accounts are created by
// `npm run seed` and share one password, given to the panel with the deployed URL.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  if (user) {
    redirect(user.role === "staff_ops" || user.role === "staff_approver" ? "/ops" : user.role === "customer" ? "/customer" : "/broker");
  }
  const { error } = await searchParams;

  return (
    <SignedOutFrame>
      <div className="page-heading">
        <h1>
          Welcome to your <em>workspace.</em>
        </h1>
        <p className="lead">Sign in to Corgi policy administration.</p>
        <p className="sandbox-note">Work-trial build on sandbox providers and test data. No real money moves here.</p>
      </div>

      <div className="login-grid">
        <div>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}

          <form method="post" action="/api/session/login" className="card">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="username"
              spellCheck={false}
            />

            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />

            <button type="submit">Sign in</button>
          </form>

          <details className="demo-accounts">
            <summary>Demo accounts and access</summary>
            <p className="note">
              Demo accounts, created by the seed script: broker@example.com,
              customer@example.com, ops@example.com, approver@example.com. They
              all use the demo password shared with the reviewers. The broker
              signs in for policies and business verification; the operations
              and approver accounts open the operations workspace.
            </p>
          </details>
        </div>
        <section className="login-art-panel">
          {/* app/globals.css hides .login-art-panel below 580 px. A media query cannot cancel a
              download, so the narrow case asks for the smallest file the optimiser produces. */}
          <DecorativeIllustration
            name="welcome-corgi"
            variant="banner"
            sizes="(max-width: 580px) 16px, 220px"
          />
          <h2>
            A clearer view. <em>A better next step.</em>
          </h2>
          <p>
            Your policies, payments and next steps,
            <br />
            all in one thoughtful workspace.
          </p>
        </section>
      </div>
    </SignedOutFrame>
  );
}
