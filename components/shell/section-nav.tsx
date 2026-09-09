import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { SECTIONS, type SectionId } from "./sections";

// One view of a section: a link to the same route with `?view=`, or to a sibling route. The
// page decides which one is current; this component only draws the list.
export type NavView = {
  key: string;
  label: string;
  href: string;
  current?: boolean;
  // A count is drawn only when the page gives one, and a page gives one only for something a
  // person must act on (cycle 2, decision 3: counts are not notifications).
  count?: number;
  icon?: LucideIcon;
};

// The views of the section the reader is in, drawn INSIDE the main sidebar, indented under that
// section's entry. A flat list, in the order the page gave them: Yoann's decision of 2026-09-09
// removed the <details> group folds that used to sit here, because a dropdown whose entries are
// themselves collapsible reads as two navigations stacked on one another. A section that needs
// more than one group of views is a section that should be split into two sidebar entries, which
// is what happened to the ledger.
//
// When the sidebar is folded to its icons this same list is the flyout that opens on hover of
// the active icon; that is entirely CSS (app/styles/system.css).
// `subtitle` is still accepted so the pages that pass one keep working; the sidebar names the
// section right above the list, so the shell no longer draws a second line under it.
export function SectionNav({ section, views }: { section: SectionId; views: NavView[]; subtitle?: string }) {
  return (
    <nav className="sidebar-views" aria-label={`${SECTIONS[section].label} views`}>
      {views.map((view) => (
        <ViewLink key={view.key} view={view} />
      ))}
    </nav>
  );
}

function ViewLink({ view }: { view: NavView }) {
  const ViewIcon = view.icon;
  return (
    <Link href={view.href} prefetch={false} aria-current={view.current ? "page" : undefined}>
      {ViewIcon ? <ViewIcon size={15} strokeWidth={1.7} aria-hidden="true" /> : null}
      <span>{view.label}</span>
      {view.count !== undefined && view.count > 0 ? <span className="context-count">{view.count}</span> : null}
    </Link>
  );
}
