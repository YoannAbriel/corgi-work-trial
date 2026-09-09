# Independent review: the LOW screens sweep and the five UI-audit findings

Scope: Linear YOA-644, screens half, plus the five findings of `docs/reviews/b13-13-ui-audit.md`
section 12. Builder commit **ec4c5c9**, merged to `main` as **3890300** and pushed at 12:27Z.
Seventeen items: F-UA-01 to F-UA-05, F-B13-31, F-B13-32, F-B13-33, F-B13-34, F-B13-60, F-B12-20,
F-INT-20, F-INT-21, F-INT-23, F-YA-04, F-PP-07, and the regression set of the previous review.

**Reviewer:** independent sub-agent, own git worktree
`.claude/worktrees/agent-a89f9f19d58abfe11`, branch `worktree-agent-a89f9f19d58abfe11`.
**Written:** 2026-09-09 between 12:28Z and 12:55Z UTC.
**Reviewed revision: `389030078659e1b1f054cee78c7d5822b5018b1d` (`3890300`).** `/api/health`
reported that revision at 12:28:26Z, before the first measurement, and again after every one of
the eleven measurement runs. Every figure below was taken on it, and each run recorded the
revision before and after itself.
**Deployment:** https://corgi-work-trial-iota.vercel.app

**Verdict: FAIL for the cycle**, on one item and one item only: **F-INT-20 is closed on the
operations table of the console 360 and left open on the timeline table of the same screen**
(finding **F-LU-01**). The row still reads a green `succeeded` chip beside `Your card was
declined.`, and it is now dated with the SUCCESS time, `2026-09-08 10:16:02`, while the decline
happened at `10:00:19`. The other **sixteen items are PASS**, each with a measurement.

**Walkthrough status: NOT REVIEWED WITH YOANN.** Nothing here establishes that Yoann can explain
these files. Section 7 is a readability assessment, not a statement about his understanding.

---

## 1. Startup receipt (AGENTS.md)

Read **in full**, in this order, before looking at any code or any screen:

| File | What I took from it |
|---|---|
| `CLAUDE.md` | entry point, Track 1, reading order, English artifacts |
| `AUTOMATIC-FAILS.md` | the six bans and the operating gate; AF-02, AF-04 and AF-05 are the ones this scope can touch |
| `REVIEWER.md` | the implementation-review contract, the section 3 record shape, PASS/FAIL/BLOCKED |
| `AGENTS.md` | startup receipt, delegate ownership ("only the coordinator edits shared files"), completion gates |
| `READABLE-CODE.md` | what to flag: hidden side effects, ambiguous units, unnecessary indirection |
| `docs/reviews/b13-13-ui-audit.md` section 12 | the five register lines F-UA-01 to F-UA-05 and what each one measured |
| `docs/reviews/FINDINGS.md` | the register lines for F-B13-31 to 34, F-B13-60, F-B12-20, F-INT-20 to 23, F-YA-02, F-YA-04, F-PP-07 and F-UA-01 to 07 |

Read **as a diff, in full**: `git diff 3890300^1 3890300` (22 files, 333 insertions, 71
deletions), written to a file and read line by line.

Read **by targeted section**: `app/layout.tsx` (the 22-line note, in full), `app/broker/page.tsx`,
`app/customer/page.tsx`, `lib/policy/terms-in-force.ts` (in full), `app/ops/approvals/page.tsx`,
`app/styles/policy-detail.css`, `app/globals.css` around `.entry-block` and the 580 px block,
`components/journal-table.tsx` (in full), `components/amount-explained-motion.tsx` around the
arrival effect and `traceToLedger`, `components/console-360.tsx` and
`components/console-parts.tsx` `EventTable`, `lib/console/read.ts` `subjectTimeline` and the feed
mapping, `lib/inbox/sections.ts`, `lib/inbox/sections.test.ts` (in full), `lib/inbox/tasks.ts`,
`app/policies/[policyId]/page.tsx` `cancellationRefundNotice`,
`app/policies/[policyId]/endorse/page.tsx`.

**Absent files:** none of the mandatory kit is missing. `.env.local` is not in this worktree; it
was loaded from the main checkout with `process.loadEnvFile` and never echoed. `node_modules` was
symlinked from the main checkout to run the test suite, and removed before the commit.

**Next acceptance criterion and its checks:** this record is the criterion. Its checks are the
production measurements of sections 3 to 5, all listed in section 8.

