# Independent review, slice new-broker, round 1

Reviewer: independent reviewer sub-agent, working in the builder's worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/wf_bd4e916d-509-1`, branch
`new-broker-route`. No branch was switched and no second worktree was created. Written at
2026-09-09T21:48Z (23:48 local).

Reviewed revision: **6aa11e4490e1b386ef91fe8531fe2011491b0afe**, four commits above `main`
(`40352c8`): `b5040da` (scrypt hashes), `79cd391` (the route), `3b00f0d` (the check script),
`6aa11e4` (counting brokers by name). The diff read line by line is `git diff 40352c8...HEAD`:
**15 files, +1191, -17**. The working tree was clean at checkout and stayed clean apart from this
record; every probe script this review wrote lives outside the repository, in the session
scratchpad.

This is a scoped engineering assessment of one slice. It is not a legal certification and it is
not a statement that the six delivery gates pass for the submission.

## 1. Startup receipt

Read in full, in this order, before looking at any code: `CLAUDE.md`, `AUTOMATIC-FAILS.md`,
`AGENTS.md`, `WORKFLOW-48H.md`, `REVIEWER.md`, `READABLE-CODE.md`.

Read in full, for the scope itself: the whole diff, then each new file end to end,
`db/migrations/0027_users_password_hash.sql`, `lib/auth/password.ts`,
`lib/auth/password.test.ts`, `lib/broker/create-broker.ts`, `lib/broker/reveal-cookie.ts`,
`app/api/brokers/route.ts`, `app/ops/brokers/reveal/consume/route.ts`,
`components/ui/reveal-done.tsx`, `scripts/check-new-broker.ts` (all 518 lines), and the changed
files in their entirety rather than as hunks: `app/api/session/login/route.ts`,
`app/ops/brokers/page.tsx`, `lib/observability/redact.ts` (the new rule and its neighbours).

Read in full, for the surrounding contract: `lib/observability/log.ts` (`withActivity`,
`classify`, the closed `ActivityRule` union, `recordActivity`), `lib/auth/session.ts`,
`lib/auth/current-user.ts`, `scripts/migrate.ts`.

Read in part, with what was read named: `db/migrations/0002_policies_and_money_operations.sql`
lines 37 to 68 (the `brokers` and `users` tables, the `brokers_are_append_only` trigger) and
lines 259 to 274 (the `app_runtime` grants); `scripts/seed.ts` lines 100 to 120 (the seeded
accounts, which set no password hash); `README.md` (the credentials paragraph only);
`docs/DECISIONS.md` line 249 and following (decisions 52 and 53); `docs/STATUS.md` lines 553 and
569 (the assignment of this slice and of F-INSPECT-05); `docs/reviews/FINDINGS.md` (the tail, for
the register format), `docs/reviews/backend-guards-and-key-trigger-r1.md` (for the record format).

Read read-only on another branch, and named as out of scope below: `inspect-05-sentence` at
`d241e8e`, for the single question the assignment put about F-INSPECT-05.

Not read, and named as such: the released brief PDF (not present in this worktree; the
requirements used here are those of `AGENTS.md` and of the two decisions above),
`READINESS-CHECKLIST.md` and `STRESS-TEST-PLAN.md` (no performance profile is claimed by this
slice), and every `docs/` record outside the lines named, because `docs/` belongs to the
coordinator.

Absent files: none in scope. `db/migrations/0026_*.sql` does not exist on this branch; it exists
on `demo-switch` and on several agent worktrees as `0026_mcp_key_expiry.sql`. The builder took
0027 rather than 0026, which is the right choice: the two files are independent, `scripts/migrate.ts`
applies unapplied files in file-name order and records them one by one, so 0026 landing later
still applies. No collision, no finding.

Acceptance criterion in scope: a staff operations user creates a broker and its sign-in account
from `/ops/brokers?view=new`, in one transaction, and is shown once a one-time password that is
stored only as a hash, never travels in a URL, a log, an activity row or a page that survives the
reveal; every other role and no session are refused; the seeded accounts sign in exactly as
before.

## 2. Applicability

