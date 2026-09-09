# Independent review, slice demo-switch (round 1): the sidebar demo-account switcher

Reviewer: independent reviewer sub-agent, working in the worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/agent-ad7323c41e45d30d5`, on branch
`review-switch` created from `origin/switch-only`. Written at 2026-09-09T21:07:17Z (start
2026-09-09T21:02:55Z, both from `date -u`).

Reviewed revision: **77431eeb9354195ee3464eee561044001a826504** (branch `origin/switch-only`,
two commits `ebb4bf0` and `77431ee`), read as `git diff a7279a6...HEAD` against `main` at
`a7279a6`. The working tree was clean at review time apart from this file. No application code
was modified, no migration was applied, nothing was pushed to `main`.

This is a scoped engineering assessment of one slice. It is not a legal certification and it is
not a statement that the six delivery gates pass for the whole submission.

## 1. Startup receipt

Read in full, in this order, before looking at the slice: `CLAUDE.md`, `AUTOMATIC-FAILS.md`,
`AGENTS.md`, `READABLE-CODE.md`, `REVIEWER.md`.

Code read in full at the reviewed SHA: `app/api/session/switch/route.ts`,
`lib/auth/demo-accounts.ts`, `lib/auth/demo-accounts.test.ts`, `app/api/session/login/route.ts`,
`lib/auth/session.ts`, `lib/auth/current-user.ts`, `lib/observability/log.ts` (wrapper,
descriptor contract and the whole `classify` function), `components/ui/popover.tsx`, the whole
diff of `components/shell/app-shell.tsx`, `app/styles/lists.css` and `app/styles/system.css`.
Read in the parts that matter here: `scripts/seed.ts` (the six seeded users).

Not read, and why: `WORKFLOW-48H.md`, `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`,
`GAP-REVIEW.md`, `READINESS-BACKLOG.json` (advisory catalogues; the assignment is a twelve-minute
adversarial review of one authentication route, and no retained control beyond the `AGENTS.md`
authorization rule was identified for it). This is a scope limitation, recorded, not a claim that
they contain nothing relevant. `docs/STATUS.md`, `docs/DECISIONS.md` and
`docs/reviews/FINDINGS.md` were not edited, as instructed. Absent files: none.

Scope reviewed: the seven claims of the slice (closed email list, cookie identical to login,
signed-out refusal, agent refusal, GET 405, one activity row per switch, and the rest of the
diff), plus `npm run typecheck` and `npm test`.

## 2. What the slice actually contains

Every file in `git diff a7279a6...HEAD`, with no exception:

| File | Lines | What it is |
|---|---|---|
| `app/api/session/switch/route.ts` | +66, new | the route under review |
| `lib/auth/demo-accounts.ts` | +27, new | the closed list and `isDemoAccountEmail` |
| `lib/auth/demo-accounts.test.ts` | +19, new | two unit tests on the list |
| `components/shell/app-shell.tsx` | +58/-16 | the account block becomes a popover menu |
| `app/styles/system.css` | +87 | styling for the new menu |
| `app/styles/lists.css` | +12/-1 | the 375 px overflow fix on `/ops` |

`app/styles/system.css` (87 added lines) is not named in the slice claim, which mentions only
"a lists.css fix". It is styling for the new menu and touches nothing that existed before: every
added rule is scoped to `.account-switch`, `.account-chevrons`, `.pop-account*` or
`.sidebar.is-rail .account-chevrons`, all of them selectors introduced by this diff. No existing
declaration is changed. Recorded as an accuracy gap in the claim, not as a behavioural risk
(F-SWITCH-03).

`lists.css` does **not** only add `min-width: 0`. It adds three things: `min-width: 0` on the
`li` and the `a`, `min-width: 0; flex: 1 1 auto` on the text column, and `display: block` on the
detail span that already carried `white-space: nowrap; overflow: hidden; text-overflow:
ellipsis`. The third one is load-bearing rather than decorative: `text-overflow: ellipsis` has no
effect on an inline box, so without it the ellipsis never appears. All four selectors are
prefixed `.needs-you.lists-needs .needs-you-list`, so the blast radius is the "needs you" list
and nothing else. The 375 px measurement itself (605 px on production `d002f77`) was not
reproduced in this review: no browser was available (F-SWITCH-04).

## 3. Measurements

### 3.1 Checks that ran

```
npm run typecheck     -> exit 0 (tsc --noEmit, no output)
npm test              -> exit 0, "# tests 537 / # pass 536 / # fail 0 / # skipped 1"
                         (includes the two new lib/auth/demo-accounts.test.ts tests)
