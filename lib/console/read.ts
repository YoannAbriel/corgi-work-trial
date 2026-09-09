import type postgres from "postgres";
import { centsFromDatabase } from "@/lib/money/cents";
import {
  A_LATER_RUN_RE_EXAMINED_IT,
  LATEST_REPORT_OF_EACH_BREAK,
  toBreakRow,
  type BreakRowShape,
  type ReconciliationBreakRow,
} from "@/lib/reconciliation/read";

// The operations console (slice B13-9): every read behind /ops/console.
//
// WHAT THIS FILE IS. One place that answers four questions an operator asks during an incident:
//
//   1. what has happened since <instant>            -> consoleFeed
//   2. how long are things taking                   -> latencyTiles
//   3. what is broken or unresolved right now       -> operationsProblems
//   4. what is this reference, and what is its life -> resolveReference / consoleSubject + panels
//
// NOTHING HERE WRITES. Every function takes a `postgres.Sql` and only ever runs SELECT. There is
// no route, no form and no action in this slice that changes a row: the recovery actions the
// screens offer are the forms that ALREADY exist elsewhere (the reconciliation job, the KYB
// re-read, the claim payment send), linked or re-rendered, never re-implemented here.
//
// WHAT IT NEVER SHOWS. No provider payload, no secret, no API key beyond its public `cmk_`
// prefix, no bank account beyond the last four digits another screen already shows. Every text
// that comes out of a payload is a short sanitised sentence, cut at SANITISED_DETAIL_LENGTH
// characters. Customer names and emails are here because the console is staff-only; the pages
// check the role before calling anything in this file.
//
// HOW THE FEED IS BUILT, and why it is not one big UNION. Each source table is read by its own
// small query, bounded by `since` and by its own limit, and the rows are merged and sorted in
// TypeScript on the server. Three reasons: each query stays readable on its own and uses the
// index its table already has (every one of these tables is indexed on the column the query
// orders by, or is small enough that it does not matter); the global newest N is always a subset
// of the union of the per-source newest N, so the merge is exact and not an approximation; and a
// source that is empty or slow cannot make the others unreadable. The percentiles below are the
// opposite case and are computed in SQL, because a percentile over a window is exactly what a
// database does well and what a page must never do row by row.

// How much of a payload sentence ever reaches a screen.
const SANITISED_DETAIL_LENGTH = 220;

// How many rows each source of the feed contributes before the merge. The page then keeps the
// newest `limit` of the merged list.
const ROWS_PER_FEED_SOURCE = 60;

// The assumption this slice adds, written once and printed on the screen that uses it
// (app/ops/console/page.tsx). An operation whose latest status is 'provider_accepted' has been
// accepted by the provider and has told us nothing since. After this long we stop calling it
// "in flight" and call it an unknown outcome that a human has to resolve. It is a threshold of
// this build, not a provider rule and not a Corgi rule: Stripe does not promise a delay, and
// the recovery job (/api/jobs/recover-operations) is what actually resolves such an operation.
export const UNKNOWN_OUTCOME_AFTER_MINUTES = 15;

// The window the latency tiles measure, and how far before it the first event of a pair may sit.
// A payment requested 30 hours ago and accepted 10 minutes ago is measured; one whose request is
// older than the lookback is not, and the tile says how many samples it actually had.
export const LATENCY_WINDOW_HOURS = 24;
const LATENCY_LOOKBACK_HOURS = 48;

// ---------------------------------------------------------------------------
// 1. The feed
// ---------------------------------------------------------------------------

// The kinds a reader can filter on. They are the tables, named the way an operator names them.
export const CONSOLE_EVENT_KINDS = [
  "money",
  "webhook",
  "journal",
  "policy",
  "claim",
  "approval",
  "reconciliation",
  "statement",
  "mcp",
  "kyb",
  "change_request",
] as const;

export type ConsoleEventKind = (typeof CONSOLE_EVENT_KINDS)[number];

export function isConsoleEventKind(value: string): value is ConsoleEventKind {
  return (CONSOLE_EVENT_KINDS as readonly string[]).includes(value);
}

// 'ok' happened and was fine, 'warn' needs a look, 'failed' did not happen, 'neutral' is a step.
export type ConsoleOutcome = "ok" | "warn" | "failed" | "neutral";

// WHICH RAIL A ROW'S MONEY ACTUALLY MOVED ON, printed on the row itself and never only in a
// fold (AF-02, recheck finding F-RC-08). The console shows records of a real Stripe sandbox and
// records of two local simulators side by side; a simulated record read as a live one is the
// one mistake this application must never make an operator make.
//
// A row that is not about a rail at all (a journal entry, a policy event, an approval) carries
// null and prints nothing: labelling it would be noise, and noise is what makes labels ignored.
export type IntegrationMode = "Stripe LIVE SANDBOX" | "LOCAL SIMULATOR";

// money_operations.provider is 'stripe' or 'simulator' (migration 0002), webhook_events.provider
// is 'stripe' (migration 0001), and a reconciliation source is 'stripe' or 'claims_rail'. Stripe
// is in test mode for the whole of this build: lib/stripe.ts refuses any key that is not
// sk_test_. Anything that is not exactly 'stripe' reads as a simulator, which is the fail-safe
// direction: a rail nobody thought to name here is never announced as live.
export function integrationModeOf(providerOrSource: string): IntegrationMode {
  return providerOrSource === "stripe" ? "Stripe LIVE SANDBOX" : "LOCAL SIMULATOR";
}

export type ConsoleEvent = {
  kind: ConsoleEventKind;
  instant: Date;
  title: string;
  outcome: ConsoleOutcome;
  actor: string;
  // True when `actor` is a person's name, read from users.display_name. It decides whether the
  // screen masks it: masking "stripe" or "the ledger" is noise, masking a person is the rule.
  actorIsPerson: boolean;
  detail: string;
  amountCents: number | null;
  policyId: string | null;
  claimId: string | null;
  brokerId: string | null;
  customerId: string | null;
  policyNumber: string | null;
  claimNumber: string | null;
  reference: string | null; // provider reference, business number, or event id
  href: string | null; // the existing screen of the object this event is about
  // The rail this row's money moved on, or null when the row is not about a rail. Required, not
  // optional, so that a kind added later cannot forget to answer the question (F-RC-08).
  rail: IntegrationMode | null;
};

export type FeedOptions = {
  since: Date;
  kinds?: ConsoleEventKind[];
  limit?: number;
};

// The largest feed this console will ever render in one page, whatever the query string asks for
// (Yoann's rule of 2026-09-09: the screen has to stay solid while someone is trying to break the
// application, so nothing on it is unbounded).
export const MOST_FEED_ROWS = 200;
const DEFAULT_FEED_MINUTES = 60;

// How far back a cursor may reach, and the correction of review finding F-B13-21.
//
// The digits were bounded, the instant was not. "999999d" is 2738 years: JavaScript builds that
// date happily, the driver sends it as the year -712, and Postgres refuses the parameter with
// "time zone displacement out of range". The feed and the errors panels both went dark, and the
// only thing the operator did was type a number into the form on the page. So the window is
// clamped here, in the pure function, and no reader can be handed an instant the database will
// not accept. Ten years is longer than this application has existed.
export const MOST_DAYS_BACK = 3650;

function clampToFloor(wanted: Date, now: Date): { since: Date; clamped: boolean } {
  const floor = new Date(now.getTime() - MOST_DAYS_BACK * 24 * 60 * 60_000);
  if (wanted.getTime() < floor.getTime()) {
    return { since: floor, clamped: true };
  }
  return { since: wanted, clamped: false };
}

// The `since` cursor, written the way an operator types it: an ISO instant, or a duration back
// from now ("15m", "2h", "3d"). A pure function, so the check script can prove it without a
// database. Anything unrecognised falls back to the default window rather than to the beginning
// of time: a typo must not turn into the largest query this page can make. Anything further back
// than MOST_DAYS_BACK is clamped to that floor, and the reading sentence says so.
export function parseSince(raw: string | undefined, now: Date): { since: Date; reading: string } {
  const text = (raw ?? "").trim();
  if (text === "") {
    return { since: new Date(now.getTime() - DEFAULT_FEED_MINUTES * 60_000), reading: `the last ${DEFAULT_FEED_MINUTES} minutes` };
  }
  const duration = /^(\d{1,6})\s*([mhd])$/i.exec(text);
  if (duration) {
    const amount = Number(duration[1]);
    const unit = duration[2].toLowerCase();
    const minutes = unit === "m" ? amount : unit === "h" ? amount * 60 : amount * 60 * 24;
    const { since, clamped } = clampToFloor(new Date(now.getTime() - minutes * 60_000), now);
    return {
      since,
      reading: clamped
        ? `the last ${text}, clamped to the last ${MOST_DAYS_BACK} days, which is as far back as this page reads: everything after ${since.toISOString()}`
        : `the last ${text}`,
    };
  }
  const instant = new Date(text);
  if (!Number.isNaN(instant.getTime())) {
    const { since, clamped } = clampToFloor(instant, now);
    return {
      since,
      reading: clamped
        ? `${instant.toISOString()} is further back than the ${MOST_DAYS_BACK} days this page reads, so the window was clamped: everything after ${since.toISOString()}`
        : `everything after ${instant.toISOString()}`,
    };
  }
  return {
    since: new Date(now.getTime() - DEFAULT_FEED_MINUTES * 60_000),
    reading: `"${text}" is not an instant or a duration, so the last ${DEFAULT_FEED_MINUTES} minutes are shown`,
  };
}

// Everything that happened after `since`, newest first. `kinds` restricts which tables are read
// at all: an unchecked kind costs no query.
export async function consoleFeed(
  database: postgres.Sql,
  { since, kinds, limit = 120 }: FeedOptions,
): Promise<ConsoleEvent[]> {
  const wanted = (kind: ConsoleEventKind) => !kinds || kinds.length === 0 || kinds.includes(kind);
  const readers: Promise<ConsoleEvent[]>[] = [];

  if (wanted("money")) readers.push(moneyEvents(database, since));
  if (wanted("webhook")) readers.push(webhookEvents(database, since));
  if (wanted("journal")) readers.push(journalEvents(database, since));
  if (wanted("policy")) readers.push(policyEvents(database, since));
  if (wanted("claim")) readers.push(claimEvents(database, since));
  if (wanted("approval")) readers.push(approvalEvents(database, since));
  if (wanted("reconciliation")) readers.push(reconciliationEvents(database, since));
  if (wanted("statement")) readers.push(statementEvents(database, since));
  if (wanted("mcp")) readers.push(mcpEvents(database, since));
  if (wanted("kyb")) readers.push(kybEvents(database, since));
  if (wanted("change_request")) readers.push(changeRequestEvents(database, since));

  const perSource = await Promise.all(readers);
  return perSource
    .flat()
    .sort((older, newer) => newer.instant.getTime() - older.instant.getTime())
    .slice(0, limit);
}

// Every money operation's lifecycle rows: requested, accepted by the provider, succeeded,
// failed, returned, unknown. This is the spine of the feed.
async function moneyEvents(database: postgres.Sql, since: Date): Promise<ConsoleEvent[]> {
  const rows = await database<
    {
      instant: Date;
      status: string;
      operation_kind: string;
      provider: string;
      amount_cents: string;
      provider_ref: string | null;
      reason: string | null;
      actor: string | null;
      policy_id: string | null;
      claim_id: string | null;
      broker_id: string | null;
      customer_id: string | null;
      policy_number: string | null;
      claim_number: string | null;
    }[]
  >`
    select event.recorded_at        as instant,
           event.status,
           operation.kind           as operation_kind,
           operation.provider,
           operation.amount_cents,
           event.provider_ref,
           -- The three payload keys the money paths actually write, in the order they mean
           -- something. Never the payload itself.
           left(coalesce(event.payload ->> 'reason',
                         event.payload ->> 'binding_refused_reason',
                         event.payload ->> 'note'), ${SANITISED_DETAIL_LENGTH}) as reason,
           author.display_name      as actor,
           operation.policy_id,
           operation.claim_id,
           policy.broker_id,
           policy.customer_id,
           policy.policy_number,
           claim.claim_number
      from money_operation_events event
      join money_operations operation on operation.id = event.operation_id
      left join claims claim          on claim.id = operation.claim_id
      -- A claim payout carries no policy_id, so the policy comes through its claim.
      left join policies policy       on policy.id = coalesce(operation.policy_id, claim.policy_id)
      left join users author          on author.id::text = operation.created_by
     where event.recorded_at > ${since}
     order by event.recorded_at desc
     limit ${ROWS_PER_FEED_SOURCE}
  `;
  return rows.map((row) => ({
    kind: "money" as const,
    instant: row.instant,
    title: `${row.operation_kind} ${row.status}`,
    outcome: moneyOutcome(row.status),
    actor: row.actor ?? `${row.provider} or a scheduled job`,
    actorIsPerson: row.actor !== null,
    detail: row.reason ?? "",
    amountCents: centsFromDatabase(row.amount_cents, "amount_cents"),
    policyId: row.policy_id,
    claimId: row.claim_id,
    brokerId: row.broker_id,
    customerId: row.customer_id,
    policyNumber: row.policy_number,
    claimNumber: row.claim_number,
    reference: row.provider_ref,
    href: objectHref(row.claim_id, row.policy_id),
    rail: integrationModeOf(row.provider),
  }));
}

function moneyOutcome(status: string): ConsoleOutcome {
  if (status === "succeeded") return "ok";
  if (status === "failed" || status === "unknown") return "failed";
  if (status === "returned") return "warn";
  return "neutral";
}

