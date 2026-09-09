import Link from "next/link";
import { Activity, AlertTriangle, BookOpenText, Gauge, ListTree, Scale, Search, ServerCog, TrendingUp } from "lucide-react";
import { Chip } from "@/components/detail-layout";
import { IntegrationModes } from "@/components/console-parts";
import { PortalShell } from "@/components/portal-shell";
import { EmptyState } from "@/components/ui/empty";
import { Inspector } from "@/components/ui/inspector";
import { sql } from "@/db/client";
import { requireStaff } from "@/lib/console/guard";
import {
  accountLedger,
  appendOnlyProof,
  dailyFlows,
  entries,
  entryTypesPresent,
  trialBalance,
  type AccountLedger,
  type DailyFlow,
  type EntriesPage,
  type TrialBalance,
} from "@/lib/ledger/read";
import { closeInspectorHref, firstValue, inspectedReference, pickView, withParams, type Query } from "@/lib/ui/views";
import { AccountView, BalancesView, EntriesView, FlowsView, LEDGER_PATH } from "../ledger-views";

// /ops/console/ledger: the books themselves, beside the console that watches them work.
//
// WHAT IT IS FOR. AF-03 asks for an owned, balanced, append-only double-entry ledger and for every
// displayed balance to be derivable from it. This screen is where that claim is checked by a
// person: the trial balance and its two equal totals, one account and its entries with a running
// balance, the journal with its filters, and the four flows of a day.
//
// READ ONLY, AND STAFF ONLY. requireStaff redirects anyone else before any markup. Every read goes
// through lib/ledger/read.ts, which contains SELECT statements and nothing else, on the runtime
// role that has no UPDATE or DELETE on the journal. There is no form on this page that posts.
//
// ONE VIEW PER REQUEST. The URL names the view; the page reads only what that view prints, so
// opening the balances never reads a hundred entries. Every parameter is validated here against a
// list this file owns, and anything else falls back to the default rather than reaching a reader.

const VIEWS = ["balances", "account", "entries", "flows"] as const;

// The bounds of the two entry readers, written here because they are a property of the SCREEN.
const MOST_ACCOUNT_ENTRIES = 50;
const MOST_ENTRIES = 100;
const MOST_ENTRIES_WITH_ALL = 500;
const FLOW_WINDOWS = [7, 30, 90] as const;
const DEFAULT_FLOW_DAYS = 30;

