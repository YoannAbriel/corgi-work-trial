# Independent review, slice B13-9: the operations console v1

Reviewer: independent reviewer sub-agent, working in the worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/agent-a1ae88456b956ad9d`, branch
`worktree-agent-a1ae88456b956ad9d`. Written at 2026-09-09T08:35Z. Linear YOA-638.

Reviewed revision: `main` at **5d405d2**. The slice is the merge **020fd86** of
`worktree-agent-a9138ff45d6d14898` plus the navigation commit **5d405d2**. The diff read line by
line is `git diff 020fd86^1 5d405d2`: **18 files, +5650, -0**. Every file is new except
`components/portal-shell.tsx` (+3, the navigation entry) and `package.json` (+1, the
`check:console` script). There is no migration and no change to any existing route, reader or
money path, so this slice cannot regress anything already reviewed.

The deployed application reports revision `5d405d2a61a2ede243647a43cdc1ed9bb7304657` at
`/api/health` throughout this review. Every production measurement below was taken there, signed
in as `ops@example.com`. The demo password was read from the main tree's `.env.local` into a
shell variable and never printed, logged or written to a file.

This is a scoped engineering assessment of one read-only slice. It is not a legal certification
and it is not a statement that the six delivery gates pass for the submission.

## 1. Startup receipt

Read in full, in this order, before looking at any code: `CLAUDE.md`, `AUTOMATIC-FAILS.md`,
`READABLE-CODE.md`, `AGENTS.md`, `WORKFLOW-48H.md`, `REVIEWER.md`,
`docs/handoffs/b13-9-console-notes.md`.

Read in part, with what was read named: `docs/ARCHITECTURE.md` sections 6, 7 and 8 (approvals,
roles and MCP; jobs and reconciliation; trust boundaries) plus section 1 for the protected-table
list; `docs/DECISIONS.md` lines 160 to 185, which contain the five 2026-09-09 entries including
the console decision of 07:40:31Z; `docs/reviews/FINDINGS.md` (the tail, for the register format
and the highest allocated id, F-B13-14).

Read in full, for the scope itself: `lib/console/read.ts` (all 2815 lines, section by section),
`lib/console/infra.ts`, `lib/console/safe-read.ts`, `lib/console/access.ts`,
`lib/console/guard.ts`, `components/console-parts.tsx`, `components/console-360.tsx`,
`app/ops/console/page.tsx`, `app/ops/console/search/page.tsx`, `app/ops/console/infra/page.tsx`,
the four 360 route wrappers under `app/ops/console/{customer,broker,policy,claim}/[id]/page.tsx`,
`lib/http/path-ids.ts`, and the header and fixture setup of `scripts/check-console.ts`.

Read for corroboration, named: `components/portal-shell.tsx` (the navigation entry and
`workspaceTasks`), `components/what-needs-you.tsx` lines 34 to 95, `lib/money/cents.ts`,
`lib/reconciliation/read.ts` lines 173 to 217 (`openBreaks`), `app/api/session/login/route.ts`,
`app/api/jobs/reconcile/route.ts` and `app/api/brokers/[brokerId]/kyb/recheck/route.ts` (the two
POST targets), and the money-column definitions in `db/migrations/0001`, `0002`, `0005`, `0008`,
`0009`, `0011`, `0012`, `0014`.

Absent files: none. Every file named in the assignment exists and was read.

Next acceptance criterion in scope: the seven console screens are read-only, staff-only, solid
under a hostile query string, honest about what is measured and what is documented, and mask
personal data by default.

## 2. Applicability

Product: an insurance policy administration application (Track 1), USD, sandbox providers,
synthetic data. The slice adds **no** money path, no provider call, no write route and no
migration. It is an internal staff diagnostic surface over tables other slices own.

Confirmed facts: the console reads twenty-one tables; it renders two POST forms, both to routes
that predate it; it holds the restricted runtime role, which has `SELECT` and `INSERT` and never
`UPDATE` or `DELETE` on the protected tables (architecture section 1, re-proven below).

Assumptions carried by the slice and stated on its screens: the 15-minute
`checking` / `unknown outcome` split (decision of 2026-09-09T07:40:31Z, answer 4). No legal
regime is engaged by this slice beyond the data-minimisation practice already recorded for the
application: it stores nothing, transmits nothing to a third party, and displays only data the
staff screens already display. No new US requirement was identified as applicable to a read-only
internal view; this is an engineering assessment, not a compliance opinion.

The eleven documented provider limits in `lib/console/infra.ts` carry a `readOn` date of
2026-09-09. All eleven were independently re-fetched from the providers' own pages during this
review and all eleven are accurate; two carry a wording caveat (F-B13-29). Details in section 6.

## 3. Requirement matrix

| # | Requirement | Control / code location | Evidence | Verdict |
|---|---|---|---|---|
| 1 | No INSERT, UPDATE, DELETE or provider call in `lib/console` or the console pages | `lib/console/*.ts`, `app/ops/console/**`, `components/console-{parts,360}.tsx` | `grep -rniE "\b(insert\|update\|delete\|truncate\|alter\|drop\|grant\|revoke)\b"` over those paths returns **zero** hits outside the identifier `updated_at`; no `fetch(`, no `stripe.`, no server action, no `revalidate` | PASS |
| 1b | The two forms post to routes that already existed | `components/console-parts.tsx:149,158` | targets `/api/jobs/reconcile` (first committed e93b549, 2026-09-08) and `/api/brokers/{brokerId}/kyb/recheck` (2a0737a, 2026-09-08); both re-check the role server-side (`currentUser`, staff test; the KYB route also runs `badPathIdResponse`) | PASS |
| 1c | The restricted runtime role cannot mutate what the console reads | `scripts/check-console.ts`, last assertion | `npm run check:console`: `select true, update false, delete false` | PASS |
| 2 | Anonymous redirected to `/login` | `lib/console/access.ts`, `lib/console/guard.ts` | production, no cookie: all of `/ops/console`, `/search`, `/infra` and a valid policy 360 answer **307 → /login** | PASS |
| 2b | Broker and customer redirected | same | production: `broker@example.com` → **307 /broker** on all four paths; `customer@example.com` → **307 /customer** on all four | PASS |
| 2c | Agent role refused | `access.ts` (`agent` falls through to `/broker`), `app/api/session/login/route.ts:24` | an `agent` principal cannot obtain a session at all (login refuses `role === "agent"`); `check:console`: "an agent principal is sent away from the console (/broker)"; the MCP surface exposes no console tool (5 tools listed, none of them console) | PASS |
| 2d | Malformed ids answer 404 | the four wrappers, `lib/http/path-ids.ts` | production, signed in: `/policy/not-a-uuid`, `/claim/1`, `/broker/%27` all **404**; a well-formed unknown uuid also **404**; no 500 | PASS |
| 2e | Every path id through `isUuid` | the four wrappers | all four call `isUuid` then `notFound()` before rendering `Console360`; `resolveReference` gates every branch on a shape regex before any query, so no unvalidated text reaches a uuid cast | PASS |
| 3a | Every reader wrapped; a failing query shows a line and never blanks the page | `lib/console/safe-read.ts`, `FailureLine` in every panel | proven live: `?since=999999d` makes two panels print a red line and the rest of the page render at HTTP 200 (see F-B13-21, which is the input defect, not the net) | PASS |
| 3b | Every query bounded | `read.ts` | 44 of 46 queries carry a `limit` or are a single-row aggregate. Two do not: `openBreaks` reached through `openBreaksOfSubject` (F-B13-22) and the `latest` CTE of `acceptedAndUnconfirmedOperations` (F-B13-23) | **FAIL** |
| 3c | The `since` cursor and the filters sanitised | `parseSince`, `isConsoleEventKind` | filters: PASS, an unknown `kind` is dropped before any reader is chosen and an unticked kind costs no query. Cursor: **FAIL**, `parseSince` bounds the digits but not the resulting instant (F-B13-21) | **FAIL** |
| 3d | No N+1 over an unbounded set | `consoleSubject`, `claimIdsOfPolicies`, the 360 panels | the policy and claim id lists are read once (capped at 200 each) and passed to every panel as an `any(...::uuid[])` array; no panel iterates rows issuing queries. `byUuid` issues up to 7 serial primary-key lookups, which is a fixed number, not a fan-out | PASS |
| 3e | Seven pages under 3 s on production | measured, section 5 | worst single sample 0.89 s, worst p50 0.447 s | PASS |
| 4a | Latency figures are Postgres `percentile_cont` over 24 hours | `latencyTiles`, `LATENCY_WINDOW_HOURS = 24` | five `percentile_cont(0.5\|0.95) within group` aggregates, computed in SQL, window `now() - 24h` on the closing instant with a 48-hour lookback for the opening one; the page prints "over the last 24 hours" from the same constant and puts the sample count on every row | PASS |
| 4b | The 15-minute rule stated on screen as an assumption | `app/ops/console/page.tsx`, errors panel disclosure | rendered HTML contains "an assumption of this build" and "not a rule of Stripe and not a rule of Corgi", next to the panel the rule governs | PASS |
| 4c | Infra: measured facts next to documented limits, with source URL and date, never a documented limit presented as measured | `app/ops/console/infra/page.tsx`, `lib/console/infra.ts` | the table has separate "Measured today" and "Documented limit" columns; a headroom is computed for the one row where the units match and every other row says why it cannot be (`not a number: the limit is a frequency, this is an instant`); the documented aside says "documented facts, not measurements", carries 11 source links and the read date; the page states what it cannot measure (Vercel duration, memory, invocations, bandwidth) instead of showing a figure | PASS |
| 4c-bis | The eleven documented limits actually say what the code quotes | `lib/console/infra.ts:38` to `:118` | all eleven re-fetched from the providers' pages during this review: **11 accurate, 0 inaccurate, 0 unverifiable**; two carry a wording caveat (F-B13-29) | PASS |
| 4d | No raw payload and no secret in the rendered HTML | `SANITISED_DETAIL_LENGTH = 220`, the payload keys read | scan of the seven rendered pages: **zero** matches for `sk_`, `whsec_`, `rk_`; the only `cmk_` tokens are 12 characters, that is `cmk_` plus the 8-hex public prefix, never a key; no `"livemode"`, no `"object":`, no `Bearer `, no connection string | PASS |
| 4e | No email unmasked when the fold is closed | `Masked` in `components/console-parts.tsx` | scan of the seven pages: 3 email addresses in total, **3 of 3 inside a closed `<details>` body**, 0 outside a fold. See the caveat in section 7 | PASS |
| 5 | Personal data masked by default with a reveal fold | `maskToFirstThree`, `Masked` | names, emails, claimant names, requester and approver names all render as `abc***` inside a native `<details>`; non-person actors (`stripe`, the ledger, a key prefix) print plainly, driven by `actorIsPerson` on every feed row | PASS (one broken fold, F-B13-25) |
| 6a | The meta refresh is in the head | `app/ops/console/page.tsx` | rendered HTML: `<meta http-equiv="refresh" content="10"/>` at byte 1120, `</head>` at byte 1244. **In the head.** | PASS |
| 6b | "Refresh now" is a GET | same | rendered HTML: `<form class="inline-form" action="/ops/console" method="get">`. The only POST form on the page is the shell's logout | PASS |
| 7 | AF-06: is `read.ts` explainable line by line, or is a split required | section 8 | no split required before submission; a reading map is | PASS with a recommendation |
| 8 | `npm run check:console` on `corgi_test` | `scripts/check-console.ts` | run once, 48 PASS, 0 FAIL. What it proves and does not prove: section 9 | PASS |

## 4. Findings

### F-B13-21 (MEDIUM, blocking) `parseSince` bounds the digits but not the instant, and the two main panels go dark

**Trigger.** Sign in as staff, open `/ops/console?since=999999d`, or type `999999d` into the
"Since" box the page itself provides.

**What happens.** `parseSince` (`lib/console/read.ts:121`) accepts one to six digits followed by
`m`, `h` or `d`, and computes `new Date(now - minutes * 60000)` with no floor. `999999d` is
2738 years, so the instant is year -712. JavaScript represents it; `postgres.js` serialises it as
`-000712-10-13T08:08:12.975Z`; Postgres refuses it. Measured on production:

```
the errors and unknowns could not be read: time zone displacement out of range: "-000712-10-13T08:08:12.975Z"
the feed could not be read: time zone displacement out of range: "-000712-10-13T08:08:12.975Z"
```

The page still answers 200 and every other panel renders, which is `attempt` doing its job. But
the two panels the console exists for, the feed and the errors list, are both dead, and the only
thing the operator did was type a number into the form.

**Boundary, measured.** `3650d`, `99999d` and `700000d` all render with zero failed panels;
`740000d`, `800000d` and `999999d` each fail two panels. The break is at the year-1 boundary, as
expected. An ISO instant is not affected: `0001-01-01T00:00:00Z` and `275760-09-13T00:00:00Z`
both render cleanly.

**Consequence.** In the exact scenario the slice was built for, a reviewer poking the query
string during the debrief, the cockpit loses its feed. Nothing is written, nothing leaks and no
money is touched; this is a robustness defect, not a security one.

**Required correction.** Clamp the computed instant in `parseSince`, in the pure function, so the
check script can prove it without a database. A floor of the application's own epoch (the first
migration, or simply `now - 10 years`) is enough, with the `reading` sentence saying the window
was clamped and to what. Two lines, one new assertion in `scripts/check-console.ts` next to the
existing "a since cursor that is not an instant falls back to the default window".

### F-B13-22 (LOW) `openBreaksOfSubject` reads every open break in the system, then filters in TypeScript

**Location.** `lib/console/read.ts:2352`, calling `openBreaks` in `lib/reconciliation/read.ts:173`.

**Trigger.** Open any 360 page. `openBreaks(database)` runs a `with latest_report as (...)` query
with **no `LIMIT`**, returns every open break of every broker and customer, and
`openBreaksOfSubject` then keeps the rows whose `ledgerRef` or `providerRef` belongs to this
object.

**Consequence.** The one query on the 360 pages whose cost grows with the whole system rather
than with the object being looked at. On the trial database the breaks table is small and the
measured p50 of the four 360 pages is 0.34 to 0.45 s, so nothing is visible today. It
contradicts the slice's own stated rule ("Every read is bounded", `console-360.tsx` header) and
the assignment's "every query bounded".

**Required correction.** Either pass the reference sets into a bounded query, or accept it
explicitly with a `limit` and a sentence saying the panel shows at most N of this object's
breaks. `openBreaks` is owned by B10 and is used by `/ops/reconciliation` too, so the smaller
change is a console-local bounded reader rather than editing the shared function.

### F-B13-23 (LOW) the `latest` CTE of `acceptedAndUnconfirmedOperations` scans the whole event table, twice per feed render

**Location.** `lib/console/read.ts:1097`.

**Trigger.** Every render of `/ops/console`.

```sql
with latest as (
  select distinct on (operation_id) operation_id, status, recorded_at, provider_ref
    from money_operation_events
   order by operation_id, sequence_number desc
)
```

There is no time bound and no limit inside the CTE; the outer `limit 50` is applied after the
whole table has been reduced. Postgres has no loose index scan, so the cost is proportional to
the total number of money-operation events ever written, not to the window the operator asked
for. The feed page calls this reader **twice** per render: once directly
(`acceptedAndUnconfirmedOperations(sql)`) and once inside `operationsProblems`, which calls it
again with a different limit. With the ten-second meta refresh, that is twelve full passes a
minute per open tab.

**Consequence.** Nothing measurable today (feed p50 0.332 s). It is the one query in the slice
that gets slower as the ledger grows, and it is on the page that reloads itself.

**Required correction.** Bound the CTE by time (an operation accepted more than, say, 7 days ago
is not "in flight", it is a stale break the recovery job owns), and pass the single result down
from the page into `operationsProblems` instead of reading it twice.

### F-B13-24 (LOW) `consoleSubject` is the one read on a 360 page not wrapped in `attempt`

**Location.** `components/console-360.tsx:50`.

```ts
const subject = await consoleSubject(sql, kind, id);
if (!subject) { notFound(); }
```

Every other read on the page goes through `attempt`. This one does not, so a failure of the
identity query, for example a permission the runtime role turns out not to hold on
`policy_current`, or a `brokers`/`customers` join that raises, replaces the whole 360 page with
the framework error page rather than a named line. That is the exact behaviour the slice's own
`safe-read.ts` header says is backwards.

**Consequence.** Small, because the id lists this query produces scope every other panel, so
there is genuinely less to render without it. But "the console is what an operator opens while
something is already broken" applies most to the page that identifies the object.

**Required correction.** Wrap it, and on failure render the heading, the failure line and the
panels that need no scope, instead of throwing. If that is judged not worth the code, say so in
the handoff note rather than leaving the header claim unqualified.

### F-B13-25 (LOW) the masked customer name on a broker 360 page cannot be revealed: a `<details>` inside an `<a>`

**Location.** `components/console-360.tsx:311`.

```tsx
<Link href={`/ops/console/customer/${policy.customerId}`} prefetch={false}>
  <Masked value={policy.customerName} what="customer name" />
</Link>
```

`Masked` renders a `<details><summary>`. Interactive content inside an anchor is invalid HTML,
and in a browser the click lands on the link: the fold never opens, the operator is navigated to
the customer page instead. The masking works; the reveal does not, on that one cell.

**Required correction.** Put the link and the fold side by side rather than nested: the masked
name as a plain `Masked`, and a separate "open" link, which is the pattern the same table already
uses in its last column.

### F-B13-26 (LOW) a failed search is displayed as "nothing matches"

**Location.** `app/ops/console/search/page.tsx:60` and `:113`.

When `attempt("the search", ...)` fails, `result` is null, so the "What it is" panel renders the
red failure line **and**, underneath it, the sentence "Nothing in this database matches that
reference." The "Its trail" panel renders "Nothing to show yet." with no failure line at all.
A read that failed is being reported as a fact about the data. That is the one honesty rule this
slice is otherwise scrupulous about: the whole point of naming the recognised shape before the
answer is that "nothing found" must never be ambiguous.

**Required correction.** Branch on `found.ok` before the Empty branch in both panels, and say
"the search could not be run" rather than "nothing matches". Not observed live; found by reading,
and not reproducible on production without breaking a query on purpose.

### F-B13-27 (LOW, accepted as written) `(payload ->> 'raised_by_agent')::boolean` depends on a payload shape

**Location.** `lib/console/read.ts:510` and `:2269`.

The only writer is `lib/claims/payments.ts:267`, which writes a real JSON boolean, and a payload
without the key yields `NULL::boolean`, which is fine. So the cast is safe against every row that
exists. It is nonetheless the one place in the slice where a *value* inside a payload is cast
rather than read as text: an approval request payload carrying `"raised_by_agent": "yes"` would
raise `invalid input syntax for type boolean` and take out the approvals panel and the whole
feed. `attempt` contains it. Recorded so that the dependency is visible, not because a fix is
required for the trial; the cheap version is `= 'true'` on the text.

### F-B13-28 (INFO) the failure line prints the raw Postgres message

**Location.** `lib/console/safe-read.ts:24`.

The line put on the screen is the driver's message, whitespace-collapsed and cut at 300
characters. On the `999999d` case that message echoed the operator's own input back. The console
is staff-only and the reads are all `SELECT`, so no constraint violation can print a row and no
secret is ever a bound parameter here. Recorded as a known property of the design, not a finding
against it: naming the real error is what makes the red line useful.

### F-B13-29 (LOW) two of the eleven documented limits are a reading of the page rather than a quotation of it

All eleven quoted limits in `lib/console/infra.ts` were re-fetched from the providers' own pages
during this review and all eleven are accurate. Two put a word in the provider's mouth:

- **Neon compute** (`infra.ts:80`) is quoted as "100 CU-hours per project **per month**". The
  Free row on `https://neon.com/docs/introduction/plans` reads "Compute | 100 CU-hours/project",
  with no "per month" in the cell. The monthly framing comes from the plan's billing period, not
  from the sentence being quoted.
- **Stripe per-endpoint rate limit** (`infra.ts:104`) is quoted as "25 requests per second
  globally, **and 25 requests per second per endpoint**" under the heading "sandbox (test mode)".
  On `https://docs.stripe.com/rate-limits` the global row is split by mode ("Live mode: 100
  requests per second, Sandbox: 25 requests per second") but the per-endpoint row is **not**:
  it reads "Individual API endpoints (unless otherwise noted) | 25 requests per second", with no
  mode qualification. Attaching it to the sandbox column is an inference.

Two smaller wording differences, recorded and not requiring a change: Neon says "public network
transfer" where the code says "public egress" (`infra.ts:88`), and the Vercel duration table is
prefaced "With fluid compute enabled", which the quotation does not carry (`infra.ts:50`).

**Consequence.** Small, and it cuts against the one thing this page is built to get right. The
screen's own rule is that a documented value is "quoted from the page, not summarised"
(`infra.ts:34`), and in these two cells it is summarised. Nobody is misled about a number; they
are told the provider said something slightly more specific than it said.

**Required correction.** Quote the two cells verbatim and move the inference into the `what`
field, for example "Compute, Free plan (per billing period)" with the cell reading
"100 CU-hours/project", and split the Stripe entry into the mode-qualified global limit and the
unqualified per-endpoint limit.

## 5. Response times measured on production

Signed in as `ops@example.com` on `https://corgi-work-trial-iota.vercel.app`, revision `5d405d2`.
Each page was fetched once to warm it, discarded, then **three** timed fetches. `time_total` from
`curl`, seconds, cold TLS handshake included in each. p50 is the median of the three.

| Page | run 1 | run 2 | run 3 | **p50** | HTTP | bytes |
|---|---|---|---|---|---|---|
| `/ops/console` | 0.292 | 0.333 | 0.893 | **0.333 s** | 200 200 200 | 61 048 |
| `/ops/console/search?reference=CGP-01061` | 0.287 | 0.350 | 0.515 | **0.350 s** | 200 200 200 | 76 292 |
| `/ops/console/infra` | 0.379 | 0.341 | 0.353 | **0.353 s** | 200 200 200 | 56 750 |
| `/ops/console/customer/{id}` | 0.347 | 0.338 | 0.315 | **0.338 s** | 200 200 200 | 127 072 |
| `/ops/console/broker/{id}` | 0.560 | 0.414 | 0.447 | **0.447 s** | 200 200 200 | 246 758 |
| `/ops/console/policy/{id}` | 0.407 | 0.396 | 0.387 | **0.396 s** | 200 200 200 | 169 172 |
| `/ops/console/claim/{id}` | 0.388 | 0.464 | 0.403 | **0.403 s** | 200 200 200 | 194 651 |

Worst p50 **0.447 s**, worst single sample **0.893 s**. Nothing is above 3 seconds, so there is
no finding under that threshold. The subjects were real rows of the trial database: policy
`de2fb99f`, claim `2f78c23c`, customer `5f55b8dd`, broker `edae60d2`, chosen because they carry
money operations, journal entries, approvals and change requests rather than being empty.

Two extra windows, for the shape of the cost: `?since=1970-01-01T00:00:00Z` (the full 200-row
feed, 357 745 bytes) answered in **0.508 s**, and `?since=3650d` in **0.490 s** with zero failed
panels. The feed does not become slow when it is asked for everything.

## 6. Checks executed

| Check | Command | Result |
|---|---|---|
| Console evidence script | `npm run check:console` | **48 PASS, 0 FAIL**, "all checks passed", run once on `corgi_test` |
| Mutation scan of the slice | `grep -rniE "\b(insert\|update\|delete\|truncate\|alter\|drop\|grant\|revoke)\b"` over `lib/console`, `app/ops/console`, `components/console-{parts,360}.tsx` | zero hits |
| Provider-call scan | `grep -rniE "fetch\(\|stripe\.\|revalidate"` over the same paths | zero hits |
| Form scan | `grep -rn "<form\|method="` over the same paths | 3 GET forms of the console, 2 POST forms to pre-existing routes |
| Access control, anonymous | `curl` without a cookie, 5 paths | 4 × 307 → `/login`, 1 × 404 (the malformed id, which is checked before the guard) |
| Access control, broker | login as `broker@example.com`, 4 console paths | 4 × 307 → `/broker` |
| Access control, customer | login as `customer@example.com`, 4 console paths | 4 × 307 → `/customer` |
| Access control, approver | login as `approver@example.com`, 4 console paths | 4 × 200 |
| Malformed path ids | 4 shapes, signed in | 4 × 404, no 500 |
| Hostile query strings | 11 inputs: SQL injection in `since` and `reference`, `NaN`, far future, epoch, a bogus `kind`, `<script>` as a `kind`, a 500-character reference, a 300-character `pi_` | all HTTP 200, all correctly handled, **1 input produced failed panels** (F-B13-21) |
| Output escaping | `<img src=x onerror=alert(1)>` through the search | escaped in the HTML, 0 raw occurrences, 0 injected script tags; no `dangerouslySetInnerHTML` anywhere in the slice |
| Secret scan of the rendered HTML | 7 pages, unescaped, regex for `sk_`, `whsec_`, `rk_`, `cmk_` | zero secrets; 3 `cmk_` tokens, all 12 characters, that is the public prefix only |
| Personal-data scan of the rendered HTML | 7 pages, emails inside vs outside a `<details>` body | 3 emails, 3 behind a closed fold, **0 outside** |
| Head placement of the meta refresh | byte offsets in the rendered HTML | meta at 1120, `</head>` at 1244: in the head |
| Panel health on real trial data | 7 pages plus a 10-year window | 0 failed panels on all 8 |
| Slice diffstat | `git diff --stat 020fd86^1 5d405d2` | 18 files, +5650, -0, no migration |
| Provenance of the two POST targets | `git log -1` on each route file | e93b549 and 2a0737a, both 2026-09-08, both before the console |
| The eleven documented provider limits | each `sourceUrl` re-fetched from the provider's own page during this review | **11 accurate, 0 inaccurate, 0 unverifiable**; the Vercel cron, duration, memory, payload and usage rows, the four Neon Free rows and the two Stripe rate-limit rows all match the pages as they read today. Two wording caveats, F-B13-29 |

The documented-limits check is the one that matters for honesty, so its result is worth stating
plainly: the numbers on the infrastructure page are not stale and not invented. Neon Free is
0.5 GB storage, 10 branches and 100 CU-hours; the plans page still states no connection limit,
which is exactly what the screen says instead of guessing one; Vercel Hobby is once-per-day cron
with per-hour precision, 300 s, 2 GB and 4.5 MB; Stripe sandbox is 25 requests per second global
and 5 Connect accounts per second. The Stripe page rendered in German on the first fetch and
identically in English with `?locale=en-US`, so the quoted wording is the page's own.

Checks **not** executed, and why:

- `npm run check:money-guards`: explicitly excluded by the assignment.
- `npm run typecheck`, `lint`, `build`, and the rest of the check suite: out of scope; the slice
  is deployed and rendering, which is stronger evidence for this scope than a local build.
- No load or concurrency test: `STRESS-TEST-PLAN.md` was not read and no performance profile was
  run. The seven measurements above are single-user response times, not a capacity claim.
- The `attempt` net was proven live on exactly one failure mode (F-B13-21). The other 45 readers
  were read, not made to fail.
- Browser behaviour was not observed: every measurement is `curl` against the rendered HTML. The
  meta refresh, the `<details>` folds and F-B13-25 were assessed from the markup, not from a
  browser session.

## 6-bis. Automatic-fail gate for this scope

`REVIEWER.md` requires AF-01 to AF-06 to be mapped to actual controls for the assigned scope,
with final-delivery checks that are not yet possible marked NOT RUN. A scoped result here never
implies that the six delivery gates pass for the submission.

| AF | Mapping for this slice | Result |
|---|---|---|
| AF-01 accessible deployed URL | the seven screens are live at `https://corgi-work-trial-iota.vercel.app/ops/console` on revision `5d405d2`, exercised from outside the development session with two roles (`ops@example.com`, `approver@example.com`) and refused for three others | PASS for this scope |
| AF-02 no simulation presented as live | the slice integrates no provider and claims none. The infrastructure page explicitly says it calls no provider API and names what it therefore cannot measure. The latency tiles are labelled with the exact two instants subtracted, and the sample count is on every row | PASS |
| AF-03 no UPDATE or DELETE on money rows | no mutation keyword exists anywhere in the slice (scan, section 6); the two POST forms target pre-existing routes; and `check:console` re-proves that the role the console reads with holds `SELECT` and neither `UPDATE` nor `DELETE` on every table it touches | PASS |
| AF-04 sandbox only, no real personal data | the slice creates no provider side effect and no data. It displays what other slices stored, which is seeded synthetic data. `check:console` writes its fixture only to `corgi_test` and refuses any other database | PASS for this scope |
| AF-05 no secrets committed | this review commits one Markdown file containing no credential, no connection string and no key. Repository-wide evidence supplied by the coordinator and cited, not rerun: `gitleaks git --redact --no-banner .` from the main checkout scanned **332 commits / 6.68 MB with no leaks found (exit 0)**; a directory scan found **81 hits, all in untracked or ignored locations** (34 under `.claude/worktrees`, 7 under `.worktrees/corgi-interface`, 5 under `.next`, the two `.env` files) and **zero in tracked files**, cross-checked against `git ls-files` | PASS, on cited evidence |
| AF-06 explainable line by line | assessed in section 8: no split required, a reading map recommended, two lines named for rehearsal. A reviewer can assess explainability; it cannot certify Yoann's understanding | NOT RUN as a walkthrough; see the status below |

Candidate walkthrough status for this slice: **NOT REVIEWED WITH YOANN**.

## 7. What "masked" means here, stated plainly

`Masked` renders `<details><summary>abc***</summary><div>the full value</div></details>`. The
full name or address **is in the HTML** whether the fold is open or closed; what the fold changes
is whether it is painted. The scan above confirms every email is behind a closed fold and none is
printed in the open, which is the requirement as set. It also confirms that anyone who views
source, or any tool that reads the DOM, sees the value.

The code says this in as many words ("this is a reading discipline, not a security control, and
the console is already staff-only"), the handoff note says it, and the page's own "What is never
shown" fold says it. That is the honest framing and it is the right one for a staff-only screen.
It is repeated here so that nobody at the debrief describes the console as redacting personal
data. It does not redact; it declutters.

## 8. AF-06: is `read.ts` explainable line by line, or must it be split

**Assessment: no split is required before submission. A reading map is.**

`lib/console/read.ts` is 2815 lines in six marked sections:

| Section | Lines | Size | What it holds |
|---|---|---|---|
| 1. The feed | 56 to 875 | 820 | eleven independent per-source readers plus the merge |
| 2. Latency percentiles | 876 to 1043 | 168 | five SQL aggregates and one tile mapper |
| 3. Problems and in-flight | 1044 to 1351 | 308 | five bounded queries plus the recovery chooser |
| 4. The reference search | 1352 to 1740 | 389 | nine shape regexes and their branches |
| 5. The 360 subject | 1741 to 1971 | 231 | four subject readers plus the id-list reader |
| 6. The 360 panels | 1972 to 2815 | 844 | thirteen independent panel readers |

The argument for leaving it alone is that the file is long but not deep. There is no
indirection, no abstraction layer, no generated code and no clever SQL: 46 queries, each written
out, each in the same three-part shape (a row type, a tagged template query, a `map` to a domain
type). A reviewer pointing at any line lands inside one 40-to-60-line function that can be read
without leaving the screen, and the SQL is the part that has to be explained, which is the same
work whatever file it sits in. Splitting would move the boundary problem, not remove it: sections
1 and 6 are the two large ones and neither has an internal seam, they are lists of siblings.

The argument against is navigation under pressure. Two things carry real explanation load and are
worth rehearsing by name rather than by scrolling: the `latest` `distinct on` CTE at line 1097
(what "the last row of each operation" means and why `sequence_number` and not `recorded_at`) and
the latency window/lookback pair at 917 (why the window applies to the closing instant and the
lookback to the opening one). Both are the two hardest lines to defend cold, and both are already
commented.

Against the freeze, a 2815-line file split into three is a mechanical change with import churn
across seven pages, two components and a 661-line check script, for zero functional gain and a
non-zero chance of a regression on the day. **Recommendation: do not split. Instead put the six
section line ranges above into `docs/handoffs/b13-9-console-notes.md`** so that "show me where
the feed is built" is answered by a table rather than by scrolling, and rehearse the two lines
named above.

Candidate walkthrough status for this slice: **NOT REVIEWED WITH YOANN**. No part of section 8 is
a claim that Yoann can currently explain this file; it is an assessment of whether the file can
be explained, which is a different question, and only he can close the first one.

## 9. What `npm run check:console` proves, and what it does not

Run once, on `corgi_test`, through the restricted runtime role: **48 PASS, 0 FAIL**.

It **proves**, against a real database and through the production readers: the feed is sorted
newest first, never exceeds `MOST_FEED_ROWS`, represents all ten kinds the fixture wrote, and
carries no raw payload; the `since` cursor is honoured for a duration, for an instant after the
fixture, and falls back for an unparseable string; the kind filter queries that kind only; there
are five latency tiles and none is `NaN`; the unknown-outcome rule splits the **same real
operation** both ways when the threshold is passed as a parameter, which is the only honest way
to test it since `recorded_at` is written by the database clock and a fixture row cannot be aged;
all nine reference shapes resolve and an unrecognised shape queries nothing; the access rule
returns `allow`, `/broker`, `/customer` and `/login` for the five principals; the MCP surface
exposes none of these reads as a tool; the 360 readers of one policy return that policy's rows
and none of another policy's; and **the role the console reads with holds `SELECT` on every table
it touches and `UPDATE` or `DELETE` on none of them**, which is the AF-03 evidence for this slice.

It does **not** prove: that the HTTP guard redirects (it tests `consoleAccessFor`, the pure
function, not `requireStaff`; the redirects are proven by the production measurements in section
6 instead); that `attempt` degrades a real failing panel (no assertion makes a query fail); that
the meta refresh reaches the head; that anything is masked in the rendered HTML; that any page is
fast; and it does not cover the `since` overflow of F-B13-21, because its only cursor-fallback
assertion uses an unparseable string, which takes the other branch.

**Contention, observed and reported, not looped.** `corgi_test` is shared with other agents'
fixtures: this run reported "checking 2, unknown 110" and "114 problems", where the fixture wrote
a handful. Every assertion that could be polluted by that is written to pick out this run's own
rows by a per-run tag, which is why the numbers are large and the verdicts are still meaningful.
The script was run **once**. It was not retried, and no failure was attributed to contention.

## 10. Verdict

**FAIL**, on one blocking finding.

Four of the five properties this slice was asked to have are met, and are met carefully:

- **Read only**: no mutation keyword and no provider call exists anywhere in the slice, the two
  forms post to routes that predate it and re-check authorisation server-side, and the database
  role the console reads with cannot write to what it reads. Verified three ways.
- **Staff only**: every path and every role tested against the deployment, including the agent
  principal, which cannot even hold a session. Malformed ids are 404 and every id goes through
  `isUuid`.
- **Honest**: the latency figures are genuinely Postgres percentiles over a stated window with
  the sample count next to them; the 15-minute rule is printed on the screen as an assumption of
  this build and disclaimed as neither a Stripe nor a Corgi rule; the infrastructure page keeps
  measured and documented in separate columns, refuses to compute a headroom where the units do
  not match, and names what it cannot see instead of showing a number nobody measured. Nothing in
  the rendered HTML of the seven pages carries a secret, a key beyond its public prefix, or a
  provider payload. The eleven documented limits were re-fetched from the providers' pages during
  this review and all eleven are accurate; two are summarised where the file's own rule says
  quoted (F-B13-29), which is a wording fix, not a wrong number.
- **Masked by default**: every email and every person's name is behind a closed fold, non-persons
  are printed plainly on purpose, and the code is candid that this is decluttering rather than
  redaction.

The fifth, **solid**, is where it falls short. The safety net itself works, and works well: the
one failure I could produce on production left the page at HTTP 200 with two named red lines and
eleven healthy panels, which is exactly the design intent. But the input that produced it came
from the page's own form, `parseSince` is the one sanitiser in the slice that bounds the wrong
thing, and two queries are unbounded against the assignment's explicit "every query bounded".
Under `REVIEWER.md`, an observed violation is a FAIL, and F-B13-21 is observed, on production,
against the exact scenario the console was built for.

The distance to PASS is small. F-B13-21 is a clamp in a pure function plus one assertion in a
script that already tests its sibling branch. F-B13-22 and F-B13-23 are a `limit` and a time
bound. None of the three touches money, authorisation, a migration or a provider. A re-review of
that diff, with the check script rerun once, should flip this to PASS.

Residual limitations of this review: single-user timings only, no browser session, no load
profile, and 45 of the 46 readers proven by reading rather than by being made to fail. The
AF-05 repository evidence is the coordinator's, cited and not rerun by me. Nothing here is a legal
certification, and nothing here establishes that the six automatic-fail gates pass for the
submission as a whole.

Candidate walkthrough status: **NOT REVIEWED WITH YOANN**.

## 11. Register lines

| ID | Severity | Finding | Required correction | Status |
|---|---|---|---|---|
| F-B13-21 | MEDIUM | `parseSince` bounds the digit count but not the resulting instant, so `since=999999d` (year -712) makes Postgres refuse the parameter and the feed and errors panels both go dark; proven on production, boundary measured between 700000d and 740000d | Clamp the computed instant in the pure function, print that the window was clamped, and assert it in `check:console` | OPEN (blocking) |
| F-B13-22 | LOW | `openBreaksOfSubject` calls `openBreaks`, which has no `LIMIT`: every 360 page reads every open break in the system and filters in TypeScript, against the slice's own "every read is bounded" | A console-local bounded reader, or an explicit cap stated on the panel | OPEN |
| F-B13-23 | LOW | The `latest` CTE of `acceptedAndUnconfirmedOperations` reduces the whole `money_operation_events` table with no time bound, and the feed page runs it twice per render, twelve times a minute under the 10-second refresh | Bound the CTE by time and read it once, passing the result into `operationsProblems` | OPEN |
| F-B13-24 | LOW | `consoleSubject` is the only read on a 360 page not wrapped in `attempt`: its failure replaces the page with the framework error page instead of a named line | Wrap it and render the heading plus the failure line, or qualify the header claim in the handoff note | OPEN |
| F-B13-25 | LOW | On a broker 360 page the masked customer name is a `<details>` nested inside a `<Link>`: invalid HTML, and the click navigates instead of opening the fold, so that one value can never be revealed | Put the fold and the link side by side, as the last column of the same table already does | OPEN |
| F-B13-26 | LOW | When the search read fails, the page prints the red line and, under it, "Nothing in this database matches that reference"; the trail panel prints "Nothing to show yet" with no line at all: a failed read reported as a fact about the data | Branch on `found.ok` before the empty branch in both panels | OPEN |
| F-B13-27 | LOW | `(payload ->> 'raised_by_agent')::boolean` is the one payload value cast rather than read as text; safe against every writer that exists, but a non-boolean string would take out the approvals panel and the feed | Compare as text (`= 'true'`), or accept and record the payload-shape dependency | ACCEPTED as recorded |
| F-B13-28 | INFO | The failure line prints the driver's raw message, which echoed the operator's own input in the case measured here | None: naming the real error is what makes the line useful; recorded as a known property | ACCEPTED |
| F-B13-29 | LOW | All eleven documented provider limits re-verified accurate, but two are summarised where the file's own rule says quoted: "per month" is added to Neon's "100 CU-hours/project", and Stripe's unqualified per-endpoint 25/second row is presented under the sandbox heading | Quote the two cells verbatim and move the inference into the `what` field | OPEN |

---

# Re-review, fix cycle: F-B13-21 to F-B13-29 plus F-RC-08 and F-RC-09

Reviewer: the same independent reviewer sub-agent, same worktree, branch
`worktree-agent-a1ae88456b956ad9d`, now carrying `origin/main`. Written at 2026-09-09T08:50Z.

**Reviewed revision: `main` at d786644**, the merge of the builder's **b652fde**. Production
`/api/health` reported `d786644aa3aa9bd67c61b013942d7422598f12f6` before any measurement below was
taken, and every production check in this section was run against that revision.

The diff read line by line is the builder's commit against its parent: **9 files, +385, -60**, all
of them console files plus `lib/reconciliation/read.ts` (three identifiers exported, no logic
changed) and `scripts/check-console.ts`. No migration, no new route, no change to a money path.

**Renumbering.** The findings of the first review were renumbered on merge because F-B13-20 was
already held by the inbox record. What this document originally called F-B13-20 to F-B13-28 is
F-B13-21 to F-B13-29 on main, and the numbers below are the new ones. The sections above are left
as they were written; read the register in `docs/reviews/FINDINGS.md` for the authoritative ids.

## R.1 Per-finding status

| ID (new) | Was | Status | Evidence at d786644 |
|---|---|---|---|
| F-B13-21 | `parseSince` bounded the digits, not the instant; `since=999999d` killed the feed and the errors panels | **FIXED, verified** | `MOST_DAYS_BACK = 3650` with `clampToFloor` on **both** the duration and the ISO branches. The whole boundary set re-run on production: `3650d`, `99999d`, `700000d`, `740000d`, `800000d`, `999999d`, `0001-01-01Z`, `275760-09-13Z` all render with **0 failed panels**, where `740000d` and up previously failed two each. The page prints "the last 999999d, clamped to the last 3650 days, which is as far back as this page reads: everything after 2016-09-11T08:41:06.931Z". One new database-free assertion in the check script |
| F-B13-22 | `openBreaksOfSubject` read every open break in the system, unbounded, and filtered in TypeScript | **FIXED, verified** | Now one SQL query with the reference sets compared in SQL (`ledger_ref = any(...) or provider_ref = any(...)`) and `limit 50`, reusing `LATEST_REPORT_OF_EACH_BREAK` and `A_LATER_RUN_RE_EXAMINED_IT` exported from the reconciliation module rather than restating the rule. `MOST_BREAKS_ON_A_360_PAGE` is printed on the panel when the cap is reached. The two `database.unsafe` fragments are file constants with no interpolation; every compared value is still a bound parameter |
| F-B13-23 | The `latest` CTE reduced the whole event table, and the feed page ran it twice per render | **FIXED, with a consequence: see F-B13-50** | The CTE now carries a `where recorded_at >` bound at the window opening minus the threshold, and the reasoning for why that margin is exact (events only move forward) is written out and correct. The page reads the list once and passes `unknownOutcome` into `operationsProblems`, which lost its own call; `operationsProblems` is now four queries, not five |
| F-B13-24 | `consoleSubject` was the one 360 read outside `attempt` | **FIXED, verified** | Wrapped. A failure renders a heading, the integration line and a named failure panel with the id; a clean `null` still gives 404. Production: `/policy/not-a-uuid`, `/claim/1`, `/broker/%27` and an unknown well-formed uuid all still **404**, no 500 |
| F-B13-25 | `Masked` nested inside a `<Link>`, so the fold could never be opened | **FIXED, verified** | The fold and an "open" link are now siblings. Scan of the seven rendered pages: **0 `<details>` inside an `<a>`** on any of them |
| F-B13-26 | A failed search was displayed as "nothing matches" | **FIXED, verified by reading** | Both panels branch on the failed read **before** the empty branch, and both say the search could not be run rather than that nothing matched. Not reproducible on production without breaking a query on purpose |
| F-B13-27 | The `raised_by_agent` payload value was cast to boolean | **FIXED, verified** | Both occurrences now compare the extracted text to `'true'`. An absent key gives null, any other string gives false, and neither can raise |
| F-B13-29 | Two documented limits summarised where the file's rule says quoted | **FIXED, verified** | Rendered infra page now carries "100 CU-hours/project" (not "per month", which moved into `what`), "public network transfer" (not "public egress"), and the Stripe entry split into "Live mode: 100 requests per second, Sandbox: 25 requests per second" and "Individual API endpoints (unless otherwise noted): 25 requests per second". The old "API rate limit, sandbox (test mode)" heading is gone. Twelve documented rows, each with its source URL and read date |
| F-RC-08 | No integration-mode statement on the console; a bare `simulator` next to real Stripe references | **IMPLEMENTED, verified** | `IntegrationModes` renders under the heading of **all seven** screens (checked on each rendered page). `rail` is a **required** field on `ConsoleEvent`, `OperationsProblem` and `OperationInFlight`, so a kind added later cannot forget it, and `integrationModeOf` fails safe: anything that is not exactly `stripe` reads as a simulator. Measured on the feed at `since=7d`: **25 money rows and 83 webhook rows, 0 without a rail label**; 210 "Stripe LIVE SANDBOX" and 44 "LOCAL SIMULATOR" labels. Rows that move no money (journal, policy, approval, statement, MCP, change request, KYB) carry null and print nothing, each with a comment saying why |
| F-RC-09 | Infra wording | **IMPLEMENTED, verified** | Same evidence as F-B13-29 |

The remaining items of the first review were not part of this cycle: F-B13-28 (the payload-shape
note) is superseded by the F-B13-27 fix, and the AF-06 reading-map recommendation of section 8 is
still open.

## R.2 New findings

### F-B13-50 (MEDIUM) the unknown-outcome family is now tied to the feed cursor, so the default view under-reports it

**Measured on the trial database at d786644**, counting unknown-outcome rows in the errors panel:

| Window | Unknown-outcome rows |
|---|---|
| default, 60 minutes | **0** |
| `?since=1h` | **0** |
| `?since=24h` | **2** |
| `?since=7d` | **2** |
| `?since=3650d` | **2** |

Two money operations on the deployed trial database were accepted by the provider and never
confirmed. Before this cycle they appeared on every window, because
`acceptedAndUnconfirmedOperations` was global. They now appear only if the operator widens the
window past their acceptance, and **the console's default view says "Nothing failed, was refused,
or is unresolved in this window"** while they sit there.

This is a consequence of the F-B13-23 fix, not a mistake in it: bounding the CTE was the right
correction and the reasoning behind the margin is sound. The problem is which bound was chosen.
The other four problem families are events that *happened* at an instant, so a cursor is the
natural scope. An unknown outcome is a *state that persists*, defined by the absence of a later
event; scoping it by when it started means a problem drops off the screen exactly as it gets
older, which is the opposite of what an operator needs.

The "Being checked" panel does carry a new note saying the list is bounded by the window and to
ask for `7d`. The **errors** panel does not: its disclosure still reads "an operation the provider
accepted more than 15 minutes ago that has said nothing since", with no window qualification. The
empty state's "in this window" makes the sentence defensible, which is why this is not a FAIL, but
the two panels now describe two different rules.

**Required correction.** Give the in-flight reader its own floor instead of the feed cursor: read
back a fixed generous window (7 days would cover this build's whole life) regardless of what the
feed is showing. That keeps the whole performance benefit of F-B13-23, since the CTE stays
time-bounded, and restores the panel's meaning. Failing that, at minimum put the same window note
on the errors panel that the "Being checked" panel now carries.

**Why it matters before the debrief.** The demonstration will open `/ops/console` on its default
window. Two unconfirmed operations exist and the screen will say nothing is unresolved.

### F-B13-51 (LOW) the errors panel caps at 60 silently, and the heading chip presents the cap as the count

`operationsProblems` ends by slicing to its limit and the page calls it without one, so the cap is
60. The feed prints a note when it reaches its own cap of 200 ("Showing the newest 200 events of
this window, which is the hard limit of this page"); the errors panel prints nothing, and the
heading chip renders the row count as "N to look at".

**Measured**: the chip reads exactly **"60 to look at"** at `?since=24h`, `?since=7d` and
`?since=3650d`. Three different windows returning the same round number is the cap, not a count.
An operator reading "60 to look at" is being given a floor dressed as a total.

**Required correction.** The same note the feed already has, and a chip that says "60+" or "at
least 60" when the cap is reached. Pre-existing; missed in the first review and recorded now.

## R.3 Checks executed at d786644

| Check | Result |
|---|---|
| `npm run check:console` on `corgi_test`, run **once** | **49 PASS, 0 FAIL**, "all checks passed". 48 before plus the new F-B13-21 clamp assertion, which passes with the floor and the reading sentence both proven without a database |
| `since` boundary set, 8 values including `999999d` and the 740000d boundary | 8 × HTTP 200, **0 failed panels on all 8** (was 3 of 8 failing two panels each) |
| Hostile query set, 11 inputs (SQL injection in `since` and `reference`, `NaN`, far future, epoch, bogus `kind`, `<script>` as a `kind`, 500-character reference, 300-character `pi_`) | 11 × HTTP 200, **0 failed panels**, all handled |
| Output escaping, an `onerror` image tag through the search | escaped, 0 raw occurrences |
| Malformed path ids, 4 shapes | 4 × 404, no 500 |
| Access, anonymous, 5 paths | 4 × 307 to `/login`, 1 × 404 (the malformed id) |
| Access, broker / customer / approver, 4 paths each | 4 × 307 to `/broker`, 4 × 307 to `/customer`, 4 × 200 |
| Secret scan, 7 rendered pages | **zero** `sk_`, `whsec_`, `rk_`; 3 `cmk_` tokens, all 12 characters, the public prefix only; no payload markers |
| Personal-data scan, 7 rendered pages | 3 emails, **3 of 3 behind a closed fold, 0 outside** |
| A `<details>` nested in an `<a>`, 7 pages | **0** |
| Rail labels, feed at `since=7d` | 25 money rows and 83 webhook rows, **0 unlabelled** |
| `IntegrationModes` line | present on **all seven** screens |
| Infra documented wording | all four corrections present, the old wording absent, 12 rows each with URL and read date |
| Seven-page response times, three runs each | below |

`npm run check:money-guards` was **not** run, as instructed; the coordinator's figure (184/184 on
an ephemeral database at migration 0020, 08:32Z) is cited, not reproduced.

### Response times at d786644

| Page | run 1 | run 2 | run 3 | **p50** | previous p50 |
|---|---|---|---|---|---|
| `/ops/console` | 0.321 | 0.349 | 0.251 | **0.321 s** | 0.333 s |
| `/ops/console/search` | 0.281 | 0.361 | 0.347 | **0.347 s** | 0.350 s |
| `/ops/console/infra` | 0.338 | 0.307 | 0.310 | **0.310 s** | 0.353 s |
| customer 360 | 0.288 | 0.367 | 0.298 | **0.298 s** | 0.338 s |
| broker 360 | 0.477 | 0.476 | 0.533 | **0.477 s** | 0.447 s |
| policy 360 | 0.363 | 0.859 | 0.348 | **0.363 s** | 0.396 s |
| claim 360 | 0.312 | 0.331 | 0.405 | **0.331 s** | 0.403 s |

Worst p50 **0.477 s**, worst single sample 0.859 s. Nothing near 3 seconds. The differences either
way are inside the noise of a cold serverless invocation and are not evidence that the bounded
queries made anything faster; what they do show is that the two extra SQL bounds cost nothing.

## R.4 Checks not executed

`check:money-guards` (instructed, cited from the coordinator). No typecheck, lint or build. No load
or concurrency profile. No browser session: every measurement is `curl` against the rendered HTML,
so F-B13-25 is verified as valid markup rather than as an observed click. The `attempt` net was
again proven live on one failure mode only, and F-B13-26 is verified by reading because no
production query can be made to fail on demand. The eleven documented provider limits were verified
in the first review and only the wording changes were rechecked here.

## R.5 Verdict of the re-review

**PASS.**

All eight findings of the first review, including the blocking F-B13-21, are fixed, and each fix
was verified independently at the deployed revision rather than accepted on the builder's word.
The two recheck items F-RC-08 and F-RC-09 are implemented, and F-RC-08 in particular is done well:
making `rail` a required field rather than an optional one, and defaulting anything unrecognised to
`LOCAL SIMULATOR`, means the AF-02 labelling cannot silently rot when a rail is added.

The two new findings are why this is a PASS with work still to do rather than a clean bill.
Neither is a wrong number, a bypass, a leak, or a mislabelled integration: F-B13-50 is about how
much of a persisting problem a default view shows, and F-B13-51 is about a count that is really a
cap. **F-B13-50 should be corrected before the debrief**, because the demonstration will open the
console on its default window and the screen will report nothing unresolved while two operations
are unconfirmed. The correction is a fixed floor for one reader and does not undo the performance
fix that caused it.

Residual limitations unchanged from the first review: single-user timings, no browser session, no
load profile, and most readers proven by reading rather than by being made to fail. This is a
scoped engineering assessment, not a legal certification, and it does not establish that the six
automatic-fail gates pass for the submission as a whole.

Candidate walkthrough status: **NOT REVIEWED WITH YOANN**.

## R.6 Register lines, re-review

| ID | Severity | Finding | Required correction | Status |
|---|---|---|---|---|
| F-B13-50 | MEDIUM | The F-B13-23 fix ties the unknown-outcome family to the feed cursor: on the default 60-minute window the two accepted-and-unconfirmed operations on the trial database are invisible and the panel reads "nothing is unresolved"; the errors panel's disclosure still states the unscoped rule while the sibling panel states the scoped one | Give the in-flight reader its own fixed floor (7 days) instead of the feed cursor, keeping the CTE time-bounded; at minimum carry the same window note on the errors panel | OPEN, fix before the debrief |
| F-B13-51 | LOW | The errors panel caps at 60 problems with no note, unlike the feed which prints one, and the heading chip renders the capped number as the count: exactly "60 to look at" at three different windows | Print the cap note and render "60+" when the cap is reached | OPEN |

---

## R.7 Confirmation measurement of the F-B13-50 and F-B13-51 fixes

**Revision `e117a61`** (the merge of the builder's **a19539b**), confirmed by production
`/api/health` reporting `e117a61f67320fdc9021377c03c4a334dd9cab9d` before every measurement below.
Signed in as `ops@example.com`. Three files changed: `lib/console/read.ts`,
`app/ops/console/page.tsx`, `scripts/check-console.ts`.

**F-B13-50: FIXED.** `acceptedAndUnconfirmedOperations` now takes **no cursor at all** and carries
its own `UNRESOLVED_OPERATIONS_FLOOR_DAYS = 7`, which is the correction asked for: the CTE stays
time-bounded, so the whole F-B13-23 performance fix is preserved, and the list no longer moves with
the feed window. Measured on the trial database, unknown-outcome rows in the errors panel:

| Window | at d786644 | at e117a61 |
|---|---|---|
| default, 60 minutes | 0 | **2** |
| `?since=60m` | 0 | **2** |
| `?since=1h` | 0 | **2** |
| `?since=24h` | 2 | 1, see below |
| `?since=7d` | 2 | 1, see below |

The two unconfirmed operations are now on the **default cockpit view**, where before they were
invisible, and the errors chip reads "2 to look at" instead of "nothing failing". The "Being
checked" list is empty and its chip reads 0 at every window, which is correct and not a
regression: both operations are past the 15-minute threshold, so by the rule they belong in the
errors panel as unknown outcomes, not in "being checked". Both sentences asked for are on the
screen and were read out of the rendered HTML: the "Being checked" note says "This list **ignores
the window above**: it is read over a fixed floor of 7 days, so an operation the provider accepted
and never confirmed stays on this page whatever window the feed is showing", and the errors
disclosure says "Every line here is inside the window above **except the unknown outcomes**: those
are read over a fixed floor of 7 days, whatever window the feed is showing, because an operation
nobody has confirmed must stay visible until a human resolves it."

**One residual, recorded as an observation rather than a new finding.** At `?since=24h`, `7d` and
`3650d` the errors panel shows **1** of the two, not 2. The reader is window-independent, as the
narrow windows prove; what drops the second row is the 60-row cap of F-B13-51, applied after the
five families are merged and sorted newest first. Unknown outcomes are old by definition, so on a
wide window they lose their place to newer failures. This is honest on the screen rather than
silent: the cap sentence is printed and it says "narrow the window to see the rest", which is
exactly what brings both rows back. Worth knowing before the debrief; not worth a fix at this
point in the schedule.

**F-B13-51: FIXED.** `MOST_PROBLEM_ROWS = 60` is now named and used by both the panel and the chip.
Measured: at `?since=24h`, `?since=7d` and `?since=3650d` the chip reads **"60 or more to look at"**
and the panel prints **"Showing 60 rows, which is the hard limit of this panel. There are probably
more: narrow the window to see the rest."** At the default window and at `?since=60m` and `1h` the
panel is below its cap, so the chip reads the true count ("2 to look at") and no cap sentence is
printed, which is the correct behaviour on both sides of the threshold. The trial database has more
than 60 problem rows on a wide window, so this was verified live and not only by reading.

**check:console: 50 PASS, 0 FAIL**, "all checks passed", on `corgi_test`. The one new assertion
over the 49 of the previous cycle is the proof of F-B13-50 without a browser: it takes a cursor for
which the feed returns none of the fixture's rows, asserts that, and then asserts that the in-flight
reader still lists the same stuck operation over its own seven-day floor. That is the right shape of
test, because it proves the independence rather than the value. **Disclosure: the script ran twice**,
not once, through a mistake in a single command that piped a second run to count its lines. Both
runs reported all checks passed with the same 50; no failure was attributed to contention, and
nothing was retried after a failure.

**Verdict of the confirmation: PASS.** Both findings are fixed at the deployed revision, the fixes
are the ones the review asked for rather than the cheap wording-only versions, and neither
reintroduces the unbounded query that F-B13-23 removed. The console record is closed for this
cycle with no open finding of my own; the AF-06 reading-map recommendation of section 8 remains the
only outstanding item, and it is a recommendation, not a defect.

Candidate walkthrough status: **NOT REVIEWED WITH YOANN**.

---

## R.8 Confirmation of the F-INT-03 fix at `a1e525d`

Written 2026-09-09 between 09:50Z and 10:25Z UTC by the independent re-reviewer of the integration
fix cycle, own git worktree `.claude/worktrees/agent-af5ec98e04bd49ddb`, branch
`worktree-agent-af5ec98e04bd49ddb`. The four other findings of the same cycle (F-INT-01, 02, 05, 07
and 10) are confirmed in `docs/reviews/integration.md`, section 11, which also carries the startup
receipt, the full check list and the new findings. This section is only F-INT-03, because the
finding is about this console.

**Revision `a1e525ddd02e412cc1dd1e0d338d4d62d747d64c` (`a1e525d`, the merge of the builder commit
`5fc56cb`)**, reported by production `/api/health` at **09:51:30Z** before every measurement below
and again at **10:07:48Z** after the last one. Signed in as `ops@example.com`. Every production
request behind this section is a GET.

### F-INT-03: **FIXED**

**What the finding said.** `/ops/console` listed the live-paid CGP-01707 as "unknown outcome,
accepted and unconfirmed", 824 minutes old, because the readers took the last
`money_operation_events` row by sequence number and that operation carries a late
`provider_accepted` after its `succeeded`. The policy page called the same operation succeeded.

**What I measured on the deployed console**, at the three windows the assignment names:

| Window | Errors panel | Unknown-outcome rows | "Being checked" chip | CGP-01707 in either list |
|---|---|---|---|---|
| default, 60 minutes | "Nothing failed, was refused, or is unresolved in this window." | **0** | 0 | **no** |
| `?since=24h` | 61 rows rendered, cap reached | **0** | 0 | **no** |
| `?since=7d` | 61 rows rendered, cap reached | **0** | 0 | **no** |

The string "accepted and unconfirmed" appears **nowhere** on any of the three renders except in the
two explanatory notes that define the family. The three occurrences of "unknown outcome" on each
render are all prose: the errors panel's disclosure, the "being checked" note and the legend.
Neither CGP-01707 nor CGP-01062 appears on the errors panel at any window.

**The operations that really are unresolved are still there**, which is the half of this
measurement that matters, because a fix that emptied the panel by hiding rows would be worse than
the defect. They are not the two operations R.7 counted: those two were the false positives this
finding removes. At 24h and 7d the errors panel still lists the two failed claim payouts, both
`money` family, both labelled `LOCAL SIMULATOR`:

- `2026-09-08 19:15:20, 14 h, claim_payout failed, "B12-1 rehearsal: agent-raised request rejected
  on purpose"`;
- `2026-09-08 15:41:56, 18 h, claim_payout failed, "Independent re-review probe: raised only to
  prove the per-claim threshold; not needed"`.

Both are older than the 60-minute default window, and the panel says so rather than implying there
is nothing: the disclosure sentence and the cap sentence are both on the screen.

**The 360 pages agree with the policy pages now.** `/ops/console/policy/3c3697b7...` (CGP-01707)
prints **succeeded** for both operations, the $1,253.20 issuance (the one the finding named) and the
$1,127.24 endorsement delta, with their durations and provider references.
`/ops/console/policy/31509261...` (CGP-01062), the second out-of-order history, prints **succeeded**
for its $3,556.84 checkout too. That was the other half of the required correction.

**The feed is untouched, event by event.** The activity feed at 7 days still renders all four events
of each operation in their recorded order, so nothing was hidden to make the status right: for
CGP-01707's issuance, `requested` and `provider_accepted` at 18:56:33 then `succeeded` and
`provider_accepted` at 18:57:00; for the endorsement, the same shape at 06:34:07 and 06:34:34. The
append-only history is intact and only the derived status changed. 21 feed rows name CGP-01707 at
the 7-day window, eight of them the money events of its two operations.

**The code does what the correction asked, in one place.** `statusPreferringTerminal`
(`lib/console/read.ts:55`) is one SQL expression, `bool_or(status = 'succeeded')` then
`bool_or(status = 'failed')` then the last row by sequence number, and it is used by all three
readers that derive an operation's outcome: `acceptedAndUnconfirmedOperations` (the in-flight and
unknown-outcome lists, whose CTE now groups by `operation_id` instead of `distinct on`),
`operationsProblems` (a correlated subquery that keeps a `failed` or `unknown` row on the panel only
while the operation still reads that way), and the 360 money table
(`operationsOfSubject`, `lib/console/read.ts:2236`). It is the same rule
`lib/policy/read.ts:221` applies, so the console and the policy page can no longer disagree.

**`check:console`: 53 PASS, 0 FAIL, "all checks passed"** on `corgi_test`. The three assertions that
matter here, quoted from my run:

- `AN OPERATION THAT SUCCEEDED AND THEN CARRIED A LATER NON-TERMINAL EVENT IS NEITHER IN FLIGHT NOR
  UNKNOWN (checking 0, unknown 137, none of them this operation)`;
- `an unknown outcome that a later success resolved is not on the errors panel (141 problems, none
  of them that operation)`;
- `the 360 money table calls that operation succeeded, not by its last row but by its terminal one
  (latest status succeeded)`.

The fixture is the right shape: it builds `requested, provider_accepted, unknown, succeeded,
provider_accepted` in that order, which is the shape the two production operations really have, and
the fixture count assertion was raised from 3 to 4 operations so the "the readers created no money
operation of their own" net still holds.

**The F-B13-50 fix is not undone.** `an accepted and unconfirmed operation older than the feed
window is still listed (the feed for that cursor shows none of the fixture's rows; the in-flight
reader still lists it over its own 7-day floor)` still passes. Worth stating plainly for the
debrief: on production that reader now returns zero rows at every window, so the seven-day floor is
proved by this assertion and no longer by the screen. That is the correct outcome, not a regression:
the two rows it used to show were the two false positives this finding removed.

**Disclosure.** `npm run check:console` ran **twice**, the second time by my mistake (a command
typed to avoid a rerun ran the script into a file). Both runs reported the same 53 PASS, 0 FAIL.
The script commits fixture rows before it asserts, so `corgi_test` carries one extra console fixture
set written at about 10:02Z.

### One new finding, on this console

**F-INT-20 (LOW), recorded in full in `docs/reviews/integration.md` section 11.10.** On the 360 money
table of CGP-01062 the row now reads a green `succeeded` badge with, directly underneath, the note
**"Your card was declined."**, undated and with nothing saying it belongs to an earlier attempt.
`failure_reason` (`lib/console/read.ts:2240`) is the newest reason from any `failed` event of the
operation, whatever came after it, so preferring the terminal status turned an odd pair into a
contradictory one. No money is wrong and nothing is hidden; it is a line an operator reads during an
incident and should not have to interpret. Correction: drop the reason when the derived status is
terminal and not `failed`, or print it with its instant and the words "earlier attempt".

### Checks not executed here

`check:money-guards`, by instruction, cited as 184 of 184 on an ephemeral database at migration 0020
at 08:32Z. No browser session and no width measurement: every figure above is `curl` against the
rendered HTML. No load or concurrency profile, so the timings of R.3 are not re-measured and are not
claimed to hold at this revision.

### Verdict of this confirmation

**PASS.** F-INT-03 is fixed at the deployed revision, in the three readers the correction named, by
one shared expression rather than three copies; the two operations it used to misreport now read
succeeded on the console exactly as they always did on the policy page; the genuinely failed
operations are still listed; the append-only feed is unchanged event by event; and the assertion
that protects the fix exists and passes. The console record stays closed for this cycle apart from
the new LOW F-INT-20 above.

Candidate walkthrough status: **NOT REVIEWED WITH YOANN**.
