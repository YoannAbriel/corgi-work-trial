import { spawn, type ChildProcess } from "node:child_process";
import postgres from "postgres";
import { passwordHashMatches } from "@/lib/auth/password";
import {
  BROKER_PASSWORD_REVEAL_COOKIE,
  REVEAL_COOKIE_MAX_AGE_SECONDS,
  REVEAL_COOKIE_PATH,
} from "@/lib/broker/reveal-cookie";

// Proves, OVER HTTP against a real server and a real database, what "New broker" rests on
// (decision 52):
//
//   1. a staff_ops session creates a broker AND its sign-in account, in one transaction;
//   2. the stored hash matches the password the operator was shown, and matches nothing else;
//   3. the password never appears in the redirect: only the broker id travels in the open;
//   4. a duplicate email is refused, and NO broker row is added by the refused attempt;
//   5. an invalid name, email or commission rate is refused, and nothing is written;
//   6. a broker session, a staff_approver session and no session at all are all refused;
//   7. a seeded user (password_hash null) still signs in with DEMO_PASSWORD, unchanged, and the
//      new broker signs in with their one-time password;
//   8. the reveal cookie is HttpOnly, SameSite=Strict, Path=/ops/brokers, Max-Age=120;
//   9. POST /ops/brokers/reveal/consume deletes it, and refuses a session that is not staff.
//
// IT STARTS THE SERVER ITSELF on port 3811, pointed at the disposable database, and stops it at
// the end. Nothing about the connection is ever printed.
//
// It commits rows, so it refuses to run anywhere but corgi_test.
// Run with: npm run check:new-broker

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on the environment, like every other script here
}

const ownerUrl = process.env.DATABASE_URL_TEST;
const runtimeUrl = process.env.DATABASE_URL_TEST_APP;
const demoPassword = process.env.DEMO_PASSWORD;
if (!ownerUrl || !runtimeUrl) {
  console.error("DATABASE_URL_TEST and DATABASE_URL_TEST_APP must be set: this check only runs on the disposable database");
  process.exit(1);
}
if (!demoPassword) {
  console.error("DEMO_PASSWORD must be set: the seeded accounts of this build sign in with it");
  process.exit(1);
}

// 3811, not the 3800 of check:mcp, so the two checks can run side by side.
const port = process.env.NEW_BROKER_PORT ?? "3811";
const baseUrl = `http://127.0.0.1:${port}`;