// The webhook inbox: the immutable event and the mutable processing row next to it. The payload
// is read for exactly one value, the id of the object the event is about, because that is what
// an operator types into Stripe's own console. Nothing else of it is shown.
async function webhookEvents(database: postgres.Sql, since: Date): Promise<ConsoleEvent[]> {
  const rows = await database<
    {
      instant: Date;
      provider: string;
      provider_event_id: string;
      event_type: string;
      status: string | null;
      attempts: number | null;
      last_error: string | null;
      object_id: string | null;
    }[]
  >`
    select event.received_at as instant,
           event.provider,
           event.provider_event_id,
           event.event_type,
           processing.status,
           processing.attempts,
           left(processing.last_error, ${SANITISED_DETAIL_LENGTH}) as last_error,
           event.payload -> 'data' -> 'object' ->> 'id' as object_id
      from webhook_events event
      left join webhook_processing processing on processing.webhook_event_id = event.id
     where event.received_at > ${since}
     order by event.received_at desc
     limit ${ROWS_PER_FEED_SOURCE}
  `;
  return rows.map((row) => ({
    kind: "webhook" as const,
    instant: row.instant,
    title: `${row.provider} ${row.event_type}`,
    outcome: webhookOutcome(row.status),
    actor: row.provider,
    actorIsPerson: false,
    detail: describeWebhookProcessing(row.status, row.attempts, row.last_error),
    amountCents: null,
    policyId: null,
    claimId: null,
    brokerId: null,
    customerId: null,
    policyNumber: null,
    claimNumber: null,
    reference: row.object_id ?? row.provider_event_id,
    href: `/ops/console/search?reference=${encodeURIComponent(row.object_id ?? row.provider_event_id)}`,
    rail: integrationModeOf(row.provider),
  }));
}

function webhookOutcome(status: string | null): ConsoleOutcome {
  if (status === "done") return "ok";
  if (status === "failed") return "failed";
  if (status === "ignored" || status === null) return "warn";
  return "neutral";
}

export function describeWebhookProcessing(
  status: string | null,
  attempts: number | null,
  lastError: string | null,
): string {
  if (status === null) {
    return "stored with no processing row, which should not happen";
  }
  const tries = `${attempts ?? 0} attempt${attempts === 1 ? "" : "s"}`;
  return lastError ? `${status}, ${tries}: ${lastError}` : `${status}, ${tries}`;
}

// The ledger itself. The amount shown is the sum of the debits of the entry, which equals the
// sum of its credits (a database constraint), so one figure describes the whole entry.
async function journalEvents(database: postgres.Sql, since: Date): Promise<ConsoleEvent[]> {
  const rows = await database<
    {
      instant: Date;
      entry_type: string;
      description: string;
      total_debit_cents: string;
      policy_id: string | null;
      claim_id: string | null;
      broker_id: string | null;
      customer_id: string | null;
      policy_number: string | null;
      claim_number: string | null;
      source_id: string;
      actor: string | null;
      reverses_entry_id: string | null;
    }[]
  >`
    select entry.recorded_at as instant,
           entry.entry_type,
           left(entry.description, ${SANITISED_DETAIL_LENGTH}) as description,
           (select coalesce(sum(line.debit_cents), 0) from journal_lines line where line.entry_id = entry.id)
                            as total_debit_cents,
           entry.policy_id,
           entry.claim_id,
           coalesce(entry.broker_id, policy.broker_id) as broker_id,
           policy.customer_id,
           policy.policy_number,
           claim.claim_number,
           entry.source_id,
           author.display_name as actor,
           entry.reverses_entry_id
      from journal_entries entry
      left join policies policy on policy.id = entry.policy_id
      left join claims claim    on claim.id = entry.claim_id
      left join users author    on author.id::text = entry.created_by
     where entry.recorded_at > ${since}
     order by entry.recorded_at desc
     limit ${ROWS_PER_FEED_SOURCE}
  `;
  return rows.map((row) => ({
    kind: "journal" as const,
    instant: row.instant,
    title: row.reverses_entry_id ? `${row.entry_type} (reversal)` : row.entry_type,
    outcome: row.reverses_entry_id ? "warn" : "neutral",
    actor: row.actor ?? "posted by the money path",
    actorIsPerson: row.actor !== null,
    detail: row.description,
    amountCents: centsFromDatabase(row.total_debit_cents, "total_debit_cents"),
    policyId: row.policy_id,
    claimId: row.claim_id,
    brokerId: row.broker_id,
    customerId: row.customer_id,
    policyNumber: row.policy_number,
    claimNumber: row.claim_number,
    reference: row.source_id,
    href: objectHref(row.claim_id, row.policy_id),
    // Not a rail record: nothing to label (F-RC-08).
    rail: null,
  }));
}

// Everything that ever happened to a policy: quoted, issued, endorsed, cancelled, corrected.
async function policyEvents(database: postgres.Sql, since: Date): Promise<ConsoleEvent[]> {
  const rows = await database<
    {
      instant: Date;
      event_type: string;
      effective_at: string;
      policy_id: string;
      policy_number: string;
      broker_id: string;
      customer_id: string;
      actor: string | null;
      reason: string | null;
    }[]
  >`
    select event.recorded_at as instant,
           event.event_type,
           to_char(event.effective_at, 'YYYY-MM-DD') as effective_at,
           policy.id          as policy_id,
           policy.policy_number,
           policy.broker_id,
           policy.customer_id,
           author.display_name as actor,
           left(coalesce(event.payload ->> 'reason', event.payload ->> 'note'), ${SANITISED_DETAIL_LENGTH}) as reason
      from policy_events event
      join policies policy on policy.id = event.policy_id
      left join users author on author.id::text = event.created_by
     where event.recorded_at > ${since}
     order by event.recorded_at desc
     limit ${ROWS_PER_FEED_SOURCE}
  `;
  return rows.map((row) => ({
    kind: "policy" as const,
    instant: row.instant,
    title: row.event_type,
    outcome: row.event_type.startsWith("correction") || row.event_type === "cancelled" ? "warn" : "neutral",
    actor: row.actor ?? "no signed-in user recorded",
    actorIsPerson: row.actor !== null,
    detail: [`effective ${row.effective_at}`, row.reason].filter(Boolean).join(" · "),
    amountCents: null,
    policyId: row.policy_id,
    claimId: null,
    brokerId: row.broker_id,
    customerId: row.customer_id,
    policyNumber: row.policy_number,
    claimNumber: null,
    reference: row.policy_number,
    href: `/ops/console/policy/${row.policy_id}`,
    // Not a rail record: nothing to label (F-RC-08).
    rail: null,
  }));
}

// Reserves, payments and closures, per claim.
async function claimEvents(database: postgres.Sql, since: Date): Promise<ConsoleEvent[]> {
  const rows = await database<
    {
      instant: Date;
      event_type: string;
      amount_cents: string | null;
      claim_id: string;
      claim_number: string;
      policy_id: string;
      policy_number: string;
      broker_id: string;
      customer_id: string;
      actor: string | null;
      note: string | null;
      rail_provider: string | null;
    }[]
  >`
    select event.recorded_at as instant,
           event.event_type,
           event.amount_cents,
           claim.id     as claim_id,
           claim.claim_number,
           policy.id    as policy_id,
           policy.policy_number,
           policy.broker_id,
           policy.customer_id,
           author.display_name as actor,
           left(event.payload ->> 'note', ${SANITISED_DETAIL_LENGTH}) as note,
           -- The four payment stages carry a money operation, and its provider is the rail the
           -- money really moved on. A reserve or a closure carries none, and is not a rail
           -- record (F-RC-08).
           operation.provider as rail_provider
      from claim_events event
      join claims claim    on claim.id = event.claim_id
      join policies policy on policy.id = claim.policy_id
      left join money_operations operation on operation.id = event.money_operation_id
      left join users author on author.id::text = event.created_by
     where event.recorded_at > ${since}
     order by event.recorded_at desc
     limit ${ROWS_PER_FEED_SOURCE}
  `;
  return rows.map((row) => ({
    kind: "claim" as const,
    instant: row.instant,
    title: row.event_type,
    outcome: row.event_type === "payment_returned" ? "warn" : row.event_type === "payment_settled" ? "ok" : "neutral",
    actor: row.actor ?? "a scheduled job",
    actorIsPerson: row.actor !== null,
    detail: row.note ?? "",
    amountCents: row.amount_cents === null ? null : centsFromDatabase(row.amount_cents, "amount_cents"),
    policyId: row.policy_id,
    claimId: row.claim_id,
    brokerId: row.broker_id,
    customerId: row.customer_id,
    policyNumber: row.policy_number,
    claimNumber: row.claim_number,
    reference: row.claim_number,
    href: `/ops/console/claim/${row.claim_id}`,
    rail: row.rail_provider === null ? null : integrationModeOf(row.rail_provider),
  }));
}

// Maker-checker: the request one person raised and the answer another gave. Two rows, because
// they are two moments and an operator wants to see the gap between them.
async function approvalEvents(database: postgres.Sql, since: Date): Promise<ConsoleEvent[]> {
  const [requests, decisions] = await Promise.all([
    database<
      {
        instant: Date;
        request_id: string;
        kind: string;
        subject_kind: string;
        subject_id: string;
        amount_cents: string;
        destination: string;
        actor: string;
        raised_by_agent: boolean | null;
      }[]
    >`
      select request.recorded_at as instant,
             request.id          as request_id,
             request.kind,
             request.subject_kind,
             request.subject_id,
             request.amount_cents,
             left(request.destination, ${SANITISED_DETAIL_LENGTH}) as destination,
             requester.display_name as actor,
             -- Compared as text, not cast to boolean (review finding F-B13-27): the only writer
             -- (lib/claims/payments.ts) writes a real JSON boolean, an absent key stays null,
             -- and a payload that ever carried something else would raise "invalid input syntax
             -- for type boolean" and take the whole panel down instead of reading false.
             request.payload ->> 'raised_by_agent' = 'true' as raised_by_agent
        from approval_requests request
        join users requester on requester.id = request.requested_by
       where request.recorded_at > ${since}
       order by request.recorded_at desc
       limit ${ROWS_PER_FEED_SOURCE}
    `,
    database<
      {
        instant: Date;
        request_id: string;
        decision: string;
        reason: string | null;
        amount_cents: string;
        subject_kind: string;
        subject_id: string;
        actor: string;
      }[]
    >`
      select decision.recorded_at as instant,
             decision.request_id,
             decision.decision,
             left(decision.reason, ${SANITISED_DETAIL_LENGTH}) as reason,
             request.amount_cents,
             request.subject_kind,
             request.subject_id,
             decider.display_name as actor
        from approval_decisions decision
        join approval_requests request on request.id = decision.request_id
        join users decider on decider.id = decision.decided_by
       where decision.recorded_at > ${since}
       order by decision.recorded_at desc
       limit ${ROWS_PER_FEED_SOURCE}
    `,
  ]);

  const asEvent = (
    instant: Date,
    title: string,
    outcome: ConsoleOutcome,
    actor: string,
    detail: string,
    amountCents: string,
    subjectKind: string,
    subjectId: string,
    reference: string,
  ): ConsoleEvent => ({
    kind: "approval",
    instant,
    title,
    outcome,
    actor,
    actorIsPerson: true,
    detail,
    amountCents: centsFromDatabase(amountCents, "amount_cents"),
    // subject_id names a claim or a policy depending on subject_kind; one column cannot
    // reference two tables (migration 0008), so the kind decides which field it fills.
    policyId: subjectKind === "policy" ? subjectId : null,
    claimId: subjectKind === "claim" ? subjectId : null,
    brokerId: null,
    customerId: null,
    policyNumber: null,
    claimNumber: null,
    reference,
    href: subjectKind === "claim" ? `/ops/console/claim/${subjectId}` : `/ops/console/policy/${subjectId}`,
    // An approval is a decision about money, not a movement of it: no rail (F-RC-08).
    rail: null,
  });

  return [
    ...requests.map((row) =>
      asEvent(
        row.instant,
        `${row.kind} waiting for a second person`,
        "warn",
        row.raised_by_agent ? `${row.actor} (raised by an agent)` : row.actor,
        `to ${row.destination}`,
        row.amount_cents,
        row.subject_kind,
        row.subject_id,
        row.request_id,
      ),
    ),
    ...decisions.map((row) =>
      asEvent(
        row.instant,
        `approval ${row.decision}`,
        row.decision === "approved" ? "ok" : "failed",
        row.actor,
        row.reason ?? "",
        row.amount_cents,
        row.subject_kind,
        row.subject_id,
        row.request_id,
      ),
    ),
  ];
}

// Every reconciliation run, complete or failed. A failed run is a first-class event: it compared
// nothing, and reading its zero counts as "clean" is the mistake the brief forbids.
async function reconciliationEvents(database: postgres.Sql, since: Date): Promise<ConsoleEvent[]> {
  const rows = await database<
    {
      instant: Date;
      run_id: string;
      source: string;
      status: string;
      fetch_error: string | null;
      provider_record_count: number;
      ledger_record_count: number;
      breaks: number;
      actor: string | null;
    }[]
  >`
    select run.finished_at as instant,
           run.id          as run_id,
           run.source,
           run.status,
           left(run.fetch_error, ${SANITISED_DETAIL_LENGTH}) as fetch_error,
           run.provider_record_count,
           run.ledger_record_count,
           (run.local_only_count + run.provider_only_count + run.amount_mismatch_count + run.stale_count) as breaks,
           operator.display_name as actor
      from reconciliation_runs run
      left join users operator on operator.id::text = run.run_by
     where run.finished_at > ${since}
     order by run.finished_at desc
     limit ${ROWS_PER_FEED_SOURCE}
  `;
  return rows.map((row) => ({
    kind: "reconciliation" as const,
    instant: row.instant,
    title: `${row.source} reconciliation ${row.status}`,
    outcome: row.status === "failed" ? "failed" : row.breaks > 0 ? "warn" : "ok",
    actor: row.actor ?? "the daily scheduled job",
    actorIsPerson: row.actor !== null,
    detail:
      row.status === "failed"
        ? `compared nothing: ${row.fetch_error}`
        : `${row.provider_record_count} provider records against ${row.ledger_record_count} ledger records, ${row.breaks} break(s)`,
    amountCents: null,
    policyId: null,
    claimId: null,
    brokerId: null,
    customerId: null,
    policyNumber: null,
    claimNumber: null,
    reference: row.run_id,
    href: "/ops/reconciliation",
    // 'stripe' or 'claims_rail': the run itself says which side it compared.
    rail: integrationModeOf(row.source),
  }));
}

