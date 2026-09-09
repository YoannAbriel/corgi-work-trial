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
import openFolder from "@/public/illustrations/library/003-open-folder.webp";
import magnifyingGlass from "@/public/illustrations/library/007-magnifying-glass.webp";
import balanceScales from "@/public/illustrations/library/020-balance-scales.webp";
import receiptRoll from "@/public/illustrations/library/024-receipt-roll.webp";
import shieldLeaf from "@/public/illustrations/library/026-shield-leaf.webp";
import umbrella from "@/public/illustrations/library/027-umbrella.webp";
import safetyNet from "@/public/illustrations/library/031-safety-net.webp";
import connectedLink from "@/public/illustrations/library/036-connected-link.webp";
import padlock from "@/public/illustrations/library/037-padlock.webp";
import keyRing from "@/public/illustrations/library/039-key-ring.webp";
import serverBox from "@/public/illustrations/library/040-server-box.webp";
import chessKing from "@/public/illustrations/library/064-chess-king.webp";
import corgiSleeping from "@/public/illustrations/library/068-corgi-sleeping.webp";
import corgiBroker from "@/public/illustrations/library/073-corgi-broker-satchel.webp";
import corgiAccountant from "@/public/illustrations/library/074-corgi-accountant.webp";
import corgiChecker from "@/public/illustrations/library/075-corgi-checker.webp";
import corgiEngineer from "@/public/illustrations/library/081-corgi-engineer.webp";
import corgiCelebrating from "@/public/illustrations/library/110-corgi-celebrating.webp";
import corgiReading from "@/public/illustrations/library/118-corgi-reading.webp";
// Cycle 2, decision 12: the sections that were drawn with near-black monochrome objects
// (in-tray, open-folder, balance-scales, server-box) take a light watercolour corgi, which is
// what the rest of the identity is made of. The old names stay in the map: other screens still
// use them for empty states.
import corgiLetter from "@/public/illustrations/library/070-corgi-letter.webp";
import corgiArchivist from "@/public/illustrations/library/071-corgi-archivist.webp";
import corgiResearcher from "@/public/illustrations/library/076-corgi-researcher.webp";
import corgiMechanic from "@/public/illustrations/library/098-corgi-mechanic.webp";
import corgiUmbrella from "@/public/illustrations/library/112-corgi-umbrella.webp";
import corgiLaptopWork from "@/public/illustrations/library/119-corgi-laptop-work.webp";

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
  // Added with the interface system of 2026-09-09: one per section (the page band and the
  // overview cards) and a few for empty states.
  "open-folder": openFolder,
  "magnifying-glass": magnifyingGlass,
  "balance-scales": balanceScales,
  "receipt-roll": receiptRoll,
  "shield-leaf": shieldLeaf,
  umbrella: umbrella,
  "safety-net": safetyNet,
  "connected-link": connectedLink,
  padlock: padlock,
  "key-ring": keyRing,
  "server-box": serverBox,
  "chess-king": chessKing,
  "sleeping-corgi": corgiSleeping,
  "broker-corgi": corgiBroker,
  "accountant-corgi": corgiAccountant,
  "checker-corgi": corgiChecker,
  "engineer-corgi": corgiEngineer,
  "celebrating-corgi": corgiCelebrating,
  "reading-corgi": corgiReading,
  "letter-corgi": corgiLetter,
  "archivist-corgi": corgiArchivist,
  "researcher-corgi": corgiResearcher,
  "mechanic-corgi": corgiMechanic,
  "umbrella-corgi": corgiUmbrella,
  "laptop-corgi": corgiLaptopWork,
} as const;

export type IllustrationName = keyof typeof illustrations;

// The widest the stylesheet ever draws each variant, from app/globals.css: .banner-illustration is
// 220 px, .empty-illustration 360 px, .feedback-illustration 300 px. Next turns this into a srcset,
// so the browser asks for a file the size of the box instead of the full 3456 px original (F-IL-01).
const displayedWidths = {
  banner: "220px",
  empty: "360px",
  feedback: "300px",
  // The page band's vignette and the overview cards are drawn at 46 and 52 px; asking for a
  // 96 px file keeps them sharp on a dense screen.
  band: "96px",
  card: "120px",
} as const;

export function DecorativeIllustration({
  name,
  variant,
  sizes,
}: {
  name: IllustrationName;
  variant: "empty" | "banner" | "feedback" | "band" | "card";
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
