# Preparation gap review — three Sol audits

Date: 2026-09-07. Status: advisory preparation review; no product tests executed.

Three independent `gpt-5.6-sol` reviewers examined financial correctness/business abuse, test quality/resilience, and operations/workflow. They returned 21 candidate improvements. The coordinator compared them with the existing controls and consolidated them below. These are gaps in the specificity of the planned verification, not demonstrated defects in a Corgi implementation or newly established legal duties.

The detailed brief, assigned provider contract, and trial repository were unavailable to this review. The welcome page establishes US financial scope. English artifacts and a US/UK company context do not by themselves establish UK regulatory applicability.

## Adoption and evidence

Keep the existing 162 CRG controls and their IDs. GAP IDs identify advisory findings, not another automatically mandatory checklist. At kickoff, map relevant findings to existing CRG controls and feature acceptance tests. Record each candidate as adopted, not applicable with rationale, or deferred with limitation. An applicable official requirement cannot be deferred merely because this report is advisory. Avoid duplicate tickets for a more precise scenario under an existing control.

Priorities below are engineering recommendations: P0 means evaluate first when the stated behavior exists; P1 means useful targeted hardening; P2 means conditional scope or workflow refinement. They are not official trial priorities. A finding being adopted or triaged is not a test PASS. No candidate currently has execution evidence.

For retained scenarios, record feature/control IDs, owner, exact submitted SHA, environment, test command, expected and observed outcomes, redacted proof, and independent review. Injections run only in an isolated disposable environment under `STRESS-TEST-PLAN.md`. Missing injection activation makes that campaign inconclusive; map this to BLOCKED with the reason in live tracking, never PASS.

## Evaluate first

### GAP-01 — Independent financial expectations

P0; strengthens CRG-09-01/02, CRG-13-12 and CRG-16-01.

A test can agree with a defective implementation if both compute totals or transitions with the same production helper. Use a tiny hand-audited dataset with literal expected records: normal operation, duplicate, missing event, amount mismatch, stale state, and reversal where applicable. Check exact customer, operation, amount, currency, count and state, rather than only a balanced aggregate. Compare base records and reconciliation output without using the production mapper to calculate the expected answer.

Evidence: versioned inputs, independently calculated expected table, persisted-record diff, and reviewer check of oracle independence.

### GAP-02 — Critical tests must detect a deliberately broken invariant

P0; strengthens CRG-16-01/02 and CRG-15-02.

In an isolated temporary branch/worktree, introduce one small reversible defect in a money-critical path: bypass eligibility, allow a duplicate effect, or suppress mismatch detection. Run the owning suite and verify a meaningful failure. Restore the code and rerun. Scope this to the highest-risk implemented invariants; a large mutation-testing framework is unnecessary.

Evidence: injected defect, intended failing assertion, nonzero exit, restored clean diff and passing rerun. This checks test sensitivity, not exhaustive correctness.

### GAP-03 — Prove the fault reached the intended boundary

P0; strengthens CRG-06-04, CRG-07-07, CRG-12-01 through CRG-12-09 and CRG-13-10.

A response-drop rule that never fires proves no recovery behavior. Require a marker/counter/trace proving the exercised call reached the selected failure boundary, such as provider acceptance before response loss. Then verify recovery. Use a control run without injection when needed to establish causality.

Evidence: fault ID, activation marker, ordered boundary timestamps, control result and final invariant query. Without activation evidence, report inconclusive/BLOCKED.

### GAP-04 — Bind authenticated events to the correct business object

P0 when events mutate financial or eligibility state; strengthens CRG-07-01/02/05 and CRG-09-04.

A valid signature does not prove an event belongs to the intended local payment. Exercise unknown object references, wrong customer/sub-account, conflicting currency or immutable amount, and incorrectly reused provider references. Bind according to the actual provider contract; retrieve an authoritative object where notifications lack required fields. Do not invent amount equality across fees, partial operations or gross/net fields.

Expected: no incorrect state mutation; conflicting events remain durably diagnosable and recoverable. Evidence: contract fixtures, zero-effect assertions, quarantine/error record and a subsequent valid event applying once.

### GAP-05 — Consume financial limits atomically

P0 if application-owned count, velocity or exposure limits exist; strengthens CRG-06-10, CRG-08-02 and CRG-13-09.

