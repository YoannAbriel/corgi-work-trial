import type { ReactNode } from "react";
import { DecorativeIllustration } from "@/components/decorative-illustration";
import { SECTIONS, type SectionId } from "./sections";

// The band at the top of every screen: it is sticky, so the reader always sees what they are
// looking at, where it stands and what they can do with it. It holds at most: the section's
// illustration, a title with an optional small suffix, one line of useful chips or facts, and
// the primary actions. Nothing in it explains anything; explanations go under "About this screen".
export type Band = {
  title: ReactNode;
  // A short suffix beside the title, such as a policy's customer name.
  suffix?: ReactNode;
  // One line of chips (components/detail-layout Chip) or short facts.
  meta?: ReactNode;
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
      <div className="band-title">
        <h1>
          {band.title}
          {band.suffix ? <small>{band.suffix}</small> : null}
        </h1>
        {band.meta ? <div className="band-meta">{band.meta}</div> : null}
      </div>
      {band.actions ? <div className="band-actions">{band.actions}</div> : null}
      <span className="visually-hidden">
        <Icon size={12} aria-hidden="true" /> {definition.label}
      </span>
    </div>
  );
}
