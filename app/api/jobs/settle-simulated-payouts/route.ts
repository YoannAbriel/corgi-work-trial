import { assertJobIsAuthorised, jobResponse, JobNotAuthorised } from "@/lib/jobs/authorize";
import { settleDueSimulatedPayouts } from "@/lib/claims/settle-due-payouts";

// POST /api/jobs/settle-simulated-payouts
// Authorization: Bearer <CRON_SECRET>
//
// LOCAL SIMULATOR. The job that plays the part of the bank telling us that a claim payment has
// settled. The work itself, and the reasons a rerun is harmless, are in
// lib/claims/settle-due-payouts.ts, so the daily job runs this exact code too.
export async function POST(request: Request) {
  try {
    assertJobIsAuthorised(request);
  } catch (error) {
    if (error instanceof JobNotAuthorised) {
      return jobResponse({ error: error.message }, 401);
    }
    throw error;
  }

  const report = await settleDueSimulatedPayouts();
  return jobResponse({ job: "settle-simulated-payouts", provider: "LOCAL SIMULATOR", ...report });
}
