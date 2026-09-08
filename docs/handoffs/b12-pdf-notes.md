# B12: visual pass on the three PDF documents

Scope: presentation only. No data contract, no arithmetic, no route, no query changed. Every
figure printed still comes from the snapshot or from the stored statement run, through the
existing helpers in `lib/documents/format.ts`.

## Files changed

| File | Change |
|---|---|
| `lib/documents/pdf-theme.ts` | New. The palette, type scale, issuer strings and every named style for all three documents, built with `StyleSheet.create`. |
| `lib/documents/render.tsx` | Declarations page and endorsement schedule redressed against the theme; mailing address fix (F-B4-PDF). |
| `lib/statements/pdf.tsx` | Broker statement redressed against the same theme; column overprint fix (F-B9-08). |

Nothing else was touched: no `policy-snapshot.ts`, `policy-as-of.ts`, `from-database.ts`,
`format.ts`, `example-policy.ts`, no route, no `lib/statements/compute.ts` or `run.ts`, nothing
under `lib/money`, `lib/policy`, `lib/ledger`, `db`, `scripts` or `app`.

## What the three documents now carry

- An issuer header block: "Demo Insurer, work-trial build" with the tagline "Policy
  administration demonstration. Not an insurance carrier and not an offer of cover.", and a
  bordered "TEST DATA, SANDBOX" label. No real company name, address, phone or licence number
  anywhere on the page. The block is `fixed`, so a second page is never anonymous.
- A title band: the portal's off-white panel with an accent bar down its left edge, holding the
  document title and its subtitle.
- Key facts as a label and value grid, labels in the muted grey the portal uses.
- Tables with figures right aligned, a firm rule under the header and under the total, hairline
  rules between rows.
- A footer repeated on every page: the existing as-of or cutoff sentence, then a bottom row with
  the generation timestamp on the left and "Page X of Y" on the right, drawn with react-pdf's
  `render` prop on a `Text`.

Colours are the portal's own tokens from `app/globals.css`: ink `#191919`, muted `#5d5e63`,
hairline `#dedee1`, panel `#f6f6f6`, accent `#b83e00` (the readable accent, not the bright
`#ff5c00`, which does not hold up on paper). Black text on white, one accent, US Letter. The
endorsement schedule stays landscape Letter: five columns on a portrait page would break the
recording timestamps in the middle.

The statement keeps its revision, knowledge cutoff, content hash and format version note exactly
as they were printed before. The two footer paragraphs are unchanged word for word.

## Findings closed

- **F-B4-PDF.** The declarations page no longer prints the dangling ", CA" line. A mailing
  address is treated as present only when there is both a city and a postal code. Without them
  the block keeps the line that carries a real fact (this build puts the customer's email there)
  and prints one line: "Mailing address: not collected in this build". A policy issued with a
  full address is printed unchanged. The rule is `mailingAddressLines` in `render.tsx`.
- **F-B9-08.** The statement description column no longer overprints the amounts. Every text
  column is `flexBasis: 0`, so it takes the space the fixed columns leave and wraps inside it
  instead of keeping its natural width. Reproduced before the fix with a 160 character
  correction description and verified after.

Two related defects were found while looking at the rendered pages and fixed in the same pass:

- A table row could be cut through the middle by a page break, leaving a description alone at
  the top of a page with none of its figures. Every table row now carries `wrap={false}`.
- The "Annual charges" block and the statement "Totals" block could be split across pages,
  stranding the total. Each block now carries `wrap={false}` as a whole. A statement that spills
  produced an empty second page before this change; it does not now.

## Font choice and licence

**No font is bundled, and no font is registered.** The three documents use the standard PDF
fonts Helvetica, Helvetica-Bold and Courier, which every reader has and which embed nothing.
Rendering makes no network call and reads no file.

The portal's DM Sans and Inter were tried first and rejected on two measured facts:

1. `Font.register` on the WOFF2 files under `public/fonts` fails: fontkit cannot subset them and
   throws `RangeError: Offset is outside the bounds of the DataView`. Those exact files cannot be
   embedded.
2. Embedding an equivalent TrueType file makes @react-pdf/renderer write the text as glyph
   indexes under an Identity-H encoding. The repository's own reader,
   `lib/documents/pdf-text.ts`, decodes WinAnsi bytes, so it returns the bytes `00 01 00 02 ...`
   instead of `$1,253.20`. Every document test asserts on the text it reads back, so all nine
   would fail. `pdf-text.ts` was outside the scope of this pass, and the constraint was that the
   existing tests keep passing unchanged.

Helvetica also already has the property the figures need: in its metrics every digit is 556
units wide (checked in `node_modules/pdfkit/js/data/Helvetica.afm`), so amounts line up column
by column without a tabular figure feature. The licence question does not arise: the 14 standard
PDF fonts are part of the PDF specification and no font file is redistributed.

If the interface's exact typefaces are wanted on the documents later, it needs a TTF or OTF of
DM Sans and Inter under `lib/documents/fonts` with their OFL notices, and `pdf-text.ts` taught to
read a ToUnicode CMap. That is a change to the test tooling, not to this layer.

## Commands run, with results

| Command | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm test` | PASS, 370 tests, 369 passed, 1 skipped (the opt-in live Stripe test), 0 failed |
| `npm run build` | PASS, all 19 pages and routes compiled |
| `npx tsx lib/documents/write-sample-documents.ts <dir>` | PASS, both PDFs written |
| `gitleaks protect --staged` | PASS on each commit, no leaks |
| `git diff --check` | clean |

The build needs `node_modules` inside the worktree: Turbopack refuses a symlink that points out
of its filesystem root, so `npm ci` was run in the worktree. That is local tooling and is ignored
by Git.

Determinism, proved by rendering each document twice into two directories and comparing bytes:

```
cmp .local/det-a/declarations-...pdf .local/det-b/declarations-...pdf   identical, 4999 bytes
cmp .local/det-a/endorsement-schedule-...pdf .local/det-b/...pdf        identical, 4859 bytes
cmp .local/det-a/statement.pdf .local/det-b/statement.pdf               identical, 6004 bytes
```

The pages were inspected as images. `pdftoppm -png -r 110` (poppler) converted each PDF, and the
PNGs were read directly. Cases looked at: the worked example declarations page and endorsement
schedule, a declarations page built with the address shape `from-database.ts` actually produces,
a statement with five movements including a 160 character description, a v1 statement that is
also provisional so both callouts show, and a statement long enough to spill onto a second page.

## What was not done

- No font bundled, for the reason above. `lib/documents/fonts/` was not created.
- `lib/documents/pdf-text.ts` was not changed, so the text reader still assumes WinAnsi.
- No repeated table header on a continuation page. A `fixed` header would also repeat above the
  Totals block, which would be wrong. A statement long enough to need it has not appeared on the
  trial data.
- One judgment call outside the strict brief: the statement PDF's `author` metadata was
  `"Corgi"` and is now the demo issuer name, so the metadata agrees with the issuer printed on
  the page. Revert that one line if the coordinator prefers the old value.
- No push, no deploy, no database touched. No review run: independent review is the
  coordinator's step.
