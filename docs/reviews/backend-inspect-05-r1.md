# Independent review, slice INSPECT-05: one sentence when nothing matches

Reviewer: independent reviewer sub-agent, working in the builder's worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/wf_bd4e916d-509-2` on branch
`inspect-05-sentence`. Written at 2026-09-09T21:01Z (clock read with `date -u`, never estimated).

Reviewed revision: **43358f73b2959425c9259caad1408a0f16aa3735**, one commit on top of `main` at
`40352c8`, read as `git diff 40352c8...HEAD`. The working tree was clean at the start of the
review and carries only this record at the end. No source file was modified by me, no branch was
switched, no worktree was created, nothing was pushed, nothing was merged, no migration was
applied, no money row was updated or deleted.

This is a scoped engineering assessment of one slice. It is not a legal certification and it is
not a statement that the six delivery gates pass for the whole submission.

## 1. Startup receipt

Read in full, in this order, before looking at any code: `CLAUDE.md`, `AUTOMATIC-FAILS.md`,
`AGENTS.md`, `READABLE-CODE.md`, `REVIEWER.md`.

Read for this scope: `docs/DECISIONS.md` (the entry of 2026-09-09T20:46Z carrying decisions 52 and
53, decision 42 which created this tool), `docs/reviews/FINDINGS.md` (the whole `F-INSPECT-*`
block, lines 571 to 597), `docs/reviews/backend-inspect-reference-r1.md` and
`backend-inspect-reference-r2.md` (the two rounds that raised and restated F-INSPECT-05), the
README "MCP surface" section (lines 55, 66, 74, 81, 83).

Code read at the reviewed SHA: `lib/mcp/tools/inspect-reference.ts` (the shape table, `shapeOf`,
`ACCEPTED_SHAPES_SENTENCE`, the whole `resolve` chain, the `run` method and `nothingMatches`),
`lib/mcp/tools/inspect-reference.test.ts` (new, all 84 lines), the `scripts/check-mcp.ts` diff and
its `InspectedFile` type and `inspect()` helper, `lib/mcp/scope.ts`
(`inspectionVisibilityRefusal`, `referenceInBookRefusal` and their two published sentences),
`lib/mcp/jsonrpc.ts` (`toolsListResult`, to check where the shape list is still published),
`lib/mcp/never-delegated.test.ts` (the `NEXT_PHASE` pattern the new test copies), `db/client.ts`
(why that flag is safe here), `.githooks/pre-commit`, `.gitignore`, `package.json`,
`tsconfig.json`.

