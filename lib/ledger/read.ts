import type postgres from "postgres";
import { centsFromDatabase } from "@/lib/money/cents";

// What the ledger screen reads. SELECT statements only: this file never writes, and it must
// never write, because the journal is append-only (AF-03). It is the read side of the tables
// migration 0001 created, asked the five questions an operator asks of a set of books:
//
//   trialBalance     one line per account, debits, credits and the balance on the account's side
//   accountLedger    the entries that touched one account, newest first, with a running balance
//   entries          the journal itself, filtered by type, policy, claim, broker or date
//   dailyFlows       money in, money out, commission and reserves, day by day
//   appendOnlyProof  the count of entries and lines and the two totals that must be equal
//
// Every read is bounded: the trial balance by the fifteen rows of the chart of accounts, the two
// entry readers by an explicit `limit`, the flows by a window of days, the proof by four
// aggregates. Money arrives from Postgres as text (bigint) and goes through centsFromDatabase,
// the same conversion lib/reconciliation/read.ts and lib/policy/read.ts use, so no amount ever
// touches a floating point number.
//
// The pure parts are exported and proven in lib/ledger/read.test.ts without a database: signing a
// balance, running a balance down a window, cutting a window into days, and deciding which flow a
// line belongs to. The SQL around them is the part a database has to answer.

// ---------------------------------------------------------------------------
// The pure rules
// ---------------------------------------------------------------------------

export type AccountSide = "debit" | "credit";

// The balance of an account, signed by the side that INCREASES it.
//
// Numeric example, cash_stripe (a debit account): three collections of $1,253.20, $1,125.61 and
// $1,203.00 give 958181 cents of debit; two refunds give 657585 cents of credit. The balance is
// 958181 - 657585 = 300596, that is $3,005.96 still held at Stripe. The same figures on a CREDIT
// account (unearned_premium) would answer -300596: money owed back, not money held.
export function signedBalanceCents(side: AccountSide, debitCents: number, creditCents: number): number {
  return side === "debit" ? debitCents - creditCents : creditCents - debitCents;
}

// The running balance of a WINDOW of entries, from the oldest one shown to the newest.
//
// The input is the per-entry movement on one account, newest first, which is the order the screen
// prints. The output is the balance after each of them, in that same order, accumulated from the
// END of the array (the oldest row) towards the start (the newest row).
//
// IT IS THE RUNNING BALANCE OF THE SHOWN WINDOW, NOT OF THE ACCOUNT. When the read is bounded at
// 50 entries and the account has 300, the oldest row shown starts from its own movement and not
// from the balance the account had that day. The screen says so under the column, and the true
// balance of the account is the one the trial balance prints.
//
// Numeric example: movements newest first [+1000, -400, +2500] (the oldest is +2500). The
// running balances are [3100, 2100, 2500]: the oldest row stands at 2500, the middle at 2100,
// the newest at 3100.
export function runningBalances(movementsNewestFirst: number[]): number[] {
  const balances: number[] = new Array(movementsNewestFirst.length);
  let total = 0;
  for (let index = movementsNewestFirst.length - 1; index >= 0; index -= 1) {
    total += movementsNewestFirst[index];
    balances[index] = total;
  }
  return balances;
}

// The days a flows window covers, oldest first, as "YYYY-MM-DD". `days` counts the last day in:
// dayWindow(7, "2026-09-09") ends on 2026-09-09 and starts on 2026-09-03.
export function dayWindow(days: number, today: string): string[] {
  const end = new Date(`${today}T00:00:00Z`);
  const buckets: string[] = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    const day = new Date(end.getTime() - back * 24 * 60 * 60 * 1000);
    buckets.push(day.toISOString().slice(0, 10));
  }
  return buckets;
}

// The four flows a day of this ledger is read by, and the line that belongs to each.
//
//   collected   a DEBIT of cash_stripe: money arrived at Stripe
//   refunded    a CREDIT of cash_stripe: money left Stripe
//   commission  a DEBIT of commission_expense: commission earned by a broker that day
//   reserves    a CREDIT of claim_reserve: a case reserve opened that day
//
// Everything else answers null: it is a real journal line, it is simply not one of these four.
// Numeric example: a line {cash_stripe, debit 125320} is "collected" for 125320 cents; the
// {premium_receivable, credit 125320} facing it is null, because the money side is the cash side.
export type FlowKind = "collected" | "refunded" | "commission" | "reserves";

