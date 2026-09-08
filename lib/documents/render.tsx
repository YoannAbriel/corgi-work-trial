import { formatBasisPoints, formatCalendarDate, formatCents, formatUtcTimestamp } from "./format";
import { ISSUER_NAME, ISSUER_TAGLINE, SANDBOX_LABEL, createPdfStyles } from "./pdf-theme";
import type { MailingAddress, PolicySnapshot } from "./policy-snapshot";

// The two policy documents, rendered from a PolicySnapshot into a real PDF file.
//
// Both functions run on the server (Node runtime) and return a Buffer: no browser API, no
// canvas, no temporary file. The caller decides what to do with the bytes: stream them to
// the customer, attach them to an email, or write them next to a test.
//
// Nothing here computes money. Every figure printed is a field of the snapshot, passed
// through the formatters in format.ts. Reordering a row changes where a reader looks; it
// can never change what the document says.
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
  const { Document, Page, Text, View, StyleSheet, renderToBuffer } = await loadPdfRenderer();
  // The look lives in pdf-theme.ts, shared with the endorsement schedule and the broker
  // statement. StyleSheet arrives from the dynamically loaded module, so the sheet is built
  // here rather than at the top of the file.
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
        </View>

        <View style={styles.factRow}>
          <Text style={styles.factLabel}>Named insured</Text>
          <View style={styles.factValue}>
            <Text style={styles.factValueLine}>{snapshot.insuredName}</Text>
            {mailingAddressLines(snapshot.insuredAddress).map((line) => (
              <Text key={line} style={styles.factValueLine}>
                {line}
              </Text>
            ))}
          </View>
        </View>
        <View style={styles.factRow}>
          <Text style={styles.factLabel}>Producing broker</Text>
          <Text style={styles.factValue}>{snapshot.brokerName}</Text>
        </View>
        <View style={styles.factRow}>
          <Text style={styles.factLabel}>Policy term</Text>
          <Text style={styles.factValue}>
            {formatCalendarDate(snapshot.termStart)} to {formatCalendarDate(snapshot.termEnd)}
          </Text>
        </View>
        <View style={styles.factRow}>
          <Text style={styles.factLabel}>Status on {formatCalendarDate(snapshot.asOf)}</Text>
          <Text style={styles.factValue}>{describeStatus(snapshot)}</Text>
        </View>

        {/* `wrap={false}` on a coverage row: a row that does not fit moves whole to the next
            page instead of being cut through the middle, leaving its limit on one page and
            its name on another. The coverage table itself may be any length, so only its
            rows are protected, not the table. */}
        <Text style={styles.sectionTitle}>Coverage</Text>
        <View style={styles.tableHeader}>
          <Text style={styles.textColumn}>Coverage line</Text>
          <Text style={styles.limitColumn}>Limit</Text>
        </View>
        {snapshot.coverageLines.length === 0 ? (
          <Text style={styles.emptyState}>No coverage line was in effect on this date.</Text>
        ) : (
          snapshot.coverageLines.map((coverageLine) => (
            <View key={coverageLine.name} style={styles.tableRow} wrap={false}>
              <View style={styles.textColumn}>
                <Text>{coverageLine.name}</Text>
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
          <Text style={styles.sectionTitle}>Annual charges</Text>
          <View style={styles.tableRow}>
            <Text style={styles.textColumn}>Annual premium</Text>
            <Text style={styles.chargeAmountColumn}>{formatCents(snapshot.annualPremiumCents)}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.textColumn}>
              {snapshot.stateName} premium tax ({formatBasisPoints(snapshot.taxRateBasisPoints)})
            </Text>
            <Text style={styles.chargeAmountColumn}>{formatCents(snapshot.taxCents)}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.textColumn}>Policy fee</Text>
            <Text style={styles.chargeAmountColumn}>{formatCents(snapshot.feeCents)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.textColumn}>Total annual charge</Text>
            <Text style={styles.chargeAmountColumn}>{formatCents(snapshot.totalChargeCents)}</Text>
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
export async function renderEndorsementSchedulePdf(snapshot: PolicySnapshot): Promise<Buffer> {
  const { Document, Page, Text, View, StyleSheet, renderToBuffer } = await loadPdfRenderer();
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
        </View>

        <View style={styles.factRow}>
          <Text style={styles.factLabel}>Named insured</Text>
          <Text style={styles.factValue}>{snapshot.insuredName}</Text>
        </View>
        <View style={styles.factRow}>
          <Text style={styles.factLabel}>Producing broker</Text>
          <Text style={styles.factValue}>{snapshot.brokerName}</Text>
        </View>
        <View style={styles.factRow}>
          <Text style={styles.factLabel}>Policy term</Text>
          <Text style={styles.factValue}>
            {formatCalendarDate(snapshot.termStart)} to {formatCalendarDate(snapshot.termEnd)}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Endorsements effective on or before {formatCalendarDate(snapshot.asOf)}</Text>
        <View style={styles.tableHeader}>
          <Text style={styles.endorsementEffectiveColumn}>Effective</Text>
          <Text style={styles.endorsementRecordedColumn}>Recorded</Text>
          <Text style={styles.textColumn}>Change</Text>
          <Text style={styles.endorsementAmountColumn}>Premium delta</Text>
          <Text style={styles.endorsementAmountColumn}>Annual premium</Text>
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
              <Text style={styles.endorsementAmountColumn}>{formatCents(endorsement.premiumDeltaCents)}</Text>
              <Text style={styles.endorsementAmountColumn}>{formatCents(endorsement.annualPremiumCentsAfter)}</Text>
            </View>
          ))
        )}

        <View style={styles.totalRow} wrap={false}>
          <Text style={styles.endorsementEffectiveColumn}>{formatCalendarDate(snapshot.asOf)}</Text>
          <Text style={styles.endorsementRecordedColumn} />
          <Text style={styles.textColumn}>Annual premium in force</Text>
          <Text style={styles.endorsementAmountColumn} />
          <Text style={styles.endorsementAmountColumn}>{formatCents(snapshot.annualPremiumCents)}</Text>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerSentence}>{asOfStatement(snapshot)}</Text>
          <Text style={styles.footerSentence}>
            The premium delta is the prorated amount charged (positive) or credited (negative) from the
            endorsement&apos;s effective date to the end of the term.
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
