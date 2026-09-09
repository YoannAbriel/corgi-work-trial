import "@/app/styles/ops-tables.css";
import Link from "next/link";
import { Chip, Empty } from "@/components/detail-layout";
import { formatCentsAsUsd } from "@/lib/money/cents";
import type { ConsoleEvent, ConsoleOutcome, RecoveryAction } from "@/lib/console/read";
import type { Attempted } from "@/lib/console/safe-read";

// The pieces every console screen shares. Server components only: plain HTML, no state, no
// JavaScript of ours. Everything they display arrives already read and already formatted.

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
    return <span className="note">none</span>;
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
    <p className="error" role="alert">
      {attempted.failure}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Which integrations are real, said on every console screen
// ---------------------------------------------------------------------------

// One line under the heading of all seven console screens (recheck finding F-RC-08, AF-02).
//
// WHY IT EXISTS. These screens put records of a real Stripe sandbox next to records of two local
// simulators, in the same tables, with the same look. Every other screen of the application
// carries its mode wording; the console did not, and a simulated record that reads as a live one
// is the single misrepresentation the brief treats as disqualifying. The rows themselves carry
// the rail as well, and the README integration inventory is the full statement.
export function IntegrationModes() {
  return (
    <p className="note">
      <strong>Stripe: test mode, live sandbox.</strong> Claimant bank check and claim payout rail:{" "}
      <strong>local simulators</strong>, labeled as such on their rows.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Times and durations
// ---------------------------------------------------------------------------

// Every instant on the console is UTC and says so once, on the page heading.
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

export function EventTable({ events, ariaLabel }: { events: ConsoleEvent[]; ariaLabel: string }) {
  if (events.length === 0) {
    return <Empty>Nothing in this window.</Empty>;
  }
  return (
    <div className="table-scroll" role="region" aria-label={ariaLabel} tabIndex={0}>
      {/* UI-026 and UI-030: the seven columns of the feed are read together, so each one carries
          the minimum width its content needs (app/styles/ops-tables.css). Before this, a uuid in
          the Detail column collapsed the whole row into a tower of three-letter fragments. */}
      <table className="ops-table">
        <thead>
          <tr>
            <th className="col-when">When (UTC)</th>
            <th className="col-label">Kind</th>
            <th className="col-text">What</th>
            <th className="amount">Amount</th>
            <th className="col-name">Who</th>
            <th className="col-ref">Detail</th>
            <th className="col-ref">Object</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event, index) => (
            <tr key={`${event.kind}-${event.instant.toISOString()}-${event.reference ?? index}`}>
              <td className="col-when">{utc(event.instant)}</td>
              <td className="col-label">{event.kind.replace(/_/g, " ")}</td>
              <td className="col-text">
                <Chip tone={OUTCOME_TONE[event.outcome]}>{event.title}</Chip>
                {/* The rail, ON the row and not in a fold (AF-02, recheck finding F-RC-08).
                    A row that moved no money carries no rail and prints nothing here. */}
                {event.rail ? (
                  <>
                    {" "}
                    <Chip tone="neutral">{event.rail}</Chip>
                  </>
                ) : null}
              </td>
              <td className="amount">{event.amountCents === null ? "" : formatCentsAsUsd(event.amountCents)}</td>
              {/* A person's name is masked on the feed, like an email: the feed is a firehose,
                  and a name in it is read by everybody who walks past the screen. An actor that
                  is not a person ("stripe", "the ledger", "the daily scheduled job", a key
                  prefix) is printed as it is: masking it would be noise, not discretion. */}
              <td className="col-name">{event.actorIsPerson ? <Masked value={event.actor} what="actor" /> : event.actor}</td>
              <td className="col-ref">{event.detail}</td>
              <td className="col-ref">
                {event.href ? (
                  <Link href={event.href} prefetch={false}>
                    {event.policyNumber ?? event.claimNumber ?? event.reference ?? "open"}
                  </Link>
                ) : (
                  <span className="note">{event.reference ?? "no object"}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
          Run the reconciliation now
        </button>
      </form>
    );
  }
  if (recovery.kind === "kyb-recheck") {
    return (
      <form method="post" action={`/api/brokers/${recovery.brokerId}/kyb/recheck`} className="inline-form">
        <button type="submit" className="secondary small">
          Re-read {recovery.brokerName} from Stripe
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
  return <span className="note">{recovery.why}</span>;
}
