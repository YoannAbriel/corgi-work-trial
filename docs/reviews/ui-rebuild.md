# Independent review: the screen rebuild (detail pattern) on every page

Reviewer: independent sub-agent, own worktree `worktree-agent-a2dbedb225d81e49d`.
Timestamp: 2026-09-08T20:21:23Z.
Reviewed revision: `e341f83` (`e341f8333dac26a90c41b34573ffaec279688377`), the revision the deployed
application reports at `/api/health`. Diff reviewed: `c5bcf2a..e341f83`, restricted to `app/`,
`components/` and `lib/claims/payments.ts`.
Working tree: clean at `bd74943` (a documentation-only commit on top of `e341f83`; the reviewed
code is identical at both).

**Verdict: FAIL**, on one MEDIUM finding (F-UI-22). Everything else in the declared scope passes.
The blocking finding is narrow: one function in `components/money-amount-input.tsx`. The rest of
the rebuild is sound and is recorded as passing below, so it does not need to be redone.

**Candidate walkthrough status: NOT REVIEWED WITH YOANN.** No part of this review establishes that
Yoann can explain these files. A reviewer cannot certify that on his behalf.

---

## Startup receipt

Files actually read in full before any conclusion, in the required order:

| File | Read |
|---|---|
| `CLAUDE.md` | yes (supplied in the session context, re-checked against the repository copy) |
| `AUTOMATIC-FAILS.md` | yes, all 69 lines |
| `READABLE-CODE.md` | yes, all 36 lines |
| `AGENTS.md` | yes, all 173 lines |
| `WORKFLOW-48H.md` | yes, all 72 lines |
| `REVIEWER.md` | yes, all 67 lines |
| `docs/reviews/ui-polish.md` | sections 1 and its findings/method (lines 1 to 145 and the section index); the previous PASS and its form/guard/mask method |
| `docs/reviews/FINDINGS.md` | the seven named register lines: F-YA-05, F-YA-06, F-UI-12, F-UI-20, F-UI-21, F-B8-09, F-B11-01 |
| `docs/STATUS.md` | the 19:46Z and 20:08Z entries in full |

Source files read in full: `components/detail-layout.tsx`, `components/journal-table.tsx`,
`components/money-amount-input.tsx`, `app/policies/[policyId]/claims/new/page.tsx`,
`app/policies/[policyId]/endorse/page.tsx` (and its diff), `app/policies/[policyId]/cancel/page.tsx`
diff, `lib/claims/payments.ts` diff, `lib/policy/read.ts:241-293`, `lib/money/cents.ts:1-52`,
`app/api/session/login/route.ts`, `app/api/jobs/reconcile/route.ts:1-45`, the relevant blocks of
`app/policies/[policyId]/page.tsx`, `app/ops/claims/[claimId]/page.tsx`,
`app/ops/reconciliation/page.tsx`, `app/statements/[runId]/page.tsx`, and the media queries and
journal rules of `app/globals.css`.

Not read, and why: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `GAP-REVIEW.md`,
`READINESS-BACKLOG.json`. This is an interface rebuild with no performance claim and no new
requirement; `AGENTS.md` allows selecting only relevant retained controls.

Next acceptance point for this scope and its check: F-UI-22 corrected, then a re-review of the
corrected `groupThousands` against the same typed-input table below.

---

## Scope and applicability

**What is under review.** A pure presentation rebuild: `components/detail-layout.tsx`
(DetailHeading, DetailGrid, Panel, Facts, AsideList, Chip, Empty), `components/journal-table.tsx`,
the money mask fix, and every screen rewritten into that pattern (policy, claim, broker, staff
policies, claims, brokers, customer, business verification, approvals, reconciliation, the two
statement lists, statement detail), plus three form pages that the policy page's forms moved onto.

**Confirmed facts.** Track 1, policy administration. Product money paths are Stripe sandbox
(premium and refunds) and a local claim payout simulator, both already reviewed elsewhere. The
identities are the five demo accounts. USD, integer cents.

**Applicability of external requirements.** This diff creates no new money path, no new provider
call, no new persisted fact and no new authorization decision. FinCEN CIP/CDD, OFAC and CFPB
product rules are not newly engaged by a layout change; they were mapped in the feature reviews
that own those flows. The requirements that genuinely apply here are AF-03 (nothing in this diff
may mutate a money row), AF-04 and AF-05 (no live keys, no secrets in the new files), AF-06
(readability), and the application's own role/ownership contract, which a rewritten page can break
silently. Those are what I tested.

**Assumptions.** The production database is the trial's sandbox database. `broker@example.com` owns
Redwood Commercial Brokers, which owns all four policies present, so no policy exists on production
that a signed-in broker does not own (see the limitation on the non-owning broker below).

