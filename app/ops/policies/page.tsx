import "@/app/styles/lists.css";
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
import { termsInForceOn } from "@/lib/policy/terms-in-force";
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
        return { ...policy, terms: detail ? termsInForceOn(detail, asOfResult) : null };
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
  const needsAPerson = policies.filter((policy) => policy.status === "paid_not_bound").length;
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
        // One chip: what is waiting on a person. The AF-02 words are on the top bar of every
        // workspace screen now (cycle 2, decision 1).
        meta: needsAPerson > 0 ? <Chip tone="warn">{needsAPerson} paid, not bound</Chip> : <Chip tone="ok">nothing waiting on a person</Chip>,
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
                <Num sub={policy.terms && policy.terms.onDate === null ? "on the policy record" : undefined}>
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
          The annual premium plus the state premium tax and the flat policy fee in force on the date the policy&apos;s own page shows: today, or the first day of the term when the term has not begun. An endorsement dated later is not in this figure; the policy page names it under the terms.
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