// Broker statements: each run is a document that was published and can never change.
async function statementEvents(database: postgres.Sql, since: Date): Promise<ConsoleEvent[]> {
  const rows = await database<
    {
      instant: Date;
      run_id: string;
      broker_id: string;
      broker_name: string;
      statement_month: string;
      revision: number;
      net_due_cents: string;
      identical_to_previous: boolean;
      actor: string | null;
    }[]
  >`
    select run.created_at as instant,
           run.id         as run_id,
           run.broker_id,
           broker.name    as broker_name,
           to_char(run.statement_month, 'YYYY-MM') as statement_month,
           run.revision,
           run.net_due_cents,
           run.identical_to_previous,
           operator.display_name as actor
      from statement_runs run
      join brokers broker on broker.id = run.broker_id
      left join users operator on operator.id::text = run.run_by
     where run.created_at > ${since}
     order by run.created_at desc
     limit ${ROWS_PER_FEED_SOURCE}
  `;
  return rows.map((row) => ({
    kind: "statement" as const,
    instant: row.instant,
    title: `statement ${row.statement_month} revision ${row.revision}`,
    outcome: "neutral" as const,
    actor: row.actor ?? "a scheduled job",
    actorIsPerson: row.actor !== null,
    detail: `${row.broker_name}${row.identical_to_previous ? " · identical to the previous revision" : ""}`,
    amountCents: centsFromDatabase(row.net_due_cents, "net_due_cents"),
    policyId: null,
    claimId: null,
    brokerId: row.broker_id,
    customerId: null,
    policyNumber: null,
    claimNumber: null,
    reference: row.run_id,
    href: `/statements/${row.run_id}`,
    // Not a rail record: nothing to label (F-RC-08).
    rail: null,
  }));
}

// Every call that reached the MCP endpoint. The arguments are a hash in the table and stay a
// hash here: two calls can be recognised as identical without this screen holding a policy
// number or an amount somebody sent through an agent.
async function mcpEvents(database: postgres.Sql, since: Date): Promise<ConsoleEvent[]> {
  const rows = await database<
    {
      instant: Date;
      method: string;
      tool: string | null;
      outcome: string;
      detail: string | null;
      duration_ms: number;
      key_prefix: string | null;
      principal_kind: string | null;
      holder: string | null;
    }[]
  >`
    select call.called_at as instant,
           call.method,
           call.tool,
           call.outcome,
           left(call.detail, ${SANITISED_DETAIL_LENGTH}) as detail,
           call.duration_ms,
           key.key_prefix,
           key.principal_kind,
           holder.display_name as holder
      from mcp_calls call
      left join mcp_api_keys key on key.id = call.api_key_id
      left join users holder     on holder.id = key.user_id
     where call.called_at > ${since}
     order by call.called_at desc
     limit ${ROWS_PER_FEED_SOURCE}
  `;
  return rows.map((row) => ({
    kind: "mcp" as const,
    instant: row.instant,
    title: row.tool ? `mcp ${row.method} ${row.tool}` : `mcp ${row.method}`,
    outcome: row.outcome === "ok" ? "ok" : row.outcome === "refused" ? "warn" : "failed",
    // The public prefix only. The key itself is never stored, so it can never be shown.
    actor: row.key_prefix
      ? `${row.key_prefix} (${row.principal_kind ?? "unknown"}${row.holder ? `, ${row.holder}` : ""})`
      : "no key, or a key we do not know",
    actorIsPerson: false,
    detail: [`${row.outcome} in ${row.duration_ms} ms`, row.detail].filter(Boolean).join(" · "),
    amountCents: null,
    policyId: null,
    claimId: null,
    brokerId: null,
    customerId: null,
    policyNumber: null,
    claimNumber: null,
    reference: row.key_prefix,
    href: "/ops/mcp-keys",
    // Not a rail record: nothing to label (F-RC-08).
    rail: null,
  }));
}

// Broker business verification: every status Stripe told us, in order.
async function kybEvents(database: postgres.Sql, since: Date): Promise<ConsoleEvent[]> {
  const rows = await database<
    {
      instant: Date;
      broker_id: string;
      broker_name: string;
      provider: string;
      status: string;
      provider_ref: string | null;
      actor: string | null;
    }[]
  >`
    select event.recorded_at as instant,
           event.broker_id,
           broker.name       as broker_name,
           event.provider,
           event.status,
           event.provider_ref,
           author.display_name as actor
      from broker_kyb_events event
      join brokers broker on broker.id = event.broker_id
      left join users author on author.id::text = event.created_by
     where event.recorded_at > ${since}
     order by event.recorded_at desc
     limit ${ROWS_PER_FEED_SOURCE}
  `;
  return rows.map((row) => ({
    kind: "kyb" as const,
    instant: row.instant,
    title: `broker verification ${row.status}`,
    outcome: row.status === "approved" ? "ok" : row.status === "failed" ? "failed" : "warn",
    actor: row.actor ?? row.provider,
    actorIsPerson: row.actor !== null,
    detail: row.broker_name,
    amountCents: null,
    policyId: null,
    claimId: null,
    brokerId: row.broker_id,
    customerId: null,
    policyNumber: null,
    claimNumber: null,
    reference: row.provider_ref,
    href: `/ops/console/broker/${row.broker_id}`,
    // Broker verification is Stripe Connect, a live sandbox, but it moves no money: it is not a
    // rail, so it carries no rail label (F-RC-08).
    rail: null,
  }));
}

// What a customer asked their broker to change on a policy. It moves no money; it is here
// because an unanswered request is work waiting for a person, which is what this screen is for.
async function changeRequestEvents(database: postgres.Sql, since: Date): Promise<ConsoleEvent[]> {
  const rows = await database<
    {
      instant: Date;
      request_id: string;
      policy_id: string;
      policy_number: string;
      broker_id: string;
      customer_id: string;
      lines: string[];
      comment: string;
      actor: string;
      answered: boolean;
    }[]
  >`
    select request.recorded_at as instant,
           request.id          as request_id,
           policy.id           as policy_id,
           policy.policy_number,
           policy.broker_id,
           policy.customer_id,
           request.lines,
           left(request.comment, ${SANITISED_DETAIL_LENGTH}) as comment,
           requester.display_name as actor,
           exists (select 1 from policy_change_request_replies reply where reply.request_id = request.id) as answered
      from policy_change_requests request
      join policies policy on policy.id = request.policy_id
      join users requester on requester.id = request.requested_by
     where request.recorded_at > ${since}
     order by request.recorded_at desc
     limit ${ROWS_PER_FEED_SOURCE}
  `;
  return rows.map((row) => ({
    kind: "change_request" as const,
    instant: row.instant,
    title: row.answered ? "change request, answered" : "change request, open",
    outcome: row.answered ? "ok" : "warn",
    actor: row.actor,
    actorIsPerson: true,
    detail: `${row.lines.join(", ")} · ${row.comment}`,
    amountCents: null,
    policyId: row.policy_id,
    claimId: null,
    brokerId: row.broker_id,
    customerId: row.customer_id,
    policyNumber: row.policy_number,
    claimNumber: null,
    reference: row.request_id,
    href: `/ops/console/policy/${row.policy_id}`,
    // Not a rail record: nothing to label (F-RC-08).
    rail: null,
  }));
}

// A claim page exists for a claim, a policy page for a policy, and nothing for the rest.
function objectHref(claimId: string | null, policyId: string | null): string | null {
  if (claimId) return `/ops/console/claim/${claimId}`;
  if (policyId) return `/ops/console/policy/${policyId}`;
  return null;
}

// ---------------------------------------------------------------------------
// 2. How long things take: percentiles computed by the database
// ---------------------------------------------------------------------------

// One tile of the latency strip. Every duration is in seconds; the screen decides whether to
// print milliseconds or seconds. `sampleCount` is on the tile on purpose: a p95 over two samples
// is not a p95, and a reader has to be able to see that.
export type LatencyTile = {
  name: string;
  measures: string; // the sentence that says exactly which two instants were subtracted
  sampleCount: number;
  p50Seconds: number | null;
  p95Seconds: number | null;
  maxSeconds: number | null;
};

type PercentileRow = { sample_count: number; p50: string | null; p95: string | null; maximum: string | null };

function toTile(name: string, measures: string, row: PercentileRow | undefined): LatencyTile {
  return {
    name,
    measures,
    sampleCount: row?.sample_count ?? 0,
    p50Seconds: row?.p50 === null || row?.p50 === undefined ? null : Number(row.p50),
    p95Seconds: row?.p95 === null || row?.p95 === undefined ? null : Number(row.p95),
    maxSeconds: row?.maximum === null || row?.maximum === undefined ? null : Number(row.maximum),
  };
}

// The five durations this system can actually measure, over the last `windowHours`.
//
// percentile_cont interpolates between the two neighbouring samples, which is what a p95 over a
// small set should do; percentile_disc would return an existing sample and jump. Both are done
// by Postgres, in the query, over the whole window: nothing is transferred row by row and the
// page adds nothing up.
//
// PAIRS AND THE LOOKBACK. The first three tiles subtract two instants that belong to the same
// object. The window is applied to the SECOND instant (the one that finishes the duration), and
// the scan is bounded by LATENCY_LOOKBACK_HOURS before the window so a pair whose first instant
// is older is still complete. A pair whose first instant is older than the lookback is not
// measured at all, and the sample count says so.
export async function latencyTiles(
  database: postgres.Sql,
  windowHours: number = LATENCY_WINDOW_HOURS,
): Promise<LatencyTile[]> {
  const scanHours = windowHours + LATENCY_LOOKBACK_HOURS;

  const [requestedToAccepted, acceptedToSucceeded, webhookReceivedToProcessed, mcpCallDurations, reconciliationDurations] =
    await Promise.all([
      database<PercentileRow[]>`
        with timeline as (
          select operation_id,
                 min(recorded_at) filter (where status = 'requested')         as requested_at,
                 min(recorded_at) filter (where status = 'provider_accepted') as accepted_at
            from money_operation_events
           where recorded_at > now() - make_interval(hours => ${scanHours})
           group by operation_id
        ),
        measured as (
          select extract(epoch from accepted_at - requested_at) as seconds
            from timeline
           where requested_at is not null
             and accepted_at is not null
             and accepted_at >= requested_at
             and accepted_at > now() - make_interval(hours => ${windowHours})
        )
        select count(*)::int                                         as sample_count,
               percentile_cont(0.5)  within group (order by seconds) as p50,
               percentile_cont(0.95) within group (order by seconds) as p95,
               max(seconds)                                          as maximum
          from measured
      `,
      database<PercentileRow[]>`
        with timeline as (
          select operation_id,
                 min(recorded_at) filter (where status = 'provider_accepted') as accepted_at,
                 min(recorded_at) filter (where status = 'succeeded')         as succeeded_at
            from money_operation_events
           where recorded_at > now() - make_interval(hours => ${scanHours})
           group by operation_id
        ),
        measured as (
          select extract(epoch from succeeded_at - accepted_at) as seconds
            from timeline
           where accepted_at is not null
             and succeeded_at is not null
             and succeeded_at >= accepted_at
             and succeeded_at > now() - make_interval(hours => ${windowHours})
        )
        select count(*)::int                                         as sample_count,
               percentile_cont(0.5)  within group (order by seconds) as p50,
               percentile_cont(0.95) within group (order by seconds) as p95,
               max(seconds)                                          as maximum
          from measured
      `,
      // received_at is on the immutable event (set by the database clock, migration 0003);
      // updated_at is on the mutable processing row (migration 0001) and is the instant its
      // status last changed. On a row that reads 'done' that instant IS the end of processing,
      // so the difference is received to processed. It includes every earlier failed attempt of
      // the same event, which is the honest figure for "how long did this event take to land".
      database<PercentileRow[]>`
        with measured as (
          select extract(epoch from processing.updated_at - event.received_at) as seconds
            from webhook_processing processing
            join webhook_events event on event.id = processing.webhook_event_id
           where processing.status = 'done'
             and processing.updated_at > now() - make_interval(hours => ${windowHours})
             and event.received_at     > now() - make_interval(hours => ${scanHours})
             and processing.updated_at >= event.received_at
        )
        select count(*)::int                                         as sample_count,
               percentile_cont(0.5)  within group (order by seconds) as p50,
               percentile_cont(0.95) within group (order by seconds) as p95,
               max(seconds)                                          as maximum
          from measured
      `,
      // The endpoint measures itself and stores the figure (migration 0018), so there is
      // nothing to subtract here: the column is read and divided into seconds.
      database<PercentileRow[]>`
        select count(*)::int                                                      as sample_count,
               percentile_cont(0.5)  within group (order by duration_ms) / 1000.0 as p50,
               percentile_cont(0.95) within group (order by duration_ms) / 1000.0 as p95,
               max(duration_ms) / 1000.0                                          as maximum
          from mcp_calls
         where called_at > now() - make_interval(hours => ${windowHours})
      `,
      // started_at is the application clock before the provider was called, finished_at the
      // database clock when the result was stored (migration 0011), so this is the whole run.
      database<PercentileRow[]>`
        with measured as (
          select extract(epoch from finished_at - started_at) as seconds
            from reconciliation_runs
           where finished_at > now() - make_interval(hours => ${windowHours})
             and finished_at >= started_at
        )
        select count(*)::int                                         as sample_count,
               percentile_cont(0.5)  within group (order by seconds) as p50,
               percentile_cont(0.95) within group (order by seconds) as p95,
               max(seconds)                                          as maximum
          from measured
      `,
    ]);

  return [
    toTile(
      "Request to provider acceptance",
      "money_operation_events: the 'requested' row written before the provider is called, to the 'provider_accepted' row written when it answers",
      requestedToAccepted[0],
    ),
    toTile(
      "Provider acceptance to success",
      "money_operation_events: 'provider_accepted' to 'succeeded', which for a Stripe payment is the wait for payment_intent.succeeded",
      acceptedToSucceeded[0],
    ),
    toTile(
      "Webhook received to processed",
      "webhook_events.received_at to webhook_processing.updated_at on the rows that read 'done', retries included",
      webhookReceivedToProcessed[0],
    ),
    toTile("MCP call", "mcp_calls.duration_ms, measured by the endpoint itself", mcpCallDurations[0]),
    toTile(
      "Reconciliation run",
      "reconciliation_runs.started_at to finished_at, the whole run including the provider fetch",
      reconciliationDurations[0],
    ),
  ];
}

