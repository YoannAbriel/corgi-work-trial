import "@/app/styles/lists.css";
import { redirect } from "next/navigation";
import { Chip } from "@/components/detail-layout";
import { SandboxReferences } from "@/components/disclosures";
import { KybEvidenceNote } from "@/components/kyb-evidence-note";
import { PortalShell } from "@/components/portal-shell";
import { About } from "@/components/ui/about";
import { EmptyState } from "@/components/ui/empty";
import { Stat, Stats } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable, ExpandHead, ExpandRow, FactGrid } from "@/components/ui/table";
import { When } from "@/components/ui/time";
import { currentUser } from "@/lib/auth/current-user";
import { bindingIsAllowed } from "@/lib/broker/eligibility";
import { brokerKybEventHistory, brokerKybState, latestBrokerKybSubmission } from "@/lib/broker/kyb";
import { pickView, toastsFromQuery, withParams, type Query } from "@/lib/ui/views";

// /broker/kyb: the broker sends their company to Stripe for business verification.
//
// Nothing on this page decides anything. The form posts to /api/brokers/kyb, which records
// what was declared, calls Stripe and appends the status Stripe answers with. The status shown
// here is read from the append-only broker_kyb_events table, so it is the same status the
// server uses to allow or refuse binding.

const PATH = "/broker/kyb";
const VIEWS = ["status", "submit", "history"] as const;
const VIEW_LABEL: Record<(typeof VIEWS)[number], string> = { status: "Status", submit: "Submit", history: "History" };

// The provider, as a person would name it. The column of the table stores a machine value,
// which is what an operator saw on the screen (round 1, MEDIUM).
function providerInWords(provider: string): string {
  if (provider === "stripe_connect") return "Stripe Connect";
  if (provider === "seed") return "seed script";
  return provider;
}

// The two or three words of a reason that fit in a cell. Stripe's whole sentence is in the row's
// expansion, never cut: this is a glance, not the record.
function shortReason(reason: string): string {
  const words = reason.replace(/\.$/, "").split(" ");
  return words.length <= 3 ? words.join(" ") : `${words.slice(0, 3).join(" ")}...`;
}

