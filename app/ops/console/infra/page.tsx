import "@/app/styles/console.css";
import Link from "next/link";
import { PortalShell } from "@/components/portal-shell";
import { Chip } from "@/components/detail-layout";
import { FailureLine, RailsAbout, utc } from "@/components/console-parts";
import { About } from "@/components/ui/about";
import { Chart, ChartRow, HBars } from "@/components/ui/charts";
import { EmptyState } from "@/components/ui/empty";
import { Legend } from "@/components/ui/legend";
import { Stat, Stats } from "@/components/ui/stat";
import { DataTable, ExpandHead, ExpandRow, FactGrid, Num, Row } from "@/components/ui/table";
import { sql } from "@/db/client";
import { requireStaff } from "@/lib/console/guard";
import {
  DOCUMENTED_LIMITS,
  DOCUMENTED_READ_ON,
  NEON_FREE_STORAGE_BYTES,
  dailyActivity,
  deployedRevision,
  formatBytes,
  lastScheduledRun,
  measureDatabase,
  storageHeadroom,
} from "@/lib/console/infra";
import { attempt, valueOr } from "@/lib/console/safe-read";

// /ops/console/infra: what this deployment is actually using, next to what the free plans say
// they allow.
//
// THE RULE OF THIS PAGE, and it is the only interesting thing about it: a MEASURED number and a
// DOCUMENTED number are never mixed. Measured means read from this database, now, by the queries
// in lib/console/infra.ts. Documented means a human opened the provider's page on the date shown
// and copied the sentence. A headroom is computed ONLY where the two are the same unit; every
// other row says why they cannot be subtracted instead of inventing a percentage. The one chart
// that compares the two sides is therefore the one comparison that exists: the database size
// against Neon's documented Free storage.
//
// It calls no provider API: the documented side is a table in the code and the measured side is
// our own Postgres. Opening this page costs nothing and tells nobody.

const PATH = "/ops/console/infra";
const DAYS_OF_ACTIVITY = 7;

