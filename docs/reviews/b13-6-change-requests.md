# Independent review, slice B13-6: the customer read-only policy page and change requests

Reviewer: independent reviewer sub-agent, working in the worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/agent-a2623601a87838243`, branch
`worktree-agent-a2623601a87838243`. Written at 2026-09-09T07:05Z. Linear YOA-634.

Reviewed revision: `main` at **b40e803**, the merge of `worktree-agent-a12fe2fa149efd991`
(feature commit `3e707d0`, handoff notes `3742210`). The same revision carries B12-2 and B12-3,
reviewed separately; the diff read here is `git diff b40e803^1 b40e803`, which is exactly this
slice. Working tree clean at review time apart from this file. The deployed application reported
`revision: b40e80388a8f95d8fdc5fce533da0838012a76c9` on `/api/health` throughout, so every
production measurement below was taken on the reviewed revision.

This is a scoped engineering assessment of one slice. It is not a legal certification and it is
not a statement that the six delivery gates pass for the whole submission.

## 1. Startup receipt

Read in full, in this order, before looking at any B13-6 code: `CLAUDE.md`,
`AUTOMATIC-FAILS.md`, `READABLE-CODE.md`, `AGENTS.md`, `WORKFLOW-48H.md`, `REVIEWER.md`.

Then, for this scope, read in full: `docs/handoffs/b13-6-notes.md`,
`db/migrations/0019_policy_change_requests.sql`, `db/migrations/0018_mcp_api_keys.sql`,
`lib/policy/change-requests.ts`, `app/api/policies/[policyId]/change-requests/route.ts`,
`app/api/policies/[policyId]/change-requests/[requestId]/reply/route.ts`,
`app/policies/[policyId]/customer-view.tsx`, `components/what-needs-you.tsx`,
`scripts/check-change-requests.ts`, `lib/http/path-ids.ts`, `lib/auth/current-user.ts`,
`app/api/session/login/route.ts`, `package.json`.

Read in part, with what was read named: `docs/DECISIONS.md` (the entries of 2026-09-08T20:38:26Z
and 2026-09-09T06:24:14Z in full, the heading list of the whole file, and the stack/provider and
money-rule entries of 2026-09-08); `docs/ARCHITECTURE.md` (sections 6, 7, 8 and 9);
`app/policies/[policyId]/page.tsx` (lines 45 to 160 for the ownership block and the notices
array, lines 340 to 360 for the new panel, plus a grep of every `user.role` and `redirect` in the
file); `docs/reviews/FINDINGS.md` (the header and the tail, for the register format);
`docs/reviews/b11-mcp.md` (its startup receipt and register block, for the record format);
`db/migrations/0002_policies_and_money_operations.sql` (the `users` table).

Not read, and not consulted: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`,
`READINESS-BACKLOG.json`, `GAP-REVIEW.md`, `docs/PLAN.md`, `docs/COMPLIANCE-MATRIX.md`,
`docs/STATUS.md`, the other slice reviews. No retained readiness control was identified for this
scope beyond what `AGENTS.md` already requires, and this slice moves no money. A reader should
not assume this review checked B13-6 against those catalogues. Absent files: none.

Planned checks and what happened: `npx tsc --noEmit` (pass), `npm run check:change-requests` on
`corgi_test` once (35 checks, 35 PASS), the unit suite (426 tests, 425 pass, 1 skipped, 0 fail),
a read-only inspection of `pg_trigger`, `pg_constraint` and `information_schema.table_privileges`
on both `corgi_test` and the trial database, and a measured run of every role against the
deployed application. `check:money-guards` was deliberately not run (the coordinator proves the
guards on an ephemeral database; it is also the shared-database contention case).

Nothing was pushed, nothing was deployed, no migration was applied anywhere, no shared planning
file was edited, and no UPDATE or DELETE was issued against any database. The demo password was
read from the main checkout's `.env.local` into a shell variable and never printed; no secret
appears in this file.

## 2. Applicability

Feature: a customer of a commercial liability policy reads their own policy and sends their
broker a message ("change request") naming the lines of the policy it is about; the owning broker
or staff operations answers it once. Actors: `customer`, `broker`, `staff_ops`, `staff_approver`,
`agent`. Jurisdiction and rail: none is engaged. No provider is called, no personal data beyond
the existing seeded sandbox customer name is stored, and the only new data is text the customer
types.

