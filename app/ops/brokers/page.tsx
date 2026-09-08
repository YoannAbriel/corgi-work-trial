import { PortalShell } from "@/components/portal-shell";
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

  return (
    <PortalShell active="verification" user={user}>
      <h1>Brokers & <em>verification.</em></h1>
      <p className="note">
        Verification runs on Stripe Connect business verification in test mode, which is not a dedicated KYB vendor;
        every status below comes from Stripe&apos;s own answers, never from a form.
      </p>
      <p className="lead">
        Signed in as {user.displayName} ({user.role}). A broker can bind a policy only while the status below is
        approved; every status is a row that was appended when it was observed, never edited.
      </p>

      {query.error ? <p className="error" role="alert">{query.error}</p> : null}
      {query.rechecked ? <p className="note" role="status">Read again at Stripe: {query.rechecked}</p> : null}

      {brokers.length === 0 ? (
        <p className="note" role="status">No broker exists yet.</p>
      ) : (
        <div className="table-scroll" role="region" aria-label="Broker verification" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Broker</th>
              <th>Status</th>
              <th>Provider and account</th>
              <th>Submitted (UTC)</th>
              <th>Detail</th>
              <th>Action</th>
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
                  <span className={`badge ${broker.state.status === "approved" ? "badge-ok" : "badge-warn"}`}>
                    {broker.state.status}
                  </span>
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
                  <span className="note">{broker.state.providerAccountId ?? "no connected account"}</span>
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
                      <button type="submit">Re-read from Stripe</button>
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

      <p className="note">
        A re-read appends a status row only when the status changed, and the row records which user asked for it.
        Stripe stops emitting <code>account.updated</code> once its identity check has landed, which happens inside the
        two-minute settling window, so this button is how a pending broker becomes approved.
      </p>
    </PortalShell>
  );
}
