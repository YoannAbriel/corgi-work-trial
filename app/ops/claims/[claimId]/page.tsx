import "@/app/styles/policy-detail.css";
import { PortalShell } from "@/components/portal-shell";
import { AmountExplained } from "@/components/amount-explained";
import { Disclosure, SandboxReferences } from "@/components/disclosures";
import { Chip } from "@/components/detail-layout";
import { JournalTable } from "@/components/journal-table";
import { MoneyAmountInput } from "@/components/money-amount-input";
import { About } from "@/components/ui/about";
import { Chart, ChartRow, HBars } from "@/components/ui/charts";
import { EmptyState } from "@/components/ui/empty";
import { Legend } from "@/components/ui/legend";
import { Stat, Stats } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
import { Inspector } from "@/components/ui/inspector";
import { DataTable, ExpandHead, ExpandRow, FactGrid, Num, Ref, RowMenu } from "@/components/ui/table";
import { When } from "@/components/ui/time";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sql } from "@/db/client";
import { approvalRequest } from "@/lib/approvals/approvals";
import { MONEY_OUT_APPROVAL_THRESHOLD_CENTS } from "@/lib/approvals/threshold";
import { currentUser } from "@/lib/auth/current-user";
import { claimSnapshot } from "@/lib/claims/claims";
import { claimPayments, latestClaimantBankAccount } from "@/lib/claims/payments";
import { journalEntriesOfClaim, reserveHistory } from "@/lib/claims/read";
import { isUuid } from "@/lib/http/path-ids";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { evidenceFromJournal, explainClaimIncurred } from "@/lib/money/explain";
import { SIMULATED_REACHABLE_ROUTING_NUMBERS } from "@/lib/rails/bank-verification-simulator";
import { SIMULATED_SETTLEMENT_DELAY_DAYS } from "@/lib/rails/simulator";
import {
  closeInspectorHref,
  firstValue,
  inspectHref,
  inspectedReference,
  pickView,
  toastsFromQuery,
  withParams,
  type Query,
  type ToastNotice,
} from "@/lib/ui/views";

// One claim: what it has cost, what it still expects to cost, where its payments are on the
// simulated rail, and every journal entry it produced.
//
// The three numbers at the top are the ones Track 1 asks for, and they are derived from the
// claim's events every time this page is rendered, never stored:
//
//     incurred = paid + reserve
//
// The journal is the same story in double entry. If the two ever disagree, one of them is wrong
// and the page shows both rather than reconciling them for the reader.
//
// Layout, cycle 2 (Yoann, decision 16): TWO views instead of four. The overview is the position,
// the room left before each limit, the loss, the bank account and, at the bottom, the three
// decisions as one compact panel; the payments view is the payments with the rail in the
// expansion and the journal under them. F-YA-05 still holds: the three decisions are open on the
// page, and the one fold left, "Record a bank account", is open whenever no account exists, which
// is exactly when recording one is the thing to do. Every form keeps its endpoint and its fields;
// the server checks the role, the ceilings and the approval again whatever this page displayed.
const VIEWS = ["overview", "payments"] as const;
const VIEW_LABEL: Record<(typeof VIEWS)[number], string> = {
  overview: "Overview",
  payments: "Payments",
};

