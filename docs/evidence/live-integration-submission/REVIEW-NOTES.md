# Independent review: local integration screenshots

Reviewed 2026-09-09 at 20:27 UTC by independent Codex reviewer `/root/evidence_pack_review`.

**PASS for the local screenshot pack as prepared for Yoann’s review.** The 14 images support their bounded descriptions, and the pack discloses its material limitations. This verdict does **not** complete B14, certify the product, approve hosting or submission, or establish any global automatic-fail PASS.

## Scope and startup receipt

Repository observed on `main` at `5269397dc14a291bfa2ddcb3d7f10f379f80e2ac`; working tree clean on inspection. The coordinator began collection at `81e9680`; concurrent work advanced the repository. This review concerns the files in this Downloads folder, not that intervening code. No browser, application, provider, database, Git or shared planning state was changed. This reviewer owns only this report.

Actual reads: `AUTOMATIC-FAILS.md` in full, `AGENTS.md` in full, `WORKFLOW-48H.md` in full, `REVIEWER.md`, `READABLE-CODE.md`, `docs/BRIEF-REFERENCE.md`; README integration inventory and relevant operating/limitations sections; PLAN B14 and requirement coverage; STATUS’s 20:08:15 UTC local-pack startup and relevant integration/live-fire records; EVIDENCE-PACK introduction; relevant DECISIONS and COMPLIANCE-MATRIX entries; the two KYB records in `docs/evidence/ui-audit-2026-09-09/observations.json`; relevant LIVE-0/LIVE-8 passages in `docs/handoffs/live-fire-day2.md`; this folder’s introduction, manifest and checksum list. All mandatory kit inventory files were present and readable. Separately supplied kickoff sandbox rules remain unavailable as already disclosed in BRIEF-REFERENCE. The reviewer read the structured brief extraction; the coordinator reports independently reading the original general/Track 1 Notion pages through Computer Use. No additional provider-contract or legal interpretation is asserted here.

Next acceptance evidence: B14 screenshots including dashboard delivery logs. Planned checks: open every image; compare amounts, references and responses; check sandbox labels, secret exposure, provenance, formats and hashes. Main risk: overstating what screenshots prove. About 9 h 23 remained before the September 10 05:50 UTC freeze at verification time. Local repository records were used; Linear was not queried.

## Checks actually executed

- Opened **all 14 actual images** with the image viewer, including both tall application PNGs. These are distinct application/dashboard screens, not login redirects or repeated files.
- Python/Pillow decoded and verified every image, checked byte sizes, dimensions, formats, manifest inventory and SHA-256 values: **14/14 passed**, **14 unique hashes**, **12 JPEGs and 2 PNGs**. The ten fresh captures are JPEG files; none is mislabeled PNG.
- Compared the SHA256SUMS list with the manifest and actual image bytes: **14/14 matched**, no missing or extra image.
- Compared all four earlier application captures directly with their named repository sources: **4/4 byte-identical**. The two KYB capture timestamps and deployed URLs match observations.json. Exact times for the two earlier PNGs remain explicitly unknown.
- Ran `gitleaks dir /Users/yoannabriel/Downloads/Corgi-Live-Integration-Evidence-2026-09-09 --redact --no-banner`: **exit 0, no leaks found**, approximately 28.57 KB of text scanned. This is not OCR. Visual inspection separately found no visible credential, payment client secret, real customer contact or identity document. The visible email uses example.com; KYB fields show the disclosed test address token and masked test EIN endings. Synthetic demo actors and businesses are identified as such by the repository context.
- Inspected Git branch, status and recent commits read-only. No product checks, new sandbox transactions, endpoint replay, database query, fresh deployment verification or history secret scan were run; they are outside this packaging scope.

## What the pixels support