let failures = 0;
function report(name: string, passed: boolean, detail: string) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}  (${detail})`);
  if (!passed) failures += 1;
}

const owner = postgres(ownerUrl, { max: 2, prepare: false });

// The company this check creates. The email is unique per run, because the check commits and the
// disposable database is not emptied between runs.
const RUN_ID = crypto.randomUUID().slice(0, 8);
const BROKER_NAME = `New broker check ${RUN_ID}`;
const BROKER_EMAIL = `new-broker-check-${RUN_ID}@example.invalid`;
const COMMISSION_RATE_BPS = "1500";

// The two hostile addresses of review finding F-NEWBROKER-01. Both pass the "one @ and a dot"
// shape check and both attack the reveal cookie rather than the database: the semicolon would end
// the cookie value early and throw the one-time password away, the comma would make a splitting
// HTTP client read a second cookie on Path=/ops/brokers. They carry this run's id like every
// other fixture here, because the disposable database is shared and keeps what earlier runs left.
const SEMICOLON_EMAIL = `probe;max-age=99999-${RUN_ID}@example.invalid`;
const COMMA_EMAIL = `probe,corgi_session=x-${RUN_ID}@example.invalid`;
// The third hostile address, of review finding F-NEWBROKER-06: the vertical bar is legal inside a
// cookie value but it is the separator of THIS value, so an address carrying one would be split in
// the wrong place and the screen would print a truncated address and a password that is not the
// password, for a broker that exists.
const SEPARATOR_EMAIL = `probe|split-${RUN_ID}@example.invalid`;

// Above this many brokers, /ops/brokers takes minutes to render and the two screen checks are
// skipped out loud rather than waited for. See the comment beside them.
const MOST_BROKERS_A_SCREEN_CHECK_WAITS_FOR = 100;

async function main() {
  const [{ current_database: databaseName }] = await owner<{ current_database: string }[]>`
    select current_database()
  `;
  if (databaseName !== "corgi_test") {
    console.error(`refusing to run: connected to "${databaseName}", expected the disposable database "corgi_test"`);
    process.exit(1);
  }

  await applyMigrations();

  const [column] = await owner<{ is_nullable: string; data_type: string }[]>`
    select is_nullable, data_type
      from information_schema.columns
     where table_name = 'users' and column_name = 'password_hash'
  `;
  report(
    "migration 0027 added users.password_hash as a nullable text column",
    column?.is_nullable === "YES" && column.data_type === "text",
    column ? `${column.data_type}, nullable ${column.is_nullable}` : "the column does not exist",
  );

  // The three seeded-style accounts this check signs in as: no password hash, so the shared demo
  // password applies to them, exactly like the accounts scripts/seed.ts writes.
  const operations = await createSeededUser("staff_ops");
  const approver = await createSeededUser("staff_approver");
  const brokerUser = await createSeededUser("broker");

  await startServer();

  // ---------------------------------------------------------------------------
  // 1. A seeded account signs in as it always did
  // ---------------------------------------------------------------------------

  const operationsSession = await signIn(operations.email, demoPassword!);
  report(
    "a seeded user (password_hash null) still signs in with the demo password",
    operationsSession !== null,
    operationsSession === null ? "the login was refused" : "session cookie received",
  );
  if (!operationsSession) {
    return; // nothing below can run without it
  }

  const wrongPassword = await signIn(operations.email, "not-the-demo-password");
  report("a wrong password is still refused", wrongPassword === null, "no session cookie");

  // ---------------------------------------------------------------------------
  // 2. Who may create a broker
  // ---------------------------------------------------------------------------

  const withoutSession = await createBroker(null, { name: BROKER_NAME, email: BROKER_EMAIL, commissionRateBps: COMMISSION_RATE_BPS });
  report(
    "no session is sent to the login page",
    withoutSession.location.startsWith("/login?error="),
    withoutSession.location,
  );

  for (const [who, session] of [
    ["a broker session", await signIn(brokerUser.email, demoPassword!)],
    ["a staff approver session", await signIn(approver.email, demoPassword!)],
  ] as const) {
    const refused = await createBroker(session, { name: BROKER_NAME, email: BROKER_EMAIL, commissionRateBps: COMMISSION_RATE_BPS });
    report(
      `${who} is refused with the operations sentence`,
      errorOf(refused.location) === "Only operations staff can create a broker",
      errorOf(refused.location) ?? refused.location,
    );
  }

  // Counted BY NAME and not over the whole table: the disposable database is shared, and another
  // check running at the same moment must not be able to turn this line red.
  report(
    "no broker row was written by any refused attempt",
    (await countBrokersNamed(BROKER_NAME)) === 0,
    `${await countBrokersNamed(BROKER_NAME)} brokers named "${BROKER_NAME}"`,
  );

  // ---------------------------------------------------------------------------
  // 3. Every field is checked, and a refused field writes nothing
  // ---------------------------------------------------------------------------

  const invalidForms: [string, { name: string; email: string; commissionRateBps: string }][] = [
    ["an empty name", { name: "   ", email: BROKER_EMAIL, commissionRateBps: COMMISSION_RATE_BPS }],
    ["a name over 120 characters", { name: "x".repeat(121), email: BROKER_EMAIL, commissionRateBps: COMMISSION_RATE_BPS }],
    ["an email that is not an address", { name: BROKER_NAME, email: "not-an-address", commissionRateBps: COMMISSION_RATE_BPS }],
    ["an email over 200 characters", { name: BROKER_NAME, email: `${"x".repeat(200)}@example.invalid`, commissionRateBps: COMMISSION_RATE_BPS }],
    ["a commission rate that is not a number", { name: BROKER_NAME, email: BROKER_EMAIL, commissionRateBps: "fifteen" }],
    ["a commission rate with a decimal part", { name: BROKER_NAME, email: BROKER_EMAIL, commissionRateBps: "15.5" }],
    ["a negative commission rate", { name: BROKER_NAME, email: BROKER_EMAIL, commissionRateBps: "-1" }],
    ["a commission rate over 10000", { name: BROKER_NAME, email: BROKER_EMAIL, commissionRateBps: "10001" }],
    // The three hostile addresses declared above. They must be refused BEFORE the account is
    // created, which is what the "no sign-in account" line below proves.
    ["an email carrying a semicolon", { name: BROKER_NAME, email: SEMICOLON_EMAIL, commissionRateBps: COMMISSION_RATE_BPS }],
    ["an email carrying a comma", { name: BROKER_NAME, email: COMMA_EMAIL, commissionRateBps: COMMISSION_RATE_BPS }],
    ["an email carrying the cookie separator", { name: BROKER_NAME, email: SEPARATOR_EMAIL, commissionRateBps: COMMISSION_RATE_BPS }],
  ];
  for (const [what, form] of invalidForms) {
    const refused = await createBroker(operationsSession, form);
    const error = errorOf(refused.location);
    report(`${what} is refused, naming the field`, error !== null && /name|email|commission/i.test(error), error ?? refused.location);
  }
  report(
    "no broker row was written by any invalid form",
    (await countBrokersNamed(BROKER_NAME)) === 0,
    `${await countBrokersNamed(BROKER_NAME)} brokers named "${BROKER_NAME}"`,
  );
  // The hostile addresses again, from the other side: no sign-in account was created for any of
  // them. This is the line that says the refusal happened before the INSERT and not after it,
  // which is the whole point: an account created with a broken cookie could never be repaired,
  // because nothing anywhere holds the password it was supposed to show.
  const hostileAccounts =
    (await countUsersWithEmail(SEMICOLON_EMAIL)) +
    (await countUsersWithEmail(COMMA_EMAIL)) +
    (await countUsersWithEmail(SEPARATOR_EMAIL));
  report("no sign-in account exists for any hostile address", hostileAccounts === 0, `${hostileAccounts} accounts`);

  // ---------------------------------------------------------------------------
  // 4. The creation itself
  // ---------------------------------------------------------------------------

  const created = await createBroker(operationsSession, {
    name: BROKER_NAME,
    email: BROKER_EMAIL,
    commissionRateBps: COMMISSION_RATE_BPS,
  });
  const createdBrokerId = new URLSearchParams(created.location.split("?")[1] ?? "").get("created");
  report("the operator is sent back to the form with the new broker's id", createdBrokerId !== null, created.location);
  report("the redirect carries no password of any kind", !/password/i.test(created.location), created.location);

  const [brokerRow] = await owner<{ id: string; name: string; commission_rate_bps: number }[]>`
    select id, name, commission_rate_bps from brokers where id = ${createdBrokerId ?? "00000000-0000-0000-0000-000000000000"}
  `;
  report(
    "the broker row exists with the name and the rate that were typed",
    brokerRow?.name === BROKER_NAME && brokerRow.commission_rate_bps === Number(COMMISSION_RATE_BPS),
    brokerRow ? `${brokerRow.name}, ${brokerRow.commission_rate_bps} bps` : "no broker row",
  );

  const [userRow] = await owner<{ id: string; email: string; role: string; broker_id: string | null; password_hash: string | null }[]>`
    select id, email, role, broker_id, password_hash from users where email = ${BROKER_EMAIL}
  `;
  report(
    "the sign-in account exists, is a broker, and points at that broker",
    userRow?.role === "broker" && userRow.broker_id === createdBrokerId,
    userRow ? `${userRow.role}, broker ${userRow.broker_id === createdBrokerId ? "matches" : "does not match"}` : "no user row",
  );
  report(
    "the account carries a scrypt hash and not a password",
    typeof userRow?.password_hash === "string" && userRow.password_hash.startsWith("scrypt$"),
    userRow?.password_hash ? `${userRow.password_hash.slice(0, 7)}...` : "null",
  );

  // ---------------------------------------------------------------------------
  // 5. The reveal cookie
  // ---------------------------------------------------------------------------

  const revealCookie = created.setCookies.find((cookie) => cookie.startsWith(`${BROKER_PASSWORD_REVEAL_COOKIE}=`));
  report("the answer sets the reveal cookie", revealCookie !== undefined, revealCookie ? "set" : "absent");
  if (!revealCookie || !userRow) {
    return;
  }

  report("the reveal cookie is HttpOnly", /;\s*HttpOnly/i.test(revealCookie), attributesOf(revealCookie));
  report("the reveal cookie is SameSite=Strict", /;\s*SameSite=Strict/i.test(revealCookie), attributesOf(revealCookie));
  report(
    `the reveal cookie is scoped to ${REVEAL_COOKIE_PATH}`,
    new RegExp(`;\\s*Path=${REVEAL_COOKIE_PATH}(;|$)`, "i").test(revealCookie),
    attributesOf(revealCookie),
  );
  report(
    `the reveal cookie expires after ${REVEAL_COOKIE_MAX_AGE_SECONDS} seconds`,
    new RegExp(`;\\s*Max-Age=${REVEAL_COOKIE_MAX_AGE_SECONDS}(;|$)`, "i").test(revealCookie),
    attributesOf(revealCookie),
  );

  const revealedValue = decodeURIComponent(revealCookie.slice(revealCookie.indexOf("=") + 1).split(";")[0]);
  const separator = revealedValue.indexOf("|");
  const revealedEmail = revealedValue.slice(0, separator);
  const revealedPassword = revealedValue.slice(separator + 1);
  report("the cookie carries the account's email", revealedEmail === BROKER_EMAIL, revealedEmail);
  report("the cookie carries a twenty-character password", revealedPassword.length === 20, `${revealedPassword.length} characters`);

  report(
    "the stored hash matches the password the operator was shown",
    await passwordHashMatches(revealedPassword, userRow.password_hash!),
    "scrypt verified",
  );
  report(
    "the stored hash does not match another password",
    (await passwordHashMatches(`${revealedPassword}x`, userRow.password_hash!)) === false &&
      (await passwordHashMatches(demoPassword!, userRow.password_hash!)) === false,
    "neither a near miss nor the shared demo password opens it",
  );

  // ---------------------------------------------------------------------------
  // 6. The new broker signs in with it, and only with it
  // ---------------------------------------------------------------------------

  const newBrokerSession = await signIn(BROKER_EMAIL, revealedPassword);
  report("the new broker signs in with the one-time password", newBrokerSession !== null, newBrokerSession ? "session cookie received" : "refused");
  const withDemoPassword = await signIn(BROKER_EMAIL, demoPassword!);
  report(
    "the shared demo password does NOT open the new broker's account",
    withDemoPassword === null,
    withDemoPassword === null ? "refused" : "A SESSION WAS ISSUED",
  );

  // ---------------------------------------------------------------------------
  // 7. What the operator actually sees on the screen
  // ---------------------------------------------------------------------------

  // ONLY WHEN THE SCREEN IS READABLE. /ops/brokers renders every broker with its verification
  // state, which is three queries per row (lib/broker/kyb.ts, brokersWithKybState). On the trial
  // database, with a handful of brokers, that is instant. The SHARED disposable database is not
  // that: every check script of this repository leaves its fixture brokers behind, and one page
  // load there was measured at 217 seconds for 1153 brokers on 2026-09-09. Rather than hang, or
  // pretend, this half is skipped out loud with its reason and its count.
  //
  // WHAT THAT MEANS FOR THE FOUR ASSERTIONS BELOW, recorded honestly (review finding
  // F-NEWBROKER-05): corgi_test already holds more than a thousand brokers, so this script takes
  // the SKIP branch every time and those four lines do not run here. Their evidence for this
  // revision is the independent reviewer, who ran them by hand against the built server and
  // reported all four passing. That evidence covers this revision only: on the next change to
  // this screen they must be run again, either by the reviewer or on a fresh database where the
  // count is under the ceiling. Counting only the brokers this run created would not help: what
  // makes the page slow is every OTHER broker in the table, which is exactly what is counted.
  const brokersOnTheScreen = await countBrokers();
  if (brokersOnTheScreen > MOST_BROKERS_A_SCREEN_CHECK_WAITS_FOR) {
    console.log(
      `SKIP  the screen checks  (${brokersOnTheScreen} brokers in the disposable database, over the ${MOST_BROKERS_A_SCREEN_CHECK_WAITS_FOR} this check waits for; run it on a fresh database to include them)`,
    );
  } else {
    const createdPage = `/ops/brokers?view=new&created=${createdBrokerId}`;
    const withTheCookie = await readPage(createdPage, [operationsSession, revealCookie.split(";")[0]]);
    report(
      "the screen shows the sign-in details block",
      withTheCookie.includes("Sign-in details, shown once") && withTheCookie.includes(revealedPassword) && withTheCookie.includes(BROKER_EMAIL),
      "title, email and password rendered",
    );
    report(
      "the new broker is in the list on the same screen, never submitted",
      withTheCookie.includes(BROKER_NAME) && withTheCookie.includes("never submitted"),
      "the row is there",
    );
    report(
      "the form no longer says the route is pending",
      !withTheCookie.includes("Route pending") && !/<button[^>]*disabled[^>]*>\s*Create the broker/.test(withTheCookie),
      "the submit button is enabled",
    );

    // The same URL WITHOUT the cookie: the password is gone and the screen says so, rather than
    // showing an empty box.
    const withoutTheCookie = await readPage(createdPage, [operationsSession]);
    report(
      "without the cookie the screen says the password is gone",
      withoutTheCookie.includes("The password was shown once and is gone") && !withoutTheCookie.includes(revealedPassword),
      "the second version of the block",
    );
  }

  // ---------------------------------------------------------------------------
  // 8. The duplicate email, which is what proves the one transaction
  // ---------------------------------------------------------------------------

  const duplicate = await createBroker(operationsSession, {
    name: `${BROKER_NAME} second try`,
    email: BROKER_EMAIL.toUpperCase(), // the route lowercases it, so this is the same account
    commissionRateBps: "2000",
  });
  report(
    "a duplicate email is refused with the sentence the operator reads",
    errorOf(duplicate.location) === "That email already has an account",
    errorOf(duplicate.location) ?? duplicate.location,
  );
  // THE POINT OF THE WHOLE SLICE, in one line: the broker of the refused attempt does not exist.
  // Its INSERT ran before the one the database refused, and the transaction took it back.
  report(
    "the refused attempt left NO half-written broker behind",
    (await countBrokersNamed(`${BROKER_NAME} second try`)) === 0,
    `${await countBrokersNamed(`${BROKER_NAME} second try`)} brokers named "${BROKER_NAME} second try"`,
  );
  report(
    "the broker created before it is still there, once",
    (await countBrokersNamed(BROKER_NAME)) === 1,
    `${await countBrokersNamed(BROKER_NAME)} brokers named "${BROKER_NAME}"`,
  );

  // ---------------------------------------------------------------------------
  // 9. Consuming the reveal
  // ---------------------------------------------------------------------------

  const consumedWithoutSession = await consumeReveal(null);
  report("the consume route refuses a request with no session", consumedWithoutSession.status === 401, `HTTP ${consumedWithoutSession.status}`);

  const consumedByTheBroker = await consumeReveal(newBrokerSession);
  report("the consume route refuses a broker session", consumedByTheBroker.status === 403, `HTTP ${consumedByTheBroker.status}`);

  const consumed = await consumeReveal(operationsSession);
  report("the consume route answers 204 to staff", consumed.status === 204, `HTTP ${consumed.status}`);
  const deletion = consumed.setCookies.find((cookie) => cookie.startsWith(`${BROKER_PASSWORD_REVEAL_COOKIE}=`));
  report(
    "the consume route deletes the cookie, on the same path",
    deletion !== undefined && /;\s*Max-Age=0(;|$)/i.test(deletion) && new RegExp(`;\\s*Path=${REVEAL_COOKIE_PATH}(;|$)`, "i").test(deletion),
    deletion ? attributesOf(deletion) : "no set-cookie",
  );
  report(
    "the deletion carries no password",
    deletion !== undefined && deletion.slice(deletion.indexOf("=") + 1).split(";")[0] === "",
    deletion ? "empty value" : "no set-cookie",
  );

  // A staff approver may clear the block too: they can open the screen it is on.
  const consumedByApprover = await consumeReveal(await signIn(approver.email, demoPassword!));
  report("the consume route accepts a staff approver session", consumedByApprover.status === 204, `HTTP ${consumedByApprover.status}`);
}

// ---------------------------------------------------------------------------
// Talking to the server
// ---------------------------------------------------------------------------

// A signed-in session is one cookie header; this check never keeps more than one at a time.
type Session = string;

type PostAnswer = { status: number; location: string; setCookies: string[] };

async function signIn(email: string, password: string): Promise<Session | null> {
  const response = await fetch(`${baseUrl}/api/session/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email, password }),
    redirect: "manual",
  });
  const sessionCookie = setCookiesOf(response).find((cookie) => cookie.startsWith("corgi_session="));
  if (!sessionCookie) return null;
  return sessionCookie.split(";")[0];
}

