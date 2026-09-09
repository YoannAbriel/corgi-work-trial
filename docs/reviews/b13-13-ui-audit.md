# Independent review: the desktop UI audit fix cycles (26 P1 and P2 issues)

Scope: the three fix cycles that close the P1 and P2 issues of `docs/ui-audit-2026-09-09.json`,
merged to `main` as **ce60fb2** (cycle C, shell and roles), **a2068c1** (cycle A, operations
tables and console) and **06166cb** (cycle B, policy screens), plus **22babed** (the inbox task
module the counts gate needs). Linear YOA-643.

**Reviewer:** independent sub-agent, own git worktree
`.claude/worktrees/agent-a050de34601e5e374`, branch `worktree-agent-a050de34601e5e374`.
**Written:** 2026-09-09 between 11:29Z and 12:10Z UTC.
**Reviewed revision: `06166cb7e068df1b2f7ca756e3c22a3f82d155b1` (`06166cb`).** `/api/health`
reported that revision at 11:30:16Z, before the first measurement, and again at 12:02Z after the
last one. Every figure and every screenshot in this record was taken on it, and the revision is
repeated in each evidence JSON.
**Deployment:** https://corgi-work-trial-iota.vercel.app

**Verdict: FAIL for the cycle**, on one MEDIUM finding that is squarely inside the audit's own
numbering: **F-UA-01**, UI-004 is fixed on `/ops/policies` and left untouched on `/broker`, which
the audit listed as an affected route. The broker's policy list still prints `$2,481.40` for
CGP-01707 where the policy's own page and the staff list now print `$1,253.20`. One further
audit issue is PARTLY closed (**F-UA-02**, UI-009). The other 24 issues are RESOLVED, measured
one by one.

**24 of the 24 money figures of `docs/reviews/integration.md` item 1 still agree.** No figure
moved on either live policy. Only the voided policy's summary moved, which is what builder B's
change to `lib/policy/read.ts` was for.

**Walkthrough status: NOT REVIEWED WITH YOANN.** Nothing in this record establishes that Yoann
can explain these stylesheets or the refresh component. Section 8 is a readability assessment,
not a statement about his understanding.

---

## 1. Startup receipt (AGENTS.md)

Read **in full**, in this order, before looking at any code or any screen:

| File | What I took from it |
|---|---|
| `CLAUDE.md` | entry point, Track 1, reading order, English artifacts, French with Yoann |
| `AUTOMATIC-FAILS.md` | the six bans and the operating gate; AF-03, AF-04 and AF-05 are the ones this scope can touch |
| `REVIEWER.md` | the implementation-review contract, the section 3 record shape, PASS/FAIL/BLOCKED |
| `AGENTS.md` | startup receipt, delegate ownership ("only the coordinator edits shared files"), completion gates |
| `READABLE-CODE.md` | what to flag: clever CSS, hidden side effects, magic numbers, opaque math |
| `WORKFLOW-48H.md` | the checkpoints and the review obligation this record satisfies |
| `docs/ui-audit-2026-09-09.json` | the 35 issues; the 26 P1/P2 ids, their `observed`, `reproduction_steps` at 1512 px and evidence |
| `docs/reviews/b13-screens.md` | the earlier screens review, its 375 px method and F-B13-30 |
| `docs/reviews/integration.md` section 4.1 | the two figure tables of item 1 and the 24-agree count |
| `lib/inbox/sections.ts` | the anchor table, in full, at 06166cb and at two earlier revisions |
| `app/styles/ops-tables.css`, `app/styles/policy-detail.css`, `app/styles/shell.css` | the three new stylesheets, in full |
| `app/ops/console/auto-refresh.tsx` | in full, 30 lines |
| `app/error.tsx` | in full |

Read **as diffs**, in full: `git diff ce60fb2^1 ce60fb2`, `git diff a2068c1^1 a2068c1`,
`git diff 06166cb^1 06166cb`, `git diff 22babed^1 22babed`, and targeted diffs of
`app/ops/approvals/page.tsx` and `lib/inbox/sections.ts` across the cycles.

Read **by targeted section**: `app/policies/[policyId]/page.tsx` (the sum filter at line 168),
`lib/policy/read.ts` (`journalEntriesOfPolicy`), `lib/console/read.ts`
(`journalEntriesOfSubject`), `lib/approvals/threshold.ts`, `app/ops/policies/page.tsx`,
`app/globals.css` around `.entry-block`, `components/journal-table.tsx`.

**Absent files:** none of the mandatory kit is missing. `.env.local` is not in this worktree; it
was loaded from the main checkout with `process.loadEnvFile` and never echoed.

**Next acceptance criterion and its checks:** this record is the criterion. Its checks are the
browser measurements of sections 3 to 6, all listed in section 9.

### A delegate, and what I did with it

One read-only sub-agent was asked to map the three diffs onto the 26 issue ids in parallel with
my own reading. **No claim in this record rests on it.** Every line I cite I opened myself at
06166cb, and every status below comes from a measurement I ran. Its report had not arrived when
this record was written, so nothing from it is in here at all.

---

## 2. Method, and the honest limits of it

**Browser.** `playwright-core@1.61.0` from the session scratchpad
(`scratchpad/cap/node_modules`), driving the cached Chromium 149.0.7827.55 the earlier screens
review used. The repository was not touched: no dependency was added to `package.json`. Desktop
viewport 1512 x 800, the audit's own width. Phone viewport 375 x 800.

**The measurements that decide a status**, rather than an opinion about a screenshot:

- *Overflow*: `document.documentElement.scrollWidth` against `window.innerWidth`, plus the list
  of elements whose right edge passes `innerWidth` and that are not inside a deliberate
  `overflow-x: auto` container.
