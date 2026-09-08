import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

// Applies every db/migrations/*.sql file, in file-name order, exactly once.
// Applied file names are remembered in schema_migrations. Each file runs inside one
// transaction, so a failing migration leaves the database as it was before it.
// Run with: npm run migrate   (reads .env.local, uses the owner connection DATABASE_URL)

try {
  // Variables already present in the environment (CI, Vercel) win over the file.
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: rely on the environment.
}

// `npm run migrate` migrates the trial database (DATABASE_URL).
// `npm run migrate -- --database=test` migrates the disposable database used by the tests that
// have to commit rows (DATABASE_URL_TEST). Nothing else changes: same files, same order.
const useTestDatabase = process.argv.includes("--database=test");
const ownerConnectionString = useTestDatabase ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL;
if (!ownerConnectionString) {
  console.error(useTestDatabase ? "DATABASE_URL_TEST is not set" : "DATABASE_URL is not set");
  process.exit(1);
}

const migrationsDirectory = join(process.cwd(), "db", "migrations");
const migrationFiles = readdirSync(migrationsDirectory)
  .filter((fileName) => fileName.endsWith(".sql"))
  .sort();

const sql = postgres(ownerConnectionString, { max: 1, prepare: false });

async function main() {
  await sql`
    create table if not exists schema_migrations (
      file_name text primary key,
      applied_at timestamptz not null default now()
    )
  `;
  const appliedRows = await sql<{ file_name: string }[]>`select file_name from schema_migrations`;
  const alreadyApplied = new Set(appliedRows.map((row) => row.file_name));

  for (const fileName of migrationFiles) {
    if (alreadyApplied.has(fileName)) {
      console.log(`skip    ${fileName}`);
      continue;
    }
    const migrationSql = readFileSync(join(migrationsDirectory, fileName), "utf8");
    await sql.begin(async (transaction) => {
      await transaction.unsafe(migrationSql);
      await transaction`insert into schema_migrations (file_name) values (${fileName})`;
    });
    console.log(`applied ${fileName}`);
  }
}

main()
  .then(() => sql.end())
  .catch(async (error) => {
    console.error("migration failed:", error instanceof Error ? error.message : error);
    await sql.end();
    process.exit(1);
  });
