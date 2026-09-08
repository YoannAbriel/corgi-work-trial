# Corgi illustration library

Target: 150 distinct named decorative illustrations generated on the user-owned DGX Spark, with failed generations retried and each final image visually inspected. No application behavior changes.

## Startup 2026-09-08T20:27:49.560525+00:00

Branch codex/corgi-illustrations, base 3b34d38. AGENTS, automatic-fail rules, readable-code guidance, workflow/reviewer procedure, released brief, README and UI handoffs have been read in the ongoing session; current status and the eleven supplied visual references inspected. No mandatory kit missing. Shared STATUS/PLAN/COMPLIANCE remain owned by Claude. Next: validate three style pilots, generate the full collection, inspect every image and regenerate rejects. This is user-requested decorative artwork, not trial integration evidence.

Reference direction: black stippled editorial cutouts for coverage concepts; expressive warm painterly corgi characters; soft pastoral painted panoramas. Original compositions, no copied brand wordmarks or personal account data. Generate on the installed Krea model via existing ComfyUI; record prompt, seed, job, dimensions and review per asset.

## 2026-09-08T20:37:47.785158+00:00 | First production checkpoint

150 distinct prompts and names prepared: 70 monochrome editorial objects, 60 painted corgi characters and 20 panoramas. 13 candidates generated so far; five individually inspected originals accepted. The first landscape pilot was rejected for an outlined corgi inconsistent with the painted scenery; the queued replacement prompt corrects this. Generation worker is active, job IDs persist in ignored local state.

The installed Spark BiRefNet background-removal pipeline was tested on two originals. Initial mask polarity was wrong, detected by opaque corner pixels, and corrected with InvertMask before export. Correct alpha output independently inspected; alpha ranges 0–255 and zero-opacity background corners confirmed. A second local worker prepares transparent variants for the 130 cutouts. No paid API, downloaded model, provider credentials or reference account content is used.

Current local handles: generation exec23608; alpha exec94114; SSH tunnel exec8837; gallery exec37831 on http://127.0.0.1:4178. Revalidate process/job handles and ComfyUI queue before resuming; do not restart a job on an observation timeout. Source state: .local/illustration-jobs/generation-state.json and alpha-state.json. Review decisions: docs/illustrations/reviews.json. Refresh gallery/catalog with python3 .local/illustration-jobs/catalog.py. Next: inspect generated contact sheets, individual doubtful images and alpha edges; accept or explicitly queue retries; continue until all150 distinct originals are approved and named exports/catalog are verified. Goal remains active, not complete.
