import { PortalShell } from "@/components/portal-shell";
import { AmountExplained } from "@/components/amount-explained";
import { Disclosure, RowActions, SandboxReferences } from "@/components/disclosures";
import { AsideList, Chip, DetailGrid, DetailHeading, Empty, Facts, Panel } from "@/components/detail-layout";
import { JournalTable } from "@/components/journal-table";
import { MoneyAmountInput } from "@/components/money-amount-input";
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

// One claim: what it has cost, what it still expects to cost, where its payments are on the
// simulated rail, and every journal entry it produced.
//
// The three numbers at the top are the ones Track 1 asks for, and they are derived from the
// claim's events every time this page is rendered, never stored:
//
//     incurred = paid + reserve
//
// The journal at the bottom is the same story in double entry. If the two ever disagree, one of
// them is wrong and the page shows both rather than reconciling them for the reader.
//
// Layout (rebuilt 2026-09-08, YOA-633): identity band with the chips, then two columns. Left:
// the position, the room left before a limit, the payments, the reserve history, the journal.
// Right: the actions as open forms (a primary action is never hidden), the claimant's bank
// account, and the explanations under a fold. Every form keeps its endpoint and its fields; the
// server checks the role, the ceilings and the approval again whatever this page displayed.
export default async function ClaimPage({
  params,
  searchParams,
}: {
  params: Promise<{ claimId: string }>;
  searchParams: Promise<{ error?: string; payment?: string; bank?: string; opened?: string; closed?: string }>;
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

  const canAct = user.role === "staff_ops" && !claim.position.isClosed;
  const perOccurrenceLeftCents =
    claim.perOccurrenceLimitCents - claim.position.paidCents - claim.pendingCents;
  const aggregateLeftCents = claim.aggregateLimitCents - claim.policyCommittedCents;
  const reserveLeftCents = claim.position.reserveCents - claim.pendingCents;
  const waitingForApproval = payments.filter((payment) => payment.railStatus === "waiting for approval").length;
  const readyToSend = payments.filter((payment) => payment.railStatus === "ready to send").length;

  const notices = [
    query.error ? <p key="error" className="error" role="alert">{query.error}</p> : null,
    query.opened ? <p key="opened" className="note" role="status">The claim is open. Set a reserve before paying anything.</p> : null,
    query.bank ? <p key="bank" className="note" role="status">Bank ownership check (LOCAL SIMULATOR): {query.bank}.</p> : null,
    query.payment ? <p key="payment" className="note" role="status">Payment: {query.payment.replace(/[-_]/g, " ")}.</p> : null,
    query.closed ? <p key="closed" className="note" role="status">The claim is closed.</p> : null,
  ].filter(Boolean);

  return (
    <PortalShell active="claims" user={user} trail={[
      { label: "Claims", href: "/ops/claims" },
      { label: `Claim ${claim.claimNumber}` },
    ]}>
      <DetailHeading
        title={`Claim ${claim.claimNumber}`}
        lead={
          <>
            {claim.claimantName} · loss on {claim.occurredAt} · reported {claim.reportedAt} · policy{" "}
            <Link href={`/policies/${claim.policyId}`}>{claim.policyNumber}</Link>
          </>
        }
        chips={
          <>
            <Chip tone={claim.position.isClosed ? "neutral" : "ok"}>{claim.position.isClosed ? "closed" : "open"}</Chip>
            {claim.position.hasReserve ? null : <Chip tone="warn">no reserve yet</Chip>}
            {bankAccount ? (
              <Chip tone={bankAccount.verificationStatus === "verified" ? "ok" : "warn"}>bank account {bankAccount.verificationStatus}</Chip>
            ) : (
              <Chip tone="warn">no bank account</Chip>
            )}
            {waitingForApproval > 0 ? <Chip tone="warn">{waitingForApproval} waiting for approval</Chip> : null}
            {readyToSend > 0 ? <Chip tone="warn">{readyToSend} ready to send</Chip> : null}
          </>
        }
      />

      {notices.length > 0 ? <div className="notices">{notices}</div> : null}

      <DetailGrid
        main={
          <>
            <Panel title="What this claim has cost">
              {/* Slice B12-2: the three figures that make up the position carry a fold. All three
                  show the same arithmetic (lib/money/explain.ts, explainClaimIncurred) built from
                  the position this page already folded from the claim's events, and each names the
                  journal entries that prove it. */}
              <Facts
                items={[
                  {
                    label: "Paid, sent on the rail minus anything returned",
                    value: (
                      <AmountExplained
                        amountCents={claim.position.paidCents}
                        label="Paid on this claim"
                        explanation={{
                          ...explainClaimIncurred({
                            ...claim.position,
                            evidence: evidenceFromJournal(entries, "claims_payable"),
                          }),
                          resultKey: "paid",
                          evidenceLabel:
                            "Every entry that moved claims payable: a payment sent, its settlement on the rail, and any return.",
                        }}
                      />
                    ),
                  },
                  { label: "Of which settled by the rail", value: formatCentsAsUsd(claim.position.settledCents) },
                  {
                    label: "Reserve still outstanding",
                    value: (
                      <AmountExplained
                        amountCents={claim.position.reserveCents}
                        label="Reserve still outstanding on this claim"
                        explanation={{
                          ...explainClaimIncurred({
                            ...claim.position,
                            evidence: evidenceFromJournal(entries, "claim_reserve"),
                          }),
                          resultKey: "reserve",
                          evidenceLabel:
                            "Every entry that moved the reserve: the reserve set, each adjustment, and each payment taken out of it.",
                        }}
                      />
                    ),
                  },
                  {
                    label: "Incurred = paid + reserve",
                    value: (
                      <AmountExplained
                        amountCents={claim.position.incurredCents}
                        label="Incurred: what this claim has cost so far"
                        explanation={{
                          ...explainClaimIncurred({
                            ...claim.position,
                            evidence: evidenceFromJournal(entries, "incurred_loss_expense"),
                          }),
                          evidenceLabel:
                            "The incurred loss expense entries. Their balance is the same figure: the ledger tells the same story in double entry.",
                        }}
                      />
                    ),
                    emphasis: true,
                  },
                ]}
              />
            </Panel>

            <Panel title="Room left before a limit stops us">
              <Facts
                compact
                items={[
                  { label: "Reserve available, less payments already asked for", value: formatCentsAsUsd(reserveLeftCents) },
                  { label: `Per-occurrence limit ${formatCentsAsUsd(claim.perOccurrenceLimitCents)}, left on this claim`, value: formatCentsAsUsd(perOccurrenceLeftCents) },
                  { label: `Aggregate limit ${formatCentsAsUsd(claim.aggregateLimitCents)}, left across the policy`, value: formatCentsAsUsd(aggregateLeftCents) },
                ]}
              />
            </Panel>

            <Panel title="Payments">
              {payments.length === 0 ? (
                <Empty>Nothing has been paid on this claim.</Empty>
              ) : (
                <div className="table-scroll" role="region" aria-label="Claim payments" tabIndex={0}>
                  <table>
                    <thead>
                      <tr>
                        <th className="amount">Amount</th>
                        <th>Rail status</th>
                        <th>Approval</th>
                        <th>Requested by</th>
                        <th>Transfer</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((payment, index) => {
                        const approval = approvals[index];
                        return (
                          <tr key={payment.operationId}>
                            <td className="amount">{formatCentsAsUsd(payment.amountCents)}</td>
                            <td>
                              <Chip tone={payment.railStatus === "settled" ? "ok" : payment.railStatus === "returned" || payment.railStatus === "refused" ? "warn" : "neutral"}>
                                {payment.railStatus}
                              </Chip>
                              {payment.settlementDate ? (
                                <>
                                  <br />
                                  <span className="note">
                                    {payment.railStatus === "sent" ? "settles on " : "on "}
                                    {payment.settlementDate}
                                  </span>
                                </>
                              ) : null}
                            </td>
                            <td>
                              {approval === null || approval === undefined ? (
                                <span className="note">below {formatCentsAsUsd(MONEY_OUT_APPROVAL_THRESHOLD_CENTS)}: no approver needed</span>
                              ) : (
                                <>
                                  {approval.decision ?? "waiting"}
                                  <br />
                                  <span className="note">
                                    asked by {approval.requestedByName}
                                    {approval.decidedByName ? `, ${approval.decision} by ${approval.decidedByName}` : ""}
                                  </span>
                                </>
                              )}
                            </td>
                            <td>
                              {payment.requestedByName ?? "unknown"}
                              {/* A request raised through the MCP endpoint says so here too, not only
                                  on the approvals queue: below the threshold nobody else would be
                                  told a machine asked (review finding F-B11-01). */}
                              {payment.requestedThrough ? (
                                <>
                                  <br />
                                  <Chip tone="warn">
                                    raised by {payment.requestedThrough.principalKind === "agent" ? "an AGENT" : "a person over MCP"}, key{" "}
                                    {payment.requestedThrough.keyPrefix}
                                  </Chip>
                                </>
                              ) : null}
                            </td>
                            <td>
                              {payment.transferRef ? "on the rail" : <span className="note">not sent yet</span>}
                              <SandboxReferences
                                references={[
                                  { label: "Money operation id", value: payment.operationId },
                                  { label: "Simulated transfer reference", value: payment.transferRef },
                                  { label: "Approval request id", value: payment.approvalRequestId },
                                ]}
                              />
                            </td>
                            <td>
                              {user.role === "staff_ops" ? (
                                <PaymentActions claimId={claim.claimId} operationId={payment.operationId} railStatus={payment.railStatus} />
                              ) : (
                                <span className="note">read-only for an approver</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel title="Reserve history">
              {reserves.length === 0 ? (
                <Empty>No reserve has been set yet. Nothing can be paid until one is.</Empty>
              ) : (
                <div className="table-scroll" role="region" aria-label="Reserve history" tabIndex={0}>
                  <table>
                    <thead>
                      <tr>
                        <th>Decision</th>
                        <th className="amount">From</th>
                        <th className="amount">To</th>
                        <th className="amount">Booked</th>
                        <th>Recorded (UTC)</th>
                        <th>By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reserves.map((reserve) => (
                        <tr key={reserve.claimEventId}>
                          <td>{reserve.eventType.replace("_", " ")}</td>
                          <td className="amount">{formatCentsAsUsd(reserve.previousReserveCents)}</td>
                          <td className="amount">{formatCentsAsUsd(reserve.newReserveCents)}</td>
                          <td className="amount">{reserve.deltaCents === 0 ? "no entry" : formatCentsAsUsd(reserve.deltaCents)}</td>
                          <td>{reserve.recordedAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                          <td>
                            {reserve.recordedByName ?? "unknown"}
                            {reserve.note ? <span className="note"> ({reserve.note})</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel title="Journal entries of this claim">
              {entries.length === 0 ? (
                <Empty>Nothing posted yet: the first entry appears when a reserve is set.</Empty>
              ) : (
                <JournalTable entries={entries} ariaLabel="Claim journal" />
              )}
            </Panel>
          </>
        }
        aside={
          <>
            {canAct ? (
              <Panel title="Actions">
                <form method="post" action={`/api/claims/${claim.claimId}`} className="card">
                  <input type="hidden" name="action" value="set-reserve" />
                  <label htmlFor="reserveAmount">
                    {claim.position.hasReserve ? "Adjust the reserve to (US dollars)" : "Set the reserve to (US dollars)"}
                  </label>
                  <MoneyAmountInput id="reserveAmount" name="reserveAmount" placeholder="5,000.00" required />
                  <label htmlFor="reserveNote">Why (optional)</label>
                  <input id="reserveNote" name="note" placeholder="engineer's estimate revised" />
                  <button type="submit" className="secondary">{claim.position.hasReserve ? "Adjust the reserve" : "Set the reserve"}</button>
                </form>

                <form method="post" action={`/api/claims/${claim.claimId}`} className="card">
                  <input type="hidden" name="action" value="add-bank-account" />
                  <label htmlFor="accountHolderName">Claimant&apos;s account holder name (LOCAL SIMULATOR)</label>
                  <input id="accountHolderName" name="accountHolderName" defaultValue={claim.claimantName} required />
                  <label htmlFor="routingNumber">Routing number (nine digits)</label>
                  <input id="routingNumber" name="routingNumber" autoComplete="off" spellCheck={false} inputMode="numeric" placeholder="110000000" required />
                  <label htmlFor="accountNumber">Account number</label>
                  <input id="accountNumber" name="accountNumber" autoComplete="off" spellCheck={false} inputMode="numeric" placeholder="000123456789" required />
                  <button type="submit" className="secondary">Check ownership and record the account</button>
                </form>

                <form method="post" action={`/api/claims/${claim.claimId}`} className="card">
                  <input type="hidden" name="action" value="request-payment" />
                  <label htmlFor="paymentAmount">Pay the claimant (US dollars)</label>
                  <MoneyAmountInput id="paymentAmount" name="paymentAmount" placeholder="1,200.00" required />
                  <button type="submit" className="orange">Request this payment</button>
                </form>

                {claim.position.reserveCents === 0 && claim.pendingCents === 0 ? (
                  <form method="post" action={`/api/claims/${claim.claimId}`} className="card">
                    <input type="hidden" name="action" value="close" />
                    <label htmlFor="closeNote">Closing note (optional)</label>
                    <input id="closeNote" name="note" placeholder="settled in full" />
                    <button type="submit" className="danger">Close this claim</button>
                  </form>
                ) : null}
              </Panel>
            ) : null}

            <Panel title="Claimant bank account">
              {bankAccount ? (
                <AsideList
                  items={[
                    { label: "Check", value: <Chip tone={bankAccount.verificationStatus === "verified" ? "ok" : "warn"}>{bankAccount.verificationStatus}</Chip> },
                    { label: "Account holder", value: bankAccount.accountHolderName },
                    { label: "Routing / account", value: `...${bankAccount.routingNumberLast4} / ...${bankAccount.accountNumberLast4}` },
                    {
                      label: "Result",
                      value: (
                        <>
                          {bankAccount.reason}
                          <SandboxReferences references={[{ label: "Simulated account token (payment destination)", value: bankAccount.accountToken }]} />
                        </>
                      ),
                    },
                  ]}
                />
              ) : (
                <Empty>No bank account recorded yet. A payment cannot be requested without a verified one.</Empty>
              )}
              <p className="note">
                LOCAL SIMULATOR: a simulated ownership check, not a live bank integration. It says verified when the
                account holder name matches the claimant and the routing number is one this simulator can reach
                ({SIMULATED_REACHABLE_ROUTING_NUMBERS.join(" or ")}), and failed otherwise. Only the last four digits
                and a token are stored.
              </p>
            </Panel>

            <Panel title="How to read this page">
              <Disclosure title="Incurred = paid + reserve">
                <p>
                  The figures are derived from this claim&apos;s events every time the page is rendered, never stored.
                  The journal is the same story in double entry; if the two ever disagree, the page shows both rather
                  than reconciling them for the reader.
                </p>
              </Disclosure>
              <Disclosure title="Limits and approval">
                <p>
                  A payment is refused unless it clears the reserve available, the per-occurrence limit and the
                  aggregate limit, and any payment above {formatCentsAsUsd(MONEY_OUT_APPROVAL_THRESHOLD_CENTS)},
                  counting what was already paid or asked for on this claim, needs a second person in the{" "}
                  <Link href="/ops/approvals">money-out approvals</Link> queue.
                </p>
              </Disclosure>
              <Disclosure title="The simulated rail">
                <p>
                  Paid counts a payment from the moment it is sent on the rail; the simulator settles it after{" "}
                  {SIMULATED_SETTLEMENT_DELAY_DAYS} days or when a person presses settle, and a return puts the money
                  back. A real rail would send those events itself.
                </p>
              </Disclosure>
            </Panel>
          </>
        }
      />
    </PortalShell>
  );
}

// The buttons that drive one payment. "Send" is a business action; "settle" and "return" are
// controls of the simulated bank, and they say so, because a real rail would send those events
// itself (AF-02: a simulator is never dressed up as a live integration).
function PaymentActions({
  claimId,
  operationId,
  railStatus,
}: {
  claimId: string;
  operationId: string;
  railStatus: string;
}) {
  const action = `/api/claims/${claimId}/payments/${operationId}`;

  if (railStatus === "ready to send") {
    return (
      <form method="post" action={action} className="inline-form">
        <input type="hidden" name="action" value="send" />
        <button type="submit" className="small">Send on the rail</button>
      </form>
    );
  }
  if (railStatus === "waiting for approval") {
    return <span className="note">a second person has to approve it first</span>;
  }
  if (railStatus === "sent") {
    return (
      <RowActions label="LOCAL SIMULATOR">
        <form method="post" action={action} className="inline-form">
          <input type="hidden" name="action" value="settle" />
          <button type="submit" className="secondary small">
            Settle now (it would settle on its own after {SIMULATED_SETTLEMENT_DELAY_DAYS} days)
          </button>
        </form>
      </RowActions>
    );
  }
  if (railStatus === "settled") {
    return (
      <RowActions label="LOCAL SIMULATOR">
        <form method="post" action={action} className="card">
          <input type="hidden" name="action" value="return" />
          <label htmlFor={`returnReason-${operationId}`}>The bank returns the money</label>
          <input id={`returnReason-${operationId}`} name="returnReason" defaultValue="account_closed" />
          <button type="submit" className="secondary small">Return this payment</button>
        </form>
      </RowActions>
    );
  }
  return <span className="note">nothing to do</span>;
}
