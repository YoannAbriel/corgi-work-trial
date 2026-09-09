import "@/app/styles/lists.css";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Chip } from "@/components/detail-layout";
import { MoneyAmountInput } from "@/components/money-amount-input";
import { PortalShell } from "@/components/portal-shell";
import { About } from "@/components/ui/about";
import { SubmitButton } from "@/components/ui/submit-button";
import { currentUser } from "@/lib/auth/current-user";
import { brokerKybState, KYB_NOT_LIVE_LABEL } from "@/lib/broker/kyb";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { FLAT_POLICY_FEE_CENTS } from "@/lib/policy/charge";
import { statesWithTaxRates } from "@/lib/policy/tax-rate";
import { toastsFromQuery, type Query } from "@/lib/ui/views";

// The quote form. Nothing here computes money: the server prices the draft with the
// effective-dated tax rate on file and writes the result as an immutable 'quoted' event.
export default async function NewPolicyPage({ searchParams }: { searchParams: Promise<Query> }) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "broker" || !user.brokerId) {
    redirect("/broker");
  }

  const [states, kyb, query] = await Promise.all([statesWithTaxRates(), brokerKybState(user.brokerId), searchParams]);
  const toasts = toastsFromQuery(query, { error: { tone: "error", title: "Refused" } });
  const statusWord = kyb.status === "unknown" && !kyb.providerAccountId ? "not submitted" : kyb.status;

  return (
    <PortalShell
      active="policies"
      user={user}
      trail={[{ label: "New policy" }]}
      toasts={toasts}
      band={{
        title: "New policy",
        suffix: "commercial general liability, annual term",
        // One chip (cycle 2, decision 1): whether this broker may bind what they are quoting.
        // The term is in the band's suffix; the AF-02 words are on the top bar.
        meta: <Chip tone={kyb.status === "approved" ? "ok" : "warn"}>business verification {statusWord}</Chip>,
      }}
    >
      {query.error ? (
        <div className="notices">
          <p className="error" role="alert">
            {query.error}
          </p>
        </div>
      ) : null}
      {kyb.status === "approved" ? null : (
        <div className="notices">
          <p className="note">
            A draft can be created, but binding will be refused until the broker is approved. {kyb.explanation}{" "}
            <Link href="/broker/kyb">Submit or check the business verification</Link>.
          </p>
          {kyb.isProviderEvidence ? null : <p className="note">{KYB_NOT_LIVE_LABEL}: the status is a seeded placeholder.</p>}
        </div>
      )}

      {/* The form alone in the reading flow (cycle 2, decision 9): what happens after it is
          submitted is an explanation, and every explanation is in About below. */}
      <section className="card lists-form-card">
        <h2>The quote</h2>
        <form method="post" action="/api/policies" className="card lists-form">
          <label htmlFor="customerName">Customer name</label>
          <input id="customerName" name="customerName" autoComplete="organization" required maxLength={120} />

          <label htmlFor="customerEmail">Customer email</label>
          <input id="customerEmail" name="customerEmail" autoComplete="email" spellCheck={false} type="email" required maxLength={200} />

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
          <MoneyAmountInput id="annualPremium" name="annualPremium" required placeholder="1,200.00" />

          {/* The hint is said once, under the premium. Printed under all three fields, its
              example (1,200.00) contradicted these two placeholders (round 1, MEDIUM). */}
          <label htmlFor="perOccurrenceLimit">Per-occurrence limit (USD)</label>
          <MoneyAmountInput id="perOccurrenceLimit" name="perOccurrenceLimit" required placeholder="1,000,000" hint={null} />

          <label htmlFor="aggregateLimit">Aggregate limit (USD)</label>
          <MoneyAmountInput id="aggregateLimit" name="aggregateLimit" required placeholder="2,000,000" hint={null} />

          <SubmitButton>Create draft</SubmitButton>
        </form>
      </section>

      <About>
        <h4>What happens next</h4>
        <p>
          The draft is priced by the server and written as one immutable quoted event. The customer pays through Stripe, in test mode. The policy binds when the payment is confirmed and the verification is approved.
        </p>
        <h4>How it is priced</h4>
        <p>
          The premium tax comes from the effective-dated rate on file for the state chosen above. The policy fee is a flat {formatCentsAsUsd(FLAT_POLICY_FEE_CENTS)}, an assumption of this build and not a filed fee.
        </p>
        <h4>Where the arithmetic happens</h4>
        <p>
          On the server, in integer cents, when the draft is created. This form sends what you typed and computes nothing; the policy page shows the total it was given and how it was reached.
        </p>
        <h4>Binding</h4>
        <p>
          A draft can be created whatever the verification says. Binding is refused until the broker is approved, and money that arrives meanwhile sits in the suspense account until staff operations decide.
        </p>
      </About>
    </PortalShell>
  );
}
