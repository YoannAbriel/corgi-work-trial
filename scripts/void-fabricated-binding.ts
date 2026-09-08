import postgres from "postgres";

// Operations action: void a binding that rests on a payment Stripe never made.
//   npm run void:fabricated-binding -- --policy=CGP-01061 --reason="..." [--database=test]
// Runs as the RUNTIME role (INSERT only): the correction is reversal entries plus events, so no
// mutation privilege is needed, which is the whole point. The actor is the operations user.

// The environment is loaded before the application modules are imported below (dynamic
// import), because db/client.ts refuses to start without DATABASE_URL_APP.
process.loadEnvFile(".env.local");

const useTestDatabase = process.argv.includes("--database=test");
const policyNumber = argument("policy");
const reason = argument("reason");
if (!policyNumber || !reason) {
  console.error("usage: --policy=CGP-xxxxx --reason=\"why\" [--database=test]");
  process.exit(1);
}
const runtimeUrl = useTestDatabase ? process.env.DATABASE_URL_TEST_APP : process.env.DATABASE_URL_APP;
if (!runtimeUrl) {
  console.error("runtime database URL is not set");
  process.exit(1);
}

if (useTestDatabase) {
  // The application module connects to DATABASE_URL_APP; point it at the test database for this run.
  process.env.DATABASE_URL_APP = runtimeUrl;
}
const database = postgres(runtimeUrl, { max: 2, prepare: false });

async function main() {
  const { voidFabricatedBinding } = await import("../lib/policy/void-fabricated-binding");
  const [policy] = await database<{ id: string }[]>`select id from policies where policy_number = ${policyNumber}`;
  if (!policy) {
    throw new Error(`policy ${policyNumber} not found`);
  }
  const [actor] = await database<{ id: string }[]>`select id from users where email = 'ops@example.com'`;
  if (!actor) {
    throw new Error("the operations user does not exist; run the seed first");
  }
  const cashBefore = await cashAtStripe();
  const result = await voidFabricatedBinding({ policyId: policy.id, reason: reason!, actorUserId: actor.id }, database);
  const cashAfter = await cashAtStripe();
  console.log(`voided ${policyNumber}: correction event ${result.correctionEventId}`);
  console.log(`reversed ${result.reversedEntryIds.length} entries of operation ${result.operationId} (fabricated ${result.fabricatedPaymentIntentId})`);
  console.log(`cash_stripe in the ledger: ${cashBefore} -> ${cashAfter} cents`);
}

async function cashAtStripe(): Promise<string> {
  const [row] = await database<{ balance: string }[]>`
    select (coalesce(sum(debit_cents), 0) - coalesce(sum(credit_cents), 0))::text as balance
      from journal_lines where account_id = 'cash_stripe'
  `;
  return row.balance;
}

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

main()
  .then(() => database.end())
  .catch(async (error) => {
    const refused = error instanceof Error && error.constructor.name === "VoidRefused";
    console.error(refused ? `refused: ${error.message}` : `failed: ${error instanceof Error ? error.message : error}`);
    await database.end();
    process.exit(1);
  });
