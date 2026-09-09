"use client";

import { DecorativeIllustration } from "@/components/decorative-illustration";
import { SignedOutFrame } from "@/components/signed-out-frame";
import "@/app/styles/landing.css";

// The error boundary of the whole application, in the same frame as the 404 so a reader who meets
// both sees one product. "Try again" re-renders the route the boundary caught; it posts nothing.
export default function WorkspaceError({ reset }: { reset: () => void }) {
  return (
    <SignedOutFrame>
      <div className="landing-feedback">
        <DecorativeIllustration name="broken-link" variant="feedback" />
        <h1>This page could not load.</h1>
        <p role="alert">Try again. If it keeps failing, go back to the start.</p>
        <div className="landing-feedback-actions">
          <button type="button" onClick={reset}>
            Try again
          </button>
          <a className="button-link secondary" href="/">
            Back to the start
          </a>
        </div>
      </div>
    </SignedOutFrame>
  );
}
