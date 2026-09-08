import Link from "next/link";

export default function NotFound() {
  return (
    <main className="workspace-feedback">
      <h1>This page couldn’t be found.</h1>
      <p>The link may be incomplete, or this record is no longer available to your account.</p>
      <Link href="/" className="button-link">Back to workspace</Link>
    </main>
  );
}
