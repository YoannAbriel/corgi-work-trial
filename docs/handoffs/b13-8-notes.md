# B13-8 (YOA-636): the notification centre, /inbox

Written by the B13-8 delegate builder on branch `worktree-agent-aa3782cb842727783`. The
coordinator merges, reviews and owns STATUS, PLAN, DECISIONS, FINDINGS, COMPLIANCE-MATRIX and
README; none of those files was touched here.

## The complaint this answers

Yoann, 2026-09-09: "le bouton ne fait rien". The "what needs you" block said "3 policies to pay"
and led to `/broker`, the screen it was already on; the sidebar badge said "5" and led to a list
of every policy, where the five were still to be found. A count that cannot be opened is not an
answer.

## What was built

**`lib/inbox/sections.ts`, pure.** Facts in, sections out. No database, no framework: the
grouping, the wording and the rule of who does what, in one readable file. Proved line by line in
`lib/inbox/sections.test.ts` (8 tests, no database).

**`lib/inbox/read.ts`, the reads.** `workspaceInbox(user)` reads the facts through the readers the
screens themselves use and calls the pure functions above. Nothing restates a business rule in
SQL:

| Section | Reader it goes through |
|---|---|
| broker policies to pay | `policiesOfBroker` (`policy_current.status`) |
| endorsement deltas, quotes waiting for the customer | `liveEndorsementRequest` |
| correction differences | `correctionsOfPolicy` |
| customer approvals | `liveEndorsementRequest`, `correctionsOfPolicy` |
| approval requests waiting | `approvalRequests` |
| policies paid and not bound | `policiesPaidButNotBound` (new list twin of the count) |
| endorsements paid and not applied | `endorsementsPaidButNotApplied` (new list twin of the count) |
| claims with a payment to move | `claimsWithPositions` + `claimPayments` |
| change requests to answer | `openChangeRequestsOfBroker` (new list twin of the count) |
| open breaks | `openBreaks` |

**`app/inbox/page.tsx`, the screen.** `DetailHeading` with the total waiting, then one `Panel` per
section with a table (object, what is waiting, amount, since when, one action link styled as a
button), an empty sentence per section and an anchor per section. Server component: no JavaScript
of ours, no arithmetic in the browser, every amount arriving in integer cents and formatted with
`formatCentsAsUsd`. Anonymous visitors are redirected to `/login`; the role and the broker or
customer come from the session, never from the URL, and every link leads to a screen that asks
the identity question again for itself.

**`components/portal-shell.tsx`, the sidebar.** Each count chip is now a link of its own to
`/inbox#<section>`, and every signed-in role has an "Inbox" entry carrying the total. The chip had
to move out of the navigation link, because a link inside a link is not valid HTML: a
`.sidebar-nav-row` now holds the two, and `app/globals.css` restores the pill shape for the badge
in both the desktop and the mobile rules.

## Four decisions worth reading

**Why the count functions now count a list.** `countPoliciesPaidButNotBound` and
`countEndorsementsPaidButNotApplied` used to be their own `count(*)` query. The inbox needs the
same rows, and a second query with the same `where` clause is exactly how a badge and the list it
points at start disagreeing. Each is now the `.length` of the list function beside it. The
condition exists once. At trial volume both lists are a handful of rows.

**Why `countOpenChangeRequests` changed too.** Slice B13-6 landed in `main` while this was being
built, and its count walked `policies` by `broker_id` while the inbox walked the broker's own
policy list, which joins `policy_current`. On `corgi_test` that showed up at once as "1 counted, 0
listed": the change-request check writes policies with no `policy_current` row, which the broker's
list therefore never shows. `lib/policy/change-requests.ts` now has
`openChangeRequestsOfBroker({ brokerId })`, and the count is its length, so "open" (no reply row
exists) is stated once and the inbox reads the broker's requests directly rather than through the
policy list.

**What an approver sees.** `workspaceTasks` gives "paid and not bound" and "paid and not in force"
to `staff_ops` only: binding and applying are operations work. The inbox keeps both sections for
an approver, with the sentence "Staff operations do this; it is not an approver's queue.", so the
screen has the same shape for both roles and the badge and the list still agree. If Yoann wants an
approver to see those items, `staffSections` takes one word out of two ternaries.

**Which anchor a section carries.** The sidebar knows four section names (`policies`, `claims`,
`approvals`, `reconciliation`), and each is used exactly once per role in the inbox, so
`/inbox#approvals` always lands on the section that holds the items the chip counted. The extra
sections carry their own name (`endorsement-deltas`, `correction-differences`,
`change-requests`, `waiting-for-the-customer`, `corrections`, `endorsements`). Where the sidebar adds two inbox
sections into one number, staff `policies` for instance, the chip lands on the first of the two
and the second is immediately below it.

## Two things a reviewer should look at

