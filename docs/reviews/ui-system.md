# Independent review: the interface rework (branch `ui-system`)

**Scope.** The presentation-layer rework of every screen: the two-level shell, the sticky page
band, the common blocks (`components/ui/*`), the read-only ledger reader `lib/ledger/read.ts` and
its console section, the landing page, and the rebuild of the 33 signed-in screens. Feature ids
from `docs/PLAN.md`: the B13 screens slice, plus **F-YA-05, F-YA-09, F-YA-11** and
**F-LU-01 to F-LU-05**. The earlier UI audit's own findings **F-UA-01 to F-UA-05** are re-checked
because this branch rewrote the files that closed them.

**Reviewer:** independent sub-agent, read-only, in the worktree
`.claude/worktrees/ui-system`. No file other than this record was created or edited; no git write
command and no form that posts was run.

**Written:** 2026-09-09, 14:35Z to 15:00Z UTC.

**Reviewed revision: `2af6ebe3156c66bae35f831cc1323aaedd6d854e` (`2af6ebe`).** Merge base with
`main`: `0ee1b6e772d205136107899eb3b7ee053acc6663`. Every diff below is
`git diff main...HEAD` at that pair. **`git status` was clean at the start of the review and clean
again at the end**, so nothing in this record rests on an uncommitted change. The running dev
server at `http://localhost:3010` serves this worktree; all HTTP evidence is GET plus one
`POST /api/session/login` per role.

**Verdict: PASS at `2af6ebe`.** No HIGH and no MEDIUM finding. Eight LOW findings, all cleanup or
consistency, listed in section 5.

**Walkthrough status: NOT REVIEWED WITH YOANN.** Nothing here says he can explain this shell, the
chart components or the ledger reader. Section 6 is a readability assessment of the code, not a
statement about his understanding.

---

## 1. Startup receipt (AGENTS.md)

Read **in full**, in this order, before opening any code:

| File | What I took from it |
|---|---|
| `AGENTS.md` | startup receipt, delegate ownership, completion gates, the financial invariants a presentation branch must not touch |
| `AUTOMATIC-FAILS.md` | the six bans; AF-02, AF-03 and AF-05 are the ones this scope can engage |
| `REVIEWER.md` | the implementation-review contract and the section 3 record shape |
| `READABLE-CODE.md` | what to flag: opaque indirection, hidden side effects, dead code, money math without an example |
| `WORKFLOW-48H.md` | the checkpoints and the review obligation this record satisfies |
| `docs/handoffs/ui-system-brief.md` | the builders' contract: what is frozen, the shape of a rebuilt screen, the writing rules |
| `docs/handoffs/ui-system-notes.md` | the nine decisions, the ownership split, the disclosures, the checks the interface session had run |
| `docs/reviews/b13-13-ui-audit.md` | the method and the 30 figures measured on CGP-01707 and CGP-01274 |
| `CLAUDE.md` (worktree copy) | entry point and reading order |

Read **by targeted section**: `docs/reviews/FINDINGS.md` lines F-YA-05, F-YA-09, F-YA-11,
F-LU-01 to F-LU-05, F-UA-01 to F-UA-05; `README.md` (integration inventory and demo roles);
`lib/inbox/sections.ts` and `lib/inbox/tasks.ts` (the anchors and the sections that carry counts);
`lib/console/safe-read.ts`; `db/client.ts`.

Read **in full at HEAD**: `lib/ledger/read.ts` (505 lines), `lib/ledger/read.test.ts`,
`lib/ui/views.ts`, `app/ops/console/ledger/page.tsx`, `components/shell/app-shell.tsx`,
`components/shell/sections.tsx`, `components/ui/inspector.tsx`, `components/ui/table.tsx`,
`components/ui/toast.tsx`, `components/ui/submit-button.tsx`, `components/ui/popover.tsx`.