---

## 1. Business logic untouched

`git diff --stat c5bcf2a..e341f83 -- db scripts app/api vercel.json` returns **nothing**. No
migration, no script, no route handler, no deployment configuration changed. `git diff --stat
c5bcf2a..e341f83 -- lib` returns exactly one file, `lib/claims/payments.ts`, 12 insertions and 1
deletion.

I read all 13 changed lines of `lib/claims/payments.ts`. The change is:

- a new field `requestedThrough: RequestChannel | null` on `ClaimPaymentView`;
- one correlated sub-select added to the existing `select`, reading
  `requested.payload -> 'requested_through'` from the first `payment_requested` claim event of that
  operation, ordered by `recorded_at`, `limit 1`;
- one mapping line that keeps the value only when it is an object.

It is a read. There is no `insert`, `update`, `delete`, `upsert` or `truncate` in the diff, no
transaction is opened, and every value crosses as a parameter (no `unsafe` interpolation). The
`payment_requested` event is the immutable event the write path already records, so the marker is
derived from the ledger's own provenance rather than from a mutable column. **AF-03 is not touched
by this diff.** Status: PASS.

## 2. Form contracts

I wrote my own extractor (in my scratch directory, not in the repository) that walks every `.ts`
and `.tsx` file under `app/` and `components/` at both revisions, finds every `form`, `input`,
`select`, `option`, `textarea`, `button` and `MoneyAmountInput` opening tag with a brace-aware
scanner, and records the attributes that define the server contract: `action`, `method`, `name`,
`value`, `defaultValue`, `type`, `required`, `disabled`, `checked`, `defaultChecked`, `min`, `max`,
`step`, `minLength`, `maxLength`, `pattern`, `multiple`, `readOnly`, `encType`, `formAction`,
`formMethod`. **168 entries at `c5bcf2a`, 170 at `e341f83`.** The 168 agrees with the previous
review's independent count at the same revision.

Comparing the contracts with the file path ignored (forms moved pages on purpose), the complete
difference is four lines:

| Change | What it is |
|---|---|
| `input name=asOf defaultValue={today}` becomes `defaultValue={documentDate}`, twice | The F-B8-09 fix on the two document date fields, expected in this range (register: FIXED b9636c2) |
| `+ form action=/api/jobs/reconcile method=post` | A second, field-less reconcile form, new. See F-UI-23 |
| `+ button type=submit` | That form's button |

**No field name, hidden field, action, method or numeric constraint of any existing form changed.**

Comparing form-to-file placement, the difference is exactly the three intended moves plus the new
one (38 forms before, 39 after):

| Form | c5bcf2a | e341f83 |
|---|---|---|
| `GET /policies/{id}/endorse` | `app/policies/[policyId]/page.tsx` | `app/policies/[policyId]/endorse/page.tsx` |
| `GET /policies/{id}/cancel` | `app/policies/[policyId]/page.tsx` | `app/policies/[policyId]/cancel/page.tsx` |
| `POST /api/policies/{id}/claims` | `app/policies/[policyId]/page.tsx` | `app/policies/[policyId]/claims/new/page.tsx` |

I read the three moved forms side by side against their originals. The endorse form keeps the same
five fields (`newAnnualPremium`, `newPerOccurrenceLimit`, `newAggregateLimit`, `effectiveAt`,
`reason`) with the same `required`, `min`, `max`, `maxLength` and the same three `defaultValue`
expressions. The cancel form keeps `effectiveAt` and `calculationMethod` with its single
`pro_rata` option. The claim form keeps `claimantName`, `occurredAt`, `reportedAt` and
`description` with the same constraints. The only addition on each is a "Back to the policy" link,
which is an anchor, not a field. Status: PASS.

The endorsement confirmation form on the preview screen is untouched, including its six hidden
fields and the `quoteHash` that lets the server refuse a stale quote.

## 3. Role, ownership and uuid guards

I extracted every line under `app/` and `components/` matching `currentUser(`, `redirect(`,
`notFound(`, `.role`, `brokerId`, `customerId`, `isUuid`, `canAct`, `forbidden` or `unauthorized`
at both revisions, stripped line numbers and sorted: 268 lines before, 282 after. Reading the
content diff with the file path removed, **every difference is an addition**. No guard line was
deleted, weakened or moved after a render. The one line that disappears,
`redirect(...\"pick a cancellation date first\")`, is the old behaviour of `/cancel` with no date;
it is replaced by rendering the form, behind three new checks.

The three new form pages each re-derive the gate the policy page used to hold:

