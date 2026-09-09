# YOA-639 — illustration integration review

Reviewer: independent Codex sub-agent `/root/ui_review`. Implementation review, 2026-09-09, 08:38 UTC. Initial revision: `19e0c43c2c29ece5edbc0da4b68e124674a1139e`. Final reviewed revision: `13b244bae916972f0c35dcded7087df7a99abcf6`, branch `codex/corgi-interface`.

## Startup receipt and scope

Actually read in full: `AGENTS.md`, `AUTOMATIC-FAILS.md` (all six bans), `READABLE-CODE.md`, `WORKFLOW-48H.md`, `REVIEWER.md`, `README.md`, the supplied official brief in `docs/BRIEF-REFERENCE.md`, `docs/PLAN.md`, `docs/STATUS.md`, `docs/DECISIONS.md`, `docs/COMPLIANCE-MATRIX.md`, and `docs/reviews/illustration-library.md`. Read relevant findings and final dispositions in `ui-rebuild.md`, `ui-main-merge.md`, `ui-polish.md`, and `ui-back-controls.md`; these are reused historical context, not newly executed product checks. No mandatory file was missing. Operating instructions, all automatic fails, workflow, reviewer procedure and current status were refreshed after compaction.

Read the `web-design-guidelines` skill and its current [primary guideline source](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md), accessed 2026-09-09. Its decorative-image and responsive-layout guidance supports this presentation review; it does not add a claim of full WCAG compliance.

Next criterion at startup: integrate the accepted decorative library without altering financial behavior, preserve form contracts, and verify containment at 375/768/1440 px. Biggest risk: generic presentation changes affecting money tables or duplicating empty-state art. The initial worktree was clean. Final trial freeze is September 10, 05:50 UTC; this is a bounded review, not that final gate.

Examined the complete diffs of `60179f28905adb9fc1fb5e5c4f10279768c937be`, `bdfafa85b8f3551ee03368b4202607842c53dc53`, `de433512ce4aec23ac0b20276fa1c11bb3fb1422`, `a4bb69efb45763d7f8ba6079593d15d1edddbe2b`, `6dc1c7f1ecf6313dc8e79365de7ed7fdeaea6041`, and `19e0c43c2c29ece5edbc0da4b68e124674a1139e`, each against its parent. Then independently reviewed the CSS-only correction `b00b38d` against `19e0c43` and the single eager-loading prop in `13b244b` against `b00b38d`. Nineteen presentation files are affected in total. The `3f14cdc` merge brings unrelated main work into the integrated application; that work is not attributed to these illustration commits.

## Applicability and evidence

Confirmed: Track 1 policy administration, existing broker/customer/staff roles, USD accounting and existing provider modes. This change renders static local decorative assets and English UI copy. It adds no provider, rail, data collection, financial operation, authorization path or persistence. No new legal or provider obligation is inferred from decorative assets. Existing integration and final-delivery gaps remain governed by the brief and shared records.

