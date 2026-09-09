import "@/app/styles/console.css";
import Link from "next/link";
import type { ReactNode } from "react";
import { Chip } from "@/components/detail-layout";
import { EmptyState } from "@/components/ui/empty";
import { DataTable, ExpandHead, ExpandRow, FactGrid, Num, Ref } from "@/components/ui/table";
import { When } from "@/components/ui/time";
import { formatCentsAsUsd } from "@/lib/money/cents";
import type { ConsoleActivity, ConsoleEvent, ConsoleOutcome, RecoveryAction } from "@/lib/console/read";
import type { Attempted } from "@/lib/console/safe-read";

// The pieces every console screen shares. Server components only: plain HTML, no state, no
// JavaScript of ours. Everything they display arrives already read and already formatted.
//
// Rebuilt on the interface system of 2026-09-09 (components/ui/table.tsx): the two tables below
// are DataTables of six columns, and what used to make them nine columns wide now lives in the
// expansion row under each record. Every exported name and signature is the one the console
// pages and components/console-360.tsx already import; the new props are all optional.

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

export function Masked({ value, what = "value" }: { value: string | null | undefined; what?: string }) {
  if (!value) {
    return <span className="dt-muted">none</span>;
  }
  return (
    <details className="row-actions">
      <summary aria-label={`reveal the ${what}`}>{maskToFirstThree(value)}</summary>
      <div>{value}</div>
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

// One line under the band of all seven console screens (recheck finding F-RC-08, AF-02).
//
// WHY IT EXISTS. These screens put records of a real Stripe sandbox next to records of two local
// simulators, in the same tables, with the same look. Every other screen of the application
// carries its mode wording; the console did not, and a simulated record that reads as a live one
// is the single misrepresentation the brief treats as disqualifying. The rows themselves carry
// the rail as well, and the README integration inventory is the full statement.
//
// The three chips carry the exact AF-02 wording, out of any fold, so a text search for
// "LOCAL SIMULATOR" on a console screenshot finds it.
export function IntegrationModes() {
  return (
    <p className="note console-modes">
      <Chip tone="ok">Stripe: LIVE SANDBOX</Chip>
      <Chip tone="neutral">claim rail: LOCAL SIMULATOR</Chip>
      <Chip tone="neutral">bank check: LOCAL SIMULATOR</Chip>
      <span>Every row carries the rail it moved on.</span>
    </p>
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
                    {event.rail ? <Chip tone="neutral">{event.rail}</Chip> : null}
                  </td>
                  <Num>{event.amountCents === null ? "" : formatCentsAsUsd(event.amountCents)}</Num>
                  {/* A person's name is masked on the feed, like an email: the feed is a firehose,
                      and a name in it is read by everybody who walks past the screen. An actor that
                      is not a person ("stripe", "the ledger", "the daily scheduled job", a key
                      prefix) is printed as it is: masking it would be noise, not discretion. */}
                  <td>{event.actorIsPerson ? <Masked value={event.actor} what="actor" /> : event.actor}</td>
                  <td>
                    {event.href ? (
                      <Link href={event.href} prefetch={false}>
                        {event.policyNumber ?? event.claimNumber ?? "open"}
                      </Link>
                    ) : null}
                    {event.reference ? (
                      <span className="dt-sub">
                        <Ref
                          value={event.reference}
                          inspectHref={inspectHref?.(event.reference)}
                          open={openReference === event.reference}
                        />
                      </span>
                    ) : event.href ? null : (
                      <span className="dt-muted">no object</span>
                    )}
                  </td>
                </>
              }
            >
              <FactGrid
                items={[
                  { label: "When", value: `${utc(event.instant)} UTC` },
                  { label: "Detail", value: event.detail === "" ? "none" : event.detail },
                  { label: "Rail", value: event.rail ?? "not a rail" },
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

// ---------------------------------------------------------------------------
// Recovery actions
// ---------------------------------------------------------------------------

// The action offered next to a problem. Every one of them is a form or a screen that ALREADY
// exists: this slice adds no write route, and these forms post to the same endpoints the
// reconciliation screen and the brokers screen post to, with the same server-side checks.
export function RecoveryCell({ recovery }: { recovery: RecoveryAction }) {
  if (recovery.kind === "reconcile") {
    return (
      <form method="post" action="/api/jobs/reconcile" className="inline-form">
        <button type="submit" className="secondary small">
          Run reconciliation
        </button>
      </form>
    );
  }
  if (recovery.kind === "kyb-recheck") {
    return (
      <form method="post" action={`/api/brokers/${recovery.brokerId}/kyb/recheck`} className="inline-form">
        <button type="submit" className="secondary small">
          Re-read {recovery.brokerName}
        </button>
      </form>
    );
  }
  if (recovery.kind === "link") {
    return (
      <Link href={recovery.href} prefetch={false}>
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
                <td>{row.message ?? <span className="dt-muted">none recorded</span>}</td>
                <Num>{row.durationMs} ms</Num>
              </>
            }
          >
            <FactGrid
              items={[
                { label: "When", value: `${utc(row.instant)} UTC` },
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
