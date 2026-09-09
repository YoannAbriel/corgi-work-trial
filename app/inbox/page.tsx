import "@/app/styles/lists.css";
import { redirect } from "next/navigation";
import { Chip } from "@/components/detail-layout";
import { PortalShell } from "@/components/portal-shell";
import { EmptyState } from "@/components/ui/empty";
import { Chevron, DataTable, MoreRows, Num, Primary, Ref, Row } from "@/components/ui/table";
import { When } from "@/components/ui/time";
import { FilterChip, Toolbar, ToolbarGroup } from "@/components/ui/toolbar";
import { currentUser } from "@/lib/auth/current-user";
import { workspaceInbox, type InboxItem, type InboxSection } from "@/lib/inbox/read";
import type { InboxAnchor } from "@/lib/inbox/sections";
import type { WorkspaceSection, WorkspaceTask } from "@/lib/inbox/tasks";
import { formatCentsAsUsd } from "@/lib/money/cents";
import { firstValue, toastsFromQuery, withParams, type Query } from "@/lib/ui/views";

// The notification centre: one screen listing everything waiting for the signed-in person, each
// line with the link that does the work.
//
// It exists because a number is not an answer (ticket YOA-636). The sidebar said "3" and the
// "what needs you" block said "3 policies to pay", and both led to a list of every policy, where
// the three were still to be found. Here each waiting item is a row of its own, with its object,
// its amount, its age, and one link to the exact page that clears it.
//
// The role decides what is shown, and the role comes from the session: a broker sees their own
// broker's work, a customer their own, staff the operations queues. Nothing is read from the
// URL beyond the section filter and the notice a redirect left there, and this page never changes
// anything: every link leads to a screen that asks the identity question again for itself and
// enforces its own rules.
//
// GENERIC OVER THE SECTIONS. This file names no section and no anchor. It renders whatever
// lib/inbox/read.ts returns, in the order lib/inbox/sections.ts put them, so a section added
// there appears here with no change to this page.
//
// Server component: plain HTML, no JavaScript of ours, and every amount arrives in integer cents
// from lib/inbox/read.ts and is only formatted here.

const PATH = "/inbox";

// A long queue is bounded, and says so; `?all=1` prints it whole (cycle 2). The reconciliation
// board grows by one row per unmatched provider record, and this screen had no cap at all.
const ROWS_PER_SECTION = 50;

export default async function InboxPage({ searchParams }: { searchParams: Promise<Query> }) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }

  const [inbox, query] = await Promise.all([workspaceInbox(user), searchParams]);
  // One clock for the whole screen, so every age on it is measured from the same instant.
  const now = new Date();
  // A refused action elsewhere sends the person back here with its sentence (F-B13-08).
  const toasts = toastsFromQuery(query, { error: { tone: "error", title: "Refused" } });

  // THE SIDEBAR COUNTS THE ROWS THIS SCREEN LISTS, and so does the band chip (round 1, HIGH: the
  // band said 28 while the Inbox badge and the Reconciliation badge said 35, on one screen). The
  // shell normally reads lib/inbox/tasks.ts, a second reading of the same tables; here the
  // sections themselves are the count, so the two figures cannot tell different stories.
  const tasks = sidebarTasksFrom(inbox.sections);

  // The section filter, from the URL: `?section=<anchor>`. An unknown value shows everything
  // rather than an empty screen, exactly as a filter chip that was never clicked would.
  const requested = firstValue(query.section) ?? null;
  const filtered = inbox.sections.some((section) => section.anchor === requested) ? requested : null;
  const shownSections = filtered ? inbox.sections.filter((section) => section.anchor === filtered) : inbox.sections;
  const showEverything = firstValue(query.all) === "1";

  return (
    <PortalShell
      active="inbox"
      user={user}
      tasks={tasks}
      toasts={toasts}
      band={{
        title: "Inbox",
        suffix: user.displayName,
        // One chip: how much is waiting. The AF-02 words are on the top bar of every workspace
        // screen (cycle 2, decision 1), so a band repeating them said it twice within 100 px.
        meta: (
          <Chip tone={inbox.totalWaiting > 0 ? "warn" : "ok"}>
            {inbox.totalWaiting === 0 ? "nothing waiting" : `${inbox.totalWaiting} waiting`}
          </Chip>
        ),
      }}
    >
      {/* The inline sentence stays beside the toast: the review scripts read this block. */}
      {query.error ? (
        <div className="notices">
          <p className="error" role="alert">
            {query.error}
          </p>
        </div>
      ) : null}

      {inbox.unreadablePolicies.length > 0 ? (
        <div className="notices">
          <p className="error" role="alert">
            Nothing below counts{" "}
            {inbox.unreadablePolicies.length === 1 ? "this policy" : "these policies"}, because a
            figure they have stored was refused when it was read:{" "}
            {inbox.unreadablePolicies.map((policy) => `${policy.policyNumber} (${policy.reason})`).join("; ")}. Open
            the policy itself to see the whole story.
          </p>
        </div>
      ) : null}

      {inbox.sections.length === 0 ? (
        <div className="card lists-section">
          <h2>Nothing to do here</h2>
          <EmptyState illustration="in-tray">
            This account has no workspace of its own. Sign in as a broker, a customer or a member
            of staff to see what is waiting.
          </EmptyState>
        </div>
      ) : (
        <>
          {/* One filter chip per section, with its count, plus All (cycle 2, decision 13). The
              chip is a link, so a filtered inbox can be pasted into a ticket. */}
          <div className="lists-filters">
            <Toolbar>
              <ToolbarGroup>
                <FilterChip href={withParams(PATH, query, { section: null, all: null })} active={filtered === null} count={inbox.totalWaiting}>
                  All
                </FilterChip>
                {inbox.sections.map((section) => (
                  <FilterChip
                    key={section.anchor}
                    href={withParams(PATH, query, { section: section.anchor, all: null })}
                    active={filtered === section.anchor}
                    count={section.items.length}
                  >
                    {chipLabel(section.anchor)}
                  </FilterChip>
                ))}
              </ToolbarGroup>
            </Toolbar>
          </div>

          {/* Nothing waiting anywhere: one illustration and one sentence, once, above the folded
              sections (round 1, MEDIUM: the first section drew a card with a 300 px drawing and
              its siblings drew one-line rows, three shapes for the same fact). */}
          {inbox.totalWaiting === 0 ? (
            <div className="card lists-section">
              <EmptyState illustration="all-clear">Nothing is waiting for you.</EmptyState>
            </div>
          ) : null}

          {shownSections.map((section) => (
            <InboxSectionCard key={section.anchor} section={section} now={now} query={query} showEverything={showEverything} />
          ))}
        </>
      )}
    </PortalShell>
  );
}

