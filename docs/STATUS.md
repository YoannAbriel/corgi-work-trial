# Current status

Updated at 2026-09-08T07:40:27+00:00. Track: **1: POLICY ADMINISTRATION**, explicitly selected by Yoann. Stack and providers: **SELECTED** in the planning discussion of 2026-09-08 (see DECISIONS.md): Next.js on Vercel, Postgres on Neon, Stripe test mode (live), Sumsub sandbox KYB (live, Middesk fallback), local simulators for bank verification and claim payout, real PDF generation. Repository still contains instructions, planning and preparation only; no product code, deployment or provider account exists yet.

## 2026-09-08T07:40:27+00:00 | Startup receipt and planning session

Files actually read in full this session: CLAUDE.md, AGENTS.md, AUTOMATIC-FAILS.md, READABLE-CODE.md, WORKFLOW-48H.md, REVIEWER.md, HANDOFF-PROMPT.md, README.md, docs/BRIEF-REFERENCE.md, docs/STATUS.md, docs/DECISIONS.md, docs/PROVENANCE.md. Read by targeted search only: GAP-REVIEW.md, docs/reviews/instructions-2026-09-08.md. Not read: READINESS-CHECKLIST.md, STRESS-TEST-PLAN.md, READINESS-BACKLOG.json (advisory, consulted later per scope). Absent files: none of the kit files are missing; docs/PLAN.md and docs/COMPLIANCE-MATRIX.md did not exist at session start (PLAN.md created now, COMPLIANCE-MATRIX.md to be created with B1).

Provider facts verified today against official documentation: Stripe refunds and refund webhooks work in test mode; Vercel Hobby cron runs at most once per day; Plaid sandbox is free and self-serve; Sumsub has an official MCP server, a trial sandbox and a review-state simulation API; Middesk issues a sandbox key at account creation with business-name triggers for verified, in_review and failed; Persona KYB requires contacting their team. Not yet verified: actual signup success for Sumsub or Middesk, Middesk webhook signature scheme, the modeled state's premium tax rate and source.

Linear: authenticated in this session; the 16 domain tickets were listed read-only and left unchanged. Execution issues B0 to B14 created as YOA-609 to YOA-623 with acceptance criteria, blocking relations, evidence and estimates; a project status update was posted. No scenario was marked passed.

Written this session: docs/ATTACK-PLAN.md, docs/checkpoints/t-plus-2h-email.md (draft, Yoann sends), docs/PLAN.md, four decision entries in docs/DECISIONS.md. T+2h email: SENT by Yoann at 09:49 Europe/Zurich (07:49 UTC) on the candidate thread, reported by him and recorded at 2026-09-08T08:07:11+00:00. Checkpoint met; the thread header is authoritative.

## 2026-09-08T08:20:34+00:00 | B0 bootstrap and deploy: in progress, deployment live

Done: Next.js 16 app hand-written at the repository root (no create-next-app boilerplate), TypeScript strict, plain CSS; `db/client.ts` pool on the Neon pooled endpoint; `scripts/migrate.ts` runner applying `db/migrations/*.sql` once each inside a transaction; `GET /api/health`; gitleaks pre-commit hook in `.githooks/` (activated locally with `git config core.hooksPath .githooks`, to be documented in README); `.env.example` with placeholders. Vercel project `corgi-work-trial` linked and connected to the GitHub repository; Neon `corgi-trial-db` provisioned through the Vercel Marketplace and connected to all environments. Production URL: https://corgi-work-trial-iota.vercel.app

Checks actually run: `npm run typecheck` PASS; `npm run build` PASS; `npm run migrate` against Neon PASS (schema_migrations created, no migration yet); `curl https://corgi-work-trial-iota.vercel.app/api/health` from the dev machine returned HTTP 200 with database ok and revision 1e40dc7 (AF-01 evidence for this revision only; the app has no product behaviour yet). Stripe key verified as test mode (`sk_test_` prefix, account US, test balance call); no key value was printed. Assistant choices, minor: npm instead of pnpm (corepack broken locally), no Tailwind, no ORM.

Pending in B0: broker KYB provider access (Sumsub trial verified by signed API call at 2026-09-08T08:28:41+00:00 but KYB is Enterprise-only there, so Middesk signup is being attempted next; see DECISIONS.md), Stripe webhook endpoint (after B2 route exists), history secret scan result below, README setup section. Not started: everything from B1.

## 2026-09-08T08:59:18+00:00 | KYB decision, Stripe proofs, design review

