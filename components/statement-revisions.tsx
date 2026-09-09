import Link from "next/link";
import { Chip } from "@/components/detail-layout";
import { When } from "@/components/ui/time";
import { formatCentsAsUsd } from "@/lib/money/cents";
import type { StatementRunRow } from "@/lib/statements/read";

// The revisions a row replaced, inside its fold: the revision number, how long ago it was
// produced, its own net due, its chips, and a link to the run page of each. A list rather than a
// second table, because it repeats four facts of the row above it and a table nested in a table
// row reads as another screen.
//
// The grouping that decides which revisions land here is lib/statements/group-runs.ts.
//
// WHAT THIS LIST CANNOT SEE (review finding F-ST-02): both pages read the 30 most recent runs and
// nothing else, so this is the revisions of that window, not every revision of the month. A month
// whose sixth revision is inside the window and whose first is not shows five. The heading says
// "in the last 30 runs" for that reason, and the sentence under each table says it again in full;
// the run page of any revision still names the one it supersedes, which is the way out of the
// window. Neither page may widen the query tonight.
//
// Renders nothing at all when there is no earlier revision in the window: an empty "Earlier
// revisions" heading would promise a history that this list cannot show.
export function EarlierRevisions({
  revisions,
  now,
  windowSize,
}: {
  revisions: StatementRunRow[];
  now: Date;
  // How many runs the page read, so the heading can say what the count is a count of.
  windowSize: number;
}) {
  if (revisions.length === 0) {
    return null;
  }
  return (
    <div className="stmt-earlier">
      <h3>Earlier revisions in the last {windowSize} runs</h3>
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
              {/* The same three chips a row carries, so a revision does not lose a fact by being
                  folded (review finding F-ST-01). Two revisions written in different formats hash
                  different texts, so neither "identical" nor "changed" is an answer about them
                  (review finding F-B9-09) and the reader has to be told which pair that is. */}
              {run.previousCanonicalVersion !== null && run.previousCanonicalVersion !== run.canonicalVersion ? (
                <Chip tone="neutral">format changed</Chip>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
