# UI system: implementation notes for the coordinator

Branch `ui-system`, worktree `.claude/worktrees/ui-system`. Interface session, 2026-09-09. Decision by Yoann at 15:15 Europe/Zurich: full rework of every screen, colours, buttons and fonts kept, presentation layer only. Linear YOA-656. Plan (local): `~/.claude/plans/fizzy-wobbling-bonbon.md`.

## Startup receipt (interface session)

Read in full: CLAUDE.md, AUTOMATIC-FAILS.md, READABLE-CODE.md, AGENTS.md, WORKFLOW-48H.md, REVIEWER.md, docs/STATUS.md (head and the entries of 2026-09-09), docs/DECISIONS.md (tail), README.md (integration inventory and demo accounts), app/globals.css, app/styles/*.css, components/portal-shell.tsx, portal-frame.tsx, detail-layout.tsx, disclosures.tsx, console-parts.tsx, what-needs-you.tsx, workspace-overview.tsx, decorative-illustration.tsx, app/layout.tsx, app/ops/reconciliation/page.tsx, app/ops/console/page.tsx, app/ops/policies/page.tsx, app/ops/page.tsx, app/inbox/page.tsx (head), app/broker/page.tsx (head), app/login/page.tsx, app/page.tsx. By targeted search: lib/console/read.ts (types and resolveReference), lib/inbox/tasks.ts and sections.ts, lib/reconciliation/read.ts (types), lib/policy/terms-in-force.ts, docs/reviews/FINDINGS.md (F-YA and F-LU lines), docs/ui-audit-2026-09-09.json (head), db/migrations/0001 (ledger tables). Not read: READINESS-CHECKLIST.md, STRESS-TEST-PLAN.md, READINESS-BACKLOG.json, GAP-REVIEW.md (advisory, outside this presentation scope). Production audited by 22 screenshots at 1440 px across the three roles before any change.

## Decisions to record in docs/DECISIONS.md (assistant proposals accepted by Yoann at 15:15 and 15:40)

1. **Two-level navigation.** The main sidebar folds to an icon rail when a screen declares views; a section sidebar lists the views. Views are `?view=<name>` on the existing route, validated by `pickView` (lib/ui/views.ts), one view rendered per request. Every link ever written to a screen keeps working.
2. **Sticky page band** on every screen: section illustration, title, useful chips, primary actions. The breadcrumb bar and the band are both sticky.
3. **Inspector.** `?inspect=<reference>` renders, beside the table, the record and its whole trail through `resolveReference` (lib/console/read.ts), the same reader as the console search. Staff screens only; the component refuses other roles.
4. **Charts are server-rendered SVG**, no library, no client script; the stylesheet animates them once. Every chart carries a hidden table for screen readers.
5. **Native HTML for folds and menus**: `details` for expansions, the `popover` attribute for row menus and the amount explanation, so nothing opens inside a table cell any more and nothing is clipped by a scroll container.
6. **Toasts** (F-YA-09): the redirect query parameters a page already receives become toasts through `toastsFromQuery`; the client `Toaster` shows them, removes the parameters from the URL and keeps the text in a hidden status region. `SubmitButton` shows a working state on a posting form. The inline `.notices` block stays for the checks.
7. **Illustrations kept and re-placed**: a vignette per section in the band and on the overview cards, large in empty states, on the login and the landing; the full-width banners leave the homes.
8. **Ledger section in the console**, read-only, four views (balances with an as-of date, one account, entries, flows), through a new `lib/ledger/read.ts` (SELECT only, bounded).
9. **Landing at `/`**, sign-in card at `/login`; the sandbox sentence and the five demo logins stay verbatim.

## What the interface session owns on this branch

- `app/styles/system.css` (new, the frame and the blocks), `app/globals.css` (old shell rules removed by a script, blocks kept), `app/layout.tsx` (one import).
- `components/shell/*` (PortalShell, PageBand, SectionNav, sections registry), `components/portal-frame.tsx`, `components/portal-shell.tsx` (re-export).
- `components/ui/*` (stat, charts, table, toolbar, popover, inspector, time, legend, about, empty, toast, submit-button), `lib/ui/views.ts` and its test.
- Two reference screens: `app/ops/page.tsx` with `components/workspace-overview.tsx`, and `app/ops/policies/page.tsx`.
- Five builders (workflow `corgi-ui-build`, branches `ui-<letter>` from `ui-system`) rebuild the other screens on disjoint files; their briefs and file lists are in the workflow script and in `docs/handoffs/ui-system-brief.md`.

## Disclosures

- Local dev servers in the builders' worktrees read the trial database through the read-only runtime role, GET only. Each GET writes one nonfinancial `activity_log` row (migration 0021), as production does. No money row is written.
- At 15:13 the interface session switched the shared checkout's branch for two minutes; the coordinator's docs commit landed on that branch and was cherry-picked back onto main at 15:16 (recorded by the coordinator in STATUS). Rule since: nobody switches the shared checkout's branch.

## Checks run by the interface session on e4e3251

- `npm run typecheck`: PASS.
- `node --import tsx --test lib/ui/views.test.ts`: 7 pass, 0 fail.
- Local render at 1440 px of /ops, /ops/policies, /ops/policies?filter=waiting and the legacy /ops/reconciliation under the new shell: screenshots looked at, no horizontal overflow.
- Not yet run on this branch: `npm run build` (a dev server was running in the worktree), `npm test`, the check scripts, production.

Walkthrough status: NOT REVIEWED WITH YOANN.
