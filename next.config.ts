import type { NextConfig } from "next";

// Deployment note: the Vercel project skips a build when the pushed commit touches only docs
// (Ignored Build Step). It compares the last commit with its parent, so a push that carries a
// code commit followed by a docs commit is skipped as a whole. Push code on its own first.
const nextConfig: NextConfig = {
  // Keep the config empty until a feature needs an option; every option added here gets a comment saying why.
  //
  // `next dev` and `next build` append a Next.js block to AGENTS.md when this is left on.
  // AGENTS.md here is the trial's engineering rulebook, not a file for tooling to edit, so the
  // generator is turned off rather than letting every dev run produce a spurious diff.
  agentRules: false,

  // The two PDF routes read the Corgi wordmark off disk at render time
  // (lib/documents/pdf-theme.ts, corgiWordmarkPng). Everything under public/ is uploaded to
  // the CDN as a static asset, which does NOT put it inside the serverless function, and the
  // file tracer cannot see a path built with join() at runtime. Naming the file here is what
  // copies it next to each of the two functions, so process.cwd() finds it in production.
  outputFileTracingIncludes: {
    "/api/policies/[policyId]/documents/[document]": ["./public/brand/corgi-logo.png"],
    "/api/statements/[runId]/pdf": ["./public/brand/corgi-logo.png"],
  },
};

export default nextConfig;
