import "@/app/styles/ops-tables.css";
import { PortalShell } from "@/components/portal-shell";
import { Disclosure, SandboxReferences } from "@/components/disclosures";
import { Chip, DetailGrid, DetailHeading, Empty, Panel } from "@/components/detail-layout";
import { IllustrationBanner } from "@/components/decorative-illustration";
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

  const notices = [
    query.error ? <p key="error" className="error" role="alert">{query.error}</p> : null,
    query.ran ? <p key="ran" className="note">{query.ran}</p> : null,
  ].filter(Boolean);
  const provisional = runs.filter((run) => run.monthWasStillRunning).length;

  return (
    <PortalShell user={user} active="statements">
      <DetailHeading
        title="Broker statements"
        lead="A statement is one broker's commission account for one calendar month, read from the journal and frozen. All times are UTC."
        chips={
          <>
            <Chip tone="neutral">{runs.length} {runs.length === 1 ? "run" : "runs"} shown</Chip>
            {provisional > 0 ? <Chip tone="warn">{provisional} provisional</Chip> : null}
          </>
        }
      />

      {notices.length > 0 ? <div className="notices">{notices}</div> : null}

      {/* UI-013: ten columns, four of them money, cannot be read in the 736 px left-hand card of
          the two-column grid. The page stacks and the generator moves ABOVE the list: it is the
          form that produces the rows below it, so it reads better first than thirty rows down. */}
      <div className="ops-stacked ops-aside-first">
      <DetailGrid
        main={
          <Panel title="Runs" className="list-panel">
            {runs.length === 0 ? <Empty illustration="open-ledger">No statement has ever been run. Pick a broker and a month.</Empty> : <RunTable runs={runs} />}
            <Disclosure>
              <p>
                Every figure is a movement of a ledger account. Two collected figures are shown, because they answer
                two questions: the CASH is what the customers paid (premium, tax and fee) and the PREMIUM is the part
                of it commission is earned on. Commission earned and clawbacks are the movements of the broker&apos;s
                commission payable account, and the net due is the sum of those movements for the month. A run made
                before the month is over is marked provisional and stays exactly as it is; running the month again
                stores a new revision that names the one it replaces.
              </p>
              <p>
                The two dates are the whole point of the screen: the <strong>month</strong> is the business month the
                entries belong to (their effective date), and the <strong>knowledge cutoff</strong> is the instant up
                to which the ledger was read. Running the same month again with the same cutoff produces the same
                content hash, which the list shows as identical to the previous revision.
              </p>
            </Disclosure>
          </Panel>
        }
        aside={
          <Panel title="Run a statement">
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

              <button type="submit" className="orange">Run the statement</button>
            </form>
            <p className="note">
              Leave the knowledge cutoff empty for a fresh close, which reads everything the ledger knows right now.
              Fill it with the cutoff of an earlier revision to reproduce that revision: the run is stored again (a
              re-run is evidence) and is flagged as identical when its content hash matches.
            </p>
          </Panel>
        }
      />
      </div>
      <IllustrationBanner
        name="plant-care"
        title={<>Records that <em>grow with the month.</em></>}
      >
        Each run remains available with the exact figures and knowledge cutoff that produced it.
      </IllustrationBanner>
    </PortalShell>
  );
}

function RunTable({ runs }: { runs: StatementRunRow[] }) {
  return (
    <div className="table-scroll" role="region" aria-label="Statements table 1" tabIndex={0}>
<table className="ops-table">
      <thead>
        <tr>
          <th className="col-name">Month</th>
          <th className="col-name">Broker</th>
          <th className="col-label">Revision</th>
          <th className="col-when">Knowledge cutoff (UTC)</th>
          <th className="amount">Collected</th>
          <th className="amount">Commission</th>
          <th className="amount">Clawback</th>
          <th className="amount">Net due</th>
          <th className="col-name">Run by</th>
          <th className="col-open"></th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.runId}>
            <td className="col-name">
              <Link href={`/statements/${run.runId}`}>{run.statementMonth}</Link>
              {/* The run id and the content hash are the evidence a reviewer reproduces a
                  revision with; they are not what an operator reads down the column. */}
              <SandboxReferences
                references={[
                  { label: "Statement run id", value: run.runId },
                  { label: "Content hash", value: run.contentHash },
                  { label: "Canonical format version", value: String(run.canonicalVersion) },
                ]}
              />
              {run.monthWasStillRunning ? (
                <>
                  <br />
                  <Chip tone="warn">provisional</Chip>
                </>
              ) : null}
            </td>
            <td className="col-name">{run.brokerName}</td>
            <td className="col-label">
              {run.revision}
              {run.identicalToPrevious ? (
                <>
                  <br />
                  <Chip tone="ok">identical to revision {run.revision - 1}</Chip>
                </>
              ) : null}
              {run.previousCanonicalVersion !== null && run.previousCanonicalVersion !== run.canonicalVersion ? (
                <>
                  <br />
                  <Chip tone="neutral">format changed, not comparable by hash</Chip>
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
            <td className="col-when">{utc(run.knowledgeCutoff)}</td>
            <td className="amount">
              <CollectedCell run={run} />
            </td>
            <td className="amount">{formatCentsAsUsd(run.commissionEarnedCents)}</td>
            <td className="amount">{formatCentsAsUsd(-run.clawbackCents)}</td>
            <td className="amount">{formatCentsAsUsd(run.netDueCents)}</td>
            <td className="col-name">{run.runByName ?? <span className="note">no signed-in user</span>}</td>
            <td className="col-open">
              <Link href={`/statements/${run.runId}`} className="button-link secondary small">Open</Link>
            </td>
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
