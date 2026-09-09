// Crop the watercolour drawings so their subject fills the box the interface draws them in.
//
// Why: the files in public/illustrations/library are drawn on a big sheet of white paper with wide
// empty margins. At the sizes the interface uses them, those margins eat the frame and the subject
// comes out small: a corgi of about 30 px inside the band's 52 px vignette, and about 80 px inside
// a 200 px empty state. This script writes cropped copies beside the originals, which it never
// touches: the library files stay as they are for anything that wants the whole sheet.
//
// Two output sets, one pass each:
//   public/illustrations/band/   208 px squares, for the 52 px vignette of the page band;
//   public/illustrations/empty/  480 px on the long side, aspect ratio kept, for the empty states.
//
// The empty states keep the drawing's own shape on purpose: a magnifying glass is tall, a bird on
// a branch is wide, and squaring either of them would only add paper back.
//
// Run it with: npm run illustrations:crop
//
// Yoann, 2026-09-09 (band), extended the same evening for the empty states.

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = path.join(repositoryRoot, "public/illustrations/library");

// The files the band actually draws. Read off the `SECTIONS` map in components/shell/sections.tsx
// (one illustration name per section), then resolved to file names through the `illustrations` map
// in components/decorative-illustration.tsx. Kept as a plain list on purpose: a script that parsed
// two TypeScript files to rediscover it would be harder to read than the list itself. If a section
// changes its illustration, add the file here and run the script again.
const BAND_FILES = [
  "071-corgi-archivist.webp", // policies
  "073-corgi-broker-satchel.webp", // verification (Brokers)
  "074-corgi-accountant.webp", // statements
  "075-corgi-checker.webp", // approvals
  "076-corgi-researcher.webp", // reconciliation
  "093-corgi-courier.webp", // inbox
  "098-corgi-mechanic.webp", // infra
  "099-corgi-electrician.webp", // mcp-keys
  "106-corgi-welcoming.webp", // home and login
  "112-corgi-umbrella.webp", // claims
  "118-corgi-reading.webp", // ledger
  "119-corgi-laptop-work.webp", // console
  "126-corgi-map-explorer.webp", // search
];

// The files the empty states draw. Collected with `grep -rn "<EmptyState" -A 2 app components` and
// resolved through the same `illustrations` map. Same reasoning as above: a written list beats a
// script that reads TypeScript.
const EMPTY_FILES = [
  "002-closed-folder.webp", // closed-folder
  "007-magnifying-glass.webp", // magnifying-glass
  "015-in-tray.webp", // in-tray
  "019-open-ledger.webp", // open-ledger
  "020-balance-scales.webp", // balance-scales
  "026-shield-leaf.webp", // shield-leaf
  "027-umbrella.webp", // umbrella
  "031-safety-net.webp", // safety-net
  "035-broken-link.webp", // broken-link
  "036-connected-link.webp", // connected-link
  "039-key-ring.webp", // key-ring
  "045-bird-branch.webp", // all-clear
  "067-corgi-search.webp", // search-corgi
  "068-corgi-sleeping.webp", // sleeping-corgi
  "069-corgi-guard.webp", // coverage-corgi
  "073-corgi-broker-satchel.webp", // broker-corgi
  "074-corgi-accountant.webp", // accountant-corgi
  "075-corgi-checker.webp", // checker-corgi
  "081-corgi-engineer.webp", // engineer-corgi
];

// How far a pixel may sit from the corner colour and still count as paper to cut away. Measured on
// this set at 20, 30 and 40: the three agree to within one or two pixels, because the paper is a
// flat white and the drawings never fade into it. 30 is the middle of the range that was tried, so
// neither a slightly greyer scan nor a paler wash changes the crop.
const PAPER_THRESHOLD = 30;

// The subject does not touch the edge of its frame: a margin of this share of the cropped size is
// added back all round, so the radial mask fades over paper and not over an ear.
const MARGIN_SHARE = 0.08;

// A drawing whose subject already covers this much of its long side is left on its library file:
// cropping it would move a handful of pixels and cost a second copy of the same picture for
// nothing. Several of the monochrome objects are drawn edge to edge and land here.
const ALREADY_FILLS_ITS_FRAME = 0.85;

// Four times the band's 52 px slot, so the picture stays sharp on a retina screen at the 96 px the
// stylesheet asks for in components/decorative-illustration.tsx.
const BAND_SIZE = 208;

// Between two and three times the 200 px an empty state draws, on the long side. Same reason.
const EMPTY_LONG_SIDE = 480;

const WEBP_QUALITY = 82;

// The paper the drawings are made on. Used for the margin added back around the crop, so it is the
// same white as the drawing's own background and no grey edge appears under the mask.
const PAPER_COLOUR = { r: 255, g: 255, b: 255, alpha: 1 };

