import Link from "next/link";
import { Download } from "lucide-react";
import { Disclosure, SandboxReferences } from "@/components/disclosures";
import { Chip } from "@/components/detail-layout";
import { Emphasis } from "@/components/emphasis";
import { JournalTable } from "@/components/journal-table";
import { DataTable, ExpandHead, ExpandRow, FactGrid } from "@/components/ui/table";
import { Stat } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
import { When } from "@/components/ui/time";
import { formatCentsAsUsd } from "@/lib/money/cents";
import type { NavView } from "@/components/shell/app-shell";
import type { UserRole } from "@/lib/auth/current-user";
import {
  policyAsItStoodOn,
  policyAsOfSteps,
  policyTimeline,
  type CorrectionView,
  type TimelineAudience,
} from "@/lib/policy/correction-read";
import { FormulaLinesTable } from "./formula-lines";

// Everything the policy screens share, and the four blocks slice B8 added to a policy: the list
// of the policy's views, the two documents, the form that corrects an effective date, what a
// correction did, the whole history of the policy with both of its clocks, and the policy as it
// stood on any business date.
//
// They live here because a Next.js page module may only export the page itself, and the policy
// screen, the customer's own view of the same policy and the six form pages all draw some of
// them. The interface system spread the B8 blocks over the views of the policy screen: the
// corrections go with the money, and the timeline, the dates a policy changed and the date answer
// make the timeline view.
//
// They are server components. Every amount arrives already computed in integer cents from the
// events and the journal; nothing here does arithmetic, and no money value is ever computed in
// the browser.

// ---------------------------------------------------------------------------
// The pieces the policy screens share
// ---------------------------------------------------------------------------

// The views of a policy, named once. The screen itself cannot hold this list: a Next.js page
// module may only export the page, and the six form pages need the same list to keep the policy's
// navigation open while a form is on screen (cycle 2, decision 17).
// `billing` is decision 43 (Yoann, 2026-09-09): the money a policy owes, has paid and is getting
// back, with the buttons that take it, in one place between the journal and the history.
export const POLICY_VIEWS = ["overview", "endorsements", "claims", "money", "billing", "timeline"] as const;
export type PolicyView = (typeof POLICY_VIEWS)[number];
export const POLICY_VIEW_LABEL: Record<PolicyView, string> = {
  overview: "Overview",
  endorsements: "Endorsements",
  claims: "Claims",
  money: "Money",
  billing: "Billing",
  timeline: "Timeline",
};

// The same, for the customer, whose policy has two views and no money screens. Their two approval
// pages are forms on top of their own policy, so the sidebar keeps that policy while they read.
export function customerPolicyViews(policyId: string, formLabel: string, formHref: string) {
  return [
    { key: "overview", label: "Overview", href: `/policies/${policyId}`, current: false },
    { key: "billing", label: "Billing", href: `/policies/${policyId}?view=billing`, current: false },
    { key: "documents", label: "Documents", href: `/policies/${policyId}?view=documents`, current: false },
    { key: "form", label: formLabel, href: formHref, current: true },
  ];
}

// THE SECOND HEADLINE TILE: the latest annual premium the record carries, and the date it starts.
//
// Yoann, live on 2026-09-09: "pourquoi ici je vois 1 200 ?". The first tile answers "what is in
// force today", which on a policy carrying an endorsement to $2,400.00 effective 2026-09-22 and a
// quote for $2,700.00 effective 2026-10-01 is $1,200.00 and reads as a stale figure. It is not
// stale, it is a different question, so the other question gets its own tile beside it.
//
// Every figure comes from the endorsement's own stored event; nothing is recomputed and nothing
// new is read. The tile is not drawn at all when the policy has never been endorsed: a tile
// saying "same as today" repeats the tile beside it.
export function LatestTermsStat({
  schedule,
  pending,
  href,
}: {
  // The applied endorsements, oldest effective date first, as the page already read them.
  schedule: { endorsedEventId: string; effectiveAt: string; figures: { newAnnualPremiumCents: number } }[];
  // The endorsement that is quoted or approved and whose delta has not been collected, if any.
  pending: {
    newAnnualPremiumCents: number;
    effectiveAt: string;
    // True once the customer has approved the quote: what is left is the payment. Before that,
    // the change needs a yes as well as the money, and the line says so.
    approved: boolean;
  } | null;
  // Where the detail is. Staff and the broker have an endorsements view; the customer does not.
  href?: string;
}) {
  // The last row of the schedule is the newest effective date: the reader orders by it.
  const latestApplied = schedule.length > 0 ? schedule[schedule.length - 1] : null;
  if (!latestApplied && !pending) {
    return null;
  }
  return (
    <Stat
      label="Latest terms on record"
      href={href}
      value={
        latestApplied
          ? formatCentsAsUsd(latestApplied.figures.newAnnualPremiumCents)
          : formatCentsAsUsd(pending!.newAnnualPremiumCents)
      }
      note={
        <>
          {latestApplied ? (
            <span>from {latestApplied.effectiveAt}</span>
          ) : (
            <span>nothing applied yet</span>
          )}
          {pending ? (
            <span className="stat-note-line">
              {formatCentsAsUsd(pending.newAnnualPremiumCents)} from {pending.effectiveAt}{" "}
              {pending.approved ? "once the delta is paid" : "if it is approved and the delta is paid"}
            </span>
          ) : null}
        </>
      }
    />
  );
}

