# Illustration library implementation review

## Initial review: FAIL

- Reviewer: independent Codex subagent `/root/ui_review`; no implementation or generation performed by this reviewer.
- Timestamp: 2026-09-08T22:42:07Z (September 9 locally).
- Branch/worktree: `codex/corgi-illustrations`, `.worktrees/corgi-illustrations`.
- Exact revision: `824ed34979c07a90d5c7c8f5e1779835288f54cd`, against parent `333f73ff44f6e70c0f8ad2618ab6021da3eadb1c`. The assignment initially mistyped the short SHA as `824ed34e`; Git resolution and coordinator confirmation corrected it before review. Initial working tree was clean.
- Scope: the complete decorative collection, including the five pilot exports introduced by the parent. The target commit changes 151 paths: five illustration documentation/JSON files and 146 WebPs. The complete collection contains 150 WebPs. No application integration is included.

### Startup receipt and applicability

Actual reads: `AGENTS.md`, `AUTOMATIC-FAILS.md` in full (all six bans), `READABLE-CODE.md`, `WORKFLOW-48H.md`, `REVIEWER.md`, repository `README.md`, and all of `docs/BRIEF-REFERENCE.md`. Also read `docs/PLAN.md`, `docs/COMPLIANCE-MATRIX.md`, scope-relevant current and historical entries in `docs/STATUS.md` and `docs/DECISIONS.md`, and all of `docs/illustrations/README.md` and `PROGRESS.md`. Fully parsed `collection-plan.json`, `reviews.json` and `catalog.json`, checked every entry's identity/provenance fields, and read all subject/name/usage/current-review rows. Inspected the parent commit and the complete target path/diff inventory, JSON field changes and documentation diff. No mandatory file was missing. Shared records remain read-only; this asset extension is defined by the user's assignment and collection plan, not a newly invented official trial criterion.

Local evidence actually read: generation state, alpha state, final audit, workflow template, retry log, and complete `generate.py`, `alpha-worker.py` and `catalog.py` under ignored `.local/illustration-jobs`. After context compaction the operating instructions, automatic fails, workflow, reviewer procedure and current status were reread. No secret environment files were opened.

Next acceptance criterion was a complete, traceable, visually usable set of 150 distinct compositions. Planned checks were relational and decoding checks over every export, scope/history secret checks, every final sheet, and individual source comparisons for doubtful details. Biggest risk was destructive background removal. The official September 10 05:50Z freeze remains a separate integrated delivery gate.

This is decorative bitmap data and generation documentation for Track 1. It introduces no customer, account, rail, financial record, API, webhook, SQL, worker execution path or provider mode in the application. Financial/provider legal research and transaction execution tests are therefore not applicable to this diff; no production legal conclusion is made. Applicable sources are the user assignment/collection plan and the repository's engineering/automatic-fail safeguards, read September 8 and 9, 2026. Original-generation provenance is supported by local records, not by independent remote attestation of the physical machine or model internals.

### Requirement → control → evidence

| Requirement | Control/location | Independent evidence | Result |
|---|---|---|---|
| Exactly 150 named compositions | Collection plan, catalog, library | 150 plan items, catalog entries, exported WebPs, unique IDs, unique names and unique SHA-256 values; identical ID sets | PASS |
| Planned dimensions and readable files | Catalog dimensions and WebP export | Pillow fully decoded all 150; all byte counts/hashes/dimensions agree | PASS |
| Current accepted attempt for every item | Reviews/catalog/generation-state | All 150 current reviews accepted and attempt numbers match current generated attempt; catalog generation records equal the recorded final attempts | PASS for record consistency; visual acceptance corrected below |
| Correct family/format mix | Plan and catalog | Ink 70, painted 60, panorama 20; square 1024×1024 60, landscape 1152×768 40, portrait 768×1024 40, wide 1344×576 10 | PASS |
| Local original generation, not reference republication | Raw PNG workflow metadata, state and exporter | All 150 source hashes verified; all source PNGs carry ComfyUI graphs with the named Krea2 model, matching prompt/seed/8 steps/dimensions, and no LoadImage input node; text-to-latent workflow and separate BiRefNet path inspected | PASS within recorded provenance limits |
| Retries and rejected pilot excluded | State attempts, current reviews, plan/catalog | Ten planned IDs have recorded retries; rejected `131-meadow-path-pilot` is only an extra rejected review and absent from plan/catalog/exports | PASS; documentation precision finding ILL-02 |
| Recognizable, coherent, complete final compositions | Final exports and visual QA | All 24 sheets inspected; one confirmed alpha-removal defect on 067 | FAIL, ILL-01 |
| Preserve pale props with opaque fallback | Alpha state and catalog export selection | 33 non-panorama opaque fallbacks preserve companion objects; 97 transparent exports and 20 opaque panoramas; one further fallback needed | FAIL, ILL-01 |
| Changes remain in asset scope; no secrets | Git paths, history scan | All changed paths restricted to `docs/illustrations/` and `public/illustrations/library/`; Gitleaks two-commit scan found no leaks | PASS, scoped |

