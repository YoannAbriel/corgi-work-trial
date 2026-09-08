import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the config empty until a feature needs an option; every option added here gets a comment saying why.
  //
  // `next dev` and `next build` append a Next.js block to AGENTS.md when this is left on.
  // AGENTS.md here is the trial's engineering rulebook, not a file for tooling to edit, so the
  // generator is turned off rather than letting every dev run produce a spurious diff.
  agentRules: false,
};

export default nextConfig;
