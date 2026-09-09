// Deployed with the eighth tool on 2026-09-09; its production confirmation is recorded in docs/reviews.
import type postgres from "postgres";
import { claimHeader } from "@/lib/claims/read";
import {
  activityOfCorrelationId,
  activityOfSubject,
  consoleSubject,
  integrationModeOf,
  journalEntriesOfSubject,
  operationsOfSubject,
  webhooksTouching,
  type ConsoleActivity,
  type ConsoleSubject,
  type OperationWithTimeline,
} from "@/lib/console/read";
import { isUuid } from "@/lib/http/path-ids";
import { inspectionVisibilityRefusal, isStaff, referenceInBookRefusal } from "@/lib/mcp/scope";
import { policyAsItStoodOn } from "@/lib/policy/correction-read";
import { policyDetail } from "@/lib/policy/read";
import { termsInForceOn } from "@/lib/policy/terms-in-force";
import { describeAge } from "@/lib/reconciliation/breaks";
import { latestBreakReportsFor } from "@/lib/reconciliation/read";
import { brokerBookHeader, brokerBookSentence, MOST_POLICIES_OF_A_BROKER_BOOK, type FileHeader } from "./broker-book";
import { requiredText, ToolRefused, usd, type McpTool, type ToolContext } from "./tool";

// inspect_reference: one reference in, the operational file of that reference out.
//
// WHY IT EXISTS (decision 42). During an incident nobody starts from a policy number: they start
// from whatever the alert, the log line or the customer's email gave them, which is a Stripe id,
// a correlation id, a break key or an operation uuid. The console has answered that since slice
// B13-9 (/ops/console/search); an agent had no way to ask it, so it had to guess which of the
// seven other tools might know. This is the eighth tool and the first one whose argument is
// "whatever you are holding".
//
// IT READS, AND ONLY READS. Every query behind it is a SELECT, run through the console readers
// the staff screens already use, so a figure an agent quotes here is the figure a person reads on
// the same screen. No table is written, nothing is called at any provider, and the runtime role
// holds SELECT and INSERT only on every money table anyway.
//
// THE FILE IT RETURNS, in the order an investigation needs it:
//   1. what the reference resolved to, and what the shape said it was before any read;
//   2. the policy or claim it belongs to, with the terms in force TODAY, or, when the reference
//      is a broker, no policy at all and the number of policies the lists were drawn from;
//   3. the money operations, with their lifecycle instants and their terminal-preferring status;
//   4. the provider events that touched them, with no payload, ever;
//   5. the journal entries with their lines, account by account, in integer cents;
//   6. what reconciliation says about it, including a break a human has explained and the note;
//   7. the last requests the application answered about it.
//
// WHAT IT NEVER RETURNS. No provider payload (the webhook reader selects the event's identity and
// its delivery state, never `payload`), no secret, no email, no customer name, no claimant name,
// no API key beyond the public prefix a caller already holds, and no free-text sentence written
// by a caller. The activity rows come back without the actor's display name and without the
// sanitised `message` column, exactly as list_my_activity leaves them out.
//
// SCOPE, in two gates, the same shape explain_amount uses (lib/mcp/scope.ts):
//   WHO MAY INSPECT AT ALL   a broker key and a staff key, never a customer key, refused before
//                            any read at all;
//   WHICH REFERENCES         a broker key opens the references of its own book of business, and
//                            anything else is refused with one sentence that names nothing.
// Two sections are staff-only on top of that, because the surface already says so elsewhere: the
// reconciliation reports (list_reconciliation_breaks is staff-only) and the webhook inbox (no
// broker screen shows a provider event). A broker key gets those two as empty lists WITH THE
// REASON beside them, rather than an empty list that reads as "there are none".

// ---------------------------------------------------------------------------
// The bounds. Every list this tool returns is capped, and every cap is published in the
// description, so an agent never has to wonder whether it is holding all of something.
// ---------------------------------------------------------------------------
const MOST_MONEY_OPERATIONS = 20;
const MOST_WEBHOOK_EVENTS = 20;
const MOST_JOURNAL_ENTRIES = 20;
const MOST_RECONCILIATION_REPORTS = 20;
const MOST_ACTIVITY_ROWS = 20;
// The sixth bound, MOST_POLICIES_OF_A_BROKER_BOOK, is in ./broker-book with the header it shapes.

