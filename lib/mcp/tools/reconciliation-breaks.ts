import type postgres from "postgres";
import { staffOnlyRefusal } from "@/lib/mcp/scope";
import { centsFromDatabase } from "@/lib/money/cents";
import { describeAge, type ReconciliationSourceName } from "@/lib/reconciliation/breaks";
import { openBreaks, recentRuns } from "@/lib/reconciliation/read";
import { optionalText, ToolRefused, usd, type McpTool } from "./tool";

// list_reconciliation_breaks: everything the latest complete run of each source reported as
// anything but matched, with how long it has been open and what it means, plus the clearing
// balances that should be zero when every flow has completed.
//
// Staff only. A break names provider references and amounts of other people's money, so it is
// not scoped to a broker or a customer: it is simply not theirs to read.
//
// The two lists answer different questions and both are needed:
//   the breaks             one line per record the last run could not match;
//   the clearing balances  what is sitting in the accounts money passes THROUGH. They are
//                          window-immune: a flow that got stuck two months ago no longer
//                          appears in any comparison window, but its clearing balance is still
//                          not zero (ARCHITECTURE.md section 1).

// The accounts money passes through on its way in or out. Each one should return to zero once
// the flow that used it has completed.
const CLEARING_ACCOUNTS: { id: string; meaning: string }[] = [
  { id: "premium_receivable", meaning: "premium billed and not yet collected" },
  { id: "refund_payable", meaning: "refunds owed to customers and not yet completed at Stripe" },
  { id: "claims_payable", meaning: "claim payments sent on the rail and not yet settled" },
  { id: "unapplied_customer_cash", meaning: "customer money received and not yet applied to a policy" },
];

export const listReconciliationBreaks: McpTool = {
  name: "list_reconciliation_breaks",
  title: "Open reconciliation breaks",
  effect: "read",
  description:
    "The open breaks of the latest complete reconciliation run of each source (Stripe, and the LOCAL SIMULATOR claim payout rail): what each one is, how long it has been open, the two amounts and what it means. Also the clearing account balances, which should be zero once every flow has completed. Staff keys only.",
  inputSchema: {
    type: "object",
    properties: {
      source: {
        type: "string",
        description: 'Optional filter: "stripe" or "claims_rail". Omit for both.',
        enum: ["stripe", "claims_rail"],
      },
    },
    additionalProperties: false,
  },
  async run(args, context) {
    const refusal = staffOnlyRefusal(context.user, "read reconciliation breaks");
    if (refusal) {
      throw new ToolRefused(refusal);
    }
    const source = optionalText(args, "source");
    if (source !== null && source !== "stripe" && source !== "claims_rail") {
      throw new ToolRefused('"source" must be "stripe" or "claims_rail" when it is given');
    }

    const [breaks, runs, clearing] = await Promise.all([
      openBreaks(context.database),
      recentRuns(context.database, 10),
      clearingBalances(context.database),
    ]);

    const selected = breaks.filter((row) => source === null || row.source === source);
    const latestRunPerSource = runs.filter(
      (run) => source === null || run.source === (source as ReconciliationSourceName),
    );

    return {
      openBreakCount: selected.length,
      breaks: selected.map((row) => ({
        source: row.source,
        classification: row.classification,
        breakKey: row.breakKey,
        providerRef: row.providerRef,
        ledgerRef: row.ledgerRef,
        providerAmount: row.providerAmountCents === null ? null : usd(row.providerAmountCents),
        ledgerAmount: row.ledgerAmountCents === null ? null : usd(row.ledgerAmountCents),
        difference: row.differenceCents === null ? null : usd(row.differenceCents),
        firstSeenAt: row.firstSeenAt.toISOString(),
        openFor: describeAge(row.firstSeenAt, context.now),
        lastReportedAt: row.lastReportedAt.toISOString(),
        meaning: row.note,
      })),
      clearingBalances: clearing,
      // A failed run compared nothing, so it can neither open a break nor close one. It is shown
      // here because "no breaks" from a run that could not look is not the same as "no breaks".
      recentRuns: latestRunPerSource.map((run) => ({
        runId: run.runId,
        source: run.source,
        status: run.status,
        fetchError: run.fetchError,
        window: { from: run.windowFrom.toISOString(), to: run.windowTo.toISOString() },
        finishedAt: run.finishedAt.toISOString(),
        counts: run.counts,
        providerRecordCount: run.providerRecordCount,
        ledgerRecordCount: run.ledgerRecordCount,
        note: run.note,
      })),
      whatThisMeans:
        `${selected.length} break(s) are open. A break is one record the last complete run could not match ` +
        `between a provider's own records and our ledger; its age is how long it has been reported. ` +
        `A clearing balance that is not zero is money in flight or stuck, whatever the comparison window was. ` +
        `Reading this changes nothing: reconciliation appends runs and items and never touches a money row.`,
    };
  },
};

// The balance of each clearing account, IN ITS OWN NORMAL DIRECTION, with the date of its last
// movement. A credit-side account (money we owe) reads positive when it holds what its name
// says it holds, and a debit-side account (money owed to us) reads positive the same way, so a
// reader never has to remember which way round an account is. The sign is kept rather than made
// absolute: a clearing account that went the wrong way is a real problem and must show as one.
async function clearingBalances(database: postgres.Sql) {
  const rows = await database<{ account_id: string; side: string; balance_cents: string; last_moved_on: string | null }[]>`
    select account.id as account_id,
           account.side,
           coalesce(
             case when account.side = 'credit'
                  then sum(line.credit_cents) - sum(line.debit_cents)
                  else sum(line.debit_cents) - sum(line.credit_cents)
             end, 0)::text as balance_cents,
           to_char(max(entry.effective_at), 'YYYY-MM-DD') as last_moved_on
      from accounts account
      left join journal_lines line on line.account_id = account.id
      left join journal_entries entry on entry.id = line.entry_id
     where account.id in ${database(CLEARING_ACCOUNTS.map((account) => account.id))}
     group by account.id, account.side
     order by account.id
  `;
  return CLEARING_ACCOUNTS.map((account) => {
    const row = rows.find((candidate) => candidate.account_id === account.id);
    const balanceCents = row ? centsFromDatabase(row.balance_cents, "balance_cents") : 0;
    return {
      account: account.id,
      meaning: account.meaning,
      // Positive means the account holds what its name says it holds; zero means every flow
      // that used it has completed.
      openBalance: usd(balanceCents),
      isZero: balanceCents === 0,
      lastMovedOn: row?.last_moved_on ?? null,
    };
  });
}
