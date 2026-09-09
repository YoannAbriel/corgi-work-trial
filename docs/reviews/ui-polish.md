# Independent review: interface polish merged into main

Reviewer: independent Claude sub-agent assigned by the coordinator. I did not write any of this
code and I did not see it before the merge. Review performed 2026-09-08, roughly 19:05Z to 20:05Z (21:05 to 22:05 Europe/Zurich; an earlier revision of this header carried the local time with a Z suffix, corrected 2026-09-09T08:20Z),
in my own git worktree.

Reviewed revision: merge `c5bcf2aeb6091713250fac73ceb04060fef834be`, parents `2755d11` (main) and
`d886a4f` (branch `worktree-agent-ac8c2ce5122970811`), merge base `5f2c841`. Scope: the diff
`2755d11..c5bcf2a`, 29 files, 1753 insertions and 354 deletions, under `app/`, `components/`, five
`lib/**/read.ts` files and `docs/handoffs/ui-polish-notes.md`.

Deployed revision measured: `/api/health` reported `c5bcf2aeb6091713250fac73ceb04060fef834be` from
the first request of this review to the last, so every production measurement below is against the
reviewed merge itself, with no intervening deployment.

Verdict: **PASS** for the interface-polish scope, with F-UI-12 (MEDIUM) as a required correction
before submission and seven LOW findings. Candidate walkthrough status: **NOT REVIEWED WITH YOANN**.

A follow-up commit, `41be7fc` ("primary action forms open on arrival instead of folded, F-YA-05"),
landed on main during this review and was deployed before I finished. It is reviewed in the
re-review section at the end: **PASS maintained for `c5bcf2a` plus `41be7fc`**, with two further LOW
findings (F-UI-20, F-UI-21). Sections 1 to 5 below describe `c5bcf2a`; every production measurement
in them was taken while `/api/health` reported `c5bcf2a`, and every one was repeated on `41be7fc`
with identical results.

## Startup receipt

Actually read in full, in this order: `CLAUDE.md`; `AUTOMATIC-FAILS.md` (AF-01 to AF-06);
`READABLE-CODE.md`; `AGENTS.md`; `WORKFLOW-48H.md`; `REVIEWER.md`; `docs/reviews/ui-main-merge.md`
(the previous interface review, PASS with F-UI-02 open and F-UI-11 raised by Yoann);
`docs/reviews/FINDINGS.md` (the whole register, read closely for F-YA-01 to F-YA-04 and F-UI-01 to
F-UI-11); `docs/handoffs/ui-polish-notes.md`. Read in the parts relevant to a check I ran:
`lib/money/cents.ts`, `lib/payments/refund-state.ts`, `lib/policy/read.ts`,
`lib/policy/endorsement-requests.ts`, `lib/reconciliation/read.ts`, `db/client.ts`,
`app/api/session/login/route.ts`, `lib/auth/session.ts`, and the full text of the 29 changed files
through the diff.

No mandatory kit file was missing. Next acceptance criterion for this review: the polish changes
presentation only; the badge counts agree with the database for each role and never break a page;
the money field submits what the server parser expects; every guard still runs before rendering;
the automatic-fail labels and the sandbox evidence survive.

Not authorised and not performed: any write to any database, any check script (no
`check-money-guards`, no other `check:*`), any Stripe or provider call, any push, any deployment,
any edit of STATUS, PLAN, FINDINGS, COMPLIANCE-MATRIX, DECISIONS or README. My only repository
write is this file, committed on my own worktree branch. Reads of `corgi_test` and of the trial
database were made with the restricted `DATABASE_URL_APP` runtime role and are `select` only.

## 1. Business logic untouched

`git diff 2755d11 c5bcf2a --stat -- lib db scripts app/api vercel.json next.config.ts package.json
package-lock.json` returns exactly five files, 133 insertions, zero deletions:

| File | Added |
|---|---|
| `lib/approvals/read.ts` (new) | 23 |
| `lib/claims/read.ts` | 25 |
| `lib/policy/endorsement-read.ts` | 32 |
| `lib/policy/read.ts` | 37 |
| `lib/reconciliation/read.ts` | 16 |

Nothing under `db`, `scripts`, `app/api`, `vercel.json`, `next.config.ts`, `package.json` or
`package-lock.json` changed. No new dependency. The STATUS-level claim in the handoff note is
accurate.

I read all 133 added lines. Every one of the six new functions is a single `select` returning a
`count`. There is no `insert`, `update`, `delete`, `upsert`, `truncate`, `alter` or `create` in the
diff, and no transaction is opened. `countOpenBreaks` interpolates two module constants through
`database.unsafe`; both (`LATEST_REPORT_OF_EACH_BREAK`, `A_LATER_RUN_RE_EXAMINED_IT`,
`lib/reconciliation/read.ts:134` and `:150`) are fixed string literals declared in the same file and
already used the same way by the two pre-existing queries, so no caller-supplied value reaches
`unsafe`. Every other value crosses as a parameter. AF-03 is not touched by this diff.

### Form contracts

I wrote my own extractor (in my scratch directory, not in the repository) that walks every `.ts` and
`.tsx` file under `app/` and `components/` in both revisions and records, for every `form`, `input`,
`select`, `option`, `textarea`, `button` and `MoneyAmountInput`, the attributes that define the
server contract: `action`, `method`, `name`, `value`, `defaultValue`, `type`, `required`,
`disabled`, `checked`, `defaultChecked`, `min`, `max`, `step`, `minLength`, `maxLength`, `pattern`,
`multiple`, `readOnly`, `encType`. 167 entries at `2755d11`, 168 at `c5bcf2a`. The entire difference
is the eight money fields:

| Before | After |
|---|---|
| `<input name="annualPremium" required>` and seven siblings (`perOccurrenceLimit`, `aggregateLimit`, `newAnnualPremium`, `newPerOccurrenceLimit`, `newAggregateLimit`, `reserveAmount`, `paymentAmount`) | `<MoneyAmountInput name=… required>` with the same name and the same `required`, rendering `<input name={name} required={required}>` |

`inputMode="decimal"` is preserved inside the component, no `type` was added or removed, no hidden
field was added, and the three `defaultValue` expressions are unchanged and still evaluated in the
server component. Every other form action, method, field name, submitted value, version field and
numeric constraint is byte-identical: the extractor reports no other line. The only visible change
is placeholder text (`1200.00` to `1,200.00`) and a new `aria-describedby` pointing at the echo.

### Server-side role, ownership and uuid guards

I extracted every line in `app/**` matching `currentUser(`, `redirect(`, `notFound(`, `.role`,
`brokerId`, `customerId` or `isUuid` in both revisions, stripped line numbers and sorted. 244 lines
before, 244 after. The complete difference is three prose lines: one sentence rewrapped on
`app/ops/approvals/page.tsx` and one sentence moved between two paragraphs on
`app/ops/claims/page.tsx`. **No guard line was added, removed, moved past a read or altered.**

The one gate that was restructured is on the claim page, and it is equivalent: the four action forms
were wrapped in a single `{canAct ? … : null}` (`app/ops/claims/[claimId]/page.tsx:162`,
`canAct = user.role === "staff_ops" && !claim.position.isClosed` at `:71`, unchanged), and the close
form keeps its own `claim.position.reserveCents === 0 && claim.pendingCents === 0` condition nested
inside it (`:209`). Same effective condition, and the server rechecks it regardless.

`PortalShell` became `async` and now reads the counts itself. It reads nothing when there is no
signed-in user: `components/portal-shell.tsx:52`, `tasks ?? (user ? await workspaceTasks(user) : [])`.
An anonymous request therefore still reaches its `redirect()` without a query.

### No money computed in the browser

Three files carry `"use client"` in the whole application: `app/error.tsx` and
`components/portal-frame.tsx` (both pre-existing) and the new `components/money-amount-input.tsx`.
The new one imports only `useState`. It contains no `toFixed`, no `Intl.NumberFormat`, no
`formatCentsAsUsd`, no multiplication or division, and reads no amount from the database: its four
helpers insert commas, truncate to two decimals, count digits and place the caret. The three
`defaultValue={(policy.xCents / 100).toFixed(2)}` expressions are evaluated in the server component
and cross the boundary as strings, exactly as they did before. Everything the application displays
still goes through `formatCentsAsUsd` on the server.

**What the field submits, and what the server makes of it.** I copied `groupThousands` and `echoOf`
verbatim out of the component (they are not exported) and ran them against the real
`parseUsdAmountToCents` and `formatCentsAsUsd`:

| Typed | Field submits | Echo | Server at `2755d11` | Server at `c5bcf2a` |
|---|---|---|---|---|
| `1,200.00` | `1,200.00` | = $1,200.00 | 120000 cents | 120000 cents |
| `1200` | `1,200` | = $1,200.00 | 120000 cents | 120000 cents |
| `1200.50` | `1,200.50` | = $1,200.50 | 120050 cents | 120050 cents |
| `$1,200.50` | `1,200.50` | = $1,200.50 | 120050 cents | 120050 cents |
| `2,000,000` | `2,000,000` | = $2,000,000.00 | 200000000 cents | 200000000 cents |
| `0.05` | `0.05` | = $0.05 | 5 cents | 5 cents |
| `.50`, `12.`, `abc` | `.50`, `12.`, `` | hint, no amount | REFUSED | REFUSED |
| `1 200,50` | `120,050` | = $120,050.00 | **REFUSED** | **12005000 cents** |
| `12.345` | `12.34` | = $12.34 | **REFUSED** | **1234 cents** |
| `1.2.3` | `1.23` | = $1.23 | **REFUSED** | **123 cents** |
| `-5` | `5` | = $5.00 | **REFUSED** | **500 cents** |
| `1e3` | `13` | = $13.00 | **REFUSED** | **1300 cents** |
| `007` | `007` | = $007.00 | 700 cents | 700 cents |

The two the assignment names are correct: `1,200.00` and `1200` both reach the server as
$1,200.00. The five bold rows are F-UI-12.

## 2. The "what needs you" counts

The counts are read on the server in `components/what-needs-you.tsx`, once per page through
`PortalShell`, and passed in by `/ops`, `/broker` and `/customer` so their home page does not read
them twice. Staff counts are global (correct: staff see the whole book); the broker and customer
counts are scoped by `brokerId` or `customerId` in the SQL, so no count crosses a tenant.

### Against my own SQL

I wrote my own version of each count, from the described rule rather than by copying theirs
(`not exists` where they use a `left join`, my own transcription of the open-break rule), and ran
both on the shared check database `corgi_test`, which carries 671 brokers and 742 policies and
exercises every branch with non-zero data:

| Count | My SQL | The reviewed function | |
|---|---|---|---|
| approval requests waiting | 77 | 77 | MATCH |
| policies paid and not bound | 8 | 8 | MATCH |
| claims with a payment still to move | 26 | 26 | MATCH |
| endorsements paid and not applied | 25 | 25 | MATCH |
| open reconciliation breaks | 918 | 918 | MATCH |

`countEndorsementsAwaitingCustomerApproval`, which loops `liveEndorsementRequest` per policy instead
of restating the rule in SQL, returned 1 for the broker holding the only two
`endorsement_requested` events in that database. I did not write an independent SQL equivalent for
it: the `awaiting_approval` state depends on the cumulative $500 rule computed in
`lib/policy/endorsement-requests.ts:104-124`, and reimplementing it would have tested my copy of
the rule, not their code. The deliberate reuse is the right call for correctness and is the cause
of F-UI-18.

