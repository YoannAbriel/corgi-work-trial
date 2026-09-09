# Independent review: the policy Billing view (decision 43), evening batch 2

Reviewer: independent Claude sub-agent assigned by the coordinator. I did not write this code and
did not see it before the merge. Review performed 2026-09-09, roughly 20:19Z to 21:05Z (22:19 to
23:05 Europe/Zurich), in my own git worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/agent-a8868fea4d61b4c50`.

Reviewed revision: commit `5051e7a` ("ui(policy): a Billing view, so the money and whose card pays
are in one place", branch `worktree-agent-a4b3f79e88fb16537`) as merged at `ce22ea1`. Scope: the
diff `d26b5b4...ce22ea1`, 5 files, 646 insertions and 80 deletions. I merged `ui-evening-2` into my
worktree first (`aa25ad7`) and every runtime measurement below was taken on that merge head, whose
content for the five files in scope is identical to `ce22ea1`.

Deployed production revision at review time: `/api/health` reported
`d002f772404169ad8626a3adf368662a7b4e25b6`, which is BEFORE this slice. Production is therefore the
"before" reference, used only for the role-gating comparison, never as evidence about the new view.

Verdict: **FAIL**, on one HIGH finding, F-BL-01: on a voided policy the new "What was paid" table
states that $1,253.20 was paid, carrying a `cs_test_` Stripe reference, while the application's own
record for that policy says the entries were reversed and Stripe never collected the payment. The
customer's Billing view shows that row with no void context at all. Two MEDIUM and eight LOW
findings follow. Everything else in the slice checked clean: the two moved forms are
character-for-character the same POSTs with the same gates, the figures reconcile, the refusals and
the hostile inputs behave, 375 px has no overflow, typecheck and the 540 tests pass, gitleaks is
clean on the reviewed history.

Candidate walkthrough status: **NOT REVIEWED WITH YOANN**.

## Startup receipt

Actually read in full, in this order: `CLAUDE.md`; `AUTOMATIC-FAILS.md` (AF-01 to AF-06);
`REVIEWER.md`; `AGENTS.md`; `READABLE-CODE.md`. Read in the parts relevant to a check I ran:
`app/policies/[policyId]/billing-sections.tsx` (the whole new file, line by line),
`app/policies/[policyId]/correction-sections.tsx` (the views list, `openCollectionOf`,
`firstOpenCollection`, `CorrectionMoneyBadge`, `CorrectionCollectRows`, `CorrectionsExplained`),
`app/policies/[policyId]/page.tsx` (the ownership guard, the readers, the band actions, the Billing
block, `EndorsementInProgress`, `refundState`/`refundTone`),
`app/policies/[policyId]/customer-view.tsx`, `lib/inbox/sections.ts`, `lib/ui/views.ts`
(`pickView`, `inspectedReference`, `withParams`), `components/ui/table.tsx` (`Ref`),
`app/login/page.tsx`, `scripts/migrate.ts`, `scripts/seed.ts`,
`scripts/dev-on-test-database.ts`, the head of `scripts/check-correction-replay.ts`,
`docs/reviews/FINDINGS.md` (register format), `docs/reviews/ui-polish.md` (record format), and the
whole diff `d26b5b4...ce22ea1`.

No mandatory kit file was missing. Next acceptance criterion for this review: the Billing view adds
a screen and moves two money forms without changing what is posted, who may post it, or what the
figures say, and without telling any reader something the ledger contradicts.

Not authorised and not performed: any commit, any fix, any push, any deployment, any edit of
STATUS, PLAN, FINDINGS, COMPLIANCE-MATRIX, DECISIONS or README, any Stripe or provider call, any
`check:*` script, any POST to a checkout route, any write to any database. My only repository write
is this file. My only POST anywhere was `/api/session/login`, on localhost and on production, to
obtain a session cookie. I copied `.env.local` from the main checkout into my worktree to run the
application; it is git-ignored (`git check-ignore -v .env.local` → `.gitignore:20:.env*`), it was
never printed, and it is deleted at the end of this review.

## 1. Applicability

This slice is presentation. It adds no route, no migration, no provider call and no money path. It
moves two existing POST forms from one screen to another and adds three read-only tables built from
rows the page already read. The applicable rules are therefore AF-02 (a screen must not describe a
provider outcome that did not happen), AF-03 (nothing here may write), AF-05 (no secret in the
diff), AF-06 and `READABLE-CODE.md` (Yoann must be able to explain it), plus the product rule that
the same money must read the same on every screen. No US regulatory question is raised by a change
of screen; the existing entries in `docs/COMPLIANCE-MATRIX.md` are unaffected.

Confirmed facts: the two forms post to `/api/policies/<id>/corrections/<rebookEventId>/checkout`
and `/api/policies/<id>/endorsements/<requestEventId>/checkout`, both unchanged in this diff. The
server re-checks eligibility and ownership on both (unchanged files, out of scope but relied on).
Assumption I did not verify: that those two routes still behave as their own reviews established.
Nothing in this diff touches them.

## 2. Scope and the form census

`git diff d26b5b4...ce22ea1 --stat`:

```
 app/policies/[policyId]/billing-sections.tsx    | 365 ++++++++++++++++++++++++
 app/policies/[policyId]/correction-sections.tsx | 163 +++++++----
 app/policies/[policyId]/customer-view.tsx       |  62 +++-
 app/policies/[policyId]/page.tsx                | 127 +++++++--
 lib/inbox/sections.ts                           |   9 +-
 5 files changed, 646 insertions(+), 80 deletions(-)
```

`lib/` hunks: exactly one, in `lib/inbox/sections.ts`, and it changes one behavioural line plus the
four comment lines above it:

- removed: `href` was the template string `/policies/<policyId>?view=money#collect`
- added: `href` is now the template string `/policies/<policyId>?view=billing#collect`

`lib/ui/views.ts` is untouched, as claimed. No other `lib/` file is in the diff. No `loading.tsx`
was added (`--stat` has no such file).

Form census, `git diff d26b5b4...ce22ea1 | grep -E '^[-+].*(action=|method=|name=")'`, every line
listed:

| # | Sign | Line | Where |
|---|---|---|---|
| 1 | `-` | `method="post"` | correction collect form, `correction-sections.tsx` |
| 2 | `-` | ``action={`/api/policies/${policyId}/corrections/${correction.rebookEventId}/checkout`}`` | idem |
| 3 | `+` | `method="post"` | correction collect form, moved into `CorrectionCollectRows` |
| 4 | `+` | ``action={`/api/policies/${policyId}/corrections/${correction.rebookEventId}/checkout`}`` | idem |
| 5 | `-` | ``<form method="post" action={`/api/policies/${policyId}/endorsements/${request.eventId}/checkout`} className="inline-form">`` | `EndorsementInProgress`, `page.tsx` |
| 6 | `-` | `<input type="hidden" name="quoteHash" value={figures.quoteHash} />` | idem |
| 7 | `+` | `method="post"` | Billing block, `page.tsx:1309` |
| 8 | `+` | ``action={`/api/policies/${policy.policyId}/endorsements/${liveEndorsement.request.eventId}/checkout`}`` | `page.tsx:1310` |
| 9 | `+` | `<input type="hidden" name="quoteHash" value={liveEndorsement.request.figures.quoteHash} />` | `page.tsx:1313` |

