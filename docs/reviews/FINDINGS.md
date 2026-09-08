# Review findings register

One line per finding from the independent reviews (design and implementation). Full records stay in the review files; this is the running list to check before each push. Severity: HIGH blocks the slice, MEDIUM must be fixed before submission, LOW is fixed when cheap or disclosed. Status: OPEN, FIXED (with the commit), DISCLOSED (known limitation written in README), DECIDED (Yoann's call recorded in DECISIONS.md).

| ID | Sev | Finding (one line) | Fix | Status |
|---|---|---|---|---|
| F-01 | HIGH | Webhook retry after a processing failure was acknowledged and never processed; no lease | Store event, lease with one UPDATE (pending, failed, or processing older than 5 min), 500 on failure | FIXED 3c9ef3a |
| F-02 | HIGH | Journal entries keyed on the webhook event would double-post (several Stripe events per money effect) | Key entries on (money_operation, operation id, entry type) | FIXED in design; code in B2 |
| F-03 | HIGH | Simulated claim rail had no provider-truth source, so a planted mismatch could not be found | Simulator keeps its own provider-side records, reconciled like Stripe | FIXED in design; code in B7/B10 |
| F-04 | MED | Worked example counted 366 days for a March 1 term (365) | Recited example redone with 365 days | DECIDED 29312ca |
| F-05 | MED | Earning window per written segment and negative endorsement delta undefined | Segments earn from their effective date; negative delta: refund now or credit | Segments FIXED in design; negative delta OPEN (Yoann, B4) |
| F-06 | MED | Chart of accounts could not book claims | Accounts added with a worked claim example | FIXED in design; code in B7 |
| F-07 | MED | Closed-month rerun vs corrected month undefined | Statement runs carry a knowledge cutoff; corrections create a new revision | Proposal written; OPEN (Yoann, B9) |
| F-08 | MED | Sandbox checks only on Stripe webhooks | Key prefix check in lib/stripe.ts; livemode CHECK in the database; startup account check still to add before B2's first outbound call | Partly FIXED 8bb9063 and 0003; startup check OPEN (B2) |
| F-09 | MED | Seed and test databases not addressed | Seed refuses a non-empty database; disposable corgi_test database for committing tests | corgi_test FIXED; seed in B2 |
| F-10 | MED | Human-approver check location unspecified | Trigger on approval_decisions plus session-only approve route | FIXED in design; code in B7 |
| F-11 | MED | Recovery "by idempotency key" is not a Stripe capability | Recovery per kind (same key resend, list by client_reference_id, refunds by PaymentIntent) | FIXED in design; code in B2/B5 |
| F-12 | MED | Refund allocation across several payments undefined | Newest collection first, one Stripe refund per PaymentIntent | FIXED in design; code in B5 |
| F-13 | MED | Stripe fees not journaled | Excluded explicitly by reconciliation and disclosed | DISCLOSED (README in B6) |
| F-17 | MED | Commission clawback rounding undecided | Floor or ceil | OPEN (Yoann, B5) |
| F-B1-01 | HIGH | app_runtime could append balanced lines to a committed entry (history changed without UPDATE) | Trigger: lines only in the transaction that created the header; test on corgi_test | FIXED 0003 (this commit) |
| F-B1-02 | MED | db/client.ts fell back to the owner connection when DATABASE_URL_APP was unset | Fail closed: DATABASE_URL_APP required | FIXED (this commit) |
| F-B1-03 | MED | Owner could TRUNCATE protected tables | BEFORE TRUNCATE triggers | FIXED 0003 |
| F-B1-L | LOW | received_at client-settable; no DB livemode check; refunded tax may exceed tax charged by one cent on early cancellation; claims_paid account missing; two synthetic replay-test events in the production inbox; README gaps | received_at and livemode fixed in 0003; tax cap in B5; account in B7; replay events disclosed in README; README in B6 | Partly FIXED; rest tracked in the slices named |