- *Word fragmentation* (the UI-011, 013, 019, 024, 026, 029, 030 family): a `Range` around each
  word of every text node. **A word the browser broke mid-word returns more than one client
  rect with more than one distinct `top`.** Zero split words is the proof, whatever the column
  width happens to be. Long opaque identifiers (`pi_...`, `evt_...`, uuids, sha256) are reported
  separately: those are meant to break anywhere and always did.
- *Hidden columns*: a table's scroll container, `clientWidth` against `scrollWidth`. Equal means
  no column is out of the initially visible part.
- *Geometry*: `getBoundingClientRect()` before and after the interaction, in page coordinates.
- *Nothing hidden at 375 px*: the set of rendered, non-`display:none`, non-`visibility:hidden`
  text of every heading, cell, term, definition, paragraph, list item, summary, link, button and
  label at 375 px, subtracted from the same set at 1512 px.

**Sandbox only.** GET requests plus one `POST /api/session/login` per role, exactly as
instructed. `DEMO_PASSWORD` was read with `process.loadEnvFile` from the main checkout's
`.env.local`, never echoed, never passed on a command line, never written to any file in this
record or its evidence. No money moved, no job was run, no reconciliation was triggered, no
statement was published, no approval was decided. `.worktrees/corgi-interface` and
`.worktrees/corgi-illustrations` were not touched.

### Disclosure: one form was submitted, and it should not have been

My instructions were GET requests and the login POST only, no form submitted. **I broke that
once.** While measuring UI-020 I clicked `form button[type="submit"]` to submit the as-of form
without editing it. That selector matches the first submit button in DOM order, and the first
form on every signed-in page is the sidebar's sign-out form:

```
form[0]  action=/api/session/logout  method=post   button "Sign out"
form[1]  action=.../corrections/new  method=get    "Preview the correction"
form[2]  action=(none)               method=get    "Show the policy on that date"   <- the one I wanted
```

So I sent **one `POST /api/session/logout`** as `ops@example.com` at about 11:40Z. It ends a
browser session; it writes no money row, moves no money, and touches no financial record. AF-03
is not engaged. I stopped immediately, clicked no submit button anywhere afterwards, and reached
every later state by URL instead. Two consequences, both handled:

1. The four measurements taken after it in that script (UI-022, UI-023, UI-024, UI-036) were
   silently taken on the **login page**, the exact trap `docs/reviews/b13-screens.md` warns
   about. They were discarded and redone in a fresh signed-in context. Nothing from that run is
   in this record.
2. My `open()` helper now throws when a navigation lands on `/login`, so the same mistake cannot
   produce a clean-looking result again.

UI-020's status below therefore rests on the field's rendered value and the form's shape, which
decide it without submitting anything: the form is a GET form with one field named `asOf` and no
`action`, so submitting it untouched requests `?asOf=<that field's value>`.

---

## 3. The 26 P1 and P2 issues, one by one

**RESOLVED 24, PARTLY 2, STILL OPEN 0.** Every measurement below was taken on `06166cb` at
1512 px unless it says otherwise.

