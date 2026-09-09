# Independent review: late screen slices of interface batch 2, plus the demo-account switcher

Reviewer: independent reviewer sub-agent (late screen slices), own worktree
`/.claude/worktrees/agent-ac7df2f0aaca3d655`.
Timestamp: 2026-09-09, 20:30 to 23:10 UTC.

Reviewed head: `a29beef` for the six screen slices, extended to `5c4852f` for the
demo-account switcher (`c72436f` and the follow-up `a2708be`), both reached by
`git merge ui-evening-2` in this worktree. Working tree clean at the time of every
measurement (`git status` empty; the two throwaway fixture scripts were run from the
scratchpad and removed before the final `npm run typecheck`).

Diff under review: `git diff ce22ea1...a29beef` **minus** the statements files
(`app/statements`, `app/ops/statements`, `app/broker/statements`,
`components/statement-revisions.tsx`, `lib/statements`, `app/styles/money.css`) and the
tokens files (`app/ops/mcp-keys/**`, `app/api/mcp*`, `lib/mcp/**`, `lib/observability/**`),
which other reviewers hold, **plus** `git diff c72436f~1 a2708be` for the switcher.
`app/styles/money.css`, `app/ops/mcp-keys/**`, `app/api/mcp*`, `lib/mcp/**` and
`lib/observability/**` do not appear in the ce22ea1...a29beef diff at all;
`lib/observability/log.ts` was read only to interpret an activity row, never reviewed.

Scoped files (21 source files):
`app/broker/page.tsx`, `app/customer/page.tsx`, `app/ops/policies/page.tsx`,
`app/ops/reconciliation/page.tsx`, `app/policies/[policyId]/billing-sections.tsx`,
`app/policies/[policyId]/cancel/page.tsx`,
`app/policies/[policyId]/correction-sections.tsx`,
`app/policies/[policyId]/corrections/[rebookEventId]/approve/page.tsx`,
`app/policies/[policyId]/corrections/new/page.tsx`,
`app/policies/[policyId]/customer-view.tsx`, `app/policies/[policyId]/endorse/page.tsx`,
`app/policies/[policyId]/endorsements/[requestEventId]/approve/page.tsx`,
`app/policies/[policyId]/page.tsx`, `app/styles/lists.css`, `app/styles/policy-detail.css`,
`components/amount-explained.tsx`, `components/emphasis.tsx`,
`components/what-needs-you.tsx`, `lib/ui/emphasis.ts`, `lib/ui/emphasis.test.ts`,
`package.json`; and for the switcher `lib/auth/demo-accounts.ts` (+ test),
`app/api/session/switch/route.ts`, `components/shell/app-shell.tsx`,
`app/styles/system.css`, `app/styles/lists.css`.

## Startup receipt

Read in full, in this order: `CLAUDE.md`, `AUTOMATIC-FAILS.md`, `REVIEWER.md`,
`AGENTS.md`, `WORKFLOW-48H.md`. Read for scope: every file listed above, plus
`lib/policy/endorsement-read.ts`, `lib/policy/endorse.ts`, `lib/auth/current-user.ts`,
`lib/auth/session.ts`, `components/ui/stat.tsx`, `scripts/migrate.ts`,
`scripts/seed.ts`, `scripts/dev-on-test-database.ts`,
`scripts/check-endorsement-replay.ts` (fixture shape only), `db/migrations/0002`,
`lib/observability/log.ts` (rule/redaction semantics only).
Not read: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `GAP-REVIEW.md`,
`READINESS-BACKLOG.json`, `READABLE-CODE.md` beyond what `CLAUDE.md` quotes: this is a
presentation batch with no performance claim and no new money path. Recorded as a limit.
Next thing checked: the six claims of the brief, one measurement each.

## Environment

- `.env.local` copied from `/Users/yoannabriel/dev/corgi-work-trial` into this worktree.
  Confirmed gitignored (`git check-ignore -v .env.local` -> `.gitignore:20:.env*`).
  No value from it appears in this record or in any evidence file.
- Trial database: `GET` only, through `npx next dev -p 3047`, stopped by its port's PID
  (`lsof -ti:3047 | xargs kill`), never `pkill next`.
- Disposable database `corgi_ui_late`, created on the same Neon project by swapping the
  database name in `DATABASE_URL`, migrated (`scripts/migrate.ts`, 26 files applied) and
  seeded (`scripts/seed.ts`). Every write in this review landed there. **Dropped at the
  end of the review** (`drop database if exists corgi_ui_late with (force)`), confirmed.
- Production baseline: `https://corgi-work-trial-iota.vercel.app`, running `d002f77`
  (interface batch 1). **`d002f77` is older than the review base `ce22ea1`**, so the
  production-versus-branch text diff also contains base changes (the Billing view, the
  Documents card rewording, the what-needs-you empty block removal, "MCP keys" renamed
  "Access tokens"). Each difference below is attributed.

Next.js 16 allows one dev server per checkout, so 3047 (trial) and 3048 (disposable) were
run one at a time, never together.

## What was checked, and what it showed

### Scope and hygiene

| Check | Command | Result |
|---|---|---|
| Scope has no lib/ hunk beyond the pure helper | `git diff ce22ea1...a29beef --name-only` | PASS. Only `lib/ui/emphasis.ts` and `lib/ui/emphasis.test.ts` under `lib/` in scope (`lib/statements/group-runs.*` belongs to the statements reviewer). |
| Form census on the scoped diff | `grep -E '^[-+].*(action=\|method=\|name=")'` on the 21-file diff | PASS. **Zero** matches: no route, method or field name changed on any existing form. |
| `rel="noopener"` claim | `grep -rn 'target="_blank"' app components` | PASS. Ten `target="_blank"` sites, all ten carry `rel`. The two as-of document forms are one shared `DocumentRow` (`correction-sections.tsx:332`), so the single `rel` addition covers both, as the commit message says. |
| Dash ban | grep for em/en dash on every added line of the scoped diff, and the `break.mjs` DOM counter on 33 rendered screens | PASS. Zero. |
| No `loading.tsx` | file names of `ce22ea1..5c4852f` | PASS. None. |
| Typecheck | `npm run typecheck` | PASS, clean, at `5c4852f` with the working tree clean. |
| Tests | `npm test` | PASS. At `a29beef`: 551 pass, 1 skipped, 0 fail (the expected 551). At `5c4852f`: 553 pass, 1 skipped, 0 fail (the two `demo-accounts.test.ts` cases). |
| Emphasis unit test | `npx tsx --test lib/ui/emphasis.test.ts` | PASS, 6 tests. |
| Secret scan | `gitleaks dir --redact` over the whole worktree | PASS **for tracked files**. 12 findings, every one in `.env.local` or `.next/` (both gitignored). No tracked file in the batch carries a secret. No suspected value is reproduced here. |

### Emphasis (claims 1)

