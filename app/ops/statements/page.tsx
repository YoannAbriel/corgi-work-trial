import "@/app/styles/money.css";
import { redirect } from "next/navigation";
import { Chip } from "@/components/detail-layout";
import { SandboxReferences } from "@/components/disclosures";
import { PortalShell } from "@/components/portal-shell";
import { About } from "@/components/ui/about";
import { EmptyState } from "@/components/ui/empty";
import { Stat, Stats } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable, ExpandHead, ExpandRow, FactGrid, Num, Primary } from "@/components/ui/table";
import { When } from "@/components/ui/time";
import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { collectedFigures } from "@/lib/statements/compute";
import { brokersForStatements, listStatementRuns, type StatementRunRow } from "@/lib/statements/read";
import { pickView, toastsFromQuery, withParams, type Query } from "@/lib/ui/views";

// /ops/statements: run a broker's monthly statement, and read every run ever made.
//
// Staff only. Nothing on this page computes money in the browser: the figures are the ones the
// runs stored, rendered on the server, and the only button posts to a route handler.
//
// The two dates are the whole point of the screen:
//   the MONTH is the business month the entries belong to (their effective date);
//   the KNOWLEDGE CUTOFF is the instant up to which the ledger was read.
// Running the same month again with the same cutoff produces the same content hash, which the
// list shows as "identical to the previous revision".

const PATH = "/ops/statements";
const VIEWS = ["runs", "new"] as const;
const HOW_MANY_RUNS_SHOWN = 30;

export default async function OpsStatementsPage({ searchParams }: { searchParams: Promise<Query> }) {
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
  const now = new Date();

  const view = pickView(query.view, VIEWS);
  const provisional = runs.filter((run) => run.monthWasStillRunning).length;
  const brokersWithARun = new Set(runs.map((run) => run.brokerId)).size;
  // `runs` arrives newest first, so the first row carries the most recent month produced.
  const latestMonth = runs[0]?.statementMonth ?? "none";

  const toasts = toastsFromQuery(query, {
    error: { tone: "error", title: "Refused" },
    ran: { tone: "ok", title: "Statement produced" },
  });

  const views = VIEWS.map((one) => ({
    key: one,
    label: one === "runs" ? "Runs" : "New statement",
    href: withParams(PATH, query, { view: one }),
    current: one === view,
    count: one === "runs" ? runs.length : undefined,
  }));

  return (
    <PortalShell
      user={user}
      active="statements"
      views={views}
      toasts={toasts}
      band={{
        title: "Broker statements",
        suffix: `${runs.length} ${runs.length === 1 ? "run" : "runs"} shown`,
        meta: (
          <>
            {provisional > 0 ? <Chip tone="warn">{provisional} provisional</Chip> : <Chip tone="ok">none provisional</Chip>}
            {/* Every movement on a statement is premium collected, commission on it, a clawback or
                a refund, and all four are Stripe money: the slot is named here in the same words
                as the reconciliation screen (AF-02, review finding F-B13-34). */}
            <Chip tone="ok">Stripe: LIVE SANDBOX</Chip>
          </>
        ),
      }}
    >
      {query.error ? (
        <div className="notices">
          <p className="error" role="alert">
            {typeof query.error === "string" ? query.error : query.error[0]}
          </p>
        </div>
      ) : null}

      {view === "runs" ? (
        <>
          <Stats>
            <Stat label="Runs" value={runs.length} note={`newest ${HOW_MANY_RUNS_SHOWN}`} />
            <Stat label="Brokers" value={brokersWithARun} note={`of ${brokers.length} with a commission account`} />
            <Stat label="Latest month" value={latestMonth} note="business month of the newest run" />
            <Stat
              label="Provisional"
              value={provisional}
              tone={provisional > 0 ? "warn" : "ok"}
              note="produced before the month was over"
            />
          </Stats>

          <DataTable ariaLabel="Statement runs">
            <thead>
              <tr>
                <ExpandHead />
                <th>Broker</th>
                <th className="nowrap">Month</th>
                <th className="num">Revision</th>
                <th className="num">Net due</th>
                <th className="nowrap">Produced</th>
                <th>Status</th>
              </tr>
            </thead>
            {runs.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={7} className="dt-empty">
                    <EmptyState illustration="open-ledger" action={undefined}>
                      No statement has ever been run. Open New statement and pick a broker.
                    </EmptyState>
                  </td>
                </tr>
              </tbody>
            ) : (
              runs.map((run) => <RunRow key={run.runId} run={run} now={now} />)
            )}
          </DataTable>
        </>
      ) : null}

      {view === "new" ? (
        <div className="card money-form-card">
          <h2>Run a statement</h2>
          {/* Same action, same three field names as before; only the button became a SubmitButton
              (F-YA-09), so a slow close shows it is working instead of inviting a second press. */}
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

            <label htmlFor="knowledgeCutoff">Knowledge cutoff (UTC, optional)</label>
            <input id="knowledgeCutoff" name="knowledgeCutoff" type="text" placeholder="2028-04-01T00:00:00Z" />

            <SubmitButton className="orange">Run the statement</SubmitButton>
          </form>
          <p className="note">Leave the cutoff empty for a fresh close. See About for what the cutoff decides.</p>
        </div>
      ) : null}

      <About>
        <h4>What a statement is</h4>
        <p>
          One broker&rsquo;s commission account for one calendar month, read from the journal and frozen. Every figure
          is a movement of a ledger account; nothing on this screen is computed in the browser.
        </p>
        <h4>The two dates</h4>
        <p>
          The <strong>month</strong> is the business month the entries belong to, by effective date. The{" "}
          <strong>knowledge cutoff</strong> is the instant up to which the ledger was read. Running the same month
          again with the same cutoff produces the same content hash, which the list shows as identical to the previous
          revision.
        </p>
        <h4>The cutoff of a new run</h4>
        <p>
          Leave the knowledge cutoff empty for a fresh close, which reads everything the ledger knows right now. Fill
          it with the cutoff of an earlier revision to reproduce that revision: the run is stored again, because a
          re-run is evidence, and is flagged as identical when its content hash matches.
        </p>
        <h4>The two collected figures</h4>
        <p>
          They answer two questions. The cash is what the customers paid, premium plus state premium tax plus policy
          fee. The premium is the part of it commission is earned on. Commission earned and clawbacks are the movements
          of the broker&rsquo;s commission payable account, and the net due is the sum of those movements for the
          month.
        </p>
        <h4>Provisional and revisions</h4>
        <p>
          A run made before the month is over is marked provisional and stays exactly as it is. Running the month again
          stores a new revision that names the one it replaces. Nothing is rewritten, so both stay readable.
        </p>
      </About>
    </PortalShell>
  );
}

