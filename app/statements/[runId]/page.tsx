import "@/app/styles/money.css";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Download } from "lucide-react";
import { AmountExplained } from "@/components/amount-explained";
import { Chip } from "@/components/detail-layout";
import { SandboxReferences } from "@/components/disclosures";
import { PortalShell } from "@/components/portal-shell";
import { About } from "@/components/ui/about";
import { EmptyState } from "@/components/ui/empty";
import { Stat, Stats } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable, ExpandHead, ExpandRow, FactGrid, MoreRows, Num } from "@/components/ui/table";
import { When } from "@/components/ui/time";
import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/http/path-ids";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { explainStatementTotal } from "@/lib/money/explain";
import { STATEMENT_VERSIONS_WITH_KNOWN_TOTALS, collectedFigures } from "@/lib/statements/compute";
import { commissionPayableMovementCents } from "@/lib/statements/journal";
import {
  changesAgainstPrevious,
  statementRun,
  type RevisionChange,
  type StatementLineRow,
  type StatementRunRow,
} from "@/lib/statements/read";
import { firstValue, toastsFromQuery, withParams, type Query } from "@/lib/ui/views";

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

const KIND_LABEL: Record<StatementLineRow["kind"], string> = {
  premium_collected: "Premium collected",
  commission_earned: "Commission earned",
  clawback: "Commission clawback",
  refund: "Refund to customer",
  adjustment: "Adjustment",
};

// A long month is bounded on the screen and says how many there are, rather than dropping
// movements in silence; ?all=1 asks for the rest.
const HOW_MANY_MOVEMENTS_ON_ONE_PAGE = 50;

