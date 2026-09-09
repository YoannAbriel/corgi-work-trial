import { formatBasisPoints, formatCalendarDate, formatCents, formatUtcTimestamp } from "./format";
import {
  ISSUER_NAME,
  ISSUER_TAGLINE,
  SANDBOX_LABEL,
  WATERMARK_TEXT,
  applyPdfTypography,
  createPdfStyles,
} from "./pdf-theme";
import type { MailingAddress, PolicySnapshot } from "./policy-snapshot";

// The two policy documents, rendered from a PolicySnapshot into a real PDF file.
//
// Both functions run on the server (Node runtime) and return a Buffer: no browser API, no
// canvas, no temporary file. The caller decides what to do with the bytes: stream them to
// the customer, attach them to an email, or write them next to a test.
//
// Nothing here computes money. Every figure printed is a field of the snapshot, passed
// through the formatters in format.ts. Reordering a row changes where a reader looks; it
// can never change what the document says. There is no arithmetic in this file at all: no
// addition, no percentage, no proration. If a figure is on the page, `foldPolicyEvents`
// put it in the snapshot.
//
// The layout is the one a broker hands a customer: issuer band, the identifiers, the
// parties, coverage, premium, endorsements, a signature line, and a footer that repeats.
// Every sheet carries a diagonal SPECIMEN watermark, because a page of this document
// separated from the rest must still say what it is.
//
// Why `await import(...)` instead of a top-level import: @react-pdf/renderer 4.9.0 is
// published as ES modules only, and one of its transitive packages (@react-pdf/hyphenate)
// declares no CommonJS entry point. The test runner (`node --import tsx --test`) compiles
// these files to CommonJS, so a static import turns into require() and fails to resolve.
// Loading the module with import() keeps Node on its ES module path, in the tests and in
// the Next.js server alike. It is loaded once per process and cached by Node.
async function loadPdfRenderer() {
  return import("@react-pdf/renderer");
}

