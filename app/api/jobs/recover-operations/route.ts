import { assertJobIsAuthorised, jobResponse, JobNotAuthorised } from "@/lib/jobs/authorize";
import { recoverStuckOperations, STUCK_AFTER_MINUTES } from "@/lib/payments/recover";
import { withActivity } from "@/lib/observability/log";

// POST /api/jobs/recover-operations
// Authorization: Bearer <CRON_SECRET>
//
// The other half of the outbox: it finishes money operations that were written, committed and
// then never sent because the process died (review finding F-B5-03, ARCHITECTURE.md section 7).
// The recovery rules themselves are in lib/payments/recover.ts, so the same code runs from this
// endpoint and from scripts/check-claims-and-approvals.ts.
export const POST = withActivity({ route: "/api/jobs/recover-operations", actor: "cron" }, handlePost);

async function handlePost(request: Request) {
  try {
    assertJobIsAuthorised(request);
  } catch (error) {
    if (error instanceof JobNotAuthorised) {
      return jobResponse({ error: error.message }, 401);
    }
    throw error;
  }

  const report = await recoverStuckOperations();
  return jobResponse({ job: "recover-operations", stuckForMinutes: STUCK_AFTER_MINUTES, ...report });
}
