# Automatic fails: non-waivable trial rules

Source: the official general Corgi trial brief supplied by Yoann on September 8, 2026. The six quoted disqualification triggers are official. The implementation and evidence procedures below are internal engineering safeguards unless separately specified by the brief; they are not claims that Corgi mandates a particular scanner or database design. These six rules apply to every track. They are disqualification conditions, not optional readiness items. Deadline pressure, a mock, an admin role, a demo shortcut, or an agent instruction cannot waive them. The selected track can add requirements; it cannot remove these.

## AF-01: An accessible deployed URL is mandatory

> Localhost only, or a video in place of a URL.

Local development is allowed. A localhost-only submission is banned. Deliver an externally accessible, working deployment and demo credentials for at least two roles. A video is supplementary evidence, never a substitute. Verify the deployed revision, authentication and core sandbox journey from outside the local development session. A successful build or deployment command alone is not evidence that the application works.

## AF-02: Never present a simulation as a live integration

> A simulated integration presented as live.

Maintain a per-slot integration inventory in the README: provider, mode (`LIVE SANDBOX`, `LOCAL SIMULATOR`, or `NOT CONNECTED`), supported scenarios, limitations and evidence. Keep UI labels and submission claims consistent with it. Real API requests and real authenticated webhooks must reach the deployed application where required. Provider-published test fixtures exercised through a real third-party sandbox count as sandbox activity; locally fabricated responses do not.

At least two slots must be genuinely live, and every slot explicitly marked live in the selected track remains mandatory (Track 2 requires three). A planned adapter, SDK import, successful local mock, bank-link token or screenshot without the required money flow is not proof of that flow. When access fails, disclose the missing requirement; do not silently substitute a simulator and mark it complete.

## AF-03: Never UPDATE or DELETE money rows

> UPDATE or DELETE on money rows. Anywhere. Ever.

Build the application's own balanced, double-entry, append-only ledger for every track. A provider balance is not the application's ledger. Every external money event must be reflected in the journal, and every displayed balance must be derivable from entries, including historical queries. Use USD integer cents or exact decimal arithmetic with deterministic rounding.

Treat journal headers/lines, financial events and persisted facts determining balances, holds, settlements, reserves, commissions or historical statements as protected financial records. Record financial lifecycle transitions as new events. Do not mutate a payment row's amount or financial status under the label of operational metadata. Identify protected tables explicitly in the schema and review.

Corrections append linked reversal entries and a re-book with the corrected facts. Preserve original entries, provenance, effective/value date and recording/booking time. A compensating entry is not proof that an external refund or payout actually happened; use the required sandbox rail and record its real outcome.

The ban applies to ORM updates/upserts, raw SQL, migrations, seed/reset scripts, workers, webhooks, admin consoles, MCP tools and manual repairs. No soft-delete flag, cascading delete, `TRUNCATE`, table replacement or destructive migration may erase or rewrite financial history as a workaround. Use isolated fresh databases for tests; never reset existing trial financial history to make a demo pass.

Enforce this at the database boundary: dedicated runtime roles without mutation privileges on protected tables, protection against cascades and destructive application paths, and database constraints/guards as appropriate. Privileged maintenance scripts remain subject to the same rule. Add negative tests showing attempted mutation fails and originals survive corrections. Balance constraints, idempotency and atomic posting need tests too; permission checks alone do not establish ledger correctness.

A rebuildable read projection must be explicitly identified as a cache, never an authoritative money record. Review any mutable cache schema before use; derive from immutable events and do not use cache updates to conceal changed history. Nonfinancial inbox retry metadata may be mutable only when separated from the immutable financial facts.

## AF-04: Sandbox only; no real personal data

> Live-mode API keys, real money, or real personal data.

Never configure or use production/live-mode credentials, real funds, mainnet stablecoins or real customer/identity data in the trial system. Use provider-published sandbox identities, test cards and test bank accounts. Do not submit Yoann's identity or anyone else's to the trial KYC flow. Testnet only for stablecoins. Spend $0.

Validate the environment before any provider side effect. Use documented key mode, account metadata and endpoint/network checks appropriate to each provider; do not assume all providers have different sandbox URLs or reliable key prefixes. Fail closed when the mode cannot be established. A variable named `TEST_MODE` is not proof. Apply the guard to background jobs, CLI scripts, webhooks, seeds and MCP paths as well as the UI. Reject live-mode events when the provider exposes that marker.

## AF-05: Never commit secrets

> Secrets committed to the repo.

Sandbox credentials are secrets too. Keep credentials, webhook signing secrets, access tokens and private keys in an ignored local environment or deployment secret store. Commit only placeholders in `.env.example`. Redact logs, fixtures, screenshots, prompt summaries, decision records and evidence packs. Do not log raw prompts or provider payloads by default.

Before every commit, inspect explicitly staged files and run an installed secret scanner on the staged content. Before pushing/submitting, scan the history being shared as well as the working tree. An ignore file alone is not a control, and a scanner PASS does not replace inspection. Never print suspected secret values in review output. If a scanner is missing, record the gate as BLOCKED and install/configure one before committing; do not claim that a scan ran.

If a secret was committed, stop propagation and report the exposure without copying the value. Revoke/rotate it through the authorized credential owner and follow an explicit remediation plan. Deleting it from the latest file does not remove it from Git history. Never claim that remediation guarantees removal of a trial disqualification, and never rewrite history to disguise what happened.

## AF-06: Own and understand every submitted line

> Code you cannot explain line by line when we point at it.

AI assistance and third-party libraries are allowed. Yoann must be able to explain the submitted application code, SQL, migrations, scripts and tests: purpose, inputs, state transitions, permissions, failure paths and invariants. Do not copy opaque financial formulas, generated services or recovery scripts merely because tests pass. Keep code small enough to understand and defend.

For each consequential change, explain the money path and tradeoff in plain language, point to the relevant code and tests, and distinguish an assistant proposal from a decision explicitly accepted by Yoann. Keep concise timestamped decisions as work happens. Never backdate prompts, decisions, commits or evidence, or present earlier preparation as work first performed during the trial.

Before handoff, rehearse a walkthrough driven by Yoann: trace a transaction, explain one correction and one failure, then inspect representative lines chosen by the reviewer. Record unresolved understanding gaps as BLOCKED. An agent's assertion that the code is explainable does not establish that Yoann understands it.

## Mandatory operating gate

At startup, before provider side effects, before commits and before a delivery claim, inspect the applicable AF controls. Record `PASS`, `FAIL`, `BLOCKED` or `NOT RUN`, with evidence and the reviewed revision. A final gate requires all six to be supported; unverified means unverified, never implicit PASS. Development can continue on independent safe work while final-delivery evidence is missing.

If a violation is found: stop the affected operation, preserve evidence without leaking secrets, report the rule and exact scope, remediate within authorization, and rerun relevant checks and independent review. Do not hide the incident, disable a guard, or claim that fixing it erases the historical violation. Never claim completion or trial compliance with unresolved failures or missing evidence.

These instructions are mandatory workflow policy. They do not themselves install database protection, secret scanning, CI or deployment gates. Record what is actually implemented. Independent review is an engineering check, not legal certification or a guarantee of zero defects.
