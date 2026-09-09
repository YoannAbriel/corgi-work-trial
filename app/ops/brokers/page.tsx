import "@/app/styles/lists.css";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Chip } from "@/components/detail-layout";
import { PortalShell } from "@/components/portal-shell";
import { About } from "@/components/ui/about";
import { EmptyState } from "@/components/ui/empty";
import { Inspector } from "@/components/ui/inspector";
import { Legend } from "@/components/ui/legend";
import { RevealDone } from "@/components/ui/reveal-done";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable, Primary, Ref, Row } from "@/components/ui/table";
import { When } from "@/components/ui/time";
import { currentUser } from "@/lib/auth/current-user";
import { KYB_NOT_LIVE_LABEL } from "@/lib/broker/eligibility";
import { brokersWithKybState } from "@/lib/broker/kyb";
import { BROKER_PASSWORD_REVEAL_COOKIE, readRevealCookieValue } from "@/lib/broker/reveal-cookie";
import { closeInspectorHref, firstValue, inspectedReference, inspectHref, toastsFromQuery, withParams, type Query } from "@/lib/ui/views";

// /ops/brokers: where the operations team sees whether a broker may bind, and why.
//
// Staff only, read from the append-only broker_kyb_events table. The one action on the page
// re-reads the account at Stripe and appends a status row only if the answer changed, so
// pressing it twice does not add a second row (POST /api/brokers/{id}/kyb/recheck).

const PATH = "/ops/brokers";

// What each verification status means, one clause each. The legend under the table prints only
// the ones the rows actually show (round 1, MEDIUM).
const STATUS_MEANING: Record<string, string> = {
  approved: "Stripe verified the company; the server allows binding",
  pending: "Stripe is still checking, or the settling window has not passed",
  failed: "Stripe refused, with its own requirement codes on the row",
  unknown: "no status was ever recorded; binding is refused",
};

