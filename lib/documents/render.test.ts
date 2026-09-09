import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTextFromPdf } from "./pdf-text";
import { foldPolicyEvents } from "./policy-as-of";
import { renderDeclarationsPdf, renderEndorsementSchedulePdf } from "./render";
import {
  AFTER_BOTH_ENDORSEMENTS,
  BEFORE_BOTH_ENDORSEMENTS,
  BETWEEN_THE_TWO_ENDORSEMENTS,
  EXAMPLE_GENERATED_AT,
  EXAMPLE_POLICY_EVENTS,
} from "./example-policy";

function snapshotOn(asOf: string) {
  return foldPolicyEvents(EXAMPLE_POLICY_EVENTS, asOf, EXAMPLE_GENERATED_AT);
}

// A real PDF file starts with the five bytes "%PDF-" and ends with "%%EOF". Anything that
// passes both is a file a reader will open, not a buffer of hopeful bytes.
function assertIsPdfFile(pdf: Buffer) {
  assert.equal(pdf.subarray(0, 4).toString("latin1"), "%PDF");
  assert.ok(pdf.length > 1024, `a one-page declarations PDF is larger than 1 KB, got ${pdf.length} bytes`);
  assert.ok(pdf.subarray(-8).toString("latin1").includes("%%EOF"), "the file is not terminated");
}

test("the declarations page is a real PDF holding the recited example's figures", async () => {
  const pdf = await renderDeclarationsPdf(snapshotOn(BEFORE_BOTH_ENDORSEMENTS));
  assertIsPdfFile(pdf);

  const printedText = extractTextFromPdf(pdf);
  assert.ok(printedText.includes("POL-2028-000001"), "the policy number is not on the page");
  assert.ok(printedText.includes("Blue Ridge Contracting LLC"), "the insured is not on the page");
  assert.ok(printedText.includes("Golden Gate Brokerage LLC"), "the broker is not on the page");
  assert.ok(printedText.includes("May 1, 2028"), "the as-of date is not on the page");
  assert.ok(printedText.includes("March 1, 2028"), "the term start is not on the page");
  assert.ok(printedText.includes("March 1, 2029"), "the term end is not on the page");

  // The money, exactly as decided on 2026-09-08: $1,200 + $28.20 California tax + $25 fee.
  assert.ok(printedText.includes("$1,200.00"), "the annual premium is not on the page");
  assert.ok(printedText.includes("2.35%"), "the tax rate is not on the page");
  assert.ok(printedText.includes("California"), "the taxing state is not named");
  assert.ok(printedText.includes("$28.20"), "the premium tax is not on the page");
  assert.ok(printedText.includes("$25.00"), "the policy fee is not on the page");
  assert.ok(printedText.includes("$1,253.20"), "the total charge is not on the page");

  // Coverage limits are printed from cents.
  assert.ok(printedText.includes("$1,000,000.00"), "the each-occurrence limit is not on the page");
  assert.ok(printedText.includes("$2,000,000.00"), "the aggregate limit is not on the page");

  // The footer says what the document is and when it was produced.
  assert.ok(printedText.includes("2026-09-08 12:34:56 UTC"), "the generation time is not in the footer");
  assert.ok(printedText.includes("as it stood on"), "the as-of statement is not in the footer");
});

test("the same as-of date always produces the same declarations page", async () => {
  // Nothing in the renderer reads a clock: two runs of the same snapshot are byte-identical,
  // which is what makes a reprint of an old document reproducible.
  const snapshot = snapshotOn(BEFORE_BOTH_ENDORSEMENTS);
  const [first, second] = await Promise.all([renderDeclarationsPdf(snapshot), renderDeclarationsPdf(snapshot)]);
  assert.ok(first.equals(second), "two renders of the same snapshot differ");
});

test("a declarations page between the two endorsements shows the endorsed figures", async () => {
  const pdf = await renderDeclarationsPdf(snapshotOn(BETWEEN_THE_TWO_ENDORSEMENTS));
  assertIsPdfFile(pdf);
  const printedText = extractTextFromPdf(pdf);
  assert.ok(printedText.includes("$1,800.00"), "the endorsed annual premium is not on the page");
  assert.ok(printedText.includes("$42.30"), "the tax on the endorsed premium is not on the page");
  assert.ok(printedText.includes("$1,867.30"), "the endorsed total is not on the page");
  assert.ok(printedText.includes("July 15, 2028"), "the as-of date is not on the page");
});

test("the endorsement schedule lists both endorsements with their delta and running premium", async () => {
  const pdf = await renderEndorsementSchedulePdf(snapshotOn(AFTER_BOTH_ENDORSEMENTS));
  assertIsPdfFile(pdf);

  const printedText = extractTextFromPdf(pdf);
  assert.ok(printedText.includes("POL-2028-000001"), "the policy number is not on the schedule");
  assert.ok(printedText.includes("June 9, 2028"), "the first endorsement's effective date is missing");
  // The recording time, next to the effective date, is what shows a backdated endorsement
  // for what it is. The trailing "UTC" is drawn as its own run on the page, so the assertion
  // stops at the seconds (see the note on runs in pdf-text.ts).
  assert.ok(printedText.includes("2028-06-09 09:12:45"), "the first endorsement's recording time is missing");
  assert.ok(printedText.includes("September 1, 2028"), "the second endorsement's effective date is missing");
  // The amount charged, premium AND its state premium tax, which is what moved at the provider
  // and what the policy page shows: 43561 + 1023 and -14877 + -350 (review finding F-INT-07, the
  // column used to print the premium alone under a caption calling it the amount charged).
  assert.ok(printedText.includes("$445.84"), "the amount charged for the first endorsement is missing");
  assert.ok(printedText.includes("-$152.27"), "the amount credited for the second endorsement is missing");

  // The running annual premium: issued at $1,200, then $1,800, then $1,500.
  assert.ok(printedText.includes("$1,200.00"), "the premium at issuance is missing");
  assert.ok(printedText.includes("$1,800.00"), "the premium after the first endorsement is missing");
  assert.ok(printedText.includes("$1,500.00"), "the premium after the second endorsement is missing");
});

test("an endorsement schedule with nothing on it says so", async () => {
  const pdf = await renderEndorsementSchedulePdf(snapshotOn(BEFORE_BOTH_ENDORSEMENTS));
  assertIsPdfFile(pdf);
  const printedText = extractTextFromPdf(pdf);
  assert.ok(printedText.includes("No endorsement had taken effect"), "the empty state is missing");
  assert.ok(printedText.includes("$1,200.00"), "the premium at issuance is missing");
});
