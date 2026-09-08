import { formatBasisPoints, formatCalendarDate, formatCents, formatUtcTimestamp } from "./format";
import type { PolicySnapshot } from "./policy-snapshot";

// The two policy documents, rendered from a PolicySnapshot into a real PDF file.
//
// Both functions run on the server (Node runtime) and return a Buffer: no browser API, no
// canvas, no temporary file. The caller decides what to do with the bytes: stream them to
// the customer, attach them to an email, or write them next to a test.
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

// One shared look for both documents. These are plain objects: react-pdf styles are a small
// subset of CSS, and `as const` keeps the literal values ("row", "bold") that its types
// expect. Only the standard PDF fonts are used, so rendering never downloads anything.
const styles = {
  page: { paddingTop: 40, paddingBottom: 48, paddingHorizontal: 44, fontSize: 10, fontFamily: "Helvetica" },
  documentTitle: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  documentSubtitle: { fontSize: 10, color: "#444444", marginBottom: 16 },
  sectionTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 6 },
  row: { flexDirection: "row", paddingVertical: 3 },
  rowWithRule: { flexDirection: "row", paddingVertical: 3, borderTopWidth: 0.5, borderTopColor: "#999999" },
  label: { width: 150, color: "#444444" },
  value: { flexGrow: 1 },
  amountColumn: { width: 100, textAlign: "right" },
  descriptionColumn: { flexGrow: 1, paddingRight: 8 },
  dateColumn: { width: 105 },
  recordedColumn: { width: 150 },
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
  addressLine: { marginBottom: 1 },
  coverageDescription: { fontSize: 9, color: "#444444", marginTop: 1 },
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

// The declarations page: who is covered, for what, for how long and for how much, as the
// policy stood on the snapshot date.
export async function renderDeclarationsPdf(snapshot: PolicySnapshot): Promise<Buffer> {
  const { Document, Page, Text, View, renderToBuffer } = await loadPdfRenderer();
  const address = snapshot.insuredAddress;

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
        <Text style={styles.documentTitle}>Commercial Policy Declarations</Text>
        <Text style={styles.documentSubtitle}>
          Policy {snapshot.policyNumber} as it stood on {formatCalendarDate(snapshot.asOf)}
        </Text>

        <View style={styles.row}>
          <Text style={styles.label}>Named insured</Text>
          <View style={styles.value}>
            <Text style={styles.addressLine}>{snapshot.insuredName}</Text>
            <Text style={styles.addressLine}>{address.line1}</Text>
            {address.line2 ? <Text style={styles.addressLine}>{address.line2}</Text> : null}
            <Text style={styles.addressLine}>
              {address.city}, {address.state} {address.postalCode}
            </Text>
          </View>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Producing broker</Text>
          <Text style={styles.value}>{snapshot.brokerName}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Policy term</Text>
          <Text style={styles.value}>
            {formatCalendarDate(snapshot.termStart)} to {formatCalendarDate(snapshot.termEnd)}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Status on {formatCalendarDate(snapshot.asOf)}</Text>
          <Text style={styles.value}>{describeStatus(snapshot)}</Text>
        </View>

        <Text style={styles.sectionTitle}>Coverage</Text>
        <View style={styles.tableHeader}>
          <Text style={styles.descriptionColumn}>Coverage line</Text>
          <Text style={styles.amountColumn}>Limit</Text>
        </View>
        {snapshot.coverageLines.length === 0 ? (
          <Text style={styles.emptyState}>No coverage line was in effect on this date.</Text>
        ) : (
          snapshot.coverageLines.map((coverageLine) => (
            <View key={coverageLine.name} style={styles.rowWithRule}>
              <View style={styles.descriptionColumn}>
                <Text>{coverageLine.name}</Text>
                {coverageLine.description ? (
                  <Text style={styles.coverageDescription}>{coverageLine.description}</Text>
                ) : null}
              </View>
              <Text style={styles.amountColumn}>{formatCents(coverageLine.limitCents)}</Text>
            </View>
          ))
        )}

        <Text style={styles.sectionTitle}>Annual charges</Text>
        <View style={styles.rowWithRule}>
          <Text style={styles.descriptionColumn}>Annual premium</Text>
          <Text style={styles.amountColumn}>{formatCents(snapshot.annualPremiumCents)}</Text>
        </View>
        <View style={styles.rowWithRule}>
          <Text style={styles.descriptionColumn}>
            {snapshot.stateName} premium tax ({formatBasisPoints(snapshot.taxRateBasisPoints)})
          </Text>
          <Text style={styles.amountColumn}>{formatCents(snapshot.taxCents)}</Text>
        </View>
        <View style={styles.rowWithRule}>
          <Text style={styles.descriptionColumn}>Policy fee</Text>
          <Text style={styles.amountColumn}>{formatCents(snapshot.feeCents)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.descriptionColumn}>Total annual charge</Text>
          <Text style={styles.amountColumn}>{formatCents(snapshot.totalChargeCents)}</Text>
        </View>

        <View style={styles.footer} fixed>
          <Text>{asOfStatement(snapshot)}</Text>
          <Text>Generated {formatUtcTimestamp(snapshot.generatedAt)}.</Text>
        </View>
      </Page>
    </Document>,
  );
}

