import postgres from "postgres";

// One shared connection pool for the whole application.
// It uses the runtime role (DATABASE_URL_APP), which will have no UPDATE or DELETE
// rights on money tables once migration 0001 has created it. Migrations and the seed
// script use the owner connection (DATABASE_URL) through scripts/, never this pool.
const connectionString = process.env.DATABASE_URL_APP ?? process.env.DATABASE_URL;

// `next build` imports route modules to collect their metadata before any request exists.
// During that phase a missing connection string is not an error; at runtime it is.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
if (!connectionString && !isBuildPhase) {
  throw new Error("DATABASE_URL_APP (or DATABASE_URL) must be set");
}

export const sql = postgres(connectionString ?? "postgres://build-phase-placeholder/none", {
  max: 5,
  // Neon's pooled endpoint runs PgBouncer in transaction mode, which does not support
  // named prepared statements. Disabling them keeps every query safe on that endpoint.
  prepare: false,
});