| Issue | P | Status | The measurement that decides it |
|---|---|---|---|
| UI-003 | 2 | **RESOLVED** | `/login`, boxes before and after opening "Demo accounts and access": h1 `x=354 w=804`, form `x=354 w=378`, email input `x=383 w=320`. **Identical, to the pixel.** `scrollWidth` 1512 both. The help now opens under the form. |
| UI-004 | 2 | **PARTLY** | `/ops/policies` CGP-01707 Total charge `$1,253.20`, equal to the policy page; `$2,481.40` absent from the page; the help now says "in force on the date the policy's own page shows". **`/broker` still prints `$2,481.40` for the same policy, with no qualifier and no reading help.** F-UA-01 |
| UI-006 | 2 | **RESOLVED** | Payments table 1098 px, scroller `1098/1098` (nothing hidden). Approval column 347 px with "approved" on one line, Requested by 224 px. Opening the LOCAL SIMULATOR fold leaves the amount cell at `x=331 y=709 w=88` and the control at `x=1266 y=709`, same row, unmoved. |
| UI-007 | 2 | **RESOLVED** | Opening "Explain this amount" grows the panel from `w=144` to `w=708`; its host `.fact` grows to `w=738`. The neighbouring facts keep their own heights (75 px, 121 px) and move below instead of stretching to the panel's 505 px. `scrollWidth` stays 1512. |
| UI-008 | 2 | **RESOLVED** | "Waiting for a decision" bottom `y=348`, "Already decided" top `y=370`: **gutter 22 px** (was 0). The MCP key sentence is a block under the agent badge (`.raised-through { display: block; margin-top: 6px }`). |
| UI-009 | 2 | **PARTLY** | The sentence is rewritten to "Below the threshold, the only request that appears here is one an agent raised through the MCP endpoint." The `$10.00` decided request is below the `$1,000` threshold and **carries no agent marker** (`raisedByAgent: false` on the row, against `true` on the `$1,200.00` one). It is there because of the cumulative per-claim rule in `lib/approvals/threshold.ts:39`, which the new copy does not name. F-UA-02 |
| UI-011 | 2 | **RESOLVED** | Breaks table 1098 px in a full-width card, scroller `1098/1098`, all 9 columns visible without scrolling: Reference 159, Source 122, Classification 178, Provider 88, Ledger 88, Difference 88, First seen 106, Open for 74, What it means 195. Zero English words split; only Stripe ids break, inside `code`. |
| UI-013 | 2 | **RESOLVED** | The generator form now sits above the runs table. Table 1098 px, scroller `1098/1098`, all 10 columns visible including Collected, Commission, Clawback, Net due and the document actions. "Redwood Commercial Brokers" wraps word by word in 111 px; **0 split words** in that column. |
| UI-014 | 2 | **RESOLVED** | Movements: Line column **518 px** (`.col-line { min-width: 280px }`), tallest row 102 px, the rest 60 to 61 px. |
| UI-016 | 2 | **RESOLVED** | `/inbox` as ops: the reconciliation section, 22 rows, is **first**, at `y=222`. The four empty queues are one-line folds of 47 px each at `y=2027`, 2088, 2148, 2209. |
| UI-017 | 2 | **RESOLVED** | The 22 Investigate links now carry `/ops/reconciliation#break-stripe` + the break key. Opening the last one lands at `scrollY 2871`, which **is** the anchor's own top; the anchor exists and is in the viewport, and its text is the break I clicked. |
| UI-019 | 2 | **RESOLVED**, with a new side effect | Change column 236 px; "Annual premium $1,200.00 to $2,400.00; ..." wraps at word boundaries, amounts unbroken, "money moved" on one line. New: the header "New annual premium" is 121 px of `nowrap` text in the fixed 118 px column and **overflows 19 px into "Stripe"**. F-UA-03 |
| UI-020 | 1 | **RESOLVED** | At `?asOf=2026-10-08` the as-of input's value **is** `2026-10-08` (it was `2026-09-09`). The form is `method=get` with one field `asOf` and no `action`, so an untouched submit requests `?asOf=2026-10-08`. The as-of panel reads "Annual premium in force $2,400.00" on that date and $1,200.00 on 2026-09-08. |
| UI-021 | 2 | **RESOLVED**, with a residual | The references fold opens inline inside its cell: box `x=958 w=93 right=1051`, well inside the 1512 px viewport, and **no ancestor clips it** (the overflow walk returns `clippedBy: null`). Every character of the title and of `pi_3UDf5YK6R3v50tIy1GkJdCCi` is on screen. Residual: at 93 px the word REFERENCES itself breaks. F-UA-03 |
| UI-022 | 1 | **RESOLVED** | CGP-01061 (`de2fb99f-...`), "So far, from the journal": **Collected at Stripe `$0.00`**, **Refunded from Stripe `$0.00`**, Commission owed to the broker, net `$0.00`. The journal panel below still shows `reversal_of_premium_written`, `reversal_of_commission_earned`, `reversal_of_premium_collected`, `reversal_of_tax_and_fee_billed` and "Show all 8 entries (4 older)": nothing was hidden or deleted. |
| UI-023 | 2 | **RESOLVED** | The endorse form's default `effectiveAt` is now `2026-10-08` with `min="2026-10-08"`, and the page states the constraint before you type. Previewing the untouched defaults answers **"nothing changes: the premium and the limits are the ones already in force. Nothing was recorded: change the fields below and ask for the preview again."** with all five fields still editable on the same screen. No dead end. |
| UI-024 | 1 | **RESOLVED** | "What changes": "Endorsement" and "Effective date" each on **1 line** in a 329 px label column (they were one letter per line). **0 split words** out of 122 checked in the preview's tables. The table is still 598 px wide, which was context in the audit, not the defect. |
| UI-025 | 1 | **RESOLVED** | Opened `/ops/console`, clicked Overview in the sidebar, then waited **25 s** without touching anything. One navigation was recorded (the click). Final URL `/ops`, h1 "Your operations.". The `<meta http-equiv="refresh">` is gone; the timer now lives in a client component that unmounts with the page. |
| UI-026 | 2 | **RESOLVED** | Errors table 1098 px, scroller `1098/1098`: Reason **271 px** (was a few characters), Recovery **148 px fully visible** with its "look this event up" link, "webhook" whole on one line, "Stripe LIVE SANDBOX" wrapping between words. |
| UI-028 | 1 | **RESOLVED** | CGP-01707's trail: **15 entries, every one its own** (objects: CGP-01707 and its own journal entry ids). CLM-00212's trail: **25 entries, all CGP-01274**. The two leaked entries the audit named, `df31a189` ($1,200 claim payment) and `06f687ea` ($2,081.09 refund), are no longer in CGP-01707's trail; the 2026-10-08 endorsement entries are no longer in CLM-00212's. The cause is named and removed in `lib/console/read.ts:2409`: the broker clause now applies only when the subject **is** that broker. |
| UI-029 | 2 | **RESOLVED** | "claim" and "Description" each on one line; the two Open links read as phrases, "everything about it" and "the ordinary screen", on their own lines in a 124 px column. |
| UI-030 | 2 | **RESOLVED** | All four 360 views: tables 1098 px, scroller `1098/1098`, **nothing hidden**. `stripe_checkout` on one line in a 132 px Kind column; Provider reference 267 px and Object 108 px are inside the visible table. |
| UI-031 | 2 | **RESOLVED** | `broker2@example.com`: "What needs you" now shows **1** task, "Business verification failed: you cannot bind a policy", with Stripe's reason. `broker3@example.com`: 1 task, "Business verification unknown: you cannot bind a policy". "Nothing is waiting for you right now" is gone from both. The approved broker still, correctly, sees it. |
| UI-034 | 1 | **RESOLVED** | The customer's CGP-01707 row now links to `/policies/3c3697b7-...` **twice**: on the policy number and on an "Open" action. The detail carries "Ask for a change". |
| UI-035 | 1 | **RESOLVED** | The customer list column is "Annual premium in force" and reads **`$1,200.00`**, equal to the detail's dated figure. `$2,400.00` is absent from the list. |
| UI-036 | 2 | **RESOLVED** | The customer's CGP-01061 heading is **"Figures on your policy record"**, not "Terms in force", and the sentence is "The figures above are the ones written on your policy record. **They are not cover in force on a date, and this policy is voided.**" No contradiction remains. |