Read **as diffs**: `git diff main...HEAD` over `lib db app/api scripts`, over
`components/amount-explained-motion.tsx`, over `components/journal-table.tsx`, and the form
inventory of every `.tsx` on both refs (see section 3.2).

**Absent files:** none. `.env.local` exists in this worktree, is untracked, and was read only by
the screenshot and dump scripts, which take `DEMO_PASSWORD` from it and never print it.

**Next acceptance criterion:** this record is the criterion. Its checks are section 7.

---

## 2. Applicability

This is a **presentation-layer** branch. It writes nothing, moves no money, calls no provider and
adds no route. That bounds what applies:

| Applies | Why |
|---|---|
| **AF-02** (never present a simulation as live) | the rebuilt screens carry the mode labels; a rework can lose one |
| **AF-03** (never UPDATE or DELETE money rows) | the branch adds a ledger reader and a ledger screen; both must be SELECT-only, and every displayed balance must still derive from the journal |
| **AF-05** (never commit secrets) | 16 new commits are being shared |
| **AF-06** (own every line) | 15,535 added lines of it; readability is the gate |
| The brief's frozen contracts | forms, refusals, inbox anchors, the 30 figures |

**Does not apply, and why:** AF-01 (deployment) is a final-delivery gate and this branch is not
deployed; AF-04 (sandbox only) is unengaged, since no credential, no provider call and no seeded
identity is touched. No US financial-regulation question is engaged by a change of stylesheet and
markup: the rules that were mapped to controls in the money reviews are unchanged here, because
the code that implements them is unchanged. Nothing in this record is a legal certification.

---

## 3. Matrix: requirement, control, evidence, verdict

### 3.1 The money code is untouched

| Requirement | Control | Evidence | Verdict |
|---|---|---|---|
| Nothing under `lib/`, `db/`, `app/api/`, `scripts/` changes, except the four allowed files | branch discipline | `git diff --stat main...HEAD -- lib db app/api scripts` returns exactly four files: `lib/ledger/read.ts` (+505), `lib/ledger/read.test.ts` (+103), `lib/ui/views.ts` (+117), `lib/ui/views.test.ts` (+78). All additions, no deletions, no `db/`, no `app/api/`, no `scripts/` | **PASS** |
| The ledger reader is SELECT only | `lib/ledger/read.ts` | read in full: six queries, every one a `select`; no `insert`, `update`, `delete`, `truncate` or transaction anywhere in the file; it runs on `sql` from `db/client.ts`, which is the runtime role with no mutation right on the journal | **PASS** |
| Bounded reads | same | trial balance is one row per account of the chart of accounts; `accountLedger` and `entries` take an explicit `limit` (50, 100, 500 from the screen); `dailyFlows` is a window of 7, 30 or 90 days; `appendOnlyProof` is four aggregates. The screen's bounds are constants at the top of `app/ops/console/ledger/page.tsx` | **PASS** |
| No arithmetic on money beyond signed sums | same | every amount arrives from Postgres as text and goes through `centsFromDatabase`; the only operations are `+`, `-` and `reduce`. No division, no rate, no rounding, no float | **PASS** |
| Every function carries a numeric example | `READABLE-CODE.md` | `signedBalanceCents`, `runningBalances`, `dayWindow`, `flowOfLine`, `intoWeeks`, `trialBalance`, `accountLedger`, `dailyFlows` and `appendOnlyProof` each have a worked example in cents in the comment above them | **PASS** |
| The tests are real | `lib/ledger/read.test.ts` | ten `node:test` cases asserting the five pure rules on the figures of the trial database, with no database and no mock. They ran in `npm test` (section 7) | **PASS** |

### 3.2 The forms are unchanged

I extracted every `<form>...</form>` on both refs with its `action`, `method`, every `name=` and
every hidden input, then diffed the two inventories (49 forms on `main`, 52 at HEAD).

