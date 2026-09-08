# Corgi work trial: engineering operating instructions

## Non-waivable automatic fails

Read [AUTOMATIC-FAILS.md](AUTOMATIC-FAILS.md) in full before any implementation or delegation, including after a context reset. Its six bans apply to every agent, code path, script and delivery claim. Include it in every reviewer assignment. It overrides conflicting historical preparation guidance. Missing evidence cannot be marked PASS; stop an affected prohibited operation and report it.

## Candidate-readable implementation

Read [READABLE-CODE.md](READABLE-CODE.md) before writing or reviewing code. Prefer explicit business logic, descriptive names, visible state transitions, short reading paths and concrete examples. Keep technical test results separate from Yoann's confirmed understanding. **Track selection remains open.**

## Mission and scope

Deliver a working, reviewable solution to the actual Software Engineer (Operations Team) trial within the continuous 48-hour window. The full general brief and all three track briefs were supplied on September 8, 2026. All tracks require an accessible deployment, an owned immutable double-entry ledger, genuinely live sandbox integrations, robust webhooks, backdated corrections, maker-checker, reconciliation, a working MCP surface and a running decision log. Track selection remains open; apply the selected track's additional requirements.

Read the released brief, repository instructions and provider documentation before choosing an implementation. Record confirmed requirements separately from assumptions. Follow the trial's rules on tooling, AI assistance and submission. Never invent compliance requirements, provider behavior or completed tests.

Prefer the existing stack and a small deployable application with a durable database. Add services only when an acceptance criterion or demonstrated failure requires them. Use French when discussing work directly with Yoann. Keep all Corgi artifacts, code, documentation, tickets, reviews, and submission materials in English.

## Mandatory reading and execution gates

These instructions apply to the coordinating agent and every delegated sub-agent. Before implementation, read this entire file, `WORKFLOW-48H.md` and `REVIEWER.md`, then the official brief, repository README and applicable repository instructions. Read existing planning/status/decision/compliance records and reviews relevant to your assigned scope. `CLAUDE.md` is an entry-point router; `START-PROMPT.md` is an optional launch aid, not an additional rule source.

The delivery loop, engineering safeguards, independent reviews and evidence-based handoff are mandatory user-requested workflow controls, not additional official Corgi deliverables. Select the smallest implementation of relevant controls for the released product and provider; do not add unrelated features. The sample 48-hour allocation is indicative and may be adjusted with a recorded rationale. Conditional controls apply when relevant to the product; explain non-applicability rather than silently omitting them. The official brief governs deliverables and trial policies. If a material conflict remains, record it and ask Yoann; do not silently waive a required control.

Before the first implementation step of a session, provide a short startup receipt listing files actually read, absent files, the next acceptance criterion and its planned checks. The coordinator records its receipt in `docs/STATUS.md` when the trial repo is available. Delegates return receipts to the coordinator; reviewers include theirs in their assigned review record. Only the coordinator edits shared planning/status/compliance files unless exclusive ownership is explicitly delegated. Never claim a read without actually opening the content. If a mandatory kit file is missing or unreadable, restore it or report the blocker before dependent implementation. If the official brief is unavailable, limit work to preparation. Planning/status files may be created at kickoff; do not pretend they already existed.

After context reset/compaction, reread this entire file, `WORKFLOW-48H.md`, `REVIEWER.md` and current status before resuming code changes, and provide a fresh short startup receipt using the same ownership rules. Read updated instructions again when they change.

When delegating, pass the repository location, concrete scope, relevant commit/diff, mandatory reading list and expected evidence. Require the sub-agent to report its actual reads and checks. Never assume the parent conversation or files were inherited. The coordinating agent remains responsible for integrating results and checking coverage across features.

Before marking any feature done, explicitly verify:

- Official acceptance criteria are mapped to implemented behavior and evidence.
- Applicable financial, security and US/provider requirements are mapped to controls; exclusions have a rationale.
- Required checks passed, with commands and actual results; missing evidence remains visible.
- Independent review is PASS for the current code/diff; material fixes were re-reviewed.
- There are no unresolved material FAIL/BLOCKED findings in the feature scope.
- Documentation, recovery instructions and status reflect the implementation.

Before final handoff, repeat this gate for the integrated system, including cross-feature bypass paths and all official submission requirements. If a gate is not satisfied, report the work as incomplete with the exact gap. Do not downgrade a requirement merely to meet the deadline.

These files express mandatory workflow instructions, not a technical enforcement mechanism or proof of zero defects. Where supported by the actual trial repository, use required CI checks and independent review gates to enforce objective conditions. A checklist receipt does not replace execution evidence or reviewer judgment.

## Start of every session