Not read, and why: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`,
`GAP-REVIEW.md`. This slice changes one string and adds one unit test file; no retained control
beyond what `AGENTS.md` already requires of an MCP read tool applies to it. Absent files: none.

Acceptance criterion reviewed: decision 53 of 2026-09-09T20:46Z, on the `MCP-01` row of
`docs/COMPLIANCE-MATRIX.md` as extended by decision 42.

The assignment also listed an attack plan for a "New broker route" (role wall, transaction
atomicity, hash strength, cookie flags on a built server, the migration, `withActivity`). **None
of it was exercised, because none of it is in this branch**: `git diff 40352c8...HEAD --stat`
returns exactly three files, `lib/mcp/tools/inspect-reference.ts`,
`lib/mcp/tools/inspect-reference.test.ts` and `scripts/check-mcp.ts`. The New broker route is
decision 52 and belongs to another slice and another reviewer.

## 2. Applicability

One read-only MCP tool on the existing per-user-API-key surface of a Track 1 policy administration
application. Actors: an agent or a person holding an MCP key bound to one user (`broker`,
`customer`, `staff_ops`, `staff_approver`, `agent`). The change is a text change in an answer:
no money path, no rate, no tax rule, no eligibility gate and no approval gate is touched, so no
external legal source was consulted for this round. The applicable requirements are the trial's
own: non-negotiable 8 of the brief (MCP surface, authorization and tenant isolation on read
tools), `AGENTS.md` "Maker-checker and MCP", `AUTOMATIC-FAILS.md` AF-02 to AF-06,
`READABLE-CODE.md`, and decision 53.

## 3. Requirement matrix

| # | Requirement | Control and code location | Evidence I produced | Verdict |
|---|---|---|---|---|
| 1 | The miss answer is the exact sentence decision 53 names | `NOTHING_MATCHES_SENTENCE` in `lib/mcp/tools/inspect-reference.ts:538`, the single source of `whatThisMeans` in `nothingMatches` | Probe: `whatThisMeans="Nothing in this database matches that reference."` on both paths. Decision 53 reads "nothing in this database matches that reference". Byte-identical to the sentence the console already prints (`components/ui/inspector.tsx:79`) | PASS |
| 2 | Both ways of finding nothing answer the same sentence | One helper, two call sites (`shape === null` at line 492, `resolution.resolvedTo === "nothing"` at line 507) | Probe: an unaccepted shape ("not a reference at all") and a recognised shape with no row ("CGP-99998") return the same string, and `check:mcp` proves the same for an unknown `CGP-` and an unknown `pi_` over HTTP | PASS |
| 3 | The answer no longer carries the closed list of shapes | The concatenation with `ACCEPTED_SHAPES_SENTENCE` is gone from `nothingMatches` | `git diff` read line by line; the probe output contains neither `CGP-nnnnn` nor `pi_` | PASS |
| 4 | The list is still published where a client reads it | `ACCEPTED_SHAPES_SENTENCE` still used at lines 449 (description) and 475 (the `reference` schema); `annotations.acceptedReferenceShapes` publishes it a third time | `grep` for the constant returns three sites; `lib/mcp/jsonrpc.ts:189` puts `description`, `inputSchema` and `annotations` into `tools/list` | PASS |
| 5 | The visibility refusal is unchanged and still runs first | `inspectionVisibilityRefusal` is called before `shapeOf` and before any query (`run`, line 481, the refusal at line 486); `lib/mcp/scope.ts` is not in the diff | Probe: a `customer` key and an `agent` key are REFUSED for an unmatched reference and for an unaccepted shape alike, with the same sentence, never the new one. `check:mcp`: "A CUSTOMER KEY IS REFUSED inspect_reference ALTOGETHER, before any read" | PASS |
| 6 | The MCP key-prefix refusal is unchanged | The `mcp_key_prefix` branch is not in the diff | Probe on `cmk_1a2b3c4d`: REFUSED with "reading an MCP API key is never delegated to an agent". `check:mcp` asserts the same over HTTP | PASS |
| 7 | The change is tested | `lib/mcp/tools/inspect-reference.test.ts`, four tests, the first unit tests this tool ever had | `node --import tsx --test lib/mcp/tools/inspect-reference.test.ts`: 4 ok, 0 fail. Whole suite 539 tests, 538 pass, 0 fail, 1 skip | PASS |
| 8 | The test touches no database | A fake handle `(async () => [])` cast to `postgres.Sql`; `NEXT_PHASE=phase-production-build` so `db/client.ts:13` accepts a missing `DATABASE_URL_APP` and builds a pool on a placeholder string that is never dialled. Same flag and same reason as `lib/mcp/never-delegated.test.ts:14` | The suite runs with no database reachable and no `.env.local` loaded; the dynamic `await import` inside `loadInspectReference()` is what makes the flag land before the module is evaluated, which I confirmed by writing the naive static-import version and watching `db/client.ts` throw | PASS |
| 9 | The HTTP assertion is real | `scripts/check-mcp.ts:1180` compares `whatThisMeans` to the exact sentence for both unknown references, and prints it whole instead of a 90-character slice | Ran `check:mcp` once against a dev server on port 3800 on the disposable database: **ALL CHECKS PASSED**, including "AN UNKNOWN REFERENCE ANSWERS NOTHING MATCHES IN ONE SENTENCE, and is not an error (Nothing in this database matches that reference.)". **This closes the one item the builder reported as unverified.** | PASS |
| 10 | No other tool, README or doc needed a change | The diff touches one tool file; `grep` for the old sentence "Nothing in this system" returns nothing anywhere in the repository; README line 81 says "A reference that matches nothing answers a 'nothing matches' result rather than an error" and quotes no text | `grep` over `*.ts`, `*.tsx`, `*.md`, `*.json` | PASS |
| 11 | Reads only, no migration, no money row touched | No `db/migrations` file in the diff; the added lines contain no `insert`, `update`, `delete`, `truncate` or `drop` | Diff read line by line. `check:mcp` re-asserted "NO MONEY MOVED: 9 journal entries before, 9 after" on its own fixtures | PASS |
| 12 | Readable line by line | One named module-local constant, one helper, a comment that says WHY the list left and where it still lives, and an adjacent comment corrected in the same commit so it no longer describes the old behaviour | Read; the test file explains the two cases and the `NEXT_PHASE` flag in prose before the first assertion | PASS |

## 4. Findings

### F-INSPECT05-01 (MEDIUM) This commit does not close the finding F-INSPECT-05 that the register describes

The register entry (`docs/reviews/FINDINGS.md`, lines 575, 586 and 595) reads: "A broker key can
tell a reference that exists but is not its own (refusal) from one that matches nothing (answer),
so it can enumerate existence", with the required action "Yoann decides: accept and disclose in
the README, or answer 'nothing matches' in both cases", and the recommendation put to him at 20:35
local: "one sentence for both cases (a reference that is not the broker's and one that matches
nothing) so a broker key cannot probe existence".

Decision 53 as recorded is a different change: the miss answer becomes one sentence "instead of
the list of recognised shapes". The builder implemented decision 53 exactly. **The enumeration
channel is untouched and I verified it is still open.** `referenceInBookRefusal` and
`REFERENCE_NOT_IN_THIS_BOOK` are not in the diff, and the two outcomes a broker key can tell apart
are:

```
broker key, another broker's real reference  -> REFUSED "this reference is not in this key's own
                                                 book of business; ..."          (check:mcp, HTTP)
