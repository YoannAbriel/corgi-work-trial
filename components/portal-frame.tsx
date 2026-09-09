"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, PanelLeft, ShieldCheck } from "lucide-react";

export type BreadcrumbItem = { label: string; href?: string };

// The only client state in the shell is whether the sidebar is folded to its icons. Everything
// else arrives rendered from the server: the sidebar and the views inside it, the band, the page.
//
// Cycle 2, decision 17: there is ONE navigation column. The views of the section the reader is
// in are drawn inside the sidebar under that section's entry (components/shell/app-shell.tsx),
// so nothing moves sideways when a screen declares its views. Folded, the sidebar is the icon
// rail and the views of the current section open as a flyout on hover (app/styles/system.css).
export function PortalFrame({
  sidebar,
  contextNav,
  breadcrumbs,
  search,
  modes,
  band,
  children,
}: {
  sidebar: React.ReactNode;
  // Kept for callers that still hand a second navigation column; the shell no longer builds one.
  contextNav?: React.ReactNode;
  breadcrumbs: BreadcrumbItem[];
  // The staff search field: a GET form to the search screen (cycle 2, decision 18).
  search?: React.ReactNode;
  // The AF-02 mode line, right of the breadcrumb: which provider is a real sandbox and which is
  // a local simulator. The words are exact and the same on every screen (PortalShell owns them).
  modes?: React.ReactNode;
  band?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [railFolded, setRailFolded] = useState(false);

  return (
    <div className="portal">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside id="portal-navigation" className={railFolded ? "sidebar is-rail" : "sidebar"}>
        {sidebar}
      </aside>
      {contextNav}
      <div className="portal-body">
        <header className="topbar">
          <div className="page-navigation">
            <button
              type="button"
              className="sidebar-toggle"
              aria-label={railFolded ? "Expand navigation" : "Fold navigation"}
              title={railFolded ? "Expand navigation" : "Fold navigation"}
              aria-controls="portal-navigation"
              aria-expanded={!railFolded}
              onClick={() => setRailFolded(!railFolded)}
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
          {search}
          {modes ? <div className="topbar-modes">{modes}</div> : null}
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
