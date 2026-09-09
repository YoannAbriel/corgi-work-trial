import { settleDueSimulatedPayouts } from "@/lib/claims/settle-due-payouts";
import { assertJobIsAuthorised, jobResponse, JobNotAuthorised } from "@/lib/jobs/authorize";
import { recoverStuckOperations, STUCK_AFTER_MINUTES } from "@/lib/payments/recover";
import { runAllSources, windowCoveringOpenBreaks } from "@/lib/reconciliation/run";
import { produceMonthlyStatements } from "@/lib/statements/monthly-job";
import { withActivity, type Activity } from "@/lib/observability/log";

// GET (and POST) /api/jobs/daily
// Authorization: Bearer <CRON_SECRET>
//
// The one scheduled job of this build, declared in vercel.json. Vercel's Hobby plan allows a
// small number of cron jobs, each at most once a day, so the three pieces of recurring work run
// one after the other behind a single endpoint instead of asking for three schedules.
//
// GET as well as POST because Vercel Cron invokes a path with a GET request (Vercel docs, cron
// jobs quickstart, read 2026-09-08); POST is kept so the endpoint can be driven by hand with the
// same curl shape as the other job endpoints. Both go through the same authorisation and the
// same work.
//
// THE ORDER MATTERS, and it is the order an operator would use by hand:
//
//   1. recover-operations       finish money operations that were committed and never sent,
//                               so the ledger is as complete as it can be before anything
//                               compares it with a provider;
//   2. settle-simulated-payouts let the simulated rail settle what is due, for the same reason:
//                               a settlement that has happened should be in the books before the
//                               comparison, not reported as a break the next morning;
//   3. reconcile                compare both providers with the ledger and store the runs. Its
//                               window is the last seven days, opened backwards far enough to
//                               cover the oldest break that is still open, so a break can close
//                               itself instead of ageing out of every window (finding F-B10-01);
//   4. monthly-statements       on the first day of a month only, publish the statement of the
//                               month that just ended for every broker who is owed one
//                               (lib/statements/monthly-job.ts). It runs LAST, and after
//                               reconciliation on purpose: a statement is the document we hand a
//                               broker, so it is produced once the ledger has been completed and
//                               compared, never before. On any other day it does nothing.
//
// Each step is independent and safe to rerun; a step that throws stops the job and is reported,
// because a reconciliation run made on a half-recovered ledger would be misleading.
export const GET = withActivity({ route: "/api/jobs/daily", rule: "cron secret", actor: "cron" }, handleGet);

async function handleGet(request: Request, _context: unknown, activity: Activity) {
  return runDailyJob(request, activity);
}

export const POST = withActivity({ route: "/api/jobs/daily", rule: "cron secret", actor: "cron" }, handlePost);

async function handlePost(request: Request, _context: unknown, activity: Activity) {
  return runDailyJob(request, activity);
}

// The activity of the request itself is passed in for its CORRELATION ID: the statements step
// writes one activity row per statement produced, and they carry the id of the job that produced
// them, so the console shows the job and its documents as one story.
async function runDailyJob(request: Request, activity: Activity) {
  try {
    assertJobIsAuthorised(request);
  } catch (error) {
    if (error instanceof JobNotAuthorised) {
      return jobResponse({ error: error.message }, 401);
    }
    throw error;
  }

  const recovered = await recoverStuckOperations();
  const settled = await settleDueSimulatedPayouts();
  const scheduled = await windowCoveringOpenBreaks(new Date());
  const reconciled = await runAllSources({ window: scheduled.window, runByUserId: null, now: new Date() });
  const statements = await produceMonthlyStatements({ now: new Date(), correlationId: activity.correlationId });

  return jobResponse({
    job: "daily",
    steps: [
      { step: "recover-operations", stuckForMinutes: STUCK_AFTER_MINUTES, ...recovered },
      { step: "settle-simulated-payouts", provider: "LOCAL SIMULATOR", ...settled },
      {
        step: "reconcile",
        window: scheduled.window,
        oldestOpenBreakAt: scheduled.oldestOpenBreakAt,
        // False when a break is older than the 31-day cap: this run could not look at it, so it
        // stays open with its real age and a staff run with an explicit window is what closes it.
        reachesTheOldestOpenBreak: scheduled.reachesTheOldestOpenBreak,
        runs: reconciled,
      },
      {
        step: "monthly-statements",
        // Every other day of the month this line reads "false, null, 0": the step ran and had
        // nothing to publish, which is not the same as the step having been skipped.
        firstDayOfTheMonth: statements.itIsTheFirstDayOfAMonth,
        statementMonth: statements.statementMonth,
        produced: statements.produced.length,
        alreadyPublished: statements.alreadyPublished,
        refused: statements.refused,
        brokers: statements.produced,
      },
    ],
  });
}