**Every POST form is byte-identical in contract.** The single POST form that appears to move is
the sign-out form, which travelled from `components/portal-shell.tsx` to
`components/shell/app-shell.tsx` with the same `action="/api/session/logout"` and the same
`method="post"`.

The nine differences are all GET forms:

| Change | Assessment |
|---|---|
| `action="/ops/console"` becomes `action={PATH}` on three pages | `const PATH = "/ops/console"` and `"/ops/console/search"` in the same files: the same strings |
| Three GET forms gain a hidden `view` input | the documented, allowed case: a filter form must not lose the view it was submitted from |
| The console window form gains hidden `kind` inputs; the kind checkboxes become filter-chip links | same route, same `method="get"`, same parameter names `kind` and `since`. The server reads the same query it read before |
| Two new GET search forms on `/broker` and `/ops/policies` | new search boxes, `filter` carried hidden so a search does not drop the active filter |
| `action={\`/api/policies/${policy.policyId}/documents/...\`}` becomes `${policyId}` | the two document forms moved into a `DocumentForms({ policyId })` component, called at both sites with `policyId={policy.policyId}`. Same URL |

**Verdict: PASS.** No form changed its action, method, field names or hidden contract in a way a
route can observe.

### 3.3 The refusals are unchanged

| Check | Evidence | Verdict |
|---|---|---|
| No `loading.tsx` anywhere | `find app -name loading.tsx` returns nothing | **PASS** |
| The guard precedes any markup on every changed page | script over the 33 changed `page.tsx`: the first `requireX()` / `redirect()` / `notFound()` is above the first `return (<` in all 33 | **PASS** |
| Signed out, the protected routes refuse | `curl` with no cookie: `/ops`, `/ops/console`, `/ops/console/ledger`, `/inbox`, `/broker`, `/customer`, `/ops/approvals`, `/ops/reconciliation`, `/policies/not-a-uuid`, `/ops/claims/not-a-uuid`, `/statements/not-a-uuid` all answer **307**. `/not-a-page` answers **404**, `/` and `/login` answer **200** | **PASS** |
| The inspector refuses a non-staff role | `components/ui/inspector.tsx:21` returns `null` for any role other than `staff_ops` and `staff_approver`, before any read. Confirmed in the rendered HTML: no `inspect=` link on any broker or customer screen | **PASS** |

### 3.4 AF-02: the mode labels are visible, not folded

Method: sign in with Playwright, read `document.body.innerText`, which excludes the content of a
closed `<details>` and of a closed popover. A string found there is a string a reader sees without
opening anything.

| Screen | `Stripe: LIVE SANDBOX` | `LOCAL SIMULATOR` | Verdict |
|---|---|---|---|
| `/ops/reconciliation` (and `?view=runs`) | visible | visible | **PASS** |
| `/ops/console` (feed, problems, latency) | visible | visible | **PASS** |
| `/ops/console/ledger` (four views) | visible | visible | **PASS** |
| `/ops/approvals` (waiting, decided) | visible | visible | **PASS** |
| `/ops/claims/<CLM-00212>` (four views) | absent, correctly | visible | **PASS** |
| `/policies/<CGP-01707>` staff, six views | visible | not applicable | **PASS** |
| `/policies/<CGP-01274>` staff, six views | visible | visible | **PASS** |
| `/policies/<CGP-01707>` as `customer@example.com` | visible | not applicable | **PASS**, closes F-LU-04 |
| `/broker`, `/broker/statements`, `/broker/policies/new`, `/broker/kyb` | visible | not applicable | **PASS** |
| `/customer` | visible | not applicable | **PASS** |
| `/inbox` for all three roles | visible | staff only | **PASS** |
| `/ops/policies`, `/ops/statements`, `/statements/<run>` | visible | not applicable | **PASS** |

