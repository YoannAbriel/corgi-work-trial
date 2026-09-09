import "@/app/styles/lists.css";
import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Chip } from "@/components/detail-layout";
import { PortalShell } from "@/components/portal-shell";
import { LandscapeFooter } from "@/components/ui/landscape";
import { WhatNeedsYou, workspaceTasks } from "@/components/what-needs-you";
import { About } from "@/components/ui/about";
import { EmptyState } from "@/components/ui/empty";
import { Legend } from "@/components/ui/legend";
import { Stat, Stats } from "@/components/ui/stat";
import { Chevron, DataTable, Num, Primary, Row } from "@/components/ui/table";
import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { centsFromDatabase, formatCentsAsUsd } from "@/lib/money/cents";
import { correctionsOfPolicy, policyAsItStoodOn } from "@/lib/policy/correction-read";
import { liveEndorsementRequest, type EndorsementRequest, type EndorsementRequestStanding } from "@/lib/policy/endorsement-requests";
import { policyDetail } from "@/lib/policy/read";
import { termsInForceOn, type TermsInForce } from "@/lib/policy/terms-in-force";
import { toastsFromQuery, type Query } from "@/lib/ui/views";

// The customer's own policies: what is in force, the documents, and any endorsement waiting for
// their approval. A customer only ever sees the policies of the customer their user account is
// attached to: the list is queried by customer_id from the session, never by an id in the URL.
// What each status means, said to the person who holds the policy. The legend prints only the
// ones their own rows show.
const STATUS_MEANING: Record<string, string> = {
  draft: "quoted by your broker, not paid yet",
  awaiting_payment: "waiting for the payment",
  payment_failed: "the payment was refused; the cover has not started",
  paid_not_bound: "paid, and waiting on a check before the cover starts",
  bound: "in force, on the terms this row shows",
  cancelled: "cover stopped, the unearned premium was refunded",
  voided: "a correction reversed the issuance; this policy never took effect",
};

// The statuses on the screen, once each, in the order the rows use them.
function statusesOnScreen(rows: { status: string }[]): string[] {
  const seen: string[] = [];
  for (const row of rows) if (!seen.includes(row.status) && STATUS_MEANING[row.status]) seen.push(row.status);
  return seen;
}

