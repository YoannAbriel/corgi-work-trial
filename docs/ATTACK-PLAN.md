# Attack plan (T+2h checkpoint)

Drafted at 2026-09-08T07:39:00+00:00 for the 09:50 Europe/Zurich checkpoint. Track 1: Policy administration. Stack and providers were chosen by Yoann in the planning discussion recorded in DECISIONS.md. The email timestamp on the candidate thread governs the checkpoint; this file is the repository copy.

## Stack

Next.js (TypeScript, App Router) on Vercel, Postgres on Neon, own double-entry append-only ledger written in SQL, PDF generation with react-pdf, MCP endpoint inside the same application. USD integer cents only. Sandbox credentials and synthetic test data only, $0 spend.

## Providers (integration inventory, honest modes)

| Slot | Provider | Mode in v0 |
|---|---|---|
| Premium collection | Stripe test mode: hosted Checkout for card, real Refunds API for cancellation, signed webhooks | LIVE SANDBOX |
| Broker KYB | Sumsub sandbox (pending, failed and approved states, gate on binding); Middesk sandbox as fallback | LIVE SANDBOX |
| Bank account verification | Local simulator, labeled as such; Plaid sandbox only if time remains after the core | LOCAL SIMULATOR |
| Document generation | Declarations page and endorsement schedule generated from event data, "as it stood on any date" | REAL |
| Claim payout rail | Local simulator with delayed settlement and possible return, ledgered like a real rail; Increase sandbox as stretch | LOCAL SIMULATOR |

## Three end-to-end use cases

1. **Broker onboarding to bound policy.** A broker entity goes through KYB; pending, failed and approved are all shown. An approved broker issues a commercial liability policy for one modeled US state, with premium, state premium tax and a flat fee kept separate. The customer pays with a Stripe test card, the webhook lands, and journal entries post: cash, premium receivable, tax payable, fee income, commission on collected premium. The declarations PDF is generated.
2. **Endorsement and correction.** A mid-term limit increase is priced over the remaining term from the effective date, previewed before customer approval above the threshold, and collected through Stripe. Then the live-fire correction: an endorsement entered with the wrong effective date is fixed by reversal entries plus a re-book. Original rows stay untouched, the policy prints as it stood between two endorsements, and the month still reconciles.
3. **Claim, cancellation, statement, reconciliation.** A claim is opened, a reserve is set and adjusted as append-only events, and a payment draws the reserve down under maker-checker above the threshold (the initiator cannot approve, an agent cannot approve), paid on the simulated rail with delayed settlement. The policy is cancelled mid-term with the open claim: pro-rata unearned premium is refunded through the real Stripe Refunds API, commission is clawed back, the reserve stays and is explained. The monthly broker statement ties to the ledger to the cent and re-runs identically. The reconciliation job pulls Stripe records and finds a planted payout mismatch on the breaks screen.

## Domain mechanics covered

Written versus earned premium (daily, actual days, calendar-year term with leap years). Endorsement delta from the effective date, never the entry date. Correction by reversal plus re-book. Pro-rata cancellation with short-rate representable in the ledger. Incurred = paid + reserve with a limit guard. Commission earned on collected premium with clawback on refund. Deterministic rounding penny (the insurer eats it). Taxes and fees separated from premium. As-of reconstruction from events.

## Cut list v0

Deliberate cuts, defended in the decision log: renewals, public REST API (MCP is the machine surface), customer portal beyond approvals and documents, bank debit (ACH) collection, installment billing, e-signature, USDC payout, second product line, reinsurance note, broker API keys. Production-only work recorded as limitations rather than built: real KYB policy, real tax filings, real bank rails.

## Checkpoints

T+24h (September 9, 07:50 Europe/Zurich): deployed URL with real test-mode premium collection and refund. T+48h (September 10, 07:50): freeze with decision log, seed-from-zero script, .env.example, cut list, week-two plan, video and live-integration evidence pack.