**No delegate was used.** Every measurement below I ran myself.

---

## 2. Method, and its limits

**Browser.** `playwright-core@1.56.1` from the session scratchpad. It wants Chromium build 1194,
which is not in the cache, so the binary was named explicitly:
`chromium_headless_shell-1208`. Everything was measured in that browser, on the deployed URL,
signed in through the real login form.

**Rules kept.** GET requests only, plus the login POST for each of the four demo users. **No form
was submitted**: the endorsement preview of F-INT-23 is a GET with query parameters, on a page
whose own header says it writes no event, no operation and no journal entry, and its confirmation
form was left alone. No money moved. `DEMO_PASSWORD` was loaded with `process.loadEnvFile` and
never printed.

**One measurement was thrown away and retaken.** An early run at 375 px lost its session and
measured the login page; the numbers it produced are not in this record. Every 375 px figure below
comes from a run that first asserted `h1 == "Policy CGP-01707"`.

**What a screenshot cannot prove** is stated where it applies: the `scrollIntoView` count of
F-B12-20 is a counter installed in the page before its own script ran, not a picture.

---

## 3. The seventeen items

| # | Item | Status | The measurement |
|---|---|---|---|
| 1 | **F-UA-01** broker list on today's terms | **PASS** | `/broker` as `broker@`: CGP-01707 **`$1,253.20`**, CGP-01274 `$2,391.33`, CGP-01062 `$3,556.84`, voided CGP-01061 **`$1,253.20` + `on the policy record`**. `/ops/policies` as `ops@`: the same four figures and the same note, cell for cell. `/customer` as `customer@` prints a different column, *Annual premium in force*, `$1,200.00` on CGP-01707, which is the same folded terms without tax and fee: consistent. The broker list also gained the staff list's disclosure, read open, word for word the same reading rule. |
| 2 | **F-UA-02** approvals names both cases | **PASS** | The lead, the empty state and the disclosure each name the two sub-threshold routes. Lead: "So does a payment that takes its claim's money out, or its policy's refunds, above that line, **and so does** a request an agent raised through the MCP endpoint". Empty state: "for one of two reasons". Disclosure: "**It is cumulative** ... so a payout cannot be split into sub-threshold pieces to skip the approver. That is why a small decided request can be in the table above with no agent behind it." |
| 3 | **F-UA-03** endorsement schedule | **PASS** | At 1512 px, table 736 px. Header overflow `scrollWidth - clientWidth` = **0 px on all five headers**; no header's painted text crosses into the next column (bleed check over every adjacent pair: **0**). "New annual premium" now wraps to **2 lines** in a 117.8 px column, `white-space: normal`. The provider column went 17% to 21% and its references fold is **122.5 px**, above the 120 px asked for. |
| 4 | **F-UA-04** journal readable at 375 px | **PASS** | At 375 px: `documentElement.scrollWidth == innerWidth == 375`, closed and with a fold opened by a real click. All **8 entry blocks** carry a `.entry-lines-scroll` whose `clientWidth 277` is narrower than its `scrollWidth 640`. Scrolling each scroller fully right brings **17 of 17** DEBIT and CREDIT amounts inside its client box; **0 unreachable**. At 1280 px every scroller is `504 == 504`: no clipping, nothing to scroll. See also **F-LU-02**. |
| 5 | **F-UA-05** approvals columns | **PASS** | `/ops/approvals` at 1512 px, nothing opened: What column **121.2 px** (head and cell alike), "claim payment" on **1 line**, `documentElement.scrollWidth = 1512`. The table now carries `ops-table` and the `col-*` roles, and imports `app/styles/ops-tables.css`. |
| 6 | **F-B13-31** no `loading.tsx` | **PASS, re-scope** | `find app -name loading.tsx` returns **0**. The 22-line note in `app/layout.tsx` is correct: the Next.js documentation says in as many words that "when a Suspense fallback renders or a component suspends, the server commits to a 200 OK status", that a later `notFound()` becomes a noindex meta tag and a later `redirect()` becomes a client-side redirect. The repo's own `docs/STATUS.md` records the same incident under F-UI-00. Measured on production, signed out: `/ops`, `/broker`, `/customer`, `/inbox`, `/policies/<id>`, `/statements/<id>`, `/ops/console`, `/ops/mcp-keys` and `/policies/not-a-uuid` all answer **307** to `/login`; signed in, `/policies/not-a-uuid` answers **404**. My judgement is in section 6. |
| 7 | **F-B13-32** repeated `asOf` | **PASS** | `?asOf=not-a-date&asOf=2026-10-08` refuses with **one** value: `Nothing to show on not-a-date: "not-a-date" is not a calendar date`. Byte for byte the sentence the single-value control `?asOf=not-a-date` produces. The first entry is the one answered for, as the comment says. |
| 8 | **F-B13-33** no region named by a counter | **PASS** | Rendered labels on the policy page: *Amount calculation details*, *Journal entries behind this amount*, *Endorsement schedule*, *Policy timeline*, *Policy journal*. Reconciliation: *Open breaks*, *Reconciliation runs*. Statements: *Statement runs*; a run: five *Amount calculation details*. A repository-wide grep for `aria-label="<word> table <digit>"` returns **0 hits**, and the full inventory (49 distinct literal labels, plus two built from a template) contains no counter at all. See **F-LU-07**. |
| 9 | **F-B13-34** mode chips | **PASS** | CGP-01707: `bound · KYB approved · Stripe: LIVE SANDBOX`. CGP-01274 (a claim exists): `cancelled · KYB approved · Stripe: LIVE SANDBOX · claim payout rail: LOCAL SIMULATOR · 1 open claim`. Statement run `8effa7c1`: `Stripe: LIVE SANDBOX · ties to the ledger · provisional, month in progress`. All three in the heading, none behind a fold. See **F-LU-04** for the customer's view. |
| 10 | **F-B13-60** per-role inbox test | **PASS** | `npm test`: **473 pass, 0 fail, 1 skipped**, including `each role renders exactly the anchors its own kinds of work name`. **Non-vacuity proved:** changing one entry of `INBOX_ANCHOR_OWNER` (`openBreaks: "staff"` to `"broker"`) makes exactly that test fail and nothing else; the mutation was reverted and the tree checked clean. The assertion is a two-way `deepEqual` per role, so an anchor moved or a section dropped fails. See **F-LU-06**. |
| 11 | **F-B12-20** one arrival, one scroll | **PASS** | On CGP-01274, `[data-trace-entry]` shows two entries named by **two folds each**. Arriving on `#journal-entry-policy-83f79ef2-...` with `Element.prototype.scrollIntoView` counted from before the page's own script: **exactly 1 call**, on the entry block itself. A control arrival on an entry only one fold names: 1 call. |
| 12 | **F-INT-20** declined attempt dated | **FAIL** | The operations table of `/ops/console/policy/<CGP-01062>` reads `succeeded` then `Earlier attempt, 2026-09-08 10:00:19: Your card was declined.`, exactly as asked. **The timeline table of the same page still reads** `2026-09-08 10:16:02 · money · stripe_checkout succeeded · $3,556.84 · stripe · Your card was declined.` Finding **F-LU-01**. |
| 13 | **F-INT-21** MCP keys card | **PASS** | `/ops` as `ops@`: five action cards, `/ops/mcp-keys` among them. As `approver@`: **four** cards, no MCP keys card, and the string "MCP keys" appears nowhere on the page. The screen itself still refuses: `/ops/mcp-keys` as approver redirects to `/ops`. |
| 14 | **F-INT-23** endorse preview wording | **PASS** | GET preview on CGP-01707, `+$50.00` of annual premium effective 2026-11-01, nothing submitted: "With this change, this policy would carry **$1,143.96 of additional premium in this term, this quote included**, above $500.00: the customer approves before the delta can be paid." The string "since issuance" is gone from the page. |
| 15 | **F-YA-04** refund banner wording | **PASS (code)** | `cancellationRefundNotice`, `app/policies/[policyId]/page.tsx`: the waiting branch now pushes `"<n> is waiting for an approver, and nothing has been sent to Stripe"`. The four sibling branches are unchanged and each still names its own fact. **Not seen rendered:** no refund is waiting for approval on production, and I created none. See **F-LU-08** for a grammar nit. |
| 16 | **F-PP-07** one notice shape | **PASS** | `/ops?error=x` and `/broker?error=x` both render `main > div.notices > p.error[role=alert]`, same class chain, both **x=305, width=1150**. The two screenshots show the same red box. One cosmetic difference, not a defect: on `/ops` the notice sits above the `h1`, on `/broker` below the heading block. |
| 17 | **Regressions** | **PASS** | 32 role-and-path renders, GET only: **30 x HTTP 200** with an `h1` and no redirect, **2 x HTTP 404** on the not-found page (`/policies/not-a-uuid`, `/no-such-page-for-the-review`). **0 of 32** carry any of nine stack-trace markers. The sandbox chip is on all 30 application screens and on neither 404. Mode labels: reconciliation 28 `LIVE SANDBOX` and 11 `LOCAL SIMULATOR` (both unchanged), console 30 `LIVE SANDBOX`, claim 360 4 and 14, and the three new chips of item 9. `INBOX_ANCHORS` is **byte-identical** at `3890300^1` and `3890300` (same sha1 of the extracted block). The approvals decision `Decision` component is **byte-identical** at both revisions: same action, same method, same three field names, same two values. |

