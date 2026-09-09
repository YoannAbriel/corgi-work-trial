import Link from "next/link";
import type { ReactNode } from "react";
import { Chip } from "@/components/detail-layout";
import { Masked } from "@/components/console-parts";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty";
import { When } from "@/components/ui/time";
import { sql } from "@/db/client";
import type { SignedInUser } from "@/lib/auth/current-user";
import { recogniseReference, resolveReference } from "@/lib/console/read";
import { attempt } from "@/lib/console/safe-read";
import { formatCentsAsUsd } from "@/lib/money/cents";

// The inspector: one reference and everything that ever named it, in a drawer over the table it
// was clicked in. A Stripe id, a policy number, a claim number, an operation uuid or a
// correlation id is resolved by the same reader as the console's search screen
// (lib/console/read.ts, resolveReference), so the two can never disagree; this panel only lays
// the answer out.
//
// Read only, staff only: the pages that offer it are staff screens, and it refuses to draw for
// any other role even when handed a reference. It never writes and holds no state; closing it
// is a link to the same page without the `inspect` parameter.

// What the row the reader clicked already knows about the reference. A payment that only ever
// existed at the provider has no operation in this database, and answering "nothing matches"
// was read as a broken link (round 1, HIGH): the page passes the row's own facts instead and
// the drawer says in one sentence why there is nothing more to show.
export type InspectorContext = { title: string; sentence: string; facts: { label: string; value: string }[] };

export async function Inspector({
  reference,
  closeHref,
  user,
  now,
  context,
}: {
  reference: string;
  closeHref: string;
  user: Pick<SignedInUser, "role">;
  now: Date;
  context?: InspectorContext;
}) {
  if (user.role !== "staff_ops" && user.role !== "staff_approver") return null;

  const found = await attempt("the inspector's search", resolveReference(sql, reference));
  const shape = recogniseReference(reference);
  const nothingFound = found.ok && found.value.matches.length === 0;

  return (
    <Drawer
      closeHref={closeHref}
      kind={shape}
      ariaLabel={`Inspector: ${reference}`}
      title={
        <code className="ref" title={reference}>
          {reference}
        </code>
      }
    >
      {!found.ok ? (
        <p className="error" role="alert">
          {found.failure}
        </p>
      ) : null}

      {/* The row's own facts come first when the search found nothing: what the reader can see
          on the screen behind the drawer is more useful than a sentence about a shape. */}
      {nothingFound && context ? (
        <section>
          <h3>{context.title}</h3>
          <p className="dt-muted" style={{ margin: "0 0 8px" }}>
            {context.sentence}
          </p>
          <FactList facts={context.facts} now={now} />
        </section>
      ) : null}

      {nothingFound && !context ? (
        <EmptyState illustration="search-corgi">Nothing in this database matches that reference.</EmptyState>
      ) : null}

      {found.ok
        ? found.value.matches.map((match, index) => (
            <section key={`${match.what}-${index}`}>
              <h3>{match.what}</h3>
              <p style={{ margin: "0 0 8px", fontWeight: 500 }}>{match.label}</p>
              {match.facts.length > 0 ? <FactList facts={match.facts} now={now} /> : null}
              {match.consoleHref || match.existingHref ? (
                <div className="inspector-links" style={{ marginTop: 10 }}>
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
          ))
        : null}

      {found.ok && found.value.trail.length > 0 ? (
        <section>
          <h3>Trail, newest first</h3>
          <ol className="trail">
            {found.value.trail.map((event, index) => (
              <li key={`${event.kind}-${event.instant.toISOString()}-${index}`} className={event.outcome}>
                <div>
                  <div className="trail-when">
                    <When instant={event.instant} now={now} mode="both" />
                  </div>
                  <div className="trail-title">
                    <b>{event.title}</b>
                    {event.amountCents !== null ? <span>{formatCentsAsUsd(event.amountCents)}</span> : null}
                    {event.rail ? <Chip tone="neutral">{event.rail}</Chip> : null}
                  </div>
                  {event.detail ? <div className="trail-detail">{event.detail}</div> : null}
                  <div className="dt-muted">
                    {event.kind.replace(/_/g, " ")} · {event.actorIsPerson ? <Masked value={event.actor} what="actor" /> : event.actor}
                    {event.href && event.href !== "" ? (
                      <>
                        {" · "}
                        <Link href={event.href} prefetch={false}>
                          {event.policyNumber ?? event.claimNumber ?? "open"}
                        </Link>
                      </>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : found.ok && found.value.matches.length > 0 ? (
        <p className="dt-muted">No event names this reference yet.</p>
      ) : null}
    </Drawer>
  );
}

function FactList({ facts, now }: { facts: { label: string; value: string; sensitive?: boolean }[]; now: Date }) {
  return (
    <dl className="inspector-facts">
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{factValue(fact, now)}</dd>
        </div>
      ))}
    </dl>
  );
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const BASIS_POINTS = /^(-?\d+) bps$/;

// One fact reads one way on one screen (round 1, MEDIUM): the drawer prints an instant as the
// age the table beside it prints, and a commission rate as the percentage the table prints. The
// stored value is unchanged; only its presentation is shared.
function factValue(fact: { label: string; value: string; sensitive?: boolean }, now: Date): ReactNode {
  if (fact.sensitive) return <Masked value={fact.value} what={fact.label} />;
  if (ISO_INSTANT.test(fact.value)) {
    const instant = new Date(fact.value);
    if (!Number.isNaN(instant.getTime())) return <When instant={instant} now={now} />;
  }
  const rate = BASIS_POINTS.exec(fact.value);
  if (rate) return `${(Number(rate[1]) / 100).toFixed(2)}%`;
  return fact.value;
}
