import type postgres from "postgres";
import { sql } from "@/db/client";
import { recordActivity } from "@/lib/observability/log";
import { firstDayOfMonth, firstInstantAfterMonth, lastDayOfMonth, monthThatEndedBefore } from "./compute";
import { runStatement, StatementRunRefused } from "./run";

// The monthly close: on the first day of a month, produce the statement of the month that just
// ended, for every broker who has anything to be told about it. Called by the daily job
// (app/api/jobs/daily/route.ts) after reconciliation, and by scripts/check-statements.ts with a
// date of its own so the behaviour can be proved without waiting for a cron.
//
// WHAT IT DOES, in one sentence: it calls the same runStatement() a staff member calls from
// /ops/statements, with actorUserId null because no person asked for it.
//
// THE FOUR RULES, and why each one is what it is:
//
//   1. ONLY ON THE FIRST DAY OF A MONTH (UTC). A statement of a month that has not ended yet
//      would be provisional (decision 19, point 3), and the job's job is to publish the
//      definitive one. Any other day it does nothing at all and says so in the summary.
//   2. THE MONTH IS THE ONE THAT JUST ENDED, never the running one.
//   3. WHICH BROKERS: those with at least one journal movement whose effective date falls in that
//      month, plus those with a policy in force. The second half matters: a broker whose month
//      was quiet is still owed a document saying "nothing moved, net due 0", and a document that
//      only exists when there is money is a document nobody can rely on.
//   4. EXACTLY ONCE. Before running a broker, the job looks for a run of that broker and that
//      month whose knowledge cutoff is at or after the end of the month: a run made once the
//      month was over, which is the definitive one. If there is one, the month has already been
//      published and the job skips the broker. So a second call the same day produces nothing,
//      and a cron that fires twice, or a retry after a timeout, cannot hand a broker two
//      documents for the same month.
//
// A PROVISIONAL RUN DOES NOT BLOCK IT, deliberately: a staff member who ran March on March 12 got
// a document with a cutoff inside March, the job still publishes the definitive one on April 1,
// and that one becomes revision 2 naming the provisional one as superseded. Nothing is rewritten,
// which is the whole model of a statement run (lib/statements/run.ts).
//
// THE KNOWLEDGE CUTOFF IS THE INSTANT THE JOB RAN, passed in as `now`. runStatement refuses a
// cutoff in the future (it compares with the database clock), so a caller whose clock runs ahead
// of the database's is refused, per broker, and the refusal is reported in the summary rather
// than stopping the whole month.

// The route name written on the activity row of each statement produced. It is not a URL: it is
// the pattern the console groups by, and the MCP endpoint already names its rows the same way
// ("/api/mcp <tool>"), so the work a job did is not mixed with the request that triggered it.
export const MONTHLY_STATEMENT_ROUTE = "/api/jobs/daily monthly-statement";

export type ProducedStatement = {
  brokerId: string;
  brokerName: string;
  runId: string;
  revision: number;
  netDueCents: number;
};

export type RefusedStatement = {
  brokerId: string;
  brokerName: string;
  reason: string;
};

export type MonthlyStatementsResult = {
  // False on any day but the first of a month, and then nothing else in this object is filled.
  itIsTheFirstDayOfAMonth: boolean;
  statementMonth: string | null; // "YYYY-MM", the month that just ended
  produced: ProducedStatement[];
  // Brokers whose definitive statement for that month already existed: the job had already run.
  alreadyPublished: number;
  // Brokers runStatement said no to. Never silent: an empty month must be visible as a refusal
  // and not as "nothing to do".
  refused: RefusedStatement[];
};

export type MonthlyStatementsRequest = {
  // The instant the job runs. It decides whether today is the first of a month, which month has
  // just ended, and the knowledge cutoff every run is read at.
  now: Date;
  // The correlation id of the request that triggered the job, so the activity row of each
  // statement produced can be found beside the row of the job itself.
  correlationId: string;
};