**14 PASS, 1 PASS with a re-scope recommendation (item 6), 1 PASS on code only (item 15), 1 FAIL
(item 12).**

---

## 4. Findings

| ID | Severity | Finding |
|---|---|---|
| **F-LU-01** | **LOW, but it fails item 12** | **F-INT-20 is closed on the operations table and left open on the timeline table of the same screen, and the reference-search trail behind it.** `lib/console/read.ts:2888`, in `subjectTimeline`, builds one row per money OPERATION with `title: "<kind> <latestStatus>"`, `instant: succeededAt ?? failedAt ?? ...` and `detail: operation.failureReason ?? ""`. On CGP-01062 that prints a green `stripe_checkout succeeded` chip beside `Your card was declined.` **dated 2026-09-08 10:16:02, the time of the SUCCESS**, while the decline happened at 10:00:19. This is worse than what F-INT-20 recorded, because the reason now carries a timestamp that is not its own. The main console feed is not affected: it reads `money_operation_events` one row per event, so its status and its reason always belong to the same event. **Trigger:** open `/ops/console/policy/31509261-4bfd-4c0c-8e16-55ff03eff1b7` and read the timeline panel. **Consequence:** the incident screen tells an operator a succeeded payment was declined. **Correction:** the same four lines the fix already applies in `components/console-360.tsx:222`, moved into `subjectTimeline`, or an empty `detail` when the status is not `failed`. Evidence: `lu01-console-timeline.png` beside `int20-console-360.png`, the same screen. |
| **F-LU-02** | LOW | **The F-UA-04 fix removed the only DEBIT and CREDIT labels below 580 px.** `app/globals.css:1885` now sets `.entry-columns { display: none }` under 580 px, and the entry lines table has no `thead` of its own. Measured at 375 px on CGP-01707: the words *debit* and *credit* occur **0 times** on the whole page; at 1512 px the same page shows them once each, in the `ACCOUNT DEBIT CREDIT` header. Scroll a block fully right, which is what the fix now asks a phone reader to do, and the account column leaves the view too: what remains is two unlabelled money columns. The comment's claim, "It is aria-hidden, so nothing is lost with it", is true for assistive technology and false for the sighted phone reader the fix was written for. **Correction:** move the three labels inside the scroller (a real `thead` on `table.entry-lines`, which would then scroll with its columns), or keep the strip and let it scroll with the block. Evidence: `ua04-journal-375.png` and `ua04-journal-375-scrolled.png`. |
| **F-LU-03** | LOW | **The new scroller is a focusable `div` with a name ARIA does not allow it to have.** `components/journal-table.tsx:105` renders `<div className="entry-lines-scroll" tabIndex={0} aria-label={...}>` with no `role`. A bare `div` maps to `role="generic"`, and `aria-label` is prohibited on `generic`; Chromium exposes the name anyway (measured: role `generic`, name `endorsement_commission_earned lines`), other engines are free not to. Every other scroller on this site uses `role="region"` plus `aria-label` plus `tabIndex`. The comment's reason for avoiding `region` is sound (eight landmarks on one page). **Correction:** `role="group"`, which takes a name and is not a landmark. One word. |
| **F-LU-04** | LOW | **F-B13-34's chip is on the staff and broker policy page and not on the customer's view of the same policy.** The chips were added to `app/policies/[policyId]/page.tsx`; the customer is served by `app/policies/[policyId]/customer-view.tsx`, which renders one chip (`bound`) and no mode label. Measured: `LIVE SANDBOX` occurs **0 times** on the customer's `/policies/<CGP-01707>`, and 1 time on the staff view of the same URL. **Not an AF-02 violation:** the customer's page displays no simulated record, and the shell's `Sandbox` chip is present. It is the same "one route of two" shape as F-UA-01, on the route whose reader is the insured. |
| **F-LU-05** | LOW | **The customer list drops the "on the policy record" wording the other two lists now carry.** `app/customer/page.tsx:198` calls the same `termsInForceOn` helper but reads only `.annualPremiumCents` and never `.onDate`, so the voided CGP-01061 is printed as `$1,200.00` with nothing saying the fold could not rebuild the policy on that date. The broker and staff lists both print the note there, and both carry a disclosure explaining it; the customer list has neither. **Correction:** the three lines `app/broker/page.tsx` already has, or one sentence in a disclosure. |
| **F-LU-06** | LOW, disclosure | **F-B13-60's test proves the sections, not the tasks.** The new assertion compares each role's sections with `INBOX_ANCHOR_OWNER`, both ways. The risk its own comment names, "a broker task typed `anchor: \"claims\"` compiles and sends a broker to a section only staff have", lives in `lib/inbox/tasks.ts`, which the test does not touch: `brokerTasks`, `customerTasks` and `staffTasks` are private and read the database, so a unit test cannot call them without one. The map is also hand-written, so the test proves the two agree, not that the map is right. Recorded as the honest residue of the fix, not as a defect. |
| **F-LU-07** | LOW, disclosure | **Counter names are gone; duplicate names are not.** On CGP-01707 nine regions are named *Amount calculation details* and six *Journal entries behind this amount*; on CGP-01274, fourteen and nine. Each is inside its own fold, directly under the amount it explains, which is why I do not call it a defect: a reader who opens one fold gets one region. But "two regions will share a meaningless name", the second half of F-B13-33's own sentence, is still true of a page taken as a whole. **Correction, if ever wanted:** carry the amount's own label into the name, as `BreakTable` now carries `label`. |
| **F-LU-08** | LOW, cosmetic | **The refund banner says "is" for a count that can be more than one.** `"${waitingForApproval} is waiting for an approver"` reads "2 is waiting" on two refunds. The four sibling branches share the shape ("2 is recorded and owed", "2 is completed") and predate this change, so this is a note on a pattern rather than a regression: the rewritten branch inherited it. `plural()` already exists in `lib/inbox/tasks.ts`. |