// ---------------------------------------------------------------------------
// 3. What is broken, and what is still being checked
// ---------------------------------------------------------------------------

// The recovery action a row offers. Every one of them is a form or a screen that ALREADY exists:
// this slice adds no write route of its own.
export type RecoveryAction =
  | { kind: "reconcile" } // the "Run now" form of /ops/reconciliation, posting to /api/jobs/reconcile
  | { kind: "kyb-recheck"; brokerId: string; brokerName: string } // the form of /ops/brokers
  | { kind: "link"; href: string; label: string } // an existing screen, the claim page above all
  | { kind: "none"; why: string };

export type ProblemFamily = "money" | "webhook" | "mcp" | "reconciliation" | "unknown_outcome";

export type OperationsProblem = {
  family: ProblemFamily;
  instant: Date;
  // The rail this problem is about, when it is about one at all (F-RC-08).
  rail: IntegrationMode | null;
  title: string;
  detail: string;
  reference: string | null;
  ageMinutes: number;
  recovery: RecoveryAction;
};

export type OperationInFlight = {
  operationId: string;
  kind: string;
  // The rail the money is sitting on while we wait (F-RC-08).
  rail: IntegrationMode;
  amountCents: number;
  providerRef: string | null;
  acceptedAt: Date;
  ageMinutes: number;
  policyId: string | null;
  claimId: string | null;
  policyNumber: string | null;
  claimNumber: string | null;
};

// Operations the provider accepted and that have said nothing since. Under the threshold they
// are being checked; at or over it they are an unknown outcome and a human has to resolve them.
// ONE query, split in TypeScript, so the two lists can never disagree about the same operation.
// `thresholdMinutes` is a parameter rather than a constant read inside, for one reason: it lets
// the check script prove BOTH branches of the rule on a real row. A fixture operation cannot be
// made sixteen minutes old, because recorded_at is set by the database clock and can never be
// written by a client (migration 0002); running the same reader with a threshold of 0 and with
// the real threshold proves the split without backdating anything.
//
// `since` bounds the query in time, and it is the correction of review finding F-B13-23. The CTE
// used to reduce the WHOLE money_operation_events table before the outer limit was applied, so
// its cost grew with every event ever written. It now reads only the events of the window the
// operator asked for, widened by the threshold: an operation accepted `thresholdMinutes` before
// the window opened is the oldest one that can still become an unknown outcome inside it, so
// that margin is exactly what the rule needs and nothing more. Anything older than the window is
// not "in flight" any more, it is a stale operation that /api/jobs/recover-operations owns.
export async function acceptedAndUnconfirmedOperations(
  database: postgres.Sql,
  {
    since,
    limit = 50,
    thresholdMinutes = UNKNOWN_OUTCOME_AFTER_MINUTES,
  }: { since: Date; limit?: number; thresholdMinutes?: number },
): Promise<{ checking: OperationInFlight[]; unknownOutcome: OperationInFlight[] }> {
  const acceptedAfter = new Date(since.getTime() - thresholdMinutes * 60_000);
  const rows = await database<
    {
      operation_id: string;
      kind: string;
      provider: string;
      amount_cents: string;
      provider_ref: string | null;
      accepted_at: Date;
      age_minutes: string;
      policy_id: string | null;
      claim_id: string | null;
      policy_number: string | null;
      claim_number: string | null;
    }[]
  >`
    with latest as (
      -- The last row of each operation's history, by its total order, WITHIN THE WINDOW.
      -- distinct on is the index-friendly way to ask that question: money_operation_events
      -- carries the index (operation_id, sequence_number) since migration 0002.
      --
      -- The time bound is not an approximation. A row that survives it is an acceptance
      -- recorded inside the window with nothing after it, and any later event of that same
      -- operation would necessarily be inside the window too, because events only move forward.
      -- So this reads exactly "accepted during this window and silent since".
      select distinct on (operation_id)
             operation_id, status, recorded_at, provider_ref
        from money_operation_events
       where recorded_at > ${acceptedAfter}
       order by operation_id, sequence_number desc
    )
    select operation.id       as operation_id,
           operation.kind,
           operation.provider,
           operation.amount_cents,
           latest.provider_ref,
           latest.recorded_at as accepted_at,
           floor(extract(epoch from now() - latest.recorded_at) / 60)::text as age_minutes,
           operation.policy_id,
           operation.claim_id,
           policy.policy_number,
           claim.claim_number
      from latest
      join money_operations operation on operation.id = latest.operation_id
      left join claims claim    on claim.id = operation.claim_id
      left join policies policy on policy.id = coalesce(operation.policy_id, claim.policy_id)
     where latest.status = 'provider_accepted'
     order by latest.recorded_at
     limit ${limit}
  `;

  const all: OperationInFlight[] = rows.map((row) => ({
    operationId: row.operation_id,
    kind: row.kind,
    rail: integrationModeOf(row.provider),
    amountCents: centsFromDatabase(row.amount_cents, "amount_cents"),
    providerRef: row.provider_ref,
    acceptedAt: row.accepted_at,
    ageMinutes: Number(row.age_minutes),
    policyId: row.policy_id,
    claimId: row.claim_id,
    policyNumber: row.policy_number,
    claimNumber: row.claim_number,
  }));

  return {
    checking: all.filter((operation) => operation.ageMinutes < thresholdMinutes),
    unknownOutcome: all.filter((operation) => operation.ageMinutes >= thresholdMinutes),
  };
}

// Everything that failed or was refused since `since`, plus the operations whose outcome is
// unknown. Four bounded queries, merged newest first.
//
// `unknownOutcome` is passed in rather than read here, and that is the second half of review
// finding F-B13-23: this function used to call acceptedAndUnconfirmedOperations itself while the
// page called it too, so the feed page read the same table twice on every one of its ten-second
// refreshes. The caller reads it once and hands the same rows to both panels, which also means
// the two panels can never disagree about the same operation.
export async function operationsProblems(
  database: postgres.Sql,
  { since, limit = 60, unknownOutcome }: { since: Date; limit?: number; unknownOutcome: OperationInFlight[] },
): Promise<OperationsProblem[]> {
  const [failedOperations, webhookTrouble, mcpTrouble, failedRuns] = await Promise.all([
    // A provider failure, or an operation the recovery job could not resolve either way.
    database<
      {
        instant: Date;
        status: string;
        operation_kind: string;
        provider: string;
        reason: string | null;
        provider_ref: string | null;
        policy_id: string | null;
        claim_id: string | null;
        broker_id: string | null;
        broker_name: string | null;
        kyb_status: string | null;
        age_minutes: string;
      }[]
    >`
      select event.recorded_at as instant,
             event.status,
             operation.kind    as operation_kind,
             operation.provider,
             left(coalesce(event.payload ->> 'reason', event.payload ->> 'binding_refused_reason'),
                  ${SANITISED_DETAIL_LENGTH}) as reason,
             event.provider_ref,
             operation.policy_id,
             operation.claim_id,
             policy.broker_id,
             broker.name       as broker_name,
             kyb.status        as kyb_status,
             floor(extract(epoch from now() - event.recorded_at) / 60)::text as age_minutes
        from money_operation_events event
        join money_operations operation on operation.id = event.operation_id
        left join claims claim    on claim.id = operation.claim_id
        left join policies policy on policy.id = coalesce(operation.policy_id, claim.policy_id)
        left join brokers broker  on broker.id = policy.broker_id
        left join lateral (
          select status from broker_kyb_events
           where broker_id = policy.broker_id
           order by sequence_number desc
           limit 1
        ) kyb on true
       where event.status in ('failed', 'unknown')
         and event.recorded_at > ${since}
       order by event.recorded_at desc
       limit ${limit}
    `,
    // A processing row that failed, was ignored, or needed more than one attempt. A retry is
    // not yet a failure, and it is exactly what an operator wants to see before it becomes one.
    database<
      {
        instant: Date;
        event_type: string;
        provider: string;
        provider_event_id: string;
        status: string;
        attempts: number;
        last_error: string | null;
        age_minutes: string;
      }[]
    >`
      select processing.updated_at as instant,
             event.event_type,
             event.provider,
             event.provider_event_id,
             processing.status,
             processing.attempts,
             left(processing.last_error, ${SANITISED_DETAIL_LENGTH}) as last_error,
             floor(extract(epoch from now() - processing.updated_at) / 60)::text as age_minutes
        from webhook_processing processing
        join webhook_events event on event.id = processing.webhook_event_id
       where processing.updated_at > ${since}
         and (processing.status in ('failed', 'ignored') or processing.attempts > 1)
       order by processing.updated_at desc
       limit ${limit}
    `,
    // An agent or a person asked the endpoint for something it would not do, or something broke
    // on our side. 'unauthorised' is deliberately not here: it is a caller with no valid key,
    // it belongs to the feed under the mcp kind, and there is nothing for an operator to repair.
    database<
      { instant: Date; method: string; tool: string | null; outcome: string; detail: string | null; key_prefix: string | null; age_minutes: string }[]
    >`
      select call.called_at as instant,
             call.method,
             call.tool,
             call.outcome,
             left(call.detail, ${SANITISED_DETAIL_LENGTH}) as detail,
             key.key_prefix,
             floor(extract(epoch from now() - call.called_at) / 60)::text as age_minutes
        from mcp_calls call
        left join mcp_api_keys key on key.id = call.api_key_id
       where call.outcome in ('error', 'refused')
         and call.called_at > ${since}
       order by call.called_at desc
       limit ${limit}
    `,
    database<{ instant: Date; source: string; fetch_error: string | null; age_minutes: string }[]>`
      select run.finished_at as instant,
             run.source,
             left(run.fetch_error, ${SANITISED_DETAIL_LENGTH}) as fetch_error,
             floor(extract(epoch from now() - run.finished_at) / 60)::text as age_minutes
        from reconciliation_runs run
       where run.status = 'failed'
         and run.finished_at > ${since}
       order by run.finished_at desc
       limit ${limit}
    `,
  ]);

  const problems: OperationsProblem[] = [
    ...failedOperations.map((row) => ({
      family: "money" as const,
      instant: row.instant,
      rail: integrationModeOf(row.provider),
      title: `${row.operation_kind} ${row.status}`,
      detail: row.reason ?? "no reason was recorded on the event",
      reference: row.provider_ref,
      ageMinutes: Number(row.age_minutes),
      recovery: recoveryForFailedOperation(row),
    })),
    ...webhookTrouble.map((row) => ({
      family: "webhook" as const,
      instant: row.instant,
      rail: integrationModeOf(row.provider),
      title: `${row.provider} ${row.event_type} ${row.status}`,
      detail: describeWebhookProcessing(row.status, row.attempts, row.last_error),
      reference: row.provider_event_id,
      ageMinutes: Number(row.age_minutes),
      // There is no replay screen in this build. Stripe retries a 500 on its own, and a person
      // can resend the event from Stripe's dashboard; what the console offers is the lookup.
      recovery: {
        kind: "link" as const,
        href: `/ops/console/search?reference=${encodeURIComponent(row.provider_event_id)}`,
        label: "look this event up",
      },
    })),
    ...mcpTrouble.map((row) => ({
      family: "mcp" as const,
      instant: row.instant,
      // An MCP call is a request to this application, not a movement on a rail.
      rail: null,
      title: `mcp ${row.tool ?? row.method} ${row.outcome}`,
      detail: [row.key_prefix ?? "no key", row.detail].filter(Boolean).join(" · "),
      reference: row.key_prefix,
      ageMinutes: Number(row.age_minutes),
      recovery: { kind: "link" as const, href: "/ops/mcp-keys", label: "MCP keys" },
    })),
    ...failedRuns.map((row) => ({
      family: "reconciliation" as const,
      instant: row.instant,
      rail: integrationModeOf(row.source),
      title: `${row.source} reconciliation failed`,
      detail: row.fetch_error ?? "no error was recorded",
      reference: row.source,
      ageMinutes: Number(row.age_minutes),
      recovery: { kind: "reconcile" as const },
    })),
    ...unknownOutcome.map((operation) => ({
      family: "unknown_outcome" as const,
      instant: operation.acceptedAt,
      rail: operation.rail,
      title: `${operation.kind} accepted and unconfirmed`,
      detail: `the provider accepted it ${operation.ageMinutes} minutes ago and has said nothing since; past ${UNKNOWN_OUTCOME_AFTER_MINUTES} minutes this build calls the outcome unknown`,
      reference: operation.providerRef,
      ageMinutes: operation.ageMinutes,
      recovery: operation.claimId
        ? { kind: "link" as const, href: `/ops/claims/${operation.claimId}`, label: `claim ${operation.claimNumber ?? ""}`.trim() }
        : operation.policyId
          ? { kind: "link" as const, href: `/policies/${operation.policyId}`, label: `policy ${operation.policyNumber ?? ""}`.trim() }
          : { kind: "none" as const, why: "the operation names no policy and no claim" },
    })),
  ];

  return problems.sort((older, newer) => newer.instant.getTime() - older.instant.getTime()).slice(0, limit);
}