// The id the band's "Pay the delta" link lands on: the Pay row of the Billing view. Named beside
// COLLECT_ANCHOR below so the two anchors of that view are declared together.
export const PAY_DELTA_ANCHOR = "pay-delta";

// THE SENTENCE ABOVE THE TILES while a change is quoted or approved and not paid for.
//
// LIVE-9 again, from the broker's side: the customer approved the $287.69 quote and the broker
// saw nothing. The inbox badge already read 1 for something else, and the only place the state
// existed was inside the "Endorsement in progress" card, three views away from where he was
// standing. This is one line at the top of the page, in the reader's own terms.
//
// It returns a plain string because <Emphasis> takes one: the rule that decides which pieces go
// bold lives in lib/ui/emphasis.ts, and nothing here rewords or rounds anything.
export function pendingEndorsementNotice({
  standingState,
  approvedAt,
  requestedAt,
  audience,
}: {
  standingState: string;
  // When the customer said yes, on an approved change. Null while it is still a quote.
  approvedAt: Date | null;
  // When the quote was written.
  requestedAt: Date;
  audience: "customer" | "staff";
}): string | null {
  const asUtc = (instant: Date) => `${instant.toISOString().replace("T", " ").slice(0, 19)} UTC`;
  if (standingState === "approved" && approvedAt) {
    return audience === "customer"
      ? `You approved the quote at ${asUtc(approvedAt)}; the endorsement takes effect when your broker pays the delta.`
      : `The customer approved the quote at ${asUtc(approvedAt)}; the endorsement takes effect when you pay.`;
  }
  if (standingState === "awaiting_approval") {
    return audience === "customer"
      ? `The quote was sent to you at ${asUtc(requestedAt)}; the endorsement takes effect when you approve it and the delta is paid.`
      : `The quote was sent to the customer at ${asUtc(requestedAt)}; the endorsement takes effect when the customer approves and the delta is paid.`;
  }
  return null;
}

// Whether the change that is not in force yet is waiting on THIS reader, for the count chip on
// the Endorsements entry of the policy's navigation. A count is only ever drawn for something the
// person reading has to do (cycle 2, decision 3: counts are not notifications), so a broker is
// not counted for a quote sitting with the customer, and a customer is not counted for a delta
// their broker has to pay.
export function endorsementNeedsThisReader(standingState: string, audience: "customer" | "staff"): boolean {
  return audience === "customer" ? standingState === "awaiting_approval" : standingState === "approved";
}

// THE STATE OF A CHANGE THAT IS NOT IN FORCE YET, in the words of the reader looking at it.
//
// LIVE-9: a customer who had already approved a $287.69 quote saw nothing about it in "Changes to
// this policy"; the change existed only as two lines of the event list at the bottom of the page.
// It is a row of that table now, and this chip is what keeps the row from reading as in force.
//
// The rule it states is the one the "Endorsement in progress" card already states in a sentence:
// the policy terms stay as they are until the delta is paid.
export function pendingEndorsementState(
  standingState: string,
  audience: "customer" | "staff",
): { label: string; tone: "warn" | "neutral" } {
  if (standingState === "awaiting_approval") {
    return { label: audience === "customer" ? "awaiting your approval" : "awaiting the customer", tone: "neutral" };
  }
  return { label: "approved, awaiting payment", tone: "warn" };
}

