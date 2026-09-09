import "@/app/styles/console.css";
import Link from "next/link";
import type { ReactNode } from "react";
import { BookOpenText, Gauge, ListTree, Rss, Scale, TrendingUp, TriangleAlert } from "lucide-react";
import { Chip } from "@/components/detail-layout";
import type { NavView } from "@/components/shell/section-nav";
import { EmptyState } from "@/components/ui/empty";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable, ExpandHead, ExpandRow, FactGrid, Num, Ref } from "@/components/ui/table";
import { When } from "@/components/ui/time";
import { formatCentsAsUsd } from "@/lib/money/cents";
import type { ConsoleActivity, ConsoleEvent, ConsoleOutcome, RecoveryAction } from "@/lib/console/read";
import type { Attempted } from "@/lib/console/safe-read";
import { withParams, type Query } from "@/lib/ui/views";

// The pieces every console screen shares. Server components only: plain HTML, no state, no
// JavaScript of ours. Everything they display arrives already read and already formatted.
//
// Rebuilt on the interface system of 2026-09-09 (components/ui/table.tsx): the two tables below
// are DataTables of six columns, and what used to make them nine columns wide now lives in the
// expansion row under each record. Every exported name and signature is the one the console
// pages and components/console-360.tsx already import; the new props are all optional.

// ---------------------------------------------------------------------------
// The views of the console, and the views of the ledger
// ---------------------------------------------------------------------------

// Yoann's decision of 2026-09-09: the ledger is a sidebar entry of its own, not a group inside the
// console's submenu, and Search and Infrastructure are single entries with no submenu at all. So
// there are two lists here, one per sidebar entry, and neither carries a group heading: a submenu
// is a plain indented list of links (cycle 2, decision 11 is superseded on this point).
//
// Decision 3: a count is drawn only for something a person must act on. Problems is the one entry
// that qualifies, and only while there are problems; the number of entries, runs or webhooks is a
// record count and carries none.
export type ConsoleViewKey = "feed" | "problems" | "latency";
export type LedgerViewKey = "balances" | "account" | "entries" | "flows";

const CONSOLE_PATH = "/ops/console";
// The same route as LEDGER_PATH in app/ops/ledger-views.tsx. It is written again here rather than
// imported, because a component must not reach into a route folder to learn its own links.
const LEDGER_PATH = "/ops/ledger";

// Every view of the console: its icon, and the URL that opens it from another screen.
const CONSOLE_NAV: { key: ConsoleViewKey; label: string; icon: NavView["icon"]; href: string }[] = [
  { key: "feed", label: "Feed", icon: Rss, href: CONSOLE_PATH },
  { key: "problems", label: "Problems", icon: TriangleAlert, href: `${CONSOLE_PATH}?view=problems` },
  { key: "latency", label: "Latency", icon: Gauge, href: `${CONSOLE_PATH}?view=latency` },
];

const LEDGER_NAV: { key: LedgerViewKey; label: string; icon: NavView["icon"]; href: string }[] = [
  { key: "balances", label: "Balances", icon: Scale, href: LEDGER_PATH },
  { key: "account", label: "Account", icon: BookOpenText, href: `${LEDGER_PATH}?view=account` },
  { key: "entries", label: "Entries", icon: ListTree, href: `${LEDGER_PATH}?view=entries` },
  { key: "flows", label: "Flows", icon: TrendingUp, href: `${LEDGER_PATH}?view=flows` },
];

// Every view of one list is the SAME route with another `view=`, so switching between them keeps
// the window, the kinds, the date or the account the reader has already chosen. `inspect` is always
// dropped, because an open drawer belongs to the view it was opened from.
export function consoleViews(current: ConsoleViewKey, options?: { query?: Query; problemCount?: number }): NavView[] {
  const query = options?.query;
  return CONSOLE_NAV.map((entry) => ({
    key: entry.key,
    label: entry.label,
    href: query ? withParams(CONSOLE_PATH, query, { view: entry.key, inspect: null }) : entry.href,
    current: entry.key === current,
    icon: entry.icon,
    count: entry.key === "problems" ? options?.problemCount : undefined,
  }));
}

