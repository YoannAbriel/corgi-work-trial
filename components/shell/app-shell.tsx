import Link from "next/link";
import type { ReactNode } from "react";
import { Shapes, UserRound } from "lucide-react";
import type { SignedInUser } from "@/lib/auth/current-user";
import type { ToastNotice } from "@/lib/ui/views";
import { workspaceTasks, type WorkspaceTask } from "@/lib/inbox/tasks";
import { Toaster } from "@/components/ui/toast";
import { PortalFrame, type BreadcrumbItem } from "@/components/portal-frame";
import { PageBand, type Band } from "./page-band";
import { SectionNav, type NavView } from "./section-nav";
import { SECTIONS, type SectionId } from "./sections";

// The workspace shell, in two levels.
//
// Level one is the main sidebar: the sections the signed-in role can open, each with the count
// of what is waiting behind it. Level two appears when a screen declares its `views`: the main
// sidebar folds to an icon rail and a section navigation lists those views beside it. Above the
// content sits the page band, which is sticky and never moves.
//
// Pages keep their own server-side identity and ownership checks; this component only draws
// what it is given. It is async because it reads the counts of what is waiting for the person
// (lib/inbox/tasks.ts) when the page has not already done so.
export type { Band } from "./page-band";
export type { NavView } from "./section-nav";
export type { SectionId } from "./sections";

