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
  count?: number;
  icon?: LucideIcon;
  // Views sharing a group name are drawn under a small heading.
  group?: string;
};

// The section navigation: the second level of the shell. It appears beside the icon rail when
// a screen declares its views, and names the section again at its top so that the rail's
// folded label is never missed.
export function SectionNav({ section, views, subtitle }: { section: SectionId; views: NavView[]; subtitle?: string }) {
  const definition = SECTIONS[section];
  const Icon = definition.icon;
  let lastGroup: string | undefined;
  return (
    <aside className="context-nav" aria-label={`${definition.label} views`}>
      <div className="context-head">
        <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
        <div>
          <strong>{definition.label}</strong>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
      </div>
      <nav>
        {views.map((view) => {
          const heading = view.group !== lastGroup && view.group ? <div className="context-group" key={`group-${view.group}`}>{view.group}</div> : null;
          lastGroup = view.group;
          const ViewIcon = view.icon;
          return (
            <div key={view.key} style={{ display: "contents" }}>
              {heading}
              <Link href={view.href} prefetch={false} aria-current={view.current ? "page" : undefined}>
                {ViewIcon ? <ViewIcon size={15} strokeWidth={1.7} aria-hidden="true" /> : null}
                <span>{view.label}</span>
                {view.count !== undefined && view.count > 0 ? <span className="context-count">{view.count}</span> : null}
              </Link>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
