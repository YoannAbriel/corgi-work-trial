import Link from "next/link";
import { X } from "lucide-react";
import { Chip } from "@/components/detail-layout";
import { Masked } from "@/components/console-parts";
import { When } from "@/components/ui/time";
import { sql } from "@/db/client";
import type { SignedInUser } from "@/lib/auth/current-user";
import { recogniseReference, resolveReference } from "@/lib/console/read";
import { attempt } from "@/lib/console/safe-read";
import { formatCentsAsUsd } from "@/lib/money/cents";

// The inspector: one reference and everything that ever named it, beside the table it was
// clicked in. A Stripe id, a policy number, a claim number, an operation uuid or a correlation
// id is resolved by the same reader as the console's search screen (lib/console/read.ts,
// resolveReference), so the two can never disagree; this panel only lays the answer out.
//
// Read only, staff only: the pages that offer it are staff screens, and it refuses to draw for
// any other role even when handed a reference. It never writes and holds no state; closing it
// is a link to the same page without the `inspect` parameter.
export async function Inspector({ reference, closeHref, user, now }: { reference: string; closeHref: string; user: Pick<SignedInUser, "role">; now: Date }) {
  if (user.role !== "staff_ops" && user.role !== "staff_approver") return null;

  const found = await attempt("the inspector's search", resolveReference(sql, reference));
  const shape = recogniseReference(reference);

  return (
    <aside className="inspector" aria-label={`Inspector: ${reference}`}>
      <div className="inspector-head">
        <div>
          <div className="inspector-kind">{shape}</div>
          <h2>
            <code className="ref">{reference}</code>
          </h2>
        </div>
        <Link href={closeHref} prefetch={false} className="inspector-close" aria-label="Close the inspector" scroll={false}>
          <X size={16} aria-hidden="true" />
        </Link>
      </div>
      <div className="inspector-body">
        {!found.ok ? (
          <p className="error" role="alert">
            {found.failure}
          </p>
        ) : found.value.matches.length === 0 ? (
          <p className="dt-muted">Nothing in this database matches that reference. The shape was read as {shape}.</p>
        ) : (
          found.value.matches.map((match, index) => (
            <section key={`${match.what}-${index}`}>
              <h3>{match.what}</h3>
              <p style={{ margin: "0 0 8px", fontWeight: 500 }}>{match.label}</p>
              {match.facts.length > 0 ? (
                <dl className="inspector-facts">
                  {match.facts.map((fact) => (
                    <div key={fact.label}>
                      <dt>{fact.label}</dt>
                      <dd>{fact.sensitive ? <Masked value={fact.value} what={fact.label} /> : fact.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
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
        )}

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
      </div>
    </aside>
  );
}