| Page | Guards, in order |
|---|---|
| `endorse/page.tsx:38-50, 181-195` | `currentUser` else `redirect("/login")`; `isUuid` else `notFound`; `policyDetail` else `notFound`; `isOwningBroker \|\| staff_ops`, and `status === "bound"`, else redirect with a reason; no endorsement already in progress, else redirect |
| `cancel/page.tsx:32-40, 239-253` | same four, without the in-progress check (the preview and the confirmation route apply the cancellation rules) |
| `claims/new/page.tsx:12-31` | `currentUser` else `redirect("/login")`; `isUuid` else `notFound`; `policyDetail` else `notFound`; `role !== "staff_ops"` redirects; `status` must be `bound` or `cancelled` |

The endorse preview path (the branch with query parameters) is byte-identical to `c5bcf2a` and
still passes the actor to `planEndorsement`, which refuses on the server.

Measured on the deployed application at `e341f83`, on the one **bound** policy (CGP-01707,
`3c3697b7`), for the five identities:

| Identity | `/policies/{id}` | `/endorse` | `/cancel` | `/claims/new` |
|---|---|---|---|---|
| anonymous | 307 to `/login` | 307 to `/login` | 307 to `/login` | 307 to `/login` |
| broker (owns it) | 200 | **200** | **200** | 307 to the policy (staff only) |
| customer | 307 to `/customer` | 307, "only the owning broker or staff operations can endorse a bound policy" | 307, same for cancel | 307 to the policy |
| ops | 200 | **200** | **200** | **200** |
| approver | 200 | 307, refused | 307, refused | 307 to the policy |

Path-id guards on the three new pages, as ops: a malformed id (`/policies/notauuid/...`) answers
**404** on all three, and a well-formed but unknown uuid answers **404** on all three. Same for
`/ops/claims/{id}` and `/statements/{id}`.

Full identity matrix over seventeen routes (the five identities x `/`, `/broker`, `/broker/kyb`,
`/broker/statements`, `/customer`, `/ops`, `/ops/policies`, `/ops/claims`, `/ops/brokers`,
`/ops/approvals`, `/ops/reconciliation`, `/ops/statements`, a policy, the three form pages, a
claim): 85 measurements, every one either 200 for an identity entitled to the screen or the same
refusal the code declares. Anonymous is redirected to `/login` on all sixteen protected routes.
A broker or a customer reaching any `/ops/*` screen is redirected to `/broker`.

One case deserves naming because it looks like a leak and is not: `/statements/{runId}` answers
**200 for the customer**, but the body is the refusal page, "This statement belongs to another
broker", with no statement line in it (I grepped the response: 2 occurrences of the refusal, 0
occurrences of any statement data). That gate at `app/statements/[runId]/page.tsx:60-69` is
byte-identical to `c5bcf2a`. Status: PASS.

## 4. No money computed in the browser

Three files carry `"use client"` in the whole application, the same three as at `c5bcf2a`:
`app/error.tsx`, `components/portal-frame.tsx` and `components/money-amount-input.tsx`. **The
rebuild introduced no client component.** `components/detail-layout.tsx` and
`components/journal-table.tsx` are server components with no state and no arithmetic;
`journal-table.tsx` only calls `formatCentsAsUsd` on integers that arrive from the database.

`ledgerSoFar` (`app/policies/[policyId]/page.tsx:769-789`) runs in the server component. It adds
integer cents from the journal lines the page already holds, with no proration, no rounding and no
division, and the page says so under the panel: "Sums of the journal lines listed on this page:
cash at Stripe in and out, the commission payable balance, the unearned premium balance. Nothing
here is recomputed from the terms."

I checked that claim rather than trusting it. From the rendered HTML of policy CGP-01274 on
production I parsed all 24 journal lines, summed them by account, and compared with the four
figures the page prints:

| Figure | Recomputed from the rendered lines | Printed on the page |
|---|---|---|
| Collected at Stripe | $2,391.33 | $2,391.33 |
| Refunded from Stripe | $2,081.09 | $2,081.09 |
| Commission owed to the broker, net | $41.81 | $41.81 |
| Unearned premium held | $0.00 | $0.00 |

Four matches out of four. Status for `ledgerSoFar`: PASS.

**The money mask: FAIL.** See F-UI-22. I copied `groupThousands` and `echoOf` verbatim out of the
component and ran them against a verbatim copy of `parseUsdAmountToCents`, in two ways: the value
**pasted** in one go (one call, which is what the previous review measured) and the value **typed
one character at a time**, which is what the component actually does, because it reformats on every
keystroke and feeds its own output back as the next state.