// The longest reference this tool will look at. Advertised in the schema as maxLength and
// enforced by the transport before the tool runs (lib/mcp/tools/tool.ts).
const LONGEST_REFERENCE = 200;

// ---------------------------------------------------------------------------
// The closed list of shapes, decided before the database is asked anything
// ---------------------------------------------------------------------------
//
// Same shapes as the console's own search (lib/console/read.ts, recogniseReference), minus the
// email address and plus the break key:
//
//   AN EMAIL IS NOT ACCEPTED. It resolves to a person on the console, which is a staff screen
//   behind a fold that masks it. This surface never returns an email and never takes one as a
//   way in, so the shape is simply not on the list.
//
//   A BREAK KEY IS. The console never needed it (an operator clicks the break on the board), but
//   it is the reference an agent is handed by list_reconciliation_breaks, so it is the one it
//   will want to open next.

type ReferenceShape =
  | "stripe_object"
  | "connected_account"
  | "mcp_key_prefix"
  | "policy_number"
  | "claim_number"
  | "break_key"
  | "uuid"
  | "correlation_id";

const STRIPE_OBJECT_SHAPE = /^(pi|cs|re)_[A-Za-z0-9_]{1,80}$/;
const CONNECTED_ACCOUNT_SHAPE = /^acct_[A-Za-z0-9_]{1,80}$/;
const MCP_KEY_PREFIX_SHAPE = /^cmk_[0-9a-f]{8}$/;
const POLICY_NUMBER_SHAPE = /^CGP-\d{1,10}$/i;
const CLAIM_NUMBER_SHAPE = /^CLM-\d{1,10}$/i;
// A break key is built by lib/reconciliation/breaks.ts as `<source>|op:<operation id>` for money
// our ledger knows about, and `<source>|<provider reference>` for money only the provider has.
const BREAK_KEY_SHAPE = /^(stripe|claims_rail)\|[A-Za-z0-9:._-]{1,180}$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Whatever the wrapper generated (a uuid) or whatever a caller sent in its x-request-id header,
// reduced to this character set before it was stored (lib/observability/log.ts). Tested LAST,
// because a policy number and a uuid also fit inside it and mean something more precise.
const CORRELATION_ID_SHAPE = /^[A-Za-z0-9._:-]{8,200}$/;

// What the text looks like, before the database is asked anything. Null means the shape is not on
// the closed list, which is an ANSWER ("nothing matches") and never an error: an agent holding the
// wrong string must be able to tell an empty result from a broken tool.
function shapeOf(reference: string): ReferenceShape | null {
  if (STRIPE_OBJECT_SHAPE.test(reference)) return "stripe_object";
  if (CONNECTED_ACCOUNT_SHAPE.test(reference)) return "connected_account";
  if (MCP_KEY_PREFIX_SHAPE.test(reference)) return "mcp_key_prefix";
  if (POLICY_NUMBER_SHAPE.test(reference)) return "policy_number";
  if (CLAIM_NUMBER_SHAPE.test(reference)) return "claim_number";
  if (BREAK_KEY_SHAPE.test(reference)) return "break_key";
  if (UUID_SHAPE.test(reference)) return "uuid";
  if (CORRELATION_ID_SHAPE.test(reference)) return "correlation_id";
  return null;
}

const SHAPE_MEANINGS: Record<ReferenceShape, string> = {
  stripe_object: "a Stripe PaymentIntent, Checkout Session or Refund (pi_, cs_, re_)",
  connected_account: "a Stripe connected account (acct_)",
  mcp_key_prefix: "the public prefix of an MCP API key (cmk_)",
  policy_number: "a policy number (CGP-nnnnn)",
  claim_number: "a claim number (CLM-nnnnn)",
  break_key: "a reconciliation break key (<source>|<reference>)",
  uuid: "an identifier of this application (uuid)",
  correlation_id: "the correlation id of a request",
};

// The same list, as one sentence for the description and for the answer a caller gets when it
// hands over something else entirely.
const ACCEPTED_SHAPES_SENTENCE =
  "a Stripe id (pi_, cs_, re_, acct_), a money operation, policy or claim identifier (uuid), a policy number " +
  "(CGP-nnnnn), a claim number (CLM-nnnnn), a reconciliation break key, or the correlation id of a request";

