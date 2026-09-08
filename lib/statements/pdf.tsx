import { formatCalendarDate, formatCents, formatUtcTimestamp } from "@/lib/documents/format";
import { collectedFigures } from "./compute";
import type { StatementLineRow, StatementRunDetail } from "./read";

// The broker monthly statement as a real PDF file.
//
// Same shape as the two policy documents (lib/documents/render.tsx): it runs on the server, it
// returns a Buffer, and it loads @react-pdf/renderer with `await import(...)` because that package
// is published as ES modules only and a static import would turn into a require() in the
// CommonJS-compiled test runner.
//
// The document is built ONLY from what the run stored. It recomputes nothing: a statement PDF
// downloaded today and the same PDF downloaded next year say the same thing, because the run is
// append-only and this file does no arithmetic beyond adding up the lines it was given.
//
// Three things are printed that a normal invoice would not carry, and they are the point of the
// slice: the REVISION, the KNOWLEDGE CUTOFF and the CONTENT HASH. Together they say "this is what
// we knew on that instant, and here is the fingerprint that proves a re-run produced the same
// document".

async function loadPdfRenderer() {
  return import("@react-pdf/renderer");
}

const styles = {
  page: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 44, fontSize: 10, fontFamily: "Helvetica" },
  documentTitle: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  documentSubtitle: { fontSize: 10, color: "#444444", marginBottom: 16 },
  sectionTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 6 },
  row: { flexDirection: "row", paddingVertical: 3 },
  rowWithRule: { flexDirection: "row", paddingVertical: 3, borderTopWidth: 0.5, borderTopColor: "#999999" },
  label: { width: 150, color: "#444444" },
  value: { flexGrow: 1 },
  monospace: { flexGrow: 1, fontFamily: "Courier", fontSize: 9 },
  amountColumn: { width: 88, textAlign: "right" },
  kindColumn: { width: 100 },
  policyColumn: { width: 76 },
  dateColumn: { width: 92 },
  provisional: { fontSize: 10, marginBottom: 12 },
  descriptionColumn: { flexGrow: 1, paddingRight: 8 },
  tableHeader: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#333333",
    fontFamily: "Helvetica-Bold",
  },
  totalRow: {
    flexDirection: "row",
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: "#333333",
    fontFamily: "Helvetica-Bold",
  },
  emptyState: { paddingVertical: 8, color: "#444444" },
  footer: {
    position: "absolute",
    left: 44,
    right: 44,
    bottom: 24,
    fontSize: 8,
    color: "#444444",
    borderTopWidth: 0.5,
    borderTopColor: "#999999",
    paddingTop: 6,
  },
} as const;

// What each line kind is called on the document, in the broker's own terms.
const KIND_LABEL: Record<StatementLineRow["kind"], string> = {
  premium_collected: "Premium collected",
  commission_earned: "Commission earned",
  clawback: "Commission clawback",
  refund: "Refund to customer",
  adjustment: "Adjustment",
};