Product: policy administration (Track 1), USD, integer cents, sandbox only, synthetic data. This
slice adds **no provider call, no network destination, no money arithmetic and no money row**. It
adds one nullable column, two INSERT grants, two route handlers, one screen block, one client
component, one redaction rule and one check script.

Confirmed by reading the code, not by taking the builder's word:

- the only tables written are `brokers` and `users`. Neither is a journal, an entry, a money
  operation or an event. `brokers` carries `commission_rate_bps`, which decides amounts later,
  and it keeps its append-only trigger; this slice only ever INSERTs a new row into it;
- no `UPDATE` and no `DELETE` statement exists anywhere in the diff. `grep -n "update \|delete "`
  over the four new library and route files and `lib/auth/password.ts` returns nothing at all;
- no live credential, no provider key and no personal datum. Every fixture address in the check
  script and in my probes is `@example.invalid`;
- the only new secret-shaped value is the one-time password, which exists in memory, in one
  response header and in one HTML response, and as a scrypt hash in the database.

Assumptions I did not resolve and that are not mine to resolve: whether the `ActivityRule` union
should gain a name for this gate (F-NEWBROKER-02, decision for Yoann), and which of the two
recorded wordings of F-INSPECT-05 he actually decided (F-INSPECT05-01).

## 3. Requirement to control to evidence

| # | Requirement (source) | Control and code location | Evidence I produced | Verdict |
|---|---|---|---|---|
| 1 | Sensitive actions are protected by authentication and authorization, server side (`AGENTS.md`, Financial invariants) | `currentUser()` then `mayCreateBrokers(role)` in `app/api/brokers/route.ts`, `staff_ops` only in `lib/broker/create-broker.ts` | `check:new-broker`: no session goes to `/login?error=`, a broker session and a staff approver session both read "Only operations staff can create a broker", 0 broker rows written by any of them | PASS |
| 2 | Database transactions for invariants; a refused write leaves nothing behind (`AGENTS.md`) | one `database.begin` around both INSERTs, `lib/broker/create-broker.ts:100` | `check:new-broker`: the duplicate email is refused and `0 brokers named "... second try"`, the first broker still there once | PASS |
| 3 | A duplicate is detected by the database, not by a prior read | SQLSTATE `23505` **and** `constraint_name = users_email_key` in `isDuplicateEmail` | read line by line; the constraint name is real: `users.email text not null unique` in migration 0002 line 62, which PostgreSQL names `users_email_key` | PASS |
| 4 | Never UPDATE or DELETE a money row; enforce at the database boundary (AF-03) | migration 0027 grants `insert` only, on two nonfinancial tables | live query on `corgi_test`: `app_runtime` holds `INSERT, SELECT` on `brokers` and on `users`, and nothing else; the money tables are untouched at `INSERT, SELECT`; `brokers` still carries `brokers_are_append_only` and `brokers_cannot_be_truncated` | PASS |
| 5 | A migration adds nullable columns and never redefines one (repository rule, F-B9-09) | `alter table users add column if not exists password_hash text null` plus a `comment on column` and one `grant` | `information_schema.columns`: `password_hash`, `text`, `is_nullable=YES`, no default. The file contains no other DDL statement | PASS |
| 6 | Seeded accounts sign in unchanged | the `password_hash === null` branch in `app/api/session/login/route.ts` | `check:new-broker`: a seeded user signs in with `DEMO_PASSWORD`, a wrong password is refused; my own probes signed in three freshly seeded staff users the same way | PASS |
| 7 | The shared demo password must not open a created account | the same branch, the demo password is not read when a hash exists | `check:new-broker`: "the shared demo password does NOT open the new broker's account" | PASS |
| 8 | Password storage uses a documented library, salted, compared in constant time (`READABLE-CODE.md`) | `node:crypto` `scrypt`, 16-byte random salt, 64-byte key, `timingSafeEqual` on equal lengths, `lib/auth/password.ts` | 7 unit tests including 10 malformed stored values; `npm test` 543 tests, 542 pass, 1 skipped (pre-existing) | PASS |
| 9 | The password is never in a URL, a log, an activity row or a persisted page | redirect carries only `?created=<uuid>`; `withActivity` logs no body and no header; the new `redact` rule masks the cookie by name; the page is dynamic | live: the 303 location is `/ops/brokers?view=new&created=<uuid>`; `activity_log` rows for `/api/brokers` carry `message=none` on success and the refusal sentence on refusal, and **0** rows whose message mentions a password; `cache-control: private, no-cache, no-store, max-age=0, must-revalidate` on the dynamic staff pages | PASS |
| 10 | Cookie flags on the built server, not on `next dev` (assignment) | `revealCookieHeader` writes `Secure` when `NODE_ENV === "production"` | `next build` then `next start`: `Path=/ops/brokers; HttpOnly; SameSite=Strict; Max-Age=120; Secure`, and the deletion `Path=/ops/brokers; HttpOnly; SameSite=Strict; Max-Age=0; Secure` with an empty value | PASS |
| 11 | Show failure paths; validate limits at boundaries, server side (`AGENTS.md`) | `readNewBrokerForm` checks name, address and rate before any INSERT | 8 invalid forms refused, each naming its field, 0 broker rows written | PASS with one exception, F-NEWBROKER-01: the address check accepts characters that are not safe in the response header the value reaches |
| 12 | `withActivity` on every route handler (decision 25) | both new handlers are wrapped | `activity_log` holds rows for `/api/brokers` (303 ok, 303 refused with the sentence) and for `/ops/brokers/reveal/consume` (401, 403, 204) | PASS on the wrapper, F-NEWBROKER-02 on the rule column |
| 13 | Structured, redacted logs (`AGENTS.md`, Operations and security) | `BROKER_PASSWORD_REVEAL_COOKIE_SHAPE` in `lib/observability/redact.ts`, matched on the cookie name | the new unit test asserts the password is gone and `Path=/ops/brokers` survives; I checked the ordering myself: `PASSWORD_FIELD_SHAPE` cannot match `broker_password_reveal=` because the name continues after "password", which is why the new rule is needed | PASS |
| 14 | A created broker is not eligible for anything (`AGENTS.md`, KYC: unknown blocks) | no `broker_kyb_events` row is written, and no event means unknown | live on the built server: the new broker is in the list as "never submitted"; eligibility itself is proven by the earlier B3 review, not re-proven here | PASS |