// ---------------------------------------------------------------------------
// Resolving the reference to one subject of the console
// ---------------------------------------------------------------------------
//
// Every accepted shape leads to at most one subject (a policy, a claim or a broker), and some of
// them also NARROW the file to one money operation, one break key or one request. The console's
// own readers do the rest, scoped by that subject's id lists, which is what keeps this file free
// of new SQL about money.

type Resolution = {
  // What the reference turned out to be. "nothing" when no row matched it at all.
  resolvedTo: "policy" | "claim" | "broker" | "provider_record_only" | "reconciliation_break" | "nothing";
  subject: ConsoleSubject | null;
  // Set when the reference names ONE money operation: the file is then narrowed to it.
  operationId: string | null;
  // Set when the reference IS a break key: reconciliation is asked about that key by name.
  breakKey: string | null;
  // Set when the reference names requests rather than an object.
  correlationId: string | null;
  // Set when the reference is a provider reference: the webhook inbox is asked about it even
  // when no money operation of ours ever carried it.
  providerRef: string | null;
};

const NOTHING: Resolution = {
  resolvedTo: "nothing",
  subject: null,
  operationId: null,
  breakKey: null,
  correlationId: null,
  providerRef: null,
};

async function resolve(database: postgres.Sql, reference: string, shape: ReferenceShape): Promise<Resolution> {
  if (shape === "policy_number") {
    const [row] = await database<{ id: string }[]>`
      select id from policies where policy_number = ${reference.toUpperCase()} limit 1
    `;
    return row ? subjectResolution(database, "policy", row.id) : NOTHING;
  }
  if (shape === "claim_number") {
    const [row] = await database<{ id: string }[]>`
      select id from claims where claim_number = ${reference.toUpperCase()} limit 1
    `;
    return row ? subjectResolution(database, "claim", row.id) : NOTHING;
  }
  if (shape === "stripe_object") {
    return byProviderReference(database, reference);
  }
  if (shape === "connected_account") {
    const [row] = await database<{ broker_id: string }[]>`
      select broker_id from broker_kyb_events where provider_ref = ${reference}
       order by sequence_number desc limit 1
    `;
    return row ? subjectResolution(database, "broker", row.broker_id) : NOTHING;
  }
  if (shape === "break_key") {
    return byBreakKey(database, reference);
  }
  if (shape === "uuid") {
    return byUuid(database, reference);
  }
  return byCorrelationId(database, reference);
}

// The identity band of a console subject, and the id lists every reader below is scoped by.
async function subjectResolution(
  database: postgres.Sql,
  kind: "policy" | "claim" | "broker",
  id: string,
  narrowing: Partial<Resolution> = {},
): Promise<Resolution> {
  const subject = await consoleSubject(database, kind, id);
  if (!subject) return NOTHING;
  return { ...NOTHING, resolvedTo: kind, subject, ...narrowing };
}

// pi_, cs_ and re_ all live in one column: money_operation_events.provider_ref. The operation
// names the policy or the claim, which is the subject of the file.
async function byProviderReference(database: postgres.Sql, reference: string): Promise<Resolution> {
  const [row] = await database<{ operation_id: string; policy_id: string | null; claim_id: string | null }[]>`
    select operation.id as operation_id, operation.policy_id, operation.claim_id
      from money_operation_events event
      join money_operations operation on operation.id = event.operation_id
     where event.provider_ref = ${reference}
     order by event.sequence_number
     limit 1
  `;
  if (!row) {
    // No operation of ours carries it. Before answering "nothing", ask the webhook inbox: a
    // reference the provider sent us and no operation claims is exactly the case an operator is
    // chasing when money exists at Stripe with nothing behind it here. One row is enough to know
    // the file is worth opening; the file below reads them properly, bounded.
    const touched = await webhooksTouching(database, [reference], 1);
    return touched.length === 0
      ? NOTHING
      : { ...NOTHING, resolvedTo: "provider_record_only", providerRef: reference };
  }
  const narrowing = { operationId: row.operation_id, providerRef: reference };
  if (row.claim_id) return subjectResolution(database, "claim", row.claim_id, narrowing);
  if (row.policy_id) return subjectResolution(database, "policy", row.policy_id, narrowing);
  return { ...NOTHING, resolvedTo: "provider_record_only", ...narrowing };
}