### Against the trial database and the screens

Same five counts run against the deployed database with the restricted role, and compared with what
the deployment actually renders:

| Count | My SQL on the trial database | Badge and block on production |
|---|---|---|
| approval requests waiting | 0 (4 requests, 4 decisions) | no Approvals badge |
| policies paid and not bound | 0 | no Policies badge |
| claims with a payment still to move | 0 (3 `claim_payout` operations, all sent or failed) | no Claims badge |
| endorsements paid and not applied | 0 | no line |
| open reconciliation breaks | **20** | sidebar "Reconciliation **20** waiting for you", block "20 open breaks between a provider and the ledger" |

And the badge against the screen it points at: `/ops/reconciliation` renders **20 rows** in its
"Open breaks" table. Badge, block, my SQL and the list all agree.

The broker and customer badges are correct but untested by data: the trial database holds zero
`endorsement_requested` events on all four policies, so both roles legitimately show "Nothing is
waiting for you right now". `approver@example.com` shows the same single reconciliation task as
`ops@example.com`, which is right: the approver branch differs only in wording and in the two
`staff_ops`-only counts, which are zero here.

### A failed count does not break a page

Verified empirically rather than by reading. I pointed `DATABASE_URL_APP` at an unroutable host and
called `workspaceTasks` for all four roles:

```
staff_ops      -> [] (no throw)
staff_approver -> [] (no throw)
broker         -> [] (no throw)
customer       -> [] (no throw)
```

The `try/catch` at `components/what-needs-you.tsx:34-50` holds, `PortalShell` renders with no
badges, and the page still serves. The catch is silent, which is F-UI-17.

## 3. Every screen on the deployed application

I signed in over HTTPS as the four demo identities, reading `DEMO_PASSWORD` from the main tree's
`.env.local` inside a script so the value was never printed, echoed or written anywhere. All four
returned 303 with a session cookie. The login route only reads `users` and signs a cookie, so this
review wrote nothing.

| Identity | Routes at 200 | Slowest |
|---|---|---|
| `ops@example.com` | `/ops`, `/ops/approvals`, `/ops/claims`, one claim, `/ops/reconciliation`, `/ops/statements`, `/ops/mcp-keys`, `/ops/policies`, `/ops/brokers`, one policy, its endorsement preview, its correction form, one statement | 0.38 s |
| `approver@example.com` | `/ops`, `/ops/approvals`, `/ops/claims`, `/ops/reconciliation`, `/ops/statements`, `/ops/mcp-keys`, `/ops/brokers` | 0.31 s |
| `broker@example.com` | `/broker`, `/broker/kyb`, `/broker/statements`, `/broker/policies/new` | 0.32 s |
| `customer@example.com` | `/customer` | 0.26 s |
| anonymous | `/`, `/login` | 0.40 s |

Refusals, all measured on `c5bcf2a`:

| Case | Measured |
|---|---|
| anonymous on `/ops`, `/broker`, `/customer`, `/ops/approvals`, `/ops/reconciliation`, `/ops/statements`, `/ops/mcp-keys`, `/ops/claims` | 307 to `/login` |
| broker on `/ops`, `/ops/approvals`, `/ops/policies`, `/ops/brokers`, `/customer`, a claim page | 307 to `/broker` |
| customer on `/ops`, `/broker/kyb`, `/broker/policies/new` | 307 to `/broker` |
| staff on `/policies/not-a-uuid`, `/ops/claims/not-a-uuid`, `/statements/not-a-uuid` | 404 |
| staff on a well-formed unknown policy uuid | 404 |

No page answered 200 where it should have refused, and no refusal leaked a heading or a body.

### 375 pixels

**Not measured.** No browser tool is available in this worktree: there is no Playwright, no
Puppeteer, no `ws` package, and Node 20.19 has no global `WebSocket`, so I could not drive the
installed Chrome over the DevTools Protocol as the previous reviewer did. What I checked instead, in
the source: every new table is inside an `overflow-x` `.table-scroll` region; the new components
carry their own rules at the existing 800 and 580 pixel breakpoints (`app/globals.css:1348` and
`:1356`, covering `.signed-out > main`, `details.sandbox-reference > div`, `.needs-you` and
`.needs-you-list a`), and the sidebar badge and count chip have rules in the 600 pixel block. This
is a code reading, not a measurement: **the reviewed revision has no rendered narrow-viewport
evidence from me or from the builder**, who also could not run a browser.

### The two slow screens

The builder measured `/ops/brokers` at 120 s and `/ops/policies` at 149 s on the check database and
called them pre-existing N+1 reads. On production, signed in as `ops@example.com`, three runs each:

| Screen | Production | Rows shown | Check database (builder) |
|---|---|---|---|
| `/ops/brokers` | 0.27, 0.25, 0.24 s | 3 brokers | 120 s (671 brokers) |
| `/ops/policies` | 0.31, 0.24, 0.26 s | 4 policies | 149 s (742 policies) |

**Rating: the builder's account is correct and the production behaviour is fine.** The two screens
are three orders of magnitude faster on the trial database, for the reason given: `brokersWithKybState`
runs three queries per broker and the policy index reads each broker's policies in turn, so the cost
is linear in a row count that is 3 here and 671 there. It is a genuine N+1 and it is in `lib`,
outside this diff. I would not spend submission time on it: it is invisible at trial volume, and a
panel will not load 671 brokers. It is worth one sentence in the known-limitations list, not a fix.

For completeness, the badge reads themselves, timed from a laptop with a warm pool (one Neon round
trip from here costs about 110 ms, so these numbers are dominated by latency the deployment does not
pay):