async function createBroker(session: Session | null, form: Record<string, string>): Promise<PostAnswer> {
  const response = await fetch(`${baseUrl}/api/brokers`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(session ? { cookie: session } : {}),
    },
    body: new URLSearchParams(form),
    redirect: "manual",
  });
  return { status: response.status, location: response.headers.get("location") ?? "", setCookies: setCookiesOf(response) };
}

async function consumeReveal(session: Session | null): Promise<PostAnswer> {
  const response = await fetch(`${baseUrl}/ops/brokers/reveal/consume`, {
    method: "POST",
    headers: session ? { cookie: session } : {},
    redirect: "manual",
  });
  return { status: response.status, location: response.headers.get("location") ?? "", setCookies: setCookiesOf(response) };
}

// The HTML of a screen, read with the cookies a browser would send to it. Used to check what the
// operator sees, not just what the routes answer.
async function readPage(path: string, cookies: string[]): Promise<string> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { cookie: cookies.join("; ") } });
  return response.text();
}

// Several cookies can be set by one answer; getSetCookie keeps them apart, which a plain
// headers.get would not.
function setCookiesOf(response: Response): string[] {
  return response.headers.getSetCookie();
}

// The sentence a refusal carries, decoded from the redirect the route answered with.
function errorOf(location: string): string | null {
  const query = location.split("?")[1];
  return query ? new URLSearchParams(query).get("error") : null;
}

