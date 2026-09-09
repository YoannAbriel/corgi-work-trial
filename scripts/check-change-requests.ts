import postgres from "postgres";
import type { UserRole } from "@/lib/auth/current-user";
import type { ChangeRequestActor } from "@/lib/policy/change-requests";

// Proves, against a real database and through the production functions, the properties slice
// B13-6 rests on:
//
//   1. only the customer of a policy can ask for a change on it: a customer of another policy,
//      the broker, staff and an agent principal are all refused;
//   2. only the broker who writes the policy, or staff operations, can answer: another broker,
//      the customer and a staff approver are refused;
//   3. a request is answered ONCE, and it is the database that says so: the second answer is
//      refused by the unique constraint of migration 0019, not by a check in the application;
//   4. the count behind the broker's "what needs you" block follows the requests of that
//      broker's policies and nobody else's, and drops when the answer is written;
//   5. UPDATE and DELETE are refused on both tables, with the restricted runtime role AND with
//      the owner role, so nobody can rewrite what a customer asked or what a broker answered;
//   6. recorded_at is set from the database clock, so a client value is ignored;
//   7. the closed list of lines is enforced by the database too: a forged array is refused even
//      on a direct INSERT that never passes through the application.
//
// It runs the production functions with the RESTRICTED runtime role, so it also proves that all
// of this works with the privileges the deployed application actually has.
//
// It commits rows, so it refuses to run anywhere but the disposable database corgi_test.
// Run with: npm run check:change-requests

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

// Every call below passes its connection explicitly, so the shared application pool is never
// used. This line makes the mistake harmless anyway: if a function ever fell back to its default
// connection, that connection would still be the disposable database, never the trial one.
process.env.DATABASE_URL_APP = runtimeUrl;

