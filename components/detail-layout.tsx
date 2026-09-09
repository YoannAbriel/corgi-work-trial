import type { ReactNode } from "react";
import { DecorativeIllustration, type IllustrationName } from "./decorative-illustration";

// The shape of every detail screen (policy, claim, statement run, broker), decided with Yoann on
// 2026-09-08 (YOA-633): an identity band with the primary actions as buttons, then two columns,
// the facts and the tables on the left, the summary and the secondary tools on the right.
// Explanations leave the reading flow and go under a "How to read this" fold.
//
// Server components only: plain HTML, no state, no JavaScript of ours. Every figure they display
// arrives already computed in integer cents; nothing here does arithmetic.

// The band at the top: what this is, where it stands, what you can do with it.
export function DetailHeading({
  title,
  lead,
  chips,
  actions,
}: {
  title: ReactNode;
  lead?: ReactNode;
  chips?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="detail-heading">
      <div className="detail-identity">
        <h1>{title}</h1>
        {lead ? <p className="lead">{lead}</p> : null}
        {chips ? <div className="chips">{chips}</div> : null}
      </div>
      {actions ? <div className="page-actions detail-actions">{actions}</div> : null}
    </header>
  );
}

// Two columns on a wide screen, one column under 1100 px (app/globals.css).
export function DetailGrid({ main, aside }: { main: ReactNode; aside: ReactNode }) {
  return (
    <div className="detail-grid">
      <div className="detail-main">{main}</div>
      <aside className="detail-aside">{aside}</aside>
    </div>
  );
}

// One titled block. The title is the section's only heading; the content is a table, a facts
// grid, a form or a short list, never a paragraph of explanation.
export function Panel({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel detail-panel${className ? ` ${className}` : ""}`}>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}

// A grid of labelled figures. `emphasis` marks a total.
export function Facts({
  items,
  compact = false,
}: {
  items: { label: ReactNode; value: ReactNode; emphasis?: boolean }[];
  compact?: boolean;
}) {
  return (
    <dl className={compact ? "facts compact" : "facts"}>
      {items.map((item, index) => (
        <div key={index} className={item.emphasis ? "fact fact-total" : "fact"}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// A vertical label and value list for the side column.
export function AsideList({ items }: { items: { label: ReactNode; value: ReactNode; nowrap?: boolean }[] }) {
  return (
    <dl className="aside-list">
      {items.map((item, index) => (
        <div key={index}>
          <dt>{item.label}</dt>
          <dd className={item.nowrap ? "aside-value-nowrap" : undefined}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// A small status word with a colour that says whether it is fine, needs attention, or is neutral.
export function Chip({ tone = "neutral", children }: { tone?: "ok" | "warn" | "neutral"; children: ReactNode }) {
  return <span className={`badge ${tone === "ok" ? "badge-ok" : tone === "warn" ? "badge-warn" : "badge-neutral"}`}>{children}</span>;
}

// The sentence a table or a list would otherwise have replaced.
export function Empty({ children, illustration }: { children: ReactNode; illustration?: IllustrationName }) {
  if (!illustration) {
    return <p className="panel-empty">{children}</p>;
  }
  return (
    <div className="panel-empty-state">
      <DecorativeIllustration name={illustration} variant="empty" />
      <p className="panel-empty">{children}</p>
    </div>
  );
}