function recoveryForFailedOperation(row: {
  claim_id: string | null;
  policy_id: string | null;
  broker_id: string | null;
  broker_name: string | null;
  kyb_status: string | null;
}): RecoveryAction {
  // A claim payout is re-sent from the claim page, which owns the send form and its approval.
  if (row.claim_id) {
    return { kind: "link", href: `/ops/claims/${row.claim_id}`, label: "the claim page, where the send form lives" };
  }
  // A policy payment blocked because the broker is not approved is unblocked by re-reading the
  // verification at Stripe, which is the form the brokers page owns.
  if (row.broker_id && row.kyb_status !== "approved") {
    return { kind: "kyb-recheck", brokerId: row.broker_id, brokerName: row.broker_name ?? "this broker" };
  }
  if (row.policy_id) {
    return { kind: "link", href: `/policies/${row.policy_id}`, label: "the policy page" };
  }
  return { kind: "none", why: "no screen of this build acts on this operation" };
}

// ---------------------------------------------------------------------------
// 4. The reference search
// ---------------------------------------------------------------------------

// What a reference turned out to be. `consoleHref` is the 360 page of the object;
// `existingHref` is the ordinary screen a person already knows.
export type ReferenceMatch = {
  what: string; // "Stripe PaymentIntent", "policy", "MCP key", ...
  label: string; // the human name of the thing found
  consoleHref: string | null;
  existingHref: string | null;
  facts: { label: string; value: string; sensitive?: boolean }[];
};

export type ReferenceSearch = {
  reference: string;
  recognisedAs: string; // what the shape of the text says it is, before any lookup
  matches: ReferenceMatch[];
  trail: ConsoleEvent[]; // the life of the object, newest first
};

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const POLICY_NUMBER_SHAPE = /^CGP-\d{1,10}$/i;
const CLAIM_NUMBER_SHAPE = /^CLM-\d{1,10}$/i;
const STRIPE_OBJECT_SHAPE = /^(pi|cs|re|acct)_[A-Za-z0-9_]{1,80}$/;
const MCP_KEY_PREFIX_SHAPE = /^cmk_[0-9a-f]{8}$/;

// What the text looks like, before the database is asked anything. Saying this on the screen is
// how an operator understands "found nothing": the shape was recognised and no row matched, or
// the shape was not recognised at all.
export function recogniseReference(raw: string): string {
  const reference = raw.trim();
  if (reference === "") return "nothing typed";
  if (STRIPE_OBJECT_SHAPE.test(reference)) {
    const prefix = reference.slice(0, reference.indexOf("_"));
    return {
      pi: "a Stripe PaymentIntent (pi_)",
      cs: "a Stripe Checkout Session (cs_)",
      re: "a Stripe Refund (re_)",
      acct: "a Stripe connected account (acct_)",
    }[prefix] as string;
  }
  if (MCP_KEY_PREFIX_SHAPE.test(reference)) return "the public prefix of an MCP API key (cmk_)";
  if (POLICY_NUMBER_SHAPE.test(reference)) return "a policy number (CGP-)";
  if (CLAIM_NUMBER_SHAPE.test(reference)) return "a claim number (CLM-)";
  if (EMAIL_SHAPE.test(reference)) return "an email address";
  if (UUID_SHAPE.test(reference)) return "an identifier of this application (uuid)";
  return "a shape this search does not recognise";
}

// The search itself. Every branch is bounded, and the trail is the object's own events read
// through the scoped readers, never the whole feed filtered in memory.
export async function resolveReference(database: postgres.Sql, raw: string): Promise<ReferenceSearch> {
  const reference = raw.trim();
  const recognisedAs = recogniseReference(reference);
  const empty: ReferenceSearch = { reference, recognisedAs, matches: [], trail: [] };
  if (reference === "" || reference.length > 200) {
    return empty;
  }

  if (STRIPE_OBJECT_SHAPE.test(reference)) {
    return reference.startsWith("acct_")
      ? { ...empty, ...(await byConnectedAccount(database, reference)) }
      : { ...empty, ...(await byStripeObject(database, reference)) };
  }
  if (MCP_KEY_PREFIX_SHAPE.test(reference)) {
    return { ...empty, ...(await byMcpKeyPrefix(database, reference)) };
  }
  if (POLICY_NUMBER_SHAPE.test(reference)) {
    const [row] = await database<{ id: string }[]>`
      select id from policies where policy_number = ${reference.toUpperCase()} limit 1
    `;
    return row ? { ...empty, ...(await policyMatch(database, row.id)) } : empty;
  }
  if (CLAIM_NUMBER_SHAPE.test(reference)) {
    const [row] = await database<{ id: string }[]>`
      select id from claims where claim_number = ${reference.toUpperCase()} limit 1
    `;
    return row ? { ...empty, ...(await claimMatch(database, row.id)) } : empty;
  }
  if (EMAIL_SHAPE.test(reference)) {
    return { ...empty, ...(await byEmail(database, reference)) };
  }
  if (UUID_SHAPE.test(reference)) {
    return { ...empty, ...(await byUuid(database, reference)) };
  }
  return empty;
}

// pi_, cs_ and re_ all live in the same column: money_operation_events.provider_ref. One query
// finds the operation, and the operation names the policy or the claim.
async function byStripeObject(
  database: postgres.Sql,
  reference: string,
): Promise<Pick<ReferenceSearch, "matches" | "trail">> {
  const [row] = await database<
    { operation_id: string; kind: string; amount_cents: string; policy_id: string | null; claim_id: string | null }[]
  >`
    select operation.id as operation_id, operation.kind, operation.amount_cents,
           operation.policy_id, operation.claim_id
      from money_operation_events event
      join money_operations operation on operation.id = event.operation_id
     where event.provider_ref = ${reference}
     order by event.sequence_number
     limit 1
  `;
  if (!row) {
    // A reference Stripe sent us but that no operation carries: it can still be in the inbox,
    // which is exactly the case an operator is chasing when a webhook arrived for nothing.
    return webhookOnlyMatch(database, reference);
  }
  const object = row.claim_id ? await claimMatch(database, row.claim_id) : row.policy_id ? await policyMatch(database, row.policy_id) : null;
  const operationMatch: ReferenceMatch = {
    what: `Stripe reference on a ${row.kind} money operation`,
    label: reference,
    consoleHref: row.claim_id ? `/ops/console/claim/${row.claim_id}` : row.policy_id ? `/ops/console/policy/${row.policy_id}` : null,
    existingHref: row.claim_id ? `/ops/claims/${row.claim_id}` : row.policy_id ? `/policies/${row.policy_id}` : null,
    facts: [{ label: "Money operation", value: row.operation_id }],
  };
  return {
    matches: [operationMatch, ...(object?.matches ?? [])],
    trail: object?.trail ?? [],
  };
}

// A Stripe reference that reached the inbox and matched no operation of ours.
async function webhookOnlyMatch(
  database: postgres.Sql,
  reference: string,
): Promise<Pick<ReferenceSearch, "matches" | "trail">> {
  const rows = await database<{ id: string; event_type: string; received_at: Date; status: string | null; attempts: number | null; last_error: string | null }[]>`
    select event.id, event.event_type, event.received_at,
           processing.status, processing.attempts,
           left(processing.last_error, ${SANITISED_DETAIL_LENGTH}) as last_error
      from webhook_events event
      left join webhook_processing processing on processing.webhook_event_id = event.id
     where event.provider_event_id = ${reference}
        or event.payload -> 'data' -> 'object' ->> 'id' = ${reference}
     order by event.received_at desc
     limit 20
  `;
  if (rows.length === 0) {
    return { matches: [], trail: [] };
  }
  return {
    matches: [
      {
        what: "provider events in the webhook inbox, with no money operation of ours",
        label: reference,
        consoleHref: null,
        existingHref: null,
        facts: [{ label: "Events stored", value: String(rows.length) }],
      },
    ],
    trail: rows.map((row) => ({
      kind: "webhook" as const,
      instant: row.received_at,
      title: row.event_type,
      outcome: webhookOutcome(row.status),
      actor: "stripe",
      actorIsPerson: false,
      detail: describeWebhookProcessing(row.status, row.attempts, row.last_error),
      amountCents: null,
      policyId: null,
      claimId: null,
      brokerId: null,
      customerId: null,
      policyNumber: null,
      claimNumber: null,
      reference,
      href: null,
      // Every row of the webhook inbox is a Stripe event (migration 0001).
      rail: integrationModeOf("stripe"),
    })),
  };
}

// acct_ is a connected account: it lives on broker_kyb_events.provider_ref.
async function byConnectedAccount(
  database: postgres.Sql,
  reference: string,
): Promise<Pick<ReferenceSearch, "matches" | "trail">> {
  const [row] = await database<{ broker_id: string }[]>`
    select broker_id from broker_kyb_events where provider_ref = ${reference} order by sequence_number desc limit 1
  `;
  return row ? brokerMatch(database, row.broker_id) : { matches: [], trail: [] };
}

async function byMcpKeyPrefix(
  database: postgres.Sql,
  reference: string,
): Promise<Pick<ReferenceSearch, "matches" | "trail">> {
  const [key] = await database<
    { id: string; label: string; principal_kind: string; holder: string; holder_role: string; created_at: Date; revoked_at: Date | null }[]
  >`
    select key.id, key.label, key.principal_kind, holder.display_name as holder, holder.role as holder_role,
           key.created_at, revocation.recorded_at as revoked_at
      from mcp_api_keys key
      join users holder on holder.id = key.user_id
      left join mcp_key_revocations revocation on revocation.api_key_id = key.id
     where key.key_prefix = ${reference}
     limit 1
  `;
  if (!key) {
    return { matches: [], trail: [] };
  }
  const calls = await database<
    { instant: Date; method: string; tool: string | null; outcome: string; detail: string | null; duration_ms: number }[]
  >`
    select called_at as instant, method, tool, outcome,
           left(detail, ${SANITISED_DETAIL_LENGTH}) as detail, duration_ms
      from mcp_calls
     where api_key_id = ${key.id}
     order by called_at desc
     limit 50
  `;
  return {
    matches: [
      {
        what: "MCP API key",
        label: `${reference} · ${key.label}`,
        consoleHref: null,
        existingHref: "/ops/mcp-keys",
        facts: [
          { label: "Principal", value: key.principal_kind },
          { label: "Whose visibility it borrows", value: `${key.holder} (${key.holder_role})`, sensitive: true },
          { label: "Created", value: key.created_at.toISOString() },
          { label: "Revoked", value: key.revoked_at ? key.revoked_at.toISOString() : "not revoked" },
        ],
      },
    ],
    trail: calls.map((call) => ({
      kind: "mcp" as const,
      instant: call.instant,
      title: call.tool ? `${call.method} ${call.tool}` : call.method,
      outcome: call.outcome === "ok" ? "ok" : call.outcome === "refused" ? "warn" : "failed",
      actor: reference,
      actorIsPerson: false,
      detail: [`${call.outcome} in ${call.duration_ms} ms`, call.detail].filter(Boolean).join(" · "),
      amountCents: null,
      policyId: null,
      claimId: null,
      brokerId: null,
      customerId: null,
      policyNumber: null,
      claimNumber: null,
      reference,
      href: "/ops/mcp-keys",
      // Not a rail record: nothing to label (F-RC-08).
      rail: null,
    })),
  };
}

// An email is a customer or a sign-in account. Both are looked up: a staff member chasing an
// address wants to know which of the two it is.
async function byEmail(database: postgres.Sql, reference: string): Promise<Pick<ReferenceSearch, "matches" | "trail">> {
  const address = reference.toLowerCase();
  const [customers, users] = await Promise.all([
    database<{ id: string; name: string; email: string }[]>`
      select id, name, email from customers where lower(email) = ${address} limit 5
    `,
    database<{ id: string; display_name: string; role: string; broker_id: string | null; customer_id: string | null }[]>`
      select id, display_name, role, broker_id, customer_id from users where lower(email) = ${address} limit 5
    `,
  ]);

  const matches: ReferenceMatch[] = [
    ...customers.map((customer) => ({
      what: "customer",
      label: customer.name,
      consoleHref: `/ops/console/customer/${customer.id}`,
      existingHref: null,
      facts: [{ label: "Email", value: customer.email, sensitive: true }],
    })),
    ...users.map((user) => ({
      what: `sign-in account (${user.role})`,
      label: user.display_name,
      // A sign-in account is not itself an object of the money model: the 360 page it points at
      // is the broker or the customer it acts for, when it has one.
      consoleHref: user.broker_id
        ? `/ops/console/broker/${user.broker_id}`
        : user.customer_id
          ? `/ops/console/customer/${user.customer_id}`
          : null,
      existingHref: null,
      facts: [{ label: "User id", value: user.id }],
    })),
  ];
  // The trail of the first customer found, which is the case an operator is almost always in.
  const first = customers[0];
  return { matches, trail: first ? (await customerMatch(database, first.id)).trail : [] };
}

async function byUuid(database: postgres.Sql, reference: string): Promise<Pick<ReferenceSearch, "matches" | "trail">> {
  // Each table is asked once, by primary key, and the first hit wins. Seven tiny index lookups
  // are cheaper and far more readable than one query trying to be clever about which it is.
  const [policy] = await database<{ id: string }[]>`select id from policies where id = ${reference}`;
  if (policy) return policyMatch(database, policy.id);

  const [claim] = await database<{ id: string }[]>`select id from claims where id = ${reference}`;
  if (claim) return claimMatch(database, claim.id);

  const [customer] = await database<{ id: string }[]>`select id from customers where id = ${reference}`;
  if (customer) return customerMatch(database, customer.id);

  const [broker] = await database<{ id: string }[]>`select id from brokers where id = ${reference}`;
  if (broker) return brokerMatch(database, broker.id);

  const [operation] = await database<{ id: string; policy_id: string | null; claim_id: string | null }[]>`
    select id, policy_id, claim_id from money_operations where id = ${reference}
  `;
  if (operation) {
    return operation.claim_id
      ? claimMatch(database, operation.claim_id)
      : operation.policy_id
        ? policyMatch(database, operation.policy_id)
        : { matches: [], trail: [] };
  }

  const [entry] = await database<{ id: string; policy_id: string | null; claim_id: string | null }[]>`
    select id, policy_id, claim_id from journal_entries where id = ${reference}
  `;
  if (entry) {
    return entry.claim_id
      ? claimMatch(database, entry.claim_id)
      : entry.policy_id
        ? policyMatch(database, entry.policy_id)
        : { matches: [], trail: [] };
  }

  const [run] = await database<{ id: string; broker_id: string }[]>`
    select id, broker_id from statement_runs where id = ${reference}
  `;
  if (run) {
    const broker = await brokerMatch(database, run.broker_id);
    return {
      matches: [
        {
          what: "broker statement run",
          label: reference,
          consoleHref: `/ops/console/broker/${run.broker_id}`,
          existingHref: `/statements/${run.id}`,
          facts: [],
        },
        ...broker.matches,
      ],
      trail: broker.trail,
    };
  }
  return { matches: [], trail: [] };
}