let failures = 0;
function report(name: string, passed: boolean, detail: string) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}  (${detail})`);
  if (!passed) failures += 1;
}

const owner = postgres(ownerUrl, { max: 2, prepare: false });
const runtime = postgres(runtimeUrl, { max: 2, prepare: false });

const COMMENT = "we have moved to 214 Bryant Street, please update the mailing address";
const SECOND_COMMENT = "the aggregate limit should cover the new workshop from June 9";

async function main() {
  // Imported here rather than at the top of the file: the module opens the application
  // connection pool as soon as it is loaded, which needs the environment read first.
  const {
    ChangeRequestRefused,
    createChangeRequest,
    replyToChangeRequest,
    changeRequestsOfPolicy,
    openChangeRequestsOfPolicy,
    countOpenChangeRequests,
  } = await import("@/lib/policy/change-requests");

  // Where a refusal can be read. An ownership refusal cannot be shown on the policy page, because
  // that page redirects the person away and the message goes with the redirect (F-B13-02).
  const refusalPlace = async (attempt: () => Promise<unknown>): Promise<string> => {
    try {
      await attempt();
      return "NOTHING WAS REFUSED";
    } catch (error) {
      return error instanceof ChangeRequestRefused ? error.readableFrom : "not a change request refusal";
    }
  };

  const [{ current_database: databaseName }] = await owner<{ current_database: string }[]>`
    select current_database()
  `;
  if (databaseName !== "corgi_test") {
    console.error(`refusing to run: connected to "${databaseName}", expected the disposable database "corgi_test"`);
    process.exit(1);
  }

  const fixture = await createFixture();
  const customer = actor(fixture.customerUserId, "customer", null, fixture.customerId);
  const otherCustomer = actor(fixture.otherCustomerUserId, "customer", null, fixture.otherCustomerId);
  const broker = actor(fixture.brokerUserId, "broker", fixture.brokerId, null);
  const otherBroker = actor(fixture.otherBrokerUserId, "broker", fixture.otherBrokerId, null);
  const operations = actor(fixture.operationsUserId, "staff_ops", null, null);
  const approver = actor(fixture.approverUserId, "staff_approver", null, null);
  const agent = actor(fixture.agentUserId, "agent", null, null);

  // ---------------------------------------------------------------------------
  // 1. Who may ask
  // ---------------------------------------------------------------------------

  const openBefore = await countOpenChangeRequests({ brokerId: fixture.brokerId }, runtime);

  const created = await createChangeRequest(
    { policyId: fixture.policyId, lines: ["mailing_address", "other"], comment: COMMENT, actor: customer },
    runtime,
  );
  report("the customer of the policy can ask for a change", Boolean(created.requestId), created.requestId);

  for (const [name, who] of [
    ["a customer of another policy", otherCustomer],
    ["the broker who writes the policy", broker],
    ["staff operations", operations],
    ["an agent principal", agent],
  ] as const) {
    const refusal = await refused(() =>
      createChangeRequest({ policyId: fixture.policyId, lines: ["annual_premium"], comment: COMMENT, actor: who }, runtime),
    );
    report(`${name} cannot ask for a change on it`, /only the customer of this policy/.test(refusal), refusal);
  }

  // ---------------------------------------------------------------------------
  // 2. What a request must say
  // ---------------------------------------------------------------------------

  const noLine = await refused(() =>
    createChangeRequest({ policyId: fixture.policyId, lines: [], comment: COMMENT, actor: customer }, runtime),
  );
  report("a request with no line ticked is refused", /tick at least one line/.test(noLine), noLine);

  const repeatedLine = await refused(() =>
    createChangeRequest(
      { policyId: fixture.policyId, lines: ["other", "other"], comment: COMMENT, actor: customer },
      runtime,
    ),
  );
  report("a line named twice is refused by the application", /only be named once/.test(repeatedLine), repeatedLine);

  const forgedLine = await refused(() =>
    createChangeRequest({ policyId: fixture.policyId, lines: ["broker_commission"], comment: COMMENT, actor: customer }, runtime),
  );
  report("a line outside the list is refused by the application", /not a line of this policy/.test(forgedLine), forgedLine);

  // The same forgery, straight into the table, with no application code in the way.
  const forgedInDatabase = await refused(
    () => owner`
      insert into policy_change_requests (policy_id, requested_by, lines, comment)
      values (${fixture.policyId}, ${fixture.customerUserId}, ${["broker_commission"]}, ${COMMENT})
    `,
  );
  report(
    "a line outside the list is refused by the database too",
    /policy_change_requests_lines_check|violates check constraint/.test(forgedInDatabase),
    forgedInDatabase,
  );

  const tooShort = await refused(() =>
    createChangeRequest({ policyId: fixture.policyId, lines: ["annual_premium"], comment: "too short", actor: customer }, runtime),
  );
  report("a comment under ten characters is refused", /at least 10 characters/.test(tooShort), tooShort);

  const ownershipPlace = await refusalPlace(() =>
    createChangeRequest({ policyId: fixture.policyId, lines: ["annual_premium"], comment: COMMENT, actor: otherCustomer }, runtime),
  );
  report("an ownership refusal is sent to the actor's own workspace, not to a page they cannot open", ownershipPlace === "home", ownershipPlace);

  const formPlace = await refusalPlace(() =>
    createChangeRequest({ policyId: fixture.policyId, lines: [], comment: COMMENT, actor: customer }, runtime),
  );
  report("a form refusal stays on the policy page, where the form is", formPlace === "policy", formPlace);

  const tooLong = await refused(() =>
    createChangeRequest(
      { policyId: fixture.policyId, lines: ["annual_premium"], comment: "x".repeat(501), actor: customer },
      runtime,
    ),
  );
  report("a comment over five hundred characters is refused", /under 500 characters/.test(tooLong), tooLong);

  // ---------------------------------------------------------------------------
  // 3. The count the broker's block shows
  // ---------------------------------------------------------------------------

  const openAfterOne = await countOpenChangeRequests({ brokerId: fixture.brokerId }, runtime);
  report("the open count moves by one for the broker who writes the policy", openAfterOne === openBefore + 1, `${openBefore} then ${openAfterOne}`);

  const otherBrokerCount = await countOpenChangeRequests({ brokerId: fixture.otherBrokerId }, runtime);
  const otherBrokerRequest = await createChangeRequest(
    { policyId: fixture.otherPolicyId, lines: ["effective_date"], comment: SECOND_COMMENT, actor: otherCustomer },
    runtime,
  );
  const brokerCountAfterOtherRequest = await countOpenChangeRequests({ brokerId: fixture.brokerId }, runtime);
  const otherBrokerCountAfter = await countOpenChangeRequests({ brokerId: fixture.otherBrokerId }, runtime);
  report(
    "a request on another broker's policy does not move this broker's count",
    brokerCountAfterOtherRequest === openAfterOne && otherBrokerCountAfter === otherBrokerCount + 1,
    `this broker ${brokerCountAfterOtherRequest}, other broker ${otherBrokerCount} then ${otherBrokerCountAfter}`,
  );

  const openList = await openChangeRequestsOfPolicy(fixture.policyId, runtime);
  report(
    "the request is open, with the lines and the comment it was sent with",
    openList.length === 1 &&
      openList[0].requestId === created.requestId &&
      openList[0].lines.join(",") === "mailing_address,other" &&
      openList[0].comment === COMMENT &&
      openList[0].reply === null,
    `${openList.length} open, lines ${openList[0]?.lines.join(",")}`,
  );

  // ---------------------------------------------------------------------------
  // 4. Who may answer
  // ---------------------------------------------------------------------------

  for (const [name, who] of [
    ["a broker who does not write this policy", otherBroker],
    ["the customer", customer],
    ["a staff approver", approver],
  ] as const) {
    const refusal = await refused(() =>
      replyToChangeRequest(
        { policyId: fixture.policyId, requestId: created.requestId, outcome: "answered", text: "no", actor: who },
        runtime,
      ),
    );
    report(`${name} cannot answer the request`, /only the broker who writes this policy/.test(refusal), refusal);
  }

  const wrongPolicy = await refused(() =>
    replyToChangeRequest(
      { policyId: fixture.otherPolicyId, requestId: created.requestId, outcome: "answered", text: "no", actor: otherBroker },
      runtime,
    ),
  );
  report(
    "a request cannot be answered through another policy's URL",
    /does not exist on this policy/.test(wrongPolicy),
    wrongPolicy,
  );

  const badOutcome = await refused(() =>
    replyToChangeRequest(
      { policyId: fixture.policyId, requestId: created.requestId, outcome: "closed", text: "no", actor: broker },
      runtime,
    ),
  );
  report("an outcome outside the two allowed is refused", /answer or a change you have made/.test(badOutcome), badOutcome);

  const emptyAnswer = await refused(() =>
    replyToChangeRequest(
      { policyId: fixture.policyId, requestId: created.requestId, outcome: "answered", text: "   ", actor: broker },
      runtime,
    ),
  );
  report("an empty answer is refused", /write an answer/.test(emptyAnswer), emptyAnswer);

  const reply = await replyToChangeRequest(
    {
      policyId: fixture.policyId,
      requestId: created.requestId,
      outcome: "done",
      text: "the mailing address is now 214 Bryant Street, endorsed today",
      actor: broker,
    },
    runtime,
  );
  report("the broker who writes the policy answers it", Boolean(reply.replyId), reply.replyId);

  // ---------------------------------------------------------------------------
  // 5. One answer, and the database is what says so
  // ---------------------------------------------------------------------------

  const secondThroughTheApplication = await refused(() =>
    replyToChangeRequest(
      { policyId: fixture.policyId, requestId: created.requestId, outcome: "answered", text: "second try", actor: operations },
      runtime,
    ),
  );
  report(
    "a second answer is refused, whoever writes it",
    /already been answered/.test(secondThroughTheApplication),
    secondThroughTheApplication,
  );

  const secondInDatabase = await refused(
    () => runtime`
      insert into policy_change_request_replies (request_id, replied_by, outcome, reply_text)
      values (${created.requestId}, ${fixture.operationsUserId}, 'answered', 'straight into the table')
    `,
  );
  report(
    "the second answer is refused by the database, not by the application",
    /duplicate key value|unique constraint/.test(secondInDatabase),
    secondInDatabase,
  );

  const answered = await changeRequestsOfPolicy(fixture.policyId, runtime);
  const answeredRequest = answered.find((request) => request.requestId === created.requestId);
  report(
    "the request now reads with its one answer",
    answeredRequest?.reply?.outcome === "done" && answeredRequest.reply.text.startsWith("the mailing address"),
    `${answeredRequest?.reply?.outcome}, by ${answeredRequest?.reply?.repliedByName}`,
  );

  const openAfterAnswer = await countOpenChangeRequests({ brokerId: fixture.brokerId }, runtime);
  report("the answered request leaves the broker's count", openAfterAnswer === openBefore, `${openAfterOne} then ${openAfterAnswer}`);

  // Staff operations answer too: the same door, a different person.
  const staffReply = await replyToChangeRequest(
    {
      policyId: fixture.otherPolicyId,
      requestId: otherBrokerRequest.requestId,
      outcome: "answered",
      text: "your broker will confirm the new effective date this week",
      actor: operations,
    },
    runtime,
  );
  report("staff operations can answer a request on any policy", Boolean(staffReply.replyId), staffReply.replyId);

  // F-B13-03: "answered" is the existence of the reply row, not the truthiness of the display
  // names joined next to it. users.display_name is `not null` with no non-empty CHECK, so an
  // operator whose name is the empty string used to make an answered request render as open.
  const [namelessOperator] = await owner<{ id: string }[]>`
    insert into users (email, display_name, role)
    values ('change-requests-check-' || gen_random_uuid()::text || '@example.invalid', '', 'staff_ops')
    returning id
  `;
  const requestAnsweredByANamelessOperator = await createChangeRequest(
    { policyId: fixture.policyId, lines: ["insured_name"], comment: COMMENT, actor: customer },
    runtime,
  );
  await replyToChangeRequest(
    {
      policyId: fixture.policyId,
      requestId: requestAnsweredByANamelessOperator.requestId,
      outcome: "answered",
      text: "noted, your broker will confirm",
      actor: actor(namelessOperator.id, "staff_ops", null, null),
    },
    runtime,
  );
  const withANamelessReplier = (await changeRequestsOfPolicy(fixture.policyId, runtime)).find(
    (request) => request.requestId === requestAnsweredByANamelessOperator.requestId,
  );
  const stillOpen = await openChangeRequestsOfPolicy(fixture.policyId, runtime);
  report(
    "a reply from an operator with an empty display name still reads as answered",
    withANamelessReplier?.reply !== null &&
      stillOpen.every((request) => request.requestId !== requestAnsweredByANamelessOperator.requestId),
    `reply ${withANamelessReplier?.reply === null ? "missing" : "read"}, ${stillOpen.length} still open on the policy`,
  );

  // ---------------------------------------------------------------------------
  // 6. Nothing can be rewritten, by anybody
  // ---------------------------------------------------------------------------

  for (const [role, connection] of [
    ["the runtime role", runtime],
    ["the owner role", owner],
  ] as const) {
    const updatedRequest = await refused(
      () => connection`update policy_change_requests set comment = 'rewritten' where id = ${created.requestId}`,
    );
    report(`UPDATE on a change request is refused for ${role}`, isRefusal(updatedRequest), updatedRequest);

    const deletedRequest = await refused(
      () => connection`delete from policy_change_requests where id = ${created.requestId}`,
    );
    report(`DELETE on a change request is refused for ${role}`, isRefusal(deletedRequest), deletedRequest);

    const updatedReply = await refused(
      () => connection`update policy_change_request_replies set reply_text = 'rewritten' where id = ${reply.replyId}`,
    );
    report(`UPDATE on an answer is refused for ${role}`, isRefusal(updatedReply), updatedReply);

    const deletedReply = await refused(() => connection`delete from policy_change_request_replies where id = ${reply.replyId}`);
    report(`DELETE on an answer is refused for ${role}`, isRefusal(deletedReply), deletedReply);
  }

  const [survivor] = await owner<{ comment: string; reply_text: string }[]>`
    select change_request.comment, reply.reply_text
      from policy_change_requests change_request
      join policy_change_request_replies reply on reply.request_id = change_request.id
     where change_request.id = ${created.requestId}
  `;
  report(
    "the original words survived every attempt",
    survivor.comment === COMMENT && survivor.reply_text.startsWith("the mailing address"),
    `${survivor.comment.slice(0, 30)}...`,
  );

  // ---------------------------------------------------------------------------
  // 7. The recording time comes from the database clock
  // ---------------------------------------------------------------------------

  const [backdated] = await runtime<{ recorded_at: Date }[]>`
    insert into policy_change_requests (policy_id, requested_by, lines, comment, recorded_at)
    values (${fixture.policyId}, ${fixture.customerUserId}, ${["other"]}, ${COMMENT}, '2000-01-01T00:00:00Z')
    returning recorded_at
  `;
  const secondsSince = (Date.now() - backdated.recorded_at.getTime()) / 1000;
  report(
    "a client-supplied recorded_at is ignored: the database clock wins",
    Math.abs(secondsSince) < 120,
    `${backdated.recorded_at.toISOString()}, ${secondsSince.toFixed(1)}s from now`,
  );

  // ---------------------------------------------------------------------------
  // 8. The gap this slice leaves open, stated rather than hidden
  // ---------------------------------------------------------------------------

  // F-B13-04, LOW: the CHECK of migration 0019 counts and contains, it does not forbid a repeat,
  // so a direct INSERT can still store ['other','other'] and both panels would print the label
  // twice. Uniqueness is an application invariant here, not a database one. This runs last,
  // because it stores a row. Migration 0019 is applied on the trial database and is not rewritten.
  const repeatedInDatabase = await refused(
    () => owner`
      insert into policy_change_requests (policy_id, requested_by, lines, comment)
      values (${fixture.policyId}, ${fixture.customerUserId}, ${["other", "other"]}, ${COMMENT})
    `,
  );
  report(
    "known gap, stated: the database still accepts a repeated line on a direct INSERT",
    repeatedInDatabase === "NOTHING WAS REFUSED: the call succeeded",
    repeatedInDatabase,
  );

  // ---------------------------------------------------------------------------
  // 9. The customer's timeline never reprints what an operator typed
  // ---------------------------------------------------------------------------

  // F-B13-06: a correction reason is written by a staff operator FOR operations, and on the trial
  // data it names a payment intent, a review finding and "the coordinator". The customer reads
  // the correction, its two dates and its amounts; never those words.
  const { policyTimeline } = await import("@/lib/policy/correction-read");
  const OPERATOR_WORDS = "Reversed by the coordinator per review finding F-B2-01 (pi_local_reference)";
  await runtime`
    insert into policy_events (policy_id, event_type, effective_at, payload)
    values (${fixture.policyId}, 'correction_reversal', '2028-03-01',
            ${runtime.json({ reason: OPERATOR_WORDS })})
  `;
  const forTheOperator = await policyTimeline(fixture.policyId, runtime, "operator");
  const forTheCustomer = await policyTimeline(fixture.policyId, runtime, "customer");
  const correctionForTheOperator = forTheOperator.find((row) => row.eventType === "correction_reversal");
  const correctionForTheCustomer = forTheCustomer.find((row) => row.eventType === "correction_reversal");
  report(
    "the operator reads the correction reason as it was typed",
    correctionForTheOperator?.summary.includes(OPERATOR_WORDS) === true,
    correctionForTheOperator?.summary ?? "no correction row",
  );
  report(
    "the customer reads the same correction without the operator's words or the internal references",
    correctionForTheCustomer !== undefined &&
      !correctionForTheCustomer.summary.includes(OPERATOR_WORDS) &&
      !/pi_local|F-B2-01|coordinator/.test(correctionForTheCustomer.summary) &&
      correctionForTheCustomer.summary.startsWith("Correction:"),
    correctionForTheCustomer?.summary ?? "no correction row",
  );
  report(
    "both audiences see the same events and the same dates",
    forTheOperator.length === forTheCustomer.length &&
      forTheOperator.every((row, index) => row.eventId === forTheCustomer[index].eventId && row.effectiveAt === forTheCustomer[index].effectiveAt),
    `${forTheOperator.length} events on both sides`,
  );
}

// A permission refusal (the runtime role has no such grant) or a trigger refusal (the owner has
// the grant and the trigger raises anyway). Both mean the row cannot be changed.
function isRefusal(message: string): boolean {
  return /permission denied|append-only|cannot be changed|is immutable/.test(message);
}

function actor(userId: string, role: UserRole, brokerId: string | null, customerId: string | null): ChangeRequestActor {
  return { userId, role, brokerId, customerId };
}

// Runs something that must fail and returns its message. A call that unexpectedly succeeds
// returns a sentence that no report() pattern matches, so the check fails rather than passing on
// silence.
async function refused(attempt: () => Promise<unknown>): Promise<string> {
  try {
    await attempt();
    return "NOTHING WAS REFUSED: the call succeeded";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// Two brokers, two customers, two policies, and the staff and agent principals the refusals need.
// No money, no policy event, no journal entry: this slice touches none of them.
async function createFixture(): Promise<{
  brokerId: string;
  brokerUserId: string;
  otherBrokerId: string;
  otherBrokerUserId: string;
  customerId: string;
  customerUserId: string;
  otherCustomerId: string;
  otherCustomerUserId: string;
  operationsUserId: string;
  approverUserId: string;
  agentUserId: string;
  policyId: string;
  otherPolicyId: string;
}> {
  return owner.begin(async (transaction) => {
    const unique = () => `change-requests-check-${crypto.randomUUID()}@example.invalid`;

    const [broker] = await transaction<{ id: string }[]>`
      insert into brokers (name, commission_rate_bps) values ('Change request check broker', 1500) returning id
    `;
    const [otherBroker] = await transaction<{ id: string }[]>`
      insert into brokers (name, commission_rate_bps) values ('Change request check other broker', 1500) returning id
    `;
    const [customer] = await transaction<{ id: string }[]>`
      insert into customers (name, email) values ('Bay Area Fabrication LLC', ${unique()}) returning id
    `;
    const [otherCustomer] = await transaction<{ id: string }[]>`
      insert into customers (name, email) values ('Mission Street Bakery LLC', ${unique()}) returning id
    `;
    const [brokerUser] = await transaction<{ id: string }[]>`
      insert into users (email, display_name, role, broker_id)
      values (${unique()}, 'Change request check broker user', 'broker', ${broker.id}) returning id
    `;
    const [otherBrokerUser] = await transaction<{ id: string }[]>`
      insert into users (email, display_name, role, broker_id)
      values (${unique()}, 'Change request check other broker user', 'broker', ${otherBroker.id}) returning id
    `;
    const [customerUser] = await transaction<{ id: string }[]>`
      insert into users (email, display_name, role, customer_id)
      values (${unique()}, 'Change request check customer', 'customer', ${customer.id}) returning id
    `;
    const [otherCustomerUser] = await transaction<{ id: string }[]>`
      insert into users (email, display_name, role, customer_id)
      values (${unique()}, 'Change request check other customer', 'customer', ${otherCustomer.id}) returning id
    `;
    const [operationsUser] = await transaction<{ id: string }[]>`
      insert into users (email, display_name, role) values (${unique()}, 'Change request check operator', 'staff_ops') returning id
    `;
    const [approverUser] = await transaction<{ id: string }[]>`
      insert into users (email, display_name, role) values (${unique()}, 'Change request check approver', 'staff_approver') returning id
    `;
    // Role 'agent' exists since migration 0018: a principal that lives only behind an MCP key.
    const [agentUser] = await transaction<{ id: string }[]>`
      insert into users (email, display_name, role) values (${unique()}, 'Change request check agent', 'agent') returning id
    `;
    const [policy] = await transaction<{ id: string }[]>`
      insert into policies (broker_id, customer_id, state_code)
      values (${broker.id}, ${customer.id}, 'CA') returning id
    `;
    const [otherPolicy] = await transaction<{ id: string }[]>`
      insert into policies (broker_id, customer_id, state_code)
      values (${otherBroker.id}, ${otherCustomer.id}, 'CA') returning id
    `;
    return {
      brokerId: broker.id,
      brokerUserId: brokerUser.id,
      otherBrokerId: otherBroker.id,
      otherBrokerUserId: otherBrokerUser.id,
      customerId: customer.id,
      customerUserId: customerUser.id,
      otherCustomerId: otherCustomer.id,
      otherCustomerUserId: otherCustomerUser.id,
      operationsUserId: operationsUser.id,
      approverUserId: approverUser.id,
      agentUserId: agentUser.id,
      policyId: policy.id,
      otherPolicyId: otherPolicy.id,
    };
  });
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
