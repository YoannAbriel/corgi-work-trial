import Link from "next/link";
import {
  ClipboardCheck,
  ReceiptText,
  Scale,
  FileText,
  Home,
  LogIn,
  Shapes,
  ShieldCheck,
  UserRound,
  WalletCards,
} from "lucide-react";
import type { SignedInUser } from "@/lib/auth/current-user";
import { PortalFrame } from "./portal-frame";
import type { BreadcrumbItem } from "./portal-frame";
import { workspaceTasks, type WorkspaceTask } from "./what-needs-you";

type Section =
  "home" | "policies" | "verification" | "claims" | "approvals" | "login" | "statements" | "reconciliation";

// Pages retain their server-side identity and ownership checks. This component
// passes rendered UI and breadcrumb labels/links across the client boundary.
//
// It is async because it also carries the counts of what is waiting for the signed-in person
// (components/what-needs-you.tsx), read here on the server so that every screen of the workspace
// shows the same numbers without each page having to ask. A page that already read those tasks
// for its own "what needs you" block passes them in, so nothing is read twice.
export async function PortalShell({
  children,
  user,
  active = "home",
  trail,
  tasks,
}: {
  children: React.ReactNode;
  user?: Pick<SignedInUser, "displayName" | "role" | "brokerId" | "customerId">;
  active?: Section;
  trail?: BreadcrumbItem[];
  tasks?: WorkspaceTask[];
}) {
  const waitingTasks = tasks ?? (user ? await workspaceTasks(user) : []);
  // The number next to a navigation entry: everything waiting behind that screen, added up.
  const waitingCountOf = (section: Section) =>
    waitingTasks
      .filter((task) => task.section === section)
      .reduce((total, task) => total + task.count, 0);
  const isStaff = user?.role === "staff_ops" || user?.role === "staff_approver";
  const links = isStaff
    ? [
        { href: "/ops", label: "Overview", section: "home", icon: Home },
        { href: "/ops/policies", label: "Policies", section: "policies", icon: FileText },
        {
          href: "/ops/brokers",
          label: "Brokers & verification",
          section: "verification",
          icon: ShieldCheck,
        },
        {
          href: "/ops/claims",
          label: "Claims",
          section: "claims",
          icon: WalletCards,
        },
        {
          href: "/ops/approvals",
          label: "Approvals",
          section: "approvals",
          icon: ClipboardCheck,
        },
        { href: "/ops/reconciliation", label: "Reconciliation", section: "reconciliation", icon: Scale },
        { href: "/ops/statements", label: "Statements", section: "statements", icon: ReceiptText },
      ]
    : user?.role === "broker"
      ? [
          {
            href: "/broker",
            label: "Policies",
            section: "policies",
            icon: FileText,
          },
          { href: "/broker/statements", label: "Statements", section: "statements", icon: ReceiptText },
          {
            href: "/broker/kyb",
            label: "Business verification",
            section: "verification",
            icon: ShieldCheck,
          },
        ]
      : user?.role === "customer"
        ? [{ href: "/customer", label: "Policies", section: "policies", icon: FileText }]
      : [
          { href: "/", label: "Overview", section: "home", icon: Home },
          { href: "/login", label: "Sign in", section: "login", icon: LogIn },
        ];
  const sectionLabel =
    links.find((link) => link.section === active)?.label ?? "Policies";
  const root = user?.role === "broker" || user?.role === "customer"
    ? { label: "Policies", href: user.role === "broker" ? "/broker" : "/customer" }
    : { label: "Overview", href: isStaff ? "/ops" : "/" };
  const isRoot = active === "home" || ((user?.role === "broker" || user?.role === "customer") && active === "policies");
  const breadcrumbs = trail
    ? [root, ...trail]
    : isRoot ? [{ label: root.label }] : [root, { label: sectionLabel }];
  const roleLabel =
    user?.role === "staff_approver"
      ? "Staff approver"
      : user?.role === "staff_ops"
        ? "Staff operations"
        : user?.role === "broker"
          ? "Broker"
          : "Customer";

  const sidebar = (
    <>
      <div className="brand">
        <span className="workspace-icon">
          <Shapes size={20} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <span>
          <strong>Corgi</strong>
          <span className="brand-product">Policy administration</span>
        </span>
      </div>
      <div className="navigation-label">
        {isStaff ? "Operations" : "Insurance"}
      </div>
      <nav aria-label="Main navigation" className="sidebar-nav">
        {links.map(({ href, label, section, icon: Icon }) => {
          const waiting = waitingCountOf(section as Section);
          return (
            <Link
              key={href}
              href={href}
              prefetch={false}
              aria-current={active === section ? "page" : undefined}
            >
              <Icon size={16} strokeWidth={1.7} aria-hidden="true" />
              <span>{label}</span>
              {waiting > 0 ? (
                // The number is announced in words as well, because "Approvals 3" read out as
                // "Approvals three" says nothing about what the three are.
                <span className="nav-badge">
                  {waiting}
                  <span className="visually-hidden"> waiting for you</span>
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="sidebar-account">
        <div className="account-identity">
          <span className="account-avatar">
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

  return (
    <PortalFrame sidebar={sidebar} breadcrumbs={breadcrumbs}>
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
    </PortalFrame>
  );
}
