import Link from "next/link";
import { Chip } from "@/components/detail-layout";
import { About } from "@/components/ui/about";
import { Chart, ChartRow, HBars, Sparkline, StackedBars, Swatch } from "@/components/ui/charts";
import { EmptyState } from "@/components/ui/empty";
import { Legend } from "@/components/ui/legend";
import { Stat, Stats } from "@/components/ui/stat";
import { DataTable, ExpandHead, ExpandRow, EntryLines, FactGrid, MoreRows, Num, Primary, Ref, Row, Chevron } from "@/components/ui/table";
import { When } from "@/components/ui/time";
import { FilterChip, Toolbar, ToolbarCount, ToolbarGroup, ToolbarSpacer } from "@/components/ui/toolbar";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { intoWeeks, type AccountLedger, type AppendOnlyProof, type DailyFlow, type EntriesPage, type JournalEntryRow, type TrialBalance } from "@/lib/ledger/read";
import { inspectHref, withParams, type Query } from "@/lib/ui/views";

// The four views of /ops/console/ledger, as presentation only. Every figure arrives already read
// and already in cents from lib/ledger/read.ts; nothing here queries and nothing here computes an
// amount beyond adding up the window the page asked for. Money is printed by formatCentsAsUsd and
// by nothing else.
//
// They live beside the route rather than inside it so that the page file stays the short list of
// "who is signed in, what does the URL ask for, which reads answer it".

export const LEDGER_PATH = "/ops/console/ledger";

// A reversal and a correction are the two entry types that undo something, so they are the two a
// reader must not mistake for an ordinary posting.
function entryTypeTone(entryType: string): "warn" | "neutral" {
  return entryType.startsWith("reversal_") || entryType.startsWith("correction_") ? "warn" : "neutral";
}

// "premium_collected" reads as "premium collected": the stored value, spaced, never translated.
function entryTypeLabel(entryType: string): string {
  return entryType.replace(/_/g, " ");
}

// A description is stored text, and a few of them are three lines long (the reversal entries
// carry the reason they were posted). A table cell holds no sentence, so the cell shows the head
// of it and the expansion holds the whole thing.
const MOST_DESCRIPTION_CHARACTERS = 52;
function shortDescription(text: string): string {
  return text.length <= MOST_DESCRIPTION_CHARACTERS ? text : `${text.slice(0, MOST_DESCRIPTION_CHARACTERS).trimEnd()}...`;
}

// The lines of an entry, in the shape components/ui/table.tsx draws them.
function linesOf(entry: JournalEntryRow) {
  return entry.lines.map((line) => ({
    account: line.accountName,
    debit: line.debitCents > 0 ? formatCentsAsUsd(line.debitCents) : "",
    credit: line.creditCents > 0 ? formatCentsAsUsd(line.creditCents) : "",
    isCredit: line.creditCents > 0,
  }));
}

// The facts of an entry that do not fit its row: what it is filed under, and what it undoes.
function factsOf(entry: JournalEntryRow, inspect?: string) {
  return [
    {
      label: "Entry",
      value: <Ref value={entry.entryId} inspectHref={inspect} title="Open the trail of this entry" />,
    },
    { label: "Description", value: entry.description },
    {
      label: "Source",
      value: `${entry.sourceKind.replace(/_/g, " ")} ${entry.sourceId.slice(0, 8)}`,
    },
    {
      label: "Policy",
      value: entry.policyId ? entry.policyId.slice(0, 8) : "none",
    },
    {
      label: "Claim",
      value: entry.claimId ? entry.claimId.slice(0, 8) : "none",
    },
    {
      label: "Broker",
      value: entry.brokerId ? entry.brokerId.slice(0, 8) : "none",
    },
    {
      label: "Reverses",
      value: entry.reversesEntryId ? entry.reversesEntryId.slice(0, 8) : "nothing",
    },
  ];
}

// ---------------------------------------------------------------------------
// balances: the trial balance
// ---------------------------------------------------------------------------

