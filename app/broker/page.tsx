import "@/app/styles/lists.css";
import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Chip } from "@/components/detail-layout";
import { PortalShell } from "@/components/portal-shell";
import { LandscapeFooter } from "@/components/ui/landscape";
import { WhatNeedsYou, workspaceTasks, type BlockingTask } from "@/components/what-needs-you";
import { About } from "@/components/ui/about";
import { EmptyState } from "@/components/ui/empty";
import { Legend } from "@/components/ui/legend";
import { Stat, Stats } from "@/components/ui/stat";
import { Chevron, DataTable, Num, Primary, Row } from "@/components/ui/table";
import { FilterChip, Toolbar, ToolbarCount, ToolbarGroup, ToolbarSpacer } from "@/components/ui/toolbar";
import { currentUser } from "@/lib/auth/current-user";
import { bindingIsAllowed } from "@/lib/broker/eligibility";
import { brokerKybState, KYB_NOT_LIVE_LABEL } from "@/lib/broker/kyb";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { policyAsItStoodOn } from "@/lib/policy/correction-read";
import { policiesOfBroker, policyDetail } from "@/lib/policy/read";
import type { PolicyStatus } from "@/lib/policy/status";
import { termsInForceOn, type TermsInForce } from "@/lib/policy/terms-in-force";
import { firstValue, pickFilter, toastsFromQuery, withParams, type Query } from "@/lib/ui/views";

// The broker's own policies. A broker only ever sees the policies of the broker their user
// account is attached to: the list is queried by broker_id, never by an id from the URL.
//
// The table is the one /ops/policies draws, with the same columns, the same filters and the same
// figures, so the broker and the operator read the same sentence about the same policy.

const PATH = "/broker";

// The three states a reader sorts policies into, exactly as /ops/policies does.
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

// What each status means, one clause each, in the broker's words. The legend prints only the
// ones on the screen (cycle 2: a legend names the statuses a reader can see, and no others).
const STATUS_MEANING: Record<PolicyStatus, string> = {
  draft: "quoted, not sent for payment yet",
  awaiting_payment: "your customer has been asked to pay",
  payment_failed: "Stripe refused the payment; the policy is not bound",
  paid_not_bound: "paid while you were not eligible to bind; staff decide",
  bound: "in force, on the terms this row shows",
  cancelled: "cover stopped, the unearned premium was refunded",
  voided: "the issuance was reversed by a correction; the policy never took effect",
};

// The statuses the rows below actually print, once each, in the order they appear.
function statusesOnScreen(rows: { status: PolicyStatus }[]): PolicyStatus[] {
  const seen: PolicyStatus[] = [];
  for (const row of rows) if (!seen.includes(row.status)) seen.push(row.status);
  return seen;
}

// WHAT THE TOTAL CELL SAYS UNDER ITS FIGURE, and nothing at all when there is nothing to say.
// The same line the staff list draws, because the broker and the operator read the same sentence
// about the same policy.
//
// The figure above is the total in force on the date this list folds the policy for (today, or
// the first day of the term). It is right, and on a policy carrying a change dated later it reads
// as stale to anyone who knows that change was signed: on 2026-09-09 Yoann read $1,200.00 of
// premium on CGP-01707 while an endorsement to $2,400.00 was already written for 2026-09-22.
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

