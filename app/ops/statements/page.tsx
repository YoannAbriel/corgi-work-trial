import { PortalShell } from "@/components/portal-shell";
import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { collectedFigures } from "@/lib/statements/compute";
import { brokersForStatements, listStatementRuns, type StatementRunRow } from "@/lib/statements/read";

// /ops/statements: run a broker's monthly statement, and read every run ever made.
//
// Staff only. Nothing on this page computes money in the browser: the figures are the ones the
// runs stored, rendered on the server, and the only button posts to a route handler.
//
// The two dates are the whole point of the screen and are shown on every row:
//   the MONTH is the business month the entries belong to (their effective date);
//   the KNOWLEDGE CUTOFF is the instant up to which the ledger was read.
// Running the same month again with the same cutoff produces the same content hash, which the
// list shows as "identical to the previous revision".

const HOW_MANY_RUNS_SHOWN = 30;

export default async function OpsStatementsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ran?: string }>;
}) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "staff_ops" && user.role !== "staff_approver") {
    redirect("/broker");
  }

  const [brokers, runs, query] = await Promise.all([
    brokersForStatements(sql),
    listStatementRuns(sql, { limit: HOW_MANY_RUNS_SHOWN }),
    searchParams,
  ]);

  return (
    <PortalShell user={user} active="statements">

      <h1>Broker statements</h1>
      <p className="lead">
        A statement is one broker&apos;s commission account for one calendar month, read from the journal and
        frozen. Signed in as {user.displayName} ({user.role}). All times are UTC.
      </p>
      <p className="note">
        Every figure below is a movement of a ledger account. Two collected figures are shown, because they
        answer two questions: the CASH is what the customers paid (premium, tax and fee) and the PREMIUM is the
        part of it commission is earned on. Commission earned and clawbacks are the movements of the
        broker&apos;s commission payable account, and the net due is the sum of those movements for the month.
        A run made before the month is over is marked provisional and stays exactly as it is; running the month
        again stores a new revision that names the one it replaces.
      </p>

      {query.error ? <p className="error" role="alert">{query.error}</p> : null}
      {query.ran ? <p className="note">{query.ran}</p> : null}

      <section className="card-block">
        <h2>Run a statement</h2>
        <p className="note">
          Leave the knowledge cutoff empty for a fresh close, which reads everything the ledger knows right
          now. Fill it with the cutoff of an earlier revision to reproduce that revision: the run is stored
          again (a re-run is evidence) and is flagged as identical when its content hash matches.
        </p>
        <form method="post" action="/api/statements/run" className="card">
          <label htmlFor="brokerId">Broker</label>
          <select id="brokerId" name="brokerId" defaultValue={brokers[0]?.brokerId ?? ""}>
            {brokers.map((broker) => (
              <option key={broker.brokerId} value={broker.brokerId}>
                {broker.name}
              </option>
            ))}
          </select>

          <label htmlFor="month">Month (business dates)</label>
          <input id="month" name="month" type="month" placeholder="2028-03" required />

          <label htmlFor="knowledgeCutoff">Knowledge cutoff (UTC instant, optional)</label>
          <input id="knowledgeCutoff" name="knowledgeCutoff" type="text" placeholder="2028-04-01T00:00:00Z" />

          <button type="submit">Run the statement</button>
        </form>
      </section>

      <h2>Runs</h2>
      {runs.length === 0 ? (
        <p className="note">No statement has ever been run. Pick a broker and a month above.</p>
      ) : (
        <RunTable runs={runs} />
      )}
    </PortalShell>
  );
}

function RunTable({ runs }: { runs: StatementRunRow[] }) {
  return (
    <div className="table-scroll" role="region" aria-label="Statements table 1" tabIndex={0}>
<table>
      <thead>
        <tr>
          <th>Month</th>
          <th>Broker</th>
          <th>Revision</th>
          <th>Knowledge cutoff (UTC)</th>
          <th className="amount">Collected</th>
          <th className="amount">Commission</th>
          <th className="amount">Clawback</th>
          <th className="amount">Net due</th>
          <th>Content hash</th>
          <th>Run by</th>
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
            <td>{run.brokerName}</td>
            <td>
              {run.revision}
              {run.identicalToPrevious ? (
                <>
                  <br />
                  <span className="badge badge-ok">identical to revision {run.revision - 1}</span>
                </>
              ) : null}
              {run.previousCanonicalVersion !== null && run.previousCanonicalVersion !== run.canonicalVersion ? (
                <>
                  <br />
                  <span className="badge badge-warn">format changed, not comparable by hash</span>
                </>
              ) : null}
              {run.supersedesRunId ? (
                <>
                  <br />
                  <Link href={`/statements/${run.supersedesRunId}`} className="note">
                    previous revision
                  </Link>
                </>
              ) : null}
            </td>
            <td>{utc(run.knowledgeCutoff)}</td>
            <td className="amount">
              <CollectedCell run={run} />
            </td>
            <td className="amount">{formatCentsAsUsd(run.commissionEarnedCents)}</td>
            <td className="amount">{formatCentsAsUsd(-run.clawbackCents)}</td>
            <td className="amount">{formatCentsAsUsd(run.netDueCents)}</td>
            <td>
              <code>{run.contentHash.slice(0, 12)}</code>
            </td>
            <td>{run.runByName ?? <span className="note">no signed-in user</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
</div>
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

function utc(instant: Date): string {
  return instant.toISOString().replace("T", " ").slice(0, 19);
}
