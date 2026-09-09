import { redirect } from "next/navigation";
import { Chip } from "@/components/detail-layout";
import { PortalShell } from "@/components/portal-shell";
import { About } from "@/components/ui/about";
import { EmptyState } from "@/components/ui/empty";
import { Inspector } from "@/components/ui/inspector";
import { Legend } from "@/components/ui/legend";
import { Stat, Stats } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable, Primary, Ref, Row } from "@/components/ui/table";
import { When } from "@/components/ui/time";
import { currentUser } from "@/lib/auth/current-user";
import { KYB_NOT_LIVE_LABEL } from "@/lib/broker/eligibility";
import { brokersWithKybState } from "@/lib/broker/kyb";
import { closeInspectorHref, inspectedReference, inspectHref, toastsFromQuery, type Query } from "@/lib/ui/views";

// /ops/brokers: where the operations team sees whether a broker may bind, and why.
//
// Staff only, read from the append-only broker_kyb_events table. The one action on the page
// re-reads the account at Stripe and appends a status row only if the answer changed, so
// pressing it twice does not add a second row (POST /api/brokers/{id}/kyb/recheck).

const PATH = "/ops/brokers";

export default async function OpsBrokersPage({ searchParams }: { searchParams: Promise<Query> }) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "staff_ops" && user.role !== "staff_approver") {
    redirect("/broker");
  }

  const [brokers, query] = await Promise.all([brokersWithKybState(), searchParams]);
  const now = new Date();

  const countOf = (status: string) => brokers.filter((broker) => broker.state.status === status).length;
  const approved = countOf("approved");
  const failed = countOf("failed");
  const neverSubmitted = brokers.filter((broker) => broker.submission === null).length;
  const held = brokers.filter((broker) => broker.state.heldBySettlingWindow).length;

  const toasts = toastsFromQuery(query, {
    error: { tone: "error", title: "Refused" },
    rechecked: { tone: "ok", title: "Read again at Stripe" },
  });

  const inspected = inspectedReference(query.inspect);

  return (
    <PortalShell
      user={user}
      active="verification"
      toasts={toasts}
      inspector={
        inspected ? <Inspector reference={inspected} closeHref={closeInspectorHref(PATH, query)} user={user} now={now} /> : undefined
      }
      band={{
        title: "Brokers",
        suffix: `${brokers.length} ${brokers.length === 1 ? "broker" : "brokers"}`,
        meta: (
          <>
            <Chip tone={approved > 0 ? "ok" : "neutral"}>{approved} approved</Chip>
            <Chip tone={failed > 0 ? "warn" : "neutral"}>{failed} failed</Chip>
            <Chip tone="neutral">{neverSubmitted} never submitted</Chip>
            <Chip tone="ok">Stripe: LIVE SANDBOX</Chip>
          </>
        ),
      }}
    >
      {/* The inline sentences the review scripts read, beside the toasts. */}
      {query.error || query.rechecked ? (
        <div className="notices">
          {query.error ? (
            <p className="error" role="alert">
              {query.error}
            </p>
          ) : null}
          {query.rechecked ? (
            <p className="note" role="status">
              Read again at Stripe: {query.rechecked}
            </p>
          ) : null}
        </div>
      ) : null}

      <Stats>
        <Stat label="Brokers" value={brokers.length} note="every broker on file" />
        <Stat label="Approved" value={approved} tone={approved > 0 ? "ok" : "neutral"} note="allowed to bind today" />
        <Stat label="Failed" value={failed} tone={failed > 0 ? "warn" : "neutral"} note="Stripe refused the check" />
        <Stat label="Held" value={held} tone={held > 0 ? "warn" : "neutral"} note="approved, inside the settling window" />
      </Stats>

      <DataTable
        ariaLabel="Broker verification"
        legend={
          <Legend
            items={[
              { term: "approved", meaning: "Stripe verified the company; the server allows binding" },
              { term: "pending", meaning: "Stripe is still checking, or the settling window has not passed" },
              { term: "failed", meaning: "Stripe refused, with its own requirement codes on the row" },
              { term: "unknown", meaning: "no status was ever recorded; binding is refused" },
            ]}
          />
        }
      >
        <thead>
          <tr>
            <th>Broker</th>
            <th className="num">Commission</th>
            <th>Verification</th>
            <th className="nowrap">Since</th>
            <th>Stripe account</th>
            <th className="num">Actions</th>
          </tr>
        </thead>
        <tbody>
          {brokers.length === 0 ? (
            <tr>
              <td colSpan={6} className="dt-empty">
                <EmptyState illustration="broker-corgi">No broker exists yet.</EmptyState>
              </td>
            </tr>
          ) : (
            brokers.map((broker) => (
              <Row key={broker.brokerId}>
                {/* No row link: the two things a reader opens from here are the Stripe account,
                    which opens the inspector beside the table, and the re-read form. */}
                <Primary sub={broker.submission ? `${broker.submission.legalName}, EIN ending ${broker.submission.einLast4}` : "never submitted"}>
                  {broker.brokerName}
                </Primary>
                <td className="num">{(broker.commissionRateBps / 100).toFixed(2)}%</td>
                <td>
                  <Chip tone={broker.state.status === "approved" ? "ok" : broker.state.status === "failed" ? "warn" : "neutral"}>
                    {broker.state.status}
                  </Chip>
                  {/* The row on file says approved; the settling window is why it is not being
                      acted on yet. Staff see both, so the screen explains itself. */}
                  {broker.state.heldBySettlingWindow ? <span className="dt-sub">recorded {broker.state.recordedStatus}, held</span> : null}
                  {broker.requirementErrorCodes.length > 0 ? (
                    // Stripe's own codes, quoted rather than paraphrased.
                    <span className="dt-sub">{broker.requirementErrorCodes.join(", ")}</span>
                  ) : null}
                </td>
                <td className="nowrap">
                  <When instant={broker.state.recordedAt} now={now} />
                </td>
                <td>
                  {broker.state.providerAccountId ? (
                    <Ref
                      value={broker.state.providerAccountId}
                      inspectHref={inspectHref(PATH, query, broker.state.providerAccountId)}
                      open={inspected === broker.state.providerAccountId}
                    />
                  ) : (
                    <span className="dt-muted">no connected account</span>
                  )}
                  {broker.state.isProviderEvidence || !broker.state.providerAccountId ? null : (
                    <span className="dt-sub">{KYB_NOT_LIVE_LABEL}: seeded placeholder</span>
                  )}
                </td>
                <td className="dt-actions">
                  {broker.state.providerAccountId ? (
                    <form method="post" action={`/api/brokers/${broker.brokerId}/kyb/recheck`} className="inline-form">
                      <SubmitButton className="secondary small">Re-read from Stripe</SubmitButton>
                    </form>
                  ) : (
                    <span className="dt-muted">nothing to read</span>
                  )}
                </td>
              </Row>
            ))
          )}
        </tbody>
      </DataTable>

      <About>
        <h4>Where the status comes from</h4>
        <p>
          Stripe Connect business verification in test mode, which is not a dedicated KYB vendor. Every status is Stripe&apos;s own answer, appended when observed, never edited. A broker can bind a policy only while the status is approved.
        </p>
        <h4>The placeholder</h4>
        <p>
          A row written by the seed script is marked <strong>{KYB_NOT_LIVE_LABEL}</strong> on the broker it belongs to. It exists so the issuance flow could be shown before Stripe was connected; it is not provider evidence.
        </p>
        <h4>The settling window</h4>
        <p>
          An approval recorded less than two minutes ago is held: the screen shows the recorded status beside the acted-on one. Stripe stops emitting <code>account.updated</code> once its identity check lands, often inside that window, so &quot;Re-read from Stripe&quot; is how a pending broker becomes approved.
        </p>
        <h4>Re-reading</h4>
        <p>A re-read appends a status row only when the status changed, and the row records which user asked for it. Pressing it twice adds nothing.</p>
      </About>
    </PortalShell>
  );
}