| Evidence | Independently observed result | Scope verdict |
|---|---|---|
| Payments 01–03 | USD 1,253.20 succeeded; PaymentIntent `pi_3UDUCUK6R3v50tIy06eM9VlU`; event `evt_3UDUCUK6R3v50tIy0MtOqkDo`; September 8, 18:57:00 UTC; delivery HTTP 200, response `received: true`, `status: done` | PASS |
| Payments 04–05 | USD 2,081.09 `refund.updated`; event `evt_3UDN8aK6R3v50tIy0i0dxINg`; September 8, 18:27:59 UTC; HTTP 200 and the same done response | PASS; refund ID and policy mapping are repository-backed, not visible in the collapsed payload |
| Payments 06 and application 03 | USD 53.84 succeeded; `pi_3UDrW1K6R3v50tIy1GPWqtve`; event `evt_3UDrW1K6R3v50tIy1YusKFe5`; September 9, 19:50:43 UTC; HTTP 200/done. Earlier policy CGP-01707 screen shows collection USD 53.84, commission USD 7.89 at that recorded instant, and USD 2,434.28 total collected | PASS for the captured historical state |
| Connect 01–03 | Two active destinations at the full deployed `/api/webhooks/stripe` URL: connected accounts listening to 1 event type, platform to 9. Event `evt_1UDOgLK6R3FpfF2DhpwJYnqR`, account `acct_1UDOfRK6R3FpfF2D`, September 8, 13:03:27 UTC, HTTP 200/done | PASS |
| Connect 04 and application 01–02 | Harbor Point account is Restricted with payouts paused. Earlier app shows Harbor Point failed with `verification_failed_tax_id_match`; Redwood approved | PASS for separate, accurately described observations; Restricted is not itself the KYB verdict |
| Application 04 | 4 provider-only breaks: USD 100.00, USD 12.61, USD 12.61 and USD -8.98; 32 probes of USD 42.42; simulator labels visible | PASS as an unresolved-break view, not clean reconciliation |

All ten Stripe images visibly carry the sandbox banner. Application images also display Sandbox; the money and reconciliation screens explicitly distinguish Stripe LIVE SANDBOX from the two LOCAL SIMULATOR slots. The pack explicitly discloses that its two live slots use one provider and that Connect is not a dedicated KYB bureau. Provider HTTP 200/done is the application’s response, not independent proof of ledger invariants.

## Exact gaps and automatic-fail boundaries

- **Pending KYB screenshot absent.** No screenshot in this pack visually demonstrates all three required KYB states. The historical pending interval is recorded in STATUS, and the omission is explicit. Fresh provider verification details for Redwood are also absent. Full KYB acceptance is not re-approved by this pack.
- Four application screenshots are historical, not current-interface evidence. The correction image retains the stale `to collect` badge alongside its collected confirmation; the introduction discloses this. Its cash total predates the subsequent endorsement reported in current STATUS. No current-balance claim is made.
- Fresh capture timestamps, Computer Use provenance and the absence of pixel edits are recorded by the collector. This reviewer verified the resulting files and visible consistency; it did not independently observe capture or reconstruct the collector’s tool session.
- The coordinator reported that an initial Stripe accessibility diagnostic exposed a **test PaymentIntent client secret** into tool output before sanitization. Its value is not reproduced here. No such secret was observed in this pack. This file review does not resolve that diagnostic exposure or establish repository/history AF-05 compliance. **No global AF-05 PASS is issued.**
- AF-01 deployment/two-role final checks, AF-03 immutability/security invariants and AF-06 Yoann’s understanding: **NOT RUN here**. AF-02/AF-04 observations apply only to visible labels, declared provenance and included artifacts, not all system paths. Full B14 still requires the remaining freeze deliverables and final gates.
- This folder remains local. Upload, viewer-only access and verification from a reviewer session are **NOT RUN**. A Finder `.DS_Store` is incidental local metadata and should be excluded from a later shared archive; it is not evidence.

No material issue blocks **Yoann’s local review of this explicitly limited pack**. Its disclosed gaps must remain visible in any later sharing or submission claim.

## Reviewed artifact identity

Image identity is fixed by the 14 entries in SHA256SUMS.txt. Supporting-file SHA-256 values at review:

- `00-START-HERE.md`: `bcab0e29ce5d6e3befeadfc9b09cfccdcaa96635f1bd3d5cc36a74902bcdb17b`
- `evidence-manifest.json`: `7386bac3c0d25f004953d85c3a09bffceec1dd121dd28620a653223ce859b86c`
- `SHA256SUMS.txt`: `9e93c1b6f27f5735aaa0698b6345d9da9bc62f518e338c8a87a81c64ab1c2ff2`

Human walkthrough status: **NOT REVIEWED WITH YOANN by this reviewer**.
