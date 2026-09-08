import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { commissionPayableMovementCents } from "@/lib/statements/journal";
import { isUuid } from "@/lib/http/path-ids";
import {
  changesAgainstPrevious,
  statementRun,
  type RevisionChange,
  type StatementLineRow,
  type StatementRunDetail,
} from "@/lib/statements/read";

// /statements/{runId}: one broker statement, exactly as it was stored.
//
// One page for both audiences, because it is the same document: staff operations and staff
// approvers see every statement, a broker sees only the statements of the broker their user
// account is attached to, and anybody else is refused. The ownership question is asked here, on
// the server, and the broker id comes from the session and never from the URL.
//
// THE LINE THAT MAKES THIS PAGE WORTH READING is "ties to the ledger": the net due printed on the
// statement is compared, live, with the movement of this broker's commission payable account in
// the journal, read again with the same month and the same knowledge cutoff by a second, much
// smaller query (lib/statements/journal.ts). Two independent reads of the same ledger have to
// agree to the cent, and the page says so either way rather than assuming it.
//
// Nothing on this page is computed in the browser: it is a server component, the figures come out
// of the two queries above, and the only interactive elements are a link to the PDF and a form
// that posts a new run.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KIND_LABEL: Record<StatementLineRow["kind"], string> = {
  premium_collected: "Premium collected",
  commission_earned: "Commission earned",
  clawback: "Commission clawback",
  refund: "Refund to customer",
  adjustment: "Adjustment",
};

