# YOA-639: illustration integration, cross-model independent review

Reviewer: an independent Claude (Anthropic) sub-agent, in its own worktree `.claude/worktrees/agent-acb954127ac2f0f4f`, branch `agent-acb954127ac2f0f4f`. Implementation review, 2026-09-09, 08:45 to 09:10 UTC.

Why this record exists: the illustration work was written by Codex (an OpenAI model) on `codex/corgi-interface` and merged into `main` at **`08b3678d820e8b7d99caebe11f9e610497a05260`** with `--no-ff`. The three existing records (`illustration-library.md`, `illustration-integration.md`, `ui-back-controls.md`) were written by that same Codex session about its own work, so they are not independent under `REVIEWER.md`. This review is cross-model: a different model family, a different worktree, no code written by this reviewer.

Reviewed revision: `08b3678`, verified live. `/api/health` reported `revision: 08b3678d820e8b7d99caebe11f9e610497a05260` at 08:47:00Z and the browser measurements began immediately after. At 09:03:13Z the deployment had moved to `41ea2c5`. The illustration surface is identical across the two: `git diff 08b3678 41ea2c5` touches `components/what-needs-you.tsx` only in the task list and its inbox anchor (the `showEmptyIllustration` prop and the `DecorativeIllustration` line are byte-identical), `app/inbox/page.tsx` only in an unrelated notice, and `app/ops/console/page.tsx`. Every measurement below therefore applies to `08b3678` as reviewed.

## Startup receipt

Read in full for this review: `CLAUDE.md`, `AUTOMATIC-FAILS.md` (all six bans), `REVIEWER.md`, `AGENTS.md`, `READABLE-CODE.md`, `README.md`, and the three Codex records named above. Read `docs/illustrations/catalog.json` (parsed, all 150 entries), `components/decorative-illustration.tsx`, and the complete non-image diff of the merge (`app/`, `components/`, `app/globals.css`, 30 files). No mandatory file was missing. The working tree was clean at start.

Next acceptance criterion checked: the decorative library is integrated without appearing on any money surface, without breaking layout at 375, 768 and 1280 px, without a dishonest visual, and without an unreasonable download cost. Biggest unresolved risk at start: weight, because the library holds four banner assets of 626 to 678 KB each and the CSS renders them in a 220 px box.

Constraints observed: sandbox only, GET requests plus the documented login POST on production, no form submitted, no business action performed, no money moved, no database write. `DEMO_PASSWORD` was loaded with `process.loadEnvFile` from `.env.local` and passed to the browser driver through the process environment; it was never printed, logged or written to a file. The Codex worktrees `.worktrees/corgi-interface` and `.worktrees/corgi-illustrations` were not touched.

## Scope

In scope: the merge `08b3678` against `08b3678^1`. 180 files, 10,302 insertions, 49 deletions: 150 WebP files under `public/illustrations/library/` and 30 non-image files (18 under `app/`, 4 under `components/`, `app/globals.css`, 6 under `docs/`, plus the three Codex records). Deployed behaviour of the illustration surface at 375, 768 and 1280 px.

Out of scope: the financial system, the ledger, provider integrations, the MCP surface, the console feature itself, the 150 assets' generation provenance (covered by `illustration-library.md`, not re-derived here), and any final delivery gate.

## Applicability

Decorative presentation for Track 1. The diff adds no provider, rail, endpoint, query, authorization path, persistence or arithmetic. `git diff 08b3678^1 08b3678` touches no file under `lib/`, `db/`, `scripts/` or `app/api/`, and no package file. No legal or provider obligation follows from decorative bitmaps, and no legal research was needed for this scope.

## Every call site, with screen and state

Fourteen renderer calls in thirteen files. `Empty` (in `components/detail-layout.tsx`) and `IllustrationBanner` both delegate to the single `DecorativeIllustration` renderer.