// Where the backdated correction lives, named once so the band and every navigation that offers
// it point at the same address.
export function correctionHref(policyId: string) {
  return `/policies/${policyId}/corrections/new`;
}

// The correction as an entry of the policy's navigation, for the one role allowed to make one.
//
// Finding F-LIVE-01: the screen had no visible way in. The band offered Endorse, Cancel and Open
// a claim, the navigation listed the five views, and the only link was the one-line form under
// the Endorsements table, which reads as a filter; the word "Correct" appeared only once the
// reader was already on the screen.
//
// Operations only, because correcting the record is their job and the screen itself refuses
// anybody else (app/policies/[policyId]/corrections/new/page.tsx redirects every other role back
// to the policy). Listed whether or not the policy has an endorsement, because that screen says
// so in its own words: "This policy has no endorsement in force, so there is no effective date to
// correct."
//
// It returns no entry or one, so a caller spreads it into its own list and the role test is
// written here instead of on every screen.
export function correctionViews({
  policyId,
  role,
  current = false,
}: {
  policyId: string;
  role: UserRole;
  // True on the correction screen itself, so the entry is the one the reader is standing on.
  current?: boolean;
}): NavView[] {
  if (role !== "staff_ops") {
    return [];
  }
  return [{ key: "correct", label: "Correct", href: correctionHref(policyId), current }];
}

// The same navigation, for a form opened on top of a policy (endorse, cancel, correct, open a
// claim, the two approvals): the policy's own views, then the form itself as the entry the reader
// is on. Without it the sidebar emptied the moment a form opened and the reader lost the record
// they were working in (round 1, MEDIUM).
export function policyFormViews({
  policyId,
  formLabel,
  formHref,
  role,
}: {
  policyId: string;
  // What the form is, in one or two words: "Endorse", "Cancel", "Correct".
  formLabel: string;
  // Where the reader is, so the current entry is a link to the page they are on.
  formHref: string;
  // The reader's role, when the screen wants the correction listed here too. Optional: the
  // correction's own screen draws itself as the current entry below and needs no second copy, and
  // a caller that passes nothing simply lists no correction.
  role?: UserRole;
}): NavView[] {
  return [
    ...POLICY_VIEWS.map((one) => ({
      key: one,
      label: POLICY_VIEW_LABEL[one],
      href: one === "overview" ? `/policies/${policyId}` : `/policies/${policyId}?view=${one}`,
      current: false,
    })),
    ...(role ? correctionViews({ policyId, role }) : []),
    { key: "form", label: formLabel, href: formHref, current: true },
  ];
}

// The two documents of a policy, in the Documents card of the overview: one compact line each,
// the name on the left, the date they are rebuilt on in the middle, the download on the right
// (cycle 2, decision 16 folded the Documents view into this card). Same action, same method, same
// field name as before: the route reads `asOf` and rebuilds the PDF from the events effective on
// or before it.
//
// The name is plain text and the button is the icon alone, because a button carrying the name of
// the document repeated it and made the row as wide as the card for no gain (Yoann, 2026-09-09).
// What pressing it does is said once, under the list, instead of once per row.
export function PolicyDocuments({
  policyId,
  documentDate,
  termStart,
}: {
  policyId: string;
  documentDate: string;
  termStart: string;
}) {
  return (
    <>
      <DocumentRow
        policyId={policyId}
        endpoint="declarations"
        fieldId="asOfDeclarations"
        label="Declarations"
        documentDate={documentDate}
        termStart={termStart}
      />
      <DocumentRow
        policyId={policyId}
        endpoint="endorsement-schedule"
        fieldId="asOfSchedule"
        label="Endorsement schedule"
        documentDate={documentDate}
        termStart={termStart}
      />
      <p className="pd-note">PDF as of the chosen date, opens in a new tab.</p>
    </>
  );
}

