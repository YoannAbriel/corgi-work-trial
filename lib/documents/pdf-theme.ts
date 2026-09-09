import { readFileSync } from "node:fs";
import { join } from "node:path";
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
// The shape is the one a broker's own paperwork uses, because that is what the reader
// expects to be handed: an issuer band across the top, a boxed strip carrying the three
// facts you look up first (policy number, period, status), the parties side by side, then
// the schedules, then a signature line, then a footer that repeats on every sheet. Nothing
// here decides a figure; the layout only decides where a figure already computed upstream
// is printed.
//
// WHY THE STANDARD PDF FONTS AND NOT THE PORTAL'S DM SANS AND INTER
// The portal bundles DM Sans and Inter as WOFF2 (public/fonts). Embedding either one in a
// PDF changes how the text is written into the file: @react-pdf/renderer subsets the font
// and writes glyph indexes under an Identity-H encoding instead of readable bytes. The
// repository's own reader (lib/documents/pdf-text.ts) decodes WinAnsi bytes, which is what
// the standard fonts use, and every document test asserts on the text it reads back. Three
// measured facts settle the choice, and they have not moved since the first visual pass:
//   - fontkit cannot subset the WOFF2 files the portal ships (it throws "Offset is outside
//     the bounds of the DataView"), so those exact files cannot be embedded at all;
//   - no TTF or OTF of either family is in the repository, and fetching one would be a
//     network call during a render, which this layer must never make;
//   - embedding an equivalent TrueType file makes the reader return glyph indexes
//     (the bytes 00 01 00 02 and so on) instead of "$1,253.20", which fails every document
//     test. Teaching the reader to decode a ToUnicode CMap would mean changing
//     pdf-text.ts, which is test tooling and outside this pass.
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
  // --orange, the brand orange itself, measured on the two files in brand/. It replaced the
  // darker link orange (#b83e00) on 2026-09-09: a document has to carry the brand's colour,
  // not a variant of it invented to pass a link-contrast rule.
  //
  // WHERE IT MAY AND MAY NOT BE USED: #ff5c00 on white is about 2.9:1. That is enough for a
  // rule, a bar, a border or the logo, and not enough for text at these sizes. So no text
  // style below carries it. The issuer name (11 pt) and the sandbox label (7 pt) used to be
  // printed in the accent and are now ink; the sandbox label keeps an orange BORDER, which
  // is decoration around text that is itself dark.
  accent: "#ff5c00",
  // The diagonal watermark. Light enough that a figure printed over it stays the darkest
  // thing on the page, dark enough to survive a photocopy.
  watermark: "#e6e6ea",
} as const;

// US Letter, portrait or landscape, with the same margin on every side of every document.
const PAGE_MARGIN = 44;

