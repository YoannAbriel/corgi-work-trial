import { inflateSync } from "node:zlib";

// Reading the text back out of a PDF we produced.
//
// This exists so the document tests can assert on what is actually printed ("the policy
// number is on the page", "the total says $1,253.20") instead of only checking that some
// bytes were produced. A general PDF parser would be a new dependency; this reads exactly
// the shape @react-pdf/renderer writes and nothing more:
//   - page content is a Flate-compressed stream between the `stream` and `endstream` keywords;
//   - inside it, one line of text is drawn by one `[...] TJ` operator, whose brackets hold
//     the characters as hexadecimal bytes (`<48656c6c6f>`) interleaved with kerning numbers.
//     A single word is often cut into several hexadecimal chunks by kerning, so the chunks
//     of one operator belong together and are joined with nothing between them.
//   - the bytes are in the font's encoding: WinAnsi for the standard Helvetica this project
//     uses, which is ASCII for every character we print.
//
// It is test and evidence tooling, not part of a money path. If it fails to understand a
// stream it skips it, so a test asserting on missing text fails loudly rather than passing
// on an empty result.
export function extractTextFromPdf(pdf: Buffer): string {
  const drawnLines: string[] = [];
  for (const contentStream of inflateContentStreams(pdf)) {
    for (const showTextOperator of contentStream.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      const chunks = [...showTextOperator[1].matchAll(/<([0-9a-fA-F]*)>/g)];
      drawnLines.push(chunks.map((chunk) => decodeHexString(chunk[1])).join(""));
    }
  }
  // One drawn line per line of output: joining everything with a space would invent spaces
  // that are not on the page, and joining with nothing would glue unrelated cells together.
  return drawnLines.join("\n");
}

function* inflateContentStreams(pdf: Buffer): Generator<string> {
  const rawPdf = pdf.toString("latin1");
  const streamKeyword = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streamKeyword.exec(rawPdf)) !== null) {
    const start = match.index + match[0].length;
    const end = rawPdf.indexOf("endstream", start);
    if (end < 0) continue;
    try {
      yield inflateSync(pdf.subarray(start, end)).toString("latin1");
    } catch {
      // Fonts and images are compressed differently or not at all: they hold no page text.
    }
  }
}

function decodeHexString(hexDigits: string): string {
  let characters = "";
  for (let index = 0; index + 1 < hexDigits.length; index += 2) {
    characters += String.fromCharCode(Number.parseInt(hexDigits.slice(index, index + 2), 16));
  }
  return characters;
}
