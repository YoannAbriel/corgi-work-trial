# B13-11 observability: independent review

**Scope.** The observability slice of decision 25 (Linear YOA-641): the append-only activity log
(migration 0021), the structured redacted logs (`lib/observability/log.ts`, `redact.ts`), the
wrapper applied to the 34 route files under `app/api`, and the console v2 panels that read the
table. Layout work on other pages by the three UI builders running in parallel is out of scope.

**Reviewer.** Independent reviewer sub-agent, own worktree
`.claude/worktrees/agent-ae1ebbb82879f6fa8`, branch `worktree-agent-ae1ebbb82879f6fa8`.
No code was changed and no shared document was edited.

**Timestamp.** 2026-09-09T10:59:09Z (UTC, machine clock, `date -u`). Every instant in this record
is UTC.

**Reviewed revision.** `f7e81aa5e248c9e3ab35c19ccda8454344147413`, working tree clean
(`git status --short` empty). The slice itself is the merge `2985df4` and its five commits
`4000728`, `bdbe8c7`, `0bb22ae`, `5a212b5`, `47aaa2a` (2026-09-09 10:01Z to 10:28Z).
**Production runs the same revision**: `GET /api/health` answered
`{"ok":true,"database":"ok","revision":"f7e81aa5e248c9e3ab35c19ccda8454344147413"}` at
2026-09-09T10:44:15Z, before any check below was run.

---

## 1. Startup receipt

**Read in full, in this order:** `CLAUDE.md`, `AUTOMATIC-FAILS.md` (AF-01 to AF-06 and the
mandatory operating gate), `REVIEWER.md`, `AGENTS.md` (including the *Operations and security*
section, which is the requirement this slice answers: structured, redacted logs with correlation
ids, **not** full request or response bodies, no credentials in terminal output),
`READABLE-CODE.md`.

**Then:** `docs/DECISIONS.md` rules 21, 23 and 25; `docs/reviews/b13-9-console.md` (the console v1
record, 897 lines, so that its closed and open findings are not re-raised);
`docs/reviews/recheck-day2.md` finding F-RC-07 and the two console findings F-RC-08 and F-RC-09;
`README.md` lines 79 to 87 (the activity-log paragraph) and line 53 (the `check:console`
description).

**Code read in full:** `db/migrations/0021_activity_log.sql`; `lib/observability/log.ts` (347
lines), `redact.ts` (73), `redact.test.ts` (57); `app/api/mcp/route.ts`; `lib/console/read.ts`
section 7 (lines 3074 to 3263) plus the reference-search branches (1540 to 1700, 1905 to 1945);
`lib/console/safe-read.ts`, `guard.ts`, `access.ts`; `components/console-parts.tsx` (277),
`components/console-360.tsx` (the read block and the Activity panel); `app/ops/console/page.tsx`,
`app/ops/console/search/page.tsx`, the four 360 page files; `scripts/check-console.ts` (header and
section 9); the `activity_log` assertions of `scripts/check-money-guards.ts`; the guard functions
of migrations 0001, 0003 and 0004 and the grants of 0018 and 0019 for comparison; the wrapper
diff of all 34 route files.

**Absent files:** none of the mandatory kit. `.env.local` is not present in a worktree (it is
ignored and not copied); it was symlinked from the main checkout for the duration of the checks
and removed afterwards. `node_modules` was installed in the worktree with `npm ci` (96 packages)
because Turbopack refuses a symlinked one.

**Next acceptance criterion under review and its planned checks:** B13's *structured redacted
logs* and the console v2 that reads them (decision 25, closing F-RC-07). Planned: read the
migration against 0001/0018 for the guards; read the redaction function and run its tests; run
`check:console` once and `check:mcp` once on `corgi_test`; walk production within the rules and
read the rows back through the panels and through a read-only `DATABASE_URL_APP` connection;
prove the fail-open path on a local server; measure rather than trust.

---

## 2. Applicability

This slice moves no money and touches no money row. It is governed by:

| Source | Section | What it requires here |
|---|---|---|
| `AGENTS.md` | Operations and security | structured, redacted logs with correlation ids, never full bodies; no credentials in output; the smallest useful view for tracing customer to operation to provider reference to event |
| `AUTOMATIC-FAILS.md` | AF-05 | sandbox credentials are secrets too; redact logs, fixtures, screenshots and evidence |
| `AUTOMATIC-FAILS.md` | AF-04 | no real personal data; the trial's parties are synthetic seed data |
| `AUTOMATIC-FAILS.md` | AF-03 | not directly: `activity_log` holds no money. The builder applied the money-table guards anyway, for the reason `mcp_calls` and `policy_change_requests` have (a refusal that can be rewritten is not a record). Reviewed against that standard |
| `AUTOMATIC-FAILS.md` | AF-06 | the wrapper and the two observability files must be explainable line by line |
| `docs/DECISIONS.md` 23 | console v1 | staff only, refresh every ten seconds, personal data masked by default and revealed on click |
| `docs/DECISIONS.md` 25 | this slice | one append-only `activity_log` (migration 0021, same guards as the money tables) written by every route handler, job and MCP call with who, route, object ids, duration, outcome and a correlation id; the same helper writes one JSON line per request with emails and keys masked; the console reads the table |
| `docs/reviews/recheck-day2.md` | F-RC-07 (MEDIUM) | the criterion was unimplemented and undisclosed: no logging module, no correlation id, five `console.*` calls, one logging a raw thrown error |

