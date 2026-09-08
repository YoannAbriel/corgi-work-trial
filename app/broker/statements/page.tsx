import { PortalShell } from "@/components/portal-shell";
import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { collectedFigures } from "@/lib/statements/compute";
import { listStatementRuns, type StatementRunRow } from "@/lib/statements/read";

// /broker/statements: the broker's own monthly statements, read-only.
//
// A broker never runs a statement and never edits one: the list is filtered by the broker id that
// is attached to the signed-in user, never by an id taken from the URL, so there is no address a
// broker could type to see somebody else's commission.

const HOW_MANY_RUNS_SHOWN = 30;

export default async function BrokerStatementsPage() {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "broker" || !user.brokerId) {
    return (
      <PortalShell user={user} active="statements">
        <h1>Statements</h1>
        <p className="error" role="alert">
          This page is the broker journey. Your account has the role &quot;{user.role}&quot;.
        </p>
        {user.role === "staff_ops" || user.role === "staff_approver" ? (
          <p>
            <Link href="/ops/statements">Broker statements (operations)</Link>
          </p>
        ) : null}
      </PortalShell>
    );
  }

  const runs = await listStatementRuns(sql, { brokerId: user.brokerId, limit: HOW_MANY_RUNS_SHOWN });

  return (
    <PortalShell user={user} active="statements">

      <h1>Your statements</h1>
      <p className="lead">
        One statement per month, produced by Corgi operations and frozen when it is produced. Signed in as{" "}
        {user.displayName}. All times are UTC.
      </p>
      <p className="note">
        Commission is earned on the premium collected on your policies and clawed back on premium refunded to
        a customer. The collected column shows the premium the commission is computed on and, under it, the
        cash the customers actually paid, which also carries the state premium tax and the policy fee. A
        statement marked provisional was produced before its month was over. When a correction lands after a
        month was closed, the closed statement is not rewritten: a new revision is produced, dated, and it
        names the revision it replaces. Both stay readable here.
      </p>

      {runs.length === 0 ? (
        <p className="note">No statement has been produced for you yet.</p>
      ) : (
        <div className="table-scroll" role="region" aria-label="Statements table 1" tabIndex={0}>
<table>
          <thead>
            <tr>
              <th>Month</th>
              <th>Revision</th>
              <th>Knowledge cutoff (UTC)</th>
              <th className="amount">Collected</th>
              <th className="amount">Commission</th>
              <th className="amount">Clawback</th>
              <th className="amount">Net due</th>
              <th>Document</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.runId}>
                <td>
                  <Link href={`/statements/${run.runId}`}>{run.statementMonth}</Link>
                  {run.monthWasStillRunning ? (
                    <>
                      <br />
                      <span className="badge badge-warn">provisional</span>
                    </>
                  ) : null}
                </td>
                <td>
                  {run.revision}
                  {run.identicalToPrevious ? (
                    <>
                      <br />
                      <span className="badge badge-ok">identical to revision {run.revision - 1}</span>
                    </>
                  ) : null}
                </td>
                <td>{run.knowledgeCutoff.toISOString().replace("T", " ").slice(0, 19)}</td>
                <td className="amount">
                  <CollectedCell run={run} />
                </td>
                <td className="amount">{formatCentsAsUsd(run.commissionEarnedCents)}</td>
                <td className="amount">{formatCentsAsUsd(-run.clawbackCents)}</td>
                <td className="amount">{formatCentsAsUsd(run.netDueCents)}</td>
                <td>
                  <Link href={`/api/statements/${run.runId}/pdf`}>PDF</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
</div>
      )}
    </PortalShell>
  );
}

// The collected figures of a run, read according to the format the row says it is in: a v1 run
// stored the cash in the premium column and no commission base at all (migration 0016).
function CollectedCell({ run }: { run: StatementRunRow }) {
  const collected = collectedFigures(run);
  if (collected.premiumCollectedCents === null) {
    return (
      <>
        {formatCentsAsUsd(collected.cashCollectedCents)} cash
        <br />
        <span className="note">format v1: premium not stored</span>
      </>
    );
  }
  return (
    <>
      {formatCentsAsUsd(collected.premiumCollectedCents)} premium
      <br />
      <span className="note">{formatCentsAsUsd(collected.cashCollectedCents)} cash</span>
    </>
  );
}