## 4. What I ran, with the commands and the actual results

All commands were run from the builder's worktree. `.env.local` is a symlink to the main
checkout's file, loaded with `process.loadEnvFile`; no value from it was printed by anything I
ran, and no connection string appears in any output below. `scripts/check-money-guards.ts` was
never run, by instruction.

```
npm run typecheck
> tsc --noEmit
(no output, exit 0)
```

```
npm test
# tests 543
# pass 542
# fail 0
# skipped 1
```
The one skip is pre-existing and outside this slice. The builder's reported counts reproduce
exactly.

```
npm run check:new-broker
41 PASS, 0 FAIL, 1 SKIP, exit 0, "all checks passed"
```
Every line reproduces the builder's report. The migration line reads `skip
0027_users_password_hash.sql`, which means my run did not apply it from scratch: the builder's
earlier run had already applied it to `corgi_test`. I did not re-prove the fresh application of
the migration; I proved its result instead, by reading `information_schema` and `pg_trigger`
(row 5 and row 4 of the matrix above).

Privileges, read live on `corgi_test` with the owner connection (my own script, outside the
repository):

```
brokers                  INSERT, SELECT
journal_entries          INSERT, SELECT
journal_lines            INSERT, SELECT
money_operation_events   INSERT, SELECT
money_operations         INSERT, SELECT
policies                 INSERT, SELECT
policy_events            INSERT, SELECT
users                    INSERT, SELECT
users.password_hash: {"data_type":"text","is_nullable":"YES","column_default":null}
triggers: brokers.brokers_are_append_only, brokers.brokers_cannot_be_truncated
```

**The built server.** `npm run build` (success), then `next start -p 3812` with
`NODE_ENV=production` and the runtime pointed at the disposable database. This is the half the
check script cannot cover, because it starts `next dev`:

```
session cookie attributes: Path=/; HttpOnly; SameSite=Lax; Max-Age=43200
POST /api/brokers -> 303 /ops/brokers?view=new&created=727a06b8-...
reveal cookie attributes: Path=/ops/brokers; HttpOnly; SameSite=Strict; Max-Age=120; Secure
consume -> 204 | deletion attributes: Path=/ops/brokers; HttpOnly; SameSite=Strict; Max-Age=0; Secure | empty value: true
```

**The two screen assertions the check script skips.** The builder disclosed this gap and said the
four assertions were run by hand. I did not take that on trust: I ran them myself against the
built server and the same database, and waited out the render.

```
page with the cookie rendered in 212 s, 2187522 bytes
  shows the block: true
  shows the email: true
  shows the password: true
  lists the new broker as never submitted: true
  no 'Route pending': true
  submit button enabled: true
  without the cookie, says it is gone: true
  without the cookie, the password is absent: true