export default async function ClaimPage({
  params,
  searchParams,
}: {
  params: Promise<{ claimId: string }>;
  // Read through `firstValue`: a repeated parameter arrives as an array (F-B13-32).
  searchParams: Promise<Query>;
}) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  // Claims are staff work. A broker sees their policies' claims on the policy page, read-only.
  if (user.role !== "staff_ops" && user.role !== "staff_approver") {
    redirect("/broker");
  }

  const { claimId } = await params;
  // A path that is not a uuid is answered like an unknown claim, not with a 500 from the query
  // that would cast it (review finding F-B7-07).
  if (!isUuid(claimId)) {
    notFound();
  }
  const claim = await claimSnapshot(sql, claimId);
  if (!claim) {
    notFound();
  }

  const [query, bankAccount, payments, reserves, entries] = await Promise.all([
    searchParams,
    latestClaimantBankAccount(sql, claimId),
    claimPayments(sql, claimId),
    reserveHistory(sql, claimId),
    journalEntriesOfClaim(sql, claimId),
  ]);

  // Every payment that is waiting for a decision, so the page can say who has to act and link
  // to the approvals screen.
  const approvals = await Promise.all(
    payments.map((payment) =>
      payment.approvalRequestId ? approvalRequest(sql, payment.approvalRequestId) : Promise.resolve(null),
    ),
  );

  const path = `/ops/claims/${claim.claimId}`;
  const view = pickView(query.view, VIEWS);
  const now = new Date();

  const canAct = user.role === "staff_ops" && !claim.position.isClosed;
  // The inspector, as a drawer over the content: a rail reference or an operation id opens its
  // whole trail instead of being a code token nobody can follow (cycle 2, decision 5). This whole
  // screen is staff only, checked above, so there is no role test left to do here.
  const inspected = inspectedReference(query.inspect);
  const perOccurrenceLeftCents = claim.perOccurrenceLimitCents - claim.position.paidCents - claim.pendingCents;
  const aggregateLeftCents = claim.aggregateLimitCents - claim.policyCommittedCents;
  const reserveLeftCents = claim.position.reserveCents - claim.pendingCents;
  // The prerequisite the payment form names. It is read here for the wording only: the rule that
  // actually stops a payment is the server's, in the route this form posts to.
  const hasVerifiedBankAccount = bankAccount?.verificationStatus === "verified";
  const waitingForApproval = payments.filter((payment) => payment.railStatus === "waiting for approval").length;
  const readyToSend = payments.filter((payment) => payment.railStatus === "ready to send").length;

  const refusal = firstValue(query.error);
  const openedOutcome = firstValue(query.opened);
  const bankOutcome = firstValue(query.bank);
  const paymentOutcome = firstValue(query.payment);
  const closedOutcome = firstValue(query.closed);
  // POST /api/claims/[claimId] redirects here with ?reserved=<cents> after a reserve is set or
  // adjusted, and the screen said nothing (feedback audit of 2026-09-09 19:10). The parameter is
  // the delta the reserve moved by, in integer cents, formatted here like every other figure.
  const reservedOutcome = firstValue(query.reserved);
  const reservedDeltaCents = reservedOutcome !== undefined && /^-?\d+$/.test(reservedOutcome) ? Number(reservedOutcome) : null;

  const toasts: ToastNotice[] = [
    ...toastsFromQuery(query, { error: { tone: "error", title: "Refused" } }),
    ...(openedOutcome ? [{ tone: "ok" as const, title: "Claim open", text: "Set a reserve before paying anything.", param: "opened" }] : []),
    ...(bankOutcome ? [{ tone: "info" as const, title: "Bank check (LOCAL SIMULATOR)", text: bankOutcome, param: "bank" }] : []),
    ...(paymentOutcome ? [{ tone: "info" as const, title: "Payment", text: paymentOutcome.replace(/[-_]/g, " "), param: "payment" }] : []),
    ...(closedOutcome ? [{ tone: "ok" as const, title: "Claim closed", text: "Nothing more can be paid on it.", param: "closed" }] : []),
    ...(reservedOutcome !== undefined
      ? [
          {
            tone: "ok" as const,
            title: "Reserve set",
            text:
              reservedDeltaCents === null
                ? "The reserve was set on this claim."
                : reservedDeltaCents === 0
                  ? "The reserve did not move, so no entry was posted."
                  : `${formatCentsAsUsd(reservedDeltaCents)} was posted to the ledger.`,
            param: "reserved",
          },
        ]
      : []),
  ];

  const notices = [
    refusal ? <p key="error" className="error" role="alert">{refusal}</p> : null,
    openedOutcome ? <p key="opened" className="note" role="status">The claim is open. Set a reserve before paying anything.</p> : null,
    bankOutcome ? <p key="bank" className="note" role="status">Bank ownership check (LOCAL SIMULATOR): {bankOutcome}.</p> : null,
    paymentOutcome ? <p key="payment" className="note" role="status">Payment: {paymentOutcome.replace(/[-_]/g, " ")}.</p> : null,
    closedOutcome ? <p key="closed" className="note" role="status">The claim is closed.</p> : null,
  ].filter(Boolean);

  return (
    <PortalShell
      active="claims"
      user={user}
      toasts={toasts}
      viewsSubtitle={claim.claimNumber}
      inspector={
        inspected ? (
          <Inspector reference={inspected} closeHref={closeInspectorHref(path, query)} user={user} now={now} />
        ) : undefined
      }
      views={VIEWS.map((one) => ({
        key: one,
        label: VIEW_LABEL[one],
        href: withParams(path, query, { view: one, inspect: null }),
        current: one === view,
        // A count only where a person must act (cycle 2, decision 3): payments waiting for a
        // second person or ready to be sent, never the number of rows a view holds.
        count: one === "payments" && waitingForApproval + readyToSend > 0 ? waitingForApproval + readyToSend : undefined,
      }))}
      trail={[{ label: "Claims", href: "/ops/claims" }, { label: `Claim ${claim.claimNumber}` }]}
      band={{
        title: `Claim ${claim.claimNumber}`,
        suffix: claim.policyNumber,
        // ONE chip, the claim's own state (Yoann, 2026-09-09). What waits for an approver and
        // what is ready to send are rows of the payments panel, each with its own state; the
        // reserve and the bank account are facts of the cards below. The AF-02 words are the grey
        // line in the top bar, and every payment row still says LOCAL SIMULATOR itself.
        status: <Chip tone={claim.position.isClosed ? "neutral" : "ok"}>{claim.position.isClosed ? "closed" : "open"}</Chip>,
        // Two actions, three words each (cycle 2, decision 8). F-YA-05: the decisions are forms,
        // and a form is not a band button, so the band points at the panel that holds them, open,
        // at the bottom of the overview.
        actions: (
          <>
            <Link href={`/policies/${claim.policyId}`} prefetch={false} className="button-link secondary">
              The policy
            </Link>
            {canAct ? (
              <Link href={`${withParams(path, query, { view: "overview" })}#claim-actions`} prefetch={false} className="button-link">
                Reserve or pay
              </Link>
            ) : null}
          </>
        ),
      }}
    >
      {notices.length > 0 ? <div className="notices">{notices}</div> : null}

      {view === "overview" ? (
        <>
          <Stats>
            {/* Slice B12-2: the three figures that make up the position carry a fold. All three
                show the same arithmetic (lib/money/explain.ts, explainClaimIncurred) built from
                the position this page already folded from the claim's events, and each names the
                journal entries that prove it. */}
            <Stat
              label="Paid"
              value={
                <AmountExplained
                  tracePanelKey="claim"
                  amountCents={claim.position.paidCents}
                  label="Paid on this claim"
                  explanation={{
                    ...explainClaimIncurred({
                      ...claim.position,
                      // The entries that MOVE the paid figure, not every entry on the account
                      // (review finding F-B12-07): once a payment has settled, the claims payable
                      // lines net to zero, which read as a contradiction under a paid figure that
                      // stands.
                      evidence: evidenceFromJournal(entries, "claims_payable", ["claim_payment_sent", "claim_reserve_restored"]),
                    }),
                    resultKey: "paid",
                    evidenceLabel:
                      "The entries that move this figure, and they add up to it: a payment sent credits claims payable and adds to paid, and the reserve restored after a bank return debits it and takes the money back. A settlement is the rail confirming a payment already counted as paid, so it moves nothing here.",
                  }}
                />
              }
              note={`${formatCentsAsUsd(claim.position.settledCents)} settled by the rail`}
            />
            <Stat
              label="Reserve"
              value={
                <AmountExplained
                  tracePanelKey="claim"
                  amountCents={claim.position.reserveCents}
                  label="Reserve still outstanding on this claim"
                  explanation={{
                    ...explainClaimIncurred({ ...claim.position, evidence: evidenceFromJournal(entries, "claim_reserve") }),
                    resultKey: "reserve",
                    evidenceLabel:
                      "Every entry that moved the reserve: the reserve set, each adjustment, and each payment taken out of it.",
                  }}
                />
              }
              note={`${formatCentsAsUsd(reserveLeftCents)} left after what is asked for`}
            />
            <Stat
              label="Incurred"
              tone="accent"
              value={
                <AmountExplained
                  tracePanelKey="claim"
                  amountCents={claim.position.incurredCents}
                  label="Incurred: what this claim has cost so far"
                  explanation={{
                    ...explainClaimIncurred({ ...claim.position, evidence: evidenceFromJournal(entries, "incurred_loss_expense") }),
                    evidenceLabel:
                      "The incurred loss expense entries. Their balance is the same figure: the ledger tells the same story in double entry.",
                  }}
                />
              }
              note="paid plus reserve"
            />
            {/* Four tiles, not five (cycle 2, decision 2): what is left on THIS claim is the
                figure a person acts on before paying. What is left across the policy is a row of
                the second chart with its own figure, so it is read there and not twice. */}
            <Stat
              label="Per-occurrence left"
              value={formatCentsAsUsd(perOccurrenceLeftCents)}
              tone={perOccurrenceLeftCents <= 0 ? "danger" : "neutral"}
              note={`of ${formatCentsAsUsd(claim.perOccurrenceLimitCents)}, on this claim`}
            />
          </Stats>

          <ChartRow>
            <Chart title="Against the per-occurrence limit" figure={formatCentsAsUsd(claim.perOccurrenceLimitCents)}>
              <HBars
                caption="Incurred and paid on this claim against the per-occurrence limit"
                max={claim.perOccurrenceLimitCents}
                rows={[
                  { label: "Incurred", value: claim.position.incurredCents, display: formatCentsAsUsd(claim.position.incurredCents) },
                  { label: "Paid", value: claim.position.paidCents, display: formatCentsAsUsd(claim.position.paidCents), color: "var(--chart-2)" },
                  {
                    label: "Asked for",
                    value: claim.pendingCents,
                    // Nothing has been asked for, said in words: "$0.00" beside two real amounts
                    // reads as a figure that was computed rather than as an empty queue.
                    display: claim.pendingCents === 0 ? "nothing asked" : formatCentsAsUsd(claim.pendingCents),
                    color: "var(--chart-3)",
                  },
                ]}
              />
            </Chart>
            <Chart title="Against the aggregate limit" figure={formatCentsAsUsd(claim.aggregateLimitCents)}>
              <HBars
                caption="Paid and asked for across every claim of this policy against the aggregate limit"
                max={claim.aggregateLimitCents}
                rows={[
                  {
                    label: "Committed",
                    value: claim.policyCommittedCents,
                    display: formatCentsAsUsd(claim.policyCommittedCents),
                  },
                  { label: "Left", value: aggregateLeftCents, display: formatCentsAsUsd(aggregateLeftCents), color: "var(--chart-3)" },
                ]}
              />
            </Chart>
          </ChartRow>

          <div className="cards">
            <section className="card">
              <h2>The loss</h2>
              <FactGrid
                items={[
                  { label: "Claimant", value: claim.claimantName },
                  { label: "Loss on", value: claim.occurredAt },
                  { label: "Reported", value: claim.reportedAt },
                  {
                    label: "Policy",
                    value: <Link href={`/policies/${claim.policyId}`}>{claim.policyNumber}</Link>,
                  },
                ]}
              />
            </section>

            {/* `bank-account` is the anchor the payment form points at when there is no verified
                account to pay into: the sentence that names the prerequisite and the form that
                satisfies it are now the same card. */}
            <section className="card" id="bank-account">
              <h2>Claimant bank account</h2>
              {bankAccount ? (
                <dl className="pd-facts">
                  <div>
                    <dt>Check</dt>
                    <dd>
                      <Chip tone={bankAccount.verificationStatus === "verified" ? "ok" : "warn"}>
                        {bankAccount.verificationStatus}
                      </Chip>
                    </dd>
                  </div>
                  <div>
                    <dt>Account holder</dt>
                    <dd>{bankAccount.accountHolderName}</dd>
                  </div>
                  <div>
                    <dt>Routing / account</dt>
                    <dd>
                      ...{bankAccount.routingNumberLast4} / ...{bankAccount.accountNumberLast4}
                    </dd>
                  </div>
                  <div>
                    <dt>Result</dt>
                    <dd>{bankAccount.reason}</dd>
                    {/* The disclosure is a row of its own under the pair, never inside the value
                        column, where it broke the fact row apart (round 1, MEDIUM). */}
                    <SandboxReferences
                      references={[{ label: "Simulated account token (payment destination)", value: bankAccount.accountToken }]}
                    />
                  </div>
                </dl>
              ) : (
                <EmptyState illustration="broken-link">
                  No bank account recorded yet. A payment cannot be requested without a verified one.
                </EmptyState>
              )}
              {/* AF-02 on the record itself, in one line. What the simulator does and does not do
                  is under its own heading in About (round 1, MEDIUM: four lines of explanation in
                  the reading flow of a card). */}
              <p className="pd-note">LOCAL SIMULATOR: a simulated ownership check, not a live bank integration.</p>
              {/* The form that records the account, in the card that states the account is missing.
                  It used to be the only thing behind the three-dot menu beside "Reserve, pay, close",
                  where Yoann could not find it while this card told him a payment needed one
                  (LIVE-10, 2026-09-09). Same POST, same fields; only its place on the screen moved.

                  Open on arrival while there is no account, because then recording one is the
                  blocking prerequisite rather than secondary reading matter (Yoann's rule F-YA-05,
                  components/disclosures.tsx). Once an account exists, recording another is a rare
                  act and starts closed. */}
              {canAct ? (
                <div className="pd-record-account">
                  <Disclosure title="Record a bank account" open={!bankAccount}>
                    <form method="post" action={`/api/claims/${claim.claimId}`} className="card pd-menu-form">
                      <input type="hidden" name="action" value="add-bank-account" />
                      <label htmlFor="accountHolderName">Claimant&apos;s account holder name</label>
                      <input id="accountHolderName" name="accountHolderName" defaultValue={claim.claimantName} required />
                      <label htmlFor="routingNumber">Routing number (nine digits)</label>
                      <input
                        id="routingNumber"
                        name="routingNumber"
                        autoComplete="off"
                        spellCheck={false}
                        inputMode="numeric"
                        placeholder="110000000"
                        required
                      />
                      <label htmlFor="accountNumber">Account number</label>
                      <input
                        id="accountNumber"
                        name="accountNumber"
                        autoComplete="off"
                        spellCheck={false}
                        inputMode="numeric"
                        placeholder="000123456789"
                        required
                      />
                      <SubmitButton className="secondary">Check and record</SubmitButton>
                    </form>
                  </Disclosure>
                </div>
              ) : null}
            </section>
          </div>

          <DataTable
            ariaLabel="Reserve history"
            legend={
              <Legend
                items={[
                  { term: "Booked", meaning: "what the change posted to the ledger, or nothing when it posts no entry" },
                  { term: "Reserve", meaning: "what the claim is still expected to cost, set by a person" },
                ]}
              />
            }
          >
            <thead>
              <tr>
                <th>Decision</th>
                <th className="num">From</th>
                <th className="num">To</th>
                <th className="num">Booked</th>
                <th className="nowrap">Recorded</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {reserves.length === 0 ? (
                <tr>
                  <td colSpan={6} className="dt-empty">
                    <EmptyState illustration="safety-net">No reserve has been set yet. Nothing can be paid until one is.</EmptyState>
                  </td>
                </tr>
              ) : (
                reserves.map((reserve) => (
                  <tr key={reserve.claimEventId} className="dt-row">
                    <td>
                      <Chip tone="neutral">{reserve.eventType.replace(/_/g, " ")}</Chip>
                    </td>
                    <td className="num">{formatCentsAsUsd(reserve.previousReserveCents)}</td>
                    <td className="num">{formatCentsAsUsd(reserve.newReserveCents)}</td>
                    <td className="num">{reserve.deltaCents === 0 ? "no entry" : formatCentsAsUsd(reserve.deltaCents)}</td>
                    <td className="nowrap">
                      <When instant={reserve.recordedAt} now={now} />
                    </td>
                    <td>
                      {reserve.recordedByName ?? "unknown"}
                      {reserve.note ? <span className="dt-sub">{reserve.note}</span> : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>

          {/* The three decisions, one compact panel at the bottom of the overview (cycle 2,
              decision 16): they were a view of their own holding three tall cards. Every form
              keeps its endpoint, its method and its field names; the server checks the role, the
              reserve available, both limits and the approval again whatever this panel showed.
              The bank account is not a decision about this claim's money, so it is not here at
              all: it is recorded in the "Claimant bank account" card above, which is the card
              that says whether one exists (LIVE-10). */}
          <section className="card" id="claim-actions">
            <div className="pd-panel-head">
              <h2>{canAct ? "Reserve, pay, close" : "Decisions"}</h2>
            </div>
            {canAct ? (
              <>
                <div className="pd-actions">
                  <form method="post" action={`/api/claims/${claim.claimId}`} className="card">
                    <input type="hidden" name="action" value="set-reserve" />
                    <label htmlFor="reserveAmount">
                      {claim.position.hasReserve ? "Adjust the reserve to (USD)" : "Set the reserve to (USD)"}
                    </label>
                    <MoneyAmountInput id="reserveAmount" name="reserveAmount" placeholder="5,000.00" required />
                    <label htmlFor="reserveNote">Why (optional)</label>
                    <input id="reserveNote" name="note" placeholder="engineer's estimate revised" />
                    <SubmitButton className="secondary">Set reserve</SubmitButton>
                  </form>

                  <form method="post" action={`/api/claims/${claim.claimId}`} className="card">
                    <input type="hidden" name="action" value="request-payment" />
                    <label htmlFor="paymentAmount">Pay the claimant (USD)</label>
                    <MoneyAmountInput id="paymentAmount" name="paymentAmount" placeholder="1,200.00" required />
                    {/* The server refuses a payment with no verified account to send it to, so the
                        form says so before the button rather than after the refusal, and the link
                        goes to the card that records one. The button is left enabled: the rule is
                        the server's, and a disabled button is not a control (AGENTS.md). */}
                    {hasVerifiedBankAccount ? null : (
                      <p className="pd-note">
                        No verified bank account yet: <a href="#bank-account">record one first</a>.
                      </p>
                    )}
                    <SubmitButton className="orange">Request payment</SubmitButton>
                  </form>

                  {/* Closing is offered only when there is nothing left to pay or to reserve; the
                      server refuses it in every other case, so the form appears when it would be
                      accepted rather than as a button that always fails. */}
                  {claim.position.reserveCents === 0 && claim.pendingCents === 0 ? (
                    <form method="post" action={`/api/claims/${claim.claimId}`} className="card">
                      <input type="hidden" name="action" value="close" />
                      <label htmlFor="closeNote">Closing note (optional)</label>
                      <input id="closeNote" name="note" placeholder="settled in full" />
                      <SubmitButton className="danger">Close claim</SubmitButton>
                    </form>
                  ) : null}
                </div>
                <p className="pd-note">
                  {formatCentsAsUsd(reserveLeftCents)} of reserve is available, and anything above{" "}
                  {formatCentsAsUsd(MONEY_OUT_APPROVAL_THRESHOLD_CENTS)} on this claim waits for a second person.
                </p>
              </>
            ) : (
              <EmptyState illustration="sleeping-corgi">
                {claim.position.isClosed
                  ? "This claim is closed: nothing can be reserved, paid or returned on it."
                  : "An approver reads this screen; staff operations act on it."}
              </EmptyState>
            )}
          </section>

          <About>
            <h4>Incurred = paid + reserve</h4>
            <p>
              The figures are derived from this claim&apos;s events every time the page is rendered, never stored. The
              journal is the same story in double entry; if the two ever disagree, the page shows both rather than
              reconciling them for the reader.
            </p>
            <h4>Limits and approval</h4>
            <p>
              A payment is refused unless it clears the reserve available, the per-occurrence limit and the aggregate
              limit, and any payment above {formatCentsAsUsd(MONEY_OUT_APPROVAL_THRESHOLD_CENTS)}, counting what was
              already paid or asked for on this claim, needs a second person in the{" "}
              <Link href="/ops/approvals">money-out approvals</Link> queue.
            </p>
            <h4>The simulated rail</h4>
            <p>
              Paid counts a payment from the moment it is sent on the rail; the simulator settles it after{" "}
              {SIMULATED_SETTLEMENT_DELAY_DAYS} days or when a person presses settle, and a return puts the money back. A
              real rail would send those events itself.
            </p>
            <h4>Every rule is checked again</h4>
            <p>
              The server checks the role, the reserve available, both limits and the approval when a form is submitted,
              whatever this screen showed. A refusal comes back as a sentence at the top.
            </p>
            <h4>The bank check is a simulator</h4>
            <p>
              LOCAL SIMULATOR: a simulated ownership check, not a live bank integration. It says verified when the
              account holder name matches the claimant and the routing number is one this simulator can reach (
              {SIMULATED_REACHABLE_ROUTING_NUMBERS.join(" or ")}), and failed otherwise. Only the last four digits and a
              token are stored.
            </p>
          </About>
        </>
      ) : null}

      {view === "payments" ? (
        <>
          <DataTable
            ariaLabel="Claim payments"
            legend={
              <Legend
                items={[
                  { term: "waiting for approval", meaning: "above the threshold: a second person decides before anything moves" },
                  { term: "ready to send", meaning: "approved or below the threshold, waiting for a person to send it" },
                  { term: "rejected", meaning: "the second person refused it; nothing was sent" },
                  { term: "refused", meaning: "a rule refused it: the reserve, a limit, or the maker-checker gate" },
                  { term: "sent", meaning: "on the simulated rail, not settled yet" },
                  { term: "settled", meaning: "the simulator confirmed the money arrived" },
                  { term: "returned", meaning: "the bank sent it back and the reserve was restored" },
                ]}
              />
            }
          >
            <thead>
              <tr>
                <ExpandHead />
                <th className="nowrap">When</th>
                <th className="num">Amount</th>
                <th>Status</th>
                <th>Approval</th>
                <th>Action</th>
              </tr>
            </thead>
            {payments.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={6} className="dt-empty">
                    <EmptyState illustration="umbrella">Nothing has been paid on this claim.</EmptyState>
                  </td>
                </tr>
              </tbody>
            ) : (
              payments.map((payment, index) => {
                const approval = approvals[index];
                return (
                  <ExpandRow
                    key={payment.operationId}
                    columns={5}
                    cells={
                      <>
                        <td className="nowrap">
                          <When instant={payment.requestedAt} now={now} />
                        </td>
                        <Num>{formatCentsAsUsd(payment.amountCents)}</Num>
                        <td>
                          <Chip
                            tone={
                              payment.railStatus === "settled"
                                ? "ok"
                                : payment.railStatus === "returned" || payment.railStatus === "refused"
                                  ? "warn"
                                  : "neutral"
                            }
                          >
                            {payment.railStatus}
                          </Chip>
                          {payment.settlementDate ? (
                            <span className="dt-sub nowrap">
                              {payment.railStatus === "sent" ? "settles on " : "on "}
                              {payment.settlementDate}
                            </span>
                          ) : null}
                          {/* AF-02: the rail of every claim payment, named on the row itself. It
                              was a column of its own repeating one word on every row, which cost
                              the date beside it enough room to wrap mid-date at 1024 px (round 1,
                              MEDIUM). Same words, same row, one line under the state they
                              qualify. */}
                          <span className="dt-sub nowrap">LOCAL SIMULATOR</span>
                        </td>
                        <td>
                          {approval === null || approval === undefined ? (
                            <span className="dt-muted">not needed</span>
                          ) : (
                            <>
                              <Chip tone={approval.decision === "approved" ? "ok" : approval.decision ? "warn" : "neutral"}>
                                {approval.decision ?? "waiting"}
                              </Chip>
                              {/* Under a DECIDED chip, the name is the person who decided, never the
                                  person who asked. This cell used to print the requester under
                                  "approved", which read as operations approving its own request and
                                  is exactly what the maker-checker rule forbids (Yoann, LIVE-10,
                                  2026-09-09). The requester is still named, in "Requested by" and in
                                  the Approval line of the expansion.

                                  While it is still WAITING there is no decider to name, so the line
                                  says who asked and that somebody else has to decide. */}
                              {approval.decision ? (
                                <span className="dt-sub">by {approval.decidedByName ?? "unknown"}</span>
                              ) : (
                                <>
                                  <span className="dt-sub">asked by {approval.requestedByName}</span>
                                  <span className="dt-sub">a second person decides first</span>
                                </>
                              )}
                            </>
                          )}
                        </td>
                        <td className="dt-actions">
                          {user.role === "staff_ops" ? (
                            <PaymentActions claimId={claim.claimId} operationId={payment.operationId} railStatus={payment.railStatus} />
                          ) : (
                            <span className="dt-muted">read-only</span>
                          )}
                        </td>
                      </>
                    }
                  >
                    <FactGrid
                      items={[
                        { label: "Requested by", value: payment.requestedByName ?? "unknown" },
                        { label: "Requested", value: <When instant={payment.requestedAt} now={now} mode="utc" /> },
                        {
                          label: "Approval",
                          value:
                            approval === null || approval === undefined
                              ? `below ${formatCentsAsUsd(MONEY_OUT_APPROVAL_THRESHOLD_CENTS)}: no approver needed`
                              : `${approval.decision ?? "waiting"}, asked by ${approval.requestedByName}${approval.decidedByName ? `, decided by ${approval.decidedByName}` : ""}`,
                        },
                        {
                          label: "Transfer",
                          value: payment.transferRef ? (
                            <Ref
                              value={payment.transferRef}
                              inspectHref={inspectHref(path, query, payment.transferRef)}
                              open={inspected === payment.transferRef}
                            />
                          ) : (
                            "not sent yet"
                          ),
                        },
                      ]}
                    />
                    {/* A request raised through the MCP endpoint says so here too, not only on the
                        approvals queue: below the threshold nobody else would be told a machine
                        asked (review finding F-B11-01). */}
                    {payment.requestedThrough ? (
                      <p className="pd-note">
                        <Chip tone="warn">
                          raised by {payment.requestedThrough.principalKind === "agent" ? "an AGENT" : "a person over MCP"}, key{" "}
                          {payment.requestedThrough.keyPrefix}
                        </Chip>
                      </p>
                    ) : null}
                    <SandboxReferences
                      references={[
                        { label: "Money operation id", value: payment.operationId },
                        { label: "Simulated transfer reference", value: payment.transferRef },
                        { label: "Approval request id", value: payment.approvalRequestId },
                      ]}
                    />
                  </ExpandRow>
                );
              })
            )}
          </DataTable>

          {/* The same money in double entry, under the payments it explains rather than in a view
              of its own (cycle 2, decision 16). Every line goes through the shared table, so an
              account and its amount stay side by side at 1920 px (decision 10). */}
          <section className="card">
            <h2>Entries</h2>
            {entries.length === 0 ? (
              <EmptyState illustration="open-ledger">Nothing posted yet: the first entry appears when a reserve is set.</EmptyState>
            ) : (
              <JournalTable entries={entries} panelKey="claim" ariaLabel="Claim journal" />
            )}
          </section>

          <About>
            <h4>The rail is a simulator</h4>
            <p>
              LOCAL SIMULATOR on every row: no bank is reached. Send is a business action; settle and return are
              controls of the simulated bank, and a real rail would send those events itself.
            </p>
            <h4>Paid counts from sending</h4>
            <p>
              A payment counts as paid from the moment it is sent on the rail. A return puts the money back and restores
              the reserve; it is a new entry, never an edit of the first one.
            </p>
            <h4>The same story in double entry</h4>
            <p>
              Setting a reserve, paying, settling and returning each append their own balanced entry. The position at the
              top of this screen is folded from the same events.
            </p>
          </About>
        </>
      ) : null}

    </PortalShell>
  );
}

// The buttons that drive one payment. "Send" is a business action; "settle" and "return" are
// controls of the simulated bank, and they say so, because a real rail would send those events
// itself (AF-02: a simulator is never dressed up as a live integration).
function PaymentActions({ claimId, operationId, railStatus }: { claimId: string; operationId: string; railStatus: string }) {
  const action = `/api/claims/${claimId}/payments/${operationId}`;

  if (railStatus === "ready to send") {
    return (
      <form method="post" action={action} className="inline-form">
        <input type="hidden" name="action" value="send" />
        <SubmitButton>Send on the rail</SubmitButton>
      </form>
    );
  }
  if (railStatus === "waiting for approval") {
    return <span className="dt-muted">a second person decides first</span>;
  }
  // The two controls of the simulated bank are not business actions, so they sit in the row menu,
  // named LOCAL SIMULATOR where they are opened. Same forms, same fields as before.
  if (railStatus === "sent") {
    return (
      <RowMenu id={operationId} label="LOCAL SIMULATOR controls">
        <span className="pop-title">LOCAL SIMULATOR</span>
        <form method="post" action={action} className="card">
          <input type="hidden" name="action" value="settle" />
          <SubmitButton className="secondary">
            Settle now (it would settle on its own after {SIMULATED_SETTLEMENT_DELAY_DAYS} days)
          </SubmitButton>
        </form>
      </RowMenu>
    );
  }
  if (railStatus === "settled") {
    return (
      <RowMenu id={operationId} label="LOCAL SIMULATOR controls">
        <span className="pop-title">LOCAL SIMULATOR</span>
        <form method="post" action={action} className="card">
          <input type="hidden" name="action" value="return" />
          <label htmlFor={`returnReason-${operationId}`}>The bank returns the money</label>
          <input id={`returnReason-${operationId}`} name="returnReason" defaultValue="account_closed" />
          <SubmitButton className="secondary">Return this payment</SubmitButton>
        </form>
      </RowMenu>
    );
  }
  return <span className="dt-muted">nothing to do</span>;
}