No external legal regime is engaged by this slice. No US regulatory source was consulted, and
none is claimed. This is an engineering assessment, not a certification.

---

## 3. Requirement matrix

| # | Requirement | Control / code location | Evidence | Verdict |
|---|---|---|---|---|
| 1a | The migration's guards read like the money tables' | `0021_activity_log.sql:119-129` calls `forbid_change_of_financial_record()`, `forbid_truncate_of_financial_record()` and `set_recorded_at_from_database_clock()`, the same three functions defined in `0001:12`, `0003:42`/`0004:16` and `0001:21` | textual comparison with 0001, 0018 and 0019: identical trigger shape and identical grant line | PASS |
| 1b | Runtime role has SELECT and INSERT only | `0021:131` `grant select, insert on activity_log to app_runtime`, and no other migration grants more | live on `corgi_test`: `update activity_log set outcome='ok' where false` as `app_runtime` returned `permission denied for table activity_log`; live on the trial database: `app_runtime` read 14 rows and holds no UPDATE | PASS |
| 1c | No payload column exists | the DDL has 15 columns, the only free text being `message text check (char_length between 1 and 500)` | column list read in full; the trial database's 14 rows carry no field resembling a body | PASS |
| 1d | `recorded_at` comes from the server clock | `activity_log_recorded_at_is_server_set` BEFORE INSERT trigger | cited: coordinator's `check:money-guards`, **192 of 192** on an ephemeral database migrated 0001 to 0021 at 10:42Z, whose eight new assertions cover UPDATE, DELETE and TRUNCATE refused for every role, INSERT allowed for the runtime role, and a row inserted with `recorded_at = 2000-01-01` stored at the database time. Independently: 0 of 99 rows read (85 on `corgi_test`, 14 on the trial database) carry an implausible `recorded_at` | PASS (cited + corroborated) |
| 2a | The redaction rule is one function with tests | `lib/observability/redact.ts`, six shapes plus a length cap; `redact.test.ts` | `node --import tsx --test lib/observability/redact.test.ts`: **8 tests, 8 pass, 0 fail** | PASS |
| 2b | No secret and no personal data in any row | `redact()` on `message` and `rule` in `recordActivity`; no payload column | **99 rows read back and grepped** (85 on `corgi_test` after `check:mcp` and `check:console`, 14 on the trial database after the production walk), across `correlation_id`, `route`, `rule` and `message`, for ten shapes: email, `Bearer …`, `password=…`, `sk_`, `rk_`, `whsec_`, a connection-string password, a full `cmk_` key, a stack frame, a newline. **0 hits.** Only the shape name would have been printed, never a value | PASS |
| 2c | Emails masked on screen | `maskToFirstThree` / `Masked` in `console-parts.tsx`, reused by `ActivityTable` | production: the refused `/api/mcp-keys` row renders `Ale***` with `Alex Kim, approver` inside a closed `<details>`; the policy 360 Activity rows render `Sam***`. See F-OB-07: this is decluttering, not redaction, exactly as the v1 record states | PASS, with F-OB-07 |
| 2d | Error messages are sentences, not stacks | `sanitisedSentence` reads `error.message`, splits at the first newline, never `error.stack` | the test asserts the stack is absent; live on the wrapper: a thrown `Error` carrying an email, a bearer token, a `password=` field and an `sk_test_` key produced `message":"stripe refused for ops**** with Authorization: Bearer **** and password=**** using sk_**** on pi_3NxYz` | PASS |
| 3a | Every route writes exactly one row per request | one `withActivity` per exported handler | **34 route files, 37 exported handlers, 37 wrappers, 0 unwrapped** (`grep -E "^export (const\|async function) (GET\|POST\|…)"` cross-checked against `grep -c withActivity` per file, and a repository-wide grep for an exported handler not on a `withActivity` line returned nothing). Measured on rows: `corgi_test` **85 rows, 85 distinct correlation ids, 0 ids carrying more than one row**; trial database **14 rows, 14 distinct ids** | PASS |
| 3b | A plausible duration | `durationMs = Date.now() - startedAtMs` around the handler | 99 rows, **0 null durations**, min 0 ms, max 14350 ms (a real `run_reconciliation` MCP call). Caveat measured and raised as F-OB-05 | PASS, with F-OB-05 |
| 3c | The right actor kind | `descriptor.actor`, `currentUser()` after the handler, `describeCaller` for MCP | all five kinds observed on real rows: **human with role** (`staff_approver` on `/api/mcp-keys`, `staff_ops` on the document and statement GETs, `broker` and `customer` through MCP keys), **agent** (2 rows, an MCP key whose `principal_kind` is `agent`), **cron** (`GET /api/jobs/daily` with no secret, on production), **anonymous** (login, health, the MCP 401), **stripe** (not exercised, verified by reading `app/api/webhooks/stripe/route.ts:31`) | PASS, one kind by reading |
| 4a | An approver's refused POST to `/api/mcp-keys` is `refused` | `withActivity` classify, redirect branch | production, 10:50:24.693Z: `human/staff_approver POST /api/mcp-keys -> refused 303`, reason `only staff operations can manage MCP API keys`. **The rule column reads "none named"**: see F-OB-01 | PASS on outcome, F-OB-01 on the rule |
| 4b | A JSON-RPC call with a wrong key is `refused` | `app/api/mcp/route.ts` sets `activity.rule = "MCP key"` before the 401 | production, 10:50:24.906Z: `anonymous POST /api/mcp -> refused 401 rule=MCP key`. The malformed body never reached the parser: the key is checked first, by design | PASS |
| 4c | A malformed request is `refused` or `error` with a sanitised sentence | classify's 4xx and throw branches | `corgi_test`, real MCP calls: `refused` with the sentence, for example `"amountCents" is required and must be a whole number (integer cents, never dollars)`. Locally through the wrapper: an unexpected throw recorded `error`, HTTP 500, with the sanitised sentence above. On production a 4xx alone carries no sentence, which is the classifier's documented behaviour | PASS |
| 4d | The response is unchanged by the logging | the wrapper returns `response` untouched and re-throws `thrown` | production status codes and bodies match the v1 record's role probes: `/api/mcp` GET 405 with the same sentence, POST 401 `{"error":"unauthorized"}`, `/api/mcp-keys` 303 to `/ops/mcp-keys?error=…`, `/api/jobs/daily` 401 `this job endpoint needs the cron secret as a bearer token`, `/ops/console` anonymous 307 to `/login`. Locally: a handler returning 201 with a custom header and a body returned **status 201, header unchanged, body identical** while the activity insert was failing. `check:console` asserts the re-throw: `ApprovalRefused reached the caller` | PASS |
| 5a | Refused and failed actions, newest first and bounded | `refusedAndFailedActivity`, `outcome <> 'ok'`, `order by recorded_at desc`, `limit MOST_ACTIVITY_ROWS = 60` | production panel rendered three rows in descending order (10:50:25, :24, :24); `check:console`: the panel shows the run's refusal and **no ok row** | PASS |
| 5b | Latency by route with p50, p95 and count over 24 h computed in SQL | `latencyByRoute`, `percentile_cont(0.5)` and `(0.95) within group (order by duration_ms)`, `where recorded_at > now() - make_interval(hours => 24)`, `limit 40` | production panel: `/api/health` p50 64 ms p95 78 ms max 79 ms 3 requests 0 not-ok; `/api/session/login` 7/9/9, 2, 0; `/api/mcp` 5/8/8, 2, **2 not ok**; `/api/mcp-keys` 6/6/6, 1, **1 not ok**. Nothing is computed in the browser or in TypeScript | PASS |
| 5c | An Activity panel on each of the four 360 pages, scoped to the object | `activityOfSubject` filtered by the page's own `policyIds`/`claimIds` lists, `limit 40`; rendered by `components/console-360.tsx:569`, which all four pages use through `Console360` | production, `/ops/console/policy/de2fb99f…`: the panel shows exactly the two `documents/[document]` requests that named that policy, and nothing else. `check:console`: the policy's panel carries the run's refusal, and another policy's page shows none of it | PASS |
| 5d | The correlation id is found by the reference search | `CORRELATION_ID_SHAPE` tested last, `byCorrelationId`, and the uuid branch falls through to it | production: `/ops/console/search?reference=obrev1-mcpkeys` answered `read as the correlation id of a request` and rendered the request with its time, outcome, HTTP status, duration, rule, reason and masked actor | PASS |
| 5e | Every reader wrapped in `attempt` | `app/ops/console/page.tsx:96,97`, `components/console-360.tsx:114`, and `activityOfCorrelationId` reached through `resolveReference`, wrapped at `search/page.tsx:36` | all four new readers wrapped; each panel renders `FailureLine` | PASS |
| 5f | Every query bounded | four new queries: three carry `limit`, the fourth is a `group by` with `limit 40` and a 24-hour `where` | read; `MOST_ACTIVITY_ROWS = 60`, `MOST_ACTIVITY_ROWS_ON_A_360_PAGE = 40`, `MOST_LATENCY_ROUTES = 40` | PASS |
| 5g | The ten-second refresh unchanged | `<meta httpEquiv="refresh" content="10" />`, `app/ops/console/page.tsx:118` | unchanged by the slice diff; present in the rendered production HTML | PASS |
| 5h | The integration-mode line still on all seven screens | `IntegrationModes` in `console/page.tsx:156`, `infra/page.tsx:74`, `search/page.tsx:53`, and twice in `console-360.tsx` (72 and 152), which serves the four 360 pages | rendered on the three production pages fetched; the other four by code path | PASS (F-RC-08 stays closed) |
| 6 | The logging never breaks a request | `recordActivity`'s `try { insert } catch { console.error({activityRowNotWritten}) }` | **proven twice.** (a) `DATABASE_URL_APP` pointed at `127.0.0.1:1`: the wrapped handler returned 201, its header and its body, and both lines were printed, the second reading `"reason":"connect ECONNREFUSED 127.0.0.1:1"`. (b) A reachable `corgi_test` and a row the check constraint refuses: the line read `"reason":"new row for relation \"activity_log\" violates check constraint \"activity_log_outcome_check\""` and `recordActivity` did **not** throw | PASS |
| 7 | One JSON object per request on stdout, the same fields and nothing else | `recordActivity`'s single `console.log(JSON.stringify({...}))` | one request on a local server (`next dev -p 3800` against `DATABASE_URL_TEST_APP`), pasted verbatim in section 5 below. **14 fields**, exactly the row's columns minus the generated `id`. Nothing else is printed per request | PASS |
| 8 | READABLE-CODE on `lib/observability/*.ts` and the wrapper | see section 6 | three constructs named for the walkthrough, none opaque, none hidden | PASS |
| 9 | The five `console.*` calls of F-RC-07 | two replaced, three left in `lib/documents/write-sample-documents.ts` | accepted, see section 7 | PASS |
| AF-05 | No secret committed by the slice | the 47-file diff grepped for `sk_(test\|live)_`, `whsec_`, `rk_`, `postgres://…:…@` | 3 hits, all three obviously fabricated test fixtures in `redact.test.ts` plus one explanatory comment. No credential. This record contains none | PASS |
| AF-04 | Sandbox only | no provider call added; the walk moved no money | the two refused POSTs wrote one activity row each and nothing else; `journal_entries` untouched | PASS |