```

The 212 seconds are the pre-existing N+1 read on `/ops/brokers` (three queries per broker in
`lib/broker/kyb.ts`) against a shared database holding 1157 brokers. That is not a defect of this
diff and it does not affect the trial database, which holds a handful of brokers. It does mean the
automated check can never prove those four lines on the only database it is allowed to run
against; see F-NEWBROKER-05.

**Hostile input on the one field that reaches a response header.** The contact address is the only
operator-typed value copied into `Set-Cookie`. The route's own address check,
`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, accepts a semicolon and a comma in the local part, and both are
structural characters of that header. Against the built server, with a staff operations session:

```
[semicolon] status 303
  reveal header: broker_password_reveal=probe-e855de96;max-age=99999@example.invalid|<password>; Path=/ops/brokers; ...
[comma] status 303
  set-cookie count 2
  name "broker_password_reveal"  value ends at the comma
  name "corgi_session"           attributes: Path=/ops/brokers; HttpOnly; SameSite=Strict; Max-Age=120; Secure
[non-ascii] status 303, header carried through unchanged, no 500
```

Both cases created the broker and its account. Neither delivered a usable password. See
F-NEWBROKER-01.

**Login timing**, five pairs against the built server, wrong password each time:

```
unknown email median 466 ms, account with a scrypt hash median 502 ms
```

**Secrets.**

```
gitleaks detect --log-opts=40352c8..HEAD
4 commits scanned. no leaks found.

gitleaks detect --no-git --source .
leaks found: 10
```
All ten working-tree hits are inside `.next/` (`prerender-manifest.json`, `server-reference-manifest.json`,
the build caches), which is gitignored build output produced by my own `npm run build`, not
repository content. I listed the file paths only and never the values. Nothing in the diff, in the
history of the branch or in the tracked tree carries a credential. The two untracked local
artifacts the builder declared (`.env.local` symlink, a real `node_modules`) are both gitignored
and neither is committed; I confirmed it with `git status --porcelain --ignored`.

**Dashes.** `git diff 40352c8...HEAD | grep [em dash, en dash]` returns nothing.

Not executed, and why: `scripts/check-money-guards.ts` (forbidden to this reviewer; the
coordinator proves the guards on an ephemeral database, and this slice grants no privilege that
script asserts against); the deployed application (this branch is not deployed, AF-01 is not in
scope here); the full `check:mcp` and the other check scripts (unchanged by this diff, and running
them on the shared database costs contention for no new evidence).

## 5. Findings

### F-NEWBROKER-01 (MEDIUM) The reveal cookie value is not encoded, so the contact address can inject into `Set-Cookie`

**Trigger.** `POST /api/brokers` with a contact address whose local part contains a semicolon or a
comma, for instance `probe;max-age=99999@example.invalid`. Both pass `looksLikeAnEmailAddress`,
which only forbids whitespace and a second `@`. `revealCookieValue` then concatenates the address,
a bar and the password, and `revealCookieHeader` writes that straight into the header
(`lib/broker/reveal-cookie.ts:32` and `:51`), with no escaping anywhere.

