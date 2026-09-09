// Turn the two brand JPEGs in brand/ into the three PNGs the application actually draws.
//
// Run it with `npm run brand:assets`. It reads nothing but brand/ and writes nothing but
// public/brand/, so it is safe to re-run at any time. The outputs are committed, so a build
// or a deployment never has to run this script; it exists so that the next person can see
// exactly how the committed files were produced instead of guessing.
//
// WHY THE SOURCES CANNOT BE USED AS THEY ARE
// Both sources are JPEG, which has no transparency: the logo arrives as orange on a white
// rectangle. Dropped on the off-white sidebar or on a PDF header that rule is visible as a
// pale box around the mark. So the white has to become transparent.
//
// HOW THE TRANSPARENCY IS MADE
// The sources are two flat colours, orange and white, with anti-aliased pixels in between.
// That means one number already says how much ink a pixel carries: its distance to white.
// So the alpha channel is built as greyscale, negated (white becomes 0, orange becomes the
// largest value in the image) and normalised (that largest value is stretched to 255, so
// the orange is fully opaque). A half-covered edge pixel lands halfway and stays soft.
//
// The colour channels are then repainted as ONE flat orange, #ff5c00, everywhere, including
// under the transparent pixels. This is the part that matters: if the original pixels were
// kept, an anti-aliased edge would carry a pale pinkish orange AND a partial alpha, and a
// viewer compositing it would multiply the two and draw a muddy halo. Flat colour plus a
// soft alpha is the standard way to write a two-colour logo as a PNG.
//
// THE THIRD FILE, THE MASK
// public/brand/corgi-mark-mask.png is the same shape painted black instead of orange. It is
// used as a CSS mask-image (app/styles/system.css, .workspace-icon), where only the alpha
// channel is read and the colour underneath comes from the page. That is what lets the
// sidebar mark inherit its colour from the theme instead of being a fixed orange bitmap.

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// The brand orange, measured on both source files. Same value as --orange in app/globals.css.
const BRAND_ORANGE = { r: 0xff, g: 0x5c, b: 0x00 };
const BLACK = { r: 0, g: 0, b: 0 };

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = path.join(repositoryRoot, "brand");
const outputDirectory = path.join(repositoryRoot, "public", "brand");
const generatedModulePath = path.join(repositoryRoot, "lib", "documents", "brand-wordmark.ts");

// Read one source, put it on white (a JPEG has no alpha, but this is explicit about what the
// background is), resize it, and hand back the flattened pixels plus their dimensions.
async function loadResized(sourceFile, resizeOptions) {
  const image = sharp(path.join(sourceDirectory, sourceFile))
    .flatten({ background: "#ffffff" })
    .resize({ ...resizeOptions, fit: "contain", background: "#ffffff" });
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  return { pixels: data, width: info.width, height: info.height, channels: info.channels };
}

// The alpha channel: how far each pixel is from white, stretched so the orange reaches 255.
async function alphaFromDistanceToWhite({ pixels, width, height, channels }) {
  return sharp(pixels, { raw: { width, height, channels } })
    .greyscale()
    .negate()
    .normalise()
    .raw()
    .toBuffer();
}

// One flat colour, the size of the image, used as the three colour channels under the alpha.
function flatColour({ width, height }, colour) {
  const canvas = Buffer.alloc(width * height * 3);
  for (let offset = 0; offset < canvas.length; offset += 3) {
    canvas[offset] = colour.r;
    canvas[offset + 1] = colour.g;
    canvas[offset + 2] = colour.b;
  }
  return canvas;
}

async function writeFlatColourPng(source, colour, outputFile) {
  const alpha = await alphaFromDistanceToWhite(source);
  const colours = flatColour(source, colour);
  const outputPath = path.join(outputDirectory, outputFile);
  await sharp(colours, { raw: { width: source.width, height: source.height, channels: 3 } })
    .joinChannel(alpha, { raw: { width: source.width, height: source.height, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
  const { size } = await stat(outputPath);
  console.log(`public/brand/${outputFile}  ${source.width}x${source.height}  ${Math.round(size / 1024)} KB`);
}

// The wordmark again, this time as a TypeScript module holding its bytes in base64.
//
// The PDF renderers cannot read the PNG off disk at request time: everything under public/ is
// uploaded to the CDN as a static asset, and whether a copy also lands inside the serverless
// function is a deployment detail nobody on this trial can observe before shipping. A module
// is compiled into the route's own bundle by the same toolchain that compiles the renderer,
// so there is no runtime path to get wrong and no file that can be missing in production.
//
// The cost is that the bytes are committed twice, here and in public/brand/corgi-logo.png.
// That is deliberate: the PNG stays the file the web would use, this module is what the two
// PDF routes read, and one script writes both from one source so they cannot disagree.
async function writeWordmarkModule(outputFile) {
  const png = await readFile(path.join(outputDirectory, outputFile));
  const header = [
    "// GENERATED FILE, DO NOT EDIT BY HAND.",
    "//",
    `// Written by scripts/brand-assets.mjs from brand/corgi-logo-full.jpg, by way of`,
    `// public/brand/${outputFile}. Run \`npm run brand:assets\` to rebuild it.`,
    "//",
    "// It carries the Corgi wordmark as base64 so that lib/documents/pdf-theme.ts can hand the",
    "// bytes to @react-pdf/renderer without reading a file at request time. The reason that",
    "// matters is written out beside corgiWordmarkPng() in pdf-theme.ts.",
    "",
    `export const CORGI_WORDMARK_PNG_BASE64 = "${png.toString("base64")}";`,
    "",
  ].join("\n");
  await writeFile(generatedModulePath, header);
  const { size } = await stat(generatedModulePath);
  console.log(`lib/documents/brand-wordmark.ts  ${Math.round(size / 1024)} KB`);
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });

  // The round mark at 512, the size Next.js serves as the site icon (app/icon.png is the
  // same file) and the largest size anything in the application draws it at.
  const mark = await loadResized("corgi-mark.jpg", { width: 512, height: 512 });
  await writeFlatColourPng(mark, BRAND_ORANGE, "corgi-mark.png");
  await writeFlatColourPng(mark, BLACK, "corgi-mark-mask.png");

  // The wordmark at 1200 wide. Height follows the source ratio (800 x 242), and it is drawn
  // at 28 pt in a PDF and at a few hundred pixels on screen, so 1200 leaves room on both.
  const wordmark = await loadResized("corgi-logo-full.jpg", { width: 1200 });
  await writeFlatColourPng(wordmark, BRAND_ORANGE, "corgi-logo.png");

  // The same PNG a second time, as a module the PDF routes compile in.
  await writeWordmarkModule("corgi-logo.png");
}

await main();