// Everything after the value: what is printed beside a cookie assertion, so a failing line shows
// the attributes and never the password.
function attributesOf(setCookie: string): string {
  const firstSemicolon = setCookie.indexOf(";");
  return firstSemicolon === -1 ? "no attributes" : setCookie.slice(firstSemicolon + 1).trim();
}

// ---------------------------------------------------------------------------
// The fixture, the migrations and the server
// ---------------------------------------------------------------------------

// A user of this build as the seed script writes one: no password hash, so DEMO_PASSWORD opens
// it. Written with the owner connection, because the runtime role may insert users but this is
// setup and not the behaviour under test.
async function createSeededUser(role: string): Promise<{ id: string; email: string }> {
  const email = `new-broker-check-${role}-${crypto.randomUUID()}@example.invalid`;
  const [user] = await owner<{ id: string }[]>`
    insert into users (email, display_name, role)
    values (${email}, ${`New broker check ${role}`}, ${role})
    returning id
  `;
  return { id: user.id, email };
}

// How many brokers of this run's name exist. Counting by name and not over the whole table is
// what makes the "nothing was written" lines safe on a database several checks share.
async function countBrokersNamed(name: string): Promise<number> {
  const [row] = await owner<{ count: string }[]>`select count(*)::text as count from brokers where name = ${name}`;
  return Number(row.count);
}