With $100 allowance left, submit two concurrent $75 intents using different keys. A correct balance lock alone does not protect a separate daily limit. Atomically reserve/consume the relevant allowance when accepting the operation; preserve exposure while provider outcome is unknown according to the defined policy.

Evidence: concurrency test with a controlled interleaving, one accepted operation, one limit rejection, allowance within its bound, and restart recovery. Do not invent policy thresholds; the amounts above are a synthetic example.

### GAP-06 — Apply a late return after credited funds were spent

P0 if the product exposes available funds and onward spending; strengthens CRG-06-09, CRG-08-03/06 and CRG-09-08.

Exercise credit → availability → full onward debit → authoritative return, including duplicate and out-of-order delivery. The system must record the return once and apply the defined deficit, restriction or provider-directed treatment. It must not clamp away the loss, delete history, or reject reality because the available balance is zero.

Evidence: linked original/compensating records, exact final balance/state, follow-on eligibility behavior, operator visibility and reconciliation. Return timing and liability remain provider/product-specific.

### GAP-07 — Concurrent operator actions cannot apply a stale decision

P0 if replay, correction, cancellation or override exists; strengthens CRG-03-03, CRG-04-07, CRG-09-10, CRG-10-10 and CRG-14-07.

Two authorized operators open the same incident; one resolves it while the other acts from an old screen. Bind recovery to a version/precondition or equivalent invariant. The second action must safely return the existing result or reject as stale, with no additional financial effect.

Evidence: two-session race, authoritative versions, one effect, attributable attempts and visible stale/already-resolved feedback.

### GAP-08 — Recovery requested is not recovery verified

P0 if incident recovery exists; strengthens CRG-06-04/05, CRG-07-08, CRG-09-09/10 and CRG-14-07.

Make replay enqueue successfully but fail during processing. Keep the incident open/in progress until the authoritative provider/local comparison verifies the discrepancy has been resolved or explicitly disposed of under the documented policy.

Evidence: linked recovery and verification run IDs, failed first attempt, authoritative lookup/reconciliation result and incident history. A successful enqueue response cannot close the incident.

## Targeted hardening

### GAP-09 — One expensive request and one noisy tenant

P1; strengthens CRG-03-09, CRG-10-01, CRG-12-04 and CRG-13-09.

Test just-over-limit bodies, arrays, page sizes, batch counts and bounded worst-case legal queries against exposed interfaces. Include exports/uploads or paid calls only if present. Run a normal journey from a second tenant at the same time. Reject unsupported work before expensive processing, cap resource/provider consumption, and preserve the documented service target for the second tenant.

Evidence: declared limits, request corpus, peak resource use, provider-call counts, second-tenant outcomes and cleanup. Rate-only stress testing misses this axis; [OWASP API4](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/) identifies these resource-consumption risks.

### GAP-10 — Full-queue admission behavior

P1 if a durable inbox/queue exists; strengthens CRG-07-10, CRG-12-07, CRG-13-10 and CRG-14-03.

Pause consumers and reach the configured admission/storage threshold in an isolated environment. Submit one additional event/command. Either persist it durably or return the documented retry/backpressure response; never acknowledge and drop or initiate a provider effect without its durable intent. Resume and reconcile.

Evidence: capacity/threshold, accepted and rejected IDs, response codes, durable records, provider effects and drain results. Use a safe configured threshold rather than exhausting a shared host's disk.

### GAP-11 — Reconciliation pagination while records change

P1, higher priority when paginated reconciliation is central; strengthens CRG-09-05/06/07/10.

Insert or update records between successful page fetches. Provider-documented stable cursor/snapshot semantics, or an appropriate watermark/overlap strategy, must prevent a false clean result. An upper watermark alone does not guarantee completeness if the provider's mutable ordering lacks suitable semantics; document and test the actual guarantee or keep the run incomplete.

Evidence: mutating adapter fixture, expected record set, cursors/watermarks/counts, deduplication and next-run capture of late changes.

### GAP-12 — Idempotency ownership and abandoned-intent recovery

P1; strengthens CRG-06-02 through CRG-06-06, CRG-03-02 and CRG-11-05.