// `<source>|op:<operation id>` names our own money operation; `<source>|<provider reference>`
// names money only the provider has. Either way the break key itself is kept, so reconciliation
// is asked about that key by name even when nothing else resolves.
async function byBreakKey(database: postgres.Sql, breakKey: string): Promise<Resolution> {
  const reference = breakKey.slice(breakKey.indexOf("|") + 1);
  const resolved = reference.startsWith("op:")
    ? await byOperationIdIfItIsOne(database, reference.slice("op:".length))
    : await byProviderReference(database, reference);
  if (resolved.resolvedTo !== "nothing") {
    return { ...resolved, breakKey };
  }
  // A break key whose money our ledger has never heard of: money at the provider and nothing on
  // our side is the commonest break there is, so the file is the reconciliation report itself.
  // Asked of the same reader the file uses, so "nothing matches" here really means nothing.
  const reports = await latestBreakReportsFor(database, { breakKeys: [breakKey], ledgerRefs: [], providerRefs: [] }, 1);
  return reports.length === 0 ? NOTHING : { ...NOTHING, resolvedTo: "reconciliation_break", breakKey };
}

async function byOperationIdIfItIsOne(database: postgres.Sql, operationId: string): Promise<Resolution> {
  return isUuid(operationId) ? byOperationId(database, operationId) : NOTHING;
}

async function byOperationId(database: postgres.Sql, operationId: string): Promise<Resolution> {
  const [operation] = await database<{ id: string; policy_id: string | null; claim_id: string | null }[]>`
    select id, policy_id, claim_id from money_operations where id = ${operationId}
  `;
  if (!operation) return NOTHING;
  const narrowing = { operationId: operation.id };
  if (operation.claim_id) return subjectResolution(database, "claim", operation.claim_id, narrowing);
  if (operation.policy_id) return subjectResolution(database, "policy", operation.policy_id, narrowing);
  return { ...NOTHING, ...narrowing };
}

// One uuid, asked of each table that could own it, by primary key, first hit wins. Three small
// index lookups read better than one query trying to be clever about which table it is.
async function byUuid(database: postgres.Sql, reference: string): Promise<Resolution> {
  const [policy] = await database<{ id: string }[]>`select id from policies where id = ${reference}`;
  if (policy) return subjectResolution(database, "policy", policy.id);

  const [claim] = await database<{ id: string }[]>`select id from claims where id = ${reference}`;
  if (claim) return subjectResolution(database, "claim", claim.id);

  const operation = await byOperationId(database, reference);
  if (operation.resolvedTo !== "nothing") return operation;

  // Last, and only when the uuid is nothing else: the request wrapper generates a uuid as the
  // correlation id of a request (lib/observability/log.ts), so a uuid no table owns may still
  // name requests.
  return byCorrelationId(database, reference);
}

// A correlation id names REQUESTS, not an object. The newest of them that named an object leads
// to the file; the rows themselves are read again below, bounded.
async function byCorrelationId(database: postgres.Sql, correlationId: string): Promise<Resolution> {
  const requests = await activityOfCorrelationId(database, correlationId, MOST_ACTIVITY_ROWS);
  if (requests.length === 0) return NOTHING;
  const named = requests.find(
    (request) =>
      (request.subjectKind === "policy" || request.subjectKind === "claim" || request.subjectKind === "broker") &&
      request.subjectId !== null,
  );
  if (!named) {
    // Requests that named no object: the file is the request log and nothing else. Staff only,
    // because nobody's book owns it (lib/mcp/scope.ts, referenceInBookRefusal).
    return { ...NOTHING, resolvedTo: "provider_record_only", correlationId };
  }
  return subjectResolution(database, named.subjectKind as "policy" | "claim" | "broker", named.subjectId as string, {
    correlationId,
  });
}

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