The claim page is the one screen with no Stripe chip, and that is right: `grep` over its rendered
HTML finds no `pi_`, no `re_` and no occurrence of the word Stripe. Its only money rail is the
simulated payout, and it is labelled `claim payout rail: LOCAL SIMULATOR` in the band. Every
console screen also carries `IntegrationModes` in its `.notices` block.

### 3.5 The 30 figures still print the same values

Every figure of `docs/reviews/b13-13-ui-audit.md` section 4, re-read on the rebuilt screens at
`2af6ebe`. The policy page is now six views, so a figure that used to be on one long page is on
the view that owns it.

| Policy | Figures | Where they print now | Verdict |
|---|---|---|---|
| CGP-01707 | 1 to 4, 13 to 15, 17 | Overview: $1,200.00 / $28.20 / $25.00 / $1,253.20; $2,380.44 / $345.20 / $2,301.36; terms in force $1,000,000.00 and $2,000,000.00 | **agree** |
| CGP-01707 | 5 | $180.00 on both statement pages | **agree** |
| CGP-01707 | 6, 7 | inside the explanation of the prorated delta, as before: "335 of 365 days remained", annual difference $1,200.00. Opened with a real click (section 7) | **agree** |
| CGP-01707 | 8 to 12 | Endorsements and Money views: $1,101.36, $25.88, fee $0.00, $1,127.24, $165.20 | **agree** |
| CGP-01707 | 16 | `pi_3UDf5YK6R3v50tIy1GkJdCCi`, Endorsements view | **agree** |
| CGP-01274 | 18 to 26 | Money view: $2,312.00, $2,391.33, $278.70, $2,033.30, $47.79, policy fee back $0.00, $2,081.09, $304.99, $41.81 | **agree** |
| CGP-01274 | 24 | $2,081.09 also on `/ops/approvals?view=decided` | **agree** |
| CGP-01274 | 27 to 29 | $1,200.00, $3,800.00, $5,000.00 on the policy page, the claim page and the approvals screen | **agree** |
| CGP-01274 | 30 | `re_3UDN8aK6R3v50tIy0J6CmRy3`, Money view | **agree** |

**30 of 30 agree. Nothing moved.**

Two supporting checks:

- **No explanation disagrees with its figure.** `grep` for "does not end on the figure" over the
  rendered HTML of every screen dumped: no match. Every fold says "Recomputed today from the same
  inputs: identical."
- **F-UA-01 stays closed.** `/broker` prints **$1,253.20** for CGP-01707, the corrected value, not
  the $2,481.40 that made the earlier cycle FAIL.

### 3.6 The ledger screen agrees with the database

Independent read-only SQL through `postgres` with `DATABASE_URL_APP`, outside the application:

```
select coalesce(sum(debit_cents),0), coalesce(sum(credit_cents),0) from journal_lines
select sum(debit_cents)-sum(credit_cents) from journal_lines where account_id='cash_stripe'
select (select count(*) from journal_entries), (select count(*) from journal_lines)
```

| Figure | The database says | `/ops/console/ledger` prints | Verdict |
|---|---|---|---|
| Total debits | 4262730 cents | $42,627.30 | **agree** |
| Total credits | 4262730 cents | $42,627.30 | **agree** |
| Debits equal credits | yes | chip "debits = credits" | **agree** |
| `cash_stripe` balance | 300596 cents | $3,005.96, "Cash held at Stripe" | **agree** |
| Entries | 35 | 35 | **agree** |
| Lines | 77 | 77 | **agree** |

These are also the exact figures written in the numeric examples of `lib/ledger/read.ts`, so the
comments a reader relies on are true of the database they describe.

### 3.7 The inbox anchors and the badges

