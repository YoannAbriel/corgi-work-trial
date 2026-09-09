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

Addendum LIVE-8: Yoann ran Redwood 2026-09 once more at 20:03:04Z, revision 7, identical to
revision 6 ($437.45, same hash); one more immutable row, no effect.

## LIVE-9: second endorsement on CGP-01707, the cumulative $500 threshold and three as-of dates (YOA-648)

Deployed revision at the start of the step, `/api/health` at 20:04:24Z: `92379e2`. Starting
terms on record after LIVE-8: annual premium $2,400.00 from 2026-09-22, limits $2M / $4M.
Chosen change: annual premium $2,400.00 to $2,700.00 (+$300.00), limits unchanged, effective
2026-10-01 (after 2026-09-22 as required), reason "Live fire day 2: second endorsement".

### Click 1 and 2: broker@example.com, Endorse, preview then confirm (requested 20:11:09Z)

Preview read by GET before the click (`LIVE-9/before/endorsement-preview-2700-2026-10-01.txt`),
identical on Yoann's screen.

| Figure | Expected (computeEndorsement) | Read | Agree |
|---|---|---|---|
| Days remaining from 2026-10-01 | 342 of 365 | 342 of 365 | agree |
| Annual difference | 270000 - 240000 = 30000 | $300.00 | agree |
| Prorated premium | floor(30000 x 342 / 365) = 28109 | $281.09 | agree |
| Tax | floor(28109 x 235 / 10000) = 660 | $6.60 | agree |
| Delta to collect | 28769 | $287.69 | agree |
| Commission | floor(28109 x 1500 / 10000) = 4216 | $42.16 | agree |
| Running total of additional premium (decision 24) | 115397 + 28109 = 143506, above 50000: customer approval | "this policy would carry $1,435.06 of additional premium in this term, this quote included, above $500.00: the customer approves before the delta can be paid" | agree |
| After confirm | endorsement requested, terms unchanged | "Endorsement in progress, awaiting the customer", effective 2026-10-01, requested 20:11:09Z, delta $287.69 | agree |

### Click 3: customer@example.com, approve the quote (about 20:15Z)

Event `endorsement approved`, "The customer approved that quote ($287.69)". Broker inbox after
it: "Endorsement deltas to pay 1", CGP-01707 $287.69 (`LIVE-9/after/broker-inbox-after-approval.txt`).

### Click 4: broker@example.com, Pay $287.69, test card 4242 (20:17:43Z)

| Figure | Expected | Read | Agree |
|---|---|---|---|
| Webhook | payment_intent.succeeded | received 20:17:43Z, reference pi_3UDrw9K6R3v50tIy1XjCYQsU, operation stripe_checkout succeeded | agree |
| endorsement_premium_written | 28109 effective 2026-10-01 | $281.09, effective 2026-10-01 | agree |
| endorsement_tax_billed | 660 effective 2026-10-01 | recorded 20:17:43Z, effective 2026-10-01 | agree |
| endorsement_premium_collected | 28769 effective 2026-09-09 | $287.69 | agree |
| endorsement_commission_earned | 4216 | $42.16 | agree |
| Cash collected on the policy | 125320 + 112724 + 5384 + 28769 = 272197 | $2,721.97 | agree (the brief to Yoann said $2,722.00 by an addition slip of this session; the pure figure and the page agree) |
| Commission payable | 18000 + 16520 + 789 + 4216 = 39525 | $395.25 | agree |
| Unearned premium held | 120000 + 115397 + 28109 = 263506 | $2,635.06 | agree |
| Endorsements table | two rows: 2026-09-22 corrected date, 2026-10-01 | "2026-09-22 $1,200.00 to $2,400.00 corrected date", "2026-10-01 $2,400.00 to $2,700.00" | agree |

### Three "as it stood on" dates (GET as ops, `LIVE-9/after/as-it-stood-on-*.txt` and `.png`)