| Typed | Field after a paste | Server | Field after typing it | Server |
|---|---|---|---|---|
| `1 200,50` | `1 200,50` | REFUSED | **`120,050`** | **12005000 cents** |
| `1200,50` | `1200,50` | REFUSED | **`120,050`** | **12005000 cents** |
| `12.345` | `12.345` | REFUSED | `12.345` | REFUSED |
| `1.2.3` | `1.2.3` | REFUSED | `1.2.3` | REFUSED |
| `-5` | `-5` | REFUSED | `-5` | REFUSED |
| `1e3` | `1e3` | REFUSED | `1e3` | REFUSED |
| `1200` | `1,200` | 120000 cents | `1,200` | 120000 cents |
| `1,200.00` | `1,200.00` | 120000 cents | `1,200.00` | 120000 cents |
| `1200.50` | `1,200.50` | 120050 cents | `1,200.50` | 120050 cents |
| `$1,200.50` | `1,200.50` | 120050 cents | `1,200.50` | 120050 cents |
| `0.05` | `0.05` | 5 cents | `0.05` | 5 cents |
| `.50`, `12.`, `abc` | unchanged | REFUSED | unchanged | REFUSED |
| `007` | `007` | 700 cents | `007` | 700 cents |
| `2,000,000` | `2,000,000` | 200000000 cents | `2,000,000` | 200000000 cents |

The two amounts the assignment names as needing formatting, `1200` and `1,200.00`, are correct on
both paths. Four of the five amounts that must be left untouched are correct on both paths. The
fifth, `1 200,50`, is correct only on the paste path.

## 5. The journal blocks

`components/journal-table.tsx` renders `entry.lines.map(...)` with **no slice and no limit**: every
line of every entry it is given reaches the HTML. Only whole entries are folded, four visible and
the rest inside a native `<details>`, and both halves are in the served HTML. The reader
`journalEntriesOfPolicy` (`lib/policy/read.ts:241-293`, unchanged by this diff) has no `LIMIT` and
no filter beyond `entry.policy_id`, ordered `entry.recorded_at, entry.id, line.id`.

Rather than compare a test database against production data that differs from it, I audited the
rendered pages themselves, which is a stronger check for this question: a dropped line breaks its
entry's balance, and a dropped entry contradicts the fold's own count.

Policy CGP-01274 (`104d2966`), as ops on production:

| Entry type | Recorded (UTC) | Lines | Debit | Credit | Balanced |
|---|---|---|---|---|---|
| refund_completed | 2026-09-08 18:27:59 | 2 | 208109 | 208109 | yes |
| commission_clawback | 2026-09-08 18:27:59 | 2 | 30499 | 30499 | yes |
| refund_requested | 2026-09-08 18:22:10 | 3 | 208109 | 208109 | yes |
| premium_earned_to_date | 2026-09-08 18:22:10 | 2 | 27870 | 27870 | yes |
| claim_payment_settled | 2026-09-08 14:56:48 | 2 | 120000 | 120000 | yes |
| claim_payment_sent | 2026-09-08 14:56:00 | 2 | 120000 | 120000 | yes |
| claim_reserve_set | 2026-09-08 14:55:05 | 2 | 500000 | 500000 | yes |
| commission_earned | 2026-09-08 11:24:30 | 2 | 34680 | 34680 | yes |
| tax_and_fee_billed | 2026-09-08 11:24:30 | 3 | 7933 | 7933 | yes |
| premium_written | 2026-09-08 11:24:30 | 2 | 231200 | 231200 | yes |
| premium_collected | 2026-09-08 11:24:30 | 2 | 239133 | 239133 | yes |

11 entry blocks, 24 lines, **every entry balances**, order strictly descending by recorded time,
and the fold reads "Show all 11 entries (7 older)": 4 shown plus 7 folded equals 11. The four
ledger figures of section 4 recompute exactly from those 24 lines, which is independent evidence
that none is missing.

Policy CGP-01061 (`de2fb99f`), the voided one, as ops: 8 blocks, 18 lines, all balanced, newest
first, fold "Show all 8 entries (4 older)". The four originals and their four reversals are both
present and net to zero pairwise (120000/120000, 18000/18000, 125320/125320, 5320/5320). That is
AF-03 visible on the screen: nothing was deleted, the correction is a reversal beside the original.
The reversal blocks carry the `entry-reversal` tone, because reversal entries are named
`reversal_of_*` (`lib/ledger/reverse.ts:16`) and `toneOf` matches that prefix; I checked this
specifically because colouring a reversal by its original type would have misled a reader about
direction, and it does not.