```

### 3.2 The live server could not be started, and why

```
npm run build   -> BUILD EXIT 1
   Error: Could not find the Next.js package (next/package.json)
   Resolved from: <this worktree>/app
```

The worktree has no `node_modules` of its own; Node resolves upward to the main checkout, which
is why `tsc` and `node --test` work, but Turbopack refuses to compile against a directory outside
its workspace root. Linking `node_modules` into the worktree was tried and Turbopack rejected
that too (`Symlink [project]/node_modules is invalid, it points out of the filesystem root`); the
symlink was removed immediately and `git status` is clean. So claims (1) to (5) were measured
against the code and against the shipped classifier, not with curl against a running server. That
is a real limitation of this review and is repeated in the verdict.

### 3.3 The closed list, measured

`isDemoAccountEmail` was executed directly (`node --import tsx`, `.env.local` loaded with
`process.loadEnvFile`, nothing echoed):

```
isDemoAccountEmail("root@example.com")   = false     # a non-seeded email
isDemoAccountEmail("")                   = false     # empty body: form.get("email") is null
isDemoAccountEmail("broker4@example.com")= false     # a broker created outside the seed
isDemoAccountEmail(" OPS@example.com ")  = true      # trimmed and lower-cased
isDemoAccountEmail("ops@example.com ")   = true
isDemoAccountEmail("ops@example.com\n")  = true
isDemoAccountEmail("OPS@EXAMPLE.COM")    = true
```

The list is a `readonly DemoAccount[]` literal in `lib/auth/demo-accounts.ts` with the six seeded
emails, and it is compared with `===` after `trim().toLowerCase()`. No branch of
`app/api/session/switch/route.ts` reads an email from anywhere else: the only `select` in the
file is `select id, role from users where email = ${email}` and it runs **after** the list check,
with the same normalised `email`. `signSessionCookie` is called with `target.id`, which is the
row found by that email. So the route cannot sign a cookie for an identity the constant does not
name, and a broker created outside the seed is refused before the database is touched. The two
new unit tests cover the accepted-case, the case/whitespace case, a non-listed email and the
empty string, and assert that the four emails printed by `/login` are on the list.

Residual: nothing forces the six constants to match the seed. If a future seed renames an
account, the menu offers an email the database no longer holds, and gate 3 answers "that demo
account does not exist on this database". That degrades honestly, so it is not a finding.

### 3.4 The cookie, compared line by line with login

The function is **`signSessionCookie` in `lib/auth/session.ts`**, the same one
`app/api/session/login/route.ts` calls. Both routes build the header from the same pieces:

| | login | switch |
|---|---|---|
| id signed | `user.id` (looked up by email) | `target.id` (looked up by email) |
| expiry | `Math.floor(Date.now()/1000) + SESSION_LIFETIME_SECONDS` | identical |
| secret | `sessionSecret()` | identical |
| header | `${SESSION_COOKIE_NAME}=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_LIFETIME_SECONDS}${secureFlag()}` | identical string, character for character |
| `secureFlag()` | `APP_BASE_URL?.startsWith("https://") ? "; Secure" : ""` | identical body |

`secureFlag` is duplicated rather than imported. Two copies of a security flag can drift; today
they are identical (F-SWITCH-05, LOW).

Landing page: login uses an inline ternary, switch uses `homeOf(role)`. Both send
`staff_ops`/`staff_approver` to `/ops`, `customer` to `/customer` and anything else to `/broker`.
Same table, and the switch redirect uses the **target** role, so the user lands on the new home.

### 3.5 Signed out, agent, GET

- **Signed out.** `handlePost` calls `currentUser()` first and returns
  `redirectTo("/login?error=Please+sign+in+first")` before reading the form. `redirectTo` builds
  `new Response(null, { status: 303, headers: { location: path } })` and no `set-cookie` header
  is appended on that path: the only `headers.append("set-cookie", ...)` in the file is on the
  last two lines of the success branch. So 303 to `/login`, no cookie, confirmed by reading the
  single return path, not by curl.
- **Agent principal.** `target.role === "agent"` is refused at gate 3, with the same sentence as
  a missing row, so the route cannot mint a browser session for an MCP principal. This holds the
  invariant `lib/auth/current-user.ts` documents ("an agent user cannot sign in"), which until
  now only `/api/session/login` enforced. Belt and braces: no agent email is on the closed list
  either, so gate 2 already refuses it. An agent principal cannot be the **actor** either, since
  no route ever signs a cookie for one.
- **GET.** Only `POST` is exported from `app/api/session/switch/route.ts`. Next.js answers an
  unexported method with 405 and an `Allow` header; this was not measured with curl for the
  reason in 3.2, so it rests on the framework contract and on the absence of any other export in
  the file (verified: the file exports `POST` and nothing else).

### 3.6 The activity row, measured through the shipped classifier

`classify` from `lib/observability/log.ts` was called with the exact `Response` objects the route
builds and the exact descriptor `{ route: "/api/session/switch", rule: "sign in" }`:

```
switch accepted (lands on /broker) -> outcome=ok      status=303 rule=null  message=null
email not on the list              -> outcome=refused status=303 rule=sign in message=that is not one of the demo accounts
target missing or agent            -> outcome=refused status=303 rule=sign in message=that demo account does not exist on this database
signed out                         -> outcome=refused status=303 rule=sign in message=Please sign in first
formData() throws (JSON body)      -> outcome=error   status=500 rule=null
```

On the accepted switch the classifier returns `message=null`, and the wrapper takes the
handler's own value instead (`activity.message ?? verdict.message`), which is
`demo switch: ${user.role} (${user.email}) to ${target.role} (${email})`: both roles and both
emails, old first. `currentUser()` is read by the wrapper **after** the handler returns, from the
request cookies, so `actorUserId` is the person who pressed the button and not the account they
became. That is the correct attribution and it is not accidental: the new `set-cookie` never
reaches `cookies()` within the same request.

So the claim holds: one row per switch, outcome `ok`, message naming old role and new role; one
row per refusal, outcome `refused`, rule `sign in`. The row is best effort by design (the wrapper
never fails a request on an insert error), which is pre-existing and documented.

### 3.7 Adversarial probes

- **Empty body.** `String(form.get("email") ?? "").trim().toLowerCase()` is `""`, refused at gate
  2, 303 with the error sentence, no cookie. Measured through `isDemoAccountEmail("")`.
- **JSON body.** `await request.formData()` throws on `content-type: application/json`. The
  handler does not catch it, so the wrapper records `outcome=error, status 500` and re-throws:
  the caller receives a framework 500, not the 303 the slice claims for "every other" input.
  `/api/session/login` behaves identically today, so this is a pre-existing pattern and not a
  regression, but the claim is imprecise (F-SWITCH-02, LOW).
- **Cross-site POST.** The cookie is `SameSite=Lax`, which is not sent on a cross-site POST, so a
  hostile page cannot switch a signed-in reviewer's account. No CSRF token is needed for that
  reason, and this matches every other form in the application.
- **Header injection into the redirect.** The only user-controlled value that reaches a header is
  the error sentence, and it is `encodeURIComponent`-ed, and it is a constant anyway.
- **Escalation.** This is the real one: the route asks only "is there a session", never "is the
  actor one of the demo accounts". Any principal holding a valid cookie, including a stolen one,
  can become `staff_ops` or `staff_approver` in one POST (F-SWITCH-01, MEDIUM). See below.

### 3.8 AF-05 and the dash rule

`git diff a7279a6...HEAD` grepped for `password=`, `secret=`, `postgres://`, `sk_live`, `sk_test`
and `DEMO_PASSWORD`: one hit, the word `DEMO_PASSWORD` inside a comment in
`lib/auth/demo-accounts.ts`, naming the variable and not its value. No credential, connection
string or key is added by this diff. `.env.local` was loaded with `process.loadEnvFile` and never
echoed. Grep for em dash and en dash over the whole diff: **0 hits**.