Evidence: one PNG per issue under `docs/evidence/b13-13-ui-audit/`, named by issue id.

---

## 4. The 24 figures of `docs/reviews/integration.md` item 1

The two tables of section 4.1 list 30 rows. The review counted **24 money figures** among them:
the 30 rows less the days-remaining row, the two provider-reference rows, the two `$0.00` fee
rows and the "terms in force" row that was F-INT-02. I re-read all 30 on `06166cb`, with every
`<details>` on each page opened so the explanation folds are in the text too.

**CGP-01707** (`3c3697b7-33f8-45a4-beaf-5a1892fc9483`), read on the staff policy page:

| # | Figure | Value at 08b3678 | On 06166cb | Agree |
|---|---|---|---|---|
| 1 | Annual premium written at issuance | $1,200.00 | $1,200.00 | agree |
| 2 | Tax at issuance | $28.20 | $28.20 | agree |
| 3 | Policy fee | $25.00 | $25.00 | agree |
| 4 | Charge at issuance | $1,253.20 | $1,253.20 | agree |
| 5 | Commission at issuance | $180.00 | $180.00 | agree |
| 6 | Days remaining at the endorsement | 335 of 365 | 335 of 365 | agree |
| 7 | Annual difference | $1,200.00 | $1,200.00 | agree |
| 8 | Prorated premium of the endorsement | $1,101.36 | $1,101.36 | agree |
| 9 | Tax on the endorsement premium | $25.88 | $25.88 | agree |
| 10 | Fee on the endorsement | $0.00 | $0.00 | agree |
| 11 | Delta collected | $1,127.24 | $1,127.24 | agree |
| 12 | Commission on the endorsement | $165.20 | $165.20 | agree |
| 13 | Cash collected on the policy | $2,380.44 | $2,380.44 | agree |
| 14 | Commission payable, net | $345.20 | $345.20 | agree |
| 15 | Unearned premium held | $2,301.36 | $2,301.36 | agree |
| 16 | Stripe reference of the delta | pi_3UDf5YK6R3v50tIy1GkJdCCi | same string | agree |
| 17 | Terms in force on 2026-09-09 | $1,200.00 / $28.20 / $1,253.20 / 1M / 2M | same | agree |

**CGP-01274** (`104d2966-be96-4c36-9956-caf0762f8b15`), read on the staff policy page, the claim
page and the approvals screen:

| # | Figure | Value at 08b3678 | On 06166cb | Agree |
|---|---|---|---|---|
| 18 | Written premium | $2,312.00 | $2,312.00 | agree |
| 19 | Charge at issuance | $2,391.33 | $2,391.33 | agree |
| 20 | Earned to the cancellation | $278.70 | $278.70 | agree |
| 21 | Unearned, refunded | $2,033.30 | $2,033.30 | agree |
| 22 | Tax refunded | $47.79 | $47.79 | agree |
| 23 | Fee refunded | $0.00 | $0.00 | agree |
| 24 | Total refund | $2,081.09 | $2,081.09 on the policy page **and** on `/ops/approvals` | agree |
| 25 | Commission clawback | $304.99 | $304.99 | agree |
| 26 | Commission payable, net | $41.81 | $41.81 | agree |
| 27 | Claim paid | $1,200.00 | $1,200.00 on the policy page, the claim page and the approvals screen | agree |
| 28 | Reserve outstanding | $3,800.00 | $3,800.00 on both | agree |
| 29 | Incurred | $5,000.00 | $5,000.00 on both | agree |
| 30 | Stripe refund reference | re_3UDN8aK6R3v50tIy0J6CmRy3 | same string on the policy page | agree |

**30 of 30 agree, which contains the 24 the review counted. Nothing moved.**

Two supporting checks, both of which would have caught a silent drift:

- **The fold counts match exactly.** 8 "Explain this amount" folds on CGP-01707, 14 on
  CGP-01274, 3 on the claim: the same 8 / 14 / 3 the integration review recorded. **Zero** of
  them prints the disagreement alert (`grep` for "does not end on the figure" over the rendered
  text of the three pages: no match).
- **The reconciliation board still reports 22 open breaks**, and its Stripe run still reads
  "22 breaks (6 matched, 0 local only, 22 provider only, 0 amount mismatch, 0 stale)".

**What I could not re-read on the board, stated plainly.** Three of the figures carry a
"matched, difference 0" note in the integration review's Reconciliation column: the $1,253.20 and
$2,391.33 collections and the $2,081.09 refund. `/ops/reconciliation` lists **breaks**, not
matched records, so those three amounts are not printed there and never were: the integration
review took them from the run comparison records, not from that screen. Their per-run counts are
unchanged, which is all the board itself can show. This is a limit of my re-read, not a
disagreement.

### Builder B's sum change, checked where it matters

`lib/policy/read.ts` now returns two extra fields per journal entry, `reversesEntryId` (the
column has existed since migration 0001) and `isReversedByACorrection`, both read from the same
query with no second round trip. `app/policies/[policyId]/page.tsx:168` filters with them before
computing the four summary figures and hands the **same filtered list** to the folds that explain
them, so a fold can never list a line the figure above it did not count.

- **A policy with no reversal cannot move.** The filter drops entries where
  `reversesEntryId !== null` or `isReversedByACorrection`; on a policy with no reversal both are
  false everywhere and the filter is a no-op. Confirmed live: all 30 figures above unchanged.
