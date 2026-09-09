import { currentUser } from "@/lib/auth/current-user";
import { assertJobIsAuthorised, jobResponse, JobNotAuthorised } from "@/lib/jobs/authorize";
import { breakCount, runAllSources, type ReconciliationRunSummary } from "@/lib/reconciliation/run";
import { defaultWindow, parseWindow, WindowRefused, type ReconciliationWindow } from "@/lib/reconciliation/window";
import { withActivity } from "@/lib/observability/log";

// POST /api/jobs/reconcile
//
// Two callers, one code path, two answers:
//
//   the daily job, with `Authorization: Bearer <CRON_SECRET>`  -> a JSON summary;
//   a staff member pressing "Run now" on /ops/reconciliation   -> a redirect back to the screen.
//
// The window comes from the form (or the query string) and defaults to the last seven days. Both
// sources are reconciled in sequence, Stripe first, so one failing provider still produces a run
// for the other one.
//
// Nothing here can move money: the job reads the provider, reads the ledger and appends to its
// own two tables. The reason it is authorised at all is that it is not free (it calls Stripe) and
// that its runs are records of what we knew, which nobody unauthenticated should be able to write.
export const POST = withActivity({ route: "/api/jobs/reconcile", rule: "cron secret", actor: "cron" }, handlePost);

async function handlePost(request: Request) {
  const user = await currentUser();
  const staffUser = user && (user.role === "staff_ops" || user.role === "staff_approver") ? user : null;

  if (!staffUser) {
    try {
      assertJobIsAuthorised(request);
    } catch (error) {
      if (error instanceof JobNotAuthorised) {
        return jobResponse({ error: error.message }, 401);
      }
      throw error;
    }
  }

  let window: ReconciliationWindow;
  try {
    window = await readWindow(request);
  } catch (error) {
    if (error instanceof WindowRefused) {
      return staffUser
        ? redirectTo(`/ops/reconciliation?error=${encodeURIComponent(error.message)}`)
        : jobResponse({ error: error.message }, 400);
    }
    throw error;
  }

  const summaries = await runAllSources({ window, runByUserId: staffUser?.id ?? null, now: new Date() });

  if (staffUser) {
    return redirectTo(`/ops/reconciliation?ran=${encodeURIComponent(describe(summaries))}`);
  }
  return jobResponse({ job: "reconcile", window, runs: summaries });
}

// The window a caller asked for. A staff form sends it as form fields; a script or the daily job
// may put it in the query string. Anything missing falls back to the last seven days.
async function readWindow(request: Request): Promise<ReconciliationWindow> {
  const fromQueryString = new URL(request.url).searchParams;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("form")) {
    const form = await request.formData();
    return parseWindow({ from: readText(form.get("from")), to: readText(form.get("to")) }, new Date());
  }
  if (fromQueryString.has("from") || fromQueryString.has("to")) {
    return parseWindow({ from: fromQueryString.get("from"), to: fromQueryString.get("to") }, new Date());
  }
  return defaultWindow(new Date());
}

// A form field is a string or an uploaded file; only a string is a date.
function readText(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" ? value : null;
}

// One sentence per source for the banner on the screen. A failed run says so first: it found no
// breaks because it could not look, which is not the same thing as finding none.
function describe(summaries: ReconciliationRunSummary[]): string {
  return summaries
    .map((summary) =>
      summary.status === "failed"
        ? `${summary.source} FAILED: ${summary.fetchError}`
        : `${summary.source}: ${summary.providerRecordCount} provider records against ${summary.ledgerRecordCount} ledger records, ${breakCount(summary)} breaks`,
    )
    .join(" | ");
}

function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
