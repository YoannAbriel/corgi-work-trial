"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, PanelLeft, ShieldCheck } from "lucide-react";

export type BreadcrumbItem = { label: string; href?: string };

// The only client state in the shell is whether the navigation is visible. Everything else
// arrives rendered from the server: the sidebar, the section navigation, the band, the page.
export function PortalFrame({
  sidebar,
  contextNav,
  breadcrumbs,
  band,
  children,
}: {
  sidebar: React.ReactNode;
  contextNav?: React.ReactNode;
  breadcrumbs: BreadcrumbItem[];
  band?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [navigationOpen, setNavigationOpen] = useState(true);

  return (
    <div className={`portal${navigationOpen ? "" : " navigation-collapsed"}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {/* With a section navigation beside it, the main sidebar folds to its icons. */}
      <aside id="portal-navigation" className={contextNav ? "sidebar is-rail" : "sidebar"} hidden={!navigationOpen}>
        {sidebar}
      </aside>
      {contextNav}
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
              <PanelLeft size={16} aria-hidden="true" />
            </button>
            <nav aria-label="Breadcrumb" className="breadcrumb">
              <ol>
                {breadcrumbs.map((item, index) => (
                  <li key={`${item.href ?? "current"}-${item.label}`}>
                    {index > 0 ? <ChevronRight size={13} aria-hidden="true" /> : null}
                    {index === breadcrumbs.length - 1 || !item.href ? (
                      <span aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}>{item.label}</span>
                    ) : (
                      <Link href={item.href} prefetch={false}>
                        {item.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
          </div>
          <details className="environment-badge">
            <summary>
              <ShieldCheck size={13} aria-hidden="true" /> Sandbox
            </summary>
            <p className="environment-detail">Sandbox providers and test data. No real money.</p>
          </details>
        </header>
        {band}
        {children}
        <footer className="portal-footer">Corgi · Policy administration</footer>
      </div>
    </div>
  );
}