Claim CLM-00212, as ops: 3 blocks, 6 lines, all balanced, newest first, no fold (3 is under the
threshold of 4). Status: PASS.

## 6. The agent-raised marker on the claim payments table

Measured on production as `ops@example.com`, on `/ops/claims/2f78c23c-17fc-4746-85dd-77f64d6db45a`
(CLM-00212). The payments table renders, on the payment whose approval request id is
`8148a717-5ad2-4e0e-9486-ff6ffeec05fd` (the rehearsal request that was rejected on purpose), a warn
chip reading:

> raised by an AGENT, key `cmk_e96f…`

exactly one occurrence, next to the human requester's name. The rendered value is the key **prefix**
the UI is designed to show, not a credential; the key itself was created and revoked during the
B12-1 rehearsal. The marker comes from `payment.requestedThrough` populated by the sub-select
reviewed in section 1, so it is read from the immutable `payment_requested` event, not from an
operational column. Status: PASS for the screen half of F-B11-01.

F-B11-01 remains **HALF**: the money rule (does any agent-raised payment queue regardless of
amount) is Yoann's decision and is still open. This review does not close it, and nothing in this
diff pretends to.

## 7. Responsive behaviour

**No browser tool was available to this reviewer, so nothing below was verified visually.** I read
the CSS instead and say so plainly.

`app/globals.css` gains 401 lines. The rebuild's own breakpoints are correct in principle:
`.detail-grid` collapses to one column at `max-width: 1100px` (line 1578) and `.detail-heading`
stacks its actions under the title at `max-width: 800px` (line 1583). The pre-existing 1100, 800,
580 and 600 pixel breakpoints are untouched, so at 375 pixels the sidebar becomes a wrapped nav,
`main` padding drops to 22 pixels and the card grids become single column.

The journal blocks are the one part with **no narrow-screen rule at all**: `grep` over
`app/globals.css` finds `.journal`, `.entry-columns`, `.entry-block`, `.entry-head`,
`table.entry-lines` and `col.amount-column` only at top level, never inside a media query. At 375
pixels the arithmetic is: 375 minus 44 (`main` padding at the 800 breakpoint) minus 48 (`.panel`
padding at the 1100 breakpoint) leaves about 283 pixels for a `table-layout: fixed` table whose two
amount columns are pinned at 128 pixels each, that is 256 pixels, leaving roughly 27 pixels for the
account name column before its own 24 pixels of cell padding. See F-UI-25. Yoann's specific
complaint that the tags wrapped over three lines is addressed: `.entry-tag` is
`white-space: nowrap` and `.entry-head` is a wrapping flex row, so the tag itself no longer breaks.

---

## Requirement matrix

| Requirement | Control / code location | Evidence | Status |
|---|---|---|---|
| Business logic untouched | `git diff c5bcf2a..e341f83 -- db scripts app/api vercel.json` | empty | PASS |
| The one lib change is a read | `lib/claims/payments.ts:751-760`, correlated sub-select | 13 lines read; no write verb, no `unsafe` | PASS |
| AF-03: no money row mutated | whole diff | no `insert/update/delete/upsert/truncate` anywhere in the reviewed diff | PASS |
| Forms keep method, action, names, hidden fields | 170 extracted contracts vs 168 | 4-line difference, all explained (section 2) | PASS |
| The three moved forms post the same names to the same routes | `endorse/`, `cancel/`, `claims/new/` pages | field-by-field comparison against `c5bcf2a` | PASS |
| Role, ownership, uuid guards still run before rendering | 282 vs 268 guard lines, additions only | 85 production measurements, section 3 | PASS |
| The three new form pages guard for themselves | `endorse:38-50,181-195`, `cancel:32-40,239-253`, `claims/new:12-31` | 20 production measurements, 404 on malformed and unknown ids | PASS |
| No money computed in the browser | three `"use client"` files, none new; `ledgerSoFar` server-side | 4/4 ledger figures recomputed from the rendered lines | PASS |
| The page says the ledger sums the journal | `app/policies/[policyId]/page.tsx:700-703` | the sentence is rendered | PASS |
| The mask formats `1200` and `1,200.00` | `groupThousands` | both give 120000 cents on both input paths | PASS |
| The mask leaves `12.345`, `1.2.3`, `-5`, `1e3` untouched | `groupThousands:82` | REFUSED on both input paths | PASS |
| The mask leaves `1 200,50` untouched | `groupThousands:87` | correct on paste, **wrong when typed**: 12005000 cents | **FAIL (F-UI-22)** |
| Journal shows every line of every entry | `journal-table.tsx:91-97`, `lib/policy/read.ts:241` | 24, 18 and 6 lines rendered; every entry balances | PASS |
| Journal newest first, fold holds the rest | `journal-table.tsx:32-34, 48-59` | descending on three pages; 4+7=11 and 4+4=8 | PASS |
| Agent-raised payment marked with the key prefix | `app/ops/claims/[claimId]/page.tsx:205-212` | one warn chip on the `8148a717` payment, on production | PASS |
| AF-04: no live keys, sandbox only | diff | no credential material added; labels `LIVE SANDBOX` / `LOCAL SIMULATOR` preserved on the reconciliation heading | PASS |
| AF-05: no secrets committed | `gitleaks 8.30.1` over `app/` and `components/` at this revision | `no leaks found`, 4.21 MB scanned | PASS |
| AF-06: the new code can be followed | `detail-layout.tsx` (98 lines), `journal-table.tsx` (102 lines) | read in full; see section on readability | PASS with one LOW |
| AF-01: reachable deployment at this revision | `/api/health` | `{"ok":true,"database":"ok","revision":"e341f833..."}` | PASS |
| Typecheck | `npm run typecheck` | clean | PASS |

