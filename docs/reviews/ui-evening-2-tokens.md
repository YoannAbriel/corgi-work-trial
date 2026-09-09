# Independent review: Access tokens slice of the second evening interface batch

Reviewer: independent reviewer sub-agent (worktree `agent-ae5b49fc1230b9be2`).
Timestamp: 2026-09-09, 20:10Z to 20:40Z.
Stage: implementation review of a bounded vertical slice.

Reviewed head: `ui-evening-2` at **0fadcfa** ("Merge signed colours: previews, approvals and the
amount-explained drawer carry the direction of the money"), merged into this worktree at
`2d8f7af` and reviewed there. Merge base with `origin/main`: `524488f`.

The branch moved during the review (it is now `fdb1b36`, five further merges: a Billing view,
statements, emphasis, `sharp` as a devDependency). **Every file of this slice is byte-identical
between 0fadcfa and fdb1b36** (`git diff --stat 0fadcfa fdb1b368 -- app/ops/mcp-keys app/api/mcp-keys
app/api/mcp lib/mcp db/migrations lib/observability scripts/check-mcp.ts scripts/create-mcp-key.ts
components/shell/sections.tsx` is empty), so the verdict below applies to the current branch head
for this scope, and to nothing else on it.

Working tree: clean apart from an ignored `.env.local` written for the disposable database and a
copied `node_modules`, neither tracked. No file of the repository was modified; nothing was
committed.

## Startup receipt

Read in full, in this order: `CLAUDE.md`, `AUTOMATIC-FAILS.md`, `REVIEWER.md`, `AGENTS.md`,
`WORKFLOW-48H.md`. Then, for scope: `db/migrations/0026_mcp_key_expiry.sql`,
`db/migrations/0018_mcp_api_keys.sql` (label column and triggers), `lib/mcp/key-format.ts`,
`lib/mcp/keys.ts`, `lib/mcp/keys.test.ts`, `lib/mcp/token-reveal.ts`, `lib/observability/redact.ts`
and its test, `app/api/mcp/route.ts`, `app/api/mcp-keys/route.ts`,
`app/ops/mcp-keys/page.tsx`, `app/ops/mcp-keys/token-reveal-panel.tsx`,
`app/ops/mcp-keys/reveal/consume/route.ts`, `components/shell/sections.tsx`,
`components/ui/toast.tsx`, `lib/ui/views.ts` (`toastsFromQuery`), `app/styles/lists.css` (token
panel rules), `scripts/check-mcp.ts`, `scripts/create-mcp-key.ts`, `scripts/migrate.ts`,
`scripts/seed.ts`, `db/client.ts`, `README.md` line 64, `docs/COMPLIANCE-MATRIX.md` (MCP-01),
`docs/reviews/FINDINGS.md`, `docs/reviews/b11-mcp.md` (F-B11-07).
Absent files: none.
Next acceptance criterion in scope: MCP-01 (working MCP surface) as changed by this slice, plus
the AF gates below. Planned checks: the ones listed under "Checks executed".

Not read, deliberately: the other slices on the same branch (previews, signed colours, statements,
illustrations, the Billing view). They are other reviewers' scope. I confirmed only that they touch
no token, key, MCP or money path (see Diff scope).

## Environment, and why the numbers below are trustworthy

- **Disposable database.** `corgi_rev_tk`, created on the same Neon server as the trial database
  through the owner connection, migrated with `npx tsx scripts/migrate.ts` (0001 to 0026 applied,
  0026 last) and seeded with `npx tsx scripts/seed.ts`. It was dropped and recreated once, so every
  figure below comes from one clean run. **Dropped at the end of the review** (`drop database
  corgi_rev_tk with (force)`, see the last section). The trial database (`neondb`) was never
  written to and never connected to by anything but the `create database` statement.
- **Built server, production mode.** `npm run build`, then `NODE_ENV=production npx next start -p
  3041`. This matters: the reveal cookie's `Secure` flag is decided by `NODE_ENV`
  (`lib/mcp/token-reveal.ts:29`), so a dev server would have measured the wrong header. Stopped with
  `kill $(lsof -ti tcp:3041)`; `pkill next` was never used.
- **One aborted measurement, disclosed.** A first `npm run check:mcp` attempt bound nothing:
  another session already held port 3042 (`EADDRINUSE` in my own server log, `lsof` showed a
  `next-server` started at 22:06:03 that was not mine), so my requests reached that session's
  server and the check failed at its second assertion. That run is void and is not counted below.
  The run that counts was made on port 3341, verified free first.
- No secret value appears in this record. Tokens are printed as `cmk_xxxxxxxx_****`; connection
  strings, `DEMO_PASSWORD` and `SESSION_SECRET` were read by scripts from the main checkout's
  `.env.local` and never printed.

## 1. Diff scope

`git diff origin/main...ui-evening-2 --stat -- db lib app/api scripts` returns 18 files. Sorted by
whether they belong to this slice:

| File | In this slice | Note |
|---|---|---|
| `db/migrations/0026_mcp_key_expiry.sql` | yes | new, +31 |
| `lib/mcp/keys.ts` | yes | +28 |
| `lib/mcp/keys.test.ts` | yes | +61 |
| `lib/mcp/key-format.ts` | yes | **+61, not in the slice description** |
| `lib/mcp/token-reveal.ts` | yes | **new file, not in the slice description** |
| `lib/observability/redact.ts` / `.test.ts` | yes | +18 / +20 |
| `app/api/mcp/route.ts` | yes | +30 |
| `app/api/mcp-keys/route.ts` | yes | 116 changed |
| `scripts/check-mcp.ts` | yes | +59 |
| `scripts/create-mcp-key.ts` | yes | +14 |
| `lib/documents/brand-wordmark.ts`, `lib/documents/pdf-theme.ts`, `lib/documents/render.tsx`, `lib/statements/pdf.tsx` | no | statements PDF branding, another slice |
| `lib/inbox/sections.ts` | no | one broker inbox href moved to `?view=billing#collect`, another slice |
| `scripts/brand-assets.mjs`, `scripts/crop-illustrations.mjs` | no | asset tooling, another slice |

Under `app/ops` and `components`, this slice owns `app/ops/mcp-keys/page.tsx` (581 changed),
`app/ops/mcp-keys/reveal/consume/route.ts` (new, +38), `app/ops/mcp-keys/token-reveal-panel.tsx`
(new, +55) and the one label line in `components/shell/sections.tsx`. Everything else under those
two directories belongs to the other slices of the batch and touches no key, token, MCP or money
path (checked by reading the diff of each).

**Two departures from the slice description, both benign, both worth recording:** `lib/mcp/key-format.ts`
is described as "unchanged prefix format", which is true of the format (`PRESENTED_KEY`,
`generateApiKey`, `hashApiKey` and `keyPrefixOf` are untouched) but omits that the file gained the
whole lifetime vocabulary (`TOKEN_LIFETIMES`, `DEFAULT_TOKEN_LIFETIME`, `isTokenLifetime`,
`expiryInstant`, `tokenHasExpired`, `tokenExpiresSoon`, `EXPIRES_SOON_DAYS`); and
`lib/mcp/token-reveal.ts` is a new file the description does not list at all. Both are read in full
above and neither introduces a defect. A reviewer told "these files and no others" would have
flagged both, so the description, not the code, is what was wrong.

- **No UPDATE or DELETE on any mcp table.** `grep -inE '^\+.*(update|delete).{0,20}mcp_'` over the
  whole branch diff: 0 hits. No `drop`, no `truncate` on an added line: 0 hits. Migration 0026 is
  one `alter table ... add column` plus one `comment on column`, nothing else.
- **Only one migration on the whole branch** (`git diff --name-status -- db/`: `A
  db/migrations/0026_mcp_key_expiry.sql`), so no duplicate number, which is what went wrong on the
  breaks board slice.
- **gitleaks 8.30.1** over the exact range, `gitleaks detect --source=. --log-opts
  "524488f..0fadcfa" --redact`: `28 commits scanned`, `no leaks found`.
- **No em or en dash on an added line**: `grep -cP '^\+.*[\x{2013}\x{2014}]'` over the branch diff
  returns 0. The rendered screens report 0 dash characters at 1440, 1024 and 375.

## 2. The flow, on the built server against the disposable database

Written for this review (`flow.mjs`, Playwright, Chromium headless). `DEMO_PASSWORD` is read by the
script from the main checkout's `.env.local` and never printed. Full log kept; every line below is
quoted from it.

**Create.** `POST /api/mcp-keys` answers **303**, one `Set-Cookie`:

```
mcp_token_reveal=cmk_f8467e81_****; Path=/ops/mcp-keys; HttpOnly; SameSite=Strict; Secure; Max-Age=120
cache-control: no-store, no-cache, must-revalidate
Location: /ops/mcp-keys?created=cmk_f8467e81
```

Every claimed attribute is present and exact, `Secure` included, because the server runs with
`NODE_ENV=production`. The redirect carries `created` and nothing else, and its value matches
`^cmk_[0-9a-f]{8}$`; no whole token appears in it.

Note for the record, because it surprised me and is not in the slice description: the address bar a
second later reads `http://localhost:3041/ops/mcp-keys` with no query at all.
`components/ui/toast.tsx:23-31` strips its own notice parameter with `history.replaceState` once the
toast is painted, so the public prefix leaves the URL and the browser history by itself. That is a
good property; it also means the address bar is not the evidence, the `Location` header is.

**Reveal, consume, dismiss.**

- the token is on screen, in the drawer, rendered by the server;
- the panel called `POST /ops/mcp-keys/reveal/consume`, which answered **204** with
  `mcp_token_reveal=; Path=/ops/mcp-keys; HttpOnly; SameSite=Strict; Secure; Max-Age=0`, the same
  attribute set with a zero age, which is what a browser needs to drop it;
- the cookie is gone from the jar (`corgi_session` is the only one left);
- the token is **still on screen** after the consume, and `Done` is enabled only then
  (`disabled === false` measured after the answer);
- a reload of `?created=<prefix>` shows **no token and no drawer**;
- `Done` lands on `/ops/mcp-keys` with no query and no token, and no reveal cookie is left.

The token appears 4 times in the HTML of the reveal render: the `<code>` block, the `claude mcp add`
command beside it, and twice in the React flight payload of the same response. That response is
`private, no-cache, no-store, max-age=0, must-revalidate` (measured on the built server), so nothing
caches it; it is the same secret in the same answer, not a second exposure.

**The endpoint.** `tools/list` with the new token: **200**. Then a fresh key inserted directly by
SQL on the disposable database with `expires_at` one hour in the past, and the live token revoked
through the row menu. The four refusals, headers minus `date` sorted and compared byte for byte:

```
401
connection: keep-alive
content-type: application/json
keep-alive: timeout=5
transfer-encoding: chunked
vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch
www-authenticate: Bearer realm="corgi-mcp"
{"error":"unauthorized"}
```

identical for **expired, unknown, missing and revoked**. A caller cannot tell them apart.

`mcp_calls`, the four rows of those refusals:

| prefix | outcome | detail |
|---|---|---|
| `cmk_f8467e81` | `unauthorised` | `revoked key` |
| null | `unauthorised` | `no bearer token` |
| null | `unauthorised` | `unknown key` |
| `cmk_8683cbc0` | `unauthorised` | `expired token` |

`unauthorised` is one of the four values migration 0018 constrains
(`CHECK (outcome = ANY (ARRAY['ok','refused','error','unauthorised']))`, read back from
`pg_constraint` on the disposable database), so nothing new was added to that column and the
console's counts keep their meaning. The reason lives in `detail`, which is where an operator reads
it.

**Revoke through the row menu** produced the toast `Token revoked  It answers 401 from now on.`, a
sentence and not the bare value `1` that the earlier audit found, and the token answered 401
immediately afterwards.

**Every URL visited** was printed (44 navigations, kept in `urls.txt`). None carries a whole token:
the only `cmk_` values in any URL are the 8-hex public prefixes in `?created=` and in
`?inspect=`. The error redirect carries the refusal sentence, which is not a secret.

**Schema facts, read back from the disposable database.**

- `mcp_api_keys.expires_at`: `timestamp with time zone`, `is_nullable = YES`, no default.
- Its comment is the one the migration writes.
- The four triggers of 0018 are all present and enabled: `mcp_api_keys_are_append_only`,
  `mcp_api_keys_cannot_be_truncated`, `mcp_api_keys_agent_is_never_an_approver`,
  `mcp_api_keys_created_at_is_server_set`.
- `app_runtime` holds **SELECT and INSERT only** on `mcp_api_keys`, `mcp_calls` and
  `mcp_key_revocations`. No UPDATE, no DELETE. The table-level grant of 0018 covers the new column,
  as the migration says, and I confirmed the runtime role can write it (the flow created tokens
  through the application, which uses that role).

## 3. Roles

| Actor | Target | Answer |
|---|---|---|
| `approver@example.com` | `GET /ops/mcp-keys` | **307 to `/ops`** (F-INT-01 holds: the approver never sees the screen) |
| `approver@example.com` | `POST /ops/mcp-keys/reveal/consume` | **403** |
| `broker@example.com` | `GET /ops/mcp-keys` | 307 to `/broker` |
| `broker@example.com` | `POST /ops/mcp-keys/reveal/consume` | **403** |
| signed out | `POST /ops/mcp-keys/reveal/consume` | **401** |
| signed out | `GET /ops/mcp-keys` | 307 to `/login` |
| any | `GET`, `PUT`, `DELETE` on the consume route | **405** |

The activity log rows for those refusals name the actor and the rule and carry no cookie and no
token:

```
"route":"/ops/mcp-keys/reveal/consume","actorRole":"staff_approver","outcome":"refused","rule":"maker-checker","statusCode":403
"route":"/ops/mcp-keys/reveal/consume","actorRole":"broker","outcome":"refused","rule":"maker-checker","statusCode":403
"route":"/ops/mcp-keys/reveal/consume","actorKind":"anonymous","outcome":"refused","rule":"sign in","statusCode":401
```

**The agent-never-approver trigger, through the screen.** Creating an *agent* token for
`approver@example.com` from the New token drawer is refused, and the sentence the reader is given is,
word for word:

> mcp key: an agent principal cannot hold a staff_approver key; agents never approve money out

The redirect is a 303 to `/ops/mcp-keys?error=<that sentence>`, the same error path as before this
slice, and `select count(*) from mcp_api_keys key join users u on u.id = key.user_id where
u.email = 'approver@example.com' and key.principal_kind = 'agent'` returns **0**.

## 4. `npm run check:mcp`

Its guard is not on an environment variable: `scripts/check-mcp.ts:184-188` reads
`select current_database()` and refuses anything whose name is not the literal string `corgi_test`.
There is therefore no way to point it at a differently named disposable database, so this one run
was made against `corgi_test`, which is the project's disposable database and is **not** the trial
one, with a built server on the verified-free port 3341 (`MCP_BASE_URL=http://localhost:3341 npm run
check:mcp`). Run once, as the contention rule requires.

```
exit=0
ALL CHECKS PASSED
```

97 `PASS`, 0 `FAIL`. The assertions this slice added or changed:

```
PASS  A STAFF APPROVER CANNOT CREATE AN MCP KEY: POST /api/mcp-keys refuses the session and writes no key
      (303 /ops/mcp-keys?error=only staff operations can manage access tokens)
PASS  no key, a wrong key, a REVOKED key and an EXPIRED token all answer 401  (401, 401, 401, 401)
PASS  the four 401s are identical: a caller cannot tell a revoked or expired token from a typo  ({"error":"unauthorized"})
PASS  and the audit row of each says which it was, against the key that presented it
      (expired: unauthorised/expired token, revoked: unauthorised/revoked key)
PASS  the four 401s are in the log, and the revoked and expired ones name the key that made them
      (138 unauthorised calls, 49 of them naming a key)
```

The last figure is a whole-table count on a shared database and proves only the `>= 4` bound the
assertion states; the per-key rows in section 2 are the tighter evidence and were measured on my own
database.

## 5. Redaction

`npx tsx --test lib/observability/redact.test.ts`: **10 tests, 10 pass, 0 fail.** The two new ones
cover the cookie header and a whole token in a free-text line, and both assert on the absence of the
secret rather than on the shape of the mask, which is the right way round.

The rule that masks the cookie is built from `TOKEN_REVEAL_COOKIE` itself
(`lib/observability/redact.ts:43`), so renaming the cookie cannot leave the rule behind. The order in
`redact()` puts the cookie rule before the token rule, which is what keeps `mcp_token_reveal=****`
from becoming `mcp_token_reveal=cmk_xxxxxxxx_****`.

**The stronger evidence is that nothing needed redacting.** Grepping the built server's whole
stdout and stderr for the duration of the flow (46 lines, every request logged as one JSON object):

- whole tokens (`cmk_[0-9a-f]{8}_[A-Za-z0-9_-]{20,}`): **0**
- any `cmk_` string at all: **0**
- `mcp_token_reveal`: **0**

`grep -rn presentedKey app/ lib/mcp/` confirms why: the secret exists in exactly three places, the
generator, the `Set-Cookie` header and the server-rendered `<code>`, and reaches no logging call.
There is no `console.*` in any of the five files this slice added or rewrote.

## 6. withActivity inventory

Method: count the exported handler wrappers, `grep -rn "= withActivity(" app | wc -l`, because
`withActivity` also appears in its own definition and in imports.

- `origin/main`: **38** (`git grep -c "= withActivity(" origin/main -- app`, summed)
- `ui-evening-2` at 0fadcfa: **39**

Delta **+1**, and the one new line is `app/ops/mcp-keys/reveal/consume/route.ts`. The builder's
figure of 39 is right. Nothing else on the branch added or removed an instrumented handler, so no
route slipped out of the activity log while the batch was being written.

## 7. Screens

1440 and 1024 screenshots taken as `ops@example.com` on the built server, of `/ops/mcp-keys`,
`?new=1`, `?view=connect`, plus the reveal state captured during the flow. Read, not just saved.

- **One-line band, no chip row.** Band height 69 px at both widths, `chipsInBand = 0` on all three
  views. The two tiles ("Active tokens", "Used by an agent") sit under the band, which is what the
  decision asked for.
- **Table columns exactly as claimed**: `Name`, `Account`, `Expires`, `Last used`, `Status`,
  `Actions`. Footer `5 tokens`, toolbar `5 of 5`.
- **The drawer is over the content**, not beside it: `z-index: 40`, its left edge inside `main`,
  measured on `?new=1` at both widths.
- **Tokens never break mid-word in the table.** The name is one line with the whole value in
  `title`; the prefix under it is the clickable reference and never wraps. In the reveal panel the
  secret does wrap, deliberately and only there (`.lists-snippet.lists-token { white-space:
  pre-wrap; word-break: break-all }`), so the whole value is on screen; the `claude mcp add` command
  beside it scrolls instead. That is the right way round: the value somebody must copy in the next
  two minutes is whole, the command that repeats it is not.
- **Search** finds a token by a fragment of its name and by its full public prefix, and answers
  "No token matches this search" for nonsense.
- **375.** `BASE=http://localhost:3041 ROLE=ops@example.com WIDTHS=375 OUT=review-tokens-375
  PATHS="/ops/mcp-keys,/ops/mcp-keys?view=connect" node break.mjs`:

```
ops_mcp-keys @375 plain: 375x1880 band=109
ops_mcp-keys @375 folds open (2): 375x2476 band=109
ops_mcp-keys @375 popover: popover ok
ops_mcp-keys @375 inspector: rendered for /ops/mcp-keys?inspect=cmk_e13734fe
ops_mcp-keys_view_connect @375 plain: 375x1181 band=109
ops_mcp-keys_view_connect @375 folds open (2): 375x6737 band=109
```

**No HORIZONTAL OVERFLOW line, on either path, in any state**, including with the two
5000-character labels of finding F-TK-01 in the table: the table scrolls inside its own container
and the document does not. The two `BAND NOT STICKY` lines the script reports are not this slice's:
a control run on `/ops/approvals` and `/ops/policies` at the same width reports the same thing, so
it is the workspace's behaviour at 375. The band is 109 px here against 68 px there, because two
action buttons ("Connect", "New token") wrap under the title at that width; it is under the
script's 120 px threshold and reads correctly in the screenshot.

## 8. Hostile input

Sent from node with a real `staff_ops` session so the redirect is visible rather than opaque.

| Input | Answer |
|---|---|
| `GET ?q=<2000 characters>` | 200, no 500, no token |
| `GET ?created=cmk_notaprefix` | 200, no drawer |
| `GET ?created=<script>alert(1)</script>` | 200, escaped, no script node injected |
| `GET ?view=nonsense` | 200 (falls back to the tokens view) |
| `GET ?inspect=<500 characters>` | 200 |
| `POST expiresIn=abc` | 303 `?error=that is not one of the expirations this screen offers` |
| `POST expiresIn` missing | 303, same sentence |
| `POST` no `userId` | 303 `?error=that is not a user id` |
| `POST userId=../../etc/passwd` | 303, same sentence |
| `POST label="   "` | 303 `?error=a key needs a label, so a person can tell it apart from the others` |
| `POST principalKind=root` | 303 `?error="used by" must be a person or an agent` |
| `POST action=explode` | 303 `?error=unknown action "explode"` |
| `POST action=revoke keyId=not-a-uuid` | 303 `?error=that is not a key id` |
| `POST action=dismiss` with no cookie set | 303, clears a cookie that is not there, harmless |
| `POST label=<5000 characters>` | **303 `?created=cmk_e13734fe`: accepted** (F-TK-01) |
| `POST action=<5000 characters>` | 303, `Location` 5045 characters long (F-TK-05) |

Never a 500, never a secret in a refusal, never a secret in a `Location`. A forged
`mcp_token_reveal=not-a-key-at-all` with a matching-looking `?created=` renders no panel and does not
echo the cookie value.

## 9. Repository checks

- `npm run typecheck`: **exit 0**.
- `npm test`: **541 tests, 540 pass, 1 skipped, 0 fail**.
- `npm run build`: **exit 0**. The route list carries the new handler:

```
├ ƒ /api/mcp-keys
├ ƒ /ops/mcp-keys
├ ƒ /ops/mcp-keys/reveal/consume
```

## Requirement matrix

| Requirement | Control / code | Evidence | Status |
|---|---|---|---|
| AF-03: no UPDATE or DELETE on protected rows | 0026 adds one nullable column, drops nothing; 0018 triggers intact; `app_runtime` has SELECT and INSERT only | schema read back on the disposable database; 0 UPDATE/DELETE on an added line in the whole branch diff | PASS |
| AF-03: a column never changes meaning (F-B9-09) | `expires_at` is nullable, null means "no end date", which is what every pre-0026 row already meant | migration comment plus `tokenHasExpired(null, now) === false` unit test | PASS |
| AF-05: no secret committed | gitleaks over `524488f..0fadcfa`, 28 commits, no leaks | command output | PASS |
| AF-05: no secret in a log, a URL or a cache | 0 `cmk_` and 0 `mcp_token_reveal` in the server output for the whole flow; `Location` carries the public prefix only; the page is `no-store` | section 5, section 2 | PASS |
| AF-05: redaction if one ever slips | `redact` masks the cookie by name and any whole `cmk_` value to its prefix | 10/10 tests | PASS |
| MCP-01: one refusal for every bad token | expired, unknown, revoked and missing share status, headers and body byte for byte | section 2 | PASS |
| MCP-01: the operator can still tell them apart | `mcp_calls.detail`, `outcome` unchanged at `unauthorised` | four rows quoted | PASS |
| Maker-checker (F-INT-01): the approver touches no token | screen redirects to `/ops`, `POST /api/mcp-keys` refuses, consume route 403 | section 3 | PASS |
| Agent tokens never for an approver | 0018 trigger, surfaced as a sentence | section 3, count 0 | PASS |
| The secret is shown once | cookie consumed after paint, `Done` and a 120 s ceiling as backstops | section 2 | PASS, with F-TK-06 |
| Documentation reflects the implementation (AGENTS.md completion gate) | nothing under `README.md` or `docs/` changed on the branch | `git diff --stat -- README.md docs/` is empty; README line 64 still says a key never expires, at 0fadcfa and at fdb1b36 | **FAIL** (F-TK-04) |

## Findings

### F-TK-04 (MEDIUM): the README states, as fact, two things this slice made false

`README.md:64`, unchanged on the branch and unchanged at the current head `fdb1b36`:

> A wrong or revoked key answers 401 with no detail. [...] **An MCP key never expires. Revoking it
> on /ops/mcp-keys is the only thing that ends it**, and a revocation is a new row, never an update.

Both sentences are now wrong: an expired token gets that same 401, and expiry ends a token without
any revocation. The README is the document a reviewer reads before the code, and `AGENTS.md` makes
"documentation reflects the implementation" part of the completion gate; a delivery document that
contradicts the shipped behaviour on an authentication rule is not cosmetic, which is why this is
MEDIUM and not LOW. `docs/reviews/b11-mcp.md` still carries **F-B11-07 as OPEN** ("A key never
expires; revocation is the only end, and neither the README nor the screen says so"), which this
slice in fact closes, so the register understates the build in the other direction.

Trigger: read `README.md` at `fdb1b36`. Evidence: `git show fdb1b368:README.md | sed -n 64p` still
matches both `never expires` and `401 with no detail`.

Required correction: rewrite that passage (expired and revoked both answer the same 401 with no
detail; a token carries an expiry chosen at creation from 7 days, 30 days, 90 days, 1 year or never,
default 90 days, written once and never moved; extending means creating another token), name
migration 0026 and `app/ops/mcp-keys/reveal/consume/route.ts` in the MCP-01 row of
`docs/COMPLIANCE-MATRIX.md`, and close F-B11-07.

### F-TK-01 (LOW): the create route writes an unbounded label into an append-only table

`app/api/mcp-keys/route.ts:89` passes `String(form.get("label") ?? "")` straight to `createApiKey`.
`lib/mcp/keys.ts:121` refuses only an empty label. `db/migrations/0018_mcp_api_keys.sql:76` declares
`label text not null` with no length check. Every other field on the same POST is checked against a
closed set: `isTokenLifetime` for the expiry, an explicit pair for `principalKind`, `isUuid` for the
account and for the key id.

Trigger: `POST /api/mcp-keys` with `label` of 5000 characters, as `staff_ops`.
Observed: `303 /ops/mcp-keys?created=cmk_e13734fe`, and
`select count(*) from mcp_api_keys where length(label) > 400` returns the rows.
Consequence: the row is permanent. `mcp_api_keys` is append-only by trigger and the runtime role has
no UPDATE and no DELETE, so a mistyped or hostile name can never be corrected, only revoked and
replaced. On screen it is clipped to one line (no overflow, see section 7), but the whole value goes
into the `title` attribute and into the row menu's `aria-label`, so a screen reader reads all 5000
characters.
Required correction: bound the label the way the other fields are bounded, in both places: a
`check (char_length(label) between 1 and 120)` in a new migration (additive, no column redefined),
and the same bound in the route so the person is given a sentence instead of a constraint error.

### F-TK-06 (LOW): `?created=` promises a token that is not there

`app/ops/mcp-keys/page.tsx:126` registers the `created` toast from the query alone, while the drawer
at line 161 needs the query **and** a cookie whose prefix matches. The two conditions are not the
same, so a `?created=` with no matching cookie draws a green toast reading

> **Token created** — Copy it now. It is shown once and never stored.

with nothing on screen to copy.

Trigger, measured three ways on the built server:
`GET /ops/mcp-keys?created=cmk_f8467e81` after the consume (a plain reload) → 200, toast present,
`lists-token-panel` absent; `GET /ops/mcp-keys?created=cmk_nosuchkey` (a prefix that belongs to no
token at all, anyone can type it) → same; `GET /ops/mcp-keys` → no toast, correctly.

The mechanism matters more than the reload. The cookie name is a single constant
(`lib/mcp/token-reveal.ts:14`), so two creations from the same browser share one slot: if a second
tab posts before the first has painted, the first tab reads the second tab's cookie, `keyPrefixOf`
does not match its own `?created=`, and **the first token's secret is lost for ever** while the
screen still says it was created and should be copied now. The row exists, is unusable, and can only
be revoked. It fails closed, which is why this is LOW and not MEDIUM: no wrong secret is shown and
nothing leaks. I reproduced the observable end state (toast without token), not the two-tab race
itself.

Required correction: draw the toast from the same condition as the panel, and when `?created=` is
present with no matching cookie say what actually happened, in one sentence, with the action: this
token can no longer be shown, revoke it and create another. Scoping the cookie name by prefix
(`mcp_token_reveal_<prefix>`) would close the race as well, at the cost of a second cookie to clear.

### F-TK-02 (LOW): "1 calls"

`app/ops/mcp-keys/page.tsx:320`, `{token.callCount} calls`. The expired row in the 1440 screenshot
reads `1 calls`. The same shape appears on the tile note (`3 calls recorded in all`, correct only by
luck of the count).
Required correction: one plural helper, used here and on the tile.

### F-TK-03 (LOW): the Account option says the role twice

`app/ops/mcp-keys/page.tsx:416` renders `{holder.display_name}, {holder.role}` while five of the six
seeded display names already end in their role. The New token drawer at 1024 therefore offers
"Dana Ruiz, broker, broker"; the list also holds "Sam Patel, operations, staff_ops" and "Alex Kim,
approver, staff_approver".
Evidence: `select display_name, role from users order by role, display_name` on the disposable
database, beside the screenshot.
Required correction: show the display name alone, or the display name and the role only when the
name does not already carry it. Related, and a judgement call rather than a defect: the default
selection is the first option, which is a broker, because the query orders by role and `broker`
sorts first.

### F-TK-05 (LOW): caller input is echoed unbounded into the redirect URL

`app/api/mcp-keys/route.ts:117`, `backToKeys(\`unknown action "${action}"\`)`, is the only sentence
on this route built from what the caller sent; the other eight are fixed strings. A 5000-character
`action` produces a 5045-character `Location` header.
Observed: `303`, `Location` length 5045. Nothing breaks: the page escapes the value (a `<script>`
payload renders as text, no node injected) and `redact` cuts the activity message to 300 characters
before the insert, under the 500 the column allows. But a URL that long is copied into proxy logs
and referrers by things this application does not control, for no benefit.
Required correction: answer `unknown action` with no echo, or bound the echo to a short slice.

## Register lines for `docs/reviews/FINDINGS.md`

```
| F-TK-01 | LOW | The create route writes an unbounded label into append-only mcp_api_keys; every other field on the POST is checked against a closed list | Bound the label in a new additive migration and in the route | OPEN |
| F-TK-02 | LOW | "1 calls" on the Last used cell and on the agent tile | One plural helper for both | OPEN |
| F-TK-03 | LOW | The New token account option repeats the role: "Dana Ruiz, broker, broker" | Show the display name alone, or add the role only when the name lacks it | OPEN |
| F-TK-04 | MED | README line 64 still says an MCP key never expires and that only revocation ends it, and that only a wrong or revoked key answers 401; F-B11-07 is still OPEN though this slice closes it | Rewrite the passage, name 0026 and the consume route in COMPLIANCE-MATRIX MCP-01, close F-B11-07 | OPEN |
| F-TK-05 | LOW | `unknown action "<caller input>"` is echoed unbounded into the redirect URL (5045 characters measured) | Answer with a fixed sentence, or bound the echo | OPEN |
| F-TK-06 | LOW | `?created=` alone draws "Token created, copy it now" with no token on screen; one cookie name means two tabs racing lose the first secret silently | Draw the toast from the same condition as the panel and say the token can no longer be shown | OPEN |
```

## Docs of record that need a line

1. **`README.md:64`** — the two false sentences of F-TK-04, plus the screen's new name ("Access
   tokens", `components/shell/sections.tsx`; the route stays `/ops/mcp-keys`).
2. **`docs/COMPLIANCE-MATRIX.md`, row MCP-01** — the control column should say a token also ends on
   its own expiry; the code column should name `db/migrations/0026_mcp_key_expiry.sql` and
   `app/ops/mcp-keys/reveal/consume/route.ts`; the evidence column still reads `check:mcp 58/58`
   against the 97 assertions that ran today.
3. **`docs/reviews/b11-mcp.md`** — F-B11-07 (lines 172 and 509) is closed by this slice; append the
   resolving commit rather than overwriting the row.
4. **`docs/reviews/FINDINGS.md`** — the six lines above.
5. **`docs/STATUS.md`** — an entry for the slice: migration 0026, the reveal cookie, the consume
   route, the four identical 401s, `check:mcp` 97/97, this review's verdict and its open findings.
6. **`docs/handoffs/b13-2-notes.md:50`** quotes the stale README sentence in the present tense. It
   is a historical note, so a dated qualifier is enough; it should not be silently rewritten.
7. **`docs/DECISIONS.md`** — Yoann's decision of 2026-09-09 (a token expires, 90 days by default,
   five lengths, written once, extending means creating another) is cited in three code comments and
   in the migration but I found no matching entry in the decision log. If it is there under other
   words, this item falls away; if not, the code is citing a decision the log does not carry.

## Checks executed, and checks not executed

Executed: everything quoted above. Migrations 0001 to 0026 on a disposable database; seed; build;
typecheck; the full unit suite; the redaction suite alone; the Playwright create/reveal/consume/
dismiss/revoke flow on the built server in production mode; the four-way byte comparison of the
401s; the `mcp_calls` rows behind them; direct SQL insertion of an expired key; role probes for four
actors and four verbs; sixteen hostile inputs; `check:mcp` once; the 375 break run plus a control on
two other screens; 1440 and 1024 screenshots read, not merely taken; schema, trigger and privilege
read-back; gitleaks over the range; the withActivity count on both sides.

Not executed, and why:

- **Nothing on the deployed application.** This review is of a branch head that is not deployed;
  AF-01 is a delivery gate and is **NOT RUN** here. A localhost measurement is not a deployment
  claim.
- **No provider call.** Nothing in this slice touches Stripe, Sumsub or Persona, so AF-02 and AF-04
  are **not applicable to this scope**, not passed by it.
- **The two-tab race of F-TK-06** was reasoned from the single cookie constant and confirmed only in
  its observable end state, not raced live.
- **Load and concurrency.** `STRESS-TEST-PLAN.md` profiles were not run: this slice adds one
  204-answering route and one nullable column, and no performance claim is made about it.
- **The other slices on the branch** (previews, signed colours, statements, illustrations, Billing
  view). Out of scope; I checked only that they touch no token, key, MCP or money path.
- **Candidate understanding.** Not assessable by a reviewer. `AUTOMATIC-FAILS.md` AF-06 stays
  **QUESTIONS OPEN** until Yoann explains this slice back: the parts worth asking about are why the
  secret rides in a cookie rather than the URL, why a server component cannot clear it, why the
  expiry is written once rather than updated, and why an expired token gets the same 401 as a typo.

## Verdict

**FAIL**, on F-TK-04 alone.

The engineering is sound and I could not break it. The migration is additive and leaves every
append-only guarantee of 0018 standing; the runtime role still cannot update or delete a key row;
the four refusals are byte-identical to a caller and fully distinguished to an operator; the secret
travels in a cookie that is httpOnly, Secure, `SameSite=Strict`, scoped to one path and consumed the
moment it is painted, with two independent backstops; it reaches no log, no URL and no cache;
sixteen hostile inputs answer with a sentence and none with a 500 or a secret; the approver is kept
out of the screen, the route and the consume handler; and typecheck, 540 tests, the build and 97
`check:mcp` assertions all pass.

What fails is the delivery gate, not the code. `AGENTS.md` requires documentation to reflect the
implementation before a feature is done, and the README still tells a reader, as a plain statement
of fact, that an MCP key never expires and that revocation is the only thing that ends it, on the
head that ships the expiry. `docs/reviews/b11-mcp.md` still carries the matching finding as OPEN.
That is a two-paragraph correction, not a code change, and the verdict flips to PASS as soon as it
is made and the four LOW findings are either fixed or disclosed. F-TK-01 is the one I would fix
rather than disclose: an unbounded write into a table that can never be corrected is the kind of
thing that is cheap now and impossible later.

Residual limitations: this is a scoped engineering assessment of one slice at one revision on
localhost, not a statement about the deployed system, not exhaustive, and not a legal or compliance
certification.

## Disposable database

`corgi_rev_tk` was created for this review on the same Neon server as the trial database, migrated,
seeded, used for every measurement in sections 1, 2, 3, 5, 7, 8 and 9, and **dropped at the end of
the review**. Section 4 alone ran against `corgi_test`, the project's standing disposable database,
because `scripts/check-mcp.ts` pins that literal name; it was left in place, as it is shared. The
trial database was never written to.

---

# Re-review, 2026-09-09 20:45Z to 21:00Z

Everything above is preserved as it was written. This section is appended, not merged into it.

Re-reviewed head: `ui-evening-2` at **4862317** ("Merge access tokens: review fixes F-TK-01 to
F-TK-06"), which carries **32025f0** ("ui(mcp): review fixes F-TK-01 to F-TK-06 on the access tokens
screen", on `worktree-agent-a96f6764f2434bb97` on top of `a29beef`). Merged into this worktree with
`git merge ui-evening-2` at `ae7f647`. Nothing was fixed, edited or committed by the reviewer.

**The fix diff is two files and nothing else**: `app/api/mcp-keys/route.ts` (+18) and
`app/ops/mcp-keys/page.tsx` (+68, -18). `git diff 0fadcfa ae7f647 --stat` restricted to the slice's
directories returns exactly those two. **No migration was added** (`git diff --name-status 0fadcfa
ae7f647 -- db/` is empty), and no em or en dash was introduced (`grep -cP '^\+.*[\x{2013}\x{2014}]'`
over `git show 32025f0` returns 0). `gitleaks detect --log-opts "524488f..4862317" --redact`: **55
commits scanned, no leaks found**.

Environment, exactly as before and freshly built for this head: a new disposable database
`corgi_rev_tk2` on the same Neon server, migrated 0001 to 0026 and seeded; `npm run build`; a built
server under `NODE_ENV=production` on port **3441**, verified free before starting (`lsof`) and with
no `EADDRINUSE` in its log, so nothing this time reached another session's server. Stopped by its
port's PID. The trial database was never written to.

## Per-finding outcome

| ID | Severity | Outcome at 4862317 |
|---|---|---|
| F-TK-01 | LOW | **RESOLVED at the browser path**, database constraint deferred with a written reason (residual below) |
| F-TK-02 | LOW | **RESOLVED**, exercised at 0, 1, 2 and 3 |
| F-TK-03 | LOW | **RESOLVED** for the duplication reported; a near-duplication remains on two staff names (observation) |
| F-TK-04 | MEDIUM | **OPEN**, and correctly so: it is the coordinator's docs commit and is not on this branch |
| F-TK-05 | LOW | **RESOLVED** |
| F-TK-06 | LOW | **RESOLVED** |

### F-TK-01: the label bound

`app/api/mcp-keys/route.ts:87-96` now trims the label and refuses anything outside 1 to 120
characters before `createApiKey` is reached, with a sentence. Measured on the built server, as
`staff_ops`:

| Label | Answer |
|---|---|
| 1 character | 303 `?created=cmk_649354b2` |
| 120 characters | 303 `?created=cmk_39496cc7` |
| 120 characters padded with spaces | 303 `?created=cmk_89d8a702` (trimmed, then accepted) |
| 121 characters | 303 `?error=a label is one to 120 characters` |
| 5000 characters | 303 `?error=a label is one to 120 characters` |
| three spaces | 303 `?error=a label is one to 120 characters` |
| empty | 303 `?error=a label is one to 120 characters` |

`select max(char_length(label)) from mcp_api_keys` on the disposable database after the whole run:
**120**. The activity log carries the fixed sentence and nothing the caller sent.

**The residual, and why I accept it.** The builder did not add the `CHECK` constraint I asked for,
and says why in the code, in a comment a reader will meet at the line that needs it: adding one
tonight means a migration against the trial database on the evening of a freeze. That is a real
operational risk against a small one, and the trade is written down rather than silently taken. I
verified the claim the comment rests on: `grep -rn "createApiKey(" app scripts lib` returns exactly
three callers, `app/api/mcp-keys/route.ts` (now bounded), `scripts/check-mcp.ts` (literal labels)
and `scripts/create-mcp-key.ts`. So **the only browser-reachable path is bounded**, and the residual
is an operator typing an unbounded `--label` into a local CLI, which is a typo by Yoann, not a
hostile input. The week-two line should be written down where week-two lines live: `README.md:149`
lists two week-two items and this is a third.

### F-TK-02: the counts

A `plural` helper at `app/ops/mcp-keys/page.tsx:396`. I did not take its existence as evidence; I
drove the counts. Two tokens were planted directly and given one and two calls, and a third expires
in three days:

```
call counts on the rows: ["3 calls","2 calls","1 call","0 calls"]
expiring note:           2 tokens expiring within 7 days   (and "1 token expiring within 7 days" when one)
recorded-in-all note:    8 calls recorded in all
footer:                  11 tokens
```

The rendered text contains no `1 calls` and no `1 tokens`. The tile note also changed shape, from
"1 expire within 7 days" to "1 token expiring within 7 days", which reads.

### F-TK-03: the account option

`accountOption()` at `app/ops/mcp-keys/page.tsx:405` appends the role only when the display name
does not already end with it. The options the drawer actually renders:

```
"Dana Ruiz, broker", "Marco Silva, broker", "Priya Nair, broker",
"Bay Area Fabrication LLC, customer",
"Alex Kim, approver, staff_approver", "Sam Patel, operations, staff_ops"
```

`Dana Ruiz, broker, broker` is gone, which is what was reported. **Observation, not a finding:** the
two staff names still say their role twice in plain English, because "operations" is not the string
`staff_ops` and "approver" is not `staff_approver`, so the `endsWith` test does not catch them. The
rule is defensible (the second half is the literal role value the database stores, which an
operator may want to see) and I am not reopening the finding on it; it is worth one line to Yoann so
the choice is his.

### F-TK-05: the unknown action

`app/api/mcp-keys/route.ts:128` now answers a fixed `unknown action`.

```
action=explode       -> 303 /ops/mcp-keys?error=unknown action  (36 characters)
action=<5000 chars>  -> 303 /ops/mcp-keys?error=unknown action  (36 characters)
```

The `Location` is the same 36 characters whatever the caller sends. The longest `message` in the
whole server log for this run is now 104 characters (the database trigger's own sentence), against
the 300-character truncated echo the old code produced.

### F-TK-06: `?created=` no longer promises a token that is not there

`createdButGone` at `app/ops/mcp-keys/page.tsx:138` is `createdPrefix !== null && revealed === null`,
and the `created` toast rule is now added to `toastsFromQuery` only when `revealed` is non-null.
Measured:

| Request | Sentence | Toast | "Copy it now" |
|---|---|---|---|
| `?created=cmk_nosuchkey` (an invented prefix) | yes | **no** | **no** |
| `?created=<a real prefix>` after the consume | yes | **no** | **no** |
| `/ops/mcp-keys` plain | no | no | no |
| the real create flow, cookie present | **no** | **yes** | **yes**, with the panel |

The sentence renders above the tiles as `This token can no longer be shown. Revoke it and create
another.` (screenshot `created-gone-1440.png`), with an empty `.toaster`.

**The cookie name is unchanged, and the reason holds.** The builder chose not to scope it by prefix
and wrote why: the name is what the redaction rule and the three clearing sites match on. I checked
that this is true rather than plausible. `lib/observability/redact.ts:43` builds its pattern from
`TOKEN_REVEAL_COOKIE`; a per-prefix name would turn that exact-name rule into a prefix rule, and
`clearedRevealCookie()` would have to be told which name to clear at all three sites
(`app/api/mcp-keys/route.ts` dismiss, `app/ops/mcp-keys/reveal/consume/route.ts`, and the create
path's overwrite), one of which no longer knows the prefix. That is a real change to the one
mechanism that keeps the secret out of the logs, on the evening of a freeze, to close a race between
two tabs of one browser. Taking the honest failure instead is the right call, and it is now an
honest failure rather than a silent one, which is what the finding asked for. Two observations, both
minor and neither reopening anything: with no toast to strip it, `?created=` now stays in the
address bar (a public prefix, not a secret); and pasting the prefix of a healthy token produces
"revoke it and create another" about a token that is fine, which only happens if somebody types it.

## No regression in what already passed

Everything re-run at 4862317 on the freshly built server and the new disposable database.

- **The reveal flow, unchanged.** `POST /api/mcp-keys` answers 303 with the one cookie
  `mcp_token_reveal=cmk_xxxxxxxx_****; Path=/ops/mcp-keys; HttpOnly; SameSite=Strict; Secure;
  Max-Age=120` and `no-store`; `Location: /ops/mcp-keys?created=cmk_0452760f` carries the public
  prefix and nothing else; the token is painted; the consume route answers **204** and clears the
  cookie with the identical attribute set and `Max-Age=0`; the cookie leaves the jar; the token
  stays on screen; `Done` is enabled only after the 204; a reload shows no token; `Done` returns to
  a clean `/ops/mcp-keys`. (The flow script then died on a navigation race of its own inside a
  `page.evaluate`; that is the script's fault, and the rest of its work was redone over HTTP.)
- **The four 401s are still byte-identical** for expired, unknown, missing and revoked: same status,
  same headers minus `date`, same `{"error":"unauthorized"}`. The `mcp_calls` rows still separate
  them: `expired token`, `revoked key`, `unknown key`, `no bearer token`, all `unauthorised`.
- **Revoking** through the route answers 303 `?revoked=1` and the screen says `Token revoked It
  answers 401 from now on.`
- **Roles**: approver 307 to `/ops` and 403 on the consume route; broker 307 to `/broker` and 403;
  signed out 401. The agent-token-for-the-approver refusal is unchanged, word for word, and no such
  row exists.
- **Redaction**: 10/10. The server's whole output for the run (49 lines) contains **0** whole
  tokens, **0** `cmk_` strings of any kind and **0** `mcp_token_reveal`.
- **Screens**: band 69 px and `chipsInBand: 0` at 1440 and 1024 on all three views; the six columns
  unchanged; the drawer over the content at `z-index: 40`; 0 dash characters. At 375, with a
  120-character label in the table, `break.mjs` reports **no HORIZONTAL OVERFLOW** on either path in
  any state; the two `BAND NOT STICKY` lines are the workspace's behaviour at that width, as the
  control run established in the first review.
- **Repository checks**: `npm run typecheck` exit 0; `npm test` **554 tests, 553 pass, 1 skipped, 0
  fail** (up from 541/540, from the other slices on the branch); `npm run build` exit 0 with
  `/ops/mcp-keys/reveal/consume` still in the route list.
- **withActivity is now 40, not 39**, and the extra one is **not this slice's**: diffing the file
  lists between 0fadcfa and this head, the single addition is
  `app/api/session/switch/route.ts`, from the demo-account switcher that arrived with another slice
  of the batch. This slice still contributes exactly one, the consume route.

`npm run check:mcp` was **not re-run**: its guard pins `current_database()` to the literal
`corgi_test`, the contention rule says a delegate runs a shared-database check at most once, and
nothing in this fix diff touches the endpoint, the key format, the expiry or anything that check
asserts on (the diff is two files, neither of them under `lib/mcp` or `app/api/mcp`). The 97/97 run
recorded above stands for this head.

## F-TK-04 stays OPEN

`README.md:64` at this head still says, verbatim, `A wrong or revoked key answers 401 with no
detail` and `An MCP key never expires. Revoking it on /ops/mcp-keys is the only thing that ends it`
(`git show ae7f647:README.md | sed -n 64p`). That is expected and correct process: the coordinator
owns the shared documents and is landing them as a separate docs commit, and a reviewer does not
edit them. The finding is not withdrawn and not weakened; it is simply not this branch's to close.
The docs list in the first review still stands, with one addition: `README.md:149`, the week-two
list, should gain the `CHECK` constraint on `mcp_api_keys.label` that F-TK-01's fix deliberately
deferred.

## Register lines, updated

```
| F-TK-01 | LOW | The create route wrote an unbounded label into append-only mcp_api_keys | Bounded to 1 to 120 characters at the route with a sentence; the CHECK constraint deferred to week two with a written reason | FIXED 32025f0, constraint OPEN for week two |
| F-TK-02 | LOW | "1 calls" on the Last used cell and on the agent tile | A plural helper on every count of the screen | FIXED 32025f0 |
| F-TK-03 | LOW | The New token account option repeated the role: "Dana Ruiz, broker, broker" | The role is appended only when the name does not already end with it | FIXED 32025f0 |
| F-TK-04 | MED | README line 64 still says an MCP key never expires and that only revocation ends it, and that only a wrong or revoked key answers 401; F-B11-07 is still OPEN though this slice closes it | Coordinator's docs commit, not on the branch | OPEN |
| F-TK-05 | LOW | `unknown action "<caller input>"` was echoed unbounded into the redirect URL | A fixed sentence, 36-character Location whatever is sent | FIXED 32025f0 |
| F-TK-06 | LOW | `?created=` alone drew "Token created, copy it now" with no token on screen | The toast is drawn only when the panel is; otherwise one sentence saying the token can no longer be shown | FIXED 32025f0 |
```

## New verdict

**PASS for the reviewed code at 4862317. The feature completion gate stays BLOCKED on F-TK-04,
which is the coordinator's to close and is not on this branch.**

The five findings I raised against the code are fixed, and I checked each one by driving the
behaviour rather than by reading the patch: the label is bounded and 120 is the longest string that
reached the table; the counts read "1 call" and "2 calls" because I made them one and two; the
account option says a role once; the refusal is 36 characters whatever the caller sends; and
`?created=` with no cookie now says what happened instead of telling a reader to copy something that
is not there. Nothing that passed the first time regressed: the reveal cookie carries the same six
attributes on a production build, the consume route still answers 204 and clears it, the four 401s
are still byte-identical, the roles still hold, no secret reaches the server output, and the screens
carry no overflow at 375 with the longest label the route now allows.

Two deliberate departures from my required corrections were taken with reasons written into the
code, and I checked both reasons rather than accepting them: the database `CHECK` on the label
(deferred, browser path bounded, three callers verified) and the single cookie name (kept, because
per-prefix names would rework the redaction rule and the three clearing sites; the race now fails
loudly instead of silently). Both are the smaller risk at this hour, and both are now written down.

The one thing between this slice and done is two paragraphs of README. Residual limitations are
unchanged from the first review: one slice, one revision, localhost, not the deployed system, not
exhaustive, and not a legal or compliance certification.

## Disposable database, re-review

`corgi_rev_tk2` was created on the same Neon server for this re-review, migrated 0001 to 0026,
seeded, used for every measurement in this section, and **dropped at the end**. `corgi_rev_tk` was
already dropped at the end of the first review. `corgi_test` was not touched this time. The trial
database was never written to.
