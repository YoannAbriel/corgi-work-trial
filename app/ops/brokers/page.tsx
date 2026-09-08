import { PortalShell } from "@/components/portal-shell";
import { Disclosure, SandboxReferences } from "@/components/disclosures";
import { Chip, DetailHeading, Empty, Panel } from "@/components/detail-layout";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current-user";
import { KYB_NOT_LIVE_LABEL } from "@/lib/broker/eligibility";
import { brokersWithKybState } from "@/lib/broker/kyb";

// /ops/brokers: where the operations team sees whether a broker may bind, and why.
//
// Staff only, read from the append-only broker_kyb_events table. The one action on the page
// re-reads the account at Stripe and appends a status row only if the answer changed, so
// pressing it twice does not add a second row (POST /api/brokers/{id}/kyb/recheck).
export default async function OpsBrokersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; rechecked?: string }>;
}) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "staff_ops" && user.role !== "staff_approver") {
    redirect("/broker");
  }

  const [brokers, query] = await Promise.all([brokersWithKybState(), searchParams]);
  const approved = brokers.filter((broker) => broker.state.status === "approved").length;

  return (
    <PortalShell active="verification" user={user}>
      <DetailHeading
        title="Brokers and verification"
        lead={`${brokers.length} ${brokers.length === 1 ? "broker" : "brokers"}, ${approved} approved to bind. Every status is Stripe's own answer, appended when observed, never edited.`}
      />

      {query.error || query.rechecked ? (
        <div className="notices">
          {query.error ? <p className="error" role="alert">{query.error}</p> : null}
          {query.rechecked ? <p className="note" role="status">Read again at Stripe: {query.rechecked}</p> : null}
        </div>
      ) : null}

      <Panel title="Brokers" className="list-panel">
        {brokers.length === 0 ? (
          <Empty>No broker exists yet.</Empty>
        ) : (
          <div className="table-scroll" role="region" aria-label="Broker verification" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Broker</th>
                  <th>Status</th>
                  <th>Provider</th>
                  <th>Submitted (UTC)</th>
                  <th>Detail</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {brokers.map((broker) => (
                  <tr key={broker.brokerId}>
                    <td>
                      {broker.brokerName}
                      <br />
                      <span className="note">commission {(broker.commissionRateBps / 100).toFixed(2)}%</span>
                    </td>
                    <td>
                      <Chip tone={broker.state.status === "approved" ? "ok" : "warn"}>{broker.state.status}</Chip>
                      {broker.state.heldBySettlingWindow ? (
                        <>
                          <br />
                          {/* The row on file says approved; the settling window is why it is not
                              being acted on yet. Staff see both, so the screen explains itself. */}
                          <span className="note">recorded as {broker.state.recordedStatus}, held by the settling window</span>
                        </>
                      ) : null}
                      {broker.state.recordedAt ? (
                        <>
                          <br />
                          <span className="note">at {broker.state.recordedAt.toISOString().replace("T", " ").slice(0, 19)}</span>
                        </>
                      ) : null}
                    </td>
                    <td>
                      {broker.state.provider}
                      <br />
                      <span className="note">{broker.state.providerAccountId ? "connected account" : "no connected account"}</span>
                      <SandboxReferences references={[{ label: "Stripe connected account", value: broker.state.providerAccountId }]} />
                      {broker.state.isProviderEvidence || !broker.state.providerAccountId ? null : (
                        <>
                          <br />
                          <span className="note">{KYB_NOT_LIVE_LABEL}: seeded placeholder, not provider evidence.</span>
                        </>
                      )}
                    </td>
                    <td>
                      {broker.submission ? (
                        <>
                          {broker.submission.recordedAt.toISOString().replace("T", " ").slice(0, 19)}
                          <br />
                          <span className="note">
                            {broker.submission.legalName}, EIN ending {broker.submission.einLast4}
                          </span>
                        </>
                      ) : (
                        <span className="note">never submitted</span>
                      )}
                    </td>
                    <td>
                      {broker.state.explanation}
                      {broker.requirementErrorCodes.length > 0 ? (
                        <>
                          <br />
                          {/* Stripe's own codes, quoted rather than paraphrased. */}
                          <span className="note">Stripe requirement errors: {broker.requirementErrorCodes.join(", ")}</span>
                        </>
                      ) : null}
                    </td>
                    <td>
                      {broker.state.providerAccountId ? (
                        <form method="post" action={`/api/brokers/${broker.brokerId}/kyb/recheck`} className="inline-form">
                          <button type="submit" className="secondary small">Re-read from Stripe</button>
                        </form>
                      ) : (
                        <span className="note">nothing to read</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Disclosure>
          <p>
            Verification runs on Stripe Connect business verification in test mode, which is not a dedicated KYB
            vendor; every status comes from Stripe&apos;s own answers, never from a form. A broker can bind a policy only
            while the status is approved.
          </p>
          <p>
            A re-read appends a status row only when the status changed, and the row records which user asked for it.
            Stripe stops emitting <code>account.updated</code> once its identity check has landed, which happens inside
            the two-minute settling window, so this button is how a pending broker becomes approved.
          </p>
        </Disclosure>
      </Panel>
    </PortalShell>
  );
}
