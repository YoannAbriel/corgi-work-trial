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
