import "@/app/styles/lists.css";
import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Chip } from "@/components/detail-layout";
import { PortalShell } from "@/components/portal-shell";
import { About } from "@/components/ui/about";
import { EmptyState } from "@/components/ui/empty";
import { Legend } from "@/components/ui/legend";
import { Stat, Stats } from "@/components/ui/stat";
import { Chevron, DataTable, Num, Primary, Row } from "@/components/ui/table";
import { FilterChip, Toolbar, ToolbarCount, ToolbarGroup, ToolbarSpacer } from "@/components/ui/toolbar";
import { currentUser } from "@/lib/auth/current-user";
import { brokersWithKybState } from "@/lib/broker/kyb";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { policiesOfBroker, policyDetail } from "@/lib/policy/read";
import { policyAsItStoodOn } from "@/lib/policy/correction-read";
import type { PolicyStatus } from "@/lib/policy/status";
import { termsInForceOn, type TermsInForce } from "@/lib/policy/terms-in-force";
import { firstValue, pickFilter, withParams, type Query } from "@/lib/ui/views";

// /ops/policies: every policy of every broker, on today's terms.
//
// Staff already have access to policy detail; this read-only index makes those policies
// discoverable with the same broker-scoped readers. The filter and the search live in the URL,
// so a filtered list can be pasted into a ticket; the rows are filtered here after the read.

const PATH = "/ops/policies";

// The three states a reader sorts policies into. "waiting" is every policy a person may still
// have to act on; "closed" is the two states nothing can happen to any more.
const FILTERS = ["bound", "waiting", "closed"] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABEL: Record<Filter, string> = { bound: "Bound", waiting: "Waiting", closed: "Closed" };

function filterOf(status: PolicyStatus): Filter {
  if (status === "bound") return "bound";
  if (status === "cancelled" || status === "voided") return "closed";
  return "waiting";
}

function statusTone(status: PolicyStatus): "ok" | "warn" | "neutral" {
  if (status === "bound") return "ok";
  if (status === "cancelled" || status === "voided") return "neutral";
  return "warn";
}

// WHAT EACH STATUS MEANS, one clause each. The legend below prints only the ones the reader can
// see on this page: it used to define "paid not bound", which no row showed, and to define none
// of the three that were on the screen (round 1, MEDIUM).
const STATUS_MEANING: Record<PolicyStatus, string> = {
  draft: "quoted and not sent for payment yet",
  awaiting_payment: "the customer has been asked to pay",
  payment_failed: "Stripe refused the payment; the policy is not bound",
  paid_not_bound: "the customer paid while the broker was not eligible; staff bind it or send the money back",
  bound: "in force, on the terms this row shows",
  cancelled: "cover stopped, the unearned premium was refunded",
  voided: "the issuance was reversed by a correction; the policy never took effect",
};

// The statuses the rows below actually print, once each, in the order they appear. A legend is a
// reading of THIS screen, not of the type.
function statusesOnScreen(rows: { status: PolicyStatus }[]): PolicyStatus[] {
  const seen: PolicyStatus[] = [];
  for (const row of rows) if (!seen.includes(row.status)) seen.push(row.status);
  return seen;
}

// WHAT THE TOTAL CELL SAYS UNDER ITS FIGURE, and nothing at all when there is nothing to say.
//
// The figure above is the total in force on the date this list folds the policy for (today, or
// the first day of the term). It is right, and on a policy carrying a change dated later it reads
// as stale to anyone who knows that change was signed: on 2026-09-09 Yoann read $1,200.00 of
// premium on CGP-01707 while an endorsement to $2,400.00 was already written for 2026-09-22. The
// row now names both figures instead of only the first.
//
// WHAT THIS LINE CANNOT SAY: the day the later terms take effect. This list reads policy_current
// through policyDetail (lib/policy/read.ts), which stores the latest terms and NOT the effective
// date of the endorsement that wrote them: lib/policy/current.ts folds
// `latestEndorsementEffectiveAt` and refreshPolicyCurrent never writes it to the table. The
// amount is what this row can state honestly; the policy's own page names the date beside it.
type TotalRow = { terms: TermsInForce | null; latestTotalChargeCents: number | null };