| Check | Evidence | Verdict |
|---|---|---|
| Every section keeps `id={section.anchor}` | `app/inbox/page.tsx:130` (the folded empty variant) and `:137` (the full section) both set it. Rendered `/inbox` carries `id="approvals"`, `id="claims"`, `id="endorsements"`, `id="policies"`, `id="reconciliation"` | **PASS** |
| The sidebar badge links to `/inbox#<section>` | `components/shell/app-shell.tsx:152`, character for character the expression `main` used at `components/portal-shell.tsx:172` | **PASS** |
| The counts and the lists agree | `npm run check:inbox-counts` on the disposable database: **all checks passed**, 50 of 1186 brokers and customers plus one user of each staff role, anchor by anchor (`#approvals 207/207`, `#policies 20/20`, `#endorsements 51/51`, `#claims 73/73`, `#reconciliation 1617/1617`) | **PASS** |

### 3.8 The findings this branch was handed

| Finding | Required | At `2af6ebe` | Verdict |
|---|---|---|---|
| F-YA-05 | primary action never folded | the policy band carries Endorse, Cancel the policy, Open a claim as visible buttons; verified in the rendered text of both policies | **CLOSED** |
| F-YA-09 | a notice after every POST redirect, plus a working state on a submitting button | `toastsFromQuery` on 14 screens; the policy page and the claim page name **every** parameter their routes redirect with (`bound`, `cancelled`, `payment`, `endorsement`, `correction`, `reissued`, `refundSent`, `changeRequest`; `opened`, `bank`, `payment`, `closed`), as a toast **and** as the long inline `.notices` line the review scripts read. `SubmitButton` disables and marks `aria-busy` on its own form's submit | **CLOSED** |
| F-YA-11 | the re-run button says what it reproduces | `app/statements/[runId]/page.tsx:181`: "Reproduce this revision with the same cutoff", same action and same hidden `knowledgeCutoff`, with the About pointing at `/ops/statements?view=new` for a fresh cutoff | **CLOSED** |
| F-LU-01 | the declined reason only on the terminal status | `components/console-360.tsx:238` and `:480` print `Earlier attempt, <date>: <reason>` otherwise | **CLOSED** |
| F-LU-02 | a thead on the lines table | `components/journal-table.tsx` gains `<thead>` with Account, Debit, Credit and `scope="col"`; the decorative header above the blocks is removed; `table.entry-lines > thead > tr > th` styled in system.css | **CLOSED** |
| F-LU-03 | `role="group"` on the lines scroller | `components/journal-table.tsx:101` | **CLOSED** |
| F-LU-04 | the Stripe chip on the customer view | visible on `/policies/<CGP-01707>` signed in as `customer@example.com` | **CLOSED** |
| F-LU-05 | the customer list carries "on the policy record" | `app/customer/page.tsx:135` (legend) and `:178` (the cell), the same wording as `/broker` and `/ops/policies` | **CLOSED** |
| F-UA-01 to F-UA-05 | stayed fixed through the rewrite | F-UA-01 re-measured above; F-UA-02's approvals wording, F-UA-03's schedule headers, F-UA-04's journal scroller and F-UA-05's approvals columns all survive: the approvals, endorsement-schedule and journal blocks render with no overflow at 1440 px and the journal lines scroll in their own container | **STILL CLOSED** |

### 3.9 AF-05

| Check | Evidence | Verdict |
|---|---|---|
| No secret in the branch history | `gitleaks git --redact --no-banner --no-color --log-opts="main..HEAD"`: 16 commits scanned, 665.84 KB, **no leaks found** | **PASS** |
| No environment file tracked | `git ls-files \| grep -i env` returns `.env.example` and two illustration files whose names contain "envelope". `.env.local` exists in the worktree and is untracked | **PASS** |
| Nothing printed | `DEMO_PASSWORD` was read inside the scripts from `.env.local` and never echoed, never put on a command line, never written into this record. No connection string appears here | **PASS** |

---

## 4. Client components

Two are added on this branch, both on the allowed list: `components/ui/toast.tsx` (`Toaster`) and
`components/ui/submit-button.tsx` (`SubmitButton`). The full inventory at HEAD is
`app/error.tsx`, `app/ops/console/auto-refresh.tsx`, `components/amount-explained-motion.tsx`,
`components/money-amount-input.tsx`, `components/portal-frame.tsx`, plus those two. **No client
component beyond the ones the assignment permits.** The charts, the tables, the popovers, the
folds and the inspector are server components; the popovers and the folds are native HTML.