export function BalancesView({ balance, proof, query }: { balance: TrialBalance; proof: AppendOnlyProof; query: Query }) {
  const moving = balance.accounts.filter((account) => account.balanceCents !== 0);
  const bars = moving.map((account) => ({
    label: account.name,
    value: Math.abs(account.balanceCents),
    display: formatCentsAsUsd(account.balanceCents),
    color: account.side === "debit" ? "var(--chart-1)" : "var(--chart-2)",
  }));

  return (
    <>
      <Stats>
        {/* These two count the WHOLE journal even when a date is set, and say so: they are the
            append-only proof, not a figure of the window. */}
        <Stat label="Entries" value={proof.entryCount} note={balance.asOfDate ? "whole journal, not the date" : "every posting ever made"} />
        <Stat label="Lines" value={proof.lineCount} note={balance.asOfDate ? "whole journal, not the date" : "two or more per entry"} />
        <Stat label="Total debits" value={formatCentsAsUsd(balance.totalDebitCents)} note={balance.asOfDate ? `on ${balance.asOfDate}` : "whole journal"} />
        <Stat
          label="Total credits"
          value={formatCentsAsUsd(balance.totalCreditCents)}
          tone={balance.totalDebitCents === balance.totalCreditCents ? "ok" : "danger"}
          note={balance.totalDebitCents === balance.totalCreditCents ? "equal to the debits" : "NOT equal to the debits"}
        />
      </Stats>

      {/* `ledger-screen` scopes the one HBars rule this builder had to park in
          app/styles/landing.css; the comment there says why and when it goes away. */}
      <div className="ledger-screen">
        <ChartRow>
          <Chart
            title="Balances not at zero"
            figure={`${moving.length} accounts`}
            legend={
              <>
                <Swatch color="var(--chart-1)">debit side</Swatch>
                <Swatch color="var(--chart-2)">credit side</Swatch>
              </>
            }
          >
            <HBars rows={bars} caption="Balance of each account, signed by its own side" format={(value) => formatCentsAsUsd(value)} />
          </Chart>
        </ChartRow>
      </div>

      <DataTable
        ariaLabel="Trial balance"
        toolbar={
          <Toolbar>
            <ToolbarGroup label="As of">
              <FilterChip href={withParams(LEDGER_PATH, query, { asOf: null })} active={balance.asOfDate === null}>
                Whole journal
              </FilterChip>
            </ToolbarGroup>
            <form method="get" action={LEDGER_PATH}>
              <input type="hidden" name="view" value="balances" />
              <input type="date" name="asOf" defaultValue={balance.asOfDate ?? ""} aria-label="Balances as of this business date" />
              <button type="submit" className="secondary">
                Apply
              </button>
            </form>
            <ToolbarSpacer />
            <ToolbarCount>{balance.accounts.length} accounts</ToolbarCount>
          </Toolbar>
        }
        legend={
          <Legend
            items={[
              {
                term: "Debit side",
                meaning: "balance is debits minus credits",
              },
              {
                term: "Credit side",
                meaning: "balance is credits minus debits",
              },
              {
                term: "As of",
                meaning: "keeps the entries whose business date is on or before it",
              },
            ]}
          />
        }
      >
        <thead>
          <tr>
            <th>Account</th>
            <th>Side</th>
            <th className="num">Debit</th>
            <th className="num">Credit</th>
            <th className="num">Balance</th>
            <th aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {balance.accounts.map((account) => {
            const href = withParams(LEDGER_PATH, query, {
              view: "account",
              account: account.accountId,
              inspect: null,
            });
            return (
              <Row key={account.accountId} href={href}>
                <Primary href={href} sub={account.accountId}>
                  {account.name}
                </Primary>
                <td>
                  <Chip tone="neutral">{account.side}</Chip>
                </td>
                <Num>{formatCentsAsUsd(account.debitCents)}</Num>
                <Num>{formatCentsAsUsd(account.creditCents)}</Num>
                <Num>{formatCentsAsUsd(account.balanceCents)}</Num>
                <Chevron />
              </Row>
            );
          })}
        </tbody>
      </DataTable>

      <About>
        <h4>The sign of a balance</h4>
        <p>Each account has a side, the side that increases it. A debit account answers debits minus credits. A credit account answers credits minus debits.</p>
        <h4>One example</h4>
        <p>
          Cash held at Stripe is a debit account. With $9,581.81 of debits and $6,575.85 of credits its balance is $3,005.96, the money still held at the
          provider.
        </p>
        <h4>Why the two totals must match</h4>
        <p>
          Every entry posts equal debits and credits, checked by a deferred trigger at commit. The two totals above are therefore equal, or the ledger is
          broken.
        </p>
        <h4>As of a date</h4>
        <p>The date filters the business date, not the booking time. An entry recorded today for a past date is inside a window that covers that past date.</p>
        <h4>The two counts</h4>
        <p>Entries and lines count the whole journal, whatever date is set. The two totals and the table below them follow the date.</p>
        <h4>Accounts at zero</h4>
        <p>The table lists the whole chart of accounts. The chart above lists only the accounts whose balance is not zero.</p>
      </About>
    </>
  );
}

