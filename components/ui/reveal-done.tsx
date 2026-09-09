"use client";

import { useEffect, useState } from "react";

// The Done button under a new broker's sign-in details.
//
// It does one thing the server cannot do for itself: the details arrive in a cookie scoped to
// /ops/brokers (lib/broker/reveal-cookie.ts), and a page rendered on the server cannot remove a
// cookie while it renders. So as soon as this block appears, this component posts to
// /ops/brokers/reveal/consume, which answers with the deletion.
//
// The button is DISABLED until that call comes back, so nobody leaves the screen believing the
// password was cleared while the request is still in flight. If the call fails, the button is
// enabled anyway and the note beside it says the truth: the cookie expires on its own within two
// minutes, and nothing else holds the password.
export function RevealDone() {
  const [state, setState] = useState<"clearing" | "cleared" | "failed">("clearing");

  useEffect(() => {
    // `active` guards against the component being removed before the answer arrives: setting
    // state on a component that is gone is a mistake React warns about.
    let active = true;
    fetch("/ops/brokers/reveal/consume", { method: "POST" })
      .then((response) => {
        if (active) setState(response.ok ? "cleared" : "failed");
      })
      .catch(() => {
        if (active) setState("failed");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <p className="note">
      <button
        type="button"
        className="secondary small"
        disabled={state === "clearing"}
        // Back to the list, without the ?created= that put this block on the screen.
        onClick={() => window.location.assign("/ops/brokers")}
      >
        {state === "clearing" ? "Clearing" : "Done"}
      </button>{" "}
      {state === "clearing" ? "Removing these details from your browser." : null}
      {state === "cleared" ? "These details are no longer held anywhere." : null}
      {state === "failed" ? "These details could not be cleared just now; they expire on their own within two minutes." : null}
    </p>
  );
}
