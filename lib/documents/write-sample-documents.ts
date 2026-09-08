import { writeFileSync } from "node:fs";
import { renderDeclarationsPdf, renderEndorsementSchedulePdf } from "./render";
import { foldPolicyEvents } from "./policy-as-of";
import {
  AFTER_BOTH_ENDORSEMENTS,
  EXAMPLE_GENERATED_AT,
  EXAMPLE_POLICY_EVENTS,
} from "./example-policy";

// Writes the two documents for the worked example to a directory, so a human can open them.
//
//   node --import tsx lib/documents/write-sample-documents.ts /tmp
//
// The tests already check what the documents contain; this is for the eye and for the
// evidence pack. It writes nothing but two PDFs and touches no database and no provider.

async function main(): Promise<void> {
  const outputDirectory = process.argv[2];
  if (!outputDirectory) {
    throw new Error("usage: node --import tsx lib/documents/write-sample-documents.ts <output directory>");
  }

  const snapshot = foldPolicyEvents(EXAMPLE_POLICY_EVENTS, AFTER_BOTH_ENDORSEMENTS, EXAMPLE_GENERATED_AT);
  const declarations = `${outputDirectory}/declarations-${snapshot.policyNumber}-as-of-${snapshot.asOf}.pdf`;
  const schedule = `${outputDirectory}/endorsement-schedule-${snapshot.policyNumber}-as-of-${snapshot.asOf}.pdf`;

  writeFileSync(declarations, await renderDeclarationsPdf(snapshot));
  writeFileSync(schedule, await renderEndorsementSchedulePdf(snapshot));
  console.log(`wrote ${declarations}`);
  console.log(`wrote ${schedule}`);
}

void main();
