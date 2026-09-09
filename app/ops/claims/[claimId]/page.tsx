import "@/app/styles/policy-detail.css";
import { PortalShell } from "@/components/portal-shell";
import { AmountExplained } from "@/components/amount-explained";
import { SandboxReferences } from "@/components/disclosures";
import { Chip } from "@/components/detail-layout";
import { JournalTable } from "@/components/journal-table";
import { MoneyAmountInput } from "@/components/money-amount-input";
import { About } from "@/components/ui/about";
import { Chart, ChartRow, HBars } from "@/components/ui/charts";
import { EmptyState } from "@/components/ui/empty";
import { Legend } from "@/components/ui/legend";
import { Stat, Stats } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
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
import { firstValue, pickView, toastsFromQuery, withParams, type Query, type ToastNotice } from "@/lib/ui/views";

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
// Layout (interface system of 2026-09-09): the sticky band names the claim and the mode of the
// rail its money moves on, and four views hold the rest: the position and the room left before a
// limit, the payments, the journal, the actions. F-YA-05 says a primary action is never hidden,
// so the forms are open cards in their own view and the band links straight to it. Every form
// keeps its endpoint and its fields; the server checks the role, the ceilings and the approval
// again whatever this page displayed.
const VIEWS = ["overview", "payments", "journal", "actions"] as const;
const VIEW_LABEL: Record<(typeof VIEWS)[number], string> = {
  overview: "Overview",
  payments: "Payments",
  journal: "Journal",
  actions: "Actions",
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
  const perOccurrenceLeftCents = claim.perOccurrenceLimitCents - claim.position.paidCents - claim.pendingCents;
  const aggregateLeftCents = claim.aggregateLimitCents - claim.policyCommittedCents;
  const reserveLeftCents = claim.position.reserveCents - claim.pendingCents;
  const waitingForApproval = payments.filter((payment) => payment.railStatus === "waiting for approval").length;
  const readyToSend = payments.filter((payment) => payment.railStatus === "ready to send").length;

  const refusal = firstValue(query.error);
  const openedOutcome = firstValue(query.opened);
  const bankOutcome = firstValue(query.bank);
  const paymentOutcome = firstValue(query.payment);
  const closedOutcome = firstValue(query.closed);

  const toasts: ToastNotice[] = [
    ...toastsFromQuery(query, { error: { tone: "error", title: "Refused" } }),
    ...(openedOutcome ? [{ tone: "ok" as const, title: "Claim open", text: "Set a reserve before paying anything.", param: "opened" }] : []),
    ...(bankOutcome ? [{ tone: "info" as const, title: "Bank check (LOCAL SIMULATOR)", text: bankOutcome, param: "bank" }] : []),
    ...(paymentOutcome ? [{ tone: "info" as const, title: "Payment", text: paymentOutcome.replace(/[-_]/g, " "), param: "payment" }] : []),
    ...(closedOutcome ? [{ tone: "ok" as const, title: "Claim closed", text: "Nothing more can be paid on it.", param: "closed" }] : []),
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
      views={VIEWS.map((one) => ({
        key: one,
        label: VIEW_LABEL[one],
        href: withParams(path, query, { view: one }),
        current: one === view,
        count: one === "payments" ? payments.length : one === "journal" ? entries.length : undefined,
      }))}
      trail={[{ label: "Claims", href: "/ops/claims" }, { label: `Claim ${claim.claimNumber}` }]}
      band={{
        title: `Claim ${claim.claimNumber}`,
        suffix: claim.policyNumber,
        meta: (
          <>
            <Chip tone={claim.position.isClosed ? "neutral" : "ok"}>{claim.position.isClosed ? "closed" : "open"}</Chip>
            {claim.position.hasReserve ? null : <Chip tone="warn">no reserve yet</Chip>}
            {bankAccount ? (
              <Chip tone={bankAccount.verificationStatus === "verified" ? "ok" : "warn"}>
                bank account {bankAccount.verificationStatus}
              </Chip>
            ) : (
              <Chip tone="warn">no bank account</Chip>
            )}
            {waitingForApproval > 0 ? <Chip tone="warn">{waitingForApproval} waiting for approval</Chip> : null}
            {readyToSend > 0 ? <Chip tone="warn">{readyToSend} ready to send</Chip> : null}
            {/* AF-02: the rail this claim's money moves on, in the band, on every view. */}
            <Chip tone="neutral">claim payout rail: LOCAL SIMULATOR</Chip>
          </>
        ),
        actions: (
          <>
            <Link href={`/policies/${claim.policyId}`} prefetch={false} className="button-link secondary">
              The policy
            </Link>
            {/* F-YA-05: the actions are forms, and a form is not a band button. The band takes the
                reader to the view that holds them, open, one card each. */}
            {canAct ? (
              <Link href={withParams(path, query, { view: "actions" })} prefetch={false} className="button-link">
                Reserve, pay, close
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
            <Stat
              label="Per-occurrence left"
              value={formatCentsAsUsd(perOccurrenceLeftCents)}
              tone={perOccurrenceLeftCents <= 0 ? "danger" : "neutral"}
              note={`of ${formatCentsAsUsd(claim.perOccurrenceLimitCents)}, on this claim`}
            />
            <Stat
              label="Aggregate left"
              value={formatCentsAsUsd(aggregateLeftCents)}
              tone={aggregateLeftCents <= 0 ? "danger" : "neutral"}
              note={`of ${formatCentsAsUsd(claim.aggregateLimitCents)}, across the policy`}
            />
          </Stats>

          <ChartRow>
            <Chart title="Against the per-occurrence limit" figure={formatCentsAsUsd(claim.perOccurrenceLimitCents)}>
              {/* The wrapper carries the one rule the shared bars are missing, see
                  app/styles/policy-detail.css. */}
              <div className="pd-bars">
              <HBars
                caption="Incurred and paid on this claim against the per-occurrence limit"
                max={claim.perOccurrenceLimitCents}
                rows={[
                  { label: "Incurred", value: claim.position.incurredCents, display: formatCentsAsUsd(claim.position.incurredCents) },
                  { label: "Paid", value: claim.position.paidCents, display: formatCentsAsUsd(claim.position.paidCents), color: "var(--chart-2)" },
                  { label: "Asked for", value: claim.pendingCents, display: formatCentsAsUsd(claim.pendingCents), color: "var(--chart-3)" },
                ]}
              />
              </div>
            </Chart>
            <Chart title="Against the aggregate limit" figure={formatCentsAsUsd(claim.aggregateLimitCents)}>
              <div className="pd-bars">
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
              </div>
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

            <section className="card">
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
                    <dd>
                      {bankAccount.reason}
                      <SandboxReferences
                        references={[{ label: "Simulated account token (payment destination)", value: bankAccount.accountToken }]}
                      />
                    </dd>
                  </div>
                </dl>
              ) : (
                <EmptyState illustration="broken-link">
                  No bank account recorded yet. A payment cannot be requested without a verified one.
                </EmptyState>
              )}
              <p className="pd-note">
                LOCAL SIMULATOR: a simulated ownership check, not a live bank integration. It says verified when the
                account holder name matches the claimant and the routing number is one this simulator can reach (
                {SIMULATED_REACHABLE_ROUTING_NUMBERS.join(" or ")}), and failed otherwise. Only the last four digits and
                a token are stored.
              </p>
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
          </About>
        </>
      ) : null}

      {view === "payments" ? (
        <>
          {/* The wrapper carries the rule that keeps a closed row menu closed, see
              app/styles/policy-detail.css. */}
          <div className="pd-rows">
          <DataTable
            ariaLabel="Claim payments"
            legend={
              <Legend
                items={[
                  { term: "ready to send", meaning: "approved or below the threshold, waiting for a person to send it" },
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
                <th>Rail</th>
                <th>Approval</th>
                <th>Action</th>
              </tr>
            </thead>
            {payments.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={7} className="dt-empty">
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
                    columns={6}
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
                            <span className="dt-sub">
                              {payment.railStatus === "sent" ? "settles on " : "on "}
                              {payment.settlementDate}
                            </span>
                          ) : null}
                        </td>
                        {/* AF-02: the rail of every claim payment, named on the row itself. */}
                        <td className="nowrap">LOCAL SIMULATOR</td>
                        <td>
                          {approval === null || approval === undefined ? (
                            <span className="dt-muted">not needed</span>
                          ) : (
                            <>
                              <Chip tone={approval.decision === "approved" ? "ok" : approval.decision ? "warn" : "neutral"}>
                                {approval.decision ?? "waiting"}
                              </Chip>
                              <span className="dt-sub">{approval.requestedByName}</span>
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
                          value: payment.transferRef ? <Ref value={payment.transferRef} /> : "not sent yet",
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
          </div>

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
          </About>
        </>
      ) : null}

      {view === "journal" ? (
        <>
          <section className="card">
            <h2>Journal entries of this claim</h2>
            {entries.length === 0 ? (
              <EmptyState illustration="open-ledger">Nothing posted yet: the first entry appears when a reserve is set.</EmptyState>
            ) : (
              <JournalTable entries={entries} panelKey="claim" ariaLabel="Claim journal" />
            )}
          </section>

          <About>
            <h4>The same story in double entry</h4>
            <p>
              Setting a reserve, paying, settling and returning each append their own balanced entry. The position at the
              top of this screen is folded from the same events.
            </p>
          </About>
        </>
      ) : null}

      {view === "actions" ? (
        <>
          {canAct ? (
            <div className="cards">
              <section className="card pd-form-card">
                <h2>{claim.position.hasReserve ? "Adjust the reserve" : "Set the reserve"}</h2>
                <form method="post" action={`/api/claims/${claim.claimId}`} className="card">
                  <input type="hidden" name="action" value="set-reserve" />
                  <label htmlFor="reserveAmount">
                    {claim.position.hasReserve ? "Adjust the reserve to (US dollars)" : "Set the reserve to (US dollars)"}
                  </label>
                  <MoneyAmountInput id="reserveAmount" name="reserveAmount" placeholder="5,000.00" required />
                  <label htmlFor="reserveNote">Why (optional)</label>
                  <input id="reserveNote" name="note" placeholder="engineer's estimate revised" />
                  <SubmitButton className="secondary">
                    {claim.position.hasReserve ? "Adjust the reserve" : "Set the reserve"}
                  </SubmitButton>
                </form>
              </section>

              <section className="card pd-form-card">
                <h2>Record a bank account</h2>
                <form method="post" action={`/api/claims/${claim.claimId}`} className="card">
                  <input type="hidden" name="action" value="add-bank-account" />
                  <label htmlFor="accountHolderName">Claimant&apos;s account holder name (LOCAL SIMULATOR)</label>
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
                  <SubmitButton className="secondary">Check ownership and record the account</SubmitButton>
                </form>
              </section>

              <section className="card pd-form-card">
                <h2>Pay the claimant</h2>
                <form method="post" action={`/api/claims/${claim.claimId}`} className="card">
                  <input type="hidden" name="action" value="request-payment" />
                  <label htmlFor="paymentAmount">Pay the claimant (US dollars)</label>
                  <MoneyAmountInput id="paymentAmount" name="paymentAmount" placeholder="1,200.00" required />
                  <SubmitButton className="orange">Request this payment</SubmitButton>
                </form>
                <p className="pd-note">
                  {formatCentsAsUsd(reserveLeftCents)} of reserve is available, and anything above{" "}
                  {formatCentsAsUsd(MONEY_OUT_APPROVAL_THRESHOLD_CENTS)} on this claim waits for a second person.
                </p>
              </section>

              {claim.position.reserveCents === 0 && claim.pendingCents === 0 ? (
                <section className="card pd-form-card">
                  <h2>Close this claim</h2>
                  <form method="post" action={`/api/claims/${claim.claimId}`} className="card">
                    <input type="hidden" name="action" value="close" />
                    <label htmlFor="closeNote">Closing note (optional)</label>
                    <input id="closeNote" name="note" placeholder="settled in full" />
                    <SubmitButton className="danger">Close this claim</SubmitButton>
                  </form>
                </section>
              ) : null}
            </div>
          ) : (
            <EmptyState illustration="sleeping-corgi">
              {claim.position.isClosed
                ? "This claim is closed: nothing can be reserved, paid or returned on it."
                : "An approver reads this screen; staff operations act on it."}
            </EmptyState>
          )}

          <About>
            <h4>Every rule is checked again</h4>
            <p>
              The server checks the role, the reserve available, both limits and the approval when the form is submitted,
              whatever this screen showed. A refusal comes back as a sentence at the top.
            </p>
            <h4>The bank check is simulated</h4>
            <p>
              LOCAL SIMULATOR: it says verified when the account holder name matches the claimant and the routing number
              is one this simulator can reach. Only the last four digits and a token are stored.
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