Every removed form line has an identical added line:

- The correction form (1,2 → 3,4) is byte-identical, including `className="inline-form"` and the
  two `SubmitButton` labels, which I compared in the diff hunks.
- The endorsement form (5,6 → 7,8,9) is the same route, method, class and single hidden field. The
  action expression is textually different only because the component boundary changed:
  `policyId` → `policy.policyId` and `request` → `liveEndorsement.request`. In
  `page.tsx:693` the removed `EndorsementInProgress` was called with `policyId={policy.policyId}`
  and `endorsement={liveEndorsement}`, and inside it `const { request } = endorsement`, so the two
  expressions resolve to the same two values. The hidden `quoteHash` reads
  `liveEndorsement.request.figures.quoteHash`, which is the same `figures.quoteHash`.
- The button label expression is the same: the old form used `paymentInFlight`, defined at
  `page.tsx:1616` as
  `collection && !collection.isDead && collection.latestStatus !== "succeeded" && collection.checkoutUrl`,
  and the new form inlines exactly that conjunction on `liveEndorsement.collection`.

Additional forms in the diff: none. `<form`/`</form>` census over the diff shows three added form
blocks and three removed, matching the two moves plus the correction form's re-wrap.

Secret scan: `gitleaks detect --source . --log-opts "d26b5b4..ce22ea1 --all"` → 29 commits scanned,
**no leaks found**. A working-tree scan reports 8 hits, all of them in the `.env.local` I copied in
to run the application, which is git-ignored and deleted at the end; no hit is in a tracked file.
AF-05 PASS for this diff.

Dash check: `git diff d26b5b4...ce22ea1 | grep -cP '^\+.*[\x{2013}\x{2014}]'` → `0`. The 375 px
run below also reports no dash character in the rendered text.

## 3. Rendering, on the trial database, CGP-01707

`npm ci` clean, `npx next dev -p 3046`, stopped at the end by its port's PID. All page requests are
GET; the only POST is `/api/session/login`.

Sub-menu positions, read from the rendered navigation:

- broker, ops, approver: `Overview, Endorsements, Claims, Money, Billing, Timeline`. Billing sits
  between Money and Timeline, as claimed. (`POLICY_VIEWS` at `correction-sections.tsx:45`.)
- customer: `Overview, Billing, Documents`. Billing sits between Overview and Documents, as
  claimed. (`VIEWS` at `customer-view.tsx:50`; `customerPolicyViews` at `correction-sections.tsx:58`
  puts it in the same place on the six form pages.)

Broker `?view=billing`, 1440 px screenshot read
(`scratchpad/rvshot-broker/..._view_billing-1440-a-plain.png`):

- The agency-bill sentence renders first, verbatim: "The broker collects on the customer's behalf
  (agency bill). The card entered on the Stripe page is the customer's."
- "What is owed": empty state, "Nothing is waiting to be collected on this policy."
- "What was paid": four rows, `cs_test_b1nE65…` 2026-09-08 $1,253.20 policy premium;
  `pi_3UDf5YK6…` 2026-09-09 $1,127.24 delta effective 2026-10-08; `pi_3UDrw9K6…` 2026-09-09
  $287.69 delta effective 2026-10-01; "no reference read" 2026-09-09 $53.84 correction difference.
- "What is being refunded" is absent, because `WhatIsBeingRefunded` returns `null` on an empty list
  and this policy has no refund.
- There is no "What needs paying now" card and no `id="collect"`: the $287.69 delta is already
  collected on this database, so the delta Pay form is in its paid state (absent), not its unpaid
  one. I therefore could not exercise the delta Pay form on CGP-01707; see section 4.

Ops sees the same four rows and the same figures, with each reference a link into the inspector
(`inspect=cs_test_b1nE65…`, `inspect=pi_3UDf5YK6…`, `inspect=pi_3UDrw9K6…`, each preserving
`view=billing`). Approver sees the same tables and **no** form: `grep -c checkout` on the approver's
Billing HTML → `0`.

