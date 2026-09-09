import type { ReactNode } from "react";
import { Disclosure } from "@/components/disclosures";

// The one place a screen explains itself, at the bottom, closed. Its content is in the HTML
// whether it is open or not (a native details element), so a reviewer and a text search still
// find every sentence; a reader only meets it when they ask.
export function About({ title = "About this screen", children }: { title?: string; children: ReactNode }) {
  return (
    <div className="about">
      <Disclosure title={title}>{children}</Disclosure>
    </div>
  );
}