- `emphasisParts` is a pure string splitter: the property that matters (rejoining the parts
  gives the original string character for character) is asserted on six sentences including
  the real Confirm paragraphs. Read and agreed.
- **Escaping, hostile**: `/ops/reconciliation?explained=<b>x</b> $1,000.00 2026-01-01 <img
  src=x onerror=alert(1)>` renders, in the DOM,
  `Break &lt;b&gt;x&lt;/b&gt; <strong>$1,000.00</strong> <strong>2026-01-01</strong>
  &lt;img src=x onerror=alert(1)&gt; is explained. …`
  Zero `<img>`, zero `<b>`, no dialog, no page error. The figures are bolded and the markup
  in the data is text. `<Emphasis>` is one component over one function, so this proves the
  property for every use site. PASS.
- **Bold placement**, `document.querySelectorAll("strong,b")` on every captured screen with
  every fold open: no bold inside a chip or badge anywhere. The refunds "What it waits for"
  column is the only bolded table cell (`<td>Stripe confirmed the money left on
  <strong>2026-09-09</strong>.</td>`, four rows), which is the declared exception. Four
  hits that first read as "bold in a `td.num`" on the endorsements view are `<strong>`
  inside the **explanation drawer** that is nested in that cell, not a cell value; the rule
  holds in substance. PASS, with F-LT-11 below on which figure gets the bold.
- **Text identity against production**, `document.body.innerText` with folds open, ops /
  broker / customer, on `/ops`, `/ops/policies`, `/ops/reconciliation`, the policy page and
  its endorsements, billing and money views. Every difference is a word the batch added or a
  base change that predates `ce22ea1`; the full list is in "Text differences" below. PASS.
- "Correct" in the form sub-menu for `staff_ops`: measured on `/cancel`
  (`… Timeline / Correct / Cancel`) and on `/endorse` of a policy with no live request
  (`… Timeline / Correct / Endorse`); absent for the broker on both. PASS.
- The customer correction-approval fold (`<Disclosure title="Every figure, and how it was
  computed">`) is **NOT RUN**: see "Checks not executed".

### Policy lists (claim 2)

- `/ops/policies` and `/broker`, 1440, trial database: `CGP-01707` reads `$1,253.20` with
  `$2,788.45 on the latest terms` under it. Reconciled: latest terms `$2,700.00` annual
  premium + `floor(270000 × 235 / 10000)` = `$63.45` tax + `$25.00` fee = `$2,788.45`,
  and `$2,700.00` is the same figure the policy page's tile prints. PASS.
- `/customer`, same policy: `$1,200.00` with `$2,700.00 on the latest terms`. PASS.
- **Legend gating**: on the disposable database, whose two policies carry no applied
  endorsement, `/ops/policies` prints no "on the latest terms" term at all. On the trial
  database, where one row prints it, the term is there. No orphan term for that entry. PASS.
  The `/customer` "from a date" entry is gated the same way but see F-LT-09.
- **`$` multiset**: the production-versus-branch diff of `/ops/policies`, `/broker` and
  `/customer` adds exactly one money line per screen (`$2,788.45 …` / `$2,700.00 …`) and
  changes no existing figure. PASS.
- `app/customer/page.tsx` newly imports `app/styles/lists.css`. Every selector in that file
  is scoped to a `.lists-*` or `.needs-you.lists-needs` class, so the import adds
  `.lists-later` and nothing else; the rendered `/customer` differs from production only by
  the batch's own words. "No reader change" holds. PASS.

### What needs you (claim 3)

- `/ops` as ops: the row reads chip `4` beside `open breaks between a provider and the
  ledger`; production reads chip `4` beside `4 open breaks between a provider and the
  ledger`. The count is printed once. PASS.
- The blocking row is untouched apart from `<Emphasis>` on its detail line, which the
  `title` attribute still carries in plain text for the tooltip and for a text search. PASS.
- `broker2@example.com` / `broker3@example.com` exist in the seed; their blocking rows were
  not exercised (no unverified broker on either database at review time). Recorded as
  NOT RUN below.

### Policy page (claim 4)

Measured on the disposable database, with a bound policy (`CGP-01002`, $1,200.00 annual)
and one endorsement request to $2,700.00 effective 2026-10-01, delta $1,409.06, driven
through the real screens: the broker posted the request from the endorsement preview, the
customer approved it from `/customer` -> the approval page.

| Claim | Measured | Verdict |
|---|---|---|
| Pending row is the last row of the changes table | Staff and broker: last `ExpandRow`, chip `awaiting the customer` / `approved, awaiting payment` in the **Ref** column. Customer: last row, chip `awaiting your approval` under the date. | PASS |
| "$X to settle" | `$1,409.06` with `to settle` under it, on all three audiences | PASS |
| Row ordering is safe | `lib/policy/endorse.ts:139` refuses a request dated before the latest applied endorsement, so the pending row's effective date is always the furthest away. The comment's claim holds. | PASS |
| Figures identical to the card and the Billing view | `$1,409.06` in the band action, the notice, the tile's second line, the "Endorsement in progress" card, the pending row and "What is owed"; `$2,700.00` in the tile, the row and the tile line | PASS |
| Band action for the owning broker only | Broker: `Pay the delta $1,409.06`, orange (no correction open, so it is the older item). Ops: no Pay action, band shows only `Cancel the policy` / `Open a claim`. Customer: none. | PASS |
| `?view=billing#pay-delta` lands on the Pay row | `id="pay-delta"` appears **exactly once** in the broker's Billing view HTML, **zero times** in the operator's | PASS |
| Notice line under the band | Present in all four states; wording per audience | See F-LT-01 |
| `count: 1` on Endorsements while the change waits on the reader | Broker, awaiting_approval: no count. Broker, approved: `1`. Customer, awaiting_approval: n/a (no endorsements view). Ops, approved: `1`. | See F-LT-02's sibling, F-LT-01 |
| A policy with no endorsement omits the tile | Second fixture policy (`CGP-01001`): "Latest terms on record" absent | PASS |
| Old "From `<date>` the annual premium becomes" paragraph removed | Gone from both the staff page and the customer view; the same sentence survives under its own heading in About, where `endorsementsNotYetInForce` is still used (no dead code) | PASS |
| Two open items, one primary | `deltaIsTheOlder` read and agreed: when only one is open it is orange, when both are the older one is orange. **Not reproduced live** (no policy with both a payable delta and an open correction difference was reachable). Recorded as NOT RUN. | NOT RUN |
| `rel="noopener"` on the two as-of forms | PASS (above) | PASS |

### Refusals

- Signed out on the policy page and on `?view=billing`: 307 to `/login`. PASS.
- Wrong role: the customer has no `?view=billing` Pay row and no `#pay-delta` anchor; a
  staff operator has neither. PASS. (Cross-broker access was not re-tested: unchanged by
  this batch and covered by earlier reviews.)

### 375 px

`break.mjs` at 375, on the branch, trial database:

- ops on `/ops/policies`, the policy page, `?view=endorsements`, `/ops`: **no HORIZONTAL
  OVERFLOW**, no dash characters.
- customer on `/customer` and the policy page: **no HORIZONTAL OVERFLOW**.
- broker on `/broker`: **no HORIZONTAL OVERFLOW**.
- `BAND NOT STICKY` is reported on every one of them and on production too; pre-existing,
  not this batch.

**F-EV-08 confirmed fixed.** Production `d002f77`, `/ops` at 375:
`HORIZONTAL OVERFLOW 605 > 375: li right=605; a right=605; span right=568; strong
right=568; span right=568` (both plain and folds-open). The same screen on the branch:
no overflow. The `min-width: 0` rules added to `app/styles/lists.css` are the fix.

### AF-02 line

Verbatim `Stripe: LIVE SANDBOX · claim rail: LOCAL SIMULATOR · bank check: LOCAL SIMULATOR`
on **33 of 33** captured screens (three roles, two databases, every view exercised),
alongside `Sandbox providers and test data. No real money.` PASS.

## Demo-account switcher (`c72436f`, `a2708be`)

Every measurement below was made on the disposable database. Nothing was posted to the
trial database.

### The route, measured

| Attack | Status | Location | `Set-Cookie` |
|---|---|---|---|
| hostile email `root@example.com` | 303 | `/ops?error=that%20is%20not%20one%20of%20the%20demo%20accounts` | no |
| existing user not on the list (`unlisted-ops@example.invalid`, `staff_ops`, inserted on the disposable database) | 303 | same refusal | no |
| `agent` principal on a **listed** address (an `agent` row parked on `broker3@example.com`, so the third gate and not the list gate has to refuse) | 303 | `/ops?error=that%20demo%20account%20does%20not%20exist%20on%20this%20database` | no |
| signed out | 303 | `/login?error=Please+sign+in+first` | no |
| `GET` | 405 | none | no |
| repeated `email` parameter (`email=broker@…&email=approver@…`) | 303 | `/broker` (the **first** value wins) | yes |
| empty body | 303 | refusal | no |
| no `email` field | 303 | refusal | no |

Every refusal sets no session cookie, by construction (`redirectTo` builds the response and
only the success path appends `set-cookie`) and as measured. `request.formData()` on an
empty body does not throw.

### Happy path

One browser, `ops -> broker -> customer -> approver`, each a 303 with a fresh signed
cookie: `/broker`, `/customer`, `/ops`. After each hop the sidebar identity and the home
redirect follow the new role (`/` -> `/broker`, `/customer`, `/ops`; `/ops` renders 200
only as the approver).

### The menu

Native popover (`[popover]`, `:popover-open`), six accounts in the hard-coded order,
`ops@example.com` **disabled** with `aria-current="true"` and a check mark, `Sign out`
kept below a rule. Opens **upward** at 1440 (panel bottom 811 px, anchor top 817 px) and
stays inside the viewport at 1440 and at 375. Closes on `Escape` and on a click outside.
No page errors.

### Activity rows

One row per switch, `route = "/api/session/switch"`, `method = POST`, `status_code = 303`.
On success `outcome = "ok"`, `rule = null` (`rule` is the refusal rule in
`lib/observability/log.ts`; null on success is by design, not a defect). On refusal
`outcome = "refused"`, `rule = "sign in"`, `message` the refusal sentence. Actual message
on success, quoted from the table:

```
demo switch: staff_ops (ops****) to broker (bro****)
demo switch: broker (bro****) to customer (cus****)
demo switch: customer (cus****) to staff_approver (app****)
```

The **roles** are named on both sides, as claimed. The **emails are not**: the logging
layer redacts them to three characters (F-LT-06).

## Findings

### F-LT-01 (MEDIUM): a staff operator is told to pay a delta that is the broker's

`app/policies/[policyId]/page.tsx:318-326` passes `audience: "staff"` for every staff
reader; `app/policies/[policyId]/correction-sections.tsx:157-161` writes, for that
audience, `The customer approved the quote at <UTC>; the endorsement takes effect when you
pay.`

Measured on the disposable database as `ops@example.com`, on one screen, six lines apart:

```
The customer approved the quote at 2026-09-09 20:51:16 UTC; the endorsement takes effect when you pay.
…
The owning broker collects the endorsement delta of $1,409.06 from this view.
```

Ops has no Pay action anywhere on the policy (correctly: `payableDelta` requires
`isOwningBroker`). The sentence written for the broker is served to every staff reader, so
the screen states two contradictory things about who owes $1,409.06 and the wrong one is
the more prominent.

