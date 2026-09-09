import { sql } from "@/db/client";
import { withActivity } from "@/lib/observability/log";

// GET /api/health
// Proves from outside the dev machine that the deployed revision can reach the database.
// Returns the git revision Vercel built so a reviewer can match it to the repository.
export const GET = withActivity({ route: "/api/health", actor: "anonymous" }, handleGet);

async function handleGet() {
  const revision = process.env.VERCEL_GIT_COMMIT_SHA ?? "local";
  try {
    const [row] = await sql`select now() as database_time`;
    return Response.json({ ok: true, database: "ok", databaseTime: row.database_time, revision });
  } catch {
    // The failure reason is intentionally not returned: it can contain host names.
    return Response.json({ ok: false, database: "unreachable", revision }, { status: 503 });
  }
}