broker key, a reference that matches nothing  -> ANSWER  "Nothing in this database matches that
                                                 reference."                     (probe, in process)
```

Neither arm of the required action is implemented: the two cases still read differently, and the
README does not disclose that a broker key can probe existence (line 81 says the refusal "names
nothing about the reference, not its kind, not its number, not its owner", which is true of the
CONTENT and silent about the EXISTENCE signal).

Consequence if nothing is done: the register line F-INSPECT-05 gets marked FIXED against
`43358f7`, and a security finding that was never corrected disappears from the evidence trail.
That is the failure `AGENTS.md` forbids ("missing evidence remains visible").

Required correction, and it belongs to the coordinator and to Yoann, not to this builder: record
the text change under its own register line (decision 53) and **keep F-INSPECT-05 open**, or
obtain Yoann's explicit acceptance of the existence signal and add the one-sentence disclosure to
the README. Do not close F-INSPECT-05 on this commit.

### F-INSPECT05-02 (LOW) The two miss cases answer the same sentence, not the same answer

The handoff note says "the two cases the slice names answer identically". They do not, and the
difference is deliberate: `recognisedAs` is still `"a shape this tool does not accept"` in one case
and `"a policy number (CGP-nnnnn)"` in the other, verified in the probe output below. I consider
the retention correct (it is the same distinction the console fold explains to a human: a shape
that was recognised means a wrong environment or a typo, a shape that was not means a dead end),
and no test claims otherwise. Only the wording of the note overstates it. Required correction:
say "the same sentence" rather than "identically" wherever this slice is described, including in
`docs/STATUS.md`.

### F-INSPECT05-03 (LOW) The "one sentence" assertion is weaker than the two exact-string ones beside it

`inspect-reference.test.ts:75` proves sentence-ness with
`assert.equal(sentence.trim().split(". ").length, 1)`. That passes on `"One.Two."`, on a sentence
ending in `?`, and on anything joined without a following space. It is harmless today because the
two tests above it pin the string byte for byte, so nothing can drift past them. Required
correction, cheap and optional: count `/\./g` matches, or drop the assertion and rely on the exact
equality already asserted twice.

### F-INSPECT05-04 (INFO) The `InspectedFile` cast in check:mcp never described a miss

`scripts/check-mcp.ts:948` declares `belongsTo`, `moneyOperations`, `journalEntries`, `bounds` and
`sectionsThisKeyMayNotRead` as required fields and the answer to a miss carries none of them; it
is a `as unknown as InspectedFile` cast on parsed JSON, so the compiler never checked it. This was
already true before the slice and the builder's claim that "the type still matches" holds only for
the fields actually read (`whatThisMeans`, `found`, `resolvedTo`), which are present. No
consequence observed; the check passed over HTTP.

### F-INSPECT05-05 (INFO) One more set of fixtures on the shared `corgi_test`

This review ran `check:mcp` once, which appended another set of that check's fixtures to the
disposable database (two brokers with their users and keys, paid policies, a claim, a statement,
a planted `claims_rail` provider record of 777700 cents with its explanatory note, and the
`mcp_calls` rows of the session). Same lineage as F-INSPECT-07. Another agent counting rows or
breaks on `corgi_test` should know. The run reported 1678 open breaks.

## 5. Automatic-fail gate for this scope

| Rule | Status | Evidence |
|---|---|---|
| AF-01 accessible deployment | NOT RUN | This slice deploys nothing; the deployed endpoint belongs to the coordinator. The change is not on production at `d002f77` |
| AF-02 no simulation presented as live | PASS | Nothing in the diff labels an integration. `check:mcp` still read `Stripe LIVE SANDBOX` on the Stripe collection and `LOCAL SIMULATOR` on the claim rail |
| AF-03 no UPDATE or DELETE on money rows | PASS | The diff adds no migration and no write of any kind; the added lines contain no `insert`, `update`, `delete`, `truncate` or `drop`. `check:mcp` re-proved 9 journal entries before and after its own run |
| AF-04 sandbox only | PASS | Everything ran on `corgi_test` through `scripts/dev-on-test-database.ts` and the runtime role (`DATABASE_URL_TEST_APP`); `DATABASE_URL` was never used; no live key, no real personal data, no money moved, no provider side effect. The unit tests reach no database at all |
| AF-05 no secret committed | PASS | `gitleaks detect --log-opts 40352c8..HEAD --redact`: 1 commit scanned, ~5.62 KB, **no leaks found**, which reproduces the builder's pre-commit result independently. The `.env.local` used for the HTTP run was a symlink into the ignored `.env*` namespace and was removed afterwards; no connection string, key or password was printed at any point, and none appears in this record |
| AF-06 explainable line by line | QUESTIONS OPEN | The change is one named constant, one comment saying why, and four tests that read as prose. It is about as explainable as a slice gets. **Not confirmed with Yoann**, and a reviewer cannot confirm it on his behalf |

Candidate walkthrough status: **NOT REVIEWED WITH YOANN**. Nothing in this record establishes that
he can explain these lines.

## 6. Checks executed

| Check | Result |
|---|---|
| `npm run typecheck` | PASS, no output. Re-run as `npx tsc --noEmit --incremental false` to defeat the cached `.tsbuildinfo`: still exit 0 in 6.5 s |
| `npm test` | PASS, 539 tests, 538 pass, 0 fail, 1 skipped. The skip is `a broker account created in the Stripe sandbox maps to the right eligibility # SKIP set RUN_LIVE_STRIPE_TESTS=1`, which pre-exists this slice. Matches the builder's report exactly |
| `node --import tsx --test lib/mcp/tools/inspect-reference.test.ts` | PASS, the four new tests, 0 fail |
| `npm run check:mcp`, once, against `npm run dev:test-db` on port 3800 | **ALL CHECKS PASSED**, 0 FAIL, including the new assertion printed in full. The builder reported this as NOT RUN; it is now run and green. Server stopped afterwards, port 3800 confirmed free |
| Read-only probe, 8 hostile calls (`inspectReference.run` with fake contexts and a handle that answers no rows) | Output in section 7. No stack, no crash, no database reached |
| `gitleaks detect --source . --log-opts "40352c8..HEAD" --redact` | No leaks found, 1 commit scanned |
| Dash scan, `grep -P "[\x{2014}\x{2013}]"` on the three changed files, on the diff and on the commit message | None |
| `npm run check:money-guards` | NOT RUN, forbidden by this assignment; the coordinator proves the guards on an ephemeral database |