---

## 4. The 34 routes, ticked

`subject` and `actor` are the descriptor values read from each file. **Seen** means a real row
was read back from a database after a real request. **Read** means the wrapper was verified in
the file and no request was made, because making one would submit a form or move money, which
this review is not allowed to do.

| Route pattern | Methods | subject | actor | Row seen |
|---|---|---|---|---|
| `/api/approvals/[requestId]` | POST | none | session | read |
| `/api/brokers/[brokerId]/kyb/recheck` | POST | broker | session | read |
| `/api/brokers/kyb` | POST | none | session | read |
| `/api/claims/[claimId]` | POST | claim | session | read |
| `/api/claims/[claimId]/payments/[operationId]` | POST | claim | session | read |
| `/api/health` | GET | none | anonymous | **seen** (production, `corgi_test`, local) |
| `/api/jobs/daily` | GET/POST | none | cron | **seen** (production, refused 401, `actor_kind = cron`) |
| `/api/jobs/reconcile` | POST | none | cron | read |
| `/api/jobs/recover-operations` | POST | none | cron | read |
| `/api/jobs/settle-simulated-payouts` | POST | none | cron | read |
| `/api/mcp-keys` | POST | none | session | **seen** (production, refused 303, `staff_approver`) |
| `/api/mcp` | POST/GET/DELETE | none | declared | **seen** (production POST 401 and GET 405; `corgi_test`, 66 rows over 12 method and tool groups, `agent` and `human` kinds) |
| `/api/policies` | POST | none | session | read |
| `/api/policies/[policyId]/bind` | POST | policy | session | read |
| `/api/policies/[policyId]/cancel` | POST | policy | session | read |
| `/api/policies/[policyId]/change-requests` | POST | policy | session | read |
| `/api/policies/[policyId]/change-requests/[requestId]/reply` | POST | policy | session | read |
| `/api/policies/[policyId]/checkout` | POST | policy | session | read |
| `/api/policies/[policyId]/claims` | POST | policy | session | read |
| `/api/policies/[policyId]/corrections` | POST | policy | session | read |
| `/api/policies/[policyId]/corrections/[rebookEventId]/approve` | POST | policy | session | read |
| `/api/policies/[policyId]/corrections/[rebookEventId]/checkout` | POST | policy | session | read |
| `/api/policies/[policyId]/documents/[document]` | GET | policy | session | **seen** (production, 2 rows, `subject_kind = policy`) |
| `/api/policies/[policyId]/endorsements` | POST | policy | session | read |
| `/api/policies/[policyId]/endorsements/[requestEventId]/apply` | POST | policy | session | read |
| `/api/policies/[policyId]/endorsements/[requestEventId]/approve` | POST | policy | session | read |
| `/api/policies/[policyId]/endorsements/[requestEventId]/checkout` | POST | policy | session | read |
| `/api/policies/[policyId]/refunds/[operationId]/reissue` | POST | policy | session | read |
| `/api/policies/[policyId]/refunds/[operationId]/send` | POST | policy | session | read |
| `/api/session/login` | POST | none | anonymous | **seen** (production, 3 rows) |
| `/api/session/logout` | POST | none | session | read |
| `/api/statements/[runId]/pdf` | GET | none | session | **seen** (production, ok 200, 723 ms) |
| `/api/statements/run` | POST | none | session | read |
| `/api/webhooks/stripe` | POST | none | stripe | read |