1. Complete the Mandatory reading and execution gates above, including the methodology, reviewer procedure, brief, README and existing scope-relevant records.
2. Inspect `git status`, current branch and recent commits. Preserve existing work.
3. Identify remaining time, the next acceptance criterion and its biggest unresolved risk.
4. State a small implementation step and how it will be verified; then execute it.

At kickoff, create a concise `docs/PLAN.md` mapping each requirement to implementation, acceptance test and evidence. Create `docs/STATUS.md` for completed work, open issues, exact next step and checks actually run. Record consequential tradeoffs in `docs/DECISIONS.md`; avoid paperwork for routine choices.

## Delivery loop

Work in small vertical slices: user action → persisted operation → provider sandbox → webhook → visible state → reconciliation. Establish a real sandbox round trip early. Mocks support automated tests but do not count as sandbox integration evidence.

For each slice: define expected behavior and failure behavior; implement the smallest coherent change; run relevant checks; review the diff; record evidence and commit. If blocked, identify the exact missing credential, API behavior or requirement and continue independent work. Do not silently replace a required integration with a mock.

Prioritize required acceptance criteria and money correctness, then operational recovery and demo clarity, then polish. Timebox investigations. Avoid unrelated refactoring, framework changes and speculative abstractions.

## Financial invariants

- Represent USD using integer cents or exact decimal types. Never use binary floating point for monetary arithmetic. Validate precision, currency, sign and limits at boundaries.
- Keep internal IDs, provider IDs, business operation IDs and event IDs distinct and traceable.
- An accepted API request is not proof of settlement. Model lifecycle states from the actual rail and provider. Represent unknown outcomes explicitly; support returns/reversals when applicable.
- Protect sensitive actions with authentication, authorization and ownership checks. Enforce payment eligibility on the server using the brief's KYC and product rules.
- Use database transactions, unique constraints and concurrency control for invariants. Do not rely on in-memory locks or UI button disabling for correctness.
- Every track requires the application's own double-entry, append-only immutable ledger. Every external money event must be journaled; all displayed balances must derive from it, including historical balances. Provider balances cannot replace it. Never UPDATE or DELETE money rows; correct with reversal entries plus a re-book. Follow AF-03 in `AUTOMATIC-FAILS.md`.
- Persist timestamps in UTC; label displayed timezones and interpret provider business dates/cutoffs explicitly. Do not assume every US rail runs synchronously or 24/7.

## KYC

- Use the assigned provider's sandbox and approved test identities. Prefer hosted collection/tokenization where supported and appropriate.
- Map provider statuses explicitly to local eligibility: pending, approved, rejected or review-needed are illustrative, not assumed API values.
- Enforce allowed transitions and handle delayed updates, additional-information requests and provider failures according to the documented contract.
- Default to blocking eligibility-dependent actions while eligibility is unknown. Do not let browser input grant approval.
- Store only required data. Do not put SSNs, identity documents, bank details, secrets or raw sensitive payloads in logs, fixtures, Git or screenshots.
- Verify the actual documented KYC states, including ineligible and non-final paths where supported. Record sandbox limitations; use clearly labeled local fixtures for unavailable scenarios without claiming provider evidence. Verify unauthorized access and eligibility checks at execution time.
- Implement the trial's specified US rules. Do not claim that sandbox KYC proves legal compliance or invent a regulatory policy.

## Payments and outbound requests

- Persist a durable operation and stable idempotency key before initiating a financial side effect. Bind the key to the business intent and canonical request parameters.
- Repeated submission of the same intent must return/recover the existing operation. Reject conflicting parameters under the same key. A deliberate new payment needs a new intent.
- Use provider idempotency when supported, following its exact scope and retention window. Local deduplication remains necessary.
- A timeout can mean the provider accepted the request. Recover by stable key, provider reference or lookup before considering resubmission. Without a safe recovery mechanism, mark the outcome unknown and surface it for resolution.
- Retry only documented transient errors with bounded backoff/jitter and rate-limit handling. Never blindly retry a financial side effect with a new key.
- Account for crashes between provider acceptance and local persistence. Keep a recoverable operation record; use an outbox/worker when needed to close the database-to-network gap.
- Verify duplicate and concurrent submission, rejection, timeout-after-acceptance and restart recovery.

## Webhooks