// The statuses on the screen, once each, in the order the rows use them.
function statusesOnScreen(rows: { state: { status: string } }[]): string[] {
  const seen: string[] = [];
  for (const row of rows) if (!seen.includes(row.state.status) && STATUS_MEANING[row.state.status]) seen.push(row.state.status);
  return seen;
}

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

  // The form for a new broker is a view of this screen (`?view=new`), so the list stays the
  // first thing a reader sees and the form can be linked to.
  const view = firstValue(query.view) === "new" ? "new" : "list";

  const toasts = toastsFromQuery(query, {
    error: { tone: "error", title: "Refused" },
    rechecked: { tone: "ok", title: "Read again at Stripe" },
    // The value of ?created= is the new broker's id; the toast says what happened rather than
    // reprinting it, and the sign-in details are shown in their own block below.
    created: { tone: "ok", title: "Broker created", text: "The broker and its sign-in account were created." },
  });

  // The sign-in details of the broker POST /api/brokers has just created, read from the cookie
  // that route set (lib/broker/reveal-cookie.ts). They exist for one page load and for at most
  // two minutes; nothing else in the application holds them.
  const justCreatedBrokerId = firstValue(query.created);
  const revealedSignIn = justCreatedBrokerId
    ? readRevealCookieValue((await cookies()).get(BROKER_PASSWORD_REVEAL_COOKIE)?.value)
    : null;

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
        // No chip on a list screen (Yoann, 2026-09-09): every broker's verification is a chip on
        // its own row, which is where a reader looks for it.
        actions: (
          <Link className="button-link orange" href={withParams(PATH, query, { view: "new" })} prefetch={false}>
            New broker
          </Link>
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

      {/* NO TILES (cycle 2, decision 2). Every figure they carried is on the screen already: the
          total is the band's suffix, approved and failed are its chips, held and never submitted
          are sub-labels on the row they belong to. A list of three rows does not need a
          dashboard above it. */}

      {/* Creating a broker: the form the coordinator's route will answer (cycle 2, decision 21).
          The button is disabled while POST /api/brokers does not exist on this branch, so the
          card can never post into nothing; the field names are the ones the route expects. */}
      {view === "new" ? (
        <section className="card lists-section lists-form-card">
          <h2>New broker</h2>
          <form method="post" action="/api/brokers" className="card lists-form">
            <label htmlFor="name">Broker name</label>
            <input id="name" name="name" type="text" required maxLength={120} placeholder="Redwood Commercial Brokers" />

            <label htmlFor="email">Contact email</label>
            <input id="email" name="email" type="email" required maxLength={200} spellCheck={false} autoComplete="email" />

            <label htmlFor="commissionRateBps">Commission rate (basis points)</label>
            <input id="commissionRateBps" name="commissionRateBps" type="number" required min={0} max={10000} step={1} placeholder="1500" />

            <SubmitButton className="orange">Create the broker</SubmitButton>
            <p className="note">
              The broker gets a sign-in account with a one-time password, shown to you once on this screen. They then submit
              their business verification from <code>/broker/kyb</code>; you check it here.
            </p>
          </form>

          {/* SHOWN ONCE. The password is not stored anywhere: the database holds only its scrypt
              hash (migration 0027), and the cookie that carried it here is removed as soon as
              this block appears. If it is lost, the only answer is to create the broker again,
              which is what the second version of this block says. */}
          {justCreatedBrokerId ? (
            <div className="card lists-form-card">
              <h3>Sign-in details, shown once</h3>
              {revealedSignIn ? (
                <>
                  <p className="note">Give these to the broker. They will not be shown again.</p>
                  <p className="lists-facts">Email</p>
                  <code className="lists-snippet">{revealedSignIn.email}</code>
                  <p className="lists-facts">One-time password</p>
                  <code className="lists-snippet">{revealedSignIn.password}</code>
                  <RevealDone />
                </>
              ) : (
                <p className="note">The password was shown once and is gone; create the broker again if it was lost.</p>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      <DataTable
        ariaLabel="Broker verification"
        // Only the statuses the rows below print (cycle 2): a legend defining "pending" on a
        // screen where no broker is pending explains something the reader cannot see.
        legend={
          <Legend
            items={statusesOnScreen(brokers).map((status) => ({ term: status, meaning: STATUS_MEANING[status] }))}
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
                {/* The row opens everything on this broker: their verification history, policies,
                    claims, commission and statements (cycle 2). The Stripe account and the
                    re-read button sit above that link and keep doing their own thing. */}
                <Primary
                  href={`/ops/console/broker/${broker.brokerId}`}
                  sub={broker.submission ? `${broker.submission.legalName}, EIN ending ${broker.submission.einLast4}` : "never submitted"}
                >
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
                    // Stripe's own codes, quoted rather than paraphrased, on one line with the
                    // whole list in `title`: a 31-character code took 200 px of a six-column
                    // table and pushed the Actions column off the screen at 1024 px.
                    <span className="dt-sub lists-one-line" title={broker.requirementErrorCodes.join(", ")}>
                      {broker.requirementErrorCodes.join(", ")}
                    </span>
                  ) : null}
                </td>
                <td className="nowrap">
                  <When instant={broker.state.recordedAt} now={now} />
                </td>
                {/* The account id is one line, cut, with its whole value in `title`: at 1024 px
                    with the drawer open this column is narrow and a Stripe id broken in three
                    read as three ids (cycle 2, decision 7). */}
                <td className="lists-ref-tight">
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
                {/* One visible button of two words, everything else in the row's menu, so the
                    column is the same narrow width at 1024 px with the drawer open (cycle 2). */}
                <td className="dt-actions lists-row-actions">
                  {broker.state.providerAccountId ? (
                    <form method="post" action={`/api/brokers/${broker.brokerId}/kyb/recheck`} className="inline-form">
                      <SubmitButton className="secondary small">Re-read</SubmitButton>
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
