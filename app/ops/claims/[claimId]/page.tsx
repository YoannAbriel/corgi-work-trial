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
// The journal table at the bottom is the same story in double entry. If the two ever disagree,
// one of them is wrong and the page shows both rather than reconciling them for the reader.
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

  return (
    <main>
      <p className="note">
        <Link href="/ops/claims">All claims</Link> | <Link href="/ops/approvals">Money-out approvals</Link> |{" "}
        <Link href={`/policies/${claim.policyId}`}>Policy {claim.policyNumber}</Link>
      </p>

      <h1>Claim {claim.claimNumber}</h1>
      <p className="lead">
        {claim.claimantName}. Loss on {claim.occurredAt}, reported {claim.reportedAt}, policy{" "}
        {claim.policyNumber}
      </p>
      <p className={`badge ${claim.position.isClosed ? "badge-warn" : "badge-ok"}`}>
        {claim.position.isClosed ? "closed" : "open"}
      </p>

      {query.error ? <p className="error">{query.error}</p> : null}
      {query.opened ? <p className="note">The claim is open. Set a reserve before paying anything.</p> : null}
      {query.bank ? <p className="note">Bank ownership check (LOCAL SIMULATOR): {query.bank}.</p> : null}
      {query.payment ? <p className="note">Payment: {query.payment.replace(/[-_]/g, " ")}.</p> : null}
      {query.closed ? <p className="note">The claim is closed.</p> : null}

      <h2>What this claim has cost</h2>
      <table className="amounts">
        <tbody>
          <tr>
            <th>Paid (sent on the rail, minus anything returned)</th>
            <td className="amount">{formatCentsAsUsd(claim.position.paidCents)}</td>
          </tr>
          <tr>
            <th>Of which the rail has confirmed as settled</th>
            <td className="amount">{formatCentsAsUsd(claim.position.settledCents)}</td>
          </tr>
          <tr>
            <th>Reserve still outstanding</th>
            <td className="amount">{formatCentsAsUsd(claim.position.reserveCents)}</td>
          </tr>
          <tr className="total">
            <th>Incurred = paid + reserve</th>
            <td className="amount">{formatCentsAsUsd(claim.position.incurredCents)}</td>
          </tr>
        </tbody>
      </table>

      <h2>What is left to pay before a limit stops us</h2>
      <table className="amounts">
        <tbody>
          <tr>
            <th>Reserve available (outstanding, less payments already asked for)</th>
            <td className="amount">{formatCentsAsUsd(reserveLeftCents)}</td>
          </tr>
          <tr>
            <th>Per-occurrence limit {formatCentsAsUsd(claim.perOccurrenceLimitCents)}, left on this claim</th>
            <td className="amount">{formatCentsAsUsd(perOccurrenceLeftCents)}</td>
          </tr>
          <tr>
            <th>Aggregate limit {formatCentsAsUsd(claim.aggregateLimitCents)}, left across the policy</th>
            <td className="amount">{formatCentsAsUsd(aggregateLeftCents)}</td>
          </tr>
        </tbody>
      </table>
      <p className="note">
        A payment is refused unless it clears all three, and any payment above{" "}
        {formatCentsAsUsd(MONEY_OUT_APPROVAL_THRESHOLD_CENTS)} also needs a second person to approve it.
      </p>

      <h2>Reserve history</h2>
      {reserves.length === 0 ? (
        <p className="note">No reserve has been set yet. Nothing can be paid until one is.</p>
      ) : (
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
                <td className="amount">
                  {reserve.deltaCents === 0 ? "no entry" : formatCentsAsUsd(reserve.deltaCents)}
                </td>
                <td>{reserve.recordedAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                <td>
                  {reserve.recordedByName ?? "unknown"}
                  {reserve.note ? <span className="note"> ({reserve.note})</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canAct ? (
        <form method="post" action={`/api/claims/${claim.claimId}`} className="card">
          <input type="hidden" name="action" value="set-reserve" />
          <label htmlFor="reserveAmount">
            {claim.position.hasReserve ? "Adjust the reserve to (US dollars)" : "Set the reserve to (US dollars)"}
          </label>
          <input id="reserveAmount" name="reserveAmount" inputMode="decimal" placeholder="5000.00" required />
          <label htmlFor="reserveNote">Why (optional)</label>
          <input id="reserveNote" name="note" placeholder="engineer's estimate revised" />
          <button type="submit">
            {claim.position.hasReserve ? "Adjust the reserve" : "Set the reserve"}
          </button>
        </form>
      ) : null}

      <h2>Claimant bank account (LOCAL SIMULATOR)</h2>
      <p className="note">
        This is a simulated ownership check, not a live bank integration. It says verified when
        the account holder name matches the claimant and the routing number is one this simulator
        can reach ({SIMULATED_REACHABLE_ROUTING_NUMBERS.join(" or ")}), and failed otherwise. Only
        the last four digits and a token are stored: the numbers typed below are compared and
        dropped.
      </p>
      {bankAccount ? (
        <>
          <p className={`badge ${bankAccount.verificationStatus === "verified" ? "badge-ok" : "badge-warn"}`}>
            {bankAccount.verificationStatus}
          </p>
          <table className="amounts">
            <tbody>
              <tr>
                <th>Account holder</th>
                <td>{bankAccount.accountHolderName}</td>
              </tr>
              <tr>
                <th>Routing / account</th>
                <td>
                  ...{bankAccount.routingNumberLast4} / ...{bankAccount.accountNumberLast4}
                </td>
              </tr>
              <tr>
                <th>Token used as the payment destination</th>
                <td>{bankAccount.accountToken}</td>
              </tr>
              <tr>
                <th>Result</th>
                <td>{bankAccount.reason}</td>
              </tr>
            </tbody>
          </table>
        </>
      ) : (
        <p className="note">No bank account recorded yet. A payment cannot be requested without a verified one.</p>
      )}

      {canAct ? (
        <form method="post" action={`/api/claims/${claim.claimId}`} className="card">
          <input type="hidden" name="action" value="add-bank-account" />
          <label htmlFor="accountHolderName">Account holder name</label>
          <input id="accountHolderName" name="accountHolderName" defaultValue={claim.claimantName} required />
          <label htmlFor="routingNumber">Routing number (nine digits)</label>
          <input id="routingNumber" name="routingNumber" inputMode="numeric" placeholder="110000000" required />
          <label htmlFor="accountNumber">Account number</label>
          <input id="accountNumber" name="accountNumber" inputMode="numeric" placeholder="000123456789" required />
          <button type="submit">Check ownership and record the account</button>
        </form>
      ) : null}

      <h2>Payments</h2>
      {payments.length === 0 ? (
        <p className="note">Nothing has been paid on this claim.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th className="amount">Amount</th>
              <th>Rail status</th>
              <th>Approval</th>
              <th>Transfer</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((payment, index) => {
              const approval = approvals[index];
              return (
                <tr key={payment.operationId}>
                  <td className="amount">{formatCentsAsUsd(payment.amountCents)}</td>
                  <td>
                    {payment.railStatus}
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
                      <span className="note">
                        below {formatCentsAsUsd(MONEY_OUT_APPROVAL_THRESHOLD_CENTS)}: no approver needed
                      </span>
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
                    {payment.transferRef ?? <span className="note">not sent yet</span>}
                    {payment.requestedByName ? (
                      <>
                        <br />
                        <span className="note">requested by {payment.requestedByName}</span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    {user.role === "staff_ops" ? (
                      <PaymentActions
                        claimId={claim.claimId}
                        operationId={payment.operationId}
                        railStatus={payment.railStatus}
                      />
                    ) : (
                      <span className="note">read-only for an approver</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {canAct ? (
        <form method="post" action={`/api/claims/${claim.claimId}`} className="card">
          <input type="hidden" name="action" value="request-payment" />
          <label htmlFor="paymentAmount">Pay the claimant (US dollars)</label>
          <input id="paymentAmount" name="paymentAmount" inputMode="decimal" placeholder="1200.00" required />
          <button type="submit">Request this payment</button>
        </form>
      ) : null}

      {canAct && claim.position.reserveCents === 0 && claim.pendingCents === 0 ? (
        <form method="post" action={`/api/claims/${claim.claimId}`} className="card">
          <input type="hidden" name="action" value="close" />
          <label htmlFor="closeNote">Closing note (optional)</label>
          <input id="closeNote" name="note" placeholder="settled in full" />
          <button type="submit">Close this claim</button>
        </form>
      ) : null}

      <h2>Journal entries of this claim</h2>
      {entries.length === 0 ? (
        <p className="note">Nothing posted yet: the first entry appears when a reserve is set.</p>
      ) : (
        <table className="ledger">
          <thead>
            <tr>
              <th>Entry</th>
              <th>Effective</th>
              <th>Recorded (UTC)</th>
              <th>Account</th>
              <th className="amount">Debit</th>
              <th className="amount">Credit</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) =>
              entry.lines.map((line, lineIndex) => (
                <tr key={`${entry.entryId}-${line.accountId}-${lineIndex}`}>
                  {lineIndex === 0 ? (
                    <>
                      <td rowSpan={entry.lines.length}>{entry.entryType}</td>
                      <td rowSpan={entry.lines.length}>{entry.effectiveAt}</td>
                      <td rowSpan={entry.lines.length}>
                        {entry.recordedAt.toISOString().replace("T", " ").slice(0, 19)}
                      </td>
                    </>
                  ) : null}
                  <td>{line.accountName}</td>
                  <td className="amount">{line.debitCents > 0 ? formatCentsAsUsd(line.debitCents) : ""}</td>
                  <td className="amount">{line.creditCents > 0 ? formatCentsAsUsd(line.creditCents) : ""}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      )}
    </main>
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
        <button type="submit">Send on the rail</button>
      </form>
    );
  }
  if (railStatus === "waiting for approval") {
    return <span className="note">a second person has to approve it first</span>;
  }
  if (railStatus === "sent") {
    return (
      <form method="post" action={action} className="inline-form">
        <input type="hidden" name="action" value="settle" />
        <button type="submit">
          LOCAL SIMULATOR: settle now (it would settle on its own after {SIMULATED_SETTLEMENT_DELAY_DAYS} days)
        </button>
      </form>
    );
  }
  if (railStatus === "settled") {
    return (
      <form method="post" action={action} className="card">
        <input type="hidden" name="action" value="return" />
        <label htmlFor={`returnReason-${operationId}`}>LOCAL SIMULATOR: the bank returns the money</label>
        <input id={`returnReason-${operationId}`} name="returnReason" defaultValue="account_closed" />
        <button type="submit">Return this payment</button>
      </form>
    );
  }
  return <span className="note">nothing to do</span>;
}
