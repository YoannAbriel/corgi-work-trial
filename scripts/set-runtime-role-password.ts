import postgres from "postgres";

// Gives the app_runtime role (created by migration 0001 without login) a password so the
// application can connect as it. The password is read from APP_RUNTIME_DB_PASSWORD and is
// never written to a migration file, because migrations are committed to git.
// Run with: npm run set-runtime-role-password   (reads .env.local)

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No .env.local: rely on the environment.
  }
}

const ownerConnectionString = process.env.DATABASE_URL;
const runtimePassword = process.env.APP_RUNTIME_DB_PASSWORD;

if (!ownerConnectionString || !runtimePassword) {
  console.error("DATABASE_URL and APP_RUNTIME_DB_PASSWORD must be set");
  process.exit(1);
}

// Postgres literal quoting: wrap in single quotes and double any single quote inside.
// ALTER ROLE does not accept bound parameters, so the password is quoted this way.
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const sql = postgres(ownerConnectionString, { max: 1, prepare: false });

sql
  .unsafe(`alter role app_runtime with login password ${quoteLiteral(runtimePassword)}`)
  .then(() => {
    console.log("app_runtime can now log in");
    return sql.end();
  })
  .catch(async (error) => {
    console.error("failed:", error instanceof Error ? error.message : error);
    await sql.end();
    process.exit(1);
  });
