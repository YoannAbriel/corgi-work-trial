import { staffOnlyRefusal } from "@/lib/mcp/scope";
import { breakCount, runAllSources } from "@/lib/reconciliation/run";
import { MAX_WINDOW_DAYS } from "@/lib/reconciliation/window";
import { optionalWholeNumber, ToolRefused, type McpTool } from "./tool";

// run_reconciliation: runs the comparison job for a window and answers what it found.
//
// It is a write tool in the sense that it appends two kinds of row (a run and its items), and
// it is NOT money-out: the job asks the provider what it has, reads our ledger, compares the
// two and writes down the answer. It cannot post a journal entry, and the runtime role it runs
// under holds SELECT and INSERT only on every money table. Yoann asked for it next to the three
// read tools for exactly that reason (DECISIONS.md, 2026-09-08 15:12Z, point 3).
//
// Staff only, like the "Run now" button on /ops/reconciliation, and for the same two reasons:
// it calls Stripe, so it is not free, and its runs are records of what we knew.

const DEFAULT_WINDOW_DAYS = 7;

export const runReconciliationTool: McpTool = {
  name: "run_reconciliation",
  title: "Run the reconciliation job",
  description:
    "Runs the reconciliation for a window ending now, against both sources (Stripe and the LOCAL SIMULATOR claim payout rail), and returns the run ids and the counts. It moves no money: it appends one run and its compared items. A run that could not fetch is stored as failed with its reason and compares nothing. Staff keys only.",
  inputSchema: {
    type: "object",
    properties: {
      windowDays: {
        type: "number",
        description: `How many days back from now to compare. Defaults to ${DEFAULT_WINDOW_DAYS}, at most ${MAX_WINDOW_DAYS}.`,
      },
    },
    additionalProperties: false,
  },
  async run(args, context) {
    const refusal = staffOnlyRefusal(context.user, "run the reconciliation job");
    if (refusal) {
      throw new ToolRefused(refusal);
    }
    const windowDays = optionalWholeNumber(args, "windowDays") ?? DEFAULT_WINDOW_DAYS;
    if (windowDays < 1 || windowDays > MAX_WINDOW_DAYS) {
      throw new ToolRefused(`"windowDays" must be between 1 and ${MAX_WINDOW_DAYS}`);
    }

    const window = {
      from: new Date(context.now.getTime() - windowDays * 24 * 60 * 60 * 1000),
      to: context.now,
    };
    // The run is filed under the key holder's user id, because that is whose visibility it
    // borrows. That alone would print "Run by <a person's name>" on /ops/reconciliation for a run
    // no person launched (review finding F-B11-03), so the run also carries a sentence naming the
    // principal kind and the public key prefix, in the note the screen already shows.
    const launchedThrough =
      `Launched through the MCP surface by ${context.principal.principalKind === "agent" ? "an AGENT" : "a human"} ` +
      `key ${context.principal.keyPrefix}, not by a person on this screen.`;
    const summaries = await runAllSources(
      { window, runByUserId: context.user.id, launchedThrough, now: context.now },
      context.database,
    );

    const failed = summaries.filter((summary) => summary.status === "failed");
    return {
      window: { from: window.from.toISOString(), to: window.to.toISOString(), days: windowDays },
      runs: summaries.map((summary) => ({
        runId: summary.runId,
        source: summary.source,
        status: summary.status,
        fetchError: summary.fetchError,
        counts: summary.counts,
        breaks: breakCount(summary),
        providerRecordCount: summary.providerRecordCount,
        ledgerRecordCount: summary.ledgerRecordCount,
        note: summary.note,
        finishedAt: summary.finishedAt.toISOString(),
      })),
      moneyMoved: false,
      // Repeated in the answer so the caller can see what an operator will see about it.
      launchedThrough,
      whatThisMeans:
        failed.length > 0
          ? `${failed.length} of ${summaries.length} source(s) could not be fetched, so their runs are stored as ` +
            `FAILED with the reason and compared nothing. A failed run is not "zero breaks". The other runs ` +
            `compared their window and their counts are above. No money moved.`
          : `Both sources were compared over the last ${windowDays} day(s). ` +
            `${summaries.reduce((total, summary) => total + breakCount(summary), 0)} record(s) could not be matched; ` +
            `call list_reconciliation_breaks for what they are and how long they have been open. No money moved: ` +
            `the job appends a run and its items and never touches a journal entry.`,
    };
  },
};
