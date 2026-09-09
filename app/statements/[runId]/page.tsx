import "@/app/styles/money.css";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
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
} from "@/lib/statements/read";
import { firstValue, withParams, type Query } from "@/lib/ui/views";

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
      band={{
        title: `${run.brokerName}, ${run.statementMonth}`,
        suffix: `revision ${run.revision}`,
        meta: (
          <>
            {/* Every movement on a statement is premium collected, commission on it, a clawback
                or a refund, and all four are Stripe money: the slot is named here in the same
                words as the reconciliation screen (AF-02, review finding F-B13-34). No simulated
                record reaches this page. */}
            <Chip tone="ok">Stripe: LIVE SANDBOX</Chip>
            <Chip tone={tiesToTheLedger ? "ok" : "warn"}>{tiesToTheLedger ? "ties to the ledger" : "does NOT tie to the ledger"}</Chip>
            {run.monthWasStillRunning ? <Chip tone="warn">provisional</Chip> : <Chip tone="neutral">month closed</Chip>}
            {run.identicalToPrevious ? <Chip tone="ok">identical to revision {run.revision - 1}</Chip> : null}
            {formatChanged ? <Chip tone="neutral">format changed</Chip> : null}
            {collected.formatNote ? <Chip tone="warn">format v1</Chip> : null}
          </>
        ),
        actions: (
          <>
            <Link href={`/api/statements/${run.runId}/pdf`} prefetch={false} className="button-link">
              Download the PDF
            </Link>
            {/* F-YA-11: the button says what it reproduces. It posts the SAME month and the SAME
                cutoff as this revision, so it can only ever produce this document again; a new
                month or a fresh cutoff is the form on /ops/statements?view=new. Same action, same
                three hidden field names as before. */}
            {isStaff ? (
              <form method="post" action="/api/statements/run" className="inline-form">
                <input type="hidden" name="brokerId" value={run.brokerId} />
                <input type="hidden" name="month" value={run.statementMonth} />
                <input type="hidden" name="knowledgeCutoff" value={run.knowledgeCutoff.toISOString()} />
                <SubmitButton className="secondary">Reproduce this revision with the same cutoff</SubmitButton>
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
            {lines.length === 0 ? null : (
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
            )}
            {lines.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={7} className="dt-empty">
                    <EmptyState illustration="open-ledger">
                      No premium and no commission moved in {run.statementMonth}. A quiet month is a real statement.
                    </EmptyState>
                  </td>
                </tr>
              </tbody>
            ) : (
              movementsOnThePage.map((line) => (
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
              ))
            )}
          </DataTable>
        </div>

        <div>
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
                {
                  label: "Content hash",
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

          {changes ? <Changes changes={changes} previousRevision={run.revision - 1} now={now} /> : null}
        </div>
      </div>

      <About>
        <h4>Ties to the ledger</h4>
        <p>
          The net due printed on the statement is compared, live, with the movement of this broker&rsquo;s commission
          payable account in the journal, read again with the same month and the same knowledge cutoff by a second,
          much smaller query. Two independent reads of the same ledger have to agree to the cent, and the page says so
          either way rather than assuming it.
        </p>
        <h4>The two collected figures</h4>
        <p>
          The same money read twice: the cash line is what the customers paid, premium plus state premium tax plus
          policy fee, and the premium line is the part of it commission is earned on. Commission is the premium times
          the broker&rsquo;s rate, rounded down, and never touches tax or fee. Refunds are not netted into these two
          figures; they are on their own lines, next to the clawback each one produced.
        </p>
        <h4>Reproducing this revision</h4>
        <p>
          The button beside the PDF posts this same month and this same knowledge cutoff, so it can only ever produce
          this document again. For a new month, or for a fresh cutoff that reads everything the ledger knows now, use{" "}
          <Link href="/ops/statements?view=new" prefetch={false}>
            Statements, New statement
          </Link>
          .
        </p>
        <h4>Why it reproduces</h4>
        <p>
          Running {run.statementMonth} again for {run.brokerName} with the cutoff above reads the same journal entries
          and produces the same content hash, because a journal row can never change and its recording time is stamped
          by the database. One case does not reproduce, and it is the reason a provisional run says so: an entry whose
          database transaction started before that cutoff and committed after this run had read the ledger is absent
          here and present in a later run with the same cutoff. Once the month is closed and quiet, it cannot happen.
        </p>
        {run.monthWasStillRunning ? (
          <>
            <h4>Provisional</h4>
            <p>
              This run was produced before {run.statementMonth} was over, so more money could still be booked into it.
              It stays exactly as it is; the run made after the month ends is the next revision and the definitive one.
            </p>
          </>
        ) : null}
        {formatChanged ? (
          <>
            <h4>Format changed</h4>
            <p>
              The statement format changed between revision {run.revision - 1} (v{run.previousCanonicalVersion}) and
              this one (v{run.canonicalVersion}): the two documents hash different texts, so they cannot be compared by
              hash. The journal entries still can be, and they are.
            </p>
          </>
        ) : null}
        {collected.formatNote ? (
          <>
            <h4>Format v1</h4>
            <p>{collected.formatNote}</p>
          </>
        ) : null}
      </About>
    </PortalShell>
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