**Tally: 7 of 34 route files produced rows this review read back; 27 verified by reading.** Plus
three synthetic wrapped handlers driven by `check:console` against the real table, one per
outcome the classifier must get right.

**How the two that cannot be exercised were verified by reading.** The **Stripe webhook**
(`app/api/webhooks/stripe/route.ts:31`) declares `actor: "stripe"`, which the wrapper turns into
`actorKind = "stripe"` before the handler runs and never overwrites, because the `currentUser()`
block excludes the `stripe` descriptor. Sending a signed event would have required the signing
secret and would have moved sandbox money, which this review is not allowed to do. The **cron
job** declares `actor: "cron"`; the same block *includes* `cron`, deliberately, so that a staff
member pressing "Run now" is recorded as the person and not as the scheduler. Both halves were
confirmed on production without running any job: `GET /api/jobs/daily` with no bearer token was
refused 401 and left one row reading `cron`, and the same endpoint reached with a staff session
would have read `human`. The authorised path was not run: it would have executed the
reconciliation, the recovery and the simulated settlements on the trial database.

---

## 5. Checks actually executed, with counts

| Check | Command | Result |
|---|---|---|
| Console readers and the activity log | `npm run check:console`, once, on `corgi_test` | **65 assertions, 65 PASS, 0 FAIL**, "all checks passed". Its last twelve are the activity log: one ok row with a duration, one refused row naming `maker-checker`, a redirect recorded as a refusal carrying its sentence, every row naming its object, the panel showing the refusal and no ok row, `percentile_cont` naming the run's route, the 360 page showing it, the search resolving the correlation id, the redaction masking an email and dropping a bearer token, and UPDATE refused for the runtime role |
| MCP surface | `npm run check:mcp`, once, local server on port 3800 against `DATABASE_URL_TEST_APP`, stopped afterwards | **ALL CHECKS PASSED**. Relevant here: 32 calls sent, 32 rows in `mcp_calls`, and the same POSTs left activity rows carrying `agent` and `human` actor kinds and per-tool routes |
| Redaction unit tests | `node --import tsx --test lib/observability/redact.test.ts` | **8 tests, 8 pass, 0 fail** |
| Types | `npm run typecheck` | clean, no output |
| Money guards | **not run**, as instructed | cited: coordinator, **192 of 192** on an ephemeral database migrated 0001 to 0021 at 10:42Z, eight new assertions covering `activity_log` (UPDATE, DELETE and TRUNCATE refused for every role, INSERT allowed for the runtime role, the server clock ignoring the client). The migration was applied to the trial database at 10:42Z |
| Wrapper coverage | grep of exported handlers against `withActivity` per file | **34 files, 37 handlers, 37 wrappers, 0 unwrapped** |
| Rows read back | read-only `SELECT` as `app_runtime` | `corgi_test`: 85 rows, 85 distinct correlation ids, 0 duplicates, 0 implausible timestamps. Trial database (`neondb`): 14 rows, 14 distinct ids, 0 duplicates, 0 implausible timestamps |
| Leak grep | ten shapes over four columns of all 99 rows | **0 hits** |
| Production walk | within the rules: GET requests, two login POSTs, exactly two deliberately refused POSTs | see section 4. No form submitted, no money moved, no journal entry created |
| Fail-open | local, twice (unreachable database, then a refused check constraint) | the response is returned unchanged and `recordActivity` does not throw |

