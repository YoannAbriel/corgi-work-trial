# Live-fire day 2: figures expected versus figures read

Co-pilot session corgi-work-trial-e1, branch `live-fire-evidence`. Yoann clicks in the deployed
interface (https://corgi-work-trial-iota.vercel.app); this session never submits a form on
production and never calls a money route. Before each click the expected figures are computed
from the repository's pure functions or read from the read-only preview pages; after each click
the result is verified by GET requests signed in as the demo roles, the PDFs are downloaded and
the screenshots taken headless. Evidence lives under `docs/evidence/live-fire-day2/<step>/`.
Timestamps are UTC.

## LIVE-0: reconciliation run and Redwood September statement (YOA-645)

Deployed revision at the start of the step, from `/api/health` at 18:32:44Z: `c408cb3`
(main was two commits ahead at `a530b84`, the inspect_reference MCP tool under lib/ only; the
coordinator confirmed c408cb3 carries the probe classification, the break notes and migrations
0022 to 0025, and that LIVE-0 runs on it).

Before the click (18:31Z, `LIVE-0/before/`): 35 breaks to act on, 0 probes, one explained break
(pi_3UDQN7K6R3v50tIy0fdlIi1Q, the note of the production confirmation); among the 35: 31 payments
of $42.42, one of $100.00, two of $12.61, one refund of -$8.98. Latest complete Stripe run
16:25Z, 42 provider records against 7 ledger records, 36 breaks. Redwood 2026-09 at revision 3
(net due $389.35, cutoff 2026-09-08 17:26:29Z, no CGP-01707 line).

### Click 1: ops@example.com, /ops/reconciliation, "Reconcile both sources now" (18:38:23Z)

| Figure | Expected | Read (GET after the click) | Agree |
|---|---|---|---|
| Stripe run summary | 42 provider records against 7 ledger records, 32 probes, 4 breaks to act on | "42 provider, 7 ledger, 32 probes, 4 breaks to act on", complete, run by Sam Patel at 18:38:23Z | agree |
| Claim rail run summary | 1 provider, 3 ledger, 0 break | 1 provider, 3 ledger, no break to act on, complete | agree |
| Chip on the band | 4 breaks to act on | "4 breaks to act on, 32 probes from check runs" | agree |
| Probes tile | 32 | 32, "planted by our own check runs" | agree |
| Inbox badge | 4 | "4 waiting for you" | agree |
| The explained $42.42 break | returns as a probe (migration 0025: the note no longer matches the report) | not in the breaks to act on; probes 32 = 31 open + the explained one | agree |

Closes F-BP-01 on production: the four remaining breaks to act on are the $100.00, the two
$12.61 and the -$8.98 refund the production confirmation predicted.

### Click 2: ops@example.com, /ops/statements, "Run a statement", Redwood Commercial Brokers, 2026-09, cutoff empty (18:45:13Z)

Expected figures computed at 18:31:31Z with `brokerJournalEntriesInMonth` plus `computeStatement`
(the run's own reader and pure function) inside a READ ONLY transaction as `app_runtime`,
nothing stored (`LIVE-0/before/expected-statement-redwood-2026-09.txt`).

| Figure | Expected | Read | Agree |
|---|---|---|---|
| Revision | 4, supersedes revision 3 | 4, supersedes revision 3 | agree |
| Canonical format version | 3 | 3 | agree |
| Against the previous revision | format changed (revision 3 is version 2) | format changed | agree |
| Entries in the month | 16 | 16 lines | agree |
| Cash collected | 832861 = $8,328.61 | $8,328.61 | agree |
| Premium collected (commission base) | 806411 = $8,064.11 | $8,064.11 | agree |
| Commission earned | 120961 = $1,209.61 | $1,209.61 | agree |
| Clawback | 78005 = $780.05 | -$780.05 | agree |
| Net due | 42956 = $429.56 (was $389.35: +34520 CGP-01707, -30499 CGP-01274 clawback recorded 18:27:59Z on the 8th, after the revision 3 cutoff) | $429.56, "120961 - 78005 + 0", ties to the ledger | agree |
| CGP-01707 cash lines | $1,253.20 (2026-09-08) + $1,127.24 (2026-09-09) = $2,380.44 | $1,253.20 + $1,127.24 | agree |
| CGP-01707 premium in it | $1,200.00 + $1,101.36 = $2,301.36 | $1,200.00 + $1,101.36 | agree |
| CGP-01707 commission | $180.00 + $165.20 = $345.20 | $180.00 + $165.20 | agree |
| Content hash (sha256) | 7eddb01ae791314713dc57eb69a11d07bbafc1f4926028417391d6af0919c78c (the hash depends on the entries alone) | 7eddb01ae791314713dc57eb69a11d07bbafc1f4926028417391d6af0919c78c | agree |
| Knowledge cutoff | database clock at the run | 2026-09-09 18:45:13Z | agree |
| Status | provisional (month in progress) | provisional | agree |
| Statement run id | n/a | c602abcf-7113-4256-a8c5-711778cf4000 | recorded |
| PDF | downloadable, same hash printed | 12912 bytes, `LIVE-0/after/statement-redwood-2026-09-revision-4.pdf` | recorded |

Disclosed: before the Redwood run, Yoann's first "Run a statement" click went to the broker the
select shows first, Harbor Point Insurance Services (2026-09, revision 2, $0.00, identical to its
revision 1, run id e4ba3f53-3150-4c82-9dd3-ce350af2e541, 18:42:37Z). A quiet month is a real
statement; the run is immutable, moved no money and stays on the list. The Redwood run followed
at 18:45:13Z.

Evidence: `LIVE-0/before/` (board and runs text, screenshots, expected statement),
`LIVE-0/after/` (board, runs and revision 4 screenshots, page texts, the PDF).

## LIVE-8: backdated correction of CGP-01707 (YOA-646)

Deployed revision at the start of the step, `/api/health` at 19:01:55Z: `92379e2` (unchanged at
19:55:03Z). Policy `3c3697b7-33f8-45a4-beaf-5a1892fc9483`, term 2026-09-08 to 2027-09-08 (365
days), endorsement $1,200.00 to $2,400.00 recorded 2026-09-09 06:34:34Z effective 2026-10-08
(event e3e7c572), to be moved to 2026-09-22. Both PDFs downloaded before (`LIVE-8/before/`,
declarations and endorsement schedule as of 2026-09-09) together with the policy page text and
the read-only preview.

Entry point observed: the policy overview shows no correction action (band: Endorse, Cancel the
policy, Open a claim; the Correct sub-menu item appears only on the correction page itself); the
only link is the inline form under the Endorsements view. Reported to the interface session and
the coordinator as LOW; Yoann used the direct URL.

### Click 1 and 2: ops@example.com, preview then Confirm (recorded 19:33:07Z)

Preview read by GET before the click (`LIVE-8/before/correction-preview-2026-09-22.txt`) and
re-read by Yoann on the screen: identical.

| Figure | Expected (correctEndorsementDateMoney) | Read | Agree |
|---|---|---|---|
| Days remaining at the corrected date | 351 of 365 (365 - 14) | 351 of 365 | agree |
| Prorated premium as booked | floor(120000 x 335 / 365) = 110136 | $1,101.36 | agree |
| Prorated premium at the corrected date | floor(120000 x 351 / 365) = 115397 | $1,153.97 | agree |
| Premium difference | 5261 | $52.61 | agree |
| Tax difference | floor(115397 x 235 / 10000) - floor(110136 x 235 / 10000) = 2711 - 2588 = 123 | $1.23 | agree |
| Total to collect | 5384 | $53.84, "collect" | agree |
| Commission on the difference | floor(5261 x 1500 / 10000) = 789 | $7.89 | agree |
| Customer approval (decisions 24 and 31) | running total 110136 + 5261 = 115397 above 50000, required | "carries $1,153.97 of additional premium in this term, above $500.00, so the customer has to approve it" | agree |
| Policy version expected by the form | 5 | expectedPolicyVersion 5 | agree |

After Confirm (GET as ops, timeline and money views): a `correction_reversal` event effective
2026-10-08 (4c6de9d0) superseding e3e7c572, shown struck through ("It was superseded by a
correction. The row stays in the table for ever"); a `correction_rebook` event effective
2026-09-22 (0f90381f, "$1,153.97 of prorated premium, difference $53.84"); journal:
`reversal_of_endorsement_premium_written` 110136 and `reversal_of_endorsement_tax_billed` 2588,
both effective 2026-10-08 and naming the entries they mirror (f1fc2553, 63646ae0); re-booked
`endorsement_premium_written` 115397 and `endorsement_tax_billed` 2711 effective 2026-09-22;
premium receivable 5384; the cash entries of the endorsement untouched; unearned premium held
120000 + 115397 = $2,353.97; a money operation of $53.84 "the customer has to approve it before
the hosted page is opened".

### Click 3: customer@example.com, "Approve paying $53.84" (about 19:39Z)

Timeline event `correction approved`, "The customer approved paying the correction difference of
$53.84". No Stripe page opens on approval (the customer decides, the broker collects: agency
bill, decision of 06:35Z).

### Click 4: broker@example.com, Money view, "Collect the difference ($53.84) with Stripe (test mode)", test card 4242 (19:50:43Z)

Found only at the bottom of the correction block on the Money view after the four journal
entries; reported to the interface session (button and state chip to the top, entries folded,
inbox link landing on the block).

| Figure | Expected | Read | Agree |
|---|---|---|---|
| Webhook | payment_intent.succeeded on the deployed endpoint | received 19:50:43Z, reference pi_3UDrW1K6R3v50tIy1GPWqtve, operation "done, 1 attempt: the correction difference is collected" | agree |
| correction_premium_collected | 5384, Dr cash_stripe, Cr premium_receivable | $53.84, effective 2026-09-09, recorded 19:50:43Z, entry 4203ce46 | agree |
| correction_commission_earned | 789 | $7.89, entry 99a17629 | agree |
| Cash collected on the policy | 125320 + 112724 + 5384 = 243428 | $2,434.28 | agree |
| Commission owed, net | 34520 + 789 = 35309 | $353.09 | agree |
| As it stood on 2026-09-15 | $1,200.00, tax $28.20, $1M / $2M | $1,200.00, $28.20, $1,253.20, $1M / $2M | agree |
| As it stood on 2026-09-25 | $2,400.00, $2M / $4M | $2,400.00, $56.40, $2,481.40, $2M / $4M | agree |

PDFs after: declarations and endorsement schedule as of 2026-09-09 (comparable to the before
files) and as of 2026-09-25 (the corrected endorsement in force), `LIVE-8/after/`.

### Statement after the collection: ops@example.com, Redwood 2026-09 (19:59:14Z)

Yoann also ran revision 5 at 19:36:34Z, between the correction and the collection: identical to
revision 4 ($429.56, same hash), which is the right answer since the correction alone posts
neither cash nor commission. Revision 6 expected figures computed read-only at 19:55:16Z.

| Figure | Expected | Read | Agree |
|---|---|---|---|
| Revision | 6, supersedes 5 | 6 | agree |
| Lines | 18 (two new: premium collected $53.84 of which $52.61 premium, commission $7.89) | 18, both "appeared" against revision 5 | agree |
| Cash collected | 838245 | $8,382.45 | agree |
| Premium collected | 811672 | $8,116.72 | agree |
| Commission earned | 121750 | $1,217.50 | agree |
| Clawback | 78005 | -$780.05 | agree |
| Net due | 43745 | $437.45, "121750 - 78005 + 0" | agree |
| Content hash | 5c991578feb94844d3b1fb9de8d04010d3bd4788134902953dc0c900b41e84d8 | same | agree |
| Canonical format version | 3 | 3 | agree |
| Statement run id | n/a | 8df46119-a401-41a6-b8c2-c093a7c1ba02 | recorded |

Every figure of LIVE-8 agrees. Freeze checklist section D: evidence in
`docs/evidence/live-fire-day2/LIVE-8/` (before and after).

Interface findings raised during the step, all presentation only, sent to the interface session
and taken into its evening batch: the correction entry point on the policy band and sub-menu;
the preview with signed colours, the days movement and the reversal-then-rebook block; the collect
button and state chip at the top of the correction block with the entries folded and the inbox
link landing on it; a Billing view on the policy page (decision 43); statement totals as a
subtraction with the clawback line between commission and net due; one row per broker and month
on the statements list with earlier revisions folded (Yoann opened revision 5 instead of 6 from
the stacked list). Decision 44 (direct bill through the same Checkout session) recorded by the
coordinator, not built during the live-fire.