- Verify authenticity using the provider's documented mechanism, preferably its SDK, including raw request bytes and timestamp tolerance when required. Do not assume all providers use Stripe's scheme.
- Validate the event envelope and provider/account context. Treat payload content as untrusted input.
- Persist an authenticated event durably before acknowledging success, or commit the full processing transaction first. If persistence fails, return the provider-appropriate retry response.
- Deduplicate with a database uniqueness constraint scoped to provider/account/event ID. Also guard business transitions against distinct events describing the same financial effect.
- Persist authenticated event facts, money-relevant payload and provenance append-only. Keep mutable processing leases, attempts and sanitized errors in a separate nonfinancial delivery table, or append attempt events. Never UPDATE or DELETE the financial event to change retry metadata. An already-stored event is not necessarily processed: failed or interrupted work must remain recoverable.
- Commit event completion and local financial effects atomically. Outbound side effects require their own idempotency/recovery mechanism.
- Do not assume ordering or exactly-once delivery. Reject stale state regressions using documented versions or authoritative retrieval, while allowing legitimate returns and reversals.
- Provide bounded retry and a failed-event view or command with safe replay. Record attempts and sanitized errors.
- Verify invalid authentication, duplicate delivery, concurrent duplicate delivery, out-of-order updates, processing failure and restart/replay.

## Maker-checker and MCP

- Record the selected threshold and its track-specific money-out applicability, distinguishing an assumption from an official rule. No invented threshold is a regulatory fact.
- Queue above-threshold money-out durably before any provider side effect. Bind approval to the immutable intent, amount, beneficiary and version. A changed intent needs fresh approval; do not reuse an approval for different parameters.
- The approving actor must be a distinct authorized human. The initiator cannot approve their own action. Agents cannot approve, including through human endpoint impersonation or admin shortcuts.
- Enforce the same gate server-side across UI, direct API, worker, admin and MCP paths, rechecking eligibility/approval before execution. Make concurrent execution and retries produce at most one financial effect.
- Implement at least three read MCP tools and one write tool that creates a request in the human approval queue, not a direct money movement. Document operations never delegated autonomously and why. Apply authorization and tenant isolation to read tools too.
- Test self-approval, agent approval, unauthorized/cross-tenant requests, changed intent after approval, direct endpoint bypass and concurrent execution.

## Historical queries and corrections

Preserve effective/value time, recorded/booking time and immutable correction lineage. After track selection, define which historical query answers business-time truth, which answers what was known then, and how published statement revisions remain reproducible alongside corrected views. Record interpretations and unresolved questions explicitly; do not label an assistant's proposed interpretation as Corgi's answer.

## Reconciliation

- Build a rerunnable job comparing the provider's authoritative records against the application's owned ledger, with a screen showing breaks and their age. Local operation records can supplement diagnosis but cannot replace the ledger comparison. The job must work independently of webhook receipt.
- Define the source, account, time window, cursor/pagination, timezone and cutoff semantics. Use a deliberate overlap or equivalent strategy for late updates and deduplicate it.
- Compare stable references, amount, currency and lifecycle status. Account for fees, net/gross amounts and settlement timing only where the provider/product exposes them.
- Classify matched records, local-only records, provider-only records, amount/currency mismatches, stale states and timing differences.
- Save a run summary with counts, discrepancies and errors. An incomplete/failed fetch must never be reported as a clean reconciliation.
- Never silently overwrite history to force agreement. Safe documented repairs must be idempotent and auditable; unresolved mismatches remain visible.
- Verify a missing webhook, seeded discrepancy, provider outage and repeated run without duplicate financial effects.

## Operations and security

- Provide the smallest useful view or CLI for tracing customer → operation → provider reference → event → reconciliation result.
- Show actionable pending/failed/unknown states, last update, sanitized failure reason and recovery action. Protect replay/retry/manual actions with authorization and audit records.
- Use structured, redacted logs with correlation IDs, not full request/response bodies. Never expose credentials in terminal output or documentation.
- Keep sandbox/live configuration explicit. Use only assigned sandbox resources and synthetic test data for this trial.
- Provide `.env.example` with placeholders, migrations, setup commands and health checks appropriate to the deployment.

## Git hygiene

- Inspect repository conventions before branching. Use one short-lived trial branch unless the submission instructions require another workflow.
- Keep commits small and coherent, with meaningful descriptions such as `feat: persist webhook inbox before acknowledgment`.
- Stage explicit files or hunks. Inspect `git diff --cached` and run relevant checks before committing. Keep code, migrations and their tests together.
- Ignore secrets, `.env` files except examples, local databases, logs, sensitive fixtures and generated clutter. Preserve lockfiles and necessary migrations.
- Do not overwrite others' changes, rewrite shared history, force-push or run destructive cleanup as routine maintenance.
- Push checkpoints only to the authorized trial remote and branch. Never publish trial code to a public repository unless explicitly required/authorized.
- Before submission: inspect status and diff, run final checks, verify the expected commit is on the required remote branch, and record its SHA. Do not claim a push or deployment succeeded without checking it.

## Verification and handoff

Use focused tests for financial invariants and failure recovery, integration tests for persistence/provider boundaries, and one documented real sandbox end-to-end run. Run the repo's required lint/type/build/test checks. Mark every result as passed, failed or not run, with commands and reasons where needed.

