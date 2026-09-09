import Image from "next/image";
import type { ReactNode } from "react";

// Each illustration is imported as a file, not named by a hand-written string. Next reads its real
// width and height from the bytes at build time, so no file name and no dimension is retyped from
// docs/illustrations/catalog.json and the two cannot drift apart (F-IL-05).
import closedFolder from "@/public/illustrations/library/002-closed-folder.webp";
import inTray from "@/public/illustrations/library/015-in-tray.webp";
import openLedger from "@/public/illustrations/library/019-open-ledger.webp";
import brokenLink from "@/public/illustrations/library/035-broken-link.webp";
import birdBranch from "@/public/illustrations/library/045-bird-branch.webp";
import corgiSearch from "@/public/illustrations/library/067-corgi-search.webp";
import corgiGuard from "@/public/illustrations/library/069-corgi-guard.webp";
import corgiWelcoming from "@/public/illustrations/library/106-corgi-welcoming.webp";
import corgiPlantCare from "@/public/illustrations/library/124-corgi-plant-care.webp";
import meadowPath from "@/public/illustrations/library/131-meadow-path.webp";
import orchardMorning from "@/public/illustrations/library/132-orchard-morning.webp";
import gardenGate from "@/public/illustrations/library/146-garden-gate.webp";
import moonlitHills from "@/public/illustrations/library/149-moonlit-hills.webp";

// Only the illustrations used by the interface are listed here.
const illustrations = {
  "in-tray": inTray,
  "open-ledger": openLedger,
  "closed-folder": closedFolder,
  "broken-link": brokenLink,
  "all-clear": birdBranch,
  "search-corgi": corgiSearch,
  "coverage-corgi": corgiGuard,
  "welcome-corgi": corgiWelcoming,
  "plant-care": corgiPlantCare,
  "meadow-path": meadowPath,
  "orchard-morning": orchardMorning,
  "garden-gate": gardenGate,
  "moonlit-hills": moonlitHills,
} as const;

export type IllustrationName = keyof typeof illustrations;

// The widest the stylesheet ever draws each variant, from app/globals.css: .banner-illustration is
// 220 px, .empty-illustration 360 px, .feedback-illustration 300 px. Next turns this into a srcset,
// so the browser asks for a file the size of the box instead of the full 3456 px original (F-IL-01).
const displayedWidths = {
  banner: "220px",
  empty: "360px",
  feedback: "300px",
} as const;

export function DecorativeIllustration({
  name,
  variant,
  sizes,
}: {
  name: IllustrationName;
  variant: "empty" | "banner" | "feedback";
  // Only for a box whose width depends on the viewport, such as the login art panel that the
  // stylesheet hides below 580 px. Everything else keeps the fixed width above.
  sizes?: string;
}) {
  return (
    <Image
      className={`decorative-image ${variant}-illustration`}
      src={illustrations[name]}
      alt=""
      sizes={sizes ?? displayedWidths[variant]}
      // Lazy everywhere, and never `priority`. A decorative image is worth no preload, and a
      // preload emitted by the 404 boundary is fetched on every route in the application (F-IL-02).
      loading="lazy"
    />
  );
}

export function IllustrationBanner({
  name,
  title,
  children,
}: {
  name: IllustrationName;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="welcome-banner">
      <div>
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
      <DecorativeIllustration name={name} variant="banner" />
    </section>
  );
}
