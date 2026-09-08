# Corgi decorative illustration library

This directory documents 150 named, original illustrations generated on Yoann's DGX Spark for Corgi-style interface decoration and empty states. The collection is complete and its application is intentionally left to the interface owner.

## Library structure

- `collection-plan.json`: the 150 subjects, names, families, UI uses, dimensions, prompts, seeds and model settings.
- `reviews.json`: the accepted or rejected decision for every generated attempt retained in the production record.
- `catalog.json`: the delivery index for the 150 accepted WebP files, including provenance, dimensions, byte count and SHA-256 hash.
- `PROGRESS.md`: generation, retry and QA evidence.
- `public/illustrations/library/<id>.webp`: the final assets.

The catalog is the source to use when selecting an image. A filename and a resized variant never count as another illustration.

## Visual families

| Family | Count | Typical use | Treatment |
|---|---:|---|---|
| `ink` | 70 | Empty tables, unavailable records, verification, documents and operational states | Black editorial stipple and engraving on white or transparent ground |
| `painted` | 60 | Welcomes, role cues, contextual help and warmer empty states | Expressive ginger corgi characters with restrained blue, green, ochre and rust accents |
| `panorama` | 20 | Wide decorative bands, quiet page endings and large empty areas | Soft pastoral landscapes with a small corgi motif and generous visual calm |

The size mix is 60 square `1024 x 1024`, 40 landscape `1152 x 768`, 40 portrait `768 x 1024` and 10 wide `1344 x 576` images.

## Using the assets

Use `object-fit: contain` for cutouts so ears, paws and object edges stay visible. The 97 transparent cutouts can sit on the application's pale surfaces. The 33 opaque cutout fallbacks should be placed on white or warm off-white surfaces; they deliberately preserve pale companion objects that an automatic mask removed. The 20 panoramas are opaque and suit wide crops where their quiet sky and horizon remain visible.

Illustrations are decorative support. Keep empty-state titles, explanations and actions as real HTML. Use an empty alternative text when nearby copy already communicates the state; use concise descriptive alternative text only when the image adds information needed to understand the page.

Example selection code can read `catalog.json` by `usage`, `family`, dimensions or ID. Do not infer financial status from an illustration.

## Generation and provenance

The images were generated with `krea2_turbo_fp8_scaled.safetensors` through ComfyUI on the user-owned DGX Spark. Transparent candidates were processed with the installed BiRefNet model on the same machine. Ten unsatisfactory planned generations were retriggered and only their corrected attempts were exported. Prompts, seeds, job IDs, accepted attempts and source hashes remain attached to each catalog entry.

The direction comes from the public Corgi coverage collages, painted character assets and pastoral footer supplied by Yoann. Those references guided tone, palette and composition. The delivery contains new compositions, no copied Corgi wordmark, no personal account data and no republished reference file.

No application code, business behavior, live integration or deployment is changed by this asset branch.