| Date | Expected | Read | Agree |
|---|---|---|---|
| 2026-09-15 (before the first endorsement) | $1,200.00, tax $28.20, term $1,253.20, $1M / $2M | $1,200.00, $28.20, $1,253.20, $1,000,000.00 / $2,000,000.00 | agree |
| 2026-09-25 (between the two) | $2,400.00, tax floor(240000 x 235 / 10000) = $56.40, term $2,481.40, $2M / $4M | $2,400.00, $56.40, $2,481.40, $2,000,000.00 / $4,000,000.00 | agree |
| 2026-10-05 (after the second) | $2,700.00, tax floor(270000 x 235 / 10000) = $63.45, term $2,788.45, $2M / $4M | $2,700.00, $63.45, $2,788.45, $2,000,000.00 / $4,000,000.00 | agree |

PDFs after as of 2026-10-05 (declarations, endorsement schedule) in `LIVE-9/after/`. Every
figure of LIVE-9 agrees. Freeze checklist section D: evidence in
`docs/evidence/live-fire-day2/LIVE-9/`.

Interface items raised during the step, sent to the interface session (presentation only):
the "in force today" tile read as stale next to future endorsements (a "latest terms on record"
tile and the same pair on the policy lists); a pending endorsement absent from the customer's
"Changes to this policy" table (a row with a state chip); no visible notification for the broker
after the customer's approval (band action, notice line, sub-menu count); the broker home
printing the count twice without a plural ("11 endorsement delta to pay").

## LIVE-7: cancellation of CGP-01707 with an open claim, refund above $1,000 through the approval queue (YOA-647)

Deployed revision at the start of the step, `/api/health` at 20:22:07Z: `d002f77` (interface
batch 1; nothing under db/ or app/api). Policy state before: cancelled nowhere, three written
premium segments (120000 from 2026-09-08, 115397 from 2026-09-22, 28109 from 2026-10-01), tax
charged 2820 + 2711 + 660 = 6191, cash collected $2,721.97, open claim CLM-00213 with a $2,000.00
reserve and $0.00 paid, approvals queue empty (`LIVE-7/before/`).

Expected refund computed before the click with `cancellationBreakdown` (lib/money/premium.ts) on
those segments (`LIVE-7/before/expected-cancellation-pure-function.txt`) and read again on the
broker's preview page for 2026-11-08 (`LIVE-7/before/cancel-preview-2026-11-08.txt`, identical
figures on 92379e2 and d002f77).

### Click 1: broker@example.com, Cancel the policy, effective 2026-11-08, Preview then Confirm (20:32:36Z)

| Figure | Expected (pure function) | Read (preview, then the policy after Confirm) | Agree |
|---|---|---|---|
| Days covered | 61 of 365 | 61 of 365 | agree |
| Written premium | 263506 | $2,635.06 | agree |
| Earned, kept | floor(120000 x 61 / 365) + floor(115397 x 47 / 351) + floor(28109 x 38 / 342) = 20054 + 15452 + 3123 = 38629 | $386.29, `premium_earned_to_date` 38629 effective 2026-11-08 | agree |
| Unearned, refunded | 263506 - 38629 = 224877 | $2,248.77, four `refund_requested` entries 81374 + 5260 + 28108 + 110135 effective 2026-11-08 | agree |
| Tax refunded | ceil(224877 x 235 / 10000) = 5285, under the 6191 charged | $52.85 | agree |
| Fee refunded | 0 | $0.00 | agree |
| Total refund | 230162 | $2,301.62 | agree |
| Commission clawback | floor(224877 x 1500 / 10000) = 33731 | $337.31 | agree |
| Refund slices, newest collection first | 28769, 5384, 112724, 83285 (the issuance payment partly) | $287.69 (pi_3UDrw9), $53.84 (pi_3UDrW1), $1,127.24 (pi_3UDf5Y), $832.85 (pi_3UDUCU) | agree |
| Maker-checker | total above $1,000, a distinct approver required | "This refund is above $1,000.00, so it requires approval ... a staff approver who is not you" | agree |
| Open claim | untouched | "Reserve still held, untouched $2,000.00; already paid on it, untouched $0.00", CLM-00213 named | agree |
| After Confirm | policy cancelled, four requests waiting, nothing at Stripe | policy "cancelled"; `refund_payable` credited $2,301.62 in four `refund_requested` entries; queue: 4 waiting, $2,301.62 | agree |