export default async function ConsoleInfraPage() {
  const user = await requireStaff();

  const [databaseRead, activityRead, scheduledRead] = await Promise.all([
    attempt("the database measurements", measureDatabase(sql)),
    attempt("the daily activity", dailyActivity(sql, DAYS_OF_ACTIVITY)),
    attempt("the last scheduled run", lastScheduledRun(sql)),
  ]);

  const measured = valueOr(databaseRead, null);
  const activity = valueOr(activityRead, { webhooks: [], mcpCalls: [], reconciliationRuns: [] });
  const scheduled = valueOr(scheduledRead, { lastScheduledRunAt: null, lastManualRunAt: null, hoursSinceScheduledRun: null });
  const storage = measured ? storageHeadroom(measured.databaseBytes) : null;

  // The last seven UTC days, so a day with no activity reads as zero rather than disappearing.
  const days: string[] = [];
  const today = new Date();
  for (let back = DAYS_OF_ACTIVITY - 1; back >= 0; back -= 1) {
    days.push(new Date(today.getTime() - back * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  const countOn = (rows: { day: string; count: number }[], day: string) => rows.find((row) => row.day === day)?.count ?? 0;

  return (
    <PortalShell
      user={user}
      active="infra"
      band={{
        title: "Infrastructure",
        suffix: `revision ${deployedRevision().slice(0, 12)}`,
        // One chip: the one figure of this page a person acts on. The AF-02 modes are in the top
        // bar of every screen (cycle 2, decision 1).
        meta: storage ? <Chip tone={storage.usedPercent > 80 ? "warn" : "ok"}>{storage.usedPercent}% of the documented storage</Chip> : undefined,
        actions: (
          <Link href="/ops/console" prefetch={false} className="button-link secondary">
            Back to the feed
          </Link>
        ),
      }}
    >
      <FailureLine attempted={databaseRead} />
      <Stats>
        <Stat label="Database size" value={measured ? formatBytes(measured.databaseBytes) : "not measured"} note="measured now" />
        <Stat
          label="Storage used"
          value={storage ? `${storage.usedPercent}` : "none"}
          unit={storage ? "%" : undefined}
          tone={storage && storage.usedPercent > 80 ? "warn" : "ok"}
          note="of the documented Neon Free limit"
        />
        <Stat label="Connections" value={measured ? measured.activeConnections : "not measured"} note="active on this database" />
        <Stat
          label="Scheduled run"
          value={scheduled.hoursSinceScheduledRun === null ? "never" : scheduled.hoursSinceScheduledRun.toFixed(1)}
          unit={scheduled.hoursSinceScheduledRun === null ? undefined : "h ago"}
          tone={scheduled.hoursSinceScheduledRun === null ? "warn" : "neutral"}
          note="the daily reconciliation cron"
        />
      </Stats>

      {/* One chart, and it is the one comparison this page can make: what we use against what the
          provider documents. The bars of the ten largest tables drew the same ten figures as the
          table under them, so they are gone (cycle 2, decision 4). The percentage is printed once,
          in the tile above; the chart carries the shape and no headline of its own (round 1). */}
      <ChartRow>
        <Chart title="Neon storage against the documented limit">
          {measured && storage ? (
            <HBars
              rows={[
                { label: "Measured now", value: measured.databaseBytes, display: formatBytes(measured.databaseBytes) },
                { label: "Still free", value: storage.remainingBytes, display: formatBytes(storage.remainingBytes), color: "var(--chart-3)" },
              ]}
              max={NEON_FREE_STORAGE_BYTES}
              caption="Database size against the documented Neon Free storage of 0.5 GB per project"
            />
          ) : (
            <p className="chart-empty">The database could not be measured.</p>
          )}
        </Chart>
      </ChartRow>

      {/* Figures in the cells, never sentences: "the Neon plans page states no connection limit"
          and "a frequency against an instant" turned this table into a wall of prose in a grid
          (round 1, MEDIUM). What each "none" means is one paragraph of About, said once. */}
      <h2 className="console-heading">Measured now</h2>
      <DataTable
        ariaLabel="Measured infrastructure"
        legend={
          <Legend
            items={[
              { term: "Measured", meaning: "read from this database, now, by lib/console/infra.ts" },
              { term: "Documented", meaning: `copied from the provider page on ${DOCUMENTED_READ_ON}` },
              { term: "none", meaning: "the two sides are not the same unit, so nothing is subtracted" },
            ]}
          />
        }
      >
        <thead>
          <tr>
            <th>What</th>
            <th>Measured today</th>
            <th>Documented limit</th>
            <th>Headroom</th>
          </tr>
        </thead>
        <tbody>
          {measured === null ? (
            <tr>
              <td colSpan={4} className="dt-empty">
                <EmptyState illustration="broken-link">The database could not be measured.</EmptyState>
              </td>
            </tr>
          ) : (
            <>
              <Row>
                <td>Database size</td>
                <td>{formatBytes(measured.databaseBytes)}</td>
                <td>0.5 GB</td>
                <td>{storage ? `${formatBytes(storage.remainingBytes)} left` : ""}</td>
              </Row>
              <Row>
                <td>Active connections</td>
                <td>{measured.activeConnections}</td>
                <td className="dt-muted">not stated</td>
                <td className="dt-muted">none</td>
              </Row>
              <Row>
                <td>Postgres version</td>
                <td>{measured.serverVersion}</td>
                <td className="dt-muted">not a limit</td>
                <td className="dt-muted">none</td>
              </Row>
              <Row>
                <td>Application revision</td>
                <td>
                  <code className="ref">{deployedRevision()}</code>
                </td>
                <td className="dt-muted">not a limit</td>
                <td className="dt-muted">none</td>
              </Row>
              <Row>
                <td>Last scheduled reconciliation</td>
                <td>
                  {scheduled.lastScheduledRunAt ? (
                    <>
                      {utc(scheduled.lastScheduledRunAt)}
                      <span className="dt-sub">
                        {scheduled.hoursSinceScheduledRun === null ? "" : `${scheduled.hoursSinceScheduledRun.toFixed(1)} hours ago`}
                      </span>
                    </>
                  ) : (
                    <span className="dt-muted">never</span>
                  )}
                </td>
                <td>1/day</td>
                <td className="dt-muted">none</td>
              </Row>
              <Row>
                <td>Last manual reconciliation</td>
                <td>{scheduled.lastManualRunAt ? utc(scheduled.lastManualRunAt) : <span className="dt-muted">never</span>}</td>
                <td className="dt-muted">not a limit</td>
                <td className="dt-muted">none</td>
              </Row>
            </>
          )}
        </tbody>
      </DataTable>

      <h2 className="console-heading">The ten largest tables</h2>
      <DataTable ariaLabel="Largest tables" legend={<Legend items={[{ term: "Rows", meaning: "an estimate from the statistics collector, never a count" }]} />}>
        <thead>
          <tr>
            <th>Table</th>
            <th className="num">Total size</th>
            <th className="num">Rows</th>
          </tr>
        </thead>
        <tbody>
          {measured === null || measured.largestTables.length === 0 ? (
            <tr>
              <td colSpan={3} className="dt-empty">
                <EmptyState illustration="sleeping-corgi">Nothing to show.</EmptyState>
              </td>
            </tr>
          ) : (
            measured.largestTables.map((table) => (
              <Row key={table.tableName}>
                <td>{table.tableName}</td>
                <Num>{formatBytes(table.totalBytes)}</Num>
                <Num>{table.estimatedRows.toLocaleString("en-US")}</Num>
              </Row>
            ))
          )}
        </tbody>
      </DataTable>

      <h2 className="console-heading">Activity, last {DAYS_OF_ACTIVITY} days</h2>
      <FailureLine attempted={activityRead} />
      <DataTable ariaLabel="Daily activity">
        <thead>
          <tr>
            <th className="nowrap">Day</th>
            <th className="num">Webhooks</th>
            <th className="num">MCP calls</th>
            <th className="num">Reconciliation runs</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <Row key={day}>
              <td className="nowrap">{day}</td>
              <Num>{countOn(activity.webhooks, day)}</Num>
              <Num>{countOn(activity.mcpCalls, day)}</Num>
              <Num>{countOn(activity.reconciliationRuns, day)}</Num>
            </Row>
          ))}
        </tbody>
      </DataTable>

      {/* The documented side is the provider's own sentence, copied whole and never rewritten: a
          shortened limit would be our paraphrase of somebody else's promise. So the row shows one
          line of it and the fold prints it as it was copied (round 1, MEDIUM: sentences in cells). */}
      <h2 className="console-heading">Documented limits</h2>
      <DataTable
        ariaLabel="Documented limits"
        legend={<Legend items={[{ term: "Read on", meaning: "the date a human opened that page and copied the value" }]} />}
      >
        <thead>
          <tr>
            <ExpandHead />
            <th>Provider</th>
            <th>What</th>
            <th>Documented</th>
            <th>Source</th>
          </tr>
        </thead>
        {DOCUMENTED_LIMITS.map((limit) => (
          <ExpandRow
            key={`${limit.provider}-${limit.what}`}
            columns={4}
            cells={
              <>
                <td className="nowrap">{limit.provider}</td>
                <td>
                  <span className="console-oneline" title={limit.what}>
                    {limit.what}
                  </span>
                </td>
                <td>
                  <span className="console-oneline" title={limit.documented}>
                    {limit.documented}
                  </span>
                </td>
                <td>
                  <a href={limit.sourceUrl} rel="noreferrer noopener" target="_blank" className="console-oneline" title={limit.sourceUrl}>
                    {limit.sourceUrl}
                  </a>
                  <span className="dt-sub">read {limit.readOn}</span>
                </td>
              </>
            }
          >
            <FactGrid
              items={[
                { label: "What", value: limit.what, wide: true },
                { label: "Documented", value: limit.documented, wide: true },
              ]}
            />
          </ExpandRow>
        ))}
      </DataTable>

      <About>
        <RailsAbout />
        <h4>Where a headroom says &ldquo;none&rdquo;</h4>
        <p>
          A headroom is a subtraction, so both sides have to be the same unit. Database size against Neon&apos;s
          documented 0.5 GB is the only pair on this page that is. The Neon plans page states no connection limit, a
          cron frequency cannot be subtracted from an instant, and a Postgres version and a revision are not limits at
          all: those rows say <strong>none</strong> rather than inventing a percentage.
        </p>
        <h4>Measured against documented</h4>
        <p>
          Measured means read from this database, now. Documented means a human opened the provider&apos;s page on{" "}
          {DOCUMENTED_READ_ON} and copied the sentence. A documentation page can change without telling us; when one
          does, the answer is to read it again and change the table in <code>lib/console/infra.ts</code>, never to
          adjust it to match what we observe.
        </p>
        <h4>The row count is an estimate</h4>
        <p>
          It comes from the statistics collector (<code>n_live_tup</code>), not from a count. Counting every row of
          every table would make this page the one query able to hurt the database it is describing.
        </p>
        <h4>Stripe rates cannot be compared to a daily count</h4>
        <p>
          Stripe&apos;s documented sandbox limit is 25 requests <strong>per second</strong>, so a count per day cannot
          be divided into it to produce a headroom.
        </p>
        <h4>What this page can and cannot see</h4>
        <p>
          It can measure our own Postgres: size, tables, connections and what we recorded. It cannot measure Vercel
          function duration, memory, invocations or bandwidth: those live in Vercel&apos;s own usage dashboard, and this
          page calls no provider API. What it cannot see, it says it cannot see, instead of showing a number nobody
          measured.
        </p>
        <h4>Why nothing here calls Vercel or Stripe</h4>
        <p>
          A cockpit that phones two providers every ten seconds becomes the incident. Opening this page costs three
          queries to the database we already hold a connection to, and nothing else. All instants are UTC.
        </p>
      </About>
    </PortalShell>
  );
}
