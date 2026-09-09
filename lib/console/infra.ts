import type postgres from "postgres";

// The infrastructure view of the console (/ops/console/infra).
//
// TWO KINDS OF NUMBER, NEVER MIXED.
//
//   MEASURED   read from this database, right now, by the queries below. It is a fact about
//              this deployment at this instant and nothing else.
//   DOCUMENTED read by a human from the provider's own documentation page, on the date written
//              next to it. It is NOT measured, NOT observed and NOT a promise: it is what the
//              page said when it was read, and pages change.
//
// A "headroom" figure is only produced where both exist AND are the same unit. Everywhere else
// the column says why the two cannot be subtracted, rather than inventing a percentage. That
// restraint is the point of the screen: an operator has to be able to tell what we know from
// what we merely read somewhere.
//
// Nothing here writes, and nothing here calls a provider API: the documented side is a constant
// of this file, so opening the page costs one round trip to our own database and no money.

// ---------------------------------------------------------------------------
// The documented side
// ---------------------------------------------------------------------------

export type DocumentedLimit = {
  provider: "Vercel" | "Neon" | "Stripe";
  what: string;
  documented: string;
  sourceUrl: string;
  readOn: string; // the date a human opened that page and copied the value
};

// Read on 2026-09-09 from the pages named below, for slice B13-9. Every value is quoted from the
// page, not summarised. If a page no longer says this, the fix is to read it again and change
// this table, never to adjust it to match what we observe.
export const DOCUMENTED_READ_ON = "2026-09-09";

export const DOCUMENTED_LIMITS: DocumentedLimit[] = [
  {
    provider: "Vercel",
    what: "Cron jobs, Hobby plan: how often one may run",
    documented: "minimum interval once per day; scheduling precision per-hour (plus or minus 59 minutes); 100 cron jobs per project",
    sourceUrl: "https://vercel.com/docs/cron-jobs/usage-and-pricing",
    readOn: DOCUMENTED_READ_ON,
  },
  {
    provider: "Vercel",
    what: "Function maximum duration, Hobby plan (Node.js runtime)",
    documented: "300 s default and 300 s maximum",
    sourceUrl: "https://vercel.com/docs/functions/limitations",
    readOn: DOCUMENTED_READ_ON,
  },
  {
    provider: "Vercel",
    what: "Function memory, Hobby plan",
    documented: "2 GB / 1 vCPU, default and maximum",
    sourceUrl: "https://vercel.com/docs/functions/limitations",
    readOn: DOCUMENTED_READ_ON,
  },
  {
    provider: "Vercel",
    what: "Request or response body of a function",
    documented: "4.5 MB maximum payload",
    sourceUrl: "https://vercel.com/docs/functions/limitations",
    readOn: DOCUMENTED_READ_ON,
  },
  {
    provider: "Vercel",
    what: "Monthly usage included, Hobby plan",
    documented: "100 GB fast data transfer, 1 million invocations, 4 CPU-hours active CPU, 360 GB-hours provisioned memory",
    sourceUrl: "https://vercel.com/docs/limits",
    readOn: DOCUMENTED_READ_ON,
  },
  {
    provider: "Neon",
    what: "Storage, Free plan",
    documented: "0.5 GB per project",
    sourceUrl: "https://neon.com/docs/introduction/plans",
    readOn: DOCUMENTED_READ_ON,
  },
  {
    provider: "Neon",
    what: "Compute, Free plan",
    documented: "100 CU-hours per project per month; autoscaling up to 2 CU (8 GB RAM)",
    sourceUrl: "https://neon.com/docs/introduction/plans",
    readOn: DOCUMENTED_READ_ON,
  },
  {
    provider: "Neon",
    what: "Branches and network transfer, Free plan",
    documented: "10 branches per project; 5 GB public egress per project",
    sourceUrl: "https://neon.com/docs/introduction/plans",
    readOn: DOCUMENTED_READ_ON,
  },
  {
    provider: "Neon",
    what: "Connections, Free plan",
    documented: "the plans page does not state a connection limit; it is not recorded here rather than guessed",
    sourceUrl: "https://neon.com/docs/introduction/plans",
    readOn: DOCUMENTED_READ_ON,
  },
  {
    provider: "Stripe",
    what: "API rate limit, sandbox (test mode)",
    documented: "25 requests per second globally, and 25 requests per second per endpoint (live mode is 100 per second)",
    sourceUrl: "https://docs.stripe.com/rate-limits",
    readOn: DOCUMENTED_READ_ON,
  },
  {
    provider: "Stripe",
    what: "Connect account creation, sandbox",
    documented: "5 accounts per second (live mode is 30 per second)",
    sourceUrl: "https://docs.stripe.com/rate-limits",
    readOn: DOCUMENTED_READ_ON,
  },
];

// ---------------------------------------------------------------------------
// The measured side
// ---------------------------------------------------------------------------

export type TableFootprint = {
  tableName: string;
  totalBytes: number;
  estimatedRows: number;
};

export type DailyCount = { day: string; count: number };

export type MeasuredInfrastructure = {
  databaseName: string;
  databaseBytes: number;
  serverVersion: string;
  activeConnections: number;
  largestTables: TableFootprint[];
};