---

## 5. Findings

No HIGH. No MEDIUM. Eight LOW.

| Id | Sev | Trigger and consequence | Location | Required correction |
|---|---|---|---|---|
| F-UIS-01 | LOW | `flowOfLine` is exported and carries eight assertions, but nothing calls it: the classification that actually runs is the `case` expression inside `dailyFlows`. The tests prove a copy of the rule, not the rule the screen uses, so the two can drift with a green suite | `lib/ledger/read.ts:88` and `:446` | either drive the SQL from the function, or say in the comment that the function is the specification and the SQL its transcription, and assert one row of each kind against a real read |
| F-UIS-02 | LOW | The ledger page catches every read failure with a bare `catch {}`, discards the reason and replaces the whole screen with one generic line. The codebase already has `attempt` (`lib/console/safe-read.ts`), which renders a redacted reason per panel; an operator on the one screen that proves AF-03 gets no reason at all | `app/ops/console/ledger/page.tsx:112` | route the five reads through `attempt` and print its sanitised sentence, as the console screens do |
| F-UIS-03 | LOW | `app/ops/console/ledger/page.tsx` imports `app/styles/landing.css` to get a `.ledger-screen` rule. A reader looking for the ledger's styles has no reason to open the landing stylesheet | `app/ops/console/ledger/page.tsx:26`, `app/styles/landing.css` | move the two parked rules into `system.css` or a `ledger.css`, and drop the import |
| F-UIS-04 | LOW | `app/styles/ops-tables.css` (171 lines) and `app/styles/shell.css` (61 lines) are imported by no file, and 12 of 21 and 5 of 6 of their classes appear in no component. Dead files that still read as live ones | `app/styles/ops-tables.css`, `app/styles/shell.css` | delete both, after checking the two classes each that are still named elsewhere |
| F-UIS-05 | LOW | `.band-icon` (two rule blocks, one responsive) and `.pop-menu button.destructive:hover` in `system.css` match no element in any component | `app/styles/system.css:515`, `:1271`, `:2279` | delete, or use them |
| F-UIS-06 | LOW | `Row` writes `data-href` on every `<tr>`; no CSS rule and no script reads it. The comment beside it describes the stretched-link technique, which is done by `a.dt-link::after`, not by this attribute | `components/ui/table.tsx:41` | drop the attribute, or say what reads it |
| F-UIS-07 | LOW | The brief's "what must not change" list still names `journal-table.tsx` and `amount-explained-motion.tsx`; this branch reworked both, correctly, to close F-LU-02 and F-LU-03 and to move the explanation out of the clipping table cell. The list is stale, so a later reader cannot tell an authorised change from a slip | `docs/handoffs/ui-system-brief.md` | record the two exceptions in the brief or in `docs/DECISIONS.md`, naming the findings that required them |
| F-UIS-08 | LOW | `Toaster` announces each notice twice: the visible toast carries `role="alert"` or `role="status"`, and a hidden region below repeats the same text with `role="status"` | `components/ui/toast.tsx:44` and `:73` | keep the hidden region for the review scripts but drop its role, or drop the role from the visible toasts |

**On F-UIS-07, why it is LOW and not a broken contract.** The brief froze those two files to
protect three things, and I checked all three rather than the file list. The figures are identical
(section 3.5, 30 of 30). The tests still pass, including
`lib/money/amount-explained-motion.test.ts`, which asserts against the source of that file. The
reveal itself works: I clicked the figure on the endorsements view of CGP-01707 and the panel
opened in the top layer, printed "335 of 365 days remained" and the derivation ending on
$1,127.24, and closed on Escape, with no page error. The change is `details` to the native
`popover`, which is what the same handoff asked for when it said nothing may open inside a table
cell. What is missing is the paper trail, not the correctness.