| # | Call site | Screen | State that shows it | Kind | File |
|---|---|---|---|---|---|
| 1 | `app/page.tsx:53` | `/` public home | always | banner, eager | `131-meadow-path` |
| 2 | `app/login/page.tsx:72` | `/login` art panel | always above 768 px, hidden below | banner, eager | `106-corgi-welcoming` |
| 3 | `app/not-found.tsx:7` | 404 | wrong or unreadable URL | feedback, eager | `067-corgi-search` |
| 4 | `app/error.tsx:8` | error boundary | a thrown render error | feedback, eager | `035-broken-link` |
| 5 | `components/what-needs-you.tsx:245` | `/broker`, `/customer`, `/ops` | no task waiting, and (broker, customer) at least one policy exists | empty, eager | `045-bird-branch` |
| 6 | `app/broker/page.tsx:88` | `/broker` policies panel | broker has no policy | empty, lazy | `002-closed-folder` |
| 7 | `app/broker/page.tsx:130` | `/broker` foot of page | always | banner, lazy | `146-garden-gate` |
| 8 | `app/broker/statements/page.tsx:54` | `/broker/statements` | no statement yet | empty, lazy | `019-open-ledger` |
| 9 | `app/broker/statements/page.tsx:119` | `/broker/statements` foot | always | banner, lazy | `124-corgi-plant-care` |
| 10 | `app/customer/page.tsx:84` | `/customer` policies panel | no policy attached | empty, lazy | `069-corgi-guard` |
| 11 | `app/customer/page.tsx:147` | `/customer` foot | always | banner, lazy | `132-orchard-morning` |
| 12 | `components/workspace-overview.tsx:133` | `/ops` foot | always | banner, lazy | `149-moonlit-hills` |
| 13 | `app/inbox/page.tsx:56` | `/inbox` | account with no workspace | empty, lazy | `015-in-tray` |
| 14 | `app/inbox/page.tsx:95` | `/inbox` first section only | nothing waiting anywhere | empty, lazy | `015-in-tray` |
| 15 | `app/ops/claims/page.tsx:35` | `/ops/claims` | no claim exists | empty, lazy | `067-corgi-search` |
| 16 | `app/ops/policies/page.tsx:48` | `/ops/policies` | no policy exists | empty, lazy | `002-closed-folder` |
| 17 | `app/ops/reconciliation/page.tsx:118` | `/ops/reconciliation` breaks panel | no run has ever happened | empty, lazy | `045-bird-branch` |
| 18 | `app/ops/reconciliation/page.tsx:120` | `/ops/reconciliation` breaks panel | runs exist, no open break | empty, lazy | `045-bird-branch` |
| 19 | `app/ops/statements/page.tsx:69` | `/ops/statements` runs panel | no run has ever happened | empty, lazy | `019-open-ledger` |
| 20 | `app/ops/statements/page.tsx:116` | `/ops/statements` foot | always | banner, lazy | `124-corgi-plant-care` |
| 21 | `app/policies/[policyId]/page.tsx:861` | policy detail, claims panel | no claim on this policy | empty, lazy | `067-corgi-search` |
| 22 | `app/policies/[policyId]/customer-view.tsx:189` | policy detail, customer view | customer has asked for nothing | empty, lazy | `015-in-tray` |

Where they must not appear, measured on the deployment and not only in the source: **zero images** on the policy journal (`/policies/{id}`, both staff and broker), the approvals queue (`/ops/approvals`, as `approver@example.com`), the claim detail with its payment rows (`/ops/claims/{id}`), the published statement with its figures (`/statements/{id}`), the reconciliation breaks table when breaks exist (`/ops/reconciliation`), and all of the operations console (`/ops/console`, `/ops/console/policy/{id}`, `/ops/console/infra`). `document.querySelectorAll('table img').length` returned **0 on all 29 routes at all three widths**, 87 measurements. The `/ops/statements` and `/broker/statements` banners sit after the closing tag of the figures grid, not inside it.

One correction to the assignment premise and to the Codex record: **four** operations screens carry illustration code, not two. `/ops/claims` and `/ops/reconciliation` (empty states), plus `/ops/policies` (empty state) and `/ops/statements` (empty state and an always visible banner), and `/ops` itself carries an empty-state image plus a banner. None sits on a forbidden surface, which is measured above, so this is an accuracy point about the records, not a placement defect. See F-IL-07.

