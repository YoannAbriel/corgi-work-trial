import Link from "next/link";
import {
  ClipboardCheck,
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

type Section =
  "home" | "policies" | "verification" | "claims" | "approvals" | "login";

// Pages retain their server-side identity and ownership checks. This component
// passes rendered UI and breadcrumb labels/links across the client boundary.
export function PortalShell({
  children,
  user,
  active = "home",
  trail,
}: {
  children: React.ReactNode;
  user?: Pick<SignedInUser, "displayName" | "role">;
  active?: Section;
  trail?: BreadcrumbItem[];
}) {
  const isStaff = user?.role === "staff_ops" || user?.role === "staff_approver";
  const links = isStaff
    ? [
        { href: "/ops", label: "Overview", section: "home", icon: Home },
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
      ]
    : user?.role === "broker"
      ? [
          {
            href: "/broker",
            label: "Policies",
            section: "policies",
            icon: FileText,
          },
          {
            href: "/broker/kyb",
            label: "Business verification",
            section: "verification",
            icon: ShieldCheck,
          },
        ]
      : [
          { href: "/", label: "Overview", section: "home", icon: Home },
          { href: "/login", label: "Sign in", section: "login", icon: LogIn },
        ];
  const sectionLabel =
    links.find((link) => link.section === active)?.label ?? "Policies";
  const root = user?.role === "broker"
    ? { label: "Policies", href: "/broker" }
    : { label: "Overview", href: isStaff ? "/ops" : "/" };
  const isRoot = active === "home" || (user?.role === "broker" && active === "policies");
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
        {links.map(({ href, label, section, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            prefetch={false}
            aria-current={active === section ? "page" : undefined}
          >
            <Icon size={16} strokeWidth={1.7} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
      <div className="sidebar-account">
        <div className="account-identity">
          <span className="account-avatar">
            <UserRound size={19} aria-hidden="true" />
          </span>
          <span>
            <strong>{user?.displayName ?? "Trial workspace"}</strong>
            <span>{user ? roleLabel : "Synthetic data only"}</span>
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