// Centre a rectangle inside a box, as whole pixels on every edge.
function paddingToCentre(width, height, boxWidth, boxHeight) {
  const left = Math.floor((boxWidth - width) / 2);
  const top = Math.floor((boxHeight - height) / 2);
  return { top, left, bottom: boxHeight - height - top, right: boxWidth - width - left };
}

// Where the paper ends and the drawing begins. `.trim()` reports, in `info.trimOffsetLeft/Top`,
// how far it shifted the original; the crop's own corner is the absolute value of that. Reading
// the trimmed bytes back is the simplest way to learn the crop's size without guessing.
async function findTheSubject(sourcePath) {
  const original = await sharp(sourcePath).metadata();
  const trimmed = await sharp(sourcePath).trim({ threshold: PAPER_THRESHOLD }).toBuffer({ resolveWithObject: true });
  return {
    original,
    data: trimmed.data,
    width: trimmed.info.width,
    height: trimmed.info.height,
    left: Math.abs(trimmed.info.trimOffsetLeft ?? 0),
    top: Math.abs(trimmed.info.trimOffsetTop ?? 0),
  };
}

// Add the margin back, then resize. Two passes on purpose: inside one sharp pipeline the resize
// runs before the extend whatever the order of the calls, so a single pipeline resized first and
// padded around the result, and the file came out 532x338 instead of the square it asked for.
async function writeCrop(subject, boxWidth, boxHeight, targetWidth, targetHeight, outputPath) {
  const padded = await sharp(subject.data)
    .extend({ ...paddingToCentre(subject.width, subject.height, boxWidth, boxHeight), background: PAPER_COLOUR })
    .toBuffer();
  await sharp(padded).resize(targetWidth, targetHeight, { fit: "fill" }).webp({ quality: WEBP_QUALITY }).toFile(outputPath);
}

// The band vignette is a 52 px circle behind a radial mask, so every band copy is a square: a
// portrait drawing left in its own shape would be masked down to a sliver.
async function cropForTheBand(fileName, outputDirectory) {
  const subject = await findTheSubject(path.join(sourceDirectory, fileName));
  const margin = Math.round(Math.max(subject.width, subject.height) * MARGIN_SHARE);
  const side = Math.max(subject.width, subject.height) + margin * 2;
  await writeCrop(subject, side, side, BAND_SIZE, BAND_SIZE, path.join(outputDirectory, fileName));
  console.log(
    `${fileName}: ${subject.original.width}x${subject.original.height} -> crop ${subject.width}x${subject.height}` +
      ` at ${subject.left},${subject.top} -> square ${side} -> ${BAND_SIZE}px`,
  );
}

// The empty state keeps the drawing's own shape: the stylesheet gives it a 200 px box and
// `object-fit: contain` does the rest.
async function cropForAnEmptyState(fileName, outputDirectory) {
  const subject = await findTheSubject(path.join(sourceDirectory, fileName));
  const longSideBefore = Math.max(subject.original.width, subject.original.height);
  const fills = Math.max(subject.width, subject.height) / longSideBefore;
  if (fills >= ALREADY_FILLS_ITS_FRAME) {
    console.log(
      `${fileName}: crop ${subject.width}x${subject.height} fills ${Math.round(fills * 100)}% of its long side,` +
        ` already full: left on the library file`,
    );
    return false;
  }

  const margin = Math.round(Math.max(subject.width, subject.height) * MARGIN_SHARE);
  const boxWidth = subject.width + margin * 2;
  const boxHeight = subject.height + margin * 2;
  const scale = EMPTY_LONG_SIDE / Math.max(boxWidth, boxHeight);
  const targetWidth = Math.round(boxWidth * scale);
  const targetHeight = Math.round(boxHeight * scale);
  await writeCrop(subject, boxWidth, boxHeight, targetWidth, targetHeight, path.join(outputDirectory, fileName));
  console.log(
    `${fileName}: ${subject.original.width}x${subject.original.height} -> crop ${subject.width}x${subject.height}` +
      ` at ${subject.left},${subject.top} (fills ${Math.round(fills * 100)}%) -> ${targetWidth}x${targetHeight}`,
  );
  return true;
}

const bandDirectory = path.join(repositoryRoot, "public/illustrations/band");
await mkdir(bandDirectory, { recursive: true });
console.log("Band vignettes:");
for (const fileName of BAND_FILES) {
  await cropForTheBand(fileName, bandDirectory);
}
console.log(`${BAND_FILES.length} band illustrations written to public/illustrations/band/\n`);

const emptyDirectory = path.join(repositoryRoot, "public/illustrations/empty");
await mkdir(emptyDirectory, { recursive: true });
console.log("Empty states:");
let written = 0;
for (const fileName of EMPTY_FILES) {
  if (await cropForAnEmptyState(fileName, emptyDirectory)) written += 1;
}
console.log(
  `${written} of ${EMPTY_FILES.length} empty-state illustrations written to public/illustrations/empty/,` +
    ` the rest already fill their frame`,
);