**The JSON line, verbatim, from one request on a local server**
(`curl -H "x-request-id: obrev-local-health-1" http://127.0.0.1:3800/api/health`, HTTP 200):

```json
{"recordedAt":"2026-09-09T10:54:16.860Z","correlationId":"obrev-local-health-1","actorUserId":null,"actorRole":null,"actorKind":"anonymous","route":"/api/health","method":"GET","subjectKind":null,"subjectId":null,"durationMs":112,"outcome":"ok","rule":null,"message":null,"statusCode":200}
```

**And the same line when the sentence carries things it must never print.** A handler was made to
throw one message holding four of them at once, plus one reference that must survive: an email
address, an `Authorization: Bearer` header carrying a whole MCP key, a `password=` field, a
Stripe secret key in the `sk_test_` shape, and the PaymentIntent `pi_3NxYz`. The four literals
are deliberately not repeated in this record; what the wrapper printed was:

```json
{"recordedAt":"2026-09-09T10:55:06.732Z","correlationId":"obrev-redaction","actorUserId":null,"actorRole":null,"actorKind":"anonymous","route":"/api/review/redaction","method":"POST","subjectKind":null,"subjectId":null,"durationMs":0,"outcome":"error","rule":null,"message":"stripe refused for ops**** with Authorization: Bearer **** and password=**** using sk_**** on pi_3NxYz","statusCode":500}
```

Every one of the four is masked and the reference `pi_3NxYz` stays readable, which is the stated
rule. The second line printed on the same request was
`{"activityRowNotWritten":true,"correlationId":"obrev-redaction","route":"/api/review/redaction","reason":"connect ECONNREFUSED 127.0.0.1:1"}`,
because that run deliberately had no database.

---

## 6. Readability (READABLE-CODE.md)