export default async function BrokerKybPage({ searchParams }: { searchParams: Promise<Query> }) {
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

  const now = new Date();
  const view = pickView(query.view, VIEWS);
  const views = VIEWS.map((one) => ({
    key: one,
    label: VIEW_LABEL[one],
    href: withParams(PATH, query, { view: one }),
    current: one === view,
    // No count on a view: a number in the navigation is for something a person must act on, and
    // the number of statuses ever recorded is not that (cycle 2, decision 3). The history says
    // how many rows it holds in its own heading.
  }));

  const verificationIsRunning = kyb.provider === "stripe_connect" && kyb.status === "pending";
  const verified = kyb.status === "approved" && kyb.provider === "stripe_connect";
  const statusWord = kyb.status === "unknown" && !kyb.providerAccountId ? "not submitted" : kyb.status;

  const toasts = toastsFromQuery(query, {
    error: { tone: "error", title: "Refused" },
    submitted: { tone: "ok", title: "Sent to Stripe" },
    rechecked: { tone: "ok", title: "Read again at Stripe" },
  });

  return (
    <PortalShell
      active="verification"
      user={user}
      views={views}
      toasts={toasts}
      band={{
        title: "Business verification",
        // No name in the band or under the views: the sidebar already says who is signed in
        // (Yoann, 2026-09-09). ONE chip, the verification's own state, and one action of three
        // words. The AF-02 words are on the top bar; whether a connected account exists is
        // spelled out in "Where it stands" below.
        status: <Chip tone={kyb.status === "approved" ? "ok" : kyb.status === "failed" ? "warn" : "neutral"}>{statusWord}</Chip>,
        actions: kyb.providerAccountId ? (
          <form method="post" action={`/api/brokers/${user.brokerId}/kyb/recheck`} className="inline-form">
            <SubmitButton className="secondary">Check at Stripe</SubmitButton>
          </form>
        ) : undefined,
      }}
    >
      {/* The inline sentences the review scripts read, beside the toasts. */}
      {query.error || query.submitted || query.rechecked ? (
        <div className="notices">
          {query.error ? (
            <p className="error" role="alert">
              {query.error}
            </p>
          ) : null}
          {query.submitted ? (
            <p className="note" role="status">
              Sent to Stripe. Connected account {query.submitted}. Stripe answers in about a minute; the status stays pending
              for at least two minutes, then use &quot;Check at Stripe&quot;.
            </p>
          ) : null}
          {query.rechecked ? (
            <p className="note" role="status">
              Read again at Stripe: {query.rechecked}
            </p>
          ) : null}
        </div>
      ) : null}

      {view === "status" ? (
        <>
          {/* Two tiles (cycle 2, decision 2): what the server will do, and whether the settling
              window is holding it. The status itself is the band's chip. */}
          <Stats>
            <Stat
              label="Binding"
              value={bindingIsAllowed(kyb.status) ? "allowed" : "refused"}
              tone={bindingIsAllowed(kyb.status) ? "ok" : "warn"}
              note="the rule the server applies before binding"
            />
            <Stat
              label="Settling window"
              value={kyb.heldBySettlingWindow ? "held" : "clear"}
              tone={kyb.heldBySettlingWindow ? "warn" : "neutral"}
              note={kyb.heldBySettlingWindow ? `recorded ${kyb.recordedStatus}, not acted on yet` : "two minutes after a status is recorded"}
            />
          </Stats>

          <section className="card lists-section">
            <h2>Where it stands</h2>
            <p className="note">{kyb.explanation}</p>
            <KybEvidenceNote kyb={kyb} className="note" />
            {/* The provider in words, and every instant through `When`: an age at a glance, the
                full UTC instant on hover and in the markup. These four facts were raw machine
                values, "stripe_connect" and "2026-09-08 12:10:34" (round 1, MEDIUM). */}
            <FactGrid
              items={[
                { label: "Provider", value: providerInWords(kyb.provider) },
                {
                  label: "Connected account",
                  value: (
                    <>
                      {kyb.providerAccountId ? "created at Stripe" : "not created yet"}
                      <SandboxReferences references={[{ label: "Stripe connected account", value: kyb.providerAccountId }]} />
                    </>
                  ),
                },
                { label: "Recorded", value: <When instant={kyb.recordedAt} now={now} /> },
                { label: "Submitted", value: <When instant={kyb.submittedAt} now={now} /> },
              ]}
            />
          </section>

          {submission ? (
            <section className="card lists-section">
              <h2>What was submitted</h2>
              <FactGrid
                items={[
                  { label: "Registered name", value: submission.legalName },
                  { label: "EIN", value: `ending ${submission.einLast4}` },
                  {
                    label: "Registered address",
                    value: `${submission.addressLine1}, ${submission.addressCity} ${submission.addressState} ${submission.addressPostalCode}`,
                  },
                  { label: "Business website", value: submission.businessUrl },
                  { label: "Submitted", value: <When instant={submission.recordedAt} now={now} /> },
                  // The instant and the address of the acceptance are two facts, so they are two
                  // rows: run together they read as one sentence ending in "from ::1" (round 1).
                  { label: "Agreement accepted", value: <When instant={submission.termsAcceptedAt} now={now} /> },
                  { label: "Accepted from", value: submission.termsAcceptedIp },
                ]}
              />
            </section>
          ) : null}
        </>
      ) : null}

      {view === "submit" ? (
        verificationIsRunning ? (
          <section className="card lists-section">
            <h2>Verification running</h2>
            <EmptyState illustration="shield-leaf">
              Stripe is checking the company. The status stays pending for at least two minutes; then check it with the button above.
            </EmptyState>
          </section>
        ) : verified ? (
          <section className="card lists-section">
            <h2>Company verified</h2>
            <EmptyState illustration="shield-leaf">This company is already verified. There is nothing to submit again.</EmptyState>
          </section>
        ) : (
          <div className="layout-2">
            <section className="card">
              <h2>{submission ? "Submit again" : "Submit the company"}</h2>
              <p className="note">
                The details are sent to Stripe Connect in test mode; the EIN itself is never stored here, only its last four digits.
              </p>
              <form method="post" action="/api/brokers/kyb" className="card lists-form">
                <label htmlFor="legalName">Registered legal name</label>
                <input id="legalName" name="legalName" autoComplete="organization" required maxLength={120} defaultValue={submission?.legalName} />

                <label htmlFor="employerIdentificationNumber">EIN (nine digits, no dash)</label>
                <input
                  id="employerIdentificationNumber"
                  name="employerIdentificationNumber"
                  aria-describedby="ein-help"
                  autoComplete="off"
                  spellCheck={false}
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
                  name="addressLine1"
                  aria-describedby="address-help"
                  autoComplete="address-line1"
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
                  name="addressPostalCode"
                  autoComplete="postal-code"
                  required
                  maxLength={10}
                  defaultValue={submission?.addressPostalCode ?? "94105"}
                />

                <label htmlFor="businessUrl">Business website</label>
                <input
                  id="businessUrl"
                  name="businessUrl"
                  aria-describedby="website-help"
                  type="url"
                  autoComplete="url"
                  required
                  maxLength={200}
                  defaultValue={submission?.businessUrl}
                  placeholder="https://"
                />
                <span id="website-help" className="note">
                  Stripe validates it and refuses <code>https://example.com</code> with <code>url_invalid</code>, so use
                  a real address.
                </span>

                <label htmlFor="contactEmail">Contact email</label>
                <input
                  id="contactEmail"
                  name="contactEmail"
                  autoComplete="email"
                  spellCheck={false}
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
                  <span>
                    By submitting, you accept the{" "}
                    <a href="https://stripe.com/connect-account/legal" target="_blank" rel="noreferrer">
                      Stripe Connected Account Agreement
                    </a>{" "}
                    on behalf of your business
                  </span>
                </label>

                <SubmitButton className="orange">Submit for verification</SubmitButton>
              </form>
            </section>

            <section className="card">
              <h2>What is stored</h2>
              <p className="note">
                The registered name, the address, the website, the last four digits of the EIN, the connected account id, and the instant and IP address of the agreement acceptance. The EIN itself is never stored.
              </p>
            </section>
          </div>
        )
      ) : null}

      {view === "history" ? (
        <section className="card lists-section">
          <h2>
            Every status recorded <span className="count-chip">{history.length}</span>
          </h2>
          {/* The Reason cell holds two or three words; Stripe's own sentence and its requirement
              codes are in the row's expansion (round 1, MEDIUM: three sentences in a column, and
              the provider printed as "stripe_connect"). */}
          <DataTable ariaLabel="Verification history">
            <thead>
              <tr>
                <ExpandHead />
                <th>Status</th>
                <th>Provider</th>
                <th>Reason</th>
                <th className="nowrap">Recorded</th>
              </tr>
            </thead>
            {history.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={5} className="dt-empty">
                    <EmptyState illustration="shield-leaf">No status recorded yet.</EmptyState>
                  </td>
                </tr>
              </tbody>
            ) : (
              history.map((event) => (
                <ExpandRow
                  key={event.id}
                  columns={4}
                  cells={
                    <>
                      <td>
                        <Chip tone={event.status === "approved" ? "ok" : event.status === "failed" ? "warn" : "neutral"}>{event.status}</Chip>
                      </td>
                      <td>{providerInWords(event.provider)}</td>
                      <td>{event.reason ? shortReason(event.reason) : <span className="dt-muted">none</span>}</td>
                      <td className="nowrap">
                        <When instant={event.recordedAt} now={now} />
                      </td>
                    </>
                  }
                >
                  <FactGrid
                    items={[
                      { label: "What the provider said", value: event.reason ?? "nothing", wide: true },
                      {
                        label: "Requirement codes",
                        value: event.requirementErrorCodes.length > 0 ? event.requirementErrorCodes.join(", ") : "none",
                        wide: true,
                      },
                      { label: "Recorded", value: <When instant={event.recordedAt} now={now} mode="both" /> },
                    ]}
                  />
                </ExpandRow>
              ))
            )}
          </DataTable>
        </section>
      ) : null}

      <About>
        <h4>What Stripe checks</h4>
        <p>
          Stripe Connect business verification (test mode) is not a dedicated KYB vendor; it is the live check this build runs, and the status shown is Stripe&apos;s answer. The server reads that same status before allowing a policy to be bound.
        </p>
        <h4>Pending, approved, failed</h4>
        <p>
          The status stays pending for at least two minutes after a submission (a settling window), then &quot;Check at Stripe&quot; reads it again. A failed check names Stripe&apos;s own requirement codes.
        </p>
        <h4>Every status is a row</h4>
        <p>A status is appended when observed, never edited. The history view is that table, newest first; each row unfolds on Stripe&apos;s own sentence and its requirement codes.</p>
        <h4>address_full_match</h4>
        <p>
          A registered address reading <code>address_full_match</code> is Stripe&apos;s published test token, not a street: it tells the sandbox to answer as though the address matched the business records exactly. It is what was submitted, so it is what this screen shows.
        </p>
        <h4>What is stored</h4>
        <p>
          The registered name, the address, the website, the last four digits of the EIN, the connected account id, and the instant and IP address of the agreement acceptance. The EIN itself is never stored.
        </p>
      </About>
    </PortalShell>
  );
}
