# Independent review, batch B13-2: fifteen LOW findings closed in one branch

Reviewer: independent reviewer sub-agent, working in the worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/agent-a16d0465956017165`, branch
`worktree-agent-a16d0465956017165`. Written at 2026-09-09T08:05Z. Linear YOA-628.

Reviewed revision: `main` at **78f93c6**. The batch itself is the merge **82591a0** of
`worktree-agent-a285d5858c4689d35`, and the diff read line by line is
`git diff 82591a0^1 82591a0` (25 files, +872 / -90). The two commits after it are out of scope
and were only identified, not reviewed: `1d5c0ea` and `3364216` are re-review records, `85b40b3`
is the coordinator's fix of F-B12-10 and F-B13-08 plus README lines, and `78f93c6` is a
docs-only tip touching `docs/STATUS.md` and `docs/reviews/FINDINGS.md`.

Because `78f93c6` changes no code, the deployed application at **85b40b3** (reported by
`/api/health` throughout this review) is the reviewed code head. Every production measurement
below was taken there.

This is a scoped engineering assessment of one batch of LOW fixes. It is not a legal
certification and it is not a statement that the six delivery gates pass for the submission.

## 1. Startup receipt

Read in full, in this order, before looking at any code: `CLAUDE.md`, `AUTOMATIC-FAILS.md`,
`READABLE-CODE.md`, `AGENTS.md`, `WORKFLOW-48H.md`, `REVIEWER.md`, `docs/handoffs/b13-2-notes.md`.

Then, for this scope, read in full: the whole batch diff; `lib/policy/endorse.ts` (the parts the
diff touches plus `recordEndorsementRequest`, `applyEndorsement`, `approveEndorsement`,
`requireLiveRequest`); `lib/payments/endorsement-collection.ts`; `lib/statements/journal.ts`;
`lib/reconciliation/diff.ts`; `lib/reconciliation/run.ts`; `lib/mcp/jsonrpc.ts`;
`lib/mcp/tools/tool.ts`; `lib/mcp/tools/tool.test.ts`; `app/api/mcp/route.ts`;
`app/api/policies/[policyId]/endorsements/[requestEventId]/approve/route.ts` and the sibling
`checkout/route.ts`; `components/workspace-overview.tsx`; `app/ops/page.tsx`;
`app/statements/[runId]/page.tsx` (lines 25 to 115); `package.json`; `.gitignore`;
`.env.example`.

Read in part, with what was read named: `docs/reviews/FINDINGS.md` (the fifteen register lines of
this batch, the F-B13-01 to 08 block for the id sequence, and the tail for the register format);
`docs/reviews/b4-endorsements.md` (the LOW table and the F-B4-04 section);
`docs/reviews/b8-corrections.md` (F-B8-08 in full); `docs/reviews/b10-reconciliation.md` (F-B10-09
and the "Checks executed" table); `docs/reviews/b13-6-change-requests.md` (its receipt and
register block, for the record format); `docs/ARCHITECTURE.md` (sections 1, 2 and 3 including
3.x, plus a grep for `quote_hash`); `db/migrations/0005_cancellations_and_refunds.sql` (the
`refund_allocations` table); `db/migrations/0011_reconciliation.sql` (the `reconciliation_runs`
columns); `db/migrations/0009_endorsements.sql` (the `quote_hash` column);
`lib/statements/compute.ts` (the canonical version block and the entry-kind table);
`lib/ledger/correction-entries.ts`, `lib/ledger/cancellation-entries.ts` and
`lib/ledger/endorsement-entries.ts` (the entry shapes only); `lib/claims/claims.ts` (the claim
lock and its comment); `lib/mcp/key-format.ts` (`hashArguments`); `lib/mcp/keys.ts` (the principal
and `recordMcpCall`); `scripts/check-endorsement-replay.ts` (its report lines);
`scripts/check-mcp.ts` (the header and the added block); `scripts/check-statements.ts` (the added
section 7b).

Not read, and not consulted: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`,
`READINESS-BACKLOG.json`, `GAP-REVIEW.md`, `docs/PLAN.md`, `docs/COMPLIANCE-MATRIX.md`,
`docs/DECISIONS.md`, `docs/STATUS.md`, `README.md` beyond its deployed URL line, the other slice
reviews, `docs/reviews/ui-main-merge.md` and `docs/reviews/ui-polish.md` beyond the four F-UI
register lines in `FINDINGS.md`. No retained readiness control was identified for this scope
beyond what `AGENTS.md` already requires. A reader should not assume this review checked the
batch against those catalogues. Absent files: none.

