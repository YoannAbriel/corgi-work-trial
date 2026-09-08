# Illustration library implementation review

## Initial review — FAIL

- Reviewer: independent Codex subagent `/root/ui_review`; no implementation or generation performed by this reviewer.
- Timestamp: 2026-09-08T22:42:07Z (September 9 locally).
- Branch/worktree: `codex/corgi-illustrations`, `.worktrees/corgi-illustrations`.
- Exact revision: `824ed34979c07a90d5c7c8f5e1779835288f54cd`, against parent `333f73ff44f6e70c0f8ad2618ab6021da3eadb1c`. The assignment initially mistyped the short SHA as `824ed34e`; Git resolution and coordinator confirmation corrected it before review. Initial working tree was clean.
- Scope: the complete decorative collection, including the five pilot exports introduced by the parent. The target commit changes 151 paths: five illustration documentation/JSON files and 146 WebPs. The complete collection contains 150 WebPs. No application integration is included.

### Startup receipt and applicability

Actual reads: `AGENTS.md`, `AUTOMATIC-FAILS.md` in full (all six bans), `READABLE-CODE.md`, `WORKFLOW-48H.md`, `REVIEWER.md`, repository `README.md`, and all of `docs/BRIEF-REFERENCE.md`. Also read `docs/PLAN.md`, `docs/COMPLIANCE-MATRIX.md`, scope-relevant current and historical entries in `docs/STATUS.md` and `docs/DECISIONS.md`, and all of `docs/illustrations/README.md` and `PROGRESS.md`. Fully parsed `collection-plan.json`, `reviews.json` and `catalog.json`, checked every entry's identity/provenance fields, and read all subject/name/usage/current-review rows. Inspected the parent commit and the complete target path/diff inventory, JSON field changes and documentation diff. No mandatory file was missing. Shared records remain read-only; this asset extension is defined by the user's assignment and collection plan, not a newly invented official trial criterion.

Local evidence actually read: generation state, alpha state, final audit, workflow template, retry log, and complete `generate.py`, `alpha-worker.py` and `catalog.py` under ignored `.local/illustration-jobs`. After context compaction the operating instructions, automatic fails, workflow, reviewer procedure and current status were reread. No secret environment files were opened.

Next acceptance criterion was a complete, traceable, visually usable set of 150 distinct compositions. Planned checks were relational and decoding checks over every export, scope/history secret checks, every final sheet, and individual source comparisons for doubtful details. Biggest risk was destructive background removal. The official September 10 05:50Z freeze remains a separate integrated delivery gate.

This is decorative bitmap data and generation documentation for Track 1. It introduces no customer, account, rail, financial record, API, webhook, SQL, worker execution path or provider mode in the application. Financial/provider legal research and transaction execution tests are therefore not applicable to this diff; no production legal conclusion is made. Applicable sources are the user assignment/collection plan and the repository's engineering/automatic-fail safeguards, read September 8–9, 2026. Original-generation provenance is supported by local records, not by independent remote attestation of the physical machine or model internals.

### Requirement → control → evidence

| Requirement | Control/location | Independent evidence | Result |
|---|---|---|---|
| Exactly 150 named compositions | Collection plan, catalog, library | 150 plan items, catalog entries, exported WebPs, unique IDs, unique names and unique SHA-256 values; identical ID sets | PASS |
| Planned dimensions and readable files | Catalog dimensions and WebP export | Pillow fully decoded all 150; all byte counts/hashes/dimensions agree | PASS |
| Current accepted attempt for every item | Reviews/catalog/generation-state | All 150 current reviews accepted and attempt numbers match current generated attempt; catalog generation records equal the recorded final attempts | PASS for record consistency; visual acceptance corrected below |
| Correct family/format mix | Plan and catalog | Ink 70, painted 60, panorama 20; square 1024×1024 60, landscape 1152×768 40, portrait 768×1024 40, wide 1344×576 10 | PASS |
| Local original generation, not reference republication | Raw PNG workflow metadata, state and exporter | All 150 source hashes verified; all source PNGs carry ComfyUI graphs with the named Krea2 model, matching prompt/seed/8 steps/dimensions, and no LoadImage input node; text-to-latent workflow and separate BiRefNet path inspected | PASS within recorded provenance limits |
| Retries and rejected pilot excluded | State attempts, current reviews, plan/catalog | Ten planned IDs have recorded retries; rejected `131-meadow-path-pilot` is only an extra rejected review and absent from plan/catalog/exports | PASS; documentation precision finding ILL-02 |
| Recognizable, coherent, complete final compositions | Final exports and visual QA | All 24 sheets inspected; one confirmed alpha-removal defect on 067 | FAIL — ILL-01 |
| Preserve pale props with opaque fallback | Alpha state and catalog export selection | 33 non-panorama opaque fallbacks preserve companion objects; 97 transparent exports and 20 opaque panoramas; one further fallback needed | FAIL — ILL-01 |
| Changes remain in asset scope; no secrets | Git paths, history scan | All changed paths restricted to `docs/illustrations/` and `public/illustrations/library/`; Gitleaks two-commit scan found no leaks | PASS, scoped |

### Findings