export function ledgerViews(current: LedgerViewKey, options?: { query?: Query }): NavView[] {
  const query = options?.query;
  return LEDGER_NAV.map((entry) => ({
    key: entry.key,
    label: entry.label,
    href: query ? withParams(LEDGER_PATH, query, { view: entry.key, inspect: null }) : entry.href,
    current: entry.key === current,
    icon: entry.icon,
  }));
}

// ---------------------------------------------------------------------------
// Personal data on a shared screen
// ---------------------------------------------------------------------------

// An email or a person's name is masked to its first three characters, and revealed by opening
// a native <details>. Yoann's rule of 2026-09-09: the console is a screen an operator keeps open
// on a second monitor while other people walk past, so an address is one click away rather than
// on display. The value is still in the HTML: this is a reading discipline, not a security
// control, and the console is already staff-only.
export function maskToFirstThree(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  return `${trimmed.slice(0, 3)}***`;
}

// The two spellings of the fact both live in the SUMMARY, and app/styles/console.css draws exactly
// one of them: the masked one while the fold is closed, the real one while it is open. Before this,
// opening a fact left the masked value in place and printed the real one underneath it, so the cell
// held two values and read as two facts (round 1, MEDIUM). Keeping both inside the summary is what
// lets the reader close it again: a summary that disappeared when open could not.
export function Masked({ value, what = "value" }: { value: string | null | undefined; what?: string }) {
  if (!value) {
    return <span className="dt-muted">none</span>;
  }
  return (
    <details className="row-actions console-masked">
      <summary aria-label={`reveal the ${what}`}>
        <span className="console-masked-hidden">{maskToFirstThree(value)}</span>
        <span className="console-masked-shown">{value}</span>
      </summary>
    </details>
  );
}

// ---------------------------------------------------------------------------
// A panel that could not read its rows
// ---------------------------------------------------------------------------