### AF-06 readability of the new code

`components/detail-layout.tsx` is 98 lines for seven components, each one a plain function
returning plain HTML with no state, no branching beyond a null check and no arithmetic. The header
comment names the decision it implements and its date. `components/journal-table.tsx` is 102 lines
with one derived value, `toneOf`, whose only effect is a colour, and whose regexes are visible in
one place. Both are defensible line by line.

The rewritten screens got **smaller**, which is the right direction for AF-06:
`app/policies/[policyId]/page.tsx` 1053 to 966 lines, `app/ops/claims/[claimId]/page.tsx` 482 to
440. `app/globals.css` grew 1373 to 1774. One dense spot remains (F-UI-26).

---

## Findings

### F-UI-22 (MEDIUM, blocking) The money mask still turns a typed European amount into a US amount one hundred times larger

**Code location:** `components/money-amount-input.tsx:77-93`, `groupThousands`, and its use at
`:50-62` (`onChange`).

**Trigger.** Type `1200,50` into any money field, one character at a time, which is how a person
enters an amount. The field ends up containing `120,050` and the echo underneath reads
`= $120,050.00`. The server accepts it as **12005000 cents**. The intended amount was $1,200.50.
Typing `1 200,50` gives the same result.

**Why the fix did not hold.** The guard added for F-UI-12 at `:87`
(`/,\d{1,2}$/.test(bare) && !bare.includes(".")`) is correct, but it can only see a whole string.
The mask runs on **every keystroke** and feeds its own output back as the next value, so it never
receives the whole string. Traced step by step: `1` gives `1`; `1 ` gives `1` (the space is
consumed at `:78`); `1200` gives `1,200`; then the person's comma produces `1,200,`, which the
decimal-comma guard rejects because it does not end in one or two digits, so the comma is silently
dropped and the value returns to `1,200`; then `5` gives `1,2005` which regroups to `12,005`; then
`0` gives `120,050`. By the time the string would have matched the guard, the mask has already
destroyed the evidence that a decimal comma was typed. The previous review measured a single call
of `groupThousands` on the finished string, which is the paste path, and that path is genuinely
fixed. The typed path is not.

**Consequence.** The field submits a valid US amount that is not the one the person entered, on
`annualPremium`, `perOccurrenceLimit` and `aggregateLimit` when a broker issues a policy, on the
three endorsement amounts, and on `reserveAmount` and `paymentAmount` on the claim screen. This is
the same defect as F-UI-12, which the register currently records as FIXED. Two controls limit the
damage and neither removes it: the echo under the field shows `= $120,050.00`, so an attentive
person can see it; and a claim payment above $1,000 goes to the maker-checker queue, so a second
person sees the amount. A reserve, and a premium at issuance, get neither.

**Required correction.** Do not let the mask rewrite text it has not proved safe. Keep what the
person typed as the state and add separators only when the text already parses as a US amount, or
equivalently refuse to regroup as soon as the raw text contains a comma that is not followed by
exactly three digits and then a boundary. Whatever the shape, the fix must be tested on the
**typed** path, character by character, not on a single call, and the table in section 4 is the
test to rerun.

**Register line F-UI-12 needs correcting from FIXED to partially fixed** once this is dispositioned.

### F-UI-23 (LOW) A second, field-less reconcile form was added inside a diff declared "forms unchanged"

**Code location:** `app/ops/reconciliation/page.tsx:105-108` (new), alongside the pre-existing
windowed form now at `:219-227`.

