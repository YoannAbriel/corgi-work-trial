# T+2h checkpoint email (draft, not sent by the assistant)

Status: SENT by Yoann on the existing candidate thread. Send time reported by Yoann: 2026-09-08 09:49 Europe/Zurich (07:49 UTC), one minute before the T+2h deadline. Recorded at 2026-09-08T08:07:11+00:00; the email header on the thread is the authoritative timestamp.

Sent at: 2026-09-08 09:49 Europe/Zurich (reported by Yoann)

---

Subject: Work trial: Yoann Abriel, Track 1

Hi,

Here is my T+2h attack plan for Track 1 (Policy administration).

Stack: Next.js (TypeScript) on Vercel, Postgres on Neon, my own double-entry append-only ledger in SQL, PDF via react-pdf, MCP endpoint in the same app. USD integer cents only. Sandbox and test data only, $0 spend.

Providers (honest modes):
- Premium collection: Stripe test mode, hosted Checkout for card, real Refunds API for cancellation, signed webhooks. LIVE SANDBOX.
- Broker KYB: Sumsub sandbox (pending, failed and approved states, gate on binding); Middesk sandbox as fallback. LIVE SANDBOX.
- Bank account verification: local simulator in v0, labeled as such; Plaid sandbox if time remains after the core. LOCAL SIMULATOR.
- Document generation: declarations page and endorsement schedule generated from event data, "as it stood on any date". REAL.
- Claim payout rail: local simulator with delayed settlement and possible return, ledgered like a real rail; Increase sandbox as stretch. LOCAL SIMULATOR.

Three end-to-end use cases:
1. Broker onboarding to bound policy. Broker entity goes through KYB (pending, failed, approved shown). An approved broker issues a commercial liability policy for one modeled US state (premium, state premium tax, flat fee kept separate). Customer pays with a Stripe test card; the webhook lands, journal entries post (cash, premium receivable, tax payable, fee income, commission on collected premium). Declarations PDF generated.
2. Endorsement and correction. Mid-term limit increase priced over the remaining term from the effective date, with an impact preview before customer approval above the threshold, collected through Stripe. Then the live-fire correction: an endorsement entered with the wrong effective date is fixed by reversal entries plus a re-book; original rows untouched; the policy can be printed as it stood between two endorsements; the month still reconciles.
3. Claim, cancellation, statement, reconciliation. Claim opened, reserve set and adjusted (append-only), payment drawn against the reserve with maker-checker above the threshold (initiator cannot approve, agents cannot approve), paid on the simulated rail with delayed settlement. Policy cancelled mid-term with the open claim: pro-rata unearned premium refunded through the real Stripe Refunds API, commission clawed back, reserve left untouched and explained. Monthly broker statement ties to the ledger to the cent and re-runs identically. Reconciliation job pulls Stripe records and finds a planted payout mismatch on the breaks screen.

Domain mechanics covered: written vs earned premium (daily, actual days, calendar-year term with leap years), endorsement delta from the effective date, correction by reversal and re-book, pro-rata cancellation with short-rate representable, incurred = paid + reserve with limit guard, commission on collected premium with clawback, deterministic rounding penny (insurer eats it), taxes and fees separated from premium, as-of reconstruction from events.

Cut list v0 (deliberate, defended in the decision log): renewals, public REST API (MCP is the machine surface), customer portal beyond approvals and documents, bank debit (ACH) collection, installment billing, e-signature, USDC payout, second product line, reinsurance note, broker API keys. Production-only work recorded as limitations: real KYB policy, real tax filings, real bank rails.

Checkpoints: T+24h deployed URL with real test-mode premium collection and refund; T+48h freeze with decision log, seed script, .env.example, cut list, week-two plan, video and evidence pack.

Best regards,
Yoann Abriel
