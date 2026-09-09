import { ChevronRight, Info } from "lucide-react";

// Three ways of putting something one click away instead of on the page: the explanation of a
// screen, the actions of one row, and the sandbox identifiers of a money movement.
//
// All three are a native <details>. There is no client component, no state library and no
// JavaScript of ours: the browser opens and closes them, they work with the keyboard, and their
// content is in the HTML whether they are open or not. That last point matters for the trial
// evidence: a Stripe id behind a closed disclosure is still in the page for a reviewer, and for
// a text search, it is simply not in the reading flow.

// A titled panel that opens on demand. Two uses: the long explanation of a screen, whose default
// title is "How to read this" (the first sentence stays on the page as the lead, everything that
// explains how to read the figures goes in here), and a form that would otherwise sit between the
// reader and the facts, such as "run a reconciliation now".
export function Disclosure({
  title = "How to read this",
  open = false,
  children,
}: {
  title?: string;
  // Open on arrival. Yoann's rule of 2026-09-08 (F-YA-05): a primary action such as "endorse this
  // policy" is never hidden behind a closed fold; only secondary reading matter starts closed.
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="disclosure" open={open || undefined}>
      <summary>
        <ChevronRight size={15} aria-hidden="true" className="disclosure-chevron" />
        {title}
      </summary>
      <div>{children}</div>
    </details>
  );
}

// The actions of one table row, folded into its last cell: the table shows facts, and the forms
// appear when somebody asks for them. Every form inside keeps its own action, method and fields,
// and the server checks the same rules again whatever the page displayed.
export function RowActions({
  label = "Actions",
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <details className="row-actions">
      <summary>
        <ChevronRight size={14} aria-hidden="true" className="disclosure-chevron" />
        {label}
      </summary>
      <div>{children}</div>
    </details>
  );
}

// The provider and operation identifiers of one thing: Stripe ids (pi_, cs_, re_), our own
// operation uuids, and content hashes. They are evidence, not reading matter, so they sit behind
// a small "i" next to the human label instead of in the sentence.
// A reference with no value yet is shown as such rather than hidden: "not created yet" is a fact
// about the money.
export function SandboxReferences({
  references,
  inline = false,
}: {
  references: { label: string; value: string | null }[];
  // Inside a table cell the panel is a fold that opens IN the cell and wraps its identifiers,
  // instead of a 220 px box that widens the table and is then cut off by the horizontal scroll
  // container the table lives in (UI-021: the open panel ran 151 px past the visible right edge).
  // The style is in app/styles/policy-detail.css, next to the schedule that asks for it.
  inline?: boolean;
}) {
  return (
    <details className={inline ? "sandbox-reference inline-fold" : "sandbox-reference"}>
      <summary aria-label="Sandbox references">
        <Info size={13} aria-hidden="true" />
      </summary>
      <div>
        <p className="sandbox-reference-title">Sandbox references</p>
        <dl>
          {references.map((reference) => (
            <div key={reference.label}>
              <dt>{reference.label}</dt>
              <dd>{reference.value ?? "none yet"}</dd>
            </div>
          ))}
        </dl>
      </div>
    </details>
  );
}
