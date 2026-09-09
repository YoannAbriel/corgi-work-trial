import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import { renderStatementPdf } from "@/lib/statements/pdf";
import type { StatementRunDetail } from "@/lib/statements/read";
import { renderDeclarationsPdf, renderEndorsementSchedulePdf } from "./render";
import { foldPolicyEvents } from "./policy-as-of";
import {
  AFTER_BOTH_ENDORSEMENTS,
  EXAMPLE_GENERATED_AT,
  EXAMPLE_POLICY_EVENTS,
} from "./example-policy";

// Writes the three documents this application produces to a directory, so a human can open
// them, and turns each page into a PNG when a converter is installed.
//
//   node --import tsx lib/documents/write-sample-documents.ts /tmp
//
// The tests already check what the documents contain; this is for the eye and for the
// evidence pack. It writes files and nothing else: no database, no provider, no network.
// Run it twice into two directories and `cmp` the PDFs to see that a render is deterministic.

// The statement side of the sample pack.
//
// The two policy documents are folded from the shared worked example (example-policy.ts). A
// statement has no equivalent shared fixture, because a real one is read out of a stored run,
// so the recited March 2028 example is written out here instead: $1,253.20 of cash collected,
// $1,200.00 of premium inside it, and $180.00 of commission, which is 15% of the premium and
// not of the cash (docs/DECISIONS.md).
//
// Every field below is invented for the trial. No real broker, no real person, and the digest
// is a fixed literal rather than a hash of anything: this is a sample, not a run.
const EXAMPLE_STATEMENT: StatementRunDetail = {
  run: {
    runId: "11111111-1111-4111-8111-111111111111",
    brokerId: "33333333-3333-4333-8333-333333333333",
    brokerName: "Redwood Commercial Brokers",
    statementMonth: "2028-03",
    revision: 2,
    knowledgeCutoff: new Date("2028-04-01T06:00:00.000Z"),
    supersedesRunId: "22222222-2222-4222-8222-222222222222",
    contentHash: "3f8c1d90a47b6e25c0d31f7a94b8e6520af13c7d9e40b285617ca3fd08e94b72",
    identicalToPrevious: false,
    canonicalVersion: 2,
    previousCanonicalVersion: 2,
    monthWasStillRunning: false,
    cashCollectedCents: 125320,
    premiumCollectedCents: 120000,
    commissionEarnedCents: 18000,
    clawbackCents: 0,
    adjustmentCents: 0,
    netDueCents: 18000,
    runByName: "Sam Patel, operations",
    createdAt: new Date("2028-04-01T06:00:02.000Z"),
  },
  lines: [
    {
      lineOrder: 0,
      kind: "premium_collected",
      policyId: "44444444-4444-4444-8444-444444444444",
      policyNumber: "CGP-01001",
      journalEntryId: "55555555-5555-4555-8555-555555555555",
      effectiveAt: new Date("2028-03-01T00:00:00.000Z"),
      entryRecordedAt: new Date("2028-03-01T10:00:00.000Z"),
      amountCents: 125320,
      commissionBaseCents: 120000,
      description: "Policy CGP-01001 premium, tax and fee collected at Stripe",
    },
    {
      lineOrder: 1,
      kind: "commission_earned",
      policyId: "44444444-4444-4444-8444-444444444444",
      policyNumber: "CGP-01001",
      journalEntryId: "66666666-6666-4666-8666-666666666666",
      effectiveAt: new Date("2028-03-01T00:00:00.000Z"),
      entryRecordedAt: new Date("2028-03-01T10:00:00.000Z"),
      amountCents: 18000,
      commissionBaseCents: null,
      description: "Broker commission on the collected premium of policy CGP-01001",
    },
  ],
};

async function main(): Promise<void> {
  const outputDirectory = process.argv[2];
  if (!outputDirectory) {
    throw new Error("usage: node --import tsx lib/documents/write-sample-documents.ts <output directory>");
  }

  const snapshot = foldPolicyEvents(EXAMPLE_POLICY_EVENTS, AFTER_BOTH_ENDORSEMENTS, EXAMPLE_GENERATED_AT);
  const writtenPdfPaths = [
    write(`${outputDirectory}/declarations-${snapshot.policyNumber}-as-of-${snapshot.asOf}.pdf`, await renderDeclarationsPdf(snapshot)),
    write(`${outputDirectory}/endorsement-schedule-${snapshot.policyNumber}-as-of-${snapshot.asOf}.pdf`, await renderEndorsementSchedulePdf(snapshot)),
    write(`${outputDirectory}/statement-${EXAMPLE_STATEMENT.run.statementMonth}-revision-${EXAMPLE_STATEMENT.run.revision}.pdf`, await renderStatementPdf(EXAMPLE_STATEMENT)),
  ];

  writePagesAsImages(writtenPdfPaths, outputDirectory);
}

function write(path: string, pdf: Buffer): string {
  writeFileSync(path, pdf);
  console.log(`wrote ${path}`);
  return path;
}

// Turns each page of each PDF into a PNG next to it, using poppler's `pdftoppm`.
//
// The images are what a human actually reviews, and what goes into the evidence pack: a PDF
// that opens is not proof that a column is not printed over another one. The converter is a
// local system tool, not a dependency of the application, so it may simply not be installed.
// When it is missing the script says so and still leaves the PDFs behind; it never fails the
// run and never reaches the network to fetch a converter.
function writePagesAsImages(pdfPaths: string[], outputDirectory: string): void {
  for (const pdfPath of pdfPaths) {
    // `pdftoppm` appends "-1", "-2" and so on for each page, then ".png".
    const imagePrefix = `${outputDirectory}/${basename(pdfPath, ".pdf")}`;
    try {
      execFileSync("pdftoppm", ["-png", "-r", "110", pdfPath, imagePrefix], { stdio: "pipe" });
      console.log(`wrote ${imagePrefix}-<page>.png`);
    } catch (conversionFailure) {
      const reason = conversionFailure instanceof Error ? conversionFailure.message : String(conversionFailure);
      console.log(`no PNG written for ${pdfPath}: pdftoppm (poppler) did not run. ${reason}`);
      return;
    }
  }
}

void main();
