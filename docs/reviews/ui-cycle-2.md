# Independent review: interface cycle 2 (merge `c408cb3`)

Reviewer: independent interface reviewer sub-agent, own git worktree
`.claude/worktrees/agent-a6976ba1aaae6e2e7`, branch `worktree-agent-a6976ba1aaae6e2e7`.
Written 2026-09-09 between 18:00Z and 19:10Z UTC.

**Reviewed revision: `c408cb30ca79ae9b6a9efc9a2e553d3956f2fdb4` (`c408cb3`, `main`, merge of
`ui-fixes`).** Parents: `2387190` (first) and `0d2b50d` (second). Production reported that revision
at `/api/health` before the first measurement (18:05:44Z) and again after the last one (18:28:11Z),
so every figure below was read on the deployed cycle-2 build and on nothing else. The working tree
of this worktree is `c408cb3` plus this record and its 24 evidence files.

This is the independent measurement `REVIEWER.md` requires for the cycle. The interface session
runs its own screenshot loop; nothing in this record comes from it. I fixed no code, edited no
shared document and pushed nothing.

---

## 1. Startup receipt (AGENTS.md)

Read **in full**, in this order, before any measurement: `CLAUDE.md`, `AUTOMATIC-FAILS.md` (all six
rules and the operating gate), `REVIEWER.md` (assignment, stage contracts, the section 3 output
contract), `AGENTS.md` (startup procedure, financial invariants, reconciliation, maker-checker and
MCP, completion gates), `READABLE-CODE.md`, `docs/handoffs/ui-cycle-2-brief.md` (the 21 decisions,
the five owners, the 19:10 feedback audit), `docs/handoffs/ui-system-notes.md`.

Read **by targeted section**: `docs/reviews/ui-system.md` (3.2 forms, 3.3 refusals, 3.4 AF-02, the
eight F-UIS findings, the verdict), `docs/reviews/b13-13-ui-audit.md` (section 3, the 26 P1/P2
items one by one; section 12, the register lines F-UA-01 to 07),
`docs/reviews/b13-14-low-screens.md` (section 3, the seventeen items; section 4, F-LU-01 to 08;
section 11), `docs/reviews/backend-production-confirmation.md` (F-BP-01 to 04 and the two register
lines), `docs/reviews/integration.md` (section 4.1, the two figure tables and the 24-figure claim),
`docs/DECISIONS.md` (decisions 28 and 29 of 13:05Z, 33 to 41 of 15:20Z, and the 16:08Z correction
note on the migration numbers).

Read **as code**: `app/ops/reconciliation/page.tsx` (whole reading path: the seven `attempt` reads,
the filters, the three tables, the caps, `describeRunResult`), `app/ops/mcp-keys/page.tsx`,
`app/ops/brokers/page.tsx`, `app/broker/kyb/page.tsx`, `app/policies/[policyId]/page.tsx` (view
routing and `PolicyAsOf`), `components/portal-frame.tsx`, `components/signed-out-frame.tsx`,
`components/amount-explained-motion.tsx` (header and the count-up rule), `lib/inbox/sections.ts`
(`INBOX_ANCHORS`, `INBOX_ANCHOR_OWNER`), `lib/mcp/tools/index.ts`, `lib/mcp/never-delegated.ts`,
and `git diff c408cb3^1 c408cb3 --stat` then the changed hunks of the 57 files under `app/` and
`components/`.

**Absent files:** none of the mandatory files is missing. `node_modules` is not installed in this
worktree, which is why the repository's own checks are recorded as NOT RUN in section 9.

**Delegate.** One read-only sub-agent (`forms-static`, opus) built the static form contract table
and the handler join from the source at `c408cb3` and `c408cb3^1`. It was given
`AUTOMATIC-FAILS.md`, `CLAUDE.md` and `READABLE-CODE.md`, wrote no file, ran no server and touched
no other worktree. Its table is used in item 1 beside my own rendered measurements; where the two
disagree I say so.

**Next acceptance criterion in my scope:** none. This is a review, not an implementation step.

---

## 2. Applicability and method

Presentation layer only. No money is moved, no ledger question is reopened: `lib/`, `db/`,
`app/api` and `scripts/` are outside the diff, and I verified that by reading the `--stat` (57
files, all under `app/` and `components/`, plus the brief). The applicable rules are therefore the
trial's own: AF-02 (honest mode labels), AF-01 (the deployed URL is what a reviewer opens), AF-04
(sandbox only), AF-05 (no secret in this record or its evidence), AF-06 (the code can be defended),
and the cycle's 21 decisions plus the previous reviews' open findings.

**Rules I worked under.** Production, GET only, plus the login POST on `/api/session/login`. No
form was submitted, no money moved, $0 spent. `DEMO_PASSWORD` was loaded with
`process.loadEnvFile` from `.env.local` in one helper and never echoed, never written to a file and
never passed on a command line. Browser: `playwright-core` from the session scratchpad, driving the
cached `chromium_headless_shell-1234` (the installed `playwright-core` asks for build 1194, which
the cache does not have, so the binary is named explicitly). Every script lives in the scratchpad,
not in the repository.

**Scale of the pass.** 52 route renders across seven identities (anonymous, `ops@`, `approver@`,
`broker@`, `broker2@`, `broker3@`, `customer@`), 60 further renders for the preview states, the
filters, the width sweep and the drawers, 24 evidence PNGs.

---

## 3. Requirement matrix

