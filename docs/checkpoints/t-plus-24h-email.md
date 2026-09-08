# T+24h checkpoint email (draft, not sent by the assistant)

Status: DRAFT prepared at 2026-09-08T11:25:00+00:00. Deadline: September 9, 2026, 07:50 Europe/Zurich. Yoann sends it on the existing candidate thread; the thread header is the authoritative timestamp. Fill the two bracketed items before sending. The demo password is the value of DEMO_PASSWORD in the deployment secret store; paste it into the email, never into this file.

Sent at: (to fill in)

---

Subject: Work trial: Yoann Abriel, Track 1

Hi,

T+24h update: the money path is live on the deployed URL.

URL: https://corgi-work-trial-iota.vercel.app
Demo roles: broker@example.com (broker), ops@example.com (staff), password: [DEMO_PASSWORD]

What moves today, on Stripe test mode with real webhooks received by the deployed app:
- Issuance: a broker creates a commercial liability policy (California, premium, 2.35% state premium tax and a flat fee shown separately), pays with a test card through Stripe Checkout; payment_intent.succeeded lands, four journal entries post once (cash, unearned premium, tax payable, fee income, commission on collected premium), the policy binds. Replaying the event twice posts once.
- Cancellation: pro-rata unearned premium and its tax refunded through the real Stripe Refunds API, fee kept, commission clawed back; refund.updated lands and clears the refund liability. Evidence: policy CGP-01062 cancelled effective 2026-10-31, Stripe refund re_3UDM4KK6R3v50tIy0scSGaps of $3,241.56 succeeded on the original payment, refund.updated received and posted, commission clawback $475.06.
- The ledger is the application's own double-entry, append-only journal (Postgres triggers refuse UPDATE, DELETE and TRUNCATE for every role; entries sealed at commit; balance checked by the database at commit).

Live slots: premium collection on Stripe (LIVE SANDBOX); broker KYB on Stripe Connect Accounts v2 business verification in test mode (LIVE SANDBOX, with the disclosure that Stripe is not a dedicated KYB vendor and that both live slots run on Stripe, chosen after Middesk, Sumsub and Persona trials proved gated). Bank verification and the claim payout rail are local simulators, labeled as such. Documents are generated from data.

Repository (private, access granted at submission): https://github.com/YoannAbriel/corgi-work-trial. Decision log, plan and review records are in docs/.

Next 24 hours: endorsement with pro-rated delta and impact preview, backdated correction by reversal and re-book, claims with reserves and maker-checker, monthly broker statement, reconciliation screen, MCP surface.

Best regards,
Yoann Abriel
