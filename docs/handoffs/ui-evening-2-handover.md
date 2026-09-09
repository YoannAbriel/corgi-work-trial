# Batch 2 handover draft (ui-evening-2), for the coordinator

## DECISIONS entries, from 55 (43 Billing, 52 New broker, 53 F-INSPECT-05, 54 demo switch are the coordinator's)

55. Top bar (2026-09-09 evening): breadcrumb items ellipsise instead of clipping, the last item keeps priority; the search field shrinks first; under 1280 px the AF-02 mode line takes its own row and the top bar grows to 62 px, the band and the drawer follow.
56. Policy overview: two stacked columns (Cover then Broker, journal then Documents); Documents is one compact list, one GET form per document with a date input and an icon-only download button, opening in a new tab with rel noopener.
57. F-LIVE-01: the backdated correction has a visible entry point: "Correct a date" secondary band action for staff_ops when an endorsement is applied, "Correct" always in the policy sub-menu for staff_ops (also on endorse and cancel).
58. F-LIVE-02: the correction block reads title, state, collect action first; formula rows and journal entries folded closed; reversal entries tagged "reversed" with struck amounts, re-books tagged "re-booked on <date>"; the broker inbox item lands on the Billing view anchor (one href line in lib/inbox/sections.ts).
59. The "What needs you" block draws nothing when nothing waits (the inbox all-clear state still says it); its row prints the count once.
60. Empty-state illustrations render at 200 px (160 under 800) from cropped copies under public/illustrations/empty produced by scripts/crop-illustrations.mjs; 16 of 19 cropped, 3 already fill their frame.
61. Access tokens: /ops/mcp-keys is the "Access tokens" screen; a token carries an expiry chosen at creation (7 days, 30 days, 90 days default, 1 year, never), migration 0026 adds the nullable expires_at column written once; an expired token answers the same detail-less 401 as unknown and revoked (outcome unauthorised, reason in detail); the secret is shown once in the shell through an httpOnly Secure SameSite=Strict cookie scoped to /ops/mcp-keys, consumed by POST /ops/mcp-keys/reveal/consume as soon as it is painted, Done and a 120 s ceiling as backstops; the cookie name and whole tokens are scrubbed from log lines; the provider view stays as ?view=connect.
62. Signed money: previews, approval screens and the amount-explained drawer print the direction of the money: signed figures, ok/danger tone, an arrow and the day movement on the Difference tile; reference rows muted, totals bold; the correction preview shows the reversal-then-re-book pair; the commission line stays plain.
63. Emphasis: explanatory sentences bold their amounts, dates, percentages, day counts and the words that move money (lib/ui/emphasis.ts, byte-identical text); never inside chips or table cells (one declared exception: the refunds "What it waits for" column).
64. Statements: totals read as a subtraction (Commission earned, Clawback signed and red when non-zero, other adjustments when non-zero, Net due bold, negative net due red with a sentence); one row per broker and month with earlier revisions folded, newest first, the 30-run window stated on both lists; the grouping helper lives in lib/statements/group-runs.ts with tests.
65. Premium timeline: the policy lists print "$X on the latest terms" under today's figure (amount only; the effective date on lists is a week-two line, LATERAL join in the list read); the policy page adds the "Latest terms on record" tile and lists the pending endorsement as a row of the changes table with its state chip; when the delta is approved and unpaid the owning broker gets a "Pay the delta $X" band action, a notice line and a count on the Endorsements sub-menu entry.

## README lines (coordinator)

- README MCP section: replace "An MCP key never expires. Revoking it on /ops/mcp-keys is the only thing that ends it" with: a token carries an expiry chosen at creation (7 days, 30 days, 90 days by default, 1 year or never), written once and never moved; extending means creating another token; revoking is still a new row. Replace "A wrong or revoked key answers 401 with no detail" with: a missing, wrong, revoked or expired token answers the same 401 with no detail; the reason is written in mcp_calls.detail for the operator.
- The screen is named "Access tokens" (route unchanged, /ops/mcp-keys); the secret is shown once inside the screen and consumed on paint.
- docs/COMPLIANCE-MATRIX.md MCP-01: name db/migrations/0026_mcp_key_expiry.sql and app/ops/mcp-keys/reveal/consume/route.ts; check:mcp evidence is 97 assertions.
- docs/reviews/b11-mcp.md: F-B11-07 closed by this slice.

