import postgres from "postgres";
import { createHash, randomBytes, randomUUID } from "node:crypto";

// Proves, against a real database and through the production readers, the properties the
// operations console (slice B13-9) rests on:
//
//   1. the FEED returns the events of a known fixture, newest first, and every kind the fixture
//      wrote is represented;
//   2. the SINCE cursor is honoured: an instant after the fixture returns none of its rows;
//   3. the LATENCY tiles are numbers computed by Postgres, five of them, never NaN;
//   4. the UNKNOWN-OUTCOME rule splits an operation left in 'provider_accepted' the way it is
//      documented: under the threshold it is "checking", at or over it, an unknown outcome;
//   5. the SEARCH resolves every reference kind it claims to: pi_, cs_, re_, acct_, cmk_, a
//      uuid, a policy number, a claim number and an email;
//   6. a BROKER (and a customer, and an agent, and nobody) cannot open the console, and the MCP
//      surface exposes no console tool, so a broker's API key has no way in either;
//   7. the 360 readers of one policy return that policy's operations, webhooks, journal entries,
//      approvals and change requests, and nothing about anybody else.
//
// Every read runs with the RESTRICTED runtime role, so it also proves the console works with the
// privileges the deployed application actually has (no UPDATE, no DELETE on the money tables).
//
// IT WRITES A FIXTURE, so it refuses to run anywhere but the disposable database corgi_test.
// It seeds nothing else: it does not run scripts/seed.ts and it touches no existing row.
// Run with: npm run check:console

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on the environment
}

const ownerUrl = process.env.DATABASE_URL_TEST;
const runtimeUrl = process.env.DATABASE_URL_TEST_APP;
if (!ownerUrl || !runtimeUrl) {
  console.error("DATABASE_URL_TEST and DATABASE_URL_TEST_APP must be set: this check only runs on the disposable database");
  process.exit(1);
}

// Every call below passes its connection explicitly. This line makes a mistake harmless anyway:
// a function falling back to its default connection would still reach the disposable database.
process.env.DATABASE_URL_APP = runtimeUrl;

