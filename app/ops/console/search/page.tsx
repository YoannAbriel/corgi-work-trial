import "@/app/styles/console.css";
import Link from "next/link";
import { PortalShell } from "@/components/portal-shell";
import { Chip } from "@/components/detail-layout";
import { EventTable, FailureLine, RailsAbout, railLabel, utc } from "@/components/console-parts";
import { About } from "@/components/ui/about";
import { EmptyState } from "@/components/ui/empty";
import { Inspector, factValue } from "@/components/ui/inspector";
import { FactGrid } from "@/components/ui/table";
import { Toolbar, ToolbarCount, ToolbarGroup, ToolbarSpacer } from "@/components/ui/toolbar";
import { sql } from "@/db/client";
import { requireStaff } from "@/lib/console/guard";
import { recogniseReference, resolveReference } from "@/lib/console/read";
import { attempt, valueOr } from "@/lib/console/safe-read";
import { closeInspectorHref, firstValue, inspectHref, inspectedReference, type Query } from "@/lib/ui/views";

// /ops/console/search: type a reference, get the object and its trail.
//
// The one screen an operator opens when a customer, a broker or Stripe gives them a string and
// nothing else. Several shapes are recognised, and the page says which one it recognised BEFORE
// saying whether anything was found, so "nothing" is never ambiguous:
//
//   pi_ cs_ re_   a Stripe PaymentIntent, Checkout Session or Refund   -> the money operation
//   acct_         a Stripe connected account                           -> the broker
//   cmk_          the public prefix of an MCP API key                  -> the key and its calls
//   CGP-          a policy number                                      -> the policy
//   CLM-          a claim number                                       -> the claim
//   an email      a customer, or a sign-in account                     -> the customer
//   a uuid        any id this application ever put in a URL            -> whatever it is
//   anything else the correlation id of a request                      -> the requests it named
//
// A GET form, so the search is in the URL and can be pasted into a ticket. Read only. It is a
// sibling of the console rather than one of its views: the same section navigation lists both.

const PATH = "/ops/console/search";

