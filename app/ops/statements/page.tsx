import "@/app/styles/money.css";
import { redirect } from "next/navigation";
import { Chip } from "@/components/detail-layout";
import { SandboxReferences } from "@/components/disclosures";
import { PortalShell } from "@/components/portal-shell";
import { EarlierRevisions } from "@/components/statement-revisions";
import { About } from "@/components/ui/about";
import { EmptyState } from "@/components/ui/empty";
import { Legend } from "@/components/ui/legend";
import { Stat, Stats } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable, ExpandHead, ExpandRow, FactGrid, Num, Primary } from "@/components/ui/table";
import { When } from "@/components/ui/time";
import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { collectedFigures } from "@/lib/statements/compute";
import { groupRunsByBrokerAndMonth, type StatementMonthGroup } from "@/lib/statements/group-runs";
import { brokersForStatements, listStatementRuns } from "@/lib/statements/read";
import { toastsFromQuery, type Query } from "@/lib/ui/views";

// /ops/statements: run a broker's monthly statement, and read every run ever made.
//
// ONE ROW PER BROKER AND MONTH since 2026-09-09 evening (Yoann): the row is the newest revision
// of that month and the revisions it replaced are folded under it. Every run is still on the
// screen; five rows that only differed by a revision number were not five things to read.
//
// Staff only. Nothing on this page computes money in the browser: the figures are the ones the
// runs stored, rendered on the server, and the only button posts to a route handler.
//
// The two dates are the whole point of the screen:
//   the MONTH is the business month the entries belong to (their effective date);
//   the KNOWLEDGE CUTOFF is the instant up to which the ledger was read.
// Running the same month again with the same cutoff produces the same content hash, which the
// list shows as "identical to the previous revision".

const HOW_MANY_RUNS_SHOWN = 30;

// What the two chips of a row mean, said once under the table instead of once per row.
const STATUS_LEGEND = [
  { term: "provisional", meaning: "produced before its month was over; a run made after the month ends is the next revision" },
  { term: "identical", meaning: "the same content hash as the revision before it, so nothing changed" },
  { term: "format changed", meaning: "written in a newer statement format than the revision before it, so the two hashes cannot be compared" },
  { term: "format v1", meaning: "an old format whose premium column held the cash collected; the commission base was not stored" },
];

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

  // One row per broker and month, showing its newest revision, the ones it replaced folded under
  // it (Yoann, 2026-09-09 evening). The order across rows is still by age only, newest first: the
  // month somebody has just run is the first row, whoever the broker is. Not by month, because a
  // rerun of an old month is newer than the first run of a later month.
  const months = groupRunsByBrokerAndMonth(runs);
  // Counted on the rows the table shows, so the tile and the table say the same thing: how many
  // months are STILL provisional, that is whose newest revision was produced before the month was
  // over. A provisional revision that has since been superseded is history, not a thing to act on.
  const provisional = months.filter((month) => month.latest.monthWasStillRunning).length;
  // `runs` arrives newest first, so the first row carries the most recent month produced.
  const latestMonth = runs[0]?.statementMonth ?? "none";

  // No `ran` rule: no route sends that parameter to this screen (feedback audit of 2026-09-09).
  const toasts = toastsFromQuery(query, {
    error: { tone: "error", title: "Refused" },
  });

  return (
    <PortalShell
      user={user}
      active="statements"
      toasts={toasts}
      band={{
        title: "Broker statements",
        // No chip on a list screen (Yoann, 2026-09-09): what is provisional is the first tile,
        // and every row says it again for itself.
      }}
    >
      {query.error ? (
        <div className="notices">
          <p className="error" role="alert">
            {typeof query.error === "string" ? query.error : query.error[0]}
          </p>
        </div>
      ) : null}

      {/* Two figures (cycle 2, decision 2): what is still provisional, and the newest month that
          has been produced at all. How many runs and how many brokers are counts of records. */}
      <Stats>
        <Stat
          label="Provisional"
          value={provisional}
          tone={provisional > 0 ? "warn" : "ok"}
          note="months whose newest revision is provisional"
          hint="A provisional run stays as it is. The run made after the month ends is the next revision and the definitive one."
        />
        <Stat label="Latest month" value={latestMonth} note="business month of the newest run" />
      </Stats>

      {/* The table and the form that feeds it, side by side (round 1, MEDIUM: the form was a whole
          view holding one small card in a 1450 px row). */}
      <div className="layout-2">
        {/* The cap said out loud (review finding F-ST-02): the rows are built from the 30 runs
            this page read, so "5 earlier" is a count of that window and not of the month's whole
            history. Widening the query is a reader change and is not tonight's work. */}
        <DataTable
          ariaLabel="Statement runs"
          legend={<Legend items={STATUS_LEGEND} />}
          footer={
            <p className="money-cap">
              This table reads the {HOW_MANY_RUNS_SHOWN} most recent runs. Earlier revisions of a month beyond them
              are not counted here; each run page names the revision it supersedes.
            </p>
          }
        >
          <thead>
            <tr>
              <ExpandHead />
              <th>Broker</th>
              <th className="nowrap">Month</th>
              <th className="num">Revision</th>
              <th className="num">Net due</th>
              <th>Status</th>
            </tr>
          </thead>
          {runs.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={6} className="dt-empty">
                  <EmptyState illustration="open-ledger" action={undefined}>
                    No statement has ever been run. Pick a broker and a month beside this table.
                  </EmptyState>
                </td>
              </tr>
            </tbody>
          ) : (
            months.map((month) => <MonthRow key={month.latest.runId} month={month} now={now} />)
          )}
        </DataTable>

        <div className="card">
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

            {/* The month field is a native month picker, which draws its own empty value: a
                placeholder attribute does nothing on it and left the field looking broken, so the
                format is in the label (round 1, MEDIUM). */}
            <label htmlFor="month">Month, business dates, as 2028-03</label>
            <input id="month" name="month" type="month" required />

            <label htmlFor="knowledgeCutoff">Knowledge cutoff (UTC, optional)</label>
            <input id="knowledgeCutoff" name="knowledgeCutoff" type="text" placeholder="2028-04-01T00:00:00Z" />

            <SubmitButton className="orange">Run the statement</SubmitButton>
          </form>
          <p className="note">Leave the cutoff empty for a fresh close. See About for what the cutoff decides.</p>
        </div>
      </div>

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
        <h4>One row per broker and month</h4>
        <p>
          Each row is the newest revision of one broker&rsquo;s month, and the revisions it replaced are inside its
          fold, newest first, each one a link to the run it was, with the same chips it would carry as a row. The rows
          are ordered by the age of the revision they show, so the month somebody has just run is the first row. The
          fold holds the revisions inside the {HOW_MANY_RUNS_SHOWN} runs this page reads and no more: on an old month
          it can be fewer than the month has, and the way past that window is the run page of a revision, which names
          the one it supersedes.
        </p>
      </About>
    </PortalShell>
  );
}

