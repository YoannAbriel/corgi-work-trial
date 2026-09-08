import type postgres from "postgres";
import { sql } from "@/db/client";
import { isUniqueViolation } from "@/lib/ledger/post";
import {
  assertStatementMonth,
  CANONICAL_STATEMENT_VERSION,
  computeStatement,
  firstDayOfMonth,
  type StatementTotals,
} from "./compute";
import { brokerJournalEntriesInMonth } from "./journal";

// Running a broker's monthly statement: read the journal, compute, store the result forever.
//
// THE THREE STEPS, in this order, and the order is the whole argument:
//
//   1. READ the journal with the runtime role, for one broker, one month, up to one cutoff.
//      Nothing is written yet.
//   2. COMPUTE, purely (lib/statements/compute.ts). No database, no clock.
//   3. STORE the run and its lines in ONE transaction, so a run summary never exists without the
//      lines it counted and the lines never exist without their run.
//
// WHAT A RE-RUN DOES, and this is the question the panel asks:
//
//   * a second run of the same broker and month is ALWAYS stored. It is revision N+1 and it names
//     the run it supersedes. Nothing is ever edited or replaced: running a statement again is an
//     event, and an event is evidence.
//   * with the SAME knowledge cutoff, it reads exactly the same journal entries (recorded_at is
//     set by the database and a journal row can never change), so it computes the same lines and
//     the same content hash. It is stored with identical_to_previous = true.
//   * with a LATER cutoff, after a correction was recorded, it sees the correction, its hash
//     differs, and the two revisions sit side by side: revision 1 says what we told the broker
//     then, revision 2 says what is true now, and revision 1 names nothing while revision 2 names
//     revision 1 as superseded.
//
// KNOWN LIMITATION, worth saying out loud rather than discovering at a debrief: a cutoff taken
// while money is being posted can miss an entry whose transaction had not committed yet, and a
// later re-run with that same cutoff would then see it and produce a different hash. Postgres
// stamps recorded_at with the transaction's start time, so the entry's recorded_at can be below a
// cutoff the run had already passed. It cannot happen for a month that is closed and quiet, which
// is what a monthly statement is for; a run taken in the middle of live activity is an interim
// view and is not promised to reproduce.

export class StatementRunRefused extends Error {}

export type StatementRunRequest = {
  brokerId: string;
  statementMonth: string; // "YYYY-MM"
  // The recorded_at upper bound to read up to. Defaults to now, which is what a fresh monthly
  // close does; a re-run of a closed month passes the cutoff of the revision it reproduces.
  knowledgeCutoff?: Date;
  actorUserId: string | null; // the staff member who ran it, null for a job
};

export type StatementRunResult = {
  runId: string;
  brokerId: string;
  statementMonth: string;
  revision: number;
  knowledgeCutoff: Date;
  supersedesRunId: string | null;
  contentHash: string;
  identicalToPrevious: boolean;
  totals: StatementTotals;
  lineCount: number;
  createdAt: Date;
};