// The type scale, in points. The portal's hierarchy (30 / 21 / 15 px) brought down to the
// size a printed page reads at.
const SIZE = {
  documentTitle: 17,
  issuerName: 11,
  strongFact: 10.5,
  sectionTitle: 8.5,
  body: 9.5,
  table: 8.5,
  small: 8,
  footer: 7.5,
  microLabel: 6.5,
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

// Printed diagonally across every page of every document, underneath the content.
// It is the same claim the header label makes, in the one form that survives a page being
// photographed, cropped or forwarded on its own: nobody can mistake one of these sheets for
// a real policy document.
export const WATERMARK_TEXT = "SPECIMEN, TEST DATA";

// `StyleSheet.create` is @react-pdf/renderer's identity function: it hands the object back
// unchanged and only exists to type it. It is passed in as an argument rather than imported
// at the top of this file because @react-pdf/renderer is published as ES modules only and
// both documents load it with `await import(...)` (the reason is written out in
// render.tsx). `import type` above is erased at compile time, so the only thing this file
// requires at runtime is node:fs, for the logo below, which is a builtin and loads the same
// way under both module systems.
type PdfStyleSheet = { create: <T extends Styles>(styles: T) => T };

// The other half of the same module, for the one typography decision that is not a style.
type PdfFontRegistry = { registerHyphenationCallback: (hyphenate: (word: string) => string[]) => void };

// Turn hyphenation off for every document.
//
// @react-pdf/renderer hyphenates by default, and it is right about English: it broke
// "premium" as "premi-um" at the end of a statement description column. In running prose
// that is correct typesetting; in a table cell beside a money amount it reads as a defect,
// and a broker scanning a column of descriptions should never have to reassemble a word.
// Returning the word unbroken makes a line wrap at spaces only.
//
// It is called by each renderer after the module is loaded, for the same reason the style
// sheet is built there: this file must not import @react-pdf/renderer at runtime. The
// registration is global to the module and idempotent, so calling it on every render costs
// nothing and adds no bytes that could differ between two runs.
export function applyPdfTypography(Font: PdfFontRegistry): void {
  Font.registerHyphenationCallback((word) => [word]);
}

// The Corgi wordmark printed at the top of every document.
//
// It is read off disk rather than imported, because @react-pdf/renderer draws an image from
// its BYTES: `<Image src={{ data, format }} />`. A Next.js image import would hand back a URL
// and a width, which is what a browser needs and not what a PDF writer needs.
//
// The file is the one scripts/brand-assets.mjs produces (public/brand/corgi-logo.png). It is
// resolved from process.cwd(), which is the repository root under `next dev` and `node --test`
// and the function's own root on Vercel. next.config.ts names this file in
// `outputFileTracingIncludes` for the two document routes, so the deployment actually carries
// it: public/ is uploaded to the CDN as static assets and is not otherwise guaranteed to be
// inside the serverless function.
//
// Read once per process and kept, for the same reason the module is: rendering a statement
// must not do a file read per page. The same bytes every time also keeps a render
// byte-identical to the one before it, which lib/documents/render.test.ts asserts.
let cachedWordmarkPng: Buffer | undefined;

export function corgiWordmarkPng(): { data: Buffer; format: "png" } {
  cachedWordmarkPng ??= readFileSync(join(process.cwd(), "public", "brand", "corgi-logo.png"));
  return { data: cachedWordmarkPng, format: "png" };
}

export function createPdfStyles(StyleSheet: PdfStyleSheet) {
  return StyleSheet.create({
    // ---- the page ------------------------------------------------------------------
    // paddingBottom reserves the room the fixed footer occupies: the footer is positioned
    // absolutely, so it is out of the flow and would otherwise be printed over.
    page: {
      paddingTop: PAGE_MARGIN,
      paddingBottom: 94,
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

    // ---- the diagonal watermark --------------------------------------------------------
    // A full-page absolutely positioned layer, written as the FIRST child of the page so
    // everything else is drawn on top of it: @react-pdf/renderer paints in document order,
    // and text has no background, so the grey letters show between the glyphs the way a
    // watermark should. `fixed` on the element repeats it on every sheet.
    watermarkLayer: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      alignItems: "center",
      justifyContent: "center",
    },
    // 38 points bold with 3 points of tracking measures about 500 points for the 19
    // characters of WATERMARK_TEXT, so it never wraps inside a 612 point portrait page and
    // still reaches corner to corner once it is turned.
    watermarkText: {
      fontSize: 38,
      fontFamily: PDF_FONT.bold,
      color: PDF_COLOR.watermark,
      letterSpacing: 3,
      transform: "rotate(-30deg)",
    },

    // ---- issuer header ---------------------------------------------------------------
    issuerHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      borderBottomWidth: 1,
      borderBottomColor: PDF_COLOR.ink,
      paddingBottom: 8,
      marginBottom: 12,
    },
    // The Corgi wordmark, left of the issuer. Both numbers are written out because the source
    // is 1200 x 363 (ratio 3.306) and a PDF image with one dimension missing is stretched to
    // whatever the box gives it. 28 points high is roughly the cap height of the title band
    // below it, so the two read as one masthead.
    issuerLogo: { height: 28, width: 92.6, marginRight: 14 },
    issuerLogoStatement: { height: 22, width: 72.7, marginRight: 12 },
    issuerIdentity: { flexGrow: 1, flexBasis: 0, paddingRight: 12 },
    // Ink, not the accent: 11 point bold in #ff5c00 measures 2.9:1 on white, which is a rule's
    // contrast and not a name's. The orange in this header is the logo beside it.
    issuerName: { fontSize: SIZE.issuerName, fontFamily: PDF_FONT.bold, color: PDF_COLOR.ink },
    issuerTagline: { fontSize: SIZE.footer, color: PDF_COLOR.inkMuted, marginTop: 2 },
    // 7 point text, so the smallest thing on the page: dark ink inside an orange border.
    sandboxLabel: {
      fontSize: 7,
      fontFamily: PDF_FONT.bold,
      color: PDF_COLOR.ink,
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
      marginBottom: 12,
      overflow: "hidden",
    },
    titleBandAccentBar: { width: 4, backgroundColor: PDF_COLOR.accent },
    titleBandBody: {
      flexGrow: 1,
      flexBasis: 0,
      paddingVertical: 12,
      paddingHorizontal: 14,
      justifyContent: "center",
    },
    documentTitle: { fontSize: SIZE.documentTitle, fontFamily: PDF_FONT.bold },
    documentSubtitle: { fontSize: SIZE.body, color: PDF_COLOR.inkMuted, marginTop: 3 },
    // The right-hand end of the band: the one identifier a caller reads out on the phone.
    titleBandIdentifier: {
      justifyContent: "center",
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderLeftWidth: 0.8,
      borderLeftColor: PDF_COLOR.hairline,
      alignItems: "flex-end",
    },

    // ---- the boxed strip of headline facts ---------------------------------------------
    // Three or four cells across, each a small upright label over one value. It is the
    // block a broker's eye goes to first, so it sits directly under the title.
    summaryStrip: {
      flexDirection: "row",
      borderWidth: 0.8,
      borderColor: PDF_COLOR.hairline,
      borderRadius: 5,
      marginBottom: 14,
    },
    summaryCell: { flexGrow: 1, flexBasis: 0, paddingVertical: 9, paddingHorizontal: 12 },
    // Every cell but the first carries the rule that separates it from the one before.
    summaryCellDivided: {
      flexGrow: 1,
      flexBasis: 0,
      paddingVertical: 9,
      paddingHorizontal: 12,
      borderLeftWidth: 0.8,
      borderLeftColor: PDF_COLOR.hairline,
    },
    summaryValue: { fontSize: SIZE.strongFact, fontFamily: PDF_FONT.bold },

    // A small upright label. Used above a strip value, above a party block and as a column
    // heading, so all three read as the same kind of thing.
    microLabel: {
      fontSize: SIZE.microLabel,
      fontFamily: PDF_FONT.bold,
      letterSpacing: 0.8,
      textTransform: "uppercase",
      color: PDF_COLOR.inkMuted,
      marginBottom: 3,
    },

    // ---- the parties, side by side -----------------------------------------------------
    partiesRow: { flexDirection: "row", marginBottom: 4 },
    partyBlock: { flexGrow: 1, flexBasis: 0, paddingRight: 22 },
    partyName: { fontSize: SIZE.strongFact, fontFamily: PDF_FONT.bold, marginBottom: 3 },
    partyLine: { marginBottom: 1.5 },
    partyNote: { fontSize: SIZE.footer, color: PDF_COLOR.inkMuted, marginTop: 5 },

    // ---- key facts, as a label and value grid ------------------------------------------
    factRow: { flexDirection: "row", paddingVertical: 3.5 },
    factLabel: { width: 150, color: PDF_COLOR.inkMuted },
    factValue: { flexGrow: 1, flexBasis: 0 },
    // 8.5 point Courier is 5.1 points per character, so a 64-character sha256 measures 327
    // points and stays on one line inside the 374 point value column. A hash broken across
    // two lines cannot be compared with the one on a screen.
    factValueMono: { flexGrow: 1, flexBasis: 0, fontFamily: PDF_FONT.mono, fontSize: 8.5 },

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
      letterSpacing: 0.9,
      textTransform: "uppercase",
      marginTop: 15,
      marginBottom: 6,
    },
    // The sentence under a section title that says what the section is answering, and on
    // which date. It is what turns "Coverage" into "coverage as it stood on October 1".
    sectionCaption: {
      fontSize: SIZE.footer,
      color: PDF_COLOR.inkMuted,
      marginTop: -3,
      marginBottom: 6,
    },
    tableHeader: {
      flexDirection: "row",
      paddingBottom: 5,
      borderBottomWidth: 1,
      borderBottomColor: PDF_COLOR.ink,
    },
    // Applied to each heading Text rather than to the row: @react-pdf/renderer does not
    // inherit fontFamily from a View down to the Text inside it, so a bold set on the row
    // silently did nothing.
    // The tracking is 0.5 rather than the 0.8 of `microLabel`: a heading sits in a fixed
    // column and has to fit it. "PREMIUM IN IT" is 13 characters, which is 57 points of
    // 6.5 point bold plus 6 points of tracking, inside the statement's 66 point amount
    // column. At 0.8 it grew past the column and crowded the heading beside it.
    tableHeaderCell: {
      fontSize: SIZE.microLabel,
      fontFamily: PDF_FONT.bold,
      letterSpacing: 0.5,
      textTransform: "uppercase",
      color: PDF_COLOR.inkMuted,
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
      fontSize: SIZE.table,
    },
    // Same reason as tableHeaderCell: the weight has to be on the Text.
    strongCell: { fontFamily: PDF_FONT.bold },
    emptyState: { paddingVertical: 10, color: PDF_COLOR.inkMuted, fontSize: SIZE.table },
    // Every text column is `flexBasis: 0` so it takes its share of the free space and wraps
    // inside it. Without that, a long description keeps its natural width and prints on top
    // of the amount beside it (review finding F-B9-08).
    textColumn: { flexGrow: 1, flexBasis: 0, paddingRight: 10 },
    // A secondary sentence under a coverage name.
    columnDetail: { fontSize: SIZE.footer, color: PDF_COLOR.inkMuted, marginTop: 2 },

    // ---- a boxed money summary ----------------------------------------------------------
    // The premium summary on the declarations page and the totals on the statement. A box
    // rather than loose rows: it is the block the reader is looking for, and the total is
    // shaded so the eye stops on it.
    moneyBox: {
      borderWidth: 0.8,
      borderColor: PDF_COLOR.hairline,
      borderRadius: 5,
      overflow: "hidden",
    },
    moneyBoxRow: {
      flexDirection: "row",
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderTopWidth: 0.5,
      borderTopColor: PDF_COLOR.hairline,
      fontSize: SIZE.table,
    },
    // The first row inside the box: the box's own border is already there, so it takes no
    // rule of its own.
    moneyBoxFirstRow: {
      flexDirection: "row",
      paddingVertical: 6,
      paddingHorizontal: 12,
      fontSize: SIZE.table,
    },
    moneyBoxTotalRow: {
      flexDirection: "row",
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderTopWidth: 1,
      borderTopColor: PDF_COLOR.ink,
      backgroundColor: PDF_COLOR.band,
      fontSize: SIZE.body,
    },
    // The sentence printed under a money box: what the figures above are, and as of when.
    boxCaption: { fontSize: SIZE.footer, color: PDF_COLOR.inkMuted, marginTop: 5 },

    // ---- the two policy documents (lib/documents/render.tsx) --------------------------
    // Portrait Letter: 612 points wide, 44 of margin on each side, so 524 to divide up.
    limitColumn: { width: 120, textAlign: "right" },
    chargeAmountColumn: { width: 110, textAlign: "right" },
    // The endorsement summary on the declarations page: effective date, what changed, and
    // the money that change moved. 92 + 100 of fixed columns leave 332 for the sentence.
    endorsementSummaryDateColumn: { width: 92, paddingRight: 6 },
    endorsementSummaryAmountColumn: { width: 100, textAlign: "right" },
    // Landscape Letter for the endorsement schedule: 792 wide, so 704 to divide up.
    endorsementEffectiveColumn: { width: 92, paddingRight: 6 },
    endorsementRecordedColumn: { width: 128, paddingRight: 6 },
    endorsementAmountColumn: { width: 100, textAlign: "right" },

    // ---- signature and date --------------------------------------------------------------
    // Two ruled lines a countersigning office would write on. They are printed empty: this
    // build signs nothing, and the caption under them says so rather than letting a blank
    // rule imply a signature that was never applied.
    signatureRow: { flexDirection: "row", marginTop: 14 },
    signatureCell: { flexGrow: 1, flexBasis: 0, paddingRight: 40 },
    signatureDateCell: { width: 190 },
    signatureRule: {
      height: 20,
      borderBottomWidth: 0.8,
      borderBottomColor: PDF_COLOR.ink,
      marginBottom: 4,
    },
    signatureCaption: { fontSize: SIZE.footer, color: PDF_COLOR.inkMuted, marginTop: 2 },

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
    // Inside the money box the row is indented by the box's 12 points of padding on each
    // side, so the amount column is measured against 500 points rather than 524.
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
