import { formatCalendarDate, formatCents, formatUtcTimestamp } from "@/lib/documents/format";
import {
  ISSUER_NAME,
  ISSUER_TAGLINE,
  SANDBOX_LABEL,
  WATERMARK_TEXT,
  applyPdfTypography,
  corgiWordmarkPng,
  createPdfStyles,
} from "@/lib/documents/pdf-theme";
import { collectedFigures } from "./compute";
import type { StatementLineRow, StatementRunDetail } from "./read";

// The broker monthly statement as a real PDF file.
//
// Same shape as the two policy documents (lib/documents/render.tsx): it runs on the server, it
// returns a Buffer, and it loads @react-pdf/renderer with `await import(...)` because that package
// is published as ES modules only and a static import would turn into a require() in the
// CommonJS-compiled test runner. It shares their look through lib/documents/pdf-theme.ts.
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

// What each line kind is called on the document, in the broker's own terms.
const KIND_LABEL: Record<StatementLineRow["kind"], string> = {
  premium_collected: "Premium collected",
  commission_earned: "Commission earned",
  clawback: "Commission clawback",
  refund: "Refund to customer",
  adjustment: "Adjustment",
};

export async function renderStatementPdf(statement: StatementRunDetail): Promise<Buffer> {
  const { Document, Font, Image, Page, Text, View, StyleSheet, renderToBuffer } = await loadPdfRenderer();
  applyPdfTypography(Font);
  const styles = createPdfStyles(StyleSheet);
  const { run, lines } = statement;
  // A run says which shape its own columns are in (migration 0016). A v1 run stored the cash in
  // the premium column and no commission base, so it is printed with its own labels and a note,
  // never with the labels of a format it was not written in.
  const collected = collectedFigures(run);

  return renderToBuffer(
    <Document
      title={`Broker statement ${run.brokerName} ${run.statementMonth} revision ${run.revision}`}
      // The document says on its face who issued it, so the metadata says the same thing.
      author={ISSUER_NAME}
      // The metadata carries the run's own creation time rather than the current clock, so
      // downloading the same run twice produces the same file.
      creationDate={run.createdAt}
      modificationDate={run.createdAt}
    >
      {/* pageWithTallFooter, not page: this footer carries two long paragraphs, and the footer
          is positioned absolutely, so the page has to reserve the room it occupies. */}
      <Page size="LETTER" style={styles.pageWithTallFooter}>
        {/* First child of the page, so everything below is drawn on top of it. */}
        <View style={styles.watermarkLayer} fixed>
          <Text style={styles.watermarkText}>{WATERMARK_TEXT}</Text>
        </View>

        <View style={styles.issuerHeader} fixed>
          {/* Smaller than on a policy document: a statement's header competes with a table of
              figures, so the wordmark sits at 22 points instead of 28. */}
          <Image style={styles.issuerLogoStatement} src={corgiWordmarkPng()} />
          <View style={styles.issuerIdentity}>
            <Text style={styles.issuerName}>{ISSUER_NAME}</Text>
            <Text style={styles.issuerTagline}>{ISSUER_TAGLINE}</Text>
          </View>
          <Text style={styles.sandboxLabel}>{SANDBOX_LABEL}</Text>
        </View>

        <View style={styles.titleBand}>
          <View style={styles.titleBandAccentBar} />
          <View style={styles.titleBandBody}>
            <Text style={styles.documentTitle}>Broker Commission Statement</Text>
            {/* One interpolated string rather than several children: react-pdf draws each child as
                its own run, and a subtitle split into five pieces is harder to read back out of the
                file than it is to write. */}
            <Text style={styles.documentSubtitle}>
              {`${run.brokerName}, ${run.statementMonth}, revision ${run.revision}`}
            </Text>
          </View>
          {/* The one figure the broker opens the statement for, set apart from the totals
              block that derives it. Same field, printed twice, formatted once. */}
          <View style={styles.titleBandIdentifier}>
            <Text style={styles.microLabel}>Net due for the month</Text>
            <Text style={styles.summaryValue}>{formatCents(run.netDueCents)}</Text>
          </View>
        </View>

        {collected.formatNote ? (
          <View style={styles.callout}>
            <Text>{collected.formatNote}</Text>
          </View>
        ) : null}

        {run.monthWasStillRunning ? (
          <View style={styles.callout}>
            <Text>
              {`MONTH IN PROGRESS, PROVISIONAL. This statement was produced before ${run.statementMonth} was over, so more money can still be booked into that month. It will not change: the run made once the month has ended is the next revision, and the definitive one.`}
            </Text>
          </View>
        ) : null}

        <View style={styles.factRow}>
          <Text style={styles.factLabel}>Statement month</Text>
          <Text style={styles.factValue}>
            {`${formatCalendarDate(`${run.statementMonth}-01`)} to the last day of that month (business dates)`}
          </Text>
        </View>
        <View style={styles.factRow}>
          <Text style={styles.factLabel}>Revision</Text>
          <Text style={styles.factValue}>
            {`${run.revision}${
              run.supersedesRunId ? ", superseding the previous revision of the same month" : ", the first run of this month"
            }${run.identicalToPrevious ? " (identical to the revision it supersedes)" : ""}`}
          </Text>
        </View>
        <View style={styles.factRow}>
          <Text style={styles.factLabel}>Knowledge cutoff</Text>
          <Text style={styles.factValue}>{formatUtcTimestamp(run.knowledgeCutoff.toISOString())}</Text>
        </View>
        <View style={styles.factRow}>
          <Text style={styles.factLabel}>Content hash (sha256)</Text>
          <Text style={styles.factValueMono}>{run.contentHash}</Text>
        </View>
        <View style={styles.factRow}>
          <Text style={styles.factLabel}>Produced</Text>
          <Text style={styles.factValue}>
            {`${formatUtcTimestamp(run.createdAt.toISOString())}${run.runByName ? ` by ${run.runByName}` : ""}`}
          </Text>
        </View>

        {/* `wrap={false}` on every table row below: a row that does not fit moves whole to the
            next page instead of being cut through the middle, which is how a long description
            ended up alone at the top of a page with none of its figures. */}
        <Text style={styles.sectionTitle}>Movements</Text>
        <View style={styles.tableHeader}>
          <Text style={[styles.statementDateColumn, styles.tableHeaderCell]}>Effective</Text>
          <Text style={[styles.statementKindColumn, styles.tableHeaderCell]}>Line</Text>
          <Text style={[styles.statementPolicyColumn, styles.tableHeaderCell]}>Policy</Text>
          <Text style={[styles.textColumn, styles.tableHeaderCell]}>Description</Text>
          <Text style={[styles.statementAmountColumn, styles.tableHeaderCell]}>Amount</Text>
          <Text style={[styles.statementAmountColumn, styles.tableHeaderCell]}>Premium in it</Text>
        </View>
        {lines.length === 0 ? (
          <Text style={styles.emptyState}>
            No premium was collected and no commission moved for this broker in this month.
          </Text>
        ) : (
          lines.map((line) => (
            <View key={line.journalEntryId} style={styles.statementTableRow} wrap={false}>
              <Text style={styles.statementDateColumn}>
                {formatCalendarDate(line.effectiveAt.toISOString().slice(0, 10))}
              </Text>
              <Text style={styles.statementKindColumn}>{KIND_LABEL[line.kind]}</Text>
              <Text style={styles.statementPolicyColumn}>{line.policyNumber ?? "-"}</Text>
              {/* textColumn is the fix for review finding F-B9-08: it takes the space the fixed
                  columns leave (flexBasis 0) and wraps inside it, instead of keeping its natural
                  width and printing a long description over the amounts. */}
              <Text style={styles.textColumn}>{line.description}</Text>
              <Text style={styles.statementAmountColumn}>{formatCents(line.amountCents)}</Text>
              <Text style={styles.statementAmountColumn}>
                {line.commissionBaseCents === null ? "-" : formatCents(line.commissionBaseCents)}
              </Text>
            </View>
          ))
        )}

        {/* The six totals are one short block and are read as one: `wrap={false}` on the
            block keeps them on a single page, instead of leaving the cash on one page and the
            net due on the next. */}
        <View wrap={false}>
          <Text style={styles.sectionTitle}>Totals</Text>
          <View style={styles.moneyBox}>
            <View style={styles.moneyBoxFirstRow}>
              <Text style={styles.textColumn}>Cash collected from customers (premium, tax and fee)</Text>
              <Text style={styles.statementTotalAmountColumn}>{formatCents(collected.cashCollectedCents)}</Text>
            </View>
            <View style={styles.moneyBoxRow}>
              <Text style={styles.textColumn}>Premium collected, which is the commission base</Text>
              <Text style={styles.statementTotalAmountColumn}>
                {collected.premiumCollectedCents === null ? "not stored" : formatCents(collected.premiumCollectedCents)}
              </Text>
            </View>
            <View style={styles.moneyBoxRow}>
              <Text style={styles.textColumn}>
                {collected.premiumCollectedCents === null ? "Commission earned" : "Commission earned on that premium"}
              </Text>
              <Text style={styles.statementTotalAmountColumn}>{formatCents(run.commissionEarnedCents)}</Text>
            </View>
            <View style={styles.moneyBoxRow}>
              <Text style={styles.textColumn}>Commission clawed back on refunded premium</Text>
              <Text style={styles.statementTotalAmountColumn}>{formatCents(-run.clawbackCents)}</Text>
            </View>
            {run.adjustmentCents === 0 ? null : (
              <View style={styles.moneyBoxRow}>
                <Text style={styles.textColumn}>Other adjustments to the commission owed</Text>
                <Text style={styles.statementTotalAmountColumn}>{formatCents(run.adjustmentCents)}</Text>
              </View>
            )}
            <View style={styles.moneyBoxTotalRow}>
              <Text style={[styles.textColumn, styles.strongCell]}>Net due to the broker</Text>
              <Text style={[styles.statementTotalAmountColumn, styles.strongCell]}>
                {formatCents(run.netDueCents)}
              </Text>
            </View>
          </View>
          {/* The two collected figures in one line, beside the box, because a broker reading
              the totals should not have to reach the footer to learn why two different
              amounts are both called "collected". The footer keeps the full explanation. */}
          <Text style={styles.boxCaption}>
            Cash collected is premium plus state premium tax plus policy fee; premium collected is the
            part commission is earned on.
          </Text>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerSentence}>
            The two collected figures are the same money read twice: the cash is what the customers paid,
            premium plus state premium tax plus policy fee, and the premium is the part of it commission is
            earned on. Commission is that premium times the broker&apos;s rate, rounded down, and never touches
            tax or fee. Refunds are not netted into either figure; they are on their own lines, next to the
            clawback each one produced.
          </Text>
          <Text style={styles.footerSentence}>
            Net due is the movement of this broker&apos;s commission payable account in the ledger for this
            month. Running this month again for the same broker with the knowledge cutoff above reads the same
            journal entries and produces the same content hash, because a journal row can never change and its
            recording time is stamped by the database. One case does not reproduce: an entry whose database
            transaction started before that cutoff and committed after this run had read the ledger is absent
            here and present in a later run with the same cutoff. It cannot happen once the month is closed and
            quiet. A correction recorded after the cutoff produces a new revision instead of changing this one.
          </Text>
          <View style={styles.footerBottomRow}>
            <Text>Generated {formatUtcTimestamp(run.createdAt.toISOString())}.</Text>
            {/* react-pdf resolves this render prop once the page count is known, which is why
                the total can be printed on page one. */}
            <Text
              style={styles.footerPageNumber}
              render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
              fixed
            />
          </View>
        </View>
      </Page>
    </Document>,
  );
}
