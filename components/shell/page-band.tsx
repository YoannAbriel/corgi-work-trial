import type { ReactNode } from "react";
import { DecorativeIllustration } from "@/components/decorative-illustration";
import { SECTIONS, type SectionId } from "./sections";

// The band at the top of every screen: it is sticky, so the reader always sees what they are
// looking at and what they can do with it. It is ONE LINE (Yoann, 2026-09-09): the section's
// illustration, a big title with an optional small suffix, at most one chip, and the actions.
// The row of chips that used to sit under the title is gone: a strip of little patches made the
// title small and told the reader less than the sidebar badges and the tiles already do.
// Nothing in it explains anything; explanations go under "About this screen".
export type Band = {
  title: ReactNode;
  // A short suffix beside the title: a policy number, a broker's name, "the last 60 minutes".
  suffix?: ReactNode;
  // At most ONE chip, on the title line. Only a screen that shows one record puts something here,
  // and only that record's own state (bound, closed, provisional, approved). Counts belong to the
  // sidebar badges and the tiles, the signed-in role to the bottom of the sidebar.
  status?: ReactNode;
  // Buttons and button links. Forms keep their own action and fields.
  actions?: ReactNode;
  // Overrides the section's illustration when a screen has its own identity.
  illustration?: Parameters<typeof DecorativeIllustration>[0]["name"];
};

export function PageBand({ section, band }: { section: SectionId; band: Band }) {
  const definition = SECTIONS[section];
  const Icon = definition.icon;
  return (
    <div className="page-band">
      <span className="band-art" aria-hidden="true">
        <DecorativeIllustration name={band.illustration ?? definition.illustration} variant="band" />
      </span>
      <h1 className="band-title">
        {band.title}
        {band.suffix ? <small>{band.suffix}</small> : null}
      </h1>
      {band.status ? <span className="band-status">{band.status}</span> : null}
      {band.actions ? <div className="band-actions">{band.actions}</div> : null}
      <span className="visually-hidden">
        <Icon size={12} aria-hidden="true" /> {definition.label}
      </span>
    </div>
  );
}
