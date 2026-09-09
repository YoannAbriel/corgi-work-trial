import type { ReactNode } from "react";
import { DecorativeIllustration, type IllustrationName } from "@/components/decorative-illustration";

// An empty table, list or panel: one illustration, one sentence, at most one action.
export function EmptyState({ illustration, children, action }: { illustration?: IllustrationName; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {illustration ? <DecorativeIllustration name={illustration} variant="empty" /> : null}
      <p>{children}</p>
      {action}
    </div>
  );
}