**No finding in this scope engages AF-01 to AF-05.** AF-06 is the walkthrough, open by definition.

### Automatic-fail mapping for this scope

| Rule | Applicability here | Result |
|---|---|---|
| AF-01 | reviewed on the deployed URL, not localhost | PASS for this scope |
| AF-02 | do the changed screens claim a simulation is live | PASS: 30 of 30 screens keep the sandbox chip, the three new mode chips name the real slot of the money on their page, and the one screen without a per-slot chip (F-LU-04) displays no simulated record |
| AF-03 | is any money row written or rewritten | NOT ENGAGED: every change is presentation or a read path. The broker list adds two reads per policy (`policyDetail`, `policyAsItStoodOn`) and writes nothing |
| AF-04 | sandbox only, seeded identities | PASS: only `example.com` identities, `cs_test_` / `pi_` / `re_` test ids, no form submitted, $0 spent |
| AF-05 | no secret in this record or its evidence | PASS: `DEMO_PASSWORD` was loaded with `process.loadEnvFile` and never echoed; the 12 PNGs were each opened and reviewed. `ua05-ops-approvals.png` shows the MCP key **prefix** `cmk_...`, which is the identifier the application itself prints on that screen for every operator (the presented key is the prefix plus 43 further characters, `lib/mcp/key-format.ts`), plus two sha256 digests and a Stripe test id. `gitleaks protect --staged --redact` was run before the commit |
| AF-06 | can these files be defended line by line | Section 7; walkthrough **NOT REVIEWED WITH YOANN** |