- **The voided policy is the only one that moved**, from `$1,253.20` collected and `$1,253.20`
  refunded to `$0.00` and `$0.00`, which is UI-022.
- **AF-03 is not engaged.** This is a read path. Nothing is updated, nothing is deleted, and both
  the original entry and its reversal stay in the journal panel, visible, with "reverses
  06471823" printed on the reversal.

---

## 5. 375 px

| Screen | State | `innerWidth` | `scrollWidth` | Text readable at 1512 and not at 375 |
|---|---|---|---|---|
| policy CGP-01707 | on arrival | 375 | **375** | 0 of 231 strings |
| policy CGP-01707 | **explanation fold open and references fold open** | 375 | **375** | 0 of 231 strings |
| reconciliation | on arrival | 375 | **375** | 0 of 488 strings |
| statements list | on arrival | 375 | **375** | 0 of 140 strings |
| console | on arrival | 375 | **375** | 0 of 582 strings |

**F-B13-30 of `docs/reviews/b13-screens.md` is closed.** That review measured 375 to **731 px**
after a single click on "Explain this amount". The same click, plus a references fold on top of
it, now leaves the document at exactly 375 px.

**One thing at 375 px is not readable, and it is not these cycles' doing (F-UA-04).** On the
policy page the journal entry lines sit in `div.entry-block`, which `app/globals.css:1706`
declares `overflow: hidden`. At 375 px that box has `clientWidth 277` around a `640 px` table:
**363 px are clipped and there is no scroll container to reach them.** The DEBIT and CREDIT
amounts of every journal entry, and the ends of the account names, are unreachable on a phone.
`.entry-block { overflow: hidden }` came in at `e341f83` on 2026-09-08 at 22:06, an ancestor of
all three cycles and of the tree `b13-screens` measured, so this is pre-existing, not a
regression. It survived that review because a document-level overflow test cannot see a
container that clips rather than overflows.

---

## 6. Regressions

**Every screen the three cycles touched renders for its role.** 32 role-and-path combinations,
GET only:

| Result | Count | Detail |
|---|---|---|
| HTTP 200, an `h1`, no redirect to `/login` | 30 | `/ops`, `/ops/policies`, `/ops/approvals` (ops and approver), `/ops/reconciliation`, `/ops/statements`, `/ops/console`, `/ops/console/infra`, `/ops/console/search`, the four 360 views, `/ops/claims/<id>`, `/inbox` (ops, approver, broker, customer), the three policy pages, `/policies/<id>/endorse`, `/policies/<id>/corrections/new`, `/statements/<id>`, `/broker`, `/broker/statements`, `/customer`, and the customer's two policies |
| HTTP 404 on the not-found page | 2 | `/policies/not-a-uuid` and `/no-such-page-for-the-review`, both "This page couldn't be found." |
| Stack-trace markers found | **0 of 32** | searched for `at Object.`, `at async`, `webpack-internal`, `digest:`, `Error:`, `TypeError`, `ReferenceError`, `Call Stack`, `unhandledRejection` in the rendered text |

`app/error.tsx` was read rather than triggered: it renders one sentence in a `role="alert"`, a
"Try again" button and a link, and **does not take the `error` prop at all**, so it cannot print
a digest or a stack. I induced no server failure, so that screen was not seen rendered
(section 10).

**Integration-mode labels and the sandbox sentence.** Present on all 30 application screens
(absent only on the two 404s, which carry no chrome). Counts on the screens that show simulated
or live records: reconciliation 28 `LIVE SANDBOX` and 11 `LOCAL SIMULATOR`; the console 28 `LIVE
SANDBOX` and the "Stripe: test mode, live sandbox" sentence; the claim page 4 `LOCAL SIMULATOR`;
the broker 360 14 and 14. No screen shows a simulated record without naming it.

**Inbox anchor ids: unchanged.** `INBOX_ANCHORS` in `lib/inbox/sections.ts` is byte-identical at
`22babed^1`, at `ce60fb2^1` and at `06166cb`: `policies`, `endorsement-deltas`,
`correction-differences`, `change-requests`, `waiting-for-the-customer`, `corrections`,
`approvals`, `endorsements`, `claims`, `reconciliation`. **Nothing added, removed or renamed.**
The rendered ids match: ops shows `reconciliation, approvals, policies, endorsements, claims`;
broker shows `policies, endorsement-deltas, correction-differences, ...`; customer shows
`policies, corrections`.

**The approvals decision form is untouched.** `git diff ce60fb2^1 06166cb -- app/ops/approvals/page.tsx`
shows the copy, the panel classes, the stylesheet import and one `className` on a note. The form
itself is identical at both revisions:

```
<form method="post" action={`/api/approvals/${request.requestId}`}>
  <input name="reason" ...>
  <button type="submit" name="decision" value="approved">
  <button type="submit" name="decision" value="rejected">
```

Same action, same method, same three field names, same two values. It could not be observed
rendered because no request is pending; it was read at both revisions instead, and nothing was
submitted.

**Sidebar counts against the inbox lists.** Ops: sidebar badge **22**, `/inbox` reconciliation
section **22 rows**, every other section empty, total 22. Agrees. Broker: **no badge**, and every
inbox section empty. Agrees. (Approver and customer, checked as well: no badge, empty sections.)

---

## 7. Findings