To run the HTTP check this worktree needed `node_modules`, which it did not have: it was cloned
from the checkout with `cp -Rc` (APFS clone, ignored by `.gitignore`), not installed, so
`package-lock.json` is untouched and `git status` stayed clean throughout.

## 7. Probe output, verbatim

```
broker  , unmatched policy number -> ANSWER  whatThisMeans="Nothing in this database matches that reference."
                                             recognisedAs="a policy number (CGP-nnnnn)"
broker  , unaccepted shape        -> ANSWER  whatThisMeans="Nothing in this database matches that reference."
                                             recognisedAs="a shape this tool does not accept"
customer, unmatched policy number -> REFUSED "this key's user reads no operational file: ..."
customer, unaccepted shape        -> REFUSED "this key's user reads no operational file: ..."
agent   , unmatched policy number -> REFUSED "this key's user reads no operational file: ..."
staff   , mcp key prefix          -> REFUSED "reading an MCP API key is never delegated to an agent: ..."
staff   , empty reference         -> REFUSED "\"reference\" is required and must be a non-empty string"
staff   , 201 characters          -> ANSWER  whatThisMeans="Nothing in this database matches that reference."
```

The last line is not a defect of this slice: the 200-character bound is enforced by the transport
schema before the tool is called, which `check:mcp` proves over HTTP ("AN OVER-LONG REFERENCE IS
REFUSED BY THE SCHEMA, naming the bound and never the value"). In process, the tool is reached
directly and answers a miss, as it did before this commit.

## 8. What was not verified

- The deployed application. Nothing here was exercised against production at `d002f77`; the new
  sentence is not deployed.
- A broker key against a real other-broker reference AND a nothing-matching reference in the same
  HTTP session. The two halves of F-INSPECT05-01 come from two sources, `check:mcp` over HTTP for
  the refusal and an in-process probe for the answer. The code path makes the conclusion certain
  (`referenceInBookRefusal` is only reached when `resolvedTo !== "nothing"`, line 513), but I did
  not observe both from one key in one transport session.
- The other open `F-INSPECT-*` findings (02, 03, 04, 06, 08, 09). Out of this slice's scope, none
  touched by the diff, all still open in the register.
- Everything the assignment listed for the New broker route. Not in this branch, see section 1.

## 9. Verdict

**PASS** for the reviewed scope: `inspect_reference` answers the exact sentence decision 53 names,
on both paths, the closed list stays published in the description and the schema, the two refusals
that must not move did not move, four new tests pin the behaviour, and the HTTP assertion the
builder could not run is now run and green. The slice writes nothing, adds no migration and
touches no money row.

The PASS covers the code change. It does **not** mean the register line F-INSPECT-05 may be closed:
see F-INSPECT05-01, which is the one finding of this review that requires an action before this
work is described as fixing anything.

Residual limitations: the deployed endpoint is unverified, Yoann's understanding is unverified,
and this record is an engineering assessment, never a legal certification.