**ILL-01 — MEDIUM, material: the Corgi Search cutout removes the magnifying-glass handle.** In `public/illustrations/library/067-corgi-search.webp`, the round lens survives but its handle is entirely transparent. On a composited background the object reads like a bowl, losing the search motif. The original `.local/illustration-jobs/candidates/067-corgi-search-v1.png` contains a complete, clear handle. Independently comparing the original dark pixels in rectangle `(405,520)-(505,550)` found 1,869 dark source pixels, all with final alpha zero. The whole final rectangle has alpha range `(0,0)`. This is visible in `final-visual-audit/transparent-04.jpg`; a viewer displaying hidden RGB without correctly compositing transparency can conceal the defect. Required fix: export the intact opaque original or a corrected mask, update its catalog/background-removal record and counts, and refresh the affected visual evidence. Do not retain the current blanket acceptance as proof that this final cutout is intact.

**ILL-02 — LOW: README overstates historical review retention.** The `reviews.json` description says it contains a decision for every generated attempt retained in the production record. It actually contains one latest accepted decision per planned ID plus one rejected pilot. The generation state retains previous attempts and their job/source/hash records, but not their individual historical rejection decisions/reasons. Required correction: describe these separate records accurately, or preserve available real historical reviews without inventing or backdating evidence. Retry existence is independently supported despite this wording problem.

The ten retry IDs are 005, 007, 010, 019, 022, 024, 035, 109, 128 and 129. IDs 024 and 109 use attempt 3; the other eight use attempt 2. The 12 preceding generation attempts remain in local generation state/raw candidates with distinct job and source records. Final prompts were changed only for these ten IDs; other plan changes are acceptance status/review markers. The rejected pilot is not a 151st delivered illustration.

### Checks actually executed

- Git branch/status/revision/parent checks, exact diff path and metadata inspection, and `git diff 333f73f HEAD --check`: passed before reviewer edits.
- Python/Pillow full collection checks: passed counts, all relational metadata comparisons, source/final SHA-256, byte sizes, dimensions, file format, decode, unique names/hashes and final attempt selection. Initial export total: 11,341,626 bytes. All 97 alpha exports have transparent corners and nonempty content; these numeric checks do not prove a correct mask.
- All 150 embedded source workflows inspected programmatically for model, prompt, seed, steps, dimensions and absence of reference-image input. The ignored exporter visibly selects the accepted current raw PNG or matching completed alpha variant. No reference asset or application code is committed in either illustration commit.
- `gitleaks git --redact --no-banner --no-color --log-opts='333f73ff44f6e70c0f8ad2618ab6021da3eadb1c^..824ed34979c07a90d5c7c8f5e1779835288f54cd'`: exit 0, two commits, approximately 649,001 bytes, no leaks (22:37Z). Scanner evidence is bounded, not a guarantee of zero secrets everywhere in the repository.
- Visually inspected `contact-sheets/sheet-01.jpg` through `sheet-13.jpg`, `final-visual-audit/transparent-01.jpg` through `transparent-07.jpg`, `opaque-fallback-01.jpg` through `opaque-fallback-03.jpg`, and `panoramas.jpg`: 24 sheets covering all 150 subjects and their delivered transparency/fallback choices. Families are coherent; no other material malformed subject, unwanted text/logo/watermark, crop or duplicate composition was identified at these inspection scales. This is visual judgment, not exhaustive pixel-level certification.
- Individually inspected final 067 and its raw original, final 058/059 and their alpha PNGs. Investigated the small flagpole and kite-string details rather than declaring them missing from thumbnails: sampled source-dark pixels retain alpha ≥128 for 50/70 flagpole pixels and 231/243 kite-string pixels. Those details are small, but no additional material defect was established.
- NOT RUN: app build/unit/integration tests (no executable app change); authenticated flows, provider calls, financial actions, deployment or full accessibility review (outside asset-only scope). No new image was generated, no account interacted with, and no money spent by this reviewer.

### Automatic-fail mapping

| Rule | Scoped assessment |
|---|---|
| AF-01 accessible deployment | NOT RUN. Decorative local assets do not establish an accessible deployed trial. |
| AF-02 simulation presented as live | PASS for this diff's claims: documentation calls this decoration and explicitly disclaims application/live integration changes. Required real financial sandbox evidence is NOT RUN here. |
| AF-03 money-row mutation | PASS for scope isolation: no SQL, ORM, financial row or executable application path is changed. Integrated ledger protection is NOT RUN here. |
| AF-04 sandbox/no real data/$0 | PASS for reviewed asset contents and reviewer actions: synthetic animals/objects/scenes, no real personal/account data or provider credentials, no financial/provider operation. No global sandbox certification. |
| AF-05 committed secrets | PASS for the two illustration commits' inspected paths and actual Gitleaks history result. Final staged scan after this review and any correction remains coordinator-owned. |
| AF-06 candidate understanding | NOT RUN / NOT REVIEWED WITH YOANN. No new application code, but an agent cannot certify the candidate's understanding or final walkthrough. |

**Initial verdict: FAIL** for the exact revision above because of ILL-01. The inventory and provenance checks pass within their stated limits; the collection must not be marked complete until the damaged asset is corrected and independently re-reviewed. Application placement, loading performance in actual screens, final submission/deployment gates and Yoann's walkthrough remain outside this review.