export function flowOfLine(accountId: string, debitCents: number, creditCents: number): { kind: FlowKind; amountCents: number } | null {
  if (accountId === "cash_stripe" && debitCents > 0) return { kind: "collected", amountCents: debitCents };
  if (accountId === "cash_stripe" && creditCents > 0) return { kind: "refunded", amountCents: creditCents };
  if (accountId === "commission_expense" && debitCents > 0) return { kind: "commission", amountCents: debitCents };
  if (accountId === "claim_reserve" && creditCents > 0) return { kind: "reserves", amountCents: creditCents };
  return null;
}

// ---------------------------------------------------------------------------
// The trial balance
// ---------------------------------------------------------------------------

export type TrialBalanceAccount = {
  accountId: string;
  name: string;
  side: AccountSide;
  debitCents: number;
  creditCents: number;
  balanceCents: number; // signed by the account's side, see signedBalanceCents
};

export type TrialBalance = {
  accounts: TrialBalanceAccount[];
  totalDebitCents: number;
  totalCreditCents: number;
  asOfDate: string | null; // the date the caller asked for, or null for the whole journal
};

// One row per account of the chart of accounts, whether it was ever used or not: an account with
// no line prints zero rather than disappearing, which is how a reader sees that nothing was ever
// booked to it. `asOfDate` keeps only the entries whose BUSINESS date is on or before it, so the
// screen answers "what did the books say on that day", not "what has been recorded since".
//
// Numeric example on the trial database of 2026-09-09: cash_stripe totals 958181 debit and 657585
// credit, so its balance is 300596 ($3,005.96); the totals of every account are 4262730 on both
// sides, which is the equality AF-03 is about.
export async function trialBalance(database: postgres.Sql, asOfDate?: string): Promise<TrialBalance> {
  const asOf = asOfDate ?? null;
  const rows = await database<{ id: string; name: string; side: AccountSide; debit_cents: string; credit_cents: string }[]>`
    select account.id, account.name, account.side,
           coalesce(movement.debit_cents, 0)::text as debit_cents,
           coalesce(movement.credit_cents, 0)::text as credit_cents
      from accounts account
      -- The sums are made in a subquery, and the entries are joined INSIDE it, so an entry the
      -- as-of date excludes takes its lines out of the sum instead of leaving them behind.
      left join (
        select line.account_id,
               sum(line.debit_cents) as debit_cents,
               sum(line.credit_cents) as credit_cents
          from journal_lines line
          join journal_entries entry on entry.id = line.entry_id
         where ${asOf}::date is null or entry.effective_at <= ${asOf}::date
         group by line.account_id
      ) movement on movement.account_id = account.id
     order by account.side, account.id
  `;

  const accounts = rows.map((row) => {
    const debitCents = centsFromDatabase(row.debit_cents, "debit_cents");
    const creditCents = centsFromDatabase(row.credit_cents, "credit_cents");
    return {
      accountId: row.id,
      name: row.name,
      side: row.side,
      debitCents,
      creditCents,
      balanceCents: signedBalanceCents(row.side, debitCents, creditCents),
    };
  });

  return {
    accounts,
    totalDebitCents: accounts.reduce((total, account) => total + account.debitCents, 0),
    totalCreditCents: accounts.reduce((total, account) => total + account.creditCents, 0),
    asOfDate: asOf,
  };
}

// ---------------------------------------------------------------------------
// Entries and their lines
// ---------------------------------------------------------------------------

export type JournalLineRow = {
  accountId: string;
  accountName: string;
  debitCents: number;
  creditCents: number;
};

export type JournalEntryRow = {
  entryId: string;
  entryType: string;
  effectiveAt: string; // business date, "YYYY-MM-DD"
  recordedAt: Date; // booking time, set by the database clock
  description: string;
  policyId: string | null;
  claimId: string | null;
  brokerId: string | null;
  sourceKind: string;
  sourceId: string;
  reversesEntryId: string | null;
  lines: JournalLineRow[];
  totalDebitCents: number; // the size of the entry; equal to its total credits by construction
};

type EntryHeaderShape = {
  id: string;
  entry_type: string;
  effective_at: string;
  recorded_at: Date;
  description: string;
  policy_id: string | null;
  claim_id: string | null;
  broker_id: string | null;
  source_kind: string;
  source_id: string;
  reverses_entry_id: string | null;
};