The same undifferentiated `"staff"` audience drives `endorsementNeedsThisReader`, so
`staff_ops` also gets `count: 1` on the Endorsements sub-menu for work the same page says
is the broker's, against the batch's own stated rule ("a count is only ever drawn for
something the person reading has to do").

Required: give the notice a third case, or key it on `isOwningBroker` and let a non-owning
staff reader read "…when the broker pays the delta"; gate the count the same way.

### F-LT-02 (MEDIUM): "Latest terms on record" prints a figure that is not on record

`app/policies/[policyId]/correction-sections.tsx:106-110`: when no endorsement has been
applied, the tile's **value** falls back to `pending!.newAnnualPremiumCents`.

Measured on the disposable database, all three audiences, both before and after the
customer's approval:

```
Latest terms on record
$2,700.00
nothing applied yet
$2,700.00 from 2026-10-01 if it is approved and the delta is paid
```

A quote that nobody has paid for is the headline figure under a label saying "on record",
contradicted by the tile's own note one line down, and repeated verbatim on the line below
that. This is the same class of defect the tile was added to remove ("pourquoi ici je vois
1 200 ?"), inverted: the big figure is now the one that is *not* true. It also contradicts
the batch's own claim, which describes the value as the "latest applied endorsement
premium".

Required: with no applied endorsement, either draw no tile (the pending change already has
its notice, its row and its card), or make the value the premium actually on record and
keep the quote on the note line alone.

### F-LT-03 (MEDIUM): the customer's list hides the customer's own outstanding approval

`app/customer/page.tsx:319-322`: `requestedPremium` prints
`… once the delta is paid` for **every** live request, including one still
`awaiting_approval`.

Measured on the disposable database with the quote awaiting the customer, on one screen:

```
What needs you
1  endorsement waiting for your approval
…
CGP-01002 … $1,200.00
             $2,700.00 from 2026-10-01 once the delta is paid
```

and the same policy's own page, for the same reader, at the same moment:
`$2,700.00 from 2026-10-01 if it is approved and the delta is paid`.

The row tells the person who has to approve that only a payment is missing. The legend
repeats it ("once your broker collects the delta"). `LatestTermsStat` already has the
correct two-branch wording; the list does not.

Required: branch on `row.live.standing.state === "approved"` exactly as
`LatestTermsStat` does.

### F-LT-04 (MEDIUM): the sidebar account name wraps and collides with the role, on every screen

`app/styles/system.css:2725` (`.account-switch`) plus the `ChevronsUpDown` icon added in
`components/shell/app-shell.tsx`.

Measured at 1440 and at 1024 on the branch, signed in as ops:
`<strong>` height 40 px over two lines ("Sam Patel," / "operations"), role line height
19 px directly under it, name box `left 61 right 188` inside a button `left 12 right 220`.
On production `d002f77`, the same name is one line. Screenshot at deviceScaleFactor 3 shows
the two name lines running into "Staff operations".

It is the one element on every signed-in screen of the application, and it is a visible
regression against the deployed build.

Required: `min-width: 0` and `text-overflow: ellipsis` on the name (the pattern the menu's
own `.pop-account-line > span:first-child` already uses), or `flex-shrink: 0` on the
chevrons plus a truncating name.

Note: the dark circle that overlaps the avatar in a dev screenshot is the Next.js dev
overlay indicator, not the application. Not a finding.

### F-LT-05 (MEDIUM): the switch hands any demo session the approver's session, and nothing a reviewer reads says so

`app/api/session/switch/route.ts`.

Measured: `customer@example.com` -> `approver@example.com` returns 303 to `/ops` with a
signed session cookie, and `/ops` then renders 200. A broker session reaches
`staff_approver` the same way. No password, no second factor, no role restriction on the
transition: the only gate is the closed six-address list.

What this does **not** break: the ledger evidence. `approved_by` carries distinct user ids,
the maker-checker trigger of migration 0008 still demands `staff_approver`, and the
initiator-cannot-approve test is on user ids, not browsers. The coordinator's framing is
correct on that point and I confirm it.

What it does weaken: the control itself. `AGENTS.md` requires "a distinct authorized human"
and explicitly forbids approval "through human endpoint impersonation or admin shortcuts".
On a publicly reachable deployment, one demo session is now enough to become the approver.
In this build all six accounts already share one password that is handed to reviewers with
the URL, so the switch adds no capability to someone who holds that password; it removes
the last step that made assuming the approver a deliberate act.

Required before submission, and this is what blocks rather than the code:
1. name the switch in the README (integration inventory / limitations) and in the
   maker-checker evidence, as a demo device, with what would be removed for a real
   deployment;
2. state there that on the demo the two-human separation rests on the closed list alone;
3. consider refusing a switch into `staff_approver` from a non-staff session, or putting
   the whole route behind an environment flag a real deployment would not set.

### F-LT-06 (LOW): the activity row cannot say which account was assumed

Claimed message: `demo switch: staff_ops (ops@example.com) to broker (broker@example.com)`.
Actual stored value, quoted from `activity_log` on the disposable database:
`demo switch: staff_ops (ops****) to broker (bro****)`. `lib/observability/log.ts` redacts
the emails. `subject_kind` and `subject_id` are both `null` on every switch row.

All three broker accounts begin `bro`, so the row cannot distinguish
`broker@example.com` from `broker2` or `broker3`, and nothing else on the row names the
target user.

Required: `activity.subject_kind = "user"; activity.subject_id = target.id;` (both columns
exist), and correct the claim text in the DECISIONS entry to what is actually written.

### F-LT-07 (LOW): the agent refusal misstates its reason, in the UI and in the audit row

`app/api/session/switch/route.ts:33`. A target that exists but is an `agent` principal is
refused with `that demo account does not exist on this database`. Measured with an `agent`
row parked on `broker3@example.com`: 303, no cookie (the outcome is right), and that
sentence is written both to the redirect and to `activity_log.message`.

An audit record that says a row does not exist when it does is a false statement in a table
that is never corrected.

Required: two messages, one per branch.

### F-LT-08 (LOW): the staff and broker legend names a date the row does not print

`app/ops/policies/page.tsx:218` and `app/broker/page.tsx:273`:
`a change is already written on the policy and takes effect **after that date**`.

The second line deliberately carries no date, and the batch's own comment explains why
(`policy_current` does not store `latestEndorsementEffectiveAt`). Measured on
`/ops/policies` and `/broker`: the cell reads `$1,253.20` / `$2,788.45 on the latest
terms` and no date appears anywhere in it. The customer variant says "takes effect later"
and is right.

Required: the customer's wording on all three lists.

### F-LT-09 (LOW): the `/customer` legend term never appears on the screen

`app/customer/page.tsx:166`: the term is `from a date`. Every other term in that legend is
the literal string a row prints. Measured: the row prints `$2,700.00 from 2026-10-01 once
the delta is paid`; "from a date" is nowhere on the page. A legend whose term cannot be
found on the screen is the defect the gating was added to avoid.

Required: a literal term, for instance `once the delta is paid`.

### F-LT-10 (LOW): the customer's pending row: an unlegended chip under a column head that misdescribes it

`app/policies/[policyId]/customer-view.tsx:320-343`. The row prints an `awaiting your
approval` chip and `$1,409.06 / to settle` under the column head **Charged**, whose legend
on the same screen reads "the money that moved at the time". Nothing has moved. That
table's legend lists `Charged` and `New annual premium` and no chip at all, while the
staff table names its column `Prorated delta` and does legend its chips.

Required: add the chip to that legend and qualify the Charged column for the pending row,
or reuse the staff wording.

### F-LT-11 (LOW): the emphasis rule bolds the denominator of "N of M days"

`lib/ui/emphasis.ts:65` (`\d+ days?\b`), fixed by `lib/ui/emphasis.test.ts:31`
(`strongPieces("351 of 365 days remain")` is asserted to be `["365 days"]`).

Measured on the endorsement approval screen and in the delta drawer:
`351 of **365 days** remained from **2026-09-22**` and `335 of **365 days** of the term
remain from **2026-10-01**`. The figure a reader is looking for is the days remaining, and
it is the one left in grey; the term length, which never changes, is the one in bold.

Required: emphasise `351 of 365 days` as one piece, or neither.

### F-LT-12 (LOW): the demo-account menu is a static list, not a reading of the database

`components/shell/app-shell.tsx` maps `DEMO_ACCOUNTS` unconditionally. Measured: once
`broker3@example.com` stopped being a broker on the disposable database, the menu still
offered it and the switch answered a refusal. On a database seeded differently, or seeded
in part, the menu offers entries that cannot work.

The deployed database is seeded by `npm run seed`, which creates all six, so this is right
there today. Note only; no change required before submission.

## Automatic-fail gate, for this scope

| Rule | Verdict | Evidence |
|---|---|---|
| AF-01 accessible deployment | NOT RUN | Deployment is the coordinator's gate. Production `d002f77` was reached and used only as a comparison baseline. |
| AF-02 no simulation shown as live | PASS | The mode line verbatim on 33 of 33 rendered screens, plus the sandbox sentence. No label in this batch claims a provider state. |
| AF-03 no UPDATE/DELETE on money rows | PASS | The batch adds no SQL. The only new `lib/` file is a pure string function that reads no database. The form census found zero changes to any route, method or field name. The one route added writes one `activity_log` row and touches no money table. |
| AF-04 sandbox only | PASS | No provider call added. Every write made for this review was on `corgi_ui_late`, dropped at the end. Nothing was posted to the trial database. |
| AF-05 no committed secrets | PASS | `gitleaks dir --redact`: 12 findings, all in `.env.local` and `.next/`, both gitignored; nothing in a tracked file. No suspected value reproduced. |
| AF-06 explainable line by line | Reviewer cannot certify | Two places deserve a walkthrough before the debrief: the alternation order of `EMPHASISED_PHRASES` in `lib/ui/emphasis.ts` (why longest-first, and what `\b` buys), and `deltaIsTheOlder` in `app/policies/[policyId]/page.tsx` (which of two open items goes orange, and why `approvedAt` is the delta's waiting-since). A technical PASS is not Yoann's understanding. |

## Text differences, production `d002f77` versus the branch

Attributed, so none is left unexplained:

**From this batch, in scope**: the count printed once on the what-needs-you row; the second
line under the money cell on the three lists plus its legend entry and the reworded About
paragraph; the "Latest terms on record" tile; the removal of the "From `<date>` the annual
premium becomes" paragraph on the staff page and the customer view; "Correct" in the policy
sub-menu.

**From the base `ce22ea1`, older than production**: the Billing view entry in the policy
sub-menu; the Documents card rewording (`as of 2026-09-09, PDF` -> `PDF as of the chosen
date, opens in a new tab.`); the Broker/Customer facts moving up the overview; the
what-needs-you empty block no longer drawn when nothing waits.

**From another reviewer's scope**: "MCP keys" renamed "Access tokens".

**Capture artifacts, not differences**: `$01.88` versus `$02.44` in the premium-tax
explanation is `AmountExplainedMotion` caught mid count-up (the formula and the entry are
identical); relative ages ("12 min" versus "10 min").

## Checks executed

`npm ci`; `npm run typecheck` (twice); `npm test` (twice); `npx tsx --test
lib/ui/emphasis.test.ts`; `gitleaks dir --redact` over the worktree; the form/dash/loading
censuses over the scoped diff; `npx next dev -p 3047` against the trial database and
`next dev -p 3048` against `corgi_ui_late`, each stopped by its port's PID; 33 screen
captures of `document.body.innerText` with every fold open, three roles, branch and
production; a `strong`/`b` census with cell and chip context on every one of them; the
`break.mjs` 375 sweep on three roles on the branch and on production; the hostile
`?explained=` injection; eight measured attacks and a four-hop happy path on
`/api/session/switch`; the popover behaviour at 1440 and 375; the `activity_log` rows read
back from the disposable database; the disposable database created, migrated, seeded and
dropped.

## Checks not executed, and why

- **The correction preview's Confirm paragraph and the customer correction-approval fold**
  (`Every figure, and how it was computed` as a `<Disclosure>`): not reachable. The trial
  database's only endorsed policy, `CGP-01707`, is **cancelled**, and the preview refuses
  with "this policy is cancelled: correcting an endorsement would change the premium the
  cancellation already gave back"; the disposable policy's endorsement is not applied (the
  delta is unpaid), so it has nothing to correct, and applying it would need a real Stripe
  checkout. Read in the diff and agreed; the escaping property is proved by the hostile test
  above (one component, one function), and the Confirm sentence strings are covered
  character for character by `lib/ui/emphasis.test.ts`. Recorded as NOT RUN, not as PASS.
- **The hostile `reason=` parameter on the correction preview**: same reason. The equivalent
  hostile string was pushed through `<Emphasis>` on `/ops/reconciliation` instead.
- **"Older open item primary"** (`deltaIsTheOlder` with both a payable delta and an open
  correction difference): no such policy was reachable without applying an endorsement.
  Code read and agreed; not reproduced.
- **The blocking what-needs-you rows for `broker2` / `broker3`**: neither database had an
  unverified broker at review time.
- **Cross-broker and cross-customer access on the policy page**: unchanged by this batch,
  covered by earlier reviews; only signed-out and wrong-role-on-this-page were re-tested.
- **`READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `GAP-REVIEW.md`**: not consulted. No
  performance claim and no new money path in this batch.

## Verdict

**FAIL** for the scope reviewed, on F-LT-01, F-LT-02, F-LT-03 and F-LT-04.

The batch does what it set out to do almost everywhere: the emphasis helper is a pure,
tested, correctly escaping splitter and the screens read better for it; the pending
endorsement is now visible where the reader stands, with figures that reconcile to the cent
across the band, the tile, the card, the row and the Billing view; the anchor, the
role gating and the legend gating are exactly as claimed; F-EV-08 is measurably fixed and
nothing overflows at 375. The four MEDIUM findings are all of the same kind, and it is the
kind this batch exists to remove: a screen that states something about money that is not
true for the person reading it. Two of them (F-LT-01, F-LT-03) put a wrong obligation in
front of a reader who has one; one (F-LT-02) makes a quote the headline "on record" figure;
one (F-LT-04) is a visible regression on every signed-in screen.

The demo-account switcher is correct as built and every claimed gate holds under attack.
It is not a code defect, it is a disclosure debt: F-LT-05 must be written into the README
and the maker-checker evidence before submission, because a publicly reachable deployment
now lets one demo session become the approver with a click. The maker-checker **proof** is
unaffected and I confirm that: the rows carry distinct user ids and migration 0008's
trigger is untouched. It is the **control** that now rests on the closed list alone, and a
reviewer must be told.

Residual limitations: this is a scoped engineering assessment of presentation code on a
sandbox build at `a29beef` / `5c4852f`. It is not a legal certification, it does not cover
the statements or tokens files, it does not establish that Yoann can explain the two files
named under AF-06, and the four NOT RUN checks above remain unproved rather than passed.

## Register lines

- F-LT-01 MEDIUM `app/policies/[policyId]/page.tsx:325` the pending-endorsement notice tells every staff reader "the endorsement takes effect when you pay" while the same page says the owning broker pays; the same undifferentiated audience also gives staff_ops the Endorsements count.
- F-LT-02 MEDIUM `app/policies/[policyId]/correction-sections.tsx:106` "Latest terms on record" prints the unpaid quote as its headline value when no endorsement has been applied, contradicted by its own "nothing applied yet" note.
- F-LT-03 MEDIUM `app/customer/page.tsx:321` the customer's list says a change waits "once the delta is paid" while it is the customer's own approval that is missing, contradicting the tile and the what-needs-you row on the same screens.
- F-LT-04 MEDIUM `app/styles/system.css:2725` the sidebar account name wraps to two lines and collides with the role line at 1024 and 1440, a regression against production d002f77, on every signed-in screen.
- F-LT-05 MEDIUM `app/api/session/switch/route.ts` any demo session reaches staff_approver with no second credential; the ledger proof is unaffected but the control is, and the switch is not yet disclosed in the README or the maker-checker evidence.
- F-LT-06 LOW `app/api/session/switch/route.ts:41` the activity row redacts both emails to three characters and sets no subject id, so it cannot say which of the three broker accounts was assumed.
- F-LT-07 LOW `app/api/session/switch/route.ts:33` an agent principal that exists is refused with "that demo account does not exist on this database", in the UI and in the audit row.
- F-LT-08 LOW `app/ops/policies/page.tsx:218` and `app/broker/page.tsx:273` the "on the latest terms" legend says "takes effect after that date" while the cell deliberately prints no date.
- F-LT-09 LOW `app/customer/page.tsx:166` the legend term "from a date" is a placeholder that never appears on the screen.
- F-LT-10 LOW `app/policies/[policyId]/customer-view.tsx:320` the customer's pending row carries an unlegended chip under a "Charged" column whose legend says money moved.
- F-LT-11 LOW `lib/ui/emphasis.ts:65` "N of M days" bolds the term length and leaves the days remaining in grey.
- F-LT-12 LOW `components/shell/app-shell.tsx` the demo-account menu is a hard-coded list, so it offers entries a differently seeded database cannot serve.

---

# Re-review, 2026-09-09 23:15 to 00:20 UTC

Re-reviewed head: **`d8aa06d`** ("Merge Billing: the collect anchor exists, one full stop per
sentence, the strike explained"), reached by `git merge ui-evening-2` in this worktree.
Working tree clean apart from this record (untracked). The head moved twice while I was
measuring, so every verdict below names the head it was measured on; the four MEDIUM fixes
were measured first at `2cd8421` and then re-measured whole at `d8aa06d`, which is the head
this section reports.

Fix commits inspected: `c16a632` (F-LT-01, F-LT-02, F-LT-10), `731d034` (F-LT-03, F-LT-08,
F-LT-09), `e236fd1` (F-LT-11), `fe6b9d1` (F-LT-04, F-LT-06, F-LT-07), `4f10705` and
`ed807f6` (the switch actor gate and the non-form body, another reviewer's F-SWITCH-01 and
F-SWITCH-02, measured here because they change the route I attacked), `e656ece` (the claims
bank-account slice), plus the lists builder's cancelled/voided rule, which arrived between
`2cd8421` and `d8aa06d`.

Prior findings and verdicts above are preserved. This section is appended.

## Evidence for this pass

Disposable database `corgi_ui_late2` (created, migrated with 26 files, seeded, **dropped at
the end**, confirmed). On it: one bound policy `CGP-01001` at $1,200.00 annual, then the
whole endorsement flow driven through the real screens, the broker posting the request from
the endorsement preview and **the customer approving from their own approval page**, so both
standings were rendered rather than read:

- **awaiting_approval**: quote $2,700.00 effective 2026-10-01, delta $1,409.06.
- **approved**: the customer's approval recorded at 2026-09-09 21:24:26 UTC.

Trial database, `GET` only, for the claims slice and the cancelled/voided rule. Both dev
servers stopped by their port's PID. `npm run typecheck` clean and `npm test` 553 pass / 1
skipped / 0 fail at both `2cd8421` and `d8aa06d`.

## Finding by finding

### F-LT-01: RESOLVED

`c16a632` replaces the two-value audience with `PolicyAudience = "customer" |
"owning-broker" | "staff"`, computed on the policy page as
`isOwningBroker ? "owning-broker" : "staff"`, and passes it to the notice, the count and
the chip. Rendered on one policy in the approved standing, four readers, at `d8aa06d`:

| Reader | Notice | Endorsements count | Band |
|---|---|---|---|
| owning broker | "…the endorsement takes effect when **you** pay." | `1` | `Pay the delta $1,409.06` |
| staff operations | "…the endorsement takes effect when **the broker pays the delta**." | none (next nav entry is Claims) | none |
| staff approver | same as operations | none | none |
| customer | "You approved the quote at …; the endorsement takes effect when **your broker pays the delta**." | n/a | none |

In the awaiting_approval standing the broker and staff read the same sentence ("…when the
customer approves and the delta is paid"), which names nobody as the payer and is correct
for both, and neither carries a count. The contradiction with the Billing view's "The
owning broker collects the endorsement delta" is gone. `id="pay-delta"` still appears
exactly once in the owning broker's Billing view and zero times in the operator's.

### F-LT-02: RESOLVED

`LatestTermsStat` now returns null on `!latestApplied` rather than falling back to the
pending quote, and the value has one branch. Rendered at `d8aa06d`: with the quote
outstanding and nothing applied, **no "Latest terms on record" tile at all** on the broker,
staff or customer view, in either standing. The quote keeps its notice above the tiles, its
row in the changes table and its card. The earlier tile that read `$2,700.00` over
"nothing applied yet" no longer exists.

### F-LT-03: RESOLVED

`requestedCondition` branches on `row.live.standing.state`, on the two strings the policy
page prints. Rendered on `/customer` at `d8aa06d`:

- awaiting the customer: `$2,700.00 from 2026-10-01 if it is approved and the delta is paid`
- after the customer approved: `$2,700.00 from 2026-10-01 once the delta is paid`

The list and the policy page now say the same thing about the same request on the same day.

### F-LT-04: RESOLVED

`fe6b9d1` adds `min-width: 0` to the name column and `white-space: nowrap; overflow:
hidden; text-overflow: ellipsis` to the name and role lines. Re-measured at `d8aa06d`:

| | before (`5c4852f`) | after (`d8aa06d`) |
|---|---|---|
| name lines | 2 | **1** |
| name box height | 40 px | **20 px** |
| button height | 71 px | **51 px** |

Same at 1024. The screenshot shows "Sam Patel, operati…" on one line above "Staff
operations", no collision. Tradeoff, noted rather than raised: at 1440 the name is now
truncated where production `d002f77` showed it whole. The full name stays in the button's
`aria-label` and the menu below names the account, so nothing is lost, and the collision is
the worse of the two.

### F-LT-05: PARTLY RESOLVED, ONE SENTENCE STILL OWED (downgraded to LOW)

Three things changed the picture, and two of them are real improvements:

1. **The actor gate** (`4f10705`, another reviewer's F-SWITCH-01) requires the caller to be
   a demo account too. Measured: `unlisted-ops@example.invalid`, a real `staff_ops` row that
   can sign in with the shared password but is not on the list, is refused with `only a demo
   account can switch accounts`, 303, no cookie. A broker created through the application can
   no longer reach staff through this route. This closes the wider of the two paths.
2. **The README does disclose the device**, on the branch, in the credentials paragraph:
   "The account menu at the foot of the sidebar switches between the six demo accounts
   without retyping the shared password; it is a demo device restricted by code to those six
   accounts and is removed before any real deployment." That satisfies points 1 and 3 of what
   I asked for.
3. **The escalation itself is unchanged and still measured**: signed in as
   `customer@example.com`, `POST /api/session/switch` with `email=approver@example.com`
   returns 303 to `/ops` with a signed session cookie, and `/ops` then renders 200. No
   password, no second factor, no role restriction on the transition.

What is still owed is the one sentence I asked for and did not find: nothing in the README
or in the maker-checker material says that **on the deployed demo the two-human separation
rests on the closed list alone**, because one demo session becomes the approver with a
click. The device is disclosed; its consequence for the gate the brief cares about is not.
Grep of `README.md` for "maker-checker", "second approver" and "distinct" returns the
threshold paragraph and the MCP paragraph, neither of which mentions the switch.

The ledger proof remains unaffected and I confirm it again: distinct user ids on the rows,
migration 0008's trigger untouched.

Downgraded to LOW because the device is now disclosed and the actor gate narrows it to six
seeded accounts. **Still open.** Required: one sentence, beside the switcher sentence or in
the maker-checker section, saying that a demo session can assume the approver without a
second credential and that the separation on the demo therefore rests on the closed list.

### F-LT-06: RESOLVED for the audit purpose, one part deferred

The message now carries the target's user id, which the logging layer does not redact.
Quoted from `activity_log` on the disposable database, and each id resolved back against
`users`:

```
actor=ops@example.com      | named id resolves to broker@example.com   | subject_id=null
actor=broker@example.com   | named id resolves to customer@example.com | subject_id=null
actor=customer@example.com | named id resolves to approver@example.com | subject_id=null
```

The row now says exactly which of the three broker accounts was assumed, which was the
defect. `subject_id` is still null; the coordinator records a new `ActivitySubjectKind` as
week-two work and I accept that as a recorded deferral rather than an open finding.

### F-LT-07: RESOLVED

Two branches, two sentences, measured with an `agent` row parked on the listed address
`broker3@example.com` and with `broker2@example.com` freed so a listed address had no row
at all:

| Case | Location | Cookie |
|---|---|---|
| listed address, no row | `/ops?error=that demo account does not exist on this database` | no |
| listed address, `agent` row | `/ops?error=an agent principal cannot hold a browser session` | no |

Both sentences reach the `activity_log` message too. The audit table no longer says a row
does not exist when it does.

### F-LT-08: RESOLVED

All three lists now read "a change is already written on the policy and takes effect
**later**". No legend on these screens promises a date the cell does not print.

### F-LT-09: RESOLVED

The clause itself is the legend term, and both the cell and the legend read the same two
constants (`ONCE_PAID`, `IF_APPROVED_AND_PAID`), with `conditionsOnScreen` naming only the
one a row below actually ends on. Rendered in both standings: the legend term is character
for character the clause in the cell above it.

### F-LT-10: RESOLVED, with a new LOW beside it (F-LT-13)

The "Charged" legend now reads "…on a row marked **to settle** it is the quote, and nothing
has moved yet", and the two waiting states are named. Rendered on the customer's policy
page in both standings.

### F-LT-11: RESOLVED

A proration is matched whole, above the plain day count. Rendered on the endorsement
approval page at `d8aa06d`:

```html
<strong>335 of 365 days</strong> of the term remain from <strong>2026-10-01</strong>
```

The days remaining are in bold with the term they are read against, instead of the term
length alone. The unit test was updated in the same commit and asserts the new shape.

### F-LT-12: ACCEPTED BY DESIGN

Recorded as accepted. The deployed database is seeded by `npm run seed`, which creates all
six accounts, and a listed address with no row is now refused with its own sentence
(F-LT-07), so the failure mode is visible rather than silent.

## The lists builder's extra rule: no later terms on a closed policy

Landed between `2cd8421` and `d8aa06d`. `laterTerms` on `/ops/policies` and `/broker`, and
`policyIsClosed` on `/customer`, return null for `cancelled` and `voided`.

Measured on the trial database, `/ops/policies` as ops: the row for `CGP-01707`
(**cancelled**, two applied endorsements) now reads `$1,253.20` with **no second line**,
where at `a29beef` it read `$2,788.45 on the latest terms`; and because no row on that
screen prints the term any more, the legend entry is gone too, which is the gating working.

The comment states the accepted edge case honestly: a cancellation recorded now but
effective in the future, with an endorsement effective before it, really does take effect
and is hidden by this rule, and telling the two apart needs the cancellation's effective
date these lists do not read. I agree with the tradeoff and with recording it as week-two
work rather than silently hiding it; the honest comment is what makes it acceptable.

## Claims: the bank-account form (`e656ece`)

Scope: `app/ops/claims/[claimId]/page.tsx`, `app/styles/policy-detail.css`.

**Form census.** `grep -E '^[-+].*(action=|method=|name="|intent)'` over `git show e656ece`
returns one added block and one removed block and nothing else. Extracted and compared line
by line, the two 26-line form blocks are **IDENTICAL**: same `method="post"`, same
`action={/api/claims/${claim.claimId}}`, same `action=add-bank-account` hidden intent, same
`accountHolderName` / `routingNumber` / `accountNumber` fields, same submit label. It is a
move, not a rewrite. The live DOM agrees on both claims:
`post /api/claims/<id> [action=add-bank-account,accountHolderName,routingNumber,accountNumber]`.

**CLM-00213, no account** (trial database, as ops, 1440):

- `#bank-account` appears **exactly once** on the page.
- The form is inside that card (`insideBankCard: true`), behind a `Disclosure` whose
  summary reads "Record a bank account" and is **open on arrival**.
- The summary computes as a secondary button: `inline-flex`, white background, `1px solid`
  border, `10px` radius, `7px 13px` padding, weight 500, `cursor: pointer`.
- The payment form carries `No verified bank account yet: record one first.` with
  `href="#bank-account"`, and the submit button is left enabled, which is right: the rule is
  the server's and a disabled button is not a control.
- The card still carries `LOCAL SIMULATOR: a simulated ownership check, not a live bank
  integration.` and the page still carries the AF-02 mode line verbatim.

**CLM-00214, verified account**: the same `Record a bank account` disclosure is **closed on
arrival** with the same button styling, and there is **no** helper line under the payment
form. (First probe read `open: false, summary: ""` on this page: that was the
`SandboxReferences` pill, a second `<details>` inside the same card; re-probed by summary
text, the right element is closed.)

**The RowMenu.** The `pd-panel-menu` menu beside "Reserve, pay, close" is gone from the
overview: no `RowMenu` renders there, and the panel head holds only its heading. The
per-payment simulator menus are untouched and still render on the payments view:
`<button class="row-menu-button" aria-label="LOCAL SIMULATOR controls">` on each row, with
`action=settle` and `action=return` forms inside them (two settle forms on CLM-00214, one
return form on CLM-00212).

**375 px**: `/ops/claims/<CLM-00213>`, `/ops/claims/<CLM-00214>` and its payments view, ops,
plain and folds-open: **no HORIZONTAL OVERFLOW**, no dash characters. `BAND NOT STICKY` on
all three, pre-existing across the application.

Nothing to raise on this slice.

## New findings from this pass

### F-LT-13 (LOW): the customer's changes legend names a chip that is not on the screen

`app/policies/[policyId]/customer-view.tsx:303-326`. The fix for F-LT-10 adds **both**
waiting states to the legend whenever `liveEndorsement` exists, rather than the one the row
below actually wears.

Measured on the customer's policy page:

- awaiting the customer: the row wears `awaiting your approval`, and the legend defines
  `awaiting your approval` **and** `approved, awaiting payment`.
- after approval: the row wears `approved, awaiting payment`, and the legend still defines
  both.

Every other legend on these screens is gated per term, including the two this batch added
(`statusesOnScreen`, `conditionsOnScreen`, "on the latest terms"), and the batch's own rule
is "a legend is a reading of THIS screen". This is the same orphan-term defect as F-LT-09,
one screen over.

Required: gate each of the two entries on
`pendingEndorsementState(liveEndorsement.standing.state, "customer").label`, the way
`conditionsOnScreen` gates the clauses.

### F-LT-14 (LOW): an em dash in a source comment

`app/policies/[policyId]/page.tsx:243`, added by the Billing fix commit:
`// F-BL-12: the second branch is not dead code [em dash] the card carries ...`

It is the only em or en dash on any added source line in `a29beef..d8aa06d` (the check was
run over every added line, docs excluded), and no rendered screen carries one: the
`break.mjs` dash counter reported zero on every screen measured in both passes. It is a
comment, not user-visible text, but the repository's ban is not scoped to rendered text.
Raised here because I found it; it belongs to whoever owns the F-BL findings.

## Checks executed in this pass

`git merge ui-evening-2` (three times, as the head moved); `npm run typecheck` and
`npm test` at `2cd8421` and at `d8aa06d`; the form census and the block-identity comparison
on `git show e656ece`; the em/en dash census over every added source line of
`a29beef..d8aa06d`; the `loading.tsx` census (none); the disposable database created,
migrated, seeded, driven through the endorsement request and the customer's approval, read
back, and dropped; screen captures with folds open for four readers in two standings; the
account-block metrics at 1440 and 1024 with a deviceScaleFactor-3 screenshot; nine measured
requests against `/api/session/switch` including the two refusal branches, the actor gate, a
JSON body and a four-hop happy path; the `activity_log` rows read back and every named user
id resolved against `users`; the claim pages probed at 1440 and swept at 375; the trial
database's `/ops/policies` re-read for the cancelled/voided rule; `README.md` grepped for
the F-LT-05 disclosure.

## Checks not executed in this pass, and why

- The four NOT RUN checks of the first pass are still NOT RUN, for the same reasons: the
  correction preview's Confirm paragraph and the customer correction-approval fold (the only
  endorsed policy on the trial database is cancelled and the disposable policy's endorsement
  is unpaid, so there is nothing to correct), the hostile `reason=` parameter on that
  preview, "older open item primary" with both a delta and a correction difference open, and
  the blocking what-needs-you rows for `broker2` / `broker3`.
- `gitleaks` was not re-run: only `.tsx`, `.ts` and `.css` files changed in
  `a29beef..d8aa06d`, no new environment or fixture file, and the first pass found nothing in
  a tracked file.
- The production baseline was not re-fetched: the deployed revision has moved on since
  `d002f77` and the comparison it served (F-LT-04's before, F-EV-08's before) is already
  recorded above.

## Re-review verdict

**PASS** for the scope reviewed, at `d8aa06d`.

All four MEDIUM findings that produced the FAIL are resolved and were rendered, not read:
the notice and the count now follow who is actually reading; the "Latest terms on record"
tile is drawn only for terms the record holds; the customer's list names their own
outstanding approval in the same words their policy page uses; the account name stays on one
line. F-LT-06 through F-LT-11 are resolved, F-LT-12 accepted. The claims bank-account slice
is a clean move: the claim forms keep their method, action, intent and field names, the
form is now in the card that says it is missing, the fold is open exactly when recording an
account is the blocking thing to do, and the simulator controls are untouched. The lists
builder's closed-policy rule is right and its edge case is disclosed instead of hidden.

Two LOW findings remain open (F-LT-13, F-LT-14) and one LOW is owed a sentence rather than
code (F-LT-05). None of them blocks: LOW findings are cosmetic or documentary and, per
`REVIEWER.md`, cosmetic suggestions alone do not block. **F-LT-05's remaining sentence
should be written before the submission email goes out**, because it is the one place where a
reviewer of the deployed application could be misled about a control the brief names.

The automatic-fail gate of the first pass stands unchanged for this scope, with AF-05
carried forward on the first pass's scan and AF-06 still not something a reviewer can
certify on Yoann's behalf. Residual limitations are those recorded above, plus the four
checks that remain NOT RUN rather than passed.

## Register lines, re-review

- F-LT-01 RESOLVED at `c16a632`, rendered on four readers in the approved standing: owning broker "when you pay" with the count and the band action, other staff "when the broker pays the delta" with neither.
- F-LT-02 RESOLVED at `c16a632`: no "Latest terms on record" tile at all while no endorsement is applied, on all three views and both standings.
- F-LT-03 RESOLVED at `731d034`: the customer's list clause follows the standing, in the policy page's own two strings.
- F-LT-04 RESOLVED at `fe6b9d1`: the account name is one line of 20 px at 1440 and 1024, truncated with an ellipsis, against two lines of 40 px before.
- F-LT-05 OPEN, downgraded to LOW: the actor gate and the README's switcher sentence landed, but nothing says that on the demo a session becomes the approver without a second credential, so the two-human separation there rests on the closed list alone.
- F-LT-06 RESOLVED at `fe6b9d1` for the audit purpose: the message carries the target's unredacted user id, which resolves to the right account; `subject_id` deferred to week two and accepted.
- F-LT-07 RESOLVED at `fe6b9d1`: a missing row and an agent principal now answer two different sentences, in the redirect and in the audit row.
- F-LT-08 RESOLVED at `731d034`: all three lists say "takes effect later".
- F-LT-09 RESOLVED at `731d034`: the legend term is the clause the row prints, gated on the clause being on screen.
- F-LT-10 RESOLVED at `c16a632`: the Charged column is qualified for a "to settle" row and the waiting states are named.
- F-LT-11 RESOLVED at `e236fd1`: "335 of 365 days" is one bold piece on the approval screen.
- F-LT-12 ACCEPTED by design; the failure mode is now a named refusal rather than a silent one.
- F-LT-13 LOW `app/policies/[policyId]/customer-view.tsx:303` the customer's changes legend defines both waiting chips whenever a change is live, including the one no row on the screen wears.
- F-LT-14 LOW `app/policies/[policyId]/page.tsx:243` an em dash in a source comment added by the Billing fix, the only one on any added source line of the range.