// The endorsement schedule: every change that had taken effect by the snapshot date, with
// the money it moved and the annual premium it left behind.
export async function renderEndorsementSchedulePdf(snapshot: PolicySnapshot): Promise<Buffer> {
  const { Document, Page, Text, View, renderToBuffer } = await loadPdfRenderer();

  return renderToBuffer(
    <Document
      title={`Endorsement schedule ${snapshot.policyNumber} as of ${snapshot.asOf}`}
      author={snapshot.brokerName}
      creationDate={new Date(snapshot.generatedAt)}
      modificationDate={new Date(snapshot.generatedAt)}
    >
      {/* Landscape: the schedule has five columns, and squeezing them onto a portrait page
          would wrap the recording timestamps in the middle. */}
      <Page size="LETTER" orientation="landscape" style={styles.page}>
        <Text style={styles.documentTitle}>Endorsement Schedule</Text>
        <Text style={styles.documentSubtitle}>
          Policy {snapshot.policyNumber} as it stood on {formatCalendarDate(snapshot.asOf)}
        </Text>

        <View style={styles.row}>
          <Text style={styles.label}>Named insured</Text>
          <Text style={styles.value}>{snapshot.insuredName}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Policy term</Text>
          <Text style={styles.value}>
            {formatCalendarDate(snapshot.termStart)} to {formatCalendarDate(snapshot.termEnd)}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Endorsements effective on or before {formatCalendarDate(snapshot.asOf)}</Text>
        <View style={styles.tableHeader}>
          <Text style={styles.dateColumn}>Effective</Text>
          <Text style={styles.recordedColumn}>Recorded</Text>
          <Text style={styles.descriptionColumn}>Change</Text>
          <Text style={styles.amountColumn}>Premium delta</Text>
          <Text style={styles.amountColumn}>Annual premium</Text>
        </View>

        {/* The running column starts at the premium the policy was issued with, otherwise
            the first endorsement's "annual premium" would come out of nowhere. */}
        <View style={styles.rowWithRule}>
          <Text style={styles.dateColumn}>{formatCalendarDate(snapshot.termStart)}</Text>
          <Text style={styles.recordedColumn}>-</Text>
          <Text style={styles.descriptionColumn}>Policy issued</Text>
          <Text style={styles.amountColumn}>-</Text>
          <Text style={styles.amountColumn}>{formatCents(snapshot.annualPremiumCentsAtIssuance)}</Text>
        </View>

        {snapshot.endorsements.length === 0 ? (
          <Text style={styles.emptyState}>
            No endorsement had taken effect on {formatCalendarDate(snapshot.asOf)}.
          </Text>
        ) : (
          snapshot.endorsements.map((endorsement, position) => (
            <View key={`${endorsement.effectiveAt}-${position}`} style={styles.rowWithRule}>
              <Text style={styles.dateColumn}>{formatCalendarDate(endorsement.effectiveAt)}</Text>
              <Text style={styles.recordedColumn}>{formatUtcTimestamp(endorsement.recordedAt)}</Text>
              <Text style={styles.descriptionColumn}>{endorsement.description}</Text>
              <Text style={styles.amountColumn}>{formatCents(endorsement.premiumDeltaCents)}</Text>
              <Text style={styles.amountColumn}>{formatCents(endorsement.annualPremiumCentsAfter)}</Text>
            </View>
          ))
        )}

        <View style={styles.totalRow}>
          <Text style={styles.dateColumn}>{formatCalendarDate(snapshot.asOf)}</Text>
          <Text style={styles.recordedColumn} />
          <Text style={styles.descriptionColumn}>Annual premium in force</Text>
          <Text style={styles.amountColumn} />
          <Text style={styles.amountColumn}>{formatCents(snapshot.annualPremiumCents)}</Text>
        </View>

        <View style={styles.footer} fixed>
          <Text>{asOfStatement(snapshot)}</Text>
          <Text>
            The premium delta is the prorated amount charged (positive) or credited (negative) from the
            endorsement&apos;s effective date to the end of the term. Generated{" "}
            {formatUtcTimestamp(snapshot.generatedAt)}.
          </Text>
        </View>
      </Page>
    </Document>,
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
