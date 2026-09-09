# Interface batch 2: handover at the session limit (2026-09-09, 21:42Z)

Written by the coordinator from the interface session's handover message, verbatim in substance, so the next session can merge the batch without that session's context. Nothing in this file is merged yet.

## Branch

`origin/ui-evening-2` at 9e38a66 (pushed), with origin/main 1431488 merged in (includes the switch actor gate 4f10705); typecheck clean, 553 tests pass, 1 skipped. Migration `db/migrations/0026_mcp_key_expiry.sql` (ADD COLUMN only) runs on the trial database BEFORE the push. README lines to touch with the docs commit: "An MCP key never expires" and "A wrong or revoked key answers 401 with no detail" are stale (keys may carry an expiry, null = never; unknown, revoked and expired answer the same 401 with no detail). F-EV-08 as already registered.

## Reviews (files uncommitted in the reviewers' worktrees; copy into docs/reviews)

- PASS statements: `docs/reviews/ui-evening-2-statements.md` in `.claude/worktrees/agent-ab600fffaf82542e5` (FAIL at 426d8ff, PASS at dfc38ef).
- PASS tokens (code): `docs/reviews/ui-evening-2-tokens.md` in `.claude/worktrees/agent-ae5b49fc1230b9be2` (PASS at 4862317; F-TK-04 README stays OPEN until the docs commit; week two: CHECK constraint on mcp_api_keys.label).
- PASS billing: `docs/reviews/ui-evening-2-billing.md` in `.claude/worktrees/agent-a8868fea4d61b4c50` (FAIL at ce22ea1, PASS at 0259d6c; F-BL-12, 13, 15 fixed in b184a08; F-BL-14 week two: tests for billingRows, openCollectionOf, collectAnchorFor under lib/).
- Screens: `docs/reviews/ui-evening-2-screens.md` in `.claude/worktrees/agent-af50e68be5e0b380c`: first pass FAIL at 0fadcfa; re-review closes F-EV2-01 to 07, opens F-EV2-08 MED (drawer over the AF-02 line between 801 and 1000 px) fixed in 2fca4c6 for 900 px and up; residual 810 to 899 accepted as LOW (week two: publish the sticky wrapper's height). The reviewer's confirmation of that fix is UNFINISHED.
- Late slices: `docs/reviews/ui-evening-2-late.md` in `.claude/worktrees/agent-ac7df2f0aaca3d655`: FAIL at a29beef and 5c4852f on F-LT-01 to 04 MED (all four fixed on the branch: c16a632, 731d034, fe6b9d1) plus F-LT-05 disclosure (README paragraph on main); re-review UNFINISHED; the claims bank account slice (e656ece) and the Approval decider (48e4005) were added to its scope and are UNREVIEWED.
- Unreviewed by anyone: the KYB evidence note 84be702 and the cancelled-policy rule 55fc5f0 (lists builder, presentation only, typecheck and tests green).

## Merge procedure for the next session

1. Finish or re-run the two unfinished reviews (screens confirmation of F-EV2-08, late slices re-review including e656ece and 48e4005) and review 84be702 and 55fc5f0; copy the five records into docs/reviews.
2. Guards proof on an ephemeral database with 0026 and 0027 (the New broker route branch, see STATUS) using the guards-ephemeral pattern; expect 200 of 200 or more.
3. `npm run migrate` on the trial database (0026, additive), then merge `ui-evening-2` with --no-ff, push code alone, read /api/health, then the docs commit: decisions 55 to 69 below, the register lines from the five records, the README lines, F-TK-04 closed.
4. Tell the live-fire co-pilot's re-read script (`docs/evidence/live-fire-day2/tools/reread.mjs`, 54 checks) the final SHA and run it read-only.

## DECISIONS text to stamp (Yoann with the interface session, evening of 2026-09-09), numbered from 55

55. Top bar: breadcrumb items ellipsise instead of clipping, the last item keeps priority; the search field shrinks first (160 px minimum); under 1280 px the AF-02 mode line takes its own row; the bar and the band are one sticky block so the band sits under the bar whatever its height; the drawer offsets by the token (residual 810 to 899 px accepted, week two: publish the sticky height).
56. Policy overview: two stacked columns (Cover then Broker, journal then Documents); Documents is one compact list, one GET form per document with a date input and an icon-only download button, new tab, rel noopener.
57. F-LIVE-01: "Correct a date" secondary band action for staff_ops when an endorsement is applied; "Correct" always in the policy sub-menu for staff_ops (endorse and cancel included).
58. F-LIVE-02: the correction block reads title, state, collect action first; formula rows and journal entries folded closed; reversal entries tagged "undoes <id>", re-books tagged "re-booked on <date>"; per-correction anchors collect-<rebookEventId>; the broker inbox items land on the Billing view anchors (two href lines in lib/inbox/sections.ts).
59. "What needs you" draws nothing when nothing waits; its row prints the count once.
60. Empty-state illustrations at 200 px (160 under 800) from cropped copies under public/illustrations/empty (scripts/crop-illustrations.mjs; 16 of 19 cropped).
61. Access tokens: /ops/mcp-keys is "Access tokens"; expiry chosen at creation (7 days, 30 days, 90 days default, 1 year, never), migration 0026 adds nullable expires_at written once; an expired token answers the same detail-less 401 as unknown and revoked (reason in detail); the secret is shown once through an httpOnly Secure SameSite=Strict cookie scoped to /ops/mcp-keys, consumed by POST /ops/mcp-keys/reveal/consume on paint, Done and a 120 s ceiling as backstops; cookie name and whole tokens scrubbed from logs; label bounded to 120 characters at the route; provider view stays as ?view=connect.
62. Signed money on previews, approval screens and the amount-explained drawer: signed figures, ok/danger tone, arrow and day movement on the Difference tile; reference rows muted, totals bold; reversal-then-re-book pair on the correction preview; the commission line plain.
63. Emphasis: explanatory sentences bold amounts, dates, percentages, day counts ("N of M days" as one piece) and the words that move money (lib/ui/emphasis.ts, byte-identical text); never in chips or table cells except the refunds "What it waits for" column.
64. Statements: totals as a subtraction (Commission earned, Clawback signed and red when non-zero, adjustments when non-zero, Net due bold, negative net due red with a sentence); one row per broker and month with earlier revisions folded newest first, the 30-run window stated; grouping helper in lib/statements/group-runs.ts with tests.
65. Premium timeline: lists print "$X on the latest terms" under today's figure (amount only, never on a cancelled or voided policy; the effective date is a week-two LATERAL join); the policy page adds "Latest terms on record" only when an endorsement is applied, lists the pending endorsement as a row with its state chip; when the delta is approved and unpaid the owning broker gets "Pay the delta $X", a notice line and a count on Endorsements; other staff read "when the broker pays the delta" and get no count.
66. Refund send feedback (LIVE-7): a toast per "Send to Stripe" reading the outcome; a staff_ops notice "N refunds approved, $X to send" linking to the refunds block; the inbox section for approved refunds is a reader change left open.
67. KYB evidence note (LIVE-3): "Not submitted yet: no verification on file." on unknown status with no provider account; the seeded-placeholder sentence only when the latest event's provider is "seed"; the label otherwise (components/kyb-evidence-note.tsx; inline on the policy Broker card; the ops brokers list with the New broker route).
68. Billing view after review (F-BL-01): reversed money reads as reversed (struck amount, "reversed" chip, the void record's sentence) on every reader's Billing view including the customer; refund words shared; owed rows say why they cannot be collected.
69. Claims (LIVE-10): the claimant bank account form in the "Claimant bank account" card behind a button-styled fold, open while no account exists; "Request payment" says a verified account is needed first; the Approval column names the decider under the chip, the requester stays in the expansion.

## Register summary (verbatim tables in the five review files)

F-EV-08 LOW pre-existing, fixed; F-EV-02 reclassified (slow /inbox, not a dead link); F-EV2-01 to 07 closed, F-EV2-08 MED fixed at 900 px and up with an accepted LOW residual; F-ST-01 to 05 fixed; F-TK-01 to 06 fixed except 04 (README); F-BL-01 to 15 fixed except 14 (week two); F-LT-01 to 04 fixed, 05 disclosure (README on main), 06 and 07 fixed, 08 to 11 fixed, 12 by design.

## Week-two lines gathered by the interface session

CHECK constraint on mcp_api_keys.label; ActivitySubjectKind "user" for the switch row; the sticky height published for the drawer; latest terms date and cancellation date on the lists (LATERAL join); tests for the Billing pure functions; the approved-refunds inbox section; direct bill (decision 44).

## Update at 21:44Z: five PASS verdicts, records on the branch

The interface session's correction after its handover: the two unfinished reviews reported PASS and all five records are committed and pushed on `origin/ui-evening-2` at 79a96c7 (`docs/reviews/ui-evening-2-{tokens,statements,screens,billing,late}.md` plus `docs/handoffs/ui-evening-2-handover.md`). Screens PASS at 7b527f0 (F-EV2-08 fixed from 888 px up; F-EV2-09 LOW accepted for 801 to 887 px with an inspector open: no submission screenshot below 888 px with a drawer open). Late slices PASS at d8aa06d (F-LT-01 to 04 resolved; F-LT-05 downgraded to LOW, the README sentence on the second credential is on main at 21:44Z; F-LT-13 LOW legend wording; F-LT-14 LOW an em dash in a source comment at app/policies/[policyId]/page.tsx line 243, to remove before the merge). No open MED. Remaining before the merge: remove that dash on the branch, the guards proof with 0026, `npm run migrate` on the trial database, then the procedure above.
