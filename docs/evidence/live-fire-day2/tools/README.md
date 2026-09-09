# Live-fire read-only tools

Session tools used on 2026-09-09 to predict and verify the live-fire figures. All read-only:
`live.mjs` signs in once per demo role (password from `.env.local` through `process.loadEnvFile`,
never printed) and GETs pages; `text.mjs` turns a page into text lines; `shot.mjs` takes a
headless screenshot with playwright-core; `reread.mjs` re-reads the day's figures (54 checks) on
the deployed revision and prints agree or DISAGREE per figure; `expected-statement.mts` computes a
statement with the repository's reader and pure function inside a READ ONLY transaction;
`expected-cancellation.mts` runs `cancellationBreakdown` on the segments of CGP-01707. Paths inside
point at the session scratchpad and the repository checkout of that day; adjust before reuse.
Run the `.mts` files with `./node_modules/.bin/tsx --tsconfig ./tsconfig.json` from the checkout.
