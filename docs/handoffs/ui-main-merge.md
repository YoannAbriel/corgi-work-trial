# UI integration onto current main

This is a merge checkpoint for Claude's independent review and deployment, not a final trial PASS.

## Revision and ownership

UI-04 was committed first as `bbf9c8b`. Main at the start of the merge was `938481d456d1a0e0b0275f1cb4e12a42a601c092`. The branch is `codex/corgi-interface`; no main checkout, push or Vercel deployment was changed. User explicitly assigns the final independent UI review to Claude after the merge.

Startup receipt is recorded in the UI-04 handoff. STATUS, PLAN and COMPLIANCE-MATRIX were resolved to main verbatim as requested. Both sets of DECISIONS entries and all UI handoffs/reviews are retained. Earlier review manifests and verdicts describe their historical revisions, not this merge.

## Conflict resolution

- Policy detail preserves main's complete server reads, ownership checks, UUID guard, endorsements, corrections, document routes, hidden inputs, refund refusal/approval messages and calculations. Only the shell, status semantics, table containers and existing presentation copy differ.
- Operations keeps its server role guard. Reconciliation and Statements are accessible from the dashboard and sidebar. Staff Policies remains the UI-04 staff-guarded read-only index using existing broker/policy read helpers.
- Broker Policies keeps main's Statements and customer-workspace destinations.
- Main's added customer, endorsement, correction, reconciliation and statement screens now use the shared shell. Table regions scroll horizontally when needed; document scrolling remains native. Existing server components stay server components, including formula lines and correction sections. No browser money calculations were introduced.
- The user-requested removal of a separate Back control is retained. Breadcrumbs carry the parent links. Shared logout replaces the duplicate customer-page logout form.

## Checks actually run

- `npm run typecheck`: PASS.
- `npm run build`: PASS after the final application edits; raw local log `.local/ui-main-build.txt`.
- `npm test`: 370 tests, 369 PASS, 1 optional Stripe test SKIPPED, 0 failures. Raw local log `.local/ui-main-test.txt`. No financial/provider side effects were run as part of this UI check.
- AST comparison against merge-parent main: all 23 existing changed TSX files preserve form actions/methods, field names, values/defaults, required/disabled flags, min/max/length/pattern/step constraints. Logout moves to the shared shell. Local checker `.local/check-main-contracts.cjs`; not a replacement for independent review.
- No diff against main in `lib`, `db`, `scripts` or `app/api`. The new policy index and login landing redirect are the previously disclosed UI-04 navigation additions.
- 24 local route/alias renders PASS with explicit synthetic adapters and native form markup; no render warnings after updating the ignored fixture renderer for async server sections. Initial harness failures reflected main's new imports, UUID checks and segment-based cancellation input and were corrected in the harness only. Missing cancellation date follows main's redirect; missing endorsement amounts shows its refusal state.
- Chrome: 13 affected routes inspected for page heading, a single main landmark and document width at 1512 and 390 pixels; no page-level horizontal overflow. Screenshot inspection included Operations, populated staff statements, cancellation mobile, endorsement mobile and correction desktop. Five long pages (policy, cancellation, reconciliation, statements list, statement detail) reached the bottom with native End: remaining scroll -0.5 to 0 pixels, footer bottom 842.99–843.20 at height844. Viewport override reset. A ControlOrMeta+End probe stopped midway; plain End established the reported result.
- Browser measurements are in `ui-main-browser-checks.json`. Preview adapters are ignored local tooling, not deployable financial evidence; they have no database/provider connection and refuse all non-read HTTP methods. Their sample amounts and histories do not prove accounting correctness.

## Review and next step

Claude should review this exact merged diff against its main parent, including preserved access/UUID guards, form contracts, server-only calculations, font licences and AF-06 explainability; then merge into main, deploy and run the authorized live sandbox session. Final independent review, deployed interaction coverage and the candidate walkthrough remain pending. Earlier UI-04 Chrome blockage is no longer present, but this integration render check does not self-approve that review.

DM Sans and Inter remain local OFL assets with their licences and provenance in UI-02; DM Sans approximates the reference's commercial F37 Bolton. Original decorative WebP art and lucide icons are retained. No new dependency or artwork was added during the merge.
