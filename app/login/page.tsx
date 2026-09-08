import { PortalShell } from "@/components/portal-shell";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current-user";

// The only page a signed-out visitor can use. The four demo accounts are created by
// `npm run seed` and share one password, given to the panel with the deployed URL.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await currentUser();
  if (user) {
    redirect("/broker");
  }
  const { error } = await searchParams;

  return (
    <PortalShell active="login">
      <div className="page-heading">
        <h1>Welcome to your workspace</h1>
        <p className="lead">Sign in to Corgi policy administration.</p>
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
            <input id="email" name="email" type="email" required autoComplete="username" spellCheck={false} />

            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required autoComplete="current-password" />

            <button type="submit">Sign in</button>
          </form>

          <details className="demo-accounts">
            <summary>Demo accounts and access</summary>
            <p className="note">
              Demo accounts, created by the seed script: broker@example.com, customer@example.com,
              ops@example.com, approver@example.com. They all use the demo password shared with the reviewers.
              The broker signs in for policies and business verification; the operations and approver accounts
              see the brokers screen at /ops/brokers.
            </p>
          </details>
        </div>
        <section className="login-art-panel">
          <img src="/illustrations/corgi-desk.webp" width="1024" height="1024" alt="" />
          <h2>Good work starts with a clear view.</h2>
          <p>
            Your policies, payments and next steps,
            <br />
            all in one thoughtful workspace.
          </p>
        </section>
      </div>
    </PortalShell>
  );
}