export async function PortalShell({
  children,
  user,
  active = "home",
  trail,
  tasks,
  band,
  views,
  viewsSubtitle,
  inspector,
  toasts,
}: {
  children: ReactNode;
  user?: Pick<SignedInUser, "displayName" | "role" | "brokerId" | "customerId">;
  active?: SectionId;
  trail?: BreadcrumbItem[];
  tasks?: WorkspaceTask[];
  // The sticky band. A screen without one is a legacy screen still drawing its own heading.
  band?: Band;
  // The views of the section; their presence folds the main sidebar to a rail.
  views?: NavView[];
  viewsSubtitle?: string;
  // The inspector panel, rendered beside the content when a record is open.
  inspector?: ReactNode;
  // Notices to show as toasts, read from the redirect query by the page (lib/ui/views.ts).
  toasts?: ToastNotice[];
}) {
  const waitingTasks = tasks ?? (user ? await workspaceTasks(user) : []);
  const waitingCountOf = (section: SectionId) =>
    waitingTasks.filter((task) => task.section === section).reduce((total, task) => total + task.count, 0);
  const totalWaiting = waitingTasks.reduce((total, task) => total + task.count, 0);
  const isStaff = user?.role === "staff_ops" || user?.role === "staff_approver";

  type Entry = { href: string; section: SectionId; group?: string };
  const entries: Entry[] = isStaff
    ? [
        { href: "/ops", section: "home", group: "Work" },
        { href: "/inbox", section: "inbox", group: "Work" },
        { href: "/ops/console", section: "console", group: "Work" },
        { href: "/ops/policies", section: "policies", group: "Records" },
        { href: "/ops/brokers", section: "verification", group: "Records" },
        { href: "/ops/claims", section: "claims", group: "Records" },
        { href: "/ops/approvals", section: "approvals", group: "Money" },
        { href: "/ops/reconciliation", section: "reconciliation", group: "Money" },
        { href: "/ops/statements", section: "statements", group: "Money" },
        // Only staff operations reach the key screen (review finding F-INT-01: an approver who
        // could mint the maker's key would be both halves of the maker-checker gate).
        ...(user?.role === "staff_ops" ? [{ href: "/ops/mcp-keys", section: "mcp-keys" as SectionId, group: "System" }] : []),
      ]
    : user?.role === "broker"
      ? [
          { href: "/inbox", section: "inbox" },
          { href: "/broker", section: "policies" },
          { href: "/broker/statements", section: "statements" },
          { href: "/broker/kyb", section: "verification" },
        ]
      : user?.role === "customer"
        ? [
            { href: "/inbox", section: "inbox" },
            { href: "/customer", section: "policies" },
          ]
        : [
            { href: "/", section: "home" },
            { href: "/login", section: "login" },
          ];

  // The console's sibling screens live under the console entry.
  const activeEntry: SectionId = active === "search" || active === "infra" || active === "ledger" ? "console" : active;
  const sectionLabel = SECTIONS[active].label;
  const root =
    user?.role === "broker" || user?.role === "customer"
      ? { label: "Policies", href: user.role === "broker" ? "/broker" : "/customer" }
      : { label: "Overview", href: isStaff ? "/ops" : "/" };
  const isRoot = active === "home" || ((user?.role === "broker" || user?.role === "customer") && active === "policies");
  const breadcrumbs = trail ? [root, ...trail] : isRoot ? [{ label: root.label }] : [root, { label: sectionLabel }];
  const roleLabel =
    user?.role === "staff_approver"
      ? "Staff approver"
      : user?.role === "staff_ops"
        ? "Staff operations"
        : user?.role === "broker"
          ? "Broker"
          : "Customer";
  const brokerLabel = user?.role === "broker" ? "Broker workspace" : user?.role === "customer" ? "Customer workspace" : "Operations";

  let lastGroup: string | undefined;
  const sidebar = (
    <>
      <Link className="brand" href={isStaff ? "/ops" : user?.role === "broker" ? "/broker" : user?.role === "customer" ? "/customer" : "/"} prefetch={false}>
        <span className="workspace-icon">
          <Shapes size={20} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <span>
          <strong>Corgi</strong>
          <span className="brand-product">Policy administration</span>
        </span>
      </Link>
      <nav aria-label="Main navigation" className="sidebar-nav">
        {entries.map((entry) => {
          const definition = SECTIONS[entry.section];
          const Icon = definition.icon;
          const waiting = entry.section === "inbox" ? totalWaiting : waitingCountOf(entry.section);
          const heading =
            entry.group && entry.group !== lastGroup ? (
              <div className="navigation-label" key={`label-${entry.group}`}>
                {entry.group}
              </div>
            ) : !entry.group && lastGroup === undefined && entries[0] === entry ? (
              <div className="navigation-label" key="label-single">
                {brokerLabel}
              </div>
            ) : null;
          lastGroup = entry.group;
          const label = entry.section === "verification" && isStaff ? "Brokers" : entry.section === "verification" ? "Business verification" : definition.label;
          return (
            <div key={entry.href} style={{ display: "contents" }}>
              {heading}
              <div className="sidebar-nav-row">
                <Link href={entry.href} prefetch={false} aria-current={activeEntry === entry.section ? "page" : undefined} title={label}>
                  <Icon size={16} strokeWidth={1.7} aria-hidden="true" />
                  <span>{label}</span>
                </Link>
                {waiting > 0 ? (
                  // The number is a link of its own, to the inbox section listing exactly those
                  // items: a count that cannot be opened is the complaint the inbox answers.
                  <Link className="nav-badge" href={entry.section === "inbox" ? "/inbox" : `/inbox#${entry.section}`} prefetch={false}>
                    {waiting}
                    <span className="visually-hidden"> waiting for you, open the inbox</span>
                  </Link>
                ) : null}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="sidebar-account">
        <div className="account-identity">
          <span className="account-avatar" title={user ? `${user.displayName}, ${roleLabel}` : "Corgi workspace"}>
            <UserRound size={19} aria-hidden="true" />
          </span>
          <span>
            <strong>{user?.displayName ?? "Corgi workspace"}</strong>
            <span>{user ? roleLabel : "Policy administration"}</span>
          </span>
        </div>
        {user ? (
          <form method="post" action="/api/session/logout">
            <button type="submit" className="quiet-button">
              Sign out
            </button>
          </form>
        ) : null}
      </div>
    </>
  );

  const contextNav = views && views.length > 0 ? <SectionNav section={active} views={views} subtitle={viewsSubtitle} /> : null;

  return (
    <PortalFrame sidebar={sidebar} contextNav={contextNav} breadcrumbs={breadcrumbs} band={band ? <PageBand section={active} band={band} /> : null}>
      <main id="main-content" tabIndex={-1} className="reveal">
        {inspector ? (
          <div className="with-inspector">
            <div className="stack">{children}</div>
            {inspector}
          </div>
        ) : (
          children
        )}
      </main>
      {toasts && toasts.length > 0 ? <Toaster notices={toasts} /> : null}
    </PortalFrame>
  );
}
