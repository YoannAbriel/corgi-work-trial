import { PortalShell } from "@/components/portal-shell";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current-user";
import { KYB_NOT_LIVE_LABEL } from "@/lib/broker/eligibility";
import { brokerKybEventHistory, brokerKybState, latestBrokerKybSubmission } from "@/lib/broker/kyb";

// /broker/kyb: the broker sends their company to Stripe for business verification.
//
// Nothing on this page decides anything. The form posts to /api/brokers/kyb, which records
// what was declared, calls Stripe and appends the status Stripe answers with. The status shown
// here is read from the append-only broker_kyb_events table, so it is the same status the
// server uses to allow or refuse binding.
export default async function BrokerKybPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; submitted?: string; rechecked?: string }>;
}) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "broker" || !user.brokerId) {
    redirect("/broker");
  }

  const [kyb, submission, history, query] = await Promise.all([
    brokerKybState(user.brokerId),
    latestBrokerKybSubmission(user.brokerId),
    brokerKybEventHistory(user.brokerId, 10),
    searchParams,
  ]);

  const verificationIsRunning = kyb.provider === "stripe_connect" && kyb.status === "pending";

  return (
    <PortalShell active="verification" user={user}>

      <h1>Business verification</h1>
      <p className="lead">
        A broker can only bind a policy once Stripe has verified the company behind it. The details below are sent to
        Stripe Connect in test mode; the EIN itself is never stored here, only its last four digits.
      </p>

      <p className={`badge ${kyb.status === "approved" ? "badge-ok" : "badge-warn"}`}>KYB status: {kyb.status}</p>
      <p className="note">{kyb.explanation}</p>
      {kyb.isProviderEvidence || !kyb.providerAccountId ? null : (
        <p className="note">{KYB_NOT_LIVE_LABEL}. The status above is a seeded placeholder, not provider evidence.</p>
      )}
      <p className="note">
        Stripe Connect business verification (test mode) is not a dedicated KYB vendor; it is the live check this
        build runs, and the status above is Stripe&apos;s answer.
      </p>

      {query.error ? <p className="error" role="alert">{query.error}</p> : null}
      {query.submitted ? (
        <p className="note" role="status">
          Sent to Stripe. Connected account {query.submitted}. Stripe answers in about a minute; the status stays
          pending for at least two minutes, then use &quot;Check the status at Stripe&quot; below.
        </p>
      ) : null}
      {query.rechecked ? <p className="note" role="status">Read again at Stripe: {query.rechecked}</p> : null}

      {submission ? (
        <>
          <h2>What was submitted</h2>
          <div className="table-scroll" role="region" aria-label="Submitted business details" tabIndex={0}>
        <table className="amounts">
            <tbody>
              <tr>
                <th>Registered name</th>
                <td>{submission.legalName}</td>
              </tr>
              <tr>
                <th>EIN</th>
                <td>ending {submission.einLast4}</td>
              </tr>
              <tr>
                <th>Registered address</th>
                <td>
                  {submission.addressLine1}, {submission.addressCity} {submission.addressState}{" "}
                  {submission.addressPostalCode}
                </td>
              </tr>
              <tr>
                <th>Business website</th>
                <td>{submission.businessUrl}</td>
              </tr>
              <tr>
                <th>Connected account</th>
                <td>{kyb.providerAccountId ?? "not created yet"}</td>
              </tr>
              <tr>
                <th>Submitted (UTC)</th>
                <td>{submission.recordedAt.toISOString().replace("T", " ").slice(0, 19)}</td>
              </tr>
              <tr>
                <th>Agreement accepted (UTC, from)</th>
                <td>
                  {submission.termsAcceptedAt.toISOString().replace("T", " ").slice(0, 19)} from{" "}
                  {submission.termsAcceptedIp}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        </>
      ) : null}

      {kyb.providerAccountId ? (
        <form method="post" action={`/api/brokers/${user.brokerId}/kyb/recheck`} className="inline-form">
          <button type="submit">Check the status at Stripe</button>
        </form>
      ) : null}

      {verificationIsRunning ? null : (
        <>
          <h2>{kyb.status === "approved" && kyb.provider === "stripe_connect" ? "Company verified" : submission ? "Submit again" : "Submit the company"}</h2>
          {kyb.status === "approved" && kyb.provider === "stripe_connect" ? (
            <p className="note" role="status">This company is already verified. There is nothing to submit again.</p>
          ) : (
            <form method="post" action="/api/brokers/kyb" className="card">
              <label htmlFor="legalName">Registered legal name</label>
              <input id="legalName" name="legalName" autoComplete="organization" required maxLength={120} defaultValue={submission?.legalName} />

              <label htmlFor="employerIdentificationNumber">EIN (nine digits, no dash)</label>
              <input
                id="employerIdentificationNumber"
                name="employerIdentificationNumber" aria-describedby="ein-help" autoComplete="off" spellCheck={false}
                required
                inputMode="numeric"
                maxLength={9}
                placeholder="000000000"
              />
              <span id="ein-help" className="note">
                Stripe publishes three test values, and what each one actually produced here on 2026-09-08 is written
                next to it: <strong>000000000</strong> verifies; <strong>111111111</strong> fails with{" "}
                <code>verification_failed_tax_id_match</code>; <strong>222221005</strong> is documented as pending but
                came back approved in this configuration, so it is not the way to demonstrate a pending broker. The
                honest pending state is the first minutes after this form is submitted.
              </span>

              <label htmlFor="addressLine1">Registered address, line 1</label>
              <input
                id="addressLine1"
                name="addressLine1" aria-describedby="address-help" autoComplete="address-line1"
                required
                maxLength={200}
                defaultValue={submission?.addressLine1 ?? "address_full_match"}
              />
              <span id="address-help" className="note">
                Stripe&apos;s test token <code>address_full_match</code> is accepted here and matches the business
                records exactly.
              </span>

              <label htmlFor="addressCity">City</label>
              <input id="addressCity" name="addressCity" autoComplete="address-level2" required maxLength={80} defaultValue={submission?.addressCity ?? "San Francisco"} />

              <label htmlFor="addressState">State (two letters)</label>
              <input id="addressState" name="addressState" autoComplete="address-level1" required maxLength={2} defaultValue={submission?.addressState ?? "CA"} />

              <label htmlFor="addressPostalCode">ZIP code</label>
              <input
                id="addressPostalCode"
                name="addressPostalCode" autoComplete="postal-code"
                required
                maxLength={10}
                defaultValue={submission?.addressPostalCode ?? "94105"}
              />

              <label htmlFor="businessUrl">Business website</label>
              <input id="businessUrl" name="businessUrl" aria-describedby="website-help" type="url" autoComplete="url" required maxLength={200} defaultValue={submission?.businessUrl} placeholder="https://" />
              <span id="website-help" className="note">
                Stripe validates it and refuses <code>https://example.com</code> with <code>url_invalid</code>, so use
                a real address.
              </span>

              <label htmlFor="contactEmail">Contact email</label>
              <input
                id="contactEmail"
                name="contactEmail" autoComplete="email" spellCheck={false}
                type="email"
                required
                maxLength={200}
                defaultValue={submission?.contactEmail ?? user.email}
              />

              {/* The exact wording decided by Yoann on 2026-09-08 (docs/DECISIONS.md). An
                  account with no Stripe dashboard cannot accept the agreement on Stripe's
                  side, so the platform collects the acceptance and passes on the real instant
                  and IP address with the account. */}
              <label htmlFor="termsAccepted" className="checkbox-label">
                <input id="termsAccepted" name="termsAccepted" type="checkbox" value="yes" required />
                <span>By submitting, you accept the{" "}
                <a href="https://stripe.com/connect-account/legal" target="_blank" rel="noreferrer">
                  Stripe Connected Account Agreement
                </a>{" "}
                on behalf of your business</span>
              </label>

              <button type="submit">Submit for verification</button>
            </form>
          )}
        </>
      )}

      <h2>Status history</h2>
      {history.length === 0 ? (
        <p className="note">No status recorded yet.</p>
      ) : (
        <div className="table-scroll" role="region" aria-label="Verification history" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Provider</th>
              <th>Reason</th>
              <th>Recorded (UTC)</th>
            </tr>
          </thead>
          <tbody>
            {history.map((event) => (
              <tr key={event.id}>
                <td>{event.status}</td>
                <td>{event.provider}</td>
                <td>
                  {event.reason ?? ""}
                  {event.requirementErrorCodes.length > 0 ? (
                    <>
                      <br />
                      <span className="note">{event.requirementErrorCodes.join(", ")}</span>
                    </>
                  ) : null}
                </td>
                <td>{event.recordedAt.toISOString().replace("T", " ").slice(0, 19)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </PortalShell>
  );
}