### Findings

**ILL-01, MEDIUM, material: the Corgi Search cutout removes the magnifying-glass handle.** In `public/illustrations/library/067-corgi-search.webp`, the round lens survives but its handle is entirely transparent. On a composited background the object reads like a bowl, losing the search motif. The original `.local/illustration-jobs/candidates/067-corgi-search-v1.png` contains a complete, clear handle. Independently comparing the original dark pixels in rectangle `(405,520)-(505,550)` found 1,869 dark source pixels, all with final alpha zero. The whole final rectangle has alpha range `(0,0)`. This is visible in `final-visual-audit/transparent-04.jpg`; a viewer displaying hidden RGB without correctly compositing transparency can conceal the defect. Required fix: export the intact opaque original or a corrected mask, update its catalog/background-removal record and counts, and refresh the affected visual evidence. Do not retain the current blanket acceptance as proof that this final cutout is intact.

**ILL-02, LOW: README overstates historical review retention.** The `reviews.json` description says it contains a decision for every generated attempt retained in the production record. It actually contains one latest accepted decision per planned ID plus one rejected pilot. The generation state retains previous attempts and their job/source/hash records, but not their individual historical rejection decisions/reasons. Required correction: describe these separate records accurately, or preserve available real historical reviews without inventing or backdating evidence. Retry existence is independently supported despite this wording problem.

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

## Re-review: corrected export and documentation

Timestamp: 2026-09-08T22:46Z. Same independent reviewer and scope. Exact reviewed correction: `52149d2d90fd43c01f7af3e5cb39cf1f25a0984f`, parent `824ed34979c07a90d5c7c8f5e1779835288f54cd`. Read the complete correction diff: README, PROGRESS, the 067 catalog entry, the 067 WebP and the preserved initial review. No application path changed. Previous evidence is reused only for unchanged assets and source-generation records.

- **ILL-01 resolved.** The final 067 export is now an opaque RGB image containing the complete magnifying glass and handle. Independently viewed the actual final WebP at full size, refreshed `contact-sheets/sheet-06.jpg` and `final-visual-audit/opaque-fallback-01.jpg`. The composition is intact. Its final SHA-256 is `98f2e7f8af001863eae413cb4800f9a8703946b0aa2a6986b519d73310e6fb4d`, size 40,640 bytes. Independently re-encoding the recorded original PNG in memory with the documented Pillow WebP settings (`quality=94, method=6`) reproduced that hash exactly. Catalog `backgroundRemoval` is null and local alpha state records the damaged mask as unusable.
- **ILL-02 resolved.** README now accurately describes the 150 current decisions and rejected pilot record. It no longer claims a historical rejection decision exists for every generation attempt.
- Repeated Python/Pillow verification over the current 150 exports: all decode, dimensions/bytes/SHA-256 match, IDs/names/hashes remain unique, plan/catalog ID sets agree, each current accepted review and generation attempt agrees with local state, and rejected pilot remains excluded. Compared old/current catalog entries: only 067 changed. Counts are now **96 transparent cutouts, 34 opaque cutout fallbacks and 20 panoramas**, total **11,337,212 bytes**; family and dimension counts remain unchanged. The refreshed local final-audit JSON agrees with these independently obtained results.
- Additional provenance check completed: independently re-encoded all 150 original-review selected raw/alpha sources in memory with the documented WebP settings and compared against the catalog snapshot loaded before the correction: **150 checked, zero hash mismatches**. Combined with the separate byte-exact corrected 067 check and the unchanged other 149 entries, every current final export is reproducible from its recorded selected source. No image artifact was edited by the reviewer.
- `git diff 824ed34 HEAD --check`: PASS. `gitleaks git --redact --no-banner --no-color --log-opts='824ed34979c07a90d5c7c8f5e1779835288f54cd..52149d2d90fd43c01f7af3e5cb39cf1f25a0984f'`: exit 0, one commit, approximately 13,551 bytes, no leaks at 22:45Z. Together with the earlier two-commit scan this covers the three illustration commits, not unrelated repository history.

