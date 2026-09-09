# Independent review: the notification centre `/inbox` (B13-8, YOA-636) and the animated explanation (B12-4, YOA-637)

Two slices in one record, reviewed together because both are presentation over readers that
already existed and both make a claim about what the browser is allowed to do.

Reviewer: independent reviewer sub-agent, own worktree
`.claude/worktrees/agent-aa53cf08e765ee00e`, branch `worktree-agent-aa53cf08e765ee00e`.
Timestamp: 2026-09-09T10:05Z. Timebox: 60 minutes.

Reviewed revision: `db1762a` (main), working tree clean at review start.

| Slice | Merge inspected | Diff actually read |
|---|---|---|
| Inbox, YOA-636 | `d437280` of branch `worktree-agent-aa3782cb842727783`, plus the coordinator's `08f2493` | `d437280^1..d437280` (11 files, +1445/-38) and `08f2493^..08f2493` (2 files, +8/-3) |
| Animation, YOA-637 | `db1762a` of branch `worktree-agent-ab482eafeb852e526` | `db1762a^1..db1762a` (20 files, +978/-57) |

Deployed revision measured: `https://corgi-work-trial-iota.vercel.app`, `/api/health` returning
`{"ok":true,"database":"ok","revision":"db1762ac8f27da5e546038429e2467b60fd22ec0"}` at 10:00Z, so
the deployment carries the reviewed revision.

**Verdicts: inbox PASS with findings. Animation PASS with findings.**
**Candidate walkthrough status: NOT REVIEWED WITH YOANN.**

## Startup receipt

Read in full: `CLAUDE.md`, `AUTOMATIC-FAILS.md`, `READABLE-CODE.md`, `AGENTS.md`,
`WORKFLOW-48H.md`, `REVIEWER.md`, `docs/handoffs/b13-8-notes.md`, `docs/handoffs/b12-4-notes.md`,
`lib/inbox/read.ts`, `lib/inbox/sections.ts`, `lib/inbox/sections.test.ts`, `app/inbox/page.tsx`,
`components/portal-shell.tsx`, `components/what-needs-you.tsx`, `scripts/check-inbox-counts.ts`,
`components/amount-explained.tsx`, `components/amount-explained-motion.tsx`,
`lib/money/amount-explained-motion.test.ts`, `components/formula-lines.tsx`,
`components/journal-table.tsx`.

Read in the parts relevant to the scope: `docs/reviews/b12-explain.md` (the previous review of the
folds, in full for its measurement and fold-classification sections), `docs/reviews/FINDINGS.md`
(the F-B12 and F-B13 tails), `lib/money/explain.ts` (`runningSubtotals`, `explainAccountSum`,
`evidenceFromJournal`, `explainStatementTotal`, the `ExplanationEvidence` type),
`app/globals.css` (both new sections, read as diffs against `3e0b8ee^1` and `08f2493`),
`lib/policy/read.ts` and `lib/policy/change-requests.ts` (the changed count helpers, as diffs),
`app/policies/[policyId]/page.tsx` (the journal panel, the four ledger folds, the order of the
corrections section and the journal panel), `lib/policy/correction-read.ts` (`entriesOfCorrection`),
`app/login/page.tsx`, `README.md` (the inbox section added by `08f2493`).