export default async function CustomerPage({ searchParams }: { searchParams: Promise<Query> }) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "customer" || !user.customerId) {
    redirect("/broker");
  }
  const query = await searchParams;
  const today = new Date().toISOString().slice(0, 10);

  const policies = await sql<
    { policy_id: string; policy_number: string; broker_name: string; status: string; effective_at: string; term_end: string; annual_premium_cents: string }[]
  >`
    select policy.id as policy_id, policy.policy_number, broker.name as broker_name, current_policy.status,
           to_char(current_policy.effective_at, 'YYYY-MM-DD') as effective_at,
           to_char(current_policy.term_end, 'YYYY-MM-DD') as term_end,
           current_policy.annual_premium_cents
      from policies policy
      join brokers broker on broker.id = policy.broker_id
      join policy_current current_policy on current_policy.policy_id = policy.id
     where policy.customer_id = ${user.customerId}
     order by policy.created_at desc
  `;

  const rows = [];
  for (const policy of policies) {
    const live = await liveEndorsementRequest(sql, policy.policy_id);
    // Slice B8: a correction that moved an endorsement to an earlier date charges more days of
    // cover. Above $500 the customer decides, exactly as for an endorsement above $500.
    const correctionsToApprove = (await correctionsOfPolicy(policy.policy_id)).filter(
      (correction) =>
        correction.collection !== null &&
        correction.collection.customerApprovalRequired &&
        correction.collection.customerApprovedAt === null &&
        correction.collection.paidOn === null,
    );
    rows.push({
      ...policy,
      live,
      correctionsToApprove,
      terms: await termsInForceForThisList(policy.policy_id, policy.effective_at, today, policy.annual_premium_cents),
      // The LATEST premium written on the policy record: policy_current applies every event
      // whatever its effective date, so this is what the policy becomes once the changes already
      // signed take effect. The cell below names it under the premium in force today.
      latestAnnualPremiumCents: centsFromDatabase(policy.annual_premium_cents, "annual_premium_cents"),
    });
  }

  // What is waiting for this customer, read once for the sidebar count and for the block below.
  const tasks = await workspaceTasks(user);

  // The toast says a sentence, not the bare value the redirect carried: `?approved=1` used to
  // show a toast whose body was "1" (feedback audit of 2026-09-09). Each rule writes its own
  // body; the route sends `already` when the decision had been recorded before this click.
  const toasts = toastsFromQuery(query, {
    error: { tone: "error", title: "Refused" },
    approved: {
      tone: "ok",
      title: "Endorsement approved",
      text: (outcome) => (outcome === "already" ? "It was already approved." : "Your broker collects the delta."),
    },
    correctionApproved: {
      tone: "ok",
      title: "Correction approved",
      text: (outcome) => (outcome === "already" ? "It was already approved." : "Your broker collects the difference."),
    },
  });

  const bound = rows.filter((policy) => policy.status === "bound").length;

  return (
    <PortalShell
      user={user}
      active="policies"
      tasks={tasks}
      toasts={toasts}
      band={{
        title: "Your policies",
        // No name and no chip on a list screen (Yoann, 2026-09-09): what is in force is the first
        // tile, and what waits is the "What needs you" panel right under it.
      }}
    >
      {/* The inline sentences the review scripts read, beside the toasts. */}
      {query.error || query.approved || query.correctionApproved ? (
        <div className="notices">
          {query.error ? (
            <p className="error" role="alert">
              {query.error}
            </p>
          ) : null}
          {query.approved === "1" ? <p className="note">Thank you, the endorsement is approved. Your broker collects the delta.</p> : null}
          {query.approved === "already" ? <p className="note">This endorsement was already approved.</p> : null}
          {query.correctionApproved === "1" ? <p className="note">Thank you, the correction is approved. Your broker collects the difference.</p> : null}
          {query.correctionApproved === "already" ? <p className="note">This correction was already approved.</p> : null}
        </div>
      ) : null}

      {/* Two tiles (cycle 2, decision 2). What waits on the customer is the band's second chip
          and the block right under here; a third tile said the same zero a third time. */}
      <Stats>
        <Stat label="Policies" value={rows.length} note="attached to your account" />
        <Stat label="In force" value={bound} tone={bound > 0 ? "ok" : "neutral"} note="bound today" />
      </Stats>

      <WhatNeedsYou tasks={tasks} />

      <DataTable
        ariaLabel="Your policies"
        // The column, then only the statuses the rows below print, in the customer's words: a
        // chip reading "voided" with nothing defining it is a word nobody outside the office
        // knows (cycle 2: a legend names the statuses on screen, and no others).
        legend={
          <Legend
            items={[
              { term: "Annual premium", meaning: "the premium in force today, before state tax and the policy fee" },
              // Named only when a row below prints it: a legend is a reading of THIS screen.
              ...(rows.some((policy) => writtenLaterPremium(policy) !== null)
                ? [{ term: "on the latest terms", meaning: "a change is already written on your policy and takes effect later; the figure above it is the one in force today" }]
                : []),
              ...(rows.some((policy) => requestedPremium(policy) !== null)
                ? [{ term: "from a date", meaning: "the premium from that day, once your broker collects the delta of the change that was asked for" }]
                : []),
              ...statusesOnScreen(rows).map((status) => ({ term: status.replace(/_/g, " "), meaning: STATUS_MEANING[status] })),
              { term: "on the policy record", meaning: "the figures could not be rebuilt for that date, so they are the ones written on the policy" },
            ]}
          />
        }
      >
        <thead>
          <tr>
            <th>Policy</th>
            <th className="nowrap">Term</th>
            <th>Status</th>
            <th className="num">Annual premium</th>
            {/* No "Waiting for you" column: it said "nothing" on every row while the band chip
                and the block above already said the same zero (round 1, MEDIUM). What is waiting,
                when something is, is the button in the cell below. */}
            <th>Documents</th>
            <th aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="dt-empty">
                <EmptyState illustration="coverage-corgi">No policy is attached to your account yet.</EmptyState>
              </td>
            </tr>
          ) : (
            rows.map((policy) => (
              // UI-034: the row opens the policy, where the change-request form is. The policy
              // number was plain text, so the only way in was to know the URL.
              <Row key={policy.policy_id} href={`/policies/${policy.policy_id}`}>
                <Primary href={`/policies/${policy.policy_id}`} sub={policy.broker_name}>
                  {policy.policy_number}
                </Primary>
                <td className="nowrap">
                  {policy.effective_at}
                  <span className="dt-sub">to {policy.term_end}</span>
                </td>
                <td>
                  <Chip tone={policy.status === "bound" ? "ok" : policy.status === "cancelled" || policy.status === "voided" ? "neutral" : "warn"}>
                    {policy.status.replace(/_/g, " ")}
                  </Chip>
                </td>
                {/* F-LU-05: the same wording the broker and staff lists carry. The fold has no
                    answer on that date (the policy was voided, or was not issued yet), so this is
                    the policy record's own figure and the row says so. */}
                <Num sub={underThePremium(policy)}>
                  {formatCentsAsUsd(policy.terms.annualPremiumCents)}
                </Num>
                {/* The documents, and the one decision waiting on this policy when there is one.
                    Every link is a DIRECT child of the cell, so the stylesheet lifts them above
                    the row-wide link and a click on any of them does its own thing (F-B13-25). */}
                <td className="nowrap">
                  {policy.live?.standing.state === "awaiting_approval" ? (
                    <Link
                      href={`/policies/${policy.policy_id}/endorsements/${policy.live.request.eventId}/approve`}
                      className="button-link orange small"
                      prefetch={false}
                    >
                      Approve {formatCentsAsUsd(policy.live.request.figures.deltaTotalCents)}
                    </Link>
                  ) : null}
                  {policy.correctionsToApprove.map((correction) => (
                    <Link
                      key={correction.rebookEventId}
                      href={`/policies/${policy.policy_id}/corrections/${correction.rebookEventId}/approve`}
                      className="button-link orange small"
                      prefetch={false}
                    >
                      Approve {formatCentsAsUsd(correction.collection!.amountCents)}
                    </Link>
                  ))}{" "}
                  {/* Both routes serve the PDF inline, so they open beside this list instead
                      of replacing it. */}
                  <a
                    href={`/api/policies/${policy.policy_id}/documents/declarations?asOf=${today}`}
                    target="_blank"
                    rel="noopener"
                  >
                    Declarations
                  </a>{" "}
                  <a
                    href={`/api/policies/${policy.policy_id}/documents/endorsement-schedule?asOf=${today}`}
                    target="_blank"
                    rel="noopener"
                  >
                    Schedule
                  </a>
                </td>
                <Chevron />
              </Row>
            ))
          )}
        </tbody>
      </DataTable>


      <About>
        <h4>Annual premium</h4>
        <p>
          The premium in force today, or on the first day of the term when the term has not begun. An endorsement dated later is not in this figure: when there is one, the second line of the cell says what your policy&apos;s latest terms are, and a change that was asked for and not paid yet is named under it with the day it would start.
        </p>
        <h4>On the policy record</h4>
        <p>
          A row marked this way could not be rebuilt on that date, because the policy was not issued yet or a correction reversed its issuance. Its figures are the ones written on the policy.
        </p>
        <h4>Waiting for you</h4>
        <p>
          An endorsement or a correction that charges more than $500 needs your acceptance before your broker may collect it. Nothing is collected until you accept. When one is waiting, its Approve button is on the policy&apos;s own row; an endorsement whose delta your broker has not paid yet needs nothing from you.
        </p>
        <h4>Documents</h4>
        <p>The declarations and the endorsement schedule are rebuilt for today&apos;s date every time you open them.</p>
      </About>

      <LandscapeFooter name="orchard-morning" title={<>Your coverage. <em>Close at hand.</em></>}>
        The policy, its documents and every decision live in one clear place.
      </LandscapeFooter>
    </PortalShell>
  );
}