Planned checks and what happened, all listed with counts in section 5: `npm run typecheck`,
`npm test`, one run each of `check:endorsement-replay`, `check:statements`, `check:reconciliation`
and `check:mcp` on `corgi_test`, a read of the deployed staff overview and of Redwood's 2026-09
statement, and a grep of the diff for migrations, `UPDATE`, `DELETE` and form field names.
`check:money-guards` was deliberately not run, as instructed: the batch touches no migration and
no trigger, and it is the known shared-database contention case.

Nothing was pushed, nothing was deployed, no migration was applied anywhere, no shared planning
file was edited, and no `UPDATE` or `DELETE` was issued against any database. The demo password
was read from the main checkout's `.env.local` into a shell variable and never printed; no secret
appears in this file.

## 2. Applicability

Scope: fifteen LOW findings, of which five sit on a money path (F-B4-07, F-B4-12, F-B8-08,
F-B10-09, F-B7-13), five on the agent surface (F-B11-02, 03, 05, 06 and F-B12-01), one on a
concurrency answer (F-B4-10) and four on presentation (F-UI-03, 13, 16, 18). Actors: `customer`,
`broker`, `staff_ops`, `staff_approver`, `agent`. Product: Track 1 commercial policy
administration; rail: Stripe test mode for premium and refunds, a local simulator for claim
payouts; currency USD in integer cents.