| Requirement | Control / location | Independently checked evidence | Result |
|---|---|---|---|
| Presentation-only scope | Nineteen `app/**/*.tsx`, CSS and presentation component paths | Every assigned commit path/diff inspected; no changes to `lib`, `db`, `scripts`, `app/api`, or package files. Those paths also compare equal to the merged main parent (`git diff 3f14cdc^2 HEAD`). | PASS |
| Preserve forms and financial boundaries | Existing server pages and readers; new component is a static typed map plus markup | TypeScript AST comparison of all form/input/button/select/textarea/option/MoneyAmountInput opening tags across 21 changed TSX versions: identical. Actions, methods, names, hidden values, required/min/max and other field attributes remain unchanged. Full diffs preserve server guards, queries, calculations, approval intent and provider labels. | PASS |
| Decorative semantics and valid dimensions | `components/decorative-illustration.tsx` | Single image renderer has `alt=""`; all thirteen map entries match catalog and decoded asset dimensions. No client-side financial logic; importing this pure component from the error boundary introduces no database import. | PASS |
| Restrained sizing | `app/globals.css`, empty/banner/feedback selectors | Empty art capped at 360 px; common banner and login override capped at 220 px after F-ILL-01. Rendered login measured independently; object-fit contain preserves the subject. | PASS after correction |
| At most one banner and one empty illustration | Role homes, inbox, reconciliation, policy views | Enumerated every renderer/call site. Broker/customer policy-empty conditions suppress the WhatNeedsYou illustration; inbox selects only index zero when total waiting is zero; reconciliation alternatives are mutually exclusive; customer policy view returns separately from staff view. Other pages each have at most one call of either kind. | PASS by source branch inspection |
| No illustrations inside sensitive data surfaces | Tables, journal, approvals, breaks, console feed | Source search and complete diff inspection show no such insertion. Actual Statements/Reconciliation/Console DOM has zero images inside tables; populated inbox likewise has none. | PASS |
| Loading strategy | Shared renderer and eager props | Lazy by default. Home, login and error/404 feedback explicitly eager; lower welcome banners lazy. Top-of-page WhatNeedsYou empty art is eager after `13b244b`; other empty illustrations remain lazy. | PASS |
| Honest sandbox copy | `/`, `/login`, existing provider labels | Original sandbox sentence unchanged and observed on both actual routes. Reconciliation still distinguishes Stripe LIVE SANDBOX from claim payout LOCAL SIMULATOR. No provider execution was performed. | PASS for labels only |
| Library integrity | `public/illustrations/library`, catalog | 150 files decode; all dimensions, bytes and SHA-256 values match; 150 unique hashes. Entire directory/catalog byte-identical to independently reviewed `e4ee798`, including twenty 3× panoramas (4032×1728 or 3456×2304). | PASS |
| Responsive containment | Detail grid minmax correction; existing table scroll regions | Nine actual-route measurements below, with screenshots inspected. Document width equals viewport in every case. | PASS |

## Findings and re-review

**Initial verdict at `19e0c43`: FAIL — F-ILL-01, MEDIUM.** `app/globals.css:875` retained `.login-art-panel img { max-width: 350px }`, while the 220 px banner rule applied only inside `.welcome-banner`. Actual login at a 1440 px viewport rendered the new banner image at **350×466.66 px**, exceeding the ticket's explicit limit. Required correction: cover every banner variant, including the login, and center the contained image. This was reported to the implementer; the reviewer did not modify application code.

**Re-review at `b00b38d`: F-ILL-01 resolved.** Read the complete eleven-line CSS addition. The common banner limit plus more-specific login rule now produces a centered **220×220 px box** at both 768 and 1440 px, with `object-fit: contain`, empty alt and loaded 768 px source. At 375 px the existing mobile rule hides the login art panel; document width remains 375. Inspected the actual corrected desktop screenshot: complete proportional corgi, no crop or overflow. Temporary viewport override reset.

**F-ILL-02, LOW, resolved at `13b244b`:** At the initial revision, `components/what-needs-you.tsx:245` left an empty-state image lazy even though this block can be above the fold on a desktop role home. Home/login hero and feedback eager behavior is correct. Eager loading was recommended for this known top-of-page empty state; this was source-observed, not a measured LCP regression. The implementer added the explicit eager prop; the complete one-line diff was independently read, confirming the common renderer emits `loading="eager"`. No data branch or form was changed.

**Advisory F-ILL-03, LOW, inherited layout:** populated Statements/Console tables retain very narrow text columns that split ordinary words at 768/1440 px. Source uses existing global wrapping; these commits do not add that wrapping. Containment works, but readability would improve with appropriate column minimum widths and horizontal scrolling. This does not affect amount values or introduce images into data tables and is not expanded into a redesign gate here.

## Checks actually run