Broker KYB: Stripe Connect Accounts v2 business verification in test mode, decided by Yoann (DECISIONS.md, 08:55Z entry). Verified on the sandbox: three test company accounts created (acct_1UDKmAK6R3nWBqMW verified fixture, acct_1UDKmDK6R39jqMi4 failed fixture showing `verification_failed_tax_id_match`, acct_1UDKmIK6R3fxfHN9 pending fixture), all `livemode: false`, v2 events emitted. Premium collection: test payment pi_3UDKq0K6R3v50tIy1mwQmeWT ($12.61, succeeded) and partial refund re_3UDKq0K6R3v50tIy11aPmuHK ($8.98, succeeded) through the Refunds API; balance transactions show a 67 cent Stripe fee, to be classified explicitly by reconciliation. These are feasibility probes, not product evidence; the probe objects stay in the sandbox with metadata `corgi_probe`. One synthetic probe applicant also exists in the Sumsub sandbox.

Design review: DESIGN FAIL recorded in docs/reviews/architecture.md (21 findings). docs/ARCHITECTURE.md revised at 08:50Z for the material findings; five items stay OPEN for Yoann (worked-example date, negative endorsement delta, closed-month revision rule, commission clawback rounding, modeled state and tax rate). Re-review requested after the open items are decided. Reviewer verdict allows B0 and B1 to proceed.

B0 remaining: the Stripe webhook endpoint on the deployed URL, delivered with slice B1a (protected tables, webhook inbox, route, endpoint registration, replay test) before the pro-rata functions (B1b).

Next acceptance criterion: B1a protected tables and webhook inbox, then B1b ledger posting and pro-rata math. Planned checks: `/api/health` reachable from outside with DB ok, gitleaks staged and history scans PASS, `.env.example` complete, sandbox accounts created within the 15-minute timeboxes or the blocker reported. Product AF-01 through AF-06 verification: NOT RUN (no product exists yet).

## Earlier status (kept as history)

Updated at 2026-09-08T07:13:45+00:00. Track: **1 — POLICY ADMINISTRATION**, explicitly selected by Yoann. Stack and providers: **UNSELECTED**. Repository currently contains instructions and preparation only; there is no product implementation or deployment.

Startup reads: original kit CLAUDE.md, AGENTS.md, WORKFLOW-48H.md and REVIEWER.md; released general and three track briefs supplied in the conversation, extracted in BRIEF-REFERENCE.md. Automatic-fail and readability rules were independently reviewed and corrected. Missing: separately supplied kickoff sandbox rules, chosen stack/providers, actual provider access and product acceptance evidence.

Local documentation is the working status source for this update; the Linear project overview now identifies Track 1, the pending stack discussion and the next-session handoff. Earlier general-rule and readability review corrections remain in force. Tickets YOA-593 (scope), YOA-595 (approval/MCP), YOA-599 (webhooks), YOA-600 (ledger) and YOA-601 (reconciliation) now carry the relevant released-brief overrides, with their existing unchecked scenarios preserved; there is no automatic synchronization. Its 162 checks are not completed tests.

Three independent Sol instruction reviews completed: brief coverage, financial/security rules, practical workflow/readability. Material findings were corrected and re-reviewed with scoped design PASS verdicts; see reviews/instructions-2026-09-08.md for initial findings, coordinator dispositions and minor post-review wording fixes. Product AF-01 through AF-06 verification: NOT RUN. Documentation changes do not establish passing product controls.

Next session: follow HANDOFF-PROMPT.md. Discuss at most two stack options, verify required sandbox access, then agree the stack and prepare the one-page attack plan. This session prepares the handoff only; no product implementation or finalized attack plan was requested. Logging is currently explicit, manual, sanitized entries in DECISIONS.md; no automatic prompt-capture hook or background review process is installed. At a material decision, scope change, completed slice or checkpoint, append a timestamped record identifying user decision versus assistant proposal and checks actually run.

Documentation verification: mandatory relative links resolve, original preparation archive SHA-256 values match its import manifest, and the three active kit copies agree. Gitleaks 8.30.1 was installed locally; a manual `gitleaks dir . --redact --no-banner --no-color` scan passed with no findings. This is a documentation-repository scan, not proof of product secret controls. No automatic hook/CI enforcement has been installed.

The Linear central checklist now has a released-brief override banner. Existing scenario states were preserved; no control was marked passed during these documentation edits.

## 2026-09-08T07:10:53+00:00 | Track 1 handoff

Yoann selected Track 1. Desired extension: one combined impact-preview and amount-explanation flow, after mandatory core correctness. Other brainstormed enhancements are optional. The next agent owns the stack discussion and attack-plan drafting with Yoann. Confirmation email is a draft for Yoann to send on the existing thread; no email was sent by the assistant. Personal explanatory HTML remains outside the repo and is not added to the decision log.

Linear handoff update: project renamed to Track 1: Policy administration, overview simplified into current action/core/differentiator/checkpoints, and YOA-593 linked to HANDOFF-PROMPT.md with its ten unchecked scenarios preserved. The 16 domain tickets remain reference material; detailed execution-backlog creation is deliberately assigned to the next session after stack and attack-plan agreement.