Customer sees the same four paid rows, the customer wording ("Your broker collects on your behalf;
the card entered on the Stripe page is yours."), plain non-clickable references, and no money form.
`grep -o '<form[^>]*>'` on the customer's Billing HTML returns exactly one form,
`<form action="/api/session/logout" method="post">`. `grep -c checkout` → `0`. The claim "no
`<form` in the HTML" is not literally true (the sign-out form is always there); the accurate and
sufficient statement is that the customer's Billing view contains no POST form to any money route.

The Money view no longer holds the two forms. On the broker's `?view=money` HTML, `grep -o
'checkout[^"]*'` returns nothing at all, and the only form is sign-out. Two `view=billing`
occurrences: the sub-menu item and the one-line link "Pay and collect on the Billing view" in the
correction block. The Endorsements view likewise has no checkout string and one such link. No
`view=money#collect` or `view=endorsements#…` link survives anywhere in `app/`, `lib/` or
`components/`.

Figure reconciliation, `\$[0-9,]+\.[0-9]{2}` extracted from each rendered view and compared:

- Billing: `$1,127.24`, `$1,253.20`, `$287.69`, `$53.84`.
- Every one of the four also appears on the Money view. Set difference
  `billing - money - endorsements` is empty, for the broker and again for ops. Nothing on the
  Billing tables appears nowhere else, so the 360 page was not needed to close a gap.

AF-02 line, verbatim on the Billing view for all four roles: "Stripe: LIVE SANDBOX · claim rail:
LOCAL SIMULATOR · bank check: LOCAL SIMULATOR". It is `WORKSPACE_MODES` in
`components/shell/app-shell.tsx:31`, printed by the shell on every view, so the new view inherits
it. The grey sandbox sentence "Sandbox providers and test data. No real money." is there too.

## 4. The open states, on a disposable database

CGP-01707 has nothing open, so I pointed a second server (port 3047) at the disposable database
`corgi_test` through `DATABASE_URL_TEST_APP`, **read only**: I ran no `check:*` script, wrote no
row, and made only GET requests plus the login POST. (I did not create a fresh database: every
`check:*` script that could build the fixtures refuses to run against any name but `corgi_test`,
`scripts/check-correction-replay.ts:110`, and running one would have written to a database shared
with other agents.) Two SELECT-only queries found policies with an unsettled correction difference
and with an uncollected endorsement delta.

Policy `0940810c-f82c-45cd-8d95-395ea75805d7`, `?view=billing` as ops (staff operations, so
`canPayTheDifference` is true):

- `id="collect"` is present, exactly once.
- The collect form renders:
  `<form class="inline-form" action="/api/policies/0940810c-…/corrections/9e923ca9-…/checkout" method="post">`,
  no hidden fields, the label "Continue the payment of the difference at Stripe". Same action
  shape, same method, same absence of fields as the removed one.
- The badge above it reads "$1,039.77 still to collect from the customer", followed by the
  customer-approval sentence, then the button, then "What is owed" with one row, `$1,039.77`,
  "Correction difference, effective date put right to 2028-06-09", Since `27 h`.

So the moved correction form and the anchor both work in their open state. The delta Pay form I
could **not** render: it is gated on `isOwningBroker`, and `corgi_test` carries only
`ops@example.com` among the demo accounts, so no session on that database is the owning broker of a
policy with an approved uncollected delta. Its correctness rests on the code comparison in section
2 and the role comparison in section 5. I record that as an unexercised path, not as a pass by
inference.

Policy `4e305edb-…` exercised the third table: "What is being refunded" renders two rows,
`no reference read / requested / $445.84 / "Recorded and owed. Nothing has been sent to Stripe
yet."` and the same for `$467.74`.

## 5. Roles

Which role had the Pay button on the Endorsements view before this slice: at the deployed
production revision `d002f77`, `app/policies/[policyId]/page.tsx:1518` gates it on
`standing.state === "approved" && isOwningBroker && !collection?.applicationRefusedReason`, i.e.
the owning broker only, with a note for everyone else. The new Billing block, `page.tsx:1299-1300`,
gates it on
`liveEndorsement.standing.state === "approved" && isOwningBroker && !liveEndorsement.collection?.applicationRefusedReason`
which is the same three conditions on the same three values. Role parity holds by construction. A live
comparison on production was inconclusive in both directions and I record it as such: CGP-01707 has
no approved endorsement in flight there either, so neither the broker's nor the ops' production
Endorsements view shows a Pay button today.

A customer never sees a POST money form on Billing: `CustomerPolicyView` is returned at
`page.tsx:125-129` before any of the staff rendering runs, and its Billing block
(`customer-view.tsx:412-443`) contains a `BillingSummary` and an `About` and nothing else. Verified
in the rendered HTML, section 3.

`canPayTheDifference` is `isOwningBroker || user.role === "staff_ops"` (`page.tsx:211`), unchanged,
and `CorrectionCollectRows` passes it straight through to `openCollectionOf`, so the approver gets
the badge and never the button.

## 6. Refusals and hostile input

| Case | Result |
|---|---|
| `?view=billing` signed out | `307` to `/login` |
| `?view=billing` on an unknown UUID | `404` |
| `?view=billing` on a malformed id (`not-a-uuid`) | `404` (`isUuid` guard, `page.tsx:114`) |
| `?view=billing#collect` with no open difference (CGP-01707) | `200`, no `id="collect"`, no "What needs paying now" card, no 500 |
| `?view=BILLING` | `200`, falls back to Overview: `pickView` returns `allowed[0]` for an unknown value (`lib/ui/views.ts:14-18`) |
| `?view=billing&inspect=<script>alert(1)</script>` | `200`, Billing renders, no inspector; the string appears twice in the Flight payload, both times as unicode escapes, never as a literal opening script tag |
| `?view=billing&view=money` (repeated parameter) | `200`, first value wins, Billing renders |

I could not test a broker reading another broker's policy: this database has a single broker, who
owns all four policies. The guard itself is unchanged by this diff (`page.tsx:122-131`) and its
behaviour for that case is `redirect("/broker")`, i.e. 307, as before. Recorded as not exercised.

## 7. 375 px, typecheck, tests

```
BASE=http://localhost:3046 ROLE=broker@example.com WIDTHS=375 OUT=review-billing-375 \
  PATHS="/policies/3c3697b7-33f8-45a4-beaf-5a1892fc9483?view=billing" node break.mjs

…view_billing @375 plain:          375x1495 band=109
…view_billing @375 folds open (2): 375x1869 band=109
…view_billing @375 scrolled:       BAND NOT STICKY top=522
```

No `HORIZONTAL OVERFLOW` line, no dash character, no browser error. The single finding, `BAND NOT
STICKY`, is not this slice's: the same script on `?view=money` at 375 px reports the identical line
with the identical `top=522`. At 1440 px the Billing view reports zero findings and the band is
sticky.

- `npm run typecheck` → clean, no output.
- `npm test` → `tests 541, pass 540, fail 0, skipped 1`.

## 8. The inbox

The broker's inbox has no "Correction differences to collect" item on this database, because
nothing is open on any of the four policies. The builder cited no unit evidence either: `grep -rn
"billing" lib/inbox/sections.test.ts` returns nothing, and no test anywhere asserts the href. So
the one behavioural `lib/` line in the slice is covered by neither a rendered item nor a test. What
I could check: the constant is `/policies/${policy.policyId}?view=billing#collect`
(`lib/inbox/sections.ts:242`), the anchor it names is emitted by `CorrectionCollectRows`
(`correction-sections.tsx:380`) and I saw that anchor render on `corgi_test` in section 4, on the
same view. The two halves therefore agree; the join itself is unexercised. Recorded, not blocking.

## 9. Findings

### F-BL-01, HIGH: a voided policy is told it was paid, and the customer is told it without a word of context

`app/policies/[policyId]/billing-sections.tsx:93-103`.

`billingRows` puts the issuance payment in "What was paid" on one condition and no other:
`payment && payment.latestStatus === "succeeded"`. It never asks whether the policy was voided or
whether those journal entries were reversed.

Trigger, on the trial database, policy CGP-01061 (`de2fb99f-8db4-4aa3-9ee5-827e444ab5ad`), which is
`voided`. Its own record says, verbatim, "Bound on 2026-09-08 through a locally signed webhook
during development (pi_local_fafe3cc4); **Stripe never collected this payment.** Reversed by the
coordinator per review finding F-B2-01 and Yoann's decision", and its Money view shows the four
reversal entries (`reversal_of_premium_written`, `reversal_of_commission_earned`,
`reversal_of_premium_collected`, `reversal_of_tax_and_fee_billed`).

The new Billing view of that policy shows:

```
What was paid
Stripe                                                         Paid on   Amount      What it paid for
cs_test_b1BblgFhUnCOfCMvMA7QNrlkZpcq4Fbc9tbMmQWsD8WRgnBmoXaCQPDsDl   not read  $1,253.20  Policy premium, tax and fee
```

On the broker's and staff's Billing view the void banner is at least printed above the tables
(`grep -c "locally signed webhook"` → 1). On the **customer's** Billing view it is not
(`grep -c` → 0): the customer sees a `voided` chip in the band, then a table headed "What was paid"
asserting $1,253.20 with a Stripe checkout-session reference, then an `About` paragraph the slice
itself wrote, "What was paid is every payment that reached us, with the reference the payment
provider gave it" (`customer-view.tsx:437-439`). For this row that sentence is false by the
application's own record. The customer's Overview does mention the void once; the Billing view does
not, and a reader who lands on `?view=billing` has no reason to go looking.

Consequence: a money screen states an outcome the ledger contradicts, to the party whose money it
is. This is the concern behind AF-02 (a provider outcome that did not happen must not be presented
as one) and behind AF-06 (Yoann has to be able to defend why the screen says "paid"). I am not
asserting an AF-02 disqualification: the integration inventory is honest, Stripe really is LIVE
SANDBOX, and the void record exists and is truthful. The defect is in this new view's reading of it.

Required correction: `billingRows` must not call an issuance payment "paid" on the operation status
alone. Either derive the paid list from the journal (which already carries the reversal), or pass
the void/reversal fact into `billingRows` and drop the row or mark it plainly as reversed; and give
the customer's Billing view the same void context the staff view carries. Note that `page.tsx`
already reads `voidCorrection` for its banner while `customer-view.tsx` reads nothing of the kind.

### F-BL-02, MEDIUM: a comment promises a shared refund vocabulary that the code does not share

`app/policies/[policyId]/billing-sections.tsx:166-181` against
`app/policies/[policyId]/page.tsx:1580-1592`.

`refundStateWord` and `refundStateTone` are introduced under the comment "kept here so the Billing
view and the Money view say the same word about the same refund". The Money view does not import
them. It keeps `refundState` and `refundTone`, which are line-for-line the same logic, private to
`page.tsx`. The exported pair and the private pair are two independent copies of one business rule,
free to drift, under a comment asserting they cannot.

Consequence: the next person to change a refund word changes one of the two and believes, on the
comment's word, that both screens followed. `READABLE-CODE.md` bans exactly this ("Comments explain
business reasons, constraints and non-obvious choices", not guarantees the code does not provide).

Required correction: delete `refundState`/`refundTone` from `page.tsx` and import the exported pair,
or delete the exported pair and the comment. One import line makes the comment true.

### F-BL-03, MEDIUM: "What needs paying now" can be a heading with nothing under it, and an owed delta with no button and no reason

`app/policies/[policyId]/page.tsx:1296-1337` and `billing-sections.tsx:107-116`.

The card is rendered when `(liveEndorsement && standing.state === "approved") || collectable`. Its
three children each have their own narrower gate. When the live endorsement is approved, the reader
is the owning broker, and `liveEndorsement.collection.applicationRefusedReason` is set, the form is
suppressed (line 1300) and the note is suppressed too (line 1325 requires `!isOwningBroker`); with
no open correction, `CorrectionCollectRows` returns `null`. The result is a card containing the
words "What needs paying now" and nothing else.

In the same state `billingRows` still lists the delta under "What is owed" (lines 109-116 do not
look at `applicationRefusedReason`), so the broker is told an amount is owed, is shown an empty card
headed "what needs paying now", and is given no button and no sentence saying why. Before this
slice the same condition simply drew nothing.

I did not reproduce this on data: no policy on either database is in that state. It is read from the
code, and the four conditions are all independently reachable.

Required correction: gate the card on what will actually be drawn inside it, and say in one line why
the delta cannot be collected when the application was refused, next to the owed row.

### F-BL-04, LOW: the inbox still sends "Pay the delta" to a page that has no Pay button

`lib/inbox/sections.ts:222-223`.

Two entries below the href this slice changed, the "Endorsement deltas to pay" item still points at
`/policies/${policy.policyId}`, the Overview. The Pay button is now on Billing, and the Overview
carries no pointer to it: the "Pay and collect on the Billing view" link lives inside
`EndorsementInProgress`, which `page.tsx:690` renders only under `view === "endorsements"`. A broker
who clicks "Pay the delta" in their inbox lands on a page with neither the button nor a link to it.

This is not a regression created by the diff (the href pointed at the Overview before too, when the
button was on Endorsements), but it is the same defect Yoann raised, left in the one function the
slice edited, and the slice's own comment claims "the band, the Money view and the Endorsements view
all point at the same place" while a fourth pointer does not.

Required correction: `/policies/${policy.policyId}?view=billing`.

### F-BL-05, LOW: "Paid on" for the issuance payment is a different fact from the day the money arrived

`app/policies/[policyId]/billing-sections.tsx:99-101`. Declared by the builder.

The column says "Paid on"; the value is `policy.boundAt`. On a policy bound by its payment the two
are within seconds of each other, so the cell is right in the ordinary case. It is empty ("not
read") whenever `boundAt` is null while the payment succeeded, which is precisely the two states
where a reader most wants the date: `paid_not_bound` (money at Stripe, binding refused, cash in the
suspense account) and `voided`. Observed on CGP-01061 in F-BL-01.

Required correction: read the day from the collection operation as the endorsement rows already do
(`collection.paidOn`), or label the column for what it holds.

### F-BL-06, LOW: "not started" in an age column

`app/policies/[policyId]/billing-sections.tsx:83-91` and `244`. Declared by the builder.

A policy awaiting its payment gets an owed row with `since: null`, printed as "not started" under a
heading "Since". The premium has been owed since the quote; it is the *record* that carries no
instant. In a column of ages, "not started" reads as a statement about the payment, which is a
different claim.

Required correction: print the quoted instant (`policy.quotedAt` is what the inbox uses for the
same item, `lib/inbox/sections.ts:207`), or write "no date recorded".

### F-BL-07, LOW: two phrases for one absence, in adjacent columns

`app/policies/[policyId]/billing-sections.tsx:218` ("no reference read") and `285` ("not read"). The
same row can carry both, as CGP-01707's correction-difference row does. One wording for a missing
value would read better and is a one-word edit.

### F-BL-08, LOW: the customer's About explains a table that is not on the page

`app/policies/[policyId]/customer-view.tsx:435-440` against `billing-sections.tsx:306-308`.
`WhatIsBeingRefunded` returns `null` on an empty list, so on most policies the customer reads "What
is being refunded is money on its way back to you, with what it is waiting for" under a page with no
such list. The staff `About` (`page.tsx:1356-1360`) has the same sentence and the same condition.

### F-BL-09, LOW: four extra money reads on every customer view, not only Billing

`app/policies/[policyId]/customer-view.tsx:74-90`. `checkoutOperationOfPolicy`,
`endorsementsOfPolicy`, `correctionsOfPolicy` and `refundOperationsOfPolicy` are inside the
unconditional `Promise.all`, so a customer opening Overview or Documents pays for the Billing
view's rows as well. Correct, just wasteful; the staff page has the same shape for other reasons.

### F-BL-10, LOW: non-null assertions that depend on an invariant held in another function

`app/policies/[policyId]/correction-sections.tsx:389-403`. `CorrectionCollectRows` writes
`correction.collection!` four times. The assertion is sound: the list was filtered on
`openCollectionOf(correction, canPay) !== null`, and `openCollectionOf` (lines 293-305) returns
`null` when `collection` is falsy. But the reader has to go and check that to know it, which is the
kind of leap `READABLE-CODE.md` asks to avoid. Destructuring the collection once inside the `map`,
after an explicit `if (!collection) return null`, removes all four.

### F-BL-11, LOW: "every button that takes money is here now" is not exact

`app/policies/[policyId]/page.tsx:1281-1286`. The issuance Pay form
(`page.tsx:406-409`, `/api/policies/<id>/checkout`) is in the band's `actions`, not on the Billing
view. It is harmless in practice, because the band is drawn above every view including Billing, so
the button is on the Billing screen; but it is not under the agency-bill sentence, and the comment
states an invariant that a future reader will trust. Either say "in the band and on this view", or
move it.

## 10. Register lines

| ID | Severity | Finding | Required action | Status |
|---|---|---|---|---|
| F-BL-01 | HIGH | The Billing view lists a voided policy's reversed issuance payment under "What was paid" with its Stripe reference, and the customer's Billing view carries no void context at all (CGP-01061, $1,253.20) | Derive the paid list from the journal or pass the void/reversal fact into `billingRows`, and give the customer's Billing view the void banner the staff view has | OPEN |
| F-BL-02 | MEDIUM | `refundStateWord`/`refundStateTone` in `billing-sections.tsx` are a second copy of `refundState`/`refundTone` in `page.tsx`, under a comment claiming the two views share one vocabulary | Import the exported pair from `page.tsx` and delete the private copies | OPEN |
| F-BL-03 | MEDIUM | "What needs paying now" renders as an empty heading when an approved delta has `applicationRefusedReason` and no correction is open, while the delta is still listed as owed with no button and no reason | Gate the card on its contents and print why a refused application cannot be collected | OPEN |
| F-BL-04 | LOW | The broker inbox item "Pay the delta" still links to the policy Overview, which has neither the Pay button nor a link to Billing | Point it at `?view=billing` | OPEN |
| F-BL-05 | LOW | The issuance row's "Paid on" is `policy.boundAt`, so it is empty exactly on `paid_not_bound` and voided policies | Read the day from the collection operation or rename the column | OPEN |
| F-BL-06 | LOW | An owed premium prints "not started" in the "Since" age column | Print the quoted instant or "no date recorded" | OPEN |
| F-BL-07 | LOW | "no reference read" and "not read" are two phrases for one absence in adjacent columns of the same row | Use one wording | OPEN |
| F-BL-08 | LOW | Both `About` blocks explain "What is being refunded" while the table is hidden when empty | Render the explanation only with the table, or render an empty state | OPEN |
| F-BL-09 | LOW | The customer page runs the four Billing money reads on every view, including Overview and Documents | Read them only under `view === "billing"` | OPEN |
| F-BL-10 | LOW | Four `correction.collection!` assertions in `CorrectionCollectRows` rely on an invariant held in `openCollectionOf` | Destructure the collection with an explicit guard inside the `map` | OPEN |
| F-BL-11 | LOW | The Billing block comment claims every money button is on this view; the issuance Pay button is in the band | Correct the comment or move the button | OPEN |

## 11. Checks executed, and checks not executed

Executed: the scope and form census above; `gitleaks` over `d26b5b4..ce22ea1 --all` and over the
working tree; the dash grep; the `loading.tsx` check; `npm ci`; `npx next dev -p 3046` against the
trial database and `-p 3047` against `corgi_test`, both stopped by their port's PID; GET renders of
`?view=billing`, `?view=money`, `?view=endorsements` and the Overview as broker, ops, approver and
customer; the figure reconciliation for CGP-01707 as broker and as ops; the four other policies on
the trial database; two open-state policies on `corgi_test`; the seven refusal and hostile cases;
the 375 px `break.mjs` run and a 1440 px one, plus a 375 px control run on `?view=money`;
`npm run typecheck`; `npm test`; the production `/api/health` revision and the code at that
revision for the role comparison; a line-by-line read of `billing-sections.tsx`.

Not executed, and why:

- **The endorsement delta Pay form in its unpaid state.** No session on either database is the
  owning broker of a policy with an approved uncollected delta. Its correctness is established by
  code comparison (sections 2 and 5), not by rendering.
- **A broker reading another broker's policy.** One broker owns all four policies on the trial
  database. The guard is unchanged by this diff.
- **The inbox "Collect" item with its new href.** Nothing is open on the trial database, and no
  test covers the href. See section 8.
- **Any `check:*` script.** They write, and `corgi_test` is shared with other agents.
- **Any POST to a checkout route, any provider call, any deployment.** Out of authorisation.

## 12. Residual limitations

This is a scoped engineering assessment of one presentation slice, not a certification and not a
statement about the routes the two forms post to. F-BL-01 is a finding about what the screen says,
not a finding that any money moved wrongly: no money row was written, read or changed by this diff,
and the ledger itself is untouched and correct. Whether "What was paid" should hide a reversed
issuance payment entirely or show it struck through with its reversal is a product decision for
Yoann; both satisfy the correction, and the current screen satisfies neither. Candidate walkthrough
status stays **NOT REVIEWED WITH YOANN**: nothing here establishes that he can explain
`billingRows`, and F-BL-02 and F-BL-10 are the two places I would expect a line-by-line debrief to
stall.

---

# Re-review: the eleven Billing findings plus F-EV2-01, F-EV2-05 and F-EV2-06

Re-reviewed 2026-09-09, roughly 22:45Z to 23:25Z (2026-09-10, 00:45 to 01:25 Europe/Zurich), same
worktree, same reviewer.

Re-reviewed revision: commit `0259d6c4ed763db45fc574c13577d8cf4dd91d67` ("review: reversed money
reads as reversed, and a link only where a button is"), merged into `ui-evening-2` and reached
through `git merge ui-evening-2` in my worktree (`7a0345f`, whose `ui-evening-2` head is `b5929b2`,
above the `3411331` the coordinator named). The scope I re-read is `0259d6c^...0259d6c`:

```
 app/globals.css                                 |   7 --
 app/policies/[policyId]/billing-sections.tsx    |  89 +++++++++++++++----
 app/policies/[policyId]/correction-sections.tsx |  52 ++++++++---
 app/policies/[policyId]/customer-view.tsx       |  54 +++++++++---
 app/policies/[policyId]/page.tsx                | 112 +++++++++++++--------
 components/journal-table.tsx                    |  21 ++---
 lib/inbox/sections.ts                           |  14 +--
 7 files changed, 243 insertions(+), 106 deletions(-)
```

Two `lib/` href lines, as declared, and nothing else under `lib/`. The commit also carries the
LIVE-3 KYB wording, which is not mine and which I did not review.

**New verdict: PASS.** F-BL-01 (HIGH) and F-BL-02, F-BL-03 (MEDIUM) are resolved and, for F-BL-01,
verified on data for all four roles. F-BL-04 to F-BL-11 are resolved. F-EV2-01, F-EV2-05 and
F-EV2-06 are resolved, two of the three verified on data. Four new LOW findings, F-BL-12 to
F-BL-15, none of them blocking. The first-pass verdict of FAIL stands as the record of `ce22ea1`;
this PASS is for `0259d6c`.

Candidate walkthrough status: **NOT REVIEWED WITH YOANN** (unchanged; nothing in this round
involved Yoann explaining code back).

## The trial database moved between my two passes

CGP-01707 was `bound` with no refunds when I reviewed `ce22ea1`. It is now `cancelled` and carries
four completed refunds ($287.69, $832.85, $1,127.24, $53.84), from the LIVE-7 work in this same
batch. My first-pass figures for that policy are therefore no longer reproducible, and I re-ran the
reconciliation rather than reusing it. CGP-01061, the policy F-BL-01 turns on, is unchanged.

Three brokers now exist (`broker@`, `broker2@`, `broker3@`), which let me close one gap the first
pass had to leave open: see Refusals below.

## Finding by finding

### F-BL-01 (HIGH), RESOLVED, verified on all four roles

`billingRows` now takes `voidCorrection` (`billing-sections.tsx:82,90-92`) and attaches
`reversed: { reason, recordedAt }` to the issuance paid row (`:122-123`). `voidCorrectionOfPolicy`
(`lib/policy/read.ts:329-354`) selects the `correction_reversal` whose superseded event is the
`issued` one, so the fact attached is exactly "this policy's issuance was reversed" and not some
other correction. `WhatWasPaid` strikes the amount, adds a `danger` chip and prints the void
record's own sentence (`:320-338`). `customer-view.tsx:96-116` reads `voidCorrectionOfPolicy` and
`:502-512` prints the banner the staff page has.

CGP-01061 (`de2fb99f-…`), rendered:

```
What was paid
Stripe                          Bound on       Amount      What it paid for
cs_test_b1BblgFhUnCOfCMvMA7Q…   not recorded   $1,253.20   Policy premium, tax and fee  [reversed]
                                                           Reversed by a correction on 2026-09-08 11:33:17 UTC:
                                                           Bound on 2026-09-08 through a locally signed webhook
                                                           during development (pi_local_fafe3cc4); Stripe never
                                                           collected this payment. Reversed by the coordinator per
                                                           review finding F-B2-01 and Yoann's decision.
                                                           Nothing was collected and nothing stands.
```

Markup checked per role: `grep -o '<s>[^<]*</s>'` returns `<s>$1,253.20</s>` and
`grep -c 'badge badge-danger">reversed'` returns `1`, for broker, ops, approver **and** customer.
The customer's Billing view now opens with a red `role="alert"` block: "This policy was voided by a
correction on 2026-09-08 11:33:17 UTC: … Nothing was collected on it and it cannot be paid; a
replacement needs a new policy." The screen no longer states anything the ledger contradicts.

The strike is drawing only: the stored cents are printed unchanged, nothing is subtracted, and no
row was written. The distinction the builder drew between this `<s>` and the one removed from the
journal table (F-EV2-06) is sound and is written down where a reader will find it: a journal entry
is a posting that stands, a reversed issuance is money that never arrived.

### F-BL-02 (MEDIUM), RESOLVED

`page.tsx:86-87` imports `refundStateTone` and `refundStateWord` from `./billing-sections`; the
private `refundState` and `refundTone` are deleted, and the Money view's refund chips call the
imported pair (`:1347`). One rule, one copy, and the comment in `billing-sections.tsx` is now true.
Rendered check: the four refund chips on CGP-01707's Money view read `completed` with the `ok`
tone, as before.

### F-BL-03 (MEDIUM), RESOLVED by construction

The card is gated on `deltaIsPayableHere || collectable` (`page.tsx:1494`), where
`deltaIsPayableHere` (`:258-263`) is the Pay form's own condition minus `isOwningBroker`, and the
`!isOwningBroker` half is covered by the note at `:1523-1528`. With F-EV2-01, a non-null
`collectable` now implies `canPayTheDifference`, which is the same flag `CorrectionCollectRows`
filters on, so a non-null `collectable` guarantees at least one row inside. I traced all four
combinations: there is no longer a state in which the heading is drawn over nothing.

The owed row of a refused-application delta carries its reason
(`billing-sections.tsx:137-141`, rendered by `:270-274` as a `dt-sub` line): "Paid, not applied:
<reason>. Staff operations apply it once that is put right." Read-verified only: no policy on
either database has an approved delta with `applicationRefusedReason`, so I did not see it render.
Same status as the builder declared.

### F-BL-04 and F-EV2-05, RESOLVED, the per-correction anchor verified on data

`lib/inbox/sections.ts:223-225` now points the delta item at `?view=billing#pay-delta`, and
`:240-247` points each difference item at `?view=billing#collect-<rebookEventId>`.
`collectAnchorFor` (`correction-sections.tsx:427-432`) builds the id, `CorrectionCollectRows`
(`:529-532`) puts it on every row unconditionally, and the band's `collectHref` (`page.tsx:237-239`)
uses the same helper for the correction it names.

On `corgi_test`, policy `0940810c-…` as ops:

```
id="collect-9e923ca9-1f6e-4054-9175-63cb16accacc"
<form class="inline-form" action="/api/policies/0940810c-…/corrections/9e923ca9-…/checkout" method="post">
band link -> view=billing#collect-9e923ca9-1f6e-4054-9175-63cb16accacc
```

The anchor, the form and the band's href name the same correction. The two-row case F-EV2-05 was
raised for is **not** exercised: no policy on either database has two open differences. The id is
built per row with no conditional, so the second row cannot collide with the first, but that is
read from the code.

`#pay-delta` (`page.tsx:1502`) is likewise present in the code and unexercised, for the same reason
the delta Pay form was unexercised in the first pass.

### F-BL-05, RESOLVED

The column header is `<th>Bound on</th>` (verified in the rendered HTML for all four roles), and
the comment at `billing-sections.tsx:303-306` says why. The column now names what it holds instead
of promising a date the page cannot read.

### F-BL-06, RESOLVED

The cell reads "no date recorded" (`billing-sections.tsx:276`). The builder's note that `quotedAt`
is not available is accurate and I checked it: `quotedAt` is on `PolicyListRow`
(`lib/policy/read.ts:18`) and on the summary type at `:531`, not on `PolicyDetail` (`:60`, whose
only instant is `boundAt` at `:80`). Reaching it would have meant changing a `lib/` reader, which
this slice was right not to do. Unexercised on data: no policy on the trial database is currently
awaiting payment.

### F-BL-07, RESOLVED

One wording, "not recorded", in both columns (`:245`, `:320`). Verified on CGP-01707: the
correction-difference row prints "not recorded" in the Stripe column, and CGP-01061 prints it in
the "Bound on" column.

### F-BL-08, RESOLVED

`WhatIsBeingRefunded` returns a card with an empty state instead of `null`
(`billing-sections.tsx:358-367`). Rendered on CGP-01061: "What is being refunded / No money is on
its way back on this policy." The `About` blocks now explain three cards the reader can see.

### F-BL-09, RESOLVED

`customer-view.tsx:86-116`: the view is picked first, the four money readers run only under
`view === "billing"`, and the other three readers stay unconditional with a comment saying why.
Verified from outside as well: on the customer's Overview and Documents views, a grep for
`cs_test_`, `pi_` and `re_` references returns nothing, while the Billing view carries them.

### F-BL-10, RESOLVED

`correction-sections.tsx:522-527` destructures `collection` once and returns `null` if it or `open`
is missing, with a comment saying the filter already refused that case. All four
`correction.collection!` assertions are gone.

### F-BL-11, RESOLVED

The Billing block comment (`page.tsx:1472-1483`) and the `EndorsementInProgress` comment
(`:1885-1887`) now say "the buttons that take money for a CHANGE", and name the issuance payment as
the band's own, deliberately not moved. `page.tsx:230-232` says the same at the href. The comments
match what the code does.

### F-EV2-01, RESOLVED in code, band case unexercised

`openCollectionOf` returns `null` when `!canPay` (`correction-sections.tsx:442-445`), so
`firstOpenCollection` is null for a reader who cannot collect, and the band tests `canCollectNow`
on top through `collectableNow` (`page.tsx:236`), which is what the "Collect $X" link and the
`Endorse` link's tone now read (`:540-552`). The two callers that state a fact rather than an
ability still pass a literal `true` and are unaffected: `CorrectionsExplained`'s badge on the Money
view (`:595`) and `billingRows`'s owed list (`billing-sections.tsx:159`). I checked both, because a
narrower `openCollectionOf` could have silently emptied the owed list for a customer; it does not.

Not exercised: no approver session exists on `corgi_test` and no difference is open on the trial
database, so I could not render the band for the reader the finding was about. Three lines of pure
code, read.

### F-EV2-06, RESOLVED, verified on data

`corgi_test`, policy `0940810c-…`, Money view, the four entries of the correction:

```
reversal_of_endorsement_premium_written   [undoes e4d01929]           $290.95 / $290.95
reversal_of_endorsement_tax_billed        [undoes 67562a31]           $6.83 / $6.83
endorsement_tax_billed                    [re-booked on 2028-06-09]   $30.71 / $30.71
endorsement_premium_written               [re-booked on 2028-06-09]   $152.38 / $152.38
```

`grep -c 'badge-danger">reversed'` on that page returns `0`, and a grep for `<s>…</s>` returns
nothing: the wording and the strike are both gone. The `struck` flag is deleted from `EntryMark`
and its CSS rule from `app/globals.css` in the same commit, so no caller can reintroduce it by
accident.

## New findings

### F-BL-12, LOW: the bare `#collect` anchor the comment promises does not exist

`app/policies/[policyId]/correction-sections.tsx:427-430` and `app/policies/[policyId]/page.tsx:239`.

The comment on `collectAnchorFor` says "The card that holds the rows keeps the bare `collect` id,
so a link written before this still lands on the right card". It does not:
`grep -c 'id="collect"'` on the rendered Billing view of the open-difference policy returns `0`, and
no `id={COLLECT_ANCHOR}` exists anywhere in `app/`. `COLLECT_ANCHOR` now survives only as the dead
fallback of `collectHref` (`page.tsx:239`), which cannot be reached because the band's link renders
only when `collectableNow` is non-null and then uses the per-correction anchor.

Consequence, small but real: the currently deployed production build's broker inbox still emits
`?view=billing#collect`, so until the next deployment those links open the Billing view and scroll
nowhere. And it is the same species as F-BL-02, a comment asserting an invariant the code does not
hold, which is what makes it worth a line rather than a shrug.

Required correction: put `id={COLLECT_ANCHOR}` on the "What needs paying now" `<section>`, or delete
the sentence and the fallback.

### F-BL-13, LOW: a double full stop in both new void sentences

`app/policies/[policyId]/customer-view.tsx:507` and `billing-sections.tsx:331-334`. The void
`reason` already ends in a full stop, and both new templates append ". Nothing was collected…", so
the screen prints "…per review finding F-B2-01 and Yoann's decision.. Nothing was collected…". It
renders that way for all four roles. The pre-existing staff banner has the same habit, which is
probably where it came from.

### F-BL-14, LOW: nothing tests the three functions this round changed

`billingRows`, `openCollectionOf` and `collectAnchorFor` are pure and are what F-BL-01, F-BL-03 and
F-EV2-01 turn on, and none of them has a test. The runner glob is
`lib/*/*.test.ts lib/*/*/*.test.ts` (`package.json`), so a test placed beside them under `app/`
would not even run. The suite grew from 540 to 553 passing in this batch, but the new cases are
`lib/ui/emphasis`, `lib/statements/group-runs` and `lib/auth/demo-accounts`, from other slices.

Consequence: the reversed-issuance rule and the "not this reader's money" rule are held by review
and by two rendered pages, not by anything that will fail when someone changes them.

Required correction (cheap): move the three pure functions into a `lib/policy/` module with a test,
or widen the test glob. Not blocking, and not worth doing under deadline if the walkthrough covers
them instead.

### F-BL-15, LOW: the customer's About still says every listed payment reached us

`app/policies/[policyId]/customer-view.tsx:452-455`: "What was paid is every payment that reached
us, with the reference the payment provider gave it." Directly under it, on CGP-01061, sits a row
saying the opposite about the only payment listed. The row wins and the reader is not misled, but
the sentence is now wrong in exactly the case F-BL-01 was raised for. One clause ("…, and a payment
a correction reversed is struck through") fixes it. The staff `About` (`page.tsx:1560-1564`) has the
same sentence and the same gap.

## Register lines, re-review

| ID | Severity | Finding | Required action | Status |
|---|---|---|---|---|
| F-BL-01 | HIGH | Voided policy's reversed issuance listed as paid | `billingRows` takes the void correction; struck amount, danger chip, the void record's sentence, and the banner on the customer's Billing view | RESOLVED at `0259d6c`, verified on CGP-01061 for all four roles |
| F-BL-02 | MEDIUM | Two copies of the refund wording under a comment claiming one | `page.tsx` imports the exported pair, private copies deleted | RESOLVED at `0259d6c` |
| F-BL-03 | MEDIUM | "What needs paying now" could be an empty heading; owed delta with no reason | Card gated on what it draws; `blockedReason` sub-line beside the owed row | RESOLVED at `0259d6c` (card verified by tracing; sub-line read-verified, no data) |
| F-BL-04 | LOW | Inbox "Pay the delta" pointed at the Overview | `?view=billing#pay-delta` | RESOLVED at `0259d6c` (anchor unexercised) |
| F-BL-05 | LOW | "Paid on" held the binding day | Column renamed "Bound on" | RESOLVED at `0259d6c`, verified rendered |
| F-BL-06 | LOW | "not started" in an age column | "no date recorded"; `quotedAt` genuinely unavailable on `PolicyDetail` | RESOLVED at `0259d6c` |
| F-BL-07 | LOW | Two phrases for one absence | "not recorded" in both columns | RESOLVED at `0259d6c`, verified rendered |
| F-BL-08 | LOW | Refunds card vanished while the About explained it | Card keeps its place with an empty line | RESOLVED at `0259d6c`, verified rendered |
| F-BL-09 | LOW | Four money reads on every customer view | They run only under `view === "billing"` | RESOLVED at `0259d6c`, verified from outside |
| F-BL-10 | LOW | Four non-null assertions | One guarded destructure | RESOLVED at `0259d6c` |
| F-BL-11 | LOW | Comment claimed every money button had moved | Comments corrected, issuance named as the band's own | RESOLVED at `0259d6c` |
| F-EV2-01 | MEDIUM | Band offered "Collect $X" to a reader with no button | `openCollectionOf` returns null when `!canPay`; band reads `collectableNow` | RESOLVED at `0259d6c` (read-verified; the approver's band unexercised) |
| F-EV2-05 | LOW | Every inbox difference row landed on the first correction | Per-correction anchor `collect-<rebookEventId>` | RESOLVED at `0259d6c`, one-row case verified; two-row case unexercised |
| F-EV2-06 | LOW | "reversed" and a strike on the entry that does the undoing | Chip says "undoes <id>", strike and its CSS deleted | RESOLVED at `0259d6c`, verified rendered |
| F-BL-12 | LOW | The bare `#collect` anchor the comment promises is not in the DOM; `collectHref`'s fallback is dead and deployed inbox links land nowhere | Put `id={COLLECT_ANCHOR}` on the actions card, or delete the sentence and the fallback | OPEN |
| F-BL-13 | LOW | Double full stop in both new void sentences | Trim the appended period | OPEN |
| F-BL-14 | LOW | `billingRows`, `openCollectionOf` and `collectAnchorFor` have no test, and the runner glob cannot pick up a colocated one | Move them under `lib/` with a test, or widen the glob | OPEN |
| F-BL-15 | LOW | The customer's About still says every listed payment reached us | Add the reversed clause to both About blocks | OPEN |

## Checks executed in this round

`git merge ui-evening-2`; the scope diff and its seven files read in full; the two `lib/` href
lines; `gitleaks detect --log-opts "0259d6c^..0259d6c"` → **no leaks found**; the dash grep on added
lines → `0`; no `loading.tsx`; `npm ci`; `npm run typecheck` → clean; `npm test` → `tests 554,
pass 553, fail 0, skipped 1`; `npx next dev -p 3046` on the trial database and `-p 3047` on
`corgi_test`, both GET-only, both stopped by their port's PID.

Renders: CGP-01061 `?view=billing` as broker, ops, approver and customer, plus the customer's
Overview; CGP-01707 `?view=billing`, `?view=money`, `?view=endorsements` and the Overview as broker,
plus `?view=billing` as ops, approver and customer, plus the customer's Documents view; on
`corgi_test`, `0940810c-…` `?view=billing` and `?view=money` as ops, and two approved-endorsement
policies. Figure reconciliation on CGP-01707 as broker: Billing shows `$1,127.24`, `$1,253.20`,
`$287.69`, `$53.84`, `$832.85`; the set difference against the Money and Endorsements views is
empty, and every one of the five is on the Money view.

Refusals and hostile input, all re-run and all unchanged: signed out → `307` to `/login`; unknown
UUID → `404`; malformed id → `404`; `?view=BILLING` → `200` on the Overview;
`?view=billing&view=money` → `200` on Billing; `?view=billing&inspect=<script>alert(1)</script>` →
`200`, escaped in the Flight payload, a grep for `<script>alert` returns `0`; `?view=billing#collect`
with nothing open → `200`, no anchor, no 500. **New this round**, and the gap the first pass had to
leave open: `broker2@example.com` on `broker@example.com`'s policies → `307` to `/broker`, for both
CGP-01707 and CGP-01061.

375 px, `break.mjs`: the customer's Billing view on CGP-01707 (375x1773) and on CGP-01061
(375x1880), and the broker's Billing view (375x1900). No `HORIZONTAL OVERFLOW` line, no dash
character, no browser error on any of them. Every run reports `BAND NOT STICKY`, and so does the
control run on the customer's Overview, so it is not this slice's.

Not executed, and why: the delta Pay form and `#pay-delta` in their unpaid state, and the
approver's band under F-EV2-01 (no owning-broker or approver session exists on `corgi_test`, and
nothing is open on the trial database); the two-open-differences case of F-EV2-05 and the
`blockedReason` line of F-BL-03 (no such data on either database); the inbox items themselves (no
open difference and no payable delta to list). No `check:*` script, no POST to a checkout route, no
provider call, no deployment, no database write. `.env.local` deleted again at the end.

## Out of scope, seen in passing

Two things arrived in this batch from commits that are not mine to review. I name them so the
coordinator can route them, and I make no finding about either:

1. **`app/api/session/switch/route.ts`** (new, 66 lines) and the "Demo accounts" list now in every
   sidebar. Any signed-in demo user can become any other demo account, including a customer
   becoming `staff_ops` or `staff_approver`, without the shared password. It is gated on an existing
   session, a closed email list and a non-`agent` target, and it writes an activity row naming both
   sides. The approval rows still carry distinct user ids, so the maker-checker proof in the ledger
   is untouched. But one browser can now be maker and checker without a second credential, which is
   worth a deliberate decision and a line in the README rather than arriving as a convenience.
2. The **LIVE-3 KYB wording** in the same commit `0259d6c` (`page.tsx:717-735`), three cases instead
   of one. I read it and it looks right, but it is not in my assignment and I did not check it
   against the KYB states.

## Residual limitations, re-review

Unchanged from the first pass in kind. The HIGH finding is closed on the evidence I could take: the
row that told the customer a reversed payment stood now tells them it was reversed, on the one
policy in the trial data that is in that state, for every role. What I still cannot show on data is
the delta Pay form, the `blockedReason` line, the second open difference and the approver's band;
those four rest on reading short, unambiguous code, and F-BL-14 says plainly that no test holds them
either. Candidate walkthrough status stays **NOT REVIEWED WITH YOANN**.