// How many sign-in accounts carry exactly this address. Used only for the two hostile addresses
// of review finding F-NEWBROKER-01, which must have created nothing at all. Exact and not a
// pattern, for the same reason the broker counts are by name: the database is shared.
async function countUsersWithEmail(email: string): Promise<number> {
  const [row] = await owner<{ count: string }[]>`select count(*)::text as count from users where email = ${email}`;
  return Number(row.count);
}

// The whole table, used for one thing only: deciding whether /ops/brokers is small enough to be
// read within this check's patience.
async function countBrokers(): Promise<number> {
  const [row] = await owner<{ count: string }[]>`select count(*)::text as count from brokers`;
  return Number(row.count);
}

// scripts/migrate.ts against the disposable database, exactly as `npm run migrate -- --database=test`
// does it. Nothing about the connection is printed by it or by this.
function applyMigrations(): Promise<void> {
  return new Promise((resolve, reject) => {
    const migrate = spawn("tsx", ["scripts/migrate.ts", "--database=test"], { stdio: "inherit" });
    migrate.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`migrations failed with code ${code}`))));
  });
}

let server: ChildProcess | null = null;

// The application, on its own port, reading and writing the disposable database. The connection
// string is handed to the child process and never printed (the same rule as
// scripts/dev-on-test-database.ts).
async function startServer(): Promise<void> {
  server = spawn("next", ["dev", "-p", port], {
    stdio: "ignore",
    env: { ...process.env, DATABASE_URL_APP: runtimeUrl },
  });
  console.log(`starting the application on port ${port} against the disposable database`);

  // `next dev` compiles a route the first time it is asked for, so the first answer is slow.
  // Two minutes is the ceiling; a healthy server answers in a few seconds.
  const givesUpAt = Date.now() + 120_000;
  while (Date.now() < givesUpAt) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((wake) => setTimeout(wake, 1000));
  }
  throw new Error("the application did not become healthy within two minutes");
}

function stopServer() {
  server?.kill("SIGTERM");
  server = null;
}

main()
  .then(async () => {
    stopServer();
    await owner.end();
    console.log(failures === 0 ? "all checks passed" : `${failures} check(s) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (error) => {
    stopServer();
    console.error("check failed:", error instanceof Error ? error.message : error);
    await owner.end();
    process.exit(1);
  });
