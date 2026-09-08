# Corgi illustration library

Status: **150 of 150 accepted and exported**. This branch contains decorative artwork only; it changes no application, provider, database, ledger or financial behavior.

## Production record

- Branch: `codex/corgi-illustrations`.
- Generator: Krea2 Turbo through the installed ComfyUI workflow on Yoann's DGX Spark.
- Background removal: the installed BiRefNet workflow on the same Spark.
- Families: 70 monochrome editorial illustrations, 60 painted corgi characters and 20 pastoral panoramas.
- Formats: 60 square `1024 x 1024`, 40 landscape `1152 x 768`, 40 portrait `768 x 1024` and 10 wide `1344 x 576` WebP files.
- Final files: `public/illustrations/library/<id>.webp`.
- Metadata: `collection-plan.json`, `reviews.json` and `catalog.json`.

The collection contains 150 unique IDs, 150 unique names and 150 unique final file hashes. Each catalog entry records its prompt, seed, model, generation job, accepted attempt, dimensions, file path, byte count and SHA-256 hash.

## Generation review and retries

Every candidate was visually inspected. Ten plan items failed their first visual review and were regenerated rather than accepted:

- attempt 2: `005-sealed-envelope`, `007-magnifying-glass`, `010-compass`, `019-open-ledger`, `022-coin-return`, `035-broken-link`, `128-corgi-stretching` and `129-corgi-partner-pair`;
- attempt 3: `024-receipt-roll` and `109-corgi-curious`.

The discarded `131-meadow-path-pilot` remains in `reviews.json` as a rejected trace record. It is not a plan item, catalog entry or exported illustration. The accepted `131-meadow-path` is a separate corrected generation.

## Export and alpha review

All 150 accepted files were opened through Pillow and checked against their planned dimensions, catalog byte counts and SHA-256 hashes. All final hashes are distinct.

The 130 non-panorama images were also processed through the Spark background-removal workflow. Each proposed transparent export was composited on a mid-tone background for visual review. BiRefNet preserved the complete subject in 96 cases; those final WebPs retain RGBA transparency with zero-opacity corners and a contained nonempty alpha bounding box.

Thirty-four pale or fine-detail compositions use the complete opaque original because background removal erased a meaningful object or could not separate the subject from white. Examples include pale paper, books, a cloud, a shield, a phone, a map and the handle of a magnifying glass. This is an intentional quality fallback, recorded as `unusable` in the ignored local alpha state and as `backgroundRemoval: null` in the catalog. The 20 panoramas are intentionally opaque.

Final visual QA covered:

- all raw candidates at original resolution during selection;
- all 150 accepted exports on the standard contact sheets;
- all 96 retained transparent exports on a mid-tone background;
- all 34 opaque cutout fallbacks as complete compositions;
- all 20 panoramas in one final comparison sheet.

The machine-readable final audit is kept locally at `.local/illustration-jobs/final-audit.json`; raw generations and QA sheets stay ignored because they are production evidence and working material, not application assets.

## Verification checkpoint

The final audit currently reports: 150 planned, 150 cataloged, 150 files, 150 accepted current attempts, 150 unique IDs, names and hashes, 96 transparent cutouts, 34 opaque cutout fallbacks and 20 panoramas. The independent feature review is the remaining completion gate before the final commit.