// The lines of a bounded set of entries, read in one query and handed back grouped by entry.
// Debit lines come before credit lines so an entry reads the way it is written.
async function linesOfEntries(database: postgres.Sql, entryIds: string[]): Promise<Map<string, JournalLineRow[]>> {
  const byEntry = new Map<string, JournalLineRow[]>();
  if (entryIds.length === 0) return byEntry;

  const rows = await database<{ entry_id: string; account_id: string; account_name: string; debit_cents: string; credit_cents: string }[]>`
    select line.entry_id, line.account_id, account.name as account_name,
           line.debit_cents::text as debit_cents, line.credit_cents::text as credit_cents
      from journal_lines line
      join accounts account on account.id = line.account_id
     where line.entry_id in ${database(entryIds)}
     order by line.entry_id, (line.credit_cents > 0), line.id
  `;

  for (const row of rows) {
    const list = byEntry.get(row.entry_id) ?? [];
    list.push({
      accountId: row.account_id,
      accountName: row.account_name,
      debitCents: centsFromDatabase(row.debit_cents, "debit_cents"),
      creditCents: centsFromDatabase(row.credit_cents, "credit_cents"),
    });
    byEntry.set(row.entry_id, list);
  }
  return byEntry;
}

function toEntryRow(header: EntryHeaderShape, lines: JournalLineRow[]): JournalEntryRow {
  return {
    entryId: header.id,
    entryType: header.entry_type,
    effectiveAt: header.effective_at,
    recordedAt: header.recorded_at,
    description: header.description,
    policyId: header.policy_id,
    claimId: header.claim_id,
    brokerId: header.broker_id,
    sourceKind: header.source_kind,
    sourceId: header.source_id,
    reversesEntryId: header.reverses_entry_id,
    lines,
    totalDebitCents: lines.reduce((total, line) => total + line.debitCents, 0),
  };
}

export type AccountLedgerRow = JournalEntryRow & {
  // What this entry did to the account asked for, signed by the account's side.
  movementCents: number;
  // The balance after this entry, counted from the oldest entry SHOWN (see runningBalances).
  runningBalanceCents: number;
};

export type AccountLedger = {
  accountId: string;
  rows: AccountLedgerRow[];
  capped: boolean; // true when the account has more entries than the limit asked for
};

// The entries that touched one account, newest first, each with all of its lines and the running
// balance of the shown window.
//
// Numeric example on cash_stripe with limit 3: the three newest entries move -532265 (a refund),
// +120300 and +112561. Read from the oldest of the three, the running balances printed are
// -299404, 232861 and 120300 top to bottom; the balance of the ACCOUNT is the trial balance's.
export async function accountLedger(database: postgres.Sql, accountId: string, limit: number): Promise<AccountLedger> {
  const [headers, [counted]] = await Promise.all([
    database<EntryHeaderShape[]>`
      select entry.id, entry.entry_type, entry.effective_at::text as effective_at, entry.recorded_at,
             entry.description, entry.policy_id, entry.claim_id, entry.broker_id,
             entry.source_kind, entry.source_id, entry.reverses_entry_id
        from journal_entries entry
       where exists (select 1 from journal_lines line where line.entry_id = entry.id and line.account_id = ${accountId})
       order by entry.effective_at desc, entry.recorded_at desc, entry.id desc
       limit ${limit}
    `,
    database<{ total: number }[]>`
      select count(*)::int as total
        from journal_entries entry
       where exists (select 1 from journal_lines line where line.entry_id = entry.id and line.account_id = ${accountId})
    `,
  ]);

  const [lines, [account]] = await Promise.all([
    linesOfEntries(
      database,
      headers.map((header) => header.id),
    ),
    database<{ side: AccountSide }[]>`select side from accounts where id = ${accountId}`,
  ]);
  // An unknown account has no side and therefore no ledger; the page validates the id before
  // asking, so this is the belt to that pair of braces.
  if (!account) return { accountId, rows: [], capped: false };

  const entries = headers.map((header) => toEntryRow(header, lines.get(header.id) ?? []));
  const movements = entries.map((entry) =>
    entry.lines
      .filter((line) => line.accountId === accountId)
      .reduce((total, line) => total + signedBalanceCents(account.side, line.debitCents, line.creditCents), 0),
  );
  const balances = runningBalances(movements);

  return {
    accountId,
    rows: entries.map((entry, index) => ({ ...entry, movementCents: movements[index], runningBalanceCents: balances[index] })),
    capped: counted.total > headers.length,
  };
}

