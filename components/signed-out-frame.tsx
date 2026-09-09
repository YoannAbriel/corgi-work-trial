import type { ReactNode } from "react";
import { Shapes, ShieldCheck } from "lucide-react";

// The frame of a page nobody is signed in to. It is deliberately NOT the workspace shell: a
// visitor who has not signed in has no policies, no claims and no approvals, so a sidebar of
// destinations they cannot open is an invitation to click on locked doors (F-UI reviewer item,
// /login rendered inside the workspace shell while anonymous).
//
// What it keeps from the shell: the brand, the sandbox disclosure, the skip link and the footer.
// There is no navigation and no client component at all.
export function SignedOutFrame({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="signed-out">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="signed-out-header">
        <div className="brand">
          <span className="workspace-icon">
            <Shapes size={20} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <span>
            <strong>Corgi</strong>
            <span className="brand-product">Policy administration</span>
          </span>
        </div>
        <div className="signed-out-actions">
          <details className="environment-badge">
            <summary>
              <ShieldCheck size={13} aria-hidden="true" /> Sandbox
            </summary>
            <p className="environment-detail">Sandbox providers and test data. No real money.</p>
          </details>
          {/* The landing page's one button. A page without an action leaves this empty, and the
              header keeps the layout it always had. */}
          {actions}
        </div>
      </header>
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <footer className="portal-footer">Corgi · Policy administration</footer>
    </div>
  );
}