**A policy the readers refuse to answer for.** `correctionsOfPolicy` throws when a
`correction_rebook` payload predates the `policy_refunded_cents` totals. `workspaceTasks` catches
that and returns no task at all, so the whole role's badge silently shows nothing.
`workspaceInbox` instead skips the policy, lists what it could read and names the unreadable
policies on the screen. In `corgi_test`, 39 of the 70 `correction_rebook` events are of the older
format (measured on 2026-09-09); the trial database has no correction at all, so no deployed
screen is affected today. The divergence between the badge and the inbox on such a policy is real
and deliberate, and `scripts/check-inbox-counts.ts` reports those users as SKIP rather than
comparing a silence with a list.

**The N+1 reads.** A broker's inbox reads the live endorsement request and the corrections of each
of their policies, one policy at a time, exactly as `components/what-needs-you.tsx` already does.
It is the price of going through the same readers as the screens; at trial volume it is a handful
of small queries, and it is the reason the check script takes minutes on `corgi_test`, which holds
the accumulated data of every replay check.

## Checks run

- `npm run typecheck`: clean. Note for whoever runs it after a build: `.next` is inside the
  TypeScript program (`**/*.ts` with only `node_modules` and `docs` excluded), and a build output
  present in the tree makes `tsc` report a pre-existing duplicate `main` in
  `scripts/post-local-webhook.ts`. Typecheck before building, or remove `.next` first.
- `npm test`: 442 tests, 441 pass, 1 skipped, 0 fail, after merging `origin/main` at bb54cce.
  Eight of them are the new `lib/inbox/sections.test.ts`.
- `npm run build`: passes, `/inbox` listed as server-rendered on demand.
- `npm run check:inbox-counts` on `corgi_test`, read-only, 53 PASS, 0 FAIL, 0 SKIP, comparing
  anchor by anchor after the fix cycle:
  - 50 of the 818 brokers and customers, the 25 most recent of each role;
  - `staff_approver`: 1283 counted, 1283 listed (#approvals 116, #claims 38,
    #reconciliation 1129);
  - `staff_ops`: 1330 counted, 1330 listed (#approvals 116, #policies 10, #endorsements 37,
    #claims 38, #reconciliation 1129). Those two figures, 10 and 37, are the ones that used to be
    added together as "policies 42/42": the check now sees the two sections apart, which is what
    F-B13-16 was about.

  The script was run six times in total while it was being written and corrected; every run is a
  read, it opens no transaction of its own and writes no row, so it adds nothing to `corgi_test`
  and cannot contend with another builder's check.

## Fix cycle after the review (docs/reviews/inbox-and-motion.md, PASS with findings)

**F-B13-15 and F-B13-16, the counts opened the wrong section.** The block linked each count to
`/inbox#<sidebar section>`, and the sidebar knows four names while the inbox lists ten kinds of
work: "2 change requests to answer" opened "Policies to pay", which held nothing. `WorkspaceTask`
now carries an `anchor` beside its `section`: `section` is where the sidebar adds the count up,
`anchor` is the inbox section that lists those very items. The names live once, in `INBOX_ANCHORS`
in `lib/inbox/sections.ts`, used by the sections and by the tasks, so a task naming a section that
does not exist is a compile error; a unit test checks the other direction, that every one of the
twelve names is rendered by the role that uses it. The task `href` field went with it: nothing read
it any more, and what it said ("this work is at /broker") was the wrong signpost.

**F-B13-17, the check could not see it.** It folded the ten anchors onto the four sidebar names
before comparing, so the two sides were equal by construction whenever the totals were, and it
reported PASS on the data where the bug was visible. It now compares each anchor a task named
against the section carrying that anchor, refuses two sections sharing one id, and walks every
broker and every customer instead of stopping at the first one with work.

**F-B13-18, the catch was too wide.** The per-policy `catch {}` reported a dropped connection or a
mistake in our own code as a defective policy. It now keeps only the failure it was written for, a
reader refusing a value the policy has stored, and rethrows a postgres error (one carrying a `code`
or an `errno`), `TypeError`, `RangeError`, `ReferenceError` and anything thrown that is not an
`Error`. What the reader said is carried with the policy number and printed, so the sentence names
the refused figure.

**F-B13-19, the script's environment.** Its header said `DATABASE_URL_TEST_APP` and its import
graph needs the whole `.env.local`, because `lib/stripe.ts` refuses to load without
`STRIPE_SECRET_KEY`. The header says so now. Nothing here calls Stripe.

**F-B13-20, a column of dates in uuid order.** `distinct on (request_event_id)` forces an order by
uuid and that order reached the "Paid" column. The distinct-on is wrapped and the outer select
orders by `paid_at`. Measured on `corgi_test`: 35 rows, oldest first, from 2026-09-08T13:31:57Z.

## What is not done here

- `app/policies/[policyId]/page.tsx` and `app/ops/claims/[claimId]/page.tsx` were not touched.
- No migration, no new table, no write of any kind: every line added here reads.
- `refusedValueOrRethrow` (F-B13-18) has no unit test of its own: it lives in `lib/inbox/read.ts`,
  which opens the database pool on import, so a test would need the environment. It is exercised on
  `corgi_test` by the SKIP lines of the count check, which are exactly its refused-value branch.
