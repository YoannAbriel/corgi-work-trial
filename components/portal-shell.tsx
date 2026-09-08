import Link from "next/link";
import {
  ClipboardCheck,
  Dog,
  FileText,
  Home,
  LogIn,
  ShieldCheck,
  UserRound,
  WalletCards,
} from "lucide-react";
import type { SignedInUser } from "@/lib/auth/current-user";

type Section = "home" | "policies" | "verification" | "claims" | "approvals" | "login";

// Presentation only. Pages keep their existing server-side identity and ownership checks.
export function PortalShell({
  children,
  user,
  active = "home",
}: {
  children: React.ReactNode;
  user?: Pick<SignedInUser, "displayName" | "role">;
  active?: Section;
}) {
  const isStaff = user?.role === "staff_ops" || user?.role === "staff_approver";
  const links = isStaff
    ? [
        { href: "/ops", label: "Home", section: "home", icon: Home },
        { href: "/broker", label: "Policies", section: "policies", icon: FileText },
        {
          href: "/ops/brokers",
          label: "Brokers and verification",
          section: "verification",
          icon: ShieldCheck,
        },
        { href: "/ops/claims", label: "Claims", section: "claims", icon: WalletCards },
        { href: "/ops/approvals", label: "Approvals", section: "approvals", icon: ClipboardCheck },
      ]
    : user?.role === "broker"
      ? [
          { href: "/broker", label: "Policies", section: "policies", icon: FileText },
          { href: "/broker/kyb", label: "Business verification", section: "verification", icon: ShieldCheck },
        ]
      : [
          { href: "/", label: "Home", section: "home", icon: Home },
          { href: "/login", label: "Sign in", section: "login", icon: LogIn },
        ];

  return (
    <div className="portal">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="brand" aria-label="Corgi policy administration">
          <Dog size={30} strokeWidth={1.7} aria-hidden="true" />
          <span className="wordmark" translate="no">
            Corgi
          </span>
          <span className="brand-product">
            Policy <br />
            administration
          </span>
        </div>
        <nav aria-label="Main navigation" className="sidebar-nav">
          {links.map(({ href, label, section, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              prefetch={false}
              aria-current={active === section ? "page" : undefined}
            >
              <Icon size={19} strokeWidth={1.7} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <img
            src="/illustrations/corgi-landscape.webp"
            width="768"
            height="512"
            alt=""
            className="sidebar-art"
          />
          <p>
            Small details.
            <br />
            <strong>Thoughtfully covered.</strong>
          </p>
        </div>
      </aside>
      <div className="portal-body">
        <header className="topbar">
          <span className="environment-badge">
            <ShieldCheck size={15} aria-hidden="true" /> Sandbox workspace
          </span>
          {user ? (
            <div className="account">
              <UserRound size={19} aria-hidden="true" />
              <span>{user.displayName}</span>
              <form method="post" action="/api/session/logout">
                <button type="submit" className="quiet-button">
                  Sign out
                </button>
              </form>
            </div>
          ) : (
            <span className="topbar-label">Policy administration · Track 1</span>
          )}
        </header>
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
        <footer className="portal-footer">Sandbox providers and synthetic data only. No real money.</footer>
      </div>
    </div>
  );
}