export default async function BrokerPage({ searchParams }: { searchParams: Promise<Query> }) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "broker" || !user.brokerId) {
    const isStaff = user.role === "staff_ops" || user.role === "staff_approver";
    return (
      <PortalShell active="policies" user={user} band={{ title: "Your policies" }}>
        <p className="error" role="alert">
          This page is the broker journey. Your account has the role &quot;{user.role}&quot;.
        </p>
        <p>
          {isStaff ? (
            <Link href="/ops/brokers">Brokers and their verification</Link>
          ) : (
            <Link href="/customer">Your policies, documents and endorsement approvals</Link>
          )}
        </p>
      </PortalShell>
    );
  }

  const [storedPolicies, kyb, tasks, query] = await Promise.all([
    policiesOfBroker(user.brokerId),
    brokerKybState(user.brokerId),
    // What is waiting on this broker's policies, read once for the sidebar count and the block.
    workspaceTasks(user),
    searchParams,
  ]);

  // UI-004, review finding F-UA-01. The total in the column below is the one the policy's own
  // page prints under its terms, folded by the same helper for the same date
  // (lib/policy/terms-in-force.ts), exactly as /ops/policies and /customer already do. It used to
  // come straight from policy_current, which applies every event whatever its effective date: a
  // policy carrying a future-dated endorsement was listed here at next month's total while its
  // own page, the staff list and the customer's list all printed today's. The broker is the
  // person who sells the policy; showing them a different current charge from everyone else is
  // the contradiction UI-004 numbered.
  const today = new Date().toISOString().slice(0, 10);
  const policies = await Promise.all(
    storedPolicies.map(async (policy) => {
      // The date the policy page uses: today, or the term start when the term has not begun.
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

  // The status the SERVER acts on, in the words the other screens use, for the task line below.
  // A broker who never submitted reads "not submitted" rather than "unknown".
  const verificationWord = kyb.status === "unknown" && !kyb.providerAccountId ? "not submitted" : kyb.status;

  // UI-031: a verification that does not allow binding is the first thing waiting on this broker.
  // The rule is the one the server enforces before binding (lib/broker/eligibility.ts): unknown
  // and pending are not permission either.
  const canBind = bindingIsAllowed(kyb.status);
  const verificationBlocking: BlockingTask | null = canBind
    ? null
    : {
        label: `Business verification ${verificationWord}: you cannot bind`,
        detail: kyb.explanation,
        href: "/broker/kyb",
      };

  const filter = pickFilter(query.filter, FILTERS);
  const search = (firstValue(query.q) ?? "").trim().toLowerCase();
  const shown = policies.filter((policy) => {
    if (filter && filterOf(policy.status) !== filter) return false;
    if (search === "") return true;
    return [policy.policyNumber, policy.customerName].some((text) => text.toLowerCase().includes(search));
  });

  const countByFilter = (wanted: Filter) => policies.filter((policy) => filterOf(policy.status) === wanted).length;
  const waitingToBePaid = policies.filter(
    (policy) => policy.status === "draft" || policy.status === "awaiting_payment" || policy.status === "payment_failed",
  ).length;
  const boundPremiumCents = policies
    .filter((policy) => policy.status === "bound" && policy.terms)
    .reduce((total, policy) => total + (policy.terms?.annualPremiumCents ?? 0), 0);

  // A refused action elsewhere sends the broker back here with its sentence (F-B13-08).
  const toasts = toastsFromQuery(query, { error: { tone: "error", title: "Refused" } });


  return (
    <PortalShell
      active="policies"
      user={user}
      tasks={tasks}
      toasts={toasts}
      band={{
        title: "Your policies",
        // No name and no chip: a list screen carries neither (Yoann, 2026-09-09). The sidebar
        // says who is signed in, business verification is an entry of the sidebar, and the
        // AF-02 words are on the top bar of every workspace screen.
        actions: (
          <Link className="button-link orange" href="/broker/policies/new" prefetch={false}>
            New policy
          </Link>
        ),
      }}
    >
      {query.error ? (
        <div className="notices">
          <p className="error" role="alert">
            {query.error}
          </p>
        </div>
      ) : null}

      {/* TWO TILES (cycle 2, decision 2): what is waiting on the broker, and what they have on
          the books. The totals per state are on the filter chips of the toolbar below. */}
      <Stats>
        <Stat
          label="Waiting to be paid"
          value={waitingToBePaid}
          tone={waitingToBePaid > 0 ? "warn" : "neutral"}
          href={withParams(PATH, query, { filter: "waiting" })}
          note="drafts, unpaid, failed payment"
        />
        <Stat label="Annual premium bound" value={formatCentsAsUsd(boundPremiumCents)} tone="accent" hint="The terms in force today, before state tax and the flat policy fee." />
      </Stats>

      <WhatNeedsYou tasks={tasks} blocking={verificationBlocking} />

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
              <input type="search" name="q" defaultValue={search} placeholder="Policy number, customer" aria-label="Search your policies" />
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
                ? [{ term: "on the latest terms", meaning: "a change is already written on the policy and takes effect after that date; the figure above it is the one in force now" }]
                : []),
              // Only the statuses the rows below print, in the order they appear.
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
            <th className="nowrap">Effective</th>
            <th>Status</th>
            <th className="num">Total</th>
            <th aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr>
              <td colSpan={6} className="dt-empty">
                <EmptyState illustration="closed-folder" action={
                  policies.length === 0 ? (
                    <Link className="button-link orange" href="/broker/policies/new" prefetch={false}>
                      New policy
                    </Link>
                  ) : undefined
                }>
                  {policies.length === 0 ? "No policy yet. Start with a new one." : "No policy matches this filter."}
                </EmptyState>
              </td>
            </tr>
          ) : (
            shown.map((policy) => (
              <Row key={policy.policyId} href={`/policies/${policy.policyId}`}>
                <Primary href={`/policies/${policy.policyId}`}>{policy.policyNumber}</Primary>
                <td>{policy.customerName}</td>
                <td className="nowrap">
                  {policy.effectiveAt}
                  <span className="dt-sub">{policy.stateCode}</span>
                </td>
                <td>
                  <Chip tone={statusTone(policy.status)}>{policy.status.replace(/_/g, " ")}</Chip>
                </td>
                {/* The fold has no answer on that date (the policy was not issued yet, or a
                    correction reversed its issuance), so these are the policy record's own
                    figures and the row says so rather than calling them cover. */}
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
        <h4>On the policy record</h4>
        <p>A row marked this way could not be rebuilt on that date, so its figures are the ones written on the policy.</p>
        <h4>What was collected</h4>
        <p>What was actually collected and refunded is on the policy page, in its journal. This list shows terms, not cash.</p>
        <h4>Binding</h4>
        <p>
          A policy binds when Stripe confirms the payment and the business verification is approved. While it is not, the money sits in the suspense account and staff operations decide.
        </p>
        <h4>Your verification</h4>
        <p>{kyb.explanation}</p>
        {kyb.isProviderEvidence || !kyb.providerAccountId ? null : (
          <p>{KYB_NOT_LIVE_LABEL}. The status above is a seeded placeholder, not provider evidence.</p>
        )}
      </About>

      <LandscapeFooter name="garden-gate" title={<>Built for <em>growing businesses.</em></>}>
        Coverage, records and the next customer decision stay together.
      </LandscapeFooter>
    </PortalShell>
  );
}
