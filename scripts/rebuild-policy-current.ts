import postgres from "postgres";

// Rebuilds the policy_current cache for every policy, from the immutable events alone.
// This is what makes "policy_current is a cache, not a money record" a checkable claim rather
// than a comment: run it at any time and the table comes back identical.
// Run with: npm run rebuild:policy-current   (add -- --database=test for the test database)

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on the environment
}

const useTestDatabase = process.argv.includes("--database=test");
const runtimeUrl = useTestDatabase ? process.env.DATABASE_URL_TEST_APP : process.env.DATABASE_URL_APP;
if (!runtimeUrl) {
  console.error("the runtime connection string must be set");
  process.exit(1);
}

const database = postgres(runtimeUrl, { max: 1, prepare: false });

async function main() {
  // Imported here, after the environment file is read, because the module chain opens the
  // application connection pool as soon as it loads.
  const { refreshPolicyCurrent } = await import("@/lib/policy/current");

  const policies = await database<{ id: string }[]>`select id from policies order by created_at`;
  for (const policy of policies) {
    await database.begin(async (transaction) => {
      await refreshPolicyCurrent(transaction, policy.id);
    });
    console.log(`rebuilt ${policy.id}`);
  }
  console.log(`${policies.length} policy row(s) rebuilt from their events`);
}

main()
  .then(() => database.end())
  .catch(async (error) => {
    console.error("rebuild failed:", error instanceof Error ? error.message : error);
    await database.end();
    process.exit(1);
  });