// ---------------------------------------------------------------------------
// account: one account, its entries and its running balance
// ---------------------------------------------------------------------------

export function AccountView({
  ledger,
  account,
  query,
  now,
  inspected,
}: {
  ledger: AccountLedger;
  account: TrialBalance["accounts"][number];
  query: Query;
  now: Date;
  inspected: string | null;
}) {
  // Oldest first, which is the direction a balance is read in.
  const trend = ledger.rows.map((row) => row.runningBalanceCents).reverse();

  return (
    <>
      <Stats>
        <Stat label="Balance" value={formatCentsAsUsd(account.balanceCents)} tone="accent" note={`${account.side} side, whole journal`} />
        <Stat label="Entries shown" value={ledger.rows.length} note={ledger.capped ? "the newest of a longer list" : "every entry of this account"} />
        <Stat label="Debits" value={formatCentsAsUsd(account.debitCents)} note="whole journal" />
        <Stat label="Credits" value={formatCentsAsUsd(account.creditCents)} note="whole journal" />
      </Stats>

      {trend.length > 1 ? (
        <ChartRow>
          <Chart title="Running balance of the window" figure={formatCentsAsUsd(trend[trend.length - 1])}>
            <Sparkline points={trend} width={640} height={72} caption={`Running balance of ${account.name} across the entries shown, oldest first`} />
          </Chart>
        </ChartRow>
      ) : null}

      <DataTable
        ariaLabel={`Entries of ${account.name}`}
        toolbar={
          <Toolbar>
            <ToolbarGroup label="Account">
              <FilterChip
                href={withParams(LEDGER_PATH, query, {
                  view: "balances",
                  account: null,
                  inspect: null,
                })}
                active={false}
              >
                All accounts
              </FilterChip>
              <FilterChip
                href={withParams(LEDGER_PATH, query, {
                  view: "entries",
                  type: null,
                  account: null,
                  inspect: null,
                })}
                active={false}
              >
                Whole journal
              </FilterChip>
            </ToolbarGroup>
            <ToolbarSpacer />
            <ToolbarCount>
              {ledger.rows.length} entries shown
              {ledger.capped ? ", newest first" : ""}
            </ToolbarCount>
          </Toolbar>
        }
        legend={
          <Legend
            items={[
              {
                term: "Running balance",
                meaning: "counted from the oldest entry shown, not from the account's opening balance",
              },
              {
                term: "Effective",
                meaning: "the business date the entry belongs to",
              },
              {
                term: "Recorded",
                meaning: "the booking time, printed under the business date",
              },
            ]}
          />
        }
        footer={ledger.capped ? <div className="dt-more">Bounded to the newest entries of this account.</div> : undefined}
      >
        <thead>
          <tr>
            <ExpandHead />
            <th className="nowrap">Effective</th>
            <th>Type</th>
            <th>Description</th>
            <th className="num">Debit</th>
            <th className="num">Credit</th>
            <th className="num">Running balance</th>
          </tr>
        </thead>
        {ledger.rows.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={7} className="dt-empty">
                <EmptyState illustration="open-ledger">No entry has ever touched this account.</EmptyState>
              </td>
            </tr>
          </tbody>
        ) : (
          ledger.rows.map((row) => {
            // The lines of this entry on THIS account only: the row's own debit and credit.
            const onAccount = row.lines.filter((line) => line.accountId === ledger.accountId);
            const debitCents = onAccount.reduce((total, line) => total + line.debitCents, 0);
            const creditCents = onAccount.reduce((total, line) => total + line.creditCents, 0);
            return (
              <ExpandRow
                key={row.entryId}
                columns={6}
                selected={inspected === row.entryId}
                cells={
                  <>
                    <td className="nowrap">
                      {row.effectiveAt}
                      <span className="dt-sub">
                        <When instant={row.recordedAt} now={now} />
                      </span>
                    </td>
                    <td>
                      <Chip tone={entryTypeTone(row.entryType)}>{entryTypeLabel(row.entryType)}</Chip>
                    </td>
                    <td title={row.description}>{shortDescription(row.description)}</td>
                    <Num>{debitCents > 0 ? formatCentsAsUsd(debitCents) : ""}</Num>
                    <Num>{creditCents > 0 ? formatCentsAsUsd(creditCents) : ""}</Num>
                    <Num>{formatCentsAsUsd(row.runningBalanceCents)}</Num>
                  </>
                }
              >
                <FactGrid items={factsOf(row, inspectHref(LEDGER_PATH, query, row.entryId))} />
                <EntryLines lines={linesOf(row)} />
              </ExpandRow>
            );
          })
        )}
      </DataTable>

      <About>
        <h4>Running balance</h4>
        <p>
          It is the balance of the window shown, counted from the oldest entry on the page. It is not the balance of the account when that entry was posted.
        </p>
        <h4>The account balance</h4>
        <p>The balance tile above is the whole journal, from the trial balance. It is the figure to quote, not the last line of the table.</p>
        <h4>Debit and credit columns</h4>
        <p>They are this entry&apos;s lines on this account only. Open a row to see the other side of the same entry.</p>
        <h4>The entry id</h4>
        <p>Open a row and click the entry id to open the inspector on the policy or the claim it belongs to.</p>
      </About>
    </>
  );
}

