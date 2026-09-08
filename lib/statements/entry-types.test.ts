import { test } from "node:test";
import assert from "node:assert/strict";
import { CANCELLATION_ENTRY_TYPES } from "@/lib/ledger/cancellation-entries";
import { CLAIM_ENTRY_TYPES } from "@/lib/ledger/claim-entries";
import { CORRECTION_ENTRY_TYPES } from "@/lib/ledger/correction-entries";
import { ENDORSEMENT_ENTRY_TYPES } from "@/lib/ledger/endorsement-entries";
import { POLICY_ENTRY_TYPES } from "@/lib/ledger/policy-entries";
import { REVERSAL_ENTRY_TYPE_PREFIX } from "@/lib/ledger/reverse";
import { statementDisposition, STATEMENT_CASH_ENTRY_TYPES } from "./compute";

// THE TEST THAT STOPS THE FOURTH TIME.
//
// Three times a slice added a journal entry type and nobody told the broker statement: the
// endorsement collection (review finding F-B9-01) and the correction difference (F-B8-01) were
// both dropped from the cash, and their commission was filed as an unexplained adjustment. Each
// time the money was in the ledger and missing from the document a broker is paid on.
//
// So this test does not check a hand-written list. It imports the list every ledger builder
// exports, walks each type and its reversal through the statement's classifier, and fails with
// the offending name when one comes back "unknown". Adding an entry type to a builder without
// deciding what a statement does with it now fails here, by name, in one second.
//
// The two halves of the safety net, and why both:
//   this test          every type a builder can post has a DECISION: a line, or an explicit
//                      "ignored, because ...". Silence is a failure.
//   the runtime        an unknown type that still moved the broker's payable becomes an
//                      'adjustment' line rather than disappearing (rule 1 in compute.ts), so a
//                      statement can never understate what a broker is owed even if this test
//                      were somehow skipped. The fallback is the seatbelt, not the plan.

const EVERY_LEDGER_ENTRY_TYPE: string[] = [
  ...POLICY_ENTRY_TYPES,
  ...CANCELLATION_ENTRY_TYPES,
  ...ENDORSEMENT_ENTRY_TYPES,
  ...CLAIM_ENTRY_TYPES,
  ...CORRECTION_ENTRY_TYPES,
];

test("every entry type the ledger can post has a statement decision, and so does its reversal", () => {
  const undecided: string[] = [];
  for (const entryType of EVERY_LEDGER_ENTRY_TYPE) {
    for (const name of [entryType, `${REVERSAL_ENTRY_TYPE_PREFIX}${entryType}`]) {
      if (statementDisposition(name).kind === "unknown") {
        undecided.push(name);
      }
    }
  }
  assert.deepEqual(
    undecided,
    [],
    `these entry types reach the ledger and the broker statement does not know what to do with them. ` +
      `Add each one to DISPOSITIONS in lib/statements/compute.ts, as a line or as "ignored" with the reason: ${undecided.join(", ")}`,
  );
});

test("an entry type no builder produces is reported as unknown rather than guessed", () => {
  assert.equal(statementDisposition("something_nobody_wrote").kind, "unknown");
  assert.equal(statementDisposition(`${REVERSAL_ENTRY_TYPE_PREFIX}something_nobody_wrote`).kind, "unknown");
});

test("an ignored entry type says why it is ignored, in a sentence", () => {
  for (const entryType of EVERY_LEDGER_ENTRY_TYPE) {
    const disposition = statementDisposition(entryType);
    if (disposition.kind === "ignored") {
      assert.ok(
        disposition.reason.length > 20,
        `${entryType} is ignored by the statement with no readable reason: "${disposition.reason}"`,
      );
    }
  }
});

test("a reversal lands on the same line as the entry it undoes", () => {
  for (const entryType of EVERY_LEDGER_ENTRY_TYPE) {
    assert.deepEqual(
      statementDisposition(`${REVERSAL_ENTRY_TYPE_PREFIX}${entryType}`),
      statementDisposition(entryType),
      `the reversal of ${entryType} is classified differently from ${entryType}`,
    );
  }
});

test("the three ways customer money arrives are all counted as cash, with their reversals", () => {
  // The list the SQL query selects on. It is derived from the same table as the classifier, so
  // this asserts the derivation rather than a copy of it.
  for (const entryType of [
    "premium_collected",
    "endorsement_premium_collected",
    "correction_premium_collected",
    "refund_completed",
  ]) {
    assert.ok(STATEMENT_CASH_ENTRY_TYPES.includes(entryType), `${entryType} is not selected as a cash entry`);
    assert.ok(
      STATEMENT_CASH_ENTRY_TYPES.includes(`${REVERSAL_ENTRY_TYPE_PREFIX}${entryType}`),
      `the reversal of ${entryType} is not selected as a cash entry`,
    );
  }
  // Eight names: four entry types and their four reversals. A commission entry is not on this
  // list: the query already selects it because it moves commission_payable.
  assert.equal(STATEMENT_CASH_ENTRY_TYPES.length, 8, STATEMENT_CASH_ENTRY_TYPES.join(", "));
});

test("the correction entry types are the ones the statement was missing", () => {
  assert.deepEqual(statementDisposition("correction_premium_collected"), {
    kind: "line",
    lineKind: "premium_collected",
    movement: "cash",
  });
  assert.deepEqual(statementDisposition("correction_commission_earned"), {
    kind: "line",
    lineKind: "commission_earned",
    movement: "commission",
  });
  // The difference given back completes through the ordinary refund entries, so those two carry
  // it: the correction only opens the liability, which moves no money.
  assert.equal(statementDisposition("correction_refund_requested").kind, "ignored");
  assert.deepEqual(statementDisposition("refund_completed"), { kind: "line", lineKind: "refund", movement: "cash" });
  assert.deepEqual(statementDisposition("commission_clawback"), {
    kind: "line",
    lineKind: "clawback",
    movement: "commission",
  });
});
