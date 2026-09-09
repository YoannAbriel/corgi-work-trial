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
`lib/inbox/sections.test.ts` (7 tests, no database).

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

## Two decisions worth reading

**Why the count functions now count a list.** `countPoliciesPaidButNotBound` and
`countEndorsementsPaidButNotApplied` used to be their own `count(*)` query. The inbox needs the
same rows, and a second query with the same `where` clause is exactly how a badge and the list it
points at start disagreeing. Each is now the `.length` of the list function beside it. The
condition exists once. At trial volume both lists are a handful of rows.

**Which anchor a section carries.** The sidebar knows four section names (`policies`, `claims`,
`approvals`, `reconciliation`), and each is used exactly once per role in the inbox, so
`/inbox#approvals` always lands on the section that holds the items the chip counted. The extra
sections carry their own name (`endorsement-deltas`, `correction-differences`,
`waiting-for-the-customer`, `corrections`, `endorsements`). Where the sidebar adds two inbox
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
- `npm test`: 421 tests, 420 pass, 1 skipped, 0 fail. Seven of them are the new
  `lib/inbox/sections.test.ts`.
- `npm run build`: passes, `/inbox` listed as server-rendered on demand.
- `npm run check:inbox-counts` on `corgi_test`, read-only: see the report to the coordinator for
  the counts.

## What is not done here

- `components/what-needs-you.tsx` was not touched: another builder owns it this morning. The
  two-line change that points its items at `/inbox` is in the report to the coordinator.
- `app/policies/[policyId]/page.tsx` and `app/ops/claims/[claimId]/page.tsx` were not touched.
- No migration, no new table, no write of any kind: every line added here reads.