The reading path is short and honest: a route file names its pattern on one line, `withActivity`
is one function of about 60 lines, `classify` is a pure function of a response and a thrown
value, `redact` is six named regular expressions and a slice. The diff on every one of the 34
route files is **three added lines and one changed line**, with the handler body not indented,
not reordered and not touched, which a spot check of `app/api/policies/route.ts` confirms. The
comments explain business reasons (why there is no payload column, why `instanceof` and not
`constructor.name`, why the MCP endpoint declares its own outcome) rather than narrating
assignments. Nothing here is a generic engine, an abstraction layer or a hidden side effect with
a misleading name.

**Three constructs Yoann should be asked to explain in his own words**, none of them a defect:

1. **`ACTIVITY_COLUMNS = (database) => database\`…\`** (`read.ts:3151`). A tagged template used
   as a *fragment* interpolated into three other queries. It reads like a query being executed
   and is not one; it is a postgres.js feature. Worth one sentence at the debrief.
2. **`{ refusal: abstract new (...args: never[]) => Error }`** (`log.ts:117`). An abstract
   constructor type, so a class can be stored in a list and used with `instanceof`. The reason
   for `instanceof` over `thrown.constructor.name` is written above it and is a good answer to a
   panel question: the production bundle mangles class names.
3. **The handler mutating the `activity` object it is handed** (`log.ts`, used by
   `app/api/mcp/route.ts`). This is a side channel: the wrapper's record is influenced by
   something the handler writes into a shared object rather than returns. It is documented,
   there is exactly one caller, and the alternative (a return type change on 37 handlers) would
   be worse. Yoann should be able to say why it exists: the MCP protocol answers a refused tool
   call with HTTP 200, so the status code lies about the outcome.

`redact.ts`'s `PASSWORD_FIELD_SHAPE` (a backreference on an optional quote, and a five-group
replacement) is the densest line in the slice. It has a test for both the form-body and the JSON
shape, which is what READABLE-CODE asks for; a hand-worked example beside it would still help.

---

## 7. The five `console.*` calls (F-RC-07), accepted

The recheck counted five in `lib/` and `app/`. After this slice:

- **Replaced, both now structured and sanitised.** `lib/mcp/jsonrpc.ts:273` prints
  `{"mcpToolFailed":…,"reason":sanitisedSentence(thrown)}` instead of the raw thrown error, which
  was the specific line F-RC-07 named. `app/api/mcp/route.ts:217` prints
  `{"event":"mcp_call_not_recorded",…}` with the same sanitiser.
- **Three left in `lib/documents/write-sample-documents.ts`** (lines 102, 119, 122):
  `wrote <path>`, `wrote <prefix>-<page>.png`, and a line saying no PNG was written because
  `pdftoppm` did not run.

**Accepted.** The file is a hand-run CLI tool, invoked as
`node --import tsx lib/documents/write-sample-documents.ts <directory>`, and a repository-wide
grep confirms **nothing imports it**: it is never in a route bundle, never on a request path, and
its three lines are progress output on a developer's terminal, printing a file path and no
identity, no key and no payload. Routing them through the request logger would be worse, not
better: they are not requests and have no correlation id. The two new `console.*` calls the slice
adds (`log.ts:303` and `:338`) *are* the structured logger and its failure line.

Two further `console.log` calls exist in `lib/kyb/stripe-connect.live.test.ts` (58, 89), printing
sandbox `acct_` identifiers from a live-sandbox probe. They are in a test file, not application
code, and an `acct_` is a public reference. Out of scope, recorded for completeness.

---

## 8. Findings

### F-OB-01 (LOW) The `rule` column is empty on every refusal a route answers, because no route lets its refusal escape

**Location.** `lib/observability/log.ts:106-133` (`RULE_OF_REFUSAL`, `refusalRuleOf`) and
`classify`'s redirect and 4xx branches.

**Trigger.** The eleven-entry table maps a refusal class to a human rule name, and it is read
**only** on the `handlerThrew` branch. Every route file catches its own refusal and answers with
a redirect carrying `?error=` or with a status code: a grep found that six route files contain no
`catch` at all, and reading them shows they return outcome objects rather than throwing. So the
throw branch is not reached by any shipped route.

**Measured.** On the trial database, 6 refusals, **1 named a rule** — the `/api/mcp` 401, and only
because `app/api/mcp/route.ts` sets `activity.rule = "MCP key"` by hand. The refused
`POST /api/mcp-keys`, whose `KeyRefused` maps to `MCP key`, reads `none named`. The refused
`GET /api/jobs/daily`, whose `JobNotAuthorised` maps to `cron secret`, reads `none named`. On
`corgi_test` the 40 rows that do name a rule are 36 set by hand by the MCP endpoint and 4 from
`check:console`'s own synthetic handler, which throws on purpose.

**Consequence.** Migration 0021 states the purpose in its own comment: *"Saying 'refused' without
saying by what is what makes an operations log useless during an incident."* For the routes an
operator will actually chase, that is the shipped behaviour. It is mitigated, not undone: the
redirect refusals carry the real sentence, which is more informative than a rule name, so the
column is a missing convenience rather than missing information. There is also a cost: eleven
modules are imported into every serverless bundle, `/api/health` included, for a code path no
route reaches.

**Required correction (small).** Either set `activity.rule` in the handlers that already catch
their refusal (one line per `catch`, and the wrapper already prefers a value the handler set), or
delete `RULE_OF_REFUSAL` and its eleven imports and say in the README that the sentence is the
record. Do not leave both halves half-true.

### F-OB-02 (LOW, latent) `classify` invents the status code on the throw branch

**Location.** `lib/observability/log.ts`, `classify`: `statusCode: rule ? 400 : 500`.

**Trigger.** When a handler throws, no response exists, so the classifier writes a status code
rather than observing one. A recognised refusal is recorded as **400**; the framework would
actually answer **500**. The console prints the value as `HTTP {statusCode}` beside the outcome, a
statement about what the caller received.

**Consequence.** A row could say HTTP 400 for a request answered 500. It is latent today: no
shipped route lets a refusal class escape (see F-OB-01), so the 400 branch is reached only by
`check:console`'s synthetic handler, where it is visible in this review's evidence
(`statusCode: 400` on the `maker-checker` line). If F-OB-01 is fixed by making routes throw
rather than catch, this stops being latent.

**Required correction.** Record 500 on both throw branches, or rename the column's meaning on the
screen.

### F-OB-03 (LOW) The console's failure line does not use the redaction function that now sits beside it

**Location.** `lib/console/safe-read.ts:20-29`.

**Trigger.** `attempt` builds its failure sentence with a hand-rolled
`message.replace(/\s+/g, " ").slice(0, 300)` and does not call `redact()`. A postgres.js error can
carry a connection string with its password (`redact.ts` has a rule for exactly that shape, and
its test uses exactly that message). That line renders on all seven console screens.

**Consequence.** A credential could reach a staff screen during an outage and from there a
screenshot, which AF-05 names as something to redact. Nothing of the sort was observed during
this review: no panel failed, so no failure line rendered.

**Relationship to earlier findings.** This is the same code as **F-B13-28 (INFO, open)** in the
v1 record, which noted that the failure line prints the raw Postgres message. It is raised again,
one severity higher, for one new fact: the redactor now exists, in a sibling directory, imported
by the same page tree, so the correction is a one-line import instead of a design question.

**Required correction.** `failure: \`${what} could not be read: ${redact(message)}\``.

