"use client";

import { useState } from "react";
import { ChevronRight, PanelLeft, ShieldCheck } from "lucide-react";

// The only client state in the shell is whether navigation is visible.
// The server supplies rendered content, never a session or database client.
export function PortalFrame({
  sidebar,
  sectionLabel,
  children,
}: {
  sidebar: React.ReactNode;
  sectionLabel: string;
  children: React.ReactNode;
}) {
  const [navigationOpen, setNavigationOpen] = useState(true);

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
          <div className="breadcrumb">
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
            <span className="breadcrumb-parent">Insurance</span>
            <ChevronRight
              className="breadcrumb-parent"
              size={14}
              aria-hidden="true"
            />
            <span aria-current="page">{sectionLabel}</span>
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
