import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { CUSTOMER_APPROVAL_THRESHOLD_CENTS } from "@/lib/money/endorsement";
import { correctionsOfPolicy } from "@/lib/policy/correction-read";
import { FormulaLinesTable } from "../../../formula-lines";

// The customer's screen for a correction that costs them more money.
//
// An endorsement was recorded with the wrong effective date, the correction put it right, and the
// corrected date charges more days of cover. Above $500 the customer decides, exactly as they do
// for an endorsement above $500. They see the two dates, the two amounts and the difference,
// computed by the same pure function that priced the correction, before they accept anything.
export default async function ApproveCorrectionPage({
  params,
}: {
  params: Promise<{ policyId: string; rebookEventId: string }>;
}) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  const { policyId, rebookEventId } = await params;

  const [policy] = await sql<{ policy_number: string; customer_id: string }[]>`
    select policy_number, customer_id from policies where id = ${policyId}
  `;
  if (!policy) {
    notFound();
  }
  // Ownership, checked on the server: the customer of this policy and nobody else. The server
  // checks it again when the button is pressed, so this is the explanation, not the control.
  if (user.role !== "customer" || user.customerId !== policy.customer_id) {
    redirect("/customer");
  }

  const correction = (await correctionsOfPolicy(policyId)).find((row) => row.rebookEventId === rebookEventId);
  if (!correction || !correction.collection) {
    notFound();
  }

  if (correction.collection.paidOn) {
    return (
      <main>
        <p className="note">
          <Link href="/customer">Back to your policies</Link>
        </p>
        <h1>Nothing to approve</h1>
        <p className="note">This difference was already paid on {correction.collection.paidOn}.</p>
      </main>
    );
  }

  return (
    <main>
      <p className="note">
        <Link href="/customer">Back to your policies</Link>
      </p>

      <h1>Policy {policy.policy_number}: a correction to approve</h1>
      <p className="lead">
        A change to your policy was recorded with the wrong start date. It was put right: it now takes effect on{" "}
        <strong>{correction.correctedEffectiveAt}</strong> instead of {correction.wrongEffectiveAt}, which is{" "}
        {correction.money.after.daysRemaining} days of cover instead of {correction.money.before.daysRemaining}.
      </p>
      <p className="note">Reason recorded by our operations team: {correction.reason}.</p>

      <h2>What it costs</h2>
      <table className="amounts">
        <tbody>
          <tr>
            <th>Charged when the change was recorded</th>
            <td className="amount">{formatCentsAsUsd(correction.money.before.deltaTotalCents)}</td>
          </tr>
          <tr>
            <th>Correct amount for the corrected start date</th>
            <td className="amount">{formatCentsAsUsd(correction.money.after.deltaTotalCents)}</td>
          </tr>
          <tr className="total">
            <th>Difference to pay</th>
            <td className="amount">{formatCentsAsUsd(correction.collection.amountCents)}</td>
          </tr>
        </tbody>
      </table>

      <h2>Every figure, and how it was computed</h2>
      <FormulaLinesTable lines={correction.lines} />

      <p className="note">
        Your approval is needed because the difference is above {formatCentsAsUsd(CUSTOMER_APPROVAL_THRESHOLD_CENTS)}.
        Approving records your acceptance; your broker then opens the Stripe payment page. Nothing is charged by this
        button.
      </p>

      {correction.collection.customerApprovedAt ? (
        <p className="badge badge-ok">
          Already approved on {correction.collection.customerApprovedAt.toISOString().replace("T", " ").slice(0, 19)} UTC
        </p>
      ) : (
        <form method="post" action={`/api/policies/${policyId}/corrections/${rebookEventId}/approve`} className="card">
          <button type="submit">Approve paying {formatCentsAsUsd(correction.collection.amountCents)}</button>
        </form>
      )}
    </main>
  );
}
