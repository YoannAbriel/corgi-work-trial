import type { StatementRunRow } from "./read";

// One row per broker and month on the two statement lists (Yoann, 2026-09-09 evening).
//
// The lists used to print every revision of every month as its own row: Redwood 2026-09 took five
// rows on /ops/statements, and the row a reader wanted, the newest one, was one of five that all
// looked alike. A month is one document with a history, so it is one row: the newest revision,
// with the ones it replaced folded under it.
//
// PURE, AND ON PURPOSE. No database, no clock, no arithmetic on money: it receives the rows the
// reader (lib/statements/read.ts) already returned and only decides which of them is a row and
// which are lines of a fold. It sits in lib/ rather than beside the two pages so that it can be
// tested (lib/statements/group-runs.test.ts, which is what the test runner globs), and so that
// the staff list and the broker list cannot drift into two different definitions of "the newest
// revision".

export type StatementMonthGroup = {
  // The newest revision of this broker and month: the one the row shows and links to.
  latest: StatementRunRow;
  // The revisions it replaced, newest first. Empty on a month that was only ever run once, and
  // then the row has no revision fold to offer.
  earlier: StatementRunRow[];
};

// Which of two runs is the newer one, for the order of the rows and the order inside a fold.
//
// CREATED AT FIRST, THE REVISION NUMBER ON A TIE. The produced time is the fact the database
// stamped and it is what a reader is scanning for. Two runs of the same month can carry the same
// instant, because a re-run reads and writes inside one transaction and Postgres gives every row
// of a transaction the same now(); when that happens the higher revision is the later one, by the
// definition of a revision: it names the one it supersedes.
function newerFirst(one: StatementRunRow, other: StatementRunRow): number {
  const byAge = other.createdAt.getTime() - one.createdAt.getTime();
  return byAge === 0 ? other.revision - one.revision : byAge;
}

// Groups the runs by broker and month, newest revision first inside a group, newest group first.
//
// The order across groups is the age-only rule of the two lists (Yoann, 2026-09-09): the month
// whose newest revision has just been produced is the first row, whoever the broker is, because
// that is the run a person came to look at. Not by month: a rerun of an old month is newer than
// the first run of a later month, and burying it under its month would hide what just happened.
export function groupRunsByBrokerAndMonth(runs: StatementRunRow[]): StatementMonthGroup[] {
  const revisionsByBrokerAndMonth = new Map<string, StatementRunRow[]>();
  for (const run of runs) {
    // Broker id and not broker name: two brokers can be recorded under the same words, and the id
    // is what the statement was run for.
    const key = `${run.brokerId} ${run.statementMonth}`;
    const alreadyGrouped = revisionsByBrokerAndMonth.get(key);
    if (alreadyGrouped) {
      alreadyGrouped.push(run);
    } else {
      revisionsByBrokerAndMonth.set(key, [run]);
    }
  }
  const groups = [...revisionsByBrokerAndMonth.values()].map((revisions) => {
    const newestFirst = [...revisions].sort(newerFirst);
    return { latest: newestFirst[0], earlier: newestFirst.slice(1) };
  });
  return groups.sort((one, other) => newerFirst(one.latest, other.latest));
}