---

## 5. The F-UA-01 figures, checked against each other

The point of item 1 is that three screens stop disagreeing, so all three were read on the same
revision within four minutes:

| Policy | `/broker` (broker@) | `/ops/policies` (ops@) | `/customer` (customer@) |
|---|---|---|---|
| CGP-01707 | `$1,253.20` | `$1,253.20` | `$1,200.00` annual premium in force |
| CGP-01274 | `$2,391.33` | `$2,391.33` | not this customer's |
| CGP-01062 | `$3,556.84` | `$3,556.84` | not this customer's |
| CGP-01061 (voided) | `$1,253.20` + `on the policy record` | `$1,253.20` + `on the policy record` | `$1,200.00`, **no note** (F-LU-05) |

`$1,253.20` is `$1,200.00` annual premium + `$28.20` CA premium tax at 2.35% + `$25.00` policy
fee, which is what the policy page prints under *Terms in force on 2026-09-09*, and the
endorsement to `$2,400.00` effective 2026-10-08 is named below it rather than folded into it. The
three screens now ask one helper, `lib/policy/terms-in-force.ts`, for one date.

---

## 6. F-B13-31: my answer to the question asked

**Do I agree with leaving it? Yes.**

The note's argument is not a preference, it is the documented behaviour of the framework. The
Next.js documentation states that streaming begins when a Suspense fallback renders, that "once
streaming begins, the HTTP response headers and status code have already been sent to the client
and cannot be modified", that a mid-stream `notFound()` becomes a noindex meta tag instead of a
404 header, and that a mid-stream `redirect()` converts into a client-side redirect. A
`loading.tsx` is exactly such a boundary, above the page. This repository already paid for that
once: `docs/STATUS.md` records F-UI-00, the root loading boundary that turned every anonymous or
malformed request into a streamed 200 shell, and its removal.