### F-OB-04 (LOW) No page render leaves a row, so "latency by route" is API routes only

**Location.** the wrapper is applied in `app/api/**/route.ts` only; there is no `middleware.ts`
and no `instrumentation.ts` in the repository.

**Trigger.** The console screens, the policy screens and every other server-rendered page
contribute nothing to the table.

**Measured.** After a production walk that rendered six pages,
the latency panel listed **four routes, all of them API routes, and no page**.

**Consequence.** Decision 25 records the benefit as *"refused actions and per-request latency of
every screen become visible"*. Screens are not routes here. The README is accurate ("per route
over 24 hours"), the panel's own disclosure is accurate, and the gap is only between the decision
record and the build. Yoann's stated purpose for the console was a cockpit to diagnose while a
panel tries to break the app: if they break a *page*, this panel will not show it.

**Required correction.** None to the code within the remaining time. Correct the wording of
decision 25, or add one sentence to the panel's disclosure saying which requests are counted.

### F-OB-05 (LOW) `duration_ms` excludes the two things the wrapper itself adds

**Location.** `lib/observability/log.ts`: `const durationMs = Date.now() - startedAtMs;` is
computed **before** the `currentUser()` lookup and **before** `await recordActivity(...)`, both of
which happen before the response is returned.

**Trigger.** Every request now pays a session read and a database insert after its handler
finishes, and neither is inside the measured figure.

**Consequence.** The panel's figures are a true measurement of the handler and an understatement
of the response. The panel's own disclosure says it measures "the time this application spent
inside the handler", so the wording is honest; but the two costs the observability slice itself
introduced are precisely the ones it cannot see. Under the load of a panel trying to break the
application, an insert on the critical path of every response is the kind of thing an operator
would want on the screen.

**Required correction.** None required. Worth one sentence in the disclosure, or moving
`recordActivity` after the response is handed back if the runtime allows it.

### F-OB-06 (INFO) The JSON line and the row are timed by two different clocks

`recordActivity` prints `recordedAt: new Date().toISOString()` (the application clock) while the
row's `recorded_at` is set by the BEFORE INSERT trigger (the database clock). The two timestamps
for the same request will differ by the insert's latency and by any clock skew between Vercel and
Neon. The correlation id is the join key, so nothing breaks; an operator comparing timestamps
during an incident should know. One sentence in the README paragraph would close it.

### F-OB-07 (INFO) "Masked" on the activity rows is decluttering, not redaction

`Masked` renders `<details><summary>Ale***</summary><div>Alex Kim, approver</div></details>`: the
full value is in the HTML of every console page, one click and one View Source away. This is
exactly what decision 23 asked for ("masked by default, revealed on click") and exactly what the
v1 record states at length in its section 7. It is repeated here only because `ActivityTable` is
new and reuses it, and because nobody at the debrief should describe the activity log as
redacting personal data. **The log lines and the stored rows are a different matter and are
genuinely redacted**: they carry a user id, never a name and never an email, which 99 rows
grepped for ten shapes confirm.