**Consequence, measured on the built server, not argued.** With a semicolon, the browser reads the
cookie value as everything before it, so the password never reaches the operator: the account is
created, the screen renders "The password was shown once and is gone", and nobody can ever sign in
as that broker. There is no repair path by design: `users` carries no UPDATE grant for the runtime
role and `brokers` is append-only, so the row stays forever and the only answer is to create
another broker. With a comma, an HTTP client that splits `Set-Cookie` on commas (undici does, as
the probe shows) sees a **second cookie named `corgi_session`**, scoped to `/ops/brokers`,
HttpOnly, whose value is attacker-chosen text. It cannot forge a session, because
`readSessionCookie` verifies an HMAC, but on a client that splits, a narrower-path `corgi_session`
shadows the real one and signs the operator out of `/ops/brokers`. Browsers do not split on
commas, so in a browser the effect is the truncated value of the first case.

**Why it is not merely theoretical.** The comment beside the address check says the browser
already refuses an obviously wrong address, which is exactly the reliance `AGENTS.md` forbids:
`type="email"` does block a semicolon and a comma, so the browser is the only thing standing
between this route and its own header. A direct POST, a script, a copy-pasted address with a
trailing separator, or any future non-browser caller reaches it. The rule is that server-side
validation may not depend on the form that called it.

**Required correction.** One of: percent-encode the value in `revealCookieHeader`
(`encodeURIComponent`) and decode it in `app/ops/brokers/page.tsx` before
`readRevealCookieValue`, which is the smaller change and matches what `scripts/check-new-broker.ts`
already assumes when it calls `decodeURIComponent`; or refuse an address containing any character
that is not valid in a cookie value, and say so in the sentence the operator reads. Add the
hostile address to the invalid-form table of the check script either way.

### F-NEWBROKER-02 (LOW) Neither new handler names an `ActivityRule`, so its own gate refusals read "none named"

**Trigger.** Any refusal by `POST /api/brokers` or `POST /ops/brokers/reveal/consume` that is the
route's own gate: the role wall, the invalid fields, the duplicate address, the 403.

**Consequence.** Measured in `activity_log` on the built server: every one of those rows carries
`rule = none`, while the outcome and the sentence are correct. `lib/observability/log.ts`
documents the convention explicitly, that the rule is left out only for a route with no gate of its
own, and finding F-OB-01 exists precisely because the Rule column used to be empty on real
refusals. These two routes do have a gate of their own, so the console's Rule column now
under-reports again for them.

**Required correction.** A decision, not a fix the builder should take alone: either add one name
to the closed union in `lib/observability/log.ts` (the builder's stated reason for not doing it is
merge risk with other branches, which is real tonight and gone after the merge), or record the
deviation so the console's Rule column is read correctly. The builder disclosed this himself.

### F-NEWBROKER-03 (LOW) The login answer time distinguishes an account with a hash from an address that does not exist

**Trigger.** `POST /api/session/login` with a wrong password. When no user matches, the handler
answers without hashing anything; when the user carries a scrypt hash, it pays for the derivation
first.

**Consequence.** Measured: 466 ms against 502 ms in medians of five, on a loopback connection.
Small and noisy, but it is a real signal and it grows with a faster network and repeated sampling.
It tells an unauthenticated caller which addresses are created brokers. Seeded accounts are not
distinguishable this way, because their comparison is as cheap as the miss.

**Required correction.** Optional for a sandbox trial and worth recording either way: verify the
submitted password against a fixed dummy hash when no user matches, so both paths pay the same
cost, or accept and record the limitation beside the existing note in `lib/auth/session.ts` that
this is not a production authentication system.

### F-NEWBROKER-04 (LOW) `createBrokerWithSignIn` carries a database parameter nothing uses

`lib/broker/create-broker.ts:93` takes `database: postgres.Sql = sql`. No caller and no test
passes it. `READABLE-CODE.md` asks for a small provider or handle seam only where something
actually needs it. Required correction: drop the parameter, or use it in a test that proves the
rollback without HTTP.

### F-NEWBROKER-05 (LOW) The two screen assertions can never run on the only database the check may use