Measured today on the deployed revision, signed out: nine protected addresses answer **307** to
`/login` and, signed in, a malformed id answers **404**. That is the property a loading boundary
would cost, and it is the property an external check of the deployed URL has to see (AF-01).

**Should the finding stay open, be disclosed, or be re-scoped? Re-scope, then disclose.**

Re-scope it to **"refusals above the Suspense boundary"**, which is the real work and is honest
about the order: each page's session check and id check have to move above its own boundary
before any named loading state can be added below it. The register's own alternative, "record
streamed rendering as the deliberate loading design in the handoff", is only half taken: the
record is in `app/layout.tsx`, which is code. A reviewer who reads the handoff and never opens
that file still finds nothing. **One line in `docs/STATUS.md` or the README closes the disclosure
half.** That is the only thing I would ask for here.

Two smaller remarks on the note itself. It is 22 lines above `export const metadata`, in a file
that has nothing to do with loading; the builder's reason ("this is where the next person will
think of adding one") is a good one and I would keep it. And its central claim, the nine refusal
cases answering 200 with the loading body under seven boundaries, is the builder's local
experiment: **I did not reproduce it** (section 9). The mechanism is documented and the repo's own
history corroborates it, which is why I accept the conclusion; the specific counts are theirs, not
mine.

---

## 7. READABLE-CODE.md on the changed files