## Weight and delivery, measured on the deployment

Library: **150 WebP files, 19,727,540 bytes** (19.73 MB decimal, 18.81 MiB), confirmed on disk. **13 of the 150 are referenced** by the application; the other 137 are referenced by nothing. Three older files also remain under `public/illustrations/` (`corgi-engraving.webp`, `corgi-desk.webp`, `corgi-landscape.webp`); `corgi-engraving.webp` was the home and login image before this merge and is now unreferenced too.

All 13 mapped entries were checked against `docs/illustrations/catalog.json` and against the bytes on disk: **13 of 13 agree** on file name, width, height and byte size.

There is **no `srcset`, no `sizes` and no `next/image`** anywhere in the diff, so every page transfers exactly the same bytes at 375 px as at 1280 px. The two columns below are therefore equal by construction, and that is itself the finding.

| Route (state as deployed) | images at 375 px | images at 1280 px | what is actually transferred |
|---|---|---|---|
| `/broker` | **743.6 KB** | **743.6 KB** | `146-garden-gate` 694,478 B + `045-bird-branch` 26,376 B + preload 40,640 B |
| `/customer` | **691.0 KB** | **691.0 KB** | `132-orchard-morning` 640,594 B + `045-bird-branch` 26,376 B + preload 40,640 B |
| `/ops` | **524.5 KB** | **524.5 KB** | `149-moonlit-hills` 496,422 B + preload 40,640 B |
| `/` public home | **500.6 KB** | **500.6 KB** | `131-meadow-path` 471,938 B + preload 40,640 B |
| 404, signed out and signed in | **500.6 KB** | **500.6 KB** | `067-corgi-search` 40,640 B shown + `131-meadow-path` 471,938 B never shown |
| `/ops/statements`, `/broker/statements` | 167.0 KB | 167.0 KB | `124-corgi-plant-care` 130,408 B + preload 40,640 B |
| `/login` | 141.6 KB | 141.6 KB | `106-corgi-welcoming` 104,334 B + preload 40,640 B (at 375 px the image is hidden and still fetched) |
| `/inbox` broker, `/inbox` customer | 109.8 KB | 109.8 KB | `015-in-tray` 71,780 B + preload 40,640 B |
| `/ops/claims`, `/ops/policies`, `/ops/reconciliation`, `/ops/console`, `/inbox` ops | 39.7 KB | 39.7 KB | preload only, nothing displayed |
| policy detail, claim detail, `/ops/approvals`, `/statements/{id}`, console policy, console infra, `/ops/brokers`, `/broker/kyb`, `/broker/policies/new` | 39.7 KB | 39.7 KB | preload only, nothing displayed |

**Five page states exceed the 400 KB yardstick**, by 25 to 86 percent: `/broker`, `/customer`, `/ops`, `/`, and the 404 in both signed states. See F-IL-01 and F-IL-02.

Unreferenced files in `public/` and the deployment: they are uploaded and served. `GET /illustrations/library/077-corgi-gardener.webp` returns 200 with 76,684 bytes, `150-sunset-road.webp` 200 with 529,126 bytes, `100-corgi-pilot.webp` 200 with 52,050 bytes. No page ever requests them, so **no visitor pays for them**; the cost is clone size, build input and deployment upload, not runtime. This is not a deployment problem. It is the same class as the already recorded F-UI-05 (two unreferenced files, 31.7 KB) at about 600 times the size. See F-IL-03.

## Accessibility and honesty