export async function produceMonthlyStatements(
  request: MonthlyStatementsRequest,
  database: postgres.Sql = sql,
): Promise<MonthlyStatementsResult> {
  if (request.now.getUTCDate() !== 1) {
    return {
      itIsTheFirstDayOfAMonth: false,
      statementMonth: null,
      produced: [],
      alreadyPublished: 0,
      refused: [],
    };
  }

  const statementMonth = monthThatEndedBefore(request.now);
  const brokers = await brokersOwedAStatementFor(statementMonth, database);

  const produced: ProducedStatement[] = [];
  const refused: RefusedStatement[] = [];
  let alreadyPublished = 0;

  for (const broker of brokers) {
    if (await definitiveStatementExists(broker.id, statementMonth, database)) {
      alreadyPublished += 1;
      continue;
    }
    const startedAtMs = Date.now();
    try {
      const run = await runStatement(
        {
          brokerId: broker.id,
          statementMonth,
          knowledgeCutoff: request.now,
          // No person asked for this run. `run_by` null is what the screens read as "produced by
          // a job" (migration 0012), and it is what the inbox reads too.
          actorUserId: null,
        },
        database,
      );
      produced.push({
        brokerId: broker.id,
        brokerName: broker.name,
        runId: run.runId,
        revision: run.revision,
        netDueCents: run.totals.netDueCents,
      });
      // One activity row per statement produced, so the console shows the document appearing on
      // the broker's own 360 page and not only "the daily job answered 200".
      await recordActivity({
        correlationId: request.correlationId,
        route: MONTHLY_STATEMENT_ROUTE,
        actorKind: "cron",
        actorUserId: null,
        actorRole: null,
        subjectKind: "broker",
        subjectId: broker.id,
        rule: null,
        message: `statement ${statementMonth} revision ${run.revision}, net due ${run.totals.netDueCents} cents`,
        // Not an HTTP request: it is one document the job produced. The column is text, and
        // saying JOB is more honest than borrowing the verb of the request that triggered it.
        method: "JOB",
        durationMs: Date.now() - startedAtMs,
        outcome: "ok",
        statusCode: 200,
      });
    } catch (error) {
      if (error instanceof StatementRunRefused) {
        // One broker refused is one broker reported; the other brokers still get their month.
        refused.push({ brokerId: broker.id, brokerName: broker.name, reason: error.message });
        continue;
      }
      throw error;
    }
  }

  return { itIsTheFirstDayOfAMonth: true, statementMonth, produced, alreadyPublished, refused };
}

type BrokerRow = { id: string; name: string };

// Every broker the month has something to say to: one whose ledger moved inside the month, or one
// with a policy in force. `policy_current` is a rebuildable cache and never a money record, and it
// is only read here to answer "does this broker have a live policy", never to compute a figure.
async function brokersOwedAStatementFor(
  statementMonth: string,
  database: postgres.Sql,
): Promise<BrokerRow[]> {
  return await database<BrokerRow[]>`
    select broker.id, broker.name
      from brokers broker
     where exists (
             select 1
               from journal_entries entry
              where entry.broker_id = broker.id
                and entry.effective_at between ${firstDayOfMonth(statementMonth)}
                                           and ${lastDayOfMonth(statementMonth)}
           )
        or exists (
             select 1
               from policies policy
               join policy_current current_policy on current_policy.policy_id = policy.id
              where policy.broker_id = broker.id
                and current_policy.status = 'bound'
           )
     order by broker.name
  `;
}

// Has this broker's month already been published? The question is asked of the cutoff and not of
// the number of runs: a provisional run made during the month is not the publication.
async function definitiveStatementExists(
  brokerId: string,
  statementMonth: string,
  database: postgres.Sql,
): Promise<boolean> {
  const rows = await database<{ one: number }[]>`
    select 1 as one
      from statement_runs run
     where run.broker_id = ${brokerId}
       and run.statement_month = ${firstDayOfMonth(statementMonth)}
       and run.knowledge_cutoff >= ${firstInstantAfterMonth(statementMonth)}
     limit 1
  `;
  return rows.length > 0;
}