**Final verdict: PASS for the 150-piece decorative library at `52149d2d90fd43c01f7af3e5cb39cf1f25a0984f`.** Both findings are closed; no unresolved material issue remains in this scope. The visual/composition and fallback rows in the matrix now pass. The original FAIL remains above as history. AF mappings and exclusions remain unchanged: this does not approve application integration, a deployed trial, live sandbox flows, legal compliance or Yoann's understanding. The coordinator must perform the normal staged scan when committing this append.

## Re-review: twenty panorama exports at threefold dimensions

Reviewer: independent Codex subagent `/root/ui_review`. Timestamp: 2026-09-09T06:51:45Z. Exact revision: `e4ee798b89abee15a3fa26d54694781930ae7658`, parent `ee61e0f3aeed7e8def21026dd3659701522e272a`. Worktree and branch remain `.worktrees/corgi-illustrations`, `codex/corgi-illustrations`; initially clean. Scope is only the 20 panorama WebPs 131 to 150 and four files under `docs/illustrations/`: plan, catalog, README and PROGRESS. Prior findings and verdicts above are preserved.

### Fresh startup receipt

Actually reread in this review: full `AGENTS.md`, `AUTOMATIC-FAILS.md` including all six bans, `READABLE-CODE.md`, `WORKFLOW-48H.md`, `REVIEWER.md`, repository README, all `docs/BRIEF-REFERENCE.md`, PLAN, COMPLIANCE-MATRIX, relevant latest STATUS/DECISIONS entries, and this complete existing review. No mandatory file was missing. Read the exact documentation diff; parsed and compared the full old/new plan and catalog. Read ignored `upscale-panoramas.py`, `export-panorama-upscales.py` and all 20 records in `panorama-upscale-state.json`, and inspected every output PNG's embedded workflow. Shared records were not edited.

Acceptance criterion: exactly triple both dimensions of each existing panorama, preserve its composition/aspect ratio, retain provenance and leave the other 130 assets and application untouched. Biggest risk was an unnoticed crop or incorrect source selection. Planned checks: full collection decode/hash/metadata audit, byte comparison of unaffected assets, all 20 workflow/source/output checks, independent pixel comparison, all five supplied panorama QA sheets and a history secret scan. At this receipt the September 10 05:50Z final trial freeze remains about 23 hours away and outside this asset approval.

Applicability is unchanged: decorative synthetic scenes, no financial/customer/account records, no application execution or provider integration introduced. The user-requested asset enhancement and repository evidence safeguards govern this bounded scope; it is not an additional official financial requirement or legal certification. Current governing repository sources were checked September 9, 2026; no new legal/provider research was necessary for an image-size-only diff.

### Requirement/control/evidence

| Requirement | Control and independent evidence | Result |
|---|---|---|
| Exactly 20 panorama changes, 130 untouched | Exact 24-path Git diff; all other 130 WebPs compared byte-for-byte against parent Git blobs, and their complete catalog/plan entries compared for equality | PASS |
| Exactly 3× and preserved aspect ratios | Ten 1344×576 originals now 4032×1728; ten 1152×768 originals now 3456×2304; exact dimension multiplication and integer cross-product ratio assertions | PASS |
| No cropping/repainting | All 20 PNG workflows contain exactly LoadImage → ImageScale (`lanczos`, `crop: disabled`, correct dimensions) → SaveImage; independently resizing the recorded source with Pillow Lanczos reproduced **all 20 output PNG pixel arrays exactly** | PASS |
| Correct decode, identity and hashes | All 150 current WebPs fully decoded and checked against plan/catalog size, dimensions and SHA-256; 150 unique IDs/names/hashes remain | PASS |
| Traceable Spark job and source | All 20 distinct prompt IDs agree between catalog and local completed state; original-generation SHA-256 and Spark-output PNG SHA-256/bytes independently verified; generation and accepted review records unchanged | PASS within local-record provenance limits |
| Preserved visual quality and coherent composition | Four enlarged-output QA sheets plus final WebP panorama sheet cover every scene; actual final 137 and 146 additionally viewed individually; no new crop, subject damage, text/logo or material artifact identified | PASS |
| Honest metadata/documentation and secret hygiene | Only panorama width/height changed in plan; only width/height/bytes/hash/upscale changed in panorama catalog entries; documentation correctly describes interpolation, counts and pending review; actual scoped history scan below | PASS |

