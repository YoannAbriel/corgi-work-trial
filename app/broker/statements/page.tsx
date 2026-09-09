import "@/app/styles/money.css";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Chip } from "@/components/detail-layout";
import { PortalShell } from "@/components/portal-shell";
import { About } from "@/components/ui/about";
import { EmptyState } from "@/components/ui/empty";
import { Legend } from "@/components/ui/legend";
import { Stat, Stats } from "@/components/ui/stat";
import { DataTable, ExpandHead, ExpandRow, FactGrid, Num, Primary } from "@/components/ui/table";
import { When } from "@/components/ui/time";
import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { collectedFigures } from "@/lib/statements/compute";
import { listStatementRuns, type StatementRunRow } from "@/lib/statements/read";

// /broker/statements: the broker's own monthly statements, read-only.
//
// A broker never runs a statement and never edits one: the list is filtered by the broker id that
// is attached to the signed-in user, never by an id taken from the URL, so there is no address a
// broker could type to see somebody else's commission. No inspector either: it is a staff tool.

const HOW_MANY_RUNS_SHOWN = 30;

// What the chips of a row mean, said once under the table instead of once per row (round 1,
// MEDIUM: the table had no legend at all).
const STATUS_LEGEND = [
  { term: "provisional", meaning: "produced before its month was over; the run made after the month ends is the next revision" },
  { term: "closed", meaning: "produced after its month was over" },
  { term: "identical", meaning: "the same content hash as the revision before it, so nothing changed" },
  { term: "format v1", meaning: "an old format whose premium column held the cash collected; the commission base was not stored" },
];

export default async function BrokerStatementsPage() {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "broker" || !user.brokerId) {
    return (
      <PortalShell user={user} active="statements" band={{ title: "Statements" }}>
        <div className="notices">
          <p className="error" role="alert">
            This page is the broker journey. Your account has the role &quot;{user.role}&quot;.
          </p>
        </div>
        {user.role === "staff_ops" || user.role === "staff_approver" ? (
          <Link className="button-link" href="/ops/statements" prefetch={false}>
            Broker statements (operations)
          </Link>
        ) : null}
      </PortalShell>
    );
  }

  const runs = await listStatementRuns(sql, { brokerId: user.brokerId, limit: HOW_MANY_RUNS_SHOWN });
  const now = new Date();
  // The broker's own name as the statements themselves record it; the session only carries the
  // person's name, which is not the same thing.
  const brokerName = runs[0]?.brokerName ?? user.displayName;
  const provisional = runs.filter((run) => run.monthWasStillRunning).length;
  // The newest revision's own figure, not a total: adding the net due of several revisions of the
  // same month would count the same money once per revision.
  const latestRun = runs[0] ?? null;
  // The reading order of the table: months newest first, and inside one month its revisions
  // newest first, so the revisions of one month stay together and "identical to revision 1" sits
  // under revision 1 (round 1, MEDIUM). `runs` itself stays in production order for the tile.
  const runsInReadingOrder = [...runs].sort(
    (one, other) => other.statementMonth.localeCompare(one.statementMonth) || other.revision - one.revision,
  );

  return (
    <PortalShell
      user={user}
      active="statements"
      band={{
        title: "Your statements",
        suffix: brokerName,
        meta: (
          <>
            {/* Two chips (cycle 2, decision 1): how many statements there are, and how many of
                them are still provisional. The AF-02 words are in the top bar of every screen. */}
            <Chip tone="neutral">
              {runs.length} {runs.length === 1 ? "statement" : "statements"}
            </Chip>
            {provisional > 0 ? <Chip tone="warn">{provisional} provisional</Chip> : null}
          </>
        ),
      }}
    >
      {/* One tile: the figure a broker opens this screen for. The month and the revision it
          belongs to are the line under it (cycle 2, decision 2). */}
      <Stats>
        <Stat
          label="Net due, latest"
          value={latestRun ? formatCentsAsUsd(latestRun.netDueCents) : "none"}
          tone="accent"
          note={latestRun ? `revision ${latestRun.revision} of ${latestRun.statementMonth}` : "no statement yet"}
          hint="The newest revision's own figure. Revisions of the same month are not added up: each one restates the whole month."
        />
      </Stats>

      {/* Five columns and the fold. When it was produced is a fact of the expansion: at seven
          columns the table was one over what the system allows (round 1, HIGH). */}
      <DataTable ariaLabel="Your statements" legend={<Legend items={STATUS_LEGEND} />}>
        <thead>
          <tr>
            <ExpandHead />
            <th className="nowrap">Month</th>
            <th className="num">Revision</th>
            <th className="num">Commission</th>
            <th className="num">Net due</th>
            <th>Status</th>
          </tr>
        </thead>
        {runs.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={6} className="dt-empty">
                <EmptyState illustration="open-ledger">No statement has been produced for you yet.</EmptyState>
              </td>
            </tr>
          </tbody>
        ) : (
          runsInReadingOrder.map((run) => <StatementRow key={run.runId} run={run} now={now} />)
        )}
      </DataTable>

      <About>
        <h4>How commission is earned</h4>
        <p>
          Commission is earned on the premium collected on your policies and clawed back on premium refunded to a
          customer. The premium figure is what commission is computed on; the cash figure is what the customers
          actually paid, which also carries the state premium tax and the policy fee.
        </p>
        <h4>Provisional</h4>
        <p>A statement marked provisional was produced before its month was over. It stays exactly as it is.</p>
        <h4>Revisions</h4>
        <p>
          When a correction lands after a month was closed, the closed statement is not rewritten: a new revision is
          produced, dated, and it names the revision it replaces. Both stay readable here.
        </p>
        <h4>Who produces them</h4>
        <p>Corgi operations produce every statement. This page is read-only, and it shows your broker only.</p>
      </About>
    </PortalShell>
  );
}

