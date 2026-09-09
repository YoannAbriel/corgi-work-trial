import { PortalShell } from "@/components/portal-shell";
import { Disclosure } from "@/components/disclosures";
import { Chip, DetailHeading, Empty, Panel } from "@/components/detail-layout";
import { IllustrationBanner } from "@/components/decorative-illustration";
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
      <DetailHeading
        title="Your statements"
        lead="One statement per month, produced by Corgi operations and frozen when it is produced. All times are UTC."
        chips={<Chip tone="neutral">{runs.length} {runs.length === 1 ? "statement" : "statements"}</Chip>}
      />

      <Panel title="Statements" className="list-panel">
      {runs.length === 0 ? (
        <Empty illustration="open-ledger">No statement has been produced for you yet.</Empty>
      ) : (
        <div className="table-scroll" role="region" aria-label="Your statements" tabIndex={0}>
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
                      <Chip tone="warn">provisional</Chip>
                    </>
                  ) : null}
                </td>
                <td>
                  {run.revision}
                  {run.identicalToPrevious ? (
                    <>
                      <br />
                      <Chip tone="ok">identical to revision {run.revision - 1}</Chip>
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
                  <Link href={`/statements/${run.runId}`} className="button-link secondary small">Open</Link>{" "}
                  <Link href={`/api/statements/${run.runId}/pdf`} className="button-link secondary small">PDF</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
</div>
      )}
      <Disclosure>
        <p>
          Commission is earned on the premium collected on your policies and clawed back on premium refunded to a
          customer. The collected column shows the premium the commission is computed on and, under it, the cash the
          customers actually paid, which also carries the state premium tax and the policy fee. A statement marked
          provisional was produced before its month was over. When a correction lands after a month was closed, the
          closed statement is not rewritten: a new revision is produced, dated, and it names the revision it replaces.
          Both stay readable here.
        </p>
      </Disclosure>
      </Panel>
      <IllustrationBanner
        name="plant-care"
        title={<>Records that <em>grow with the month.</em></>}
      >
        Each revision stays readable, with the figures and cutoff that produced it.
      </IllustrationBanner>
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