function DocumentRow({
  policyId,
  endpoint,
  fieldId,
  label,
  documentDate,
  termStart,
}: {
  policyId: string;
  // The route that rebuilds this document. It is also what the form posts to, so the two cannot
  // drift apart.
  endpoint: "declarations" | "endorsement-schedule";
  fieldId: string;
  label: string;
  documentDate: string;
  termStart: string;
}) {
  return (
    // The PDF is reached through this GET form, so the new tab is asked for on the form
    // rather than on a link: same action, same method, same field name. One row is one form,
    // because the date field belongs to the document it rebuilds and to no other.
    <form
      method="get"
      action={`/api/policies/${policyId}/documents/${endpoint}`}
      className="pd-doc-row"
      target="_blank"
      // F-EV-07: a target="_blank" without this hands the opened tab a window.opener back into
      // this page. The five anchors that open a PDF already carry it; these two forms did not.
      rel="noopener"
    >
      <span className="pd-doc-name">{label}</span>
      <input
        id={fieldId}
        name="asOf"
        type="date"
        defaultValue={documentDate}
        min={termStart}
        required
        aria-label={`${label} as of`}
      />
      {/* The icon alone, so the name is not printed twice on one row. The label a screen reader
          and a hover both get says which document and what comes back. */}
      <button
        type="submit"
        className="secondary pd-doc-download"
        aria-label={`Download ${label} as PDF`}
        title={`Download ${label} as PDF`}
      >
        <Download size={15} aria-hidden="true" />
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// The form: correct the effective date of one endorsement
// ---------------------------------------------------------------------------

// Offered on the endorsement in force, to staff operations only. It writes nothing: it opens the
// impact preview, which computes the whole thing with the same pure function the execution uses
// and shows it before anything is recorded.
export function CorrectEndorsementDateForm({
  policyId,
  endorsedEventId,
  effectiveAt,
  termStart,
  termEnd,
}: {
  policyId: string;
  endorsedEventId: string;
  effectiveAt: string;
  termStart: string;
  termEnd: string;
}) {
  return (
    // One line under the schedule, not a block of its own (cycle 2, decision 16): the date it
    // should have carried, the reason that goes on every entry, and the button. Same GET, same
    // action, same three field names; the preview it opens is what writes nothing and shows the
    // whole impact first.
    <form method="get" action={`/policies/${policyId}/corrections/new`} className="pd-inline-form">
      <input type="hidden" name="endorsedEventId" value={endorsedEventId} />
      <label htmlFor={`correctedEffectiveAt-${endorsedEventId}`}>Correct the effective date to</label>
      <input
        id={`correctedEffectiveAt-${endorsedEventId}`}
        name="correctedEffectiveAt"
        type="date"
        required
        defaultValue={effectiveAt}
        min={termStart}
        max={termEnd}
      />
      <input
        id={`reason-${endorsedEventId}`}
        name="reason"
        required
        minLength={10}
        maxLength={300}
        aria-label="Why the date is corrected, written on the correction and on every entry"
        placeholder="why: the broker's email asked for June 9"
      />
      <button type="submit" className="secondary">
        Preview
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Corrections, explained
// ---------------------------------------------------------------------------

// The id the band's "Collect" link and the broker's inbox item land on: the action row of the
// correction whose difference is still open. One anchor per page, so a link cannot land on a
// correction that was settled long ago.
export const COLLECT_ANCHOR = "collect";

// Is this correction's difference still waiting to be collected, and may this reader collect it?
// The three facts the button is drawn from, read in one place, so the band, the anchor and the
// button cannot disagree about whether there is money to take.
export function openCollectionOf(correction: CorrectionView, canPay: boolean) {
  const collection = correction.collection;
  if (correction.money.settlement !== "collect" || !collection || collection.paidOn) {
    return null;
  }
  const waitingForTheCustomer = collection.customerApprovalRequired && !collection.customerApprovedAt;
  return {
    amountCents: collection.amountCents,
    waitingForTheCustomer,
    // Collectable now only when the money is this reader's to take AND the customer has approved
    // it where approval was required. The server checks both again when the form is posted.
    canCollectNow: canPay && !waitingForTheCustomer,
  };
}

// The first correction on this policy whose difference is still open, for the band. Null when
// there is nothing to collect, which is the ordinary case.
export function firstOpenCollection(corrections: CorrectionView[], canPay: boolean) {
  for (const correction of corrections) {
    const open = openCollectionOf(correction, canPay);
    if (open) {
      return { correction, open };
    }
  }
  return null;
}

// Where the money of one correction stands, in one badge. Drawn on the Money view beside the
// correction it belongs to, and again at the top of the Billing view above the button, so the two
// screens say the same sentence about the same money.
function CorrectionMoneyBadge({
  correction,
  open,
}: {
  correction: CorrectionView;
  open: ReturnType<typeof openCollectionOf>;
}) {
  const collection = correction.collection;
  if (!collection) {
    return null;
  }
  return (
    <p
      className={
        collection.paidOn ? "badge badge-ok" : open?.waitingForTheCustomer ? "badge badge-neutral" : "badge badge-warn"
      }
    >
      {collection.paidOn
        ? `The difference of ${formatCentsAsUsd(collection.amountCents)} was collected on ${collection.paidOn}`
        : open?.waitingForTheCustomer
          ? `${formatCentsAsUsd(collection.amountCents)} waiting for the customer's approval`
          : `${formatCentsAsUsd(collection.amountCents)} still to collect from the customer`}
    </p>
  );
}

// THE ACTION ROW OF A CORRECTION, on the Billing view: the state, why it is waiting if it is, and
// the button that opens the Stripe page. Same POST, same route, same absence of fields as when it
// sat at the bottom of the Money view; only where it is drawn changed (decision 43).
export function CorrectionCollectRows({
  corrections,
  policyId,
  canPay,
}: {
  corrections: CorrectionView[];
  policyId: string;
  // Whether this reader may take the money: the owning broker or staff operations. The API checks
  // it again when the form is posted.
  canPay: boolean;
}) {
  // Only what is still open: a difference already collected belongs in "What was paid", not
  // under a heading that says something needs paying.
  const stillOpen = corrections.filter((correction) => openCollectionOf(correction, canPay) !== null);
  if (stillOpen.length === 0) {
    return null;
  }
  const anchored = firstOpenCollection(corrections, canPay)?.correction ?? null;

  return (
    <>
      {stillOpen.map((correction) => {
        const open = openCollectionOf(correction, canPay);
        return (
          <div
            className="pd-collect"
            key={correction.rebookEventId}
            // The anchor the band's "Collect" link and the broker's inbox item land on.
            id={correction === anchored ? COLLECT_ANCHOR : undefined}
          >
            <CorrectionMoneyBadge correction={correction} open={open} />
            {open?.waitingForTheCustomer ? (
              <p className="pd-note">
                The customer has to approve it from their own screen before it can be collected:{" "}
                {correction.approvalSentences.customer ?? "it is above the customer approval threshold"}.
              </p>
            ) : null}
            {!correction.collection!.paidOn &&
            !correction.collection!.customerApprovalRequired &&
            correction.approvalSentences.customer ? (
              <p className="pd-note">Customer approval: {correction.approvalSentences.customer}.</p>
            ) : null}
            {open?.canCollectNow ? (
              <form
                method="post"
                action={`/api/policies/${policyId}/corrections/${correction.rebookEventId}/checkout`}
                className="inline-form"
              >
                <SubmitButton>
                  {correction.collection!.checkoutUrl && !correction.collection!.isDead
                    ? "Continue the payment of the difference at Stripe"
                    : `Collect the difference (${formatCentsAsUsd(correction.collection!.amountCents)}) with Stripe (test mode)`}
                </SubmitButton>
              </form>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

export function CorrectionsExplained({
  corrections,
  billingHref,
  now,
}: {
  // Read once by the page, so the band's "Collect $X", this block and the Billing view are all
  // the same figures from the same rows.
  corrections: CorrectionView[];
  // Where the button that takes the money lives (decision 43).
  billingHref: string;
  now: Date;
}) {
  if (corrections.length === 0) {
    return null;
  }

  return (
    <>
      {corrections.map((correction) => {
        // Asked with canPay = true because this badge states a fact about the money, not what
        // this reader may press: the button and its permission check are on the Billing view.
        const open = openCollectionOf(correction, true);
        return (
          <section className="card pd-correction" key={correction.rebookEventId}>
            <h2>
              Correction: {correction.wrongEffectiveAt} to {correction.correctedEffectiveAt}
              {correction.money.settlement === "collect" ? (
                <Chip tone={correction.collection?.paidOn ? "ok" : "warn"}>
                  {correction.collection?.paidOn ? "collected" : "to collect"}
                </Chip>
              ) : correction.money.settlement === "refund" ? (
                <Chip tone="warn">to give back</Chip>
              ) : (
                <Chip tone="ok">no money</Chip>
              )}
            </h2>
            <FactGrid
              items={[
                { label: "What", value: correction.description || "Endorsement" },
                { label: "Recorded", value: <When instant={correction.recordedAt} now={now} mode="utc" /> },
                ...(correction.operatorName ? [{ label: "By", value: correction.operatorName }] : []),
                { label: "Reason", value: correction.reason },
              ]}
            />

            {/* Where the money of this correction stands, said here, with no button: taking it is
                the Billing view's job (decision 43). The state is a fact about the correction and
                belongs beside it; the action belongs where the reader is told whose card pays. */}
            {correction.money.settlement === "collect" && correction.collection ? (
              <div className="pd-collect">
                <CorrectionMoneyBadge correction={correction} open={open} />
                <p className="pd-note">
                  <Link href={billingHref}>Pay and collect on the Billing view</Link>
                </p>
              </div>
            ) : null}
            {correction.money.settlement === "refund" ? (
              <p className="pd-note">
                <Emphasis>
                  {`The corrected date charges fewer days, so ${formatCentsAsUsd(-correction.money.differenceTotalCents)} goes back to the customer through Stripe. It is listed under the refunds above, with its state and the approver it is waiting for. Second approver: ${correction.approvalSentences.refund ?? "read from the refund itself"}.`}
                </Emphasis>
              </p>
            ) : null}
            {correction.money.settlement === "none" ? (
              <p className="pd-note">
                <Emphasis>{"The corrected date prices the same amount, so no money moves."}</Emphasis>
              </p>
            ) : null}

            {/* THE ARITHMETIC, FOLDED, closed on arrival. Yoann's rule F-YA-05 bans folding an
                ACTION; this is reading matter, and every row is in the HTML whether the fold is
                open or not, so a reviewer and a text search still find it. */}
            <Disclosure title="Impact, line by line">
              <p className="pd-note">
                <Emphasis>
                  {"The effective dates are business dates in the past; the recording time is when we learned we were wrong. Every figure here is the one stored on those events and posted to the journal."}
                </Emphasis>
              </p>
              {/* The same reading as the preview and the customer's approval screen (Yoann,
                  2026-09-09): the differences carry their sign and their direction colour, what was
                  booked and what the corrected date prices step back, the total is bold. */}
              <FormulaLinesTable
                lines={correction.lines}
                highlightKey="difference_total"
                signedKeys={["premium_difference", "tax_difference", "difference_total"]}
                referenceKeys={["premium_as_booked", "premium_corrected"]}
              />
            </Disclosure>

            {/* THE ENTRIES, FOLDED AND PAIRED. A correction posts entries that undo the wrong
                booking and entries that re-book it; they are marked so the pairs read as one
                movement each rather than as four separate ones. */}
            <Disclosure
              title={
                correction.entries.length === 1
                  ? "The entry this correction posted"
                  : `The ${correction.entries.length} entries this correction posted`
              }
            >
              <JournalTable
                entries={correction.entries}
                panelKey="correction"
                visibleEntries={6}
                ariaLabel="Correction entries"
                // The money view's own journal card says what a debit and a credit are, under it.
                // This panel sits on the same view, above it: repeating the sentence per correction
                // would print it four times on one screen.
                legend={false}
                // An entry carrying `reversesEntryId` is the one that undid a booking; the others
                // are the re-booking that replaced it.
                mark={(entry) =>
                  entry.reversesEntryId
                    ? { chip: <Chip tone="danger">reversed</Chip>, struck: true }
                    : { chip: <Chip tone="ok">re-booked on {entry.effectiveAt}</Chip> }
                }
              />
              <p className="pd-note">
                The cash entries of the original endorsement are not in this table on purpose: Stripe really does hold
                that money, so reversing them would make the ledger claim it left. What the correction changes is what
                the customer was billed, and the difference sits in premium receivable until it is settled.
              </p>
            </Disclosure>
          </section>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// The timeline: effective time and recorded time, side by side
// ---------------------------------------------------------------------------

// `audience` decides the words, never the rows (review finding F-B13-06). An operator reads the
// reason a colleague typed into a correction; a customer reads the same events, the same two
// dates and the same amounts, without the operator's free text and the internal references it
// carries.
export async function PolicyTimeline({
  policyId,
  now,
  audience = "operator",
}: {
  policyId: string;
  now: Date;
  audience?: TimelineAudience;
}) {
  const rows = await policyTimeline(policyId, undefined, audience);
  if (rows.length === 0) {
    return null;
  }
  return (
    <DataTable ariaLabel="Policy timeline">
      <thead>
        <tr>
          <ExpandHead />
          <th className="nowrap">Effective</th>
          <th className="nowrap">Recorded</th>
          <th>Event</th>
          <th>What</th>
        </tr>
      </thead>
      {rows.map((row) => (
        <ExpandRow
          key={row.eventId}
          columns={4}
          cells={
            <>
              <td className="nowrap">{row.supersededByEventId ? <s>{row.effectiveAt}</s> : row.effectiveAt}</td>
              <td className="nowrap">
                <When instant={row.recordedAt} now={now} />
              </td>
              <td>
                <Chip tone={row.supersededByEventId ? "neutral" : "ok"}>{row.eventType.replace(/_/g, " ")}</Chip>
              </td>
              <td>{row.supersededByEventId ? <s>{eventLabel(row.summary)}</s> : eventLabel(row.summary)}</td>
            </>
          }
        >
          <FactGrid
            items={[
              { label: "What it says", value: row.summary, wide: true },
              { label: "Effective", value: row.effectiveAt },
              { label: "Recorded", value: <When instant={row.recordedAt} now={now} mode="utc" /> },
              ...(row.supersededByEventId
                ? [
                    {
                      label: "Superseded",
                      value:
                        audience === "customer"
                          ? "Put right by a later correction: this line no longer counts."
                          : `by the ${row.supersededByEventType} recorded later (${row.supersededByEventId.slice(0, 8)})`,
                      wide: true,
                    },
                  ]
                : []),
            ]}
          />
        </ExpandRow>
      ))}
    </DataTable>
  );
}

// The head of an event's sentence, for the cell; the sentence itself is in the row's expansion.
// The system brief bans a sentence in a table cell, and these ran to twenty-two words over two
// lines (round 1, HIGH). Three cuts, in this order:
//   1. everything up to the first colon goes, because it names the event and the chip beside the
//      cell already says the same thing ("Endorsement quoted: Annual premium ..." keeps the
//      premium);
//   2. what is left is cut at its first semicolon, which is where the list of further figures
//      starts ("Annual premium $1,200.00 to $2,400.00; per-occurrence limit ...");
//   3. a trailing parenthesis is kept only when it is shorter than what it qualifies. Two things
//      arrive in one: a figure ("($1,127.24)"), which belongs in the cell, and the free text an
//      operator typed as the reason for a correction, which can run to 300 characters and does
//      not.
// NEVER A COMMA. A formatted amount carries one ("$1,200.00"), and cutting there printed "$1"
// under a heading that promised the figure (measured on this policy on 2026-09-09).
// A sentence with no colon and no semicolon is already short ("Policy bound at $1,200.00 of
// annual premium") and is printed whole. Presentation only: the sentence in the expansion is the
// one the server built, whole.
function eventLabel(summary: string): string {
  const afterTheEventName = summary.includes(":") ? summary.slice(summary.indexOf(":") + 1) : summary;
  const firstClause = afterTheEventName.split(";")[0].trim();
  const parenthesis = firstClause.indexOf(" (");
  if (parenthesis === -1) return firstClause;
  const whatItQualifies = firstClause.slice(0, parenthesis);
  const inTheParenthesis = firstClause.slice(parenthesis);
  return inTheParenthesis.length < whatItQualifies.length ? firstClause : whatItQualifies;
}

// ---------------------------------------------------------------------------
// The dates a policy changed, and the policy as it stood on one of them
// ---------------------------------------------------------------------------

// Slice B12-3 (YOA-626), decided by Yoann: the dates this policy changed, as links that carry
// ?asOf in the address. Server-rendered on every click, no slider and no state in the browser:
// the page IS the answer for that date, and it can be bookmarked and shown to somebody else.
export async function PolicyChangeSteps({
  policyId,
  termStart,
  today,
  hrefForDate,
  currentDate,
}: {
  policyId: string;
  termStart: string;
  today: string;
  // Where a step goes. The screen owns its address, so it builds the link and this only draws it.
  hrefForDate: (date: string) => string;
  currentDate?: string;
}) {
  const steps = await policyAsOfSteps(policyId, termStart, today);
  return (
    <nav className="as-of-steps pd-steps" aria-label="Dates this policy changed">
      {steps.map((step) => {
        const isCurrent = step.date === currentDate;
        return (
          <Link
            key={step.date}
            href={hrefForDate(step.date)}
            className={isCurrent ? "as-of-step current" : "as-of-step"}
            aria-current={isCurrent ? "date" : undefined}
          >
            <span className="as-of-step-date">{step.date}</span>
            <span className="as-of-step-label">{step.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export async function PolicyAsOf({
  policyId,
  asOf,
  termStart,
  today,
}: {
  policyId: string;
  asOf: string | undefined;
  termStart: string;
  today: string;
}) {
  const requested = asOf ?? "";
  const result = requested ? await policyAsItStoodOn(policyId, requested) : null;
  // The field cannot start on a date it would refuse: on a policy whose term has not begun,
  // today is before the minimum the input accepts, so the term start is the honest default.
  const defaultDate = requested || (today > termStart ? today : termStart);

  return (
    <div id="as-of">
      {/* One line, at the top of the view: a date and a button (cycle 2, decision 16). It was a
          card with a heading, a stacked label, a full-width field and a full-width black button
          for a question that is one field wide. Same GET, same field name, same hidden view, so
          the answer still comes back on this view and is still a bookmarkable address. */}
      <form method="get" className="pd-asof">
        <label htmlFor="asOf">As it stood on</label>
        <input id="asOf" name="asOf" type="date" required defaultValue={defaultDate} min={termStart} />
        <input type="hidden" name="view" value="timeline" />
        <button type="submit" className="secondary">
          Show
        </button>
      </form>

      {result === null ? null : "error" in result ? (
        <div className="notices">
          <p className="error">
            Nothing to show on {result.asOf}: {result.error}
          </p>
        </div>
      ) : (
        <section className="card">
          <h2>The policy on {result.asOf}</h2>
          <FactGrid
            items={[
              {
                label: "Status",
                value:
                  result.snapshot.status === "cancelled"
                    ? `cancelled, effective ${result.snapshot.cancelledEffectiveAt}`
                    : "in force",
              },
              { label: "Annual premium", value: formatCentsAsUsd(result.snapshot.annualPremiumCents) },
              {
                label: `${result.snapshot.stateName} tax (${(result.snapshot.taxRateBasisPoints / 100).toFixed(2)}%)`,
                value: formatCentsAsUsd(result.snapshot.taxCents),
              },
              { label: "Policy fee", value: formatCentsAsUsd(result.snapshot.feeCents) },
              { label: "Full annual term", value: formatCentsAsUsd(result.snapshot.totalChargeCents) },
              ...result.snapshot.coverageLines.map((line) => ({
                label: line.name,
                value: formatCentsAsUsd(line.limitCents),
              })),
            ]}
          />

          <DataTable ariaLabel="Written premium segments">
            <thead>
              <tr>
                <th className="nowrap">From</th>
                <th className="nowrap">Recorded</th>
                <th>What</th>
                <th className="num">Written premium</th>
              </tr>
            </thead>
            <tbody>
              <tr className="dt-row">
                <td className="nowrap">{result.snapshot.termStart}</td>
                <td className="nowrap dt-muted">at issuance</td>
                <td>Annual premium written at issuance</td>
                <td className="num">{formatCentsAsUsd(result.snapshot.annualPremiumCentsAtIssuance)}</td>
              </tr>
              {result.snapshot.endorsements.map((endorsement) => (
                <tr className="dt-row" key={`${endorsement.effectiveAt}-${endorsement.recordedAt}`}>
                  <td className="nowrap">{endorsement.effectiveAt}</td>
                  <td className="nowrap">{endorsement.recordedAt.replace("T", " ").slice(0, 19)}</td>
                  <td>{endorsement.description}</td>
                  <td className="num">{formatCentsAsUsd(endorsement.premiumDeltaCents)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>

          <p className="pd-note">
            The same date as a PDF:{" "}
            <Link
              href={`/api/policies/${policyId}/documents/declarations?asOf=${result.asOf}`}
              target="_blank"
              rel="noopener"
            >
              declarations
            </Link>
            {" / "}
            <Link
              href={`/api/policies/${policyId}/documents/endorsement-schedule?asOf=${result.asOf}`}
              target="_blank"
              rel="noopener"
            >
              schedule
            </Link>
            .
          </p>
        </section>
      )}
    </div>
  );
}