// "2026-09-08" and a date the calendar actually has. Anything else is treated as absent, so a
// hand-edited URL opens the whole journal instead of reaching the reader with nonsense.
function validDate(raw: string | undefined): string | undefined {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const parsed = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw ? undefined : raw;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validUuid(raw: string | undefined): string | undefined {
  return raw && UUID.test(raw) ? raw : undefined;
}

export default async function LedgerPage({ searchParams }: { searchParams: Promise<Query> }) {
  const user = await requireStaff();
  const query = await searchParams;
  const now = new Date();

  const view = pickView(firstValue(query.view), VIEWS);
  const asOf = validDate(firstValue(query.asOf));
  const wantedAccount = firstValue(query.account);
  const policyId = validUuid(firstValue(query.policy));
  const claimId = validUuid(firstValue(query.claim));
  const showingAll = firstValue(query.all) === "1";
  const daysRaw = Number(firstValue(query.days));
  const days = FLOW_WINDOWS.includes(daysRaw as (typeof FLOW_WINDOWS)[number]) ? daysRaw : DEFAULT_FLOW_DAYS;
  const inspected = inspectedReference(query.inspect);

  // Read what this view needs, and nothing else. The proof is read on every view because the band
  // states it on every view: a reader must never be one click away from the balance check.
  let proof;
  let balance: TrialBalance | null = null;
  let ledger: AccountLedger | null = null;
  let page: EntriesPage | null = null;
  let types: { entryType: string; count: number }[] = [];
  let flows: DailyFlow[] = [];
  let selectedType: string | null = null;
  try {
    proof = await appendOnlyProof(sql);

    if (view === "balances") {
      balance = await trialBalance(sql, asOf);
    } else if (view === "account") {
      // The account id is validated against the chart of accounts, which the trial balance
      // already reads: an unknown id becomes "no account chosen" rather than an empty table.
      balance = await trialBalance(sql);
      const known = balance.accounts.find((one) => one.accountId === wantedAccount);
      ledger = known ? await accountLedger(sql, known.accountId, MOST_ACCOUNT_ENTRIES) : null;
    } else if (view === "entries") {
      types = await entryTypesPresent(sql);
      selectedType = types.some((one) => one.entryType === firstValue(query.type)) ? (firstValue(query.type) as string) : null;
      page = await entries(sql, {
        entryType: selectedType ?? undefined,
        policyId,
        claimId,
        limit: showingAll ? MOST_ENTRIES_WITH_ALL : MOST_ENTRIES,
      });
    } else {
      flows = await dailyFlows(sql, days);
    }
  } catch {
    return (
      <PortalShell user={user} active="ledger" band={{ title: "Ledger" }}>
        <p className="error" role="alert">
          The ledger could not be read. Reload the screen to try again.
        </p>
        <Link className="button-link" href={LEDGER_PATH} prefetch={false}>
          Reload the ledger
        </Link>
      </PortalShell>
    );
  }

  const chosenAccount = balance && ledger ? balance.accounts.find((one) => one.accountId === ledger.accountId) : undefined;

  // The section navigation: the four views of the ledger, then the console's own screens, so an
  // operator moves between the books and the machine without going back to the sidebar.
  const views = [
    {
      key: "balances",
      label: "Balances",
      href: withParams(LEDGER_PATH, query, { view: "balances", inspect: null }),
      current: view === "balances",
      icon: Scale,
      group: "Ledger",
    },
    {
      key: "account",
      label: "Account",
      href: withParams(LEDGER_PATH, query, { view: "account", inspect: null }),
      current: view === "account",
      icon: BookOpenText,
      group: "Ledger",
    },
    {
      key: "entries",
      label: "Entries",
      href: withParams(LEDGER_PATH, query, { view: "entries", inspect: null }),
      current: view === "entries",
      icon: ListTree,
      count: proof.entryCount,
      group: "Ledger",
    },
    {
      key: "flows",
      label: "Flows",
      href: withParams(LEDGER_PATH, query, { view: "flows", inspect: null }),
      current: view === "flows",
      icon: TrendingUp,
      group: "Ledger",
    },
    { key: "feed", label: "Feed", href: "/ops/console", icon: Activity, group: "Console" },
    { key: "problems", label: "Problems", href: "/ops/console?view=problems", icon: AlertTriangle, group: "Console" },
    { key: "latency", label: "Latency", href: "/ops/console?view=latency", icon: Gauge, group: "Console" },
    { key: "search", label: "Search", href: "/ops/console/search", icon: Search, group: "Console" },
    { key: "infra", label: "Infrastructure", href: "/ops/console/infra", icon: ServerCog, group: "Console" },
  ];

  return (
    <PortalShell
      user={user}
      active="ledger"
      trail={[{ label: "Console", href: "/ops/console" }, { label: "Ledger" }]}
      views={views}
      viewsSubtitle="Append-only journal"
      inspector={inspected ? <Inspector reference={inspected} closeHref={closeInspectorHref(LEDGER_PATH, query)} user={user} now={now} /> : undefined}
      band={{
        title: "Ledger",
        suffix: chosenAccount ? chosenAccount.name : asOf ? `as of ${asOf}` : undefined,
        meta: (
          <>
            <Chip tone={proof.balanced ? "ok" : "warn"}>{proof.balanced ? "debits = credits" : "UNBALANCED"}</Chip>
            <Chip tone="neutral">{proof.entryCount} entries</Chip>
            <Chip tone="neutral">append-only</Chip>
            <Chip tone="ok">Stripe: LIVE SANDBOX</Chip>
            <Chip tone="neutral">claim rail: LOCAL SIMULATOR</Chip>
          </>
        ),
        actions: (
          <Link href="/ops/reconciliation" prefetch={false} className="button-link secondary">
            Reconciliation
          </Link>
        ),
      }}
    >
      {view === "balances" && balance ? <BalancesView balance={balance} proof={proof} query={query} /> : null}

      {view === "account" ? (
        ledger && chosenAccount ? (
          <AccountView ledger={ledger} account={chosenAccount} query={query} now={now} inspected={inspected} />
        ) : (
          <EmptyState
            illustration="open-ledger"
            action={
              <Link className="button-link" href={withParams(LEDGER_PATH, query, { view: "balances", account: null, inspect: null })} prefetch={false}>
                Open the balances
              </Link>
            }
          >
            Choose an account in Balances to read its entries.
          </EmptyState>
        )
      ) : null}

      {view === "entries" && page ? (
        <EntriesView page={page} types={types} query={query} now={now} selectedType={selectedType} showingAll={showingAll} />
      ) : null}

      {view === "flows" ? <FlowsView flows={flows} days={days} query={query} /> : null}

      {/* AF-02, on every console screen: which provider is real and which rail is simulated. */}
      <div className="notices">
        <IntegrationModes />
      </div>
    </PortalShell>
  );
}