export default async function StatementPage({ params }: { params: Promise<{ runId: string }> }) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  const { runId } = await params;
  if (!isUuid(runId)) notFound(); // a malformed id is an unknown page, not a 500 (F-B7-07)
  // A malformed id is a wrong address, not a server error: it must not reach the uuid column.
  if (!UUID.test(runId)) {
    notFound();
  }

  const statement = await statementRun(sql, runId);
  if (!statement) {
    notFound();
  }
  const isStaff = user.role === "staff_ops" || user.role === "staff_approver";
  const isOwningBroker = user.role === "broker" && user.brokerId === statement.run.brokerId;
  if (!isStaff && !isOwningBroker) {
    return (
      <main>
        <h1>Broker statement</h1>
        <p className="error">This statement belongs to another broker.</p>
      </main>
    );
  }

  const { run, lines } = statement;
  // The second opinion: the ledger's own answer to "what moved on this broker's commission
  // payable in this month, as known at this cutoff".
  const [ledgerMovementCents, changes] = await Promise.all([
    commissionPayableMovementCents(
      { brokerId: run.brokerId, statementMonth: run.statementMonth, knowledgeCutoff: run.knowledgeCutoff },
      sql,
    ),
    changesAgainstPrevious(sql, run.runId),
  ]);
  const tiesToTheLedger = ledgerMovementCents === run.netDueCents;

  return (
    <main>
      <p className="note">
        <Link href={isStaff ? "/ops/statements" : "/broker/statements"}>All statements</Link>
      </p>

      <h1>
        {run.brokerName}, {run.statementMonth}
      </h1>
      <p className="lead">
        Revision {run.revision}
        {run.supersedesRunId ? ", superseding the previous revision of this month" : ", the first run of this month"}.
        All times are UTC.
      </p>

      {run.monthWasStillRunning ? (
        <p className="badge badge-warn">
          Month in progress, provisional: this run was produced before {run.statementMonth} was over, so more money
          could still be booked into it. It stays exactly as it is; the run made after the month ends is the next
          revision and the definitive one.
        </p>
      ) : null}

      {run.identicalToPrevious ? (
        <p className="badge badge-ok">
          Identical to revision {run.revision - 1}: the same journal entries, the same content hash. Re-running a
          closed month with its own cutoff reproduces it exactly.
        </p>
      ) : null}

      <table className="amounts">
        <tbody>
          <tr>
            <th>Statement month</th>
            <td>{run.statementMonth}, by the business (effective) date of each journal entry</td>
          </tr>
          <tr>
            <th>Knowledge cutoff</th>
            <td>
              {utc(run.knowledgeCutoff)}: only entries recorded at or before this instant are on the statement
            </td>
          </tr>
          <tr>
            <th>Content hash (sha256)</th>
            <td>
              <code>{run.contentHash}</code>
            </td>
          </tr>
          <tr>
            <th>Produced</th>
            <td>
              {utc(run.createdAt)}
              {run.runByName ? ` by ${run.runByName}` : ""}
            </td>
          </tr>
          {run.supersedesRunId ? (
            <tr>
              <th>Supersedes</th>
              <td>
                <Link href={`/statements/${run.supersedesRunId}`}>revision {run.revision - 1} of this month</Link>
              </td>
            </tr>
          ) : null}
          <tr>
            <th>Document</th>
            <td>
              <Link href={`/api/statements/${run.runId}/pdf`}>Download the PDF</Link>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Ties to the ledger</h2>
      {tiesToTheLedger ? (
        <p className="badge badge-ok">
          Net due {formatCentsAsUsd(run.netDueCents)} equals the movement of this broker&apos;s commission payable
          account in the journal for {run.statementMonth}, recomputed now with the same knowledge cutoff.
        </p>
      ) : (
        <p className="error">
          The statement says {formatCentsAsUsd(run.netDueCents)} and the journal says{" "}
          {formatCentsAsUsd(ledgerMovementCents)} for the same broker, month and cutoff. The ledger is the truth:
          this run must not be paid until the difference is explained.
        </p>
      )}

      <h2>Movements</h2>
      {lines.length === 0 ? (
        <p className="note">
          No premium was collected and no commission moved for this broker in {run.statementMonth}. An empty
          statement is a real statement: it says the month was quiet, not that nothing was looked at.
        </p>
      ) : (
        <table className="ledger">
          <thead>
            <tr>
              <th>Effective</th>
              <th>Recorded (UTC)</th>
              <th>Line</th>
              <th>Policy</th>
              <th>Journal entry</th>
              <th className="amount">Amount</th>
              <th className="amount">Premium in it</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.journalEntryId}>
                <td>{calendarDate(line.effectiveAt)}</td>
                <td>{utc(line.entryRecordedAt)}</td>
                <td>
                  {KIND_LABEL[line.kind]}
                  <br />
                  <span className="note">{line.description}</span>
                </td>
                <td>
                  {line.policyId && line.policyNumber ? (
                    <Link href={`/policies/${line.policyId}`}>{line.policyNumber}</Link>
                  ) : (
                    <span className="note">no policy</span>
                  )}
                </td>
                <td>
                  <code>{line.journalEntryId.slice(0, 8)}</code>
                </td>
                <td className="amount">{formatCentsAsUsd(line.amountCents)}</td>
                <td className="amount">
                  {line.commissionBaseCents === null ? (
                    <span className="note">not a cash line</span>
                  ) : (
                    formatCentsAsUsd(line.commissionBaseCents)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Totals</h2>
      <table className="amounts">
        <tbody>
          <tr>
            <th>Cash collected from customers (premium, tax and fee)</th>
            <td className="amount">{formatCentsAsUsd(run.cashCollectedCents)}</td>
          </tr>
          <tr>
            <th>Premium collected, which is the commission base</th>
            <td className="amount">{formatCentsAsUsd(run.premiumCollectedCents)}</td>
          </tr>
          <tr>
            <th>Commission earned on that premium</th>
            <td className="amount">{formatCentsAsUsd(run.commissionEarnedCents)}</td>
          </tr>
          <tr>
            <th>Commission clawed back on refunded premium</th>
            <td className="amount">{formatCentsAsUsd(-run.clawbackCents)}</td>
          </tr>
          {run.adjustmentCents === 0 ? null : (
            <tr>
              <th>Other adjustments to the commission owed</th>
              <td className="amount">{formatCentsAsUsd(run.adjustmentCents)}</td>
            </tr>
          )}
          <tr className="total">
            <th>Net due to the broker</th>
            <td className="amount">{formatCentsAsUsd(run.netDueCents)}</td>
          </tr>
        </tbody>
      </table>
      <p className="note">
        The two collected figures are the same money read twice: the cash line is what the customers paid,
        premium plus state premium tax plus policy fee, and the premium line is the part of it commission is
        earned on. Both come from the journal: the cash from the collection entries, the premium from the
        entries that wrote it under the same payment. Commission is the premium times the broker&apos;s rate,
        rounded down, and never touches tax or fee. Refunds are not netted into these two figures; they are on
        their own lines above, next to the clawback each one produced.
      </p>

      {changes ? <Changes changes={changes} previousRevision={run.revision - 1} /> : null}

      {isStaff ? (
        <section className="card-block">
          <h2>Run this month again</h2>
          <p className="note">
            With the cutoff of this revision, the run reads exactly the same journal entries and produces the
            same content hash; it is stored as the next revision and flagged as identical. Leave the cutoff
            empty on the statements screen to read everything known now, which is how a correction recorded
            after this cutoff becomes a new revision.
          </p>
          <form method="post" action="/api/statements/run" className="card">
            <input type="hidden" name="brokerId" value={run.brokerId} />
            <input type="hidden" name="month" value={run.statementMonth} />
            <input type="hidden" name="knowledgeCutoff" value={run.knowledgeCutoff.toISOString()} />
            <button type="submit">Re-run with this knowledge cutoff</button>
          </form>
        </section>
      ) : null}
    </main>
  );
}

function Changes({ changes, previousRevision }: { changes: { appeared: RevisionChange[]; disappeared: RevisionChange[] }; previousRevision: number }) {
  const nothingChanged = changes.appeared.length === 0 && changes.disappeared.length === 0;
  return (
    <>
      <h2>What changed against revision {previousRevision}</h2>
      {nothingChanged ? (
        <p className="note">
          The same journal entries, one for one. Nothing was added and nothing was taken away.
        </p>
      ) : (
        <table className="ledger">
          <thead>
            <tr>
              <th>Journal entry</th>
              <th>Change</th>
              <th>Line</th>
              <th>Policy</th>
              <th>Recorded (UTC)</th>
              <th className="amount">Amount</th>
            </tr>
          </thead>
          <tbody>
            {changes.appeared.map((change) => (
              <ChangeRow key={`appeared-${change.journalEntryId}`} change={change} label="appeared on this revision" />
            ))}
            {changes.disappeared.map((change) => (
              <ChangeRow
                key={`disappeared-${change.journalEntryId}`}
                change={change}
                label="was on the previous revision and is not on this one"
              />
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function ChangeRow({ change, label }: { change: RevisionChange; label: string }) {
  return (
    <tr>
      <td>
        <code>{change.journalEntryId.slice(0, 8)}</code>
      </td>
      <td>{label}</td>
      <td>
        {KIND_LABEL[change.kind]}
        <br />
        <span className="note">{change.description}</span>
      </td>
      <td>{change.policyNumber ?? "-"}</td>
      <td>{utc(change.entryRecordedAt)}</td>
      <td className="amount">{formatCentsAsUsd(change.amountCents)}</td>
    </tr>
  );
}

// A date column comes back from the driver as a Date at midnight UTC; the page prints the
// calendar day it stands for.
function calendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utc(instant: Date): string {
  return instant.toISOString().replace("T", " ").slice(0, 19);
}