| ID | Severity | Finding |
|---|---|---|
| **F-UA-01** | **MEDIUM** | **UI-004 is closed on `/ops/policies` and left open on `/broker`**, a route the audit named under `also_affected_routes`. The broker's list prints Total charge `$2,481.40` for CGP-01707, which is next month's total: the policy's own page and the staff list both print `$1,253.20` for today, and the staff list gained a paragraph explaining that an endorsement dated later is not in the figure. The broker's list has neither the folded figure nor the explanation, and the same broker screen carries the row for the voided CGP-01061 at `$1,253.20` without the "on the policy record" note the staff list now prints. **Trigger:** sign in as `broker@example.com`, read the Total charge of CGP-01707, open the policy. **Consequence:** the person who sells the policy is shown a different current charge from the person who administers it and from the customer, which is the exact contradiction UI-004 numbered. **Location:** `app/broker/page.tsx`; the fix is the one already written in `app/ops/policies/page.tsx:29` (fold each policy with `policyAsItStoodOn` plus `termsInForceOn`) and its disclosure paragraph. |
| **F-UA-02** | **LOW** | **UI-009's rewrite still does not account for the record on the screen.** The new sentence and the new disclosure both say that below the threshold the only request that appears is one an agent raised through MCP. The `$10.00` decided request is below the `$1,000` threshold and is **not** agent-raised; its own row says "raised only to prove the per-claim threshold". `lib/approvals/threshold.ts:39` (`claimPayoutNeedsApproval`) and `:74` (`refundNeedsApproval`) are the real reason: the threshold is cumulative per claim and per policy, so a small request joins the queue when the claim's or the policy's running total crosses `$1,000`. **Consequence:** an operator reading the disclosure concludes the `$10.00` row came from an agent, and it did not. **Correction:** name the cumulative rule in the same sentence, for instance "or when it takes the claim's total money-out above the threshold". One sentence, no code. |
| **F-UA-03** | **LOW** | **Cycle B's fixed column widths on the endorsement schedule have two visible side effects.** `app/styles/policy-detail.css` sets `table-layout: fixed` with `th:nth-child(4) { width: 16% }`. At 1512 px that is 118 px, and the header "New annual premium" is 121 px of text that `app/globals.css` keeps `white-space: nowrap`: it **overflows 19 px into the "Stripe" header**, so the two labels touch with no gutter. Proved in the page: switching the table to `table-layout: auto` gives that column 153 px and the overflow disappears; setting the headers to `white-space: normal` shrinks the label to 67 px and the overflow disappears while the Change column keeps its 236 px. The same fixed widths leave the UI-021 references fold 93 px wide, which splits the word REFERENCES. **Correction:** `table.endorsement-schedule thead th { white-space: normal; }`, the same repair `ops-tables.css:66` already applies to the operations tables. |
| **F-UA-04** | **MEDIUM** | **At 375 px the journal entry lines are clipped with no way to reach them.** `app/globals.css:1706` gives `.entry-block` `overflow: hidden`; at 375 px its content box is 277 px around a 640 px table, so **363 px are cut**, including the whole DEBIT and CREDIT columns of every entry on the policy page. Not a regression of these three cycles: the rule landed at `e341f83`, before all of them and before the tree `docs/reviews/b13-screens.md` measured, and that review missed it because its test was document-level `scrollWidth`, which a clipping container satisfies. **Correction:** the same `.table-scroll` treatment the other wide tables get, or `overflow-x: auto` on `.entry-block`. Recorded here because I measured it; it belongs to whoever owns the journal component, not to this cycle. |
| **F-UA-05** | **LOW** | **`/ops/approvals` was edited by cycle C and not given the stylesheet that fixed the same defect elsewhere.** Its table carries neither the `ops-table` class nor `app/styles/ops-tables.css`, so its cells keep `overflow-wrap: anywhere` and its "What" column is **71 px**, splitting "payment" into "paym / ent" and "refund" into "refun / d". Identical in the audit's own `ops-approvals.jpg`, so pre-existing and unchanged, and outside the audit's numbered issues. It is the same defect class as UI-006, UI-011, UI-013, UI-026, UI-029 and UI-030, on a screen the cycle touched. **Correction:** add the stylesheet and the `ops-table` and `col-*` classes, as cycle A did for the six tables it owned. |
| **F-UA-06** | **LOW** | **The ops policy list's new per-policy fold is unbounded.** `app/ops/policies/page.tsx:29` runs `Promise.all` over every policy of every broker, two reads each (`policyDetail` and `policyAsItStoodOn`), and `policiesOfBroker` carries **no `LIMIT`**. Builder B measured 0.13 s per policy on a 1077-policy test database. **At the delivered scale it is not a finding:** production holds 4 policies and the page's median server response over 5 GETs is **203 ms**, inside the spread of the other operations screens (`/ops` 167 ms, `/ops/approvals` 176 ms, `/ops/statements` 205 ms, `/ops/reconciliation` 223 ms). Recorded as a stated limitation, not a defect: the honest cost of folding a policy is what it is, and the page has no pagination to bound it. |
| **F-UA-07** | **LOW** | **Two sibling stylesheets solve the same problem by opposite conventions.** `ops-tables.css` argues, at length and correctly, for a minimum width per column **role** written on the cells, "never on a column number: a table whose columns are reordered keeps its widths". `policy-detail.css`, written in the same folder in the same cycle, uses `th:nth-child(1|3|4|5)` percentages. Neither is wrong, but a reader who has just read the first file's reasoning will be surprised by the second, and the nth-child widths break silently if the schedule's columns are ever reordered. Separately, `ops-tables.css` declares `.col-ref`, `.col-text`, `.col-line`, `.col-label`, `.col-when`, `.col-age`, `.col-name`, `.col-controls` and `.col-open` as **global** class names, not scoped under `.ops-table`, although the file's own header says every rule is scoped by a class its pages put on the element. Any future element given one of those names inherits these widths. |