| # | Property | Control and code location | Evidence | Verdict |
|---|---|---|---|---|
| 1 | Form contracts unchanged; the money forms all present with their hidden fields; nothing that was a form became a link or a script | 39 `method="post"` sites in `app/` and `components/`; handlers under `app/api/**/route.ts` | 94 rendered POST instances, 49 distinct contracts; static join of all 39 forms against 35 handlers | **PASS**, with the disclosed `POST /api/brokers` gap (F-UI2-06) |
| 2 | The breaks board port: three lists, the explained break visible, the counts, the per-source tiles, the explain control scoped to `staff_ops`, the cap sentence | `app/ops/reconciliation/page.tsx:132`, `:406`, `:425`, `:441`, `:167`, `:1075` | measured as `ops@` and `approver@`, five views each | **PASS**; closes F-BP-02 and F-BP-03, with F-UI2-01 and F-UI2-02 |
| 3 | AF-02: the mode line on every signed-in screen, `LOCAL SIMULATOR` on every simulated row, the sandbox sentence on `/` and `/login` | `components/portal-frame.tsx`, `app/ops/reconciliation/page.tsx:91`, `app/ops/claims/[claimId]` | 42 of 42 signed-in renders carry the line; 15 widths from 375 to 900 px; every simulated row measured | **PASS**, with F-UI2-04 on the signed-out wording |
| 4 | 375 px has no sideways scroll; 1024 and 1440 have no overlap or clipping | `app/styles/system.css`, the `.table-scroll` and `DataTable` scrollers | 8 screens at 375 px with folds open, 5 states at 1024 and 1440, a 9-width sweep | **PASS** |
| 5 | The 24 figures of `docs/reviews/integration.md` item 1 unchanged; the explanation drawer prints the same lines | `components/amount-explained.tsx`, `components/amount-explained-motion.tsx` | 24 of 24 found, 0 missing; the drawer opened, read and closed three ways | **PASS**, with F-UI2-07 as a measurement caveat |
| 6 | The MCP provider page: endpoint, header, snippet, tools from the code, never-delegated list, prefixes only; approver refused | `app/ops/mcp-keys/page.tsx:17`, `:129`, `:263`; `lib/mcp/tools/index.ts`; `lib/mcp/never-delegated.ts` | read as `ops@` with every fold open; refusal measured as `approver@` | **PASS** |
| 7 | The New broker card disabled with a "route pending" sentence; F-UA-01 to 05, F-B13-30 and ten of the 26 desktop items still hold | `app/ops/brokers/page.tsx:88`, `:118` | the card measured at `?view=new`; eleven previous items re-measured | **PASS**, with F-UI2-05 and F-UI2-03 |
| 8 | Regressions: no stack trace, inbox anchors byte-identical to `lib/inbox/sections.ts`, sidebar counts equal the inbox lists, no secret shape, the demo logins work, the customer lands on `/customer` | `lib/inbox/sections.ts:19`, `:45` | 52 renders, 0 stack markers, 0 secret shapes; anchors compared per role; 6 logins | **PASS** |

---

### 3.1 Item 1: the form contracts

**94 POST form instances rendered across the 34 routes as the roles that see them, in 49 distinct
contracts.** Every one was extracted from the live DOM (action, method, every `name`, every hidden
value) and joined against the handler that answers it.

The distinct contracts, with the handler field list each one feeds:

| Action | Fields sent (hidden marked `=`) | Handler reads | Instances |
|---|---|---|---|
| `/api/session/logout` | none | no body | 42 |
| `/api/session/login` | `email`, `password` | `email`, `password` (`login/route.ts`) | 1 |
| `/api/reconciliation/breaks/<key>/explain` | `note` | `note` | 35 |
| `/api/jobs/reconcile` | none | `from`, `to`, both optional, `defaultWindow` covers them (`route.ts:70`) | 2 |
| `/api/claims/<id>` | `action=set-reserve`, `reserveAmount`, `note` | same, switch case `route.ts:45` | 1 |
| `/api/claims/<id>` | `action=request-payment`, `paymentAmount` | same, case `:56` | 1 |
| `/api/claims/<id>` | `action=add-bank-account`, `accountHolderName`, `routingNumber`, `accountNumber` | same, case `:33` | 1 |
| `/api/brokers/<id>/kyb/recheck` | none | no body | 4 |
| `/api/brokers/kyb` | `legalName`, `employerIdentificationNumber`, `addressLine1`, `addressCity`, `addressState`, `addressPostalCode`, `businessUrl`, `contactEmail`, `termsAccepted` | same, `termsAccepted` required as `"yes"` (`route.ts:23`) | 1 |
| `/api/policies` | `customerName`, `customerEmail`, `stateCode`, `effectiveAt`, `annualPremium`, `perOccurrenceLimit`, `aggregateLimit` | `readDraftFromForm`, `route.ts:57` | 1 |
| `/api/policies/<id>/endorsements` | `effectiveAt=`, `newAnnualPremiumCents=`, `newPerOccurrenceLimitCents=`, `newAggregateLimitCents=`, `reason=`, `quoteHash=` | same six, `route.ts:26`, `:36` to `:40` | 1 |
| `/api/policies/<id>/cancel` | `effectiveAt=`, `calculationMethod=`, `policyVersion=` | same three | 1 |
| `/api/policies/<id>/corrections` | `endorsedEventId=`, `correctedEffectiveAt=`, `reason=`, `expectedPolicyVersion=` | same four | 1 |
| `/api/policies/<id>/claims` | `claimantName`, `occurredAt`, `reportedAt`, `description` | same four | 1 |
| `/api/policies/<id>/change-requests` | `lines` x7, `comment` | `lines` (repeated), `comment` | 1 |
| `/api/mcp-keys` | `action=create`, `userId`, `label`, `principalKind` | same, `route.ts:39` | 1 |
| `/api/mcp-keys` | `action=revoke`, `keyId=` | same, `route.ts:58` | 1 |
| `/api/statements/run` | `brokerId`, `month`, `knowledgeCutoff` | same three | 1 |
| `/api/statements/run` | `brokerId=`, `month=2027-09`, `knowledgeCutoff=2026-09-08T17:26:29.968Z` | same three | 1 |
| `/api/brokers` | `name`, `email`, `commissionRateBps` | **no handler**, button `disabled` | 1 |

**The money forms, all present as `method="post"` with their hidden fields** (file:line from the
static pass, contract confirmed on the rendered page where production data allows it):

pay a policy `app/policies/[policyId]/page.tsx:360` (checkout) and `:370` (bind); endorse
`endorse/page.tsx:184` (six hidden, **rendered and read: `quoteHash=d86716c4...`**); the customer's
endorsement approval `endorsements/[requestEventId]/approve/page.tsx:176` (hidden `quoteHash`, the
checkbox `approved="yes"`); pay the delta `page.tsx:1513`; apply after refusal `page.tsx:1503`;
cancel `cancel/page.tsx:243` (**rendered: `effectiveAt`, `calculationMethod`,
`policyVersion=5:e3e7c572-...`**); create a correction `corrections/new/page.tsx:199` (**rendered:
four hidden including `expectedPolicyVersion=5`**); approve a correction
`corrections/[rebookEventId]/approve/page.tsx:131`; collect the difference
`correction-sections.tsx:282`; set a reserve `ops/claims/[claimId]/page.tsx:491`; record a claim
payment `:502`; send `:760`; settle `:775`; return `:788`; close `:513`; the claimant bank account
`:458`; approve and reject `ops/approvals/page.tsx:302` (`decision` carried by two submit buttons,
values `approved` `:316` and `rejected` `:319`); refund send `page.tsx:1115` and reissue `:1102`;
run a statement `ops/statements/page.tsx:144`; re-run `statements/[runId]/page.tsx:193`; reconcile
`reconciliation/page.tsx:283`, `:560` and `console-parts.tsx:380`; explain a break
`reconciliation/page.tsx:932`; KYB submit `broker/kyb/page.tsx:215`; KYB recheck `:97`,
`ops/brokers/page.tsx:222`, `console-parts.tsx:387`.