| Read | corgi_test | trial database |
|---|---|---|
| `countApprovalRequestsWaitingForDecision` | 114 ms | 113 ms |
| `countOpenBreaks` | 139 ms | 113 ms |
| `countClaimsWithPaymentsStillToMove` | 113 ms | 111 ms |
| `countEndorsementsPaidButNotApplied` | 113 ms | 137 ms |
| the five staff counts in parallel | 1057 ms (first use of the application pool) | 1032 ms (same) |
| `countEndorsementsAwaitingCustomerApproval`, widest broker | 1353 ms for 5 policies | 1126 ms for 4 policies |

The last row is F-UI-18. On production `/broker` answers in 0.25 s with the same 4 policies, because
the application and the database are co-located.

## 4. The named acceptance points

**Sandbox references keep the raw identifiers in the DOM.** Confirmed on the served markup, not only
in the source. On one policy page: 8 "Sandbox references" panels, with `<dt>` labels
`Stripe Checkout Session`, `On Stripe PaymentIntent`, `Stripe Refund`, `Money operation id` (twice)
and `Approval request id`; the raw `pi_…` and `re_…` values are present in the HTML text. On
`/ops/brokers`, four `acct_` occurrences. On `/ops/approvals`, the request id and the sha256 of the
approved text. They sit inside `<details class="sandbox-reference">` with no `open` attribute, so
they are collapsed but in the document: a reviewer's page source, a `curl`, and a text search all
find them. `SandboxReferences` also prints "none yet" for a reference that has no value, which keeps
"not created yet" as a visible fact rather than a blank.

**`/login` has no sidebar and no staff destination for an anonymous visitor.** `app/login/page.tsx`
now renders `SignedOutFrame` instead of `PortalShell`. Measured on production: the served page is
12.5 KB, contains no `nav`, no `Main navigation`, no `sidebar-nav`, no `sidebar-account`, no
breadcrumb, no `Corgi workspace` account block, and **no `href` to any page at all** (the only
anchor is the `#main-content` skip link). F-UI-11 is fixed for `/login`. It is not fixed for `/`,
which still renders the workspace shell with the placeholder account block for an anonymous
visitor: F-UI-15.

**The refund banner names the right state.** `cancellationRefundNotice`
(`app/policies/[policyId]/page.tsx:971`) partitions the refunds into five buckets and words each
separately: waiting for a second person with nothing sent, recorded and owed but not sent yet, sent
to Stripe and not confirmed, completed, failed with the customer still owed. `RefundState` has
exactly four values (`lib/payments/refund-state.ts:15`), the `requested` one is split on the
approval decision, and the five filters partition the list without overlap, so the counts always sum
to `refunds.length`. I checked the case that worried me, a refund an approver rejected: a rejection
appends a `failed` event with `stage: "approval"`, so its state is `failed`, not `requested`, and it
lands in the "failed and the customer is still owed the money" bucket rather than being described as
still waiting. F-YA-04 is properly fixed. The closing sentence, "a refund counts as completed only
when Stripe's webhook confirms the money left", is the honest one.

**The B11 "raised by an AGENT" marker still shows on `/ops/approvals`.** Confirmed on production. The
string renders once, in the "Asked by" cell of a decided row, and I checked its nesting depth in the
served HTML: **zero open `<details>` elements precede it**, so it is not folded away. Next to it,
"MCP API key cmk_… (agent). The person named above holds that key; an agent principal can never
approve a money-out." The queue is now two tables (waiting, decided) with a fixed seven-column set,
and the exact hashed text sits behind a per-row disclosure above the decision form, which is a
better shape for that screen than the previous stack of cards.