### Click 2: ops@example.com, /ops/approvals (read by Yoann on his screen, about 20:33Z)

Four rows waiting, $287.69, $832.85, $1,127.24 and $53.84, asked by Dana Ruiz (broker),
destination Stripe, subject CGP-01707, each with the chip **"not an approver"** and no decision
form; the band states the rule and "Agent raised 1" counts the earlier MCP request. Expected:
refused, never the initiator, never a non-approver. Agree. (This session read the queue as ops
before the cancellation, empty, and after the decisions, where the four rows show "approved";
the waiting state itself is Yoann's read.)

### Click 3: approver@example.com, approve the four requests with a reason (20:34:28Z to 20:34:32Z)

Decided view read as ops: four rows "approved, Alex Kim, approver, 2026-09-09", each with the
intent text and its hash under "What was approved, exactly", decided at 20:34:28Z, 20:34:29Z,
20:34:30Z and 20:34:32Z (`LIVE-7/after/approvals-decided.txt`). Agree.

### Click 4: ops@example.com, policy page, "Send to Stripe" on the four refunds (about 20:36Z)

Yoann pressed the four buttons in quick succession; each POST redirected to the policy page,
which he saw reload once. Read by GET afterwards:

| Figure | Expected | Read | Agree |
|---|---|---|---|
| Stripe refunds created through the Refunds API | four, one per PaymentIntent | re_3UDrw9K6R3v50tIy1ffy43I1 ($287.69), re_3UDUCUK6R3v50tIy0gKOTYl7 ($832.85), re_3UDf5YK6R3v50tIy1TVf1Llk ($1,127.24), re_3UDrW1K6R3v50tIy1qNn3zvG ($53.84) | agree |
| Webhooks | refund.created, refund.updated, charge.refunded per refund | received on the deployed endpoint; refund.updated after refund.created answered "already posted by an earlier delivery of this refund"; charge.refunded "confirmation only" | agree |
| Requested versus completed | each refund requested at 20:32:36Z, completed by the webhook | four rows "completed 2026-09-09" on the money view; `refund_completed` Cr cash_stripe 28769, 83285, 112724, 5384 recorded 20:36:27Z to 20:36:28Z, effective 2026-09-09 | agree |
| Refunded from Stripe | 230162 | $2,301.62 | agree |
| Clawback entries | 4216 + 12206 + 16520 + 789 = 33731 | four `commission_clawback` Dr commission_payable, -$42.16, -$122.06, -$165.20, -$7.89 | agree |
| Commission payable after | 39525 - 33731 = 5794 (15 percent of the 38629 earned, floored) | $57.94, "18000 + 16520 + 789 + 4216 - 4216 - 12206 - 16520 - 789" | agree |
| Unearned premium after | 0 | $0.00 | agree |
| Refunds requested and not completed | 0 after the webhooks | none open on the clearing list of the policy | agree |
| Claim reserve | $2,000.00 untouched, claim open | CLM-00213 open, reserve $2,000.00, paid $0.00, incurred $2,000.00 | agree |

Every figure of LIVE-7 agrees. Freeze checklist section D: evidence in
`docs/evidence/live-fire-day2/LIVE-7/` (before: preview, pure-function output, policy money and
claims, empty queue; after: policy overview, money, claims, decided queue, console timeline,
screenshots).

Interface items from the step, sent to the interface session: staff operations had no
notification for the four approved refunds to send (no item under Policies or Money for ops; he
found the buttons on the policy page); four separate "Send to Stripe" buttons pressed in a row
reload the page once and give no per-refund feedback (a "Send the approved refunds" action for
the whole cancellation, or a toast per send). Neither changes a money path: the send route
already covers each operation and refuses an unapproved one.

## LIVE-3: broker KYB shown live on Stripe Connect, one approved and one failed, binding refused until approved (YOA-659), revision d002f77

Deployed revision at the start of the step, `/api/health` at 20:40:55Z: `d002f77`. Before-state
read as ops and as the three brokers (`LIVE-3/before/`): Redwood Commercial Brokers (broker@,
Dana Ruiz) approved on EIN ending 0000 since 2026-09-08 (acct_1UDNobK6R3ohMVag); Harbor Point
Insurance Services (broker2@, Priya Nair) failed with `verification_failed_tax_id_match` on EIN
ending 1111 since 2026-09-08 13:03:27Z (acct_1UDOfRK6R3FpfF2D, history rows "verification
pending" 13:02:33Z then "verification failed" 13:03:27Z); Sierra Crest Brokerage (broker3@, Marco
Silva) never submitted, status unknown, no connected account, home item "Business verification
not submitted: you cannot bind". The ops "New broker" card is disabled ("Route pending: POST
/api/brokers is not on this branch yet"); Yoann decided at about 20:45Z that the route is built
tonight, so Sierra Crest could be consumed by this step. Fixtures per the submit form and
lib/kyb/stripe-connect.ts: EIN 000000000 verifies, 111111111 fails with
verification_failed_tax_id_match, address token address_full_match, a valid website (Stripe
refuses example.com with url_invalid). Sandbox only, test-mode account, no real money.

### Click 1: broker2@example.com (failed), New policy then the policy page (about 20:47Z)

Draft CGP-01708 created (Test Customer, $12,000.00 annual premium, $1,000,000 / $2,000,001,
term 2027-02-21 to 2028-02-21; the figures are Yoann's typing, the field is in dollars). On the
policy page: the "Pay with Stripe (test mode)" button rendered disabled, the sentence "Payment is
blocked while the broker is not approved. Stripe refused this verification. Binding is refused;
submitting corrected details starts a new verification. Stripe reason:
verification_failed_tax_id_match.", the Broker card chip "failed". Expected: binding refused for
the failed broker (lib/payments/checkout.ts refuses the server side too, with 'binding is
refused: the broker's KYB status is "failed" and must be "approved"'). Agree.

### Click 2: broker3@example.com (unknown), New policy then the policy page

Draft CGP-01709 (TestCustomer2, $12,000.00, $1,000,000 / $2,000,000, term 2026-09-26 to
2027-09-26). Pay disabled, sentence "Payment is blocked while the broker is not approved. No
verification on file for this broker. Binding is refused until one passes.", chip "unknown".
Agree. Wording noted: the Broker card also prints "KYB: not yet live: a seeded placeholder, not
provider evidence" for a broker that never submitted anything (no seed row either), which reads
wrong; LOW for the interface session.

### Click 3: broker3@example.com, /broker/kyb, Submit for verification (20:50:41Z)

Submitted: Sierra Crest Brokerage LLC, EIN 000000000 (stored as "ending 0000"),
address_full_match San Francisco CA 94105, website https://corgi-work-trial-iota.vercel.app,
agreement accepted (instant and IP recorded, IP not copied here). Read by GET:

| Figure | Expected | Read | Agree |
|---|---|---|---|
| Connected account created at Stripe | one v2 account, test mode | acct_1UDsS1K6R3yO7TeG | agree |
| Status right after | pending, settling window of two minutes | "pending", "Verification in progress at Stripe, at least 2 minutes. Binding is refused until it passes. Stripe reason: awaiting the first verification result." | agree |
| History | one row "verification pending" | pending, Stripe Connect, 2026-09-09 20:50:41 | agree |
| Ops list | Sierra Crest pending | console file "verification pending 20:50:41" | agree |
| account.updated webhook | 45 to 60 seconds after creation | received 20:51:44Z on the deployed endpoint, listed on /ops/console?kind=webhook for acct_1UDsS1K6R3yO7TeG | agree |
| "Check at Stripe" inside the window (Yoann clicked once early) | still pending, nothing appended | "Read again at Stripe: still pending (awaiting the first verification result), nothing appended" | agree |

Observed: the broker's own Webhooks view on the console
(`/ops/console/broker/<id>?view=webhooks`) says "This object has no provider reference yet, so no
webhook could name it" although the account id is on the broker and the account.updated row is on
the global list. LOW for the coordinator (the broker webhooks view does not resolve the connected
account id).

### Click 4: broker3@example.com, "Check at Stripe" after the window (20:53:53Z)

| Figure | Expected | Read | Agree |
|---|---|---|---|
| Status | approved, binding allowed, window clear | "approved", "Binding allowed, the rule the server applies before binding", "Settling window clear" | agree |
| History | a second row appended, the first kept | approved 20:53:53 ("business identity settled..."), pending 20:50:41 | agree |
| Ops list | Sierra Crest approved, EIN ending 0000 | "Sierra Crest Brokerage LLC, EIN ending 0000, approved, 2 min" | agree |
| Home item "you cannot bind" | gone | gone | agree |
| CGP-01709 | Pay enabled, Broker chip approved | chip "approved", the Pay form active | agree |

### Beyond the brief: Yoann paid CGP-01709 (20:54:28Z)

The brief said to stop before any payment; Yoann clicked Pay and paid with the test card. Read
by GET: checkout.session.completed 20:54:28Z (cs_test_b1wtJSGZ...), premium_collected Dr
cash_stripe 1230700 ($12,307.00: 1200000 premium, 28200 tax, 2500 fee), commission_earned
180000 ($1,800.00), policy CGP-01709 "bound", issued event effective 2026-09-26. This is the
binding the step was meant to show as allowed, now shown as done; sandbox only, no real money.
Consequences to know: Sierra Crest now has a bound policy of $12,307.00 (so a September statement
for Sierra Crest is no longer empty), and the next reconciliation run matches one more payment.
CGP-01708 (Harbor Point) stays a draft: binding refused.

Every figure of LIVE-3 agrees. Freeze checklist section D: evidence in
`docs/evidence/live-fire-day2/LIVE-3/` (before: brokers list, console files, the three brokers'
pages; after: status, history, home, brokers list, console file and timeline, CGP-01709 money and
timeline, screenshots).

## LIVE-10: the ops claim path on the simulated rail, maker-checker on claim payments (revision 4f10705)

Deployed revision at the start of the step, `/api/health` at 21:11:21Z: `4f10705` (the demo
account switcher and a 375 px fix; nothing under db/, lib/money or the claim paths). Policy
chosen: CGP-01707, cancelled effective 2026-11-08 with cover from 2026-09-08, so a loss on
2026-09-09 is claimable after the cancellation (the brief's question); CGP-01709's term starts
2026-09-26, a loss today would be outside cover. Before-state (`LIVE-10/before/`): CGP-01707
carries CLM-00213 only (reserve $2,000.00, no bank account), the approvals queue empty. Every
form was submitted by Yoann as ops@example.com, the decisions as approver@example.com through
the sidebar account switcher; this session read by GET only.

| Step | Expected | Read | Agree |
|---|---|---|---|
| Open a claim (loss 2026-09-09, reported 2026-09-09, claimant Bay Area Fabrication LLC) | CLM-00214 open, reserve 0, incurred 0 | CLM-00214 (65fca884-2960-40f3-ae0f-0a10fabbfa0c), open, $0.00 / $0.00, limits shown $2,000,000.00 per occurrence and $4,000,000.00 aggregate | agree |
| Set reserve $3,000.00 ("initial estimate") | claim_reserve_set 300000, incurred $3,000.00 | reserve set $0.00 to $3,000.00, booked $3,000.00, 21:13:53Z; Dr claims expense 300000, Cr claim reserve 300000 | agree |
| Adjust to $2,500.00 ("engineer's estimate revised") | a second row, claim_reserve_adjusted -50000, both rows kept | reserve adjusted $3,000.00 to $2,500.00, booked -$500.00, 21:17:27Z; the first row unchanged | agree |
| Bank account, routing 110000000, holder name = claimant | verified, only last four digits stored | "verified", routing ...0000 / account ...6789, "LOCAL SIMULATOR: the account at routing ...0000 is held by the claimant" | agree |
| Request A $1,200.00 | above $1,000: waiting for approval | waiting for approval, requested 21:20:35Z, approval request 7562fcd1 | agree |
| Request B $500.00 | cumulative $1,700.00 above $1,000 (rule 17): waiting for approval | waiting for approval, 21:23:12Z | agree |
| Request C $2,000.00 | refused by the reserve ceiling | "Refused: this payment of 200000 cents is more than the 80000 cents left in the reserve; raise the reserve first, so that the increase is recorded as its own decision" | agree |
| Ops on /ops/approvals with its own request D waiting | chip "your own request", no decision form | read by Yoann on his screen: "your own request" (his words: "c bon") | agree |
| Approver decides | A approved, B rejected | A approved 21:22:38Z, B approved 21:23:43Z, D ($300.00, requested 21:29Z) approved 21:29:53Z, all by Alex Kim, approver, with the intent text and hash | figures agree; the reject was not driven (see below) |
| Send A on the rail | sent, settlement 2026-09-11, paid at sending | sent 21:27:02Z, sim_tr_edbd330eb019836c1a9704e8afac5339, claim_payment_sent Dr claim_reserve 120000 Cr claims_payable 120000 | agree |
| Send B | sent | sent 21:27:19Z, sim_tr_127e3e7e412f63ef0f8a0ca1a91d7bbf, "settles on 2026-09-11" | agree |
| Send D | (not planned) | sent 21:30:39Z, sim_tr_64acae2d7f00dfdcdfd7eac9ef357561 | read |
| Settle now on A (LOCAL SIMULATOR control) | settled | settled on 2026-09-09 | agree |
| Return A (account_closed) | returned, reserve restored by 120000 | returned 21:30:45Z, claim_payment_returned, "nothing to do" | agree |
| Final position | paid = B + D = 80000, reserve = 250000 - 80000 = 170000, incurred 250000 | Paid $800.00 ("$0.00 settled by the rail"), Reserve $1,700.00, Incurred $2,500.00 = 80000 + 170000, the incurred_loss_expense balance the same | agree |
| Against the limits | incurred $2,500.00 of $2,000,000.00; committed against $4,000,000.00 | as shown | agree |

**Not driven tonight:** the approver's reject. Yoann approved A, B and D and stopped there; a
fifth request to reject was offered and declined ("c'est bon, ça y est"). A rejection by Alex
Kim exists on production from day 1 (CLM-00212, 2026-09-08, "rejected" on the decided view) and
the rejected state is documented on the payments view legend; it was not exercised in this
session. The self-approval refusal was shown by the chip on ops' own request, not by a POST.

**Readable tonight versus not:** the settlement of A was forced through the LOCAL SIMULATOR
control ("Settle now"); B and D carry the settlement date 2026-09-11 and would be settled by the
daily job at 06:00Z on that date, after the freeze, so the automatic settlement is not readable.
The return is readable (A). Every payment row names its simulated transfer reference and the
rail label LOCAL SIMULATOR.

Evidence: `LIVE-10/before/` (claims list, queue, new-claim form, CLM-00213), `LIVE-10/after/`
(CLM-00214 overview and payments texts and screenshots, decided queue, ops view with its own
requests, console activity, claim console file). Freeze checklist section D: LIVE-10 evidence in
`docs/evidence/live-fire-day2/LIVE-10/`.

Interface items from the step, sent to the interface session: the bank account form is only in
the row menu beside "Reserve, pay, close" (Yoann: "impossible à savoir"); the Approval column of
the payments view prints the requester under the "approved" chip while the decider is only in
the row's expansion.
