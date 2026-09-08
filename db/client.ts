import postgres from "postgres";

// One shared connection pool for the whole application.
// It always uses the runtime role (DATABASE_URL_APP), which has no UPDATE, DELETE or
// TRUNCATE on money tables. There is deliberately no fallback to the owner connection:
// if the runtime URL is missing, the app refuses to start rather than run with a role that
// could rewrite the ledger (review finding F-B1-02). Migrations and the seed use the owner
// connection (DATABASE_URL) through scripts/, never this pool.
const runtimeConnectionString = process.env.DATABASE_URL_APP;

// `next build` imports route modules to collect their metadata before any request exists.
// During that phase a missing connection string is not an error; at runtime it is.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
if (!runtimeConnectionString && !isBuildPhase) {
  throw new Error("DATABASE_URL_APP must be set to the app_runtime connection; the owner connection is never used by the app");
}

export const sql = postgres(runtimeConnectionString ?? "postgres://build-phase-placeholder/none", {
  max: 5,
  // Neon's pooled endpoint runs PgBouncer in transaction mode, which does not support
  // named prepared statements. Disabling them keeps every query safe on that endpoint.
  prepare: false,
});
