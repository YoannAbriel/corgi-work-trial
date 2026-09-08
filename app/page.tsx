import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>Corgi policy administration</h1>
      <p className="lead">Work trial build, Track 1. Sandbox providers and synthetic data only.</p>
      <p>
        <Link href="/login">Sign in</Link>
      </p>
      <p className="note">
        Payments run on Stripe in test mode: no real card, no real money. Health check:{" "}
        <a href="/api/health">/api/health</a>
      </p>
    </main>
  );
}