---

## 6. Readability (READABLE-CODE.md)

**The reading path of the system is short and honest.** `app/styles/system.css` is 2,323 lines in
fifteen commented sections; `components/shell/app-shell.tsx` is 200 lines that draw a sidebar, a
band and a slot and call one reader; `lib/ui/views.ts` is 117 lines of pure functions with no
import beyond `URLSearchParams`, each with the reason it exists written above it. A reader who
opens `views.ts`, `app-shell.tsx` and `sections.tsx` in that order can predict what any screen
does with its URL.

**`lib/ledger/read.ts` is the best-documented file on the branch.** Every exported function has a
worked example in cents, and I verified those examples against the database: they are true, not
decorative. The one honest subtlety, that the running balance is the balance of the shown window
and not of the account, is written in capitals above the function and repeated under the column on
the screen.

**No opaque indirection found.** No dependency injection, no workflow engine, no generated
component, no metaprogramming. The folds are `<details>`, the menus and the explanations are the
native `popover` attribute, the charts are server-rendered SVG with a hidden table beside them for
a screen reader. `PopoverButton` and `PopoverPanel` are 23 lines together.

**No hidden side effect found.** The only effects on the branch are the two client components:
`Toaster` strips its own parameters from the address bar with `history.replaceState`, which it
says it does, and `SubmitButton` listens to its own form's `submit`. Neither writes anything.

**Dead code found:** F-UIS-01, F-UIS-04, F-UIS-05, F-UIS-06 above. It is small and inert.

**On the scoped stylesheets.** The assignment expected `console.css`, `money.css`,
`policy-detail.css`, `lists.css` and `landing.css` to duplicate rules now in `system.css`. **They
do not.** I compared the selector sets of all six files: zero selectors are shared with
`system.css` other than one `@media` breakpoint, and every class in those five files appears in a
component. The dead weight is elsewhere, in the two orphaned files of F-UIS-04.

**Writing rules.** No em dash and no en dash anywhere in the diff, app, components and docs
included (0 matches). No emoji. The sentences on screen are short, statuses are one-word chips,
money goes through `formatCentsAsUsd`, and the explanations sit in the closed `About` block at the
bottom of each screen. `shortDescription` in the ledger views cuts a long stored description at 52
characters and puts the whole of it in the expansion, which is the "no sentence in a table cell"
rule implemented rather than merely stated.

---

## 7. Checks executed, with results

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | **PASS**, no output |
| Tests | `npm test` | **PASS**, 490 pass, 0 fail, 1 skipped, 482 top-level assertions. The ten `lib/ledger/read.test.ts` cases and the seven `lib/ui/views.test.ts` cases ran and passed |
| Build | `npm run build` | **PASS**. Compiled successfully, 35 static pages generated, all 45 routes listed. Run on a `git archive` of `2af6ebe` in the scratchpad with a cloned `node_modules`, **not in the worktree**, so the dev server on 3010 that other agents are using was not clobbered. The only warning is the workspace-root lockfile notice, an artefact of the temporary location |
| Secrets | `gitleaks git --redact --no-banner --no-color --log-opts="main..HEAD"` | **PASS**, 16 commits, no leaks found |
| Tracked env files | `git ls-files \| grep -i env` | **PASS**, only `.env.example` |
| Dashes | `git diff main...HEAD \| grep -P "^\+.*[\x{2014}\x{2013}]"` | **PASS**, 0 matches |
| Scope | `git diff --stat main...HEAD -- lib db app/api scripts` | **PASS**, four allowed files |
| Forms | form inventory of every `.tsx` on both refs, diffed | **PASS**, no POST contract changed |
| Refusals, signed out | `curl -s -o /dev/null -w "%{http_code}"` on 11 protected paths | **PASS**, 307 on all; 404 on an unknown path |
| `loading.tsx` | `find app -name loading.tsx` | **PASS**, none |
| Guards above markup | script over the 33 changed `page.tsx` | **PASS**, 33 of 33 |
| Inbox counts | `npm run check:inbox-counts` | **PASS**, all checks passed, anchor by anchor. It took about twenty minutes: a second run from another worktree was in flight against the same disposable database. It was run **once** |
| Ledger against SQL | read-only `select` through `postgres` with the runtime role | **PASS**, six figures agree exactly |
| Screen sweep | Playwright, three roles, 41 paths including every view of the ledger, the console, the reconciliation, the statements and both policies | **PASS**, 41 of 41 answer 200, **zero** JavaScript errors, **zero** horizontal overflow at 1440 px |
| The explanation popover | Playwright click on the figure, then Escape | **PASS**, opens in the top layer, prints the derivation ending on $1,127.24, closes on Escape, no page error |
| AF-02 labels | `document.body.innerText` of 25 rendered screens | **PASS**, table in section 3.4 |
| The 30 figures | the same dumps, string by string | **PASS**, 30 of 30 |
| CSS duplication | selector-set comparison of the six stylesheets, and class-usage scan against all `.tsx` | **PASS** for duplication, two orphaned files found (F-UIS-04) |