// ---------------------------------------------------------------------------
// entries: the journal itself
// ---------------------------------------------------------------------------

export function EntriesView({
  page,
  types,
  query,
  now,
  selectedType,
  showingAll,
}: {
  page: EntriesPage;
  types: { entryType: string; count: number }[];
  query: Query;
  now: Date;
  selectedType: string | null;
  showingAll: boolean;
}) {
  const policyFilter = typeof query.policy === "string" ? query.policy : null;
  const claimFilter = typeof query.claim === "string" ? query.claim : null;

  return (
    <>
      <Stats>
        <Stat label="Entries" value={page.totalMatching} note={selectedType ? `type ${entryTypeLabel(selectedType)}` : "every type"} />
        <Stat label="Shown" value={page.rows.length} note={page.capped ? "bounded, newest first" : "all of them"} />
        <Stat label="Types" value={types.length} note="distinct entry types posted" />
        <Stat label="Top date" value={page.rows[0] ? page.rows[0].effectiveAt : "none"} note="business date of the first row" />
      </Stats>

      <DataTable
        ariaLabel="Journal entries"
        toolbar={
          <Toolbar>
            <ToolbarGroup label="Type">
              <FilterChip
                href={withParams(LEDGER_PATH, query, {
                  type: null,
                  all: null,
                  inspect: null,
                })}
                active={selectedType === null}
                count={types.reduce((total, one) => total + one.count, 0)}
              >
                All
              </FilterChip>
              {types.map((one) => (
                <FilterChip
                  key={one.entryType}
                  href={withParams(LEDGER_PATH, query, {
                    type: one.entryType,
                    all: null,
                    inspect: null,
                  })}
                  active={selectedType === one.entryType}
                  count={one.count}
                >
                  {entryTypeLabel(one.entryType)}
                </FilterChip>
              ))}
            </ToolbarGroup>
            {policyFilter || claimFilter ? (
              <ToolbarGroup label="Filed under">
                <FilterChip
                  href={withParams(LEDGER_PATH, query, {
                    policy: null,
                    claim: null,
                    all: null,
                    inspect: null,
                  })}
                  active={false}
                >
                  Clear {policyFilter ? "policy" : "claim"} {(policyFilter ?? claimFilter ?? "").slice(0, 8)}
                </FilterChip>
              </ToolbarGroup>
            ) : null}
            <ToolbarSpacer />
            <ToolbarCount>
              {page.rows.length} of {page.totalMatching}
            </ToolbarCount>
          </Toolbar>
        }
        legend={
          <Legend
            items={[
              {
                term: "Total",
                meaning: "the debits of the entry, equal to its credits",
              },
              {
                term: "Effective",
                meaning: "the business date, with the booking time under it",
              },
              {
                term: "Filed under",
                meaning: "the policy or the claim the entry belongs to",
              },
              {
                term: "reversal",
                meaning: "an entry that undoes another one, never a deletion",
              },
            ]}
          />
        }
        footer={
          <MoreRows
            shown={page.rows.length}
            total={page.totalMatching}
            href={withParams(LEDGER_PATH, query, { all: "1", inspect: null })}
            label={showingAll ? "Still bounded, narrow with a type" : "Show more"}
          />
        }
      >
        <thead>
          <tr>
            <ExpandHead />
            <th className="nowrap">Effective</th>
            <th>Type</th>
            <th>Description</th>
            <th className="num">Total</th>
            <th>Filed under</th>
          </tr>
        </thead>
        {page.rows.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={6} className="dt-empty">
                <EmptyState illustration="open-ledger">No entry matches this filter.</EmptyState>
              </td>
            </tr>
          </tbody>
        ) : (
          page.rows.map((row) => (
            <ExpandRow
              key={row.entryId}
              columns={5}
              cells={
                <>
                  <td className="nowrap">
                    {row.effectiveAt}
                    <span className="dt-sub">
                      <When instant={row.recordedAt} now={now} />
                    </span>
                  </td>
                  <td>
                    <Chip tone={entryTypeTone(row.entryType)}>{entryTypeLabel(row.entryType)}</Chip>
                  </td>
                  <td title={row.description}>{shortDescription(row.description)}</td>
                  <Num>{formatCentsAsUsd(row.totalDebitCents)}</Num>
                  <td className="nowrap">
                    {row.claimId ? (
                      <Link
                        href={withParams(LEDGER_PATH, query, {
                          claim: row.claimId,
                          policy: null,
                          all: null,
                          inspect: null,
                        })}
                        prefetch={false}
                        className="ref"
                      >
                        claim {row.claimId.slice(0, 8)}
                      </Link>
                    ) : row.policyId ? (
                      <Link
                        href={withParams(LEDGER_PATH, query, {
                          policy: row.policyId,
                          claim: null,
                          all: null,
                          inspect: null,
                        })}
                        prefetch={false}
                        className="ref"
                      >
                        policy {row.policyId.slice(0, 8)}
                      </Link>
                    ) : (
                      <span className="dt-muted">none</span>
                    )}
                  </td>
                </>
              }
            >
              <FactGrid items={factsOf(row)} />
              <EntryLines lines={linesOf(row)} />
            </ExpandRow>
          ))
        )}
      </DataTable>

      <About>
        <h4>What a row is</h4>
        <p>One journal entry: a header and the lines under it. Open a row to read its lines, its source and what it reverses.</p>
        <h4>Total</h4>
        <p>The debits of the entry. Its credits are the same figure, which is what balancing means.</p>
        <h4>Policy and claim filters</h4>
        <p>They are reached from the last column, never typed. A policy number cannot be filtered here because the journal stores identifiers.</p>
        <h4>The bound</h4>
        <p>The table reads the newest hundred entries. Show more raises it to five hundred. Narrow by type for a shorter answer.</p>
      </About>
    </>
  );
}

