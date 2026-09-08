# Corgi decorative illustration library

Work in progress: target 150 distinct original illustrations, generated on the user-owned DGX Spark with the installed Krea2 Turbo model. Cutout variants use the installed BiRefNet model on the same machine. WebP exports live in `public/illustrations/library`; a format variant never counts as a second illustration.

`collection-plan.json` contains all named subjects, families, intended uses, dimensions and prompts. `reviews.json` records actual visual acceptances and rejections. `catalog.json` contains only accepted available exports with generation provenance and file hashes. `PROGRESS.md` records the current production state. A generated candidate is not automatically accepted.

Visual direction is based on the user-provided public Corgi assets: [coverage collage](https://app.corgi.insure/images/coverages/epl.png), [leadership](https://app.corgi.insure/images/coverages/do.png), [general liability](https://app.corgi.insure/images/coverages/cgl.png), [cyber](https://app.corgi.insure/images/coverages/cyber.png), [technology](https://app.corgi.insure/images/coverages/tech-eo.png), and the painted corgi characters and pastoral footer at [Corgi](https://www.corgi.insure/). References guide style; the outputs are new compositions, not republished source assets.

Use cutouts with `object-fit: contain` and retain enough space for ears, paws and object edges. Use panoramas in wide decorative areas, preserving their quiet sky and horizon. These are decoration, not financial status evidence; meaningful empty-state messages and actions remain normal HTML. Use empty alternative text when the adjacent UI already supplies meaning.

No application code, business behavior, live provider integration or deployment is changed by this asset branch. Final collection count, individual quality review and export verification remain pending.
