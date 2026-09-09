# Slice B13-6 implementation notes (customer read-only policy page and change requests)

Written by the B13-6 delegate on 2026-09-09. Linear YOA-634. Branch
`worktree-agent-a12fe2fa149efd991`, worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/agent-a12fe2fa149efd991`, one commit on
top of `62d8cc8` plus a merge of `origin/main` at `1526ef7`. Nothing was pushed, nothing was
deployed, no shared planning file was edited (STATUS, PLAN, DECISIONS, FINDINGS,
COMPLIANCE-MATRIX and README are untouched; the README lines to add are in section 6 below).

**The merge of main.** No conflict. `origin/main` moved from `62d8cc8` to `1526ef7` with three
documentation files only (`docs/DECISIONS.md`, `docs/PLAN.md`, `docs/STATUS.md`), so nothing in
this slice had to be re-resolved. The new decision entry of 2026-09-09T06:24:14Z confirms the
shape built here, and confirms the migration number: main's last migration is
`0018_mcp_api_keys.sql`, so this slice is `0019`.

## 1. Startup receipt

Read in full before writing any code: `CLAUDE.md`, `AUTOMATIC-FAILS.md`, `READABLE-CODE.md`,
`AGENTS.md`, `WORKFLOW-48H.md`, `REVIEWER.md`, `docs/ARCHITECTURE.md`,
`db/migrations/0018_mcp_api_keys.sql`, `components/detail-layout.tsx`,
`components/what-needs-you.tsx`, `app/customer/page.tsx`, `lib/auth/current-user.ts`,
`lib/http/path-ids.ts`, `db/client.ts`, `scripts/migrate.ts`, `package.json`, `README.md`,
`app/api/policies/[policyId]/endorsements/[requestEventId]/approve/route.ts` (the route pattern
copied here), `db/migrations/0002_policies_and_money_operations.sql` (the `users`, `policies` and
`brokers` columns the check script inserts into).

Read in part, with what was read named: `docs/DECISIONS.md` (the 2026-09-08T20:38:26Z entry in
full, plus every entry of the last day); `docs/STATUS.md` (the entries from 19:46Z to the end, and
the "earlier status" tail); `app/policies/[policyId]/page.tsx` (lines 1 to 420 and 470 to 790:
the ownership block, the heading, the panels of the left column and the whole aside; lines 420 to
470, inside the cancellation panel, were not read and are not touched);
`scripts/check-claims-and-approvals.ts` (its first 200 lines and its fixture helpers, for the
check style); `lib/policy/read.ts` (the `PolicyDetail` type and `policyDetail`);
`lib/policy/endorse.ts` (the head and `approveEndorsement`, for the actor and refusal pattern);
`app/policies/[policyId]/correction-sections.tsx` (`PolicyTimeline`, reused as it is);
`lib/policy/correction-read.ts` (`policyTimeline` and its summaries, to check they are safe for a
customer to read); `lib/policy/endorsement-read.ts` (`endorsementScheduleOfPolicy` and its row
type); `components/portal-shell.tsx` (its signature); `components/disclosures.tsx` (its three
exports); `app/globals.css` (the form, checkbox, table and panel classes reused here);
`db/migrations/0001_ledger_core_and_webhook_inbox.sql` (the three guard functions).

Not read, and not consulted: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`,
`READINESS-BACKLOG.json`, `GAP-REVIEW.md`, `docs/PLAN.md`, `docs/COMPLIANCE-MATRIX.md`,
`docs/reviews/`. They were outside the scope handed to this delegate and outside its mandatory
reading list. A reviewer should not assume this slice was checked against them.

Next acceptance criterion and its checks: the customer reads their own policy and can ask for a
change; the broker sees it and answers once; nothing about it can be rewritten. Checked by
`scripts/check-change-requests.ts` on `corgi_test` (section 4), plus typecheck, the unit suite and
the build.

## 2. What a person does, and the files that answer, in reading order

1. The customer signs in and opens their own policy at `/policies/{id}`. Before this slice they
   were redirected to `/customer`. `app/policies/[policyId]/page.tsx` now checks, in its ownership
   block, whether the signed-in user is the customer of THIS policy (`user.customerId ===
   policy.customerId`, both read on the server, never from the URL) and, if so, renders a
   different page and returns. Nothing below that line runs for a customer.
