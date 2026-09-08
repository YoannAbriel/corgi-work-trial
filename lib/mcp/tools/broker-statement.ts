import { statementBrokerFor } from "@/lib/mcp/scope";
import { collectedFigures, isStatementMonth, firstDayOfMonth } from "@/lib/statements/compute";
import { statementRun } from "@/lib/statements/read";
import { optionalWholeNumber, requiredText, ToolRefused, usd, type McpTool } from "./tool";

// get_broker_statement: one broker's commission statement for one month, exactly as it was
// published.
//
// It reads a STORED RUN (statement_runs and statement_lines, slice B9). Nothing is recomputed
// here: a statement is what we told a broker they were owed, and this tool hands back that
// document, its content hash, its knowledge cutoff and its format version. Asking twice for the
// same revision gives the same figures for ever, because the rows can never change.
//
// Scope: a broker key passes "me" and reads its own months; a staff key names a broker id. A
// customer has no commission account, so a customer key is refused.

export const getBrokerStatement: McpTool = {
  name: "get_broker_statement",
  title: "Broker monthly statement",
  description:
    "A published broker commission statement for one month: its lines, its totals (cash collected, premium collected, commission earned, clawbacks, net due), its content hash, its knowledge cutoff and its format version. Reads a stored run; nothing is recomputed. Scoped to what this API key's user may see.",
  inputSchema: {
    type: "object",
    properties: {
      brokerId: {
        type: "string",
        description: 'The broker id, or "me" for the broker behind this key. A broker key can only pass "me".',
      },
      month: { type: "string", description: "The statement month, YYYY-MM, for example 2028-03." },
      revision: {
        type: "number",
        description: "Which revision to read. Defaults to the latest one for that broker and month.",
      },
    },
    required: ["brokerId", "month"],
    additionalProperties: false,
  },
  async run(args, context) {
    const month = requiredText(args, "month");
    if (!isStatementMonth(month)) {
      throw new ToolRefused(`"${month}" is not a statement month; write it as YYYY-MM, for example 2028-03`);
    }
    const revision = optionalWholeNumber(args, "revision");
    if (revision !== null && revision < 1) {
      throw new ToolRefused('"revision" starts at 1');
    }

    const scope = statementBrokerFor(context.user, requiredText(args, "brokerId"));
    if ("refusal" in scope) {
      throw new ToolRefused(scope.refusal);
    }
    // A staff key may pass any text as a broker id; an id that is not a uuid must answer the
    // same sentence as an unknown broker, not a database error.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scope.brokerId)) {
      throw new ToolRefused("no statement has been published for that broker and month");
    }

    const [found] = await context.database<{ id: string }[]>`
      select id from statement_runs
       where broker_id = ${scope.brokerId}
         and statement_month = ${firstDayOfMonth(month)}
         and revision = coalesce(${revision}::integer, revision)
       order by revision desc
       limit 1
    `;
    if (!found) {
      throw new ToolRefused(
        revision === null
          ? "no statement has been published for that broker and month"
          : `no revision ${revision} of that broker's ${month} statement has been published`,
      );
    }

    const detail = await statementRun(context.database, found.id);
    if (!detail) {
      throw new ToolRefused("no statement has been published for that broker and month");
    }
    const { run, lines } = detail;
    const collected = collectedFigures(run);

    return {
      runId: run.runId,
      broker: { id: run.brokerId, name: run.brokerName },
      month: run.statementMonth,
      revision: run.revision,
      supersedesRunId: run.supersedesRunId,
      identicalToPrevious: run.identicalToPrevious,
      // What makes a closed month reproducible: the same broker, month and cutoff read the same
      // journal entries and produce the same hash (DECISIONS.md, 2026-09-08 10:02Z).
      knowledgeCutoff: run.knowledgeCutoff.toISOString(),
      contentHash: run.contentHash,
      formatVersion: run.canonicalVersion,
      formatNote: collected.formatNote,
      provisional: run.monthWasStillRunning,
      totals: {
        cashCollected: usd(collected.cashCollectedCents),
        premiumCollected: collected.premiumCollectedCents === null ? null : usd(collected.premiumCollectedCents),
        commissionEarned: usd(run.commissionEarnedCents),
        clawback: usd(run.clawbackCents),
        adjustment: usd(run.adjustmentCents),
        netDue: usd(run.netDueCents),
      },
      lines: lines.map((line) => ({
        order: line.lineOrder,
        kind: line.kind,
        policyNumber: line.policyNumber,
        journalEntryId: line.journalEntryId,
        effectiveAt: line.effectiveAt.toISOString().slice(0, 10),
        entryRecordedAt: line.entryRecordedAt.toISOString(),
        amount: usd(line.amountCents),
        commissionBase: line.commissionBaseCents === null ? null : usd(line.commissionBaseCents),
        description: line.description,
      })),
      whatThisMeans:
        `${run.brokerName} is owed ${usd(run.netDueCents).formatted} for ${run.statementMonth} on revision ` +
        `${run.revision}. Net due is the movement of this broker's commission_payable account in that month, ` +
        `so it ties to the ledger to the cent. ${
          run.monthWasStillRunning
            ? "The month was still running when this run was made, so it is provisional: a later run of the same month is the definitive one."
            : "The month was over when this run was made."
        } A correction recorded after the knowledge cutoff is invisible here and appears in a new revision.`,
    };
  },
};
