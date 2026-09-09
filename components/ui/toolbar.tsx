import Link from "next/link";
import type { ReactNode } from "react";

// The bar above a table: filters as chips that set a URL parameter, a text field (a GET form),
// the count of rows, and the one primary action of the table. Filters live in the URL, so a
// filtered screen can be pasted into a ticket, and the server does the filtering.
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>;
}

export function ToolbarGroup({ label, children }: { label?: ReactNode; children: ReactNode }) {
  return (
    <div className="toolbar-group">
      {label ? <span className="toolbar-label">{label}</span> : null}
      {children}
    </div>
  );
}

export function FilterChip({ href, active, count, children }: { href: string; active: boolean; count?: number; children: ReactNode }) {
  return (
    <Link href={href} prefetch={false} className="chip-link" aria-current={active ? "true" : undefined} scroll={false}>
      {children}
      {count !== undefined ? <span className="context-count">{count}</span> : null}
    </Link>
  );
}

export function ToolbarSpacer() {
  return <span className="toolbar-spacer" />;
}

export function ToolbarCount({ children }: { children: ReactNode }) {
  return <span className="toolbar-count">{children}</span>;
}
