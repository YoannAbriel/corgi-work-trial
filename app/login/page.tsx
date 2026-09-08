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
    <main>
      <h1>Corgi policy administration</h1>
      <p className="lead">Track 1 work trial build. Sandbox providers and synthetic data only.</p>

      {error ? <p className="error">{error}</p> : null}

      <form method="post" action="/api/session/login" className="card">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="username" />

        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required autoComplete="current-password" />

        <button type="submit">Sign in</button>
      </form>

      <p className="note">
        Demo accounts, created by the seed script: broker@example.com, customer@example.com,
        ops@example.com, approver@example.com. They all use the demo password shared with the
        reviewers. The broker signs in for policies and business verification; the operations and
        approver accounts see the brokers screen at /ops/brokers.
      </p>
    </main>
  );
}
