"use client";

import { DecorativeIllustration } from "@/components/decorative-illustration";

export default function WorkspaceError({ reset }: { reset: () => void }) {
  return (
    <main className="workspace-feedback">
      <DecorativeIllustration name="broken-link" variant="feedback" eager />
      <h1>We couldn’t load this page.</h1>
      <p role="alert">Please try again. If the problem continues, return to your workspace.</p>
      <div className="page-actions">
        <button type="button" onClick={reset}>Try again</button>
        <a className="button-link secondary" href="/">Back to workspace</a>
      </div>
    </main>
  );
}
