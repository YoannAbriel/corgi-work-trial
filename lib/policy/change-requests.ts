import type postgres from "postgres";
import { sql } from "@/db/client";
import type { UserRole } from "@/lib/auth/current-user";

type Queryable = postgres.Sql | postgres.TransactionSql;

// A customer asks their broker to change something on their policy (slice B13-6, decided by
// Yoann on 2026-09-08 at 20:35 UTC).
//
// What the user does: the customer opens their own policy at /policies/{id}, ticks the lines the
// request is about, writes a comment, and sends it. The owning broker sees it on the same policy
// page and in "what needs you", and answers it once.
//
// WHAT THIS FILE NEVER DOES, and the reason it is short: no money, no policy change. It writes
// two kinds of row and reads them back. A request is a message; when the broker agrees to it,
// the change itself goes through the endorsement flow (lib/policy/endorse.ts), which prices it,
// collects the delta and writes the policy event. Nothing here posts a journal entry, writes a
// policy_event, or touches a money table.
//
// Both tables are append-only in the database (migration 0019): a request is never edited, and
// "answered" is not a flag written into it but the existence of a reply row.

// A refusal a person can act on: wrong actor, empty comment, a request already answered. It
// becomes a message on the page, never a 500.
export class ChangeRequestRefused extends Error {}

// The lines of the policy a request can be about. They are what the customer READS on the page,
// not database columns: the broker decides what "the annual premium" means in the endorsement.
// The same list is the CHECK on policy_change_requests.lines, so a forged form is refused twice.
export const CHANGE_REQUEST_LINES = [
  "insured_name",
  "mailing_address",
  "per_occurrence_limit",
  "aggregate_limit",
  "annual_premium",
  "effective_date",
  "other",
] as const;

export type ChangeRequestLine = (typeof CHANGE_REQUEST_LINES)[number];

// What the customer sees next to each checkbox, and what the broker reads on the request.
export const CHANGE_REQUEST_LINE_LABELS: Record<ChangeRequestLine, string> = {
  insured_name: "The insured name",
  mailing_address: "The mailing address",
  per_occurrence_limit: "The per-occurrence limit",
  aggregate_limit: "The aggregate limit",
  annual_premium: "The annual premium",
  effective_date: "The effective date",
  other: "Something else, described in the comment",
};

// The same bounds as the CHECK constraints of migration 0019, named once so the form, the server
// and the database all say the same thing.
export const COMMENT_MINIMUM_CHARACTERS = 10;
export const COMMENT_MAXIMUM_CHARACTERS = 500;
export const REPLY_MAXIMUM_CHARACTERS = 500;

export type ChangeRequestActor = {
  userId: string;
  // Every role the application knows, including 'agent' (slice B11). The checks below are
  // allowlists, so a role added later is refused by default rather than by being absent here.
  role: UserRole;
  brokerId: string | null; // set when the role is 'broker'
  customerId: string | null; // set when the role is 'customer'
};

export type ChangeRequestOutcome = "answered" | "done";

export type ChangeRequestReplyView = {
  replyId: string;
  outcome: ChangeRequestOutcome;
  text: string;
  repliedByName: string;
  recordedAt: Date;
};

export type ChangeRequestView = {
  requestId: string;
  policyId: string;
  lines: ChangeRequestLine[];
  comment: string;
  requestedByName: string;
  recordedAt: Date;
  // null while nobody has answered: that, and nothing else, is what "open" means here.
  reply: ChangeRequestReplyView | null;
};

// ---------------------------------------------------------------------------
// Writing: the customer asks
// ---------------------------------------------------------------------------

export type CreateChangeRequestInput = {
  policyId: string;
  lines: string[]; // straight from the form, checked here
  comment: string;
  actor: ChangeRequestActor;
};