- `npm run typecheck`: exit 0 at initial head and again at `b00b38d` and final `13b244b`.
- `npm test`: 455 tests, 454 passed, 1 opt-in sandbox test skipped, 0 failed; ignored log `.local/illustration-review-tests.txt`. No connected integration scripts were run.
- `npm run build`: exit 0, compiled successfully, TypeScript passed, 34/34 static pages generated; ignored log `.local/illustration-review-build.txt`. This reviewer run preceded the eleven-line CSS fix. The coordinator then rebuilt/restarted the corrected production server, against which the reviewer independently measured the final CSS. The reviewer also reran `npm run build` independently at final `13b244b`: exit 0, log `.local/illustration-review-final-build.txt`; unchanged unit evidence is reused.
- Inline Python/Pillow audit: all 150 WebPs loaded fully; checked catalog sizes/hashes/dimensions, uniqueness, equality to reviewed library revision, twenty panorama sizes and all thirteen component mappings. All assertions passed.
- Inline Node/TypeScript AST audit: identical native form/field/option/button and MoneyAmountInput opening tags over all 21 changed TSX file versions. Full diff review separately covered code paths and source expressions.
- `git diff --check <commit>^ <commit>` for all six initial commits and both corrections: exit 0.
- `gitleaks git --log-opts='60179f2^..13b244b' --redact --no-banner --no-color`: exit 0; fourteen commits / 306.25 KB scanned; no leaks found. This includes intervening merged commits in the bounded history range, not a fresh whole-repository history certification.
- CUA actual Next application on port 4181, existing synthetic staff session, read-only navigation; no form submission, session switch, database mutation or provider action. No secret environment file was opened and no password/cookie was extracted. Inspected screenshots and DOM geometry on Statements, Reconciliation, Console, Operations home, public home, populated inbox, 404 and public login. Some browser commands detached during navigation/resizing; the existing review tab was reacquired and measurements completed. No reference-portal interaction.

| Actual route | 375 px viewport: container/content widths | 768 px viewport | 1440 px viewport |
|---|---|---|---|
| `/ops/statements` | 277/1364 | 670/1280 | 664/1280 |
| `/ops/reconciliation` | 277/948 and 277/722 | 670/880 and 670/670 | 664/880 and 664/664 |
| `/ops/console` | 277/640, 277/892, 277/835 | 670/670, 670/777, 670/671 | 1026/1026, 664/777, 664/671 |

All listed table containers have `overflow-x: auto`; all nine document widths equal the requested viewport. Statements' separate lazy banner is 220×150 px; the populated reconciliation and console pages have no images. Operations' mobile banner is 220×94.28 px. Public home is eager at that same panorama size; 404 uses a loaded, empty-alt feedback illustration. Existing sandbox sentence visible on public home and login.

Not run: authenticated financial journeys, provider calls/webhooks, live eligibility checks, database invariant probes, all role/data permutations in the browser, forced application-error rendering, LCP/network-throttling measurements, full WCAG audit, deployment verification or Yoann's line-by-line walkthrough. Branch inspection covers the unforced empty/error paths; visual checks are not claimed for every possible database state. No testing of unchanged financial paths is invented.

## Automatic-fail mapping and final verdict

| Ban | Scoped result and limitation |
|---|---|
| AF-01 — localhost-only submission / video instead of URL | NOT RUN for deployment. Local review is not a submission or proof of the deployed revision. |
| AF-02 — simulation presented as live | PASS for preservation of honest UI labels. Required real sandbox integration evidence is NOT RUN in this review. |
| AF-03 — UPDATE or DELETE money rows | PASS for change isolation: no SQL, database, financial state or money calculation change. Runtime enforcement and integrated ledger invariants NOT RUN here. |
| AF-04 — live credentials, real money or personal data | PASS for review operations: static assets and existing synthetic sandbox records only; no provider or financial side effect. Whole-application environment enforcement NOT RUN. |
| AF-05 — committed secrets | PASS for inspected bounded implementation diff/history scan. This report is explicitly staged and scanned before its documentation commit. No credential or session value is included. |
| AF-06 — code Yoann cannot explain line by line | NOT RUN WITH YOANN. New code has a short, explicit reading path; that is not confirmation of human understanding. |

**Final verdict: PASS for YOA-639 presentation integration at `13b244bae916972f0c35dcded7087df7a99abcf6`.** Initial material finding F-ILL-01 is resolved with independent source and browser evidence. The inherited LOW table-readability advisory remains visible. This does not approve the financial system, remaining official trial criteria, deployment, provider readiness or candidate walkthrough. No application code was changed by this reviewer.

## Merge re-review — 2026-09-09, 08:43 UTC

Independent reviewer `/root/ui_review`; exact integrated revision **`6370f36bfb05b8ddae05811722e28ab377449df3`**, diff from prior report commit `29af4014dea53c77bacfae55546a24bf7950bbdc`. Startup receipt: reread AGENTS, all six automatic fails, READABLE-CODE, WORKFLOW and REVIEWER; read the new README and STATUS changes and the complete three overlapping source diffs. Unchanged brief, PLAN, DECISIONS, COMPLIANCE and prior review reads above remain applicable (verified no changes). No mandatory file missing; initial worktree clean. Criterion: retain the illustration controls and responsive containment across the main merge. Biggest risk: a shared CSS selector or changed page composition undoing the preceding fixes.