### Commands and actual results

- `git status --short`, `git rev-parse HEAD`, `git log -3 --oneline`, and `git diff HEAD^ HEAD --stat`: confirmed the clean exact revision and 24 changed paths. JSON comparisons used `git show ee61e0f3aeed7e8def21026dd3659701522e272a:<path>`; the 130 non-panorama files were compared directly against the returned Git bytes, not just metadata.
- Executed an inline `python3` audit using `json`, `hashlib`, `subprocess`, Pillow and NumPy. It loaded all current/parent entries; asserted counts, uniqueness, all file hashes/bytes/dimensions, allowed changed fields, 130 byte-identical files, 20 unique completed jobs, original/output hashes and embedded three-node workflow settings. It independently computed `raw.resize(upscaled.size, Image.Resampling.LANCZOS)` and compared the result with every Spark PNG pixel array: **20/20 exact**, maximum difference zero.
- The same audit downsampled each Spark PNG with Lanczos to its original dimensions, then calculated absolute per-channel differences on signed 16-bit arrays: mean range **0.196893 to 0.369783**, maximum 99th-percentile difference **3**. This independently reproduces the PROGRESS claim. Repeated the comparison using the **delivered WebPs**, including lossy compression: mean range **0.729019 to 0.853973** on the 0 to 255 scale. No source/composition mismatch was found. These are fidelity measurements, not a claim of new generative detail or lossless WebP encoding.
- Current collection: **60×1024×1024, 30×1152×768, 40×768×1024, 10×4032×1728, 10×3456×2304**; **19,727,540 bytes total**, including **11,303,802 bytes for the panoramas**. All 20 panoramas remain opaque RGB. Other assets and their 96-transparent/34-opaque split are unchanged.
- Visually opened `.local/illustration-jobs/panorama-upscaled-qa/panoramas-3x-01.jpg` through `panoramas-3x-04.jpg` and `.local/illustration-jobs/final-visual-audit/panoramas.jpg`. Also opened `public/illustrations/library/137-forest-clearing.webp` and `146-garden-gate.webp` individually. Painterly detail remains naturally soft, compositions retain their boundaries and focal corgis, and the enlargement adds no new objects or text.
- `git diff ee61e0f3aeed7e8def21026dd3659701522e272a e4ee798b89abee15a3fa26d54694781930ae7658 --check`: PASS.
- `gitleaks git --redact --no-banner --no-color --log-opts='ee61e0f3aeed7e8def21026dd3659701522e272a..e4ee798b89abee15a3fa26d54694781930ae7658'`: exit 0, one commit, approximately **15,745 bytes scanned**, no leaks at 06:51Z. Scope excludes unrelated history; final staged scanning of this append remains coordinator-owned.
- NOT RUN: application build/unit/integration/deployment/browser-performance checks, provider/network generation calls and Yoann walkthrough. No executable app change exists and no page integrates these new dimensions in this diff. No generation/helper script was executed; the reviewer performed read-only file analysis and wrote only this report.

### Findings, AF mapping and verdict

No new material finding. ILL-01 and ILL-02 remain resolved; their original FAIL history remains above. Residual limitations: Lanczos creates a larger raster by interpolation, not new scene detail. The larger files increase download/decode cost; screen placement, responsive delivery and performance must be assessed when the interface owner integrates them. Local PNG workflow/state evidence supports the recorded Spark provenance but is not independent physical-machine attestation. Ignored generation/export helpers were inspected as evidence, not approved as a supported rerunnable delivery pipeline.

AF-01: **NOT RUN** (deployment). AF-02: **PASS scoped claims**, with financial live-sandbox verification **NOT RUN**; this change accurately describes interpolation and no financial integration. AF-03: **PASS scope isolation**, application/SQL/money paths byte-unchanged; integrated ledger checks **NOT RUN**. AF-04: **PASS reviewed data/actions** (same synthetic scenes, no personal data or financial/provider operation). AF-05: **PASS scoped commit scan and path inspection**, not global secret absence. AF-06: **NOT RUN / NOT REVIEWED WITH YOANN**. No scoped PASS waives any final trial gate.

**Verdict: PASS for the panorama enlargement at `e4ee798b89abee15a3fa26d54694781930ae7658`.** Together with unchanged prior evidence, the 150-piece asset library remains approved within its decorative scope. No application integration, deployment, financial behavior, general compliance or candidate-understanding approval is implied.
