import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ChevronRight, MoreHorizontal } from "lucide-react";

// The standard table and what goes around it. Six columns at most; what does not fit goes into
// an expandable row, the inspector or another view. Every cell prints a value the page already
// formatted. Server components: plain HTML, the browser handles the folds and the menus.

// The frame: toolbar above, the scrolling table, a legend or a footer below.
export function DataTable({
  ariaLabel,
  toolbar,
  legend,
  footer,
  children,
  className,
}: {
  ariaLabel: string;
  toolbar?: ReactNode;
  legend?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`dt-wrap${className ? ` ${className}` : ""}`}>
      {toolbar}
      <div className="dt-scroll" role="region" aria-label={ariaLabel} tabIndex={0}>
        <table className="dt">{children}</table>
      </div>
      {legend}
      {footer}
    </div>
  );
}

// A row. With `href`, the whole row opens that link (the link is stretched over the row from the
// primary cell); other links and forms in the row keep working above it.
export function Row({ href, selected, children, className, id }: { href?: string; selected?: boolean; children: ReactNode; className?: string; id?: string }) {
  return (
    <tr className={`dt-row${selected ? " is-selected" : ""}${className ? ` ${className}` : ""}`} id={id}>
      {children}
    </tr>
  );
}

// The primary cell of a row: the record's name, stretched over the row when it is a link.
export function Primary({ href, children, sub }: { href?: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <td className="dt-primary">
      {href ? (
        <Link href={href} prefetch={false} className="dt-link">
          {children}
        </Link>
      ) : (
        children
      )}
      {sub ? <span className="dt-sub">{sub}</span> : null}
    </td>
  );
}

// A number or money cell.
export function Num({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <td className="num">
      {children}
      {sub ? <span className="dt-sub">{sub}</span> : null}
    </td>
  );
}

// The chevron cell at the end of a row that opens somewhere.
export function Chevron() {
  return (
    <td className="dt-chevron" aria-hidden="true">
      <ChevronRight size={15} />
    </td>
  );
}

// A reference token (a Stripe id, a policy number, a uuid). With `inspectHref` it opens the
// inspector beside the table; `open` marks the one currently open.
export function Ref({ value, inspectHref, open, title }: { value: string; inspectHref?: string; open?: boolean; title?: string }) {
  if (!inspectHref) return <code className="ref" title={title}>{value}</code>;
  return (
    <Link href={inspectHref} prefetch={false} className={`ref${open ? " is-open" : ""}`} title={title ?? "Open the trail of this reference"} scroll={false}>
      {value}
    </Link>
  );
}

// A record that can unfold: its main row, then a full-width row with the rest of its facts.
// One <tbody> per record so the stylesheet can pair the two rows.
export function ExpandRow({ cells, columns, children, selected, id }: { cells: ReactNode; columns: number; children: ReactNode; selected?: boolean; id?: string }) {
  return (
    <tbody>
      <tr className={`dt-row${selected ? " is-selected" : ""}`} id={id}>
        <td className="dt-chevron">
          <details className="dt-expand">
            <summary aria-label="Show the details of this row">
              <ChevronRight size={15} aria-hidden="true" />
            </summary>
          </details>
        </td>
        {cells}
      </tr>
      <tr className="dt-expansion">
        <td colSpan={columns + 1}>{children}</td>
      </tr>
    </tbody>
  );
}

// The header cell of the chevron column of a table made of ExpandRows.
export function ExpandHead() {
  return <th className="dt-chevron" aria-label="Details" />;
}

// A grid of label and value pairs, for the expansion of a row or a card.
export function FactGrid({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="dt-facts">
      {items.map((item, index) => (
        <div key={index}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// The lines of a journal entry, as a list rather than a second table: account, debit, credit.
export function EntryLines({ lines }: { lines: { account: ReactNode; debit: ReactNode; credit: ReactNode; isCredit: boolean }[] }) {
  return (
    <ul className="dt-lines">
      {lines.map((line, index) => (
        <li key={index} className={line.isCredit ? "credit" : "debit"}>
          <span>{line.account}</span>
          <span>{line.debit}</span>
          <span>{line.credit}</span>
        </li>
      ))}
    </ul>
  );
}

// The "..." menu of a row: the secondary actions, opened in the browser's top layer so the
// table's scroll box can never clip it. `id` must be unique on the page. The primary action of
// a row stays a visible button; only what a reader looks for less often goes in here.
export function RowMenu({ id, label = "More actions", children }: { id: string; label?: string; children: ReactNode }) {
  const anchor = `--menu-${id}`;
  return (
    <>
      <button type="button" className="row-menu-button" popoverTarget={`menu-${id}`} aria-label={label} style={{ anchorName: anchor } as CSSProperties}>
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      <div id={`menu-${id}`} popover="auto" className="pop pop-right pop-menu" style={{ ["--anchor" as string]: anchor }}>
        {children}
      </div>
    </>
  );
}

// The footer line of a bounded table: how many are shown, a link to the rest.
export function MoreRows({ shown, total, href, label = "Show all" }: { shown: number; total: number; href: string; label?: string }) {
  if (total <= shown) return null;
  return (
    <div className="dt-more">
      <Link href={href} prefetch={false}>
        {label} ({total})
      </Link>
    </div>
  );
}