let failures = 0;
function report(name: string, passed: boolean, detail: string) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}  (${detail})`);
  if (!passed) failures += 1;
}

const owner = postgres(ownerUrl, { max: 2, prepare: false });
const runtime = postgres(runtimeUrl, { max: 2, prepare: false });

// One tag shared by every row this run writes, so the assertions can pick its rows out of a
// database other checks also write to.
const RUN_TAG = randomUUID().slice(0, 8);

async function main() {
  const {
    CONSOLE_EVENT_KINDS,
    MOST_DAYS_BACK,
    MOST_FEED_ROWS,
    UNKNOWN_OUTCOME_AFTER_MINUTES,
    UNRESOLVED_OPERATIONS_FLOOR_DAYS,
    acceptedAndUnconfirmedOperations,
    approvalsOfSubject,
    changeRequestsOfSubject,
    consoleFeed,
    consoleSubject,
    journalEntriesOfSubject,
    latencyTiles,
    operationsOfSubject,
    operationsProblems,
    parseSince,
    recogniseReference,
    resolveReference,
    subjectTimeline,
    webhooksTouching,
  } = await import("@/lib/console/read");
  const { consoleAccessFor } = await import("@/lib/console/access");
  const { MCP_TOOLS } = await import("@/lib/mcp/tools");

  const [{ current_database: databaseName }] = await owner<{ current_database: string }[]>`
    select current_database()
  `;
  if (databaseName !== "corgi_test") {
    console.error(`refusing to run: connected to "${databaseName}", expected the disposable database "corgi_test"`);
    process.exit(1);
  }

  // The instant just before the fixture is written. Everything the fixture does happens after it,
  // so a feed asking for "since this" must contain all of it.
  const beforeFixture = new Date(Date.now() - 1000);
  const fixture = await createFixture();
  const afterFixture = new Date(Date.now() + 1000);

  // ---------------------------------------------------------------------------
  // 1. The feed returns the fixture's events, newest first
  // ---------------------------------------------------------------------------

  const feed = await consoleFeed(runtime, { since: beforeFixture, limit: MOST_FEED_ROWS });

  const isSorted = feed.every((event, index) => index === 0 || feed[index - 1].instant.getTime() >= event.instant.getTime());
  report("the feed is sorted newest first", isSorted, `${feed.length} events`);

  report("the feed never exceeds its hard limit", feed.length <= MOST_FEED_ROWS, `${feed.length} <= ${MOST_FEED_ROWS}`);

  const ours = feed.filter(
    (event) =>
      event.policyId === fixture.policyId ||
      event.claimId === fixture.claimId ||
      event.brokerId === fixture.brokerId ||
      event.reference === fixture.paymentIntentId ||
      event.reference === fixture.checkoutSessionId ||
      event.reference === fixture.refundId ||
      event.reference === fixture.connectedAccountId ||
      event.reference === fixture.keyPrefix ||
      event.reference === fixture.changeRequestId ||
      event.reference === fixture.approvalRequestId ||
      event.reference === fixture.reconciliationRunId ||
      event.reference === fixture.webhookEventId,
  );
  const kindsSeen = new Set(ours.map((event) => event.kind));
  const kindsWritten = ["money", "webhook", "journal", "policy", "claim", "approval", "reconciliation", "mcp", "kyb", "change_request"];
  const missing = kindsWritten.filter((kind) => !kindsSeen.has(kind as (typeof CONSOLE_EVENT_KINDS)[number]));
  report(
    "every kind the fixture wrote appears in the feed",
    missing.length === 0,
    missing.length === 0 ? `${kindsSeen.size} kinds, ${ours.length} rows of this fixture` : `missing: ${missing.join(", ")}`,
  );

  const oursSorted = ours.every((event, index) => index === 0 || ours[index - 1].instant.getTime() >= event.instant.getTime());
  report("the fixture's own events are in order in the feed", oursSorted, `${ours.length} rows`);

  const noPayload = ours.every((event) => !event.detail.includes("{") && event.detail.length <= 260);
  report("no feed row carries a raw payload", noPayload, "every detail is a short sanitised sentence");

  // ---------------------------------------------------------------------------
  // 2. The since cursor
  // ---------------------------------------------------------------------------

  const emptyFeed = await consoleFeed(runtime, { since: afterFixture, limit: MOST_FEED_ROWS });
  const noneOfOurs = emptyFeed.filter((event) => event.policyId === fixture.policyId).length;
  report("a cursor after the fixture returns none of its rows", noneOfOurs === 0, `${emptyFeed.length} events, ${noneOfOurs} of ours`);

  const oneKind = await consoleFeed(runtime, { since: beforeFixture, kinds: ["money"], limit: MOST_FEED_ROWS });
  report(
    "a kind filter queries that kind only",
    oneKind.every((event) => event.kind === "money"),
    `${oneKind.length} rows, all money`,
  );

  const parsedDuration = parseSince("2h", new Date("2026-09-09T12:00:00Z"));
  report(
    "the since cursor reads a duration",
    parsedDuration.since.toISOString() === "2026-09-09T10:00:00.000Z",
    parsedDuration.since.toISOString(),
  );
  const parsedNonsense = parseSince("yesterday-ish", new Date("2026-09-09T12:00:00Z"));
  report(
    "a since cursor that is not an instant falls back to the default window",
    parsedNonsense.since.toISOString() === "2026-09-09T11:00:00.000Z",
    parsedNonsense.reading,
  );

  // Review finding F-B13-21. "999999d" is 2738 years: the instant used to be the year -712,
  // Postgres refused the parameter, and the feed and the errors panel both went dark. The floor
  // is proven here, in the pure function, so this assertion needs no database.
  const aFixedNow = new Date("2026-09-09T12:00:00Z");
  const theFloor = new Date(aFixedNow.getTime() - MOST_DAYS_BACK * 24 * 60 * 60_000);
  const parsedAbsurd = parseSince("999999d", aFixedNow);
  report(
    "a since cursor further back than the floor is clamped to it, and the reading says so",
    parsedAbsurd.since.getTime() >= theFloor.getTime() && parsedAbsurd.reading.includes("clamped"),
    `${parsedAbsurd.since.toISOString()}, floor ${theFloor.toISOString()}; reading: ${parsedAbsurd.reading}`,
  );

  // ---------------------------------------------------------------------------
  // 3. The latency tiles
  // ---------------------------------------------------------------------------

  const tiles = await latencyTiles(runtime);
  report("there are five latency tiles", tiles.length === 5, tiles.map((tile) => tile.name).join(", "));

  const tilesAreNumbers = tiles.every(
    (tile) =>
      Number.isInteger(tile.sampleCount) &&
      [tile.p50Seconds, tile.p95Seconds, tile.maxSeconds].every((value) => value === null || Number.isFinite(value)),
  );
  report("every tile is a number or an explicit absence, never NaN", tilesAreNumbers, JSON.stringify(tiles.map((tile) => [tile.name, tile.sampleCount, tile.p50Seconds])));

  const acceptanceTile = tiles.find((tile) => tile.name === "Request to provider acceptance");
  report(
    "the fixture's own request-to-acceptance pair was measured",
    (acceptanceTile?.sampleCount ?? 0) >= 1 && acceptanceTile?.p50Seconds !== null,
    `${acceptanceTile?.sampleCount ?? 0} samples, p50 ${acceptanceTile?.p50Seconds ?? "none"} s`,
  );

  // ---------------------------------------------------------------------------
  // 4. The unknown-outcome rule, both branches, on a real row
  // ---------------------------------------------------------------------------

  // recorded_at is set by the database clock and can never be written by a client (migration
  // 0002), so a fixture operation cannot be made sixteen minutes old. Running the same reader
  // with the real threshold and with a threshold of zero proves the split without backdating.
  const withRealThreshold = await acceptedAndUnconfirmedOperations(runtime, {
    limit: 200,
    thresholdMinutes: UNKNOWN_OUTCOME_AFTER_MINUTES,
  });
  const isChecking = withRealThreshold.checking.some((operation) => operation.operationId === fixture.stuckOperationId);
  const notYetUnknown = !withRealThreshold.unknownOutcome.some((operation) => operation.operationId === fixture.stuckOperationId);
  report(
    `an operation accepted a moment ago reads as "checking" under the ${UNKNOWN_OUTCOME_AFTER_MINUTES}-minute threshold`,
    isChecking && notYetUnknown,
    `checking ${withRealThreshold.checking.length}, unknown ${withRealThreshold.unknownOutcome.length}`,
  );

  const withZeroThreshold = await acceptedAndUnconfirmedOperations(runtime, { limit: 200, thresholdMinutes: 0 });
  const isUnknown = withZeroThreshold.unknownOutcome.some((operation) => operation.operationId === fixture.stuckOperationId);
  report(
    "the same operation reads as an unknown outcome once the threshold is passed",
    isUnknown,
    `${withZeroThreshold.unknownOutcome.length} unknown outcomes with a threshold of 0`,
  );

  // Review finding F-B13-50. The reader must not depend on the feed cursor: `afterFixture` is a
  // cursor the feed itself answers with none of this fixture's rows (asserted above), and the
  // same operation must still be listed as accepted and unconfirmed.
  const feedPastTheFixture = await consoleFeed(runtime, { since: afterFixture, limit: MOST_FEED_ROWS });
  const outsideTheFeedWindow = feedPastTheFixture.every((event) => event.policyId !== fixture.policyId);
  const stillInFlight = await acceptedAndUnconfirmedOperations(runtime, { limit: 200 });
  const listedAnyway = [...stillInFlight.checking, ...stillInFlight.unknownOutcome].some(
    (operation) => operation.operationId === fixture.stuckOperationId,
  );
  report(
    "an accepted and unconfirmed operation older than the feed window is still listed",
    outsideTheFeedWindow && listedAnyway,
    `the feed for that cursor shows none of the fixture's rows; the in-flight reader still lists it over its own ${UNRESOLVED_OPERATIONS_FLOOR_DAYS}-day floor`,
  );

  // The in-flight list is read once and handed to operationsProblems, which is how the page
  // does it since review finding F-B13-23: the reader is no longer called twice per render.
  const problems = await operationsProblems(runtime, {
    since: beforeFixture,
    limit: 200,
    unknownOutcome: withZeroThreshold.unknownOutcome,
  });
  const failedRunListed = problems.some((problem) => problem.family === "reconciliation" && problem.recovery.kind === "reconcile");
  report(
    "a failed reconciliation run is a problem, and its recovery is the run form that already exists",
    failedRunListed,
    `${problems.length} problems`,
  );
  const failedOperationListed = problems.some(
    (problem) => problem.family === "money" && problem.reference === fixture.failedRefundId,
  );
  report("a failed money operation is listed with its reason", failedOperationListed, fixture.failedRefundId);
  const webhookFailureListed = problems.some((problem) => problem.family === "webhook" && problem.reference === fixture.failedWebhookEventId);
  report("a webhook whose processing failed is listed with its attempts", webhookFailureListed, fixture.failedWebhookEventId);
  const mcpRefusalListed = problems.some((problem) => problem.family === "mcp" && problem.reference === fixture.keyPrefix);
  report("a refused MCP call is listed", mcpRefusalListed, fixture.keyPrefix);

  // ---------------------------------------------------------------------------
  // 5. The reference search, one assertion per recognised shape
  // ---------------------------------------------------------------------------

  const searches: [string, string, (found: Awaited<ReturnType<typeof resolveReference>>) => boolean][] = [
    ["a Stripe PaymentIntent (pi_)", fixture.paymentIntentId, (found) => found.matches.length > 0 && found.trail.length > 0],
    ["a Stripe Checkout Session (cs_)", fixture.checkoutSessionId, (found) => found.matches.length > 0],
    ["a Stripe Refund (re_)", fixture.refundId, (found) => found.matches.length > 0],
    ["a Stripe connected account (acct_)", fixture.connectedAccountId, (found) => found.matches.some((match) => match.what === "broker")],
    ["an MCP key prefix (cmk_)", fixture.keyPrefix, (found) => found.matches.some((match) => match.what === "MCP API key") && found.trail.length > 0],
    ["a policy number (CGP-)", fixture.policyNumber, (found) => found.matches.some((match) => match.what === "policy")],
    ["a claim number (CLM-)", fixture.claimNumber, (found) => found.matches.some((match) => match.what === "claim")],
    ["an email", fixture.customerEmail, (found) => found.matches.some((match) => match.what === "customer")],
    ["a uuid", fixture.policyId, (found) => found.matches.some((match) => match.what === "policy")],
  ];

  for (const [name, reference, holds] of searches) {
    const found = await resolveReference(runtime, reference);
    report(
      `the search resolves ${name}`,
      holds(found),
      `${recogniseReference(reference)} -> ${found.matches.map((match) => match.what).join(", ") || "nothing"}, ${found.trail.length} trail rows`,
    );
  }

  const nonsense = await resolveReference(runtime, "not a reference at all");
  report(
    "an unrecognised shape is named as such and queries nothing",
    nonsense.matches.length === 0 && nonsense.recognisedAs.startsWith("a shape"),
    nonsense.recognisedAs,
  );

  const unknownButWellShaped = await resolveReference(runtime, "CGP-99999");
  report(
    "a well-shaped reference that matches nothing is still named by its shape",
    unknownButWellShaped.matches.length === 0 && unknownButWellShaped.recognisedAs === "a policy number (CGP-)",
    unknownButWellShaped.recognisedAs,
  );

  // ---------------------------------------------------------------------------
  // 6. Who may open the console
  // ---------------------------------------------------------------------------

  const accessCases: [string, Parameters<typeof consoleAccessFor>[0], string][] = [
    ["staff operations", "staff_ops", "allow"],
    ["a staff approver", "staff_approver", "allow"],
    ["a broker", "broker", "/broker"],
    ["a customer", "customer", "/customer"],
    ["an agent principal", "agent", "/broker"],
    ["nobody signed in", null, "/login"],
  ];
  for (const [name, role, expected] of accessCases) {
    const decision = consoleAccessFor(role);
    report(`${name} ${expected === "allow" ? "may open" : "is sent away from"} the console`, decision === expected, `${decision}`);
  }

  // A broker's API key reaches the system through the MCP endpoint and nowhere else. The
  // endpoint can only run the tools in this list, and none of them is a console tool, so there
  // is no path from a broker key to any of the reads above.
  const consoleToolNames = MCP_TOOLS.filter((tool) => /console|feed|latency|infra/i.test(tool.name)).map((tool) => tool.name);
  report(
    "the MCP surface exposes no console tool, so an API key has no way into these reads",
    consoleToolNames.length === 0,
    `${MCP_TOOLS.length} tools: ${MCP_TOOLS.map((tool) => tool.name).join(", ")}`,
  );

  // ---------------------------------------------------------------------------
  // 7. The 360 readers of one policy
  // ---------------------------------------------------------------------------

  const subject = await consoleSubject(runtime, "policy", fixture.policyId);
  report("the policy 360 subject exists", subject !== null, subject?.title ?? "not found");
  if (!subject) {
    return;
  }

  const [operations, journal, approvals, changeRequests, timeline] = await Promise.all([
    operationsOfSubject(runtime, subject),
    journalEntriesOfSubject(runtime, subject),
    approvalsOfSubject(runtime, subject),
    changeRequestsOfSubject(runtime, subject.policyIds),
    subjectTimeline(runtime, subject),
  ]);

  report(
    "the 360 page reads this policy's money operations and nobody else's",
    operations.length >= 3 && operations.every((operation) => operation.policyId === fixture.policyId || operation.claimId === fixture.claimId),
    `${operations.length} operations`,
  );

  const succeeded = operations.find((operation) => operation.operationId === fixture.paidOperationId);
  report(
    "the two durations are subtracted by the database on a completed operation",
    succeeded !== undefined &&
      succeeded.requestedToAcceptedSeconds !== null &&
      succeeded.acceptedToSucceededSeconds !== null &&
      succeeded.requestedToAcceptedSeconds >= 0 &&
      succeeded.acceptedToSucceededSeconds >= 0,
    `${succeeded?.requestedToAcceptedSeconds ?? "none"} s then ${succeeded?.acceptedToSucceededSeconds ?? "none"} s`,
  );

  const webhooks = await webhooksTouching(
    runtime,
    operations.map((operation) => operation.providerRef).filter((reference): reference is string => reference !== null),
  );
  report(
    "the webhook that named this policy's PaymentIntent is attached to it",
    webhooks.some((webhook) => webhook.providerEventId === fixture.webhookEventId),
    `${webhooks.length} webhooks`,
  );

  report("the 360 page reads this policy's journal entries", journal.length >= 1 && journal[0].lines.length === 2, `${journal.length} entries`);
  report(
    "the journal entries balance, as the database guarantees",
    journal.every(
      (entry) =>
        entry.lines.reduce((total, line) => total + line.debitCents, 0) === entry.lines.reduce((total, line) => total + line.creditCents, 0),
    ),
    `${journal.length} entries checked`,
  );
  report("the 360 page reads this policy's approvals", approvals.some((approval) => approval.requestId === fixture.approvalRequestId), `${approvals.length} approvals`);
  report(
    "the 360 page reads this policy's change requests",
    changeRequests.some((request) => request.requestId === fixture.changeRequestId),
    `${changeRequests.length} change requests`,
  );
  report("the timeline of the policy is not empty and is sorted", timeline.length > 0 && timeline.every((event, index) => index === 0 || timeline[index - 1].instant.getTime() >= event.instant.getTime()), `${timeline.length} rows`);

  const otherSubject = await consoleSubject(runtime, "policy", fixture.otherPolicyId);
  const otherOperations = otherSubject ? await operationsOfSubject(runtime, otherSubject) : [];
  report(
    "another policy's 360 page shows none of this fixture's operations",
    otherOperations.every((operation) => operation.policyId !== fixture.policyId),
    `${otherOperations.length} operations on the other policy`,
  );

  // ---------------------------------------------------------------------------
  // 8. The console never writes
  // ---------------------------------------------------------------------------

  // Every read above ran on the restricted runtime role, which holds SELECT and INSERT and never
  // UPDATE or DELETE on the money tables (migrations 0001 to 0019). Reaching this line with all
  // the readers having answered is already the proof that the console needs no privilege it
  // should not have. The two assertions below say it explicitly.
  //
  // NOT a global row count: corgi_test is shared with the other check scripts, and one of them
  // writing while this one runs would fail an assertion about a total that was never this
  // script's business. Both checks below are about THIS run's own rows and about the privileges
  // of the role, so a concurrent writer cannot change their answer.
  const [{ mine: myOperations }] = await runtime<{ mine: number }[]>`
    select count(*)::int as mine from money_operations
     where idempotency_key like ${`console-check-${RUN_TAG}-%`}
  `;
  report(
    "the readers created no money operation of their own",
    myOperations === 3,
    `${myOperations} operations carry this run's key prefix, and the fixture wrote exactly 3`,
  );

  const [privileges] = await runtime<{ can_update: boolean; can_delete: boolean; can_select: boolean }[]>`
    select bool_or(has_table_privilege(current_user, table_name, 'UPDATE')) as can_update,
           bool_or(has_table_privilege(current_user, table_name, 'DELETE')) as can_delete,
           bool_and(has_table_privilege(current_user, table_name, 'SELECT')) as can_select
      from (values ('money_operations'), ('money_operation_events'), ('journal_entries'), ('journal_lines'),
                   ('policy_events'), ('claim_events'), ('webhook_events'), ('approval_requests'),
                   ('approval_decisions'), ('reconciliation_runs'), ('reconciliation_items'),
                   ('statement_runs'), ('mcp_api_keys'), ('mcp_calls'), ('policy_change_requests'))
             as protected (table_name)
  `;
  report(
    "the role the console reads with can SELECT every table it reads and UPDATE or DELETE none of them",
    privileges.can_select === true && privileges.can_update === false && privileges.can_delete === false,
    `select ${privileges.can_select}, update ${privileges.can_update}, delete ${privileges.can_delete}`,
  );
}