// WHAT THE PREMIUM CELL SAYS UNDER ITS FIGURE, and nothing at all when there is nothing to say.
//
// The figure above is the premium in force today. It is right, and on a policy carrying a change
// dated later it reads as stale to the person holding the policy: on 2026-09-09 Yoann read
// $1,200.00 on CGP-01707 while an endorsement to $2,400.00 was already written for 2026-09-22 and
// another to $2,700.00 had been asked for. The cell now names all three.
//
// TWO SOURCES, and they are not equally complete:
//   - the terms already WRITTEN on the record come from policy_current, which stores the latest
//     premium and NOT the effective date of the endorsement that wrote it (lib/policy/current.ts
//     folds `latestEndorsementEffectiveAt`, refreshPolicyCurrent never writes it to the table),
//     so that line names the amount and not the day;
//   - the change REQUESTED and not in force comes from liveEndorsementRequest
//     (lib/policy/endorsement-requests.ts), which carries the whole quote: it returns only the
//     request that is neither applied nor superseded, so this is exactly the one whose delta has
//     still to be paid, and the line names both the amount and the day.
type PremiumRow = {
  terms: Pick<TermsInForce, "onDate" | "annualPremiumCents">;
  latestAnnualPremiumCents: number;
  live: { request: EndorsementRequest; standing: EndorsementRequestStanding } | null;
};

