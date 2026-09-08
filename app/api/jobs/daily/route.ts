import { settleDueSimulatedPayouts } from "@/lib/claims/settle-due-payouts";
import { assertJobIsAuthorised, jobResponse, JobNotAuthorised } from "@/lib/jobs/authorize";
import { recoverStuckOperations, STUCK_AFTER_MINUTES } from "@/lib/payments/recover";
import { runAllSources } from "@/lib/reconciliation/run";
import { defaultWindow } from "@/lib/reconciliation/window";

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
//   3. reconcile                compare both providers with the ledger and store the runs.
//
// Each step is independent and safe to rerun; a step that throws stops the job and is reported,
// because a reconciliation run made on a half-recovered ledger would be misleading.
export async function GET(request: Request) {
  return runDailyJob(request);
}

export async function POST(request: Request) {
  return runDailyJob(request);
}

async function runDailyJob(request: Request) {
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
  const window = defaultWindow(new Date());
  const reconciled = await runAllSources({ window, runByUserId: null, now: new Date() });

  return jobResponse({
    job: "daily",
    steps: [
      { step: "recover-operations", stuckForMinutes: STUCK_AFTER_MINUTES, ...recovered },
      { step: "settle-simulated-payouts", provider: "LOCAL SIMULATOR", ...settled },
      { step: "reconcile", window, runs: reconciled },
    ],
  });
}