The handoff must let a reviewer start from a clean clone: prerequisites, environment placeholders, install, migration, run, test, webhook setup, sandbox scenario, reconciliation command and expected result. Include known limitations and the main tradeoffs. Only document commands that exist and distinguish automated fixtures from real sandbox evidence.

Record the final integrated gate, reviewed implementation reference, actual checks, remaining limitations and submission evidence in a Final handoff section of `docs/STATUS.md`. Distinguish a complete submission from a disclosed incomplete submission.

Before stopping a session, update `docs/STATUS.md` with the branch/commit, completed acceptance criteria, test results, outstanding risks and the next executable step. Never claim the task is complete while required criteria remain unverified.

## Mandatory independent feature review

Every bounded feature requires an independent reviewer sub-agent before being marked done, subject to the trial's AI-assistance rules. If sub-agents are prohibited, use an independent reviewer permitted by those rules; if none is available, report review as pending. Never violate the trial policy to satisfy this workflow. A feature is a bounded acceptance criterion or coherent vertical slice listed in `docs/PLAN.md`; one review may cover several explicitly enumerated related criteria. Cosmetic edits do not each create a new feature. Read `REVIEWER.md` for its assignment and output contract. The implementer may fix findings but may not self-approve. If sub-agents are unavailable, record review as pending and request an independent human/session review; do not fabricate independence.

Review the initial architecture before implementing sensitive flows, each bounded feature diff before completion, and the integrated system before submission. Group related acceptance criteria into a small number of coherent money-path slices; do not create separate review ceremonies for every helper, cosmetic edit or document. Reuse unchanged evidence and keep each report concise. User-requested review remains mandatory, but broad hypothetical production research is not a prerequisite for a sandbox slice. Use the distinct design-review and implementation-review contracts in `REVIEWER.md`; a design PASS permits implementation but does not satisfy the feature completion gate. A feature review includes every affected endpoint, worker, webhook, scheduled job, admin action and provider integration, not just its UI. Reopen review after material changes to the reviewed code, architecture, requirements or applicable sources.

Maintain `docs/COMPLIANCE-MATRIX.md`: requirement ID, exact source/section/link, source type (law/regulation, guidance, rail/provider contract, trial requirement, engineering safeguard), date checked and effective date, applicability rationale, responsible entity, implementing control, code location, test/evidence and status. Distinguish proposed rules from effective rules. Do not infer applicability solely from USD or US customers.

Map product type, customer type, entities/roles, states served, rail, custody/funds flow, sensitive data and provider responsibilities before declaring a legal rule applicable. Unknown facts remain unresolved. Determine whether each unknown changes a required sandbox behavior or an identified applicable control. Material unknowns within that scope block its approval; unanswered questions solely about hypothetical production deployment are recorded as limitations, not silently treated as solved or expanded into extra trial deliverables. Consult current official sources, amendments, exceptions and assigned provider documentation. A sandbox integration is not proof of production regulatory compliance.

PASS means the reviewed scope meets identified applicable requirements with cited evidence and no unresolved material issue. FAIL requires correction. BLOCKED means applicability or evidence is materially missing; it is never an implicit pass. Block completion of the affected feature for either FAIL or BLOCKED, while continuing unrelated work. Escalate unresolved legal interpretation to Corgi's designated owner/compliance contact through Yoann; do not contact others automatically. Record incomplete scope honestly if the trial deadline arrives.

## Readiness checklist and stress campaign

At kickoff, map all official general and selected-track acceptance criteria first. `READINESS-CHECKLIST.md` is an advisory scenario catalog: select relevant high-risk checks without classifying all 162 entries. Map retained IDs to features and evidence. Before performance work, read `STRESS-TEST-PLAN.md`; use bounded local load and concurrency tests without stressing shared provider infrastructure. At final handoff, account for every official criterion and retained control with evidence or an explicit gap. Unselected catalog entries are not implementation gates. Do not waive official requirements or promote hypothetical production items into trial deliverables.

Linear tickets are the live source for readiness status and evidence when accessible. The central Linear checklist and local Markdown/JSON are preparation catalogs, not automatically synchronized status copies. If Linear is unavailable, select the local checklist as the working source and record that choice in STATUS; reconcile by control ID when access returns. Read the current status source at session restart. Never claim all tests passed because every item was merely triaged.

Use the kit inventory in `WORKFLOW-48H.md`. The coordinator consults [GAP-REVIEW.md](GAP-REVIEW.md) for relevant risks; delegates read only retained findings relevant to their scope. These findings refine verification and do not automatically add features or official requirements. Reading the JSON snapshot and launch prompt is optional; they add no authoritative rules.