// One statement: the five columns a broker scans, everything else in the expansion, and the PDF
// beside the figures it prints.
function StatementRow({ run, now }: { run: StatementRunRow; now: Date }) {
  const collected = collectedFigures(run);
  return (
    <ExpandRow
      columns={5}
      cells={
        <>
          <Primary href={`/statements/${run.runId}`}>{run.statementMonth}</Primary>
          <Num>{run.revision}</Num>
          <Num>{formatCentsAsUsd(run.commissionEarnedCents)}</Num>
          <Num>{formatCentsAsUsd(run.netDueCents)}</Num>
          {/* One word per chip; the legend under the table says what each one means (round 1,
              HIGH: "identical to revision 4" was a four word sentence inside a chip). */}
          <td>
            {run.monthWasStillRunning ? <Chip tone="warn">provisional</Chip> : <Chip tone="neutral">closed</Chip>}
            {run.identicalToPrevious ? (
              <span title={`The same content hash as revision ${run.revision - 1}`}>
                <Chip tone="ok">identical</Chip>
              </span>
            ) : null}
          </td>
        </>
      }
    >
      <FactGrid
        items={[
          { label: "Produced", value: `${utc(run.createdAt)} UTC` },
          { label: "Knowledge cutoff", value: `${utc(run.knowledgeCutoff)} UTC` },
          {
            label: "Premium collected, the commission base",
            value:
              collected.premiumCollectedCents === null
                ? "not stored on this revision"
                : formatCentsAsUsd(collected.premiumCollectedCents),
          },
          { label: "Cash collected from customers", value: formatCentsAsUsd(collected.cashCollectedCents) },
          { label: "Commission clawed back", value: formatCentsAsUsd(-run.clawbackCents) },
          ...(run.adjustmentCents === 0 ? [] : [{ label: "Other adjustments", value: formatCentsAsUsd(run.adjustmentCents) }]),
          // A chip, defined once in the legend: the same 34-word paragraph on three rows was a
          // wall of repeated text (round 1, MEDIUM).
          ...(collected.formatNote ? [{ label: "Format", value: <Chip tone="warn">format v1</Chip> }] : []),
          {
            label: "Document",
            value: (
              <Link
                href={`/api/statements/${run.runId}/pdf`}
                prefetch={false}
                // The route serves the PDF inline, so following it in this tab replaces the
                // page the broker was reading. A generated document opens beside it instead.
                target="_blank"
                rel="noopener"
              >
                Download the PDF
              </Link>
            ),
          },
        ]}
      />
    </ExpandRow>
  );
}

function utc(instant: Date): string {
  return instant.toISOString().replace("T", " ").slice(0, 19);
}
