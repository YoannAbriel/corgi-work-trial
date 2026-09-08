# Corgi: 48-hour delivery workflow

This kit prepares for the trial using the welcome page supplied on September 7, 2026. The detailed brief is not yet available. This document proposes a strategy; it is not Corgi's official evaluation rubric. Use English for project artifacts and French for direct collaboration with Yoann. Keep the trial's stated US financial scope; English-language communication does not establish additional UK regulatory obligations.

## Install the kit

Copy the full kit into the future repository root after reading its existing instructions; merge without overwriting them. Inventory: `AGENTS.md`, `CLAUDE.md`, `WORKFLOW-48H.md`, `REVIEWER.md`, `START-PROMPT.md`, `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`, `GAP-REVIEW.md`. The expected filename is `AGENTS.md`, plural. Reading the launch prompt and JSON is optional. Triage the checklist and advisory gap review at kickoff and review retained scenarios before handoff; read the stress protocol before the relevant tests.

`AGENTS.md` holds shared rules. `CLAUDE.md` explicitly requires reading them. `START-PROMPT.md` is a session launch aid, not a technical permission mechanism. No additional skill or agent framework is required for this trial.

## Translating the announced topics into implementation goals

| Announced topic | Proposed implementation goal | Useful evidence |
|---|---|---|
| KYC | Connect verified identity to server-side eligibility | Documented states, including ineligible/pending where supported by the sandbox |
| Payment rails | Initiate and track an operation on the assigned sandbox rail | Real provider reference and observed transitions |
| Webhooks | Receive and process events durably | Invalid signature rejected, duplicate without double effect, recoverable failure |
| Reconciliation | Detect differences between local and provider records | Missing webhook or injected discrepancy found by a new run |
| Operations Team | Enable incident diagnosis and recovery | Reference lookup, explicit state, reason, and traceable recovery |
| US-flavored | Respect USD and the US provider's states and conventions | Exact amounts; explicit currency, timezones, and relevant timing rules |

Adapt sample states, rails, and tests to the actual brief. Do not assume Stripe, ACH, a wallet, or a requirement to build a ledger.

## Indicative elapsed-time budget

| Window | Target outcome |
|---|---|
| H0-H2 | Read instructions and AI/submission rules; map requirements; start repository/services; verify sandbox access |
| H2-H6 | Complete a real API call and receive an authenticated webhook; reduce infrastructure uncertainty |
| H6-H14 | Run the minimal persisted business flow with KYC and a real sandbox operation as required |
| H14-H16 | Stable commit, status update, and restart instructions |
| H16-H24 | Sleep, meals, and buffer; the clock continues |
| H24-H32 | Harden duplicates, timeouts, concurrency, recovery, and reconciliation |
| H32-H38 | Complete required criteria, operator actions, and focused tests |
| H38-H42 | Verify clean-clone startup, migrations, deployment if required, and sandbox flow |
| H42-H46 | Freeze features; fix blockers; prepare README and demo |
| H46-H48 | Verify branch/SHA and submission requirements; submit with margin and confirm receipt |

If sandbox access blocks progress, verify credentials and the smallest available request, record the exact external blocker, then work on local contracts and error paths. Label mocks honestly. Adapt this budget to the brief. Do not wait until H42 to discover deployment or submission requirements. Start after a normal night's sleep with two clear days; confirm Europe/Zurich if that is the intended timezone.

## Establish the end-to-end flow early

Depending on the requested product: test identity → actual KYC state → server-authorized action → sandbox request → persisted reference → authenticated event → visible state → reconciliation against provider records.

Establish the flow early, then demonstrate three incidents: duplicate submission of one intent, a response lost after provider acceptance, and a missing webhook. Prevent double effects and show how the correct state is recovered.

## Keep agents focused

Assign one observable task at a time. Example: 'Add a durable webhook inbox. Prove that two concurrent deliveries of the same event update the payment only once and that interrupted processing can resume.'

Before a new session, update `docs/STATUS.md`: working behavior, evidence and commands, blockers, exact next change, branch, and commit. Do not copy the entire conversation history.

## Demo and handoff

Prepare a short demonstration: problem solved, nominal sandbox flow, incident and recovery, reconciliation, and known limitations. Keep nonsensitive test references that allow operations to be located.

The README must make execution possible without guessing variables, migrations, commands, or webhook configuration. State what was actually tested, what was simulated, and what remains incomplete. Do not claim compliance or production readiness solely from sandbox success.

## Technical preparation sources

Stripe provides one example of a contract requiring raw-body verification and allowing duplicated or out-of-order events: [receiving webhooks](https://docs.stripe.com/webhooks). Verify the assigned provider's actual contract at kickoff.

Stable-key request recovery is illustrated in [Designing robust and predictable APIs with idempotency](https://stripe.com/blog/idempotency). Provider support does not replace local persistence and constraints.

## Mandatory independent review

Independent review is Yoann's requested workflow, not an announced Corgi evaluation criterion. First verify that trial rules permit sub-agents; otherwise use an allowed independent review and record the constraint. Use `REVIEWER.md` for initial architecture, each bounded feature, and final integration. Include review time in each increment instead of postponing it until the end.

Review applicable requirements using current official sources, then trace every relevant path, including direct APIs, jobs, webhooks, and admin actions. Map requirements to controls and test evidence. Keep laws, guidance, provider contracts, and engineering practices distinct.

Before implementation, use DESIGN PASS, DESIGN FAIL, or DESIGN BLOCKED based on planned flows and controls. DESIGN PASS permits implementation; it does not approve a completed feature. Feature/integration reviews use PASS, FAIL, or BLOCKED based on code and actual evidence. Correct and independently recheck material findings. Unresolved material applicability questions block the affected scope; continue unrelated work. PASS applies to a defined scope and revision, not to a general legal certification.

## Tracking project

[Corgi Linear project](https://linear.app/yoannjobs/project/corgi-trial-readiness-resilience-and-us-compliance-0f574499f657/issues): 16 tickets and 162 numbered controls. Tickets hold live status and evidence. The central checklist and local files are preparation catalogs, without automatic synchronization. Stable IDs support reconciliation. If Linear is unavailable, explicitly select the local checklist as the temporary tracking source.
