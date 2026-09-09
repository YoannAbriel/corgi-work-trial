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
//
// It carries WHERE THE PERSON CAN READ IT, because a refusal shown on a page the actor is not
// allowed to open is a silent failure: the policy page redirects them away and the message goes
// with the redirect (review finding F-B13-02). 'policy' is the normal case, a person who may
// open the policy and got their form wrong; 'home' is the ownership refusal, where the only page
// that will render the sentence is the actor's own workspace.
export class ChangeRequestRefused extends Error {
  readonly readableFrom: "policy" | "home";

  constructor(message: string, readableFrom: "policy" | "home" = "policy") {
    super(message);
    this.readableFrom = readableFrom;
  }
}

// The other half of `readableFrom`: the workspace home of each role, which is the page that will
// certainly render a refusal for that person. Kept next to the error that asks for it rather than
// duplicated in the two routes.
export function workspaceHomeOf(role: UserRole): string {
  if (role === "customer") return "/customer";
  if (role === "broker") return "/broker";
  if (role === "staff_ops" || role === "staff_approver") return "/ops";
  return "/login"; // 'agent': no session exists, so this is unreachable rather than a real page
}

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
    throw new ChangeRequestRefused("this policy does not exist", "home");
  }
  if (input.actor.role !== "customer" || input.actor.customerId !== policy.customerId) {
    throw new ChangeRequestRefused("only the customer of this policy can ask for a change on it", "home");
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

// At least one line, every line inside the closed list, each line named once. The order is the
// order of CHANGE_REQUEST_LINES, so two identical requests store identical arrays.
//
// A REPEAT IS REFUSED, NOT FOLDED AWAY. The form cannot produce one (a checkbox is ticked or it
// is not), so a repeated value means a hand-made request, and answering it with a refusal says
// more than silently storing a shortened array the sender never asked for.
//
// KNOWN GAP, deliberately not closed: the CHECK of migration 0019 is `cardinality between 1 and
// 7` plus `lines <@ <the closed list>`, which a direct INSERT of ['other','other'] satisfies, and
// both panels would then print the label twice (review finding F-B13-04, LOW). Uniqueness is an
// application invariant here, not a database one. Migration 0019 is applied on the trial database
// and is never rewritten, and a repeat is unreachable through every door the application opens,
// so this stays as it is rather than becoming a migration on the last day.
function checkedLines(fromForm: string[]): ChangeRequestLine[] {
  const ticked = new Set(fromForm);
  if (ticked.size !== fromForm.length) {
    throw new ChangeRequestRefused("a line can only be named once in a request");
  }
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
    throw new ChangeRequestRefused("this change request does not exist on this policy", "home");
  }

  const isOwningBroker = input.actor.role === "broker" && input.actor.brokerId === request.broker_id;
  const isStaffOperations = input.actor.role === "staff_ops";
  if (!isOwningBroker && !isStaffOperations) {
    throw new ChangeRequestRefused(
      "only the broker who writes this policy, or staff operations, can answer a change request",
      "home",
    );
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
    // ANSWERED IS A ROW EXISTING, and the left join reports that with reply_id alone. Reading the
    // truthiness of the other joined columns instead would have made an answered request render
    // as open the day a replier had an empty display_name, while countOpenChangeRequests, which
    // asks `not exists` in SQL, still said zero (review finding F-B13-03). The remaining columns
    // are display values: they are not null when reply_id is not null, because the row they come
    // from declares them `not null`.
    reply:
      row.reply_id !== null
        ? {
            replyId: row.reply_id,
            outcome: row.outcome as ChangeRequestOutcome,
            text: row.reply_text as string,
            repliedByName: row.replied_by_name as string,
            recordedAt: row.reply_recorded_at as Date,
          }
        : null,
  }));
}

// The ones still waiting for the broker: no reply row exists for them.
export async function openChangeRequestsOfPolicy(policyId: string, database: Queryable = sql): Promise<ChangeRequestView[]> {
  const requests = await changeRequestsOfPolicy(policyId, database);
  return requests.filter((request) => request.reply === null);
}

// How many change requests are waiting on the policies this broker writes. Counted in the
// database rather than by folding the list, because the "what needs you" block asks for a number
// and nothing else.
export async function countOpenChangeRequests(
  { brokerId }: { brokerId: string },
  database: Queryable = sql,
): Promise<number> {
  const [row] = await database<{ waiting: string }[]>`
    select count(*) as waiting
      from policy_change_requests change_request
      join policies policy on policy.id = change_request.policy_id
     where policy.broker_id = ${brokerId}
       and not exists (
             select 1 from policy_change_request_replies reply
              where reply.request_id = change_request.id
           )
  `;
  return Number(row.waiting);
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