export default async function StatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<Query>;
}) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  const { runId } = await params;
  // A malformed id is a wrong address, not a server error: it must not reach the uuid column.
  if (!isUuid(runId)) {
    notFound();
  }

  const statement = await statementRun(sql, runId);
  if (!statement) {
    notFound();
  }
  const isStaff = user.role === "staff_ops" || user.role === "staff_approver";
  const isOwningBroker = user.role === "broker" && user.brokerId === statement.run.brokerId;
  const listHref = isStaff ? "/ops/statements" : "/broker/statements";
  if (!isStaff && !isOwningBroker) {
    return (
      <PortalShell
        user={user}
        active="statements"
        trail={[{ label: "Statements", href: listHref }, { label: "Statement detail" }]}
        band={{ title: "Broker statement" }}
      >
        <div className="notices">
          <p className="error" role="alert">
            This statement belongs to another broker.
          </p>
        </div>
      </PortalShell>
    );
  }

  const { run, lines } = statement;
  const query = await searchParams;
  const now = new Date();
  const showAll = firstValue(query.all) === "1";
  const movementsOnThePage = showAll ? lines : lines.slice(0, HOW_MANY_MOVEMENTS_ON_ONE_PAGE);

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
  const collected = collectedFigures(run);
  // Two revisions written in different formats hash different texts, so neither "identical" nor
  // "changed" is an answer about them (review finding F-B9-09).
  const formatChanged = run.previousCanonicalVersion !== null && run.previousCanonicalVersion !== run.canonicalVersion;
  // Slice B12-2: a fold under a total is only offered on a run written in EXACTLY the format the
  // explainer knows. On a v1 run the stored columns meant something else, and explaining a figure
  // with the wrong meaning would be worse than not explaining it. The comparison is an equality
  // and not ">=" (review finding F-B12-06): a future v3 that redefined a column would otherwise be
  // explained with v2 semantics, and the rule behind F-B9-09 is that a column never changes
  // meaning.
  const explainable = (STATEMENT_VERSIONS_WITH_KNOWN_TOTALS as readonly number[]).includes(run.canonicalVersion);
  const totalsForExplanation = {
    lines,
    commissionEarnedCents: run.commissionEarnedCents,
    clawbackCents: run.clawbackCents,
    adjustmentCents: run.adjustmentCents,
    netDueCents: run.netDueCents,
  };
  // The route that produces a statement redirects here; the toast is the only thing that says a
  // new revision was written (feedback audit of 2026-09-09).
  const toasts = toastsFromQuery(query, {
    error: { tone: "error", title: "Refused" },
    // POST /api/statements/run redirects here with ?produced=<revision>, always a real revision
    // number, and a first run legitimately produces revision 1. So every integer is printed, and
    // only a value that is not one (a hand-typed URL) falls back to the plain words.
    produced: {
      tone: "ok",
      title: "Statement produced",
      text: (revision) => (/^\d+$/.test(revision) ? `Revision ${revision} produced` : "Statement produced"),
    },
  });

  const total = (amountCents: number, label: string, key: Parameters<typeof explainStatementTotal>[0]["key"]) =>
    explainable ? (
      <AmountExplained
        amountCents={amountCents}
        label={label}
        size="inline"
        explanation={explainStatementTotal({ ...totalsForExplanation, key })}
      />
    ) : (
      formatCentsAsUsd(amountCents)
    );

  return (
    <PortalShell
      user={user}
      active="statements"
      trail={[{ label: "Statements", href: listHref }, { label: `${run.brokerName}, ${run.statementMonth}` }]}
      toasts={toasts}
      band={{
        // The broker names the document and the month and revision identify it. Both on the title
        // line, the h1 wrapped to two lines at 1024 px and took the band to 175 px.
        title: run.brokerName,
        suffix: `${run.statementMonth}, revision ${run.revision}`,
        // ONE chip, the run's own state (Yoann, 2026-09-09): provisional, or produced after its
        // month was over. Whether the document ties to the ledger is a check, not a state, and it
        // loses nothing here: the Net due tile says "equals the journal movement" or "the journal
        // disagrees", and a run that does not tie prints a red alert above everything else.
        status: run.monthWasStillRunning ? <Chip tone="warn">provisional</Chip> : <Chip tone="neutral">month closed</Chip>,
        actions: (
          <>
            {/* An icon where the action is obvious, and three words at most: at 1024 px the two
                buttons and the title took the band to 175 px (cycle 2, decision 8). */}
            <Link
              href={`/api/statements/${run.runId}/pdf`}
              prefetch={false}
              className="button-link"
              title="Download this statement as a PDF"
              // Inline PDF in a new tab: this page keeps its place while the document opens.
              target="_blank"
              rel="noopener"
            >
              <Download size={15} aria-hidden="true" />
              PDF
            </Link>
            {/* F-YA-11: the button says what it reproduces. It posts the SAME month and the SAME
                cutoff as this revision, so it can only ever produce this document again; a new
                month or a fresh cutoff is the form beside the runs table on /ops/statements. Same
                action, same three hidden field names as before. */}
            {isStaff ? (
              <form method="post" action="/api/statements/run" className="inline-form">
                <input type="hidden" name="brokerId" value={run.brokerId} />
                <input type="hidden" name="month" value={run.statementMonth} />
                <input type="hidden" name="knowledgeCutoff" value={run.knowledgeCutoff.toISOString()} />
                <SubmitButton
                  className="secondary"
                  title={`Runs ${run.statementMonth} again with the same knowledge cutoff, ${utc(run.knowledgeCutoff)} UTC, so it can only produce this document again`}
                >
                  Reproduce this revision
                </SubmitButton>
              </form>
            ) : null}
          </>
        ),
      }}
    >
      {tiesToTheLedger ? null : (
        <div className="notices">
          <p className="error" role="alert">
            The statement says {formatCentsAsUsd(run.netDueCents)} and the journal says{" "}
            {formatCentsAsUsd(ledgerMovementCents)} for the same broker, month and cutoff. The ledger is the truth:
            this run must not be paid until the difference is explained.
          </p>
        </div>
      )}

      <Stats>
        <Stat
          label="Cash collected"
          value={total(collected.cashCollectedCents, `Cash collected from customers in ${run.statementMonth}`, "cash_collected")}
          note="premium, tax and fee"
        />
        <Stat
          label="Premium collected"
          value={
            collected.premiumCollectedCents === null
              ? "not stored"
              : total(collected.premiumCollectedCents, `Premium collected in ${run.statementMonth}, the commission base`, "premium_collected")
          }
          note="the commission base"
        />
        <Stat
          label="Commission earned"
          value={total(run.commissionEarnedCents, `Commission earned in ${run.statementMonth}`, "commission_earned")}
          note="on that premium"
        />
        <Stat
          label="Clawback"
          value={total(-run.clawbackCents, `Commission clawed back in ${run.statementMonth}`, "clawback")}
          note="on refunded premium"
        />
        <Stat
          label="Net due"
          value={total(run.netDueCents, `Net due to ${run.brokerName} for ${run.statementMonth}`, "net_due")}
          tone="accent"
          note={tiesToTheLedger ? "equals the journal movement" : "the journal disagrees"}
        />
      </Stats>

      {/* An empty month has no table to put beside the two cards, and the two column layout left
          roughly 300 px of empty grey beside the empty state (round 1, MEDIUM): the empty state
          takes the width, and the two cards read as one row under it. */}
      {lines.length === 0 ? (
        <>
          <div className="dt-wrap">
            <EmptyState illustration="open-ledger">
              No premium and no commission moved in {run.statementMonth}. A quiet month is a real statement.
            </EmptyState>
          </div>
          <div className="cards">
            <RevisionCard run={run} />
            {changes ? <Changes changes={changes} previousRevision={run.revision - 1} now={now} /> : null}
          </div>
        </>
      ) : (
      <div className="money-columns">
        <div>
          <DataTable
            ariaLabel="Statement movements"
            footer={
              <MoreRows
                shown={movementsOnThePage.length}
                total={lines.length}
                href={withParams(`/statements/${run.runId}`, query, { all: "1" })}
                label="Show every movement"
              />
            }
          >
            <thead>
              <tr>
                <ExpandHead />
                <th className="nowrap">Effective</th>
                <th className="nowrap">Recorded</th>
                <th>Line</th>
                <th className="nowrap">Policy</th>
                <th className="num">Amount</th>
                <th className="num">Premium in it</th>
              </tr>
            </thead>
            {movementsOnThePage.map((line) => (
                <ExpandRow
                  key={line.journalEntryId}
                  columns={6}
                  cells={
                    <>
                      <td className="nowrap">{calendarDate(line.effectiveAt)}</td>
                      <td className="nowrap">
                        <When instant={line.entryRecordedAt} now={now} />
                      </td>
                      <td>{KIND_LABEL[line.kind]}</td>
                      <td className="nowrap">
                        {line.policyId && line.policyNumber ? (
                          <Link href={`/policies/${line.policyId}`} prefetch={false}>
                            {line.policyNumber}
                          </Link>
                        ) : (
                          <span className="dt-muted">none</span>
                        )}
                      </td>
                      <Num>{formatCentsAsUsd(line.amountCents)}</Num>
                      <Num>
                        {line.commissionBaseCents === null ? (
                          <span className="dt-muted">not cash</span>
                        ) : (
                          formatCentsAsUsd(line.commissionBaseCents)
                        )}
                      </Num>
                    </>
                  }
                >
                  <FactGrid
                    items={[
                      { label: "What it says", value: line.description },
                      { label: "Journal entry", value: <code className="ref">{line.journalEntryId}</code> },
                      { label: "Recorded", value: `${utc(line.entryRecordedAt)} UTC` },
                    ]}
                  />
                </ExpandRow>
              ))}
          </DataTable>
        </div>

        <div>
          <RevisionCard run={run} />
          {changes ? <Changes changes={changes} previousRevision={run.revision - 1} now={now} /> : null}
        </div>
      </div>
      )}

      {/* Four short headings (cycle 2). The edge case of a transaction that commits after a run
          has read the ledger belongs in the documentation, not on a broker's screen; the fifth
          heading appears only when a chip on this page needs defining. */}
      <About>
        <h4>Ties to the ledger</h4>
        <p>
          The net due is compared, live, with the movement of this broker&rsquo;s commission payable account in the
          journal, read again with the same month and cutoff. Two reads of one ledger must agree to the cent.
        </p>
        <h4>The two collected figures</h4>
        <p>
          The cash line is what the customers paid: premium, state premium tax and policy fee. The premium line is the
          part of it commission is earned on, at the broker&rsquo;s rate, rounded down.
        </p>
        <h4>Reproducing this revision</h4>
        <p>
          The button beside the PDF posts this same month and this same cutoff, so it can only produce this document
          again. A new month or a fresh cutoff is the form on{" "}
          <Link href="/ops/statements" prefetch={false}>
            Broker statements
          </Link>
          .
        </p>
        <h4>Provisional and revisions</h4>
        <p>
          A run made before its month was over is provisional and stays exactly as it is. A later run stores a new
          revision that names the one it replaces; nothing is rewritten.
        </p>
        {formatChanged || collected.formatNote ? (
          <>
            <h4>Format</h4>
            {formatChanged ? (
              <p>
                Revision {run.revision - 1} was written in format v{run.previousCanonicalVersion} and this one in v
                {run.canonicalVersion}, so the two hash different texts and cannot be compared by hash. Their journal
                entries can be, and they are.
              </p>
            ) : null}
            {collected.formatNote ? <p>{collected.formatNote}</p> : null}
          </>
        ) : null}
      </About>
    </PortalShell>
  );
}

