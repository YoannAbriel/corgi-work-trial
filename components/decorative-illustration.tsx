import type { ReactNode } from "react";

// Only the illustrations used by the interface are listed here. The dimensions come from
// docs/illustrations/catalog.json so the browser can reserve the right space before each file loads.
const illustrations = {
  "in-tray": { file: "015-in-tray", width: 1024, height: 1024 },
  "open-ledger": { file: "019-open-ledger", width: 1024, height: 1024 },
  "closed-folder": { file: "002-closed-folder", width: 1024, height: 1024 },
  "broken-link": { file: "035-broken-link", width: 1024, height: 1024 },
  "all-clear": { file: "045-bird-branch", width: 1152, height: 768 },
  "search-corgi": { file: "067-corgi-search", width: 1152, height: 768 },
  "coverage-corgi": { file: "069-corgi-guard", width: 1152, height: 768 },
  "welcome-corgi": { file: "106-corgi-welcoming", width: 768, height: 1024 },
  "plant-care": { file: "124-corgi-plant-care", width: 1024, height: 1024 },
  "meadow-path": { file: "131-meadow-path", width: 4032, height: 1728 },
  "orchard-morning": { file: "132-orchard-morning", width: 3456, height: 2304 },
  "garden-gate": { file: "146-garden-gate", width: 3456, height: 2304 },
  "moonlit-hills": { file: "149-moonlit-hills", width: 4032, height: 1728 },
} as const;

export type IllustrationName = keyof typeof illustrations;

export function DecorativeIllustration({
  name,
  variant,
  eager = false,
}: {
  name: IllustrationName;
  variant: "empty" | "banner" | "feedback";
  eager?: boolean;
}) {
  const illustration = illustrations[name];
  return (
    <img
      className={`decorative-image ${variant}-illustration`}
      src={`/illustrations/library/${illustration.file}.webp`}
      width={illustration.width}
      height={illustration.height}
      alt=""
      loading={eager ? "eager" : "lazy"}
    />
  );
}

export function IllustrationBanner({
  name,
  title,
  children,
  eager = false,
}: {
  name: IllustrationName;
  title: ReactNode;
  children: ReactNode;
  eager?: boolean;
}) {
  return (
    <section className="welcome-banner illustration-banner">
      <div>
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
      <DecorativeIllustration name={name} variant="banner" eager={eager} />
    </section>
  );
}
