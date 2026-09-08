import { PortalShell } from "@/components/portal-shell";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current-user";
import { brokerKybState, KYB_NOT_LIVE_LABEL } from "@/lib/broker/kyb";
import { FLAT_POLICY_FEE_CENTS } from "@/lib/policy/charge";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { statesWithTaxRates } from "@/lib/policy/tax-rate";

// The quote form. Nothing here computes money: the server prices the draft with the
// effective-dated tax rate on file and writes the result as an immutable 'quoted' event.
export default async function NewPolicyPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "broker" || !user.brokerId) {
    redirect("/broker");
  }

  const [states, kyb, { error }] = await Promise.all([statesWithTaxRates(), brokerKybState(user.brokerId), searchParams]);

  return (
    <PortalShell active="policies" user={user} trail={[{ label: "New policy" }]}>
      <h1>New policy</h1>
      <p className="lead">
        Commercial general liability, annual term. The premium tax comes from the effective-dated rate on file for
        the state; the policy fee is a flat {formatCentsAsUsd(FLAT_POLICY_FEE_CENTS)} (assumption of this build, not a
        filed fee).
      </p>

      {kyb.status === "approved" ? null : (
        <>
          <p className="badge badge-warn">
            KYB status: {kyb.status}. A draft can be created, but binding will be refused until the broker is approved.
          </p>
          <p className="note">
            {kyb.explanation} <Link href="/broker/kyb">Submit or check the business verification</Link>.
          </p>
        </>
      )}
      {kyb.isProviderEvidence ? null : <p className="note">{KYB_NOT_LIVE_LABEL}: the KYB status is a seeded placeholder.</p>}

      {error ? <p className="error">{error}</p> : null}

      <form method="post" action="/api/policies" className="card">
        <label htmlFor="customerName">Customer name</label>
        <input id="customerName" name="customerName" required maxLength={120} />

        <label htmlFor="customerEmail">Customer email</label>
        <input id="customerEmail" name="customerEmail" type="email" required maxLength={200} />

        <label htmlFor="stateCode">State</label>
        <select id="stateCode" name="stateCode" required>
          {states.map((stateCode) => (
            <option key={stateCode} value={stateCode}>
              {stateCode}
            </option>
          ))}
        </select>

        <label htmlFor="effectiveAt">Effective date (term start)</label>
        <input id="effectiveAt" name="effectiveAt" type="date" required />

        <label htmlFor="annualPremium">Annual premium (USD)</label>
        <input id="annualPremium" name="annualPremium" required placeholder="1200.00" inputMode="decimal" />

        <label htmlFor="perOccurrenceLimit">Per-occurrence limit (USD)</label>
        <input id="perOccurrenceLimit" name="perOccurrenceLimit" required placeholder="1000000" inputMode="decimal" />

        <label htmlFor="aggregateLimit">Aggregate limit (USD)</label>
        <input id="aggregateLimit" name="aggregateLimit" required placeholder="2000000" inputMode="decimal" />

        <button type="submit">Create draft</button>
      </form>
    </PortalShell>
  );
}