- **Alt text.** The single renderer hard-codes `alt=""`. All 13 rendered images across 29 routes and 3 widths carried `alt=""` in the live DOM, no exception. No illustration in this slice is meaningful, so no missing alt exists. `aria-hidden` is absent and is not needed: an empty alt already removes the image from the accessibility tree, and adding `aria-hidden` would be redundant. PASS.
- **False implication.** No rendered illustration carries a checkmark, a badge, a "verified", "paid" or "settled" mark. The one questionable mapping is the developer-facing key `all-clear`, see F-IL-04.
- **Integration mode labels.** `/ops/reconciliation` still shows both `Chip` labels, `Stripe: LIVE SANDBOX` and `claim payout rail: LOCAL SIMULATOR`, in the identity band above the panels and again in the disclosure, verified in the live DOM at all three widths. `/ops` shows `Claim payout rail: LOCAL SIMULATOR` in the workspace overview, above the new banner. `/ops/console` carries `LIVE SANDBOX` in its markup (inside a disclosure, hence absent from `innerText`), and `/ops/approvals` carries `LOCAL SIMULATOR`. None of them is obscured or displaced by an illustration.
- **Sandbox sentence.** "Work-trial build on sandbox providers and test data. No real money moves here." is present and in the normal text flow on `/` and on `/login` at 375, 768 and 1280 px, in `.page-heading`, above and separate from the banner. It is not overlaid on any image; no illustration in this slice is a background, `getComputedStyle(...).backgroundImage` matching `illustrations` returned an empty set on every route. PASS.

## Layout

Playwright is **not** in `node_modules`. A system-wide Python Playwright with a cached Chromium is installed on this machine and was used instead; that is a stronger check than reading the CSS, and it is named here so the evidence is not mistaken for the repository's own tooling.

`document.documentElement.scrollWidth` was compared with `window.innerWidth` on **29 routes at 375, 768 and 1280 px, 87 measurements. Every one was equal**: no horizontal scroll anywhere, signed out, and as broker, customer, staff operations and approver.

Text over banners: the `.welcome-banner` is a flex row (column-reverse below 768 px) with the copy in its own `div` beside the image, never on top of it. No image is a CSS background. Nothing overlaps.

Nothing that existed before the merge disappeared. The diff removes exactly three things: the `corgi-engraving.webp` `<img>` on `/` and on `/login` (replaced by the new renderer), and three "Back to the policy" anchors at the foot of the cancel, endorse and new-claim forms. Those three pages keep the policy link in their `PortalShell` breadcrumb trail, checked in the source of all three files, so the parent navigation survives. Every other change is additive.

## Code, against READABLE-CODE.md

`components/decorative-illustration.tsx` is 65 lines: one `as const` map, one exported type derived from its keys, two components. There is no indirection, no side effect, no fetch, no filesystem access, no arithmetic. The comment states the business reason (the dimensions exist so the browser can reserve space before the file loads) rather than narrating the code. `IllustrationName` is `keyof typeof illustrations`, so an unknown name is a compile error, not a runtime one; `npm run typecheck` passes.

A missing file cannot crash a page: the component emits a plain `<img>`, so a deleted asset produces a 404 on that one request and an empty alt, and the page renders. There is no loader, no build-time resolution and no `next/image` that could throw. Verified by rendering `app/error.tsx` and `app/not-found.tsx` to static markup outside Next.

`components/detail-layout.tsx`: `Empty` gains one optional prop and an early return for the no-illustration case. `components/what-needs-you.tsx`: one optional boolean, defaulting to the previous behaviour. `components/workspace-overview.tsx`: one added banner. All three are short and readable. The `.aside-value-nowrap` class and the `grid-template-columns: minmax(0, 1fr)` in the same merge come from the back-controls and detail-grid fixes, both already reviewed.

One weakness: the catalog is the source of the file names **by convention only**. The component retypes 13 file names and 26 numbers by hand and nothing checks them against `catalog.json`. See F-IL-05.

## Findings

**F-IL-01, MEDIUM: four banner panoramas are delivered at up to 250 times the pixel count they are displayed at, and no page has a responsive source.**
`146-garden-gate.webp` is 3456 by 2304 and 694,478 bytes; `app/globals.css:522` renders it in a `220 by 150` box, measured at `220x147` in the live DOM. Same shape for `132-orchard-morning` (640,594 B), `149-moonlit-hills` (496,422 B) and `131-meadow-path` (471,938 B). With no `srcset` and no `sizes`, a 375 px phone downloads exactly the desktop bytes. Consequence: `/broker` 743.6 KB, `/customer` 691.0 KB, `/ops` 524.5 KB, `/` 500.6 KB of decoration, on an operations tool whose own CSS says the picture should be 220 px wide. Required correction: export a 440 px wide variant of those four assets (two times the displayed box) and point the banner map at it, or add a `srcset` with the small variant. The empty and feedback assets at 1024 or 1152 px are already proportionate and need nothing.