**Nothing that was a form became a link, a button outside a form, or a script.** Compared by (file,
normalised action) pair between `c408cb3^1` and `c408cb3`: zero pairs disappeared, zero changed
their field set, zero changed their hidden set. Source-level counts: 52 form elements at
`c408cb3^1` (37 POST, 15 GET) against 53 at `c408cb3` (39 POST, 14 GET). The two new POST forms are
the per-row explain form, which **connected a route that already existed with no form pointing at
it**, and the New broker card. The GET count fell by one through the four document forms becoming
one shared `DocumentRow` with the endpoint as a typed prop, same `method="get"`, same `asOf` field.
There is no `"use server"` action, no `fetch`, no `XMLHttpRequest` and no dynamic `name={...}`
anywhere under `app/` or `components/`, so the extraction is exhaustive rather than approximate.

**Fields a handler requires that no form sends: none. Fields a form sends that a handler ignores:
none. A method that is not `post`: none. A missing hidden discriminator: none** (the four `action`
values on `/api/claims/<id>` match the four switch cases, the three on the payments route match,
`create`/`revoke` match `mcp-keys/route.ts:39` and `:58`).

Two structural risks that could have broken a contract silently, both checked and clean:
`SubmitButton` spreads `{...rest}` onto a `type="submit"` button (`components/ui/submit-button.tsx:22`),
so the approvals `name="decision"` values still submit; `RowMenu` uses the native `popover`
attribute rather than a React portal (`components/ui/table.tsx:205`), so the forms inside a row
menu stay in the form's own DOM.

### 3.2 Item 2: the breaks board, and the two findings it closes

Measured on `/ops/reconciliation` as `ops@example.com`, then as `approver@example.com`, on the
default view and on `?view=breaks`, `?view=runs`, `?view=clearing`, `?view=resolved`.

**The three lists are there, under their headings.** `H2 Probe payments from check runs` and
`H2 Explained breaks` are real headings on the default and `breaks` views; the list to act on is the
band's own table, introduced by the `To act on` tile and the `35 of 35` counter.

**The explained break is visible, with its note, its author and its time.** Under
`Explained breaks`: `pi_3UDQN7K6R3v50tIy0fdlIi1Q | provider only | Probe payment from a check run,
explained during the production confirmation of 2026-09-09 | Sam Patel, operations | 2 h /
2026-09-09 16:39:11`. Evidence `recon-explained.png`. **This closes F-BP-02**: the note the backend
review appended is no longer invisible on the deployed board.

**The arithmetic behind it is right, and it is the honest half of decision 28.** The latest Stripe
run row reads `42 provider | 7 ledger | 36 | 36 breaks to act on`; the board's band, tile and
counter all read **35**. The difference is exactly the one explained break, which left the count to
act on and stayed listed. Nothing was deleted.

**The run rows use the promised sentence.** `describeRunResult` (`page.tsx:1075`) returns
`"<n> probes, <m> breaks to act on"` when the run saw probes and `"<m> breaks to act on"` when it
saw none. Every run on production reports `Probe 0`, so the measured rows read `36 breaks to act
on`, `35 breaks to act on`, `28 breaks to act on`, `22 breaks to act on`, `20 breaks to act on` and,
for the six Claim rail runs, `no break to act on`. The `N probes` prefix is correct code that
production data never exercises. Same for the band chip: `{probes.totalProbes} probes from check
runs` is conditional on `totalProbes > 0` (`page.tsx:277`), so the band shows only
`35 breaks to act on`.

**The per-source tiles count the open set, not the rows drawn.** Proved by measurement, not by
reading the SQL: at `?class=stale` the table draws **0 rows** and the counter reads `0 of 35`, while
the tile still reads **35** and the sentence still reads
`By source, over every open break: Stripe 35, Claim rail 0`. Same at `?class=local_only`. The read
is a separate `countOpenBreaksBySource(sql)` at `page.tsx:138`, with the reason written above it.

**"Explain this break" is on the rows to act on only, and only for `staff_ops`.** As `ops@`: 35
forms, all `POST /api/reconciliation/breaks/<key>/explain` with one `note` field, one per row of the
list to act on, none on the probe table and none on the explained table. As `approver@`: **0 explain
forms** on the same page, which still renders everything else (`recon-approver.png`). The gate is
`canExplain = user.role === "staff_ops"` (`page.tsx:167`), and the comment beside it says correctly
that hiding the form is not the control.

**The cap sentence could not be triggered.** `HOW_MANY_BREAKS_ON_ONE_PAGE` is 50 and there are 35
breaks, so `openPage.capped` is false and the sentence at `page.tsx:406` never renders. Verified by
code only; recorded in section 10.