No new external regime is engaged: no fix collects identity data, calls a new provider, or
changes an eligibility, approval or tax rule. The applicable requirements for this scope are
therefore the internal ones: **AF-03** (no `UPDATE` or `DELETE` on a money row; corrections are
reversals plus a re-book), **AF-04** (sandbox only), **AF-05** (no secrets), **AF-06**
(explainable code), the concurrency and idempotency rules of `AGENTS.md` ("use database
transactions, unique constraints and concurrency control for invariants"), its MCP rules
("apply authorization and tenant isolation to read tools too"), and the historical-query rule
that published statement revisions stay reproducible.

Confirmed facts: Track 1 selected by Yoann on 2026-09-08; the fifteen findings and their required
corrections as written in the four source review records. Assumption carried into this review and
not verified independently: that the four F-UI findings were correctly transcribed from
`ui-main-merge.md` and `ui-polish.md`, which I read only through their `FINDINGS.md` register
lines.

## 3. Requirement matrix

| # | Requirement | Control and code location | Evidence | Verdict |
|---|---|---|---|---|
| 1 | AF-03: no money row is updated or deleted | The whole diff adds inserts and reads only | `git diff 82591a0^1 82591a0` grepped for `UPDATE`, `DELETE`, `TRUNCATE`, `DROP`, `upsert`, `ON CONFLICT`: five hits, all inside comments or the handoff note, none a statement | PASS |
| 2 | AF-03: no migration, no schema change | No file under `db/` in the diff | `git diff --name-status 82591a0^1 82591a0`: 25 files, none under `db/` | PASS |
| 3 | A payment can only apply the quote it was bound to (F-B4-07) | `quoteBindingRefusal` in `lib/payments/endorsement-collection.ts:341`, called on both posting paths (lines 257 and 303); `recomputedQuoteHash` exported from `lib/policy/endorse.ts:606` | `check:endorsement-replay` 80 PASS, 0 FAIL: an unchanged quote still posts, is applied once, and the parked-cash path still clears. The refusal branches themselves are unreachable by construction and untested: **F-B13-09** | PASS with a finding |
| 4 | A quote superseded during posting cannot be applied, and its cash is parked (F-B4-12) | `postDeltaAndApply` takes `pg_advisory_xact_lock(hashtext(policyId))` first, then the operation lock, then re-reads the standing under the lock; `EndorsementNoLongerApplicable` rolls the transaction back and the catch parks the money | `check:endorsement-replay`: "a payment arriving for a superseded quote is recorded, not applied, and nothing is journaled"; "the parked cash is at Stripe and owed to the customer"; "delivering that payment twice parks it once". Those three prove the refusal that happens BEFORE the lock; the under-lock branch is read, not exercised: **F-B13-09** | PASS with a finding |
| 5 | The two locks cannot deadlock | Lock order policy then operation, taken in one transaction only | Every `pg_advisory_xact_lock` in the repository enumerated: 12 sites. Only `endorsement-collection.ts:373/377` takes two, in that order. `endorse.ts:276` and `correct-endorsement-date.ts:353` take the policy alone; `collection.ts` (3 sites), `correction-collection.ts:443` and `endorsement-collection.ts:653` take the operation alone; `kyb.ts` and `kyb-onboarding.ts` take a broker; `claims.ts:85` takes a claim. No transaction takes the operation before the policy, and none of the operation-lock transactions calls a function that takes a policy lock | PASS |
| 6 | Each refund line of a split correction carries its own premium base (F-B8-08) | The third sum in `lib/statements/journal.ts`, reading `refund_allocations.refunded_premium_cents` and filtered on `rebook.event_type = 'correction_rebook'` and `allocation.recorded_at <= knowledgeCutoff` | `check:statements` section 7b, run here: "a correction giving back 10262 ... opens TWO Stripe refunds" (difference -10262, 2 refund operations), "the two refunds give back 4931 and 5096 of premium", "EACH REFUND LINE CARRIES ITS OWN PREMIUM ... -5096 and -4931, not -10027 twice", "the two bases still add up ... -5096 + -4931 = -10027". The scalar subquery cannot return two rows because `refund_allocations.refund_operation_id` is `unique` (migration 0005 line 35) and the column is `not null`, so no legacy null and no cardinality error | PASS |
| 7 | The three premium sums do not double count | `correction_refund_requested` posts `Dr premium_receivable / Cr refund_payable` and moves no `unearned_premium` (`lib/ledger/correction-entries.ts:51`), so the first sum is zero exactly where the third is non-zero; a cancellation or endorsement refund names `cancelled` or `endorsed`, not a re-book | Read in the three entry builders; `check:statements` "the two bases still add up to the premium the correction gave back" | PASS |
| 8 | A statement still ties to the ledger | `commissionPayableMovementCents` recomputed live on the statement page, against `run.netDueCents` | Deployed Redwood 2026-09 revision 3 renders the chip "ties to the ledger" at the reviewed head; `check:statements` "October still ties to the ledger" (statement -1504, journal -1504, adjustment 0) | PASS |
| 9 | A shared provider reference does not pair two operations (F-B10-09) | `sharedProviderRefs` in `lib/reconciliation/diff.ts`, the fallback refused and both sides annotated | Two new unit tests in `lib/reconciliation/diff.test.ts` (pass in `npm test`); `check:reconciliation` 39 PASS, 0 FAIL, which shows nothing else regressed but does not build a shared reference. One annotation is wrong in the mixed case: **F-B13-12** | PASS with a finding |
| 10 | No caller string reaches `mcp_calls` (F-B11-02) | `methodForTheRecord` allow-list, `tool` null on an unknown tool, fixed refusal sentences in `policy-as-of.ts` and `broker-statement.ts`, the three length bounds in `recordMcpCall` | Every `log(...)` call site in `lib/mcp/jsonrpc.ts` reads a literal, `"unknown"`, `methodForTheRecord(...)` or `tool.name`; no `ToolRefused` in `lib/mcp` interpolates a caller value (grep for `${` inside `ToolRefused(`: none); `check:mcp` (section 5) | PASS |
| 11 | A call with no audit row is refused, not answered (F-B11-05) | `logCall` returns a boolean, every one of the four call sites checks it, `notRecorded()` answers `-32603` | Read on all four paths. The response carries `id: null` for a request that had an id: **F-B13-11** | PASS with a finding |
| 12 | Arguments are validated against the advertised schema (F-B11-06) | `argumentsSchemaRefusal` in `lib/mcp/tools/tool.ts`, called once in `callTool` before the tool runs | Five unit tests in `lib/mcp/tools/tool.test.ts` (pass in `npm test`); `check:mcp` "AN ARGUMENT THE TOOL DOES NOT DECLARE IS REFUSED" | PASS |
| 13 | A run launched through MCP says so (F-B11-03) | `launchedThrough` built from `principal.principalKind` and `principal.keyPrefix`, both read from the stored key row in `lib/mcp/keys.ts`, never from the request; stored at the head of `reconciliation_runs.note` | `check:mcp` "THE RUN SAYS IT CAME THROUGH THE MCP SURFACE"; the button and the cron pass nothing and are unchanged | PASS |
| 14 | A refusal names the way out (F-B12-01, F-B7-13) | `getPolicyAsOf` names the first effective date read from the rows already in hand; `sendClaimPayment` prints paid, other pending, the ceiling and the way out | `check:mcp` and `check:claims-and-approvals` lines quoted in the handoff; the arithmetic re-derived by hand: `otherPendingCents = snapshot.pendingCents - current.amountCents`, so 0 paid + 600 waiting + 600 asked = 1200 against a 1000 ceiling | PASS |
| 15 | A concurrent Approve or Pay answers a sentence, not a 500 (F-B4-10) | `isUniqueViolation` caught in both routes | Read in the diff, not raced live (the handoff says the same). Any unique violation, not only the intended index, is turned into a success-shaped answer: **F-B13-10** | PASS with a finding |
| 16 | The append-only statement is visible (F-UI-03) | `components/workspace-overview.tsx`, a `<p className="note">` under the heading | Fetched from the deployed `/ops` as `staff_ops`: `<p class="note">Every screen here reads append-only tables: nothing on these pages edits or deletes a money row. Corrections are reversals plus re-bookings.</p>` in the rendered HTML, not only in the RSC payload or the meta description | PASS |
| 17 | The deleted CSS was dead (F-UI-13) | 20 lines removed from `app/globals.css` | `grep -rn` over `app`, `components`, `lib` and `scripts` for `approval-details`, `loading-placeholder`, `demo-feedback` and `desktop-break`: zero hits outside the deleted CSS itself. `.table-scroll .badge` is still there | PASS |
| 18 | Forms and field names unchanged | No form element in the diff | The only component touched is `components/workspace-overview.tsx`, which gains one paragraph; the two routes read the same `approved` and `quoteHash` fields as before | PASS |
| 19 | AF-05: no secret in the batch or in this review | The diff adds no credential; `.env.local` stays ignored | `gitleaks protect --staged` before the single commit of this review (section 5); the batch's own `gitleaks` runs are the implementer's evidence, not rerun here | PASS |
| 20 | Published statement revisions stay reproducible | `CANONICAL_STATEMENT_VERSION` and the "identical to revision N" chip | The F-B8-08 fix changes the canonical text of an affected line inside version 2, without bumping it: **F-B13-13**. Not reachable on the data measured | PASS with a finding |

## 4. Findings

### F-B13-09 (LOW): the three new fail-closed branches on the posting path have no negative evidence

**Trigger, part one: F-B4-07.** `quoteBindingRefusal` (`lib/payments/endorsement-collection.ts:341`)
compares `link.quoteHash` with `request.figures.quoteHash`, then recomputes the hash from the six
facts. `createEndorsementCheckoutOperation` writes `endorsement_collections.quote_hash` from
`input.quote.figures.quoteHash`, and the posting path reads the same request event back by
`link.requestEventId`. Both rows are append-only, so the first comparison compares a value with
itself. The second repeats what `requireLiveRequest` already does, at a moment where the caller
supplies nothing. Neither branch is reachable on any path this build has, and nothing exercises
them.

**Trigger, part two: F-B4-12.** The standing re-read under the policy lock raises
`EndorsementNoLongerApplicable` with two distinct sentences ("while the payment was being
applied", "the customer has not approved this endorsement"). `check:endorsement-replay` proves the
refusal that happens BEFORE the lock, and quotes its sentence, "the quote was superseded by a
later endorsement_requested **before the payment arrived**". The under-lock branch, which is the
whole point of the finding, needs a commit landing inside the lock window and no check produces
one, so the rollback-and-park path added by this batch has never run.

**Consequence, and why it is LOW.** Nothing observed is wrong. The F-B4-07 code now does what
migration 0009 says, which is exactly the required correction, and it is honest about its own
reachability in its comment. The F-B4-12 lock is correct and its ordering is proved by reading
(matrix row 5). What is missing is negative evidence: the batch notes present
`check:endorsement-replay` 80 PASS as the proof of both, and that run proves the positive half of
F-B4-07 and the pre-lock half of F-B4-12, not the branches the two findings asked for.

**Required correction.** For F-B4-07, either export the comparison as a pure function with two
unit tests in the shape of `lib/mcp/tools/tool.test.ts` (a matching pair and a mismatched pair),
or record in the notes that it is a fail-closed assertion with no reachable trigger. For F-B4-12,
either call `postDeltaAndApply` in the check against a request that a second connection supersedes
between the pre-lock read and the lock, or state that the under-lock branch is reasoned, not
exercised. Either way, do not leave "80 PASS" standing as the proof of an untested branch.

### F-B13-10 (LOW): both new catch blocks treat any unique violation as the expected one

**Trigger.** `approve/route.ts` and `checkout/route.ts` now catch `isUniqueViolation(error)` and
answer, respectively, `/customer?approved=already` and "this payment was already started a moment
ago, so nothing was charged twice". `isUniqueViolation` tests the SQLSTATE `23505` and nothing
else, so any unique index violated anywhere under `approveEndorsement` or `startEndorsementCheckout`
produces the same answer.

**Consequence, and why it is LOW.** On today's code each path has exactly one unique index in
reach (`policy_events_one_approval_per_request`, and `money_operations.idempotency_key`), so the
answers are true. The failure mode is future: a second unique index added under either call turns
a real failure into a screen that says the work succeeded. The approve route is the sharper of the
two, because "approved=already" is a statement about the customer's own consent. No money moves
either way: a payment still requires the approval standing, which is read from the events.

**Required correction.** Test the constraint name as well as the SQLSTATE, or narrow the catch to
the statement that can raise it. One line each.

### F-B13-11 (LOW): the "not recorded" answer drops the request id

**Trigger.** `notRecorded()` in `app/api/mcp/route.ts` returns `{"jsonrpc":"2.0","id":null,
"error":{"code":-32603,...}}` for a request whose id was read successfully. JSON-RPC 2.0 reserves
a null id for a message whose id could not be detected; a client that matches answers to requests
by id sees an unsolicited error rather than the answer to its call.

**Consequence, and why it is LOW.** The path only runs when the audit insert fails, which nothing
in this build has produced, and the sentence it carries is the important part ("the call may
already have been carried out"). But this is precisely the moment a client most needs to know
which call it is about, since the advice is to go and look at the approvals screen.

**Required correction.** Thread the parsed id into `notRecorded()` for the two paths that have
one (the body was parsed), and keep `null` for the two that do not (no bearer token, unreadable
body).

### F-B13-12 (LOW): the shared-reference note is false when the operation id pairs one of the two

**Trigger.** `lib/reconciliation/diff.ts`. When a provider record names an operation id that one
of two ledger records sharing a provider reference carries, `byOperation` wins and that pair is
classified `matched` with no mention of the shared reference. The other ledger record is then
reported alone with `sharedRefNote`, which reads "ANOTHER LEDGER RECORD CARRIES THE SAME PROVIDER
REFERENCE, so the reference could not pair either of them". The second half of that sentence is
untrue in this case: one of them was paired, by operation id.

**Consequence, and why it is LOW.** No classification is wrong and nothing is dropped, which is
what the finding required. An operator reading the break is told the pairing failed for both
records when it failed for one, which points the investigation one step away from the answer.
The second new unit test covers exactly this arrangement and asserts the pairing, not the note.

**Required correction.** Either say "the reference could not be used to pair this record" on the
unpaired line only, or carry the shared-reference note onto the matched line too so both halves
name each other, which is what the batch notes claim already happens.

### F-B13-13 (LOW): the statement text changed inside canonical format version 2

**Trigger.** `lib/statements/journal.ts` now computes a different `unearned_premium_cents` for a
refund line whose allocation names a `correction_rebook`. That figure is stored on the line, shown
on the screen and the PDF, and hashed into the canonical text. `CANONICAL_STATEMENT_VERSION` is
still 2, and its own comment says "Bumping this is not a formality: a run of an older version
keeps its lines, its totals and its hash forever, and a new run is honestly not comparable with it
by hash". The documented reproducibility path is "fill the knowledge cutoff with the cutoff of an
earlier revision to reproduce that revision", flagged as identical when the content hash matches.

**Consequence, and why it is LOW.** For a v2 revision published before this batch that contains a
correction refund split over more than one PaymentIntent, a re-run at the same cutoff now produces
a different hash and is reported as not identical, with no "format changed" chip to explain it,
because both runs are v2. I could not reach that state on the deployed data: the five stored runs
are two v1 Redwood 2026-09 revisions, a v1 and a v2 2027-09, and the v2 2026-09 revision 3, and
the last one contains no correction line at all (its only refund is a cancellation refund of
CGP-01062, and the word "correction" does not appear on the page). The original finding says the
same thing: "no check exercises it today and the demo does not reach it". Totals and the ledger
tie are unaffected in every case, because the tie compares `commission_payable` and this figure is
a premium base.

**Required correction.** Yoann's call, and it is a domain decision, not a mechanical one: either
bump the canonical version to 3 so an affected re-run says "format changed, not comparable by
hash", or record in the notes that this fix corrects a figure inside v2 and that a pre-batch v2
revision of an affected month will not reproduce by hash. Do not leave it silent.

## 5. Checks actually executed

All on the reviewed head, from the worktree, with `node_modules` installed by `npm ci` in the
worktree itself (the first attempt used a symlink to the main checkout's `node_modules`, which
Turbopack refuses). `corgi_test` is shared with other agents; no deadlock and no contention
appeared in any run below, and no check was run more than once.

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0, no output |
| `npm test` | 436 tests, **435 pass, 0 fail, 1 skipped** (the opt-in live Stripe test), exit 0. Includes the five new `tool.test.ts` cases and the two new `diff.test.ts` cases |
| `npm run check:endorsement-replay` | **80 PASS, 0 FAIL**, exit 0. Includes the superseded-quote refusal, the parked cash, the double delivery parking once, and the closing "every journal line in the database balances, debits 567470974 = credits 567470974" |
| `npm run check:statements` | **50 PASS, 0 FAIL**, then the run stopped in section 8 (the document) with `(0 , $bdjGp$base64js).toByteArray is not a function`, exit 1. **This is my own doing, not the batch's**: the run started with `node_modules` symlinked to the main checkout, and I deleted that symlink and ran `npm ci` while it was still going, so a module loaded lazily by `@react-pdf/renderer` was resolved against a tree being rewritten. `base64-js` is 1.5.1 in both trees. Everything in this batch's scope ran and passed, including the four section 7b lines; section 8 was not verified by me and rests on the implementer's own run |
| `npm run check:mcp` | **58 PASS, 0 FAIL**, exit 0, against a dev server started by this review on `127.0.0.1:3901` with `DATABASE_URL_APP` pointed at `corgi_test`, per the script header |
| `npm run check:reconciliation` | **39 PASS, 0 FAIL**, exit 0, no deadlock. It produces every classification the brief names and reads the clearing list from the journal alone; it does not exercise a shared provider reference, which is what the two new unit tests are for |
| `npm run check:money-guards` | **NOT RUN**, as instructed: no migration and no trigger in this batch, and it is the shared-database contention case |
| `gitleaks protect --staged` | run before the single commit of this review, no leaks found |

Deployed measurements, both on `85b40b3` as reported by `/api/health`:

- `/ops` as `ops@example.com`: the append-only paragraph is in the rendered HTML (F-UI-03),
  alongside the error notice block the coordinator added in the same deployment.
- `/statements/c775c8ce-34a3-48a3-bea5-558b4d63a546`, Redwood Commercial Brokers 2026-09
  revision 3, canonical version 2: chip **"ties to the ledger"**, cash $5,948.17, premium
  $5,762.75, commission $864.41, clawback -$475.06, net due $389.35, identical to the figures of
  the v1 revision 2 of the same month. The tie is recomputed live by
  `commissionPayableMovementCents` at page render, so it is a measurement on the reviewed code
  and not a stored flag.

Not verified, and why:

- The two concurrent-click races of F-B4-10 were read, not raced. Producing a real 23505 on the
  deployed application would mean two simultaneous customer approvals of the same quote.
- The F-B11-05 failure path was not forced: making the `mcp_calls` insert fail under a live call
  means breaking the database, which this review will not do. The four call sites were read.
- The refusal branches of `quoteBindingRefusal` were not exercised (F-B13-09).
- The two commits after the batch merge, and everything they touch, were not reviewed.
- `docs/reviews/ui-main-merge.md` and `docs/reviews/ui-polish.md` were read only through their
  register lines in `FINDINGS.md`, so the four F-UI fixes were checked against the register
  wording and the code, not against the original finding text.
- No legal or provider source was consulted: no fix in this batch engages one.

## 6. Verdict

**PASS** for batch B13-2 at `82591a0`, reviewed on `main` at `78f93c6` and measured on the
deployed `85b40b3`.

The fifteen findings are addressed by the code they name. The two money-path changes that
deserved the most attention hold up: the endorsement posting now takes the policy lock before the
operation lock, re-reads the standing under it and parks the cash on a rollback, and the lock
order is the same at every one of the twelve advisory-lock sites in the repository, so no cycle
can form; the statement now reads each refund line's own stored premium base, cannot return two
rows because the allocation is unique per refund operation, and cannot double count because a
correction refund posts no `unearned_premium` line under its own money operation. No migration,
no `UPDATE`, no `DELETE`, no form or field name changed, and the deleted CSS was dead everywhere.

Five LOW findings are opened: F-B13-09 (an unfalsifiable new control), F-B13-10 (a broad unique
violation catch), F-B13-11 (a dropped JSON-RPC id), F-B13-12 (a note that is untrue in one
arrangement) and F-B13-13 (a canonical statement text changed inside version 2). None of them
moves money, none blocks the batch, and F-B13-13 is the only one that needs a decision from Yoann
rather than a line of code.

**Candidate walkthrough status: NOT REVIEWED WITH YOANN.**

## 7. Register lines to add in `docs/reviews/FINDINGS.md`

The coordinator owns that file; these lines are proposed, not written. The fifteen batch lines
should also move from "review pending" to "review PASS b13-2-low-batch.md".

| ID | Sev | Finding (one line) | Fix | Status |
|---|---|---|---|---|
| F-B13-09 | LOW | The three fail-closed branches this batch added to the endorsement posting path have no negative evidence: F-B4-07's two comparisons are unreachable by construction, and F-B4-12's under-lock refusal needs a race no check produces, yet "80 PASS" is offered as the proof of both | Two unit tests on the comparison and a raced check for the under-lock branch, or say in the notes which branches are reasoned rather than exercised | OPEN |
| F-B13-10 | LOW | The new Approve and Pay catch blocks treat any SQLSTATE 23505 as the expected index, so a future unique constraint would turn a failure into "already approved" or "nothing was charged twice" | Test the constraint name, or narrow the catch | OPEN |
| F-B13-11 | LOW | The MCP "call not recorded" answer returns `id: null` for a request whose id was read, so a client cannot tell which call may already have been carried out | Thread the parsed id through `notRecorded()` | OPEN |
| F-B13-12 | LOW | When one of two ledger records sharing a provider reference pairs by operation id, the other one still says "the reference could not pair either of them", which is untrue | Annotate the unpaired line only, or carry the note onto the matched line too | OPEN |
| F-B13-13 | LOW | The F-B8-08 fix changes the canonical statement text of a correction refund line inside format version 2, so a pre-batch v2 revision of an affected month no longer reproduces by hash and no chip explains it; not reachable on the deployed data | Bump the canonical version, or record the limitation. Yoann's decision | OPEN |