`scripts/check-new-broker.ts` refuses to run anywhere but `corgi_test`, and skips its four screen
assertions above 100 brokers. `corgi_test` holds 1157. So those four lines are unreachable in
practice unless someone provisions a fresh database. The evidence gap is closed for this revision,
because I ran them myself against the built server and all four passed, but it will reopen on the
next change to that screen. Required correction: none for this commit; record that the four lines
are covered by reviewer evidence rather than by the script, and consider counting only the brokers
this run created, or rendering the block on a screen that does not list every broker.

### F-INSPECT05-01 (LOW) The INSPECT-05 sentence matches decision 53 but does not close the enumeration the register describes

**Out of scope of the reviewed commit.** Nothing about F-INSPECT-05 is on `new-broker-route`; the
15 changed files contain no MCP file. The assignment asked about it, so I inspected branch
`inspect-05-sentence` at `d241e8e` read-only, without checking it out.

What is true there: the sentence is exactly `Nothing in this database matches that reference.`,
one sentence, matching decision 53 word for word; the visibility refusal is untouched
(`referenceInBookRefusal` still throws `ToolRefused` before any read); four unit tests were added
in `lib/mcp/tools/inspect-reference.test.ts` and `scripts/check-mcp.ts` now asserts the exact
sentence for two shapes; no other tool file is changed; and that branch carries its own
independent review, `docs/reviews/backend-inspect-05-r1.md`, verdict PASS.

What is worth the coordinator's attention: the original F-INSPECT-05 in `docs/reviews/FINDINGS.md`
records the recommendation as "one sentence for both cases (a reference that is not the broker's
and one that matches nothing) so a broker key cannot probe existence", while decision 53 as
recorded in `docs/DECISIONS.md` is only "one sentence instead of the list of recognised shapes".
The implementation follows decision 53. A broker key can therefore still tell a reference that
exists but is not its own (a refusal) from one that matches nothing (an answer), so the
enumeration the finding was raised for is unchanged. Required correction: confirm with Yoann which
of the two he decided, and do not record F-INSPECT-05 as closed on the enumeration ground unless
he says the shortened sentence is the whole answer.

## 6. Automatic-fail gate, for this scope only

| Rule | Verdict | Evidence |
|---|---|---|
| AF-01, accessible deployed URL | NOT RUN | This branch is not deployed. Out of scope of a feature review; the coordinator owns it |
| AF-02, no simulation presented as live | PASS | The slice calls no provider and claims no live integration. The screen tells the operator the password is shown once and says truthfully what happens if it is lost |
| AF-03, never UPDATE or DELETE a money row | PASS | No money table is touched. No UPDATE or DELETE statement exists in the diff. Migration 0027 grants INSERT only; `app_runtime` verified live at `INSERT, SELECT` on `brokers` and `users`; `brokers` keeps its append-only and truncate triggers. The one operational consequence of F-NEWBROKER-01, an unusable broker row that cannot be repaired, is a consequence OF the append-only rule and not a breach of it |
| AF-04, sandbox only, no real data | PASS | `corgi_test` and `@example.invalid` fixtures throughout, mine included. No provider call, no live key, no personal datum |
| AF-05, never commit a secret | PASS | `gitleaks` over `40352c8..HEAD`, 4 commits, no leaks. The ten working-tree hits are all inside gitignored `.next/` build output. The one-time password is generated per request and never written to a file. No connection string was printed by any command in this review |
| AF-06, own and explain every line | BLOCKED, on Yoann's side | The code is explainable: short reading path, one business responsibility per function, comments that say why. Nothing here establishes that Yoann can defend it. Walkthrough status below |

## 7. Verdict

**FAIL** at `6aa11e4490e1b386ef91fe8531fe2011491b0afe`, on F-NEWBROKER-01 alone.