// One broker and one month: the five columns an operator scans, read off the NEWEST revision of
// that month, with every stored figure of that revision in the expansion and the revisions it
// replaced listed under them. The broker cell is the link, stretched over the whole row by the
// system stylesheet, so a click anywhere but the chevron opens the newest run. When it was
// produced is the line under the broker name, not a column: the table has to fit six cells
// (round 1, HIGH on the broker's own list).
function MonthRow({ month, now }: { month: StatementMonthGroup; now: Date }) {
  const run = month.latest;
  const collected = collectedFigures(run);
  return (
    <ExpandRow
      columns={5}
      cells={
        <>
          <Primary href={`/statements/${run.runId}`} sub={<When instant={run.createdAt} now={now} />}>
            {run.brokerName}
          </Primary>
          <td className="nowrap">{run.statementMonth}</td>
          {/* The revision this row shows, and how many earlier ones the fold holds: without that
              count the fold looks like the ordinary row detail and the history stays hidden.
              "shown" and not "earlier" (review finding F-ST-02): it counts the revisions inside
              the 30 run window this page read, which on an old month can be fewer than the month
              has. The sentence under the table says so in full. */}
          <Num sub={month.earlier.length === 0 ? undefined : `${month.earlier.length} earlier shown`}>
            {run.revision}
          </Num>
          <Num>{formatCentsAsUsd(run.netDueCents)}</Num>
          {/* One word per chip; the legend under the table says what each one means (cycle 2,
              decision 7 and round 1, HIGH: "identical to revision 4" was a sentence in a chip). */}
          <td>
            {run.monthWasStillRunning ? <Chip tone="warn">provisional</Chip> : <Chip tone="neutral">closed</Chip>}
            {run.identicalToPrevious ? (
              <span title={`The same content hash as revision ${run.revision - 1}`}>
                <Chip tone="ok">identical</Chip>
              </span>
            ) : null}
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
          { label: "Produced", value: `${utc(run.createdAt)} UTC${run.runByName ? `, ${run.runByName}` : ""}` },
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
          // A chip, defined once in the legend: the same 34-word paragraph on every old row was a
          // wall of repeated text (round 1, MEDIUM).
          ...(collected.formatNote ? [{ label: "Format", value: <Chip tone="warn">format v1</Chip> }] : []),
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
      <EarlierRevisions revisions={month.earlier} now={now} windowSize={HOW_MANY_RUNS_SHOWN} />
    </ExpandRow>
  );
}

function utc(instant: Date): string {
  return instant.toISOString().replace("T", " ").slice(0, 19);
}