// The header of the file: WHAT THE LISTS BELOW ARE ABOUT. There are two cases, and they do not
// answer the same question, which is the whole of review finding F-INSPECT-01.
//
//   A POLICY OR A CLAIM. One policy: its number, the status of its cache, its term and the terms
//   in force TODAY, read by the same two functions the policy screens use
//   (lib/policy/terms-in-force.ts on lib/policy/correction-read.ts), so this panel and the panel
//   at the top of /policies/{id} cannot drift apart.
//
//   A BROKER (an acct_ reference, or a correlation id whose newest object-naming request named a
//   broker). A BROKER HAS NO SINGLE POLICY: every list beside this header is read across that
//   broker's whole book, so the header names no policy at all and says how many policies those
//   lists were drawn from. The rule, and why it is the rule, are in ./broker-book.ts, which is
//   pure and is therefore proved as a rule by ./broker-book.test.ts as well as over HTTP.
//
// No header carries a customer name, a claimant name or an email: the identity band of the
// console does, because the console is a staff screen with a fold that masks them, and this
// answer has no fold and no reader who is looking at a screen.
async function belongsTo(subject: ConsoleSubject, today: string, database: postgres.Sql): Promise<FileHeader> {
  if (subject.kind === "broker") return brokerBookHeader(subject);

  const policyId = subject.policyIds[0] ?? null;
  const detail = policyId ? await policyDetail(policyId, database) : null;
  const terms = detail ? termsInForceOn(detail, await policyAsItStoodOn(detail.policyId, today, database)) : null;
  const claim = subject.kind === "claim" ? await claimHeader(subject.id, database) : null;
  return {
    kind: subject.kind,
    policyId,
    policyNumber: detail?.policyNumber ?? null,
    claimId: claim?.claimId ?? null,
    claimNumber: claim?.claimNumber ?? null,
    brokerId: subject.brokerId,
    // The status of the policy_current cache, which is a rebuildable projection and never a money
    // truth (migration 0002). Null when the policy has never been bound, so it has no cached row.
    policyStatus: detail?.status ?? null,
    term: detail ? { start: detail.effectiveAt, end: detail.termEnd } : null,
    termsInForceToday: terms
      ? {
          onDate: terms.onDate,
          annualPremium: usd(terms.annualPremiumCents),
          premiumTax: { ...usd(terms.taxCents), rateBasisPoints: terms.taxRateBps },
          policyFee: usd(terms.feeCents),
          totalCharge: usd(terms.totalChargeCents),
          coverageLimits: terms.limits.map((limit) => ({ name: limit.label, limit: usd(limit.cents) })),
        }
      : null,
    spansAWholeBrokerBook: false,
    policiesTheseListsWereDrawnFrom: null,
  };
}

function describeOperation(operation: OperationWithTimeline) {
  return {
    operationId: operation.operationId,
    kind: operation.kind,
    provider: operation.provider,
    // Which rail the money actually moved on, on the row itself (AF-02): a simulated record read
    // as a live one is the one mistake this application must never make a reader make.
    rail: integrationModeOf(operation.provider),
    amount: usd(operation.amountCents),
    createdAt: operation.createdAt.toISOString(),
    // A TERMINAL EVENT WINS over whatever was recorded after it, which is the rule the policy
    // readers apply (lib/policy/read.ts, latestStatus) and the one the console reader below
    // applies in SQL (review finding F-INT-03). Reading the last row instead would call a paid
    // operation "accepted and unconfirmed" whenever Stripe delivered two events out of order.
    latestStatus: operation.latestStatus,
    events: {
      requestedAt: instant(operation.requestedAt),
      providerAcceptedAt: instant(operation.acceptedAt),
      succeededAt: instant(operation.succeededAt),
      failedAt: instant(operation.failedAt),
    },
    providerRef: operation.providerRef,
    // One sanitised sentence cut from the failure event, never a provider payload.
    failureReason: operation.failureReason,
    approvalRequestId: operation.approvalRequestId,
    idempotencyKey: operation.idempotencyKey,
  };
}

function instant(when: Date | null): string | null {
  return when === null ? null : when.toISOString();
}

// The requests the application answered about this object, with the two columns a caller could
// otherwise mine left out on purpose: the actor's display name (a person) and the sanitised
// `message` sentence. The rule that refused a request IS returned, because it is written by this
// application and it is the whole point of the panel.
function describeActivity(row: ConsoleActivity) {
  return {
    recordedAt: row.instant.toISOString(),
    method: row.method,
    route: row.route,
    outcome: row.outcome,
    rule: row.rule,
    statusCode: row.statusCode,
    durationMs: row.durationMs,
    correlationId: row.correlationId,
    actorKind: row.actorKind,
    actorRole: row.actorRole,
  };
}

