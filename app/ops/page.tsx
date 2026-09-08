import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current-user";

// /ops: where a staff member lands after signing in. Nothing is computed here; it is the map
// of the operations screens, each of which asks the role question again for itself.
export default async function OpsHomePage() {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "staff_ops" && user.role !== "staff_approver") {
    redirect("/broker");
  }

  const isApprover = user.role === "staff_approver";

  return (
    <main>
      <h1>Operations</h1>
      <p className="lead">
        Signed in as {user.displayName} ({user.role}).{" "}
        {isApprover
          ? "You approve money out that somebody else requested; you cannot request it yourself."
          : "You request money out and bind policies; a distinct approver decides above the threshold."}
      </p>

      <ul>
        <li>
          <Link href="/ops/brokers">Brokers and their verification</Link>: KYB status of every broker, re-read at Stripe on
          demand.
        </li>
        <li>
          <Link href="/ops/claims">Claims</Link>: reserves, payments and the simulated payout rail (LOCAL SIMULATOR).
        </li>
        <li>
          <Link href="/ops/approvals">Approvals</Link>: money out above $1,000 waiting for a distinct human approver.
        </li>
        <li>
          <Link href="/ops/reconciliation">Reconciliation</Link>: what Stripe and the claim payout rail say against what
          the ledger says, the open breaks and their age, and a &ldquo;Run now&rdquo; button.
        </li>
        <li>
          <Link href="/ops/statements">Broker statements</Link>: a broker&apos;s commission for one month, read from the
          journal and frozen, with the knowledge cutoff that makes a closed month reproduce and the revisions a later
          correction creates.
        </li>
        <li>
          <Link href="/broker">Policies</Link>: the broker journey, readable by staff, with the staff actions on each
          policy page (bind after a refused binding, cancel with a preview).
        </li>
      </ul>

      <p className="note">
        Every screen here reads append-only tables; nothing on these pages edits or deletes a money row. Corrections are
        reversals plus re-bookings, visible in each policy&apos;s journal.
      </p>
    </main>
  );
}