function writtenLaterPremium(row: PremiumRow): string | null {
  // The fold has no answer for that date, so the figure above IS the policy record's own and
  // there is nothing later to compare it with.
  if (row.terms.onDate === null) return null;
  if (row.latestAnnualPremiumCents === row.terms.annualPremiumCents) return null;
  return `${formatCentsAsUsd(row.latestAnnualPremiumCents)} on the latest terms`;
}

function requestedPremium(row: PremiumRow): string | null {
  if (!row.live) return null;
  return `${formatCentsAsUsd(row.live.request.figures.newAnnualPremiumCents)} from ${row.live.request.figures.effectiveAt} once the delta is paid`;
}

// Everything the cell says under its figure, or nothing at all: an empty `sub` would draw an
// empty line under every row of the table.
function underThePremium(row: PremiumRow): ReactNode | undefined {
  const fromTheRecord = row.terms.onDate === null;
  const written = writtenLaterPremium(row);
  const requested = requestedPremium(row);
  if (!fromTheRecord && !written && !requested) return undefined;
  return (
    <>
      {fromTheRecord ? "on the policy record" : null}
      {written ? <span className="lists-later">{written}</span> : null}
      {requested ? <span className="lists-later">{requested}</span> : null}
    </>
  );
}

// THE TERMS IN FORCE TODAY, not the latest terms the policy record carries (UI-035).
//
// `policy_current` applies every event whatever its effective date, so a policy holding an
// endorsement effective next month already answers next month's premium there. On 2026-09-09 this
// list said $2,400.00 was in force on CGP-01707 while the policy's own page, folded on the same
// day, said $1,200.00 and named the $2,400.00 endorsement as taking effect on 2026-10-08. Both
// screens now ask the same question of the same helper, lib/policy/terms-in-force.ts.
//
// The whole answer is returned, not only the premium: `onDate` is null when the fold could not
// rebuild the policy on that date, and the row prints "on the policy record" when it is, exactly
// as the broker and staff lists do (review finding F-LU-05).
//
// The date is the one the detail page uses: today, unless the term has not started yet, since a
// policy cannot be rebuilt on a day before its own first one.
async function termsInForceForThisList(
  policyId: string,
  effectiveAt: string,
  today: string,
  // What the list already read from `policy_current`. It is used only if the policy has gone
  // between that query and this one, which append-only tables do not do: there is no third
  // figure to fall back on, and printing nothing would be worse than printing the stored one.
  storedAnnualPremiumCents: string,
): Promise<Pick<TermsInForce, "onDate" | "annualPremiumCents">> {
  const policy = await policyDetail(policyId);
  if (!policy) {
    return { onDate: null, annualPremiumCents: centsFromDatabase(storedAnnualPremiumCents, "annual_premium_cents") };
  }
  const onDate = today > effectiveAt ? today : effectiveAt;
  return termsInForceOn(policy, await policyAsItStoodOn(policyId, onDate));
}
