import type { ReactNode } from "react";
import { DecorativeIllustration, type IllustrationName } from "@/components/decorative-illustration";

// The landscape at the foot of a home screen: one sentence and a wide illustration fading in
// from the right. It closes the page, under everything that works; it is never a card among
// the cards (Yoann, 2026-09-09 17:30: the landscapes belong at the bottom, not in a box).
export function LandscapeFooter({ name, title, children }: { name: IllustrationName; title: ReactNode; children: ReactNode }) {
  return (
    <section className="landscape" aria-label="Closing note">
      <div className="landscape-text">
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
      <div className="landscape-art" aria-hidden="true">
        <DecorativeIllustration name={name} variant="empty" />
      </div>
    </section>
  );
}
