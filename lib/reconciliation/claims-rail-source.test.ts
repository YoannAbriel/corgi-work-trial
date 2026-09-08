import { test } from "node:test";
import assert from "node:assert/strict";
import { foldTransfers } from "./claims-rail-source";

// The rail's rows are append-only: one transfer is one row per stage, never one row updated.
// These tests are about the fold from those rows to one provider record per transfer.
const SENT_AT = new Date("2026-09-06T09:00:00Z");
const SETTLED_AT = new Date("2026-09-08T09:00:00Z");
const RETURNED_AT = new Date("2026-09-08T15:00:00Z");

function row(status: "sent" | "settled" | "returned", recordedAt: Date, transferRef = "sim_tr_1", amountCents = "120000") {
  return { transfer_ref: transferRef, amount_cents: amountCents, status, recorded_at: recordedAt };
}

test("a transfer the rail has only accepted is pending, dated when it was accepted", () => {
  const [record] = foldTransfers([row("sent", SENT_AT)]);
  assert.equal(record.providerRef, "sim_tr_1");
  assert.equal(record.direction, "out");
  assert.equal(record.status, "pending");
  assert.equal(record.statusWord, "sent");
  assert.equal(record.amountCents, 120000);
  assert.equal(record.createdAt, SENT_AT.toISOString());
  // No operation id: the transfer reference is the only link to our books, on purpose.
  assert.equal(record.operationId, null);
});

test("a settled transfer is succeeded and keeps the acceptance date, not the settlement date", () => {
  const [record] = foldTransfers([row("sent", SENT_AT), row("settled", SETTLED_AT)]);
  assert.equal(record.status, "succeeded");
  assert.equal(record.statusWord, "settled");
  assert.equal(record.createdAt, SENT_AT.toISOString());
});

test("a returned transfer moved no money in the end, so it folds to failed and says 'returned'", () => {
  const [record] = foldTransfers([row("sent", SENT_AT), row("settled", SETTLED_AT), row("returned", RETURNED_AT)]);
  assert.equal(record.status, "failed");
  assert.equal(record.statusWord, "returned");
});

test("several transfers produce one record each", () => {
  const records = foldTransfers([
    row("sent", SENT_AT, "sim_tr_1"),
    row("settled", SETTLED_AT, "sim_tr_1"),
    row("sent", SENT_AT, "sim_tr_2", "4200"),
  ]);
  assert.deepEqual(
    records.map((record) => [record.providerRef, record.status, record.amountCents]),
    [
      ["sim_tr_1", "succeeded", 120000],
      ["sim_tr_2", "pending", 4200],
    ],
  );
});