Reuse a key across customers and operation types according to the chosen key-scope contract. No lookup may reveal another customer's result. Age records in pre-dispatch, dispatching and unknown states across recovery boundaries. Release reservations only when the external-effect status and policy justify it; elapsed time alone cannot prove no payment occurred.

Evidence: cross-owner/type cases, controlled-clock stale-intent cases, no leakage or duplicate effects, and auditable reservation recovery after restart.

### GAP-13 — Reproducible sandbox demo and preflight

P1, evaluate early for handoff; strengthens CRG-01-02/09, CRG-15-01/05/09 and CRG-16-04/10.

Provide a documented reset or fresh uniquely namespaced synthetic case. Before handoff, check provider access, allowed test identity/state, webhook reachability, configuration and expected starting records. Have a reviewer follow the instructions without undocumented author intervention; do not claim a replayed recording is a fresh sandbox run.

Evidence: clean-start transcript, run ID, expected/observed counts, setup duration and cleanup or namespace isolation. Record external sandbox limitations explicitly.

### GAP-14 — Webhooks crossing a deployment boundary

P1 if deployment/version changes exist; strengthens CRG-07-09, CRG-12-08 and CRG-15-06 through CRG-15-09.

Persist an event under release N and process it under N+1. Where deployment actually overlaps versions, redeliver to both. Check inbox/schema/handler compatibility and shared durable deduplication. A local two-version simulation is useful but must not be labeled a deployed test.

Evidence: version-tagged event path, one financial effect, no stranded accepted work, and tested rollback or documented roll-forward treatment for incompatible data.

### GAP-15 — Clean-state test preflight

P1; strengthens CRG-09-06, CRG-13-02/03/12 and CRG-16-07.

Assert starting fixtures, keys, queues, caches, rate buckets and reconciliation windows match the declared profile. Separate unique run namespaces from deterministic business cases. When investigating contamination or validating reset behavior, compare clean reruns and an intentionally dirty run. Treat unexplained residual state as contaminated evidence.

Evidence: reset/preflight commands, counts, seed, run namespace, reports and explained variance. Do not repeatedly rerun passing suites without a specific unresolved concern.

### GAP-16 — CI must detect missing execution

P1; strengthens CRG-15-02 and CRG-16-01 through CRG-16-09.

Check that a required suite cannot report green after discovering zero tests, silently skipping critical cases, losing a report/matrix job, timing out, or hiding a child exit code. Validate the runner configuration actually used; do not add a matrix solely for this control.

Evidence: expected critical suite manifest, deliberate zero-discovery or skipped-case check, propagated failure and complete reports. Approved exclusions remain visible and do not satisfy the excluded control.

### GAP-17 — Preview and bound operator action targets

P1 if high-impact operator actions exist, prioritize bulk operations; strengthens CRG-03-03/05, CRG-04-07, CRG-10-10 and CRG-14-08.

Create a server-derived preview of environment, account, action and immutable targets/count. Change the selected data before execution. Execute only the reviewed bounded set or reject a material scope change; a stale filter must not expand a replay to an entire account.

Evidence: preview, changed-selection test, bounded execution and audit target IDs/digest. Choose the smallest appropriate safeguard for the actual action.

### GAP-18 — Dashboard deep links and ambiguous references

P1 if such navigation exists; strengthens CRG-10-01/03/04/07/09 and CRG-11-02/07.

Open malformed, unknown, stale and cross-tenant links; test a reference duplicated across provider/account contexts where the contract allows it. Validate filter input, preserve a safe recovery/search path, disambiguate by scope and avoid leaking protected record existence.

Evidence: route/API cases, stable UI error/recovery behavior, authorization assertions and sanitized logs.

## Conditional production and workflow refinements

### GAP-19 — Abuse across different valid intents and accounts

P2, or higher only if the brief assigns fraud prevention to the application; related CRG-02-03, CRG-03-02, CRG-05-03/08 and CRG-06-10.

Different valid keys bypass duplicate-request protection by design. If responsible for these controls, test a synthetic pattern across accounts sharing a funding instrument or destination against the explicitly selected policy. If responsibility belongs to the provider, verify handling of its review/blocked outcomes instead. Protect any cross-account investigation data with operator permissions.