// The facts of this revision: which month, which cutoff, what it replaces, and how it compares
// with the revision before it. The three comparison chips used to sit in the band, which cannot
// hold more than two (cycle 2, decision 1), and they belong with the revision they describe.
function RevisionCard({ run }: { run: StatementRunRow }) {
  const collected = collectedFigures(run);
  const formatChanged = run.previousCanonicalVersion !== null && run.previousCanonicalVersion !== run.canonicalVersion;
  return (
    <section className="card">
      <h2>This revision</h2>
      <FactGrid
        items={[
          { label: "Statement month", value: `${run.statementMonth}, by effective date` },
          { label: "Revision", value: run.revision },
          { label: "Knowledge cutoff", value: `${utc(run.knowledgeCutoff)} UTC` },
          { label: "Produced", value: `${utc(run.createdAt)} UTC${run.runByName ? `, ${run.runByName}` : ""}` },
          ...(run.adjustmentCents === 0 ? [] : [{ label: "Other adjustments", value: formatCentsAsUsd(run.adjustmentCents) }]),
          {
            label: "Supersedes",
            value: run.supersedesRunId ? (
              <Link href={`/statements/${run.supersedesRunId}`} prefetch={false}>
                revision {run.revision - 1}
              </Link>
            ) : (
              "the first run of this month"
            ),
          },
          ...(run.identicalToPrevious || formatChanged || collected.formatNote
            ? [
                {
                  label: "Against the previous revision",
                  wide: true,
                  value: (
                    <>
                      {run.identicalToPrevious ? (
                        <span title={`The same content hash as revision ${run.revision - 1}`}>
                          <Chip tone="ok">identical</Chip>
                        </span>
                      ) : null}
                      {formatChanged ? <Chip tone="neutral">format changed</Chip> : null}
                      {collected.formatNote ? <Chip tone="warn">format v1</Chip> : null}
                    </>
                  ),
                },
              ]
            : []),
          {
            label: "Content hash",
            wide: true,
            value: (
              <>
                reproducible
                <SandboxReferences
                  inline
                  references={[
                    { label: "Content hash (sha256)", value: run.contentHash },
                    { label: "Statement run id", value: run.runId },
                    { label: "Canonical format version", value: String(run.canonicalVersion) },
                  ]}
                />
              </>
            ),
          },
        ]}
      />
    </section>
  );
}