// One section. The anchor is on the wrapper, so the count chip in the sidebar (/inbox#approvals)
// lands on the section that holds exactly the items it counted, and scripts/check-inbox-counts.ts
// checks that pairing.
//
// ONE SHAPE FOR EVERY SECTION (cycle 2, decision 13): a card with a bounded table when it holds
// work, one grey line when it does not. A section with no rows never draws its column headers:
// four headers over nothing, with the empty state pushed into a cell below them, is a table
// pretending to have content (round 1, MEDIUM).
function InboxSectionCard({
  section,
  now,
  query,
  showEverything,
}: {
  section: InboxSection;
  now: Date;
  query: Query;
  showEverything: boolean;
}) {
  if (section.items.length === 0) {
    return (
      <div className="lists-section lists-empty-line" id={section.anchor}>
        <h2>{section.title}</h2>
        <p>{section.emptySentence}</p>
      </div>
    );
  }

  // WHAT EVERY ROW OF THIS SECTION SAYS THE SAME WAY, said once, in the header (cycle 2,
  // decision 13). "Nobody has explained it yet." was printed in all 35 cells of the breaks
  // table, which is a sentence in a table cell carrying no information (round 1, MEDIUM).
  const shared = sentencesEveryRowRepeats(section.items);
  const ownWhat = (item: InboxItem) => whatIsOwnToThisRow(item, shared);
  // When every row said exactly the same thing, the header now says it and the column has
  // nothing left to hold: a column of empty cells is a column to remove, not to keep.
  const showWhat = section.items.some((item) => ownWhat(item) !== "");
  // A remainder of two or three words is a classification, and a classification is a chip.
  const whatReadsAsAStatus = section.items.every((item) => {
    const own = ownWhat(item);
    return own !== "" && own.split(" ").length <= 3;
  });
  const rows = showEverything ? section.items : section.items.slice(0, ROWS_PER_SECTION);

  return (
    <section className="card lists-section" id={section.anchor}>
      <h2>
        {section.title}
        <span className="count-chip">{section.items.length}</span>
      </h2>
      {shared === "" ? null : <p className="lists-note">{shared}</p>}
      <DataTable
        ariaLabel={section.title}
        footer={
          <MoreRows shown={rows.length} total={section.items.length} href={withParams(PATH, query, { all: "1" })} label="Show every row" />
        }
      >
        <thead>
          <tr>
            <th>Object</th>
            {showWhat ? <th>What is waiting</th> : null}
            <th className="num">Amount</th>
            <th className="nowrap">{section.sinceHeading}</th>
            <th aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {rows.map((item, index) => {
            // The object of a break is stored as "source|reference", which is an internal key and
            // not a name (round 1, MEDIUM): the reference is what an operator reads and types into
            // the provider's own dashboard, so it is the link, and the source is its sub-label.
            const key = splitCompositeKey(item.subject);
            const own = ownWhat(item);
            return (
              <Row key={`${section.anchor}-${index}`}>
                <Primary href={item.href} sub={key.source ?? undefined}>
                  {key.source ? <Ref value={key.reference} title={item.subject} /> : item.subject}
                </Primary>
                {showWhat ? <td>{own === "" ? null : whatReadsAsAStatus ? <Chip tone="neutral">{own}</Chip> : own}</td> : null}
                <Num>{item.amountCents === null ? "" : formatCentsAsUsd(item.amountCents)}</Num>
                <td className="nowrap">
                  <When instant={item.since} now={now} />
                </td>
                <Chevron />
              </Row>
            );
          })}
        </tbody>
      </DataTable>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Reading the sections into what the screen prints
// ---------------------------------------------------------------------------

// WHICH SIDEBAR ENTRY EACH INBOX SECTION IS COUNTED UNDER. The sidebar adds several queues into
// one number (a broker's four policy queues are one "Policies" badge); the inbox lists each on
// its own. The two names are declared apart in lib/inbox/sections.ts and lib/inbox/tasks.ts, and
// this map is the same pairing tasks.ts uses, written over the anchor union so a section added
// there is a type error here rather than a count that silently lands nowhere.
const SIDEBAR_ENTRY_OF_ANCHOR: Record<InboxAnchor, WorkspaceSection> = {
  policies: "policies",
  "endorsement-deltas": "policies",
  "correction-differences": "policies",
  "change-requests": "policies",
  "waiting-for-the-customer": "policies",
  corrections: "policies",
  endorsements: "policies",
  approvals: "approvals",
  claims: "claims",
  reconciliation: "reconciliation",
  statements: "statements",
};

// The sidebar's counts, built from the rows this screen lists rather than from a second reading
// of the same tables. `label` and `detail` are what the shell would show if it drew the list; it
// only adds the counts up, so the section's own title is the honest label.
function sidebarTasksFrom(sections: InboxSection[]): WorkspaceTask[] {
  return sections
    .filter((section) => section.items.length > 0)
    .map((section) => ({
      section: SIDEBAR_ENTRY_OF_ANCHOR[section.anchor],
      anchor: section.anchor,
      count: section.items.length,
      label: section.title,
      detail: section.emptySentence,
    }));
}

// The name of a section on its filter chip: its anchor, in words. A section's own title is a
// sentence of up to seven words, and six of those would be three rows of chips above the work.
function chipLabel(anchor: string): string {
  const words = anchor.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// An internal key of the shape "source|reference". Anything without a pipe is a name already: a
// policy number, a claim number, a broker's name.
function splitCompositeKey(subject: string): { source: string | null; reference: string } {
  const pipe = subject.indexOf("|");
  if (pipe < 0) return { source: null, reference: subject };
  return { source: subject.slice(0, pipe), reference: subject.slice(pipe + 1) };
}

// The sentences of `what` that EVERY row of the section repeats word for word. Those belong to
// the section, not to its rows. A section of one row repeats nothing.
function sentencesEveryRowRepeats(items: InboxItem[]): string {
  if (items.length < 2) return "";
  const first = sentencesOf(items[0].what);
  const shared = first.filter((sentence) => items.every((item) => sentencesOf(item.what).includes(sentence)));
  return shared.length === 0 ? "" : `${shared.join(". ")}.`;
}

// What is left of a row's sentence once the section has said the shared part, minus the source
// the object cell already prints ("stripe: provider only" beside a row whose sub-label is
// already "stripe").
function whatIsOwnToThisRow(item: InboxItem, shared: string): string {
  const sharedSentences = shared === "" ? [] : sentencesOf(shared);
  const own = sentencesOf(item.what).filter((sentence) => !sharedSentences.includes(sentence));
  const text = own.join(". ");
  const source = splitCompositeKey(item.subject).source;
  return source && text.startsWith(`${source}: `) ? text.slice(source.length + 2) : text;
}

// "a. b." into ["a", "b"]. Presentation only: lib/inbox/sections.ts writes these sentences and
// this page decides where each one is printed.
function sentencesOf(what: string): string[] {
  return what
    .split(". ")
    .map((sentence) => sentence.replace(/\.$/, "").trim())
    .filter((sentence) => sentence !== "");
}