**The reference drawer keeps decision 5's promise.** `?inspect=pi_3UDKjJK6R3v50tIy0nLbDPOc` opens a
drawer that says "No operation in this database carries this reference: the money exists only at
the provider. These are the facts the run recorded", then prints the provider reference, `Ledger
operation id: none`, `At the provider $100.00`, `In the ledger no record`, `Source Stripe, LIVE
SANDBOX`, `Classification provider only`, `First seen 24 h`. Not "nothing matches".

**F-BP-03 closes on its literal text** (the three headings the README names now exist on the
deployed board) and stays open on the half of the same sentence that is about data, not markup: see
F-UI2-01.

### 3.3 Item 3: AF-02

**The mode line is on every signed-in screen.** `Stripe: LIVE SANDBOX · claim rail: LOCAL SIMULATOR
· bank check: LOCAL SIMULATOR`, verbatim, in the top bar of **42 of 42** signed-in 200 renders
across six identities: 24 as `ops@`, 6 as `approver@`, 6 as `broker@`, 2 as `broker2@`, 1 as
`broker3@`, 2 as `customer@`, plus the customer's own `/policies/<CGP-01707>`, which the previous
review recorded as carrying no per-slot label (F-LU-04). It is `.topbar-modes` inside `.topbar`, and
it is `display: block; visibility: visible` at every one of the fifteen widths I swept from 375 px
to 900 px, and at 1024, 1280, 1440 and 1920. (My first sweep reported it absent at 640 px; that was
a selector artifact of picking `document.querySelector("header")`, which at that width matches the
page band rather than the top bar. Re-measured directly on the element: present at 640 px, 608 px
wide, one line.)

**`LOCAL SIMULATOR` is on every simulated row.** The claim payments table on
`/ops/claims/<CLM-00212>?view=payments`: 3 payment rows, **3 carry the word** (`settled ... LOCAL
SIMULATOR`, `refused ... LOCAL SIMULATOR` twice). The reconciliation runs view: 6 Claim rail rows,
**6 carry it**, and each run's note begins `LOCAL SIMULATOR: 2 rail records for 1 transfers`. The
reconciliation breaks list: 35 Stripe rows, **35 carry `Stripe LIVE SANDBOX`**; there is no Claim
rail break today, so no simulated break row exists to check. The console feed: 13 `LIVE SANDBOX`
chips on the Stripe webhook rows and no simulated row on the current window. `SOURCE_MODE`
(`reconciliation/page.tsx:91`) is the single source of those words.

**The sandbox sentence on `/` and `/login`:** the verbatim string
`Sandbox providers and test data. No real money.` is in the markup of both pages
(`components/signed-out-frame.tsx:32`) but is the body of a **closed** `<details class="environment-badge">`
whose summary reads only `Sandbox`, so it is not in the rendered text of either page until a reader
clicks. What a signed-out reader does see is a different sentence, `Work-trial build on sandbox
providers and test data. No real money moves here.` See F-UI2-04: not an AF-02 violation, and not a
cycle-2 change (that file is not in this diff), but it is not what the previous review recorded.

### 3.4 Item 4: widths

**375 px, with every `<details>` on the page opened first:** `documentElement.scrollWidth ==
window.innerWidth == 375` on the policy page, the policy money view, the reconciliation board, the
console, the console ledger, the inbox, the statements list and a statement run. **8 of 8.**

The elements wider than the viewport on those screens are the tables and the formula blocks, and
**every one of them sits inside a real horizontal scroller**: walking each wide element's ancestors
for `overflow-x: auto|scroll` with `scrollWidth > clientWidth`, the count of wide elements with no
scroller is **0 of 247** on the policy page, **0 of 293** on the money view, **0 of 1295** on the
reconciliation board, **0 of 329** on the console, **0 of 120** on the console ledger, **0 of 252**
on the inbox, **0 of 396** on the statements list. Nothing is clipped without a way to reach it.

**F-B13-30 re-measured the way the finding asks, with a real click rather than a scripted `open`:**
at 375 px, clicking the figure on `/policies/<CGP-01707>?view=money` leaves `scrollWidth` at **375**
(before 375, after 375), and the same on `/statements/<8effa7c1>`.

**1024 px and 1440 px:** `scrollWidth == innerWidth` on all five states at both widths. The three
fixed pieces do not overlap: `aside` at `x=0 w=248`, `header` at `x=249 w=775` (1024) and `w=1191`
(1440), `main` at `x=249`. With the console submenu open the sidebar is 248 px wide and 877 px tall
and the main column is unmoved. The reference drawer is a full-viewport overlay (`x=0 y=0
w=1024/1440 h=900`) whose backdrop is a plain `<a href="/ops/reconciliation">`, so a click outside
is a navigation and works with scripting off. The only leaf elements whose text overflows their box
are the `a.ref` reference tokens, which is decision 7 working as specified: **14 of 14** on the
console and **2 of 2** on the policy page carry their full value in `title`.

### 3.5 Item 5: the figures and the explanation drawer

**24 of the 24 money figures of `docs/reviews/integration.md` section 4.1 print unchanged, 0
missing.** Read across the seven views of `/policies/<CGP-01707>` and `/policies/<CGP-01274>` and
the three views of `/ops/claims/<CLM-00212>`:

CGP-01707: `$1,200.00`, `$28.20`, `$25.00`, `$1,253.20`, `$180.00`, `$1,200.00` (annual
difference), `$1,101.36`, `$25.88`, `$1,127.24`, `$165.20`, `$2,380.44`, `$345.20`, `$2,301.36`.
CGP-01274: `$2,312.00`, `$2,391.33`, `$278.70`, `$2,033.30`, `$47.79`, `$2,081.09`, `$304.99`,
`$41.81`, `$1,200.00`, `$3,800.00`, `$5,000.00`. The claim page repeats `$1,200.00`, `$3,800.00`
and `$5,000.00`.

**The explanation is the drawer decision 6 asked for, and it prints the same three parts.** Opening
the "Collected at Stripe" figure on CGP-01707's money view gives a panel at `x=917 w=582 h=805` in a
1440 x 950 viewport, over the content on the right. It contains, in order: the sentence naming the
rule, the formula table with **the computation in integer cents** (`Dr Cash held at Stripe (gross
of Stripe fees) 125320` / `$1,253.20`, then `112724` / `$1,127.24`, then `Collected at Stripe, all
debits added | 125320 + 112724 | $2,380.44`), **the rounding rule** (`ROUNDING nothing is rounded
here: this figure is a sum of whole cents`), and **the proving entries** (`Proved by these journal
entries ... premium_collected | 2026-09-08 | 2026-09-08 18:57:00 | Dr Cash held at Stripe ...
125320`) with a `Trace to the ledger` link. It closes on **Escape** (0 open drawers after) and on a
**click outside** (0 open drawers after). The journal lines are the aligned `Account | Debit |
Credit` table decision 10 asked for, on the claim page too.

### 3.6 Item 6: the MCP provider page

`/ops/mcp-keys` as `ops@`, every fold opened:

- **Endpoint**: `POST https://corgi-work-trial-iota.vercel.app/api/mcp, streamable HTTP, JSON-RPC 2.0`.
- **Header**: `Authorization: Bearer <key>, the secret shown once when the key is created`.
- **Snippet**: `claude mcp add --transport http corgi-trial https://corgi-work-trial-iota.vercel.app/api/mcp --header "Authorization: Bearer <key>"`, plus a line for the MCP Inspector.
- **Tools read from the code**: the page prints `{MCP_TOOLS.length} tools` (`page.tsx:129`) and maps
  `MCP_TOOLS` (`:263`), importing it from `@/lib/mcp/tools`. It shows **7**:
  `get_policy_as_of`, `get_broker_statement`, `explain_amount`, `list_my_activity`,
  `list_reconciliation_breaks`, `run_reconciliation`, `request_claim_payment`. That is exactly
  `MCP_TOOLS` at this revision. `inspect_reference` (decision 42) is not in the list and not on the
  page, which is correct for today: seven, not eight.
- **Never-delegated list**: present, from `NEVER_DELEGATED` (`lib/mcp/never-delegated.ts`), under
  the heading `Never delegated to an agent` inside `About this screen`, with each operation and its
  reason (`approve or reject a money-out request`, `send a claim payment on the payout rail`,
  `issue or re-issue a refund at Stripe`, `bind a policy`, `cancel a policy`, ...), and the sentence
  that `tools/list` returns the same list under `policy`.
- **The keys table shows prefixes only**: 7 rows, each `cmk_` plus **8 hex characters**
  (`cmk_7e21871d`, `cmk_824766ae`, ...). A scan of the whole rendered text for `cmk_[A-Za-z0-9]{12,}`
  returns **0 matches**. No secret, no sha256 of a secret, no bearer token.
- **As `approver@`: refused.** `/ops/mcp-keys` answers with the browser at `/ops` (server redirect),
  and the string `MCP keys` appears nowhere on the page it lands on.

### 3.7 Item 7: the New broker card, and eleven previous items

