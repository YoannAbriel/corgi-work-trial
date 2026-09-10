# Corgi live integration evidence

Yoann Abriel · Track 1: Policy administration · Prepared September 9, 2026.

Repository evidence pack. This folder is prepared for public GitHub access for the trial reviewers. Start with the screenshots below. There are **10 fresh Stripe dashboard captures and 4 earlier application captures** preserved from today's repository evidence. All timestamps in the manifest are UTC. Capture time and the time of the underlying transaction are different.

Deployed application: https://corgi-work-trial-iota.vercel.app

## What is live

| Integration slot | Provider and mode | Evidence |
|---|---|---|
| Premium collection and cancellation refunds | Stripe Checkout and Refunds API, LIVE SANDBOX | Issuance USD 1,253.20, cancellation refund USD 2,081.09, correction payment USD 53.84; provider event delivery logs and the application's HTTP 200 responses |
| Broker KYB | Stripe Connect business verification, LIVE SANDBOX (disclosed) | Connected-account webhook delivered to the deployed app; Harbor Point account reference; earlier app approved/failed screens |
| Bank verification and claim payout rail | LOCAL SIMULATOR | Not claimed as live integration evidence |

Both required live slots use Stripe. Stripe Connect is connected-business verification, not a dedicated KYB bureau. The repository README and decision log disclose this choice.

## Suggested review order

1. `02-Stripe-Connect-KYB/01-two-active-webhook-destinations.jpg` shows the **full deployed webhook URL**, active payment and Connect destinations, and the sandbox banner.
2. `01-Stripe-Payments/03-issuance-webhook-response-done.jpg` shows the USD 1,253.20 payment, its event ID and the actual server response: HTTP 200, `received: true`, `status: done`.
3. `01-Stripe-Payments/05-refund-webhook-response-done.jpg` shows the USD 2,081.09 cancellation refund event and its server response.
4. `01-Stripe-Payments/06-correction-53-84-webhook-response-done.jpg` shows the correction payment and the response at 19:50:43 UTC. Compare it with `03-Deployed-Application/03-correction-and-ledger-earlier-capture.png`, which shows the USD 53.84 collection and USD 7.89 commission entries at the same instant.
5. `02-Stripe-Connect-KYB/02-kyb-webhook-response-done.jpg` and `03-kyb-webhook-event-and-account.jpg` link the real Connect event, its account and the server response. The earlier approved/failed application screens are in `03-Deployed-Application`.

## References to trace

| Scenario | Provider reference | Event and delivery time (UTC) |
|---|---|---|
| CGP-01707 issuance, USD 1,253.20 | pi_3UDUCUK6R3v50tIy06eM9VlU | evt_3UDUCUK6R3v50tIy0MtOqkDo · September 8, 18:57:00 |
| CGP-01274 cancellation refund, USD 2,081.09 | re_3UDN8aK6R3v50tIy0J6CmRy3 | evt_3UDN8aK6R3v50tIy0i0dxINg · September 8, 18:27:59 |
| CGP-01707 correction collection, USD 53.84 | pi_3UDrW1K6R3v50tIy1GPWqtve | evt_3UDrW1K6R3v50tIy1YusKFe5 · September 9, 19:50:43 |
| Harbor Point broker KYB | acct_1UDOfRK6R3FpfF2D | evt_1UDOgLK6R3FpfF2DhpwJYnqR · September 8, 13:03:27 |
| Redwood broker KYB | acct_1UDNobK6R3ohMVag | Approved application screenshot from September 9, 09:32:17 |

The policy/refund associations are documented in repository `docs/STATUS.md` and `docs/handoffs/live-fire-day2.md`. A dashboard's HTTP response is the application's reported processing result; it does not independently prove all ledger or security invariants. Those checks and reviews remain in the repository.

## Capture index

