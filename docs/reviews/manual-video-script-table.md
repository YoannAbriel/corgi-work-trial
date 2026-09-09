# Manual video script table review

Verdict: **PASS for script readiness only**, 2026-09-09T22:38:33Z. Reviewer: independent agent `/root/manual_script_review`. Scope: the B14 preparation artifact `docs/handoffs/corgi-video-script-table-en.md`, SHA-256 `7cfba9dafc803bd94f4aed04b772c418e58c908d6e7c2faf353cd5c63c8c5504`. This does not approve a finished recording, full B14, the integrated product, or Yoann's AF-06 walkthrough.

## Startup receipt and examined revision

Repository: `/Users/yoannabriel/dev/corgi-work-trial`, main at `756db05d071d5aff32eaae47cc73a474eb60db02`. At entry and before this record, STATUS was modified and the reviewed script was untracked; neither was edited by this reviewer. No missing mandatory kit file. An initial attempted `components/shell/sections.ts` read found no file; the actual `sections.tsx` was located and read. No code, database, provider or browser operation was performed.

Actual reads: AGENTS, AUTOMATIC-FAILS (all six bans), WORKFLOW-48H, REVIEWER and READABLE-CODE in full; `docs/BRIEF-REFERENCE.md` (the supplied brief's structured extraction, not an independently retrieved original); README integration inventory, roles, MCP, customer interface, money rules and history sections; current STATUS video preparation/startup entries; PLAN B14; relevant DECISIONS on statement revisions, sidebar, demo switching, Billing and interface batch 2; scope-relevant COMPLIANCE-MATRIX integration, live-fire and B12/B14 control rows. Actual source inspection covered `app-shell.tsx`, `section-nav.tsx`, `sections.tsx`, the navigation toggle, policy view declarations/customer branch, policy list search, correction and historical date sections, claim list/detail view labels, decided approvals, statement revisions/hash, reconciliation views/inspector/runs, and Access tokens Connect/About content. Supporting saved evidence read: relevant passages of `docs/handoffs/live-fire-day2.md`, `docs/handoffs/b12-1-agent-demo.md` and live-integration evidence index/review notes.

Next acceptance criterion was a usable English table with true UI paths and at-most-five-minute editing targets. Planned and completed checks: source-to-instruction comparison, claim/evidence comparison, table/timing/word/link inspection and scoped secret scan. Local records were used; Linear and external provider documentation were not queried because no provider behavior or legal control was changed. Prior deployed observations were supplied by the coordinator; this reviewer did not independently operate the live UI.

## Findings and evidence

No material finding in the reviewed artifact.

| Requirement | Evidence examined | Result |
|---|---|---|
| Money must be reachable from the actual starting screen | `PortalShell` puts views only under the active sidebar section; `POLICY_VIEWS` includes Money; policy list search opens `/policies/{id}`. Customer requests branch to `CustomerPolicyView`. | PASS. The script distinguishes workspace Overview, policy Overview, policy Money, global Money grouping, and Billing. |
| Correct roles and navigation for the remaining screens | Staff operations navigation includes Approvals, Reconciliation, Statements, Brokers and Access tokens. Source declares Decided, Claims Overview/Payments, Connect, and the exact About subheadings. Saved statement links and disclosures match the rendered source. | PASS. One ops session suffices; the script does not ask for a role switch or a new decision. |
| Financial and historical statements reflect identified records | LIVE-8/9 notes support the correction, collected $53.84, three historical dates and revision 6 comparison. Saved MCP evidence gives 19:13:53 request and 19:15:20 rejection, an 87-second difference. Evidence-pack notes support the separate $2,081.09 refund. | PASS for the documented narration. The table separates policies, the older settled claim payment and the rejected agent request. Current shared-sandbox amounts remain subject to the explicit before-take check. |
| Honest reconciliation and integration labels | Reconciliation source shows separate probes, missing ledger values as “no record,” saved runs and clearing. README names two Stripe slots and two local simulators. | PASS. No clean-reconciliation, zero-clearing, probe-journal, two-provider or live-claim-rail claim is made. Latest counts and clearing are labelled previously observed, not independently reverified here. |
| Practical timed English table | Independent Python check: 22 rows, each with 6 columns; consecutive 00:00 through 04:50, 290 seconds; 546 spoken words when hyphenated words are split; 113 words/minute overall, fastest row 144 words/minute. All 25 links (22 unique) use the deployed app. | PASS as an editing plan. Separate takes and removal of loading/navigation are explicit. These are not measured recording times. |
| Safe artifact and honest delivery status | Manual reading plus `gitleaks stdin --redact --no-banner --no-color`: approximately 16.37 KB scanned, no leaks, exit 0. `git diff --check`: exit 0. | PASS for this text. No password, token, secret creation or publication is instructed. Final paragraph explicitly excludes a saved/finished video claim. |

## Automatic-fail scope

| Rule | Script assessment | Final delivery gate |
|---|---|---|
| AF-01 accessible deployment | Deployed URLs and a health shot are supplied; script expressly says health/video alone do not establish delivery. | NOT RUN here: independent current deployment journey and final credentials. |
| AF-02 honest integrations | Both live slots are Stripe; bank verification and claim payouts are named LOCAL SIMULATOR. | NOT RUN here: full current integration proof. |
| AF-03 immutable money records | This is a read-existing-outcomes walkthrough; narration distinguishes visible ledger history from documented database tests. | NOT RUN here: SQL/runtime/privileged-path enforcement and full ledger audit. |
| AF-04 sandbox and synthetic data | Script uses the documented sandbox records and makes no new financial or identity action. | NOT RUN here: current deployed credential mode and dataset audit. |
| AF-05 no committed secrets | Reviewed script contains placeholders and public identifiers; scoped scanner passed. No commit or push performed. | NOT RUN here: staged files and complete shared history scan. |
| AF-06 candidate ownership | The script explicitly does not establish candidate understanding. | NOT RUN here: Yoann's line-by-line walkthrough. |

Residual limits: live UI was not controlled by this reviewer; code-to-navigation checks and previously recorded observations are the evidence basis. No video duration, cursor movement, media file integrity, narration performance or final export was checked. The user will make the recording and must match each spoken figure to the frame as the table directs. No product tests were rerun for this documentation-only review.