// ---------------------------------------------------------------------------
// The fixture: one broker, one customer, two policies, one claim, and one row in every table
// the console reads. No seed script, no existing row touched.
// ---------------------------------------------------------------------------

type Fixture = {
  brokerId: string;
  customerId: string;
  customerEmail: string;
  policyId: string;
  policyNumber: string;
  otherPolicyId: string;
  claimId: string;
  claimNumber: string;
  paidOperationId: string;
  stuckOperationId: string;
  paymentIntentId: string;
  checkoutSessionId: string;
  refundId: string;
  failedRefundId: string;
  connectedAccountId: string;
  keyPrefix: string;
  webhookEventId: string;
  failedWebhookEventId: string;
  approvalRequestId: string;
  changeRequestId: string;
  reconciliationRunId: string;
};

async function createFixture(): Promise<Fixture> {
  const unique = () => `console-check-${RUN_TAG}-${randomUUID().slice(0, 8)}@example.invalid`;
  const stripeId = (prefix: string) => `${prefix}_${RUN_TAG}${randomBytes(8).toString("hex")}`;
  const customerEmail = unique();
  const connectedAccountId = stripeId("acct");
  const paymentIntentId = stripeId("pi");
  const checkoutSessionId = stripeId("cs");
  const refundId = stripeId("re");
  const failedRefundId = stripeId("re");
  const keyPrefix = `cmk_${randomBytes(4).toString("hex")}`;
  const webhookEventId = stripeId("evt");
  const failedWebhookEventId = stripeId("evt");

  const fixture = await owner.begin(async (transaction) => {
    const [broker] = await transaction<{ id: string }[]>`
      insert into brokers (name, commission_rate_bps) values (${`Console check broker ${RUN_TAG}`}, 1500) returning id
    `;
    const [customer] = await transaction<{ id: string; email: string }[]>`
      insert into customers (name, email) values (${`Console Check Fabrication LLC ${RUN_TAG}`}, ${customerEmail}) returning id, email
    `;
    const [brokerUser] = await transaction<{ id: string }[]>`
      insert into users (email, display_name, role, broker_id)
      values (${unique()}, ${`Console check broker user ${RUN_TAG}`}, 'broker', ${broker.id}) returning id
    `;
    const [operationsUser] = await transaction<{ id: string }[]>`
      insert into users (email, display_name, role)
      values (${unique()}, ${`Console check operator ${RUN_TAG}`}, 'staff_ops') returning id
    `;
    const [customerUser] = await transaction<{ id: string }[]>`
      insert into users (email, display_name, role, customer_id)
      values (${unique()}, ${`Console check customer ${RUN_TAG}`}, 'customer', ${customer.id}) returning id
    `;
    const [policy] = await transaction<{ id: string; policy_number: string }[]>`
      insert into policies (broker_id, customer_id, state_code, created_by)
      values (${broker.id}, ${customer.id}, 'CA', ${brokerUser.id}) returning id, policy_number
    `;
    const [otherPolicy] = await transaction<{ id: string }[]>`
      insert into policies (broker_id, customer_id, state_code)
      values (${broker.id}, ${customer.id}, 'CA') returning id
    `;

    // policy_events: one 'quoted' row, which is what the feed's policy source reads.
    await transaction`
      insert into policy_events (policy_id, event_type, effective_at, payload, created_by)
      values (${policy.id}, 'quoted', date '2028-03-01',
              ${transaction.json({ annual_premium_cents: 120000, note: "console check fixture" })}, ${brokerUser.id})
    `;

    // broker_kyb_events: the connected account the acct_ search resolves.
    await transaction`
      insert into broker_kyb_events (broker_id, provider, status, provider_ref, payload, created_by)
      values (${broker.id}, 'stripe_connect', 'approved', ${connectedAccountId},
              ${transaction.json({ note: "console check fixture" })}, ${operationsUser.id})
    `;

    // A completed payment: requested, accepted, succeeded. It gives the latency tiles a pair and
    // the 360 page an operation with both durations.
    const [paid] = await transaction<{ id: string }[]>`
      insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key, created_by)
      values ('stripe_checkout', 'stripe', 125320, ${policy.id}, ${`console-check-${RUN_TAG}-paid`}, ${brokerUser.id})
      returning id
    `;
    for (const [status, providerRef, payload] of [
      ["requested", null, {}],
      ["provider_accepted", checkoutSessionId, { checkout_url: "https://checkout.stripe.test/session" }],
      ["succeeded", paymentIntentId, { note: "console check fixture" }],
    ] as const) {
      await transaction`
        insert into money_operation_events (operation_id, status, provider_ref, payload)
        values (${paid.id}, ${status}, ${providerRef}, ${transaction.json(payload)})
      `;
    }

    // An operation the provider accepted and that has said nothing since: the unknown-outcome rule.
    const [stuck] = await transaction<{ id: string }[]>`
      insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key)
      values ('stripe_refund', 'stripe', 8917, ${policy.id}, ${`console-check-${RUN_TAG}-stuck`})
      returning id
    `;
    await transaction`
      insert into money_operation_events (operation_id, status, provider_ref, payload)
      values (${stuck.id}, 'requested', null, '{}'::jsonb)
    `;
    await transaction`
      insert into money_operation_events (operation_id, status, provider_ref, payload)
      values (${stuck.id}, 'provider_accepted', ${refundId}, ${transaction.json({ note: "accepted, nothing since" })})
    `;

    // A refund the provider refused: the errors panel, with its sanitised reason.
    const [refused] = await transaction<{ id: string }[]>`
      insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key)
      values ('stripe_refund', 'stripe', 1200, ${policy.id}, ${`console-check-${RUN_TAG}-failed`})
      returning id
    `;
    await transaction`
      insert into money_operation_events (operation_id, status, provider_ref, payload)
      values (${refused.id}, 'failed', ${failedRefundId},
              ${transaction.json({ stage: "create_refund", reason: "the charge has already been fully refunded" })})
    `;

    // The claim and one reserve, so the claim source of the feed and the CLM- search have a row.
    const [claim] = await transaction<{ id: string; claim_number: string }[]>`
      insert into claims (policy_id, occurred_at, reported_at, description, claimant_name, created_by)
      values (${policy.id}, date '2028-05-01', date '2028-05-03', 'console check fixture loss',
              ${`Console Check Claimant ${RUN_TAG}`}, ${operationsUser.id})
      returning id, claim_number
    `;
    await transaction`
      insert into claim_events (claim_id, event_type, amount_cents, payload, created_by)
      values (${claim.id}, 'reserve_set', 500000, ${transaction.json({ note: "console check fixture" })}, ${operationsUser.id})
    `;

    // One balanced journal entry. The database refuses an unbalanced one, so writing it here is
    // itself a check that the fixture is coherent.
    const [entry] = await transaction<{ id: string }[]>`
      insert into journal_entries (entry_type, effective_at, policy_id, broker_id, source_kind, source_id, description, created_by)
      values ('premium_written', date '2028-03-01', ${policy.id}, ${broker.id}, 'money_operation', ${paid.id},
              'console check fixture: premium written', ${brokerUser.id})
      returning id
    `;
    await transaction`
      insert into journal_lines (entry_id, account_id, debit_cents, credit_cents)
      values (${entry.id}, 'premium_receivable', 120000, 0)
    `;
    await transaction`
      insert into journal_lines (entry_id, account_id, debit_cents, credit_cents)
      values (${entry.id}, 'unearned_premium', 0, 120000)
    `;

    // Two provider events: one processed, one whose processing failed after two attempts.
    const [webhook] = await transaction<{ id: string }[]>`
      insert into webhook_events (provider, provider_event_id, event_type, livemode, payload, signature_verified)
      values ('stripe', ${webhookEventId}, 'payment_intent.succeeded', false,
              ${transaction.json({ id: webhookEventId, data: { object: { id: paymentIntentId, object: "payment_intent" } } })}, true)
      returning id
    `;
    await transaction`
      insert into webhook_processing (webhook_event_id, status, attempts) values (${webhook.id}, 'done', 1)
    `;
    const [brokenWebhook] = await transaction<{ id: string }[]>`
      insert into webhook_events (provider, provider_event_id, event_type, livemode, payload, signature_verified)
      values ('stripe', ${failedWebhookEventId}, 'refund.updated', false,
              ${transaction.json({ id: failedWebhookEventId, data: { object: { id: refundId, object: "refund", payment_intent: paymentIntentId } } })}, true)
      returning id
    `;
    await transaction`
      insert into webhook_processing (webhook_event_id, status, attempts, last_error)
      values (${brokenWebhook.id}, 'failed', 2, 'console check fixture: the refund names no known operation')
    `;

    // An approval waiting for a second person, on the policy.
    const [approval] = await transaction<{ id: string }[]>`
      insert into approval_requests (kind, subject_kind, subject_id, amount_cents, intent_hash, destination, requested_by, payload)
      values ('refund', 'policy', ${policy.id}, 120000, ${createHash("sha256").update(`console-check-${RUN_TAG}`).digest("hex")},
              ${`Stripe payment ${paymentIntentId}`}, ${operationsUser.id}, ${transaction.json({ raised_by_agent: false })})
      returning id
    `;

    // An MCP key and two calls, one of them refused.
    const [apiKey] = await transaction<{ id: string }[]>`
      insert into mcp_api_keys (user_id, label, key_prefix, key_hash, principal_kind, created_by)
      values (${brokerUser.id}, ${`console check key ${RUN_TAG}`}, ${keyPrefix},
              ${createHash("sha256").update(`${keyPrefix}-console-check-${RUN_TAG}`).digest("hex")}, 'agent', ${operationsUser.id})
      returning id
    `;
    await transaction`
      insert into mcp_calls (api_key_id, method, tool, arguments_hash, outcome, detail, duration_ms)
      values (${apiKey.id}, 'tools/call', 'get_policy_as_of',
              ${createHash("sha256").update("{}").digest("hex")}, 'ok', 'console check fixture', 42)
    `;
    await transaction`
      insert into mcp_calls (api_key_id, method, tool, arguments_hash, outcome, detail, duration_ms)
      values (${apiKey.id}, 'tools/call', 'request_claim_payment',
              ${createHash("sha256").update("{}").digest("hex")}, 'refused', 'console check fixture: not allowed to see that claim', 17)
    `;

    // A failed reconciliation run: the one problem whose recovery is the run form itself.
    const [run] = await transaction<{ id: string }[]>`
      insert into reconciliation_runs (source, window_from, window_to, started_at, status, fetch_error, note)
      values ('stripe', now() - interval '7 days', now(), now() - interval '2 seconds', 'failed',
              'console check fixture: the provider did not answer', 'console check fixture')
      returning id
    `;

    // A change request the broker has not answered.
    const [changeRequest] = await transaction<{ id: string }[]>`
      insert into policy_change_requests (policy_id, requested_by, lines, comment)
      values (${policy.id}, ${customerUser.id}, array['mailing_address']::text[],
              'console check fixture: please update the mailing address of this policy')
      returning id
    `;

    return {
      brokerId: broker.id,
      customerId: customer.id,
      customerEmail: customer.email,
      policyId: policy.id,
      policyNumber: policy.policy_number,
      otherPolicyId: otherPolicy.id,
      claimId: claim.id,
      claimNumber: claim.claim_number,
      paidOperationId: paid.id,
      stuckOperationId: stuck.id,
      paymentIntentId,
      checkoutSessionId,
      refundId,
      failedRefundId,
      connectedAccountId,
      keyPrefix,
      webhookEventId,
      failedWebhookEventId,
      approvalRequestId: approval.id,
      changeRequestId: changeRequest.id,
      reconciliationRunId: run.id,
    };
  });

  return fixture;
}

main()
  .then(async () => {
    await owner.end();
    await runtime.end();
    console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (error) => {
    console.error("check failed to run:", error instanceof Error ? error.message : error);
    await owner.end();
    await runtime.end();
    process.exit(1);
  });