## 4. Findings

| ID | Severity | Finding | Required action | Status |
|---|---|---|---|---|
| F-SWITCH-01 | MEDIUM | The route checks that a session exists, never that the **actor** is a demo account. Any valid cookie, including one stolen from a customer, buys `staff_ops` or `staff_approver` in one POST, and any broker can read another broker's book by becoming `broker2@example.com`. Today the shared `DEMO_PASSWORD` already lets anyone who knows it sign in as any role, so this grants no new access to a password holder, but it does widen what a stolen cookie is worth. `app/api/session/switch/route.ts:21-27` | Add the actor-side gate `if (!isDemoAccountEmail(user.email)) return refuse(...)` (three lines, same shape as gate 2), or record the widening explicitly in the README limitations before submission | OPEN |
| F-SWITCH-02 | LOW | A body that is not form-encoded (`application/json`) makes `await request.formData()` throw. The request answers 500 and the activity row reads `outcome=error`, instead of the 303 refusal the slice claims for every non-listed input. Measured through `classify`. Same behaviour in `/api/session/login`, so pre-existing. `app/api/session/switch/route.ts:22` | Either wrap the `formData()` call in the same refusal as gate 2, or correct the claim to say "any non-listed **email**" | OPEN |
| F-SWITCH-03 | LOW | The slice claim names only a `lists.css` fix, but the diff also adds 87 lines to `app/styles/system.css`. Every added selector is new to this diff and no existing rule is changed, so the risk is nil; the claim is what is wrong. | State the second stylesheet in the handoff note for this slice | OPEN |
| F-SWITCH-04 | LOW | The `lists.css` change is not only `min-width: 0`: it also adds `flex: 1 1 auto` and `display: block` on the detail span, the latter being what actually makes `text-overflow: ellipsis` apply. The 375 px / 605 px measurement quoted in the comment was not reproduced here (no browser in this worktree). | Re-measure `/ops` at 375 px in a browser before the slice is called done | OPEN |
| F-SWITCH-05 | LOW | `secureFlag()` is copied from `app/api/session/login/route.ts` into the new route rather than imported. Two copies of one security flag can drift; they are identical today. | Export it once from `lib/auth/session.ts` when the file is next touched | OPEN |