---

## 9. What was not verified

- **`check:money-guards` was not run**, as instructed. Its 192 of 192 on an ephemeral database at
  10:42Z is cited from the coordinator, not reproduced. The runtime role's inability to UPDATE
  `activity_log` was independently reproduced on `corgi_test`; DELETE and TRUNCATE for the owner
  were not.
- **26 of the 34 route files were never exercised.** No form was submitted and no money was
  moved, so their rows are asserted from the uniform wrapper diff and the handler-count grep, not
  from observed rows.
- **The Stripe webhook was not exercised** (it needs a signed event and would move sandbox
  money) and **the authorised cron path was not run** (it would execute reconciliation, recovery
  and settlement on the trial database). Both verified by reading, as described in section 4.
- **The JSON line was not read from a Vercel log.** It was read from a local server's stdout and
  from `check:console`'s output. That the deployed function's stdout reaches Vercel's log stream
  is standard platform behaviour, not something this review observed.
- **The ten-second meta refresh was assessed from the rendered markup**, not from a browser, as
  in the v1 record.
- **No load was applied.** The latency figures above come from a handful of requests; a p95 over
  two or three samples is not a p95, which the panel says on its own row.
- **`app/ops/console/infra`, `/ops/console/broker/*`, `/ops/console/customer/*` and
  `/ops/console/claim/*` were not opened on production**; the Activity panel was verified on the
  policy page and by code path for the other three, all four being the same `Console360`
  component.
- **Nothing about the three UI builders' parallel work** was reviewed; layout is out of scope and
  the tree may change under this record.

---

## 10. Verdict

**PASS.**

Decision 25 asked for one append-only `activity_log` carrying the guards of the money tables,
written by every route handler, job and MCP call with who, route, object ids, duration, outcome
and a correlation id, plus one masked JSON line per request, plus a console that reads it. All of
that is built, and this review measured it rather than taking it on trust: 37 of 37 exported
handlers wrapped, 99 rows read back with one row per request and no duplicate, 0 leak shapes over
ten patterns and four columns, the five actor kinds observed on real rows (four of them live,
`stripe` by reading), the panels rendering on production at the reviewed revision, the fail-open
path proven twice, and 65 of 65 assertions passing in `check:console`.

The schema is the strongest part of the slice: there is no payload column, so the class of
accident AF-05 exists to prevent has nowhere to land, and the same three guards the ledger uses
are on the table with the same functions.

The seven findings are all LOW or INFO and none of them is an observed violation of an applicable
requirement. **F-OB-01** is the one worth acting on before the debrief, because a panel that asks
"you say you record which rule refused it, show me" will get `none named` on the first row they
point at; the fix is one line per `catch` or one deletion. **F-OB-03** is a one-line import that
closes a credential path onto a screen. Neither blocks the feature.

**Walkthrough status: NOT REVIEWED WITH YOANN.** No part of this slice has been explained back by
Yoann in his own words. AF-06 is not satisfied by this review and cannot be. The three constructs
named in section 6 are the ones to put in front of him first.

This is a scoped engineering assessment of one slice at one revision. It is not a certification,
it does not establish that the console is correct under load, and it says nothing about the
features the parallel UI work is changing.

---

## 11. Register lines

| ID | Severity | One line | Status |
|---|---|---|---|
| F-OB-01 | LOW | The `rule` column is null on every refusal a route answers: `RULE_OF_REFUSAL` is read only on the throw branch, and no shipped route lets a refusal class escape. Measured 1 of 6 refusals named on the trial database, and that one is set by hand by the MCP endpoint. Eleven modules imported into every bundle for a path nothing reaches | OPEN |
| F-OB-02 | LOW | `classify` writes 400 for a thrown refusal and 500 otherwise instead of the status the caller received; the console prints it as `HTTP n`. Latent while no route throws | OPEN |
| F-OB-03 | LOW | `lib/console/safe-read.ts` builds its on-screen failure line without `redact()`, which now sits in a sibling module; a driver error can carry a connection-string password onto all seven console screens. Raises F-B13-28 (INFO) now that the one-line fix exists | OPEN |
| F-OB-04 | LOW | Only `app/api` routes are wrapped, so no server-rendered page leaves a row; "latency by route" listed four API routes and no page after a walk that rendered six pages. Decision 25's "latency of every screen" overstates the build; the README is accurate | OPEN |
| F-OB-05 | LOW | `duration_ms` is computed before the `currentUser()` lookup and before the activity insert, so the two costs the slice itself adds to every response are invisible in every figure on the latency panel | OPEN |
| F-OB-06 | INFO | The JSON line's `recordedAt` is the application clock, the row's `recorded_at` is the database clock; the same request carries two timestamps. The correlation id is the join key | OPEN |
| F-OB-07 | INFO | `Masked` keeps the full name in the HTML inside a closed `<details>`, so the activity rows are decluttered and not redacted on screen. As decided (rule 23) and as stated in the v1 record; the stored rows and the log lines are genuinely redacted | OPEN, accepted |