// One red line instead of a blank page. Every panel of the console renders this when its read
// failed, so a single broken query never takes the screen down with it (lib/console/safe-read.ts).
export function FailureLine({ attempted }: { attempted: Attempted<unknown> }) {
  if (attempted.ok) {
    return null;
  }
  return (
    <div className="notices">
      <p className="error" role="alert">
        {attempted.failure}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Which integrations are real, said on every console screen
// ---------------------------------------------------------------------------

// WHY IT EXISTS. These screens put records of a real Stripe sandbox next to records of two local
// simulators, in the same tables, with the same look. A simulated record that reads as a live one
// is the single misrepresentation the brief treats as disqualifying (recheck finding F-RC-08,
// AF-02). The rows themselves carry the rail as well, and the README integration inventory is the
// full statement.
//
// The three chips carry the exact AF-02 wording, out of any fold, so a text search for
// "LOCAL SIMULATOR" on a screenshot finds it.
//
// The nine console and ledger screens no longer draw this line: the top bar of every workspace
// screen carries the same three modes, and printing them twice within 60 px was read as two
// different statements (cycle 2, decision 1). The screens that still call it are the 360 views,
// which have no top bar of their own. The sentence that used to close it left the reading flow for
// each screen's About fold, as RailsAbout below (round 1, MEDIUM).
export function IntegrationModes() {
  return (
    <p className="note console-modes">
      <Chip tone="ok">Stripe: LIVE SANDBOX</Chip>
      <Chip tone="neutral">claim rail: LOCAL SIMULATOR</Chip>
      <Chip tone="neutral">bank check: LOCAL SIMULATOR</Chip>
    </p>
  );
}

// The rail rule, said in About rather than beside the chips, with the same words on all nine
// console and ledger screens.
export function RailsAbout() {
  return (
    <>
      <h4>Rails</h4>
      <p>
        Every row carries the rail it moved on. <strong>Stripe: LIVE SANDBOX</strong> is a real Stripe sandbox;{" "}
        <strong>LOCAL SIMULATOR</strong> is a rail simulated inside this application. The top bar states the three modes
        on every screen.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Times and durations
// ---------------------------------------------------------------------------

// Every instant on the console is UTC and says so once, on the page band.
export function utc(instant: Date | null | undefined): string {
  return instant ? instant.toISOString().replace("T", " ").slice(0, 19) : "";
}

// Milliseconds under a second, seconds under two minutes, then minutes. Integer-ish formatting:
// a duration is a measurement, not money, so one decimal is enough and no cent is at stake.
export function formatSeconds(seconds: number | null): string {
  if (seconds === null) return "no sample";
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 120) return `${seconds.toFixed(1)} s`;
  return `${Math.round(seconds / 60)} min`;
}

export function describeMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / (60 * 24))} days`;
}

// ---------------------------------------------------------------------------
// The feed table
// ---------------------------------------------------------------------------

const OUTCOME_TONE: Record<ConsoleOutcome, "ok" | "warn" | "neutral"> = {
  ok: "ok",
  warn: "warn",
  failed: "warn",
  neutral: "neutral",
};

// AF-02 asks for these words exact, and the band, the top bar and every other screen of the
// application write "Stripe: LIVE SANDBOX" with its colon while lib/console/read.ts stores the mode
// without one. `lib/` is out of this branch's scope, so the colon is put back at the render site,
// here, for every row of every console table (round 1, MEDIUM).
export function railLabel(rail: string): string {
  return rail === "Stripe LIVE SANDBOX" ? "Stripe: LIVE SANDBOX" : rail;
}

// Six columns: When, Kind, What, Amount, Who, Object. The rail chip stays beside the title, on
// the row and never in the fold (AF-02, recheck finding F-RC-08). The free-text detail and the
// full UTC instant, which used to make this table seven columns of shredded uuids (UI-026 and
// UI-030), are in the expansion under each row.
//
// `inspectHref` and `openReference` are optional: a page that offers the inspector passes them
// and every reference becomes a link that opens the trail beside the table; a page that does not
// (the 360 screens) gets the same table with plain reference tokens.
export function EventTable({
  events,
  ariaLabel,
  now,
  toolbar,
  legend,
  footer,
  inspectHref,
  openReference,
  emptyMessage = "Nothing in this window.",
}: {
  events: ConsoleEvent[];
  ariaLabel: string;
  now?: Date;
  toolbar?: ReactNode;
  legend?: ReactNode;
  footer?: ReactNode;
  inspectHref?: (reference: string) => string;
  openReference?: string | null;
  emptyMessage?: ReactNode;
}) {
  // One clock for every age on this table, like the pages that read `now` themselves.
  const clock = now ?? new Date();
  return (
    // The wrapper carries one rule of app/styles/console.css: a Stripe session id is sixty
    // characters, and a narrow Object column used to break it into a tower of three-letter
    // fragments (UI-030). It stays on one line and the table's own box scrolls sideways.
    <div className="console-event-table">
      <DataTable ariaLabel={ariaLabel} toolbar={toolbar} legend={legend} footer={footer}>
        <thead>
          <tr>
            <ExpandHead />
            <th className="nowrap">When</th>
            <th>Kind</th>
            <th>What</th>
            <th className="num">Amount</th>
            <th>Who</th>
            <th>Object</th>
          </tr>
        </thead>
        {events.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={7} className="dt-empty">
                <EmptyState illustration="sleeping-corgi">{emptyMessage}</EmptyState>
              </td>
            </tr>
          </tbody>
        ) : (
          events.map((event, index) => (
            <ExpandRow
              // The index is part of the key on purpose: two journal lines of the same entry share
              // an instant AND a reference, and React dropped one of the two rows when the key was
              // built from those alone.
              key={`${index}-${event.kind}-${event.instant.toISOString()}-${event.reference ?? "none"}`}
              columns={6}
              selected={openReference != null && event.reference === openReference}
              cells={
                <>
                  <td className="nowrap">
                    <When instant={event.instant} now={clock} />
                  </td>
                  <td className="nowrap">{event.kind.replace(/_/g, " ")}</td>
                  <td>
                    <Chip tone={OUTCOME_TONE[event.outcome]}>{event.title}</Chip>
                    {event.rail ? <Chip tone="neutral">{railLabel(event.rail)}</Chip> : null}
                  </td>
                  <Num>{event.amountCents === null ? "" : formatCentsAsUsd(event.amountCents)}</Num>
                  {/* A person's name is masked on the feed, like an email: the feed is a firehose,
                      and a name in it is read by everybody who walks past the screen. An actor that
                      is not a person ("stripe", "the ledger", "the daily scheduled job", a key
                      prefix) is printed as it is: masking it would be noise, not discretion. */}
                  <td>{event.actorIsPerson ? <Masked value={event.actor} what="actor" /> : event.actor}</td>
                  {/* The object, once. The word "open" beside a code, and a policy number printed
                      as a link AND as a token under it, were both read as two different objects
                      (cycle 2, decision 5, and round 1 MEDIUM). */}
                  <ObjectCell event={event} inspectHref={inspectHref} openReference={openReference} />
                </>
              }
            >
              <FactGrid
                items={[
                  { label: "When", value: `${utc(event.instant)} UTC` },
                  { label: "Detail", value: event.detail === "" ? "none" : event.detail },
                  { label: "Rail", value: event.rail ? railLabel(event.rail) : "not a rail" },
                  { label: "Reference", value: event.reference ? <code className="ref">{event.reference}</code> : "none" },
                  { label: "Who", value: event.actorIsPerson ? <Masked value={event.actor} what="actor" /> : event.actor },
                ]}
              />
            </ExpandRow>
          ))
        )}
      </DataTable>
    </div>
  );
}

// The Object cell of one feed row. Three things can be true, in this order:
//   the row is about a record we have a screen for -> its number, linked to that screen;
//   the row carries a provider reference we do not already print -> the token that opens the
//   drawer on it;
//   neither -> "no object", said once.
function ObjectCell({
  event,
  inspectHref,
  openReference,
}: {
  event: ConsoleEvent;
  inspectHref?: (reference: string) => string;
  openReference?: string | null;
}) {
  const objectNumber = event.policyNumber ?? event.claimNumber;
  // A policy number IS the reference on a policy event, so printing both would print it twice.
  const reference = event.reference && event.reference !== objectNumber ? event.reference : null;

  if (!objectNumber && !reference) {
    return (
      <td>
        <span className="dt-muted">no object</span>
      </td>
    );
  }
  return (
    <td>
      {objectNumber && event.href ? (
        <Link href={event.href} prefetch={false}>
          {objectNumber}
        </Link>
      ) : (
        objectNumber
      )}
      {reference ? (
        <span className="dt-sub">
          <Ref value={reference} inspectHref={inspectHref?.(reference)} open={openReference === reference} />
        </span>
      ) : null}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Recovery actions
// ---------------------------------------------------------------------------

// The action offered next to a problem. Every one of them is a form or a screen that ALREADY
// exists: this slice adds no write route, and these forms post to the same endpoints the
// reconciliation screen and the brokers screen post to, with the same server-side checks.
export function RecoveryCell({ recovery }: { recovery: RecoveryAction }) {
  // The same action, the same route, the same fields; the button now says it is working while the
  // post is in flight (cycle 2, the feedback audit of 19:10).
  if (recovery.kind === "reconcile") {
    return (
      <form method="post" action="/api/jobs/reconcile" className="inline-form">
        <SubmitButton className="secondary small">Run reconciliation</SubmitButton>
      </form>
    );
  }
  if (recovery.kind === "kyb-recheck") {
    return (
      <form method="post" action={`/api/brokers/${recovery.brokerId}/kyb/recheck`} className="inline-form">
        <SubmitButton className="secondary small">Re-read {recovery.brokerName}</SubmitButton>
      </form>
    );
  }
  if (recovery.kind === "link") {
    return (
      <Link href={recovery.href} prefetch={false} className="console-recovery-link">
        {recovery.label}
      </Link>
    );
  }
  return <span className="dt-muted">{recovery.why}</span>;
}

// ---------------------------------------------------------------------------
// The activity table (console v2, migration 0021)
// ---------------------------------------------------------------------------

// One row per REQUEST the application answered: who asked, which route, how it ended, the
// sanitised sentence and how long it took. The rule a refusal named, the object it was about and
// the correlation id that ties the row to the JSON line the server printed are in the expansion,
// which is what keeps this table at six columns. Shared by the console page and the four 360
// pages, so the same request is described the same way wherever it is read.
//
// The actor is masked exactly like everywhere else on the console: a person's display name shows
// its first three characters and opens on a click; 'cron', 'stripe' and 'anonymous' are printed
// as they are, because they are not people.
export function ActivityTable({
  rows,
  ariaLabel,
  now,
  toolbar,
  legend,
  footer,
  emptyMessage = "Nothing was refused and nothing failed.",
}: {
  rows: ConsoleActivity[];
  ariaLabel: string;
  now?: Date;
  toolbar?: ReactNode;
  legend?: ReactNode;
  footer?: ReactNode;
  emptyMessage?: ReactNode;
}) {
  const clock = now ?? new Date();
  return (
    <DataTable ariaLabel={ariaLabel} toolbar={toolbar} legend={legend} footer={footer}>
      <thead>
        <tr>
          <ExpandHead />
          <th className="nowrap">When</th>
          <th>Route</th>
          <th>Who</th>
          <th>Answered</th>
          <th>Reason</th>
          <th className="num">Took</th>
        </tr>
      </thead>
      {rows.length === 0 ? (
        <tbody>
          <tr>
            <td colSpan={7} className="dt-empty">
              <EmptyState illustration="all-clear">{emptyMessage}</EmptyState>
            </td>
          </tr>
        </tbody>
      ) : (
        rows.map((row) => (
          <ExpandRow
            key={row.activityId}
            columns={6}
            cells={
              <>
                <td className="nowrap">
                  <When instant={row.instant} now={clock} />
                </td>
                <td>
                  <code className="ref">
                    {row.method} {row.route}
                  </code>
                </td>
                <td>
                  {row.actorIsPerson ? <Masked value={row.actor} what="actor" /> : row.actor}
                  {row.actorRole ? <span className="dt-sub">{row.actorRole}</span> : null}
                </td>
                <td className="nowrap">
                  <Chip tone={row.outcome === "ok" ? "ok" : "warn"}>{row.outcome}</Chip>
                  <span className="dt-sub">HTTP {row.statusCode}</span>
                </td>
                {/* A recorded refusal can be a whole sentence naming twelve allowed values. The
                    cell shows one line of it, its full text is one hover away and the fold under
                    the row prints it whole: no cell of this system holds a paragraph. */}
                <td>
                  {row.message ? (
                    <span className="console-reason" title={row.message}>
                      {row.message}
                    </span>
                  ) : (
                    <span className="dt-muted">none recorded</span>
                  )}
                </td>
                <Num>{row.durationMs} ms</Num>
              </>
            }
          >
            <FactGrid
              items={[
                { label: "When", value: `${utc(row.instant)} UTC` },
                { label: "Reason", value: row.message ?? "none recorded", wide: true },
                { label: "Rule", value: row.rule ?? "none named" },
                {
                  label: "Object",
                  value: row.consoleHref ? (
                    <Link href={row.consoleHref} prefetch={false}>
                      {row.subjectKind}
                    </Link>
                  ) : (
                    "no object"
                  ),
                },
                {
                  label: "Correlation id",
                  value: (
                    <Link href={`/ops/console/search?reference=${encodeURIComponent(row.correlationId)}`} prefetch={false}>
                      <code className="ref">{row.correlationId}</code>
                    </Link>
                  ),
                },
              ]}
            />
          </ExpandRow>
        ))
      )}
    </DataTable>
  );
}