Not read: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`,
`GAP-REVIEW.md`, `START-PROMPT.md`. No retained readiness control and no performance work applies
to two read-only presentation slices; no stress test was planned or run. `docs/PLAN.md`,
`docs/STATUS.md`, `docs/DECISIONS.md` and `docs/COMPLIANCE-MATRIX.md` were not opened: the
coordinator owns them and neither slice changes a requirement.

Absent files: none in scope. This worktree carries no `.env.local`, by design; the demo password
and the disposable-database URL were read from the main tree's ignored `.env.local` at run time and
are printed nowhere in this record.

## Applicability

Product and scope: Track 1 policy administration, sandbox only, USD integer cents. Both slices are
**presentation over readers that already existed**. Between them they add no table, no migration,
no column, no endpoint, no form, no field, no role check of their own and no write of any kind
(`grep -Ei "insert |update |delete |truncate"` over `lib/inbox/*`, `app/inbox/page.tsx` and
`scripts/check-inbox-counts.ts`: no match; `git diff --name-only d437280^1 db1762a | grep -i migrat`:
no match). Nothing is collected, transmitted or decided that was not collected, transmitted or
decided before, so no new question arises under FinCEN CIP/CDD, OFAC or CFPB product rules. The
applicable requirements are the trial's own and the repository's engineering safeguards: AF-01,
AF-03, AF-05, AF-06, `READABLE-CODE.md`, and the two invariants the slices themselves state ("every
count is the length of the list it points at", "the browser never computes money").

Confirmed facts: the deployed revision, the trial database contents seen through the deployed
screens, the `corgi_test` contents seen through the repository's own read-only script, the diffs.
Assumptions carried forward, not verified here: that the stored cancellation, endorsement and
statement figures were correct when they were computed (B4/B5/B7/B9 scope), and that the readers
the inbox borrows (`liveEndorsementRequest`, `correctionsOfPolicy`, `approvalRequests`,
`openBreaks`, `claimPayments`) answer correctly, which their own reviews established.

## Requirement matrix

### Slice 1, the inbox

| # | Requirement | Control / code location | Evidence | Verdict |
|---|---|---|---|---|
| 1 | Role check on the page; an anonymous visitor goes to `/login` | `app/inbox/page.tsx`, `currentUser()` then `redirect("/login")` | `GET /inbox` unauthenticated on the deployed revision: `307`, `location: /login`. Same with a query string trying to name a role and a broker | PASS |
| 2 | Ownership from the session, never from the URL | `sectionsFor(user)` takes `role`, `brokerId`, `customerId` from `SignedInUser`; the page passes no search parameter to it | no `searchParams` in `app/inbox/page.tsx`; every SQL literal in `lib/inbox/read.ts` is `user.brokerId` / `user.customerId`; `GET /inbox?role=staff_ops&brokerId=1` anonymous still `307 -> /login` | PASS |
| 3 | Every count equals the length of the list it points at | `countPoliciesPaidButNotBound`, `countEndorsementsPaidButNotApplied`, `countOpenChangeRequests` are now `.length` of their list reader | `npm run check:inbox-counts` on `corgi_test`, read-only, all PASS (table below). Production: staff 22 counted / 22 listed / 22 table rows | PASS |
| 4 | The changed count helpers give the same numbers as before | the three helpers above | old aggregate SQL run beside the new helper on `corgi_test`: 10/10, 35/35, and 8 brokers 1/1 or 2/2, all SAME; 0 rows dropped by the new joins | PASS |
| 5 | No new table, no write | none added | no migration in the range; no write verb in the new files; the check script is read-only and opens no transaction | PASS |
| 6 | Each row links to the exact object; the action is the existing one | `href` of every `InboxItem` in `lib/inbox/sections.ts` | the six shapes used are `/policies/{id}`, `/policies/{id}/endorsements/{eventId}/approve`, `/policies/{id}/corrections/{rebookEventId}/approve`, `/ops/approvals`, `/ops/claims/{id}`, `/ops/reconciliation`; all six route directories exist; no new action was created | PASS |
| 7 | An approver does not see the two operational lists | `staffSections`, `isApprover ? [] : facts.paidNotBound` and the same for `paidNotApplied` | on `corgi_test`: `staff_ops` 10 and 35, `staff_approver` 0 and 0 on the same two sections, with the sentence "Staff operations do this; it is not an approver's queue." | PASS |
| 8 | The anchors from the "what needs you" block land on the right section | `components/what-needs-you.tsx`, `href={/inbox#${task.section}}` | **fails for 4 of the broker's 5 task kinds, both of the customer's 2, and 1 of staff operations' 5**; measured on `corgi_test` | **FAIL, F-B13-15 and F-B13-16** |
| 9 | No money computed in the browser | `app/inbox/page.tsx` and `lib/inbox/*` are server components | no `"use client"` anywhere under `app/inbox` or `lib/inbox`; amounts arrive as integer cents and are formatted by `formatCentsAsUsd` on the server | PASS |
| AF-01 | Accessible deployed URL carrying the reviewed revision | Vercel | `/api/health` revision `db1762a`; four identities signed in; `/inbox` 200 for all four | PASS |
| AF-03 | No UPDATE or DELETE on money rows | the slice is read-only | see requirement 5 | PASS |
| AF-05 | No secrets committed | gitleaks 8.30.1 | `gitleaks detect --log-opts="d437280^1..db1762a"`: no leaks, 6 commits; working tree `--no-git`: no leaks, 4.75 MB. No secret printed in this record | PASS |
| AF-06 | The candidate can explain every line | see the readability section | technical only; walkthrough NOT REVIEWED WITH YOANN | see status |
| AF-02, AF-04 | Simulation labels, sandbox only | untouched | no provider call, no label changed | NOT APPLICABLE to this diff |

### Slice 2, the animated explanation

| # | Requirement | Control / code location | Evidence | Verdict |
|---|---|---|---|---|
| 1 | The browser never computes money: the count-up reads only the digits of the server-rendered text and writes that text back verbatim | `countUpResultCell` in `components/amount-explained-motion.tsx` | read line by line: `textFromServer = resultCell.dataset.finalAmount`, `digits = textFromServer.replace(/[^0-9]/g,"")`, one `Number(digits)`, last frame `resultCell.textContent = textFromServer`. `lib/money/amount-explained-motion.test.ts` asserts all of it against the source | PASS with F-B12-13 and F-B12-15 |
| 2 | `runningSubtotals` is server-side and returns null unless the lines add to the figure | `lib/money/explain.ts:89-105` | pure function, no clock, no database; `runningCents === resultLine.cents ? subtotals : null`; refuses fewer than two contributing lines. 5 unit tests including the tax and cancellation refusals | PASS |
| 3 | With JavaScript off the fold is the native `<details>`, every line visible, no dead control advertised | `enhanced` state; `data-reveal={enhanced ? revealStep : undefined}`; the hiding CSS is scoped to `[data-reveal]` | server HTML of the deployed revision: `role="button"` 0 occurrences and `data-reveal` 0 occurrences on CGP-01274, CGP-01707, claim `2f78c23c` and statement `c775c8ce` (counts include the embedded RSC payload, so the absence is total) | PASS |
| 4 | `prefers-reduced-motion` shows the finished state at once | the reduced branch of `runReveal` plus the `@media (prefers-reduced-motion: reduce)` block | held twice, read in both. Committed frame `reduced-0140ms.png` at 140 ms: reveal 4, both operands lit, result `$2,380.44`, no connector | PASS with F-B12-16 |
| 5 | No layout shift at rest | the figure keeps its element and box; the connector is a fixed SVG portalled to `<body>` with `pointer-events: none`; the reveal animates `opacity` and `transform` only | no `data-reveal` at rest; no `height`, `display` or `margin` in the reveal rules | PASS at rest; see F-B12-11 for a shift after the reveal |
| 6 | The connector targets an existing entry block id | `journalEntryElementId(entryId)`; `traceEntryId` is the first evidence entry carrying one | every `href="#journal-entry-…"` on the four screens resolves to a block present in the same HTML: 9/9 on CGP-01274, 5/5 on CGP-01707, 3/3 on the claim, 0 links on the statement (its evidence carries no `entryId`). 0 absent targets, 0 duplicate ids | PASS |
| 7 | The proving entry behind the journal's "show all" fold is reachable | `proveOnTheLedger` walks `parentElement` and opens every ancestor `<details>` | reachable with JavaScript. **6 of 9 targets on CGP-01274 and 5 of 5 on CGP-01707 are inside the show-all fold**, which the reveal opens unasked and never closes; without JavaScript the anchor lands inside a closed `<details>` | **F-B12-11, F-B12-12** |
| 8 | Keyboard reachable | the figure carries `tabIndex={0}` and Enter/Space with `preventDefault`; the `<summary>` stays a native control; "Trace to the ledger" is a real `<a href>` | read in the source; the two disclosure controls both work | PASS with F-B12-17 |
| 9 | The folds' figures are unchanged from the previous review | `components/amount-explained.tsx` only moved its output into props | recount on the deployed revision below: 14, 8, 3, 5 folds and 0 disagreement alerts, identical to `docs/reviews/b12-explain.md`; the hand-checked cents still print | PASS |
| AF-01 | Accessible deployed URL carrying the reviewed revision | Vercel | as above | PASS |
| AF-03 | No UPDATE or DELETE on money rows | presentation only | no write path in the diff; the client component touches one `textContent` and one `classList` | PASS |
| AF-05 | No secrets committed | gitleaks | same run as above, covering both merges | PASS |
| AF-06 | Readability of the client component | see the readability section | technical only; walkthrough NOT REVIEWED WITH YOANN | see status |

## Measurements

### The deployed application, four identities

`broker@example.com`, `customer@example.com`, `ops@example.com`, `approver@example.com`, demo
password read from the main tree's `.env.local` and never printed. All four logins returned `303`
with a session cookie. `GET /inbox` anonymous: `307 -> /login`.

| Identity | Sidebar badges | "What needs you" | `/inbox` heading | Sections that hold items | Table rows |
|---|---|---|---|---|---|
| broker | none | none | "nothing waiting" | 5 sections, all 0 | 0 |
| customer | none | none | "nothing waiting" | 2 sections, all 0 | 0 |
| ops | 22 -> `/inbox`, 22 -> `/inbox#reconciliation` | "22 open breaks…" -> `/inbox#reconciliation` | "22 waiting" | `#reconciliation` 22, four others 0 | 22 |
| approver | 22 -> `/inbox`, 22 -> `/inbox#reconciliation` | "22 open breaks…" -> `/inbox#reconciliation` | "22 waiting" | `#reconciliation` 22, four others 0 | 22 |

The badge, the block, the heading, the section chip and the number of table rows all say 22 for
both staff roles, and the one link that exists lands on the section that holds them. **The trial
database today carries exactly one kind of waiting work**, so the deployed data cannot exercise the
broker, the customer, or a staff role with several non-empty sections. Everything below about those
cases was measured on `corgi_test` instead.

### `corgi_test`, the repository's own check, run once, read-only

`npm run check:inbox-counts` (as `scripts/check-inbox-counts.ts`, through a helper that supplied the
environment; nothing was written and no transaction was opened):

```
PASS  broker Change request check broker user: 2 counted, 2 listed; policies 2/2
PASS  staff_approver: 1231 counted, 1231 listed; approvals 98/98, claims 32/32, reconciliation 1101/1101, policies 0/0
PASS  staff_ops:      1276 counted, 1276 listed; approvals 98/98, policies 45/45, claims 32/32, reconciliation 1101/1101
PASS  at least one broker and one staff user had work waiting
All inbox count checks passed.
```

### `corgi_test`, the anchors, section by section

The check above folds every inbox anchor onto its sidebar section before comparing, so it cannot
see where a chip lands. Reading the same two functions directly:

```
BROKER "Change request check broker user", 2 waiting
  what needs you:  2 change requests to answer            ->  /inbox#policies
  inbox sections:  0 Policies to pay                       at  #policies
                   0 Endorsement deltas to pay             at  #endorsement-deltas
                   0 Correction differences to collect     at  #correction-differences
                   2 Change requests to answer             at  #change-requests
                   0 Endorsement quotes waiting for the customer at #waiting-for-the-customer

STAFF_OPS
  what needs you:   99 money-out requests waiting for an approver -> /inbox#approvals
                    10 policies paid and not bound               -> /inbox#policies
                    35 endorsements paid and not in force        -> /inbox#policies
                    32 claims with a payment still to move       -> /inbox#claims
                  1101 open breaks                               -> /inbox#reconciliation
  inbox sections:   99 at #approvals, 10 at #policies, 35 at #endorsements,
                    32 at #claims, 1101 at #reconciliation

STAFF_APPROVER inbox sections: 99 at #approvals, 0 at #policies, 0 at #endorsements,
                    32 at #claims, 1101 at #reconciliation
```

The approver requirement holds: the two operational lists are empty for the approver and full for
staff operations, on the same data, in the same run. The anchor requirement does not: see F-B13-15
and F-B13-16.

### `corgi_test`, the three changed count helpers against their own previous SQL

The original aggregate queries were run beside the new "length of the list" helpers in one process:

| Helper | Old SQL | New helper | |
|---|---|---|---|
| `countPoliciesPaidButNotBound` | 10 | 10 | SAME |
| `countEndorsementsPaidButNotApplied` | 35 | 35 | SAME |
| `countOpenChangeRequests`, 8 brokers with work | 1, 2, 2, 1, 1, 2, 1, 1 | identical | SAME |

The new list forms add joins the aggregates did not have (`policies` and `customers` for the
policies, `policies` for the endorsements), so the rows those joins could drop were counted
directly: **0** `paid_not_bound` rows without a policy or a customer, **0** `endorsement_collections`
rows without a policy. The equality is not a coincidence of today's data.

### The deployed application, the folds

| Screen | Folds | Disagreement alerts | "Trace to the ledger" links | Journal entry blocks | Targets behind the show-all fold |
|---|---|---|---|---|---|
| CGP-01274, ops | 14 | 0 | 9 | 11 | 6 of 9 |
| CGP-01707, ops | 8 | 0 | 5 | 8 | 5 of 5 |
| Claim `2f78c23c`, ops | 3 | 0 | 3 | 3 | 0 of 3 |
| Statement `c775c8ce` (v2), ops | 5 | 0 | 0 | 0 | n/a |

The fold and alert counts are identical to `docs/reviews/b12-explain.md` (14, 8, 3, 5, all with 0
alerts), and the hand-checked cents of that review still print: CGP-01274 `5433`, `27870`,
`203330`, `4779`, `208109`, `30499`, `34680 - 30499` and `$41.81`; CGP-01707 `110136`, `2588`,
`112724`, `125320 + 112724`, `$2,380.44`, `18000 + 16520`, `120000 + 110136`; the claim `120000`,
`380000`, `500000`; the statement `86441` and `47506`. **The animation changed no figure.**

The new server-rendered `data-subtotal` strings are present and correct, for instance on CGP-01707
`$1,253.20 -> $2,380.44` for the collected fold, `$180.00 -> $345.20` for commission payable and
`$1,200.00 -> $2,301.36` for unearned premium: every one of them a `formatCentsAsUsd` call made on
the server.

### Checks executed

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | exit 0, no output |
| Unit tests | `npm test` | 455 tests, 454 pass, 1 skipped, 0 fail (the 8 of `lib/inbox/sections.test.ts` and the 11 of `lib/money/amount-explained-motion.test.ts` among them) |
| Count agreement | `scripts/check-inbox-counts.ts` on `corgi_test`, once, read-only | all PASS, output above |
| Count-helper equivalence | old aggregate SQL beside the new helpers on `corgi_test`, read-only | all SAME, 0 rows dropped |
| Secrets, both merges | `gitleaks detect --log-opts="d437280^1..db1762a"` | no leaks found, 6 commits, 110 KB |
| Secrets, working tree | `gitleaks detect --no-git --redact` | no leaks found, 4.75 MB |
| Deployed revision | `GET /api/health` | `db1762ac8f27da5e546038429e2467b60fd22ec0` |
| Deployed screens | 14 authenticated fetches across four identities, plus 2 anonymous | all as expected; 307 for the anonymous inbox |
| Evidence frames | read `motion-0560ms.png`, `motion-1400ms.png` | the reveal, the mid count-up and the connector are as described, with one discrepancy, F-B12-14 |

### Checks not executed, and why

- **No browser.** This worktree has no Playwright, no Puppeteer and no browser tool, so the
  animation was **never run**. I did not see the count-up move, the connector draw, or what happens
  on CGP-01274's "Unearned premium, refunded" fold or on a fold whose entry is behind the show-all
  fold. Everything about the animation here comes from reading the client component line by line,
  from the server HTML of the deployed revision, and from the twelve committed frames in
  `docs/evidence/b12-4/`, which the builder states were captured on a **fixture page, not on real
  trial data**. F-B12-11, F-B12-12 and F-B12-17 are code-reading findings measured against real
  page structure, not observed on a screen.
- **No writing check script**, by instruction. `check-money-guards` was not run, by instruction.
- **No `npm run build`.** Types and tests were run instead; the builders recorded passing builds.
- **The broker and customer inboxes were never seen with items on the deployed application.** The
  trial database carries no waiting broker or customer work today. Those paths were exercised on
  `corgi_test` only.
- **No correction is present on any deployed policy** (`aria-label="Correction entries"`: 0
  occurrences on CGP-01274), so F-B12-18 is a code-reading finding, not an observation.
- **The correctness of the underlying figures** (cancellation, endorsement, statement, claim
  position) is out of scope: already reviewed in B4/B5/B7/B9/B12-2.

## Findings

### F-B13-15, MEDIUM: a "what needs you" item lands on a section that is not the one it counted

**Trigger.** `components/what-needs-you.tsx`, in `WhatNeedsYou`:
`<Link href={`/inbox#${task.section}`}>`. `task.section` is one of the four names the **sidebar**
knows (`policies`, `claims`, `approvals`, `reconciliation`), while the inbox splits those into ten
anchors. Every broker task and every customer task carries `section: "policies"`.

**Measured on `corgi_test`.** A broker with 2 open change requests sees "**2** change requests to
answer" linking to `/inbox#policies`, and `#policies` is "Policies to pay", which holds **0** items
and prints "No policy of yours is waiting for a payment." The 2 requests are three panels lower, at
`#change-requests`.

**Consequence.** This is the complaint the slice exists to answer, on the exact block commit
`08f2493` changed: the reader clicks a number and arrives at an empty list. It bites 4 of the
broker's 5 task kinds (deltas, correction differences, quotes waiting for the customer, change
requests) and both of the customer's 2 ("corrections waiting for your approval" lands on
"Endorsements waiting for your approval"). The sidebar chip has the same shape, but there it adds
several sections into one number and the handoff discloses it; the per-item block names a specific
count and a specific kind of work, so landing on a different section with a different chip is a
contradiction the reader can see.

**Correction.** Carry the inbox anchor on the task rather than the sidebar section: add
`anchor: string` to `WorkspaceTask`, set it beside each `label` (they are already written one for
one against the inbox sections), and use it in the link. The sidebar keeps `section` for its
aggregate chip. `lib/inbox/sections.ts` needs no change.

### F-B13-16, LOW: staff operations' "endorsements paid and not in force" lands on the policies section

**Trigger.** Same line as F-B13-15. `paidNotApplied` is declared `section: "policies"` in
`staffTasks`, but the inbox lists it at `#endorsements`.

**Measured on `corgi_test`.** "**35** endorsements paid and not in force" links to
`/inbox#policies`, which is "Policies paid and not bound" with **10** items. The right section is
immediately below, so the reader recovers by scrolling one panel, which is why this is LOW and
F-B13-15 is MEDIUM: there the right section is three panels away and the landing section is empty.

**Correction.** The same one.

### F-B13-17, LOW: the count check cannot see F-B13-15 or F-B13-16

**Trigger.** `scripts/check-inbox-counts.ts`, `SIDEBAR_SECTION_OF_ANCHOR`: the script folds
`endorsement-deltas`, `correction-differences`, `change-requests`, `waiting-for-the-customer`,
`corrections` and `endorsements` onto `policies` before comparing. The two sides are then equal by
construction whenever the totals are.

**Consequence.** The script proves the promise it names ("the number and the list say the same
thing") but not the promise the slice actually makes to the reader ("a chip lands on the section
that holds the items it counted"). It reported PASS on the same data on which F-B13-15 is visible.
Two lesser limits, both documented in the script's own comments: it stops at the first broker with
work (8 brokers on `corgi_test` have open change requests) and compares one user per staff role.

**Correction.** Compare anchor by anchor: for each task, assert that the inbox section whose anchor
the link carries holds at least the items that task counted. Cheap, and it would have caught both
findings above.

### F-B13-18, LOW: a bare `catch {}` turns any failure into "this policy could not be read"

**Trigger.** `lib/inbox/read.ts`, `readBrokerPolicies` and `readCustomerPolicies`: the whole
per-policy body sits in `try { … } catch { unreadablePolicyNumbers.push(…) }`.

**Consequence.** The intent is right and better than what `workspaceTasks` does (its single catch
empties the whole role's badge). But the catch is not narrowed to the failure it was written for
(an old `correction_rebook` payload the reader refuses). A dropped connection, a timeout or a
programming error inside `liveEndorsementRequest` or `correctionsOfPolicy` is presented to the
reader as a defective policy, the items of that policy vanish from the inbox, and the operator is
told to "open the policy itself to see why" when the fault is not the policy's.
`READABLE-CODE.md` names broad catches that hide the failure path explicitly.

**Correction.** Catch the reader's own refusal (its error type or a sentinel it throws), rethrow
anything else, and let the page's error boundary do its job. At minimum, print the class of failure
next to the policy number.

### F-B13-19, LOW: the check script needs more than the one variable it documents

**Trigger.** `scripts/check-inbox-counts.ts` states that `DATABASE_URL_TEST_APP` must be set. Its
import graph reaches `lib/policy/correction-read.ts` -> `lib/payments/refunds.ts` -> `lib/stripe.ts`,
which throws at module load without `STRIPE_SECRET_KEY`.

**Measured.** In this worktree, with only the documented variable set: `Error: STRIPE_SECRET_KEY
must be set at lib/stripe.ts:10`. It passes once the rest of the environment is supplied.

**Consequence.** A reviewer following the script's own header cannot run it. No security
consequence; the Stripe client is only constructed, never called.

**Correction.** Say in the header that the script needs the full local environment, as the other
`check:*` scripts do.

### F-B13-20, LOW: the "endorsements paid and not in force" list is in uuid order

**Trigger.** `lib/policy/read.ts`, `endorsementsPaidButNotApplied`: `distinct on
(link.request_event_id)` forces `order by link.request_event_id, paid.recorded_at`.

**Consequence.** That order reaches the screen. The inbox prints a "Paid" column for this section
and the rows are sorted by a uuid, so the oldest piece of work is in a random place, while every
other section is ordered by age. On `corgi_test` that is 35 rows.

**Correction.** Wrap the `distinct on` in a subquery and order the outer select by `paid_at`.

### F-B12-11, MEDIUM: finishing a reveal opens the journal's "show all" fold unasked, and draws the connector off-screen

**Trigger.** `components/amount-explained-motion.tsx`: step 4 of `runReveal` schedules
`later(() => proveOnTheLedger(false), COUNT_UP_MS)`, and `proveOnTheLedger` walks the target's
ancestors setting `ancestor.open = true` on every `HTMLDetailsElement` before drawing. With
`scrollFirst === false` it does **not** scroll.

**Measured on the deployed revision.** 5 of 5 trace targets on CGP-01707 and 6 of 9 on CGP-01274
sit inside `<details class="show-all">`. So on CGP-01707 opening **any** amount fold with a
connector expands the whole policy journal (4 further entry blocks appear) under the reader,
without being asked, roughly a second after the click; `closeReveal` never puts it back. The
connector is then drawn from the figure to a block that is almost certainly outside the viewport,
which is a curve running off the bottom of a `position: fixed` overlay.

**Consequence.** An unrequested layout change on a money screen, and a "proof" the reader cannot
see. The slice's own promise is that the page does not move; it holds at rest and inside the panel,
and breaks here.

**Correction.** Open ancestor folds only from the explicit "Trace to the ledger" click (pass the
same `scrollFirst` flag to the ancestor walk). For the automatic connector, measure the target
first and skip the drawing when it is not in the viewport, or scroll it into view deliberately
rather than as a side effect.

### F-B12-12, LOW: the no-JavaScript claim for "Trace to the ledger" is not established

**Trigger.** The handoff states that "Trace to the ledger" "is a plain `<a href="#journal-entry-…">`:
it jumps to the entry with no JavaScript at all."

**Measured.** On the deployed revision the target is inside a **closed** `<details>` for 5 of 5
links on CGP-01707 and 6 of 9 on CGP-01274. Whether a fragment navigation reveals content inside a
closed `<details>` depends on the browser's support for auto-expanding details, which **I could not
verify: no browser is available in this worktree**. The claim is therefore unverified, not refuted.

**Consequence.** If a browser does not auto-expand, the reader with JavaScript off is scrolled to
a fold header and shown nothing. The link is not dead, but it is not the guarantee the note gives.

**Correction.** Either verify the behaviour in the browsers the demo will use and say which, or
soften the note to "jumps to the entry, and to the fold that contains it on browsers that expand a
`<details>` for a fragment target". A third option that removes the question: render the trace link
`href` at the fold that contains the entry when the entry is folded.

### F-B12-13, LOW: the count-up prints money-shaped strings that are not the figure

**Trigger.** `countUpResultCell`: `Math.floor(digitsAsNumber * eased)`, padded to the original digit
count and re-inserted into the server's text by `replaceDigits`.

**Measured.** Committed frame `docs/evidence/b12-4/motion-0560ms.png` shows the Result cell reading
`$0,441.94` while the Running total beside it already reads `$2,380.44` and the figure above the
fold reads `$2,380.44`: **three amounts on screen at once, one of which is not a figure of this
business**, for up to 600 ms.

**Consequence.** The invariant that matters holds and I verified it: nothing is persisted, nothing
is decided, no money helper is imported, the last frame is `resultCell.textContent = textFromServer`
verbatim, and the test asserts every one of those against the source. But "the browser never
computes money" (handoff, component header) and "the client component computes no money" (the test
suite's own name) overstate it: the browser multiplies the figure's digits by a float, floors the
product and prints the result in a currency format. On an AF-06 walkthrough that sentence is the
one a reviewer will point at.

**Correction.** Reword the claim to what is true and provable: "the browser never produces a money
value that anything reads back; the only number it computes is a drawing position, and the frame it
stops on is the server's own string". Or remove the arithmetic entirely by stepping through the
server's `data-subtotal` strings instead of interpolating digits.

### F-B12-14, LOW: the handoff's frame table disagrees with its own committed frame

**Trigger.** `docs/handoffs/b12-4-notes.md` records `$0,609.18` in the result cell at 560 ms.
`docs/evidence/b12-4/motion-0560ms.png`, the frame of that row, shows `$0,441.94`.

**Consequence.** Small, but it is evidence describing evidence, and the trial's rules are explicit
that recorded results must be the ones actually observed. A reader who opens the frame finds the
table wrong.

**Correction.** Recapture or recopy the row from the frames actually committed, or say that the
table and the frames come from different runs.

### F-B12-15, LOW: the count-up's fallback would make a wrong amount stick

**Trigger.** `const textFromServer = resultCell.dataset.finalAmount ?? resultCell.textContent ?? "";`
and, in `closeReveal`, `if (resultCell?.dataset.finalAmount) resultCell.textContent = …`.

**Consequence.** Dead today: `FormulaLinesTable` writes `data-final-amount` on every amount cell, and
I confirmed the attribute is present on the deployed revision. But if a future table ever omitted
it, `closeReveal` would restore nothing and the next open would read a **mid-animation frame** as
"the server's text", making a wrong amount the permanent content of a money cell. A fallback that
silently degrades a money display is the wrong default.

**Correction.** `const textFromServer = resultCell.dataset.finalAmount; if (!textFromServer) return;`
Refuse to animate a cell that does not carry the server's own string.

### F-B12-16, LOW: under reduced motion the proving entry is never marked

**Trigger.** The reduced branch of `runReveal` returns before scheduling step 4, so
`proveOnTheLedger` is never called at all; the entry is marked only if the reader clicks "Trace to
the ledger".

**Consequence.** The handoff says that under reduced motion "the proving entry is marked with a
plain colour instead of a pulse". The code and the committed frames (`reduced-1400ms.png`, and the
builder's own table row "reduced, 140 ms … proving entry 0") say it is not marked. The behaviour is
arguably the better one; the note is wrong about it.

**Correction.** Correct the note, or mark the entry with the flat colour the CSS already provides
for that case.

### F-B12-17, LOW: invisible reveal steps stay in the tab order

**Trigger.** `.amount-explain-panel[data-reveal] .reveal-step { opacity: 0 }`. Opacity hides, it
does not remove from the tab order.

**Consequence.** For the ~480 ms of the build, "Trace to the ledger", the evidence table and the two
`tabIndex={0}` scroll regions are focusable and clickable while invisible. A keyboard reader who
tabs immediately after opening the fold is moved to controls nobody can see; a click in that region
can land on the trace link.

**Correction.** Add `visibility: hidden` alongside the `opacity: 0` (the transition already animates
opacity, and `visibility` transitions discretely), or mark a step that has not arrived `inert`.

### F-B12-18, LOW: a corrected policy would render two blocks with the same id

**Trigger.** `app/policies/[policyId]/page.tsx` renders `CorrectionsExplained` (line 900), whose
`JournalTable` prints the correction's reversal and rebook entries, **before** the policy journal
(line 910), which prints the same entries again. Both blocks get
`id={journalEntryElementId(entry.entryId)}`, and `entriesOfCorrection` reads them from the same
`journal_entries` table as the policy journal.

**Consequence.** Duplicate DOM ids, which are invalid HTML, and `document.getElementById` returns
the first in document order: the connector and the trace link would land on the corrections
section's copy rather than the journal's. Not reachable on today's trial data (none of the four
deployed policies carries a correction (`aria-label="Correction entries"`: 0 occurrences on
CGP-01274), so this is a code-reading finding, of the same class as F-B12-03.

**Correction.** Give the second table a prefix (`journalEntryElementId(entryId, "correction")`), or
have the correction section reuse the journal's anchors instead of re-rendering the blocks.

## Readability, AF-06

**The inbox.** The reading path is short and it is the one the handoff advertises:
`app/inbox/page.tsx` prints, `lib/inbox/read.ts` reads, `lib/inbox/sections.ts` groups. The split
is worth its cost: the grouping carries every business sentence and every rule about who does what,
it has no database and no framework in it, and its 8 tests read like a specification. Names are
explicit and carry units (`totalChargeCents`, `deltaTotalCents`, `firstSeenAt`, `quotedAt`).
Deciding that a count is `.length` of the list beside it is the right call and it is the one thing a
reviewer would otherwise have had to check by hand forever. Two things Yoann should be able to
explain unprompted at a debrief: why `readCorrections` asks two different questions of the same
reader (`to_approve` versus `to_collect`, and why a `settlement` that is not "collect" is nobody's
work), and why the N+1 loop is deliberate rather than an oversight. F-B13-18 is the one readability
defect: a bare `catch` is the pattern `READABLE-CODE.md` names.

**The client component.** 346 lines, one file, one responsibility, and the rule it exists to obey is
stated at the top and then enforced by tests against its own source, which is an unusually honest
way to hold a claim. `later`/`stopEverything` is a small, readable timer ledger. The three parts a
reviewer will point at are `replaceDigits` (why swapping digits one for one keeps the width and
therefore the row still), the easing line (`1 - Math.pow(1 - progress, 3)`, a position and not an
amount), and the ancestor walk in `proveOnTheLedger`. All three are explainable in a sentence each,
and Yoann should have those sentences ready. The overstated headline is F-B12-13; it is a wording
problem, not a code problem. `runningSubtotals` is 17 lines, pure, and refuses rather than guesses:
that is the right shape for money code.

Neither slice adds an opaque financial formula, a generic abstraction, a hidden side effect in a
helper with a misleading name, or a float in a money path.

## Verdicts

**Inbox (YOA-636, merges `d437280` and `08f2493`): PASS**, with one MEDIUM and five LOW findings.
Everything that had to be true of the money and the permissions is true and was measured: the page
refuses an anonymous visitor, ownership comes only from the session, no table, no write, no
migration, the three rewritten count helpers give the numbers their predecessors gave on real data
with no rows dropped by the new joins, an approver does not see the operational lists, every link
goes to an object and an action that already existed, and nothing is computed in the browser.
F-B13-15 does not block: it is a link target, it changes no state, it hides no work (the item is on
the same page, in a named section), and the fix is one field on a type. It should be fixed before
submission because it reproduces the exact complaint the slice was built to answer.

**Animated explanation (YOA-637, merge `db1762a`): PASS**, with one MEDIUM and seven LOW findings.
The rule the slice rests on holds where it matters: the server renders every string, the client
component imports no money code, the single `Number(` call reads the digits of the server's own
text, the last frame is that text put back verbatim, `runningSubtotals` refuses rather than invent a
ticker, the folds' figures are byte-for-byte the ones the previous review measured, and the
server-rendered HTML advertises no control that JavaScript is needed to use. F-B12-11 is the one
worth fixing before a demo: on the deployed data most connectors point behind the journal's show-all
fold, so opening an amount fold expands the journal unasked and then draws to something off-screen,
which is precisely the case the builder asked a reviewer to look at.

## Residual limitations

- **The animation was never run.** No browser tool exists in this worktree. Every statement about
  it comes from the source, the deployed server HTML and the committed frames, and those frames
  were captured on a fixture page rather than on trial data. The two things the builder asked to be
  checked on a screen, CGP-01274's "Unearned premium, refunded" fold, and a fold whose entry is
  behind the show-all fold, were checked structurally (the target exists, it is behind the fold,
  the code opens the fold) and **not visually**. A five-minute run in a real browser on CGP-01707
  would settle F-B12-11, F-B12-12 and F-B12-17 at once.
- **The deployed data cannot exercise the inbox.** Only 22 open breaks are waiting today, for the
  two staff roles. The broker sections, the customer sections and any staff role with several
  non-empty sections were measured on `corgi_test` only.
- **No correction exists on a deployed policy**, so F-B12-18 was not observed.
- The count-agreement evidence is one run of the repository's own script plus one direct read; the
  script compares one broker and one user per staff role.
- Nothing here is a legal certification, and a technical PASS on two presentation slices says
  nothing about the correctness of the figures they display, which other reviews cover.

## Register lines

| ID | Sev | Finding (one line) | Fix | Status |
|---|---|---|---|---|
| F-B13-15 | MEDIUM | A "what needs you" item links to `/inbox#<sidebar section>`, not the inbox anchor: a broker's "2 change requests to answer" lands on "Policies to pay", which is empty (measured on corgi_test) | Carry the inbox anchor on `WorkspaceTask` and link to it | OPEN |
| F-B13-16 | LOW | Staff operations' "35 endorsements paid and not in force" lands on "Policies paid and not bound" (10 items); the right section is one panel below | Same fix as F-B13-15 | OPEN |
| F-B13-17 | LOW | `check-inbox-counts` folds every anchor onto its sidebar section, so it cannot detect F-B13-15/16, and it stops at the first broker with work | Compare anchor by anchor | OPEN |
| F-B13-18 | LOW | A bare `catch {}` in `readBrokerPolicies`/`readCustomerPolicies` reports any failure, including a dropped connection, as an unreadable policy and drops its items | Catch the reader's own refusal, rethrow the rest | OPEN |
| F-B13-19 | LOW | `check-inbox-counts` documents only `DATABASE_URL_TEST_APP` but its import graph needs `STRIPE_SECRET_KEY` (measured: it throws without it) | Say the script needs the full local environment | OPEN |
| F-B13-20 | LOW | `endorsementsPaidButNotApplied` orders by request-event uuid, so that inbox section is in random order while every other one is by age | Wrap the `distinct on` and order the outer select by `paid_at` | OPEN |
| F-B12-11 | MEDIUM | Every reveal ends by opening the journal's show-all fold unasked and never closing it, then draws the connector to an off-screen block; 5 of 5 targets on CGP-01707 and 6 of 9 on CGP-01274 are behind that fold | Open ancestor folds only from the explicit trace click; skip the connector when the target is outside the viewport | OPEN |
| F-B12-12 | LOW | The "jumps to the entry with no JavaScript at all" claim is unverified: most targets sit inside a closed `<details>` and no browser was available to test auto-expansion | Verify in the demo browsers, or soften the note | OPEN |
| F-B12-13 | LOW | The count-up prints money-shaped strings that are not the figure (`$0,441.94` under `$2,380.44` in the committed 560 ms frame); "the browser never computes money" overstates what is true | Reword to the provable claim, or step through the server's `data-subtotal` strings | OPEN |
| F-B12-14 | LOW | The handoff's frame table records `$0,609.18` at 560 ms; its own committed frame shows `$0,441.94` | Recopy the row from the frames actually committed | OPEN |
| F-B12-15 | LOW | `countUpResultCell` falls back to `textContent` when `data-final-amount` is missing; a mid-animation frame would then become the cell's permanent text | Refuse to animate a cell with no `data-final-amount` | OPEN |
| F-B12-16 | LOW | Under reduced motion the proving entry is never marked at all; the handoff says it is marked with a plain colour | Correct the note, or mark it | OPEN |
| F-B12-17 | LOW | Reveal steps hidden with `opacity: 0` stay focusable and clickable for the ~480 ms of the build | Add `visibility: hidden`, or `inert` on a step that has not arrived | OPEN |
| F-B12-18 | LOW | A corrected policy renders the correction entries twice, so two blocks share one `journal-entry-<id>`; the connector would land on the corrections copy (not reachable on today's data) | Prefix the second table's ids, or reuse the journal's anchors | OPEN |
