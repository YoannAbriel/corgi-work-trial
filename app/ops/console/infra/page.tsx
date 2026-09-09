import Link from "next/link";
import { PortalShell } from "@/components/portal-shell";
import { Disclosure } from "@/components/disclosures";
import { AsideList, Chip, DetailGrid, DetailHeading, Empty, Panel } from "@/components/detail-layout";
import { FailureLine, utc } from "@/components/console-parts";
import { sql } from "@/db/client";
import { requireStaff } from "@/lib/console/guard";
import {
  DOCUMENTED_LIMITS,
  DOCUMENTED_READ_ON,
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
// other row says why they cannot be subtracted instead of inventing a percentage.
//
// It calls no provider API: the documented side is a table in the code and the measured side is
// our own Postgres. Opening this page costs nothing and tells nobody.

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
    <PortalShell user={user} active="console" trail={[{ label: "Operations console", href: "/ops/console" }, { label: "Infrastructure" }]}>
      <DetailHeading
        title="Infrastructure"
        lead="What this deployment is using, measured now, next to what the providers' documentation says the free plans allow. All times UTC."
        chips={
          <>
            <Chip tone="neutral">revision {deployedRevision().slice(0, 12)}</Chip>
            {storage ? <Chip tone={storage.usedPercent > 80 ? "warn" : "ok"}>{storage.usedPercent}% of the documented storage</Chip> : null}
          </>
        }
        actions={
          <Link href="/ops/console" prefetch={false} className="button-link">
            Back to the feed
          </Link>
        }
      />

      <DetailGrid
        main={
          <>
            <Panel title="Measured now">
              <FailureLine attempted={databaseRead} />
              {measured === null ? (
                <Empty>The database could not be measured; the line above says why.</Empty>
              ) : (
                <div className="table-scroll" role="region" aria-label="Measured infrastructure" tabIndex={0}>
                  <table>
                    <thead>
                      <tr>
                        <th>What</th>
                        <th>Measured today</th>
                        <th>Documented limit</th>
                        <th>Headroom</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Database size</td>
                        <td>{formatBytes(measured.databaseBytes)}</td>
                        <td>0.5 GB per project (Neon Free)</td>
                        <td>
                          {storage ? `${formatBytes(storage.remainingBytes)} left, ${storage.usedPercent}% used` : ""}
                        </td>
                      </tr>
                      <tr>
                        <td>Active connections to this database</td>
                        <td>{measured.activeConnections}</td>
                        <td>
                          <span className="note">the Neon plans page states no connection limit</span>
                        </td>
                        <td>
                          <span className="note">no headroom: nothing documented to subtract from</span>
                        </td>
                      </tr>
                      <tr>
                        <td>Postgres version</td>
                        <td>{measured.serverVersion}</td>
                        <td>
                          <span className="note">not a limit</span>
                        </td>
                        <td>
                          <span className="note">not comparable</span>
                        </td>
                      </tr>
                      <tr>
                        <td>Application revision</td>
                        <td>
                          <code>{deployedRevision()}</code>
                        </td>
                        <td>
                          <span className="note">not a limit</span>
                        </td>
                        <td>
                          <span className="note">not comparable</span>
                        </td>
                      </tr>
                      <tr>
                        <td>Last scheduled reconciliation (the daily cron)</td>
                        <td>
                          {scheduled.lastScheduledRunAt ? (
                            <>
                              {utc(scheduled.lastScheduledRunAt)}
                              <br />
                              <span className="note">
                                {scheduled.hoursSinceScheduledRun === null ? "" : `${scheduled.hoursSinceScheduledRun.toFixed(1)} hours ago`}
                              </span>
                            </>
                          ) : (
                            <span className="note">no run with an empty run_by yet</span>
                          )}
                        </td>
                        <td>once per day, per-hour precision (Vercel Hobby)</td>
                        <td>
                          <span className="note">not a number: the limit is a frequency, this is an instant</span>
                        </td>
                      </tr>
                      <tr>
                        <td>Last manual reconciliation (somebody pressed the button)</td>
                        <td>{scheduled.lastManualRunAt ? utc(scheduled.lastManualRunAt) : <span className="note">never</span>}</td>
                        <td>
                          <span className="note">not a limit</span>
                        </td>
                        <td>
                          <span className="note">not comparable</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel title="The ten largest tables">
              <FailureLine attempted={databaseRead} />
              {measured === null || measured.largestTables.length === 0 ? (
                <Empty>Nothing to show.</Empty>
              ) : (
                <div className="table-scroll" role="region" aria-label="Largest tables" tabIndex={0}>
                  <table>
                    <thead>
                      <tr>
                        <th>Table</th>
                        <th className="amount">Total size</th>
                        <th className="amount">Rows (estimate)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {measured.largestTables.map((table) => (
                        <tr key={table.tableName}>
                          <td>{table.tableName}</td>
                          <td className="amount">{formatBytes(table.totalBytes)}</td>
                          <td className="amount">{table.estimatedRows.toLocaleString("en-US")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="note">
                The row count is <strong>an estimate</strong>, taken from the statistics collector (n_live_tup), not a
                count. Counting every row of every table would make this page the one query able to hurt the database
                it is describing.
              </p>
            </Panel>

            <Panel title={`Activity over the last ${DAYS_OF_ACTIVITY} days`}>
              <FailureLine attempted={activityRead} />
              <div className="table-scroll" role="region" aria-label="Daily activity" tabIndex={0}>
                <table>
                  <thead>
                    <tr>
                      <th>Day (UTC)</th>
                      <th className="amount">Webhook events received</th>
                      <th className="amount">MCP calls</th>
                      <th className="amount">Reconciliation runs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((day) => (
                      <tr key={day}>
                        <td>{day}</td>
                        <td className="amount">{countOn(activity.webhooks, day)}</td>
                        <td className="amount">{countOn(activity.mcpCalls, day)}</td>
                        <td className="amount">{countOn(activity.reconciliationRuns, day)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="note">
                Stripe&apos;s documented sandbox limit is 25 requests <strong>per second</strong>, so a daily count
                cannot be divided into it to produce a headroom. The two are printed side by side and left uncompared.
              </p>
            </Panel>
          </>
        }
        aside={
          <>
            <Panel title="Documented limits">
              <p className="note">
                Every line below was read from the provider&apos;s own documentation page on {DOCUMENTED_READ_ON} and
                copied here. They are <strong>documented facts, not measurements</strong>, and a documentation page can
                change without telling us. When one does, the answer is to read it again and change the table in{" "}
                <code>lib/console/infra.ts</code>, never to adjust it to match what we observe.
              </p>
              <dl className="aside-list">
                {DOCUMENTED_LIMITS.map((limit) => (
                  <div key={`${limit.provider}-${limit.what}`}>
                    <dt>
                      {limit.provider}: {limit.what}
                    </dt>
                    <dd>
                      {limit.documented}
                      <br />
                      <span className="note">
                        <a href={limit.sourceUrl} rel="noreferrer noopener" target="_blank">
                          {limit.sourceUrl}
                        </a>{" "}
                        · read {limit.readOn}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </Panel>

            <Panel title="What this page can and cannot see">
              <AsideList
                items={[
                  { label: "Can measure", value: "our own Postgres: size, tables, connections, and what we recorded" },
                  { label: "Cannot measure", value: "Vercel function duration, memory, invocations and bandwidth" },
                  { label: "Why", value: "those live in Vercel's own usage dashboard; this page calls no provider API" },
                  { label: "Cost of opening it", value: "three queries to our database and nothing else" },
                ]}
              />
              <Disclosure title="Why nothing here calls Vercel or Stripe">
                <p>
                  A cockpit that phones two providers every ten seconds becomes the incident. This page reads the
                  database we already hold a connection to, and reads the limits from a table in the code. What it
                  cannot see, it says it cannot see, instead of showing a number nobody measured.
                </p>
              </Disclosure>
            </Panel>
          </>
        }
      />
    </PortalShell>
  );
}