// The customer of this policy, and nobody else: not the broker, not staff, not an agent. The
// customer id comes from the session, never from the form.
export async function createChangeRequest(
  input: CreateChangeRequestInput,
  database: Queryable = sql,
): Promise<{ requestId: string }> {
  const policy = await loadPolicyOwners(database, input.policyId);
  if (!policy) {
    throw new ChangeRequestRefused("this policy does not exist");
  }
  if (input.actor.role !== "customer" || input.actor.customerId !== policy.customerId) {
    throw new ChangeRequestRefused("only the customer of this policy can ask for a change on it");
  }

  const lines = checkedLines(input.lines);
  const comment = input.comment.trim();
  if (comment.length < COMMENT_MINIMUM_CHARACTERS) {
    throw new ChangeRequestRefused(`write at least ${COMMENT_MINIMUM_CHARACTERS} characters so your broker knows what to change`);
  }
  if (comment.length > COMMENT_MAXIMUM_CHARACTERS) {
    throw new ChangeRequestRefused(`keep the comment under ${COMMENT_MAXIMUM_CHARACTERS} characters`);
  }

  const [row] = await database<{ id: string }[]>`
    insert into policy_change_requests (policy_id, requested_by, lines, comment)
    values (${input.policyId}, ${input.actor.userId}, ${lines}, ${comment})
    returning id
  `;
  return { requestId: row.id };
}

// At least one line, every line inside the closed list, each line once. The order is the order of
// CHANGE_REQUEST_LINES, so two identical requests store identical arrays.
function checkedLines(fromForm: string[]): ChangeRequestLine[] {
  const ticked = new Set(fromForm);
  for (const line of ticked) {
    if (!(CHANGE_REQUEST_LINES as readonly string[]).includes(line)) {
      throw new ChangeRequestRefused("that is not a line of this policy");
    }
  }
  const lines = CHANGE_REQUEST_LINES.filter((line) => ticked.has(line));
  if (lines.length === 0) {
    throw new ChangeRequestRefused("tick at least one line the request is about");
  }
  return [...lines];
}

// ---------------------------------------------------------------------------
// Writing: the broker answers, once
// ---------------------------------------------------------------------------

export type ReplyToChangeRequestInput = {
  policyId: string;
  requestId: string;
  outcome: string; // straight from the form, checked here
  text: string;
  actor: ChangeRequestActor;
};