**The New broker card is exactly what the brief asked for when the route is missing.** It is a view
of the brokers screen (`?view=new`), reached from a primary action in the band
(`ops/brokers/page.tsx:88`), and it renders a `method="post"` form to `/api/brokers` with `name`,
`email` and `commissionRateBps`, a **`disabled`** submit button, and the sentence
`Route pending: POST /api/brokers is not on this branch yet, so the button is disabled. A created
broker signs in and submits their business verification from /broker/kyb; you check it here.`
There is no `app/api/brokers/route.ts` at `c408cb3` and none at `c408cb3^1`, so the form posts
nowhere and cannot: the disabled attribute, the view gate and the printed sentence agree with the
tree.

Eleven previous items re-measured on `c408cb3`:

| Item | Result on `c408cb3` |
|---|---|
| **F-UA-01** | `/broker`, `/ops/policies` and `/customer` agree: `$1,253.20` on both staff and broker lists, `$2,481.40` **absent from all three**, and all three carry `on the policy record`. F-LU-05 also closed on `/customer`. |
| **F-UA-02** | The approvals screen names both sub-threshold routes: the tile hint and a `title` read `Money out above the threshold needs a second person to approve it, never the person who asked. The database refuses a decision by the requester and by anybody who is not a staff approver.`, a second reads `A request an agent raised waits for a human approver whatever the amount.`, and About carries `It is cumulative`. Decision 15 is satisfied. |
| **F-UA-03** | Endorsement schedule at 1512 px: `scrollWidth - clientWidth` is **0 on every header**, `New annual premium` included. |
| **F-UA-04 / F-LU-02** | At 375 px every entry block is inside a scroller; 0 wide elements without one. |
| **F-UA-05** | `/ops/approvals` at 1512 px: `documentElement.scrollWidth = 1512`, six columns, none split. |
| **F-B13-30** | 375 px, real click: `scrollWidth` 375 before and after, on both screens. |
| **UI-011** | Breaks table 1197 px in a `1197/1197` scroller, nothing hidden. Column set changed, see F-UI2-03. |
| **UI-016 / UI-017** | The reconciliation section is first in the ops inbox at `y=210`, and its **35** rows each link to `/ops/reconciliation#break-stripe|pi_...`. |
| **UI-020** | The as-of form is on `?view=timeline`: at `?view=timeline&asOf=2026-10-08` the input holds `2026-10-08` and the panel reads `The policy on 2026-10-08 ... $2,400.00 ... $56.40 ... $2,481.40 ... $2,000,000.00 ... $4,000,000.00`; at `asOf=2026-09-08` it reads `$1,200.00 / $28.20 / $1,253.20`. See F-UI2-05 on the bare `?asOf=`. |
| **UI-022** | CGP-01061 prints four `$0.00` and still names `reversal_of_premium_written` and its siblings: nothing hidden, nothing deleted. |
| **UI-025** | `<meta http-equiv="refresh">` on `/ops/console`: **0**. |
| **UI-028** | CGP-01707's 360 mentions neither `CGP-01274` nor `CLM-00212`. |
| **UI-031** | `broker2@` sees `Business verification failed ... you cannot bind`; `broker3@` sees `What needs you 1 / Business verification not submitted: you cannot bind`. Neither says "Nothing is waiting". |

### 3.8 Item 8: regressions

- **52 route renders, 0 stack traces.** Nine markers searched in the HTML of every render
  (`Application error: a server-side exception`, `webpack-internal`, `at Object.`, `TypeError:`,
  `ReferenceError:`, `Unhandled Runtime Error`, `Call Stack`, `digest:`, `node_modules/`): **0 hits
  on 0 pages**. 49 renders answered 200 with an `h1`; `/no-such-page-for-the-review` and
  `/policies/not-a-uuid` answered **404**; `/ops/mcp-keys` as `approver@` redirected to `/ops`.
- **The inbox anchors are byte-identical to `lib/inbox/sections.ts`.** Rendered ids, per role:
  staff `reconciliation, approvals, policies, endorsements, claims, statements`; broker `policies,
  endorsement-deltas, correction-differences, change-requests, waiting-for-the-customer,
  statements`; customer `policies, corrections`. Each set equals, exactly and in both directions,
  the values of `INBOX_ANCHORS` whose `INBOX_ANCHOR_OWNER` is that role. No extra section, none
  missing, none belonging to another role.
- **The sidebar counts equal the inbox lists.** `ops@`: the sidebar Inbox entry reads `35 waiting
  for you, open the inbox` and the Reconciliation entry carries `35` linking to
  `/inbox#reconciliation`; the inbox's reconciliation section holds **35** rows and its filter chips
  read `All 35, Reconciliation 35, Approvals 0, Policies 0, Endorsements 0, Claims 0, Statements 0`.
  `broker@`: no count anywhere in the sidebar, and the inbox chips read `All 0` with every section
  at 0. The two agree in both directions.
- **No secret shape on any rendered page.** Six patterns over the visible text of all 52 renders
  (`sk_live_`/`sk_test_`, `whsec_`, `rk_`, `cmk_` with 20 or more characters, a Postgres URL with a
  password, a long `Bearer` token): **0 matches**.
- **The demo logins work.** Six identities signed in through the real form on
  `/api/session/login`: `ops@` and `approver@` land on `/ops`, `broker@`, `broker2@` and `broker3@`
  on `/broker`, and **`customer@` lands on `/customer`**.

---

## 4. Findings

No HIGH. No MEDIUM. Seven LOW, three of them disclosures of a state the code itself already
declares.

