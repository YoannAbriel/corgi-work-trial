# T+24h checkpoint email (draft, not sent by the assistant)

Status: DRAFT prepared at 2026-09-08T11:25:00+00:00, KYB evidence added 12:58Z, evening deliveries added 17:50Z. Deadline: September 9, 2026, 07:50 Europe/Zurich. Yoann sends it on the existing candidate thread; the thread header is the authoritative timestamp. Fill the two bracketed items before sending. The demo password is the value of DEMO_PASSWORD in the deployment secret store; paste it into the email, never into this file.

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

- Broker KYB: the demo broker was submitted through the app to Stripe Connect Accounts v2 business verification (test mode); status pending at 12:07:57 UTC, approved at 12:10:34 UTC after the 2-minute settling window; the failed path (tax id mismatch fixture) blocks the Pay button and the server refuses a direct checkout; account.updated events from the connected accounts reach the deployed app through a Connect webhook endpoint and are appended only on a status change (a second demo broker submitted from the deployed URL went pending, then failed 54 seconds later on Stripe's verification result delivered by webhook). The staff screen shows approved, failed and not-yet-submitted brokers side by side.

Live slots: premium collection on Stripe (LIVE SANDBOX); broker KYB on Stripe Connect Accounts v2 business verification in test mode (LIVE SANDBOX, with the disclosure that Stripe is not a dedicated KYB vendor and that both live slots run on Stripe, chosen after Middesk, Sumsub and Persona trials proved gated). Bank verification and the claim payout rail are local simulators, labeled as such. Documents are generated from data.

Repository (private, access granted at submission): https://github.com/YoannAbriel/corgi-work-trial. Decision log, plan and review records are in docs/.

Also deployed today, all on the same URL:
- Claims: reserves set and adjusted as events, incurred = paid + reserve checked against the journal after every step, payouts on a labeled local simulator with delayed settlement and returns; a claim (CLM-00212) is open on the bound policy.
- Maker-checker: money out above $1,000 (cumulative per claim, and per policy for refunds) needs a distinct human approver against a hashed intent; the initiator and any agent are refused in code and by a database trigger.
- Endorsements: mid-term change priced over the remaining days from the effective date, impact preview and explained amounts from one pure function, customer approval above $500, delta collected through Stripe or refunded at once; declarations page and endorsement schedule as PDFs "as it stood on" any date.
- Backdated correction: a wrong effective date is fixed by reversal entries plus a re-book; original rows untouched; effective and recorded dates shown side by side; the difference settled through the same rails.
- Broker monthly statement: computed from journal lines only, ties to the ledger to the cent, immutable runs with a content hash and a knowledge cutoff; a correction after the close is a dated new revision, never an edit; a month still running is labeled provisional.
- Reconciliation: Stripe and the simulated rail pulled by API and diffed against the ledger; breaks with their age, resolved only by a later run that covers their date; clearing balances listed; a failed fetch never reads clean; daily cron plus a staff "Run now".
- Independent review of each slice with a findings register (docs/reviews/FINDINGS.md); the two HIGH findings found tonight (a maker-checker bypass on a rejected refund, a statement column redefined over existing rows) are fixed and re-reviewed.

Next 24 hours: MCP surface (three read tools, one approval-queued write, one reconciliation trigger), hardening and screen states, full walkthrough rehearsal, then the freeze package (video, evidence pack, cut list, week-two plan).

Best regards,
Yoann Abriel