export const inspectReference: McpTool = {
  name: "inspect_reference",
  title: "Open the operational file of one reference",
  effect: "read",
  description:
    "Everything this system knows about one reference, in one answer: what it resolved to, the policy or claim it " +
    "belongs to with the terms in force today, its money operations with their lifecycle instants and terminal " +
    `status (at most ${MOST_MONEY_OPERATIONS}), the provider events that touched them (at most ${MOST_WEBHOOK_EVENTS}, ` +
    `identity and delivery state only, never a payload), the journal entries with their lines in integer cents (at ` +
    `most ${MOST_JOURNAL_ENTRIES}), what reconciliation last reported about it including a break a human has ` +
    `explained and the note they wrote (at most ${MOST_RECONCILIATION_REPORTS}), and the last ${MOST_ACTIVITY_ROWS} ` +
    `requests this application answered about it. ` +
    `A reference that resolves to a BROKER (acct_, or a correlation id whose request named a broker) opens that ` +
    `broker's whole book: the lists then span every one of its policies (at most ` +
    `${MOST_POLICIES_OF_A_BROKER_BOOK}, and the count is returned), and the file names no policy number, status or ` +
    `term, because no single policy of a book is "the" policy of figures drawn from all of them. ` +
    `"reference" is one of: ${ACCEPTED_SHAPES_SENTENCE}. An email address is not accepted and no email is ever ` +
    "returned. An MCP key prefix (cmk_) is recognised and refused, because reading an API key is never delegated to " +
    "an agent. A reference that matches nothing answers a result saying so, not an error. A broker key opens the " +
    "references of its own book of business and nothing else; a customer key is refused the whole tool; the " +
    "reconciliation reports and the provider events are staff keys only. Reads only.",
  annotations: {
    // Published for the same reason explain_amount publishes its figure keys: a client that reads
    // annotations learns the closed list without a round trip and without guessing.
    acceptedReferenceShapes: Object.entries(SHAPE_MEANINGS).map(([shape, meaning]) => ({ shape, meaning })),
    rolesThatMayInspect: ["broker", "staff_ops", "staff_approver"],
    bounds: {
      moneyOperations: MOST_MONEY_OPERATIONS,
      webhookEvents: MOST_WEBHOOK_EVENTS,
      journalEntries: MOST_JOURNAL_ENTRIES,
      reconciliationReports: MOST_RECONCILIATION_REPORTS,
      activity: MOST_ACTIVITY_ROWS,
      policiesOfABrokerBook: MOST_POLICIES_OF_A_BROKER_BOOK,
    },
  },
  inputSchema: {
    type: "object",
    properties: {
      reference: {
        type: "string",
        minLength: 1,
        maxLength: LONGEST_REFERENCE,
        description: `The reference to open. One of: ${ACCEPTED_SHAPES_SENTENCE}.`,
      },
    },
    required: ["reference"],
    additionalProperties: false,
  },
  async run(args, context) {
    const reference = requiredText(args, "reference");

    // The role gate BEFORE anything is looked up: it does not depend on the reference, and asking
    // it first means a customer key gets the same sentence for every reference, existing or not.
    const roleRefusal = inspectionVisibilityRefusal(context.user);
    if (roleRefusal) {
      throw new ToolRefused(roleRefusal);
    }

    const shape = shapeOf(reference);
    if (shape === null) {
      return nothingMatches(reference, "a shape this tool does not accept");
    }
    if (shape === "mcp_key_prefix") {
      // The never-delegated list says "create, revoke or read an MCP API key", and it did not have
      // to move to make room for this tool. A key prefix is recognised so the refusal can say
      // WHY rather than pretending the reference means nothing.
      throw new ToolRefused(
        "reading an MCP API key is never delegated to an agent: a key names the user whose visibility it borrows, " +
          "and that is exactly what a caller must not be able to look up. Keys are read by staff on /ops/mcp-keys. " +
          "This key's own calls are on list_my_activity.",
      );
    }

    const resolution = await resolve(context.database, reference, shape);
    if (resolution.resolvedTo === "nothing") {
      return nothingMatches(reference, SHAPE_MEANINGS[shape]);
    }

    // The book gate. A reference outside this key's own book is refused with one sentence that
    // names nothing about it: not the kind, not the number, not the amount, not the owner.
    const scopeRefusal = referenceInBookRefusal(context.user, resolution.subject?.brokerId ?? null);
    if (scopeRefusal) {
      throw new ToolRefused(scopeRefusal);
    }
    const staff = isStaff(context.user);

    const file = await readTheFile(resolution, context, staff);
    return {
      reference,
      recognisedAs: SHAPE_MEANINGS[shape],
      resolvedTo: resolution.resolvedTo,
      narrowedToOneMoneyOperation: resolution.operationId,
      ...file,
    };
  },
};

