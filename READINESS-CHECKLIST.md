# Corgi Trial: readiness, resilience, and compliance checklist

Prepared September 7; updated September 8, 2026 after receipt of the full brief. This is an advisory preparation catalog, not 162 mandatory trial deliverables. Product tests remain NOT RUN. Track, stack and providers remain unselected. The released brief and `AUTOMATIC-FAILS.md` override historical conditional guidance. Use English for project artifacts and French for direct collaboration with Yoann; the announced financial scope remains US-focused.

## How to record completion honestly

- [T]: technical trial control if the component exists. [C]: legal/product applicability must be determined with evidence. [P]: production preparation, conditional on the brief.
- Select relevant scenarios after mapping official requirements; reviewing or classifying every catalog row is not mandatory. Check only an evidenced PASS or an explicitly justified, reviewed N/A, and state which. FAIL, BLOCKED, and DEFERRED stay unchecked. Lack of time does not make an applicable requirement N/A.
- Per control, record ID, status, owner, applicability/reason, code reference/SHA, environment, command or manual steps, observed result, redacted evidence, reviewer, and date. One report may cover several IDs if coverage is explicit.
- An absent test is NOT RUN. DESIGN PASS does not replace execution. Local simulation does not prove third-party sandbox behavior.
- These are proposed engineering scenarios, not a transcription of a standard or an exhaustive compliance guarantee. Domain sources are starting points; map exact sections at kickoff. Legal thresholds/deadlines require the effective rule and an applicability decision.
- Hypothetical production-only legal questions remain in the production backlog. Material unknowns affecting a trial control block the affected scope.
- Inject failures only in disposable/local or explicitly authorized dedicated environments with restoration, stop, and cleanup plans. Do not degrade shared sandbox/CI resources. Simulate provider failures at the adapter boundary. Cap every load stage by the authorized traffic-specific budget; read `STRESS-TEST-PLAN.md` first. Do not implicitly provision paid services.

## Working order

Scope 01-02; review the architecture; secure 03-05; build 06-09; verify 10-12; instrument 14; execute 13 and 16; finalize 15-16. Numbers support tracking rather than imposing strictly sequential implementation.

## 01. Scope, applicability, and submission criteria

References/context:
- Full brief received September 8, 2026; see `docs/BRIEF-REFERENCE.md` in the trial repository. Track not selected; workflow safeguards requested by Yoann.

- [ ] **CRG-01-01 [T]** Map each official requirement to a feature, owner, evidence, and test; no brief requirement may remain without a ticket.
- [ ] **CRG-01-02 [T]** Inventory providers, rails, API versions, quotas, and test identities; verify access with an authorized request without exposing secrets.
- [ ] **CRG-01-03 [T]** Diagram data and money flows, actors, and trust boundaries; assign a purpose and owner to every external connection.
- [ ] **CRG-01-04 [C]** Identify consumer/business customers, responsible entities, states served, custody of funds, and jurisdictions; justify the applicability of each legal conclusion.
- [ ] **CRG-01-05 [T]** Classify retained controls as T/C/P and assign priority before their implementation; N/A needs a reason, and deferral does not mean PASS.
- [ ] **CRG-01-06 [T]** Check AI rules, permitted tools, code licensing, submission requirements, and the deadline; use only permitted independent review.
- [ ] **CRG-01-07 [T]** Complete a DESIGN review before sensitive flows; assess architecture and planned tests without claiming nonexistent code has been tested.
- [ ] **CRG-01-08 [T]** Set measurable latency, freshness, and recovery criteria before testing; proposed values are not Corgi requirements.
- [ ] **CRG-01-09 [T]** Plan an early sandbox end-to-end flow; when blocked, record the error and continue locally without presenting a mock as a real integration.
- [ ] **CRG-01-10 [T]** At handoff, every retained control has a status and each applicable requirement has evidence; distinguish complete delivery from disclosed gaps.

## 02. US rules, partner-bank responsibilities, and conditional compliance