## Register lines: taken verbatim from the review files
- docs/reviews/ui-evening-2-tokens.md: F-TK-01..06 (F-TK-04 MED README, fixed by the docs commit; F-TK-01/02/03/05/06 fixed on the branch, pending the builder's report)
- docs/reviews/ui-evening-2-statements.md: F-ST-01..05 (fixed, re-review pending)
- docs/reviews/ui-evening-2-screens.md, ui-evening-2-billing.md, ui-evening-2-late.md: pending
- F-EV-02 reclassified: not a dead link, /inbox answers in about 3.5 s with no pending feedback (nav-builder measurement on the production build)

## Migration
- db/migrations/0026_mcp_key_expiry.sql, ADD COLUMN only, run on the trial database before the push.

## Register additions
- F-EV-08 LOW pre-existing on d002f77: /ops at 375 px overflowed (what-needs-you row, grid item without min-width: 0); fixed in batch 2, lists.css.
- F-EV-02 reclassified: /inbox answers in about 3.5 s with no pending feedback; not a dead link.
- F-EV2-01..07 (screens review): re-review confirms all seven closed (01, 02 MED fixed; 03..06 LOW fixed; 07 accepted); one new F-EV2-08 MED (drawer over the AF-02 line at 801 to 1000 px, from the 1000 px drawer block): fix by deleting that block (polish builder, pending).
- F-ST-01..05 fixed, re-review PASS.
- F-TK-01..06: 04 MED is the README (docs commit), the others fixed in 32025f0, re-review PASS for the code at 4862317; week-two line for README:149: a CHECK constraint on mcp_api_keys.label (1 to 120 characters), deferred tonight, the route bounds it.

## Additions to the entries (same numbering continues)
66. Refund send feedback (LIVE-7): the toast per "Send to Stripe" reads the outcome (provider_accepted ok, queued_for_approval info, failed or refused error) and a staff_ops notice "N refunds approved, $X to send" links to the refunds block of the Money view; the inbox section for approved refunds is a reader change left to the coordinator.
67. KYB evidence note (LIVE-3): "Not submitted yet: no verification on file." when the status is unknown and no provider account exists; the seeded-placeholder sentence only when the latest KYB event's provider is "seed"; the label alone otherwise (components/kyb-evidence-note.tsx on the broker pages, inline on the policy Broker card; the ops brokers list follows with the New broker route).
68. Top bar and band as one sticky block (F-EV2-02): the band sits under the bar whatever the bar's height; the drawer takes the full height under 1000 px; the search field minimum is 160 px.
69. Billing view after review (F-BL-01): money that was reversed reads as reversed (struck amount, "reversed" chip, the void record's sentence) on every reader's Billing view, the customer included; refund words shared between the Money and Billing views; owed rows say why they cannot be collected; per-correction anchors.

## Review files (worktrees, uncommitted, copy into docs/reviews at merge time)
- docs/reviews/ui-evening-2-tokens.md: .claude/worktrees/agent-ae5b49fc1230b9be2 (FAIL then PASS for the code at 4862317; F-TK-04 README open)
- docs/reviews/ui-evening-2-statements.md: .claude/worktrees/agent-ab600fffaf82542e5 (FAIL then PASS at dfc38ef)
- docs/reviews/ui-evening-2-screens.md: .claude/worktrees/agent-af50e68be5e0b380c (FAIL at 0fadcfa; re-review pending)
- docs/reviews/ui-evening-2-billing.md: .claude/worktrees/agent-a8868fea4d61b4c50 (FAIL at ce22ea1; re-review pending)
- docs/reviews/ui-evening-2-late.md: .claude/worktrees/agent-ac7df2f0aaca3d655 (pending, includes the switcher)

## Late-slices review (docs/reviews/ui-evening-2-late.md, FAIL at a29beef/5c4852f, re-review pending)
- F-LT-01 MED staff notice said "when you pay" to ops; F-LT-02 MED tile headline was the unpaid quote; F-LT-03 MED customer list said "once the delta is paid" while awaiting approval: fixed (policy builder, lists builder).
- F-LT-04 MED sidebar name wrapped (switcher regression on production): fixed, hotfix switch-fix fe6b9d1.
- F-LT-05 MED disclosure: any demo session reaches staff_approver; README credentials paragraph (coordinator), week-two hardening line.
- F-LT-06 LOW target user id in the switch message (subject id needs a new ActivitySubjectKind: week two); F-LT-07 LOW two refusal sentences: fixed in switch-fix.
- F-LT-08/09 LOW legends: fixed; F-LT-10 LOW customer pending row legend: policy builder; F-LT-11 LOW proration bold: fixed e236fd1; F-LT-12 LOW hard-coded menu list: by design.
- New rule: no "on the latest terms" line on a cancelled or voided policy (lists builder); week-two line: cancellation effective date on the lists.
- Claims page (LIVE-10): visible "Record a bank account" button in the claimant bank account card, helper line on Request payment (nav builder, pending).
70. Claims (LIVE-10): the claimant bank account form lives in the "Claimant bank account" card behind a button-styled fold "Record a bank account", open while no account exists; the "Request payment" form says a verified account is needed first and links to the card; the row menu keeps only the simulator payment controls. Seven forms before and after, identical contracts.
- Billing re-review PASS at 0259d6c (F-BL-01 HIGH, 02, 03 MED, 04..11 LOW resolved; F-EV2-01/05/06 resolved). New LOW: F-BL-12 bare #collect anchor comment (fix pending), F-BL-13 double full stop (fix pending), F-BL-14 no tests for billingRows/openCollectionOf/collectAnchorFor (week two: move under lib/ with tests), F-BL-15 About sentence on reversed payments (fix pending).