// The declarations page: who is covered, for what, for how long and for how much, as the
// policy stood on the snapshot date.
export async function renderDeclarationsPdf(snapshot: PolicySnapshot): Promise<Buffer> {
  const { Document, Font, Page, Text, View, StyleSheet, renderToBuffer } = await loadPdfRenderer();
  // The look lives in pdf-theme.ts, shared with the endorsement schedule and the broker
  // statement. StyleSheet and Font arrive from the dynamically loaded module, so the sheet
  // is built here rather than at the top of the file.
  applyPdfTypography(Font);
  const styles = createPdfStyles(StyleSheet);

  return renderToBuffer(
    <Document
      title={`Declarations ${snapshot.policyNumber} as of ${snapshot.asOf}`}
      author={snapshot.brokerName}
      // The PDF metadata carries the snapshot's own timestamp instead of the current clock,
      // so regenerating an old document byte for byte is possible.
      creationDate={new Date(snapshot.generatedAt)}
      modificationDate={new Date(snapshot.generatedAt)}
    >
      <Page size="LETTER" style={styles.page}>
        {/* First child of the page, so everything below is drawn on top of it. */}
        <View style={styles.watermarkLayer} fixed>
          <Text style={styles.watermarkText}>{WATERMARK_TEXT}</Text>
        </View>

        {/* Who issued the document, and what the figures on it are. `fixed` repeats the
            block at the top of a second page, so a loose sheet is never anonymous. */}
        <View style={styles.issuerHeader} fixed>
          <View style={styles.issuerIdentity}>
            <Text style={styles.issuerName}>{ISSUER_NAME}</Text>
            <Text style={styles.issuerTagline}>{ISSUER_TAGLINE}</Text>
          </View>
          <Text style={styles.sandboxLabel}>{SANDBOX_LABEL}</Text>
        </View>

        <View style={styles.titleBand}>
          <View style={styles.titleBandAccentBar} />
          <View style={styles.titleBandBody}>
            <Text style={styles.documentTitle}>Commercial Policy Declarations</Text>
            <Text style={styles.documentSubtitle}>
              Policy {snapshot.policyNumber} as it stood on {formatCalendarDate(snapshot.asOf)}
            </Text>
          </View>
          {/* The number a caller reads out on the phone, set apart from the sentence that
              also contains it. */}
          <View style={styles.titleBandIdentifier}>
            <Text style={styles.microLabel}>Policy number</Text>
            <Text style={styles.summaryValue}>{snapshot.policyNumber}</Text>
          </View>
        </View>

        {/* The three facts a broker checks before reading anything else. */}
        <View style={styles.summaryStrip}>
          <View style={styles.summaryCell}>
            <Text style={styles.microLabel}>Policy period</Text>
            <Text style={styles.summaryValue}>
              {formatCalendarDate(snapshot.termStart)} to {formatCalendarDate(snapshot.termEnd)}
            </Text>
          </View>
          <View style={styles.summaryCellDivided}>
            <Text style={styles.microLabel}>Status on {formatCalendarDate(snapshot.asOf)}</Text>
            <Text style={styles.summaryValue}>{describeStatus(snapshot)}</Text>
          </View>
          <View style={styles.summaryCellDivided}>
            <Text style={styles.microLabel}>Annual premium in force</Text>
            <Text style={styles.summaryValue}>{formatCents(snapshot.annualPremiumCents)}</Text>
          </View>
        </View>

        {/* The two parties, side by side, the way a declarations page presents them. */}
        <View style={styles.partiesRow}>
          <View style={styles.partyBlock}>
            <Text style={styles.microLabel}>Named insured</Text>
            <Text style={styles.partyName}>{snapshot.insuredName}</Text>
            {mailingAddressLines(snapshot.insuredAddress).map((line) => (
              <Text key={line} style={styles.partyLine}>
                {line}
              </Text>
            ))}
          </View>
          <View style={styles.partyBlock}>
            <Text style={styles.microLabel}>Producing broker</Text>
            <Text style={styles.partyName}>{snapshot.brokerName}</Text>
            {/* The broker's commission rate is deliberately not on this page: a declarations
                page is the customer's document, and what the broker earns on it is between
                the broker and the issuer. It is printed on the broker statement
                (lib/statements/pdf.tsx), which only the broker receives. The snapshot does
                not even carry the rate, so nothing here could print it by accident. */}
            <Text style={styles.partyNote}>
              Commission is not shown on a declarations page. It is reported to the broker on the
              monthly commission statement.
            </Text>
          </View>
        </View>

        {/* `wrap={false}` on a coverage row: a row that does not fit moves whole to the next
            page instead of being cut through the middle, leaving its limit on one page and
            its name on another. The coverage table itself may be any length, so only its
            rows are protected, not the table. */}
        <Text style={styles.sectionTitle}>Coverage</Text>
        <Text style={styles.sectionCaption}>
          Limits in force on {formatCalendarDate(snapshot.asOf)}. A per-occurrence limit and an
          aggregate limit are separate limits and are listed as separate lines.
        </Text>
        <View style={styles.tableHeader}>
          <Text style={[styles.textColumn, styles.tableHeaderCell]}>Coverage line</Text>
          <Text style={[styles.limitColumn, styles.tableHeaderCell]}>Limit of liability</Text>
        </View>
        {snapshot.coverageLines.length === 0 ? (
          <Text style={styles.emptyState}>No coverage line was in effect on this date.</Text>
        ) : (
          snapshot.coverageLines.map((coverageLine) => (
            <View key={coverageLine.name} style={styles.tableRow} wrap={false}>
              <View style={styles.textColumn}>
                <Text style={styles.strongCell}>{coverageLine.name}</Text>
                {coverageLine.description ? (
                  <Text style={styles.columnDetail}>{coverageLine.description}</Text>
                ) : null}
              </View>
              <Text style={styles.limitColumn}>{formatCents(coverageLine.limitCents)}</Text>
            </View>
          ))
        )}

        {/* The four charges add up to one figure and are read as one block, so the block
            itself carries `wrap={false}` and moves whole rather than leaving the total
            stranded on the next page. */}
        <View wrap={false}>
          <Text style={styles.sectionTitle}>Premium summary</Text>
          <View style={styles.moneyBox}>
            <View style={styles.moneyBoxFirstRow}>
              <Text style={styles.textColumn}>Annual premium</Text>
              <Text style={styles.chargeAmountColumn}>{formatCents(snapshot.annualPremiumCents)}</Text>
            </View>
            <View style={styles.moneyBoxRow}>
              <Text style={styles.textColumn}>
                {snapshot.stateName} premium tax ({formatBasisPoints(snapshot.taxRateBasisPoints)})
              </Text>
              <Text style={styles.chargeAmountColumn}>{formatCents(snapshot.taxCents)}</Text>
            </View>
            <View style={styles.moneyBoxRow}>
              <Text style={styles.textColumn}>Policy fee</Text>
              <Text style={styles.chargeAmountColumn}>{formatCents(snapshot.feeCents)}</Text>
            </View>
            <View style={styles.moneyBoxTotalRow}>
              <Text style={[styles.textColumn, styles.strongCell]}>Total charge for the annual term</Text>
              <Text style={[styles.chargeAmountColumn, styles.strongCell]}>
                {formatCents(snapshot.totalChargeCents)}
              </Text>
            </View>
          </View>
          {/* The as-of sentence, in the shortest form, next to the figures it qualifies.
              The footer carries the full statement on every page. */}
          <Text style={styles.boxCaption}>
            As the policy stood on {formatCalendarDate(snapshot.asOf)}. This is what the annual term is
            charged, not what has been collected.
          </Text>
        </View>

        {/* Endorsements are what makes this a policy as of a date rather than a policy. The
            declarations page carries the summary; the endorsement schedule carries the same
            changes with their recording times. */}
        <Text style={styles.sectionTitle}>Endorsements in force</Text>
        {snapshot.endorsements.length === 0 ? (
          <Text style={styles.emptyState}>
            No endorsement had taken effect on {formatCalendarDate(snapshot.asOf)}. The policy stands
            as issued.
          </Text>
        ) : (
          <>
            <View style={styles.tableHeader}>
              <Text style={[styles.endorsementSummaryDateColumn, styles.tableHeaderCell]}>Effective</Text>
              <Text style={[styles.textColumn, styles.tableHeaderCell]}>Change</Text>
              <Text style={[styles.endorsementSummaryAmountColumn, styles.tableHeaderCell]}>
                Amount charged
              </Text>
            </View>
            {snapshot.endorsements.map((endorsement, position) => (
              <View
                key={`${endorsement.effectiveAt}-${position}`}
                style={styles.tableRow}
                wrap={false}
              >
                <Text style={styles.endorsementSummaryDateColumn}>
                  {formatCalendarDate(endorsement.effectiveAt)}
                </Text>
                <Text style={styles.textColumn}>{endorsement.description}</Text>
                <Text style={styles.endorsementSummaryAmountColumn}>
                  {formatCents(endorsement.amountChargedCents)}
                </Text>
              </View>
            ))}
            <Text style={styles.boxCaption}>
              Amount charged: the prorated premium and its {snapshot.stateName} premium tax, charged
              (positive) or credited (negative) from the effective date to the end of the term. It is
              the amount that moved, not the change in the annual premium.
            </Text>
          </>
        )}

        {/* Ruled lines, printed empty. See the note on `signatureRow` in pdf-theme.ts. */}
        <View style={styles.signatureRow} wrap={false}>
          <View style={styles.signatureCell}>
            <View style={styles.signatureRule} />
            <Text style={styles.microLabel}>Authorized representative</Text>
            <Text style={styles.signatureCaption}>{ISSUER_NAME}</Text>
          </View>
          <View style={styles.signatureDateCell}>
            <View style={styles.signatureRule} />
            <Text style={styles.microLabel}>Date countersigned</Text>
            <Text style={styles.signatureCaption}>
              Specimen: this build signs and countersigns nothing.
            </Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerSentence}>{asOfStatement(snapshot)}</Text>
          <View style={styles.footerBottomRow}>
            <Text>Generated {formatUtcTimestamp(snapshot.generatedAt)}.</Text>
            {/* react-pdf resolves this render prop once the page count is known, which is
                why the total can be printed on page one. */}
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

// The endorsement schedule: every change that had taken effect by the snapshot date, with
// the money it moved and the annual premium it left behind.
//
// WHY NO STRUCK-THROUGH SUPERSEDED ROWS
// A corrected endorsement is not in this list to strike through. `foldPolicyEvents` drops
// an event undone by a `correction_reversal` together with the reversal itself, so a
// PolicySnapshot exposes only the endorsements that survive as of its date; there is no
// "superseded" flag on AppliedEndorsement and no reversed row to print. Showing one would
// mean changing the snapshot contract (policy-snapshot.ts) and the fold, which are outside
// a presentation pass. Until then this schedule states business truth as of `asOf`, and the
// footer says so.
export async function renderEndorsementSchedulePdf(snapshot: PolicySnapshot): Promise<Buffer> {
  const { Document, Font, Page, Text, View, StyleSheet, renderToBuffer } = await loadPdfRenderer();
  applyPdfTypography(Font);
  const styles = createPdfStyles(StyleSheet);

  return renderToBuffer(
    <Document
      title={`Endorsement schedule ${snapshot.policyNumber} as of ${snapshot.asOf}`}
      author={snapshot.brokerName}
      creationDate={new Date(snapshot.generatedAt)}
      modificationDate={new Date(snapshot.generatedAt)}
    >
      {/* Landscape US Letter: the schedule has five columns, and squeezing them onto a
          portrait page would wrap the recording timestamps in the middle. */}
      <Page size="LETTER" orientation="landscape" style={styles.page}>
        <View style={styles.watermarkLayer} fixed>
          <Text style={styles.watermarkText}>{WATERMARK_TEXT}</Text>
        </View>

        <View style={styles.issuerHeader} fixed>
          <View style={styles.issuerIdentity}>
            <Text style={styles.issuerName}>{ISSUER_NAME}</Text>
            <Text style={styles.issuerTagline}>{ISSUER_TAGLINE}</Text>
          </View>
          <Text style={styles.sandboxLabel}>{SANDBOX_LABEL}</Text>
        </View>

        <View style={styles.titleBand}>
          <View style={styles.titleBandAccentBar} />
          <View style={styles.titleBandBody}>
            <Text style={styles.documentTitle}>Endorsement Schedule</Text>
            <Text style={styles.documentSubtitle}>
              Policy {snapshot.policyNumber} as it stood on {formatCalendarDate(snapshot.asOf)}
            </Text>
          </View>
          <View style={styles.titleBandIdentifier}>
            <Text style={styles.microLabel}>Policy number</Text>
            <Text style={styles.summaryValue}>{snapshot.policyNumber}</Text>
          </View>
        </View>

        <View style={styles.summaryStrip}>
          <View style={styles.summaryCell}>
            <Text style={styles.microLabel}>Named insured</Text>
            <Text style={styles.summaryValue}>{snapshot.insuredName}</Text>
          </View>
          <View style={styles.summaryCellDivided}>
            <Text style={styles.microLabel}>Producing broker</Text>
            <Text style={styles.summaryValue}>{snapshot.brokerName}</Text>
          </View>
          <View style={styles.summaryCellDivided}>
            <Text style={styles.microLabel}>Policy period</Text>
            <Text style={styles.summaryValue}>
              {formatCalendarDate(snapshot.termStart)} to {formatCalendarDate(snapshot.termEnd)}
            </Text>
          </View>
          <View style={styles.summaryCellDivided}>
            <Text style={styles.microLabel}>Annual premium in force</Text>
            <Text style={styles.summaryValue}>{formatCents(snapshot.annualPremiumCents)}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Endorsement history</Text>
        <Text style={styles.sectionCaption}>
          Endorsements effective on or before {formatCalendarDate(snapshot.asOf)}, oldest first. The
          recorded column is the instant the change was written down, which is what shows a backdated
          endorsement for what it is.
        </Text>
        <View style={styles.tableHeader}>
          <Text style={[styles.endorsementEffectiveColumn, styles.tableHeaderCell]}>Effective</Text>
          <Text style={[styles.endorsementRecordedColumn, styles.tableHeaderCell]}>Recorded</Text>
          <Text style={[styles.textColumn, styles.tableHeaderCell]}>Change</Text>
          <Text style={[styles.endorsementAmountColumn, styles.tableHeaderCell]}>Amount charged</Text>
          <Text style={[styles.endorsementAmountColumn, styles.tableHeaderCell]}>Annual premium</Text>
        </View>

        {/* The running column starts at the premium the policy was issued with, otherwise
            the first endorsement's "annual premium" would come out of nowhere. */}
        <View style={styles.tableRow} wrap={false}>
          <Text style={styles.endorsementEffectiveColumn}>{formatCalendarDate(snapshot.termStart)}</Text>
          <Text style={styles.endorsementRecordedColumn}>-</Text>
          <Text style={styles.textColumn}>Policy issued</Text>
          <Text style={styles.endorsementAmountColumn}>-</Text>
          <Text style={styles.endorsementAmountColumn}>{formatCents(snapshot.annualPremiumCentsAtIssuance)}</Text>
        </View>

        {snapshot.endorsements.length === 0 ? (
          <Text style={styles.emptyState}>
            No endorsement had taken effect on {formatCalendarDate(snapshot.asOf)}.
          </Text>
        ) : (
          snapshot.endorsements.map((endorsement, position) => (
            <View key={`${endorsement.effectiveAt}-${position}`} style={styles.tableRow} wrap={false}>
              <Text style={styles.endorsementEffectiveColumn}>{formatCalendarDate(endorsement.effectiveAt)}</Text>
              <Text style={styles.endorsementRecordedColumn}>{formatUtcTimestamp(endorsement.recordedAt)}</Text>
              <Text style={styles.textColumn}>{endorsement.description}</Text>
              <Text style={styles.endorsementAmountColumn}>{formatCents(endorsement.amountChargedCents)}</Text>
              <Text style={styles.endorsementAmountColumn}>{formatCents(endorsement.annualPremiumCentsAfter)}</Text>
            </View>
          ))
        )}

        <View style={styles.totalRow} wrap={false}>
          <Text style={styles.endorsementEffectiveColumn}>{formatCalendarDate(snapshot.asOf)}</Text>
          <Text style={styles.endorsementRecordedColumn} />
          <Text style={[styles.textColumn, styles.strongCell]}>Annual premium in force</Text>
          <Text style={styles.endorsementAmountColumn} />
          <Text style={[styles.endorsementAmountColumn, styles.strongCell]}>
            {formatCents(snapshot.annualPremiumCents)}
          </Text>
        </View>

        {/* No signature block here. The schedule is an attachment to the declarations page,
            which is the sheet that carries the signature; a second set of ruled lines on the
            attachment would suggest it is a separately executed instrument. */}

        <View style={styles.footer} fixed>
          <Text style={styles.footerSentence}>{asOfStatement(snapshot)}</Text>
          <Text style={styles.footerSentence}>
            The amount charged is the prorated premium and its {snapshot.stateName} premium tax, charged
            (positive) or credited (negative) from the endorsement&apos;s effective date to the end of the
            term.
          </Text>
          <View style={styles.footerBottomRow}>
            <Text>Generated {formatUtcTimestamp(snapshot.generatedAt)}.</Text>
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

// The lines printed under the insured's name.
//
// An address is only an address when it says where: a city and a postal code. This build
// collects neither (from-database.ts puts the customer's email on line 1 and says so on
// line 2), and printing the parts it does have produced the dangling ", CA" line review
// finding F-B4-PDF reported. So when the locality is missing, the document keeps the line
// that carries a real fact and replaces the rest with one sentence that says what is
// missing. A policy issued with a full address is printed unchanged.
function mailingAddressLines(address: MailingAddress): string[] {
  const localityIsOnFile = address.city.length > 0 && address.postalCode.length > 0;
  if (!localityIsOnFile) {
    return [address.line1, "Mailing address: not collected in this build"].filter((line) => line.length > 0);
  }
  return [address.line1, address.line2, `${address.city}, ${address.state} ${address.postalCode}`].filter(
    (line) => line.length > 0,
  );
}

function describeStatus(snapshot: PolicySnapshot): string {
  if (snapshot.status === "cancelled" && snapshot.cancelledEffectiveAt) {
    return `Cancelled, effective ${formatCalendarDate(snapshot.cancelledEffectiveAt)}`;
  }
  return "In force";
}

// The sentence that keeps a reprint honest: this is not "the policy", it is the policy as it
// stood on one date, rebuilt from the events known when the file was produced.
function asOfStatement(snapshot: PolicySnapshot): string {
  return (
    `This document reproduces policy ${snapshot.policyNumber} as it stood on ` +
    `${formatCalendarDate(snapshot.asOf)}. Endorsements and corrections effective after that date ` +
    `are not shown. Regenerating it for the same as-of date from the same policy events produces ` +
    `the same figures.`
  );
}
