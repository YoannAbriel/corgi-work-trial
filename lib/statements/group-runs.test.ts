import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRunsByBrokerAndMonth } from "./group-runs";
import type { StatementRunRow } from "./read";

// What the two statement lists show as one row (review finding F-ST-05). The grouping decides
// which run a reader sees and which ones are folded under it, so it is asserted here rather than
// read off a screenshot.

const REDWOOD = "33333333-3333-4333-8333-333333333333";
const HARBOR = "44444444-4444-4444-8444-444444444444";

// A run reduced to the four fields the grouping reads. Everything else is filled with a value
// that is legal for the type and is never looked at here.
function run(fields: {
  brokerId: string;
  brokerName?: string;
  statementMonth: string;
  revision: number;
  producedAt: string;
}): StatementRunRow {
  return {
    runId: `${fields.brokerId}-${fields.statementMonth}-${fields.revision}`,
    brokerId: fields.brokerId,
    brokerName: fields.brokerName ?? "Redwood Commercial Brokers",
    statementMonth: fields.statementMonth,
    revision: fields.revision,
    knowledgeCutoff: new Date(fields.producedAt),
    supersedesRunId: null,
    contentHash: "a".repeat(64),
    identicalToPrevious: false,
    canonicalVersion: 2,
    previousCanonicalVersion: null,
    monthWasStillRunning: false,
    cashCollectedCents: 0,
    premiumCollectedCents: 0,
    commissionEarnedCents: 0,
    clawbackCents: 0,
    adjustmentCents: 0,
    netDueCents: 0,
    runByName: null,
    createdAt: new Date(fields.producedAt),
  };
}

test("a month is one group whose row is its newest revision, the others folded under it", () => {
  const groups = groupRunsByBrokerAndMonth([
    run({ brokerId: REDWOOD, statementMonth: "2026-09", revision: 1, producedAt: "2026-09-08T10:00:00.000Z" }),
    run({ brokerId: REDWOOD, statementMonth: "2026-09", revision: 3, producedAt: "2026-09-09T19:00:00.000Z" }),
    run({ brokerId: REDWOOD, statementMonth: "2026-09", revision: 2, producedAt: "2026-09-08T18:00:00.000Z" }),
  ]);
  assert.equal(groups.length, 1, "three revisions of one month are one row");
  assert.equal(groups[0].latest.revision, 3, "the row is the newest revision");
  assert.deepEqual(
    groups[0].earlier.map((earlier) => earlier.revision),
    [2, 1],
    "the fold lists the revisions it replaced, newest first",
  );
});

test("a month run once has nothing to fold", () => {
  const groups = groupRunsByBrokerAndMonth([
    run({ brokerId: REDWOOD, statementMonth: "2027-01", revision: 1, producedAt: "2027-02-01T09:00:00.000Z" }),
  ]);
  assert.deepEqual(groups[0].earlier, [], "one revision means no earlier revision");
});

test("the groups are ordered by the age of the revision they show, newest first", () => {
  const groups = groupRunsByBrokerAndMonth([
    // A rerun of an old month, produced last: it is the first row, above the later month whose
    // only run is older. This is the age-only rule of the two lists.
    run({ brokerId: REDWOOD, statementMonth: "2026-09", revision: 2, producedAt: "2026-09-09T20:00:00.000Z" }),
    run({ brokerId: REDWOOD, statementMonth: "2027-09", revision: 1, producedAt: "2026-09-09T12:00:00.000Z" }),
    run({ brokerId: REDWOOD, statementMonth: "2026-09", revision: 1, producedAt: "2026-09-08T08:00:00.000Z" }),
  ]);
  assert.deepEqual(
    groups.map((group) => `${group.latest.statementMonth} r${group.latest.revision}`),
    ["2026-09 r2", "2027-09 r1"],
    "the month whose newest revision was just produced is the first row",
  );
});

test("two brokers recorded under the same name stay two rows", () => {
  const groups = groupRunsByBrokerAndMonth([
    run({ brokerId: REDWOOD, brokerName: "Same Name Brokers", statementMonth: "2026-09", revision: 1, producedAt: "2026-09-09T10:00:00.000Z" }),
    run({ brokerId: HARBOR, brokerName: "Same Name Brokers", statementMonth: "2026-09", revision: 1, producedAt: "2026-09-09T11:00:00.000Z" }),
  ]);
  assert.equal(groups.length, 2, "the grouping is by broker id, never by the name printed on the row");
  assert.deepEqual(
    groups.map((group) => group.latest.brokerId),
    [HARBOR, REDWOOD],
    "and the newer of the two is the first row",
  );
});

test("two revisions produced at the same instant are ordered by revision number", () => {
  // A re-run reads and writes inside one transaction, and every row of a transaction carries the
  // same now(), so this is not a hypothetical tie: the higher revision is the later one because
  // it is the one that names the other as superseded.
  const sameInstant = "2026-09-09T19:36:34.000Z";
  const groups = groupRunsByBrokerAndMonth([
    run({ brokerId: REDWOOD, statementMonth: "2026-09", revision: 4, producedAt: sameInstant }),
    run({ brokerId: REDWOOD, statementMonth: "2026-09", revision: 5, producedAt: sameInstant }),
  ]);
  assert.equal(groups[0].latest.revision, 5, "the higher revision is the row");
  assert.deepEqual(
    groups[0].earlier.map((earlier) => earlier.revision),
    [4],
    "and the lower one is folded under it",
  );
});
