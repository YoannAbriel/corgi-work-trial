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
  // Views sharing a group name are drawn under a small heading that folds.
  group?: string;
};

// The views of the section the reader is in, drawn INSIDE the main sidebar, indented under that
// section's entry (cycle 2, decision 17: one navigation column, submenus that fold). Views that
// share a `group` sit in an open <details>, which is how the console's three groups (Console,
// Ledger, Tools) become three sub-groups under one entry with no script.
//
// When the sidebar is folded to its icons this same list is the flyout that opens on hover of
// the active icon; that is entirely CSS (app/styles/system.css).
// `subtitle` is still accepted so the pages that pass one keep working; the sidebar names the
// section right above the list, so the shell no longer draws a second line under it.
export function SectionNav({ section, views }: { section: SectionId; views: NavView[]; subtitle?: string }) {
  // The views in the order the page gave them, cut into runs of the same group name.
  const runs: { group?: string; views: NavView[] }[] = [];
  for (const view of views) {
    const last = runs[runs.length - 1];
    if (last && last.group === view.group) last.views.push(view);
    else runs.push({ group: view.group, views: [view] });
  }

  return (
    <nav className="sidebar-views" aria-label={`${SECTIONS[section].label} views`}>
      {runs.map((run, index) =>
        run.group ? (
          <details className="context-fold" open key={`group-${run.group}-${index}`}>
            <summary className="context-group">{run.group}</summary>
            {run.views.map((view) => (
              <ViewLink key={view.key} view={view} />
            ))}
          </details>
        ) : (
          run.views.map((view) => <ViewLink key={view.key} view={view} />)
        ),
      )}
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