export type EntryFilters = {
  entryType?: string;
  policyId?: string;
  claimId?: string;
  brokerId?: string;
  since?: string; // business date, keeps entries effective on or after it
  limit: number;
};

export type EntriesPage = {
  rows: JournalEntryRow[];
  totalMatching: number;
  capped: boolean; // totalMatching > rows.length: the screen says so instead of hiding rows
};

// The journal itself, newest first, filtered by what the URL asked for. Every filter is optional
// and every one of them narrows in SQL, so the page never reads the whole journal to draw twenty
// rows. `totalMatching` is counted with the same conditions, so the screen can print the bound it
// applied rather than showing part of a list as if it were all of it.
export async function entries(database: postgres.Sql, filters: EntryFilters): Promise<EntriesPage> {
  const entryType = filters.entryType ?? null;
  const policyId = filters.policyId ?? null;
  const claimId = filters.claimId ?? null;
  const brokerId = filters.brokerId ?? null;
  const since = filters.since ?? null;

  // The same five conditions decide the page and the count. Built by one function called twice,
  // rather than copied, so the number above the table and the rows in it can never answer two
  // different questions. A fragment is built fresh for each query because a postgres.js template
  // is a query object, not a reusable string.
  const matching = () => database`
    (${entryType}::text is null or entry.entry_type = ${entryType})
    and (${policyId}::uuid is null or entry.policy_id = ${policyId}::uuid)
    and (${claimId}::uuid is null or entry.claim_id = ${claimId}::uuid)
    and (${brokerId}::uuid is null or entry.broker_id = ${brokerId}::uuid)
    and (${since}::date is null or entry.effective_at >= ${since}::date)
  `;

  const [headers, [counted]] = await Promise.all([
    database<EntryHeaderShape[]>`
      select entry.id, entry.entry_type, entry.effective_at::text as effective_at, entry.recorded_at,
             entry.description, entry.policy_id, entry.claim_id, entry.broker_id,
             entry.source_kind, entry.source_id, entry.reverses_entry_id
        from journal_entries entry
       where ${matching()}
       order by entry.effective_at desc, entry.recorded_at desc, entry.id desc
       limit ${filters.limit}
    `,
    database<{ total: number }[]>`
      select count(*)::int as total from journal_entries entry where ${matching()}
    `,
  ]);

  const lines = await linesOfEntries(
    database,
    headers.map((header) => header.id),
  );
  return {
    rows: headers.map((header) => toEntryRow(header, lines.get(header.id) ?? [])),
    totalMatching: counted.total,
    capped: counted.total > headers.length,
  };
}

// The distinct entry types present in the journal, for the filter chips. Bounded by the number of
// entry types the application posts, which is a constant of the code.
export async function entryTypesPresent(database: postgres.Sql): Promise<{ entryType: string; count: number }[]> {
  const rows = await database<{ entry_type: string; total: number }[]>`
    select entry_type, count(*)::int as total
      from journal_entries
     group by entry_type
     order by entry_type
  `;
  return rows.map((row) => ({ entryType: row.entry_type, count: row.total }));
}

// ---------------------------------------------------------------------------
// Flows, day by day
// ---------------------------------------------------------------------------

export type DailyFlow = {
  day: string; // "YYYY-MM-DD", the business date
  collectedCents: number; // debits into cash_stripe
  refundedCents: number; // credits out of cash_stripe
  commissionCents: number; // debits of commission_expense
  reservesCents: number; // credits of claim_reserve
};

// Consecutive days grouped seven at a time, oldest first, for a window too long to draw day by
// day. Ninety bars carry ninety labels nobody can read; thirteen weeks carry thirteen.
//
// IT CHANGES NO FIGURE: the four sums of a week are the sums of the days it holds, and the group
// is named by its FIRST day so a reader can find it in the table. The last group holds whatever
// remains when the window is not a multiple of seven.
//
// Numeric example: fourteen days of which only the eighth collected 845457 cents give two groups,
// the first at zero and the second at 845457, named by the days that open them.
const DAYS_IN_A_GROUP = 7;