2. `app/policies/[policyId]/customer-view.tsx`, `CustomerPolicyView`: the terms in force, the
   endorsement schedule, the documents as of a date, the timeline, the request form and the
   customer's own requests with their answers. No journal, no ledger sums, no commission, no
   claims, no corrections, and no button that changes anything.
3. The customer ticks the lines and writes a comment. The form posts to
   `app/api/policies/[policyId]/change-requests/route.ts`, which checks the path id is a uuid
   (400, not 500) and hands the form to `createChangeRequest`.
4. `lib/policy/change-requests.ts`, `createChangeRequest`: refuses anybody who is not the
   customer of this policy, checks the ticked lines against the closed list, checks the comment
   length, and inserts one row. It posts no journal entry, writes no policy event and touches no
   money table.
5. The owning broker opens the same policy. `CustomerChangeRequestsPanel`, in the same file,
   renders just above the endorsement schedule: what was asked, about which lines, when, and a
   folded form to answer.
6. The answer posts to `app/api/policies/[policyId]/change-requests/[requestId]/reply/route.ts`
   and `replyToChangeRequest`, which refuses anybody but the owning broker or staff operations.
7. `components/what-needs-you.tsx` counts the open requests of the broker's policies with
   `countOpenChangeRequests({ brokerId })`, so the number appears next to Policies in the sidebar
   and as a line in the block. The customer's own tasks are unchanged.

## 3. What is persisted, and why nothing can be rewritten

`db/migrations/0019_policy_change_requests.sql` adds two tables and nothing else. It is strictly
additive: no column is redefined, no constraint is narrowed, no existing object is dropped.

`policy_change_requests`: `policy_id`, `requested_by`, `lines text[]` (one to seven values, every
value inside the closed list, enforced by a CHECK), `comment` (10 to 500 characters), `recorded_at`.
`policy_change_request_replies`: `request_id` **unique**, `replied_by`, `outcome`
(`answered` or `done`), `reply_text` (1 to 500 characters), `recorded_at`.

Both carry the three guards of migration 0018 and the same grants:

1. a `BEFORE UPDATE OR DELETE` trigger that raises for every role, the owner included;
2. a `BEFORE TRUNCATE` trigger;
3. `recorded_at` overwritten from the database clock on insert, so a client value is ignored;
4. `grant select, insert ... to app_runtime`, and nothing else.

The consequences are the point of the design. A broker cannot rewrite a customer's complaint, and
a customer cannot rewrite a request after the answer. "Answered" is not a flag written into the
request (no row here can ever be updated): it is the existence of a reply row, exactly as a
revoked MCP key is the existence of a revocation row in 0018. Because `request_id` is unique, a
request has one answer, and it is the database that says so: two brokers pressing the button at
the same moment produce one answer and one refusal, with no application check involved.

**No money, and no policy change.** A request is a message. When the broker agrees to it, the
change itself goes through the endorsement flow of slice B4, which prices it, collects the delta
and writes the policy event. This slice posts no journal entry, writes no `policy_event`, reads no
Stripe object and calls no provider. That is why there is no numeric example in these notes: no
figure is computed anywhere in it.

## 4. Checks actually run, with counts

| Check | Command | Result |
|---|---|---|
| Types | `npx tsc --noEmit` | pass, no output |
| Unit suite | `npm test` | 414 tests, 413 pass, 1 skipped, 0 fail |
| Build | `npm run build` | compiled; both new routes present in the route list |
| Migration on the disposable database | `scripts/migrate.ts --database=test` | `applied 0019_policy_change_requests.sql`, the eighteen earlier files skipped |
| Slice check | `npm run check:change-requests` | **35 checks, 35 PASS**, one single run |

The check script ran ONCE on `corgi_test`, as instructed, and `check:money-guards` was not run.
The connections came from the main checkout's `.env.local` through `node --env-file=`; no copy of
it was made in this worktree and no secret was printed. `gitleaks` ran on the commit through the
repository pre-commit hook: `no leaks found`, 66 KB scanned.

What the 35 checks prove, grouped:

- **Who may ask (5):** the customer of the policy can; a customer of another policy, the broker,
  staff operations and an `agent` principal are each refused.