**`app/broker/page.tsx` is the clearest change of the batch.** Seven lines of comment say what the
column used to be, why it was wrong and who it was wrong for ("The broker is the person who sells
the policy"), then eleven lines of code fold each policy with the helper the other two screens
use. The date rule, `today > policy.effectiveAt ? today : policy.effectiveAt`, is written once
here and once in `app/customer/page.tsx:196`, in the same words: **duplicated, but visibly
duplicated**, which is the readable failure mode. `lib/policy/terms-in-force.ts` would be the home
for it if it ever moves.

**The approvals rewrite says the true thing in the user's words.** "It is cumulative ... so a
payout cannot be split into sub-threshold pieces to skip the approver" is the rule of
`lib/approvals/threshold.ts` stated as a consequence a reader cares about, with the file named
beside it. That is what the finding asked for.

**`components/amount-explained-motion.tsx` is the one place a reader has to slow down.** The test
is four lines: collect every `[data-trace-entry]`, find the first whose value is this entry, return
unless it is me. Two things to name in a walkthrough: `document.querySelectorAll` returns document
order, which is what makes "first" stable, and `dataset.traceEntry` is the camel-cased reading of
`data-trace-entry`. Both are one sentence. The comment already says why no shared state is needed.

**`app/globals.css` teaches the one CSS idea it needs.** "A grid item's default minimum size is its
CONTENT" is the whole reason `min-width: 0` fixes anything, and it is written where the rule is.
The 580 px block explains why the header is dropped; F-LU-02 is that the explanation is right about
the mechanism and wrong about the consequence.

**`lib/inbox/sections.ts`'s new map is a good shape.** `Record<keyof typeof INBOX_ANCHORS, ...>`
makes TypeScript demand all twelve entries, so the map cannot silently fall behind the anchors. The
comment says exactly what the type cannot express and why.

**Nothing in this batch is financial math.** No formula, no rounding, no allocation changed. The
one arithmetic-shaped change, folding each broker policy to its terms on a date, calls the existing
pure helper and adds nothing of its own.

---

## 8. Checks actually executed

| Check | Result |
|---|---|
| `/api/health` before the first and after every measurement run | `389030078659e1b1f054cee78c7d5822b5018b1d`, 12 times |
| Three policy lists, four roles, cell by cell | broker and ops identical; customer consistent on a different column |
| Broker disclosure, opened and read | present, same reading rule as the staff list |
| `/ops/approvals` lead, empty state, disclosure, closed-state column widths | both cases named in all three; What column 121.2 px, one line, page 1512 |
| Endorsement schedule: five header overflows, adjacent-pair bleed, fold width | 0 px, 0 bleeds, 122.5 px |
| Journal at 375 px and 1280 px, closed and with a fold clicked open | doc scrollWidth 375 and 1280; 8 scrollers 277/640 then 504/504; 17 of 17 amounts reachable |
| `?asOf=not-a-date&asOf=2026-10-08` against the single-value control | identical one-value refusal |
| Region labels on the policy, reconciliation, statements and run screens, plus a repo-wide grep | no counter anywhere; 63 labels inventoried |
| Mode chips on two policies and a statement run | as specified |
| `scrollIntoView` counted from before the page's script, on a two-fold entry and a one-fold control | 1 call each |
| Console 360 of CGP-01062, both tables | operations table fixed; timeline table not (F-LU-01) |
| `/ops` action cards as ops and as approver, and `/ops/mcp-keys` as approver | 5 cards, 4 cards, redirect to `/ops` |
| Endorsement preview, GET, `+$50.00` on CGP-01707, nothing submitted | new sentence present, "since issuance" absent |
| `/ops?error=x` and `/broker?error=x` DOM shape and geometry | same class chain, x=305, width=1150 |
| `npm test` | 473 pass, 0 fail, 1 skipped |
| Mutation test on `INBOX_ANCHOR_OWNER`, then reverted | exactly one test fails; tree clean afterwards |
| 32 role-and-path renders, GET only, nine stack-trace markers | 30 x 200, 2 x 404, 0 markers |
| `INBOX_ANCHORS` and the `Decision` form at `3890300^1` and `3890300` | byte-identical, both |
| Nine anonymous refusals on production | 9 x 307 to `/login` |
| Accessible role and name of `.entry-lines-scroll` against a `role="region"` control | `generic` + name, against `region` + name (F-LU-03) |
| `gitleaks protect --staged --redact` before the commit | run; result in section 10 |

---

## 9. What was not verified

- **The builder's `loading.tsx` experiment.** Seven boundaries, nine refusal cases, 200 with the
  loading body, then 307 and 404 with the files removed: that is their local production build and
  I did not rebuild it. I verified the mechanism in the framework documentation and the current
  refusal statuses on production instead. The counts in the note are theirs.
- **The refund banner rendered.** No refund is waiting for approval on production and I created
  none. The branch was read, not seen.
- **The approvals decision form rendered.** Nothing is pending. Read at both revisions and
  compared; nothing submitted.
- **`app/error.tsx`.** No server exception occurred and I induced none.
- **Anything between 375 px and 1280 px.** Three widths were measured: 375, 1280, 1512.
- **The endorsement and correction approval pages.** No pending request exists and I created none.
- **Whether F-LU-01 also shows on the broker, customer and claim 360 pages.** `subjectTimeline`
  serves all of them and the reference search, so it almost certainly does; I measured it on the
  policy 360 of CGP-01062 only.
- **PDF contents.** Out of this scope.
- **Yoann's understanding.** Nothing here establishes it.

---

## 10. Verdict

**FAIL for the cycle**, on **F-LU-01**: item 12 of the seventeen, F-INT-20, is closed on one table
of the console 360 and left open on the other table of the same screen, where a green `succeeded`
chip still sits beside `Your card was declined.` and the decline now carries the success's
timestamp. The correction is the four lines the fix already wrote in `components/console-360.tsx`,
applied in `lib/console/read.ts:2888`.

**The other sixteen items are supported, each with a measurement.** The three policy lists agree,
the approvals screen names both sub-threshold routes in all three places a reader looks, the
endorsement schedule has no header overflow and a 122.5 px fold, the journal is fully reachable at
375 px with the page still 375 px wide, the repeated `asOf` refuses one value, no scroll region is
named by a counter anywhere in the repository, the three mode chips are in their headings, the
per-role inbox test is real and non-vacuous, one arrival runs one scroll, the approver is no longer
offered the keys card, the preview sentence is the one Yoann asked for, the two homes render one
notice shape, and the 32 role-and-path renders still answer without a stack trace with the anchors
and the decision form byte-identical.

Fixing F-LU-01 takes this to PASS. F-LU-02 and F-LU-03 are cheap and belong to the same journal
component this cycle just touched. F-LU-04 and F-LU-05 are the customer's half of two items closed
on the staff and broker halves. F-LU-06, F-LU-07 and F-LU-08 are disclosures.

**Walkthrough status: NOT REVIEWED WITH YOANN.**

---

## 11. Register lines for `docs/reviews/FINDINGS.md`

The coordinator owns that file. These are the lines to append:

| ID | Sev | Finding (one line) | Fix | Status |
|---|---|---|---|---|
| F-LU-01 | LOW | F-INT-20 fixed on the console 360 operations table and not on the timeline table of the same screen: `subjectTimeline` (lib/console/read.ts:2888) prints `detail: failureReason` beside a green succeeded chip, dated with the SUCCESS time (10:16:02) not the decline's (10:00:19); affects every 360 page and the reference-search trail | The same branch console-360.tsx:222 already uses: print the reason only when the status is failed, otherwise date it or drop it | OPEN |
| F-LU-02 | LOW | The F-UA-04 fix hides `.entry-columns` under 580 px, and the entry lines table has no thead: at 375 px the words debit and credit appear 0 times on the policy page, and scrolling right also removes the account column | A real thead on table.entry-lines, inside the scroller, or let the strip scroll with the block | OPEN |
| F-LU-03 | LOW | `.entry-lines-scroll` is a focusable div with aria-label and no role; ARIA prohibits a name on role=generic (Chromium exposes it, other engines need not) | `role="group"`: a name without a landmark | OPEN |
| F-LU-04 | LOW | F-B13-34's `Stripe: LIVE SANDBOX` chip is on app/policies/[policyId]/page.tsx and not on customer-view.tsx, so the insured's own policy page has no per-slot mode label (0 occurrences against 1 on the staff view). No simulated record on that page, so not AF-02 | Add the same chips to the customer view | OPEN |
| F-LU-05 | LOW | app/customer/page.tsx:198 reads only `.annualPremiumCents` from termsInForceOn and drops `.onDate`, so the voided CGP-01061 prints $1,200.00 with none of the "on the policy record" wording the broker and staff lists now carry | The three lines app/broker/page.tsx already has | OPEN |
| F-LU-06 | LOW | F-B13-60's new test proves each role's SECTIONS match INBOX_ANCHOR_OWNER; the direction its comment names (a task naming another role's anchor) is in lib/inbox/tasks.ts, which is private and database-backed and the test does not reach | DISCLOSED: the residue is not cheaply unit-testable; note it in the handoff | DISCLOSED |
| F-LU-07 | LOW | Counter-named regions are gone repo-wide, but one page still carries fourteen regions named "Amount calculation details" and nine named "Journal entries behind this amount" (CGP-01274) | Carry the amount's label into the name, as BreakTable now carries `label` | DISCLOSED |
| F-LU-08 | LOW | The refund banner's rewritten branch says "N is waiting for an approver"; it reads "2 is waiting" on two refunds, a shape shared with the four sibling branches | `plural()` already exists in lib/inbox/tasks.ts | OPEN (cosmetic) |
| F-B13-31 | LOW | Re-scope to "refusals above the Suspense boundary": no loading.tsx is the right design, confirmed against the Next.js documentation and 9 x 307 measured on production; the layout.tsx note records it in code only | Re-scope, and put one line in the handoff (docs/STATUS.md or README) so the disclosure is where a reviewer reads | RE-SCOPE and DISCLOSE |