// The four object matches, each of them "the identity band plus the object's own trail". They
// are written in terms of consoleSubject and subjectTimeline below, so the search and the 360
// pages can never disagree about what an object is or about what happened to it.
async function policyMatch(database: postgres.Sql, policyId: string) {
  return matchFor(database, "policy", policyId);
}
async function claimMatch(database: postgres.Sql, claimId: string) {
  return matchFor(database, "claim", claimId);
}
async function customerMatch(database: postgres.Sql, customerId: string) {
  return matchFor(database, "customer", customerId);
}
async function brokerMatch(database: postgres.Sql, brokerId: string) {
  return matchFor(database, "broker", brokerId);
}

async function matchFor(
  database: postgres.Sql,
  kind: ConsoleSubjectKind,
  id: string,
): Promise<Pick<ReferenceSearch, "matches" | "trail">> {
  const subject = await consoleSubject(database, kind, id);
  if (!subject) {
    return { matches: [], trail: [] };
  }
  return {
    matches: [
      {
        what: kind,
        label: subject.title,
        consoleHref: subject.consoleHref,
        existingHref: subject.existingHref,
        facts: subject.identity,
      },
    ],
    trail: await subjectTimeline(database, subject),
  };
}

// ---------------------------------------------------------------------------
// 5. One object, seen from every table: the 360 pages
// ---------------------------------------------------------------------------

export type ConsoleSubjectKind = "customer" | "broker" | "policy" | "claim";

// The identity band of a 360 page, and the ids every panel below is scoped by. Reading the
// policy ids and claim ids ONCE, here, is what keeps the panels free of N+1: each of them runs
// a single query over `= any(<the list>)`.
export type ConsoleSubject = {
  kind: ConsoleSubjectKind;
  id: string;
  title: string;
  lead: string;
  identity: { label: string; value: string; sensitive?: boolean }[];
  consoleHref: string;
  existingHref: string | null;
  policyIds: string[];
  claimIds: string[];
  brokerId: string | null;
  customerId: string | null;
};

// How many policies and claims one 360 page will ever scope itself by. A broker with more is
// shown the newest ones and told so, rather than being served an unbounded query.
export const MOST_POLICIES_ON_A_360_PAGE = 200;
export const MOST_CLAIMS_ON_A_360_PAGE = 200;

export async function consoleSubject(
  database: postgres.Sql,
  kind: ConsoleSubjectKind,
  id: string,
): Promise<ConsoleSubject | null> {
  if (kind === "policy") return policySubject(database, id);
  if (kind === "claim") return claimSubject(database, id);
  if (kind === "customer") return customerSubject(database, id);
  return brokerSubject(database, id);
}

async function policySubject(database: postgres.Sql, policyId: string): Promise<ConsoleSubject | null> {
  const [row] = await database<
    {
      id: string;
      policy_number: string;
      state_code: string;
      broker_id: string;
      broker_name: string;
      customer_id: string;
      customer_name: string;
      customer_email: string;
      created_at: Date;
      status: string | null;
      effective_at: string | null;
      term_end: string | null;
    }[]
  >`
    select policy.id, policy.policy_number, policy.state_code,
           policy.broker_id, broker.name as broker_name,
           policy.customer_id, customer.name as customer_name, customer.email as customer_email,
           policy.created_at,
           current_policy.status,
           to_char(current_policy.effective_at, 'YYYY-MM-DD') as effective_at,
           to_char(current_policy.term_end, 'YYYY-MM-DD')     as term_end
      from policies policy
      join brokers broker     on broker.id = policy.broker_id
      join customers customer on customer.id = policy.customer_id
      -- policy_current is a rebuildable cache (migration 0002), never a money truth. It is
      -- joined LEFT because a policy that has only been created has no cached row yet.
      left join policy_current current_policy on current_policy.policy_id = policy.id
     where policy.id = ${policyId}
  `;
  if (!row) return null;

  const claims = await database<{ id: string }[]>`
    select id from claims where policy_id = ${policyId} order by recorded_at desc limit ${MOST_CLAIMS_ON_A_360_PAGE}
  `;
  return {
    kind: "policy",
    id: row.id,
    title: `Policy ${row.policy_number}`,
    lead: `${row.customer_name} · broker ${row.broker_name} · ${row.state_code}`,
    identity: [
      { label: "Status (cache)", value: row.status ?? "no cached status" },
      { label: "Term", value: row.effective_at && row.term_end ? `${row.effective_at} to ${row.term_end}` : "not bound" },
      { label: "Customer", value: row.customer_name, sensitive: true },
      { label: "Customer email", value: row.customer_email, sensitive: true },
      { label: "Broker", value: row.broker_name },
      { label: "State", value: row.state_code },
      { label: "Created", value: row.created_at.toISOString() },
    ],
    consoleHref: `/ops/console/policy/${row.id}`,
    existingHref: `/policies/${row.id}`,
    policyIds: [row.id],
    claimIds: claims.map((claim) => claim.id),
    brokerId: row.broker_id,
    customerId: row.customer_id,
  };
}

async function claimSubject(database: postgres.Sql, claimId: string): Promise<ConsoleSubject | null> {
  const [row] = await database<
    {
      id: string;
      claim_number: string;
      claimant_name: string;
      occurred_at: string;
      reported_at: string;
      description: string;
      policy_id: string;
      policy_number: string;
      broker_id: string;
      customer_id: string;
      recorded_at: Date;
    }[]
  >`
    select claim.id, claim.claim_number, claim.claimant_name,
           to_char(claim.occurred_at, 'YYYY-MM-DD') as occurred_at,
           to_char(claim.reported_at, 'YYYY-MM-DD') as reported_at,
           left(claim.description, ${SANITISED_DETAIL_LENGTH}) as description,
           policy.id as policy_id, policy.policy_number, policy.broker_id, policy.customer_id,
           claim.recorded_at
      from claims claim
      join policies policy on policy.id = claim.policy_id
     where claim.id = ${claimId}
  `;
  if (!row) return null;
  return {
    kind: "claim",
    id: row.id,
    title: `Claim ${row.claim_number}`,
    lead: `policy ${row.policy_number} · loss on ${row.occurred_at} · reported ${row.reported_at}`,
    identity: [
      { label: "Claimant", value: row.claimant_name, sensitive: true },
      { label: "Loss", value: row.occurred_at },
      { label: "Reported", value: row.reported_at },
      { label: "Policy", value: row.policy_number },
      { label: "Opened", value: row.recorded_at.toISOString() },
      { label: "Description", value: row.description },
    ],
    consoleHref: `/ops/console/claim/${row.id}`,
    existingHref: `/ops/claims/${row.id}`,
    policyIds: [row.policy_id],
    claimIds: [row.id],
    brokerId: row.broker_id,
    customerId: row.customer_id,
  };
}

async function customerSubject(database: postgres.Sql, customerId: string): Promise<ConsoleSubject | null> {
  const [row] = await database<{ id: string; name: string; email: string; created_at: Date }[]>`
    select id, name, email, created_at from customers where id = ${customerId}
  `;
  if (!row) return null;

  const policies = await database<{ id: string }[]>`
    select id from policies where customer_id = ${customerId}
     order by created_at desc limit ${MOST_POLICIES_ON_A_360_PAGE}
  `;
  const policyIds = policies.map((policy) => policy.id);
  const claimIds = await claimIdsOfPolicies(database, policyIds);
  return {
    kind: "customer",
    id: row.id,
    title: row.name,
    lead: `customer since ${row.created_at.toISOString().slice(0, 10)} · ${policyIds.length} polic${policyIds.length === 1 ? "y" : "ies"}`,
    identity: [
      { label: "Name", value: row.name, sensitive: true },
      { label: "Email", value: row.email, sensitive: true },
      { label: "Customer id", value: row.id },
      { label: "Created", value: row.created_at.toISOString() },
    ],
    consoleHref: `/ops/console/customer/${row.id}`,
    existingHref: null,
    policyIds,
    claimIds,
    brokerId: null,
    customerId: row.id,
  };
}

async function brokerSubject(database: postgres.Sql, brokerId: string): Promise<ConsoleSubject | null> {
  const [row] = await database<
    { id: string; name: string; commission_rate_bps: number; created_at: Date; kyb_status: string | null; account_ref: string | null }[]
  >`
    select broker.id, broker.name, broker.commission_rate_bps, broker.created_at,
           kyb.status as kyb_status, kyb.provider_ref as account_ref
      from brokers broker
      left join lateral (
        select status, provider_ref from broker_kyb_events
         where broker_id = broker.id order by sequence_number desc limit 1
      ) kyb on true
     where broker.id = ${brokerId}
  `;
  if (!row) return null;

  const policies = await database<{ id: string }[]>`
    select id from policies where broker_id = ${brokerId}
     order by created_at desc limit ${MOST_POLICIES_ON_A_360_PAGE}
  `;
  const policyIds = policies.map((policy) => policy.id);
  const claimIds = await claimIdsOfPolicies(database, policyIds);
  return {
    kind: "broker",
    id: row.id,
    title: row.name,
    lead: `commission ${(row.commission_rate_bps / 100).toFixed(2)}% · verification ${row.kyb_status ?? "unknown"}`,
    identity: [
      { label: "Verification", value: row.kyb_status ?? "unknown, so binding is refused" },
      { label: "Connected account", value: row.account_ref ?? "none yet" },
      { label: "Commission rate", value: `${row.commission_rate_bps} bps` },
      { label: "Broker id", value: row.id },
      { label: "Created", value: row.created_at.toISOString() },
    ],
    consoleHref: `/ops/console/broker/${row.id}`,
    existingHref: "/ops/brokers",
    policyIds,
    claimIds,
    brokerId: row.id,
    customerId: null,
  };
}

async function claimIdsOfPolicies(database: postgres.Sql, policyIds: string[]): Promise<string[]> {
  if (policyIds.length === 0) return [];
  const rows = await database<{ id: string }[]>`
    select id from claims where policy_id = any(${policyIds}::uuid[])
     order by recorded_at desc limit ${MOST_CLAIMS_ON_A_360_PAGE}
  `;
  return rows.map((row) => row.id);
}

// ---------------------------------------------------------------------------
// The panels of a 360 page. One query each, all scoped by the subject's id lists.
// ---------------------------------------------------------------------------

export type OperationWithTimeline = {
  operationId: string;
  kind: string;
  provider: string;
  amountCents: number;
  createdAt: Date;
  idempotencyKey: string;
  policyId: string | null;
  claimId: string | null;
  policyNumber: string | null;
  claimNumber: string | null;
  approvalRequestId: string | null;
  latestStatus: string | null;
  requestedAt: Date | null;
  acceptedAt: Date | null;
  succeededAt: Date | null;
  failedAt: Date | null;
  requestedToAcceptedSeconds: number | null;
  acceptedToSucceededSeconds: number | null;
  providerRef: string | null;
  failureReason: string | null;
};

// Every money operation of the subject, with the instants of its life and the two durations,
// subtracted by the database. The lateral subquery runs once per operation on the
// (operation_id, sequence_number) index, so this stays one round trip whatever the count.
export async function operationsOfSubject(
  database: postgres.Sql,
  subject: Pick<ConsoleSubject, "policyIds" | "claimIds">,
  limit = 100,
): Promise<OperationWithTimeline[]> {
  if (subject.policyIds.length === 0 && subject.claimIds.length === 0) return [];
  const rows = await database<
    {
      operation_id: string;
      kind: string;
      provider: string;
      amount_cents: string;
      created_at: Date;
      idempotency_key: string;
      policy_id: string | null;
      claim_id: string | null;
      policy_number: string | null;
      claim_number: string | null;
      approval_request_id: string | null;
      latest_status: string | null;
      requested_at: Date | null;
      accepted_at: Date | null;
      succeeded_at: Date | null;
      failed_at: Date | null;
      requested_to_accepted_seconds: string | null;
      accepted_to_succeeded_seconds: string | null;
      provider_ref: string | null;
      failure_reason: string | null;
    }[]
  >`
    select operation.id as operation_id,
           operation.kind,
           operation.provider,
           operation.amount_cents,
           operation.created_at,
           operation.idempotency_key,
           operation.policy_id,
           operation.claim_id,
           policy.policy_number,
           claim.claim_number,
           operation.approval_request_id,
           timeline.latest_status,
           timeline.requested_at,
           timeline.accepted_at,
           timeline.succeeded_at,
           timeline.failed_at,
           extract(epoch from timeline.accepted_at  - timeline.requested_at)::text as requested_to_accepted_seconds,
           extract(epoch from timeline.succeeded_at - timeline.accepted_at)::text  as accepted_to_succeeded_seconds,
           timeline.provider_ref,
           timeline.failure_reason
      from money_operations operation
      left join claims claim    on claim.id = operation.claim_id
      left join policies policy on policy.id = coalesce(operation.policy_id, claim.policy_id)
      join lateral (
        select min(recorded_at) filter (where status = 'requested')         as requested_at,
               min(recorded_at) filter (where status = 'provider_accepted') as accepted_at,
               min(recorded_at) filter (where status = 'succeeded')         as succeeded_at,
               max(recorded_at) filter (where status = 'failed')            as failed_at,
               (array_agg(status order by sequence_number desc))[1]         as latest_status,
               (array_agg(provider_ref order by sequence_number desc)
                  filter (where provider_ref is not null))[1]               as provider_ref,
               (array_agg(left(payload ->> 'reason', ${SANITISED_DETAIL_LENGTH}) order by sequence_number desc)
                  filter (where status = 'failed'))[1]                      as failure_reason
          from money_operation_events
         where operation_id = operation.id
      ) timeline on true
     where operation.policy_id = any(${subject.policyIds}::uuid[])
        or operation.claim_id  = any(${subject.claimIds}::uuid[])
     order by operation.created_at desc
     limit ${limit}
  `;
  return rows.map((row) => ({
    operationId: row.operation_id,
    kind: row.kind,
    provider: row.provider,
    amountCents: centsFromDatabase(row.amount_cents, "amount_cents"),
    createdAt: row.created_at,
    idempotencyKey: row.idempotency_key,
    policyId: row.policy_id,
    claimId: row.claim_id,
    policyNumber: row.policy_number,
    claimNumber: row.claim_number,
    approvalRequestId: row.approval_request_id,
    latestStatus: row.latest_status,
    requestedAt: row.requested_at,
    acceptedAt: row.accepted_at,
    succeededAt: row.succeeded_at,
    failedAt: row.failed_at,
    requestedToAcceptedSeconds: row.requested_to_accepted_seconds === null ? null : Number(row.requested_to_accepted_seconds),
    acceptedToSucceededSeconds: row.accepted_to_succeeded_seconds === null ? null : Number(row.accepted_to_succeeded_seconds),
    providerRef: row.provider_ref,
    failureReason: row.failure_reason,
  }));
}