function laterTerms(row: TotalRow): string | null {
  // The fold has no answer for that date, so the figure above IS the policy record's own and
  // there is nothing later to compare it with.
  if (row.terms === null || row.terms.onDate === null) return null;
  if (row.latestTotalChargeCents === null || row.latestTotalChargeCents === row.terms.totalChargeCents) return null;
  return `${formatCentsAsUsd(row.latestTotalChargeCents)} on the latest terms`;
}

// Everything the cell says under its figure, or nothing at all: an empty `sub` would draw an
// empty line under every row of the table.
function underTheTotal(row: TotalRow): ReactNode | undefined {
  const fromTheRecord = row.terms !== null && row.terms.onDate === null;
  const later = laterTerms(row);
  if (!fromTheRecord && !later) return undefined;
  return (
    <>
      {fromTheRecord ? "on the policy record" : null}
      {later ? <span className="lists-later">{later}</span> : null}
    </>
  );
}

export default async function StaffPoliciesPage({ searchParams }: { searchParams: Promise<Query> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "staff_ops" && user.role !== "staff_approver") redirect("/broker");

  const query = await searchParams;
  const today = new Date().toISOString().slice(0, 10);

  let policies;
  try {
    const brokers = await brokersWithKybState();
    const groups = await Promise.all(
      brokers.map(async (broker) => {
        const rows = await policiesOfBroker(broker.brokerId);
        return rows.map((policy) => ({ ...policy, brokerName: broker.brokerName }));
      }),
    );
    // UI-004: the total in this column is the one the policy's own page prints under its terms,
    // folded by the same helper for the same date (lib/policy/terms-in-force.ts). It costs two
    // reads per policy, which is what folding a policy's events honestly costs.
    policies = await Promise.all(
      groups.flat().map(async (policy) => {
        const onDate = today > policy.effectiveAt ? today : policy.effectiveAt;
        const [detail, asOfResult] = await Promise.all([policyDetail(policy.policyId), policyAsItStoodOn(policy.policyId, onDate)]);
        return {
          ...policy,
          terms: detail ? termsInForceOn(detail, asOfResult) : null,
          // The LATEST terms written on the policy record, which is what policy_current holds:
          // every event applied whatever its effective date. It is the figure the second line of
          // the Total cell names when it is not the one in force today (see underTheTotal).
          latestTotalChargeCents: detail ? detail.totalChargeCents : null,
        };
      }),
    );
  } catch {
    return (
      <PortalShell user={user} active="policies" band={{ title: "Policies" }}>
        <p className="error" role="alert">
          Policies could not be loaded. Refresh the list to try again.
        </p>
        <Link className="button-link" href={PATH} prefetch={false}>
          Reload policies
        </Link>
      </PortalShell>
    );
  }

  const filter = pickFilter(query.filter, FILTERS);
  const search = (firstValue(query.q) ?? "").trim().toLowerCase();
  const shown = policies.filter((policy) => {
    if (filter && filterOf(policy.status) !== filter) return false;
    if (search === "") return true;
    return [policy.policyNumber, policy.customerName, policy.brokerName].some((text) => text.toLowerCase().includes(search));
  });

  const countByFilter = (wanted: Filter) => policies.filter((policy) => filterOf(policy.status) === wanted).length;
  const boundPremiumCents = policies
    .filter((policy) => policy.status === "bound" && policy.terms)
    .reduce((total, policy) => total + (policy.terms?.annualPremiumCents ?? 0), 0);

  return (
    <PortalShell
      user={user}
      active="policies"
      band={{
        title: "Policies",
        suffix: `${policies.length} across every broker`,
        // No chip on a list screen (Yoann, 2026-09-09): what is waiting on a person is the
        // "Waiting" tile, which is also the link to that filter.
      }}
    >
      {/* TWO TILES (cycle 2, decision 2). The total, and the counts per state, are already on the
          band and on the filter chips of the toolbar; four tiles saying them again were the same
          figures read three times on one screen. */}
      <Stats>
        <Stat label="Waiting" value={countByFilter("waiting")} tone={countByFilter("waiting") > 0 ? "warn" : "neutral"} href={withParams(PATH, query, { filter: "waiting" })} note="drafts, unpaid, or paid and not bound" />
        <Stat label="Annual premium bound" value={formatCentsAsUsd(boundPremiumCents)} tone="accent" hint="The terms in force today, before state tax and the flat policy fee." />
      </Stats>

      <DataTable
        ariaLabel="Policies"
        toolbar={
          <Toolbar>
            <ToolbarGroup>
              <FilterChip href={withParams(PATH, query, { filter: null })} active={filter === null} count={policies.length}>
                All
              </FilterChip>
              {FILTERS.map((one) => (
                <FilterChip key={one} href={withParams(PATH, query, { filter: one })} active={filter === one} count={countByFilter(one)}>
                  {FILTER_LABEL[one]}
                </FilterChip>
              ))}
            </ToolbarGroup>
            <form method="get" action={PATH} className="lists-search">
              {filter ? <input type="hidden" name="filter" value={filter} /> : null}
              <input type="search" name="q" defaultValue={search} placeholder="Policy number, customer, broker" aria-label="Search policies" />
              <button type="submit" className="secondary">
                Search
              </button>
            </form>
            <ToolbarSpacer />
            <ToolbarCount>
              {shown.length} of {policies.length}
            </ToolbarCount>
          </Toolbar>
        }
        legend={
          <Legend
            items={[
              { term: "Total", meaning: "annual premium plus state tax and the flat fee, in force today or on the first day of the term" },
              // Named only when a row below prints it: a legend is a reading of THIS screen.
              ...(shown.some((policy) => laterTerms(policy) !== null)
                ? [{ term: "on the latest terms", meaning: "a change is already written on the policy and takes effect later; the figure above it is the one in force now" }]
                : []),
              // Only the statuses a reader can see below, in the order the rows use them.
              ...statusesOnScreen(shown).map((status) => ({ term: status.replace(/_/g, " "), meaning: STATUS_MEANING[status] })),
              { term: "on the policy record", meaning: "the figures could not be rebuilt for that date, so they are the ones written on the policy" },
            ]}
          />
        }
      >
        <thead>
          <tr>
            <th>Policy</th>
            <th>Customer</th>
            <th>Broker</th>
            <th className="nowrap">Effective</th>
            <th>Status</th>
            <th className="num">Total</th>
            <th aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr>
              <td colSpan={7} className="dt-empty">
                <EmptyState illustration="closed-folder">
                  {policies.length === 0 ? "No policy yet. Policies appear here when a broker creates the first draft." : "No policy matches this filter."}
                </EmptyState>
              </td>
            </tr>
          ) : (
            shown.map((policy) => (
              <Row key={policy.policyId} href={`/policies/${policy.policyId}`}>
                <Primary href={`/policies/${policy.policyId}`}>{policy.policyNumber}</Primary>
                <td>{policy.customerName}</td>
                <td>{policy.brokerName}</td>
                <td className="nowrap">
                  {policy.effectiveAt}
                  <span className="dt-sub">{policy.stateCode}</span>
                </td>
                <td>
                  <Chip tone={statusTone(policy.status)}>{policy.status.replace(/_/g, " ")}</Chip>
                </td>
                <Num sub={underTheTotal(policy)}>
                  {formatCentsAsUsd(policy.terms ? policy.terms.totalChargeCents : policy.totalChargeCents)}
                </Num>
                <Chevron />
              </Row>
            ))
          )}
        </tbody>
      </DataTable>

      <About>
        <h4>Total</h4>
        <p>
          The annual premium plus the state premium tax and the flat policy fee in force on the date the policy&apos;s own page shows: today, or the first day of the term when the term has not begun. An endorsement dated later is not in this figure: when there is one, the second line of the cell says what the policy&apos;s latest terms total, and the policy page names the day they take effect.
        </p>
        <h4>What was collected</h4>
        <p>What was actually collected and refunded is on the policy page, in its journal. This list shows terms, not cash.</p>
        <h4>Paid, not bound</h4>
        <p>
          The customer&apos;s money arrived while the broker was not eligible to bind, so it sits in the suspense account until staff operations bind the policy or send it back. Open the policy to do either.
        </p>
      </About>
    </PortalShell>
  );
}