| Id | Severity | Trigger, consequence, location, correction |
|---|---|---|
| **F-UI2-01** | LOW (the interface); the underlying gap is F-BP-01 | **The probe half of decision 28 is a heading with nothing under it on the deployed data.** Every reconciliation run on production reports `Probe 0`, the `Probes` tile reads `0`, and `Probe payments from check runs` says `No probe payment is being reported`, while the list to act on holds 35 provider-only breaks of which many are the `$42.42` payments `scripts/check-reconciliation.ts` plants on every run. The backend confirmation predicted 32 of them would move to the probe classification once migration 0025 ran; on the board they have not. **Consequence:** the README sentence F-BP-03 was raised against is now true of the markup and still not true of the data: a reader opening the board sees 35 "breaks to act on" that are mostly the check script's own probes. The interface is not wrong here, it is honest about what the classifier gives it. **Correction:** not in this cycle. Close F-BP-01 (recognise the existing PaymentIntents as probes, or re-plant them with the probe metadata) and re-read the board; until then keep the README sentence qualified. **Location:** `app/ops/reconciliation/page.tsx:139` reads `probesPage`, the classification is upstream in `lib/reconciliation`. |
| **F-UI2-02** | LOW | **The explained-breaks table prints no amount, and the row's reference does not lead to one.** Columns are `Reference, Classification, What an operator says it is, Explained by, Explained`; the list to act on above it does carry `Provider` and `Ledger` amounts. Clicking the explained row's reference opens the drawer through `resolveReference`, which finds the webhook events for that PaymentIntent and prints those instead of the row's own facts, so `$42.42` appears nowhere on the path from the explained row. **Consequence:** an operator reviewing what was explained cannot see how much money it was without leaving the screen. **Correction:** give `ExplainedTable` the provider amount column the break row already holds (`app/ops/reconciliation/page.tsx:1041` area), or let `rowOfReference` take precedence over `resolveReference` for a reference that is a row of one of the three lists (`page.tsx:196`). |
| **F-UI2-03** | LOW, disclosure | **The breaks table dropped three of the nine columns the desktop audit measured under UI-011.** `Difference`, `First seen` and `What it means` are gone; `Open for` replaces `First seen` and the classification word replaces the sentence. This is decision 2 and decision 9 working as intended (the meanings are in the legend and in the drawer's `What the run says`), but the figure a reader acts on, provider minus ledger, is no longer on the row. **Correction:** none required; recorded so the UI-011 measurement is not re-run against a column set that deliberately no longer exists. |
| **F-UI2-04** | LOW | **The verbatim AF-02 sandbox sentence on `/` and `/login` is behind a closed fold.** `components/signed-out-frame.tsx:32` puts `Sandbox providers and test data. No real money.` inside `<details class="environment-badge">` whose summary is the single word `Sandbox`, so it is in the markup and not in the rendered text of either page. The same shape is on the signed-in shell (`components/portal-frame.tsx:85`), where it does not matter because the mode line beside it is plain visible text. **Not an AF-02 violation:** both signed-out pages carry, in the body and in the open, `Work-trial build on sandbox providers and test data. No real money moves here.` **Not a cycle-2 change:** `signed-out-frame.tsx` is not in this diff. **Correction:** either print the sentence beside the summary rather than inside the fold, or record in the handoff that the pinned sentence is one click away, so a later reviewer measuring "verbatim on `/` and `/login`" does not read it as a regression, as I first did. |
| **F-UI2-05** | LOW | **`?asOf=<date>` alone is silently ignored on the policy page.** `PolicyAsOf` renders only under `view === "timeline"` (`app/policies/[policyId]/page.tsx:1210`), so `/policies/<id>?asOf=2026-10-08` shows the overview with `in force on 2026-09-09` and no as-of panel, while `/policies/<id>?view=timeline&asOf=2026-10-08` answers correctly. Decision 33 promises "every existing link keeps working", and `?asOf=` links written before the rework (b13-13's UI-020 measurement is one) no longer show what they showed. **Pre-existing:** the same condition is at `c408cb3^1:1147`, so this cycle did not cause it. **Correction:** when `asOf` is present and `view` is not, resolve the view to `timeline`, one line beside `pickView`. |
| **F-UI2-06** | LOW, disclosure | **`POST /api/brokers` does not exist.** `app/ops/brokers/page.tsx:121` posts to a path with no route handler at `c408cb3` or `c408cb3^1`. It is the only action/handler mismatch in the whole tree. The button is `disabled`, the card renders only at `?view=new`, and the page prints `Route pending`. **Correction:** land the route (the coordinator owns it, cycle-2 decision 21) and remove the `disabled` and the sentence in the same commit, so the two never disagree. |
| **F-UI2-07** | LOW, disclosure and a measurement caveat | **The explanation's count-up paints money figures the ledger does not hold.** Sampled 700 ms after opening the drawer on CGP-01707, the sum row read `Collected at Stripe, all debits added | 125320 + 112724 | $2,212.95`; at 1200 ms and at 3000 ms it reads `$2,380.44` and stays there. This is the documented exception in `components/amount-explained-motion.tsx` (the browser multiplies the server's digits by a fraction of the animation) and it is pinned by `lib/money/amount-explained-motion.test.ts`, so it is designed, tested and disclosed, not a defect. **Consequence for reviewers, which is why it is written down:** any screenshot of that drawer taken inside the first ~1.2 s shows a figure that is not the one the ledger holds. **Correction:** none to the code; a note in the handoff that evidence of the drawer must be captured after the count settles. |

**No finding in this scope engages AF-01, AF-03, AF-04 or AF-05.** AF-06 is the walkthrough, open
by definition.

### Automatic-fail mapping for this scope

| Rule | Applicability here | Result |
|---|---|---|
| AF-01 | reviewed on the deployed URL, not localhost; revision confirmed before and after | **PASS for this scope**: `/api/health` reported `c408cb3` at 18:05:44Z and 18:28:11Z, and all 52 renders came from that host |
| AF-02 | do the cycle-2 screens claim a simulation is live | **PASS**: the exact mode line on 42 of 42 signed-in renders and at 19 viewport widths; `LOCAL SIMULATOR` on 3 of 3 claim payment rows and 6 of 6 Claim rail run rows; `LIVE SANDBOX` on 35 of 35 Stripe break rows; both signed-out pages carry a visible sandbox sentence. F-UI2-04 is about which wording is in the open, not about a mode being misstated |
| AF-03 | is any money row written or rewritten | **NOT ENGAGED**: no POST was sent except the six logins, no form was submitted, and the diff touches no file under `lib/`, `db/`, `app/api` or `scripts/` |
| AF-04 | sandbox only, seeded identities | **PASS**: only `example.com` identities, only `cs_test_` / `pi_` / `re_` / `sim_tr_` test references, no live-mode marker seen, $0 spent |
| AF-05 | no secret in this record or its evidence | **PASS**: `DEMO_PASSWORD` loaded with `process.loadEnvFile` and never echoed, never written, never on a command line. The 24 PNGs were each opened and looked at. `mcp-keys.png` shows the eight-character **public prefixes** the application itself prints for every operator (`cmk_7e21871d`), never a key: a scan for `cmk_` followed by 12 or more characters over the whole rendered page returns 0. No `.env` file is read into any artefact here |
| AF-06 | can these files be defended line by line | section 8; walkthrough **NOT REVIEWED WITH YOANN** |

---

## 5. What this cycle closes, in the register's terms

- **F-BP-02 (MEDIUM) closes.** The explained break is on the deployed board under `Explained
  breaks`, with the note, `Sam Patel, operations` and `2026-09-09 16:39:11`. Evidence
  `recon-explained.png`.
- **F-BP-03 (LOW) closes on its own text.** All three headings the README names now exist on the
  deployed board. The part of the same README sentence that is about classification, not headings,
  is F-UI2-01 and stays with F-BP-01.
- **F-LU-04 closes.** The customer's own `/policies/<CGP-01707>` now carries the mode line
  (the top bar carries it on every signed-in screen, the customer's included).
- **F-LU-05 closes.** `/customer` prints `on the policy record` beside the voided policy, as the
  broker and staff lists do.
- **F-UA-01 to F-UA-05 and F-B13-30 all still hold**, re-measured in section 3.7.

---

## 6. Readability (READABLE-CODE.md) on the changed files

The reading path of the board is short and honest. `app/ops/reconciliation/page.tsx` opens with the
four constants that bound each read (`HOW_MANY_BREAKS_ON_ONE_PAGE = 50`, `HOW_MANY_PROBES_SHOWN`,
`HOW_MANY_EXPLAINED_SHOWN`, `EVERY_BREAK_THE_PAGE_WILL_DRAW = 1000`), then the two dictionaries that
own the AF-02 words (`SOURCE_MODE`) and the classification sentences, then one `Promise.all` of
seven named `attempt(...)` reads. A reader can predict what the page does from those forty lines.

Three comments in that file say the non-obvious thing rather than narrating: the one above
`countOpenBreaksBySource` explains why the tile does not count the rows drawn ("a tile that counted
the rows drawn understates a source the moment the page is capped"), the one above `canExplain`
says that hiding the form is not the control, and the one above the two lists says they are disjoint
by construction in SQL. All three are claims I could check, and all three are true.

`describeRunResult` (`:1075`) is five lines of pure string building with its rule written above it,
and it is the kind of function a candidate can defend on sight. Same for
`lib/inbox/sections.ts`, whose two exported maps are the whole contract the sidebar and the inbox
share, with the reason the second map exists written between them.

The one place where the reading path is longer than the behaviour deserves is the explanation
drawer: `components/amount-explained-motion.tsx` is a 400-line client component whose first 35
lines are a correct and necessary essay about why the browser is allowed to do arithmetic there.
That essay is the right response to F-B12-13, and the file is still the largest single thing in this
cycle a reviewer could point at. It is not new to this cycle.

No opaque indirection, no generated component, no metaprogramming, no financial formula without a
worked example beside it. Every money figure on every screen I opened is a string the server
rendered.

---

## 7. Checks actually executed, with counts

| Check | Command or method | Result |
|---|---|---|
| Deployed revision, before and after | `curl /api/health` | `c408cb3...` at 18:05:44Z and at 18:28:11Z, `database: ok` |
| Route renders as their roles | playwright-core, GET only, 7 identities | **52 renders**: 49 x 200 with an `h1`, 2 x 404, 1 x redirect (approver to `/ops`) |
| Sign-in | the real form on `/api/session/login`, 6 identities | 6 of 6 succeed; landing pages `/ops`, `/ops`, `/broker`, `/broker`, `/broker`, `/customer` |
| Rendered POST form contracts | DOM extraction of action, method, every name, every hidden value | **94 instances, 49 distinct contracts**, joined to 35 handlers; 1 mismatch (F-UI2-06) |
| Static form join, both revisions | delegate, Python over raw source | 53 forms at `c408cb3` (39 POST), 52 at `c408cb3^1` (37 POST); 0 forms became a link or a script |
| The breaks board | 5 views x 2 roles | 3 lists, 35 explain forms as ops, **0 as approver**, explained row present with note, author and time |
| Tile independence from drawn rows | `?class=stale` and `?class=local_only` | table 0 rows, `0 of 35`, tile still **35** |
| AF-02 mode line | 42 signed-in renders + a 15-width sweep + 4 more widths | present on **42 of 42**, visible at 375, 420, 500, 560, 580, 600, 620, 640, 660, 700, 740, 760, 780, 800, 900, 1024, 1280, 1440, 1920 |
| Simulated rows | claim payments, console, reconciliation runs and breaks | 3 of 3, 6 of 6, 35 of 35 |
| 375 px overflow | 8 screens, every `<details>` opened | `scrollWidth == innerWidth == 375` on 8 of 8; **0** wide elements without a scroller out of 2,932 examined |
| F-B13-30 | real click on the figure at 375 px | 375 before, 375 after, on 2 screens |
| 1024 and 1440 | 5 states each | `scrollWidth == innerWidth` on 10 of 10; sidebar, top bar, main and drawer boxes non-overlapping |
| The 24 figures | text search over 17 rendered views | **24 of 24 found, 0 missing** |
| The explanation drawer | open, read at 300 / 1200 / 3000 ms, close 3 ways | formula in cents, rounding rule and proving entries present; Escape and click outside both close it |
| MCP page | as ops with folds open, then as approver | endpoint, header, snippet, **7** tools equal to `MCP_TOOLS`, never-delegated list, 7 key rows with prefixes only, **0** long key shapes; approver redirected |
| New broker card | `?view=new` | form present, button `disabled`, `Route pending` sentence, no handler at `/api/brokers` |
| Inbox anchors | rendered ids against `INBOX_ANCHORS` per role | staff 6 of 6, broker 6 of 6, customer 2 of 2, both directions |
| Sidebar counts | ops and broker | 35 = 35 and 0 = 0 |
| Stack traces | 9 markers over 52 renders | **0** |
| Secret shapes | 6 patterns over 52 renders | **0** |
| Evidence review | each of the 24 PNGs opened | no secret, no personal data beyond the seeded `example.com` identities |

---

## 8. Checks not executed, and why

- **`npm run typecheck`, `npm test`, `npm run build` and the `check:*` scripts: NOT RUN.**
  `node_modules` is not installed in this worktree, and the guard scripts contend for the shared
  `corgi_test` database that other agents are using. The indirect evidence for the build is that
  Vercel compiled and deployed `c408cb3` and `/api/health` reports it; that is not a substitute for
  the test suite, and I do not treat it as one. The interface session's own figures on `3f4fac8`
  (495 pass) predate this merge.
- **No POST was sent except the six logins.** Therefore: no toast was seen after a real
  submission, the `SubmitButton` working state was not observed on a real post, and the approve /
  reject / send / refund / pay / KYB-submit forms were verified by their rendered contract and by
  the handler they name, not by exercising them.
- **The cap sentences could not be triggered.** 35 breaks against a cap of 50, 0 probes, 1
  explained: `openPage.capped`, `probes.capped` and `explained.capped` are all false on production.
  Verified by reading `page.tsx:406`, `:428` and `:444` only.
- **The `N probes, M breaks to act on` run sentence could not be observed with a probe count above
  zero**, for the same reason (F-UI2-01). The code path was read; the string was not seen.
- **A simulated reconciliation break row does not exist today**, so `LOCAL SIMULATOR` on a Claim
  rail break row is verified by `SOURCE_MODE` and by the run rows, not by a break row.
- **No policy is awaiting payment and no approval is waiting**, so the checkout, bind, endorsement
  apply/checkout, refund send/reissue and approvals decide forms were not rendered on production.
  Their contracts come from the source and from the handler they post to.
- **Firefox and Safari were not tested.** One engine, Chromium 1234 headless shell.
- **`inspect_reference`, the eighth MCP tool of decision 42, is not on this revision.** I checked
  that the page shows seven and that seven is what `MCP_TOOLS` holds; I did not review a tool that
  does not exist yet.
- **No legal or regulatory conclusion is drawn.** This is an engineering review of a presentation
  layer on a sandbox deployment.

---

## 9. Verdict

**PASS at `c408cb30ca79ae9b6a9efc9a2e553d3956f2fdb4`.**

The cycle does what it said it would. Every POST form on the deployed application keeps its action,
its method, its field names and its hidden inputs, and the one form that points at nothing is
disabled and says so on the screen. The breaks board port is real: the explained break is visible
under its own heading with its note, its author and its time, the count to act on drops by exactly
that one against the run that produced it, the per-source tiles are counted over the open set and
not over the rows drawn (proved by making the rows disappear while the tile held), and the explain
control exists for `staff_ops` and for nobody else. The AF-02 mode line is on all 42 signed-in
renders at every width from 375 px to 1920 px, and every simulated row still names its simulator.
Nothing scrolls sideways at 375 px, nothing overlaps at 1024 or 1440, and every table wider than
the viewport is inside a scroller. The 24 money figures print what they printed. The MCP page reads
its tool list from the code and shows key prefixes only.

The seven findings are all LOW and none blocks the merge: one is a backend classification gap the
interface is being honest about, three are disclosures of states the code itself declares, and
three are small corrections in the interface's own files.

**Residual limitations, stated plainly.**

1. This verdict covers `c408cb3` and the production data as it stood between 18:05Z and 18:28Z.
   A later commit, or a reconciliation run that changes the counts, is outside this record.
2. A PASS here is not evidence that the repository's tests pass. They were not run (section 8).
3. No POST was exercised. Half of the form contract is proved by rendering and by reading the
   handler, not by submitting.
4. I checked that the code can be read, not that Yoann can explain it.

**Walkthrough status: NOT REVIEWED WITH YOANN.**

---

## 10. Register lines for `docs/reviews/FINDINGS.md`

The coordinator owns that file. These are the lines to append:

| ID | Sev | Finding (one line) | Fix | Status |
|---|---|---|---|---|
| F-UI2-01 | LOW | The probe half of decision 28 has a heading and no data: every production run reports `Probe 0`, the Probes tile reads 0 and the probe table is empty, while the 35 breaks to act on are mostly the `$42.42` payments the check script plants; the interface is honest, the classifier has not moved them | Close F-BP-01 (recognise or re-plant the existing PaymentIntents) and re-read the board; keep the README sentence qualified until then | OPEN, owned by F-BP-01 |
| F-UI2-02 | LOW | The explained-breaks table has no amount column, and the explained row's reference resolves through `resolveReference` to the webhook trail rather than to the row's own facts, so `$42.42` is on no path from that row | Add the provider amount column to `ExplainedTable`, or let `rowOfReference` win over `resolveReference` for a reference that is a row of one of the three lists (`app/ops/reconciliation/page.tsx:196`) | OPEN |
| F-UI2-03 | LOW | The breaks table dropped `Difference`, `First seen` and `What it means`, three of the nine columns UI-011 measured; `Open for` replaces `First seen`, the legend and the drawer carry the meanings, but provider minus ledger is no longer on the row | DISCLOSED, deliberate under decisions 2 and 9; recorded so UI-011 is not re-run against a column set that no longer exists | DISCLOSED |
| F-UI2-04 | LOW | The verbatim `Sandbox providers and test data. No real money.` on `/` and `/login` is the body of a closed `<details>` whose summary is the word `Sandbox`, so it is in the markup and not in the rendered text; both pages do carry a visible sandbox sentence, and `components/signed-out-frame.tsx` is not in this diff | Print it beside the summary, or record in the handoff that the pinned sentence is one click away | OPEN (pre-existing) |
| F-UI2-05 | LOW | `/policies/<id>?asOf=<date>` with no `view` is silently ignored: `PolicyAsOf` renders only under `view === "timeline"` (`page.tsx:1210`), so links written before the rework no longer show the as-of panel, against decision 33 | Resolve the view to `timeline` when `asOf` is present and `view` is not, one line beside `pickView` | OPEN (pre-existing at `c408cb3^1`) |
| F-UI2-06 | LOW | `app/ops/brokers/page.tsx:121` posts to `/api/brokers`, which has no route handler at `c408cb3` or `c408cb3^1`; the only action/handler mismatch in the tree, with the button `disabled` and `Route pending` printed on the card | Land the route (decision 21, coordinator) and remove the `disabled` and the sentence in the same commit | DISCLOSED |
| F-UI2-07 | LOW | The explanation's count-up paints intermediate money figures: 700 ms after opening, CGP-01707's sum row read `$2,212.95` where the settled figure is `$2,380.44`; designed, tested and disclosed (F-B12-13), but any screenshot taken inside ~1.2 s shows a figure the ledger does not hold | Note in the handoff that drawer evidence must be captured after the count settles | DISCLOSED |
| F-BP-02 | MED | CLOSED at `c408cb3`: the explained break is visible under `Explained breaks` with its note, `Sam Patel, operations` and `2026-09-09 16:39:11`; the count to act on is 35 against the run's 36 | verified by this review, evidence `docs/evidence/ui-cycle-2/recon-explained.png` | CLOSED |
| F-BP-03 | LOW | CLOSED on its own text at `c408cb3`: all three README headings exist on the deployed board. The classification half of the same sentence is F-UI2-01 | verified by this review | CLOSED, with F-UI2-01 |
| F-LU-04 | LOW | CLOSED at `c408cb3`: the top bar carries the mode line on every signed-in screen, the customer's own policy page included | verified by this review | CLOSED |
| F-LU-05 | LOW | CLOSED at `c408cb3`: `/customer` prints `on the policy record` beside the voided policy, as the broker and staff lists do | verified by this review | CLOSED |

---

## 11. Evidence

24 PNGs under `docs/evidence/ui-cycle-2/`, 3.3 MB, each opened and reviewed before being committed:

`recon-ops-board`, `recon-explained` (the F-BP-02 evidence), `recon-approver` (no explain control),
`recon-runs`, `mcp-keys`, `new-broker`, `inbox-ops`, `inbox-broker`, `explain-drawer`,
`reference-drawer`, `claim-payments`, `approvals`, `endorse-preview`, `anon-landing`, `anon-login`,
`375-policy`, `375-reconciliation`, `375-console`, `375-console-ledger`, `375-inbox`,
`375-statements`, `375-explain-policy`, `1440-console-submenu`, `1024-console-submenu`.

The six `375-*` shots and `375-explain-policy` were taken with every `<details>` on the page opened,
because that is the state the overflow measurement was made in; the folds are open in them by
design, not by accident.