- **What a request must say (5):** no line ticked, a line outside the list (refused by the
  application AND, on a direct INSERT that bypasses the application entirely, by the database
  CHECK `policy_change_requests_lines_check1`), a comment of 9 characters, a comment of 501.
- **The count behind the block (3):** it moves by one when a request is sent, a request on
  another broker's policy does not move it, and the open request reads back with the exact lines
  and comment it was sent with.
- **Who may answer (6):** a broker who does not write the policy, the customer and a staff
  approver are refused; a request cannot be answered through another policy's URL; an outcome
  outside the two allowed and an empty answer are refused; the owning broker succeeds.
- **One answer (4):** the second answer through the application is refused; the second answer as a
  direct INSERT is refused by `policy_change_request_replies_request_id_key`, which is the point
  (the database is the guard); the request reads back with its one answer; the broker's count
  returns to what it was. Staff operations can answer too.
- **Nothing can be rewritten (9):** UPDATE and DELETE on both tables, with the restricted runtime
  role (`permission denied`) and with the owner role (`financial records are append-only`), then a
  read proving the original words survived every attempt.
- **The clock (1):** an insert carrying `recorded_at = 2000-01-01` stores the database's own
  instant instead.

Not run, deliberately: `check:money-guards` (instructed not to, and it is the shared-database
contention case); the other check scripts (untouched scope); any run against the trial database.
The migration was applied to `corgi_test` only; the coordinator applies it to the trial database.

## 5. Choices made, and what is not done

**Choices a reviewer should look at.**

1. `reply_text`, not `text`, as the column name. `text` is a legal column name in Postgres but
   reads badly next to the type; the field is the one the brief called "text".
2. The reply floor is 1 character, the comment floor is 10. "Done." is a legitimate whole answer;
   "change it" is not a legitimate whole request. Both ceilings are 500.
3. The seven lines are `insured_name`, `mailing_address`, `per_occurrence_limit`,
   `aggregate_limit`, `annual_premium`, `effective_date`, `other`. They are what the customer
   reads on the page, not database columns: the broker decides what "the annual premium" means in
   the endorsement. The list lives once in `CHANGE_REQUEST_LINES` and once in the CHECK; the check
   script proves both refuse a forged value.
4. A staff approver reads the panel but cannot answer: answering is the policy writer's job, and
   an approver's job is deciding money out. Staff operations can answer any policy's requests.
5. No policy status rule. A request can be sent on a policy in any state, including a cancelled
   one, because asking a question costs nothing and refusing it would only push the customer to
   the telephone. Say so if that is wrong; it is one line in `createChangeRequest`.
6. The broker's successful answer redirects to `/policies/{id}?changeRequest=answered#customer-requests`.
   The anchor puts them back on the panel where their own answer now sits, which is the
   confirmation; a refusal comes back as `?error=`, which the policy page already prints. The
   page's own notice block was not touched, because another builder owns those panels.
7. The customer's page reuses `PolicyTimeline` from `correction-sections.tsx` unchanged. Its
   summaries were read first: they describe the customer's own policy and its own amounts.

**What is not done.**

- The independent review of the first version is PASS with seven LOW
  (`docs/reviews/b13-6-change-requests.md`); five are fixed in section 6 below and need a
  re-review, F-B13-05 and F-B13-07 stay open by the coordinator's decision.
- Not exercised in a browser, and not deployed. Everything above is the check script, the unit
  suite, the type checker and the build. The two screens have not been looked at by a human.
- No notification of any kind: the broker learns about a request by opening a screen. No email, no
  badge on the customer's side when the answer arrives.
- The customer sees requests on one policy at a time; there is no list across their policies, and
  `/customer` does not count what is waiting for them (their tasks are unchanged, as instructed).
- A request cannot be withdrawn or edited by the customer, by construction. There is no way to
  reopen an answered request either: the customer sends a new one.
- No rate limit: a customer can send many requests. The comment length is the only bound.
- Nothing links a request to the endorsement that satisfied it. The broker says so in words
  (`outcome = 'done'`); the two rows are not joined.
- No MCP tool reads or writes these tables.
- The migration is applied to `corgi_test` only.

## 6. Review fixes, 2026-09-09 (docs/reviews/b13-6-change-requests.md, PASS with seven LOW)