Confirmed facts: Track 1, decided by Yoann on 2026-09-08 at 20:35 UTC (DECISIONS.md,
2026-09-08T20:38:26Z) and confirmed "on go" on 2026-09-09 at 06:20 UTC
(2026-09-09T06:24:14Z): "a request is a message with no money effect (the broker acts through the
normal endorsement flow), stored append-only with the lines it names, answered by the broker with
a reply event, open until answered", counted in the broker's "what needs you".

Applicable requirements for this scope are therefore internal: AF-03 (nothing may update or
delete a money row, and the append-only discipline the repository applies to non-money audit
tables), AF-04 (sandbox only), AF-05 (no secrets), AF-06 (explainable code), the ownership and
authorisation rules of `AGENTS.md` ("protect sensitive actions with authentication, authorisation
and ownership checks"), and `docs/ARCHITECTURE.md` section 8 ("role check on every action,
ownership check on every policy"). No external legal source was consulted, because no external
regime is engaged by a message between a customer and their broker that moves no money and
collects no new identity data; this is recorded as the reviewer's applicability judgement, not as
a Corgi ruling.

Unresolved assumptions carried by the implementation, both documented in the handoff notes and
neither contradicting a recorded decision: staff operations may answer a request on any policy
(the decision names the broker only), and a request may be sent on a policy in any state,
including a cancelled or voided one. Both are design choices for Yoann to keep or change; the
second is what this review exercised on production.

## 3. Requirement matrix

| # | Requirement | Control and code location | Evidence | Verdict |
|---|---|---|---|---|
| 1a | The migration is strictly additive | `db/migrations/0019_policy_change_requests.sql` contains only `create table`, `create index`, `create trigger` and one `grant`; no `alter`, no `drop`, no column redefined (contrast 0018, which widened a CHECK) | grep of the file for `alter/drop/truncate/update/delete` returns matches inside trigger definitions only; migration runner applied `0019` on `corgi_test` after the eighteen earlier files | PASS |
| 1b | Both tables append-only for every role, the owner included | `..._are_append_only` triggers `BEFORE UPDATE OR DELETE ... EXECUTE FUNCTION forbid_change_of_financial_record()` on both tables | `check:change-requests` checks 26 to 33: UPDATE and DELETE refused on both tables for the runtime role (`permission denied`) and for the owner role (`financial records are append-only`), then check 34 reads the original words back unchanged; `pg_get_triggerdef` on `corgi_test` and on the trial database shows the same six triggers | PASS |
| 1c | TRUNCATE refused | `..._cannot_be_truncated` triggers `BEFORE TRUNCATE ... FOR EACH STATEMENT` | trigger definitions read from `pg_trigger` on both databases; not exercised, see section 6 | PASS (by inspection) |
| 1d | Timestamps set by the server | `..._recorded_at_is_server_set` `BEFORE INSERT` trigger calling `set_recorded_at_from_database_clock()` | `check:change-requests` check 35: an insert carrying `recorded_at = 2000-01-01` stored `2026-09-09T06:51:18.498Z`, 0.1 s from the clock | PASS |
| 1e | `app_runtime` holds SELECT and INSERT and nothing else | `grant select, insert on ... to app_runtime;` and no other grant in 0019 | `information_schema.table_privileges` on `corgi_test` and on the trial database: `app_runtime` has exactly `INSERT,SELECT` on both tables | PASS |
| 1f | The line list is closed by a CHECK | `check (lines <@ array[...seven values...])` plus `check (cardinality(lines) between 1 and 7)` | `pg_get_constraintdef` shows both; `check:change-requests` check 8: a direct INSERT of `['broker_commission']` by the owner is refused by `policy_change_requests_lines_check1`; on production a forged `lines=broker_commission` is refused by the application first | PASS |
| 1g | One reply per request, enforced by a unique constraint | `request_id uuid not null unique` | `policy_change_request_replies_request_id_key UNIQUE (request_id)` present on both databases; check 22 refuses a direct duplicate INSERT with `duplicate key value violates unique constraint`; on production the second answer came back `?error=this change request has already been answered` | PASS |
| 2 | No money effect anywhere | `lib/policy/change-requests.ts` writes only the two new tables; the two routes call only it; `customer-view.tsx` reads `policy_current`, the endorsement schedule and the timeline | grep of the four new/changed application files finds `journal`, `ledger`, `commission`, `policy_event` in comments only; on the trial database, `journal_entries`, `policy_events`, `money_operations`, `money_operation_events`, `approval_requests` and `claim_events` each show **0 rows** written since 2026-09-09T06:50:00Z, across the whole production exercise (last journal entry: 2026-09-09T06:34:34Z, another slice's) | PASS |
| 3a | A customer sees only their own policy | `app/policies/[policyId]/page.tsx` lines 91 to 100: `user.customerId === policy.customerId` read from the session, then `redirect` for anyone else | production: `customer@example.com` on CGP-01061 (their own) → 200 customer view; on CGP-01274 (customer2's) → 307 to `/customer` | PASS |
| 3b | A customer cannot request on another policy | `createChangeRequest` refuses unless `role === 'customer' && actor.customerId === policy.customerId`; the customer id comes from the session, never the form | production POST on CGP-01274 → 303 `?error=only the customer of this policy can ask for a change on it`; corgi_test checks 2 to 5 refuse the other customer, the broker, staff operations and an agent | PASS |
| 3c | A broker replies only on their own policies | `replyToChangeRequest`: `role === 'broker' && actor.brokerId === request.broker_id`, the broker id read from the policy row | production: `broker2@example.com` POST on the request → 303 `?error=only the broker who writes this policy, or staff operations, can answer a change request`; the same broker cannot even open the page (307 to `/broker`) | PASS |
| 3d | `staff_approver` reads but cannot reply | `canReply={isOwningBroker || user.role === "staff_ops"}` hides the form; `replyToChangeRequest` refuses the role server-side | production: `approver@example.com` sees the panel and the request text, no reply form is rendered, and a hand-made POST → 303 `?error=only the broker who writes this policy, or staff operations, can answer` | PASS |
| 3e | The `agent` role can do nothing | `login` refuses an `agent` user with the generic message; both service functions are allowlists that never name `agent`; no MCP tool touches either table (grep of `lib/mcp/`) | corgi_test check 5 refuses an `agent` principal; no agent session can exist in a browser, so this was not re-measured on production | PASS |
| 3f | Malformed ids answer 404 (page) and 400 (API) | `isUuid` + `notFound()` on the page; `badPathIdResponse` on the first lines of both routes | production: `GET /policies/not-a-uuid` → 404; `POST /api/policies/not-a-uuid/change-requests` → 400; `POST .../change-requests/not-a-uuid/reply` → 400 | PASS |
| 3g | Anonymous answers 307 to /login | `currentUser()` then `redirect("/login")` in the page; the routes answer 303 to `/login?error=...` | production: anonymous `GET /policies/{uuid}` → 307 `…/login`; anonymous POST on either route → 303 `…/login?error=Please+sign+in+again` | PASS |
| 4 | The customer view shows no journal, no ledger sums and no action but the request | `customer-view.tsx` renders eight panels and three forms only | production, both of this customer's policies: panels are exactly `Terms in force`, `Endorsement schedule`, `Ask for a change`, `Your change requests`, `Timeline`, `Your broker`, `Documents as of a date`, `How to read this page`; the only form actions are `…/change-requests`, the two `…/documents/…` GETs and `/api/session/logout`; the only buttons are the two PDF buttons, `Request a change` and `Sign out`; the strings `Journal`, `Commission`, `Claims`, `Refund`, `Cancel`, `Stripe`, `reconcil` and `What the ledger says` appear **zero** times (`ledger` appears twice, both in the site meta description) | PASS |
| 5 | The broker's count equals the open requests on their policies | `countOpenChangeRequests({ brokerId })` in `components/what-needs-you.tsx`, one SQL query with `not exists (select 1 from policy_change_request_replies …)` joined through `policies.broker_id` | production, measured on the same session: before, `/broker` said "Nothing is waiting for you right now" (0); after the request, "**1** change request to answer"; after the answer, back to "Nothing is waiting for you right now" (0). The trial database holds exactly one request row and one reply row, both mine. corgi_test checks 11 and 12 also prove a request on another broker's policy does not move this broker's count | PASS |
| 6 | Plain forms, field names, redirects with notices | Plain `<form method="post">`, no JavaScript; fields `lines` (repeated checkbox), `comment`, `outcome` (`select`), `text`; 303 redirects carrying `?changeRequest=sent`, `?changeRequest=answered#customer-requests` or `?error=…` | production HTML inspected: `name="lines"` × 7 checkboxes with labels, `name="comment"` with `minLength=10 maxLength=500`, `name="outcome"` with the two allowed values, `name="text"` with `maxLength=500`; the customer's `?changeRequest=sent` notice renders; every refusal renders through the page's existing `query.error` block. One gap: the broker's success parameter is ignored, see F-B13-01 | PASS with F-B13-01 |
| 7 | AF-06 readability | One 311-line service file with three writes/reads and two refusal paths, two 45-line routes, one view file, a 120-line migration whose comments state the reason for each guard | The reading path is `page.tsx` ownership block → `customer-view.tsx` → route → `change-requests.ts` → migration 0019, five files and no indirection; names carry their unit and purpose (`countOpenChangeRequests`, `CHANGE_REQUEST_LINES`, `recorded_at`); no financial formula appears, so no worked example is owed | PASS with F-B13-03 and F-B13-05 |
| AF-03 | No UPDATE or DELETE on a money row | This slice writes no money row; the two new tables carry the money tables' guards anyway | see rows 1b and 2 | PASS |
| AF-04 | Sandbox only, no real personal data | No provider call in the slice; the only new data is typed text on seeded sandbox customers | grep for `stripe` in the slice: zero outside comments | PASS |
| AF-05 | No secrets committed | The slice adds no configuration; this review prints none | `gitleaks protect --staged` run before the commit that carries this file, result in section 6 | PASS |
| AF-01, AF-02 | Deployed URL, no simulation presented as live | Out of scope for this slice; the feature is purely internal and claims no integration | `/api/health` served the reviewed revision from the public URL throughout | NOT APPLICABLE to this scope |

## 4. What was measured on the deployed application

Deployment: `https://corgi-work-trial-iota.vercel.app`, `/api/health` reporting
`{"ok":true,"database":"ok","revision":"b40e80388a8f95d8fdc5fce533da0838012a76c9"}` before and
after the exercise. Sign-in used the seeded demo accounts and the demo password from the main
checkout's `.env.local`, never printed.

Policies used, resolved from the broker's own list (policy number → id):

- CGP-01061 → `de2fb99f-8db4-4aa3-9ee5-827e444ab5ad`, voided, customer `customer@example.com`
- CGP-01707 → `3c3697b7-33f8-45a4-beaf-5a1892fc9483`, bound, same customer
- CGP-01274 → `104d2966-be96-4c36-9956-caf0762f8b15`, cancelled, another customer
- CGP-01062 → `31509261-4bfd-4c0c-8e16-55ff03eff1b7`, cancelled, another customer

**The two rows created on production, and nothing else.** Both are the authorised ones.

| Row | Id | Recorded (UTC, from the database) | Content |
|---|---|---|---|
| Change request | `6d84659e-648a-415c-a4d8-ea9c43fbe7b2` on policy `de2fb99f-8db4-4aa3-9ee5-827e444ab5ad` (CGP-01061), lines `mailing_address`, `other` | 2026-09-09T06:53:42.371Z | `review: change request created by the independent reviewer` |
| Reply | `f4a9b6ae-4ec0-43ea-ad3e-b1c1bde25f15` on request `6d84659e-…`, outcome `answered`, by `broker@example.com` (Dana Ruiz) | 2026-09-09T06:55:05.273Z | `review: answered by the independent reviewer, no change made to the policy` |

A read-only query as `app_runtime` confirms that `policy_change_requests` and
`policy_change_request_replies` each hold exactly one row on the trial database, so nothing else
was created by this review and nothing existed before it. The recorded times sit inside the
observed request windows (06:53:41 to 06:53:42 and 06:55:04 to 06:55:05 measured by the client), which
is the server clock behaving as the trigger promises.

Refusals measured on production, all of them (status, then the redirect target):

| Attempt | Result |
|---|---|
| anonymous `GET /policies/{uuid}` | 307 → `/login` |
| anonymous `GET /customer` | 307 → `/login` |
| anonymous `POST …/change-requests` | 303 → `/login?error=Please+sign+in+again` |
| anonymous `POST …/reply` | 303 → `/login?error=Please+sign+in+again` |
| customer `GET` another customer's policy | 307 → `/customer` |
| customer `GET /policies/not-a-uuid` | 404 |
| customer `POST` a request on another customer's policy | 303 → `…?error=only the customer of this policy can ask for a change on it` |
| customer `POST` with `lines=broker_commission` | 303 → `…?error=that is not a line of this policy` |
| customer `POST` with no line ticked | 303 → `…?error=tick at least one line the request is about` |
| customer `POST /api/policies/not-a-uuid/change-requests` | 400 |
| customer `POST` a reply on their own request | 303 → `…?error=only the broker who writes this policy, or staff operations, can answer a change request` |
| staff approver `POST` a reply | 303 → same refusal (and no reply form is rendered for them) |
| other broker `GET` the policy | 307 → `/broker` |
| other broker `POST` a reply | 303 → same refusal |
| owning broker `POST` the reply through another policy's URL | 303 → `…?error=this change request does not exist on this policy` |
| owning broker `POST` with `outcome=closed` | 303 → `…?error=say whether this is an answer or a change you have made` |
| owning broker `POST` with a blank answer | 303 → `…?error=write an answer for the customer` |
| owning broker `POST /api/…/change-requests/not-a-uuid/reply` | 400 |
| owning broker `POST` a **second** answer | 303 → `…?error=this change request has already been answered` |

Both sides read the same row afterwards: the customer's "Your change requests" panel and the
broker's "Customer requests" panel show the same comment, the same answer, `Dana Ruiz, broker,
2026-09-09 06:55:05 UTC`, and the broker's panel footer changed from "1 request is waiting for an
answer" to "Every request on this policy has been answered".

## 5. Findings

**F-B13-01, LOW: the broker's success redirect carries a parameter the page ignores.**
Trigger: the owning broker answers a request; the reply route redirects to
`/policies/{id}?changeRequest=answered#customer-requests`
(`app/api/policies/[policyId]/change-requests/[requestId]/reply/route.ts:36`). Consequence: the
broker policy page declares no `changeRequest` field in its `searchParams` type and its notices
array prints `query.error` only (`app/policies/[policyId]/page.tsx:45-73` and `:151-153`), so the
parameter is dead: a successful answer produces no confirmation banner, only the anchored panel.
Measured on production: the redirect lands on a page with no notice block. This is the
implementer's stated choice (handoff notes, section 5 item 6, "the page's own notice block was
not touched, because another builder owns those panels") and it is harmless, but the URL now
carries a promise the page does not keep, and a later reader will look for the missing notice.
Required correction: either add the one-line notice to the policy page's notices array, or drop
the parameter from the redirect and keep the anchor.

**F-B13-02, LOW: a refusal aimed at a page the actor cannot read is a silent failure.**
Trigger: a customer POSTs a change request on a policy that is not theirs (a forged form, or a
stale tab). Consequence: the route redirects to `/policies/{that policy}?error=…`
(`change-requests/route.ts:37`); the policy page then redirects that customer to `/customer` and
the `error` parameter is dropped, so the customer sees no explanation at all. Measured on
production: the 303 target is the foreign policy, and a follow-up GET on it is a 307 to
`/customer`. The same shape applies to a non-owning broker's refused reply. No information leaks
(the refusal sentence names nothing), and the refusal itself is correct; only the message is
lost. Required correction: send a refusal to a page the actor may read, for example
`/customer?error=…` when the actor is a customer who does not own the policy, or accept it and
say so in the notes.

**F-B13-03, LOW: "answered" is decided by the truthiness of five joined columns.**
Trigger: `changeRequestsOfPolicy` builds `reply` only when
`row.reply_id && row.outcome && row.reply_text && row.replied_by_name && row.reply_recorded_at`
are all truthy (`lib/policy/change-requests.ts:264-273`). `users.display_name` is `text not null`
with no non-empty CHECK (`db/migrations/0002_policies_and_money_operations.sql:63`), so a replier
whose display name is the empty string would make an answered request render as open on both
panels, with the reply form offered again; pressing it would then be refused by the unique
constraint, which is a confusing dead end. Consequence: the two screens would disagree with
`countOpenChangeRequests`, which asks the right question in SQL (`not exists`) and would still
say zero. No such user exists today (the seed writes real names), so this is latent, not
observed. Required correction: decide on `row.reply_id !== null`, which is the fact the left join
actually reports, and keep the names as display values.

**F-B13-04, LOW: the `lines` CHECK does not forbid repeats.**
Trigger: a direct INSERT (owner or `app_runtime`) of `lines = ['other','other','other']`.
Consequence: `cardinality(lines) between 1 and 7` and `lines <@ array[…]` are both satisfied, so
the row is stored and both panels print the same label three times. The application cannot
produce it (`checkedLines` folds the form through a `Set` and re-orders by the canonical list,
`change-requests.ts:133-145`), so this is a robustness nit, not a reachable defect through the
UI. Required correction: none required; if it is cheap, add
`check (cardinality(lines) = cardinality(array(select distinct unnest(lines))))` or state in the
migration comment that uniqueness is an application invariant.

**F-B13-05, LOW: `openChangeRequestsOfPolicy` is exported and used only by the check script.**
Trigger: reading `lib/policy/change-requests.ts:278-281`. Consequence: an exported function that
no screen calls; `CustomerChangeRequestsPanel` filters the full list itself
(`customer-view.tsx:295`) and the sidebar count uses the SQL counter. READABLE-CODE.md asks for
the smallest surface that meets the brief and AF-06 asks for code Yoann can defend line by line;
a reader will look for the caller and not find one. Required correction: use it in the panel in
place of the inline filter, or delete it and let the check script filter.

**F-B13-06, LOW: the customer's timeline reprints operator-facing correction text verbatim.**
Trigger: the customer opens CGP-01061 (measured on production). Consequence: the reused
`PolicyTimeline` prints the correction reason exactly as staff wrote it: "Bound on 2026-09-08
through a locally signed webhook during development (pi\_local\_…); Stripe never collected this
payment. Reversed by the coordinator per review finding F-B2-01 and Yoann's decision." A customer
now reads an internal payment-intent reference, an internal review-finding id and the word
"coordinator". Nothing here belongs to another customer, nothing is a secret and the data is
sandbox, so this is a disclosure-of-tone problem, not a leak; but the handoff notes claim the
timeline summaries "describe the customer's own policy and its own amounts", and that is true of
the amounts only, not of the free text a staff member types into a correction reason. Required
correction: either show the customer the event and its amounts without the operator's reason
text, or state in the notes that correction reasons are customer-visible so they are written for
that audience. Yoann should decide which, because it is visible in a demo.

**F-B13-07, LOW: nothing bounds how many requests a customer may send.**
Trigger: a customer submits the form repeatedly. Consequence: each request is one row and one
unit in the broker's "what needs you" count, and no row can ever be deleted, so a noisy customer
permanently inflates the broker's queue. The comment length is the only bound. Already disclosed
by the implementer (handoff notes, "What is not done"). Required correction: none for the trial;
keep it in the README limitations if it is not there already.

No HIGH and no MEDIUM finding. No violation of AF-01 to AF-06 was observed within this scope.

## 6. Checks actually executed

| Check | Command | Result |
|---|---|---|
| Types | `npx tsc --noEmit` | pass, no output |
| Slice check on the disposable database | `node --env-file=<main .env.local> --import tsx scripts/check-change-requests.ts` (the body of `npm run check:change-requests`), run **once** | **35 checks, 35 PASS**, "all checks passed" |
| Unit suite | `node --env-file=… --import tsx --test lib/**/*.test.ts` | 426 tests, 425 pass, 1 skipped, 0 fail |
| Migration state on `corgi_test` | read-only `select file_name from schema_migrations` | last applied `0019_policy_change_requests.sql`; both tables exist |
| Guards, grants, constraints, columns on `corgi_test` | read-only `pg_trigger`, `pg_constraint`, `information_schema` | six triggers, `app_runtime` = `INSERT,SELECT`, the two CHECKs on `lines`, the CHECKs on `comment` and `reply_text`, `UNIQUE (request_id)`, both `recorded_at` `timestamptz not null default now()` |
| The same, on the trial database | read-only, as `app_runtime` | identical six triggers, `app_runtime` = `INSERT,SELECT`, `UNIQUE (request_id)` present |
| No money row written during the exercise | read-only counts since 2026-09-09T06:50:00Z | `journal_entries` 0, `policy_events` 0, `money_operations` 0, `money_operation_events` 0, `approval_requests` 0, `claim_events` 0 |
| Deployed revision | `GET /api/health` | `b40e80388a8f95d8fdc5fce533da0838012a76c9`, `database: ok` |
| Deployed behaviour | 30 measured requests across five accounts, section 4 | as tabulated; two rows created, both authorised |
| Secret scan | `gitleaks protect --staged` before committing this review | see the commit; no finding |

Checks **not** executed, and why:

- `npm run check:money-guards`: instructed not to run it; the coordinator proves the guards on an
  ephemeral database, and it is the shared-database contention case recorded for `corgi_test`.
- `npm run build`: not run. The deployed revision is the build evidence, and it is serving.
- A real `TRUNCATE` against either table: not attempted. A truncate that got through would
  destroy rows, and the instruction forbids deleting any row; the trigger definitions were read
  from `pg_trigger` on both databases instead. This is inspection, not execution.
- Concurrency (two brokers answering at the same instant): not run against production. The
  guarantee is the unique constraint, which the check script exercises directly with a second
  INSERT, and the application's 23505 handler is exercised by the production duplicate answer.
- An `agent` principal on production: impossible by construction (the login route refuses the
  role and the MCP surface has no tool for these tables), so it rests on the `corgi_test` check.
- A browser: everything above is HTTP and HTML inspection. Nobody has looked at these two screens
  in a browser at any width; layout and keyboard behaviour are unreviewed.
- The other slice checks and the shared planning files: outside this scope.

## 7. Verdict

**PASS** for slice B13-6 at revision `b40e803`, scope: migration 0019, `lib/policy/change-requests.ts`,
the two API routes, `app/policies/[policyId]/customer-view.tsx`, the ownership block and the new
panel in `app/policies/[policyId]/page.tsx`, the broker count in `components/what-needs-you.tsx`
and `scripts/check-change-requests.ts`.

Everything the slice claims is true and measured: the migration is strictly additive, both tables
refuse UPDATE, DELETE and TRUNCATE for every role including the owner, the recording time comes
from the database clock, `app_runtime` holds SELECT and INSERT only, the seven lines are closed by
a CHECK, one request has exactly one answer because of a unique constraint, no money row is
written or read anywhere in the slice, ownership comes from the session on every path, and the
broker's count matches the open requests on their own policies. The seven findings are all LOW:
one dead redirect parameter, one refusal message that never reaches its reader, one latent
truthiness test, one CHECK that tolerates repeats, one unused export, one reuse of operator
wording on a customer screen, and the absence of a rate limit. None of them blocks the slice.

Residual limitations of this review: no browser was used, so the two screens are unreviewed as
visual artefacts; concurrency was proven at the database, not through the deployed endpoint; the
`agent` refusal and the owner-role trigger refusals rest on `corgi_test`, because reproducing
them on production would require writing or destroying rows; `corgi_test` is shared with other
agents, so only the deltas measured here are this review's own; and the two design choices named
in section 2 (staff operations answering any policy, a request allowed on a cancelled or voided
policy) are recorded as open questions for Yoann, not as defects.

**Candidate walkthrough status: NOT REVIEWED WITH YOANN.**

## 8. Register lines for the coordinator to copy into `docs/reviews/FINDINGS.md`

| ID | Sev | Finding (one line) | Fix | Status |
|---|---|---|---|---|
| F-B13-01 | LOW | The reply route redirects to `?changeRequest=answered` but the broker policy page declares no such parameter and prints `error` only, so a successful answer shows no confirmation notice | Add the notice to the page's notices array, or drop the parameter and keep the anchor | OPEN |
| F-B13-02 | LOW | A customer's refused change request on someone else's policy redirects to that policy page, which then redirects them to `/customer` and drops the `?error=`, so the refusal is silent | Send the refusal to a page the actor may read | OPEN |
| F-B13-03 | LOW | `changeRequestsOfPolicy` decides "answered" from the truthiness of five joined columns including `display_name`, which has no non-empty CHECK, so an empty display name would render an answered request as open while the SQL count says zero | Test `row.reply_id !== null` | OPEN |
| F-B13-04 | LOW | The `lines` CHECK uses `<@` plus cardinality, so a direct INSERT can store the same line several times and both panels print the label twice; the application dedupes, the database does not | Add a distinctness CHECK, or state that uniqueness is an application invariant | OPEN |
| F-B13-05 | LOW | `openChangeRequestsOfPolicy` is exported and called only by the check script; the panel filters the list inline and the sidebar uses the SQL counter | Use it in the panel, or delete it | OPEN |
| F-B13-06 | LOW | The customer's timeline reprints a staff-written correction reason verbatim, including an internal payment-intent reference, a review-finding id and the word "coordinator" (observed on CGP-01061) | Hide the reason text from the customer, or write correction reasons for a customer audience; Yoann's call | OPEN |
| F-B13-07 | LOW | No bound on how many change requests a customer may send; each one permanently adds a unit to the broker's queue because no row can be deleted | Accept and keep it in the README limitations | OPEN (disclosed) |
