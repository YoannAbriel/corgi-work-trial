import type postgres from "postgres";
import { centsFromDatabase } from "@/lib/money/cents";

// The second net under the reconciliation screen, and the one the architecture asked for
// (docs/ARCHITECTURE.md section 1: "the reconciliation screen also lists non-zero clearing
// balances with their age"). Review finding F-B10-03.
//
// WHY IT IS NOT THE SAME THING AS THE BREAK LIST
//
// A break is found by comparing a provider's records with ours inside a WINDOW. This list reads
// the journal alone, with no window at all, so it cannot miss anything for being old. If the two
// ever disagree, this one is the stubborn one: it keeps showing an unfinished flow until the
// entries that finish it are posted, whatever any run did or did not compare.
//
// WHAT A CLEARING ACCOUNT IS. Four accounts in this build hold money that is on its way somewhere
// and must end at zero. A non-zero balance on one of them is not an error by itself: it is a flow
// that has not finished. A non-zero balance that is WEEKS OLD is an operations case.
//
//   premium_receivable       billed to a customer and not collected yet
//   refund_payable           a refund we owe a customer and have not paid
//   claims_payable           a claim payment sent on the rail and not settled
//   unapplied_customer_cash  customer money received at Stripe and not applied to a policy
//
// Read with the runtime role, SELECT only, and grouped the way an operator would ask for it: per
// policy and per claim, because that is the thing they would go and look at.

export const CLEARING_ACCOUNTS = [
  "premium_receivable",
  "refund_payable",
  "claims_payable",
  "unapplied_customer_cash",
] as const;

export type ClearingAccount = (typeof CLEARING_ACCOUNTS)[number];

// One line per account, on the screen, so a reader does not have to know the chart of accounts.
export const CLEARING_ACCOUNT_MEANING: Record<ClearingAccount, string> = {
  premium_receivable: "billed to the customer and not collected yet",
  refund_payable: "owed back to the customer and not paid yet",
  claims_payable: "sent on the payout rail and not settled yet",
  unapplied_customer_cash: "received at Stripe and not applied to a policy yet",
};

export type ClearingBalanceRow = {
  accountId: ClearingAccount;
  accountName: string;
  policyId: string | null;
  policyNumber: string | null;
  claimId: string | null;
  claimNumber: string | null;
  // Always positive when something is still open, whichever side of the ledger the account sits
  // on, so the column reads "how much is outstanding" and not "which way does this account go".
  openCents: number;
  // The booking time of the OLDEST entry on this balance. Not "the oldest unmatched entry": a
  // clearing balance is a net, and pairing individual debits against individual credits is not a
  // fact the journal records. For a balance that has not returned to zero, the first entry is
  // when the flow started, which is the age an operator is looking for.
  oldestEntryAt: Date;
};

export async function nonZeroClearingBalances(database: postgres.Sql): Promise<ClearingBalanceRow[]> {
  const rows = await database<ClearingRow[]>`
    select line.account_id,
           account.name as account_name,
           entry.policy_id,
           policy.policy_number,
           entry.claim_id,
           claim.claim_number,
           -- A debit-side account is outstanding when its debits exceed its credits, a
           -- credit-side account the other way round. Reading the side from the chart of accounts
           -- keeps the sign right without this file hard-coding which account is which.
           sum(case when account.side = 'debit'
                    then line.debit_cents - line.credit_cents
                    else line.credit_cents - line.debit_cents end)::text as open_cents,
           min(entry.recorded_at) as oldest_entry_at
      from journal_lines line
      join journal_entries entry on entry.id = line.entry_id
      join accounts account on account.id = line.account_id
      left join policies policy on policy.id = entry.policy_id
      left join claims claim on claim.id = entry.claim_id
     where line.account_id in ${database(CLEARING_ACCOUNTS as unknown as string[])}
     group by line.account_id, account.name, account.side, entry.policy_id, policy.policy_number,
              entry.claim_id, claim.claim_number
    having sum(case when account.side = 'debit'
                    then line.debit_cents - line.credit_cents
                    else line.credit_cents - line.debit_cents end) <> 0
     order by min(entry.recorded_at)
  `;

  return rows.map((row) => ({
    accountId: row.account_id,
    accountName: row.account_name,
    policyId: row.policy_id,
    policyNumber: row.policy_number,
    claimId: row.claim_id,
    claimNumber: row.claim_number,
    openCents: centsFromDatabase(row.open_cents, "open_cents"),
    oldestEntryAt: row.oldest_entry_at,
  }));
}

type ClearingRow = {
  account_id: ClearingAccount;
  account_name: string;
  policy_id: string | null;
  policy_number: string | null;
  claim_id: string | null;
  claim_number: string | null;
  open_cents: string;
  oldest_entry_at: Date;
};