The heading of `/ops/reconciliation` gained a "Reconcile both sources now" button that posts to
`POST /api/jobs/reconcile` with no `from` and no `to`, so the route applies its seven-day default.
It is **not a bypass**: `app/api/jobs/reconcile/route.ts:20-32` requires a `staff_ops` or
`staff_approver` session, or the cron bearer, and the job appends to its own two tables and moves
no money. But it is a new entry point added in a change whose stated contract was that forms were
untouched, it was not in the previous review's inventory of 168, and it runs a job that calls
Stripe with a single click and no confirmation. Correction: none required for correctness; disclose
it in the status entry so the form inventory stays a trustworthy baseline for the next review.

### F-UI-24 (LOW) The cancellation date can open on a value its own `max` forbids

**Code location:** `app/policies/[policyId]/cancel/page.tsx:262-269`.

`defaultValue={today > policy.effectiveAt ? today : policy.effectiveAt}` with
`max={policy.termEnd}`. On a policy that is still `bound` but whose term has already ended, the
field opens on today, which is greater than `max`, and the browser refuses to submit until the
person notices and changes it. This is exactly the class of defect that F-B8-09 named on the two
document date fields, and that this same diff fixed there. The endorse form already clamps:
`today > effectiveAt ? (today < termEnd ? today : termEnd) : effectiveAt`
(`endorse/page.tsx:234`). The cancel form does not.

The line is byte-identical to `c5bcf2a`, so this is **pre-existing and carried over**, not
introduced by the rebuild. It is in scope only because the line moved into a new file in this diff.
Correction: apply the endorse form's clamp.

### F-UI-25 (LOW, not visually verified) The journal blocks have no narrow-screen rule

**Code location:** `app/globals.css:1601-1607` (`.entry-columns`, `grid-template-columns:
minmax(0, 1fr) 128px 128px`) and `:1660-1667` (`table.entry-lines { table-layout: fixed }`,
`col.amount-column { width: 128px }`).

No media query anywhere in the file touches the journal. At 375 pixels the two 128 pixel amount
columns claim 256 of roughly 283 available pixels, leaving about 27 pixels of column, minus 24
pixels of cell padding, for account names such as "Claim payments sent and not yet settled on the
rail". The browser will either wrap that column to one short word per line or shrink the amount
columns under their `white-space: nowrap` content; the journal is not inside a `.table-scroll`
wrapper, so there is no local scroll to absorb it either way.

**I could not check this visually: no browser tool was available in this session.** The arithmetic
above is what I can stand behind; the exact rendering is not verified. Correction, if confirmed on
a real 375 pixel viewport: a `@media (max-width: 580px)` block reducing the amount columns to about
86 pixels and adding `overflow-wrap: anywhere` to `td.account`.

### F-UI-26 (LOW, AF-06) The policy page's notices are one eighty-line expression

**Code location:** `app/policies/[policyId]/page.tsx:133-212`.

Twelve chained conditionals build the `notices` array inline, several of them multi-line JSX with
nested ternaries inside. Every individual branch is clear and well commented, but the whole is a
single expression that has to be held in the head at once, which is the kind of thing AF-06 asks
Yoann to defend line by line. Correction, optional: lift it into a small `policyNotices(...)`
function beside `cancellationRefundNotice` and `endorsementNotice`, which already exist in the same
file. No correctness impact.

---

## Checks actually executed

| Check | Command or method | Result |
|---|---|---|
| Business logic isolation | `git diff --stat c5bcf2a..e341f83 -- db scripts app/api vercel.json` | empty |
| The single lib change | `git diff c5bcf2a..e341f83 -- lib` | one file, 12 insertions, 1 deletion, all read |
| Form contract inventory | own brace-aware extractor over both revisions | 168 vs 170, 4-line difference |
| Form placement | same extractor, grouped by file | 38 vs 39 forms, 3 intended moves plus 1 addition |
| Guard inventory | own extractor over `app/` and `components/`, both revisions | 268 vs 282, additions only |
| Money mask, paste path | verbatim `groupThousands`/`echoOf` against verbatim `parseUsdAmountToCents` | 18 cases, correct |
| Money mask, typed path | same, applying the mask per character | 18 cases, **2 wrong** (F-UI-22) |
| Journal audit, 3 pages | parsed the served HTML, summed debits and credits per entry | 22 entries, 48 lines, 0 unbalanced, order descending |
| Ledger figures | recomputed from the rendered journal lines | 4/4 match |
| Agent marker | production, `/ops/claims/2f78c23c...` as ops | 1 warn chip on the `8148a717` payment |
| Identity matrix | 85 authenticated requests to the deployed app | every status as declared |
| Bound-policy form pages | 20 requests, 5 identities x 4 routes | as declared |
| Path-id guards | 10 requests, malformed and unknown ids | 404 everywhere |
| Deployed revision | `GET /api/health` | `e341f8333dac26a90c41b34573ffaec279688377` |
| Typecheck | `npm run typecheck` | clean |
| Secret scan | `gitleaks dir app components --redact` | `no leaks found`, 4.21 MB |