export async function runStatement(
  request: StatementRunRequest,
  database: postgres.Sql = sql,
): Promise<StatementRunResult> {
  assertStatementMonth(request.statementMonth);

  // The default cutoff comes from the DATABASE clock, not from this process's clock. recorded_at
  // on a journal entry is stamped by Postgres (migrations 0001 and 0003), so a cutoff taken from
  // a web server whose clock runs a second behind would silently drop entries that were already
  // recorded. Both clocks have to be the same clock.
  const [{ now: databaseNow }] = await database<{ now: Date }[]>`select now() as now`;
  const knowledgeCutoff = request.knowledgeCutoff ?? databaseNow;
  // A cutoff in the future would break the promise this whole slice makes: entries recorded
  // between the run and a later re-run would be below the same cutoff, and the "identical"
  // re-run would not be identical.
  if (knowledgeCutoff.getTime() > databaseNow.getTime()) {
    throw new StatementRunRefused(
      "a knowledge cutoff cannot be in the future: a run must only read what the ledger already knows",
    );
  }

  const [broker] = await database<{ id: string }[]>`select id from brokers where id = ${request.brokerId}`;
  if (!broker) {
    throw new StatementRunRefused("this broker does not exist");
  }

  // 1 and 2: read, then compute. Both outside the transaction that stores, exactly as the
  // reconciliation job does (lib/reconciliation/run.ts): the expensive part happens first and
  // writes nothing.
  const entries = await brokerJournalEntriesInMonth(
    { brokerId: request.brokerId, statementMonth: request.statementMonth, knowledgeCutoff },
    database,
  );
  const statement = computeStatement({
    brokerId: request.brokerId,
    statementMonth: request.statementMonth,
    entries,
  });

  // 3: store. The revision number is read and written inside the same transaction, and the unique
  // index on (broker_id, statement_month, revision) is what makes two simultaneous runs impossible
  // to confuse: the loser's whole transaction rolls back and it can simply run again.
  try {
    return await database.begin(async (transaction) => {
      const [previous] = await transaction<
        { id: string; revision: number; content_hash: string; canonical_version: number }[]
      >`
        select id, revision, content_hash, canonical_version
          from statement_runs
         where broker_id = ${request.brokerId}
           and statement_month = ${firstDayOfMonth(request.statementMonth)}
         order by revision desc
         limit 1
      `;
      const revision = previous ? previous.revision + 1 : 1;
      // Two runs written in different formats hash different texts, so "identical" is not a
      // question that can be answered between them: the screens say "format changed" instead
      // (review finding F-B9-09).
      const identicalToPrevious =
        previous !== undefined &&
        previous.canonical_version === CANONICAL_STATEMENT_VERSION &&
        previous.content_hash === statement.contentHash;

      const [run] = await transaction<{ id: string; created_at: Date }[]>`
        insert into statement_runs (
          broker_id, statement_month, revision, knowledge_cutoff, supersedes_run_id, content_hash,
          identical_to_previous, canonical_version, cash_collected_cents, premium_collected_cents,
          commission_earned_cents, clawback_cents, adjustment_cents, net_due_cents, run_by
        ) values (
          ${request.brokerId}, ${firstDayOfMonth(request.statementMonth)}, ${revision},
          ${knowledgeCutoff}, ${previous?.id ?? null}, ${statement.contentHash}, ${identicalToPrevious},
          ${CANONICAL_STATEMENT_VERSION},
          ${statement.totals.cashCollectedCents}, ${statement.totals.premiumCollectedCents},
          ${statement.totals.commissionEarnedCents}, ${statement.totals.clawbackCents},
          ${statement.totals.adjustmentCents}, ${statement.totals.netDueCents}, ${request.actorUserId}
        )
        returning id, created_at
      `;

      if (statement.lines.length > 0) {
        // One statement for all the lines: postgres.js expands the array of objects into a
        // multi-row INSERT with exactly these columns, in this order.
        const rows = statement.lines.map((line) => ({
          run_id: run.id,
          line_order: line.lineOrder,
          kind: line.kind,
          policy_id: line.policyId,
          policy_number: line.policyNumber,
          journal_entry_id: line.journalEntryId,
          effective_at: line.effectiveAt,
          entry_recorded_at: line.entryRecordedAt,
          amount_cents: line.amountCents,
          commission_base_cents: line.commissionBaseCents,
          description: line.description,
        }));
        await transaction`
          insert into statement_lines ${transaction(
            rows,
            "run_id",
            "line_order",
            "kind",
            "policy_id",
            "policy_number",
            "journal_entry_id",
            "effective_at",
            "entry_recorded_at",
            "amount_cents",
            "commission_base_cents",
            "description",
          )}
        `;
      }

      return {
        runId: run.id,
        brokerId: request.brokerId,
        statementMonth: request.statementMonth,
        revision,
        knowledgeCutoff,
        supersedesRunId: previous?.id ?? null,
        contentHash: statement.contentHash,
        identicalToPrevious,
        totals: statement.totals,
        lineCount: statement.lines.length,
        createdAt: run.created_at,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Another run of the same broker and month committed while this one was being written. It
      // is not a failure of the ledger, and nothing was stored: the person runs it again and gets
      // the next revision.
      throw new StatementRunRefused(
        "another statement run for this broker and month committed at the same moment; run it again to get the next revision",
      );
    }
    throw error;
  }
}
