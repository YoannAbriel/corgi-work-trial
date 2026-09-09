# Week-two plan and cut list (draft of 2026-09-09, completed at the freeze)

Everything below is either decided as week-two work in docs/DECISIONS.md, disclosed in docs/reviews/FINDINGS.md with a reason, or on the cut list v0 of docs/ATTACK-PLAN.md. Nothing here is hidden from the screens: each limitation is named where a reader would meet it.

## Week two, in order of value

| # | Item | Why now rather than in the trial | Where it is recorded | Estimate |
|---|---|---|---|---|
| 1 | Second layer on MCP keys: a database trigger refusing an approval decision by the person who created the key through which the request was raised (column created_by on mcp_api_keys, new and nullable) | The path is closed by decision 26 (only staff operations mint keys); the trigger is defence in depth against a future allowlist regression | Decision 26; F-INT-01 | 2 h |
| 2 | Guard triggers on the two rate tables (brokers.commission_rate_bps, state_tax_rates) | History is safe today because every rate is frozen on the event that used it; the guards make the tables themselves append-only like the money tables | F-INT-09 | 1 h |
| 3 | One threshold base for corrections, aligned with decision 24 (cumulative per policy, premium before tax) | Endorsements follow decision 24 since 20439ad; the correction path keeps its own base, which fails safe | F-INT-12 scope line; F-B8-02 | 2 h plus re-review |
| 4 | A refund path for parked money (unapplied_customer_cash) through the approval queue | Rule 14 parks the cash; returning it is a money-out and needs the maker-checker queue that exists for claims and cancellations | Decision 27; F-B4-01 | 3 h plus re-review |
| 5 | Journal a refused amount mismatch on a delta payment, and a column-level grant on webhook_processing | Both are posting or privilege changes; the refusals themselves are proven by the replay checks | F-B4-11; F-B1-10 | 2 h |
| 6 | Activity log on server-rendered pages through middleware, so page latency joins route latency | Only the API routes write a row today; page latency is measured by the console tiles | F-OB-04 | 2 h |
| 7 | A trigger on role promotion so an agent key can never sit on an approver, and the agent marker derived inside requestClaimPayment | No code path promotes a user today; only two reviewed callers exist | F-B11-04; F-INT-11 | 2 h |
| 8 | Bank account verification on a real sandbox (Plaid) and the claim payout rail on a real sandbox (Increase or equivalent), replacing the two local simulators | Both simulators are labelled LOCAL SIMULATOR on every screen, in the README and in the integration inventory; the ledger already treats the rail like a real one (delayed settlement, returns) | Attack plan, integration inventory | 1 day each |
| 9 | Read cost at scale: the staff inbox and the policy list fold each policy (about 0.13 s per policy on a 1077-policy database) and the staff inbox reads one query per claim | Correct at the delivered scale (four policies on production); a materialised read or a batched fold before the estate grows | UI-004 cost note; cycle C note | 1 day |
| 10 | The nine P3 items of the desktop audit and the branding question (colour banners against the monochrome reference portal) | Cosmetic; the branding one is a choice for Corgi, not a defect | docs/ui-audit-2026-09-09.json; UI-001 | half a day |
| 11 | As-of between two endorsements on production data, and a second live-fire pass on every step | No production policy carried two endorsements before the freeze | Recheck LF-5 | half a day |

## Cut list v0, unchanged

Deliberately not built: renewals, a public REST API (MCP is the machine surface), a customer portal beyond approvals, documents and change requests, ACH collection, instalment billing, e-signature, USDC payout, a second product line, a reinsurance note, broker API keys beyond the MCP keys.

Production-only work recorded as limitations: a real KYB policy (the trial uses Stripe Connect business verification in test mode), real tax filings, real bank rails.

## Migrations never touched again

Applied migration files are never edited or renumbered (0009 is unused; two comments in 0008 and 0018 describe an older shape of the agent rule). Anything that must change goes in a new migration.