**F-IL-02, MEDIUM: images are downloaded on screens that never display them, including 461 KB on every 404.**
`app/not-found.tsx:7` renders the illustration with `eager`. Next serialises the root not-found boundary into every route's payload, and React emits `<link rel="preload" as="image" href="/illustrations/library/067-corgi-search.webp">` into the `<head>` of **every page**. Verified in the HTML of `/` and `/ops/console`, and reproduced by rendering the component to static markup, which emits the preload tag directly. Consequence: **40,640 bytes on all 29 routes measured**, including `/ops/console`, `/ops/approvals`, `/policies/{id}`, `/statements/{id}` and `/ops/claims/{id}`, which display no illustration at all. Second consequence: the 404 page prefetches its own `Link href="/"`, whose payload carries the home page's preload, so a wrong URL downloads `131-meadow-path.webp`, **471,938 bytes it never shows**. Third: `/login` at 375 px downloads `106-corgi-welcoming.webp`, 104,334 bytes, while `.login-art-panel { display: none }` hides it; the preload defeats the `display:none` that would otherwise skip the request. Required correction: drop `eager` from `app/not-found.tsx` and `app/error.tsx` (nobody is waiting on the largest contentful paint of an error screen) and from `app/login/page.tsx`, or move the login art out of the hidden panel. This finding is why the Codex record's "Loading strategy: PASS" is source-true but not supported by deployed behaviour.

**F-IL-03, LOW: 137 of the 150 committed assets are referenced by nothing, about 19.1 MB.**
Thirteen files are used; the rest are served (200 from the deployment, spot-checked on three) and never requested. No visitor pays for them, so this costs clone, build and deploy size only. It is the recorded F-UI-05 pattern at about 600 times the scale, and three older files (`corgi-engraving`, `corgi-desk`, `corgi-landscape`) are now unreferenced too. Required correction: keep only the used files in `public/` and hold the library elsewhere, or record it as a deliberate disclosed limitation in the README.

**F-IL-04, LOW: an illustration key claims a state the code has not established.**
`app/ops/reconciliation/page.tsx:118` uses `illustration="all-clear"` for the branch `runs.length === 0`, whose own sentence is "No reconciliation has ever run". Nothing has been compared in that state, which is the opposite of all clear. The same key serves the genuine branch two lines below (`breaks.length === 0`, runs exist). No user-visible false statement is made: the file behind the key is `045-bird-branch`, a bird on a branch with no badge or mark, the alt is empty, and the sentence beside it is exact. The defect is in the code's own vocabulary, which is what a reader of the diff will trust. Required correction: give the never-run branch a neutral key such as `waiting` or reuse `open-ledger`.

**F-IL-05, LOW: the catalog is the single source of the file names by convention only.**
`components/decorative-illustration.tsx` retypes 13 file names, 13 widths and 13 heights from `docs/illustrations/catalog.json`, and the comment says so, but nothing enforces it. Checked today: 13 of 13 match the catalog and the bytes on disk. A future drift would silently hand the browser a wrong aspect ratio to reserve, which is a layout shift, not a crash. Required correction: a small unit test that reads `catalog.json` and asserts the map, or import the catalog directly.

**F-IL-06, LOW: dead class name.** `IllustrationBanner` emits `className="welcome-banner illustration-banner"`; `.illustration-banner` has no rule anywhere in `app/globals.css`. Harmless, and it invites a reader to look for styling that does not exist. Remove it or give it the rule it implies.

**F-IL-07, LOW, record accuracy: the operations footprint is understated.** Four operations screens carry illustration code, not two, and one of them (`/ops/statements`) carries an always-visible banner rather than an empty state, as does `/ops`. Measured placement is nevertheless clean: nothing on a journal, a queue, a money table, a breaks table, statement figures or the console. Required correction: none in code; the record should say four.

No HIGH finding. No finding touches money, authorization, persistence, a provider or a label's honesty.

## Checks actually executed, with counts

