# T+24h checkpoint email (draft, not sent by the assistant)

Status: SENT by Yoann on the existing candidate thread. Send time reported by Yoann: 2026-09-08 22:34 Europe/Zurich (20:34 UTC), nine hours and sixteen minutes before the T+24h deadline; recorded at 2026-09-08T20:36Z. Draft prepared at 11:25Z, rewritten short and plain at 20:22Z at Yoann's request. Deadline: September 9, 2026, 07:50 Europe/Zurich. Yoann sends it on the existing candidate thread; the thread header is the authoritative timestamp. Paste the demo password (the value of DEMO_PASSWORD in the deployment secret store) into the email, never into this file.

Sent at: 2026-09-08 22:34 Europe/Zurich (reported by Yoann)

---

Subject: Work trial: Yoann Abriel, Track 1

Hi,

T+24h: the app is deployed and real test money moves on it.

URL: https://corgi-work-trial-iota.vercel.app
Sign in with the password [DEMO_PASSWORD] as:
- broker@example.com, a broker (creates policies, pays, endorses, cancels)
- ops@example.com, staff operations (claims, corrections, reconciliation, statements)
- approver@example.com, the second person who approves money out
- customer@example.com, a customer (approves an endorsement above $500)

What is live, on Stripe test mode, with real webhooks reaching the deployed app:
- Premium collection. A broker quotes a California policy (premium, 2.35% state tax and a flat fee shown separately) and pays with a test card. When Stripe confirms, four journal entries post once and the policy binds. Today's example: policy CGP-01707, $1,253.20 collected.
- Cancellation refund. Unearned premium and its tax go back through the Stripe Refunds API, the fee stays, the broker's commission is clawed back. Today's example: CGP-01274 cancelled with an open claim untouched, Stripe refund re_3UDN8aK6R3v50tIy0J6CmRy3 for $2,081.09, confirmed by webhook.
- Broker verification. Brokers are verified through Stripe Connect business verification (test mode): pending, approved and failed states, and a failed broker cannot bind. I planned Sumsub or Middesk at T+2h; both sandboxes turned out to be gated, so both live slots run on Stripe, and the app says so.

Two things are simulated and labeled as such on screen: the claimant bank account check and the claim payout rail.

Underneath: the app's own double-entry ledger, append-only. Postgres refuses any update or delete on money rows, for every role. Corrections are reversal entries plus a re-book; the original rows stay.

Also working on the same URL: claims with reserves (incurred = paid + reserve), maker-checker above $1,000 with a distinct human approver, endorsements priced from their effective date with an impact preview, backdated corrections, monthly broker statements that tie to the ledger to the cent, reconciliation against Stripe with a breaks screen, and an MCP endpoint (three read tools, one write tool that only queues an approval request). Each slice has an independent review record in the repo.

Repository (private, access at submission): https://github.com/YoannAbriel/corgi-work-trial. Decision log, plan and reviews are under docs/.

Next 24 hours: finish the screens, rehearse the walkthrough, then the freeze package (video, evidence pack, cut list, week-two plan).

Best regards,
Yoann Abriel