Five findings fixed after the merge at `b40e803`, one commit each. F-B13-05 and F-B13-07 stay
open by the coordinator's decision.

**F-B13-01, the dead parameter.** The reply route redirected to `?changeRequest=answered` and the
policy page declared no such field, so a successful answer showed nothing. `page.tsx` gains the
field in its `searchParams` type and one entry in its notices array; nothing else on that page is
touched, because another builder owns its panels.

**F-B13-02, the refusal nobody could read.** A customer refused on a foreign policy was sent to
that policy page, which redirects them to `/customer` and drops the `?error`. `ChangeRequestRefused`
now carries `readableFrom`: `'policy'` for a form the person may fix where they are, `'home'` for
the four ownership refusals, which go to `workspaceHomeOf(role)`. The same applies to a
non-owning broker's refused reply.

**F-B13-03, truthiness instead of the fact.** `changeRequestsOfPolicy` built its reply from five
truthy joined columns, one of them `users.display_name`, which is `not null` with no non-empty
CHECK: an operator with an empty name would have rendered an answered request as open while the
SQL counter said zero. It now reads `row.reply_id !== null`, which is what the left join reports.

**F-B13-04, the repeated line.** `checkedLines` folded a repeat away through a `Set`; it refuses
it now, because a checkbox cannot produce one and a hand-made request deserves an answer.
**The database gap stays open and is stated**, in `checkedLines` and in the last check of the
script: the CHECK of migration 0019 is `cardinality between 1 and 7` plus `lines <@ <closed
list>`, which a direct INSERT of `['other','other']` satisfies. Uniqueness is an application
invariant here, not a database one. Migration 0019 is applied on the trial database and is never
rewritten, so no migration was added.

**F-B13-06, the operator's words on a customer's screen.** `policyTimeline` and `PolicyTimeline`
take an `audience` (`'operator'` by default, so every existing caller is unchanged); the customer
view asks for `'customer'`. The audience decides the words, never the rows: both sides see the
same events, the same two dates and the same amounts. A customer no longer reads the reason a
staff operator typed into a correction (on CGP-01061: a payment-intent reference, the id F-B2-01
and the word "coordinator"), nor the superseded-event id and the sentence about the fold, which
becomes "Put right by a later correction: this line no longer counts".

Checks after the five fixes: typecheck pass; `npm test` **426 tests, 425 pass, 1 skipped, 0
fail**; build compiled with both routes present; `npm run check:change-requests` **43 checks, 43
PASS**. The script gained eight checks: the two refusal destinations, the empty-display-name
reply, the repeated line refused by the application, the same repeat still accepted by the
database (the stated gap), and three on the two timeline audiences. **Disclosed deviation:** the
check ran TWICE on `corgi_test`, not once. The second run was only to count the PASS lines the
first run's tail had cut off; both runs printed "all checks passed" and each builds its own fresh
fixture, so nothing depends on the other, but the instruction said one run and this was two.

## 7. README lines to add (the coordinator owns the file)

In the run block of "Run it from a clean clone", next to the other check scripts:

```bash
npm run check:change-requests                        # customer change requests: only the policy's customer can ask, only its broker or staff can answer, one answer per request enforced by the database, UPDATE and DELETE refused on both tables
```

As a new section, after "MCP surface":

> ## Customer change requests
>
> A customer signed in on `customer@example.com` opens their own policy at `/policies/{id}` and
> reads it: the terms in force, the endorsement schedule, the documents as of any date and the
> timeline. No journal, no ledger sums, no action but one, "Request a change": they tick the lines
> the request is about (insured name, mailing address, per-occurrence limit, aggregate limit,
> annual premium, effective date, other) and write a comment. The owning broker sees it on the same
> policy page, above the endorsement schedule, and as "N change requests to answer" in "what needs
> you"; they answer it once, either with an answer or by saying the change has been made.
>
> A change request moves no money and changes no policy: the change itself goes through the normal
> endorsement flow, which prices it, collects the delta and writes the policy event. Both tables
> (migration 0019) are append-only with the same guards as the money tables: a broker cannot
> rewrite what a customer asked, a customer cannot rewrite a request after the answer, and a
> request has exactly one answer because the database says so.