// A reference nothing matched. It is an ANSWER: an agent must be able to tell "I looked and there
// is nothing" from "the tool broke", and a refusal would read as the second.
//
// ONE SENTENCE AND NOTHING ELSE (decision 53, Yoann). This answer used to repeat the closed list
// of accepted shapes, which is already published twice for anyone who needs it: in the tool
// description and in the `reference` schema, both read at tools/list before any call. Repeating it
// here made the one thing the caller asked ("is there a row?") the shortest part of the answer.
// The list stays where it belongs; this stays the answer to the question.
const NOTHING_MATCHES_SENTENCE = "Nothing in this database matches that reference.";

function nothingMatches(reference: string, recognisedAs: string) {
  return {
    reference,
    recognisedAs,
    resolvedTo: "nothing",
    found: false,
    whatThisMeans: NOTHING_MATCHES_SENTENCE,
  };
}

async function readTheFile(resolution: Resolution, context: ToolContext, staff: boolean) {
  const { subject } = resolution;
  const today = context.now.toISOString().slice(0, 10);

  // The money operations of the subject, then narrowed to the one the reference named when it
  // named one. The console reader already prefers a terminal status and subtracts the durations
  // in SQL, so nothing about an operation is computed a second time here.
  const allOperations = subject ? await operationsOfSubject(context.database, subject, MOST_MONEY_OPERATIONS) : [];
  const operations = resolution.operationId
    ? allOperations.filter((operation) => operation.operationId === resolution.operationId)
    : allOperations;

  // The provider references this file is about: the ones its operations carry, plus the one the
  // reference itself was when it was a provider reference.
  const providerRefs = [
    ...operations.map((operation) => operation.providerRef),
    resolution.providerRef,
  ].filter((value): value is string => value !== null && value !== "");

  const [webhookEvents, journalEntries, reconciliationReports, activity] = await Promise.all([
    staff ? webhooksTouching(context.database, providerRefs, MOST_WEBHOOK_EVENTS) : Promise.resolve([]),
    subject ? journalEntriesOfSubject(context.database, subject, MOST_JOURNAL_ENTRIES) : Promise.resolve([]),
    staff
      ? latestBreakReportsFor(
          context.database,
          {
            breakKeys: resolution.breakKey ? [resolution.breakKey] : [],
            ledgerRefs: operations.map((operation) => operation.operationId),
            providerRefs,
          },
          MOST_RECONCILIATION_REPORTS,
        )
      : Promise.resolve([]),
    resolution.correlationId
      ? activityOfCorrelationId(context.database, resolution.correlationId, MOST_ACTIVITY_ROWS)
      : subject
        ? activityOfSubject(context.database, subject, MOST_ACTIVITY_ROWS)
        : Promise.resolve([]),
  ]);

  const header = subject ? await belongsTo(subject, today, context.database) : null;

  return {
    found: true,
    belongsTo: header,
    moneyOperations: operations.map(describeOperation),
    webhookEvents: webhookEvents.map((event) => ({
      webhookEventId: event.webhookEventId,
      provider: event.provider,
      rail: integrationModeOf(event.provider),
      providerEventId: event.providerEventId,
      type: event.eventType,
      receivedAt: event.receivedAt.toISOString(),
      // The delivery row's own instant, which for a row that reads 'done' is when it was
      // processed. Null when nothing has tried to process the event yet.
      processingLastChangedAt: instant(event.processingLastChangedAt),
      outcome: event.status ?? "not processed yet",
      attempts: event.attempts,
      // One sanitised sentence the processor wrote, cut by the reader. Never a payload.
      lastError: event.lastError,
      objectId: event.objectId,
    })),
    journalEntries: journalEntries.map((entry) => ({
      journalEntryId: entry.entryId,
      entryType: entry.entryType,
      effectiveAt: entry.effectiveAt,
      recordedAt: entry.recordedAt.toISOString(),
      reversesEntryId: entry.reversesEntryId,
      lines: entry.lines.map((line) => ({
        accountCode: line.accountId,
        accountName: line.accountName,
        debit: usd(line.debitCents),
        credit: usd(line.creditCents),
      })),
    })),
    reconciliationReports: reconciliationReports.map((report) => ({
      breakKey: report.breakKey,
      source: report.source,
      classification: report.classification,
      runId: report.runId,
      reportedAt: report.lastReportedAt.toISOString(),
      firstSeenAt: report.firstSeenAt.toISOString(),
      openFor: describeAge(report.firstSeenAt, context.now),
      providerRef: report.providerRef,
      ledgerRef: report.ledgerRef,
      providerAmount: report.providerAmountCents === null ? null : usd(report.providerAmountCents),
      ledgerAmount: report.ledgerAmountCents === null ? null : usd(report.ledgerAmountCents),
      difference: report.differenceCents === null ? null : usd(report.differenceCents),
      meaning: report.note,
      isBreakToActOn: report.isBreakToActOn,
      isProbeFromACheckRun: report.isProbeFromACheckRun,
      explainedNote: report.explanation
        ? {
            note: report.explanation.note,
            byName: report.explanation.explainedByName,
            at: report.explanation.recordedAt.toISOString(),
          }
        : null,
    })),
    activity: activity.map(describeActivity),
    bounds: {
      moneyOperations: MOST_MONEY_OPERATIONS,
      webhookEvents: MOST_WEBHOOK_EVENTS,
      journalEntries: MOST_JOURNAL_ENTRIES,
      reconciliationReports: MOST_RECONCILIATION_REPORTS,
      activity: MOST_ACTIVITY_ROWS,
      policiesOfABrokerBook: MOST_POLICIES_OF_A_BROKER_BOOK,
    },
    // An empty list because of a rule is not an empty list because there is nothing. Said out
    // loud, so an agent never reports "no reconciliation break" when it was simply not allowed
    // to look.
    sectionsThisKeyMayNotRead: staff
      ? []
      : [
          "webhookEvents: the provider inbox is staff only; no broker screen shows a provider event",
          "reconciliationReports: reconciliation is staff only, exactly as list_reconciliation_breaks is",
        ],
    whatThisMeans: whatThisMeans(
      resolution,
      header,
      operations.length,
      journalEntries.length,
      reconciliationReports.length,
      staff,
    ),
  };
}

