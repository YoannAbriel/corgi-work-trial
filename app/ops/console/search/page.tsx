import Link from "next/link";
import { PortalShell } from "@/components/portal-shell";
import { Disclosure } from "@/components/disclosures";
import { AsideList, Chip, DetailGrid, DetailHeading, Empty, Panel } from "@/components/detail-layout";
import { EventTable, FailureLine, Masked } from "@/components/console-parts";
import { sql } from "@/db/client";
import { requireStaff } from "@/lib/console/guard";
import { recogniseReference, resolveReference } from "@/lib/console/read";
import { attempt, valueOr } from "@/lib/console/safe-read";

// /ops/console/search: type a reference, get the object and its trail.
//
// The one screen an operator opens when a customer, a broker or Stripe gives them a string and
// nothing else. Six shapes are recognised, and the page says which one it recognised BEFORE
// saying whether anything was found, so "nothing" is never ambiguous:
//
//   pi_ cs_ re_   a Stripe PaymentIntent, Checkout Session or Refund   -> the money operation
//   acct_         a Stripe connected account                           -> the broker
//   cmk_          the public prefix of an MCP API key                  -> the key and its calls
//   CGP-          a policy number                                      -> the policy
//   CLM-          a claim number                                       -> the claim
//   an email      a customer, or a sign-in account                     -> the customer
//   a uuid        any id this application ever put in a URL            -> whatever it is
//
// A GET form, so the search is in the URL and can be pasted into a ticket. Read only.

export default async function ConsoleSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string }>;
}) {
  const user = await requireStaff();
  const query = await searchParams;
  const reference = (query.reference ?? "").trim();

  const found = reference === "" ? null : await attempt("the search", resolveReference(sql, reference));
  const result = found ? valueOr(found, null) : null;

  return (
    <PortalShell user={user} active="home" trail={[{ label: "Operations console", href: "/ops/console" }, { label: "Search" }]}>
      <DetailHeading
        title="Find a reference"
        lead="A Stripe id, a connected account, an MCP key prefix, a policy or claim number, an email, or any identifier of this application. All times UTC."
        chips={reference === "" ? null : <Chip tone="neutral">read as {recogniseReference(reference)}</Chip>}
        actions={
          <Link href="/ops/console" prefetch={false} className="button-link">
            Back to the feed
          </Link>
        }
      />

      <DetailGrid
        main={
          <>
            <Panel title="What it is">
              {found ? <FailureLine attempted={found} /> : null}
              {reference === "" ? (
                <Empty>Type a reference on the right.</Empty>
              ) : result && result.matches.length > 0 ? (
                <div className="table-scroll" role="region" aria-label="Search matches" tabIndex={0}>
                  <table>
                    <thead>
                      <tr>
                        <th>Kind</th>
                        <th>What</th>
                        <th>Facts</th>
                        <th>Open</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.matches.map((match, index) => (
                        <tr key={`${match.what}-${index}`}>
                          <td>{match.what}</td>
                          <td>{match.label}</td>
                          <td>
                            <dl className="aside-list">
                              {match.facts.map((fact) => (
                                <div key={fact.label}>
                                  <dt>{fact.label}</dt>
                                  <dd>{fact.sensitive ? <Masked value={fact.value} what={fact.label} /> : fact.value}</dd>
                                </div>
                              ))}
                            </dl>
                          </td>
                          <td>
                            {match.consoleHref ? (
                              <>
                                <Link href={match.consoleHref} prefetch={false}>
                                  everything about it
                                </Link>
                                <br />
                              </>
                            ) : null}
                            {match.existingHref ? (
                              <Link href={match.existingHref} prefetch={false}>
                                the ordinary screen
                              </Link>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>
                  Nothing in this database matches that reference. It was read as{" "}
                  <strong>{recogniseReference(reference)}</strong>, so the shape was
                  {recogniseReference(reference).startsWith("a shape") ? " not " : " "}
                  recognised: either the object belongs to another environment, or the reference is wrong.
                </Empty>
              )}
            </Panel>

            <Panel title="Its trail">
              {result && result.trail.length > 0 ? (
                <EventTable events={result.trail} ariaLabel="Reference trail" />
              ) : (
                <Empty>Nothing to show yet.</Empty>
              )}
            </Panel>
          </>
        }
        aside={
          <>
            <Panel title="Search">
              <form method="get" action="/ops/console/search" className="card">
                <label htmlFor="reference">Reference</label>
                <input
                  id="reference"
                  name="reference"
                  type="text"
                  defaultValue={reference}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="pi_3Nx... , CGP-01001, CLM-00007, cmk_1a2b3c4d, an email, a uuid"
                />
                <button type="submit" className="secondary">
                  Find it
                </button>
              </form>
            </Panel>

            <Panel title="What each prefix means">
              <AsideList
                items={[
                  { label: "pi_", value: "Stripe PaymentIntent: the payment itself" },
                  { label: "cs_", value: "Stripe Checkout Session: the hosted page" },
                  { label: "re_", value: "Stripe Refund" },
                  { label: "acct_", value: "Stripe connected account: a broker's verification" },
                  { label: "cmk_", value: "the public prefix of an MCP API key, never the key" },
                  { label: "CGP-", value: "a policy number" },
                  { label: "CLM-", value: "a claim number" },
                  { label: "an email", value: "a customer, or a sign-in account" },
                  { label: "a uuid", value: "policy, claim, customer, broker, money operation, journal entry, statement run" },
                ]}
              />
              <Disclosure title="Why the shape is named before the answer">
                <p>
                  &ldquo;Nothing found&rdquo; means two very different things: the shape was recognised and no row
                  matched (wrong environment, or a typo in the digits), or the shape itself is not one this application
                  ever produces. Saying which one it was is the difference between a dead end and a next step.
                </p>
              </Disclosure>
            </Panel>
          </>
        }
      />
    </PortalShell>
  );
}
