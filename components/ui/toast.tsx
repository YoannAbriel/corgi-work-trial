"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import type { ToastNotice } from "@/lib/ui/views";

// The notices after an action, as toasts (F-YA-09). The page reads them from the redirect
// query on the server (lib/ui/views.ts, toastsFromQuery) and passes them here; this component
// only shows them, lets them be closed, and removes their parameters from the URL so that a
// reload does not repeat them. The text is also in the page for a screen reader and for the
// review, in the hidden status region below.
//
// A success or an information notice leaves on its own after six seconds. An error stays until
// it is closed: a refusal is something the person has to read.
const LEAVES_AFTER_MS = 6000;

export function Toaster({ notices }: { notices: ToastNotice[] }) {
  const [closed, setClosed] = useState<number[]>([]);
  const [leaving, setLeaving] = useState<number[]>([]);

  useEffect(() => {
    // Strip the notice parameters from the address bar; the page itself is unchanged.
    const url = new URL(window.location.href);
    let changed = false;
    for (const notice of notices) {
      if (url.searchParams.has(notice.param)) {
        url.searchParams.delete(notice.param);
        changed = true;
      }
    }
    if (changed) window.history.replaceState(window.history.state, "", url.toString());

    const timers = notices.map((notice, index) => {
      if (notice.tone === "error") return null;
      return setTimeout(() => setLeaving((current) => [...current, index]), LEAVES_AFTER_MS);
    });
    return () => {
      for (const timer of timers) if (timer) clearTimeout(timer);
    };
  }, [notices]);

  return (
    <>
      <div className="toaster" aria-live="polite">
        {notices.map((notice, index) =>
          closed.includes(index) ? null : (
            <div
              key={`${notice.param}-${index}`}
              className={`toast ${notice.tone}${leaving.includes(index) ? " is-leaving" : ""}`}
              role={notice.tone === "error" ? "alert" : "status"}
              onAnimationEnd={(event) => {
                if (event.animationName === "toast-out") setClosed((current) => [...current, index]);
              }}
            >
              {notice.tone === "ok" ? <CheckCircle2 size={18} aria-hidden="true" /> : notice.tone === "error" ? <XCircle size={18} aria-hidden="true" /> : <Info size={18} aria-hidden="true" />}
              <div>
                <strong>{notice.title}</strong>
                {notice.text}
                {notice.href ? (
                  <>
                    {" "}
                    <a href={notice.href}>{notice.hrefLabel ?? "Open"}</a>
                  </>
                ) : null}
              </div>
              <button type="button" className="toast-close" aria-label="Close this notice" onClick={() => setLeaving((current) => [...current, index])}>
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          ),
        )}
      </div>
      <div className="visually-hidden" role="status">
        {notices.map((notice, index) => (
          <p key={index}>
            {notice.title}: {notice.text}
          </p>
        ))}
      </div>
    </>
  );
}