export type WebhookTouch = {
  webhookEventId: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  receivedAt: Date;
  status: string | null;
  attempts: number | null;
  lastError: string | null;
  objectId: string | null;
};

// The provider events that named one of this subject's Stripe references.
//
// WHY THIS ONE READS THE PAYLOAD. A webhook has no foreign key into our tables: what links it to
// a policy is the id of the object inside it. Two paths are read, `data.object.id` (the
// PaymentIntent or Refund the event is about) and `data.object.payment_intent` (a Refund event
// naming the payment it gives back), because those are the two shapes Stripe sends us.
//
// WHY IT IS A SCAN AND WHY THAT IS ACCEPTED HERE. There is no index on a jsonb path, and this
// slice adds no migration, so the query reads webhook_events and filters. It is bounded three
// ways: no references means no query at all, the row count is capped by `limit`, and the table
// holds one row per provider event of a sandbox account. If the table ever grows, the fix is an
// expression index on those two paths, which is a migration and belongs to another slice.
export async function webhooksTouching(
  database: postgres.Sql,
  providerReferences: string[],
  limit = 100,
): Promise<WebhookTouch[]> {
  const references = providerReferences.filter((reference) => reference !== null && reference !== "");
  if (references.length === 0) return [];
  const rows = await database<
    {
      id: string;
      provider: string;
      provider_event_id: string;
      event_type: string;
      received_at: Date;
      status: string | null;
      attempts: number | null;
      last_error: string | null;
      object_id: string | null;
    }[]
  >`
    select event.id, event.provider, event.provider_event_id, event.event_type, event.received_at,
           processing.status, processing.attempts,
           left(processing.last_error, ${SANITISED_DETAIL_LENGTH}) as last_error,
           event.payload -> 'data' -> 'object' ->> 'id' as object_id
      from webhook_events event
      left join webhook_processing processing on processing.webhook_event_id = event.id
     where event.payload -> 'data' -> 'object' ->> 'id' = any(${references})
        or event.payload -> 'data' -> 'object' ->> 'payment_intent' = any(${references})
     order by event.received_at desc
     limit ${limit}
  `;
  return rows.map((row) => ({
    webhookEventId: row.id,
    provider: row.provider,
    providerEventId: row.provider_event_id,
    eventType: row.event_type,
    receivedAt: row.received_at,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    objectId: row.object_id,
  }));
}

export type ConsoleJournalEntry = {
  entryId: string;
  entryType: string;
  effectiveAt: string;
  recordedAt: Date;
  reversesEntryId: string | null;
  lines: { accountId: string; accountName: string; debitCents: number; creditCents: number }[];
};

// The ledger of the subject, shaped exactly for components/journal-table.tsx. Two queries at
// most whatever the number of entries: one for the entries, one for their lines.
export async function journalEntriesOfSubject(
  database: postgres.Sql,
  subject: Pick<ConsoleSubject, "policyIds" | "claimIds" | "brokerId">,
  limit = 60,
): Promise<ConsoleJournalEntry[]> {
  if (subject.policyIds.length === 0 && subject.claimIds.length === 0 && !subject.brokerId) return [];
  const headers = await database<
    { id: string; entry_type: string; effective_at: string; recorded_at: Date; reverses_entry_id: string | null }[]
  >`
    select entry.id, entry.entry_type,
           to_char(entry.effective_at, 'YYYY-MM-DD') as effective_at,
           entry.recorded_at, entry.reverses_entry_id
      from journal_entries entry
     where entry.policy_id = any(${subject.policyIds}::uuid[])
        or entry.claim_id  = any(${subject.claimIds}::uuid[])
        or (${subject.brokerId ?? null}::uuid is not null and entry.broker_id = ${subject.brokerId ?? null}::uuid)
     order by entry.recorded_at desc
     limit ${limit}
  `;
  if (headers.length === 0) return [];

  const entryIds = headers.map((header) => header.id);
  const lines = await database<
    { entry_id: string; account_id: string; account_name: string; debit_cents: string; credit_cents: string; id: string }[]
  >`
    select line.entry_id, line.account_id, account.name as account_name,
           line.debit_cents, line.credit_cents, line.id
      from journal_lines line
      join accounts account on account.id = line.account_id
     where line.entry_id = any(${entryIds}::uuid[])
     order by line.id
  `;
  return headers.map((header) => ({
    entryId: header.id,
    entryType: header.entry_type,
    effectiveAt: header.effective_at,
    recordedAt: header.recorded_at,
    reversesEntryId: header.reverses_entry_id,
    lines: lines
      .filter((line) => line.entry_id === header.id)
      .map((line) => ({
        accountId: line.account_id,
        accountName: line.account_name,
        debitCents: centsFromDatabase(line.debit_cents, "debit_cents"),
        creditCents: centsFromDatabase(line.credit_cents, "credit_cents"),
      })),
  }));
}

export type ConsoleApproval = {
  requestId: string;
  kind: string;
  subjectKind: string;
  subjectId: string;
  amountCents: number;
  destination: string;
  requestedAt: Date;
  requestedByName: string;
  raisedByAgent: boolean;
  decision: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  reason: string | null;
};

export async function approvalsOfSubject(
  database: postgres.Sql,
  subject: Pick<ConsoleSubject, "policyIds" | "claimIds">,
  limit = 50,
): Promise<ConsoleApproval[]> {
  const subjectIds = [...subject.policyIds, ...subject.claimIds];
  if (subjectIds.length === 0) return [];
  const rows = await database<
    {
      id: string;
      kind: string;
      subject_kind: string;
      subject_id: string;
      amount_cents: string;
      destination: string;
      recorded_at: Date;
      requested_by_name: string;
      raised_by_agent: boolean | null;
      decision: string | null;
      decided_by_name: string | null;
      decided_at: Date | null;
      reason: string | null;
    }[]
  >`
    select request.id, request.kind, request.subject_kind, request.subject_id, request.amount_cents,
           left(request.destination, ${SANITISED_DETAIL_LENGTH}) as destination,
           request.recorded_at,
           requester.display_name as requested_by_name,
           -- Compared as text rather than cast to boolean, for the reason written on the same
           -- comparison in approvalEvents above (review finding F-B13-27).
           request.payload ->> 'raised_by_agent' = 'true' as raised_by_agent,
           decision.decision,
           decider.display_name   as decided_by_name,
           decision.recorded_at   as decided_at,
           left(decision.reason, ${SANITISED_DETAIL_LENGTH}) as reason
      from approval_requests request
      join users requester on requester.id = request.requested_by
      left join approval_decisions decision on decision.request_id = request.id
      left join users decider on decider.id = decision.decided_by
     where request.subject_id = any(${subjectIds}::uuid[])
     order by request.recorded_at desc
     limit ${limit}
  `;
  return rows.map((row) => ({
    requestId: row.id,
    kind: row.kind,
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    amountCents: centsFromDatabase(row.amount_cents, "amount_cents"),
    destination: row.destination,
    requestedAt: row.recorded_at,
    requestedByName: row.requested_by_name,
    raisedByAgent: row.raised_by_agent === true,
    decision: row.decision,
    decidedByName: row.decided_by_name,
    decidedAt: row.decided_at,
    reason: row.reason,
  }));
}

export type ConsoleStatementRun = {
  runId: string;
  statementMonth: string;
  revision: number;
  canonicalVersion: number;
  netDueCents: number;
  identicalToPrevious: boolean;
  createdAt: Date;
  knowledgeCutoff: Date;
};

export async function statementRunsOfBroker(
  database: postgres.Sql,
  brokerId: string,
  limit = 24,
): Promise<ConsoleStatementRun[]> {
  const rows = await database<
    {
      id: string;
      statement_month: string;
      revision: number;
      canonical_version: number;
      net_due_cents: string;
      identical_to_previous: boolean;
      created_at: Date;
      knowledge_cutoff: Date;
    }[]
  >`
    select id, to_char(statement_month, 'YYYY-MM') as statement_month, revision, canonical_version,
           net_due_cents, identical_to_previous, created_at, knowledge_cutoff
      from statement_runs
     where broker_id = ${brokerId}
     order by created_at desc
     limit ${limit}
  `;
  return rows.map((row) => ({
    runId: row.id,
    statementMonth: row.statement_month,
    revision: row.revision,
    canonicalVersion: row.canonical_version,
    netDueCents: centsFromDatabase(row.net_due_cents, "net_due_cents"),
    identicalToPrevious: row.identical_to_previous,
    createdAt: row.created_at,
    knowledgeCutoff: row.knowledge_cutoff,
  }));
}

// The most breaks one 360 page will show. Reaching it is said on the panel, because a list that
// silently stops at N is worse than no list at all on a screen about unexplained money.
export const MOST_BREAKS_ON_A_360_PAGE = 50;

// The open breaks that are about this subject's money.
//
// It reuses the two SQL fragments of lib/reconciliation/read.ts rather than restating the rule
// that decides whether a break is open. That rule is subtle (a break is closed only by a later
// complete run of the same source whose window covers the record) and it must exist once, or
// this page and the reconciliation screen would disagree about the same money.
//
// The references are compared IN SQL, with a limit, and that is review finding F-B13-22: this
// reader used to call openBreaks(), which reads every open break of every broker and customer
// with no limit, and then dropped almost all of them in TypeScript. It was the one query on
// these pages whose cost grew with the whole system instead of with the object being looked at.
export async function openBreaksOfSubject(
  database: postgres.Sql,
  operations: OperationWithTimeline[],
  limit = MOST_BREAKS_ON_A_360_PAGE,
): Promise<ReconciliationBreakRow[]> {
  if (operations.length === 0) return [];
  const ledgerRefs = operations.map((operation) => operation.operationId);
  const providerRefs = operations
    .map((operation) => operation.providerRef)
    .filter((reference): reference is string => reference !== null);

  const rows = await database<BreakRowShape[]>`
    with latest_report as (${database.unsafe(LATEST_REPORT_OF_EACH_BREAK)})
    select source, classification, break_key, provider_ref, ledger_ref,
           provider_amount_cents::text as provider_amount_cents,
           ledger_amount_cents::text as ledger_amount_cents,
           difference_cents::text as difference_cents,
           record_at, first_seen_at, last_reported_at, note
      from latest_report
     where not ${database.unsafe(A_LATER_RUN_RE_EXAMINED_IT)}
       and (ledger_ref = any(${ledgerRefs}::text[]) or provider_ref = any(${providerRefs}::text[]))
     order by first_seen_at, source, break_key
     limit ${limit}
  `;
  return rows.map(toBreakRow);
}

export type ConsoleChangeRequest = {
  requestId: string;
  policyId: string;
  policyNumber: string;
  lines: string[];
  comment: string;
  requestedAt: Date;
  requestedByName: string;
  replyOutcome: string | null;
  replyText: string | null;
  repliedAt: Date | null;
  repliedByName: string | null;
};

export async function changeRequestsOfSubject(
  database: postgres.Sql,
  policyIds: string[],
  limit = 50,
): Promise<ConsoleChangeRequest[]> {
  if (policyIds.length === 0) return [];
  const rows = await database<
    {
      id: string;
      policy_id: string;
      policy_number: string;
      lines: string[];
      comment: string;
      recorded_at: Date;
      requested_by_name: string;
      outcome: string | null;
      reply_text: string | null;
      replied_at: Date | null;
      replied_by_name: string | null;
    }[]
  >`
    select request.id, request.policy_id, policy.policy_number, request.lines,
           left(request.comment, ${SANITISED_DETAIL_LENGTH}) as comment,
           request.recorded_at,
           requester.display_name as requested_by_name,
           reply.outcome,
           left(reply.reply_text, ${SANITISED_DETAIL_LENGTH}) as reply_text,
           reply.recorded_at as replied_at,
           replier.display_name as replied_by_name
      from policy_change_requests request
      join policies policy on policy.id = request.policy_id
      join users requester on requester.id = request.requested_by
      left join policy_change_request_replies reply on reply.request_id = request.id
      left join users replier on replier.id = reply.replied_by
     where request.policy_id = any(${policyIds}::uuid[])
     order by request.recorded_at desc
     limit ${limit}
  `;
  return rows.map((row) => ({
    requestId: row.id,
    policyId: row.policy_id,
    policyNumber: row.policy_number,
    lines: row.lines,
    comment: row.comment,
    requestedAt: row.recorded_at,
    requestedByName: row.requested_by_name,
    replyOutcome: row.outcome,
    replyText: row.reply_text,
    repliedAt: row.replied_at,
    repliedByName: row.replied_by_name,
  }));
}