No HIGH finding. Nothing in this slice touches money rows, a migration, a provider or a secret.

## 5. Readable code

The route reads top to bottom in one screen: three gates in the order the header comment
announces, then the cookie, then the redirect. Names carry their unit and purpose
(`expiresAtEpochSeconds`, `isDemoAccountEmail`, `homeOf`). Comments say **why** and not what: why
303 rather than 302, why the password is not asked again, why the activity row names both roles,
why the agent principal is refused. `lib/auth/demo-accounts.ts` states the reason the list exists
and the reason it is closed. The unit test file carries a worked example in its own comment. No
hidden side effect: the only writes are the `set-cookie` header and the activity row the wrapper
owns. This meets `READABLE-CODE.md` for the slice.

Candidate walkthrough status for this slice: **NOT REVIEWED WITH YOANN**. No reviewer can record
otherwise on his behalf.

## 6. Automatic-fail gate for this scope

| Rule | Verdict | Evidence |
|---|---|---|
| AF-01 accessible deployment | NOT RUN | delivery-level; this slice adds no deployment evidence, and the build could not run here (3.2) |
| AF-02 no simulation sold as live | NOT APPLICABLE | no provider, no integration slot touched |
| AF-03 no UPDATE/DELETE on money rows | PASS | the diff contains one SQL statement, a `select` on `users`; no migration, no money table |
| AF-04 sandbox only | PASS | six `@example.com` demo identities, no key, no live mode; `.env.local` read through `process.loadEnvFile` and never printed |
| AF-05 no committed secret | PASS | grep over the whole diff: only the string `DEMO_PASSWORD` in a comment, naming the variable |
| AF-06 explainable line by line | PASS for the code, OPEN for the human | the code is explainable (section 5); Yoann's walkthrough has not happened |

## 7. Verdict

**PASS**, with the five findings above open and with two stated limitations.

The three claims that matter are supported: the accepted emails are a code constant and the route
cannot sign a cookie for any identity that constant does not name; the cookie comes from
`signSessionCookie` in `lib/auth/session.ts`, the function login uses, with a byte-identical flag
string; the activity row is written once per request, `ok` on a switch with both roles in the
message, `refused` on every refusal.

Limitations of this review, stated so they are not mistaken for evidence: claims (1) to (5) were
measured against the code and against the shipped `classify` function, **not** with curl against a
running server, because the worktree cannot be built (3.2); and the 375 px overflow fix was read,
not seen. Neither limitation is a reason to hold the slice, but both should be closed by whoever
runs the next deployed check.

F-SWITCH-01 is the finding to act on. It is MEDIUM and not HIGH only because the shared
`DEMO_PASSWORD` already gives a password holder every role; it should be closed with the
three-line actor-side gate rather than with a paragraph in the README.
