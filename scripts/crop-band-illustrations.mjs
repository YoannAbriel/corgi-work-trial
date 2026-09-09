// Crop the page band's watercolour corgis so the animal fills its 52 px slot.
//
// Why: the files in public/illustrations/library are drawn on a big sheet of white paper with wide
// empty margins. That is right at 200 px in an empty state, and wrong at 52 px in the band, where
// the margins eat the frame and the corgi comes out tiny. This script trims the paper off a copy
// of each file and writes it to public/illustrations/band/. The originals are never touched.
//
// Run it with: npm run illustrations:band
//
// Yoann, 2026-09-09.

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = path.join(repositoryRoot, "public/illustrations/library");
const outputDirectory = path.join(repositoryRoot, "public/illustrations/band");

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

// How far a pixel may sit from the corner colour and still count as paper to cut away. Measured on
// this set at 20, 30 and 40: the three agree to within one or two pixels, because the paper is a
// flat white and the drawings never fade into it. 30 is the middle of the range that was tried, so
// neither a slightly greyer scan nor a paler wash changes the crop.
const PAPER_THRESHOLD = 30;

// The corgi does not touch the edge of its frame: a margin of this share of the cropped size is
// added back all round, so the radial mask fades over paper and not over an ear.
const MARGIN_SHARE = 0.08;

// Four times the 52 px slot, so the picture stays sharp on a retina screen at the 96 px the
// stylesheet asks for in components/decorative-illustration.tsx.
const OUTPUT_SIZE = 208;

const WEBP_QUALITY = 82;

// The paper the drawings are made on. Used to pad the crop out to a square, so the added margin is
// the same white as the drawing's own background and no grey edge appears under the mask.
const PAPER_COLOUR = { r: 255, g: 255, b: 255, alpha: 1 };

// Centre a rectangle inside a square of `side`, as whole pixels on every edge.
function paddingToSquare(width, height, side) {
  const left = Math.floor((side - width) / 2);
  const top = Math.floor((side - height) / 2);
  return { top, left, bottom: side - height - top, right: side - width - left };
}

async function cropOneFile(fileName) {
  const sourcePath = path.join(sourceDirectory, fileName);
  const original = await sharp(sourcePath).metadata();

  // `.trim()` returns, in `info.trimOffsetLeft/Top`, where the kept box starts in the original.
  // Reading the trimmed bytes back is the simplest way to learn its size without guessing.
  const trimmed = await sharp(sourcePath).trim({ threshold: PAPER_THRESHOLD }).toBuffer({ resolveWithObject: true });
  const cropWidth = trimmed.info.width;
  const cropHeight = trimmed.info.height;
  // trimOffset* are negative (they say how far the original was shifted); the crop's own corner is
  // their absolute value.
  const cropLeft = Math.abs(trimmed.info.trimOffsetLeft ?? 0);
  const cropTop = Math.abs(trimmed.info.trimOffsetTop ?? 0);

  const margin = Math.round(Math.max(cropWidth, cropHeight) * MARGIN_SHARE);
  const square = Math.max(cropWidth, cropHeight) + margin * 2;
  const padding = paddingToSquare(cropWidth, cropHeight, square);

  // Two passes on purpose. Inside one sharp pipeline the resize runs before the extend whatever
  // the order of the calls, so a single pipeline resized to 208 and then padded around it, and the
  // file came out 532x338 instead of square. Squaring the picture first, then resizing the square,
  // is the order this needs.
  const squared = await sharp(trimmed.data)
    .extend({ ...padding, background: PAPER_COLOUR })
    .toBuffer();

  const outputPath = path.join(outputDirectory, fileName);
  await sharp(squared).resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: "fill" }).webp({ quality: WEBP_QUALITY }).toFile(outputPath);

  console.log(
    `${fileName}: ${original.width}x${original.height} -> crop ${cropWidth}x${cropHeight} at ${cropLeft},${cropTop}` +
      ` -> square ${square} -> ${OUTPUT_SIZE}px`,
  );
}

await mkdir(outputDirectory, { recursive: true });
for (const fileName of BAND_FILES) {
  await cropOneFile(fileName);
}
console.log(`${BAND_FILES.length} band illustrations written to public/illustrations/band/`);