No finding in this scope engages AF-01 to AF-05. AF-06 is the walkthrough, which is open by
definition (section 8).

### Automatic-fail mapping for this scope

| Rule | Applicability here | Result |
|---|---|---|
| AF-01 | reviewed on the deployed URL, not localhost | PASS for this scope |
| AF-02 | do the changed screens claim a simulation is live | PASS: 30 of 30 screens keep the sandbox sentence, and every simulated row is labelled `LOCAL SIMULATOR` on its own row |
| AF-03 | is any money row written or rewritten | NOT ENGAGED: every change reviewed is presentation or a read path; the UI-022 fix filters a summary and leaves both the entry and its reversal in the journal |
| AF-04 | sandbox only, seeded identities | PASS: only `example.com` identities, test-mode Stripe ids, $0 spent |
| AF-05 | no secret in this record or its evidence | PASS: the password was loaded with `process.loadEnvFile` and never echoed; the 30 PNGs were reviewed, the login one shows "the demo password shared with the reviewers" and no value; `gitleaks protect --staged` run before the commit |
| AF-06 | can these files be defended line by line | Section 8; walkthrough **NOT REVIEWED WITH YOANN** |

---

## 8. READABLE-CODE.md on the new stylesheets and the refresh component

**`app/ops/console/auto-refresh.tsx`: the clearest file of the three cycles.** Thirty lines, of
which nineteen are a comment that says what was there before (`<meta http-equiv="refresh">`), why
it was wrong ("a promise made to the BROWSER, not to the page"), and what replaces it. The code
itself is one `useEffect` that sets an interval and returns a cleanup that clears it, plus
`router.refresh()` so the server still produces every figure. It renders `null`. There is no
magic number: the ten seconds is a named default parameter, and the screen says out loud "This
page reads itself again from the server every 10 seconds while it is open". **Nothing here needs
explaining twice.**

**`app/styles/ops-tables.css`: 171 lines, and it teaches.** Its header names the single cause of
seven audit issues (`overflow-wrap: anywhere` on every table cell, which tells the browser a
column may be one character wide when it computes widths), the three moves that repair it, and
then every rule carries the measured number that justifies it: "'Knowledge cutoff (UTC)' alone
was holding 150 px of a 736 px table open", "one chip was taking 276 px of a ten-column table".
No `:has()`, no container query, no custom property, no negative margin, no `position: sticky`.
Two constructs a non-expert would want named once: `grid-template-columns: minmax(0, 1fr)` (a
grid track that is allowed to be narrower than its content, which is the whole trick) and
`order: -1` (move this box first without moving it in the HTML). Both are one sentence each.

**`app/styles/policy-detail.css`: readable, with the one convention clash of F-UA-07.**
`table-layout: fixed` plus percentage widths is a real concept to explain (the browser stops
measuring the content and obeys the first row), and the comment does explain it, including why
column 2 is deliberately left unset. The `nth-child` selectors are the part a reader has to hold
in their head against the JSX.

**`app/styles/shell.css`: 61 lines, one clever line.** `.signed-out > main:has(.login-grid)` is
the only modern selector in the three sheets. `:has()` matches a parent by what it contains; it
is supported in current Chrome, Safari and Firefox 121 and later. **The failure mode is benign:**
in a browser without it the rule does not apply and the login page goes back to jumping, which is
the old behaviour, not a broken page. Worth one sentence in the walkthrough because it is the one
selector in this cycle that a reader cannot guess. The rest is `margin-top`, `display: block` and
a flex row, each with the audit id and the measured pixel gap beside it.

**`lib/policy/read.ts` and `lib/console/read.ts`, the two behaviour changes**, are both small and
both explain themselves. The console one is four lines and names the leaking predicate in words
before removing it. The policy one adds two fields, derives the reversed set from rows it already
has ("no second query"), and the filter that uses them sits next to a comment that states what
the four sums are allowed to add up and that the journal below is untouched.

**Nothing in this cycle is opaque financial math.** No formula changed. The one arithmetic-shaped
change, excluding reversed pairs from four sums, is a `filter` over a list with the rule written
in the same sentence as the reason for it.

---

## 9. Checks actually executed

| Check | Result |
|---|---|
| `/api/health` before the first and after the last measurement | `06166cb7e068df1b2f7ca756e3c22a3f82d155b1` both times |
| 26 issue reproductions at 1512 px, on the deployed revision | 24 RESOLVED, 2 PARTLY, 0 STILL OPEN |
| Word-fragmentation scan (Range client rects) over 14 screens | 11,400+ words checked; every remaining split is an opaque identifier inside `code`, `.note` or a badge |
| Hidden-column scan on every operations table | `clientWidth == scrollWidth` on the breaks, runs, errors, feed, payments and all four 360 tables |
| 30 figures of `integration.md` item 1, folds opened | 30 of 30 agree; fold counts 8 / 14 / 3 as recorded; 0 disagreement alerts |
| 375 px overflow on four screens, including two folds open on the policy | `scrollWidth == innerWidth == 375` on all five states |
| Text reachable at 1512 and not at 375 | 0 of 231, 488, 140 and 582 strings |
| 32 role-and-path renders, GET only | 30 x HTTP 200, 2 x HTTP 404, 0 stack-trace markers |
| `INBOX_ANCHORS` at `22babed^1`, `ce60fb2^1`, `06166cb` | byte-identical |
| Approvals decision form at `ce60fb2^1` and `06166cb` | identical action, method and field names |
| Sidebar badge against inbox lists, four roles | ops 22 = 22; broker, approver, customer 0 = 0 |
| `/ops` after leaving the console, 25 s untouched | still `/ops`, one navigation recorded |
| Server response time, 5 GETs per page | `/ops/policies` median 203 ms against 167 to 223 ms on four comparable ops screens |
| `gitleaks protect --staged --redact` before the commit | run; result in the commit record |