function whatThisMeans(
  resolution: Resolution,
  header: FileHeader | null,
  operationCount: number,
  journalEntryCount: number,
  reportCount: number,
  staff: boolean,
): string {
  // A broker file says FIRST that it is a book and not a policy: a reader who stops after one
  // sentence must not walk away holding a policy this answer never named (F-INSPECT-01).
  const subjectSentence =
    header?.spansAWholeBrokerBook === true
      ? brokerBookSentence(header.policiesTheseListsWereDrawnFrom ?? 0)
      : resolution.resolvedTo === "provider_record_only" || resolution.resolvedTo === "reconciliation_break"
        ? "This reference matches no policy and no claim of ours: it is a record the provider has, a break our ledger " +
          "cannot explain, or a request that named no object. That is a finding, not an empty answer."
        : `This reference belongs to a ${resolution.resolvedTo}.`;
  return (
    `${subjectSentence} ` +
    `${operationCount} money operation(s), ${journalEntryCount} journal entr(ies) and ${reportCount} reconciliation ` +
    `report(s) are on this file, each list bounded and the bounds returned beside it. ` +
    "Every figure is in integer US cents and comes from the ledger, not from a provider balance. " +
    "Reading this changes nothing: this tool only runs SELECT, and no payload, secret or email is in the answer. " +
    (staff
      ? "A reconciliation report marked isBreakToActOn false is a probe from a check run or a break a human has explained, and the note says which."
      : "This key is a broker key: the provider events and the reconciliation reports were not read at all, which is why those lists are empty.")
  );
}