- [01-Stripe-Payments/01-issuance-payment-succeeded.jpg](01-Stripe-Payments/01-issuance-payment-succeeded.jpg): Stripe payment_intent.succeeded for USD 1,253.20; event evt_3UDUCUK6R3v50tIy0MtOqkDo; policy CGP-01707 via app reference mapping. Capture: 2026-09-09T20:12:25.475Z. Fresh Stripe dashboard capture in this session.
- [01-Stripe-Payments/02-issuance-webhook-delivered.jpg](01-Stripe-Payments/02-issuance-webhook-delivered.jpg): Real Stripe event evt_3UDUCUK6R3v50tIy0MtOqkDo delivered HTTP 200 to deployed webhook at 2026-09-08 18:57:00 UTC. Capture: 2026-09-09T20:13:35.703Z. Fresh Stripe dashboard capture in this session.
- [01-Stripe-Payments/03-issuance-webhook-response-done.jpg](01-Stripe-Payments/03-issuance-webhook-response-done.jpg): Stripe delivery attempt received HTTP 200 with response received=true and status=done. Capture: 2026-09-09T20:14:22.862Z. Fresh Stripe dashboard capture in this session.
- [01-Stripe-Payments/04-refund-2081-09-webhook-delivered.jpg](01-Stripe-Payments/04-refund-2081-09-webhook-delivered.jpg): Real refund.updated for USD 2,081.09 delivered HTTP 200 on 2026-09-08 18:27:59 UTC; refund re_3UDN8aK6R3v50tIy0J6CmRy3. Capture: 2026-09-09T20:14:52.180Z. Fresh Stripe dashboard capture in this session.
- [01-Stripe-Payments/05-refund-webhook-response-done.jpg](01-Stripe-Payments/05-refund-webhook-response-done.jpg): Refund webhook delivery HTTP 200; application response received=true, status=done. Capture: 2026-09-09T20:15:13.814Z. Fresh Stripe dashboard capture in this session.
- [02-Stripe-Connect-KYB/01-two-active-webhook-destinations.jpg](02-Stripe-Connect-KYB/01-two-active-webhook-destinations.jpg): Two active Stripe webhook destinations on the exact deployed /api/webhooks/stripe URL: connected accounts (1 event) and platform payments (9 events). Capture: 2026-09-09T20:16:42.532Z. Fresh Stripe dashboard capture in this session.
- [02-Stripe-Connect-KYB/02-kyb-webhook-response-done.jpg](02-Stripe-Connect-KYB/02-kyb-webhook-response-done.jpg): Connected-account account.updated event evt_1UDOgLK6R3FpfF2DhpwJYnqR delivered to the deployed endpoint with HTTP 200 and status=done. Capture: 2026-09-09T20:18:01.288Z. Fresh Stripe dashboard capture in this session.
- [02-Stripe-Connect-KYB/03-kyb-webhook-event-and-account.jpg](02-Stripe-Connect-KYB/03-kyb-webhook-event-and-account.jpg): KYB event, connected account acct_1UDOfRK6R3FpfF2D, delivery time and endpoint linked visibly; HTTP 200. Capture: 2026-09-09T20:18:11.488Z. Fresh Stripe dashboard capture in this session.
- [02-Stripe-Connect-KYB/04-harbor-point-restricted.jpg](02-Stripe-Connect-KYB/04-harbor-point-restricted.jpg): Harbor Point test connected account acct_1UDOfRK6R3FpfF2D appears Restricted; payouts paused. This dashboard capability label is distinct from the app KYB decision. Capture: 2026-09-09T20:19:10.087Z. Fresh Stripe dashboard capture in this session.
- [01-Stripe-Payments/06-correction-53-84-webhook-response-done.jpg](01-Stripe-Payments/06-correction-53-84-webhook-response-done.jpg): Correction payment pi_3UDrW1K6R3v50tIy1GPWqtve for USD 53.84 succeeded; event evt_3UDrW1K6R3v50tIy1YusKFe5 delivered 2026-09-09 19:50:43 UTC, HTTP 200 and response status=done. Capture: 2026-09-09T20:22:50.815Z. Fresh Stripe dashboard capture in this session.
- [03-Deployed-Application/01-kyb-approved-earlier-capture.jpg](03-Deployed-Application/01-kyb-approved-earlier-capture.jpg): Approved broker verification screen Capture: 2026-09-09T09:32:17.061Z. Unmodified earlier screenshot from repository: docs/evidence/ui-audit-2026-09-09/broker-kyb-approved.jpg.
- [03-Deployed-Application/02-kyb-failed-earlier-capture.jpg](03-Deployed-Application/02-kyb-failed-earlier-capture.jpg): Failed verification state and resubmission form Capture: 2026-09-09T09:33:37.595Z. Unmodified earlier screenshot from repository: docs/evidence/ui-audit-2026-09-09/broker-kyb-failed.jpg.
- [03-Deployed-Application/03-correction-and-ledger-earlier-capture.png](03-Deployed-Application/03-correction-and-ledger-earlier-capture.png): Earlier LIVE-8 capture: policy CGP-01707; correction collection USD 53.84 and commission USD 7.89 journaled at 2026-09-09 19:50:43 UTC; cash collected USD 2,434.28. The correction card retains a to collect badge despite its collected confirmation below; screenshot is preserved unchanged. Capture: September 9, 2026; exact screenshot time not independently established. Unmodified earlier screenshot from repository: docs/evidence/live-fire-day2/LIVE-8/after/policy-money.png; documented in docs/handoffs/live-fire-day2.md. Exact screenshot timestamp not independently established..
- [03-Deployed-Application/04-reconciliation-earlier-capture.png](03-Deployed-Application/04-reconciliation-earlier-capture.png): Earlier LIVE-0 capture after the 2026-09-09 18:38Z run: four provider-only breaks and 32 probes; not a clean reconciliation. Capture: September 9, 2026; exact screenshot time not independently established. Unmodified earlier screenshot from repository: docs/evidence/live-fire-day2/LIVE-0/after/reconciliation.png; documented in docs/handoffs/live-fire-day2.md. Exact screenshot timestamp not independently established..