export function intoWeeks(days: DailyFlow[]): DailyFlow[] {
  const weeks: DailyFlow[] = [];
  for (let start = 0; start < days.length; start += DAYS_IN_A_GROUP) {
    const group = days.slice(start, start + DAYS_IN_A_GROUP);
    weeks.push({
      day: group[0].day,
      collectedCents: group.reduce((total, one) => total + one.collectedCents, 0),
      refundedCents: group.reduce((total, one) => total + one.refundedCents, 0),
      commissionCents: group.reduce((total, one) => total + one.commissionCents, 0),
      reservesCents: group.reduce((total, one) => total + one.reservesCents, 0),
    });
  }
  return weeks;
}

// The last `days` days ending today, one row each, including the days nothing happened: a chart
// with a gap in it is a chart that lies about when the money moved. The classification of a line
// is flowOfLine above, written here as the SQL that groups it.
//
// The date is the BUSINESS date (effective_at), not the booking time, because a day of flows is a
// day of business. An entry effective in the future, which a forward-dated policy event produces,
// is outside a window ending today and is deliberately not counted in it.
//
// Numeric example: on 2026-09-08 the trial database collects 845620 cents, refunds 532265, books
// 138961 of commission and opens 500000 of reserve; the day prints those four figures.
export async function dailyFlows(database: postgres.Sql, days: number): Promise<DailyFlow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const buckets = dayWindow(days, today);
  const from = buckets[0];
  const to = buckets[buckets.length - 1];

  const rows = await database<{ day: string; collected: string; refunded: string; commission: string; reserves: string }[]>`
    select entry.effective_at::text as day,
           coalesce(sum(case when line.account_id = 'cash_stripe' then line.debit_cents else 0 end), 0)::text as collected,
           coalesce(sum(case when line.account_id = 'cash_stripe' then line.credit_cents else 0 end), 0)::text as refunded,
           coalesce(sum(case when line.account_id = 'commission_expense' then line.debit_cents else 0 end), 0)::text as commission,
           coalesce(sum(case when line.account_id = 'claim_reserve' then line.credit_cents else 0 end), 0)::text as reserves
      from journal_lines line
      join journal_entries entry on entry.id = line.entry_id
     where entry.effective_at between ${from}::date and ${to}::date
     group by entry.effective_at
  `;

  const byDay = new Map(rows.map((row) => [row.day, row]));
  return buckets.map((day) => {
    const row = byDay.get(day);
    return {
      day,
      collectedCents: row ? centsFromDatabase(row.collected, "collected") : 0,
      refundedCents: row ? centsFromDatabase(row.refunded, "refunded") : 0,
      commissionCents: row ? centsFromDatabase(row.commission, "commission") : 0,
      reservesCents: row ? centsFromDatabase(row.reserves, "reserves") : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// The append-only proof
// ---------------------------------------------------------------------------

export type AppendOnlyProof = {
  entryCount: number;
  lineCount: number;
  totalDebitCents: number;
  totalCreditCents: number;
  balanced: boolean; // the two totals are equal; the deferred trigger of migration 0001 enforces it
};

// The live AF-03 tile: how much is in the journal, and whether its two sides are equal. A double
// entry ledger whose debits and credits differ is not a ledger at all, so this is the one figure
// the ledger screen shows before anything else.
//
// Numeric example on the trial database of 2026-09-09: 35 entries, 77 lines, 4262730 cents of
// debits and 4262730 cents of credits, so `balanced` is true.
export async function appendOnlyProof(database: postgres.Sql): Promise<AppendOnlyProof> {
  const [row] = await database<{ entry_count: number; line_count: number; debit_cents: string; credit_cents: string }[]>`
    select (select count(*)::int from journal_entries) as entry_count,
           (select count(*)::int from journal_lines) as line_count,
           (select coalesce(sum(debit_cents), 0)::text from journal_lines) as debit_cents,
           (select coalesce(sum(credit_cents), 0)::text from journal_lines) as credit_cents
  `;
  const totalDebitCents = centsFromDatabase(row.debit_cents, "debit_cents");
  const totalCreditCents = centsFromDatabase(row.credit_cents, "credit_cents");
  return {
    entryCount: row.entry_count,
    lineCount: row.line_count,
    totalDebitCents,
    totalCreditCents,
    balanced: totalDebitCents === totalCreditCents,
  };
}