export type ConsoleMcpCall = {
  callId: string;
  instant: Date;
  method: string;
  tool: string | null;
  outcome: string;
  detail: string | null;
  durationMs: number;
  keyPrefix: string | null;
  principalKind: string | null;
};

// The MCP calls made with a key that borrows this party's visibility.
//
// WHAT CANNOT BE ANSWERED, and the console says so rather than pretending. mcp_calls stores a
// HASH of the arguments and never the arguments themselves (migration 0018), so there is no way
// to know which policy or claim a call was about. The link that does exist is the key: a key
// belongs to a user, and a user belongs to a broker or a customer. That is why this panel is on
// the customer and broker pages and NOT on the policy and claim pages.
export async function mcpCallsOfParty(
  database: postgres.Sql,
  party: { brokerId: string | null; customerId: string | null },
  limit = 50,
): Promise<ConsoleMcpCall[]> {
  if (!party.brokerId && !party.customerId) return [];
  const rows = await database<
    {
      id: string;
      called_at: Date;
      method: string;
      tool: string | null;
      outcome: string;
      detail: string | null;
      duration_ms: number;
      key_prefix: string;
      principal_kind: string;
    }[]
  >`
    select call.id, call.called_at, call.method, call.tool, call.outcome,
           left(call.detail, ${SANITISED_DETAIL_LENGTH}) as detail,
           call.duration_ms, key.key_prefix, key.principal_kind
      from mcp_calls call
      join mcp_api_keys key on key.id = call.api_key_id
      join users holder     on holder.id = key.user_id
     where (${party.brokerId ?? null}::uuid is not null and holder.broker_id = ${party.brokerId ?? null}::uuid)
        or (${party.customerId ?? null}::uuid is not null and holder.customer_id = ${party.customerId ?? null}::uuid)
     order by call.called_at desc
     limit ${limit}
  `;
  return rows.map((row) => ({
    callId: row.id,
    instant: row.called_at,
    method: row.method,
    tool: row.tool,
    outcome: row.outcome,
    detail: row.detail,
    durationMs: row.duration_ms,
    keyPrefix: row.key_prefix,
    principalKind: row.principal_kind,
  }));
}

export type ConsolePolicyRow = {
  policyId: string;
  policyNumber: string;
  status: string | null;
  effectiveAt: string | null;
  termEnd: string | null;
  totalChargeCents: number | null;
  customerId: string;
  customerName: string;
  brokerId: string;
  brokerName: string;
  stateCode: string;
};

export async function policiesOfSubject(
  database: postgres.Sql,
  policyIds: string[],
  limit = MOST_POLICIES_ON_A_360_PAGE,
): Promise<ConsolePolicyRow[]> {
  if (policyIds.length === 0) return [];
  const rows = await database<
    {
      id: string;
      policy_number: string;
      status: string | null;
      effective_at: string | null;
      term_end: string | null;
      total_charge_cents: string | null;
      customer_id: string;
      customer_name: string;
      broker_id: string;
      broker_name: string;
      state_code: string;
    }[]
  >`
    select policy.id, policy.policy_number, current_policy.status,
           to_char(current_policy.effective_at, 'YYYY-MM-DD') as effective_at,
           to_char(current_policy.term_end, 'YYYY-MM-DD')     as term_end,
           current_policy.total_charge_cents,
           policy.customer_id, customer.name as customer_name,
           policy.broker_id, broker.name as broker_name,
           policy.state_code
      from policies policy
      join customers customer on customer.id = policy.customer_id
      join brokers broker     on broker.id = policy.broker_id
      left join policy_current current_policy on current_policy.policy_id = policy.id
     where policy.id = any(${policyIds}::uuid[])
     order by policy.created_at desc
     limit ${limit}
  `;
  return rows.map((row) => ({
    policyId: row.id,
    policyNumber: row.policy_number,
    status: row.status,
    effectiveAt: row.effective_at,
    termEnd: row.term_end,
    totalChargeCents: row.total_charge_cents === null ? null : centsFromDatabase(row.total_charge_cents, "total_charge_cents"),
    customerId: row.customer_id,
    customerName: row.customer_name,
    brokerId: row.broker_id,
    brokerName: row.broker_name,
    stateCode: row.state_code,
  }));
}

export type ConsoleClaimRow = {
  claimId: string;
  claimNumber: string;
  policyId: string;
  policyNumber: string;
  claimantName: string;
  occurredAt: string;
  reportedAt: string;
  eventCount: number;
};

export async function claimsOfSubject(
  database: postgres.Sql,
  claimIds: string[],
  limit = MOST_CLAIMS_ON_A_360_PAGE,
): Promise<ConsoleClaimRow[]> {
  if (claimIds.length === 0) return [];
  const rows = await database<
    {
      id: string;
      claim_number: string;
      policy_id: string;
      policy_number: string;
      claimant_name: string;
      occurred_at: string;
      reported_at: string;
      event_count: number;
    }[]
  >`
    select claim.id, claim.claim_number, claim.policy_id, policy.policy_number, claim.claimant_name,
           to_char(claim.occurred_at, 'YYYY-MM-DD') as occurred_at,
           to_char(claim.reported_at, 'YYYY-MM-DD') as reported_at,
           (select count(*)::int from claim_events event where event.claim_id = claim.id) as event_count
      from claims claim
      join policies policy on policy.id = claim.policy_id
     where claim.id = any(${claimIds}::uuid[])
     order by claim.recorded_at desc
     limit ${limit}
  `;
  return rows.map((row) => ({
    claimId: row.id,
    claimNumber: row.claim_number,
    policyId: row.policy_id,
    policyNumber: row.policy_number,
    claimantName: row.claimant_name,
    occurredAt: row.occurred_at,
    reportedAt: row.reported_at,
    eventCount: row.event_count,
  }));
}

// The subject's own history, merged: what the policy did, what its claims did, what its money
// operations did and what the ledger booked. This is the "trail" the reference search shows and
// the timeline panel of every 360 page. `since` is the beginning of time here on purpose: a
// trail that stopped at a cursor would not be a trail.
export async function subjectTimeline(
  database: postgres.Sql,
  subject: Pick<ConsoleSubject, "policyIds" | "claimIds" | "brokerId">,
  limit = 120,
): Promise<ConsoleEvent[]> {
  const [operations, journal, policyRows, claimRows] = await Promise.all([
    operationsOfSubject(database, { policyIds: subject.policyIds, claimIds: subject.claimIds }, limit),
    journalEntriesOfSubject(database, subject, limit),
    policyEventsOfPolicies(database, subject.policyIds, limit),
    claimEventsOfClaims(database, subject.claimIds, limit),
  ]);

  const fromOperations: ConsoleEvent[] = operations.map((operation) => ({
    kind: "money",
    instant: operation.succeededAt ?? operation.failedAt ?? operation.acceptedAt ?? operation.requestedAt ?? operation.createdAt,
    title: `${operation.kind} ${operation.latestStatus ?? "no event"}`,
    outcome: moneyOutcome(operation.latestStatus ?? ""),
    actor: operation.provider,
    actorIsPerson: false,
    detail: operation.failureReason ?? "",
    amountCents: operation.amountCents,
    policyId: operation.policyId,
    claimId: operation.claimId,
    brokerId: null,
    customerId: null,
    policyNumber: operation.policyNumber,
    claimNumber: operation.claimNumber,
    reference: operation.providerRef,
    href: objectHref(operation.claimId, operation.policyId),
    rail: integrationModeOf(operation.provider),
  }));

  const fromJournal: ConsoleEvent[] = journal.map((entry) => ({
    kind: "journal",
    instant: entry.recordedAt,
    title: entry.reversesEntryId ? `${entry.entryType} (reversal)` : entry.entryType,
    outcome: entry.reversesEntryId ? "warn" : "neutral",
    actor: "the ledger",
    actorIsPerson: false,
    detail: `effective ${entry.effectiveAt}`,
    amountCents: entry.lines.reduce((total, line) => total + line.debitCents, 0),
    policyId: null,
    claimId: null,
    brokerId: subject.brokerId,
    customerId: null,
    policyNumber: null,
    claimNumber: null,
    reference: entry.entryId,
    href: null,
    // Not a rail record: nothing to label (F-RC-08).
    rail: null,
  }));

  return [...fromOperations, ...fromJournal, ...policyRows, ...claimRows]
    .sort((older, newer) => newer.instant.getTime() - older.instant.getTime())
    .slice(0, limit);
}

// The policy events of a set of policies, as feed rows. Used by the timeline and by the policy
// 360 page, which shows the same rows in its own panel.
export async function policyEventsOfPolicies(
  database: postgres.Sql,
  policyIds: string[],
  limit = 100,
): Promise<ConsoleEvent[]> {
  if (policyIds.length === 0) return [];
  const rows = await database<
    {
      instant: Date;
      event_type: string;
      effective_at: string;
      policy_id: string;
      policy_number: string;
      broker_id: string;
      customer_id: string;
      actor: string | null;
      reason: string | null;
    }[]
  >`
    select event.recorded_at as instant, event.event_type,
           to_char(event.effective_at, 'YYYY-MM-DD') as effective_at,
           policy.id as policy_id, policy.policy_number, policy.broker_id, policy.customer_id,
           author.display_name as actor,
           left(coalesce(event.payload ->> 'reason', event.payload ->> 'note'), ${SANITISED_DETAIL_LENGTH}) as reason
      from policy_events event
      join policies policy on policy.id = event.policy_id
      left join users author on author.id::text = event.created_by
     where event.policy_id = any(${policyIds}::uuid[])
     order by event.recorded_at desc
     limit ${limit}
  `;
  return rows.map((row) => ({
    kind: "policy" as const,
    instant: row.instant,
    title: row.event_type,
    outcome: row.event_type.startsWith("correction") || row.event_type === "cancelled" ? ("warn" as const) : ("neutral" as const),
    actor: row.actor ?? "no signed-in user recorded",
    actorIsPerson: row.actor !== null,
    detail: [`effective ${row.effective_at}`, row.reason].filter(Boolean).join(" · "),
    amountCents: null,
    policyId: row.policy_id,
    claimId: null,
    brokerId: row.broker_id,
    customerId: row.customer_id,
    policyNumber: row.policy_number,
    claimNumber: null,
    reference: row.policy_number,
    href: `/ops/console/policy/${row.policy_id}`,
    // Not a rail record: nothing to label (F-RC-08).
    rail: null,
  }));
}

export async function claimEventsOfClaims(
  database: postgres.Sql,
  claimIds: string[],
  limit = 100,
): Promise<ConsoleEvent[]> {
  if (claimIds.length === 0) return [];
  const rows = await database<
    {
      instant: Date;
      event_type: string;
      amount_cents: string | null;
      claim_id: string;
      claim_number: string;
      policy_id: string;
      policy_number: string;
      actor: string | null;
      note: string | null;
      rail_provider: string | null;
    }[]
  >`
    select event.recorded_at as instant, event.event_type, event.amount_cents,
           claim.id as claim_id, claim.claim_number,
           policy.id as policy_id, policy.policy_number,
           author.display_name as actor,
           left(event.payload ->> 'note', ${SANITISED_DETAIL_LENGTH}) as note,
           -- The rail the money moved on, when this stage moved money (F-RC-08).
           operation.provider as rail_provider
      from claim_events event
      join claims claim    on claim.id = event.claim_id
      join policies policy on policy.id = claim.policy_id
      left join money_operations operation on operation.id = event.money_operation_id
      left join users author on author.id::text = event.created_by
     where event.claim_id = any(${claimIds}::uuid[])
     order by event.recorded_at desc
     limit ${limit}
  `;
  return rows.map((row) => ({
    kind: "claim" as const,
    instant: row.instant,
    title: row.event_type,
    outcome:
      row.event_type === "payment_returned" ? ("warn" as const) : row.event_type === "payment_settled" ? ("ok" as const) : ("neutral" as const),
    actor: row.actor ?? "a scheduled job",
    actorIsPerson: row.actor !== null,
    detail: row.note ?? "",
    amountCents: row.amount_cents === null ? null : centsFromDatabase(row.amount_cents, "amount_cents"),
    policyId: row.policy_id,
    claimId: row.claim_id,
    brokerId: null,
    customerId: null,
    policyNumber: row.policy_number,
    claimNumber: row.claim_number,
    reference: row.claim_number,
    href: `/ops/console/claim/${row.claim_id}`,
    rail: row.rail_provider === null ? null : integrationModeOf(row.rail_provider),
  }));
}

export async function kybEventsOfBroker(
  database: postgres.Sql,
  brokerId: string,
  limit = 50,
): Promise<ConsoleEvent[]> {
  const rows = await database<
    { instant: Date; provider: string; status: string; provider_ref: string | null; actor: string | null; broker_name: string }[]
  >`
    select event.recorded_at as instant, event.provider, event.status, event.provider_ref,
           author.display_name as actor, broker.name as broker_name
      from broker_kyb_events event
      join brokers broker on broker.id = event.broker_id
      left join users author on author.id::text = event.created_by
     where event.broker_id = ${brokerId}
     order by event.sequence_number desc
     limit ${limit}
  `;
  return rows.map((row) => ({
    kind: "kyb" as const,
    instant: row.instant,
    title: `verification ${row.status}`,
    outcome: row.status === "approved" ? ("ok" as const) : row.status === "failed" ? ("failed" as const) : ("warn" as const),
    actor: row.actor ?? row.provider,
    actorIsPerson: row.actor !== null,
    detail: row.broker_name,
    amountCents: null,
    policyId: null,
    claimId: null,
    brokerId,
    customerId: null,
    policyNumber: null,
    claimNumber: null,
    reference: row.provider_ref,
    href: `/ops/console/broker/${brokerId}`,
    // Same reason as kybEvents above: a verification, not a money rail (F-RC-08).
    rail: null,
  }));
}