**The automatic-fail labels survive.** On production: `LOCAL SIMULATOR` renders on `/ops` and on the
claim page (including in the summary text of the closed disclosure "Record the claimant's bank
account (LOCAL SIMULATOR)", so it is visible without opening anything); "not a dedicated KYB vendor"
renders on `/ops/brokers`. Nothing simulated is presented as live. Note that the "append-only"
sentence F-UI-03 asked for is still absent from the visible `/ops`: both occurrences in the served
page are inside `<meta name="description">`. F-UI-03 is unchanged by this merge.

## 5. AF-06 readability of the new code

`components/disclosures.tsx` (83 lines) is the best file in the diff: three tiny components, each a
native `<details>`, with a comment saying why the content stays in the HTML when closed. No state,
no JavaScript, defensible in one sentence each.

`components/signed-out-frame.tsx` (39 lines) is trivially defensible.

`components/what-needs-you.tsx` (176 lines) is explicit and readable: one type, one dispatcher, three
role functions, a plural helper and a presentational component. The wording of each task is a
literal string next to the count it belongs to, which is exactly the "keep related facts together"
shape `READABLE-CODE.md` asks for. Two things a panel could press on: the bare `catch` (F-UI-17) and
the fact that `staffTasks` calls three counts with `sql` and two with no argument at all (F-UI-16).

`components/money-amount-input.tsx` (115 lines) carries 40 lines of comment explaining what it does
not do, which is the right instinct for a money field. The caret restoration through
`queueMicrotask` and `positionAfterDigits` is the one part Yoann will have to rehearse; it is
mechanical and testable, but it is browser code and it is the only browser code near an amount.

`app/ops/approvals/page.tsx` is **more** readable after this change, not less: the previous version
chained `alreadyDecided ? … : !isApprover ? … : isOwnRequest ? … : <form>` inline in the JSX; it is
now a `Decision` component with four early returns. That is a partial improvement on F-UI-08.

The two weak points, both in `app/globals.css`: the file grew again, from 1060 to 1373 lines
(F-UI-14), and this merge orphaned a block of CSS without removing it (F-UI-13).

`components/portal-shell.tsx:105-114` still derives the breadcrumb through the nested ternaries
F-UI-08 named. This merge did not make them worse and did not fix them.

Walkthrough status: **NOT REVIEWED WITH YOANN**. Nothing here certifies his understanding; it
records what I judge to be explainable and what is not.

## Findings

| ID | Severity | Finding |
|---|---|---|
| F-UI-12 | MEDIUM | The money input mask silently reshapes input the server parser is written to refuse, so a typo or a European-format paste becomes a different accepted amount instead of an error. |
| F-UI-13 | LOW | This merge orphaned the `table.approval-details` CSS (6 rules and a dedicated media block) without removing it; 4 of the 76 class selectors in `app/globals.css` are now used by no page. |
| F-UI-14 | LOW | `app/globals.css` grew from 1060 to 1373 lines and gained two more breakpoint blocks appended after the existing responsive sections. F-UI-07, larger. |
| F-UI-15 | LOW | `/` still renders the workspace shell for an anonymous visitor, including the placeholder account block. F-UI-11 is fixed on `/login` only. |
| F-UI-16 | LOW | The five count functions have two different signatures: three take a `database` parameter, two use the module pool and take none. `workspaceTasks` calls them both ways in one `Promise.all`. |
| F-UI-17 | LOW | `workspaceTasks` swallows every read failure in a bare `catch` with no log line, so badges that silently stop working leave no trace in production logs. |
| F-UI-18 | LOW | `countEndorsementsAwaitingCustomerApproval` runs one `liveEndorsementRequest` per policy of the broker or customer, on every workspace page. |
| F-UI-19 | LOW | The echo under a money field prints leading zeros: typing `007` shows "= $007.00" while the server records $7.00. |

### Evidence and required corrections

**F-UI-12 (MEDIUM).** Trigger: type or paste, into any of the eight money fields, a string containing
a character the mask drops. `groupThousands` (`components/money-amount-input.tsx:78`) begins with
`typed.replace(/[^\d.]/g, "")`, deleting every character that is not a digit or a point, and then
truncates to two decimals. The consequences measured above: `1 200,50` is submitted as `120,050` and
booked as **$120,050.00**, where `lib/money/cents.ts:25-29` refuses it deliberately, with a comment
naming that exact string and that exact risk; `12.345` becomes $12.34 (truncated, not rounded);
`1.2.3` becomes $1.23; `-5` becomes $5.00; `1e3` becomes $13.00. All five were refused with a clear
error at `2755d11`. Fields affected: `annualPremium`, `perOccurrenceLimit`, `aggregateLimit`,
`newAnnualPremium`, `newPerOccurrenceLimit`, `newAggregateLimit`, `reserveAmount`, `paymentAmount`,
which is every premium, limit, reserve and claim payment the interface collects.

Why this is MEDIUM and not HIGH: no money is computed in the browser, the server still parses what it
receives and still rejects everything it rejected before, the `= $…` echo under the field states the
amount that will be submitted, and each of these flows has a second gate behind it (an endorsement
preview, a draft, or maker-checker above the threshold). Nothing here can produce a ledger entry the
screens do not show. Why it is not cosmetic: the guard whose comment says "so `1 200,50` is refused
instead of being read as one hundred and twenty thousand" no longer fires for anyone using a
browser, and a 100x error on a claim payment now depends on a person reading a grey line under the
field. Required correction: stop deleting characters the parser would reject. Strip only `$`, spaces
and the grouping commas the mask itself inserted; leave anything else in the field, let `echoOf`
return null so the hint shows instead of a wrong amount, and let the server produce its error. That
keeps the thousands grouping, which is what Yoann asked for, and restores the refusal.

**F-UI-13 (LOW).** `app/globals.css:1047-1055` styles `table.approval-details`, including a whole
`@media (max-width: 600px)` block that exists only for it. The class was removed from
`app/ops/approvals/page.tsx` by this merge and appears in no `.tsx` file. Three more selectors are
dead from earlier work: `loading-placeholder` (orphaned when the root loading boundary was removed
for F-UI-01), `demo-feedback`, `desktop-break`. Required correction: delete the nine lines for
`approval-details`; the other three are pre-existing and can go with them or be left to B13.

**F-UI-14 (LOW).** Evidence: 1060 lines at `2755d11`, 1373 at `c5bcf2a`, with new blocks at
`@media (max-width: 800px)` line 1348 and `@media (max-width: 580px)` line 1356, both after the
main responsive section that already ends at line 1055. The new 313 lines are better commented than
the file they join (one clear header at line 1061 naming the findings), so this is trend, not
regression. Required correction: none before submission. If `globals.css` is touched again, merge
the trailing breakpoint blocks into the main responsive section rather than appending a fifth.

**F-UI-15 (LOW).** Evidence: `curl https://corgi-work-trial-iota.vercel.app/` anonymous returns a
page containing `sidebar-nav`, `sidebar-account`, `account-identity` and the words "Corgi workspace",
with a two-link navigation. The builder states the choice explicitly in the handoff note ("only
`/login` was named in the finding"), so this is a scoping decision, not an oversight. Required
correction: render `/` with `SignedOutFrame` too. It is a one-line change and the component already
exists.

**F-UI-16 (LOW).** `countApprovalRequestsWaitingForDecision`, `countClaimsWithPaymentsStillToMove`
and `countOpenBreaks` take the connection as a parameter; `countPoliciesPaidButNotBound` and
`countEndorsementsPaidButNotApplied` import the module pool and take none.
`components/what-needs-you.tsx:56-61` calls all five in one `Promise.all`, three with `sql` and two
without, so a reader has to open each file to know which is which, and the two parameterless ones
cannot be pointed at another connection or run inside a transaction. Required correction: give the
two the same optional `database: postgres.Sql = sql` parameter the endorsement count already uses.

**F-UI-17 (LOW).** `components/what-needs-you.tsx:46`, `} catch {`, with a comment explaining the
choice and no `console.error`. The choice is right (a hint must not break a page, and I proved the
page survives), but nothing records that it happened, so a count that fails permanently in
production looks identical to a count that is legitimately zero. Required correction: log the error
once, redacted, before returning the empty list.

**F-UI-18 (LOW).** `lib/policy/endorsement-read.ts:287-299` selects the policies of the owner and
then awaits `liveEndorsementRequest` inside a `for` loop, and `liveEndorsementRequest` itself runs
several queries. Measured 1353 ms for a 5-policy broker and 1126 ms for a 4-policy broker from a
laptop, roughly 2 to 3 round trips per policy. It runs on every page a broker or customer opens, and
grows linearly with the size of their book. The comment above it makes the case for the loop
correctly: an SQL copy of the cumulative $500 rule would be a second definition of it, and a badge
that disagrees with its own screen is worse than no badge. Required correction: none for the trial.
Disclose it as a known limitation, and if it ever matters, batch the per-policy read rather than
restating the rule.

**F-UI-19 (LOW).** `echoOf` (`components/money-amount-input.tsx:96`) groups the whole-dollar digits
without stripping leading zeros, so `007` echoes "= $007.00" while `formatCentsAsUsd` would print
"$7.00". The comment above the function says it prints "the way the application prints money", which
is not quite true. Cosmetic; fix with the F-UI-12 correction if that file is opened.

### Previously open findings, rechecked on this revision

| ID | State at `c5bcf2a` |
|---|---|
| F-YA-01 | Addressed. Tables with a fixed column set on approvals and policies, explanations behind "How to read this", row actions behind a per-row disclosure. |
| F-YA-02 | Addressed. Stripe and operation identifiers behind the sandbox affordance, still in the DOM. |
| F-YA-03 | Addressed. Sidebar counts and a per-role "what needs you" block, server-rendered, numbers verified against the database. |
| F-YA-04 | Addressed. The banner partitions the refunds by state; the rejected case is worded correctly. |
| F-UI-02 | **Still open, unchanged.** `/` and `/login` still carry only a collapsed `<details>` whose visible summary is the word "Sandbox"; the served pages contain no "work trial", "Track 1", "synthetic data" or "test mode". Correction still required before handover. |
| F-UI-03 | **Still open.** "append-only" appears on `/ops` only inside `<meta name="description">`. |
| F-UI-07 | Worse in degree, see F-UI-14. |
| F-UI-08 | Half improved: the approvals page ternary chain became a component with early returns; `portal-shell.tsx:105-114` is unchanged. |
| F-UI-11 | Fixed for `/login`, open for `/`, see F-UI-15. |

## Automatic-fail mapping for this scope

| Gate | Result in this scope |
|---|---|
| AF-01 accessible deployed URL | **PASS** at `c5bcf2a`. Every route renders for its roles on the deployed URL, every refusal answers 307 or 404, `/api/health` reports the reviewed revision. |
| AF-02 honest integration modes | **PASS**. `LOCAL SIMULATOR` and "not a dedicated KYB vendor" render on production; the claim-page simulator label is in a disclosure summary, so it shows without opening anything. F-UI-02 remains a weakened app-level disclosure, not a simulation presented as live. |
| AF-03 no UPDATE or DELETE on money rows | **PASS for this scope.** The diff outside `app/` and `components/` is 133 added lines in five read files, all `select … count`. No `insert`, `update`, `delete`, `truncate` or migration. No runtime ledger guard was rerun here, by instruction; that evidence belongs to B1 to B10. |
| AF-04 sandbox only, no real data | **PASS**. Only `example.com` identities, no provider call and no spend by this review; my database access was read-only through the restricted runtime role. |
| AF-05 no committed secrets | **PASS**. `gitleaks 8.30.1` over the reviewed diff (132 KB): no leaks. Manual scan for `sk_`, `pk_`, `whsec_`, `AKIA`, PEM headers, bearer tokens and assignment-shaped `password=`/`secret=`: nothing. `DEMO_PASSWORD` was read into a script variable and never printed. |
| AF-06 own and understand every line | Explainability assessed, not certified. `disclosures.tsx` and `signed-out-frame.tsx` are easy; the caret arithmetic in `money-amount-input.tsx` and `app/globals.css` are the two a panel will press on. **NOT REVIEWED WITH YOANN.** |

## Checks actually executed

- Restricted-path diff `2755d11..c5bcf2a` over `lib db scripts app/api vercel.json next.config.ts package.json package-lock.json`, and a full read of the 133 added lines.
- Independent form-contract extraction over all `app/` and `components/` sources in both revisions (167 against 168 entries, complete difference tabulated above).
- Independent guard-line extraction and comparison over `app/**` in both revisions (244 against 244 lines).
- Independent SQL for five of the six counts, run against `corgi_test` and against the trial database, compared with the reviewed functions and with the screens they point at.
- Empirical proof that an unreachable database makes `workspaceTasks` return `[]` for all four roles without throwing.
- Money mask against the real `parseUsdAmountToCents` and `formatCentsAsUsd`, 19 inputs.
- Production sweep on `c5bcf2a`: four logins, 27 authenticated page requests, 17 refusal cases, all measured for status, redirect target, heading and wall time; three timed runs each of `/ops/brokers` and `/ops/policies`.
- DOM inspection of the served pages for the sandbox references, the AGENT badge nesting depth, the simulator labels, the login shell and the anonymous home shell.
- Timing of the five badge reads and the per-policy endorsement count on both databases.
- `npx tsc --noEmit`: clean.
- `gitleaks 8.30.1` on the reviewed diff, plus a manual pattern scan.
- Dead-selector analysis of `app/globals.css` against every `.tsx` under `app/` and `components/`.

## Checks not executed, and why

- **No rendered 375 pixel measurement.** No browser tool in this worktree; see section 3. The reviewed revision has no narrow-viewport evidence from anyone.
- No `npm test` and no `npm run build`. The business code is unchanged in this scope, typecheck is clean, and the deployed revision is the reviewed merge, which is stronger evidence of compilability than a local build.
- No check script of any kind, per instruction, including `check-money-guards`. No ledger, webhook, reconciliation, approval or statement test rerun: those belong to the B1 to B11 reviews.
- No database write, no migration, no Stripe or provider call, no MCP action, no push, no deployment.
- No independent verification that a rejected refund always writes a `failed` event; I read the state machine and the `failureStage: "approval"` branch and relied on the B7 review for the write path.
- No accessibility or WCAG claim. The new markup uses a native `<details>`, a `visually-hidden` span for the badge and `aria-describedby` on the money field, all of which look right, but I ran no assistive-technology test and no contrast measurement.
- The error boundary was not triggered on the deployed application; forcing a server error there is not a safe read-only action.

## Verdict and residual limitations

**PASS** for the interface polish merged at `c5bcf2a`, on the evidence above. The polish is
presentation plus six read-only counts: no business logic, no form contract, no server check and no
money path changed; the counts agree with my own SQL on both databases and with the screens they
point at; a failed count returns no task instead of breaking a page; every guard still runs before
rendering; every screen renders for its roles on the deployed URL with correct refusals; and the
automatic-fail labels and the sandbox evidence survive.

One correction is required before submission: **F-UI-12**, the money mask that silently reshapes
input the server was written to refuse. It is not a violation of an applicable requirement, since
the server boundary still validates everything it receives and no money is computed in the browser,
but it removes in the browser a guard the code documents as deliberate, on every field that carries
an amount. **F-UI-02 also remains open from the previous review** and is unchanged by this merge.

This review covers presentation, the six new read functions, access-check preservation and the
deployed behaviour of the reviewed revision. It does not approve the ledger, the provider
integrations, the approval queue, reconciliation, statements, the PDF output, the MCP surface or the
integrated trial gate, all of which keep their own records. It is an engineering assessment, not a
legal certification and not a guarantee of zero defects. Candidate walkthrough:
**NOT REVIEWED WITH YOANN**.

## Register lines for the coordinator

| ID | Sev | Finding (one line) | Fix | Status |
|---|---|---|---|---|
| F-UI-12 | MED | The money mask strips every character the server parser rejects before submitting, so "1 200,50" is booked as $120,050.00 and "12.345" as $12.34 where both used to be refused; the echo shows it, the server still parses, no browser money math | Strip only `$`, spaces and the mask's own commas; leave anything else in the field so the echo shows the hint and the server refuses | OPEN (interface polish) |
| F-UI-13 | LOW | This merge orphaned the `table.approval-details` CSS without removing it; 4 of 76 class selectors in globals.css are used by no page | Delete app/globals.css:1047-1055; the three older dead selectors with it | OPEN |
| F-UI-14 | LOW | globals.css grew 1060 to 1373 lines with two more breakpoint blocks appended after the main responsive section (F-UI-07, larger) | Merge trailing breakpoints into the main responsive section next time the file is opened | OPEN |
| F-UI-15 | LOW | `/` still renders the workspace shell and the placeholder account block for an anonymous visitor; F-UI-11 fixed on /login only | Render `/` with SignedOutFrame too | OPEN |
| F-UI-16 | LOW | Three of the five count functions take a `database` parameter and two use the module pool with none; workspaceTasks calls both shapes in one Promise.all | Give the two the same optional `database = sql` parameter | OPEN |
| F-UI-17 | LOW | workspaceTasks swallows every read failure in a bare catch with no log line, so a permanently failing badge looks like a legitimate zero | Log the error once, redacted, before returning the empty list | OPEN |
| F-UI-18 | LOW | countEndorsementsAwaitingCustomerApproval runs one liveEndorsementRequest per policy on every broker and customer page, ~270 ms per policy from a laptop, invisible on the deployment | None for the trial; disclose as a known limitation | OPEN (disclose) |
| F-UI-19 | LOW | The money echo prints leading zeros: "007" echoes "= $007.00" while the server records $7.00 | Strip leading zeros in echoOf, with the F-UI-12 fix | OPEN |
| F-UI-20 | LOW | 41be7fc applies the F-YA-05 rule to the policy page, reconciliation and statements but not to `/ops/claims/[claimId]`, whose four primary actions (set the reserve, record the bank account, request a payment, close) still serve closed; measured 0 open folds on production | Add `open` to the four Disclosures in app/ops/claims/[claimId]/page.tsx | OPEN |
| F-UI-21 | LOW | 41be7fc also opens "Open a document as of a date", a lookup tool rather than a primary action, so a form and its explanation now sit third on the policy page above Payment and the journal | Leave that one fold closed, or move the section below the journal | OPEN |

---

## Re-review: `41be7fc`, primary action forms open on arrival (F-YA-05)

Requested by the coordinator at 19:33Z, while this review was being written. Performed 2026-09-08,
roughly 21:35Z to 21:55Z.

Revision: `41be7fcbe5909c1d52f7e3a422b564e84e80c678`, one commit on top of `c5bcf2a`. `/api/health`
reported it before I started measuring, so every number in this section is against `41be7fc`.

### The diff

`git diff c5bcf2a 41be7fc` touches four source files. The rest of the commit is README, PLAN,
STATUS, FINDINGS and the B12-1 agent-demo handoff with its four screenshots, all coordinator or
other-delegate territory and outside this review.

| File | Change |
|---|---|
| `components/disclosures.tsx` | `Disclosure` gains an `open = false` prop, rendered as `open={open \|\| undefined}` |
| `app/policies/[policyId]/page.tsx` | `open` set on four folds: the document lookup, "Change the premium or the limits", "Pick the day cover stops", "Open a claim on this policy" |
| `app/ops/reconciliation/page.tsx` | `open` set on "Run a reconciliation now" |
| `app/ops/statements/page.tsx` | `open` set on "Run a statement" |

Six added lines, six changed lines. `open={open || undefined}` is the right form: React omits the
attribute entirely when the prop is false, so a closed disclosure does not serve `open="false"`,
which browsers would treat as open. No form `action`, `method`, `name` or `value` changed; no guard,
no read, no SQL, no money expression. `RowActions` and `SandboxReferences` are untouched, so row
actions and identifiers still start closed, which is right.

### Measured on the deployment

Nothing regressed. Full re-sweep at `41be7fc`: anonymous `/login` 200 and `/ops`, `/policies/{id}`
307 to `/login`; ops 200 on `/ops`, `/ops/approvals`, `/ops/reconciliation`, `/ops/statements`,
`/ops/policies`, `/ops/brokers`, and 404 on `/policies/not-a-uuid`; broker 200 on `/broker` and 307
to `/broker` on `/ops/approvals`; customer 200 on `/customer`; approver 200 on `/ops/approvals`.
Timings 0.21 s to 0.30 s, unchanged. The reconciliation badge still reads 20 and still matches the
20 rows of the open-breaks table.

Disclosure states in the served pages:

| Page | Open on arrival | Still closed |
|---|---|---|
| `/policies/{id}` | 4 folds (the document lookup, and the action folds this policy renders) | the 2 sandbox-reference panels, the environment badge |
| `/ops/reconciliation` | 1 ("Run a reconciliation now") | 4 explanations, 20 sandbox-reference panels |
| `/ops/statements` | 1 ("Run a statement") | its explanation |
| **`/ops/claims/{id}`** | **0** | **4 action folds**, 1 explanation, 1 row-actions, 5 sandbox-reference panels |

The claim page is F-UI-20: "set the reserve", "record the claimant's bank account", "request a
payment to the claimant" and "close this claim" are primary actions by the same reading of the rule
that opened "change the premium or the limits", and they still serve folded.

### On "nothing is well placed"

**I have no browser tool, so I cannot say what Yoann sees and I did not try to judge the visual
design from bytes.** What I can rule out are the two mechanical causes of a page that renders
scrambled, and both are clean:

- **The stylesheet is served and complete.** `/policies/{id}` links exactly one stylesheet,
  `/_next/static/immutable/chunks/40amej3k9vhev.css`, which returns 200 with 20,738 bytes, 270
  rules and 8 media queries. I extracted every class the served page uses (57 of them, from the
  HTML and from the RSC payload) and checked each against that file: all 57 are defined except 17
  `lucide-*` icon classes, which lucide sets on its SVG elements and which have no CSS by design,
  plus one `$undefined` artefact of my own RSC regex. `.portal`, `.table-scroll`,
  `details.disclosure`, `.needs-you` and `.sandbox-reference` are all present.
- **The markup is valid.** I walked the tag stack of the served HTML for `/policies/{id}`,
  `/ops/claims/{id}`, `/ops/reconciliation` and `/ops`: zero content-model violations (no
  `<details>`, `<div>`, `<table>` or `<form>` inside a `<p>` or a `<span>`, no `<form>` directly
  inside a table), zero self-closing non-void tags, and nothing left unclosed at the end of the
  document. So no browser is silently repairing the markup and moving blocks somewhere the server
  did not put them, which is the usual cause of that complaint.

Two things I can say about placement from the served structure, offered as hypotheses to check in a
browser and not as findings I verified visually:

1. `41be7fc` opened the document-lookup fold, which is a lookup tool rather than an action. The
   served `h2` order of a policy page is now: Annual terms in force, Coverage, **Documents as of a
   date** (an open form plus a paragraph), Payment, Endorsement schedule, Cancellation, Refunds,
   Claims, The policy as it stood on a date, Timeline, Journal entries. A form now interrupts the
   facts at the third heading, which runs against the polish note's own stated goal that the page
   "shows the terms, the schedule, the refunds, the claims and the journal first". That is F-UI-21.
2. The two `sandbox-reference` summaries on that page have **no visible text at all**: their content
   is a 13-pixel `Info` icon with an `aria-label`. A screen reader announces "Sandbox references";
   a sighted operator sees a small dot inline in a cell. If part of the complaint is that things
   look like stray marks rather than controls, this is the element I would look at first. I did not
   see it rendered and I am not raising it as a finding.

### Verdict for `c5bcf2a` plus `41be7fc`

**PASS maintained.** `41be7fc` is six lines of presentation on top of the reviewed merge: no
business logic, no form contract, no guard, no money path. Everything measured on `c5bcf2a` still
holds on `41be7fc`, and the fix does what F-YA-05 asked on the three screens it touches.

Open from this review, in order: **F-UI-12** (MEDIUM, the money mask, required before submission),
then F-UI-20 (the claim page missed by F-YA-05, a four-word fix), F-UI-15, F-UI-16, F-UI-17,
F-UI-13, F-UI-21, F-UI-19, F-UI-14, F-UI-18. **F-UI-02 remains open from the previous review.**
Still not verified by anyone on this revision: the rendered layout at any viewport width, including
375 pixels. Candidate walkthrough: **NOT REVIEWED WITH YOANN**.