---

## 10. What was not verified

- **`app/error.tsx` rendered.** No server exception occurred and I induced none. The file was
  read instead: it prints one sentence and two actions and never receives the error object. The
  audit made the same choice and recorded the same limit.
- **The three matched reconciliation amounts on the board.** `/ops/reconciliation` lists breaks;
  matched records appear only as counts. Explained in section 4.
- **The approvals decision form rendered.** Nothing is pending, so no row shows it. Read at both
  revisions and compared instead; not submitted.
- **The endorsement and correction approval pages** (`/policies/<id>/endorsements/<id>/approve`,
  `/policies/<id>/corrections/<id>/approve`). No pending request exists and I created none. The
  audit recorded the same gap.
- **PDF contents.** Not opened; the audit records a browser block on the same route.
- **Anything below P3.** The nine P3 issues are out of this assignment.
- **Whether the fixes hold on another viewport than 1512 and 375.** Both were measured; nothing
  between them was.
- **Yoann's understanding.** Not established by anything in this record.

---

## 11. Verdict

**FAIL for the cycle**, on **F-UA-01** (MEDIUM): UI-004 is one of the 26 issues this cycle owed
and it is closed on one of its two routes. The broker's policy list still contradicts the policy
page on the current charge of CGP-01707. The fix is written already, twenty lines away, in
`app/ops/policies/page.tsx`.

Everything else in the declared scope is supported: 24 of 26 issues resolved with a measurement
each, one PARTLY (F-UA-02, a sentence), the 30 figures of the integration review unmoved, 375 px
clean on all four screens including the two folds that used to break it, no stack trace on any of
32 role-and-path renders, the inbox anchors and the approvals form untouched, the counts still
agreeing. The stylesheets are readable and the refresh component is the best-explained file of
the three cycles.

Fixing F-UA-01 and F-UA-02 would take this to PASS. F-UA-03 and F-UA-05 are cheap. F-UA-04 is
real but belongs to the journal component and predates this work. F-UA-06 and F-UA-07 are
disclosures.

**Walkthrough status: NOT REVIEWED WITH YOANN.**

---

## 12. Register lines for `docs/reviews/FINDINGS.md`

The coordinator owns that file. These are the lines to append:

| ID | Sev | Finding (one line) | Fix | Status |
|---|---|---|---|---|
| F-UA-01 | MED | UI-004 fixed on /ops/policies and not on /broker: the broker list still prints $2,481.40 for CGP-01707 where the policy page and the staff list print $1,253.20, and CGP-01061 without the "on the policy record" note | Fold each policy on /broker with policyAsItStoodOn plus termsInForceOn, as app/ops/policies/page.tsx:29 already does, and carry its disclosure paragraph | OPEN |
| F-UA-02 | LOW | UI-009's new sentence names only the agent case; the $10.00 decided request is sub-threshold and not agent-raised, it is there under the cumulative per-claim rule (lib/approvals/threshold.ts:39) | Name the cumulative rule in the same sentence | OPEN |
| F-UA-03 | LOW | table-layout: fixed on the endorsement schedule makes the nowrap header "New annual premium" (121 px) overflow its 118 px column into "Stripe", and leaves the UI-021 references fold 93 px wide | `table.endorsement-schedule thead th { white-space: normal; }`, the repair ops-tables.css:66 already uses | OPEN |
| F-UA-04 | MED | At 375 px `.entry-block { overflow: hidden }` (app/globals.css:1706) clips 363 px of the 640 px journal entry table with no scroller: every DEBIT and CREDIT amount on the policy page is unreachable on a phone. Pre-existing since e341f83, missed by b13-screens because its test was document-level scrollWidth | Give .entry-block the .table-scroll treatment, or overflow-x: auto | OPEN |
| F-UA-05 | LOW | /ops/approvals was edited by cycle C without ops-tables.css: its What column is 71 px and splits "payment" and "refund", the same defect class as UI-006/011/013/026/029/030. Pre-existing, visible in the audit's own ops-approvals.jpg | Add the stylesheet and the ops-table and col-* classes | OPEN |
| F-UA-06 | LOW | The ops policy list folds every policy, two reads each, Promise.all with no LIMIT on policiesOfBroker. 203 ms median at the delivered scale (4 policies), against 167 to 223 ms on comparable ops screens, so not a defect now | DISCLOSED as a stated limitation; bound it if the estate grows | DISCLOSED |
| F-UA-07 | LOW | ops-tables.css argues for role classes "never on a column number" and policy-detail.css, same folder same cycle, uses th:nth-child percentages; and the col-* classes are global, not scoped under .ops-table as that file's header claims | Scope the col-* rules under .ops-table and note the convention, or align the two sheets | OPEN |

## Coordinator note, 2026-09-09T18:55Z: the cycle verdict was lifted in later records

The FAIL above rested on F-UA-01 (the broker home on the future premium) and carried F-UA-04 (the journal clipped at 375 px). Both were fixed in the LOW screens sweep (ec4c5c9, merged 3890300) and confirmed on production in docs/reviews/b13-14-low-screens.md (16 of 17 items, F-UA-01 to F-UA-05 CONFIRMED PASS at 3890300); the interface rework that followed was reviewed PASS at c408cb3 in docs/reviews/ui-cycle-2.md, which re-measured eleven of the 26 desktop items. A reader stopping at the verdict above stops before those records. No line above was edited.
