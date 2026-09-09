// Read-only: computes what a fresh statement run would produce for one broker and one month, with
// the repository's own reader and pure function, inside a READ ONLY transaction. Stores nothing.
//   npx tsx --tsconfig <repo>/tsconfig.json expected-statement.ts <brokerId> <YYYY-MM>
import postgres from "postgres";
import { brokerJournalEntriesInMonth } from "@/lib/statements/journal";
import { computeStatement, CANONICAL_STATEMENT_VERSION } from "@/lib/statements/compute";

const REPO = "/Users/yoannabriel/dev/corgi-work-trial";
process.loadEnvFile(`${REPO}/.env.local`);
const connectionString = process.env.DATABASE_URL_APP;
if (!connectionString) throw new Error("DATABASE_URL_APP absent");

const [brokerId, statementMonth] = process.argv.slice(2);
const database = postgres(connectionString, { max: 1 });

const result = await database.begin(async (transaction) => {
  await transaction`set transaction read only`;
  const [{ now }] = await transaction<{ now: Date }[]>`select now() as now`;
  const entries = await brokerJournalEntriesInMonth(
    { brokerId, statementMonth, knowledgeCutoff: now },
    transaction as unknown as postgres.Sql,
  );
  return { now, entries, statement: computeStatement({ brokerId, statementMonth, entries }) };
});
await database.end();

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
console.log(`database now (the cutoff a fresh run would take): ${result.now.toISOString()}`);
console.log(`canonical version: ${CANONICAL_STATEMENT_VERSION}`);
console.log(`entries in month: ${result.entries.length}`);
for (const line of result.statement.lines) {
  console.log(
    `  ${line.kind.padEnd(18)} ${(line.policyNumber ?? "").padEnd(10)} effective ${line.effectiveAt} cash ${usd(line.cashCents)} premium ${usd(line.premiumCents)} commission ${usd(line.commissionCents)}`,
  );
}
console.log("totals:", JSON.stringify(result.statement.totals));
console.log(`content hash of these entries at this instant: ${result.statement.contentHash}`);
