import type { Styles } from "@react-pdf/renderer";

// The look of every PDF this application produces: the two policy documents
// (lib/documents/render.tsx) and the broker statement (lib/statements/pdf.tsx).
//
// One file holds all of it on purpose. A visual change (a colour, a margin, the width of a
// column) is made here and nowhere else, so nobody has to hunt through JSX to find why two
// documents disagree about a rule or a font size.
//
// The palette and the type hierarchy are the portal's own (app/globals.css): the same ink,
// the same muted grey, the same hairline, the same off-white panel and the same readable
// accent. A document printed from the application should look like it came from the
// application.
//
// WHY THE STANDARD PDF FONTS AND NOT THE PORTAL'S DM SANS AND INTER
// The portal bundles DM Sans and Inter as WOFF2 (public/fonts). Embedding either one in a
// PDF changes how the text is written into the file: @react-pdf/renderer subsets the font
// and writes glyph indexes under an Identity-H encoding instead of readable bytes. The
// repository's own reader (lib/documents/pdf-text.ts) decodes WinAnsi bytes, which is what
// the standard fonts use, and every document test asserts on the text it reads back. Two
// measured facts settled the choice:
//   - fontkit cannot subset the WOFF2 files the portal ships (it throws "Offset is outside
//     the bounds of the DataView"), so those exact files cannot be embedded at all;
//   - embedding an equivalent TrueType file makes the reader return glyph indexes
//     (the bytes 00 01 00 02 and so on) instead of "$1,253.20", which fails every test.
// Helvetica also already has the property the figures need: in its metrics every digit is
// 556 units wide, so amounts line up column by column without asking for a tabular figure
// feature. Standard fonts embed nothing, download nothing and add no bytes that could
// differ between two runs, which is what the determinism tests need.
export const PDF_FONT = {
  body: "Helvetica",
  bold: "Helvetica-Bold",
  // Used for the statement's content hash: a fixed-width font is how a reader compares two
  // hashes character by character.
  mono: "Courier",
} as const;

// The portal's palette (app/globals.css :root). Black text on white, one accent, nothing
// that turns into a grey smear on an office printer.
export const PDF_COLOR = {
  ink: "#191919", // --ink, the text colour
  inkMuted: "#5d5e63", // --ink-2, labels and secondary sentences
  hairline: "#dedee1", // --line, the rule between two table rows
  band: "#f6f6f6", // --bg, the title band and the callout background
  accent: "#b83e00", // --accent, the readable orange the portal uses for links
} as const;

// US Letter, portrait or landscape, with the same margin on every side of every document.
const PAGE_MARGIN = 44;

// The type scale, in points. The portal's hierarchy (30 / 21 / 15 px) brought down to the
// size a printed page reads at.
const SIZE = {
  documentTitle: 17,
  issuerName: 11,
  sectionTitle: 10,
  body: 9.5,
  table: 8.5,
  small: 8,
  footer: 7.5,
} as const;

// The issuer printed at the top of every document.
//
// This build is a work trial, not a carrier. AF-02 and AF-04 forbid dressing it up as one:
// no real company's legal name, no address, no phone number, no licence number, and a
// label saying what the figures are. The name below is deliberately not a real insurer.
export const ISSUER_NAME = "Demo Insurer, work-trial build";
export const ISSUER_TAGLINE =
  "Policy administration demonstration. Not an insurance carrier and not an offer of cover.";
export const SANDBOX_LABEL = "TEST DATA, SANDBOX";

// `StyleSheet.create` is @react-pdf/renderer's identity function: it hands the object back
// unchanged and only exists to type it. It is passed in as an argument rather than imported
// at the top of this file because @react-pdf/renderer is published as ES modules only and
// both documents load it with `await import(...)` (the reason is written out in
// render.tsx). `import type` above is erased at compile time, so this file still requires
// nothing at runtime.
type PdfStyleSheet = { create: <T extends Styles>(styles: T) => T };

