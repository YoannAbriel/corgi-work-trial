# Corgi: 48-hour delivery workflow

The kit began as preparation on September 7, 2026. The full brief was supplied on September 8. Read `AUTOMATIC-FAILS.md` first: its six disqualification rules are mandatory for all tracks. The remaining workflow is a strategy, not a replacement for the official brief. Use English for project artifacts and French for direct collaboration with Yoann. Keep the trial's stated US financial scope; English-language communication does not establish additional UK regulatory obligations.

## Install the kit

The kit is installed at the trial repository root. When reusing its Downloads copy, merge into the destination after reading its existing instructions; do not overwrite unrelated work. Inventory: `AUTOMATIC-FAILS.md`, `READABLE-CODE.md`, `AGENTS.md`, `CLAUDE.md`, `WORKFLOW-48H.md`, `REVIEWER.md`, `START-PROMPT.md`, `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`, `GAP-REVIEW.md`. The expected filename is `AGENTS.md`, plural. Reading the launch prompt and JSON is optional. Select relevant checklist and gap-review scenarios after mapping official criteria, then review retained scenarios before handoff; read the stress protocol before the relevant tests.

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

Adapt sample states, rails, and tests to the actual brief. The released brief requires a deployed URL, an owned immutable double-entry ledger, at least two live sandbox integrations (three mandatory slots for Track 2), maker-checker, a working MCP surface with three read tools and one approval-queued write tool, and reconciliation with a breaks screen. Provider choices depend on the selected track and verified sandbox access.

## Official checkpoints and build order

Kickoff reported by Yoann: **September 8, 2026, 07:50 Europe/Zurich (05:50 UTC)**. The continuous 48-hour clock includes breaks and sleep.

| Deadline, Europe/Zurich | Required checkpoint |
|---|---|
| September 8, 09:50 | T+2h: one-page attack plan, three end-to-end use cases, providers, cut list v0 |
| September 9, 07:50 | T+24h: deployed URL with the required real sandbox money path working |
| September 10, 07:50 | T+48h: freeze and full submission package |

Start with the ledger/domain model, deployment and actual provider access. Integrate the required money path on day one. Budget day two for corrections, reconciliation, failure recovery, MCP, final integration review and submission evidence. Do not postpone deployment until the final hours. Track-specific live slots cannot be silently downgraded to mocks. Missing a checkpoint requires an honest explanation, not fabricated evidence.

Checkpoint and final emails belong on the official candidate thread; email timestamps govern checkpoints. Prepare drafts but do not send messages without Yoann's authorization. The final email contains exactly four items: URL with two-role credentials, repo link, video link (five minutes or less), and live-integration evidence pack. The repo contains the decision log, seed script, `.env.example`, cut list and week-two plan. Before sending, verify repository access for `@AlexanderReinicke` and `@mojafa` once invitations are authorized. Final recipient: `engineering-trial@corgi.com`; subject: `Work trial: your name, track number`, using the same candidate thread. Commits after freeze are ignored.

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