// One round trip's worth of facts about the database this deployment is talking to.
//
// pg_stat_user_tables gives an ESTIMATE of the row count (n_live_tup, maintained by the
// autovacuum statistics collector), not a count. That is deliberate: count(*) over every table
// would be the one query on this page able to hurt the database it is describing. The screen
// says "estimate" for the same reason.
export async function measureDatabase(database: postgres.Sql): Promise<MeasuredInfrastructure> {
  const [[identity], [connections], tables] = await Promise.all([
    database<{ database_name: string; database_bytes: string; server_version: string }[]>`
      select current_database()                          as database_name,
             pg_database_size(current_database())::text  as database_bytes,
             current_setting('server_version')           as server_version
    `,
    database<{ active_connections: number }[]>`
      select count(*)::int as active_connections
        from pg_stat_activity
       where datname = current_database()
    `,
    database<{ table_name: string; total_bytes: string; estimated_rows: string }[]>`
      select relname                              as table_name,
             pg_total_relation_size(relid)::text  as total_bytes,
             n_live_tup::text                     as estimated_rows
        from pg_stat_user_tables
       order by pg_total_relation_size(relid) desc
       limit 10
    `,
  ]);

  return {
    databaseName: identity?.database_name ?? "unknown",
    databaseBytes: Number(identity?.database_bytes ?? 0),
    serverVersion: identity?.server_version ?? "unknown",
    activeConnections: connections?.active_connections ?? 0,
    largestTables: tables.map((table) => ({
      tableName: table.table_name,
      totalBytes: Number(table.total_bytes),
      estimatedRows: Number(table.estimated_rows),
    })),
  };
}

// How much this deployment actually did, per UTC day, over the last `days` days. Three counts,
// three grouped queries, each bounded by the same window. A day with no activity is absent
// rather than zero; the screen fills the gaps so a reader sees the shape of the week.
export async function dailyActivity(
  database: postgres.Sql,
  days = 7,
): Promise<{ webhooks: DailyCount[]; mcpCalls: DailyCount[]; reconciliationRuns: DailyCount[] }> {
  const [webhooks, mcpCalls, reconciliationRuns] = await Promise.all([
    database<{ day: string; count: number }[]>`
      select to_char(date_trunc('day', received_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
             count(*)::int as count
        from webhook_events
       where received_at > now() - make_interval(days => ${days})
       group by 1 order by 1
    `,
    database<{ day: string; count: number }[]>`
      select to_char(date_trunc('day', called_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
             count(*)::int as count
        from mcp_calls
       where called_at > now() - make_interval(days => ${days})
       group by 1 order by 1
    `,
    database<{ day: string; count: number }[]>`
      select to_char(date_trunc('day', finished_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
             count(*)::int as count
        from reconciliation_runs
       where finished_at > now() - make_interval(days => ${days})
       group by 1 order by 1
    `,
  ]);
  return { webhooks, mcpCalls, reconciliationRuns };
}

export type ScheduledRunObservation = {
  lastScheduledRunAt: Date | null; // a run with no run_by: nobody pressed a button, so it is the cron
  lastManualRunAt: Date | null;
  hoursSinceScheduledRun: number | null;
};

// When the daily cron last actually did something we can see.
//
// reconciliation_runs.run_by is the user id of the staff member who pressed "Run now", and NULL
// when the scheduled job ran it (migration 0011). That null is the only trace the application
// keeps of the cron having fired, so it is what this reads. A cron that fired and failed still
// wrote a row, with status 'failed', and is therefore still visible here.
export async function lastScheduledRun(database: postgres.Sql): Promise<ScheduledRunObservation> {
  const [row] = await database<{ scheduled_at: Date | null; manual_at: Date | null; hours_since: string | null }[]>`
    select max(finished_at) filter (where run_by is null)     as scheduled_at,
           max(finished_at) filter (where run_by is not null) as manual_at,
           extract(epoch from now() - max(finished_at) filter (where run_by is null))::text / 3600 as hours_since
      from reconciliation_runs
  `;
  return {
    lastScheduledRunAt: row?.scheduled_at ?? null,
    lastManualRunAt: row?.manual_at ?? null,
    hoursSinceScheduledRun: row?.hours_since === null || row?.hours_since === undefined ? null : Number(row.hours_since),
  };
}

// The revision this deployment is running, read from the same place /api/health reads it, so the
// two can never disagree. "local" means a development server, where Vercel sets nothing.
export function deployedRevision(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA ?? "local";
}

// Bytes as a human reads them. Integer arithmetic, one decimal, no rounding surprises.
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value = value / 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

// The one place where a measured figure and a documented figure are the same unit, so the
// subtraction means something: the database size against Neon's documented Free storage.
export const NEON_FREE_STORAGE_BYTES = 512 * 1024 * 1024; // 0.5 GB per project, as documented

export function storageHeadroom(databaseBytes: number): { usedPercent: number; remainingBytes: number } {
  const remainingBytes = Math.max(0, NEON_FREE_STORAGE_BYTES - databaseBytes);
  const usedPercent = Math.min(100, Math.round((databaseBytes / NEON_FREE_STORAGE_BYTES) * 1000) / 10);
  return { usedPercent, remainingBytes };
}
