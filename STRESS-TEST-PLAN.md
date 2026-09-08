# Stress testing: validation protocol

Status: PLAN, NOT EXECUTED. Adapt to the repository, resources, and brief. Covers CRG-13-01 through CRG-13-12 in `READINESS-CHECKLIST.md`.

## Environment and load model

Use k6 or the repository's existing tool. Target an isolated application/database with synthetic data and a provider simulator for heavy load. A separate small sandbox flow verifies real integration within authorized quotas. Inject provider failures at the local test adapter/proxy; do not disrupt the third-party service.

Fault injection requires a disposable/local or explicitly authorized dedicated environment, verified restoration, bounded scope, stop conditions, and cleanup. Do not disconnect a database, shift clocks, fill disks, or kill workers in shared sandbox/CI resources without specific authorization.

Before running, define the base URL, authorized hosts, maximum budget/cost, dataset size, maximum throughput and duration, owner, and stop mechanism. Prevent live configuration; a hostname containing 'sandbox' is insufficient. Do not execute until these values and endpoints are defined.

L is target nominal throughput, fixed before measurement. An illustrative starting point for a small isolated app is L = 5 journeys/second. A journey may generate several requests: record journeys/s, requests/s, and concurrency separately. Match dataset, read/write mix, and think times to real usage; do not test only /health or a warmed cache.

Separate realistic concurrent dashboard reads from command/webhook arrival scenarios. If the generator slows its emissions when the server slows, measure that bias; track dropped iterations and generator saturation. Do not hide degradation behind closed-loop testing alone.

## Proposed profiles

| Profile | Indicative load and duration | Purpose |
|---|---|---|
| Smoke | 1 user, 1 min | Verify fixtures, authentication, assertions, and metrics |
| Nominal | L, 10 min | Sustain target service with realistic data |
| Stress | 0.5L → L → 1.5L → 2L, 3 min/stage | Identify degradation and saturation |
| Spike | 0.2L → 3L for 60 s → 0.2L | Absorb/reject load and recover |
| Trial soak | L, 30-60 min | Detect leaks, connection growth, and increasing lag |
| Production endurance | L, 4-8 h if selected | Explore long-term drift; never claim this from a short test |
| Breakpoint | Bounded ramp to an agreed stop threshold | Measure useful capacity without continuing to destruction |
| Load plus failure | L, then simulated latency and worker restart | Verify recovery, isolation, and integrity |

Each actual stage is min(profile target, authorized cap for that traffic type). If the cap prevents the planned profile, report a limited run rather than claiming a 3L test. Separate read, write, and provider-call budgets. High-contention writes use the local simulator; any sandbox exception must be explicitly permitted and reconciled afterward.

These durations are proposals, not mandatory standards or Corgi requirements. An unexecuted profile is NOT RUN or DEFERRED, never PASS.

## Proposed thresholds to fix before the run

- Local dashboard reads: p95 < 500 ms and p99 < 1,500 ms at nominal load, if appropriate for the selected environment.
- Durable acceptance of a local command: p95 < 1,000 ms. Measure external settlement separately; this threshold does not apply to bank settlement.
- Unexpected technical errors at nominal load: < 1% by endpoint/scenario. Expected business rejections have separate metrics and remain in the report.
- Local UI freshness after a processed event: proposed target < 5 s; measure provider delivery latency separately.
- After returning to L: proposed recovery to nominal thresholds within 2 min, and backlog drain within 5 min if the injected volume makes that realistic. Document backlog volume and drain capacity.
- Above nominal load: latency/rejection rates may exceed service thresholds. Expected saturation can pass a stress scenario if controlled and followed by recovery; it does not prove the nominal SLO at that throughput.
- Zero-tolerance invariants: no duplicate effect per intent, cross-customer access, corruption, unbalanced journal where applicable, or loss of an acknowledged event within the tested failure model.

Stop immediately on integrity/security violations, incorrect targets, budget overruns, or risk of durable loss. Fix resource/error stop thresholds before the run. Missing metrics or a saturated generator make results inconclusive, not green.

## Contention and fault scenarios

1. Replay the same intent/key, then reuse a key with different parameters; verify one effect and consistent conflict handling.
2. Send deterministic batches of duplicate/out-of-order events; compare emitted, acknowledged, processed, and failed IDs.
3. Interrupt a worker after persistence but before application, then after local effect but before completion acknowledgment; recover without loss or double application.
4. Simulate a lost response after external acceptance in the adapter; recover without creating a new intent.
5. Saturate dashboard reads during payment processing; controls and durable processing continue or degrade explicitly.
6. Fail the dashboard and visual monitoring; verify an independent alert and diagnostic path.
7. Run reconciliation alongside webhooks and operation recovery; verify convergence under the defined policy.

## Measurement validity

Use a separate warm-up and record warm/cold cache state, dataset cardinality, and neighboring load. Include timeouts/errors rather than silently excluding them; separate successful and failed request latency. Repeat profiles when variation is significant or a change affects the conclusion; do not generalize from one noisy run. Prefer response-independent arrival rates to expose degradation; track emission lag and dropped iterations to avoid coordinated omission.

## Required report

Record run ID, SHA, versions, topology/resources, dataset/seed, endpoints, simulated/real provider environment, profile, predetermined thresholds, emitted/achieved throughput, concurrency, p50/p95/p99, errors/rejections by type, dropped iterations, CPU/memory/connections, queue depth/age, recovery duration, before/after invariants, and reconciliation discrepancies.

Attach the exact command, redacted raw output, assertion results, and per-profile verdict. In k6, use failing thresholds and business metrics: displayed checks or HTTP 200 alone do not establish success. Verify exit status and post-run database assertions. [Official threshold documentation](https://grafana.com/docs/k6/latest/using-k6/thresholds/).

Do not tune thresholds after the fact simply to produce green results. Document revisions and rerun affected profiles. A short local measurement certifies neither production capacity nor legal compliance.

Linear copy: [stress protocol](https://linear.app/yoannjobs/document/stress-testing-protocol-thresholds-and-recovery-5aaf7263f6d1). Campaign ticket: [YOA-605](https://linear.app/yoannjobs/issue/YOA-605/13-stress-testing-load-spikes-and-endurance).