## Checks not executed, and why

- **`npm test` and every `check:*` script.** The assignment forbids running write checks, and the
  known contention on the shared `corgi_test` database makes a concurrent run unsafe while other
  delegates are active. The reviewed diff changes no tested logic apart from one read query, and
  typecheck plus the production measurements cover what a rebuild can break.
- **A visual check at 375 pixels.** No browser tool exists in this session. F-UI-25 is reasoned
  from the CSS and is flagged as unverified. The two-column collapse and the heading stack are
  confirmed by reading the media queries only.
- **A broker who does not own the policy.** All four policies on the production database belong to
  Redwood Commercial Brokers, and `broker@example.com` is its broker, so no such request can be
  constructed there. The check is satisfied by reading
  (`isOwningBroker = user.role === "broker" && user.brokerId === policy.brokerId`, identical at both
  revisions) and by the customer's refusal on the same expression, but **it was not measured**.
- **A row-count comparison against `corgi_test`.** Its data differs from production, so the counts
  would not have been comparable to the pages I measured. I substituted a stronger check on the
  production pages themselves (balance per entry plus the fold count plus the ledger recomputation),
  which detects a dropped line or entry directly.
- **The endorse and cancel preview screens with parameters, and any form submission.** Every request
  in this review is a GET that writes nothing. No money row was read into a write path, and nothing
  was submitted.
- **Legal and regulatory research.** This diff engages no new external requirement; the flows it
  displays were reviewed in the feature reviews that own them.

## Verdict and residual limitations

**FAIL**, on F-UI-22 alone.

The rebuild itself is good work and is not what fails. Business logic is untouched, the one library
change is a read of an immutable event, every form keeps its contract, every guard survived and the
three new pages carry their own, the journal shows every line of every entry newest first with the
fold holding the rest, the ledger figures recompute exactly from what is on the screen, the
agent-raised marker renders on the right payment on production, and the new components are short
and explainable. Fifteen of sixteen scope requirements pass.

What fails is one function. `groupThousands` is applied per keystroke to its own output, and the
F-UI-12 guard cannot work under that regime. The consequence is a money field that submits a valid
amount one hundred times larger than the one typed, on the premium at issuance and on the claim
reserve, where nothing else catches it. Under `REVIEWER.md`, an observed violation of a declared
requirement of the scope is FAIL, and the register line recording F-UI-12 as FIXED is currently
inaccurate for the typed path. Fixing this is small, and a re-review of the corrected function
against the typed-input table above is all it needs.

Residual limitations of this review: no visual verification at any viewport; the non-owning-broker
refusal is verified by reading and by an equivalent role, not measured; no test suite was run; and
nothing here says anything about Yoann's understanding of this code, which remains
**NOT REVIEWED WITH YOANN**. Nothing in this review is a legal certification, and a technical PASS
on the passing items is not one either.

---

## Register lines for the coordinator

| ID | Sev | Finding (one line) | Fix | Status |
|---|---|---|---|---|
| F-UI-22 | MEDIUM | The money mask runs per keystroke on its own output, so the F-UI-12 guard never sees the whole string: typing "1200,50" or "1 200,50" yields "120,050", accepted by the server as $120,050.00 | Keep the raw text as state and group only text that already parses as a US amount; retest on the typed path, not a single call | OPEN |
| F-UI-23 | LOW | /ops/reconciliation gained a second, field-less form posting to /api/jobs/reconcile, absent from the previous form inventory (not a bypass: the route requires staff or the cron bearer) | Disclose it so the form baseline stays trustworthy | OPEN |
| F-UI-24 | LOW | The cancellation date defaults to today with max at the term end, so on a bound policy whose term has ended the field opens on a value it refuses to submit (same class as F-B8-09, pre-existing at c5bcf2a) | Apply the endorse form's clamp | OPEN |
| F-UI-25 | LOW | The journal entry blocks have no narrow-screen rule: at 375 px two fixed 128 px amount columns leave about 27 px for the account name; not verified visually, no browser tool | Narrow the amount columns under 580 px and allow the account name to break | OPEN |
| F-UI-26 | LOW | The policy page builds its twelve notices as one eighty-line inline expression, dense for an AF-06 line-by-line defence | Lift it into a policyNotices function beside the existing notice helpers | OPEN |