export async function renderStatementPdf(statement: StatementRunDetail): Promise<Buffer> {
  const { Document, Page, Text, View, renderToBuffer } = await loadPdfRenderer();
  const { run, lines } = statement;
  // A run says which shape its own columns are in (migration 0016). A v1 run stored the cash in
  // the premium column and no commission base, so it is printed with its own labels and a note,
  // never with the labels of a format it was not written in.
  const collected = collectedFigures(run);

  return renderToBuffer(
    <Document
      title={`Broker statement ${run.brokerName} ${run.statementMonth} revision ${run.revision}`}
      author="Corgi"
      // The metadata carries the run's own creation time rather than the current clock, so
      // downloading the same run twice produces the same file.
      creationDate={run.createdAt}
      modificationDate={run.createdAt}
    >
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.documentTitle}>Broker Commission Statement</Text>
        {/* One interpolated string rather than several children: react-pdf draws each child as
            its own run, and a subtitle split into five pieces is harder to read back out of the
            file than it is to write. */}
        <Text style={styles.documentSubtitle}>
          {`${run.brokerName}, ${run.statementMonth}, revision ${run.revision}`}
        </Text>

        {collected.formatNote ? <Text style={styles.provisional}>{collected.formatNote}</Text> : null}

        {run.monthWasStillRunning ? (
          <Text style={styles.provisional}>
            {`MONTH IN PROGRESS, PROVISIONAL. This statement was produced before ${run.statementMonth} was over, so more money can still be booked into that month. It will not change: the run made once the month has ended is the next revision, and the definitive one.`}
          </Text>
        ) : null}

        <View style={styles.row}>
          <Text style={styles.label}>Statement month</Text>
          <Text style={styles.value}>
            {`${formatCalendarDate(`${run.statementMonth}-01`)} to the last day of that month (business dates)`}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Revision</Text>
          <Text style={styles.value}>
            {`${run.revision}${
              run.supersedesRunId ? ", superseding the previous revision of the same month" : ", the first run of this month"
            }${run.identicalToPrevious ? " (identical to the revision it supersedes)" : ""}`}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Knowledge cutoff</Text>
          <Text style={styles.value}>{formatUtcTimestamp(run.knowledgeCutoff.toISOString())}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Content hash (sha256)</Text>
          <Text style={styles.monospace}>{run.contentHash}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Produced</Text>
          <Text style={styles.value}>
            {`${formatUtcTimestamp(run.createdAt.toISOString())}${run.runByName ? ` by ${run.runByName}` : ""}`}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Movements</Text>
        <View style={styles.tableHeader}>
          <Text style={styles.dateColumn}>Effective</Text>
          <Text style={styles.kindColumn}>Line</Text>
          <Text style={styles.policyColumn}>Policy</Text>
          <Text style={styles.descriptionColumn}>Description</Text>
          <Text style={styles.amountColumn}>Amount</Text>
          <Text style={styles.amountColumn}>Premium in it</Text>
        </View>
        {lines.length === 0 ? (
          <Text style={styles.emptyState}>
            No premium was collected and no commission moved for this broker in this month.
          </Text>
        ) : (
          lines.map((line) => (
            <View key={line.journalEntryId} style={styles.rowWithRule}>
              <Text style={styles.dateColumn}>{formatCalendarDate(line.effectiveAt.toISOString().slice(0, 10))}</Text>
              <Text style={styles.kindColumn}>{KIND_LABEL[line.kind]}</Text>
              <Text style={styles.policyColumn}>{line.policyNumber ?? "-"}</Text>
              <Text style={styles.descriptionColumn}>{line.description}</Text>
              <Text style={styles.amountColumn}>{formatCents(line.amountCents)}</Text>
              <Text style={styles.amountColumn}>
                {line.commissionBaseCents === null ? "-" : formatCents(line.commissionBaseCents)}
              </Text>
            </View>
          ))
        )}

        <Text style={styles.sectionTitle}>Totals</Text>
        <View style={styles.rowWithRule}>
          <Text style={styles.descriptionColumn}>Cash collected from customers (premium, tax and fee)</Text>
          <Text style={styles.amountColumn}>{formatCents(collected.cashCollectedCents)}</Text>
        </View>
        <View style={styles.rowWithRule}>
          <Text style={styles.descriptionColumn}>Premium collected, which is the commission base</Text>
          <Text style={styles.amountColumn}>
            {collected.premiumCollectedCents === null ? "not stored" : formatCents(collected.premiumCollectedCents)}
          </Text>
        </View>
        <View style={styles.rowWithRule}>
          <Text style={styles.descriptionColumn}>
            {collected.premiumCollectedCents === null ? "Commission earned" : "Commission earned on that premium"}
          </Text>
          <Text style={styles.amountColumn}>{formatCents(run.commissionEarnedCents)}</Text>
        </View>
        <View style={styles.rowWithRule}>
          <Text style={styles.descriptionColumn}>Commission clawed back on refunded premium</Text>
          <Text style={styles.amountColumn}>{formatCents(-run.clawbackCents)}</Text>
        </View>
        {run.adjustmentCents === 0 ? null : (
          <View style={styles.rowWithRule}>
            <Text style={styles.descriptionColumn}>Other adjustments to the commission owed</Text>
            <Text style={styles.amountColumn}>{formatCents(run.adjustmentCents)}</Text>
          </View>
        )}
        <View style={styles.totalRow}>
          <Text style={styles.descriptionColumn}>Net due to the broker</Text>
          <Text style={styles.amountColumn}>{formatCents(run.netDueCents)}</Text>
        </View>

        <View style={styles.footer} fixed>
          <Text>
            The two collected figures are the same money read twice: the cash is what the customers paid,
            premium plus state premium tax plus policy fee, and the premium is the part of it commission is
            earned on. Commission is that premium times the broker&apos;s rate, rounded down, and never touches
            tax or fee. Refunds are not netted into either figure; they are on their own lines, next to the
            clawback each one produced.
          </Text>
          <Text>
            Net due is the movement of this broker&apos;s commission payable account in the ledger for this
            month. Running this month again for the same broker with the knowledge cutoff above reads the same
            journal entries and produces the same content hash, because a journal row can never change and its
            recording time is stamped by the database. One case does not reproduce: an entry whose database
            transaction started before that cutoff and committed after this run had read the ledger is absent
            here and present in a later run with the same cutoff. It cannot happen once the month is closed and
            quiet. A correction recorded after the cutoff produces a new revision instead of changing this one.
          </Text>
        </View>
      </Page>
    </Document>,
  );
}