- **Production revision.** `/api/health` polled until it reported `08b3678d820e8b7d99caebe11f9e610497a05260`, matched on the first poll at 08:47:00Z. Re-checked at 09:03:13Z: `41ea2c5`. Illustration surface proven identical between the two by targeted diff.
- **Browser measurement, run 1.** Chromium, 18 route states at 375, 768 and 1280 px, 54 page loads. Recorded per page: `documentElement.scrollWidth` against `innerWidth`, every `<img>` with its alt, aria-hidden, loading, srcset, sizes, natural size, rendered size and ancestors, every image response with its byte count, `table img` count, and the presence of the sandbox sentence and both integration-mode labels.
- **Browser measurement, run 2.** 11 further route states (policy detail as three roles, claim detail, approvals, published statement, two console screens, brokers, KYB, new policy) at the same three widths, 33 page loads. Same instrumentation.
- **Result:** 87 of 87 measurements had `scrollWidth === innerWidth`. 87 of 87 had zero `table img`. 13 of 13 rendered illustrations had `alt=""`.
- **Login.** Seven demo accounts signed in with the documented POST to `/api/session/login`: `broker@`, `broker2@`, `broker3@`, `customer@`, `customer2@`, `ops@`, `approver@`. All seven returned 303 with a session cookie and landed on the expected role home (`/broker`, `/broker`, `/broker`, `/customer`, `/customer`, `/ops`, `/ops`), each rendering 200. No other form was submitted; every other request was a GET. No business action, no money movement, no database write, no provider call.
- **Error page.** Not reproduced on production. Six deliberately malformed GET URLs (`/statements/not-a-uuid`, `/ops/console/policy/not-a-uuid`, `/ops/claims/not-a-uuid`, `/policies/not-a-uuid`, `/ops/console/customer/not-a-uuid`, `/ops/console/broker/not-a-uuid`) all returned the application's own 404 with no stack trace, no error message and no digest: the path ids are validated before any query, so no server error could be provoked without submitting something. Verified instead by source and by static render: `app/error.tsx` declares its props as `{ reset }` only, never receives or renders the `error` object, and its markup is one decorative image with an empty alt, a fixed heading, a fixed sentence and two controls. It cannot print a stack trace because it never has one. The 404 page was exercised for real, signed out and signed in, at all three widths, and renders the application's own page.
- **`npx tsc --noEmit`** (the repository's `typecheck` script): exit 0.
- **`npm test`**: 455 tests, 454 passed, 1 skipped, 0 failed, 2 suites, 1.68 s. Reproduces the Codex figure exactly. The suite is pure unit code, no test file touches the database client, so no contention with other agents on `corgi_test` was created.
- **Secret scan.** `gitleaks git --log-opts` is refused by this worktree-isolated sandbox. Scanned the content instead: `gitleaks dir` over the merge's non-image diff patch plus the full `app/`, `components/`, `docs/illustrations/` and `docs/reviews/` trees at `08b3678`, 3.09 MB, **no leaks**. The staged content of both commits in this review was scanned again before each commit (50,996 bytes and 6,576 bytes), no leaks, and the repository pre-commit hook ran its own scan.
- **`git diff --cached --check`** before each commit: clean.
- **Asset audit.** All 150 files counted and sized on disk (19,727,540 bytes). All 13 mapped entries compared against `catalog.json` and against the files: 13 of 13 agree. Three unreferenced files fetched from the deployment: 200 each.

## The Codex records, claim by claim

| Claim in the Codex records | This review |
|---|---|
| Pages verified at three widths, document width equals viewport | **Holds, and extended.** Codex measured 9 route states at 375, 768, 1440. Reproduced and widened to 29 route states at 375, 768, 1280: 87 of 87 equal. |
| No illustration inside tables, journal, approvals, breaks, console | **Holds.** 0 `table img` on all 29 routes; policy journal, approvals queue, claim detail, published statement and all console screens have zero images at all. |
| Every image decorative, `alt=""` | **Holds.** 13 of 13 in the live DOM. |
| Thirteen map entries match the catalog and the decoded assets | **Holds.** 13 of 13 on file name, width, height and bytes. |
| Sandbox sentence and provider mode labels unchanged and visible | **Holds.** Sentence on `/` and `/login` at three widths; `LIVE SANDBOX` and `LOCAL SIMULATOR` present on reconciliation, `LOCAL SIMULATOR` on `/ops` and `/ops/approvals`, `LIVE SANDBOX` in the console markup. |
| At most one banner and one empty illustration per page | **Holds.** Maximum observed is 2 images on one page (`/broker`, `/customer`). |
| Restrained sizing, banner capped at 220 px | **Holds as CSS, and that is the problem.** The box is 220 px; the file behind it is up to 3456 px and 694 KB. F-IL-01. |
| "Loading strategy: PASS. Lazy by default, home, login and error/404 feedback explicitly eager" | **Source-true, deployed behaviour not supported.** The eager choice makes React preload the 404 image on every route and the home image on the 404 page. F-IL-02. Codex did not measure transferred bytes; its browser evidence is geometry and screenshots. |
| The two operations touches are empty states only (assignment premise, echoed by the record) | **Does not hold.** Four operations screens carry illustrations and two of them carry an always-visible banner. Placement is still clean. F-IL-07. |
| `npm run typecheck` exit 0 | **Reproduced.** Exit 0. |
| `npm test` 455 total, 454 passed, 1 skipped, 0 failed | **Reproduced exactly.** |
| `npm run build` exit 0, 34 static pages | **Not reproduced.** Not rerun here: the build needs the deployment database credentials and would have queried the trial database from a review worktree for no added assurance, since the reviewed revision is already built and live. |
| `gitleaks` on the commit range, no leaks | **Not reproduced as stated, reproduced in substance.** `gitleaks git` is refused by this sandbox; the same content was scanned with `gitleaks dir`, 3.09 MB, no leaks. |
| Seven demo accounts walked | **Not claimed by the record.** The Codex record states "existing synthetic staff session, read-only navigation". This review signed in as all seven and confirmed each role home renders. |
| 150 assets, provenance, hashes, Krea2 workflows, 3x panorama upscales | **Not reproduced.** Out of scope here and covered by `illustration-library.md`; the byte count (19,727,540) and the 13 used entries were independently confirmed. |
| No business action performed by the reviewer | **Holds for this review too.** GET requests plus seven login POSTs, nothing else. |

## Automatic-fail mapping, scoped to this diff

| Ban | Scoped result |
|---|---|
| AF-01 accessible deployed URL | **PASS for this scope, and this is the first illustration review to check it.** The reviewed revision was served from `https://corgi-work-trial-iota.vercel.app`, 29 routes and 7 accounts exercised from outside the development session. This is not the final delivery gate. |
| AF-02 simulation presented as live | **PASS.** No mode label was removed, hidden or contradicted; both labels verified in the live DOM. No illustration asserts a state. F-IL-04 is a code-vocabulary point, not a user-facing claim. |
| AF-03 UPDATE or DELETE money rows | **PASS for isolation.** The diff touches no file under `lib/`, `db/`, `scripts/` or `app/api/`; no SQL, no ORM call, no money arithmetic. Runtime ledger guards NOT RUN here, and unchanged. |
| AF-04 sandbox only, no real data | **PASS for the reviewed content and for this reviewer's actions.** Synthetic drawings only. Read-only navigation on sandbox data, no provider call, no spend, no identity submitted. |
| AF-05 committed secrets | **PASS for the inspected scope.** No leak in 3.09 MB of changed content, nor in either staged commit. `DEMO_PASSWORD` was loaded through `process.loadEnvFile` and never printed. Not a whole-history certification. |
| AF-06 explain every line | **NOT RUN.** The new code has a short reading path, which is an engineering observation, not confirmation that Yoann can defend it. |

## Not verified

- The **empty states of `/ops/claims`, `/ops/policies`, `/ops/reconciliation` (never run), `/ops/statements`, `/broker`, `/customer` and the policy claims panel** were not seen on the deployment, because production holds claims, policies, runs and statements. They were read in the source and their layout follows the same `.panel-empty-state` grid that was measured live on `/inbox` and `/broker`. Their rendered geometry is source-derived, not measured.
- The **error boundary** was not triggered on the deployment (see above). Verified by source and static render only.
- **No LCP, no throttled network, no Lighthouse.** The weight figures are transferred bytes, not a rendering-speed measurement.
- **No full WCAG audit.** Contrast, focus order and keyboard traps outside the illustration markup were not assessed.
- **`npm run build`** not rerun, reason above. **The 150 assets' provenance** not re-derived.
- **Every role and data permutation** was not walked; 29 route states across 5 principals were.

## Verdict

**FAIL for the illustration integration at `08b3678d820e8b7d99caebe11f9e610497a05260`, limited to F-IL-01 and F-IL-02.**

Everything the ticket set out to protect holds, and holds under measurement rather than under source reading: no illustration on a journal, a queue, a money table, a breaks table, statement figures or the console; every image decorative with an empty alt; both integration-mode labels and the sandbox sentence intact and readable; no horizontal scroll in 87 measurements across 29 routes and 3 widths; no financial file touched; typecheck and tests reproduced. The new code is short, explicit and safe against a missing file.

It fails on weight, and only on weight. Four screens deliver 500 to 744 KB of decoration where the stylesheet asks for a 220 px picture, identically on a phone and on a desktop, and a further 40.6 KB is fetched on every screen in the application including those that display nothing, with 461 KB fetched and discarded on every 404. Both corrections are small: point four banner entries at downscaled files, and remove three `eager` props. Neither touches a money path, so unrelated work is not blocked, and neither is an automatic fail. If the freeze makes the fix unattractive, the honest alternative is Yoann's explicit call recorded in `DECISIONS.md` and the cost disclosed in the README, not a silent PASS.

The five LOW findings are open and none of them blocks.

**Walkthrough status: NOT REVIEWED WITH YOANN.** No agent can confirm his understanding on his behalf.

This is a scoped engineering assessment of a presentation slice. It is not a legal certification, not an approval of the financial system, the provider integrations or the remaining trial criteria, and not the final integrated gate.

## Proposed register lines

For the coordinator to add to `docs/reviews/FINDINGS.md`; this reviewer does not edit shared files.

| ID | Sev | Finding (one line) | Fix | Status |
|---|---|---|---|---|
| F-IL-01 | MEDIUM | Four banner panoramas ship at 3456 or 4032 px and 472 to 694 KB into a 220 px CSS box, with no srcset, so /broker 743.6 KB, /customer 691.0 KB, /ops 524.5 KB and / 500.6 KB of decoration, identical at 375 px and 1280 px | Point the four banner entries at 440 px variants, or add a srcset | OPEN |
| F-IL-02 | MEDIUM | The eager 404 illustration makes React preload 40,640 B on all 29 routes including screens that show no image, the 404 also pulls the home banner's 471,938 B it never shows, and /login at 375 px fetches 104,334 B that display:none hides | Drop eager from not-found, error and the login art panel | OPEN |
| F-IL-03 | LOW | 137 of the 150 committed WebPs (about 19.1 MB) plus three older files are referenced by nothing; they are served but never fetched, so the cost is clone, build and deploy size only | Keep the 13 used files in public/, hold the library elsewhere, or disclose | OPEN |
| F-IL-04 | LOW | app/ops/reconciliation/page.tsx:118 uses the key "all-clear" for the state where no reconciliation has ever run, which is the opposite claim; no user-visible false statement, the sentence beside it is exact | Give the never-run branch a neutral key | OPEN |
| F-IL-05 | LOW | components/decorative-illustration.tsx retypes 13 file names and 26 dimensions from catalog.json with nothing checking the two agree (13 of 13 correct today) | A unit test reading catalog.json, or import it | OPEN |
| F-IL-06 | LOW | IllustrationBanner emits the class illustration-banner, which has no rule anywhere in app/globals.css | Remove the class or give it its rule | OPEN |
| F-IL-07 | LOW | Record accuracy: four operations screens carry illustrations, not two, and /ops and /ops/statements carry an always-visible banner; measured placement is nevertheless clean | Correct the count in the records | OPEN |
