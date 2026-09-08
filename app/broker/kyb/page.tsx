import { PortalShell } from "@/components/portal-shell";
import { Disclosure, SandboxReferences } from "@/components/disclosures";
import { AsideList, Chip, DetailGrid, DetailHeading, Empty, Panel } from "@/components/detail-layout";
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
  const verified = kyb.status === "approved" && kyb.provider === "stripe_connect";

  const notices = [
    query.error ? <p key="error" className="error" role="alert">{query.error}</p> : null,
    query.submitted ? (
      <p key="submitted" className="note" role="status">
        Sent to Stripe. Connected account {query.submitted}. Stripe answers in about a minute; the status stays pending
        for at least two minutes, then use &quot;Check the status at Stripe&quot;.
      </p>
    ) : null,
    query.rechecked ? <p key="rechecked" className="note" role="status">Read again at Stripe: {query.rechecked}</p> : null,
  ].filter(Boolean);

  return (
    <PortalShell active="verification" user={user}>
      <DetailHeading
        title="Business verification"
        lead="A broker can bind a policy only once Stripe has verified the company behind it."
        chips={
          <>
            <Chip tone={kyb.status === "approved" ? "ok" : "warn"}>{kyb.status}</Chip>
            {kyb.providerAccountId ? <Chip tone="neutral">connected account at Stripe</Chip> : <Chip tone="neutral">not submitted</Chip>}
          </>
        }
        actions={
          kyb.providerAccountId ? (
            <form method="post" action={`/api/brokers/${user.brokerId}/kyb/recheck`} className="inline-form">
              <button type="submit" className="secondary">Check the status at Stripe</button>
            </form>
          ) : undefined
        }
      />

      {notices.length > 0 ? <div className="notices">{notices}</div> : null}

      <DetailGrid
        main={
          <>
            <Panel title="Where it stands">
              <p className="note">{kyb.explanation}</p>
              {kyb.isProviderEvidence || !kyb.providerAccountId ? null : (
                <p className="note">{KYB_NOT_LIVE_LABEL}. The status above is a seeded placeholder, not provider evidence.</p>
              )}
            </Panel>

            {submission ? (
              <Panel title="What was submitted">
                <AsideList
                  items={[
                    { label: "Registered name", value: submission.legalName },
                    { label: "EIN", value: `ending ${submission.einLast4}` },
                    {
                      label: "Registered address",
                      value: `${submission.addressLine1}, ${submission.addressCity} ${submission.addressState} ${submission.addressPostalCode}`,
                    },
                    { label: "Business website", value: submission.businessUrl },
                    {
                      label: "Connected account",
                      value: (
                        <>
                          {kyb.providerAccountId ? "created at Stripe" : "not created yet"}
                          <SandboxReferences references={[{ label: "Stripe connected account", value: kyb.providerAccountId }]} />
                        </>
                      ),
                    },
                    { label: "Submitted (UTC)", value: submission.recordedAt.toISOString().replace("T", " ").slice(0, 19) },
                    {
                      label: "Agreement accepted (UTC, from)",
                      value: `${submission.termsAcceptedAt.toISOString().replace("T", " ").slice(0, 19)} from ${submission.termsAcceptedIp}`,
                    },
                  ]}
                />
              </Panel>
            ) : null}

            {verificationIsRunning ? (
              <Panel title="Verification running">
                <Empty>Stripe is checking the company. The status stays pending for at least two minutes; then check it with the button above.</Empty>
              </Panel>
            ) : verified ? (
              <Panel title="Company verified">
                <Empty>This company is already verified. There is nothing to submit again.</Empty>
              </Panel>
            ) : (
              <Panel title={submission ? "Submit again" : "Submit the company"}>
                <p className="note">
                  The details are sent to Stripe Connect in test mode; the EIN itself is never stored here, only its
                  last four digits.
                </p>
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

                  <button type="submit" className="orange">Submit for verification</button>
                </form>
              </Panel>
            )}

            <Panel title="Status history">
              {history.length === 0 ? (
                <Empty>No status recorded yet.</Empty>
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
                          <td>
                            <Chip tone={event.status === "approved" ? "ok" : event.status === "failed" ? "warn" : "neutral"}>{event.status}</Chip>
                          </td>
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
            </Panel>
          </>
        }
        aside={
          <Panel title="How this works">
            <Disclosure title="What Stripe checks">
              <p>
                Stripe Connect business verification (test mode) is not a dedicated KYB vendor; it is the live check
                this build runs, and the status shown is Stripe&apos;s answer. The server reads that same status before
                allowing a policy to be bound.
              </p>
            </Disclosure>
            <Disclosure title="Pending, approved, failed">
              <p>
                The status stays pending for at least two minutes after a submission (a settling window), then
                &quot;Check the status at Stripe&quot; reads it again. A failed check names Stripe&apos;s own requirement
                codes. Every status is a row appended when observed, never edited.
              </p>
            </Disclosure>
            <Disclosure title="What is stored">
              <p>
                The registered name, the address, the website, the last four digits of the EIN, the connected account
                id, and the instant and IP address of the agreement acceptance. The EIN itself is never stored.
              </p>
            </Disclosure>
          </Panel>
        }
      />
    </PortalShell>
  );
}
