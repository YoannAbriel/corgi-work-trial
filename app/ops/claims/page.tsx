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
import { sql } from "@/db/client";
import { claimsWithPositions } from "@/lib/claims/read";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { pickFilter, withParams, type Query } from "@/lib/ui/views";

// Every claim in the system, for staff. A broker never reaches this page: their claims are on
// the policy page, scoped to the policies they own.
//
// Read only. Every figure is folded from the claim's own events by lib/claims/money-position.ts,
// the same function the money paths use, so this list can never show a reserve the ledger does
// not agree with. The filter lives in the URL, so a filtered list can be pasted into a ticket.

const PATH = "/ops/claims";

const FILTERS = ["open", "closed"] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABEL: Record<Filter, string> = { open: "Open", closed: "Closed" };

export default async function OpsClaimsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "staff_ops" && user.role !== "staff_approver") {
    redirect("/broker");
  }

  const [claims, query] = await Promise.all([claimsWithPositions(sql, null), searchParams]);

  const open = claims.filter((claim) => !claim.position.isClosed);
  const reserveCents = open.reduce((total, claim) => total + claim.position.reserveCents, 0);
  const paidCents = claims.reduce((total, claim) => total + claim.position.paidCents, 0);
  // A claim whose payment was sent and not confirmed gone by the rail. It is a COUNT of claims,
  // not a subtraction of two totals: this screen adds no arithmetic of its own to money, and
  // "paid" and "settled" are already two folded figures of lib/claims/money-position.ts.
  const waitingPayments = claims.filter((claim) => claim.position.paidCents > claim.position.settledCents).length;

  const filter = pickFilter(query.filter, FILTERS);
  const shown = claims.filter((claim) => filter === null || (filter === "closed") === claim.position.isClosed);
  const countByFilter = (wanted: Filter) => claims.filter((claim) => (wanted === "closed") === claim.position.isClosed).length;

  return (
    <PortalShell
      user={user}
      active="claims"
      band={{
        title: "Claims",
        suffix: `${claims.length} in total`,
        meta: (
          <>
            <Chip tone={open.length > 0 ? "warn" : "ok"}>{open.length === 0 ? "none open" : `${open.length} open`}</Chip>
            <Chip tone="ok">Stripe: LIVE SANDBOX</Chip>
            <Chip tone="neutral">claim rail: LOCAL SIMULATOR</Chip>
          </>
        ),
      }}
    >
      <Stats>
        <Stat
          label="Open claims"
          value={open.length}
          tone={open.length > 0 ? "warn" : "ok"}
          href={withParams(PATH, query, { filter: "open" })}
          note="not closed yet"
        />
        <Stat label="Reserve" value={formatCentsAsUsd(reserveCents)} note="still expected on the open claims" />
        <Stat label="Paid" value={formatCentsAsUsd(paidCents)} note="sent on the rail, returns deducted" />
        <Stat
          label="Waiting payments"
          value={waitingPayments}
          unit={waitingPayments === 1 ? "claim" : "claims"}
          tone={waitingPayments > 0 ? "warn" : "neutral"}
          note="sent, not confirmed gone by the rail"
        />
      </Stats>

      <DataTable
        ariaLabel="Claims"
        toolbar={
          <Toolbar>
            <ToolbarGroup>
              <FilterChip href={withParams(PATH, query, { filter: null })} active={filter === null} count={claims.length}>
                All
              </FilterChip>
              {FILTERS.map((one) => (
                <FilterChip key={one} href={withParams(PATH, query, { filter: one })} active={filter === one} count={countByFilter(one)}>
                  {FILTER_LABEL[one]}
                </FilterChip>
              ))}
            </ToolbarGroup>
            <ToolbarSpacer />
            <ToolbarCount>
              {shown.length} of {claims.length}
            </ToolbarCount>
          </Toolbar>
        }
        legend={
          <Legend
            items={[
              { term: "Reserve", meaning: "what the claim is still expected to cost" },
              { term: "Paid", meaning: "sent on the rail and not returned" },
              { term: "closed", meaning: "no reserve and no payment can move on it any more" },
            ]}
          />
        }
      >
        <thead>
          <tr>
            <th>Claim</th>
            <th>Policy</th>
            <th>Claimant</th>
            <th>Status</th>
            <th className="num">Reserve</th>
            <th className="num">Paid</th>
            <th aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr>
              <td colSpan={7} className="dt-empty">
                <EmptyState illustration="umbrella">
                  {claims.length === 0
                    ? "No claim yet. A claim is opened from a bound policy, by staff operations."
                    : "No claim matches this filter."}
                </EmptyState>
              </td>
            </tr>
          ) : (
            shown.map((claim) => (
              <Row key={claim.claimId} href={`/ops/claims/${claim.claimId}`}>
                <Primary href={`/ops/claims/${claim.claimId}`} sub={claim.occurredAt}>
                  {claim.claimNumber}
                </Primary>
                <td>
                  <Link href={`/policies/${claim.policyId}`} prefetch={false}>
                    {claim.policyNumber}
                  </Link>
                </td>
                <td>{claim.claimantName}</td>
                <td>
                  <Chip tone={claim.position.isClosed ? "neutral" : "warn"}>{claim.position.isClosed ? "closed" : "open"}</Chip>
                </td>
                <Num>{formatCentsAsUsd(claim.position.reserveCents)}</Num>
                <Num sub={`incurred ${formatCentsAsUsd(claim.position.incurredCents)}`}>{formatCentsAsUsd(claim.position.paidCents)}</Num>
                <Chevron />
              </Row>
            ))
          )}
        </tbody>
      </DataTable>

      <About>
        <h4>Incurred</h4>
        <p>What a claim has cost so far: paid plus the reserve still outstanding. It is folded from the claim&apos;s own events every time this page is rendered, never stored.</p>
        <h4>Paid</h4>
        <p>Counted from the moment a payment is sent on the rail. A return puts it back. Waiting payments are the ones the rail has not confirmed gone.</p>
        <h4>What you do here</h4>
        <p>
          Open a claim to set its reserve, record the claimant&apos;s bank account and ask for a payment. A payment above the threshold waits in the{" "}
          <Link href="/ops/approvals">money-out approvals</Link> queue until a second person decides.
        </p>
        <h4>Which rail</h4>
        <p>The claim payout rail is a local simulator, labeled on every row that used it. Stripe, used for premium collection, is a live sandbox in test mode.</p>
      </About>
    </PortalShell>
  );
}