## Limits and handling

- These are genuine screenshots, not generated images. Fresh captures contain no pixel edits; provider request/event JSON was collapsed using the normal UI. Earlier files were copied byte-for-byte. `evidence-manifest.json` records origins, dimensions, capture times and hashes; `SHA256SUMS.txt` checks image integrity.
- The earlier KYB images were captured at 09:32:17 UTC (approved) and 09:33:37 UTC (failed), using the deployed application. They are not claimed to show the current UI revision. Their exact origin is recorded in `docs/evidence/ui-audit-2026-09-09/observations.json` in the repository.
- No screenshot of the transient KYB **pending** state is included. Repository STATUS records the original pending interval and the two-minute settling window. A pending-state capture remains a separate follow-up if the pack must visually demonstrate every state. No new KYB submission was performed for this folder.
- Stripe's account label **Restricted** is a capability status, not the app's KYB state. The Harbor Point failed decision is shown on the earlier application screen, including `verification_failed_tax_id_match`. Redwood approval is shown by the app; this pack contains no fresh provider-side verification-detail capture for Redwood.
- The earlier correction screen preserves a stale `to collect` badge; it also shows the collected confirmation and matching journal entries. Nothing was edited to hide that inconsistency.
- The reconciliation screenshot reports **four breaks and 32 probes**. It is included as an operational view, not evidence of a clean reconciliation. Claim-rail reconciliation on that screen is a local simulator.
- Collection was read-only in the provider: no new payment, refund, approval, replay, API key or sharing permission was created. No login credentials or raw provider payloads are included. This folder is evidence packaging, not an integrated completion verdict or production-compliance claim.
- GitHub provides read-only browsing and downloads for public viewers. Dashboard deep links in the manifest still require existing Stripe account access; they do not grant it.