Everything else in this slice holds up under attack, and the builder's evidence reproduced line for
line, including the counts. The role wall refuses every role that is not staff operations and
refuses no session. The transaction is real: the duplicate address leaves no half-written broker,
proven by name on a shared database. The hash is salted, the comparison is constant time, ten
malformed stored values are refused rather than interpreted, and the shared demo password does not
open a created account while every seeded account still signs in as it did. The password is in no
URL, no log line, no activity row and no cacheable page, and I checked each of those four myself
rather than reading the claim. The cookie carries the right flags on the built server, including
the `Secure` the check script cannot see, and the deletion carries the same name and path with an
empty value. The migration adds one nullable column and two INSERT grants and nothing else.

The one failing item is small and its correction is one line: an operator-typed value reaches a
response header unescaped, and the only thing that currently stops it is the browser's own field
validation, which the rules say may not be the control. The demonstrated consequences are a broker
account whose one-time password is destroyed on creation, in tables that cannot be repaired, and a
second `Set-Cookie` named after the session cookie on clients that split on commas. Encode the
value, add the hostile address to the invalid-form table of the check script, and this slice
passes.

Residual limitations, all visible above: the four screen assertions are covered by reviewer
evidence rather than by the automated check (F-NEWBROKER-05); the fresh application of migration
0027 was not re-proven, only its result (section 4); the console's Rule column under-reports for
these two routes (F-NEWBROKER-02); the login timing signal is present and unmitigated
(F-NEWBROKER-03); the 212-second render of `/ops/brokers` on a database with 1157 brokers is
pre-existing, outside this slice, and harmless on the trial database.

Walkthrough status: **NOT REVIEWED WITH YOANN**. The first question to put to him is the one this
slice turns on and the code answers in six lines: why the same login form can accept two different
kinds of password without the demo password ever being read for a created broker. The second is
why the broker INSERT disappears when the second INSERT is refused.

## 8. Register lines

For the coordinator to paste into `docs/reviews/FINDINGS.md`; this review does not edit that file.

## new-broker round 1 (docs/reviews/backend-new-broker-r1.md, FAIL at 6aa11e4, 23:48 local; typecheck clean, 543 tests, check:new-broker 41 PASS 0 FAIL 1 SKIP, cookie flags and the four screen assertions proven on the built server)

| ID | Severity | Finding | Required correction | Status |
|---|---|---|---|---|
| F-NEWBROKER-01 | MEDIUM | The reveal cookie value is unescaped, so a contact address containing a semicolon or a comma injects into `Set-Cookie`: the semicolon destroys the one-time password of an account that was created anyway and cannot be repaired, the comma emits a second cookie named `corgi_session` on clients that split | Percent-encode the value in `revealCookieHeader` and decode it in the page, or refuse an address carrying a character that is not valid in a cookie value; add the case to the check script | OPEN (builder) |
| F-NEWBROKER-02 | LOW | Neither new handler names an `ActivityRule`, so the console Rule column reads "none named" on their own gate refusals, against the convention documented in `lib/observability/log.ts` | Add one name to the closed union after the merge, or record the deviation | OPEN (coordinator) |
| F-NEWBROKER-03 | LOW | Login answer time separates an account carrying a scrypt hash (502 ms median) from an address that does not exist (466 ms), which enumerates created brokers | Compare against a fixed dummy hash on the miss, or record the limitation | OPEN (backlog) |
| F-NEWBROKER-04 | LOW | `createBrokerWithSignIn` takes a `database` handle no caller and no test passes | Drop the parameter, or use it in a rollback test without HTTP | OPEN (builder) |
| F-NEWBROKER-05 | LOW | `check:new-broker` skips its four screen assertions above 100 brokers and may only run on `corgi_test`, which holds 1157, so those lines are unreachable in practice | None for this commit, the reviewer ran the four live; record the coverage, or count only the brokers of the run | OPEN (coordinator) |
| F-INSPECT05-01 | LOW | Out of scope of this commit, observed read-only on `inspect-05-sentence` at `d241e8e`: the sentence matches decision 53 exactly and the refusal is unchanged, but the register recorded the recommendation as one sentence for BOTH cases, so the enumeration F-INSPECT-05 was raised for is still open | Confirm with Yoann which wording he decided; do not close F-INSPECT-05 on the enumeration ground | OPEN (coordinator) |