The merge brings 43 changed paths from main, including independent console, reconciliation-reader, correction-form and amount-explanation work. This is **not** a new blanket approval of those features. Inspected the complete path inventory, the three illustration intersections, login API redirect, JournalTable/AmountExplained panel-key changes and console page/table markup affecting the requested containment checks. Relevant integration findings:

- `app/globals.css`: all new rules target `.amount-explain-panel[data-reveal]` descendants (plus its reduced-motion override). No illustration or detail-grid selector changed. The banner/empty limits and both resolved findings survive.
- `app/login/page.tsx`: only the existing-user destination gains the customer branch `/customer`; login API destination agrees. Form action/method/fields and decorative markup are unchanged. No authentication or eligibility grant is added by the destination expression.
- `app/policies/[policyId]/page.tsx`: the sole change adds `panelKey="policy"` to JournalTable. Its entries and claims-empty illustration placement are unchanged. The supporting table diff prefixes entry anchors by panel, and the explanation's default trace key agrees; it adds no image to the journal.
- `git diff 29af401..6370f36 -- public/illustrations/library docs/illustrations components/decorative-illustration.tsx components/what-needs-you.tsx components/detail-layout.tsx components/workspace-overview.tsx` is empty. The previous 150-file decode/hash proof, explicit dimensions, empty alt, eager/lazy choices and cardinality proof remain valid without rerunning identical asset work.

| Requirement / control | New evidence | Result |
|---|---|---|
| Illustration sizing, loading and placement survive merge | Exact intersection diffs and unchanged component/library comparisons above | PASS |
| Form and financial separation of YOA-639 | Login/policy intersection changes inspected; no illustration logic enters a financial path. Unrelated main changes are explicitly outside this approval. | PASS for illustration interaction |
| Table containment remains intact | Actual merged Next application on port 4181: repeated Statements/Reconciliation/Console at 375, 768 and 1440 px; all nine document widths equal viewport, every table wrapper `overflow-x:auto`, no table images | PASS |
| Login banner and sandbox copy | Actual public login at native 1512 px: document 1512, loaded empty-alt eager image 220×220, POST `/api/session/login`, unchanged sandbox sentence, screenshot inspected | PASS |

Console now shows the new integration-mode sentence. Its present two table wrappers measure 277/640 and 277/726 at 375; 670/670 and 670/670 at 768; 1026/1026 and 664/664 at 1440 (container/content). Error rows are absent in this current time window; no assertion is made about a populated errors panel in this rerun. Statements and reconciliation wrapper measurements exactly match the preceding review table. Statements retains its separate 220 px lazy banner; console/reconciliation have zero images. Mobile console screenshot inspected. Temporary viewport override reset; only read-only navigation performed.

Executed again: `npm run typecheck` PASS; `npm test` **455 total, 454 passed, 1 skipped, 0 failed** (`.local/illustration-review-merge-tests.txt`); `npm run build` exit 0 (`.local/illustration-review-merge-build.txt`); `git diff --check 29af401..6370f36` PASS; `gitleaks git --log-opts='29af401..6370f36' --redact --no-banner --no-color` PASS, 25 commits / 179.73 KB, no leaks. Explicitly staged this append-only report and ran staged whitespace/secret checks before committing. No database/provider script, financial action, deployment or push.

**Verdict: PASS for YOA-639 illustration integration at `6370f36bfb05b8ddae05811722e28ab377449df3`.** No new material finding; F-ILL-01/02 remain resolved and inherited LOW F-ILL-03 remains advisory. AF-01 deployment and AF-06 human understanding remain NOT RUN. AF-02 honest presentation, AF-03 illustration change isolation, AF-04 safe review operations and AF-05 bounded history/staged scan remain supported at this scope; underlying financial/provider enforcement and a whole-system AF gate remain outside this re-review. Prior unrun checks and limitations continue to apply. Customer-role login execution and amount-animation behavior were source-checked only, not newly exercised here.