export function createPdfStyles(StyleSheet: PdfStyleSheet) {
  return StyleSheet.create({
    // ---- the page ------------------------------------------------------------------
    // paddingBottom reserves the room the fixed footer occupies: the footer is positioned
    // absolutely, so it is out of the flow and would otherwise be printed over.
    page: {
      paddingTop: PAGE_MARGIN,
      paddingBottom: 100,
      paddingHorizontal: PAGE_MARGIN,
      fontSize: SIZE.body,
      fontFamily: PDF_FONT.body,
      color: PDF_COLOR.ink,
      backgroundColor: "#ffffff",
    },
    // The statement's footer carries two long paragraphs, so it needs more room than the
    // policy documents do.
    pageWithTallFooter: {
      paddingTop: PAGE_MARGIN,
      paddingBottom: 132,
      paddingHorizontal: PAGE_MARGIN,
      fontSize: SIZE.body,
      fontFamily: PDF_FONT.body,
      color: PDF_COLOR.ink,
      backgroundColor: "#ffffff",
    },

    // ---- issuer header ---------------------------------------------------------------
    issuerHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      borderBottomWidth: 1,
      borderBottomColor: PDF_COLOR.ink,
      paddingBottom: 8,
      marginBottom: 14,
    },
    issuerIdentity: { flexGrow: 1, flexBasis: 0, paddingRight: 12 },
    issuerName: { fontSize: SIZE.issuerName, fontFamily: PDF_FONT.bold, color: PDF_COLOR.accent },
    issuerTagline: { fontSize: SIZE.footer, color: PDF_COLOR.inkMuted, marginTop: 2 },
    sandboxLabel: {
      fontSize: 7,
      fontFamily: PDF_FONT.bold,
      color: PDF_COLOR.accent,
      letterSpacing: 0.6,
      borderWidth: 0.8,
      borderColor: PDF_COLOR.accent,
      borderRadius: 3,
      paddingVertical: 3,
      paddingHorizontal: 6,
    },

    // ---- title band ------------------------------------------------------------------
    // The band echoes the portal's rounded off-white panels, with an accent bar down its
    // left edge so the eye lands on the document's name first.
    titleBand: {
      flexDirection: "row",
      backgroundColor: PDF_COLOR.band,
      borderRadius: 6,
      marginBottom: 18,
      overflow: "hidden",
    },
    titleBandAccentBar: { width: 4, backgroundColor: PDF_COLOR.accent },
    titleBandBody: { flexGrow: 1, flexBasis: 0, paddingVertical: 12, paddingHorizontal: 14 },
    documentTitle: { fontSize: SIZE.documentTitle, fontFamily: PDF_FONT.bold },
    documentSubtitle: { fontSize: SIZE.body, color: PDF_COLOR.inkMuted, marginTop: 3 },

    // ---- key facts, as a label and value grid ----------------------------------------
    factRow: { flexDirection: "row", paddingVertical: 3.5 },
    factLabel: { width: 150, color: PDF_COLOR.inkMuted },
    factValue: { flexGrow: 1, flexBasis: 0 },
    // 8.5 point Courier is 5.1 points per character, so a 64-character sha256 measures 327
    // points and stays on one line inside the 374 point value column. A hash broken across
    // two lines cannot be compared with the one on a screen.
    factValueMono: { flexGrow: 1, flexBasis: 0, fontFamily: PDF_FONT.mono, fontSize: 8.5 },
    factValueLine: { marginBottom: 1 },

    // ---- a callout, for a warning the reader must not miss ---------------------------
    callout: {
      backgroundColor: PDF_COLOR.band,
      borderLeftWidth: 3,
      borderLeftColor: PDF_COLOR.accent,
      borderRadius: 4,
      padding: 10,
      marginBottom: 12,
    },

    // ---- sections and tables ----------------------------------------------------------
    sectionTitle: {
      fontSize: SIZE.sectionTitle,
      fontFamily: PDF_FONT.bold,
      marginTop: 20,
      marginBottom: 7,
    },
    tableHeader: {
      flexDirection: "row",
      paddingBottom: 5,
      borderBottomWidth: 1,
      borderBottomColor: PDF_COLOR.ink,
      fontFamily: PDF_FONT.bold,
      fontSize: SIZE.small,
    },
    tableRow: {
      flexDirection: "row",
      paddingVertical: 5,
      borderTopWidth: 0.5,
      borderTopColor: PDF_COLOR.hairline,
      fontSize: SIZE.table,
    },
    totalRow: {
      flexDirection: "row",
      paddingVertical: 6,
      borderTopWidth: 1,
      borderTopColor: PDF_COLOR.ink,
      fontFamily: PDF_FONT.bold,
      fontSize: SIZE.table,
    },
    emptyState: { paddingVertical: 10, color: PDF_COLOR.inkMuted, fontSize: SIZE.table },
    // Every text column is `flexBasis: 0` so it takes its share of the free space and wraps
    // inside it. Without that, a long description keeps its natural width and prints on top
    // of the amount beside it (review finding F-B9-08).
    textColumn: { flexGrow: 1, flexBasis: 0, paddingRight: 10 },
    // A secondary sentence under a coverage name.
    columnDetail: { fontSize: SIZE.footer, color: PDF_COLOR.inkMuted, marginTop: 2 },

    // ---- the two policy documents (lib/documents/render.tsx) --------------------------
    // Portrait Letter: 612 points wide, 44 of margin on each side, so 524 to divide up.
    limitColumn: { width: 110, textAlign: "right" },
    chargeAmountColumn: { width: 110, textAlign: "right" },
    // Landscape Letter for the endorsement schedule: 792 wide, so 704 to divide up.
    endorsementEffectiveColumn: { width: 92, paddingRight: 6 },
    endorsementRecordedColumn: { width: 128, paddingRight: 6 },
    endorsementAmountColumn: { width: 100, textAlign: "right" },

    // ---- the broker statement (lib/statements/pdf.tsx) --------------------------------
    // The movements table has six columns on a portrait page, two more than any other table
    // here, so it is set one point smaller than the rest. At 8 points Helvetica is about 4.45
    // points per character, which is what the widths below are measured against: 88 holds
    // "September 30, 2028", 92 holds "Commission clawback" and 66 holds an amount in the
    // millions.
    statementTableRow: {
      flexDirection: "row",
      paddingVertical: 5,
      borderTopWidth: 0.5,
      borderTopColor: PDF_COLOR.hairline,
      fontSize: SIZE.small,
    },
    // 88 + 92 + 48 + 66 + 66 = 360 of fixed columns, leaving 164 for the description to wrap
    // in. Each fixed text column carries its own right padding, so a value that fills its
    // width still shows a gap before the next column instead of touching it.
    statementDateColumn: { width: 88, paddingRight: 6 },
    statementKindColumn: { width: 92, paddingRight: 6 },
    statementPolicyColumn: { width: 48, paddingRight: 6 },
    statementAmountColumn: { width: 66, textAlign: "right" },
    statementTotalAmountColumn: { width: 110, textAlign: "right" },

    // ---- footer, repeated on every page ------------------------------------------------
    footer: {
      position: "absolute",
      left: PAGE_MARGIN,
      right: PAGE_MARGIN,
      bottom: 26,
      borderTopWidth: 0.5,
      borderTopColor: PDF_COLOR.hairline,
      paddingTop: 7,
      fontSize: SIZE.footer,
      color: PDF_COLOR.inkMuted,
    },
    footerSentence: { marginBottom: 5 },
    footerBottomRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      borderTopWidth: 0.5,
      borderTopColor: PDF_COLOR.hairline,
      paddingTop: 5,
    },
    footerPageNumber: { textAlign: "right" },
  });
}
