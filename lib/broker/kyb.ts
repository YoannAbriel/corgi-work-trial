import type postgres from "postgres";
import { sql } from "@/db/client";
import {
  isProviderEvidence,
  kybStatusExplanation,
  reportedKybStatus,
  STRIPE_CONNECT_PROVIDER,
  type KybStatus,
} from "./eligibility";

// What the database says about a broker's business verification. Reads and appends only: the
// two operations that talk to Stripe live in ./kyb-onboarding.ts, and the rules that turn a
// status into permission live in ./eligibility.ts.
//
// Eligibility comes from the append-only broker_kyb_events table: the latest event wins, and
// no event at all means unknown. Unknown is not permission (AGENTS.md: eligibility-dependent
// actions are blocked while eligibility is unknown), so a broker who has never been verified
// cannot bind anything.
//
// The database handle is a parameter whose default is the application pool, like the payment
// functions: production always uses the default, the checks pass the disposable database.

export type { KybStatus };
export { KYB_NOT_LIVE_LABEL } from "./eligibility";

// Both the application pool and an open transaction can run these queries, exactly as in
// lib/policy/current.ts.
type Queryable = postgres.Sql | postgres.TransactionSql;

export type KybState = {
  // The status the application acts on: the recorded one, with the settling window applied.
  status: KybStatus;
  // What the latest event literally says. Differs from `status` only while an approval is held
  // by the settling window, which is exactly the case staff need to see explained.
  recordedStatus: KybStatus;
  heldBySettlingWindow: boolean;
  provider: string; // 'seed' for the placeholder, 'stripe_connect' for a real status
  providerAccountId: string | null; // the Stripe connected account, once one exists
  reason: string | null; // Stripe's error code on a failure, our short reason otherwise
  recordedAt: Date | null; // when the status was recorded
  submittedAt: Date | null; // when the broker submitted the verification this status is about
  isProviderEvidence: boolean; // false while the only event comes from the seed script
  explanation: string; // the one sentence every screen shows
};

const NO_EVENT_YET: KybState = {
  status: "unknown",
  recordedStatus: "unknown",
  heldBySettlingWindow: false,
  provider: "none",
  providerAccountId: null,
  reason: null,
  recordedAt: null,
  submittedAt: null,
  isProviderEvidence: false,
  explanation: kybStatusExplanation({ status: "unknown", reason: null, heldBySettlingWindow: false }),
};

export async function brokerKybState(brokerId: string, database: postgres.Sql = sql): Promise<KybState> {
  const latestEvent = await latestBrokerKybEvent(brokerId, database);
  if (!latestEvent) {
    return NO_EVENT_YET;
  }

  // The submission the status is about: the most recent one made before the status was
  // recorded. A submission made afterwards belongs to a later verification and must not be
  // used to judge this one.
  const submission = await latestSubmissionRecordedBy(brokerId, latestEvent.recordedAt, database);
  const reported = reportedKybStatus(latestEvent, submission?.recordedAt ?? null);

  return {
    status: reported.status,
    recordedStatus: latestEvent.status,
    heldBySettlingWindow: reported.heldBySettlingWindow,
    provider: latestEvent.provider,
    providerAccountId: latestEvent.providerRef,
    reason: latestEvent.reason,
    recordedAt: latestEvent.recordedAt,
    submittedAt: submission?.recordedAt ?? null,
    isProviderEvidence: isProviderEvidence(latestEvent.provider),
    explanation: kybStatusExplanation({
      status: reported.status,
      reason: latestEvent.reason,
      heldBySettlingWindow: reported.heldBySettlingWindow,
    }),
  };
}

// ---------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------

export type BrokerKybEvent = {
  id: string;
  status: KybStatus;
  provider: string;
  providerRef: string | null;
  reason: string | null;
  requirementErrorCodes: string[];
  recordedAt: Date;
  createdBy: string | null;
};

export async function latestBrokerKybEvent(
  brokerId: string,
  database: Queryable = sql,
): Promise<BrokerKybEvent | null> {
  const [row] = await database<KybEventRow[]>`
    select id, status, provider, provider_ref, payload, recorded_at, created_by
      from broker_kyb_events
     where broker_id = ${brokerId}
     order by sequence_number desc
     limit 1
  `;
  return row ? toBrokerKybEvent(row) : null;
}

// Every status ever recorded for a broker, newest first. The operations screen shows it so a
// pending that became failed can be read as the history it is.
export async function brokerKybEventHistory(
  brokerId: string,
  limit: number,
  database: postgres.Sql = sql,
): Promise<BrokerKybEvent[]> {
  const rows = await database<KybEventRow[]>`
    select id, status, provider, provider_ref, payload, recorded_at, created_by
      from broker_kyb_events
     where broker_id = ${brokerId}
     order by sequence_number desc
     limit ${limit}
  `;
  return rows.map(toBrokerKybEvent);
}

// What may go into an event payload: only values that survive a round trip through jsonb.
// No Date and no bigint, so a timestamp is written as an ISO string and an amount as a number
// of cents, which is what every other payload in this schema already does.
export type KybEventPayload = Record<string, string | number | boolean | null | string[]>;

