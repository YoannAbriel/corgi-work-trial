"use client";

import { useEffect, useState, type ReactNode } from "react";

// The panel that shows a brand new access token, and the only client component of this screen.
//
// WHAT IT IS FOR: consuming the cookie. The token is rendered by the server (it arrives here as
// `children`, so this component never handles the secret itself); once it is painted, this asks
// POST /ops/mcp-keys/reveal/consume to clear the cookie that carried it. That is what makes "It
// is shown once" true: a reload afterwards has no cookie to read. `useEffect` runs after the
// commit, so the value is on screen before the request leaves.
//
// The Done button stays disabled until the answer comes back, so nobody can navigate away in the
// half second before the cookie is cleared and leave it behind.
//
// IF THE CALL FAILS (no network, the server restarted, a 403 because the session ended): the
// panel says so in one sentence and re-enables Done, because a person who cannot confirm the
// consume step must still be able to close the panel and press it. The cookie then dies of its
// own 120 s Max-Age, which is exactly why that ceiling exists.
export function TokenRevealPanel({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"consuming" | "consumed" | "failed">("consuming");

  useEffect(() => {
    let stillMounted = true;
    // credentials: same-origin so the cookie is sent; the answer carries the Set-Cookie that
    // deletes it. Nothing is read from the answer: 204 is the whole message.
    fetch("/ops/mcp-keys/reveal/consume", { method: "POST", credentials: "same-origin" })
      .then((answer) => {
        if (stillMounted) setState(answer.ok ? "consumed" : "failed");
      })
      .catch(() => {
        if (stillMounted) setState("failed");
      });
    return () => {
      stillMounted = false;
    };
  }, []);

  return (
    <div className="lists-token-panel">
      {children}
      {state === "failed" ? (
        <p className="note" role="status">
          Could not confirm the token was consumed; it expires in two minutes.
        </p>
      ) : null}
      <form method="post" action="/api/mcp-keys" className="inline-form">
        <input type="hidden" name="action" value="dismiss" />
        <button type="submit" disabled={state === "consuming"}>
          Done
        </button>
      </form>
    </div>
  );
}
