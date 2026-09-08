import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { listStatementRuns } from "@/lib/statements/read";

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
      <main>
        <h1>Statements</h1>
        <p className="error">
          This page is the broker journey. Your account has the role &quot;{user.role}&quot;.
        </p>
        {user.role === "staff_ops" || user.role === "staff_approver" ? (
          <p>
            <Link href="/ops/statements">Broker statements (operations)</Link>
          </p>
        ) : null}
      </main>
    );
  }

  const runs = await listStatementRuns(sql, { brokerId: user.brokerId, limit: HOW_MANY_RUNS_SHOWN });

  return (
    <main>
      <p className="note">
        <Link href="/broker">Broker workspace</Link>
      </p>

      <h1>Your statements</h1>
      <p className="lead">
        One statement per month, produced by Corgi operations and frozen when it is produced. Signed in as{" "}
        {user.displayName}. All times are UTC.
      </p>
      <p className="note">
        Commission is earned on the premium collected on your policies and clawed back on premium refunded to
        a customer. When a correction lands after a month was closed, the closed statement is not rewritten: a
        new revision is produced, dated, and it names the revision it replaces. Both stay readable here.
      </p>

      {runs.length === 0 ? (
        <p className="note">No statement has been produced for you yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th>Revision</th>
              <th>Knowledge cutoff (UTC)</th>
              <th className="amount">Premium collected</th>
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
                <td className="amount">{formatCentsAsUsd(run.premiumCollectedCents)}</td>
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
      )}
    </main>
  );
}
