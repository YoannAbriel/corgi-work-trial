# September 8 instruction review: old preparation versus released brief

Coordinator record of three independent, read-only Sol agent reviews and re-reviews. Recorded at 2026-09-08T06:35:03+00:00. Scope: instruction design, not product architecture, implementation or legal certification. Track remains UNSELECTED.

## Actual reviewer coverage

All three reviewers read the current CLAUDE/AGENTS/WORKFLOW/REVIEWER/automatic-fail rules and the structured brief reference. They compared archived September 7 preparation instructions and relevant checklist/gap/stress sections. Workflow re-review also read READABLE-CODE, README, STATUS and DECISIONS. Reviewers returned findings to the coordinator; only the coordinator edited shared files. No product tests were run.

## Brief alignment — brief_review_sol

Initial verdict: FAIL pending document fixes.

- HIGH: Current readiness catalog still said the brief was pending and the ledger was conditional. Corrected: full brief received, track unselected, owned ledger required in all tracks.
- HIGH: Track 3 USDC wording risked demoting the first-class payout to stretch. Corrected: payout live strongly preferred; the accepted FX quote is the stretch addition.
- MEDIUM: Workflow submission list missed week-two plan, named repo access and final email addressing. Added while preserving authorization boundaries.
- MEDIUM: Official bans versus internal implementation safeguards were insufficiently distinguished. Explicit source classification added.
- LOW: Stale schedule and gap-review context. Corrected current text; historical archive untouched.

Re-review: PASS with one non-blocking wording fix. Coordinator then changed “every control” to “every retained control.” This last wording edit was not separately re-reviewed.

## Financial/security design — financial_review_sol

Initial verdict: DESIGN FAIL.

- F01 HIGH: Reconciliation allowed operation-table-only comparison. Corrected to provider truth versus owned ledger, operations supplementary.
- F02 HIGH: Mutable inbox states could share a row with immutable financial facts. Corrected to immutable event/provenance and separate nonfinancial delivery metadata or appended attempts.
- F03 MEDIUM: Maker-checker/MCP bypass controls insufficiently explicit. Added durable queue, immutable intent/version binding, distinct human approval, agent prohibition, shared API/admin/worker enforcement and negative/concurrency tests.
- F04 MEDIUM: Historical query semantics insufficiently explicit. Added both time dimensions and correction lineage; selected-track statement interpretation remains a future recorded decision.
- F05 MEDIUM: Conditional-ledger preparation guidance survived in active catalog. Corrected active copy; archive preserved with provenance.
- F06 LOW: Avoid presenting scanner/DB architecture as official deliverables. Source classification and proportionality clarified.

Re-review: DESIGN PASS for financial/security instruction design; no new material contradiction. Coordinator then clarified threshold wording so it does not imply the brief supplies a numeric threshold. This last wording edit was not separately re-reviewed.

## Practical workflow/readability — workflow_review_sol

Initial verdict: document DESIGN FAIL from blanket 162-control triage and disproportionate process; product DESIGN BLOCKED was also reported from unselected track/missing sandbox information and lack of separately stored verbatim brief.

Coordinator disposition: accepted removal of blanket 162-control triage. Retained Yoann's explicitly requested independent review of each bounded feature, grouping related criteria into coherent slices and reusing unchanged evidence. Did not require human approval for every routine provider/cut choice within authorized scope. Did not accept the claim that a separate original brief file is needed before shared instruction work: the official text was supplied directly in conversation and its repository extraction is honestly labeled. Missing track/sandbox information blocks dependent decisions, not track-neutral preparation.

Added explicit track-choice ownership, concrete readable-code requirements, candidate-led walkthrough status, concise sanitized decision records and honest no-product status.

Re-review: DOCUMENT-DESIGN PASS. Minor cleanup: clarified provenance path; updated running-review status; suggestion to make Linear optional was not adopted because Yoann explicitly requested Linear updates. Only retained controls and official requirements need active evidence; this is not blanket 162-item tracking.

## Evidence boundary

All three scoped instruction reviews passed after material corrections. Neither design review nor written controls prove deployment, sandbox access, SQL immutability, secrets protection, candidate understanding or legal compliance. Product AF-01 through AF-06 remain NOT RUN. Future product feature reviews must inspect real code and evidence for their actual revision.