// ---------------------------------------------------------------------------
// flows: money in, money out, commission and reserves, day by day
// ---------------------------------------------------------------------------

const FLOW_COLORS = {
  collected: "var(--chart-1)",
  refunded: "var(--chart-2)",
  commission: "var(--chart-3)",
  reserves: "var(--chart-4)",
};

export function FlowsView({ flows, days, query }: { flows: DailyFlow[]; days: number; query: Query }) {
  const collected = flows.reduce((total, day) => total + day.collectedCents, 0);
  const refunded = flows.reduce((total, day) => total + day.refundedCents, 0);
  const commission = flows.reduce((total, day) => total + day.commissionCents, 0);
  const reserves = flows.reduce((total, day) => total + day.reservesCents, 0);
  // The chart draws every day of the window, gaps included, because a gap is information. The
  // table lists only the days something happened: thirty rows of zero are not a reading.
  const moved = flows.filter((day) => day.collectedCents + day.refundedCents + day.commissionCents + day.reservesCents > 0);
  // Past thirty days the bars are narrower than their own labels, so the columns become weeks
  // (lib/ledger/read.ts, intoWeeks). No figure changes: a week is the sum of its days.
  const byWeek = days > 30;
  const columns = byWeek ? intoWeeks(flows) : flows;
  const columnLabel = byWeek ? "week" : "day";

  return (
    <>
      <Stats>
        <Stat label="Collected" value={formatCentsAsUsd(collected)} tone="accent" note="debits into cash at Stripe" />
        <Stat label="Refunded" value={formatCentsAsUsd(refunded)} note="credits out of cash at Stripe" />
        <Stat label="Commission" value={formatCentsAsUsd(commission)} note="debits of commission expense" />
        <Stat label="Reserves" value={formatCentsAsUsd(reserves)} note="credits of claim reserve" />
      </Stats>

      {/* `ledger-screen`: the two parked rules in app/styles/landing.css, one of which keeps this
          chart's hidden data table from stretching the page. */}
      <div className="ledger-screen">
        <ChartRow>
          <Chart
            title={`Flows over ${days} days, by ${columnLabel}`}
            figure={formatCentsAsUsd(collected)}
            legend={
              <>
                <Swatch color={FLOW_COLORS.collected}>collected</Swatch>
                <Swatch color={FLOW_COLORS.refunded}>refunded</Swatch>
                <Swatch color={FLOW_COLORS.commission}>commission</Swatch>
                <Swatch color={FLOW_COLORS.reserves}>reserves</Swatch>
              </>
            }
          >
            <StackedBars
              labels={columns.map((column) => column.day.slice(5))}
              series={[
                {
                  name: "collected",
                  values: columns.map((column) => column.collectedCents),
                  color: FLOW_COLORS.collected,
                },
                {
                  name: "refunded",
                  values: columns.map((column) => column.refundedCents),
                  color: FLOW_COLORS.refunded,
                },
                {
                  name: "commission",
                  values: columns.map((column) => column.commissionCents),
                  color: FLOW_COLORS.commission,
                },
                {
                  name: "reserves",
                  values: columns.map((column) => column.reservesCents),
                  color: FLOW_COLORS.reserves,
                },
              ]}
              height={180}
              format={(value) => formatCentsAsUsd(value)}
              caption={`Collected, refunded, commission and reserves per ${columnLabel} over ${days} days`}
            />
          </Chart>
        </ChartRow>
      </div>

      <DataTable
        ariaLabel="Flows per day"
        toolbar={
          <Toolbar>
            <ToolbarGroup label="Window">
              {[7, 30, 90].map((one) => (
                <FilterChip
                  key={one}
                  href={withParams(LEDGER_PATH, query, {
                    days: String(one),
                    inspect: null,
                  })}
                  active={days === one}
                >
                  {one} days
                </FilterChip>
              ))}
            </ToolbarGroup>
            <ToolbarSpacer />
            <ToolbarCount>
              {moved.length} of {flows.length} days moved
            </ToolbarCount>
          </Toolbar>
        }
        legend={
          <Legend
            items={[
              {
                term: "Collected",
                meaning: "money that arrived at Stripe that day",
              },
              { term: "Refunded", meaning: "money that left Stripe that day" },
              {
                term: "Reserves",
                meaning: "an estimate opened on a claim, not money moved",
              },
              {
                term: "Rows",
                meaning: "only the days something moved; the chart draws the whole window",
              },
            ]}
          />
        }
      >
        <thead>
          <tr>
            <th className="nowrap">Day</th>
            <th className="num">Collected</th>
            <th className="num">Refunded</th>
            <th className="num">Commission</th>
            <th className="num">Reserves</th>
          </tr>
        </thead>
        <tbody>
          {moved.length === 0 ? (
            <tr>
              <td colSpan={5} className="dt-empty">
                <EmptyState illustration="all-clear">Nothing moved in this window.</EmptyState>
              </td>
            </tr>
          ) : (
            moved.map((day) => (
              <Row key={day.day}>
                <td className="nowrap">{day.day}</td>
                <Num>{formatCentsAsUsd(day.collectedCents)}</Num>
                <Num>{formatCentsAsUsd(day.refundedCents)}</Num>
                <Num>{formatCentsAsUsd(day.commissionCents)}</Num>
                <Num>{formatCentsAsUsd(day.reservesCents)}</Num>
              </Row>
            ))
          )}
        </tbody>
      </DataTable>

      <About>
        <h4>Which date</h4>
        <p>The business date of the entry, not its booking time. A day of flows is a day of business.</p>
        <h4>Future dates</h4>
        <p>A forward dated policy event is effective after today, so it sits outside a window that ends today and is not counted here.</p>
        <h4>Reserves</h4>
        <p>A reserve is an estimate on an open claim. It is drawn beside the cash flows for context, and it is not cash.</p>
        <h4>Where the figures come from</h4>
        <p>Four sums of journal lines: debits and credits of cash at Stripe, debits of commission expense, credits of claim reserve.</p>
        <h4>The table and the chart</h4>
        <p>The chart draws the whole window, by day up to thirty days and by week beyond. The table lists only the days something moved.</p>
      </About>
    </>
  );
}