// The owning broker, or staff operations. A staff approver reads the request but does not answer
// it: answering is the policy writer's job, and an approver's job is deciding money out.
export async function replyToChangeRequest(
  input: ReplyToChangeRequestInput,
  database: Queryable = sql,
): Promise<{ replyId: string }> {
  const [request] = await database<{ id: string; broker_id: string }[]>`
    select change_request.id, policy.broker_id
      from policy_change_requests change_request
      join policies policy on policy.id = change_request.policy_id
     where change_request.id = ${input.requestId}
       and change_request.policy_id = ${input.policyId}
  `;
  if (!request) {
    throw new ChangeRequestRefused("this change request does not exist on this policy");
  }

  const isOwningBroker = input.actor.role === "broker" && input.actor.brokerId === request.broker_id;
  const isStaffOperations = input.actor.role === "staff_ops";
  if (!isOwningBroker && !isStaffOperations) {
    throw new ChangeRequestRefused("only the broker who writes this policy, or staff operations, can answer a change request");
  }

  if (input.outcome !== "answered" && input.outcome !== "done") {
    throw new ChangeRequestRefused("say whether this is an answer or a change you have made");
  }
  const text = input.text.trim();
  if (text.length === 0) {
    throw new ChangeRequestRefused("write an answer for the customer");
  }
  if (text.length > REPLY_MAXIMUM_CHARACTERS) {
    throw new ChangeRequestRefused(`keep the answer under ${REPLY_MAXIMUM_CHARACTERS} characters`);
  }

  try {
    const [row] = await database<{ id: string }[]>`
      insert into policy_change_request_replies (request_id, replied_by, outcome, reply_text)
      values (${input.requestId}, ${input.actor.userId}, ${input.outcome}, ${text})
      returning id
    `;
    return { replyId: row.id };
  } catch (error) {
    // A request is answered once, and the unique constraint of migration 0019 is what enforces
    // it: two brokers pressing the button at the same moment produce one answer and this
    // refusal, not two answers. Nothing in the application decides it.
    if (isUniqueViolation(error)) {
      throw new ChangeRequestRefused("this change request has already been answered");
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

// Every change request of one policy, newest first, each with its reply when it has one. The
// customer's own list and the broker's panel read the same rows.
export async function changeRequestsOfPolicy(policyId: string, database: Queryable = sql): Promise<ChangeRequestView[]> {
  const rows = await database<
    {
      id: string;
      policy_id: string;
      lines: string[];
      comment: string;
      requested_by_name: string;
      recorded_at: Date;
      reply_id: string | null;
      outcome: ChangeRequestOutcome | null;
      reply_text: string | null;
      replied_by_name: string | null;
      reply_recorded_at: Date | null;
    }[]
  >`
    select change_request.id,
           change_request.policy_id,
           change_request.lines,
           change_request.comment,
           requester.display_name as requested_by_name,
           change_request.recorded_at,
           reply.id            as reply_id,
           reply.outcome,
           reply.reply_text,
           replier.display_name as replied_by_name,
           reply.recorded_at   as reply_recorded_at
      from policy_change_requests change_request
      join users requester on requester.id = change_request.requested_by
      left join policy_change_request_replies reply on reply.request_id = change_request.id
      left join users replier on replier.id = reply.replied_by
     where change_request.policy_id = ${policyId}
     order by change_request.recorded_at desc
  `;
  return rows.map((row) => ({
    requestId: row.id,
    policyId: row.policy_id,
    // The CHECK of migration 0019 keeps the stored array inside the closed list, so this cast
    // describes what the database guarantees rather than trusting the row.
    lines: row.lines as ChangeRequestLine[],
    comment: row.comment,
    requestedByName: row.requested_by_name,
    recordedAt: row.recorded_at,
    reply:
      row.reply_id && row.outcome && row.reply_text && row.replied_by_name && row.reply_recorded_at
        ? {
            replyId: row.reply_id,
            outcome: row.outcome,
            text: row.reply_text,
            repliedByName: row.replied_by_name,
            recordedAt: row.reply_recorded_at,
          }
        : null,
  }));
}

// The ones still waiting for the broker: no reply row exists for them.
export async function openChangeRequestsOfPolicy(policyId: string, database: Queryable = sql): Promise<ChangeRequestView[]> {
  const requests = await changeRequestsOfPolicy(policyId, database);
  return requests.filter((request) => request.reply === null);
}

// The change requests waiting on the policies this broker writes, newest first within each
// policy. Only the policies that carry a request are read, so a broker with many policies and no
// request costs one query.
export async function openChangeRequestsOfBroker(
  { brokerId }: { brokerId: string },
  database: Queryable = sql,
): Promise<ChangeRequestView[]> {
  const policies = await database<{ policy_id: string }[]>`
    select distinct change_request.policy_id
      from policy_change_requests change_request
      join policies policy on policy.id = change_request.policy_id
     where policy.broker_id = ${brokerId}
  `;
  const open: ChangeRequestView[] = [];
  for (const policy of policies) {
    open.push(...(await openChangeRequestsOfPolicy(policy.policy_id, database)));
  }
  return open;
}

// How many change requests are waiting on the policies this broker writes, for the "what needs
// you" block and the sidebar badge. It counts the list above rather than asking the same question
// in a second query: what makes a request open lives in one place (no reply row exists), so the
// number and the list of lib/inbox/read.ts cannot drift apart.
export async function countOpenChangeRequests(
  { brokerId }: { brokerId: string },
  database: Queryable = sql,
): Promise<number> {
  return (await openChangeRequestsOfBroker({ brokerId }, database)).length;
}

async function loadPolicyOwners(
  database: Queryable,
  policyId: string,
): Promise<{ customerId: string; brokerId: string } | null> {
  const [row] = await database<{ customer_id: string; broker_id: string }[]>`
    select customer_id, broker_id from policies where id = ${policyId}
  `;
  return row ? { customerId: row.customer_id, brokerId: row.broker_id } : null;
}