export default async function ConsoleSearchPage({ searchParams }: { searchParams: Promise<Query> }) {
  const user = await requireStaff();
  const query = await searchParams;
  const reference = (firstValue(query.reference) ?? "").trim();
  const now = new Date();

  const found = reference === "" ? null : await attempt("the search", resolveReference(sql, reference));
  const result = found ? valueOr(found, null) : null;
  const matches = result?.matches ?? [];
  const trail = result?.trail ?? [];

  // Every reference of the trail opens the drawer on this same page, exactly as the feed does
  // (cycle 2, decision 5). `?inspect=` is added beside the `reference` parameter, so closing the
  // drawer leaves the search that was typed where it was.
  const inspected = inspectedReference(query.inspect);
  const refOf = (value: string) => inspectHref(PATH, query, value);

  // The fallback the console uses: a provider reference this database never resolved into an
  // operation would make the drawer answer "nothing matches", which reads as a broken link. It
  // is handed the trail row's own facts instead, and says so in one sentence.
  const inspectedEvent = inspected === null ? undefined : trail.find((event) => event.reference === inspected);
  const inspectorContext = inspectedEvent
    ? {
        title: inspectedEvent.title,
        sentence: "No operation of this database carries that reference, so what the console knows about it is the row you clicked.",
        facts: [
          { label: "What", value: inspectedEvent.title },
          { label: "When", value: `${utc(inspectedEvent.instant)} UTC` },
          { label: "Kind", value: inspectedEvent.kind.replace(/_/g, " ") },
          { label: "Rail", value: inspectedEvent.rail ? railLabel(inspectedEvent.rail) : "not a rail" },
          { label: "Reason", value: inspectedEvent.detail === "" ? "none" : inspectedEvent.detail },
        ],
      }
    : undefined;

  return (
    <PortalShell
      user={user}
      active="search"
      inspector={
        inspected ? (
          <Inspector reference={inspected} closeHref={closeInspectorHref(PATH, query)} user={user} now={now} context={inspectorContext} />
        ) : undefined
      }
      band={{
        title: "Search",
        suffix: reference === "" ? undefined : reference,
        // No chip (Yoann, 2026-09-09): when nothing matches, the empty state below says what the
        // reference was read as, and when something matches each card names what it found.
        actions: (
          <Link href="/ops/console" prefetch={false} className="button-link secondary">
            Back to the feed
          </Link>
        ),
      }}
    >
      <div className="console-toolbar">
        <Toolbar>
          <ToolbarGroup label="Reference">
            <form method="get" action={PATH}>
              <input
                id="reference"
                name="reference"
                type="text"
                defaultValue={reference}
                autoComplete="off"
                spellCheck={false}
                aria-label="Reference"
                placeholder="pi_3Nx... , CGP-01001, CLM-00007, cmk_1a2b3c4d, an email, a uuid"
              />
              <button type="submit" className="secondary">
                Find
              </button>
            </form>
          </ToolbarGroup>
          <ToolbarSpacer />
          <ToolbarCount>
            {matches.length === 1 ? "1 match" : `${matches.length} matches`}, {trail.length === 1 ? "1 event" : `${trail.length} events`}
          </ToolbarCount>
        </Toolbar>
      </div>

      {found ? <FailureLine attempted={found} /> : null}

      {reference === "" ? (
        <EmptyState illustration="magnifying-glass">Type a reference in the box above.</EmptyState>
      ) : found && !found.ok ? (
        // The failed read is answered BEFORE the empty answer, and that is review finding
        // F-B13-26: a search that could not be run used to print "nothing matches" underneath its
        // own red line, which reports a broken query as a fact about the data. This page's whole
        // discipline is that "nothing" is never ambiguous.
        <EmptyState illustration="broken-link">
          The search could not be run. The reference has not been looked for yet.
        </EmptyState>
      ) : matches.length === 0 ? (
        <EmptyState illustration="closed-folder">
          Nothing matches. It was read as {recogniseReference(reference)}.
        </EmptyState>
      ) : (
        <div className="cards console-matches">
          {matches.map((match, index) => (
            <section className="card" key={`${match.what}-${index}`}>
              <h2>
                {match.what}
                <Chip tone="neutral">{match.facts.length} facts</Chip>
              </h2>
              <p className="console-match-label">{match.label}</p>
              <FactGrid
                items={match.facts.map((fact) => ({
                  label: fact.label,
                  // "Created 2026-09-08T18:37:28.473Z" used to print raw here and as an age in the
                  // drawer over it. Same helper on both sides now (components/ui/inspector.tsx).
                  value: factValue(fact, now),
                }))}
              />
              {match.consoleHref || match.existingHref ? (
                <div className="inspector-links console-match-links">
                  {match.existingHref ? (
                    <Link href={match.existingHref} prefetch={false} className="button-link secondary">
                      Open
                    </Link>
                  ) : null}
                  {match.consoleHref ? (
                    <Link href={match.consoleHref} prefetch={false} className="button-link secondary">
                      Everything about it
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      )}

      {reference !== "" && (!found || found.ok) ? (
        <>
          <h2 className="console-heading">Its trail</h2>
          <EventTable
            events={trail}
            ariaLabel="Reference trail"
            now={now}
            inspectHref={refOf}
            openReference={inspected}
            emptyMessage="No event names this reference yet."
          />
        </>
      ) : null}

      <About>
        <RailsAbout />
        <h4>What each prefix means</h4>
        <p>
          <code>pi_</code> a Stripe PaymentIntent, the payment itself. <code>cs_</code> a Stripe Checkout Session, the
          hosted page. <code>re_</code> a Stripe Refund. <code>acct_</code> a Stripe connected account, which is a
          broker&apos;s verification. <code>cmk_</code> the public prefix of an MCP API key, never the key.{" "}
          <code>CGP-</code> a policy number. <code>CLM-</code> a claim number.
        </p>
        <h4>The other shapes</h4>
        <p>
          An email is a customer or a sign-in account. A uuid is any id this application ever put in a URL: policy,
          claim, customer, broker, money operation, journal entry or statement run. Anything else is read as a
          correlation id, which is the id on a JSON log line and on every console activity row.
        </p>
        <h4>Why the shape is named before the answer</h4>
        <p>
          &ldquo;Nothing found&rdquo; means two very different things: the shape was recognised and no row matched
          (wrong environment, or a typo in the digits), or the shape itself is not one this application ever produces.
          Saying which one it was is the difference between a dead end and a next step.
        </p>
        <h4>A read that failed is never an empty answer</h4>
        <p>
          When the search itself could not run, this page says so and stops. It does not print &ldquo;nothing
          matches&rdquo;, because that would report a broken query as a fact about the data.
        </p>
        <h4>What is never shown</h4>
        <p>
          No provider payload, no secret and no API key beyond its public <code>cmk_</code> prefix. Names and emails are
          masked to their first three characters and revealed by clicking them. All instants are UTC.
        </p>
      </About>
    </PortalShell>
  );
}