export type NewBrokerKybEvent = {
  brokerId: string;
  provider: string;
  status: KybStatus;
  providerAccountId: string | null;
  // Stored as the event payload. Written in snake_case, like every other payload in this
  // schema, so a row read in psql and a payload read in the application look alike.
  payload: KybEventPayload;
  createdBy: string | null;
};

export async function appendBrokerKybEvent(
  event: NewBrokerKybEvent,
  database: Queryable = sql,
): Promise<void> {
  await database`
    insert into broker_kyb_events (broker_id, provider, status, provider_ref, payload, created_by)
    values (${event.brokerId}, ${event.provider}, ${event.status}, ${event.providerAccountId},
            ${database.json(event.payload)}, ${event.createdBy})
  `;
}

export type AppendIfChangedOutcome = {
  appended: boolean;
  previousStatus: KybStatus | null;
};

// Appends a status row only when the status differs from the last one recorded.
//
// This is what makes a replayed webhook harmless: Stripe delivers `account.updated` several
// times for one change, and every delivery re-reads the account and maps it to the same
// status, so only the first one writes a row. The history therefore reads as one row per
// transition rather than one row per delivery.
//
// The comparison and the insert run inside one transaction that first takes an advisory lock
// on the broker, so two deliveries processed at the same moment cannot both decide that the
// status changed and write the same row twice. The lock is released when the transaction ends.
export async function appendBrokerKybEventIfChanged(
  event: NewBrokerKybEvent,
  database: postgres.Sql = sql,
): Promise<AppendIfChangedOutcome> {
  return database.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtext(${event.brokerId}))`;

    const [previous] = await transaction<{ status: KybStatus }[]>`
      select status from broker_kyb_events
       where broker_id = ${event.brokerId}
       order by sequence_number desc
       limit 1
    `;
    if (previous && previous.status === event.status) {
      return { appended: false, previousStatus: previous.status };
    }
    await appendBrokerKybEvent(event, transaction);
    return { appended: true, previousStatus: previous ? previous.status : null };
  });
}

// Which broker a Stripe connected account belongs to. The account id is written on the events,
// so this is the reverse lookup an incoming `account.updated` needs. An account we never
// created returns null and the event is ignored with that reason, never guessed at.
export async function brokerIdForProviderAccount(
  providerAccountId: string,
  database: postgres.Sql = sql,
): Promise<string | null> {
  const [row] = await database<{ broker_id: string }[]>`
    select broker_id from broker_kyb_events
     where provider = ${STRIPE_CONNECT_PROVIDER} and provider_ref = ${providerAccountId}
     order by sequence_number
     limit 1
  `;
  return row ? row.broker_id : null;
}

// ---------------------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------------------

export type BrokerKybSubmission = {
  id: string;
  brokerId: string;
  provider: string;
  providerIdempotencyKey: string;
  legalName: string;
  einLast4: string;
  addressLine1: string;
  addressCity: string;
  addressState: string;
  addressPostalCode: string;
  businessUrl: string;
  contactEmail: string;
  termsAcceptedAt: Date;
  termsAcceptedIp: string;
  submittedBy: string | null;
  recordedAt: Date;
};

export type NewBrokerKybSubmission = Omit<BrokerKybSubmission, "id" | "recordedAt">;

// Writes what the broker declared. The caller commits this before calling Stripe, so a crash
// during the provider call leaves the declaration and the terms acceptance on file.
export async function insertBrokerKybSubmission(
  submission: NewBrokerKybSubmission,
  database: Queryable = sql,
): Promise<{ submissionId: string; recordedAt: Date }> {
  const [row] = await database<{ id: string; recorded_at: Date }[]>`
    insert into broker_kyb_submissions (
      broker_id, provider, provider_idempotency_key, legal_name, ein_last4,
      address_line1, address_city, address_state, address_postal_code,
      business_url, contact_email, terms_accepted_at, terms_accepted_ip, submitted_by
    ) values (
      ${submission.brokerId}, ${submission.provider}, ${submission.providerIdempotencyKey},
      ${submission.legalName}, ${submission.einLast4},
      ${submission.addressLine1}, ${submission.addressCity}, ${submission.addressState},
      ${submission.addressPostalCode}, ${submission.businessUrl}, ${submission.contactEmail},
      ${submission.termsAcceptedAt}, ${submission.termsAcceptedIp}, ${submission.submittedBy}
    )
    returning id, recorded_at
  `;
  return { submissionId: row.id, recordedAt: row.recorded_at };
}

export async function latestBrokerKybSubmission(
  brokerId: string,
  database: postgres.Sql = sql,
): Promise<BrokerKybSubmission | null> {
  const [row] = await database<SubmissionRow[]>`
    select id, broker_id, provider, provider_idempotency_key, legal_name, ein_last4,
           address_line1, address_city, address_state, address_postal_code,
           business_url, contact_email, terms_accepted_at, terms_accepted_ip,
           submitted_by, recorded_at
      from broker_kyb_submissions
     where broker_id = ${brokerId}
     order by sequence_number desc
     limit 1
  `;
  return row ? toSubmission(row) : null;
}

// How many verifications this broker has already submitted. The next attempt number is what
// makes the idempotency key of the next submission unique and derived rather than random.
export async function countBrokerKybSubmissions(
  brokerId: string,
  database: Queryable = sql,
): Promise<number> {
  const [row] = await database<{ count: string }[]>`
    select count(*)::text as count from broker_kyb_submissions where broker_id = ${brokerId}
  `;
  return Number(row.count);
}

// The broker's most recent submission if it is still waiting for its answer from Stripe: no
// status row carries its id, and it is younger than the window given.
//
// Both events written by submitBrokerKyb, the failure and the account it created, carry
// `submission_id` in their payload, so a submission stops being "in flight" as soon as either is
// appended. A submission whose process died before that ages out of the window instead of
// blocking the broker for ever (review finding F-B3-05).
export async function submissionAwaitingProviderAnswer(
  brokerId: string,
  withinLastMinutes: number,
  database: Queryable = sql,
): Promise<{ submissionId: string; recordedAt: Date } | null> {
  const [row] = await database<{ id: string; recorded_at: Date }[]>`
    select submission.id, submission.recorded_at
      from broker_kyb_submissions submission
     where submission.broker_id = ${brokerId}
       and submission.recorded_at > now() - ${`${withinLastMinutes} minutes`}::interval
       and not exists (
             select 1 from broker_kyb_events event
              where event.broker_id = submission.broker_id
                and event.payload ->> 'submission_id' = submission.id::text
           )
     order by submission.sequence_number desc
     limit 1
  `;
  return row ? { submissionId: row.id, recordedAt: row.recorded_at } : null;
}

async function latestSubmissionRecordedBy(
  brokerId: string,
  recordedAtOrBefore: Date,
  database: postgres.Sql,
): Promise<{ recordedAt: Date } | null> {
  const [row] = await database<{ recorded_at: Date }[]>`
    select recorded_at from broker_kyb_submissions
     where broker_id = ${brokerId} and recorded_at <= ${recordedAtOrBefore}
     order by sequence_number desc
     limit 1
  `;
  return row ? { recordedAt: row.recorded_at } : null;
}

// ---------------------------------------------------------------------------------------
// The brokers list the operations screen shows
// ---------------------------------------------------------------------------------------

export type BrokerKybRow = {
  brokerId: string;
  brokerName: string;
  commissionRateBps: number;
  state: KybState;
  submission: BrokerKybSubmission | null;
  requirementErrorCodes: string[];
};

export async function brokersWithKybState(database: postgres.Sql = sql): Promise<BrokerKybRow[]> {
  const brokers = await database<{ id: string; name: string; commission_rate_bps: number }[]>`
    select id, name, commission_rate_bps from brokers order by name
  `;
  return Promise.all(
    brokers.map(async (broker) => {
      const [state, latestEvent, submission] = await Promise.all([
        brokerKybState(broker.id, database),
        latestBrokerKybEvent(broker.id, database),
        latestBrokerKybSubmission(broker.id, database),
      ]);
      return {
        brokerId: broker.id,
        brokerName: broker.name,
        commissionRateBps: broker.commission_rate_bps,
        state,
        submission,
        requirementErrorCodes: latestEvent?.requirementErrorCodes ?? [],
      };
    }),
  );
}

// ---------------------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------------------

type KybEventRow = {
  id: string;
  status: KybStatus;
  provider: string;
  provider_ref: string | null;
  payload: Record<string, unknown>;
  recorded_at: Date;
  created_by: string | null;
};

function toBrokerKybEvent(row: KybEventRow): BrokerKybEvent {
  const codes = row.payload?.requirement_error_codes;
  return {
    id: row.id,
    status: row.status,
    provider: row.provider,
    providerRef: row.provider_ref,
    reason: typeof row.payload?.reason === "string" ? row.payload.reason : null,
    requirementErrorCodes: Array.isArray(codes) ? codes.map(String) : [],
    recordedAt: row.recorded_at,
    createdBy: row.created_by,
  };
}

type SubmissionRow = {
  id: string;
  broker_id: string;
  provider: string;
  provider_idempotency_key: string;
  legal_name: string;
  ein_last4: string;
  address_line1: string;
  address_city: string;
  address_state: string;
  address_postal_code: string;
  business_url: string;
  contact_email: string;
  terms_accepted_at: Date;
  terms_accepted_ip: string;
  submitted_by: string | null;
  recorded_at: Date;
};

function toSubmission(row: SubmissionRow): BrokerKybSubmission {
  return {
    id: row.id,
    brokerId: row.broker_id,
    provider: row.provider,
    providerIdempotencyKey: row.provider_idempotency_key,
    legalName: row.legal_name,
    einLast4: row.ein_last4,
    addressLine1: row.address_line1,
    addressCity: row.address_city,
    addressState: row.address_state,
    addressPostalCode: row.address_postal_code,
    businessUrl: row.business_url,
    contactEmail: row.contact_email,
    termsAcceptedAt: row.terms_accepted_at,
    termsAcceptedIp: row.terms_accepted_ip,
    submittedBy: row.submitted_by,
    recordedAt: row.recorded_at,
  };
}