// One run: the six columns an operator scans, and every stored figure in the expansion. The broker
// cell is the link, stretched over the whole row by the system stylesheet, so a click anywhere but
// the chevron opens the run.
function RunRow({ run, now }: { run: StatementRunRow; now: Date }) {
  const collected = collectedFigures(run);
  return (
    <ExpandRow
      columns={6}
      cells={
        <>
          <Primary href={`/statements/${run.runId}`}>{run.brokerName}</Primary>
          <td className="nowrap">{run.statementMonth}</td>
          <Num>{run.revision}</Num>
          <Num>{formatCentsAsUsd(run.netDueCents)}</Num>
          <td className="nowrap">
            <When instant={run.createdAt} now={now} />
            <span className="dt-sub">{run.runByName ?? "no signed-in user"}</span>
          </td>
          <td>
            {run.monthWasStillRunning ? <Chip tone="warn">provisional</Chip> : <Chip tone="neutral">closed</Chip>}
            {run.identicalToPrevious ? <Chip tone="ok">identical to revision {run.revision - 1}</Chip> : null}
            {/* Two revisions written in different formats hash different texts, so neither
                "identical" nor "changed" is an answer about them (review finding F-B9-09). */}
            {run.previousCanonicalVersion !== null && run.previousCanonicalVersion !== run.canonicalVersion ? (
              <Chip tone="neutral">format changed</Chip>
            ) : null}
          </td>
        </>
      }
    >
      <FactGrid
        items={[
          { label: "Knowledge cutoff", value: `${utc(run.knowledgeCutoff)} UTC` },
          {
            label: "Premium collected, the commission base",
            value:
              collected.premiumCollectedCents === null
                ? "not stored on this revision"
                : formatCentsAsUsd(collected.premiumCollectedCents),
          },
          { label: "Cash collected from customers", value: formatCentsAsUsd(collected.cashCollectedCents) },
          { label: "Commission earned", value: formatCentsAsUsd(run.commissionEarnedCents) },
          { label: "Commission clawed back", value: formatCentsAsUsd(-run.clawbackCents) },
          ...(run.adjustmentCents === 0 ? [] : [{ label: "Other adjustments", value: formatCentsAsUsd(run.adjustmentCents) }]),
          { label: "Net due to the broker", value: formatCentsAsUsd(run.netDueCents) },
          ...(collected.formatNote ? [{ label: "Format", value: collected.formatNote }] : []),
          {
            label: "References",
            value: (
              <SandboxReferences
                inline
                references={[
                  { label: "Statement run id", value: run.runId },
                  { label: "Content hash", value: run.contentHash },
                  { label: "Canonical format version", value: String(run.canonicalVersion) },
                  { label: "Supersedes run id", value: run.supersedesRunId },
                ]}
              />
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