References/context:
- [Official source](https://www.fincen.gov/resources/statutes-and-regulations/cdd-rule-faqs)
- [Official source](https://www.consumerfinance.gov/rules-policy/regulations/1005/10/)
- [Official source](https://www.consumerfinance.gov/rules-policy/regulations/1005/11/)
- [Official source](https://ofac.treasury.gov/recent-actions/20190502_33)
- [Official source](https://www.nacha.org/rules/risk-management-topics-fraud-monitoring-phase-2)
- [Official source](https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know)
- [Official source](https://www.pcisecuritystandards.org/faqs/1533/)

- [ ] **CRG-02-01 [C]** CIP/KYC: establish the governing regime and bank/application roles; translate the assigned policy into data requirements and controls without inventing thresholds.
- [ ] **CRG-02-02 [C]** KYB/CDD: for legal-entity customers, verify beneficial-ownership requirements and current exceptions, including FinCEN's 2026 changes; test applicable cases.
- [ ] **CRG-02-03 [C]** AML: identify who monitors and handles alerts; test authorized internal routing without automating a real regulatory filing.
- [ ] **CRG-02-04 [C]** OFAC: establish screening policy and match handling; simulate unavailability and false positives without treating sanctions screening as equivalent to KYC.
- [ ] **CRG-02-05 [C]** Regulation E: for covered consumer EFTs, verify authorizations, agreement copies, revocation, and stop-payment handling; test the behavior actually required.
- [ ] **CRG-02-06 [C]** Errors/disputes: where applicable, map intake, timestamps, deadlines, notifications, and any provisional credit to the governing text and entity role.
- [ ] **CRG-02-07 [C]** ACH/Nacha: for ACH, confirm roles, authorization, account validation, returns, and 2026 fraud controls with the provider; do not guess deadlines.
- [ ] **CRG-02-08 [C]** Cards/PCI: establish scope and responsibilities with the acquirer/provider; control sensitive data and prefer hosted collection.
- [ ] **CRG-02-09 [C]** GLBA/FTC or the competent regulator: determine applicable information safeguards, service-provider oversight, retention, and incident-notification requirements.
- [ ] **CRG-02-10 [P]** For the actual product, open targeted analysis of credit/ECOA/TILA/FCRA, state licensing, insurance, remittances, or FDIC representations; claim no coverage without evidence.

## 03. Authentication, authorization, and isolation

References/context:
- [Official source](https://owasp.org/www-project-application-security-verification-standard/)

- [ ] **CRG-03-01 [T]** Call every protected endpoint without a session and with an expired token; reject without leaks or financial effects.
- [ ] **CRG-03-02 [T]** Replace a customer, payment, export, or document ID with another user's ID; APIs, search, and downloads must deny access.
- [ ] **CRG-03-03 [T]** Test standard-user, operator, and administrator roles against an action matrix; enforce permissions on the server.
- [ ] **CRG-03-04 [T]** Remove a role during an active session; subsequent sensitive actions must respect revocation under the documented policy.
- [ ] **CRG-03-05 [T]** Attempt a forbidden action directly through the API when its button is hidden; the server must enforce the same control.
- [ ] **CRG-03-06 [T]** Verify session cookies, expiration, and logout; no secret or sensitive token may leak through URLs, logs, or error responses.
- [ ] **CRG-03-07 [T]** Test CSRF protections for cookie authentication and CORS configuration; a hostile origin cannot trigger an authorized action.
- [ ] **CRG-03-08 [T]** Test injection attempts in filters, search, metadata, and HTML rendering; validate input and protect queries and output.
- [ ] **CRG-03-09 [T]** For user-supplied URLs or uploads, test SSRF, file type/size, and file access; block unauthorized internal destinations.
- [ ] **CRG-03-10 [P]** Assess MFA/step-up authentication, service accounts, and separation of duties for critical operations; adapt decisions and tests to the product.

## 04. Sensitive data, secrets, and audit trails

References/context:
- [Official source](https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know)
- [Official source](https://www.pcisecuritystandards.org/faqs/1533/)

- [ ] **CRG-04-01 [T]** Scan the repository, relevant history, browser bundles, and CI artifacts; expose no secrets or real personal data.
- [ ] **CRG-04-02 [T]** Trigger KYC/payment failures; inspect logs, traces, and reports to verify sensitive-field redaction.
- [ ] **CRG-04-03 [T]** Verify placeholder-only .env.example, secrets outside Git, and test/live separation; fail explicitly on invalid configuration.
- [ ] **CRG-04-04 [T]** Inspect exports, browser caches, analytics tools, and screenshots; avoid unnecessary sensitive-data transfers.
- [ ] **CRG-04-05 [T]** Verify HTTPS and certificate validation on relevant connections; never disable TLS verification to make a test pass.
- [ ] **CRG-04-06 [C]** Define minimum storage, encryption, and retention by data type from applicable contracts/rules; do not invent a retention period.
- [ ] **CRG-04-07 [T]** Audit each replay, correction, and eligibility change with actor, time, reference, and reason; exclude secrets from audit records.
- [ ] **CRG-04-08 [T]** Verify ordinary APIs cannot modify financial history or audit records; corrections remain traceable.
- [ ] **CRG-04-09 [P]** Simulate key rotation/revocation and recovery of authorized access; verify obsolete keys do not persist in services.
- [ ] **CRG-04-10 [C]** For applicable deletion requests or legal holds, verify category-specific handling without deleting records that must be retained.

## 05. KYC, eligibility, and state transitions

References/context:
- [Official source](https://www.fincen.gov/resources/statutes-regulations/guidance/interagency-interpretive-guidance-customer-identification)
- Document the assigned provider.

- [ ] **CRG-05-01 [T]** Exercise KYC states actually available in the sandbox, including ineligible/non-final states where supported; save IDs and redacted results.
- [ ] **CRG-05-02 [T]** Submit incomplete or invalid forms; return understandable errors without inconsistent records or identity-data leaks.
- [ ] **CRG-05-03 [T]** Attempt payment before required eligibility through UI and API; initiate no financial effect.
- [ ] **CRG-05-04 [T]** Modify a KYC value in a browser request; the server must reject or ignore attempted self-approval.
- [ ] **CRG-05-05 [T]** Deliver conflicting KYC updates out of order; state must follow the documented version or authority.
- [ ] **CRG-05-06 [T]** Simulate KYC timeouts or unavailability; display the appropriate pending/unknown state and block dependent actions.
- [ ] **CRG-05-07 [T]** Repeat case creation after a lost response; recover the existing intent without inconsistent concurrent cases.
- [ ] **CRG-05-08 [T]** Revoke eligibility between form entry and execution; recheck at the point of effect under the applicable policy.
- [ ] **CRG-05-09 [C]** For additional documents/information, test expired links, resubmission, and cross-customer access; restrict access and support recovery.
- [ ] **CRG-05-10 [T]** Resume a case after restart; preserve state and references without using real identities to work around sandbox limitations.

## 06. Payments, amounts, and idempotency

References/context:
- [Official source](https://stripe.com/blog/idempotency)
- Confirm the assigned rail and provider contract.

- [ ] **CRG-06-01 [T]** Test zero, negative, excessive precision, boundary, and very large amounts; use exact USD arithmetic and prevent overflow.
- [ ] **CRG-06-02 [T]** Submit the same intent by double-click and concurrent requests; create one business operation and one external effect.
- [ ] **CRG-06-03 [T]** Reuse a key with a different amount or beneficiary; return an explicit conflict without silently reinterpreting the request.
- [ ] **CRG-06-04 [T]** Simulate provider acceptance followed by a lost response; preserve an unknown outcome and recover the operation before resubmission.
- [ ] **CRG-06-05 [T]** Kill the process after acceptance but before saving the response; restart and recover without duplicate payment.
- [ ] **CRG-06-06 [T]** Repeat an intent after provider key retention expires; local protection must prevent an unintended new effect.
- [ ] **CRG-06-07 [T]** Simulate 429/5xx responses and business rejection; use bounded retries only when safe, with no loop on definitive rejection.
- [ ] **CRG-06-08 [T]** Receive accepted/pending and then settled states; display them distinctly without equating HTTP 200 with final settlement.
- [ ] **CRG-06-09 [C]** For cancellation, return, refund, or reversal, test permitted states/amounts, duplicate requests, and races with settlement.
- [ ] **CRG-06-10 [T]** Verify beneficiary/account isolation, limits, and eligibility immediately before the effect; earlier UI validation is insufficient.

## 07. Webhooks: authenticity, durability, and replay

References/context:
- [Official source](https://docs.stripe.com/webhooks)
- Stripe is an example; adapt to the actual contract.

- [ ] **CRG-07-01 [T]** Send invalid, missing, or expired signatures where applicable; reject without applying the payload.
- [ ] **CRG-07-02 [T]** Verify raw-body handling and account/environment context under the provider contract; reject events from another account.
- [ ] **CRG-07-03 [T]** Make the database unavailable before persistence; never acknowledge success while losing an authenticated event.
- [ ] **CRG-07-04 [T]** Deliver the same event repeatedly and concurrently; apply its financial transition once.
- [ ] **CRG-07-05 [T]** Deliver distinct events describing the same business effect; prevent duplication without suppressing a legitimate transition.
- [ ] **CRG-07-06 [T]** Deliver events out of order; prevent stale regressions while allowing legitimate returns and reversals.
- [ ] **CRG-07-07 [T]** Kill a worker during processing; event state and local effects must remain atomic or recoverable.
- [ ] **CRG-07-08 [T]** Replay failed and then processed events; recover the former without duplicating the latter.
- [ ] **CRG-07-09 [T]** Send unknown event types, malformed payloads, and a new version; handle explicitly, expose errors, and avoid a system-wide crash.
- [ ] **CRG-07-10 [T]** Test backlog, concurrent workers, and lease expiration; no event may remain stuck indefinitely or be silently lost.

## 08. Ledger, concurrency, and database integrity

References/context:
- The owned immutable double-entry ledger is an official requirement for ALL tracks and cannot be classified N/A. Select track-specific dimensions and available-funds semantics after choosing a track.

- [ ] **CRG-08-01 [C]** For local balances, keep every journal transaction balanced per currency; use SQL assertions to detect imbalance.
- [ ] **CRG-08-02 [C]** Concurrent debits against limited funds must not spend the same availability twice; test locking or equivalent constraints.
- [ ] **CRG-08-03 [C]** Separate available, reserved, and settled funds as required; pending funds must not become spendable incorrectly.
- [ ] **CRG-08-04 [T]** Force failure within a database transaction; partial writes must not violate an invariant.
- [ ] **CRG-08-05 [T]** Test uniqueness, foreign-key, and amount constraints under concurrent writes, not only through service-level tests.
- [ ] **CRG-08-06 [C]** Correct through a compensating entry linked to the original; preserve history and prevent duplicate correction.
- [ ] **CRG-08-07 [T]** Test delayed reads or stale caches against writes; sensitive decisions must not rely on uncontrolled stale state.
- [ ] **CRG-08-08 [T]** Test migrations against existing data and interruption; recover coherently without silent data destruction.
- [ ] **CRG-08-09 [P]** Restore a backup into an isolated environment; compare operations/journal and measure acceptable loss and recovery time.
- [ ] **CRG-08-10 [P]** Document restore limits: a database rollback does not cancel external payments; reconcile before resuming operations.

## 09. Reconciliation and financial discrepancies

References/context:
- Proposed engineering controls; confirm the assigned provider API/reporting.

- [ ] **CRG-09-01 [T]** Compare references, currency, amount, and status between local data and a defined external source; document authority and time window.
- [ ] **CRG-09-02 [T]** Omit a webhook from the scenario; reconciliation must detect the divergence independently of the inbox.
- [ ] **CRG-09-03 [T]** Inject local-only and provider-only operations; classify them separately without blindly creating a payment.
- [ ] **CRG-09-04 [T]** Inject amount/currency mismatches and stale statuses; show discrepancies with references and explanations.
- [ ] **CRG-09-05 [T]** Fetch multiple pages, then fail one page; report an incomplete run, never a clean reconciliation.
- [ ] **CRG-09-06 [T]** Repeat the same overlapping window twice; create no duplicate entries or corrections.
- [ ] **CRG-09-07 [T]** Test late events, day boundaries, and daylight-saving changes; windows/cursors must not skip relevant operations.
- [ ] **CRG-09-08 [C]** If fees/net/settlement data exist, distinguish gross, fees, net, expected timing differences, and actual discrepancies.
- [ ] **CRG-09-09 [T]** Interrupt and rerun the job; make recovery and run summaries traceable without silently removing discrepancies.
- [ ] **CRG-09-10 [T]** Run reconciliation, webhooks, and operator correction concurrently; converge with a single financial effect.

## 10. Dashboard: accuracy, usability, and permissions

References/context:
- [Official source](https://www.w3.org/TR/WCAG22/)
- Proposed product controls; adapt to the views required by the brief.

- [ ] **CRG-10-01 [T]** Verify totals, filters, and pagination against a known dataset; display currency, amount, timezone, and last-update time explicitly.
- [ ] **CRG-10-02 [T]** Distinguish zero, empty data, loading, forbidden access, and failure; never replace a failed balance lookup with USD 0.
- [ ] **CRG-10-03 [T]** Find an operation by internal/provider ID; provide a coherent timeline through KYC, webhook processing, and reconciliation.
- [ ] **CRG-10-04 [T]** Test sorting and pagination during concurrent updates; do not silently create phantom or missing operations.
- [ ] **CRG-10-05 [T]** Show pending/failed/unknown states and a useful next action; never infer settled status from a browser redirect.
- [ ] **CRG-10-06 [T]** Test keyboard navigation, focus, labels, contrast, and error/status announcements; critical actions must work without a mouse.
- [ ] **CRG-10-07 [T]** Switch customers/accounts rapidly; an old screen's response must not overwrite the new context.
- [ ] **CRG-10-08 [T]** Test mobile layouts, zoom, and long amounts/references; keep critical actions and status information visible.
- [ ] **CRG-10-09 [T]** Apply list permissions to exports and detail views; prevent leaks through CSV, URLs, or search.
- [ ] **CRG-10-10 [C]** For bulk actions, confirm scope, handle partial success, and retry without repeating already accepted operations.

## 11. Dashboard failures, stale caches, and degraded operation

References/context:
- [Official source](https://sre.google/sre-book/monitoring-distributed-systems/)
- Agent-proposed scenarios for the visualization dashboard.

- [ ] **CRG-11-01 [T]** Fail one widget; other views remain usable and the affected widget shows an identifiable error.
- [ ] **CRG-11-02 [T]** Simulate dashboard API 500s and timeouts; show explicit errors and safe retry without endless spinners or false success.
- [ ] **CRG-11-03 [T]** Disconnect the network after payment submission; recover the existing intent when connectivity returns.
- [ ] **CRG-11-04 [T]** Close or reload the tab during an action; server-side processing continues and remains discoverable.
- [ ] **CRG-11-05 [T]** Expire the session during reads/actions; deny access cleanly without automatically repeating financial actions after login.
- [ ] **CRG-11-06 [T]** Disconnect SSE/WebSocket/polling if present; show freshness and resume updates without duplicate subscriptions.
- [ ] **CRG-11-07 [T]** Serve very stale cache data; label it stale and revalidate sensitive actions on the server.
- [ ] **CRG-11-08 [T]** Trigger a JavaScript exception or missing chunk after deployment; provide recovery without submitting the form twice.
- [ ] **CRG-11-09 [T]** Make the dashboard completely unavailable; webhook ingestion, workers, and reconciliation must not depend on the browser.
- [ ] **CRG-11-10 [T]** If the provider or monitoring dashboard fails, diagnose through authorized APIs/logs/commands and independent alerts without bypassing permissions.

## 12. Infrastructure and dependency resilience

References/context:
- [Official source](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)

- [ ] **CRG-12-01 [T]** Simulate provider DNS/TLS/connection failures; bound timeouts, expose state, and release resources.
- [ ] **CRG-12-02 [T]** Inject latency, 429, 503, and Retry-After; enforce a global retry budget to prevent amplification and synchronized storms.
- [ ] **CRG-12-03 [T]** Stop and restart workers and servers; recover durable work without losing acknowledged operations.
- [ ] **CRG-12-04 [T]** Simulate database unavailability and pool exhaustion; fail cleanly without financial calls lacking durable intent.
- [ ] **CRG-12-05 [T]** Simulate deadlocks/transaction conflicts; retry only safe units without repeating provider effects.
- [ ] **CRG-12-06 [T]** If a cache exists, make it unavailable; preserve authorization and idempotency protections under documented fallback behavior.
- [ ] **CRG-12-07 [T]** Simulate a poison message; isolate it with bounded retries while other messages continue.
- [ ] **CRG-12-08 [T]** Stop an instance during deployment; drain work or recover leases and in-flight operations coherently.
- [ ] **CRG-12-09 [T]** Shift the test clock; verify expiration, signatures, and time windows without disabling protections.
- [ ] **CRG-12-10 [P]** Test zone/service failure and recovery for the actual architecture; measure RTO/RPO without inventing a multi-region system.

## 13. Stress testing, load, spikes, and endurance

References/context:
- [Official source](https://grafana.com/docs/k6/latest/)
- [Official source](https://grafana.com/docs/k6/latest/using-k6/thresholds/)

- [ ] **CRG-13-01 [T]** Define an isolated environment, authorized URLs, budget, synthetic dataset, caps, and emergency stop; do not heavily load a third party without authorization.
- [ ] **CRG-13-02 [T]** Establish a baseline and realistic read/action/webhook mix; record hardware, version, dataset, and the actual emitted load.
- [ ] **CRG-13-03 [T]** Load smoke test: one user or very low throughput for one minute; validate scripts, business assertions, and cleanup before ramping up.
- [ ] **CRG-13-04 [T]** Nominal load: sustain target throughput L for ten minutes; measure p50/p95/p99, unexpected errors, queues, and saturation.
- [ ] **CRG-13-05 [T]** Progressive stress: 0.5L, L, 1.5L, and 2L for three minutes per stage; identify degradation without exceeding authorized limits.
- [ ] **CRG-13-06 [T]** Spike: move from 0.2L to 3L for sixty seconds, then return; verify controlled rejection, draining, and recovery to nominal behavior.
- [ ] **CRG-13-07 [P]** Breakpoint: increase load to the agreed stop threshold; document capacity, bottleneck, and headroom without continuing to destruction.
- [ ] **CRG-13-08 [T]** Trial soak: thirty to sixty minutes at L; check memory/connection leaks and backlog growth. Plan a separate four-to-eight-hour production extension.
- [ ] **CRG-13-09 [T]** Business concurrency: contend on the same keys, accounts, and events; allow no duplicate effects, unbalanced entries, or cross-customer leaks.
- [ ] **CRG-13-10 [T]** Under load, slow the simulated provider and restart a worker; verify backpressure, retry amplification, and recovery.
- [ ] **CRG-13-11 [T]** Measure dropped iterations, generator load, and per-endpoint errors; do not claim good performance when the generator failed to produce the load.
- [ ] **CRG-13-12 [T]** After every run, reconcile accounts/operations and verify invariants; attach raw reports, thresholds, and results, not just an HTTP average.

## 14. Observability, alerts, and runbooks

References/context:
- [Official source](https://sre.google/sre-book/monitoring-distributed-systems/)
- [Official source](https://csrc.nist.gov/pubs/sp/800/61/r3/final)

- [ ] **CRG-14-01 [T]** Correlate requests, operations, provider references, events, and reconciliation runs using nonsensitive IDs.
- [ ] **CRG-14-02 [T]** Measure latency, throughput, errors, and saturation per component/endpoint; distinguish expected business rejection from failure.
- [ ] **CRG-14-03 [T]** Track oldest-event age, backlog, unknown outcomes, KYC failures, and discrepancies; a live worker does not prove work is processed.
- [ ] **CRG-14-04 [T]** Trigger a deliberate test alert; verify delivery to an authorized destination and a linked runbook.
- [ ] **CRG-14-05 [T]** Disable metric collection or the monitoring dashboard; detect missing telemetry instead of showing everything as healthy.
- [ ] **CRG-14-06 [T]** Test logging failure or disk exhaustion without silent financial loss; distinguish critical audit records from diagnostic logs.
- [ ] **CRG-14-07 [T]** Write procedures for unknown payments, missing webhooks, discrepancies, and provider outages; test at least one guided recovery.
- [ ] **CRG-14-08 [T]** If a pause control exists, test stopping new financial effects while preserving safe reads/reconciliation and authorized resumption.
- [ ] **CRG-14-09 [P]** Define owners, incident severity, escalation, RTO/RPO, and communications; simulate an outage without sending real customer notifications.
- [ ] **CRG-14-10 [C]** For a simulated leak, trace containment, rotation, evidence preservation, and review of applicable notifications by the designated owner.

## 15. Git, CI, migrations, and deployment

References/context:
- Proposed engineering controls; confirm repository and hosting conventions.

- [ ] **CRG-15-01 [T]** Start from a clean clone with lockfiles and pinned versions; install, migrate, and run without implicit steps.
- [ ] **CRG-15-02 [T]** Run required lint, type checks, tests, and build; a failure must not produce a green CI result.
- [ ] **CRG-15-03 [T]** Check secrets and vulnerable dependencies; address applicable risks and record justified exclusions.
- [ ] **CRG-15-04 [T]** Keep coherent, reviewed commits; do not overwrite unrelated changes or force-push shared history.
- [ ] **CRG-15-05 [T]** Deploy with explicit sandbox configuration; verify the actual URL, version, and provider account.
- [ ] **CRG-15-06 [T]** Test migrations against representative synthetic data; verify old/new code compatibility during transition where needed.
- [ ] **CRG-15-07 [T]** Test a data-compatible rollback or roll-forward; never claim a code rollback cancels an external payment.
- [ ] **CRG-15-08 [T]** Test health/readiness and required routes externally; webhooks must reach the correct environment.
- [ ] **CRG-15-09 [T]** After deployment, run positive and negative smoke tests and inspect errors; confirm the tested SHA is the submitted SHA.
- [ ] **CRG-15-10 [P]** Assess CI permissions, branch protection, artifact provenance, and restoration; use only authorized repository mechanisms.

## 16. Test campaigns, evidence, and final handoff

References/context:
- Validation workflow requested by Yoann; official brief pending.

- [ ] **CRG-16-01 [T]** Unit suite: amounts, transitions, eligibility, and discrepancy classification; test invariants rather than implementation details alone.
- [ ] **CRG-16-02 [T]** Database suite: constraints, concurrency, transactions, and restart; use the relevant engine rather than a misleading mock.
- [ ] **CRG-16-03 [T]** Contract suite: documented provider payloads, errors, and versions; label synthetic fixtures and distinguish sandbox verification.
- [ ] **CRG-16-04 [T]** Sandbox E2E suite: KYC → operation → webhook → dashboard → reconciliation; retain references and redacted evidence.
- [ ] **CRG-16-05 [T]** Security suite: cross-customer access, direct APIs, secret leakage, and signatures; every applicable control needs a negative test.
- [ ] **CRG-16-06 [T]** Resilience suite: lost response, duplicate, missing event, worker outage, and broken dashboard; verify recovery and integrity.
- [ ] **CRG-16-07 [T]** Performance suite: execute selected profiles from ticket 13 against thresholds fixed beforehand; mark other profiles not run.
- [ ] **CRG-16-08 [T]** Obtain independent feature and integration reviews; preserve findings, fixes, SHAs, and re-review history.
- [ ] **CRG-16-09 [T]** Resolve every row to PASS, FAIL, BLOCKED, justified N/A, or DEFERRED; never present an unresolved applicable blocker as completed.
- [ ] **CRG-16-10 [T]** Submit the README, commands, limitations, reports, and demo; verify remote/SHA/URL and actual submission confirmation with time to spare.

## Live tracking

[Linear project and tickets](https://linear.app/yoannjobs/project/corgi-trial-readiness-resilience-and-us-compliance-0f574499f657/issues), [central catalog](https://linear.app/yoannjobs/document/handoff-checklist-162-controls-and-test-scenarios-21c639ee5dfe), [stress protocol](https://linear.app/yoannjobs/document/stress-testing-protocol-thresholds-and-recovery-5aaf7263f6d1). Tickets hold live statuses/evidence. Local files and the central document are preparation catalogs without automatic synchronization. No product tests were executed when this catalog was created.