---

## 8. Checks not executed, and why

- **The deployed application.** This branch is not deployed. AF-01 is a final-delivery gate and is
  **NOT RUN** for this scope. Everything above is local, against the worktree's own dev server.
- **375 px.** The assignment asked for the 1440 px evidence and the figures; I measured overflow at
  1440 px only. The phone width was the earlier audit's method and is **NOT RUN** here. F-UA-04's
  journal scroller was checked by reading the code and the rendered container, not by re-measuring
  at 375 px.
- **The MCP surface, the webhooks, the reconciliation job, the approval gate.** Untouched by this
  branch (`app/api` and `lib` outside the four files are byte-identical), so their reviews stand
  unchanged. **NOT RE-RUN**, deliberately.
- **No form was submitted and no money moved.** Every request was a GET except one
  `POST /api/session/login` per role. No approval was decided, no statement produced, no
  reconciliation run, no key revoked.
- **Cross-browser behaviour of the native popover and of CSS anchor positioning.** Measured in one
  Chromium headless shell only. A browser without `popover` support would render the explanation
  panels open rather than hidden; that is a degradation, not a loss, and it is **NOT MEASURED**.

---

## 9. Verdict and residual limitations

**PASS at `2af6ebe3156c66bae35f831cc1323aaedd6d854e`.**

The rework is a presentation change and behaves like one. The money code is untouched, the ledger
reader reads and only reads, every POST form keeps its contract, every refusal still fires before
any markup, the inbox anchors and their counts still agree, the AF-02 labels are visible without
opening anything on every screen that carries a Stripe or simulated record, and all thirty audited
figures print the values they printed before. The eight open findings are cleanup: dead files,
dead classes, a dead attribute, a swallowed error message, a misplaced import, a doubled screen
reader announcement and a stale line in the brief. None of them blocks a merge.

**Residual limitations, stated plainly.**

1. This verdict covers the commit named above. Fixer agents were expected to be editing files in
   this worktree while I worked; the tree was clean at the start and at the end, but any commit
   after `2af6ebe` is outside this record and needs a re-review.
2. A PASS here is not evidence for AF-01. Nothing on this branch has been seen on the deployed
   application.
3. I checked that the code can be read, not that Yoann can explain it. The walkthrough status is
   **NOT REVIEWED WITH YOANN**, and 15,535 added lines is a large amount of interface to defend
   line by line. The shell, the chart components and the ledger reader are the three places a
   reviewer is most likely to point at.
4. No legal or regulatory conclusion is drawn or implied. This is an engineering review of a
   presentation layer.
