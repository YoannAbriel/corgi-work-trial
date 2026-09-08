"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, PanelLeft, ShieldCheck } from "lucide-react";

export type BreadcrumbItem = { label: string; href?: string };

// The only client state in the shell is whether navigation is visible.
// The server supplies rendered content, never a session or database client.
export function PortalFrame({
  sidebar,
  breadcrumbs,
  children,
}: {
  sidebar: React.ReactNode;
  breadcrumbs: BreadcrumbItem[];
  children: React.ReactNode;
}) {
  const [navigationOpen, setNavigationOpen] = useState(true);
  const parent = breadcrumbs[breadcrumbs.length - 2];

  return (
    <div className={`portal${navigationOpen ? "" : " navigation-collapsed"}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside
        id="portal-navigation"
        className="sidebar"
        hidden={!navigationOpen}
      >
        {sidebar}
      </aside>
      <div className="portal-body">
        <header className="topbar">
          <div className="page-navigation">
            <button
              type="button"
              className="sidebar-toggle"
              aria-label="Toggle navigation"
              aria-controls="portal-navigation"
              aria-expanded={navigationOpen}
              onClick={() => setNavigationOpen(!navigationOpen)}
            >
              <PanelLeft size={17} aria-hidden="true" />
            </button>
            {parent?.href ? (
              <Link
                href={parent.href}
                prefetch={false}
                className="back-link"
                aria-label={`Back to ${parent.label}`}
                title={`Back to ${parent.label}`}
              >
                <ArrowLeft size={17} aria-hidden="true" />
              </Link>
            ) : null}
            <nav aria-label="Breadcrumb" className="breadcrumb">
              <ol>
                {breadcrumbs.map((item, index) => (
                  <li key={`${item.href ?? "current"}-${item.label}`}>
                    {index > 0 ? <ChevronRight size={14} aria-hidden="true" /> : null}
                    {index === breadcrumbs.length - 1 || !item.href ? (
                      <span aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}>{item.label}</span>
                    ) : (
                      <Link href={item.href} prefetch={false}>{item.label}</Link>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
          </div>
          <span className="environment-badge">
            <ShieldCheck size={13} aria-hidden="true" /> Sandbox
          </span>
        </header>
        {children}
        <footer className="portal-footer">
          Sandbox providers and synthetic data only. No real money.
        </footer>
      </div>
    </div>
  );
}
