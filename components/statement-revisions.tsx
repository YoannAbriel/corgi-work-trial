import Link from "next/link";
import { Chip } from "@/components/detail-layout";
import { When } from "@/components/ui/time";
import { formatCentsAsUsd } from "@/lib/money/cents";
import type { StatementRunRow } from "@/lib/statements/read";

// One row per broker and month on the two statement lists (Yoann, 2026-09-09 evening).
//
// The lists used to print every revision of every month as its own row: Redwood 2026-09 took five
// rows on /ops/statements, and the row a reader wanted, the newest one, was one of five that all
// looked alike. A month is one document with a history, so it is one row: the newest revision,
// with the ones it replaced folded under it.
//
// NOTHING HERE READS THE DATABASE AND NOTHING HERE COMPUTES MONEY. It receives the rows the
// reader (lib/statements/read.ts) already returned and only decides which of them is a row and
// which are lines of a fold. The two pages share it so that the staff list and the broker list
// cannot drift into two different definitions of "the latest revision".

export type StatementMonthGroup = {
  // The newest revision of this broker and month: the one the row shows and links to.
  latest: StatementRunRow;
  // The revisions it replaced, newest first. Empty on a month that was only ever run once, and
  // then the row has no revision fold to offer.
  earlier: StatementRunRow[];
};

// Groups the runs by broker and month, newest revision first inside a group, newest group first.
//
// "Newest" is decided by createdAt, when the run was produced, and never by the revision number:
// the two agree on this data, and if they ever disagreed the produced time is the fact the
// database stamped. The order across groups is the age-only rule of the two lists (Yoann,
// 2026-09-09): the month whose newest revision has just been produced is the first row, whoever
// the broker is, because that is the run a person came to look at.
export function groupRunsByBrokerAndMonth(runs: StatementRunRow[]): StatementMonthGroup[] {
  const revisionsByBrokerAndMonth = new Map<string, StatementRunRow[]>();
  for (const run of runs) {
    // Broker id and not broker name: two brokers may be renamed into the same words, and the id
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
    const newestFirst = [...revisions].sort((one, other) => other.createdAt.getTime() - one.createdAt.getTime());
    return { latest: newestFirst[0], earlier: newestFirst.slice(1) };
  });
  return groups.sort((one, other) => other.latest.createdAt.getTime() - one.latest.createdAt.getTime());
}

// The revisions a row replaced, inside its fold: the revision number, how long ago it was
// produced, its own net due, its chips, and a link to the run page of each. A list rather than a
// second table, because it repeats four facts of the row above it and a table nested in a table
// row reads as another screen.
//
// Renders nothing at all when there is no earlier revision: a month run once has no history to
// fold, and an empty "Earlier revisions" heading would promise one.
export function EarlierRevisions({ revisions, now }: { revisions: StatementRunRow[]; now: Date }) {
  if (revisions.length === 0) {
    return null;
  }
  return (
    <div className="stmt-earlier">
      <h3>
        {revisions.length === 1 ? "The revision this one replaces" : `The ${revisions.length} revisions this one replaces`}
      </h3>
      <ul>
        {revisions.map((run) => (
          <li key={run.runId}>
            <Link href={`/statements/${run.runId}`} prefetch={false}>
              Revision {run.revision}
            </Link>
            <span className="stmt-earlier-age">
              <When instant={run.createdAt} now={now} />
            </span>
            <span className="stmt-earlier-amount">{formatCentsAsUsd(run.netDueCents)}</span>
            <span>
              {run.monthWasStillRunning ? <Chip tone="warn">provisional</Chip> : <Chip tone="neutral">closed</Chip>}
              {run.identicalToPrevious ? (
                <span title={`The same content hash as revision ${run.revision - 1}`}>
                  <Chip tone="ok">identical</Chip>
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