Evidence: responsibility decision, synthetic pattern, expected review/block outcome and authorized-only visibility. [OWASP API6](https://owasp.org/API-Security/editions/2023/en/0xa6-unrestricted-access-to-sensitive-business-flows/) describes excessive automated use of sensitive business flows. It does not establish an AML duty or justify inventing a fraud graph for this trial.

### GAP-20 — Agent write boundaries and shared contracts

P2 workflow refinement; evaluate immediately if parallel implementation is permitted and used. Related AGENTS delegation/Git rules, CRG-15-04 and CRG-16-08.

Assign allowed write paths, shared-interface owner/revision, base SHA/dependencies and integration owner/order. Concurrent payment/webhook agents must not independently replace the same migration or state contract. Keep the mechanism lightweight: an assignment note is enough when practical.

Evidence: bounded task assignments, shared contract reference, preserved integration diff and affected cross-feature checks. This is separate from read-only parallel review.

### GAP-21 — Identify which reviews a shared change invalidates

P2 workflow refinement; existing AGENTS/REVIEWER instructions and CRG-16-08 already require re-review after material changes.

This is an execution aid, not a missing review requirement: maintain a short scope/dependency impact note for reviews. After a shared authorization helper, adapter, schema or transition changes, identify affected approvals and obtain the scoped recheck. A manual explicit impact assessment is enough; a new dependency-tracking system is unnecessary.

Evidence: changed input, affected review IDs, retained unaffected evidence and new re-review references. Final integration must not present a superseded material PASS as current.

## Recommended use within 48 hours

First map official acceptance criteria and establish the real sandbox slice. Apply GAP-01 through GAP-08 only to the relevant implemented paths. Select targeted hardening by observed architecture and highest remaining failure risk, with a reproducible demo prepared early. Keep conditional fraud policy, bulk UI, multi-version deployment and parallel implementation controls out of scope when those behaviors are absent.

This review improves the planned checks. It cannot guarantee that every future defect or applicable rule has been identified. Submission confidence must come from the actual brief, implementation, independent review and execution evidence on the submitted revision.

## Linear routing

Published on 2026-09-07: [full gap review](https://linear.app/yoannjobs/document/preparation-gap-review-21-findings-from-three-sol-audits-1d5f91a8e373). The 21 advisory findings are mapped into 11 existing domain tickets; YOA-593 holds the kickoff triage index. The project still has 16 tickets and 162 original controls. Applicability is TO_TRIAGE and execution NOT_RUN. Tickets own live decisions and evidence; this document remains a preparation catalog.

| Findings | Primary ticket |
|---|---|
| GAP-05, GAP-12 | [YOA-598](https://linear.app/yoannjobs/issue/YOA-598/06-payments-amounts-and-idempotency) |
| GAP-19 | [YOA-594](https://linear.app/yoannjobs/issue/YOA-594/02-us-rules-partner-bank-responsibilities-and-conditional-compliance) |
| GAP-04 | [YOA-599](https://linear.app/yoannjobs/issue/YOA-599/07-webhooks-authenticity-durability-and-replay) |
| GAP-06 | [YOA-600](https://linear.app/yoannjobs/issue/YOA-600/08-ledger-concurrency-and-database-integrity) |
| GAP-01, GAP-11 | [YOA-601](https://linear.app/yoannjobs/issue/YOA-601/09-reconciliation-and-financial-discrepancies) |
| GAP-07, GAP-17, GAP-18 | [YOA-602](https://linear.app/yoannjobs/issue/YOA-602/10-dashboard-accuracy-usability-and-permissions) |
| GAP-10 | [YOA-604](https://linear.app/yoannjobs/issue/YOA-604/12-infrastructure-and-dependency-resilience) |
| GAP-03, GAP-09, GAP-15 | [YOA-605](https://linear.app/yoannjobs/issue/YOA-605/13-stress-testing-load-spikes-and-endurance) |
| GAP-08 | [YOA-606](https://linear.app/yoannjobs/issue/YOA-606/14-observability-alerts-and-runbooks) |
| GAP-14, GAP-16, GAP-20 | [YOA-607](https://linear.app/yoannjobs/issue/YOA-607/15-git-ci-migrations-and-deployment) |
| GAP-02, GAP-13, GAP-21 | [YOA-608](https://linear.app/yoannjobs/issue/YOA-608/16-test-campaigns-evidence-and-final-handoff) |