// What this revision holds that the previous one did not, and the other way round. A card, because
// it answers a question about two documents rather than describing this one.
function Changes({
  changes,
  previousRevision,
  now,
}: {
  changes: { appeared: RevisionChange[]; disappeared: RevisionChange[] };
  previousRevision: number;
  now: Date;
}) {
  const nothingChanged = changes.appeared.length === 0 && changes.disappeared.length === 0;
  const rows = [
    ...changes.appeared.map((change) => ({ change, label: "appeared", tone: "ok" as const })),
    ...changes.disappeared.map((change) => ({ change, label: "removed", tone: "warn" as const })),
  ];
  return (
    <section className="card">
      <h2>Against revision {previousRevision}</h2>
      {nothingChanged ? (
        <EmptyState illustration="all-clear">The same journal entries, one for one.</EmptyState>
      ) : (
        <DataTable ariaLabel="Entries that changed against the previous revision">
          <thead>
            <tr>
              <ExpandHead />
              <th>Change</th>
              <th>Line</th>
              <th className="nowrap">Recorded</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          {rows.map(({ change, label, tone }) => (
            <ExpandRow
              key={`${label}-${change.journalEntryId}`}
              columns={4}
              cells={
                <>
                  <td>
                    <Chip tone={tone}>{label}</Chip>
                  </td>
                  <td>{KIND_LABEL[change.kind]}</td>
                  <td className="nowrap">
                    <When instant={change.entryRecordedAt} now={now} />
                  </td>
                  <Num>{formatCentsAsUsd(change.amountCents)}</Num>
                </>
              }
            >
              <FactGrid
                items={[
                  { label: "What it says", value: change.description },
                  { label: "Policy", value: change.policyNumber ?? "none" },
                  { label: "Journal entry", value: <code className="ref">{change.journalEntryId}</code> },
                  { label: "Recorded", value: `${utc(change.entryRecordedAt)} UTC` },
                ]}
              />
            </ExpandRow>
          ))}
        </DataTable>
      )}
    </section>
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
